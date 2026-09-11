export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export function classifySeverity(input: {
  classification?: string;
  severity?: 'high' | 'medium' | 'low';
}): Severity {
  const classification = input.classification ?? '';
  if (classification === 'APPLICATION DEFECT') {
    if (input.severity === 'high') return 'P1';
    if (input.severity === 'medium') return 'P2';
    return 'P3';
  }
  if (classification === 'AUTOMATION DEFECT' || classification === 'CONFIGURATION DEFECT') return 'P2';
  if (classification === 'ENVIRONMENT DEFECT' || classification === 'NETWORK ISSUE') return 'P2';
  if (input.severity === 'high') return 'P1';
  if (input.severity === 'medium') return 'P2';
  return 'P3';
}

export function isReleaseBlocker(severity: Severity): boolean {
  return severity === 'P0' || severity === 'P1';
}
