import path from 'path';
import { PATHS } from '../paths';
import { readJsonIfExists, writeJson } from '../../discovery/write-json';
import { normalizeFindingUrl } from '../normalize-finding-url';

export type SuiteHealth = 'healthy' | 'broken';
export type CrossSuiteName = 'discovery' | 'ui' | 'api' | 'seo';

export interface CrossSuiteUrlSignal {
  suite: CrossSuiteName;
  url: string;
  health: SuiteHealth;
  detail: string;
}

export interface CrossSuiteContradiction {
  type: 'CROSS_SUITE_CONTRADICTION';
  severity: 'High';
  url: string;
  healthySuites: CrossSuiteName[];
  brokenSuites: CrossSuiteName[];
  detail: string;
  signals: CrossSuiteUrlSignal[];
}

export interface CrossSuiteReport {
  generatedAt: string;
  findings: CrossSuiteContradiction[];
  signals: CrossSuiteUrlSignal[];
}

export interface CrossSuiteInputs {
  discovery?: { pages?: Array<{ url?: string; route?: string; status?: number | null; ok?: boolean }> };
  ui?: {
    executions?: Array<{ title?: string; scenario?: string; status?: string; url?: string }>;
  };
  api?: {
    requests?: Array<{
      endpoint?: string;
      path?: string;
      statusCode?: string | number;
      result?: string;
      expectedStatus?: number | string;
    }>;
  };
  seo?: { findings?: Array<{ page?: string; rule?: string; detail?: string }> };
}

const PATH_IN_TEXT = /(?:^|[\s"'`(=])(\/[A-Za-z0-9._~&=+%,/-]*)/g;

export function pathnameKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'Not Provided' || trimmed === 'site-wide') return null;

  try {
    const parsed = new URL(trimmed);
    const fromHash = hashAsRoute(parsed.hash);
    if (fromHash) return fromHash;
    return normalizePathname(parsed.pathname);
  } catch {
    /* not an absolute URL */
  }

  const hashOnly = trimmed.match(/#([A-Za-z0-9_-]+)/);
  if (trimmed.startsWith('#') && hashOnly) {
    return normalizePathname(`/${hashOnly[1]}`);
  }

  const pathMatch = trimmed.match(/^\/[A-Za-z0-9._~&=+%,/-]*/);
  if (pathMatch) {
    const [pathPart, hash] = pathMatch[0].split('#');
    if (hash) return normalizePathname(`/${hash}`);
    return normalizePathname(pathPart);
  }

  return null;
}

function hashAsRoute(hash: string): string | null {
  if (!hash || hash === '#') return null;
  const value = hash.replace(/^#/, '').split('?')[0];
  if (!value || value.includes('=')) return null;
  return normalizePathname(`/${value}`);
}

function normalizePathname(pathname: string): string {
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalizeFindingUrl(withSlash) || '/';
}

function keysFromText(text: string): string[] {
  const keys = new Set<string>();
  const direct = pathnameKey(text);
  if (direct && direct !== '/') keys.add(direct);

  try {
    const parsed = new URL(text);
    const pathKey = normalizePathname(parsed.pathname);
    if (pathKey) keys.add(pathKey);
    const hashed = hashAsRoute(parsed.hash);
    if (hashed) keys.add(hashed);
  } catch {
    /* ignore */
  }

  PATH_IN_TEXT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_IN_TEXT.exec(text)) != null) {
    const key = pathnameKey(match[1]);
    if (key && key !== '/') keys.add(key);
  }

  const hashMatch = text.match(/#([A-Za-z0-9_-]+)/g);
  for (const item of hashMatch ?? []) {
    const key = hashAsRoute(item);
    if (key) keys.add(key);
  }

  return [...keys];
}

function documentedExpectedIsError(expectedStatus: number | string | undefined): boolean {
  if (typeof expectedStatus === 'number') return expectedStatus >= 400;
  if (typeof expectedStatus !== 'string' || expectedStatus === 'UNVERIFIED') return false;
  const parsed = Number(expectedStatus);
  return Number.isFinite(parsed) && parsed >= 400;
}

function pushSignal(
  signals: CrossSuiteUrlSignal[],
  suite: CrossSuiteName,
  url: string,
  health: SuiteHealth,
  detail: string
): void {
  const key = pathnameKey(url);
  if (!key) return;
  signals.push({ suite, url: key, health, detail });
}

export function collectCrossSuiteSignals(inputs: CrossSuiteInputs): CrossSuiteUrlSignal[] {
  const signals: CrossSuiteUrlSignal[] = [];

  for (const page of inputs.discovery?.pages ?? []) {
    const url = page.url ?? page.route;
    if (!url) continue;
    const broken = page.ok === false || (page.status != null && page.status >= 400);
    const healthy = page.ok === true || (page.status != null && page.status < 400);
    if (broken) {
      pushSignal(signals, 'discovery', url, 'broken', `Discovery recorded status ${page.status ?? 'error'} (ok=${String(page.ok)})`);
    } else if (healthy) {
      pushSignal(signals, 'discovery', url, 'healthy', `Discovery recorded status ${page.status ?? 'ok'}`);
    }
  }

  for (const exec of inputs.ui?.executions ?? []) {
    const status = (exec.status ?? '').toUpperCase();
    if (status !== 'PASS' && status !== 'FAIL' && status !== 'PASSED' && status !== 'FAILED') continue;
    const health: SuiteHealth = status === 'PASS' || status === 'PASSED' ? 'healthy' : 'broken';
    const text = [exec.url, exec.scenario, exec.title].filter(Boolean).join(' ');
    const keys = exec.url ? [pathnameKey(exec.url)].filter((key): key is string => Boolean(key)) : keysFromText(text);
    if (keys.length === 0) continue;
    for (const key of keys) {
      signals.push({
        suite: 'ui',
        url: key,
        health,
        detail: `UI ${status} — ${exec.scenario ?? exec.title ?? key}`,
      });
    }
  }

  for (const request of inputs.api?.requests ?? []) {
    const result = (request.result ?? '').toUpperCase();
    if (result === 'UNVERIFIED' || result === 'NOT_EXECUTED') continue;
    const url = request.endpoint ?? request.path;
    if (!url) continue;
    // Documented expected 4xx + PASS is not a healthy-page signal. Discovery
    // recording the same 404 is agreement, not "API healthy vs discovery broken".
    if ((result === 'PASS' || result === 'PASSED') && documentedExpectedIsError(request.expectedStatus)) {
      continue;
    }
    if (result === 'PASS' || result === 'PASSED') {
      pushSignal(
        signals,
        'api',
        url,
        'healthy',
        `API ${result} (observed ${String(request.statusCode ?? 'n/a')}, expected ${String(request.expectedStatus ?? 'n/a')})`
      );
    } else if (result === 'FAIL' || result === 'FAILED') {
      pushSignal(
        signals,
        'api',
        url,
        'broken',
        `API ${result} (observed ${String(request.statusCode ?? 'n/a')}, expected ${String(request.expectedStatus ?? 'n/a')})`
      );
    }
  }

  for (const finding of inputs.seo?.findings ?? []) {
    const page = finding.page;
    if (!page) continue;
    const rule = (finding.rule ?? '').toLowerCase();
    const detail = (finding.detail ?? '').toLowerCase();
    const brokenSeo = rule.includes('404') || rule.includes('broken') || detail.includes('404');
    if (brokenSeo) {
      pushSignal(signals, 'seo', page, 'broken', `SEO ${finding.rule ?? 'finding'}: ${finding.detail ?? ''}`.trim());
    }
  }

  return signals;
}

export function detectCrossSuiteContradictions(inputs: CrossSuiteInputs): CrossSuiteContradiction[] {
  const signals = collectCrossSuiteSignals(inputs);
  const byUrl = new Map<string, CrossSuiteUrlSignal[]>();
  for (const signal of signals) {
    const list = byUrl.get(signal.url) ?? [];
    list.push(signal);
    byUrl.set(signal.url, list);
  }

  const findings: CrossSuiteContradiction[] = [];
  for (const [url, urlSignals] of byUrl) {
    const healthySuites = [...new Set(urlSignals.filter((row) => row.health === 'healthy').map((row) => row.suite))];
    const brokenSuites = [...new Set(urlSignals.filter((row) => row.health === 'broken').map((row) => row.suite))];
    if (healthySuites.length === 0 || brokenSuites.length === 0) continue;
    findings.push({
      type: 'CROSS_SUITE_CONTRADICTION',
      severity: 'High',
      url,
      healthySuites,
      brokenSuites,
      detail: `Suite contradiction for ${url}: healthy=[${healthySuites.join(', ')}] broken=[${brokenSuites.join(', ')}]`,
      signals: urlSignals,
    });
  }

  return findings.sort((a, b) => a.url.localeCompare(b.url));
}

interface PlaywrightSuiteLike {
  title?: string;
  specs?: Array<{
    title?: string;
    tests?: Array<{ results?: Array<{ status?: string }> }>;
  }>;
  suites?: PlaywrightSuiteLike[];
}

function flattenPlaywright(suites: PlaywrightSuiteLike[] | undefined, out: CrossSuiteInputs['ui']): void {
  if (!suites || !out?.executions) return;
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      const last = spec.tests?.[0]?.results?.[(spec.tests[0].results?.length ?? 1) - 1];
      out.executions.push({
        title: spec.title,
        scenario: spec.title,
        status: last?.status,
      });
    }
    flattenPlaywright(suite.suites, out);
  }
}

