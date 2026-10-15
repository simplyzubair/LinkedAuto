import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { timingSafeEqual } from 'node:crypto';
import { sql, migrate, getSetting, setSetting, logEvent } from './db.js';
import { overviewPage, leadsPage, campaignsPage, campaignForm, settingsPage, logPage } from './views.js';
import { loadSettings, nextAction, usage, acceptanceStats, TIME_ZONE } from './planner.js';
import { finishAction } from './results.js';
import { effectiveLimits } from './governor.js';
import { isLinkedInSearchUrl, leadsFromCsv, toCsv } from './text.js';
import { alert } from './alerts.js';

const RUNNER_TOKEN = process.env.RUNNER_TOKEN;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const SESSION_STATES = new Set(['ok', 'logged_out', 'checkpoint', 'restricted', 'browser_closed', 'unknown']);
const STOP_STATES = new Set(['logged_out', 'checkpoint', 'restricted']);
const SAMPLE_LEAD = { full_name: 'Sara Ahmed', first_name: 'Sara', company: 'Acme Realty', headline: 'CEO at Acme Realty', location: 'Austin, Texas' };

if (!RUNNER_TOKEN || RUNNER_TOKEN.length < 24) {
  console.error('RUNNER_TOKEN must be set to a random string of at least 24 characters');
  process.exit(1);
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 5 * 1024 * 1024 });
await app.register(formbody, { bodyLimit: 5 * 1024 * 1024 });

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/runner/')) {
    const auth = req.headers.authorization || '';
    if (!safeEqual(auth, `Bearer ${RUNNER_TOKEN}`)) return reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  if (req.url === '/healthz') return;
  // Cloudflare Access guards the dashboard from the internet; this optional
  // password also guards it on the home network.
  if (DASHBOARD_PASSWORD) {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const password = scheme === 'Basic' ? Buffer.from(encoded || '', 'base64').toString().split(':').slice(1).join(':') : '';
    if (!safeEqual(password, DASHBOARD_PASSWORD)) {
      return reply.code(401).header('WWW-Authenticate', 'Basic realm="LinkedAuto"').send('Login required');
    }
  }
});

app.get('/healthz', async () => {
  await sql`SELECT 1`;
  return { ok: true };
});

// ---------- Runner API ----------

let lastPlan = null;

app.post('/api/runner/heartbeat', async (req) => {
  const { session = 'unknown', detail = null, url = null, version = null } = req.body || {};
  const state = SESSION_STATES.has(session) ? session : 'unknown';
  const [prev] = await sql`SELECT session FROM runner_status WHERE id = 1`;
  await sql`
    UPDATE runner_status
    SET last_seen = now(), session = ${state}, detail = ${detail}, url = ${url}, version = ${version}
    WHERE id = 1`;
  if (prev.session !== state) await logEvent('runner', `session:${state}`, detail);
  // Hard stop: any sign LinkedIn is unhappy pauses everything until you resume by hand.
  if (STOP_STATES.has(state) && !(await getSetting('paused'))) {
    await setSetting('paused', true);
    const why = `LinkedIn session is ${state}${detail ? `: ${detail}` : ''}`;
    await logEvent('safety', 'auto-paused', why);
    await alert(`LinkedAuto paused itself. ${why}. Open the browser view to check.`);
  }
  await setSetting('offline_alerted', false);
  return { paused: Boolean(await getSetting('paused')) };
});

app.post('/api/runner/event', async (req) => {
  const { kind, detail = null } = req.body || {};
  if (typeof kind !== 'string' || !kind) return { ok: false };
  await logEvent('runner', kind.slice(0, 64), detail ? String(detail).slice(0, 2000) : null);
  return { ok: true };
});

app.post('/api/runner/next', async () => {
  const plan = await nextAction();
  lastPlan = plan.action ? `${plan.action.type} running` : plan.reason;
  return plan;
});

app.post('/api/runner/result', async (req) => {
  const { id, result, detail = null, data = {} } = req.body || {};
  if (!id || typeof result !== 'string') return { ok: false, error: 'id and result are required' };
  return finishAction(Number(id), { result, detail, data });
});

