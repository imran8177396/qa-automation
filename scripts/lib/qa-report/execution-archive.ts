import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { loadConfig } from '../load-config';
import { resolvePlaywrightBrowsers } from '../playwright-browsers';
import { readJsonIfExists, writeJson } from '../../discovery/write-json';
import type { DiscoveryResult } from '../../discovery/types';
import { collectRunProvenance } from './provenance';
import {
  formatPktIsoOffset,
  formatPktStamp,
  PKT_OFFSET,
  PKT_TIMEZONE,
  pktDateParts,
} from './timestamps';

export { formatPktStamp, formatPktIsoOffset, PKT_TIMEZONE, PKT_OFFSET };

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export const EXECUTION_ID_ENV = 'QA_EXECUTION_ID';
export const EXECUTION_STARTED_AT_ENV = 'QA_EXECUTION_STARTED_AT';

export const MASTER_QA_REPORT_HTML = 'MASTER-QA-REPORT.html';
export const MASTER_QA_REPORT_JSON = 'MASTER-QA-REPORT.json';

/** Raw module report folders copied under history/<id>/modules/. Engines still write to top-level reports/. */
export const HISTORY_MODULE_KEYS = [
  'discovery',
  'accessibility',
  'content',
  'cross-browser',
  'jmeter',
  'lighthouse',
  'performance',
  'playwright',
  'postman',
  'responsive',
  'security',
  'seo',
  'visual',
  'workflows',
  'failures',
  'retest',
  'coverage',
  'quality',
  'orchestrator',
  'summary',
  'dependencies',
] as const;

export type HistoryModuleKey = (typeof HISTORY_MODULE_KEYS)[number];

export type ProjectNameSource = 'config' | 'env' | 'discovery-title' | 'hostname-fallback';

export interface ResolvedProjectName {
  projectName: string;
  websiteName: string;
  baseUrl: string;
  slug: string;
  projectNameSource: ProjectNameSource;
  websiteNameSource: ProjectNameSource;
  hostnameFallback: boolean;
}

export interface ExecutionIdentity {
  executionId: string;
  folderName: string;
  folderPath: string;
  projectName: string;
  websiteName: string;
  baseUrl: string;
  projectNameSource: ProjectNameSource;
  websiteNameSource: ProjectNameSource;
  hostnameFallback: boolean;
  startTime: string;
  timestamp: string;
  timezone: typeof PKT_TIMEZONE;
  timezoneOffset: typeof PKT_OFFSET;
  testSuite: string;
  startedAtMs: number;
}

export interface ExecutionMetadata {
  projectName: string;
  websiteName: string;
  baseUrl: string;
  executionId: string;
  startTime: string;
  endTime: string;
  timezone: typeof PKT_TIMEZONE;
  timezoneOffset: typeof PKT_OFFSET;
  timestamp: string;
  frameworkVersion: string;
  gitCommit: string;
  gitBranch: string;
  environment: string;
  browsers: string[];
  testSuite: string;
  overallStatus: string;
  projectNameSource: ProjectNameSource;
  websiteNameSource: ProjectNameSource;
  hostnameFallback: boolean;
  archivedArtifacts: string[];
}

export interface ArchiveToHistoryResult {
  folderPath: string;
  metadataPath: string;
  copied: string[];
  identity: ExecutionIdentity;
  metadata: ExecutionMetadata;
}

