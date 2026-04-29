# Runbook v1 - Konzept-Pilot

Operations-Handbuch für den VarLens-Konzept-Pilot. Pro Szenario: Symptom, Schritte, Verifikation, Eskalation.

Plan-Bezug: `konzept/infrastruktur.html` §infrastruktur4 Phase 1 fordert Runbook v1 (Update, Restore, Rollback) als Doku-Pflicht.

## Schnell-Referenz

| Was tun | Befehl |
|---|---|
| Stack-Status sehen | `make status && ssh -i ~/.ssh/varlens-tofu deploy@$(make ip) 'cd /mnt/data/app && docker compose ps'` |
| Live-Logs aller Container | `make stack-logs` |
| In den Server | `make ssh` |
| Stack neu starten | `make stack-up` |
| Stack stoppen | `make stack-down` |
| Server stoppen (Volume bleibt) | `make stop` |
| Server starten | `make start` |
| Smoke-Test gegen Live-System | `make smoke` |
| Code-Linter lokal | `make lint` |
| Alles weg (Server + Volume + alles) | `make down` |
| cloud-init-Log auf Server | `make logs` |

## Szenario 1: Update der Container-Images

**Trigger:** Trivy in CI meldet HIGH/CRITICAL CVE für Caddy, Postgres, Uptime Kuma oder Dozzle. Oder routinemäßiges Update-Fenster (alle vier bis sechs Wochen empfohlen).

### Schritte

1. Auf macOS lokal aktuelle Image-Digests einholen:

   ```sh
   for img in caddy:2-alpine louislam/uptime-kuma:1 amir20/dozzle:latest postgres:16-alpine; do
     ssh -i ~/.ssh/varlens-tofu deploy@$(make ip) "docker pull $img && docker inspect --format='{{index .RepoDigests 0}}' $img"
   done
   ```

2. Die Digests in `compose/docker-compose.yml` bei den `image:`-Feldern eintragen.

3. Lokal validieren:

   ```sh
   make lint
   ```

4. Stack updaten:

   ```sh
   make stack-up                       # falls Konzept mit SQLite läuft
   make stack-up DB=postgres           # falls Konzept mit Postgres läuft
   ```

5. Verifikation:

   ```sh
   make smoke
   ```

### Eskalation

Wenn `make smoke` rot wird: sofort Rollback (Szenario 3). Gegebenenfalls die alte Digest-Version aus `git log compose/docker-compose.yml` rauspicken und neu deployen.

---

## Routine: Restore-Drill (automatisiert)

**Zweck:** Beweis, dass Backup-Restore-Pfad funktioniert. Plan-Gate Phase 1.

```sh
make restore-drill
```

Was passiert:
- Marker-Datei mit zufälligem Inhalt nach `/mnt/data` schreiben
- restic-Backup triggern, auf Abschluss warten
- Snapshot-ID lesen
- Marker löschen
- Snapshot in `/tmp/restore-drill-...` zurückspielen
- Verifikation: Marker-Inhalt identisch wie vorher
- Aufräumen, Protokoll-Eintrag in `docs/restore-protokoll.md`

Ergebnis: Exit-Code 0 bei PASS, Exit-Code 1 bei FAIL. Protokoll wächst monoton.

Empfohlene Frequenz: nach jeder Plan-Änderung an `cloud-init/pilot.yaml`,
`scripts/backup.sh` oder `restic`-Konfig. Mindestens einmal vor dem
Migrations-Block. Kann auch in CI als geplanter Job laufen, sobald CI
SSH-Zugriff zum Server hat (Stufe 2).

---

## Szenario 2: Restore aus Backup (manuell)

**Trigger:** `/mnt/data/uptime-kuma` oder `/mnt/data/postgres` sind korrupt, versehentlich überschrieben oder Daten-Volume nach `make down` wieder benötigt.

### Voraussetzung

- restic-Bucket existiert und enthält Snapshots
- `/etc/restic/env` auf dem Server ist befüllt (siehe `docs/backup.md`)

### Schritte

1. Snapshots auflisten:

   ```sh
   make ssh
   sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'
   ```

2. Wunsch-Snapshot identifizieren (typisch: latest, oder spezifische ID).

3. Wiederherstellung in temporären Pfad (zerstört nichts):

   ```sh
   sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore-konzept'
   sudo ls -la /tmp/restore-konzept/mnt/data/
   ```

4. Compose-Stack runter, damit kein Container die zu ersetzenden Dateien hält:

   ```sh
   exit                                  # zurück auf den Mac
   make stack-down
   ```

