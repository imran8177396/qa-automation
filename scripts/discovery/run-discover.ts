import fs from 'fs';
import { chromium } from '@playwright/test';
import { loadConfig } from '../lib/load-config';
import { loadRuntimeEnv } from '../lib/load-runtime-env';
import { PATHS } from '../lib/paths';
import { resolveDiscoveryConfig } from '../core/scope';
import { resolveSafetyConfig } from '../core/safety-policy';
import { crawl } from './crawler';
import { buildPageMap, type PageMap } from './page-map';
import { attachApiObserver, buildApiInventory, type ApiCallRecord, type ApiInventory } from './api-observe';
import { buildUiInventory, scanPageUi, type UiElementRecord, type UiInventory } from './ui-scan';
import { inferWorkflows, type WorkflowInventory } from './workflows';
import { readJsonIfExists, writeJson } from './write-json';
import { logStep, logSuccess, logWarn } from '../lib/logger';
import { analyzeSeo, isSeoSkippedPage } from '../seo/analyze-seo';
import { discoveryCredentials } from './credentials';
import { tryDiscoveryLogin, type AuthAttempt } from './auth-session';

export interface DiscoverResult {
  pageMap: PageMap;
  ui: UiInventory;
  api: ApiInventory;
  workflows: WorkflowInventory;
}

export interface PageDiscoveryOutput {
  pageMap: PageMap;
  auth?: AuthAttempt;
}

function testIdAttributes(): string[] {
  const configured = loadConfig().playwright?.testIdAttribute;
  const attrs = ['data-testid', 'data-test'];
  if (configured && !attrs.includes(configured)) attrs.unshift(configured);
  return [...new Set(attrs)];
}

export async function runPageDiscovery(url: string, maxPages?: number): Promise<PageMap> {
  const { pageMap } = await runPageDiscoveryWithAuth(url, maxPages);
  return pageMap;
}

export async function runPageDiscoveryWithAuth(url: string, maxPages?: number): Promise<PageDiscoveryOutput> {
  loadRuntimeEnv();
  const config = loadConfig();
  const safety = resolveSafetyConfig(config.safety);
  const credentials = discoveryCredentials();
  const options = resolveDiscoveryConfig({ ...config.discovery, maxPages: maxPages ?? config.discovery?.maxPages });

  logStep('Discovering pages / routes / navigation');
  if (credentials) {
    logStep('QA_USERNAME/QA_PASSWORD present — will use an observed login form only (no invented catalog)');
  } else {
    logWarn('QA_USERNAME/QA_PASSWORD not set — discovering unauthenticated pages only');
  }

  const discovery = await crawl(url, { ...options, safety, credentials });
  fs.mkdirSync(PATHS.reports.discovery, { recursive: true });
  writeJson(PATHS.discoveryFile, discovery);
  const seoEligible = discovery.pages.filter((page) => !isSeoSkippedPage(page));
  const seoAnalysis = {
    analyzedAt: discovery.crawledAt,
    pagesAnalyzed: seoEligible.length,
    findings: analyzeSeo(discovery),
  };
  writeJson(PATHS.seoFile, seoAnalysis);
  const pageMap = buildPageMap(discovery);
  writeJson(PATHS.pageMapFile, pageMap);
  logSuccess(
    `Discovery: ${discovery.pagesDiscoveredUnique} unique page(s) (${discovery.pagesDiscoveredRaw} raw) → ${PATHS.discoveryFile}`
  );
  logSuccess(`Page map: ${pageMap.pages.length} page(s), ${pageMap.routes.length} route(s) → ${PATHS.pageMapFile}`);
  if (discovery.auth) {
    const state = discovery.auth.succeeded ? 'authenticated' : 'unauthenticated / gated';
    logSuccess(`Auth session: ${state} — ${discovery.auth.reason}`);
  }
  return { pageMap, auth: discovery.auth };
}

export async function runUiAndApiDiscovery(
  pageMap: PageMap,
  auth?: AuthAttempt
): Promise<{ ui: UiInventory; api: ApiInventory }> {
  loadRuntimeEnv();
  const credentials = discoveryCredentials();
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const elements: UiElementRecord[] = [];
  const calls: ApiCallRecord[] = [];
  let pagesScanned = 0;
  const ids = testIdAttributes();

  try {
    if (credentials && (auth?.succeeded || auth === undefined)) {
      const bootstrap = await context.newPage();
      try {
        await bootstrap.goto(pageMap.seedUrl, { waitUntil: 'load', timeout: 30000 });
        await tryDiscoveryLogin(bootstrap, credentials);
      } finally {
        await bootstrap.close();
      }
    }

    for (const pageInfo of pageMap.pages) {
      if (pageInfo.access === 'gated') {
        logWarn(`UI/API scan skipped for ${pageInfo.url} (behind authentication — not invented)`);
        continue;
      }
      if (pageInfo.error || pageInfo.status === null || pageInfo.status >= 400) {
        logWarn(`UI/API scan skipped for ${pageInfo.url} (status ${pageInfo.status ?? 'n/a'})`);
        continue;
      }

      const page = await context.newPage();
      const detach = attachApiObserver(page, pageInfo.url, calls);
      try {
        await page.goto(pageInfo.url, { waitUntil: 'load', timeout: 30000 });
        const pageElements = await scanPageUi(page, pageInfo.url, { testIdAttributes: ids });
        elements.push(...pageElements);
        pagesScanned += 1;
      } catch (error) {
        logWarn(`UI/API scan failed for ${pageInfo.url}: ${String(error)}`);
      } finally {
        detach();
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const ui = buildUiInventory(pageMap.seedUrl, pagesScanned, elements);
  const api = buildApiInventory(pageMap.seedUrl, pagesScanned, calls);
  writeJson(PATHS.uiInventoryFile, ui);
  writeJson(PATHS.apiInventoryFile, api);
  logSuccess(`UI inventory: ${ui.elements.length} element(s) on ${pagesScanned} page(s)`);
  logSuccess(`API inventory: ${api.calls.length} observed xhr/fetch/websocket call(s)`);
  return { ui, api };
}

export async function loadOrDiscoverPageMap(url: string, maxPages?: number): Promise<PageDiscoveryOutput> {
  const existing = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  if (existing) return { pageMap: existing, auth: existing.auth };
  logWarn('page-map.json not found — running page discovery first');
  return runPageDiscoveryWithAuth(url, maxPages);
}

export async function runFullDiscovery(url: string, maxPages?: number): Promise<DiscoverResult> {
  const { pageMap, auth } = await runPageDiscoveryWithAuth(url, maxPages);

  logStep('Discovering UI and observing network');
  const { ui, api } = await runUiAndApiDiscovery(pageMap, auth);

  logStep('Inferring workflows from evidence only');
  const workflows = inferWorkflows(pageMap, ui.elements, api, auth);
  writeJson(PATHS.workflowInventoryFile, workflows);
  logSuccess(`Workflow inventory: ${workflows.workflows.length} evidence-based workflow(s)`);

  return { pageMap, ui, api, workflows };
}
