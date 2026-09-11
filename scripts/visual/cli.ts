export interface VisualCli {
  updateBaselines: boolean;
  extraArgs: string[];
}

const APPROVE_FLAG = '--approve-baseline-update';

function isUpdateFlag(arg: string): boolean {
  return arg === '-u' || arg === '--update-snapshots' || arg.startsWith('--update-snapshots=');
}

/**
 * Baseline writes require an explicit approve flag. A failed comparison is never
 * treated as permission to replace the committed screenshot.
 */
export function resolveVisualCli(argv: string[]): VisualCli {
  const raw = argv.slice(2);
  const approved = raw.includes(APPROVE_FLAG);
  const askedToUpdate = raw.some((arg) => isUpdateFlag(arg));

  if (askedToUpdate && !approved) {
    throw new Error(
      'Refusing --update-snapshots. A failed screenshot is not accepted as a new baseline. ' +
        'Run `npm run test:visual:update` (or pass --approve-baseline-update) to update baselines deliberately.'
    );
  }

  return {
    updateBaselines: approved,
    extraArgs: raw.filter((arg) => arg !== APPROVE_FLAG && !isUpdateFlag(arg)),
  };
}
