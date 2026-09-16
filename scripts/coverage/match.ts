import type { AssignedScenario, ExecutionEvidence, InventoryItem } from './types';

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function pathOf(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    if (raw.startsWith('/')) return raw;
    return null;
  }
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Conservative match: only claim an item was tested when execution evidence
 * points at the same host/path, locator, browser, or configured API name.
 * A passing test against a different application is not coverage.
 */
export function evidenceMatchesItem(item: InventoryItem, evidence: ExecutionEvidence): boolean {
  if (!evidence.executed) return false;

  if (item.kind === 'browser') {
    return Boolean(
      evidence.browser &&
        evidence.browser === item.name &&
        (evidence.source === 'playwright' || evidence.source === 'cross-browser')
    );
  }

  if (item.kind === 'api') {
    if (item.source === 'capability') {
      return evidence.source === 'postman' && /auth|authorization/i.test(evidence.title);
    }
    if (evidence.source !== 'postman' && item.source === 'config') return false;
    const name = normalizeHint(item.name);
    const title = normalizeHint(evidence.title);
    if (title && (title.includes(name) || name.includes(title))) return true;
    const pathHint = item.name.split(/\s+/).slice(1).join(' ');
    return evidence.urlHints.some((hint) => normalizeHint(hint).includes(normalizeHint(pathHint)));
  }

  if (item.kind === 'visual') {
    return evidence.source === 'visual';
  }

  if (evidence.source === 'visual') {
    return false;
  }

  if (item.kind === 'viewport') {
    return evidence.source === 'responsive';
  }

  if (evidence.source === 'responsive') {
    return false;
  }

  if (item.kind === 'accessibility') {
    return evidence.source === 'accessibility';
  }

  if (evidence.source === 'accessibility') {
    return false;
  }

  if (item.kind === 'security') {
    return evidence.source === 'security';
  }

  if (evidence.source === 'security') {
    return false;
  }

  if (item.kind === 'seo') {
    return evidence.source === 'seo';
  }

  if (evidence.source === 'seo') {
    return false;
  }

  if (item.kind === 'content') {
    return evidence.source === 'content';
  }

  if (evidence.source === 'content') {
    return false;
  }

  if (item.kind === 'performance') {
    const profile = item.id.replace(/^PERF-/i, '').toLowerCase();
    return (
      evidence.source === 'jmeter' &&
      (normalizeHint(evidence.title).includes(profile) ||
        normalizeHint(evidence.file ?? '').includes(profile) ||
        normalizeHint(item.name).includes(normalizeHint(evidence.title)))
    );
  }

  if (evidence.source === 'jmeter') {
    return false;
  }

  if (item.kind === 'workflow' && item.source === 'config') {
    return (
      evidence.source === 'workflow' &&
      (normalizeHint(evidence.title).includes(normalizeHint(item.name)) ||
        normalizeHint(evidence.title).includes(normalizeHint(item.id.replace(/^WF-CORR-/, ''))))
    );
  }

  if (evidence.source === 'workflow') {
    return false;
  }

  const itemHost = item.page ? hostOf(item.page) : item.route ? hostOf(item.route) : null;
  const evidenceHosts = evidence.urlHints.map(hostOf).filter((value): value is string => Boolean(value));
  if (itemHost && evidenceHosts.length > 0 && !evidenceHosts.includes(itemHost)) {
    return false;
  }

  if (item.locator) {
    const locator = normalizeHint(item.locator);
    if (evidence.locatorHints.some((hint) => normalizeHint(hint) === locator)) return true;
    if (normalizeHint(evidence.title).includes(locator)) return true;
  }

  const itemPath = item.route ? pathOf(item.route) ?? item.route : item.page ? pathOf(item.page) : null;
  if (itemPath === '/') {
    const rootHit = evidence.urlHints.some((hint) => {
      const hintPath = pathOf(hint);
      const hintHost = hostOf(hint);
      return hintPath === '/' && (!itemHost || !hintHost || hintHost === itemHost);
    });
    if (rootHit) return true;
  }
  if (itemPath && itemPath !== '/') {
    const needle = normalizeHint(itemPath);
    const pathHit =
      evidence.urlHints.some((hint) => normalizeHint(hint).includes(needle)) ||
      normalizeHint(evidence.title).includes(needle);
    if (pathHit && itemHost && evidenceHosts.length > 0 && !evidenceHosts.includes(itemHost)) return false;
    if (pathHit && itemHost && evidenceHosts.length === 0) return false;
    if (pathHit) return true;
  }

  return false;
}

function titleSuggestsScenario(title: string, scenarioId: AssignedScenario['id']): boolean {
  switch (scenarioId) {
    case 'valid-input':
      return /valid|fill|type=|enter /i.test(title);
    case 'invalid-input':
      return /invalid|malformed|bad email|wrong format/i.test(title);
    case 'empty-input':
    case 'required-validation':
      return /empty|required|blank|boundary/i.test(title);
    case 'special-characters':
      return /special char/i.test(title);
    case 'whitespace-input':
      return /whitespace/i.test(title);
    case 'long-input':
      return /long input/i.test(title);
    case 'unicode-input':
      return /unicode/i.test(title);
    case 'editability':
      return /editab|read-only|readonly/i.test(title);
    case 'required-state':
      return /required-state|required\/optional|optional/i.test(title);
    case 'accessible-name':
      return /accessible name/i.test(title);
    case 'validation-state':
      return /validity|validation-state|constraint/i.test(title);
    case 'error-recovery':
      return /error recovery|recover/i.test(title);
    case 'boundary-values':
      return /boundary|min|max|length/i.test(title);
    case 'click-behavior':
      return /click/i.test(title);
    default:
      return true;
  }
}

export function applyEvidence(items: InventoryItem[], evidence: ExecutionEvidence[]): InventoryItem[] {
  return items.map((item) => ({
    ...item,
    applicableScenarios: item.applicableScenarios.map((scenario) => {
      if (scenario.disposition !== 'executable') return scenario;
      const matches = evidence.filter(
        (row) => evidenceMatchesItem(item, row) && titleSuggestsScenario(row.title, scenario.id)
      );
      if (matches.length === 0) return scenario;
      return {
        ...scenario,
        tested: true,
        evidenceIds: matches.map((row) => row.id),
      };
    }),
  }));
}
