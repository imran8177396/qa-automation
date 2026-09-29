import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths';
import {
  parseGenerationInventory,
  toGenerationInventory,
  type GenerationInventory,
  type GenerationInventoryScreen,
} from './generation-contract';
import type { ScreenInventory, TestableElement } from './screens';
import { generateFromInventory } from '../planning/generate-ui-checks';
import { resolveSafetyConfig } from '../core/safety-policy';

function screenInventoryFixture(): ScreenInventory {
  const elements: TestableElement[] = [
    {
      elementId: 'ELEMENT-001',
      screenId: 'SCREEN-010',
      type: 'email-input',
      category: 'input',
      label: 'Note email',
      required: true,
    },
    {
      elementId: 'ELEMENT-002',
      screenId: 'SCREEN-010',
      type: 'button',
      category: 'button',
      label: 'Save note',
    },
  ];
  return {
    screenId: 'SCREEN-010',
    url: '/notes',
    title: 'Notes',
    authenticationRequired: false,
    elements,
  };
}

test('toGenerationInventory + parseGenerationInventory round-trip keeps email-input and /notes', () => {
  const mapped = toGenerationInventory([screenInventoryFixture()]);
  assert.equal(mapped.version, '1');
  assert.equal(mapped.screens.length, 1);
  assert.equal(mapped.screens[0]?.screenId, 'SCREEN-010');
  assert.equal(mapped.screens[0]?.url, '/notes');
  assert.equal(mapped.screens[0]?.elements[0]?.type, 'email-input');
  assert.equal(mapped.screens[0]?.elements[0]?.category, 'input');
  assert.equal(mapped.screens[0]?.elements[0]?.required, true);
  assert.equal(mapped.screens[0]?.elements[1]?.type, 'button');
  assert.equal(mapped.screens[0]?.elements[1]?.required, undefined);

  const parsed = parseGenerationInventory(JSON.parse(JSON.stringify(mapped)));
  assert.equal(parsed.screens[0]?.elements[0]?.type, 'email-input');
  assert.equal(parsed.screens[0]?.url, '/notes');
  const blob = JSON.stringify(parsed);
  assert.doesNotMatch(blob, /\/users\/create/);
  assert.doesNotMatch(blob, /Create User/);
  assert.doesNotMatch(blob, /First Name/);
});

test('parseGenerationInventory rejects non-objects and never fills /users/create', () => {
  assert.throws(() => parseGenerationInventory(null), /object/);
  assert.throws(() => parseGenerationInventory([]), /object/);
  assert.throws(() => parseGenerationInventory('x'), /object/);
  assert.throws(
    () => parseGenerationInventory({ version: '1', screens: [{ screenId: 1, url: '/a', elements: [] }] }),
    /screenId/
  );
  const empty = parseGenerationInventory({ version: '1', screens: [] });
  assert.deepEqual(empty, { version: '1', screens: [] });
  assert.doesNotMatch(JSON.stringify(empty), /\/users\/create/);
});

test('empty inventory → generateFromInventory does not throw for lack of a login form', () => {
  const inventory: GenerationInventory = { version: '1', screens: [] };
  const checks = generateFromInventory(inventory, resolveSafetyConfig());
  assert.ok(Array.isArray(checks));
  assert.equal(
    checks.filter((c) => /login form/i.test(c.title) && c.status === 'FAIL').length,
    0
  );
  assert.doesNotMatch(JSON.stringify(checks), /\/users\/create/);
  assert.doesNotMatch(JSON.stringify(checks), /Create User/);
});

test('generateFromInventory plans from SCREEN-010 /notes without inventing Create User defaults', () => {
  const screen: GenerationInventoryScreen = {
    screenId: 'SCREEN-010',
    url: '/notes',
    elements: [
      {
        elementId: 'ELEMENT-001',
        type: 'email-input',
        category: 'input',
        label: 'Note email',
        required: true,
        screenId: 'SCREEN-010',
      },
      {
        elementId: 'ELEMENT-002',
        type: 'button',
        category: 'button',
        label: 'Save note',
        screenId: 'SCREEN-010',
      },
    ],
  };
  const checks = generateFromInventory({ version: '1', screens: [screen] }, resolveSafetyConfig());
  assert.ok(checks.length > 0);
  assert.ok(checks.some((c) => c.screenId === 'SCREEN-010' || c.targetUrl === '/notes'));
  assert.ok(checks.some((c) => c.targetElementId === 'ELEMENT-001'));
  const blob = JSON.stringify(checks);
  assert.doesNotMatch(blob, /\/users\/create/);
  assert.doesNotMatch(blob, /Create User/);
  assert.doesNotMatch(blob, /First Name/);
});

test('planning files do not import crawler, playwright, or run-discover', () => {
  for (const rel of [
    'scripts/planning/scenario-inventory.ts',
    'scripts/planning/write-planned-checks.ts',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const importLines = src
      .split(/\r?\n/)
      .filter((line) => /^\s*import\b/.test(line) || /^\s*from\s+['"]/.test(line))
      .join('\n');
    assert.doesNotMatch(importLines, /discovery\/crawler|['"]\.\/crawler['"]/);
    assert.doesNotMatch(importLines, /@playwright\/test|['"]playwright['"]/);
    assert.doesNotMatch(importLines, /run-discover/);
  }
});

test('generation-contract source has no demo hosts or create-user defaults', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'discovery', 'generation-contract.ts'), 'utf8');
  assert.doesNotMatch(src, /saucedemo|sauce\s*demo|swag\s*labs|jsonplaceholder/i);
  assert.doesNotMatch(src, /\/users\/create/);
  assert.doesNotMatch(src, /Create User/);
  assert.doesNotMatch(src, /First Name/);
});

test('run-discover write path persists generation-inventory via toGenerationInventory', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'discovery', 'run-discover.ts'), 'utf8');
  assert.match(src, /toGenerationInventory/);
  assert.match(src, /generationInventoryFile/);
  assert.match(src, /toGenerationInventory\s*\(\s*screenInventory\.inventories\s*\)/);
  assert.doesNotMatch(src, /toGenerationInventory\s*\([^)]*crawl/);
});
