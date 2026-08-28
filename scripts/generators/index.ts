import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import type { QaConfig } from '../types';
import { buildPostmanTestScript, resolveAssertions } from './postman-tests';

export function generateEnvFile(config: QaConfig): void {
  const lines = [
    `QA_PROJECT_NAME=${config.project.name}`,
    `QA_WEBSITE_URL=${config.urls.website}`,
    `QA_API_URL=${config.urls.api}`,
    `QA_LOGIN_URL=${config.urls.login}`,
    `QA_CONTACT_LIST_URL=${config.urls.contactList ?? `${config.urls.website}/contactList`}`,
    `QA_SIGNUP_URL=${config.urls.signup ?? `${config.urls.website}/addUser`}`,
    `QA_USERNAME=${config.credentials.username}`,
    `QA_PASSWORD=${config.credentials.password}`,
    `QA_PLAYWRIGHT_BASE_URL=${config.playwright.baseURL}`,
    `QA_PLAYWRIGHT_BROWSERS=${resolvePlaywrightBrowsers(config.playwright).join(',')}`,
    `QA_PLAYWRIGHT_HEADLESS=${config.playwright.headless}`,
  ];

  fs.mkdirSync(path.dirname(PATHS.generatedEnv), { recursive: true });
  fs.writeFileSync(PATHS.generatedEnv, `${lines.join('\n')}\n`, 'utf8');
}

export function generatePostmanFiles(config: QaConfig): void {
  const collection = {
    info: {
      _postman_id: 'qa-automation-api-collection',
      name: config.postman.collectionName,
      description: `Auto-generated from qa.config.json for ${config.project.name}.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: config.postman.requests.map((request) => {
      const assertions = resolveAssertions(request, config.postman.assertions);

      return {
        name: request.name,
        event: [
          {
            listen: 'test',
            script: {
              exec: buildPostmanTestScript(assertions),
              type: 'text/javascript',
            },
          },
        ],
        request: {
          method: request.method,
          header: [],
          url: {
            raw: `{{baseUrl}}${request.path}`,
            host: ['{{baseUrl}}'],
            path: request.path.replace(/^\//, '').split('/'),
          },
          description: `${request.method} ${request.path}`,
        },
        response: [],
      };
    }),
    variable: [
      {
        key: 'baseUrl',
        value: config.urls.api,
        type: 'string',
      },
    ],
  };

  const environment = {
    id: 'qa-automation-api-env',
    name: `${config.postman.collectionName} - Local`,
    values: [
      {
        key: 'baseUrl',
        value: config.urls.api,
        type: 'default',
        enabled: true,
      },
    ],
    _postman_variable_scope: 'environment',
  };

  fs.mkdirSync(path.dirname(PATHS.postmanCollection), { recursive: true });
  const collectionJson = `${JSON.stringify(collection, null, 2)}\n`;
  const environmentJson = `${JSON.stringify(environment, null, 2)}\n`;

  fs.writeFileSync(PATHS.postmanCollection, collectionJson, 'utf8');
  fs.writeFileSync(PATHS.postmanEnvironment, environmentJson, 'utf8');

  fs.mkdirSync(path.dirname(PATHS.postmanExport), { recursive: true });
  fs.writeFileSync(PATHS.postmanExport, collectionJson, 'utf8');
  fs.writeFileSync(PATHS.postmanExportEnvironment, environmentJson, 'utf8');
}

export function generateReportsFolders(): void {
  for (const folder of Object.values(PATHS.reports)) {
    fs.mkdirSync(folder, { recursive: true });
    const keepFile = path.join(folder, '.gitkeep');
    if (!fs.existsSync(keepFile)) {
      fs.writeFileSync(keepFile, '', 'utf8');
    }
  }
}

export function generateJmeterPlan(config: QaConfig): void {
  const host = new URL(config.urls.api).hostname;
  const protocol = new URL(config.urls.api).protocol.replace(':', '');
  const pathValue = config.jmeter.path.startsWith('/')
    ? config.jmeter.path
    : `/${config.jmeter.path}`;

  const jmx = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${config.project.name} Load Test" enabled="true">
      <stringProp name="TestPlan.comments">Auto-generated from qa.config.json</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">${config.jmeter.loopCount}</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${config.jmeter.threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${config.jmeter.rampUpSeconds}</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <boolProp name="ThreadGroup.delayedStart">false</boolProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="GET ${pathValue}" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
          <stringProp name="HTTPSampler.domain">${host}</stringProp>
          <stringProp name="HTTPSampler.port"></stringProp>
          <stringProp name="HTTPSampler.protocol">${protocol}</stringProp>
          <stringProp name="HTTPSampler.path">${pathValue}</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Response Assertion" enabled="true">
            <collectionProp name="Asserion.test_strings">
              <stringProp name="49586">200</stringProp>
            </collectionProp>
            <stringProp name="Assertion.custom_message"></stringProp>
            <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
            <boolProp name="Assertion.assume_success">false</boolProp>
            <intProp name="Assertion.test_type">8</intProp>
          </ResponseAssertion>
          <hashTree/>
        </hashTree>
        <ResultCollector guiclass="SummaryReport" testclass="ResultCollector" testname="Summary Report" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>true</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;

  fs.mkdirSync(path.dirname(PATHS.jmeterPlan), { recursive: true });
  fs.writeFileSync(PATHS.jmeterPlan, jmx, 'utf8');
}

export function generateGithubWorkflow(config: QaConfig): void {
  const branches = config.github.branches.map((branch) => `      - ${branch}`).join('\n');
  const prTrigger = config.github.runOnPullRequest
    ? `  pull_request:
    branches:
${branches}`
    : '';
  const browsers = resolvePlaywrightBrowsers(config.playwright).join(' ');

  const workflow = `name: QA Automation

on:
  push:
    branches:
${branches}
${prTrigger}

jobs:
  qa-automation:
    timeout-minutes: 60
    runs-on: ubuntu-latest

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

      - name: Run Playwright E2E tests
        run: npm run test:e2e

      - name: Run Postman API tests
        run: npm run test:api

      - name: Install JMeter
        run: |
          JMETER_VERSION=5.6.3
          curl -sL "https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-\${JMETER_VERSION}.tgz" | tar xz
          echo "JMETER_HOME=$PWD/apache-jmeter-\${JMETER_VERSION}" >> $GITHUB_ENV
          echo "$PWD/apache-jmeter-\${JMETER_VERSION}/bin" >> $GITHUB_PATH

      - name: Run JMeter performance tests
        run: npm run test:performance

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: reports/playwright/
          retention-days: 30

      - name: Upload Postman report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: postman-report
          path: reports/postman/
          retention-days: 30

      - name: Upload JMeter report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmeter-report
          path: reports/jmeter/
          retention-days: 30
`;

  const workflowPath = path.join(PATHS.root, '.github', 'workflows', 'qa-automation.yml');
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(workflowPath, workflow, 'utf8');
}
