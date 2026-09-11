import fs from 'fs';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import type { QaConfig } from '../../types';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export interface ReportSignOff {
  preparerName: string;
  preparerRole: string;
  reviewerName: string;
  reviewerRole: string;
  approvalDate: string;
  distribution: string;
  confidentiality: string;
}

export interface ReportRevision {
  version: string;
  date: string;
  author: string;
  summary: string;
}

export interface ReportCriteria {
  entry: string[];
  exit: string[];
  severity: Record<string, string>;
  releaseBlocking: string[];
}

export interface ReportRetention {
  keepHistoricalTimestampFolders: boolean;
  updateLatestManifest: boolean;
  note: string;
}

export interface ReportConfigExtras {
  signOff: ReportSignOff;
  revisionHistory: ReportRevision[];
  criteria: ReportCriteria;
  retention: ReportRetention;
}

/** Conservative values already documented in reporting.mdc — not invented SLAs. */
const DEFAULT_CRITERIA: ReportCriteria = {
  entry: [
    'Target URL is configured in qa.config.json and reachable, or the run is explicitly fixture-scoped.',
    'Required tools (Playwright, Postman CLI, JMeter when enabled) are present or the stage is recorded NOT_EXECUTED.',
    'Discovery inventory exists before generated UI checks execute.',
  ],
  exit: [
    'No open P0 or P1 application blockers remain (reporting.mdc: never PASS while a P0 or P1 application blocker remains open).',
    'Critical-path checks that ran have a recorded outcome (PASS, FAIL, BLOCKED, NOT_TESTED, or REQUIRES_CONFIGURATION).',
    'Coverage, failures, and untested items are disclosed from reports/ artifacts — never fabricated.',
  ],
  severity: {
    P0: 'Release-blocking application defect on a critical path (reporting.mdc FAIL).',
    P1: 'High-severity application defect or broken critical path (reporting.mdc FAIL; broken links and auth failures are typically P1).',
    P2: 'Medium issue or documented gap (reporting.mdc PASS WITH OBSERVATIONS).',
    P3: 'Low issue or observation (reporting.mdc PASS WITH OBSERVATIONS).',
  },
  releaseBlocking: ['P0', 'P1'],
};

const DEFAULT_RETENTION_NOTE =
  'Previous dated packs under docs/input|output/qa-test-results/ are retained. Each run writes a new YYYY-MM-DD_HH-MM-SS folder (suffix -2, -3, … on collision). latest.json may be updated to point at the newest pack.';

const DEFAULT_RETENTION: ReportRetention = {
  keepHistoricalTimestampFolders: true,
  updateLatestManifest: true,
  note: DEFAULT_RETENTION_NOTE,
};

const DEFAULT_SIGN_OFF: ReportSignOff = {
  preparerName: '',
  preparerRole: 'Senior QA Automation Engineer',
  reviewerName: '',
  reviewerRole: '',
  approvalDate: '',
  distribution: '',
  confidentiality: '',
};

