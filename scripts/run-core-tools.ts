import { runSync } from './sync-from-config';
import { runPlaywright } from './runners/playwright';
import { runPostman } from './runners/postman';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { writeProfessionalSqaReport } from './reporting/write-enterprise-report';
import { cleanRunArtifacts, shouldKeepArtifacts } from './lib/clean-run-artifacts';

async function main(): Promise<void> {
  const config = loadConfig();
  logStep(`${config.project.name} — Core tools (Playwright + Postman + JMeter)`);
  if (shouldKeepArtifacts()) {
    logWarn('Keeping previous run artifacts (--keep-artifacts)');
  } else {
    logStep('Cleaning previous test artifacts and cache');
    const { removed } = cleanRunArtifacts();
    logSuccess(
      removed.length === 0
        ? 'No previous run artifacts were present'
        : `Removed ${removed.length} previous artifact path(s)`
    );
  }
  await runSync();

  const results = [
    { name: 'Playwright', passed: config.playwright.enabled ? await runPlaywright(config) : true },
    { name: 'Postman', passed: config.postman.enabled ? await runPostman(config) : true },
    { name: 'JMeter', passed: config.jmeter.enabled ? await runJmeter(config) : true },
    { name: 'Lighthouse', passed: await runLighthouse(config) },
  ];

  if (config.report?.enabled !== false && config.report?.autoGenerateAfterTests !== false) {
    await writeProfessionalSqaReport();
  } else {
    logWarn('Professional SQA report skipped (disabled in qa.config.json report settings).');
  }

  const failed = results.filter((row) => !row.passed);
  if (failed.length > 0) {
    logError(`Failed: ${failed.map((row) => row.name).join(', ')}`);
    process.exit(1);
  }
  logSuccess('Core tools completed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
