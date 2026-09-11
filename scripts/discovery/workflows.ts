import { applicableTestTypes, potentialAction } from './test-types';
import { rollupCategory, type CategoryStatus } from './categories';
import type { PageMap } from './page-map';
import type { UiElementRecord } from './ui-scan';
import type { ApiInventory } from './api-observe';

export interface WorkflowRecord {
  id: string;
  kind: 'navigation' | 'form-submit' | 'authentication' | 'api';
  title: string;
  page?: string;
  status: 'DISCOVERED' | 'CANDIDATE' | 'NOT_TESTED' | 'REQUIRES_CONFIGURATION';
  evidence: string;
  potentialAction: string;
  applicableTestTypes: ReturnType<typeof applicableTestTypes>;
}

export interface WorkflowInventory {
  generatedAt: string;
  seedUrl: string;
  workflows: WorkflowRecord[];
  categoryStatus: CategoryStatus[];
}

const AUTH_PATH = /login|signin|sign-in|signup|sign-up|register|auth/i;
const PASSWORD_TYPE = /password/i;

export function inferWorkflows(pageMap: PageMap, elements: UiElementRecord[], api: ApiInventory): WorkflowInventory {
  const workflows: WorkflowRecord[] = [];
  let seq = 1;
  const nextId = () => `WF-${String(seq++).padStart(4, '0')}`;

  const inScopeNav = pageMap.navigation.filter((item) => item.inScope);
  if (inScopeNav.length > 0) {
    workflows.push({
      id: nextId(),
      kind: 'navigation',
      title: 'In-scope link navigation',
      status: 'DISCOVERED',
      evidence: `${inScopeNav.length} in-scope link(s) observed across crawled pages`,
      potentialAction: potentialAction('navigation'),
      applicableTestTypes: applicableTestTypes('navigation'),
    });
  }

  const forms = elements.filter((el) => el.elementType === 'form');
  for (const form of forms) {
    workflows.push({
      id: nextId(),
      kind: 'form-submit',
      title: `Form on ${form.page}`,
      page: form.page,
      status: 'NOT_TESTED',
      evidence: `${form.evidence}; submit is blocked by the safety policy`,
      potentialAction: potentialAction('form'),
      applicableTestTypes: applicableTestTypes('form'),
    });
  }

  const passwordFields = elements.filter(
    (el) =>
      el.elementType === 'input' &&
      (PASSWORD_TYPE.test(el.accessibleName ?? '') ||
        PASSWORD_TYPE.test(el.evidence) ||
        (el.locatorCandidates ?? []).some((locator) => locator.includes('password')))
  );
  const authPages = pageMap.pages.filter((page) => AUTH_PATH.test(page.route));

  if (passwordFields.length > 0 || authPages.length > 0) {
    const evidenceParts = [
      passwordFields.length > 0 ? `${passwordFields.length} password-related field(s)` : null,
      authPages.length > 0 ? `route(s) matching login/signup/auth: ${authPages.map((p) => p.route).join(', ')}` : null,
    ].filter(Boolean);

    workflows.push({
      id: nextId(),
      kind: 'authentication',
      title: 'Potential authentication flow',
      page: passwordFields[0]?.page ?? authPages[0]?.url,
      status: 'REQUIRES_CONFIGURATION',
      evidence: `${evidenceParts.join('; ')} — credentials are not assumed`,
      potentialAction: potentialAction('authentication'),
      applicableTestTypes: applicableTestTypes('authentication'),
    });
  }

  if (api.calls.length > 0) {
    workflows.push({
      id: nextId(),
      kind: 'api',
      title: 'Observed network/API calls during page load',
      status: 'CANDIDATE',
      evidence: `${api.calls.length} xhr/fetch/websocket call(s) observed; request bodies and auth headers were not stored`,
      potentialAction: potentialAction('api'),
      applicableTestTypes: applicableTestTypes('api'),
    });
  }

  const authCount = workflows.filter((item) => item.kind === 'authentication').length;
  const workflowDiscovered = workflows.filter((item) => item.status === 'DISCOVERED').length;
  const workflowCandidates = workflows.filter((item) => item.status === 'CANDIDATE' || item.status === 'REQUIRES_CONFIGURATION').length;

  const categoryStatus: CategoryStatus[] = [
    rollupCategory(
      'authentication',
      0,
      authCount,
      'No password field or login/signup/auth route was observed'
    ),
    rollupCategory(
      'workflow',
      workflowDiscovered,
      workflowCandidates,
      'No navigation, form, authentication, or observed-API workflow evidence'
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    seedUrl: pageMap.seedUrl,
    workflows,
    categoryStatus,
  };
}