const UNSAFE_FS_CHARS = /[:/\\*?\"<>|]/g;
const MAX_COLLISION_SUFFIX = 99;

export function toFilesystemSlug(name: string): string {
  return name
    .replace(UNSAFE_FS_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function hostnameOf(url: string): string {
  try {
    const host = new URL(url).hostname.trim();
    return host;
  } catch {
    return '';
  }
}

function readDiscoveredTitle(discoveryPath = PATHS.discoveryFile): string {
  const discovery = readJsonIfExists<DiscoveryResult>(discoveryPath);
  if (!discovery) return '';
  const seed = discovery.seedUrl;
  const seedPage = discovery.pages.find((page) => page.url === seed || page.finalUrl === seed);
  const titled = seedPage ?? discovery.pages.find((page) => Boolean(page.title?.trim()));
  return titled?.title?.trim() || discovery.pages[0]?.ogTitle?.trim() || '';
}

export function resolveProjectName(input: {
  configName?: string;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  discoveredTitle?: string | null;
} = {}): ResolvedProjectName {
  const env = input.env ?? process.env;
  const configName = firstNonEmpty(input.configName);
  const envProject = firstNonEmpty(env.QA_PROJECT_NAME);
  const envWebsite = firstNonEmpty(env.QA_WEBSITE_NAME, env.QA_APPLICATION_NAME);
  const discovered = firstNonEmpty(input.discoveredTitle ?? undefined);
  const baseUrl = firstNonEmpty(input.baseUrl, env.QA_WEBSITE_URL, env.QA_PLAYWRIGHT_BASE_URL);
  const host = hostnameOf(baseUrl);

  let projectName = '';
  let projectNameSource: ProjectNameSource = 'hostname-fallback';

  if (configName) {
    projectName = configName;
    projectNameSource = 'config';
  } else if (envProject) {
    projectName = envProject;
    projectNameSource = 'env';
  } else if (envWebsite) {
    projectName = envWebsite;
    projectNameSource = 'env';
  } else if (discovered) {
    projectName = discovered;
    projectNameSource = 'discovery-title';
  } else if (host) {
    projectName = host;
    projectNameSource = 'hostname-fallback';
  }

  let websiteName = '';
  let websiteNameSource: ProjectNameSource = 'hostname-fallback';
  if (envWebsite) {
    websiteName = envWebsite;
    websiteNameSource = 'env';
  } else if (discovered) {
    websiteName = discovered;
    websiteNameSource = 'discovery-title';
  } else if (configName) {
    websiteName = configName;
    websiteNameSource = 'config';
  } else if (host) {
    websiteName = host;
    websiteNameSource = 'hostname-fallback';
  }

  const hostnameFallback = projectNameSource === 'hostname-fallback' || websiteNameSource === 'hostname-fallback';

  if (!projectName && host) {
    projectName = host;
    projectNameSource = 'hostname-fallback';
  }
  if (!websiteName && host) {
    websiteName = host;
    websiteNameSource = 'hostname-fallback';
  }

  const slug = toFilesystemSlug(projectName);
  if (!slug) {
    throw new Error(
      'Could not resolve a project name from qa.config.json, env, discovered title, or base URL hostname. No name was invented.'
    );
  }

  return {
    projectName,
    websiteName: websiteName || projectName,
    baseUrl,
    slug,
    projectNameSource,
    websiteNameSource,
    hostnameFallback,
  };
}

export function historyFolderOccupied(folderPath: string): boolean {
  return fs.existsSync(folderPath);
}

export function allocateExecutionId(
  slug: string,
  startedAt: Date,
  historyRoot: string = PATHS.reports.history
): { executionId: string; folderName: string; folderPath: string; timestamp: string } {
  const timestamp = formatPktStamp(startedAt);
  const baseName = `${slug}_${timestamp}_PKT`;
  const candidates: string[] = [baseName];
  for (let n = 1; n <= MAX_COLLISION_SUFFIX; n += 1) {
    candidates.push(`${baseName}_${String(n).padStart(2, '0')}`);
  }
  const parts = pktDateParts(startedAt);
  candidates.push(`${slug}_${timestamp}-${parts.millisecond}_PKT`);

  for (const folderName of candidates) {
    const folderPath = path.join(historyRoot, folderName);
    if (!historyFolderOccupied(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      return { executionId: folderName, folderName, folderPath, timestamp };
    }
  }

  throw new Error(`Could not allocate a unique PKT history folder for ${baseName} under ${historyRoot}`);
}

export function beginQaExecution(input: {
  startedAt?: Date;
  testSuite?: string;
  baseUrlHint?: string;
  configName?: string;
  env?: NodeJS.ProcessEnv;
  historyRoot?: string;
  discoveredTitle?: string | null;
} = {}): ExecutionIdentity {
  const startedAt = input.startedAt ?? new Date();
  let configName = input.configName;
  let configWebsite = '';
  if (input.configName === undefined) {
    try {
      const config = loadConfig();
      configName = config.project?.name;
      configWebsite = config.urls?.website ?? '';
    } catch {
      // Standalone tests may not have config; resolve from provided fields only.
    }
  }

  const resolved = resolveProjectName({
    configName,
    env: input.env,
    baseUrl: input.baseUrlHint || configWebsite,
    // Do not read a previous run's discovery at start — that would mix executions.
    discoveredTitle: input.discoveredTitle ?? '',
  });

  const allocated = allocateExecutionId(resolved.slug, startedAt, input.historyRoot ?? PATHS.reports.history);
  const identity: ExecutionIdentity = {
    executionId: allocated.executionId,
    folderName: allocated.folderName,
    folderPath: allocated.folderPath,
    projectName: resolved.projectName,
    websiteName: resolved.websiteName,
    baseUrl: resolved.baseUrl,
    projectNameSource: resolved.projectNameSource,
    websiteNameSource: resolved.websiteNameSource,
    hostnameFallback: resolved.hostnameFallback,
    startTime: formatPktIsoOffset(startedAt),
    timestamp: allocated.timestamp,
    timezone: PKT_TIMEZONE,
    timezoneOffset: PKT_OFFSET,
    testSuite: input.testSuite || 'qa:all',
    startedAtMs: startedAt.getTime(),
  };

  writeJson(path.join(identity.folderPath, 'execution-identity.json'), identity);
  return identity;
}

export function persistExecutionIdentityToOrchestrator(identity: ExecutionIdentity): string {
  writeJson(PATHS.executionIdentityFile, identity);
  return PATHS.executionIdentityFile;
}

export function applyExecutionIdentityEnv(
  identity: ExecutionIdentity,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  env[EXECUTION_ID_ENV] = identity.executionId;
  env[EXECUTION_STARTED_AT_ENV] = identity.startTime;
  return env;
}

export function loadExecutionIdentity(options: {
  env?: NodeJS.ProcessEnv;
  historyRoot?: string;
  identityFile?: string;
} = {}): ExecutionIdentity | null {
  const env = options.env ?? process.env;
  const fromFile =
    readJsonIfExists<ExecutionIdentity>(options.identityFile ?? PATHS.executionIdentityFile) ??
    (env[EXECUTION_ID_ENV]
      ? readJsonIfExists<ExecutionIdentity>(
          path.join(options.historyRoot ?? PATHS.reports.history, env[EXECUTION_ID_ENV], 'execution-identity.json')
        )
      : null);
  if (fromFile?.executionId && fromFile.folderPath) return fromFile;

  const executionId = firstNonEmpty(env[EXECUTION_ID_ENV]);
  if (!executionId) return null;
  const folderPath = path.join(options.historyRoot ?? PATHS.reports.history, executionId);
  const nested = readJsonIfExists<ExecutionIdentity>(path.join(folderPath, 'execution-identity.json'));
  return nested;
}

export function loadOrBeginQaExecution(input: Parameters<typeof beginQaExecution>[0] = {}): ExecutionIdentity {
  const existing = loadExecutionIdentity({
    env: input.env,
    historyRoot: input.historyRoot,
  });
  if (existing) return existing;
  return beginQaExecution(input);
}

function packageFrameworkVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PATHS.root, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version?.trim() || NOT_AVAILABLE;
  } catch {
    return NOT_AVAILABLE;
  }
}

function observedEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = firstNonEmpty(env.QA_ENVIRONMENT, env.NODE_ENV);
  if (explicit) return explicit;
  if (env.GITHUB_ACTIONS === 'true') return 'GitHub Actions';
  if (env.JENKINS_URL) return 'Jenkins';
  if (env.CI === 'true') return 'ci';
  return NOT_AVAILABLE;
}

export function historyModulesDir(folderPath: string): string {
  return path.join(folderPath, 'modules');
}

export function historyEvidenceDir(folderPath: string): string {
  return path.join(folderPath, 'evidence');
}

export function dirHasRealContent(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const walk = (current: string): boolean => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.gitkeep') continue;
      const full = path.join(current, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory() && walk(full)) return true;
    }
    return false;
  };
  return walk(dir);
}

