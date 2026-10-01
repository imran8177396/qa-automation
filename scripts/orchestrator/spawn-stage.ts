import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import { applyQaRuntimeEnv } from '../lib/runtime-env';
import { formatStageTimeoutReason, timeoutMsForStageKey } from './stage-timeouts';
import type { StageDefinition, StageResult } from './types';
import { resolveStageOutcome } from './stage-outcome';

function commandLine(script: string, args: string[]): string {
  return [process.execPath, '--import', 'tsx', script, ...args].join(' ');
}

function stamp(): string {
  return new Date().toISOString();
}

function resolveTimeoutMs(stage: StageDefinition): number {
  if (typeof stage.timeoutMs === 'number' && stage.timeoutMs > 0) return stage.timeoutMs;
  return timeoutMsForStageKey(stage.key);
}

/** Kill a child and its descendants so a hung Playwright teardown cannot block qa:all. */
export function killProcessTree(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process may already have exited.
    }
  }
}

export function skippedResult(stage: StageDefinition, reason: string): StageResult {
  const now = stamp();
  logWarn(`Stage ${stage.id} ${stage.name} NOT_EXECUTED — ${reason}`);
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    status: 'NOT_EXECUTED',
    exitCode: null,
    startedAt: now,
    finishedAt: now,
    completedAt: now,
    durationMs: 0,
    reason,
    executedCount: 0,
  };
}

interface ProcessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  launchError?: Error;
  timedOut?: boolean;
  timeoutMs?: number;
}

/**
 * Shared result-building logic for both the synchronous and concurrent
 * spawn paths — keeps status/logging behavior identical regardless of how
 * the child process was launched.
 */
function finalizeStageResult(input: {
  stage: StageDefinition;
  command: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: ProcessOutcome;
}): StageResult {
  const { stage, command, startedAt, finishedAt, outcome } = input;
  const completedAt = finishedAt.toISOString();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (outcome.launchError && !outcome.timedOut) {
    logError(`${stage.name} could not start — ${outcome.launchError.message}. Continuing.`);
    return {
      id: stage.id,
      key: stage.key,
      name: stage.name,
      status: 'INVALID',
      exitCode: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: completedAt,
      completedAt,
      durationMs,
      reason: outcome.launchError.message,
      command,
    };
  }

  if (outcome.timedOut) {
    const timeoutMs = outcome.timeoutMs ?? resolveTimeoutMs(stage);
    const reason = formatStageTimeoutReason(stage.key, timeoutMs);
    logError(`${stage.name} timed out — ${reason}. Continuing.`);
    return {
      id: stage.id,
      key: stage.key,
      name: stage.name,
      status: 'FAIL',
      exitCode: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: completedAt,
      completedAt,
      durationMs,
      reason,
      command,
    };
  }

  const killed = outcome.signal != null;
  const processFailed = killed || outcome.exitCode !== 0;
  const processStatus = processFailed ? 'FAIL' : 'PASS';
  const reason = killed
    ? `Process killed (${outcome.signal})`
    : outcome.exitCode === 0
      ? undefined
      : `Exit code ${outcome.exitCode ?? 'null'}`;

  const resolvedOutcome = resolveStageOutcome({ key: stage.key, processStatus, processFailed });

  if (resolvedOutcome.status === 'PASS') logSuccess(`${stage.name} exited 0`);
  else if (
    resolvedOutcome.status === 'BLOCKED' ||
    resolvedOutcome.status === 'REQUIRES_CONFIGURATION'
  ) {
    logError(
      `${stage.name} ${resolvedOutcome.status} — ${resolvedOutcome.reason ?? reason ?? 'required tool or configuration missing'}. Continuing.`
    );
  } else if (
    resolvedOutcome.status === 'NOT_EXECUTED' ||
    resolvedOutcome.status === 'DRY_RUN' ||
    resolvedOutcome.status === 'RECORDED'
  ) {
    logWarn(`${stage.name} ${resolvedOutcome.status} — ${reason ?? 'zero executed items'}`);
  } else logError(`${stage.name} failed — ${reason ?? resolvedOutcome.status}. Continuing.`);

  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    status: resolvedOutcome.status,
    exitCode: outcome.exitCode,
    startedAt: startedAt.toISOString(),
    finishedAt: completedAt,
    completedAt,
    durationMs,
    reason: resolvedOutcome.reason ?? reason,
    command,
    executedCount: resolvedOutcome.executedCount,
  };
}

