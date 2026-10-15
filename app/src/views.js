// Server-rendered pages. Plain HTML forms with a little progressive JavaScript;
// every page works without it.
import { variants, render, INVITE_NOTE_MAX } from './text.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// [tone, short label, what to do]
const SESSION_TEXT = {
  ok: ['good', 'Logged in', 'LinkedIn is logged in and ready.'],
  logged_out: ['bad', 'Logged out', 'Open the browser view and log in to LinkedIn by hand.'],
  checkpoint: ['bad', 'Security check', 'LinkedIn wants a security check. Open the browser view and complete it by hand.'],
  restricted: ['bad', 'Restricted', 'LinkedIn shows a restriction notice. Keep everything paused and read it in the browser view.'],
  browser_closed: ['bad', 'Browser closed', 'The browser window was closed. The runner reopens it by itself.'],
  unknown: ['warn', 'Not checked yet', 'The runner has not looked at LinkedIn yet.'],
};
const STOP_STATES = new Set(['logged_out', 'checkpoint', 'restricted']);

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
const STATUS_TONE = { new: 'gray', visited: 'info', invited: 'info', connected: 'accent', messaged: 'accent', replied: 'good', done: 'gray', withdrawn: 'gray', skipped: 'warn', stopped: 'warn' };

const ACTION_TEXT = {
  visit: 'Viewed profile',
  invite: 'Invitation',
  message: 'Message',
  withdraw: 'Withdrew invitation',
  import_page: 'Read search page',
  sync_inbox: 'Checked inbox',
  sync_connections: 'Checked connections',
};
const RESULT_TEXT = {
  ok: ['good', 'Done'],
  dry_run: ['info', 'Practice, not sent'],
  skipped: ['warn', 'Skipped'],
  connected: ['good', 'Already connected'],
  pending: ['gray', 'Already pending'],
  replied: ['good', 'They replied'],
  not_found: ['warn', 'Not found'],
  not_connected: ['warn', 'Not connected'],
  not_pending: ['gray', 'Not pending'],
  not_started: ['warn', 'Not started'],
  limit: ['bad', 'LinkedIn limit'],
  failed: ['bad', 'Failed'],
  timeout: ['bad', 'Timed out'],
  warning: ['bad', 'LinkedIn warning'],
};
const LOG_FILTERS = [['', 'All'], ['invite', 'Invitations'], ['message', 'Messages'], ['visit', 'Profile views'], ['withdraw', 'Withdrawals'], ['import_page', 'Imports'], ['sync', 'Checks']];

const ago = (date) => {
  if (!date) return 'never';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 0) return `in ${inWords(-s)}`;
  if (s < 30) return 'just now';
  return `${inWords(s)} ago`;
};
const inWords = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
const TZ = () => process.env.TZ || 'Asia/Karachi';
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ() }) : '');
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ() }) : '');
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ() }) : '');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const isOnline = (status) => Boolean(status?.last_seen && Date.now() - new Date(status.last_seen).getTime() < 3 * 60 * 1000);

// Icons (paths in the style of Lucide, MIT).
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  user_plus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  stop: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const icon = (name, size = 16) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;

