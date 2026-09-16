import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import type { PageMap } from './discovery/page-map';
import type { DiscoveryResult } from './discovery/types';
import type { UiInventory } from './discovery/ui-scan';
import { isLoopbackUrl } from './orchestrator/resolve-url';
import { collectApiHygieneFindings, documentedApiGetUrl } from './security/api-hygiene';
import { parseSetCookie, collectCookieFindings, type ObservedCookie } from './security/cookies';
import { collectCsrfFindings } from './security/csrf';
import { collectErrorDisclosureFindings } from './security/error-disclosure';
import { collectExposureFindings } from './security/exposure-findings';
import { renderFindingsMarkdown, tallyFindings } from './security/findings';
import { collectHttpsFinding } from './security/https';
import { collectRateLimitFinding, collectSecurityHeaderFindings } from './security/headers';
import { collectInputValidationFindings } from './security/input-validation';
import { headerValue, pagePathOf, safeGet, type ProbeResult } from './security/probe';
import { collectSensitiveFindings } from './security/sensitive';
import {
  SECURITY_DISCLAIMER,
  SECURITY_LIMITATIONS,
  type SecurityFinding,
  type SecuritySummary,
} from './security/types';
import {
  WELL_KNOWN_PATHS,
  extractSameOriginSourceMaps,
  wellKnownFinding,
} from './security/well-known';

function resolveTarget(pageMap: PageMap | null, websiteUrl: string | undefined, playwrightBaseUrl: string | undefined): {
  target: string | null;
  source: 'page-map' | 'config' | 'none';
} {
  if (pageMap?.seedUrl) return { target: pageMap.seedUrl, source: 'page-map' };
  if (websiteUrl) return { target: websiteUrl, source: 'config' };
  if (playwrightBaseUrl) return { target: playwrightBaseUrl, source: 'config' };
  return { target: null, source: 'none' };
}

function sameOriginPath(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const pathA = a.pathname.replace(/\/+$/, '') || '/';
    const pathB = b.pathname.replace(/\/+$/, '') || '/';
    return a.origin === b.origin && pathA === pathB;
  } catch {
    return left === right;
  }
}

function discoveryEvidenceText(
  url: string,
  pageMap: PageMap | null,
  discovery: DiscoveryResult | null
): string {
  const pages: Array<{ url: string; title?: string; headings?: Array<{ text: string }>; h1s?: string[] }> = [
    ...(discovery?.pages ?? []),
    ...(pageMap?.pages ?? []),
  ];
  return pages
    .filter((page) => sameOriginPath(page.url, url))
    .flatMap((page) => [
      page.title ?? '',
      ...(page.h1s ?? []),
      ...(page.headings ?? []).map((heading) => heading.text),
    ])
    .filter(Boolean)
    .join('\n');
}

function pagesToScan(pageMap: PageMap | null, target: string): Array<{ url: string; route: string }> {
  const crawled =
    pageMap?.pages
      .filter((page) => !page.error && page.status != null && page.status < 400)
      .slice(0, 5)
      .map((page) => ({ url: page.url, route: page.route })) ?? [];
  if (crawled.length > 0) return crawled;
  return [{ url: target, route: pagePathOf(target) }];
}

function writeReports(
  target: string | null,
  findings: SecurityFinding[],
  pagesAnalyzed: number,
  originsAnalyzed: number
): ReturnType<typeof tallyFindings> {
  const counts = tallyFindings(findings);
  const summary: SecuritySummary = {
    generatedAt: new Date().toISOString(),
    target,
    passed: counts.failCount === 0,
    failCount: counts.failCount,
    passCount: counts.passCount,
    noteCount: counts.noteCount,
    warningCount: counts.warningCount,
    notTestedCount: counts.notTestedCount,
    blockedCount: counts.blockedCount,
    pagesAnalyzed,
    originsAnalyzed,
    bySeverity: counts.bySeverity,
    findings,
    disclaimer: SECURITY_DISCLAIMER,
    limitations: [...SECURITY_LIMITATIONS],
  };
  writeJson(path.join(PATHS.reports.security, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.security, 'results.json'), summary);
  fs.writeFileSync(path.join(PATHS.reports.security, 'findings.md'), renderFindingsMarkdown(summary), 'utf8');
  return counts;
}

