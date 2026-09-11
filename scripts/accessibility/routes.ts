import { resolveDiscoveredPageTargets } from '../lib/discovered-page-targets';
import { resolveUiTarget } from '../lib/ui-target';

export const FIXTURE_A11Y_ROUTES = ['/', '/contact.html'] as const;

export function resolveAccessibilityRoutes(): string[] {
  const target = resolveUiTarget();
  const resolved = resolveDiscoveredPageTargets({
    target,
    fallback: FIXTURE_A11Y_ROUTES.map((path) => ({
      path,
      name: path === '/' ? 'home' : path.replace(/^\//, '').replace(/[^\w.-]+/g, '-'),
      url: `${target.url}${path}`,
      source: 'fixture' as const,
    })),
  });
  return resolved.pages.map((page) => page.path);
}
