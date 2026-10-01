import { blockingQualityFailures, readQualityChecksArtifact, type QualityCheck } from '../lib/qa-report/quality-checks';
import { PATHS } from '../lib/paths';
import {
  formatSuiteRollupBanner,
  resolveOverallStatus,
  type OverallRollupStatus,
  type SuiteRollup,
  type SuiteRollupLine,
  type SuiteRollupStatus,
} from './suite-rollup';

/** Quality gate OVERALL — never WARNING. Never PASS while a11y/security/SEO FAILed. */
export type QualityGateStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export interface QualityGateReason {
  code: string;
  detail: string;
}

export interface QualityGateResult {
  status: QualityGateStatus;
  reasons: QualityGateReason[];
  requiredSuites: Array<{ label: string; status: string; detail?: string; percent?: number }>;
  qualityChecks: {
    available: boolean;
    source: string;
    blockingFailures: Array<{ id: string; detail: string }>;
  };
}

const PRODUCT_FAIL_LABELS = new Set(['ACCESSIBILITY', 'SECURITY', 'SEO']);

const FAILED = new Set(['FAIL', 'PARTIAL', 'INVALID', 'ERROR']);

function isRequiredLine(line: SuiteRollupLine): boolean {
  return line.label !== 'OVERALL';
}

function isJmeterSatisfied(line: SuiteRollupLine): boolean {
  return line.label === 'JMETER' && line.status === 'RECORDED';
}

function isCoverageSatisfied(line: SuiteRollupLine): boolean {
  return line.label === 'COVERAGE' && typeof line.percent === 'number' && line.status !== 'FAIL';
}

export function collectQualityGateReasons(required: SuiteRollupLine[]): QualityGateReason[] {
  const reasons: QualityGateReason[] = [];

  for (const line of required.filter(isRequiredLine)) {
    if (FAILED.has(line.status)) {
      reasons.push({
        code: PRODUCT_FAIL_LABELS.has(line.label) ? 'required-product-fail' : 'required-suite-fail',
        detail: `${line.label} is ${line.status}${line.detail ? ` (${line.detail})` : ''}`,
      });
      continue;
    }
    if (line.status === 'WARNING') {
      reasons.push({
        code: 'required-suite-warning',
        detail: `${line.label} is WARNING — quality gate does not treat this as PASS`,
      });
      continue;
    }
    if (isJmeterSatisfied(line) || isCoverageSatisfied(line)) continue;
    if (
      line.status === 'BLOCKED' ||
      line.status === 'NOT_EXECUTED' ||
      line.status === 'REQUIRES_CONFIGURATION'
    ) {
      reasons.push({
        code:
          line.status === 'REQUIRES_CONFIGURATION'
            ? 'required-suite-requires-configuration'
            : line.status === 'BLOCKED'
              ? 'required-suite-blocked'
              : 'required-suite-not-executed',
        detail: `${line.label} is ${line.status}${line.detail ? ` (${line.detail})` : ''}`,
      });
    }
  }

  return reasons;
}

export function determineQualityGate(input: {
  required: SuiteRollupLine[];
  qualityChecks?: QualityCheck[] | null;
}): QualityGateResult {
  const required = input.required.filter(isRequiredLine);
  const reasons = collectQualityGateReasons(required);
  let status: QualityGateStatus = resolveOverallStatus(required);

  const checks = input.qualityChecks ?? null;
  const blocking = checks ? blockingQualityFailures(checks) : [];
  if (blocking.length > 0) {
    status = 'FAIL';
    for (const check of blocking) {
      reasons.push({
        code: 'quality-check-fail',
        detail: `${check.id}: ${check.detail}`,
      });
    }
  }

  if (checks === null) {
    reasons.push({
      code: 'quality-checks-unavailable',
      detail:
        'reports/quality/quality-checks.json was not available; report quality-checks were not invented as PASS or FAIL',
    });
  }

  return {
    status,
    reasons,
    requiredSuites: required.map((line) => ({
      label: line.label,
      status: line.status,
      detail: line.detail,
      percent: line.percent,
    })),
    qualityChecks: {
      available: checks !== null,
      source: 'reports/quality/quality-checks.json',
      blockingFailures: blocking.map((row) => ({ id: row.id, detail: row.detail })),
    },
  };
}

