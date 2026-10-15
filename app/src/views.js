// Server-rendered pages. Plain HTML forms, no client framework.
import { variants, render, INVITE_NOTE_MAX } from './text.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SESSION_TEXT = {
  ok: ['good', 'Logged in to LinkedIn'],
  logged_out: ['bad', 'Logged out. Open the browser view and log in by hand.'],
  checkpoint: ['bad', 'LinkedIn wants a security check. Open the browser view and complete it by hand.'],
  restricted: ['bad', 'LinkedIn shows a restriction notice. Keep everything paused and read it in the browser view.'],
  browser_closed: ['bad', 'The browser window was closed. The runner will reopen it.'],
  unknown: ['warn', 'Not checked yet'],
};

export const STATUS_TEXT = {
  new: 'New',
  visited: 'Visited',
  invited: 'Invited',
  connected: 'Connected',
  messaged: 'Messaged',
  replied: 'Replied',
  done: 'Sequence done',
  withdrawn: 'Invite withdrawn',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

const ago = (date) => {
  if (!date) return 'never';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 0) return `in ${inWords(-s)}`;
  return `${inWords(s)} ago`;
};
const inWords = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Asia/Karachi' }) : '');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');

function layout(title, active, body, { refresh = false } = {}) {
  const nav = [['/', 'Overview'], ['/leads', 'Leads'], ['/campaigns', 'Campaigns'], ['/settings', 'Settings'], ['/log', 'Log']]
    .map(([href, label]) => `<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="20">' : ''}
<title>${esc(title)} · LinkedAuto</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e3e3df; --accent:#0a66c2; --good:#1f7a3a; --bad:#b42318; --warn:#9a6700; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#1f1f1d; --ink:#ececea; --muted:#a3a39e; --line:#33332f; --accent:#70b5f9; --good:#4ac26b; --bad:#ff7b72; --warn:#d29922; } }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  header { border-bottom:1px solid var(--line); background:var(--card); }
  header .in { max-width:1100px; margin:0 auto; padding:10px 16px; display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  header b { font-size:17px; margin-right:8px; }
  header a { color:var(--muted); text-decoration:none; } header a.on { color:var(--ink); font-weight:600; }
  main { max-width:1100px; margin:0 auto; padding:20px 16px 48px; }
  h1 { font-size:20px; margin:0 0 16px; } h2 { font-size:16px; margin:28px 0 10px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .label, .muted { color:var(--muted); font-size:13px; }
  .value { font-weight:600; margin-top:2px; }
  .good { color:var(--good); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  .badge { display:inline-block; font-size:12px; padding:1px 8px; border-radius:99px; border:1px solid var(--line); }
  button, .btn { font:inherit; padding:7px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; text-decoration:none; display:inline-block; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  input, select, textarea { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--ink); max-width:100%; }
  textarea { width:100%; min-height:90px; }
  label { display:block; margin:12px 0 4px; font-weight:600; font-size:14px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:end; }
  .row > div { flex:1 1 160px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); font-size:13px; }
  td, th { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  .scroll { overflow-x:auto; border-radius:10px; }
  .meter { height:6px; background:var(--line); border-radius:3px; margin-top:6px; overflow:hidden; } .meter i { display:block; height:100%; background:var(--accent); }
  .note { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--warn); padding:10px 14px; border-radius:8px; margin:0 0 16px; }
  form.inline { display:inline; }
  a { color:var(--accent); }
  pre { white-space:pre-wrap; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px; font:13px/1.45 system-ui, sans-serif; margin:4px 0; }
</style></head>
<body><header><div class="in"><b>LinkedAuto</b>${nav}</div></header><main>${body}</main></body></html>`;
}

const meter = (used, max) => `<div class="meter"><i style="width:${Math.min(100, max ? (used / max) * 100 : 0)}%"></i></div>`;

export function overviewPage({ status, events, settings, limits, usage, plan, counts, stats, novncUrl }) {
  const online = status.last_seen && Date.now() - new Date(status.last_seen).getTime() < 3 * 60 * 1000;
  const [tone, sessionText] = SESSION_TEXT[status.session] || SESSION_TEXT.unknown;
  const invitesPaused = settings.invites_paused_until && Date.parse(settings.invites_paused_until) > Date.now();
  const rows = events
    .map((e) => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.source)}</td><td>${esc(e.kind)}</td><td>${esc(e.detail)}</td></tr>`)
    .join('');
  const statusCells = Object.entries(STATUS_TEXT)
    .map(([k, label]) => `<div class="card"><div class="label">${label}</div><div class="value"><a href="/leads?status=${k}">${counts[k] || 0}</a></div></div>`)
    .join('');
  return layout('Overview', '/', `
${settings.dry_run ? '<div class="note"><b>Dry run is on.</b> The runner goes through every step but never presses Send, Connect or Withdraw. Turn it off in Settings when you have watched a few actions and they look right.</div>' : ''}
<div class="cards">
  <div class="card"><div class="label">Runner</div>
    <div class="value ${online ? 'good' : 'bad'}">${online ? 'Online' : 'Offline'}</div>
    <div class="label">Last seen ${esc(ago(status.last_seen))}${status.version ? ` · v${esc(status.version)}` : ''}</div></div>
  <div class="card"><div class="label">LinkedIn session</div>
    <div class="value ${tone}">${esc(sessionText)}</div>
    ${status.detail ? `<div class="label">${esc(status.detail)}</div>` : ''}
    ${novncUrl ? `<div class="label"><a href="${esc(novncUrl)}" target="_blank" rel="noopener">Open browser view</a></div>` : ''}</div>
  <div class="card"><div class="label">Automation</div>
    <div class="value ${settings.paused ? 'warn' : 'good'}">${settings.paused ? 'Paused' : 'Running'}${settings.dry_run ? ' <span class="badge">dry run</span>' : ''}</div>
    <div class="label">${esc(plan ? `Next: ${plan}` : '')}</div>
    <form method="post" action="${settings.paused ? '/resume' : '/pause'}" style="margin-top:8px"><button class="${settings.paused ? 'primary' : ''}">${settings.paused ? 'Resume' : 'Pause everything'}</button></form></div>
</div>

<h2>Today's limits</h2>
<div class="cards">
  <div class="card"><div class="label">Invitations this week</div><div class="value">${usage.invites_week} / ${limits.invites_per_week}</div>${meter(usage.invites_week, limits.invites_per_week)}
    ${invitesPaused ? `<div class="label bad">Paused until ${esc(when(settings.invites_paused_until))} after LinkedIn's limit</div>` : ''}</div>
  <div class="card"><div class="label">Invitations today</div><div class="value">${usage.invites_today} / ${limits.invites_per_day}</div>${meter(usage.invites_today, limits.invites_per_day)}</div>
  <div class="card"><div class="label">Messages today</div><div class="value">${usage.messages_today} / ${limits.messages_per_day}</div>${meter(usage.messages_today, limits.messages_per_day)}</div>
  <div class="card"><div class="label">LinkedIn page views today</div><div class="value">${usage.page_views_today} / ${limits.page_views_per_day}</div>${meter(usage.page_views_today, limits.page_views_per_day)}</div>
</div>
<p class="muted">Limits are running at ${Math.round(limits.factor * 100)}% of your settings (warm-up, acceptance rate and any cut after a LinkedIn limit).</p>

<h2>Results, last 30 days</h2>
<div class="cards">
  <div class="card"><div class="label">Acceptance rate</div><div class="value">${pct(stats.accepted, stats.settled)}</div><div class="label">${stats.accepted} of ${stats.settled} invitations older than 3 days</div></div>
  <div class="card"><div class="label">Reply rate</div><div class="value">${pct(stats.replied, stats.messaged)}</div><div class="label">${stats.replied} of ${stats.messaged} messaged leads</div></div>
</div>

<h2>Leads by stage</h2>
<div class="cards">${statusCells}</div>

<h2>Activity</h2>
<div class="scroll"><table><thead><tr><th>When</th><th>From</th><th>Event</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4">Nothing yet</td></tr>'}</tbody></table></div>`, { refresh: true });
}

