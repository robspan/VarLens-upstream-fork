# Backup und Restore mit restic

Konzept-Pilot sichert das Daten-Volume täglich nach Hetzner Object Storage. Der Pfad ist:
`/mnt/data` (alle Container-Daten) → restic-Repository auf S3-API → Snapshots mit Retention.

Plan-Bezug: `konzept/infrastruktur.html` §infrastruktur2 fordert restic-Backup mit Heartbeat
und Restore-Übung als Gate-Kriterium.

## Erst-Setup nach Server-Provisionierung

Cloud-init installiert auf dem Server bereits:

- restic-Binary in `/usr/local/bin/restic`
- Backup-Skript `/usr/local/bin/varlens-backup.sh`
- systemd-Service `restic-backup.service`
- systemd-Timer `restic-backup.timer` (täglich 02:30)
- Vorlage `/etc/restic/env.example`

Was der Maintainer einmalig nachträglich machen muss:

### 1. Hetzner Object Storage Bucket erstellen

In der Hetzner Console:

1. Object Storage > Buckets > „Bucket erstellen"
2. Name: `varlens-pilot-backup` (oder Namen merken für Step 4)
3. Standort: zum Beispiel `Falkenstein` (gleicher Standort wie der Server reduziert Latenz)
4. ACL: Privat
5. Object Lock: für Konzept-Stand nicht nötig (siehe ADR-8 - kommt in Stufe 2)

### 2. Object Storage Credentials erzeugen

In der Hetzner Console:

1. Sicherheit > Object Storage Credentials > Neue Credentials
2. Access-Key und Secret-Key notieren - werden nur einmal angezeigt
3. Berechtigung: Read+Write auf den oben erstellten Bucket beschränken (sofern Hetzner diese Granularität bietet, sonst Account-weit)

### 3. restic-Passwort generieren

```sh
openssl rand -base64 32
```

Wert merken - ohne dieses Passwort sind die Backups nicht wiederherstellbar.

### 4. /etc/restic/env auf dem Server befüllen

```sh
make ssh
sudo cp /etc/restic/env.example /etc/restic/env
sudo chmod 0600 /etc/restic/env
sudo vim /etc/restic/env
```

Werte ersetzen:

```
RESTIC_REPOSITORY=s3:s3.eu-central-003.hetznerobjects.com/varlens-pilot-backup
RESTIC_PASSWORD=<base64-Wert aus Schritt 3>
AWS_ACCESS_KEY_ID=<Access-Key aus Schritt 2>
AWS_SECRET_ACCESS_KEY=<Secret-Key aus Schritt 2>
HEARTBEAT_URL=  # Optional: Uptime-Kuma-Push-URL, siehe Heartbeat-Sektion
BACKUP_PATHS=/mnt/data
RETENTION_KEEP_DAILY=7
RETENTION_KEEP_WEEKLY=4
RETENTION_KEEP_MONTHLY=6
```

### 5. Erst-Lauf manuell anstoßen

```sh
sudo systemctl start restic-backup.service
sudo journalctl -u restic-backup.service -f
```

Beim ersten Lauf initialisiert restic das Repository (legt einen verschlüsselten Container im Bucket an), dann läuft das eigentliche Backup. Ab jetzt läuft der Timer täglich um 02:30.

### 6. Heartbeat einrichten (optional aber empfohlen)

Uptime Kuma kann per Push-Monitor den Erfolg überwachen:

1. http://<ip>/monitor/ öffnen
2. Add New Monitor > Type: Push
3. Push URL kopieren
4. In `/etc/restic/env` die Variable `HEARTBEAT_URL` auf diese URL setzen
5. Heartbeat-Interval auf 25 Stunden setzen (Backup läuft 24-stündlich, mit Toleranz)

Wenn Backup einen Tag aussetzt, schlägt der Push-Monitor an.

## Verifikation

Manueller Lauf zum Testen:

```sh
make ssh
sudo systemctl start restic-backup.service
sudo journalctl -u restic-backup.service --since "1 minute ago"
```

Snapshots auflisten:

```sh
sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'
```

Timer-Status:

```sh
systemctl status restic-backup.timer
systemctl list-timers --all | grep restic
```

## Restore

Für Konzept-Pilot existiert ein einfaches Restore-Skript: `scripts/restore.sh`
(im Repository). Es liest dieselbe `/etc/restic/env` und stellt nach `/tmp/restore-...`
wieder her. Use cases:

```sh
# Snapshots auflisten:
sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'

# Letzten Snapshot wiederherstellen nach /tmp/restore-konzept:
sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore-konzept'

# Spezifische Datei wiederherstellen:
sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore --include /mnt/data/uptime-kuma'
```

## Restore-Übung (Gate-Kriterium)

Plan §infrastruktur2 fordert „mindestens eine Restore-Übung mit Test-Daten ist protokolliert".
Protokoll der ersten Übung: `docs/restore-protokoll.md` (kommt nach erstem Drill).

Pflicht-Wiederholung: nach jeder größeren Plan- oder Schema-Änderung, mindestens einmal vor dem Migrations-Block.

## Schutz gegen Datenverlust

Was ist kein Backup-Replacement?

- `make stop`: Server pausiert, Volume bleibt - kein Backup nötig.
- `make down`: zerstört Volume! Vorher unbedingt frischer Snapshot, dann Bucket-Inhalt sichern.
- Server-Replace durch cloud-init-Änderung: Volume bleibt, kein Backup nötig.

Bewusst _nicht_ in Konzept-Stand:

- Object Lock auf Bucket: Stufe 2 (§adr8).
- Append-Only-Identitäten (separate Schreib-/Prune-Rollen): Stufe 2.
- Off-Host-Heartbeat-Persistierung: Stufe 2.

Brücken-Klausel: Object Lock kann nur bei Bucket-Erstellung aktiviert werden. Wenn dieser
Pilot-Bucket in Stufe 2 weitergenutzt werden soll, muss er bei Bucket-Erstellung mit Object
Lock vorbereitet werden. Konzept-Pilot bewusst ohne, weil hier nur Test-Daten liegen.
