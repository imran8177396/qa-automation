import path from 'path';
import { PATHS } from '../lib/paths';
import type { CanonicalPerformanceProfile } from './types';

/** Folder names under tests/performance/jmeter/. Liveness lives in `smoke/` (alias). */
export const JMETER_PROFILE_FOLDERS: Record<CanonicalPerformanceProfile, string> = {
  liveness: 'smoke',
  load: 'load',
  stress: 'stress',
  spike: 'spike',
  soak: 'soak',
};

export const HEAVY_PERFORMANCE_PROFILES: readonly CanonicalPerformanceProfile[] = [
  'load',
  'stress',
  'spike',
  'soak',
];

export const JMETER_PLAN_FILE_NAME = 'documented-api.jmx';

export function jmeterPlansRoot(): string {
  return path.join(PATHS.root, 'tests', 'performance', 'jmeter');
}

export function jmeterProfileDir(profile: CanonicalPerformanceProfile): string {
  return path.join(jmeterPlansRoot(), JMETER_PROFILE_FOLDERS[profile]);
}

export function resolveJmeterPlanPath(profile: CanonicalPerformanceProfile): string {
  return path.join(jmeterProfileDir(profile), JMETER_PLAN_FILE_NAME);
}

export function relativeJmeterPlanPath(profile: CanonicalPerformanceProfile): string {
  return path.relative(PATHS.root, resolveJmeterPlanPath(profile)).replace(/\\/g, '/');
}
