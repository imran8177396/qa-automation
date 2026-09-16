import { createHash } from 'crypto';

export function normalizeContentText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeContentText(text)).digest('hex');
}

export function duplicateContentGroups(pages: Array<{ url: string; text: string }>): string[][] {
  const byHash = new Map<string, string[]>();
  for (const page of pages) {
    const normalized = normalizeContentText(page.text);
    if (normalized.length < 40) continue;
    const hash = contentHash(normalized);
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(page.url);
    else byHash.set(hash, [page.url]);
  }
  return [...byHash.values()].filter((urls) => urls.length > 1);
}
