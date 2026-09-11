export const NOT_AVAILABLE = 'NOT_AVAILABLE';

/** ISO 8601 with explicit numeric offset (never drop the offset). */
export function formatIsoOffset(date: Date = new Date()): string {
  const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offsetMin) / 60));
  const minutes = pad(Math.abs(offsetMin) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hours}:${minutes}`
  );
}

export function reportTimezoneLabel(date: Date = new Date()): string {
  const formatted = formatIsoOffset(date);
  const offset = formatted.slice(-6);
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return name ? `${name} (UTC${offset})` : `UTC${offset}`;
  } catch {
    return `UTC${offset}`;
  }
}

/** Normalize an existing timestamp to ISO 8601 with offset. Missing → NOT_AVAILABLE. */
export function toIsoOffset(value: string | undefined | null, now = new Date()): string {
  if (!value || value === 'Not Provided' || value === NOT_AVAILABLE) return NOT_AVAILABLE;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;
  const parsed = new Date(ms);
  // Preserve the instant; render in the report-local offset.
  void now;
  return formatIsoOffset(parsed);
}
