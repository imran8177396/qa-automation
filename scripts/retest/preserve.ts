import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { toPosixRelative } from '../lib/playwright-suites';

export interface PreserveResult {
  originalRoot: string;
  copied: string[];
  failuresPreserved: boolean;
}

export const ORIGINAL_EVIDENCE_RELATIVE = 'reports/retest/original/failures';

/** Copy a directory tree. Never deletes `source`. Returns false when source is absent. */
export function snapshotDirectory(source: string, destination: string): boolean {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.cpSync(source, destination, { recursive: true });
  return true;
}

/** Replace `destination` with a previously snapshotted tree. No-op when snapshot is absent. */
export function restoreDirectory(snapshot: string, destination: string): void {
  if (!fs.existsSync(snapshot)) return;
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(snapshot, destination, { recursive: true });
}

export function originalEvidenceDir(): string {
  return path.join(PATHS.reports.retest, 'original');
}

export function preserveTargets(): Array<{ name: string; source: string }> {
  return [
    { name: 'failures', source: PATHS.reports.failures },
    { name: 'security', source: PATHS.reports.security },
    { name: 'seo', source: PATHS.reports.seo },
    { name: 'content', source: PATHS.reports.content },
    { name: 'dependencies', source: PATHS.reports.dependencies },
    { name: 'accessibility', source: PATHS.reports.accessibility },
    { name: 'playwright-accessibility', source: path.join(PATHS.reports.playwright, 'accessibility') },
    { name: 'playwright-cross-browser', source: path.join(PATHS.reports.playwright, 'cross-browser') },
    { name: 'playwright-e2e', source: path.join(PATHS.reports.playwright, 'e2e') },
  ];
}

/**
 * Copy original FAIL analysis and referenced stage reports under reports/retest/original/.
 * Never deletes reports/failures or historical docs/input|output/qa-test-results packs.
 */
export function preserveOriginalFailureEvidence(): PreserveResult {
  const originalRoot = originalEvidenceDir();
  fs.mkdirSync(originalRoot, { recursive: true });
  const copied: string[] = [];

  for (const target of preserveTargets()) {
    const destination = path.join(originalRoot, target.name);
    if (snapshotDirectory(target.source, destination)) copied.push(target.name);
  }

  return {
    originalRoot: toPosixRelative(originalRoot),
    copied,
    failuresPreserved: copied.includes('failures') && fs.existsSync(PATHS.reports.failures),
  };
}

export function restoreLiveReportsFromOriginal(names?: string[]): void {
  const restore = names ?? preserveTargets().map((row) => row.name).filter((name) => name !== 'failures');
  const targets = preserveTargets();
  for (const name of restore) {
    const target = targets.find((row) => row.name === name);
    if (!target || target.name === 'failures') continue;
    restoreDirectory(path.join(originalEvidenceDir(), target.name), target.source);
  }
}

export function originalFailuresStillPresent(): boolean {
  return fs.existsSync(path.join(PATHS.reports.failures, 'summary.json'));
}
