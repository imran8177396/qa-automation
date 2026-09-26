/**
 * Optional in-memory mutation checks.
 * Mutates caller-supplied snippets only — never rewrites project files or re-runs the suite.
 */

export interface MutationCase {
  id: string;
  /** Original snippet. Not a file path. Never written to disk. */
  original: string;
  /** Controlled mutant of that snippet, supplied by the caller or by mutateSnippet. */
  mutant: string;
  /**
   * True when the tests detected the mutant (killed).
   * False when they did not (survived).
   * Omit when detection was not run.
   */
  detected?: boolean;
}

export interface MutationReport {
  generated: number;
  killed: number;
  survived: number;
  /** killed / generated * 100 when generated > 0 and every case has detected set. Otherwise null. Never 100 by default. */
  score: number | null;
  status: 'PASS' | 'FAIL' | 'NOT_TESTED' | 'BLOCKED' | 'NOT_APPLICABLE';
  reason: string;
  cases: MutationCase[];
}

export interface FileMutationPlan {
  status: 'NOT_IMPLEMENTED' | 'BLOCKED';
  reason: string;
}

const FILE_MUTATION_REASON = 'mutation of project files is not implemented';

const SUITE_NOT_EXECUTED =
  'caller-supplied detection; the project test suite was not executed';

/**
 * Apply one controlled in-memory edit. Never writes files. Never uses eval.
 */
export function mutateSnippet(
  original: string
): { mutant: string } | { status: 'NOT_TESTED'; reason: string } {
  if (original.includes(' + ')) {
    const mutant = original.replace(' + ', ' - ');
    if (mutant !== original) {
      return { mutant };
    }
  }
  if (original.includes(' === ')) {
    const mutant = original.replace(' === ', ' !== ');
    if (mutant !== original) {
      return { mutant };
    }
  }
  return {
    status: 'NOT_TESTED',
    reason: 'no controlled mutation pattern in snippet',
  };
}

/**
 * File mutation stays refused — project sources are never rewritten.
 */
export function planFileMutation(): FileMutationPlan {
  return { status: 'NOT_IMPLEMENTED', reason: FILE_MUTATION_REASON };
}

export interface RunMutationChecksInput {
  enabled: boolean;
  cases?: MutationCase[];
  /** When true, refuse — suite re-run for mutation is not implemented. */
  runSuite?: boolean;
}

/**
 * Classify caller-supplied in-memory mutants and optional detection flags.
 * Does not spawn npm test, write files, or invent a default score of 100.
 */
export function runMutationChecks(input: RunMutationChecksInput): MutationReport {
  if (input.enabled !== true) {
    return {
      generated: 0,
      killed: 0,
      survived: 0,
      score: null,
      status: 'NOT_APPLICABLE',
      reason: 'mutation testing is not enabled for this application',
      cases: [
        {
          id: 'mutation:not-enabled',
          original: '',
          mutant: '',
        },
      ],
    };
  }

  if (input.runSuite === true) {
    return {
      generated: 0,
      killed: 0,
      survived: 0,
      score: null,
      status: 'BLOCKED',
      reason: 'running the project test suite for mutation is not implemented',
      cases: input.cases ?? [],
    };
  }

  const cases = input.cases ?? [];
  if (cases.length === 0) {
    return {
      generated: 0,
      killed: 0,
      survived: 0,
      score: null,
      status: 'NOT_TESTED',
      reason: 'no mutations were supplied',
      cases: [],
    };
  }

  const generated = cases.length;
  const killed = cases.filter((c) => c.detected === true).length;
  const survived = cases.filter((c) => c.detected === false).length;
  const everyDetected = cases.every((c) => typeof c.detected === 'boolean');

  if (!everyDetected) {
    return {
      generated,
      killed,
      survived,
      score: null,
      status: 'NOT_TESTED',
      reason: 'detection was not run for every mutation',
      cases,
    };
  }

  const score = (killed / generated) * 100;
  if (survived > 0) {
    return {
      generated,
      killed,
      survived,
      score,
      status: 'FAIL',
      reason: `mutations survived; ${SUITE_NOT_EXECUTED}`,
      cases,
    };
  }

  return {
    generated,
    killed,
    survived,
    score,
    status: 'PASS',
    reason: `all mutations were killed; ${SUITE_NOT_EXECUTED}`,
    cases,
  };
}
