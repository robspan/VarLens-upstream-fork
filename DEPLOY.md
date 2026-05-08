# DEPLOY.md — VarLens Concept Pilot

Operator runbook for bringing up the VarLens **Concept Pilot** on Hetzner
Cloud from a fresh clone. Audience: an IT operator who has never touched
this repo before.

The desktop Electron app is the rest of this repository. This document
covers only the **web variant** deployed by the IaC under `web-deploy/`.
For the desktop app, see the project [`README.md`](README.md).

## What this is

The Concept Pilot is a single-tenant, intranet-grade deployment of the
VarLens web variant for Charité Berlin. One Hetzner cpx32 server runs a
Compose stack (Caddy + VarLens + Uptime Kuma + Dozzle) behind TLS, with
restic backups to Hetzner Object Storage. Bring-up is one command:
`make pilot`. Expect ~5–7 minutes from cold to live.

## Prerequisites

**Local workstation** (macOS or Linux):

- `tofu` ≥ 1.7 (`brew install opentofu`)
- `ssh`, `rsync`, `make`, `python3`
- `git`

**Hetzner Cloud** account with a verified billing address.

**GitHub** account with `read:packages` access to
`ghcr.io/robspan/varlens-web` (the private VarLens image is pulled from
GHCR at stack-up).

## Credentials you'll need

Two layers, two files. Hetzner API + SSH pubkey go into Tofu (different
lifecycle). Everything else lives in `web-deploy/.env` so an operator
fills in **one file** instead of re-exporting shell vars per session.

| Credential                                    | Where to generate                                               | Scope / role         | Where it goes locally                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hetzner Cloud API token                       | Hetzner Console → Security → API Tokens                         | Read **& Write**     | `web-deploy/tofu/environments/pilot/terraform.tfvars`, key `hcloud_token`                                                                                                                                   |
| GitHub PAT (classic)                          | GitHub → Settings → Developer settings → Personal access tokens | `read:packages`      | `web-deploy/.env`, key `GHCR_TOKEN`                                                                                                                                                                         |
| Hetzner Object Storage S3 access key + secret | Hetzner Console → Security → S3 Credentials → Generate          | (single keypair)     | `web-deploy/.env`, keys `RESTIC_S3_ACCESS_KEY` / `RESTIC_S3_SECRET_KEY`. **Generated once per account** — Hetzner doesn't expose an API for this; everything downstream (bucket, restic repo) is automated. |
| VarLens admin username + password             | You choose. Strong password, ≥16 chars                          | First-boot bootstrap | `web-deploy/.env`, keys `VARLENS_ADMIN_USERNAME` / `_PASSWORD`                                                                                                                                              |

S3 credentials are **not** in tfvars on purpose — Tofu does not manage the
backup bucket, the `setup-backup` step does, via the S3 API.

Shell exports still work and override `web-deploy/.env` values, so CI /
one-off invocations don't need to write to disk.

### Optional `.env` overrides

Leave blank to inherit defaults. Useful for sibling deployments
(prod alongside dev) or restoring against a known password.

| Key                 | Default                                                       | When to set                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | auto-generated, persisted to `/etc/varlens/postgres-password` | Restoring from a backup that used a known password, or staging a value before bring-up. First-boot only.                                                                                                                                                    |
| `RESTIC_PASSWORD`   | auto-generated, SOPS-persisted on creation                    | Operator-controlled bucket password. Must match the prior value if the bucket already has snapshots — otherwise old snapshots become undecryptable.                                                                                                         |
| `BUCKET_NAME`       | `varlens-pilot-backup`                                        | Distinct bucket per instance (`varlens-prod-backup` / `varlens-dev-backup`), or sidestepping a Hetzner ghost-state bucket that won't delete.                                                                                                                |
| `APP_NAME`          | `varlens`                                                     | Distinct container/network name per instance. The Caddy upstream tracks this automatically.                                                                                                                                                                 |
| `APP_PATH_PREFIX`   | `/varlens`                                                    | URL prefix the app is mounted under. Note: the SPA bundle bakes `/varlens/` into its asset URLs at image-build time — separate-server prod/dev is fine, but co-located instances with distinct prefixes need a build-time templating story (not yet wired). |
| `APP_PORT`          | `8080`                                                        | Internal HTTP port the app listens on inside the container.                                                                                                                                                                                                 |

## First-time setup

The full path from "no Hetzner account" to "ready to run `make pilot`".
Browser tabs first (one-time per account), then terminal.

### A. In the browser (one-time per account)