function logStatusTable(findings: SecurityFinding[]): void {
  for (const row of findings) {
    console.log(`${row.status}\t${row.rule}\t${row.pagePath ?? row.page ?? ''}\t${row.detail}`);
  }
}

async function main(): Promise<void> {
  logStep('Security QA (observational — not a pentest)');
  logWarn(SECURITY_DISCLAIMER);
  fs.mkdirSync(PATHS.reports.security, { recursive: true });

  const config = loadConfig();
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const discovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);
  const inventory = readJsonIfExists<UiInventory>(PATHS.uiInventoryFile);
  const { target, source } = resolveTarget(pageMap, config.urls.website, config.playwright.baseURL);
  const findings: SecurityFinding[] = [];

  if (!target) {
    findings.push({
      status: 'BLOCKED',
      rule: 'https-scheme',
      severity: 'medium',
      detail: 'No website URL in discovery page map or qa.config.json — security QA could not run',
      expected: 'qa.config.json urls.website',
      actual: 'absent',
    });
    writeReports(null, findings, 0, 0);
    logError('Security QA blocked — no target URL');
    process.exit(1);
  }

  if (source !== 'page-map') {
    findings.push({
      status: 'WARNING',
      rule: 'discovery-page-map',
      severity: 'info',
      detail:
        'Discovery page map was not present; origin-level checks used qa.config.json. Inventory-dependent checks stay NOT_TESTED when inventory is missing.',
      page: target,
      pagePath: pagePathOf(target),
      expected: 'discovery/page-map.json from a prior discover run',
      actual: 'page map absent',
    });
  }

  const isLoopback = isLoopbackUrl(target);
  const origins = new Set<string>([new URL(target).origin]);
  findings.push(collectHttpsFinding({ url: target, isLoopback, surface: 'website' }));

  const pages = pagesToScan(pageMap, target);
  const probes = new Map<string, ProbeResult>();

  for (const page of pages) {
    const probe = await safeGet(page.url, { redirect: 'follow' });
    origins.add(new URL(page.url).origin);
    if (probe.error || probe.status == null) {
      findings.push({
        status: 'BLOCKED',
        rule: 'fetch-error',
        severity: 'medium',
        detail: `${page.url}: ${probe.error ?? 'no HTTP status'}`,
        page: page.url,
        pagePath: page.route,
        expected: 'reachable observational GET',
        actual: probe.error ?? 'no status',
      });
      continue;
    }

    probes.set(page.url, probe);
    const isHttps = page.url.startsWith('https:') || probe.finalUrl.startsWith('https:');
    const cookies: ObservedCookie[] = probe.setCookies
      .map(parseSetCookie)
      .filter((row): row is ObservedCookie => row != null);
    const formObserved = Boolean(
      inventory?.elements.some((el) => {
        if (el.elementType !== 'form' && el.elementType !== 'input' && !el.isSubmit) return false;
        return sameOriginPath(el.page, page.url);
      })
    );

    findings.push(
      ...collectSecurityHeaderFindings({
        url: page.url,
        headers: probe.headers,
        isLoopback,
        isHttps,
      }),
      collectRateLimitFinding({ url: page.url, headers: probe.headers }),
      ...collectCookieFindings({
        url: page.url,
        setCookies: probe.setCookies,
        isLoopback,
        isHttps,
      }),
      ...collectSensitiveFindings({
        url: page.url,
        html: probe.body,
        extraText: discoveryEvidenceText(page.url, pageMap, discovery),
      }),
      collectCsrfFindings({ url: page.url, html: probe.body, cookies, formObserved }),
      ...collectInputValidationFindings({ url: page.url, html: probe.body, inventory })
    );
  }

  const homepageBody = [...probes.values()].find((row) => row.body)?.body ?? '';

  const exposurePages =
    discovery?.pages ??
    pageMap?.pages.map((page) => ({
      url: page.url,
      title: page.title,
      isAutoindex: page.isAutoindex,
      status: page.status,
      error: page.error,
    })) ??
    [];
  findings.push(...collectExposureFindings({ pages: exposurePages }));
  findings.push(
    ...collectErrorDisclosureFindings({
      pages:
        discovery?.pages ??
        pageMap?.pages.map((page) => ({
          url: page.url,
          status: page.status,
          title: page.title,
          error: page.error,
          consoleErrors: [],
        })) ??
        [],
    })
  );

  const origin = new URL(target).origin;
  logStep(`Well-known path GETs (${WELL_KNOWN_PATHS.length} paths, one GET each)`);
  for (const wellKnownPath of WELL_KNOWN_PATHS) {
    const url = `${origin}${wellKnownPath}`;
    const probe = await safeGet(url, { redirect: 'manual', maxBodyBytes: 64 * 1024 });
    findings.push(
      wellKnownFinding({
        origin,
        path: wellKnownPath,
        status: probe.status,
        contentType: headerValue(probe.headers, 'content-type') ?? '',
        body: probe.body,
        homepageBody,
        error: probe.error,
      })
    );
  }

  const mapUrls = new Set<string>();
  for (const page of pages) {
    const html = probes.get(page.url)?.body ?? homepageBody;
    for (const mapUrl of extractSameOriginSourceMaps(page.url, html)) {
      mapUrls.add(mapUrl);
    }
  }
  for (const mapUrl of [...mapUrls].slice(0, 5)) {
    const probe = await safeGet(mapUrl, { redirect: 'manual', maxBodyBytes: 64 * 1024 });
    findings.push(
      wellKnownFinding({
        origin,
        path: pagePathOf(mapUrl),
        status: probe.status,
        contentType: headerValue(probe.headers, 'content-type') ?? '',
        body: probe.body,
        homepageBody,
        error: probe.error,
      })
    );
  }

  const firstGet = config.postman?.requests?.find(
    (request) => request.method === 'GET' && (request.kind === 'valid' || request.kind == null)
  );
  const apiUrl = documentedApiGetUrl(config.urls.api, firstGet?.path);
  if (apiUrl && new URL(apiUrl).origin === origin) {
    findings.push({
      status: 'NOT_TESTED',
      rule: 'api-https',
      severity: 'info',
      detail:
        'Documented API origin matches the website origin but no Sauce Demo REST was discovered — extra API routes were not invented',
      page: apiUrl,
      pagePath: pagePathOf(apiUrl),
      expected: 'documented API only when it is a distinct configured API',
      actual: 'same origin as website; Sauce Demo XHR was not invented',
    });
  } else if (apiUrl) {
    logStep(`Documented API hygiene GET ${apiUrl}`);
    const apiProbe = await safeGet(apiUrl, { redirect: 'follow', maxBodyBytes: 64 * 1024 });
    origins.add(new URL(apiUrl).origin);
    findings.push(...collectApiHygieneFindings({ apiUrl, probe: apiProbe }));
  } else {
    findings.push(...collectApiHygieneFindings({ apiUrl: null }));
  }

  const counts = writeReports(target, findings, pages.length, origins.size);
  logStatusTable(findings);
  logStep(
    `PASS ${counts.passCount} · FAIL ${counts.failCount} · WARNING ${counts.warningCount} · NOTE ${counts.noteCount} · NOT_TESTED ${counts.notTestedCount} · BLOCKED ${counts.blockedCount}`
  );

  const unreachable =
    counts.blockedCount > 0 && counts.passCount === 0 && counts.failCount === 0 && counts.warningCount === 0;
  if (counts.failCount === 0 && !unreachable) {
    logSuccess('Security QA observations recorded');
    return;
  }
  console.log(`! ${counts.failCount} security FAIL observation(s) recorded`);
  if (!isLoopback) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
