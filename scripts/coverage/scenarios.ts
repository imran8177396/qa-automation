import type { DiscoveryCategory } from '../discovery/categories';
import type { AssignedScenario, InventoryKind, ScenarioDisposition, ScenarioId } from './types';

export interface ScenarioContext {
  kind: InventoryKind;
  elementType?: string;
  required?: boolean;
  isSubmit?: boolean;
  interactive?: boolean;
  visible?: boolean;
  href?: string | null;
  locator?: string | null;
  pageStatus?: number | null;
  workflowKind?: string;
  workflowStatus?: string;
  evidence?: string;
  inputHint?: FieldHint;
  readOnly?: boolean;
  min?: string | null;
  max?: string | null;
  minLength?: string | null;
  maxLength?: string | null;
}

export type FieldHint = 'text' | 'email' | 'number' | 'tel' | 'url' | 'password' | 'date' | 'other';

function scenario(id: ScenarioId, disposition: ScenarioDisposition, reason: string): AssignedScenario {
  return { id, disposition, reason, tested: false, evidenceIds: [] };
}

export function inferFieldHint(input: {
  elementType?: string;
  locator?: string | null;
  name?: string | null;
  evidence?: string;
}): FieldHint {
  const blob = `${input.elementType ?? ''} ${input.locator ?? ''} ${input.name ?? ''} ${input.evidence ?? ''}`.toLowerCase();
  if (blob.includes('password')) return 'password';
  if (blob.includes('email')) return 'email';
  if (blob.includes('number') || blob.includes('type=number')) return 'number';
  if (blob.includes('tel') || blob.includes('phone')) return 'tel';
  if (blob.includes('url') || blob.includes('type=url')) return 'url';
  if (blob.includes('date') || blob.includes('time')) return 'date';
  if (input.elementType === 'textarea' || input.elementType === 'search' || input.elementType === 'input') {
    return 'text';
  }
  return 'other';
}

const UI_COMPONENT_TYPES = new Set<DiscoveryCategory>([
  'header',
  'footer',
  'sidebar',
  'breadcrumbs',
  'pagination',
  'tab',
  'accordion',
  'modal',
  'popup',
  'tooltip',
  'image',
  'video',
  'filter',
  'sort',
  'navigation',
]);

export function kindForElement(elementType: DiscoveryCategory): InventoryKind | null {
  if (elementType === 'form') return 'form';
  if (elementType === 'button') return 'button';
  if (elementType === 'link') return 'link';
  if (elementType === 'select') return 'dropdown';
  if (elementType === 'checkbox') return 'checkbox';
  if (elementType === 'radio') return 'radio';
  if (elementType === 'toggle') return 'toggle';
  if (elementType === 'table') return 'table';
  if (
    elementType === 'input' ||
    elementType === 'textarea' ||
    elementType === 'file-upload' ||
    elementType === 'search'
  ) {
    return 'field';
  }
  if (UI_COMPONENT_TYPES.has(elementType)) return 'ui-component';
  return null;
}

/**
 * Applicable scenarios only. Loading/success/error states, unconstrained boundary matrices,
 * and generic "invalid input" for free-text fields are not assigned — there is no evidence
 * those states or rules exist.
 */
