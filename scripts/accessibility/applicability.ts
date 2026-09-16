import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { DiscoveryCategory } from '../discovery/categories';
import { isFixtureUiTarget } from '../lib/ui-target';
import { resolveAccessibilityPageSet } from './pages';

export type AccessibilityCheckStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface AccessibilityCheckPlan {
  id: string;
  name: string;
  status: AccessibilityCheckStatus;
  reason: string;
}

function categoryReason(inventory: UiInventory | null, category: DiscoveryCategory, fallback: string): string {
  const row = inventory?.categoryStatus.find((item) => item.category === category);
  if (row && row.status === 'NOT_DISCOVERED' && row.reason) return row.reason;
  return fallback;
}

function categoryDiscovered(inventory: UiInventory | null, category: DiscoveryCategory): boolean {
  return inventory?.categoryStatus.some((item) => item.category === category && item.status === 'DISCOVERED') ?? false;
}

function hasLoginForm(inventory: UiInventory | null): boolean {
  return Boolean(
    inventory?.elements.some(
      (el) => el.elementType === 'form' && /login/i.test(`${el.accessibleName ?? ''} ${el.locator ?? ''}`)
    )
  );
}

function hasObservedHeading(pageMap: PageMap | null): boolean {
  return Boolean(
    pageMap?.pages.some((page) => (page.headings && page.headings.length > 0) || page.h1s.length > 0)
  );
}

const WCAG_CERT_REASON =
  'NOT_APPLICABLE: this suite is QA-level automated accessibility (axe-core + Playwright). It is not a complete manual WCAG 2.x audit and does not constitute WCAG conformance certification.';

const FORM_ERROR_REASON =
  'Form error announcement is not observed without submitting. Generated a11y does not click Login; handwritten empty-login already covers submit.';

/**
 * Accessibility checks that apply to the current UI target.
 * Nav / tables / images are NOT_APPLICABLE when discovery did not observe them.
 */
