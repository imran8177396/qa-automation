import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import {
  PLAYWRIGHT_SUITE_OUTPUT_PATHS,
  PRODUCT_ORIGIN_SUITES,
  assertNoDuplicateOutputPaths,
} from '../playwright-suites';
import { assertNoConflictingRates, type LabelledPassRate } from '../pass-rate';
import { assertDiscoveryPrecedesExecution, type StageTimelineRow } from '../stage-timeline';
import type { CrossSuiteReport } from '../quality/cross-suite';
import { extractRefTokens, type NumberedSection } from './section-manifest';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export type QualityCheckResult = 'PASS' | 'FAIL' | 'NOT_AVAILABLE';

export interface QualityCheck {
  id: string;
  result: QualityCheckResult;
  detail: string;
}

export class QualityCheckFailure extends Error {
  readonly failures: QualityCheck[];

  constructor(failures: QualityCheck[]) {
    super(
      `Report stage failed: ${failures.length} automated quality check(s) failed. ` +
        failures.map((row) => `${row.id}: ${row.detail}`).join(' | ')
    );
    this.name = 'QualityCheckFailure';
    this.failures = failures;
  }
}

export interface QualityCheckInput {
  seo?: { rawFindingCount: number; uniqueFindingCount: number; findingsLength: number; available: boolean };
  plannedRefIds: string[];
  numberedSections: readonly NumberedSection[];
  passRates: LabelledPassRate[];
  suites: Array<{ name: string; status: string; executedCount: number }>;
  productOriginMismatches: Array<{ suite: string; origin: string; baseUrl: string }>;
  playwrightOutputPaths?: Record<string, string>;
  stageTimeline?: StageTimelineRow[] | null;
  emptyTablesWithoutReason: number;
  tautologicalArtifact?: { present: boolean; count?: number; path?: string };
  crossSuite?: CrossSuiteReport | null;
  crossSuiteArtifactMissing: boolean;
}

function check(
  id: string,
  result: QualityCheckResult,
  detail: string
): QualityCheck {
  return { id, result, detail };
}

export function evaluateQualityChecks(input: QualityCheckInput): QualityCheck[] {
  const checks: QualityCheck[] = [];

  if (!input.seo?.available) {
    checks.push(check('seo-dedupe', NOT_AVAILABLE, 'SEO artifact was not available; raw vs unique counts were not disclosed.'));
  } else {
    const uniqueMatches = input.seo.findingsLength === input.seo.uniqueFindingCount;
    const ok = uniqueMatches;
    checks.push(
      check(
        'seo-dedupe',
        ok ? 'PASS' : 'FAIL',
        ok
          ? `No duplicate findings after dedupe (raw ${input.seo.rawFindingCount}, unique ${input.seo.uniqueFindingCount}).`
          : `Duplicate findings remain after dedupe (raw ${input.seo.rawFindingCount}, unique ${input.seo.uniqueFindingCount}, rendered ${input.seo.findingsLength}).`
      )
    );
  }

  const knownIds = new Set(input.numberedSections.map((row) => row.id));
  const dangling = input.plannedRefIds.filter((id) => !knownIds.has(id));
  checks.push(
    check(
      'cross-references',
      dangling.length === 0 ? 'PASS' : 'FAIL',
      dangling.length === 0
        ? `Every cross-reference resolves through the section manifest (${input.plannedRefIds.length} ref(s)).`
        : `Dangling section reference(s): ${dangling.join(', ')}.`
    )
  );

  try {
    assertNoConflictingRates(input.passRates);
    checks.push(
      check(
        'pass-rate-conflict',
        'PASS',
        `No two pass rates sharing a scope label disagree (${input.passRates.length} labelled rate(s)).`
      )
    );
  } catch (error) {
    checks.push(check('pass-rate-conflict', 'FAIL', error instanceof Error ? error.message : String(error)));
  }

  const zeroExecPass = input.suites.filter(
    (suite) => suite.executedCount <= 0 && suite.status.toUpperCase() === 'PASS'
  );
  checks.push(
    check(
      'zero-exec-pass',
      zeroExecPass.length === 0 ? 'PASS' : 'FAIL',
      zeroExecPass.length === 0
        ? 'No suite with zero executed items is rendered PASS.'
        : `Suite(s) with zero executed items rendered PASS: ${zeroExecPass.map((s) => s.name).join(', ')}.`
    )
  );

  const originFail = input.productOriginMismatches.filter((row) =>
    (PRODUCT_ORIGIN_SUITES as readonly string[]).includes(row.suite)
  );
  checks.push(
    check(
      'suite-origin',
      originFail.length === 0 ? 'PASS' : 'FAIL',
      originFail.length === 0
        ? 'No product suite origin differs from the configured base URL.'
        : `Product suite origin mismatch: ${originFail.map((r) => `${r.suite} (${r.origin} ≠ ${r.baseUrl})`).join('; ')}.`
    )
  );

  try {
    assertNoDuplicateOutputPaths(input.playwrightOutputPaths ?? PLAYWRIGHT_SUITE_OUTPUT_PATHS);
    checks.push(check('playwright-output-paths', 'PASS', 'No two Playwright suites share an output path.'));
  } catch (error) {
    checks.push(
      check('playwright-output-paths', 'FAIL', error instanceof Error ? error.message : String(error))
    );
  }

  if (!input.stageTimeline || input.stageTimeline.length === 0) {
    checks.push(
      check(
        'discovery-before-execution',
        NOT_AVAILABLE,
        'Stage timeline artifact was not available; discovery-before-execution was not evaluated.'
      )
    );
  } else {
    const ordering = assertDiscoveryPrecedesExecution(input.stageTimeline);
    checks.push(
      check(
        'discovery-before-execution',
        ordering.ok ? 'PASS' : 'FAIL',
        ordering.ok
          ? 'Discovery completed before every execution stage.'
          : ordering.violations.join('; ')
      )
    );
  }

  checks.push(
    check(
      'empty-tables',
      input.emptyTablesWithoutReason === 0 ? 'PASS' : 'FAIL',
      input.emptyTablesWithoutReason === 0
        ? 'No table renders with zero rows and no reason.'
        : `${input.emptyTablesWithoutReason} table(s) rendered with zero rows and no reason.`
    )
  );

  if (!input.tautologicalArtifact?.present) {
    checks.push(
      check(
        'tautological-assertions',
        NOT_AVAILABLE,
        'P4 tautological-assertion artifact was not present; this check is NOT_AVAILABLE (not skipped silently).'
      )
    );
  } else {
    const count = input.tautologicalArtifact.count ?? 0;
    checks.push(
      check(
        'tautological-assertions',
        count === 0 ? 'PASS' : 'FAIL',
        count === 0
          ? `No assertion's expected value was derived from an observed value (${input.tautologicalArtifact.path ?? 'artifact'}).`
          : `${count} tautological assertion(s) listed in ${input.tautologicalArtifact.path ?? 'artifact'}.`
      )
    );
  }

  if (input.crossSuiteArtifactMissing) {
    checks.push(
      check(
        'cross-suite',
        NOT_AVAILABLE,
        'reports/quality/cross-suite.json was not present; cross-suite contradictions were not evaluated.'
      )
    );
  } else {
    const outstanding = input.crossSuite?.findings?.length ?? 0;
    checks.push(
      check(
        'cross-suite',
        outstanding === 0 ? 'PASS' : 'FAIL',
        outstanding === 0
          ? 'No cross-suite contradictions outstanding.'
          : `${outstanding} cross-suite contradiction(s) outstanding.`
      )
    );
  }

  return checks;
}

