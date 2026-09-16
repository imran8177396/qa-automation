import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { ApiInventory } from '../discovery/api-observe';
import { isFixtureUiTarget } from '../lib/ui-target';
import { resolveUiPerformancePages } from './ui-pages';
import type { UiPerformanceCheckPlan } from './types';

function observedXhrCount(api: ApiInventory | null): number {
  if (!api) return 0;
  return api.calls.filter((call) => {
    const kind = call.resourceType.toLowerCase();
    return kind === 'xhr' || kind === 'fetch';
  }).length;
}

/**
 * Playwright UI performance checks for the discovered login (or fixture login) page.
 * Sauce Demo REST is not invented — XHR/fetch stay NOT_APPLICABLE when discovery saw none.
 */
export function planUiPerformanceChecks(): UiPerformanceCheckPlan[] {
  const pages = resolveUiPerformancePages();
  const page = pages.pages[0];
  const api = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
  const xhrCount = observedXhrCount(api);
  const pageReady = Boolean(page);

  return [
    {
      id: 'PERF-UI-page-load',
      name: 'Page load of the discovered login (or fixture login) page',
      status: pageReady ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: pageReady
        ? `Single document load on ${page?.url ?? 'the resolved UI target'}. Not a load test.`
        : 'No UI page was resolved for Playwright timing.',
    },
    {
      id: 'PERF-UI-navigation',
      name: 'Navigation Timing (TTFB, DCL, load)',
      status: pageReady ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: pageReady
        ? 'PerformanceNavigationTiming is read from the loaded document. Values are RECORDED; no SLA is invented.'
        : 'No page is available to read Navigation Timing from.',
    },
    {
      id: 'PERF-UI-resource',
      name: 'Resource / network timing for the login document',
      status: pageReady ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: pageReady
        ? 'Resource Timing and Playwright request/response events for the login page. Static assets are recorded; backend APIs are not invented.'
        : 'No page is available to record resources from.',
    },
    {
      id: 'PERF-UI-xhr',
      name: 'XHR / fetch backend timing on the login page',
      status: xhrCount > 0 ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason:
        xhrCount > 0
          ? `Discovery observed ${xhrCount} xhr/fetch call(s).`
          : 'Discovery found 0 XHR/fetch on the login page. Sauce Demo REST is not invented for JMeter or Playwright. Documented API load uses JSONPlaceholder from qa.config.json.',
    },
    {
      id: 'PERF-UI-web-vitals',
      name: 'Web Vitals measurable from Playwright (FCP/LCP when exposed)',
      status: pageReady ? 'APPLICABLE' : 'NOT_APPLICABLE',
      reason: pageReady
        ? 'FCP/LCP are recorded only when the browser exposes paint / largest-contentful-paint entries. CLS/INP stay NOT_AVAILABLE without a reliable signal. Official CWV scores come from Lighthouse — if the CLI is missing, that artifact is NOT_EXECUTED, not invented.'
        : 'No page is available for paint / LCP observation.',
    },
    {
      id: 'PERF-UI-inp',
      name: 'INP (interaction-to-next-paint)',
      status: 'NOT_APPLICABLE',
      reason: 'INP requires user interaction. This suite does not click Login or submit the form.',
    },
    {
      id: 'PERF-UI-lighthouse',
      name: 'Lighthouse Core Web Vitals scores',
      status: 'NOT_APPLICABLE',
      reason:
        'Official CWV / category scores are collected by scripts/lighthouse when the Lighthouse CLI is present. They are not merged into Playwright UI timings and are never fabricated.',
    },
    {
      id: 'PERF-UI-saucedemo-rest',
      name: 'Sauce Demo REST load plan',
      status: 'NOT_APPLICABLE',
      reason: isFixtureUiTarget()
        ? 'Fixture target has no Sauce Demo REST surface.'
        : 'Sauce Demo login exposes no documented XHR API. JMeter plans target qa.config.json urls.api (JSONPlaceholder) only.',
    },
  ];
}
