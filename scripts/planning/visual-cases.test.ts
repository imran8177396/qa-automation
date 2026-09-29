import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveredScreen } from '../discovery/screens';
import { ROOT } from '../lib/paths';
import {
  buildVisualPlans,
  buildVisualPlansForScreen,
  isVisualMeaningfulState,
  isVisualSkippedState,
  VISUAL_MEANINGFUL_STATES,
  VISUAL_SKIPPED_STATES,
} from './visual-cases';

function screen(overrides: Partial<DiscoveredScreen> = {}): DiscoveredScreen {
  return {
    id: 'SCREEN-001',
    url: 'https://example.test/app',
    state: 'default',
    source: 'direct-url',
    ...overrides,
  };
}

function assertNoPass(plans: ReturnType<typeof buildVisualPlansForScreen>['plans']): void {
  assert.equal(plans.some((p) => p.status === 'PASS'), false);
}

function assertNoAbsoluteImagePath(
  plans: ReturnType<typeof buildVisualPlansForScreen>['plans']
): void {
  const blob = JSON.stringify(plans);
  assert.doesNotMatch(blob, /[A-Za-z]:\\/);
  assert.doesNotMatch(blob, /\/[\w.-]+\.png\b/i);
  assert.doesNotMatch(blob, /\.png["']/i);
}

function assertNoDemoHosts(plans: ReturnType<typeof buildVisualPlansForScreen>['plans']): void {
  const blob = JSON.stringify(plans).toLowerCase();
  assert.equal(blob.includes('saucedemo'), false);
  assert.equal(blob.includes('the-internet.herokuapp'), false);
  assert.equal(blob.includes('demo.playwright'), false);
  assert.doesNotMatch(blob, /wcag/i);
}

function bySubcase(plans: ReturnType<typeof buildVisualPlansForScreen>['plans']) {
  return Object.fromEntries(plans.map((p) => [p.subcaseId, p]));
}

test('module source does not import fs write APIs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'planning', 'visual-cases.ts'), 'utf8');
  assert.doesNotMatch(src, /from\s+['"]node:fs['"]/);
  assert.doesNotMatch(src, /from\s+['"]fs['"]/);
  assert.doesNotMatch(src, /writeFileSync|writeFile|createWriteStream|promises\.writeFile/);
  assert.match(src, /tests\/e2e\/visual/);
});

test('default screen → visual-normal, visual-baseline, visual-responsive are NOT_TESTED; no empty/modal', () => {
  const result = buildVisualPlansForScreen({ screen: screen({ state: 'default' }) });
  assertNoPass(result.plans);
  assertNoAbsoluteImagePath(result.plans);
  assertNoDemoHosts(result.plans);

  const map = bySubcase(result.plans);
  assert.equal(map['visual-baseline']?.status, 'NOT_TESTED');
  assert.match(map['visual-baseline']?.reason ?? '', /screenshot baseline was not created by planning/);
  assert.equal(map['visual-normal']?.status, 'NOT_TESTED');
  assert.match(map['visual-normal']?.reason ?? '', /normal-state screenshot was not captured/);
  assert.equal(map['visual-responsive']?.status, 'NOT_TESTED');
  assert.match(map['visual-responsive']?.reason ?? '', /responsive screenshot was not captured/);
  assert.equal(map['visual-empty'], undefined);
  assert.equal(map['visual-modal'], undefined);
  assert.equal(map['visual-error'], undefined);
  assert.equal(map['visual-expanded'], undefined);
  assert.equal(map['visual-skip'], undefined);
});

test('loading screen → no visual-normal row; skip note only', () => {
  const result = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-002', state: 'loading' }),
  });
  assertNoPass(result.plans);
  assert.equal(result.plans.some((p) => p.subcaseId === 'visual-normal'), false);
  assert.equal(result.plans.some((p) => p.subcaseId.startsWith('visual-') && p.subcaseId !== 'visual-skip'), false);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0]?.subcaseId, 'visual-skip');
  assert.equal(result.plans[0]?.status, 'NOT_APPLICABLE');
  assert.match(result.plans[0]?.reason ?? '', /intermediate or non-visual state is not baselined/);
  assert.match(result.plans[0]?.reason ?? '', /loading/);
});

test('dialog screen → one visual-modal, not also visual-drawer', () => {
  const result = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-003', state: 'dialog' }),
  });
  const map = bySubcase(result.plans);
  assert.ok(map['visual-modal']);
  assert.equal(map['visual-modal']?.status, 'NOT_TESTED');
  assert.equal(result.plans.filter((p) => p.subcaseId === 'visual-modal').length, 1);
  assert.equal(result.plans.some((p) => /visual-drawer|visual-dialog/.test(p.subcaseId)), false);
  assert.ok(map['visual-baseline']);
  assert.ok(map['visual-responsive']);
  assert.equal(map['visual-normal'], undefined);
});