export function readCrossSuiteInputsFromDisk(root = PATHS.root): CrossSuiteInputs {
  const discovery =
    readJsonIfExists<CrossSuiteInputs['discovery']>(path.join(root, 'reports', 'discovery', 'discovery.json')) ??
    readJsonIfExists<CrossSuiteInputs['discovery']>(path.join(root, 'discovery', 'page-map.json')) ??
    undefined;

  const ui: CrossSuiteInputs['ui'] = { executions: [] };
  const playwright = readJsonIfExists<{ suites?: PlaywrightSuiteLike[] }>(
    path.join(root, 'reports', 'playwright', 'results.json')
  );
  flattenPlaywright(playwright?.suites, ui);

  const apiArtifact = readJsonIfExists<CrossSuiteInputs['api']>(path.join(root, 'reports', 'postman', 'section-2.7.json'));
  const api = apiArtifact ?? undefined;

  const seo =
    readJsonIfExists<CrossSuiteInputs['seo']>(path.join(root, 'reports', 'seo', 'summary.json')) ??
    readJsonIfExists<CrossSuiteInputs['seo']>(path.join(root, 'reports', 'discovery', 'seo.json')) ??
    undefined;

  return { discovery, ui, api, seo };
}

export function buildCrossSuiteReport(inputs: CrossSuiteInputs, generatedAt = new Date().toISOString()): CrossSuiteReport {
  const signals = collectCrossSuiteSignals(inputs);
  return {
    generatedAt,
    findings: detectCrossSuiteContradictions(inputs),
    signals,
  };
}

export function writeCrossSuiteReport(inputs?: CrossSuiteInputs): CrossSuiteReport {
  const resolved = inputs ?? readCrossSuiteInputsFromDisk();
  const report = buildCrossSuiteReport(resolved);
  writeJson(path.join(PATHS.reports.quality, 'cross-suite.json'), report);
  return report;
}
