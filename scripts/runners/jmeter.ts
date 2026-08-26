import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { runCommand } from '../lib/run-command';
import type { QaConfig } from '../types';

function resolveJmeterCommand(): string | null {
  if (process.env.JMETER_HOME) {
    const candidate = path.join(
      process.env.JMETER_HOME,
      'bin',
      process.platform === 'win32' ? 'jmeter.bat' : 'jmeter'
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const fromPath = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['jmeter'],
    { encoding: 'utf8' }
  );

  if (fromPath.status === 0 && fromPath.stdout.trim()) {
    return fromPath.stdout.trim().split('\n')[0];
  }

  return null;
}

export async function runJmeter(config: QaConfig): Promise<boolean> {
  if (!config.jmeter.enabled) {
    logWarn('JMeter step skipped (disabled in qa.config.json).');
    return true;
  }

  const jmeterCommand = resolveJmeterCommand();
  if (!jmeterCommand) {
    logWarn(
      'JMeter not found. Install JMeter and add it to PATH, or set JMETER_HOME. Skipping load test.'
    );
    return true;
  }

  logStep('Load tests (JMeter CLI)');

  fs.mkdirSync(PATHS.reports.jmeter, { recursive: true });

  const resultFile = path.join(PATHS.reports.jmeter, 'results.jtl');
  const htmlReportDir = path.join(PATHS.reports.jmeter, 'html');

  if (fs.existsSync(resultFile)) {
    fs.rmSync(resultFile, { force: true });
  }

  if (fs.existsSync(htmlReportDir)) {
    fs.rmSync(htmlReportDir, { recursive: true, force: true });
  }

  const result = runCommand(jmeterCommand, [
    '-n',
    '-t',
    PATHS.jmeterPlan,
    '-l',
    resultFile,
    '-e',
    '-o',
    htmlReportDir,
  ]);

  if (result.status === 0) {
    logSuccess(`JMeter load test completed — report: ${htmlReportDir}`);
    return true;
  }

  return false;
}
