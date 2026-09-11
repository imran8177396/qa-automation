import { resolveDiscoveredPageTargets, type UiPageTarget } from '../lib/discovered-page-targets';
import { resolveUiTarget } from '../lib/ui-target';

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
    pages: resolved.pages.map((page) => ({ path: page.path, name: page.name })),
    source: resolved.source,
    reason: resolved.reason,
  };
}
