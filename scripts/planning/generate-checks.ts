import { findBrokenLinks } from '../discovery/broken-links';
import type { DiscoveryResult } from '../discovery/types';
import type { ElementRecord, ElementType, InventoryResult } from '../inventory/types';
import type { PlannedCheck } from './types';

const FORM_FIELD_TYPES: ElementType[] = [
  'text-input',
  'email-input',
  'password-input',
  'number-input',
  'tel-input',
  'date-input',
  'search-input',
  'textarea',
  'select',
  'checkbox',
  'radio',
];

/**
 * Pure function: discovery + inventory -> the check plan. No network/browser calls, so this is
 * fully unit-testable against canned fixtures. Never plans a submit click — see safety-policy.ts.
 */
export function generateChecks(discovery: DiscoveryResult, inventory: InventoryResult): PlannedCheck[] {
  const checks: PlannedCheck[] = [];
  let seq = 1;
  const nextId = () => `CHK-${String(seq++).padStart(4, '0')}`;

  for (const page of discovery.pages) {
    if (page.error) {
      checks.push({
        id: nextId(),
        kind: 'page-sanity',
        title: `${page.url} should load`,
        targetUrl: page.url,
        status: 'BLOCKED',
        reason: `BLOCKED: navigation error during discovery — ${page.error}`,
      });
      continue;
    }

    checks.push({
      id: nextId(),
      kind: 'page-sanity',
      title: `${page.url} should return a successful status and render a heading`,
      targetUrl: page.url,
      status: 'PLANNED',
      expect: { requireH1: true },
    });
  }

  for (const finding of findBrokenLinks(discovery.pages)) {
    checks.push({
      id: nextId(),
      kind: 'broken-link',
      title: `${finding.url} should not return ${finding.kind} (${finding.detail})`,
      targetUrl: finding.url,
      status: 'PLANNED',
    });
  }

  const elementsByPage = groupBy(inventory.elements, (el) => el.page);
  for (const [pageUrl, elements] of elementsByPage) {
    const formFields = elements.filter((el) => FORM_FIELD_TYPES.includes(el.type));
    const buttons = elements.filter((el) => el.type === 'button');
    const hasForm = elements.some((el) => Boolean(el.formMethod));

    // A locator like `text=Previous slide` resolves via .first() regardless of which inventory
    // record "intended" it — on a real site, several distinct elements often share identical
    // visible text (repeated carousel controls, the same nav item in desktop/mobile menus). Testing
    // the same resolved element N times isn't N times the coverage, so skip once already planned.
    const plannedLocators = new Set<string>();

    // A text= locator (the fallback when no id/name/aria-label/testid/placeholder exists) is not
    // guaranteed unique on the page — e.g. a "Book a Call" CTA commonly appears once as a
    // desktop-visible button and again as a separate mobile-only link with identical text. When
    // that happens, .first() can resolve to a completely different element than the one that was
    // actually inventoried (and its visibility/enabled state observed), so asserting against it
    // would be testing the wrong element. Count occurrences across every element on the page
    // (including links, which never get a check planned themselves) to detect this up front.
    const locatorFrequency = new Map<string, number>();
    for (const el of elements) {
      const locator = el.locatorCandidates[0];
      if (locator) locatorFrequency.set(locator, (locatorFrequency.get(locator) ?? 0) + 1);
    }
    const isAmbiguousLocator = (locator: string) =>
      locator.startsWith('text=') && (locatorFrequency.get(locator) ?? 0) > 1;

    for (const button of buttons) {
      if (button.risk === 'destructive') {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(button)} skipped (classified destructive)`,
          targetUrl: pageUrl,
          targetElementId: button.elementId,
          status: 'NOT_TESTED',
          reason: 'NOT_TESTED: classified destructive risk — no automatic interaction performed',
        });
        continue;
      }

      const primaryLocator = button.locatorCandidates[0];
      if (!primaryLocator) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(button)} has no stable locator`,
          targetUrl: pageUrl,
          targetElementId: button.elementId,
          status: 'REQUIRES_CONFIGURATION',
          reason:
            'REQUIRES_CONFIGURATION: no stable locator candidate (id/name/aria-label/placeholder/testid/text) — add one to test this element automatically',
        });
        continue;
      }

      if (isAmbiguousLocator(primaryLocator)) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(button)} locator is ambiguous`,
          targetUrl: pageUrl,
          targetElementId: button.elementId,
          status: 'REQUIRES_CONFIGURATION',
          reason:
            'REQUIRES_CONFIGURATION: only a text-based locator was available and it matches more than one element on this page (e.g. a repeated CTA, or a desktop/mobile variant) — add a stable id/data-testid/aria-label to test this element reliably',
        });
        continue;
      }

      if (plannedLocators.has(primaryLocator)) continue;
      plannedLocators.add(primaryLocator);

      if (!button.visible) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(button)} not visible at discovery time`,
          targetUrl: pageUrl,
          targetElementId: button.elementId,
          status: 'NOT_TESTED',
          reason:
            'NOT_TESTED: not visible in the default desktop viewport at discovery time — likely responsive/conditional UI (see docs/UPGRADE_ROADMAP.md, Phase 4: responsive testing)',
        });
        continue;
      }

      checks.push({
        id: nextId(),
        kind: 'form-presence',
        title: `${pageUrl} — ${describeField(button)} should be present (not clicked — see docs/UPGRADE_ROADMAP.md)`,
        targetUrl: pageUrl,
        targetElementId: button.elementId,
        status: 'PLANNED',
        expect: { visible: true, enabled: button.enabled, locator: primaryLocator },
      });
    }

    if (formFields.length === 0 && !hasForm) continue;

    for (const field of formFields) {
      if (field.risk === 'destructive') {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(field)} skipped (classified destructive)`,
          targetUrl: pageUrl,
          targetElementId: field.elementId,
          status: 'NOT_TESTED',
          reason: 'NOT_TESTED: classified destructive risk — no automatic interaction performed',
        });
        continue;
      }

      const primaryLocator = field.locatorCandidates[0];
      if (!primaryLocator) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(field)} has no stable locator`,
          targetUrl: pageUrl,
          targetElementId: field.elementId,
          status: 'REQUIRES_CONFIGURATION',
          reason:
            'REQUIRES_CONFIGURATION: no stable locator candidate (id/name/aria-label/placeholder/testid/text) — add one to test this field automatically',
        });
        continue;
      }

      if (isAmbiguousLocator(primaryLocator)) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(field)} locator is ambiguous`,
          targetUrl: pageUrl,
          targetElementId: field.elementId,
          status: 'REQUIRES_CONFIGURATION',
          reason:
            'REQUIRES_CONFIGURATION: only a text-based locator was available and it matches more than one element on this page — add a stable id/data-testid/aria-label to test this field reliably',
        });
        continue;
      }

      if (plannedLocators.has(primaryLocator)) continue;
      plannedLocators.add(primaryLocator);

      if (!field.visible) {
        checks.push({
          id: nextId(),
          kind: 'form-presence',
          title: `${pageUrl} — ${describeField(field)} not visible at discovery time`,
          targetUrl: pageUrl,
          targetElementId: field.elementId,
          status: 'NOT_TESTED',
          reason:
            'NOT_TESTED: not visible in the default desktop viewport at discovery time — likely responsive/conditional UI (see docs/UPGRADE_ROADMAP.md, Phase 4: responsive testing)',
        });
        continue;
      }

      checks.push({
        id: nextId(),
        kind: 'form-presence',
        title: `${pageUrl} — ${describeField(field)} should be present and usable`,
        targetUrl: pageUrl,
        targetElementId: field.elementId,
        status: 'PLANNED',
        expect: { visible: true, enabled: field.enabled, locator: primaryLocator },
      });

      if (field.required) {
        checks.push({
          id: nextId(),
          kind: 'form-boundary',
          title: `${pageUrl} — ${describeField(field)} should surface required-field feedback on empty input`,
          targetUrl: pageUrl,
          targetElementId: field.elementId,
          status: 'PLANNED',
          expect: { required: true, boundary: true, locator: primaryLocator },
        });
      }
    }

    checks.push({
      id: nextId(),
      kind: 'form-boundary',
      title: `${pageUrl} — form submission intentionally not exercised`,
      targetUrl: pageUrl,
      status: 'NOT_TESTED',
      reason:
        'NOT_TESTED: automatic form submission is out of scope for this framework phase — see docs/UPGRADE_ROADMAP.md',
    });
  }

  return checks;
}

function describeField(field: ElementRecord): string {
  return field.label ?? field.elementId;
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}
