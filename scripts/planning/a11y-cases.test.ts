import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A11Y_AUTOMATED_LIMIT } from '../core/safety-policy';
import { applicableTestTypes } from '../discovery/test-types';
import type { DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord } from '../discovery/ui-scan';
import {
  A11Y_WCAG_LIMIT_SHORT,
  buildA11yPlansForScreen,
  withA11yLimit,
} from './a11y-cases';

function screen(overrides: Partial<DiscoveredScreen> = {}): DiscoveredScreen {
  return {
    id: 'SCREEN-001',
    url: 'https://example.test/app',
    state: 'default',
    source: 'direct-url',
    ...overrides,
  };
}

function element(overrides: Partial<UiElementRecord>): UiElementRecord {
  return {
    page: 'https://example.test/app',
    elementId: 'UI-0001',
    elementType: 'button',
    elementKind: 'button',
    tag: 'button',
    locator: 'button',
    locatorCandidates: ['button'],
    accessibleName: null,
    visible: true,
    enabled: true,
    required: false,
    interactive: true,
    potentialAction: 'click',
    applicableTestTypes: applicableTestTypes('button'),
    discoveryStatus: 'DISCOVERED',
    evidence: 'button',
    ...overrides,
  };
}

function reasonsAndNotes(plans: ReturnType<typeof buildA11yPlansForScreen>['plans']): string[] {
  return plans.flatMap((p) => [p.reason, p.expect?.note].filter((x): x is string => Boolean(x)));
}

function assertEveryReasonHasWcagLimit(
  plans: ReturnType<typeof buildA11yPlansForScreen>['plans']
): void {
  for (const text of reasonsAndNotes(plans)) {
    assert.ok(
      /not full WCAG compliance/i.test(text) || text.includes(A11Y_AUTOMATED_LIMIT),
      `expected WCAG limit in: ${text}`
    );
    assert.doesNotMatch(text, /WCAG compliant/i);
    assert.doesNotMatch(text, /WCAG AA/i);
  }
}

function assertNoPass(plans: ReturnType<typeof buildA11yPlansForScreen>['plans']): void {
  assert.equal(plans.some((p) => p.status === 'PASS'), false);
}

function assertNoContrastRatio(plans: ReturnType<typeof buildA11yPlansForScreen>['plans']): void {
  const blob = JSON.stringify(plans);
  assert.doesNotMatch(blob, /\d+(\.\d+)?\s*:\s*1/);
  assert.doesNotMatch(blob, /contrast ratio/i);
}

function assertNoDemoHosts(plans: ReturnType<typeof buildA11yPlansForScreen>['plans']): void {
  const blob = JSON.stringify(plans).toLowerCase();
  assert.equal(blob.includes('saucedemo'), false);
  assert.equal(blob.includes('the-internet.herokuapp'), false);
  assert.equal(blob.includes('demo.playwright'), false);
}

test('withA11yLimit reuses A11Y_AUTOMATED_LIMIT', () => {
  const text = withA11yLimit('keyboard navigation was not executed');
  assert.match(text, /keyboard navigation was not executed/);
  assert.ok(text.includes(A11Y_AUTOMATED_LIMIT) || text.includes(A11Y_WCAG_LIMIT_SHORT));
});

test('named button → accessible-name PLANNED; keyboard/contrast/tab-order/screen-reader NOT_TESTED; no WCAG claim', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-BTN',
        accessibleName: 'Save draft',
        evidence: 'button name=Save draft',
      }),
    ],
  });

  assertNoPass(result.plans);
  assertNoContrastRatio(result.plans);
  assertNoDemoHosts(result.plans);
  assertEveryReasonHasWcagLimit(result.plans);

  const byId = Object.fromEntries(result.plans.map((p) => [p.subcaseId, p]));
  assert.equal(byId['a11y-accessible-name']?.status, 'PLANNED');
  assert.equal(byId['a11y-accessible-name']?.action, 'observe');
  assert.equal(byId['a11y-keyboard']?.status, 'NOT_TESTED');
  assert.match(byId['a11y-keyboard']?.reason ?? '', /keyboard navigation was not executed/);
  assert.equal(byId['a11y-contrast']?.status, 'NOT_TESTED');
  assert.match(byId['a11y-contrast']?.reason ?? '', /contrast was not measured/);
  assert.equal(byId['a11y-tab-order']?.status, 'NOT_TESTED');
  assert.match(byId['a11y-tab-order']?.reason ?? '', /tab order was not executed/);
  assert.equal(byId['a11y-screen-reader']?.status, 'NOT_TESTED');
  assert.match(byId['a11y-screen-reader']?.reason ?? '', /screen reader semantics were not executed/);

  const blob = reasonsAndNotes(result.plans).join('\n');
  assert.doesNotMatch(blob, /WCAG compliant/i);
  assert.doesNotMatch(blob, /WCAG AA/i);
});

