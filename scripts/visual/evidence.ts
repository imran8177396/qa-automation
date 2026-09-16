import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';

const EVIDENCE_NAME = /-(actual|diff|expected)\.png$/i;
const FAILED_SHOT = /test-failed.*\.png$/i;

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
  const name = path.basename(filePath);
  return EVIDENCE_NAME.test(name) || FAILED_SHOT.test(name);
}

/**
 * Copy Playwright actual/diff (and failure screenshots) into reports/visual/evidence.
 * Does not write or replace golden baselines.
 */
export function copyVisualEvidence(): string[] {
  const destDir = path.join(PATHS.reports.visual, 'evidence');
  fs.mkdirSync(destDir, { recursive: true });

  const sources = [path.join(PATHS.root, 'test-results', 'visual'), PATHS.visualBaselinesDir];
  const copied: string[] = [];

  for (const source of sources) {
    for (const file of walkFiles(source)) {
      if (!isEvidenceFile(file)) continue;
      const rel = path.relative(source, file).replace(/[\\/]/g, '__');
      const dest = path.join(destDir, rel);
      fs.copyFileSync(file, dest);
      copied.push(dest);
    }
  }

  return copied;
}
