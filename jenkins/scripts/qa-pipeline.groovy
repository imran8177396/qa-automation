// Shared Jenkins helpers. Loaded after checkout from repo-root Jenkinsfiles.
// Cursor is not a Jenkins plugin. These helpers only invoke npm / npx / existing scripts.
// Never echo credential values. Never authorize heavy JMeter from this file.

List protectedBranches = ['main', 'master', 'develop']

def qaSh(String command) {
  if (isUnix()) {
    sh command
  } else {
    bat command
  }
}

def npmRun(String npmArgs) {
  qaSh("npm ${npmArgs}")
}

def tryNpmRun(String npmArgs) {
  try {
    npmRun(npmArgs)
  } catch (err) {
    echo "Command failed (npm ${npmArgs}); continuing so reports and artifacts can still be collected. Credentials are not printed."
  }
}

def installPlaywrightBrowsers(String browsers) {
  if (isUnix()) {
    sh "npx playwright install --with-deps ${browsers}"
  } else {
    bat "npx playwright install ${browsers}"
  }
}

def isPullRequestBuild() {
  return env.CHANGE_ID != null && env.CHANGE_ID.toString().trim()
}

def branchName() {
  def raw = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
  return raw.replaceFirst(/^origin\//, '')
}

def isProtectedBranch() {
  def names = protectedBranches ?: ['main', 'master', 'develop']
  return names.contains(branchName())
}

def isLightweightQa() {
  return isPullRequestBuild() || !isProtectedBranch()
}

def applyPipelineProfile() {
  if (isLightweightQa()) {
    env.QA_PIPELINE_PROFILE = 'lightweight'
    echo "QA pipeline profile: lightweight (CHANGE_ID or feature branch ${branchName()}). Credentials are not printed."
  } else {
    env.QA_PIPELINE_PROFILE = 'regression'
    echo "QA pipeline profile: regression (protected branch ${branchName()}). Credentials are not printed."
  }
}

def validateAgentEnvironment() {
  qaSh('node -v')
  qaSh('npm -v')
  try {
    qaSh('java -version')
  } catch (err) {
    echo 'Java not found on PATH. JMeter and Allure CLI will be recorded NOT_EXECUTED or BLOCKED by npm scripts. Credentials are not printed.'
  }
  if (isUnix()) {
    sh 'if command -v jmeter >/dev/null 2>&1; then echo JMeter: present on PATH; else echo JMeter: not on PATH — npm performance stage records the gap; fi'
  } else {
    bat 'where jmeter >NUL 2>&1 && echo JMeter: present on PATH || echo JMeter: not on PATH — npm performance stage records the gap'
  }
}

def bindOptionalCredential(String credentialsId, String envName) {
  try {
    withCredentials([string(credentialsId: credentialsId, variable: 'QA_BOUND_TMP')]) {
      env[envName] = env.QA_BOUND_TMP ?: ''
    }
  } catch (err) {
    if (env[envName] == null) {
      env[envName] = ''
    }
    echo "${envName}: not bound (Jenkins credential '${credentialsId}' missing or unreadable; auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
  }
}

def bindQaRuntimeCredentials() {
  bindOptionalCredential('qa-api-url', 'QA_API_URL')
  bindOptionalCredential('qa-username', 'QA_USERNAME')
  bindOptionalCredential('qa-password', 'QA_PASSWORD')
  bindOptionalCredential('qa-api-token', 'QA_API_TOKEN')
  bindOptionalCredential('qa-api-username', 'QA_API_USERNAME')
  bindOptionalCredential('qa-api-password', 'QA_API_PASSWORD')
}

def recordCredentialAvailability(String credentialsId, String envName) {
  try {
    withCredentials([string(credentialsId: credentialsId, variable: 'QA_BOUND_TMP')]) {
      if (env.QA_BOUND_TMP != null && env.QA_BOUND_TMP != '') {
        echo "${envName}: configured (Jenkins credential '${credentialsId}'; value not printed)"
      } else {
        echo "${envName}: not configured (credential '${credentialsId}' empty; auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
      }
    }
  } catch (err) {
    echo "${envName}: not configured (credential '${credentialsId}' missing; auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
  }
}

def recordAllCredentialAvailability() {
  recordCredentialAvailability('qa-website-url', 'QA_WEBSITE_URL')
  recordCredentialAvailability('qa-api-url', 'QA_API_URL')
  recordCredentialAvailability('qa-username', 'QA_USERNAME')
  recordCredentialAvailability('qa-password', 'QA_PASSWORD')
  recordCredentialAvailability('qa-api-token', 'QA_API_TOKEN')
  recordCredentialAvailability('qa-api-username', 'QA_API_USERNAME')
  recordCredentialAvailability('qa-api-password', 'QA_API_PASSWORD')
  if (isUnix()) {
    sh 'sh jenkins/scripts/record-credential-status.sh'
  } else {
    bat 'powershell -NoProfile -ExecutionPolicy Bypass -File jenkins\\scripts\\record-credential-status.ps1'
  }
}

def restoreFixtureWebsiteIfNeeded() {
  if (env.QA_USE_FIXTURE == 'true') {
    env.QA_PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4173'
    env.QA_WEBSITE_URL = 'http://127.0.0.1:4173/'
    echo 'Fixture origin restored for this job (qa-website-url is not used as the test origin). Credentials are not printed.'
  }
}

def startFixtureSite() {
  if (isUnix()) {
    sh 'sh jenkins/scripts/start-fixture.sh'
  } else {
    bat 'powershell -NoProfile -ExecutionPolicy Bypass -File jenkins\\scripts\\start-fixture.ps1'
  }
}

def runFullRegression(String discoverUrl) {
  def url = discoverUrl != null ? discoverUrl.trim() : ''
  if (!url) {
    npmRun('run qa:all')
    return
  }
  withEnv(["QA_DISCOVER_URL=${url}"]) {
    if (isUnix()) {
      sh 'npm run qa:all -- --url="$QA_DISCOVER_URL"'
    } else {
      bat 'npm run qa:all -- --url=%QA_DISCOVER_URL%'
    }
  }
}

def assertHeavyAuthorized(Object authorizeHeavy) {
  if (authorizeHeavy != true && authorizeHeavy.toString() != 'true') {
    error 'NOT_AUTHORIZED: set AUTHORIZE_HEAVY=true to run heavy JMeter. Default is false. jmeter.allowHeavyAgainst must still allow the API host. Never a production host by default. Credentials are not printed.'
  }
}

def assertHeavyProfile(Object profile) {
  def allowed = ['load', 'stress', 'spike', 'soak']
  if (!allowed.contains(profile != null ? profile.toString() : '')) {
    error 'NOT_AUTHORIZED: PROFILE must be load, stress, spike, or soak. Credentials are not printed.'
  }
}

def applyApiUrlOverride(String overrideUrl) {
  def url = overrideUrl != null ? overrideUrl.trim() : ''
  if (url) {
    env.QA_API_URL = url
    echo 'QA_API_URL override parameter is set (value not printed). Heavy runs still require loopback or jmeter.allowHeavyAgainst.'
  }
}

def archiveQaArtifacts() {
  archiveArtifacts(
    artifacts: 'reports/**,test-results/**,*.log,jmeter.log',
    allowEmptyArchive: true,
    excludes: '.env,.env.*,**/.env,**/.env.*,config/generated.env,**/*.pem,**/*.pfx,**/*.p12'
  )
  publishHtmlIfAvailable('reports/allure/report', 'Allure', 'index.html')
  publishHtmlIfAvailable('reports/playwright/e2e/html', 'Playwright E2E', 'index.html')
  publishHtmlIfAvailable('reports/summary', 'Final QA summary', 'final-qa-report.md')
  publishAllureIfAvailable()
}

def publishHtmlIfAvailable(String reportDir, String reportName, String indexFile) {
  try {
    publishHTML(target: [
      allowMissing         : true,
      alwaysLinkToLastBuild: true,
      keepAll              : true,
      reportDir            : reportDir,
      reportFiles          : indexFile,
      reportName           : reportName
    ])
  } catch (err) {
    echo "HTML Publisher plugin not available for ${reportName}; use archived files under ${reportDir}. Credentials are not printed."
  }
}

def publishAllureIfAvailable() {
  try {
    allure([
      includeProperties: false,
      jdk              : '',
      results          : [[path: 'reports/allure/results']]
    ])
  } catch (err) {
    echo 'Allure Jenkins plugin not configured; archived reports/allure/report is produced by npm run report:allure. Credentials are not printed.'
  }
}

def notifyQa() {
  def result = currentBuild.currentResult ?: 'UNKNOWN'
  def job = env.JOB_NAME ?: 'unknown-job'
  def number = env.BUILD_NUMBER ?: 'unknown'
  def branch = env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'unknown-branch'
  echo "QA pipeline finished: job=${job} build=${number} result=${result} branch=${branch}. See archived reports/summary/. Credentials are not printed."
  try {
    emailext(
      subject: "QA ${result}: ${job} #${number}",
      body: 'See Jenkins build artifacts (Allure, Playwright HTML, Postman, JMeter, logs, final QA report). Credentials are not included.',
      recipientProviders: [[$class: 'RequesterRecipientProvider'], [$class: 'CulpritsRecipientProvider'], [$class: 'DevelopersRecipientProvider']]
    )
  } catch (err) {
    echo 'Email-ext plugin not configured; console notification only. Credentials are not printed.'
  }
}

return this
