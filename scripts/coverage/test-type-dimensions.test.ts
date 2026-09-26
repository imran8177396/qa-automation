import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percent } from './status';
import { COVERAGE_DEFINITION, COVERAGE_IS_NOT_PASS_RATE } from './formula';
import {
  TEST_TYPE_COVERAGE_DIMENSION_IDS,
  calculateTestTypeDimensions,
  measureDimensionFromCounts,
  notImplementedDimension,
  rollupTestTypeCoveragePct,
} from './test-type-dimensions';
import { getTestType } from '../core/test-types/registry';
import type { CoverageRecord, InventoryItem } from './types';
import type { QaConfig } from '../types';
import type { EngineSummary } from '../core/engine-contract';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'kind' | 'name'>): InventoryItem {
  return {
    source: 'discovery',
    applicableScenarios: [
      {
        id: 'page-load',
        disposition: 'executable',
        reason: 'load',
        tested: false,
        evidenceIds: [],
      },
    ],
    ...partial,
  };
}

function record(
  partial: Partial<CoverageRecord> & Pick<CoverageRecord, 'id' | 'kind' | 'status'>
): CoverageRecord {
  return {
    page: '/',
    element: partial.id,
    type: partial.kind,
    reason: 'fixture',
    recommendedTest: 'n/a',
    ...partial,
  };
}

function emptyEngineSummaries(): Partial<Record<(typeof TEST_TYPE_COVERAGE_DIMENSION_IDS)[number], EngineSummary | null>> {
  const out: Partial<Record<(typeof TEST_TYPE_COVERAGE_DIMENSION_IDS)[number], EngineSummary | null>> = {};
  for (const id of TEST_TYPE_COVERAGE_DIMENSION_IDS) {
    out[id] = null;
  }
  return out;
}

test('coverage formula still rejects pass-rate semantics', () => {
  assert.match(COVERAGE_DEFINITION, /TESTED or FAILED/);
  assert.match(COVERAGE_IS_NOT_PASS_RATE, /not pass rate/i);
  // 2 TESTED + 1 FAILED over 4 testable = 75%, not 2/3 pass rate
  assert.equal(percent(2 + 1, 4), 75);
  assert.notEqual(percent(2, 2 + 1), 75);
});

test('dimension with testable 0 or no artifact has coveragePct null, not 100', () => {
  const empty = measureDimensionFromCounts('api', 0, 0, 0);
  assert.equal(empty.status, 'NOT_MEASURED');
  assert.equal(empty.coveragePct, null);
  assert.notEqual(empty.coveragePct, 100);

  const dims = calculateTestTypeDimensions({
    items: [],
    records: [],
    loadEngineSummariesFromDisk: false,
    engineSummaries: emptyEngineSummaries(),
  });
  assert.equal(dims.length, 17);
  for (const row of dims) {
    assert.equal(row.coveragePct, null, `${row.dimension} must not invent a percent`);
    assert.notEqual(row.status, 'MEASURED');
    assert.notEqual(row.coveragePct, 100);
  }
  assert.equal(rollupTestTypeCoveragePct(dims), null);
});

test('fixture testable 4, tested 2, failed 1 uses existing formula (exercised ÷ testable)', () => {
  // 2 TESTED + 1 FAILED = 3 exercised over 4 testable → 75%
  const exercised = 2 + 1;
  const row = measureDimensionFromCounts('api', 4, exercised, 1);
  assert.equal(row.status, 'MEASURED');
  assert.equal(row.testable, 4);
  assert.equal(row.tested, 3);
  assert.equal(row.failed, 1);
  assert.equal(row.coveragePct, percent(3, 4));
  assert.equal(row.coveragePct, 75);
});

test('disabled/missing ai, database, integration do not make overall 100', () => {
  const config = {
    tests: {
      integration: { enabled: false, checks: [] },
      database: { enabled: false },
      ai: { enabled: false },
      contract: { enabled: false, contracts: [], usePostmanRequests: false },
      reliability: { enabled: false },
      localization: { enabled: true, locales: ['en-US'] },
      regression: { enabled: true, mode: 'selective' },
      unit: { enabled: true },
      smoke: { enabled: true },
      sanity: { enabled: false, checks: [] },
      performance: {
        enabled: true,
        load: { enabled: false },
        stress: { enabled: false },
        spike: { enabled: false },
        endurance: { enabled: false },
      },
    },
    playwright: { enabled: true, browsers: ['chromium'], headless: true },
    postman: { enabled: true, collectionName: 't', requests: [] },
    jmeter: { enabled: false },
  } as unknown as QaConfig;

  const dims = calculateTestTypeDimensions({
    items: [],
    records: [],
    config,
    loadEngineSummariesFromDisk: false,
    engineSummaries: emptyEngineSummaries(),
    env: {},
  });

  for (const id of ['ai', 'database', 'integration'] as const) {
    const row = dims.find((d) => d.dimension === id)!;
    assert.equal(row.status, 'NOT_MEASURED', id);
    assert.equal(row.coveragePct, null, id);
    assert.match(row.reason ?? '', /disabled/i);
  }

  assert.equal(rollupTestTypeCoveragePct(dims), null);
  assert.notEqual(rollupTestTypeCoveragePct(dims), 100);
});

