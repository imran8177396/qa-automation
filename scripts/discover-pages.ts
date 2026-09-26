import { resolveAndPersistDiscoverUrl } from './discovery/cli';
import { runPageDiscovery } from './discovery/run-discover';

async function main(): Promise<void> {
  const { url, maxPages } = resolveAndPersistDiscoverUrl();
  await runPageDiscovery(url, maxPages);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