function copyIfExists(src: string, dest: string, copied: string[], label: string): void {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory() && !dirHasRealContent(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
  copied.push(label);
}

function copyFileIfExists(src: string, dest: string, copied: string[], label: string): void {
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied.push(label);
}

function collectByExtension(root: string, extensions: Set<string>, destDir: string, copied: string[], label: string): void {
  if (!fs.existsSync(root)) return;
  let found = false;
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) continue;
      const relative = path.relative(root, full);
      const dest = path.join(destDir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
      found = true;
    }
  };
  walk(root);
  if (found) copied.push(label);
}

export function writeExecutionMetadata(
  identity: ExecutionIdentity,
  input: {
    endedAt?: Date;
    overallStatus?: string;
    archivedArtifacts?: string[];
    env?: NodeJS.ProcessEnv;
    folderPath?: string;
  } = {}
): { metadata: ExecutionMetadata; metadataPath: string } {
  const endedAt = input.endedAt ?? new Date();
  const provenance = collectRunProvenance();
  let browsers: string[] = [];
  try {
    browsers = resolvePlaywrightBrowsers(loadConfig().playwright);
  } catch {
    browsers = [];
  }

  const metadata: ExecutionMetadata = {
    projectName: identity.projectName,
    websiteName: identity.websiteName,
    baseUrl: identity.baseUrl,
    executionId: identity.executionId,
    startTime: identity.startTime,
    endTime: formatPktIsoOffset(endedAt),
    timezone: PKT_TIMEZONE,
    timezoneOffset: PKT_OFFSET,
    timestamp: identity.timestamp,
    frameworkVersion: packageFrameworkVersion(),
    gitCommit: provenance.gitCommitSha,
    gitBranch: provenance.gitBranch,
    environment: observedEnvironment(input.env),
    browsers,
    testSuite: identity.testSuite,
    overallStatus: input.overallStatus?.trim() || NOT_AVAILABLE,
    projectNameSource: identity.projectNameSource,
    websiteNameSource: identity.websiteNameSource,
    hostnameFallback: identity.hostnameFallback,
    archivedArtifacts: input.archivedArtifacts ?? [],
  };

  const metadataPath = path.join(input.folderPath ?? identity.folderPath, 'execution-metadata.json');
  writeJson(metadataPath, metadata);
  return { metadata, metadataPath };
}

