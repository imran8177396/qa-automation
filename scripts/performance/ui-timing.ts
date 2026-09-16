import type { Page, Request, Response } from '@playwright/test';
import type { UiNetworkEntry, UiResourceTimingRow, UiTimingMeasurement } from './types';

interface BrowserNavigationTiming {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  durationMs: number | null;
  transferSize: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  requestMs: number | null;
}

interface BrowserPaintTiming {
  firstPaintMs: number | null;
  firstContentfulPaintMs: number | null;
}

interface BrowserTimingSnapshot {
  navigation: BrowserNavigationTiming | null;
  paint: BrowserPaintTiming;
  lcpMs: number | null;
  cls: number | null;
  resources: UiResourceTimingRow[];
}

function numericOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function attachUiNetworkListener(page: Page): { entries: UiNetworkEntry[]; detach: () => void } {
  const entries: UiNetworkEntry[] = [];
  const started = new Map<Request, number>();

  const onRequest = (request: Request): void => {
    started.set(request, Date.now());
  };
  const onResponse = (response: Response): void => {
    const request = response.request();
    const startedAt = started.get(request);
    entries.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      timingMs: startedAt == null ? null : Date.now() - startedAt,
    });
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    entries,
    detach: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

export async function waitForOptionalLcp(page: Page, timeoutMs = 2000): Promise<void> {
  await page.evaluate(async (waitMs) => {
    await new Promise<void>((resolve) => {
      const existing = performance.getEntriesByType('largest-contentful-paint');
      if (existing.length > 0) {
        resolve();
        return;
      }
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        const observer = new PerformanceObserver(() => finish());
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        finish();
        return;
      }
      setTimeout(finish, waitMs);
    });
  }, timeoutMs);
}

export async function readBrowserTimings(page: Page): Promise<BrowserTimingSnapshot> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint');
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint') as Array<
      PerformanceEntry & { startTime: number }
    >;
    const shifts = performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value?: number }>;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    const paintByName = (name: string): number | null => {
      const entry = paints.find((item) => item.name === name);
      return entry && Number.isFinite(entry.startTime) ? entry.startTime : null;
    };

    const lastLcp = lcpEntries[lcpEntries.length - 1];
    const clsTotal = shifts.reduce((sum, entry) => sum + (typeof entry.value === 'number' ? entry.value : 0), 0);

    return {
      navigation: nav
        ? {
            ttfbMs: Number.isFinite(nav.responseStart) ? nav.responseStart : null,
            domContentLoadedMs: Number.isFinite(nav.domContentLoadedEventEnd) ? nav.domContentLoadedEventEnd : null,
            loadEventMs: Number.isFinite(nav.loadEventEnd) ? nav.loadEventEnd : null,
            durationMs: Number.isFinite(nav.duration) ? nav.duration : null,
            transferSize: Number.isFinite(nav.transferSize) ? nav.transferSize : null,
            dnsMs: Number.isFinite(nav.domainLookupEnd - nav.domainLookupStart)
              ? nav.domainLookupEnd - nav.domainLookupStart
              : null,
            connectMs: Number.isFinite(nav.connectEnd - nav.connectStart) ? nav.connectEnd - nav.connectStart : null,
            requestMs: Number.isFinite(nav.responseEnd - nav.requestStart) ? nav.responseEnd - nav.requestStart : null,
          }
        : null,
      paint: {
        firstPaintMs: paintByName('first-paint'),
        firstContentfulPaintMs: paintByName('first-contentful-paint'),
      },
      lcpMs: lastLcp && Number.isFinite(lastLcp.startTime) ? lastLcp.startTime : null,
      cls: shifts.length > 0 ? clsTotal : null,
      resources: resources.map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        durationMs: Number.isFinite(entry.duration) ? entry.duration : null,
        transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      })),
    };
  });
}

export function buildUiTimingMeasurement(input: {
  url: string;
  pageName: string;
  httpStatus: number | null;
  snapshot: BrowserTimingSnapshot;
  network: UiNetworkEntry[];
}): UiTimingMeasurement {
  const xhrOrFetchCount = input.network.filter((row) => {
    const kind = row.resourceType.toLowerCase();
    return kind === 'xhr' || kind === 'fetch';
  }).length;

  return {
    url: input.url,
    pageName: input.pageName,
    httpStatus: input.httpStatus,
    navigation: input.snapshot.navigation,
    paint: input.snapshot.paint,
    lcpMs: numericOrNull(input.snapshot.lcpMs ?? undefined),
    cls: numericOrNull(input.snapshot.cls ?? undefined),
    inpMs: null,
    resourceCount: input.snapshot.resources.length,
    xhrOrFetchCount,
    resources: input.snapshot.resources,
    network: input.network,
  };
}

export async function collectUiTimings(
  page: Page,
  input: { url: string; pageName: string; httpStatus: number | null; network?: UiNetworkEntry[] }
): Promise<UiTimingMeasurement> {
  await waitForOptionalLcp(page);
  const snapshot = await readBrowserTimings(page);
  return buildUiTimingMeasurement({
    url: input.url,
    pageName: input.pageName,
    httpStatus: input.httpStatus,
    snapshot,
    network: input.network ?? [],
  });
}
