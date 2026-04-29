# Operations-Guide

Detail-Doku zur Bedienung. Für die Schnellstart-Sequenz siehe das Repo-`README.md`. Für Incident-Recovery siehe `runbook.md`.

## Lifecycle und Kosten-Steuerung

Der `Makefile` im Repo-Root bündelt alle gängigen Operationen.

| Befehl | Wirkung | Kosten-Effekt |
|---|---|---|
| `make plan` | Zeigt was Tofu ändern würde | - |
| `make up` | Ressourcen anlegen oder aktualisieren | Server tickt, Volume und IPv4 fix |
| `make down` | Komplette Zerstörung (Server + Volume + Firewall + SSH-Key). Verlangt zur Bestätigung das wörtliche Tippen von `pilot`. | Volle Kostenersparnis. **Achtung: Daten weg.** |
| `make stop` | Server power off (verlangt y-Confirm) | Server-Stunden gespart, Volume und IPv4 weiter belastet |
| `make start` | Server power on | Server tickt wieder |
| `make status` | Aktueller Server-Zustand | - |
| `make ssh` | SSH-Login als deploy | - |
| `make ip` | IPv4 ausgeben (für Skript-Verkettung) | - |
| `make logs` | cloud-init-Bootstrap-Log | - |
| `make stack-up` | Compose-Stack synchronisieren und starten | - |
| `make stack-down` | Compose-Stack stoppen | - |
| `make stack-logs` | Live-Logs aller Container | - |
| `make setup-backup` | restic-Bucket, Credentials, Passwort, `/etc/restic/env` einrichten. `SETUP_BACKUP_ARGS=--reuse` zum Wiederverwenden, `--force` für Greenfield-Reset. | - |
| `make setup-monitoring` | Uptime-Kuma-Admin und Heartbeat-Push-Monitor einrichten | - |
| `make smoke` | End-to-End-Smoke-Test (10 Asserts inkl. HTTPS) | - |
| `make restore-drill` | Backup-Restore-Drill mit Marker-Datei und Protokoll | - |
| `make lint` | Lokaler Linter (tofu fmt/validate, shellcheck, yamllint, Caddyfile-Validate) | - |
| `make e2e` | Full-Cycle-E2E-Test in der `e2e`-Environment, eigener SSH-Key `~/.ssh/varlens-e2e`. Provisioniert, testet, räumt auf. | ~0,01 €/Stunde während des Laufs (cpx11), keine Wirkung auf pilot |
| `make e2e-keep` | Wie `make e2e`, lässt e2e-Env stehen für Inspektion | Kostet weiter bis manuelles `./bin/varlens e2e down --yes` |
| `make sops-edit FILE=secrets/<f>.yaml` | Verschlüsselte Datei im Editor öffnen | - |
| `make sops-decrypt FILE=secrets/<f>.yaml` | Klartext anzeigen (read-only) | - |

Kosten-Richtwerte für den Konzept-Pilot (Stand April 2026):

- cpx32 running: ~0,02 €/Stunde
- 50 GB Volume: ~2 €/Monat fix
- IPv4-Adresse: ~0,60 €/Monat fix

Volle Kostenersparnis nur per `make down`. Wieder hochfahren: `make up` plus `make stack-up` (insgesamt circa fünf Minuten bis das Setup wieder vollständig läuft).

## CLI-Referenz

`./bin/varlens` ist der Wrapper, an den der Makefile destruktive Aktionen delegiert. Direkter Aufruf für E2E-Steuerung oder explizites Confirm-Bypass.

```
varlens <env> <action> [--yes]

env:    pilot | e2e
action: plan | up | down | stop | start | status | ssh | ip
        e2e: zusätzlich `run` (Full-Cycle inklusive Cleanup)
        e2e run --keep: lässt Env stehen
--yes:  überspringt Confirm-Prompts (für CI)
```

`pilot down` verlangt zur Sicherheit das wörtliche Tippen von `pilot`. `pilot stop` verlangt ein y/N-Confirm. Beides lässt sich mit `--yes` umgehen, z. B. in CI-Pipelines.

## CI-Workflow auf GitHub und PAT-Konfiguration

Der CI-Workflow (`.github/workflows/ci.yml`) läuft auf jedem Push auf `main` und auf jedem Pull-Request. Geprüft wird:

- OpenTofu-Format und Validate
- Trivy-Scan (Config + Images), Findings in `.trivyignore` mit Quartals-Review
- Gitleaks Secret-Scan
- Shellcheck (scripts/), Yamllint (compose + workflow), Caddyfile-Validate

Zum manuellen Eingreifen (Logs ziehen, Re-Run triggern, Workflow-Datei ändern) braucht man ein GitHub Personal Access Token.

**Token-Anforderungen (Classic-PAT):**

| Scope | Wofür |
|---|---|
| `repo` | Read+Push, Run-Logs lesen, Re-Run triggern |
| `workflow` | Pflicht, sobald ein Push die `ci.yml` ändert (sonst lehnt GitHub ab) |

