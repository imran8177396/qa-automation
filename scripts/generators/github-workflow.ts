import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';

export const CI_WORKFLOW_PATH = path.join(PATHS.root, '.github', 'workflows', 'qa-automation.yml');
export const REGRESSION_WORKFLOW_PATH = path.join(PATHS.root, '.github', 'workflows', 'qa-regression.yml');
export const HEAVY_WORKFLOW_PATH = path.join(PATHS.root, '.github', 'workflows', 'qa-performance-heavy.yml');

/**
 * Pinned GitHub Actions Node version. Satisfies package.json `engines.node` (>=18)
 * and scripts/preflight.ts MIN_NODE_MAJOR. package.json has no single exact pin.
 */
export const CI_NODE_VERSION = '20';

export const JMETER_VERSION = '5.6.3';

/** GitHub Secrets referenced by name only. Never commit values. */
export const CI_SECRET_KEYS = [
  'QA_WEBSITE_URL',
  'QA_API_URL',
  'QA_USERNAME',
  'QA_PASSWORD',
  'QA_API_TOKEN',
  'QA_API_USERNAME',
  'QA_API_PASSWORD',
] as const;

/** Credentials + documented API URL. Does not override the fixture website origin. */
export const CI_RUNTIME_SECRET_KEYS = [
  'QA_API_URL',
  'QA_USERNAME',
  'QA_PASSWORD',
  'QA_API_TOKEN',
  'QA_API_USERNAME',
  'QA_API_PASSWORD',
] as const;

const FIXTURE_URL = 'http://127.0.0.1:4173';

function yamlBranches(branches: string[]): string {
  return branches.map((branch) => `      - ${branch}`).join('\n');
}

function yamlSecretEnv(keys: readonly string[]): string {
  return keys.map((key) => `          ${key}: \${{ secrets.${key} }}`).join('\n');
}

function recordSecretAvailabilityStep(): string {
  const env = CI_SECRET_KEYS.map((key) => `          ${key}: \${{ secrets.${key} }}`).join('\n');
  const records = CI_SECRET_KEYS.map((key) => `          record ${key} "$${key}"`).join('\n');
  return `      - name: Record repository secret availability
        env:
${env}
        run: |
          record() {
            if [ -z "$2" ]; then
              echo "$1: not configured (auth-dependent checks may be REQUIRES_CONFIGURATION / NOT_TESTED)"
            else
              echo "$1: configured (value not printed)"
            fi
          }
${records}`;
}

function checkoutNodeCiSteps(): string {
  return `      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "${CI_NODE_VERSION}"
          cache: npm

      - name: Install dependencies
        run: npm ci`;
}

function javaJmeterSteps(): string {
  return `      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Install JMeter
        run: |
          JMETER_VERSION=${JMETER_VERSION}
          curl -sL "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-\${JMETER_VERSION}.tgz" | tar xz
          echo "JMETER_HOME=$PWD/apache-jmeter-\${JMETER_VERSION}" >> "$GITHUB_ENV"
          echo "$PWD/apache-jmeter-\${JMETER_VERSION}/bin" >> "$GITHUB_PATH"`;
}

function startFixtureStep(ifCondition?: string): string {
  const ifLine = ifCondition ? `\n        if: \${{ ${ifCondition} }}` : '';
  return `      - name: Start fixture site${ifLine}
        run: |
          npx tsx scripts/testing/serve-fixture-site.ts 4173 &
          for i in $(seq 1 30); do
            if curl -sf ${FIXTURE_URL}/index.html > /dev/null; then exit 0; fi
            sleep 1
          done
          echo "Fixture did not become ready" >&2
          exit 1`;
}

function typecheckAndSyncSteps(): string {
  return `      - name: TypeScript check
        run: npm run typecheck

      - name: Sync configs from qa.config.json
        run: npm run qa:sync`;
}

function installPlaywrightBrowsersStep(): string {
  return `      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox webkit`;
}

