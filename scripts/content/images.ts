import { resolveHref, sameOrigin, type HtmlImage } from '../lib/html-snapshot';
import { mapLimit } from '../lib/map-limit';
import { headOrGet, SEO_MAX_IMAGE_PROBES, SEO_PROBE_CONCURRENCY, type SeoProbe } from '../seo/http';
import { classifyProbedUrl } from '../seo/links';
import type { ContentFinding } from './types';

export function collectImageSrcs(baseUrl: string, origin: string, images: HtmlImage[]): string[] {
  const seen = new Set<string>();
  for (const image of images) {
    const resolved = resolveHref(baseUrl, image.src);
    if (!resolved || !sameOrigin(resolved, origin)) continue;
    seen.add(resolved);
    if (seen.size >= SEO_MAX_IMAGE_PROBES) break;
  }
  return [...seen];
}

export function collectImageAltFindings(pageUrl: string, images: HtmlImage[], discoveryMissingAlt?: number): ContentFinding[] {
  if (images.length === 0) {
    if ((discoveryMissingAlt ?? 0) > 0) {
      return [
        {
          status: 'FAIL',
          rule: 'missing-alt',
          severity: 'medium',
          page: pageUrl,
          detail: `Discovery recorded ${discoveryMissingAlt} image(s) without alt; HTTP HTML snapshot listed 0 <img> srcs (possible SPA).`,
          expected: 'alt on every img',
          actual: `${discoveryMissingAlt} missing (discovery)`,
        },
      ];
    }
    return [
      {
        status: 'NOT_TESTED',
        rule: 'missing-alt',
        severity: 'info',
        page: pageUrl,
        detail: 'No images were present in the HTML snapshot.',
        expected: 'img elements to inspect',
        actual: '0 images',
      },
    ];
  }

  const missing = images.filter((image) => !image.hasAltAttr || !image.alt.trim());
  if (missing.length > 0) {
    return [
      {
        status: 'FAIL',
        rule: 'missing-alt',
        severity: 'medium',
        page: pageUrl,
        detail: `${missing.length} of ${images.length} image(s) have no alt text.`,
        expected: 'alt on every img',
        actual: `${missing.length} missing`,
      },
    ];
  }

  return [
    {
      status: 'PASS',
      rule: 'missing-alt',
      severity: 'info',
      page: pageUrl,
      detail: `All ${images.length} image(s) have alt text.`,
      expected: 'alt on every img',
      actual: `${images.length} with alt`,
    },
  ];
}

export async function collectBrokenImageFindings(input: {
  pageUrl: string;
  origin: string;
  images: HtmlImage[];
  probe: SeoProbe;
}): Promise<ContentFinding[]> {
  const srcs = collectImageSrcs(input.pageUrl, input.origin, input.images);
  if (srcs.length === 0) {
    return [
      {
        status: 'NOT_TESTED',
        rule: 'broken-image',
        severity: 'info',
        page: input.pageUrl,
        detail:
          input.images.length === 0
            ? 'No image srcs were present in the HTML snapshot to GET/HEAD.'
            : 'Image srcs were off-origin or unresolvable; off-origin images were not requested.',
        expected: 'same-origin img src to GET/HEAD',
        actual: `${input.images.length} img tag(s), ${srcs.length} same-origin src(s)`,
      },
    ];
  }

  const probes = await mapLimit(srcs, SEO_PROBE_CONCURRENCY, async (url) => ({
    url,
    result: await headOrGet(input.probe, url, { redirect: 'follow', maxBodyBytes: 4096 }),
  }));

  const broken = probes.filter((row) => {
    const kind = classifyProbedUrl(row.result.status, row.result.error);
    return kind === 'not-found' || kind === 'error';
  });

  if (broken.length === 0) {
    return [
      {
        status: 'PASS',
        rule: 'broken-image',
        severity: 'info',
        page: input.pageUrl,
        detail: `${srcs.length} same-origin image src(s) returned a success or redirect status.`,
        expected: '2xx/3xx for same-origin img src',
        actual: `${srcs.length} reachable`,
      },
    ];
  }

  return broken.map((row) => ({
    status: 'FAIL' as const,
    rule: 'broken-image',
    severity: 'high' as const,
    page: input.pageUrl,
    detail: `${row.url} returned ${row.result.status ?? row.result.error ?? 'error'}`,
    expected: '2xx/3xx',
    actual: row.result.status != null ? String(row.result.status) : (row.result.error ?? 'error'),
  }));
}
