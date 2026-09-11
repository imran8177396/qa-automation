export type CheckStatus = 'PLANNED' | 'BLOCKED' | 'NOT_TESTED' | 'REQUIRES_CONFIGURATION';

export type CheckKind =
  | 'page-sanity'
  | 'broken-link'
  | 'form-presence'
  | 'form-boundary'
  | 'visibility'
  | 'enabled-state'
  | 'editability'
  | 'required-state'
  | 'required-validation'
  | 'accessible-name'
  | 'valid-input'
  | 'invalid-input'
  | 'empty-input'
  | 'whitespace-input'
  | 'long-input'
  | 'unicode-input'
  | 'special-characters'
  | 'validation-state'
  | 'error-recovery'
  | 'boundary-values'
  | 'click-behavior'
  | 'click-link'
  | 'click-button'
  | 'link-href'
  | 'navigation'
  | 'select-options'
  | 'select-change'
  | 'toggle-state'
  | 'form-submit';

export type ControlKind = 'text' | 'select' | 'checkbox' | 'radio' | 'link' | 'button' | 'component';

export interface PlannedCheck {
  id: string;
  kind: CheckKind;
  title: string;
  targetUrl: string;
  targetElementId?: string;
  status: CheckStatus;
  /** Present when status !== 'PLANNED'. Prefixed with the status, e.g. "BLOCKED: ...". */
  reason?: string;
  expect?: {
    requireH1?: boolean;
    locator?: string;
    visible?: boolean;
    enabled?: boolean;
    required?: boolean;
    boundary?: boolean;
    href?: string;
    accessibleName?: string | null;
    fillValue?: string;
    recoveryValue?: string;
    control?: ControlKind;
    readOnly?: boolean;
    min?: string;
    max?: string;
  };
}
