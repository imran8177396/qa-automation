/**
 * Single ordered section manifest. Numbers are derived from order — never hardcode
 * "2.12" in prose. Cross-references go through SectionRegistry so a renumber
 * cannot silently break Layer 4 (P0-2 / P3-4).
 */

export type ReportLayer = 1 | 2 | 3 | 4 | 5;

export interface ManifestSection {
  id: string;
  layer: ReportLayer;
  /** Parent id for dotted children (2.6.1 under playwright). */
  parentId?: string;
  title: string;
}

/**
 * Planned Layer 2 order (2.1–2.11 kept; 2.11 is SEO unique findings).
 * 2.12–2.17 are always emitted (NOT_AVAILABLE / NOT_EXECUTED when artifacts are missing).
 */
export const SECTION_MANIFEST: readonly ManifestSection[] = [
  { id: 'layer-1', layer: 1, title: 'Executive Summary' },
  { id: 'kpi', layer: 1, parentId: 'layer-1', title: 'KPI Dashboard' },

  { id: 'layer-2', layer: 2, title: 'Test Evidence' },
  { id: 'project-info', layer: 2, title: 'Project & Test Information' },
  { id: 'in-scope', layer: 2, title: 'Test Scope — In Scope' },
  { id: 'out-of-scope', layer: 2, title: 'Test Scope — Out of Scope' },
  { id: 'testing-types', layer: 2, title: 'Testing Types Executed' },
  { id: 'environment', layer: 2, title: 'Test Environment' },
  { id: 'pipeline-stages', layer: 2, parentId: 'environment', title: 'Full Pipeline Stage Results (qa:all)' },
  { id: 'playwright', layer: 2, title: 'Playwright — UI / E2E Evidence' },
  { id: 'playwright-summary', layer: 2, parentId: 'playwright', title: 'Execution Summary' },
  { id: 'playwright-browsers', layer: 2, parentId: 'playwright', title: 'Browser Summary' },
  { id: 'playwright-executions', layer: 2, parentId: 'playwright', title: 'Detailed Test Executions' },
  { id: 'coverage-breakdown', layer: 2, parentId: 'playwright', title: 'Discovery-Generated Check Coverage Breakdown' },
  { id: 'failure-detail', layer: 2, parentId: 'playwright', title: 'Failure Detail' },
  { id: 'api', layer: 2, title: 'API Smoke Test Evidence' },
  { id: 'api-requests', layer: 2, parentId: 'api', title: 'Request-Level Results' },
  { id: 'performance', layer: 2, title: 'Performance Validation Evidence' },
  { id: 'performance-samples', layer: 2, parentId: 'performance', title: 'Sample Results' },
  {
    id: 'lighthouse',
    layer: 2,
    parentId: 'performance',
    title: 'Core Web Vitals (Lighthouse) — not JMeter',
  },
  { id: 'artifacts', layer: 2, title: 'Test Artifacts' },
  { id: 'discovery', layer: 2, title: 'Discovery & Element Inventory Evidence' },
  { id: 'elements-by-type', layer: 2, parentId: 'discovery', title: 'Elements by Type' },
  { id: 'elements-by-risk', layer: 2, parentId: 'discovery', title: 'Elements by Risk Label' },
  { id: 'discovered-pages', layer: 2, parentId: 'discovery', title: 'Discovered Pages' },
  { id: 'seo', layer: 2, title: 'SEO Analysis' },
  { id: 'accessibility', layer: 2, title: 'Accessibility Analysis' },
  { id: 'security', layer: 2, title: 'Security QA Analysis' },
  { id: 'content', layer: 2, title: 'Content QA' },
  { id: 'visual', layer: 2, title: 'Visual Regression' },
  { id: 'failure-analysis', layer: 2, title: 'Failure Analysis' },
  { id: 'retest', layer: 2, title: 'Retest' },

  { id: 'layer-3', layer: 3, title: 'QA Analysis' },
  { id: 'coverage-analysis', layer: 3, title: 'Coverage Analysis' },
  { id: 'traceability', layer: 3, title: 'Requirement Traceability' },
  { id: 'defect-summary', layer: 3, title: 'Defect Summary' },
  { id: 'distribution', layer: 3, title: 'Test Result Distribution (UI Executions)' },
  { id: 'analytical-findings', layer: 3, title: 'Analytical Findings' },
  { id: 'quality-checks', layer: 3, title: 'Automated Quality Check' },
  { id: 'analysis-conclusion', layer: 3, title: 'Analysis Conclusion' },
  { id: 'trend', layer: 3, title: 'Run-over-run Trend' },

  { id: 'layer-4', layer: 4, title: 'Risks & Limitations' },

  { id: 'layer-5', layer: 5, title: 'Release Recommendation' },
  { id: 'entry-exit-criteria', layer: 5, title: 'Entry, Exit, and Severity Definitions' },
  { id: 'release-verdict', layer: 5, title: 'Verdict Against Exit Criteria' },
] as const;

