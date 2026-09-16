import type { ApiCallRecord } from '../discovery/api-observe';
import { originOf } from '../lib/suite-origin';
import type { HttpMethod, PostmanRequestConfig, QaConfig } from '../types';
import type { CorrelatedWorkflow } from './resolve';

export function normalizeApiPath(value: string): string {
  const raw = value.trim();
  if (!raw) return '/';
  try {
    if (/^https?:\/\//i.test(raw)) {
      const pathname = new URL(raw).pathname;
      return pathname.replace(/\/+$/, '') || '/';
    }
  } catch {
    // Fall through to path-only normalization.
  }
  const pathOnly = raw.split('?')[0] ?? raw;
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withSlash.replace(/\/+$/, '') || '/';
}

export function documentedRequestFor(
  config: QaConfig,
  method: string,
  apiPath: string
): PostmanRequestConfig | undefined {
  const needle = normalizeApiPath(apiPath);
  const upper = method.toUpperCase();
  return (config.postman?.requests ?? []).find(
    (request) =>
      request.enabled !== false &&
      request.method.toUpperCase() === upper &&
      normalizeApiPath(request.path) === needle
  );
}

export function observedCallsMatching(
  calls: ApiCallRecord[],
  method: string,
  apiPath: string
): ApiCallRecord[] {
  const needle = normalizeApiPath(apiPath);
  const upper = method.toUpperCase();
  return calls.filter((call) => {
    if (call.method.toUpperCase() !== upper) return false;
    return normalizeApiPath(call.url) === needle || call.url.includes(`${needle}`) || call.url.includes(apiPath);
  });
}

export function responseMatchesPair(url: string, method: string, apiMethod: string, apiPath: string): boolean {
  if (method.toUpperCase() !== apiMethod.toUpperCase()) return false;
  const needle = normalizeApiPath(apiPath);
  try {
    const parsed = new URL(url);
    return parsed.pathname === needle || parsed.pathname.endsWith(needle);
  } catch {
    return url.includes(needle);
  }
}

export function websiteOrigin(config: QaConfig): string {
  return originOf(config.urls?.website || config.playwright?.baseURL || '');
}

export function apiOrigin(config: QaConfig): string {
  return originOf(config.urls?.api || '');
}

/**
 * True when the UI origin and the documented API origin are the same host.
 * Sauce Demo UI + JSONPlaceholder is cross-origin and is not a real pair.
 */
export function uiApiOriginsCompatible(config: QaConfig, uiPath: string): boolean {
  const uiOrigin = /^https?:\/\//i.test(uiPath) ? originOf(uiPath) : websiteOrigin(config);
  const documentedApiOrigin = apiOrigin(config);
  if (!uiOrigin || !documentedApiOrigin) return false;
  return uiOrigin === documentedApiOrigin;
}

export type PairClassificationStatus = 'PLANNED' | 'UNCOVERED' | 'NOT_APPLICABLE' | 'REQUIRES_CONFIGURATION';

export interface PairClassification {
  status: PairClassificationStatus;
  reason: string;
  documented: boolean;
  observed: boolean;
  compatibleOrigins: boolean;
}

/**
 * A config pair is executable only when it names a real documented Postman
 * request and either shares the UI origin or was observed as xhr/fetch.
 * Invented Sauce Demo REST and JSONPlaceholder-forced-into-Sauce-Demo are rejected.
 */
export function classifyDocumentedPair(
  config: QaConfig,
  pair: Pick<CorrelatedWorkflow, 'id' | 'apiMethod' | 'apiPath' | 'uiPath'>,
  observed: ApiCallRecord[]
): PairClassification {
  const documented = Boolean(documentedRequestFor(config, pair.apiMethod, pair.apiPath));
  const matches = observedCallsMatching(observed, pair.apiMethod, pair.apiPath);
  const compatibleOrigins = uiApiOriginsCompatible(config, pair.uiPath);

  if (!documented) {
    return {
      status: 'UNCOVERED',
      reason: `UNCOVERED: ${pair.apiMethod} ${pair.apiPath} is not in qa.config.json postman.requests — Sauce Demo REST paths are not invented.`,
      documented: false,
      observed: matches.length > 0,
      compatibleOrigins,
    };
  }

  if (matches.length > 0) {
    return {
      status: 'PLANNED',
      reason: `Documented ${pair.apiMethod} ${pair.apiPath} was also observed as xhr/fetch during discovery.`,
      documented: true,
      observed: true,
      compatibleOrigins,
    };
  }

  if (compatibleOrigins) {
    return {
      status: 'PLANNED',
      reason: `Documented ${pair.apiMethod} ${pair.apiPath} shares the UI origin.`,
      documented: true,
      observed: false,
      compatibleOrigins: true,
    };
  }

  return {
    status: 'NOT_APPLICABLE',
    reason:
      'NOT_APPLICABLE: documented API host does not match the UI origin and no discovered XHR binds them. JSONPlaceholder is not forced into Sauce Demo UI tests.',
    documented: true,
    observed: false,
    compatibleOrigins: false,
  };
}

export function isHttpMethod(value: string): value is HttpMethod {
  return value === 'GET' || value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE';
}
