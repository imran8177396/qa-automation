/**
 * Cross-screen workflow plans for the existing planner.
 * Consumed only by buildScenarioInventory — not a second engine.
 * Builds ordered chains from discovered navigation edges only.
 * Never invents business flows (login→delete, etc.). Never submits, deletes, or clicks.
 * Never marks an unobserved path PASS.
 */

import { canonicalScreenUrl } from '../discovery/screens';
import type { NavigationEntry, PageMapEntry } from '../discovery/page-map';
import type { UiElementRecord } from '../discovery/ui-scan';
import {
  FORM_SUBMIT_NOT_AUTHORIZED_REASON,
} from './button-cases';
import type {
  CheckKind,
  CheckStatus,
  PlannedAction,
  PlannedCheck,
} from './types';

/** Max navigation edges in one chain (cycle-safe walk). */
export const MAX_WORKFLOW_STEPS = 8;

/**
 * Stop after this many simple paths. A site nav where every page links to
 * every other page would otherwise enumerate millions of paths and run out of memory.
 */
export const MAX_SIMPLE_PATHS = 64;

const RECOVERY_NAME = /cancel|back/i;
const DELETE_KIND = /delete/i;
const DELETE_BLOCKED_REASON =
  'BLOCKED: destructive or state-changing button test is not authorized';

export type WorkflowSubcaseId =
  | 'workflow-none'
  | 'workflow-happy'
  | 'workflow-alternative'
  | 'workflow-negative'
  | 'workflow-interrupted'
  | 'workflow-recovery';

export interface WorkflowEdge {
  from: string;
  to: string;
  /** Stable id for referencing one-step edge rows from a multi-step happy path. */
  edgeId: string;
  inScope: boolean;
}

export interface WorkflowChain {
  workflowId: string;
  /** Ordered page URLs in the happy-path chain (discovered only). */
  urls: string[];
  edgeIds: string[];
  /** Alternate URL sequence to the same final URL when discovered; otherwise null. */
  alternativeUrls: string[] | null;
}

export interface WorkflowSubcasePlan {
  subcaseId: WorkflowSubcaseId;
  workflowId: string;
  kind: CheckKind;
  title: string;
  targetUrl: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
}

export interface WorkflowCaseResult {
  workflowId: string;
  chain: WorkflowChain | null;
  plans: WorkflowSubcasePlan[];
}

export interface BuildWorkflowCasesInput {
  navigation: NavigationEntry[];
  pages: PageMapEntry[];
  elements?: UiElementRecord[];
  seedUrl: string;
}

function formatWorkflowId(index: number): string {
  return `WF-${String(index).padStart(3, '0')}`;
}

