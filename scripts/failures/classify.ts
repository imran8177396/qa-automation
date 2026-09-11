import { NOT_AVAILABLE } from '../lib/suite-origin';
import {
  DEFAULT_CLASSIFICATION_TIMEOUTS_MS,
  nearestConfiguredTimeout,
  timeoutMsFromErrorText,
  isDurationNearTimeout,
  TIMEOUT_PROXIMITY_RATIO,
} from './timeouts';
import type {
  ClassifiedFailure,
  FailureClass,
  FailureClassificationRule,
  FailureEvidence,
} from './types';

const EVIDENCE_EXCERPT_MAX = 400;

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

export function evidenceExcerptFrom(text: string): string {
  const cleaned = stripAnsi(text).replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === NOT_AVAILABLE) return NOT_AVAILABLE;
  if (cleaned.length <= EVIDENCE_EXCERPT_MAX) return cleaned;
  return `${cleaned.slice(0, EVIDENCE_EXCERPT_MAX)}…`;
}

function durationValue(evidence: FailureEvidence): number | null {
  return typeof evidence.durationMs === 'number' && Number.isFinite(evidence.durationMs)
    ? evidence.durationMs
    : null;
}

function hasMixedRetryOutcomes(evidence: FailureEvidence): boolean {
  const statuses = evidence.attemptStatuses.map((row) => row.toLowerCase());
  const passed = statuses.some((row) => row === 'passed' || row === 'pass' || row === 'expected');
  const failed = statuses.some(
    (row) => row === 'failed' || row === 'fail' || row === 'timedout' || row === 'unexpected'
  );
  return passed && failed;
}

