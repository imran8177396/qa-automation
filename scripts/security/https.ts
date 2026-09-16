import { pagePathOf } from './probe';
import type { SecurityFinding } from './types';

export function collectHttpsFinding(input: {
  url: string;
  isLoopback: boolean;
  surface?: string;
}): SecurityFinding {
  const surface = input.surface ?? 'website';
  let protocol = '';
  try {
    protocol = new URL(input.url).protocol;
  } catch {
    return {
      status: 'BLOCKED',
      rule: 'https-scheme',
      severity: 'medium',
      detail: `${surface} URL could not be parsed for HTTPS: ${input.url}`,
      page: input.url,
      pagePath: pagePathOf(input.url),
      expected: 'https:',
      actual: 'unparseable URL',
    };
  }

  if (protocol === 'https:') {
    return {
      status: 'PASS',
      rule: 'https-scheme',
      severity: 'info',
      detail: `${surface} is served over HTTPS`,
      page: input.url,
      pagePath: pagePathOf(input.url),
      expected: 'https:',
      actual: protocol,
    };
  }

  if (input.isLoopback && protocol === 'http:') {
    return {
      status: 'NOT_APPLICABLE',
      rule: 'https-scheme',
      severity: 'info',
      detail: 'HTTPS is NOT_APPLICABLE on a loopback HTTP fixture',
      page: input.url,
      pagePath: pagePathOf(input.url),
      expected: 'https: on a non-loopback origin',
      actual: protocol,
    };
  }

  return {
    status: 'FAIL',
    rule: 'https-scheme',
    severity: 'high',
    detail: `${surface} is not HTTPS`,
    page: input.url,
    pagePath: pagePathOf(input.url),
    expected: 'https:',
    actual: protocol,
  };
}
