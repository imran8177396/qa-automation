import fs from 'fs';
import path from 'path';
import { PATHS } from '../paths';
import { formatIsoOffset } from './timestamps';
import { formatReportTimestamp } from './format';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';
export const NO_BASELINE = 'NO BASELINE';

export interface HistoryKpis {
  generatedAt: string;
  uiExecutionPassRate: number | null;
  assertionPassRate: number | null;
  uniqueFindingsHigh: number | null;
  uniqueFindingsMedium: number | null;
  uniqueFindingsLow: number | null;
  itemCoveragePercent: number | null;
  p95Ms: number | null;
}

export interface TrendDelta {
  metric: string;
  current: string;
  previous: string;
  delta: string;
}

function historyDir(): string {
  return path.join(PATHS.reports.root, 'history');
}

function parseStamp(fileName: string): number {
  const iso = fileName.replace(/\.json$/, '').replace('_', 'T').replace(/-/g, (m, offset) => {
    // keep date dashes; convert time separators already handled
    return offset < 10 ? m : m;
  });
  const ms = Date.parse(fileName.slice(0, 19).replace('_', 'T'));
  void iso;
  return Number.isFinite(ms) ? ms : 0;
}

export function listHistoryFiles(): string[] {
  const dir = historyDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => parseStamp(path.basename(a)) - parseStamp(path.basename(b)));
}

export function persistHistoryKpis(kpis: HistoryKpis, at = new Date()): string {
  const dir = historyDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${formatReportTimestamp(at.toISOString())}.json`);
  const payload = { ...kpis, generatedAt: kpis.generatedAt || formatIsoOffset(at) };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

export function loadPreviousHistory(currentFile?: string): HistoryKpis | null {
  const files = listHistoryFiles().filter((file) => file !== currentFile);
  if (files.length === 0) return null;
  const previous = files[files.length - 1];
  return JSON.parse(fs.readFileSync(previous, 'utf8')) as HistoryKpis;
}

function fmt(value: number | null): string {
  return value == null ? NOT_AVAILABLE : String(value);
}

function delta(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return NO_BASELINE;
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${Number(diff.toFixed(1))}`;
}

export function buildTrendRows(current: HistoryKpis, previous: HistoryKpis | null): TrendDelta[] {
  const pairs: Array<[string, number | null, number | null]> = [
    ['UI execution pass rate (%)', current.uiExecutionPassRate, previous?.uiExecutionPassRate ?? null],
    ['Assertion pass rate (%)', current.assertionPassRate, previous?.assertionPassRate ?? null],
    ['Unique findings (high)', current.uniqueFindingsHigh, previous?.uniqueFindingsHigh ?? null],
    ['Unique findings (medium)', current.uniqueFindingsMedium, previous?.uniqueFindingsMedium ?? null],
    ['Unique findings (low)', current.uniqueFindingsLow, previous?.uniqueFindingsLow ?? null],
    ['Item coverage (%)', current.itemCoveragePercent, previous?.itemCoveragePercent ?? null],
    ['p95 (ms)', current.p95Ms, previous?.p95Ms ?? null],
  ];

  if (!previous) {
    return pairs.map(([metric, currentValue]) => ({
      metric,
      current: fmt(currentValue),
      previous: NO_BASELINE,
      delta: NO_BASELINE,
    }));
  }

  return pairs.map(([metric, currentValue, previousValue]) => ({
    metric,
    current: fmt(currentValue),
    previous: fmt(previousValue),
    delta: delta(currentValue, previousValue),
  }));
}
