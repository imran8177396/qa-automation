import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import type { DiscoveryResult } from './discovery/types';
import type { PageMap } from './discovery/page-map';
import { collectSeoFindings } from './seo/dedupe-findings';
import { collectSeoSuiteFindings } from './seo/collect';
import { renderSeoFindingsMarkdown, tallySeoFindings } from './seo/findings';
import { discoveryFromPageMap } from './seo/hydrate';
import { defaultSeoProbe, fetchPageHtml } from './seo/http';
import { isSeoSkippedPage } from './seo/analyze-seo';
import type { SeoAnalysisResult, SeoSuiteSummary } from './seo/types';
import { SEO_DISCLAIMER, SEO_LIMITATIONS } from './seo/types';

function logStatusTable(summary: SeoSuiteSummary): void {
  for (const row of summary.findings) {
    console.log(`${row.status ?? 'NOTE'}\t${row.rule}\t${row.page}\t${row.detail}`);
  }
}

async function main(): Promise<void> {
  logStep('SEO QA (technical — not a ranking audit)');
  logWarn(SEO_DISCLAIMER);
  fs.mkdirSync(PATHS.reports.seo, { recursive: true });

  const config = loadConfig();
  if (config.seo?.enabled === false) {
    const summary: SeoSuiteSummary = {
      generatedAt: new Date().toISOString(),
      target: config.urls.website ?? null,
      passed: true,
      failCount: 0,
      passCount: 0,
      warningCount: 0,
      noteCount: 0,
      notTestedCount: 1,
      blockedCount: 0,
      pagesAnalyzed: 0,
      rawFindingCount: 1,
      uniqueFindingCount: 1,
      bySeverity: { high: 0, medium: 0, low: 0, info: 1 },
      findings: [
        {
          id: 'SEO-0001',
          rule: 'seo-enabled',
          severity: 'info',
          status: 'NOT_TESTED',
          page: 'site-wide',
          detail: 'seo.enabled is false in qa.config.json.',
          expected: 'seo.enabled true to run technical SEO QA',
          actual: 'false',
        },
      ],
      disclaimer: SEO_DISCLAIMER,
      limitations: [...SEO_LIMITATIONS],
    };
    writeJson(path.join(PATHS.reports.seo, 'summary.json'), summary);
    writeJson(path.join(PATHS.reports.seo, 'results.json'), summary);
    fs.writeFileSync(path.join(PATHS.reports.seo, 'findings.md'), renderSeoFindingsMarkdown(summary), 'utf8');
    logWarn('SEO QA NOT_TESTED — seo.enabled is false');
    return;
  }

  const storedDiscovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);
  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);

  if (!storedDiscovery && !pageMap) {
    const summary: SeoSuiteSummary = {
      generatedAt: new Date().toISOString(),
      target: config.urls.website ?? null,
      passed: false,
      failCount: 0,
      passCount: 0,
      warningCount: 0,
      noteCount: 0,
      notTestedCount: 0,
      blockedCount: 1,
      pagesAnalyzed: 0,
      rawFindingCount: 1,
      uniqueFindingCount: 1,
      bySeverity: { high: 0, medium: 1, low: 0, info: 0 },
      findings: [
        {
          id: 'SEO-0001',
          rule: 'discovery',
          severity: 'medium',
          status: 'BLOCKED',
          page: 'site-wide',
          detail: `Discovery artifact and page map are missing — run discovery first (${PATHS.discoveryFile} or ${PATHS.pageMapFile}).`,
          expected: 'reports/discovery/discovery.json or discovery/page-map.json',
          actual: 'absent',
        },
      ],
      disclaimer: SEO_DISCLAIMER,
      limitations: [...SEO_LIMITATIONS],
    };
    writeJson(path.join(PATHS.reports.seo, 'summary.json'), summary);
    writeJson(path.join(PATHS.reports.seo, 'results.json'), summary);
    fs.writeFileSync(path.join(PATHS.reports.seo, 'findings.md'), renderSeoFindingsMarkdown(summary), 'utf8');
    logError('SEO QA blocked — discovery artifacts missing');
    process.exit(1);
  }

  const seed = storedDiscovery?.seedUrl ?? pageMap?.seedUrl ?? config.urls.website;
  const pageUrls = (storedDiscovery?.pages ?? pageMap?.pages ?? [])
    .filter((page) => !page.error && page.status != null && page.status < 400 && !isSeoSkippedPage(page))
    .map((page) => page.url);
  const htmlByUrl = await fetchPageHtml(pageUrls, defaultSeoProbe);
  const parsedByUrl = new Map([...htmlByUrl].map(([url, snap]) => [url, snap.parsed]));
  const discovery = storedDiscovery ?? discoveryFromPageMap(pageMap as PageMap, parsedByUrl);

  const suiteFindings = await collectSeoSuiteFindings({
    discovery,
    pageMap,
    config,
    htmlByUrl,
  });
  const discoverySeo = readJsonIfExists<SeoAnalysisResult>(PATHS.seoFile);
  const { findings, rawFindingCount, uniqueFindingCount } = collectSeoFindings(
    suiteFindings,
    discoverySeo?.findings ?? []
  );
  const counts = tallySeoFindings(findings);

  const summary: SeoSuiteSummary = {
    generatedAt: new Date().toISOString(),
    target: seed ?? null,
    passed: counts.failCount === 0,
    failCount: counts.failCount,
    passCount: counts.passCount,
    warningCount: counts.warningCount,
    noteCount: counts.noteCount,
    notTestedCount: counts.notTestedCount,
    blockedCount: counts.blockedCount,
    pagesAnalyzed: discovery.pages.filter((page) => !isSeoSkippedPage(page)).length,
    rawFindingCount,
    uniqueFindingCount,
    bySeverity: counts.bySeverity,
    findings,
    disclaimer: SEO_DISCLAIMER,
    limitations: [...SEO_LIMITATIONS],
  };

  writeJson(path.join(PATHS.reports.seo, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.seo, 'results.json'), summary);
  fs.writeFileSync(path.join(PATHS.reports.seo, 'findings.md'), renderSeoFindingsMarkdown(summary), 'utf8');

  logStatusTable(summary);
  logStep(
    `PASS ${counts.passCount} · FAIL ${counts.failCount} · WARNING ${counts.warningCount} · NOTE ${counts.noteCount} · NOT_TESTED ${counts.notTestedCount} · BLOCKED ${counts.blockedCount}`
  );

  const unreachable = counts.blockedCount > 0 && counts.passCount === 0 && counts.failCount === 0;
  if (counts.failCount === 0 && !unreachable) {
    logSuccess('SEO QA completed — not a ranking audit');
    return;
  }
  logError(`${counts.failCount} SEO FAIL finding(s) — see reports/seo/`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
