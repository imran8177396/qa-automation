/**
 * Shared artifact registry — one root (PATHS.reports.evidence) for every kind.
 * Kind is a filename prefix / metadata field, not a per-engine directory.
 * Does not rewrite runners or invent capture; callers declare or optionally write tiny fixtures.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { TestResult, TestResultEvidence } from '../core/engine-contract';
import { redactSecrets } from '../core/safety-policy';
import { maskExecutionLogString } from '../core/platform/observability';
import { PATHS, ROOT } from './paths';

/** Fixed artifact kinds — stored under the shared evidence root via filename prefix. */
export const ARTIFACT_KINDS = [
  'screenshot',
  'video',
  'har',
  'request',
  'response',
  'log',
  'trace',
  'jmeter-jtl',
  'playwright-trace',
  'console-log',
  'network-log',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * Every kind maps to the same PATHS.reports.evidence directory.
 * Do not add per-engine roots here.
 */
export const ARTIFACT_DIRECTORIES: Readonly<Record<ArtifactKind, string>> = {
  screenshot: PATHS.reports.evidence,
  video: PATHS.reports.evidence,
  har: PATHS.reports.evidence,
  request: PATHS.reports.evidence,
  response: PATHS.reports.evidence,
  log: PATHS.reports.evidence,
  trace: PATHS.reports.evidence,
  'jmeter-jtl': PATHS.reports.evidence,
  'playwright-trace': PATHS.reports.evidence,
  'console-log': PATHS.reports.evidence,
  'network-log': PATHS.reports.evidence,
};

/** Shared artifact root (PATHS key: reports.evidence). */
export const ARTIFACT_ROOT = PATHS.reports.evidence;

/** Kinds written as text and run through redactSecrets / maskExecutionLogString. */
const TEXT_ARTIFACT_KINDS = new Set<ArtifactKind>([
  'request',
  'response',
  'log',
  'console-log',
  'network-log',
  'har',
]);

/** Binary kinds — not scanned as text; byteLength recorded when content is provided. */
const BINARY_ARTIFACT_KINDS = new Set<ArtifactKind>([
  'screenshot',
  'video',
  'trace',
  'playwright-trace',
  'jmeter-jtl',
]);

export type ArtifactSource = 'registry' | 'existing';

export interface ArtifactRef {
  kind: ArtifactKind;
  runId: string;
  testId: string;
  fileName: string;
  relativePath: string;
  byteLength: number | null;
  sha256: string | null;
  /** Always true — secrets/PII policy applied for text writes; binary never logged. */
  masked: true;
  /**
   * false when write was not requested (declaration only) or source is existing pointer.
   * Reports must not treat written:false registry refs as captured evidence.
   */
  written: boolean;
  source: ArtifactSource;
}

export interface RegisterArtifactInput {
  kind: ArtifactKind;
  runId: string;
  testId: string;
  fileName: string;
  /** Tiny fixture strings / bytes only. Not read from caller disk paths. */
  content?: string | Uint8Array;
  /** Default false — metadata-only declaration; no filesystem write. */
  write?: boolean;
  /**
   * `existing` records a relative path already under PATHS (no copy).
   * Default `registry` places the file under the shared ARTIFACT_ROOT.
   */
  source?: ArtifactSource;
  /** Required when source is `existing` — posix-relative path under an existing PATHS root. */
  relativePath?: string;
  /** Injected root for unit tests (e.g. os.tmpdir()). Defaults to PATHS.reports.evidence. */
  artifactRoot?: string;
}

function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

function assertSafeSegment(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`REQUIRES_CONFIGURATION: artifact ${label} is required and must be non-empty`);
  }
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error(`Artifact ${label} must not be an absolute path`);
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Artifact ${label} must not contain path separators or '..'`);
  }
  return trimmed;
}

function assertSafeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new Error('Artifact fileName is required and must be non-empty');
  }
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error('Artifact fileName must not be an absolute path');
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Artifact fileName must not contain path separators or '..'`);
  }
  return trimmed;
}

function toPosix(relative: string): string {
  return relative.replace(/\\/g, '/');
}

function assertResolvedUnderRoot(resolved: string, root: string, label: string): string {
  const resolvedAbs = path.resolve(resolved);
  const rootAbs = path.resolve(root);
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (resolvedAbs !== rootAbs && !resolvedAbs.startsWith(prefix)) {
    throw new Error(`Refusing to place artifact outside ${label}: ${resolvedAbs}`);
  }
  return resolvedAbs;
}

/** Existing PATHS roots that may already hold externally produced files (no new dirs). */
function existingPathRoots(): string[] {
  return [
    PATHS.reports.root,
    PATHS.allureResults,
    PATHS.allureReport,
    PATHS.jmeterResults,
    path.join(PATHS.root, 'screenshots'),
    path.join(PATHS.root, 'traces'),
    path.join(PATHS.root, 'test-results'),
    path.join(PATHS.root, 'temp'),
  ];
}

function assertUnderExistingPaths(relativePath: string): { absolute: string; relativePosix: string } {
  if (!relativePath.trim()) {
    throw new Error('REQUIRES_CONFIGURATION: relativePath is required when source is existing');
  }
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    throw new Error('Existing artifact relativePath must not be absolute');
  }
  if (relativePath.includes('..')) {
    throw new Error(`Existing artifact relativePath must not contain '..'`);
  }
  const absolute = path.resolve(ROOT, relativePath);
  const allowed = existingPathRoots();
  const under = allowed.some((root) => {
    const rootAbs = path.resolve(root);
    const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    return absolute === rootAbs || absolute.startsWith(prefix);
  });
  if (!under) {
    throw new Error(
      'Existing artifact relativePath must stay under an existing PATHS reports/allure/jmeter/screenshots/traces/test-results/temp root'
    );
  }
  return { absolute, relativePosix: toPosix(path.relative(ROOT, absolute)) };
}

