#!/usr/bin/env python3
"""
Prozedurale Einrichtung des Heartbeat-Monitorings für den restic-Backup-Job.

Was es tut:
  1. Stellt sicher dass Uptime Kuma läuft und ein Admin-Account existiert
     (POST /api/setup beim Erstaufruf, idempotent).
  2. Legt - falls nicht vorhanden - einen Push-Monitor "varlens-backup" an,
     direkt per SQLite-INSERT in die Kuma-Datenbank im Container.
  3. Startet den Kuma-Container neu, damit der neue Monitor registriert wird.
  4. Schreibt die Heartbeat-URL nach /etc/restic/env (Schlüssel HEARTBEAT_URL).
     Das Backup-Skript varlens-backup.sh ruft die URL nach erfolgreichem Lauf
     curl-mäßig auf, so dass Kuma den Push registriert.
  5. Triggert einen Backup-Lauf zur Verifikation und prüft dass Kuma den
     Heartbeat tatsächlich gesehen hat (Status auf 'up').

Aufruf:
  IP=<ipv4> SSH_KEY=~/.ssh/varlens-tofu KUMA_ADMIN_USER=admin \\
  KUMA_ADMIN_PASSWORD=varlens-konzept ./scripts/setup-monitoring.py

Idempotent: kann mehrfach laufen ohne kaputt zu gehen.
"""
from __future__ import annotations

import json
import os
import secrets
import string
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PW = "varlens-konzept"
MONITOR_NAME = "varlens-backup"

# bcrypt-Hash für "varlens-konzept" (Cost 14, $2a$). Wird auch von Caddy
# basic_auth verwendet — gleiche Konzept-Pilot-Default-Credentials.
# Adopter ändert dieses Passwort nach dem ersten Login in Kuma (UI > Settings
# > Security > Change Password). Der Caddy-Hash kann unabhängig per
# `docker exec caddy caddy hash-password` aktualisiert werden.
DEFAULT_ADMIN_PW_BCRYPT = "$2a$14$6QBIGJyJFZMJIomvheSxvOUokBVZsvz03snLpmL7auY8aBmxVfNKy"


def log(msg: str) -> None:
    print(f"\033[36m[setup-monitoring]\033[0m {msg}", flush=True)


