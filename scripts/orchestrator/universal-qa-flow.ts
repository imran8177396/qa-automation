import fs from 'fs';
import path from 'path';
import { readJsonIfExists } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import type { QualityGateResult, QualityGateStatus } from './quality-gate';
import type { StageResult } from './types';

/**
 * Conceptual Universal QA steps. These are a mapping onto existing qa:all
 * child stages — they are not 31 extra processes.
 */
export type UniversalStepRealization =
  | 'child-stage'
  | 'shared-child'
  | 'in-process'
  | 'side-effect'
  | 'suite-runner-report'
  | 'quality-gate';

export type UniversalStepStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_EXECUTED'
  | 'RECORDED'
  | 'UNAVAILABLE'
  | 'PARTIAL'
  | 'WARNING'
  | 'INVALID';

export interface UniversalQaStep {
  n: number;
  title: string;
  realization: UniversalStepRealization;
  stageKeys: string[];
  scripts: string[];
  artifacts: string[];
  notes: string;
}

export interface UniversalQaStepSnapshot extends UniversalQaStep {
  status: UniversalStepStatus;
  statusReason: string;
}

export interface EvidenceAvailability {
  screenshots: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string };
  videos: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string };
  traces: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string };
  logs: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string };
  networkConsole: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string };
}

export interface UniversalQaFlowSnapshot {
  generatedAt: string;
  command: 'qa:all';
  note: string;
  steps: UniversalQaStepSnapshot[];
}

const EXECUTE_STAGE_KEYS = [
  'e2e',
  'visual',
  'responsive',
  'cross-browser',
  'accessibility',
  'workflows',
] as const;