function reportAndArtifactSteps(artifactSuffix = ''): string {
  const suffix = artifactSuffix ? `-${artifactSuffix}` : '';
  return `      - name: Generate Allure and combined QA reports
        if: always()
        run: npm run report:all

      - name: Upload Allure report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: allure-report${suffix}
          path: |
            reports/allure/report/
            reports/allure/results/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Playwright HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report${suffix}
          path: reports/playwright/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Playwright screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-screenshots${suffix}
          path: |
            test-results/**/*.png
            test-results/**/*.jpg
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright videos
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-videos${suffix}
          path: |
            test-results/**/*.webm
            test-results/**/*.mp4
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright traces
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces${suffix}
          path: test-results/**/*.zip
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright test-results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results${suffix}
          path: test-results/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Postman reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: postman-report${suffix}
          path: reports/postman/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload JMeter reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmeter-report${suffix}
          path: reports/jmeter/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Lighthouse report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: lighthouse-report${suffix}
          path: reports/lighthouse/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload final QA summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-final-summary${suffix}
          path: |
            reports/summary/
            reports/orchestrator/
            reports/coverage/
            reports/performance/
          if-no-files-found: ignore
          retention-days: 30`;
}

/** PR tier only — unit, smoke, API, critical E2E, accessibility, security-light (+ existing liveness). */
export function renderGithubCiWorkflow(config: QaConfig): string {
  const branches = yamlBranches(config.github.branches);
  const prTrigger = config.github.runOnPullRequest
    ? `  pull_request:
    branches:
${branches}
`
    : '';

  return `name: QA CI (Pull Request)

# PR tier only: unit, smoke, API, critical E2E, accessibility, security-light.
# Does NOT run qa:all. Does NOT run visual / responsive / cross-browser / integration /
# contract / seo / content / regression / AI / resilience / production-verification.
# Does NOT run heavy JMeter (load / stress / spike / soak). Never authorizes heavy profiles.
# Main/regression: qa-regression.yml. Authorized heavy: qa-performance-heavy.yml.
# Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE (not a PR job; no separate chaos runner).

on:
${prTrigger}  workflow_dispatch:

concurrency:
  group: qa-ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  qa-ci:
    name: Lightweight PR CI
    timeout-minutes: 45
    runs-on: ubuntu-latest

    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/

    steps:
${checkoutNodeCiSteps()}

${typecheckAndSyncSteps()}

${recordSecretAvailabilityStep()}

      - name: unit
        run: npm run test:unit

${installPlaywrightBrowsersStep()}

${startFixtureStep()}

      - name: Discovery
        run: npm run discover -- ${FIXTURE_URL}/

      - name: smoke
        run: npm run test:smoke

      - name: critical E2E
        run: npm run test:e2e

      - name: API
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:api

      - name: accessibility
        run: npm run test:accessibility

      # security-light: existing QA security scan (headers/cookies/hygiene), not a pentest.
      - name: security-light
        run: npm run test:security

${javaJmeterSteps()}

      - name: Run JMeter liveness performance tests
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:performance -- --profile=liveness

${reportAndArtifactSteps()}
`;
}

