import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';
import {
  resolveEnvironmentEndpoints,
  type EnvironmentsConfig,
} from '../core/platform/environment';

export function parseOrchestratorCli(argv: string[] = process.argv.slice(2)): {
  url: string | undefined;
  failFast: boolean;
  keepArtifacts: boolean;
  extraArgs: string[];
} {
  const cleaned = argv.filter((arg) => arg !== '--');
  const failFast = cleaned.includes('--fail-fast');
  const keepArtifacts = cleaned.includes('--keep-artifacts');
  const extraArgs = cleaned.filter(
    (arg) =>
      arg !== '--fail-fast' &&
      arg !== '--keep-artifacts' &&
      !arg.startsWith('--url=') &&
      arg.startsWith('--')
  );
  const urlArg = cleaned.find((arg) => arg.startsWith('--url='));
  const positional = cleaned.find((arg) => !arg.startsWith('--'));
  return {
    url: urlArg ? urlArg.slice('--url='.length) : positional,
    failFast,
    keepArtifacts,
    extraArgs,
  };
}

/** Drop `--url` / positional website target so leftover args can be passed to Playwright. */
export function stripWebsiteTargetArgs(argv: string[]): string[] {
  const { url } = parseOrchestratorCli(argv);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--url=')) continue;
    if (arg === '--url') {
      i += 1;
      continue;
    }
    if (url && arg === url) continue;
    out.push(arg);
  }
  return out;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function readExistingSeedUrl(): string | null {
  try {
    return readJsonIfExists<PageMap>(PATHS.pageMapFile)?.seedUrl || null;
  } catch {
    return null;
  }
}

export interface ResolveWebsiteTargetOptions {
  /** 1. CLI `--url=` / positional (orchestrator already exports this as env when set). */
  cliUrl?: string;
  /** 2. `QA_PLAYWRIGHT_BASE_URL` */
  playwrightEnvUrl?: string;
  /** 3. `QA_WEBSITE_URL` */
  websiteEnvUrl?: string;
  /**
   * Alias of `websiteEnvUrl` for older callers that passed a single env URL.
   * Ignored when `websiteEnvUrl` is set.
   */
  envUrl?: string;
  /** 4. persisted `qa.last-target.json` */
  lastTargetUrl?: string | null;
  /**
   * 5. discovery seed — pass only from orchestrator / discover / security.
   * Do not pass a stale seed into Playwright configs or generators.
   */
  existingSeed?: string | null;
  /** 6. `playwright.baseURL` — used only when the value is loopback. */
  playwrightBaseUrl?: string;
  /**
   * 7. Config-URL tier: `environments[active].websiteUrl` when a non-empty http(s) URL,
   * else `qa.config.json` `urls.website` (may be empty — never invent a public demo).
   */
  websiteUrl: string;
  /**
   * Optional `qa.config.json` `environments` — used only at the config-URL tier
   * (after CLI / env / last-target / seed / loopback). Does not beat those sources.
   */
  environments?: EnvironmentsConfig | null;
  /** Active environment name for the environments map lookup. */
  activeEnvironment?: string | null;
}

/**
 * Single website-target resolution for the whole engine.
 *
 * Order:
 * 1. CLI `--url` / positional
 * 2. `QA_PLAYWRIGHT_BASE_URL`
 * 3. `QA_WEBSITE_URL`
 * 4. `qa.last-target.json`
 * 5. existing discovery seed (only when `existingSeed` is passed — orchestrator/discover)
 * 6. loopback `playwright.baseURL` ONLY when that value is loopback
 * 7. active `environments[active].websiteUrl` if non-empty http(s), else `urls.website`
 *    (empty is valid; callers must fail with REQUIRES_CONFIGURATION)
 *
 * Callers pass `lastTargetUrl: readLastTargetUrl()` — this function does not
 * read the persist file itself (keeps unit tests hermetic).
 * Never defaults to a public demo host.
 */
export function resolveWebsiteTarget(options: ResolveWebsiteTargetOptions): string {
  const cli = options.cliUrl?.trim();
  if (cli) return cli;

  const playwrightEnv = options.playwrightEnvUrl?.trim();
  if (playwrightEnv) return playwrightEnv;

  const websiteEnv = (options.websiteEnvUrl ?? options.envUrl)?.trim();
  if (websiteEnv) return websiteEnv;

  const lastTarget = options.lastTargetUrl?.trim();
  if (lastTarget) return lastTarget;

  const seed = options.existingSeed?.trim();
  if (seed) return seed;

  if (options.playwrightBaseUrl && isLoopbackUrl(options.playwrightBaseUrl)) {
    return options.playwrightBaseUrl.replace(/\/?$/, '/');
  }

  return resolveEnvironmentEndpoints({
    active: options.activeEnvironment,
    environments: options.environments,
    fallbackWebsite: options.websiteUrl,
    fallbackApi: '',
  }).websiteUrl;
}

/**
 * Orchestrator / discover alias of {@link resolveWebsiteTarget}.
 * Prefer `resolveWebsiteTarget` in new code.
 */
export function resolveOrchestratorUrl(options: ResolveWebsiteTargetOptions): string {
  return resolveWebsiteTarget(options);
}

/**
 * Documented API base: `QA_API_URL` if set, else active
 * `environments[active].apiUrl` if non-empty http(s), else `urls.api`.
 * Never points the API at the website URL.
 */
export function resolveApiUrl(options?: {
  envUrl?: string;
  apiUrl?: string;
  /** Optional `qa.config.json` `environments` — used only after `QA_API_URL`. */
  environments?: EnvironmentsConfig | null;
  activeEnvironment?: string | null;
}): string {
  const fromEnv = (options?.envUrl ?? process.env.QA_API_URL)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const fromConfig = resolveEnvironmentEndpoints({
    active: options?.activeEnvironment,
    environments: options?.environments,
    fallbackWebsite: '',
    fallbackApi: options?.apiUrl ?? '',
  }).apiUrl;
  return fromConfig.replace(/\/+$/, '');
}
