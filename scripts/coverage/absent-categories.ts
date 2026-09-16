import { mergeCategoryStatus, type CategoryStatus, type DiscoveryCategory } from '../discovery/categories';
import type { ApiInventory } from '../discovery/api-observe';
import type { PageMap } from '../discovery/page-map';
import type { UiInventory } from '../discovery/ui-scan';
import type { WorkflowInventory } from '../discovery/workflows';
import { mapProjectStatus } from './project-status';
import type { AssignedScenario, InventoryItem, InventoryKind } from './types';

/** Meta rollups — individual pages/elements/workflows are already inventoried. */
const SKIP_ABSENT_CATEGORIES = new Set<DiscoveryCategory>(['interactive']);

const ABSENT_KIND: Partial<Record<DiscoveryCategory, InventoryKind>> = {
  pages: 'page',
  routes: 'route',
  navigation: 'navigation',
  link: 'link',
  button: 'button',
  input: 'field',
  textarea: 'field',
  search: 'field',
  'file-upload': 'field',
  select: 'dropdown',
  checkbox: 'checkbox',
  radio: 'radio',
  toggle: 'toggle',
  form: 'form',
  table: 'table',
  api: 'api',
  authentication: 'workflow',
  workflow: 'workflow',
  header: 'ui-component',
  footer: 'ui-component',
  sidebar: 'ui-component',
  breadcrumbs: 'ui-component',
  pagination: 'ui-component',
  filter: 'ui-component',
  sort: 'ui-component',
  tab: 'ui-component',
  accordion: 'ui-component',
  modal: 'ui-component',
  popup: 'ui-component',
  tooltip: 'ui-component',
  image: 'ui-component',
  video: 'ui-component',
};

const ABSENT_LABEL: Partial<Record<DiscoveryCategory, string>> = {
  select: 'Dropdowns (select)',
  checkbox: 'Checkboxes',
  radio: 'Radios',
  toggle: 'Toggles',
  table: 'Tables',
  link: 'Links',
  navigation: 'Navigation',
  api: 'Discovered XHR/fetch/websocket APIs',
  input: 'Text fields',
  textarea: 'Textareas',
  form: 'Forms',
  button: 'Buttons',
};

function notedAbsent(reason: string): AssignedScenario[] {
  return [
    {
      id: 'visibility',
      disposition: 'not-implemented',
      reason,
      tested: false,
      evidenceIds: [],
    },
  ];
}

export function mergeDiscoveryCategoryStatus(input: {
  pageMap: PageMap | null;
  ui: UiInventory | null;
  workflows: WorkflowInventory | null;
  api: ApiInventory | null;
}): CategoryStatus[] {
  return mergeCategoryStatus([
    ...(input.pageMap?.categoryStatus ?? []),
    ...(input.ui?.categoryStatus ?? []),
    ...(input.workflows?.categoryStatus ?? []),
    ...(input.api?.categoryStatus ?? []),
  ]);
}

export function buildAbsentCategoryItems(
  statuses: CategoryStatus[],
  seedUrl: string | null
): InventoryItem[] {
  const items: InventoryItem[] = [];

  for (const row of statuses) {
    if (row.status !== 'NOT_DISCOVERED') continue;
    if (SKIP_ABSENT_CATEGORIES.has(row.category)) continue;
    const kind = ABSENT_KIND[row.category];
    if (!kind) continue;

    const mapped = mapProjectStatus(
      'NOT_DISCOVERED',
      row.reason?.trim() || 'not observed in discovery'
    );
    const reason = mapped?.reason ?? `not observed in discovery (${row.category})`;

    items.push({
      id: `CAT-${row.category}`,
      kind,
      name: ABSENT_LABEL[row.category] ?? `Discovered ${row.category} category`,
      page: seedUrl ?? undefined,
      elementType: row.category,
      source: 'discovery',
      coverageHint: 'not-applicable',
      projectStatus: 'NOT_DISCOVERED',
      applicableScenarios: notedAbsent(reason),
    });
  }

  return items;
}
