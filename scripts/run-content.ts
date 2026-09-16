import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import type { PageMap } from './discovery/page-map';
import type { DiscoveryResult } from './discovery/types';
import { collectContentSuiteFindings } from './content/collect';
import { renderContentFindingsMarkdown, tallyContentFindings } from './content/findings';
import {
  CONTENT_DISCLAIMER,
  CONTENT_LIMITATIONS,
  type ContentFinding,
  type ContentSummary,
} from './content/types';

function logStatusTable(findings: ContentFinding[]): void {
  for (const row of findings) {
    console.log(`${row.status}\t${row.rule}\t${row.page}\t${row.detail}`);
  }
}

async function main(): Promise<void> {
  logStep('Content QA (structural — not factual verification)');
  logWarn(CONTENT_DISCLAIMER);
  fs.mkdirSync(PATHS.reports.content, { recursive: true });

  const config = loadConfig();
  if (config.content?.enabled === false) {
    const findings: ContentFinding[] = [
      {
        status: 'NOT_TESTED',
        rule: 'content-enabled',
        severity: 'info',
        page: 'site-wide',
        detail: 'content.enabled is false in qa.config.json.',
        expected: 'content.enabled true to run structural content QA',
        actual: 'false',
      },
    ];
    const counts = tallyContentFindings(findings);
    const summary: ContentSummary = {
      generatedAt: new Date().toISOString(),
      target: config.urls.website ?? null,
      passed: true,
      failCount: counts.failCount,
      passCount: counts.passCount,
      noteCount: counts.noteCount,
      warningCount: counts.warningCount,
      notTestedCount: counts.notTestedCount,
      blockedCount: counts.blockedCount,
      pagesAnalyzed: 0,
      bySeverity: counts.bySeverity,
      findings,
      disclaimer: CONTENT_DISCLAIMER,
      limitations: [...CONTENT_LIMITATIONS],
    };
    writeJson(path.join(PATHS.reports.content, 'summary.json'), summary);
    writeJson(path.join(PATHS.reports.content, 'results.json'), summary);
    fs.writeFileSync(path.join(PATHS.reports.content, 'findings.md'), renderContentFindingsMarkdown(summary), 'utf8');
    logWarn('Content QA NOT_TESTED — content.enabled is false');
    return;
  }

  const pageMap = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  const discovery = readJsonIfExists<DiscoveryResult>(PATHS.discoveryFile);

  if (!pageMap && !discovery) {
    const findings: ContentFinding[] = [
      {
        status: 'BLOCKED',
        rule: 'discovery',
        severity: 'medium',
        page: 'site-wide',
        detail: 'Discovery page map and discovery.json are missing — run discovery first.',
        expected: 'discovery/page-map.json or reports/discovery/discovery.json',
        actual: 'absent',
      },
    ];
    const counts = tallyContentFindings(findings);
    const summary: ContentSummary = {
      generatedAt: new Date().toISOString(),
      target: config.urls.website ?? null,
      passed: false,
      failCount: counts.failCount,
      passCount: counts.passCount,
      noteCount: counts.noteCount,
      warningCount: counts.warningCount,
      notTestedCount: counts.notTestedCount,
      blockedCount: counts.blockedCount,
      pagesAnalyzed: 0,
      bySeverity: counts.bySeverity,
      findings,
      disclaimer: CONTENT_DISCLAIMER,
      limitations: [...CONTENT_LIMITATIONS],
    };
    writeJson(path.join(PATHS.reports.content, 'summary.json'), summary);
    writeJson(path.join(PATHS.reports.content, 'results.json'), summary);
    fs.writeFileSync(path.join(PATHS.reports.content, 'findings.md'), renderContentFindingsMarkdown(summary), 'utf8');
    logError('Content QA blocked — discovery artifacts missing');
    process.exit(1);
  }

  const { findings, pagesAnalyzed, target } = await collectContentSuiteFindings({
    pageMap,
    discovery,
    config,
  });
  const counts = tallyContentFindings(findings);

  const summary: ContentSummary = {
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
    bySeverity: counts.bySeverity,
    findings,
    disclaimer: CONTENT_DISCLAIMER,
    limitations: [...CONTENT_LIMITATIONS],
  };

  writeJson(path.join(PATHS.reports.content, 'summary.json'), summary);
  writeJson(path.join(PATHS.reports.content, 'results.json'), summary);
  fs.writeFileSync(path.join(PATHS.reports.content, 'findings.md'), renderContentFindingsMarkdown(summary), 'utf8');

  logStatusTable(findings);
  logStep(
    `PASS ${counts.passCount} · FAIL ${counts.failCount} · WARNING ${counts.warningCount} · NOTE ${counts.noteCount} · NOT_TESTED ${counts.notTestedCount} · BLOCKED ${counts.blockedCount}`
  );

  const unreachable = counts.blockedCount > 0 && counts.passCount === 0 && counts.failCount === 0;
  if (counts.failCount === 0 && !unreachable) {
    logSuccess('Content QA completed — claims were not fact-checked');
    return;
  }
  logError(`${counts.failCount} content FAIL finding(s) — see reports/content/`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
