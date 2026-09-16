import fs from 'fs';
import { findOnPath, localBinPath } from './run-command';

const ALLURE_CLI_HINT =
  'Install the project dependency allure-commandline (npm) or add the allure binary to PATH. allure-commandline also requires a Java JRE.';

export function allureCliHint(): string {
  return ALLURE_CLI_HINT;
}

/** Local node_modules/.bin/allure, then PATH. Does not invent a report. */
export function resolveAllureCommand(): string | null {
  const localAllure = localBinPath('allure');
  if (fs.existsSync(localAllure)) {
    return localAllure;
  }
  return findOnPath('allure');
}
