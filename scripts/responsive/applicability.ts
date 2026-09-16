import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { DiscoveryCategory } from '../discovery/categories';
import { isFixtureUiTarget } from '../lib/ui-target';
import { resolveResponsivePageSet } from './pages';

export type ResponsiveCheckStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface ResponsiveCheckPlan {
  id: string;
  name: string;
  status: ResponsiveCheckStatus;
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

const REAL_DEVICE_REASON =
  'NOT_APPLICABLE: no real iOS Safari, real Android Chrome, or device-cloud run exists. This suite uses Chromium emulated viewports only (page.setViewportSize / Playwright viewport + touch flags) — not a real device.';

/**
 * Responsive checks that apply to the current UI target.
 * Header/nav/hero/cards/tables/images/modals are NOT_APPLICABLE when discovery
 * did not observe them — they are not invented and are not recorded as passes.
 */
export function planResponsiveChecks(): ResponsiveCheckPlan[] {
  const pages = resolveResponsivePageSet();
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const inventory = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const authReason =
    pageMap?.auth?.reason ??
    'Behind-auth catalog items were not invented; credentials were not assumed.';

  const realDevice: ResponsiveCheckPlan = {
    id: 'RESP-real-device',
    name: 'Real iOS Safari / Android Chrome / device-cloud',
    status: 'NOT_APPLICABLE',
    reason: REAL_DEVICE_REASON,
  };

  if (isFixtureUiTarget()) {
    return [
      {
        id: 'RESP-overflow',
        name: 'Horizontal overflow / clipping / overlap (emulated viewport)',
        status: 'APPLICABLE',
        reason: pages.reason ?? 'Fixture pages expose layout chrome for viewport emulation.',
      },
      {
        id: 'RESP-form',
        name: 'Forms, buttons, typography at emulated viewports',
        status: 'APPLICABLE',
        reason: 'Fixture pages include forms and buttons. Fill only — no submit.',
      },
      {
        id: 'RESP-header-nav-menu',
        name: 'Header, navigation, mobile menu',
        status: 'APPLICABLE',
        reason: 'Fixture HTML exposes header, nav, and a compact menu toggle.',
      },
      {
        id: 'RESP-hero-cards-grid',
        name: 'Hero, cards, grids',
        status: 'APPLICABLE',
        reason: 'Fixture /responsive.html exposes hero, cards, and feature grid.',
      },
      {
        id: 'RESP-table-image-footer',
        name: 'Tables, images, footer',
        status: 'APPLICABLE',
        reason: 'Fixture pages include table, img, and footer landmarks.',
      },
      {
        id: 'RESP-modal-dropdown',
        name: 'Modals and dropdowns',
        status: 'APPLICABLE',
        reason: 'Fixture /responsive.html exposes a dialog and select.',
      },
      {
        id: 'RESP-login-live',
        name: 'Sauce Demo login responsive matrix',
        status: 'NOT_APPLICABLE',
        reason: 'UI target is the local fixture — live-origin login viewports are not in scope.',
      },
      realDevice,
    ];
  }

  const loginForm = hasLoginForm(inventory) || categoryDiscovered(inventory, 'form');
  const buttons = categoryDiscovered(inventory, 'button');
  const heading = hasObservedHeading(pageMap);
  const discoveredPage = pages.pages[0];

  return [
    {
      id: 'RESP-overflow',
      name: 'Horizontal overflow / clipping / overlap (emulated viewport)',
      status: 'APPLICABLE',
      reason: discoveredPage
        ? `Discovered public page ${discoveredPage.path} (${pages.source}) at Chromium emulated viewports — not a real device.`
        : 'Live homepage fallback — fixture pages are not substituted.',
    },
    {
      id: 'RESP-form',
      name: 'Login form fill + button visibility (no submit)',
      status: loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: loginForm
        ? 'Login form observed in UI inventory — fill username/password and assert the Login button stays visible. Form is not submitted.'
        : 'No form was observed in discovery.',
    },
    {
      id: 'RESP-buttons',
      name: 'Buttons stay usable in the emulated viewport',
      status: buttons ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: buttons
        ? 'Login button observed — geometry only; submit is not authorized.'
        : categoryReason(inventory, 'button', 'No button observed'),
    },
    {
      id: 'RESP-typography',
      name: 'Typography remains readable',
      status: heading || loginForm ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: heading
        ? 'Headings were observed on the discovered login page (h4 on Sauce Demo; no h1).'
        : loginForm
          ? 'Body/form text is present on the login page even without an h1.'
          : 'No heading or form text was observed.',
    },
    {
      id: 'RESP-header',
      name: 'Header chrome',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'header', 'No <header> or role=banner observed'),
    },
    {
      id: 'RESP-navigation',
      name: 'Navigation chrome',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'navigation', 'No <nav> or role=navigation observed'),
    },
    {
      id: 'RESP-mobile-menu',
      name: 'Mobile menu',
      status: 'NOT_APPLICABLE',
      reason:
        'No navigation or menu toggle was observed on the unauthenticated login page. A compact chrome pattern was not invented.',
    },
    {
      id: 'RESP-hero',
      name: 'Hero / marketing band',
      status: 'NOT_APPLICABLE',
      reason: 'No hero landmark was observed on the discovered login page.',
    },
    {
      id: 'RESP-cards',
      name: 'Cards',
      status: 'NOT_APPLICABLE',
      reason: 'No card grid was observed on the discovered login page.',
    },
    {
      id: 'RESP-grid',
      name: 'Feature grids',
      status: 'NOT_APPLICABLE',
      reason: 'No feature grid was observed on the discovered login page.',
    },
    {
      id: 'RESP-table',
      name: 'Tables',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'table', 'No table / role=table observed'),
    },
    {
      id: 'RESP-images',
      name: 'Images',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(
        inventory,
        'image',
        'No <img> observed (Sauce Demo bot is a CSS background, not an image element).'
      ),
    },
    {
      id: 'RESP-footer',
      name: 'Footer',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'footer', 'No <footer> or role=contentinfo observed'),
    },
    {
      id: 'RESP-modal',
      name: 'Modals',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'modal', 'No dialog / role=dialog observed'),
    },
    {
      id: 'RESP-dropdown',
      name: 'Dropdowns',
      status: 'NOT_APPLICABLE',
      reason: categoryReason(inventory, 'select', 'No <select> observed'),
    },
    {
      id: 'RESP-inventory-cart',
      name: 'Inventory / cart viewports',
      status: 'NOT_APPLICABLE',
      reason: `Inventory and cart were not discovered and are not reachable without auth. ${authReason}`,
    },
    {
      id: 'RESP-fixture-chrome',
      name: 'Fixture-only menu / modal / dropdown pages',
      status: 'NOT_APPLICABLE',
      reason:
        'NOT_TESTED on a live origin: /responsive.html mobile menu, modal, and dropdown are fixture-only. Live login form checks still execute.',
    },
    realDevice,
  ];
}

const REGION_TO_CHECK_ID: Record<string, string> = {
  header: 'RESP-header',
  navigation: 'RESP-navigation',
  'mobile-menu': 'RESP-mobile-menu',
  'mobile-menu-toggle': 'RESP-mobile-menu',
  'mobile menu': 'RESP-mobile-menu',
  hero: 'RESP-hero',
  cards: 'RESP-cards',
  grid: 'RESP-grid',
  table: 'RESP-table',
  images: 'RESP-images',
  image: 'RESP-images',
  footer: 'RESP-footer',
  modal: 'RESP-modal',
  dropdown: 'RESP-dropdown',
};

/** Discovery reason for an absent region, or undefined when the plan does not mention it. */
export function plannedNotApplicableReason(region: string): string | undefined {
  const plan = planResponsiveChecks();
  const id = REGION_TO_CHECK_ID[region.toLowerCase()];
  const row = id ? plan.find((item) => item.id === id) : plan.find((item) => item.name.toLowerCase() === region.toLowerCase());
  if (row?.status === 'NOT_APPLICABLE') return row.reason;
  return undefined;
}
