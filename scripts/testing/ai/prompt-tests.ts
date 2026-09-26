import { makeResult, type TestResult } from '../../core/engine-contract';
import type { AiTestsConfig } from '../../types';
import type { AiCallOutcome } from './run-ai-tests';

export const AI_PROMPT_CHECK_IDS = {
  promptRegression: 'ai:prompt-regression',
  structuredOutput: 'ai:structured-output',
  responseValidation: 'ai:response-validation',
} as const;

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

/** Prompt regression, structured output, and response validation against one shared call. */
export function runPromptChecks(config: AiTestsConfig, outcome: AiCallOutcome): TestResult[] {
  return [
    checkPromptRegression(config, outcome),
    checkStructuredOutput(config, outcome),
    checkResponseValidation(outcome),
  ];
}

function checkPromptRegression(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_PROMPT_CHECK_IDS.promptRegression;
  const name = 'AI prompt regression';
  const prompt = config.prompt?.trim() ?? '';
  if (!prompt) {
    return requiresConfig(id, name, 'prompt is empty; configure tests.ai.prompt');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  const text = outcome.bodyText;
  if (!text.trim()) {
    return fail(id, name, 'response text is empty');
  }
  const expected = config.expectedSubstring;
  if (expected !== undefined && expected !== null && String(expected).length > 0) {
    if (!text.includes(String(expected))) {
      return fail(id, name, 'expectedSubstring not found in response', {
        expected: String(expected),
        actual: text.slice(0, 200),
      });
    }
    return pass(id, name);
  }
  return pass(id, name, {
    note: 'non-empty response only; this is not a semantic regression baseline',
  });
}

function checkStructuredOutput(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_PROMPT_CHECK_IDS.structuredOutput;
  const name = 'AI structured output';
  const required = config.requiredFields ?? [];
  if (required.length === 0) {
    return requiresConfig(id, name, 'no structured output schema configured');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  if (outcome.json === null || typeof outcome.json !== 'object' || Array.isArray(outcome.json)) {
    return fail(id, name, 'response body is not valid JSON object');
  }
  const obj = outcome.json as Record<string, unknown>;
  for (const field of required) {
    if (!(field in obj)) {
      return fail(id, name, `missing required field: ${field}`, {
        expected: field,
        actual: Object.keys(obj),
      });
    }
  }
  return pass(id, name);
}

function checkResponseValidation(outcome: AiCallOutcome): TestResult {
  const id = AI_PROMPT_CHECK_IDS.responseValidation;
  const name = 'AI response validation';
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (outcome.ok && outcome.bodyText.trim().length > 0) {
    return pass(id, name, {
      note: 'HTTP 2xx and non-empty body only; not factual correctness',
    });
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  return fail(id, name, 'response body is empty');
}
