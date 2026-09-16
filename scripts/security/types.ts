export type SecurityFindingStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'NOTE'
  | 'NOT_TESTED'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

export interface SecurityFinding {
  status: SecurityFindingStatus;
  rule: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  detail: string;
  page?: string;
  pagePath?: string;
  expected?: string;
  actual?: string;
}

export interface SecuritySummary {
  generatedAt: string;
  target: string | null;
  passed: boolean;
  failCount: number;
  passCount: number;
  noteCount: number;
  warningCount: number;
  notTestedCount: number;
  blockedCount: number;
  pagesAnalyzed: number;
  originsAnalyzed: number;
  bySeverity: Record<'high' | 'medium' | 'low' | 'info', number>;
  findings: SecurityFinding[];
  disclaimer: string;
  limitations: string[];
}

export const SECURITY_DISCLAIMER =
  'This is QA-LEVEL SECURITY VALIDATION (headers, cookies, and exposure indicators). It is not a penetration test, vulnerability assessment, or authorization to exploit the target.';

export const SECURITY_LIMITATIONS = [
  'Observational GETs only — no attack payloads',
  'Forms are never submitted',
  'Missing rate-limit headers are NOTE, never a flood test',
  'One GET per path in the fixed WELL_KNOWN_PATHS list',
  'Cookie and CSRF checks run only on observed cookies/forms',
  'Error disclosure observes existing responses — 500s are not forced',
  'Documented API hygiene is HTTPS/headers only — not a pentest',
];
