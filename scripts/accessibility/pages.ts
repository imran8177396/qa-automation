import { resolveDiscoveredPageTargets, type UiPageTarget } from '../lib/discovered-page-targets';
import { isFixtureUiTarget, resolveUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';
import type { AccessibilityPageDef } from './types';

export const FIXTURE_A11Y_ROUTES = ['/', '/contact.html', '/a11y-defects.html'] as const;

export const FIXTURE_A11Y_PAGES: AccessibilityPageDef[] = [
  { path: '/', name: 'home' },
  { path: '/contact.html', name: 'contact' },
  { path: '/a11y-defects.html', name: 'a11y-defects' },
];

const DEFECTS_PAGE: AccessibilityPageDef = { path: '/a11y-defects.html', name: 'a11y-defects' };

function a11yPageName(page: UiPageTarget, source: UiPageTarget['source']): string {
  if (page.path === '/a11y-defects.html') return 'a11y-defects';
  if (source !== 'discovery') return page.name;
  if (page.path !== '/' && page.path !== '') return page.name;
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const hasLogin = ui?.elements.some(
    (el) => el.elementType === 'form' && /login/i.test(`${el.accessibleName ?? ''} ${el.locator ?? ''}`)
  );
  return hasLogin ? 'login' : page.name;
}

export function resolveAccessibilityPageSet(): {
  pages: AccessibilityPageDef[];
  source: UiPageTarget['source'];
  reason?: string;
} {
  const target = resolveUiTarget();
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_A11Y_PAGES.map((page) => ({
      ...page,
      url: `${target.url}${page.path}`,
      source: 'fixture' as const,
    })),
  });
  const pages = resolved.pages.map((page) => ({
    path: page.path,
    name: a11yPageName(page, resolved.source),
  }));

  if (isFixtureUiTarget() && !pages.some((page) => page.path === DEFECTS_PAGE.path)) {
    pages.push({ ...DEFECTS_PAGE });
  }

  return {
    pages,
    source: resolved.source,
    reason: resolved.reason,
  };
}

export function resolveAccessibilityPages(): AccessibilityPageDef[] {
  return resolveAccessibilityPageSet().pages;
}
