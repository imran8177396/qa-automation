/**
 * Discovery-driven dynamic subcases for the existing planner.
 * Consumed only by buildScenarioInventory → planDynamicForScreen — not a second planner.
 *
 * Adapts to the actual screen: file upload, pagination, and search+filter rows are emitted
 * only when those controls were discovered. Never invents page counts or filters.
 * Never writes file bytes. Never submits. Never marks unexecuted cases PASS.
 */

import { FIELD_FIXTURES } from './field-cases';
import { POSITIVE_FIXTURES } from './positive-cases';
import type {
  CheckKind,
  CheckStatus,
  PlannedAction,
  PlannedCheck,
} from './types';

const FILE_BYTES_NOTE = 'file bytes are not written';
const PAGINATION_NOT_EXECUTED =
  'pagination control was discovered; page behavior was not executed';
const NO_RESULTS_REASON = 'no-results behavior was not in discovery evidence';
const NO_SEARCH_FIXTURE = 'no search fixture';
const NO_ACCEPT_REASON = 'no accept list discovered';
const SINGLE_PAGE_RECORDED = 'page count 1 was recorded';
const SINGLE_NO_NEXT_PREV = 'single page has no next or previous';
const LARGE_NOT_GENERATED = 'very large file is not generated';
const EMPTY_BYTES_NOT_WRITTEN = 'empty file bytes are not written';
const CORRUPT_NOT_GENERATED = 'corrupted file bytes are not generated';

/** Field-cases file subcase ids that already cover the same purpose as dynamic file rows. */
const FIELD_FILE_DELEGATES: ReadonlyArray<{
  fieldId: string;
  dynamicId: DynamicSubcaseId;
}> = [
  { fieldId: 'field-file-valid', dynamicId: 'dynamic-file-valid' },
  { fieldId: 'field-file-unsupported', dynamicId: 'dynamic-file-invalid-extension' },
  { fieldId: 'field-file-empty', dynamicId: 'dynamic-file-empty' },
  { fieldId: 'field-file-very-large', dynamicId: 'dynamic-file-large' },
  { fieldId: 'field-file-corrupted', dynamicId: 'dynamic-file-corrupt' },
];

export type DynamicSubcaseId =
  | 'dynamic-file-valid'
  | 'dynamic-file-invalid-extension'
  | 'dynamic-file-large'
  | 'dynamic-file-empty'
  | 'dynamic-file-corrupt'
  | 'dynamic-page-first'
  | 'dynamic-page-next'
  | 'dynamic-page-previous'
  | 'dynamic-page-last'
  | 'dynamic-page-single'
  | 'dynamic-page-empty-result'
  | 'dynamic-page-large-dataset'
  | 'dynamic-search-only'
  | 'dynamic-filter-only'
  | 'dynamic-search-and-filter'
  | 'dynamic-clear-search'
  | 'dynamic-clear-filter'
  | 'dynamic-no-results';

export interface DynamicElementInput {
  elementId: string;
  /** elementKind / elementType from discovery (e.g. file-upload, pagination, search-field). */
  type?: string;
  /** Category from discovery (e.g. file-upload, search). */
  category?: string;
  accessibleName?: string | null;
  /** Optional accept attribute for file inputs — never invented. */
  accept?: string | null;
  /** Optional ARIA role when already stored on the element. */
  role?: string | null;
}

/**
 * Optional pagination evidence from the caller — never invented by this module.
 * Omit on default discovery so page behavior rows stay NOT_TESTED.
 */
export interface DynamicPaginationEvidence {
  pageCount?: number;
  currentPage?: number;
  /** True only when the caller recorded an empty result set. */
  empty?: boolean;
}

export interface DynamicSubcasePlan {
  subcaseId: DynamicSubcaseId;
  kind: CheckKind;
  title: string;
  status: CheckStatus;
  action: PlannedAction;
  reason?: string;
  expect?: PlannedCheck['expect'];
  targetElementId?: string;
}

export interface BuildDynamicCasesInput {
  screenId: string;
  elements: DynamicElementInput[];
  /**
   * Subcase ids already planned for this screen (e.g. field-file-valid).
   * When present, matching dynamic-file-* rows are skipped — field-cases is the file source.
   */
  existingSubcaseIds?: ReadonlySet<string> | readonly string[] | null;
  /** Caller-supplied pagination evidence only — never invent page counts. */
  evidence?: DynamicPaginationEvidence | null;
}

function statusReason(status: CheckStatus, detail: string): string {
  const trimmed = detail.trim().replace(
    /^(NOT_TESTED|PLANNED|BLOCKED|NOT_APPLICABLE|REQUIRES_CONFIGURATION):\s*/i,
    ''
  );
  return `${status}: ${trimmed}`;
}

