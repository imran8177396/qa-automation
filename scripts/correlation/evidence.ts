import path from 'path';
import fs from 'fs';
import { PATHS } from '../lib/paths';
import { writeJson } from '../discovery/write-json';
import type { WorkflowExecutionItem, WorkflowExecutionPlan } from './execution-plan';
import {
  FIXTURE_SELF_CHECK_ID,
  NO_DISCOVERED_XHR_AND_NO_PAIR,
  type CorrelationApplicability,
} from './applicability';

export interface CorrelationRequestEvidence {
  url: string;
  method: string;
  status: number;
}

export interface CorrelationUiAssertion {
  locator: string;
  expected: string;
  actual: string;
}

export interface RuntimeCorrelationEvidence {
  id: string;
  name: string;
  scope: 'product' | 'framework-self-check';
  status: string;
  reason?: string;
  request?: CorrelationRequestEvidence | null;
  uiAssertion?: CorrelationUiAssertion | null;
  note?: string;
}

export interface WorkflowEvidenceReport {
  generatedAt: string;
  target: string;
  correlationUsed: boolean;
  discoveredXhrCount: number;
  documentedPairCount: number;
  validPairCount: number;
  reason: string;
  suitesRemainSeparate: {
    ui: string;
    api: string;
    combined: string;
  };
  items: RuntimeCorrelationEvidence[];
  evidenceFile: string;
  findingsFile: string;
}

export function workflowEvidenceWorkDir(): string {
  return path.join(PATHS.root, 'test-results', 'workflows', 'evidence');
}

export function workflowEvidenceFile(): string {
  return path.join(PATHS.reports.workflows, 'evidence.json');
}

export function workflowFindingsFile(): string {
  return path.join(PATHS.reports.workflows, 'findings.md');
}

function safeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

export function resetWorkflowEvidenceWorkDir(): void {
  const dir = workflowEvidenceWorkDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export function recordRuntimeCorrelation(item: RuntimeCorrelationEvidence): string {
  const dest = path.join(workflowEvidenceWorkDir(), `${safeId(item.id)}.json`);
  writeJson(dest, item);
  return dest;
}

export function collectRuntimeCorrelation(): RuntimeCorrelationEvidence[] {
  const dir = workflowEvidenceWorkDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as RuntimeCorrelationEvidence);
}

function fromPlanItem(
  row: WorkflowExecutionItem,
  scope: RuntimeCorrelationEvidence['scope'] = 'product'
): RuntimeCorrelationEvidence {
  const used = row.status === 'PLANNED' && Boolean(row.apiMethod && row.apiPath);
  return {
    id: row.id,
    name: row.name,
    scope: row.id === FIXTURE_SELF_CHECK_ID ? 'framework-self-check' : scope,
    status: row.status,
    reason: row.reason,
    request: used && row.apiMethod && row.apiPath ? { url: row.apiPath, method: row.apiMethod, status: 0 } : null,
    uiAssertion: null,
    note: row.reason,
  };
}

export function buildWorkflowEvidenceReport(input: {
  target: string;
  plan: WorkflowExecutionPlan;
  applicability: CorrelationApplicability;
  runtime?: RuntimeCorrelationEvidence[];
}): WorkflowEvidenceReport {
  const runtime = input.runtime ?? collectRuntimeCorrelation();
  const byId = new Map(runtime.map((row) => [row.id, row]));
  const recorded = [...input.plan.executable, ...input.plan.gated];
  const items = recorded.map((row) => {
    const live = byId.get(row.id);
    if (live) return live;
    return fromPlanItem(row);
  });
  for (const extra of runtime) {
    if (!items.some((row) => row.id === extra.id)) items.push(extra);
  }

  const correlationUsed = items.some(
    (row) =>
      row.scope === 'product' &&
      Boolean(row.request?.url) &&
      (row.request?.status ?? 0) > 0 &&
      (row.status === 'PASS' || row.status === 'PLANNED' || row.status === 'FAIL')
  );
  const frameworkSelfCheckUsed = items.some(
    (row) =>
      row.scope === 'framework-self-check' &&
      Boolean(row.request?.url) &&
      (row.request?.status ?? 0) > 0
  );

  const reason = correlationUsed
    ? `${input.applicability.validPairs.length} correlated pair(s) produced request+UI evidence.`
    : [
        input.applicability.productCorrelation.reason || `NOT_APPLICABLE / UNCOVERED: ${NO_DISCOVERED_XHR_AND_NO_PAIR}.`,
        frameworkSelfCheckUsed
          ? 'Framework self-check produced separate fixture evidence and is not Sauce Demo coverage.'
          : null,
      ]
        .filter(Boolean)
        .join(' ');

  return {
    generatedAt: new Date().toISOString(),
    target: input.target,
    correlationUsed,
    discoveredXhrCount: input.applicability.discoveredXhrCount,
    documentedPairCount: input.applicability.documentedPairCount,
    validPairCount: input.applicability.validPairs.length,
    reason,
    suitesRemainSeparate: {
      ui: 'test:e2e / test:ui',
      api: 'test:api',
      combined: 'test:workflows',
    },
    items,
    evidenceFile: path.relative(PATHS.root, workflowEvidenceFile()).replace(/\\/g, '/'),
    findingsFile: path.relative(PATHS.root, workflowFindingsFile()).replace(/\\/g, '/'),
  };
}

export function renderWorkflowFindingsMarkdown(report: WorkflowEvidenceReport): string {
  const lines = [
    '# Combined UI+API correlation evidence',
    '',
    report.correlationUsed
      ? 'Product UI↔API correlation was used. Each executed pair records request URL/method/status plus the UI assertion.'
      : `Product UI↔API correlation was not used. Evidence is the explicit N/A reason: ${report.reason}`,
    '',
    `- Target: ${report.target}`,
    `- Discovered xhr/fetch/websocket: ${report.discoveredXhrCount}`,
    `- Documented workflows.correlated pairs: ${report.documentedPairCount}`,
    `- Valid executable pairs: ${report.validPairCount}`,
    `- Correlation used: ${report.correlationUsed ? 'yes' : 'no'}`,
    `- Suites remain separate: UI \`${report.suitesRemainSeparate.ui}\`, API \`${report.suitesRemainSeparate.api}\`, combined \`${report.suitesRemainSeparate.combined}\``,
    '',
    '| ID | Scope | Status | Request | UI assertion | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const item of report.items) {
    const request = item.request
      ? `${item.request.method} ${item.request.url}${item.request.status ? ` → ${item.request.status}` : ''}`
      : 'N/A';
    const ui = item.uiAssertion
      ? `${item.uiAssertion.locator} expected ${item.uiAssertion.expected}, actual ${item.uiAssertion.actual}`
      : 'N/A';
    lines.push(
      `| ${item.id} | ${item.scope} | ${item.status} | ${request} | ${ui} | ${item.reason ?? item.note ?? ''} |`
    );
  }

  lines.push(
    '',
    'Sauce Demo REST paths are never invented. JSONPlaceholder is not forced into Sauce Demo UI tests.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

export function writeWorkflowEvidenceReport(report: WorkflowEvidenceReport): WorkflowEvidenceReport {
  fs.mkdirSync(PATHS.reports.workflows, { recursive: true });
  writeJson(workflowEvidenceFile(), report);
  fs.writeFileSync(workflowFindingsFile(), renderWorkflowFindingsMarkdown(report), 'utf8');
  return report;
}
