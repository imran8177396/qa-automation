import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import type { QaConfig } from '../types';

export const CI_WORKFLOW_PATH = path.join(PATHS.root, '.github', 'workflows', 'qa-automation.yml');
export const HEAVY_WORKFLOW_PATH = path.join(PATHS.root, '.github', 'workflows', 'qa-performance-heavy.yml');

/** GitHub Secrets mapped into the CI job. Never commit values — use .env.example as documentation only. */
export const CI_SECRET_KEYS = [
  'QA_WEBSITE_URL',
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

function secretEnvBlock(): string {
  return CI_SECRET_KEYS.map((key) => `          ${key}: \${{ secrets.${key} }}`).join('\n');
}

export function renderGithubCiWorkflow(config: QaConfig): string {
  const branches = yamlBranches(config.github.branches);
  const prTrigger = config.github.runOnPullRequest
    ? `  pull_request:
    branches:
${branches}`
    : '';
  const browsers = resolvePlaywrightBrowsers(config.playwright).join(' ');

  return `name: QA Automation

on:
  push:
    branches:
${branches}
${prTrigger}
  workflow_dispatch:

permissions:
  contents: read

jobs:
  qa-automation:
    timeout-minutes: 90
    runs-on: ubuntu-latest

    env:
      QA_PLAYWRIGHT_BASE_URL: ${FIXTURE_URL}
      QA_WEBSITE_URL: ${FIXTURE_URL}/

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: TypeScript check
        run: npm run typecheck

      - name: Sync configs from qa.config.json
        run: npm run qa:sync

      - name: Install Playwright browsers
        run: npx playwright install --with-deps ${browsers}

      - name: Start fixture site
        run: |
          npx tsx scripts/testing/serve-fixture-site.ts 4173 &
          for i in $(seq 1 30); do
            if curl -sf ${FIXTURE_URL}/index.html > /dev/null; then exit 0; fi
            sleep 1
          done
          echo "Fixture did not become ready" >&2
          exit 1

      - name: Discovery
        run: npm run discover -- ${FIXTURE_URL}/

      - name: Run Playwright E2E tests
        run: npm run test:e2e

      - name: Run Postman API tests
        env:
${secretEnvBlock()}
        run: npm run test:api

      - name: Run accessibility tests
        run: npm run test:accessibility

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Install JMeter
        run: |
          JMETER_VERSION=5.6.3
          curl -sL "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-\${JMETER_VERSION}.tgz" | tar xz
          echo "JMETER_HOME=$PWD/apache-jmeter-\${JMETER_VERSION}" >> "$GITHUB_ENV"
          echo "$PWD/apache-jmeter-\${JMETER_VERSION}/bin" >> "$GITHUB_PATH"

      - name: Run JMeter liveness performance tests
        env:
${secretEnvBlock()}
        run: npm run test:performance -- --profile=liveness

      - name: Generate final QA report
        if: always()
        run: npm run report:final

      - name: Upload Playwright report
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
          path: test-results/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Playwright traces
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
          if-no-files-found: ignore
          retention-days: 14

      - name: Upload Postman report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: postman-report
          path: reports/postman/
          if-no-files-found: ignore
          retention-days: 30

      - name: Upload JMeter report
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
          if-no-files-found: ignore
          retention-days: 30
`;
}

export function renderHeavyPerformanceWorkflow(): string {
  return `name: QA Performance Heavy

# Manual only — never runs on push or pull_request.
# Type authorize-heavy in the confirm input to proceed.

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

permissions:
  contents: read

jobs:
  heavy:
    name: Authorized heavy performance
    if: \${{ inputs.confirm == 'authorize-heavy' }}
    timeout-minutes: 90
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Install dependencies
        run: npm ci

      - name: Sync configs
        run: npm run qa:sync

      - name: Install JMeter
        run: |
          JMETER_VERSION=5.6.3
          curl -sL "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-\${JMETER_VERSION}.tgz" | tar xz
          echo "JMETER_HOME=$PWD/apache-jmeter-\${JMETER_VERSION}" >> "$GITHUB_ENV"
          echo "$PWD/apache-jmeter-\${JMETER_VERSION}/bin" >> "$GITHUB_PATH"

      - name: Run authorized heavy profile
        env:
          QA_WEBSITE_URL: \${{ secrets.QA_WEBSITE_URL }}
          QA_API_URL: \${{ secrets.QA_API_URL }}
        run: npm run test:performance -- --profile=\${{ inputs.profile }} --authorize-heavy

      - name: Upload JMeter reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmeter-heavy-\${{ inputs.profile }}
          path: reports/jmeter/
          if-no-files-found: ignore
          retention-days: 14
`;
}

export function generateGithubWorkflow(config: QaConfig): void {
  fs.mkdirSync(path.dirname(CI_WORKFLOW_PATH), { recursive: true });
  fs.writeFileSync(CI_WORKFLOW_PATH, renderGithubCiWorkflow(config), 'utf8');
  fs.writeFileSync(HEAVY_WORKFLOW_PATH, renderHeavyPerformanceWorkflow(), 'utf8');
}
