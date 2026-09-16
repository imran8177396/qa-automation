import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import { NOT_AVAILABLE } from '../lib/suite-origin';

const SOURCE_HINTS: Record<string, string[]> = {
  accessibility: ['tests/e2e/accessibility'],
  'cross-browser': ['tests/e2e'],
  e2e: ['tests/e2e'],
  playwright: ['tests/e2e'],
  'generated-check': ['tests/e2e/generated', 'tests/e2e'],
  workflows: ['tests/e2e/workflows'],
  visual: ['tests/e2e/visual'],
  responsive: ['tests/e2e/responsive'],
};

function existsFile(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

function walkForBasename(dir: string, basename: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'reports') continue;
      const nested = walkForBasename(full, basename);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === basename) {
      return full;
    }
  }
  return null;
}

function isPlaywrightSpec(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename.endsWith('.spec.ts') || basename.endsWith('.spec.js');
}

/** Resolve a Playwright spec path from analysis evidence (full path or basename). */
export function resolveSpecFile(specFile: string, source: string): string | null {
  if (!specFile || specFile === NOT_AVAILABLE) return null;
  if (!isPlaywrightSpec(specFile)) return null;
  if (existsFile(specFile)) return specFile;

  const fromRoot = path.join(PATHS.root, specFile);
  if (existsFile(fromRoot)) return fromRoot;

  const basename = path.basename(specFile);

  const hints = SOURCE_HINTS[source] ?? ['tests/e2e', 'tests'];
  for (const hint of hints) {
    const candidate = path.join(PATHS.root, hint, basename);
    if (existsFile(candidate)) return candidate;
  }

  return walkForBasename(path.join(PATHS.root, 'tests'), basename);
}