export const UNIVERSAL_QA_STEPS: readonly UniversalQaStep[] = [
  {
    n: 1,
    title: 'Read configuration',
    realization: 'in-process',
    stageKeys: ['preflight'],
    scripts: ['scripts/run-all.ts', 'scripts/lib/load-config.ts', 'scripts/preflight.ts'],
    artifacts: ['qa.config.json'],
    notes: 'Orchestrator loadConfig plus preflight. No invented URLs or APIs.',
  },
  {
    n: 2,
    title: 'Validate environment',
    realization: 'child-stage',
    stageKeys: ['preflight'],
    scripts: ['scripts/preflight.ts'],
    artifacts: ['reports/preflight.json'],
    notes: 'Existing preflight child stage.',
  },
  {
    n: 3,
    title: 'Discover application',
    realization: 'child-stage',
    stageKeys: ['discovery'],
    scripts: ['scripts/discover.ts'],
    artifacts: ['reports/discovery/discovery.json'],
    notes: 'Sauce Demo discovery is login-only.',
  },
  {
    n: 4,
    title: 'Build page map',
    realization: 'shared-child',
    stageKeys: ['discovery'],
    scripts: ['scripts/discover.ts'],
    artifacts: ['discovery/page-map.json'],
    notes: 'Written by the discovery child — not a second process.',
  },
  {
    n: 5,
    title: 'Build UI inventory',
    realization: 'shared-child',
    stageKeys: ['discovery'],
    scripts: ['scripts/discover.ts'],
    artifacts: ['discovery/ui-inventory.json'],
    notes: 'Written by the discovery child — not a second process.',
  },
  {
    n: 6,
    title: 'Build workflow inventory',
    realization: 'shared-child',
    stageKeys: ['discovery'],
    scripts: ['scripts/discover.ts'],
    artifacts: ['discovery/workflow-inventory.json'],
    notes: 'Written by the discovery child — not a second process.',
  },
  {
    n: 7,
    title: 'Build API inventory',
    realization: 'shared-child',
    stageKeys: ['discovery'],
    scripts: ['scripts/discover.ts'],
    artifacts: ['discovery/api-inventory.json'],
    notes: 'Sauce Demo: 0 product XHR. JSONPlaceholder is documented API only.',
  },
  {
    n: 8,
    title: 'Determine applicable tests',
    realization: 'child-stage',
    stageKeys: ['coverage-planning', 'inventory'],
    scripts: ['scripts/planning/write-planned-checks.ts'],
    artifacts: ['reports/discovery/planned-checks.json'],
    notes: 'Safety-blocked items stay BLOCKED / NOT_TESTED with a reason.',
  },
  {
    n: 9,
    title: 'Build test inventory',
    realization: 'child-stage',
    stageKeys: ['inventory'],
    scripts: ['scripts/orchestrator/generate-inventory.ts'],
    artifacts: ['reports/discovery/inventory.json'],
    notes: 'Every discovered testable item keeps an explicit status (Part 17).',
  },
  {
    n: 10,
    title: 'Build coverage plan',
    realization: 'child-stage',
    stageKeys: ['coverage-planning'],
    scripts: ['scripts/planning/write-planned-checks.ts'],
    artifacts: ['reports/discovery/planned-checks.json'],
    notes: 'Same planning script as step 8 — not a duplicate child.',
  },
  {
    n: 11,
    title: 'Generate/update required automation',
    realization: 'shared-child',
    stageKeys: ['inventory', 'coverage-planning'],
    scripts: ['scripts/orchestrator/generate-inventory.ts', 'scripts/planning/write-planned-checks.ts'],
    artifacts: ['reports/discovery/planned-checks.json'],
    notes: 'Updates planned checks from discovery only. Does not invent endpoints.',
  },
  {
    n: 12,
    title: 'Execute tests',
    realization: 'child-stage',
    stageKeys: [...EXECUTE_STAGE_KEYS],
    scripts: [
      'scripts/run-playwright-e2e.ts',
      'scripts/run-visual.ts',
      'scripts/run-responsive.ts',
      'scripts/run-cross-browser.ts',
      'scripts/run-accessibility.ts',
      'scripts/run-workflows.ts',
    ],
    artifacts: ['reports/playwright/'],
    notes: 'Existing Playwright suite children. Continue-on-failure unless --fail-fast.',
  },
  {
    n: 13,
    title: 'Collect screenshots',
    realization: 'side-effect',
    stageKeys: [...EXECUTE_STAGE_KEYS],
    scripts: ['scripts/lib/playwright-suites.ts'],
    artifacts: ['test-results/playwright/'],
    notes: 'Playwright screenshot: only-on-failure. Missing files are unavailable, not fabricated.',
  },
  {
    n: 14,
    title: 'Collect videos',
    realization: 'side-effect',
    stageKeys: [...EXECUTE_STAGE_KEYS],
    scripts: ['scripts/lib/playwright-suites.ts'],
    artifacts: ['test-results/playwright/'],
    notes: 'Playwright video: retain-on-failure. Missing files are unavailable, not fabricated.',
  },
  {
    n: 15,
    title: 'Collect traces',
    realization: 'side-effect',
    stageKeys: [...EXECUTE_STAGE_KEYS],
    scripts: ['scripts/lib/playwright-suites.ts'],
    artifacts: ['test-results/playwright/'],
    notes: 'Playwright trace: retain-on-failure. Missing files are unavailable, not fabricated.',
  },
  {
    n: 16,
    title: 'Collect logs',
    realization: 'side-effect',
    stageKeys: ['analyze'],
    scripts: ['scripts/analyze-failures.ts', 'scripts/failures/evidence.ts'],
    artifacts: ['reports/failures/'],
    notes: 'Failure analysis attaches logs when present. Missing = unavailable.',
  },
  {
    n: 17,
    title: 'Collect network/console evidence where available',
    realization: 'side-effect',
    stageKeys: ['analyze'],
    scripts: ['scripts/analyze-failures.ts', 'scripts/failures/evidence.ts'],
    artifacts: ['reports/failures/'],
    notes: 'Console/network excerpts only when Playwright retained them. Never invented.',
  },
  {
    n: 18,
    title: 'Execute API tests',
    realization: 'child-stage',
    stageKeys: ['api'],
    scripts: ['scripts/run-api.ts'],
    artifacts: ['reports/postman/'],
    notes: 'Documented qa.config.json postman.requests (JSONPlaceholder).',
  },
  {
    n: 19,
    title: 'Execute performance tests according to safety policy',
    realization: 'child-stage',
    stageKeys: ['performance'],
    scripts: ['scripts/run-performance.ts'],
    artifacts: ['reports/jmeter/', 'reports/performance/'],
    notes: 'Liveness only. --authorize-heavy is stripped. JMeter status stays RECORDED, not PASS.',
  },
  {
    n: 20,
    title: 'Execute security checks',
    realization: 'child-stage',
    stageKeys: ['security'],
    scripts: ['scripts/run-security.ts'],
    artifacts: ['reports/security/'],
    notes: 'QA-level security — not a pentest.',
  },
  {
    n: 21,
    title: 'Execute SEO/content checks',
    realization: 'child-stage',
    stageKeys: ['seo', 'content'],
    scripts: ['scripts/run-seo.ts', 'scripts/run-content.ts'],
    artifacts: ['reports/seo/', 'reports/content/'],
    notes: 'Existing seo + content children (page-scan parallel group).',
  },
  {
    n: 22,
    title: 'Calculate coverage',
    realization: 'child-stage',
    stageKeys: ['coverage'],
    scripts: ['scripts/coverage.ts'],
    artifacts: ['reports/coverage/coverage.json'],
    notes: 'Every inventory item has an explicit status. Coverage is not pass rate. Maps to orchestrator phase COVERAGE.',
  },
  {
    n: 23,
    title: 'Analyze failures',
    realization: 'child-stage',
    stageKeys: ['analyze'],
    scripts: ['scripts/analyze-failures.ts'],
    artifacts: ['reports/failures/'],
    notes: 'Always scheduled after coverage. Not silently omitted after --fail-fast. Maps to FAILURE ANALYSIS.',
  },
  {
    n: 24,
    title: 'Retest appropriate failures',
    realization: 'child-stage',
    stageKeys: ['retest'],
    scripts: ['scripts/retest.ts'],
    artifacts: ['reports/retest/'],
    notes: 'qa:all passes --automation-only. APPLICATION defects stay NOT_EXECUTED with a reason. Maps to RETEST.',
  },
  {
    n: 25,
    title: 'Generate Allure',
    realization: 'child-stage',
    stageKeys: ['allure'],
    scripts: ['scripts/reporting/generate-allure-report.ts'],
    artifacts: ['reports/allure/report/'],
    notes: 'BLOCKED/NOT_EXECUTED if the CLI cannot generate HTML — never claimed present.',
  },
  {
    n: 26,
    title: 'Generate Playwright report',
    realization: 'child-stage',
    stageKeys: ['playwright-reports'],
    scripts: ['scripts/reporting/report-playwright.ts'],
    artifacts: ['reports/playwright/'],
    notes: 'Indexes suite HTML under reports/playwright/<suite>/html/.',
  },
  {
    n: 27,
    title: 'Generate Postman report',
    realization: 'suite-runner-report',
    stageKeys: ['api'],
    scripts: ['scripts/run-api.ts'],
    artifacts: ['reports/postman/report.json', 'reports/postman/cli-report.html'],
    notes: 'Produced by the API suite runner, not a separate child. Missing = NOT_EXECUTED.',
  },
  {
    n: 28,
    title: 'Generate JMeter report',
    realization: 'suite-runner-report',
    stageKeys: ['performance'],
    scripts: ['scripts/run-performance.ts'],
    artifacts: ['reports/jmeter/summary.json', 'reports/jmeter/html/index.html'],
    notes: 'Produced by the performance runner. Liveness is RECORDED, never PASS. Missing = NOT_EXECUTED.',
  },
  {
    n: 29,
    title: 'Generate final QA summary',
    realization: 'child-stage',
    stageKeys: ['report'],
    scripts: ['scripts/reporting/generate-final-report.ts'],
    artifacts: ['reports/summary/final-qa-report.md'],
    notes: 'Existing report stage — always runs at the end of qa:all.',
  },
  {
    n: 30,
    title: 'Determine quality gate',
    realization: 'quality-gate',
    stageKeys: [],
    scripts: ['scripts/orchestrator/quality-gate.ts', 'scripts/orchestrator/suite-rollup.ts', 'scripts/lib/qa-report/quality-checks.ts'],
    artifacts: ['reports/orchestrator/quality-gate.json'],
    notes: 'Uses existing suite rollup + report quality-checks. OVERALL is PASS / FAIL / BLOCKED.',
  },
  {
    n: 31,
    title: 'Return final PASS/FAIL/BLOCKED result',
    realization: 'in-process',
    stageKeys: [],
    scripts: ['scripts/run-all.ts'],
    artifacts: ['reports/orchestrator/summary.json'],
    notes: 'process.exit from the orchestrator. Cursor is not a runtime dependency.',
  },
];