const CSS = `
:root{--bg:#f5f6f8;--surface:#fff;--surface-2:#f8f9fb;--ink:#101828;--ink-2:#344054;--muted:#667085;--line:#e4e7ec;--line-2:#d0d5dd;
--accent:#0a66c2;--accent-ink:#fff;--accent-soft:#e8f1fb;--good:#067647;--good-soft:#ecfdf3;--warn:#b54708;--warn-soft:#fffaeb;
--bad:#b42318;--bad-soft:#fef3f2;--danger:#b42318;--info:#175cd3;--info-soft:#eff8ff;--gray-soft:#f2f4f7;--shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.04);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0c111d;--surface:#151a24;--surface-2:#1b212c;--ink:#f5f5f6;--ink-2:#cecfd2;--muted:#94969c;--line:#262c37;--line-2:#333a47;
--accent:#4da3ff;--accent-ink:#0c111d;--accent-soft:rgba(77,163,255,.13);--good:#47cd89;--good-soft:rgba(71,205,137,.12);--warn:#fdb022;--warn-soft:rgba(253,176,34,.12);
--bad:#f97066;--bad-soft:rgba(249,112,102,.12);--danger:#d92d20;--info:#53b1fd;--info-soft:rgba(83,177,253,.12);--gray-soft:rgba(148,150,156,.14);--shadow:none;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.i{flex:none;vertical-align:-3px}
.app{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:18px 12px;gap:4px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;padding:2px 10px 18px;color:var(--ink)}
.brand:hover{text-decoration:none}
.logo{width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-size:12px;font-weight:800;letter-spacing:.02em}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;color:var(--ink-2);font-weight:500}
.nav a:hover{background:var(--surface-2);text-decoration:none}
.nav a.on{background:var(--accent-soft);color:var(--accent)}
.nav .sep{height:1px;background:var(--line);margin:10px 4px}
.side-status{margin-top:auto;border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:8px;font-size:13px;background:var(--surface-2)}
.side-status .row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.side-status .k{color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:currentColor;margin-right:6px;vertical-align:1px}
.good-t{color:var(--good)}.bad-t{color:var(--bad)}.warn-t{color:var(--warn)}.info-t{color:var(--info)}.muted{color:var(--muted)}
.main{min-width:0}
.wrap{max-width:1160px;margin:0 auto;padding:28px 32px 72px}
.pagehead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:24px;line-height:1.25;margin:0;letter-spacing:-.015em}
h2{font-size:15px;margin:0;letter-spacing:-.005em}
h3{font-size:14px;margin:0}
.sub{color:var(--muted);margin:4px 0 0;max-width:680px}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.section{margin-top:28px}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.card-pad{padding:18px 20px}
.card-head{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}
.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.g-hero{grid-template-columns:1.35fr 1fr 1fr}
.label{color:var(--muted);font-size:12.5px;font-weight:500}
.big{font-size:22px;font-weight:650;letter-spacing:-.015em;margin-top:2px;line-height:1.3}
.hint{color:var(--muted);font-size:13px;margin-top:4px}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:550;padding:2px 9px;border-radius:99px;white-space:nowrap;line-height:1.6}
.pill.good{background:var(--good-soft);color:var(--good)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.info{background:var(--info-soft);color:var(--info)}.pill.accent{background:var(--accent-soft);color:var(--accent)}.pill.gray{background:var(--gray-soft);color:var(--ink-2)}
.btn,button{font:inherit;font-weight:550;display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:9px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);cursor:pointer;line-height:1.3;white-space:nowrap}
.btn:hover,button:hover{background:var(--surface-2);text-decoration:none}
.btn.primary,button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover,button.primary:hover{filter:brightness(1.07)}
.btn.danger,button.danger{background:var(--danger);border-color:var(--danger);color:#fff}
button:disabled{opacity:.45;cursor:not-allowed;filter:none!important}
.btn.ghost,button.ghost{border-color:transparent;background:transparent;color:var(--ink-2)}
.btn.ghost:hover,button.ghost:hover{background:var(--surface-2)}
.btn.sm,button.sm{padding:5px 10px;font-size:13px;border-radius:8px}
.btn.lg,button.lg{padding:11px 20px;font-size:15px;border-radius:10px}
.btn.block,button.block{width:100%;justify-content:center}
form.inline{display:inline}
input,select,textarea{font:inherit;padding:8px 11px;border:1px solid var(--line-2);border-radius:9px;background:var(--surface);color:var(--ink);max-width:100%;width:100%}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
input[type=checkbox]{width:auto;accent-color:var(--accent)}
input[type=number]{max-width:140px}input[type=time],input[type=date]{max-width:180px}
textarea{min-height:96px;resize:vertical;line-height:1.5}
.field{display:flex;flex-direction:column;align-items:stretch;margin:0 0 16px}
.field>input[type=number],.field>input[type=time],.field>input[type=date]{align-self:flex-start}
.field>.lbl{display:block;font-weight:600;font-size:13.5px;margin-bottom:6px}
.field .hint{margin-top:6px}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 16px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:500;cursor:pointer}
.check input{margin-top:3px}
.switch{display:flex;gap:14px;align-items:flex-start;cursor:pointer}
.switch input{appearance:none;-webkit-appearance:none;width:42px;height:24px;border-radius:99px;background:var(--line-2);position:relative;cursor:pointer;flex:none;margin:1px 0 0;transition:background .15s;border:0}
.switch input::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.switch input:checked{background:var(--accent)}.switch input:checked::after{transform:translateX(18px)}
.switch input:focus{box-shadow:0 0 0 3px var(--accent-soft)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:550;color:var(--muted);font-size:12.5px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--surface-2);white-space:nowrap}
td{padding:11px 16px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--surface-2)}
.person{display:flex;gap:11px;align-items:flex-start;min-width:220px}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:650;font-size:12.5px;flex:none}
.person .name{font-weight:600;color:var(--ink)}.person .meta{color:var(--muted);font-size:12.5px;max-width:380px}
.meter{height:8px;background:var(--gray-soft);border-radius:99px;overflow:hidden;margin-top:8px}
.meter i{display:block;height:100%;background:var(--accent);border-radius:99px}
.meter.hot i{background:var(--warn)}.meter.full i{background:var(--bad)}
.limit-row{padding:14px 20px;border-bottom:1px solid var(--line)}.limit-row:last-child{border-bottom:0}
.limit-row .top{display:flex;justify-content:space-between;gap:8px}.limit-row b{font-variant-numeric:tabular-nums}
.banner{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:12px;margin-bottom:14px;border:1px solid}
.banner .i{margin-top:2px}.banner b{display:block}
.banner.bad{background:var(--bad-soft);border-color:color-mix(in srgb,var(--bad) 30%,transparent);color:var(--ink)}.banner.bad .i{color:var(--bad)}
.banner.warn{background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 30%,transparent)}.banner.warn .i{color:var(--warn)}
.banner.info{background:var(--info-soft);border-color:color-mix(in srgb,var(--info) 25%,transparent)}.banner.info .i{color:var(--info)}
.banner.good{background:var(--good-soft);border-color:color-mix(in srgb,var(--good) 25%,transparent)}.banner.good .i{color:var(--good)}
.banner .grow{flex:1}.banner .btn{margin-left:auto}
.toast{position:fixed;right:20px;bottom:20px;z-index:50;max-width:420px;background:var(--ink);color:var(--bg);padding:12px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;gap:10px;align-items:flex-start;animation:pop .2s ease-out}
.toast.bad{background:var(--danger);color:#fff}
.toast button{background:transparent;border:0;color:inherit;padding:0;margin-left:6px;opacity:.7}
@keyframes pop{from{transform:translateY(8px);opacity:0}}
.hero{display:flex;flex-direction:column;gap:14px;justify-content:space-between}
.hero .state{display:flex;align-items:center;gap:12px}
.hero .ring{width:44px;height:44px;border-radius:12px;display:grid;place-items:center}
.ring.good{background:var(--good-soft);color:var(--good)}.ring.warn{background:var(--warn-soft);color:var(--warn)}.ring.bad{background:var(--bad-soft);color:var(--bad)}.ring.info{background:var(--info-soft);color:var(--info)}
.steps{list-style:none;margin:0;padding:0}
.steps li{display:flex;gap:14px;padding:14px 20px;border-bottom:1px solid var(--line);align-items:flex-start}
.steps li:last-child{border-bottom:0}
.steps .n{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--line-2);display:grid;place-items:center;font-size:12px;font-weight:650;color:var(--muted);flex:none}
.steps li.done .n{background:var(--good);border-color:var(--good);color:#fff}
.steps li.done h3{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--line-2)}
.steps li.next{background:var(--accent-soft)}.steps li.next .n{border-color:var(--accent);color:var(--accent)}
.steps .body{flex:1;min-width:0}.steps p{margin:2px 0 0;color:var(--muted);font-size:13px}
.progress{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);white-space:nowrap}
.progress .meter{width:120px;margin:0}
.funnel{padding:6px 20px 16px}
.funnel .f{display:grid;grid-template-columns:110px minmax(0,1fr) 92px;gap:12px;align-items:center;padding:7px 0}
.funnel .bar{height:26px;background:var(--gray-soft);border-radius:7px;overflow:hidden}
.funnel .bar i{display:block;height:100%;background:var(--accent);opacity:.85;border-radius:7px;min-width:3px}
.funnel .n{text-align:right;font-variant-numeric:tabular-nums}.funnel .n b{font-size:15px}.funnel .n span{color:var(--muted);font-size:12px;margin-left:5px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;gap:6px;align-items:center;padding:5px 11px;border-radius:99px;border:1px solid var(--line-2);color:var(--ink-2);font-size:13px;font-weight:500;background:var(--surface)}
.chip:hover{background:var(--surface-2);text-decoration:none}
.chip.on{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip .c{color:var(--muted);font-variant-numeric:tabular-nums}.chip.on .c{color:inherit;opacity:.7}
.feed{list-style:none;margin:0;padding:0}
.feed li{display:flex;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);align-items:flex-start}
.feed li:last-child{border-bottom:0}
.feed .ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;background:var(--gray-soft);color:var(--ink-2)}
.feed .ic.good{background:var(--good-soft);color:var(--good)}.feed .ic.bad{background:var(--bad-soft);color:var(--bad)}.feed .ic.warn{background:var(--warn-soft);color:var(--warn)}.feed .ic.info{background:var(--info-soft);color:var(--info)}
.feed .body{flex:1;min-width:0}.feed .t{font-weight:550}.feed .d{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.feed time{color:var(--muted);font-size:12.5px;white-space:nowrap}
.empty{text-align:center;padding:44px 20px;color:var(--muted)}
.empty .ic{width:46px;height:46px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;margin:0 auto 12px}
.empty h3{color:var(--ink);font-size:15px;margin-bottom:4px}.empty p{margin:0 auto 16px;max-width:420px}
pre.msg{white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:13px/1.5 inherit;margin:6px 0 0;color:var(--ink-2);font-family:inherit}
.seq{position:relative}
.seq .step{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px;padding-bottom:18px}
.seq .step::before{content:"";position:absolute;left:19px;top:40px;bottom:0;width:2px;background:var(--line)}
.seq .step:last-child::before{display:none}
.seq .badge{width:40px;height:40px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center}
.seq .wait{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;margin-bottom:10px}
.seq .wait input{width:76px;padding:5px 8px}
.counter{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}.counter.over{color:var(--bad);font-weight:600}
.preview .v{font-size:12px;color:var(--muted);margin-top:10px}
.tokens{display:flex;flex-wrap:wrap;gap:6px}
.tokens button{font-size:12.5px;padding:4px 9px;border-radius:7px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500}
.layout-2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}
.sticky{position:sticky;top:20px}
.savebar{position:sticky;bottom:0;z-index:4;margin-top:20px;padding:12px 0;background:linear-gradient(to top,var(--bg) 70%,transparent);display:flex;gap:10px;align-items:center}
.set{display:grid;grid-template-columns:260px minmax(0,1fr);gap:24px;padding:22px 24px;border-bottom:1px solid var(--line)}
.set:last-child{border-bottom:0}
.set .about p{color:var(--muted);font-size:13px;margin:4px 0 0}
.days{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.days label{position:relative}
.days input{position:absolute;opacity:0;pointer-events:none}
.days span{display:inline-block;padding:6px 12px;border-radius:9px;border:1px solid var(--line-2);font-weight:550;font-size:13px;cursor:pointer;user-select:none}
.days input:checked+span{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.days input:focus+span{box-shadow:0 0 0 3px var(--accent-soft)}
.screen{aspect-ratio:1440/900;width:100%;border:0;display:block;background:#000;border-radius:0 0 14px 14px}
.kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--gray-soft);padding:1px 6px;border-radius:5px}
.help h2{margin-top:6px}.help p,.help li{color:var(--ink-2)}.help ol,.help ul{padding-left:20px;margin:8px 0}.help li{margin:4px 0}
.diagram{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;padding:8px 0}
.diagram .box{border:1px solid var(--line-2);border-radius:12px;padding:12px 16px;text-align:center;min-width:150px;background:var(--surface-2)}
.diagram .box b{display:block}.diagram .arrow{color:var(--muted);font-size:20px}
.stat-row{display:flex;gap:18px;flex-wrap:wrap;padding:14px 20px;border-top:1px solid var(--line)}
.stat-row div{min-width:64px}.stat-row b{font-size:17px;font-variant-numeric:tabular-nums;display:block}
.camp{display:flex;flex-direction:column}
.camp .stat-row{margin-top:auto}
.camp .foot{display:flex;gap:8px;padding:12px 20px;border-top:1px solid var(--line);flex-wrap:wrap}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--gray-soft);padding:1px 5px;border-radius:5px}
@media (max-width:1000px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.g-hero,.g3{grid-template-columns:1fr}.layout-2{grid-template-columns:1fr}.sticky{position:static}.set{grid-template-columns:1fr;gap:12px}}
@media (max-width:820px){.app{grid-template-columns:1fr}
.side{position:sticky;top:0;z-index:20;height:auto;flex-direction:row;align-items:center;padding:8px 10px;border-right:0;border-bottom:1px solid var(--line);overflow-x:auto;gap:6px}
.brand{padding:0 6px 0 2px}.brand span{display:none}.nav{flex-direction:row}.nav a{padding:7px 9px;font-size:13px}.nav a span{display:none}.side-status .t{display:none}.progress .meter{display:none}.nav .sep{display:none}
.side-status{margin:0 0 0 auto;padding:0;border:0;background:none}.side-status .row{display:none}
.wrap{padding:20px 16px 64px}.banner{flex-wrap:wrap}.banner .grow{flex:1 1 calc(100% - 40px)}.banner .btn{margin-left:30px}
.steps li{flex-wrap:wrap}.steps .body{flex:1 1 calc(100% - 50px)}.steps li>.btn{margin-left:40px}.g2{grid-template-columns:1fr}.funnel .f{grid-template-columns:84px minmax(0,1fr) 70px}}
`;