Alle anderen Scopes nicht nötig. Empfohlene Expiration: 30 Tage, danach rotieren.

**Speicherort lokal:** `~/.config/varlens/github_token` (mode `0600`, außerhalb des Repos, nicht in Git).

```bash
export GH_TOKEN=$(cat ~/.config/varlens/github_token)
gh run list --limit 5
gh run view <run-id> --log-failed
```

`gh auth login --with-token` weigert sich ohne `read:org`. Direkt über `GH_TOKEN`-Env-Var arbeiten ist die schmalere Variante und reicht für unsere Use-Cases vollständig.

## cloud-init-Änderungen führen zu Server-Replace

Hetzner kann user_data nicht in-place ändern. Wenn `cloud-init/pilot.yaml` editiert wird, zerstört `tofu apply` den alten Server und legt einen neuen an. Das Daten-Volume überlebt (eigene Resource), Compose-Stack muss aber per `make stack-up` neu deployed werden.

Adopter, die ihren Server vor diesem Verhalten schützen möchten, können in `tofu/environments/pilot/main.tf` den auskommentierten `lifecycle { ignore_changes = [user_data, ssh_keys] }`-Block aktivieren. Dann werden cloud-init-Änderungen erst beim nächsten manuellen Server-Replace wirksam.

## Trouble-Shooting

| Problem | Ursache und Lösung |
|---|---|
| `tofu apply` schlägt fehl mit „401 Unauthorized" | API-Token ungültig oder abgelaufen. Neuen Token in Hetzner Console erstellen, in `terraform.tfvars` aktualisieren. |
| `make ssh` mit „Connection refused" | cloud-init noch nicht durch. Warten zwei bis fünf Minuten, dann erneut versuchen. |
| `make ssh` mit „Permission denied" | SSH-Key nicht der gleiche der zu Hetzner hochgeladen wurde. Prüfen `cat ~/.ssh/varlens-tofu.pub` versus `ssh_pubkey` in `terraform.tfvars`. |
| `make ssh` mit „Host key verification failed" / „REMOTE HOST IDENTIFICATION HAS CHANGED" | Server wurde durch cloud-init-Änderung neu provisioniert oder IP recycled. Bereinigen mit `ssh-keygen -R <ipv4>`. |
| `make stack-up` mit „Permission denied (publickey)" für rsync | SSH-Key lädt nicht automatisch. Über `ssh-add ~/.ssh/varlens-tofu` der ssh-agent-Auth nachhelfen. |
| Uptime Kuma zeigt „Setup", obwohl bereits eingerichtet | Volume-Mount unterbrochen. `make ssh` und `df -h /mnt/data` prüfen. |
| `make setup-backup` mit „Preflight-Detect: bestehende Backup-Artefakte gefunden" | Default-Modus schützt vor Datenverlust. `make setup-backup SETUP_BACKUP_ARGS=--reuse` wenn das bestehende Passwort übernommen werden soll, `--force` nur für bewussten Greenfield-Reset. |
| Self-Signed-Cert-Warnung im Browser bei `https://<ipv4>/` | Erwartet im Konzept-Pilot-Intranet. „Trotzdem fortfahren / Erweitert" klicken. Wird in Stufe 2 (Public-Domain) durch Public-CA via Let's Encrypt ersetzt. |
| Heartbeat-Monitor in Kuma rot trotz erfolgreicher Backups | Push-Interval prüfen (Kuma-UI > Monitor > Edit). Auf dem Server: `journalctl -u restic-backup.service --no-pager -n 30` zeigt, ob der `curl`-Push am Ende des Backups durchgegangen ist. |

## Plan-Dokumentation und Confluence-Spiegel

Plan-Dokumente leben unter `.planning/` als HTML, Confluence-Spiegel unter [Roadmap zum Aufgabenprofil VarLens-Portierung](https://laborberlin.atlassian.net/wiki/spaces/ITGM/pages/991002629).

Zwei Stufen:

- **`.planning/konzept/`** — Stufe 1 „Konzept": Mindestauftrag, lauffähiges Konzept mit Test- und Fake-Daten, keine Echt-Daten zulässig.
- **`.planning/betrieb/`** — Stufe 2 „Betrieb": erster Wurf zur Constraints-Setzung, baut auf abgeschlossenem Konzept-Stand auf.

Übergreifend am `.planning/`-Root: `vertrag.html`, `adr.html`, `glossar.html`, `uebersicht.html`.

Confluence-Paste-Workflow:

```bash
open .planning/konzept/fahrplan.html
# Im Browser: Cmd+A, Cmd+C
# In Confluence-Page im Edit-Mode: Cmd+V
```

Confluence übernimmt Tabellen, Headings, Listen, Blockquotes nativ. CSS aus dem `<style>`-Block wird beim Paste verworfen, die semantische Struktur überlebt.
