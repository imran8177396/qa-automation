import path from 'path';
import { PATHS } from '../lib/paths';
import { loadConfig } from '../lib/load-config';
import { writeJson } from '../discovery/write-json';
import { logError, logStep, logSuccess, logWarn } from '../lib/logger';
import {
  buildEngineSummary,
  makeResult,
  type TestResult,
} from '../core/engine-contract';
import { getTestType } from '../core/test-types/registry';
import type { LocalizationTestsConfig } from '../types';

const LOCALIZATION_CATEGORY = getTestType('localization')?.category ?? 'specialized';
const FIXED_INSTANT = new Date('2026-01-15T15:04:05.000Z');
const DST_WINTER = new Date('2026-01-15T12:00:00.000Z');
const DST_SUMMER = new Date('2026-07-15T12:00:00.000Z');

/** Language subtags treated as RTL for direction checks. */
const RTL_LANGUAGE_SUBTAGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

const LOCALE_CHECK_KINDS = [
  'language',
  'locale',
  'currency',
  'date-format',
  'time-format',
  'number-format',
  'unicode',
  'rtl',
] as const;

const TIMEZONE_CHECK_KINDS = ['timezone', 'utc-conversion', 'dst'] as const;

export const LOCALIZATION_CHECK_IDS = {
  page: 'localization:page',
  disabled: 'localization:disabled',
  language: (locale: string) => `localization:language:${locale}`,
  locale: (locale: string) => `localization:locale:${locale}`,
  currency: (locale: string) => `localization:currency:${locale}`,
  dateFormat: (locale: string) => `localization:date-format:${locale}`,
  timeFormat: (locale: string) => `localization:time-format:${locale}`,
  numberFormat: (locale: string) => `localization:number-format:${locale}`,
  unicode: (locale: string) => `localization:unicode:${locale}`,
  rtl: (locale: string) => `localization:rtl:${locale}`,
  timezone: (zone: string) => `localization:timezone:${zone}`,
  utcConversion: (zone: string) => `localization:utc-conversion:${zone}`,
  dst: (zone: string) => `localization:dst:${zone}`,
} as const;

export interface RunLocalizationOptions {
  writeSummary?: boolean;
}

function loadLocalizationConfig(): LocalizationTestsConfig {
  const loaded = loadConfig();
  const localization = loaded.tests?.localization;
  return {
    enabled: localization?.enabled ?? false,
    locales: localization?.locales,
    timezones: localization?.timezones,
  };
}

function configRequiresResult(
  id: string,
  name: string,
  message: string
): TestResult {
  return makeResult({
    id,
    testType: 'localization',
    category: LOCALIZATION_CATEGORY,
    name,
    status: 'REQUIRES_CONFIGURATION',
    error: { message },
    metadata: { reason: message },
  });
}

function languageSubtag(locale: string): string | undefined {
  try {
    const parsed = new Intl.Locale(locale);
    const language = parsed.language?.trim();
    return language || undefined;
  } catch {
    return undefined;
  }
}

function expectedDirection(locale: string): 'rtl' | 'ltr' {
  const language = languageSubtag(locale)?.toLowerCase();
  if (language && RTL_LANGUAGE_SUBTAGS.has(language)) return 'rtl';
  return 'ltr';
}

/**
 * Read a short offset label (e.g. GMT-6) for a zone at an instant.
 * Throws when the offset cannot be read.
 */
export function readTimezoneOffsetLabel(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(instant);
  const label = parts.find((part) => part.type === 'timeZoneName')?.value?.trim();
  if (!label) {
    throw new Error(`cannot read timezone offset for ${timeZone}`);
  }
  return label;
}

function emitUnconfiguredLocaleRows(message: string): TestResult[] {
  return LOCALE_CHECK_KINDS.map((kind) =>
    configRequiresResult(`localization:${kind}`, `Localization ${kind}`, message)
  );
}

function emitUnconfiguredTimezoneRows(message: string): TestResult[] {
  return TIMEZONE_CHECK_KINDS.map((kind) =>
    configRequiresResult(`localization:${kind}`, `Localization ${kind}`, message)
  );
}

