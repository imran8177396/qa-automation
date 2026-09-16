import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycle, ownerRequiresAutomationFix } from './lifecycle';
import { RETEST_LIFECYCLE_STAGES } from './types';

describe('retest lifecycle', () => {
  it('records the required FAIL → … → RECORD stages', () => {
    const entries = buildLifecycle({
      ownerClassification: 'APPLICATION',
      retestStatus: 'FAIL',
      executed: true,
      analysisPresent: true,
    });
    assert.deepEqual(
      entries.map((row) => row.stage),
      [...RETEST_LIFECYCLE_STAGES]
    );
    assert.equal(entries.find((row) => row.stage === 'FAIL')?.status, 'DONE');
    assert.equal(entries.find((row) => row.stage === 'FIX_AUTOMATION_DEFECT_IF_REQUIRED')?.status, 'NOT_APPLICABLE');
    assert.equal(entries.find((row) => row.stage === 'RETEST')?.status, 'DONE');
    assert.equal(entries.find((row) => row.stage === 'RECORD')?.status, 'DONE');
  });

  it('marks automation fix REQUIRED only for AUTOMATION owner', () => {
    assert.equal(ownerRequiresAutomationFix('AUTOMATION'), true);
    assert.equal(ownerRequiresAutomationFix('APPLICATION'), false);
    assert.equal(ownerRequiresAutomationFix('BROWSER'), false);
    const entries = buildLifecycle({
      ownerClassification: 'AUTOMATION',
      retestStatus: 'FAIL',
      executed: true,
      analysisPresent: true,
    });
    assert.equal(entries.find((row) => row.stage === 'FIX_AUTOMATION_DEFECT_IF_REQUIRED')?.status, 'REQUIRED');
  });
});
