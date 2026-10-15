// End-to-end: real app + real runner + real browser against the fake LinkedIn.
// Time is fast-forwarded in the database so a weeks-long sequence runs in minutes.
//
//   TEST_DATABASE_URL=postgres://... CHROME_PATH=/path/to/chrome node test/e2e.mjs
//
// TEST_DATABASE_URL must point at a throwaway database: it is wiped first.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createFakeLinkedIn } from '../../runner/test/fake-linkedin.js';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error('Set TEST_DATABASE_URL to a throwaway database');
const TOKEN = 'e2e-token-0123456789abcdef0123';
const PORT = 3000 + Math.floor(Math.random() * 1000);
const APP = `http://127.0.0.1:${PORT}`;
const root = new URL('../../', import.meta.url).pathname;

const sql = postgres(DB, { onnotice: () => {} });
await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;

const fake = createFakeLinkedIn();
fake.people.get('gina-g').limit = false; // the limit is tested separately at the end
const base = await fake.listen();

const procs = [];
function start(name, cmd, args, env, cwd) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => process.env.VERBOSE && process.stdout.write(`[${name}] ${d}`);
  p.stdout.on('data', out);
  p.stderr.on('data', (d) => process.stdout.write(`[${name}!] ${d}`));
  procs.push(p);
  return p;
}
const cleanup = async () => {
  for (const p of procs) p.kill();
  await fake.close();
  await sql.end();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function form(path, fields) {
  const res = await fetch(APP + path, { method: 'POST', body: new URLSearchParams(fields), redirect: 'manual' });
  assert.ok(res.status < 400, `${path} -> ${res.status}`);
}
async function until(what, check, ms = 240_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await check()) return;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}
const lead = async (slug) => (await sql`SELECT * FROM leads WHERE profile_url = ${`https://www.linkedin.com/in/${slug}/`}`)[0];

try {
  start('app', 'node', ['src/server.js'], { DATABASE_URL: DB, RUNNER_TOKEN: TOKEN, PORT: String(PORT), TZ: 'Asia/Karachi' }, join(root, 'app'));
  await until('app up', async () => (await fetch(APP + '/healthz').catch(() => null))?.ok, 20_000);

  // Campaign, settings, import, as you would in the dashboard.
  await form('/campaigns', {
    name: 'Texas CEOs',
    visit_first: 'on',
    invite_note: 'Hi {{firstName}}, I work with teams like {{company|yours}}. Happy to connect.\n---\nHello {{firstName}}, would love to connect.',
    first_message: 'Thanks for connecting, {{firstName}}!',
    f0_days: '2', f0_text: 'Following up, {{firstName}}.',
    f1_days: '4', f1_text: 'Last note from me, {{firstName}}.',
  });
  await form('/campaigns/1/start', {});
  await form('/settings', {
    invites_per_week: '80', invites_per_day: '15', messages_per_day: '25', page_views_per_day: '150', withdraws_per_day: '10', withdraw_after_days: '21',
    day0: 'on', day1: 'on', day2: 'on', day3: 'on', day4: 'on', day5: 'on', day6: 'on', start: '00:00', end: '23:59',
    min_gap_s: '20', max_gap_s: '30', burst: '20',
  }); // dry_run and warm-up checkboxes left unticked = off
  await form('/imports', { search_url: 'https://www.linkedin.com/search/results/people/?keywords=ceo', campaign_id: '1', max_pages: '3', tags: 'texas' });

  const profile = mkdtempSync(join(tmpdir(), 'la-profile-'));
  start('runner', 'node', ['src/runner.js'], {
    API_URL: APP, RUNNER_TOKEN: TOKEN, PROFILE_DIR: profile, LINKEDIN_BASE: base, START_URL: `${base}/login`,
    HEADLESS: '1', LOOP_SPEED: '0.01', HUMAN_SPEED: '0.01', CHROME_PATH: process.env.CHROME_PATH || '',
  }, join(root, 'runner'));
  await until('runner logged in', async () => (await sql`SELECT session FROM runner_status`)[0].session === 'ok', 30_000);
  await form('/resume', {});

  // Fast-forward: no pacing waits, every scheduled step due now, syncs due.
  // Plays the people on the other side too: Alice, Bob and Erin accept; Alice replies.
  let replied = false;
  let tick = 0;
  const clock = setInterval(async () => {
    try {
      await sql`DELETE FROM settings WHERE key = 'not_before'`;
      if (++tick % 20 === 0) await sql`DELETE FROM settings WHERE key IN ('last_sync_inbox', 'last_sync_connections')`;
      await sql`UPDATE leads SET next_action_at = now() WHERE next_action_at > now() AND status IN ('visited', 'connected', 'messaged')`;
      for (const slug of ['alice-a', 'erin-e']) {
        if (fake.people.get(slug).state === 'pending') await fetch(`${base}/__accept/${slug}`, { method: 'POST' });
      }
      const a = await lead('alice-a');
      if (!replied && a?.msg_step === 1) {
        replied = true;
        await fetch(`${base}/__reply/alice-a`, { method: 'POST' });
      }
      // Bob never answers: age his invitation so it gets withdrawn.
      await sql`UPDATE leads SET invited_at = now() - interval '30 days' WHERE status = 'invited' AND profile_url LIKE '%/bob-b/'`;
    } catch {}
  }, 250);

  await until('sequence finished', async () => {
    const rows = await sql`SELECT profile_url, status FROM leads`;
    const s = Object.fromEntries(rows.map((r) => [r.profile_url.split('/')[4], r.status]));
    if (process.env.VERBOSE) console.log(JSON.stringify(s));
    return rows.length === 7 && s['alice-a'] === 'replied' && s['erin-e'] === 'done' && s['bob-b'] === 'withdrawn' &&
      s['carol-c'] === 'done' && s['dan-d'] === 'skipped' && s['frank-f'] === 'skipped' && s['gina-g'] === 'invited';
  });
  clearInterval(clock);

  // What was actually "sent" to LinkedIn.
  const sent = (slug, type) => fake.log.filter((l) => l.slug === slug && l.type === type).map((l) => l.text);
  assert.match(sent('alice-a', 'invite')[0], /^(Hi Alice, I work with teams like Anders Realty\. Happy to connect\.|Hello Alice, would love to connect\.)$/);
  assert.deepEqual(sent('alice-a', 'message'), ['Thanks for connecting, Alice!'], 'no follow-up after Alice replied');
  assert.deepEqual(sent('erin-e', 'message'), ['Thanks for connecting, Erin!', 'Following up, Erin.', 'Last note from me, Erin.']);
  assert.deepEqual(sent('carol-c', 'invite'), [], 'already connected: no invitation');
  assert.equal(sent('carol-c', 'message').length, 3);
  assert.deepEqual(sent('dan-d', 'invite'), [], 'email-gated invite skipped');
  assert.equal(fake.log.filter((l) => l.type === 'withdraw').length, 1);
  const imp = (await sql`SELECT * FROM imports`)[0];
  assert.equal(imp.status, 'done');
  assert.equal(imp.added, 7);
  assert.equal((await lead('alice-a')).company, 'Anders Realty');
  assert.deepEqual((await lead('alice-a')).tags, ['texas']);

  // LinkedIn's weekly limit: invitations stop for a week and caps drop 20%.
  fake.people.set('hank-h', { slug: 'hank-h', name: 'Hank Hill', headline: 'CEO at Strickland', location: 'Arlen, Texas', state: 'none', limit: true, connectInMore: false, emailRequired: false, thread: [] });
  await form('/leads/csv', { csv: 'profile_url,name\nhttps://www.linkedin.com/in/hank-h/,Hank Hill\n', campaign_id: '1' });
  const clock2 = setInterval(async () => {
    await sql`DELETE FROM settings WHERE key = 'not_before'`.catch(() => {});
    await sql`UPDATE leads SET next_action_at = now() WHERE status = 'visited' AND profile_url LIKE '%/hank-h/' AND next_action_at < now() + interval '1 day'`.catch(() => {});
  }, 250);
  await until('limit handled', async () => Boolean((await sql`SELECT value FROM settings WHERE key = 'invites_paused_until'`)[0]?.value), 60_000);
  clearInterval(clock2);
  assert.equal((await sql`SELECT value FROM settings WHERE key = 'cap_factor'`)[0].value, 0.8);
  assert.equal((await lead('hank-h')).status, 'visited');

  // The dashboard pages render with real data.
  for (const path of ['/', '/leads', '/leads?status=replied', '/leads/add', '/leads.csv', '/campaigns', '/campaigns/1', '/campaigns/new', '/settings', '/log', '/log?type=sync', '/log?lead=1', '/log?view=events', '/browser', '/help', '/assets/text.js']) {
    const res = await fetch(APP + path);
    assert.equal(res.status, 200, path);
  }
  // The browser view follows the host the dashboard was opened on.
  assert.match(await (await fetch(APP + '/browser')).text(), /src="http:\/\/127\.0\.0\.1:6080\/vnc\.html\?autoconnect=1/);
  const csv = await (await fetch(APP + '/leads.csv')).text();
  assert.match(csv, /alice-a.*Alice Anders.*replied/);

  // A security check pauses everything at once.
  await form('/resume', {});
  await sql`UPDATE runner_status SET session = 'ok'`;
  const hb = await fetch(APP + '/api/runner/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ session: 'checkpoint', detail: 'unusual activity' }) });
  assert.equal((await hb.json()).paused, true);
  const home = await (await fetch(APP + '/')).text();
  assert.match(home, /LinkedIn warning: Security check\. Everything is paused\./);
  const refused = await fetch(APP + '/resume', { method: 'POST', redirect: 'manual' });
  assert.match(refused.headers.get('location'), /err=/, 'start refused while LinkedIn shows a warning');
  assert.equal((await sql`SELECT value FROM settings WHERE key = 'paused'`)[0].value, true);

  const counts = await sql`SELECT type, result, count(*)::int AS n FROM actions GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log('Actions run:', counts.map((c) => `${c.type}/${c.result}=${c.n}`).join(', '));
  console.log('E2E PASSED');
} catch (err) {
  console.error('E2E FAILED:', err);
  const rows = await sql`SELECT profile_url, status, msg_step, error FROM leads ORDER BY id`.catch(() => []);
  console.error(rows);
  console.error(await sql`SELECT type, result, detail FROM actions ORDER BY id DESC LIMIT 15`.catch(() => []));
  process.exitCode = 1;
} finally {
  await cleanup();
}