5. Auf dem Server: Daten ersetzen.

   ```sh
   make ssh
   sudo rsync -av --delete /tmp/restore-konzept/mnt/data/ /mnt/data/
   ```

6. Stack wieder hoch und Verifikation:

   ```sh
   exit
   make stack-up                         # mit ursprünglichem DB-Profil
   make smoke
   ```

7. Stand in `docs/restore-protokoll.md` ergänzen mit Datum, Snapshot-ID, Dauer, Ergebnis.

### Eskalation

- Snapshot-Liste leer: Bucket prüfen über Hetzner Console, Object-Storage-Credentials in `/etc/restic/env` prüfen.
- Snapshot kann nicht entschlüsselt werden: `RESTIC_PASSWORD` in `/etc/restic/env` falsch. In SOPS-Secrets nachschauen oder den Maintainer fragen.

---

## Szenario 3: Rollback eines schlechten Deploys

**Trigger:** Nach `make stack-up` startet ein Container nicht, läuft in Restart-Loop oder Smoke-Test schlägt fehl.

### Schritte

1. Live-Logs ansehen:

   ```sh
   make stack-logs
   ```

   Auch via `http://<ip>/logs/` (Dozzle) sichtbar.

2. Letzten guten Stand aus Git holen:

   ```sh
   git log --oneline compose/
   git checkout HEAD~1 -- compose/                # eine Revision zurück
   ```

3. Stack mit altem Stand redeployen:

   ```sh
   make stack-up
   ```

4. Verifikation:

   ```sh
   make smoke
   ```

5. Wenn ok: Ursache am defekten Stand analysieren, Fix in eigenem Branch entwickeln, vor Merge `make lint` und Smoke-Test. Den Rollback-Stand committen mit Begründung.

### Eskalation

Wenn auch der ältere Stand nicht hochkommt: Compose-Stack komplett runter (`make stack-down`), `docker system prune -a` auf dem Server, dann `make stack-up`. Wenn Container-Start an Volume-Daten scheitert: Restore aus Backup (Szenario 2).

---

## Szenario 4: Server unerreichbar

**Trigger:** `make ssh` schlägt mit Timeout fehl, HTTP-Calls hängen, `make smoke` fehlerhaft.

### Diagnose-Schritte

1. Ist der Server überhaupt an?

   ```sh
   make status
   ```

   Erwartet: `Status: running`. Wenn `off`: `make start` und Minute warten.

2. Hat sich die IP geändert?

   ```sh
   make ip
   ```

   Wenn andere IP als erwartet: bekannten Hostkey aus `~/.ssh/known_hosts` entfernen.

3. Ist die Hetzner-Cloud-Firewall noch korrekt? Hetzner Console > Firewalls > `varlens-pilot-fsn1-fw`. Erwartet: 22, 80, 443, ICMP offen.

4. Antwortet der Server auf Ping (wenn ICMP zugelassen)?

   ```sh
   ping -c 3 $(make ip)
   ```

5. SSH mit verbose:

   ```sh
   ssh -v -i ~/.ssh/varlens-tofu deploy@$(make ip)
   ```

   Häufige Fehlerbilder:
   - `Permission denied (publickey)`: SSH-Key nicht passend, prüfen `cat ~/.ssh/varlens-tofu.pub` versus Hetzner SSH-Keys.
   - `Connection timeout`: Firewall blockiert, Server hängt, oder Server bootet noch (cloud-init).
   - `Connection refused`: sshd nicht aktiv (sehr selten - meist Server-Crash).

### Eskalation

1. Hetzner-Console-Aktion: Server „Reset" (Soft) versuchen. Wenn das nicht hilft: Server „Power off" und neu starten.
2. Letzte Option: `make down` plus `make up` (komplette Neu-Provisionierung, dauert fünf Minuten, Daten-Volume bleibt erhalten weil eigene Resource).

---

## Szenario 5: cloud-init-Änderung führte zu Server-Replace

**Trigger:** `make plan` zeigt „1 to destroy, 1 to add" für `hcloud_server.pilot`, weil `cloud-init/pilot.yaml` editiert wurde.

### Schritte

1. Vor `make up`: prüfen, dass das Daten-Volume separate Resource ist (sollte schon sein, aber vergewissern):

   ```sh
   tofu -chdir=tofu/environments/pilot plan | grep -E "hcloud_volume|destroy"
   ```

   Erwartet: kein `destroy` für `hcloud_volume.data`.

