import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import type { PageMap } from './discovery/page-map';
import {
  SECURITY_DISCLAIMER,
  SECURITY_LIMITATIONS,
  type SecurityFinding,
  type SecuritySummary,
} from './security/types';
import { collectExposureFindings } from './security/exposure-findings';
import { isLoopbackUrl } from './orchestrator/resolve-url';
import type { DiscoveryResult } from './discovery/types';

function finding(input: Omit<SecurityFinding, 'status'> & { blocking?: boolean }): SecurityFinding {
  return {
    status: input.blocking === false ? 'NOTE' : input.severity === 'info' ? 'NOTE' : 'FAIL',
    rule: input.rule,
    severity: input.severity,
    detail: input.detail,
    page: input.page,
    pagePath: input.pagePath,
    expected: input.expected,
    actual: input.actual,
  };
}

async function fetchPage(url: string): Promise<{ status: number; headers: Record<string, string> }> {
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: response.status, headers };
}

async function main(): Promise<void> {
  logStep('Security QA (observational — not a pentest)');
  fs.mkdirSync(PATHS.reports.security, { recursive: true });

  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  if (!pageMap) {
    logError('Discovery page map missing');
    process.exit(1);
  }
  const target = pageMap.seedUrl;
  const findings: SecurityFinding[] = [];
  let failCount = 0;
  let noteCount = 0;
  let passCount = 0;
  const isLoopback = isLoopbackUrl(target);
  const origins = new Set<string>([new URL(target).origin]);

  const pagesToScan = pageMap.pages.filter((page) => !page.error && page.status != null && page.status < 400).slice(0, 5);
  for (const page of pagesToScan) {
    try {
      const { headers } = await fetchPage(page.url);
      origins.add(new URL(page.url).origin);
      for (const header of ['x-content-type-options', 'referrer-policy']) {
        if (!headers[header]) {
          const row = finding({
            rule: `missing-${header}`,
            severity: 'low',
            detail: `${header} missing on ${page.url}`,
            page: page.url,
            pagePath: page.route,
            blocking: !isLoopback,
          });
          findings.push(row);
          if (row.status === 'FAIL') failCount += 1;
          else noteCount += 1;
        } else {
          passCount += 1;
        }
      }
    } catch (error) {
      findings.push(finding({ rule: 'fetch-error', severity: 'medium', detail: `${page.url}: ${String(error)}`, page: page.url }));
      failCount += 1;
    }
  }

  const discovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);
  const exposurePages =
    discovery?.pages ??
    pageMap.pages.map((page) => ({
      url: page.url,
      title: page.title,
      isAutoindex: page.isAutoindex,
      status: page.status,
      error: page.error,
    }));
  for (const row of collectExposureFindings({ pages: exposurePages })) {
    findings.push(row);
    if (row.status === 'FAIL') failCount += 1;
    else if (row.status === 'NOTE') noteCount += 1;
    else if (row.status === 'PASS') passCount += 1;
  }

  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  for (const row of findings) bySeverity[row.severity] += 1;

  const summary: SecuritySummary = {
    generatedAt: new Date().toISOString(),
    target,
    passed: failCount === 0,
    failCount,
    passCount,
    noteCount,
    pagesAnalyzed: pagesToScan.length,
    originsAnalyzed: origins.size,
    bySeverity,
    findings,
    disclaimer: SECURITY_DISCLAIMER,
    limitations: [...SECURITY_LIMITATIONS],
  };
  writeJson(path.join(PATHS.reports.security, 'summary.json'), summary);
  if (failCount === 0) logSuccess('Security QA observations recorded');
  else {
    logWarn(`${failCount} security observation(s) recorded`);
    if (!isLoopback) process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
