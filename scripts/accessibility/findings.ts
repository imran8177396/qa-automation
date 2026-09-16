import fs from 'fs';
import path from 'path';
import { PATHS } from '../lib/paths';
import {
  A11Y_DISCLAIMER,
  A11Y_LIMITATIONS,
  A11Y_TESTING_MODE,
  type AccessibilityAxePage,
  type AccessibilityFinding,
  type AxeViolationRecord,
} from './types';

export function accessibilityWorkDir(): string {
  return path.join(PATHS.root, 'test-results', 'accessibility');
}

export function accessibilityFindingsDir(): string {
  return path.join(accessibilityWorkDir(), 'findings');
}

export function accessibilityAxeDir(): string {
  return path.join(accessibilityWorkDir(), 'axe');
}

export function accessibilityEvidenceDir(): string {
  return path.join(accessibilityWorkDir(), 'evidence');
}

export function formatFinding(finding: AccessibilityFinding): string {
  const lines = [
    `Status: ${finding.status}`,
    `Rule: ${finding.rule}`,
    `Page: ${finding.page} (${finding.pagePath})`,
    `Impact: ${finding.impact}`,
  ];
  if (finding.expected) lines.push(`Expected: ${finding.expected}`);
  lines.push(`Actual: ${finding.actual}`);
  if (finding.wcag) lines.push(`WCAG: ${finding.wcag}`);
  if (finding.selector) lines.push(`Selector: ${finding.selector}`);
  if (finding.helpUrl) lines.push(`Help: ${finding.helpUrl}`);
  return lines.join('\n');
}

export function slugFinding(finding: Pick<AccessibilityFinding, 'page' | 'rule'>): string {
  return [finding.page, finding.rule]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function formatAxeViolations(pagePath: string, violations: AxeViolationRecord[]): string {
  if (violations.length === 0) return `No axe violations on ${pagePath}`;
  const lines = [`axe violations on ${pagePath} (${violations.length}):`];
  for (const row of violations) {
    const targets = row.nodes.flatMap((node) => node.target).join(', ') || 'NOT_AVAILABLE';
    lines.push(`- ${row.id} (${row.impact ?? 'info'}): ${row.help ?? row.id} — ${targets}`);
  }
  return lines.join('\n');
}

export function loadAxePages(): AccessibilityAxePage[] {
  const dir = accessibilityAxeDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as AccessibilityAxePage);
}

export function loadCheckFindings(): AccessibilityFinding[] {
  const dir = accessibilityFindingsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as AccessibilityFinding);
}

function mergeAxePages(pages: AccessibilityAxePage[]): AccessibilityAxePage[] {
  const byPath = new Map<string, AccessibilityAxePage>();
  for (const page of pages) {
    const existing = byPath.get(page.path);
    if (!existing) {
      byPath.set(page.path, {
        url: page.url,
        path: page.path,
        violations: [...page.violations],
        incomplete: [...page.incomplete],
      });
      continue;
    }
    existing.violations.push(...page.violations);
    existing.incomplete.push(...page.incomplete);
  }
  return [...byPath.values()].map((page) => ({
    ...page,
    violations: dedupeRules(page.violations),
    incomplete: dedupeRules(page.incomplete),
  }));
}