function joinedPathKey(urls: string[]): string {
  return urls.map((u) => {
    try {
      const parsed = new URL(u);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch {
      return canonicalScreenUrl(u);
    }
  }).join('→');
}

function displayUrlList(urls: string[]): string {
  return urls.join(' → ');
}

export function stableEdgeId(from: string, to: string): string {
  return `EDGE:${canonicalScreenUrl(from)}→${canonicalScreenUrl(to)}`;
}

/**
 * Normalize in-scope navigation into unique edges (discovered crawl graph only).
 */
export function collectWorkflowEdges(navigation: NavigationEntry[]): WorkflowEdge[] {
  const byKey = new Map<string, WorkflowEdge>();
  for (const nav of navigation) {
    if (!nav.inScope) continue;
    if (!nav.from || !nav.to) continue;
    const edgeId = stableEdgeId(nav.from, nav.to);
    if (byKey.has(edgeId)) continue;
    byKey.set(edgeId, {
      from: nav.from,
      to: nav.to,
      edgeId,
      inScope: true,
    });
  }
  return [...byKey.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
}

function buildAdjacency(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const adj = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const fromKey = canonicalScreenUrl(edge.from);
    const bucket = adj.get(fromKey) ?? [];
    bucket.push(edge);
    adj.set(fromKey, bucket);
  }
  for (const bucket of adj.values()) {
    bucket.sort((a, b) => canonicalScreenUrl(a.to).localeCompare(canonicalScreenUrl(b.to)));
  }
  return adj;
}

function incomingKeys(edges: WorkflowEdge[]): Set<string> {
  const set = new Set<string>();
  for (const edge of edges) {
    set.add(canonicalScreenUrl(edge.to));
  }
  return set;
}

interface SimplePath {
  urls: string[];
  edgeIds: string[];
}

/**
 * Walk edges into simple paths (no URL revisited). Cap at MAX_WORKFLOW_STEPS edges.
 * Returns maximal paths only (not proper contiguous subpaths of a longer path).
 */
export function buildSimplePaths(edges: WorkflowEdge[]): SimplePath[] {
  if (edges.length === 0) return [];

  const adj = buildAdjacency(edges);
  const incoming = incomingKeys(edges);
  const allFrom = [...adj.keys()].sort((a, b) => a.localeCompare(b));
  const sources = allFrom.filter((k) => !incoming.has(k));
  const starts = sources.length > 0 ? sources : allFrom;

  const urlByKey = new Map<string, string>();
  for (const edge of edges) {
    urlByKey.set(canonicalScreenUrl(edge.from), edge.from);
    urlByKey.set(canonicalScreenUrl(edge.to), edge.to);
  }

  const collected: SimplePath[] = [];

  function dfs(urlKey: string, pathUrls: string[], pathEdges: string[], visited: Set<string>): void {
    if (collected.length >= MAX_SIMPLE_PATHS) return;
    const outs = adj.get(urlKey) ?? [];
    let extended = false;
    for (const edge of outs) {
      if (collected.length >= MAX_SIMPLE_PATHS) return;
      if (pathEdges.length >= MAX_WORKFLOW_STEPS) break;
      const toKey = canonicalScreenUrl(edge.to);
      if (visited.has(toKey)) continue; // cycle: stop this branch, do not loop
      extended = true;
      const nextUrl = urlByKey.get(toKey) ?? edge.to;
      dfs(toKey, [...pathUrls, nextUrl], [...pathEdges, edge.edgeId], new Set(visited).add(toKey));
    }
    // Maximal: record when we cannot extend further (and have at least one edge)
    if (!extended && pathEdges.length > 0 && collected.length < MAX_SIMPLE_PATHS) {
      collected.push({ urls: pathUrls, edgeIds: pathEdges });
    }
  }

  for (const startKey of starts) {
    const startUrl = urlByKey.get(startKey) ?? startKey;
    dfs(startKey, [startUrl], [], new Set([startKey]));
  }

  // Drop paths that are proper contiguous subpaths of a longer collected path
  return collected.filter((path) => {
    const key = path.edgeIds.join('|');
    return !collected.some(
      (other) =>
        other.edgeIds.length > path.edgeIds.length &&
        other.edgeIds.join('|').includes(key) &&
        isContiguousSubpath(path.edgeIds, other.edgeIds)
    );
  });
}

function isContiguousSubpath(shortEdges: string[], longEdges: string[]): boolean {
  if (shortEdges.length >= longEdges.length) return false;
  const needle = shortEdges.join('\0');
  const hay = longEdges.join('\0');
  return hay.includes(needle);
}

/**
 * Multi-step chains only (≥2 edges). Single-edge paths stay as existing one-step workflow rows.
 * Groups paths that share a final URL: longest (then lexicographic) = happy; next = alternative.
 */
export function selectWorkflowChains(paths: SimplePath[]): WorkflowChain[] {
  const multi = paths.filter((p) => p.edgeIds.length >= 2);
  if (multi.length === 0) return [];

  const byEnd = new Map<string, SimplePath[]>();
  for (const path of multi) {
    const end = canonicalScreenUrl(path.urls[path.urls.length - 1]!);
    const bucket = byEnd.get(end) ?? [];
    bucket.push(path);
    byEnd.set(end, bucket);
  }

  const chains: Omit<WorkflowChain, 'workflowId'>[] = [];
  const used = new Set<string>();

  for (const end of [...byEnd.keys()].sort((a, b) => a.localeCompare(b))) {
    const group = byEnd.get(end)!;
    group.sort((a, b) => {
      if (b.edgeIds.length !== a.edgeIds.length) return b.edgeIds.length - a.edgeIds.length;
      return joinedPathKey(a.urls).localeCompare(joinedPathKey(b.urls));
    });

    const primary = group[0]!;
    const primaryKey = primary.edgeIds.join('|');
    if (used.has(primaryKey)) continue;
    used.add(primaryKey);

    let alternativeUrls: string[] | null = null;
    for (let i = 1; i < group.length; i++) {
      const alt = group[i]!;
      const altKey = alt.edgeIds.join('|');
      if (used.has(altKey)) continue;
      if (joinedPathKey(alt.urls) === joinedPathKey(primary.urls)) continue;
      alternativeUrls = alt.urls;
      used.add(altKey);
      break;
    }

    // Also consider single-edge paths to the same end as alternative (A→C vs A→B→C)
    const singleAlts = paths.filter(
      (p) =>
        p.edgeIds.length === 1 &&
        canonicalScreenUrl(p.urls[p.urls.length - 1]!) === end &&
        joinedPathKey(p.urls) !== joinedPathKey(primary.urls)
    );
    if (!alternativeUrls && singleAlts.length > 0) {
      singleAlts.sort((a, b) => joinedPathKey(a.urls).localeCompare(joinedPathKey(b.urls)));
      alternativeUrls = singleAlts[0]!.urls;
    }

    chains.push({
      urls: primary.urls,
      edgeIds: primary.edgeIds,
      alternativeUrls,
    });
  }

  // Remaining unused multi-step paths (different ends already handled) become their own workflows
  for (const path of multi) {
    const key = path.edgeIds.join('|');
    if (used.has(key)) continue;
    used.add(key);
    chains.push({
      urls: path.urls,
      edgeIds: path.edgeIds,
      alternativeUrls: null,
    });
  }

  chains.sort((a, b) => joinedPathKey(a.urls).localeCompare(joinedPathKey(b.urls)));

  return chains.map((chain, index) => ({
    ...chain,
    workflowId: formatWorkflowId(index + 1),
  }));
}

function findPageStatus(url: string, pages: PageMapEntry[]): number | null | undefined {
  const key = canonicalScreenUrl(url);
  for (const page of pages) {
    if (canonicalScreenUrl(page.url) === key) return page.status;
    if (page.finalUrl && canonicalScreenUrl(page.finalUrl) === key) return page.status;
  }
  return undefined;
}

/**
 * Same evidence rule as link-cases: FAIL when crawl recorded 404 / 410 / 5xx.
 * Does not fetch.
 */
export function negativeStatusFromPages(
  urls: string[],
  pages: PageMapEntry[]
): { status: CheckStatus; reason: string; httpStatus?: number } {
  for (const url of urls) {
    const recorded = findPageStatus(url, pages);
    if (recorded == null) continue;
    if (recorded === 404) {
      return {
        status: 'FAIL',
        reason: 'FAIL: broken link: HTTP 404 recorded during discovery',
        httpStatus: 404,
      };
    }
    if (recorded === 410) {
      return {
        status: 'FAIL',
        reason: 'FAIL: broken link: HTTP 410 recorded during discovery',
        httpStatus: 410,
      };
    }
    if (recorded >= 500 && recorded <= 599) {
      return {
        status: 'FAIL',
        reason: `FAIL: HTTP ${recorded} recorded during discovery`,
        httpStatus: recorded,
      };
    }
  }
  return {
    status: 'NOT_TESTED',
    reason: 'NOT_TESTED: no negative navigation outcome was recorded',
  };
}

function elementsOnUrl(url: string, elements: UiElementRecord[]): UiElementRecord[] {
  const key = canonicalScreenUrl(url);
  return elements.filter((el) => canonicalScreenUrl(el.page) === key);
}

function isSubmitControl(el: UiElementRecord): boolean {
  if (el.isSubmit) return true;
  if (el.elementKind === 'submit-button') return true;
  const type = (el.inputType ?? el.attributes?.type ?? '').toLowerCase();
  return type === 'submit';
}

function isDeleteControl(el: UiElementRecord): boolean {
  if (el.elementKind === 'delete-button') return true;
  const name = `${el.accessibleName ?? ''} ${el.label ?? ''}`;
  return DELETE_KIND.test(name) && (el.elementType === 'button' || el.elementKind === 'button');
}

/**
 * Notes for happy path when submit/delete controls exist on chain screens.
 * Those actions stay BLOCKED and are not part of the executed navigation observe path.
 */
export function blockedActionNotes(urls: string[], elements: UiElementRecord[]): string[] {
  const notes: string[] = [];
  for (const url of urls) {
    const onPage = elementsOnUrl(url, elements);
    if (onPage.some(isSubmitControl)) {
      notes.push(`submit on ${url}: ${FORM_SUBMIT_NOT_AUTHORIZED_REASON}`);
    }
    if (onPage.some(isDeleteControl)) {
      notes.push(`delete on ${url}: ${DELETE_BLOCKED_REASON}`);
    }
  }
  return notes;
}

function pathOfUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return canonicalScreenUrl(url);
  }
}

