import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChecks } from './generate-checks';
import { makeDiscoveredPage, makeDiscoveryResult } from '../testing/discovery-fixtures';
import type { DiscoveredPage } from '../discovery/types';
import type { ElementRecord, InventoryResult } from '../inventory/types';

function makeDiscovery(overrides: { pages: Array<Partial<DiscoveredPage>> }): ReturnType<typeof makeDiscoveryResult> {
  return makeDiscoveryResult(overrides.pages.map((page) => makeDiscoveredPage(page)));
}

function makeInventory(elements: ElementRecord[] = []): InventoryResult {
  return { generatedAt: new Date().toISOString(), pages: 1, elements };
}

function makeField(overrides: Partial<ElementRecord>): ElementRecord {
  return {
    page: 'https://example.com/',
    elementId: 'EL-0001',
    type: 'text-input',
    role: null,
    label: 'Field',
    locatorCandidates: ['#field'],
    visible: true,
    enabled: true,
    required: false,
    risk: 'safe',
    ...overrides,
  };
}

test('generateChecks() plans a BLOCKED page-sanity check for a page that failed to load', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/broken',
        status: null,
        ok: false,
        title: '',
        h1s: [],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
        error: 'net::ERR_CONNECTION_REFUSED',
      },
    ],
  });

  const checks = generateChecks(discovery, makeInventory());
  const check = checks.find((c) => c.kind === 'page-sanity');

  assert.ok(check);
  assert.equal(check!.status, 'BLOCKED');
  assert.match(check!.reason ?? '', /^BLOCKED:/);
});

test('generateChecks() plans a runnable page-sanity check for a normal page', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/about',
        status: 200,
        ok: true,
        title: 'About',
        h1s: ['About'],
        formCount: 0,
        linkCount: 3,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });

  const checks = generateChecks(discovery, makeInventory());
  const check = checks.find((c) => c.kind === 'page-sanity');

  assert.ok(check);
  assert.equal(check!.status, 'PLANNED');
  assert.equal(check!.expect?.requireH1, true);
});

test('generateChecks() plans a broken-link check for a 404 page', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/missing',
        status: 404,
        ok: false,
        title: '',
        h1s: [],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 1,
      },
    ],
  });

  const checks = generateChecks(discovery, makeInventory());
  assert.ok(checks.some((c) => c.kind === 'broken-link' && c.status === 'PLANNED'));
});

test('generateChecks() marks a destructive-risk field NOT_TESTED and never plans a check that submits', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/account',
        status: 200,
        ok: true,
        title: 'Account',
        h1s: ['Account'],
        formCount: 1,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([makeField({ label: 'Delete account', risk: 'destructive' })]);

  const checks = generateChecks(discovery, inventory);
  const fieldCheck = checks.find((c) => c.targetElementId === 'EL-0001');

  assert.ok(fieldCheck);
  assert.equal(fieldCheck!.status, 'NOT_TESTED');
  assert.match(fieldCheck!.reason ?? '', /^NOT_TESTED:/);
});

test('generateChecks() marks a field with no stable locator as REQUIRES_CONFIGURATION', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/form',
        status: 200,
        ok: true,
        title: 'Form',
        h1s: ['Form'],
        formCount: 1,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([makeField({ locatorCandidates: [] })]);

  const checks = generateChecks(discovery, inventory);
  const fieldCheck = checks.find((c) => c.targetElementId === 'EL-0001');

  assert.ok(fieldCheck);
  assert.equal(fieldCheck!.status, 'REQUIRES_CONFIGURATION');
});

test('generateChecks() plans presence + boundary checks for a safe required field, and always adds a not-exercised submit note per page', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/form',
        status: 200,
        ok: true,
        title: 'Form',
        h1s: ['Form'],
        formCount: 1,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([makeField({ required: true, risk: 'safe' })]);

  const checks = generateChecks(discovery, inventory);

  const presence = checks.find((c) => c.kind === 'form-presence' && c.status === 'PLANNED');
  const boundary = checks.find((c) => c.kind === 'form-boundary' && c.status === 'PLANNED');
  const notExercised = checks.find((c) => c.status === 'NOT_TESTED' && c.title.includes('submission'));

  assert.ok(presence, 'expected a PLANNED form-presence check');
  assert.ok(boundary, 'expected a PLANNED form-boundary check for a required field');
  assert.ok(notExercised, 'expected the per-page "submission intentionally not exercised" note');
});

test('generateChecks() never plans a check kind that implies clicking submit', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/form',
        status: 200,
        ok: true,
        title: 'Form',
        h1s: ['Form'],
        formCount: 1,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({ elementId: 'EL-0001', required: true, risk: 'safe' }),
    makeField({ elementId: 'EL-0002', label: 'Delete account', risk: 'destructive' }),
  ]);

  const checks = generateChecks(discovery, inventory);
  const allowedKinds = new Set(['page-sanity', 'broken-link', 'form-presence', 'form-boundary']);

  for (const check of checks) {
    assert.ok(allowedKinds.has(check.kind), `unexpected check kind: ${check.kind}`);
  }
});