function dedupeRules(rows: AxeViolationRecord[]): AxeViolationRecord[] {
  const seen = new Set<string>();
  const out: AxeViolationRecord[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function collectAxePages(): AccessibilityAxePage[] {
  return mergeAxePages(loadAxePages());
}

export function wcagFromTags(tags: string[] | undefined): string {
  if (!tags?.length) return 'NOT_AVAILABLE';
  const mapped = tags
    .filter((tag) => /^wcag\d+/i.test(tag))
    .map((tag) => {
      const digits = tag.replace(/[^0-9]/g, '');
      if (digits.length >= 3) return `${digits[0]}.${digits[1]}.${digits.slice(2)}`;
      return tag;
    });
  return mapped.length > 0 ? mapped.join(', ') : 'NOT_AVAILABLE';
}

export function axePagesToFindings(pages: AccessibilityAxePage[]): AccessibilityFinding[] {
  const findings: AccessibilityFinding[] = [];
  for (const page of pages) {
    for (const row of page.violations) {
      findings.push({
        status: 'FAIL',
        rule: `axe:${row.id}`,
        impact:
          row.impact === 'critical' || row.impact === 'serious' || row.impact === 'moderate' || row.impact === 'minor'
            ? row.impact
            : 'info',
        page: page.path === '/' ? 'login' : page.path.replace(/^\//, ''),
        pagePath: page.path,
        expected: 'axe-core reports no violations (rules are not filtered by impact)',
        actual: `${row.help ?? row.id} (${row.nodes.length} node(s))`,
        wcag: wcagFromTags(row.tags),
        selector: row.nodes[0]?.target.join(' ') ?? 'NOT_AVAILABLE',
        helpUrl: row.helpUrl,
        nodeCount: String(row.nodes.length),
      });
    }
    for (const row of page.incomplete) {
      findings.push({
        status: 'NOTE',
        rule: `axe-incomplete:${row.id}`,
        impact: 'info',
        page: page.path === '/' ? 'login' : page.path.replace(/^\//, ''),
        pagePath: page.path,
        expected: 'axe-core completed the rule',
        actual: `axe could not complete ${row.id}: ${row.help ?? row.id}`,
        wcag: wcagFromTags(row.tags),
        selector: row.nodes[0]?.target.join(' ') ?? 'NOT_AVAILABLE',
        helpUrl: row.helpUrl,
      });
    }
  }
  return findings;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function renderFindingsMarkdown(input: {
  target: string;
  passed: boolean;
  pages: AccessibilityAxePage[];
  findings: AccessibilityFinding[];
}): string {
  const violations = input.pages.flatMap((page) => page.violations);
  const fails = input.findings.filter((row) => row.status === 'FAIL');
  const checkFails = fails.filter((row) => !row.rule.startsWith('axe:'));
  const skipped = input.findings.filter((row) => row.status === 'NOT_APPLICABLE');
  const notes = input.findings.filter((row) => row.status === 'NOTE');
  const lines = [
    '# Accessibility findings',
    '',
    'Generated by `npm run test:accessibility`.',
    '',
    '## Testing mode',
    '',
    `**${A11Y_DISCLAIMER}**`,
    '',
    A11Y_TESTING_MODE,
    '',
    ...A11Y_LIMITATIONS.map((line) => `- ${line}`),
    '',
    `Target: ${input.target}`,
    `Suite result: ${input.passed ? 'PASS' : 'FAIL'}`,
    `Pages analyzed: ${input.pages.length || 'see summary'}`,
    `Axe violations: ${violations.length}`,
    `Non-axe check failures: ${checkFails.length}`,
    `NOT_APPLICABLE (not invented): ${skipped.length}`,
    '',
    '## Axe violations',
    '',
  ];

  if (violations.length === 0) {
    lines.push('No axe-core violations were recorded.', '');
  } else {
    lines.push('| Rule | Impact | WCAG | Page | Nodes | Help |', '| --- | --- | --- | --- | --- | --- |');
    for (const page of input.pages) {
      for (const row of page.violations) {
        lines.push(
          `| ${escapeCell(row.id)} | ${escapeCell(row.impact ?? 'info')} | ${escapeCell(wcagFromTags(row.tags))} | ${escapeCell(page.path)} | ${row.nodes.length} | ${escapeCell(row.helpUrl ?? '')} |`
        );
      }
    }
    lines.push('');
  }

  lines.push('## Check findings (FAIL)', '');
  if (checkFails.length === 0) {
    lines.push('No additional keyboard/structure/label/zoom/touch failures were recorded beyond axe.', '');
  } else {
    lines.push('| Rule | Impact | Page | Expected | Actual |', '| --- | --- | --- | --- | --- |');
    for (const row of checkFails) {
      lines.push(
        `| ${escapeCell(row.rule)} | ${row.impact} | ${escapeCell(`${row.page} (${row.pagePath})`)} | ${escapeCell(row.expected ?? '')} | ${escapeCell(row.actual)} |`
      );
    }
    lines.push('');
  }

  lines.push('## NOT_APPLICABLE (not invented)', '');
  if (skipped.length === 0) {
    lines.push('No NOT_APPLICABLE rows were recorded.', '');
  } else {
    lines.push('| Check | Page | Reason |', '| --- | --- | --- |');
    for (const row of skipped) {
      lines.push(
        `| ${escapeCell(row.rule)} | ${escapeCell(`${row.page} (${row.pagePath})`)} | ${escapeCell(row.actual)} |`
      );
    }
    lines.push('');
  }

  if (notes.length > 0) {
    lines.push('## Incomplete / notes', '', '| Rule | Page | Detail |', '| --- | --- | --- |');
    for (const row of notes) {
      lines.push(`| ${escapeCell(row.rule)} | ${escapeCell(row.pagePath)} | ${escapeCell(row.actual)} |`);
    }
    lines.push('');
  }

  lines.push(
    '## Disclaimer',
    '',
    A11Y_DISCLAIMER,
    '',
    'Automated accessibility testing is **QA-level automation**. A passing or failing run is not a WCAG 2.x conformance certification and is not a substitute for a complete manual accessibility audit with assistive technology.',
    ''
  );

  return `${lines.join('\n')}\n`;
}

export function copyAccessibilityEvidence(): string[] {
  const destDir = path.join(PATHS.reports.accessibility, 'evidence');
  fs.mkdirSync(destDir, { recursive: true });
  const source = accessibilityEvidenceDir();
  if (!fs.existsSync(source)) return [];
  const copied: string[] = [];
  for (const name of fs.readdirSync(source)) {
    const full = path.join(source, name);
    if (!fs.statSync(full).isFile()) continue;
    const dest = path.join(destDir, name);
    fs.copyFileSync(full, dest);
    copied.push(dest);
  }
  return copied;
}
