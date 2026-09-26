import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ARTIFACT_DIRECTORIES,
  ARTIFACT_KINDS,
  ARTIFACT_ROOT,
  attachArtifactsToResult,
  registerArtifact,
  type ArtifactKind,
} from './artifacts';
import { formatEngineEvidence } from './qa-report/collect-engine-results';
import { PATHS } from './paths';
import type { TestResult } from '../core/engine-contract';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-artifacts-'));

before(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function baseInput(kind: ArtifactKind, fileName: string) {
  return {
    kind,
    runId: 'run-1',
    testId: 'test-a',
    fileName,
    artifactRoot: tmpRoot,
  };
}

describe('artifact registry — single shared root', () => {
  it('every kind resolves under the same artifact root (PATHS.reports.evidence)', () => {
    const roots = new Set(ARTIFACT_KINDS.map((kind) => ARTIFACT_DIRECTORIES[kind]));
    assert.equal(roots.size, 1);
    assert.equal([...roots][0], PATHS.reports.evidence);
    assert.equal(ARTIFACT_ROOT, PATHS.reports.evidence);

    for (const kind of ARTIFACT_KINDS) {
      const ref = registerArtifact({
        ...baseInput(kind, `sample-${kind}.bin`),
        write: false,
      });
      assert.equal(ref.kind, kind);
      assert.match(ref.relativePath, new RegExp(`${kind}`));
      assert.equal(ref.written, false);
      // Leaf uses kind as prefix segment, not a per-kind directory.
      assert.ok(!ref.relativePath.includes(`/${kind}/`));
      assert.ok(ref.relativePath.includes(`--${kind}--`));
    }
  });

  it('jmeter-jtl and playwright-trace do not get their own directory names', () => {
    const jtl = registerArtifact({ ...baseInput('jmeter-jtl', 'results.jtl'), write: false });
    const pw = registerArtifact({ ...baseInput('playwright-trace', 'trace.zip'), write: false });
    assert.equal(ARTIFACT_DIRECTORIES['jmeter-jtl'], ARTIFACT_DIRECTORIES['playwright-trace']);
    assert.equal(ARTIFACT_DIRECTORIES['jmeter-jtl'], PATHS.reports.evidence);
    // Kind appears only as a filename prefix segment, never as a directory.
    assert.equal(/[/\\]jmeter[/\\]/.test(jtl.relativePath), false);
    assert.equal(/[/\\]playwright[/\\]/.test(pw.relativePath), false);
    assert.match(jtl.relativePath, /--jmeter-jtl--/);
    assert.match(pw.relativePath, /--playwright-trace--/);
  });

  it('module source does not define per-engine artifact directory roots', () => {
    const source = fs.readFileSync(path.join(__dirname, 'artifacts.ts'), 'utf8');
    assert.equal(/reports\/playwright/.test(source), false);
    assert.equal(/reports\/postman/.test(source), false);
    assert.equal(/reports\/jmeter/.test(source), false);
  });
});

describe('artifact path safety', () => {
  it('rejects path traversal in fileName', () => {
    assert.throws(
      () =>
        registerArtifact({
          kind: 'log',
          runId: 'run-1',
          testId: 'test-a',
          fileName: '../escape.log',
          artifactRoot: tmpRoot,
        }),
      /\.\.|path separators/i
    );
  });

  it('rejects absolute fileName', () => {
    assert.throws(
      () =>
        registerArtifact({
          kind: 'log',
          runId: 'run-1',
          testId: 'test-a',
          fileName: path.resolve(tmpRoot, 'abs.log'),
          artifactRoot: tmpRoot,
        }),
      /absolute/i
    );
  });

  it('rejects empty runId / testId with REQUIRES_CONFIGURATION', () => {
    assert.throws(
      () =>
        registerArtifact({
          kind: 'log',
          runId: '',
          testId: 't1',
          fileName: 'a.log',
        }),
      /REQUIRES_CONFIGURATION/
    );
    assert.throws(
      () =>
        registerArtifact({
          kind: 'log',
          runId: 'r1',
          testId: '  ',
          fileName: 'a.log',
        }),
      /REQUIRES_CONFIGURATION/
    );
  });

  it('unknown kind throws', () => {
    assert.throws(
      () =>
        registerArtifact({
          kind: 'not-a-kind' as ArtifactKind,
          runId: 'run-1',
          testId: 'test-a',
          fileName: 'x.bin',
        }),
      /Unknown artifact kind/
    );
  });
});

describe('artifact write / mask behavior', () => {
  it('write false → written false, and no file created', () => {
    const ref = registerArtifact({
      ...baseInput('log', 'declared.log'),
      content: 'password=password-fixture token=token-fixture',
      write: false,
    });
    assert.equal(ref.written, false);
    const expectedPath = path.join(tmpRoot, 'run-1', 'test-a--log--declared.log');
    assert.equal(fs.existsSync(expectedPath), false);
  });

  it('masks password-fixture / token-fixture when write is exercised against tmpdir', () => {
    const ref = registerArtifact({
      ...baseInput('log', 'secrets.log'),
      content: 'login password=password-fixture api_token=token-fixture ok',
      write: true,
    });
    assert.equal(ref.written, true);
    assert.equal(ref.masked, true);
    const absolute = path.join(tmpRoot, 'run-1', 'test-a--log--secrets.log');
    assert.ok(fs.existsSync(absolute));
    const body = fs.readFileSync(absolute, 'utf8');
    assert.equal(body.includes('password-fixture'), false);
    assert.equal(body.includes('token-fixture'), false);
    assert.match(body, /\[MASKED\]|\[REDACTED\]/);
  });

  it('binary kinds with write do not text-scan content', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const ref = registerArtifact({
      ...baseInput('screenshot', 'tiny.png'),
      content: bytes,
      write: true,
    });
    assert.equal(ref.written, true);
    assert.equal(ref.byteLength, bytes.byteLength);
    const absolute = path.join(tmpRoot, 'run-1', 'test-a--screenshot--tiny.png');
    assert.deepEqual(new Uint8Array(fs.readFileSync(absolute)), bytes);
  });
});

