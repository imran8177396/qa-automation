import path from 'path';
import { PATHS } from '../../lib/paths';
import { loadConfig } from '../../lib/load-config';
import { writeJson } from '../../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../../lib/logger';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../../core/engine-contract';
import type { AiTestsConfig } from '../../types';
import { runPromptChecks } from './prompt-tests';
import { runRagChecks } from './rag-tests';
import { runAgentChecks } from './agent-tests';
import { runAiSafetyFutureRows } from './safety-tests';

export const AI_TIMEOUT_MS = 15_000;
export const DEFAULT_AI_ENDPOINT_ENV = 'QA_AI_ENDPOINT';

export const AI_META_CHECK_IDS = {
  disabled: 'ai:disabled',
  latency: 'ai:latency',
  tokenCost: 'ai:token-cost',
} as const;

export const AI_INITIAL_CHECK_IDS = {
  promptRegression: 'ai:prompt-regression',
  structuredOutput: 'ai:structured-output',
  responseValidation: 'ai:response-validation',
  hallucination: 'ai:hallucination',
  groundedness: 'ai:groundedness',
  ragRetrieval: 'ai:rag-retrieval',
  toolCall: 'ai:tool-call',
  agentWorkflow: 'ai:agent-workflow',
  latency: AI_META_CHECK_IDS.latency,
  tokenCost: AI_META_CHECK_IDS.tokenCost,
} as const;

export type AiFetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}>;

/** Shared outcome of the single optional POST — never invents a model response. */
export interface AiCallOutcome {
  status: number;
  ok: boolean;
  bodyText: string;
  /** Parsed JSON when the body is valid JSON; otherwise null. */
  json: unknown | null;
  durationMs: number;
  networkError?: string;
}

export interface RunAiOptions {
  fetchImpl?: AiFetchImpl;
  writeSummary?: boolean;
}

function loadAiConfig(): AiTestsConfig {
  const loaded = loadConfig();
  const ai = loaded.tests?.ai;
  return {
    enabled: ai?.enabled === true,
    endpointEnv: ai?.endpointEnv,
    prompt: ai?.prompt ?? '',
    expectedSubstring: ai?.expectedSubstring,
    requiredFields: ai?.requiredFields ?? [],
    requiredFacts: ai?.requiredFacts ?? [],
    sources: ai?.sources ?? [],
    expectedChunkIds: ai?.expectedChunkIds ?? [],
    expectedTool: ai?.expectedTool ?? '',
    workflowTools: ai?.workflowTools ?? [],
  };
}

function endpointEnvName(config: AiTestsConfig): string {
  const named = config.endpointEnv?.trim();
  return named || DEFAULT_AI_ENDPOINT_ENV;
}

function resolveEndpoint(config: AiTestsConfig, env: NodeJS.ProcessEnv): string | undefined {
  const key = endpointEnvName(config);
  const value = env[key]?.trim();
  return value || undefined;
}

function parseJsonBody(bodyText: string): unknown | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function requiresConfigRow(id: string, name: string, message: string): TestResult {
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'REQUIRES_CONFIGURATION',
    error: { message },
    metadata: { reason: message },
  });
}

function failRow(id: string, name: string, message: string): TestResult {
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'FAIL',
    error: { message },
  });
}

/** Initial capability ids that need an endpoint before any network call. */
const INITIAL_REQUIRES_ENDPOINT: ReadonlyArray<{ id: string; name: string }> = [
  { id: AI_INITIAL_CHECK_IDS.promptRegression, name: 'AI prompt regression' },
  { id: AI_INITIAL_CHECK_IDS.structuredOutput, name: 'AI structured output' },
  { id: AI_INITIAL_CHECK_IDS.responseValidation, name: 'AI response validation' },
  { id: AI_INITIAL_CHECK_IDS.hallucination, name: 'AI hallucination (fact substrings)' },
  { id: AI_INITIAL_CHECK_IDS.groundedness, name: 'AI groundedness (source substrings)' },
  { id: AI_INITIAL_CHECK_IDS.ragRetrieval, name: 'AI RAG retrieval' },
  { id: AI_INITIAL_CHECK_IDS.toolCall, name: 'AI tool-call validation' },
  { id: AI_INITIAL_CHECK_IDS.agentWorkflow, name: 'AI agent workflow' },
  { id: AI_INITIAL_CHECK_IDS.latency, name: 'AI latency' },
  { id: AI_INITIAL_CHECK_IDS.tokenCost, name: 'AI token/cost' },
];

function emitEndpointMissingRows(envKey: string): TestResult[] {
  const message = `${envKey} is not set`;
  return INITIAL_REQUIRES_ENDPOINT.map((row) => requiresConfigRow(row.id, row.name, message));
}

