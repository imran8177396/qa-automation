import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import { isFixtureUiTarget } from '../lib/ui-target';
import { resolveVisualPages } from './pages';

export type VisualCheckStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface VisualCheckPlan {
  id: string;
  name: string;
  status: VisualCheckStatus;
  reason: string;
}

function categoryReason(inventory: UiInventory | null, category: string, fallback: string): string {
  const row = inventory?.categoryStatus.find((item) => item.category === category);
  if (row && row.status === 'NOT_DISCOVERED' && row.reason) return row.reason;
  return fallback;
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

/**
 * Visual checks that apply to the current UI target. Cart/inventory/nav/images
 * are listed as NOT_APPLICABLE when discovery did not observe them — they are
 * not invented and are not recorded as passes.
 */
export function planVisualChecks(): VisualCheckPlan[] {
  const pages = resolveVisualPages();
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const inventory = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const authReason =
    pageMap?.auth?.reason ??
    'Behind-auth catalog items were not invented; credentials were not assumed.';

  if (isFixtureUiTarget()) {
    return [
      {
        id: 'VIS-fixture-pages',
        name: 'Fixture page full-page screenshots',
        status: 'APPLICABLE',
        reason: pages.reason ?? 'UI target is loopback — fixture pages are the intended visual scope.',
      },
      {
        id: 'VIS-fixture-regions',
        name: 'Fixture heading, nav, logo, contact, danger-zone regions',
        status: 'APPLICABLE',
        reason: 'Fixture HTML exposes these regions for component screenshots.',
      },
      {
        id: 'VIS-login-live',
        name: 'Sauce Demo login visual',
        status: 'NOT_APPLICABLE',
        reason: 'UI target is the local fixture — live-origin login visuals are not in scope.',
      },
    ];
  }

  const loginForm = hasLoginForm(inventory);
  const heading = hasObservedHeading(pageMap);
  const discoveredPage = pages.pages[0];

  return [
    {
      id: 'VIS-login-full',
      name: 'Login page full layout',
      status: 'APPLICABLE',
      reason: discoveredPage
        ? `Discovered public page ${discoveredPage.path} (${pages.source}).`
        : 'Live homepage fallback — fixture pages are not substituted.',
    },
    {
      id: 'VIS-login-form',
      name: 'Login form region (spacing, alignment, container)',
      status: loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: loginForm
        ? 'Login form observed in UI inventory — screenshot + geometry, no submit.'
        : 'No login form was observed in discovery.',
    },
    {
      id: 'VIS-login-heading',
      name: 'Login heading typography',
      status: heading ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: heading
        ? 'Headings were observed on the discovered login page (h4 on Sauce Demo; no h1).'
        : 'No headings were observed on the discovered page.',
    },
    {
      id: 'VIS-login-brand',
      name: 'Login brand text',
      status: 'APPLICABLE',
      reason: 'Visible “Swag Labs” brand text is on the discovered login page.',
    },
    {
      id: 'VIS-login-states',
      name: 'Login form empty vs filled (no submit)',
      status: loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: loginForm
        ? 'Username/password inputs observed. Fill uses sample values only; the form is not submitted.'
        : 'No login form was observed in discovery.',
    },
    {
      id: 'VIS-login-layout',
      name: 'Login overlap, clipping, broken container, unexpected movement',
      status: 'APPLICABLE',
      reason: 'Geometry checks on the observed login form and heading only.',
    },
    {
      id: 'VIS-login-narrow',
      name: 'Login page visual at 375px viewport',
      status: 'APPLICABLE',
      reason: 'Responsive visual difference on the same discovered login page — not a full responsive matrix.',
    },
    {
      id: 'VIS-inventory',
      name: 'Inventory page visual',
      status: 'NOT_APPLICABLE',
      reason: `Inventory was not discovered and is not reachable without auth. ${authReason}`,
    },
    {
      id: 'VIS-cart',
      name: 'Cart page visual',
      status: 'NOT_APPLICABLE',
      reason: `Cart was not discovered and is not reachable without auth. ${authReason}`,
    },
    {
      id: 'VIS-navigation',
      name: 'Navigation region visual',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'navigation', 'No <nav> or role=navigation observed'),
    },
    {
      id: 'VIS-images',
      name: 'Missing / broken <img> visual',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(
        inventory,
        'image',
        'No <img> observed (Sauce Demo bot is a CSS background, not an image element).'
      ),
    },
    {
      id: 'VIS-fixture-contact',
      name: 'Fixture contact-form visual states',
      status: 'NOT_APPLICABLE',
      reason: 'NOT_TESTED on a live origin: /contact.html is fixture-only. Live login form states still execute.',
    },
    {
      id: 'VIS-fixture-logo-danger',
      name: 'Fixture logo and danger-zone regions',
      status: 'NOT_APPLICABLE',
      reason: 'Fixture locators (Fixture logo, /danger.html) do not apply to the live origin.',
    },
  ];
}
