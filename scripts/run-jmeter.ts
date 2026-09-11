import { loadConfig } from './lib/load-config';
import { resolvePerformanceCli } from './performance/cli';
import { runJmeter } from './runners/jmeter';

const cli = resolvePerformanceCli();

runJmeter(loadConfig(), cli)
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
