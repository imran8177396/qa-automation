import { loadConfig } from './lib/load-config';
import { runE2eAndGeneratedCheck } from './runners/playwright';

runE2eAndGeneratedCheck(loadConfig())
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
