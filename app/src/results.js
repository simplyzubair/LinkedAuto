// Applies what the runner reports back to leads, imports and settings.
import { sql, setSetting, logEvent } from './db.js';
import { loadSettings } from './planner.js';
import { restAfterAction } from './governor.js';
import { normalizeProfileUrl, firstNameOf, companyFromHeadline } from './text.js';
import { alert } from './alerts.js';

const hours = (a, b) => (a + Math.random() * (b - a)) * 3600000;
const later = (ms) => new Date(Date.now() + ms);

export async function finishAction(id, { result, detail = null, data = {} }) {
  const [action] = await sql`SELECT * FROM actions WHERE id = ${id}`;
  if (!action || action.finished_at) return { ok: false, error: 'unknown or finished action' };
  await sql`UPDATE actions SET finished_at = now(), result = ${result}, detail = ${detail ? String(detail).slice(0, 2000) : null} WHERE id = ${id}`;

  // Rest before the next action, rolled once here. Bursts earn a longer break.
  if (result !== 'not_started') {
    const s = await loadSettings();
    const recent = await sql`SELECT at FROM actions WHERE at > now() - interval '2 hours' AND coalesce(result, '') <> 'not_started' ORDER BY at DESC LIMIT 20`;
    const rest = restAfterAction(new Date(), recent.map((r) => r.at), s.pacing);
    await setSetting('not_before', later(rest * 1000).toISOString());
  }

  const lead = action.lead_id ? (await sql`SELECT * FROM leads WHERE id = ${action.lead_id}`)[0] : null;
  const handler = HANDLERS[action.type];
  if (handler) await handler({ action, lead, result, detail, data });
  return { ok: true };
}

async function updateLead(id, fields) {
  await sql`UPDATE leads SET ${sql(fields)}, updated_at = now() WHERE id = ${id}`;
}

function profileFields(data) {
  const out = {};
  if (data.fullName) {
    out.full_name = data.fullName;
    out.first_name = firstNameOf(data.fullName) || null;
  }
  if (data.headline) {
    out.headline = data.headline;
    const company = companyFromHeadline(data.headline);
    if (company) out.company = company;
  }
  if (data.location) out.location = data.location;
  return out;
}

// Results shared by every lead action.
async function common({ lead, result, detail }) {
  if (result === 'failed' || result === 'timeout') {
    await updateLead(lead.id, { error: detail || result, next_action_at: later(hours(20, 30)) });
    return true;
  }
  if (result === 'dry_run') {
    // Nothing was sent: try again tomorrow, so dry runs never pile up.
    await updateLead(lead.id, { error: `Dry run: ${detail || 'would have sent'}`, next_action_at: later(hours(20, 30)) });
    return true;
  }
  if (result === 'not_found') {
    await updateLead(lead.id, { status: 'skipped', error: 'Profile not found' });
    return true;
  }
  return false;
}

