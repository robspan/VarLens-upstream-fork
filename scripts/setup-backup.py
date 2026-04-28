#!/usr/bin/env python3
"""
Procedural backup setup for the Konzept-Pilot.

Steps:
1. Read hcloud_token from terraform.tfvars (or HCLOUD_TOKEN env).
2. Get-or-create S3 credentials for the Hetzner project via Cloud API.
   Falls back to RESTIC_S3_ACCESS_KEY/SECRET env vars if API not supported.
3. Create the Object Storage Bucket via S3 API (PUT with AWS V4 signature).
4. Generate a strong restic password (32 bytes from os.urandom, base64).
5. SSH to the server and write /etc/restic/env with all values.
6. Trigger initial backup, wait for completion.
7. Print summary, suggest `make restore-drill` for verification.

Stdlib only - no external dependencies. Adopter-friendly: one command brings
the Konzept-Pilot from "infra deployed" to "backups running and verified".

Usage:
    HCLOUD_TOKEN=...       (or via terraform.tfvars)
    SERVER_IP=...          (or via tofu output)
    SSH_KEY=~/.ssh/...     (default ~/.ssh/varlens-tofu)

    ./scripts/setup-backup.py

Optional override (skip auto S3-credential creation):
    RESTIC_S3_ACCESS_KEY=...
    RESTIC_S3_SECRET_KEY=...
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TFVARS = REPO_ROOT / "tofu" / "environments" / "pilot" / "terraform.tfvars"
TOFU_DIR = REPO_ROOT / "tofu" / "environments" / "pilot"

DEFAULT_REGION = "fsn1"
DEFAULT_ENDPOINT = "fsn1.your-objectstorage.com"
DEFAULT_BUCKET = "varlens-pilot-backup"
DEFAULT_CRED_NAME = "varlens-pilot-restic"
DEFAULT_SSH_KEY = Path.home() / ".ssh" / "varlens-tofu"


def log(msg: str) -> None:
    print(f"[setup-backup] {msg}", flush=True)


def fail(msg: str, code: int = 1) -> "None":
    print(f"[setup-backup] FEHLER: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def read_tfvar(key: str) -> str | None:
    if not TFVARS.exists():
        return None
    pattern = re.compile(rf'^\s*{re.escape(key)}\s*=\s*"([^"]+)"\s*$', re.MULTILINE)
    match = pattern.search(TFVARS.read_text())
    return match.group(1) if match else None


def hcloud_request(token: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = f"https://api.hetzner.cloud{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "varlens-setup-backup/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"raw": body.decode("utf-8", errors="replace")}


def hcloud_create_s3_credentials(token: str, name: str) -> dict | None:
    """Create S3 credentials via Hetzner Cloud API. Returns None if API not supported."""
    log(f"Erzeuge S3-Zugangsdaten in Hetzner Cloud API ({name})")
    code, body = hcloud_request(token, "POST", "/v1/object_storage/credentials", {"name": name})
    if code == 404:
        log("Hetzner Cloud API hat den Endpoint /v1/object_storage/credentials noch nicht freigeschaltet.")
        return None
    if code in (200, 201):
        return body
    log(f"  Antwort {code}: {body}")
    return None


def hcloud_list_s3_credentials(token: str) -> list[dict]:
    code, body = hcloud_request(token, "GET", "/v1/object_storage/credentials")
    if code in (200, 201) and isinstance(body, dict):
        return body.get("object_storage_credentials", []) or body.get("credentials", [])
    return []


# ----- AWS V4 signing (stdlib only) -----

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def s3_put_bucket(endpoint: str, region: str, access: str, secret: str, bucket: str) -> tuple[int, str]:
    """PUT /<bucket> against the S3-compatible endpoint, signed with AWS V4."""
    host = endpoint
    method = "PUT"
    canonical_uri = f"/{bucket}"
    canonical_query = ""
    payload_hash = hashlib.sha256(b"").hexdigest()

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    canonical_headers = (
        f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"

    canonical_request = "\n".join([
        method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash,
    ])

    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])

    key = _signing_key(secret, date_stamp, region, "s3")
    signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(
        f"https://{host}{canonical_uri}",
        method=method,
        headers={
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def s3_head_bucket(endpoint: str, region: str, access: str, secret: str, bucket: str) -> int:
    """HEAD /<bucket> to check if bucket exists. Same V4 signing."""
    host = endpoint
    method = "HEAD"
    canonical_uri = f"/{bucket}"
    payload_hash = hashlib.sha256(b"").hexdigest()
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    canonical_headers = (
        f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    key = _signing_key(secret, date_stamp, region, "s3")
    signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req = urllib.request.Request(
        f"https://{host}{canonical_uri}",
        method=method,
        headers={
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def s3_head_object(endpoint: str, region: str, access: str, secret: str, bucket: str, key_name: str) -> int:
    """HEAD /<bucket>/<key>. Liefert 200 wenn Objekt existiert, 404 sonst."""
    host = endpoint
    method = "HEAD"
    canonical_uri = f"/{bucket}/{key_name}"
    payload_hash = hashlib.sha256(b"").hexdigest()
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    canonical_headers = (
        f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    sigkey = _signing_key(secret, date_stamp, region, "s3")
    signature = hmac.new(sigkey, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req = urllib.request.Request(
        f"https://{host}{canonical_uri}",
        method=method,
        headers={
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


# ----- SSH helpers -----

def tofu_output(name: str) -> str:
    out = subprocess.run(
        ["tofu", f"-chdir={TOFU_DIR}", "output", "-raw", name],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def ssh_exec(ssh_key: Path, ip: str, cmd: str) -> tuple[int, str]:
    proc = subprocess.run(
        ["ssh", "-i", str(ssh_key), "-o", "BatchMode=yes",
         "-o", "StrictHostKeyChecking=accept-new", f"deploy@{ip}", cmd],
        capture_output=True, text=True,
    )
    return proc.returncode, (proc.stdout + proc.stderr)


def write_env_file(ssh_key: Path, ip: str, env: dict[str, str]) -> None:
    body = "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"
    log("Schreibe /etc/restic/env auf den Server")
    code, output = ssh_exec(
        ssh_key, ip,
        f"sudo install -d -m 0700 /etc/restic && sudo tee /etc/restic/env >/dev/null <<'ENVEOF'\n{body}ENVEOF\nsudo chmod 0600 /etc/restic/env"
    )
    if code != 0:
        fail(f"SSH-Schreiben fehlgeschlagen: {output}")


# ----- main -----

def main() -> None:
    # Modi:
    #   --reuse  : existierendes /etc/restic/env akzeptieren und Passwort wiederverwenden
    #   --force  : alles überschreiben, alter Repo wird unbrauchbar (NUR für Greenfield)
    #   default  : preflight prüft alles, fail loud wenn schon Setup vorhanden ist
    mode = "default"
    for arg in sys.argv[1:]:
        if arg == "--reuse":
            mode = "reuse"
        elif arg == "--force":
            mode = "force"
        elif arg in ("-h", "--help"):
            print(__doc__)
            print("Aufruf: setup-backup.py [--reuse|--force]")
            sys.exit(0)
        else:
            fail(f"Unbekanntes Argument: {arg}")

    token = os.environ.get("HCLOUD_TOKEN") or read_tfvar("hcloud_token")
    if not token:
        fail("HCLOUD_TOKEN nicht gesetzt und nicht in terraform.tfvars gefunden")

    ip = os.environ.get("SERVER_IP")
    if not ip:
        try:
            ip = tofu_output("ipv4")
        except subprocess.CalledProcessError:
            fail("Kein Server vorhanden. Erst `make up` ausführen.")
    log(f"Ziel-Server: {ip}")

    ssh_key = Path(os.environ.get("SSH_KEY", DEFAULT_SSH_KEY)).expanduser()
    if not ssh_key.exists():
        fail(f"SSH-Key {ssh_key} nicht gefunden")

    bucket = os.environ.get("BUCKET_NAME", DEFAULT_BUCKET)
    region = os.environ.get("BUCKET_REGION", DEFAULT_REGION)
    endpoint = os.environ.get("BUCKET_ENDPOINT", DEFAULT_ENDPOINT)

    # --- PREFLIGHT Schritt 1: server-seitiger Status ---
    log(f"Preflight: Mode={mode}, Bucket={bucket}, Server={ip}")

    # Existiert /etc/restic/env auf dem Server mit nicht-leerem RESTIC_PASSWORD?
    code, existing_env = ssh_exec(
        ssh_key, ip,
        "sudo cat /etc/restic/env 2>/dev/null | grep '^RESTIC_PASSWORD=' || true",
    )
    existing_password = ""
    if code == 0:
        line = existing_env.strip()
        if line.startswith("RESTIC_PASSWORD=") and len(line) > len("RESTIC_PASSWORD="):
            existing_password = line.split("=", 1)[1]
    env_exists = bool(existing_password)

    # --- S3 credentials ---
    access = os.environ.get("RESTIC_S3_ACCESS_KEY")
    secret = os.environ.get("RESTIC_S3_SECRET_KEY")

    if access and secret:
        log("Verwende S3-Zugangsdaten aus Umgebungs-Variablen (übersprungen Cloud-API-Anlage)")
    else:
        creds = hcloud_create_s3_credentials(token, DEFAULT_CRED_NAME)
        if creds is not None:
            access = (creds.get("object_storage_credential") or creds).get("access_key")
            secret = (creds.get("object_storage_credential") or creds).get("secret_key")
            if access and secret:
                log(f"  S3-Zugangsdaten erstellt, Access-Key {access[:8]}...")
            else:
                fail(f"Hetzner-API-Antwort enthält keinen Access-Key: {creds}")
        else:
            print("\n" + "=" * 70)
            print("Manueller Schritt nötig: Hetzner Cloud API hat den S3-Credentials-")
            print("Endpoint noch nicht freigeschaltet. Bitte einmalig in der Console:")
            print()
            print("  Hetzner Console > Sicherheit > S3-Zugangsdaten > Generieren")
            print()
            print("Danach erneut aufrufen:")
            print()
            print("  RESTIC_S3_ACCESS_KEY=... RESTIC_S3_SECRET_KEY=... make setup-backup")
            print("=" * 70)
            sys.exit(2)

    # --- PREFLIGHT Schritt 2: Bucket und Repo-Status ---
    log(f"Prüfe Bucket {bucket} auf {endpoint}")
    head = s3_head_bucket(endpoint, region, access, secret, bucket)
    if head == 200:
        bucket_state = "existiert (eigener Zugriff bestätigt)"
    elif head == 404:
        bucket_state = "fehlt"
    elif head == 403:
        bucket_state = "existiert, aber kein Zugriff (gehört anderem Account / falsche Creds)"
    else:
        bucket_state = f"unklar (HEAD-Status {head})"
    log(f"  Bucket: {bucket_state}")

    repo_initialized = False
    if head == 200:
        # Restic-Repo erkennt man am Vorhandensein des `config`-Objekts.
        cfg = s3_head_object(endpoint, region, access, secret, bucket, "config")
        repo_initialized = cfg == 200
        log(f"  Restic-Repo im Bucket: {'initialisiert' if repo_initialized else 'leer / nicht initialisiert'}")
    server_state = "/etc/restic/env vorhanden mit Passwort" if env_exists else "/etc/restic/env fehlt"
    log(f"  Server: {server_state}")

    # --- PREFLIGHT Schritt 3: Konsistenz-Entscheidung ---
    # Matrix:
    #  env_exists | repo_init | default     | --reuse                   | --force
    #  -----------+-----------+-------------+---------------------------+--------
    #  False      | False     | proceed     | proceed                   | proceed
    #  True       | False     | FAIL        | reuse pw, init bei Backup | überschreiben
    #  False      | True      | FAIL        | FAIL (kein pw zum reuse)  | überschreiben (= alte Snaps tot)
    #  True       | True      | FAIL        | reuse pw                  | überschreiben (= alte Snaps tot)
    if env_exists or repo_initialized:
        print("\n" + "=" * 70)
        print("Preflight-Detect: bestehende Backup-Artefakte gefunden")
        print("=" * 70)
        if env_exists:
            print(f"  • /etc/restic/env auf {ip} hat ein gesetztes RESTIC_PASSWORD.")
        if repo_initialized:
            print(f"  • Bucket {bucket} enthält ein initialisiertes restic-Repo (config-Objekt).")
        print()
        if mode == "default":
            print("Default-Modus bricht ab, um keine bestehenden Snapshots unbrauchbar zu machen.")
            print("Optionen:")
            print("  • setup-backup.py --reuse   bestehendes Passwort wiederverwenden (sicher)")
            print("  • setup-backup.py --force   alles überschreiben (ALLE alten Snapshots werden")
            print("                              unentschlüsselbar — nur bei bewusster Greenfield-Aktion)")
            print("=" * 70)
            sys.exit(3)
        if mode == "reuse" and not existing_password and repo_initialized:
            print("FEHLER: --reuse braucht ein existierendes /etc/restic/env mit RESTIC_PASSWORD,")
            print("        aber im Bucket liegt schon ein Repo. Du müsstest das alte Passwort manuell")
            print("        nach /etc/restic/env eintragen, oder mit --force neu starten.")
            print("=" * 70)
            sys.exit(3)
        print(f"Mode={mode}: fahre fort.")
        print("=" * 70)

    # --- Bucket anlegen, falls nötig ---
    if head == 404:
        log("Erstelle Bucket")
        code, body = s3_put_bucket(endpoint, region, access, secret, bucket)
        if code in (200, 201):
            log("  Bucket erfolgreich erstellt")
        else:
            fail(f"Bucket-Erstellung fehlgeschlagen ({code}): {body}")
    elif head == 403:
        fail("Bucket gehört einem anderen Account oder Credentials passen nicht.")
    elif head not in (200, 404):
        fail(f"Unerwartete Antwort bei Bucket-HEAD ({head})")

    # --- restic password: existing reusen, sonst neu generieren ---
    if existing_password and mode in ("default", "reuse"):
        restic_password = existing_password
        log("Bestehendes restic-Passwort wiederverwendet")
    else:
        restic_password = base64.b64encode(secrets.token_bytes(24)).decode("ascii")
        log("Generierte starkes restic-Passwort (24 zufällige Bytes, base64)")

    # --- write env on server ---
    env = {
        "RESTIC_REPOSITORY": f"s3:{endpoint}/{bucket}",
        "RESTIC_PASSWORD": restic_password,
        "AWS_ACCESS_KEY_ID": access,
        "AWS_SECRET_ACCESS_KEY": secret,
        "BACKUP_PATHS": "/mnt/data",
        "RETENTION_KEEP_DAILY": "7",
        "RETENTION_KEEP_WEEKLY": "4",
        "RETENTION_KEEP_MONTHLY": "6",
        "HEARTBEAT_URL": "",
    }
    write_env_file(ssh_key, ip, env)

    # --- initial backup ---
    log("Triggere ersten Backup-Lauf (initialisiert das Repository im Bucket)")
    code, output = ssh_exec(
        ssh_key, ip,
        "sudo systemctl start restic-backup.service && "
        "while sudo systemctl is-active --quiet restic-backup.service; do sleep 3; done && "
        "systemctl show restic-backup.service --property=Result --value"
    )
    if code != 0:
        fail(f"Backup-Service-Start fehlgeschlagen: {output}")
    if "success" not in output.strip().splitlines()[-1:]:
        log("WARNUNG: Backup-Service-Result nicht 'success'. Logs prüfen mit:")
        log(f"  ssh -i {ssh_key} deploy@{ip} 'sudo journalctl -u restic-backup.service --no-pager -n 50'")
    else:
        log("  Erst-Backup erfolgreich")

    # --- summary ---
    print()
    print("=" * 70)
    print("Backup-Setup abgeschlossen")
    print("=" * 70)
    print(f"  Bucket:          {bucket}")
    print(f"  Endpoint:        {endpoint}")
    print(f"  S3-Access-Key:   {access[:8]}... (auf Server in /etc/restic/env)")
    pw_status = "wiederverwendet aus /etc/restic/env" if existing_password and mode in ("default", "reuse") else "neu generiert (24 Bytes, base64)"
    print(f"  restic-Password: {pw_status}")
    print()
    print("Nächste Schritte:")
    print("  make restore-drill   # Verifikation: Backup-Restore-Pfad funktioniert")
    print("=" * 70)


if __name__ == "__main__":
    main()
