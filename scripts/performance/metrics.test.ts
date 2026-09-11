import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { evaluateThresholds, NOT_AVAILABLE, parseCsvLine, parseJmeterJtl, percentile } from './metrics';
import { normalizePerformanceProfile } from './profiles';

function writeJtl(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-jtl-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

describe('JMeter percentile parser', () => {
  it('uses nearest-rank percentiles', () => {
    const values = [10, 20, 30, 40, 50];
    assert.equal(percentile(values, 50), 30);
    assert.equal(percentile(values, 90), 50);
    assert.equal(percentile(values, 95), 50);
    assert.equal(percentile(values, 99), 50);
    assert.equal(percentile([], 95), null);
  });

  it('parses p50/p90/p95/p99, TTFB, throughput, and sample URL from a headed JTL', () => {
    const jtl = [
      'timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect',
      '1000,100,GET /,200,OK,Thread Group 1-1,text,true,,10,10,1,1,https://example.com/,40,0,10',
      '1100,200,GET /,200,OK,Thread Group 1-2,text,true,,10,10,2,2,https://example.com/about,80,0,12',
      '1200,300,GET /,200,OK,Thread Group 1-3,text,true,,10,10,3,3,https://example.com/contact,120,0,14',
      '1300,400,GET /,200,OK,Thread Group 1-4,text,true,,10,10,4,4,https://example.com/work,160,0,16',
      '1400,500,GET /,200,OK,Thread Group 1-5,text,true,,10,10,5,5,https://example.com/careers,200,0,18',
      '',
    ].join('\n');
    const parsed = parseJmeterJtl(writeJtl('headed.jtl', jtl));
    assert.ok(parsed);
    assert.equal(parsed.metrics.requestCount, 5);
    assert.equal(parsed.metrics.p50Ms, 300);
    assert.equal(parsed.metrics.p90Ms, 500);
    assert.equal(parsed.metrics.p95Ms, 500);
    assert.equal(parsed.metrics.p99Ms, 500);
    assert.equal(parsed.metrics.ttfbMs, 120);
    assert.equal(parsed.metrics.avgConnectMs, 14);
    assert.ok(parsed.metrics.throughputPerSec != null);
    assert.ok(parsed.metrics.throughputPerSec > 0);
    assert.equal(parsed.samples[0]?.url, 'https://example.com/');
    assert.equal(parsed.samples[1]?.url, 'https://example.com/about');
    assert.equal(parsed.samples[0]?.thread, 'Thread Group 1-1');
  });

  it('uses NOT_AVAILABLE when the URL column is missing', () => {
    const jtl = [
      'timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success',
      '1000,150,GET /,200,OK,Thread Group 1-1,text,true',
      '',
    ].join('\n');
    const parsed = parseJmeterJtl(writeJtl('no-url.jtl', jtl));
    assert.ok(parsed);
    assert.equal(parsed.samples[0]?.url, NOT_AVAILABLE);
    assert.equal(parsed.metrics.ttfbMs, null);
  });

  it('parses quoted CSV fields that contain commas', () => {
    assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  });
});

describe('liveness → RECORDED status', () => {
  const metrics = {
    requestCount: 5,
    failures: 0,
    successful: 5,
    errorRatePercent: 0,
    avgMs: 100,
    minMs: 80,
    maxMs: 140,
    p50Ms: 100,
    p90Ms: 140,
    p95Ms: 140,
    p99Ms: 140,
    ttfbMs: 40,
    throughputPerSec: 1,
    avgLatencyMs: 40,
    avgConnectMs: 10,
  };

  it('records RECORDED for liveness even when numeric thresholds would be met', () => {
    const result = evaluateThresholds(
      metrics,
      { maxP95Ms: 500, maxErrorRatePercent: 1 },
      'liveness'
    );
    assert.equal(result.status, 'RECORDED');
    assert.notEqual(result.status, 'met');
    assert.notEqual(result.status, 'PASS' as typeof result.status);
  });

  it('records RECORDED for the smoke alias of liveness', () => {
    const result = evaluateThresholds(metrics, { maxP95Ms: 500, maxErrorRatePercent: 1 }, 'smoke');
    assert.equal(result.status, 'RECORDED');
  });

  it('records RECORDED when threshold keys exist but values are null', () => {
    const result = evaluateThresholds(metrics, { maxP95Ms: null, maxErrorRatePercent: null }, 'liveness');
    assert.equal(result.status, 'RECORDED');
    assert.equal(result.defined, false);
    assert.equal(result.comparisons[0]?.status, 'NOT_AVAILABLE');
    assert.equal(result.comparisons[1]?.status, 'NOT_AVAILABLE');
  });

  it('does not invent a PASS/met verdict for five-sample liveness', () => {
    const result = evaluateThresholds(metrics, null, 'liveness');
    assert.equal(result.status, 'RECORDED');
    assert.notEqual(String(result.status).toLowerCase(), 'pass');
    assert.notEqual(result.status, 'met');
  });

  it('normalizes smoke to liveness', () => {
    assert.equal(normalizePerformanceProfile('smoke'), 'liveness');
    assert.equal(normalizePerformanceProfile(undefined), 'liveness');
  });

  it('still evaluates heavy-profile thresholds when numeric SLAs are set', () => {
    const met = evaluateThresholds(metrics, { maxP95Ms: 500, maxErrorRatePercent: 1 }, 'load');
    assert.equal(met.status, 'met');
    const breached = evaluateThresholds(metrics, { maxP95Ms: 50, maxErrorRatePercent: 1 }, 'load');
    assert.equal(breached.status, 'breached');
  });

  it('returns NOT_AVAILABLE when no metrics were collected', () => {
    const result = evaluateThresholds(null, { maxP95Ms: null, maxErrorRatePercent: null }, 'liveness');
    assert.equal(result.status, 'NOT_AVAILABLE');
  });
});
