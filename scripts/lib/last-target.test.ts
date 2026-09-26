import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PATHS } from './paths';
import { CLEAN_ALLOWLIST_RELATIVE, isAllowlistedCleanTarget, listCleanAllowlistTargets } from './clean-test-data';
import { resolveOrchestratorUrl, stripWebsiteTargetArgs } from '../orchestrator/resolve-url';
import {
  parsePersistableWebsiteUrl,
  persistCliWebsiteUrl,
  persistLastTargetUrl,
  readLastTargetUrl,
  websiteTargetEnv,
} from './last-target';

function tmpFile(label: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `qa-last-target-${label}-`)), 'qa.last-target.json');
}

describe('parsePersistableWebsiteUrl', () => {
  it('accepts http(s) URLs and rejects invalid values', () => {
    assert.equal(parsePersistableWebsiteUrl('https://example.test/app'), 'https://example.test/app');
    assert.equal(parsePersistableWebsiteUrl('http://example.test'), 'http://example.test');
    assert.equal(parsePersistableWebsiteUrl('ftp://example.test'), null);
    assert.equal(parsePersistableWebsiteUrl('not-a-url'), null);
    assert.equal(parsePersistableWebsiteUrl(''), null);
  });

  it('ignores loopback unless explicitly allowed', () => {
    assert.equal(parsePersistableWebsiteUrl('http://127.0.0.1:4173/'), null);
    assert.equal(parsePersistableWebsiteUrl('http://localhost:4173/'), null);
    assert.equal(
      parsePersistableWebsiteUrl('http://127.0.0.1:4173/', { allowLoopback: true }),
      'http://127.0.0.1:4173/'
    );
  });
});

describe('last-target persist file', () => {
  it('writes a validated URL and replaces the previous target', () => {
    const filePath = tmpFile('replace');
    const first = persistCliWebsiteUrl('https://first.example/', { filePath, now: new Date('2026-09-18T12:00:00.000Z') });
    assert.deepEqual(first, {
      websiteUrl: 'https://first.example/',
      updatedAt: '2026-09-18T12:00:00.000Z',
      source: 'cli-url',
    });
    assert.equal(readLastTargetUrl(filePath), 'https://first.example/');

    const second = persistCliWebsiteUrl('https://second.example/path', { filePath, now: new Date('2026-09-18T13:00:00.000Z') });
    assert.equal(second?.websiteUrl, 'https://second.example/path');
    assert.equal(readLastTargetUrl(filePath), 'https://second.example/path');
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { websiteUrl: string };
    assert.equal(stored.websiteUrl, 'https://second.example/path');
  });

  it('does not persist invalid URLs and does not write a file', () => {
    const filePath = tmpFile('invalid');
    assert.equal(persistCliWebsiteUrl('javascript:alert(1)', { filePath }), null);
    assert.equal(persistLastTargetUrl('not-a-url', 'cli-url', { filePath, allowLoopback: true }), null);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(readLastTargetUrl(filePath), null);
  });

  it('falls through when the persist file is missing', () => {
    const missing = path.join(os.tmpdir(), `qa-last-target-missing-${Date.now()}`, 'qa.last-target.json');
    assert.equal(readLastTargetUrl(missing), null);
    const url = resolveOrchestratorUrl({
      lastTargetUrl: readLastTargetUrl(missing),
      websiteUrl: 'https://www.saucedemo.com/',
      playwrightBaseUrl: 'https://www.saucedemo.com',
    });
    assert.equal(url, 'https://www.saucedemo.com/');
  });

  it('persists an explicit loopback CLI URL and refuses implicit loopback writes', () => {
    const filePath = tmpFile('loopback');
    assert.equal(persistLastTargetUrl('http://127.0.0.1:4173/', 'cli-url', { filePath }), null);
    const recorded = persistCliWebsiteUrl('http://127.0.0.1:4173/', { filePath });
    assert.equal(recorded?.websiteUrl, 'http://127.0.0.1:4173/');
    assert.equal(readLastTargetUrl(filePath), 'http://127.0.0.1:4173/');
  });
});

describe('resolveOrchestratorUrl last-target order', () => {
  it('prefers CLI, then Playwright env, then website env, then last-target, then seed, then loopback, then config', () => {
    const last = 'https://persisted.example/';
    const seed = 'https://seed.example/';
    const loopback = 'http://127.0.0.1:4173';
    const website = 'https://www.saucedemo.com/';

    assert.equal(
      resolveOrchestratorUrl({
        cliUrl: 'https://cli.example/',
        playwrightEnvUrl: 'https://pw.example/',
        envUrl: 'https://env.example/',
        lastTargetUrl: last,
        existingSeed: seed,
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      'https://cli.example/'
    );
    assert.equal(
      resolveOrchestratorUrl({
        playwrightEnvUrl: 'https://pw.example/',
        envUrl: 'https://env.example/',
        lastTargetUrl: last,
        existingSeed: seed,
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      'https://pw.example/'
    );
    assert.equal(
      resolveOrchestratorUrl({
        envUrl: 'https://env.example/',
        lastTargetUrl: last,
        existingSeed: seed,
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      'https://env.example/'
    );
    assert.equal(
      resolveOrchestratorUrl({
        lastTargetUrl: last,
        existingSeed: seed,
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      last
    );
    assert.equal(
      resolveOrchestratorUrl({
        existingSeed: seed,
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      seed
    );
    assert.equal(
      resolveOrchestratorUrl({
        playwrightBaseUrl: loopback,
        websiteUrl: website,
      }),
      'http://127.0.0.1:4173/'
    );
    assert.equal(resolveOrchestratorUrl({ websiteUrl: website }), website);
  });
});

describe('websiteTargetEnv', () => {
  it('strips --url and positional website targets from leftover Playwright args', () => {
    assert.deepEqual(
      stripWebsiteTargetArgs(['--url=https://example.test/', '--headed', '--approve-baseline-update']),
      ['--headed', '--approve-baseline-update']
    );
    assert.deepEqual(stripWebsiteTargetArgs(['https://example.test/', '--debug']), ['--debug']);
  });

  it('sets both QA_WEBSITE_URL and QA_PLAYWRIGHT_BASE_URL from the resolved URL', () => {
    assert.deepEqual(websiteTargetEnv('https://example.test'), {
      QA_WEBSITE_URL: 'https://example.test/',
      QA_PLAYWRIGHT_BASE_URL: 'https://example.test',
    });
    assert.deepEqual(websiteTargetEnv('https://example.test/'), {
      QA_WEBSITE_URL: 'https://example.test/',
      QA_PLAYWRIGHT_BASE_URL: 'https://example.test',
    });
  });
});

describe('qa:clean does not delete last-target', () => {
  it('keeps qa.last-target.json off the clean allowlist', () => {
    assert.equal(PATHS.lastTarget, path.join(PATHS.root, 'qa.last-target.json'));
    assert.equal((CLEAN_ALLOWLIST_RELATIVE as readonly string[]).includes('qa.last-target.json'), false);
    const relatives = listCleanAllowlistTargets().map((target) =>
      path.relative(PATHS.root, target).replace(/\\/g, '/')
    );
    assert.equal(relatives.includes('qa.last-target.json'), false);
    assert.equal(isAllowlistedCleanTarget(PATHS.lastTarget), false);
  });
});