test('fillable email with no accessible name → form-labels NOT_TESTED names the field', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-EMAIL',
        elementType: 'input',
        elementKind: 'email-input',
        inputType: 'email',
        accessibleName: null,
        label: null,
        evidence: 'input type=email',
      }),
    ],
  });

  assertNoPass(result.plans);
  assertEveryReasonHasWcagLimit(result.plans);
  const formLabels = result.plans.find((p) => p.subcaseId === 'a11y-form-labels');
  assert.equal(formLabels?.status, 'NOT_TESTED');
  assert.match(formLabels?.reason ?? '', /UI-EMAIL/);
  assert.match(formLabels?.reason ?? '', /no accessible name/i);
});

test('role=alert present → error-announcement PLANNED observe', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-BTN',
        accessibleName: 'Continue',
        evidence: 'button',
      }),
      element({
        elementId: 'UI-ALERT',
        elementType: 'alert',
        elementKind: 'alert',
        interactive: false,
        accessibleName: 'Invalid email',
        attributes: { role: 'alert' },
        evidence: 'role=alert',
      }),
    ],
  });

  const row = result.plans.find((p) => p.subcaseId === 'a11y-error-announcement');
  assert.equal(row?.status, 'PLANNED');
  assert.equal(row?.action, 'observe');
  assert.match(row?.expect?.note ?? '', /role=alert|aria-live/i);
  assertEveryReasonHasWcagLimit(result.plans);
  assertNoPass(result.plans);
});

test('no interactive elements → a11y-none NOT_APPLICABLE, not PASS', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-DECOR',
        elementType: 'image',
        elementKind: 'decorative',
        interactive: false,
        accessibleName: null,
        evidence: 'decorative img',
      }),
    ],
  });

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0]?.subcaseId, 'a11y-none');
  assert.equal(result.plans[0]?.status, 'NOT_APPLICABLE');
  assert.notEqual(result.plans[0]?.status, 'PASS');
  assert.match(result.plans[0]?.reason ?? '', /no interactive elements on this screen/);
  assertEveryReasonHasWcagLimit(result.plans);
});

test('disabled button → a11y-disabled PLANNED observe and does not click', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-DIS',
        accessibleName: 'Delete',
        enabled: false,
        attributes: { disabled: '' },
        evidence: 'button disabled',
      }),
    ],
  });

  const row = result.plans.find((p) => p.subcaseId === 'a11y-disabled');
  assert.equal(row?.status, 'PLANNED');
  assert.equal(row?.action, 'observe');
  assert.notEqual(row?.action, 'click-button');
  assert.match(row?.expect?.note ?? '', /no click/i);
  assertEveryReasonHasWcagLimit(result.plans);
  assertNoPass(result.plans);
  assertNoContrastRatio(result.plans);
});

test('no contrast ratio number appears in a11y plan output', () => {
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-BTN',
        accessibleName: 'Ok',
        evidence: 'button',
      }),
    ],
  });
  assertNoContrastRatio(result.plans);
  const contrast = result.plans.find((p) => p.subcaseId === 'a11y-contrast');
  assert.equal(contrast?.status, 'NOT_TESTED');
  assert.doesNotMatch(contrast?.reason ?? '', /\d+\s*:\s*1/);
});

test('skips duplicate accessible-name fact when element already has an accessibility row', () => {
  const named = element({
    elementId: 'UI-NAMED',
    accessibleName: 'Profile',
    evidence: 'button',
  });
  const result = buildA11yPlansForScreen({
    screen: screen(),
    elements: [named],
    options: {
      existingAccessibleNameElementIds: new Set(['UI-NAMED']),
    },
  });
  const row = result.plans.find((p) => p.subcaseId === 'a11y-accessible-name');
  assert.equal(row?.status, 'PLANNED');
  assert.match(row?.expect?.note ?? '', /already recorded|skipped elements/i);
  assertEveryReasonHasWcagLimit(result.plans);
});

test('tabindex evidence → a11y-focus PLANNED; without evidence → NOT_TESTED', () => {
  const withTab = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-TAB',
        accessibleName: 'Menu',
        attributes: { tabindex: '0' },
        evidence: 'button tabindex=0',
      }),
    ],
  });
  assert.equal(withTab.plans.find((p) => p.subcaseId === 'a11y-focus')?.status, 'PLANNED');

  const without = buildA11yPlansForScreen({
    screen: screen(),
    elements: [
      element({
        elementId: 'UI-BTN',
        accessibleName: 'Menu',
        evidence: 'button',
      }),
    ],
  });
  const focus = without.plans.find((p) => p.subcaseId === 'a11y-focus');
  assert.equal(focus?.status, 'NOT_TESTED');
  assert.match(focus?.reason ?? '', /focus was not executed/);
});
