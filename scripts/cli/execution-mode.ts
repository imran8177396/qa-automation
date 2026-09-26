/**
 * Execution-mode resolution for `npm run qa -- --mode=...`.
 * Pure planning — unit tests call resolveExecutionMode only (no child processes).
 * Does not replace qa:all / run-all.ts stage list.
 */
import fs from 'fs';
import path from 'path';
import {
  analyzeChangeImpact,
  selectByPriority,
  type ChangeImpactMapping,
  type PrioritizedTest,
} from '../core/platform/risk';
import {
  getTestType,
  listTestTypesByCategory,
} from '../core/test-types/registry';
import {
  TEST_TYPE_CATEGORIES,
  type TestTypeCategory,
} from '../core/test-types/categories';
import { PATHS } from '../lib/paths';

/** Statuses aligned with engine contract — never remap gated outcomes to PASS. */
export type ExecutionModeStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_TESTED'
  | 'SKIPPED'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_APPLICABLE'
  | 'NOT_IMPLEMENTED'
  | 'PARTIAL';

export const EXECUTION_MODES = [
  'smoke',
  'regression',
  'full',
  'changed',
  'critical',
  'scheduled',
  'single',
  'type',
  'category',
] as const;

export type ExecutionModeName = (typeof EXECUTION_MODES)[number];

export interface PlannedNpmScript {
  npmScript: string;
  /** Whether this item is eligible to spawn (CLI skips BLOCKED / NOT_TESTED). */
  status: ExecutionModeStatus;
  reason?: string;
}

export interface ExecutionModePlan {
  mode: ExecutionModeName | null;
  npmScripts: string[];
  /** Per-script plan rows (scheduled / category / critical detail). */
  items: PlannedNpmScript[];
  /** Extra argv segments per script after `npm run <script>` (e.g. `-- --grep=...`). */
  scriptArgs: Record<string, string[]>;
  spawn: boolean;
  status: ExecutionModeStatus;
  reason: string;
  notes: string[];
}

export interface ResolveExecutionModeOptions {
  /** Injected package.json scripts map — defaults to reading package.json. */
  packageScripts?: Record<string, string>;
  /** Injected change-impact mappings — defaults to qa.config.json changeImpact.mappings. */
  changeImpactMappings?: ChangeImpactMapping[];
  /** Optional prioritized catalog for --mode=critical (selectByPriority only). */
  criticalCatalog?: PrioritizedTest[];
  /** Injected gitDiff text (from --diff-file content) without spawning git. */
  gitDiff?: string;
  /** Injected enabled flags for scheduled engines (defaults from qa.config when needed). */
  engineEnabled?: {
    ai?: boolean;
    dependencies?: boolean;
    security?: boolean;
    crossBrowser?: boolean;
  };
}

const PR_CRITICAL_SCRIPTS = [
  'test:unit',
  'test:smoke',
  'test:api',
  'test:e2e',
  'test:accessibility',
  'test:security',
] as const;

const SCHEDULED_SCRIPTS = [
  'test:dependencies',
  'test:e2e:cross-browser',
  'test:ai',
  'test:security',
] as const;

const SINGLE_SUITE_SCRIPTS: Record<string, string> = {
  unit: 'test:unit',
  e2e: 'test:e2e',
  api: 'test:api',
};

export function executionModeUsage(): string {
  return [
    'Usage: npm run qa -- --mode=<mode> [options]',
    '',
    'Modes:',
    '  smoke       → npm run test:smoke',
    '  regression  → npm run test:regression',
    '  full        → npm run qa:all (explicit opt-in; 23-stage pipeline)',
    '  critical    → PR critical slice (unit, smoke, api, e2e, accessibility, security)',
    '  scheduled   → scheduled tier plan (dependencies, cross-browser, ai, security)',
    '  changed     → change-impact plan (--files=a,b and/or --diff-file=<path>)',
    '  single      → one test (--test=<id> and --suite=unit|e2e|api)',
    '  type        → one registry type (--type=<TestTypeId>)',
    '  category    → registry category plan only (--category=<category>)',
    '',
    'Flags:',
    '  --plan              Print the resolution plan; do not spawn',
    '  --mode=<mode>       Required for mode dispatch (equals form required)',
    '',
    'Legacy (unchanged): npm run qa -- --step=sync|api|e2e|load',
    '',
    'Default with no --mode and no --step: REQUIRES_CONFIGURATION (does not run qa:all).',
  ].join('\n');
}

