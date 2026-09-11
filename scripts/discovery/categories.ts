export const DISCOVERY_CATEGORIES = [
  'pages',
  'routes',
  'navigation',
  'header',
  'footer',
  'sidebar',
  'breadcrumbs',
  'link',
  'button',
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'toggle',
  'file-upload',
  'form',
  'table',
  'pagination',
  'search',
  'filter',
  'sort',
  'tab',
  'accordion',
  'modal',
  'popup',
  'tooltip',
  'image',
  'video',
  'interactive',
  'authentication',
  'workflow',
  'api',
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

export type DiscoveryStatus = 'DISCOVERED' | 'CANDIDATE' | 'NOT_DISCOVERED';

export interface CategoryStatus {
  category: DiscoveryCategory;
  status: DiscoveryStatus;
  count: number;
  reason?: string;
}

export function rollupCategory(
  category: DiscoveryCategory,
  count: number,
  candidateCount = 0,
  notFoundReason: string
): CategoryStatus {
  if (count > 0) {
    return { category, status: 'DISCOVERED', count };
  }
  if (candidateCount > 0) {
    return { category, status: 'CANDIDATE', count: candidateCount };
  }
  return { category, status: 'NOT_DISCOVERED', count: 0, reason: notFoundReason };
}

const STATUS_RANK: Record<DiscoveryStatus, number> = {
  DISCOVERED: 2,
  CANDIDATE: 1,
  NOT_DISCOVERED: 0,
};

/** One row per category. Prefer observed evidence over a later NOT_DISCOVERED rollup. */
export function mergeCategoryStatus(rows: CategoryStatus[]): CategoryStatus[] {
  const byCategory = new Map<DiscoveryCategory, CategoryStatus>();

  for (const row of rows) {
    const previous = byCategory.get(row.category);
    if (!previous) {
      byCategory.set(row.category, { ...row });
      continue;
    }
    if (STATUS_RANK[row.status] > STATUS_RANK[previous.status]) {
      byCategory.set(row.category, { ...row });
    }
  }

  return DISCOVERY_CATEGORIES.map((category) => byCategory.get(category)).filter(
    (row): row is CategoryStatus => Boolean(row)
  );
}
