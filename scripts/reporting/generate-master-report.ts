import fs from 'fs';
import path from 'path';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess } from '../lib/logger';
import {
  loadExecutionIdentity,
  writeExecutionMetadata,
  MASTER_QA_REPORT_HTML,
  MASTER_QA_REPORT_JSON,
  type ExecutionIdentity,
} from '../lib/qa-report/execution-archive';
import { buildMasterReportModel, type MasterReportModel } from '../lib/qa-report/master-report-model';
import { generateMasterReportHtml } from '../lib/qa-report/master-report-html';

export interface GenerateMasterReportInput {
  identity?: ExecutionIdentity | null;
  folderPath?: string;
  reportsRoot?: string;
  preferHistoryModules?: boolean;
}

export interface GenerateMasterReportResult {
  htmlPath: string;
  jsonPath: string;
  model: MasterReportModel;
}

export function generateMasterQaReport(input: GenerateMasterReportInput = {}): GenerateMasterReportResult {
  const folderIdentity = input.folderPath
    ? readJsonIfExists<ExecutionIdentity>(path.join(input.folderPath, 'execution-identity.json'))
    : null;
  const identity = input.identity ?? folderIdentity ?? loadExecutionIdentity();
  const folderPath = input.folderPath ?? identity?.folderPath;
  if (!folderPath) {
    throw new Error(
      'MASTER-QA-REPORT needs an existing execution folder. Pass --folder= or run after qa:all created the PKT history folder. A new execution id was not invented.'
    );
  }
  fs.mkdirSync(folderPath, { recursive: true });

  const model = buildMasterReportModel({
    identity,
    folderPath,
    reportsRoot: input.reportsRoot ?? PATHS.reports.root,
    preferHistoryModules: input.preferHistoryModules,
  });
  const html = generateMasterReportHtml(model);

  const htmlPath = path.join(folderPath, MASTER_QA_REPORT_HTML);
  const jsonPath = path.join(folderPath, MASTER_QA_REPORT_JSON);
  fs.writeFileSync(htmlPath, html, 'utf8');
  writeJson(jsonPath, model);

  const reportsRoot = path.resolve(input.reportsRoot ?? PATHS.reports.root);
  const isProjectRun =
    reportsRoot === path.resolve(PATHS.reports.root) ||
    path.resolve(folderPath).toLowerCase().startsWith(path.resolve(PATHS.reports.history).toLowerCase());
  if (isProjectRun) {
    const summaryDir = PATHS.reports.summary;
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.copyFileSync(htmlPath, path.join(summaryDir, MASTER_QA_REPORT_HTML));
    fs.copyFileSync(jsonPath, path.join(summaryDir, MASTER_QA_REPORT_JSON));
  }

  if (identity) {
    writeExecutionMetadata(identity, {
      overallStatus: model.overallStatus,
      archivedArtifacts: [
        ...(readArchivedArtifacts(folderPath) ?? []),
        MASTER_QA_REPORT_HTML,
        MASTER_QA_REPORT_JSON,
      ].filter((row, index, all) => all.indexOf(row) === index),
      folderPath,
    });
  }

  return { htmlPath, jsonPath, model };
}

function readArchivedArtifacts(folderPath: string): string[] | null {
  const metadataPath = path.join(folderPath, 'execution-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { archivedArtifacts?: string[] };
    return parsed.archivedArtifacts ?? [];
  } catch {
    return null;
  }
}

function parseFolderArg(argv: string[]): { folderPath?: string; preferHistoryModules: boolean } {
  let folderPath: string | undefined;
  let preferHistoryModules = false;
  for (const arg of argv) {
    if (arg.startsWith('--folder=')) {
      folderPath = path.resolve(arg.slice('--folder='.length));
      preferHistoryModules = true;
    }
    if (arg === '--prefer-history-modules') preferHistoryModules = true;
  }
  return { folderPath, preferHistoryModules };
}

export function main(argv: string[] = process.argv.slice(2)): GenerateMasterReportResult {
  logStep('Generating MASTER-QA-REPORT');
  const parsed = parseFolderArg(argv);
  const result = generateMasterQaReport({
    folderPath: parsed.folderPath,
    preferHistoryModules: parsed.preferHistoryModules,
  });
  logSuccess(`MASTER-QA-REPORT.html: ${result.htmlPath}`);
  logSuccess(`MASTER-QA-REPORT.json: ${result.jsonPath}`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}
