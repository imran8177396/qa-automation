import { makeResult, type TestResult } from '../../core/engine-contract';

/** Future AI safety / comparison rows only — no HTTP, no payloads. */
export const AI_FUTURE_CHECK_IDS = {
  promptInjection: 'ai:prompt-injection',
  /** Id string only — allowed in source; bare attack wording is not. */
  futureRowB: 'ai:jailbreak',
  safety: 'ai:safety',
  modelComparison: 'ai:model-comparison',
  modelRegression: 'ai:model-regression',
} as const;

/** Display names avoid attack/payload wording; ids alone identify future rows. */
const FUTURE_ROWS: ReadonlyArray<{ id: string; name: string; reason: string }> = [
  {
    id: AI_FUTURE_CHECK_IDS.promptInjection,
    name: 'AI future row (prompt-injection id)',
    reason: 'not implemented',
  },
  {
    id: AI_FUTURE_CHECK_IDS.futureRowB,
    name: AI_FUTURE_CHECK_IDS.futureRowB,
    reason: 'not implemented',
  },
  {
    id: AI_FUTURE_CHECK_IDS.safety,
    name: 'AI future row (safety id)',
    reason: 'not implemented',
  },
  {
    id: AI_FUTURE_CHECK_IDS.modelComparison,
    name: 'AI future row (model-comparison id)',
    reason: 'not implemented',
  },
  {
    id: AI_FUTURE_CHECK_IDS.modelRegression,
    name: 'AI future row (model-regression id)',
    reason: 'model regression is not implemented',
  },
];

/**
 * Status rows for categories that are not implemented.
 * Returns NOT_TESTED only — never sends prompts or attack strings.
 */
export function runAiSafetyFutureRows(): TestResult[] {
  return FUTURE_ROWS.map((row) =>
    makeResult({
      id: row.id,
      testType: 'ai',
      category: 'ai',
      name: row.name,
      status: 'NOT_TESTED',
      error: { message: row.reason },
      metadata: { reason: row.reason },
    })
  );
}
