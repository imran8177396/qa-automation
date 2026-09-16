export function createFindingIdFactory(prefix: string, start = 1): () => string {
  let seq = start;
  return () => `${prefix}-${String(seq++).padStart(4, '0')}`;
}

export function nextIdAfter(findings: Array<{ id: string }>, prefix = 'SEO'): () => string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const row of findings) {
    const match = row.id.match(re);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return createFindingIdFactory(prefix, max + 1);
}
