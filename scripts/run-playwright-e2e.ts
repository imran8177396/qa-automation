import { loadConfig } from './lib/load-config';
import { runPlaywright } from './runners/playwright';

runPlaywright(loadConfig())
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
