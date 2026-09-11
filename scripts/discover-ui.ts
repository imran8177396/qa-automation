import { PATHS } from './lib/paths';
import { resolveDiscoverUrl } from './discovery/cli';
import { loadOrDiscoverPageMap, runUiAndApiDiscovery } from './discovery/run-discover';

async function main(): Promise<void> {
  const { url, maxPages } = resolveDiscoverUrl();
  const pageMap = await loadOrDiscoverPageMap(url, maxPages);
  const { ui } = await runUiAndApiDiscovery(pageMap);
  console.log(`Wrote ${ui.elements.length} UI element(s) to ${PATHS.uiInventoryFile}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
