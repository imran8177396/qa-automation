/**
 * Authenticated discovery coverage over existing screen/page evidence.
 * Does not crawl, launch Playwright, submit login, or invent admin/super-admin URLs.
 *
 * Access-layer example (documentation only — never emitted as screens or URLs):
 *   Public → Login → User → Admin → Super Admin
 * Those names are access layers, not paths to invent. Only caller-supplied session
 * keys and crawled page evidence appear in AuthenticatedCoverage.
 */

import { isGenericAuthRoute } from './inventory';

export type AccessGate =
  | 'public'
  | 'login'
  | 'role'
  | 'permission'
  | 'organization'
  | 'tenant'
  | 'subscription'
  | 'feature-flag';

export type AccessLayerStatus =
  | 'DISCOVERED'
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION'
  | 'BLOCKED';

export type AuthenticationEvidence = 'gated' | 'authenticated' | 'public' | 'unknown';

export interface AccessLayer {
  gate: AccessGate;
  /** Role/org/tenant/flag value only when the caller or session supplied it. Never a default of "admin". */
  key?: string;
  status: AccessLayerStatus;
  reason: string;
  screenIds: string[];
}

export interface AuthenticatedCoverage {
  layers: AccessLayer[];
  /** Screens from the page map that were crawled without an auth gate. */
  publicScreenIds: string[];
}

/** Session context for authenticated discovery — labels never defaulted. */
export interface AuthenticatedCoverageSession {
  established: boolean;
  roles?: string[];
  permissions?: string[];
  organizationId?: string;
  tenantId?: string;
  subscription?: string;
  featureFlags?: string[];
}

export type AuthenticatedCoverageEnvironment =
  | 'local'
  | 'development'
  | 'staging'
  | 'production';

export interface AuthenticatedCoverageScreenInput {
  id: string;
  url: string;
  state: string;
  authenticationRequired?: boolean;
  /** From ScreenInventory.metadata.authenticationEvidence — unknown is never treated as public. */
  authenticationEvidence?: AuthenticationEvidence;
}

export interface AuthenticatedCoveragePageInput {
  url: string;
  access?: string;
  status?: number;
  /** Existing crawl metadata only — never invented here. */
  metadata?: Record<string, unknown>;
}

export interface BuildAuthenticatedCoverageInput {
  screens: AuthenticatedCoverageScreenInput[];
  pages: AuthenticatedCoveragePageInput[];
  session?: AuthenticatedCoverageSession | null;
  environment?: AuthenticatedCoverageEnvironment;
  authorizeAuthenticatedDiscovery?: boolean;
}

const SESSION_GATES: Array<{
  gate: Exclude<AccessGate, 'public' | 'login'>;
  missingReason: string;
}> = [
  { gate: 'role', missingReason: 'role was not supplied' },
  { gate: 'permission', missingReason: 'permission was not supplied' },
  { gate: 'organization', missingReason: 'organization was not supplied' },
  { gate: 'tenant', missingReason: 'tenant was not supplied' },
  { gate: 'subscription', missingReason: 'subscription was not supplied' },
  { gate: 'feature-flag', missingReason: 'feature flag was not supplied' },
];

const PRODUCTION_BLOCKED_REASON =
  'authenticated discovery is not authorized against production';

const SESSION_NOT_ESTABLISHED_REASON =
  'authenticated discovery was not run; session was not established';

const ROLE_NOT_RECORDED_REASON =
  'screens were crawled with a session but the active role was not recorded on each screen';

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '/';
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return url.trim();
  }
}

function routeOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
  } catch {
    return url;
  }
}

function indexPagesByUrl(pages: AuthenticatedCoveragePageInput[]): Map<string, AuthenticatedCoveragePageInput> {
  const map = new Map<string, AuthenticatedCoveragePageInput>();
  for (const page of pages) {
    const key = canonicalUrl(page.url);
    if (!map.has(key)) map.set(key, page);
  }
  return map;
}

function evidenceOf(screen: AuthenticatedCoverageScreenInput): AuthenticationEvidence {
  return screen.authenticationEvidence ?? 'unknown';
}

/** Login-gated from crawl evidence only — never invents /dashboard or /admin. */
function isLoginDetected(
  screen: AuthenticatedCoverageScreenInput,
  page: AuthenticatedCoveragePageInput | undefined
): boolean {
  if (page?.access === 'gated') return true;
  if (screen.state === 'unauthenticated' || screen.state === 'permission-denied') return true;
  if (page?.status === 401 || page?.status === 403) return true;
  if (isGenericAuthRoute(routeOf(screen.url)) || isGenericAuthRoute(screen.url)) return true;
  return false;
}

