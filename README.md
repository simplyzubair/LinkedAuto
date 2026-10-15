# LinkedAuto

A private LinkedIn outreach tool for one person's own leads. It runs at home on a Synology NAS, so LinkedIn always sees your home IP, and it puts safety first: it starts paused, and any logout, security check or restriction notice pauses everything until you resume it by hand.

Research and build plan: https://claude.ai/code/artifact/03bc7a9e-b4a6-46a7-a702-4ec1e7ac5757

## What's here (phase 0)

| Part | What it does |
| --- | --- |
| `app/` | Dashboard and API (Node, Fastify, Postgres). Shows whether the runner is online, the LinkedIn session state, a pause switch and an activity log. |
| `runner/` | A real Google Chrome in a virtual screen, driven by Playwright with a persistent profile. You see and use it through noVNC to log in by hand. It reads whatever page is open and reports the session state; it only visits LinkedIn once, at start-up. |
| `docker-compose.yml` | Postgres, app, runner, and an optional Cloudflare Tunnel. |

Outreach (visits, invites, messages) comes in later phases. Nothing in phase 0 acts on LinkedIn by itself.

## Set up on the NAS (DS723+)

1. **Check memory.** The DS723+ ships with 2 GB; Chrome alone is capped at 1.5 GB here, so 8 GB or more is strongly recommended.

   ```sh
   ssh nas 'uname -m; free -m'
   ```

2. **Install Container Manager** from Package Center (DSM 7.2 or later).

3. **Get the code** onto the NAS, for example into `/volume1/docker/linkedauto`:

   ```sh
   ssh nas
   cd /volume1/docker
   git clone https://github.com/simplyzubair/LinkedAuto.git linkedauto   # needs the Git package; or upload a ZIP from GitHub
   cd linkedauto
   ```

4. **Create `.env`** from the example and fill in the secrets:

   ```sh
   cp .env.example .env
   for v in POSTGRES_PASSWORD RUNNER_TOKEN; do sed -i "s|^$v=.*|$v=$(openssl rand -hex 24)|" .env; done
   sed -i "s|^VNC_PASSWORD=.*|VNC_PASSWORD=$(openssl rand -hex 4)|" .env
   cat .env   # note the VNC_PASSWORD
   ```

5. **Start it.** The first build downloads Chrome and takes several minutes.

   ```sh
   sudo docker compose up -d --build
   sudo docker compose ps
   ```

   (Older DSM builds use `docker-compose` instead of `docker compose`. You can also create the project in Container Manager > Project, pointing at this folder.)

6. **Log in to LinkedIn by hand.** Open `http://<nas-ip>:6080/vnc.html`, click Connect, enter the VNC password, and log in to LinkedIn in the Chrome window, including any 2-step code. LinkedIn may email you about a new sign-in; that is expected once.

7. **Open the dashboard** at `http://<nas-ip>:3080`. Within a minute it should show the runner online and "Logged in to LinkedIn". Automation stays paused.

## Reach it from outside home (optional)

Use a Cloudflare Tunnel so no ports are opened on your router.

1. In Cloudflare Zero Trust, create a tunnel and copy its token into `CF_TUNNEL_TOKEN` in `.env`.
2. Add two public hostnames on the tunnel: `linkedauto.<your-domain>` to `http://app:3000`, and `browser.<your-domain>` to `http://runner:6080`.
3. Add a Cloudflare Access application covering both hostnames that allows only your email.
4. Set `NOVNC_PUBLIC_URL=https://browser.<your-domain>/vnc.html` in `.env`, then:

   ```sh
   sudo docker compose --profile tunnel up -d
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
