import { resolveDiscoverUrl } from './discovery/cli';
import { runPageDiscovery } from './discovery/run-discover';

async function main(): Promise<void> {
  const { url, maxPages } = resolveDiscoverUrl();
  await runPageDiscovery(url, maxPages);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
