/**
 * Optional CLI entry for capability helpers.
 * Prefer calling exported functions from tests; npm scripts may point here later.
 *
 * Usage: npx tsx scripts/testing/capabilities/run-capabilities.ts --only=<id>
 * Does not hit network, live hosts, or mutate application data.
 */

import {
  TESTING_CAPABILITIES,
  getCapability,
  generateFuzzInputs,
  planMutation,
  planRace,
  runRaceChecks,
  planBackupRestore,
  runBackupRestoreChecks,
  planPrivacyRetention,
  runPrivacyChecks,
  classifyQueueMessage,
} from './index';

function parseOnly(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith('--only='));
  return flag ? flag.slice('--only='.length).trim() : undefined;
}

function main(): void {
  const only = parseOnly(process.argv.slice(2));
  const caps = only
    ? TESTING_CAPABILITIES.filter((c) => c.id === only)
    : [...TESTING_CAPABILITIES];

  if (only && caps.length === 0) {
    console.error(`Unknown capability id: ${only}`);
    process.exitCode = 1;
    return;
  }

  for (const cap of caps) {
    const row = { id: cap.id, status: cap.status, limitation: cap.limitation };
    switch (cap.id) {
      case 'fuzz':
        console.log(JSON.stringify({ ...row, sampleCount: generateFuzzInputs().length }));
        break;
      case 'mutation':
        console.log(JSON.stringify({ ...row, plan: planMutation() }));
        break;
      case 'race':
        console.log(
          JSON.stringify({
            ...row,
            plan: planRace(),
            disabled: runRaceChecks({ enabled: false }).map((r) => ({
              id: r.id,
              status: r.status,
            })),
          })
        );
        break;
      case 'backup-restore':
        console.log(
          JSON.stringify({
            ...row,
            plan: planBackupRestore(),
            disabled: runBackupRestoreChecks({ enabled: false }).map((r) => ({
              id: r.id,
              status: r.status,
            })),
          })
        );
        break;
      case 'privacy':
        console.log(
          JSON.stringify({
            ...row,
            retention: planPrivacyRetention(),
            disabled: runPrivacyChecks({ enabled: false }).map((r) => ({
              id: r.id,
              status: r.status,
            })),
          })
        );
        break;
      case 'queue':
        console.log(
          JSON.stringify({
            ...row,
            example: classifyQueueMessage({ failed: true, duplicate: true }),
          })
        );
        break;
      default:
        console.log(JSON.stringify({ ...row, capability: getCapability(cap.id) }));
        break;
    }
  }
}

if (require.main === module) {
  main();
}