1. **Create a Hetzner Cloud account** at https://accounts.hetzner.com
   and add a verified billing address.

2. **Hetzner Cloud API token** —
   Hetzner Console → Project → Security → API Tokens →
   _Generate API Token_. Permission: **Read & Write**. Copy the token;
   it's shown only at generation.

3. **Hetzner Object Storage S3 keypair** —
   Hetzner Console → Security → S3 Credentials → _Generate Credentials_.
   Copy both `access_key` and `secret_key` immediately; the secret is
   shown only at generation. (Hetzner does not expose an API for this
   step — see `setup-backup.py` for why.)

4. **GitHub Personal Access Token** —
   GitHub → Settings → Developer settings → Personal access tokens →
   _Tokens (classic)_ → _Generate new token (classic)_. Scope:
   `read:packages`. Copy the `ghp_...` token.

### B. In the terminal (per clone)

```bash
# 5. Clone and check out the web branch
git clone https://github.com/robspan/VarLens.git
cd VarLens
git checkout VarLens-Web

# 6. Generate the SSH key the pilot uses to reach the server
ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C varlens-tofu -N ""

# 7. Populate Tofu variables (uses the API token from step 2)
cp web-deploy/tofu/environments/pilot/terraform.tfvars.example \
   web-deploy/tofu/environments/pilot/terraform.tfvars
chmod 600 web-deploy/tofu/environments/pilot/terraform.tfvars
$EDITOR web-deploy/tofu/environments/pilot/terraform.tfvars
#   set hcloud_token = "<token from step 2>"
#   set ssh_pubkey   = contents of ~/.ssh/varlens-tofu.pub

# 8. Initialize Tofu providers (one-time per clone)
tofu -chdir=web-deploy/tofu/environments/pilot init

# 9. Populate operator secrets (uses tokens from steps 3 + 4)
cp web-deploy/.env.example web-deploy/.env
chmod 600 web-deploy/.env
$EDITOR web-deploy/.env
#   GHCR_TOKEN              = <PAT from step 4>
#   RESTIC_S3_ACCESS_KEY    = <access_key from step 3>
#   RESTIC_S3_SECRET_KEY    = <secret_key from step 3>
#   VARLENS_ADMIN_USERNAME  = admin (or what you prefer)
#   VARLENS_ADMIN_PASSWORD  = a strong password (≥16 chars)
```

The example tfvars file lists optional overrides
(`server_type`, `server_location`, `data_volume_size_gb`, …); leave
defaults unless told otherwise.

### Summary: what the operator does, end to end

1. Hetzner account + billing
2. Hetzner API token → tfvars
3. Hetzner S3 keypair → `web-deploy/.env`
4. GitHub PAT (read:packages) → `web-deploy/.env`
5. Local clone, ssh-keygen, tofu init, fill `web-deploy/.env`
6. `make pilot`

Steps 1–4 are once per Hetzner+GitHub account pair.
Step 5 is once per clone of the repo.
Step 6 is the bring-up itself, repeated per environment.

## The bring-up

From the repo root, after `web-deploy/.env` is populated:

```bash
make pilot
```

Web mode auto-enables as soon as `web-deploy/.env` exists — the same file you just filled in for the operator secrets is the signal that this checkout is operating the web pilot. If you ever need to override (force web mode without the file, e.g. in CI; or fall back to desktop mode while the file is present), set the env var explicitly: `VARLENS_WEB=1 make ...` or `VARLENS_WEB=0 make ...`. See [`AGENTS.md`](AGENTS.md) > Mode toggle for the design.

`pilot.sh` sources `web-deploy/.env` before any preflight check; shell
exports for the same vars override the file. If anything is missing
(tfvars placeholder, missing SSH key, `tofu` not on PATH, GHCR token
unreadable, S3 / admin creds blank) it warns or fails loudly with the
exact remedy before any Hetzner resource is touched.

After capturing the admin recovery key (the success banner walks you
through it), blank `VARLENS_ADMIN_PASSWORD` in `web-deploy/.env` so the
plaintext doesn't linger in `docker inspect` output.

## What to expect during the run

The orchestrator (`web-deploy/scripts/pilot.sh`) prints a banner and then
runs five numbered steps. Tofu's full plan dump is filtered by default to
keep the run-time output focused; you'll see one progress line per
resource plus the summary. Use `--verbose` (or `export VARLENS_VERBOSE=1`)
on `pilot up` / `pilot down` / `e2e run` to see the raw firehose for
debugging or audit-log capture.

