import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';

export const JENKINSFILE_PATH = path.join(PATHS.root, 'jenkins', 'Jenkinsfile');
export const JENKINSFILE_REGRESSION_PATH = path.join(PATHS.root, 'jenkins', 'Jenkinsfile.regression');
export const JENKINSFILE_PERFORMANCE_PATH = path.join(PATHS.root, 'jenkins', 'Jenkinsfile.performance');
export const JENKINS_HELPER_GROOVY_PATH = path.join(PATHS.root, 'jenkins', 'scripts', 'qa-pipeline.groovy');

export const JENKINS_HELPER_LOAD_PATH = 'jenkins/scripts/qa-pipeline.groovy';
export const JENKINS_FIXTURE_ORIGIN = 'http://127.0.0.1:4173';
export const JENKINS_DEFAULT_DEVELOP_BRANCH = 'develop';
export const HEAVY_JMETER_PROFILES = ['load', 'stress', 'spike', 'soak'] as const;

/** Jenkins Credentials IDs (Secret text). Values stay in Jenkins; never in Groovy. */
export const JENKINS_CREDENTIALS = [
  { id: 'qa-website-url', env: 'QA_WEBSITE_URL', bindOnDefaultJobs: false },
  { id: 'qa-api-url', env: 'QA_API_URL', bindOnDefaultJobs: true },
  { id: 'qa-username', env: 'QA_USERNAME', bindOnDefaultJobs: true },
  { id: 'qa-password', env: 'QA_PASSWORD', bindOnDefaultJobs: true },
  { id: 'qa-api-token', env: 'QA_API_TOKEN', bindOnDefaultJobs: true },
  { id: 'qa-api-username', env: 'QA_API_USERNAME', bindOnDefaultJobs: true },
  { id: 'qa-api-password', env: 'QA_API_PASSWORD', bindOnDefaultJobs: true },
] as const;

export const MULTIBRANCH_ALWAYS_STAGES = [
  'Checkout',
  'Environment validation',
  'Install dependencies',
  'TypeScript validation',
  'Allure report',
  'Artifact collection',
  'Final QA summary',
  'Notification',
] as const;

/** PR / feature lightweight tier (mirrors GitHub PR workflow). */
export const MULTIBRANCH_LIGHTWEIGHT_STAGES = [
  'Application discovery',
  'unit',
  'smoke',
  'critical E2E',
  'API tests',
  'Accessibility tests',
  'security-light',
  'UI performance',
  'Lightweight JMeter smoke',
] as const;

export const MULTIBRANCH_REGRESSION_STAGE = 'Main / regression tier';

/** Dedicated regression job: main tier + scheduled tier (not a PR job). */
export const REGRESSION_JOB_STAGES = [
  'Checkout',
  'Environment validation',
  'Install dependencies',
  'TypeScript validation',
  'Discovery',
  'full E2E',
  'API',
  'integration',
  'contract',
  'visual',
  'responsive',
  'accessibility',
  'security',
  'SEO',
  'content',
  'regression',
  'dependency',
  'compatibility matrix',
  'AI regression',
  'deep security',
  'Destructive resilience',
  'Production verification',
  'Allure report',
  'Artifact collection',
  'Final QA summary',
  'Notification',
] as const;

export const PERFORMANCE_JOB_STAGES = [
  'Checkout',
  'Environment validation',
  'Install dependencies',
  'TypeScript validation',
  'Authorize heavy performance',
  'Heavy JMeter',
  'Allure report',
  'Artifact collection',
  'Notification',
] as const;

export const ARTIFACT_PATHS = [
  'reports/allure',
  'reports/playwright',
  'reports/postman',
  'reports/jmeter',
  'reports/summary',
  'test-results',
] as const;

export function jenkinsProtectedBranches(config: QaConfig): string[] {
  const names = [...config.github.branches];
  if (!names.includes(JENKINS_DEFAULT_DEVELOP_BRANCH)) {
    names.push(JENKINS_DEFAULT_DEVELOP_BRANCH);
  }
  return names;
}

function groovyStringList(values: string[]): string {
  return values.map((name) => `'${name}'`).join(', ');
}

function checkoutAndLoadStage(): string {
  return `    stage('Checkout') {
      steps {
        checkout scm
        script {
          qa = load '${JENKINS_HELPER_LOAD_PATH}'
        }
      }
    }`;
}

