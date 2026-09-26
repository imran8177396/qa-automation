import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyResponseShape,
  formatErrorStatusDetail,
  needsErrorStatusShapeDetail,
} from './response-shape';

test('classifyResponseShape reuses array/object/empty and non-json', () => {
  assert.equal(classifyResponseShape(''), 'empty');
  assert.equal(classifyResponseShape('[]'), 'array');
  assert.equal(classifyResponseShape('{"a":1}'), 'object');
  assert.equal(classifyResponseShape('<html>'), 'non-json');
  assert.equal(classifyResponseShape('null'), 'non-json');
  assert.equal(classifyResponseShape(null), 'non-json');
});

test('needsErrorStatusShapeDetail is true only for 400 and 500–599', () => {
  assert.equal(needsErrorStatusShapeDetail(400), true);
  assert.equal(needsErrorStatusShapeDetail(500), true);
  assert.equal(needsErrorStatusShapeDetail(503), true);
  assert.equal(needsErrorStatusShapeDetail(599), true);
  assert.equal(needsErrorStatusShapeDetail(200), false);
  assert.equal(needsErrorStatusShapeDetail(401), false);
  assert.equal(needsErrorStatusShapeDetail(404), false);
  assert.equal(needsErrorStatusShapeDetail(499), false);
});

test('formatErrorStatusDetail wording for 400 includes shape and expected status', () => {
  assert.equal(
    formatErrorStatusDetail({ actualStatus: 400, responseShape: 'object', expectedStatus: 200 }),
    'HTTP 400 (actual responseShape: object; expected status: 200)'
  );
});

test('formatErrorStatusDetail wording for 5xx includes shape and expected status', () => {
  assert.equal(
    formatErrorStatusDetail({ actualStatus: 503, responseShape: 'empty', expectedStatus: 200 }),
    'HTTP 503 (actual responseShape: empty; expected status: 200)'
  );
});

test('formatErrorStatusDetail keeps UNVERIFIED expected status (never flipped)', () => {
  assert.equal(
    formatErrorStatusDetail({
      actualStatus: 400,
      responseShape: 'non-json',
      expectedStatus: 'UNVERIFIED',
    }),
    'HTTP 400 (actual responseShape: non-json; expected status: UNVERIFIED)'
  );
});
