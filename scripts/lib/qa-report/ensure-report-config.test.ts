import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QaConfig } from '../../types';
import { mergeReportConfigExtras } from './ensure-report-config';

function baseConfig(): QaConfig {
  return {
    project: { name: 'Test' },
    urls: { website: 'https://example.test/', api: 'https://example.test/api' },
    playwright: { baseURL: 'https://example.test/', browsers: ['chromium'] },
    github: { branches: ['main'], runOnPullRequest: true },
  } as QaConfig;
}

describe('report retention config', () => {
  it('fills default retention when missing', () => {
    const { extras, wrote } = mergeReportConfigExtras(baseConfig());
    assert.equal(wrote, true);
    assert.equal(extras.retention.keepHistoricalTimestampFolders, true);
    assert.equal(extras.retention.updateLatestManifest, true);
    assert.match(extras.retention.note, /retained/);
  });

  it('does not rewrite when retention is already complete', () => {
    const config = baseConfig();
    config.report = {
      enabled: true,
      format: 'docs/templates/qa-test-results.format.json',
      autoGenerateAfterTests: true,
      retention: {
        keepHistoricalTimestampFolders: true,
        updateLatestManifest: true,
        note: 'Previous dated packs under docs/input|output/qa-test-results/ are retained. Each run writes a new YYYY-MM-DD_HH-MM-SS folder (suffix -2, -3, … on collision). latest.json may be updated to point at the newest pack.',
      },
      signOff: {
        preparerName: '',
        preparerRole: 'Senior QA Automation Engineer',
        reviewerName: '',
        reviewerRole: '',
        approvalDate: '',
        distribution: '',
        confidentiality: '',
      },
      revisionHistory: [
        { version: '1.1', date: 'NOT_AVAILABLE', author: 'NOT_AVAILABLE', summary: 'Five-layer enterprise QA report format already used by this generator.' },
      ],
      criteria: {
        entry: ['a'],
        exit: ['b'],
        severity: { P0: 'x' },
        releaseBlocking: ['P0'],
      },
    };
    const { extras, wrote } = mergeReportConfigExtras(config);
    assert.equal(wrote, false);
    assert.equal(extras.retention.keepHistoricalTimestampFolders, true);
  });
});
