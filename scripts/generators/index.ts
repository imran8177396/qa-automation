import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import type { PostmanRequestConfig, QaConfig } from '../types';
import { readExistingSeedUrl, isLoopbackUrl } from '../orchestrator/resolve-url';
import { buildPostmanTestScript, resolveAssertions } from './postman-tests';

export { generateGithubWorkflow } from './github-workflow';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveWebsiteUrl(config: QaConfig): string {
  const seed = readExistingSeedUrl();
  if (seed) return seed.endsWith('/') ? seed : `${seed}/`;
  if (config.playwright.baseURL && isLoopbackUrl(config.playwright.baseURL)) {
    const base = config.playwright.baseURL.replace(/\/+$/, '');
    return `${base}/`;
  }
  return config.urls.website;
}

function resolvePlaywrightBaseUrl(config: QaConfig): string {
  const seed = readExistingSeedUrl();
  if (seed) return seed.replace(/\/+$/, '');
  return config.playwright.baseURL.replace(/\/+$/, '');
}

export function generateEnvFile(config: QaConfig): void {
  const websiteUrl = resolveWebsiteUrl(config);
  const lines = [
    `QA_PROJECT_NAME=${config.project.name}`,
    `QA_WEBSITE_URL=${websiteUrl}`,
    `QA_API_URL=${config.urls.api}`,
  ];

  if (config.urls.login) {
    lines.push(`QA_LOGIN_URL=${config.urls.login}`);
  }
  if (config.credentials) {
    lines.push(`QA_USERNAME=${config.credentials.username}`);
    lines.push(`QA_PASSWORD=${config.credentials.password}`);
  }

  lines.push(
    `QA_PLAYWRIGHT_BASE_URL=${resolvePlaywrightBaseUrl(config)}`,
    `QA_PLAYWRIGHT_BROWSERS=${resolvePlaywrightBrowsers(config.playwright).join(',')}`,
    `QA_PLAYWRIGHT_HEADLESS=${config.playwright.headless}`
  );

  fs.mkdirSync(path.dirname(PATHS.generatedEnv), { recursive: true });
  fs.writeFileSync(PATHS.generatedEnv, `${lines.join('\n')}\n`, 'utf8');
}

function requestDescription(request: PostmanRequestConfig): string {
  const parts = [
    `${request.method} ${request.path}${request.kind ? ` (${request.kind})` : ''}`,
    `expectedStatus=${request.expectedStatus ?? (request.reachableFromNavigation ? '200 (nav default)' : 'UNVERIFIED')}`,
  ];
  if (request.assertionFlags?.length) {
    for (const flag of request.assertionFlags) {
      parts.push(`FLAG ${flag.assertion}: ${flag.flags.join(', ')} — ${flag.note}`);
    }
  }
  if (request.skipReason) parts.push(request.skipReason);
  return parts.join('\n');
}

export function generatePostmanFiles(config: QaConfig): void {
  const activeRequests = config.postman.requests.filter((request) => request.enabled !== false);

  const collection = {
    info: {
      _postman_id: 'qa-automation-api-collection',
      name: config.postman.collectionName,
      description: `Auto-generated from qa.config.json for ${config.project.name}. Authentication/authorization are recorded as NOT_EXECUTED when QA_API_TOKEN is absent — they are not duplicate GET / collection items.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      ...activeRequests.map((request) => {
        const assertions = resolveAssertions(request, config.postman.assertions);
        const headers = Object.entries(request.headers ?? {}).map(([key, value]) => ({ key, value }));
        const query = Object.entries(request.query ?? {}).map(([key, value]) => ({ key, value }));
        const querySuffix =
          query.length > 0 ? `?${query.map((entry) => `${entry.key}=${entry.value}`).join('&')}` : '';

        return {
          name: request.name,
          event: [
            {
              listen: 'test',
              script: {
                exec: buildPostmanTestScript(assertions, {
                  method: request.method,
                  path: request.path,
                  assertionFlags: request.assertionFlags,
                }),
                type: 'text/javascript',
              },
            },
          ],
          request: {
            method: request.method,
            header: headers,
            body:
              request.body != null
                ? {
                    mode: 'raw',
                    raw: JSON.stringify(request.body, null, 2),
                    options: { raw: { language: 'json' } },
                  }
                : undefined,
            url: {
              raw: `{{baseUrl}}${request.path}${querySuffix}`,
              host: ['{{baseUrl}}'],
              path: request.path.replace(/^\//, '').split('/'),
              query,
            },
            description: requestDescription(request),
          },
          response: [],
        };
      }),
    ],
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
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${escapeXml(config.project.name)} Load Test" enabled="true">
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
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="GET ${escapeXml(pathValue)}" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
          <stringProp name="HTTPSampler.domain">${escapeXml(host)}</stringProp>
          <stringProp name="HTTPSampler.port"></stringProp>
          <stringProp name="HTTPSampler.protocol">${escapeXml(protocol)}</stringProp>
          <stringProp name="HTTPSampler.path">${escapeXml(pathValue)}</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
        </HTTPSamplerProxy>
        <hashTree>
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Response Assertion" enabled="true">
            <collectionProp name="Assertion.test_strings">
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

