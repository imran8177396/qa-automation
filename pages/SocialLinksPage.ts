import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/** Href substring → accepted absolute https host suffixes for that platform. */
export const SOCIAL_PLATFORM_HOSTS: ReadonlyArray<{
  match: RegExp;
  hosts: readonly string[];
  label: string;
}> = [
  { match: /linkedin/i, hosts: ['linkedin.com'], label: 'LinkedIn' },
  { match: /facebook|fb\.com/i, hosts: ['facebook.com', 'fb.com', 'fb.me'], label: 'Facebook' },
  { match: /instagram/i, hosts: ['instagram.com'], label: 'Instagram' },
  { match: /wa\.me|whatsapp/i, hosts: ['wa.me', 'whatsapp.com', 'api.whatsapp.com'], label: 'WhatsApp' },
  { match: /twitter|x\.com/i, hosts: ['twitter.com', 'x.com', 't.co'], label: 'Twitter/X' },
  { match: /youtube|youtu\.be/i, hosts: ['youtube.com', 'youtu.be'], label: 'YouTube' },
  { match: /tiktok/i, hosts: ['tiktok.com'], label: 'TikTok' },
];

/** Substrings used to discover social / messaging anchors (case-insensitive). */
export const SOCIAL_HREF_NEEDLES = [
  'linkedin',
  'facebook',
  'fb.com',
  'instagram',
  'wa.me',
  'whatsapp',
  'twitter',
  'x.com',
  'youtube',
  'youtu.be',
  'tiktok',
] as const;

export interface SocialLinkSnapshot {
  href: string;
  target: string | null;
  rel: string;
  accessibleName: string;
  inFooter: boolean;
  outerHTML: string;
}

function hostMatches(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function resolveSocialPlatform(href: string): (typeof SOCIAL_PLATFORM_HOSTS)[number] | null {
  for (const platform of SOCIAL_PLATFORM_HOSTS) {
    if (platform.match.test(href)) return platform;
  }
  return null;
}

/**
 * Page object for non-destructive social / external contact icon link checks.
 * Observes attributes only — never clicks or navigates to third-party hosts.
 */
export class SocialLinksPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async open(path: string): Promise<void> {
    await this.goto(path);
  }

  async collectSocialLinks(): Promise<SocialLinkSnapshot[]> {
    const needles = [...SOCIAL_HREF_NEEDLES];
    return this.page.evaluate((hrefNeedles) => {
      const isSocial = (href: string) => {
        const lower = href.toLowerCase();
        return hrefNeedles.some((needle) => lower.includes(needle));
      };
      return Array.from(document.querySelectorAll('a[href]'))
        .filter((el) => isSocial((el as HTMLAnchorElement).getAttribute('href') ?? ''))
        .map((el) => {
          const anchor = el as HTMLAnchorElement;
          const labelledBy = anchor.getAttribute('aria-labelledby');
          let labelledByText = '';
          if (labelledBy) {
            labelledByText = labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
              .filter(Boolean)
              .join(' ');
          }
          const imgAlt = Array.from(anchor.querySelectorAll('img'))
            .map((img) => img.getAttribute('alt')?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          const accessibleName = [
            anchor.getAttribute('aria-label')?.trim() ?? '',
            labelledByText,
            anchor.getAttribute('title')?.trim() ?? '',
            (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
            imgAlt,
          ]
            .filter(Boolean)
            .join(' ')
            .trim();
          const inFooter = Boolean(anchor.closest('footer'));
          return {
            href: anchor.getAttribute('href') ?? '',
            target: anchor.getAttribute('target'),
            rel: anchor.getAttribute('rel') ?? '',
            accessibleName,
            inFooter,
            outerHTML: anchor.outerHTML.slice(0, 400),
          };
        });
    }, needles);
  }

  /**
   * Assert href is absolute https on the expected platform host.
   * Rejects empty, hash-only, and javascript: values.
   */
  expectValidHttpsPlatformHref(link: SocialLinkSnapshot, context: string): void {
    const href = link.href.trim();
    expect.soft(href, `${context}: href must not be empty`).not.toBe('');
    expect.soft(href, `${context}: href must not be javascript:`).not.toMatch(/^javascript:/i);
    expect.soft(href, `${context}: href must not be hash-only`).not.toMatch(/^#/);

    let parsed: URL | null = null;
    try {
      parsed = new URL(href);
    } catch {
      expect.soft(false, `${context}: href must be an absolute URL (got "${href}")`).toBe(true);
      return;
    }

    expect.soft(parsed.protocol, `${context}: href must use https (got ${parsed.protocol})`).toBe('https:');

    const platform = resolveSocialPlatform(href);
    expect
      .soft(platform, `${context}: href must match a known social platform pattern (got "${href}")`)
      .not.toBeNull();
    if (!platform) return;

    expect
      .soft(
        hostMatches(parsed.hostname, platform.hosts),
        `${context}: ${platform.label} href host "${parsed.hostname}" must be one of ${platform.hosts.join(', ')}`
      )
      .toBe(true);
  }

  expectBlankTargetWithSafeRel(link: SocialLinkSnapshot, context: string): void {
    expect.soft(link.target, `${context}: target must be _blank (got "${link.target ?? ''}")`).toBe('_blank');
    const tokens = link.rel.toLowerCase().split(/\s+/).filter(Boolean);
    expect
      .soft(tokens.includes('noopener'), `${context}: rel must include noopener (got rel="${link.rel}")`)
      .toBe(true);
    expect
      .soft(tokens.includes('noreferrer'), `${context}: rel must include noreferrer (got rel="${link.rel}")`)
      .toBe(true);
  }

  expectAccessibleName(link: SocialLinkSnapshot, context: string): void {
    expect
      .soft(
        link.accessibleName.length > 0,
        `${context}: social icon link must expose an accessible name via aria-label, aria-labelledby, title, visible text, or img alt (got empty; markup=${link.outerHTML})`
      )
      .toBe(true);
  }

  assertAllSocialLinkContracts(links: SocialLinkSnapshot[], pagePath: string): void {
    expect(links.length, `${pagePath}: expected at least one social/external contact icon link`).toBeGreaterThan(0);
    for (const [index, link] of links.entries()) {
      const where = link.inFooter ? 'footer' : 'non-footer';
      const context = `${pagePath} [${where} #${index}] href="${link.href}"`;
      this.expectValidHttpsPlatformHref(link, context);
      this.expectBlankTargetWithSafeRel(link, context);
      this.expectAccessibleName(link, context);
    }
  }
}
