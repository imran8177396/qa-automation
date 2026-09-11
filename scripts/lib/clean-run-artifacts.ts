import fs from 'fs';
import path from 'path';
import { PATHS } from './paths';
import { generateReportsFolders } from '../generators/index';

const KEEP_ARTIFACTS_FLAG = '--keep-artifacts';

export function shouldKeepArtifacts(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(KEEP_ARTIFACTS_FLAG);
}

/**
 * Ephemeral runtime artifacts only.
 * Never source specs, qa.config.json, visual baselines, or historical
 * professional packs under docs/input|output/qa-test-results/.
 */
export function listRunArtifactTargets(): string[] {
  return [
    PATHS.reports.root,
    path.join(PATHS.root, 'test-results'),
    path.join(PATHS.root, 'blob-report'),
    path.join(PATHS.root, 'playwright-report'),
    path.join(PATHS.root, 'temp'),
    PATHS.generatedEnv,
    PATHS.pageMapFile,
    PATHS.uiInventoryFile,
    PATHS.workflowInventoryFile,
    PATHS.apiInventoryFile,
    PATHS.testInventoryDoc,
    PATHS.coverageMatrixDoc,
    PATHS.uncoveredItemsDoc,
    path.join(PATHS.root, 'jmeter.log'),
    path.join(PATHS.root, 'reports', 'summary.json'),
  ];
}

/** Historical Word/HTML/PDF packs — qa:clean must never remove these trees. */
export function isHistoricalQaReportPath(target: string): boolean {
  const resolved = path.resolve(target);
  const prefixes = [PATHS.docsQaTestResultsInput, PATHS.docsQaTestResultsOutput].map((dir) =>
    path.resolve(dir)
  );
  return prefixes.some((prefix) => resolved === prefix || resolved.startsWith(prefix + path.sep));
}

function assertSafeTarget(target: string): void {
  const resolved = path.resolve(target);
  const root = path.resolve(PATHS.root);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to remove path outside the project: ${resolved}`);
  }
  const relative = path.relative(root, resolved).replace(/\\/g, '/');
  const forbidden = [
    'pages',
    'tests/e2e',
    'scripts',
    'qa.config.json',
    'node_modules',
    'visual-baselines',
    'fixtures',
    '.git',
  ];
  if (forbidden.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
    throw new Error(`Refusing to remove source or protected path: ${relative}`);
  }
  if (isHistoricalQaReportPath(resolved)) {
    throw new Error(`Refusing to remove historical professional QA report path: ${relative}`);
  }
}

function removeIfExists(target: string, removed: string[]): void {
  assertSafeTarget(target);
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(path.relative(PATHS.root, target).replace(/\\/g, '/'));
}

function removeVisualDiffs(removed: string[]): void {
  const root = PATHS.visualBaselinesDir;
  if (!fs.existsSync(root)) return;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('-actual.png') || entry.name.endsWith('-diff.png')) {
        removeIfExists(full, removed);
      }
    }
  };
  walk(root);
}

function removeDiscoveryJson(removed: string[]): void {
  if (!fs.existsSync(PATHS.discoveryDir)) return;
  for (const entry of fs.readdirSync(PATHS.discoveryDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      removeIfExists(path.join(PATHS.discoveryDir, entry.name), removed);
    }
  }
}

export function cleanRunArtifacts(): { removed: string[] } {
  const removed: string[] = [];
  for (const target of listRunArtifactTargets()) {
    removeIfExists(target, removed);
  }
  removeDiscoveryJson(removed);
  removeVisualDiffs(removed);
  generateReportsFolders();
  return { removed };
}
