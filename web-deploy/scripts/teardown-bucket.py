#!/usr/bin/env python3
"""
Empty and delete a Hetzner Object Storage bucket via S3 API.

Used as the bucket-side counterpart to `tofu destroy` so that a complete
reset of the Concept Pilot also clears the restic backup repository.

Stdlib only - signs every request with AWS Signature Version 4.

Usage:
    RESTIC_S3_ACCESS_KEY=...
    RESTIC_S3_SECRET_KEY=...
    BUCKET_NAME=varlens-pilot-backup    (default)
    BUCKET_ENDPOINT=fsn1.your-objectstorage.com    (default)
    BUCKET_REGION=fsn1    (default)

    ./scripts/teardown-bucket.py

The script lists all object versions plus delete-markers, deletes each,
and then deletes the bucket itself. Bucket-versioning is assumed enabled
(setup-backup.py turns it on), so a plain DELETE on the bucket would
otherwise fail with BucketNotEmpty.

Confirmation: the script prints the number of versions found and asks
the user to type the bucket name verbatim before proceeding. Bypass with
`--yes` for CI / scripted runs.
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

DEFAULT_REGION = "fsn1"
DEFAULT_ENDPOINT = "fsn1.your-objectstorage.com"
DEFAULT_BUCKET = "varlens-pilot-backup"
S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


def log(msg: str) -> None:
    print(f"[teardown-bucket] {msg}", flush=True)


def fail(msg: str, code: int = 1) -> None:
    print(f"[teardown-bucket] ERROR: {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


# ----- AWS V4 signing helpers -----

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date_stamp: str, region: str, service: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    return _sign(k_service, "aws4_request")


def s3_request(
    method: str,
    endpoint: str,
    region: str,
    access: str,
    secret: str,
    path: str,
    query: str = "",
    body: bytes = b"",
) -> tuple[int, bytes]:
    """Sign and send a single S3 request. Returns (status, body)."""
    host = endpoint
    payload_hash = hashlib.sha256(body).hexdigest()
    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    canonical_headers = (
        f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        method, path, query, canonical_headers, signed_headers, payload_hash,
    ])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    sig_key = _signing_key(secret, date_stamp, region, "s3")
    signature = hmac.new(sig_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    url = f"https://{host}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(
        url,
        method=method,
        data=body if body else None,
        headers={
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


# ----- High-level operations -----

def list_versions(endpoint, region, access, secret, bucket):
    """Yield (key, version_id, is_delete_marker) for every version in the bucket."""
    key_marker = ""
    version_marker = ""
    while True:
        params = {"versions": "", "max-keys": "1000"}
        if key_marker:
            params["key-marker"] = key_marker
        if version_marker:
            params["version-id-marker"] = version_marker
        # Canonical query: keys sorted, values URL-encoded.
        query = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
            for k, v in sorted(params.items())
        )
        code, body = s3_request("GET", endpoint, region, access, secret, f"/{bucket}", query=query)
        if code != 200:
            fail(f"List versions failed ({code}): {body[:300].decode('utf-8', errors='replace')}")
        root = ET.fromstring(body)
        for v in root.findall(f"{S3_NS}Version"):
            yield (
                v.findtext(f"{S3_NS}Key"),
                v.findtext(f"{S3_NS}VersionId"),
                False,
            )
        for d in root.findall(f"{S3_NS}DeleteMarker"):
            yield (
                d.findtext(f"{S3_NS}Key"),
                d.findtext(f"{S3_NS}VersionId"),
                True,
            )
        if root.findtext(f"{S3_NS}IsTruncated") != "true":
            break
        key_marker = root.findtext(f"{S3_NS}NextKeyMarker") or ""
        version_marker = root.findtext(f"{S3_NS}NextVersionIdMarker") or ""


def delete_object(endpoint, region, access, secret, bucket, key, version_id):
    path = f"/{bucket}/{urllib.parse.quote(key, safe='/')}"
    query = f"versionId={urllib.parse.quote(version_id, safe='')}" if version_id else ""
    code, body = s3_request("DELETE", endpoint, region, access, secret, path, query=query)
    if code not in (200, 204):
        vid_tag = (version_id or "null")[:8]
        log(f"  WARN: delete {key}@{vid_tag} returned {code}: {body[:200].decode('utf-8', errors='replace')}")
        return False
    return True


def list_objects_flat(endpoint, region, access, secret, bucket):
    """Yield keys via plain ListObjectsV2.

    Catches objects uploaded BEFORE versioning was enabled (or when
    versioning was suspended): those have no entry in the ?versions
    listing, so the version-sweep alone leaves them behind and
    DeleteBucket returns 409 BucketNotEmpty even though we 'deleted
    everything'.
    """
    continuation = ""
    while True:
        params = {"list-type": "2", "max-keys": "1000"}
        if continuation:
            params["continuation-token"] = continuation
        query = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
            for k, v in sorted(params.items())
        )
        code, body = s3_request("GET", endpoint, region, access, secret, f"/{bucket}", query=query)
        if code != 200:
            fail(f"List objects failed ({code}): {body[:300].decode('utf-8', errors='replace')}")
        root = ET.fromstring(body)
        for c in root.findall(f"{S3_NS}Contents"):
            key = c.findtext(f"{S3_NS}Key")
            if key:
                yield key
        if root.findtext(f"{S3_NS}IsTruncated") != "true":
            break
        continuation = root.findtext(f"{S3_NS}NextContinuationToken") or ""
        if not continuation:
            break


def sweep_until_empty(endpoint, region, access, secret, bucket, max_passes=6):
    """Re-list and delete until both namespaces report zero, or we give up.

    Hetzner Object Storage occasionally surfaces objects through one
    listing API that the other missed, and bulk deletes are eventually
    consistent. A single pass of `list_versions -> delete` is therefore
    not sufficient to guarantee an empty bucket, even when our first
    listing reported "227/227 removed". We retry with backoff until both
    ?versions and list-type=2 return empty.
    """
    for attempt in range(1, max_passes + 1):
        versions = list(list_versions(endpoint, region, access, secret, bucket))
        flats = [] if versions else list(list_objects_flat(endpoint, region, access, secret, bucket))
        if not versions and not flats:
            return  # truly empty

        if versions:
            log(f"  Pass {attempt}: {len(versions)} version/delete-marker entries to remove.")
            for key, vid, _is_dm in versions:
                delete_object(endpoint, region, access, secret, bucket, key, vid)
        if flats:
            log(f"  Pass {attempt}: {len(flats)} flat (null-version) object(s) to remove.")
            for key in flats:
                delete_object(endpoint, region, access, secret, bucket, key, "")

        # Backoff lets Hetzner's index catch up before we re-list.
        delay = min(2 * attempt, 10)
        log(f"  Waiting {delay}s for backend reconciliation before re-listing...")
        time.sleep(delay)

    # One last check after the loop bails.
    leftover_versions = list(list_versions(endpoint, region, access, secret, bucket))
    leftover_flats = [] if leftover_versions else list(list_objects_flat(endpoint, region, access, secret, bucket))
    if leftover_versions or leftover_flats:
        fail(
            f"Bucket still not empty after {max_passes} sweep passes "
            f"(versions={len(leftover_versions)}, flat={len(leftover_flats)}).\n"
            "  Re-run this command in a few minutes (Hetzner index may still be catching up),\n"
            "  or use the Hetzner Console > Object Storage > <bucket> > Delete button.",
            code=5,
        )


def list_multipart_uploads(endpoint, region, access, secret, bucket):
    """Yield (key, upload_id) for every in-flight multipart upload.

    Restic uses multipart uploads for objects >5 MB and abandons them
    on signal (SIGTERM during a backup, network drop, etc.). These
    abandoned uploads are NOT in the version listing — they live in a
    separate "in-progress" namespace — but their existence makes
    DeleteBucket fail with BucketNotEmpty (409). The whole reason this
    teardown script exists is to make the bucket cleanly deletable; the
    multipart-namespace gap was the missing piece.
    """
    key_marker = ""
    upload_id_marker = ""
    while True:
        params = {"uploads": "", "max-uploads": "1000"}
        if key_marker:
            params["key-marker"] = key_marker
        if upload_id_marker:
            params["upload-id-marker"] = upload_id_marker
        query = "&".join(
            f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
            for k, v in sorted(params.items())
        )
        code, body = s3_request("GET", endpoint, region, access, secret, f"/{bucket}", query=query)
        if code != 200:
            fail(
                f"List multipart uploads failed ({code}): "
                f"{body[:300].decode('utf-8', errors='replace')}"
            )
        root = ET.fromstring(body)
        for u in root.findall(f"{S3_NS}Upload"):
            yield (
                u.findtext(f"{S3_NS}Key"),
                u.findtext(f"{S3_NS}UploadId"),
            )
        if root.findtext(f"{S3_NS}IsTruncated") != "true":
            break
        key_marker = root.findtext(f"{S3_NS}NextKeyMarker") or ""
        upload_id_marker = root.findtext(f"{S3_NS}NextUploadIdMarker") or ""


def abort_multipart_upload(endpoint, region, access, secret, bucket, key, upload_id):
    path = f"/{bucket}/{urllib.parse.quote(key, safe='/')}"
    query = f"uploadId={urllib.parse.quote(upload_id, safe='')}"
    code, body = s3_request("DELETE", endpoint, region, access, secret, path, query=query)
    if code not in (200, 204):
        log(
            f"  WARN: abort multipart {key}@{upload_id[:8]} returned {code}: "
            f"{body[:200].decode('utf-8', errors='replace')}"
        )
        return False
    return True


def delete_bucket(endpoint, region, access, secret, bucket, listings_were_empty):
    # Hetzner can return 409 BucketNotEmpty for several seconds after the
    # last object delete, even when ?versions and list-type=2 both report
    # empty. Retry with backoff before surfacing the error to the operator.
    last_code, last_body = 0, b""
    for attempt in range(1, 5):
        code, body = s3_request("DELETE", endpoint, region, access, secret, f"/{bucket}")
        if code in (200, 204):
            return
        last_code, last_body = code, body
        if code == 409:
            delay = 5 * attempt
            log(f"  DeleteBucket attempt {attempt} returned 409; backing off {delay}s...")
            time.sleep(delay)
            continue
        break  # non-409: don't bother retrying

    decoded = last_body[:300].decode("utf-8", errors="replace")
    if last_code == 409 and listings_were_empty:
        fail(
            f"Delete bucket failed ({last_code}) after retries: {decoded}\n"
            "\n"
            "All S3 listings reported the bucket empty (versions=0, multipart=0,\n"
            "objects=0) but Hetzner still refuses DeleteBucket. This is a backend\n"
            "state-reconciliation issue we cannot fix from the client. Workarounds:\n"
            "  - Wait 5-10 min for async reconciliation, then re-run this script.\n"
            "  - Hetzner Console > Object Storage > <bucket> > 'Delete' button.\n"
            "    The Console can force-delete past stuck state.\n"
            "  - Hetzner Cloud Support (rare; ticket if the Console option fails).",
            code=4,
        )
    fail(f"Delete bucket failed ({last_code}): {decoded}")


# ----- main -----

def main() -> None:
    yes = "--yes" in sys.argv[1:]
    access = os.environ.get("RESTIC_S3_ACCESS_KEY")
    secret = os.environ.get("RESTIC_S3_SECRET_KEY")
    if not access or not secret:
        fail("RESTIC_S3_ACCESS_KEY and RESTIC_S3_SECRET_KEY must be set in env.")
    bucket = os.environ.get("BUCKET_NAME", DEFAULT_BUCKET)
    endpoint = os.environ.get("BUCKET_ENDPOINT", DEFAULT_ENDPOINT)
    region = os.environ.get("BUCKET_REGION", DEFAULT_REGION)

    log(f"Target: bucket={bucket}, endpoint={endpoint}, region={region}")
    log("Listing versions and delete-markers...")
    versions = list(list_versions(endpoint, region, access, secret, bucket))
    log(f"  Found {len(versions)} version/delete-marker entries.")

    if not versions:
        log("Bucket is already empty — proceeding to delete-bucket.")
    else:
        if not yes:
            print(
                f"\nAbout to permanently delete every object version in bucket "
                f"'{bucket}' and the bucket itself. Type the bucket name to confirm:"
            )
            try:
                got = input("> ").strip()
            except EOFError:
                got = ""
            if got != bucket:
                fail("Aborted.", code=2)

        log("Deleting all versions/delete-markers...")
        deleted = 0
        for key, vid, is_dm in versions:
            tag = "delete-marker" if is_dm else "object"
            if delete_object(endpoint, region, access, secret, bucket, key, vid):
                deleted += 1
            if deleted % 20 == 0:
                log(f"  {deleted}/{len(versions)} {tag}s removed...")
        log(f"  {deleted}/{len(versions)} entries removed (first pass).")

    # Multipart uploads live in a separate namespace from object versions;
    # they must be aborted explicitly or DeleteBucket returns 409 BucketNotEmpty
    # even after every visible object is gone. Restic in particular leaves
    # these around when interrupted mid-backup.
    log("Listing in-flight multipart uploads...")
    uploads = list(list_multipart_uploads(endpoint, region, access, secret, bucket))
    log(f"  Found {len(uploads)} multipart upload(s).")
    if uploads:
        log("Aborting all multipart uploads...")
        aborted = 0
        for key, upload_id in uploads:
            if abort_multipart_upload(endpoint, region, access, secret, bucket, key, upload_id):
                aborted += 1
        log(f"  {aborted}/{len(uploads)} multipart uploads aborted.")

    # Re-list and sweep until both ?versions and list-type=2 return empty.
    # First-pass deletes can leave residue: flat null-version objects from
    # pre-versioning uploads, plus eventual-consistency lag on the index.
    log("Sweeping bucket until empty (re-list + delete loop)...")
    sweep_until_empty(endpoint, region, access, secret, bucket)
    log("  Bucket confirmed empty by both listings.")

    listings_were_empty = (len(versions) == 0 and len(uploads) == 0)
    log(f"Deleting bucket {bucket}")
    delete_bucket(endpoint, region, access, secret, bucket, listings_were_empty)
    log("Bucket deleted.")
    print()
    print("=" * 70)
    print("Bucket teardown complete")
    print("=" * 70)
    print(f"  Bucket:            {bucket}")
    print(f"  Endpoint:          {endpoint}")
    print(f"  Versions removed:  {len(versions)}")
    print(f"  Uploads aborted:   {len(uploads)}")
    print()
    print("Next: run `make setup-backup` (with --force if a fresh password is desired)")
    print("=" * 70)


if __name__ == "__main__":
    main()
