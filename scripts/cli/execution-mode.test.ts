/**
 * Execution-mode plan tests — resolveExecutionMode only; never spawn suites.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  EXECUTION_MODES,
  exitCodeWhenNotSpawning,
  planOnlyExitCode,
  resolveExecutionMode,
  type ResolveExecutionModeOptions,
} from './execution-mode';
import { PATHS } from '../lib/paths';

function pkgScripts(): Record<string, string> {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PATHS.root, 'package.json'), 'utf8')
  ) as { scripts: Record<string, string> };
  return pkg.scripts;
}

function opts(
  overrides: ResolveExecutionModeOptions = {}
): ResolveExecutionModeOptions {
  return {
    packageScripts: pkgScripts(),
    engineEnabled: {
      ai: false,
      dependencies: true,
      security: true,
      crossBrowser: true,
    },
    changeImpactMappings: [],
    ...overrides,
  };
}

describe('resolveExecutionMode — argv table', () => {
  for (const mode of ['smoke', 'regression', 'changed', 'critical', 'full'] as const) {
    it(`parses --mode=${mode}`, () => {
      const plan = resolveExecutionMode([`--mode=${mode}`], opts());
      assert.equal(plan.mode, mode);
    });
  }

  it('also accepts space-separated --mode smoke', () => {
    const plan = resolveExecutionMode(['--mode', 'smoke'], opts());
    assert.equal(plan.mode, 'smoke');
    assert.deepEqual(plan.npmScripts, ['test:smoke']);
  });
});

describe('resolveExecutionMode — default and unknown', () => {
  it('omitted --mode does not select full and does not spawn', () => {
    const plan = resolveExecutionMode([], opts());
    assert.equal(plan.mode, null);
    assert.equal(plan.spawn, false);
    assert.equal(plan.status, 'REQUIRES_CONFIGURATION');
    assert.ok(!plan.npmScripts.includes('qa:all'));
    assert.match(plan.reason, /missing required --mode/);
  });

  it('unknown --mode is non-spawn with reason naming the mode', () => {
    const plan = resolveExecutionMode(['--mode=not-a-mode'], opts());
    assert.equal(plan.spawn, false);
    assert.equal(plan.status, 'BLOCKED');
    assert.match(plan.reason, /unknown mode/);
    assert.match(plan.reason, /not-a-mode/);
    assert.deepEqual(plan.npmScripts, []);
  });

  it('--plan never sets spawn true for smoke', () => {
    const plan = resolveExecutionMode(['--mode=smoke', '--plan'], opts());
    assert.equal(plan.mode, 'smoke');
    assert.equal(plan.spawn, false);
    assert.ok(plan.notes.some((n) => /plan only/i.test(n)));
  });
});

describe('resolveExecutionMode — smoke / regression / full', () => {
  it('smoke plans test:smoke only', () => {
    const plan = resolveExecutionMode(['--mode=smoke'], opts());
    assert.deepEqual(plan.npmScripts, ['test:smoke']);
    assert.equal(plan.spawn, true);
  });

  it('regression plans test:regression only', () => {
    const plan = resolveExecutionMode(['--mode=regression'], opts());
    assert.deepEqual(plan.npmScripts, ['test:regression']);
    assert.equal(plan.spawn, true);
  });

  it('full plans qa:all and package.json qa:all still points at run-all.ts', () => {
    const scripts = pkgScripts();
    assert.match(scripts['qa:all'] ?? '', /scripts\/run-all\.ts/);
    const plan = resolveExecutionMode(['--mode=full'], opts({ packageScripts: scripts }));
    assert.deepEqual(plan.npmScripts, ['qa:all']);
    assert.equal(plan.spawn, true);
    assert.ok(plan.notes.some((n) => /explicit opt-in/i.test(n)));
  });
});

describe('resolveExecutionMode — critical', () => {
  it('critical lists PR slice scripts only (not visual/AI/cross-browser/heavy)', () => {
    const plan = resolveExecutionMode(['--mode=critical'], opts());
    assert.deepEqual(plan.npmScripts, [
      'test:unit',
      'test:smoke',
      'test:api',
      'test:e2e',
      'test:accessibility',
      'test:security',
    ]);
    assert.ok(!plan.npmScripts.includes('test:visual'));
    assert.ok(!plan.npmScripts.includes('test:ai'));
    assert.ok(!plan.npmScripts.includes('test:e2e:cross-browser'));
    assert.ok(!plan.npmScripts.includes('qa:all'));
    assert.ok(plan.notes.some((n) => /not a quality score/i.test(n)));
  });

  it('critical --plan does not spawn', () => {
    const plan = resolveExecutionMode(['--mode=critical', '--plan'], opts());
    assert.equal(plan.spawn, false);
  });
});

describe('resolveExecutionMode — scheduled', () => {
  it('scheduled plans scheduled-tier scripts with AI NOT_TESTED when disabled', () => {
    const plan = resolveExecutionMode(
      ['--mode=scheduled', '--plan'],
      opts({ engineEnabled: { ai: false, dependencies: true, security: true, crossBrowser: true } })
    );
    assert.equal(plan.spawn, false);
    assert.ok(plan.npmScripts.includes('test:dependencies'));
    assert.ok(plan.npmScripts.includes('test:e2e:cross-browser'));
    assert.ok(plan.npmScripts.includes('test:ai'));
    assert.ok(plan.npmScripts.includes('test:security'));
    const ai = plan.items.find((row) => row.npmScript === 'test:ai');
    assert.ok(ai);
    assert.equal(ai?.status, 'NOT_TESTED');
    assert.notEqual(plan.status, 'PASS');
  });
});

describe('resolveExecutionMode — changed', () => {
  it('changed with no files → NOT_IMPLEMENTED, empty scripts, no spawn', () => {
    const plan = resolveExecutionMode(['--mode=changed'], opts());
    assert.equal(plan.status, 'NOT_IMPLEMENTED');
    assert.equal(plan.spawn, false);
    assert.deepEqual(plan.npmScripts, []);
    assert.match(plan.reason, /not implemented/i);
  });

  it('changed with unmapped file plans regression fallback notes (no spawn)', () => {
    const plan = resolveExecutionMode(
      ['--mode=changed', '--files=src/unmapped/file.ts'],
      opts({ changeImpactMappings: [] })
    );
    assert.equal(plan.spawn, false);
    assert.equal(plan.status, 'PARTIAL');
    assert.deepEqual(plan.npmScripts, ['test:regression']);
    assert.ok(plan.notes.some((n) => /unmapped/i.test(n)));
    assert.ok(plan.notes.some((n) => /fallback/i.test(n) || /not a precise impact/i.test(n)));
  });
});

describe('resolveExecutionMode — single / type / category', () => {
  it('single missing --test → REQUIRES_CONFIGURATION', () => {
    const plan = resolveExecutionMode(['--mode=single'], opts());
    assert.equal(plan.status, 'REQUIRES_CONFIGURATION');
    assert.equal(plan.spawn, false);
    assert.match(plan.reason, /--test=/);
  });

  it('type unknown → BLOCKED, no spawn', () => {
    const plan = resolveExecutionMode(['--mode=type', '--type=not-a-real-type'], opts());
    assert.equal(plan.status, 'BLOCKED');
    assert.equal(plan.spawn, false);
    assert.match(plan.reason, /unknown test type/);
  });

  it('category unknown → BLOCKED, no spawn', () => {
    const plan = resolveExecutionMode(['--mode=category', '--category=not-real'], opts());
    assert.equal(plan.status, 'BLOCKED');
    assert.equal(plan.spawn, false);
    assert.match(plan.reason, /unknown category/);
  });

  it('category known is plan-only', () => {
    const plan = resolveExecutionMode(['--mode=category', '--category=functional'], opts());
    assert.equal(plan.spawn, false);
    assert.ok(plan.notes.some((n) => /plan only/i.test(n)));
    assert.notEqual(plan.status, 'PASS');
  });
});

describe('resolveExecutionMode — mode catalog completeness', () => {
  it('documents all expected mode names', () => {
    assert.deepEqual([...EXECUTION_MODES].sort(), [
      'category',
      'changed',
      'critical',
      'full',
      'regression',
      'scheduled',
      'single',
      'smoke',
      'type',
    ]);
  });
});

describe('exitCodeWhenNotSpawning', () => {
  it('explicit --plan keeps plan-only exit rules', () => {
    const smoke = resolveExecutionMode(['--mode=smoke', '--plan'], opts());
    assert.equal(planOnlyExitCode(smoke), 0);
    assert.equal(exitCodeWhenNotSpawning(smoke, true), 0);

    const changed = resolveExecutionMode(['--mode=changed'], opts());
    assert.equal(changed.status, 'NOT_IMPLEMENTED');
    assert.equal(planOnlyExitCode(changed), 1);
    assert.equal(exitCodeWhenNotSpawning(changed, true), 1);
  });

  it('non-spawn without --plan always exits 1 (category must not look like success)', () => {
    const category = resolveExecutionMode(['--mode=category', '--category=functional'], opts());
    assert.equal(category.spawn, false);
    assert.equal(exitCodeWhenNotSpawning(category, false), 1);

    const smokePlanShape = resolveExecutionMode(['--mode=smoke', '--plan'], opts());
    // Same plan shape as --plan, but without the flag → still exit 1.
    assert.equal(exitCodeWhenNotSpawning(smokePlanShape, false), 1);
  });
});