export function applicableScenarios(ctx: ScenarioContext): AssignedScenario[] {
  switch (ctx.kind) {
    case 'page':
    case 'route':
      if (ctx.pageStatus != null && ctx.pageStatus >= 400) {
        return [scenario('broken-link', 'executable', 'Page returned a client/server error during discovery')];
      }
      return [scenario('page-load', 'executable', 'Discovered page/route should load')];

    case 'navigation':
    case 'link':
      return [
        scenario('visibility', 'executable', 'Link is present in the rendered DOM'),
        scenario('accessible-name', 'executable', 'Link text or aria-label can be asserted'),
        scenario('broken-link', 'executable', 'Href can be requested without changing application state'),
        scenario('navigation', 'executable', 'In-scope navigation target was observed'),
      ];

    case 'button':
      return buttonScenarios(ctx);

    case 'field':
      return fieldScenarios(ctx);

    case 'dropdown':
      return fieldScenarios({ ...ctx, elementType: ctx.elementType ?? 'select' });

    case 'checkbox':
      return fieldScenarios({ ...ctx, elementType: 'checkbox' });

    case 'radio':
      return fieldScenarios({ ...ctx, elementType: 'radio' });

    case 'toggle':
      return fieldScenarios({ ...ctx, elementType: 'toggle' });

    case 'table':
      return [scenario('visibility', 'executable', 'Table markup was observed')];

    case 'form':
      return formScenarios();

    case 'ui-component':
      if (ctx.elementType === 'filter' || ctx.elementType === 'sort') {
        return [
          scenario(
            'click-behavior',
            'requires-configuration',
            'Filter/sort behavior cannot be inferred from accessible name alone'
          ),
        ];
      }
      if (ctx.elementType === 'image') {
        return [scenario('visibility', 'executable', 'Image element was observed')];
      }
      return [scenario('visibility', 'executable', 'Landmark or chrome component was observed')];

    case 'workflow':
      return workflowScenarios(ctx);

    case 'api':
      if (ctx.workflowKind === 'auth') {
        return [
          scenario(
            'api-auth',
            'requires-configuration',
            'No authentication or authorization contract is documented for the configured API — set postman.auth and QA_API_TOKEN only when the target documents them'
          ),
        ];
      }
      return [
        scenario(
          'api-smoke',
          'executable',
          'Documented in qa.config.json or observed during discovery (Postman CLI) — not an invented endpoint'
        ),
      ];

    case 'browser':
      return [
        scenario(
          'browser-execution',
          'executable',
          'Playwright engine configured in qa.config.json — not iOS Safari or Android Chrome unless a real-device target actually ran'
        ),
      ];

    case 'viewport':
      return [
        scenario(
          'viewport-matrix',
          'executable',
          'Playwright Chromium emulated viewports for desktop/laptop/tablet/mobile — not a real device or Mobile Safari coverage'
        ),
      ];

    case 'accessibility':
      return [
        scenario(
          'accessibility-scan',
          'executable',
          'Automated axe-core + keyboard/structure/form/zoom checks (npm run test:accessibility) — not a complete manual WCAG audit'
        ),
      ];

    case 'visual':
      return [
        scenario(
          'visual-regression',
          'executable',
          'Playwright screenshot comparison against committed baselines (npm run test:visual)'
        ),
      ];

    case 'security':
      return [
        scenario(
          'security-baseline',
          'executable',
          'QA-level security validation (HTTPS, headers, cookies, exposure indicators). Not a penetration test'
        ),
      ];

    case 'seo':
      return [
        scenario(
          'seo-baseline',
          'executable',
          'Automated technical SEO (title/meta/canonical/OG/robots/sitemap/alt/URL/404/redirect). Not a ranking audit'
        ),
      ];

    case 'content':
      return [
        scenario(
          'content-baseline',
          'executable',
          'Structural content QA (headings, empty sections, placeholders, broken assets). Not factual verification of business claims'
        ),
      ];

    case 'performance':
      if (ctx.workflowKind === 'heavy') {
        return [
          scenario(
            'performance-profile',
            'requires-configuration',
            'Heavy JMeter profile (load/stress/spike/soak) requires --authorize-heavy and a loopback or allowlisted host — not a CI default'
          ),
        ];
      }
      return [
        scenario(
          'performance-profile',
          'executable',
          'Lightweight JMeter liveness (npm run test:performance). Status is RECORDED, never PASS. Threshold keys stay NOT_AVAILABLE until qa.config.json sets numeric SLAs'
        ),
      ];

    default:
      return [];
  }
}

function buttonScenarios(ctx: ScenarioContext): AssignedScenario[] {
  const out: AssignedScenario[] = [
    scenario('visibility', 'executable', 'Button was observed in the DOM'),
    scenario('accessible-name', 'executable', 'Accessible name can be asserted'),
    scenario('enabled-state', 'executable', 'Enabled/disabled can be asserted from the inventoried state'),
  ];

  if (ctx.isSubmit) {
    out.push(
      scenario('form-submit', 'blocked-safety', 'Submit / state-changing click is not authorized'),
      scenario(
        'click-behavior',
        'blocked-safety',
        'Click / duplicate-click / modal / loading / success / error require a submit — not authorized'
      ),
      scenario(
        'navigation',
        'blocked-safety',
        'Navigation after Login/submit is a state-changing action — not authorized'
      )
    );
    return out;
  }

  out.push(scenario('click-behavior', 'executable', 'Non-submit button can be clicked without a form submit'));
  if (ctx.href) {
    out.push(scenario('navigation', 'executable', 'Button carries a navigation href'));
  }
  return out;
}

