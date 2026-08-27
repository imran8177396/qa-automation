export { buildQaReportText, generateQaReportDocx } from './lib/qa-report/build-report';
export { loadReportFormat, DEFAULT_REPORT_FORMAT_PATH } from './lib/qa-report/format';
export type { ReportFormat, ReportFormatSection } from './lib/qa-report/format';

if (require.main === module) {
  import('./lib/qa-report/build-report.js')
    .then(({ generateQaReportDocx }) => generateQaReportDocx())
    .then(({ txtPath, docxPath, format }) => {
      console.log(`Format:       ${format.id} v${format.version}`);
      console.log(`Text report:  ${txtPath}`);
      console.log(`Word report:  ${docxPath}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
