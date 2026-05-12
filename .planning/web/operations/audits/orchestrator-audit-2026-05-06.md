# Orchestrator audit — 2026-05-06

## Summary

The cycle is solid for a clean cold-boot: pre-flight gates, cloud-init wait, ABI/uid alignment, and fail-loud server boot are well thought-out. The biggest remaining concern is that `make stack-up` is **not safe to re-run on a server that already holds data** — `rsync --delete` on the compose tree erases `/mnt/data/app/data/` (SQLite DB + admin recovery key) and `/mnt/data/app/.env` (postgres password) on every invocation. Image rotation is therefore a data-loss event by default. A handful of secondary issues (idempotency holes in `make pilot`, cloud-init runcmd swallowing failures, smoke false-greens, Caddy ACME quota awareness) follow.

## Findings

### F1: `rsync --delete` in `deploy-stack` wipes runtime DB + secrets on every re-run

**Severity:** critical
**Files:** `web-deploy/Makefile:123-128`, `web-deploy/Makefile:146-179`, `web-deploy/bin/varlens:415-422` (mirror in e2e flow)

**Latent trap:** `rsync -avz --delete -e "ssh ..." compose/ deploy@$(IPV4):/mnt/data/app/` syncs the *entire contents* of the local `compose/` dir into `/mnt/data/app/` and deletes anything in the dest that isn't in the source. The source tree contains only `Caddyfile`, `docker-compose.yml`, `.env.example`. Anything created on the server inside `/mnt/data/app/` after the first stack-up — specifically `data/` (SQLite DB at `/mnt/data/app/data/varlens.db` plus `admin-recovery-key.txt`) and `.env` (auto-generated POSTGRES_PASSWORD, persisted SERVER_HOST/CADDY_TLS_PROFILE) — is **deleted on every re-run** of `make stack-up`. The subsequent `mkdir -p /mnt/data/app/data && chown 1001:1001` on Makefile:153-154 then recreates an empty data dir, and the `if [ ! -f .env ]` block on line 170 regenerates `.env` with a brand new postgres password.

**Why it hasn't fired yet:** The live cycle has so far been a sequence of full destroy→provision cycles, not in-place updates. On a fresh server `data/` doesn't exist before rsync, so the `--delete` has nothing to strip; the bug only surfaces on the second `make stack-up` against the same server.

**When it WILL fire:** The very first time the operator does the documented "image rotation" flow — a new `:edge` build lands on GHCR and they rerun `make stack-up` to pull and recreate. SQLite DB evaporates, admin user is gone, recovery key file is gone. In postgres mode the on-volume cluster keeps the *old* password but `.env` now has a *new* random one — postgres container fails to start on next boot until the operator manually reconciles. The user's mental model of "stack-up is idempotent" is exactly wrong here.

**Suggested fix:** Add explicit excludes/filters to the rsync invocation so runtime artifacts are never candidates for deletion. Two lines in the Makefile:

```make
deploy-stack:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	rsync -avz --delete \
		--exclude=/data/ --exclude=/.env \
		-e "ssh -i $(SSH_KEY)" \
		compose/ \
		deploy@$(call IPV4):/mnt/data/app/
```

(Anchored excludes — `/data/`, `/.env` — so they only protect those names at the rsync root, not anywhere deep.) Mirror the same change in `bin/varlens` `_stack_up()` for the e2e path. Optionally add a `make stack-up-check` that aborts if `/mnt/data/app/data/varlens.db` exists and looks newer than 60s (defence-in-depth).

---

### F2: cloud-init `runcmd` swallows individual failures; `cloud-init status --wait` returns "done" anyway

**Severity:** high
**Files:** `web-deploy/cloud-init/pilot.yaml:122-221`, `web-deploy/scripts/pilot.sh:102-115`

**Latent trap:** `cloud-init`'s `runcmd` module runs each entry in sequence, but a non-zero exit from any single entry does **not** mark cloud-init as failed — the module logs the error and continues. `cloud-init status --wait` exits 0 (`done`) as long as the module completed, even if individual steps inside failed. Several runcmd entries here can fail without surfacing:

