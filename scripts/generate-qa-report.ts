export { buildQaReportText, generateQaReportDocx } from './lib/qa-report/build-report';
export { loadReportFormat, DEFAULT_REPORT_FORMAT_PATH } from './lib/qa-report/format';
export type { ReportFormat, ReportFormatSection } from './lib/qa-report/format';
export { buildEnterpriseReportModel } from './lib/qa-report/enterprise-model';

if (require.main === module) {
  import('./lib/qa-report/build-report.js')
    .then(({ generateQaReportDocx }) => generateQaReportDocx())
    .then(({ timestamp, txtPath, docxPath, htmlPath, pdfPath, latestManifestPath, format, model }) => {
      console.log(`Format:       ${format.id} v${format.version}`);
      console.log(`Timestamp:    ${timestamp}`);
      console.log(`QA Status:    ${model.meta.overallStatus}`);
      console.log(`Text report:  ${txtPath}`);
      console.log(`Word report:  ${docxPath}`);
      if (htmlPath) {
        console.log(`HTML report:  ${htmlPath}`);
      }
      if (pdfPath) {
        console.log(`PDF report:   ${pdfPath}`);
      }
      if (latestManifestPath) {
        console.log(`Latest index: ${latestManifestPath}`);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
