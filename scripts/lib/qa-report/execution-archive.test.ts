import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  allocateExecutionId,
  archiveToHistory,
  resolveProjectName,
  toFilesystemSlug,
  writeExecutionMetadata,
  type ExecutionIdentity,
} from './execution-archive';
import { PKT_OFFSET, PKT_TIMEZONE } from './timestamps';

function tmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qa-exec-archive-${label}-`));
}

describe('filesystem slug', () => {
  it('strips :/\\*?\"<>| and collapses whitespace without inventing a name', () => {
    assert.equal(toFilesystemSlug('QA Automation'), 'QA-Automation');
    assert.equal(toFilesystemSlug('Acme:App/Name*?\"<>|'), 'AcmeAppName');
    assert.equal(toFilesystemSlug('  Swag  Labs  '), 'Swag-Labs');
    assert.equal(toFilesystemSlug('www.saucedemo.com'), 'www.saucedemo.com');
  });
});

describe('resolveProjectName — do not invent', () => {
  it('uses explicit qa.config.json project.name', () => {
    const resolved = resolveProjectName({
      configName: 'QA Automation',
      env: {},
      baseUrl: 'https://www.saucedemo.com/',
      discoveredTitle: 'Swag Labs',
    });
    assert.equal(resolved.projectName, 'QA Automation');
    assert.equal(resolved.projectNameSource, 'config');
    assert.equal(resolved.slug, 'QA-Automation');
    assert.equal(resolved.websiteName, 'Swag Labs');
    assert.equal(resolved.websiteNameSource, 'discovery-title');
    assert.equal(resolved.hostnameFallback, false);
  });

  it('uses explicit env website/application name when config name is absent', () => {
    const resolved = resolveProjectName({
      configName: '',
      env: { QA_WEBSITE_NAME: 'Documented Site' },
      baseUrl: 'https://example.test/',
      discoveredTitle: '',
    });
    assert.equal(resolved.projectName, 'Documented Site');
    assert.equal(resolved.projectNameSource, 'env');
    assert.equal(resolved.websiteName, 'Documented Site');
    assert.equal(resolved.websiteNameSource, 'env');
  });

  it('uses discovered title when config and env names are absent', () => {
    const resolved = resolveProjectName({
      configName: '  ',
      env: {},
      baseUrl: 'https://www.saucedemo.com/',
      discoveredTitle: 'Swag Labs',
    });
    assert.equal(resolved.projectName, 'Swag Labs');
    assert.equal(resolved.projectNameSource, 'discovery-title');
  });

  it('falls back to hostname and records that fallback — never invents a product name', () => {
    const resolved = resolveProjectName({
      configName: '',
      env: {},
      baseUrl: 'https://www.saucedemo.com/inventory.html',
      discoveredTitle: '',
    });
    assert.equal(resolved.projectName, 'www.saucedemo.com');
    assert.equal(resolved.projectNameSource, 'hostname-fallback');
    assert.equal(resolved.websiteName, 'www.saucedemo.com');
    assert.equal(resolved.websiteNameSource, 'hostname-fallback');
    assert.equal(resolved.hostnameFallback, true);
    assert.notEqual(resolved.projectName, 'Sauce Demo');
    assert.notEqual(resolved.projectName, 'Swag Labs');
  });
});

describe('allocateExecutionId collision', () => {
  it('uses ProjectName_YYYY-MM-DD_HH-mm-ss_PKT then _01', () => {
    const root = tmpDir('alloc');
    const startedAt = new Date('2026-09-17T14:17:10.000Z');
    const first = allocateExecutionId('QA-Automation', startedAt, root);
    assert.equal(first.folderName, 'QA-Automation_2026-09-17_19-17-10_PKT');
    assert.equal(first.timestamp, '2026-09-17_19-17-10');
    assert.equal(fs.existsSync(first.folderPath), true);

    const second = allocateExecutionId('QA-Automation', startedAt, root);
    assert.equal(second.folderName, 'QA-Automation_2026-09-17_19-17-10_PKT_01');
    assert.notEqual(second.folderPath, first.folderPath);
    assert.equal(fs.existsSync(second.folderPath), true);
  });
});

describe('writeExecutionMetadata / archiveToHistory', () => {
  function identity(folderPath: string): ExecutionIdentity {
    return {
      executionId: 'QA-Automation_2026-09-17_19-17-10_PKT',
      folderName: 'QA-Automation_2026-09-17_19-17-10_PKT',
      folderPath,
      projectName: 'QA Automation',
      websiteName: 'www.saucedemo.com',
      baseUrl: 'https://www.saucedemo.com/',
      projectNameSource: 'config',
      websiteNameSource: 'hostname-fallback',
      hostnameFallback: true,
      startTime: '2026-09-17T19:17:10+05:00',
      timestamp: '2026-09-17_19-17-10',
      timezone: PKT_TIMEZONE,
      timezoneOffset: PKT_OFFSET,
      testSuite: 'qa:all',
      startedAtMs: Date.parse('2026-09-17T14:17:10.000Z'),
    };
  }

  it('writes required metadata fields with real PKT offset', () => {
    const folder = tmpDir('meta');
    const { metadata } = writeExecutionMetadata(identity(folder), {
      endedAt: new Date('2026-09-17T14:20:00.000Z'),
      overallStatus: 'BLOCKED',
      env: { NODE_ENV: 'test' },
    });
    assert.equal(metadata.timezone, 'Asia/Karachi');
    assert.equal(metadata.timezoneOffset, '+05:00');
    assert.equal(metadata.startTime, '2026-09-17T19:17:10+05:00');
    assert.equal(metadata.endTime, '2026-09-17T19:20:00+05:00');
    assert.equal(metadata.projectName, 'QA Automation');
    assert.equal(metadata.overallStatus, 'BLOCKED');
    assert.equal(fs.existsSync(path.join(folder, 'execution-metadata.json')), true);
  });

  it('copies artifacts that exist and does not invent Allure when absent', () => {
    const historyRoot = tmpDir('hist');
    const reportsRoot = tmpDir('reports');
    fs.mkdirSync(path.join(reportsRoot, 'summary'), { recursive: true });
    fs.mkdirSync(path.join(reportsRoot, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(reportsRoot, 'playwright'), { recursive: true });
    fs.mkdirSync(path.join(reportsRoot, 'allure'), { recursive: true });
    fs.writeFileSync(path.join(reportsRoot, 'summary', 'final-qa-report.json'), '{"verdict":"BLOCKED"}\n');
    fs.writeFileSync(path.join(reportsRoot, 'coverage', 'coverage.json'), '{"totals":{}}\n');
    fs.writeFileSync(path.join(reportsRoot, 'playwright', 'results.json'), '{"suites":[]}\n');
    fs.writeFileSync(path.join(reportsRoot, 'allure', '.gitkeep'), '');

    const folderPath = path.join(historyRoot, 'QA-Automation_2026-09-17_19-17-10_PKT');
    fs.mkdirSync(folderPath, { recursive: true });
    const result = archiveToHistory({
      identity: identity(folderPath),
      endedAt: new Date('2026-09-17T14:20:00.000Z'),
      overallStatus: 'BLOCKED',
      reportsRoot,
      env: { NODE_ENV: 'test' },
    });

    assert.equal(fs.existsSync(path.join(folderPath, 'modules', 'summary', 'final-qa-report.json')), true);
    assert.equal(fs.existsSync(path.join(folderPath, 'modules', 'coverage', 'coverage.json')), true);
    assert.equal(fs.existsSync(path.join(folderPath, 'modules', 'playwright', 'results.json')), true);
    assert.equal(fs.existsSync(path.join(folderPath, 'allure', 'results')), false);
    assert.equal(fs.existsSync(path.join(folderPath, 'allure', 'report')), false);
    assert.ok(result.copied.includes('modules/summary/'));
    assert.ok(result.copied.includes('modules/coverage/'));
    assert.ok(result.copied.includes('modules/playwright/'));
    assert.ok(!result.copied.some((row) => row.startsWith('allure')));
    assert.equal(result.metadata.timezone, 'Asia/Karachi');
  });

  it('writes a second execution into a new folder and does not mix into the first', () => {
    const historyRoot = tmpDir('hist-two');
    const reportsA = tmpDir('reports-a');
    const reportsB = tmpDir('reports-b');
    fs.mkdirSync(path.join(reportsA, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(reportsB, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(reportsA, 'coverage', 'coverage.json'), '{"run":"first"}\n');
    fs.writeFileSync(path.join(reportsB, 'coverage', 'coverage.json'), '{"run":"second"}\n');

    const firstPath = path.join(historyRoot, 'QA-Automation_2026-09-17_19-17-10_PKT');
    fs.mkdirSync(firstPath, { recursive: true });
    const first = archiveToHistory({
      identity: identity(firstPath),
      reportsRoot: reportsA,
      overallStatus: 'FAIL',
      env: { NODE_ENV: 'test' },
    });

    const secondPath = path.join(historyRoot, 'QA-Automation_2026-09-17_19-17-10_PKT_01');
    fs.mkdirSync(secondPath, { recursive: true });
    const secondIdentity = {
      ...identity(secondPath),
      executionId: 'QA-Automation_2026-09-17_19-17-10_PKT_01',
      folderName: 'QA-Automation_2026-09-17_19-17-10_PKT_01',
    };
    const second = archiveToHistory({
      identity: secondIdentity,
      reportsRoot: reportsB,
      overallStatus: 'BLOCKED',
      env: { NODE_ENV: 'test' },
    });

    assert.notEqual(second.folderPath, first.folderPath);
    assert.equal(fs.existsSync(path.join(firstPath, 'modules', 'coverage', 'coverage.json')), true);
    assert.equal(fs.existsSync(path.join(secondPath, 'modules', 'coverage', 'coverage.json')), true);
    assert.equal(fs.readFileSync(path.join(firstPath, 'modules', 'coverage', 'coverage.json'), 'utf8'), '{"run":"first"}\n');
    assert.equal(fs.readFileSync(path.join(secondPath, 'modules', 'coverage', 'coverage.json'), 'utf8'), '{"run":"second"}\n');
    assert.equal(first.identity.executionId, 'QA-Automation_2026-09-17_19-17-10_PKT');
    assert.equal(second.identity.executionId, 'QA-Automation_2026-09-17_19-17-10_PKT_01');
  });
});
