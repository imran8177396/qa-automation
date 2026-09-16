import { collectHttpsFinding } from './https';
import { collectRateLimitFinding, collectSecurityHeaderFindings } from './headers';
import { isLoopbackUrl } from '../orchestrator/resolve-url';
import { joinUrl, pagePathOf, type ProbeResult } from './probe';
import type { SecurityFinding } from './types';

export function documentedApiGetUrl(apiBase: string | undefined, getPath: string | undefined): string | null {
  if (!apiBase) return null;
  if (!getPath) return apiBase.replace(/\/+$/, '');
  return joinUrl(apiBase, getPath);
}

export function collectApiHygieneFindings(input: {
  apiUrl: string | null;
  probe?: ProbeResult;
}): SecurityFinding[] {
  if (!input.apiUrl) {
    return [
      {
        status: 'NOT_TESTED',
        rule: 'api-https',
        severity: 'info',
        detail: 'No documented API URL is configured — Sauce Demo REST was not invented',
        expected: 'qa.config.json urls.api when an API is documented',
        actual: 'no API URL',
      },
    ];
  }

  const isLoopback = isLoopbackUrl(input.apiUrl);
  const findings: SecurityFinding[] = [
    collectHttpsFinding({ url: input.apiUrl, isLoopback, surface: 'documented API' }),
  ];

  if (!input.probe) {
    findings.push({
      status: 'BLOCKED',
      rule: 'api-headers',
      severity: 'low',
      detail: 'Documented API GET was not executed',
      page: input.apiUrl,
      pagePath: pagePathOf(input.apiUrl),
      expected: 'one safe GET for header hygiene',
      actual: 'no probe',
    });
    return findings;
  }

  if (input.probe.error) {
    findings.push({
      status: 'BLOCKED',
      rule: 'api-headers',
      severity: 'medium',
      detail: `Documented API GET failed: ${input.probe.error}`,
      page: input.apiUrl,
      pagePath: pagePathOf(input.apiUrl),
      expected: 'reachable documented GET',
      actual: 'request error',
    });
    return findings;
  }

  const isHttps = input.apiUrl.startsWith('https:');
  findings.push(
    ...collectSecurityHeaderFindings({
      url: input.apiUrl,
      headers: input.probe.headers,
      isLoopback,
      isHttps,
      thirdParty: true,
    }),
    collectRateLimitFinding({ url: input.apiUrl, headers: input.probe.headers })
  );
  return findings;
}