def fail(msg: str, code: int = 1) -> "None":
    print(f"\033[31m[setup-monitoring]\033[0m {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def ssh(ip: str, key: Path, command: str, timeout: int = 60, *, check: bool = True) -> tuple[int, str]:
    proc = subprocess.run(
        [
            "ssh", "-i", str(key),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"ConnectTimeout={timeout}",
            f"deploy@{ip}",
            command,
        ],
        capture_output=True, text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    if check and proc.returncode != 0:
        fail(f"SSH-Befehl fehlgeschlagen ({proc.returncode}): {out}")
    return proc.returncode, out


def random_push_token(length: int = 16) -> str:
    """Kuma-kompatible Token: alphanumerisch, Spalte ist VARCHAR(20)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> None:
    ip = os.environ.get("IP")
    if not ip:
        fail("IP-Variable nicht gesetzt (z.B. IP=178.104.176.148)")
    ssh_key = Path(os.environ.get("SSH_KEY", str(Path.home() / ".ssh" / "varlens-tofu"))).expanduser()
    if not ssh_key.exists():
        fail(f"SSH-Key {ssh_key} nicht gefunden")
    admin_user = os.environ.get("KUMA_ADMIN_USER", DEFAULT_ADMIN_USER)
    admin_pw = os.environ.get("KUMA_ADMIN_PASSWORD", DEFAULT_ADMIN_PW)

    log(f"Ziel: {ip}, Admin-User: {admin_user}")

    # ----- 1. Kuma erreichbar? -----
    log("Prüfe Erreichbarkeit von Uptime Kuma auf 127.0.0.1:3001 (im Server-Kontext)")
    rc, _ = ssh(
        ip, ssh_key,
        "curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3001/",
        check=False,
    )
    if rc != 0:
        fail("Uptime Kuma nicht erreichbar. Erst `make stack-up` ausführen.")

    # ----- 2. Admin-Setup (idempotent) -----
    log("Prüfe Kuma-User-Tabelle")
    rc, user_count_raw = ssh(
        ip, ssh_key,
        "docker exec uptime-kuma sqlite3 /app/data/kuma.db 'SELECT COUNT(*) FROM user;'",
    )
    user_count = int(user_count_raw.strip() or "0")
    log(f"  Bestehende Kuma-User: {user_count}")
    if user_count == 0:
        # Kuma 1.x hat keinen HTTP-Setup-Endpoint (alles über Socket.IO).
        # Wir schreiben den Admin-User direkt in die SQLite-DB. Kuma's bcrypt-
        # Validierung akzeptiert $2a$-Hashes (Standard bcrypt). Nach Restart
        # nimmt Kuma den User auf und der UI-Login funktioniert.
        log("Lege Admin-Account direkt in der Kuma-DB an")
        sql = (
            f"INSERT INTO user (username, password, active) "
            f"VALUES ('{admin_user}', '{DEFAULT_ADMIN_PW_BCRYPT}', 1);"
        )
        rc, out = ssh(
            ip, ssh_key,
            f"docker exec uptime-kuma sqlite3 /app/data/kuma.db \"{sql}\"",
        )
        log(f"  Admin-User '{admin_user}' angelegt (Passwort: varlens-konzept)")
        log("  Restarte Kuma damit der User-Status erkannt wird")
        ssh(ip, ssh_key, "cd /mnt/data/app && docker compose restart uptime-kuma")
        for _ in range(30):
            rc, _ = ssh(
                ip, ssh_key,
                "curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:3001/",
                check=False,
            )
            if rc == 0:
                break
            time.sleep(2)
    else:
        log("  Admin existiert bereits, überspringe Setup")

    # ----- 3. Push-Monitor anlegen oder wiederfinden -----
    log("Prüfe ob Push-Monitor 'varlens-backup' existiert")
    rc, token_raw = ssh(
        ip, ssh_key,
        (
            "docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT push_token FROM monitor WHERE name='{MONITOR_NAME}' LIMIT 1;\""
        ),
    )
    push_token = token_raw.strip()
    if push_token:
        log(f"  Monitor existiert mit Token {push_token[:6]}…")
    else:
        push_token = random_push_token()
        log(f"  Lege neuen Push-Monitor an, Token {push_token[:6]}…")
        # Kuma-Schema 1.x: type='push' triggert den /api/push/<token>-Endpoint.
        # interval = 60s, retry_interval = 60s, maxretries = 0 (ein Push pro Lauf reicht).
        # accepted_statuscodes_json bleibt Default '[200-299]' (nicht relevant für push).
        sql = (
            "INSERT INTO monitor (name, type, active, interval, retry_interval, "
            "maxretries, push_token, weight, accepted_statuscodes_json, method, "
            "ignore_tls, upside_down, maxredirects, expiry_notification, "
            "gamedig_given_port_only, kafka_producer_ssl, kafka_producer_allow_auto_topic_creation, "
            "timeout, packet_size, resend_interval, grpc_enable_tls, invert_keyword) "
            f"VALUES ('{MONITOR_NAME}', 'push', 1, 60, 60, 0, '{push_token}', 2000, "
            "'[\"200-299\"]', 'GET', 0, 0, 10, 1, 1, 0, 0, 0, 56, 0, 0, 0);"
        )
        rc, out = ssh(
            ip, ssh_key,
            f"docker exec uptime-kuma sqlite3 /app/data/kuma.db \"{sql}\"",
            check=False,
        )
        if rc != 0:
            fail(f"Monitor-Insert fehlgeschlagen: {out}")
        log("  Monitor in DB eingefügt, restarte Kuma damit er ihn lädt")
        rc, out = ssh(
            ip, ssh_key,
            "cd /mnt/data/app && docker compose restart uptime-kuma",
        )
        # Wait for Kuma to be back.
        for _ in range(30):
            rc, _ = ssh(
                ip, ssh_key,
                "curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:3001/",
                check=False,
            )
            if rc == 0:
                break
            time.sleep(2)
        else:
            fail("Kuma kam nach Restart nicht zurück")

    heartbeat_url = f"http://127.0.0.1:3001/api/push/{push_token}?status=up&msg=OK&ping="
    log(f"Heartbeat-URL: http://127.0.0.1:3001/api/push/{push_token[:6]}…")

    # ----- 4. /etc/restic/env aktualisieren -----
    log("Schreibe HEARTBEAT_URL nach /etc/restic/env")
    # sed wäre fragil weil & in der Replacement von sed als Match-Backreference
    # interpretiert wird. Wir lesen die Datei, ersetzen den Eintrag in Python,
    # und schreiben sie atomar zurück über `sudo tee`.
    rc, current = ssh(ip, ssh_key, "sudo cat /etc/restic/env")
    new_lines = []
    replaced = False
    for line in current.splitlines():
        if line.startswith("HEARTBEAT_URL="):
            new_lines.append(f"HEARTBEAT_URL={heartbeat_url}")
            replaced = True
        else:
            new_lines.append(line)
    if not replaced:
        new_lines.append(f"HEARTBEAT_URL={heartbeat_url}")
    new_body = "\n".join(new_lines) + "\n"
    rc, out = ssh(
        ip, ssh_key,
        (
            "sudo tee /etc/restic/env >/dev/null <<'ENVEOF'\n"
            f"{new_body}"
            "ENVEOF\n"
            "sudo chmod 0600 /etc/restic/env"
        ),
    )
    log("  /etc/restic/env aktualisiert")

    # ----- 5. Verifikation: einen Heartbeat schicken und in Kuma prüfen -----
    log("Sende Test-Heartbeat")
    # Test-URL hat eigene Query (status=up&msg=test), nicht die persistente.
    test_url = f"http://127.0.0.1:3001/api/push/{push_token}?status=up&msg=test&ping=1"
    ssh(ip, ssh_key, f'curl -fsS --max-time 10 -o /dev/null "{test_url}"')
    time.sleep(2)
    log("Verifiziere dass Kuma den Heartbeat sieht")
    rc, status = ssh(
        ip, ssh_key,
        (
            "docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT id FROM heartbeat WHERE monitor_id=(SELECT id FROM monitor WHERE name='{MONITOR_NAME}') ORDER BY id DESC LIMIT 1;\""
        ),
        check=False,
    )
    if rc == 0 and status.strip():
        log(f"  Kuma hat Heartbeat empfangen (heartbeat-id {status.strip()})")
    else:
        log("  WARNUNG: kein Heartbeat-Datensatz in Kuma gefunden — Kuma braucht evtl. einen Moment.")

    # ----- 6. Summary -----
    print()
    print("=" * 70)
    print("Heartbeat-Monitoring eingerichtet")
    print("=" * 70)
    print(f"  Monitor-Name:    {MONITOR_NAME}")
    print(f"  Push-Token:      {push_token[:6]}… (in Kuma-DB)")
    print(f"  Heartbeat-URL:   in /etc/restic/env (HEARTBEAT_URL)")
    print(f"  Kuma-UI:         https://<server>/monitor/  (Login admin / varlens-konzept)")
    print()
    print("Nächster Backup-Lauf pingt automatisch. Manueller Test:")
    print(f"  ssh -i {ssh_key} deploy@{ip} 'sudo systemctl start restic-backup.service'")
    print("=" * 70)


if __name__ == "__main__":
    main()