/** Main/regression + schedule-only + manual-authorized jobs. Never pull_request. */
export function renderGithubRegressionWorkflow(config: QaConfig): string {
  const branches = yamlBranches(config.github.branches);

  return `name: QA Regression

# Main / regression tier (push + schedule + dispatch): full E2E, API, integration, contract,
# visual, responsive, accessibility, security, SEO, content, regression.
# Scheduled-only extras: dependencies, compatibility matrix, AI regression, deep security
# (still the existing QA security script — pentest coverage is NOT_IMPLEMENTED).
# Heavy load/stress/soak stay in qa-performance-heavy.yml behind authorize-heavy gates.
# Destructive resilience and production verification require workflow_dispatch inputs
# (default false). Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE — no chaos tool.
# Not a pull_request workflow.

on:
  push:
    branches:
${branches}
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:
    inputs:
      discover_url:
        description: Optional live URL for discovery/tests. Empty uses the in-repo fixture. Do not put secrets in this field.
        required: false
        type: string
      authorize_destructive:
        description: Set true to run destructive resilience (QA_RESILIENCE_AUTHORIZE / --authorize-destructive). Default false. Chaos remains NOT_TESTED.
        required: false
        type: boolean
        default: false
      allow_production:
        description: Set true to run npm run test:production-verification. Default false. Runner still respects tests.productionVerification.enabled.
        required: false
        type: boolean
        default: false

concurrency:
  group: qa-regression-\${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  qa-regression:
    name: Main / regression tier
    timeout-minutes: 90
    runs-on: ubuntu-latest

    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/

    steps:
${checkoutNodeCiSteps()}

${typecheckAndSyncSteps()}

${recordSecretAvailabilityStep()}

${installPlaywrightBrowsersStep()}

      - name: Apply optional discover URL
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.discover_url != '' }}
        env:
          QA_DISPATCH_URL: \${{ inputs.discover_url }}
        run: |
          # Value not printed (may be a non-public host). Fixture origin is replaced for this job only.
          echo "QA_PLAYWRIGHT_BASE_URL=$QA_DISPATCH_URL" >> "$GITHUB_ENV"
          case "$QA_DISPATCH_URL" in
            */) echo "QA_WEBSITE_URL=$QA_DISPATCH_URL" >> "$GITHUB_ENV" ;;
            *) echo "QA_WEBSITE_URL=$QA_DISPATCH_URL/" >> "$GITHUB_ENV" ;;
          esac

${startFixtureStep("github.event_name != 'workflow_dispatch' || inputs.discover_url == ''")}

      - name: Discovery
        run: npm run discover -- "$QA_WEBSITE_URL"

      - name: full E2E
        run: npm run test:e2e

      - name: API
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:api

      - name: integration
        run: npm run test:integration

      - name: contract
        run: npm run test:contract

      - name: visual
        run: npm run test:visual

      - name: responsive
        run: npm run test:responsive

      - name: accessibility
        run: npm run test:accessibility

      - name: security
        run: npm run test:security

      - name: SEO
        run: npm run test:seo

      - name: content
        run: npm run test:content

      - name: regression
        run: npm run test:regression

      # Scheduled tier — not on push. Heavy JMeter is NOT here (see qa-performance-heavy.yml).
      - name: dependency
        if: \${{ github.event_name == 'schedule' }}
        run: npm run test:dependencies

      - name: compatibility matrix
        if: \${{ github.event_name == 'schedule' }}
        run: npm run test:e2e:cross-browser

      - name: AI regression
        if: \${{ github.event_name == 'schedule' }}
        run: npm run test:ai

      # Deep security: pentest coverage is NOT_IMPLEMENTED; this is still the existing QA security script.
      - name: deep security
        if: \${{ github.event_name == 'schedule' }}
        run: npm run test:security

${reportAndArtifactSteps()}

  resilience-authorized:
    name: Destructive resilience (authorized)
    # Chaos is not a separate runner — stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE; no chaos tool.
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.authorize_destructive == true }}
    timeout-minutes: 45
    runs-on: ubuntu-latest
    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/
      QA_RESILIENCE_AUTHORIZE: "true"
    steps:
${checkoutNodeCiSteps()}

${typecheckAndSyncSteps()}

${recordSecretAvailabilityStep()}

${startFixtureStep()}

      - name: Destructive resilience
        run: npm run test:resilience -- --authorize-destructive

${reportAndArtifactSteps('resilience')}

  production-verification:
    name: Production verification (authorized)
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.allow_production == true }}
    timeout-minutes: 45
    runs-on: ubuntu-latest
    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/
    steps:
${checkoutNodeCiSteps()}

${typecheckAndSyncSteps()}

${recordSecretAvailabilityStep()}

      - name: Production verification
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:production-verification

${reportAndArtifactSteps('production')}
`;
}

