import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { resolvePostmanCommand } from '../lib/postman';
import { runCommand } from '../lib/run-command';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { apiStagePassed, parsePostmanReportForSection27 } from '../lib/api/parse-postman-report';
import { loadApiDiscoveryProvenance } from '../lib/api/discovery-source';
import { renderApiFindingsHtml, renderApiFindingsMarkdown } from '../lib/api/write-findings';
import type { PostmanReportLike } from '../lib/api/types';
import { writeCrossSuiteReport } from '../lib/quality/cross-suite';
import { writeTautologicalArtifact } from '../lib/quality/tautological-assertions';
import type { QaConfig } from '../types';

function loadRuntimeEnv(): void {
  dotenv.config({ path: path.join(PATHS.root, '.env') });
  if (fs.existsSync(PATHS.generatedEnv)) {
    dotenv.config({ path: PATHS.generatedEnv });
  }
}

export async function runPostman(config: QaConfig): Promise<boolean> {
  if (!config.postman.enabled) {
    logWarn('Postman step skipped (disabled in qa.config.json).');
    return true;
  }

  loadRuntimeEnv();
  logStep('API tests (Postman CLI — no GUI)');

  fs.mkdirSync(PATHS.reports.postman, { recursive: true });
  fs.mkdirSync(PATHS.reports.quality, { recursive: true });

  const jsonReport = path.join(PATHS.reports.postman, 'report.json');
  const junitReport = path.join(PATHS.reports.postman, 'junit.xml');
  const cliHtmlReport = path.join(PATHS.reports.postman, 'cli-report.html');
  const findingsMd = path.join(PATHS.reports.postman, 'findings.md');
  const findingsHtml = path.join(PATHS.reports.postman, 'report.html');
  const tokenPresent = Boolean(process.env.QA_API_TOKEN);
  const usernamePresent = Boolean(process.env.QA_API_USERNAME);
  const passwordPresent = Boolean(process.env.QA_API_PASSWORD);
  const discovery = loadApiDiscoveryProvenance(config.urls.website);

  const result = runCommand(resolvePostmanCommand(), [
    'collection',
    'run',
    PATHS.postmanCollection,
    '-e',
    PATHS.postmanEnvironment,
    '--env-var',
    `baseUrl=${process.env.QA_API_URL || config.urls.api}`,
    '--env-var',
    `apiToken=${process.env.QA_API_TOKEN ?? ''}`,
    '--env-var',
    `apiUsername=${process.env.QA_API_USERNAME ?? ''}`,
    '--env-var',
    `apiPassword=${process.env.QA_API_PASSWORD ?? ''}`,
    '-r',
    'cli,json,junit,html',
    '--reporter-json-export',
    jsonReport,
    '--reporter-junit-export',
    junitReport,
    '--reporter-html-export',
    cliHtmlReport,
  ]);

  const report = readJsonIfExists<PostmanReportLike>(jsonReport);
  const section27 = parsePostmanReportForSection27({
    report,
    config,
    tokenPresent,
    usernamePresent,
    passwordPresent,
    discoveryNote: discovery.note,
  });
  writeJson(path.join(PATHS.reports.postman, 'section-2.7.json'), section27);
  writeTautologicalArtifact(config);
  fs.writeFileSync(findingsMd, renderApiFindingsMarkdown(section27, discovery), 'utf8');
  fs.writeFileSync(findingsHtml, renderApiFindingsHtml(section27, discovery), 'utf8');

  const comparisonFailed = !apiStagePassed(section27);
  const passed = result.status === 0 && !comparisonFailed;

  writeJson(path.join(PATHS.reports.postman, 'summary.json'), {
    generatedAt: section27.generatedAt,
    collection: PATHS.postmanCollection,
    environment: PATHS.postmanEnvironment,
    resultsFile: jsonReport,
    junitFile: junitReport,
    htmlFile: findingsHtml,
    cliHtmlFile: cliHtmlReport,
    findingsFile: findingsMd,
    section27File: path.join(PATHS.reports.postman, 'section-2.7.json'),
    passed,
    postmanCliExitZero: result.status === 0,
    requestSource: 'qa.config.json postman.requests',
    discovery,
    authConfigured: tokenPresent || usernamePresent,
    auth: section27.auth,
    counts: section27.counts,
    flaggedAssertions: section27.flaggedAssertions,
    note: discovery.note,
  });

  writeCrossSuiteReport();

  if (passed) {
    logSuccess(`Postman API tests passed — report: ${jsonReport}`);
    return true;
  }

  if (comparisonFailed) {
    logWarn(
      `API expectedStatus comparison failed (${section27.counts.failed} FAIL). Collection assertions were not flipped. See reports/postman/section-2.7.json.`
    );
  }

  return false;
}