function fieldScenarios(ctx: ScenarioContext): AssignedScenario[] {
  const type = ctx.elementType ?? 'input';
  const hint = ctx.inputHint ?? 'text';
  const out: AssignedScenario[] = [
    scenario('visibility', 'executable', 'Field was observed'),
    scenario('enabled-state', 'executable', 'Enabled/disabled can be asserted from the inventoried state'),
    scenario('editability', 'executable', 'Read-only vs editable can be asserted from the inventoried state'),
    scenario('required-state', 'executable', 'Required vs optional can be asserted from the inventoried required flag'),
    scenario('form-presence', 'executable', 'Field presence can be checked without submit'),
  ];

  if (type === 'file-upload') {
    out.push(
      scenario(
        'valid-input',
        'blocked-safety',
        'File attach is not authorized automatically'
      )
    );
    return out;
  }

  if (type === 'checkbox' || type === 'radio' || type === 'toggle') {
    out.push(scenario('valid-input', 'executable', 'Toggle/select the control without submitting'));
    if (ctx.required) {
      out.push(scenario('required-validation', 'executable', 'Required flag was observed — leave unset and blur'));
    }
    return out;
  }

  if (type === 'select') {
    out.push(scenario('valid-input', 'executable', 'Change the selected option without submitting'));
    if (ctx.required) {
      out.push(scenario('empty-input', 'executable', 'Required select — clear/leave default and blur'));
      out.push(scenario('required-validation', 'executable', 'Required flag was observed'));
    }
    return out;
  }

  if (hint === 'date') {
    out.push(
      scenario(
        'valid-input',
        'requires-configuration',
        'Date/time control interaction is not inferred without a documented format'
      )
    );
    return out;
  }

  if (ctx.readOnly) {
    return out;
  }

  out.push(scenario('valid-input', 'executable', 'Fill a representative valid value without submitting'));
  out.push(scenario('empty-input', 'executable', 'Clear the field and blur — no submit'));

  if (hint === 'email' || hint === 'number' || hint === 'tel' || hint === 'url') {
    out.push(
      scenario('invalid-input', 'executable', `Format can be inferred for ${hint} — invalid value + blur, no submit`)
    );
    out.push(scenario('validation-state', 'executable', 'HTML5 validity can be read after blur — message text is not invented'));
    out.push(scenario('error-recovery', 'executable', 'Invalid then valid fill, no submit'));
  } else if (hint === 'text' || hint === 'password') {
    out.push(
      scenario(
        'invalid-input',
        'executable',
        'Fill an atypical value without submit — do not assert a validation message unless a client-side constraint exists'
      )
    );
    out.push(
      scenario(
        'validation-state',
        'blocked-safety',
        'Validation message / constraint failure is not observable without submit on this control type'
      )
    );
    out.push(
      scenario(
        'error-recovery',
        'blocked-safety',
        'Error recovery after an invalid submit is not authorized — generated checks do not submit'
      )
    );
  }

  if (ctx.required) {
    out.push(scenario('required-validation', 'executable', 'Required flag was observed'));
  }

  if (hint === 'text' || hint === 'password') {
    out.push(scenario('whitespace-input', 'executable', 'Whitespace-only fill without submit'));
    out.push(scenario('long-input', 'executable', 'Long string fill without submit'));
    out.push(scenario('unicode-input', 'executable', 'Unicode fill without submit'));
    out.push(scenario('special-characters', 'executable', 'Special-character fill without submit'));
  }

  if (ctx.min || ctx.max || ctx.minLength || ctx.maxLength) {
    out.push(scenario('boundary-values', 'executable', 'min/max/length constraint was observed on the control'));
  } else if (hint === 'text' || hint === 'password') {
    out.push(
      scenario(
        'boundary-values',
        'not-implemented',
        'No min/max/length constraint was observed — boundary values are not invented'
      )
    );
  }

  return out;
}

function formScenarios(): AssignedScenario[] {
  return [
    scenario('form-presence', 'executable', 'Form markup was observed'),
    scenario(
      'form-submit',
      'blocked-safety',
      'Valid / empty / missing / invalid / boundary / server-error / success / duplicate / reset / cancel submission is not authorized'
    ),
    scenario('empty-input', 'blocked-safety', 'Empty / missing-field submission requires submit — not authorized'),
    scenario('invalid-input', 'blocked-safety', 'Invalid submission requires submit — not authorized'),
    scenario('boundary-values', 'blocked-safety', 'Boundary submission requires submit — not authorized'),
    scenario(
      'error-recovery',
      'blocked-safety',
      'Server-error / success after submit is not authorized'
    ),
    scenario(
      'click-behavior',
      'blocked-safety',
      'Duplicate / reset / cancel submission is not authorized'
    ),
  ];
}

function workflowScenarios(ctx: ScenarioContext): AssignedScenario[] {
  if (ctx.workflowKind === 'form-submit' || ctx.workflowStatus === 'NOT_TESTED') {
    return [
      scenario(
        'form-submit',
        'blocked-safety',
        ctx.workflowStatus === 'NOT_TESTED'
          ? 'Workflow is recorded as NOT_TESTED — submit is blocked by the safety policy'
          : 'Form submit workflow is not authorized'
      ),
    ];
  }
  if (ctx.workflowKind === 'authentication' || ctx.workflowStatus === 'REQUIRES_CONFIGURATION') {
    return [
      scenario(
        'valid-input',
        'requires-configuration',
        'Authentication credentials are not assumed'
      ),
    ];
  }
  if (ctx.workflowKind === 'api') {
    return [scenario('api-smoke', 'requires-configuration', 'Observed network calls are not an executable API contract')];
  }
  if (ctx.workflowKind === 'ui-api') {
    return [
      scenario(
        'ui-api-correlation',
        'executable',
        'Hand-written combined workflow: UI action plus the documented API it triggers — not a duplicate of every UI or Postman test'
      ),
    ];
  }
  return [scenario('navigation', 'executable', 'In-scope navigation workflow was inferred from observed links')];
}