function environmentValidationStage(restoreFixture: boolean): string {
  const restore = restoreFixture
    ? `
          qa.restoreFixtureWebsiteIfNeeded()`
    : '';
  return `    stage('Environment validation') {
      steps {
        script {
          qa.validateAgentEnvironment()
          qa.bindQaRuntimeCredentials()
          qa.recordAllCredentialAvailability()${restore}
          qa.applyPipelineProfile()
        }
      }
    }`;
}

function environmentValidationStageStandalone(restoreFixture: boolean, applyProfile: boolean): string {
  const extra: string[] = [];
  if (restoreFixture) extra.push('          qa.restoreFixtureWebsiteIfNeeded()');
  if (applyProfile) extra.push('          qa.applyPipelineProfile()');
  const extraBlock = extra.length ? `\n${extra.join('\n')}` : '';
  return `    stage('Environment validation') {
      steps {
        script {
          qa.validateAgentEnvironment()
          qa.bindQaRuntimeCredentials()
          qa.recordAllCredentialAvailability()${extraBlock}
        }
      }
    }`;
}

function installStage(_browserMode: 'profile' | 'full' | 'chromium'): string {
  const browsers = `          qa.installPlaywrightBrowsers('chromium firefox webkit')`;

  return `    stage('Install dependencies') {
      steps {
        script {
          qa.npmRun('ci')
          qa.npmRun('run qa:sync')
${browsers}
          qa.npmRun('run preflight')
        }
      }
    }`;
}

function typecheckStage(): string {
  return `    stage('TypeScript validation') {
      steps {
        script {
          qa.npmRun('run typecheck')
        }
      }
    }`;
}

function reportArchiveNotifyStages(): string {
  return `    stage('Allure report') {
      steps {
        script {
          qa.tryNpmRun('run report:all')
        }
      }
    }

    stage('Artifact collection') {
      steps {
        script {
          qa.archiveQaArtifacts()
        }
      }
    }

    stage('Final QA summary') {
      steps {
        echo 'Final QA summary is written by report:all to reports/summary/. Credentials are not printed.'
      }
    }

    stage('Notification') {
      steps {
        script {
          qa.notifyQa()
        }
      }
    }`;
}

function postAlways(): string {
  return `  post {
    always {
      script {
        if (qa != null && currentBuild.currentResult != 'SUCCESS') {
          qa.tryNpmRun('run report:all')
          qa.archiveQaArtifacts()
          qa.notifyQa()
        }
      }
    }
  }`;
}

function fixtureEnvBlock(): string {
  return `  environment {
    CI = 'true'
    QA_PLAYWRIGHT_HEADLESS = 'true'
    QA_USE_FIXTURE = 'true'
    QA_PLAYWRIGHT_BASE_URL = '${JENKINS_FIXTURE_ORIGIN}'
    QA_WEBSITE_URL = '${JENKINS_FIXTURE_ORIGIN}/'
    QA_FIXTURE_PORT = '4173'
  }`;
}

function mainRegressionStages(whenLightweight: boolean, includeScheduled: boolean): string {
  const whenBlock = whenLightweight
    ? `      when { environment name: 'QA_PIPELINE_PROFILE', value: 'regression' }\n`
    : '';
  const scheduledNote = includeScheduled
    ? `
    stage('dependency') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:dependencies')
        }
      }
    }

    stage('compatibility matrix') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:e2e:cross-browser')
        }
      }
    }

    stage('AI regression') {
${whenBlock}      steps {
        echo 'AI engine may be disabled in qa.config.json (tests.ai.enabled); runner exits NOT_TESTED / 0. Do not flip the flag here.'
        script {
          qa.npmRun('run test:ai')
        }
      }
    }

    stage('deep security') {
${whenBlock}      steps {
        echo 'Deep/pentest coverage is NOT_IMPLEMENTED — this is still the existing QA security script, not a new scanner.'
        script {
          qa.npmRun('run test:security')
        }
      }
    }
`
    : '';

  return `    stage('Discovery') {
${whenBlock}      steps {
        script {
          qa.startFixtureSite()
          qa.applyDiscoverUrl(params.DISCOVER_URL)
          qa.npmRun('run discover -- ' + env.QA_WEBSITE_URL)
        }
      }
    }

    stage('full E2E') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:e2e')
        }
      }
    }

    stage('API') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:api')
        }
      }
    }

    stage('integration') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:integration')
        }
      }
    }

    stage('contract') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:contract')
        }
      }
    }

    stage('visual') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:visual')
        }
      }
    }

    stage('responsive') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:responsive')
        }
      }
    }

    stage('accessibility') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:accessibility')
        }
      }
    }

    stage('security') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:security')
        }
      }
    }

    stage('SEO') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:seo')
        }
      }
    }

    stage('content') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:content')
        }
      }
    }

    stage('regression') {
${whenBlock}      steps {
        script {
          qa.npmRun('run test:regression')
        }
      }
    }
${scheduledNote}`;
}

