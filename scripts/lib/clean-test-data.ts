import fs from 'fs';
import path from 'path';
import { PATHS } from './paths';
import { generateReportsFolders } from '../generators/index';
import { logError, logStep, logSuccess } from './logger';

const KEEP_ARTIFACTS_FLAG = '--keep-artifacts';

/**
 * TEMPORARY / CURRENT-RUN paths only (posix, relative to project root).
 * Never include reports/, reports/history, reports/allure, reports/allure/history,
 * or docs/input|output/qa-test-results.
 */
export const CLEAN_ALLOWLIST_RELATIVE = [
  'reports/allure/results',
  'reports/allure/report',
  'reports/postman',
  'reports/jmeter',
  'reports/lighthouse',
  'reports/performance',
  'reports/playwright',
  'reports/visual',
  'reports/responsive',
  'reports/cross-browser',
  'reports/accessibility',
  'reports/workflows',
  'reports/security',
  'reports/dependencies',
  'reports/seo',
  'reports/content',
  'reports/integration',
  'reports/contract',
  'reports/database',
  'reports/smoke',
  'reports/sanity',
  'reports/regression',
  'reports/reliability',
  'reports/resilience',
  'reports/deployment',
  'reports/localization',
  'reports/ai',
  'reports/production-verification',
  'reports/failures',
  'reports/retest',
  'reports/summary',
  'reports/orchestrator',
  'reports/discovery',
  'reports/quality',
  'reports/coverage',
  'reports/evidence',
  'reports/summary.json',
  'reports/preflight.json',
  'test-results',
  'blob-report',
  'playwright-report',
  'screenshots',
  'traces',
  'temp',
  'playwright/.cache',
  'playwright/.auth',
  'config/generated.env',
  'discovery/page-map.json',
  'discovery/ui-inventory.json',
  'discovery/workflow-inventory.json',
  'discovery/api-inventory.json',
  'discovery/discovery-inventory.json',
  'docs/test-inventory.md',
  'docs/coverage-matrix.md',
  'docs/uncovered-test-items.md',
  'jmeter.log',
] as const;

const HISTORICAL_PREFIXES = [
  'docs/input/qa-test-results',
  'docs/output/qa-test-results',
  'reports/history',
  'reports/allure/history',
] as const;

const PROTECTED_PREFIXES = [
  '.git',
  '.cursor',
  '.github',
  'jenkins',
  'visual-baselines',
  'pages',
  'tests',
  'scripts',
  'docs',
  'utils',
  'fixtures',
  'node_modules',
  'package-lock.json',
  'package.json',
  'qa.config.json',
  'qa.last-target.json',
  '.env.example',
  '.env',
] as const;

export interface CleanTestDataResult {
  removed: string[];
  skipped: string[];
}

export function shouldKeepArtifacts(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(KEEP_ARTIFACTS_FLAG);
}

