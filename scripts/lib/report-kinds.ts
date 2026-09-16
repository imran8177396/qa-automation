import fs from 'fs';
import path from 'path';
import { PATHS, ROOT } from './paths';
import { formatReportTimestamp } from './qa-report/format';

export const REPORT_KIND_IDS = [
  'allure',
  'playwrightHtml',
  'postman',
  'jmeter',
  'finalCombined',
  'jsonSummary',
] as const;

export type ReportKindId = (typeof REPORT_KIND_IDS)[number];

export type ReportKindStatus = 'PRESENT' | 'NOT_EXECUTED' | 'BLOCKED';

export interface ReportKindRecord {
  id: ReportKindId;
  name: string;
  status: ReportKindStatus;
  path: string;
  indexFile?: string;
  reason?: string;
  extras?: Record<string, string | string[] | boolean | number | null>;
}

export interface ReportKindRoots {
  root: string;
  allureResults: string;
  allureReport: string;
  playwright: string;
  postman: string;
  jmeter: string;
  summary: string;
}

export interface AllureStatusOverride {
  status: ReportKindStatus;
  reason?: string;
  indexFile?: string;
  archivedTo?: string;
}

export function defaultReportKindRoots(): ReportKindRoots {
  return {
    root: ROOT,
    allureResults: PATHS.allureResults,
    allureReport: PATHS.allureReport,
    playwright: PATHS.reports.playwright,
    postman: PATHS.reports.postman,
    jmeter: PATHS.reports.jmeter,
    summary: PATHS.reports.summary,
  };
}

export function toPosixRelative(absPath: string, root = ROOT): string {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

export function isExistingFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

export function htmlIndexPath(dir: string): string {
  return path.join(dir, 'index.html');
}

export function dirHasHtmlIndex(dir: string): boolean {
  return isExistingFile(htmlIndexPath(dir));
}

export function listAllureResultFiles(resultsDir: string): string[] {
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir)
    .filter((name) => name.endsWith('-result.json') || name.endsWith('-container.json'))
    .map((name) => path.join(resultsDir, name));
}

export function allureResultsPresent(resultsDir: string): boolean {
  return listAllureResultFiles(resultsDir).length > 0;
}

export function shouldArchiveAllureReport(reportDir: string): boolean {
  return dirHasHtmlIndex(reportDir);
}

/** Timestamped folder under historyRoot. Never reuses an occupied stamp. */
export function allocateAllureHistoryDir(historyRoot: string, now = new Date()): string {
  const base = formatReportTimestamp(now.toISOString());
  if (!fs.existsSync(path.join(historyRoot, base))) {
    return path.join(historyRoot, base);
  }
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!fs.existsSync(path.join(historyRoot, candidate))) {
      return path.join(historyRoot, candidate);
    }
  }
  throw new Error(`Could not allocate a unique Allure history folder under ${historyRoot}`);
}