export function renderMultibranchJenkinsfile(config: QaConfig): string {
  const branches = groovyStringList(jenkinsProtectedBranches(config));

  return `// Multibranch Pipeline entry. Controller Script Path: jenkins/Jenkinsfile
// GitHub Branch Source discovers branches and pull requests automatically.
// PR / feature: PR tier (unit, smoke, API, critical E2E, accessibility, security-light).
// Protected branches: main/regression tier (not qa:all). Heavy JMeter is never authorized here.
// Protected branches: ${jenkinsProtectedBranches(config).join(', ')}
// Cursor is not a Jenkins plugin. This file calls npm / npx / existing scripts only.
// Never hardcode passwords, tokens, API keys, cookies, or credentials.
// Credentials (Secret text IDs, empty if missing): qa-username, qa-password, qa-api-token, qa-api-url, qa-api-username, qa-api-password, qa-website-url
// Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE — not a PR stage; no separate chaos runner.

def qa

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 90, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(
      name: 'DISCOVER_URL',
      defaultValue: '',
      description: 'Optional live URL for protected-branch discovery/tests. Empty uses the in-repo fixture. Ignored on PR/feature jobs. Do not put secrets in this field.'
    )
  }

${fixtureEnvBlock()}

  stages {
${checkoutAndLoadStage()}

    stage('Configure branch profile') {
      steps {
        script {
          qa.protectedBranches = [${branches}]
          qa.applyPipelineProfile()
        }
      }
    }

${environmentValidationStage(true)}

${installStage('profile')}

${typecheckStage()}

    stage('Application discovery') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.startFixtureSite()
          qa.npmRun('run discover -- ${JENKINS_FIXTURE_ORIGIN}/')
        }
      }
    }

    stage('unit') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:unit')
        }
      }
    }

    stage('smoke') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:smoke')
        }
      }
    }

    stage('critical E2E') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:e2e')
        }
      }
    }

    stage('Accessibility tests') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:accessibility')
        }
      }
    }

    stage('API tests') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:api')
        }
      }
    }

    stage('security-light') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        echo 'security-light: existing QA security scan (not a pentest).'
        script {
          qa.npmRun('run test:security')
        }
      }
    }

    stage('UI performance') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        echo 'Playwright UI timing is produced by npm run test:performance in the next stage (liveness profile only).'
      }
    }

    stage('Lightweight JMeter smoke') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'lightweight' }
      steps {
        script {
          qa.npmRun('run test:performance -- --profile=liveness')
        }
      }
    }

    stage('${MULTIBRANCH_REGRESSION_STAGE}') {
      when { environment name: 'QA_PIPELINE_PROFILE', value: 'regression' }
      steps {
        echo 'Protected-branch main/regression tier. Scheduled extras (dependencies, cross-browser, AI) live on Jenkinsfile.regression / GitHub schedule. Heavy JMeter is not authorized. Chaos stays NOT_TESTED.'
      }
    }

${mainRegressionStages(true, false)}

${reportArchiveNotifyStages()}
  }

${postAlways()}
}
`;
}

export function renderRegressionJenkinsfile(): string {
  return `// Dedicated Jenkins Pipeline job. Script Path: jenkins/Jenkinsfile.regression
// Main/regression tier + scheduled-tier commands. Not a pull-request job.
// AUTHORIZE_DESTRUCTIVE / ALLOW_PRODUCTION default false (manual authorization).
// Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE — no separate chaos runner.
// Heavy JMeter is not authorized here (use Jenkinsfile.performance).
// Cursor is not a Jenkins plugin. This file calls npm / npx / existing scripts only.
// Never hardcode passwords, tokens, API keys, cookies, or credentials.
// Credentials (Secret text IDs, empty if missing): qa-username, qa-password, qa-api-token, qa-api-url, qa-api-username, qa-api-password, qa-website-url

def qa

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 90, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(
      name: 'DISCOVER_URL',
      defaultValue: '',
      description: 'Optional live URL for discovery/tests. Empty uses the in-repo fixture. Do not put secrets in this field.'
    )
    booleanParam(
      name: 'AUTHORIZE_DESTRUCTIVE',
      defaultValue: false,
      description: 'Must be true to run destructive resilience (QA_RESILIENCE_AUTHORIZE / --authorize-destructive). Default false. Chaos remains NOT_TESTED.'
    )
    booleanParam(
      name: 'ALLOW_PRODUCTION',
      defaultValue: false,
      description: 'Must be true to run npm run test:production-verification. Default false. Runner still respects tests.productionVerification.enabled.'
    )
  }

${fixtureEnvBlock()}

  stages {
${checkoutAndLoadStage()}

${environmentValidationStageStandalone(true, false)}

${installStage('full')}

${typecheckStage()}

${mainRegressionStages(false, true)}

    stage('Destructive resilience') {
      when {
        expression { return params.AUTHORIZE_DESTRUCTIVE == true }
      }
      steps {
        echo 'Chaos is not a separate runner — stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE; no chaos tool.'
        script {
          withEnv(['QA_RESILIENCE_AUTHORIZE=true']) {
            qa.npmRun('run test:resilience -- --authorize-destructive')
          }
        }
      }
    }

    stage('Production verification') {
      when {
        expression { return params.ALLOW_PRODUCTION == true }
      }
      steps {
        script {
          qa.npmRun('run test:production-verification')
        }
      }
    }

${reportArchiveNotifyStages()}
  }

${postAlways()}
}
`;
}