function isPublicScreen(
  screen: AuthenticatedCoverageScreenInput,
  page: AuthenticatedCoveragePageInput | undefined
): boolean {
  if (isLoginDetected(screen, page)) return false;
  const evidence = evidenceOf(screen);
  if (evidence === 'unknown') return false;
  if (evidence === 'authenticated' || page?.access === 'authenticated' || screen.state === 'authenticated') {
    return false;
  }
  if (page?.access === 'public' || evidence === 'public') return true;
  // authenticationRequired false alone is not public proof when evidence is gated.
  return false;
}

function metadataHasKey(
  page: AuthenticatedCoveragePageInput | undefined,
  field: string,
  key: string
): boolean {
  if (!page?.metadata) return false;
  const raw = page.metadata[field];
  if (typeof raw === 'string') return raw === key;
  if (Array.isArray(raw)) {
    return raw.some((item) => typeof item === 'string' && item === key);
  }
  return false;
}

function screenIdsMatchingPageKey(
  screens: AuthenticatedCoverageScreenInput[],
  pagesByUrl: Map<string, AuthenticatedCoveragePageInput>,
  field: string,
  key: string,
  productionBlocked: boolean
): string[] {
  if (productionBlocked) return [];
  const ids: string[] = [];
  for (const screen of screens) {
    const page = pagesByUrl.get(canonicalUrl(screen.url));
    if (metadataHasKey(page, field, key)) ids.push(screen.id);
  }
  return ids;
}

