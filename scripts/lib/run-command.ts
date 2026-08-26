import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';

function localBin(name: string): string {
  const binary = process.platform === 'win32' ? `${name}.cmd` : name;
  return path.join(PATHS.root, 'node_modules', '.bin', binary);
}

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? PATHS.root,
    env: options.env ?? process.env,
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
