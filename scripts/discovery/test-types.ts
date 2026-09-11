import type { DiscoveryCategory } from './categories';

export type ApplicableTestType =
  | 'page-sanity'
  | 'broken-link'
  | 'form-presence'
  | 'form-boundary'
  | 'seo-alt'
  | 'visibility'
  | 'REQUIRES_CONFIGURATION'
  | 'NOT_TESTED';

/**
 * Test types are chosen from evidence, not a single default matrix.
 * Submit / state-changing actions are never assigned an executable type.
 */
export function applicableTestTypes(
  category: DiscoveryCategory,
  flags: { required?: boolean; isSubmit?: boolean; interactive?: boolean } = {}
): ApplicableTestType[] {
  switch (category) {
    case 'pages':
    case 'routes':
      return ['page-sanity'];
    case 'navigation':
    case 'link':
      return ['broken-link', 'page-sanity'];
    case 'button':
      return flags.isSubmit ? ['REQUIRES_CONFIGURATION'] : ['form-presence'];
    case 'input':
    case 'textarea':
    case 'select':
    case 'checkbox':
    case 'radio':
    case 'toggle':
    case 'search':
      return flags.required ? ['form-presence', 'form-boundary'] : ['form-presence'];
    case 'file-upload':
    case 'form':
      return ['form-presence'];
    case 'header':
    case 'footer':
    case 'sidebar':
    case 'breadcrumbs':
    case 'table':
    case 'pagination':
    case 'tab':
    case 'accordion':
    case 'modal':
    case 'popup':
    case 'tooltip':
    case 'video':
    case 'interactive':
      return flags.interactive ? ['visibility', 'form-presence'] : ['visibility'];
    case 'image':
      return ['seo-alt', 'visibility'];
    case 'filter':
    case 'sort':
      return ['REQUIRES_CONFIGURATION'];
    case 'authentication':
    case 'workflow':
      return ['REQUIRES_CONFIGURATION'];
    case 'api':
      return ['NOT_TESTED'];
    default:
      return ['NOT_TESTED'];
  }
}

export function potentialAction(
  category: DiscoveryCategory,
  flags: { isSubmit?: boolean; href?: string | null } = {}
): string {
  switch (category) {
    case 'link':
    case 'navigation':
      return flags.href ? `navigate to ${flags.href}` : 'navigate';
    case 'button':
      return flags.isSubmit
        ? 'submit form (not authorized for automatic execution)'
        : 'click (presence only unless explicitly configured)';
    case 'input':
    case 'textarea':
    case 'select':
    case 'search':
      return 'fill / change (no submit)';
    case 'checkbox':
    case 'radio':
    case 'toggle':
      return 'toggle state (no submit)';
    case 'file-upload':
      return 'attach file (not authorized automatically)';
    case 'form':
      return 'submit (NOT_TESTED — safety policy)';
    case 'authentication':
      return 'authenticate (REQUIRES_CONFIGURATION — credentials not assumed)';
    case 'api':
      return 'observe only';
    default:
      return 'observe';
  }
}
