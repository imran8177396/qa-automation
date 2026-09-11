import fs from 'fs';
import path from 'path';
import { PATHS } from './lib/paths';
import { logError, logStep, logSuccess, logWarn } from './lib/logger';
import { writeJson } from './discovery/write-json';
import { loadConfig } from './lib/load-config';
import { runNpmAudit } from './dependencies/npm-audit';
import { runSecretScan } from './dependencies/secret-scan';
import {
  DEPENDENCY_DISCLAIMER,
  DEPENDENCY_LIMITATIONS,
  type DependencyFinding,
  type DependencySeverity,
  type DependencySummary,
} from './dependencies/types';

const SEVERITY_RANK: Record<DependencySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function renderFindingsMarkdown(summary: DependencySummary): string {
  const lines: string[] = [
    '# Dependency & secrets QA — findings',
    '',
    summary.disclaimer,
    '',
    ...summary.limitations.map((line) => `- ${line}`),
    '',
    `Packages scanned: ${summary.packagesScanned} · Files scanned: ${summary.filesScanned} · Fail-on-severity: ${summary.failOnSeverity}`,
    '',
    '| Status | Severity | Rule | Detail |',
    '| --- | --- | --- | --- |',
    ...summary.findings.map(
      (row) => `| ${row.status} | ${row.severity} | ${row.rule} | ${row.detail.replace(/\|/g, '\\|')} |`
    ),
  ];
  if (summary.findings.length === 0) lines.push('| PASS | — | — | No advisories or secret-pattern matches found |');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  logStep('Dependency & secrets QA (npm audit + pattern-based secret scan)');
  fs.mkdirSync(PATHS.reports.dependencies, { recursive: true });

  const config = loadConfig();
  const failOnSeverity: DependencySummary['failOnSeverity'] = config.dependencies?.failOnSeverity ?? 'high';

  const audit = runNpmAudit();
  if (audit.error) logWarn(`npm audit did not complete cleanly: ${audit.error}`);

  const secrets = runSecretScan();

  const findings: DependencyFinding[] = [...audit.findings, ...secrets.findings];
  const bySeverity: DependencySummary['bySeverity'] = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of findings) bySeverity[row.severity] += 1;

  const failThreshold = SEVERITY_RANK[failOnSeverity];
  let failCount = 0;
  let noteCount = 0;
  let passCount = 0;
  for (const row of findings) {
    const isBlocking = row.status === 'FAIL' && SEVERITY_RANK[row.severity] >= failThreshold;
    if (isBlocking) failCount += 1;
    else if (row.status === 'FAIL' || row.status === 'NOTE') noteCount += 1;
    else passCount += 1;
  }
  if (findings.length === 0) passCount = 1;

  const summary: DependencySummary = {
    generatedAt: new Date().toISOString(),
    passed: failCount === 0,
    failCount,
    passCount,
    noteCount,
    packagesScanned: audit.packagesScanned,
    filesScanned: secrets.filesScanned,
    failOnSeverity,
    bySeverity,
    findings,
    disclaimer: DEPENDENCY_DISCLAIMER,
    limitations: [...DEPENDENCY_LIMITATIONS],
    auditError: audit.error,
  };

  writeJson(path.join(PATHS.reports.dependencies, 'summary.json'), summary);
  fs.writeFileSync(path.join(PATHS.reports.dependencies, 'findings.md'), renderFindingsMarkdown(summary), 'utf8');

  if (failCount === 0) {
    logSuccess(
      `Dependency & secrets QA passed — ${audit.packagesScanned} package(s) audited, ${secrets.filesScanned} file(s) scanned, ${noteCount} note(s)`
    );
  } else {
    logError(`${failCount} blocking finding(s) at or above '${failOnSeverity}' severity`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
