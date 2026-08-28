import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';

export interface ReportFormatSection {
  id: string;
  heading: string;
  enabled: boolean;
}

export interface ReportFormat {
  id: string;
  version: string;
  description: string;
  meta: {
    titleSuffix: string;
    author: string;
  };
  output: {
    txt: string;
    docx: string;
    html?: string;
    pdf?: string;
    latestManifest?: string;
  };
  sections: ReportFormatSection[];
}

export interface ReportOutputPaths {
  timestamp: string;
  txtPath: string;
  docxPath: string;
  htmlPath?: string;
  pdfPath?: string;
  latestManifestPath?: string;
}

export const DEFAULT_REPORT_FORMAT_PATH = 'docs/templates/qa-test-results.format.json';
export const REPORT_TIMESTAMP_TOKEN = '{timestamp}';

export function loadReportFormat(formatPath?: string): ReportFormat {
  const config = loadConfig();
  const relativePath = formatPath ?? config.report?.format ?? DEFAULT_REPORT_FORMAT_PATH;
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(PATHS.root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Report format template not found: ${absolutePath}`);
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as ReportFormat;
}

/** Filesystem-safe, sortable timestamp folder/file prefix: 2026-08-27_17-39-46 */
export function formatReportTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join('_');
}

function resolveOutputTarget(target: string, timestamp: string): string {
  const relativePath = target.replaceAll(REPORT_TIMESTAMP_TOKEN, timestamp);
  return path.isAbsolute(relativePath) ? relativePath : path.join(PATHS.root, relativePath);
}

export function resolveReportOutputPaths(format: ReportFormat, ranAt: string): ReportOutputPaths {
  const timestamp = formatReportTimestamp(ranAt);

  return {
    timestamp,
    txtPath: resolveOutputTarget(format.output.txt, timestamp),
    docxPath: resolveOutputTarget(format.output.docx, timestamp),
    htmlPath: format.output.html
      ? resolveOutputTarget(format.output.html, timestamp)
      : undefined,
    pdfPath: format.output.pdf
      ? resolveOutputTarget(format.output.pdf, timestamp)
      : undefined,
    latestManifestPath: format.output.latestManifest
      ? resolveOutputTarget(format.output.latestManifest, timestamp)
      : undefined,
  };
}

export function writeLatestReportManifest(
  format: ReportFormat,
  ranAt: string,
  outputPaths: ReportOutputPaths
): string | undefined {
  const manifestTemplate = format.output.latestManifest;
  if (!manifestTemplate) {
    return undefined;
  }

  const manifestPath = resolveOutputTarget(manifestTemplate, outputPaths.timestamp);
  const toRelative = (target: string) => path.relative(PATHS.root, target).replace(/\\/g, '/');

  const manifest = {
    timestamp: outputPaths.timestamp,
    ranAt,
    txt: toRelative(outputPaths.txtPath),
    docx: toRelative(outputPaths.docxPath),
    html: outputPaths.htmlPath ? toRelative(outputPaths.htmlPath) : undefined,
    pdf: outputPaths.pdfPath ? toRelative(outputPaths.pdfPath) : undefined,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return manifestPath;
}