- `apt-get update` / `apt-get install docker-ce ...` (lines 149-150) — transient Docker repo unavailability or a mirror timeout would skip Docker install entirely; the rest of runcmd happily continues.
- The volume-mount retry block (lines 134-141) explicitly only `echo "WARN"` on failure — if Hetzner's volume attach takes >60s, `/mnt/data` ends up unmounted, subsequent `mkdir -p /mnt/data/...` lands on the root filesystem, and the bug is invisible until the next reboot (when fstab `nofail` either succeeds or, if still not attached, leaves an empty `/mnt/data`).
- `usermod -aG docker deploy` (line 153) silently no-ops if Docker install failed.

`pilot.sh` then proceeds to `make stack-up`, which will fail at `docker compose pull` with a confusing "command not found" or "docker: not found" error.

**Why it hasn't fired yet:** Hetzner's APT mirror and the Docker repo are usually reliable; the volume race is mostly absorbed by the 60s retry; cloud-init's overall exit status looks green.

**When it WILL fire:** A flaky run during a Docker repo mirror outage, or an unusually slow volume attach, or a future Ubuntu image bump that breaks one of the pinned versions. The failure mode is "cloud-init says done, then stack-up fails with a cryptic error" — operators waste 10-20 minutes diagnosing.

**Suggested fix:** Wrap the critical runcmd steps in explicit assertions and add a post-bootstrap health probe. In `cloud-init/pilot.yaml`, append a final runcmd that records a structured success marker only if all prerequisites are present:

```yaml
- |
  set -e
  command -v docker >/dev/null  || { echo "BOOTSTRAP_FAIL: docker missing"; exit 1; }
  docker compose version >/dev/null || { echo "BOOTSTRAP_FAIL: compose plugin missing"; exit 1; }
  mountpoint -q /mnt/data || { echo "BOOTSTRAP_FAIL: /mnt/data not mounted"; exit 1; }
  id -nG ${deploy_user} | grep -qw docker || { echo "BOOTSTRAP_FAIL: ${deploy_user} not in docker group"; exit 1; }
  echo BOOTSTRAP_OK > /var/lib/cloud/instance/varlens-bootstrap.ok
```

Then have `pilot.sh:wait_for_server_ready` assert the marker exists after `cloud-init status --wait`:

```bash
ssh ... 'test -f /var/lib/cloud/instance/varlens-bootstrap.ok' \
  || { echo "cloud-init reported done but bootstrap marker missing"; ssh ... 'sudo grep BOOTSTRAP_FAIL /var/log/cloud-init-output.log'; return 1; }
```

This fail-loud bracket converts silent partial-bootstraps into immediate, diagnostic failures.

---

### F3: `make pilot` re-entry after partial failure re-runs steps 3+4 against existing state and aborts at setup-backup

**Severity:** high
**Files:** `web-deploy/scripts/pilot.sh:236-274`, `web-deploy/scripts/setup-backup.py:582-614`, `web-deploy/Makefile:227-230`

**Latent trap:** If `make pilot` fails at step 4 (setup-monitoring) or step 5 (smoke), the operator's natural recovery is to rerun `make pilot`. Step 1 (`make up`) is idempotent (tofu plan is empty) — fine. Step 2 (`make stack-up`) wipes data per F1 and then re-runs compose — also fine, ish. **Step 3 (`make setup-backup`) is NOT idempotent in default mode**: it detects the existing `/etc/restic/env` and the existing repo `config` object in the bucket, and exits 3 demanding `--reuse` or `--force`. The orchestrator does not pass either flag (Makefile:229), so step 3 fails with a "preflight detect: existing backup artifacts found" error, and the cycle aborts.

The only documented escape hatch is for the operator to set `SETUP_BACKUP_ARGS=--reuse` (or `--force` for greenfield) — but `pilot.sh` doesn't surface this in its retry hint, and `make pilot` itself doesn't propagate `SETUP_BACKUP_ARGS` when re-entering.