export function renderPerformanceJenkinsfile(): string {
  const profiles = HEAVY_JMETER_PROFILES.map((name) => `'${name}'`).join(', ');

  return `// Dedicated / manual Jenkins Pipeline job. Script Path: jenkins/Jenkinsfile.performance
// Heavy JMeter (load / stress / spike / soak) only. AUTHORIZE_HEAVY defaults to false.
// Never a production host by default. allowHeavyAgainst must still allow the API host.
// Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE — not part of this performance job.
// Cursor is not a Jenkins plugin. This file calls npm / npx / existing scripts only.
// Never hardcode passwords, tokens, API keys, cookies, or credentials.
// Credentials (Secret text IDs, empty if missing): qa-username, qa-password, qa-api-token, qa-api-url, qa-api-username, qa-api-password, qa-website-url

def qa

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 90, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '14'))
  }

  parameters {
    choice(
      name: 'PROFILE',
      choices: [${profiles}],
      description: 'Heavy JMeter profile. Not used unless AUTHORIZE_HEAVY is true.'
    )
    booleanParam(
      name: 'AUTHORIZE_HEAVY',
      defaultValue: false,
      description: 'Must be true to run heavy JMeter. Default is false. Still requires loopback or jmeter.allowHeavyAgainst.'
    )
    string(
      name: 'API_URL_OVERRIDE',
      defaultValue: '',
      description: 'Optional QA_API_URL override. Empty uses Jenkins credential qa-api-url or qa.config.json. Do not default this to a production host. Do not put secrets in this field.'
    )
  }

  environment {
    CI = 'true'
    QA_PLAYWRIGHT_HEADLESS = 'true'
  }

  stages {
${checkoutAndLoadStage()}

${environmentValidationStageStandalone(false, false)}

${installStage('chromium')}

${typecheckStage()}

    stage('Authorize heavy performance') {
      steps {
        script {
          qa.applyApiUrlOverride(params.API_URL_OVERRIDE)
          qa.assertHeavyAuthorized(params.AUTHORIZE_HEAVY)
          qa.assertHeavyProfile(params.PROFILE)
        }
      }
    }

    stage('Heavy JMeter') {
      steps {
        script {
          qa.npmRun('run test:performance -- --profile=' + params.PROFILE + ' --authorize-heavy')
        }
      }
    }

    stage('Allure report') {
      steps {
        script {
          qa.tryNpmRun('run report:all')
        }
      }
    }

    stage('Artifact collection') {
      steps {
        script {
          qa.archiveQaArtifacts()
        }
      }
    }

    stage('Notification') {
      steps {
        script {
          qa.notifyQa()
        }
      }
    }
  }

  post {
    always {
      script {
        if (qa != null && currentBuild.currentResult != 'SUCCESS') {
          qa.tryNpmRun('run report:all')
          qa.archiveQaArtifacts()
          qa.notifyQa()
        }
      }
    }
  }
}
`;
}

export function generateJenkinsfiles(config: QaConfig): void {
  fs.mkdirSync(path.dirname(JENKINSFILE_PATH), { recursive: true });
  fs.writeFileSync(JENKINSFILE_PATH, renderMultibranchJenkinsfile(config), 'utf8');
  fs.writeFileSync(JENKINSFILE_REGRESSION_PATH, renderRegressionJenkinsfile(), 'utf8');
  fs.writeFileSync(JENKINSFILE_PERFORMANCE_PATH, renderPerformanceJenkinsfile(), 'utf8');
}
