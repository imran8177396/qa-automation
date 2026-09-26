import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeResourceRequirements,
  planResourceWaves,
  UNDECLARED_RESOURCE_WAVE_REASON,
} from './resources';

describe('normalizeResourceRequirements', () => {
  it('map form { browser, database, network } normalizes to three exclusive requirements', () => {
    const normalized = normalizeResourceRequirements({
      browser: 1,
      database: 1,
      network: 1,
    });
    assert.equal(normalized.declared, true);
    assert.deepEqual(normalized.requirements, [
      { name: 'browser', count: 1, mode: 'exclusive' },
      { name: 'database', count: 1, mode: 'exclusive' },
      { name: 'network', count: 1, mode: 'exclusive' },
    ]);
  });

  it('explicit shared network normalizes to mode shared', () => {
    const normalized = normalizeResourceRequirements([
      { name: 'network', count: 1, mode: 'shared' },
    ]);
    assert.equal(normalized.declared, true);
    assert.deepEqual(normalized.requirements, [
      { name: 'network', count: 1, mode: 'shared' },
    ]);
  });

  it('missing resources field is undeclared with refusal reason', () => {
    const normalized = normalizeResourceRequirements(undefined);
    assert.equal(normalized.declared, false);
    assert.deepEqual(normalized.requirements, []);
    assert.equal(normalized.reason, UNDECLARED_RESOURCE_WAVE_REASON);
  });

  it('invalid count throws (negative, NaN, non-integer)', () => {
    assert.throws(() => normalizeResourceRequirements({ browser: -1 }), /Invalid resource count/);
    assert.throws(() => normalizeResourceRequirements({ browser: 1.5 }), /Invalid resource count/);
    assert.throws(() => normalizeResourceRequirements({ browser: NaN }), /Invalid resource count/);
    assert.throws(
      () =>
        normalizeResourceRequirements([
          { name: 'browser', count: -1, mode: 'shared' },
        ]),
      /Invalid resource count/
    );
  });

  it('legacy string labels normalize to shared count 1', () => {
    const normalized = normalizeResourceRequirements(['db']);
    assert.equal(normalized.declared, true);
    assert.deepEqual(normalized.requirements, [
      { name: 'db', count: 1, mode: 'shared' },
    ]);
  });
});

describe('planResourceWaves', () => {
  it('two exclusive browser tests → two waves when parallel true', () => {
    const waves = planResourceWaves(
      [
        { id: 'A', resources: { browser: 1 } },
        { id: 'B', resources: { browser: 1 } },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A'], ['B']]);
  });

  it('two shared network tests → one wave when parallel true', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'A',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'B',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A', 'B']]);
  });

  it('two shared database tests without allowSharedMutableState → two waves', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'A',
          resources: [{ name: 'database', count: 1, mode: 'shared' }],
        },
        {
          id: 'B',
          resources: [{ name: 'database', count: 1, mode: 'shared' }],
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A'], ['B']]);
  });

  it('two shared database tests with allowSharedMutableState true on both → one wave', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'A',
          resources: [{ name: 'database', count: 1, mode: 'shared' }],
          allowSharedMutableState: true,
        },
        {
          id: 'B',
          resources: [{ name: 'database', count: 1, mode: 'shared' }],
          allowSharedMutableState: true,
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A', 'B']]);
  });

  it('one exclusive browser and one shared browser → two waves', () => {
    const waves = planResourceWaves(
      [
        { id: 'A', resources: { browser: 1 } },
        {
          id: 'B',
          resources: [{ name: 'browser', count: 1, mode: 'shared' }],
          allowSharedMutableState: true,
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A'], ['B']]);
  });

  it('undeclared resources → own wave, not FAIL', () => {
    const waves = planResourceWaves(
      [
        { id: 'A' },
        {
          id: 'B',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        { id: 'C' },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['A'], ['B'], ['C']]);
    const note = normalizeResourceRequirements(undefined);
    assert.equal(note.reason, UNDECLARED_RESOURCE_WAVE_REASON);
    assert.notEqual(note.reason, 'FAIL');
    assert.notEqual(note.reason, 'PASS');
  });

  it('parallel false → one test per wave even if both are shared network', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'A',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'B',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
      ],
      { parallel: false }
    );
    assert.deepEqual(waves, [['A'], ['B']]);
  });

  it('tests with no id throw', () => {
    assert.throws(
      () => planResourceWaves([{ id: '', resources: { network: 1 } }], { parallel: true }),
      /non-empty id/
    );
  });

  it('preserves input order within a compatible wave', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'Z',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'A',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'M',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves, [['Z', 'A', 'M']]);
  });

  it('respects dependency waves before resource packing', () => {
    const waves = planResourceWaves(
      [
        {
          id: 'A',
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'B',
          dependsOn: ['A'],
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
        {
          id: 'C',
          dependsOn: ['A'],
          resources: [{ name: 'network', count: 1, mode: 'shared' }],
        },
      ],
      { parallel: true }
    );
    assert.deepEqual(waves[0], ['A']);
    assert.deepEqual(waves[1], ['B', 'C']);
  });
});