**Why it hasn't fired yet:** The fix in user-fixed-item #6 just teaches *operators* to pass `--force` once on greenfield. As long as the first cycle succeeds end-to-end, this stays latent. The second time anything fails after step 3, the operator hits it.

**When it WILL fire:** Any partial-failure retry. Specifically: monitoring config tweak that breaks step 4 in a future PR, or a flaky Hetzner Cloud API on step 3's S3-credential fetch.

**Suggested fix:** Make `pilot.sh` resume-aware. Either:

1. Default `make setup-backup` to `--reuse` mode when `/etc/restic/env` exists on the server, since reusing the password is always safe and is the only correct action for "I'm re-entering after failure". Concretely, `setup-backup.py` could promote `--reuse` from explicit-flag to default-when-env-exists, and reserve `--force` as the only mode that destroys existing snapshots. The current default ("fail unless --reuse or --force") optimises for safety against accidental clobber but breaks all retry flows.
2. Or: have `pilot.sh` detect step boundaries via marker files on the server (`/var/lib/varlens/pilot.step3.ok`, etc.) and skip already-completed steps. Heavier, but matches a re-entry model.

Recommend option 1 — minimal change, captures the intent.

---

### F4: `.env` regeneration after deletion makes postgres mode unrecoverable

**Severity:** high
**Files:** `web-deploy/Makefile:169-176`, `web-deploy/compose/.env.example:7-10`

**Latent trap:** Compounds F1. When stack-up's rsync wipes `/mnt/data/app/.env`, the next line (`if [ ! -f .env ]; then cp .env.example .env && sed -i "s|REPLACE_WITH_GENERATED_PASSWORD|$(openssl rand -base64 32 ...)..."`) generates a *new random* postgres password. The on-volume `/mnt/data/postgres/` PGDATA cluster, however, was initialised with the *original* password. Postgres container starts, reads `POSTGRES_PASSWORD` from compose env, fails authentication against its own existing role, and either:

- crashes on startup (if it tries to run init scripts), or worse,
- starts up but every connection from `varlens` fails with `password authentication failed for user "varlens"` — application 500s with no obvious operational signal until someone reads the logs.

The application service has no healthcheck against the DB, so Compose marks postgres "running" and varlens "running" while every API call dies.

**Why it hasn't fired yet:** Default mode is SQLite. The postgres profile has been exercised in dev/test (per AGENTS.md WGS perf), not in the live pilot.

**When it WILL fire:** First production run of `make stack-up DB=postgres` followed by any second invocation of `make stack-up`. Per the user's own roadmap, postgres is the web-track standard — this *will* be the first cycle to hit it once postgres is the default.

**Suggested fix:** Combination of F1 fix (rsync excludes `.env`) and a defensive measure: `compose/.env.example` should never carry a placeholder that gets sed-replaced into the live env. Move password generation out of stack-up entirely and into a dedicated bootstrap step (`make ensure-postgres-password`) that:

1. Reads `/etc/varlens/postgres-password` on the server, or
2. Generates+writes it once and persists to SOPS-encrypted `secrets/postgres.yaml` (mirror the restic password pattern).

The rsync exclude in F1 is the minimum; the structural fix is to stop treating `.env` as a regenerable artifact.

---

### F5: `_smoke()` and `make smoke` "direct port closed" probes give false greens via curl timeout

**Severity:** medium
**Files:** `web-deploy/Makefile:278-279`, `web-deploy/bin/varlens:438-492` (e2e equivalent)

**Latent trap:** Both smoke harnesses test that direct-to-host port 3001 (kuma) and 8080 (dozzle) are not externally reachable:

```make
check "Direct port 3001 closed"  "000" "$$(curl --max-time 3 -s -o /dev/null -w '%{http_code}' http://$$IP:3001/ 2>/dev/null)"
```

