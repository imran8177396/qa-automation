import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { allureCliHint, resolveAllureCommand } from '../lib/allure-cli';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { captureCommand } from '../lib/run-command';
import {
  allocateAllureHistoryDir,
  allureResultsPresent,
  shouldArchiveAllureReport,
  toPosixRelative,
} from '../lib/report-kinds';

export type AllureGenerateStatus = 'PRESENT' | 'NOT_EXECUTED' | 'BLOCKED';

export interface AllureGenerateResult {
  status: AllureGenerateStatus;
  attempted: boolean;
  command?: string;
  stdout: string;
  stderr: string;
  archivedTo?: string;
  reportDir: string;
  resultsDir: string;
  indexHtml?: string;
  reason?: string;
}

function archiveExistingAllureReport(): string | undefined {
  if (!shouldArchiveAllureReport(PATHS.allureReport)) return undefined;
  fs.mkdirSync(PATHS.allureHistory, { recursive: true });
  const dest = allocateAllureHistoryDir(PATHS.allureHistory);
  fs.cpSync(PATHS.allureReport, dest, { recursive: true });
  return toPosixRelative(dest);
}

export function generateAllureReport(): AllureGenerateResult {
  const reportDir = PATHS.allureReport;
  const resultsDir = PATHS.allureResults;
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const empty: Omit<AllureGenerateResult, 'status' | 'attempted' | 'reason'> = {
    stdout: '',
    stderr: '',
    reportDir,
    resultsDir,
  };

  if (!allureResultsPresent(resultsDir)) {
    return {
      ...empty,
      status: 'NOT_EXECUTED',
      attempted: false,
      reason:
        'No Allure results under reports/allure/results. Run Playwright with the allure-playwright reporter first.',
    };
  }

  const command = resolveAllureCommand();
  if (!command) {
    return {
      ...empty,
      status: 'BLOCKED',
      attempted: false,
      reason: `Allure CLI was not found. ${allureCliHint()}`,
    };
  }

  const archivedTo = archiveExistingAllureReport();
  logStep('Generating Allure HTML report');
  if (archivedTo) {
    logSuccess(`Previous Allure HTML archived to ${archivedTo}`);
  }

  const args = ['generate', resultsDir, '-o', reportDir, '--clean'];
  const captured = captureCommand(command, args);
  const stdout = captured.stdout.trim();
  const stderr = captured.stderr.trim();
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);

  const indexHtml = path.join(reportDir, 'index.html');
  if (captured.status === 0 && fs.existsSync(indexHtml)) {
    logSuccess(`Allure report: ${toPosixRelative(indexHtml)}`);
    return {
      status: 'PRESENT',
      attempted: true,
      command: `${command} ${args.join(' ')}`,
      stdout,
      stderr,
      archivedTo,
      reportDir,
      resultsDir,
      indexHtml,
    };
  }

  const reason = `Allure generate failed (exit ${captured.status ?? 'null'}). index.html missing. ${
    stderr || stdout || allureCliHint()
  }`;
  logError(reason);
  return {
    status: 'BLOCKED',
    attempted: true,
    command: `${command} ${args.join(' ')}`,
    stdout,
    stderr,
    archivedTo,
    reportDir,
    resultsDir,
    reason,
  };
}

function main(): void {
  const result = generateAllureReport();
  if (result.status === 'PRESENT') {
    process.exit(0);
  }
  if (result.status === 'NOT_EXECUTED') {
    logWarn(result.reason ?? 'Allure report NOT_EXECUTED');
    process.exit(0);
  }
  logError(result.reason ?? 'Allure report BLOCKED');
  process.exit(1);
}

if (require.main === module) {
  main();
}
