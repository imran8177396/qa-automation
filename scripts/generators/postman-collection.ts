import type { HttpMethod, PostmanAuthConfig, PostmanRequestConfig, QaConfig } from '../types';
import { buildPostmanTestScript, resolveAssertions } from './postman-tests';

const SUPPORTED_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const CONFIG_NOT_DISCOVERY_DESCRIPTION =
  'Requests are generated only from qa.config.json postman.requests. Sauce Demo discovery found 0 xhr/fetch/websocket APIs — login-page REST paths are never invented. Authentication/authorization are NOT_EXECUTED / REQUIRES_CONFIGURATION unless postman.auth documents a contract and QA_API_TOKEN (or basic credentials) are provided at runtime. Secrets are never written into this collection.';

export function isSupportedHttpMethod(method: string): method is HttpMethod {
  return SUPPORTED_METHODS.has(method as HttpMethod);
}

export function requestDescription(request: PostmanRequestConfig): string {
  const parts = [
    `${request.method} ${request.path}${request.kind ? ` (${request.kind})` : ''}`,
    `source=qa.config.json`,
    `expectedStatus=${request.expectedStatus ?? (request.reachableFromNavigation ? '200 (nav default)' : 'UNVERIFIED')}`,
  ];
  if (request.assertionFlags?.length) {
    for (const flag of request.assertionFlags) {
      parts.push(`FLAG ${flag.assertion}: ${flag.flags.join(', ')} — ${flag.note}`);
    }
  }
  if (request.skipReason) parts.push(request.skipReason);
  return parts.join('\n');
}

export function buildCollectionAuth(auth?: PostmanAuthConfig): Record<string, unknown> {
  const type = auth?.type ?? 'none';
  if (type === 'none') {
    return { type: 'noauth' };
  }
  if (type === 'bearer') {
    return {
      type: 'bearer',
      bearer: [{ key: 'token', value: `{{${auth?.tokenEnv ?? 'apiToken'}}}`, type: 'string' }],
    };
  }
  if (type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: `{{${auth?.usernameEnv ?? 'apiUsername'}}}`, type: 'string' },
        { key: 'password', value: `{{${auth?.passwordEnv ?? 'apiPassword'}}}`, type: 'string' },
      ],
    };
  }
  return {
    type: 'apikey',
    apikey: [
      { key: 'key', value: 'X-API-Key', type: 'string' },
      { key: 'value', value: `{{${auth?.tokenEnv ?? 'apiToken'}}}`, type: 'string' },
      { key: 'in', value: 'header', type: 'string' },
    ],
  };
}

function requestHeaders(request: PostmanRequestConfig): Array<{ key: string; value: string }> {
  const headers = Object.entries(request.headers ?? {}).map(([key, value]) => ({ key, value }));
  const hasContentType = headers.some((header) => header.key.toLowerCase() === 'content-type');
  if (request.body != null && !hasContentType) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }
  return headers;
}

export function buildPostmanCollection(config: QaConfig): Record<string, unknown> {
  const activeRequests = config.postman.requests.filter(
    (request) => request.enabled !== false && isSupportedHttpMethod(request.method)
  );

  return {
    info: {
      _postman_id: 'qa-automation-api-collection',
      name: config.postman.collectionName,
      description: `Auto-generated from qa.config.json for ${config.project.name}. ${CONFIG_NOT_DISCOVERY_DESCRIPTION}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: buildCollectionAuth(config.postman.auth),
    item: activeRequests.map((request) => {
      const assertions = resolveAssertions(request, config.postman.assertions);
      const headers = requestHeaders(request);
      const query = Object.entries(request.query ?? {}).map(([key, value]) => ({ key, value }));
      const querySuffix =
        query.length > 0 ? `?${query.map((entry) => `${entry.key}=${entry.value}`).join('&')}` : '';

      return {
        name: request.name,
        event: [
          {
            listen: 'test',
            script: {
              exec: buildPostmanTestScript(assertions, {
                method: request.method,
                path: request.path,
                assertionFlags: request.assertionFlags,
              }),
              type: 'text/javascript',
            },
          },
        ],
        request: {
          method: request.method,
          header: headers,
          body:
            request.body != null
              ? {
                  mode: 'raw',
                  raw: JSON.stringify(request.body, null, 2),
                  options: { raw: { language: 'json' } },
                }
              : undefined,
          url: {
            raw: `{{baseUrl}}${request.path}${querySuffix}`,
            host: ['{{baseUrl}}'],
            path: request.path.replace(/^\//, '').split('/'),
            query,
          },
          description: requestDescription(request),
        },
        response: [],
      };
    }),
    variable: [
      {
        key: 'baseUrl',
        value: config.urls.api,
        type: 'string',
      },
    ],
  };
}

export function buildPostmanEnvironment(config: QaConfig): Record<string, unknown> {
  return {
    id: 'qa-automation-api-env',
    name: `${config.postman.collectionName} - Local`,
    values: [
      { key: 'baseUrl', value: config.urls.api, type: 'default', enabled: true },
      { key: 'apiToken', value: '', type: 'secret', enabled: true },
      { key: 'apiUsername', value: '', type: 'default', enabled: true },
      { key: 'apiPassword', value: '', type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}