`%{http_code}` returns `000` for *any* failure — connection refused, connection timeout, TLS handshake error, DNS failure, route unreachable. A misconfigured firewall that *drops* (not rejects) the packet returns `000` after `--max-time 3`. So does a port that's actually listening but where the network path drops the response. So does a transient routing blip during the 3s window. **All produce `000` and the smoke claims "ok".** A genuinely-exposed port 3001 would only fail this check if Hetzner's public network served the response in <3s without dropping — which it does.

In practice the ports are bound `127.0.0.1:3001` in compose (correct), so external access *is* in fact denied. But the smoke probe doesn't verify that; it just verifies that *something* between operator and port doesn't return a 2xx within 3s. If the compose binding regresses to `0.0.0.0:3001` (a one-character bug), this smoke wouldn't catch it as long as UFW still blocks 3001.

**Why it hasn't fired yet:** UFW + 127.0.0.1 binding is doubly defensive. As long as either layer holds, the smoke stays green.

**When it WILL fire:** A future compose change that exposes 3001/8080 to the host's public interface, combined with a UFW rule edit that misses the new port. Both are independent bugs — but the smoke doesn't catch the conjunction because it can't tell "blocked" from "unbound".

**Suggested fix:** Replace the negative probe with a positive one. From a host other than the server, test that the host's public TCP connect to 3001 fails *fast* (connection refused / RST), not slow (timeout). `nc -z -w 1 $IP 3001` returns 1 quickly on RST and 1 slowly on drop — distinguishable by elapsed time. Or simpler: from inside the server, verify the bind via `ss -tlnp '( sport = :3001 )' | grep -q '127.0.0.1:3001'` and surface the result:

```bash
check "Kuma bound to localhost only" "yes" \
  "$$(ssh ... 'ss -tlnp sport = :3001 2>/dev/null | grep -qE "127\\.0\\.0\\.1:3001|\\[::1\\]:3001" && echo yes || echo no')"
```

That's a structural property check — much harder to spoof.

---

### F6: Caddy ACME 50-cert/IP/week limit is documented but not enforced or surfaced

**Severity:** medium
**Files:** `web-deploy/compose/Caddyfile:14-21`, `web-deploy/scripts/pilot.sh` (no probe)

**Latent trap:** The `tls-le-ip` profile uses Let's Encrypt's shortlived (7-day) profile. LE rate limits at 50 certificates per IP per week. Hetzner has a finite IPv4 pool per project; under heavy destroy/up cycling the *project*'s addresses are recycled across cycles. A given IP can therefore accumulate cert issuances across multiple operator cycles plus across multiple Hetzner customers if the IP was previously held by another tenant who also spammed ACME. Hitting the rate limit results in Caddy logging a 429 from the LE API and serving a self-signed fallback (or no cert at all) — the smoke probe `curl -ks` (insecure) would still return 200, so this fails *silently to operators relying on smoke*.

**Why it hasn't fired yet:** Cycle count has been low; same IP rarely reused often enough. The Caddyfile comment ("don't spin destroy/up cycles too often") relies on operator discipline.

**When it WILL fire:** A debugging session where the operator does 6+ destroy/up cycles in a day on the same IP, or unlucky IP-pool reuse where the prior tenant burned through the quota. Smoke goes green; browsers show "your connection is not private" for the rest of the week.

**Suggested fix:** Two complementary measures:

