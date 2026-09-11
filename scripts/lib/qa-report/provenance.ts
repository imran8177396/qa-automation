import { execSync } from 'child_process';
import { PATHS } from '../paths';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';

export interface RunProvenance {
  gitCommitSha: string;
  gitBranch: string;
  dirtyWorktree: string;
  ciProvider: string;
  ciRunId: string;
  buildNumber: string;
  nodeVersion: string;
  osVersion: string;
  orchestratorCommand: string;
}

function git(command: string): string | null {
  try {
    const out = execSync(command, {
      cwd: PATHS.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function env(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return NOT_AVAILABLE;
}

function detectCiProvider(): string {
  if (process.env.GITHUB_ACTIONS === 'true') return 'GitHub Actions';
  if (process.env.GITLAB_CI === 'true') return 'GitLab CI';
  if (process.env.CIRCLECI === 'true') return 'CircleCI';
  if (process.env.TF_BUILD === 'True' || process.env.TF_BUILD === 'true') return 'Azure DevOps';
  if (process.env.JENKINS_URL) return 'Jenkins';
  if (process.env.CI === 'true') return env('CI_NAME', 'CI');
  return NOT_AVAILABLE;
}

export function collectRunProvenance(input?: {
  orchestratorCommand?: string;
  osVersion?: string;
  nodeVersion?: string;
}): RunProvenance {
  const sha = git('git rev-parse HEAD');
  const branch = git('git rev-parse --abbrev-ref HEAD');
  const dirty = git('git status --porcelain');

  return {
    gitCommitSha: sha ?? NOT_AVAILABLE,
    gitBranch: branch ?? NOT_AVAILABLE,
    dirtyWorktree:
      dirty == null ? NOT_AVAILABLE : dirty.length > 0 ? 'true' : 'false',
    ciProvider: detectCiProvider(),
    ciRunId: env('GITHUB_RUN_ID', 'CI_PIPELINE_ID', 'CIRCLE_BUILD_NUM', 'BUILD_BUILDID', 'BUILD_ID'),
    buildNumber: env('GITHUB_RUN_NUMBER', 'CI_PIPELINE_IID', 'BUILD_NUMBER', 'BUILD_BUILDNUMBER'),
    nodeVersion: input?.nodeVersion && input.nodeVersion !== 'Not Provided' ? input.nodeVersion : process.version,
    osVersion:
      input?.osVersion && input.osVersion !== 'Not Provided'
        ? input.osVersion
        : `${process.platform} ${process.arch}`,
    orchestratorCommand: input?.orchestratorCommand?.trim() || env('QA_ORCHESTRATOR_COMMAND') || NOT_AVAILABLE,
  };
}

export function provenanceAsRows(p: RunProvenance): Array<{ label: string; value: string }> {
  return [
    { label: 'Git commit SHA', value: p.gitCommitSha },
    { label: 'Git branch', value: p.gitBranch },
    { label: 'Dirty worktree', value: p.dirtyWorktree },
    { label: 'CI provider', value: p.ciProvider },
    { label: 'CI run ID', value: p.ciRunId },
    { label: 'Build number', value: p.buildNumber },
    { label: 'Node.js version', value: p.nodeVersion },
    { label: 'OS version', value: p.osVersion },
    { label: 'Orchestrator command', value: p.orchestratorCommand },
  ];
}
