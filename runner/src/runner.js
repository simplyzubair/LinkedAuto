import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { classifyUrl, classifyText } from './session.js';

const API_URL = process.env.API_URL || 'http://app:3000';
const RUNNER_TOKEN = process.env.RUNNER_TOKEN;
const PROFILE_DIR = process.env.PROFILE_DIR || '/data/profile';
const HEARTBEAT_MS = 60_000;
const START_URL = process.env.START_URL || 'https://www.linkedin.com/feed/';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

let state = { session: 'unknown', detail: null, url: null };
let paused = true; // read by the action loop from phase 2 on; starts paused

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
  let session = classifyUrl(url);
  let detail = null;

  const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const warning = classifyText(text.slice(0, 20_000));
  if (warning) ({ state: session, detail } = warning);

  if (session === 'ok' || session === 'unknown') {
    const cookies = await context.cookies('https://www.linkedin.com');
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
    headless: false,
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

  for (;;) {
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
    inspecting = inspecting.then(() => inspect(page, context));
    await inspecting;
    await heartbeat();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
