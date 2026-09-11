import type { Page, Response } from '@playwright/test';
import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus } from './categories';

export interface ApiCallRecord {
  fromPage: string;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  contentType: string | null;
  sameOrigin: boolean;
  applicableTestTypes: ReturnType<typeof applicableTestTypes>;
  potentialAction: string;
  evidence: string;
}

export interface ApiInventory {
  generatedAt: string;
  seedUrl: string;
  pagesObserved: number;
  calls: ApiCallRecord[];
  categoryStatus: CategoryStatus[];
}

const API_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'websocket']);

function sameOrigin(pageUrl: string, requestUrl: string): boolean {
  try {
    return new URL(pageUrl).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function attachApiObserver(page: Page, pageUrl: string, sink: ApiCallRecord[]): () => void {
  const onResponse = (response: Response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!API_RESOURCE_TYPES.has(resourceType)) return;

    sink.push({
      fromPage: pageUrl,
      method: request.method(),
      url: request.url(),
      status: response.status(),
      resourceType,
      contentType: response.headers()['content-type'] ?? null,
      sameOrigin: sameOrigin(pageUrl, request.url()),
      applicableTestTypes: applicableTestTypes('api'),
      potentialAction: potentialAction('api'),
      evidence: `observed ${resourceType} ${request.method()} during page load (no body or auth headers stored)`,
    });
  };

  page.on('response', onResponse);
  return () => page.off('response', onResponse);
}

export function buildApiInventory(seedUrl: string, pagesObserved: number, calls: ApiCallRecord[]): ApiInventory {
  return {
    generatedAt: new Date().toISOString(),
    seedUrl,
    pagesObserved,
    calls,
    categoryStatus: [
      rollupCategory(
        'api',
        calls.length,
        0,
        'No xhr/fetch/websocket responses were observed during page load — endpoints were not invented'
      ),
    ],
  };
}