// Small enhancements: confirm dangerous buttons, dismiss toasts, refresh live pages when idle.
const SCRIPT = `
document.addEventListener('submit', (e) => {
  const m = e.target.getAttribute('data-confirm');
  if (m && !confirm(m)) e.preventDefault();
});
document.querySelectorAll('.toast button').forEach((b) => b.addEventListener('click', () => b.closest('.toast').remove()));
setTimeout(() => document.querySelectorAll('.toast:not(.bad)').forEach((t) => t.remove()), 6000);
if (document.body.dataset.refresh) {
  let touched = false;
  document.addEventListener('input', () => (touched = true));
  setInterval(() => { if (!touched && document.visibilityState === 'visible') location.reload(); }, Number(document.body.dataset.refresh) * 1000);
}
`;

const NAV = [
  ['/', 'Home', 'home'],
  ['/leads', 'Leads', 'users'],
  ['/campaigns', 'Campaigns', 'send'],
  ['/browser', 'Browser view', 'monitor'],
  ['/log', 'Activity log', 'list'],
  null,
  ['/settings', 'Settings', 'sliders'],
  ['/help', 'How it works', 'help'],
];

// The safety banner every page shows, most serious first.
function banners(shell) {
  const { status, settings } = shell;
  const out = [];
  if (STOP_STATES.has(status.session)) {
    const [, label, what] = SESSION_TEXT[status.session];
    out.push(`<div class="banner bad">${icon('alert', 18)}<div class="grow"><b>LinkedIn warning: ${esc(label)}. Everything is paused.</b>${esc(what)} Then press Start on Home.${status.detail ? ` <span class="muted">(${esc(status.detail)})</span>` : ''}</div><a class="btn sm" href="/browser">${icon('monitor', 14)} Open browser view</a></div>`);
  } else if (!isOnline(status)) {
    out.push(`<div class="banner warn">${icon('alert', 18)}<div class="grow"><b>The browser runner is offline.</b>Last seen ${esc(ago(status.last_seen))}. Check the runner container on the NAS; nothing happens on LinkedIn while it is offline.</div><a class="btn sm" href="/help#troubleshooting">Troubleshooting</a></div>`);
  }
  if (settings.dry_run) {
    out.push(`<div class="banner info">${icon('flask', 18)}<div class="grow"><b>Practice mode is on (dry run).</b>LinkedAuto goes through every step but never presses Connect, Send or Withdraw, so nothing reaches anyone on LinkedIn.</div><a class="btn sm ghost" href="/settings#mode">Change</a></div>`);
  }
  return out.join('');
}

function sideStatus(shell) {
  const { status, settings } = shell;
  const online = isOnline(status);
  const [tone, label] = SESSION_TEXT[status.session] || SESSION_TEXT.unknown;
  return `<div class="side-status">
  <div class="row"><span class="k">Runner</span><span class="${online ? 'good-t' : 'bad-t'}"><span class="dot"></span>${online ? 'Online' : 'Offline'}</span></div>
  <div class="row"><span class="k">LinkedIn</span><span class="${tone}-t"><span class="dot"></span>${esc(label)}</span></div>
  <div class="row"><span class="k">Mode</span><span>${settings.dry_run ? pill('info', 'Practice') : pill('accent', 'Live')}</span></div>
  ${settings.paused
    ? `<form method="post" action="/resume" data-confirm="${esc(startConfirm(settings))}"><button class="primary sm block" ${STOP_STATES.has(status.session) ? 'disabled title="Fix the LinkedIn warning first"' : ''}>${icon('play', 14)} <span class="t">Start</span></button></form>`
    : `<form method="post" action="/pause"><button class="danger sm block" title="Pause everything">${icon('pause', 14)} <span class="t">Pause everything</span></button></form>`}
</div>`;
}

const startConfirm = (settings) =>
  settings.dry_run
    ? 'Start in practice mode? LinkedAuto will open LinkedIn pages at a human pace but will not send anything.'
    : 'Start LIVE? Practice mode is off, so real invitations and messages will be sent within your limits.';

function layout(title, active, body, shell, { refresh = 0, subtitle = '', actions = '' } = {}) {
  const nav = NAV.map((n) => (n ? `<a href="${n[0]}" class="${active === n[0] ? 'on' : ''}">${icon(n[2], 17)}<span>${n[1]}</span></a>` : '<div class="sep"></div>')).join('');
  const flash = shell.flash
    ? `<div class="toast" role="status">${icon('check', 16)}<span>${esc(shell.flash)}</span><button aria-label="Close">${icon('x', 14)}</button></div>`
    : shell.error
      ? `<div class="toast bad" role="alert">${icon('alert', 16)}<span>${esc(shell.error)}</span><button aria-label="Close">${icon('x', 14)}</button></div>`
      : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · LinkedAuto</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0a66c2"/><text x="16" y="21" font-family="Arial" font-weight="700" font-size="13" text-anchor="middle" fill="#fff">LA</text></svg>')}">
<style>${CSS}</style></head>
<body${refresh ? ` data-refresh="${refresh}"` : ''}><div class="app">
<aside class="side"><a class="brand" href="/"><span class="logo">LA</span><span>LinkedAuto</span></a><nav class="nav">${nav}</nav>${sideStatus(shell)}</aside>
<main class="main"><div class="wrap">
${banners(shell)}
<div class="pagehead"><div><h1>${esc(title)}</h1>${subtitle ? `<p class="sub">${subtitle}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>
${body}
</div></main></div>${flash}
<script>${SCRIPT}</script></body></html>`;
}

const meter = (used, max) => {
  const p = max ? Math.min(100, (used / max) * 100) : 0;
  return `<div class="meter ${p >= 100 ? 'full' : p >= 80 ? 'hot' : ''}"><i style="width:${p}%"></i></div>`;
};

function planText(plan) {
  if (!plan) return '';
  const m = plan.match(/^(\w+) running$/);
  if (m) return `Working now: ${(ACTION_TEXT[m[1]] || m[1]).toLowerCase()}`;
  if (plan.startsWith('LinkedIn session is')) return 'Waiting for the LinkedIn login';
  return {
    paused: 'Paused',
    'outside working hours': 'Outside working hours, waiting for the next work window',
    pacing: 'Taking a human-length pause before the next action',
    'nothing due': 'Nothing due right now; checks again in a few minutes',
    'previous action still running': 'Finishing the previous action',
    'daily page-view limit reached': "Today's page-view limit is reached; continues tomorrow",
  }[plan] || plan;
}

// One plain sentence for each event in the activity feed: [tone, icon, title].
function eventText(e) {
  const k = e.kind;
  if (k.startsWith('session:')) {
    const [tone, label] = SESSION_TEXT[k.slice(8)] || SESSION_TEXT.unknown;
    return [tone === 'good' ? 'good' : tone, tone === 'good' ? 'check' : 'alert', `LinkedIn: ${label.toLowerCase()}`];
  }
  return {
    'auto-paused': ['bad', 'shield', 'Paused itself for safety'],
    'invite-limit': ['bad', 'shield', "LinkedIn's weekly invitation limit; invitations paused for 7 days"],
    'runner-offline': ['warn', 'alert', 'Browser runner went offline'],
    replied: ['good', 'mail', 'A lead replied'],
    accepted: ['good', 'user_plus', 'Invitation accepted'],
    paused: ['warn', 'pause', 'You paused automation'],
    resumed: ['info', 'play', 'You started automation'],
    'resume-refused': ['bad', 'alert', 'Start refused: fix the LinkedIn warning first'],
    'import-queued': ['info', 'search', 'Search import queued'],
    'csv-import': ['info', 'upload', 'CSV imported'],
    'campaign-start': ['good', 'send', 'Campaign turned on'],
    'campaign-stop': ['gray', 'send', 'Campaign turned off'],
    'settings-saved': ['gray', 'sliders', 'Settings saved'],
    'caps-restored': ['gray', 'sliders', 'Limits restored to 100%'],
    'runner:started': ['gray', 'monitor', 'Browser runner started'],
  }[k] || ['gray', 'list', k];
}

function feed(events) {
  if (!events.length) return `<div class="empty"><p>Nothing has happened yet.</p></div>`;
  return `<ul class="feed">${events
    .map((e) => {
      const [tone, ic, title] = eventText(e);
      const detail = e.kind === 'campaign-start' || e.kind === 'campaign-stop' ? '' : e.detail;
      return `<li><span class="ic ${tone}">${icon(ic, 15)}</span><div class="body"><div class="t">${esc(title)}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ''}</div><time title="${esc(when(e.at))}">${esc(ago(e.at))}</time></li>`;
    })
    .join('')}</ul>`;
}

