export type DependencySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface DependencyFinding {
  status: 'PASS' | 'FAIL' | 'NOTE' | 'NOT_APPLICABLE';
  rule: string;
  severity: DependencySeverity;
  detail: string;
  source: 'npm-audit' | 'secret-scan';
  package?: string;
  path?: string;
  expected?: string;
  actual?: string;
}

export interface DependencySummary {
  generatedAt: string;
  passed: boolean;
  failCount: number;
  passCount: number;
  noteCount: number;
  packagesScanned: number;
  filesScanned: number;
  failOnSeverity: 'critical' | 'high' | 'medium';
  bySeverity: Record<DependencySeverity, number>;
  findings: DependencyFinding[];
  disclaimer: string;
  limitations: string[];
  auditError?: string;
}

export const DEPENDENCY_DISCLAIMER =
  'This is QA-LEVEL DEPENDENCY AND SECRETS VALIDATION (npm audit advisories plus a pattern-based secrets scan of tracked source files). It is not a full software-composition-analysis license audit, and a clean result is not a guarantee that no secret exists anywhere in git history.';

export const DEPENDENCY_LIMITATIONS = [
  'npm audit reflects the public advisory database at run time — a clean run today does not guarantee tomorrow',
  'Secret scan is pattern-based over the current working tree only — it does not scan git history or binary files',
  'A vulnerable transitive dependency with no reachable code path is still reported (never silently dropped)',
  'Generic credential-assignment matches are heuristic (NOTE severity) and may include false positives — they are not auto-blocking',
];
