// A small stand-in for LinkedIn, shaped like its real pages (roles, labels
// and the class names linkedin.js relies on), so the runner can be tested
// end to end without touching a real account. Test hooks start with /__.
import http from 'node:http';

export function createFakeLinkedIn() {
  const people = new Map();
  const log = []; // everything "sent": { type, slug, text }
  const add = (slug, p) => people.set(slug, { state: 'none', connectInMore: false, emailRequired: false, limit: false, replied: false, thread: [], ...p, slug });

  add('alice-a', { name: 'Alice Anders', headline: 'CEO at Anders Realty', location: 'Austin, Texas' });
  add('bob-b', { name: 'Bob Brown', headline: 'Founder at Brownstone', location: 'Dallas, Texas', connectInMore: true });
  add('carol-c', { name: 'Carol Chen', headline: 'Broker at Chen Homes', location: 'Houston, Texas', state: 'connected' });
  add('dan-d', { name: 'Dan Diaz', headline: 'Realtor', location: 'Miami, Florida', emailRequired: true });
  add('erin-e', { name: 'Erin Evans', headline: 'COO at Evans Group', location: 'Denver, Colorado' });
  add('frank-f', { name: 'Frank Ford', headline: 'Investor', location: 'Phoenix, Arizona', state: 'follow_only' });
  add('gina-g', { name: 'Gina Gale', headline: 'CEO at Gale Estates', location: 'Seattle, Washington', limit: true });

  const page = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif} [hidden]{display:none!important} dialog,[role=dialog]{border:1px solid #999;padding:12px;background:#fff}</style></head>
<body><nav><a href="/feed/">Home</a> <a href="/mynetwork/">My Network</a> <a href="/messaging/">Messaging</a></nav><main>${body}</main>
<script>${script}</script></body></html>`;

  const btn = (label, text, extra = '') => `<button aria-label="${label}" ${extra}><span>${text}</span></button>`;

  function profile(p) {
    const degree = p.state === 'connected' ? '1st' : '2nd';
    let actions = '';
    if (p.state === 'connected') actions = btn(`Message ${p.name}`, 'Message', 'id="msg"');
    else if (p.state === 'pending') actions = btn(`Pending, click to withdraw invitation sent to ${p.name}`, 'Pending', 'id="pending"') + btn(`Message ${p.name}`, 'Message', 'id="msg"');
    else if (p.state === 'follow_only') actions = btn(`Follow ${p.name}`, 'Follow') + btn(`Message ${p.name}`, 'Message', 'id="msg"');
    else if (p.connectInMore) actions = btn(`Follow ${p.name}`, 'Follow');
    else actions = btn(`Invite ${p.name} to connect`, 'Connect', 'id="connect"');
    actions += btn('More actions', 'More', 'id="more"');
    const menu = `<div role="menu" id="menu" hidden>${p.state === 'none' && p.connectInMore ? `<div role="button" tabindex="0" aria-label="Invite ${p.name} to connect" id="connect2">Connect</div>` : ''}${p.state === 'connected' ? '<div role="button" tabindex="0">Remove connection</div>' : ''}<div role="button" tabindex="0">Save to PDF</div></div>`;
    const groups = p.thread.map((m) => `<div class="msg-s-message-group"><span class="msg-s-message-group__name">${m.from}</span><p>${m.text}</p></div>`).join('');
    const body = `<section class="top-card"><h1>${p.name}</h1><span class="dist">· ${degree}</span>
<div class="text-body-medium">${p.headline}</div><span class="text-body-small">${p.location}</span><span class="text-body-small">Contact info</span>
<div class="actions">${actions}</div>${menu}</section>
<section><h2>About</h2><p>${'Lorem ipsum dolor sit amet. '.repeat(80)}</p></section>
<div role="dialog" id="invite" hidden>
  ${p.emailRequired ? '<p>To verify this member knows you, please enter their email to connect.</p><input type="email">' : '<p>Add a note to your invitation?</p>'}
  <button id="addnote">Add a note</button><button id="sendnow">Send without a note</button>
  <div id="notebox" hidden><textarea id="note" maxlength="300"></textarea><button id="sendnote" aria-label="Send invitation">Send</button></div>
</div>
<div role="dialog" id="limit" hidden><p>You’ve reached the weekly invitation limit</p></div>
<div role="dialog" id="withdraw" hidden><p>Withdraw invitation</p><button id="wd">Withdraw</button></div>
<aside id="overlay" hidden><h2>${p.name}</h2><div class="msg-s-message-list">${groups}</div>
  <div role="textbox" contenteditable="true" id="box"></div><button id="send" type="submit">Send</button>
  <button aria-label="Close your conversation with ${p.name}" id="close">Close</button></aside>`;
    const script = `
const $ = (id) => document.getElementById(id);
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const openInvite = () => { $('menu').hidden = true; $('invite').hidden = false; };
$('connect') && ($('connect').onclick = openInvite);
$('connect2') && ($('connect2').onclick = openInvite);
$('more').onclick = () => { $('menu').hidden = !$('menu').hidden; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('menu').hidden = true; $('invite').hidden = true; } });
const sent = async (note) => { const r = await post('/api/connect/${p.slug}', { note }); if (r.status === 429) { $('invite').hidden = true; $('limit').hidden = false; } else location.reload(); };
$('addnote').onclick = () => { $('notebox').hidden = false; };
$('sendnow').onclick = () => sent('');
$('sendnote').onclick = () => sent($('note').value);
$('pending') && ($('pending').onclick = () => { $('withdraw').hidden = false; });
$('wd').onclick = async () => { await post('/api/withdraw/${p.slug}'); location.reload(); };
$('msg') && ($('msg').onclick = () => { $('overlay').hidden = false; });
$('close').onclick = () => { $('overlay').hidden = true; };
$('send').onclick = async () => { const text = $('box').innerText; await post('/api/message/${p.slug}', { text });
  const g = document.createElement('div'); g.className = 'msg-s-message-group'; g.innerHTML = '<span class="msg-s-message-group__name">You</span><p></p>'; g.querySelector('p').innerText = text;
  document.querySelector('.msg-s-message-list').appendChild(g); $('box').innerText = ''; };`;
    return page(p.name, body, script);
  }

  function search(n) {
    const all = [...people.values()];
    const per = 4;
    const slice = all.slice((n - 1) * per, n * per);
    const items = slice
      .map((p) => `<li><div><a href="/in/${p.slug}/?miniProfileUrn=x"><img alt=""></a>
