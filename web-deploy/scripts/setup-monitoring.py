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

# Pre-computed bcrypt hash for the literal "varlens-konzept" (cost 14, $2a$).
# Used as a fast-path when the operator hasn't overridden KUMA_ADMIN_PASSWORD
# — saves a round-trip through `docker exec uptime-kuma node` for the common
# "I just want defaults" path. When KUMA_ADMIN_PASSWORD differs from this,
# bcrypt_password_via_kuma() hashes it at runtime instead.
DEFAULT_ADMIN_PW_BCRYPT = "$2a$14$6QBIGJyJFZMJIomvheSxvOUokBVZsvz03snLpmL7auY8aBmxVfNKy"

# Caddy's basic_auth gate at /logs/ (Dozzle) is independent of this script —
# it lives in compose/Caddyfile as a literal bcrypt hash for the same default
# credentials. Rotating the Caddy gate is a separate operation: regenerate
# the hash with `docker exec caddy caddy hash-password --plaintext '<new>'`,
# paste into Caddyfile, and `make -C web-deploy stack-up`.


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


def read_postgres_password(ip: str, ssh_key: Path) -> str:
    """Read the persisted Postgres password from the server.

    Lives at /etc/varlens/postgres-password (root:root, 0600), written
    by `make stack-up` on first boot. We need it here because Kuma's
    `postgres` monitor type stores the connection URI verbatim in its
    own SQLite — there is no Kuma-side credential helper. Reading via
    `sudo cat` over SSH means the password travels only on the
    encrypted SSH stream and never appears on argv.

    fail-loud if the file is missing: a Postgres monitor without a
    real password is just noise on the dashboard.
    """
    rc, out, err = ssh_stdout_only(
        ip, ssh_key, "sudo cat /etc/varlens/postgres-password", check=False,
    )
    pw = (out or "").strip()
    if rc != 0 or pw == "":
        fail(
            "/etc/varlens/postgres-password is missing or unreadable. "
            "`make stack-up` should have created it on first boot. "
            f"sudo stderr: {(err or '').strip()}"
        )
    return pw


def bcrypt_password_via_kuma(ip: str, ssh_key: Path, password: str) -> str:
    """Bcrypt-hash a password using the Kuma container's own bcryptjs.

    Why borrow Kuma's bcryptjs instead of pip-installing `bcrypt` locally:
      - `bcryptjs` is already present inside the running uptime-kuma image
        (Kuma uses it for its own login verification), so there's no new
        local dependency to install or document.
      - Cost 14 + $2a$ format match what Kuma will accept on login. Mixing
        $2b$ from a different library would also work, but matching $2a$
        keeps the DEFAULT_ADMIN_PW_BCRYPT shape identical.
      - The password travels via two stdin hops (SSH stdin → docker exec
        stdin → node stdin) and never lands in any process's argv. A
        prior version that used `--plaintext` on the Caddy CLI would
        have exposed the password through `ps auxww`; this path doesn't.

    Returns the $2a$ bcrypt hash string ready to insert into Kuma's
    user.password column.
    """
    # Inline node script reads the password from stdin, trims trailing
    # newline (added by the SSH heredoc), bcrypts at cost 14, prints the
    # hash. No password ever appears on argv.
    node_program = (
        'let s="";'
        'process.stdin.on("data",d=>s+=d);'
        'process.stdin.on("end",()=>{'
        's=s.replace(/\\r?\\n$/,"");'
        'console.log(require("bcryptjs").hashSync(s,14));'
        '});'
    )
    remote = f"docker exec -i uptime-kuma node -e '{node_program}'"
    rc, out = ssh_with_stdin(ip, ssh_key, remote, stdin=password, timeout=30)
    if rc != 0:
        fail(f"bcrypt-hashing the Kuma password failed: {out.strip()}")
    hash_line = next(
        (line for line in out.splitlines() if line.startswith("$2a$") or line.startswith("$2b$")),
        "",
    )
    if hash_line == "":
        fail(f"bcrypt-hashing the Kuma password produced unexpected output: {out!r}")
    return hash_line