1. **Provision Hetzner server** (cpx32 + 50 GB volume + IPv4) — ~3 min.
   You'll see Tofu creating server, volume, firewall, SSH key, attaching
   the volume, then waiting on cloud-init.
2. **Bring up Compose stack** (Caddy + Uptime Kuma + Dozzle + VarLens) —
   ~1 min. Includes `docker login ghcr.io` using `GHCR_TOKEN`, image
   pull, and `docker compose up -d`.
3. **Configure restic backup** (Hetzner Object Storage). Creates the
   bucket, generates a restic password, persists `/etc/restic/env`.
4. **Configure monitoring** (Uptime Kuma admin user + heartbeat push
   monitor).
5. **Smoke test** — 12 probes (SSH, HTTP→HTTPS redirect, welcome page,
   Kuma routes, `/varlens/healthz`, exposed-port closure, four running
   compose services).

Between steps 1 and 2 the orchestrator waits for SSH and `cloud-init
status --wait` — this is normal.

If a step fails, the banner prints the exact retry command (e.g.
`make -C web-deploy stack-up`) and a full-reset hint
(`make pilot-down && make pilot`). Underlying errors are not swallowed.

**Resumability.** `make pilot` is safe to interrupt and re-run. Ctrl+C
during any step prints a "Local state is safe" message and exits without
partial cleanup. A subsequent `make pilot` detects the existing tofu state,
prints a "resuming partial bring-up" banner, and re-executes every step —
each one is idempotent (tofu reports "0 to add, 0 to change", docker pull
is a no-op for images already present, setup-backup reuses the bucket
under `--default-reuse-when-resumable`, setup-monitoring skips an admin
that already exists, smoke is read-only). A killed `tofu apply` leaves
a state lock that the next `make pilot` auto-releases on entry.

## After the run

The success banner prints four URLs. Replace `<ip>` with the IPv4 shown
(or `make pilot-status` / `make -C web-deploy ip`).

| URL                            | What                                    |
| ------------------------------ | --------------------------------------- |
| `https://<ip>/welcome`         | Operator landing page                   |
| `https://<ip>/varlens/healthz` | VarLens app health probe                |
| `https://<ip>/`                | Uptime Kuma (redirects to `/dashboard`) |
| `https://<ip>/logs/`           | Dozzle (container logs, basic auth)     |

Default Kuma / Dozzle credentials: **admin / varlens-konzept**. Change
both before handing the URL to anyone outside operations.

The first cert is from Let's Encrypt's short-lived (7-day) IP profile —
browsers trust it. To switch to a domain certificate, point a DNS A
record at the IP, then re-run with `make -C web-deploy stack-up
DOMAIN=foo.example.org`.

### Admin bootstrap (2026-security)

Hash-preferred. Generate a hash locally with the same Argon2id params
the server uses, paste it into `web-deploy/.env`, never put plaintext
on disk:

```bash
npm run varlens:hash-password   # prompts; prints the hash
```

Then in `web-deploy/.env`:

```
VARLENS_ADMIN_USERNAME=admin
VARLENS_ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$...
VARLENS_ADMIN_PASSWORD=          # leave blank
VARLENS_ADMIN_DISPLAY_NAME=Admin
```

The bootstrapped admin row is flagged `must_change_password=TRUE`.
On first login the standalone login page swaps to a "set new
password" form (min 12 chars, must differ from current); the server
refuses every other API endpoint with 403 until the rotation
commits. Net effect: the bootstrap credential has zero exposure
window — even with a valid session cookie, no application surface
is reachable until the user picks a new password.

**Plaintext** (`VARLENS_ADMIN_PASSWORD=...`) is kept for one
migration release with a hard-deprecation log on every boot. Use
the hash variant; the plaintext path will be removed.

### Operator commands

Run from the repo root:

```bash
make pilot-status   # is the server up? running / stopped / absent
make pilot-smoke    # re-run the 12-probe smoke test
make pilot-ssh      # SSH as deploy user
make pilot-down     # tear everything down (interactive confirmation)
```

## Day-2 operations

All targets below run from `web-deploy/` (`make -C web-deploy ...` from
the repo root works equivalently).

**Backup verification** — automated drill that takes a marker, snapshots,
restores into a scratch dir, asserts marker presence:

```bash
make -C web-deploy restore-drill
```

**Ship a new VarLens version (preferred — automated end-to-end)**:

```bash
make web-release VERSION=web-v0.x.y NOTES_FROM=auto
```