describe('existing PATHS pointer', () => {
  it('records relative path under PATHS without copying', () => {
    const relativePath = path
      .relative(PATHS.root, PATHS.jmeterResults)
      .replace(/\\/g, '/');
    const ref = registerArtifact({
      kind: 'jmeter-jtl',
      runId: 'run-1',
      testId: 'perf-1',
      fileName: 'results.jtl',
      source: 'existing',
      relativePath,
    });
    assert.equal(ref.source, 'existing');
    assert.equal(ref.written, false);
    assert.equal(ref.relativePath, relativePath);
  });

  it('rejects existing path traversal', () => {
    assert.throws(
      () =>
        registerArtifact({
          kind: 'log',
          runId: 'run-1',
          testId: 't1',
          fileName: 'x.log',
          source: 'existing',
          relativePath: 'reports/../qa.config.json',
        }),
      /\.\./
    );
  });
});

describe('attachArtifactsToResult', () => {
  it('does not change a FAIL to PASS', () => {
    const fail: TestResult = {
      id: 't-fail',
      testType: 'smoke',
      category: 'functional',
      name: 'failing check',
      status: 'FAIL',
      error: { message: 'assertion failed' },
    };
    const ref = registerArtifact({
      ...baseInput('screenshot', 'shot.png'),
      write: false,
    });
    const attached = attachArtifactsToResult(fail, [ref]);
    assert.equal(attached.status, 'FAIL');
    assert.equal(attached.evidence?.artifacts?.length, 1);
    assert.equal(attached.evidence?.artifacts?.[0].written, false);
    // Declaration must not appear as captured evidence in the report column.
    assert.equal(formatEngineEvidence(attached.evidence), 'none');
  });

  it('lists written relative paths in the Evidence column', () => {
    const pass: TestResult = {
      id: 't-pass',
      testType: 'smoke',
      category: 'functional',
      name: 'ok',
      status: 'PASS',
    };
    const ref = registerArtifact({
      ...baseInput('log', 'run.log'),
      content: 'all good',
      write: true,
    });
    const attached = attachArtifactsToResult(pass, [ref]);
    assert.equal(attached.status, 'PASS');
    const column = formatEngineEvidence(attached.evidence);
    assert.match(column, /run\.log/);
    assert.equal(column.includes(path.resolve(tmpRoot)), false);
  });
});
