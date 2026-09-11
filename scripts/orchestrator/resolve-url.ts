import { PATHS } from '../lib/paths';
import { readJsonIfExists } from '../discovery/write-json';
import type { PageMap } from '../discovery/page-map';

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

export function resolveOrchestratorUrl(options: {
  cliUrl?: string;
  envUrl?: string;
  websiteUrl: string;
  playwrightBaseUrl?: string;
  existingSeed?: string | null;
}): string {
  if (options.cliUrl) return options.cliUrl;
  if (options.envUrl) return options.envUrl;
  if (options.existingSeed) return options.existingSeed;
  if (options.playwrightBaseUrl && isLoopbackUrl(options.playwrightBaseUrl)) {
    return options.playwrightBaseUrl.replace(/\/?$/, '/');
  }
  return options.websiteUrl;
}