function loadPackageScripts(): Record<string, string> {
  const raw = fs.readFileSync(path.join(PATHS.root, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

function loadChangeImpactMappings(): ChangeImpactMapping[] {
  try {
    const raw = fs.readFileSync(PATHS.config, 'utf8');
    const cfg = JSON.parse(raw) as {
      changeImpact?: { mappings?: ChangeImpactMapping[] };
    };
    return cfg.changeImpact?.mappings ?? [];
  } catch {
    return [];
  }
}

function loadEngineEnabled(): NonNullable<ResolveExecutionModeOptions['engineEnabled']> {
  try {
    const raw = fs.readFileSync(PATHS.config, 'utf8');
    const cfg = JSON.parse(raw) as {
      dependencies?: { enabled?: boolean };
      security?: { enabled?: boolean };
      tests?: { ai?: { enabled?: boolean } };
      playwright?: { enabled?: boolean };
    };
    return {
      dependencies: cfg.dependencies?.enabled !== false,
      security: cfg.security?.enabled !== false,
      ai: cfg.tests?.ai?.enabled === true,
      crossBrowser: cfg.playwright?.enabled !== false,
    };
  } catch {
    return {
      dependencies: true,
      security: true,
      ai: false,
      crossBrowser: true,
    };
  }
}

/** Parse `--name=value` or `--name value`. Equals form is always accepted. */
export function parseArgValue(argv: string[], name: string): string | undefined {
  const cleaned = argv.filter((arg) => arg !== '--');
  const eqPrefix = `--${name}=`;
  const eq = cleaned.find((arg) => arg.startsWith(eqPrefix));
  if (eq) return eq.slice(eqPrefix.length);
  const idx = cleaned.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0) {
    const next = cleaned[idx + 1];
    if (next && !next.startsWith('--')) return next;
  }
  return undefined;
}

export function hasArgFlag(argv: string[], name: string): boolean {
  const cleaned = argv.filter((arg) => arg !== '--');
  return cleaned.includes(`--${name}`) || cleaned.some((arg) => arg.startsWith(`--${name}=`));
}

function pickExisting(
  candidates: readonly string[],
  scripts: Record<string, string>
): string[] {
  return candidates.filter((name) => Object.prototype.hasOwnProperty.call(scripts, name));
}

function planOk(
  mode: ExecutionModeName,
  npmScripts: string[],
  opts: {
    spawn: boolean;
    status?: ExecutionModeStatus;
    reason?: string;
    notes?: string[];
    items?: PlannedNpmScript[];
    scriptArgs?: Record<string, string[]>;
  }
): ExecutionModePlan {
  const items =
    opts.items ??
    npmScripts.map((npmScript) => ({
      npmScript,
      status: 'PARTIAL' as ExecutionModeStatus,
      reason: 'planned for execution',
    }));
  return {
    mode,
    npmScripts,
    items,
    scriptArgs: opts.scriptArgs ?? {},
    spawn: opts.spawn,
    status: opts.status ?? 'PARTIAL',
    reason: opts.reason ?? `mode ${mode} resolved`,
    notes: opts.notes ?? [],
  };
}

function resolveSmoke(
  scripts: Record<string, string>,
  planOnly: boolean
): ExecutionModePlan {
  const npmScripts = pickExisting(['test:smoke'], scripts);
  if (npmScripts.length === 0) {
    return planOk('smoke', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: 'package.json is missing test:smoke',
    });
  }
  return planOk('smoke', npmScripts, {
    spawn: !planOnly,
    status: 'PARTIAL',
    reason: 'smoke mode → test:smoke',
    notes: planOnly ? ['plan only; tests not executed'] : [],
  });
}

function resolveRegression(
  scripts: Record<string, string>,
  planOnly: boolean
): ExecutionModePlan {
  const npmScripts = pickExisting(['test:regression'], scripts);
  if (npmScripts.length === 0) {
    return planOk('regression', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: 'package.json is missing test:regression',
    });
  }
  return planOk('regression', npmScripts, {
    spawn: !planOnly,
    status: 'PARTIAL',
    reason: 'regression mode → test:regression',
    notes: planOnly ? ['plan only; tests not executed'] : [],
  });
}

