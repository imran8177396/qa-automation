import { displayCoverageStatus, mapProjectStatus } from './project-status';
import { evidenceMatchesItem } from './match';
import type {
  CoverageRecord,
  CoverageStatus,
  ExecutionEvidence,
  InventoryItem,
  ScenarioId,
} from './types';

export { displayCoverageStatus };

const RECOMMENDED: Record<ScenarioId, string> = {
  'page-load': 'Assert the discovered page returns < 400 and renders its main content.',
  'broken-link': 'GET the discovered href and record the status. Do not invent a preferred destination.',
  visibility: 'Assert the discovered locator is attached and visible.',
  'enabled-state': 'Assert enabled/disabled from the inventoried state.',
  'form-presence': 'Assert the form (or field) is present. Do not submit.',
  'valid-input': 'Fill a representative valid value without submitting.',
  'invalid-input': 'Fill an invalid value inferred from the control type, blur, do not submit.',
  'empty-input': 'Clear the required field and blur. Do not submit.',
  'required-validation': 'Leave the required control empty and record validity — do not invent message text.',
  'boundary-values': 'Exercise the observed min/max/length constraint without submitting.',
  'special-characters': 'Fill special characters into the free-text control without submitting.',
  'whitespace-input': 'Fill whitespace-only text without submitting.',
  'long-input': 'Fill a long string without submitting.',
  'unicode-input': 'Fill unicode text without submitting.',
  editability: 'Assert read-only vs editable from the inventoried state.',
  'required-state': 'Assert the inventoried required/optional flag. Do not invent HTML5 required.',
  'accessible-name': 'Assert the accessible name observed at discovery.',
  'validation-state': 'Read HTML5 validity after blur. Do not invent a message.',
  'error-recovery': 'Invalid fill, then valid fill, no submit.',
  'click-behavior': 'Click the non-submit control. Do not click destructive or submit controls.',
  navigation: 'Follow the in-scope href and record the destination status.',
  'form-submit': 'Do not auto-submit. Record BLOCKED unless a documented cleanup workflow exists.',
  'api-smoke': 'Execute the documented or observed method+path via Postman CLI.',
  'api-auth': 'Do not invent an auth contract. Set postman.auth only when the target documents it.',
  'browser-execution': 'Run the engine project (Chromium/Firefox/WebKit). Do not claim iOS Safari or Android Chrome.',
  'viewport-matrix': 'Run npm run test:responsive (Chromium emulated viewports — not a real device / not Mobile Safari).',
  'accessibility-scan': 'Run npm run test:accessibility (automated only — not a complete WCAG audit).',
  'visual-regression': 'Run npm run test:visual. Do not auto-update baselines.',
  'ui-api-correlation':
    'Run the documented UI+API pair only (npm run test:workflows). Do not invent Sauce Demo REST or force JSONPlaceholder into UI tests.',
  'performance-profile': 'Run the authorized JMeter profile. Do not invent thresholds.',
  'security-baseline': 'Run npm run test:security (QA-level only — not a pentest).',
  'seo-baseline': 'Run npm run test:seo (technical only — not a ranking audit).',
  'content-baseline': 'Run npm run test:content (structural only — not fact-checking).',
};

export function isTestable(item: InventoryItem): boolean {
  return item.applicableScenarios.some((scenario) => scenario.disposition === 'executable');
}

export function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const raw = (numerator / denominator) * 100;
  const rounded = Math.round(raw * 10) / 10;
  if (rounded === 100 && numerator < denominator) return 99.9;
  return rounded;
}

export function emptyByStatus(): Record<CoverageStatus, number> {
  return {
    TESTED: 0,
    FAILED: 0,
    BLOCKED: 0,
    SKIPPED: 0,
    'NOT APPLICABLE': 0,
    UNTESTABLE: 0,
    UNCOVERED: 0,
  };
}

export function recommendedTestFor(item: InventoryItem): string {
  if (item.coverageHint === 'not-applicable' || item.projectStatus === 'NOT_DISCOVERED') {
    return 'Do not invent this control. Re-run discovery if the page later exposes it.';
  }
  const pending = item.applicableScenarios.find((row) => !row.tested) ?? item.applicableScenarios[0];
  if (!pending) return 'Record why this item cannot be tested. Do not invent a passing check.';
  return RECOMMENDED[pending.id] ?? pending.reason;
}

export function ensureCoverageReason(status: CoverageStatus, reason: string): string {
  const text = reason.trim();
  if (status === 'SKIPPED') {
    return text || 'SKIPPED WITH REASON — a skip reason was not supplied; the item is not omitted.';
  }
  return text || 'Coverage status was recorded without a detail string. The item is not omitted.';
}

function classified(status: CoverageStatus, reason: string): { status: CoverageStatus; reason: string } {
  return { status, reason: ensureCoverageReason(status, reason) };
}

