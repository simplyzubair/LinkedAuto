// Pure safety rules: when the tool may act, and how much. No database access
// here, so every rule can be unit-tested.

export const DEFAULT_SETTINGS = {
  paused: true,
  dry_run: true,
  limits: {
    invites_per_week: 80,
    invites_per_day: 15,
    messages_per_day: 25,
    page_views_per_day: 80,
    withdraws_per_day: 10,
  },
  schedule: {
    days: [1, 2, 3, 4, 5], // Monday..Friday (0 = Sunday)
    start: '09:30',
    end: '17:30',
    break_start: '13:00',
    break_end: '14:00',
  },
  pacing: {
    min_gap_s: 45,
    max_gap_s: 150,
    burst: 5, // after this many actions inside burst_window_min...
    burst_window_min: 30,
    break_min: 8, // ...take a break of this many minutes (random in range)
    break_max: 20,
  },
  warmup: { enabled: true, start_date: null },
  withdraw_after_days: 21,
  invites_paused_until: null,
  cap_factor: 1,
};

export function mergeSettings(stored) {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const [k, v] of Object.entries(stored)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? { ...out[k], ...v } : v;
  }
  return out;
}

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

// Local weekday and minute of day in the given IANA timezone.
export function localClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Seconds until the working schedule allows actions (0 = allowed now).
export function scheduleWait(now, schedule, timeZone) {
  const { day, minute } = localClock(now, timeZone);
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  const bs = schedule.break_start ? minutes(schedule.break_start) : null;
  const be = schedule.break_end ? minutes(schedule.break_end) : null;
  const workday = schedule.days.includes(day);
  if (workday && minute >= start && minute < end) {
    if (bs !== null && be !== null && minute >= bs && minute < be) return (be - minute) * 60;
    return 0;
  }
  // Find the next workday start, up to a week ahead.
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7;
    if (!schedule.days.includes(d)) continue;
    const startsIn = ahead * 1440 + start - minute;
    if (startsIn > 0) return startsIn * 60;
  }
  return 3600;
}

// Ramp for new or dormant accounts: 30%, 50%, 75%, then 100% by week.
export function warmupMultiplier(now, warmup) {
  if (!warmup.enabled || !warmup.start_date) return 1;
  const days = (now.getTime() - Date.parse(warmup.start_date)) / 86400000;
  if (days < 7) return 0.3;
  if (days < 14) return 0.5;
  if (days < 21) return 0.75;
  return 1;
}

// Cuts volume when people stop accepting: below 30% acceptance by 20%,
// below 20% by 40%. Needs at least 20 settled invitations to judge.
export function adaptiveMultiplier({ settled, accepted }) {
  if (settled < 20) return 1;
  const rate = accepted / settled;
  if (rate < 0.2) return 0.6;
  if (rate < 0.3) return 0.8;
  return 1;
}

export function effectiveLimits(settings, now, acceptance) {
  const factor = warmupMultiplier(now, settings.warmup) * adaptiveMultiplier(acceptance) * (settings.cap_factor ?? 1);
  const l = settings.limits;
  const scale = (n) => Math.max(1, Math.floor(n * factor));
  return {
    factor,
    invites_per_week: scale(l.invites_per_week),
    invites_per_day: scale(l.invites_per_day),
    messages_per_day: scale(l.messages_per_day),
    page_views_per_day: scale(l.page_views_per_day),
    withdraws_per_day: l.withdraws_per_day,
  };
}

// How long to rest after an action that just finished, given the start times
// of recent actions (newest first, including the one just done). Rolled once
// per action and stored, so polling doesn't re-roll it. rand() is injectable.
export function restAfterAction(now, recent, pacing, rand = Math.random) {
  const windowStart = now.getTime() - pacing.burst_window_min * 60000;
  const inWindow = recent.filter((d) => d.getTime() >= windowStart).length;
  if (inWindow >= pacing.burst) {
    return Math.round((pacing.break_min + rand() * (pacing.break_max - pacing.break_min)) * 60);
  }
  return Math.round(pacing.min_gap_s + rand() * (pacing.max_gap_s - pacing.min_gap_s));
}
