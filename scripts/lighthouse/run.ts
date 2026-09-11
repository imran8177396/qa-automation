import fs from 'fs';
import path from 'path';
import { writeJson } from '../discovery/write-json';
import { PATHS } from '../lib/paths';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { captureCommand } from '../lib/run-command';
import type { QaConfig } from '../types';
import { evaluateLighthouseThresholds } from './evaluate';
import { resolveUniquePages } from './pages';
import { parseLighthouseOutput } from './parse';
import { resolveChromePath, resolveLighthouseCommand } from './resolve-tools';
import {
  NOT_AVAILABLE,
  NOT_EXECUTED,
  type LighthousePageMetrics,
  type LighthouseSummary,
} from './types';

function emptyPage(url: string, reason: string): LighthousePageMetrics {
  return {
    url,
    status: 'ERROR',
    reason,
    lcpMs: NOT_AVAILABLE,
    cls: NOT_AVAILABLE,
    inpMs: NOT_AVAILABLE,
    tbtMs: NOT_AVAILABLE,
    performanceScore: NOT_AVAILABLE,
    accessibilityScore: NOT_AVAILABLE,
    bestPracticesScore: NOT_AVAILABLE,
    seoScore: NOT_AVAILABLE,
  };
}

function renderFindings(summary: LighthouseSummary): string {
  const lines = [
    '# Core Web Vitals / Lighthouse findings',
    '',
    'Separate from JMeter. This artifact is not a load-test result and is not merged into reports/jmeter/.',
    '',
    `- Status: ${summary.status}`,
    `- Page source: ${summary.pageSource ?? NOT_EXECUTED}`,
    `- Chrome: ${summary.chromePath ?? NOT_AVAILABLE}`,
    `- Lighthouse CLI: ${summary.lighthouseCommand ?? NOT_AVAILABLE}`,
    `- Threshold status: ${summary.thresholds.status}`,
    '',
    summary.thresholds.note,
    '',
  ];

  if (summary.skipReason) {
    lines.push(`${NOT_EXECUTED}: ${summary.skipReason}`, '');
  }

  if (summary.pages.length > 0) {
    lines.push(
      '| URL | Status | LCP (ms) | CLS | INP (ms) | TBT (ms) | Perf | A11y | BP | SEO |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const page of summary.pages) {
      lines.push(
        `| ${page.url} | ${page.status} | ${page.lcpMs} | ${page.cls} | ${page.inpMs} | ${page.tbtMs} | ${page.performanceScore} | ${page.accessibilityScore} | ${page.bestPracticesScore} | ${page.seoScore} |`
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function writeSummary(summary: LighthouseSummary): void {
  fs.mkdirSync(PATHS.reports.lighthouse, { recursive: true });
  writeJson(PATHS.lighthouseSummary, summary);
  fs.writeFileSync(PATHS.lighthouseFindings, renderFindings(summary), 'utf8');
}

function notExecuted(reason: string, extras: Partial<LighthouseSummary> = {}): LighthouseSummary {
  return {
    ranAt: new Date().toISOString(),
    source: 'lighthouse',
    label: 'Core Web Vitals / Lighthouse',
    separateFromJmeter: true,
    status: 'NOT_EXECUTED',
    skipReason: reason,
    pageSource: extras.pageSource ?? null,
    chromePath: extras.chromePath ?? null,
    lighthouseCommand: extras.lighthouseCommand ?? null,
    pages: extras.pages ?? [],
    thresholds: extras.thresholds ?? {
      keys: {
        lcpMs: null,
        cls: null,
        inpMs: null,
        tbtMs: null,
        performanceScore: null,
        accessibilityScore: null,
        bestPracticesScore: null,
        seoScore: null,
      },
      status: 'NOT_AVAILABLE',
      defined: false,
      note: reason,
      comparisons: [],
    },
  };
}

function runOnePage(
  lighthouseCommand: string,
  chromePath: string,
  url: string,
  outputDir: string
): LighthousePageMetrics {
  const safeName = Buffer.from(url).toString('base64url').slice(0, 48);
  const outputPath = path.join(outputDir, `${safeName}.json`);
  const result = captureCommand(
    lighthouseCommand,
    [
      url,
      '--output=json',
      `--output-path=${outputPath}`,
      '--quiet',
      `--chrome-path=${chromePath}`,
      '--chrome-flags=--headless --disable-gpu --no-sandbox',
      '--only-categories=performance,accessibility,best-practices,seo',
    ],
    { timeoutMs: 180000 }
  );

  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const detail = (result.stderr || result.stdout || 'Lighthouse CLI failed').trim().slice(0, 500);
    return emptyPage(url, detail || `Lighthouse CLI exited ${result.status ?? 'null'}`);
  }

  try {
    const raw = fs.readFileSync(outputPath, 'utf8');
    return parseLighthouseOutput(raw, url);
  } catch (error) {
    return emptyPage(url, `Failed to parse Lighthouse JSON: ${String(error)}`);
  }
}

export async function runLighthouse(config: QaConfig): Promise<boolean> {
  logStep('Core Web Vitals (Lighthouse) — separate from JMeter');

  if (config.lighthouse?.enabled === false) {
    const summary = notExecuted('lighthouse.enabled is false in qa.config.json.');
    writeSummary(summary);
    logWarn(summary.skipReason ?? NOT_EXECUTED);
    return true;
  }

  const pages = resolveUniquePages();
  if (!pages) {
    const summary = notExecuted(
      'Discovery unique pages artifact not found (discovery/page-map.json or reports/discovery/discovery.json). Lighthouse was not executed.'
    );
    writeSummary(summary);
    logWarn(summary.skipReason ?? NOT_EXECUTED);
    return true;
  }

  const lighthouseCommand = resolveLighthouseCommand();
  const chromePath = resolveChromePath();

  if (!lighthouseCommand) {
    const summary = notExecuted(
      'Lighthouse CLI not found (no local node_modules/.bin/lighthouse and no lighthouse on PATH). Scores were not fabricated.',
      { pageSource: pages.source, chromePath }
    );
    writeSummary(summary);
    logWarn(summary.skipReason ?? NOT_EXECUTED);
    return true;
  }

  if (!chromePath) {
    const summary = notExecuted(
      'Chrome/Chromium not found (set CHROME_PATH, install Playwright browsers, or install Chrome). Scores were not fabricated.',
      { pageSource: pages.source, lighthouseCommand }
    );
    writeSummary(summary);
    logWarn(summary.skipReason ?? NOT_EXECUTED);
    return true;
  }

  const outputDir = path.join(PATHS.reports.lighthouse, 'raw');
  fs.mkdirSync(outputDir, { recursive: true });

  const results: LighthousePageMetrics[] = [];
  for (const url of pages.urls) {
    logStep(`Lighthouse ${url}`);
    results.push(runOnePage(lighthouseCommand, chromePath, url, outputDir));
  }

  const recorded = results.filter((page) => page.status === 'RECORDED');
  const thresholds = evaluateLighthouseThresholds(results, config.lighthouse?.thresholds);
  const summary: LighthouseSummary = {
    ranAt: new Date().toISOString(),
    source: 'lighthouse',
    label: 'Core Web Vitals / Lighthouse',
    separateFromJmeter: true,
    status: recorded.length > 0 ? 'RECORDED' : 'NOT_EXECUTED',
    skipReason:
      recorded.length > 0
        ? null
        : 'Lighthouse CLI ran but no page produced a parseable report. Scores were not fabricated.',
    pageSource: pages.source,
    chromePath,
    lighthouseCommand,
    pages: results,
    thresholds,
  };

  writeSummary(summary);
  if (summary.status === 'RECORDED') {
    logSuccess(`Lighthouse recorded ${recorded.length}/${results.length} page(s) — ${PATHS.lighthouseSummary}`);
  } else {
    logWarn(summary.skipReason ?? NOT_EXECUTED);
  }

  if (thresholds.status === 'breached') {
    logWarn('Configured Lighthouse thresholds were breached (see reports/lighthouse/).');
    return false;
  }
  return true;
}
