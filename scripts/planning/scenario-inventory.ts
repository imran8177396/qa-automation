import { authorize, classify, type SafetyConfigResolved } from '../core/safety-policy';
import type { PageMap, PageMapEntry } from '../discovery/page-map';
import { buildAuthenticatedCoverage, buildScreenInventory, canonicalScreenUrl, screenIdentityKey, type DiscoveredScreen } from '../discovery/screens';
import type { UiElementRecord, UiInventory } from '../discovery/ui-scan';
import {
  DECORATIVE_PLAN_REASON,
  AMBIGUOUS_LOCATOR_REASON,
  elementCategoryFromKind,
  isBlockedActionKind,
  purposeFromElementKind,
  type ElementKind,
} from '../discovery/element-kind';
import { PASSWORD_TOKEN_LOG_KEYS } from '../testing/capabilities/privacy';
import {
  applicableCategories,
  formatExcludedCategories,
  hasBoundaryConstraint,
  hasValidationConstraint,
  resolveKindForApplicability,
} from './applicability';
import { buildA11yPlansForScreen } from './a11y-cases';
import {
  buildButtonSubcases,
  isButtonKindForPlanning,
  FORM_SUBMIT_NOT_AUTHORIZED_REASON,
  type ButtonPlanningOptions,
} from './button-cases';
import { buildEdgeSubcases } from './edge-cases';
import { buildFieldSubcases } from './field-cases';
import { buildFormPlansForScreen, type FormPlanningOptions } from './form-cases';
import { buildLinkSubcases, isLinkKindForPlanning } from './link-cases';
import { buildLoginPlansForScreen, buildAccessGateCoverageNotes, type LoginPlanningOptions } from './login-cases';
import { buildNegativeSubcases } from './negative-cases';
import { buildPositiveSubcases, mergePositiveExclusions } from './positive-cases';
import {
  buildRolePermissionPlans,
  type RolePermissionRule,
  type RolePlanningOptions,
} from './role-cases';
import { buildApiUiChains, type ApiUiChainPlan } from './api-ui-chain';
import { buildWorkflowCases } from './workflow-cases';
import {
  buildStateTransitionPlans,
  type StateMachineSpec,
} from './state-transitions';
import {
  buildVisualPlansForScreen,
  type VisualEvidence,
} from './visual-cases';
import {
  buildSecurityPlansForScreen,
  collectExistingSubcaseIds,
  type SecurityPlanningOptions,
} from './security-cases';
import {
  buildDynamicCasesForScreen,
  type DynamicElementInput,
  type DynamicPaginationEvidence,
} from './dynamic-cases';
import { configuredRoleKeys } from '../discovery/authenticated-coverage';
import type {
  CheckKind,
  CheckStatus,
  ControlKind,
  ElementPurpose,
  InventoryCategory,
  PlannedAction,
  PlannedCheck,
  ScenarioKind,
} from './types';

/** Optional planning flags (button/form/login/role + session evidence). */
export type ScenarioInventoryOptions = ButtonPlanningOptions &
  FormPlanningOptions &
  LoginPlanningOptions &
  RolePlanningOptions & {
    /** Explicit role list — never invents Admin/User/Manager/Viewer. */
    roles?: string[] | null;
    /** Permission rules keyed to roles in `roles` / coverage session. */
    permissionRules?: RolePermissionRule[] | null;
    /**
     * Business/component state machines — never inferred from UI screen states
     * (default/loading/dialog). Omit on default discovery so no fake machine appears.
     */
    stateMachines?: StateMachineSpec[] | null;
    /**
     * Status-indicator / badge accessible names from the caller — not harvested from
     * ScreenStateToken. Omit unless the caller already has distinct labels.
     */
    observedStatusLabels?: string[] | null;
    /** When true, invalid pairs stay NOT_TESTED; still never executed. Default false. */
    executeInvalidTransitions?: boolean;
    /**
     * Optional visual baseline evidence per screen — never invents PNG paths or PASS.
     * Default discovery path passes none (all visual rows stay NOT_TESTED / NOT_APPLICABLE).
     */
    visualEvidence?: VisualEvidence[] | null;
    /**
     * Two resource ids for IDOR planning (security-context). Never invented.
     * Omit on default discovery so IDOR stays NOT_TESTED when requestUrl exists.
     */
    resourceIds?: SecurityPlanningOptions['resourceIds'];
    /**
     * Optional pagination evidence keyed by screenId — never invents page counts.
     * Default discovery path passes none (pagination rows stay NOT_TESTED).
     */
    paginationEvidence?: Array<DynamicPaginationEvidence & { screenId: string }> | null;
  };

