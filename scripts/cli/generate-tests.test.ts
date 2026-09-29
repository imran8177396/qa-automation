/**
 * Generate-tests CLI plan tests — resolveGenerateTestsPlan only.
 * Uses in-memory inventories; must not read qa.last-target.json or crawl.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  generateTestsExitCode,
  resolveGenerateTestsPlan,
} from './generate-tests';
import type { GenerationInventory } from '../discovery/generation-contract';
import { PATHS, ROOT } from '../lib/paths';

function inventoryWithScreen(screenId: string): GenerationInventory {
  return {
    version: '1',
    screens: [
      {
        screenId,
        url: '/form',
        title: 'Form',
        elements: [
          {
            elementId: 'ELEMENT-001',
            type: 'text-input',
            category: 'input',
            label: 'Name',
            screenId,
          },
        ],
      },
    ],
  };
}

function inventoryWithLoginAndSearch(): GenerationInventory {
  return {
    version: '1',
    screens: [
      {
        screenId: 'SCREEN-LOGIN',
        url: '/login',
        title: 'Login',
        elements: [
          {
            elementId: 'ELEMENT-USER',
            type: 'text-input',
            category: 'input',
            label: 'Username',
            screenId: 'SCREEN-LOGIN',
          },
          {
            elementId: 'ELEMENT-PASS',
            type: 'password-input',
            category: 'input',
            label: 'Password',
            screenId: 'SCREEN-LOGIN',
          },
          {
            elementId: 'ELEMENT-SEARCH',
            type: 'search-field',
            category: 'input',
            label: 'Search',
            screenId: 'SCREEN-LOGIN',
          },
        ],
      },
    ],
  };
}

describe('resolveGenerateTestsPlan — screen filter', () => {
  it('--generate-tests --screen=SCREEN-004 keeps only that screenId', () => {
    const inventory = inventoryWithScreen('SCREEN-004');
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--screen=SCREEN-004'],
      { inventory }
    );
    assert.equal(plan.filter.screenId, 'SCREEN-004');
    assert.equal(plan.filter.full, false);
    assert.ok(plan.kept.length > 0);
    assert.ok(plan.kept.every((c) => c.screenId === 'SCREEN-004'));
    assert.equal(generateTestsExitCode(plan), 0);
    assert.equal(plan.spawn, false);
  });

  it('missing screen id → NOT_TESTED, empty kept, exit 1', () => {
    const inventory = inventoryWithScreen('SCREEN-001');
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--screen=SCREEN-004'],
      { inventory }
    );
    assert.equal(plan.status, 'NOT_TESTED');
    assert.match(plan.reason, /screen was not in the discovery inventory/);
    assert.deepEqual(plan.kept, []);
    assert.equal(generateTestsExitCode(plan), 1);
    assert.equal(plan.spawn, false);
  });
});

describe('resolveGenerateTestsPlan — category filter', () => {
  it('--category=negative keeps only negative', () => {
    const inventory = inventoryWithScreen('SCREEN-001');
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--category=negative'],
      { inventory }
    );
    assert.equal(plan.filter.category, 'negative');
    assert.ok(plan.kept.length > 0);
    assert.ok(
      plan.kept.every(
        (c) =>
          c.category === 'negative' ||
          c.scenario === 'negative' ||
          c.category.toLowerCase() === 'negative'
      )
    );
    assert.equal(generateTestsExitCode(plan), 0);
  });

  it('--category=nope → invalid, spawn false, exit 1', () => {
    const inventory = inventoryWithScreen('SCREEN-001');
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--category=nope'],
      { inventory }
    );
    assert.equal(plan.spawn, false);
    assert.equal(plan.status, 'BLOCKED');
    assert.match(plan.reason, /unknown category/);
    assert.match(plan.reason, /nope/);
    assert.deepEqual(plan.kept, []);
    assert.equal(generateTestsExitCode(plan), 1);
  });
});

describe('resolveGenerateTestsPlan — critical / full / changed / mode', () => {
  it('--critical drops unspecified and medium', () => {
    const inventory = inventoryWithLoginAndSearch();
    const full = resolveGenerateTestsPlan(['--generate-tests', '--full'], {
      inventory,
    });
    assert.ok(full.kept.some((c) => c.priority === 'unspecified' || c.priority === 'medium'));

    const plan = resolveGenerateTestsPlan(['--generate-tests', '--critical'], {
      inventory,
    });
    assert.equal(plan.filter.critical, true);
    assert.ok(plan.kept.length > 0);
    assert.ok(plan.kept.every((c) => c.priority === 'critical'));
    assert.ok(!plan.kept.some((c) => c.priority === 'unspecified'));
    assert.ok(!plan.kept.some((c) => c.priority === 'medium'));
    assert.ok(plan.kept.length < full.kept.length);
    assert.equal(generateTestsExitCode(plan), 0);
  });

  it('--full does not set a screen filter', () => {
    const inventory = inventoryWithScreen('SCREEN-004');
    const plan = resolveGenerateTestsPlan(['--generate-tests', '--full'], {
      inventory,
    });
    assert.equal(plan.filter.full, true);
    assert.equal(plan.filter.screenId, null);
    assert.equal(plan.filter.category, null);
    assert.equal(plan.filter.critical, false);
    assert.ok(plan.kept.length > 0);
    assert.equal(generateTestsExitCode(plan), 0);
  });

  it('bare --generate-tests is the same as --full', () => {
    const inventory = inventoryWithScreen('SCREEN-001');
    const bare = resolveGenerateTestsPlan(['--generate-tests'], { inventory });
    const full = resolveGenerateTestsPlan(['--generate-tests', '--full'], {
      inventory,
    });
    assert.equal(bare.filter.full, true);
    assert.equal(full.filter.full, true);
    assert.equal(bare.filter.screenId, null);
    assert.equal(bare.kept.length, full.kept.length);
  });

  it('--changed with no files → NOT_IMPLEMENTED', () => {
    const plan = resolveGenerateTestsPlan(['--generate-tests', '--changed'], {
      inventory: inventoryWithScreen('SCREEN-001'),
    });
    assert.equal(plan.status, 'NOT_IMPLEMENTED');
    assert.equal(plan.spawn, false);
    assert.deepEqual(plan.kept, []);
    assert.deepEqual(plan.regenerated, []);
    assert.equal(generateTestsExitCode(plan), 1);
  });

  it('--changed with files and empty mappings → UNMAPPED, exit 1', () => {
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--changed', '--files=src/app.ts'],
      {
        inventory: inventoryWithScreen('SCREEN-001'),
        changeAwareMappings: [],
      }
    );
    assert.equal(plan.status, 'UNMAPPED');
    assert.equal(plan.spawn, false);
    assert.deepEqual(plan.regenerated, []);
    assert.deepEqual(plan.unmappedFiles, ['src/app.ts']);
    assert.match(plan.reason, /full inventory was not regenerated/);
    assert.equal(generateTestsExitCode(plan), 1);
  });

  it('--changed with mapped screen regenerates subset, exit 0', () => {
    const inventory: GenerationInventory = {
      version: '1',
      screens: [
        {
          screenId: 'SCREEN-1',
          url: '/login',
          title: 'Login',
          elements: [
            {
              elementId: 'ELEMENT-USER',
              type: 'text-input',
              category: 'input',
              label: 'Username',
              screenId: 'SCREEN-1',
            },
          ],
        },
        {
          screenId: 'SCREEN-2',
          url: '/other',
          title: 'Other',
          elements: [
            {
              elementId: 'ELEMENT-OTHER',
              type: 'text-input',
              category: 'input',
              label: 'Other',
              screenId: 'SCREEN-2',
            },
          ],
        },
      ],
    };
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--changed', '--files=src/login/form.ts'],
      {
        inventory,
        changeAwareMappings: [
          { pathPrefix: 'src/login', screenIds: ['SCREEN-1'] },
        ],
      }
    );
    assert.equal(plan.status, 'UPDATED');
    assert.ok((plan.regenerated?.length ?? 0) > 0);
    assert.ok(plan.regenerated?.every((c) => c.screenId === 'SCREEN-1'));
    assert.ok((plan.preserved?.length ?? 0) > 0);
    assert.ok(
      plan.preserved?.every((c) => c.screenId !== 'SCREEN-1'),
      'preserved must not include regenerated SCREEN-1 cases'
    );
    assert.ok(
      plan.preserved?.some((c) => c.screenId === 'SCREEN-2'),
      'SCREEN-2 cases must remain preserved'
    );
    assert.equal(generateTestsExitCode(plan), 0);
    assert.equal(plan.spawn, false);
  });

  it('--changed with diff-file text parses without git spawn', () => {
    const inventory = inventoryWithScreen('SCREEN-1');
    // Re-tag inventory screen for mapping
    inventory.screens[0]!.screenId = 'SCREEN-1';
    inventory.screens[0]!.elements[0]!.screenId = 'SCREEN-1';
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--changed'],
      {
        inventory,
        gitDiff:
          'diff --git a/src/login/a.ts b/src/login/a.ts\n+++ b/src/login/a.ts',
        changeAwareMappings: [
          { pathPrefix: 'src/login', screenIds: ['SCREEN-1'] },
        ],
      }
    );
    assert.equal(plan.status, 'UPDATED');
    assert.ok((plan.regenerated?.length ?? 0) > 0);
    assert.equal(generateTestsExitCode(plan), 0);
  });

  it('--changed prefix-only mapping → UNMAPPED', () => {
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--changed', '--files=src/login/form.ts'],
      {
        inventory: inventoryWithScreen('SCREEN-1'),
        changeAwareMappings: [{ pathPrefix: 'src/login' }],
      }
    );
    assert.equal(plan.status, 'UNMAPPED');
    assert.equal(generateTestsExitCode(plan), 1);
  });

  it('--generate-tests --mode=smoke → rejected', () => {
    const plan = resolveGenerateTestsPlan(
      ['--generate-tests', '--mode=smoke'],
      { inventory: inventoryWithScreen('SCREEN-001') }
    );
    assert.equal(plan.status, 'BLOCKED');
    assert.match(plan.reason, /generate-tests and --mode cannot be combined/);
    assert.equal(plan.spawn, false);
    assert.equal(generateTestsExitCode(plan), 1);
  });

  it('options.inventory null → REQUIRES_CONFIGURATION', () => {
    const plan = resolveGenerateTestsPlan(['--generate-tests'], {
      inventory: null,
    });
    assert.equal(plan.status, 'REQUIRES_CONFIGURATION');
    assert.match(plan.reason, /discovery inventory is missing/);
    assert.match(plan.reason, /does not crawl/);
    assert.deepEqual(plan.kept, []);
    assert.equal(generateTestsExitCode(plan), 1);
  });
});

describe('resolveGenerateTestsPlan — isolation', () => {
  it('module source does not read qa.last-target.json', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cli', 'generate-tests.ts'),
      'utf8'
    );
    assert.doesNotMatch(src, /qa\.last-target\.json/);
    assert.doesNotMatch(src, /readFileSync|writeFileSync|existsSync/);
    assert.doesNotMatch(src, /from ['"].*crawler|from ['"].*run-discover|@playwright\/test/);
    assert.doesNotMatch(src, /spawnSync|execSync|execFileSync/);
    assert.doesNotMatch(src, /\bgit\s*\(/);
  });

  it('does not invent SCREEN-004 as a default', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'scripts', 'cli', 'generate-tests.ts'),
      'utf8'
    );
    assert.doesNotMatch(src, /SCREEN-004/);
    const plan = resolveGenerateTestsPlan(['--generate-tests', '--full'], {
      inventory: inventoryWithScreen('SCREEN-001'),
    });
    assert.equal(plan.filter.screenId, null);
  });

  it('PATHS.generatedTestsFile is under reports/coverage', () => {
    assert.equal(
      PATHS.generatedTestsFile,
      path.join(ROOT, 'reports', 'coverage', 'generated-tests.json')
    );
  });
});
