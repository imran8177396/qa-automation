import fs from 'fs';
import os from 'os';
import path from 'path';

/** Default Node heap for long planning / report stages (MB). */
export const DEFAULT_NODE_HEAP_MB = 4096;

const SANDBOX_BROWSERS_PATH =
  /[\\/]sandbox[\\/]|cursor.*sandbox|\.cursor-sandbox|agent-tools[\\/].*playwright/i;

export function defaultPlaywrightBrowsersDir(home = os.homedir()): string {
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'ms-playwright');
  }
  return path.join(home, '.cache', 'ms-playwright');
}

export function isUnsafePlaywrightBrowsersPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return SANDBOX_BROWSERS_PATH.test(trimmed);
}

/**
 * Return a safe PLAYWRIGHT_BROWSERS_PATH value, or undefined to leave unset
 * (Playwright then uses its normal user cache).
 *
 * Never invents a demo URL; only adjusts browser cache location.
 */
export function resolveSafePlaywrightBrowsersPath(
  env: NodeJS.ProcessEnv = process.env,
  options?: { home?: string; pathExists?: (p: string) => boolean }
): string | undefined {
  const exists = options?.pathExists ?? ((p: string) => fs.existsSync(p));
  const home = options?.home ?? os.homedir();
  const preferred = defaultPlaywrightBrowsersDir(home);
  const current = env.PLAYWRIGHT_BROWSERS_PATH?.trim();

  if (!current) {
    // Prefer the known user cache when it already has browsers; otherwise leave unset.
    return exists(preferred) ? preferred : undefined;
  }

  if (isUnsafePlaywrightBrowsersPath(current) || !exists(current)) {
    return exists(preferred) ? preferred : undefined;
  }

  return current;
}

/**
 * Apply a safe PLAYWRIGHT_BROWSERS_PATH onto `env` (mutates and returns it).
 * Clears a sandbox/invalid path; sets the user cache when that directory exists.
 */
export function applySafePlaywrightBrowsersPath(
  env: NodeJS.ProcessEnv = process.env,
  options?: { home?: string; pathExists?: (p: string) => boolean }
): NodeJS.ProcessEnv {
  const resolved = resolveSafePlaywrightBrowsersPath(env, options);
  if (resolved) {
    env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  } else {
    delete env.PLAYWRIGHT_BROWSERS_PATH;
  }
  return env;
}

/**
 * Ensure NODE_OPTIONS includes a sane --max-old-space-size when none is set.
 * Does not lower an existing higher cap.
 */
export function applyNodeHeapOption(
  env: NodeJS.ProcessEnv = process.env,
  heapMb: number = DEFAULT_NODE_HEAP_MB
): NodeJS.ProcessEnv {
  const current = env.NODE_OPTIONS ?? '';
  const match = current.match(/--max-old-space-size=(\d+)/i);
  if (match) {
    const existing = Number(match[1]);
    if (Number.isFinite(existing) && existing >= heapMb) {
      return env;
    }
    env.NODE_OPTIONS = current.replace(/--max-old-space-size=\d+/i, `--max-old-space-size=${heapMb}`).trim();
    return env;
  }
  env.NODE_OPTIONS = `${current} --max-old-space-size=${heapMb}`.trim();
  return env;
}

/** Apply heap + safe Playwright browsers path for child stages / wrappers. */
export function applyQaRuntimeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  applyNodeHeapOption(env);
  applySafePlaywrightBrowsersPath(env);
  return env;
}
