import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCALIZATION_CHECK_IDS,
  runLocalization,
} from './run-localization';

test('disabled → NOT_TESTED; no locale/timezone rows', () => {
  const results = runLocalization(
    {
      enabled: false,
      locales: ['en-US'],
      timezones: ['UTC'],
    },
    { writeSummary: false }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'NOT_TESTED');
  assert.match(results[0].error?.message ?? '', /localization engine disabled/i);
});

test('empty locales → REQUIRES_CONFIGURATION for locale checks', () => {
  const results = runLocalization(
    { enabled: true, locales: [], timezones: ['UTC'] },
    { writeSummary: false }
  );
  const localeRows = results.filter((r) =>
    /localization:(language|locale|currency|date-format|time-format|number-format|unicode|rtl)$/.test(
      r.id
    )
  );
  assert.ok(localeRows.length >= 8);
  for (const row of localeRows) {
    assert.equal(row.status, 'REQUIRES_CONFIGURATION', row.id);
    assert.match(row.error?.message ?? '', /no locales configured/i);
  }
});

test('page row is REQUIRES_CONFIGURATION; never claims translation', () => {
  const results = runLocalization(
    {
      enabled: true,
      locales: ['en-US'],
      timezones: ['UTC'],
    },
    { writeSummary: false }
  );
  const page = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.page);
  assert.ok(page);
  assert.equal(page.status, 'REQUIRES_CONFIGURATION');
  assert.match(page.error?.message ?? '', /live page locale is not configured/i);
  assert.equal(
    results.some((r) => /translated|translation supported/i.test(r.error?.message ?? '')),
    false
  );
});

test('expected rtl and dst metadata for sample locales and zones', () => {
  const results = runLocalization(
    {
      enabled: true,
      locales: ['en-US', 'en-GB', 'ur-PK'],
      timezones: ['UTC', 'Asia/Karachi', 'America/Chicago'],
    },
    { writeSummary: false }
  );

  const enUsRtl = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.rtl('en-US'));
  const enGbRtl = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.rtl('en-GB'));
  const urRtl = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.rtl('ur-PK'));
  assert.ok(enUsRtl);
  assert.ok(enGbRtl);
  assert.ok(urRtl);
  assert.equal(enUsRtl.status, 'PASS');
  assert.equal(enGbRtl.status, 'PASS');
  assert.equal(urRtl.status, 'PASS');
  assert.equal(enUsRtl.metadata?.direction, 'ltr');
  assert.equal(enGbRtl.metadata?.direction, 'ltr');
  assert.equal(urRtl.metadata?.direction, 'rtl');

  const utcDst = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.dst('UTC'));
  const karachiDst = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.dst('Asia/Karachi'));
  const chicagoDst = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.dst('America/Chicago'));
  assert.ok(utcDst);
  assert.ok(karachiDst);
  assert.ok(chicagoDst);
  assert.equal(utcDst.status, 'PASS');
  assert.equal(karachiDst.status, 'PASS');
  assert.equal(chicagoDst.status, 'PASS');
  assert.equal(utcDst.metadata?.dstObserved, false);
  assert.equal(karachiDst.metadata?.dstObserved, false);
  assert.equal(chicagoDst.metadata?.dstObserved, true);

  assert.equal(results.some((r) => r.status === 'FAIL'), false);
});

test('invalid timezone Not/AZone → FAIL', () => {
  const results = runLocalization(
    {
      enabled: true,
      locales: ['en-US'],
      timezones: ['Not/AZone'],
    },
    { writeSummary: false }
  );
  const tz = results.find((r) => r.id === LOCALIZATION_CHECK_IDS.timezone('Not/AZone'));
  assert.ok(tz);
  assert.equal(tz.status, 'FAIL');
});