// ---------- Dashboard ----------

const html = (reply, page) => reply.type('text/html').send(page);

app.get('/', async (req, reply) => {
  const settings = await loadSettings();
  const [status] = await sql`SELECT * FROM runner_status WHERE id = 1`;
  const events = await sql`SELECT * FROM events ORDER BY at DESC LIMIT 25`;
  const acceptance = await acceptanceStats();
  const counts = Object.fromEntries((await sql`SELECT status, count(*)::int AS n FROM leads GROUP BY status`).map((r) => [r.status, r.n]));
  const [replies] = await sql`
    SELECT count(*) FILTER (WHERE msg_step > 0)::int AS messaged, count(replied_at)::int AS replied
    FROM leads WHERE coalesce(last_message_at, replied_at) > now() - interval '30 days'`;
  html(reply, overviewPage({
    status, events, settings, counts,
    limits: effectiveLimits(settings, new Date(), acceptance),
    usage: await usage(),
    plan: settings.paused ? null : lastPlan,
    stats: { ...acceptance, ...replies },
    novncUrl: process.env.NOVNC_PUBLIC_URL || '',
  }));
});

app.post('/pause', async (req, reply) => {
  await setSetting('paused', true);
  await logEvent('dashboard', 'paused');
  reply.redirect('/');
});

app.post('/resume', async (req, reply) => {
  const [status] = await sql`SELECT session FROM runner_status WHERE id = 1`;
  if (STOP_STATES.has(status.session)) {
    await logEvent('dashboard', 'resume-refused', `LinkedIn session is ${status.session}; fix it in the browser view first`);
    return reply.redirect('/');
  }
  const s = await loadSettings();
  if (s.warmup.enabled && !s.warmup.start_date) await setSetting('warmup', { ...s.warmup, start_date: new Date().toISOString().slice(0, 10) });
  await setSetting('paused', false);
  await logEvent('dashboard', 'resumed');
  reply.redirect('/');
});

function leadFilter(q) {
  const filter = { status: q.status || '', campaign: q.campaign || '', q: (q.q || '').trim() };
  const where = [sql`true`];
  if (filter.status) where.push(sql`l.status = ${filter.status}`);
  if (filter.campaign) where.push(sql`l.campaign_id = ${Number(filter.campaign)}`);
  if (filter.q) {
    const like = `%${filter.q}%`;
    where.push(sql`(l.full_name ILIKE ${like} OR l.headline ILIKE ${like} OR l.company ILIKE ${like} OR ${filter.q} = ANY(l.tags))`);
  }
  return { filter, where: where.reduce((a, b) => sql`${a} AND ${b}`) };
}