function keysFromSession(
  session: AuthenticatedCoverageSession | null | undefined,
  gate: Exclude<AccessGate, 'public' | 'login'>
): string[] | null {
  if (!session) return null;
  switch (gate) {
    case 'role':
      return session.roles?.length ? [...session.roles] : null;
    case 'permission':
      return session.permissions?.length ? [...session.permissions] : null;
    case 'organization':
      return session.organizationId ? [session.organizationId] : null;
    case 'tenant':
      return session.tenantId ? [session.tenantId] : null;
    case 'subscription':
      return session.subscription ? [session.subscription] : null;
    case 'feature-flag':
      return session.featureFlags?.length ? [...session.featureFlags] : null;
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

function pageMetadataFieldForGate(gate: Exclude<AccessGate, 'public' | 'login'>): string {
  switch (gate) {
    case 'role':
      return 'role';
    case 'permission':
      return 'permission';
    case 'organization':
      return 'organizationId';
    case 'tenant':
      return 'tenantId';
    case 'subscription':
      return 'subscription';
    case 'feature-flag':
      return 'featureFlag';
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

function buildSessionGateLayers(input: {
  session: AuthenticatedCoverageSession | null | undefined;
  screens: AuthenticatedCoverageScreenInput[];
  pagesByUrl: Map<string, AuthenticatedCoveragePageInput>;
  productionBlocked: boolean;
}): AccessLayer[] {
  const layers: AccessLayer[] = [];
  const session = input.session;

  for (const { gate, missingReason } of SESSION_GATES) {
    const keys = keysFromSession(session, gate);

    if (!keys) {
      layers.push({
        gate,
        status: 'REQUIRES_CONFIGURATION',
        reason: missingReason,
        screenIds: [],
      });
      continue;
    }

    if (input.productionBlocked) {
      for (const key of keys) {
        layers.push({
          gate,
          key,
          status: 'BLOCKED',
          reason: PRODUCTION_BLOCKED_REASON,
          screenIds: [],
        });
      }
      continue;
    }

    if (!session?.established) {
      for (const key of keys) {
        layers.push({
          gate,
          key,
          status: 'REQUIRES_CONFIGURATION',
          reason: SESSION_NOT_ESTABLISHED_REASON,
          screenIds: [],
        });
      }
      continue;
    }

    const field = pageMetadataFieldForGate(gate);
    for (const key of keys) {
      const matched = screenIdsMatchingPageKey(
        input.screens,
        input.pagesByUrl,
        field,
        key,
        false
      );
      // Also accept plural featureFlags on page metadata when present.
      const matchedAlt =
        gate === 'feature-flag'
          ? screenIdsMatchingPageKey(input.screens, input.pagesByUrl, 'featureFlags', key, false)
          : [];
      const matchedRoles =
        gate === 'role'
          ? screenIdsMatchingPageKey(input.screens, input.pagesByUrl, 'roles', key, false)
          : [];
      const screenIds = [...new Set([...matched, ...matchedAlt, ...matchedRoles])];

      if (screenIds.length > 0) {
        layers.push({
          gate,
          key,
          status: 'DISCOVERED',
          reason: `${gate} key was recorded on crawled page metadata`,
          screenIds,
        });
        continue;
      }

      // Role: authenticated pages exist but role was not stored per screen — honest NOT_TESTED.
      if (gate === 'role') {
        const hasAuthenticatedPage = input.screens.some((screen) => {
          const page = input.pagesByUrl.get(canonicalUrl(screen.url));
          return page?.access === 'authenticated' || screen.state === 'authenticated';
        });
        layers.push({
          gate,
          key,
          status: 'NOT_TESTED',
          reason: hasAuthenticatedPage
            ? ROLE_NOT_RECORDED_REASON
            : 'session was provided but no pages were crawled with this role recorded',
          screenIds: [],
        });
        continue;
      }

      layers.push({
        gate,
        key,
        status: 'NOT_TESTED',
        reason: `${gate} key was supplied but was not recorded on crawled page metadata`,
        screenIds: [],
      });
    }
  }

  return layers;
}

/**
 * Role keys recorded on coverage layers only — never defaults Admin/User/Manager/Viewer.
 * Empty when roles were not supplied on the session.
 */
export function configuredRoleKeys(
  coverage: AuthenticatedCoverage | null | undefined
): string[] {
  if (!coverage?.layers?.length) return [];
  const keys: string[] = [];
  for (const layer of coverage.layers) {
    if (layer.gate !== 'role') continue;
    if (typeof layer.key === 'string' && layer.key.length > 0) keys.push(layer.key);
  }
  return keys;
}

/**
 * Build public / login / role / … access layers from existing discovery evidence.
 * Never invents screen URLs, role names, or Admin/Super Admin layers.
 */
export function buildAuthenticatedCoverage(
  input: BuildAuthenticatedCoverageInput
): AuthenticatedCoverage {
  const pagesByUrl = indexPagesByUrl(input.pages);
  const productionBlocked =
    input.environment === 'production' && input.authorizeAuthenticatedDiscovery !== true;

  const publicScreenIds: string[] = [];
  const loginDetectedIds: string[] = [];
  const unknownAccessIds: string[] = [];

  for (const screen of input.screens) {
    const page = pagesByUrl.get(canonicalUrl(screen.url));
    if (isLoginDetected(screen, page)) {
      loginDetectedIds.push(screen.id);
      continue;
    }
    if (evidenceOf(screen) === 'unknown') {
      unknownAccessIds.push(screen.id);
      continue;
    }
    if (isPublicScreen(screen, page)) {
      publicScreenIds.push(screen.id);
    }
  }

  const publicLayer: AccessLayer = {
    gate: 'public',
    status: publicScreenIds.length > 0 ? 'DISCOVERED' : 'NOT_TESTED',
    reason:
      publicScreenIds.length > 0
        ? 'screens crawled without an authentication gate'
        : 'no public screens were discovered',
    screenIds: [...publicScreenIds],
  };

  let loginLayer: AccessLayer;
  if (loginDetectedIds.length > 0) {
    loginLayer = {
      gate: 'login',
      status: 'DISCOVERED',
      reason: 'login screen was discovered from crawl evidence',
      screenIds: [...loginDetectedIds, ...unknownAccessIds],
    };
  } else if (unknownAccessIds.length > 0) {
    loginLayer = {
      gate: 'login',
      status: 'NOT_TESTED',
      reason: 'authentication requirement was not determined',
      screenIds: [...unknownAccessIds],
    };
  } else {
    loginLayer = {
      gate: 'login',
      status: 'NOT_TESTED',
      reason: 'no login screen was discovered',
      screenIds: [],
    };
  }

  // Production: keep public + login-discovered screens; do not list authenticated discoveries.
  const layers: AccessLayer[] = [publicLayer, loginLayer];
  layers.push(
    ...buildSessionGateLayers({
      session: input.session,
      screens: input.screens,
      pagesByUrl,
      productionBlocked,
    })
  );

  return {
    layers,
    publicScreenIds: [...publicScreenIds],
  };
}
