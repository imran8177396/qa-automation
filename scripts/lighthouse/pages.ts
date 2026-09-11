import { readJsonIfExists } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import type { PageMap } from '../discovery/page-map';
import type { UniquePageSet } from './types';

interface DiscoveryPagesFile {
  pages?: Array<{ url?: string }>;
}

export function resolveUniquePages(): UniquePageSet | null {
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  if (pageMap?.pages?.length) {
    const urls = uniqueUrls(pageMap.pages.map((page) => page.url));
    if (urls.length > 0) {
      return { urls, source: 'discovery/page-map.json' };
    }
  }

  const discovery = readJsonIfExists<DiscoveryPagesFile>(PATHS.discoveryFile);
  if (discovery?.pages?.length) {
    const urls = uniqueUrls(discovery.pages.map((page) => page.url));
    if (urls.length > 0) {
      return { urls, source: 'reports/discovery/discovery.json' };
    }
  }

  return null;
}

function uniqueUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}
