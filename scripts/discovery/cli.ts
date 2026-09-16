import { loadConfig } from '../lib/load-config';
import { loadRuntimeEnv } from '../lib/load-runtime-env';

export function resolveDiscoverUrl(argv = process.argv.slice(2)): { url: string; maxPages?: number } {
  loadRuntimeEnv();

  const cleaned = argv.filter((arg) => arg !== '--');
  const maxPagesArg = cleaned.find((arg) => arg.startsWith('--max-pages='));
  const parsedMaxPages = maxPagesArg ? Number(maxPagesArg.split('=')[1]) : undefined;
  if (parsedMaxPages !== undefined && !Number.isFinite(parsedMaxPages)) {
    throw new Error(`Invalid --max-pages value: ${maxPagesArg}`);
  }
  const maxPages = parsedMaxPages;

  const urlEq = cleaned.find((arg) => arg.startsWith('--url='));
  const urlFlagIndex = cleaned.findIndex((arg) => arg === '--url');
  const urlFromFlag = urlEq
    ? urlEq.slice('--url='.length)
    : urlFlagIndex >= 0
      ? cleaned[urlFlagIndex + 1]
      : undefined;
  const positional = cleaned.find((arg, index) => {
    if (arg.startsWith('--')) return false;
    if (urlFlagIndex >= 0 && index === urlFlagIndex + 1) return false;
    return true;
  });
  const url = urlFromFlag || positional;

  if (url) {
    return { url, maxPages };
  }

  const config = loadConfig();
  if (!config.urls.website) {
    throw new Error(
      'Usage: npm run discover -- <url> [--url=<url>] [--max-pages=N] (or set urls.website in qa.config.json)'
    );
  }
  return { url: config.urls.website, maxPages };
}
