import fs from 'fs';
import path from 'path';
import { runSync } from './sync-from-config';
import { runPostman } from './runners/postman';
import { runPlaywright } from './runners/playwright';
import { runJmeter } from './runners/jmeter';
import { loadConfig } from './lib/load-config';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';

interface StepResult {
  name: string;
  tool: string;
  passed: boolean;
  report?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();

  logStep(`${config.project.name} — All Tools Together`);
  console.log('Running Playwright → Postman → JMeter (continues even if one fails)\n');

  await runSync();

  const results: StepResult[] = [];

  if (config.playwright.enabled) {
    const passed = await runPlaywright(config);
    results.push({
      name: 'E2E / UI',
      tool: 'Playwright',
      passed,
      report: PATHS.reports.playwright,
    });
  } else {
    logWarn('Playwright skipped (disabled in qa.config.json).');
  }

  if (config.postman.enabled) {
    const passed = await runPostman(config);
    results.push({
      name: 'API',
      tool: 'Postman CLI',
      passed,
      report: path.join(PATHS.reports.postman, 'report.json'),
    });
  } else {
    logWarn('Postman skipped (disabled in qa.config.json).');
  }

  if (config.jmeter.enabled) {
    const passed = await runJmeter(config);
    results.push({
      name: 'Performance',
      tool: 'JMeter',
      passed,
      report: path.join(PATHS.reports.jmeter, 'html'),
    });
  } else {
    logWarn('JMeter skipped (disabled in qa.config.json).');
  }

  logStep('QA Summary');
  console.log('');
  console.log('Tool          | Area          | Result  | Report');
  console.log('--------------|---------------|---------|------------------');

  for (const result of results) {
    const status = result.passed ? 'PASS ✓' : 'FAIL ✗';
    const reportPath = result.report && fs.existsSync(result.report)
      ? result.report
      : result.report ?? 'n/a';
    console.log(
      `${result.tool.padEnd(13)} | ${result.name.padEnd(13)} | ${status.padEnd(7)} | ${reportPath}`
    );
  }

  console.log('');

  const summaryPath = path.join(PATHS.reports.root, 'summary.json');
  fs.mkdirSync(PATHS.reports.root, { recursive: true });
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8'
  );
  logSuccess(`Combined summary saved to ${summaryPath}`);

  try {
    if (config.report?.enabled !== false && config.report?.autoGenerateAfterTests !== false) {
      const { generateQaReportDocx } = await import('./generate-qa-report.js');
      const { docxPath, pdfPath, htmlPath, timestamp, model } = await generateQaReportDocx();
      logSuccess(`Enterprise QA report (${timestamp}) — status ${model.meta.overallStatus}`);
      logSuccess(`Word: ${docxPath}`);
      if (htmlPath) logSuccess(`HTML: ${htmlPath}`);
      if (pdfPath) logSuccess(`PDF:  ${pdfPath}`);
    } else {
      logWarn('Combined Word report skipped (disabled in qa.config.json report settings).');
    }
  } catch (error) {
    logWarn(`Could not generate combined Word report: ${String(error)}`);
  }

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    logError(`${failed.length} tool(s) failed: ${failed.map((r) => r.tool).join(', ')}`);
    process.exit(1);
  }

  logSuccess('All tools passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
