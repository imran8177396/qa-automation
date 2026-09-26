/**
 * Project-aware execution context.
 *
 * Opt-in for runners/orchestrators via `setCurrentExecutionContext(createExecutionContext(...))`.
 * Collect/phases do not set this automatically (no start-of-run hook that is safe without
 * changing stage spawn behavior). Callers that need stamped metadata set the context once.
 */
import path from 'path';
import { NOT_AVAILABLE } from '../../lib/suite-origin';
import { PATHS } from '../../lib/paths';
import { createExecutionId } from './observability';
import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironment,
  resolveEnvironmentEndpoints,
  type EnvironmentsConfig,
  type QaEnvironmentName,
} from './environment';
import {
  DEFAULT_PROJECT_ID,
  projectPaths,
  projectStores,
  resolveProjectId,
  type ProjectStores,
} from './project';

export interface ProjectContext {
  projectId: string;
  projectName: string;
  baseUrl?: string;
  apiBaseUrl?: string;
  environment: 'local' | 'development' | 'staging' | 'production';
  configPath?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext extends ProjectContext {
  runId: string;
  /** Real value from env, or NOT_AVAILABLE — never a fake SHA. */
  commit: string;
  branch: string;
  build: string;
  /** ISO-8601 from `new Date().toISOString()`. */
  timestamp: string;
}

export interface ExecutionPaths {
  reportsRoot: string;
  historyRoot: string;
  lastTarget: string;
  stores: ProjectStores;
}

export interface ProjectConfigSlice {
  project?: { id?: string; name?: string } | null;
  environment?: { active?: string } | null;
  environments?: EnvironmentsConfig | null;
  urls?: { website?: string; api?: string } | null;
}

export interface CreateProjectContextInput {
  projectId?: string;
  projectName?: string;
  baseUrl?: string;
  apiBaseUrl?: string;
  environment?: string;
  configPath?: string;
  metadata?: Record<string, unknown>;
  /** Optional config slice — does not read disk or `qa.last-target.json`. */
  config?: ProjectConfigSlice | null;
  /** CLI argv for `--project=` / `--env=` (defaults to `process.argv.slice(2)`). */
  argv?: string[];
  /** Env map for `QA_PROJECT` / `QA_ENVIRONMENT` (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

export interface CreateExecutionContextInput extends CreateProjectContextInput {
  /** Alias for runId / executionId. */
  executionId?: string;
  runId?: string;
  commit?: string;
  branch?: string;
  build?: string;
  timestamp?: string;
}

let currentExecutionContext: ExecutionContext | null = null;

/**
 * Process-level execution context for `makeResult` stamping.
 * Default is null (opt-in). Orchestrator does not set this automatically.
 */
export function setCurrentExecutionContext(ctx: ExecutionContext | null): void {
  currentExecutionContext = ctx;
}

export function getCurrentExecutionContext(): ExecutionContext | null {
  return currentExecutionContext;
}

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (!arg.startsWith(prefix)) continue;
    const value = arg.slice(prefix.length).trim();
    return value || undefined;
  }
  return undefined;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

/**
 * Keep only non-empty http(s) URLs. Empty string and non-http values are omitted —
 * never invent demo hosts.
 */
function optionalHttpUrl(value: string | undefined | null): string | undefined {
  const trimmed = nonEmpty(value);
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

function resolveCiMeta(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
  keys: string[]
): string {
  const fromInput = nonEmpty(explicit);
  if (fromInput) return fromInput;
  for (const key of keys) {
    const value = nonEmpty(env[key]);
    if (value) return value;
  }
  return NOT_AVAILABLE;
}

export function createProjectContext(input: CreateProjectContextInput = {}): ProjectContext {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? (process.env as Record<string, string | undefined>);
  const config = input.config ?? null;

  const projectId = resolveProjectId({
    cli: input.projectId ?? readFlag(argv, 'project'),
    env: env.QA_PROJECT,
    config: config?.project ?? null,
  });

  const projectName =
    nonEmpty(input.projectName) ??
    nonEmpty(config?.project?.name) ??
    projectId;

  const environment = resolveEnvironment({
    cli: input.environment ?? readFlag(argv, 'env'),
    env: env.QA_ENVIRONMENT,
    config: config?.environment ?? null,
  });

  const endpoints = resolveEnvironmentEndpoints({
    active: environment,
    environments: config?.environments ?? null,
    fallbackWebsite: config?.urls?.website,
    fallbackApi: config?.urls?.api,
  });

  const baseUrl =
    optionalHttpUrl(input.baseUrl) ?? optionalHttpUrl(endpoints.websiteUrl);
  const apiBaseUrl =
    optionalHttpUrl(input.apiBaseUrl) ?? optionalHttpUrl(endpoints.apiUrl);

  const configPath = nonEmpty(input.configPath);

  return {
    projectId,
    projectName,
    environment,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
    ...(configPath !== undefined ? { configPath } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

export function createExecutionContext(input: CreateExecutionContextInput = {}): ExecutionContext {
  const env = input.env ?? (process.env as Record<string, string | undefined>);
  const project = createProjectContext(input);
  const runId =
    nonEmpty(input.runId) ?? nonEmpty(input.executionId) ?? createExecutionId();

  return {
    ...project,
    runId,
    commit: resolveCiMeta(input.commit, env, ['QA_COMMIT', 'GITHUB_SHA']),
    branch: resolveCiMeta(input.branch, env, ['QA_BRANCH', 'GITHUB_REF_NAME']),
    build: resolveCiMeta(input.build, env, ['QA_BUILD', 'GITHUB_RUN_ID']),
    timestamp: nonEmpty(input.timestamp) ?? new Date().toISOString(),
  };
}

/**
 * Artifact roots for an execution context.
 * `"default"` keeps existing PATHS.reports / history / root last-target.
 * Any other id uses `projectStores` under `reports/projects/<id>/` and never
 * the repo-root `qa.last-target.json`.
 */
export function resolveExecutionPaths(ctx: Pick<ProjectContext, 'projectId'>): ExecutionPaths {
  const id = ctx.projectId;
  const stores = projectStores(id);
  const paths = projectPaths(id);

  if (id === DEFAULT_PROJECT_ID) {
    return {
      reportsRoot: PATHS.reports.root,
      historyRoot: PATHS.reports.history,
      lastTarget: PATHS.lastTarget,
      stores,
    };
  }

  const reportsRoot = stores.reports;
  const projectsSegment = path.join('projects', id);
  const underProjects =
    reportsRoot.includes(projectsSegment) ||
    reportsRoot.replace(/\\/g, '/').includes(`projects/${id}`);
  if (!underProjects || reportsRoot === PATHS.reports.root) {
    throw new Error(
      `resolveExecutionPaths: reports root for project ${JSON.stringify(id)} must be under reports/projects/<id>/ and must not equal the default reports root`
    );
  }
  if (paths.lastTarget === PATHS.lastTarget) {
    throw new Error(
      `resolveExecutionPaths: last-target for project ${JSON.stringify(id)} must not be the repo-root qa.last-target.json`
    );
  }

  return {
    reportsRoot,
    historyRoot: stores.history,
    lastTarget: paths.lastTarget,
    stores,
  };
}

export type { QaEnvironmentName };
export { DEFAULT_ENVIRONMENT, DEFAULT_PROJECT_ID };
