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

function startFixtureStep(): string {
  return `      - name: Start fixture site
        run: |
          npx tsx scripts/testing/serve-fixture-site.ts 4173 &
          for i in $(seq 1 30); do
            if curl -sf ${FIXTURE_URL}/index.html > /dev/null; then exit 0; fi
            sleep 1
          done
          echo "Fixture did not become ready" >&2
          exit 1`;
}

function reportAndArtifactSteps(): string {
  return `      - name: Generate Allure and combined QA reports
        if: always()
        run: npm run report:all

      - name: Upload Allure report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: allure-report
          path: |
            reports/allure/report/
            reports/allure/results/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Playwright HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: reports/playwright/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Playwright screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-screenshots
          path: |
            test-results/**/*.png
            test-results/**/*.jpg
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright videos
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-videos
          path: |
            test-results/**/*.webm
            test-results/**/*.mp4
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright traces
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/**/*.zip
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright test-results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results
          path: test-results/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Postman reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: postman-report
          path: reports/postman/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload JMeter reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmeter-report
          path: reports/jmeter/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload Lighthouse report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: lighthouse-report
          path: reports/lighthouse/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload final QA summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-final-summary
          path: |
            reports/summary/
            reports/orchestrator/
            reports/coverage/
            reports/performance/
          if-no-files-found: ignore
          retention-days: 30`;
}

export function renderGithubCiWorkflow(config: QaConfig): string {
  const branches = yamlBranches(config.github.branches);
  const prTrigger = config.github.runOnPullRequest
    ? `  pull_request:
    branches:
${branches}
`
    : '';

  return `name: QA CI (Pull Request)

# Lightweight PR checks only. Does NOT run qa:all (visual + 3-engine cross-browser + full pipeline).
# Does NOT run heavy JMeter (load / stress / spike / soak). Never --authorize-heavy.
# Full suite: qa-regression.yml. Authorized heavy load: qa-performance-heavy.yml.

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

      - name: TypeScript check
        run: npm run typecheck

      - name: Sync configs from qa.config.json
        run: npm run qa:sync

${recordSecretAvailabilityStep()}

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

${startFixtureStep()}

      - name: Discovery
        run: npm run discover -- ${FIXTURE_URL}/

      - name: Run Playwright E2E tests
        run: npm run test:e2e

      - name: Run Postman API tests
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:api

      - name: Run accessibility tests
        run: npm run test:accessibility

${javaJmeterSteps()}

      - name: Run JMeter liveness performance tests
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
        run: npm run test:performance -- --profile=liveness

${reportAndArtifactSteps()}
`;
}

export function renderGithubRegressionWorkflow(config: QaConfig): string {
  const branches = yamlBranches(config.github.branches);

  return `name: QA Regression

# Full suite via npm run qa:all. Not a pull_request workflow (too heavy for every PR).
# Triggers: push to protected branches, weekly schedule, and manual dispatch.
# Still liveness/smoke JMeter only — qa:all strips --authorize-heavy / QA_PERF_AUTHORIZE.

on:
  push:
    branches:
${branches}
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:
    inputs:
      discover_url:
        description: Optional live URL for qa:all --url=. Empty uses the in-repo fixture. Do not put secrets in this field.
        required: false
        type: string

concurrency:
  group: qa-regression-\${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  qa-regression:
    name: Full regression (qa:all)
    timeout-minutes: 90
    runs-on: ubuntu-latest

    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/

    steps:
${checkoutNodeCiSteps()}

      - name: TypeScript check
        run: npm run typecheck

      - name: Sync configs from qa.config.json
        run: npm run qa:sync

${recordSecretAvailabilityStep()}

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox webkit

${javaJmeterSteps()}

      - name: Run full regression
        env:
${yamlSecretEnv(CI_RUNTIME_SECRET_KEYS)}
          QA_DISPATCH_URL: \${{ github.event.inputs.discover_url }}
        run: |
          if [ -n "$QA_DISPATCH_URL" ]; then
            npm run qa:all -- --url="$QA_DISPATCH_URL"
          else
            npm run qa:all
          fi

${reportAndArtifactSteps()}
`;
}

export function renderHeavyPerformanceWorkflow(): string {
  return `name: QA Performance Heavy

# Manual or optional weekly schedule — never pull_request or push.
# workflow_dispatch requires typing authorize-heavy in confirm.
# schedule requires repository variable QA_PERF_AUTHORIZE_SCHEDULE=true.
# allowHeavyAgainst must still allow the API host (currently often empty).
# Never set QA_PERF_AUTHORIZE on the PR CI workflow.

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
        run: npx playwright install --with-deps chromium

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
