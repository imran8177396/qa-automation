import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from './paths';

export function localBinPath(name: string): string {
  const binary = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join(PATHS.root, 'node_modules', '.bin', binary);
}

function isWindowsBatch(command: string): boolean {
  return process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function windowsCommandLine(command: string, args: string[]): string {
  const inner = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');
  return `"${inner}"`;
}

/**
 * Resolve the npm CLI the same way preflight does: prefer `npm.cmd` / `npm`
 * next to `process.execPath`, then PATH. `execFileSync('npm')` is ENOENT on
 * Windows because npm is a `.cmd` shim, not a bare executable.
 */
export function resolveNpmCommand(): string | null {
  const npmBesideNode = path.join(
    path.dirname(process.execPath),
    process.platform === 'win32' ? 'npm.cmd' : 'npm'
  );
  if (fs.existsSync(npmBesideNode)) {
    return npmBesideNode;
  }
  return findOnPath('npm');
}

/** First PATH match for `name` (`where` on Windows, `which` elsewhere). */
export function findOnPath(name: string): string | null {
  const fromPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (fromPath.status !== 0 || !fromPath.stdout.trim()) {
    return null;
  }

  const found = fromPath.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return found[0] ?? null;
}

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): ReturnType<typeof spawnSync> {
  const cwd = options.cwd ?? PATHS.root;
  const env = options.env ?? process.env;

  // Windows .bat/.cmd must run via cmd.exe so paths with spaces work correctly.
  if (isWindowsBatch(command)) {
    return spawnSync('cmd.exe', ['/d', '/c', command, ...args], {
      stdio: 'inherit',
      cwd,
      env,
      shell: false,
    });
  }

  return spawnSync(command, args, {
    stdio: 'inherit',
    cwd,
    env,
    shell: process.platform === 'win32',
  });
}

export function runLocalBin(
  name: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): ReturnType<typeof spawnSync> {
  return runCommand(localBinPath(name), args, options);
}

export function captureCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBuffer?: number } = {}
): { status: number | null; stdout: string; stderr: string } {
  const cwd = options.cwd ?? PATHS.root;
  const env = options.env ?? process.env;
  const timeout = options.timeoutMs;
  const maxBuffer = options.maxBuffer;

  const result =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', windowsCommandLine(command, args)], {
          encoding: 'utf8',
          cwd,
          env,
          shell: false,
          windowsVerbatimArguments: true,
          timeout,
          maxBuffer,
        })
      : spawnSync(command, args, {
          encoding: 'utf8',
          cwd,
          env,
          shell: false,
          timeout,
          maxBuffer,
        });

  return {
    status: result.status,
    stdout: (result.stdout ?? '').toString(),
    stderr: (result.stderr ?? '').toString(),
  };
}
