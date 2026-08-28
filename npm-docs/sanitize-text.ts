/** Remove control characters that break OOXML / Word rendering. */
export function sanitizeDocxText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\r\n/g, '\n');
}
