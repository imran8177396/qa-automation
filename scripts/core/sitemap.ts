/**
 * Regex-based <loc> extraction — sitemaps are a flat, well-known structure, so a full XML parser
 * (and the dependency it would need) isn't warranted. Follows one level of sitemap-index nesting.
 */
export async function fetchSitemapUrls(origin: string, sitemapPath = '/sitemap.xml', depth = 0): Promise<string[]> {
  if (depth > 1) return [];

  try {
    const response = await fetch(new URL(sitemapPath, origin).toString());
    if (!response.ok) return [];
    const body = await response.text();

    const indexMatches = [...body.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/g)];
    if (indexMatches.length > 0) {
      const nested = await Promise.all(
        indexMatches.map((match) => {
          try {
            return fetchSitemapUrls(origin, new URL(match[1].trim()).pathname, depth + 1);
          } catch {
            return Promise.resolve([]);
          }
        })
      );
      return nested.flat();
    }

    const locMatches = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)];
    return locMatches.map((match) => match[1].trim()).filter(Boolean);
  } catch {
    return [];
  }
}
