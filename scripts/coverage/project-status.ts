import { UI_ELEMENT_KINDS, type CoverageStatus, type InventoryItem, type InventoryKind } from './types';

/**
 * Engine statuses stay TESTED | FAILED | BLOCKED | SKIPPED | NOT APPLICABLE |
 * UNTESTABLE | UNCOVERED. Docs print SKIPPED as SKIPPED WITH REASON — every
 * skip already carries a reason and is never a silent omit.
 */
export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  TESTED: 'TESTED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED WITH REASON',
  'NOT APPLICABLE': 'NOT APPLICABLE',
  UNTESTABLE: 'UNTESTABLE',
  UNCOVERED: 'UNCOVERED',
};

export function displayCoverageStatus(status: CoverageStatus): string {
  return COVERAGE_STATUS_LABELS[status];
}

export type ProjectStatus =
  | 'NOT_TESTED'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_EXECUTED'
  | 'NOT_DISCOVERED'
  | 'DISCOVERED'
  | 'CANDIDATE';

export interface ProjectStatusMapping {
  projectStatus: ProjectStatus;
  coverageStatus: CoverageStatus;
  reason: string;
}

/**
 * Map discovery / suite vocabulary onto the coverage engine. Closest explicit
 * status only — never drop the item.
 */
export function mapProjectStatus(projectStatus: string, detail: string): ProjectStatusMapping | null {
  const reason = detail.trim() || 'No additional reason was recorded.';
  switch (projectStatus) {
    case 'NOT_TESTED':
      return {
        projectStatus,
        coverageStatus: 'BLOCKED',
        reason: `Mapped from NOT_TESTED → BLOCKED. ${reason}`,
      };
    case 'REQUIRES_CONFIGURATION':
      return {
        projectStatus,
        coverageStatus: 'BLOCKED',
        reason: `Mapped from REQUIRES_CONFIGURATION → BLOCKED. ${reason}`,
      };
    case 'NOT_EXECUTED':
      return {
        projectStatus,
        coverageStatus: 'SKIPPED',
        reason: `Mapped from NOT_EXECUTED → SKIPPED WITH REASON. ${reason}`,
      };
    case 'NOT_DISCOVERED':
      return {
        projectStatus,
        coverageStatus: 'NOT APPLICABLE',
        reason: `Mapped from NOT_DISCOVERED → NOT APPLICABLE. ${reason}`,
      };
    default:
      return null;
  }
}

export const REQUIRED_TRACKED_TYPES = [
  { id: 'page', label: 'pages', kinds: ['page'] as const },
  { id: 'route', label: 'routes', kinds: ['route'] as const },
  { id: 'ui', label: 'UI', kinds: UI_ELEMENT_KINDS },
  { id: 'navigation', label: 'navigation', kinds: ['navigation'] as const },
  { id: 'button', label: 'buttons', kinds: ['button'] as const },
  { id: 'link', label: 'links', kinds: ['link'] as const },
  { id: 'field', label: 'fields', kinds: ['field'] as const },
  { id: 'form', label: 'forms', kinds: ['form'] as const },
  { id: 'dropdown', label: 'dropdowns', kinds: ['dropdown'] as const },
  { id: 'checkbox', label: 'checkboxes', kinds: ['checkbox'] as const },
  { id: 'radio', label: 'radios', kinds: ['radio'] as const },
  { id: 'toggle', label: 'toggles', kinds: ['toggle'] as const },
  { id: 'table', label: 'tables', kinds: ['table'] as const },
  { id: 'workflow', label: 'workflows', kinds: ['workflow'] as const },
  { id: 'api', label: 'APIs', kinds: ['api'] as const },
  { id: 'browser', label: 'browsers', kinds: ['browser'] as const },
  { id: 'viewport', label: 'viewports', kinds: ['viewport'] as const },
  { id: 'accessibility', label: 'accessibility', kinds: ['accessibility'] as const },
  { id: 'visual', label: 'visual', kinds: ['visual'] as const },
  { id: 'responsive', label: 'responsive', kinds: ['viewport'] as const },
] as const;

export type TrackedTypeId = (typeof REQUIRED_TRACKED_TYPES)[number]['id'];

export function trackedTypeOf(item: InventoryItem): InventoryKind {
  if (item.kind === 'dropdown' || item.elementType === 'select') return 'dropdown';
  if (item.kind === 'checkbox' || item.elementType === 'checkbox') return 'checkbox';
  if (item.kind === 'radio' || item.elementType === 'radio') return 'radio';
  if (item.kind === 'toggle' || item.elementType === 'toggle') return 'toggle';
  if (item.kind === 'table' || item.elementType === 'table') return 'table';
  return item.kind;
}