export function loadQualityChecksForGate(): QualityCheck[] | null {
  return readQualityChecksArtifact();
}

export function applyQualityGateToRollup(rollup: SuiteRollup, gate: QualityGateResult): SuiteRollup {
  const overall = gate.status as OverallRollupStatus;
  const lines: SuiteRollupLine[] = rollup.lines.map((line) =>
    line.label === 'OVERALL' ? { ...line, status: overall as SuiteRollupStatus } : line
  );
  const notes = [
    ...rollup.notes,
    ...gate.reasons.map((reason) => `Quality gate ${reason.code}: ${reason.detail}`),
  ];
  return {
    ...rollup,
    lines,
    overall,
    notes,
    banner: formatSuiteRollupBanner(lines, notes),
  };
}

export function formatQualityGateBanner(gate: QualityGateResult): string {
  const reasonLines =
    gate.reasons.length > 0
      ? gate.reasons.map((reason) => `  - ${reason.code}: ${reason.detail}`)
      : ['  (no blocking reasons)'];
  return [
    '',
    '============================================================',
    'QUALITY GATE',
    '============================================================',
    `Status:  ${gate.status}`,
    'Reasons:',
    ...reasonLines,
    `Quality-checks artifact: ${gate.qualityChecks.available ? 'present' : 'unavailable'} (${gate.qualityChecks.source})`,
    '============================================================',
  ].join('\n');
}

export function qualityGateArtifactPath(): string {
  return PATHS.orchestratorQualityGate;
}

/** Optional release-gate thresholds. Default does not block. */
export interface ReleaseGateConfig {
  /** When false or omitted → never block. Default must not block. */
  blockRelease?: boolean;
  maxCriticalFailures?: number;
  minCoveragePct?: number;
  maxPerformanceP95Ms?: number;
  maxSecurityHigh?: number;
}

export interface ReleaseGateInput {
  criticalFailures?: number;
  coveragePct?: number;
  performanceP95Ms?: number;
  securityHigh?: number;
}

export interface ReleaseGateResult {
  block: boolean;
  reasons: string[];
}

/**
 * Evaluate optional release thresholds.
 * - `blockRelease` false/omitted → `{ block: false, reasons: [] }` even if numbers look bad.
 * - When true, block only for thresholds that are set and violated.
 * - Missing metrics are not treated as zero or 100; a missing coverage pct adds
 *   "coverage not measured" and blocks only because blockRelease is true AND the rule was configured.
 * Never flips a FAIL to PASS.
 */