1. In `pilot.sh`, after step 5 (smoke), run a **strict** TLS validation that does NOT use `-k`:
   ```bash
   curl --fail --silent --show-error --max-time 10 https://$ip/welcome >/dev/null \
     || printf '%sWARN%s: TLS not browser-trusted — Caddy may have hit ACME rate limit\n' "$YELLOW" "$RESET"
   ```
   Make it warn-only (don't block the cycle), so operators get an explicit signal.

2. In `make smoke`, add a probe that reads Caddy's TLS issuance log:
   ```bash
   check "Caddy TLS not rate-limited" "0" \
     "$$(ssh ... 'docker logs caddy 2>&1 | grep -c "rateLimited"')"
   ```

---

### F7: Recovery-key file reservation persists across restarts even when admin already exists

**Severity:** medium
**Files:** `src/web/server.ts:138-156`, `src/web/server.ts:215-223`

**Latent trap:** The flow:

1. First boot with `VARLENS_ADMIN_*` set → `maybeBootstrapAdmin` writes `/data/admin-recovery-key.txt` (mode 0600), commits admin row.
2. Operator forgets to capture the file and delete it.
3. Operator restarts the container (image rotation, server reboot, etc.) with the same env still set.
4. `maybeBootstrapAdmin`'s pre-check finds the admin row → `skipped, reason: admin-exists` → returns early → file is never re-read or removed.

Result: the recovery key sits at 0600 on the volume indefinitely, surviving every restart, with the literal admin recovery secret in plaintext. If the volume is later restored from a restic snapshot to a different system, the key travels with it.

Worse: if an operator on cycle N+1 *also* sets `VARLENS_ADMIN_*` to *new* credentials thinking they're rotating the admin, the bootstrap is skipped and the new credentials are silently ignored. The operator has no way to know rotation didn't happen.

**Why it hasn't fired yet:** First-cycle operators have presumably captured the file. The drift only matters once someone tries to "rotate" via env vars or once a restic restore lands the file on a non-original volume.

**When it WILL fire:** First documented admin rotation. Or first restore drill where the marker file's presence isn't expected.

**Suggested fix:** Two changes in `src/web/server.ts`:

1. When the pre-check sees an existing admin AND `/data/admin-recovery-key.txt` exists, log at WARN with action=stale-recovery-key-present, instructing the operator to capture and delete. Don't auto-delete (might be the operator's only copy still uncaptured).
2. When the pre-check sees an existing admin AND `VARLENS_ADMIN_USERNAME`/`PASSWORD` are still in env, log at WARN that env-rotation is *not* supported and the credentials are being ignored. Direct operators to a future `varlens admin rotate` flow rather than letting them silently fail.

Optional cloud-init companion: a daily systemd timer that warns to journald if `/mnt/data/app/data/admin-recovery-key.txt` has existed for >24h, so operations sees the signal.

---

### F8: `setup-monitoring.py` writes incomplete `/etc/restic/env` if run before `setup-backup.py`

**Severity:** medium
**Files:** `web-deploy/scripts/setup-monitoring.py:362-393`, `web-deploy/cloud-init/pilot.yaml:90-91`

**Latent trap:** `setup-monitoring.py` reads `/etc/restic/env`, replaces or appends `HEARTBEAT_URL=...`, and writes the result back. If the file doesn't exist (line 372: `rc != 0` → `current = ""`), it cheerfully writes a *single-line* env file containing only `HEARTBEAT_URL=...`. The systemd unit's `ConditionPathExists=/etc/restic/env` (cloud-init pilot.yaml:90) now matches, so on the next 02:30 timer fire the backup service activates → the script's `: "${RESTIC_REPOSITORY:?...}"` fails, exit code propagates to systemd, and operators get a "restic-backup.service: Failed with result 'exit-code'" in journald that looks identical to a real backup failure.

Worse, the heartbeat URL is *only* set when monitoring runs. If a future `make pilot-fast` reorders or skips setup-backup, monitoring still "succeeds" with zero indication that there's no actual backup behind the heartbeat.

**Why it hasn't fired yet:** `pilot.sh` always runs setup-backup (step 3) before setup-monitoring (step 4), so the file exists with full content by the time monitoring touches it.

**When it WILL fire:** Any out-of-order invocation. E.g. an operator who reads the README and runs `make setup-monitoring` standalone first, expecting it to be a no-op precursor to backups.

**Suggested fix:** Make `setup-monitoring.py` refuse to write a half-file. Insert at line 372-374:

```python
rc, current, _ = ssh_stdout_only(ip, ssh_key, "sudo cat /etc/restic/env", check=False)
if rc != 0 or "RESTIC_REPOSITORY=" not in current:
    fail("/etc/restic/env not initialised — run `make setup-backup` first.")
```

Symmetric to setup-backup's preflight checks — fail loud, not silently produce a broken state.

