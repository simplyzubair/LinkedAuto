# LinkedAuto

A private LinkedIn outreach tool for one person's own leads. It runs at home on a Synology NAS, so LinkedIn always sees your home IP, and it puts safety first: it starts paused, and any logout, security check or restriction notice pauses everything until you resume it by hand.

Quick start guide for first-time users: [docs/LinkedAuto-Quick-Start-Guide.pdf](docs/LinkedAuto-Quick-Start-Guide.pdf)

Research and build plan: https://claude.ai/code/artifact/03bc7a9e-b4a6-46a7-a702-4ec1e7ac5757

## What it does

| Stage | What happens |
| --- | --- |
| Leads | Paste a LinkedIn people-search URL (read one page per action) or import a CSV of profile URLs. Duplicates are skipped across all campaigns. |
| Campaign | Visit the profile, invite a few hours later with an optional note, send the first message once they accept, then up to three follow-ups N days apart. |
| Stop rules | The sequence stops the moment a lead replies (checked in the inbox and in the thread before every follow-up). Invitations still pending after 21 days are withdrawn. |
| Templates | `{{firstName}}`, `{{company|your team}}` and friends; put `---` between versions to A/B test notes and first messages. |
| Dashboard | Home with a get-started checklist, status, limits and a results funnel; leads with stage filters, per-lead history and CSV export; a campaign editor with live previews and A/B results; the browser view built in; settings; a log of every action; and a How it works page. |

| Part | Tech |
| --- | --- |
| `app/` | Dashboard, API and the safety governor (Node, Fastify, Postgres). |
| `runner/` | A real Google Chrome in a virtual screen, driven by Playwright with your persistent profile; you watch and log in through noVNC. |
| `docker-compose.yml` | Postgres, app, runner, nightly backups, optional Cloudflare Tunnel. |

## Safety rules built in

- **Starts paused and in dry run** (called practice mode in the dashboard). Dry run goes through every step but never presses Connect, Send or Withdraw.
- **Limits** (defaults, editable): 80 invitations a week, 15 a day, 25 messages a day, 80 LinkedIn page views a day.
- **Warm-up:** 30%, 50%, 75%, then 100% of those limits over four weeks from the first resume.
- **Adaptive:** acceptance under 30% cuts volume by 20%, under 20% by 40% (once 20 invitations have settled).
- **LinkedIn's weekly limit message:** invitations stop for 7 days and caps drop by 20% each time.
- **Hard stop:** logged out, a security check or a restriction notice pauses everything; you resume by hand.
- **Human pacing:** weekdays 09:30 to 17:30 with a lunch break, 45 to 150 seconds between actions, an 8 to 20 minute break after 5 actions in 30 minutes, mouse movement and typing at human speed.
- One account, one browser profile, your home IP. No proxies, no captcha solving.

## Set up on the NAS (DS723+)

1. **Check memory.** The DS723+ ships with 2 GB; Chrome alone is capped at 1.5 GB here, so 8 GB or more is strongly recommended (ours has 32 GB).

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

   The DS723+ has no git or SFTP, so download the code as a tarball (use `main`, or a branch name):

   ```sh
   ssh nas            # or ssh nas-ts over Tailscale
   cd /volume1/docker/linkedauto
   mkdir -p app && curl -sL https://codeload.github.com/simplyzubair/LinkedAuto/tar.gz/refs/heads/main | tar xz --strip-components=1 -C app
   ```

   To update later, run the same `curl` line again, then rebuild (step 5).

4. **Settings and secrets.** Put the non-secret settings in `config/linkedauto.env`:

   ```sh
   grep -E '^(TZ|BROWSER_LOCALE|DASHBOARD_PORT|NOVNC_PORT|NOVNC_PUBLIC_URL|DB_DIR|BROWSER_PROFILE_DIR|BACKUP_DIR)=' app/.env.example > config/linkedauto.env
   ```

   Keep these secrets in Infisical (generate each with `openssl rand -hex 24`; VNC uses only the first 8 characters of its password): `POSTGRES_PASSWORD`, `RUNNER_TOKEN`, `VNC_PASSWORD`, and optionally `DASHBOARD_PASSWORD` and `CF_TUNNEL_TOKEN`.

