import { resolveDiscoveredPageTargets } from '../lib/discovered-page-targets';
import { resolveUiTarget } from '../lib/ui-target';

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

export function resolveResponsivePages(): ResponsivePageDef[] {
  const target = resolveUiTarget();
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_RESPONSIVE_PAGES.map((page) => ({
      ...page,
      url: `${target.url}${page.path}`,
      source: 'fixture' as const,
    })),
  });
  return resolved.pages.map((page) => ({ path: page.path, name: page.name }));
}

export const LANDMARK_SELECTORS: Record<string, string> = {
  header: 'header, [data-qa="header"]',
  navigation: 'nav',
  'mobile-menu-toggle': '[data-qa="menu-toggle"]',
  hero: '[data-qa="hero"]',
  cards: '[data-qa="cards"]',
  grid: '[data-qa="grid"]',
  form: 'form',
  table: 'table',
  footer: 'footer, [data-qa="footer"]',
  modal: '[data-qa="modal"]',
  dropdown: '[data-qa="dropdown"]',
};
