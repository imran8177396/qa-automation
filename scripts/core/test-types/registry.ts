import type { TestTypeCategory } from './categories';
import {
  TEST_TYPE_IDS,
  type TestTypeDefinition,
  type TestTypeId,
  type TestTypeImplementationStatus,
} from './types';

function entry(
  id: TestTypeId,
  category: TestTypeCategory,
  name: string,
  description: string,
  status: TestTypeImplementationStatus,
  npmScript: string | null,
  note?: string
): TestTypeDefinition {
  return {
    id,
    category,
    name,
    description,
    status,
    npmScript,
    ...(note ? { note } : {}),
  };
}

/**
 * Centralized test-type registry.
 * Status reflects existing runners/stages and Phase 1–3 engines when those
 * npm scripts are present. Database is PARTIAL (catalog + honest gaps; no
 * wired SQL adapter).
 *
 * Evidence (package.json / qa.config.json jmeter.profiles):
 * - unit, e2e, ui, api, workflow, performance, security, accessibility, visual, responsive
 * - integration / contract / smoke / sanity IMPLEMENTED; database PARTIAL; regression PARTIAL
 * - baseline aliases liveness; load / stress / spike / soak (endurance) exist; heavy ones need authorize-heavy
 * - no volume / scalability load generators
 * - cross-browser = desktop Chromium/Firefox/WebKit emulation
 */
