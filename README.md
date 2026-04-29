# VarLens-IaC

Infrastructure-as-Code für die VarLens-Web-Portierung. In ~10 Minuten von Null zu einem laufenden Konzept-Pilot-Server inklusive Monitoring auf Hetzner Cloud.

## Voraussetzungen

- macOS mit `brew install opentofu` (≥ 1.7); `make`, `ssh`, `rsync` sind dabei
- Hetzner Cloud-Account mit verifizierter Adresse + Read-Write-API-Token

## Quickstart

```bash
# 1. SSH-Key
ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C "varlens-tofu" -N ""

# 2. tfvars befüllen (hcloud_token, ssh_pubkey, ssh_pubkey_name)
cd tofu/environments/pilot
cp terraform.tfvars.example terraform.tfvars
chmod 600 terraform.tfvars
$EDITOR terraform.tfvars

# 3. Provisionieren + Stack + Backup + Monitoring
cd ../../..
tofu -chdir=tofu/environments/pilot init   # einmalig
make up                # Hetzner-Ressourcen anlegen (~3 min inkl. cloud-init)
make stack-up          # Caddy + Uptime Kuma + Dozzle starten
make setup-backup      # restic-Bucket + Passwort + SOPS-Persistierung
make setup-monitoring  # Kuma-Admin + Heartbeat-Push-Monitor

# 4. Verifikation
make smoke             # 10/10 Asserts (HTTPS, Auth, Container)
make restore-drill     # Backup-Restore-Drill mit Protokoll
```

Im Browser unter `https://$(make ip)/` (Welcome), `/monitor/` (Kuma), `/logs/` (Dozzle). Self-Signed-Cert-Warnung ist erwartet (Konzept-Pilot-Intranet, in Stufe 2 wird das durch Let's-Encrypt ersetzt). Default-Login Caddy-Basic-Auth und Kuma-Admin: `admin / varlens-konzept` — nach erstem Login ändern.

## Repo-Struktur

| Pfad | Zweck |
|---|---|
| `bin/varlens` | CLI für pilot/e2e mit Confirm-Schutz vor destruktiven Aktionen |
| `tofu/environments/pilot/` | OpenTofu-Stack pilot (Hetzner) |
| `tofu/environments/e2e/` | Wegwerf-E2E-Test-Environment (parallel zu pilot) |
| `cloud-init/pilot.yaml` | First-Boot-Bootstrap der VM |
| `compose/` | docker-compose.yml + Caddyfile |
| `scripts/` | Setup, Restore, Recon |
| `secrets/` | SOPS+age-verschlüsselte Geheimnisse |
| `docs/` | Detail-Doku (Operations, Runbook, Backup, …) |
| `.planning/` | Plan-Dokumentation Stufe 1 + 2 (HTML, Confluence-Spiegel) |

## Weiterführende Dokumentation

- **[docs/operations.md](docs/operations.md)** — Lifecycle-Befehle, CLI-Referenz, CI/PAT, cloud-init-Replace, Troubleshooting
- **[docs/runbook.md](docs/runbook.md)** — Incident-Szenarien (Server-Recovery, Hetzner-Rescue-Mode, Token-Rotation)
- **[docs/backup.md](docs/backup.md)** — restic-Bucket-Details
- **[docs/database.md](docs/database.md)** — SQLite vs PostgreSQL-Profil
- **[docs/sops.md](docs/sops.md)** — SOPS+age-Workflow
- **[.planning/](.planning/)** — Stufe-1- (Konzept) und Stufe-2- (Betrieb) Pläne, mit Confluence-Spiegel auf [Roadmap zum Aufgabenprofil](https://laborberlin.atlassian.net/wiki/spaces/ITGM/pages/991002629)

## Status

Konzept-Pilot Stufe-1-Gate: erfüllt (12/12 Kriterien — siehe `.planning/konzept/infrastruktur.html` §infrastruktur2). Implementation-Stand: OpenTofu-Skeleton, cloud-init-Bootstrap, Compose-Stack mit Monitoring, restic-Backup mit Heartbeat, CI mit Trivy/Gitleaks, automatisierter Restore-Drill, prozedurale Backup- und Monitoring-Einrichtung. Anwendungs-Container, Datenbank-Container und produktive Domain-Konfiguration kommen mit Stufe 2.
