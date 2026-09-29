/**
 * Workflow path planning — node:test only, no browser.
 * Evidence-only chains from discovered edges; never invents demo Login→Delete flows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicableTestTypes } from '../discovery/test-types';
import type { NavigationEntry, PageMap, PageMapEntry } from '../discovery/page-map';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import { resolveSafetyConfig } from '../core/safety-policy';
import { buildScenarioInventory } from './scenario-inventory';
import {
  buildSimplePaths,
  buildWorkflowCases,
  collectWorkflowEdges,
  MAX_SIMPLE_PATHS,
  selectWorkflowChains,
  stableEdgeId,
} from './workflow-cases';

const HOST = 'http://app.test';

function page(route: string, status = 200): PageMapEntry {
  return {
    url: `${HOST}${route}`,
    route,
    title: route,
    status,
    ok: status < 400,
    depth: 0,
    h1s: status < 400 ? ['Heading'] : [],
    applicableTestTypes: applicableTestTypes('pages'),
  };
}

function edge(from: string, to: string, inScope = true): NavigationEntry {
  return {
    from: `${HOST}${from}`,
    to: `${HOST}${to}`,
    linkText: `${from}→${to}`,
    inScope,
    applicableTestTypes: applicableTestTypes('pages'),
    potentialAction: 'navigate',
  };
}

function pageMap(pages: PageMapEntry[], navigation: NavigationEntry[]): PageMap {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: `${HOST}/`,
    scopeHost: 'app.test',
    truncated: false,
    pages,
    routes: pages.map((p) => ({ path: p.route, url: p.url, title: p.title, source: 'crawl' as const })),
    navigation,
    skippedByScope: [],
    categoryStatus: [],
  };
}

function element(overrides: Partial<UiElementRecord>): UiElementRecord {
  return {
    page: `${HOST}/a`,
    elementId: 'UI-0001',
    elementType: 'button',
    locator: 'text=x',
    locatorCandidates: ['text=x'],
    accessibleName: 'x',
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'click',
    applicableTestTypes: ['form-presence'],
    discoveryStatus: 'DISCOVERED',
    evidence: 'button',
    ...overrides,
  };
}

function ui(elements: UiElementRecord[]): UiInventory {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl: `${HOST}/`,
    pagesScanned: 1,
    elements,
    categoryStatus: [],
  };
}

const safety = resolveSafetyConfig();

test('edges /a→/b and /b→/c → one happy path listing those three URLs in order', () => {
  const navigation = [edge('/a', '/b'), edge('/b', '/c')];
  const results = buildWorkflowCases({
    navigation,
    pages: [page('/a'), page('/b'), page('/c')],
    seedUrl: `${HOST}/`,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]!.workflowId, 'WF-001');
  const happy = results[0]!.plans.find((p) => p.subcaseId === 'workflow-happy');
  assert.ok(happy);
  assert.equal(happy!.status, 'PLANNED');
  assert.equal(happy!.action, 'observe');
  assert.match(happy!.title, /\/a → .*\/b → .*\/c/);
  assert.ok(results[0]!.chain);
  assert.deepEqual(
    results[0]!.chain!.urls.map((u) => new URL(u).pathname),
    ['/a', '/b', '/c']
  );
  assert.ok(!/dashboard/i.test(JSON.stringify(results)));
});

test('no edges → workflow-none NOT_TESTED; result does not contain Create User or Delete User', () => {
  const results = buildWorkflowCases({
    navigation: [],
    pages: [page('/')],
    seedUrl: `${HOST}/`,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]!.workflowId, 'workflow-none');
  const none = results[0]!.plans[0]!;
  assert.equal(none.subcaseId, 'workflow-none');
  assert.equal(none.status, 'NOT_TESTED');
  assert.match(none.reason ?? '', /no navigation edges discovered/i);

  const blob = JSON.stringify(results);
  assert.ok(!/Create User/i.test(blob));
  assert.ok(!/Delete User/i.test(blob));
});

test('cycle A→B→A does not infinite-loop; chain stops', () => {
  const edges = collectWorkflowEdges([edge('/a', '/b'), edge('/b', '/a')]);
  const paths = buildSimplePaths(edges);
  assert.ok(paths.every((p) => p.urls.length <= 3));
  assert.ok(paths.every((p) => p.edgeIds.length <= 2));
  // No path revisits a URL
  for (const path of paths) {
    const keys = path.urls.map((u) => new URL(u).pathname);
    assert.equal(new Set(keys).size, keys.length);
  }
  // Multi-step WF chains require ≥2 edges without cycle revisit — cycle yields length-1 maxima only
  const chains = selectWorkflowChains(paths);
  assert.equal(chains.length, 0);
});

test('alternative: A→C and A→B→C — both URL lists exist and differ', () => {
  const navigation = [edge('/a', '/c'), edge('/a', '/b'), edge('/b', '/c')];
  const results = buildWorkflowCases({
    navigation,
    pages: [page('/a'), page('/b'), page('/c')],
    seedUrl: `${HOST}/`,
  });

  assert.ok(results.length >= 1);
  const primary = results[0]!;
  assert.ok(primary.chain);
  const happyUrls = primary.chain!.urls.map((u) => new URL(u).pathname);
  assert.deepEqual(happyUrls, ['/a', '/b', '/c']);

  const altPlan = primary.plans.find((p) => p.subcaseId === 'workflow-alternative');
  assert.ok(altPlan);

  const allLists: string[][] = [];
  for (const r of results) {
    if (r.chain) allLists.push(r.chain.urls.map((u) => new URL(u).pathname));
    if (r.chain?.alternativeUrls) {
      allLists.push(r.chain.alternativeUrls.map((u) => new URL(u).pathname));
    }
  }
  const keys = new Set(allLists.map((l) => l.join('→')));
  assert.ok(keys.has('/a→/b→/c'));
  assert.ok(keys.has('/a→/c'), `expected /a→/c among ${[...keys].join(', ')}`);
  assert.ok(keys.size >= 2);

  if (primary.chain!.alternativeUrls) {
    assert.equal(altPlan!.status, 'PLANNED');
    assert.notDeepEqual(
      happyUrls,
      primary.chain!.alternativeUrls.map((u) => new URL(u).pathname)
    );
  } else {
    assert.ok(results.length >= 2, 'expected a second workflow when alternative is not attached');
  }
});

test('interrupted is NOT_TESTED', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/c')],
    pages: [page('/a'), page('/b'), page('/c')],
    seedUrl: `${HOST}/`,
  });
  const interrupted = results[0]!.plans.find((p) => p.subcaseId === 'workflow-interrupted');
  assert.ok(interrupted);
  assert.equal(interrupted!.status, 'NOT_TESTED');
  assert.match(interrupted!.reason ?? '', /interrupted path was not observed/i);
});

test('recovery NOT_TESTED when no cancel/back control', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/c')],
    pages: [page('/a'), page('/b'), page('/c')],
    elements: [],
    seedUrl: `${HOST}/`,
  });
  const recovery = results[0]!.plans.find((p) => p.subcaseId === 'workflow-recovery');
  assert.ok(recovery);
  assert.equal(recovery!.status, 'NOT_TESTED');
  assert.match(recovery!.reason ?? '', /no recovery control was discovered/i);
});

test('recovery PLANNED observe when cancel control is on a chain screen', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/c')],
    pages: [page('/a'), page('/b'), page('/c')],
    elements: [
      element({
        page: `${HOST}/c`,
        elementId: 'UI-CANCEL',
        elementType: 'button',
        elementKind: 'cancel-button',
        accessibleName: 'Cancel',
        locator: 'text=Cancel',
      }),
    ],
    seedUrl: `${HOST}/`,
  });
  const recovery = results[0]!.plans.find((p) => p.subcaseId === 'workflow-recovery');
  assert.equal(recovery?.status, 'PLANNED');
  assert.equal(recovery?.action, 'observe');
  assert.match(recovery?.expect?.note ?? '', /recovery control or back-link was discovered/i);
});

test('delete button on /c does not create a PLANNED delete step', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/c')],
    pages: [page('/a'), page('/b'), page('/c')],
    elements: [
      element({
        page: `${HOST}/c`,
        elementId: 'UI-DEL',
        elementType: 'button',
        elementKind: 'delete-button',
        accessibleName: 'Delete',
        locator: 'text=Delete',
      }),
    ],
    seedUrl: `${HOST}/`,
  });

  const plannedDelete = results[0]!.plans.filter(
    (p) => p.status === 'PLANNED' && /delete/i.test(p.title) && p.action !== 'observe'
  );
  assert.equal(plannedDelete.length, 0);

  const happy = results[0]!.plans.find((p) => p.subcaseId === 'workflow-happy');
  assert.equal(happy?.status, 'PLANNED');
  assert.equal(happy?.action, 'observe');
  assert.match(happy?.expect?.note ?? '', /delete on .*BLOCKED/i);

  assert.ok(results[0]!.plans.every((p) => p.action !== ('submit' as never)));
});

test('no demo hosts or invented Login→Dashboard→Delete flow', () => {
  const results = buildWorkflowCases({
    navigation: [],
    pages: [page('/')],
    seedUrl: `${HOST}/`,
  });
  const blob = JSON.stringify(results);
  assert.ok(!/Login → Dashboard/i.test(blob));
  assert.ok(!/Create User/i.test(blob));
  assert.ok(!/example\.com|demo\.app|acme\./i.test(blob));
});

test('happy path notes BLOCKED submit when submit control exists on a chain screen', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/c')],
    pages: [page('/a'), page('/b'), page('/c')],
    elements: [
      element({
        page: `${HOST}/b`,
        elementId: 'UI-SUB',
        elementType: 'button',
        elementKind: 'submit-button',
        isSubmit: true,
        accessibleName: 'Submit',
        locator: 'text=Submit',
      }),
    ],
    seedUrl: `${HOST}/`,
  });
  const happy = results[0]!.plans.find((p) => p.subcaseId === 'workflow-happy');
  assert.match(happy?.expect?.note ?? '', /submit on .*BLOCKED/i);
  assert.ok(results[0]!.plans.every((p) => p.status !== 'PLANNED' || p.action === 'observe'));
});

test('negative FAIL when a step URL was crawled as 404', () => {
  const results = buildWorkflowCases({
    navigation: [edge('/a', '/b'), edge('/b', '/missing')],
    pages: [page('/a'), page('/b'), page('/missing', 404)],
    seedUrl: `${HOST}/`,
  });
  const negative = results[0]!.plans.find((p) => p.subcaseId === 'workflow-negative');
  assert.equal(negative?.status, 'FAIL');
  assert.match(negative?.reason ?? '', /404/);
});

test('scenario-inventory wires multi-step workflows and keeps one-step edge rows', () => {
  const map = pageMap(
    [page('/a'), page('/b'), page('/c')],
    [edge('/a', '/b'), edge('/b', '/c')]
  );
  const elements = [
    element({
      page: `${HOST}/a`,
      elementId: 'UI-AB',
      elementType: 'link',
      accessibleName: 'to b',
      href: '/b',
      locator: 'a[href="/b"]',
      evidence: '<a href>',
    }),
    element({
      page: `${HOST}/b`,
      elementId: 'UI-BC',
      elementType: 'link',
      accessibleName: 'to c',
      href: '/c',
      locator: 'a[href="/c"]',
      evidence: '<a href>',
    }),
  ];
  const checks = buildScenarioInventory(map, ui(elements), safety);

  const edgeRows = checks.filter(
    (c) =>
      c.scenarioKind === 'workflow' &&
      (c.title.includes(`${HOST}/a → ${HOST}/b`) || c.title.includes(`${HOST}/b → ${HOST}/c`))
  );
  assert.ok(edgeRows.length >= 2, 'one-step edge workflow rows preserved');

  const happy = checks.find(
    (c) => c.scenarioKind === 'workflow' && typeof c.id === 'string' && c.id.endsWith('WF-001-workflow-happy')
  );
  assert.ok(happy);
  assert.equal(happy?.status, 'PLANNED');
  assert.match(happy?.title ?? '', /\/a → .*\/b → .*\/c/);

  const interrupted = checks.find(
    (c) => typeof c.id === 'string' && c.id.endsWith('WF-001-workflow-interrupted')
  );
  assert.equal(interrupted?.status, 'NOT_TESTED');
});

test('scenario-inventory zero edges → workflow-none only; no Create User', () => {
  const checks = buildScenarioInventory(pageMap([page('/empty')], []), ui([]), safety);
  const workflow = checks.filter((c) => c.scenarioKind === 'workflow');
  assert.ok(workflow.some((c) => c.status === 'NOT_TESTED' && /no navigation edges/i.test(c.reason ?? '')));
  assert.ok(!JSON.stringify(workflow).includes('Create User'));
  assert.ok(!JSON.stringify(workflow).includes('Delete User'));
});

test('dense site navigation stays within the path cap', () => {
  const routes = Array.from({ length: 12 }, (_, index) => `/p${index}`);
  const navigation: NavigationEntry[] = [];
  for (const from of routes) {
    for (const to of routes) {
      if (from !== to) navigation.push(edge(from, to));
    }
  }
  const started = Date.now();
  const paths = buildSimplePaths(collectWorkflowEdges(navigation));
  assert.ok(Date.now() - started < 2000);
  assert.ok(paths.length > 0);
  assert.ok(paths.length <= MAX_SIMPLE_PATHS);
});

test('stableEdgeId is deterministic for the same URLs', () => {
  const a = stableEdgeId(`${HOST}/a`, `${HOST}/b`);
  const b = stableEdgeId(`${HOST}/a`, `${HOST}/b`);
  assert.equal(a, b);
  assert.match(a, /^EDGE:/);
});
