export type PipelineStep = 'sync' | 'api' | 'e2e' | 'load';

export type PlaywrightBrowser = 'chromium' | 'firefox' | 'webkit';

export interface PostmanAssertionsConfig {
  statusCode?: number;
  expectJson?: boolean;
}

export interface PostmanRequestConfig {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  assertions?: PostmanAssertionsConfig;
}

export interface QaConfig {
  project: {
    name: string;
  };
  urls: {
    website: string;
    api: string;
    login: string;
    inventory?: string;
    checkout?: string;
  };
  credentials: {
    username: string;
    password: string;
  };
  pipeline: {
    steps: PipelineStep[];
    failFast: boolean;
  };
  postman: {
    enabled: boolean;
    collectionName: string;
    assertions?: PostmanAssertionsConfig;
    requests: PostmanRequestConfig[];
  };
  playwright: {
    enabled: boolean;
    baseURL: string;
    browser?: PlaywrightBrowser;
    browsers?: PlaywrightBrowser[];
    headless: boolean;
  };
  jmeter: {
    enabled: boolean;
    threads: number;
    rampUpSeconds: number;
    loopCount: number;
    path: string;
  };
  github: {
    branches: string[];
    runOnPullRequest: boolean;
  };
  report?: {
    enabled: boolean;
    format: string;
    autoGenerateAfterTests: boolean;
  };
}