function hasExistingSubcase(
  existing: BuildDynamicCasesInput['existingSubcaseIds'],
  subcaseId: string
): boolean {
  if (!existing) return false;
  const list = existing instanceof Set ? [...existing] : [...existing];
  return list.some(
    (id) =>
      id === subcaseId ||
      id.endsWith(`-${subcaseId}`) ||
      id.endsWith(subcaseId)
  );
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isFileUpload(el: DynamicElementInput): boolean {
  const type = norm(el.type);
  const category = norm(el.category);
  return type === 'file-upload' || category === 'file-upload' || type === 'file';
}

function isPagination(el: DynamicElementInput): boolean {
  const type = norm(el.type);
  const category = norm(el.category);
  if (type === 'pagination' || category === 'pagination') return true;
  const name = el.accessibleName ?? '';
  if (/pagination|pager/i.test(name)) return true;
  const role = el.role ?? '';
  return /pagination|pager/i.test(role);
}

function isSearchField(el: DynamicElementInput): boolean {
  const type = norm(el.type);
  const category = norm(el.category);
  return type === 'search-field' || category === 'search' || type === 'search';
}

function isFilterControl(el: DynamicElementInput, searchIds: Set<string>): boolean {
  if (searchIds.has(el.elementId)) return false;
  const type = norm(el.type);
  if (/filter/i.test(type)) return true;
  const name = el.accessibleName ?? '';
  return /filter/i.test(name);
}

function acceptAllowsUnsupported(accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return !tokens.some(
    (t) =>
      t === '.unsupported' ||
      t === 'unsupported' ||
      t.includes('unsupported') ||
      t === '*/*' ||
      t === '.*'
  );
}

function skippedFileIds(
  existing: BuildDynamicCasesInput['existingSubcaseIds']
): Set<DynamicSubcaseId> {
  const skip = new Set<DynamicSubcaseId>();
  for (const row of FIELD_FILE_DELEGATES) {
    if (hasExistingSubcase(existing, row.fieldId)) {
      skip.add(row.dynamicId);
    }
  }
  return skip;
}

function buildFilePlans(
  screenId: string,
  fileElements: DynamicElementInput[],
  existing: BuildDynamicCasesInput['existingSubcaseIds']
): DynamicSubcasePlan[] {
  if (fileElements.length === 0) return [];
  const skip = skippedFileIds(existing);
  const plans: DynamicSubcasePlan[] = [];

  for (const el of fileElements) {
    const accept = el.accept != null && el.accept !== '' ? el.accept : undefined;
    const label = `${screenId} ${el.elementId}`;

    if (!skip.has('dynamic-file-valid')) {
      plans.push({
        subcaseId: 'dynamic-file-valid',
        kind: 'valid-input',
        title: `${label} — dynamic-file-valid`,
        status: 'PLANNED',
        action: 'observe',
        reason: 'metadata-only file fixture; form is not submitted',
        targetElementId: el.elementId,
        expect: {
          fillValue: FIELD_FIXTURES.fileValid,
          inputType: 'file',
          note: FILE_BYTES_NOTE,
        },
      });
    }

    if (!skip.has('dynamic-file-invalid-extension')) {
      if (accept && acceptAllowsUnsupported(accept)) {
        plans.push({
          subcaseId: 'dynamic-file-invalid-extension',
          kind: 'invalid-input',
          title: `${label} — dynamic-file-invalid-extension`,
          status: 'PLANNED',
          action: 'observe',
          reason: 'metadata-only unsupported extension; form is not submitted',
          targetElementId: el.elementId,
          expect: {
            fillValue: FIELD_FIXTURES.fileUnsupported,
            inputType: 'file',
            note: FILE_BYTES_NOTE,
          },
        });
      } else if (!accept) {
        plans.push({
          subcaseId: 'dynamic-file-invalid-extension',
          kind: 'invalid-input',
          title: `${label} — dynamic-file-invalid-extension`,
          status: 'NOT_TESTED',
          action: 'none',
          reason: statusReason('NOT_TESTED', NO_ACCEPT_REASON),
          targetElementId: el.elementId,
        });
      }
      // accept list present but includes unsupported token — skip (same posture as field-cases)
    }

    if (!skip.has('dynamic-file-large')) {
      plans.push({
        subcaseId: 'dynamic-file-large',
        kind: 'invalid-input',
        title: `${label} — dynamic-file-large`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', LARGE_NOT_GENERATED),
        targetElementId: el.elementId,
      });
    }

    if (!skip.has('dynamic-file-empty')) {
      plans.push({
        subcaseId: 'dynamic-file-empty',
        kind: 'empty-input',
        title: `${label} — dynamic-file-empty`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', EMPTY_BYTES_NOT_WRITTEN),
        targetElementId: el.elementId,
      });
    }

    if (!skip.has('dynamic-file-corrupt')) {
      plans.push({
        subcaseId: 'dynamic-file-corrupt',
        kind: 'invalid-input',
        title: `${label} — dynamic-file-corrupt`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', CORRUPT_NOT_GENERATED),
        targetElementId: el.elementId,
      });
    }
  }

  return plans;
}

function buildPaginationPlans(
  screenId: string,
  paginationElements: DynamicElementInput[],
  evidence: DynamicPaginationEvidence | null | undefined
): DynamicSubcasePlan[] {
  if (paginationElements.length === 0) return [];
  const el = paginationElements[0]!;
  const label = `${screenId} ${el.elementId}`;
  const pageCount =
    evidence?.pageCount != null && Number.isFinite(evidence.pageCount)
      ? evidence.pageCount
      : undefined;
  const empty = evidence?.empty === true;
  const singlePage = pageCount === 1;
  const largeDataset = pageCount != null && pageCount > 1;

  const notExecuted = (subcaseId: DynamicSubcaseId): DynamicSubcasePlan => ({
    subcaseId,
    kind: 'visibility',
    title: `${label} — ${subcaseId}`,
    status: 'NOT_TESTED',
    action: 'none',
    reason: statusReason('NOT_TESTED', PAGINATION_NOT_EXECUTED),
    targetElementId: el.elementId,
  });

  const plans: DynamicSubcasePlan[] = [];

  // first / last — stay NOT_TESTED unless page behavior was executed (never invented)
  plans.push(notExecuted('dynamic-page-first'));
  if (singlePage) {
    plans.push({
      subcaseId: 'dynamic-page-next',
      kind: 'visibility',
      title: `${label} — dynamic-page-next`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      reason: statusReason('NOT_APPLICABLE', SINGLE_NO_NEXT_PREV),
      targetElementId: el.elementId,
    });
    plans.push({
      subcaseId: 'dynamic-page-previous',
      kind: 'visibility',
      title: `${label} — dynamic-page-previous`,
      status: 'NOT_APPLICABLE',
      action: 'none',
      reason: statusReason('NOT_APPLICABLE', SINGLE_NO_NEXT_PREV),
      targetElementId: el.elementId,
    });
  } else {
    plans.push(notExecuted('dynamic-page-next'));
    plans.push(notExecuted('dynamic-page-previous'));
  }
  plans.push(notExecuted('dynamic-page-last'));

  if (singlePage) {
    plans.push({
      subcaseId: 'dynamic-page-single',
      kind: 'visibility',
      title: `${label} — dynamic-page-single`,
      status: 'PLANNED',
      action: 'observe',
      reason: SINGLE_PAGE_RECORDED,
      targetElementId: el.elementId,
      expect: {
        note: SINGLE_PAGE_RECORDED,
      },
    });
  } else {
    plans.push(notExecuted('dynamic-page-single'));
  }

  if (empty) {
    plans.push({
      subcaseId: 'dynamic-page-empty-result',
      kind: 'visibility',
      title: `${label} — dynamic-page-empty-result`,
      status: 'PLANNED',
      action: 'observe',
      reason: 'empty result set was recorded in discovery evidence',
      targetElementId: el.elementId,
      expect: { note: 'empty result set was recorded in discovery evidence' },
    });
  } else {
    plans.push(notExecuted('dynamic-page-empty-result'));
  }

  if (largeDataset) {
    plans.push({
      subcaseId: 'dynamic-page-large-dataset',
      kind: 'visibility',
      title: `${label} — dynamic-page-large-dataset`,
      status: 'PLANNED',
      action: 'observe',
      reason: `page count ${pageCount} was recorded in discovery evidence`,
      targetElementId: el.elementId,
      expect: {
        note: `page count ${pageCount} was recorded in discovery evidence`,
      },
    });
  } else {
    plans.push(notExecuted('dynamic-page-large-dataset'));
  }

  return plans;
}

function buildSearchFilterPlans(
  screenId: string,
  searchElements: DynamicElementInput[],
  filterElements: DynamicElementInput[]
): DynamicSubcasePlan[] {
  const hasSearch = searchElements.length > 0;
  const hasFilter = filterElements.length > 0;
  if (!hasSearch && !hasFilter) return [];

  const search = searchElements[0];
  const filter = filterElements[0];
  const searchId = search?.elementId;
  const filterId = filter?.elementId;
  const plans: DynamicSubcasePlan[] = [];
  const fillValue = POSITIVE_FIXTURES.textValid;

  const observeFill = (
    subcaseId: DynamicSubcaseId,
    titleSuffix: string,
    targetElementId: string | undefined,
    note: string,
    relatedIds: string[]
  ): DynamicSubcasePlan => {
    if (!fillValue) {
      return {
        subcaseId,
        kind: 'valid-input',
        title: `${screenId} — ${titleSuffix}`,
        status: 'NOT_TESTED',
        action: 'none',
        reason: statusReason('NOT_TESTED', NO_SEARCH_FIXTURE),
        targetElementId,
      };
    }
    return {
      subcaseId,
      kind: 'valid-input',
      title: `${screenId} — ${titleSuffix}`,
      status: 'PLANNED',
      action: 'fill-no-submit',
      targetElementId,
      expect: {
        fillValue,
        note: `${note}; elements=${relatedIds.join(',')}`,
      },
    };
  };

  if (hasSearch && hasFilter) {
    plans.push(
      observeFill(
        'dynamic-search-only',
        'dynamic-search-only',
        searchId,
        'search only; form is not submitted',
        [searchId!, filterId!]
      )
    );
    plans.push(
      observeFill(
        'dynamic-filter-only',
        'dynamic-filter-only',
        filterId,
        'filter only; form is not submitted',
        [searchId!, filterId!]
      )
    );
    plans.push(
      observeFill(
        'dynamic-search-and-filter',
        'dynamic-search-and-filter',
        searchId,
        'search and filter; form is not submitted',
        [searchId!, filterId!]
      )
    );
    plans.push(
      observeFill(
        'dynamic-clear-search',
        'dynamic-clear-search',
        searchId,
        'clear search (empty fill); form is not submitted',
        [searchId!, filterId!]
      )
    );
    // clear-search uses empty fill when we have a fixture path
    const clearSearch = plans[plans.length - 1]!;
    if (clearSearch.status === 'PLANNED' && clearSearch.expect) {
      clearSearch.expect.fillValue = '';
      clearSearch.kind = 'empty-input';
    }
    plans.push(
      observeFill(
        'dynamic-clear-filter',
        'dynamic-clear-filter',
        filterId,
        'clear filter; form is not submitted',
        [searchId!, filterId!]
      )
    );
    const clearFilter = plans[plans.length - 1]!;
    if (clearFilter.status === 'PLANNED' && clearFilter.expect) {
      clearFilter.expect.fillValue = '';
      clearFilter.kind = 'empty-input';
    }
    plans.push({
      subcaseId: 'dynamic-no-results',
      kind: 'invalid-input',
      title: `${screenId} — dynamic-no-results`,
      status: 'NOT_TESTED',
      action: 'none',
      reason: statusReason('NOT_TESTED', NO_RESULTS_REASON),
      targetElementId: searchId,
    });
    return plans;
  }

  if (hasFilter && !hasSearch) {
    plans.push(
      observeFill(
        'dynamic-filter-only',
        'dynamic-filter-only',
        filterId,
        'filter only; form is not submitted',
        [filterId!]
      )
    );
    plans.push(
      observeFill(
        'dynamic-clear-filter',
        'dynamic-clear-filter',
        filterId,
        'clear filter; form is not submitted',
        [filterId!]
      )
    );
    const clearFilter = plans[plans.length - 1]!;
    if (clearFilter.status === 'PLANNED' && clearFilter.expect) {
      clearFilter.expect.fillValue = '';
      clearFilter.kind = 'empty-input';
    }
    return plans;
  }

  // Search only — no filter rows
  plans.push(
    observeFill(
      'dynamic-search-only',
      'dynamic-search-only',
      searchId,
      'search only; form is not submitted',
      [searchId!]
    )
  );
  plans.push(
    observeFill(
      'dynamic-clear-search',
      'dynamic-clear-search',
      searchId,
      'clear search (empty fill); form is not submitted',
      [searchId!]
    )
  );
  const clearSearch = plans[plans.length - 1]!;
  if (clearSearch.status === 'PLANNED' && clearSearch.expect) {
    clearSearch.expect.fillValue = '';
    clearSearch.kind = 'empty-input';
  }

  return plans;
}

/**
 * Build discovery-driven dynamic plans for one screen.
 * Returns [] when the screen has none of: file upload, pagination, search, or filter.
 * Never PASS. Never writes file bytes. Never invents page counts or filters.
 */
export function buildDynamicCasesForScreen(input: BuildDynamicCasesInput): DynamicSubcasePlan[] {
  const { screenId, elements, existingSubcaseIds, evidence } = input;

  const fileElements = elements.filter(isFileUpload);
  const paginationElements = elements.filter(isPagination);
  const searchElements = elements.filter(isSearchField);
  const searchIds = new Set(searchElements.map((el) => el.elementId));
  const filterElements = elements.filter((el) => isFilterControl(el, searchIds));

  if (
    fileElements.length === 0 &&
    paginationElements.length === 0 &&
    searchElements.length === 0 &&
    filterElements.length === 0
  ) {
    return [];
  }

  return [
    ...buildFilePlans(screenId, fileElements, existingSubcaseIds),
    ...buildPaginationPlans(screenId, paginationElements, evidence),
    ...buildSearchFilterPlans(screenId, searchElements, filterElements),
  ];
}
