/** Named environments only — no invented URLs or network I/O. */
export const ENVIRONMENT_MANAGEMENT_STATUS = 'PARTIAL' as const;

export const QA_ENVIRONMENT_NAMES = ['local', 'development', 'staging', 'production'] as const;

export type QaEnvironmentName = (typeof QA_ENVIRONMENT_NAMES)[number];

export const DEFAULT_ENVIRONMENT: QaEnvironmentName = 'development';

export interface ResolveEnvironmentInput {
  /** Value from `--env=<name>`. */
  cli?: string | null;
  /** Value from `QA_ENVIRONMENT`. */
  env?: string | null;
  /** `config.environment.active` when present. */
  config?: { active?: string } | null;
}

export interface DestructiveFlags {
  /**
   * Production is never implicitly authorized. Must be explicitly true from the
   * caller (does not read process.env secrets).
   */
  allowProduction?: boolean;
  /**
   * Optional explicit destructive allow for local/development/staging only.
   * Ignored for production unless allowProduction is also true.
   */
  allowDestructive?: boolean;
}

/** Per-environment endpoint overrides. Empty strings are valid; never invent hosts. */
export interface EnvironmentEndpoints {
  websiteUrl?: string;
  apiUrl?: string;
}

/** Optional `qa.config.json` `environments` map keyed by known environment names. */
export type EnvironmentsConfig = Partial<Record<QaEnvironmentName, EnvironmentEndpoints>>;

export interface ResolveEnvironmentEndpointsInput {
  /** Active environment name (typically `environment.active`). */
  active?: string | null;
  /** Optional map from `qa.config.json` `environments`. */
  environments?: EnvironmentsConfig | null;
  /** Existing `urls.website` fallback. */
  fallbackWebsite?: string | null;
  /** Existing `urls.api` fallback. */
  fallbackApi?: string | null;
}

export interface ResolvedEnvironmentEndpoints {
  websiteUrl: string;
  apiUrl: string;
}

export type ProductionAction =
  | 'destructive'
  | 'heavy-performance'
  | 'chaos-resilience'
  | 'data-mutation';

/**
 * Explicit authorization flags — same meaning as engine gates:
 * - `authorizeDestructive` ↔ `QA_RESILIENCE_AUTHORIZE` / `--authorize-destructive`
 * - `authorizeHeavy` ↔ `QA_PERF_AUTHORIZE` / `--authorize-heavy`
 * - `authorizeDataMutation` — seed/cleanup; must also have authorizeDestructive on production
 *
 * Defaults are all false. Missing flags are false.
 * Non-production `{ allowed: true }` is planning-only — each engine still applies its own flags.
 */
export interface ProductionActionFlags {
  authorizeDestructive?: boolean;
  authorizeHeavy?: boolean;
  authorizeDataMutation?: boolean;
}

export interface ProductionActionResult {
  allowed: boolean;
  production: boolean;
  blockedByEnvironment: boolean;
  /** Present when blocked — never mapped to PASS. */
  status?: 'BLOCKED';
  reason: string;
}

function isEnvironmentName(value: string): value is QaEnvironmentName {
  return (QA_ENVIRONMENT_NAMES as readonly string[]).includes(value);
}

