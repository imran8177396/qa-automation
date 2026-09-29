import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ARCHITECTURE_STATUS,
  QA_ARCHITECTURE_STAGE_IDS,
  QA_ARCHITECTURE_STAGES,
  architectureSummary,
  assertArchitectureOrder,
} from './architecture';

const ROOT = path.resolve(__dirname, '../..');

const EXPECTED_IDS = [
  'project-context',
  'environment-manager',
  'discovery',
  'planning',
  'change-risk-analysis',
  'test-selection',
  'dependency-resolver',
  'test-orchestrator',
  'engines-ui-api',
  'engines-db-contract',
  'engines-ai',
  'engines-security',
  'engines-performance',
  'engines-reliability',
  'result-normalizer',
  'retry-flaky',
  'coverage',
  'quality-gates',
  'failure-analysis',
  'retest',
  'reporting',
  'history-analytics',
] as const;

describe('QA architecture stage graph', () => {
  it('ids equal the 22-id list in order', () => {
    assert.deepEqual(
      QA_ARCHITECTURE_STAGES.map((s) => s.id),
      [...EXPECTED_IDS]
    );
    assert.deepEqual([...QA_ARCHITECTURE_STAGE_IDS], [...EXPECTED_IDS]);
    assert.equal(QA_ARCHITECTURE_STAGES.length, 22);
  });

  it('assertArchitectureOrder does not throw on the exported list', () => {
    assert.doesNotThrow(() => assertArchitectureOrder());
    assert.doesNotThrow(() => assertArchitectureOrder(QA_ARCHITECTURE_STAGES));
  });

  it('assertArchitectureOrder fails on duplicate or wrong-order ids', () => {
    const withDup = [
      ...EXPECTED_IDS.slice(0, 21).map((id) => ({ id })),
      { id: EXPECTED_IDS[0] },
    ];
    assert.throws(() => assertArchitectureOrder(withDup), /mismatch|duplicate/);

    const swapped = EXPECTED_IDS.map((id) => ({ id }));
    const tmp = swapped[0]!.id;
    swapped[0] = { id: swapped[1]!.id };
    swapped[1] = { id: tmp };
    assert.throws(() => assertArchitectureOrder(swapped), /mismatch/);
  });

  it('every module path is scripts/* and exists on disk', () => {
    for (const stage of QA_ARCHITECTURE_STAGES) {
      assert.ok(
        stage.module.startsWith('scripts/'),
        `${stage.id} module must start with scripts/: ${stage.module}`
      );
      const abs = path.join(ROOT, stage.module);
      assert.ok(fs.existsSync(abs), `${stage.id} missing module path: ${stage.module}`);
    }
  });

  it('test-orchestrator.module ends with scripts/run-all.ts', () => {
    const orch = QA_ARCHITECTURE_STAGES.find((s) => s.id === 'test-orchestrator');
    assert.ok(orch);
    assert.ok(orch!.module.endsWith('scripts/run-all.ts'));
  });

  it('no IMPLEMENTED stage claims qa:all does not call it', () => {
    for (const stage of QA_ARCHITECTURE_STAGES) {
      if (stage.status !== 'IMPLEMENTED') continue;
      assert.equal(
        /qa:all does not call/i.test(stage.note),
        false,
        `${stage.id} is IMPLEMENTED but note says qa:all does not call it`
      );
      assert.equal(stage.wiredIntoQaAll, true, `${stage.id} IMPLEMENTED must be wiredIntoQaAll`);
    }
  });

  it('engines-db-contract, engines-ai, and quality-gates are not IMPLEMENTED', () => {
    for (const id of ['engines-db-contract', 'engines-ai', 'quality-gates'] as const) {
      const stage = QA_ARCHITECTURE_STAGES.find((s) => s.id === id);
      assert.ok(stage);
      assert.notEqual(stage!.status, 'IMPLEMENTED');
    }
  });

  it('architectureSummary is PARTIAL with consistent counts', () => {
    assert.equal(ARCHITECTURE_STATUS, 'PARTIAL');
    const summary = architectureSummary();
    assert.equal(summary.status, 'PARTIAL');
    assert.equal(summary.stageCount, 22);
    assert.equal(summary.wiredCount + summary.notWiredOrPartialCount, 22);
  });

  it('package.json qa:all still contains run-all.ts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    assert.match(pkg.scripts?.['qa:all'] ?? '', /run-all\.ts/);
  });
});
