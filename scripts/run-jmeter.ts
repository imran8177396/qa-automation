import { loadConfig } from './lib/load-config';
import { runJmeter } from './runners/jmeter';

runJmeter(loadConfig())
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
