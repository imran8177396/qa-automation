import { cleanRunArtifacts } from './lib/clean-run-artifacts';
import { logStep, logSuccess } from './lib/logger';

function main(): void {
  logStep('Cleaning previous test artifacts and cache');
  const { removed } = cleanRunArtifacts();
  if (removed.length === 0) {
    logSuccess('No previous run artifacts were present');
    return;
  }
  logSuccess(`Removed ${removed.length} artifact path(s)`);
  for (const entry of removed) {
    console.log(`  - ${entry}`);
  }
}

if (require.main === module) {
  main();
}
