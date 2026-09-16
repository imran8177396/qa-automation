import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PATHS } from './paths';

let loaded = false;

/**
 * Load `.env` then `config/generated.env`. Local `.env` wins for credentials
 * so generated placeholders cannot clobber QA_USERNAME / QA_PASSWORD.
 */
export function loadRuntimeEnv(): void {
  if (loaded) return;
  loaded = true;

  const generated = PATHS.generatedEnv;
  const local = path.join(PATHS.root, '.env');

  if (fs.existsSync(generated)) {
    dotenv.config({ path: generated });
  }
  if (fs.existsSync(local)) {
    dotenv.config({ path: local, override: true });
  }
}