2. Apply:

   ```sh
   make up
   ```

3. SSH-Hostkey wird sich ändern. Alten Eintrag entfernen:

   ```sh
   ssh-keygen -R $(make ip)
   ```

4. Auf cloud-init warten (zwei bis fünf Minuten), dann SSH-Test:

   ```sh
   make ssh
   exit
   ```

5. Compose-Stack auf neuem Server deployen:

   ```sh
   make stack-up
   ```

   Wenn Postgres genutzt wurde: `make stack-up DB=postgres`.

6. Smoke-Test:

   ```sh
   make smoke
   ```

### Eskalation

Wenn `/mnt/data` nach Re-Mount leer aussieht: das Volume ist da, aber cloud-init-Mount hat möglicherweise gerade noch nicht durchgelaufen. `make ssh` plus `df -h /mnt/data` prüfen. Wenn Volume nicht gemountet: `make logs` (cloud-init-Log) lesen, Mount-Fehler suchen.

---

## Szenario 6: Backup ist fehlgeschlagen

**Trigger:** Uptime-Kuma-Heartbeat-Push-Monitor meldet rot. Oder `journalctl -u restic-backup.service` zeigt Fehler.

### Diagnose

1. Auf den Server:

   ```sh
   make ssh
   sudo journalctl -u restic-backup.service --since "1 day ago" | tail -50
   ```

2. Häufigste Ursachen:
   - Repository nicht erreichbar: Object-Storage-Credentials abgelaufen, Bucket gelöscht
   - `RESTIC_PASSWORD` falsch nach Env-Datei-Edit
   - Disk auf dem Server voll
   - `/mnt/data` zu groß (Backup-Dauer überschreitet Timer-Intervall)

3. Manueller Test-Lauf:

   ```sh
   sudo systemctl start restic-backup.service
   sudo journalctl -u restic-backup.service -f
   ```

### Behebung

- Credentials erneuert: in `/etc/restic/env` aktualisieren, Service neu starten.
- Repository unzugänglich: Bucket-Status in Hetzner Console prüfen.
- Disk voll: `df -h` auf dem Server, alte Docker-Images aufräumen mit `docker system prune -a`.
- Backup zu lang: Retention-Policy strenger setzen oder selektiver backuppen (`BACKUP_PATHS` in `/etc/restic/env` einschränken).

### Eskalation

Wenn Backups mehrere Tage in Folge fehlschlagen: kein neues `make down` ausführen (sonst sind Daten weg). Stattdessen Bucket manuell prüfen und falls nötig komplett neu aufsetzen, dann `restic init` und manuell ersten Backup-Lauf.

---

## Szenario 7: Kostenexplosion

**Trigger:** Hetzner-Rechnung deutlich höher als erwartet (Konzept-Pilot Erwartung: ~17 EUR/Monat).

### Diagnose

1. Hetzner Console > Cost Overview prüfen.
2. Ungewöhnliche Posten: zusätzliche Server, Snapshot-Storage, Object-Storage-Traffic, Floating-IPs.
3. Tofu-State prüfen, was tatsächlich da ist:

   ```sh
   tofu -chdir=tofu/environments/pilot state list
   ```

   Erwartet: 5 Resources (1 SSH-Key, 1 Volume, 1 Firewall, 1 Server, 1 Volume-Attachment).

### Behebung

- Wenn ungenutzte Server, Snapshots, Floating-IPs in Console sichtbar: in Console löschen.
- Wenn Server unbeabsichtigt running: `make stop` (Server pausiert, Volume kostet weiter, etwa 2 EUR/Monat).
- Wenn Object-Storage-Traffic hoch: restic-Retention prüfen, eventuell aggressivere Prune-Policy.

### Eskalation

Wenn unerwartete Resources auftauchen, die niemand erstellt hat: API-Token rotieren (Hetzner Console > Sicherheit > API-Tokens), eventuell Account kompromittiert. SOPS-Secrets durchgehen.

---

## Szenario 8: Compose-Stack hängt

**Trigger:** Container im Restart-Loop, hohe CPU-Auslastung, einer der Container `Restarting (1)`.

### Schritte

1. Auf den Server:

   ```sh
   make ssh
   cd /mnt/data/app
   docker compose ps                          # welcher Container hängt
   docker compose logs --tail=200 <name>      # Logs des hängenden Containers
   ```

   Auch via `http://<ip>/logs/` (Dozzle) sichtbar.