const FLOW_NOTE =
  'Conceptual 31-step Universal QA mapped onto existing qa:all stages and the stable 11-phase orchestrator flow. Discovery writes page-map + inventories in one child. Evidence 13–17 are Playwright/analyze side-effects. Postman/JMeter reports come from those suite runners. No Cursor APIs. No second run-all.';

const STATUS_RANK: Record<UniversalStepStatus, number> = {
  FAIL: 7,
  INVALID: 7,
  PARTIAL: 6,
  BLOCKED: 5,
  NOT_EXECUTED: 4,
  WARNING: 3,
  UNAVAILABLE: 2,
  RECORDED: 1,
  PASS: 0,
};

function asStepStatus(value: string | undefined): UniversalStepStatus {
  const upper = (value ?? 'NOT_EXECUTED').trim().toUpperCase();
  if (upper in STATUS_RANK) return upper as UniversalStepStatus;
  if (upper === 'ERROR') return 'FAIL';
  return 'NOT_EXECUTED';
}

function worstStatus(statuses: UniversalStepStatus[]): UniversalStepStatus {
  if (statuses.length === 0) return 'NOT_EXECUTED';
  return statuses.reduce((worst, current) => (STATUS_RANK[current] > STATUS_RANK[worst] ? current : worst));
}

function stageByKey(results: StageResult[], key: string): StageResult | undefined {
  return results.find((row) => row.key === key);
}

