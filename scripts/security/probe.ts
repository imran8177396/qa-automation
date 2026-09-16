export interface ProbeResult {
  ok: boolean;
  status: number | null;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
  finalUrl: string;
  error?: string;
}

const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 20_000;

export const SECURITY_PROBE_USER_AGENT =
  'QA-Automation/1.0 (observational security QA; GET only; not a pentest)';

export function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function truncateBody(body: string, maxBytes: number): string {
  if (Buffer.byteLength(body, 'utf8') <= maxBytes) return body;
  return body.slice(0, maxBytes);
}

/**
 * Single observational GET. Never used for POST/PUT/PATCH/DELETE or attack payloads.
 */
export async function safeGet(
  url: string,
  options?: { redirect?: RequestRedirect; maxBodyBytes?: number; userAgent?: string }
): Promise<ProbeResult> {
  const maxBodyBytes = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const redirect = options?.redirect ?? 'follow';
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect,
      headers: {
        Accept: 'text/html,application/json,text/plain,*/*;q=0.8',
        'User-Agent': options?.userAgent ?? SECURITY_PROBE_USER_AGENT,
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const raw = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      headers: normalizeHeaders(response.headers),
      setCookies: readSetCookies(response.headers),
      body: truncateBody(raw, maxBodyBytes),
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      headers: {},
      setCookies: [],
      body: '',
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Observational HEAD. Callers that need a body should use safeGet.
 * If the origin rejects HEAD (405/501), callers may fall back to GET.
 */
export async function safeHead(
  url: string,
  options?: { redirect?: RequestRedirect; userAgent?: string }
): Promise<ProbeResult> {
  const redirect = options?.redirect ?? 'manual';
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect,
      headers: {
        Accept: '*/*',
        'User-Agent': options?.userAgent ?? SECURITY_PROBE_USER_AGENT,
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return {
      ok: response.ok,
      status: response.status,
      headers: normalizeHeaders(response.headers),
      setCookies: readSetCookies(response.headers),
      body: '',
      finalUrl: response.url || url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      headers: {},
      setCookies: [],
      body: '',
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

export function pagePathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export function joinUrl(base: string, path: string): string {
  const origin = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}
