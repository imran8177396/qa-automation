import { headerValue, pagePathOf } from './probe';
import type { SecurityFinding, SecurityFindingStatus } from './types';

export interface HeaderRule {
  header: string;
  rule: string;
  severity: SecurityFinding['severity'];
  httpsOnly?: boolean;
  aliases?: string[];
}

export const SECURITY_HEADER_RULES: HeaderRule[] = [
  { header: 'content-security-policy', rule: 'content-security-policy', severity: 'medium' },
  { header: 'strict-transport-security', rule: 'strict-transport-security', severity: 'medium', httpsOnly: true },
  { header: 'x-content-type-options', rule: 'x-content-type-options', severity: 'low' },
  { header: 'referrer-policy', rule: 'referrer-policy', severity: 'low' },
  { header: 'permissions-policy', rule: 'permissions-policy', severity: 'low', aliases: ['feature-policy'] },
];

const RATE_LIMIT_HEADERS = [
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
];

function missingStatus(isLoopback: boolean, thirdParty: boolean): SecurityFindingStatus {
  if (isLoopback) return 'NOTE';
  if (thirdParty) return 'WARNING';
  return 'FAIL';
}

function observedHeader(headers: Record<string, string>, rule: HeaderRule): { name: string; value: string } | null {
  const primary = headerValue(headers, rule.header);
  if (primary) return { name: rule.header, value: primary };
  for (const alias of rule.aliases ?? []) {
    const value = headerValue(headers, alias);
    if (value) return { name: alias, value };
  }
  return null;
}

export function collectSecurityHeaderFindings(input: {
  url: string;
  headers: Record<string, string>;
  isLoopback: boolean;
  isHttps: boolean;
  thirdParty?: boolean;
}): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const pagePath = pagePathOf(input.url);
  const thirdParty = input.thirdParty === true;

  for (const rule of SECURITY_HEADER_RULES) {
    if (rule.httpsOnly && !input.isHttps) {
      findings.push({
        status: 'NOT_APPLICABLE',
        rule: rule.rule,
        severity: 'info',
        detail: `${rule.header} applies to HTTPS responses only`,
        page: input.url,
        pagePath,
        expected: `${rule.header} on HTTPS`,
        actual: 'HTTP response',
      });
      continue;
    }

    const hit = observedHeader(input.headers, rule);
    if (!hit) {
      const reportOnly =
        rule.header === 'content-security-policy'
          ? headerValue(input.headers, 'content-security-policy-report-only')
          : undefined;
      if (reportOnly) {
        findings.push({
          status: 'WARNING',
          rule: rule.rule,
          severity: 'low',
          detail: 'content-security-policy-report-only is present; enforcing CSP is not',
          page: input.url,
          pagePath,
          expected: 'content-security-policy',
          actual: 'content-security-policy-report-only only',
        });
        continue;
      }
      findings.push({
        status: missingStatus(input.isLoopback, thirdParty),
        rule: rule.rule,
        severity: rule.severity,
        detail: `${rule.header} missing on ${input.url}`,
        page: input.url,
        pagePath,
        expected: rule.header,
        actual: 'absent',
      });
      continue;
    }

    if (rule.header === 'x-content-type-options' && !/\bnosniff\b/i.test(hit.value)) {
      findings.push({
        status: 'WARNING',
        rule: rule.rule,
        severity: 'low',
        detail: 'x-content-type-options is present but is not nosniff',
        page: input.url,
        pagePath,
        expected: 'nosniff',
        actual: 'present (value not copied)',
      });
      continue;
    }

    findings.push({
      status: 'PASS',
      rule: rule.rule,
      severity: 'info',
      detail: `${hit.name} is present`,
      page: input.url,
      pagePath,
      expected: rule.header,
      actual: hit.name === rule.header ? 'present' : `present as ${hit.name}`,
    });
  }

  findings.push(collectClickjackingFinding(input));
  return findings;
}

export function collectClickjackingFinding(input: {
  url: string;
  headers: Record<string, string>;
  isLoopback: boolean;
  thirdParty?: boolean;
}): SecurityFinding {
  const pagePath = pagePathOf(input.url);
  const xfo = headerValue(input.headers, 'x-frame-options');
  const csp = headerValue(input.headers, 'content-security-policy') ?? '';
  const hasFrameAncestors = /frame-ancestors/i.test(csp);

  if (xfo || hasFrameAncestors) {
    const weak = xfo && /allow-from/i.test(xfo);
    return {
      status: weak ? 'WARNING' : 'PASS',
      rule: 'clickjacking',
      severity: weak ? 'low' : 'info',
      detail: weak
        ? 'X-Frame-Options ALLOW-FROM is a deprecated clickjacking control'
        : 'Clickjacking control observed (X-Frame-Options or CSP frame-ancestors)',
      page: input.url,
      pagePath,
      expected: 'X-Frame-Options or CSP frame-ancestors',
      actual: xfo ? 'x-frame-options present' : 'csp frame-ancestors present',
    };
  }

  return {
    status: missingStatus(input.isLoopback, input.thirdParty === true),
    rule: 'clickjacking',
    severity: 'medium',
    detail: `clickjacking protection missing on ${input.url}`,
    page: input.url,
    pagePath,
    expected: 'X-Frame-Options or CSP frame-ancestors',
    actual: 'absent',
  };
}

/**
 * Rate-limit *indicators* on the same observational GET. Missing headers are NOTE.
 * This is never a flood or 429-forcing test.
 */
export function collectRateLimitFinding(input: {
  url: string;
  headers: Record<string, string>;
}): SecurityFinding {
  const present = RATE_LIMIT_HEADERS.filter((name) => headerValue(input.headers, name));
  if (present.length > 0) {
    return {
      status: 'PASS',
      rule: 'rate-limit-headers',
      severity: 'info',
      detail: 'Rate-limit indicator header(s) observed on a single GET',
      page: input.url,
      pagePath: pagePathOf(input.url),
      expected: 'Retry-After or RateLimit-* / X-RateLimit-* on the observed GET',
      actual: present.join(', '),
    };
  }
  return {
    status: 'NOTE',
    rule: 'rate-limit-headers',
    severity: 'info',
    detail: 'No Retry-After or RateLimit headers on this single GET — not a flood test',
    page: input.url,
    pagePath: pagePathOf(input.url),
    expected: 'Rate-limit headers are optional indicators',
    actual: 'absent (NOTE — not tested by sending many requests)',
  };
}
