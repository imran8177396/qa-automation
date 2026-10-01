import { loadConfig } from './lib/load-config';
import { resolvePerformanceCli } from './performance/cli';
import { writePerformanceStageSummary } from './performance/write-stage-summary';
import { runJmeter } from './runners/jmeter';

const cli = resolvePerformanceCli();

runJmeter(loadConfig(), cli)
  .then((passed) => {
    writePerformanceStageSummary({
      command: 'tsx scripts/run-jmeter.ts',
      authorizeHeavy: cli.authorizeHeavy,
      profile: cli.profile,
    });
    process.exit(passed ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
