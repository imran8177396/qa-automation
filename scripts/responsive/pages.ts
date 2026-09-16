import { resolveDiscoveredPageTargets, type UiPageTarget } from '../lib/discovered-page-targets';
import { resolveUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';

export interface ResponsivePageDef {
  path: string;
  name: string;
}

/** Stable fixture pages that are valid layout targets. 404s are not included. */
export const FIXTURE_RESPONSIVE_PAGES: ResponsivePageDef[] = [
  { path: '/', name: 'home' },
  { path: '/contact.html', name: 'contact' },
  { path: '/danger.html', name: 'account-settings' },
  { path: '/responsive.html', name: 'responsive-showcase' },
];

/** @deprecated Use resolveResponsivePages() — fixture list only. Live runs must call resolveResponsivePages(). */
export const RESPONSIVE_PAGES: ResponsivePageDef[] = FIXTURE_RESPONSIVE_PAGES;

function responsivePageName(page: UiPageTarget, source: UiPageTarget['source']): string {
  if (source !== 'discovery') return page.name;
  if (page.path !== '/' && page.path !== '') return page.name;
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const hasLogin = ui?.elements.some(
    (el) => el.elementType === 'form' && /login/i.test(`${el.accessibleName ?? ''} ${el.locator ?? ''}`)
  );
  return hasLogin ? 'login' : page.name;
}

export function resolveResponsivePageSet(): {
  pages: ResponsivePageDef[];
  source: UiPageTarget['source'];
  reason?: string;
} {
  const target = resolveUiTarget();
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_RESPONSIVE_PAGES.map((page) => ({
      ...page,
      url: `${target.url}${page.path}`,
      source: 'fixture' as const,
    })),
  });
  return {
    pages: resolved.pages.map((page) => ({ path: page.path, name: responsivePageName(page, resolved.source) })),
    source: resolved.source,
    reason: resolved.reason,
  };
}

export function resolveResponsivePages(): ResponsivePageDef[] {
  return resolveResponsivePageSet().pages;
}

/** Geometry querySelectors only. Specs use POM getByRole / getByLabel / getByTestId. */
export const LANDMARK_SELECTORS: Record<string, string> = {
  header: 'header, [role="banner"], [data-qa="header"]',
  navigation: 'nav, [role="navigation"]',
  'mobile-menu-toggle': '[data-qa="menu-toggle"]',
  hero: '[data-qa="hero"]',
  cards: '[data-qa="cards"]',
  grid: '[data-qa="grid"]',
  form: 'form, [role="form"]',
  table: 'table, [role="table"]',
  footer: 'footer, [role="contentinfo"], [data-qa="footer"]',
  modal: '[data-qa="modal"], [role="dialog"]',
  dropdown: '[data-qa="dropdown"], select',
};
