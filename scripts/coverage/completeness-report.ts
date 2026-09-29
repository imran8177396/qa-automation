/**
 * Discovery completeness report: screens / elements / generated cases and gaps.
 *
 * Pure counts from caller-supplied inventories — never invents screens, elements,
 * test-case totals, or PASS. Aligns with traceability gaps: decorative is
 * non-testable first (not testable-without-case); missing cases stay NOT_TESTED.
 */

export interface CompletenessGap {
  kind: 'screen' | 'element';
  id: string;
  reason: string;
  status: 'NOT_TESTED' | 'NOT_APPLICABLE' | 'REQUIRES_CONFIGURATION' | 'BLOCKED';
}

export interface CompletenessReport {
  discoveredScreens: number;
  testableScreens: number;
  excludedScreens: number;
  discoveredElements: number;
  testableElements: number;
  nonTestableElements: number;
  /** Unique-case count (or planned-check count when unique set absent) — caller-supplied. */
  generatedTestCases: number;
  /**
   * Raw planned-check length when the caller supplies it (pre-dedupe audit).
   * Omitted when not provided — never invented.
   */
  rawGeneratedTestCases?: number;
  screensWithoutTestCases: number;
  testableElementsWithoutTestCases: number;
  gaps: CompletenessGap[];
}

export interface CompletenessScreenInput {
  screenId: string;
  excluded?: boolean;
  exclusionReason?: string;
  exclusionStatus?: CompletenessGap['status'];
}

export interface CompletenessElementInput {
  elementId: string;
  screenId: string;
  decorative?: boolean;
  testable?: boolean;
  exclusionReason?: string;
  exclusionStatus?: CompletenessGap['status'];
}

const DEFAULT_DECORATIVE_REASON = 'Decorative element with no user interaction.';
const DEFAULT_SCREEN_EXCLUSION_REASON = 'screen excluded without a recorded reason';
const NO_SCREEN_CASE_REASON = 'no test case was generated for this screen';
const NO_ELEMENT_CASE_REASON = 'no test case was generated for this element';
const DEFAULT_NON_TESTABLE_REASON = 'element marked non-testable';

function isExcludedScreen(screen: CompletenessScreenInput): boolean {
  return screen.excluded === true || screen.exclusionStatus != null;
}

function isNonTestableElement(el: CompletenessElementInput): boolean {
  return el.decorative === true || el.testable === false || el.exclusionStatus != null;
}

function isTestableElement(el: CompletenessElementInput): boolean {
  return !isNonTestableElement(el);
}

function nonEmptyReason(reason: string | undefined): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function gapForExcludedScreen(screen: CompletenessScreenInput): CompletenessGap {
  const reason = nonEmptyReason(screen.exclusionReason);
  if (reason != null && screen.exclusionStatus != null) {
    return {
      kind: 'screen',
      id: screen.screenId,
      reason,
      status: screen.exclusionStatus,
    };
  }
  if (reason != null) {
    return {
      kind: 'screen',
      id: screen.screenId,
      reason,
      status: screen.exclusionStatus ?? 'NOT_TESTED',
    };
  }
  return {
    kind: 'screen',
    id: screen.screenId,
    reason: DEFAULT_SCREEN_EXCLUSION_REASON,
    status: screen.exclusionStatus ?? 'NOT_TESTED',
  };
}

function gapForNonTestableElement(el: CompletenessElementInput): CompletenessGap {
  if (el.decorative === true) {
    return {
      kind: 'element',
      id: el.elementId,
      reason: nonEmptyReason(el.exclusionReason) ?? DEFAULT_DECORATIVE_REASON,
      status: el.exclusionStatus ?? 'NOT_APPLICABLE',
    };
  }
  if (el.exclusionStatus != null) {
    return {
      kind: 'element',
      id: el.elementId,
      reason: nonEmptyReason(el.exclusionReason) ?? DEFAULT_NON_TESTABLE_REASON,
      status: el.exclusionStatus,
    };
  }
  return {
    kind: 'element',
    id: el.elementId,
    reason: nonEmptyReason(el.exclusionReason) ?? DEFAULT_NON_TESTABLE_REASON,
    status: 'NOT_APPLICABLE',
  };
}

