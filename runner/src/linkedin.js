// LinkedIn page actions. Each one opens a page, behaves like a person
// (pauses, scrolling, mouse moves, typing), and returns
// { result, detail?, data? }. Selectors prefer roles and labels over CSS
// classes, since LinkedIn renames classes often.
//
// Dry run: actions stop before anything is sent. They never click Connect,
// Send or Withdraw, because on some accounts Connect sends at once.
import { classifyText } from './session.js';

const BASE = (process.env.LINKEDIN_BASE || 'https://www.linkedin.com').replace(/\/$/, '');
const SPEED = Number(process.env.HUMAN_SPEED || 1); // tests set this low

const rand = (a, b) => a + Math.random() * (b - a);
export const pause = (page, a, b) => page.waitForTimeout(Math.round(rand(a, b) * SPEED));

// Our stored URLs are canonical linkedin.com URLs; tests point BASE elsewhere.
export function local(url) {
  const u = new URL(url, BASE);
  return BASE + u.pathname + u.search;
}

async function open(page, url) {
  const res = await page.goto(local(url), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await pause(page, 2000, 4500);
  return res;
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + box.width * rand(0.3, 0.7);
  const y = box.y + box.height * rand(0.3, 0.7);
  await page.mouse.move(x, y, { steps: Math.round(rand(8, 22)) });
  await pause(page, 150, 500);
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click({ delay: Math.round(rand(40, 120)) });
  await pause(page, 600, 1500);
}

// Types like a person; new lines use Shift+Enter so Enter never sends early.
async function type(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      await page.keyboard.type(ch);
      await page.waitForTimeout(Math.round(rand(35, 140) * SPEED));
      if (Math.random() < 0.03) await pause(page, 300, 900);
    }
    if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
  }
  await pause(page, 500, 1200);
}

async function browse(page) {
  for (let i = 0, n = Math.round(rand(2, 4)); i < n; i++) {
    await page.mouse.wheel(0, rand(250, 600));
    await pause(page, 800, 2200);
  }
  await page.mouse.wheel(0, -3000);
  await pause(page, 500, 1200);
}

// A LinkedIn warning on the page wins over any other result.
async function warning(page) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (/reached the weekly invitation limit|sent many invitations within a short/i.test(text)) return { result: 'limit', detail: 'LinkedIn invitation limit message' };
  const w = classifyText(text.slice(0, 20000));
  return w ? { result: 'failed', detail: `LinkedIn warning: ${w.detail}` } : null;
}

const notFound = async (page, res) =>
  (res && res.status() === 404) || /\/404\/?/.test(page.url()) || (await page.getByText(/this page doesn.t exist/i).count()) > 0;

// ---------- Profile top card ----------

function topCard(page) {
  return page.locator('main section').filter({ has: page.locator('h1') }).first();
}

async function readProfile(page) {
  const card = topCard(page);
  await card.waitFor({ timeout: 20_000 });
  return card.evaluate((el) => {
    const name = el.querySelector('h1')?.innerText.trim() || null;
    const headline = el.querySelector('.text-body-medium')?.innerText.trim() || null;
    const location = [...el.querySelectorAll('.text-body-small')].map((n) => n.innerText.trim()).find((t) => t && !/contact info|followers|connections/i.test(t)) || null;
    return { fullName: name, headline, location, firstDegree: /(^|\W)1st(\W|$)/.test(el.innerText) };
  });
}

const connectRe = /^Invite .* to connect$/i;

// Where the person stands with us, and the control to invite them if any.
async function relationship(page) {
  const card = topCard(page);
  const pending = card.getByRole('button', { name: /^Pending/i });
  if (await pending.count()) return { state: 'pending', pending: pending.first() };

  const direct = card.getByRole('button', { name: connectRe });
  if (await direct.count()) return { state: 'none', connect: direct.first() };

  const info = await readProfile(page);
  const message = card.getByRole('button', { name: /^Message/i });
  if (info.firstDegree && (await message.count())) return { state: 'connected', message: message.first() };

  // Connect is often hidden under "More".
  const more = card.getByRole('button', { name: /^More actions$|^More$/i });
  if (await more.count()) {
    await click(page, more.first());
    const menu = page.locator('[role="menu"], .artdeco-dropdown__content--is-open').first();
    const item = menu.getByRole('button', { name: connectRe }).or(menu.getByRole('menuitem', { name: connectRe }));
    if (await item.count()) return { state: 'none', connect: item.first() };
    const removeConnection = menu.getByText(/remove connection/i);
    await page.keyboard.press('Escape');
    if (await removeConnection.count()) return { state: 'connected', message: (await message.count()) ? message.first() : null };
  }
  if (await message.count()) return { state: info.firstDegree ? 'connected' : 'follow_only' };
  return { state: 'follow_only' };
}

