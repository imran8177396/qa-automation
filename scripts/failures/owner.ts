import { NOT_AVAILABLE } from '../lib/suite-origin';
import type {
  FailureClass,
  FailureEvidence,
  OwnerClassificationRule,
  OwnerFailureClass,
} from './types';
import { OWNER_FAILURE_CLASSES } from './types';

const APPLICATION_SOURCES = new Set([
  'security',
  'seo',
  'content',
  'accessibility',
  'accessibility-findings',
]);

const CONFIGURATION_TEXT =
  /requires_configuration|qa_username|qa_password|qa_api_token|credentials? (are )?(not |missing)|env(ironment)? variable|\.env\b|not configured|auth contract (is )?absent|documented contract/i;

const TEST_DATA_TEXT =
  /test data|fixture data|seed data|invalid (test )?user|wrong (username|password) for (the )?(fixture|test)|placeholder credential|stale fixture/i;

const DEPENDENCY_TEXT =
  /cannot find module|npm audit|advisory|eresolve|peer dep|module not found|node_modules missing|vulnerabilit(y|ies) in /i;

const NETWORK_TEXT =
  /econnrefused|enotfound|econnreset|etimedout|eai_again|getaddrinfo|socket hang up|net::err_|dns_probe|err_name_not_resolved|err_internet_disconnected|network error/i;

