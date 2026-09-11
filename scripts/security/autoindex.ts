const INDEX_TITLE = /^Index of \//i;

export function isAutoindexTitle(title: string): boolean {
  return INDEX_TITLE.test(title.trim());
}

/**
 * Apache autoindex HTML: a `<pre>` listing and/or a "Parent Directory" row,
 * often with `?C=` / `;C=` column-sort links.
 */
export function hasApacheListingStructure(html: string): boolean {
  if (!html) return false;
  const hasParent = /parent\s+directory/i.test(html);
  const hasSortLink = /[?&;]C=[NMSD]/i.test(html) || /href=["'][^"'>\s]*\?C=/i.test(html);
  const hasPre = /<pre[\s>]/i.test(html);
  const hasIndexHeading = /<(h1|title)[^>]*>\s*Index of \//i.test(html);
  return (hasParent && (hasPre || hasSortLink || hasIndexHeading)) || (hasPre && (hasSortLink || hasParent));
}

export function isAutoindexPage(input: { title?: string; html?: string }): boolean {
  if (input.title && isAutoindexTitle(input.title)) return true;
  if (input.html && hasApacheListingStructure(input.html)) return true;
  return false;
}
