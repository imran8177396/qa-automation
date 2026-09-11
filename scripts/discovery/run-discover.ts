import fs from 'fs';
import { chromium } from '@playwright/test';
import { loadConfig } from '../lib/load-config';
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

export interface DiscoverResult {
  pageMap: PageMap;
  ui: UiInventory;
  api: ApiInventory;
  workflows: WorkflowInventory;
}

export async function runPageDiscovery(url: string, maxPages?: number): Promise<PageMap> {
  const config = loadConfig();
  const safety = resolveSafetyConfig(config.safety);
  const options = resolveDiscoveryConfig({ ...config.discovery, maxPages: maxPages ?? config.discovery?.maxPages });

  logStep('Discovering pages / routes / navigation');
  const discovery = await crawl(url, { ...options, safety });
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
  return pageMap;
}

export async function runUiAndApiDiscovery(pageMap: PageMap): Promise<{ ui: UiInventory; api: ApiInventory }> {
  const browser = await chromium.launch();
  const elements: UiElementRecord[] = [];
  const calls: ApiCallRecord[] = [];
  let pagesScanned = 0;

  try {
    for (const pageInfo of pageMap.pages) {
      if (pageInfo.error || pageInfo.status === null || pageInfo.status >= 400) {
        logWarn(`UI/API scan skipped for ${pageInfo.url} (status ${pageInfo.status ?? 'n/a'})`);
        continue;
      }

      const page = await browser.newPage();
      const detach = attachApiObserver(page, pageInfo.url, calls);
      try {
        await page.goto(pageInfo.url, { waitUntil: 'load', timeout: 30000 });
        const pageElements = await scanPageUi(page, pageInfo.url);
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

export async function loadOrDiscoverPageMap(url: string, maxPages?: number): Promise<PageMap> {
  const existing = readJsonIfExists<PageMap>(PATHS.pageMapFile);
  if (existing) return existing;
  logWarn('page-map.json not found — running page discovery first');
  return runPageDiscovery(url, maxPages);
}

export async function runFullDiscovery(url: string, maxPages?: number): Promise<DiscoverResult> {
  const pageMap = await runPageDiscovery(url, maxPages);

  logStep('Discovering UI and observing network');
  const { ui, api } = await runUiAndApiDiscovery(pageMap);

  logStep('Inferring workflows from evidence only');
  const workflows = inferWorkflows(pageMap, ui.elements, api);
  writeJson(PATHS.workflowInventoryFile, workflows);
  logSuccess(`Workflow inventory: ${workflows.workflows.length} evidence-based workflow(s)`);

  return { pageMap, ui, api, workflows };
}