5. **Start it.** The first build downloads Chrome and can take 20 minutes or more on the NAS.

   ```sh
   cd /volume1/docker/linkedauto/app
   docker compose --env-file ../config/linkedauto.env --env-file ../config/secrets.env up -d --build
   docker compose ps
   ```

   `config/secrets.env` holds the secrets exported from Infisical (the NAS has no Infisical CLI): export the `prod` environment of the "linkedauto" project as a dotenv file, save it there, and run `chmod 600 ../config/secrets.env`. If the Infisical CLI is installed, `infisical run -- docker compose --env-file ../config/linkedauto.env up -d --build` works instead. Prefix commands with `sudo` only if your user is not in the `docker` group. Older DSM builds use `docker-compose` instead of `docker compose`.

6. **Log in to LinkedIn by hand.** Open `http://<nas-ip>:6080/vnc.html`, click Connect, enter the VNC password, and log in to LinkedIn in the Chrome window, including any 2-step code. LinkedIn may email you about a new sign-in; that is expected once.

7. **Open the dashboard** at `http://<nas-ip>:3080`. If `DASHBOARD_PASSWORD` is set, the browser asks for a login: any username works with that password. Within a minute it should show the runner online and LinkedIn logged in. Automation stays paused. The **Browser view** page shows the Chrome window from step 6 inside the dashboard; it uses the address you opened the dashboard on with port `NOVNC_PORT`, unless `NOVNC_PUBLIC_URL` is set.

## First run

The Home page walks you through these as a checklist.

1. **Campaigns > New campaign.** Write the invitation note, first message and follow-ups; previews update as you type and show the length and how fields fill in. Turn the campaign on.
2. **Leads > Add leads.** Paste a LinkedIn search URL and pick the campaign, or import a CSV.
3. **Start** on Home with practice mode still on. Open the browser view and watch a few actions; the Activity log shows what each one would have sent.
4. When it looks right, turn off **Practice mode** in Settings. Real sending starts at the warm-up level.

Optional: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (in Infisical) to get a message on replies, auto-pauses, LinkedIn's limit and the runner going offline.

## Reach it from outside home (optional)

Use a Cloudflare Tunnel so no ports are opened on your router.

1. In Cloudflare Zero Trust, create a tunnel and store its token as `CF_TUNNEL_TOKEN` in Infisical (or `.env`).
2. Add two public hostnames on the tunnel: `linkedauto.<your-domain>` to `http://app:3000`, and `browser.<your-domain>` to `http://runner:6080`.
3. Add a Cloudflare Access application covering both hostnames that allows only your email.
4. Set `NOVNC_PUBLIC_URL=https://browser.<your-domain>/vnc.html` in `config/linkedauto.env`, then:

   ```sh
   docker compose --env-file ../config/linkedauto.env --env-file ../config/secrets.env --profile tunnel up -d
   ```

## Develop and test

```sh
cd app && npm install && npm test        # governor, templates, CSV
cd runner && npm install && npm test     # every LinkedIn action against a fake LinkedIn site
cd app && TEST_DATABASE_URL=postgres://.../throwaway CHROME_PATH=... npm run e2e
```

The end-to-end test runs the real app, runner and browser against the fake site, fast-forwarding time in the database: import, visit, invite with notes, acceptance, messages, follow-ups, stop on reply, withdrawal, the email-gated invite, LinkedIn's weekly limit, and the security-check pause.

The fake site copies the parts of LinkedIn's pages the runner relies on (button labels, dialogs, message thread classes). LinkedIn changes its pages, so the first real run should be in dry run with you watching. `START_URL`, `CHROME_PATH`, `LINKEDIN_BASE`, `HEADLESS`, `HUMAN_SPEED` and `LOOP_SPEED` exist for testing only.
