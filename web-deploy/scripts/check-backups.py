#!/usr/bin/env python3
"""Probe the configured restic bucket for an initialised repository.

Runs from the operator's machine (no SSH, no live server needed). Used by
pilot.sh's preflight to decide whether existing snapshots are about to be
orphaned by a fresh `make pilot` — see the safety-guard logic there.

Inputs (env):
    RESTIC_S3_ACCESS_KEY, RESTIC_S3_SECRET_KEY  — Hetzner S3 keypair
    BUCKET_NAME (default: varlens-pilot-backup)
    BUCKET_REGION (default: fsn1)
    BUCKET_ENDPOINT (default: fsn1.your-objectstorage.com)

Output:
    Exit 0 + JSON to stdout if a restic repository is initialised in the
    bucket. Exit 0 + a single-line "no" if the bucket is empty / missing.
    Exit 2 if credentials are missing or the bucket is inaccessible.

The JSON-on-success shape is:

    {"present": true, "bucket": "...", "endpoint": "...", "config_etag": "..."}

The presence of restic's `config` object is the canonical signal that a
restic repo lives in the bucket. We do not list snapshot IDs here because
that requires the restic password (in SOPS); the goal is "are there
backups?" — a yes/no, not a manifest. Listing snapshots is the job of
the recovery flow once the operator opts in.
"""
from __future__ import annotations

import json
import os
import sys

# Reuse the AWS V4 signing helpers from setup-backup.py rather than
# duplicating them. Python imports relative to script dir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util


def _load_setup_backup_module():
    spec = importlib.util.spec_from_file_location(
        "_setup_backup_helpers",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "setup-backup.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DEFAULT_BUCKET = "varlens-pilot-backup"
DEFAULT_REGION = "fsn1"
DEFAULT_ENDPOINT = "fsn1.your-objectstorage.com"


def main() -> int:
    access = os.environ.get("RESTIC_S3_ACCESS_KEY", "").strip()
    secret = os.environ.get("RESTIC_S3_SECRET_KEY", "").strip()
    if not access or not secret:
        print("RESTIC_S3_ACCESS_KEY / RESTIC_S3_SECRET_KEY not in env", file=sys.stderr)
        return 2

    bucket = os.environ.get("BUCKET_NAME", DEFAULT_BUCKET)
    region = os.environ.get("BUCKET_REGION", DEFAULT_REGION)
    endpoint = os.environ.get("BUCKET_ENDPOINT", DEFAULT_ENDPOINT)

    helpers = _load_setup_backup_module()

    head_bucket_code = helpers.s3_head_bucket(endpoint, region, access, secret, bucket)
    if head_bucket_code == 404:
        print("no")
        return 0
    if head_bucket_code == 403:
        print("bucket exists but credentials lack access", file=sys.stderr)
        return 2
    if head_bucket_code not in (200, 204):
        print(f"bucket HEAD returned unexpected status {head_bucket_code}", file=sys.stderr)
        return 2

    # Bucket exists. Probe for restic's 'config' object — its presence is
    # the canonical "an initialised restic repo lives here" signal.
    config_code = helpers.s3_head_object(endpoint, region, access, secret, bucket, "config")
    if config_code == 200:
        print(json.dumps({
            "present": True,
            "bucket": bucket,
            "endpoint": endpoint,
        }))
        return 0
    print("no")
    return 0


if __name__ == "__main__":
    sys.exit(main())
