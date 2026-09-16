import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleValues } from './sample-values';

test('sampleValues() for password uses a synthetic fill value, not a real credential', () => {
  const values = sampleValues('password');
  assert.equal(values.valid, 'SamplePass_qa');
  assert.ok(values.invalid);
  assert.ok(values.long.length >= 512);
  assert.ok(!/secret_sauce|password123/i.test(`${values.valid}${values.invalid}`));
});

test('sampleValues() for text includes an invalid fill sample without claiming HTML5 invalidity', () => {
  const values = sampleValues('text');
  assert.equal(values.valid, 'Sample text');
  assert.ok(values.invalid);
});
