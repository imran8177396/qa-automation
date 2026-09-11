import fs from 'fs';
import path from 'path';
import { findOnPath } from './run-command';

export function resolveJmeterCommand(): string | null {
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

  return findOnPath('jmeter');
}
