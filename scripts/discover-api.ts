import { PATHS } from './lib/paths';
import { resolveDiscoverUrl } from './discovery/cli';
import { loadOrDiscoverPageMap, runUiAndApiDiscovery } from './discovery/run-discover';

async function main(): Promise<void> {
  const { url, maxPages } = resolveDiscoverUrl();
  const { pageMap, auth } = await loadOrDiscoverPageMap(url, maxPages);
  const { api } = await runUiAndApiDiscovery(pageMap, auth);
  console.log(`Wrote ${api.calls.length} observed API call(s) to ${PATHS.apiInventoryFile}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