function emptyToBlank(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function mergeReportConfigExtras(config: QaConfig): {
  config: QaConfig;
  extras: ReportConfigExtras;
  wrote: boolean;
} {
  const report = { ...(config.report ?? { enabled: true, format: 'docs/templates/qa-test-results.format.json', autoGenerateAfterTests: true }) };
  let wrote = false;

  const existingSignOff = (report as { signOff?: Partial<ReportSignOff> }).signOff;
  if (!existingSignOff) {
    (report as { signOff: ReportSignOff }).signOff = { ...DEFAULT_SIGN_OFF };
    wrote = true;
  } else {
    (report as { signOff: ReportSignOff }).signOff = {
      preparerName: emptyToBlank(existingSignOff.preparerName),
      preparerRole: emptyToBlank(existingSignOff.preparerRole) || DEFAULT_SIGN_OFF.preparerRole,
      reviewerName: emptyToBlank(existingSignOff.reviewerName),
      reviewerRole: emptyToBlank(existingSignOff.reviewerRole),
      approvalDate: emptyToBlank(existingSignOff.approvalDate),
      distribution: emptyToBlank(existingSignOff.distribution),
      confidentiality: emptyToBlank(existingSignOff.confidentiality),
    };
  }

  const existingHistory = (report as { revisionHistory?: ReportRevision[] }).revisionHistory;
  if (!existingHistory) {
    (report as { revisionHistory: ReportRevision[] }).revisionHistory = [
      {
        version: '1.1',
        date: NOT_AVAILABLE,
        author: NOT_AVAILABLE,
        summary: 'Five-layer enterprise QA report format already used by this generator.',
      },
    ];
    wrote = true;
  }

  const existingRetention = (report as { retention?: Partial<ReportRetention> }).retention;
  if (!existingRetention) {
    (report as { retention: ReportRetention }).retention = { ...DEFAULT_RETENTION };
    wrote = true;
  } else {
    (report as { retention: ReportRetention }).retention = {
      keepHistoricalTimestampFolders: existingRetention.keepHistoricalTimestampFolders !== false,
      updateLatestManifest: existingRetention.updateLatestManifest !== false,
      note: existingRetention.note?.trim() ? existingRetention.note : DEFAULT_RETENTION.note,
    };
    if (
      existingRetention.keepHistoricalTimestampFolders === undefined ||
      existingRetention.updateLatestManifest === undefined ||
      !existingRetention.note?.trim()
    ) {
      wrote = true;
    }
  }

  const existingCriteria = (report as { criteria?: Partial<ReportCriteria> }).criteria;
  if (!existingCriteria) {
    (report as { criteria: ReportCriteria }).criteria = { ...DEFAULT_CRITERIA, severity: { ...DEFAULT_CRITERIA.severity } };
    wrote = true;
  } else {
    (report as { criteria: ReportCriteria }).criteria = {
      entry: existingCriteria.entry?.length ? existingCriteria.entry : DEFAULT_CRITERIA.entry,
      exit: existingCriteria.exit?.length ? existingCriteria.exit : DEFAULT_CRITERIA.exit,
      severity:
        existingCriteria.severity && Object.keys(existingCriteria.severity).length > 0
          ? existingCriteria.severity
          : { ...DEFAULT_CRITERIA.severity },
      releaseBlocking:
        existingCriteria.releaseBlocking?.length ? existingCriteria.releaseBlocking : DEFAULT_CRITERIA.releaseBlocking,
    };
    if (!existingCriteria.entry?.length || !existingCriteria.exit?.length || !existingCriteria.releaseBlocking?.length) {
      wrote = true;
    }
  }

  const merged: QaConfig = { ...config, report: report as QaConfig['report'] };
  const extras: ReportConfigExtras = {
    signOff: (report as { signOff: ReportSignOff }).signOff,
    revisionHistory: (report as { revisionHistory: ReportRevision[] }).revisionHistory,
    criteria: (report as { criteria: ReportCriteria }).criteria,
    retention: (report as { retention: ReportRetention }).retention,
  };
  return { config: merged, extras, wrote };
}

export function ensureReportConfigWritten(): { extras: ReportConfigExtras; wrote: boolean } {
  const current = loadConfig();
  const { extras, wrote } = mergeReportConfigExtras(current);
  if (!wrote) return { extras, wrote };

  const raw = JSON.parse(fs.readFileSync(PATHS.config, 'utf8')) as Record<string, unknown>;
  const report = { ...((raw.report as Record<string, unknown> | undefined) ?? {}) };
  if (!report.signOff) report.signOff = extras.signOff;
  if (!report.revisionHistory) report.revisionHistory = extras.revisionHistory;
  if (!report.criteria) report.criteria = extras.criteria;
  if (!report.retention) report.retention = extras.retention;
  raw.report = report;
  fs.writeFileSync(PATHS.config, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { extras, wrote: true };
}

export function isReviewerUnset(signOff: ReportSignOff): boolean {
  return !signOff.reviewerName.trim();
}

export function formatPreparedBy(signOff: ReportSignOff): string {
  const name = signOff.preparerName.trim();
  const role = signOff.preparerRole.trim();
  if (name && role) return `${name} (${role})`;
  if (name) return name;
  if (role) return `${NOT_AVAILABLE} (${role})`;
  return NOT_AVAILABLE;
}

export function formatReviewedBy(signOff: ReportSignOff): string {
  if (isReviewerUnset(signOff)) return 'PENDING REVIEW';
  const role = signOff.reviewerRole.trim();
  return role ? `${signOff.reviewerName.trim()} (${role})` : signOff.reviewerName.trim();
}
