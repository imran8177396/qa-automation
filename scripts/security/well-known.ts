import { isAutoindexPage } from './autoindex';
import type { SecurityFinding } from './types';

/**
 * Fixed observational paths. One GET each on the configured origin only.
 * Not a directory brute-force list.
 */
export const WELL_KNOWN_PATHS = [
  '/.git',
  '/.git/HEAD',
  '/.git/config',
  '/.env',
  '/.env.local',
  '/.env.production',
  '/backup',
  '/backup.zip',
  '/.svn/entries',
  '/web.config',
  '/server-status',
  '/phpinfo.php',
  '/.DS_Store',
  '/package.json',
  '/composer.json',
  '/wp-config.php',
  '/config.json',
  '/main.js.map',
  '/static/js/main.js.map',
  '/js/app.js.map',
  '/.htaccess',
] as const;

export type ExposureClass = 'exposed' | 'not-exposed' | 'inconclusive';

export interface ExposureClassification {
  class: ExposureClass;
  reason: string;
}

const HTML_TYPE = /text\/html/i;
const SOURCE_MAP_REF = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=\s*(\S+)/gi;

function looksLikeHtml(body: string, contentType: string): boolean {
  if (HTML_TYPE.test(contentType)) return true;
  return /^\s*</.test(body) && /<html[\s>]|<body[\s>]|<div[\s>]/i.test(body);
}

function looksLikeGitHead(body: string): boolean {
  return /^ref:\s+refs\//i.test(body.trim()) || /^[0-9a-f]{40}\s*$/i.test(body.trim());
}

function looksLikeEnvFile(body: string): boolean {
  if (looksLikeHtml(body, '')) return false;
  const lines = body.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (lines.length === 0) return false;
  const assigned = lines.filter((line) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).length;
  return assigned >= 1 && assigned / lines.length >= 0.5;
}

function looksLikeSourceMap(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return false;
  return /"mappings"\s*:/.test(trimmed) || /"version"\s*:\s*\d/.test(trimmed);
}

function looksLikeJsonManifest(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  return /"(name|dependencies|require|autoload)"\s*:/.test(trimmed);
}