---

### F9: `make pilot-down` does not clean up the restic backup bucket; next cycle aborts at setup-backup

**Severity:** medium
**Files:** `web-deploy/scripts/pilot-down.sh:33-58`, `web-deploy/Makefile:243-250`, `web-deploy/scripts/setup-backup.py:563-614`

**Latent trap:** `pilot-down.sh` calls `varlens pilot down` which calls `tofu destroy`. That handles the server, volume, and IP. The S3 bucket `varlens-pilot-backup` and the SOPS-encrypted restic password in `secrets/restic.yaml` are explicitly out of scope (commented as "Backups in restic are out of scope and survive"). The next `make pilot` therefore:

1. Provisions a fresh server (clean tofu state) — fine.
2. `make stack-up` — fine.
3. `make setup-backup` runs against the *existing* bucket, finds `config` object → preflight detects "existing backup artifacts" → exits 3 demanding `--reuse` or `--force`.
4. Cycle aborts at step 3.

The fix item #6 in user-context teaches operators to pass `SETUP_BACKUP_ARGS=--force` for greenfield, but `pilot.sh` doesn't pass it. So **every second `make pilot` run fails by default** unless the operator either (a) preserved the local `secrets/restic.yaml` (then `--reuse` works), or (b) explicitly destroys the bucket via `make destroy-bucket` first.

**Why it hasn't fired yet:** Most cycles so far have been first-time provisions, or operators have learned the `--force` dance.

**When it WILL fire:** Any "I forgot how this works" cycle 30 days from now.

**Suggested fix:** Have `pilot-down.sh` *offer* (not force) bucket teardown:

```bash
echo
echo "The restic backup bucket survives this teardown."
echo "  - Keep it (next 'make pilot' must use SETUP_BACKUP_ARGS=--reuse with the same SOPS secret)"
echo "  - Destroy it now (clean greenfield for next cycle, snapshots permanently lost)"
read -rp "Destroy bucket? [y/N]: " choice
if [[ "$choice" =~ ^[yY]$ ]]; then
  make destroy-bucket DESTROY_BUCKET_ARGS=--yes
fi
```

Pair with a `pilot.sh` enhancement: when the bucket exists *and* `secrets/restic.yaml` is present locally, default to `--reuse`; when the bucket exists but the SOPS file is gone, fail fast with a clear "either restore the SOPS file from git or `make destroy-bucket` to start fresh" message.

---

### F10: `unattended-upgrades` auto-reboot at 03:30 can interleave with the 02:30 restic backup timer

**Severity:** low
**Files:** `web-deploy/cloud-init/pilot.yaml:60-66`, `web-deploy/cloud-init/pilot.yaml:108-115`

**Latent trap:** Backup timer fires `OnCalendar=*-*-* 02:30:00` with `RandomizedDelaySec=15min` → backup starts somewhere in 02:30–02:45. Restic on a 50 GB volume can take 10–60 minutes for a non-trivial dataset (full first run particularly). Auto-reboot is configured for 03:30. If a backup is mid-flight at 03:30, systemd kills `restic-backup.service` with SIGTERM (default 90s timeout) and reboots. Restic locks the repo for the duration of a backup; an interrupted run leaves a stale lock file that subsequent runs will refuse to touch until `restic unlock` is called manually.

**Why it hasn't fired yet:** The Concept Pilot dataset is currently tiny — first backup is sub-second. The collision window is theoretical.

**When it WILL fire:** First time someone imports a real dataset and the daily backup starts taking >45 minutes. The next morning a stale lock makes every subsequent backup fail; nobody notices for days because Kuma still shows the *previous successful* push and only flips red after 25h of no heartbeat.

**Suggested fix:** Either move the backup or the reboot, and add lock-detection to the backup script. Easiest: change the backup `OnCalendar` to `01:30` (in pilot.yaml:110) — gives 2h headroom before the auto-reboot window. And in `varlens-backup.sh` (pilot.yaml:178+), add a stale-lock heuristic before `restic backup`:

