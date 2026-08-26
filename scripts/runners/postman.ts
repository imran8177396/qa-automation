import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { runCommand, runLocalBin } from '../lib/run-command';
import type { QaConfig } from '../types';

function resolvePostmanCommand(): string {
  const localPostman = path.join(
    PATHS.root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'postman.cmd' : 'postman'
  );

  if (fs.existsSync(localPostman)) {
    return localPostman;
  }

  const fromPath = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['postman'],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );

  if (fromPath.status === 0 && fromPath.stdout.trim()) {
    return fromPath.stdout.trim().split('\n')[0];
  }

  return localPostman;
}

export async function runPostman(config: QaConfig): Promise<boolean> {
  if (!config.postman.enabled) {
    logWarn('Postman step skipped (disabled in qa.config.json).');
    return true;
  }

  logStep('API tests (Postman CLI)');

  fs.mkdirSync(PATHS.reports.postman, { recursive: true });

  const jsonReport = path.join(PATHS.reports.postman, 'report.json');
  const result = runCommand(resolvePostmanCommand(), [
    'collection',
    'run',
    PATHS.postmanCollection,
    '-e',
    PATHS.postmanEnvironment,
    '-r',
    'cli,json',
    '--reporter-json-export',
    jsonReport,
  ]);

  if (result.status === 0) {
    logSuccess(`Postman API tests passed — report: ${jsonReport}`);
    return true;
  }

  return false;
}