function evidenceFor(item: InventoryItem, evidence: ExecutionEvidence[]): ExecutionEvidence[] {
  const ids = new Set(item.applicableScenarios.flatMap((row) => row.evidenceIds));
  const byId = evidence.filter((row) => ids.has(row.id));
  if (byId.length > 0) return byId;
  return evidence.filter((row) => evidenceMatchesItem(item, row));
}

export function classifyItem(
  item: InventoryItem,
  evidence: ExecutionEvidence[]
): { status: CoverageStatus; reason: string } {
  if (item.coverageHint === 'skipped') {
    return classified(
      'SKIPPED',
      item.applicableScenarios[0]?.reason ?? 'Explicitly skipped in configuration. The item is not omitted.'
    );
  }
  if (item.coverageHint === 'not-applicable') {
    return classified(
      'NOT APPLICABLE',
      item.applicableScenarios[0]?.reason ?? 'Not applicable for this configuration. The item is not omitted.'
    );
  }
  if (item.coverageHint === 'untestable') {
    return classified(
      'UNTESTABLE',
      item.applicableScenarios[0]?.reason ?? 'Discovered but not targetable. The item is not omitted.'
    );
  }

  const executable = item.applicableScenarios.filter((row) => row.disposition === 'executable');
  const matched = evidenceFor(item, evidence);
  const executed = matched.filter((row) => row.executed);
  const failed = executed.filter((row) => row.status === 'FAIL');
  const passed = executed.filter((row) => row.status === 'PASS');
  const skipped = matched.filter((row) => row.status === 'SKIPPED');

  if (executable.length > 0 && executed.length > 0) {
    if (failed.length > 0) {
      return classified(
        'FAILED',
        `Execution evidence failed (${failed[0].title}). Coverage still counts this item — pass rate is not coverage.`
      );
    }
    if (passed.length > 0) {
      const untested = executable.filter((row) => !row.tested);
      return classified(
        'TESTED',
        untested.length > 0
          ? `At least one executable scenario has evidence. Remaining: ${untested.map((row) => row.id).join(', ')}.`
          : 'Executable scenario(s) have execution evidence against this item.'
      );
    }
    const recorded = executed.find((row) => row.status === 'RECORDED' || row.status === 'UNKNOWN');
    if (recorded) {
      return classified(
        'TESTED',
        `Execution evidence recorded (${recorded.title}). Coverage counts executed items — pass rate is not coverage.`
      );
    }
  }

  if (executable.length > 0 && skipped.length > 0 && executed.length === 0) {
    return classified('SKIPPED', `Matching execution was skipped (${skipped[0].title}).`);
  }

  if (executable.length > 0) {
    return classified(
      'UNCOVERED',
      executable.find((row) => !row.tested)?.reason ?? 'No execution evidence matched this testable item.'
    );
  }

  if (item.applicableScenarios.some((row) => row.disposition === 'blocked-safety')) {
    const detail =
      item.applicableScenarios.find((row) => row.disposition === 'blocked-safety')?.reason ??
      'Blocked by the safety policy. Not silently omitted.';
    const mapped =
      item.projectStatus === 'NOT_TESTED' ? mapProjectStatus('NOT_TESTED', detail) : null;
    return classified('BLOCKED', mapped?.reason ?? detail);
  }

  if (item.applicableScenarios.some((row) => row.disposition === 'requires-configuration')) {
    const detail =
      item.applicableScenarios.find((row) => row.disposition === 'requires-configuration')?.reason ??
      'Requires configuration. Not silently omitted.';
    const mapped =
      item.projectStatus === 'REQUIRES_CONFIGURATION' || !item.projectStatus
        ? mapProjectStatus('REQUIRES_CONFIGURATION', detail)
        : null;
    return classified('BLOCKED', mapped?.reason ?? detail);
  }

  if (item.applicableScenarios.some((row) => row.disposition === 'not-implemented')) {
    return classified(
      'UNTESTABLE',
      item.applicableScenarios.find((row) => row.disposition === 'not-implemented')?.reason ??
        'No executable mapping. Not silently omitted.'
    );
  }

  return classified('UNTESTABLE', 'No applicable scenario was assigned. Not silently omitted.');
}

export function toCoverageRecord(item: InventoryItem, evidence: ExecutionEvidence[]): CoverageRecord {
  const { status, reason } = classifyItem(item, evidence);
  return {
    id: item.id,
    page: item.page ?? item.route ?? item.source,
    element: item.locator || item.name,
    type: item.elementType || item.kind,
    kind: item.kind,
    status,
    reason,
    recommendedTest: recommendedTestFor(item),
  };
}

export function isCoveredStatus(status: CoverageStatus): boolean {
  return status === 'TESTED' || status === 'FAILED';
}