const BROWSER_TEXT =
  /browser logs:|tearing down ["']context["']|setting up ["']page["']|rendercompositor|juggler|gfx1-|target closed|browser has been closed|browser closed|page crashed|protocol error.*session/i;

const ENVIRONMENT_TEXT =
  /browserType\.launch|executable doesn't exist|playwright install|enoent|sandbox|display.*not|:99|xvfb/i;

const APPLICATION_TEXT =
  /axe violation|page-has-heading-one|heading-structure|content-security-policy|strict-transport-security|missing-h1|missing-canonical|missing-open-graph|sitemap\.xml|x-content-type-options|referrer-policy|permissions-policy|clickjacking|sensitive-information|demo-password-dump|og:title|canonical <link>|page should contain a level-one heading/i;

const AUTOMATION_TEXT =
  /locator\.|getbyrole|getbylabel|getbytext|getbyplaceholder|getbytestid|waiting for (locator|selector|element)|element\(s\) not found|strict mode violation|resolved to \d+ elements/i;

export interface OwnerClassification {
  ownerClassification: OwnerFailureClass;
  ownerRuleFired: OwnerClassificationRule;
  ownerRationale: string;
  confidence: 'high' | 'medium' | 'low';
}

function combinedText(evidence: FailureEvidence): string {
  return `${evidence.errorMessage}\n${evidence.stackTrace}\n${evidence.consoleLog ?? ''}\n${evidence.networkLog ?? ''}\n${evidence.source}\n${evidence.title}`;
}

function hasUsableText(evidence: FailureEvidence): boolean {
  const parts = [evidence.errorMessage, evidence.stackTrace, evidence.consoleLog, evidence.networkLog];
  return parts.some((part) => Boolean(part && part !== NOT_AVAILABLE && part.trim()));
}

export function emptyOwnerCounts(): Record<OwnerFailureClass, number> {
  return {
    APPLICATION: 0,
    AUTOMATION: 0,
    ENVIRONMENT: 0,
    TEST_DATA: 0,
    CONFIGURATION: 0,
    NETWORK: 0,
    BROWSER: 0,
    DEPENDENCY: 0,
    UNKNOWN: 0,
  };
}

export function summarizeByOwnerClass(
  rows: Array<{ ownerClassification?: OwnerFailureClass }>
): Record<OwnerFailureClass, number> {
  const base = emptyOwnerCounts();
  for (const row of rows) {
    const key = row.ownerClassification && OWNER_FAILURE_CLASSES.includes(row.ownerClassification)
      ? row.ownerClassification
      : 'UNKNOWN';
    base[key] += 1;
  }
  return base;
}

export function classifyOwner(
  evidence: FailureEvidence,
  mechanism: FailureClass
): OwnerClassification {
  const text = combinedText(evidence);
  const source = evidence.source.toLowerCase();

  if (!hasUsableText(evidence) && mechanism === 'UNKNOWN') {
    return {
      ownerClassification: 'UNKNOWN',
      ownerRuleFired: 'INSUFFICIENT_EVIDENCE',
      ownerRationale:
        'Insufficient evidence (no error, stack, console, or network text) — not invented.',
      confidence: 'low',
    };
  }

  if (source === 'dependencies' || DEPENDENCY_TEXT.test(text)) {
    return {
      ownerClassification: 'DEPENDENCY',
      ownerRuleFired: source === 'dependencies' ? 'SOURCE_DEPENDENCY' : 'ERROR_TEXT_DEPENDENCY',
      ownerRationale:
        source === 'dependencies'
          ? 'Failure recorded by the dependency/secrets stage (advisory or missing package).'
          : 'Error text indicates a missing module or dependency advisory.',
      confidence: 'high',
    };
  }

  if (CONFIGURATION_TEXT.test(text)) {
    return {
      ownerClassification: 'CONFIGURATION',
      ownerRuleFired: 'ERROR_TEXT_CONFIGURATION',
      ownerRationale: 'Error text indicates missing credentials, env, or qa.config contract.',
      confidence: 'high',
    };
  }

  if (TEST_DATA_TEXT.test(text)) {
    return {
      ownerClassification: 'TEST_DATA',
      ownerRuleFired: 'ERROR_TEXT_TEST_DATA',
      ownerRationale: 'Error text indicates fixture or seeded test-data mismatch.',
      confidence: 'medium',
    };
  }

  if (mechanism === 'NETWORK_ERROR' || NETWORK_TEXT.test(text)) {
    return {
      ownerClassification: 'NETWORK',
      ownerRuleFired: 'ERROR_TEXT_NETWORK',
      ownerRationale: 'Connection, DNS, or net::ERR_ failure in captured error/network text.',
      confidence: 'high',
    };
  }

  if (BROWSER_TEXT.test(text)) {
    return {
      ownerClassification: 'BROWSER',
      ownerRuleFired: 'ERROR_TEXT_BROWSER',
      ownerRationale:
        'Browser-engine teardown, crash, or Browser logs were captured (not converted to PASS).',
      confidence: 'high',
    };
  }

  if (mechanism === 'ENVIRONMENT' || ENVIRONMENT_TEXT.test(text)) {
    return {
      ownerClassification: 'ENVIRONMENT',
      ownerRuleFired: 'ERROR_TEXT_ENVIRONMENT',
      ownerRationale: 'Runtime/browser-install or environment failure in captured error text.',
      confidence: 'high',
    };
  }

  if (
    APPLICATION_SOURCES.has(source) ||
    APPLICATION_TEXT.test(text) ||
    mechanism === 'CONSOLE_ERROR'
  ) {
    return {
      ownerClassification: 'APPLICATION',
      ownerRuleFired: APPLICATION_SOURCES.has(source)
        ? 'SOURCE_APPLICATION_QUALITY'
        : 'MECHANISM_APPLICATION',
      ownerRationale: APPLICATION_SOURCES.has(source)
        ? `Stage finding from ${evidence.source} describes product behavior (headers, SEO, a11y, or content).`
        : 'Captured text describes product quality (axe/SEO/security/console) — assertion stays FAIL.',
      confidence: 'high',
    };
  }

  if (
    mechanism === 'ELEMENT_TIMEOUT' ||
    mechanism === 'FLAKY' ||
    (AUTOMATION_TEXT.test(text) && mechanism !== 'ASSERTION_FAILURE')
  ) {
    return {
      ownerClassification: 'AUTOMATION',
      ownerRuleFired: 'MECHANISM_AUTOMATION',
      ownerRationale:
        'Locator, wait, or mixed-retry signal — treat as automation unless product evidence appears.',
      confidence: mechanism === 'FLAKY' ? 'high' : 'medium',
    };
  }

  if (mechanism === 'NAVIGATION_TIMEOUT') {
    return {
      ownerClassification: 'ENVIRONMENT',
      ownerRuleFired: 'MECHANISM_ENVIRONMENT',
      ownerRationale:
        'Navigation/test timeout without a network or browser-engine signature — environment/load.',
      confidence: 'medium',
    };
  }

  if (mechanism === 'ASSERTION_FAILURE') {
    return {
      ownerClassification: 'APPLICATION',
      ownerRuleFired: 'MECHANISM_APPLICATION',
      ownerRationale:
        'Assertion mismatch against observed product behavior. Do not weaken the assertion.',
      confidence: 'medium',
    };
  }

  return {
    ownerClassification: 'UNKNOWN',
    ownerRuleFired: 'INSUFFICIENT_EVIDENCE',
    ownerRationale: 'Evidence did not match a confident owner class.',
    confidence: 'low',
  };
}
