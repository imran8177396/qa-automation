import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { resolvePostmanCommand } from '../lib/postman';
import { runCommand } from '../lib/run-command';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { apiStagePassed, parsePostmanReportForSection27 } from '../lib/api/parse-postman-report';
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
  const tokenPresent = Boolean(process.env.QA_API_TOKEN);
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
    'cli,json',
    '--reporter-json-export',
    jsonReport,
  ]);

  const report = readJsonIfExists<PostmanReportLike>(jsonReport);
  const section27 = parsePostmanReportForSection27({
    report,
    config,
    tokenPresent,
  });
  writeJson(path.join(PATHS.reports.postman, 'section-2.7.json'), section27);
  writeTautologicalArtifact(config);

  const comparisonFailed = !apiStagePassed(section27);
  const passed = result.status === 0 && !comparisonFailed;

  writeJson(path.join(PATHS.reports.postman, 'summary.json'), {
    generatedAt: section27.generatedAt,
    collection: PATHS.postmanCollection,
    environment: PATHS.postmanEnvironment,
    resultsFile: jsonReport,
    section27File: path.join(PATHS.reports.postman, 'section-2.7.json'),
    passed,
    postmanCliExitZero: result.status === 0,
    authConfigured: tokenPresent || Boolean(process.env.QA_API_USERNAME),
    auth: section27.auth,
    counts: section27.counts,
    flaggedAssertions: section27.flaggedAssertions,
    note: 'Executed with Postman CLI. expectedStatus comparison lives in section-2.7.json. UNVERIFIED requests are excluded from the pass count. Secrets are not written to disk.',
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