function resolveFull(
  scripts: Record<string, string>,
  planOnly: boolean
): ExecutionModePlan {
  const npmScripts = pickExisting(['qa:all'], scripts);
  if (npmScripts.length === 0) {
    return planOk('full', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: 'package.json is missing qa:all',
    });
  }
  return planOk('full', npmScripts, {
    spawn: !planOnly,
    status: 'PARTIAL',
    reason: 'full mode → qa:all (explicit opt-in; 23-stage pipeline via scripts/run-all.ts)',
    notes: [
      'full is explicit opt-in — not the default for npm run qa',
      ...(planOnly ? ['plan only; tests not executed'] : []),
    ],
  });
}

function resolveCritical(
  scripts: Record<string, string>,
  planOnly: boolean,
  catalog?: PrioritizedTest[]
): ExecutionModePlan {
  const notes: string[] = [
    'critical slice (PR tier), not a quality score',
    'does not run the whole suite; config risk.profile=full is not used to execute everything',
  ];

  if (catalog && catalog.length > 0) {
    const selection = selectByPriority(catalog, 'critical');
    notes.push(
      `catalog critical selection: ${selection.selected.map((t) => t.testId).join(', ') || '(none)'}`
    );
    notes.push(
      `catalog skipped (NOT_TESTED by profile): ${selection.skipped.map((t) => t.testId).join(', ') || '(none)'}`
    );
  }

  const npmScripts = pickExisting(PR_CRITICAL_SCRIPTS, scripts);
  const items: PlannedNpmScript[] = npmScripts.map((npmScript) => ({
    npmScript,
    status: 'PARTIAL',
    reason: 'PR critical slice script',
  }));

  return planOk('critical', npmScripts, {
    spawn: !planOnly && npmScripts.length > 0,
    status: 'PARTIAL',
    reason: 'critical mode → existing PR critical slice scripts only',
    notes: [...notes, ...(planOnly ? ['plan only; tests not executed'] : [])],
    items,
  });
}

function resolveScheduled(
  scripts: Record<string, string>,
  planOnly: boolean,
  engineEnabled: NonNullable<ResolveExecutionModeOptions['engineEnabled']>
): ExecutionModePlan {
  const notes: string[] = [
    'scheduled tier plan — heavy/authorize-heavy is not included',
    'CLI must not mark the mode PASS when items are NOT_TESTED or BLOCKED',
  ];

  const items: PlannedNpmScript[] = [];
  for (const npmScript of SCHEDULED_SCRIPTS) {
    if (!Object.prototype.hasOwnProperty.call(scripts, npmScript)) {
      continue;
    }
    if (npmScript === 'test:ai') {
      const aiType = getTestType('ai');
      if (aiType?.status === 'NOT_IMPLEMENTED' || engineEnabled.ai !== true) {
        items.push({
          npmScript,
          status: 'NOT_TESTED',
          reason:
            engineEnabled.ai !== true
              ? 'tests.ai.enabled is false — AI engine stays off'
              : 'registry status NOT_IMPLEMENTED',
        });
        continue;
      }
    }
    if (npmScript === 'test:e2e:cross-browser') {
      const compat = getTestType('compatibility');
      if (compat?.status === 'NOT_IMPLEMENTED') {
        items.push({
          npmScript,
          status: 'NOT_TESTED',
          reason: 'compatibility / cross-browser is NOT_IMPLEMENTED',
        });
        continue;
      }
      items.push({
        npmScript,
        status: 'PARTIAL',
        reason:
          'scheduled cross-browser selection (desktop Chromium/Firefox/WebKit); plan lists it — unit tests do not spawn',
      });
      continue;
    }
    if (npmScript === 'test:dependencies' && engineEnabled.dependencies === false) {
      items.push({
        npmScript,
        status: 'NOT_TESTED',
        reason: 'dependencies.enabled is false',
      });
      continue;
    }
    if (npmScript === 'test:security' && engineEnabled.security === false) {
      items.push({
        npmScript,
        status: 'NOT_TESTED',
        reason: 'security.enabled is false',
      });
      continue;
    }
    items.push({
      npmScript,
      status: 'PARTIAL',
      reason: 'scheduled tier script',
    });
  }

  const npmScripts = items.map((row) => row.npmScript);
  const spawnable = items.filter(
    (row) => row.status !== 'BLOCKED' && row.status !== 'NOT_TESTED' && row.status !== 'NOT_IMPLEMENTED'
  );
  const blockedOrUntested = items.filter(
    (row) =>
      row.status === 'BLOCKED' ||
      row.status === 'NOT_TESTED' ||
      row.status === 'NOT_IMPLEMENTED'
  );

  if (blockedOrUntested.length > 0) {
    notes.push(
      `not spawnable: ${blockedOrUntested.map((r) => `${r.npmScript}=${r.status}`).join(', ')}`
    );
  }

  const overallStatus: ExecutionModeStatus =
    spawnable.length === 0 && items.length > 0
      ? 'NOT_TESTED'
      : blockedOrUntested.length > 0
        ? 'PARTIAL'
        : 'PARTIAL';

  return planOk('scheduled', npmScripts, {
    spawn: !planOnly && spawnable.length > 0,
    status: overallStatus,
    reason: 'scheduled mode → existing scheduled-tier scripts only',
    notes: [...notes, ...(planOnly ? ['plan only; tests not executed'] : [])],
    items,
  });
}

