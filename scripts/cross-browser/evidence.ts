import fs from 'fs';
import path from 'path';
import { PATHS, ROOT } from '../lib/paths';
import { toPosixRelative } from '../lib/playwright-suites';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { CrossBrowserFinding, CrossBrowserMatrixRow } from './matrix';

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function isEvidenceFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return (
    name.includes('test-failed') ||
    name.endsWith('.png') ||
    name.endsWith('.webm') ||
    name === 'trace.zip' ||
    name.endsWith('.zip')
  );
}

function copyIfExists(source: string, destDir: string): string | null {
  if (!source || source === NOT_AVAILABLE) return null;
  const abs = path.isAbsolute(source) ? source : path.resolve(ROOT, source);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const dest = path.join(destDir, path.basename(abs));
  fs.copyFileSync(abs, dest);
  return toPosixRelative(dest);
}

/**
 * Copy Playwright failure screenshots / traces / videos into reports/cross-browser/evidence.
 */
export function copyCrossBrowserEvidence(
  rows: CrossBrowserMatrixRow[],
  findings: CrossBrowserFinding[]
): string[] {
  const destDir = path.join(PATHS.reports.crossBrowser, 'evidence');
  fs.mkdirSync(destDir, { recursive: true });
  const copied = new Set<string>();

  const sources = [
    path.join(PATHS.root, 'test-results', 'playwright', 'cross-browser'),
    path.join(PATHS.root, 'test-results'),
  ];
  for (const source of sources) {
    for (const file of walkFiles(source)) {
      if (!isEvidenceFile(file)) continue;
      if (!file.replace(/\\/g, '/').includes('cross-browser') && source !== path.join(PATHS.root, 'test-results', 'playwright', 'cross-browser')) {
        continue;
      }
      const rel = path.relative(source, file).replace(/[\\/]/g, '__');
      const dest = path.join(destDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      copied.add(toPosixRelative(dest));
    }
  }

  for (const finding of findings) {
    for (const candidate of [finding.screenshotPath, finding.tracePath, finding.videoPath]) {
      const dest = copyIfExists(candidate, destDir);
      if (dest) copied.add(dest);
    }
  }

  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      if (cell.status !== 'FAIL') continue;
      for (const candidate of [cell.screenshotPath, cell.tracePath, cell.videoPath]) {
        const dest = copyIfExists(candidate, destDir);
        if (dest) copied.add(dest);
      }
    }
  }

  return [...copied];
}
