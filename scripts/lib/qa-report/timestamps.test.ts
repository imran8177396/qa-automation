import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDurationBetween,
  formatPktIsoOffset,
  formatPktLongDate,
  formatPktStamp,
  PKT_OFFSET,
  PKT_TIMEZONE,
  pktDateParts,
} from './timestamps';

describe('PKT / Asia/Karachi timestamps', () => {
  it('renders a known UTC instant as +05:00 Asia/Karachi, not machine TZ or US Pacific', () => {
    const utc = new Date('2026-09-17T14:17:10.000Z');
    const parts = pktDateParts(utc);
    assert.equal(parts.year, '2026');
    assert.equal(parts.month, '09');
    assert.equal(parts.day, '17');
    assert.equal(parts.hour, '19');
    assert.equal(parts.minute, '17');
    assert.equal(parts.second, '10');
    assert.equal(formatPktStamp(utc), '2026-09-17_19-17-10');
    assert.equal(formatPktIsoOffset(utc), '2026-09-17T19:17:10+05:00');
    assert.equal(PKT_TIMEZONE, 'Asia/Karachi');
    assert.equal(PKT_OFFSET, '+05:00');
    assert.match(formatPktIsoOffset(utc), /\+05:00$/);
    assert.doesNotMatch(formatPktIsoOffset(utc), /[+-]07:00|[+-]08:00/);
  });

  it('keeps +05:00 in June (Pakistan has no DST; never US PDT)', () => {
    const utc = new Date('2026-06-15T00:00:00.000Z');
    assert.equal(formatPktIsoOffset(utc), '2026-06-15T05:00:00+05:00');
    assert.equal(formatPktStamp(utc), '2026-06-15_05-00-00');
  });

  it('formats a PKT long date and duration from existing timestamps only', () => {
    assert.equal(formatPktLongDate('2026-09-18T17:59:36+05:00'), 'September 18, 2026');
    assert.equal(formatPktLongDate(undefined), 'NOT_AVAILABLE');
    assert.equal(formatDurationBetween('2026-09-18T17:59:36+05:00', '2026-09-18T20:13:19+05:00'), '2h 13m 43s');
    assert.equal(formatDurationBetween('NOT_AVAILABLE', '2026-09-18T20:13:19+05:00'), 'NOT_AVAILABLE');
  });
});
