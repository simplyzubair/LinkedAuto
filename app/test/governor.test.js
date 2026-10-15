import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWait, warmupMultiplier, adaptiveMultiplier, effectiveLimits, restAfterAction, mergeSettings, DEFAULT_SETTINGS } from '../src/governor.js';

const TZ = 'Asia/Karachi'; // UTC+5, no DST
const at = (iso) => new Date(iso);
const sched = DEFAULT_SETTINGS.schedule;

test('schedule allows weekday working hours only', () => {
  assert.equal(scheduleWait(at('2026-10-15T05:00:00Z'), sched, TZ), 0); // Thu 10:00 local
  assert.equal(scheduleWait(at('2026-10-15T08:30:00Z'), sched, TZ), 30 * 60); // 13:30, lunch until 14:00
  assert.equal(scheduleWait(at('2026-10-15T03:30:00Z'), sched, TZ), 60 * 60); // 08:30 -> 09:30
  // Fri 18:00 local -> Mon 09:30 local
  assert.equal(scheduleWait(at('2026-10-16T13:00:00Z'), sched, TZ), (2 * 1440 + 15 * 60 + 30) * 60);
});

test('warm-up ramps over four weeks', () => {
  const w = { enabled: true, start_date: '2026-10-01' };
  assert.equal(warmupMultiplier(at('2026-10-03T00:00:00Z'), w), 0.3);
  assert.equal(warmupMultiplier(at('2026-10-10T00:00:00Z'), w), 0.5);
  assert.equal(warmupMultiplier(at('2026-10-17T00:00:00Z'), w), 0.75);
  assert.equal(warmupMultiplier(at('2026-10-30T00:00:00Z'), w), 1);
  assert.equal(warmupMultiplier(at('2026-10-03T00:00:00Z'), { enabled: false, start_date: '2026-10-01' }), 1);
});

test('adaptive cut needs enough data', () => {
  assert.equal(adaptiveMultiplier({ settled: 10, accepted: 0 }), 1);
  assert.equal(adaptiveMultiplier({ settled: 40, accepted: 6 }), 0.6);
  assert.equal(adaptiveMultiplier({ settled: 40, accepted: 10 }), 0.8);
  assert.equal(adaptiveMultiplier({ settled: 40, accepted: 20 }), 1);
});

test('effective limits combine warm-up, acceptance and cap factor', () => {
  const s = mergeSettings({ warmup: { enabled: true, start_date: '2026-10-01' }, cap_factor: 0.8 });
  const l = effectiveLimits(s, at('2026-10-03T00:00:00Z'), { settled: 0, accepted: 0 });
  assert.equal(l.invites_per_week, Math.floor(80 * 0.3 * 0.8));
  assert.equal(l.invites_per_day, Math.floor(15 * 0.3 * 0.8));
  assert.ok(l.invites_per_day >= 1);
});

test('rest after action: normal gap, then a break after a burst', () => {
  const now = at('2026-10-15T05:00:00Z');
  const p = DEFAULT_SETTINGS.pacing;
  assert.equal(restAfterAction(now, [now], p, () => 0), 45);
  assert.equal(restAfterAction(now, [now], p, () => 1), 150);
  const five = [0, 2, 4, 6, 8].map((m) => new Date(now.getTime() - m * 60000));
  assert.equal(restAfterAction(now, five, p, () => 0), 8 * 60);
});

test('settings merge keeps defaults for missing keys', () => {
  const s = mergeSettings({ limits: { invites_per_day: 5 } });
  assert.equal(s.limits.invites_per_day, 5);
  assert.equal(s.limits.invites_per_week, 80);
  assert.equal(s.paused, true);
});
