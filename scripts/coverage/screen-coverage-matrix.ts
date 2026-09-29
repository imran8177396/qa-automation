/**
 * Screen × scenario inventory matrix from discovered screens + planned checks.
 * Counts are plan-row inventory totals — not pass rate and not coverage percent.
 */

export interface ScreenCoverageMatrixRow {
  screenId: string;
  /** Title if non-empty, otherwise URL path, otherwise screenId. Never invented. */
  screen: string;
  elements: number;
  positive: number;
  negative: number;
  edge: number;
  security: number;
  a11y: number;
  visual: number;
}

export interface ScreenCoverageMatrixScreenInput {
  screenId: string;
  url?: string;
  title?: string;
  elements?: { elementId: string; type?: string; decorative?: boolean }[];
}

export interface ScreenCoverageMatrixCheckInput {
  screenId?: string;
  scenarioKind?: string;
  category?: string;
  status?: string;
}

export interface ScreenCoverageMatrixResult {
  rows: ScreenCoverageMatrixRow[];
  generatedFrom: 'discovered-screens';
}

function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return url;
  }
}

/** Display label from the screen record only — never invent product names. */
function screenDisplayName(screen: ScreenCoverageMatrixScreenInput): string {
  const title = typeof screen.title === 'string' ? screen.title.trim() : '';
  if (title.length > 0) return title;
  if (typeof screen.url === 'string' && screen.url.length > 0) return urlPath(screen.url);
  return screen.screenId;
}

function countNonDecorative(elements: ScreenCoverageMatrixScreenInput['elements']): number {
  if (!elements) return 0;
  let n = 0;
  for (const el of elements) {
    if (el.decorative === true) continue;
    n += 1;
  }
  return n;
}

function matchesScreen(check: ScreenCoverageMatrixCheckInput, screenId: string): boolean {
  return typeof check.screenId === 'string' && check.screenId === screenId;
}

function isPositive(check: ScreenCoverageMatrixCheckInput): boolean {
  return check.category === 'positive' || check.scenarioKind === 'positive';
}

function isNegative(check: ScreenCoverageMatrixCheckInput): boolean {
  return check.category === 'negative' || check.scenarioKind === 'negative';
}

function isEdge(check: ScreenCoverageMatrixCheckInput): boolean {
  return check.category === 'boundary' || check.scenarioKind === 'edge';
}

function isSecurity(check: ScreenCoverageMatrixCheckInput): boolean {
  return (
    check.scenarioKind === 'security' ||
    check.scenarioKind === 'security-context' ||
    check.scenarioKind === 'security-plan' ||
    check.category === 'security'
  );
}

function isA11y(check: ScreenCoverageMatrixCheckInput): boolean {
  return (
    check.scenarioKind === 'accessibility' ||
    check.scenarioKind === 'usability-accessibility' ||
    check.category === 'accessibility'
  );
}

function isVisual(check: ScreenCoverageMatrixCheckInput): boolean {
  return check.scenarioKind === 'visual' || check.category === 'visual';
}

/**
 * One row per input screen (input order). Empty screens → []. Never synthesizes example rows.
 * Column values are inventory check counts for that screenId — all statuses included.
 */
export function buildScreenCoverageMatrix(input: {
  screens: ScreenCoverageMatrixScreenInput[];
  checks: ScreenCoverageMatrixCheckInput[];
}): ScreenCoverageMatrixResult {
  const rows: ScreenCoverageMatrixRow[] = [];

  for (const screen of input.screens) {
    const forScreen = input.checks.filter((c) => matchesScreen(c, screen.screenId));
    rows.push({
      screenId: screen.screenId,
      screen: screenDisplayName(screen),
      elements: countNonDecorative(screen.elements),
      positive: forScreen.filter(isPositive).length,
      negative: forScreen.filter(isNegative).length,
      edge: forScreen.filter(isEdge).length,
      security: forScreen.filter(isSecurity).length,
      a11y: forScreen.filter(isA11y).length,
      visual: forScreen.filter(isVisual).length,
    });
  }

  return { rows, generatedFrom: 'discovered-screens' };
}

const MATRIX_HEADERS = [
  'Screen',
  'Elements',
  'Positive',
  'Negative',
  'Edge',
  'Security',
  'A11y',
  'Visual',
] as const;

/** Simple markdown table. Empty rows → header only (no fabricated data lines). */
export function renderScreenCoverageMatrixMarkdown(rows: ScreenCoverageMatrixRow[]): string {
  const head = `| ${MATRIX_HEADERS.join(' | ')} |`;
  const sep = `| ${MATRIX_HEADERS.map(() => '---').join(' | ')} |`;
  if (rows.length === 0) {
    return `${head}\n${sep}\n`;
  }
  const body = rows
    .map(
      (r) =>
        `| ${r.screen} | ${r.elements} | ${r.positive} | ${r.negative} | ${r.edge} | ${r.security} | ${r.a11y} | ${r.visual} |`
    )
    .join('\n');
  return `${head}\n${sep}\n${body}\n`;
}
