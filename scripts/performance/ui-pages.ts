import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';
import { resolveDiscoveredPageTargets, type UiPageTarget } from '../lib/discovered-page-targets';
import { isFixtureUiTarget, resolveUiTarget } from '../lib/ui-target';
import type { UiPerformancePageDef } from './types';

export const FIXTURE_UI_PERF_PAGES: Array<Pick<UiPageTarget, 'path' | 'name'>> = [
  { path: '/login.html', name: 'login' },
];

function hasLoginForm(inventory: UiInventory | null): boolean {
  return Boolean(
    inventory?.elements.some(
      (el) => el.elementType === 'form' && /login/i.test(`${el.accessibleName ?? ''} ${el.locator ?? ''}`)
    )
  );
}

function isLoginRoute(page: Pick<UiPageTarget, 'path' | 'name'>): boolean {
  return /login/i.test(page.name) || /login/i.test(page.path);
}

export function resolveUiPerformancePages(): {
  pages: UiPerformancePageDef[];
  source: UiPageTarget['source'];
  reason?: string;
} {
  const target = resolveUiTarget();
  const inventory = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_UI_PERF_PAGES.map((page) => ({
      ...page,
      url: `${target.url}${page.path}`,
      source: 'fixture' as const,
    })),
  });

  const pages = resolved.pages.map((page) => {
    const loginLanding =
      isLoginRoute(page) ||
      ((page.path === '/' || page.path === '') &&
        (hasLoginForm(inventory) || resolved.source === 'homepage-fallback'));
    return {
      path: page.path,
      name: loginLanding ? 'login' : page.name,
      url: page.url,
      source: resolved.source,
    };
  });

  const login = pages.filter((page) => page.name === 'login' || isLoginRoute(page));
  const scoped = login.length > 0 ? login.slice(0, 1) : pages.slice(0, 1);

  return {
    pages: scoped,
    source: resolved.source,
    reason: resolved.reason,
  };
}

export function resolveUiPerformancePage(): UiPerformancePageDef | null {
  return resolveUiPerformancePages().pages[0] ?? null;
}

export function uiPerformanceUsesFixtureLogin(): boolean {
  return isFixtureUiTarget();
}