const SKIP_HREF = /^(mailto:|tel:|javascript:|#)/i;
const HIDDEN_TYPE = /^(hidden)$/i;
const TOKEN_NAME = new RegExp(
  `\\b(${PASSWORD_TOKEN_LOG_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|csrf|nonce)\\b`,
  'i'
);

function nextId(seq: { n: number }): string {
  seq.n += 1;
  return `INV-${String(seq.n).padStart(4, '0')}`;
}

function describe(element: UiElementRecord): string {
  return element.accessibleName || element.locator || element.elementId;
}

function resolveElementKind(element: UiElementRecord): ElementKind {
  return resolveKindForApplicability(element);
}

function inventoryCategoryForScenario(scenarioKind: ScenarioKind): InventoryCategory | undefined {
  switch (scenarioKind) {
    case 'edge':
      return 'boundary';
    case 'positive':
    case 'negative':
    case 'validation':
    case 'security':
    case 'accessibility':
    case 'usability':
      return scenarioKind;
    case 'field':
    case 'button':
    case 'link':
    case 'form':
    case 'login':
    case 'role':
    case 'api-ui':
    case 'state-transition':
    case 'visual':
    case 'security-context':
    case 'dynamic':
      // Field/button/link/form/login/role/api-ui/state-transition/visual/security-context/dynamic rows are additive subcases — category set on each plan.
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Classify purpose from scan fields / elementKind only. Never invent business meaning.
 * Prefer elementKind when present so purpose is not a second conflicting label.
 */
export function classifyElementPurpose(element: UiElementRecord): ElementPurpose {
  const kind = resolveElementKind(element);
  if (kind !== 'unknown' || element.elementKind) {
    return purposeFromElementKind(kind);
  }

  const inputType = (element.inputType ?? '').toLowerCase();
  const evidence = `${element.evidence ?? ''} ${element.locator ?? ''} ${element.accessibleName ?? ''}`.toLowerCase();

  if (element.elementType === 'form') return 'form';
  if (element.elementType === 'link' || element.elementType === 'navigation') return 'navigation-link';
  if (element.elementType === 'button') return 'button';
  if (element.elementType === 'select') return 'select';
  if (element.elementType === 'checkbox') return 'checkbox';
  if (element.elementType === 'radio') return 'radio';
  if (inputType === 'password' || /\btype=password\b/i.test(evidence)) return 'password-input';
  if (HIDDEN_TYPE.test(inputType) || /\btype=hidden\b/i.test(evidence)) return 'hidden-input';
  if (
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  ) {
    return 'text-input';
  }
  return 'unknown';
}

export function isSecurityRelevantElement(element: UiElementRecord): boolean {
  const purpose = classifyElementPurpose(element);
  if (purpose === 'password-input' || purpose === 'hidden-input') return true;
  const blob = `${element.accessibleName ?? ''} ${element.locator ?? ''} ${element.evidence ?? ''} ${element.inputType ?? ''}`;
  return TOKEN_NAME.test(blob);
}

function controlOf(purpose: ElementPurpose, elementType: string): ControlKind {
  if (purpose === 'select' || elementType === 'select') return 'select';
  if (purpose === 'checkbox' || elementType === 'checkbox' || elementType === 'toggle') return 'checkbox';
  if (purpose === 'radio' || elementType === 'radio') return 'radio';
  if (purpose === 'navigation-link' || elementType === 'link') return 'link';
  if (purpose === 'button' || elementType === 'button') return 'button';
  if (
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    purpose === 'hidden-input' ||
    elementType === 'input' ||
    elementType === 'textarea' ||
    elementType === 'search'
  ) {
    return 'text';
  }
  return 'component';
}

function isStateChanging(element: UiElementRecord, pageUrl: string, safety: SafetyConfigResolved): boolean {
  const risk = classify(
    {
      text: element.accessibleName ?? undefined,
      href: element.href ?? undefined,
      formMethod: element.formMethod ?? (element.isSubmit ? 'POST' : undefined),
      pageUrl,
      selector: element.locator ?? undefined,
    },
    safety
  );
  return (
    risk === 'destructive' ||
    Boolean(element.href && /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i.test(element.href))
  );
}

function locatorFrequency(elements: UiElementRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const el of elements) {
    if (el.locator) map.set(el.locator, (map.get(el.locator) ?? 0) + 1);
  }
  return map;
}

function gateLocator(
  element: UiElementRecord,
  frequency: Map<string, number>
): { ok: true; locator: string } | { ok: false; status: CheckStatus; reason: string } {
  if (!element.visible) {
    return {
      ok: false,
      status: 'NOT_TESTED',
      reason:
        'NOT_TESTED: not visible in the default desktop viewport at discovery time — likely responsive/conditional UI',
    };
  }
  if (
    element.locatorStable === false &&
    (element.locator == null || element.locator === '') &&
    (element.locatorStrategy === 'fallback' || element.locatorReason)
  ) {
    return {
      ok: false,
      status: 'NOT_TESTED',
      reason: element.locatorReason ?? AMBIGUOUS_LOCATOR_REASON,
    };
  }
  if (!element.locator) {
    return {
      ok: false,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: no stable locator candidate (id/name/aria-label/placeholder/testid/text)',
    };
  }
  if (element.locator.startsWith('text=') && (frequency.get(element.locator) ?? 0) > 1) {
    return {
      ok: false,
      status: 'REQUIRES_CONFIGURATION',
      reason:
        'REQUIRES_CONFIGURATION: only a text-based locator was available and it matches more than one element on this page',
    };
  }
  return { ok: true, locator: element.locator };
}

interface PushArgs {
  kind: CheckKind;
  scenarioKind?: ScenarioKind;
  title: string;
  targetUrl: string;
  status: CheckStatus;
  purpose?: ElementPurpose;
  action?: PlannedAction;
  targetElementId?: string;
  reason?: string;
  expect?: PlannedCheck['expect'];
  screenId?: string;
  screenUrl?: string;
  category?: InventoryCategory;
  /** Stable subcase suffix, e.g. positive-valid → id INV-0001-positive-valid */
  idSuffix?: string;
}

/**
 * Build a complete structured test inventory from discovery evidence.
 * Generation is field- and constraint-driven; product type is not a code branch.
 * Every page and interactive element gets scenario rows for applicable categories only.
 * Excluded categories are recorded as one NOT_APPLICABLE summary (or decorative exclusion).
 * Does not invent pages/elements. Safety policy gates submit / state-changing actions as
 * BLOCKED or NOT_TESTED — never PLANNED executable.
 */
export function buildScenarioInventory(
  pageMap: PageMap,
  ui: UiInventory,
  safety: SafetyConfigResolved,
  options?: ScenarioInventoryOptions
): PlannedCheck[] {
  const checks: PlannedCheck[] = [];
  const seq = { n: 0 };
  const planningOptions: ScenarioInventoryOptions = {
    environment: options?.environment,
    authorizeDestructive: options?.authorizeDestructive === true,
    authorizeAuthenticatedDiscovery: options?.authorizeAuthenticatedDiscovery === true,
    hasAuthSession: options?.hasAuthSession === true,
    roles: options?.roles,
    permissionRules: options?.permissionRules,
    stateMachines: options?.stateMachines,
    observedStatusLabels: options?.observedStatusLabels,
    executeInvalidTransitions: options?.executeInvalidTransitions === true,
    visualEvidence: options?.visualEvidence,
    resourceIds: options?.resourceIds,
    paginationEvidence: options?.paginationEvidence,
  };

  const push = (args: PushArgs): void => {
    const category =
      args.category ??
      (args.scenarioKind ? inventoryCategoryForScenario(args.scenarioKind) : undefined);
    const baseId = nextId(seq);
    const row: PlannedCheck = {
      id: args.idSuffix ? `${baseId}-${args.idSuffix}` : baseId,
      kind: args.kind,
      title: args.title,
      targetUrl: args.targetUrl,
      screenUrl: args.screenUrl ?? args.targetUrl,
      status: args.status,
      purpose: args.purpose,
      action: args.action ?? 'none',
    };
    if (args.scenarioKind) row.scenarioKind = args.scenarioKind;
    if (category) row.category = category;
    if (args.screenId) row.screenId = args.screenId;
    if (args.targetElementId) row.targetElementId = args.targetElementId;
    if (args.reason) row.reason = args.reason;
    if (args.expect) row.expect = args.expect;
    checks.push(row);
  };

  const screenInventory =
    pageMap.screens && pageMap.screens.length > 0
      ? {
          screens: pageMap.screens,
          unresolvedChannels: pageMap.unresolvedChannels ?? [],
          authenticatedCoverage:
            pageMap.authenticatedCoverage ??
            buildAuthenticatedCoverage({
              screens: pageMap.screens.map((screen) => ({
                id: screen.id,
                url: screen.url,
                state: screen.state,
                authenticationEvidence: 'unknown',
              })),
              pages: pageMap.pages.map((page) => ({
                url: page.finalUrl ?? page.url,
                access: page.access,
                status: page.status ?? undefined,
                metadata: page.metadata,
              })),
              session: { established: false },
            }),
        }
      : buildScreenInventory({ pageMap, ui, auth: pageMap.auth });

  // Persist onto the in-memory page map so callers that reuse the object see ids.
  pageMap.screens = screenInventory.screens;
  pageMap.unresolvedChannels = screenInventory.unresolvedChannels;
  pageMap.authenticatedCoverage = screenInventory.authenticatedCoverage;

  const pagesByUrl = indexPagesByUrl(pageMap.pages);

  for (const screen of screenInventory.screens) {
    pushPageReachedForScreen(push, screen, pagesByUrl);
  }

  const byPage = new Map<string, UiElementRecord[]>();
  for (const element of ui.elements) {
    const bucket = byPage.get(element.page) ?? [];
    bucket.push(element);
    byPage.set(element.page, bucket);
  }

  /** Stable CHAIN-NNN counters per screen across the inventory pass. */
  const apiUiChainSeqByScreen = new Map<string, { n: number }>();

  for (const [pageUrl, elements] of byPage) {
    const frequency = locatorFrequency(elements);
    const defaultScreen = screenInventory.screens.find(
      (screen) => screenIdentityKey(screen.url, screen.state) === screenIdentityKey(pageUrl, 'default')
    );

    for (const element of elements) {
      const kind = resolveElementKind(element);
      if (!element.elementKind) element.elementKind = kind;
      const purpose = classifyElementPurpose(element);
      const label = `${pageUrl} ${element.locator ?? describe(element)}`;
      const gated = gateLocator(element, frequency);
      const stateChanging = isStateChanging(element, pageUrl, safety);
      const control = controlOf(purpose, element.elementType);
      const screenId = element.screenId ?? defaultScreen?.id;
      const decisions = applicableCategories(element);
      const applied = decisions.filter((d) => d.decision === 'apply');
      const excluded = decisions.filter((d) => d.decision === 'exclude');

      if (kind === 'decorative') {
        push({
          kind: 'visibility',
          title: `${label} — decorative exclusion`,
          targetUrl: pageUrl,
          status: 'NOT_APPLICABLE',
          purpose: 'unknown',
          action: 'none',
          targetElementId: element.elementId,
          reason: DECORATIVE_PLAN_REASON,
          screenId,
        });
        continue;
      }

      // Unknown purpose: record NOT_TESTED (not PASS / not silent drop) — one summary row.
      if (purpose === 'unknown' && kind === 'unknown') {
        push({
          kind: 'visibility',
          title: `${label} — unknown purpose`,
          targetUrl: pageUrl,
          status: 'NOT_TESTED',
          purpose: 'unknown',
          action: 'none',
          targetElementId: element.elementId,
          reason: 'NOT_TESTED: element purpose not determined from discovery evidence',
          screenId,
        });
        continue;
      }

      const planCtx = {
        push,
        label,
        pageUrl,
        element,
        purpose,
        control,
        gated,
        screenId,
        pageElements: elements,
      };

      const positiveExclusions: string[] = [];
      const negativeExclusions: string[] = [];
      const edgeExclusions: string[] = [];
      const fieldExclusions: string[] = [];

      for (const row of applied) {
        switch (row.category) {
          case 'positive':
            planPositive({ ...planCtx, stateChanging, kind, onExclude: (note) => positiveExclusions.push(note) });
            break;
          case 'negative':
            planNegative({ ...planCtx, onExclude: (note) => negativeExclusions.push(note) });
            break;
          case 'boundary':
            planEdge({ ...planCtx, onExclude: (note) => edgeExclusions.push(note) });
            break;
          case 'validation':
            planValidation(planCtx);
            break;
          case 'security':
            planSecurity({ ...planCtx, applyReason: row.reason });
            break;
          case 'accessibility':
            planAccessibility(planCtx);
            break;
          case 'usability':
            planUsability(planCtx);
            break;
          default: {
            const _exhaustive: never = row.category;
            void _exhaustive;
          }
        }
      }

      // Field-specific plans (beside positive / negative / edge) — same planner entry.
      if (shouldPlanFieldCases(element, purpose, kind)) {
        planField({ ...planCtx, onExclude: (note) => fieldExclusions.push(note) });
      }

      // Button behavior plans (beside category rows) — same planner entry; never a second planner.
      if (shouldPlanButtonCases(purpose, kind)) {
        planButton({
          ...planCtx,
          kind,
          safety,
          screens: screenInventory.screens,
          planningOptions,
        });
      }

      // API–UI association chains — only when requestUrl was recorded; never sends HTTP.
      planApiUi({
        push,
        label,
        pageUrl,
        element,
        purpose,
        screenId,
        screens: screenInventory.screens,
        chainSeqByScreen: apiUiChainSeqByScreen,
      });

      // Link plans (beside category rows) — same planner entry; link kinds only.
      if (shouldPlanLinkCases(element, kind)) {
        planLink({
          ...planCtx,
          kind,
          safety,
          pages: pageMap.pages,
        });
      }

      if (
        excluded.length > 0 ||
        positiveExclusions.length > 0 ||
        negativeExclusions.length > 0 ||
        edgeExclusions.length > 0 ||
        fieldExclusions.length > 0
      ) {
        const base =
          excluded.length > 0 ? formatExcludedCategories(excluded) : undefined;
        push({
          kind: 'visibility',
          title: `${label} — excluded categories`,
          targetUrl: pageUrl,
          status: 'NOT_APPLICABLE',
          purpose,
          action: 'none',
          targetElementId: element.elementId,
          reason: mergePositiveExclusions(base, [
            ...positiveExclusions,
            ...negativeExclusions,
            ...edgeExclusions,
            ...fieldExclusions,
          ]),
          screenId,
        });
      }

      // Submit / form / blocked action kinds stay inventory rows — never PLANNED executable.
      // BLOCKED is recorded separately from category exclude.
      const blockedAction =
        isBlockedActionKind(kind) || (purpose === 'button' && (element.isSubmit || stateChanging));
      if (purpose === 'form' || kind === 'submit-button' || (purpose === 'button' && element.isSubmit)) {
        push({
          kind: 'form-submit',
          scenarioKind: 'positive',
          title: `${label} — submit (safety)`,
          targetUrl: pageUrl,
          status: 'BLOCKED',
          purpose,
          action: 'none',
          targetElementId: element.elementId,
          reason: FORM_SUBMIT_NOT_AUTHORIZED_REASON,
          screenId,
        });
      }
      if (blockedAction) {
        push({
          kind: 'click-behavior',
          scenarioKind: 'positive',
          title: `${label} — state-changing click (safety)`,
          targetUrl: pageUrl,
          status: 'BLOCKED',
          purpose,
          action: 'none',
          targetElementId: element.elementId,
          reason:
            'BLOCKED: state-changing control click is not authorized for generated checks (safety policy)',
          screenId,
        });
      } else if (purpose === 'button' && !element.href) {
        // Plain button with no destination — do not invent a click target.
        push({
          kind: 'click-behavior',
          scenarioKind: 'positive',
          title: `${label} — activation`,
          targetUrl: pageUrl,
          status: 'NOT_APPLICABLE',
          purpose,
          action: 'none',
          targetElementId: element.elementId,
          reason: 'NOT_APPLICABLE: no destination discovered',
          screenId,
        });
      }
    }
  }

  // Form plans — once per screen that has fillable fields (same planner entry; never a second planner).
  for (const screen of screenInventory.screens) {
    const screenElements = elementsForFormScreen(screen, ui.elements, byPage);
    planFormsForScreen({
      push,
      screen,
      elements: screenElements,
      screens: screenInventory.screens,
      planningOptions,
    });
  }

  // Screen-level a11y observation plans — same planner; never a second axe engine; never PASS / WCAG claim.
  for (const screen of screenInventory.screens) {
    const screenElements = elementsForFormScreen(screen, ui.elements, byPage);
    planA11yForScreen({
      push,
      screen,
      elements: screenElements,
      existingChecks: checks,
    });
  }

  // Discovery-driven dynamic plans (file / pagination / search+filter) — same planner;
  // never a second generator; never invents controls; never writes file bytes.
  const paginationEvidenceByScreen = new Map<string, DynamicPaginationEvidence>();
  for (const row of planningOptions.paginationEvidence ?? []) {
    if (row?.screenId) paginationEvidenceByScreen.set(row.screenId, row);
  }
  for (const screen of screenInventory.screens) {
    const screenElements = elementsForFormScreen(screen, ui.elements, byPage);
    planDynamicForScreen({
      push,
      screen,
      elements: screenElements,
      existingChecks: checks,
      evidence: paginationEvidenceByScreen.get(screen.id) ?? null,
    });
  }

  // Screen-level visual observation plans — same planner; never a second visual engine;
  // never writes PNG/baselines; never PASS without comparison (match is still not PASS).
  // Runtime suite named only: tests/e2e/visual (npm run test:visual) — not invoked here.
  const visualEvidenceByScreen = new Map<string, VisualEvidence>();
  for (const row of planningOptions.visualEvidence ?? []) {
    if (row?.screenId) visualEvidenceByScreen.set(row.screenId, row);
  }
  for (const screen of screenInventory.screens) {
    planVisualForScreen({
      push,
      screen,
      evidence: visualEvidenceByScreen.get(screen.id) ?? null,
    });
  }

  // Login plans — once per auth-qualified screen; fills follow discovered field kinds only (never invent /login or credential inputs).
  for (const screen of screenInventory.screens) {
    const screenElements = elementsForFormScreen(screen, ui.elements, byPage);
    planLoginForScreen({
      push,
      screen,
      elements: screenElements,
      screens: screenInventory.screens,
      pages: pageMap.pages,
      allElements: ui.elements,
      navigation: pageMap.navigation,
      planningOptions,
    });
  }

  // Context-aware security plans — same planner; never a second security engine (run-security.ts stays runtime).
  // After login so login-injection can suppress a duplicate sec-input-injection row.
  for (const screen of screenInventory.screens) {
    const screenElements = elementsForFormScreen(screen, ui.elements, byPage);
    planSecurityContextForScreen({
      push,
      screen,
      elements: screenElements,
      pages: pageMap.pages,
      existingChecks: checks,
      planningOptions,
    });
  }

  // Authenticated-coverage gate notes — once per unresolved gate; never PLANNED navigation / login click.
  for (const note of buildAccessGateCoverageNotes(screenInventory.authenticatedCoverage)) {
    push({
      kind: note.kind,
      scenarioKind: 'security',
      category: note.category,
      title: note.title,
      targetUrl: pageMap.seedUrl,
      screenUrl: pageMap.seedUrl,
      status: note.status,
      purpose: 'unknown',
      action: note.action,
      reason: note.reason,
      idSuffix: note.noteId,
    });
  }

  // Role / permission plans — same planner; roles from options or coverage only (never invent defaults).
  planRolePermissions({
    push,
    seedUrl: pageMap.seedUrl,
    screens: screenInventory.screens,
    elements: ui.elements,
    coverage: screenInventory.authenticatedCoverage,
    planningOptions,
  });

  // State-transition plans — only when caller supplies machines or status labels (never from ScreenStateToken).
  planStateTransitions({
    push,
    seedUrl: pageMap.seedUrl,
    planningOptions,
  });

  // --- workflow: one-step edge rows (observe) + multi-step path rows from workflow-cases ---
  // Single-edge observe stays here so a happy path does not duplicate the same assertion.
  // Multi-step chains (WF-NNN) are built only from crawled edges — never invented business flows.
  const edges = pageMap.navigation.filter((nav) => nav.inScope);

  if (edges.length > 0) {
    for (const edge of edges) {
      const matchingLink = ui.elements.find(
        (el) =>
          el.page === edge.from &&
          (el.elementType === 'link' || el.elementType === 'navigation') &&
          el.href &&
          (el.href === edge.to ||
            (() => {
              try {
                return new URL(el.href, edge.from).href === new URL(edge.to, edge.from).href;
              } catch {
                return false;
              }
            })())
      );
      const stateChanging = matchingLink
        ? isStateChanging(matchingLink, edge.from, safety)
        : Boolean(edge.to && /[?&](action|do|cmd)=(delete|remove|cancel|deactivate)/i.test(edge.to));

      if (stateChanging || !authorize({ kind: 'click-link', correlatesWithStateChange: stateChanging })) {
        push({
          kind: 'navigation',
          scenarioKind: 'workflow',
          title: `${edge.from} → ${edge.to} workflow (safety)`,
          targetUrl: edge.from,
          status: 'NOT_TESTED',
          purpose: 'navigation-link',
          action: 'none',
          targetElementId: matchingLink?.elementId,
          reason: 'NOT_TESTED: navigation edge is classified as state-changing — GET/click not authorized',
        });
        continue;
      }

      if (matchingLink?.locator) {
        push({
          kind: 'click-link',
          scenarioKind: 'workflow',
          title: `${edge.from} → ${edge.to} workflow navigation`,
          targetUrl: edge.from,
          status: 'PLANNED',
          purpose: 'navigation-link',
          action: 'click-link',
          targetElementId: matchingLink.elementId,
          expect: { locator: matchingLink.locator, href: matchingLink.href ?? edge.to, control: 'link' },
        });
      } else {
        push({
          kind: 'link-href',
          scenarioKind: 'workflow',
          title: `${edge.from} → ${edge.to} workflow (href observed in crawl graph)`,
          targetUrl: edge.from,
          status: 'NOT_TESTED',
          purpose: 'navigation-link',
          action: 'observe',
          reason:
            'NOT_TESTED: navigation edge recorded in crawl graph but no matching link locator in UI scan — inventory lists the edge without inventing a click',
          expect: { href: edge.to },
        });
      }
    }
  }

  // Cross-screen workflows: happy / alternative / negative / interrupted / recovery.
  // Uses only discovered edges; submit/delete never PLANNED as executed steps.
  for (const result of buildWorkflowCases({
    navigation: pageMap.navigation,
    pages: pageMap.pages,
    elements: ui.elements,
    seedUrl: pageMap.seedUrl,
  })) {
    for (const plan of result.plans) {
      push({
        kind: plan.kind,
        scenarioKind: 'workflow',
        title: plan.title,
        targetUrl: plan.targetUrl,
        status: plan.status,
        purpose: 'navigation-link',
        action: plan.action,
        reason: plan.reason,
        expect: plan.expect,
        idSuffix: `${plan.workflowId}-${plan.subcaseId}`,
      });
    }
  }

  // Safety invariant: no PLANNED row may declare a submit action
  for (const check of checks) {
    if (check.action === undefined) continue;
    if (check.status === 'PLANNED' && (check.kind === 'form-submit' || check.action === ('submit' as PlannedAction))) {
      check.status = 'BLOCKED';
      check.action = 'none';
      check.reason =
        check.reason ??
        FORM_SUBMIT_NOT_AUTHORIZED_REASON;
    }
  }

  return checks;
}

function indexPagesByUrl(pages: PageMapEntry[]): Map<string, PageMapEntry> {
  const map = new Map<string, PageMapEntry>();
  for (const page of pages) {
    map.set(canonicalScreenUrl(page.url), page);
    if (page.finalUrl) map.set(canonicalScreenUrl(page.finalUrl), page);
  }
  return map;
}

function pushPageReachedForScreen(
  push: (args: PushArgs) => void,
  screen: DiscoveredScreen,
  pagesByUrl: Map<string, PageMapEntry>
): void {
  const page = pagesByUrl.get(canonicalScreenUrl(screen.url));
  const label = screen.state === 'default' ? screen.url : `${screen.url} [${screen.state}]`;
  const base = {
    scenarioKind: 'page-reached' as const,
    targetUrl: screen.url,
    screenUrl: screen.url,
    screenId: screen.id,
    purpose: 'unknown' as const,
  };

  if (page?.error) {
    push({
      ...base,
      kind: 'page-sanity',
      title: `${screen.id} ${label} page-reached — navigation error`,
      status: 'BLOCKED',
      action: 'none',
      reason: `BLOCKED: navigation error during discovery — ${page.error}`,
    });
    return;
  }
  if (page?.access === 'gated') {
    push({
      ...base,
      kind: 'page-sanity',
      title: `${screen.id} ${label} page-reached — behind authentication`,
      status: 'REQUIRES_CONFIGURATION',
      action: 'none',
      reason:
        page.gatedReason ??
        'REQUIRES_CONFIGURATION: login wall observed — content was not inventoried',
    });
    return;
  }
  if (page?.status != null && page.status >= 400) {
    push({
      ...base,
      kind: 'broken-link',
      title: `${screen.id} ${label} page-reached — HTTP ${page.status}`,
      status: 'PLANNED',
      action: 'observe',
    });
    return;
  }

  const hasH1 = (page?.h1s ?? []).some((heading) => heading.trim().length > 0);
  const hasHeading =
    hasH1 || (page?.headings ?? []).some((heading) => heading.text.trim().length > 0);

  // Dialog/drawer/modal states: observe the overlay on the same URL — no inventing headings.
  if (screen.state !== 'default') {
    push({
      ...base,
      kind: 'page-sanity',
      title: `${screen.id} ${label} page-reached — observed ${screen.state} state`,
      status: 'PLANNED',
      action: 'observe',
    });
    return;
  }

  push({
    ...base,
    kind: 'page-sanity',
    title: hasHeading
      ? `${screen.id} ${label} page-reached — load and render a heading`
      : `${screen.id} ${label} page-reached — load`,
    status: 'PLANNED',
    action: 'observe',
    expect: { requireH1: hasH1, requireHeading: hasHeading && !hasH1 },
  });
}

function planPositive(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  stateChanging: boolean;
  screenId?: string;
  kind?: ElementKind;
  pageElements?: UiElementRecord[];
  onExclude?: (note: string) => void;
}): void {
  const {
    push,
    label,
    pageUrl,
    element,
    purpose,
    control,
    gated,
    stateChanging,
    screenId,
    kind,
    pageElements,
    onExclude,
  } = input;
  const base = {
    scenarioKind: 'positive' as const,
    title: `${label} — positive visible/reachable`,
    targetUrl: pageUrl,
    purpose,
    targetElementId: element.elementId,
    screenId,
  };

  if (purpose === 'form') {
    if (!gated.ok) {
      push({ ...base, kind: 'form-presence', status: gated.status, action: 'none', reason: gated.reason });
      return;
    }
    push({
      ...base,
      kind: 'form-presence',
      status: 'PLANNED',
      action: 'observe',
      expect: { locator: gated.locator, visible: true, control },
    });
    return;
  }

  if (!gated.ok) {
    push({ ...base, kind: 'visibility', status: gated.status, action: 'none', reason: gated.reason });
    return;
  }

  if (purpose === 'navigation-link') {
    const href = element.href ?? '';
    if (!href || SKIP_HREF.test(href)) {
      push({
        ...base,
        kind: 'visibility',
        status: 'PLANNED',
        action: 'observe',
        expect: { locator: gated.locator, visible: true, enabled: element.enabled, control },
      });
    } else if (stateChanging || !authorize({ kind: 'click-link', correlatesWithStateChange: stateChanging })) {
      push({
        ...base,
        kind: 'visibility',
        status: 'PLANNED',
        action: 'observe',
        expect: { locator: gated.locator, visible: true, control },
      });
    } else {
      push({
        ...base,
        kind: 'link-href',
        title: `${label} — positive resolves as discovered href`,
        status: 'PLANNED',
        action: 'observe',
        expect: { locator: gated.locator, href, control },
      });
    }
  } else if (
    purpose === 'button' &&
    (element.isSubmit || stateChanging || isBlockedActionKind(kind) || kind === 'submit-button')
  ) {
    push({
      ...base,
      kind: 'visibility',
      status: 'PLANNED',
      action: 'observe',
      expect: { locator: gated.locator, visible: true, enabled: element.enabled, control },
    });
  } else if (purpose === 'hidden-input') {
    push({
      ...base,
      kind: 'visibility',
      title: `${label} — positive hidden field observed in scan`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: 'NOT_TESTED: hidden inputs are not visible for positive observation in the discovery harness',
    });
    return;
  } else {
    push({
      ...base,
      kind: 'visibility',
      status: 'PLANNED',
      action: 'observe',
      expect: {
        locator: gated.locator,
        visible: true,
        enabled: element.enabled,
        control,
        accessibleName: element.accessibleName,
      },
    });
  }

  // Additional positive / valid expected-use subcases (never PASS; never submit).
  const extra = buildPositiveSubcases({
    element,
    purpose,
    control,
    label,
    locator: gated.locator,
    stateChanging,
    kind,
    pageElements: pageElements ?? [],
  });
  for (const note of extra.exclusions) {
    onExclude?.(note);
  }
  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'positive',
      category: 'positive',
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function planNegative(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  pageElements?: UiElementRecord[];
  onExclude?: (note: string) => void;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId, pageElements, onExclude } =
    input;
  const fillable =
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    purpose === 'select' ||
    purpose === 'checkbox' ||
    purpose === 'radio';

  if (!fillable) {
    // Buttons/links: record unauthorized/forbidden as NOT_TESTED — never a PLANNED click.
    if (purpose === 'button' || purpose === 'navigation-link' || purpose === 'form') {
      const extra = buildNegativeSubcases({
        element,
        purpose,
        control,
        label,
        locator: gated.ok ? gated.locator : element.locator ?? '',
        pageElements: pageElements ?? [],
      });
      for (const note of extra.exclusions) onExclude?.(note);
      for (const plan of extra.plans) {
        push({
          kind: plan.kind,
          scenarioKind: 'negative',
          category: 'negative',
          title: plan.title,
          targetUrl: pageUrl,
          status: plan.status,
          purpose,
          action: plan.action,
          targetElementId: element.elementId,
          screenId,
          reason: plan.reason,
          expect: plan.expect,
          idSuffix: plan.subcaseId,
        });
      }
      return;
    }
    push({
      kind: 'invalid-input',
      scenarioKind: 'negative',
      category: 'negative',
      title: `${label} — negative`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: negative input scenarios apply to fillable fields only',
      screenId,
    });
    return;
  }

  if (element.readOnly) {
    push({
      kind: 'invalid-input',
      scenarioKind: 'negative',
      category: 'negative',
      title: `${label} — negative`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: read-only control — negative fill not applicable',
      screenId,
    });
    return;
  }

  if (!gated.ok) {
    push({
      kind: 'invalid-input',
      scenarioKind: 'negative',
      category: 'negative',
      title: `${label} — negative`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (!authorize({ kind: 'fill-field' })) {
    push({
      kind: 'invalid-input',
      scenarioKind: 'negative',
      category: 'negative',
      title: `${label} — negative`,
      targetUrl: pageUrl,
      status: 'BLOCKED',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'BLOCKED: fill is not authorized by safety policy',
      screenId,
    });
    return;
  }

  // Additional negative / invalid fill subcases (never PASS; never submit).
  const extra = buildNegativeSubcases({
    element,
    purpose,
    control,
    label,
    locator: gated.locator,
    pageElements: pageElements ?? [],
  });
  for (const note of extra.exclusions) {
    onExclude?.(note);
  }
  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'negative',
      category: 'negative',
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function planEdge(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  onExclude?: (note: string) => void;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId, onExclude } = input;
  const fillable = purpose === 'text-input' || purpose === 'password-input';

  if (!fillable) {
    onExclude?.('edge analysis not applicable to this control type');
    push({
      kind: 'boundary-values',
      scenarioKind: 'edge',
      category: 'boundary',
      title: `${label} — edge`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: edge analysis not applicable to this control type',
      screenId,
    });
    return;
  }

  if (element.readOnly) {
    onExclude?.('edge analysis not applicable to read-only control');
    push({
      kind: 'boundary-values',
      scenarioKind: 'edge',
      category: 'boundary',
      title: `${label} — edge`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: read-only control — edge fill not applicable',
      screenId,
    });
    return;
  }

  if (!gated.ok) {
    push({
      kind: 'boundary-values',
      scenarioKind: 'edge',
      category: 'boundary',
      title: `${label} — edge`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (!authorize({ kind: 'fill-field' })) {
    push({
      kind: 'boundary-values',
      scenarioKind: 'edge',
      category: 'boundary',
      title: `${label} — edge`,
      targetUrl: pageUrl,
      status: 'BLOCKED',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'BLOCKED: fill is not authorized by safety policy',
      screenId,
    });
    return;
  }

  // Edge / boundary fill subcases (never PASS; never submit).
  const extra = buildEdgeSubcases({
    element,
    purpose,
    control,
    label,
    locator: gated.locator,
  });
  for (const note of extra.exclusions) {
    onExclude?.(note);
  }
  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'edge',
      category: 'boundary',
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function shouldPlanFieldCases(
  element: UiElementRecord,
  purpose: ElementPurpose,
  kind: ElementKind
): boolean {
  if (kind === 'decorative') return false;
  const inputType = (element.inputType ?? element.attributes?.type ?? '').toLowerCase();
  if (kind === 'file-upload' || inputType === 'file' || element.elementType === 'file-upload') {
    return true;
  }
  if (purpose === 'text-input' || purpose === 'password-input') return true;
  if (
    element.elementType === 'input' ||
    element.elementType === 'textarea' ||
    element.elementType === 'search'
  ) {
    return true;
  }
  return (
    kind === 'text-input' ||
    kind === 'email-input' ||
    kind === 'password-input' ||
    kind === 'number-input' ||
    kind === 'search-field' ||
    kind === 'textarea' ||
    kind === 'date-input' ||
    kind === 'time-input' ||
    kind === 'datetime-input' ||
    kind === 'otp-field' ||
    kind === 'masked-input' ||
    kind === 'autocomplete'
  );
}

function shouldPlanButtonCases(purpose: ElementPurpose, kind: ElementKind): boolean {
  return isButtonKindForPlanning(purpose, kind);
}

function shouldPlanLinkCases(element: UiElementRecord, kind: ElementKind): boolean {
  return isLinkKindForPlanning(element, kind);
}

/** Elements attached to this screen (screenId) or default page match when screenId is absent. */
function elementsForFormScreen(
  screen: DiscoveredScreen,
  elements: UiElementRecord[],
  byPage: Map<string, UiElementRecord[]>
): UiElementRecord[] {
  const keyed = elements.filter((el) => el.screenId === screen.id);
  if (keyed.length > 0) return keyed;
  if (screen.state !== 'default') return [];
  const pageBucket = byPage.get(screen.url);
  if (pageBucket && pageBucket.length > 0) return pageBucket;
  return elements.filter(
    (el) => !el.screenId && canonicalScreenUrl(el.page) === canonicalScreenUrl(screen.url)
  );
}

function planFormsForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  screens: DiscoveredScreen[];
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const { push, screen, elements, screens, planningOptions } = input;
  const results = buildFormPlansForScreen({
    screen,
    elements,
    screens,
    options: {
      hasAuthSession: planningOptions?.hasAuthSession === true,
    },
  });

  for (const result of results) {
    for (const plan of result.plans) {
      push({
        kind: plan.kind,
        scenarioKind: 'form',
        category: plan.category,
        title: plan.title,
        targetUrl: screen.url,
        screenUrl: screen.url,
        status: plan.status,
        purpose: 'form',
        action: plan.action,
        targetElementId: plan.targetElementId ?? result.formId,
        screenId: screen.id,
        reason: plan.reason,
        expect: plan.expect,
        idSuffix: `${result.formId}-${plan.subcaseId}`,
      });
    }
  }
}

/** Screen-level a11y rows (a11y-*). Skips duplicate accessible-name facts already recorded per element. */
function planA11yForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  existingChecks: PlannedCheck[];
}): void {
  const { push, screen, elements, existingChecks } = input;
  const existingAccessibleNameElementIds = new Set(
    existingChecks
      .filter(
        (row) =>
          row.scenarioKind === 'accessibility' &&
          row.kind === 'accessible-name' &&
          typeof row.targetElementId === 'string' &&
          row.targetElementId.length > 0
      )
      .map((row) => row.targetElementId as string)
  );

  const result = buildA11yPlansForScreen({
    screen,
    elements,
    options: { existingAccessibleNameElementIds },
  });

  for (const plan of result.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'accessibility',
      category: plan.category ?? 'accessibility',
      title: plan.title,
      targetUrl: screen.url,
      screenUrl: screen.url,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      targetElementId: plan.targetElementId,
      screenId: screen.id,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: `${screen.id}-${plan.subcaseId}`,
    });
  }
}

/**
 * Screen-level dynamic-* rows from discovered file / pagination / search+filter controls.
 * Skips dynamic-file-* when field-file-* already planned for the screen.
 */
function planDynamicForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  existingChecks: PlannedCheck[];
  evidence?: DynamicPaginationEvidence | null;
}): void {
  const { push, screen, elements, existingChecks, evidence } = input;
  const existingSubcaseIds = collectExistingSubcaseIds(existingChecks, screen.id);
  const mapped: DynamicElementInput[] = elements.map((el) => {
    const kind = resolveElementKind(el);
    return {
      elementId: el.elementId,
      type: String(el.elementKind ?? el.elementType ?? kind),
      category: elementCategoryFromKind(kind, { tag: el.tag, href: el.href }),
      accessibleName: el.accessibleName,
      accept: el.attributes?.accept ?? null,
      role: el.attributes?.role ?? null,
    };
  });

  const plans = buildDynamicCasesForScreen({
    screenId: screen.id,
    elements: mapped,
    existingSubcaseIds,
    evidence: evidence ?? null,
  });

  for (const plan of plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'dynamic',
      title: plan.title,
      targetUrl: screen.url,
      screenUrl: screen.url,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      targetElementId: plan.targetElementId,
      screenId: screen.id,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: `${screen.id}-${plan.subcaseId}`,
    });
  }
}

