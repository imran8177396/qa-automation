import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/load-config';
import { PATHS, qaTestResultsStampDirs } from '../lib/paths';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { runCoverage } from '../coverage/run-coverage';
import { analyzeFailures } from '../analyze-failures';
import { COMPLETE_TESTING_NOTE } from '../orchestrator/types';
import { classifySeverity } from './severity';
import { computeFinalVerdict, type FinalVerdict } from './verdict';
import { writeProfessionalSqaReport, type ProfessionalReportPaths } from './write-enterprise-report';
import { renderCanonicalFinalReportMd } from './render-canonical-summary';
import { buildEnterpriseReportModel, type EnterpriseReportModel } from '../lib/qa-report/enterprise-model';
import { assertDiscoveryPrecedesExecution, type StageTimeline } from '../lib/stage-timeline';
import { writeFallbackCombinedReport, writeReportIndex } from './build-report-index';
import { dirHasHtmlIndex, toPosixRelative } from '../lib/report-kinds';

export async function generateFinalQaReport(): Promise<{
  mdPath: string;
  jsonPath: string;
  verdict: FinalVerdict;
  professional: ProfessionalReportPaths | null;
}> {
  const config = loadConfig();
  if (config.report?.enabled === false) {
    throw new Error('Report generation is disabled in qa.config.json.');
  }

  logStep('Generating final QA report');
  const timeline = readJsonIfExists<StageTimeline>(path.join(PATHS.reports.orchestrator, 'timeline.json'));
  if (timeline) {
    const ordering = assertDiscoveryPrecedesExecution(timeline.stages);
    if (!ordering.ok) {
      logError(
        `Discovery completedAt must precede every execution startedAt. ${ordering.violations.join('; ')}`
      );
      throw new Error(
        `Report stage failed: discovery/execution ordering violated. ${ordering.violations.join('; ')}`
      );
    }
  }

  const failures = analyzeFailures();
  const coverage = runCoverage();
  const orchestrator = readJsonIfExists<{
    exitCode?: number;
    failed?: string[];
    passed?: string[];
    skipped?: string[];
    notExecuted?: string[];
  }>(path.join(PATHS.reports.orchestrator, 'summary.json'));

  const releaseBlockers = failures.findings.map((row) =>
    classifySeverity({ classification: row.classification, severity: row.confidence === 'high' ? 'high' : 'medium' })
  );
  const verdict = computeFinalVerdict({ coverage, orchestrator, releaseBlockers });

  let professional: ProfessionalReportPaths | null = null;
  let professionalError: string | undefined;
  let model: EnterpriseReportModel;
  try {
    professional = await writeProfessionalSqaReport();
    model = professional?.model ?? buildEnterpriseReportModel();
  } catch (error) {
    professionalError = error instanceof Error ? error.message : String(error);
    logError(`Professional SQA report could not be written: ${professionalError}`);
    try {
      model = buildEnterpriseReportModel();
    } catch (modelError) {
      const fallbackReason = modelError instanceof Error ? modelError.message : String(modelError);
      writeFallbackCombinedReport(fallbackReason);
      writeReportIndex();
      throw modelError;
    }
  }

  fs.mkdirSync(PATHS.reports.summary, { recursive: true });
  const jsonPath = path.join(PATHS.reports.summary, 'final-qa-report.json');
  const mdPath = path.join(PATHS.reports.summary, 'final-qa-report.md');

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    verdict,
    project: config.project.name,
    coverage: coverage.totals,
    failures: failures.totalFailures,
    releaseBlockers,
    orchestrator,
    completeTestingNote: COMPLETE_TESTING_NOTE,
    professionalReport: professional
      ? {
          timestamp: professional.timestamp,
          overallStatus: professional.overallStatus,
          docxPath: professional.docxPath,
          htmlPath: professional.htmlPath,
          pdfPath: professional.pdfPath,
          txtPath: professional.txtPath,
          latestManifestPath: professional.latestManifestPath,
        }
      : null,
    professionalError: professionalError ?? null,
    allure: {
      resultsDir: toPosixRelative(PATHS.allureResults),
      reportDir: toPosixRelative(PATHS.allureReport),
      indexHtml: dirHasHtmlIndex(PATHS.allureReport)
        ? toPosixRelative(path.join(PATHS.allureReport, 'index.html'))
        : null,
    },
    reportIndex: toPosixRelative(PATHS.reportIndexJson),
    datedFolder: professional
      ? {
          timestamp: professional.timestamp,
          input: path.relative(PATHS.root, qaTestResultsStampDirs(professional.timestamp).input).replace(/\\/g, '/'),
          output: path.relative(PATHS.root, qaTestResultsStampDirs(professional.timestamp).output).replace(/\\/g, '/'),
        }
      : null,
  };
  writeJson(jsonPath, payload);

  const markdown = renderCanonicalFinalReportMd({
    generatedAt,
    verdict,
    projectName: config.project.name,
    coverage,
    failures,
    model,
    professional,
    professionalError,
  });
  fs.writeFileSync(mdPath, markdown, 'utf8');
  writeReportIndex();
  logSuccess(`Final report: ${mdPath} (${verdict})`);
  if (!professional) {
    logWarn('Five-layer Word/HTML/PDF was not produced; canonical markdown still written from artifacts.');
  }
  return { mdPath, jsonPath, verdict, professional };
}

async function main(): Promise<void> {
  const { mdPath, verdict, professional } = await generateFinalQaReport();
  console.log(`Verdict: ${verdict}`);
  console.log(`Report:  ${mdPath}`);
  if (professional) {
    console.log(`Word:    ${professional.docxPath}`);
    if (professional.htmlPath) console.log(`HTML:    ${professional.htmlPath}`);
    if (professional.pdfPath) console.log(`PDF:     ${professional.pdfPath}`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

export type { FinalVerdict };
