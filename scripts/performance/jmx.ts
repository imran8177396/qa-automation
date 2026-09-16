import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';
import { PERFORMANCE_PROFILES, type CanonicalPerformanceProfile } from './types';
import { JMETER_PLAN_FILE_NAME, jmeterProfileDir } from './plans';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface JmeterPlanRenderInput {
  projectName: string;
  apiUrl: string;
  requestPath: string;
  profile: CanonicalPerformanceProfile;
  threads: number;
  rampUpSeconds: number;
  loopCount: number;
  durationSeconds?: number;
}

export function documentedApiTarget(apiUrl: string, requestPath: string): { host: string; protocol: string; path: string } {
  const api = new URL(apiUrl);
  const pathValue = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return {
    host: api.hostname,
    protocol: api.protocol.replace(':', ''),
    path: pathValue,
  };
}

export function renderJmeterPlan(input: JmeterPlanRenderInput): string {
  const target = documentedApiTarget(input.apiUrl, input.requestPath);
  const forever = input.loopCount < 0;
  const scheduled = input.durationSeconds != null && input.durationSeconds > 0;
  const heavyNote =
    input.profile === 'liveness'
      ? 'Safe liveness/smoke profile. CI may run this plan. Status is RECORDED, never PASS.'
      : 'HEAVY profile. Do not run unless --authorize-heavy or QA_PERF_AUTHORIZE is set. Not a CI default.';

  const comments = [
    'Auto-generated from qa.config.json.',
    `Documented API only: ${input.apiUrl}${target.path}.`,
    'Not a Sauce Demo REST plan — discovery found 0 XHR on the login page; do not invent that API.',
    `Profile: ${input.profile}. ${heavyNote}`,
  ].join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${escapeXml(input.projectName)} ${escapeXml(input.profile)} API" enabled="true">
      <stringProp name="TestPlan.comments">${escapeXml(comments)}</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${escapeXml(input.profile)} Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">${forever ? 'true' : 'false'}</boolProp>
          <stringProp name="LoopController.loops">${input.loopCount}</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${input.threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${input.rampUpSeconds}</stringProp>
        <boolProp name="ThreadGroup.scheduler">${scheduled ? 'true' : 'false'}</boolProp>
        <stringProp name="ThreadGroup.duration">${scheduled ? String(input.durationSeconds) : ''}</stringProp>
        <boolProp name="ThreadGroup.delayedStart">false</boolProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="GET ${escapeXml(target.path)}" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
          <stringProp name="HTTPSampler.domain">${escapeXml(target.host)}</stringProp>
          <stringProp name="HTTPSampler.port"></stringProp>
          <stringProp name="HTTPSampler.protocol">${escapeXml(target.protocol)}</stringProp>
          <stringProp name="HTTPSampler.path">${escapeXml(target.path)}</stringProp>
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
}

export function planInputFromConfig(config: QaConfig, profile: CanonicalPerformanceProfile): JmeterPlanRenderInput {
  const named =
    config.jmeter.profiles?.[profile] ??
    (profile === 'liveness' ? config.jmeter.profiles?.smoke : undefined);
  const plan = named ?? {
    threads: config.jmeter.threads,
    rampUpSeconds: config.jmeter.rampUpSeconds,
    loopCount: config.jmeter.loopCount,
  };
  return {
    projectName: config.project.name,
    apiUrl: config.urls.api,
    requestPath: config.jmeter.path,
    profile,
    threads: plan.threads,
    rampUpSeconds: plan.rampUpSeconds,
    loopCount: plan.loopCount,
    durationSeconds: 'durationSeconds' in plan ? plan.durationSeconds : undefined,
  };
}

export function writeJmeterProfilePlans(config: QaConfig): string[] {
  const written: string[] = [];
  for (const profile of PERFORMANCE_PROFILES) {
    const xml = renderJmeterPlan(planInputFromConfig(config, profile));
    const dir = jmeterProfileDir(profile);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, JMETER_PLAN_FILE_NAME);
    fs.writeFileSync(filePath, xml, 'utf8');
    written.push(filePath);
  }

  const livenessXml = renderJmeterPlan(planInputFromConfig(config, 'liveness'));
  fs.mkdirSync(path.dirname(PATHS.jmeterPlan), { recursive: true });
  fs.writeFileSync(PATHS.jmeterPlan, livenessXml, 'utf8');
  written.push(PATHS.jmeterPlan);
  return written;
}

