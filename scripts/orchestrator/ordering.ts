import fs from 'fs';
import { PATHS } from '../lib/paths';
import { isExecutionStageKey } from '../lib/stage-timeline';
import type { StageResult } from './types';

export function isExecutionStage(key: string): boolean {
  return isExecutionStageKey(key);
}

export function inventoryArtifactExists(): boolean {
  return fs.existsSync(PATHS.inventoryFile);
}

/**
 * Execution stages must wait until discovery ran in this pipeline and
 * reports/discovery/inventory.json is on disk.
 */
export function executionGate(results: StageResult[]): { ok: boolean; reason: string } {
  const discovery = results.find((row) => row.key === 'discovery');
  if (!discovery || discovery.status === 'NOT_EXECUTED') {
    return { ok: false, reason: 'Discovery has not completed in this run — execution stages are blocked' };
  }
  if (!inventoryArtifactExists()) {
    return {
      ok: false,
      reason: 'reports/discovery/inventory.json is missing — discovery/inventory must write it before execution',
    };
  }
  return { ok: true, reason: '' };
}