export function formatQualityCheckLine(check: QualityCheck): string {
  return `${check.result}: ${check.detail}`;
}

/**
 * Honest FAIL results that must appear in the report but must not abort
 * Word/HTML/PDF generation. Tautological / observed-status assertions are
 * collection-quality findings, not a reason to omit product evidence.
 */
export const NON_BLOCKING_QUALITY_CHECK_IDS = ['tautological-assertions'] as const;

export function isNonBlockingQualityCheck(id: string): boolean {
  return (NON_BLOCKING_QUALITY_CHECK_IDS as readonly string[]).includes(id);
}

export function blockingQualityFailures(checks: QualityCheck[]): QualityCheck[] {
  return checks.filter((row) => row.result === 'FAIL' && !isNonBlockingQualityCheck(row.id));
}

export function reportQualityWarnings(checks: QualityCheck[]): QualityCheck[] {
  return checks.filter((row) => row.result === 'FAIL' && isNonBlockingQualityCheck(row.id));
}

export function assertQualityChecksPass(checks: QualityCheck[]): void {
  const failures = blockingQualityFailures(checks);
  if (failures.length > 0) {
    throw new QualityCheckFailure(failures);
  }
}

export function collectPlannedRefIds(texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) => extractRefTokens(text)))];
}

const TAUTOLOGICAL_FLAG = 'TAUTOLOGICAL_ASSERTION';
const KNOWN_TAUTOLOGICAL_FILES = ['tautological-assertions.json', 'p4-assertions.json'];

function hasTautologicalFlag(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const flags = (value as { flags?: unknown }).flags;
  return Array.isArray(flags) && flags.includes(TAUTOLOGICAL_FLAG);
}

function jsonMentionsTautological(raw: unknown): boolean {
  return JSON.stringify(raw).includes(TAUTOLOGICAL_FLAG);
}

/** Count TAUTOLOGICAL_ASSERTION flags; never invents rows. */
export function countTautologicalAssertions(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.requests) || Array.isArray(obj.flaggedAssertions)) {
    const fromRequests = Array.isArray(obj.requests)
      ? obj.requests.filter(hasTautologicalFlag).length
      : 0;
    if (fromRequests > 0) return fromRequests;
    return Array.isArray(obj.flaggedAssertions)
      ? obj.flaggedAssertions.filter(hasTautologicalFlag).length
      : 0;
  }

  if (Array.isArray(obj.items)) {
    const flagged = obj.items.filter(hasTautologicalFlag).length;
    if (flagged > 0) return flagged;
    return typeof obj.count === 'number' ? obj.count : obj.items.length;
  }

  return typeof obj.count === 'number' ? obj.count : 0;
}

export function readTautologicalArtifact(root = PATHS.root): QualityCheckInput['tautologicalArtifact'] {
  const qualityDir = path.join(root, 'reports', 'quality');
  const candidates: string[] = KNOWN_TAUTOLOGICAL_FILES.map((name) => path.join(qualityDir, name));

  if (fs.existsSync(qualityDir)) {
    for (const name of fs.readdirSync(qualityDir)) {
      if (!name.endsWith('.json') || name === 'cross-suite.json') continue;
      if (KNOWN_TAUTOLOGICAL_FILES.includes(name)) continue;
      const full = path.join(qualityDir, name);
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
        if (jsonMentionsTautological(raw)) candidates.push(full);
      } catch {
        /* unreadable quality file is not a tautological artifact */
      }
    }
  }

  candidates.push(path.join(root, 'reports', 'postman', 'section-2.7.json'));

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (relative.endsWith('section-2.7.json') && !jsonMentionsTautological(raw)) {
      continue;
    }
    return {
      present: true,
      count: countTautologicalAssertions(raw),
      path: relative,
    };
  }
  return { present: false };
}
