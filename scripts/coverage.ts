import { printCoverageSummary, runCoverage } from './coverage/run-coverage';

function main(): void {
  const report = runCoverage();
  printCoverageSummary(report);
}

if (require.main === module) {
  main();
}
