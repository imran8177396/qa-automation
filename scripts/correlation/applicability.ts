import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { ApiInventory } from '../discovery/api-observe';
import { isFixtureUiTarget } from '../lib/ui-target';
import type { QaConfig } from '../types';
import { classifyDocumentedPair } from './pairs';
import { resolveCorrelatedWorkflows, type CorrelatedWorkflow } from './resolve';

export const NO_DISCOVERED_XHR_AND_NO_PAIR = 'no discovered XHR and no documented UI↔API pair';

export const NO_PAIR_REASON =
  `NOT_APPLICABLE / UNCOVERED: ${NO_DISCOVERED_XHR_AND_NO_PAIR}. Combined workflows stay separate from test:e2e and test:api. JSONPlaceholder is not forced into Sauce Demo UI. Sauce Demo REST paths are not invented.`;

export const FIXTURE_SELF_CHECK_ID = 'WF-FIXTURE-SELF-CHECK';

export const FIXTURE_SELF_CHECK_PAIR: CorrelatedWorkflow = {
  id: FIXTURE_SELF_CHECK_ID,
  name: 'Fixture UI↔API self-check (framework only — not Sauce Demo coverage)',
  uiPath: '/correlated.html',
  apiMethod: 'GET',
  apiPath: '/api/status',
  expectedStatus: 200,
  requiredFields: ['ok', 'service'],
  uiAction: '[data-qa="load-status"]',
  uiResult: '[data-qa="status-result"]',
};

export const FIXTURE_SELF_CHECK_NOTE =
  'Framework self-check against the local fixture + GET /api/status. Not Sauce Demo coverage.';

export type CorrelationGapStatus = 'NOT_APPLICABLE' | 'UNCOVERED' | 'REQUIRES_CONFIGURATION';

export interface RejectedCorrelatedPair extends CorrelatedWorkflow {
  status: CorrelationGapStatus;
  reason: string;
}

export interface CorrelationApplicability {
  discoveredXhrCount: number;
  documentedPairCount: number;
  validPairs: CorrelatedWorkflow[];
  rejectedPairs: RejectedCorrelatedPair[];
  productCorrelation: {
    status: CorrelationGapStatus;
    reason: string;
  };
  discoveredNetwork: {
    status: CorrelationGapStatus;
    reason: string;
    calls: Array<{ method: string; url: string; status: number }>;
  };
  fixtureSelfCheck: {
    status: 'APPLICABLE' | 'NOT_APPLICABLE';
    reason: string;
    pair: CorrelatedWorkflow;
  };
}

export function loadDiscoveredApiInventory(): ApiInventory | null {
  return readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
}

export function evaluateCorrelationApplicability(
  config: QaConfig,
  inventory: ApiInventory | null | undefined = undefined
): CorrelationApplicability {
  const resolved = inventory === undefined ? loadDiscoveredApiInventory() : inventory;
  const calls = resolved?.calls ?? [];
  const documented = resolveCorrelatedWorkflows(config);
  const validPairs: CorrelatedWorkflow[] = [];
  const rejectedPairs: RejectedCorrelatedPair[] = [];

  for (const pair of documented) {
    const classification = classifyDocumentedPair(config, pair, calls);
    if (classification.status === 'PLANNED') {
      validPairs.push(pair);
      continue;
    }
    rejectedPairs.push({
      ...pair,
      status: classification.status,
      reason: classification.reason,
    });
  }

  const productCorrelation: CorrelationApplicability['productCorrelation'] =
    validPairs.length > 0
      ? {
          status: 'UNCOVERED',
          reason: `${validPairs.length} documented UI↔API pair(s) will execute. UI-only and API-only suites remain separate.`,
        }
      : documented.length === 0 && calls.length === 0
        ? {
            status: 'NOT_APPLICABLE',
            reason: NO_PAIR_REASON,
          }
        : calls.length > 0 && documented.length === 0
          ? {
              status: 'REQUIRES_CONFIGURATION',
              reason:
                'REQUIRES_CONFIGURATION: xhr/fetch/websocket calls were observed but qa.config.json workflows.correlated is empty — candidates are not an executable UI↔API contract.',
            }
          : {
              status: rejectedPairs[0]?.status ?? 'UNCOVERED',
              reason:
                rejectedPairs[0]?.reason ??
                `UNCOVERED: qa.config.json workflows.correlated is empty — ${NO_DISCOVERED_XHR_AND_NO_PAIR}.`,
            };

  const discoveredNetwork: CorrelationApplicability['discoveredNetwork'] =
    calls.length === 0
      ? {
          status: 'NOT_APPLICABLE',
          reason: `NOT_APPLICABLE: ${NO_DISCOVERED_XHR_AND_NO_PAIR}.`,
          calls: [],
        }
      : {
          status: 'REQUIRES_CONFIGURATION',
          reason:
            'REQUIRES_CONFIGURATION: observed network calls are candidates only — no documented UI+API pair binds them to a UI action.',
          calls: calls.map((call) => ({ method: call.method, url: call.url, status: call.status })),
        };

  const fixtureTarget = Boolean(config.playwright?.baseURL || process.env.QA_PLAYWRIGHT_BASE_URL)
    ? isFixtureUiTarget(config)
    : false;
  const fixtureSelfCheck: CorrelationApplicability['fixtureSelfCheck'] = fixtureTarget
    ? {
        status: 'APPLICABLE',
        reason: `${FIXTURE_SELF_CHECK_NOTE} UI target is the local fixture.`,
        pair: FIXTURE_SELF_CHECK_PAIR,
      }
    : {
        status: 'NOT_APPLICABLE',
        reason: `${FIXTURE_SELF_CHECK_NOTE} Live origin is not substituted; this pair is not Sauce Demo coverage.`,
        pair: FIXTURE_SELF_CHECK_PAIR,
      };

  return {
    discoveredXhrCount: calls.length,
    documentedPairCount: documented.length,
    validPairs,
    rejectedPairs,
    productCorrelation,
    discoveredNetwork,
    fixtureSelfCheck,
  };
}