export function renderHeavyPerformanceWorkflow(): string {
  return `name: QA Performance Heavy

# Manual or optional weekly schedule — never pull_request or push.
# workflow_dispatch requires typing authorize-heavy in confirm.
# schedule requires repository variable QA_PERF_AUTHORIZE_SCHEDULE=true.
# allowHeavyAgainst must still allow the API host (currently often empty).
# Never set QA_PERF_AUTHORIZE on the PR CI workflow.
# Load / stress / endurance (soak) live here only when authorization is satisfied.
# Chaos stays NOT_TESTED until QA_RESILIENCE_AUTHORIZE — not part of this performance job.

on:
  workflow_dispatch:
    inputs:
      profile:
        description: Heavy JMeter profile (not part of normal CI)
        required: true
        type: choice
        options:
          - load
          - stress
          - spike
          - soak
      confirm:
        description: Type authorize-heavy to run. Anything else is refused.
        required: true
        type: string
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  refuse-unauthorized-dispatch:
    name: Refuse unauthorized manual run
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.confirm != 'authorize-heavy' }}
    runs-on: ubuntu-latest
    steps:
      - name: Authorization refused
        run: |
          echo "NOT_AUTHORIZED: type authorize-heavy in the confirm input. The input value is not printed."
          exit 1

  record-schedule-not-authorized:
    name: Record unauthorized schedule
    if: \${{ github.event_name == 'schedule' && vars.QA_PERF_AUTHORIZE_SCHEDULE != 'true' }}
    runs-on: ubuntu-latest
    steps:
      - name: Scheduled heavy run not authorized
        run: |
          echo "NOT_AUTHORIZED: scheduled heavy JMeter did not run. Set Actions variable QA_PERF_AUTHORIZE_SCHEDULE=true after jmeter.allowHeavyAgainst includes the API host."

  heavy:
    name: Authorized heavy performance
    if: \${{ (github.event_name == 'workflow_dispatch' && inputs.confirm == 'authorize-heavy') || (github.event_name == 'schedule' && vars.QA_PERF_AUTHORIZE_SCHEDULE == 'true') }}
    timeout-minutes: 90
    runs-on: ubuntu-latest
    steps:
${checkoutNodeCiSteps()}

${javaJmeterSteps()}

      - name: Sync configs
        run: npm run qa:sync

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox webkit

${recordSecretAvailabilityStep()}

      - name: Run authorized heavy profile
        env:
${yamlSecretEnv(CI_SECRET_KEYS)}
          QA_HEAVY_PROFILE: \${{ github.event_name == 'schedule' && 'load' || inputs.profile }}
        run: npm run test:performance -- --profile="$QA_HEAVY_PROFILE" --authorize-heavy

      - name: Generate Allure and combined QA reports
        if: always()
        run: npm run report:all

      - name: Upload JMeter reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmeter-heavy-\${{ github.event_name == 'schedule' && 'load' || inputs.profile }}
          path: reports/jmeter/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-heavy
          path: reports/playwright/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-screenshots-heavy
          path: |
            test-results/**/*.png
            test-results/**/*.jpg
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright videos
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-videos-heavy
          path: |
            test-results/**/*.webm
            test-results/**/*.mp4
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright traces
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces-heavy
          path: test-results/**/*.zip
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Postman reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: postman-report-heavy
          path: reports/postman/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Allure report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: allure-report-heavy
          path: |
            reports/allure/report/
            reports/allure/results/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload final QA summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-final-summary-heavy
          path: |
            reports/summary/
            reports/orchestrator/
            reports/coverage/
            reports/performance/
            reports/lighthouse/
          if-no-files-found: ignore
          retention-days: 14
`;
}

export function generateGithubWorkflow(config: QaConfig): void {
  fs.mkdirSync(path.dirname(CI_WORKFLOW_PATH), { recursive: true });
  fs.writeFileSync(CI_WORKFLOW_PATH, renderGithubCiWorkflow(config), 'utf8');
  fs.writeFileSync(REGRESSION_WORKFLOW_PATH, renderGithubRegressionWorkflow(config), 'utf8');
  fs.writeFileSync(HEAVY_WORKFLOW_PATH, renderHeavyPerformanceWorkflow(), 'utf8');
}
