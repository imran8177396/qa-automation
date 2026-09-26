import path from 'path';
import { PATHS, ROOT } from '../../lib/paths';

/** Capability status: namespaced paths for non-default ids; default keeps current PATHS. */
export const PROJECT_ISOLATION_STATUS = 'PARTIAL' as const;

export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export const DEFAULT_PROJECT_ID = 'default';

export interface ResolveProjectIdInput {
  /** Value from `--project=<id>` (already parsed by the caller). */
  cli?: string | null;
  /** Value from `QA_PROJECT`. */
  env?: string | null;
  /** `config.project.id` when present. */
  config?: { id?: string } | null;
}

export interface ProjectPaths {
  id: string;
  reportsRoot: string;
  lastTarget: string;
}

/**
 * Six isolated store roots. Non-default ids namespace all under `reports/projects/<id>/`.
 * Credential reference paths hold names only — never secret values.
 */
export interface ProjectStores {
  configurationOverlay: string;
  credentialReference: string;
  testData: string;
  artifacts: string;
  history: string;
  reports: string;
}

/**
 * Validates a project id. Invalid ids throw — never fall through to another
 * project's directory.
 */
export function assertValidProjectId(id: string): string {
  const trimmed = id.trim();
  if (!PROJECT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid project id ${JSON.stringify(id)}: must match ${PROJECT_ID_PATTERN} (REQUIRES_CONFIGURATION)`
    );
  }
  return trimmed;
}

/**
 * Resolve active project id: `--project` → `QA_PROJECT` → `config.project.id` → `"default"`.
 */
export function resolveProjectId(input: ResolveProjectIdInput = {}): string {
  const candidates = [input.cli, input.env, input.config?.id];
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return assertValidProjectId(value);
  }
  return DEFAULT_PROJECT_ID;
}

/**
 * Report roots for a project id.
 * `"default"` keeps the existing `PATHS.reports` root and root last-target file.
 * Any other id namespaces under `reports/projects/<id>/` and does not touch
 * root `qa.last-target.json`. Does not migrate or delete existing reports.
 */
export function projectPaths(id: string): ProjectPaths {
  const resolved = assertValidProjectId(id);
  if (resolved === DEFAULT_PROJECT_ID) {
    return {
      id: resolved,
      reportsRoot: PATHS.reports.root,
      lastTarget: PATHS.lastTarget,
    };
  }
  const reportsRoot = path.join(PATHS.reports.root, 'projects', resolved);
  return {
    id: resolved,
    reportsRoot,
    lastTarget: path.join(reportsRoot, 'last-target.json'),
  };
}

/**
 * Distinct paths for configuration overlay, credential-reference file (names only),
 * test-data dir, artifacts, history, and reports.
 *
 * - `default` keeps existing PATHS report/history roots so current reports are not moved.
 * - Any other valid id namespaces ALL SIX under `reports/projects/<id>/...` and must
 *   not read or write the root `qa.last-target.json`.
 */
export function projectStores(id: string): ProjectStores {
  const resolved = assertValidProjectId(id);
  if (resolved === DEFAULT_PROJECT_ID) {
    return {
      configurationOverlay: path.join(ROOT, 'qa.config.overlay.json'),
      credentialReference: path.join(ROOT, 'qa.credential-refs.json'),
      testData: path.join(ROOT, 'test-data'),
      artifacts: path.join(PATHS.reports.root, 'artifacts'),
      history: PATHS.reports.history,
      reports: PATHS.reports.root,
    };
  }
  const base = path.join(PATHS.reports.root, 'projects', resolved);
  return {
    configurationOverlay: path.join(base, 'config', 'overlay.json'),
    credentialReference: path.join(base, 'credentials', 'refs.json'),
    testData: path.join(base, 'test-data'),
    artifacts: path.join(base, 'artifacts'),
    history: path.join(base, 'history'),
    reports: path.join(base, 'reports'),
  };
}
