import { makeResult, type TestResult } from '../../core/engine-contract';
import type { AiTestsConfig } from '../../types';
import type { AiCallOutcome } from './run-ai-tests';

export const AI_RAG_CHECK_IDS = {
  hallucination: 'ai:hallucination',
  groundedness: 'ai:groundedness',
  ragRetrieval: 'ai:rag-retrieval',
} as const;

const HONESTY_NOTE =
  'substring presence is not a proof of truth';

function requiresConfig(id: string, name: string, message: string): TestResult {
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

function fail(id: string, name: string, message: string, assertion?: TestResult['assertion']): TestResult {
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'FAIL',
    error: { message },
    ...(assertion ? { assertion } : {}),
  });
}

function pass(id: string, name: string, metadata?: Record<string, unknown>): TestResult {
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'PASS',
    ...(metadata ? { metadata } : {}),
  });
}

/** Hallucination, groundedness, and RAG retrieval checks against one shared call. */
export function runRagChecks(config: AiTestsConfig, outcome: AiCallOutcome): TestResult[] {
  return [
    checkHallucination(config, outcome),
    checkGroundedness(config, outcome),
    checkRagRetrieval(config, outcome),
  ];
}

function checkHallucination(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_RAG_CHECK_IDS.hallucination;
  const name = 'AI hallucination (fact substrings)';
  const facts = config.requiredFacts ?? [];
  if (facts.length === 0) {
    return requiresConfig(id, name, 'no facts configured; hallucination is not judged');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  const text = outcome.bodyText;
  for (const fact of facts) {
    if (!text.includes(fact)) {
      return fail(id, name, `required fact not found: ${fact}`, {
        expected: fact,
        actual: text.slice(0, 200),
      });
    }
  }
  return pass(id, name, { note: HONESTY_NOTE });
}

function checkGroundedness(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_RAG_CHECK_IDS.groundedness;
  const name = 'AI groundedness (source substrings)';
  const sources = config.sources ?? [];
  if (sources.length === 0) {
    return requiresConfig(id, name, 'no sources configured');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  const text = outcome.bodyText;
  for (const source of sources) {
    if (!text.includes(source)) {
      return fail(id, name, `source not found in response: ${source}`, {
        expected: source,
        actual: text.slice(0, 200),
      });
    }
  }
  return pass(id, name, { note: HONESTY_NOTE });
}

function listIdsFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      ids.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      const candidate = row.id ?? row.chunkId ?? row.sourceId ?? row.name;
      if (typeof candidate === 'string') ids.push(candidate);
    }
  }
  return ids;
}

function checkRagRetrieval(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_RAG_CHECK_IDS.ragRetrieval;
  const name = 'AI RAG retrieval';
  const expected = config.expectedChunkIds ?? [];
  if (expected.length === 0) {
    return requiresConfig(id, name, 'no expectedChunkIds configured');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  if (outcome.json === null || typeof outcome.json !== 'object' || Array.isArray(outcome.json)) {
    return fail(id, name, 'response body is not valid JSON with chunks/sources');
  }
  const obj = outcome.json as Record<string, unknown>;
  const hasChunks = Array.isArray(obj.chunks);
  const hasSources = Array.isArray(obj.sources);
  if (!hasChunks && !hasSources) {
    return fail(id, name, 'JSON body has neither chunks nor sources array');
  }
  const found = new Set([
    ...listIdsFromArray(obj.chunks),
    ...listIdsFromArray(obj.sources),
  ]);
  for (const chunkId of expected) {
    if (!found.has(chunkId)) {
      return fail(id, name, `expected chunk/source id not found: ${chunkId}`, {
        expected: chunkId,
        actual: [...found],
      });
    }
  }
  return pass(id, name);
}
