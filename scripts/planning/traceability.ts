/**
 * Test-case traceability: Project → Screen → Element → Behavior → Test Type →
 * Test Case → Execution → Result.
 *
 * Pure inventory/plan mapping — never invents element types, expected outcomes,
 * or PASS. Unexecuted cases stay NOT_EXECUTED.
 */

export interface TestCaseTrace {
  projectId: string;
  screenId: string;
  elementId: string | null;
  elementType: string | null;
  behavior: string;
  testType: string;
  testCaseId: string;
  expected: string | null;
  execution: 'NOT_EXECUTED' | 'EXECUTED';
  result: string;
}

export interface TraceScreenInput {
  screenId: string;
  elements?: { elementId: string; type?: string; decorative?: boolean }[];
}

export interface TraceCheckInput {
  id?: string;
  screenId?: string;
  targetElementId?: string;
  elementId?: string;
  scenarioKind?: string;
  subcaseId?: string;
  category?: string;
  status?: string;
  expect?: { note?: string } | null;
  executionResult?: string | null;
}

function resolveProjectId(projectId?: string | null): string {
  if (typeof projectId === 'string' && projectId.trim().length > 0) {
    return projectId.trim();
  }
  return 'default';
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function checkElementId(check: TraceCheckInput): string | null {
  return nonEmpty(check.targetElementId) ?? nonEmpty(check.elementId);
}

function resolveElementType(
  typeByElement: Map<string, string | null> | undefined,
  elementId: string | null
): string | null {
  if (!elementId || !typeByElement) return null;
  if (!typeByElement.has(elementId)) return null;
  return typeByElement.get(elementId) ?? null;
}

function behaviorOf(check: TraceCheckInput): string {
  return nonEmpty(check.category) ?? nonEmpty(check.scenarioKind) ?? 'unspecified';
}

function testTypeOf(check: TraceCheckInput): string {
  return nonEmpty(check.scenarioKind) ?? nonEmpty(check.category) ?? 'unspecified';
}

function testCaseIdOf(check: TraceCheckInput): string {
  return nonEmpty(check.subcaseId) ?? nonEmpty(check.id) ?? 'unspecified';
}

function expectedOf(check: TraceCheckInput): string | null {
  const note = check.expect?.note;
  return nonEmpty(note);
}

function executionOf(check: TraceCheckInput): {
  execution: TestCaseTrace['execution'];
  result: string;
} {
  const executed = nonEmpty(check.executionResult);
  if (executed) {
    return { execution: 'EXECUTED', result: executed };
  }
  return { execution: 'NOT_EXECUTED', result: 'NOT_EXECUTED' };
}

function traceFromCheck(
  projectId: string,
  check: TraceCheckInput,
  screenId: string,
  typeByElement: Map<string, string | null> | undefined
): TestCaseTrace {
  const elementId = checkElementId(check);
  const { execution, result } = executionOf(check);
  return {
    projectId,
    screenId,
    elementId,
    elementType: elementId == null ? null : resolveElementType(typeByElement, elementId),
    behavior: behaviorOf(check),
    testType: testTypeOf(check),
    testCaseId: testCaseIdOf(check),
    expected: expectedOf(check),
    execution,
    result,
  };
}

/**
 * One trace per check with a screenId; gaps for unscoped checks, untested
 * non-decorative elements, and empty screens with no checks.
 */
export function buildTestCaseTraces(input: {
  projectId?: string | null;
  screens: TraceScreenInput[];
  checks: TraceCheckInput[];
}): { traces: TestCaseTrace[]; gaps: TestCaseTrace[] } {
  const projectId = resolveProjectId(input.projectId);
  const traces: TestCaseTrace[] = [];
  const gaps: TestCaseTrace[] = [];

  const typeByScreen = new Map<string, Map<string, string | null>>();
  for (const screen of input.screens) {
    const map = new Map<string, string | null>();
    for (const el of screen.elements ?? []) {
      const id = nonEmpty(el.elementId);
      if (!id) continue;
      map.set(id, nonEmpty(el.type));
    }
    typeByScreen.set(screen.screenId, map);
  }

  const referencedByScreen = new Map<string, Set<string>>();
  const checkCountByScreen = new Map<string, number>();

  for (const check of input.checks) {
    const screenId = nonEmpty(check.screenId);
    if (!screenId) {
      gaps.push(traceFromCheck(projectId, check, 'UNSCOPED', undefined));
      continue;
    }

    const typeMap = typeByScreen.get(screenId);
    traces.push(traceFromCheck(projectId, check, screenId, typeMap));

    checkCountByScreen.set(screenId, (checkCountByScreen.get(screenId) ?? 0) + 1);
    const elId = checkElementId(check);
    if (elId) {
      let set = referencedByScreen.get(screenId);
      if (!set) {
        set = new Set();
        referencedByScreen.set(screenId, set);
      }
      set.add(elId);
    }
  }

  for (const screen of input.screens) {
    const elements = screen.elements ?? [];
    const referenced = referencedByScreen.get(screen.screenId) ?? new Set<string>();
    const checkCount = checkCountByScreen.get(screen.screenId) ?? 0;

    for (const el of elements) {
      if (el.decorative === true) continue;
      const elId = nonEmpty(el.elementId);
      if (!elId) continue;
      if (referenced.has(elId)) continue;
      gaps.push({
        projectId,
        screenId: screen.screenId,
        elementId: elId,
        elementType: nonEmpty(el.type),
        behavior: 'untested-element',
        testType: 'gap',
        testCaseId: 'element-without-case',
        expected: null,
        execution: 'NOT_EXECUTED',
        result: 'NOT_EXECUTED',
      });
    }

    if (elements.length === 0 && checkCount === 0) {
      gaps.push({
        projectId,
        screenId: screen.screenId,
        elementId: null,
        elementType: null,
        behavior: 'untested-element',
        testType: 'gap',
        testCaseId: 'screen-without-case',
        expected: null,
        execution: 'NOT_EXECUTED',
        result: 'NOT_EXECUTED',
      });
    }
  }

  return { traces, gaps };
}

/**
 * Short multiline block for a single trace. Omits ELEMENT / TYPE / EXPECTED
 * when those fields are null. RESULT always uses the result field.
 */
export function renderTestCaseTraceLine(trace: TestCaseTrace): string {
  const lines: string[] = [trace.screenId];
  if (trace.elementId != null && trace.elementId.length > 0) {
    lines.push(trace.elementId);
  }
  if (trace.elementType != null && trace.elementType.length > 0) {
    lines.push(`TYPE=${trace.elementType}`);
  }
  lines.push(`TEST=${trace.testCaseId}`);
  if (trace.expected != null && trace.expected.length > 0) {
    lines.push(`EXPECTED=${trace.expected}`);
  }
  lines.push(`RESULT=${trace.result}`);
  return lines.join('\n');
}
