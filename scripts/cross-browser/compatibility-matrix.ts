import { NOT_AVAILABLE } from '../lib/suite-origin';
import { engineProject } from './projects';
import type { PlaywrightBrowser } from '../lib/playwright-browsers';
import {
  REAL_DEVICE_EMULATION_DISCLAIMER,
  assertNoRealDeviceClaim,
} from '../core/safety-policy';

/** One-line report banner — desktop engine emulation only, never real devices. */
export const COMPATIBILITY_DISCLAIMER = REAL_DEVICE_EMULATION_DISCLAIMER;

export type CompatibilityExecution = 'desktop-engine-emulation';
export type CompatibilityStatus = 'EXECUTED' | 'NOT_TESTED';

export interface CompatibilityMatrixRow {
  browser: string;
  browserVersion: string;
  os: string;
  viewport: string;
  deviceProfile: string;
  network: string;
  locale: string;
  timezone: string;
  execution: CompatibilityExecution;
  realDevice: false;
  status: CompatibilityStatus;
  note: string;
}

export interface CompatibilityMatrixOptions {
  /** Per-engine versions from a run artifact; omitted keys stay NOT_AVAILABLE. */
  browserVersions?: Partial<Record<'chromium' | 'firefox' | 'webkit', string>>;
  os?: string;
  locale?: string;
  timezone?: string;
  network?: string;
}

const DEVICE_PROFILE = 'desktop emulation';
const EXECUTION: CompatibilityExecution = 'desktop-engine-emulation';
const DEFAULT_VIEWPORT = 'desktop default';

function resolveOs(override?: string): string {
  if (override !== undefined) return override;
  return typeof process !== 'undefined' && process.platform ? process.platform : NOT_AVAILABLE;
}

function resolveViewport(browser: PlaywrightBrowser): string {
  const viewport = engineProject(browser).use?.viewport;
  if (
    viewport &&
    typeof viewport === 'object' &&
    typeof viewport.width === 'number' &&
    typeof viewport.height === 'number'
  ) {
    return `${viewport.width}x${viewport.height}`;
  }
  return DEFAULT_VIEWPORT;
}

function resolveLocaleTimezone(options?: CompatibilityMatrixOptions): {
  locale: string;
  timezone: string;
} {
  // Prefer explicit overrides (e.g. from playwright use / qa config callers).
  // Project definitions today do not set locale or timezoneId.
  const projectUse = engineProject('chromium').use;
  const localeFromProject =
    typeof projectUse?.locale === 'string' && projectUse.locale.trim()
      ? projectUse.locale.trim()
      : undefined;
  const timezoneFromProject =
    typeof projectUse?.timezoneId === 'string' && projectUse.timezoneId.trim()
      ? projectUse.timezoneId.trim()
      : undefined;

  return {
    locale: options?.locale?.trim() || localeFromProject || 'NOT_CONFIGURED',
    timezone: options?.timezone?.trim() || timezoneFromProject || 'NOT_CONFIGURED',
  };
}

function versionFor(
  engine: 'chromium' | 'firefox' | 'webkit',
  options?: CompatibilityMatrixOptions
): string {
  const value = options?.browserVersions?.[engine]?.trim();
  return value && value.length > 0 ? value : NOT_AVAILABLE;
}

/**
 * Normalized compatibility matrix: three desktop Playwright engines EXECUTED,
 * branded Chrome / Safari / Edge channels always NOT_TESTED.
 * Does not launch browsers.
 */
export function buildCompatibilityMatrix(
  options: CompatibilityMatrixOptions = {}
): CompatibilityMatrixRow[] {
  const os = resolveOs(options.os);
  const network = options.network?.trim() || 'unthrottled';
  const { locale, timezone } = resolveLocaleTimezone(options);
  const shared = {
    os,
    deviceProfile: DEVICE_PROFILE,
    network,
    locale,
    timezone,
    execution: EXECUTION,
    realDevice: false as const,
  };

  const rows: CompatibilityMatrixRow[] = [
    {
      ...shared,
      browser: 'Chromium',
      browserVersion: versionFor('chromium', options),
      viewport: resolveViewport('chromium'),
      status: 'EXECUTED',
      note: 'Desktop Chromium engine. Not branded Google Chrome and not Android Chrome.',
    },
    {
      ...shared,
      browser: 'Firefox',
      browserVersion: versionFor('firefox', options),
      viewport: resolveViewport('firefox'),
      status: 'EXECUTED',
      note: 'Desktop Firefox engine. Not a Firefox mobile device.',
    },
    {
      ...shared,
      browser: 'WebKit',
      browserVersion: versionFor('webkit', options),
      viewport: resolveViewport('webkit'),
      status: 'EXECUTED',
      note: 'Desktop WebKit engine. Not iOS Safari and not macOS Safari.',
    },
    {
      ...shared,
      browser: 'Chrome',
      browserVersion: NOT_AVAILABLE,
      viewport: DEFAULT_VIEWPORT,
      status: 'NOT_TESTED',
      note: 'Branded Chrome channel is not launched. Do not read the Chromium row as Chrome.',
    },
    {
      ...shared,
      browser: 'Safari',
      browserVersion: NOT_AVAILABLE,
      viewport: DEFAULT_VIEWPORT,
      status: 'NOT_TESTED',
      note: 'Safari is not launched. The WebKit row is desktop engine emulation only.',
    },
    {
      ...shared,
      browser: 'Edge',
      browserVersion: NOT_AVAILABLE,
      viewport: DEFAULT_VIEWPORT,
      status: 'NOT_TESTED',
      note: 'Edge channel is not launched.',
    },
  ];

  for (const row of rows) {
    assertNoRealDeviceClaim(row.note, row.realDevice);
  }
  assertNoRealDeviceClaim(COMPATIBILITY_DISCLAIMER, false);

  return rows;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/**
 * Renders the normalized compatibility table + disclaimer without launching browsers.
 * Safe for unit tests and for appending to the existing matrix.md writer.
 */
export function renderCompatibilityMatrixMarkdown(
  options: CompatibilityMatrixOptions = {}
): string {
  const rows = buildCompatibilityMatrix(options);
  const headers = [
    'browser',
    'browserVersion',
    'os',
    'viewport',
    'deviceProfile',
    'network',
    'locale',
    'timezone',
    'execution',
    'realDevice',
    'status',
    'note',
  ] as const;

  const lines = [
    '## Compatibility matrix (normalized)',
    '',
    COMPATIBILITY_DISCLAIMER,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) =>
        `| ${escapeCell(row.browser)} | ${escapeCell(row.browserVersion)} | ${escapeCell(row.os)} | ${escapeCell(row.viewport)} | ${escapeCell(row.deviceProfile)} | ${escapeCell(row.network)} | ${escapeCell(row.locale)} | ${escapeCell(row.timezone)} | ${escapeCell(row.execution)} | ${row.realDevice} | ${escapeCell(row.status)} | ${escapeCell(row.note)} |`
    ),
    '',
  ];

  return `${lines.join('\n')}\n`;
}