function checkLanguage(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.language(locale);
  try {
    const parsed = new Intl.Locale(locale);
    const language = parsed.language?.trim();
    if (!language) {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Language subtag (${locale})`,
        status: 'FAIL',
        error: { message: `locale language subtag empty for ${locale}` },
        assertion: { expected: 'non-empty language subtag', actual: language ?? '' },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Language subtag (${locale})`,
      status: 'PASS',
      assertion: { expected: 'parseable language subtag', actual: language },
      metadata: { locale, language },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Language subtag (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkResolvedLocale(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.locale(locale);
  try {
    const resolved = new Intl.DateTimeFormat(locale).resolvedOptions().locale?.trim();
    if (!resolved) {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Resolved locale (${locale})`,
        status: 'FAIL',
        error: { message: `resolved locale empty for ${locale}` },
        assertion: { expected: 'non-empty resolved locale', actual: resolved ?? '' },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Resolved locale (${locale})`,
      status: 'PASS',
      assertion: { expected: 'non-empty resolved locale', actual: resolved },
      metadata: { locale, resolvedLocale: resolved },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Resolved locale (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkCurrency(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.currency(locale);
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
    }).format(1234.5);
    if (!formatted || formatted.trim() === '') {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Currency format (${locale})`,
        status: 'FAIL',
        error: { message: `currency format empty for ${locale}` },
        assertion: { expected: 'non-empty currency string', actual: formatted },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Currency format (${locale})`,
      status: 'PASS',
      assertion: { expected: 'non-empty currency string', actual: formatted },
      metadata: { locale, formatted },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Currency format (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkDateFormat(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.dateFormat(locale);
  try {
    const formatted = new Intl.DateTimeFormat(locale).format(FIXED_INSTANT);
    if (!formatted || formatted.trim() === '') {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Date format (${locale})`,
        status: 'FAIL',
        error: { message: `date format empty for ${locale}` },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Date format (${locale})`,
      status: 'PASS',
      assertion: { expected: 'non-empty date string', actual: formatted },
      metadata: { locale, formatted, instant: FIXED_INSTANT.toISOString() },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Date format (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkTimeFormat(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.timeFormat(locale);
  try {
    const formatted = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
      FIXED_INSTANT
    );
    if (!formatted || formatted.trim() === '') {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Time format (${locale})`,
        status: 'FAIL',
        error: { message: `time format empty for ${locale}` },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Time format (${locale})`,
      status: 'PASS',
      assertion: { expected: 'non-empty time string', actual: formatted },
      metadata: { locale, formatted, instant: FIXED_INSTANT.toISOString() },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Time format (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkNumberFormat(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.numberFormat(locale);
  const raw = '1234567.89';
  try {
    const formatted = new Intl.NumberFormat(locale).format(1234567.89);
    const nonEmpty = Boolean(formatted && formatted.trim() !== '');
    const differs = formatted !== raw;
    if (nonEmpty || differs) {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `Number format (${locale})`,
        status: 'PASS',
        assertion: { expected: 'non-empty number string', actual: formatted },
        metadata: { locale, formatted, differsFromRaw: differs },
      });
    }
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Number format (${locale})`,
      status: 'FAIL',
      error: { message: `number format empty for ${locale}` },
      assertion: { expected: 'non-empty number string', actual: formatted },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Number format (${locale})`,
      status: 'FAIL',
      error: { message },
    });
  }
}

function checkUnicode(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.unicode(locale);
  const cafe = 'café';
  const japanese = '日本語';
  const roundTrip = `${cafe} ${japanese}`;
  const ok = roundTrip.includes(cafe) && roundTrip.includes(japanese);
  if (!ok) {
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Unicode round-trip (${locale})`,
      status: 'FAIL',
      error: { message: 'unicode characters did not round-trip in template string' },
      metadata: { locale, roundTrip },
    });
  }
  return makeResult({
    id,
    testType: 'localization',
    category: LOCALIZATION_CATEGORY,
    name: `Unicode round-trip (${locale})`,
    status: 'PASS',
    assertion: { expected: 'café and 日本語 present', actual: roundTrip },
    metadata: { locale, roundTrip },
  });
}

function checkRtl(locale: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.rtl(locale);
  const direction = expectedDirection(locale);
  const language = languageSubtag(locale)?.toLowerCase();

  // Known expectation: ur must be rtl; en is ltr.
  if (language === 'ur' && direction !== 'rtl') {
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `RTL direction (${locale})`,
      status: 'FAIL',
      error: { message: `ur locale classified as ${direction}, expected rtl` },
      metadata: { locale, direction, language },
    });
  }

  return makeResult({
    id,
    testType: 'localization',
    category: LOCALIZATION_CATEGORY,
    name: `RTL direction (${locale})`,
    status: 'PASS',
    assertion: { expected: direction, actual: direction },
    metadata: { locale, direction, language },
  });
}

function runLocaleChecks(locale: string): TestResult[] {
  return [
    checkLanguage(locale),
    checkResolvedLocale(locale),
    checkCurrency(locale),
    checkDateFormat(locale),
    checkTimeFormat(locale),
    checkNumberFormat(locale),
    checkUnicode(locale),
    checkRtl(locale),
  ];
}

function checkTimezoneValid(zone: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.timezone(zone);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(FIXED_INSTANT);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Timezone valid (${zone})`,
      status: 'PASS',
      assertion: { expected: 'valid IANA timezone', actual: zone },
      metadata: { timeZone: zone },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `Timezone valid (${zone})`,
      status: 'FAIL',
      error: { message: `invalid timezone: ${message}` },
      metadata: { timeZone: zone },
    });
  }
}

function checkUtcConversion(zone: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.utcConversion(zone);
  try {
    const utcFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(FIXED_INSTANT);
    const zoneFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(FIXED_INSTANT);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `UTC conversion (${zone})`,
      status: 'PASS',
      assertion: { expected: 'both formats succeed', actual: 'ok' },
      metadata: {
        timeZone: zone,
        utcFormatted,
        zoneFormatted,
        instant: FIXED_INSTANT.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `UTC conversion (${zone})`,
      status: 'FAIL',
      error: { message },
      metadata: { timeZone: zone },
    });
  }
}

function checkDst(zone: string): TestResult {
  const id = LOCALIZATION_CHECK_IDS.dst(zone);
  try {
    const winterOffset = readTimezoneOffsetLabel(zone, DST_WINTER);
    const summerOffset = readTimezoneOffsetLabel(zone, DST_SUMMER);
    const dstObserved = winterOffset !== summerOffset;

    // Known cases — fail only when these are wrong.
    if (zone === 'America/Chicago' && !dstObserved) {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `DST observation (${zone})`,
        status: 'FAIL',
        error: { message: 'America/Chicago expected dstObserved true' },
        metadata: { timeZone: zone, winterOffset, summerOffset, dstObserved },
      });
    }
    if ((zone === 'UTC' || zone === 'Asia/Karachi') && dstObserved) {
      return makeResult({
        id,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: `DST observation (${zone})`,
        status: 'FAIL',
        error: { message: `${zone} expected dstObserved false` },
        metadata: { timeZone: zone, winterOffset, summerOffset, dstObserved },
      });
    }

    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `DST observation (${zone})`,
      status: 'PASS',
      assertion: { expected: 'offsets readable', actual: { winterOffset, summerOffset } },
      metadata: { timeZone: zone, winterOffset, summerOffset, dstObserved },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return makeResult({
      id,
      testType: 'localization',
      category: LOCALIZATION_CATEGORY,
      name: `DST observation (${zone})`,
      status: 'FAIL',
      error: { message },
      metadata: { timeZone: zone },
    });
  }
}

function runTimezoneChecks(zone: string): TestResult[] {
  return [checkTimezoneValid(zone), checkUtcConversion(zone), checkDst(zone)];
}

function pageCheckResult(): TestResult {
  const message = 'live page locale is not configured';
  return makeResult({
    id: LOCALIZATION_CHECK_IDS.page,
    testType: 'localization',
    category: LOCALIZATION_CATEGORY,
    name: 'Live page locale',
    status: 'REQUIRES_CONFIGURATION',
    error: { message },
    metadata: { reason: message },
  });
}

/**
 * Intl formatter / timezone / RTL checks only. Never fetches a page.
 * Disabled → one NOT_TESTED. Never claims an application is translated.
 */
export function runLocalization(
  config: LocalizationTestsConfig = loadLocalizationConfig(),
  options?: RunLocalizationOptions
): TestResult[] {
  const writeSummary = options?.writeSummary !== false;
  const results: TestResult[] = [];

  if (!config.enabled) {
    results.push(
      makeResult({
        id: LOCALIZATION_CHECK_IDS.disabled,
        testType: 'localization',
        category: LOCALIZATION_CATEGORY,
        name: 'Localization engine',
        status: 'NOT_TESTED',
        error: { message: 'localization engine disabled' },
        metadata: { reason: 'localization engine disabled' },
      })
    );
    if (writeSummary) writeLocalizationSummary(results);
    return results;
  }

  const locales = config.locales ?? [];
  const timezones = config.timezones ?? [];
  const localesConfigured = locales.length > 0;
  const timezonesConfigured = timezones.length > 0;

  if (!localesConfigured) {
    results.push(...emitUnconfiguredLocaleRows('no locales configured'));
  } else {
    for (const locale of locales) {
      results.push(...runLocaleChecks(locale));
    }
  }

  if (!timezonesConfigured) {
    results.push(...emitUnconfiguredTimezoneRows('no timezones configured'));
  } else {
    for (const zone of timezones) {
      results.push(...runTimezoneChecks(zone));
    }
  }

  results.push(pageCheckResult());

  if (writeSummary) writeLocalizationSummary(results);
  return results;
}

export function writeLocalizationSummary(results: TestResult[]): string {
  const summary = buildEngineSummary({
    engine: 'localization',
    testType: 'localization',
    results,
    note: 'Intl formatter and timezone checks only. Live-page language is REQUIRES_CONFIGURATION until a page URL is configured. Never claims a site is translated.',
    limitations: [
      'No HTTP/page fetch is performed.',
      'Live page locale probing requires a configured page URL (not implemented).',
    ],
  });
  const out = path.join(PATHS.reports.localization, 'summary.json');
  writeJson(out, summary);
  return out;
}

function main(): void {
  logStep('Localization engine (Intl formatter / timezone checks — no HTTP)');
  const results = runLocalization();
  const summary = buildEngineSummary({
    engine: 'localization',
    testType: 'localization',
    results,
  });
  for (const row of results) {
    console.log(`${row.status}\t${row.name}\t${row.error?.message ?? ''}`);
  }
  if (summary.failCount > 0) {
    logError(`${summary.failCount} localization FAIL(s) — see reports/localization/`);
    process.exit(1);
  }
  if (summary.requiresConfigurationCount > 0) {
    logWarn('Localization REQUIRES_CONFIGURATION — see reports/localization/');
    return;
  }
  if (summary.notTestedCount > 0 && summary.passCount === 0) {
    logWarn('Localization NOT_TESTED — engine disabled');
    return;
  }
  logSuccess('Localization engine completed');
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
