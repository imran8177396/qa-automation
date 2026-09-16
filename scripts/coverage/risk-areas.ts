import type { CoverageRecord, InventoryItem, InventoryKind, RiskArea } from './types';

const HIGH_FAIL_KINDS = new Set<InventoryKind>(['accessibility', 'security', 'seo', 'page', 'route']);

function itemById(items: InventoryItem[]): Map<string, InventoryItem> {
  return new Map(items.map((item) => [item.id, item]));
}

function area(
  partial: Omit<RiskArea, 'itemCount'> & { itemIds: string[] }
): RiskArea {
  return { ...partial, itemCount: partial.itemIds.length };
}

function isCategoryRollup(item: InventoryItem): boolean {
  return item.id.startsWith('CAT-');
}

/**
 * Cluster high-uncovered / blocked / failed inventory — never invent pages, APIs, or routes.
 */
export function deriveRiskAreas(items: InventoryItem[], records: CoverageRecord[]): RiskArea[] {
  const byItem = itemById(items);
  const areas: RiskArea[] = [];

  const discoveryPages = items.filter(
    (item) => item.kind === 'page' && item.source === 'discovery' && !isCategoryRollup(item)
  );
  if (discoveryPages.length === 1) {
    areas.push(
      area({
        id: 'login-only-crawl',
        title: 'Login-only crawl cannot be 100% coverage',
        severity: 'high',
        category: 'uncovered',
        reason:
          'Discovery recorded a single page. Authenticated catalog routes were not invented. Overall coverage cannot be 100% from this crawl.',
        itemIds: discoveryPages.map((item) => item.id),
      })
    );
  }

  const authBlocked = records.filter((row) => {
    if (row.status !== 'BLOCKED') return false;
    const item = byItem.get(row.id);
    if (!item || item.kind !== 'workflow') return false;
    const blob = `${item.name} ${item.projectStatus ?? ''} ${row.reason}`.toLowerCase();
    return /auth|credential|gated|behind-auth|catalog|login/.test(blob);
  });
  if (authBlocked.length > 0) {
    areas.push(
      area({
        id: 'authenticated-catalog',
        title: 'Authenticated catalog REQUIRES_CONFIGURATION / BLOCKED',
        severity: 'high',
        category: 'blocked',
        reason:
          'Login/authentication workflows are BLOCKED until credentials are configured. Behind-auth inventory is not invented.',
        itemIds: authBlocked.map((row) => row.id),
      })
    );
  }

  const discoveredProductApis = items.filter(
    (item) => item.kind === 'api' && item.source === 'discovery' && item.id.startsWith('API-DISC-')
  );
  const catApi = items.find((item) => item.id === 'CAT-api');
  if (discoveredProductApis.length === 0) {
    areas.push(
      area({
        id: 'product-xhr-absent',
        title: 'Product XHR/API coverage is 0',
        severity: 'high',
        category: 'uncovered',
        reason:
          'Discovery observed 0 xhr/fetch/websocket calls. Sauce Demo product APIs were not invented. Configured JSONPlaceholder requests are a separate documented API target, not Sauce Demo XHR.',
        itemIds: catApi ? [catApi.id] : [],
      })
    );
  }

  const correlated = records.find((row) => row.id === 'WF-CORRELATED');
  if (correlated && (correlated.status === 'NOT APPLICABLE' || correlated.status === 'UNCOVERED')) {
    areas.push(
      area({
        id: 'correlated-workflows',
        title: 'No correlated UI↔API workflows',
        severity: 'medium',
        category: correlated.status === 'UNCOVERED' ? 'uncovered' : 'blocked',
        reason: correlated.reason,
        itemIds: [correlated.id],
      })
    );
  }

  const submitBlocked = records.filter((row) => {
    if (row.status !== 'BLOCKED') return false;
    const item = byItem.get(row.id);
    if (!item) return false;
    return (
      item.kind === 'form' ||
      (item.kind === 'workflow' && /submit|safety/i.test(`${item.name} ${row.reason}`))
    );
  });
  if (submitBlocked.length > 0) {
    areas.push(
      area({
        id: 'form-submit-blocked',
        title: 'Form submit workflows BLOCKED by safety policy',
        severity: 'medium',
        category: 'blocked',
        reason: 'Generated checks never submit forms. Submit workflows stay BLOCKED with a reason — not silently omitted.',
        itemIds: submitBlocked.map((row) => row.id),
      })
    );
  }

  const failed = records.filter((row) => row.status === 'FAILED');
  const failedByKind = new Map<InventoryKind, CoverageRecord[]>();
  for (const row of failed) {
    const list = failedByKind.get(row.kind) ?? [];
    list.push(row);
    failedByKind.set(row.kind, list);
  }
  for (const [kind, rows] of failedByKind) {
    if (rows.length === 0) continue;
    if (!HIGH_FAIL_KINDS.has(kind) && rows.length < 2) continue;
    areas.push(
      area({
        id: `failed-${kind}`,
        title: `${kind} executed and FAILED`,
        severity: HIGH_FAIL_KINDS.has(kind) ? 'high' : 'medium',
        category: 'failed',
        reason: `FAILED is tested-but-failed — not uncovered. ${rows[0].reason}`,
        itemIds: rows.map((row) => row.id),
      })
    );
  }

  const uncoveredTestable = records.filter((row) => row.status === 'UNCOVERED');
  const uncoveredByKind = new Map<InventoryKind, CoverageRecord[]>();
  for (const row of uncoveredTestable) {
    const list = uncoveredByKind.get(row.kind) ?? [];
    list.push(row);
    uncoveredByKind.set(row.kind, list);
  }
  for (const [kind, rows] of uncoveredByKind) {
    const kindItems = items.filter((item) => item.kind === kind);
    const testable = kindItems.filter((item) =>
      item.applicableScenarios.some((scenario) => scenario.disposition === 'executable')
    ).length;
    if (rows.length === 0 || testable === 0) continue;
    if (rows.length < 2 && rows.length < testable) continue;
    const configuredApi = rows.every((row) => byItem.get(row.id)?.source === 'config');
    areas.push(
      area({
        id: `uncovered-${kind}`,
        title: configuredApi
          ? `Documented ${kind} items have no execution evidence`
          : `${kind} has ${rows.length}/${testable} testable items UNCOVERED`,
        severity: kind === 'api' || rows.length === testable ? 'high' : 'medium',
        category: 'uncovered',
        reason: configuredApi
          ? 'Configured Postman/API items are UNCOVERED until Postman CLI evidence exists. They are not Sauce Demo product XHR and are not counted as Sauce Demo API coverage.'
          : rows[0].reason,
        itemIds: rows.map((row) => row.id),
      })
    );
  }

  const rank: Record<RiskArea['severity'], number> = { high: 0, medium: 1, low: 2 };
  return areas.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}