export function planAccessibilityChecks(): AccessibilityCheckPlan[] {
  const pages = resolveAccessibilityPageSet();
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const inventory = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const authReason =
    pageMap?.auth?.reason ??
    'Behind-auth catalog items were not invented; credentials were not assumed.';
  const discoveredPage = pages.pages[0];
  const pageReason = discoveredPage
    ? `Discovered public page ${discoveredPage.path} (${pages.source}).`
    : pages.reason ?? 'No accessibility page resolved.';

  const certification: AccessibilityCheckPlan = {
    id: 'A11Y-wcag-certification',
    name: 'Complete manual WCAG 2.x conformance certification',
    status: 'NOT_APPLICABLE',
    reason: WCAG_CERT_REASON,
  };

  const formErrors: AccessibilityCheckPlan = {
    id: 'A11Y-form-errors',
    name: 'Form error announcement (after submit)',
    status: 'NOT_APPLICABLE',
    reason: FORM_ERROR_REASON,
  };

  if (isFixtureUiTarget()) {
    return [
      {
        id: 'A11Y-axe',
        name: 'axe-core scan (all enabled rules)',
        status: 'APPLICABLE',
        reason: pages.reason ?? 'Fixture pages are the intended accessibility scope, including a11y-defects.html.',
      },
      {
        id: 'A11Y-labels',
        name: 'Accessible names / form labels',
        status: 'APPLICABLE',
        reason: 'Fixture contact and login forms expose labelled controls; a11y-defects.html is a negative unlabeled case.',
      },
      {
        id: 'A11Y-keyboard',
        name: 'Keyboard navigation and tab order',
        status: 'APPLICABLE',
        reason: 'Fixture pages expose links, forms, and buttons for Tab order.',
      },
      {
        id: 'A11Y-focus',
        name: 'Focus visibility',
        status: 'APPLICABLE',
        reason: 'Interactive fixture controls can be focused from the keyboard.',
      },
      {
        id: 'A11Y-headings',
        name: 'Headings and semantic structure',
        status: 'APPLICABLE',
        reason: 'Fixture pages include headings (and a11y-defects.html omits them on purpose).',
      },
      {
        id: 'A11Y-aria',
        name: 'ARIA / landmark structure',
        status: 'APPLICABLE',
        reason: 'axe-core plus observed landmarks on fixture HTML.',
      },
      {
        id: 'A11Y-contrast',
        name: 'Color contrast (axe-measurable)',
        status: 'APPLICABLE',
        reason: 'axe-core color-contrast on fixture pages, including planted low-contrast text.',
      },
      {
        id: 'A11Y-zoom',
        name: '200% Chromium CSS zoom',
        status: 'APPLICABLE',
        reason: 'Chromium CSS zoom on fixture pages — not a real browser zoom UI.',
      },
      {
        id: 'A11Y-touch',
        name: 'Touch target CSS boxes',
        status: 'APPLICABLE',
        reason: 'CSS bounding boxes of fixture buttons/links — not a real device.',
      },
      {
        id: 'A11Y-navigation',
        name: 'Navigation landmark a11y',
        status: 'APPLICABLE',
        reason: 'Fixture HTML exposes <nav>.',
      },
      {
        id: 'A11Y-images',
        name: 'Image alt text',
        status: 'APPLICABLE',
        reason: 'Fixture pages include <img> (home logo and a11y-defects missing alt).',
      },
      {
        id: 'A11Y-tables',
        name: 'Table header / scope a11y',
        status: 'NOT_APPLICABLE',
        reason: 'No table is present on the fixture a11y routes (/, /contact.html, /a11y-defects.html).',
      },
      {
        id: 'A11Y-login-live',
        name: 'Sauce Demo login a11y',
        status: 'NOT_APPLICABLE',
        reason: 'UI target is the local fixture — live-origin login a11y is not in scope.',
      },
      formErrors,
      certification,
    ];
  }

  const loginForm = hasLoginForm(inventory) || categoryDiscovered(inventory, 'form');
  const inputs = categoryDiscovered(inventory, 'input') || loginForm;
  const buttons = categoryDiscovered(inventory, 'button') || loginForm;
  const heading = hasObservedHeading(pageMap);

  return [
    {
      id: 'A11Y-axe',
      name: 'axe-core scan (all enabled rules)',
      status: 'APPLICABLE',
      reason: `${pageReason} Every enabled axe rule is recorded — violations are not filtered by impact.`,
    },
    {
      id: 'A11Y-labels',
      name: 'Accessible names / form labels',
      status: inputs || loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason:
        inputs || loginForm
          ? 'Username/password inputs observed. Placeholder-only is not treated as a programmatic label. Form is not submitted.'
          : 'No input or login form was observed in discovery.',
    },
    {
      id: 'A11Y-keyboard',
      name: 'Keyboard navigation and tab order',
      status: 'APPLICABLE',
      reason: `${pageReason} Tab order is collected from observed tabbable controls. Login is not submitted.`,
    },
    {
      id: 'A11Y-focus',
      name: 'Focus visibility',
      status: 'APPLICABLE',
      reason: 'Focused outline/box-shadow is measured after Tab on observed controls.',
    },
    {
      id: 'A11Y-headings',
      name: 'Headings and semantic structure',
      status: heading || Boolean(discoveredPage) ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: heading
        ? 'Headings were observed on the discovered login page (h4 on Sauce Demo; no h1).'
        : discoveredPage
          ? 'Public page is executed — heading hierarchy is observed on the live DOM.'
          : 'No headings were observed on the discovered page.',
    },
    {
      id: 'A11Y-aria',
      name: 'ARIA / landmark structure',
      status: 'APPLICABLE',
      reason: 'axe-core ARIA rules plus observed landmarks. Undiscovered landmarks are not invented.',
    },
    {
      id: 'A11Y-contrast',
      name: 'Color contrast (axe-measurable)',
      status: 'APPLICABLE',
      reason: 'Contrast is recorded only when axe-core can measure it. This is not a full manual contrast audit.',
    },
    {
      id: 'A11Y-zoom',
      name: '200% Chromium CSS zoom',
      status: 'APPLICABLE',
      reason: 'Observed login controls must remain visible at 200% Chromium CSS zoom — not a real browser zoom UI.',
    },
    {
      id: 'A11Y-touch',
      status: buttons || loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      name: 'Touch target CSS boxes',
      reason:
        buttons || loginForm
          ? 'Login button CSS box is measured against a 24×24px minimum (WCAG 2.5.8). Not a real device.'
          : categoryReason(inventory, 'button', 'No button observed'),
    },
    {
      id: 'A11Y-navigation',
      name: 'Navigation landmark a11y',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'navigation', 'No <nav> or role=navigation observed'),
    },
    {
      id: 'A11Y-tables',
      name: 'Table header / scope a11y',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'table', 'No table / role=table observed'),
    },
    {
      id: 'A11Y-images',
      name: 'Image alt text',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(
        inventory,
        'image',
        'No <img> observed (Sauce Demo bot is a CSS background, not an image element).'
      ),
    },
    {
      id: 'A11Y-inventory-cart',
      name: 'Inventory / cart a11y',
      status: 'NOT_APPLICABLE',
      reason: `Inventory and cart were not discovered and are not reachable without auth. ${authReason}`,
    },
    formErrors,
    certification,
  ];
}

const REGION_TO_CHECK_ID: Record<string, string> = {
  navigation: 'A11Y-navigation',
  nav: 'A11Y-navigation',
  table: 'A11Y-tables',
  tables: 'A11Y-tables',
  image: 'A11Y-images',
  images: 'A11Y-images',
  'form-error': 'A11Y-form-errors',
  'form-errors': 'A11Y-form-errors',
  'wcag-certification': 'A11Y-wcag-certification',
};

export function plannedNotApplicableReason(region: string): string | undefined {
  const plan = planAccessibilityChecks();
  const id = REGION_TO_CHECK_ID[region.toLowerCase()];
  const row = id
    ? plan.find((item) => item.id === id)
    : plan.find((item) => item.name.toLowerCase() === region.toLowerCase());
  if (row?.status === 'NOT_APPLICABLE') return row.reason;
  return undefined;
}