export function archiveToHistory(input: {
  identity?: ExecutionIdentity;
  endedAt?: Date;
  overallStatus?: string;
  historyRoot?: string;
  reportsRoot?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ArchiveToHistoryResult {
  const identity = input.identity ?? loadOrBeginQaExecution({ env: input.env, historyRoot: input.historyRoot });
  const folderPath = identity.folderPath;
  fs.mkdirSync(folderPath, { recursive: true });

  const reportsRoot = input.reportsRoot ?? PATHS.reports.root;
  const copied: string[] = [];
  const modulesDir = historyModulesDir(folderPath);
  const evidenceDir = historyEvidenceDir(folderPath);

  for (const key of HISTORY_MODULE_KEYS) {
    copyIfExists(path.join(reportsRoot, key), path.join(modulesDir, key), copied, `modules/${key}/`);
  }

  const professional = readJsonIfExists<{ htmlPath?: string }>(path.join(reportsRoot, 'summary', 'professional-report.json'));
  if (professional?.htmlPath) {
    const abs = path.isAbsolute(professional.htmlPath)
      ? professional.htmlPath
      : path.join(PATHS.root, professional.htmlPath);
    copyFileIfExists(abs, path.join(modulesDir, 'summary', 'professional-report.html'), copied, 'modules/summary/professional-report.html');
  }

  const allureResults = path.join(reportsRoot, 'allure', 'results');
  const allureReport = path.join(reportsRoot, 'allure', 'report');
  copyIfExists(allureResults, path.join(folderPath, 'allure', 'results'), copied, 'allure/results');
  copyIfExists(allureReport, path.join(folderPath, 'allure', 'report'), copied, 'allure/report');

  const copyRuntimeEvidence = !input.reportsRoot || path.resolve(input.reportsRoot) === path.resolve(PATHS.reports.root);
  if (copyRuntimeEvidence) {
    const screenshotExt = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const videoExt = new Set(['.webm', '.mp4']);
    const traceExt = new Set(['.zip']);

    copyIfExists(path.join(PATHS.root, 'screenshots'), path.join(evidenceDir, 'screenshots'), copied, 'evidence/screenshots/');
    collectByExtension(
      path.join(PATHS.root, 'test-results'),
      screenshotExt,
      path.join(evidenceDir, 'screenshots', 'test-results'),
      copied,
      'evidence/screenshots/test-results'
    );
    copyIfExists(path.join(PATHS.root, 'traces'), path.join(evidenceDir, 'traces'), copied, 'evidence/traces/');
    collectByExtension(
      path.join(PATHS.root, 'test-results'),
      traceExt,
      path.join(evidenceDir, 'traces', 'test-results'),
      copied,
      'evidence/traces/test-results'
    );
    collectByExtension(
      path.join(PATHS.root, 'test-results'),
      videoExt,
      path.join(evidenceDir, 'videos', 'test-results'),
      copied,
      'evidence/videos/test-results'
    );

    copyFileIfExists(
      path.join(PATHS.root, 'jmeter.log'),
      path.join(evidenceDir, 'logs', 'jmeter.log'),
      copied,
      'evidence/logs/jmeter.log'
    );
    const tempDir = path.join(PATHS.root, 'temp');
    if (fs.existsSync(tempDir)) {
      collectByExtension(tempDir, new Set(['.log']), path.join(evidenceDir, 'logs', 'temp'), copied, 'evidence/logs/temp');
    }
  }

  const discoveredNow = readDiscoveredTitle();
  if (discoveredNow && identity.websiteNameSource === 'hostname-fallback') {
    identity.websiteName = discoveredNow;
    identity.websiteNameSource = 'discovery-title';
    identity.hostnameFallback = identity.projectNameSource === 'hostname-fallback';
  }

  const { metadata, metadataPath } = writeExecutionMetadata(identity, {
    endedAt: input.endedAt,
    overallStatus: input.overallStatus,
    archivedArtifacts: copied,
    env: input.env,
    folderPath,
  });
  writeJson(path.join(folderPath, 'execution-identity.json'), identity);
  return { folderPath, metadataPath, copied, identity, metadata };
}
