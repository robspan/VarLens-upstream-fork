# Konzept-Pilot: OpenTofu Deploy-Guide

Provisioniert einen Hetzner-Cloud-Server inklusive Firewall, Daten-Volume und
First-Boot-Bootstrap (Docker, SSH-Hardening, ufw, unattended-upgrades, restic, sops).

Den primären Schnellstart führt das Repo-Root-README. Diese Datei dokumentiert
die OpenTofu-Konfiguration im Detail und liefert Trouble-Shooting-Tiefe.

## Voraussetzungen

| Werkzeug | Installation auf macOS |
|---|---|
| OpenTofu (>= 1.7) | `brew install opentofu` |
| Hetzner-Token | Hetzner Console > Sicherheit > API-Tokens > Read-Write |
| SSH-Key-Paar | `ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu -C "varlens-tofu" -N ""` |

## Setup

1. **Variablen-Datei anlegen**
   ```sh
   cd tofu/environments/pilot
   cp terraform.tfvars.example terraform.tfvars
   ```
   Werte in `terraform.tfvars` setzen:
   - `hcloud_token` aus der Hetzner Console
   - `ssh_pubkey` Inhalt von `~/.ssh/varlens-tofu.pub`
   - `ssh_pubkey_name` (optional, default `varlens-maintainer`)

2. **Initialisieren**
   ```sh
   tofu init
   ```

3. **Plan prüfen**
   ```sh
   tofu plan
   ```
   Erwartete Ressourcen: 1 SSH-Key, 1 Volume (50 GB), 1 Firewall, 1 Server, 1 Volume-Anhang.

4. **Apply**
   ```sh
   tofu apply
   ```
   Hetzner-Ressourcen circa 60 Sekunden, anschließend cloud-init-Bootstrap auf dem Server zwei bis fünf Minuten.

5. **Output abrufen**
   ```sh
   tofu output
   ```
   Liefert Server-Name, IDs, IPv4, IPv6, fertigen SSH-Befehl.

6. **Server-Login**
   ```sh
   ssh -i ~/.ssh/varlens-tofu deploy@<ipv4>
   ```
   Login per Key, root ist disabled, Passwort-Login ist disabled.

## Manuell angelegten Server entfernen

Wenn vorher schon ein Server in der Hetzner Console angelegt wurde (zum Beispiel
für Tests), in der Console löschen bevor `tofu apply` läuft. Sonst legt Tofu
einen weiteren Server an und der manuelle bleibt verwaist.

## Bootstrap-Prüfung

Nach dem Login als `deploy`-User:

```sh
docker --version           # Docker Engine vorhanden
docker compose version     # Compose-Plugin vorhanden
df -h /mnt/data            # Daten-Volume gemountet, 50 GB
sudo ufw status            # Firewall aktiv: 22, 80, 443
systemctl is-active ssh    # SSH läuft
cloud-init status          # status: done erwartet
```

Cloud-init-Log bei Problemen: `sudo cat /var/log/cloud-init-output.log`.

## State-Backend

Konzept-Pilot nutzt lokalen State (`terraform.tfstate` im Verzeichnis).
Stufe 2 wechselt auf S3-natives Locking gegen einen S3-API-Bucket (siehe ADR-9 in `.planning/adr.html`).

Konsequenz Konzept-Stand: nur ein Maintainer kann Tofu-Operationen ausführen.
Multi-Person-Workflow erfordert das Stufe-2-Remote-Backend.

## Zerstören

```sh
tofu destroy
```

Konzept-Stand hat **kein** `prevent_destroy` auf dem Volume - der `destroy`-Befehl
räumt auch das Daten-Volume ab. Stufe 2 (Echt-Daten) wird das ändern.

## Was als nächstes

Nach erfolgreichem Bootstrap und Compose-Stack-Deploy kommen:

1. Anwendungs-Container in Compose-Stack einbauen (sobald App-Repo Web-Build hat)
2. Datenbank-Container (SQLite-Volume oder PostgreSQL je `bewertungen.html` §bewertung2)
3. restic-Backup-Job gegen Hetzner Object Storage
4. Caddy-TLS via Let's Encrypt sobald Domain gesetzt
5. Continuous Integration: GitHub Actions, GHCR-Push, Trivy-Scan