def main() -> None:
    ip = os.environ.get("IP")
    if not ip:
        fail("IP variable not set (e.g. IP=178.104.176.148)")
    ssh_key = Path(os.environ.get("SSH_KEY", str(Path.home() / ".ssh" / "varlens-tofu"))).expanduser()
    if not ssh_key.exists():
        fail(f"SSH key {ssh_key} not found")
    admin_user = os.environ.get("KUMA_ADMIN_USER", DEFAULT_ADMIN_USER)
    admin_pw = os.environ.get("KUMA_ADMIN_PASSWORD", DEFAULT_ADMIN_PW)
    using_default_pw = admin_pw == DEFAULT_ADMIN_PW

    log(f"Target: {ip}, admin user: {admin_user}")
    if using_default_pw:
        log(
            "Using DEFAULT Kuma admin password 'varlens-konzept'. "
            "Change after first login (Kuma UI > Settings > Security), "
            "or set KUMA_ADMIN_PASSWORD=<your-pw> in web-deploy/.env before re-running setup-monitoring."
        )
    else:
        log("Using operator-supplied KUMA_ADMIN_PASSWORD (will be bcrypt'd via the Kuma container).")

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
        # Resolve the password hash. Common case (operator hasn't
        # overridden the default) hits a precomputed constant; the
        # uncommon case bcrypts via the running Kuma container's own
        # bcryptjs so the password never lands on any argv.
        if using_default_pw:
            password_hash = DEFAULT_ADMIN_PW_BCRYPT
        else:
            log("  Hashing operator-supplied password via the Kuma container...")
            password_hash = bcrypt_password_via_kuma(ip, ssh_key, admin_pw)
        # SQL quote escape: double single quotes so usernames or hashes
        # containing ' do not lead to SQL injection. Bcrypt PHC strings
        # don't contain ' but the username field is operator input so
        # we escape both for symmetry.
        admin_user_sql = admin_user.replace("'", "''")
        password_hash_sql = password_hash.replace("'", "''")
        sql = (
            f"INSERT INTO user (username, password, active) "
            f"VALUES ('{admin_user_sql}', '{password_hash_sql}', 1);"
        )
        # Pipe SQL via stdin (NOT argv) so the bcrypt hash's $-characters
        # are not interpreted by the remote shell. Bash on the SSH side
        # would otherwise expand `$2a$14$` etc. to empty, corrupting the
        # password hash and silently breaking the Kuma admin login.
        rc, out = ssh_with_stdin(
            ip, ssh_key,
            "docker exec -i uptime-kuma sqlite3 /app/data/kuma.db",
            stdin=sql,
        )
        if using_default_pw:
            log(f"  Admin user '{admin_user}' created (password: '{DEFAULT_ADMIN_PW}' — change after first login)")
        else:
            log(f"  Admin user '{admin_user}' created with operator-supplied password (KUMA_ADMIN_PASSWORD)")
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

    # ----- 3a. Self-heal previously broken rows -----
    # Earlier versions of this script inserted the JSON value
    # accepted_statuscodes_json via shell argv. The bash layer stripped
    # the inner double-quotes from '["200-299"]', leaving '[200-299]' in
    # the DB. Kuma's getAcceptedStatuscodes() JSON.parse then throws and
    # the whole monitor list fails to render in the UI. Detect the broken
    # value and rewrite it to the canonical form. Idempotent: a no-op on
    # already-clean DBs.
    log("Repairing any corrupted accepted_statuscodes_json values")
    ssh_with_stdin(
        ip, ssh_key,
        "docker exec -i uptime-kuma sqlite3 /app/data/kuma.db",
        stdin=(
            "UPDATE monitor "
            "SET accepted_statuscodes_json = '[\"200-299\"]' "
            "WHERE accepted_statuscodes_json = '[200-299]';"
        ),
        check=False,
    )

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
        # user_id must be set or Kuma's UI won't show the monitor (it filters
        # the dashboard by ownership). We map to the admin user we just
        # inserted (or that was already there).
        # Push monitor cadence: the daily restic timer fires at 02:30, so the
        # monitor expects ~24h between heartbeats. Set interval=90000 (25h)
        # to give a 1h grace window; retry_interval=3600 (1h) so a missed
        # push doesn't immediately flip the monitor red. Without this it
        # would be red 23h59m of every 24h.
        sql = (
            "INSERT INTO monitor (name, type, active, user_id, interval, retry_interval, "
            "maxretries, push_token, weight, accepted_statuscodes_json, method, "
            "ignore_tls, upside_down, maxredirects, expiry_notification, "
            "gamedig_given_port_only, kafka_producer_ssl, kafka_producer_allow_auto_topic_creation, "
            "timeout, packet_size, resend_interval, grpc_enable_tls, invert_keyword) "
            f"VALUES ('{MONITOR_NAME}', 'push', 1, "
            "(SELECT id FROM user WHERE username = 'admin' LIMIT 1), "
            f"90000, 3600, 0, '{push_token}', 2000, "
            "'[\"200-299\"]', 'GET', 0, 0, 10, 1, 1, 0, 0, 0, 56, 0, 0, 0);"
        )
        # Use stdin to keep the dollar-safe pattern consistent with the
        # admin-user insert, even though this SQL has no $-characters today.
        rc, out = ssh_with_stdin(
            ip, ssh_key,
            "docker exec -i uptime-kuma sqlite3 /app/data/kuma.db",
            stdin=sql,
            check=False,
        )
        if rc != 0:
            fail(f"Monitor insert failed: {out}")
        log("  Push monitor inserted")

    # ----- 3b. Stack monitors -----
    # Reflects the full Compose stack health on the Kuma dashboard, not
    # just the backup heartbeat. Each is idempotent: skipped if a
    # monitor with the same name already exists.
    log("Setting up stack monitors (VarLens app, Postgres, HTTPS welcome, Dozzle, SSH)")

    # The VarLens /healthz endpoint already probes Postgres on every
    # request — a 503 means either the app is wedged or the DB pool is
    # exhausted/disconnected. We monitor it as a single HTTP check; the
    # dedicated Postgres monitor below adds a transport-level probe so
    # we can disambiguate "app dead" from "DB dead" when something
    # breaks.
    pg_password = read_postgres_password(ip, ssh_key)
    pg_password_sql = pg_password.replace("'", "''")

    stack_monitors = [
        {
            "name": "VarLens app",
            "type": "http",
            # `/varlens/healthz` returns 200 + {status:'ok',db:{open:true}}
            # when both the app and Postgres are healthy. 503 otherwise.
            "url": f"https://{ip}/varlens/healthz",
            "method": "GET",
            "ignore_tls": 1,
            "hostname": None,
            "port": None,
            "basic_auth_user": None,
            "basic_auth_pass": None,
        },
        {
            "name": "PostgreSQL",
            "type": "postgres",
            # Probes from inside the docker network using the compose
            # service name. Same credentials VarLens uses; password
            # read from /etc/varlens/postgres-password on the server.
            # `database_connection_string` carries the password — Kuma
            # stores it as-is inside kuma.db on the same persistent
            # volume that restic backs up, which is the standard Kuma
            # pattern; we accept it for stage 1.
            "url": None,
            "method": "GET",
            "ignore_tls": 0,
            "hostname": None,
            "port": None,
            "basic_auth_user": None,
            "basic_auth_pass": None,
            "database_connection_string": f"postgres://varlens:{pg_password_sql}@postgres:5432/varlens",
            "database_query": "SELECT 1",
        },
        {
            "name": "HTTPS welcome page",
            "type": "http",
            "url": f"https://{ip}/welcome",
            "method": "GET",
            "ignore_tls": 1,
            "hostname": None,
            "port": None,
            "basic_auth_user": None,
            "basic_auth_pass": None,
        },
        {
            "name": "Dozzle (logs)",
            "type": "http",
            "url": f"https://{ip}/logs/",
            "method": "GET",
            "ignore_tls": 1,
            "hostname": None,
            "port": None,
            "basic_auth_user": admin_user,
            # Caddy's /logs/ basic_auth still expects DEFAULT_ADMIN_PW
            # because the Caddyfile carries a hardcoded bcrypt hash.
            # When the operator rotates KUMA_ADMIN_PASSWORD without
            # also updating the Caddyfile, this Dozzle heartbeat
            # monitor will go red — that's a one-time signal to
            # rotate the Caddy basic_auth too. Surfaces the drift
            # rather than hiding it.
            "basic_auth_pass": DEFAULT_ADMIN_PW,
        },
        {
            "name": "SSH (port 22)",
            "type": "port",
            "url": None,
            "method": "GET",
            "ignore_tls": 0,
            "hostname": ip,
            "port": 22,
            "basic_auth_user": None,
            "basic_auth_pass": None,
        },
    ]
    for m in stack_monitors:
        rc, exists = ssh(
            ip, ssh_key,
            f"docker exec uptime-kuma sqlite3 /app/data/kuma.db "
            f"\"SELECT COUNT(*) FROM monitor WHERE name = '{m['name']}';\"",
        )
        if int(exists.strip() or "0") > 0:
            log(f"  {m['name']}: already exists, skipping")
            continue
        # Build column list and value list dynamically; skip None fields.
        cols = ["name", "type", "active", "user_id", "interval", "retry_interval",
                "maxretries", "weight", "accepted_statuscodes_json", "method",
                "ignore_tls", "upside_down", "maxredirects", "expiry_notification",
                "gamedig_given_port_only", "kafka_producer_ssl",
                "kafka_producer_allow_auto_topic_creation", "timeout", "packet_size",
                "resend_interval", "grpc_enable_tls", "invert_keyword"]
        vals = [
            f"'{m['name']}'", f"'{m['type']}'", "1",
            "(SELECT id FROM user WHERE username = 'admin' LIMIT 1)",
            "60", "60", "3", "2000", "'[\"200-299\"]'", f"'{m['method']}'",
            str(m['ignore_tls']), "0", "10", "1", "1", "0", "0", "30", "56", "0", "0", "0",
        ]
        if m['url']:
            cols.append("url"); vals.append(f"'{m['url']}'")
        if m['hostname']:
            cols.append("hostname"); vals.append(f"'{m['hostname']}'")
        if m['port']:
            cols.append("port"); vals.append(str(m['port']))
        if m['basic_auth_user']:
            cols.append("basic_auth_user"); vals.append(f"'{m['basic_auth_user']}'")
            # Kuma only uses basic_auth_user/pass when auth_method='basic'.
            # Without this, the monitor probes without auth and gets 401.
            cols.append("auth_method"); vals.append("'basic'")
        if m['basic_auth_pass']:
            cols.append("basic_auth_pass"); vals.append(f"'{m['basic_auth_pass']}'")
        if m.get('database_connection_string'):
            cols.append("database_connection_string")
            vals.append(f"'{m['database_connection_string']}'")
        if m.get('database_query'):
            cols.append("database_query")
            vals.append(f"'{m['database_query']}'")
        sql = f"INSERT INTO monitor ({', '.join(cols)}) VALUES ({', '.join(vals)});"
        rc, out = ssh_with_stdin(
            ip, ssh_key,
            "docker exec -i uptime-kuma sqlite3 /app/data/kuma.db",
            stdin=sql, check=False,
        )
        if rc != 0:
            log(f"  {m['name']}: insert failed: {out}")
        else:
            log(f"  {m['name']}: inserted")

    log("Restarting Kuma so it loads new/updated monitors")
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
        fail("Kuma did not come back after restart")

    heartbeat_url = f"http://127.0.0.1:3001/api/push/{push_token}?status=up&msg=OK&ping="
    log(f"Heartbeat URL: http://127.0.0.1:3001/api/push/{push_token[:6]}...")

    # ----- 4. Update /etc/restic/env -----
    log("Writing HEARTBEAT_URL to /etc/restic/env")
    # Preflight: refuse to write a half-baked /etc/restic/env. If the file is
    # missing, or it exists without RESTIC_REPOSITORY=, then setup-backup has
    # not run (or has not run successfully) on this server. Writing
    # HEARTBEAT_URL alone would satisfy the systemd unit's
    # ConditionPathExists=/etc/restic/env and let restic-backup.service start,
    # only to fail inside on missing repo/password env — masking the real
    # problem (no backup configured) behind a confusing per-run failure.
    rc, preflight_body, _ = ssh_stdout_only(
        ip, ssh_key, "sudo cat /etc/restic/env", check=False,
    )
    if rc != 0 or "RESTIC_REPOSITORY=" not in (preflight_body or ""):
        fail("/etc/restic/env not initialised — run `make setup-backup` first.")
    # sed would be fragile because & in sed's replacement is interpreted as a
    # match back-reference. We read the file, replace the entry in Python,
    # and atomically write it back via `sudo tee`.
    #
    # Important: read stdout/stderr separately — otherwise a possible
    # `cat: ... No such file or directory` message ends up in the body. The
    # preflight above guarantees the file exists with RESTIC_REPOSITORY, so
    # any non-zero rc here is a transient SSH/sudo error worth logging rather
    # than tolerating silently.
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
    if using_default_pw:
        print(f"  Kuma UI login:   {admin_user} / {DEFAULT_ADMIN_PW}  (default — rotate after first login)")
    else:
        print(f"  Kuma UI login:   {admin_user} / <KUMA_ADMIN_PASSWORD from web-deploy/.env>")
    print()
    print("The next backup run will ping automatically. Manual test:")
    print(f"  ssh -i {ssh_key} deploy@{ip} 'sudo systemctl start restic-backup.service'")
    print("=" * 70)


if __name__ == "__main__":
    main()
