import { execFileSync } from 'child_process';
import { PATHS } from '../lib/paths';
import type { DependencyFinding, DependencySeverity } from './types';

type NpmSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

interface NpmAuditVia {
  title?: string;
  url?: string;
  source?: number;
}

interface NpmAuditVulnerability {
  name: string;
  severity: NpmSeverity;
  range?: string;
  via?: Array<string | NpmAuditVia>;
  fixAvailable?: boolean | { name: string; version: string };
}

interface NpmAuditJson {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  metadata?: {
    dependencies?: { total?: number; prod?: number; dev?: number };
  };
}

function mapSeverity(severity: NpmSeverity): DependencySeverity {
  if (severity === 'moderate') return 'medium';
  return severity;
}

export interface NpmAuditResult {
  findings: DependencyFinding[];
  packagesScanned: number;
  error?: string;
}

/**
 * `npm audit --json` exits non-zero when vulnerabilities exist, but still
 * writes the report to stdout — execFileSync throws in that case, so the
 * report has to be read off the thrown error rather than the return value.
 */
export function runNpmAudit(): NpmAuditResult {
  let stdout: string;
  try {
    stdout = execFileSync('npm', ['audit', '--json'], {
      cwd: PATHS.root,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch (error) {
    const err = error as { stdout?: unknown; message?: string };
    if (typeof err.stdout === 'string' && err.stdout.length > 0) {
      stdout = err.stdout;
    } else {
      return { findings: [], packagesScanned: 0, error: err.message ?? String(error) };
    }
  }

  let parsed: NpmAuditJson;
  try {
    parsed = JSON.parse(stdout) as NpmAuditJson;
  } catch (error) {
    return { findings: [], packagesScanned: 0, error: `Could not parse npm audit output: ${String(error)}` };
  }

  const findings: DependencyFinding[] = [];
  const vulnerabilities = parsed.vulnerabilities ?? {};

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const severity = mapSeverity(entry.severity);
    const advisoryTitles = (entry.via ?? [])
      .map((via) => (typeof via === 'string' ? null : via.title))
      .filter((title): title is string => Boolean(title));
    const detail =
      advisoryTitles.length > 0
        ? `${name}: ${advisoryTitles.join('; ')}`
        : `${name}: known advisory chain (severity ${entry.severity})`;

    findings.push({
      status: severity === 'info' ? 'NOTE' : 'FAIL',
      rule: 'npm-audit-advisory',
      severity,
      detail,
      source: 'npm-audit',
      package: name,
      expected: 'no known advisories',
      actual: `${entry.severity}${entry.range ? ` (${entry.range})` : ''}${entry.fixAvailable ? ' — fix available' : ''}`,
    });
  }

  const packagesScanned = parsed.metadata?.dependencies?.total ?? Object.keys(vulnerabilities).length;
  return { findings, packagesScanned };
}
