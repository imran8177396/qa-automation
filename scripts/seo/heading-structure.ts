export interface HeadingLike {
  level: string;
  text?: string;
}

export function headingLevelNumber(level: string): number | null {
  const match = level.trim().toLowerCase().match(/^h([1-6])$/);
  if (!match) return null;
  return Number(match[1]);
}

/** Levels 1..max that are absent when a deeper heading exists. Empty when there are no headings. */
export function skippedHeadingLevels(headings: HeadingLike[]): number[] {
  const levels = headings
    .map((heading) => headingLevelNumber(heading.level))
    .filter((level): level is number => level != null);
  if (levels.length === 0) return [];
  const present = new Set(levels);
  const max = Math.max(...levels);
  const skipped: number[] = [];
  for (let level = 1; level <= max; level += 1) {
    if (!present.has(level)) skipped.push(level);
  }
  return skipped;
}

export function emptyHeadings(headings: HeadingLike[]): HeadingLike[] {
  return headings.filter((heading) => !(heading.text ?? '').trim());
}
