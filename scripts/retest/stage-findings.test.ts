import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE } from '../lib/suite-origin';
import type { ClassifiedFailure } from '../failures/types';
import { matchStageFinding, stageFindingStatus } from './stage-findings';

function row(partial: Partial<ClassifiedFailure> & Pick<ClassifiedFailure, 'id' | 'testId' | 'title' | 'source'>): ClassifiedFailure {
  return {
    classification: 'ASSERTION_FAILURE',
    ruleFired: 'ERROR_TEXT_ASSERTION',
    evidenceExcerpt: NOT_AVAILABLE,
    confidence: 'high',
    rationale: 'fixture',
    evidence: {
      id: partial.id,
      source: partial.source,
      title: partial.title,
      testId: partial.testId,
      specFile: 'reports/security/summary.json',
      projectName: NOT_AVAILABLE,
      errorMessage: NOT_AVAILABLE,
      stackTrace: NOT_AVAILABLE,
      durationMs: NOT_AVAILABLE,
      retryCount: 0,
      attemptStatuses: ['failed'],
      screenshotPath: null,
      screenshotPresent: false,
      tracePath: null,
      videoPath: null,
    },
    ...partial,
  };
}

describe('stage finding mapping', () => {
  it('matches SEO ids and security rule::page test ids', () => {
    const seo = row({
      id: 'SEO-0001',
      testId: 'SEO-0001',
      title: 'missing-h1',
      source: 'seo',
    });
    assert.equal(
      matchStageFinding(seo, [{ id: 'SEO-0001', status: 'FAIL', rule: 'missing-h1' }])?.id,
      'SEO-0001'
    );

    const security = row({
      id: 'SECURITY-0001',
      testId: 'security::content-security-policy::https://www.saucedemo.com/',
      title: 'content-security-policy',
      source: 'security',
    });
    const matched = matchStageFinding(security, [
      { status: 'FAIL', rule: 'content-security-policy', page: 'https://www.saucedemo.com/' },
    ]);
    assert.equal(matched?.rule, 'content-security-policy');
  });

  it('does not invent PASS when the finding is missing', () => {
    const mapped = stageFindingStatus(null);
    assert.equal(mapped.status, 'NOT_EXECUTED');
    assert.match(mapped.reason, /Original FAIL preserved/);
  });

  it('maps FAIL and PASS honestly', () => {
    assert.equal(stageFindingStatus({ status: 'FAIL' }).status, 'FAIL');
    assert.equal(stageFindingStatus({ status: 'PASS' }).status, 'PASS');
    assert.equal(stageFindingStatus({ status: 'WARNING' }).status, 'NOT_EXECUTED');
  });

  it('does not bind collector SEO-0002 to a different finding that reused that id', () => {
    const sitemap = row({
      id: 'SEO-0004',
      testId: 'SEO-0013',
      title: 'sitemap-xml',
      source: 'seo',
    });
    const matched = matchStageFinding(sitemap, [
      { id: 'SEO-0004', status: 'WARNING', rule: 'robots-noindex' },
      { id: 'SEO-0013', status: 'FAIL', rule: 'sitemap-xml' },
    ]);
    assert.equal(matched?.id, 'SEO-0013');
    assert.equal(stageFindingStatus(matched).status, 'FAIL');
  });
});
