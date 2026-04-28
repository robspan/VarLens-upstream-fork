# Secrets mit SOPS und age

Per ADR-7 verwenden wir SOPS für Per-Wert-Verschlüsselung, age als Schlüssel-Lieferant. Damit liegen Secrets verschlüsselt im Repository. Nur wer einen passenden age-Private-Key hat, kann sie entschlüsseln.

## Voraussetzungen

```sh
brew install age sops
```

## Erstes Setup für einen Maintainer

1. Eigenen age-Key erzeugen:

   ```sh
   mkdir -p ~/.config/sops/age
   age-keygen -o ~/.config/sops/age/keys.txt
   ```

   Der Befehl gibt einen Public-Key auf der Konsole aus, etwa:
   `age1pvqt8hdwslmkrkax5tl7cpdepszaj3z8smm4psgz6cn75qy77d0spfk7ht`.

2. Public-Key in `.sops.yaml` ergänzen, falls noch nicht aufgeführt:

   ```yaml
   creation_rules:
     - path_regex: secrets/.*\.ya?ml$
       age: >-
         age1pvqt8hdwslmkrkax5tl7cpdepszaj3z8smm4psgz6cn75qy77d0spfk7ht,
         age1<NEUER_KEY>
   ```

3. Bestehende Secret-Dateien um den neuen Recipient erweitern:

   ```sh
   sops updatekeys secrets/example.yaml
   ```

## Workflows

### Editieren einer verschlüsselten Datei

```sh
sops secrets/example.yaml
```

Öffnet die Datei im Klartext im Editor (Default-Editor aus `$EDITOR`). Beim Speichern verschlüsselt SOPS automatisch.

### Anzeigen einer verschlüsselten Datei

```sh
sops -d secrets/example.yaml
```

### Neue Secret-Datei erstellen

```sh
echo "my_secret: REPLACE" > secrets/neue-datei.yaml
sops --encrypt --in-place secrets/neue-datei.yaml
```

Oder direkt SOPS öffnen lassen und Inhalt eingeben:

```sh
sops secrets/neue-datei.yaml
```

### Inhalt im Skript verwenden

Beispiel für ein Backup-Skript:

```sh
export RESTIC_PASSWORD=$(sops -d --extract '["restic_password"]' secrets/example.yaml)
```

## Was wir verschlüsseln

| Datei | Inhalt |
|---|---|
| `secrets/example.yaml` | Vorlage mit restic-Passwort, Object-Storage-Credentials, Heartbeat-URL |

`secrets/example.yaml` ist absichtlich mit Platzhalter-Werten verschlüsselt - die Struktur dient als Referenz für eigene Secret-Dateien.

## Schlüssel-Wechsel

Wenn ein Maintainer das Repository verlässt:

1. Den entsprechenden Public-Key aus `.sops.yaml` entfernen.
2. Alle verschlüsselten Dateien neu verschlüsseln:

   ```sh
   for f in secrets/*.yaml; do sops updatekeys "$f"; done
   ```

3. Alle Secret-Werte rotieren - der ehemalige Maintainer hatte sie schließlich im Klartext.

## Hetzner Object Storage als restic-Ziel

Für den Backup-Pfad (siehe `docs/runbook.md`):

1. In der Hetzner Console unter Object Storage einen Bucket erstellen, zum Beispiel `varlens-pilot-backup`.
2. Access-Credentials (Access-Key + Secret-Key) generieren.
3. Werte in `secrets/example.yaml` (oder einer eigenen Datei) eintragen via `sops`.
4. Backup-Skript liest die Werte zur Laufzeit, exportiert sie als Umgebungsvariablen für restic.