export const TEST_TYPE_REGISTRY: readonly TestTypeDefinition[] = [
  entry(
    'functional',
    'functional',
    'Functional testing',
    'Positive / negative / boundary checks via existing E2E and generated UI stages.',
    'PARTIAL',
    null,
    'No dedicated functional stage — covered by npm run test:e2e and npm run test:ui. UI planning emits scenario inventory rows; unexecuted / gated kinds stay honest.'
  ),
  entry(
    'integration',
    'functional',
    'Integration testing',
    'Service-to-service / HTTP-TCP integration probes.',
    'IMPLEMENTED',
    'test:integration',
    'GET-only probes from tests.integration.checks; disabled by default. Never invents hosts.'
  ),
  entry(
    'contract',
    'functional',
    'Contract testing',
    'Schema/shape contract checks as a dedicated engine.',
    'IMPLEMENTED',
    'test:contract',
    'Uses tests.contract.contracts (or postman.requests when usePostmanRequests true). test:api remains the Postman path.'
  ),
  entry(
    'database',
    'functional',
    'Database testing',
    'Honest catalog of connection / schema / integrity checks; no driver dependency and no invented SQL.',
    'PARTIAL',
    'test:database',
    'Missing DATABASE_URL → REQUIRES_CONFIGURATION; missing driver → BLOCKED/REQUIRES_CONFIGURATION. Even with a URL and driver present, adapters are not wired — checks stay REQUIRES_CONFIGURATION (never a fake connection).'
  ),
  entry(
    'api',
    'functional',
    'API testing',
    'Postman CLI collection generated from qa.config.json postman.requests.',
    'IMPLEMENTED',
    'test:api'
  ),
  entry(
    'ui',
    'functional',
    'UI testing',
    'Discovery-driven non-destructive generated UI checks.',
    'PARTIAL',
    'test:ui',
    'Planning emits a screen/element scenario inventory (positive/negative/edge/validation/security/a11y/workflow) via writePlannedUiChecks. Executable PLANNED rows run in discovery-checks.spec.ts; workflow inference and full WCAG remain NOT_TESTED — not a separate test-generation engine.'
  ),
  entry(
    'e2e',
    'functional',
    'End-to-end testing',
    'Playwright E2E specs against the resolved website target.',
    'IMPLEMENTED',
    'test:e2e'
  ),
  entry(
    'workflow',
    'functional',
    'Workflow testing',
    'Documented UI+API correlated workflows only — never invents endpoints.',
    'IMPLEMENTED',
    'test:workflows'
  ),
  entry(
    'unit',
    'functional',
    'Unit testing',
    'Node.js unit tests under scripts/**/*.test.ts.',
    'IMPLEMENTED',
    'test:unit',
    'Runner: scripts/testing/run-unit-tests.ts.'
  ),
  entry(
    'smoke',
    'functional',
    'Smoke testing',
    'Fast critical-path reachability as a dedicated engine.',
    'IMPLEMENTED',
    'test:smoke',
    'GET-only probes from tests.smoke; never submits forms or credentials. JMeter liveness remains a performance profile.'
  ),
  entry(
    'sanity',
    'functional',
    'Sanity testing',
    'Narrow re-hit of a configured sanity scope.',
    'IMPLEMENTED',
    'test:sanity',
    'GET-only probes from tests.sanity.checks; not regression or retest. Disabled by default.'
  ),
  entry(
    'regression',
    'functional',
    'Regression testing',
    'Selective/full regression runner; v1 defaults to unit only (not qa:all).',
    'PARTIAL',
    'test:regression',
    'change-based and risk-based are not implemented. npm run retest re-runs prior failures — it is not this engine.'
  ),
  entry(
    'performance',
    'performance',
    'Performance testing',
    'UI timing + JMeter liveness via the existing performance stage.',
    'IMPLEMENTED',
    'test:performance',
    'Default profile is liveness/smoke; heavy profiles stay behind authorize-heavy.'
  ),
  entry(
    'baseline',
    'performance',
    'Baseline performance',
    'Safe JMeter baseline — alias of the liveness plan (same threads/ramp/loop).',
    'PARTIAL',
    'test:performance',
    'Alias of liveness/smoke; status is RECORDED, never PASS. Default npm run test:performance still uses liveness.'
  ),
  entry(
    'load',
    'performance',
    'Load testing',
    'JMeter load profile against the documented API.',
    'PARTIAL',
    'test:performance',
    'Profile exists in jmeter.profiles.load; requires --authorize-heavy / QA_PERF_AUTHORIZE; gated by tests.performance.load.enabled.'
  ),
  entry(
    'stress',
    'performance',
    'Stress testing',
    'JMeter stress profile against the documented API.',
    'PARTIAL',
    'test:performance',
    'Profile exists in jmeter.profiles.stress; requires --authorize-heavy / QA_PERF_AUTHORIZE; gated by tests.performance.stress.enabled.'
  ),
  entry(
    'spike',
    'performance',
    'Spike testing',
    'JMeter spike profile against the documented API.',
    'PARTIAL',
    'test:performance',
    'Profile exists in jmeter.profiles.spike; requires --authorize-heavy / QA_PERF_AUTHORIZE; gated by tests.performance.spike.enabled.'
  ),
  entry(
    'endurance',
    'performance',
    'Endurance testing',
    'Long-running soak/endurance load characterization.',
    'PARTIAL',
    'test:performance',
    'Uses the existing soak plan (tests/performance/jmeter/soak/); requires --authorize-heavy / QA_PERF_AUTHORIZE; gated by tests.performance.endurance.enabled.'
  ),
  entry(
    'volume',
    'performance',
    'Volume testing',
    'Large-payload / high-data-volume scenarios.',
    'NOT_IMPLEMENTED',
    null,
    'No JMeter volume plan — requests return NOT_TESTED.'
  ),
  entry(
    'scalability',
    'performance',
    'Scalability testing',
    'Horizontal/vertical scaling characterization.',
    'NOT_IMPLEMENTED',
    null,
    'No JMeter scalability plan — requests return NOT_TESTED.'
  ),
  entry(
    'security',
    'specialized',
    'Security QA',
    'QA-level security baseline (not a pentest).',
    'IMPLEMENTED',
    'test:security'
  ),
  entry(
    'accessibility',
    'specialized',
    'Accessibility testing',
    'Automated axe + keyboard checks.',
    'IMPLEMENTED',
    'test:accessibility'
  ),
  entry(
    'visual',
    'specialized',
    'Visual regression',
    'Playwright screenshot comparison against baselines.',
    'IMPLEMENTED',
    'test:visual'
  ),
  entry(
    'responsive',
    'specialized',
    'Responsive testing',
    'Viewport matrix for layout checks.',
    'IMPLEMENTED',
    'test:responsive'
  ),
  entry(
    'compatibility',
    'specialized',
    'Cross-browser / compatibility',
    'Desktop Chromium, Firefox, and WebKit emulation only; Chrome, Safari, and Edge branded channels are NOT_TESTED.',
    'PARTIAL',
    'test:e2e:cross-browser',
    'Desktop browser emulation only — not real devices or OS/device labs.'
  ),
  entry(
    'localization',
    'specialized',
    'Localization testing',
    'Intl formatter, timezone, and RTL checks via test:localization. Live-page language is REQUIRES_CONFIGURATION until a page URL is configured — never claims a site is translated.',
    'PARTIAL',
    'test:localization',
    'Formatter/timezone checks are implemented; live page locale probing is not.'
  ),
  entry(
    'reliability',
    'resilience',
    'Reliability testing',
    'Safe GET health / timeout / retry / error-handling probes.',
    'PARTIAL',
    'test:reliability',
    'Safe checks exist (service-health, timeout-handling, retry-behavior, error-handling). Destructive fault injection is catalogued as BLOCKED/NOT_TESTED and never executed.'
  ),
  entry(
    'resilience',
    'resilience',
    'Resilience testing',
    'Safe GET dependency / recovery / health probes; fault injection not implemented.',
    'PARTIAL',
    'test:resilience',
    'Safe checks exist. Destructive kinds (failover, chaos, fault-injection, …) stay BLOCKED/NOT_TESTED — never injected.'
  ),
  entry(
    'failover',
    'resilience',
    'Failover testing',
    'Failover path validation.',
    'NOT_IMPLEMENTED',
    null,
    'Catalogued under destructive kinds; no failover injector is implemented.'
  ),
  entry(
    'recovery',
    'resilience',
    'Recovery testing',
    'Safe double-GET recovery observation (no fault injection).',
    'PARTIAL',
    'test:resilience',
    'resilience:recovery performs two GETs only — does not inject the first failure or run restore drills.'
  ),
  entry(
    'deployment',
    'release',
    'Deployment testing',
    'Post-deploy health / readiness / config / verification probes.',
    'PARTIAL',
    'test:deployment',
    'Safe GET checks + requiredEnv name presence. Migration/rollback are catalogued as BLOCKED/NOT_TESTED — never executed.'
  ),
  entry(
    'rollback',
    'release',
    'Rollback testing',
    'Rollback path validation.',
    'NOT_IMPLEMENTED',
    null,
    'Catalogued under deployment:rollback; rollback execution is not implemented.'
  ),
  entry(
    'configuration',
    'release',
    'Configuration testing',
    'Config drift / feature-flag matrix.',
    'NOT_IMPLEMENTED',
    null
  ),
  entry(
    'ai',
    'ai',
    'AI system testing',
    'Optional AI QA engine (npm run test:ai). Not required for web QA; does not run unless enabled and configured.',
    'PARTIAL',
    'test:ai',
    'Optional checks exist under scripts/testing/ai/; disabled by default. Web/e2e/api/jmeter do not import this folder.'
  ),
  entry(
    'llm',
    'ai',
    'LLM testing',
    'Optional LLM-oriented checks via the AI engine. Not required for web QA; does not run unless enabled and configured.',
    'PARTIAL',
    'test:ai',
    'Covered as optional capability rows when tests.ai is enabled — not a separate stage.'
  ),
  entry(
    'rag',
    'ai',
    'RAG testing',
    'Optional RAG-oriented checks via the AI engine. Not required for web QA; does not run unless enabled and configured.',
    'PARTIAL',
    'test:ai',
    'Covered as optional capability rows when tests.ai is enabled — not a separate stage.'
  ),
  entry(
    'agent',
    'ai',
    'Agent testing',
    'Optional agent-oriented checks via the AI engine. Not required for web QA; does not run unless enabled and configured.',
    'PARTIAL',
    'test:ai',
    'Covered as optional capability rows when tests.ai is enabled — not a separate stage.'
  ),
  entry(
    'ai-safety',
    'ai',
    'AI safety testing',
    'Future AI safety status row only. Optional engine; not required for web QA. Not implemented.',
    'NOT_IMPLEMENTED',
    null,
    'Registry/status row only — no evaluation payloads.'
  ),
  entry(
    'prompt-injection',
    'ai',
    'Prompt-injection testing',
    'Future status row only. Optional engine; not required for web QA. Not implemented.',
    'NOT_IMPLEMENTED',
    null,
    'Registry/status row only — no evaluation payloads.'
  ),
  entry(
    'multi-tenant',
    'specialized',
    'Multi-tenant testing',
    'Optional evidence comparison for multi-tenant isolation. Not assumed for every application; compares caller-supplied bodies only — no live tenant API.',
    'PARTIAL',
    'test:multi-tenant',
    'Disabled by default (tests.multiTenant.enabled). Tenant ids come from the caller at runtime — never from committed qa.config.json. Reuses compareTenantIsolation for cross-tenant checks.'
  ),
  entry(
    'webhook',
    'specialized',
    'Webhook testing',
    'Optional, local signature and delivery classification, no live receiver.',
    'PARTIAL',
    'test:webhook',
    'Disabled by default (tests.webhook.enabled). Caller-supplied delivery evidence and secret at runtime — never from committed qa.config.json. No port and no webhook URL.'
  ),
  entry(
    'queue',
    'specialized',
    'Queue / async testing',
    'Generic in-memory classification; Kafka, Redis, and RabbitMQ adapters are not implemented because the drivers are not installed.',
    'PARTIAL',
    'test:queue',
    'Disabled by default (tests.queue.enabled). Caller-supplied messages at runtime — never broker hosts from committed qa.config.json. No broker connection.'
  ),
  entry(
    'property',
    'specialized',
    'Property-based testing',
    'adapter over caller-supplied samples; fast-check is not installed; this is not a property-testing framework',
    'PARTIAL',
    'test:property',
    'Disabled by default (tests.property.enabled). BuiltinSampleAdapter checks caller samples only — no random generation or shrinking. FastCheckAdapter stays unavailable.'
  ),
  entry(
    'mutation',
    'specialized',
    'Mutation testing',
    'optional in-memory mutants and caller-supplied detection; file mutation and suite re-run are not implemented; not part of the default PR suite',
    'PARTIAL',
    'test:mutation',
    'Disabled by default (tests.mutation.enabled). In-memory snippets only — project files are not rewritten and the suite is not re-run.'
  ),
  entry(
    'race',
    'specialized',
    'Race / concurrency testing',
    'architecture + deterministic in-memory model with caller-supplied interleavings; live multi-process races are not executed',
    'PARTIAL',
    'test:race',
    'Disabled by default (tests.race.enabled). Explicit interleavings only — no random schedules, timers, or live concurrency against the application.'
  ),
  entry(
    'backup-restore',
    'specialized',
    'Backup / restore infrastructure testing',
    'optional caller-evidence classification for backup existence, readability, restore success, snapshot consistency, and reconnect; live backup/restore is not executed and production data is never deleted',
    'PARTIAL',
    'test:backup-restore',
    'Disabled by default (tests.backupRestore.enabled). Isolated environments only with an explicit target descriptor — does not take a backup, restore a database, prove a production backup is valid, or delete data.'
  ),
  entry(
    'privacy',
    'specialized',
    'Data privacy testing',
    'optional caller-evidence classification for PII keys, sensitive API fields, secret/password log keys, deletion, retention, and export; live deletion, retention enforcement, and export jobs are not executed',
    'PARTIAL',
    'test:privacy',
    'Disabled by default (tests.privacy.enabled). Key-name checks only — does not scan a live API, delete user data, enforce retention, or generate an export file; not a full privacy audit.'
  ),
];