export function listPlaywrightHtmlReports(
  playwrightRoot: string,
  root = ROOT
): Array<{ suite: string; indexFile: string; absIndex: string }> {
  if (!fs.existsSync(playwrightRoot)) return [];
  const rows: Array<{ suite: string; indexFile: string; absIndex: string }> = [];
  for (const entry of fs.readdirSync(playwrightRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absIndex = htmlIndexPath(path.join(playwrightRoot, entry.name, 'html'));
    if (!isExistingFile(absIndex)) continue;
    rows.push({
      suite: entry.name,
      indexFile: toPosixRelative(absIndex, root),
      absIndex,
    });
  }
  return rows.sort((a, b) => a.suite.localeCompare(b.suite));
}

function firstExisting(filePaths: string[]): string | undefined {
  return filePaths.find((filePath) => isExistingFile(filePath));
}

export function inspectReportKinds(
  roots: ReportKindRoots = defaultReportKindRoots(),
  allureOverride?: AllureStatusOverride
): ReportKindRecord[] {
  const playwrightSuites = listPlaywrightHtmlReports(roots.playwright, roots.root);
  const postmanIndex = firstExisting([
    path.join(roots.postman, 'cli-report.html'),
    path.join(roots.postman, 'report.html'),
    path.join(roots.postman, 'report.json'),
  ]);
  const jmeterIndex = firstExisting([
    htmlIndexPath(path.join(roots.jmeter, 'html')),
    path.join(roots.jmeter, 'summary.json'),
    path.join(roots.jmeter, 'results.jtl'),
  ]);
  const finalMd = path.join(roots.summary, 'final-qa-report.md');
  const indexJson = path.join(roots.summary, 'report-index.json');
  const allureIndex = htmlIndexPath(roots.allureReport);

  const allure: ReportKindRecord = allureOverride
    ? {
        id: 'allure',
        name: 'Allure report',
        status: allureOverride.status,
        path: toPosixRelative(roots.allureReport, roots.root),
        indexFile: allureOverride.indexFile ?? (dirHasHtmlIndex(roots.allureReport) ? toPosixRelative(allureIndex, roots.root) : undefined),
        reason: allureOverride.reason,
        extras: allureOverride.archivedTo ? { archivedTo: allureOverride.archivedTo } : undefined,
      }
    : dirHasHtmlIndex(roots.allureReport)
      ? {
          id: 'allure',
          name: 'Allure report',
          status: 'PRESENT',
          path: toPosixRelative(roots.allureReport, roots.root),
          indexFile: toPosixRelative(allureIndex, roots.root),
        }
      : {
          id: 'allure',
          name: 'Allure report',
          status: 'NOT_EXECUTED',
          path: toPosixRelative(roots.allureReport, roots.root),
          reason: allureResultsPresent(roots.allureResults)
            ? 'Allure raw results exist but HTML has not been generated. Run npm run report:allure.'
            : 'No Allure results under reports/allure/results. Run Playwright with the allure-playwright reporter, then npm run report:allure.',
        };

  return [
    allure,
    playwrightSuites.length > 0
      ? {
          id: 'playwrightHtml',
          name: 'Playwright HTML report',
          status: 'PRESENT',
          path: toPosixRelative(roots.playwright, roots.root),
          indexFile: playwrightSuites.find((row) => row.suite === 'e2e')?.indexFile ?? playwrightSuites[0]?.indexFile,
          extras: { suites: playwrightSuites.map((row) => row.indexFile) },
        }
      : {
          id: 'playwrightHtml',
          name: 'Playwright HTML report',
          status: 'NOT_EXECUTED',
          path: toPosixRelative(roots.playwright, roots.root),
          reason: 'No Playwright HTML index.html under reports/playwright/<suite>/html/.',
        },
    postmanIndex
      ? {
          id: 'postman',
          name: 'Postman report',
          status: 'PRESENT',
          path: toPosixRelative(roots.postman, roots.root),
          indexFile: toPosixRelative(postmanIndex, roots.root),
        }
      : {
          id: 'postman',
          name: 'Postman report',
          status: 'NOT_EXECUTED',
          path: toPosixRelative(roots.postman, roots.root),
          reason: 'No Postman CLI HTML/JSON under reports/postman/. Scores were not invented.',
        },
    jmeterIndex
      ? {
          id: 'jmeter',
          name: 'JMeter report',
          status: 'PRESENT',
          path: toPosixRelative(roots.jmeter, roots.root),
          indexFile: toPosixRelative(jmeterIndex, roots.root),
        }
      : {
          id: 'jmeter',
          name: 'JMeter report',
          status: 'NOT_EXECUTED',
          path: toPosixRelative(roots.jmeter, roots.root),
          reason: 'No JMeter HTML/JTL/summary under reports/jmeter/. Scores were not invented.',
        },
    isExistingFile(finalMd)
      ? {
          id: 'finalCombined',
          name: 'Final combined QA report',
          status: 'PRESENT',
          path: toPosixRelative(roots.summary, roots.root),
          indexFile: toPosixRelative(finalMd, roots.root),
        }
      : {
          id: 'finalCombined',
          name: 'Final combined QA report',
          status: 'NOT_EXECUTED',
          path: toPosixRelative(roots.summary, roots.root),
          reason: 'reports/summary/final-qa-report.md is missing. Run npm run report:final or npm run report:all.',
        },
    {
      id: 'jsonSummary',
      name: 'JSON machine-readable summary',
      status: 'PRESENT',
      path: toPosixRelative(roots.summary, roots.root),
      indexFile: toPosixRelative(indexJson, roots.root),
    },
  ];
}