2. Häufige Ursachen:
   - Caddy: ungültige Caddyfile-Änderung. `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` testet die Konfig.
   - Uptime-Kuma: Datenbank-Datei korrupt unter `/mnt/data/uptime-kuma`.
   - Postgres: alte Postgres-Daten unter `/mnt/data/postgres` mit anderer Major-Version. Beim Major-Upgrade ist Migration manuell.
   - Dozzle: Docker-Socket-Mount nicht verfügbar (sehr selten).

3. Einzelnen Container neu starten:

   ```sh
   docker compose restart <name>
   ```

4. Wenn das nicht hilft: ganzen Stack stoppen und neu starten.

   ```sh
   exit
   make stack-down && make stack-up
   ```

### Eskalation

Wenn auch ein Restart nicht hilft: Rollback (Szenario 3) oder Restore (Szenario 2).

---

## Szenario 9: Disk wird voll

**Trigger:** `df -h /mnt/data` zeigt > 80 Prozent. Oder Container schreiben Fehler in die Logs.

### Diagnose

```sh
make ssh
df -h
sudo du -sh /mnt/data/* | sort -h
docker system df
```

### Behebung

- Alte Docker-Images aufräumen:

  ```sh
  docker image prune -a -f
  ```

- Container-Logs (durch Docker selbst) sind groß: Logs sind in `/var/lib/docker/containers/`, nicht in `/mnt/data`. Größe prüfen mit `sudo du -sh /var/lib/docker/containers/*`. Falls problematisch: in `/etc/docker/daemon.json` ein `log-opts`-Limit setzen, dann `systemctl restart docker`.
- Postgres wird groß: Daten-Inhalt prüfen, eventuell Test-Daten löschen.
- Uptime-Kuma History-DB wächst: Settings > General > History Retention reduzieren.

### Eskalation

Wenn nicht aufräumbar: Volume-Größe in Hetzner Console hochsetzen (kostet zusätzlich). Tofu-Variable `data_volume_size_gb` muss dann auch erhöht werden, sonst zerstört Tofu beim nächsten Apply.

---

## Szenario 10: Zertifikat-Renewal-Probleme (sobald Domain aktiv)

**Trigger:** Browser meldet abgelaufenes oder ungültiges Zertifikat, sobald TLS via Let's Encrypt aktiv ist.

### Schritte (für später, sobald Domain im Caddyfile)

1. Caddy-Logs prüfen:

   ```sh
   make ssh
   docker logs caddy 2>&1 | grep -iE "acme|cert|let.s.encrypt" | tail -50
   ```

2. Häufige Ursachen:
   - Port 80 nicht offen für ACME HTTP-01 Challenge: Hetzner Cloud Firewall + UFW prüfen.
   - DNS zeigt nicht auf den Server: A-Record und AAAA-Record bei DNS-Provider prüfen.
   - Let's Encrypt Rate-Limit: bei zu vielen fehlerhaften Versuchen sperrt Let's Encrypt für eine Stunde.