function resolveChanged(
  argv: string[],
  scripts: Record<string, string>,
  planOnly: boolean,
  options: ResolveExecutionModeOptions
): ExecutionModePlan {
  const filesArg = parseArgValue(argv, 'files');
  const changedFiles = filesArg
    ? filesArg
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : undefined;

  const gitDiff = options.gitDiff;
  const mapping = options.changeImpactMappings ?? loadChangeImpactMappings();

  const impact = analyzeChangeImpact({
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    ...(gitDiff !== undefined ? { gitDiff } : {}),
    mapping,
  });

  const notes: string[] = [
    impact.reason,
    `change-impact status=${impact.status} fallback=${impact.fallback}`,
  ];

  if (impact.status === 'NOT_IMPLEMENTED') {
    return planOk('changed', [], {
      spawn: false,
      status: 'NOT_IMPLEMENTED',
      reason: impact.reason,
      notes: [
        ...notes,
        'no --files / --diff-file (or empty input) — not running the full suite',
        ...(planOnly ? ['plan only; tests not executed'] : []),
      ],
      items: [],
    });
  }

  if (impact.fallback === 'full-regression') {
    const npmScripts = pickExisting(['test:regression'], scripts);
    notes.push(
      'mappings were unmapped or incomplete; existing fallback is test:regression — not a precise impact set'
    );
    if (impact.unmappedFiles.length > 0) {
      notes.push(`unmapped files: ${impact.unmappedFiles.join(', ')}`);
    }
    return planOk('changed', npmScripts, {
      spawn: false,
      status: 'PARTIAL',
      reason: 'changed mode fallback to full-regression mapping (plan only; precise impact unavailable)',
      notes: [...notes, 'plan only; tests not executed'],
      items: npmScripts.map((npmScript) => ({
        npmScript,
        status: 'PARTIAL' as ExecutionModeStatus,
        reason: 'full-regression fallback — mapping unmapped',
      })),
    });
  }

  notes.push(
    `affectedTests=${impact.affectedTests.length ? impact.affectedTests.join(', ') : '(none)'}`
  );
  return planOk('changed', [], {
    spawn: false,
    status: 'PARTIAL',
    reason: 'changed mode mapped affected tests; no automated npm script mapping for individual test ids',
    notes: [...notes, 'plan only; tests not executed'],
    items: [],
  });
}

