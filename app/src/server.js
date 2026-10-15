import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { timingSafeEqual } from 'node:crypto';
import { sql, migrate, getSetting, setSetting, logEvent } from './db.js';
import { dashboardPage } from './views.js';

const RUNNER_TOKEN = process.env.RUNNER_TOKEN;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const SESSION_STATES = new Set(['ok', 'logged_out', 'checkpoint', 'restricted', 'browser_closed', 'unknown']);
const STOP_STATES = new Set(['logged_out', 'checkpoint', 'restricted']);

if (!RUNNER_TOKEN || RUNNER_TOKEN.length < 24) {
  console.error('RUNNER_TOKEN must be set to a random string of at least 24 characters');
  process.exit(1);
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });
await app.register(formbody);

// Runner API: bearer token shared with the runner container.
app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/runner/')) {
    const auth = req.headers.authorization || '';
    if (!safeEqual(auth, `Bearer ${RUNNER_TOKEN}`)) return reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  if (req.url === '/healthz') return;
  // Dashboard: Cloudflare Access guards it from the internet; this optional
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
    await logEvent('safety', 'auto-paused', `LinkedIn session is ${state}${detail ? `: ${detail}` : ''}`);
  }
  return { paused: await getSetting('paused') };
});

app.post('/api/runner/event', async (req) => {
  const { kind, detail = null } = req.body || {};
  if (typeof kind !== 'string' || !kind) return { ok: false };
  await logEvent('runner', kind.slice(0, 64), detail ? String(detail).slice(0, 2000) : null);
  return { ok: true };
});

app.get('/', async (req, reply) => {
  const [status] = await sql`SELECT * FROM runner_status WHERE id = 1`;
  const events = await sql`SELECT * FROM events ORDER BY at DESC LIMIT 30`;
  const paused = await getSetting('paused');
  reply.type('text/html').send(dashboardPage({ status, events, paused, novncUrl: process.env.NOVNC_PUBLIC_URL || '' }));
});

app.post('/pause', async (req, reply) => {
  await setSetting('paused', true);
  await logEvent('dashboard', 'paused');
  reply.redirect('/');
});

app.post('/resume', async (req, reply) => {
  await setSetting('paused', false);
  await logEvent('dashboard', 'resumed');
  reply.redirect('/');
});

await migrate();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