function statusesForKeys(results: StageResult[], keys: string[]): UniversalStepStatus[] {
  return keys.map((key) => asStepStatus(stageByKey(results, key)?.status));
}

function executeRan(results: StageResult[]): boolean {
  return EXECUTE_STAGE_KEYS.some((key) => {
    const status = stageByKey(results, key)?.status;
    return Boolean(status && status !== 'NOT_EXECUTED');
  });
}

function walkHasMatch(root: string, match: (name: string) => boolean, depth = 0): boolean {
  if (depth > 8 || !fs.existsSync(root)) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (match(entry.name)) return true;
    if (entry.isDirectory()) {
      if (walkHasMatch(path.join(root, entry.name), match, depth + 1)) return true;
    }
  }
  return false;
}

function firstExistingArtifact(relPaths: string[]): string | null {
  for (const rel of relPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(PATHS.root, rel);
    if (fs.existsSync(abs)) return rel.replace(/\\/g, '/');
  }
  return null;
}

export function inspectEvidenceAvailability(root = PATHS.root): EvidenceAvailability {
  const playwrightOut = path.join(root, 'test-results', 'playwright');
  const playwrightReports = path.join(root, 'reports', 'playwright');
  const hasScreenshot =
    walkHasMatch(playwrightOut, (name) => name.endsWith('.png') || name.toLowerCase().includes('screenshot')) ||
    walkHasMatch(playwrightReports, (name) => name.endsWith('.png') || name.toLowerCase().includes('screenshot'));
  const hasVideo =
    walkHasMatch(playwrightOut, (name) => name.endsWith('.webm') || name.endsWith('.mp4') || name.toLowerCase().includes('video')) ||
    walkHasMatch(playwrightReports, (name) => name.endsWith('.webm') || name.endsWith('.mp4'));
  const hasTrace =
    walkHasMatch(playwrightOut, (name) => name === 'trace.zip' || name.toLowerCase().includes('trace')) ||
    walkHasMatch(playwrightReports, (name) => name === 'trace.zip' || name.toLowerCase().includes('trace'));

  const failures = readJsonIfExists<{
    failures?: Array<{
      evidence?: {
        consolePresent?: boolean;
        networkPresent?: boolean;
        screenshotPresent?: boolean;
      };
    }>;
    totalFailures?: number;
  }>(path.join(root, 'reports', 'failures', 'summary.json'));

  const failureRows = failures?.failures ?? [];
  const consolePresent = failureRows.some((row) => row.evidence?.consolePresent === true);
  const networkPresent = failureRows.some((row) => row.evidence?.networkPresent === true);
  const logsPresent = Boolean(failures) || hasScreenshot || hasTrace;

  const unavailable = (kind: string): string =>
    `${kind} not present on disk — recorded as unavailable, not fabricated`;

  return {
    screenshots: hasScreenshot
      ? { status: 'RECORDED', detail: 'Playwright retained at least one screenshot' }
      : { status: 'UNAVAILABLE', detail: unavailable('screenshots') },
    videos: hasVideo
      ? { status: 'RECORDED', detail: 'Playwright retained at least one video' }
      : { status: 'UNAVAILABLE', detail: unavailable('videos') },
    traces: hasTrace
      ? { status: 'RECORDED', detail: 'Playwright retained at least one trace' }
      : { status: 'UNAVAILABLE', detail: unavailable('traces') },
    logs: logsPresent
      ? { status: 'RECORDED', detail: 'Failure analysis and/or Playwright artifacts present' }
      : { status: 'UNAVAILABLE', detail: unavailable('logs') },
    networkConsole:
      consolePresent || networkPresent
        ? { status: 'RECORDED', detail: 'analyze-failures attached console and/or network evidence' }
        : { status: 'UNAVAILABLE', detail: unavailable('network/console evidence') },
  };
}