/** Screen-level visual-* rows. Never writes PNG/baselines; never PASS without comparison. */
function planVisualForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  evidence?: VisualEvidence | null;
}): void {
  const { push, screen, evidence } = input;
  const result = buildVisualPlansForScreen({ screen, evidence });

  for (const plan of result.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'visual',
      title: plan.title,
      targetUrl: screen.url,
      screenUrl: screen.url,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      screenId: screen.id,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: `${screen.id}-${plan.subcaseId}`,
    });
  }
}

function planLoginForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  screens: DiscoveredScreen[];
  pages: PageMapEntry[];
  allElements: UiElementRecord[];
  navigation: { from: string; to: string }[];
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const { push, screen, elements, screens, pages, allElements, navigation, planningOptions } = input;
  const results = buildLoginPlansForScreen({
    screen,
    elements,
    screens,
    pages,
    allElements,
    navigation,
    options: {
      hasAuthSession: planningOptions?.hasAuthSession === true,
    },
  });

  for (const result of results) {
    for (const plan of result.plans) {
      push({
        kind: plan.kind,
        scenarioKind: 'login',
        category: plan.category,
        title: plan.title,
        targetUrl: screen.url,
        screenUrl: screen.url,
        status: plan.status,
        purpose: 'form',
        action: plan.action,
        targetElementId: plan.targetElementId,
        screenId: screen.id,
        reason: plan.reason,
        expect: plan.expect,
        idSuffix: plan.subcaseId,
      });
    }
  }
}

