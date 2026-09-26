import type { ExpectedHttpStatus } from '../../types';

/**
 * Observed body classification. Reuses the project's responseShape labels
 * (`array` | `object` | `empty`) and `non-json` when the body is not empty JSON
 * array/object (invalid JSON, primitives, HTML, etc.).
 */
export type ObservedResponseShape = 'array' | 'object' | 'empty' | 'non-json';

/** Statuses that must surface actual responseShape + expected status in findings. */
export function needsErrorStatusShapeDetail(statusCode: number): boolean {
  return statusCode === 400 || (statusCode >= 500 && statusCode <= 599);
}

/**
 * Classify a response body text using the same shapes Postman assertions use
 * for array/object/empty; anything else is non-json.
 */
export function classifyResponseShape(bodyText: string | null | undefined): ObservedResponseShape {
  if (bodyText == null) return 'non-json';
  if (bodyText === '') return 'empty';
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (Array.isArray(parsed)) return 'array';
    if (parsed !== null && typeof parsed === 'object') return 'object';
    return 'non-json';
  } catch {
    return 'non-json';
  }
}

/**
 * Exact wording for 400 / 5xx rows: actual responseShape and expected status.
 * Does not invent or flip expectedStatus (UNVERIFIED stays UNVERIFIED).
 */
export function formatErrorStatusDetail(input: {
  actualStatus: number;
  responseShape: ObservedResponseShape;
  expectedStatus: ExpectedHttpStatus;
}): string {
  return `HTTP ${input.actualStatus} (actual responseShape: ${input.responseShape}; expected status: ${input.expectedStatus})`;
}

/** Decode Newman/Postman CLI JSON report response body when present. */
export function decodeExecutionResponseBody(response: {
  body?: string;
  stream?: { type?: string; data?: number[] } | string | number[];
} | null | undefined): string | null {
  if (!response) return null;
  if (typeof response.body === 'string') return response.body;
  const stream = response.stream;
  if (typeof stream === 'string') return stream;
  if (Array.isArray(stream)) {
    return Buffer.from(stream).toString('utf8');
  }
  if (stream && typeof stream === 'object' && Array.isArray(stream.data)) {
    return Buffer.from(stream.data).toString('utf8');
  }
  return null;
}
