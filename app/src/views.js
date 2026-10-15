const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SESSION_TEXT = {
  ok: ['good', 'Logged in to LinkedIn'],
  logged_out: ['bad', 'Logged out. Open the browser view and log in by hand.'],
  checkpoint: ['bad', 'LinkedIn wants a security check. Open the browser view and complete it by hand.'],
  restricted: ['bad', 'LinkedIn shows a restriction notice. Keep everything paused and read it in the browser view.'],
  browser_closed: ['bad', 'The browser window was closed. The runner will reopen it.'],
  unknown: ['warn', 'Not checked yet'],
};

function ago(date) {
  if (!date) return 'never';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function dashboardPage({ status, events, paused, novncUrl }) {
  const online = status.last_seen && Date.now() - new Date(status.last_seen).getTime() < 3 * 60 * 1000;
  const [tone, sessionText] = SESSION_TEXT[status.session] || SESSION_TEXT.unknown;
  const rows = events
    .map((e) => `<tr><td>${esc(new Date(e.at).toLocaleString())}</td><td>${esc(e.source)}</td><td>${esc(e.kind)}</td><td>${esc(e.detail)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>LinkedAuto</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e3e3df; --good:#1f7a3a; --bad:#b42318; --warn:#9a6700; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#1f1f1d; --ink:#ececea; --muted:#a3a39e; --line:#33332f; --good:#4ac26b; --bad:#ff7b72; --warn:#d29922; } }
  body { margin:0; font:15px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width:880px; margin:0 auto; padding:24px 16px; }
  h1 { font-size:20px; margin:0 0 16px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-bottom:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .label { color:var(--muted); font-size:13px; }
  .value { font-weight:600; margin-top:2px; }
  .good { color:var(--good); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13px; }
  td, th { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  .scroll { overflow-x:auto; }
  a { color:inherit; }
</style></head>
<body><main>
<h1>LinkedAuto</h1>
<div class="cards">
  <div class="card"><div class="label">Runner</div>
    <div class="value ${online ? 'good' : 'bad'}">${online ? 'Online' : 'Offline'}</div>
    <div class="label">Last seen ${esc(ago(status.last_seen))}${status.version ? ` · v${esc(status.version)}` : ''}</div></div>
  <div class="card"><div class="label">LinkedIn session</div>
    <div class="value ${tone}">${esc(sessionText)}</div>
    ${status.detail ? `<div class="label">${esc(status.detail)}</div>` : ''}
    ${novncUrl ? `<div class="label"><a href="${esc(novncUrl)}" target="_blank" rel="noopener">Open browser view</a></div>` : ''}</div>
  <div class="card"><div class="label">Automation</div>
    <div class="value ${paused ? 'warn' : 'good'}">${paused ? 'Paused' : 'Running'}</div>
    <form method="post" action="${paused ? '/resume' : '/pause'}" style="margin-top:8px"><button>${paused ? 'Resume' : 'Pause everything'}</button></form></div>
</div>
<h2 style="font-size:16px">Activity log</h2>
<div class="scroll"><table><thead><tr><th>When</th><th>From</th><th>Event</th><th>Detail</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4">Nothing yet</td></tr>'}</tbody></table></div>
</main></body></html>`;
}