Web releases use the **`web-vX.Y.Z`** tag prefix to stay disjoint
from the desktop installer track (which owns bare `vX.Y.Z`). Cuts a
GitHub Release with that tag; only the
[`release-web.yml`](.github/workflows/release-web.yml) workflow
fires. It builds the versioned image, pushes to GHCR, SSHes into
the pilot, pins `VARLENS_IMAGE` in the server's `.env`, recreates
**only the app container** (Caddy/Postgres/Kuma stay up — no LE
rate-limit churn, no DB bounce), and runs the smoke suite. A red
smoke fails the release page. `make pilot` already uploads the
required repo secrets on first bring-up; re-upload manually with
`make web-release-enable`. Full reference:
[`web-deploy/docs/releases.md`](web-deploy/docs/releases.md).

Roll back to a previous version (no rebuild):

```bash
gh workflow run release-web.yml -f version=web-v0.x.y -f skip_build=true
```

**Pull a new image manually (escape hatch)** — for the rare cases
where you need to deploy without going through GitHub Releases (CI
outage, tracking `:edge` for testing, manually pinning a digest).
Bump `VARLENS_IMAGE` in `web-deploy/compose/.env.example` (or set on
the server in `/mnt/data/app/.env`), then:

```bash
make -C web-deploy stack-up
```

`stack-up` runs `docker compose pull` followed by `up -d`. Caddy is
force-recreated so cert state is reloaded; the rest are recreated only
if their image or config changed.

**Stop / start without losing data** (volume + IPv4 are preserved):

```bash
make -C web-deploy stop      # power off; saves server hours
make -C web-deploy start     # power on
```

**Rotate Hetzner API token** — generate a new one in the Console, swap
`hcloud_token` in `tofu/environments/pilot/terraform.tfvars`, revoke the
old one. No re-apply needed; Tofu reads the value on next invocation.

**Rotate GHCR PAT** — re-export `GHCR_TOKEN` and run
`make -C web-deploy stack-up`. The new token is piped via stdin to
`docker login`, never written to disk on the server.

**Rotate S3 credentials** — generate a new pair in the Console, export
both env vars, then `make -C web-deploy setup-backup
SETUP_BACKUP_ARGS=--reuse` to refresh `/etc/restic/env` without touching
existing snapshots.

**Edit encrypted secrets** (SOPS+age):

```bash
make -C web-deploy sops-edit FILE=secrets/<file>.yaml
```

For deeper procedures (image-update workflow, scenario-by-scenario
incident recovery, database notes) see:

- [`web-deploy/README.md`](web-deploy/README.md) — quickstart and layout
- [`web-deploy/docs/operations.md`](web-deploy/docs/operations.md) —
  command-by-command operations reference
- [`web-deploy/docs/runbook.md`](web-deploy/docs/runbook.md) — day-to-day
  operations (Quick Reference, danger table)
- [`web-deploy/docs/incident-runbook.md`](web-deploy/docs/incident-runbook.md) —
  13 incident scenarios (image updates, restore, rollback, server recovery)
- [`web-deploy/docs/smoke-remediation.md`](web-deploy/docs/smoke-remediation.md) —
  per-check failure causes and fixes for the 13-probe smoke gate
- [`web-deploy/docs/backup.md`](web-deploy/docs/backup.md)
- [`web-deploy/docs/sops.md`](web-deploy/docs/sops.md)

## When something goes wrong

**Smoke probe fails.** The smoke output names the failing probe (e.g.
`FAIL VarLens /varlens/healthz expected 200, got 502`). For the per-check
diagnosis + remedy, see
[`web-deploy/docs/smoke-remediation.md`](web-deploy/docs/smoke-remediation.md).
Quick triage:

```bash
make pilot-status                              # is the server even running?
make pilot-ssh                                 # then on the server:
  cd /mnt/data/app && docker compose ps        # are all 4 services up?
  docker compose logs --tail=200 <service>     # service-specific logs
```

The Dozzle web UI at `https://<ip>/logs/` (admin / varlens-konzept) shows
the same logs without leaving your browser.

**Pilot run aborts during a step.** The banner prints the exact retry
command. Re-running an idempotent step (`stack-up`, `setup-backup
SETUP_BACKUP_ARGS=--reuse`, `setup-monitoring`, `smoke`) is safe.

**SSH host-key mismatch after a re-provision.** Hetzner sometimes hands
back an IPv4 you've used before. The orchestrator clears it via
`ssh-keygen -R <ip>` automatically; for manual SSH outside the
orchestrator, run that command yourself.

