import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from '../lib/paths';
import { writePerformanceStageSummary } from './write-stage-summary';

describe('writePerformanceStageSummary', () => {
  it('copies jmeter status and targetSource=website from summary.json', () => {
    fs.mkdirSync(PATHS.reports.jmeter, { recursive: true });
    fs.mkdirSync(PATHS.reports.performance, { recursive: true });
    const previous = fs.existsSync(PATHS.jmeterSummary)
      ? fs.readFileSync(PATHS.jmeterSummary, 'utf8')
      : null;
    const previousStage = fs.existsSync(PATHS.performanceStageSummary)
      ? fs.readFileSync(PATHS.performanceStageSummary, 'utf8')
      : null;
    try {
      fs.writeFileSync(
        PATHS.jmeterSummary,
        JSON.stringify({
          ranAt: '2026-09-30T13:18:03.677Z',
          profile: 'liveness',
          status: 'RECORDED',
          heavy: false,
          authorized: true,
          skipped: false,
          skipReason: null,
          blocked: false,
          blockReason: null,
          targetSource: 'website',
          jmeterAvailable: true,
          target: 'https://www.example.test/',
          host: 'www.example.test',
          method: 'GET',
          path: '/',
          plan: 'reports/jmeter/website-liveness.jmx',
          threads: 1,
          rampUpSeconds: 1,
          loopCount: 1,
          durationSeconds: null,
          metrics: null,
          samples: [],
          thresholds: { status: 'RECORDED', defined: false, note: 'n/a', comparisons: [] },
        }),
        'utf8'
      );
      const stage = writePerformanceStageSummary({
        command: 'unit-test',
        authorizeHeavy: false,
        profile: 'liveness',
      });
      assert.equal(stage.jmeter.status, 'RECORDED');
      assert.equal(stage.jmeter.targetSource, 'website');
      assert.match(stage.jmeter.note ?? '', /website under test/i);
      assert.match(stage.jmeter.note ?? '', /RECORDED, not PASS/);
      assert.doesNotMatch(stage.jmeter.note ?? '', /\bstatus PASS\b/);
      assert.notEqual(stage.jmeter.status, 'PASS');
    } finally {
      if (previous == null) fs.rmSync(PATHS.jmeterSummary, { force: true });
      else fs.writeFileSync(PATHS.jmeterSummary, previous, 'utf8');
      if (previousStage == null) fs.rmSync(PATHS.performanceStageSummary, { force: true });
      else fs.writeFileSync(PATHS.performanceStageSummary, previousStage, 'utf8');
    }
  });

  it('omits website note when targetSource is api', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-stage-'));
    // Exercise the note helper indirectly via a website→api swap on the real path,
    // restoring afterward (same pattern as the website case).
    fs.mkdirSync(PATHS.reports.jmeter, { recursive: true });
    const previous = fs.existsSync(PATHS.jmeterSummary)
      ? fs.readFileSync(PATHS.jmeterSummary, 'utf8')
      : null;
    const previousStage = fs.existsSync(PATHS.performanceStageSummary)
      ? fs.readFileSync(PATHS.performanceStageSummary, 'utf8')
      : null;
    try {
      fs.writeFileSync(
        PATHS.jmeterSummary,
        JSON.stringify({
          ranAt: '2026-09-30T13:18:03.677Z',
          profile: 'liveness',
          status: 'RECORDED',
          heavy: false,
          authorized: true,
          skipped: false,
          skipReason: null,
          blocked: false,
          blockReason: null,
          targetSource: 'api',
          jmeterAvailable: true,
          target: 'https://api.example.test/posts',
          host: 'api.example.test',
          method: 'GET',
          path: '/posts',
          plan: 'tests/performance/load-test.jmx',
          threads: 1,
          rampUpSeconds: 1,
          loopCount: 1,
          durationSeconds: null,
          metrics: null,
          samples: [],
          thresholds: { status: 'RECORDED', defined: false, note: 'n/a', comparisons: [] },
        }),
        'utf8'
      );
      const stage = writePerformanceStageSummary({ command: 'unit-test', profile: 'liveness' });
      assert.equal(stage.jmeter.targetSource, 'api');
      assert.equal(stage.jmeter.note, undefined);
    } finally {
      if (previous == null) fs.rmSync(PATHS.jmeterSummary, { force: true });
      else fs.writeFileSync(PATHS.jmeterSummary, previous, 'utf8');
      if (previousStage == null) fs.rmSync(PATHS.performanceStageSummary, { force: true });
      else fs.writeFileSync(PATHS.performanceStageSummary, previousStage, 'utf8');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
