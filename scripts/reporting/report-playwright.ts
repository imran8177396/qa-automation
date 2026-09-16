import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { localBinPath, runCommand } from '../lib/run-command';
import { listPlaywrightHtmlReports, toPosixRelative } from '../lib/report-kinds';
import { writeJson } from '../discovery/write-json';
import path from 'path';

export interface PlaywrightHtmlIndex {
  generatedAt: string;
  suites: Array<{ suite: string; indexFile: string }>;
  primary?: string;
}

export function indexPlaywrightHtmlReports(): PlaywrightHtmlIndex {
  const suites = listPlaywrightHtmlReports(PATHS.reports.playwright).map((row) => ({
    suite: row.suite,
    indexFile: row.indexFile,
  }));
  const primary = suites.find((row) => row.suite === 'e2e')?.indexFile ?? suites[0]?.indexFile;
  const document: PlaywrightHtmlIndex = {
    generatedAt: new Date().toISOString(),
    suites,
    primary,
  };
  writeJson(path.join(PATHS.reports.summary, 'playwright-html-index.json'), document);
  return document;
}

function main(): void {
  logStep('Playwright HTML report paths');
  const index = indexPlaywrightHtmlReports();
  if (index.suites.length === 0) {
    logWarn(`No Playwright HTML reports under ${toPosixRelative(PATHS.reports.playwright)}/<suite>/html/index.html`);
    return;
  }
  for (const suite of index.suites) {
    logSuccess(`${suite.suite}: ${suite.indexFile}`);
  }
  if (index.primary) {
    console.log(`Primary: ${index.primary}`);
    console.log(`Open with: npx playwright show-report ${path.posix.dirname(index.primary)}`);
  }
  if (process.argv.includes('--open') && index.primary) {
    const htmlDir = path.join(PATHS.root, path.dirname(index.primary));
    runCommand(localBinPath('playwright'), ['show-report', htmlDir]);
  }
}

if (require.main === module) {
  main();
}
