// Chooses the runner's next LinkedIn action. Every rule in governor.js is
// checked here first; anything that fails returns a wait instead of work.
import { sql, setSetting } from './db.js';
import { mergeSettings, scheduleWait, effectiveLimits } from './governor.js';
import { pickVariant, render, clip, INVITE_NOTE_MAX } from './text.js';

export const TIME_ZONE = process.env.TZ || 'Asia/Karachi';
const SYNC_CONNECTIONS_EVERY_H = 3;
const SYNC_INBOX_EVERY_H = 2;
const ACTION_TIMEOUT_MIN = 10;

export async function loadSettings() {
  const rows = await sql`SELECT key, value FROM settings`;
  return mergeSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

// Invitations old enough to have been answered (3+ days), last 30 days.
export async function acceptanceStats() {
  const [r] = await sql`
    SELECT count(*)::int AS settled, count(accepted_at)::int AS accepted
    FROM leads
    WHERE invited_at < now() - interval '3 days' AND invited_at > now() - interval '30 days'`;
  return r;
}

export async function usage() {
  const [u] = await sql`
    SELECT
      count(*) FILTER (WHERE type = 'invite' AND at > now() - interval '7 days')::int AS invites_week,
      count(*) FILTER (WHERE type = 'invite' AND at > date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}) AT TIME ZONE ${TIME_ZONE})::int AS invites_today,
      count(*) FILTER (WHERE type = 'message' AND at > date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}) AT TIME ZONE ${TIME_ZONE})::int AS messages_today,
      count(*) FILTER (WHERE type = 'withdraw' AND at > date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}) AT TIME ZONE ${TIME_ZONE})::int AS withdraws_today,
      count(*) FILTER (WHERE at > date_trunc('day', now() AT TIME ZONE ${TIME_ZONE}) AT TIME ZONE ${TIME_ZONE})::int AS page_views_today
    FROM actions
    WHERE at > now() - interval '8 days' AND coalesce(result, '') <> 'not_started'`;
  return u;
}

const wait = (seconds, reason) => ({ wait: Math.max(5, Math.round(seconds)), reason });
const hoursAgo = (iso, h) => !iso || Date.now() - Date.parse(iso) > h * 3600000;

async function start(type, payload, { leadId = null, importId = null, dryRun = false } = {}) {
  const [a] = await sql`
    INSERT INTO actions (type, lead_id, import_id, payload, dry_run)
    VALUES (${type}, ${leadId}, ${importId}, ${sql.json(payload)}, ${dryRun})
    RETURNING id`;
  return { action: { id: Number(a.id), type, payload: { ...payload, dryRun } } };
}

export async function nextAction(now = new Date()) {
  const s = await loadSettings();
  if (s.paused) return wait(60, 'paused');

  const [runner] = await sql`SELECT session FROM runner_status WHERE id = 1`;
  if (runner.session !== 'ok') return wait(60, `LinkedIn session is ${runner.session}`);

  const outside = scheduleWait(now, s.schedule, TIME_ZONE);
  if (outside > 0) return wait(Math.min(outside, 900), 'outside working hours');

  // One action at a time; a lost action times out so work can continue.
  const [open] = await sql`SELECT id, at FROM actions WHERE finished_at IS NULL ORDER BY at DESC LIMIT 1`;
  if (open) {
    if (now - open.at < ACTION_TIMEOUT_MIN * 60000) return wait(30, 'previous action still running');
    await sql`UPDATE actions SET finished_at = now(), result = 'timeout' WHERE id = ${open.id}`;
  }

  if (s.not_before && Date.parse(s.not_before) > now.getTime()) {
    return wait((Date.parse(s.not_before) - now.getTime()) / 1000, 'pacing');
  }

  const limits = effectiveLimits(s, now, await acceptanceStats());
  const u = await usage();
  if (u.page_views_today >= limits.page_views_per_day) return wait(900, 'daily page-view limit reached');
  const dryRun = Boolean(s.dry_run);

  // 1. Keep reply and acceptance tracking fresh; both are single page views.
  const [{ messaged }] = await sql`
    SELECT count(*)::int AS messaged FROM leads
    WHERE status IN ('messaged', 'done') AND last_message_at > now() - interval '30 days'`;
  if (messaged && hoursAgo(s.last_sync_inbox, SYNC_INBOX_EVERY_H)) {
    await setSetting('last_sync_inbox', now.toISOString());
    return start('sync_inbox', {});
  }
  const [{ invited }] = await sql`SELECT count(*)::int AS invited FROM leads WHERE status = 'invited'`;
  if (invited && hoursAgo(s.last_sync_connections, SYNC_CONNECTIONS_EVERY_H)) {
    await setSetting('last_sync_connections', now.toISOString());
    return start('sync_connections', {});
  }

  // 2. Messages and follow-ups that are due.
  if (u.messages_today < limits.messages_per_day) {
    const [lead] = await sql`
      SELECT l.*, c.first_message, c.followups FROM leads l JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.active AND l.status IN ('connected', 'messaged') AND l.next_action_at <= ${now}
        AND l.msg_step < 1 + jsonb_array_length(c.followups)
      ORDER BY l.next_action_at LIMIT 1`;
    if (lead) {
      const template = lead.msg_step === 0 ? lead.first_message : lead.followups[lead.msg_step - 1]?.text;
      const v = pickVariant(template || '');
      if (!v.text) {
        await sql`UPDATE leads SET status = 'done', error = 'No message text in campaign', updated_at = now() WHERE id = ${lead.id}`;
      } else {
        return start('message', { profileUrl: lead.profile_url, name: lead.full_name, step: lead.msg_step, variant: v.index, text: render(v.text, lead) }, { leadId: lead.id, dryRun });
      }
    }
  }

  // 3. Withdraw invitations nobody answered, so the pending pile stays small.
  if (u.withdraws_today < limits.withdraws_per_day) {
    const [lead] = await sql`
      SELECT * FROM leads WHERE status = 'invited'
        AND invited_at < ${now} - make_interval(days => ${s.withdraw_after_days})
      ORDER BY invited_at LIMIT 1`;
    if (lead) return start('withdraw', { profileUrl: lead.profile_url, name: lead.full_name }, { leadId: lead.id, dryRun });
  }

  // 4. Invitations, within the weekly and daily caps.
  const invitesPaused = s.invites_paused_until && Date.parse(s.invites_paused_until) > now.getTime();
  const canInvite = !invitesPaused && u.invites_week < limits.invites_per_week && u.invites_today < limits.invites_per_day;
  if (canInvite) {
    const [lead] = await sql`
      SELECT l.*, c.invite_note FROM leads l JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.active AND l.next_action_at <= ${now}
        AND (l.status = 'visited' OR (l.status = 'new' AND NOT c.visit_first))
      ORDER BY l.next_action_at LIMIT 1`;
    if (lead) {
      const v = pickVariant(lead.invite_note);
      const note = v.text ? clip(render(v.text, lead), INVITE_NOTE_MAX) : '';
      return start('invite', { profileUrl: lead.profile_url, name: lead.full_name, note, variant: v.index }, { leadId: lead.id, dryRun });
    }
  }

  // 5. Profile visits, only as many as can be invited soon.
  if (canInvite) {
    const [{ queued }] = await sql`SELECT count(*)::int AS queued FROM leads WHERE status = 'visited'`;
    if (queued < Math.max(2, limits.invites_per_day - u.invites_today)) {
      const [lead] = await sql`
        SELECT l.* FROM leads l JOIN campaigns c ON c.id = l.campaign_id
        WHERE c.active AND c.visit_first AND l.status = 'new' AND l.next_action_at <= ${now}
        ORDER BY l.created_at, l.id LIMIT 1`;
      if (lead) return start('visit', { profileUrl: lead.profile_url }, { leadId: lead.id });
    }
  }

  // 6. Lead imports, one results page per action.
  const [imp] = await sql`SELECT * FROM imports WHERE status IN ('queued', 'running') ORDER BY id LIMIT 1`;
  if (imp) {
    await sql`UPDATE imports SET status = 'running' WHERE id = ${imp.id}`;
    return start('import_page', { searchUrl: imp.search_url, page: imp.next_page }, { importId: imp.id });
  }

  return wait(300, 'nothing due');
}
