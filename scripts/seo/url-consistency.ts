import type { DiscoveredPage } from '../discovery/types';
import type { SeoFinding } from './types';
import { isSeoSkippedPage } from './analyze-seo';

function hostParts(url: string): { scheme: string; host: string; www: boolean } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return {
      scheme: parsed.protocol,
      host,
      www: host.startsWith('www.'),
    };
  } catch {
    return null;
  }
}

/** Report mixed scheme / www among crawled URLs. Does not invent a preferred policy. */
export function collectUrlConsistencyFindings(pages: DiscoveredPage[], nextId: () => string): SeoFinding[] {
  const loaded = pages.filter(
    (page) => !page.error && page.status !== null && page.status < 400 && !isSeoSkippedPage(page)
  );
  const parsed = loaded.map((page) => ({ url: page.url, parts: hostParts(page.url) }));
  const usable = parsed.filter((row) => row.parts != null);
  if (usable.length === 0) {
    return [
      {
        id: nextId(),
        rule: 'url-consistency',
        severity: 'info',
        status: 'NOT_TESTED',
        page: 'site-wide',
        detail: 'No parseable crawled page URLs were available for consistency checks.',
        expected: 'crawled page URLs',
        actual: 'none',
      },
    ];
  }

  const schemes = new Set(usable.map((row) => row.parts!.scheme));
  const www = new Set(usable.map((row) => (row.parts!.www ? 'www' : 'apex')));
  const mixed: string[] = [];
  if (schemes.size > 1) mixed.push(`schemes ${[...schemes].join(', ')}`);
  if (www.size > 1) mixed.push(`hosts ${[...new Set(usable.map((row) => row.parts!.host))].join(', ')}`);

  if (mixed.length > 0) {
    return [
      {
        id: nextId(),
        rule: 'url-consistency',
        severity: 'low',
        status: 'WARNING',
        page: 'site-wide',
        detail: `Crawled URLs are mixed (${mixed.join('; ')}). A preferred policy was not invented.`,
        expected: 'consistent scheme/host among crawled URLs (no preferred form invented)',
        actual: mixed.join('; '),
      },
    ];
  }

  const sample = usable[0].parts!;
  return [
    {
      id: nextId(),
      rule: 'url-consistency',
      severity: 'info',
      status: 'PASS',
      page: 'site-wide',
      detail: `Crawled URLs share scheme ${sample.scheme} and host pattern ${sample.host}. No trailing-slash or www policy was invented.`,
      expected: 'consistent crawled URLs',
      actual: `${usable.length} URL(s) ${sample.scheme}//${sample.host}`,
    },
  ];
}