function maskTextContent(text: string): string {
  const redacted = redactSecrets(text);
  const asString = typeof redacted === 'string' ? redacted : String(redacted);
  return maskExecutionLogString(asString);
}

function preparePayload(
  kind: ArtifactKind,
  content: string | Uint8Array | undefined
): { bytes: Buffer | null; byteLength: number | null; sha256: string | null } {
  if (content === undefined) {
    return { bytes: null, byteLength: null, sha256: null };
  }

  let bytes: Buffer;
  if (typeof content === 'string') {
    if (TEXT_ARTIFACT_KINDS.has(kind)) {
      bytes = Buffer.from(maskTextContent(content), 'utf8');
    } else {
      // Binary kinds: do not scan as text; never log the bytes.
      bytes = Buffer.from(content, 'utf8');
    }
  } else if (TEXT_ARTIFACT_KINDS.has(kind)) {
    bytes = Buffer.from(maskTextContent(Buffer.from(content).toString('utf8')), 'utf8');
  } else {
    bytes = Buffer.from(content);
  }

  return {
    bytes,
    byteLength: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function buildRegistryRelativePath(runId: string, testId: string, kind: ArtifactKind, fileName: string): string {
  const leaf = `${testId}--${kind}--${fileName}`;
  return toPosix(path.join('reports', 'evidence', runId, leaf));
}

/**
 * Register an artifact reference. Does not read caller disk paths.
 * Does not copy bytes unless `content` is passed and `write` is true.
 */
export function registerArtifact(input: RegisterArtifactInput): ArtifactRef {
  if (!isArtifactKind(input.kind)) {
    throw new Error(`Unknown artifact kind: ${String(input.kind)}`);
  }
  if (!input.runId || !String(input.runId).trim()) {
    throw new Error('REQUIRES_CONFIGURATION: artifact runId is required');
  }
  if (!input.testId || !String(input.testId).trim()) {
    throw new Error('REQUIRES_CONFIGURATION: artifact testId is required');
  }

  const kind = input.kind;
  const runId = assertSafeSegment('runId', input.runId);
  const testId = assertSafeSegment('testId', input.testId);
  const fileName = assertSafeFileName(input.fileName);
  const source: ArtifactSource = input.source === 'existing' ? 'existing' : 'registry';
  const write = input.write === true;

  if (source === 'existing') {
    if (write) {
      throw new Error('source:existing must not set write:true (no copy; pointer only)');
    }
    const existing = assertUnderExistingPaths(input.relativePath ?? '');
    const payload = preparePayload(kind, input.content);
    return {
      kind,
      runId,
      testId,
      fileName,
      relativePath: existing.relativePosix,
      byteLength: payload.byteLength,
      sha256: payload.sha256,
      masked: true,
      written: false,
      source: 'existing',
    };
  }

  const artifactRoot = input.artifactRoot ?? ARTIFACT_DIRECTORIES[kind];
  const leaf = `${testId}--${kind}--${fileName}`;
  const absolute = assertResolvedUnderRoot(path.join(artifactRoot, runId, leaf), artifactRoot, 'artifact root');
  const relativePath =
    input.artifactRoot !== undefined
      ? toPosix(path.relative(artifactRoot, absolute))
      : buildRegistryRelativePath(runId, testId, kind, fileName);

  const payload = preparePayload(kind, input.content);

  if (!write) {
    return {
      kind,
      runId,
      testId,
      fileName,
      relativePath,
      byteLength: payload.byteLength,
      sha256: payload.sha256,
      masked: true,
      written: false,
      source: 'registry',
    };
  }

  if (payload.bytes === null) {
    throw new Error('write:true requires content (string | Uint8Array); refusing empty capture claim');
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, payload.bytes);

  return {
    kind,
    runId,
    testId,
    fileName,
    relativePath,
    byteLength: payload.byteLength,
    sha256: payload.sha256,
    masked: true,
    written: true,
    source: 'registry',
  };
}

/**
 * Attach artifact refs onto the existing evidence field reports already read.
 * Does not change status (FAIL stays FAIL).
 */
export function attachArtifactsToResult(result: TestResult, refs: ArtifactRef[]): TestResult {
  const prior = result.evidence?.artifacts ?? [];
  const artifacts = [...prior, ...refs];
  const evidence: TestResultEvidence = {
    ...(result.evidence ?? {}),
    artifacts,
  };

  // Convenience paths for written / existing pointers only — never for declarations.
  for (const ref of refs) {
    if (ref.written !== true && ref.source !== 'existing') continue;
    if (ref.kind === 'screenshot' && !evidence.screenshot) {
      evidence.screenshot = ref.relativePath;
    }
    if (
      (ref.kind === 'log' || ref.kind === 'console-log' || ref.kind === 'network-log') &&
      !evidence.log
    ) {
      evidence.log = ref.relativePath;
    }
  }

  return {
    ...result,
    evidence,
    status: result.status,
  };
}

/** Paths safe to list in the Evidence report column (captured or existing pointer). */
export function artifactPathsForEvidenceColumn(refs: ArtifactRef[] | undefined): string[] {
  if (!refs || refs.length === 0) return [];
  return refs
    .filter((ref) => ref.written === true || ref.source === 'existing')
    .map((ref) => ref.relativePath.replace(/\\/g, '/'));
}

export function isTextArtifactKind(kind: ArtifactKind): boolean {
  return TEXT_ARTIFACT_KINDS.has(kind);
}

export function isBinaryArtifactKind(kind: ArtifactKind): boolean {
  return BINARY_ARTIFACT_KINDS.has(kind);
}
