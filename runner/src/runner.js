import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { classifyUrl, classifyText } from './session.js';
import { ACTIONS } from './linkedin.js';

const API_URL = process.env.API_URL || 'http://app:3000';
const RUNNER_TOKEN = process.env.RUNNER_TOKEN;
const PROFILE_DIR = process.env.PROFILE_DIR || '/data/profile';
const LOOP_SPEED = Number(process.env.LOOP_SPEED || 1); // tests set this low
const HEARTBEAT_MS = 60_000 * LOOP_SPEED;
const BASE = (process.env.LINKEDIN_BASE || 'https://www.linkedin.com').replace(/\/$/, '');
const START_URL = process.env.START_URL || `${BASE}/feed/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * LOOP_SPEED));
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

let state = { session: 'unknown', detail: null, url: null };
let paused = true;

async function api(path, body) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${RUNNER_TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`api ${path} failed: ${err.message}`);
    return null;
  }
}

async function heartbeat() {
  const res = await api('/api/runner/heartbeat', { ...state, version: VERSION });
  if (res && typeof res.paused === 'boolean') paused = res.paused;
}

// Reads the page that is open right now and reports any change at once.
async function inspect(page, context) {
  const url = page.url();
  let session = classifyUrl(url, new URL(BASE).host);
  let detail = null;

  const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const warning = classifyText(text.slice(0, 20_000));
  if (warning) ({ state: session, detail } = warning);

  if (session === 'ok' || session === 'unknown') {
    const cookies = await context.cookies(BASE);
    if (!cookies.some((c) => c.name === 'li_at')) {
      session = 'logged_out';
      detail = 'No LinkedIn login cookie';
    }
  }

  const changed = session !== state.session || detail !== state.detail;
  state = { session, detail, url };
  if (changed) {
    console.log(`session: ${session}${detail ? ` (${detail})` : ''}`);
    await heartbeat();
  }
}

async function main() {
  if (!RUNNER_TOKEN) throw new Error('RUNNER_TOKEN is not set');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    executablePath: process.env.CHROME_PATH || undefined, // for local testing only
    headless: process.env.HEADLESS === '1', // tests only; on the NAS Chrome runs headed under Xvfb
    viewport: null,
    locale: process.env.BROWSER_LOCALE || 'en-US',
    timezoneId: process.env.TZ || 'Asia/Karachi',
    // Behave like a normal Chrome window: no "controlled by automated software" bar.
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  context.on('close', async () => {
    state = { session: 'browser_closed', detail: null, url: null };
    await heartbeat();
    process.exit(1); // Docker restarts the container and the browser with it.
  });

  const page = context.pages()[0] || (await context.newPage());
  let inspecting = Promise.resolve();
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    inspecting = inspecting.then(() => page.waitForLoadState('domcontentloaded').catch(() => {})).then(() => inspect(page, context));
  });

  await api('/api/runner/event', { kind: 'runner:started', detail: `v${VERSION}` });

  // One visit at start-up to learn the session state. After this the runner
  // only reads whatever page is open, so it adds no LinkedIn traffic of its own.
  if (!page.url().includes('linkedin.com')) {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch((e) => console.error(e.message));
  }
  await inspect(page, context);

  setInterval(() => {
    inspecting = inspecting.then(() => inspect(page, context)).then(heartbeat).catch((e) => console.error(e.message));
  }, HEARTBEAT_MS);

  // Work loop: ask the dashboard what to do next; it applies every safety rule
  // and answers with either one action or how long to wait.
  for (;;) {
    await inspecting;
    if (paused || state.session !== 'ok') {
      await sleep(30_000);
      continue;
    }
    const plan = await api('/api/runner/next', {});
    if (!plan || plan.wait) {
      await sleep(Math.min(plan?.wait ?? 60, 60) * 1000);
      continue;
    }
    const { id, type, payload } = plan.action;
    const run = ACTIONS[type];
    let outcome;
    if (!run) outcome = { result: 'not_started', detail: `Unknown action ${type}` };
    else {
      console.log(`action ${id}: ${type}${payload.dryRun ? ' (dry run)' : ''}`);
      try {
        outcome = await run(page, payload);
      } catch (err) {
        outcome = { result: 'failed', detail: err.message.split('\n')[0].slice(0, 300) };
      }
    }
    console.log(`action ${id}: ${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    await api('/api/runner/result', { id, ...outcome });
    inspecting = inspecting.then(() => inspect(page, context));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
