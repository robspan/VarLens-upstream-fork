#!/usr/bin/env python3
"""
Procedural setup of heartbeat monitoring for the restic backup job.

What it does:
  1. Ensures Uptime Kuma is running and an admin account exists
     (POST /api/setup on first call, idempotent).
  2. Creates - if not present - a push monitor "varlens-backup",
     directly via SQLite INSERT into the Kuma database in the container.
  3. Restarts the Kuma container so the new monitor is registered.
  4. Writes the heartbeat URL to /etc/restic/env (key HEARTBEAT_URL).
     The backup script varlens-backup.sh calls the URL via curl after a
     successful run so that Kuma registers the push.
  5. Triggers a backup run for verification and checks that Kuma actually
     saw the heartbeat (status set to 'up').

Usage:
  IP=<ipv4> SSH_KEY=~/.ssh/varlens-tofu KUMA_ADMIN_USER=admin \\
  KUMA_ADMIN_PASSWORD=varlens-konzept ./scripts/setup-monitoring.py

Idempotent: can run multiple times without breaking.
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

# bcrypt hash for "varlens-konzept" (cost 14, $2a$). Also used by Caddy
# basic_auth — same Concept Pilot default credentials.
# The adopter changes this password after the first login in Kuma (UI > Settings
# > Security > Change Password). The Caddy hash can be updated independently via
# `docker exec caddy caddy hash-password`.
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
        fail(f"SSH command failed ({proc.returncode}): {out}")
    return proc.returncode, out


def ssh_stdout_only(ip: str, key: Path, command: str, timeout: int = 60, *, check: bool = True) -> tuple[int, str, str]:
    """Like ssh(), but with stdout and stderr separated. Important when the
    output is further processed (e.g. the /etc/restic/env body) — otherwise
    error messages end up inside the body."""
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
    if check and proc.returncode != 0:
        fail(f"SSH command failed ({proc.returncode}): {proc.stderr or proc.stdout}")
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def ssh_with_stdin(ip: str, key: Path, command: str, stdin: str, timeout: int = 60, *, check: bool = True) -> tuple[int, str]:
    """Sends stdin via pipe to the SSH remote command. Used to transfer
    secrets (env file body) safely — never via argv, otherwise they would
    leak via `ps auxww`."""
    proc = subprocess.run(
        [
            "ssh", "-i", str(key),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"ConnectTimeout={timeout}",
            f"deploy@{ip}",
            command,
        ],
        input=stdin, capture_output=True, text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    if check and proc.returncode != 0:
        fail(f"SSH command failed ({proc.returncode}): {out}")
    return proc.returncode, out


def random_push_token(length: int = 16) -> str:
    """Kuma-compatible token: alphanumeric, column is VARCHAR(20)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> None:
    ip = os.environ.get("IP")
    if not ip:
        fail("IP variable not set (e.g. IP=178.104.176.148)")
    ssh_key = Path(os.environ.get("SSH_KEY", str(Path.home() / ".ssh" / "varlens-tofu"))).expanduser()
    if not ssh_key.exists():
        fail(f"SSH key {ssh_key} not found")
    admin_user = os.environ.get("KUMA_ADMIN_USER", DEFAULT_ADMIN_USER)
    admin_pw = os.environ.get("KUMA_ADMIN_PASSWORD", DEFAULT_ADMIN_PW)

    log(f"Target: {ip}, admin user: {admin_user}")
    log("Important: change default password 'varlens-konzept' after first login in Kuma UI > Settings > Security > Change Password.")

    # ----- 1. Is Kuma reachable? -----
    log("Checking reachability of Uptime Kuma on 127.0.0.1:3001 (from the server context)")
    rc, _ = ssh(
        ip, ssh_key,
        "curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3001/",
        check=False,
    )
    if rc != 0:
        fail("Uptime Kuma not reachable. Run `make stack-up` first.")

    # ----- 2. Admin setup (idempotent) -----
    log("Checking Kuma user table")
    rc, user_count_raw = ssh(
        ip, ssh_key,
        "docker exec uptime-kuma sqlite3 /app/data/kuma.db 'SELECT COUNT(*) FROM user;'",
    )
    user_count = int(user_count_raw.strip() or "0")
    log(f"  Existing Kuma users: {user_count}")
    if user_count == 0:
        # Kuma 1.x has no HTTP setup endpoint (everything via Socket.IO).
        # We write the admin user directly into the SQLite DB. Kuma's bcrypt
        # validation accepts $2a$ hashes (standard bcrypt). After restart,
        # Kuma picks up the user and the UI login works.
        log("Creating admin account directly in the Kuma DB")
        # SQL quote escape: double single quotes so usernames containing
        # ' do not lead to SQL injection.
        admin_user_sql = admin_user.replace("'", "''")
        sql = (
            f"INSERT INTO user (username, password, active) "
            f"VALUES ('{admin_user_sql}', '{DEFAULT_ADMIN_PW_BCRYPT}', 1);"
        )
        rc, out = ssh(
            ip, ssh_key,
            f"docker exec uptime-kuma sqlite3 /app/data/kuma.db \"{sql}\"",
        )
        log(f"  Admin user '{admin_user}' created (default password: see DEFAULT_ADMIN_PW in the script)")
        log("  Restarting Kuma so the user state is recognized")
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
            fail("Kuma did not come back after admin-insert restart")
    else:
        log("  Admin already exists, skipping setup")

    # ----- 3. Create or find push monitor -----
    log("Checking whether push monitor 'varlens-backup' exists")
    rc, token_raw = ssh(
        ip, ssh_key,
        (
            "docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT push_token FROM monitor WHERE name='{MONITOR_NAME}' LIMIT 1;\""
        ),
    )
    push_token = token_raw.strip()
    if push_token:
        log(f"  Monitor exists with token {push_token[:6]}...")
    else:
        push_token = random_push_token()
        log(f"  Creating new push monitor, token {push_token[:6]}...")
        # Kuma schema 1.x: type='push' triggers the /api/push/<token> endpoint.
        # interval = 60s, retry_interval = 60s, maxretries = 0 (one push per run is enough).
        # accepted_statuscodes_json stays at default '[200-299]' (not relevant for push).
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
            fail(f"Monitor insert failed: {out}")
        log("  Monitor inserted into DB, restarting Kuma so it loads it")
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
            fail("Kuma did not come back after restart")

    heartbeat_url = f"http://127.0.0.1:3001/api/push/{push_token}?status=up&msg=OK&ping="
    log(f"Heartbeat URL: http://127.0.0.1:3001/api/push/{push_token[:6]}...")

    # ----- 4. Update /etc/restic/env -----
    log("Writing HEARTBEAT_URL to /etc/restic/env")
    # sed would be fragile because & in sed's replacement is interpreted as a
    # match back-reference. We read the file, replace the entry in Python,
    # and atomically write it back via `sudo tee`.
    #
    # Important: read stdout/stderr separately — otherwise a possible
    # `cat: ... No such file or directory` message ends up in the body. ENOENT
    # (fresh machine without /etc/restic/env) is tolerable: we treat that as
    # an empty file and create it via tee.
    rc, current, _ = ssh_stdout_only(ip, ssh_key, "sudo cat /etc/restic/env", check=False)
    if rc != 0:
        current = ""
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
    # SECURITY: body contains secrets (S3 keys, restic password). NEVER pass
    # via argv (heredoc in command string) — `ps auxww` shows the complete
    # ssh argv including the heredoc body. Use STDIN pipe instead.
    ssh_with_stdin(
        ip, ssh_key,
        "sudo tee /etc/restic/env >/dev/null && sudo chmod 0600 /etc/restic/env",
        stdin=new_body,
    )
    log("  /etc/restic/env updated")

    # ----- 5. Verification: send a heartbeat and check in Kuma -----
    log("Capturing current highest heartbeat id (baseline)")
    # Before the test push we store the highest existing heartbeat id so that
    # after the push we can verify that a *new* record was actually created —
    # not an old one from an earlier run that "looks old but is there".
    rc, baseline_raw = ssh(
        ip, ssh_key,
        (
            "docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT COALESCE(MAX(id), 0) FROM heartbeat WHERE monitor_id=(SELECT id FROM monitor WHERE name='{MONITOR_NAME}');\""
        ),
        check=False,
    )
    try:
        baseline_id = int((baseline_raw or "0").strip() or "0")
    except ValueError:
        baseline_id = 0
    log(f"  Baseline heartbeat id: {baseline_id}")

    log("Sending test heartbeat (with retry; Kuma may need a moment after restart)")
    # Test URL has its own query (status=up&msg=test), not the persistent one.
    test_url = f"http://127.0.0.1:3001/api/push/{push_token}?status=up&msg=test&ping=1"
    push_ok = False
    for attempt in range(5):
        rc, _ = ssh(
            ip, ssh_key,
            f'curl -fsS --max-time 10 -o /dev/null "{test_url}"',
            check=False,
        )
        if rc == 0:
            push_ok = True
            break
        if attempt < 4:
            time.sleep(2)
    if not push_ok:
        fail("Test heartbeat push failed after 5 attempts — Kuma may not have loaded the monitor.")
    time.sleep(2)
    log("Verifying that Kuma sees the heartbeat")
    rc, status = ssh(
        ip, ssh_key,
        (
            "docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT id FROM heartbeat WHERE monitor_id=(SELECT id FROM monitor WHERE name='{MONITOR_NAME}') ORDER BY id DESC LIMIT 1;\""
        ),
        check=False,
    )
    latest_id = 0
    if rc == 0 and status.strip():
        try:
            latest_id = int(status.strip())
        except ValueError:
            latest_id = 0
    if latest_id > baseline_id:
        log(f"  Kuma received heartbeat (heartbeat id {latest_id} > baseline {baseline_id})")
    else:
        log(f"  WARNING: no new heartbeat record in Kuma (latest={latest_id}, baseline={baseline_id}) — Kuma may need a moment.")

    # ----- 6. Summary -----
    print()
    print("=" * 70)
    print("Heartbeat monitoring set up")
    print("=" * 70)
    print(f"  Monitor name:    {MONITOR_NAME}")
    print(f"  Push token:      {push_token[:6]}... (in Kuma DB)")
    print(f"  Heartbeat URL:   in /etc/restic/env (HEARTBEAT_URL)")
    print(f"  Kuma UI:         https://<server>/monitor/")
    print(f"  Kuma UI login:   admin / <default password: see DEFAULT_ADMIN_PW in the script>")
    print()
    print("The next backup run will ping automatically. Manual test:")
    print(f"  ssh -i {ssh_key} deploy@{ip} 'sudo systemctl start restic-backup.service'")
    print("=" * 70)


if __name__ == "__main__":
    main()
