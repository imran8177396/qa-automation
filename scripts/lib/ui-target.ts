import { loadConfig } from './load-config';
import { isLoopbackUrl } from '../orchestrator/resolve-url';
import { originOf } from './suite-origin';
import type { QaConfig } from '../types';

export interface ResolvedUiTarget {
  url: string;
  origin: string;
  isLoopback: boolean;
  source: 'env' | 'config';
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/\/+$/, '');
}

/**
 * URL every UI suite (e2e, generated, visual, responsive, a11y, workflows) must hit.
 * Env (set by qa:all) wins, then qa.config.json playwright.baseURL.
 * Never invents a fixture origin when a live URL is configured.
 */
export function resolveUiTarget(config: QaConfig = loadConfig()): ResolvedUiTarget {
  const envRaw = process.env.QA_PLAYWRIGHT_BASE_URL?.trim() || '';
  const raw = envRaw || config.playwright.baseURL;
  const url = normalizeUrl(raw);
  return {
    url,
    origin: originOf(url),
    isLoopback: isLoopbackUrl(url),
    source: envRaw ? 'env' : 'config',
  };
}

export function isFixtureUiTarget(config?: QaConfig): boolean {
  return resolveUiTarget(config).isLoopback;
}
