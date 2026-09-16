export interface HtmlImage {
  src: string;
  alt: string;
  hasAltAttr: boolean;
}

export interface HtmlHeading {
  level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  text: string;
}

export interface HtmlLink {
  href: string;
  text: string;
}

export interface ParsedHtml {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  headings: HtmlHeading[];
  images: HtmlImage[];
  links: HtmlLink[];
  visibleText: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

function metaContent(html: string, key: string, attrName: 'name' | 'property'): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*\\b${attrName}\\s*=\\s*["']${key}["'][^>]*>|<meta\\b[^>]*\\bcontent\\s*=\\s*["'][^"']*["'][^>]*\\b${attrName}\\s*=\\s*["']${key}["'][^>]*>`,
    'i'
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = attr(tag, 'content');
  return content && content.trim() ? content.trim() : null;
}

function stripNonContent(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

export function parseHtml(html: string): ParsedHtml {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, ' ')) : null;

  const canonicalTag = html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i)?.[0];
  const canonicalUrl = canonicalTag ? attr(canonicalTag, 'href') : null;

  const headings: HtmlHeading[] = [];
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingRe.exec(html)) !== null) {
    const level = headingMatch[1].toLowerCase() as HtmlHeading['level'];
    const text = decodeEntities(headingMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    headings.push({ level, text });
  }

  const images: HtmlImage[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];
    const src = attr(tag, 'src') ?? '';
    const hasAltAttr = /\balt\s*=/i.test(tag);
    const alt = hasAltAttr ? (attr(tag, 'alt') ?? '') : '';
    images.push({ src, alt, hasAltAttr });
  }

  const links: HtmlLink[] = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const href = attr(`<a ${linkMatch[1]}>`, 'href');
    if (!href) continue;
    const text = decodeEntities(linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    links.push({ href, text });
  }

  const visibleText = decodeEntities(
    stripNonContent(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  );

  return {
    title: title && title.trim() ? title.trim() : null,
    metaDescription: metaContent(html, 'description', 'name'),
    canonicalUrl: canonicalUrl && canonicalUrl.trim() ? canonicalUrl.trim() : null,
    robotsMeta: metaContent(html, 'robots', 'name'),
    ogTitle: metaContent(html, 'og:title', 'property'),
    ogDescription: metaContent(html, 'og:description', 'property'),
    ogImage: metaContent(html, 'og:image', 'property'),
    headings,
    images,
    links,
    visibleText,
  };
}

export function resolveHref(baseUrl: string, href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(trimmed)) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

export function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export function looksLikeHtmlDocument(body: string, contentType = ''): boolean {
  if (/html/i.test(contentType) && /<html[\s>]|<body[\s>]|<head[\s>]/i.test(body)) return true;
  return /^\s*<!doctype html/i.test(body) || /<html[\s>]/i.test(body);
}
