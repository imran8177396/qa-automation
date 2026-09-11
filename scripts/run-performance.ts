import { loadConfig } from './lib/load-config';
import { resolvePerformanceCli } from './performance/cli';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';

const cli = resolvePerformanceCli();
const config = loadConfig();

async function main(): Promise<void> {
  const jmeterOk = await runJmeter(config, cli);
  const lighthouseOk = await runLighthouse(config);
  process.exit(jmeterOk && lighthouseOk ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
