import fs from 'fs';
import { PATHS } from './paths';
import type { QaConfig } from '../types';

export function loadConfig(): QaConfig {
  const raw = fs.readFileSync(PATHS.config, 'utf8');
  return JSON.parse(raw) as QaConfig;
}
