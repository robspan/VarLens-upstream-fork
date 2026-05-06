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

## Three credentials you'll need

| Credential | Where to generate | Scope / role | Where it goes locally |
|---|---|---|---|
| Hetzner Cloud API token | Hetzner Console → Security → API Tokens | Read **& Write** | `web-deploy/tofu/environments/pilot/terraform.tfvars`, key `hcloud_token` |
| Hetzner Object Storage S3 access key + secret | Hetzner Console → Security → S3 Credentials | (single keypair) | exported as `RESTIC_S3_ACCESS_KEY` and `RESTIC_S3_SECRET_KEY` in your shell |
| GitHub PAT (classic) | GitHub → Settings → Developer settings → Personal access tokens | `read:packages` | exported as `GHCR_TOKEN` in your shell |

S3 credentials are **not** in tfvars on purpose — Tofu does not manage the
backup bucket, the `setup-backup` step does, via the S3 API.

## First-time setup

```bash
# 1. Clone and check out the web branch
git clone https://github.com/robspan/VarLens.git
cd VarLens
git checkout VarLens-Web

# 2. Generate the SSH key the pilot uses to reach the server
ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C varlens-tofu -N ""

# 3. Populate Tofu variables
cp web-deploy/tofu/environments/pilot/terraform.tfvars.example \
   web-deploy/tofu/environments/pilot/terraform.tfvars
chmod 600 web-deploy/tofu/environments/pilot/terraform.tfvars
$EDITOR web-deploy/tofu/environments/pilot/terraform.tfvars
#   set hcloud_token = "..."
#   set ssh_pubkey   = "ssh-ed25519 AAAA... varlens-tofu"
#   (the pubkey is the contents of ~/.ssh/varlens-tofu.pub)

# 4. Initialize Tofu providers (one-time per clone)
tofu -chdir=web-deploy/tofu/environments/pilot init
```

The example tfvars file lists the optional overrides
(`server_type`, `server_location`, `data_volume_size_gb`, …); leave the
defaults unless told otherwise.

## The bring-up

From the repo root:

```bash
export GHCR_TOKEN=ghp_...
export RESTIC_S3_ACCESS_KEY=...
export RESTIC_S3_SECRET_KEY=...
make pilot
```

`make pilot` runs pre-flight checks first. If anything is missing
(tfvars placeholder, missing SSH key, `tofu` not on PATH, env vars not
set) it fails loudly and tells you what to fix before any Hetzner
resource is touched.

## What to expect during the run

The orchestrator (`web-deploy/scripts/pilot.sh`) prints a banner and then
runs five numbered steps. Tool output streams through unfiltered — Tofu's
per-resource creation log is the source of truth for "what is happening
right now".

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

## After the run

The success banner prints four URLs. Replace `<ip>` with the IPv4 shown
(or `make pilot-status` / `make -C web-deploy ip`).

| URL | What |
|---|---|
| `https://<ip>/welcome` | Operator landing page |
| `https://<ip>/varlens/healthz` | VarLens app health probe |
| `https://<ip>/` | Uptime Kuma (redirects to `/dashboard`) |
| `https://<ip>/logs/` | Dozzle (container logs, basic auth) |

Default Kuma / Dozzle credentials: **admin / varlens-konzept**. Change
both before handing the URL to anyone outside operations.

The first cert is from Let's Encrypt's short-lived (7-day) IP profile —
browsers trust it. To switch to a domain certificate, point a DNS A
record at the IP, then re-run with `make -C web-deploy stack-up
DOMAIN=foo.example.org`.

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

**Pull a new VarLens image** — bump `VARLENS_IMAGE` in
`web-deploy/compose/.env.example` (or set on the server in
`/mnt/data/app/.env`), then:

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
- [`web-deploy/docs/runbook.md`](web-deploy/docs/runbook.md) — incident
  scenarios (image updates, restore, rollback)
- [`web-deploy/docs/backup.md`](web-deploy/docs/backup.md)
- [`web-deploy/docs/sops.md`](web-deploy/docs/sops.md)

## When something goes wrong

**Smoke probe fails.** The smoke output names the failing probe (e.g.
`FAIL VarLens /varlens/healthz expected 200, got 502`). Triage:

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

**`cloud-init` failed.** Inspect the bootstrap log on the server:

```bash
make -C web-deploy logs       # tails /var/log/cloud-init-output.log
```

For deeper scenario-driven recovery, see
[`web-deploy/docs/runbook.md`](web-deploy/docs/runbook.md).

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

| Resource | Cost | When |
|---|---|---|
| cpx32 server | ~0.02 EUR/hour | only while running; 0 EUR when stopped |
| 50 GB volume | ~2 EUR/month | fixed, also when the server is stopped |
| IPv4 address | ~0.60 EUR/month | fixed |

`make -C web-deploy stop` saves the server hours but keeps volume + IP
billed. Full cost savings only via `make pilot-down`.
