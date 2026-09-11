import { loadConfig } from '../lib/load-config';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import path from 'path';
import type { EnterpriseReportModel } from '../lib/qa-report/enterprise-model';
import { reportQualityWarnings } from '../lib/qa-report/quality-checks';

export interface ProfessionalReportPaths {
  timestamp: string;
  overallStatus: string;
  docxPath: string;
  htmlPath?: string;
  pdfPath?: string;
  txtPath: string;
  latestManifestPath?: string;
  model: EnterpriseReportModel;
}

/**
 * Five-layer SQA execution report (Word / HTML / PDF).
 * Uses existing execution artifacts only — never invents results.
 * Tautological-assertion quality FAILs are recorded as warnings and do not abort.
 */
export async function writeProfessionalSqaReport(): Promise<ProfessionalReportPaths | null> {
  const config = loadConfig();
  if (config.report?.enabled === false) {
    logWarn('Professional SQA report skipped (report.enabled is false).');
    return null;
  }

  logStep('Professional SQA report (five-layer Word / HTML / PDF)');
  try {
    const { generateQaReportDocx } = await import('../lib/qa-report/build-report.js');
    const result = await generateQaReportDocx();
    const warnings = reportQualityWarnings(result.model.qualityCheckRecords);
    for (const warning of warnings) {
      logWarn(`Report-quality warning (${warning.id}): ${warning.detail}`);
    }

    const paths: ProfessionalReportPaths = {
      timestamp: result.timestamp,
      overallStatus: result.model.meta.overallStatus,
      docxPath: result.docxPath,
      htmlPath: result.htmlPath,
      pdfPath: result.pdfPath,
      txtPath: result.txtPath,
      latestManifestPath: result.latestManifestPath,
      model: result.model,
    };

    const { model: _model, ...manifest } = paths;
    writeJson(path.join(PATHS.reports.summary, 'professional-report.json'), {
      generatedAt: new Date().toISOString(),
      ...manifest,
    });

    logSuccess(`Enterprise QA report (${paths.timestamp}) — status ${paths.overallStatus}`);
    logSuccess(`Word: ${paths.docxPath}`);
    if (paths.htmlPath) logSuccess(`HTML: ${paths.htmlPath}`);
    if (paths.pdfPath) logSuccess(`PDF:  ${paths.pdfPath}`);
    return paths;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (
      name === 'DanglingSectionReferenceError' ||
      name === 'QualityCheckFailure' ||
      name === 'EmptyTableError'
    ) {
      throw error;
    }
    logWarn(`Could not generate professional SQA report: ${String(error)}`);
    return null;
  }
}
