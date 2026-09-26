import { makeResult, type TestResult } from '../../core/engine-contract';
import type { AiTestsConfig } from '../../types';
import type { AiCallOutcome } from './run-ai-tests';

export const AI_AGENT_CHECK_IDS = {
  toolCall: 'ai:tool-call',
  agentWorkflow: 'ai:agent-workflow',
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

function pass(id: string, name: string): TestResult {
  return makeResult({
    id,
    testType: 'ai',
    category: 'ai',
    name,
    status: 'PASS',
  });
}

function asObject(json: unknown): Record<string, unknown> | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  return json as Record<string, unknown>;
}

/** Resolve a single tool name from common JSON shapes (never invents a call). */
export function extractToolName(json: unknown): string | undefined {
  const obj = asObject(json);
  if (!obj) return undefined;
  if (typeof obj.tool === 'string') return obj.tool;
  if (typeof obj.toolName === 'string') return obj.toolName;
  if (Array.isArray(obj.tools) && obj.tools.length > 0) {
    const first = obj.tools[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && typeof (first as { name?: unknown }).name === 'string') {
      return (first as { name: string }).name;
    }
  }
  return undefined;
}

export function extractToolsSequence(json: unknown): string[] | undefined {
  const obj = asObject(json);
  if (!obj || !Array.isArray(obj.tools)) return undefined;
  const names: string[] = [];
  for (const item of obj.tools) {
    if (typeof item === 'string') {
      names.push(item);
      continue;
    }
    if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      names.push((item as { name: string }).name);
      continue;
    }
    return undefined;
  }
  return names;
}

/** Tool-call and agent-workflow checks against one shared call. */
export function runAgentChecks(config: AiTestsConfig, outcome: AiCallOutcome): TestResult[] {
  return [checkToolCall(config, outcome), checkAgentWorkflow(config, outcome)];
}

function checkToolCall(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_AGENT_CHECK_IDS.toolCall;
  const name = 'AI tool-call validation';
  const expected = config.expectedTool?.trim() ?? '';
  if (!expected) {
    return requiresConfig(id, name, 'expectedTool is empty');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  const actual = extractToolName(outcome.json);
  if (actual !== expected) {
    return fail(id, name, 'tool name does not match expectedTool', {
      expected,
      actual: actual ?? null,
    });
  }
  return pass(id, name);
}

function checkAgentWorkflow(config: AiTestsConfig, outcome: AiCallOutcome): TestResult {
  const id = AI_AGENT_CHECK_IDS.agentWorkflow;
  const name = 'AI agent workflow';
  const expected = config.workflowTools ?? [];
  if (expected.length === 0) {
    return requiresConfig(id, name, 'workflowTools is empty');
  }
  if (outcome.networkError) {
    return fail(id, name, outcome.networkError);
  }
  if (!outcome.ok) {
    return fail(id, name, `HTTP ${outcome.status}`);
  }
  const actual = extractToolsSequence(outcome.json);
  if (!actual || actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    return fail(id, name, 'tools array does not match workflowTools sequence', {
      expected,
      actual: actual ?? null,
    });
  }
  return pass(id, name);
}