// ---------- Actions ----------

export async function visit(page, { profileUrl }) {
  const res = await open(page, profileUrl);
  if (await notFound(page, res)) return { result: 'not_found' };
  const w = await warning(page);
  if (w) return w;
  const profile = await readProfile(page);
  await browse(page);
  const rel = await relationship(page);
  return { result: 'ok', data: { ...profile, relationship: rel.state } };
}

export async function invite(page, { profileUrl, note, dryRun }) {
  const res = await open(page, profileUrl);
  if (await notFound(page, res)) return { result: 'not_found' };
  let w = await warning(page);
  if (w) return w;
  const profile = await readProfile(page);
  await pause(page, 1500, 4000);
  const rel = await relationship(page);
  if (rel.state === 'connected') return { result: 'connected', data: profile };
  if (rel.state === 'pending') return { result: 'pending', data: profile };
  if (!rel.connect) return { result: 'skipped', detail: 'No Connect option', data: profile };
  if (dryRun) {
    await page.keyboard.press('Escape');
    return { result: 'dry_run', detail: note ? `Connect found; would send note: ${note}` : 'Connect found; would send without a note', data: profile };
  }

  await click(page, rel.connect);
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 8000 }).catch(() => {});
  w = await warning(page);
  if (w) return w;
  if (await dialog.isVisible().catch(() => false)) {
    const text = await dialog.innerText();
    if (/email/i.test(text) && (await dialog.locator('input[type="email"]').count())) {
      await page.keyboard.press('Escape');
      return { result: 'skipped', detail: 'LinkedIn asks for their email address', data: profile };
    }
    const addNote = dialog.getByRole('button', { name: /add a note/i });
    if (note && (await addNote.count())) {
      await click(page, addNote.first());
      const box = dialog.locator('textarea').first();
      await box.waitFor({ timeout: 5000 });
      await click(page, box);
      await type(page, note);
      await click(page, dialog.getByRole('button', { name: /^Send( invitation)?$/i }).first());
    } else {
      const send = dialog.getByRole('button', { name: /send without a note|^Send( invitation| now)?$/i }).first();
      await click(page, send);
    }
  }
  await pause(page, 1500, 3000);
  w = await warning(page);
  if (w) return w;
  const confirmed = await topCard(page).getByRole('button', { name: /^Pending/i }).count();
  return { result: 'ok', detail: confirmed ? null : 'Sent; Pending not shown yet', data: profile };
}

async function threadSenders(page) {
  return page
    .locator('.msg-s-message-group__name, .msg-s-message-group__profile-link')
    .evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean))
    .catch(() => []);
}

export async function message(page, { profileUrl, name, text, dryRun }) {
  const res = await open(page, profileUrl);
  if (await notFound(page, res)) return { result: 'not_found' };
  let w = await warning(page);
  if (w) return w;
  await pause(page, 1500, 3500);
  const rel = await relationship(page);
  const button = rel.message || (await topCard(page).getByRole('button', { name: /^Message/i }).count() ? topCard(page).getByRole('button', { name: /^Message/i }).first() : null);
  if (rel.state !== 'connected' || !button) return { result: 'not_connected' };

  await click(page, button);
  const box = page.locator('[role="textbox"][contenteditable="true"]').last();
  await box.waitFor({ timeout: 15_000 });
  await pause(page, 1500, 3000);

  // Stop the sequence if they have written to us.
  const fullName = (name || '').trim().toLowerCase();
  const senders = (await threadSenders(page)).map((s) => s.toLowerCase());
  if (fullName && senders.some((s) => s.includes(fullName) || fullName.includes(s))) {
    await closeConversation(page);
    return { result: 'replied' };
  }
  if (dryRun) {
    await closeConversation(page);
    return { result: 'dry_run', detail: `Message box found; would send: ${text}` };
  }

  await click(page, box);
  await type(page, text);
  const send = page.getByRole('button', { name: /^Send$/i }).last();
  await click(page, send);
  await pause(page, 1500, 3000);
  w = await warning(page);
  if (w) return w;
  const sent = await page.getByText(text.split('\n')[0].slice(0, 40), { exact: false }).count();
  await closeConversation(page);
  return { result: 'ok', detail: sent ? null : 'Sent; not seen in the thread yet' };
}

async function closeConversation(page) {
  const close = page.getByRole('button', { name: /^Close your (conversation|draft)/i });
  if (await close.count()) await click(page, close.last());
  else await page.keyboard.press('Escape');
}