const HANDLERS = {
  async visit({ lead, result, detail, data }) {
    if (await common({ lead, result, detail })) return;
    const fields = { ...profileFields(data), error: null };
    switch (data.relationship) {
      case 'connected':
        Object.assign(fields, { status: 'connected', accepted_at: new Date(), next_action_at: later(hours(1, 6)) });
        break;
      case 'pending':
        Object.assign(fields, { status: 'invited', invited_at: lead.invited_at || new Date() });
        break;
      case 'none':
        // Invite a few hours after the visit, like a person coming back to it.
        Object.assign(fields, { status: 'visited', next_action_at: later(hours(1, 5)) });
        break;
      default:
        Object.assign(fields, { status: 'skipped', error: data.relationship === 'follow_only' ? 'LinkedIn only offers Follow for this person' : "Can't invite: no Connect option" });
    }
    await updateLead(lead.id, fields);
  },

  async invite({ action, lead, result, detail, data }) {
    if (await common({ lead, result, detail })) return;
    if (result === 'ok') {
      await updateLead(lead.id, { ...profileFields(data), status: 'invited', invited_at: new Date(), invite_variant: action.payload.variant, error: null });
    } else if (result === 'connected') {
      await updateLead(lead.id, { status: 'connected', accepted_at: new Date(), next_action_at: later(hours(1, 6)) });
    } else if (result === 'pending') {
      await updateLead(lead.id, { status: 'invited', invited_at: lead.invited_at || new Date() });
    } else if (result === 'limit') {
      // LinkedIn's weekly cap: stop invitations for a week and lower our cap by 20%.
      const s = await loadSettings();
      const until = later(7 * 86400000).toISOString();
      const factor = Math.max(0.3, Math.round((s.cap_factor ?? 1) * 0.8 * 100) / 100);
      await setSetting('invites_paused_until', until);
      await setSetting('cap_factor', factor);
      await updateLead(lead.id, { status: 'visited', next_action_at: until, error: 'Weekly invitation limit' });
      await logEvent('safety', 'invite-limit', `LinkedIn's invitation limit was hit. Invitations stop until ${until.slice(0, 10)}; caps lowered to ${Math.round(factor * 100)}%.`);
      await alert(`LinkedAuto: LinkedIn's weekly invitation limit was hit. Invitations are paused for 7 days and caps lowered to ${Math.round(factor * 100)}%.`);
    } else {
      await updateLead(lead.id, { status: 'skipped', error: detail || result });
    }
  },

  async message({ action, lead, result, detail }) {
    if (await common({ lead, result, detail })) return;
    if (result === 'replied') {
      await updateLead(lead.id, { status: 'replied', replied_at: new Date(), error: null });
      await logEvent('lead', 'replied', `${lead.full_name || lead.profile_url} replied`);
      await alert(`LinkedAuto: ${lead.full_name || 'A lead'} replied. ${lead.profile_url}`);
      return;
    }
    if (result === 'not_connected') {
      await updateLead(lead.id, { status: 'skipped', error: 'Not connected, cannot message' });
      return;
    }
    if (result !== 'ok') {
      await updateLead(lead.id, { error: detail || result, next_action_at: later(hours(20, 30)) });
      return;
    }
    const [campaign] = await sql`SELECT followups FROM campaigns WHERE id = ${lead.campaign_id}`;
    const followups = campaign?.followups || [];
    const step = action.payload.step + 1;
    const fields = { msg_step: step, last_message_at: new Date(), error: null };
    if (action.payload.step === 0) fields.message_variant = action.payload.variant;
    if (step <= followups.length) {
      const days = Number(followups[step - 1].days) || 3;
      Object.assign(fields, { status: 'messaged', next_action_at: later(days * 86400000 + hours(0, 4)) });
    } else {
      fields.status = 'done';
    }
    await updateLead(lead.id, fields);
  },

  async withdraw({ lead, result, detail }) {
    if (await common({ lead, result, detail })) return;
    if (result === 'ok' || result === 'not_pending') {
      await updateLead(lead.id, { status: 'withdrawn', error: result === 'not_pending' ? 'No pending invitation found' : null });
    } else {
      await updateLead(lead.id, { error: detail || result, next_action_at: later(hours(20, 30)) });
    }
  },

  async sync_connections({ result, data }) {
    if (result !== 'ok') return;
    const urls = (data.profiles || []).map(normalizeProfileUrl).filter(Boolean);
    if (!urls.length) return;
    const accepted = await sql`
      UPDATE leads SET status = 'connected', accepted_at = now(), updated_at = now(),
        next_action_at = now() + (interval '1 hour' * (1 + random() * 5))
      WHERE status = 'invited' AND profile_url IN ${sql(urls)}
      RETURNING full_name`;
    if (accepted.length) await logEvent('lead', 'accepted', accepted.map((l) => l.full_name).join(', '));
  },

  async sync_inbox({ result, data }) {
    if (result !== 'ok') return;
    // Conversations whose latest message is not from us, matched to leads we messaged.
    for (const c of data.conversations || []) {
      if (c.lastFromMe || !c.name) continue;
      const url = normalizeProfileUrl(c.profileUrl || '');
      const [lead] = url
        ? await sql`SELECT * FROM leads WHERE profile_url = ${url} AND status IN ('messaged', 'done')`
        : await sql`SELECT * FROM leads WHERE lower(full_name) = lower(${c.name}) AND status IN ('messaged', 'done') ORDER BY last_message_at DESC LIMIT 1`;
      if (!lead) continue;
      await updateLead(lead.id, { status: 'replied', replied_at: new Date() });
      await logEvent('lead', 'replied', `${lead.full_name} replied`);
      await alert(`LinkedAuto: ${lead.full_name} replied. ${lead.profile_url}`);
    }
  },

  async import_page({ action, result, detail, data }) {
    const [imp] = await sql`SELECT * FROM imports WHERE id = ${action.import_id}`;
    if (!imp) return;
    if (result !== 'ok') {
      await sql`UPDATE imports SET status = 'failed', error = ${detail || result} WHERE id = ${imp.id}`;
      return;
    }
    const profiles = (data.profiles || [])
      .map((p) => ({ ...p, profile_url: normalizeProfileUrl(p.profileUrl) }))
      .filter((p) => p.profile_url);
    let added = 0;
    for (const p of profiles) {
      const rows = await sql`
        INSERT INTO leads (profile_url, full_name, first_name, headline, company, location, source, campaign_id, tags)
        VALUES (${p.profile_url}, ${p.fullName || null}, ${firstNameOf(p.fullName) || null}, ${p.headline || null},
                ${companyFromHeadline(p.headline)}, ${p.location || null}, ${'search:' + imp.id}, ${imp.campaign_id}, ${imp.tags})
        ON CONFLICT (profile_url) DO NOTHING RETURNING id`;
      added += rows.length;
    }
    const done = !data.hasMore || imp.next_page >= imp.max_pages;
    await sql`
      UPDATE imports SET found = found + ${profiles.length}, added = added + ${added},
        next_page = next_page + 1, status = ${done ? 'done' : 'running'}
      WHERE id = ${imp.id}`;
  },
};

