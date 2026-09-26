export const NOT_AVAILABLE = 'NOT_AVAILABLE';

/** Pakistan Standard Time. In this project PST means Pakistan, never US Pacific. */
export const PKT_TIMEZONE = 'Asia/Karachi';
export const PKT_OFFSET = '+05:00';

export interface PktDateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  millisecond: string;
}

/**
 * Wall-clock parts in IANA Asia/Karachi. Does not read the machine timezone.
 */
export function pktDateParts(date: Date): PktDateParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  });
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: map.year ?? '0000',
    month: map.month ?? '01',
    day: map.day ?? '01',
    hour: map.hour ?? '00',
    minute: map.minute ?? '00',
    second: map.second ?? '00',
    millisecond: map.fractionalSecond ?? '000',
  };
}

/** Filesystem stamp: YYYY-MM-DD_HH-mm-ss in Asia/Karachi. */
export function formatPktStamp(date: Date = new Date()): string {
  const p = pktDateParts(date);
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
}

/** ISO 8601 with fixed +05:00, rendered in Asia/Karachi (not machine TZ). */
export function formatPktIsoOffset(date: Date = new Date()): string {
  const p = pktDateParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${PKT_OFFSET}`;
}

/** Long date in Asia/Karachi, e.g. September 18, 2026. Missing/invalid → NOT_AVAILABLE. */
export function formatPktLongDate(value: string | undefined | null): string {
  if (!value || value === NOT_AVAILABLE) return NOT_AVAILABLE;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(ms));
}

/** Elapsed time between two ISO timestamps. Missing/invalid → NOT_AVAILABLE. */
export function formatDurationBetween(start: string | undefined | null, end: string | undefined | null): string {
  if (!start || !end || start === NOT_AVAILABLE || end === NOT_AVAILABLE) return NOT_AVAILABLE;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return NOT_AVAILABLE;
  const ms = b - a;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

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
export function toIsoOffset(value: string | undefined | null): string {
  if (!value || value === 'Not Provided' || value === NOT_AVAILABLE) return NOT_AVAILABLE;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;
  return formatIsoOffset(new Date(ms));
}