function resolveSingle(argv: string[], planOnly: boolean): ExecutionModePlan {
  const testId = parseArgValue(argv, 'test');
  if (!testId) {
    return planOk('single', [], {
      spawn: false,
      status: 'REQUIRES_CONFIGURATION',
      reason: 'single mode requires --test=<id>',
      notes: planOnly ? ['plan only; tests not executed'] : [],
    });
  }

  const suite = parseArgValue(argv, 'suite');
  if (!suite || !SINGLE_SUITE_SCRIPTS[suite]) {
    return planOk('single', [], {
      spawn: false,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'single-test requires --suite=unit|e2e|api; there is no safe single-test flag that works for all suites',
      notes: [
        `test id requested: ${testId}`,
        ...(planOnly ? ['plan only; tests not executed'] : []),
      ],
    });
  }

  const npmScript = SINGLE_SUITE_SCRIPTS[suite];
  // Suite wrappers do not safely forward Playwright --grep / node:test --test-name-pattern.
  return planOk('single', [npmScript], {
    spawn: false,
    status: 'REQUIRES_CONFIGURATION',
    reason:
      `suite ${suite} npm script ${npmScript} does not safely forward a single-test filter ` +
      `(Playwright --grep / node:test --test-name-pattern); not spawning`,
    notes: [
      `test id: ${testId}`,
      `suite: ${suite}`,
      'plan only; tests not executed',
    ],
    items: [
      {
        npmScript,
        status: 'REQUIRES_CONFIGURATION',
        reason: 'single-test filter not wired through suite npm script',
      },
    ],
  });
}

function resolveType(
  argv: string[],
  scripts: Record<string, string>,
  planOnly: boolean
): ExecutionModePlan {
  const typeId = parseArgValue(argv, 'type');
  if (!typeId) {
    return planOk('type', [], {
      spawn: false,
      status: 'REQUIRES_CONFIGURATION',
      reason: 'type mode requires --type=<TestTypeId>',
    });
  }

  const row = getTestType(typeId);
  if (!row) {
    return planOk('type', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: `unknown test type ${JSON.stringify(typeId)}`,
    });
  }

  if (row.status === 'NOT_IMPLEMENTED' || !row.npmScript) {
    return planOk('type', row.npmScript ? [row.npmScript] : [], {
      spawn: false,
      status: 'NOT_TESTED',
      reason: `test type ${typeId} is ${row.status}${row.npmScript ? '' : ' (no npmScript)'}`,
      notes: [row.note ?? 'registry row only', ...(planOnly ? ['plan only; tests not executed'] : [])],
      items: row.npmScript
        ? [{ npmScript: row.npmScript, status: 'NOT_TESTED', reason: row.status }]
        : [],
    });
  }

  if (!Object.prototype.hasOwnProperty.call(scripts, row.npmScript)) {
    return planOk('type', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: `registry npmScript ${row.npmScript} is missing from package.json`,
    });
  }

  const spawnable = row.status === 'IMPLEMENTED';
  return planOk('type', [row.npmScript], {
    spawn: !planOnly && spawnable,
    status: spawnable ? 'PARTIAL' : 'NOT_TESTED',
    reason: `type ${typeId} → ${row.npmScript} (${row.status})`,
    notes: [
      ...(row.note ? [row.note] : []),
      ...(planOnly || !spawnable ? ['plan only; tests not executed'] : []),
    ],
    items: [
      {
        npmScript: row.npmScript,
        status: spawnable ? 'PARTIAL' : 'NOT_TESTED',
        reason: row.status,
      },
    ],
  });
}

function resolveCategory(argv: string[], scripts: Record<string, string>): ExecutionModePlan {
  const category = parseArgValue(argv, 'category');
  if (!category) {
    return planOk('category', [], {
      spawn: false,
      status: 'REQUIRES_CONFIGURATION',
      reason: 'category mode requires --category=<category>',
    });
  }

  if (!(TEST_TYPE_CATEGORIES as readonly string[]).includes(category)) {
    return planOk('category', [], {
      spawn: false,
      status: 'BLOCKED',
      reason: `unknown category ${JSON.stringify(category)}; allowed: ${TEST_TYPE_CATEGORIES.join(', ')}`,
    });
  }

  const rows = listTestTypesByCategory(category as TestTypeCategory);
  const items: PlannedNpmScript[] = [];
  const notes: string[] = [
    `category ${category}: ${rows.length} registry row(s)`,
    'category mode is plan only; tests not executed',
  ];

  for (const row of rows) {
    if (!row.npmScript) {
      items.push({
        npmScript: `(${row.id})`,
        status: row.status === 'NOT_IMPLEMENTED' ? 'NOT_TESTED' : 'BLOCKED',
        reason: `${row.id}: no npmScript (${row.status})`,
      });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(scripts, row.npmScript)) {
      items.push({
        npmScript: row.npmScript,
        status: 'BLOCKED',
        reason: `${row.id}: npmScript missing from package.json`,
      });
      continue;
    }
    if (row.status === 'IMPLEMENTED') {
      items.push({
        npmScript: row.npmScript,
        status: 'PARTIAL',
        reason: `${row.id}: IMPLEMENTED (listed only; category mode does not spawn)`,
      });
    } else {
      items.push({
        npmScript: row.npmScript,
        status: row.status === 'NOT_IMPLEMENTED' ? 'NOT_TESTED' : 'NOT_TESTED',
        reason: `${row.id}: ${row.status} — not spawned`,
      });
    }
  }

  const npmScripts = [
    ...new Set(
      items
        .filter((row) => !row.npmScript.startsWith('('))
        .map((row) => row.npmScript)
    ),
  ];

  return planOk('category', npmScripts, {
    spawn: false,
    status: 'PARTIAL',
    reason: `category ${category} plan produced (plan only; tests not executed)`,
    notes,
    items,
  });
}

