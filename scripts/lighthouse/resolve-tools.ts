import fs from 'fs';
import { chromium } from '@playwright/test';
import { findOnPath, localBinPath } from '../lib/run-command';

export function resolveLighthouseCommand(): string | null {
  const local = localBinPath('lighthouse');
  if (fs.existsSync(local)) return local;
  return findOnPath('lighthouse');
}

export function resolveChromePath(): string | null {
  const fromEnv = process.env.CHROME_PATH || process.env.LIGHTHOUSE_CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    const playwrightChrome = chromium.executablePath();
    if (playwrightChrome && fs.existsSync(playwrightChrome)) return playwrightChrome;
  } catch {
    // Playwright browsers may not be installed.
  }

  const candidates =
    process.platform === 'win32'
      ? ['chrome', 'msedge']
      : ['google-chrome', 'chrome', 'chromium', 'microsoft-edge'];

  for (const name of candidates) {
    const found = findOnPath(name);
    if (found) return found;
  }
  return null;
}