export type SectionId = (typeof SECTION_MANIFEST)[number]['id'];

export const REF_TOKEN_PATTERN = /\{\{ref:([a-z0-9-]+)\}\}/g;

export interface NumberedSection {
  id: string;
  layer: ReportLayer;
  parentId?: string;
  title: string;
  number: string;
  heading: string;
}

function childIndex(sections: readonly ManifestSection[], parentId: string | undefined, layer: ReportLayer): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const section of sections) {
    if (section.layer !== layer) continue;
    if ((section.parentId ?? undefined) !== parentId) continue;
    if (section.id.startsWith('layer-')) continue;
    n += 1;
    map.set(section.id, n);
  }
  return map;
}

/** Assign 2.12 / 2.6.5 style numbers from manifest order. Layer titles keep LAYER N. */
export function numberSections(manifest: readonly ManifestSection[] = SECTION_MANIFEST): NumberedSection[] {
  const byId = new Map<string, NumberedSection>();

  for (const layer of [1, 2, 3, 4, 5] as const) {
    for (const section of manifest) {
      if (section.layer !== layer || !section.id.startsWith('layer-')) continue;
      byId.set(section.id, {
        ...section,
        number: `LAYER ${layer}`,
        heading: `LAYER ${layer} — ${section.title}`,
      });
    }
    const top = childIndex(manifest, undefined, layer);
    for (const section of manifest) {
      if (section.layer !== layer || section.parentId) continue;
      if (section.id.startsWith('layer-')) continue;
      const n = top.get(section.id);
      if (n == null) continue;
      const number = `${layer}.${n}`;
      byId.set(section.id, {
        ...section,
        number,
        heading: `${number} ${section.title}`,
      });
    }

    for (const section of manifest) {
      if (section.layer !== layer || !section.parentId) continue;
      const parent = byId.get(section.parentId);
      if (!parent) continue;
      const siblings = childIndex(manifest, section.parentId, layer);
      const n = siblings.get(section.id);
      if (n == null) continue;
      const number = `${parent.number}.${n}`;
      byId.set(section.id, {
        ...section,
        number,
        heading: `${number} ${section.title}`,
      });
    }
  }

  return manifest.map((section) => {
    const numbered = byId.get(section.id);
    if (!numbered) {
      throw new Error(`Section manifest failed to number "${section.id}".`);
    }
    return numbered;
  });
}

export function sectionById(
  id: string,
  numbered: readonly NumberedSection[] = numberSections()
): NumberedSection {
  const found = numbered.find((row) => row.id === id);
  if (!found) {
    throw new Error(`Unknown section id "${id}" — not in the section manifest.`);
  }
  return found;
}

export interface CrossReference {
  sectionId: string;
  renderedText: string;
}

export class DanglingSectionReferenceError extends Error {
  readonly unresolved: string[];

  constructor(unresolved: string[]) {
    super(
      `Report stage failed: dangling section reference(s) ${unresolved.join(', ')} — ` +
        `no matching emitted section. Cross-references must resolve through the section manifest.`
    );
    this.name = 'DanglingSectionReferenceError';
    this.unresolved = unresolved;
  }
}

/**
 * Tracks emitted section IDs and cross-references written during HTML/DOCX/text generation.
 * After generation, assertEveryReferenceResolves() THROWS — it does not warn.
 */
export class SectionRegistry {
  readonly numbered: readonly NumberedSection[];
  private readonly emitted = new Set<string>();
  private readonly refs: CrossReference[] = [];

  constructor(numbered: readonly NumberedSection[] = numberSections()) {
    this.numbered = numbered;
  }

  heading(id: string): string {
    return sectionById(id, this.numbered).heading;
  }

  number(id: string): string {
    return sectionById(id, this.numbered).number;
  }

  title(id: string): string {
    return sectionById(id, this.numbered).title;
  }

  emit(id: string): string {
    sectionById(id, this.numbered);
    this.emitted.add(id);
    return this.heading(id);
  }

  /** Link text includes the resolved number so a renumber cannot silently break prose. */
  ref(id: string): string {
    const section = sectionById(id, this.numbered);
    const rendered = `the ${section.title} section (${section.number})`;
    this.refs.push({ sectionId: id, renderedText: rendered });
    return rendered;
  }

  emittedIds(): string[] {
    return [...this.emitted];
  }

  references(): readonly CrossReference[] {
    return this.refs;
  }

  unresolvedReferences(): string[] {
    return [...new Set(this.refs.map((row) => row.sectionId).filter((id) => !this.emitted.has(id)))];
  }

  assertEveryReferenceResolves(): void {
    const unresolved = this.unresolvedReferences();
    if (unresolved.length > 0) {
      throw new DanglingSectionReferenceError(unresolved);
    }
  }
}

export function extractRefTokens(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(REF_TOKEN_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

export function resolveRefTokens(text: string, registry: SectionRegistry): string {
  return text.replace(REF_TOKEN_PATTERN, (_all, id: string) => registry.ref(id));
}