export function evaluateReleaseGate(
  input: ReleaseGateInput,
  config: ReleaseGateConfig = {}
): ReleaseGateResult {
  if (config.blockRelease !== true) {
    return { block: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (config.maxCriticalFailures !== undefined) {
    if (input.criticalFailures === undefined) {
      reasons.push('critical failures not measured');
    } else if (input.criticalFailures > config.maxCriticalFailures) {
      reasons.push(
        `critical failures ${input.criticalFailures} exceed maxCriticalFailures ${config.maxCriticalFailures}`
      );
    }
  }

  if (config.minCoveragePct !== undefined) {
    if (input.coveragePct === undefined) {
      reasons.push('coverage not measured');
    } else if (input.coveragePct < config.minCoveragePct) {
      reasons.push(
        `coverage ${input.coveragePct}% is below minCoveragePct ${config.minCoveragePct}`
      );
    }
  }

  if (config.maxPerformanceP95Ms !== undefined) {
    if (input.performanceP95Ms === undefined) {
      reasons.push('performance p95 not measured');
    } else if (input.performanceP95Ms > config.maxPerformanceP95Ms) {
      reasons.push(
        `performance p95 ${input.performanceP95Ms}ms exceeds maxPerformanceP95Ms ${config.maxPerformanceP95Ms}`
      );
    }
  }

  if (config.maxSecurityHigh !== undefined) {
    if (input.securityHigh === undefined) {
      reasons.push('security high findings not measured');
    } else if (input.securityHigh > config.maxSecurityHigh) {
      reasons.push(
        `security high ${input.securityHigh} exceed maxSecurityHigh ${config.maxSecurityHigh}`
      );
    }
  }

  return {
    block: reasons.length > 0,
    reasons,
  };
}

/** Platform capability status for the release-gate helper (PARTIAL — thresholds optional). */
export const QUALITY_GATE_PLATFORM_STATUS = 'PARTIAL' as const;

/**
 * Configurable quality gates over individual test results.
 * When `enabled` is false or omitted, the gate does not fail the run.
 * Threshold keys that are omitted are not checked.
 */
export interface QualityGatesConfig {
  /** When false or omitted, the gate does not fail the run. */
  enabled?: boolean;
  /** Max allowed; 0 means any critical failure fails the gate. */
  criticalFailures?: number;
  maxFailedTests?: number;
  /** Percent; only compared when coverage was measured. */
  minCoverage?: number;
  maxHighSecurityFindings?: number;
}

export interface QualityGatesInput {
  results: Array<{ testId: string; status: string; priority?: string }>;
  coveragePct?: number | null;
  highSecurityFindings?: number | null;
}

export interface QualityGatesResult {
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  reasons: string[];
  /** Same array reference and statuses as input — never filtered or rewritten. */
  results: QualityGatesInput['results'];
}

/**
 * Evaluate optional quality-gate thresholds against test results.
 * - `enabled` false/omitted → PASS with a disabled reason; thresholds are not inspected.
 * - When enabled, only configured threshold keys are checked.
 * - Missing coverage / security metrics → BLOCKED (not treated as 0 or 100).
 * - Status precedence: BLOCKED over FAIL over PASS.
 * Never flips a FAIL result row to PASS.
 */
export function evaluateQualityGates(
  input: QualityGatesInput,
  config: QualityGatesConfig = {}
): QualityGatesResult {
  if (config.enabled !== true) {
    return {
      status: 'PASS',
      reasons: ['quality gates are disabled; underlying results are unchanged'],
      results: input.results,
    };
  }

  const reasons: string[] = [];
  let blocked = false;
  let failed = false;

  const failedTests = input.results.filter((row) => row.status === 'FAIL');
  const criticalFailureCount = failedTests.filter((row) => row.priority === 'critical').length;
  const failedTestCount = failedTests.length;

  if (config.criticalFailures !== undefined) {
    if (criticalFailureCount > config.criticalFailures) {
      failed = true;
      reasons.push(
        `critical failures ${criticalFailureCount} exceeds limit ${config.criticalFailures}`
      );
    }
  }

  if (config.maxFailedTests !== undefined) {
    if (failedTestCount > config.maxFailedTests) {
      failed = true;
      reasons.push(`failed tests ${failedTestCount} exceeds limit ${config.maxFailedTests}`);
    }
  }

  if (config.minCoverage !== undefined) {
    if (input.coveragePct === null || input.coveragePct === undefined) {
      blocked = true;
      reasons.push('coverage not measured');
    } else if (input.coveragePct < config.minCoverage) {
      failed = true;
      reasons.push(`coverage ${input.coveragePct} is below minimum ${config.minCoverage}`);
    }
  }

  if (config.maxHighSecurityFindings !== undefined) {
    if (input.highSecurityFindings === null || input.highSecurityFindings === undefined) {
      blocked = true;
      reasons.push('security findings not measured');
    } else if (input.highSecurityFindings > config.maxHighSecurityFindings) {
      failed = true;
      reasons.push(
        `high security findings ${input.highSecurityFindings} exceeds limit ${config.maxHighSecurityFindings}`
      );
    }
  }

  let status: QualityGatesResult['status'] = 'PASS';
  if (blocked) {
    status = 'BLOCKED';
  } else if (failed) {
    status = 'FAIL';
  } else {
    reasons.push('quality gates passed');
  }

  return {
    status,
    reasons,
    results: input.results,
  };
}