```bash
# If a lock is older than 2h, it's almost certainly stale (a real backup
# that long would have hit the next-day timer). Surface and unlock.
if restic list locks --no-lock 2>/dev/null | grep -q .; then
    restic unlock --remove-all   # safe: we run as the only writer
fi
```

Cheap insurance against the "stale lock from interrupted backup" failure mode.

---

### F11: GHCR_TOKEN expiration has no probe; failure mode is opaque

**Severity:** low
**Files:** `web-deploy/scripts/pilot.sh:173-179`, `web-deploy/Makefile:159-166`

**Latent trap:** `pilot.sh`'s preflight only checks that `GHCR_TOKEN` is non-empty. GitHub PATs expire (default 30/60/90/180 days). An expired token survives the preflight, then fails at `make stack-up`'s `docker login ghcr.io` with a generic "denied: denied" or "authentication required" — the operator has to remember "oh, the PAT". Worse: if the token is *partially* valid (e.g., still works for `docker login` but not for the package scope), login succeeds, pull fails later with `unauthorized` against a specific layer.

**Why it hasn't fired yet:** Tokens are still fresh.

**When it WILL fire:** Predictably, on the PAT's expiry date.

**Suggested fix:** Probe in `pilot.sh:preflight()`:

```bash
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  ghcr_user="${GHCR_USER:-robspan}"
  if ! curl -fsS -u "$ghcr_user:$GHCR_TOKEN" -o /dev/null \
       https://ghcr.io/v2/$ghcr_user/varlens-web/manifests/edge 2>/dev/null; then
    printf '  %s✗%s GHCR_TOKEN cannot read varlens-web manifests — token expired or scope reduced\n' "$RED" "$RESET"
    errors=$((errors + 1))
  else
    printf '  %s✓%s GHCR_TOKEN can read ghcr.io/%s/varlens-web\n' "$GREEN" "$RESET" "$ghcr_user"
  fi
fi
```

Three seconds of preflight saves a 90-second confusing stack-up failure.

---

### F12: SQLite live-backup consistency is not addressed; restic snapshot can be torn

**Severity:** low
**Files:** `web-deploy/cloud-init/pilot.yaml:178-203` (varlens-backup.sh body), `src/web/server.ts:58-62` (no quiesce hook)

**Latent trap:** The backup script `restic backup /mnt/data` runs while the varlens container is live and writing to `/mnt/data/app/data/varlens.db`. SQLite's WAL mode keeps `varlens.db`, `varlens.db-wal`, and `varlens.db-shm` in sync via memory-mapped pages; a naive file-level snapshot taken mid-write captures a torn state where the DB header points at WAL frames that the snapshot didn't capture. On restore, SQLite may either auto-recover (best case) or report `database disk image is malformed` (worst case).

The `restore-drill` exercises a marker file under `/mnt/data` — *not* the SQLite DB — so the drill never surfaces this.

**Why it hasn't fired yet:** No live writes during the 02:30 window in current usage. SQLite is forgiving about WAL recovery in many cases.

**When it WILL fire:** Once the pilot has actual users hitting it overnight (or once timezone differences mean 02:30 server time is daytime user activity). One in N restores will hit malformed-DB and require manual `.recover` intervention.

**Suggested fix:** Two cheap options:

1. Pre-snapshot quiesce: have `varlens-backup.sh` issue `docker exec varlens sqlite3 /data/varlens.db '.backup /data/varlens.db.snapshot'` before the restic call, then back up the `.snapshot` file. SQLite's online backup API guarantees consistency.
2. Or: `restic backup` with `--exclude '*.db-wal' --exclude '*.db-shm'` and accept that the WAL is dropped — varlens on restart replays from `varlens.db` alone after `PRAGMA wal_checkpoint(TRUNCATE)`. Cheaper, slightly riskier.

Either way, extend `restore-drill.sh` to also assert `sqlite3 varlens.db 'PRAGMA integrity_check'` returns `ok` post-restore — that's the test that would catch regressions in this area.

---