export async function withdraw(page, { profileUrl, dryRun }) {
  const res = await open(page, profileUrl);
  if (await notFound(page, res)) return { result: 'not_found' };
  const w = await warning(page);
  if (w) return w;
  await pause(page, 1500, 3000);
  const rel = await relationship(page);
  if (rel.state !== 'pending') return { result: 'not_pending', detail: `Relationship is ${rel.state}` };
  if (dryRun) return { result: 'dry_run', detail: 'Pending found; would withdraw' };
  await click(page, rel.pending);
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 8000 });
  await click(page, dialog.getByRole('button', { name: /^Withdraw$/i }).first());
  await pause(page, 1500, 3000);
  return { result: 'ok' };
}

// ---------- Lists ----------

const profileLinks = (page) =>
  page.locator('main').evaluate((main) => [...new Set([...main.querySelectorAll('a[href*="/in/"]')].map((a) => new URL(a.href).pathname.match(/^\/in\/[^/]+/)?.[0]).filter(Boolean))]);

export async function syncConnections(page) {
  await open(page, `${BASE}/mynetwork/invite-connect/connections/`);
  const w = await warning(page);
  if (w) return w;
  await page.locator('main a[href*="/in/"]').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await browse(page);
  const paths = await profileLinks(page);
  return { result: 'ok', data: { profiles: paths.slice(0, 60).map((p) => `https://www.linkedin.com${p}/`) } };
}

export async function syncInbox(page) {
  await open(page, `${BASE}/messaging/`);
  const w = await warning(page);
  if (w) return w;
  const items = page.locator('li.msg-conversation-listitem, li[class*="msg-conversation-listitem"]');
  await items.first().waitFor({ timeout: 20_000 }).catch(() => {});
  await pause(page, 1500, 3500);
  const conversations = await items.evaluateAll((els) =>
    els.slice(0, 40).map((li) => {
      const name = (li.querySelector('[class*="participant-names"], h3')?.innerText || '').trim();
      const snippet = (li.querySelector('[class*="message-snippet"], p')?.innerText || '').trim();
      return { name, snippet: snippet.slice(0, 80), lastFromMe: /^You:/.test(snippet) };
    }),
  );
  return { result: 'ok', data: { conversations } };
}

const SKIP_LINE = /^(•|·)?\s*(1st|2nd|3rd\+?)\b|degree connection|^(connect|message|follow|following|pending)$|^status is|^view .* profile|mutual connection|^(current|past|summary):/i;

export async function importPage(page, { searchUrl, page: n }) {
  const url = new URL(local(searchUrl));
  url.searchParams.set('page', String(n));
  await open(page, url.toString());
  const w = await warning(page);
  if (w) return w;
  await page.locator('main a[href*="/in/"]').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await browse(page);
  await page.mouse.wheel(0, 4000);
  await pause(page, 1000, 2000);

  const profiles = await page.locator('main').evaluate((main, skip) => {
    const re = new RegExp(skip, 'i');
    const seen = new Map();
    for (const a of main.querySelectorAll('a[href*="/in/"]')) {
      const path = new URL(a.href).pathname.match(/^\/in\/[^/]+/)?.[0];
      if (!path || seen.has(path)) continue;
      const item = a.closest('li') || a.parentElement;
      // LinkedIn repeats the link (photo, name); the visible name sits in an aria-hidden span.
      const links = [...(item || a).querySelectorAll('a[href*="/in/"]')].filter((x) => new URL(x.href).pathname.startsWith(path));
      const nameText = links
        .map((x) => x.querySelector('span[aria-hidden="true"]')?.innerText || [...x.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '))
        .map((t) => (t || '').split('\n')[0].trim())
        .find(Boolean) || '';
      const lines = (item?.innerText || '').split('\n').map((l) => l.trim()).filter((l) => l && !re.test(l));
      const fullName = nameText && !/^view /i.test(nameText) ? nameText : lines[0] || null;
      const rest = lines.filter((l) => !fullName || !l.includes(fullName));
      seen.set(path, { profileUrl: `https://www.linkedin.com${path}/`, fullName, headline: rest[0] || null, location: rest[1] || null });
    }
    return [...seen.values()].filter((p) => p.fullName && !/^LinkedIn Member$/i.test(p.fullName));
  }, SKIP_LINE.source);

  const next = page.getByRole('button', { name: /^Next$/i });
  const hasMore = profiles.length > 0 && (await next.count()) > 0 && (await next.first().isEnabled());
  return { result: 'ok', data: { profiles, hasMore } };
}

export const ACTIONS = {
  visit,
  invite,
  message,
  withdraw,
  sync_connections: syncConnections,
  sync_inbox: syncInbox,
  import_page: importPage,
};
