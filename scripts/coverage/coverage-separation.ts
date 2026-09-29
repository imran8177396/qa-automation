/**
 * Five separate coverage measurements — never interchangeable.
 *
 * Discovery, test generation, execution, pass rate, and requirement coverage
 * are different numbers. Generating cases must not make discovery, execution,
 * pass rate, or requirement look like 100%. Null means not measured — never
 * substitute 0 or 100 for an unmeasured field.
 *
 * This module does not replace the inventory formula (TESTED+FAILED)/testable.
 */

import { percent } from './status';

export type CoverageMeasureStatus = 'MEASURED' | 'NOT_MEASURED';

export interface CoverageMeasure {
  status: CoverageMeasureStatus;
  /** Null when NOT_MEASURED — never coerce to 0 or 100. */
  percent: number | null;
  reason: string;
}

export interface CoverageSeparation {
  discovery: CoverageMeasure;
  testGeneration: CoverageMeasure;
  execution: CoverageMeasure;
  passRate: CoverageMeasure;
  requirement: CoverageMeasure;
}

export interface CoverageSeparationInput {
  knownScreenCount?: number | null;
  discoveredScreenCount?: number | null;
  testableElementCount?: number | null;
  testableElementsWithCase?: number | null;
  generatedCaseCount?: number | null;
  executedCaseCount?: number | null;
  passedCaseCount?: number | null;
  requirementCount?: number | null;
  requirementsCovered?: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function measure(
  status: CoverageMeasureStatus,
  pct: number | null,
  reason: string
): CoverageMeasure {
  return { status, percent: pct, reason };
}

const NO_INDEPENDENT_CENSUS_REASON =
  'no independent screen census; discovered screens are not 100% of the application';
const NO_TESTABLE_ELEMENTS_REASON = 'no testable elements';
const NO_GENERATED_CASES_REASON = 'no generated cases to execute';
const PASS_RATE_UNDEFINED_REASON = 'pass rate is undefined until a case is executed';
const NO_REQUIREMENTS_REASON = 'no requirements were supplied';

function buildDiscovery(input: CoverageSeparationInput): CoverageMeasure {
  const known = input.knownScreenCount;
  const discovered = input.discoveredScreenCount;

  if (!isFiniteNumber(known) || known <= 0) {
    return measure('NOT_MEASURED', null, NO_INDEPENDENT_CENSUS_REASON);
  }

  if (!isFiniteNumber(discovered) || discovered < 0) {
    return measure('NOT_MEASURED', null, NO_INDEPENDENT_CENSUS_REASON);
  }

  if (discovered > known) {
    return measure(
      'NOT_MEASURED',
      null,
      'discovered count exceeds the known screen count'
    );
  }

  return measure(
    'MEASURED',
    percent(discovered, known),
    'discovered screens as a share of an independent known screen census'
  );
}

function buildTestGeneration(input: CoverageSeparationInput): CoverageMeasure {
  const testable = input.testableElementCount;
  const withCase = input.testableElementsWithCase;

  if (!isFiniteNumber(testable) || testable <= 0) {
    return measure('NOT_MEASURED', null, NO_TESTABLE_ELEMENTS_REASON);
  }

  if (!isFiniteNumber(withCase) || withCase < 0) {
    return measure('NOT_MEASURED', null, NO_TESTABLE_ELEMENTS_REASON);
  }

  // 100 is allowed only when every testable element has a case.
  const pct =
    withCase === testable ? 100 : percent(withCase, testable);

  return measure(
    'MEASURED',
    pct,
    'share of testable elements that have at least one generated case'
  );
}

function buildExecution(input: CoverageSeparationInput): CoverageMeasure {
  const generated = input.generatedCaseCount;
  const executed = input.executedCaseCount;

  if (!isFiniteNumber(generated) || generated <= 0) {
    return measure('NOT_MEASURED', null, NO_GENERATED_CASES_REASON);
  }

  if (!isFiniteNumber(executed) || executed < 0) {
    return measure('NOT_MEASURED', null, NO_GENERATED_CASES_REASON);
  }

  if (executed === 0) {
    return measure('MEASURED', 0, 'no generated case has been executed');
  }

  return measure(
    'MEASURED',
    percent(executed, generated),
    'share of generated cases that have been executed'
  );
}

function buildPassRate(input: CoverageSeparationInput): CoverageMeasure {
  const executed = input.executedCaseCount;
  const passed = input.passedCaseCount;

  if (!isFiniteNumber(executed) || executed <= 0) {
    return measure('NOT_MEASURED', null, PASS_RATE_UNDEFINED_REASON);
  }

  if (!isFiniteNumber(passed) || passed < 0 || passed > executed) {
    return measure('NOT_MEASURED', null, PASS_RATE_UNDEFINED_REASON);
  }

  return measure(
    'MEASURED',
    percent(passed, executed),
    'passed executions ÷ executed executions — not coverage'
  );
}

function buildRequirement(input: CoverageSeparationInput): CoverageMeasure {
  const requirements = input.requirementCount;
  const covered = input.requirementsCovered;

  if (!isFiniteNumber(requirements) || requirements <= 0) {
    return measure('NOT_MEASURED', null, NO_REQUIREMENTS_REASON);
  }

  if (!isFiniteNumber(covered) || covered < 0) {
    return measure('NOT_MEASURED', null, NO_REQUIREMENTS_REASON);
  }

  return measure(
    'MEASURED',
    percent(covered, requirements),
    'share of supplied requirements that are covered'
  );
}

/**
 * Build the five separate measurements. Generating cases alone never fills
 * discovery, execution, pass rate, or requirement with 100%.
 */
export function buildCoverageSeparation(input: CoverageSeparationInput): CoverageSeparation {
  return {
    discovery: buildDiscovery(input),
    testGeneration: buildTestGeneration(input),
    execution: buildExecution(input),
    passRate: buildPassRate(input),
    requirement: buildRequirement(input),
  };
}

const FIELD_LABELS: { key: keyof CoverageSeparation; label: string }[] = [
  { key: 'discovery', label: 'Discovery Coverage' },
  { key: 'testGeneration', label: 'Test Generation Coverage' },
  { key: 'execution', label: 'Execution Coverage' },
  { key: 'passRate', label: 'Pass Rate' },
  { key: 'requirement', label: 'Requirement Coverage' },
];

/**
 * Five labeled lines. Unmeasured prints NOT_MEASURED (never a fake 100%).
 */
export function renderCoverageSeparation(report: CoverageSeparation): string {
  const lines: string[] = [];
  for (const { key, label } of FIELD_LABELS) {
    const m = report[key];
    if (m.status === 'NOT_MEASURED' || m.percent == null) {
      lines.push(`${label}: NOT_MEASURED (${m.reason})`);
    } else {
      lines.push(`${label}: ${m.percent}% (${m.reason})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Guard: generation coverage must not be relabeled as discovery, execution,
 * pass rate, or requirement. Unmeasured fields must keep null percent.
 * Throws when another MEASURED field copies testGeneration's percent with a
 * generation/copied reason (or discovery claims the same percent without a
 * known-screen census).
 */
export function assertNotGenerationEqualsCoverage(report: CoverageSeparation): void {
  for (const key of ['discovery', 'execution', 'passRate', 'requirement'] as const) {
    const other = report[key];
    if (other.status === 'NOT_MEASURED' && other.percent != null) {
      throw new Error(
        `${key}: NOT_MEASURED must use null percent (got ${other.percent}); generation is not ${key} coverage`
      );
    }
  }

  const gen = report.testGeneration;
  if (gen.status !== 'MEASURED' || gen.percent == null) {
    return;
  }

  for (const key of ['discovery', 'execution', 'passRate', 'requirement'] as const) {
    const other = report[key];
    if (other.status !== 'MEASURED' || other.percent !== gen.percent || other.reason === gen.reason) {
      continue;
    }
    const looksCopied = /copied|from generation|testGeneration/i.test(other.reason);
    const discoveryWithoutCensus =
      key === 'discovery' && !/independent known screen census/.test(other.reason);
    if (looksCopied || discoveryWithoutCensus) {
      throw new Error(
        `${key} must not reuse testGeneration percent (${gen.percent}); generation is not ${key} coverage`
      );
    }
  }
}
