import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { restoreDirectory, snapshotDirectory } from './preserve';

describe('retest evidence preserve', () => {
  it('copies a source tree without deleting the original FAIL file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-retest-preserve-'));
    const source = path.join(root, 'failures');
    const dest = path.join(root, 'original', 'failures');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'summary.json'), '{"totalFailures":1}\n', 'utf8');

    assert.equal(snapshotDirectory(source, dest), true);
    assert.equal(fs.existsSync(path.join(source, 'summary.json')), true);
    assert.equal(fs.readFileSync(path.join(source, 'summary.json'), 'utf8'), '{"totalFailures":1}\n');
    assert.equal(fs.readFileSync(path.join(dest, 'summary.json'), 'utf8'), '{"totalFailures":1}\n');

    fs.writeFileSync(path.join(source, 'summary.json'), '{"wiped":true}\n', 'utf8');
    restoreDirectory(dest, source);
    assert.equal(fs.readFileSync(path.join(source, 'summary.json'), 'utf8'), '{"totalFailures":1}\n');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns false when the source directory is missing — does not invent evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-retest-missing-'));
    assert.equal(snapshotDirectory(path.join(root, 'absent'), path.join(root, 'dest')), false);
    assert.equal(fs.existsSync(path.join(root, 'dest')), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
