import type { ExpectedHttpStatus, PostmanAssertionFlag } from '../../types';

export type ApiResultStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'NOT_EXECUTED';

export interface ApiSection27Request {
  testId: string;
  name: string;
  method: string;
  endpoint: string;
  path: string;
  /** config = qa.config.json postman.requests. capability = auth rows. discovery is never invented. */
  source: 'config' | 'discovery' | 'capability';
  statusCode: string;
  expectedStatus: ExpectedHttpStatus;
  collectionAssertedStatus: number | null;
  collectionAssertionResult: 'PASS' | 'FAIL' | 'NOT_EXECUTED';
  responseTimeMs: number;
  assertion: string;
  result: ApiResultStatus;
  flags: string[];
  expectedVsActual?: { expected: string; actual: string };
  includedInPassCount: boolean;
  note?: string;
}

export interface ApiAuthStance {
  authentication: 'NOT_EXECUTED' | 'EXECUTED';
  authorization: 'NOT_EXECUTED' | 'EXECUTED';
  reason: string;
  tokenPresent: boolean;
  documentedContract: boolean;
}

export interface ApiSection27Artifact {
  generatedAt: string;
  collection: string;
  terminology: string;
  discoveryNote: string;
  auth: ApiAuthStance;
  requests: ApiSection27Request[];
  counts: {
    passed: number;
    failed: number;
    unverified: number;
    notExecuted: number;
    excludedFromPassCount: number;
    includedInPassCount: number;
  };
  flaggedAssertions: PostmanAssertionFlag[];
}

export interface PostmanExecutionLike {
  item?: { name?: string };
  requestExecuted?: {
    name?: string;
    method?: string;
    url?: { protocol?: string; host?: string[]; path?: string[] };
  };
  response?: {
    code?: number;
    responseTime?: number;
  };
  tests?: Array<{ name?: string; status?: string }>;
}

export interface PostmanReportLike {
  run?: {
    meta?: { collectionName?: string };
    executions?: PostmanExecutionLike[];
  };
}
