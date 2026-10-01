import { test, expect } from '../../fixtures/qa-test';
import { SocialLinksPage, resolveSocialPlatform } from '../../pages/SocialLinksPage';
import { resolveDiscoveredPageTargets, type UiPageTarget } from '../../scripts/lib/discovered-page-targets';
import { resolveUiTarget } from '../../scripts/lib/ui-target';

/** Always covered: homepage (shared footer) and Contact Us. */
const REQUIRED_PATHS = ['/', '/contactUs/'] as const;

function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

function pathsMatch(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * Pages for social icon checks: Contact Us + homepage (footer).
 * When discovery inventory matches the live origin, prefer the discovered
 * Contact Us URL/path variant if present; never expand to every discovered
 * page (footer chrome would only duplicate the same assertions).
 */
function resolveSocialLinkPages(): UiPageTarget[] {
  const target = resolveUiTarget();
  const discovered = resolveDiscoveredPageTargets({
    target,
    fallback: [],
    maxPages: 40,
  });

  const byPath = new Map<string, UiPageTarget>();
  const push = (path: string, source: UiPageTarget['source'], url?: string) => {
    const key = normalizePath(path);
    if (byPath.has(key)) return;
    byPath.set(key, {
      path: key,
      name: key === '/' ? 'home' : key.replace(/^\/|\/$/g, '').replace(/[^\w.-]+/g, '-') || 'page',
      url: url ?? new URL(key, `${target.url}/`).href,
      source,
    });
  };

  for (const required of REQUIRED_PATHS) {
    push(required, 'homepage-fallback');
  }

  if (discovered.source === 'discovery') {
    for (const page of discovered.pages) {
      const normalized = normalizePath(page.path);
      if (pathsMatch(normalized, '/contactUs/') || pathsMatch(normalized, '/')) {
        // Prefer discovery-recorded URL for the same required routes.
        byPath.set(normalized, {
          path: normalized,
          name: page.name,
          url: page.url,
          source: 'discovery',
        });
      }
    }
  }

  return [...byPath.values()];
}

const PAGES = resolveSocialLinkPages();

test.describe('social / external contact icon links @cross-browser', () => {
  for (const pageDef of PAGES) {
    test(`${pageDef.path} social icon links: https href, target=_blank, noopener noreferrer, accessible name`, async ({
      page,
    }) => {
      const social = new SocialLinksPage(page);
      await social.open(pageDef.path);

      const links = await social.collectSocialLinks();
      test.info().annotations.push({
        type: 'note',
        description: `${pageDef.path}: discovered ${links.length} social/external contact icon link(s) (source=${pageDef.source}). Non-destructive — links are not clicked.`,
      });

      expect(
        links.length,
        `${pageDef.path}: expected social/external contact icon links (linkedin|facebook|instagram|whatsapp|…)`
      ).toBeGreaterThan(0);

      social.assertAllSocialLinkContracts(links, pageDef.path);
    });

    test(`${pageDef.path} social icon hrefs recorded for human profile review (informational)`, async ({
      page,
    }) => {
      const social = new SocialLinksPage(page);
      await social.open(pageDef.path);
      const links = await social.collectSocialLinks();

      expect(
        links.length,
        `${pageDef.path}: expected social hrefs to record for human review`
      ).toBeGreaterThan(0);

      const brandHint = (() => {
        try {
          return new URL(resolveUiTarget().url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();

      for (const link of links) {
        const platform = resolveSocialPlatform(link.href);
        const where = link.inFooter ? 'footer' : 'non-footer';
        test.info().annotations.push({
          type: 'observed-href',
          description: `${pageDef.path} [${where}] ${platform?.label ?? 'social'}: ${link.href}`,
        });

        if (platform?.label === 'LinkedIn') {
          test.info().annotations.push({
            type: 'HUMAN_REVIEW',
            description: `LinkedIn profile href should be verified against the site brand (${brandHint || 'configured origin'}). Observed: ${link.href}. This is informational only — not a pass/fail expectation.`,
          });
        }
      }
    });
  }
});
