import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import path from 'path';
import { makeResult } from '../engine-contract';
import { NOT_AVAILABLE } from '../../lib/suite-origin';
import { PATHS } from '../../lib/paths';
import {
  createExecutionContext,
  createProjectContext,
  resolveExecutionPaths,
  setCurrentExecutionContext,
} from './project-context';

afterEach(() => {
  setCurrentExecutionContext(null);
});

describe('project execution context', () => {
  it('resolveExecutionPaths differs for app-a and app-b and neither equals default reports root', () => {
    const a = resolveExecutionPaths({ projectId: 'app-a' });
    const b = resolveExecutionPaths({ projectId: 'app-b' });
    const def = resolveExecutionPaths({ projectId: 'default' });

    assert.equal(def.reportsRoot, PATHS.reports.root);
    assert.equal(def.historyRoot, PATHS.reports.history);
    assert.equal(def.lastTarget, PATHS.lastTarget);

    assert.notEqual(a.reportsRoot, b.reportsRoot);
    assert.notEqual(a.reportsRoot, PATHS.reports.root);
    assert.notEqual(b.reportsRoot, PATHS.reports.root);
    assert.ok(a.reportsRoot.includes(path.join('projects', 'app-a')));
    assert.ok(b.reportsRoot.includes(path.join('projects', 'app-b')));
    assert.notEqual(a.lastTarget, PATHS.lastTarget);
    assert.ok(a.lastTarget.includes(path.join('projects', 'app-a')));
  });

  it('createExecutionContext omits baseUrl when config URLs are empty', () => {
    const ctx = createExecutionContext({
      projectId: 'default',
      config: {
        project: { id: 'default', name: 'QA Automation' },
        environment: { active: 'development' },
        environments: {
          development: { websiteUrl: '', apiUrl: '' },
        },
        urls: { website: '', api: '' },
      },
      env: {},
      argv: [],
    });
    assert.equal(ctx.baseUrl, undefined);
    assert.equal(ctx.apiBaseUrl, undefined);
    assert.ok(!('baseUrl' in ctx && ctx.baseUrl));
    const serialized = JSON.stringify(ctx);
    assert.doesNotMatch(serialized, /saucedemo/i);
    assert.doesNotMatch(serialized, /jsonplaceholder/i);
  });

  it('createExecutionContext uses environments map when urls are empty', () => {
    const ctx = createExecutionContext({
      projectId: 'default',
      config: {
        project: { id: 'default', name: 'QA Automation' },
        environment: { active: 'staging' },
        environments: {
          staging: {
            websiteUrl: 'https://staging.example.test',
            apiUrl: 'https://api.staging.example.test',
          },
        },
        urls: { website: '', api: '' },
      },
      env: {},
      argv: [],
    });
    assert.equal(ctx.baseUrl, 'https://staging.example.test');
    assert.equal(ctx.apiBaseUrl, 'https://api.staging.example.test');
    assert.equal(ctx.environment, 'staging');
  });

  it('accepts environment local and rejects prod', () => {
    const local = createProjectContext({
      environment: 'local',
      env: {},
      argv: [],
    });
    assert.equal(local.environment, 'local');
    assert.throws(
      () =>
        createProjectContext({
          environment: 'prod',
          env: {},
          argv: [],
        }),
      /Unknown environment/
    );
  });

  it('commit/branch/build are NOT_AVAILABLE when CI env vars are absent', () => {
    const ctx = createExecutionContext({
      projectId: 'default',
      env: {},
      argv: [],
    });
    assert.equal(ctx.commit, NOT_AVAILABLE);
    assert.equal(ctx.branch, NOT_AVAILABLE);
    assert.equal(ctx.build, NOT_AVAILABLE);
  });

  it('makeResult metadata includes projectId, runId, timestamp; secrets stay redacted', () => {
    const execution = createExecutionContext({
      projectId: 'app-a',
      projectName: 'App A',
      env: {},
      argv: [],
    });
    setCurrentExecutionContext(execution);

    const result = makeResult({
      id: 'r1',
      testType: 'unit',
      category: 'functional',
      name: 'stamp',
      status: 'FAIL',
      error: { message: 'auth failed password=s3cret' },
    });

    assert.equal(result.metadata?.projectId, 'app-a');
    assert.notEqual(result.metadata?.projectId, 'app-b');
    assert.equal(result.metadata?.runId, result.metadata?.executionId);
    assert.equal(typeof result.metadata?.timestamp, 'string');
    assert.ok(String(result.metadata?.timestamp).length > 0);
    assert.doesNotMatch(result.error!.message, /s3cret/);
    assert.match(result.error!.message, /password=\[REDACTED\]/);
  });

  it('makeResult with execution arg stamps that project, not another', () => {
    const appA = createExecutionContext({
      projectId: 'app-a',
      env: {},
      argv: [],
    });
    const appB = createExecutionContext({
      projectId: 'app-b',
      env: {},
      argv: [],
    });
    setCurrentExecutionContext(appB);
    const result = makeResult(
      {
        id: 'r2',
        testType: 'unit',
        category: 'functional',
        name: 'a-only',
        status: 'PASS',
      },
      { execution: appA }
    );
    assert.equal(result.metadata?.projectId, 'app-a');
    assert.notEqual(result.metadata?.projectId, 'app-b');
  });
});
