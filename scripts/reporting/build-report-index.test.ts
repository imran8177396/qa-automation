import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderFallbackCombinedMarkdown, renderRawIndexMarkdown } from './build-report-index';

describe('report index writers', () => {
  it('records BLOCKED for a failed professional pack and does not invent PASS or 100% coverage', () => {
    const markdown = renderFallbackCombinedMarkdown({
      generatedAt: '2026-09-16T00:00:00.000Z',
      projectName: 'QA Automation',
      professionalError: 'zero-exec-pass: Suite(s) with zero executed items rendered PASS: Visual.',
    });
    assert.match(markdown, /\*\*Verdict:\*\* BLOCKED/);
    assert.match(markdown, /zero-exec-pass/);
    assert.match(markdown, /Failures remain FAIL/);
    assert.doesNotMatch(markdown, /\*\*Verdict:\*\* PASS/);
    assert.doesNotMatch(markdown, /100%/);
  });

  it('renders raw-index rows from disk statuses without rewriting tool results', () => {
    const md = renderRawIndexMarkdown({
      generatedAt: '2026-09-16T00:00:00.000Z',
      project: 'QA Automation',
      note: 'Statuses reflect files on disk only.',
      kinds: [
        {
          id: 'jmeter',
          name: 'JMeter report',
          status: 'NOT_EXECUTED',
          path: 'reports/jmeter',
          reason: 'No JMeter HTML/JTL/summary under reports/jmeter/. Scores were not invented.',
        },
      ],
    });
    assert.match(md, /NOT_EXECUTED/);
    assert.match(md, /not invented/i);
  });
});
