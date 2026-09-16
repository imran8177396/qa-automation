import type { ParsedHtml } from '../lib/html-snapshot';
import { emptyHeadings, skippedHeadingLevels } from '../seo/heading-structure';
import type { ContentFinding } from './types';
import { findPlaceholderHits } from './placeholders';
import { duplicateContentGroups } from './duplicate';

export interface ContentPageInput {
  url: string;
  title: string;
  h1s: string[];
  headings: Array<{ level: string; text: string }>;
  parsed: ParsedHtml | null;
  fetchError?: string;
}

function headingsOf(page: ContentPageInput): Array<{ level: string; text: string }> {
  if (page.parsed && page.parsed.headings.length > 0) {
    return page.parsed.headings;
  }
  if (page.headings.length > 0) return page.headings;
  return page.h1s.map((text) => ({ level: 'h1', text }));
}

export function analyzeContentPage(page: ContentPageInput): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const headings = headingsOf(page);
  const title = (page.parsed?.title ?? page.title).trim();
  const text = page.parsed?.visibleText.trim() ?? '';

  if (page.fetchError) {
    findings.push({
      status: 'BLOCKED',
      rule: 'page-html',
      severity: 'medium',
      page: page.url,
      detail: `Page HTML could not be fetched: ${page.fetchError}`,
      expected: 'reachable GET of the crawled page',
      actual: page.fetchError,
    });
  }

  if (!title) {
    findings.push({
      status: 'FAIL',
      rule: 'missing-title',
      severity: 'high',
      page: page.url,
      detail: 'Page has no title in the discovery snapshot or HTML GET.',
      expected: 'non-empty title',
      actual: '(empty)',
    });
  } else {
    findings.push({
      status: 'PASS',
      rule: 'missing-title',
      severity: 'info',
      page: page.url,
      detail: 'Page has a non-empty title.',
      expected: 'non-empty title',
      actual: title,
    });
  }

  const hasSubstance = text.length >= 20 || headings.length > 0;
  if (!page.fetchError) {
    if (!hasSubstance) {
      findings.push({
        status: 'FAIL',
        rule: 'missing-content',
        severity: 'high',
        page: page.url,
        detail: 'Page has no headings and little or no visible text.',
        expected: 'visible content or headings',
        actual: `${text.length} characters, ${headings.length} heading(s)`,
      });
    } else {
      findings.push({
        status: 'PASS',
        rule: 'missing-content',
        severity: 'info',
        page: page.url,
        detail: headings.length === 0
          ? 'Page has visible text but no headings.'
          : 'Page has visible text and/or headings.',
        expected: 'visible content',
        actual: `${text.length} characters, ${headings.length} heading(s)`,
      });
    }
  }

  const empty = emptyHeadings(headings);
  if (empty.length > 0) {
    findings.push({
      status: 'FAIL',
      rule: 'empty-heading',
      severity: 'medium',
      page: page.url,
      detail: `${empty.length} empty heading(s): ${empty.map((row) => row.level).join(', ')}.`,
      expected: 'headings with visible text',
      actual: `${empty.length} empty`,
    });
  } else if (headings.length > 0) {
    findings.push({
      status: 'PASS',
      rule: 'empty-heading',
      severity: 'info',
      page: page.url,
      detail: 'Observed headings have visible text.',
      expected: 'non-empty heading text',
      actual: `${headings.length} heading(s)`,
    });
  }

  const skipped = skippedHeadingLevels(headings);
  if (skipped.length > 0) {
    findings.push({
      status: 'WARNING',
      rule: 'heading-structure',
      severity: 'low',
      page: page.url,
      detail: `Heading structure skips h${skipped.join(', h')}.`,
      expected: 'heading levels without skips',
      actual: headings.map((row) => row.level).join(', '),
    });
  }

  if (!page.fetchError && page.parsed) {
    const placeholders = findPlaceholderHits(text);
    if (placeholders.length > 0) {
      findings.push({
        status: 'FAIL',
        rule: 'placeholder-text',
        severity: 'medium',
        page: page.url,
        detail: `Placeholder token(s) found: ${placeholders.map((hit) => hit.id).join(', ')}.`,
        expected: 'no lorem ipsum / TODO / TBD / FIXME / placeholder copy',
        actual: placeholders.map((hit) => hit.excerpt).join(' | '),
      });
    } else {
      findings.push({
        status: 'PASS',
        rule: 'placeholder-text',
        severity: 'info',
        page: page.url,
        detail: 'No common placeholder tokens were found in visible text.',
        expected: 'no placeholder tokens',
        actual: 'none detected',
      });
    }

    const malformed: string[] = [];
    if (/\{\{\s*[\w.]+\s*\}\}/.test(text)) malformed.push('mustache placeholder');
    if (/\[object Object\]/.test(text)) malformed.push('[object Object]');
    if (empty.length > 0) malformed.push('empty heading');
    if (malformed.length > 0) {
      findings.push({
        status: 'FAIL',
        rule: 'malformed-content',
        severity: 'medium',
        page: page.url,
        detail: `Malformed content indicator(s): ${malformed.join(', ')}.`,
        expected: 'no leftover template tokens or empty headings',
        actual: malformed.join(', '),
      });
    } else {
      findings.push({
        status: 'PASS',
        rule: 'malformed-content',
        severity: 'info',
        page: page.url,
        detail: 'No leftover template tokens or empty-heading malformations were detected.',
        expected: 'well-formed visible content',
        actual: 'no template leftovers',
      });
    }
  } else if (!page.parsed) {
    findings.push({
      status: 'NOT_TESTED',
      rule: 'placeholder-text',
      severity: 'info',
      page: page.url,
      detail: 'Visible text was not available — placeholder and malformed-content checks were not run.',
      expected: 'HTML snapshot',
      actual: page.fetchError ?? 'no HTML',
    });
  }

  return findings;
}

