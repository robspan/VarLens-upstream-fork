# VarLens-IaC

Infrastructure-as-Code für die VarLens-Web-Portierung. Brücken-Plattform Hetzner, Ziel AWS Sovereign Cloud (siehe `plan.md`, Migrations-Block §4.3).

## Aufbau

| Pfad | Zweck |
|---|---|
| `plan.md` | Verbindlicher Plan inkl. App-Vertrag, Phasen, ADRs |
| `adr/` | Architecture Decision Records (immutable, SemVer) |
| `cloud-init/` | First-Boot-Konfiguration der VMs |
| `compose/` | Docker-Compose-Stack (Caddy, Postgres, App) |
| `scripts/` | Manuelle Setup-Skripte (wandern später nach `cloud-init/`) |
| `tofu/modules/` | OpenTofu-Module: `compute`, `network`, `storage`, `secrets` (ADR-6) |
| `tofu/environments/pilot/` | Wurzel-Stack für die Hetzner-Pilot-Umgebung |
| `docs/` | README, Deploy-Anleitung, Runbook (Doku-Phase 1) |

## Status

Infra-Phase 1 — Hetzner-Brücke im Aufbau. Aktuell manuelles Setup; Migration nach OpenTofu folgt, sobald Setup auf VM reproduzierbar ist.
