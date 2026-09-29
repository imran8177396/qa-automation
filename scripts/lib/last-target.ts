import { isLoopbackHost } from '../orchestrator/resolve-url';
import { readJsonIfExists, writeJson } from '../discovery/write-json';
import { PATHS } from './paths';

/**
 * Persisted last website target (`qa.last-target.json`).
 *
 * Resolution order is centralized in `resolveWebsiteTarget`
 * (`scripts/orchestrator/resolve-url.ts`):
 * 1. CLI `--url` / positional
 * 2. `QA_PLAYWRIGHT_BASE_URL`
 * 3. `QA_WEBSITE_URL`
 * 4. this file
 * 5. discovery seed (orchestrator/discover only)
 * 6. loopback `playwright.baseURL` only
 * 7. `qa.config.json` `urls.website` (example fallback only)
 *
 * A newer CLI URL overwrites this file. qa:clean must not delete it.
 */

export const LAST_TARGET_SOURCE_CLI = 'cli-url' as const;

export type LastTargetSource = typeof LAST_TARGET_SOURCE_CLI;

export interface LastTargetRecord {
  websiteUrl: string;
  updatedAt: string;
  source: LastTargetSource;
}

/** Drop username/password from a URL before persist or env copy. Never log the original userinfo. */
export function stripUrlUserinfo(url: URL, originalWhenClean?: string): string {
  if (!url.username && !url.password) {
    return originalWhenClean ?? url.href;
  }
  const cleaned = new URL(url.href);
  cleaned.username = '';
  cleaned.password = '';
  return cleaned.href;
}

export function parsePersistableWebsiteUrl(
  value: string,
  options?: { allowLoopback?: boolean }
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!options?.allowLoopback && isLoopbackHost(parsed.hostname)) return null;
  return stripUrlUserinfo(parsed, trimmed);
}

export function readLastTargetUrl(filePath: string = PATHS.lastTarget): string | null {
  const record = readJsonIfExists<LastTargetRecord>(filePath);
  if (!record || typeof record.websiteUrl !== 'string') return null;
  return parsePersistableWebsiteUrl(record.websiteUrl, { allowLoopback: true });
}

export function persistLastTargetUrl(
  url: string,
  source: LastTargetSource = LAST_TARGET_SOURCE_CLI,
  options?: { filePath?: string; allowLoopback?: boolean; now?: Date }
): LastTargetRecord | null {
  const websiteUrl = parsePersistableWebsiteUrl(url, {
    allowLoopback: options?.allowLoopback === true,
  });
  if (!websiteUrl) return null;
  const record: LastTargetRecord = {
    websiteUrl,
    updatedAt: (options?.now ?? new Date()).toISOString(),
    source,
  };
  writeJson(options?.filePath ?? PATHS.lastTarget, record);
  return record;
}

/** Persist only an explicit CLI `--url` / positional value. Overwrites the previous target. */
export function persistCliWebsiteUrl(
  cliUrl: string | undefined,
  options?: { filePath?: string; now?: Date }
): LastTargetRecord | null {
  if (!cliUrl) return null;
  return persistLastTargetUrl(cliUrl, LAST_TARGET_SOURCE_CLI, {
    ...options,
    allowLoopback: true,
  });
}

export function websiteTargetEnv(url: string): {
  QA_WEBSITE_URL: string;
  QA_PLAYWRIGHT_BASE_URL: string;
} {
  const trimmed = url.trim();
  let sanitized = trimmed;
  try {
    sanitized = stripUrlUserinfo(new URL(trimmed), trimmed);
  } catch {
    // Non-URL values are rejected elsewhere; keep trim-only fallback for callers.
  }
  const base = sanitized.replace(/\/+$/, '');
  return {
    QA_WEBSITE_URL: sanitized.endsWith('/') ? sanitized : `${sanitized}/`,
    QA_PLAYWRIGHT_BASE_URL: base,
  };
}
