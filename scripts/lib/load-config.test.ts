import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './load-config';

describe('loadConfig', () => {
  it('loads committed qa.config.json including optional tests metadata', () => {
    const config = loadConfig();

    assert.ok(config.urls, 'urls must remain present');
    assert.ok(config.postman, 'postman must remain present');
    assert.ok(config.playwright, 'playwright must remain present');
    assert.ok(config.jmeter, 'jmeter must remain present');

    assert.equal(config.environment?.active, 'development');
    assert.ok(config.environments, 'optional environments map must be present');
    assert.equal(config.environments?.local?.websiteUrl, '');
    assert.equal(config.environments?.development?.websiteUrl, '');
    assert.equal(config.environments?.staging?.websiteUrl, '');
    assert.equal(config.environments?.production?.websiteUrl, '');
    assert.doesNotMatch(JSON.stringify(config.environments), /saucedemo/i);
    assert.doesNotMatch(JSON.stringify(config.environments), /jsonplaceholder/i);

    assert.equal(config.tests?.unit.enabled, true);
    assert.equal(config.tests?.integration.enabled, false);
    assert.equal(config.tests?.regression.mode, 'selective');
    assert.equal(config.tests?.performance.load.enabled, false);
    assert.equal(config.tests?.performance.endurance.enabled, false);
    assert.equal(config.tests?.ai?.enabled, false);
  });
});