function nonEmptyString(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** True only for non-empty http(s) URLs — never invent hosts. */
function isNonEmptyHttpUrl(value: string | undefined | null): boolean {
  const trimmed = nonEmptyString(value);
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve active environment: `--env` → `QA_ENVIRONMENT` → `config.environment.active` → `development`.
 * Unknown name throws (REQUIRES_CONFIGURATION). Does not invent URLs.
 * `"production"` is never an authorization to run destructive tests.
 */
export function resolveEnvironment(input: ResolveEnvironmentInput = {}): QaEnvironmentName {
  const candidates = [input.cli, input.env, input.config?.active];
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (!isEnvironmentName(value)) {
      throw new Error(
        `Unknown environment ${JSON.stringify(value)}: expected local | development | staging | production (REQUIRES_CONFIGURATION)`
      );
    }
    return value;
  }
  return DEFAULT_ENVIRONMENT;
}

/**
 * Look up `environments[active]` endpoint overrides.
 * Non-empty http(s) environment URLs win; blank/missing fall back to `urls.*`.
 * Unknown active names are ignored (never treated as production) — fallbacks only.
 * Does not read disk, process.env, or `qa.last-target.json`. Never invents a host.
 */
export function resolveEnvironmentEndpoints(
  input: ResolveEnvironmentEndpointsInput
): ResolvedEnvironmentEndpoints {
  const fallbackWebsite = nonEmptyString(input.fallbackWebsite);
  const fallbackApi = nonEmptyString(input.fallbackApi);

  const activeRaw = nonEmptyString(input.active);
  if (!activeRaw || !isEnvironmentName(activeRaw)) {
    return { websiteUrl: fallbackWebsite, apiUrl: fallbackApi };
  }

  const entry = input.environments?.[activeRaw];
  const websiteUrl = isNonEmptyHttpUrl(entry?.websiteUrl)
    ? nonEmptyString(entry?.websiteUrl)
    : fallbackWebsite;
  const apiUrl = isNonEmptyHttpUrl(entry?.apiUrl)
    ? nonEmptyString(entry?.apiUrl)
    : fallbackApi;

  return { websiteUrl, apiUrl };
}

/**
 * Destructive gates are caller-driven flags only. This function does not read
 * process env secrets and does not launch tests.
 *
 * - production → true only when `allowProduction === true`
 * - local / development / staging → true only when `allowDestructive === true` (still not production)
 */
export function environmentAllowsDestructive(
  environment: QaEnvironmentName,
  flags: DestructiveFlags = {}
): boolean {
  if (environment === 'production') {
    return flags.allowProduction === true;
  }
  return flags.allowDestructive === true;
}

/**
 * Production-gated action check for planning / authorization coordination.
 *
 * Non-production: returns `{ allowed: true, production: false, blockedByEnvironment: false,
 * reason: "not production" }` for planning only. Callers MUST still enforce each engine's
 * own authorize flags (`QA_PERF_AUTHORIZE`, `QA_RESILIENCE_AUTHORIZE`, etc.) — this helper
 * does not skip or replace those gates.
 *
 * Production: requires the matching explicit flag(s). Unauthorized → BLOCKED (never PASS).
 * Does not run chaos, seed, cleanup, or heavy performance.
 */
export function productionActionAllowed(
  action: ProductionAction,
  environment: QaEnvironmentName,
  flags: ProductionActionFlags = {}
): ProductionActionResult {
  if (environment !== 'production') {
    return {
      allowed: true,
      production: false,
      blockedByEnvironment: false,
      reason: 'not production',
    };
  }

  const authorizeDestructive = flags.authorizeDestructive === true;
  const authorizeHeavy = flags.authorizeHeavy === true;
  const authorizeDataMutation = flags.authorizeDataMutation === true;

  switch (action) {
    case 'destructive': {
      if (authorizeDestructive) {
        return {
          allowed: true,
          production: true,
          blockedByEnvironment: false,
          reason: 'production destructive authorized',
        };
      }
      return {
        allowed: false,
        production: true,
        blockedByEnvironment: true,
        status: 'BLOCKED',
        reason: 'production destructive requires explicit authorization',
      };
    }
    case 'heavy-performance': {
      // authorizeHeavy alone — allowHeavyAgainst is not sufficient by itself.
      if (authorizeHeavy) {
        return {
          allowed: true,
          production: true,
          blockedByEnvironment: false,
          reason: 'production heavy-performance authorized',
        };
      }
      return {
        allowed: false,
        production: true,
        blockedByEnvironment: true,
        status: 'BLOCKED',
        reason: 'production heavy-performance requires explicit authorization',
      };
    }
    case 'chaos-resilience': {
      // Same flag as destructive; chaos runner is not implemented — do not start one.
      if (authorizeDestructive) {
        return {
          allowed: true,
          production: true,
          blockedByEnvironment: false,
          reason: 'production chaos/resilience authorized (execution not implemented)',
        };
      }
      return {
        allowed: false,
        production: true,
        blockedByEnvironment: true,
        status: 'BLOCKED',
        reason: 'production chaos/resilience requires explicit authorization',
      };
    }
    case 'data-mutation': {
      if (authorizeDataMutation && authorizeDestructive) {
        return {
          allowed: true,
          production: true,
          blockedByEnvironment: false,
          reason: 'production data mutation authorized',
        };
      }
      return {
        allowed: false,
        production: true,
        blockedByEnvironment: true,
        status: 'BLOCKED',
        reason: 'production data mutation requires explicit authorization',
      };
    }
    default: {
      const _exhaustive: never = action;
      return {
        allowed: false,
        production: true,
        blockedByEnvironment: true,
        status: 'BLOCKED',
        reason: `unknown production action: ${String(_exhaustive)}`,
      };
    }
  }
}
