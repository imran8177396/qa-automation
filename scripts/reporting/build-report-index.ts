import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import {
  type AllureStatusOverride,
  type ReportKindRecord,
  defaultReportKindRoots,
  inspectReportKinds,
} from '../lib/report-kinds';

export interface ReportIndexDocument {
  generatedAt: string;
  project: string;
  note: string;
  kinds: ReportKindRecord[];
}

export function buildReportIndexDocument(allureOverride?: AllureStatusOverride): ReportIndexDocument {
  const config = loadConfig();
  return {
    generatedAt: new Date().toISOString(),
    project: config.project.name,
    note: 'Statuses reflect files on disk only. Missing tool reports are NOT_EXECUTED. Failures are not converted to PASS. Coverage is not invented.',
    kinds: inspectReportKinds(defaultReportKindRoots(), allureOverride),
  };
}

export function renderRawIndexMarkdown(document: ReportIndexDocument): string {
  const lines = [
    '# Raw report index',
    '',
    `Generated: ${document.generatedAt}`,
    `Project: ${document.project}`,
    '',
    document.note,
    '',
    '| Kind | Status | Path | Index | Reason |',
    '| --- | --- | --- | --- | --- |',
    ...document.kinds.map((row) => {
      const extras = row.extras?.suites;
      const extraNote = Array.isArray(extras) ? extras.join(', ') : row.indexFile ?? '';
      return `| ${row.name} | ${row.status} | ${row.path} | ${extraNote} | ${row.reason ?? ''} |`;
    }),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function writeReportIndex(allureOverride?: AllureStatusOverride): ReportIndexDocument {
  const document = buildReportIndexDocument(allureOverride);
  writeJson(PATHS.reportIndexJson, document);
  fs.mkdirSync(PATHS.reports.summary, { recursive: true });
  fs.writeFileSync(PATHS.reportRawIndexMd, renderRawIndexMarkdown(document), 'utf8');
  return document;
}

export function renderFallbackCombinedMarkdown(input: {
  generatedAt: string;
  projectName: string;
  professionalError: string;
}): string {
  return [
    '# Final QA Report',
    '',
    '**Verdict:** BLOCKED',
    `**Generated:** ${input.generatedAt}`,
    `**Project:** ${input.projectName}`,
    '',
    'Professional five-layer Word/HTML/PDF was not written from the current `reports/` artifacts.',
    '',
    `Reason: ${input.professionalError}`,
    '',
    'Statuses, coverage, and counts are not invented here. See `reports/summary/report-index.json` for which tool reports exist on disk. Failures remain FAIL.',
    '',
  ].join('\n');
}

/**
 * Canonical combined files when the five-layer Word/HTML/PDF pack cannot be built.
 * Does not invent coverage or convert FAILs to PASS.
 */
export function writeFallbackCombinedReport(professionalError: string): {
  mdPath: string;
  jsonPath: string;
} {
  const generatedAt = new Date().toISOString();
  const config = loadConfig();
  const jsonPath = path.join(PATHS.reports.summary, 'final-qa-report.json');
  const mdPath = path.join(PATHS.reports.summary, 'final-qa-report.md');
  const payload = {
    generatedAt,
    verdict: 'BLOCKED',
    project: config.project.name,
    professionalReport: null,
    professionalError,
    note: 'Five-layer Word/HTML/PDF was not written. This file indexes existing reports/ artifacts only. Failures are not converted to PASS. Coverage is not invented.',
    reportIndex: path.relative(PATHS.root, PATHS.reportIndexJson).replace(/\\/g, '/'),
  };
  writeJson(jsonPath, payload);
  fs.mkdirSync(PATHS.reports.summary, { recursive: true });
  fs.writeFileSync(mdPath, renderFallbackCombinedMarkdown({
    generatedAt,
    projectName: config.project.name,
    professionalError,
  }), 'utf8');
  return { mdPath, jsonPath };
}