**Stack-up fails on `docker login`.** `GHCR_TOKEN` is wrong, expired, or
missing the `read:packages` scope. Regenerate, re-export, retry.

**TLS handshake fails on a recycled IP / smoke probes return `000`.** Caddy
hit the Let's Encrypt rate limit (5 certs per IP per 168h) — typical when
recycling an IP across teardown/bring-up cycles. Drop to self-signed for
the duration:

```bash
make -C web-deploy stack-up TLS=internal
```

Browsers will show a one-time cert warning. Re-run `stack-up` without
`TLS=internal` once the rate window resets (the Caddy log line names the
exact retry-after timestamp).

**Bucket teardown reports `BucketNotEmpty` on an empty bucket.** Hetzner's
async-reconciliation ghost state. Either wait 5–10 min and retry, or
sidestep it for the next bring-up by setting
`BUCKET_NAME=varlens-pilot-backup-v2` in `web-deploy/.env`. Clean the old
bucket via the Hetzner Console when convenient.

**`cloud-init` failed.** Inspect the bootstrap log on the server:

```bash
make -C web-deploy logs       # tails /var/log/cloud-init-output.log
```

For deeper scenario-driven recovery, see
[`web-deploy/docs/incident-runbook.md`](web-deploy/docs/incident-runbook.md).

## Recovery — restoring a server from backup

The backup story is the actual fallback we tell people: if everything
goes wrong, the restic snapshots in Hetzner Object Storage can rebuild
a working deployment. Two flows:

**Inspect what's in the bucket** (read-only, needs `RESTIC_S3_*` env +
local SOPS):

```bash
make pilot-restore-list
```

Lists every snapshot with timestamp, hostname, size. Use this to confirm
backups exist before deciding to recover.

**Recover onto a fresh server** (provisions + restores end-to-end):

```bash
make pilot-recover
```

This:

1. Pre-flights and verifies a restic repository exists in the bucket.
2. Provisions a new Hetzner cpx32 (same as `make pilot`).
3. Stages `/etc/restic/env` on the new server (decrypts the password
   from `secrets/restic.yaml` via SOPS).
4. `restic restore latest --target /` — pulls `/mnt/data` back from
   the most recent snapshot.
5. Brings up the Compose stack against the restored data.
6. `pg_restore` the embedded `varlens-<ts>.dump` into a fresh
   PostgreSQL container (the dump is the consistent recovery point;
   raw PGDATA is excluded from snapshots on purpose).
7. Smoke test + parity check (compares restored table set against the
   dump's manifest).

End state: a new server functionally equivalent to the old one, minus
any writes that happened after the most recent backup ran (i.e. since
the last `restic-backup.service` run — at most 24h on the default
nightly timer).

**Safety guard.** `make pilot` refuses to provision a fresh server when
the bucket already contains a restic repository. You'll see:

> ⚠ EXISTING BACKUPS DETECTED — fresh provision blocked

with four explicit options: recover, list, deliberately discard
(separate command), or override (`VARLENS_IGNORE_EXISTING_BACKUPS=1
make pilot`). Without this, an operator who tore down their last
server and absent-mindedly re-ran `make pilot` would get a fresh
empty server with no offer of recovery — and might do real writes
against the empty database before realising prior data was reachable.

## Tearing down

```bash
make pilot-down
```

Interactive — requires literally typing `pilot` to confirm. Destroys the
cpx32, the 50 GB volume (and all data on it), and the IPv4 reservation.
**Restic snapshots in Hetzner Object Storage survive** — restore them
with `make -C web-deploy restore-drill` against a fresh server, or
`web-deploy/scripts/restore.sh`.

For a full clean (including the backup bucket), after `make pilot-down`:

```bash
cd web-deploy
RESTIC_S3_ACCESS_KEY=... RESTIC_S3_SECRET_KEY=... \
  python3 scripts/teardown-bucket.py
```

This empties and deletes the restic bucket. The bucket is not Tofu-
managed, which is why teardown is a separate step.

## Cost

From `web-deploy/Makefile` `help`:

| Resource     | Cost            | When                                   |
| ------------ | --------------- | -------------------------------------- |
| cpx32 server | ~0.02 EUR/hour  | only while running; 0 EUR when stopped |
| 50 GB volume | ~2 EUR/month    | fixed, also when the server is stopped |
| IPv4 address | ~0.60 EUR/month | fixed                                  |

`make -C web-deploy stop` saves the server hours but keeps volume + IP
billed. Full cost savings only via `make pilot-down`.
