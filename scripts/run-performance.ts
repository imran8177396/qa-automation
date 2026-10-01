import { loadConfig } from './lib/load-config';
import { resolvePerformanceCli } from './performance/cli';
import { writePerformanceStageSummary } from './performance/write-stage-summary';
import { runUiPerformance } from './performance/run-ui';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';

const cli = resolvePerformanceCli();
const config = loadConfig();

async function main(): Promise<void> {
  const uiOk = await runUiPerformance(config);
  const jmeterOk = await runJmeter(config, cli);
  const lighthouseOk = await runLighthouse(config);
  writePerformanceStageSummary({
    command: 'npm run test:performance',
    authorizeHeavy: cli.authorizeHeavy,
    profile: cli.profile,
  });
  process.exit(uiOk && jmeterOk && lighthouseOk ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
