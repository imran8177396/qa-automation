/**
 * Engine self-contract — verifies platform registry honesty and core contract invariants.
 * Does not execute qa:all, Playwright, Postman, JMeter, or live hosts.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { describe, it } from 'node:test';
import { buildEngineSummary, makeResult } from '../engine-contract';
import { loadConfig } from '../../lib/load-config';
import { PATHS } from '../../lib/paths';
import { preserveEngineStatus } from '../../lib/qa-report/collect-engine-results';
import { evaluateReleaseGate } from '../../orchestrator/quality-gate';
import { PLATFORM_CAPABILITIES, TESTING_CAPABILITIES, gateDependents } from './index';

describe('engine self-contract', () => {
  it('PLATFORM_CAPABILITIES includes observability, safety-budget, quality-gate', () => {
    const ids = PLATFORM_CAPABILITIES.map((row) => row.id);
    assert.ok(ids.includes('observability'));
    assert.ok(ids.includes('safety-budget'));
    assert.ok(ids.includes('quality-gate'));
    assert.ok(ids.includes('project-isolation'));
    assert.ok(ids.includes('plugin-architecture'));
  });

  it('TESTING_CAPABILITIES still has 10 optional ids and none are IMPLEMENTED', () => {
    assert.equal(TESTING_CAPABILITIES.length, 10);
    for (const cap of TESTING_CAPABILITIES) {
      assert.notEqual(cap.status, 'IMPLEMENTED');
    }
  });

  it('makeResult NOT_TESTED without a reason throws; with a reason stays NOT_TESTED', () => {
    assert.throws(
      () =>
        makeResult({
          id: 'x',
          testType: 'unit',
          category: 'functional',
          name: 'x',
          status: 'NOT_TESTED',
        }),
      /reason/i
    );
    const ok = makeResult({
      id: 'x',
      testType: 'unit',
      category: 'functional',
      name: 'x',
      status: 'NOT_TESTED',
      error: { message: 'not run in this contract' },
    });
    assert.equal(ok.status, 'NOT_TESTED');
    assert.notEqual(ok.status, 'PASS');
    assert.equal(typeof ok.metadata?.executionId, 'string');
  });

  it('makeResult redacts secrets and keeps quarantine FAIL', () => {
    const secret = makeResult({
      id: 'sec',
      testType: 'unit',
      category: 'functional',
      name: 'sec',
      status: 'FAIL',
      error: { message: 'login password=s3cret failed' },
    });
    assert.doesNotMatch(secret.error!.message, /s3cret/);

    const quarantined = makeResult({
      id: 'q',
      testType: 'unit',
      category: 'functional',
      name: 'q',
      status: 'FAIL',
      metadata: { quarantine: true },
    });
    assert.equal(quarantined.status, 'FAIL');
  });

  it('buildEngineSummary labels safety read-only by default', () => {
    const summary = buildEngineSummary({
      engine: 'self',
      testType: 'unit',
      results: [],
    });
    assert.equal(summary.safety?.mode, 'read-only');
  });

  it('loadConfig still returns empty website/api and does not throw', () => {
    const config = loadConfig();
    assert.equal(config.urls.website, '');
    assert.equal(config.urls.api, '');
    assert.equal(config.project?.id ?? 'default', 'default');
    assert.equal(config.execution?.parallel ?? false, false);
    assert.equal(config.qualityGate?.blockRelease ?? false, false);
  });

  it('release gate default does not block', () => {
    const gate = evaluateReleaseGate({ criticalFailures: 10, coveragePct: 0 }, {});
    assert.equal(gate.block, false);
    assert.deepEqual(gate.reasons, []);

    const fromConfig = evaluateReleaseGate(
      { criticalFailures: 50 },
      loadConfig().qualityGate ?? {}
    );
    assert.equal(fromConfig.block, false);
  });

  it('gateDependents is exported from platform index for callers', () => {
    assert.equal(typeof gateDependents, 'function');
  });

  it('normalized engine row status NOT_TESTED is not PASS', () => {
    assert.equal(preserveEngineStatus('NOT_TESTED'), 'NOT_TESTED');
    assert.notEqual(preserveEngineStatus('NOT_TESTED'), 'PASS');
  });

  it('package.json still contains required scripts', () => {
    const pkgPath = path.join(PATHS.root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const name of ['qa:all', 'test:e2e', 'test:api', 'coverage', 'retest', 'report:all']) {
      assert.ok(typeof pkg.scripts[name] === 'string' && pkg.scripts[name].length > 0, name);
    }
  });
});