export function analyzeDuplicateContent(pages: ContentPageInput[]): ContentFinding[] {
  const withText = pages
    .filter((page) => page.parsed && !page.fetchError)
    .map((page) => ({ url: page.url, text: page.parsed!.visibleText }));

  if (withText.length < 2) {
    return [
      {
        status: 'NOT_TESTED',
        rule: 'duplicate-content',
        severity: 'info',
        page: 'site-wide',
        detail: 'Duplicate content is not detectable from a single crawled page.',
        expected: 'two or more crawled pages',
        actual: `${withText.length} page(s) with HTML text`,
      },
    ];
  }

  const groups = duplicateContentGroups(withText);
  if (groups.length === 0) {
    return [
      {
        status: 'PASS',
        rule: 'duplicate-content',
        severity: 'info',
        page: 'site-wide',
        detail: 'Crawled pages do not share an identical visible-text hash.',
        expected: 'distinct content hashes',
        actual: `${withText.length} distinct page(s)`,
      },
    ];
  }

  return groups.map((urls) => ({
    status: 'FAIL' as const,
    rule: 'duplicate-content',
    severity: 'medium' as const,
    page: 'site-wide',
    detail: `${urls.length} pages share identical visible text: ${urls.join(', ')}`,
    expected: 'distinct content per page',
    actual: `${urls.length} identical`,
  }));
}

export function analyzeExpectedValues(
  pages: ContentPageInput[],
  expectedValues: Array<{ claim: string; expected: string }>
): ContentFinding[] {
  if (expectedValues.length === 0) {
    return [
      {
        status: 'NOTE',
        rule: 'expected-content',
        severity: 'info',
        page: 'site-wide',
        detail:
          'content.expectedValues is not configured — business claims were not judged true or false.',
        expected: 'authoritative expectedValues when fact-checking is required',
        actual: 'not configured',
      },
    ];
  }

  const corpus = pages.map((page) => page.parsed?.visibleText ?? '').join('\n');
  return expectedValues.map((row) => {
    const found = corpus.includes(row.expected);
    return {
      status: found ? ('PASS' as const) : ('FAIL' as const),
      rule: 'expected-content',
      severity: found ? ('info' as const) : ('medium' as const),
      page: 'site-wide',
      detail: found
        ? `Configured expected value for "${row.claim}" was observed.`
        : `Configured expected value for "${row.claim}" was not found in crawled page text.`,
      expected: row.expected,
      actual: found ? 'present' : 'absent',
    };
  });
}
