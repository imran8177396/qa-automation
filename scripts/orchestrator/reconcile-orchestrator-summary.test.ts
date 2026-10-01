import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectOrchestratorStaleness,
  formatOrchestratorStalenessBanner,
} from './reconcile-orchestrator-summary';

describe('detectOrchestratorStaleness', () => {
  it('flags partial when fewer stages were recorded than expected', () => {
    const result = detectOrchestratorStaleness({
      original: {
        generatedAt: '2026-09-26T18:58:16.542Z',
        stages: [
          { key: 'preflight' },
          { key: 'discovery' },
          { key: 'e2e' },
        ] as never[],
      },
      expectedStageCount: 23,
      newestSuiteArtifactAt: '2026-09-29T13:16:03.704Z',
    });
    assert.equal(result.partial, true);
    assert.equal(result.stale, true);
    assert.equal(result.recordedStageCount, 3);
    assert.equal(result.expectedStageCount, 23);
    assert.match(result.note, /partial\/stale/i);
    assert.match(result.note, /3 of 23/);
    assert.match(result.note, /later stages were run individually/i);
  });

  it('does not flag a complete N/N summary as stale when suite artifacts are newer (report refresh)', () => {
    const stages = Array.from({ length: 23 }, (_, i) => ({ key: `s${i}` }));
    const result = detectOrchestratorStaleness({
      original: {
        generatedAt: '2026-09-26T18:58:16.542Z',
        stages: stages as never[],
      },
      expectedStageCount: 23,
      newestSuiteArtifactAt: '2026-09-30T13:18:03.677Z',
    });
    assert.equal(result.partial, false);
    assert.equal(result.stale, false);
    assert.match(result.note, /23 of 23/);
    assert.match(result.note, /Suite artifacts were refreshed/i);
  });

  it('flags empty orchestrator summary as stale when suite artifacts exist', () => {
    const result = detectOrchestratorStaleness({
      original: null,
      expectedStageCount: 26,
      newestSuiteArtifactAt: '2026-09-30T13:18:03.677Z',
    });
    assert.equal(result.partial, false);
    assert.equal(result.stale, true);
    assert.match(result.note, /missing or empty/i);
  });

  it('does not invent PASS language in the integrity banner', () => {
    const staleness = detectOrchestratorStaleness({
      original: { generatedAt: '2026-09-26T18:58:16.542Z', stages: [] },
      expectedStageCount: 20,
      newestSuiteArtifactAt: null,
    });
    const banner = formatOrchestratorStalenessBanner(staleness);
    assert.match(banner, /ORCHESTRATOR SUMMARY INTEGRITY/);
    assert.match(banner, /reconciled-summary\.json/);
    assert.doesNotMatch(banner, /\bPASS\b/);
  });
});
