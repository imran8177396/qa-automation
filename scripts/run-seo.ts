import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import { analyzeSeo, isSeoSkippedPage } from './seo/analyze-seo';
import { collectSeoFindings } from './seo/dedupe-findings';
import type { DiscoveryResult } from './discovery/types';
import type { SeoAnalysisResult, SeoSuiteSummary } from './seo/types';
import { SEO_DISCLAIMER, SEO_LIMITATIONS } from './seo/types';

function main(): void {
  logStep('SEO QA (technical — not a ranking audit)');
  fs.mkdirSync(PATHS.reports.seo, { recursive: true });

  const discovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);
  if (!discovery) {
    logError(`Discovery artifact missing — run discovery first (${PATHS.discoveryFile}).`);
    process.exit(1);
  }
  const suiteFindings = analyzeSeo(discovery);
  const discoverySeo = readJsonIfExists<SeoAnalysisResult>(PATHS.seoFile);
  const { findings, rawFindingCount, uniqueFindingCount } = collectSeoFindings(
    suiteFindings,
    discoverySeo?.findings ?? []
  );
  const failCount = findings.filter((row) => row.severity === 'high').length;

  const summary: SeoSuiteSummary = {
    generatedAt: new Date().toISOString(),
    target: discovery.seedUrl,
    passed: failCount === 0,
    failCount,
    pagesAnalyzed: discovery.pages.filter((page) => !isSeoSkippedPage(page)).length,
    rawFindingCount,
    uniqueFindingCount,
    findings,
    disclaimer: SEO_DISCLAIMER,
    limitations: [...SEO_LIMITATIONS],
  };

  writeJson(path.join(PATHS.reports.seo, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.seo, 'results.json'), summary);
  fs.writeFileSync(
    path.join(PATHS.reports.seo, 'findings.md'),
    `# SEO findings\n\nPages analyzed: ${summary.pagesAnalyzed}\nHigh severity: ${failCount}\nRaw findings: ${rawFindingCount}\nUnique findings: ${uniqueFindingCount}\n`,
    'utf8'
  );

  if (failCount === 0) logSuccess('SEO QA completed');
  else {
    logError(`${failCount} high-severity SEO finding(s) — see reports/seo/`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