test('empty + error + expanded each get only their own state row', () => {
  const empty = bySubcase(
    buildVisualPlansForScreen({ screen: screen({ id: 'S-E', state: 'empty' }) }).plans
  );
  const error = bySubcase(
    buildVisualPlansForScreen({ screen: screen({ id: 'S-R', state: 'error' }) }).plans
  );
  const expanded = bySubcase(
    buildVisualPlansForScreen({ screen: screen({ id: 'S-X', state: 'expanded' }) }).plans
  );

  assert.ok(empty['visual-empty']);
  assert.equal(empty['visual-error'], undefined);
  assert.equal(empty['visual-expanded'], undefined);
  assert.equal(empty['visual-normal'], undefined);

  assert.ok(error['visual-error']);
  assert.equal(error['visual-empty'], undefined);
  assert.equal(error['visual-expanded'], undefined);

  assert.ok(expanded['visual-expanded']);
  assert.equal(expanded['visual-empty'], undefined);
  assert.equal(expanded['visual-error'], undefined);
});

test('validation-error does not get visual-error; skip note only', () => {
  const result = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-VE', state: 'validation-error' }),
  });
  assert.equal(result.plans.some((p) => p.subcaseId === 'visual-error'), false);
  assert.equal(result.plans[0]?.subcaseId, 'visual-skip');
  assert.equal(result.plans[0]?.status, 'NOT_APPLICABLE');
});

test('evidence diff → FAIL; evidence match is not PASS', () => {
  const diff = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-D' }),
    evidence: {
      screenId: 'SCREEN-D',
      state: 'default',
      baselineExists: true,
      comparisonResult: 'diff',
    },
  });
  assert.equal(bySubcase(diff.plans)['visual-baseline']?.status, 'FAIL');
  assert.match(bySubcase(diff.plans)['visual-baseline']?.reason ?? '', /difference/);
  assertNoPass(diff.plans);

  const match = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-M' }),
    evidence: {
      screenId: 'SCREEN-M',
      state: 'default',
      baselineExists: true,
      comparisonResult: 'match',
    },
  });
  const baseline = bySubcase(match.plans)['visual-baseline'];
  assert.equal(baseline?.status, 'PLANNED');
  assert.notEqual(baseline?.status, 'PASS');
  assert.match(baseline?.reason ?? '', /baseline comparison matched; not a full visual audit/);
  assertNoPass(match.plans);

  const declared = buildVisualPlansForScreen({
    screen: screen({ id: 'SCREEN-B' }),
    evidence: { screenId: 'SCREEN-B', state: 'default', baselineExists: true },
  });
  assert.equal(bySubcase(declared.plans)['visual-baseline']?.status, 'PLANNED');
  assert.match(
    bySubcase(declared.plans)['visual-baseline']?.reason ?? '',
    /existing baseline was declared/
  );
  assertNoPass(declared.plans);
});

test('planner return value has no absolute image path; no PNG write', () => {
  const result = buildVisualPlans({
    screens: [
      screen({ id: 'SCREEN-001', state: 'default' }),
      screen({ id: 'SCREEN-002', state: 'modal' }),
      screen({ id: 'SCREEN-003', state: 'loading' }),
    ],
  });
  assertNoAbsoluteImagePath(result.plans);
  assertNoPass(result.plans);
  assertNoDemoHosts(result.plans);
  for (const plan of result.plans) {
    assert.ok(!plan.expect || !('path' in plan.expect));
  }
});

test('meaningful vs skipped token sets are disjoint and cover the contract', () => {
  for (const token of VISUAL_MEANINGFUL_STATES) {
    assert.equal(isVisualMeaningfulState(token), true);
    assert.equal(isVisualSkippedState(token), false);
  }
  for (const token of VISUAL_SKIPPED_STATES) {
    assert.equal(isVisualSkippedState(token), true);
    assert.equal(isVisualMeaningfulState(token), false);
  }
  assert.ok(VISUAL_MEANINGFUL_STATES.has('default'));
  assert.ok(VISUAL_SKIPPED_STATES.has('loading'));
  assert.ok(VISUAL_SKIPPED_STATES.has('validation-error'));
});

test('modal and drawer share visual-modal subcase id only', () => {
  const modal = buildVisualPlansForScreen({
    screen: screen({ id: 'S-MOD', state: 'modal' }),
  });
  const drawer = buildVisualPlansForScreen({
    screen: screen({ id: 'S-DRW', state: 'drawer' }),
  });
  assert.ok(bySubcase(modal.plans)['visual-modal']);
  assert.ok(bySubcase(drawer.plans)['visual-modal']);
  assert.equal(
    modal.plans.some((p) => String(p.subcaseId) === 'visual-drawer'),
    false
  );
  assert.equal(
    drawer.plans.some((p) => String(p.subcaseId) === 'visual-drawer'),
    false
  );
});