function setupSteps(d, shell) {
  const { status, settings } = shell;
  const steps = [
    [isOnline(status), 'Start LinkedAuto on the NAS', 'The browser runner checks in here once its container is up.', '/help#setup', 'How to start it'],
    [status.session === 'ok', 'Log in to LinkedIn', 'Open the browser view and sign in by hand, including any 2-step code. LinkedAuto never sees your password.', '/browser', 'Open browser view'],
    [d.campaigns.active > 0, 'Create a campaign and turn it on', 'Write the invitation note and messages; the previews show how each one reads.', d.campaigns.total ? '/campaigns' : '/campaigns/new', d.campaigns.total ? 'Campaigns' : 'New campaign'],
    [d.leadsTotal > 0, 'Add leads', 'Paste a LinkedIn people-search link or import a CSV of profile links.', '/leads/add', 'Add leads'],
    [d.started, 'Press Start in practice mode', 'Watch a few actions in the browser view. The activity log shows what each one would have sent.', null, null],
    [!settings.dry_run, 'Go live when it looks right', 'Turn off practice mode in Settings. Sending starts slowly with the four-week warm-up.', '/settings#mode', 'Settings'],
  ];
  const done = steps.filter((s) => s[0]).length;
  // Once you've gone live the checklist is history; the banners cover later trouble.
  if (done === steps.length || (d.started && !settings.dry_run)) return '';
  const next = steps.findIndex((s) => !s[0]);
  return `<div class="card section" style="margin-top:0"><div class="card-head"><div><h2>Get started</h2><div class="hint" style="margin:2px 0 0">Six steps from a fresh install to your first real invitation.</div></div>
  <div class="progress"><div class="meter"><i style="width:${(done / steps.length) * 100}%"></i></div><span>${done} of ${steps.length}</span></div></div>
  <ol class="steps">${steps
    .map(([ok, title, text, href, cta], i) => `<li class="${ok ? 'done' : i === next ? 'next' : ''}"><span class="n">${ok ? icon('check', 14) : i + 1}</span>
    <div class="body"><h3>${title}</h3><p>${text}</p></div>${!ok && href && i === next ? `<a class="btn sm ${i === next ? 'primary' : ''}" href="${href}">${cta}</a>` : ''}</li>`)
    .join('')}</ol></div>`;
}