const NAVIGATION_TEXT =
  /page\.goto|navigation timeout|waiting for navigation|waiting until.*(load|domcontentloaded|networkidle)|net::err_connection_timed_out|tearing down ["']context["']|test timeout/i;

const ELEMENT_TEXT =
  /locator|getbyrole|getbylabel|getbytext|getbyplaceholder|getbytestid|waiting for (locator|selector|element)|element\(s\) not found|tobevisible|tobeattached|tobehidden|tohavecount/i;

const NETWORK_TEXT =
  /econnrefused|enotfound|econnreset|etimedout|eai_again|getaddrinfo|socket hang up|net::err_|dns|network error/i;

const CONSOLE_TEXT = /console\.error|pageerror|page error|uncaught (exception|error) in page/i;

const ENVIRONMENT_TEXT =
  /browserType\.launch|executable doesn't exist|browser has been closed|playwright install|browser.*not found|enoent/i;

const FLAKY_TEXT = /\bflaky\b|intermittent|race condition|was not stable/i;

const ASSERTION_TEXT =
  /expect\(|tohave|toequal|tobe\(|tocontain|tobestrict|expected:|received:|actual:|assertion/i;

function prefersElement(text: string): boolean {
  return ELEMENT_TEXT.test(text) && !NAVIGATION_TEXT.test(text);
}

function prefersNavigation(text: string): boolean {
  return NAVIGATION_TEXT.test(text);
}

export function classifyFailure(evidence: FailureEvidence): ClassifiedFailure {
  const rawText = `${evidence.errorMessage}\n${evidence.stackTrace}`;
  const text = stripAnsi(rawText);
  const excerptSource = [evidence.errorMessage, evidence.stackTrace]
    .filter((part) => part && part !== NOT_AVAILABLE)
    .join('\n');
  const excerpt = evidenceExcerptFrom(excerptSource);
  const durationMs = durationValue(evidence);

  let classification: FailureClass = 'UNKNOWN';
  let ruleFired: FailureClassificationRule = 'INSUFFICIENT_EVIDENCE';
  let confidence: ClassifiedFailure['confidence'] = 'low';
  let rationale = 'Insufficient evidence for a confident classification.';

  const near = durationMs != null ? nearestConfiguredTimeout(durationMs) : null;
  const mentionedTimeout = timeoutMsFromErrorText(text);
  const nearMentioned =
    durationMs != null && mentionedTimeout != null
      ? isDurationNearTimeout(durationMs, mentionedTimeout, TIMEOUT_PROXIMITY_RATIO)
      : false;

  if (near || nearMentioned) {
    const timeoutKind = near?.key;
    if (prefersElement(text) || timeoutKind === 'actionTimeoutMs' || timeoutKind === 'expectTimeoutMs') {
      classification = 'ELEMENT_TIMEOUT';
      ruleFired = 'TIMEOUT_NEAR_DURATION_ELEMENT';
      rationale = `Duration ${durationMs ?? NOT_AVAILABLE}ms is within ${TIMEOUT_PROXIMITY_RATIO * 100}% of a configured element/expect timeout — not an assertion failure.`;
    } else {
      classification = 'NAVIGATION_TIMEOUT';
      ruleFired = 'TIMEOUT_NEAR_DURATION_NAVIGATION';
      rationale = `Duration ${durationMs ?? NOT_AVAILABLE}ms is within ${TIMEOUT_PROXIMITY_RATIO * 100}% of a configured navigation/test timeout — not an assertion failure.`;
    }
    confidence = 'high';
  } else if (NETWORK_TEXT.test(text)) {
    classification = 'NETWORK_ERROR';
    ruleFired = 'ERROR_TEXT_NETWORK';
    confidence = 'high';
    rationale = 'Connection, DNS, or net::ERR_ failure detected in captured error text.';
  } else if (CONSOLE_TEXT.test(text)) {
    classification = 'CONSOLE_ERROR';
    ruleFired = 'ERROR_TEXT_CONSOLE';
    confidence = 'medium';
    rationale = 'Page console or pageerror text was captured.';
  } else if (ENVIRONMENT_TEXT.test(text)) {
    classification = 'ENVIRONMENT';
    ruleFired = 'ERROR_TEXT_ENVIRONMENT';
    confidence = 'high';
    rationale = 'Browser or runtime environment failure detected in captured error text.';
  } else if (hasMixedRetryOutcomes(evidence)) {
    classification = 'FLAKY';
    ruleFired = 'MIXED_RETRY_OUTCOMES';
    confidence = 'high';
    rationale = 'The same test recorded both passing and failing attempts.';
  } else if (FLAKY_TEXT.test(text)) {
    classification = 'FLAKY';
    ruleFired = 'ERROR_TEXT_FLAKY';
    confidence = 'medium';
    rationale = 'Error text describes an intermittent or unstable failure.';
  } else if (prefersNavigation(text) || /timeout.*navigation|navigation.*timeout/i.test(text)) {
    classification = 'NAVIGATION_TIMEOUT';
    ruleFired = 'ERROR_TEXT_NAVIGATION_TIMEOUT';
    confidence = 'medium';
    rationale = 'Error text indicates a navigation or page-load timeout (duration was NOT_AVAILABLE or not near a configured timeout).';
  } else if (ELEMENT_TEXT.test(text) && /timeout/i.test(text)) {
    classification = 'ELEMENT_TIMEOUT';
    ruleFired = 'ERROR_TEXT_ELEMENT_TIMEOUT';
    confidence = 'medium';
    rationale = 'Error text indicates an element/locator timeout (duration was NOT_AVAILABLE or not near a configured timeout).';
  } else if (ASSERTION_TEXT.test(text)) {
    classification = 'ASSERTION_FAILURE';
    ruleFired = 'ERROR_TEXT_ASSERTION';
    confidence = 'medium';
    rationale = 'Assertion mismatch after reaching the page — not a timeout-proximity match.';
  }

  return {
    id: evidence.id,
    testId: evidence.testId,
    source: evidence.source,
    title: evidence.title,
    classification,
    ruleFired,
    evidenceExcerpt: excerpt,
    confidence,
    rationale,
    evidence,
  };
}

export function classifyFailures(evidence: FailureEvidence[]): ClassifiedFailure[] {
  return evidence.map(classifyFailure);
}

export function summarizeByClass(failures: ClassifiedFailure[]): Record<FailureClass, number> {
  const base: Record<FailureClass, number> = {
    ASSERTION_FAILURE: 0,
    NAVIGATION_TIMEOUT: 0,
    ELEMENT_TIMEOUT: 0,
    NETWORK_ERROR: 0,
    CONSOLE_ERROR: 0,
    ENVIRONMENT: 0,
    FLAKY: 0,
    UNKNOWN: 0,
  };
  for (const row of failures) base[row.classification] += 1;
  return base;
}

export { DEFAULT_CLASSIFICATION_TIMEOUTS_MS, TIMEOUT_PROXIMITY_RATIO, isDurationNearTimeout };
