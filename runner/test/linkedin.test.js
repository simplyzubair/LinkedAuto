// Runs every LinkedIn action against the fake site in a real browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createFakeLinkedIn } from './fake-linkedin.js';

const fake = createFakeLinkedIn();
let browser, page, L;
const url = (slug) => `https://www.linkedin.com/in/${slug}/`;

before(async () => {
  const base = await fake.listen();
  process.env.LINKEDIN_BASE = base;
  process.env.HUMAN_SPEED = '0.01';
  L = await import('../src/linkedin.js');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  page = await browser.newPage();
});
after(async () => { await browser?.close(); await fake.close(); });

test('import reads search results page by page', async () => {
  const p1 = await L.importPage(page, { searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=ceo', page: 1 });
  assert.equal(p1.result, 'ok');
  assert.equal(p1.data.profiles.length, 4);
  assert.deepEqual(p1.data.profiles[0], { profileUrl: url('alice-a'), fullName: 'Alice Anders', headline: 'CEO at Anders Realty', location: 'Austin, Texas' });
  assert.equal(p1.data.hasMore, true);
  const p2 = await L.importPage(page, { searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=ceo', page: 2 });
  assert.equal(p2.data.profiles.length, 3);
  assert.equal(p2.data.hasMore, false);
});

test('visit reads the profile and relationship', async () => {
  const a = await L.visit(page, { profileUrl: url('alice-a') });
  assert.equal(a.result, 'ok');
  assert.equal(a.data.fullName, 'Alice Anders');
  assert.equal(a.data.headline, 'CEO at Anders Realty');
  assert.equal(a.data.location, 'Austin, Texas');
  assert.equal(a.data.relationship, 'none');
  assert.equal((await L.visit(page, { profileUrl: url('bob-b') })).data.relationship, 'none'); // Connect under More
  assert.equal((await L.visit(page, { profileUrl: url('carol-c') })).data.relationship, 'connected');
  assert.equal((await L.visit(page, { profileUrl: url('frank-f') })).data.relationship, 'follow_only');
  assert.equal((await L.visit(page, { profileUrl: url('nobody-x') })).result, 'not_found');
});

test('dry-run invite never clicks Connect', async () => {
  const r = await L.invite(page, { profileUrl: url('alice-a'), note: 'Hi Alice', dryRun: true });
  assert.equal(r.result, 'dry_run');
  assert.equal(fake.log.length, 0);
});

test('invite with a note, and through the More menu', async () => {
  const r = await L.invite(page, { profileUrl: url('alice-a'), note: 'Hi Alice, great to connect.\nCheers', dryRun: false });
  assert.equal(r.result, 'ok');
  assert.equal(r.detail, null);
  assert.deepEqual(fake.log.at(-1), { type: 'invite', slug: 'alice-a', text: 'Hi Alice, great to connect.\nCheers' });
  const b = await L.invite(page, { profileUrl: url('bob-b'), note: '', dryRun: false });
  assert.equal(b.result, 'ok');
  assert.equal(fake.people.get('bob-b').state, 'pending');
  assert.equal((await L.invite(page, { profileUrl: url('alice-a'), note: '', dryRun: false })).result, 'pending');
  assert.equal((await L.invite(page, { profileUrl: url('carol-c'), note: '', dryRun: false })).result, 'connected');
});

test('invite stops on email check and weekly limit', async () => {
  const d = await L.invite(page, { profileUrl: url('dan-d'), note: 'Hi', dryRun: false });
  assert.equal(d.result, 'skipped');
  assert.match(d.detail, /email/);
  assert.equal(fake.people.get('dan-d').state, 'none');
  const g = await L.invite(page, { profileUrl: url('gina-g'), note: '', dryRun: false });
  assert.equal(g.result, 'limit');
});

test('message: dry run, send, then detect a reply', async () => {
  const dry = await L.message(page, { profileUrl: url('carol-c'), name: 'Carol Chen', text: 'Hi Carol', dryRun: true });
  assert.equal(dry.result, 'dry_run');
  const sent = await L.message(page, { profileUrl: url('carol-c'), name: 'Carol Chen', text: 'Hi Carol,\nthanks for connecting!', dryRun: false });
  assert.equal(sent.result, 'ok');
  assert.equal(fake.log.at(-1).text, 'Hi Carol,\nthanks for connecting!');
  assert.equal((await L.message(page, { profileUrl: url('erin-e'), name: 'Erin Evans', text: 'x', dryRun: false })).result, 'not_connected');
  await fetch(`${process.env.LINKEDIN_BASE}/__reply/carol-c`, { method: 'POST' });
  const again = await L.message(page, { profileUrl: url('carol-c'), name: 'Carol Chen', text: 'Following up', dryRun: false });
  assert.equal(again.result, 'replied');
  assert.equal(fake.people.get('carol-c').thread.filter((m) => m.from === 'You').length, 1);
});

test('sync connections and inbox', async () => {
  const c = await L.syncConnections(page);
  assert.deepEqual(c.data.profiles, [url('carol-c')]);
  const i = await L.syncInbox(page);
  assert.deepEqual(i.data.conversations.map((x) => [x.name, x.lastFromMe]), [['Carol Chen', false]]);
});

test('withdraw a pending invitation', async () => {
  assert.equal((await L.withdraw(page, { profileUrl: url('bob-b'), dryRun: true })).result, 'dry_run');
  assert.equal((await L.withdraw(page, { profileUrl: url('bob-b'), dryRun: false })).result, 'ok');
  assert.equal(fake.people.get('bob-b').state, 'none');
  assert.equal((await L.withdraw(page, { profileUrl: url('bob-b'), dryRun: false })).result, 'not_pending');
});
