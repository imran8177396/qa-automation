import type { QaConfig } from '../types';
import { resolveApiUrl } from '../orchestrator/resolve-url';
import { gatePerformanceRun, isHeavyAuthorized } from './authorize';
import { resolveJmeterPlanPath } from './plans';
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

/** Gate statuses returned when a requested profile must not launch JMeter. */
export type PerformanceProfileGateStatus = 'NOT_TESTED' | 'BLOCKED' | 'REQUIRES_CONFIGURATION';

export type PerformanceProfileDecision =
  | {
      ok: true;
      requested: string;
      resolved: ResolvedProfile;
      authorized: boolean;
    }
  | {
      ok: false;
      requested: string;
      status: PerformanceProfileGateStatus;
      reason: string;
      id: CanonicalPerformanceProfile | null;
      heavy: boolean;
      authorized: boolean;
      /** Plan numbers when the request mapped to a known profile; omitted for volume/scalability/unknown. */
      resolved: ResolvedProfile | null;
    };

export type ProfileAliasMapResult =
  | { mapped: true; id: CanonicalPerformanceProfile }
  | { mapped: false; status: 'NOT_TESTED'; reason: string };

export function isLivenessProfile(profile: string | undefined | null): boolean {
  return profile === 'liveness' || profile === 'smoke' || profile === 'baseline';
}

/**
 * Map a requested profile token to a JMeter plan id.
 * baseline → liveness; endurance → soak; smoke → liveness.
 * volume / scalability / unknown → NOT_TESTED (no invented JMX).
 */
export function mapPerformanceProfileAlias(requested: string | undefined | null): ProfileAliasMapResult {
  const key = (requested ?? '').trim().toLowerCase();
  if (!key || key === 'smoke' || key === 'baseline' || key === 'liveness') {
    return { mapped: true, id: 'liveness' };
  }
  if (key === 'endurance') {
    return { mapped: true, id: 'soak' };
  }
  if (key === 'volume' || key === 'scalability') {
    return {
      mapped: false,
      status: 'NOT_TESTED',
      reason: 'volume/scalability profile is not implemented',
    };
  }
  if ((PERFORMANCE_PROFILES as readonly string[]).includes(key)) {
    return { mapped: true, id: key as CanonicalPerformanceProfile };
  }
  return {
    mapped: false,
    status: 'NOT_TESTED',
    reason: `Unknown performance profile "${requested}". Use: baseline, liveness/smoke, load, stress, spike, endurance (soak), volume, scalability.`,
  };
}

export function normalizePerformanceProfile(profile: string | undefined | null): CanonicalPerformanceProfile {
  const mapped = mapPerformanceProfileAlias(profile);
  if (mapped.mapped) return mapped.id;
  throw new Error(
    `Unknown performance profile "${profile}". Use: ${PERFORMANCE_PROFILES.join(', ')} (smoke/baseline → liveness; endurance → soak).`
  );
}

function planNumbers(config: QaConfig, id: CanonicalPerformanceProfile): {
  threads: number;
  rampUpSeconds: number;
  loopCount: number;
  durationSeconds?: number;
} {
  const named =
    config.jmeter.profiles?.[id] ??
    (id === 'liveness' ? config.jmeter.profiles?.smoke : undefined);

  return (
    named ?? {
      threads: config.jmeter.threads,
      rampUpSeconds: config.jmeter.rampUpSeconds,
      loopCount: config.jmeter.loopCount,
    }
  );
}

function buildResolvedProfile(config: QaConfig, id: CanonicalPerformanceProfile): ResolvedProfile {
  const api = resolveApiUrl({ apiUrl: config.urls.api });
  let host = '';
  try {
    host = api ? new URL(api).host : '';
  } catch {
    host = api;
  }

  const plan = planNumbers(config, id);

  return {
    id,
    heavy: !isLivenessProfile(id),
    target: api ? `${api}${config.jmeter.path}` : config.jmeter.path,
    host,
    method: 'GET',
    path: config.jmeter.path,
    planPath: resolveJmeterPlanPath(id),
    threads: plan.threads,
    rampUpSeconds: plan.rampUpSeconds,
    loopCount: plan.loopCount,
    durationSeconds: 'durationSeconds' in plan ? plan.durationSeconds : undefined,
  };
}

/**
 * Whether `tests.performance.<profile>.enabled` allows a direct request.
 * Liveness/baseline/smoke are not gated by those flags. Missing `tests` → allowed.
 */
export function isPerformanceProfileEnabledInTests(
  config: QaConfig,
  id: CanonicalPerformanceProfile
): boolean {
  const perf = config.tests?.performance;
  if (!perf) return true;
  if (id === 'load') return perf.load.enabled;
  if (id === 'stress') return perf.stress.enabled;
  if (id === 'spike') return perf.spike.enabled;
  if (id === 'soak') return perf.endurance.enabled;
  return true;
}

function disabledReason(): string {
  return 'profile disabled in tests.performance';
}

/**
 * Resolve a requested performance profile name to a plan + gate decision.
 * Does not launch JMeter and never fabricates metrics.
 *
 * Overload: `(config, profile)` keeps the prior plan-only resolver used by sync/plans.
 */
export function resolvePerformanceProfile(config: QaConfig, profile: PerformanceProfile): ResolvedProfile;
export function resolvePerformanceProfile(
  requested: string,
  config: QaConfig,
  options?: { authorizeHeavy?: boolean }
): PerformanceProfileDecision;
export function resolvePerformanceProfile(
  a: QaConfig | string,
  b?: PerformanceProfile | QaConfig,
  c?: { authorizeHeavy?: boolean }
): ResolvedProfile | PerformanceProfileDecision {
  if (typeof a !== 'string') {
    const id = normalizePerformanceProfile(b as PerformanceProfile);
    return buildResolvedProfile(a, id);
  }

  const requested = a;
  const config = b as QaConfig;
  const authorizeHeavy = Boolean(c?.authorizeHeavy);
  const mapped = mapPerformanceProfileAlias(requested);

  if (!mapped.mapped) {
    return {
      ok: false,
      requested,
      status: mapped.status,
      reason: mapped.reason,
      id: null,
      heavy: false,
      authorized: false,
      resolved: null,
    };
  }

  const resolved = buildResolvedProfile(config, mapped.id);
  const authorized = isHeavyAuthorized(mapped.id, { authorizeHeavy });

  if (!isPerformanceProfileEnabledInTests(config, mapped.id)) {
    return {
      ok: false,
      requested,
      status: 'NOT_TESTED',
      reason: disabledReason(),
      id: mapped.id,
      heavy: resolved.heavy,
      authorized,
      resolved,
    };
  }

  const apiUrl = resolveApiUrl({ apiUrl: config.urls.api });
  if (!apiUrl || !resolved.host) {
    return {
      ok: false,
      requested,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: no documented API URL (set QA_API_URL or qa.config.json urls.api). Refusing to run JMeter against a missing host — no public demo API is substituted.',
      id: mapped.id,
      heavy: resolved.heavy,
      authorized,
      resolved,
    };
  }

  const gate = gatePerformanceRun({
    profile: mapped.id,
    apiUrl,
    authorizeHeavy,
    allowHeavyAgainst: config.jmeter.allowHeavyAgainst ?? [],
  });

  if (!gate.ok) {
    return {
      ok: false,
      requested,
      status: 'BLOCKED',
      reason: gate.message,
      id: mapped.id,
      heavy: resolved.heavy,
      authorized: gate.code !== 'NOT_AUTHORIZED',
      resolved,
    };
  }

  return {
    ok: true,
    requested,
    resolved,
    authorized: true,
  };
}
