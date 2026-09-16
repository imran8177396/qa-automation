import fs from 'fs';
import { loadConfig } from './lib/load-config';
import { readJsonIfExists, writeJson } from './discovery/write-json';
import { PATHS } from './lib/paths';
import { resolvePerformanceCli } from './performance/cli';
import { HEAVY_PERFORMANCE_PROFILES } from './performance/plans';
import { runUiPerformance } from './performance/run-ui';
import type { PerformanceStageSummary, PerformanceSummary, UiPerformanceSummary } from './performance/types';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';
import type { LighthouseSummary } from './lighthouse/types';

const cli = resolvePerformanceCli();
const config = loadConfig();

function writeStageSummary(): void {
  const ui = readJsonIfExists<UiPerformanceSummary>(PATHS.uiPerformanceSummary);
  const jmeter = readJsonIfExists<PerformanceSummary>(PATHS.jmeterSummary);
  const lighthouse = readJsonIfExists<LighthouseSummary>(PATHS.lighthouseSummary);
  const stage: PerformanceStageSummary = {
    ranAt: new Date().toISOString(),
    command: 'npm run test:performance',
    authorizeHeavy: cli.authorizeHeavy,
    profile: cli.profile,
    heavyProfiles: [...HEAVY_PERFORMANCE_PROFILES],
    ui: {
      status: ui?.status ?? 'NOT_EXECUTED',
      artifact: 'reports/performance/summary.json',
    },
    jmeter: {
      status: jmeter?.status ?? 'NOT_EXECUTED',
      profile: jmeter?.profile ?? cli.profile,
      heavy: Boolean(jmeter?.heavy),
      artifact: 'reports/jmeter/summary.json',
    },
    lighthouse: {
      status: lighthouse?.status ?? 'NOT_EXECUTED',
      artifact: 'reports/lighthouse/summary.json',
    },
  };
  fs.mkdirSync(PATHS.reports.performance, { recursive: true });
  writeJson(PATHS.performanceStageSummary, stage);
}

async function main(): Promise<void> {
  const uiOk = await runUiPerformance(config);
  const jmeterOk = await runJmeter(config, cli);
  const lighthouseOk = await runLighthouse(config);
  writeStageSummary();
  process.exit(uiOk && jmeterOk && lighthouseOk ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