3. Caddy-Reload nach Konfig-Fix:

   ```sh
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

### Eskalation

Wenn Rate-Limit greift: kurzzeitig auf `tls internal` (selbst-signiert) wechseln, bis Limit zurückgesetzt ist (eine Stunde).

---

## Szenario 11: Server verloren - Recovery aus Backup

**Trigger:** Server-Resource gelöscht (versehentliches `make down`, Hetzner-Account-Vorfall, Region-Ausfall). Daten-Volume ebenfalls weg, einzig die restic-Snapshots im Object-Storage existieren noch.

### Schritte

1. Neuen Server provisionieren:

   ```sh
   make up
   ```

   Erwartet: 5 Resources (SSH-Key, Volume, Firewall, Server, Volume-Attachment) angelegt, `/mnt/data` leer gemountet.

2. Compose-Stack ausrollen:

   ```sh
   make stack-up
   ```

3. restic-Passwort und S3-Credentials aus dem SOPS-File holen:

   ```sh
   make sops-decrypt FILE=secrets/restic.yaml
   ```

   Erwartet: `RESTIC_PASSWORD`, `RESTIC_S3_ACCESS_KEY`, `RESTIC_S3_SECRET_KEY`, `RESTIC_REPOSITORY` im Klartext.

4. `/etc/restic/env` auf dem neuen Server schreiben:

   ```sh
   make ssh
   sudo tee /etc/restic/env >/dev/null <<'EOF'
   RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/varlens-pilot-backups
   RESTIC_PASSWORD=<aus SOPS>
   AWS_ACCESS_KEY_ID=<aus SOPS>
   AWS_SECRET_ACCESS_KEY=<aus SOPS>
   BACKUP_PATHS=/mnt/data
   HEARTBEAT_URL=<aus setup-monitoring, optional - kann später nachgezogen werden>
   EOF
   sudo chmod 600 /etc/restic/env
   ```

5. Snapshot-Liste prüfen, dann den letzten Snapshot wiederherstellen:

   ```sh
   sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'
   sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /mnt/data --include /mnt/data'
   ```

   restic schreibt die Daten unter `/mnt/data/mnt/data/...` falls `--include` nicht greift - dann mit `sudo rsync -av --delete /mnt/data/mnt/data/ /mnt/data/` glattziehen und das Hilfsverzeichnis löschen.

6. Stack-Restart und Verifikation per Restore-Drill:

   ```sh
   exit
   make stack-down && make stack-up
   make restore-drill
   make smoke
   ```

### Eskalation

- Snapshots fehlen oder Repo nicht entschlüsselbar: SOPS-File-Stand prüfen, eventuell älteren Stand aus Git holen. **restic-Passwort lässt sich nicht „neu setzen" - ohne Passwort sind die Snapshots verloren.**
- S3-Credentials abgelaufen: Hetzner Console > Object-Storage > Credentials neu erzeugen, in SOPS-File und auf dem Server in `/etc/restic/env` aktualisieren.

---

## Szenario 12: SSH-Key verloren - Hetzner Rescue-Mode

**Trigger:** Privater SSH-Key (`~/.ssh/varlens-tofu`) ist weg oder kompromittiert. `make ssh` schlägt mit „Permission denied (publickey)" fehl, ein Reset des Servers würde aber Daten kosten.

### Schritte

1. Neuen lokalen SSH-Key erzeugen:

   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu-new -C "varlens-tofu" -N ""
   ```

2. Hetzner Console öffnen: **Cloud Console > Project varlens-pilot > Servers > `varlens-pilot` > Tab „Rescue"**.

3. Rescue-Image auswählen:
   - **Operating System:** `linux64`
   - **SSH Keys:** den neuen Pubkey via „Add SSH Key" hinzufügen und auswählen
   - **Enable rescue & power cycle** klicken (Server bootet ins Rescue-Image)

4. Warten bis der Server im Rescue-Mode antwortet (~60 Sekunden), dann per neuem Key einloggen:

   ```sh
   ssh -i ~/.ssh/varlens-tofu-new root@$(make ip)
   ```

   Falls SSH nicht klappt: in der Console **Tab „Console"** (Web-VNC) öffnen, Login als `root` mit dem von Hetzner per E-Mail/Console gezeigten Rescue-Passwort.

5. System-Disk identifizieren und mounten:

   ```sh
   lsblk                                  # typisch: /dev/sda1 ist root
   mount /dev/sda1 /mnt
   ```

6. `authorized_keys` ersetzen:

   ```sh
   cat ~/.ssh/varlens-tofu-new.pub        # auf dem Mac vorher per pbcopy kopieren und in Rescue-Shell pasten
   echo "ssh-ed25519 AAAA... varlens-tofu" > /mnt/home/deploy/.ssh/authorized_keys
   chown 1000:1000 /mnt/home/deploy/.ssh/authorized_keys
   chmod 600 /mnt/home/deploy/.ssh/authorized_keys
   ```

7. Sauber unmounten und Rescue-Mode beenden:

   ```sh
   umount /mnt
   exit
   ```

   In Hetzner Console: **Tab „Rescue" > „Disable rescue"**, dann **Tab „Power" > „Power cycle"**.

8. Lokal alten Key ersetzen, Hostkey neu lernen, testen:

   ```sh
   mv ~/.ssh/varlens-tofu-new ~/.ssh/varlens-tofu
   mv ~/.ssh/varlens-tofu-new.pub ~/.ssh/varlens-tofu.pub
   ssh-keygen -R $(make ip)
   make ssh
   ```

9. `terraform.tfvars` und Hetzner-Project-SSH-Key auf den neuen Pubkey aktualisieren, sonst zerstört der nächste `make up` die Konfiguration.

### Eskalation

Wenn Rescue-Mode nicht bootet: Hetzner-Support-Ticket. Wenn der alte Pubkey kompromittiert war (nicht nur verloren): zusätzlich Hetzner-API-Token rotieren (siehe Szenario 13).

---

## Szenario 13: Token-Rotation

