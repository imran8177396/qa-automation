import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmptyTableError, TableAudit, emptyTablePlaceholder, prepareTableRows } from './empty-table';

test('empty table emits NOT_AVAILABLE — reason spanning row', () => {
  const placeholder = emptyTablePlaceholder(3, 'risk labels were not present');
  assert.equal(placeholder.cells[0], 'NOT_AVAILABLE — risk labels were not present');
  assert.equal(placeholder.colSpan, 3);
});

test('prepareTableRows records an empty reason instead of a bare shell', () => {
  const audit = new TableAudit();
  const prepared = prepareTableRows(['Risk', 'Count'], [], audit, 'no risk labels reached the payload');
  assert.equal(prepared.placeholder?.reason, 'no risk labels reached the payload');
  assert.equal(prepared.rows.length, 1);
  assert.match(prepared.rows[0][0] ?? '', /^NOT_AVAILABLE — /);
});

test('TableAudit throws when a table has zero rows and no reason', () => {
  const audit = new TableAudit();
  assert.throws(() => audit.record(['A', 'B'], 0), (error: unknown) => {
    assert.ok(error instanceof EmptyTableError);
    return true;
  });
});
