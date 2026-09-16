import fs from 'fs';
import path from 'path';
import { ROOT } from '../lib/paths';
import { ALL_PLAYWRIGHT_BROWSERS, type PlaywrightBrowser } from '../lib/playwright-browsers';
import { NOT_AVAILABLE } from '../lib/suite-origin';

export const CROSS_BROWSER_LIMITATIONS = [
  'This suite runs Playwright desktop engines: Chromium, Firefox, and WebKit.',
  'WebKit is not iOS Safari. Chromium is not Android Chrome. Firefox is not a separately installed desktop Firefox profile.',
  'No real physical device, real iOS Safari, real Android Chrome, or device-cloud session was executed.',
] as const;

export interface EngineVersionRow {
  engine: PlaywrightBrowser;
  bundledVersion: string;
  runtimeVersion: string;
  version: string;
}

interface PlaywrightBrowsersManifest {
  browsers?: Array<{ name?: string; browserVersion?: string }>;
}

export function playwrightPackageVersion(root = ROOT): string {
  const pkgPath = path.join(root, 'node_modules', '@playwright', 'test', 'package.json');
  if (!fs.existsSync(pkgPath)) return NOT_AVAILABLE;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version?.trim() || NOT_AVAILABLE;
}

export function readBundledEngineVersions(root = ROOT): Record<PlaywrightBrowser, string> {
  const versions: Record<PlaywrightBrowser, string> = {
    chromium: NOT_AVAILABLE,
    firefox: NOT_AVAILABLE,
    webkit: NOT_AVAILABLE,
  };
  const manifestPath = path.join(root, 'node_modules', 'playwright-core', 'browsers.json');
  if (!fs.existsSync(manifestPath)) return versions;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PlaywrightBrowsersManifest;
  for (const engine of ALL_PLAYWRIGHT_BROWSERS) {
    const row = manifest.browsers?.find((item) => item.name === engine);
    versions[engine] = row?.browserVersion?.trim() || NOT_AVAILABLE;
  }
  return versions;
}

export async function resolveRuntimeEngineVersion(engine: PlaywrightBrowser): Promise<string> {
  try {
    const playwright = require('@playwright/test') as typeof import('@playwright/test');
    const browserType = playwright[engine];
    const browser = await browserType.launch();
    try {
      return browser.version()?.trim() || NOT_AVAILABLE;
    } finally {
      await browser.close();
    }
  } catch {
    return NOT_AVAILABLE;
  }
}

export async function resolveEngineVersions(
  engines: readonly PlaywrightBrowser[] = ALL_PLAYWRIGHT_BROWSERS,
  root = ROOT
): Promise<EngineVersionRow[]> {
  const bundled = readBundledEngineVersions(root);
  const rows: EngineVersionRow[] = [];
  for (const engine of engines) {
    const runtimeVersion = await resolveRuntimeEngineVersion(engine);
    const bundledVersion = bundled[engine] ?? NOT_AVAILABLE;
    rows.push({
      engine,
      bundledVersion,
      runtimeVersion,
      version: runtimeVersion !== NOT_AVAILABLE ? runtimeVersion : bundledVersion,
    });
  }
  return rows;
}
