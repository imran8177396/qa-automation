import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runAiTests, AI_INITIAL_CHECK_IDS, AI_META_CHECK_IDS } from './run-ai-tests';
import { AI_FUTURE_CHECK_IDS } from './safety-tests';

const AI_DIR = path.resolve(__dirname);

function readAiSourceFiles(): string {
  const names = [
    'run-ai-tests.ts',
    'prompt-tests.ts',
    'rag-tests.ts',
    'agent-tests.ts',
    'safety-tests.ts',
    'run-ai-tests.test.ts',
  ];
  return names.map((name) => fs.readFileSync(path.join(AI_DIR, name), 'utf8')).join('\n');
}

test('disabled → single NOT_TESTED; fetchImpl not called', async () => {
  let fetchCalls = 0;
  const results = await runAiTests(
    { enabled: false },
    {},
    {
      writeSummary: false,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true, text: async () => '{}' };
      },
    }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, AI_META_CHECK_IDS.disabled);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /ai engine disabled; not required for web QA/i);
  assert.equal(fetchCalls, 0);
});

test('enabled, no endpoint → initial REQUIRES_CONFIGURATION, future NOT_TESTED, no fetch', async () => {
  let fetchCalls = 0;
  const results = await runAiTests(
    {
      enabled: true,
      prompt: '',
      requiredFields: [],
      requiredFacts: [],
      expectedTool: '',
      workflowTools: [],
    },
    {},
    {
      writeSummary: false,
      fetchImpl: async () => {
        fetchCalls += 1;
        return { status: 200, ok: true, text: async () => '{}' };
      },
    }
  );
  assert.equal(fetchCalls, 0);
  const initialIds = Object.values(AI_INITIAL_CHECK_IDS);
  for (const id of initialIds) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing ${id}`);
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', id);
    assert.match(row.error?.message ?? '', /QA_AI_ENDPOINT is not set/);
  }
  for (const id of Object.values(AI_FUTURE_CHECK_IDS)) {
    const row = results.find((r) => r.id === id);
    assert.ok(row, `missing future ${id}`);
    assert.equal(row.status, 'NOT_TESTED', id);
    assert.match(row.error?.message ?? '', /not implemented/i);
  }
  const modelRegression = results.find((r) => r.id === AI_FUTURE_CHECK_IDS.modelRegression);
  assert.equal(modelRegression?.error?.message, 'model regression is not implemented');
  assert.equal(modelRegression?.metadata?.reason, 'model regression is not implemented');
});

test('enabled + endpoint + configured checks PASS via fetchImpl', async () => {
  let fetchCalls = 0;
  let postedBody = '';
  const results = await runAiTests(
    {
      enabled: true,
      prompt: 'What is the capital?',
      expectedSubstring: 'Paris',
      requiredFields: ['answer'],
      requiredFacts: ['Paris'],
      expectedTool: 'search',
      workflowTools: ['search'],
    },
    { QA_AI_ENDPOINT: 'http://127.0.0.1:9/ai' },
    {
      writeSummary: false,
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        postedBody = init?.body ?? '';
        return {
          status: 200,
          ok: true,
          text: async () =>
            JSON.stringify({
              answer: 'Paris',
              tools: ['search'],
              usage: { total_tokens: 3 },
            }),
        };
      },
    }
  );
  assert.equal(fetchCalls, 1);
  assert.equal(JSON.parse(postedBody).prompt, 'What is the capital?');

  const byId = new Map(results.map((r) => [r.id, r]));
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.promptRegression)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.structuredOutput)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.responseValidation)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.hallucination)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.toolCall)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.agentWorkflow)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.latency)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.tokenCost)?.status, 'PASS');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.tokenCost)?.metadata?.totalTokens, 3);
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.groundedness)?.status, 'REQUIRES_CONFIGURATION');
  assert.equal(byId.get(AI_INITIAL_CHECK_IDS.ragRetrieval)?.status, 'REQUIRES_CONFIGURATION');
});

test('usage missing → token row REQUIRES_CONFIGURATION', async () => {
  const results = await runAiTests(
    {
      enabled: true,
      prompt: 'hi',
      requiredFields: [],
      requiredFacts: [],
      expectedTool: '',
      workflowTools: [],
    },
    { QA_AI_ENDPOINT: 'http://127.0.0.1:9/ai' },
    {
      writeSummary: false,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ answer: 'ok' }),
      }),
    }
  );
  const token = results.find((r) => r.id === AI_INITIAL_CHECK_IDS.tokenCost);
  assert.ok(token);
  assert.equal(token.status, 'REQUIRES_CONFIGURATION');
  assert.match(token.error?.message ?? '', /provider usage was not returned/i);
  assert.equal(token.metadata?.totalTokens, undefined);
});

test('source files do not contain attack payload substrings', () => {
  const source = readAiSourceFiles();
  const ignorePrevious = 'ignore' + ' previous';
  const bannedWord = 'jail' + 'break';
  assert.equal(source.toLowerCase().includes(ignorePrevious), false);
  // Test id `ai:` + bannedWord is allowed; bare banned word as payload content is not.
  const withoutIds = source.replace(new RegExp(`ai:${bannedWord}`, 'g'), '');
  assert.equal(withoutIds.toLowerCase().includes(bannedWord), false);
});
