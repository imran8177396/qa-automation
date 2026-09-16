import { resolveAccessibilityPages } from './pages';

export { FIXTURE_A11Y_ROUTES } from './pages';

export function resolveAccessibilityRoutes(): string[] {
  return resolveAccessibilityPages().map((page) => page.path);
}
