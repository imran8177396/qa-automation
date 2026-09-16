import type { SafetyConfigResolved } from '../core/safety-policy';
import type { DiscoveryConfigResolved } from '../core/scope';
import type { DiscoveryCredentials } from './credentials';
import type { AuthAttempt } from './auth-session';
import type { RedirectHop } from './redirects';

export type PageAccess = 'public' | 'authenticated' | 'gated' | 'error';

export interface PageHeading {
  level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  text: string;
}

export type NavigationRegionKind =
  | 'header'
  | 'footer'
  | 'sidebar'
  | 'breadcrumbs'
  | 'menu'
  | 'pagination'
  | 'tabs';

export interface NavigationRegion {
  page: string;
  kind: NavigationRegionKind;
  locator: string | null;
  accessibleName: string | null;
  visible: boolean;
}

export interface DiscoveredPage {
  url: string;
  finalUrl?: string;
  status: number | null;
  ok: boolean;
  title: string;
  h1s: string[];
  headings?: PageHeading[];
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
  redirects?: RedirectHop[];
  access?: PageAccess;
  gatedReason?: string;
  navigationRegions?: NavigationRegion[];
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
  auth?: AuthAttempt;
}

export type CrawlOptions = DiscoveryConfigResolved & {
  safety: SafetyConfigResolved;
  /** Env credentials only. Never persisted to discovery JSON. */
  credentials?: DiscoveryCredentials | null;
};