function bindEvidenceStep(
  executeStatus: UniversalStepStatus,
  evidence: { status: 'RECORDED' | 'UNAVAILABLE'; detail: string }
): { status: UniversalStepStatus; statusReason: string } {
  if (executeStatus === 'NOT_EXECUTED') {
    return { status: 'NOT_EXECUTED', statusReason: 'Execute stages did not run — evidence was not collected' };
  }
  return { status: evidence.status, statusReason: evidence.detail };
}

function bindSuiteReport(
  stageStatus: UniversalStepStatus,
  artifactRels: string[],
  options: { recordedNeverPass?: boolean }
): { status: UniversalStepStatus; statusReason: string } {
  const found = firstExistingArtifact(artifactRels);
  if (found) {
    if (options.recordedNeverPass) {
      return { status: 'RECORDED', statusReason: `Suite runner wrote ${found} (liveness — never PASS)` };
    }
    return {
      status: stageStatus === 'FAIL' || stageStatus === 'PARTIAL' ? stageStatus : 'PASS',
      statusReason: `Suite runner wrote ${found}`,
    };
  }
  if (stageStatus === 'NOT_EXECUTED' || stageStatus === 'BLOCKED') {
    return { status: stageStatus, statusReason: 'Suite runner did not produce a report artifact' };
  }
  return { status: 'NOT_EXECUTED', statusReason: 'Report artifact missing — NOT_EXECUTED, not invented' };
}

const EVIDENCE_PENDING: EvidenceAvailability = {
  screenshots: { status: 'UNAVAILABLE', detail: 'Evidence not inspected until analyze/report stages' },
  videos: { status: 'UNAVAILABLE', detail: 'Evidence not inspected until analyze/report stages' },
  traces: { status: 'UNAVAILABLE', detail: 'Evidence not inspected until analyze/report stages' },
  logs: { status: 'UNAVAILABLE', detail: 'Evidence not inspected until analyze/report stages' },
  networkConsole: { status: 'UNAVAILABLE', detail: 'Evidence not inspected until analyze/report stages' },
};

export function shouldInspectEvidence(results: StageResult[]): boolean {
  return results.some((row) =>
    ['coverage', 'analyze', 'retest', 'allure', 'playwright-reports', 'report'].includes(row.key)
  );
}

