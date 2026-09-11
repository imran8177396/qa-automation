import { loadConfig } from '../lib/load-config';

export function resolveDiscoverUrl(argv = process.argv.slice(2)): { url: string; maxPages?: number } {
  const url = argv.find((arg) => !arg.startsWith('--'));
  const maxPagesArg = argv.find((arg) => arg.startsWith('--max-pages='));
  const parsedMaxPages = maxPagesArg ? Number(maxPagesArg.split('=')[1]) : undefined;
  if (parsedMaxPages !== undefined && !Number.isFinite(parsedMaxPages)) {
    throw new Error(`Invalid --max-pages value: ${maxPagesArg}`);
  }
  const maxPages = parsedMaxPages;

  if (url) {
    return { url, maxPages };
  }

  const config = loadConfig();
  if (!config.urls.website) {
    throw new Error('Usage: npm run discover -- <url> [--max-pages=N] (or set urls.website in qa.config.json)');
  }
  return { url: config.urls.website, maxPages };
}