/**
 * Build a completeness report from discovered screens/elements and which ids
 * already have at least one generated test case. `generatedTestCases` is opaque
 * to this function — the caller chooses unique-case vs planned-check count.
 */
export function buildCompletenessReport(input: {
  screens: CompletenessScreenInput[];
  elements: CompletenessElementInput[];
  testCaseScreenIds: string[];
  testCaseElementIds: string[];
  generatedTestCases: number;
  rawGeneratedTestCases?: number;
}): CompletenessReport {
  const screens = input.screens ?? [];
  const elements = input.elements ?? [];
  const screenCaseIds = new Set(
    (input.testCaseScreenIds ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  );
  const elementCaseIds = new Set(
    (input.testCaseElementIds ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  );

  const discoveredScreens = screens.length;
  const excludedScreenList = screens.filter(isExcludedScreen);
  const excludedScreens = excludedScreenList.length;
  const testableScreens = Math.max(0, discoveredScreens - excludedScreens);

  const discoveredElements = elements.length;
  const nonTestableList = elements.filter(isNonTestableElement);
  const nonTestableElements = nonTestableList.length;
  const testableElements = Math.max(0, discoveredElements - nonTestableElements);

  const gaps: CompletenessGap[] = [];
  let screensWithoutTestCases = 0;
  let testableElementsWithoutTestCases = 0;

  for (const screen of screens) {
    if (isExcludedScreen(screen)) {
      gaps.push(gapForExcludedScreen(screen));
      continue;
    }
    if (!screenCaseIds.has(screen.screenId)) {
      screensWithoutTestCases += 1;
      gaps.push({
        kind: 'screen',
        id: screen.screenId,
        reason: nonEmptyReason(screen.exclusionReason) ?? NO_SCREEN_CASE_REASON,
        status: 'NOT_TESTED',
      });
    }
  }

  for (const el of elements) {
    // Decorative / non-testable first — never count as testable-without-case.
    if (isNonTestableElement(el)) {
      gaps.push(gapForNonTestableElement(el));
      continue;
    }
    if (!elementCaseIds.has(el.elementId)) {
      testableElementsWithoutTestCases += 1;
      gaps.push({
        kind: 'element',
        id: el.elementId,
        reason: NO_ELEMENT_CASE_REASON,
        status: 'NOT_TESTED',
      });
    }
  }

  const report: CompletenessReport = {
    discoveredScreens,
    testableScreens,
    excludedScreens,
    discoveredElements,
    testableElements,
    nonTestableElements,
    generatedTestCases: input.generatedTestCases,
    screensWithoutTestCases,
    testableElementsWithoutTestCases,
    gaps,
  };

  if (input.rawGeneratedTestCases !== undefined) {
    report.rawGeneratedTestCases = input.rawGeneratedTestCases;
  }

  return report;
}

const REPORT_LABELS = [
  ['DISCOVERED SCREENS', 'discoveredScreens'],
  ['TESTABLE SCREENS', 'testableScreens'],
  ['EXCLUDED SCREENS', 'excludedScreens'],
  ['DISCOVERED ELEMENTS', 'discoveredElements'],
  ['TESTABLE ELEMENTS', 'testableElements'],
  ['NON-TESTABLE ELEMENTS', 'nonTestableElements'],
  ['GENERATED TEST CASES', 'generatedTestCases'],
  ['SCREENS WITHOUT TEST CASES', 'screensWithoutTestCases'],
  ['TESTABLE ELEMENTS WITHOUT TEST CASES', 'testableElementsWithoutTestCases'],
] as const;

/**
 * Plain-text completeness summary. Integer counts only — no thousands separators.
 * Gap lines explain every excluded / non-testable / missing-case id.
 */
export function renderCompletenessReport(report: CompletenessReport): string {
  const lines: string[] = [];
  for (const [label, key] of REPORT_LABELS) {
    lines.push(`${label}: ${report[key]}`);
  }
  if (report.rawGeneratedTestCases !== undefined) {
    lines.push(`RAW GENERATED TEST CASES: ${report.rawGeneratedTestCases}`);
  }
  if (report.gaps.length > 0) {
    lines.push('');
    lines.push('GAPS');
    for (const gap of report.gaps) {
      lines.push(`${gap.kind.toUpperCase()} ${gap.id} [${gap.status}] ${gap.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