export function leadsPage({ leads, total, filter, campaigns, imports, message }) {
  const campaignOptions = (selected) =>
    `<option value="">No campaign</option>` + campaigns.map((c) => `<option value="${c.id}" ${String(selected) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const statusOptions = `<option value="">Any stage</option>` + Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}" ${filter.status === k ? 'selected' : ''}>${v}</option>`).join('');
  const rows = leads
    .map(
      (l) => `<tr>
  <td><a href="${esc(l.profile_url)}" target="_blank" rel="noopener">${esc(l.full_name || l.profile_url.replace('https://www.linkedin.com/in/', ''))}</a><div class="muted">${esc(l.headline || '')}</div></td>
  <td>${esc(STATUS_TEXT[l.status] || l.status)}${l.msg_step ? ` <span class="muted">(${l.msg_step} sent)</span>` : ''}${l.error ? `<div class="muted">${esc(l.error)}</div>` : ''}</td>
  <td>${esc(l.campaign_name || '')}</td>
  <td class="muted">${['replied', 'done', 'withdrawn', 'skipped', 'stopped', 'invited'].includes(l.status) ? '' : esc(ago(l.next_action_at))}</td>
  <td>${['replied', 'stopped', 'done', 'withdrawn', 'skipped'].includes(l.status) ? '' : `<form class="inline" method="post" action="/leads/${l.id}/stop"><button title="Stop all automation for this lead">Stop</button></form>`}</td>
</tr>`,
    )
    .join('');
  const importRows = imports
    .map((i) => `<tr><td>${esc(when(i.created_at))}</td><td style="max-width:360px;overflow-wrap:anywhere">${esc(i.search_url)}</td><td>${esc(i.status)}${i.error ? `: ${esc(i.error)}` : ''}</td><td>${i.added} new of ${i.found}</td><td>${i.next_page - 1} / ${i.max_pages}</td></tr>`)
    .join('');
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  return layout('Leads', '/leads', `
<h1>Leads <span class="muted">(${total})</span></h1>
${message ? `<div class="note">${esc(message)}</div>` : ''}
<form method="get" class="row">
  <div><label>Stage</label><select name="status">${statusOptions}</select></div>
  <div><label>Campaign</label><select name="campaign">${`<option value="">Any</option>` + campaigns.map((c) => `<option value="${c.id}" ${filter.campaign === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
  <div><label>Search</label><input name="q" value="${esc(filter.q || '')}" placeholder="Name, headline, tag"></div>
  <div><button>Filter</button> <a class="btn" href="/leads.csv?${qs}">Export CSV</a></div>
</form>
<div class="scroll" style="margin-top:12px"><table><thead><tr><th>Lead</th><th>Stage</th><th>Campaign</th><th>Next step</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">No leads yet. Import some below.</td></tr>'}</tbody></table></div>
${total > leads.length ? `<p class="muted">Showing the first ${leads.length}. Narrow the filter or export the CSV for all.</p>` : ''}

<h2>Import from a LinkedIn search</h2>
<p class="muted">Search people on LinkedIn, copy the address bar, and paste it here. The runner reads one results page per action, at the normal pace. Sales Navigator lists aren't supported yet; export them to CSV instead.</p>
<form method="post" action="/imports">
  <label>Search URL</label><input name="search_url" required style="width:100%" placeholder="https://www.linkedin.com/search/results/people/?keywords=...">
  <div class="row">
    <div><label>Campaign</label><select name="campaign_id">${campaignOptions('')}</select></div>
    <div><label>Pages (10 people each)</label><input name="max_pages" type="number" min="1" max="10" value="3"></div>
    <div><label>Tags</label><input name="tags" placeholder="real-estate, usa"></div>
    <div><button class="primary">Queue import</button></div>
  </div>
</form>
${importRows ? `<div class="scroll" style="margin-top:12px"><table><thead><tr><th>Queued</th><th>Search</th><th>Status</th><th>Leads</th><th>Pages</th></tr></thead><tbody>${importRows}</tbody></table></div>` : ''}

<h2>Import a CSV</h2>
<p class="muted">Needs a column of LinkedIn profile URLs (for example <code>profile_url</code>). Optional columns: name or first/last name, headline, company, location. Leads already in LinkedAuto are skipped.</p>
<form method="post" action="/leads/csv">
  <input type="file" accept=".csv,text/csv" onchange="const r=new FileReader();r.onload=()=>this.form.csv.value=r.result;r.readAsText(this.files[0])">
  <textarea name="csv" placeholder="profile_url,name,headline&#10;https://www.linkedin.com/in/someone/,Some One,CEO at Acme"></textarea>
  <div class="row"><div><label>Campaign</label><select name="campaign_id">${campaignOptions('')}</select></div><div><label>Tags</label><input name="tags"></div><div><button class="primary">Import CSV</button></div></div>
</form>`);
}

export function campaignsPage({ campaigns }) {
  const rows = campaigns
    .map(
      (c) => `<tr><td><a href="/campaigns/${c.id}">${esc(c.name)}</a></td>
<td>${c.active ? '<span class="good">Active</span>' : '<span class="muted">Off</span>'}</td>
<td>${c.leads}</td><td>${c.invited}</td><td>${pct(c.accepted, c.invited)}</td><td>${c.messaged}</td><td>${pct(c.replied, c.messaged)}</td>
<td><form class="inline" method="post" action="/campaigns/${c.id}/${c.active ? 'stop' : 'start'}"><button>${c.active ? 'Turn off' : 'Turn on'}</button></form></td></tr>`,
    )
    .join('');
  return layout('Campaigns', '/campaigns', `
<h1>Campaigns</h1>
<p class="muted">A campaign is the sequence each lead goes through: visit, invite (with an optional note), a first message once they accept, then follow-ups until they reply. Leads in a campaign that is off are left alone.</p>
<div class="scroll"><table><thead><tr><th>Name</th><th>State</th><th>Leads</th><th>Invited</th><th>Accepted</th><th>Messaged</th><th>Replied</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="8">No campaigns yet.</td></tr>'}</tbody></table></div>
<p><a class="btn" href="/campaigns/new">New campaign</a></p>`);
}

function preview(template, sample, max) {
  return variants(template)
    .map((v, i) => {
      const text = render(v, sample);
      const over = max && text.length > max;
      return `<div class="muted">Variant ${String.fromCharCode(65 + i)}, ${text.length} characters${over ? ` <span class="bad">(over ${max}; it will be cut)</span>` : ''}</div><pre>${esc(text)}</pre>`;
    })
    .join('');
}

export function campaignForm({ campaign, variantStats = [], sample }) {
  const c = campaign || { name: '', visit_first: true, invite_note: '', first_message: '', followups: [] };
  const f = [0, 1, 2].map((i) => c.followups[i] || { days: [3, 5, 7][i], text: '' });
  const stats = variantStats.length
    ? `<h2>A/B results</h2><div class="scroll"><table><thead><tr><th>Step</th><th>Variant</th><th>Sent</th><th>Result</th></tr></thead><tbody>${variantStats
        .map((v) => `<tr><td>${esc(v.kind)}</td><td>${String.fromCharCode(65 + v.variant)}</td><td>${v.sent}</td><td>${v.kind === 'Invite note' ? `${pct(v.accepted, v.sent)} accepted` : `${pct(v.replied, v.sent)} replied`}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '';
  return layout(campaign ? c.name : 'New campaign', '/campaigns', `
<h1>${campaign ? esc(c.name) : 'New campaign'}</h1>
<form method="post" action="${campaign ? `/campaigns/${campaign.id}` : '/campaigns'}">
  <label>Name</label><input name="name" required value="${esc(c.name)}" style="width:100%">
  <label><input type="checkbox" name="visit_first" ${c.visit_first ? 'checked' : ''}> Visit each profile a few hours before inviting</label>
  <p class="muted">Fields: {{firstName}}, {{fullName}}, {{company}}, {{headline}}, {{location}}. Add a fallback with {{company|your team}}. Put a line with only <code>---</code> between versions to A/B test them.</p>
  <label>Invitation note (optional, ${INVITE_NOTE_MAX} characters max)</label>
  <textarea name="invite_note">${esc(c.invite_note)}</textarea>
  ${preview(c.invite_note, sample, INVITE_NOTE_MAX)}
  <label>First message after they accept</label>
  <textarea name="first_message">${esc(c.first_message)}</textarea>
  ${preview(c.first_message, sample)}
  ${f
    .map(
      (x, i) => `<label>Follow-up ${i + 1}</label>
  <div class="row"><div style="flex:0 0 200px"><span class="muted">Days after the previous message</span><br><input name="f${i}_days" type="number" min="1" max="60" value="${x.days}"></div></div>
  <textarea name="f${i}_text" placeholder="Leave empty for no follow-up ${i + 1}">${esc(x.text)}</textarea>${preview(x.text, sample)}`,
    )
    .join('')}
  <p class="muted">The sequence stops as soon as someone replies. Previews use ${esc(sample.full_name)} as the sample lead.</p>
  <p><button class="primary">Save</button></p>
</form>
${stats}`);
}

export function settingsPage({ settings: s, limits, timeZone }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((d, i) => `<label style="display:inline;font-weight:400;margin-right:10px"><input type="checkbox" name="day${i}" ${s.schedule.days.includes(i) ? 'checked' : ''}> ${d}</label>`)
    .join('');
  const num = (name, value, min, max) => `<input type="number" name="${name}" value="${value}" min="${min}" max="${max}">`;
  const invitesPaused = s.invites_paused_until && Date.parse(s.invites_paused_until) > Date.now();
  return layout('Settings', '/settings', `
<h1>Settings</h1>
<form method="post" action="/settings">
  <h2>Mode</h2>
  <label><input type="checkbox" name="dry_run" ${s.dry_run ? 'checked' : ''}> Dry run: go through every step but never press Send, Connect or Withdraw</label>

  <h2>Limits</h2>
  <p class="muted">Your ceilings. The tool runs below them during warm-up, when acceptance drops, or after LinkedIn shows a limit. Currently at ${Math.round(limits.factor * 100)}%.</p>
  <div class="row">
    <div><label>Invitations per week</label>${num('invites_per_week', s.limits.invites_per_week, 1, 150)}</div>
    <div><label>Invitations per day</label>${num('invites_per_day', s.limits.invites_per_day, 1, 30)}</div>
    <div><label>Messages per day</label>${num('messages_per_day', s.limits.messages_per_day, 1, 60)}</div>
    <div><label>Page views per day</label>${num('page_views_per_day', s.limits.page_views_per_day, 5, 150)}</div>
    <div><label>Withdrawals per day</label>${num('withdraws_per_day', s.limits.withdraws_per_day, 0, 30)}</div>
    <div><label>Withdraw invites after (days)</label>${num('withdraw_after_days', s.withdraw_after_days, 14, 60)}</div>
  </div>

  <h2>Working hours (${esc(timeZone)})</h2>
  <div>${days}</div>
  <div class="row">
    <div><label>Start</label><input type="time" name="start" value="${esc(s.schedule.start)}"></div>
    <div><label>End</label><input type="time" name="end" value="${esc(s.schedule.end)}"></div>
    <div><label>Break from</label><input type="time" name="break_start" value="${esc(s.schedule.break_start || '')}"></div>
    <div><label>Break until</label><input type="time" name="break_end" value="${esc(s.schedule.break_end || '')}"></div>
  </div>

  <h2>Pacing</h2>
  <div class="row">
    <div><label>Shortest gap (seconds)</label>${num('min_gap_s', s.pacing.min_gap_s, 20, 600)}</div>
    <div><label>Longest gap (seconds)</label>${num('max_gap_s', s.pacing.max_gap_s, 30, 1200)}</div>
    <div><label>Break after this many actions in 30 min</label>${num('burst', s.pacing.burst, 2, 20)}</div>
  </div>

  <h2>Warm-up</h2>
  <label><input type="checkbox" name="warmup_enabled" ${s.warmup.enabled ? 'checked' : ''}> Ramp up over four weeks (30%, 50%, 75%, then 100%)</label>
  <div class="row"><div><label>Warm-up started on</label><input type="date" name="warmup_start" value="${esc(s.warmup.start_date || '')}"></div></div>

  <p style="margin-top:20px"><button class="primary">Save settings</button></p>
</form>

<h2>Recovery</h2>
<p class="muted">After LinkedIn's invitation limit, invitations pause for a week and caps drop by 20% each time. Caps are at ${Math.round((s.cap_factor ?? 1) * 100)}%.${invitesPaused ? ` Invitations are paused until ${esc(when(s.invites_paused_until))}.` : ''}</p>
<form method="post" action="/settings/recover"><button>Restore caps to 100% and allow invitations</button></form>`);
}

export function logPage({ actions }) {
  const rows = actions
    .map(
      (a) => `<tr><td>${esc(when(a.at))}</td><td>${esc(a.type)}${a.dry_run ? ' <span class="badge">dry run</span>' : ''}</td>
<td>${a.full_name || a.profile_url ? `<a href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.full_name || a.profile_url)}</a>` : ''}</td>
<td class="${['ok'].includes(a.result) ? 'good' : ['failed', 'limit', 'timeout', 'warning'].includes(a.result) ? 'bad' : ''}">${esc(a.result || 'running')}</td>
<td>${esc(a.detail || '')}${a.type === 'message' || (a.type === 'invite' && a.payload.note) ? `<pre>${esc(a.payload.text || a.payload.note)}</pre>` : ''}</td></tr>`,
    )
    .join('');
  return layout('Log', '/log', `
<h1>Action log</h1>
<p class="muted">Every LinkedIn page the runner opened or acted on, newest first.</p>
<div class="scroll"><table><thead><tr><th>When</th><th>Action</th><th>Lead</th><th>Result</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">Nothing yet</td></tr>'}</tbody></table></div>`, { refresh: true });
}
