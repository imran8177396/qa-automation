import type { FieldHint } from '../coverage/scenarios';

export interface SampleValues {
  valid: string;
  invalid?: string;
  special: string;
  unicode: string;
  whitespace: string;
  long: string;
}

export function sampleValues(hint: FieldHint): SampleValues {
  const special = '!@#$%^&*()<>[]{}';
  const unicode = '测试 café 🎉';
  const whitespace = '   ';
  const long = 'A'.repeat(512);

  switch (hint) {
    case 'email':
      return { valid: 'qa.field@example.com', invalid: 'not-an-email', special, unicode, whitespace, long };
    case 'number':
      return { valid: '1', invalid: 'abc', special, unicode, whitespace, long };
    case 'tel':
      return { valid: '5551234567', invalid: 'not-a-phone', special, unicode, whitespace, long };
    case 'url':
      return { valid: 'https://example.com', invalid: 'not-a-url', special, unicode, whitespace, long };
    default:
      return { valid: 'Sample text', special, unicode, whitespace, long };
  }
}

export function boundaryValues(min?: string | null, max?: string | null): string[] {
  const values: string[] = [];
  if (min != null && min !== '') values.push(min);
  if (max != null && max !== '') values.push(max);
  return values;
}
