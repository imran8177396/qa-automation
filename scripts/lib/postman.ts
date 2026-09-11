import fs from 'fs';
import { findOnPath, localBinPath } from './run-command';

export function resolvePostmanCommand(): string {
  const localPostman = localBinPath('postman');
  if (fs.existsSync(localPostman)) {
    return localPostman;
  }

  return findOnPath('postman') ?? localPostman;
}
