import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { generateAllureReport } from './generate-allure-report';
import { indexPlaywrightHtmlReports } from './report-playwright';
import { generateFinalQaReport } from './generate-final-report';
import { writeFallbackCombinedReport, writeReportIndex } from './build-report-index';
import { toPosixRelative } from '../lib/report-kinds';
import { PATHS } from '../lib/paths';

export async function generateAllReports(): Promise<{
  allureStatus: string;
  kinds: Array<{ id: string; status: string }>;
}> {
  logStep('Combined professional reports (Allure + Playwright + existing tools + final)');
  const allure = generateAllureReport();
  if (allure.status === 'NOT_EXECUTED') {
    logWarn(allure.reason ?? 'Allure NOT_EXECUTED');
  } else if (allure.status === 'BLOCKED') {
    logError(allure.reason ?? 'Allure BLOCKED');
  }

  const playwright = indexPlaywrightHtmlReports();
  if (playwright.suites.length === 0) {
    logWarn('Playwright HTML report NOT_EXECUTED — no suite html/index.html on disk.');
  } else {
    logSuccess(`Playwright HTML indexed (${playwright.suites.length} suite(s))`);
  }

  const allureIndex = {
    status: allure.status,
    reason: allure.reason,
    indexFile: allure.indexHtml ? toPosixRelative(allure.indexHtml) : undefined,
    archivedTo: allure.archivedTo,
  };

  try {
    await generateFinalQaReport();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logError(`Professional combined report pack failed; writing artifact index without inventing results. ${reason}`);
    writeFallbackCombinedReport(reason);
  }

  const index = writeReportIndex(allureIndex);

  logSuccess(`JSON summary: ${toPosixRelative(PATHS.reportIndexJson)}`);
  logSuccess(`Raw index: ${toPosixRelative(PATHS.reportRawIndexMd)}`);
  for (const kind of index.kinds) {
    console.log(`  ${kind.id}: ${kind.status}${kind.indexFile ? ` (${kind.indexFile})` : ''}`);
  }

  return {
    allureStatus: allure.status,
    kinds: index.kinds.map((row) => ({ id: row.id, status: row.status })),
  };
}

async function main(): Promise<void> {
  const result = await generateAllReports();
  const allure = result.kinds.find((row) => row.id === 'allure');
  if (allure?.status === 'BLOCKED') {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