function pathsEqual(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function projectRoot(): string {
  return path.resolve(PATHS.root);
}

/** process.cwd() is the project root; must match PATHS.root (no second root). */
export function resolveCleanupRoot(): string {
  const cwd = path.resolve(process.cwd());
  const root = projectRoot();
  if (!pathsEqual(cwd, root)) {
    throw new Error(
      `qa:clean must run from the project root. process.cwd()=${cwd} PATHS.root=${root}`
    );
  }
  return cwd;
}

export function toPosixRelative(target: string, root: string = projectRoot()): string {
  return path.relative(path.resolve(root), path.resolve(target)).replace(/\\/g, '/');
}

export function listCleanAllowlistTargets(): string[] {
  const root = projectRoot();
  return CLEAN_ALLOWLIST_RELATIVE.map((relative) => path.join(root, ...relative.split('/')));
}

export function isHistoricalArtifactPath(target: string): boolean {
  const relative = toPosixRelative(target);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    return false;
  }
  return HISTORICAL_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function isInsideProject(target: string): boolean {
  const relative = toPosixRelative(target);
  return relative !== '' && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
}

function isReportsTreeWipe(relative: string): boolean {
  return relative === 'reports' || relative === 'reports/allure';
}

function isTempDiscoveryJson(target: string): boolean {
  const relative = toPosixRelative(target);
  if (!relative.startsWith('discovery/') || !relative.endsWith('.json')) return false;
  const rest = relative.slice('discovery/'.length);
  return rest.length > 0 && !rest.includes('/');
}

function isVisualDiffArtifact(target: string): boolean {
  const relative = toPosixRelative(target);
  return (
    relative.startsWith('visual-baselines/') &&
    (relative.endsWith('-actual.png') || relative.endsWith('-diff.png'))
  );
}

export function isAllowlistedCleanTarget(target: string): boolean {
  const resolved = path.resolve(target);
  if (listCleanAllowlistTargets().some((entry) => pathsEqual(entry, resolved))) {
    return true;
  }
  return isTempDiscoveryJson(resolved) || isVisualDiffArtifact(resolved);
}

function isProtectedPath(relative: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

export function assertSafeCleanTarget(target: string): void {
  const resolved = path.resolve(target);
  const relative = toPosixRelative(resolved);

  if (!isInsideProject(resolved)) {
    throw new Error(`Refusing to remove path outside the project: ${resolved}`);
  }
  if (isHistoricalArtifactPath(resolved)) {
    throw new Error(`Refusing to remove historical QA report path: ${relative}`);
  }
  if (isReportsTreeWipe(relative)) {
    throw new Error(
      `Refusing to remove ${relative} (would wipe archived report history under reports/history or reports/allure/history)`
    );
  }
  if (isAllowlistedCleanTarget(resolved)) {
    return;
  }
  if (isProtectedPath(relative)) {
    throw new Error(`Refusing to remove source or protected path: ${relative}`);
  }
  throw new Error(`Unexpected cleanup path (not on allowlist): ${relative}`);
}

export function assertNoCliDeletionTargets(argv: string[]): void {
  const extras = argv.filter((arg) => arg !== '' && arg !== '--');
  if (extras.length > 0) {
    throw new Error(
      `qa:clean does not accept deletion paths from the CLI. Refused: ${extras.join(', ')}`
    );
  }
}

function removeIfExists(target: string, removed: string[], skipped: string[]): void {
  assertSafeCleanTarget(target);
  const relative = toPosixRelative(target);
  if (!fs.existsSync(target)) {
    skipped.push(relative);
    return;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Required cleanup failed for ${relative}: ${message}`);
  }
  removed.push(relative);
}

function removeVisualDiffs(removed: string[], skipped: string[]): void {
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
        removeIfExists(full, removed, skipped);
      }
    }
  };
  walk(root);
}

function removeDiscoveryJson(removed: string[], skipped: string[]): void {
  if (!fs.existsSync(PATHS.discoveryDir)) return;
  for (const entry of fs.readdirSync(PATHS.discoveryDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const full = path.join(PATHS.discoveryDir, entry.name);
      if (!fs.existsSync(full)) continue;
      if (removed.includes(toPosixRelative(full))) continue;
      removeIfExists(full, removed, skipped);
    }
  }
}

export function cleanTestData(): CleanTestDataResult {
  resolveCleanupRoot();
  const targets = listCleanAllowlistTargets();
  for (const target of targets) {
    assertSafeCleanTarget(target);
  }

  const removed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    removeIfExists(target, removed, skipped);
  }
  removeDiscoveryJson(removed, skipped);
  removeVisualDiffs(removed, skipped);
  generateReportsFolders();
  return { removed, skipped };
}

export function runCleanTestDataCli(argv: string[] = process.argv.slice(2)): void {
  try {
    assertNoCliDeletionTargets(argv);
    logStep('Cleaning temporary test data (preserving historical reports)');
    const { removed, skipped } = cleanTestData();
    for (const entry of removed) {
      console.log(`DELETED  ${entry}`);
    }
    for (const entry of skipped) {
      console.log(`SKIPPED  ${entry} (not present)`);
    }
    if (removed.length === 0) {
      logSuccess('No previous temporary artifacts were present');
      return;
    }
    logSuccess(
      `Removed ${removed.length} temporary artifact path(s); skipped ${skipped.length} missing path(s)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    process.exit(1);
  }
}
