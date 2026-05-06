# VarLens-IaC

Infrastructure-as-Code for the VarLens web port. Go from zero to a running Concept Pilot server with monitoring on Hetzner Cloud in roughly 10 minutes.

## Prerequisites

- macOS with `brew install opentofu` (>= 1.7); `make`, `ssh`, and `rsync` are included
- Hetzner Cloud account with a verified address and a Read-Write API token

## Quickstart

```bash
# 0. Install local pre-commit hook (one-time per clone)
make install-hooks

# 1. SSH key
ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C "varlens-tofu" -N ""

# 2. Populate tfvars (hcloud_token, ssh_pubkey, ssh_pubkey_name)
cd tofu/environments/pilot
cp terraform.tfvars.example terraform.tfvars
chmod 600 terraform.tfvars
$EDITOR terraform.tfvars

# 3. Provision + stack + backup + monitoring
cd ../../..
tofu -chdir=tofu/environments/pilot init   # one-time
make up                # Create Hetzner resources (~3 min including cloud-init)
make stack-up          # Start Caddy + Uptime Kuma + Dozzle
make setup-backup      # restic bucket + password + SOPS persistence
make setup-monitoring  # Kuma admin + heartbeat push monitor

# 4. Verification
make smoke             # 10/10 assertions (HTTPS, auth, containers)
make restore-drill     # Backup restore drill with a log
```

In the browser: `https://$(make ip)/` (welcome page), `/monitor/` (Kuma), `/logs/` (Dozzle). The self-signed certificate warning is expected (Concept Pilot intranet; in Stage 2 this is replaced by Let's Encrypt). Default login for Caddy basic auth and the Kuma admin: `admin / varlens-konzept` — change it after the first login.

## Repository Layout

| Path | Purpose |
|---|---|
| `bin/varlens` | CLI for pilot/e2e with confirmation guards against destructive actions |
| `tofu/environments/pilot/` | OpenTofu pilot stack (Hetzner) |
| `tofu/environments/e2e/` | Disposable E2E test environment (parallel to pilot) |
| `cloud-init/pilot.yaml` | First-boot bootstrap of the VM |
| `compose/` | docker-compose.yml + Caddyfile |
| `scripts/` | Setup, restore, recon |
| `secrets/` | SOPS+age-encrypted secrets |
| `docs/` | Detailed documentation (operations, runbook, backup, ...) |

The Stage 1 / Stage 2 planning documents live outside the repository on Confluence at [Roadmap for the VarLens Port Task Profile](https://laborberlin.atlassian.net/wiki/spaces/ITGM/pages/991002629). Anchor references throughout this repository (e.g. `§infrastruktur2`, `§adr7`) point to sections in those plans.

## Further Documentation

- **[docs/operations.md](docs/operations.md)** — Lifecycle commands, CLI reference, CI/PAT, cloud-init replace, troubleshooting
- **[docs/runbook.md](docs/runbook.md)** — Incident scenarios (server recovery, Hetzner rescue mode, token rotation)
- **[docs/backup.md](docs/backup.md)** — restic bucket details
- **[docs/database.md](docs/database.md)** — SQLite vs PostgreSQL profile
- **[docs/sops.md](docs/sops.md)** — SOPS+age workflow

## Status

Concept Pilot Stage 1 gate: met (12/12 criteria — see Stage 1 infrastructure plan §infrastruktur2 on Confluence). Implementation status: OpenTofu skeleton, cloud-init bootstrap, Compose stack with monitoring, restic backup with heartbeat, CI with Trivy/Gitleaks, automated restore drill, procedural backup and monitoring setup. The application container, database container, and production domain configuration arrive with Stage 2.
