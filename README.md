# LinkedAuto

A private LinkedIn outreach tool for one person's own leads. It runs at home on a Synology NAS, so LinkedIn always sees your home IP, and it puts safety first: it starts paused, and any logout, security check or restriction notice pauses everything until you resume it by hand.

Research and build plan: https://claude.ai/code/artifact/03bc7a9e-b4a6-46a7-a702-4ec1e7ac5757

## What's here (phase 0)

| Part | What it does |
| --- | --- |
| `app/` | Dashboard and API (Node, Fastify, Postgres). Shows whether the runner is online, the LinkedIn session state, a pause switch and an activity log. |
| `runner/` | A real Google Chrome in a virtual screen, driven by Playwright with a persistent profile. You see and use it through noVNC to log in by hand. It reads whatever page is open and reports the session state; it only visits LinkedIn once, at start-up. |
| `docker-compose.yml` | Postgres, app, runner, nightly backups, and an optional Cloudflare Tunnel. |

Outreach (visits, invites, messages) comes in later phases. Nothing in phase 0 acts on LinkedIn by itself.

## Set up on the NAS (DS723+)

1. **Check memory.** The DS723+ ships with 2 GB; Chrome alone is capped at 1.5 GB here, so 8 GB or more is strongly recommended.

   ```sh
   ssh nas 'uname -m; free -m'
   ```

2. **Install Container Manager** from Package Center (DSM 7.2 or later).

3. **Get the code** into the project folder. The NAS layout is:

   ```
   /volume1/docker/linkedauto/
     app/              this repo
     db/               Postgres data
     browser-profile/  Chrome profile (your LinkedIn login lives here)
     config/           non-secret settings (linkedauto.env)
     backups/          nightly database dumps, 14 days kept; sync this off-site
   ```

   ```sh
   ssh nas            # or ssh nas-ts over Tailscale
   cd /volume1/docker/linkedauto
   git clone https://github.com/simplyzubair/LinkedAuto.git app   # needs the Git package; or upload a ZIP from GitHub
   sudo chown -R 1000:1000 browser-profile   # the runner runs as uid 1000
   ```

4. **Settings and secrets.** Put the non-secret settings in `config/linkedauto.env`:

   ```sh
   grep -E '^(TZ|BROWSER_LOCALE|DASHBOARD_PORT|NOVNC_PORT|NOVNC_PUBLIC_URL|DB_DIR|BROWSER_PROFILE_DIR|BACKUP_DIR)=' app/.env.example > config/linkedauto.env
   ```

   Keep these secrets in Infisical (generate each with `openssl rand -hex 24`; VNC uses only the first 8 characters of its password): `POSTGRES_PASSWORD`, `RUNNER_TOKEN`, `VNC_PASSWORD`, and optionally `DASHBOARD_PASSWORD` and `CF_TUNNEL_TOKEN`.

5. **Start it.** The first build downloads Chrome and takes several minutes.

   ```sh
   cd /volume1/docker/linkedauto/app
   infisical run -- sudo -E docker compose --env-file ../config/linkedauto.env up -d --build
   sudo docker compose ps
   ```

   Without Infisical, copy `.env.example` to `.env`, fill in the secrets there, and run `sudo docker compose up -d --build`. Older DSM builds use `docker-compose` instead of `docker compose`.

6. **Log in to LinkedIn by hand.** Open `http://<nas-ip>:6080/vnc.html`, click Connect, enter the VNC password, and log in to LinkedIn in the Chrome window, including any 2-step code. LinkedIn may email you about a new sign-in; that is expected once.

7. **Open the dashboard** at `http://<nas-ip>:3080`. Within a minute it should show the runner online and "Logged in to LinkedIn". Automation stays paused.

## Reach it from outside home (optional)

Use a Cloudflare Tunnel so no ports are opened on your router.

1. In Cloudflare Zero Trust, create a tunnel and store its token as `CF_TUNNEL_TOKEN` in Infisical (or `.env`).
2. Add two public hostnames on the tunnel: `linkedauto.<your-domain>` to `http://app:3000`, and `browser.<your-domain>` to `http://runner:6080`.
3. Add a Cloudflare Access application covering both hostnames that allows only your email.
4. Set `NOVNC_PUBLIC_URL=https://browser.<your-domain>/vnc.html` in `config/linkedauto.env`, then:

   ```sh
   infisical run -- sudo -E docker compose --env-file ../config/linkedauto.env --profile tunnel up -d
   ```

## Safety rules built in

- Starts paused. Only you resume it, from the dashboard.
- Logged out, a security check, or a restriction notice pauses everything and logs why.
- One account, one browser profile, your home IP. No proxies, no captcha solving.
- See the research doc for the limits and pacing the later phases will follow.

## Develop

```sh
cd runner && npm install && npm test    # session-state tests
```

`START_URL` and `CHROME_PATH` on the runner exist for local testing only.
