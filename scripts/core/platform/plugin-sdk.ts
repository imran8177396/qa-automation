/**
 * Plugin SDK interfaces — documented TypeScript contracts only.
 * Does not switch run-all to plugins. Does not ship a sample plugin that runs tests.
 *
 * Tool adapters (Playwright, Postman, JMeter, …) live in adapters.ts and use the
 * Adapter* types below. The core never imports those tool SDKs.
 */

/**
 * Engine plugin: optional third-party test engine entry.
 * Callers register and invoke; the orchestrator does not auto-load these into qa:all.
 */
export interface TestEnginePlugin {
  /** Stable plugin id (must match config entry id when loaded). */
  id: string;
  /** Execute the plugin. Return value is opaque to the registry. */
  run: () => Promise<unknown> | unknown;
}

/**
 * Discovery adapter: produce discoverable targets without network unless the caller opts in.
 */
export interface DiscoveryAdapter {
  id: string;
  discover: () => Promise<unknown> | unknown;
}

/**
 * Assertion plugin: evaluate a caller-supplied check and return a status-like result.
 */
export interface AssertionPlugin {
  id: string;
  check: (input: unknown) => Promise<unknown> | unknown;
}

/**
 * Reporter plugin: write a report artifact from a caller-supplied payload.
 */
export interface ReporterPlugin {
  id: string;
  write: (payload: unknown) => Promise<unknown> | unknown;
}

/** Union of supported plugin interface shapes. */
export type AnyPlatformPlugin =
  | TestEnginePlugin
  | DiscoveryAdapter
  | AssertionPlugin
  | ReporterPlugin;

// ---------------------------------------------------------------------------
// Tool adapter contract (core stays tool-agnostic — no SDK imports)
// ---------------------------------------------------------------------------

/** Fixed built-in adapter ids. Future adapters use any other non-empty string id. */
export const BUILTIN_ADAPTER_IDS = [
  'playwright',
  'postman',
  'jmeter',
  'database',
  'contract',
  'queue',
  'ai',
] as const;

export type BuiltinAdapterId = (typeof BUILTIN_ADAPTER_IDS)[number];

/** Built-in or future registered adapter id. */
export type AdapterId = BuiltinAdapterId | (string & {});

/**
 * Availability probe result. Probes must not execute tests or spawn tools.
 *
 * Availability rules (honest outcomes only):
 * - requires-configuration — the chosen adapter needs a user-supplied setting that
 *   is missing from the snapshot (baseURL, browser binary flag, Postman CLI /
 *   collection, JMeter binary / plan, DATABASE_URL, contract spec path, …).
 * - blocked — cannot execute even with config (not implemented, driver not
 *   installed, adapter not wired). Examples: database not wired, AI not
 *   implemented, Kafka/Redis/RabbitMQ drivers absent, contract runner not invoked.
 * - available — probe says the tool *could* run; run() still must not fake PASS
 *   without an execute stub that actually returned a real result.
 */
export type AdapterAvailabilityState = 'available' | 'requires-configuration' | 'blocked';

export interface AdapterAvailability {
  state: AdapterAvailabilityState;
  /** Required when state is requires-configuration or blocked. */
  reason?: string;
}

/**
 * Caller-supplied flags only — never invent paths/URLs.
 * Unit tests pass explicit snapshots; probes must not shell out.
 */
export interface AdapterToolSnapshot {
  /** Playwright: resolved base URL string when configured. */
  baseURL?: string;
  /** Playwright: true only when the caller affirms a browser binary is present. */
  browserBinaryPresent?: boolean;
  /** Postman: true when the Postman CLI (or newman) is marked present. */
  postmanCliPresent?: boolean;
  /** Postman: true when a collection path is marked present. */
  collectionPathPresent?: boolean;
  /** JMeter: true when the JMeter binary is marked present. */
  jmeterBinaryPresent?: boolean;
  /** JMeter: true when a .jmx plan path is marked present. */
  planPathPresent?: boolean;
  /** Database: true when DATABASE_URL (or equivalent) is marked present. */
  databaseUrlPresent?: boolean;
  /** Contract: true when a contract/OpenAPI/spec path is marked present. */
  contractSpecPathPresent?: boolean;
  /**
   * Queue backend hint. `generic` = in-memory only (may be available).
   * kafka | redis | rabbitmq stay blocked when drivers are not installed.
   */
  queueKind?: 'generic' | 'kafka' | 'redis' | 'rabbitmq';
}

/** Statuses adapters may return. Never remap BLOCKED / REQUIRES_CONFIGURATION / NOT_TESTED to PASS. */
export type AdapterResultStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'SKIPPED'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_APPLICABLE';

export interface AdapterRunResult {
  adapterId: AdapterId;
  status: AdapterResultStatus;
  /** Required for BLOCKED, NOT_TESTED, REQUIRES_CONFIGURATION. */
  reason?: string;
  /**
   * Only true when status is PASS and an execute stub (or real runner) supplied that outcome.
   * Default / unavailable paths must not set passed:true.
   */
  passed?: boolean;
  /** Optional npm script this adapter would invoke when wired (documentation only). */
  npmScript?: string;
}

export interface AdapterRunRequest {
  adapterId: AdapterId;
  /**
   * Explicit availability snapshot from the caller. When omitted, the adapter's
   * probe(snapshot) runs — still without executing tests.
   */
  availability?: AdapterAvailability;
  /** Tool/config flags for the probe. Do not invent values. */
  snapshot?: AdapterToolSnapshot;
  /**
   * Optional execute stub. The only way default adapters return PASS/FAIL:
   * the stub must run and return a real result. Absent while available → BLOCKED
   * "execution was not performed" (never fake PASS). Adapters never shell out
   * on the default path.
   */
  execute?: () => Promise<AdapterRunResult> | AdapterRunResult;
}

/**
 * Registered adapter definition. registerAdapter does not execute.
 * Core holds a Map of these — no switch that imports each tool SDK.
 */
export interface AdapterDefinition {
  id: AdapterId;
  /** Probe without executing tests or spawning processes. */
  probe: (snapshot?: AdapterToolSnapshot) => AdapterAvailability;
  /** Run using availability + optional execute stub. Default path never shells out. */
  run: (request: AdapterRunRequest) => Promise<AdapterRunResult> | AdapterRunResult;
  /** npm script name this adapter would invoke when callers wire execution. */
  npmScript?: string;
  description?: string;
}
