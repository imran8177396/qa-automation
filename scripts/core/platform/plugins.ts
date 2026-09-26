import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { PATHS } from '../../lib/paths';
import type { TestEnginePlugin } from './plugin-sdk';

/**
 * Registry + safe path validation + tool adapters (see adapters.ts).
 * PARTIAL: built-in adapters (playwright, postman, jmeter, database, contract,
 * queue, ai) plus registerAdapter for future ids. Unavailable tools return
 * REQUIRES_CONFIGURATION or BLOCKED; execution is never faked (PASS only via a
 * real execute stub / runner result). Does not switch run-all to plugins.
 */
export const PLUGIN_ARCHITECTURE_STATUS = 'PARTIAL' as const;

/** @deprecated Prefer TestEnginePlugin from plugin-sdk.ts */
export type PluginEngine = TestEnginePlugin;

export type {
  AdapterAvailability,
  AdapterAvailabilityState,
  AdapterDefinition,
  AdapterId,
  AdapterResultStatus,
  AdapterRunRequest,
  AdapterRunResult,
  AdapterToolSnapshot,
  AssertionPlugin,
  BuiltinAdapterId,
  DiscoveryAdapter,
  ReporterPlugin,
  TestEnginePlugin,
} from './plugin-sdk';

export { BUILTIN_ADAPTER_IDS } from './plugin-sdk';

export {
  AdapterRegistry,
  createAdapterRegistry,
  getDefaultAdapterRegistry,
  isBuiltinAdapterId,
  listAdapters,
  registerAdapter,
  runAdapter,
} from './adapters';

export interface PluginConfigEntry {
  id: string;
  modulePath: string;
}

export type PluginLoadStatus = 'LOADED' | 'NOT_IMPLEMENTED' | 'REQUIRES_CONFIGURATION' | 'BLOCKED';

export interface PluginLoadResult {
  id: string;
  modulePath: string;
  status: PluginLoadStatus;
  reason?: string;
}

export class PluginRegistry {
  private readonly engines = new Map<string, PluginEngine>();

  register(engine: PluginEngine): void {
    if (this.engines.has(engine.id)) {
      throw new Error(`Duplicate plugin engine id: ${engine.id}`);
    }
    this.engines.set(engine.id, engine);
  }

  get(id: string): PluginEngine | undefined {
    return this.engines.get(id);
  }

  ids(): string[] {
    return [...this.engines.keys()];
  }
}

const PLUGINS_DIR = path.join(PATHS.root, 'scripts', 'plugins');

/**
 * Reject absolute URLs, path traversal, and paths outside the repo / plugins dir.
 * Does not import remote code.
 */
export function assertSafePluginModulePath(modulePath: string): string {
  const trimmed = modulePath.trim();
  if (!trimmed) {
    throw new Error('Plugin modulePath is empty (REQUIRES_CONFIGURATION)');
  }
  if (/^https?:\/\//i.test(trimmed) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) {
    throw new Error(`Plugin modulePath rejects URL schemes: ${trimmed}`);
  }
  if (trimmed.includes('..')) {
    throw new Error(`Plugin modulePath must not contain '..': ${trimmed}`);
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(`Plugin modulePath must be relative under scripts/plugins/: ${trimmed}`);
  }

  const normalized = trimmed.replace(/\\/g, '/');
  if (!normalized.startsWith('scripts/plugins/')) {
    throw new Error(
      `Plugin modulePath must be under scripts/plugins/: ${trimmed} (REQUIRES_CONFIGURATION)`
    );
  }

  const absolute = path.resolve(PATHS.root, normalized);
  const relToPlugins = path.relative(PLUGINS_DIR, absolute);
  if (relToPlugins.startsWith('..') || path.isAbsolute(relToPlugins)) {
    throw new Error(`Plugin modulePath resolves outside scripts/plugins/: ${trimmed}`);
  }
  const relToRoot = path.relative(PATHS.root, absolute);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error(`Plugin modulePath resolves outside repo root: ${trimmed}`);
  }

  return absolute;
}

/**
 * Default `[]` loads nothing. Missing files → NOT_IMPLEMENTED / REQUIRES_CONFIGURATION.
 * Does not create sample plugins. Built-in engines stay on existing runners.
 */
export async function loadConfiguredPlugins(
  entries: readonly PluginConfigEntry[] = [],
  registry: PluginRegistry = new PluginRegistry()
): Promise<{ registry: PluginRegistry; results: PluginLoadResult[] }> {
  const results: PluginLoadResult[] = [];

  for (const entry of entries) {
    let absolute: string;
    try {
      absolute = assertSafePluginModulePath(entry.modulePath);
    } catch (error) {
      results.push({
        id: entry.id,
        modulePath: entry.modulePath,
        status: 'REQUIRES_CONFIGURATION',
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!fs.existsSync(absolute)) {
      results.push({
        id: entry.id,
        modulePath: entry.modulePath,
        status: 'NOT_IMPLEMENTED',
        reason: `plugin module not found: ${entry.modulePath}`,
      });
      continue;
    }

    try {
      const mod = (await import(pathToFileURL(absolute).href)) as {
        default?: PluginEngine;
        engine?: PluginEngine;
      };
      const engine = mod.default ?? mod.engine;
      if (!engine || typeof engine.id !== 'string' || typeof engine.run !== 'function') {
        results.push({
          id: entry.id,
          modulePath: entry.modulePath,
          status: 'REQUIRES_CONFIGURATION',
          reason: 'plugin module must export default or engine with { id, run }',
        });
        continue;
      }
      if (engine.id !== entry.id) {
        results.push({
          id: entry.id,
          modulePath: entry.modulePath,
          status: 'REQUIRES_CONFIGURATION',
          reason: `plugin id mismatch: config ${entry.id} vs module ${engine.id}`,
        });
        continue;
      }
      registry.register(engine);
      results.push({
        id: entry.id,
        modulePath: entry.modulePath,
        status: 'LOADED',
      });
    } catch (error) {
      results.push({
        id: entry.id,
        modulePath: entry.modulePath,
        status: 'BLOCKED',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { registry, results };
}
