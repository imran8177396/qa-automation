import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QaConfig } from '../types';
import { documentedApiTarget, planInputFromConfig, renderJmeterPlan } from './jmx';

function config(): QaConfig {
  return {
    project: { name: 'QA Automation' },
    urls: { website: 'https://www.saucedemo.com/', api: 'https://jsonplaceholder.typicode.com' },
    pipeline: { steps: ['sync', 'api', 'e2e', 'load'], failFast: false },
    postman: { enabled: true, collectionName: 'QA Automation API', requests: [] },
    playwright: { enabled: true, baseURL: 'https://www.saucedemo.com', browsers: ['chromium'], headless: true },
    jmeter: {
      enabled: true,
      path: '/posts',
      threads: 5,
      rampUpSeconds: 5,
      loopCount: 1,
      defaultProfile: 'liveness',
      allowHeavyAgainst: [],
      profiles: {
        liveness: { threads: 5, rampUpSeconds: 5, loopCount: 1 },
        load: { threads: 20, rampUpSeconds: 20, loopCount: 5 },
        soak: { threads: 10, rampUpSeconds: 30, loopCount: -1, durationSeconds: 300 },
      },
    },
    github: { branches: ['main'], runOnPullRequest: true },
  };
}

describe('JMeter documented-API plans', () => {
  it('targets JSONPlaceholder GET /posts and never invents Sauce Demo REST', () => {
    const target = documentedApiTarget('https://jsonplaceholder.typicode.com', '/posts');
    assert.equal(target.host, 'jsonplaceholder.typicode.com');
    assert.equal(target.path, '/posts');
    const xml = renderJmeterPlan(planInputFromConfig(config(), 'liveness'));
    assert.match(xml, /jsonplaceholder\.typicode\.com/);
    assert.match(xml, /<stringProp name="HTTPSampler.path">\/posts<\/stringProp>/);
    assert.match(xml, /<stringProp name="HTTPSampler.method">GET<\/stringProp>/);
    assert.doesNotMatch(xml, /saucedemo/i);
    assert.match(xml, /0 XHR/);
    assert.match(xml, /RECORDED, never PASS/);
  });

  it('writes soak duration and marks heavy plans as authorized-only', () => {
    const soak = renderJmeterPlan(planInputFromConfig(config(), 'soak'));
    assert.match(soak, /<stringProp name="ThreadGroup.num_threads">10<\/stringProp>/);
    assert.match(soak, /<stringProp name="ThreadGroup.duration">300<\/stringProp>/);
    assert.match(soak, /HEAVY profile/);
    assert.match(soak, /authorize-heavy/);
    const load = renderJmeterPlan(planInputFromConfig(config(), 'load'));
    assert.match(load, /<stringProp name="ThreadGroup.num_threads">20<\/stringProp>/);
    assert.match(load, /HEAVY profile/);
  });
});