app.get('/leads', async (req, reply) => {
  const { filter, where } = leadFilter(req.query);
  const leads = await sql`
    SELECT l.*, c.name AS campaign_name FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
    WHERE ${where} ORDER BY l.updated_at DESC LIMIT 200`;
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM leads l WHERE ${where}`;
  const campaigns = await sql`SELECT id, name FROM campaigns ORDER BY id DESC`;
  const imports = await sql`SELECT * FROM imports ORDER BY id DESC LIMIT 10`;
  html(reply, leadsPage({ leads, total, filter, campaigns, imports, message: req.query.msg }));
});

app.get('/leads.csv', async (req, reply) => {
  const { where } = leadFilter(req.query);
  const leads = await sql`
    SELECT l.*, c.name AS campaign_name FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id
    WHERE ${where} ORDER BY l.id`;
  const cols = ['profile_url', 'full_name', 'first_name', 'headline', 'company', 'location', 'tags', 'campaign_name', 'status', 'msg_step', 'invited_at', 'accepted_at', 'replied_at', 'error'];
  reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="linkedauto-leads-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(toCsv([cols, ...leads.map((l) => cols.map((c) => l[c]))]));
});

const tagsOf = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
const campaignIdOf = (v) => (v ? Number(v) : null);

app.post('/imports', async (req, reply) => {
  const { search_url, campaign_id, max_pages, tags } = req.body || {};
  if (!isLinkedInSearchUrl(search_url)) return reply.redirect('/leads?msg=' + encodeURIComponent('That is not a LinkedIn people search URL.'));
  const pages = Math.min(10, Math.max(1, Number(max_pages) || 3));
  await sql`INSERT INTO imports (search_url, campaign_id, max_pages, tags) VALUES (${search_url.trim()}, ${campaignIdOf(campaign_id)}, ${pages}, ${tagsOf(tags)})`;
  await logEvent('dashboard', 'import-queued', search_url);
  reply.redirect('/leads?msg=' + encodeURIComponent('Import queued. The runner reads one page per action while automation is running.'));
});

app.post('/leads/csv', async (req, reply) => {
  const { csv, campaign_id, tags } = req.body || {};
  let leads;
  try {
    leads = leadsFromCsv(csv || '');
  } catch (err) {
    return reply.redirect('/leads?msg=' + encodeURIComponent(err.message));
  }
  let added = 0;
  for (const l of leads) {
    const rows = await sql`
      INSERT INTO leads (profile_url, full_name, first_name, headline, company, location, source, campaign_id, tags)
      VALUES (${l.profile_url}, ${l.full_name}, ${l.first_name}, ${l.headline}, ${l.company}, ${l.location}, 'csv', ${campaignIdOf(campaign_id)}, ${tagsOf(tags)})
      ON CONFLICT (profile_url) DO NOTHING RETURNING id`;
    added += rows.length;
  }
  await logEvent('dashboard', 'csv-import', `${added} new of ${leads.length}`);
  reply.redirect('/leads?msg=' + encodeURIComponent(`Imported ${added} new leads (${leads.length - added} were already here).`));
});

app.post('/leads/:id/stop', async (req, reply) => {
  await sql`UPDATE leads SET status = 'stopped', updated_at = now() WHERE id = ${Number(req.params.id)}`;
  reply.redirect(req.headers.referer || '/leads');
});

app.get('/campaigns', async (req, reply) => {
  const campaigns = await sql`
    SELECT c.*, count(l.id)::int AS leads, count(l.invited_at)::int AS invited, count(l.accepted_at)::int AS accepted,
      count(*) FILTER (WHERE l.msg_step > 0)::int AS messaged, count(l.replied_at)::int AS replied
    FROM campaigns c LEFT JOIN leads l ON l.campaign_id = c.id GROUP BY c.id ORDER BY c.id DESC`;
  html(reply, campaignsPage({ campaigns }));
});

app.get('/campaigns/new', async (req, reply) => html(reply, campaignForm({ sample: SAMPLE_LEAD })));

app.get('/campaigns/:id', async (req, reply) => {
  const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${Number(req.params.id)}`;
  if (!campaign) return reply.code(404).send('Not found');
  const variantStats = [
    ...(await sql`
      SELECT 'Invite note' AS kind, invite_variant AS variant, count(*)::int AS sent, count(accepted_at)::int AS accepted
      FROM leads WHERE campaign_id = ${campaign.id} AND invite_variant IS NOT NULL AND invited_at IS NOT NULL GROUP BY invite_variant ORDER BY 2`),
    ...(await sql`
      SELECT 'First message' AS kind, message_variant AS variant, count(*)::int AS sent, count(replied_at)::int AS replied
      FROM leads WHERE campaign_id = ${campaign.id} AND message_variant IS NOT NULL GROUP BY message_variant ORDER BY 2`),
  ];
  html(reply, campaignForm({ campaign, variantStats, sample: SAMPLE_LEAD }));
});

function campaignFields(b) {
  const followups = [0, 1, 2]
    .map((i) => ({ days: Math.min(60, Math.max(1, Number(b[`f${i}_days`]) || 3)), text: String(b[`f${i}_text`] || '').trim() }))
    .filter((f) => f.text);
  return {
    name: String(b.name || 'Untitled').trim(),
    visit_first: b.visit_first === 'on',
    invite_note: String(b.invite_note || '').trim(),
    first_message: String(b.first_message || '').trim(),
    followups: sql.json(followups),
  };
}

app.post('/campaigns', async (req, reply) => {
  const [c] = await sql`INSERT INTO campaigns ${sql(campaignFields(req.body || {}))} RETURNING id`;
  reply.redirect(`/campaigns/${c.id}`);
});

