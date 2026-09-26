/**
 * Pure negative-case generators for contract / form engines.
 * Data-only — no I/O. Importable by future UI/form engines.
 */

export interface NegativeFieldSpec {
  name: string;
  type?: string;
  enumValues?: string[];
  minLength?: number;
  maxLength?: number;
  format?: string;
}

export type NegativeCaseKind =
  | 'missing'
  | 'null'
  | 'empty'
  | 'wrong-type'
  | 'invalid-enum'
  | 'invalid-format'
  | 'too-long'
  | 'too-short'
  | 'duplicate'
  | 'unauthorized'
  | 'forbidden'
  | 'malformed-json'
  | 'unexpected-field';

export interface NegativeCase {
  id: string;
  description: string;
  value: unknown;
  kind?: NegativeCaseKind;
}

function wrongTypeValue(type?: string): unknown {
  switch ((type ?? 'string').toLowerCase()) {
    case 'number':
    case 'integer':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return {};
    case 'object':
      return [];
    case 'string':
    default:
      return 12345;
  }
}

function invalidFormatValue(format?: string): unknown {
  switch ((format ?? '').toLowerCase()) {
    case 'email':
      return 'not-an-email';
    case 'uri':
    case 'url':
      return 'not a url';
    case 'uuid':
      return 'not-a-uuid';
    case 'date':
    case 'date-time':
      return 'not-a-date';
    default:
      return '__invalid_format__';
  }
}

/**
 * Build a catalog of negative cases for one field.
 * Unauthorized / forbidden / malformed / unexpected / duplicate use `kind`
 * descriptors even when `value` is not a simple scalar.
 */
export function buildNegativeCases(field: NegativeFieldSpec): NegativeCase[] {
  const { name } = field;
  const cases: NegativeCase[] = [
    {
      id: `${name}:missing`,
      description: `Omit required field "${name}"`,
      value: undefined,
      kind: 'missing',
    },
    {
      id: `${name}:null`,
      description: `Null value for "${name}"`,
      value: null,
      kind: 'null',
    },
    {
      id: `${name}:empty`,
      description: `Empty string for "${name}"`,
      value: '',
      kind: 'empty',
    },
    {
      id: `${name}:wrong-type`,
      description: `Wrong type for "${name}"`,
      value: wrongTypeValue(field.type),
      kind: 'wrong-type',
    },
    {
      id: `${name}:invalid-enum`,
      description: `Invalid enum value for "${name}"`,
      value: field.enumValues?.length ? `__not_in_enum_${field.enumValues[0]}__` : '__invalid_enum__',
      kind: 'invalid-enum',
    },
    {
      id: `${name}:invalid-format`,
      description: `Invalid format for "${name}"`,
      value: invalidFormatValue(field.format),
      kind: 'invalid-format',
    },
    {
      id: `${name}:too-long`,
      description: `Value longer than maxLength for "${name}"`,
      value: 'x'.repeat((field.maxLength ?? 8) + 1),
      kind: 'too-long',
    },
    {
      id: `${name}:too-short`,
      description: `Value shorter than minLength for "${name}"`,
      value: field.minLength && field.minLength > 0 ? 'x'.repeat(Math.max(0, field.minLength - 1)) : '',
      kind: 'too-short',
    },
    {
      id: `${name}:duplicate`,
      description: `Duplicate "${name}" in payload`,
      value: { kind: 'duplicate', field: name },
      kind: 'duplicate',
    },
    {
      id: `${name}:unauthorized`,
      description: `Request without auth while targeting "${name}"`,
      value: { kind: 'unauthorized' },
      kind: 'unauthorized',
    },
    {
      id: `${name}:forbidden`,
      description: `Request with insufficient auth for "${name}"`,
      value: { kind: 'forbidden' },
      kind: 'forbidden',
    },
    {
      id: `${name}:malformed-json`,
      description: `Malformed JSON body involving "${name}"`,
      value: { kind: 'malformed-json', raw: '{invalid' },
      kind: 'malformed-json',
    },
    {
      id: `${name}:unexpected-field`,
      description: `Unexpected extra field alongside "${name}"`,
      value: { kind: 'unexpected-field', unexpected: `__extra_${name}__` },
      kind: 'unexpected-field',
    },
  ];

  return cases;
}
