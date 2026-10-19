import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const sandbox: Record<string, unknown> = {};
runInNewContext(readFileSync(join(__dirname, '..', 'artifact', 'range-picker.js'), 'utf8'), sandbox);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R = (sandbox as any).HarkRange;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('quick ranges (latest day with data: Sun Oct 18, 2026)', () => {
  const latest = '2026-10-18';
  it.each([
    ['thisWeek', '2026-10-12', '2026-10-18'],
    ['lastWeek', '2026-10-05', '2026-10-11'],
    ['last7', '2026-10-12', '2026-10-18'],
    ['last14', '2026-10-05', '2026-10-18'],
    ['last28', '2026-09-21', '2026-10-18'],
    ['mtd', '2026-10-01', '2026-10-18'],
    ['lastMonth', '2026-09-01', '2026-09-30'],
  ])('%s → %s..%s', (id, from, to) => {
    expect(plain(R.quickRange(id, latest))).toEqual({ from, to });
  });
  it('weeks start on Monday', () => {
    expect(R.weekday('2026-10-12')).toBe(0);
    expect(R.weekday('2026-10-18')).toBe(6);
  });
});

describe('comparison and bounds', () => {
  it('previous period matches the dashboard rule (same length, immediately before)', () => {
    expect(plain(R.previousPeriod({ from: '2026-10-05', to: '2026-10-11' }))).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(plain(R.previousPeriod({ from: '2026-10-18', to: '2026-10-18' }))).toEqual({
      from: '2026-10-17',
      to: '2026-10-17',
    });
  });
  it('clamps to the days that have data, or gives nothing when outside them', () => {
    expect(plain(R.clamp({ from: '2026-09-21', to: '2026-10-18' }, '2026-10-01', '2026-10-18'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-18',
    });
    expect(R.clamp({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-01', '2026-10-18')).toBeNull();
  });
  it('formats ranges like the dashboard readout', () => {
    expect(R.fmtRange({ from: '2026-10-05', to: '2026-10-11' })).toBe('Oct 5 – 11, 2026');
    expect(R.fmtRange({ from: '2026-09-28', to: '2026-10-04' })).toBe('Sep 28 – Oct 4, 2026');
    expect(R.fmtRange({ from: '2026-10-18', to: '2026-10-18' })).toBe('Oct 18, 2026');
    expect(R.daysIn('2026-09-28', '2026-10-04')).toBe(7);
  });
});
