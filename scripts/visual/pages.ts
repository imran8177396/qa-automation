import { resolveDiscoveredPageTargets, type UiPageTarget } from '../lib/discovered-page-targets';
import { resolveUiTarget } from '../lib/ui-target';
import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { UiInventory } from '../discovery/ui-scan';

export interface VisualPageDef {
  path: string;
  name: string;
}

export const FIXTURE_VISUAL_PAGES: VisualPageDef[] = [
  { path: '/', name: 'home' },
  { path: '/contact.html', name: 'contact' },
  { path: '/danger.html', name: 'account-settings' },
  { path: '/broken-link.html', name: 'broken-link-demo' },
];

function visualPageName(page: UiPageTarget, source: UiPageTarget['source']): string {
  if (source !== 'discovery') return page.name;
  if (page.path !== '/' && page.path !== '') return page.name;
  const ui = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const hasLogin = ui?.elements.some(
    (el) => el.elementType === 'form' && /login/i.test(`${el.accessibleName ?? ''} ${el.locator ?? ''}`)
  );
  return hasLogin ? 'login' : page.name;
}

export function resolveVisualPages(): { pages: VisualPageDef[]; source: UiPageTarget['source']; reason?: string } {
  const target = resolveUiTarget();
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_VISUAL_PAGES.map((page) => ({
      ...page,
      url: `${target.url}${page.path}`,
      source: 'fixture' as const,
    })),
  });
  return {
    pages: resolved.pages.map((page) => ({ path: page.path, name: visualPageName(page, resolved.source) })),
    source: resolved.source,
    reason: resolved.reason,
  };
}