test('one MEASURED at 50% with others NOT_MEASURED → overall 50', () => {
  const measured = measureDimensionFromCounts('api', 4, 2, 0);
  assert.equal(measured.coveragePct, 50);

  const others = TEST_TYPE_COVERAGE_DIMENSION_IDS.filter((id) => id !== 'api').map((id) => ({
    dimension: id,
    status: 'NOT_MEASURED' as const,
    testable: 0,
    tested: 0,
    failed: 0,
    coveragePct: null,
    reason: 'no coverage evidence for this dimension',
  }));

  const overall = rollupTestTypeCoveragePct([measured, ...others]);
  assert.equal(overall, 50);
});

test('NOT_IMPLEMENTED dimension is not 100', () => {
  const row = notImplementedDimension('volume', 'No volume plan');
  assert.equal(row.status, 'NOT_IMPLEMENTED');
  assert.equal(row.coveragePct, null);
  assert.notEqual(row.coveragePct, 100);

  const overall = rollupTestTypeCoveragePct([
    row,
    measureDimensionFromCounts('api', 2, 1, 0),
  ]);
  assert.equal(overall, 50);
});

test('ai registry is PARTIAL — empty run is NOT_MEASURED, not NOT_IMPLEMENTED', () => {
  assert.equal(getTestType('ai')?.status, 'PARTIAL');
  const dims = calculateTestTypeDimensions({
    items: [],
    records: [],
    loadEngineSummariesFromDisk: false,
    engineSummaries: emptyEngineSummaries(),
  });
  const ai = dims.find((d) => d.dimension === 'ai')!;
  assert.equal(ai.status, 'NOT_MEASURED');
  assert.notEqual(ai.status, 'NOT_IMPLEMENTED');
  assert.equal(ai.coveragePct, null);
});

test('inventory-backed api dimension MEASURED with existing formula', () => {
  const items = [
    item({ id: 'API-1', kind: 'api', name: 'GET /a' }),
    item({ id: 'API-2', kind: 'api', name: 'GET /b' }),
    item({ id: 'API-3', kind: 'api', name: 'GET /c' }),
    item({ id: 'API-4', kind: 'api', name: 'GET /d' }),
  ];
  const records = [
    record({ id: 'API-1', kind: 'api', status: 'TESTED' }),
    record({ id: 'API-2', kind: 'api', status: 'TESTED' }),
    record({ id: 'API-3', kind: 'api', status: 'FAILED' }),
    record({ id: 'API-4', kind: 'api', status: 'UNCOVERED' }),
  ];

  const dims = calculateTestTypeDimensions({
    items,
    records,
    loadEngineSummariesFromDisk: false,
    engineSummaries: emptyEngineSummaries(),
  });
  const api = dims.find((d) => d.dimension === 'api')!;
  assert.equal(api.status, 'MEASURED');
  assert.equal(api.testable, 4);
  assert.equal(api.tested, 3);
  assert.equal(api.failed, 1);
  assert.equal(api.coveragePct, 75);

  // Web inventory must not mark ai covered
  const ai = dims.find((d) => d.dimension === 'ai')!;
  assert.equal(ai.status, 'NOT_MEASURED');
  assert.equal(ai.coveragePct, null);
});

test('empty default: all 17 dimensions are incomplete with null coveragePct', () => {
  const dims = calculateTestTypeDimensions({
    items: [],
    records: [],
    loadEngineSummariesFromDisk: false,
    engineSummaries: emptyEngineSummaries(),
  });
  assert.deepEqual(
    dims.map((d) => d.dimension),
    [...TEST_TYPE_COVERAGE_DIMENSION_IDS]
  );
  for (const row of dims) {
    assert.ok(
      row.status === 'NOT_MEASURED' ||
        row.status === 'REQUIRES_CONFIGURATION' ||
        row.status === 'NOT_IMPLEMENTED',
      `${row.dimension} unexpected ${row.status}`
    );
    assert.equal(row.coveragePct, null);
    assert.equal(row.testable, 0);
  }
  assert.equal(rollupTestTypeCoveragePct(dims), null);
});
