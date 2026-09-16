import { pagePathOf } from './probe';
import type { SecurityFinding } from './types';

interface SensitivePattern {
  id: string;
  re: RegExp;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'generic-secret-assignment', re: /(?:api[_-]?key|apikey|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}/i },
  { id: 'password-assignment', re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}/i },
  { id: 'demo-password-dump', re: /password for (?:all )?users/i },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'connection-string', re: /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|Server=)[^\s"'<>]{8,}/i },
];

export const REDACTED = '[REDACTED]';

export function detectSensitivePatterns(html: string): string[] {
  const hits: string[] = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(html)) hits.push(pattern.id);
  }
  return hits;
}

export function collectSensitiveFindings(input: {
  url: string;
  html: string;
  extraText?: string;
}): SecurityFinding[] {
  const hits = detectSensitivePatterns([input.html, input.extraText ?? ''].join('\n'));
  if (hits.length === 0) {
    return [
      {
        status: 'PASS',
        rule: 'sensitive-information',
        severity: 'info',
        detail: 'No configured sensitive-source patterns were observed in the HTML snapshot',
        page: input.url,
        pagePath: pagePathOf(input.url),
        expected: 'no private keys, credential dumps, or secret assignments in HTML',
        actual: 'no pattern hits',
      },
    ];
  }
  return [
    {
      status: 'FAIL',
      rule: 'sensitive-information',
      severity: 'high',
      detail: `Sensitive-source pattern(s) observed in HTML snapshot or discovery page text: ${hits.join(', ')}. Values are not copied.`,
      page: input.url,
      pagePath: pagePathOf(input.url),
      expected: 'no credentials, keys, or secret assignments in HTML',
      actual: `${hits.join(', ')} ${REDACTED}`,
    },
  ];
}
