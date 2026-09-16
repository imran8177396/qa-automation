export interface PlaceholderHit {
  id: string;
  excerpt: string;
}

export const PLACEHOLDER_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'lorem-ipsum', re: /\blorem\s+ipsum\b/i },
  { id: 'todo', re: /\bTODO\b/ },
  { id: 'tbd', re: /\bTBD\b/ },
  { id: 'fixme', re: /\bFIXME\b/ },
  { id: 'xxx', re: /\bxxx\b/i },
  { id: 'placeholder-copy', re: /\b(your\s+text\s+here|insert\s+(text|content|copy)|sample\s+text)\b/i },
  { id: 'mustache', re: /\{\{\s*[\w.]+\s*\}\}/ },
];

export function findPlaceholderHits(text: string): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = text.match(pattern.re);
    if (!match || match.index == null) continue;
    const start = Math.max(0, match.index - 20);
    const excerpt = text.slice(start, match.index + match[0].length + 20).replace(/\s+/g, ' ').trim();
    hits.push({ id: pattern.id, excerpt: excerpt.slice(0, 80) });
  }
  return hits;
}
