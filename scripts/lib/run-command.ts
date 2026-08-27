import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';

function localBin(name: string): string {
  const binary = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join(PATHS.root, 'node_modules', '.bin', binary);
}

function isWindowsBatch(command: string): boolean {
  return process.platform === 'win32' && /\.(bat|cmd)$/i.test(command);
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
  return runCommand(localBin(name), args, options);
}
