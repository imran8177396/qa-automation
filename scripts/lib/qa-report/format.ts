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
  };
  sections: ReportFormatSection[];
}

export const DEFAULT_REPORT_FORMAT_PATH = 'docs/templates/qa-test-results.format.json';

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

export function resolveReportOutputPaths(format: ReportFormat): { txtPath: string; docxPath: string } {
  return {
    txtPath: path.isAbsolute(format.output.txt)
      ? format.output.txt
      : path.join(PATHS.root, format.output.txt),
    docxPath: path.isAbsolute(format.output.docx)
      ? format.output.docx
      : path.join(PATHS.root, format.output.docx),
  };
}