**Trigger:** Routine-Rotation (alle 30/90 Tage), Verdacht auf Kompromittierung, Personalwechsel, oder Hinweis aus gitleaks/Trivy-Scan.

### (a) Hetzner API Token

1. Hetzner Console > **Sicherheit > API Tokens** > altes Token „Revoke".
2. „Generate API Token" mit Scope „Read & Write", Namen vergeben (z.B. `varlens-tofu-2026-04`).
3. Token in `tofu/environments/pilot/terraform.tfvars` bei `hcloud_token` einsetzen.
4. Datei-Mode prüfen:

   ```sh
   chmod 600 tofu/environments/pilot/terraform.tfvars
   ls -la tofu/environments/pilot/terraform.tfvars
   ```

5. Validieren mit `tofu -chdir=tofu/environments/pilot plan` (sollte „No changes" sagen).

### (b) GitHub Personal Access Token

1. github.com > **Settings > Developer settings > Personal access tokens (classic)** > altes Token „Delete".
2. „Generate new token (classic)" mit Scopes `repo` und `workflow`, Expiration 30 Tage.
3. Lokal überschreiben:

   ```sh
   echo "<neuer-token>" > ~/.config/varlens/github_token
   chmod 600 ~/.config/varlens/github_token
   ```

4. Test:

   ```sh
   export GH_TOKEN=$(cat ~/.config/varlens/github_token)
   gh run list --limit 1
   ```

### (c) Caddy Basic-Auth

1. Neuen bcrypt-Hash erzeugen (Caddy macht das selbst):

   ```sh
   make ssh
   docker exec caddy caddy hash-password
   # Passwort eintippen, Hash kopieren
   exit
   ```

2. In `compose/Caddyfile` den `basic_auth`-Block: alten Hash durch neuen ersetzen (für `/monitor/*` und `/logs/*`).
3. Deployen:

   ```sh
   make stack-up
   ```

4. Verifikation per Browser-Login auf `https://<ipv4>/monitor/` mit neuem Passwort.

### (d) Uptime-Kuma Admin

1. Browser auf `https://<ipv4>/monitor/` (Basic-Auth durch).
2. **Settings > Security > Change Password** > altes Passwort, neues Passwort, „Save".
3. Kein Service-Restart nötig, Kuma persistiert sofort in seine SQLite unter `/mnt/data/uptime-kuma`.

### (e) restic-Passwort

**WARNUNG: restic-Passwort NIE rotieren ohne komplett neuen Bucket - alte Snapshots werden mit dem neuen Passwort unentschlüsselbar und damit dauerhaft verloren.**

Wenn Rotation wirklich nötig ist (z.B. bei Verdacht auf Kompromittierung):

1. Neuen Bucket in Hetzner Object-Storage anlegen, neue S3-Credentials erzeugen.
2. Neues restic-Passwort generieren (z.B. `openssl rand -base64 32`).
3. SOPS-Secret-File aktualisieren, auf dem Server `/etc/restic/env` neu schreiben.
4. `restic init` gegen den neuen Bucket laufen lassen.
5. Ersten Backup-Lauf manuell triggern: `sudo systemctl start restic-backup.service`.
6. Restore-Drill verifiziert die neue Kette: `make restore-drill`.
7. Alten Bucket frühestens nach Ablauf des bisherigen Retention-Fensters löschen, damit ein historischer Restore noch möglich bleibt, solange das alte Passwort separat archiviert ist.

### Eskalation

Wenn nach (a) `tofu plan` plötzlich Drift zeigt: Token hat falschen Scope (Read-only statt Read+Write). Token mit korrektem Scope neu erzeugen.

---

## Anhang A: Logbuch

Wann immer ein Runbook-Schritt durchgeführt wurde: kurzer Eintrag in `docs/operations-log.md` mit Datum, Szenario, Dauer, Ergebnis. Hilft beim nächsten Mal.

Vorlage:

```
### 2026-XX-XX - Szenario N
- Trigger: ...
- Beobachtet: ...
- Gemacht: ...
- Verifikation: make smoke grün
- Dauer: 5 Minuten
- Lessons: ...
```

## Anhang B: Was nicht im Runbook steht

Bewusst ausgelassen, weil Stufe-2-Themen (siehe `betrieb/infrastruktur.html`):

- Multi-Server-Failover und Lastverteilung
- DR-Site-Switch
- Audit-Trail-Forensik
- Netzwerk-Segmentierung über zentralen Reverse-Proxy
- Sovereign-Cloud-Migration (eigener Migrations-Block in `betrieb/`)
- Pentest-Befund-Triage
