import { PATHS } from '../lib/paths';
import type { QaConfig } from '../types';
import { PERFORMANCE_PROFILES, type CanonicalPerformanceProfile, type PerformanceProfile } from './types';

export interface ResolvedProfile {
  id: CanonicalPerformanceProfile;
  heavy: boolean;
  target: string;
  host: string;
  method: string;
  path: string;
  planPath: string;
  threads: number;
  rampUpSeconds: number;
  loopCount: number;
  durationSeconds?: number;
}

export function isLivenessProfile(profile: string | undefined | null): boolean {
  return profile === 'liveness' || profile === 'smoke';
}

export function normalizePerformanceProfile(profile: string | undefined | null): CanonicalPerformanceProfile {
  if (profile === 'smoke' || profile == null || profile === '') return 'liveness';
  if ((PERFORMANCE_PROFILES as readonly string[]).includes(profile)) {
    return profile as CanonicalPerformanceProfile;
  }
  throw new Error(`Unknown performance profile "${profile}". Use: ${PERFORMANCE_PROFILES.join(', ')} (smoke is an alias of liveness).`);
}

export function resolvePerformanceProfile(config: QaConfig, profile: PerformanceProfile): ResolvedProfile {
  const id = normalizePerformanceProfile(profile);
  const api = config.urls.api;
  let host = 'unknown';
  try {
    host = new URL(api).host;
  } catch {
    host = api;
  }

  const named =
    config.jmeter.profiles?.[id] ??
    (id === 'liveness' ? config.jmeter.profiles?.smoke : undefined);

  const plan = named ?? {
    threads: config.jmeter.threads,
    rampUpSeconds: config.jmeter.rampUpSeconds,
    loopCount: config.jmeter.loopCount,
  };

  return {
    id,
    heavy: !isLivenessProfile(id),
    target: `${api}${config.jmeter.path}`,
    host,
    method: 'GET',
    path: config.jmeter.path,
    planPath: PATHS.jmeterPlan,
    threads: plan.threads,
    rampUpSeconds: plan.rampUpSeconds,
    loopCount: plan.loopCount,
    durationSeconds: 'durationSeconds' in plan ? plan.durationSeconds : undefined,
  };
}