app.post('/campaigns/:id', async (req, reply) => {
  await sql`UPDATE campaigns SET ${sql(campaignFields(req.body || {}))} WHERE id = ${Number(req.params.id)}`;
  reply.redirect(`/campaigns/${req.params.id}`);
});

for (const op of ['start', 'stop']) {
  app.post(`/campaigns/:id/${op}`, async (req, reply) => {
    await sql`UPDATE campaigns SET active = ${op === 'start'} WHERE id = ${Number(req.params.id)}`;
    await logEvent('dashboard', `campaign-${op}`, req.params.id);
    reply.redirect('/campaigns');
  });
}

app.get('/settings', async (req, reply) => {
  const settings = await loadSettings();
  html(reply, settingsPage({ settings, limits: effectiveLimits(settings, new Date(), await acceptanceStats()), timeZone: TIME_ZONE }));
});

app.post('/settings', async (req, reply) => {
  const b = req.body || {};
  const s = await loadSettings();
  const n = (v, min, max, dflt) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v !== '' ? Number(v) : dflt));
  const time = (v, dflt) => (/^\d{2}:\d{2}$/.test(v || '') ? v : dflt);
  await setSetting('dry_run', b.dry_run === 'on');
  await setSetting('limits', {
    invites_per_week: n(b.invites_per_week, 1, 150, 80),
    invites_per_day: n(b.invites_per_day, 1, 30, 15),
    messages_per_day: n(b.messages_per_day, 1, 60, 25),
    page_views_per_day: n(b.page_views_per_day, 5, 150, 80),
    withdraws_per_day: n(b.withdraws_per_day, 0, 30, 10),
  });
  await setSetting('withdraw_after_days', n(b.withdraw_after_days, 14, 60, 21));
  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => b[`day${i}`] === 'on');
  await setSetting('schedule', {
    days: days.length ? days : s.schedule.days,
    start: time(b.start, s.schedule.start),
    end: time(b.end, s.schedule.end),
    break_start: b.break_start ? time(b.break_start, null) : null,
    break_end: b.break_end ? time(b.break_end, null) : null,
  });
  const minGap = n(b.min_gap_s, 20, 600, 45);
  await setSetting('pacing', { ...s.pacing, min_gap_s: minGap, max_gap_s: Math.max(minGap + 10, n(b.max_gap_s, 30, 1200, 150)), burst: n(b.burst, 2, 20, 5) });
  await setSetting('warmup', { enabled: b.warmup_enabled === 'on', start_date: /^\d{4}-\d{2}-\d{2}$/.test(b.warmup_start || '') ? b.warmup_start : s.warmup.start_date });
  await logEvent('dashboard', 'settings-saved', b.dry_run === 'on' ? 'dry run on' : 'dry run off');
  reply.redirect('/settings');
});

app.post('/settings/recover', async (req, reply) => {
  await setSetting('cap_factor', 1);
  await setSetting('invites_paused_until', null);
  await logEvent('dashboard', 'caps-restored');
  reply.redirect('/settings');
});

app.get('/log', async (req, reply) => {
  const actions = await sql`
    SELECT a.*, l.full_name, l.profile_url FROM actions a LEFT JOIN leads l ON l.id = a.lead_id
    ORDER BY a.at DESC LIMIT 200`;
  html(reply, logPage({ actions }));
});

// Alert once when the runner stops checking in for 10 minutes.
setInterval(async () => {
  try {
    const [status] = await sql`SELECT last_seen FROM runner_status WHERE id = 1`;
    if (!status.last_seen || Date.now() - status.last_seen.getTime() < 10 * 60000) return;
    if (await getSetting('offline_alerted')) return;
    await setSetting('offline_alerted', true);
    await logEvent('safety', 'runner-offline', `No heartbeat since ${status.last_seen.toISOString()}`);
    await alert('LinkedAuto: the browser runner has been offline for 10 minutes. Check the NAS.');
  } catch (err) {
    app.log.error(err);
  }
}, 120_000).unref();

await migrate();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
