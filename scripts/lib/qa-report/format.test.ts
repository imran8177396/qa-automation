import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateUniqueReportTimestamp,
  formatReportTimestamp,
  MAX_REPORT_STAMP_SUFFIX,
} from './format';

describe('report timestamp folders', () => {
  it('uses YYYY-MM-DD_HH-MM-SS from the local instant', () => {
    const stamp = formatReportTimestamp('2026-09-10T19:12:03+05:00');
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });

  it('keeps the base stamp when no folder exists', () => {
    const iso = new Date().toISOString();
    const base = formatReportTimestamp(iso);
    assert.equal(allocateUniqueReportTimestamp(iso, () => false), base);
  });

  it('appends -2 then -3 when the same-second folder is occupied', () => {
    const iso = new Date().toISOString();
    const base = formatReportTimestamp(iso);
    const occupied = (stamp: string) => stamp === base || stamp === `${base}-2`;
    assert.equal(allocateUniqueReportTimestamp(iso, (stamp) => stamp === base), `${base}-2`);
    assert.equal(allocateUniqueReportTimestamp(iso, occupied), `${base}-3`);
  });

  it('throws when every suffix is occupied', () => {
    const iso = new Date().toISOString();
    const base = formatReportTimestamp(iso);
    assert.throws(
      () => allocateUniqueReportTimestamp(iso, () => true),
      /Could not allocate a unique QA report folder/
    );
    assert.equal(`${base}-${MAX_REPORT_STAMP_SUFFIX}`.includes(base), true);
  });
});
