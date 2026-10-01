import type { QaConfig } from '../types';
import { resolveApiUrl } from '../orchestrator/resolve-url';
import { gatePerformanceRun, isHeavyAuthorized } from './authorize';
import { resolveJmeterPlanPath } from './plans';
import { PERFORMANCE_PROFILES, type CanonicalPerformanceProfile, type PerformanceProfile } from './types';

export interface ResolvedProfile {
  id: CanonicalPerformanceProfile;
  heavy: boolean;
  target: string;
  /** `api` = documented API; `website` = liveness fallback against the URL under test. */
  targetSource: 'api' | 'website';
  /** Origin (scheme + host[:port]) the plan requests. Empty when unresolved. */
  baseUrl: string;
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

/** Parse an http(s) website URL into origin + request path (query/hash dropped). */
function parseWebsiteTarget(websiteUrl: string | undefined): { origin: string; path: string } | null {
  const raw = websiteUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { origin: url.origin, path: url.pathname || '/' };
  } catch {
    return null;
  }
}

function buildResolvedProfile(
  config: QaConfig,
  id: CanonicalPerformanceProfile,
  websiteUrl?: string
): ResolvedProfile {
  const api = resolveApiUrl({ apiUrl: config.urls.api });
  // Liveness only: when no API URL is documented, ping the website under test.
  // Heavy profiles never fall back — they need a documented, authorized API host.
  const website = !api && isLivenessProfile(id) ? parseWebsiteTarget(websiteUrl) : null;
  const targetSource: 'api' | 'website' = website ? 'website' : 'api';
  const baseUrl = website ? website.origin : api;
  const requestPath = website ? website.path : config.jmeter.path;
  let host = '';
  try {
    host = baseUrl ? new URL(baseUrl).host : '';
  } catch {
    host = baseUrl;
  }

  const plan = planNumbers(config, id);

  return {
    id,
    heavy: !isLivenessProfile(id),
    target: baseUrl ? `${baseUrl}${requestPath}` : requestPath,
    targetSource,
    baseUrl,
    host,
    method: 'GET',
    path: requestPath,
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
  options?: { authorizeHeavy?: boolean; websiteUrl?: string }
): PerformanceProfileDecision;
export function resolvePerformanceProfile(
  a: QaConfig | string,
  b?: PerformanceProfile | QaConfig,
  c?: { authorizeHeavy?: boolean; websiteUrl?: string }
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

  const resolved = buildResolvedProfile(config, mapped.id, c?.websiteUrl);
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

  const apiUrl = resolved.baseUrl;
  if (!apiUrl || !resolved.host) {
    return {
      ok: false,
      requested,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: no documented API URL (set QA_API_URL or qa.config.json urls.api) and no website URL under test to run liveness against. Refusing to run JMeter against a missing host — no public demo API is substituted.',
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
