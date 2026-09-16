import type { ApiInventory } from '../discovery/api-observe';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { WorkflowInventory } from '../discovery/workflows';
import type { QaConfig } from '../types';
import { resolvePlaywrightBrowsers } from '../lib/playwright-browsers';
import { PERFORMANCE_PROFILES } from '../performance/types';
import { resolveCorrelatedWorkflows } from '../correlation/resolve';
import { normalizeCrawlUrl } from '../lib/url-normalize';
import { buildAbsentCategoryItems, mergeDiscoveryCategoryStatus } from './absent-categories';
import { applicableScenarios, inferFieldHint, kindForElement } from './scenarios';
import type { AssignedScenario, InventoryItem } from './types';

function uniqueUrlKey(url: string): string {
  try {
    return normalizeCrawlUrl(url);
  } catch {
    return url;
  }
}

function noted(id: AssignedScenario['id'], disposition: AssignedScenario['disposition'], reason: string): AssignedScenario[] {
  return [{ id, disposition, reason, tested: false, evidenceIds: [] }];
}

export interface DiscoveryBundle {
  pageMap: PageMap | null;
  ui: UiInventory | null;
  workflows: WorkflowInventory | null;
  api: ApiInventory | null;
}

export function buildInventory(discovery: DiscoveryBundle, config: QaConfig): InventoryItem[] {
  const items: InventoryItem[] = [];

  if (discovery.pageMap) {
    const seenPages = new Set<string>();
    let pageSeq = 0;
    for (const page of discovery.pageMap.pages) {
      const key = uniqueUrlKey(page.url);
      if (seenPages.has(key)) continue;
      seenPages.add(key);
      pageSeq += 1;
      items.push({
        id: `PAGE-${String(pageSeq).padStart(4, '0')}`,
        kind: 'page',
        name: page.title || page.url,
        page: page.url,
        route: page.route,
        source: 'discovery',
        applicableScenarios: applicableScenarios({ kind: 'page', pageStatus: page.status }),
      });
    }

    const seenRoutes = new Set<string>();
    let routeSeq = 0;
    for (const route of discovery.pageMap.routes) {
      const key = uniqueUrlKey(route.url);
      if (seenRoutes.has(key)) continue;
      seenRoutes.add(key);
      routeSeq += 1;
      const page = discovery.pageMap.pages.find((entry) => entry.route === route.path);
      items.push({
        id: `ROUTE-${String(routeSeq).padStart(4, '0')}`,
        kind: 'route',
        name: route.path,
        page: route.url,
        route: route.path,
        source: 'discovery',
        applicableScenarios: applicableScenarios({ kind: 'route', pageStatus: page?.status ?? null }),
      });
    }

    for (const [index, nav] of discovery.pageMap.navigation.entries()) {
      items.push({
        id: `NAV-${String(index + 1).padStart(4, '0')}`,
        kind: 'navigation',
        name: nav.linkText || nav.to,
        page: nav.from,
        route: nav.to,
        source: 'discovery',
        applicableScenarios: applicableScenarios({ kind: 'navigation', href: nav.to }),
      });
    }
  }

  if (discovery.ui) {
    const seenElements = new Set<string>();
    for (const element of discovery.ui.elements) {
      const fingerprint = `${uniqueUrlKey(element.page)}|${element.locator ?? ''}|${element.elementType}|${element.accessibleName ?? ''}`;
      if (seenElements.has(fingerprint)) continue;
      seenElements.add(fingerprint);
      const kind = kindForElement(element.elementType);
      const name = element.accessibleName || element.locator || element.elementType;
      if (!kind) {
        items.push({
          id: element.elementId,
          kind: 'ui-component',
          name,
          page: element.page,
          locator: element.locator,
          elementType: element.elementType,
          source: 'discovery',
          coverageHint: 'untestable',
          applicableScenarios: noted(
            'visibility',
            'not-implemented',
            `Discovered ${element.elementType} has no executable coverage mapping. Listed as UNTESTABLE — not omitted.`
          ),
        });
        continue;
      }

      if (!element.locator) {
        items.push({
          id: element.elementId,
          kind,
          name,
          page: element.page,
          locator: element.locator,
          elementType: element.elementType,
          source: 'discovery',
          coverageHint: 'untestable',
          applicableScenarios: noted(
            'visibility',
            'requires-configuration',
            'No stable locator — cannot target this element. Listed as UNTESTABLE — not omitted.'
          ),
        });
        continue;
      }

      items.push({
        id: element.elementId,
        kind,
        name,
        page: element.page,
        locator: element.locator,
        elementType: element.elementType,
        source: 'discovery',
        applicableScenarios: applicableScenarios({
          kind,
          elementType: element.elementType,
          required: element.required,
          isSubmit: element.isSubmit,
          interactive: element.interactive,
          visible: element.visible,
          href: element.href,
          locator: element.locator,
          evidence: element.evidence,
          readOnly: element.readOnly,
          min: element.min,
          max: element.max,
          minLength: element.minLength,
          maxLength: element.maxLength,
          inputHint: inferFieldHint({
            elementType: element.elementType,
            locator: element.locator,
            name: element.accessibleName,
            evidence: element.evidence,
          }),
        }),
      });
    }
  }

  if (discovery.workflows) {
    for (const workflow of discovery.workflows.workflows) {
      items.push({
        id: workflow.id,
        kind: 'workflow',
        name: workflow.title,
        page: workflow.page,
        source: 'discovery',
        projectStatus: workflow.status,
        applicableScenarios: applicableScenarios({
          kind: 'workflow',
          workflowKind: workflow.kind,
          workflowStatus: workflow.status,
        }),
      });
    }
  }

  if (discovery.api) {
    const seenCalls = new Set<string>();
    let apiSeq = 0;
    for (const call of discovery.api.calls) {
      const key = `${call.method}|${uniqueUrlKey(call.url)}`;
      if (seenCalls.has(key)) continue;
      seenCalls.add(key);
      apiSeq += 1;
      items.push({
        id: `API-DISC-${String(apiSeq).padStart(4, '0')}`,
        kind: 'api',
        name: `${call.method} ${call.url}`,
        page: call.fromPage,
        source: 'discovery',
        applicableScenarios: applicableScenarios({ kind: 'api' }),
      });
    }
  }

  if (config.postman.enabled) {
    for (const [index, request] of config.postman.requests.entries()) {
      if (request.enabled === false) {
        items.push({
          id: `API-CFG-${String(index + 1).padStart(4, '0')}`,
          kind: 'api',
          name: `${request.method} ${request.path}`,
          source: 'config',
          coverageHint: 'skipped',
          applicableScenarios: noted(
            'api-smoke',
            'requires-configuration',
            request.skipReason ?? 'Disabled in qa.config.json. Listed as SKIPPED — not omitted.'
          ),
        });
        continue;
      }
      items.push({
        id: `API-CFG-${String(index + 1).padStart(4, '0')}`,
        kind: 'api',
        name: `${request.method} ${request.path}`,
        source: 'config',
        applicableScenarios: applicableScenarios({ kind: 'api' }),
      });
    }
    items.push({
      id: 'API-AUTH',
      kind: 'api',
      name: 'API authentication / authorization',
      source: 'capability',
      projectStatus: 'REQUIRES_CONFIGURATION',
      applicableScenarios: applicableScenarios({ kind: 'api', workflowKind: 'auth' }),
    });
  }

  const correlated = resolveCorrelatedWorkflows(config);
  if (correlated.length === 0) {
    items.push({
      id: 'WF-CORRELATED',
      kind: 'workflow',
      name: 'Documented UI+API correlated workflows',
      source: 'capability',
      projectStatus: 'NOT_DISCOVERED',
      coverageHint: 'not-applicable',
      applicableScenarios: noted(
        'ui-api-correlation',
        'not-implemented',
        'NOT_APPLICABLE / UNCOVERED: no discovered XHR and no documented UI↔API pair. JSONPlaceholder is not forced into Sauce Demo UI. Combined workflows stay separate from test:e2e and test:api.'
      ),
    });
  }
  for (const workflow of correlated) {
    items.push({
      id: `WF-CORR-${workflow.id}`,
      kind: 'workflow',
      name: workflow.name,
      route: workflow.uiPath,
      source: 'config',
      applicableScenarios: applicableScenarios({ kind: 'workflow', workflowKind: 'ui-api' }),
    });
  }

  for (const browser of resolvePlaywrightBrowsers(config.playwright)) {
    items.push({
      id: `BROWSER-${browser}`,
      kind: 'browser',
      name: browser,
      source: 'config',
      applicableScenarios: applicableScenarios({ kind: 'browser' }),
    });
  }

  items.push({
    id: 'VIEWPORT-matrix',
    kind: 'viewport',
    name: 'Responsive viewport matrix',
    source: 'capability',
    applicableScenarios: applicableScenarios({ kind: 'viewport' }),
  });
  items.push({
    id: 'A11Y-scan',
    kind: 'accessibility',
    name: 'Accessibility scan',
    source: 'capability',
    applicableScenarios: applicableScenarios({ kind: 'accessibility' }),
  });
  items.push({
    id: 'VISUAL-regression',
    kind: 'visual',
    name: 'Visual regression',
    source: 'capability',
    applicableScenarios: applicableScenarios({ kind: 'visual' }),
  });

  items.push(
    config.security?.enabled === false
      ? {
          id: 'SEC-baseline',
          kind: 'security',
          name: 'QA-level security baseline',
          source: 'capability',
          coverageHint: 'not-applicable',
          applicableScenarios: noted(
            'security-baseline',
            'not-implemented',
            'security.enabled is false in qa.config.json. Listed as NOT APPLICABLE — not omitted.'
          ),
        }
      : {
          id: 'SEC-baseline',
          kind: 'security',
          name: 'QA-level security baseline',
          source: 'capability',
          applicableScenarios: applicableScenarios({ kind: 'security' }),
        }
  );

  items.push(
    config.seo?.enabled === false
      ? {
          id: 'SEO-baseline',
          kind: 'seo',
          name: 'Technical SEO baseline',
          source: 'capability',
          coverageHint: 'not-applicable',
          applicableScenarios: noted(
            'seo-baseline',
            'not-implemented',
            'seo.enabled is false in qa.config.json. Listed as NOT APPLICABLE — not omitted.'
          ),
        }
      : {
          id: 'SEO-baseline',
          kind: 'seo',
          name: 'Technical SEO baseline',
          source: 'capability',
          applicableScenarios: applicableScenarios({ kind: 'seo' }),
        }
  );

  items.push(
    config.content?.enabled === false
      ? {
          id: 'CONTENT-baseline',
          kind: 'content',
          name: 'Content QA baseline',
          source: 'capability',
          coverageHint: 'not-applicable',
          applicableScenarios: noted(
            'content-baseline',
            'not-implemented',
            'content.enabled is false in qa.config.json. Listed as NOT APPLICABLE — not omitted.'
          ),
        }
      : {
          id: 'CONTENT-baseline',
          kind: 'content',
          name: 'Content QA baseline',
          source: 'capability',
          applicableScenarios: applicableScenarios({ kind: 'content' }),
        }
  );

  if (config.jmeter.enabled) {
    for (const profile of PERFORMANCE_PROFILES) {
      items.push({
        id: `PERF-${profile}`,
        kind: 'performance',
        name: `${profile} performance profile`,
        source: 'capability',
        applicableScenarios: applicableScenarios({
          kind: 'performance',
          workflowKind: profile === 'liveness' ? 'liveness' : 'heavy',
        }),
      });
    }
  }

  const seedUrl = discovery.pageMap?.seedUrl ?? discovery.ui?.seedUrl ?? discovery.api?.seedUrl ?? null;
  items.push(
    ...buildAbsentCategoryItems(mergeDiscoveryCategoryStatus(discovery), seedUrl)
  );

  return items;
}
