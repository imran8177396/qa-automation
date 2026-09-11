import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import type { PageMap } from './discovery/page-map';
import {
  CONTENT_DISCLAIMER,
  CONTENT_LIMITATIONS,
  type ContentFinding,
  type ContentSummary,
} from './content/types';
import { isAutoindexTitle } from './security/autoindex';

function main(): void {
  logStep('Content QA (structural — not factual verification)');
  fs.mkdirSync(PATHS.reports.content, { recursive: true });

  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  if (!pageMap) {
    logError('Discovery page map missing — run discovery first.');
    process.exit(1);
  }
  const findings: ContentFinding[] = [];
  let failCount = 0;
  let passCount = 0;
  let analyzedCount = 0;
  const noteCount = 0;

  for (const page of pageMap.pages) {
    if (page.error || page.status == null || page.status >= 400) continue;
    if (page.isAutoindex === true || isAutoindexTitle(page.title ?? '')) continue;
    analyzedCount += 1;
    let pageFailed = false;
    if (!page.title?.trim()) {
      findings.push({
        status: 'FAIL',
        rule: 'missing-title',
        severity: 'high',
        page: page.url,
        detail: 'Page has no title in discovery snapshot.',
        expected: 'non-empty title',
        actual: '(empty)',
      });
      failCount += 1;
      pageFailed = true;
    }
    if ((page.h1s ?? []).length === 0) {
      findings.push({
        status: 'FAIL',
        rule: 'missing-h1',
        severity: 'high',
        page: page.url,
        detail: 'Page has no h1 in discovery snapshot.',
        expected: 'at least one h1',
        actual: '0',
      });
      failCount += 1;
      pageFailed = true;
    }
    if (!pageFailed) passCount += 1;
  }

  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  for (const row of findings) bySeverity[row.severity] += 1;

  const summary: ContentSummary = {
    generatedAt: new Date().toISOString(),
    target: pageMap.seedUrl,
    passed: failCount === 0,
    failCount,
    passCount,
    noteCount,
    pagesAnalyzed: analyzedCount,
    bySeverity,
    findings,
    disclaimer: CONTENT_DISCLAIMER,
    limitations: [...CONTENT_LIMITATIONS],
  };

  writeJson(path.join(PATHS.reports.content, 'summary.json'), summary);
  if (failCount === 0) logSuccess('Content QA completed');
  else {
    logWarn(`${failCount} content finding(s) — see reports/content/`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