/**
 * Recovery: cancel/back accessible name, or a link whose path matches a previous chain step.
 * Observation only — never clicks.
 */
export function findRecoveryEvidence(
  urls: string[],
  elements: UiElementRecord[]
): { found: true; note: string } | { found: false } {
  const priorPaths = new Set(urls.slice(0, -1).map(pathOfUrl));

  for (const url of urls) {
    for (const el of elementsOnUrl(url, elements)) {
      const name = (el.accessibleName ?? el.label ?? '').trim();
      if (name && RECOVERY_NAME.test(name)) {
        return {
          found: true,
          note: 'recovery control or back-link was discovered',
        };
      }
      const href = (el.href ?? '').trim();
      if (!href) continue;
      if (el.elementType !== 'link' && el.elementType !== 'navigation' && el.elementKind !== 'link') {
        continue;
      }
      try {
        const absolute = new URL(href, url).href;
        if (priorPaths.has(pathOfUrl(absolute))) {
          return {
            found: true,
            note: 'recovery control or back-link was discovered',
          };
        }
      } catch {
        // ignore unresolvable href
      }
    }
  }
  return { found: false };
}

function plansForChain(
  chain: WorkflowChain,
  pages: PageMapEntry[],
  elements: UiElementRecord[]
): WorkflowSubcasePlan[] {
  const { workflowId, urls, edgeIds, alternativeUrls } = chain;
  const startUrl = urls[0]!;
  const list = displayUrlList(urls);
  const blocked = blockedActionNotes(urls, elements);
  const happyNoteParts = [
    `navigation observe: ${list}`,
    edgeIds.length > 0 ? `edges: ${edgeIds.join(', ')}` : '',
    ...blocked.map((n) => `${n} — not part of the executed path`),
  ].filter(Boolean);

  const plans: WorkflowSubcasePlan[] = [
    {
      subcaseId: 'workflow-happy',
      workflowId,
      kind: 'navigation',
      title: `${workflowId} happy path — ${list}`,
      targetUrl: startUrl,
      status: 'PLANNED',
      action: 'observe',
      expect: {
        note: happyNoteParts.join('; '),
        href: urls[urls.length - 1],
      },
    },
  ];

  if (alternativeUrls && alternativeUrls.length > 0) {
    const altList = displayUrlList(alternativeUrls);
    plans.push({
      subcaseId: 'workflow-alternative',
      workflowId,
      kind: 'navigation',
      title: `${workflowId} alternative path — ${altList}`,
      targetUrl: alternativeUrls[0]!,
      status: 'PLANNED',
      action: 'observe',
      expect: {
        note: `alternative navigation observe: ${altList}`,
        href: alternativeUrls[alternativeUrls.length - 1],
      },
    });
  } else {
    plans.push({
      subcaseId: 'workflow-alternative',
      workflowId,
      kind: 'navigation',
      title: `${workflowId} alternative path`,
      targetUrl: startUrl,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: no alternative navigation path was discovered',
    });
  }

  const negative = negativeStatusFromPages(urls, pages);
  plans.push({
    subcaseId: 'workflow-negative',
    workflowId,
    kind: negative.status === 'FAIL' ? 'broken-link' : 'navigation',
    title: `${workflowId} negative path — ${list}`,
    targetUrl: startUrl,
    status: negative.status,
    action: negative.status === 'FAIL' ? 'observe' : 'none',
    reason: negative.reason,
    expect:
      negative.httpStatus != null
        ? { note: `HTTP ${negative.httpStatus}`, href: urls[urls.length - 1] }
        : undefined,
  });

  plans.push({
    subcaseId: 'workflow-interrupted',
    workflowId,
    kind: 'navigation',
    title: `${workflowId} interrupted path`,
    targetUrl: startUrl,
    status: 'NOT_TESTED',
    action: 'none',
    reason: 'NOT_TESTED: interrupted path was not observed',
  });

  const recovery = findRecoveryEvidence(urls, elements);
  if (recovery.found) {
    plans.push({
      subcaseId: 'workflow-recovery',
      workflowId,
      kind: 'navigation',
      title: `${workflowId} recovery path — ${list}`,
      targetUrl: startUrl,
      status: 'PLANNED',
      action: 'observe',
      reason: undefined,
      expect: { note: recovery.note },
    });
  } else {
    plans.push({
      subcaseId: 'workflow-recovery',
      workflowId,
      kind: 'navigation',
      title: `${workflowId} recovery path`,
      targetUrl: startUrl,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: no recovery control was discovered',
    });
  }

  return plans;
}

/**
 * Build workflow path plans from discovered edges only.
 * Zero edges → one workflow-none row. Multi-step chains → five path rows each.
 * Single-edge graphs produce no WF-NNN happy paths (existing one-step rows cover them).
 */
export function buildWorkflowCases(input: BuildWorkflowCasesInput): WorkflowCaseResult[] {
  const { navigation, pages, seedUrl } = input;
  const elements = input.elements ?? [];
  const edges = collectWorkflowEdges(navigation);

  if (edges.length === 0) {
    return [
      {
        workflowId: 'workflow-none',
        chain: null,
        plans: [
          {
            subcaseId: 'workflow-none',
            workflowId: 'workflow-none',
            kind: 'navigation',
            title: `${seedUrl} workflow — no navigation edges`,
            targetUrl: seedUrl,
            status: 'NOT_TESTED',
            action: 'none',
            reason: 'NOT_TESTED: no navigation edges discovered',
          },
        ],
      },
    ];
  }

  const paths = buildSimplePaths(edges);
  const chains = selectWorkflowChains(paths);

  return chains.map((chain) => ({
    workflowId: chain.workflowId,
    chain,
    plans: plansForChain(chain, pages, elements),
  }));
}