/**
 * Pure mode resolver. Unit tests must call this (or pass spawn:false via --plan) — never spawn.
 */
export function resolveExecutionMode(
  argv: string[] = [],
  options: ResolveExecutionModeOptions = {}
): ExecutionModePlan {
  const cleaned = argv.filter((arg) => arg !== '--');
  const planOnly = hasArgFlag(cleaned, 'plan');
  const modeRaw = parseArgValue(cleaned, 'mode');
  const scripts = options.packageScripts ?? loadPackageScripts();

  if (modeRaw === undefined || modeRaw === '') {
    return {
      mode: null,
      npmScripts: [],
      items: [],
      scriptArgs: {},
      spawn: false,
      status: 'REQUIRES_CONFIGURATION',
      reason: 'missing required --mode; refusing to run the full suite by default',
      notes: [executionModeUsage()],
    };
  }

  const mode = modeRaw.trim() as ExecutionModeName;
  if (!(EXECUTION_MODES as readonly string[]).includes(mode)) {
    return {
      mode: null,
      npmScripts: [],
      items: [],
      scriptArgs: {},
      spawn: false,
      status: 'BLOCKED',
      reason: `unknown mode ${JSON.stringify(modeRaw)}`,
      notes: [`allowed modes: ${EXECUTION_MODES.join(', ')}`],
    };
  }

  // --plan must never set spawn true
  const forcePlan = planOnly;

  switch (mode) {
    case 'smoke':
      return resolveSmoke(scripts, forcePlan);
    case 'regression':
      return resolveRegression(scripts, forcePlan);
    case 'full':
      return resolveFull(scripts, forcePlan);
    case 'critical':
      return resolveCritical(scripts, forcePlan, options.criticalCatalog);
    case 'scheduled':
      return resolveScheduled(
        scripts,
        forcePlan,
        options.engineEnabled ?? loadEngineEnabled()
      );
    case 'changed':
      return resolveChanged(cleaned, scripts, forcePlan, options);
    case 'single':
      return resolveSingle(cleaned, forcePlan);
    case 'type':
      return resolveType(cleaned, scripts, forcePlan);
    case 'category':
      return resolveCategory(cleaned, scripts);
    default: {
      const _exhaustive: never = mode;
      return {
        mode: null,
        npmScripts: [],
        items: [],
        scriptArgs: {},
        spawn: false,
        status: 'BLOCKED',
        reason: `unhandled mode ${String(_exhaustive)}`,
        notes: [],
      };
    }
  }
}

/** Scripts the CLI will actually spawn (excludes BLOCKED / NOT_TESTED / NOT_IMPLEMENTED). */
export function spawnableScripts(plan: ExecutionModePlan): PlannedNpmScript[] {
  if (!plan.spawn) return [];
  return plan.items.filter(
    (row) =>
      row.status !== 'BLOCKED' &&
      row.status !== 'NOT_TESTED' &&
      row.status !== 'NOT_IMPLEMENTED' &&
      row.status !== 'REQUIRES_CONFIGURATION' &&
      !row.npmScript.startsWith('(')
  );
}