const BY_ID = new Map<TestTypeId, TestTypeDefinition>(
  TEST_TYPE_REGISTRY.map((row) => [row.id, row])
);

/**
 * Look up a registered test type by id.
 * Unknown ids return undefined (never a synthetic IMPLEMENTED entry).
 */
export function getTestType(id: string): TestTypeDefinition | undefined {
  return BY_ID.get(id as TestTypeId);
}

export function listTestTypesByCategory(category: TestTypeCategory): TestTypeDefinition[] {
  return TEST_TYPE_REGISTRY.filter((row) => row.category === category);
}

/** Types with status IMPLEMENTED only — PARTIAL and NOT_IMPLEMENTED are excluded. */
export function listImplementedTestTypes(): TestTypeDefinition[] {
  return TEST_TYPE_REGISTRY.filter((row) => row.status === 'IMPLEMENTED');
}

export function listTestTypesByStatus(status: TestTypeImplementationStatus): TestTypeDefinition[] {
  return TEST_TYPE_REGISTRY.filter((row) => row.status === status);
}

export function assertRegistryComplete(): void {
  const ids = new Set(TEST_TYPE_REGISTRY.map((row) => row.id));
  for (const id of TEST_TYPE_IDS) {
    if (!ids.has(id)) {
      throw new Error(`Test-type registry missing id: ${id}`);
    }
  }
  if (TEST_TYPE_REGISTRY.length !== TEST_TYPE_IDS.length) {
    throw new Error(
      `Test-type registry length ${TEST_TYPE_REGISTRY.length} !== TEST_TYPE_IDS length ${TEST_TYPE_IDS.length}`
    );
  }
}
