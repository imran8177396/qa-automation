export type ElementType =
  | 'button'
  | 'link'
  | 'text-input'
  | 'email-input'
  | 'password-input'
  | 'number-input'
  | 'tel-input'
  | 'date-input'
  | 'search-input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file-upload'
  | 'other';

export type RiskLabel = 'safe' | 'caution' | 'destructive' | 'unknown';

export interface ElementRecord {
  page: string;
  elementId: string;
  type: ElementType;
  role: string | null;
  label: string | null;
  href?: string | null;
  formMethod?: string | null;
  isSubmit?: boolean;
  locatorCandidates: string[];
  visible: boolean;
  enabled: boolean;
  required: boolean;
  risk: RiskLabel;
}

export interface InventoryResult {
  generatedAt: string;
  pages: number;
  elements: ElementRecord[];
}