async function postOnce(
  endpoint: string,
  prompt: string,
  fetchImpl: AiFetchImpl
): Promise<AiCallOutcome> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    const durationMs = Date.now() - started;
    return {
      status: response.status,
      ok: response.ok,
      bodyText,
      json: parseJsonBody(bodyText),
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 0,
      ok: false,
      bodyText: '',
      json: null,
      durationMs,
      networkError: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function checkLatency(outcome: AiCallOutcome): TestResult {
  const id = AI_META_CHECK_IDS.latency;
  const name = 'AI latency';
  if (outcome.networkError) {
    return failRow(id, name, outcome.networkError);
  }
  if (typeof outcome.durationMs !== 'number' || Number.isNaN(outcome.durationMs)) {
    return failRow(id, name, 'durationMs was not recorded');
  }
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'PASS',
    durationMs: outcome.durationMs,
    metadata: { durationMs: outcome.durationMs },
  });
}

function checkTokenCost(outcome: AiCallOutcome): TestResult {
  const id = AI_META_CHECK_IDS.tokenCost;
  const name = 'AI token/cost';
  if (outcome.networkError) {
    return failRow(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return failRow(id, name, `HTTP ${outcome.status}`);
  }
  if (outcome.json === null || typeof outcome.json !== 'object' || Array.isArray(outcome.json)) {
    return requiresConfigRow(id, name, 'provider usage was not returned');
  }
  const usage = (outcome.json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return requiresConfigRow(id, name, 'provider usage was not returned');
  }
  const usageObj = usage as Record<string, unknown>;
  const total =
    typeof usageObj.total_tokens === 'number'
      ? usageObj.total_tokens
      : typeof usageObj.totalTokens === 'number'
        ? usageObj.totalTokens
        : undefined;
  if (typeof total !== 'number') {
    return requiresConfigRow(id, name, 'provider usage was not returned');
  }
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'PASS',
    metadata: { totalTokens: total },
  });
}

/**
 * Optional AI QA engine. Disabled by default and not required for web QA.
 * Does not print secrets. One POST when enabled and endpoint is set.
 */
export async function runAiTests(
  config: AiTestsConfig = loadAiConfig(),
  env: NodeJS.ProcessEnv = process.env,
  options?: RunAiOptions
): Promise<TestResult[]> {
  const fetchImpl = options?.fetchImpl ?? (globalThis.fetch as AiFetchImpl);
  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (config.enabled !== true) {
    results.push(
      makeResult({
        id: AI_META_CHECK_IDS.disabled,
        testType: 'ai',
        category: 'ai',
        name: 'AI engine',
        status: 'NOT_TESTED',
        error: { message: 'ai engine disabled; not required for web QA' },
        metadata: { reason: 'ai engine disabled; not required for web QA' },
      })
    );
    if (writeSummary) writeAiSummary(results);
    return results;
  }

  const envKey = endpointEnvName(config);
  const endpoint = resolveEndpoint(config, env);
  if (!endpoint) {
    results.push(...emitEndpointMissingRows(envKey));
    results.push(...runAiSafetyFutureRows());
    if (writeSummary) writeAiSummary(results);
    return results;
  }

  const outcome = await postOnce(endpoint, config.prompt ?? '', fetchImpl);

  results.push(...runPromptChecks(config, outcome));
  results.push(...runRagChecks(config, outcome));
  results.push(...runAgentChecks(config, outcome));
  results.push(checkLatency(outcome));
  results.push(checkTokenCost(outcome));
  results.push(...runAiSafetyFutureRows());

  if (writeSummary) writeAiSummary(results);
  return results;
}

export function writeAiSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'ai',
    testType: 'ai',
    results,
    note: 'Optional AI QA layer. Not required for web/e2e/api/jmeter. Disabled by default.',
    limitations: [
      'Does not run unless tests.ai.enabled is true and the endpoint env is set.',
      'Future safety/comparison rows are NOT_TESTED status only.',
      'Substring and field checks are not semantic truth proofs.',
    ],
  });
  const out = path.join(PATHS.reports.ai, 'summary.json');
  writeJson(out, summary);
  return out;
}

async function main(): Promise<void> {
  logStep('AI engine (optional — not required for web QA)');
  const results = await runAiTests();
  const summary = buildEngineSummary({
    engine: 'ai',
    testType: 'ai',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} AI FAIL(s) — see reports/ai/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('AI REQUIRES_CONFIGURATION — see reports/ai/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('AI NOT_TESTED — engine disabled or future rows only');
    return;
  }
  logSuccess('AI engine completed');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
