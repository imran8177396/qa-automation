/**
 * File/suite mutation stays refused — does not rewrite tests or re-run suites.
 * In-memory snippet mutants live in scripts/testing/mutation (PARTIAL).
 */

export interface MutationPlan {
  status: 'NOT_IMPLEMENTED';
  reason: string;
}

const REASON =
  'mutation testing is not implemented; tests are not rewritten and the suite is not re-run';

/** Refuse rewriting project tests / re-running the suite against mutated sources. */
export function planMutation(): MutationPlan {
  return { status: 'NOT_IMPLEMENTED', reason: REASON };
}

export {
  mutateSnippet,
  planFileMutation,
  runMutationChecks,
  type MutationCase,
  type MutationReport,
  type FileMutationPlan,
  type RunMutationChecksInput,
} from '../mutation';