export function overviewPage({ events, limits, usage, plan, counts, stats, funnel, campaigns, leadsTotal, started }, shell) {
  const { status, settings } = shell;
  const online = isOnline(status);
  const [tone, label, what] = SESSION_TEXT[status.session] || SESSION_TEXT.unknown;
  const stopped = STOP_STATES.has(status.session);
  const invitesPaused = settings.invites_paused_until && Date.parse(settings.invites_paused_until) > Date.now();
  const runTone = stopped ? 'bad' : settings.paused ? 'warn' : 'good';
  const runLabel = stopped ? 'Stopped for safety' : settings.paused ? 'Paused' : settings.dry_run ? 'Running in practice mode' : 'Running live';
  const runHint = stopped ? 'LinkedIn showed a warning. Fix it in the browser view, then press Start.' : settings.paused ? 'Nothing happens on LinkedIn until you press Start.' : planText(plan) || 'Starting up';

  const limitRow = (name, used, max, extra = '') => `<div class="limit-row"><div class="top"><span>${name}</span><span><b>${used}</b> <span class="muted">/ ${max}</span></span></div>${meter(used, max)}${extra}</div>`;
  const top = funnel.leads || 1;
  const fRow = (name, n, prev) => `<div class="f"><span>${name}</span><div class="bar"><i style="width:${(n / top) * 100}%"></i></div><div class="n"><b>${n}</b>${prev !== undefined ? `<span>${pct(n, prev)}</span>` : ''}</div></div>`;
  const stageChips = Object.entries(STATUS_TEXT)
    .filter(([k]) => counts[k])
    .map(([k, l]) => `<a class="chip" href="/leads?status=${k}">${l} <span class="c">${counts[k]}</span></a>`)
    .join('');

  return layout('Home', '/', `
${setupSteps({ campaigns, leadsTotal, started }, shell)}
<div class="grid g-hero section" id="start">
  <div class="card card-pad hero">
    <div>
      <div class="label">Automation</div>
      <div class="state" style="margin-top:8px"><span class="ring ${runTone}">${icon(stopped ? 'shield' : settings.paused ? 'pause' : 'play', 20)}</span>
        <div><div class="big">${runLabel}</div><div class="hint" style="margin:0">${esc(runHint)}</div></div></div>
    </div>
    <div class="actions">
      ${settings.paused
        ? `<form method="post" action="/resume" data-confirm="${esc(startConfirm(settings))}"><button class="primary lg" ${stopped ? 'disabled' : ''}>${icon('play', 16)} Start${settings.dry_run ? ' in practice mode' : ''}</button></form>`
        : `<form method="post" action="/pause"><button class="danger lg">${icon('pause', 16)} Pause everything</button></form>`}
      <a class="btn ghost" href="/log">${icon('list', 15)} Activity log</a>
    </div>
  </div>
  <div class="card card-pad">
    <div class="label">Browser runner</div>
    <div class="big ${online ? 'good-t' : 'bad-t'}"><span class="dot"></span>${online ? 'Online' : 'Offline'}</div>
    <div class="hint">Last check-in ${esc(ago(status.last_seen))}${status.version ? ` · v${esc(status.version)}` : ''}</div>
    <div class="hint">Works ${esc(scheduleText(settings.schedule))}</div>
  </div>
  <div class="card card-pad">
    <div class="label">LinkedIn login</div>
    <div class="big ${tone}-t"><span class="dot"></span>${esc(label)}</div>
    <div class="hint">${esc(what)}</div>
    <div style="margin-top:10px"><a class="btn sm" href="/browser">${icon('monitor', 14)} Open browser view</a></div>
  </div>
</div>

<div class="grid g2 section">
  <div class="card">
    <div class="card-head"><h2>Today's limits</h2><span class="pill gray" title="Warm-up, acceptance rate and any cut after a LinkedIn limit">Running at ${Math.round(limits.factor * 100)}%</span></div>
    ${limitRow('Invitations this week', usage.invites_week, limits.invites_per_week, invitesPaused ? `<div class="hint bad-t">Paused until ${esc(when(settings.invites_paused_until))} after LinkedIn's limit</div>` : '')}
    ${limitRow('Invitations today', usage.invites_today, limits.invites_per_day)}
    ${limitRow('Messages today', usage.messages_today, limits.messages_per_day)}
    ${limitRow('LinkedIn pages opened today', usage.page_views_today, limits.page_views_per_day)}
  </div>
  <div class="card">
    <div class="card-head"><h2>Results</h2><a class="btn sm ghost" href="/leads">All leads</a></div>
    <div class="funnel">
      ${fRow('Leads', funnel.leads)}
      ${fRow('Invited', funnel.invited, funnel.leads)}
      ${fRow('Accepted', funnel.accepted, funnel.invited)}
      ${fRow('Messaged', funnel.messaged, funnel.accepted)}
      ${fRow('Replied', funnel.replied, funnel.messaged)}
    </div>
    <div class="stat-row">
      <div><span class="label">Acceptance, 30 days</span><b>${pct(stats.accepted, stats.settled)}</b><span class="hint">${stats.accepted} of ${stats.settled} settled</span></div>
      <div><span class="label">Reply rate, 30 days</span><b>${pct(stats.replied, stats.messaged)}</b><span class="hint">${stats.replied} of ${stats.messaged} messaged</span></div>
    </div>
  </div>
</div>

${stageChips ? `<div class="section"><div class="section-head"><h2>Leads by stage</h2></div><div class="chips">${stageChips}</div></div>` : ''}

<div class="card section">
  <div class="card-head"><h2>Recent activity</h2><a class="btn sm ghost" href="/log?view=events">See all</a></div>
  ${feed(events)}
</div>`, shell, {
    refresh: 20,
    subtitle: 'What LinkedAuto is doing right now, and how your outreach is going.',
  });
}

function scheduleText(s) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = [...s.days].sort();
  const days = d.join() === '1,2,3,4,5' ? 'Mon to Fri' : d.length === 7 ? 'every day' : d.map((i) => names[i]).join(', ');
  return `${days}, ${s.start} to ${s.end}`;
}

export function browserPage({ novncUrl }, shell) {
  const embed = novncUrl ? `${novncUrl}${novncUrl.includes('?') ? '&' : '?'}autoconnect=1&resize=scale&reconnect=1` : '';
  return layout('Browser view', '/browser', `
<div class="layout-2">
  <div class="card" style="overflow:hidden">
    <div class="card-head"><div class="actions"><span class="pill gray">${icon('monitor', 12)} Chrome on your NAS</span></div>
    ${novncUrl ? `<a class="btn sm" href="${esc(novncUrl)}" target="_blank" rel="noopener">${icon('external', 14)} Open full screen</a>` : ''}</div>
    ${embed ? `<iframe class="screen" src="${esc(embed)}" title="LinkedAuto browser" allow="clipboard-read; clipboard-write"></iframe>` : '<div class="empty"><p>No browser view address is set.</p></div>'}
  </div>
  <div class="grid sticky">
    <div class="card card-pad help">
      <h2>How to use it</h2>
      <ol>
        <li>Click <b>Connect</b> and type the VNC password (the <code>VNC_PASSWORD</code> secret).</li>
        <li>Log in to LinkedIn in the Chrome window, including any 2-step code.</li>
        <li>Leave the window open. The runner keeps using it.</li>
      </ol>
    </div>
    <div class="card card-pad help">
      <h2>When LinkedIn asks for a check</h2>
      <p>LinkedAuto pauses itself on any security check, logout or restriction notice. Complete the check here by hand, then press <b>Start</b> on Home.</p>
    </div>
    <div class="card card-pad help">
      <h2>Good to know</h2>
      <ul>
        <li>You can watch every action live here.</li>
        <li>Don't browse LinkedIn in this window while automation is running; pause first.</li>
        <li>Your login stays saved in the browser profile on the NAS.</li>
      </ul>
    </div>
  </div>
</div>`, shell, { subtitle: 'The real Chrome window on your NAS. Log in here and watch LinkedAuto work.' });
}

export function leadsPage({ leads, total, filter, campaigns, counts }, shell) {
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const href = (patch) => {
    const qs = new URLSearchParams(Object.entries({ ...filter, ...patch }).filter(([, v]) => v)).toString();
    return `/leads${qs ? `?${qs}` : ''}`;
  };
  const chips = [`<a class="chip ${filter.status ? '' : 'on'}" href="${href({ status: '' })}">All <span class="c">${all}</span></a>`]
    .concat(Object.entries(STATUS_TEXT).filter(([k]) => counts[k] || filter.status === k).map(([k, l]) => `<a class="chip ${filter.status === k ? 'on' : ''}" href="${href({ status: k })}">${l} <span class="c">${counts[k] || 0}</span></a>`))
    .join('');
  const ended = ['replied', 'stopped', 'done', 'withdrawn', 'skipped'];
  const rows = leads
    .map((l) => {
      const name = l.full_name || l.profile_url.replace('https://www.linkedin.com/in/', '').replace(/\/$/, '');
      const next = ended.includes(l.status) || l.status === 'invited' ? (l.status === 'invited' ? 'Waiting for them to accept' : '') : !l.campaign_id ? 'No campaign' : ago(l.next_action_at);
      return `<tr>
  <td><div class="person"><span class="avatar">${esc(initials(l.full_name))}</span><div><a class="name" href="${esc(l.profile_url)}" target="_blank" rel="noopener">${esc(name)}</a><div class="meta">${esc(l.headline || '')}</div>${l.tags?.length ? `<div class="meta">${l.tags.map((t) => `#${esc(t)}`).join(' ')}</div>` : ''}</div></div></td>
  <td>${pill(STATUS_TONE[l.status] || 'gray', STATUS_TEXT[l.status] || l.status)}${l.msg_step ? `<div class="meta muted" style="font-size:12.5px;margin-top:4px">${plural(l.msg_step, 'message')} sent</div>` : ''}${l.error ? `<div class="muted" style="font-size:12.5px;margin-top:4px">${esc(l.error)}</div>` : ''}</td>
  <td>${l.campaign_id ? `<a href="/campaigns/${l.campaign_id}">${esc(l.campaign_name)}</a>` : '<span class="muted">None</span>'}</td>
  <td class="muted">${esc(next)}</td>
  <td style="text-align:right;white-space:nowrap"><a class="btn sm ghost" href="/log?lead=${l.id}" title="Everything LinkedAuto did for this lead">${icon('list', 14)} History</a>
  ${ended.includes(l.status) ? '' : `<form class="inline" method="post" action="/leads/${l.id}/stop" data-confirm="Stop all automation for ${esc(name)}?"><button class="sm ghost" title="Stop all automation for this lead">${icon('stop', 14)} Stop</button></form>`}</td>
</tr>`;
    })
    .join('');
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const filtered = filter.status || filter.campaign || filter.q;
  return layout('Leads', '/leads', `
<div class="card">
  <div class="card-pad" style="display:grid;gap:14px">
    <div class="chips">${chips}</div>
    <form method="get" class="actions" style="gap:10px">
      ${filter.status ? `<input type="hidden" name="status" value="${esc(filter.status)}">` : ''}
      <div style="position:relative;flex:1 1 260px"><input name="q" value="${esc(filter.q || '')}" placeholder="Search name, headline, company or tag" style="padding-left:34px"><span style="position:absolute;left:11px;top:9px;color:var(--muted)">${icon('search', 16)}</span></div>
      <select name="campaign" style="flex:0 1 220px" onchange="this.form.submit()">${`<option value="">All campaigns</option>` + campaigns.map((c) => `<option value="${c.id}" ${filter.campaign === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button>Search</button>
      ${filtered ? `<a class="btn ghost" href="/leads">Clear</a>` : ''}
    </form>
  </div>
  ${rows
    ? `<div class="table-wrap" style="border-top:1px solid var(--line)"><table><thead><tr><th>Lead</th><th>Stage</th><th>Campaign</th><th>Next step</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : all
      ? `<div class="empty" style="border-top:1px solid var(--line)"><h3>No leads match</h3><p>Try another stage or search.</p></div>`
      : `<div class="empty" style="border-top:1px solid var(--line)"><div class="ic">${icon('users', 22)}</div><h3>No leads yet</h3><p>Paste a LinkedIn people-search link or import a CSV. LinkedAuto skips anyone already here.</p><a class="btn primary" href="/leads/add">${icon('plus', 15)} Add leads</a></div>`}
</div>
${total > leads.length ? `<p class="muted">Showing the ${leads.length} most recently updated of ${total}. Narrow the filter, or export the CSV for all of them.</p>` : ''}`, shell, {
    subtitle: `${plural(total, 'lead')}${filtered ? ' match this filter' : ''}. Each one moves through its campaign: visit, invite, message, follow up, until they reply.`,
    actions: `<a class="btn" href="/leads.csv${qs ? `?${qs}` : ''}">${icon('download', 15)} Export CSV</a><a class="btn primary" href="/leads/add">${icon('plus', 15)} Add leads</a>`,
  });
}

export function addLeadsPage({ campaigns, imports }, shell) {
  const options = `<option value="">No campaign (leads wait)</option>` + campaigns.map((c, i) => `<option value="${c.id}" ${i === 0 ? 'selected' : ''}>${esc(c.name)}${c.active ? '' : ' (off)'}</option>`).join('');
  const importRows = imports
    .map((i) => {
      const tone = i.status === 'done' ? 'good' : i.status === 'failed' ? 'bad' : 'info';
      return `<tr><td class="muted" style="white-space:nowrap">${esc(when(i.created_at))}</td><td style="max-width:380px;overflow-wrap:anywhere;font-size:12.5px">${esc(i.search_url)}</td><td>${pill(tone, i.status)}${i.error ? `<div class="muted" style="font-size:12.5px">${esc(i.error)}</div>` : ''}</td><td><b>${i.added}</b> <span class="muted">new of ${i.found}</span></td><td class="muted">${Math.max(0, i.next_page - 1)} / ${i.max_pages}</td></tr>`;
    })
    .join('');
  return layout('Add leads', '/leads', `
${campaigns.length ? '' : `<div class="banner warn">${icon('alert', 18)}<div class="grow"><b>Create a campaign first.</b>Leads without a campaign are saved but nothing happens to them until you give them one.</div><a class="btn sm" href="/campaigns/new">New campaign</a></div>`}
<div class="grid g2">
  <form class="card card-pad" method="post" action="/imports">
    <div class="actions" style="margin-bottom:6px"><span class="ring info" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center">${icon('search', 17)}</span><h2>From a LinkedIn search</h2></div>
    <p class="hint" style="margin:0 0 16px">Search for people on LinkedIn, copy the address bar, and paste it here. The runner reads one results page per action at the normal human pace, so a big import takes a while.</p>
    <label class="field"><span class="lbl">Search link</span><input name="search_url" required placeholder="https://www.linkedin.com/search/results/people/?keywords=..."></label>
    <div class="fields">
      <label class="field"><span class="lbl">Campaign</span><select name="campaign_id">${options}</select></label>
      <label class="field"><span class="lbl">Pages to read</span><input name="max_pages" type="number" min="1" max="10" value="3"><span class="hint">About 10 people a page</span></label>
    </div>
    <label class="field"><span class="lbl">Tags <span class="muted" style="font-weight:400">(optional)</span></span><input name="tags" placeholder="real-estate, usa"></label>
    <button class="primary">${icon('search', 15)} Queue import</button>
    <p class="hint">Sales Navigator lists aren't supported; export them to CSV and use the other box.</p>
  </form>
  <form class="card card-pad" method="post" action="/leads/csv">
    <div class="actions" style="margin-bottom:6px"><span class="ring info" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center">${icon('upload', 17)}</span><h2>From a CSV file</h2></div>
    <p class="hint" style="margin:0 0 16px">Needs a column of LinkedIn profile links (for example <code>profile_url</code>). Optional columns: name or first and last name, headline, company, location.</p>
    <label class="field"><span class="lbl">Choose a file</span><input type="file" accept=".csv,text/csv" onchange="const r=new FileReader();r.onload=()=>this.form.csv.value=r.result;r.readAsText(this.files[0])"></label>
    <label class="field"><span class="lbl">Or paste it</span><textarea name="csv" placeholder="profile_url,name,headline&#10;https://www.linkedin.com/in/someone/,Some One,CEO at Acme"></textarea></label>
    <div class="fields">
      <label class="field"><span class="lbl">Campaign</span><select name="campaign_id">${options}</select></label>
      <label class="field"><span class="lbl">Tags</span><input name="tags" placeholder="optional"></label>
    </div>
    <button class="primary">${icon('upload', 15)} Import CSV</button>
    <p class="hint">Anyone already in LinkedAuto is skipped, across every campaign.</p>
  </form>
</div>
${importRows ? `<div class="card section"><div class="card-head"><h2>Search imports</h2><span class="hint" style="margin:0">Imports run only while automation is started</span></div><div class="table-wrap"><table><thead><tr><th>Queued</th><th>Search</th><th>Status</th><th>Leads</th><th>Pages</th></tr></thead><tbody>${importRows}</tbody></table></div></div>` : ''}`, shell, {
    subtitle: 'Bring people in from a LinkedIn search or a spreadsheet, and pick the campaign they go into.',
    actions: `<a class="btn ghost" href="/leads">Back to leads</a>`,
  });
}

export function campaignsPage({ campaigns }, shell) {
  const cards = campaigns
    .map(
      (c) => `<div class="card camp">
  <div class="card-pad" style="padding-bottom:12px">
    <div class="section-head" style="margin:0"><a href="/campaigns/${c.id}"><h2 style="color:var(--ink)">${esc(c.name)}</h2></a>${c.active ? pill('good', 'On') : pill('gray', 'Off')}</div>
    <div class="hint">${esc(sequenceSummary(c))}</div>
  </div>
  <div class="stat-row">
    <div><span class="label">Leads</span><b><a href="/leads?campaign=${c.id}" style="color:inherit">${c.leads}</a></b></div>
    <div><span class="label">Invited</span><b>${c.invited}</b></div>
    <div><span class="label">Accepted</span><b>${pct(c.accepted, c.invited)}</b></div>
    <div><span class="label">Replied</span><b>${pct(c.replied, c.messaged)}</b></div>
  </div>
  <div class="foot">
    <a class="btn sm" href="/campaigns/${c.id}">${icon('edit', 14)} Edit</a>
    <a class="btn sm ghost" href="/leads?campaign=${c.id}">${icon('users', 14)} Leads</a>
    <form class="inline" method="post" action="/campaigns/${c.id}/${c.active ? 'stop' : 'start'}" style="margin-left:auto"><button class="sm ${c.active ? '' : 'primary'}">${c.active ? 'Turn off' : 'Turn on'}</button></form>
  </div>
</div>`,
    )
    .join('');
  return layout('Campaigns', '/campaigns', cards
    ? `<div class="grid g3">${cards}</div>`
    : `<div class="card"><div class="empty"><div class="ic">${icon('send', 22)}</div><h3>No campaigns yet</h3><p>A campaign is the sequence every lead goes through: view the profile, invite with a short note, a first message once they accept, then follow-ups until they reply.</p><a class="btn primary" href="/campaigns/new">${icon('plus', 15)} New campaign</a></div></div>`, shell, {
    subtitle: 'Each campaign is a sequence: view profile, invite, first message, follow-ups. It stops by itself the moment someone replies. Leads in a campaign that is off are left alone.',
    actions: `<a class="btn primary" href="/campaigns/new">${icon('plus', 15)} New campaign</a>`,
  });
}

function sequenceSummary(c) {
  const parts = [];
  if (c.visit_first) parts.push('view');
  parts.push(c.invite_note ? 'invite with note' : 'invite');
  if (c.first_message) parts.push('message');
  const f = (c.followups || []).length;
  if (f) parts.push(plural(f, 'follow-up'));
  return parts.join(' → ');
}

function preview(template, sample, max) {
  const list = variants(template);
  if (!list.length) return '<div class="v">Nothing written yet.</div>';
  return list
    .map((v, i) => {
      const text = render(v, sample);
      const over = max && text.length > max;
      return `<div class="v">${list.length > 1 ? `Version ${String.fromCharCode(65 + i)} · ` : ''}<span class="counter ${over ? 'over' : ''}">${text.length}${max ? ` / ${max}` : ''} characters${over ? ', will be cut' : ''}</span></div><pre class="msg">${esc(text)}</pre>`;
    })
    .join('');
}

export function campaignForm({ campaign, variantStats = [], sample }, shell) {
  const c = campaign || { name: '', visit_first: true, invite_note: '', first_message: '', followups: [] };
  const f = [0, 1, 2].map((i) => c.followups[i] || { days: [3, 5, 7][i], text: '' });
  const box = (name, value, placeholder, max) => `<textarea name="${name}" data-preview="${name}" ${max ? `data-max="${max}"` : ''} placeholder="${esc(placeholder)}">${esc(value)}</textarea>
    <div class="preview" id="pv-${name}">${preview(value, sample, max)}</div>`;
  const stats = variantStats.length
    ? `<div class="card section"><div class="card-head"><h2>A/B results</h2><span class="hint" style="margin:0">Versions are picked at random for each lead</span></div><div class="table-wrap"><table><thead><tr><th>Step</th><th>Version</th><th>Sent</th><th>Result</th></tr></thead><tbody>${variantStats
        .map((v) => `<tr><td>${esc(v.kind)}</td><td>${String.fromCharCode(65 + v.variant)}</td><td>${v.sent}</td><td><b>${v.kind === 'Invite note' ? pct(v.accepted, v.sent) : pct(v.replied, v.sent)}</b> <span class="muted">${v.kind === 'Invite note' ? 'accepted' : 'replied'}</span></td></tr>`)
        .join('')}</tbody></table></div></div>`
    : '';
  const tokens = ['firstName', 'fullName', 'company', 'headline', 'location'].map((t) => `<button type="button" data-token="{{${t}}}">{{${t}}}</button>`).join('');
  return layout(campaign ? c.name : 'New campaign', '/campaigns', `
<form method="post" action="${campaign ? `/campaigns/${campaign.id}` : '/campaigns'}" id="campaign">
<div class="layout-2">
  <div>
    <div class="card card-pad"><label class="field" style="margin:0"><span class="lbl">Campaign name</span><input name="name" required value="${esc(c.name)}" placeholder="For example: Texas real-estate CEOs"></label></div>
    <div class="card card-pad section">
      <h2 style="margin-bottom:18px">Sequence</h2>
      <div class="seq">
        <div class="step"><span class="badge">${icon('eye', 18)}</span><div>
          <h3>1. View their profile</h3>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="visit_first" ${c.visit_first ? 'checked' : ''}> Visit each profile a few hours before inviting, like a person would</label>
        </div></div>
        <div class="step"><span class="badge">${icon('user_plus', 18)}</span><div>
          <h3>2. Invitation note <span class="muted" style="font-weight:400">(optional, up to ${INVITE_NOTE_MAX} characters)</span></h3>
          <p class="hint" style="margin:2px 0 10px">Leave empty to invite without a note.</p>
          ${box('invite_note', c.invite_note, 'Hi {{firstName}}, I work with teams like {{company|yours}}. Happy to connect.', INVITE_NOTE_MAX)}
        </div></div>
        <div class="step"><span class="badge">${icon('mail', 18)}</span><div>
          <h3>3. First message, once they accept</h3>
          <p class="hint" style="margin:2px 0 10px">Sent soon after LinkedAuto sees the new connection.</p>
          ${box('first_message', c.first_message, 'Thanks for connecting, {{firstName}}!')}
        </div></div>
        ${f
          .map(
            (x, i) => `<div class="step"><span class="badge">${icon('clock', 18)}</span><div>
          <h3>${4 + i}. Follow-up ${i + 1} <span class="muted" style="font-weight:400">(optional)</span></h3>
          <div class="wait" style="margin-top:6px">If no reply, wait <input name="f${i}_days" type="number" min="1" max="60" value="${x.days}"> days after the previous message, then send:</div>
          ${box(`f${i}_text`, x.text, `Leave empty for no follow-up ${i + 1}`)}
        </div></div>`,
          )
          .join('')}
        <div class="step"><span class="badge" style="background:var(--good-soft);color:var(--good)">${icon('check', 18)}</span><div><h3>Stops the moment they reply</h3><p class="hint" style="margin:2px 0 0">Checked in the inbox and in the conversation before every follow-up. Invitations still pending after 21 days are withdrawn.</p></div></div>
      </div>
    </div>
  </div>
  <div class="grid sticky">
    <div class="card card-pad">
      <h2>Personalise</h2>
      <p class="hint" style="margin:4px 0 12px">Click to insert at the cursor.</p>
      <div class="tokens">${tokens}</div>
      <p class="hint">Add a fallback for empty fields: <code>{{company|your team}}</code>.</p>
    </div>
    <div class="card card-pad">
      <h2>A/B test</h2>
      <p class="hint" style="margin:4px 0 0">Put a line with only <code>---</code> between two versions of a note or message. Each lead gets one at random, and the results show which works better.</p>
    </div>
    <div class="card card-pad">
      <h2>Preview lead</h2>
      <p class="hint" style="margin:4px 0 0">Previews use <b>${esc(sample.full_name)}</b>, ${esc(sample.headline)}, ${esc(sample.location)}.</p>
    </div>
  </div>
</div>
<div class="savebar"><button class="primary lg">${icon('check', 16)} ${campaign ? 'Save changes' : 'Create campaign'}</button>${campaign ? '' : '<span class="hint" style="margin:0">New campaigns start turned off.</span>'}</div>
</form>
${stats}
<script type="module">
import { variants, render } from '/assets/text.js';
const sample = ${JSON.stringify(sample).replace(/</g, '\\u003c')};
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
let last = null;
document.querySelectorAll('textarea[data-preview]').forEach((t) => {
  const out = document.getElementById('pv-' + t.dataset.preview);
  const max = Number(t.dataset.max) || 0;
  const draw = () => {
    const list = variants(t.value);
    out.innerHTML = list.length ? list.map((v, i) => {
      const text = render(v, sample);
      const over = max && text.length > max;
      return '<div class="v">' + (list.length > 1 ? 'Version ' + String.fromCharCode(65 + i) + ' · ' : '') + '<span class="counter' + (over ? ' over' : '') + '">' + text.length + (max ? ' / ' + max : '') + ' characters' + (over ? ', will be cut' : '') + '</span></div><pre class="msg">' + esc(text) + '</pre>';
    }).join('') : '<div class="v">Nothing written yet.</div>';
  };
  t.addEventListener('input', draw);
  t.addEventListener('focus', () => (last = t));
});
document.querySelectorAll('[data-token]').forEach((b) => b.addEventListener('click', () => {
  const t = last || document.querySelector('textarea[data-preview]');
  const s = t.selectionStart ?? t.value.length;
  t.value = t.value.slice(0, s) + b.dataset.token + t.value.slice(t.selectionEnd ?? s);
  t.focus();
  t.selectionStart = t.selectionEnd = s + b.dataset.token.length;
  t.dispatchEvent(new Event('input'));
}));
</script>`, shell, {
    subtitle: campaign ? `${c.active ? 'On' : 'Off'} · ${esc(sequenceSummary(c))}` : 'Write the steps once; LinkedAuto runs them for every lead in this campaign, at a human pace.',
    actions: campaign
      ? `<a class="btn ghost" href="/leads?campaign=${campaign.id}">${icon('users', 15)} Leads</a><form class="inline" method="post" action="/campaigns/${campaign.id}/${c.active ? 'stop' : 'start'}"><button class="${c.active ? '' : 'primary'}">${c.active ? 'Turn off' : 'Turn on'}</button></form>`
      : '',
  });
}

export function settingsPage({ limits, timeZone }, shell) {
  const s = shell.settings;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((d, i) => `<label><input type="checkbox" name="day${i}" ${s.schedule.days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`)
    .join('');
  const num = (name, label, value, min, max, hint = '') => `<label class="field"><span class="lbl">${label}</span><input type="number" name="${name}" value="${value}" min="${min}" max="${max}">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const invitesPaused = s.invites_paused_until && Date.parse(s.invites_paused_until) > Date.now();
  return layout('Settings', '/settings', `
<form method="post" action="/settings" id="settings" data-dry="${s.dry_run ? 1 : 0}">
<div class="card">
  <div class="set" id="mode">
    <div class="about"><h2>Mode</h2><p>Practice mode is the safe way to try campaigns. Keep it on until you have watched a few actions and they look right.</p></div>
    <div>
      <label class="switch"><input type="checkbox" name="dry_run" ${s.dry_run ? 'checked' : ''}><span><b>Practice mode (dry run)</b><span class="hint" style="display:block;margin-top:2px">Go through every step, but never press Connect, Send or Withdraw. Nothing reaches anyone on LinkedIn.</span></span></label>
      ${s.dry_run ? '' : `<div class="banner warn" style="margin:14px 0 0">${icon('alert', 18)}<div class="grow"><b>Live mode.</b>Real invitations and messages go out within your limits.</div></div>`}
    </div>
  </div>
  <div class="set">
    <div class="about"><h2>Limits</h2><p>Your ceilings. LinkedAuto runs below them during warm-up, when acceptance drops, or after LinkedIn shows a limit. Right now it runs at <b>${Math.round(limits.factor * 100)}%</b>.</p></div>
    <div class="fields">
      ${num('invites_per_week', 'Invitations per week', s.limits.invites_per_week, 1, 150, 'Safe range 50 to 100')}
      ${num('invites_per_day', 'Invitations per day', s.limits.invites_per_day, 1, 30)}
      ${num('messages_per_day', 'Messages per day', s.limits.messages_per_day, 1, 60)}
      ${num('page_views_per_day', 'LinkedIn pages per day', s.limits.page_views_per_day, 5, 150, 'Every profile, search page and check')}
      ${num('withdraws_per_day', 'Withdrawals per day', s.limits.withdraws_per_day, 0, 30)}
      ${num('withdraw_after_days', 'Withdraw invitations after (days)', s.withdraw_after_days, 14, 60)}
    </div>
  </div>
  <div class="set">
    <div class="about"><h2>Working hours</h2><p>LinkedAuto only works inside these hours, in ${esc(timeZone)} time, like a person at a desk.</p></div>
    <div>
      <div class="days">${days}</div>
      <div class="fields">
        <label class="field"><span class="lbl">Start</span><input type="time" name="start" value="${esc(s.schedule.start)}"></label>
        <label class="field"><span class="lbl">End</span><input type="time" name="end" value="${esc(s.schedule.end)}"></label>
        <label class="field"><span class="lbl">Break from</span><input type="time" name="break_start" value="${esc(s.schedule.break_start || '')}"></label>
        <label class="field"><span class="lbl">Break until</span><input type="time" name="break_end" value="${esc(s.schedule.break_end || '')}"></label>
      </div>
    </div>
  </div>
  <div class="set">
    <div class="about"><h2>Pacing</h2><p>A random wait between actions, and a longer break after a burst, so the rhythm looks human.</p></div>
    <div class="fields">
      ${num('min_gap_s', 'Shortest gap (seconds)', s.pacing.min_gap_s, 20, 600)}
      ${num('max_gap_s', 'Longest gap (seconds)', s.pacing.max_gap_s, 30, 1200)}
      ${num('burst', 'Break after this many actions in 30 min', s.pacing.burst, 2, 20)}
    </div>
  </div>
  <div class="set">
    <div class="about"><h2>Warm-up</h2><p>A new automation pattern ramps up slowly: 30%, 50%, 75%, then 100% of your limits over four weeks.</p></div>
    <div>
      <label class="switch" style="margin-bottom:14px"><input type="checkbox" name="warmup_enabled" ${s.warmup.enabled ? 'checked' : ''}><span><b>Ramp up over four weeks</b><span class="hint" style="display:block;margin-top:2px">Starts counting from the first time you press Start.</span></span></label>
      <label class="field"><span class="lbl">Warm-up started on</span><input type="date" name="warmup_start" value="${esc(s.warmup.start_date || '')}"></label>
    </div>
  </div>
</div>
<div class="savebar"><button class="primary lg">${icon('check', 16)} Save settings</button></div>
</form>

<div class="card section">
  <div class="set">
    <div class="about"><h2>Recovery</h2><p>After LinkedIn's invitation limit, invitations pause for a week and limits drop by 20% each time.</p></div>
    <div>
      <p style="margin:0 0 12px">Limits are at <b>${Math.round((s.cap_factor ?? 1) * 100)}%</b>.${invitesPaused ? ` Invitations are paused until <b>${esc(when(s.invites_paused_until))}</b>.` : ''}</p>
      <form method="post" action="/settings/recover" data-confirm="Restore limits to 100% and allow invitations again? Only do this if LinkedIn's limit has clearly passed."><button>Restore limits to 100% and allow invitations</button></form>
    </div>
  </div>
</div>
<script>
document.getElementById('settings').addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.dry === '1' && !f.dry_run.checked && !confirm('Turn off practice mode? From now on LinkedAuto sends real invitations and messages on LinkedIn whenever it is started.')) e.preventDefault();
});
</script>`, shell, { subtitle: 'Safety limits, working hours and pacing. The defaults are deliberately careful.' });
}

export function logPage({ actions, events, filter, lead }, shell) {
  const view = filter.view === 'events' ? 'events' : 'actions';
  const tabs = `<div class="chips"><a class="chip ${view === 'actions' ? 'on' : ''}" href="/log">LinkedIn actions</a><a class="chip ${view === 'events' ? 'on' : ''}" href="/log?view=events">System events</a></div>`;
  let body;
  if (view === 'events') {
    body = `<div class="card">${feed(events)}</div>`;
  } else {
    const typeChips = LOG_FILTERS.map(([k, l]) => `<a class="chip ${filter.type === k ? 'on' : ''}" href="/log?${new URLSearchParams(Object.entries({ type: k, lead: filter.lead }).filter(([, v]) => v))}">${l}</a>`).join('');
    const rows = actions
      .map((a) => {
        const [tone, label] = a.result ? RESULT_TEXT[a.result] || ['gray', a.result] : ['info', 'Running'];
        const text = a.type === 'message' ? a.payload.text : a.type === 'invite' ? a.payload.note : '';
        return `<tr><td style="white-space:nowrap"><div>${esc(time(a.at))}</div><div class="muted" style="font-size:12.5px">${esc(day(a.at))}</div></td>
<td style="white-space:nowrap"><b style="font-weight:550">${esc(ACTION_TEXT[a.type] || a.type)}</b>${a.type === 'message' && a.payload.step ? ` <span class="muted">(follow-up ${a.payload.step})</span>` : ''}</td>
<td>${a.full_name || a.profile_url ? `<a href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.full_name || a.profile_url)}</a>` : '<span class="muted">–</span>'}</td>
<td>${pill(tone, label)}${a.dry_run && a.result !== 'dry_run' ? ` ${pill('info', 'practice')}` : ''}</td>
<td style="min-width:240px">${a.detail && !(text && a.detail.includes(text)) ? `<div class="muted" style="font-size:13px">${esc(a.detail)}</div>` : ''}${text ? `<pre class="msg">${esc(text)}</pre>` : ''}</td></tr>`;
      })
      .join('');
    body = `<div class="card">
  <div class="card-pad" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${typeChips}${lead ? `<span class="pill accent" style="margin-left:auto">Lead: ${esc(lead.full_name || lead.profile_url)} <a href="/log${filter.type ? `?type=${filter.type}` : ''}" aria-label="Clear" style="color:inherit">${icon('x', 12)}</a></span>` : ''}</div>
  ${rows ? `<div class="table-wrap" style="border-top:1px solid var(--line)"><table><thead><tr><th>When</th><th>Action</th><th>Lead</th><th>Result</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty" style="border-top:1px solid var(--line)"><div class="ic">${icon('list', 22)}</div><h3>Nothing here yet</h3><p>Every LinkedIn page LinkedAuto opens or acts on shows up here, with the exact text of each note and message.</p></div>`}
</div>`;
  }
  return layout('Activity log', '/log', `<div style="margin-bottom:14px">${tabs}</div>${body}`, shell, {
    refresh: 30,
    subtitle: view === 'events' ? 'Logins, safety stops, replies and your own changes, newest first.' : 'Every LinkedIn page LinkedAuto opened or acted on, newest first. In practice mode this shows what would have been sent.',
  });
}

export function helpPage(shell) {
  return layout('How it works', '/help', `
<div class="grid g2 help">
  <div class="card card-pad" style="grid-column:1/-1">
    <h2>The three parts</h2>
    <div class="diagram">
      <div class="box"><b>This dashboard</b><span class="muted">You plan and watch</span></div><span class="arrow">⇄</span>
      <div class="box"><b>Browser runner</b><span class="muted">Real Chrome on your NAS</span></div><span class="arrow">⇄</span>
      <div class="box"><b>LinkedIn</b><span class="muted">Sees your home IP</span></div>
    </div>
    <p class="muted" style="text-align:center;margin:6px 0 0">The dashboard decides every action and checks every safety rule first. The runner does it in Chrome at a human pace. You can watch it all in the browser view.</p>
  </div>
  <div class="card card-pad" id="setup">
    <h2>First time</h2>
    <ol>
      <li><b>Log in:</b> open <a href="/browser">Browser view</a>, click Connect, type the VNC password, and sign in to LinkedIn.</li>
      <li><b>Campaign:</b> <a href="/campaigns/new">create one</a>, write the note and messages, and turn it on.</li>
      <li><b>Leads:</b> <a href="/leads/add">add some</a> from a LinkedIn search or a CSV.</li>
      <li><b>Practice:</b> press <b>Start</b> on Home with practice mode on, and watch.</li>
      <li><b>Go live:</b> when it looks right, turn practice mode off in <a href="/settings#mode">Settings</a>.</li>
    </ol>
  </div>
  <div class="card card-pad">
    <h2>Safety, built in</h2>
    <ul>
      <li>Starts <b>paused</b> and in <b>practice mode</b>.</li>
      <li>Any logout, security check or restriction notice <b>pauses everything</b>; only you can restart it.</li>
      <li>Daily and weekly limits, a four-week warm-up, and smaller limits if acceptance drops.</li>
      <li>Works only in your working hours, with random human-length gaps.</li>
      <li>Stops a lead's sequence the moment they reply.</li>
    </ul>
  </div>
  <div class="card card-pad">
    <h2>Daily use</h2>
    <ul>
      <li><b>Home</b> shows whether it is running, today's limits and results.</li>
      <li><b>Leads</b> shows where each person is. Use <b>History</b> to see everything sent to them.</li>
      <li><b>Activity log</b> shows each action with the exact text.</li>
      <li><b>Pause everything</b> is always in the side bar.</li>
    </ul>
  </div>
  <div class="card card-pad" id="troubleshooting">
    <h2>If something looks wrong</h2>
    <ul>
      <li><b>Runner offline:</b> on the NAS run <code>docker compose ps</code> in the app folder, and <code>docker compose logs runner</code>.</li>
      <li><b>Red LinkedIn warning:</b> open Browser view, deal with it by hand, then press Start.</li>
      <li><b>Nothing happening:</b> check it is started, inside working hours, and a campaign with leads is on.</li>
      <li><b>Invitations paused:</b> LinkedIn's weekly limit was hit; it resumes after 7 days.</li>
    </ul>
  </div>
</div>`, shell, { subtitle: 'A one-page guide for using LinkedAuto safely.' });
}