<a href="/in/${p.slug}/?miniProfileUrn=x"><span aria-hidden="true">${p.name}</span><span class="visually-hidden">View ${p.name}’s profile</span></a>
<span>• ${p.state === 'connected' ? '1st' : '2nd'}</span><div>${p.headline}</div><div>${p.location}</div>${btn(`Invite ${p.name} to connect`, 'Connect')}</div></li>`)
      .join('');
    const last = n * per >= all.length;
    return page('Search', `<ul>${items}</ul><button aria-label="Next" ${last ? 'disabled' : ''}>Next</button>`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : {};
    const slug = url.pathname.split('/').filter(Boolean).at(-1);

    if (url.pathname === '/login') { res.writeHead(302, { 'set-cookie': 'li_at=fake; Path=/', location: '/feed/' }); return res.end(); }
    if (url.pathname === '/feed/') return send(200, page('Feed', '<h2>Feed</h2>'));
    if (url.pathname.startsWith('/search/results/people')) return send(200, search(Number(url.searchParams.get('page') || 1)));
    const m = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (m) return people.has(m[1]) ? send(200, profile(people.get(m[1]))) : send(404, page('Not found', '<h2>This page doesn’t exist</h2>'));
    if (url.pathname === '/mynetwork/invite-connect/connections/') {
      const items = [...people.values()].filter((p) => p.state === 'connected').map((p) => `<li><a href="/in/${p.slug}/">${p.name}</a></li>`).join('');
      return send(200, page('Connections', `<ul>${items}</ul>`));
    }
    if (url.pathname === '/messaging/') {
      const items = [...people.values()].filter((p) => p.thread.length).map((p) => {
        const last = p.thread.at(-1);
        return `<li class="msg-conversation-listitem"><h3 class="msg-conversation-listitem__participant-names">${p.name}</h3><p class="msg-conversation-card__message-snippet">${last.from === 'You' ? 'You: ' : ''}${last.text}</p></li>`;
      }).join('');
      return send(200, page('Messaging', `<ul>${items}</ul>`));
    }
    const p = people.get(slug);
    if (url.pathname.startsWith('/api/connect/') && p) {
      if (p.limit) return send(429, '{}', 'application/json');
      p.state = 'pending'; log.push({ type: 'invite', slug, text: json.note });
      return send(200, '{}', 'application/json');
    }
    if (url.pathname.startsWith('/api/withdraw/') && p) { p.state = 'none'; log.push({ type: 'withdraw', slug }); return send(200, '{}', 'application/json'); }
    if (url.pathname.startsWith('/api/message/') && p) { p.thread.push({ from: 'You', text: json.text }); log.push({ type: 'message', slug, text: json.text }); return send(200, '{}', 'application/json'); }
    // Test hooks.
    if (url.pathname.startsWith('/__accept/') && p) { p.state = 'connected'; return send(200, 'ok'); }
    if (url.pathname.startsWith('/__reply/') && p) { p.thread.push({ from: p.name, text: 'Thanks, let us talk next week.' }); return send(200, 'ok'); }
    if (url.pathname === '/__state') return send(200, JSON.stringify({ people: [...people.values()], log }), 'application/json');
    send(404, page('Not found', '<h2>This page doesn’t exist</h2>'));
  });

  return {
    people,
    log,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise((r) => server.close(r)),
  };
}

// Run standalone for manual poking: node test/fake-linkedin.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = createFakeLinkedIn();
  fake.listen().then((u) => console.log(`fake LinkedIn on ${u}`));
}