function looksLikePhpInfo(body: string): boolean {
  return /phpinfo\s*\(|PHP Version/i.test(body);
}

function isSpaFallback(body: string, contentType: string, homepageBody?: string): boolean {
  if (!looksLikeHtml(body, contentType)) return false;
  if (!homepageBody) {
    return /<form[\s>]|data-test=["']login|sign in|accepted usernames/i.test(body);
  }
  const a = homepageBody.slice(0, 400);
  const b = body.slice(0, 400);
  if (a && b && a === b) return true;
  const homeTitle = homepageBody.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const bodyTitle = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  return Boolean(homeTitle && bodyTitle && homeTitle === bodyTitle);
}

export function classifyWellKnownResponse(input: {
  path: string;
  status: number | null;
  contentType: string;
  body: string;
  location?: string;
  homepageBody?: string;
}): ExposureClassification {
  const status = input.status;
  if (status == null) {
    return { class: 'inconclusive', reason: 'no HTTP status' };
  }
  if (status === 404 || status === 410) {
    return { class: 'not-exposed', reason: `HTTP ${status}` };
  }
  if (status === 401 || status === 403) {
    return { class: 'not-exposed', reason: `HTTP ${status} (not publicly readable)` };
  }
  if (status === 405 || status === 501) {
    return { class: 'not-exposed', reason: `HTTP ${status}` };
  }
  if (status >= 300 && status < 400) {
    return { class: 'not-exposed', reason: `HTTP ${status} redirect (resource not returned)` };
  }
  if (status < 200 || status >= 400) {
    return { class: 'not-exposed', reason: `HTTP ${status}` };
  }

  const path = input.path.toLowerCase();
  if (isSpaFallback(input.body, input.contentType, input.homepageBody)) {
    return { class: 'not-exposed', reason: 'HTTP 200 HTML matches the application shell (not the requested file)' };
  }
  if (isAutoindexPage({ html: input.body, title: input.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] })) {
    return { class: 'exposed', reason: 'directory listing HTML' };
  }
  if (path.includes('.git') && (looksLikeGitHead(input.body) || /\[core\]/.test(input.body))) {
    return { class: 'exposed', reason: 'git metadata body' };
  }
  if (path.includes('.env') && looksLikeEnvFile(input.body)) {
    return { class: 'exposed', reason: 'dotenv-style body (contents redacted)' };
  }
  if (path.endsWith('.map') && looksLikeSourceMap(input.body)) {
    return { class: 'exposed', reason: 'source map JSON' };
  }
  if ((path.endsWith('package.json') || path.endsWith('composer.json') || path.endsWith('config.json')) && looksLikeJsonManifest(input.body)) {
    return { class: 'exposed', reason: 'build/config JSON' };
  }
  if (path.includes('phpinfo') && looksLikePhpInfo(input.body)) {
    return { class: 'exposed', reason: 'phpinfo output' };
  }
  if (!looksLikeHtml(input.body, input.contentType) && input.body.trim().length > 0) {
    return { class: 'exposed', reason: `HTTP ${status} non-HTML body for a sensitive path` };
  }
  if (looksLikeHtml(input.body, input.contentType)) {
    return { class: 'not-exposed', reason: 'HTTP 200 HTML that does not look like the requested resource' };
  }
  return { class: 'inconclusive', reason: `HTTP ${status} with an empty or unclassified body` };
}

export function wellKnownFinding(input: {
  origin: string;
  path: string;
  status: number | null;
  contentType: string;
  body: string;
  homepageBody?: string;
  error?: string;
}): SecurityFinding {
  const page = `${input.origin}${input.path}`;
  if (input.error) {
    return {
      status: 'BLOCKED',
      rule: 'well-known-exposure',
      severity: 'low',
      detail: `GET ${input.path} failed: ${input.error}`,
      page,
      pagePath: input.path,
      expected: 'path not publicly served',
      actual: 'request error',
    };
  }

  const classified = classifyWellKnownResponse({
    path: input.path,
    status: input.status,
    contentType: input.contentType,
    body: input.body,
    homepageBody: input.homepageBody,
  });

  if (classified.class === 'exposed') {
    return {
      status: 'FAIL',
      rule: 'well-known-exposure',
      severity: 'high',
      detail: `${input.path} appears publicly reachable — ${classified.reason}. Body not copied.`,
      page,
      pagePath: input.path,
      expected: '404 / 403 / not the requested sensitive file',
      actual: `HTTP ${input.status ?? 'unknown'} (${classified.reason}) [REDACTED]`,
    };
  }

  if (classified.class === 'inconclusive') {
    return {
      status: 'WARNING',
      rule: 'well-known-exposure',
      severity: 'low',
      detail: `${input.path} response was inconclusive — ${classified.reason}`,
      page,
      pagePath: input.path,
      expected: 'clear 404/403 or confirmed non-resource',
      actual: `HTTP ${input.status ?? 'unknown'} (${classified.reason})`,
    };
  }

  return {
    status: 'PASS',
    rule: 'well-known-exposure',
    severity: 'info',
    detail: `${input.path} is not publicly exposing the requested resource (${classified.reason})`,
    page,
    pagePath: input.path,
    expected: 'not publicly served',
    actual: classified.reason,
  };
}

export function extractSameOriginSourceMaps(pageUrl: string, html: string): string[] {
  let origin: URL;
  try {
    origin = new URL(pageUrl);
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const cleaned = raw.replace(/["'>\s].*$/, '').replace(/\*\/$/, '');
    try {
      const resolved = new URL(cleaned, origin);
      if (resolved.origin !== origin.origin) return;
      if (!/\.map$/i.test(resolved.pathname)) return;
      const href = resolved.href;
      if (seen.has(href)) return;
      seen.add(href);
      out.push(href);
    } catch {
      /* ignore unresolvable */
    }
  };

  SOURCE_MAP_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SOURCE_MAP_REF.exec(html))) {
    push(match[1]);
  }
  const hrefMaps = html.matchAll(/(?:src|href)=["']([^"']+\.map)["']/gi);
  for (const row of hrefMaps) push(row[1]);
  return out.slice(0, 5);
}
