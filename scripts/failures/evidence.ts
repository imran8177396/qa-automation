import fs from 'fs';
import path from 'path';
import { ROOT } from '../lib/paths';
import { toPosixRelative } from '../lib/playwright-suites';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { EvidenceAvailability, EvidenceKind, EvidenceRefs, FailureEvidence } from './types';
import { EVIDENCE_KINDS } from './types';

const BROWSER_LOGS_BLOCK = /Browser logs:\s*([\s\S]+)$/i;
const NETWORK_LINE =
  /net::err_[a-z0-9_]+|econnrefused|enotfound|econnreset|etimedout|eai_again|getaddrinfo|socket hang up|dns_probe|err_name_not_resolved|err_internet_disconnected/i;

export function stripOrUnavailable(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : NOT_AVAILABLE;
}

export function resolveExistingArtifact(raw: string | null | undefined): {
  recordedPath: string | null;
  present: boolean;
} {
  if (!raw || raw === NOT_AVAILABLE) return { recordedPath: null, present: false };
  const abs = path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
  const recordedPath = toPosixRelative(abs);
  return { recordedPath, present: fs.existsSync(abs) };
}

export function nearbyErrorContext(artifactPath: string | null): string | null {
  if (!artifactPath) return null;
  const abs = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(ROOT, artifactPath);
  const sibling = path.join(path.dirname(abs), 'error-context.md');
  return fs.existsSync(sibling) ? toPosixRelative(sibling) : null;
}

export function extractBrowserLogs(errorMessage: string): string {
  if (!errorMessage || errorMessage === NOT_AVAILABLE) return NOT_AVAILABLE;
  const match = errorMessage.match(BROWSER_LOGS_BLOCK);
  return match?.[1]?.trim() ? match[1].trim() : NOT_AVAILABLE;
}

export function extractNetworkExcerpt(text: string): string {
  if (!text || text === NOT_AVAILABLE) return NOT_AVAILABLE;
  const lines = text.split(/\r?\n/).filter((line) => NETWORK_LINE.test(line));
  return lines.length ? lines.slice(0, 8).join('\n') : NOT_AVAILABLE;
}

function availability(present: boolean): EvidenceAvailability {
  return present ? 'present' : 'unavailable';
}

export function buildEvidenceRefs(evidence: FailureEvidence): EvidenceRefs {
  const error = stripOrUnavailable(evidence.errorMessage);
  const stackTrace = stripOrUnavailable(evidence.stackTrace);
  const screenshot = evidence.screenshotPresent
    ? evidence.screenshotPath ?? NOT_AVAILABLE
    : NOT_AVAILABLE;
  const video = evidence.videoPresent ? evidence.videoPath ?? NOT_AVAILABLE : NOT_AVAILABLE;
  const trace = evidence.tracePresent ? evidence.tracePath ?? NOT_AVAILABLE : NOT_AVAILABLE;
  const consoleLog = evidence.consolePresent
    ? stripOrUnavailable(evidence.consoleLog)
    : NOT_AVAILABLE;
  const network = evidence.networkPresent
    ? stripOrUnavailable(evidence.networkLog)
    : NOT_AVAILABLE;
  const logs = evidence.logPresent ? evidence.logPath ?? NOT_AVAILABLE : NOT_AVAILABLE;

  const refs: EvidenceRefs = {
    error,
    stackTrace,
    screenshot,
    video,
    trace,
    console: consoleLog,
    network,
    logs,
    availability: {
      error: availability(error !== NOT_AVAILABLE),
      stackTrace: availability(stackTrace !== NOT_AVAILABLE),
      screenshot: availability(Boolean(evidence.screenshotPresent)),
      video: availability(Boolean(evidence.videoPresent)),
      trace: availability(Boolean(evidence.tracePresent)),
      console: availability(Boolean(evidence.consolePresent)),
      network: availability(Boolean(evidence.networkPresent)),
      logs: availability(Boolean(evidence.logPresent)),
    },
  };
  return refs;
}

export function summarizeEvidenceAvailability(
  refs: EvidenceRefs
): Record<EvidenceKind, EvidenceAvailability> {
  return { ...refs.availability };
}

export { EVIDENCE_KINDS };
