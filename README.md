# VarLens-IaC

Infrastructure-as-Code für die VarLens-Web-Portierung. In zehn Minuten von Null zu einem laufenden Konzept-Pilot-Server inklusive Monitoring.

Plan-Dokumentation lebt unter `.planning/` als HTML, Confluence-Spiegel unter [Roadmap zum Aufgabenprofil VarLens-Portierung](https://laborberlin.atlassian.net/wiki/spaces/ITGM/pages/991002629).

## Schnellstart

Voraussetzungen auf dem eigenen Rechner:

| Werkzeug | Installation auf macOS | Mindest-Version |
|---|---|---|
| OpenTofu | `brew install opentofu` | 1.7 |
| SSH-Client | bei macOS dabei | - |
| make | bei macOS dabei (`xcode-select --install` falls nötig) | - |
| rsync | bei macOS dabei | - |

Voraussetzungen Hetzner-seitig:

| Was | Wo |
|---|---|
| Account mit abgeschlossener Verifizierung (Adresse, Zahlungsmethode) | Hetzner Console, einmalig |
| Read-Write-API-Token | Hetzner Console > Sicherheit > API-Tokens |

### Schritt 1 - SSH-Key-Paar erzeugen

Falls noch keiner für dieses Projekt existiert:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C "varlens-tofu" -N ""
```

Erzeugt `~/.ssh/varlens-tofu` (privat, bleibt auf deinem Rechner) und `~/.ssh/varlens-tofu.pub` (öffentlich, wird an Hetzner gegeben).

Hinweis: `-N ""` legt einen Key ohne Passphrase an, was Automation einfach macht. Wer Passphrase-Schutz möchte: Passphrase nachträglich setzen mit `ssh-keygen -p -f ~/.ssh/varlens-tofu`.

### Schritt 2 - Variablen-Datei anlegen

```bash
cd tofu/environments/pilot
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` öffnen und befüllen:

```hcl
hcloud_token    = "DEIN_HETZNER_API_TOKEN"
ssh_pubkey      = "ssh-ed25519 AAAA...... varlens-tofu"
ssh_pubkey_name = "varlens-tofu"
```

Den Wert für `ssh_pubkey` bekommst du aus `cat ~/.ssh/varlens-tofu.pub`.

`terraform.tfvars` ist per `.gitignore` ausgeschlossen - landet nie im Git.

### Schritt 3 - Tofu initialisieren und Server ausrollen

Einmalig:

```bash
tofu -chdir=tofu/environments/pilot init
```

Danach reicht der Makefile-Wrapper aus dem Repo-Root:

```bash
make plan      # zeigt was angelegt wird (5 Ressourcen erwartet)
make up        # legt alles an (tofu apply -auto-approve)
```

Dauer: Hetzner-Ressourcen circa 60 Sekunden, anschließend cloud-init-Bootstrap auf dem Server zwei bis fünf Minuten (Docker, Compose, ufw, unattended-upgrades, restic, sops, Deploy-User mit Sudo, Root-Login disabled).

Nach `make up` zeigt `tofu output` die IPv4 und einen fertigen SSH-Befehl.

### Schritt 4 - Compose-Stack ausrollen

```bash
make stack-up
```

Bringt die Compose-Services auf den Server: Caddy als Reverse-Proxy plus zwei Monitoring-Werkzeuge (Uptime Kuma für „läuft alles?", Dozzle für Live-Container-Logs).

### Schritt 5 - Backup einrichten

```bash
make setup-backup
```

Automatisiert: S3-Zugangsdaten werden via Hetzner Cloud API erstellt, Bucket per S3-API angelegt, restic-Passwort generiert, `/etc/restic/env` auf dem Server befüllt, erstes Backup gestartet. Falls Hetzner Cloud API den Credentials-Endpoint nicht anbietet, gibt das Skript klare Anweisungen für die einmalige Console-Anlage und kann dann mit `RESTIC_S3_ACCESS_KEY=... RESTIC_S3_SECRET_KEY=... make setup-backup` weitermachen.

Preflight ist „stupid safe": wenn auf dem Server schon ein `/etc/restic/env` mit Passwort liegt oder im Bucket ein initialisierter restic-Repo (config-Objekt) existiert, bricht das Skript ab und zeigt beide Befunde. Auswege: `make setup-backup SETUP_BACKUP_ARGS=--reuse` für bestehendes Passwort, `--force` nur für bewusste Greenfield-Aktion.

### Schritt 6 - Heartbeat-Monitoring einrichten

```bash
make setup-monitoring
```

Automatisiert: Uptime-Kuma-Admin-Account wird angelegt (per direktem SQLite-INSERT, weil Kuma keinen HTTP-Setup-Endpoint hat), ein Push-Monitor `varlens-backup` wird mit zufälligem Token erstellt, Heartbeat-URL `http://127.0.0.1:3001/api/push/<token>` wird in `/etc/restic/env` als `HEARTBEAT_URL` eingetragen. Backup-Service curlt diese URL nach jedem erfolgreichen Lauf - Kuma alarmiert wenn der Heartbeat ausbleibt.

Default-Login Kuma-UI: `admin` / `varlens-konzept`. Adopter sollten das Passwort nach dem ersten Login ändern (Settings > Security > Change Password).

### Schritt 7 - Verifikation

```bash
make smoke                        # End-to-End-Smoke-Test (10 Asserts inkl. HTTPS)
make restore-drill                # Backup-Restore-Drill mit Protokoll
```

Plus optional manuell auf dem Server:

```bash
make ssh
docker compose version
df -h /mnt/data
sudo ufw status
docker compose -f /mnt/data/app/docker-compose.yml ps
```

Im Browser:

| URL | Zweck | Login |
|---|---|---|
| `http://<ipv4>/` | Welcome-Page | offen |
| `http://<ipv4>/monitor/` | Uptime Kuma Dashboard | Basic-Auth: admin / varlens-konzept |
| `http://<ipv4>/logs/` | Dozzle Live-Logs | Basic-Auth: admin / varlens-konzept |

Beim ersten `/monitor/`-Aufruf legt Uptime Kuma einen eigenen Admin-Account an (zusätzlich zur Caddy-Basic-Auth-Schicht). Danach werden Monitore eingetragen für die Services, die du beobachten willst.

### Lifecycle und Kosten-Steuerung

Der `Makefile` im Repo-Root bündelt alle gängigen Operationen:

| Befehl | Wirkung | Kosten-Effekt |
|---|---|---|
| `make up` | Ressourcen anlegen oder aktualisieren | Server tickt, Volume und IPv4 fix |
| `make stack-up` | Compose-Stack synchronisieren und starten | - |
| `make stack-down` | Compose-Stack stoppen | - |
| `make stack-logs` | Live-Logs aller Container | - |
| `make stop` | Server power off | Server-Stunden gespart, Volume und IPv4 weiter belastet |
| `make start` | Server power on | Server tickt wieder |
| `make status` | Aktueller Server-Zustand | - |
| `make ssh` | SSH-Login als deploy | - |
| `make logs` | cloud-init-Bootstrap-Log | - |
| `make down` | Komplette Zerstörung (Server **und** Volume **und** Firewall **und** SSH-Key). Verlangt zur Bestätigung das wörtliche Tippen von `pilot`. | Volle Kostenersparnis. **Achtung: Daten auf dem Volume sind weg.** |
| `make e2e` | Full-Cycle-E2E-Test in der separaten `e2e`-Environment (eigene Hetzner-Ressourcen, eigener SSH-Key `~/.ssh/varlens-e2e`). Provisioniert, testet, räumt auf. | ~0,01 €/Stunde während des Laufs (cpx11), keine Wirkung auf pilot. |
| `make e2e-keep` | Wie `make e2e`, lässt die e2e-Environment am Ende stehen für Inspektion (`./bin/varlens e2e ssh`). | Kostet weiter bis manuelles `./bin/varlens e2e down --yes`. |

Kosten-Richtwerte für den Konzept-Pilot (Stand April 2026):
- cpx32 running: ~0,02 €/Stunde
- 50 GB Volume: ~2 €/Monat fix
- IPv4-Adresse: ~0,60 €/Monat fix

Volle Kostenersparnis nur per `make down`. Wieder hochfahren: `make up` plus `make stack-up` (insgesamt circa fünf Minuten bis das Setup wieder vollständig läuft).

### CI-Workflow auf GitHub und PAT-Konfiguration

Der CI-Workflow (`.github/workflows/ci.yml`) läuft auf jedem Push/PR und prüft OpenTofu-Format/Validate, Trivy-Scans, gitleaks, shellcheck, yamllint und Caddyfile-Validate. Zum manuellen Eingreifen (Logs ziehen, Re-Run triggern, Workflow-Datei ändern) braucht man ein GitHub Personal Access Token.

**Token-Anforderungen (Classic-PAT):**

| Scope | Wofür |
|---|---|
| `repo` | Read+Push, Run-Logs lesen, Re-Run triggern |
| `workflow` | Pflicht, sobald ein Push die `ci.yml` ändert (sonst lehnt GitHub ab) |

`read:org` und alle anderen Scopes nicht nötig. Empfohlene Expiration: 30 Tage, danach rotieren.

**Speicherort lokal:** `~/.config/varlens/github_token` (mode `0600`, außerhalb des Repos, nicht in Git). Verwendung:

```bash
export GH_TOKEN=$(cat ~/.config/varlens/github_token)
gh run list --limit 5
gh run view <run-id> --log-failed
```

Hinweis: `gh auth login --with-token` weigert sich ohne `read:org`. Direkt über `GH_TOKEN`-Env-Var arbeiten ist die schmalere Variante und reicht für unsere Use-Cases vollständig.

### cloud-init-Änderungen führen zu Server-Replace

Hetzner kann user_data nicht in-place ändern. Wenn `cloud-init/pilot.yaml` editiert wird, zerstört `tofu apply` den alten Server und legt einen neuen an. Das Daten-Volume überlebt (eigene Resource), Compose-Stack muss aber per `make stack-up` neu deployed werden.

Adopter, die ihren Server vor diesem Verhalten schützen möchten, können in `tofu/environments/pilot/main.tf` den auskommentierten `lifecycle { ignore_changes = [user_data, ssh_keys] }`-Block aktivieren. Dann werden cloud-init-Änderungen erst beim nächsten manuellen Server-Replace wirksam.

### Trouble-Shooting

| Problem | Ursache und Lösung |
|---|---|
| `tofu apply` schlägt fehl mit „401 Unauthorized" | API-Token ungültig oder abgelaufen. Neuen Token in Hetzner Console erstellen, in `terraform.tfvars` aktualisieren. |
| `make ssh` mit „Connection refused" | cloud-init noch nicht durch. Warten zwei bis fünf Minuten, dann erneut versuchen. |
| `make ssh` mit „Permission denied" | SSH-Key nicht der gleiche der zu Hetzner hochgeladen wurde. Prüfen `cat ~/.ssh/varlens-tofu.pub` versus `ssh_pubkey` in `terraform.tfvars`. |
| SSH-Warnung „Host key verification failed" | Server wurde durch cloud-init-Änderung neu provisioniert. Alte Host-Key-Zeile bereinigen mit `ssh-keygen -R <ipv4>`. |
| `make stack-up` mit „Permission denied (publickey)" für rsync | SSH-Key lädt nicht automatisch. Über `ssh-add ~/.ssh/varlens-tofu` der ssh-agent-Auth nachhelfen. |
| Uptime Kuma zeigt „Setup", obwohl ich schon eingerichtet hatte | Volume-Mount unterbrochen. `make ssh` und `df -h /mnt/data` prüfen. |

## Plan-Dokumentation

Zwei Stufen:

- **`.planning/konzept/`** - Stufe 1 „Konzept": Mindestauftrag, lauffähiges Konzept mit Test- und Fake-Daten, keine Echt-Daten zulässig
- **`.planning/betrieb/`** - Stufe 2 „Betrieb": erster Wurf zur Constraints-Setzung, baut auf abgeschlossenem Konzept-Stand auf

Übergreifende Entscheidungen am `.planning/`-Root:
- `vertrag.html` - Anwendungs-Vertrag, Iterations-Mapping, Architecture-Decision-Record-Index, Pflege
- `adr.html` - Architecture Decision Records mit Stufe-Spalte
- `glossar.html` - Begriffe

```
.planning/
├── vertrag.html
├── adr.html
├── glossar.html
├── uebersicht.html
├── konzept/
│   ├── app.html
│   ├── infrastruktur.html
│   ├── fahrplan.html
│   └── bewertungen.html
└── betrieb/
    ├── app.html
    ├── infrastruktur.html
    └── fahrplan.html
```

### Confluence-Paste-Workflow

```bash
open .planning/konzept/fahrplan.html
# Im Browser: Cmd+A, Cmd+C
# In Confluence-Page im Edit-Mode: Cmd+V
```

Confluence übernimmt Tabellen, Headings, Listen, Blockquotes nativ. CSS aus dem `<style>`-Block wird beim Paste verworfen, die semantische Struktur überlebt.

## Aufbau Code und Konfiguration

| Pfad | Zweck |
|---|---|
| `tofu/environments/pilot/` | OpenTofu-Wurzel-Stack für die Pilot-Umgebung (Hetzner) |
| `tofu/modules/` | Modul-Schnitt für Cloud-Portabilität (befüllt ab Stufe 2, siehe ADR-6) |
| `cloud-init/pilot.yaml` | First-Boot-Bootstrap der virtuellen Maschine |
| `compose/docker-compose.yml` | Compose-Stack (Caddy, Uptime Kuma, Dozzle - Anwendung und Datenbank kommen) |
| `compose/Caddyfile` | Reverse-Proxy- und Routing-Konfiguration |
| `scripts/` | Hilfs-Skripte (Recon, Backup, Wartung) |
| `docs/` | Deploy-Anleitung, Runbook (Dokumentations-Phase 1) |

Detaillierter Deploy-Guide: [tofu/environments/pilot/README.md](tofu/environments/pilot/README.md).

## Status

Plan-Dokumentation v2 (Stand April 2026): Restrukturierung in `.planning/konzept/` und `.planning/betrieb/` abgeschlossen. Iteration 0 mit sechs Erzeugnissen für die Stakeholder-Klärung wartet auf den Kickoff.

Implementations-Stand: OpenTofu-Konfiguration für Hetzner-Pilot-Server geliefert, cloud-init-Bootstrap geliefert, Compose-Stack-Skelett mit Caddy plus Monitoring (Uptime Kuma, Dozzle hinter Basic-Auth) geliefert. Anwendungs-Container, Datenbank-Container, restic-Backup-Job und Continuous-Integration kommen als nächstes.