export function bindUniversalQaFlow(input: {
  results: StageResult[];
  qualityGate: QualityGateResult;
  evidence?: EvidenceAvailability;
}): UniversalQaFlowSnapshot {
  const evidence =
    input.evidence ??
    (shouldInspectEvidence(input.results) ? inspectEvidenceAvailability() : EVIDENCE_PENDING);
  const executeStatus = worstStatus(statusesForKeys(input.results, [...EXECUTE_STAGE_KEYS]));
  const gateStatus: QualityGateStatus = input.qualityGate.status;

  const steps = UNIVERSAL_QA_STEPS.map((step): UniversalQaStepSnapshot => {
    if (step.n === 13) {
      const bound = bindEvidenceStep(executeStatus, evidence.screenshots);
      return { ...step, ...bound };
    }
    if (step.n === 14) {
      const bound = bindEvidenceStep(executeStatus, evidence.videos);
      return { ...step, ...bound };
    }
    if (step.n === 15) {
      const bound = bindEvidenceStep(executeStatus, evidence.traces);
      return { ...step, ...bound };
    }
    if (step.n === 16) {
      const analyze = asStepStatus(stageByKey(input.results, 'analyze')?.status);
      if (analyze === 'NOT_EXECUTED') {
        return { ...step, status: 'NOT_EXECUTED', statusReason: 'analyze stage was not executed' };
      }
      return { ...step, status: evidence.logs.status, statusReason: evidence.logs.detail };
    }
    if (step.n === 17) {
      const analyze = asStepStatus(stageByKey(input.results, 'analyze')?.status);
      if (analyze === 'NOT_EXECUTED') {
        return { ...step, status: 'NOT_EXECUTED', statusReason: 'analyze stage was not executed' };
      }
      return { ...step, status: evidence.networkConsole.status, statusReason: evidence.networkConsole.detail };
    }
    if (step.n === 27) {
      const bound = bindSuiteReport(asStepStatus(stageByKey(input.results, 'api')?.status), step.artifacts, {});
      return { ...step, ...bound };
    }
    if (step.n === 28) {
      const bound = bindSuiteReport(asStepStatus(stageByKey(input.results, 'performance')?.status), step.artifacts, {
        recordedNeverPass: true,
      });
      return { ...step, ...bound };
    }
    if (step.n === 30 || step.n === 31) {
      const reason =
        input.qualityGate.reasons[0]?.detail ??
        (gateStatus === 'PASS' ? 'Quality gate passed' : `Quality gate ${gateStatus}`);
      return { ...step, status: gateStatus, statusReason: reason };
    }

    const statuses = statusesForKeys(input.results, step.stageKeys);
    const status = worstStatus(statuses);
    const named = step.stageKeys
      .map((key) => {
        const row = stageByKey(input.results, key);
        return row ? `${row.key}=${row.status}` : `${key}=NOT_EXECUTED`;
      })
      .join(', ');
    return {
      ...step,
      status,
      statusReason: named || step.notes,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    command: 'qa:all',
    note: FLOW_NOTE,
    steps,
  };
}

export function formatUniversalQaFlowHeader(): string {
  const width = Math.max(...UNIVERSAL_QA_STEPS.map((step) => `${step.n}. ${step.title}`.length));
  const lines = UNIVERSAL_QA_STEPS.map((step) => {
    const label = `${step.n}. ${step.title}`.padEnd(width);
    const target =
      step.stageKeys.length > 0
        ? `${step.realization} → ${step.stageKeys.join(', ')} (${step.scripts[0] ?? 'in-process'})`
        : `${step.realization} → ${step.scripts[0] ?? 'orchestrator'}`;
    return `  ${label}  ${target}`;
  });
  return [
    'Conceptual step → actual stage / script (no extra child processes)',
    ...lines,
    '',
    FLOW_NOTE,
  ].join('\n');
}

export function formatUniversalQaFlowMarkdown(snapshot: UniversalQaFlowSnapshot): string {
  const rows = snapshot.steps.map(
    (step) =>
      `| ${step.n} | ${step.title} | ${step.realization} | ${step.stageKeys.join(', ') || '—'} | ${step.status} | ${step.statusReason.replace(/\|/g, '/')} |`
  );
  return [
    '# Universal QA flow (31 steps)',
    '',
    snapshot.note,
    '',
    '| # | Conceptual step | Realization | Stage key(s) | Status | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function childStageKeysUsedByUniversalFlow(): string[] {
  return [...new Set(UNIVERSAL_QA_STEPS.flatMap((step) => step.stageKeys))];
}