/**
 * Screen-level context-aware security plans (sec-*).
 * Never a second security engine; never executable attacks; default authorizeDestructive false.
 */
function planSecurityContextForScreen(input: {
  push: (args: PushArgs) => void;
  screen: DiscoveredScreen;
  elements: UiElementRecord[];
  pages: PageMapEntry[];
  existingChecks: PlannedCheck[];
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const { push, screen, elements, pages, existingChecks, planningOptions } = input;
  const existingSubcaseIds = collectExistingSubcaseIds(existingChecks, screen.id);
  const result = buildSecurityPlansForScreen({
    screen,
    elements,
    pages,
    options: {
      environment: planningOptions?.environment,
      authorizeDestructive: planningOptions?.authorizeDestructive === true,
      hasAuthSession: planningOptions?.hasAuthSession === true,
      resourceIds: planningOptions?.resourceIds,
      permissionRules: planningOptions?.permissionRules,
      existingSubcaseIds,
    },
  });

  for (const plan of result.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'security-context',
      category: plan.category,
      title: plan.title,
      targetUrl: screen.url,
      screenUrl: screen.url,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      targetElementId: plan.targetElementId,
      screenId: screen.id,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: `${screen.id}-${plan.subcaseId}`,
    });
  }
}

function planRolePermissions(input: {
  push: (args: PushArgs) => void;
  seedUrl: string;
  screens: DiscoveredScreen[];
  elements: UiElementRecord[];
  coverage: ReturnType<typeof buildAuthenticatedCoverage>;
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const { push, seedUrl, screens, elements, coverage, planningOptions } = input;
  const rolesFromOptions = planningOptions?.roles;
  const roles =
    rolesFromOptions !== undefined
      ? rolesFromOptions
      : (() => {
          const keys = configuredRoleKeys(coverage);
          return keys.length > 0 ? keys : null;
        })();

  const screenByUrl = new Map(screens.map((s) => [canonicalScreenUrl(s.url), s.id] as const));
  const roleElements = elements.map((el) => {
    const screenId = screenByUrl.get(canonicalScreenUrl(el.page)) ?? 'SCREEN-UNKNOWN';
    return {
      elementId: el.elementId,
      screenId,
      type: String(el.elementKind ?? el.elementType ?? ''),
      accessibleName: el.accessibleName,
      disabled: el.enabled === false ? true : undefined,
    };
  });

  const plans = buildRolePermissionPlans({
    roles,
    rules: planningOptions?.permissionRules ?? null,
    elements: roleElements,
    screens: screens.map((s) => ({ id: s.id, url: s.url })),
    options: {
      environment: planningOptions?.environment,
      authorizeDestructive: planningOptions?.authorizeDestructive === true,
      authorizeAuthenticatedDiscovery: planningOptions?.authorizeAuthenticatedDiscovery === true,
    },
  });

  for (const plan of plans) {
    const targetUrl = plan.targetUrl ?? seedUrl;
    const idSuffix = plan.role ? `${plan.role}-${plan.subcaseId}` : plan.subcaseId;
    push({
      kind: plan.kind,
      scenarioKind: 'role',
      category: plan.category,
      title: plan.title,
      targetUrl,
      screenUrl: targetUrl,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      targetElementId: plan.targetElementId,
      screenId: plan.screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix,
    });
  }
}

/**
 * Wire state-transition plans only when options explicitly provide machines or status labels.
 * Default discovery (options undefined / both omitted) emits nothing — never invents a business machine
 * from UI screen states (default → dialog) or ordinary pages.
 */
function planStateTransitions(input: {
  push: (args: PushArgs) => void;
  seedUrl: string;
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const { push, seedUrl, planningOptions } = input;
  if (
    planningOptions?.stateMachines === undefined &&
    planningOptions?.observedStatusLabels === undefined
  ) {
    return;
  }

  const plans = buildStateTransitionPlans({
    machines: planningOptions.stateMachines ?? null,
    observedStatusLabels: planningOptions.observedStatusLabels ?? null,
    executeInvalid: planningOptions.executeInvalidTransitions === true,
  });

  for (const plan of plans) {
    const idSuffix = plan.componentId ? `${plan.componentId}-${plan.subcaseId}` : plan.subcaseId;
    push({
      kind: plan.kind,
      scenarioKind: 'state-transition',
      title: plan.title,
      targetUrl: seedUrl,
      screenUrl: seedUrl,
      status: plan.status,
      purpose: 'unknown',
      action: plan.action,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix,
    });
  }
}

function planLink(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  kind?: ElementKind;
  safety: SafetyConfigResolved;
  pages: PageMapEntry[];
}): void {
  const {
    push,
    label,
    pageUrl,
    element,
    purpose,
    control,
    gated,
    screenId,
    kind,
    safety,
    pages,
  } = input;

  const locator = gated.ok ? gated.locator : element.locator ?? '';
  const extra = buildLinkSubcases({
    element,
    purpose,
    control,
    label,
    locator,
    kind,
    pageUrl,
    safety,
    pages,
  });

  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'link',
      category: plan.category,
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function planButton(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  kind?: ElementKind;
  safety: SafetyConfigResolved;
  pageElements?: UiElementRecord[];
  screens?: DiscoveredScreen[];
  planningOptions?: ScenarioInventoryOptions;
}): void {
  const {
    push,
    label,
    pageUrl,
    element,
    purpose,
    control,
    gated,
    screenId,
    kind,
    safety,
    pageElements,
    screens,
    planningOptions,
  } = input;

  const locator = gated.ok ? gated.locator : element.locator ?? '';
  const extra = buildButtonSubcases({
    element,
    purpose,
    control,
    label,
    locator,
    kind,
    pageUrl,
    safety,
    pageElements: pageElements ?? [],
    screens: screens ?? [],
    options: planningOptions,
  });

  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'button',
      category: plan.category,
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function planApiUi(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  screenId?: string;
  screens: DiscoveredScreen[];
  chainSeqByScreen: Map<string, { n: number }>;
}): void {
  const { push, label, pageUrl, element, purpose, screenId, screens, chainSeqByScreen } = input;
  const results = buildApiUiChains({
    elements: [element],
    screens,
    defaultScreenId: screenId,
    pageUrl,
    label,
    seqByScreen: chainSeqByScreen,
  });

  for (const result of results) {
    for (const plan of result.plans) {
      pushApiUiPlan(push, pageUrl, purpose, plan);
    }
  }
}

function pushApiUiPlan(
  push: (args: PushArgs) => void,
  pageUrl: string,
  purpose: ElementPurpose,
  plan: ApiUiChainPlan
): void {
  const expect = plan.expect ? { ...plan.expect } : undefined;
  if (plan.maskedPayload !== undefined) {
    const note = expect?.note ? `${expect.note}; masked=${plan.maskedPayload}` : plan.maskedPayload;
    if (expect) expect.note = note;
  }
  // completeSuccess must never be claimed true — surface as expect.note when evaluated.
  if (plan.completeSuccess === false) {
    const marker = 'completeSuccess=false';
    if (expect) {
      expect.note = expect.note ? `${expect.note}; ${marker}` : marker;
    }
  }

  push({
    kind: plan.kind,
    scenarioKind: 'api-ui',
    category: plan.category,
    title: plan.title,
    targetUrl: pageUrl,
    status: plan.status,
    purpose,
    action: plan.action,
    targetElementId: plan.targetElementId,
    screenId: plan.screenId,
    reason: plan.reason,
    expect: expect ?? plan.expect,
    idSuffix: `${plan.chainId}-${plan.subcaseId}`,
  });
}

function planField(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  pageElements?: UiElementRecord[];
  onExclude?: (note: string) => void;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId, pageElements, onExclude } =
    input;

  if (element.readOnly) {
    onExclude?.('field-specific cases not applicable to read-only control');
    return;
  }

  const inputType = (element.inputType ?? element.attributes?.type ?? '').toLowerCase();
  const isFile =
    inputType === 'file' ||
    element.elementKind === 'file-upload' ||
    element.elementType === 'file-upload';

  if (!gated.ok) {
    push({
      kind: isFile ? 'valid-input' : 'invalid-input',
      scenarioKind: 'field',
      title: `${label} — field`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (!isFile && !authorize({ kind: 'fill-field' })) {
    push({
      kind: 'invalid-input',
      scenarioKind: 'field',
      title: `${label} — field`,
      targetUrl: pageUrl,
      status: 'BLOCKED',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'BLOCKED: fill is not authorized by safety policy',
      screenId,
    });
    return;
  }

  const extra = buildFieldSubcases({
    element,
    purpose,
    control,
    label,
    locator: gated.locator,
    pageElements: pageElements ?? [],
  });
  for (const note of extra.exclusions) {
    onExclude?.(note);
  }
  for (const plan of extra.plans) {
    push({
      kind: plan.kind,
      scenarioKind: 'field',
      title: plan.title,
      targetUrl: pageUrl,
      status: plan.status,
      purpose,
      action: plan.action,
      targetElementId: element.elementId,
      screenId,
      reason: plan.reason,
      expect: plan.expect,
      idSuffix: plan.subcaseId,
    });
  }
}

function planValidation(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId } = input;
  const fillable =
    purpose === 'text-input' ||
    purpose === 'password-input' ||
    purpose === 'select' ||
    purpose === 'checkbox' ||
    purpose === 'radio';

  if (!fillable) {
    push({
      kind: 'required-validation',
      scenarioKind: 'validation',
      title: `${label} — validation`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: validation constraints not applicable to this element',
      screenId,
    });
    return;
  }

  if (!hasValidationConstraint(element)) {
    push({
      kind: 'required-validation',
      scenarioKind: 'validation',
      title: `${label} — validation`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: no required/pattern/type constraint discovered on this element',
      screenId,
    });
    return;
  }

  if (!gated.ok) {
    push({
      kind: 'required-state',
      scenarioKind: 'validation',
      title: `${label} — validation`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (element.required) {
    push({
      kind: 'required-validation',
      scenarioKind: 'validation',
      title: `${label} — validation required (no submit)`,
      targetUrl: pageUrl,
      status: 'PLANNED',
      purpose,
      action: 'fill-no-submit',
      targetElementId: element.elementId,
      screenId,
      expect: {
        locator: gated.locator,
        required: true,
        fillValue: '',
        boundary: true,
        control,
      },
    });
    return;
  }

  push({
    kind: 'required-state',
    scenarioKind: 'validation',
    title: `${label} — validation type/constraint present`,
    targetUrl: pageUrl,
    status: 'PLANNED',
    purpose,
    action: 'observe',
    targetElementId: element.elementId,
    screenId,
    expect: {
      locator: gated.locator,
      required: false,
      control,
      inputType: element.inputType ?? undefined,
    },
  });
}

function planSecurity(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
  applyReason?: string;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId, applyReason } = input;
  const inputType = (element.inputType ?? '').toLowerCase();
  const isEmail =
    inputType === 'email' ||
    element.elementKind === 'email-input' ||
    /\btype=email\b/i.test(element.evidence ?? '');

  if (isEmail) {
    if (!gated.ok) {
      push({
        kind: 'security-observation',
        scenarioKind: 'security',
        title: `${label} — security`,
        targetUrl: pageUrl,
        status: gated.status,
        purpose,
        action: 'none',
        targetElementId: element.elementId,
        reason: gated.reason,
        screenId,
      });
      return;
    }
    push({
      kind: 'security-observation',
      scenarioKind: 'security',
      category: 'security',
      title: `${label} — security observation (type=email, no exploit payload)`,
      targetUrl: pageUrl,
      status: 'PLANNED',
      purpose,
      action: 'observe',
      targetElementId: element.elementId,
      screenId,
      reason: applyReason ?? 'security observation only; no exploit payload',
      expect: {
        locator: gated.locator,
        control,
        inputType: 'email',
      },
    });
    return;
  }

  if (!isSecurityRelevantElement(element)) {
    push({
      kind: 'security-observation',
      scenarioKind: 'security',
      title: `${label} — security`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: 'NOT_APPLICABLE: security scenario not applicable to this element',
      screenId,
    });
    return;
  }

  if (!gated.ok) {
    push({
      kind: 'security-observation',
      scenarioKind: 'security',
      title: `${label} — security`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (purpose === 'password-input') {
    push({
      kind: 'security-observation',
      scenarioKind: 'security',
      title: `${label} — security password observation (type=password, no echo exploit)`,
      targetUrl: pageUrl,
      status: 'PLANNED',
      purpose,
      action: 'observe',
      targetElementId: element.elementId,
      screenId,
      expect: {
        locator: gated.locator,
        control,
        inputType: 'password',
        autocomplete: element.attributes?.autocomplete,
      },
    });
    return;
  }

  push({
    kind: 'security-observation',
    scenarioKind: 'security',
    title: `${label} — security sensitive-field observation`,
    targetUrl: pageUrl,
    status: 'NOT_TESTED',
    purpose,
    action: 'none',
    targetElementId: element.elementId,
    screenId,
    reason:
      'NOT_TESTED: sensitive/hidden/token-like field observed — non-destructive security observation beyond type=password is not executed by the discovery harness',
    expect: { locator: gated.locator, inputType: element.inputType ?? undefined },
  });
}

function planAccessibility(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId } = input;
  const hasName = Boolean(
    (element.accessibleName && element.accessibleName.trim()) ||
      (element.label && element.label.trim())
  );
  const hasRoleEvidence = /\brole=/i.test(element.evidence ?? '') || Boolean(element.attributes?.role);

  if (!gated.ok) {
    push({
      kind: 'accessible-name',
      scenarioKind: 'accessibility',
      category: 'accessibility',
      title: `${label} — accessibility`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  if (hasName) {
    push({
      kind: 'accessible-name',
      scenarioKind: 'accessibility',
      category: 'accessibility',
      title: `${label} — accessibility accessible name present`,
      targetUrl: pageUrl,
      status: 'PLANNED',
      purpose,
      action: 'observe',
      targetElementId: element.elementId,
      screenId,
      expect: {
        locator: gated.locator,
        accessibleName: element.accessibleName ?? element.label,
        control,
      },
    });
  }

  if (element.interactive || hasRoleEvidence) {
    push({
      kind: 'keyboard-focus',
      scenarioKind: 'accessibility',
      category: 'accessibility',
      title: `${label} — accessibility keyboard-focusability`,
      targetUrl: pageUrl,
      status: 'PLANNED',
      purpose,
      action: 'observe',
      targetElementId: element.elementId,
      screenId,
      expect: { locator: gated.locator, control },
    });
  } else if (!hasName) {
    push({
      kind: 'accessible-name',
      scenarioKind: 'accessibility',
      category: 'accessibility',
      title: `${label} — accessibility`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      screenId,
      reason: 'NOT_APPLICABLE: accessibility facts not in discovery evidence',
    });
  }
}

function planUsability(input: {
  push: (args: PushArgs) => void;
  label: string;
  pageUrl: string;
  element: UiElementRecord;
  purpose: ElementPurpose;
  control: ControlKind;
  gated: ReturnType<typeof gateLocator>;
  screenId?: string;
}): void {
  const { push, label, pageUrl, element, purpose, control, gated, screenId } = input;
  const name = (element.accessibleName ?? element.label ?? '').trim();

  if (!name) {
    push({
      kind: 'accessible-name',
      scenarioKind: 'usability',
      category: 'usability',
      title: `${label} — usability`,
      targetUrl: pageUrl,
      status: 'NOT_APPLICABLE',
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      screenId,
      reason: 'NOT_APPLICABLE: no label or accessible name to assess usability',
    });
    return;
  }

  if (!gated.ok) {
    push({
      kind: 'accessible-name',
      scenarioKind: 'usability',
      category: 'usability',
      title: `${label} — usability`,
      targetUrl: pageUrl,
      status: gated.status,
      purpose,
      action: 'none',
      targetElementId: element.elementId,
      reason: gated.reason,
      screenId,
    });
    return;
  }

  push({
    kind: 'accessible-name',
    scenarioKind: 'usability',
    category: 'usability',
    title: `${label} — usability label/name visibility`,
    targetUrl: pageUrl,
    status: 'PLANNED',
    purpose,
    action: 'observe',
    targetElementId: element.elementId,
    screenId,
    expect: {
      locator: gated.locator,
      accessibleName: name,
      visible: true,
      control,
    },
  });
}

export {
  applicableCategories,
  formatExcludedCategories,
  hasBoundaryConstraint,
  hasValidationConstraint,
  scenarioKindForCategory,
  APPLICABLE_CATEGORIES,
} from './applicability';
export type { ApplicableCategory, CategoryApplicability, CategoryDecision } from './applicability';
