import type { DiscoveredPage } from '../discovery/types';
import { pagePathOf } from './probe';
import type { SecurityFinding } from './types';

const STACK_HINT =
  /traceback|stack trace|exception in|at [A-Za-z_$][\w$]*\.[A-Za-z_$]|SQLException|ORA-\d{5}|SequelizeDatabaseError|Undefined index|Notice:|Fatal error:|django\.(core|db)|Internal Server Error/i;

export function collectErrorDisclosureFindings(input: {
  pages: Array<Pick<DiscoveredPage, 'url' | 'status' | 'title' | 'error' | 'consoleErrors'>>;
}): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const errorPages = input.pages.filter((page) => page.status != null && page.status >= 400);

  if (errorPages.length === 0) {
    findings.push({
      status: 'NOT_TESTED',
      rule: 'error-disclosure',
      severity: 'info',
      detail:
        'No 4xx/5xx responses were present in discovery evidence. Server errors were not forced.',
      expected: 'observe existing error responses only',
      actual: 'no error responses observed',
    });
    return findings;
  }

  for (const page of errorPages) {
    const hay = [page.title ?? '', page.error ?? '', ...(page.consoleErrors ?? [])].join('\n');
    const stack = STACK_HINT.test(hay);
    const isServer = (page.status ?? 0) >= 500;
    findings.push({
      status: stack ? 'FAIL' : isServer ? 'WARNING' : 'PASS',
      rule: 'error-disclosure',
      severity: stack ? 'high' : isServer ? 'low' : 'info',
      detail: stack
        ? `Error response ${page.status} includes stack/exception indicators (details not copied)`
        : isServer
          ? `HTTP ${page.status} was already observed — no stack-trace indicators in discovery title/error text`
          : `HTTP ${page.status} observed without stack-trace indicators`,
      page: page.url,
      pagePath: pagePathOf(page.url),
      expected: 'error pages without stack traces or framework internals',
      actual: stack ? `HTTP ${page.status} [REDACTED stack indicators]` : `HTTP ${page.status}`,
    });
  }
  return findings;
}