test('generateChecks() collapses buttons that share an identical non-text locator into a single PLANNED check', () => {
  // A shared text= locator is handled by the ambiguity check above (downgraded to
  // REQUIRES_CONFIGURATION for every instance, since none can be reliably targeted). This test
  // covers the separate, narrower case of a stable locator (id/data-testid/aria-label) that
  // genuinely resolves to one element but happens to appear on more than one inventory record —
  // e.g. a duplicate data-testid from a markup mistake. Re-testing the same resolved element twice
  // isn't extra coverage.
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/gallery',
        status: 200,
        ok: true,
        title: 'Gallery',
        h1s: ['Gallery'],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({
      elementId: 'EL-0001',
      type: 'button',
      label: 'Previous slide',
      locatorCandidates: ['[data-testid="carousel-prev"]'],
      risk: 'safe',
    }),
    makeField({
      elementId: 'EL-0002',
      type: 'button',
      label: 'Previous slide',
      locatorCandidates: ['[data-testid="carousel-prev"]'],
      risk: 'safe',
    }),
  ]);

  const checks = generateChecks(discovery, inventory);
  const plannedForButton = checks.filter((c) => c.kind === 'form-presence' && c.status === 'PLANNED');

  assert.equal(plannedForButton.length, 1, 'expected duplicate-locator buttons to collapse to one check');
});

test('generateChecks() always produces globally unique check ids and titles (Playwright requires unique test titles)', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/gallery',
        status: 200,
        ok: true,
        title: 'Gallery',
        h1s: ['Gallery'],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({ elementId: 'EL-0001', type: 'button', label: 'Menu', locatorCandidates: ['text=Menu'], risk: 'safe' }),
    makeField({
      elementId: 'EL-0002',
      type: 'button',
      label: 'Menu',
      locatorCandidates: ['text=Menu'],
      risk: 'destructive',
    }),
  ]);

  const checks = generateChecks(discovery, inventory);
  const ids = checks.map((c) => c.id);
  const titles = checks.map((c) => `[${c.kind}] ${c.id} ${c.title}`);

  assert.equal(new Set(ids).size, ids.length, 'expected every check id to be unique');
  assert.equal(new Set(titles).size, titles.length, 'expected every rendered test title to be unique');
});

test('generateChecks() marks a not-visible-at-discovery element NOT_TESTED instead of planning a check that will always fail', () => {
  // Regression test: a mobile-only hamburger menu button (display:none at a desktop viewport,
  // e.g. Tailwind's `lg:hidden`) is a completely ordinary, common pattern — asserting toBeVisible()
  // on it unconditionally would be a false failure on every run, not a real defect.
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/',
        status: 200,
        ok: true,
        title: 'Home',
        h1s: ['Home'],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({ type: 'button', label: 'Toggle menu', locatorCandidates: ['[aria-label="Toggle menu"]'], visible: false }),
    makeField({ elementId: 'EL-0002', label: 'Newsletter email', visible: false }),
  ]);

  const checks = generateChecks(discovery, inventory);

  for (const check of checks) {
    if (check.kind !== 'form-presence' && check.kind !== 'form-boundary') continue;
    assert.notEqual(check.status, 'PLANNED', `expected a not-visible element to never be PLANNED: ${check.title}`);
  }

  const notTestedReasons = checks.filter((c) => c.status === 'NOT_TESTED').map((c) => c.reason ?? '');
  assert.ok(
    notTestedReasons.some((reason) => reason.includes('not visible')),
    'expected a NOT_TESTED reason explaining the element was not visible at discovery time'
  );
});

test('generateChecks() downgrades an ambiguous text= locator to REQUIRES_CONFIGURATION instead of asserting against it', () => {
  // Regression test for a real false-failure seen on a live site: a "Book a Call" button and an
  // unrelated "Book a Call" link (a mobile-only variant) both fell back to the same `text=` locator.
  // .first() resolved to the link (hidden on desktop), not the button that was actually inventoried
  // as visible — asserting toBeVisible() against it failed even though the real button was fine.
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/',
        status: 200,
        ok: true,
        title: 'Home',
        h1s: ['Home'],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({
      elementId: 'EL-0001',
      type: 'button',
      label: 'Book a Call',
      locatorCandidates: ['text=Book a Call'],
      visible: true,
      risk: 'safe',
    }),
    makeField({
      elementId: 'EL-0002',
      type: 'link',
      label: 'Book a Call',
      locatorCandidates: ['text=Book a Call'],
      visible: false,
      risk: 'safe',
    }),
  ]);

  const checks = generateChecks(discovery, inventory);
  const buttonCheck = checks.find((c) => c.targetElementId === 'EL-0001');

  assert.ok(buttonCheck);
  assert.equal(buttonCheck!.status, 'REQUIRES_CONFIGURATION');
  assert.match(buttonCheck!.reason ?? '', /ambiguous|matches more than one element/);
});

test('generateChecks() still plans a text= locator that is unique on the page', () => {
  const discovery = makeDiscovery({
    pages: [
      {
        url: 'https://example.com/',
        status: 200,
        ok: true,
        title: 'Home',
        h1s: ['Home'],
        formCount: 0,
        linkCount: 0,
        consoleErrors: [],
        failedRequests: [],
        depth: 0,
      },
    ],
  });
  const inventory = makeInventory([
    makeField({
      elementId: 'EL-0001',
      type: 'button',
      label: 'View Case Studies',
      locatorCandidates: ['text=View Case Studies'],
      visible: true,
      risk: 'safe',
    }),
  ]);

  const checks = generateChecks(discovery, inventory);
  const buttonCheck = checks.find((c) => c.targetElementId === 'EL-0001');

  assert.ok(buttonCheck);
  assert.equal(buttonCheck!.status, 'PLANNED');
});
