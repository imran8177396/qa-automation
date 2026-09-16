import { pagePathOf } from './probe';
import type { SecurityFinding } from './types';

export interface ObservedCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None' | null;
}

export function parseSetCookie(header: string): ObservedCookie | null {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const nameValue = parts[0];
  const eq = nameValue.indexOf('=');
  if (eq <= 0) return null;
  const name = nameValue.slice(0, eq).trim();
  if (!name) return null;

  let secure = false;
  let httpOnly = false;
  let sameSite: ObservedCookie['sameSite'] = null;
  for (const part of parts.slice(1)) {
    const sep = part.indexOf('=');
    const key = (sep === -1 ? part : part.slice(0, sep)).trim().toLowerCase();
    const value = sep === -1 ? '' : part.slice(sep + 1).trim();
    if (key === 'secure') secure = true;
    if (key === 'httponly') httpOnly = true;
    if (key === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict') sameSite = 'Strict';
      else if (normalized === 'lax') sameSite = 'Lax';
      else if (normalized === 'none') sameSite = 'None';
    }
  }
  return { name, secure, httpOnly, sameSite };
}

export function collectCookieFindings(input: {
  url: string;
  setCookies: string[];
  isLoopback: boolean;
  isHttps: boolean;
}): SecurityFinding[] {
  const pagePath = pagePathOf(input.url);
  const cookies = input.setCookies.map(parseSetCookie).filter((row): row is ObservedCookie => row != null);

  if (cookies.length === 0) {
    return [
      {
        status: 'NOT_TESTED',
        rule: 'cookie-attributes',
        severity: 'info',
        detail: 'No Set-Cookie headers were observed on this GET — cookie flags were not invented',
        page: input.url,
        pagePath,
        expected: 'Secure, HttpOnly, SameSite on observed cookies',
        actual: 'no cookies observed',
      },
    ];
  }

  return cookies.map((cookie) => {
    const missing: string[] = [];
    if (input.isHttps && !cookie.secure) missing.push('Secure');
    if (!cookie.httpOnly) missing.push('HttpOnly');
    if (!cookie.sameSite) missing.push('SameSite');
    if (cookie.sameSite === 'None' && !cookie.secure) missing.push('SameSite=None requires Secure');

    const actual = [
      `name=${cookie.name}`,
      `Secure=${cookie.secure}`,
      `HttpOnly=${cookie.httpOnly}`,
      `SameSite=${cookie.sameSite ?? 'absent'}`,
      'value=[REDACTED]',
    ].join(' ');

    if (missing.length === 0) {
      return {
        status: 'PASS' as const,
        rule: 'cookie-attributes',
        severity: 'info' as const,
        detail: `Cookie ${cookie.name} has Secure, HttpOnly, and SameSite`,
        page: input.url,
        pagePath,
        expected: 'Secure, HttpOnly, SameSite (value not recorded)',
        actual,
      };
    }

    if (input.isLoopback) {
      return {
        status: 'NOTE' as const,
        rule: 'cookie-attributes',
        severity: 'low' as const,
        detail: `Cookie ${cookie.name} is missing ${missing.join(', ')} on a loopback fixture`,
        page: input.url,
        pagePath,
        expected: 'Secure (HTTPS), HttpOnly, SameSite',
        actual,
      };
    }

    return {
      status: 'FAIL' as const,
      rule: 'cookie-attributes',
      severity: 'medium' as const,
      detail: `Cookie ${cookie.name} is missing ${missing.join(', ')}`,
      page: input.url,
      pagePath,
      expected: 'Secure, HttpOnly, SameSite',
      actual,
    };
  });
}

export function observedSameSite(cookies: ObservedCookie[]): boolean {
  return cookies.some((cookie) => cookie.sameSite === 'Lax' || cookie.sameSite === 'Strict');
}