function childEnv(optionsEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...optionsEnv };
  applyQaRuntimeEnv(env);
  return env;
}

export function runChildStage(
  stage: StageDefinition,
  args: string[] = [],
  options: { env?: NodeJS.ProcessEnv } = {}
): StageResult {
  if (!stage.script) {
    throw new Error(`Stage ${stage.key} has no script to spawn`);
  }
  const script = path.join(PATHS.root, stage.script);
  const command = commandLine(script, args);
  const startedAt = new Date();
  const timeoutMs = resolveTimeoutMs(stage);
  logStep(`${stage.id}. ${stage.name}`);
  console.log(command);
  console.log(`Stage timeout: ${Math.round(timeoutMs / 60000)} min (${timeoutMs}ms)`);

  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    stdio: 'inherit',
    cwd: PATHS.root,
    env: childEnv(options.env),
    shell: false,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  const finishedAt = new Date();

  const timedOut = Boolean(
    result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  );

  if (timedOut && result.pid) {
    killProcessTree(result.pid);
  }

  return finalizeStageResult({
    stage,
    command,
    startedAt,
    finishedAt,
    outcome: timedOut
      ? { exitCode: null, signal: result.signal, timedOut: true, timeoutMs, launchError: result.error ?? undefined }
      : result.error
        ? { exitCode: null, signal: null, launchError: result.error }
        : { exitCode: result.status, signal: result.signal },
  });
}

/**
 * Concurrent counterpart to runChildStage, used only for stages tagged with
 * a shared `parallelGroup` (see stages.ts). Output from concurrent stages is
 * captured and flushed per-stage on completion rather than inherited live,
 * so two stages' console output never interleaves mid-line.
 */
export function runChildStageAsync(
  stage: StageDefinition,
  args: string[] = [],
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<StageResult> {
  if (!stage.script) {
    return Promise.reject(new Error(`Stage ${stage.key} has no script to spawn`));
  }
  const script = path.join(PATHS.root, stage.script);
  const command = commandLine(script, args);
  const startedAt = new Date();
  const timeoutMs = resolveTimeoutMs(stage);
  logStep(`${stage.id}. ${stage.name} (parallel: ${stage.parallelGroup ?? 'n/a'})`);
  console.log(command);
  console.log(`Stage timeout: ${Math.round(timeoutMs / 60000)} min (${timeoutMs}ms)`);

  return new Promise<StageResult>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: PATHS.root,
      env: childEnv(options.env),
      shell: false,
    });

    let output = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessTree(child.pid);
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited.
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const finish = (outcome: ProcessOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const finishedAt = new Date();
      console.log(output);
      resolve(finalizeStageResult({ stage, command, startedAt, finishedAt, outcome }));
    };

    child.on('error', (launchError) => {
      finish(
        timedOut
          ? { exitCode: null, signal: null, timedOut: true, timeoutMs, launchError }
          : { exitCode: null, signal: null, launchError }
      );
    });

    child.on('close', (exitCode, signal) => {
      finish(
        timedOut
          ? { exitCode, signal, timedOut: true, timeoutMs }
          : { exitCode, signal }
      );
    });
  });
}

export function overallExitCode(results: StageResult[]): number {
  return results.some((row) => row.status === 'FAIL' || row.status === 'INVALID' || row.status === 'PARTIAL')
    ? 1
    : 0;
}
