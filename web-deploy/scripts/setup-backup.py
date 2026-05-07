#!/usr/bin/env python3
"""
Procedural backup setup for the Concept Pilot.

Steps:
1. Read RESTIC_S3_ACCESS_KEY + RESTIC_S3_SECRET_KEY from env. These must
   be generated ONCE per Hetzner account at Console > Security > S3
   Credentials and pasted into web-deploy/.env. Hetzner does NOT expose
   an API for S3 credential creation (we probed live 2026-05-07; both
   /v1/object_storage/credentials POST and GET return 404). The earlier
   speculative API path was removed once that was confirmed.
2. Create the Object Storage Bucket via S3 API (PUT with AWS V4 signature).
3. Generate a strong restic password (32 bytes from os.urandom, base64).
4. SSH to the server and write /etc/restic/env with all values.
5. Trigger initial backup, wait for completion.
6. Print summary, suggest `make restore-drill` for verification.

Stdlib only - no external dependencies. Adopter-friendly: one command brings
the Concept Pilot from "infra deployed" to "backups running and verified".

Usage:
    RESTIC_S3_ACCESS_KEY=...   (required; from Hetzner Console)
    RESTIC_S3_SECRET_KEY=...   (required; shown once at generation)
    SERVER_IP=...              (or via tofu output)
    SSH_KEY=~/.ssh/...         (default ~/.ssh/varlens-tofu)

    ./scripts/setup-backup.py
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOFU_DIR = REPO_ROOT / "tofu" / "environments" / "pilot"

DEFAULT_REGION = "fsn1"
DEFAULT_ENDPOINT = "fsn1.your-objectstorage.com"
DEFAULT_BUCKET = "varlens-pilot-backup"
DEFAULT_SSH_KEY = Path.home() / ".ssh" / "varlens-tofu"


def log(msg: str) -> None:
    print(f"[setup-backup] {msg}", flush=True)


def fail(msg: str, code: int = 1) -> "None":
    print(f"[setup-backup] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


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


def s3_put_bucket_versioning(endpoint: str, region: str, access: str, secret: str, bucket: str) -> tuple[int, str]:
    """PUT /<bucket>?versioning to enable bucket versioning. Signed with AWS V4."""
    host = endpoint
    method = "PUT"
    canonical_uri = f"/{bucket}"
    canonical_query = "versioning="
    body = (
        '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        '<Status>Enabled</Status>'
        '</VersioningConfiguration>'
    ).encode("utf-8")
    payload_hash = hashlib.sha256(body).hexdigest()

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
        f"https://{host}{canonical_uri}?versioning",
        method=method,
        data=body,
        headers={
            "Host": host,
            "Content-Length": str(len(body)),
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
    """HEAD /<bucket>/<key>. Returns 200 if the object exists, 404 otherwise."""
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


def _validate_envvalue(key: str, value: str) -> None:
    """Assert that an env value is a single line of reasonable length.

    Newlines/CR would corrupt the KEY=VALUE env file format. We also clamp
    pathological lengths to surface misconfiguration early.
    """
    if not isinstance(value, str):
        fail(f"Env value for {key} is not a string: {type(value).__name__}")
    if "\n" in value or "\r" in value:
        fail(f"Env value for {key} contains a line break — would corrupt /etc/restic/env.")
    if len(value) > 4096:
        fail(f"Env value for {key} is implausibly long ({len(value)} characters).")


def write_env_file(ssh_key: Path, ip: str, env: dict[str, str]) -> None:
    for k, v in env.items():
        _validate_envvalue(k, v)
    body = "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"
    log("Writing /etc/restic/env on the server")
    # Step 1: create directory (separate SSH call, no secrets in argv).
    code, output = ssh_exec(ssh_key, ip, "sudo install -d -m 0700 /etc/restic")
    if code != 0:
        fail(f"SSH mkdir /etc/restic failed: {output}")
    # Step 2: stream body via STDIN so that ps auxww does not see secrets.
    proc = subprocess.run(
        ["ssh", "-i", str(ssh_key), "-o", "BatchMode=yes",
         "-o", "StrictHostKeyChecking=accept-new", f"deploy@{ip}",
         "sudo tee /etc/restic/env >/dev/null && sudo chmod 0600 /etc/restic/env"],
        input=body, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        fail(f"SSH write failed: {proc.stdout}{proc.stderr}")


def persist_restic_secret_to_sops(
    restic_password: str, bucket: str, endpoint: str, access: str, secret: str
) -> None:
    """Write the freshly generated restic secret bundle to secrets/restic.yaml via SOPS.

    Survival of this password is the difference between recoverable and
    unrecoverable backups in case of total server loss. We therefore persist
    it to a SOPS-encrypted file in the repo (committed by the user).

    Both the S3 access_key AND secret_key are persisted: Hetzner shows the
    secret only once at generation, so without persistence here an operator
    who wipes their .env loses the only copy and must regenerate the keypair
    in the console (orphaning the existing one).
    """
    sops_path = shutil.which("sops")
    if sops_path is None:
        log("WARNING: `sops` not found in PATH — restic password will NOT be persisted locally.")
        log("WARNING: On server loss all S3 snapshots are undecryptable. Install sops and rerun.")
        return

    age_keys = Path.home() / ".config" / "sops" / "age" / "keys.txt"
    if not age_keys.exists():
        log(f"WARNING: SOPS age key {age_keys} missing — restic password will NOT be persisted locally.")
        log("WARNING: On server loss all S3 snapshots are undecryptable.")
        return

    # Extract public key ("# public key: age1...").
    pubkey = ""
    for line in age_keys.read_text().splitlines():
        if line.startswith("# public key:"):
            pubkey = line.split(":", 1)[1].strip()
            break
    if not pubkey:
        log(f"WARNING: No '# public key:' header in {age_keys} — skipping SOPS persistence.")
        return

    target = REPO_ROOT / "secrets" / "restic.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)

    def _yaml_escape(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')

    plaintext = (
        f'restic_password: "{_yaml_escape(restic_password)}"\n'
        f'bucket: "{_yaml_escape(bucket)}"\n'
        f'endpoint: "{_yaml_escape(endpoint)}"\n'
        f'access_key: "{_yaml_escape(access)}"\n'
        f'secret_key: "{_yaml_escape(secret)}"\n'
    )

    # tempfile on the same partition as target so os.replace stays atomic.
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".yaml", delete=False,
        dir=str(target.parent),
    ) as tf:
        tf.write(plaintext)
        tmp_plain = Path(tf.name)
    try:
        os.chmod(tmp_plain, 0o600)
        # SOPS encrypts -> stdout, then atomically move to target.
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".yaml.enc", delete=False, dir=str(target.parent),
        ) as enc_tf:
            tmp_enc = Path(enc_tf.name)
        try:
            proc = subprocess.run(
                [sops_path, "-e", "--age", pubkey, "--input-type", "yaml",
                 "--output-type", "yaml", str(tmp_plain)],
                capture_output=True,
            )
            if proc.returncode != 0:
                log(f"WARNING: sops encryption failed ({proc.returncode}): "
                    f"{proc.stderr.decode('utf-8', errors='replace')}")
                return
            tmp_enc.write_bytes(proc.stdout)
            os.chmod(tmp_enc, 0o644)
            os.replace(tmp_enc, target)
            tmp_enc = None  # nothing left to clean up
        finally:
            if tmp_enc is not None and tmp_enc.exists():
                try:
                    tmp_enc.unlink()
                except OSError:
                    pass
    finally:
        try:
            tmp_plain.unlink()
        except OSError:
            pass

    print()
    print("!" * 70)
    print("Important: secrets/restic.yaml has been freshly written (SOPS-encrypted).")
    print("Please commit and push NOW:")
    print()
    print(f"    git add {target.relative_to(REPO_ROOT)}")
    print('    git commit -m "chore(secrets): rotate restic password"')
    print()
    print("Without a commit the only storage location of the restic password is the server.")
    print("On server loss ALL S3 snapshots would be undecryptable.")
    print("!" * 70)


# ----- main -----

def secrets_restic_yaml_decryptable() -> bool:
    """Return True iff secrets/restic.yaml exists AND can be decrypted locally
    via SOPS (i.e. the operator holds the age key required to recover the
    restic password from this checkout).

    Used by --default-reuse-when-resumable to decide whether silently picking
    `--reuse` is safe: reusing the existing on-server password is only a sound
    resume strategy if we still have a recoverable copy of that password
    locally. Without it, a future server-loss event would leave snapshots
    undecryptable, and the operator should be forced to think (--force or
    restore secrets/restic.yaml) rather than have the script paper over it.
    """
    target = REPO_ROOT / "secrets" / "restic.yaml"
    if not target.exists():
        return False
    sops_path = shutil.which("sops")
    if sops_path is None:
        return False
    age_keys = Path.home() / ".config" / "sops" / "age" / "keys.txt"
    if not age_keys.exists():
        return False
    # SOPS_AGE_KEY_FILE must be set explicitly: sops only auto-discovers keys
    # at SOPS_AGE_KEY (single key as stdin-style) or hard-coded SSH paths,
    # not at the standard ~/.config/sops/age/keys.txt location. Without this,
    # decryption silently fails on macOS even when the operator has the key.
    proc = subprocess.run(
        [sops_path, "-d", str(target)],
        capture_output=True,
        env={**os.environ, "SOPS_AGE_KEY_FILE": str(age_keys)},
    )
    return proc.returncode == 0


def read_restic_password_from_sops() -> str | None:
    """Decrypt secrets/restic.yaml and return the `restic_password` value, or None
    if the file is missing, undecryptable, or doesn't carry that field.

    Used by smart-resume to recover the password on a fresh server when the
    bucket already holds an initialized repo from a prior cold-start cycle.
    The bucket's repo expects the OLD password; the new server's
    /etc/restic/env doesn't exist yet; the operator's local SOPS is the
    authoritative source for that password. This bridges the two.
    """
    target = REPO_ROOT / "secrets" / "restic.yaml"
    if not target.exists():
        return None
    sops_path = shutil.which("sops")
    if sops_path is None:
        return None
    age_keys = Path.home() / ".config" / "sops" / "age" / "keys.txt"
    if not age_keys.exists():
        return None
    env = {**os.environ, "SOPS_AGE_KEY_FILE": str(age_keys)}
    proc = subprocess.run(
        [sops_path, "-d", str(target)],
        capture_output=True, text=True, env=env,
    )
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        if line.startswith("restic_password:"):
            value = line.split(":", 1)[1].strip()
            return value.strip('"').strip("'")
    return None


def main() -> None:
    # Modes:
    #   --reuse  : accept existing /etc/restic/env and reuse the password
    #   --force  : overwrite everything; old repo becomes unusable (greenfield ONLY)
    #   default  : preflight checks everything, fail loud if a setup already exists
    #
    # --default-reuse-when-resumable upgrades the default to "smart resume":
    # when a coherent prior setup is detected (server env + bucket repo +
    # locally decryptable secrets/restic.yaml), the script silently behaves
    # as if --reuse was passed. Used by `make pilot` retry flows where rerunning
    # the orchestrator after a downstream-step failure must not abort at
    # setup-backup. Greenfield (clean state) and mismatched states (bucket
    # repo without local SOPS) are unaffected.
    mode = "default"
    default_reuse_when_resumable = False
    for arg in sys.argv[1:]:
        if arg == "--reuse":
            mode = "reuse"
        elif arg == "--force":
            mode = "force"
        elif arg == "--default-reuse-when-resumable":
            default_reuse_when_resumable = True
        elif arg in ("-h", "--help"):
            print(__doc__)
            print("Usage: setup-backup.py [--reuse|--force] [--default-reuse-when-resumable]")
            sys.exit(0)
        else:
            fail(f"Unknown argument: {arg}")

    ip = os.environ.get("SERVER_IP")
    if not ip:
        try:
            ip = tofu_output("ipv4")
        except subprocess.CalledProcessError:
            fail("No server present. Run `make up` first.")
    log(f"Target server: {ip}")

    ssh_key = Path(os.environ.get("SSH_KEY", DEFAULT_SSH_KEY)).expanduser()
    if not ssh_key.exists():
        fail(f"SSH key {ssh_key} not found")

    bucket = os.environ.get("BUCKET_NAME", DEFAULT_BUCKET)
    region = os.environ.get("BUCKET_REGION", DEFAULT_REGION)
    endpoint = os.environ.get("BUCKET_ENDPOINT", DEFAULT_ENDPOINT)

    # --- PREFLIGHT step 1: server-side status ---
    log(f"Preflight: mode={mode}, bucket={bucket}, server={ip}")

    # Does /etc/restic/env exist on the server with a non-empty RESTIC_PASSWORD?
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
    # Hetzner does not expose an API for S3 credential creation; the keypair
    # is generated once per account in Console > Security > S3 Credentials
    # and pasted into web-deploy/.env. pilot.sh's preflight gate aborts
    # before provisioning when these are missing, so reaching this script
    # without them is an unusual direct invocation. Fail-loud here so
    # the operator gets the same console-click instructions either way.
    access = os.environ.get("RESTIC_S3_ACCESS_KEY")
    secret = os.environ.get("RESTIC_S3_SECRET_KEY")
    if not (access and secret):
        print("\n" + "=" * 70)
        print("RESTIC_S3_ACCESS_KEY / RESTIC_S3_SECRET_KEY required.")
        print()
        print("Hetzner does not expose an API for S3 credential creation.")
        print("Generate ONCE per account:")
        print()
        print("  Hetzner Console > Security > S3 Credentials > Generate")
        print()
        print("Paste both values into web-deploy/.env, then rerun:")
        print()
        print("  make pilot   # or: make -C web-deploy setup-backup")
        print("=" * 70)
        sys.exit(2)
    log(f"Using S3 credentials from environment (access key {access[:8]}...)")

    # --- PREFLIGHT step 2: bucket and repo status ---
    log(f"Checking bucket {bucket} on {endpoint}")
    head = s3_head_bucket(endpoint, region, access, secret, bucket)
    if head == 200:
        bucket_state = "exists (own access confirmed)"
    elif head == 404:
        bucket_state = "missing"
    elif head == 403:
        bucket_state = "exists, but no access (belongs to another account / wrong credentials)"
    else:
        bucket_state = f"unclear (HEAD status {head})"
    log(f"  Bucket: {bucket_state}")

    repo_initialized = False
    if head == 200:
        # A restic repo is recognized by the presence of the `config` object.
        cfg = s3_head_object(endpoint, region, access, secret, bucket, "config")
        repo_initialized = cfg == 200
        log(f"  Restic repo in bucket: {'initialized' if repo_initialized else 'empty / not initialized'}")
    server_state = "/etc/restic/env present with password" if env_exists else "/etc/restic/env missing"
    log(f"  Server: {server_state}")

    # --- Smart-resume default (opt-in via --default-reuse-when-resumable) ---
    # Resolve mode='default' to either 'reuse' or stay 'default' (and so fail
    # loud below) based on whether the prior state is fully resumable.
    #
    # Three resumable shapes exist:
    #   A. greenfield  — env not set, repo not init, anything goes
    #   B. continuous  — server has env, bucket has repo, local SOPS readable
    #                    (this is the standard "rerun after downstream failure" case)
    #   C. fresh-server-existing-bucket — env not set, repo initialised, local
    #                    SOPS readable. Standard for repeat-cold-start cycles
    #                    where teardown nukes the server but the bucket persists
    #                    (or the bucket gets recreated on the same name). The
    #                    server-side env is rebuilt from the SOPS-stored password.
    #
    # Anything outside these three falls through to the consistency matrix
    # below and exits 3 in default mode — those are the cases where silent
    # progress would be unsafe (mismatched local/bucket state, missing SOPS
    # for an initialised bucket, etc).
    if mode == "default" and default_reuse_when_resumable:
        if not env_exists and not repo_initialized:
            log("greenfield mode: clean state, initialising (default)")
        elif env_exists and repo_initialized and secrets_restic_yaml_decryptable():
            log("resume mode: existing /etc/restic/env + bucket config detected, reusing (--reuse)")
            mode = "reuse"
        elif (not env_exists) and repo_initialized and secrets_restic_yaml_decryptable():
            sops_password = read_restic_password_from_sops()
            if sops_password:
                log("resume from local SOPS: fresh server + bucket has repo + local restic.yaml decryptable")
                log("  recovering restic_password from secrets/restic.yaml; will rewrite /etc/restic/env on server")
                existing_password = sops_password
                mode = "reuse"
            else:
                log("mismatch: SOPS file decryptable but contains no restic_password — manual recovery required")
        elif repo_initialized and not secrets_restic_yaml_decryptable():
            log("mismatch: bucket has config but no local SOPS — must --force or restore secrets/restic.yaml")
            # Fall through to the matrix below, which will exit 3 in default mode.

    # --- PREFLIGHT step 3: consistency decision ---
    # Matrix (after smart-resume has had a chance to upgrade default → reuse):
    #  env_exists | repo_init | default     | --reuse                     | --force
    #  -----------+-----------+-------------+-----------------------------+--------
    #  False      | False     | proceed     | proceed                     | proceed
    #  True       | False     | FAIL        | reuse pw, init at backup    | overwrite
    #  False      | True      | FAIL        | reuse pw from SOPS (*)      | overwrite (= old snaps lost)
    #  True       | True      | FAIL        | reuse pw                    | overwrite (= old snaps lost)
    #
    # (*) When --reuse was chosen via --default-reuse-when-resumable on the
    #     "fresh-server-existing-bucket" branch, existing_password has been
    #     populated from secrets/restic.yaml above, bypassing the historical
    #     "no pw to reuse" failure mode.
    if env_exists or repo_initialized:
        print("\n" + "=" * 70)
        print("Preflight detect: existing backup artifacts found")
        print("=" * 70)
        if env_exists:
            print(f"  - /etc/restic/env on {ip} has a set RESTIC_PASSWORD.")
        if repo_initialized:
            print(f"  - Bucket {bucket} contains an initialized restic repo (config object).")
        print()
        if mode == "default":
            print("Default mode aborts to avoid making existing snapshots unusable.")
            print("Options:")
            print("  - setup-backup.py --reuse   reuse existing password (safe)")
            print("  - setup-backup.py --force   overwrite everything (ALL old snapshots become")
            print("                              undecryptable — only for a deliberate greenfield action)")
            print("=" * 70)
            sys.exit(3)
        if mode == "reuse" and not existing_password and repo_initialized:
            print("ERROR: --reuse requires an existing /etc/restic/env with RESTIC_PASSWORD,")
            print("       but the bucket already contains a repo. You would have to manually")
            print("       enter the old password into /etc/restic/env, or restart with --force.")
            print("=" * 70)
            sys.exit(3)
        print(f"Mode={mode}: continuing.")
        print("=" * 70)

    # --- Create bucket if needed ---
    if head == 404:
        log("Creating bucket")
        code, body = s3_put_bucket(endpoint, region, access, secret, bucket)
        if code in (200, 201):
            log("  Bucket created successfully")
        else:
            fail(f"Bucket creation failed ({code}): {body}")
    elif head == 403:
        fail("Bucket belongs to another account or credentials do not match.")
    elif head not in (200, 404):
        fail(f"Unexpected response on bucket HEAD ({head})")

    # --- Enable bucket versioning (protection against accidental deletion) ---
    vcode, vbody = s3_put_bucket_versioning(endpoint, region, access, secret, bucket)
    if vcode in (200, 204):
        log("Bucket versioning enabled (protection against accidental deletion)")
    elif vcode in (400, 501):
        log(f"WARNING: bucket versioning not supported by endpoint (HTTP {vcode}): {vbody[:200]}")
    else:
        log(f"WARNING: bucket versioning could not be enabled (HTTP {vcode}): {vbody[:200]}")

    # --- restic password: operator override > existing > generate ---
    operator_password = os.environ.get("RESTIC_PASSWORD", "").strip()
    newly_generated = False
    if existing_password and mode in ("default", "reuse"):
        restic_password = existing_password
        log("Reusing existing restic password")
    elif operator_password:
        # Operator typed a password into web-deploy/.env. Treat as
        # newly_generated for SOPS persistence so the next bring-up on a
        # fresh server (without /etc/restic/env) can still decrypt the
        # bucket. Skip generation entirely.
        restic_password = operator_password
        newly_generated = True
        log("Using operator-supplied RESTIC_PASSWORD")
    else:
        restic_password = base64.b64encode(secrets.token_bytes(24)).decode("ascii")
        newly_generated = True
        log("Generated strong restic password (24 random bytes, base64)")

    # --- On fresh creation: persist restic password SOPS-encrypted in the repo ---
    # Otherwise the password would not survive server loss and all snapshots
    # would be undecryptable.
    if newly_generated and mode != "reuse":
        persist_restic_secret_to_sops(restic_password, bucket, endpoint, access, secret)

    # --- write env on server ---
    # HEARTBEAT_URL is set by setup-monitoring.py. If this file already
    # exists, we carry over the existing value so that a
    # `setup-backup --reuse` does not silently disable the heartbeat.
    existing_heartbeat_url = ""
    code, hb_raw = ssh_exec(
        ssh_key, ip,
        "sudo cat /etc/restic/env 2>/dev/null | grep '^HEARTBEAT_URL=' || true",
    )
    if code == 0:
        line = hb_raw.strip()
        if line.startswith("HEARTBEAT_URL="):
            existing_heartbeat_url = line.split("=", 1)[1]
    if existing_heartbeat_url:
        log("Carrying over existing HEARTBEAT_URL from /etc/restic/env")

    env = {
        "RESTIC_REPOSITORY": f"s3:{endpoint}/{bucket}",
        "RESTIC_PASSWORD": restic_password,
        "AWS_ACCESS_KEY_ID": access,
        "AWS_SECRET_ACCESS_KEY": secret,
        "BACKUP_PATHS": "/mnt/data",
        "RETENTION_KEEP_DAILY": "7",
        "RETENTION_KEEP_WEEKLY": "4",
        "RETENTION_KEEP_MONTHLY": "6",
        "HEARTBEAT_URL": existing_heartbeat_url,
    }
    write_env_file(ssh_key, ip, env)

    # --- initial backup ---
    log("Triggering first backup run (initializes the repository in the bucket)")
    code, output = ssh_exec(
        ssh_key, ip,
        "sudo systemctl start restic-backup.service && "
        "while sudo systemctl is-active --quiet restic-backup.service; do sleep 3; done && "
        "systemctl show restic-backup.service --property=Result --value"
    )
    if code != 0:
        fail(f"Backup service start failed: {output}")
    if "success" not in output.strip().splitlines()[-1:]:
        log("WARNING: backup service result is not 'success'. Check logs with:")
        log(f"  ssh -i {ssh_key} deploy@{ip} 'sudo journalctl -u restic-backup.service --no-pager -n 50'")
    else:
        log("  Initial backup successful")

    # --- summary ---
    print()
    print("=" * 70)
    print("Backup setup complete")
    print("=" * 70)
    print(f"  Bucket:          {bucket}")
    print(f"  Endpoint:        {endpoint}")
    print(f"  S3 access key:   {access[:8]}... (on server in /etc/restic/env)")
    pw_status = "reused from /etc/restic/env" if existing_password and mode in ("default", "reuse") else "newly generated (24 bytes, base64)"
    print(f"  restic password: {pw_status}")
    print()
    print("Next steps:")
    print("  make restore-drill   # verification: backup-restore path works")
    print("=" * 70)


if __name__ == "__main__":
    main()
