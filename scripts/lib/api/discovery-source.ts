import { PATHS } from '../paths';
import { readJsonIfExists } from '../../discovery/write-json';
import type { ApiInventory } from '../../discovery/api-observe';

export interface ApiDiscoveryProvenance {
  inventoryPresent: boolean;
  inventoryPath: string;
  observedCallCount: number;
  seedUrl: string | null;
  websiteUrl: string;
  note: string;
}

const ZERO_CALLS_NOTE =
  'Sauce Demo discovery found 0 xhr/fetch/websocket APIs. Executed Postman requests are documented in qa.config.json postman.requests (JSONPlaceholder-style), not invented from the login page.';

export function summarizeApiDiscovery(
  inventory: ApiInventory | null,
  websiteUrl: string,
  inventoryPath = PATHS.apiInventoryFile
): ApiDiscoveryProvenance {
  if (!inventory) {
    return {
      inventoryPresent: false,
      inventoryPath,
      observedCallCount: 0,
      seedUrl: null,
      websiteUrl,
      note: `${ZERO_CALLS_NOTE} discovery/api-inventory.json was not present — no endpoints were invented to fill the gap.`,
    };
  }

  return {
    inventoryPresent: true,
    inventoryPath,
    observedCallCount: inventory.calls.length,
    seedUrl: inventory.seedUrl,
    websiteUrl,
    note:
      inventory.calls.length === 0
        ? ZERO_CALLS_NOTE
        : `Discovery observed ${inventory.calls.length} xhr/fetch/websocket call(s). Collection items still come only from qa.config.json postman.requests unless a call shares urls.api — Sauce Demo login-page paths are never invented.`,
  };
}

export function loadApiDiscoveryProvenance(websiteUrl: string): ApiDiscoveryProvenance {
  const inventory = readJsonIfExists<ApiInventory>(PATHS.apiInventoryFile);
  return summarizeApiDiscovery(inventory, websiteUrl);
}
