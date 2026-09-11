import type { SafetyConfigResolved } from '../core/safety-policy';
import type { DiscoveryConfigResolved } from '../core/scope';

export interface DiscoveredPage {
  url: string;
  status: number | null;
  ok: boolean;
  title: string;
  h1s: string[];
  formCount: number;
  linkCount: number;
  consoleErrors: string[];
  failedRequests: Array<{ url: string; method: string; failure: string }>;
  depth: number;
  error?: string;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  totalImages: number;
  imagesWithoutAlt: number;
  /** Observed <a href> values on this page. Not filtered by crawl follow rules. */
  outboundLinks?: Array<{ href: string; text: string }>;
  /** Apache-style directory listing. SEO/content analysis is skipped for this URL. */
  isAutoindex?: boolean;
}

export interface DiscoveryResult {
  seedUrl: string;
  scopeHost: string;
  crawledAt: string;
  pages: DiscoveredPage[];
  skippedByScope: string[];
  skippedByExclude?: string[];
  /** Distinct candidate URLs seen before normalize/dedupe. */
  pagesDiscoveredRaw: number;
  /** Unique normalized URLs that were crawled. */
  pagesDiscoveredUnique: number;
  truncated: boolean;
}

export type CrawlOptions = DiscoveryConfigResolved & { safety: SafetyConfigResolved };
