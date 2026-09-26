import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  productionActionAllowed,
  resolveEnvironment,
  resolveEnvironmentEndpoints,
  type EnvironmentsConfig,
} from './environment';
import { resolveApiUrl, resolveWebsiteTarget } from '../../orchestrator/resolve-url';

const STAGING_MAP: EnvironmentsConfig = {
  local: { websiteUrl: '', apiUrl: '' },
  development: { websiteUrl: '', apiUrl: '' },
  staging: {
    websiteUrl: 'https://staging.example.test',
    apiUrl: 'https://api.staging.example.test',
  },
  production: { websiteUrl: '', apiUrl: '' },
};

describe('resolveEnvironmentEndpoints', () => {
  it('returns staging websiteUrl when fallback urls are empty', () => {
    const resolved = resolveEnvironmentEndpoints({
      active: 'staging',
      environments: STAGING_MAP,
      fallbackWebsite: '',
      fallbackApi: '',
    });
    assert.equal(resolved.websiteUrl, 'https://staging.example.test');
    assert.equal(resolved.apiUrl, 'https://api.staging.example.test');
  });

  it('falls back to urls.website when environment websiteUrl is blank', () => {
    const resolved = resolveEnvironmentEndpoints({
      active: 'development',
      environments: {
        development: { websiteUrl: '', apiUrl: '' },
      },
      fallbackWebsite: 'https://fallback.example.test',
      fallbackApi: 'https://api.fallback.example.test',
    });
    assert.equal(resolved.websiteUrl, 'https://fallback.example.test');
    assert.equal(resolved.apiUrl, 'https://api.fallback.example.test');
  });

  it('ignores unknown active names (never treats typo as production)', () => {
    const resolved = resolveEnvironmentEndpoints({
      active: 'prod',
      environments: {
        production: {
          websiteUrl: 'https://prod.example.test',
          apiUrl: 'https://api.prod.example.test',
        },
      },
      fallbackWebsite: 'https://fallback.example.test',
      fallbackApi: '',
    });
    assert.equal(resolved.websiteUrl, 'https://fallback.example.test');
    assert.equal(resolved.apiUrl, '');
  });

  it('accepts environment local', () => {
    assert.equal(resolveEnvironment({ cli: 'local' }), 'local');
    const resolved = resolveEnvironmentEndpoints({
      active: 'local',
      environments: {
        local: { websiteUrl: 'https://local.example.test', apiUrl: '' },
      },
      fallbackWebsite: '',
      fallbackApi: '',
    });
    assert.equal(resolved.websiteUrl, 'https://local.example.test');
  });
});

describe('resolveWebsiteTarget environment tier', () => {
  it('CLI and QA_WEBSITE_URL beat environments.staging.websiteUrl', () => {
    assert.equal(
      resolveWebsiteTarget({
        cliUrl: 'https://cli.example.test',
        websiteUrl: '',
        environments: STAGING_MAP,
        activeEnvironment: 'staging',
      }),
      'https://cli.example.test'
    );
    assert.equal(
      resolveWebsiteTarget({
        websiteEnvUrl: 'https://env.example.test',
        websiteUrl: '',
        environments: STAGING_MAP,
        activeEnvironment: 'staging',
      }),
      'https://env.example.test'
    );
    assert.equal(
      resolveWebsiteTarget({
        websiteUrl: '',
        environments: STAGING_MAP,
        activeEnvironment: 'staging',
      }),
      'https://staging.example.test'
    );
  });

  it('uses urls.website when environment entry is blank', () => {
    assert.equal(
      resolveWebsiteTarget({
        websiteUrl: 'https://urls.example.test',
        environments: {
          development: { websiteUrl: '', apiUrl: '' },
        },
        activeEnvironment: 'development',
      }),
      'https://urls.example.test'
    );
  });
});

describe('resolveApiUrl environment tier', () => {
  it('QA_API_URL beats environments map', () => {
    assert.equal(
      resolveApiUrl({
        envUrl: 'https://api-env.example.test',
        apiUrl: '',
        environments: STAGING_MAP,
        activeEnvironment: 'staging',
      }),
      'https://api-env.example.test'
    );
    assert.equal(
      resolveApiUrl({
        envUrl: '',
        apiUrl: '',
        environments: STAGING_MAP,
        activeEnvironment: 'staging',
      }),
      'https://api.staging.example.test'
    );
  });
});

describe('productionActionAllowed', () => {
  const actions = [
    'destructive',
    'heavy-performance',
    'chaos-resilience',
    'data-mutation',
  ] as const;

  it('production + no flags → all four actions BLOCKED / not allowed', () => {
    for (const action of actions) {
      const result = productionActionAllowed(action, 'production', {});
      assert.equal(result.allowed, false);
      assert.equal(result.production, true);
      assert.equal(result.blockedByEnvironment, true);
      assert.equal(result.status, 'BLOCKED');
      assert.notEqual(result.status, 'PASS' as string);
    }
  });

  it('production + only authorizeHeavy → heavy allowed; destructive and data-mutation not', () => {
    const heavy = productionActionAllowed('heavy-performance', 'production', {
      authorizeHeavy: true,
    });
    assert.equal(heavy.allowed, true);
    assert.equal(heavy.status, undefined);

    const destructive = productionActionAllowed('destructive', 'production', {
      authorizeHeavy: true,
    });
    assert.equal(destructive.allowed, false);
    assert.equal(destructive.status, 'BLOCKED');

    const mutation = productionActionAllowed('data-mutation', 'production', {
      authorizeHeavy: true,
    });
    assert.equal(mutation.allowed, false);
    assert.equal(mutation.status, 'BLOCKED');

    const chaos = productionActionAllowed('chaos-resilience', 'production', {
      authorizeHeavy: true,
    });
    assert.equal(chaos.allowed, false);
    assert.equal(chaos.status, 'BLOCKED');
  });

  it('production + both mutation flags → data-mutation allowed', () => {
    const mutation = productionActionAllowed('data-mutation', 'production', {
      authorizeDataMutation: true,
      authorizeDestructive: true,
    });
    assert.equal(mutation.allowed, true);
    assert.equal(mutation.production, true);
    assert.equal(mutation.blockedByEnvironment, false);

    const mutationOnlyData = productionActionAllowed('data-mutation', 'production', {
      authorizeDataMutation: true,
    });
    assert.equal(mutationOnlyData.allowed, false);
    assert.match(mutationOnlyData.reason, /data mutation requires explicit authorization/);
  });

  it('non-production is planning-only allowed and does not skip engine flags', () => {
    const result = productionActionAllowed('destructive', 'staging', {});
    assert.equal(result.allowed, true);
    assert.equal(result.production, false);
    assert.equal(result.blockedByEnvironment, false);
    assert.equal(result.reason, 'not production');
    assert.equal(result.status, undefined);
  });

  it('chaos unauthorized reason is explicit', () => {
    const result = productionActionAllowed('chaos-resilience', 'production', {});
    assert.equal(result.allowed, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reason, 'production chaos/resilience requires explicit authorization');
  });
});
