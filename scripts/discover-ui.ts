import { PATHS } from './lib/paths';
import { resolveAndPersistDiscoverUrl } from './discovery/cli';
import { loadOrDiscoverPageMap, runUiAndApiDiscovery } from './discovery/run-discover';

async function main(): Promise<void> {
  const { url, maxPages } = resolveAndPersistDiscoverUrl();
  const { pageMap, auth } = await loadOrDiscoverPageMap(url, maxPages);
  const { ui } = await runUiAndApiDiscovery(pageMap, auth);
  console.log(`Wrote ${ui.elements.length} UI element(s) to ${PATHS.uiInventoryFile}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
