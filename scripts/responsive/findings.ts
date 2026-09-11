import type { ViewportName } from './viewports';

export type FindingStatus = 'FAIL' | 'NOT_APPLICABLE';

export interface ResponsiveFinding {
  status: FindingStatus;
  page: string;
  pagePath: string;
  viewport: ViewportName;
  viewportSize: string;
  affectedElement: string;
  expected: string;
  actual: string;
  screenshot?: string;
  engineNote: string;
}

export function formatFinding(finding: ResponsiveFinding): string {
  const lines = [
    `Page: ${finding.page} (${finding.pagePath})`,
    `Viewport: ${finding.viewport} (${finding.viewportSize})`,
    `Affected element: ${finding.affectedElement}`,
    `Expected: ${finding.expected}`,
    `Actual: ${finding.actual}`,
    `Engine: ${finding.engineNote}`,
  ];
  if (finding.screenshot) {
    lines.push(`Evidence: ${finding.screenshot}`);
  }
  return lines.join('\n');
}

export function slugFinding(finding: Pick<ResponsiveFinding, 'viewport' | 'page' | 'affectedElement'>): string {
  return [finding.viewport, finding.page, finding.affectedElement]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
