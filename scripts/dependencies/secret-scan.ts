import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import type { DependencyFinding, DependencySeverity } from './types';

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.json', '.yml', '.yaml']);

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'reports',
  'visual-baselines',
  'docs',
  'test-results',
  'playwright-report',
  'dist',
  'build',
  'coverage',
  '.cursor',
]);

const EXCLUDED_FILE_NAMES = new Set(['package-lock.json']);

/** Values that look like placeholders rather than real secrets. */
const PLACEHOLDER_VALUE = /^(your[_-]?|change[_-]?me|replace[_-]?me|example|sample|placeholder|<|\$\{|xxx+|todo|none|null|""|'')/i;

interface SecretRule {
  id: string;
  severity: DependencySeverity;
  /** Returns the (redacted) matched excerpt, or null if the line doesn't match. */
  test: (line: string) => string | null;
}

const SECRET_RULES: SecretRule[] = [
  {
    id: 'aws-access-key-id',
    severity: 'critical',
    test: (line) => line.match(/AKIA[0-9A-Z]{16}/)?.[0] ?? null,
  },
  {
    id: 'github-token',
    severity: 'critical',
    test: (line) => line.match(/gh[pousr]_[A-Za-z0-9]{36,}/)?.[0] ?? null,
  },
  {
    id: 'slack-token',
    severity: 'high',
    test: (line) => line.match(/xox[baprs]-[A-Za-z0-9-]{10,}/)?.[0] ?? null,
  },
  {
    id: 'private-key-block',
    severity: 'critical',
    test: (line) => (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line) ? 'PEM private key header' : null),
  },
  {
    id: 'hardcoded-credential-assignment',
    severity: 'medium',
    test: (line) => {
      const match = line.match(/\b(SECRET|PASSWORD|API_KEY|ACCESS_TOKEN|PRIVATE_KEY)\w*\s*[:=]\s*['"]?([^'"\s]{12,})['"]?/i);
      if (!match) return null;
      const value = match[2];
      if (PLACEHOLDER_VALUE.test(value)) return null;
      // Require some variety in the value so we don't flag repeated filler
      // (e.g. "xxxxxxxxxxxx") or config keywords that happen to be long.
      if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) return null;
      return `${match[1]}=${value.slice(0, 4)}…(redacted, ${value.length} chars)`;
    },
  },
];

function walk(dir: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const isDotfile = entry.name.startsWith('.') && entry.name !== '.env';
    if (isDotfile) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(fullPath, files);
    } else if (entry.isFile()) {
      if (EXCLUDED_FILE_NAMES.has(entry.name)) continue;
      const ext = path.extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext) || entry.name === '.env') files.push(fullPath);
    }
  }
  return files;
}

export interface SecretScanResult {
  findings: DependencyFinding[];
  filesScanned: number;
}

/** Scans the tracked working tree only — not git history, not binaries. */
export function runSecretScan(): SecretScanResult {
  const files = walk(PATHS.root);
  const findings: DependencyFinding[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = path.relative(PATHS.root, filePath).split(path.sep).join('/');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const rule of SECRET_RULES) {
        const match = rule.test(line);
        if (!match) continue;
        findings.push({
          status: rule.severity === 'medium' ? 'NOTE' : 'FAIL',
          rule: rule.id,
          severity: rule.severity,
          detail: `Possible ${rule.id.replace(/-/g, ' ')} in ${relativePath}:${index + 1}`,
          source: 'secret-scan',
          path: `${relativePath}:${index + 1}`,
          actual: match,
        });
      }
    });
  }

  return { findings, filesScanned: files.length };
}
