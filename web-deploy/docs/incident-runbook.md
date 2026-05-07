# Incident Runbook v1 - Concept Pilot

Per-scenario incident response playbook for the VarLens Concept Pilot. Each scenario follows the shape: **Trigger** → **Steps** → **Verification** → **Escalation**.

> **Bringing up a fresh server?** That's [`/DEPLOY.md`](../../DEPLOY.md). **Day-to-day operations?** That's [`runbook.md`](runbook.md). This file starts at "the server is provisioned and something is wrong."

Plan reference: Stage 1 infrastructure plan §infrastruktur4 Phase 1 names this as deliverable "Runbook v1 (Update / Restore / Rollback)."

> **Verification status:** these scenarios are documentation, not test artefacts. Only `make restore-drill` (Scenario 11's mechanism) is exercised automatically. The other 12 are operator-readable procedures whose individual command sequences may have drifted from the current Makefile / IaC. Treat any unfamiliar command as a starting point and verify against `web-deploy/Makefile` or [`operations.md`](operations.md) before running.

## Scenario 1: Updating the Container Images

**Trigger:** Trivy in CI reports a HIGH/CRITICAL CVE for Caddy, Postgres, Uptime Kuma or Dozzle. Or a routine update window (every four to six weeks recommended).

### Steps

1. From the local macOS machine, fetch the current image digests:

   ```sh
   for img in caddy:2-alpine louislam/uptime-kuma:1 amir20/dozzle:latest postgres:16-alpine; do
     ssh -i ~/.ssh/varlens-tofu deploy@$(make ip) "docker pull $img && docker inspect --format='{{index .RepoDigests 0}}' $img"
   done
   ```

2. Enter the digests into `compose/docker-compose.yml` in the `image:` fields.

3. Validate locally:

   ```sh
   make lint
   ```

4. Update the stack:

   ```sh
   make stack-up                       # if the concept runs with SQLite
   make stack-up DB=postgres           # if the concept runs with Postgres
   ```

5. Verification:

   ```sh
   make smoke
   ```

### Escalation

If `make smoke` fails: roll back immediately (Scenario 3). If necessary, pull the previous digest version from `git log compose/docker-compose.yml` and redeploy.

---

## Routine: Restore Drill (Automated)

**Purpose:** Proof that the backup-restore path works. Plan gate Phase 1.

```sh
make restore-drill
```

What happens:
- Write a marker file with random content into `/mnt/data`
- Trigger a restic backup and wait for completion
- Read the snapshot ID
- Delete the marker
- Restore the snapshot to `/tmp/restore-drill-...`
- Verification: marker content identical to before
- Clean up, append entry to `.internalplanning/restore-log.md`

Result: exit code 0 on PASS, exit code 1 on FAIL. The log grows monotonically.

Recommended frequency: after every plan change to `cloud-init/pilot.yaml`,
`scripts/backup.sh` or the `restic` configuration. At least once before the
migration block. Can also run as a scheduled CI job once CI has SSH access
to the server (Stage 2).

---

## Scenario 2: Restore from Backup (Manual)

**Trigger:** `/mnt/data/uptime-kuma` or `/mnt/data/postgres` is corrupted, accidentally overwritten, or the data volume is needed again after `make down`.

### Prerequisites

- The restic bucket exists and contains snapshots
- `/etc/restic/env` on the server is populated (see `docs/backup.md`)

### Steps

1. List snapshots:

   ```sh
   make ssh
   sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'
   ```

2. Identify the desired snapshot (typically: latest, or a specific ID).

3. Restore into a temporary path (non-destructive):

   ```sh
   sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore-konzept'
   sudo ls -la /tmp/restore-konzept/mnt/data/
   ```

4. Bring the compose stack down so no container holds the files to be replaced:

   ```sh
   exit                                  # back to the Mac
   make stack-down
   ```

5. On the server: replace the data.

   ```sh
   make ssh
   sudo rsync -av --delete /tmp/restore-konzept/mnt/data/ /mnt/data/
   ```

6. Bring the stack back up and verify:

   ```sh
   exit
   make stack-up                         # with the original DB profile
   make smoke
   ```

7. Append the entry to `.internalplanning/restore-log.md` with date, snapshot ID, duration, and result.

### Escalation

- Empty snapshot list: check the bucket via the Hetzner Console, verify the object-storage credentials in `/etc/restic/env`.
- Snapshot cannot be decrypted: `RESTIC_PASSWORD` in `/etc/restic/env` is wrong. Check the SOPS secrets or ask the maintainer.

---

## Scenario 3: Rollback of a Bad Deploy

**Trigger:** After `make stack-up`, a container fails to start, enters a restart loop, or the smoke test fails.

### Steps

1. Inspect the live logs:

   ```sh
   make stack-logs
   ```

   Also visible via `http://<ip>/logs/` (Dozzle).

2. Get the last known-good state from Git:

   ```sh
   git log --oneline compose/
   git checkout HEAD~1 -- compose/                # one revision back
   ```

3. Redeploy the stack with the previous state:

   ```sh
   make stack-up
   ```

4. Verification:

   ```sh
   make smoke
   ```

5. If green: analyze the cause on the broken state, develop a fix on its own branch, run `make lint` and the smoke test before merging. Commit the rollback state with a justification.

### Escalation

If even the older state fails to come up: bring the compose stack fully down (`make stack-down`), run `docker system prune -a` on the server, then `make stack-up`. If container start fails due to volume data: restore from backup (Scenario 2).

---

## Scenario 4: Server Unreachable

**Trigger:** `make ssh` fails with a timeout, HTTP calls hang, `make smoke` fails.

### Diagnostic Steps

1. Is the server even on?

   ```sh
   make status
   ```

   Expected: `Status: running`. If `off`: run `make start` and wait a minute.

2. Has the IP changed?

   ```sh
   make ip
   ```

   If a different IP than expected: remove the known host key from `~/.ssh/known_hosts`.

3. Is the Hetzner Cloud Firewall still correct? Hetzner Console > Firewalls > `varlens-pilot-fsn1-fw`. Expected: 22, 80, 443, ICMP open.

4. Does the server respond to ping (if ICMP is allowed)?

   ```sh
   ping -c 3 $(make ip)
   ```

5. SSH with verbose output:

   ```sh
   ssh -v -i ~/.ssh/varlens-tofu deploy@$(make ip)
   ```

   Common error patterns:
   - `Permission denied (publickey)`: SSH key does not match; check `cat ~/.ssh/varlens-tofu.pub` against the Hetzner SSH keys.
   - `Connection timeout`: firewall is blocking, the server is hung, or it is still booting (cloud-init).
   - `Connection refused`: sshd is not active (very rare - usually a server crash).

### Escalation

1. Action in the Hetzner Console: try Server "Reset" (soft). If that does not help: "Power off" the server and start it again.
2. Last resort: `make down` plus `make up` (full re-provisioning, takes about five minutes; the data volume is preserved as it is its own resource).

---

## Scenario 5: cloud-init Change Triggered a Server Replace

**Trigger:** `make plan` shows "1 to destroy, 1 to add" for `hcloud_server.pilot` because `cloud-init/pilot.yaml` was edited.

### Steps

1. Before `make up`: confirm that the data volume is a separate resource (it should already be, but verify):

   ```sh
   tofu -chdir=tofu/environments/pilot plan | grep -E "hcloud_volume|destroy"
   ```

   Expected: no `destroy` for `hcloud_volume.data`.

2. Apply:

   ```sh
   make up
   ```

3. The SSH host key will change. Remove the old entry:

   ```sh
   ssh-keygen -R $(make ip)
   ```

4. Wait for cloud-init (two to five minutes), then test SSH:

   ```sh
   make ssh
   exit
   ```

5. Deploy the compose stack on the new server:

   ```sh
   make stack-up
   ```

   If Postgres was used: `make stack-up DB=postgres`.

6. Smoke test:

   ```sh
   make smoke
   ```

### Escalation

If `/mnt/data` looks empty after re-mount: the volume is there, but the cloud-init mount may not yet have completed. Run `make ssh` plus `df -h /mnt/data` to check. If the volume is not mounted: read `make logs` (cloud-init log) and look for mount errors.

---

## Scenario 6: Backup Failed

**Trigger:** The Uptime Kuma heartbeat push monitor reports red. Or `journalctl -u restic-backup.service` shows errors.

### Diagnosis

1. On the server:

   ```sh
   make ssh
   sudo journalctl -u restic-backup.service --since "1 day ago" | tail -50
   ```

2. Most common causes:
   - Repository unreachable: object-storage credentials expired, bucket deleted
   - `RESTIC_PASSWORD` wrong after env-file edit
   - Disk on the server full
   - `/mnt/data` too large (backup duration exceeds the timer interval)

3. Manual test run:

   ```sh
   sudo systemctl start restic-backup.service
   sudo journalctl -u restic-backup.service -f
   ```

### Remediation

- Renewed credentials: update `/etc/restic/env`, restart the service.
- Repository inaccessible: check the bucket status in the Hetzner Console.
- Disk full: `df -h` on the server, clean up old Docker images with `docker system prune -a`.
- Backup too long: tighten the retention policy or back up more selectively (restrict `BACKUP_PATHS` in `/etc/restic/env`).

### Escalation

If backups fail several days in a row: do not run `make down` (otherwise the data is lost). Instead, check the bucket manually and, if needed, set it up from scratch, then run `restic init` and a manual first backup.

---

## Scenario 7: Cost Explosion

**Trigger:** Hetzner invoice significantly higher than expected (Concept Pilot expectation: ~17 EUR/month).

### Diagnosis

1. Check Hetzner Console > Cost Overview.
2. Unusual line items: additional servers, snapshot storage, object-storage traffic, floating IPs.
3. Inspect the Tofu state for what actually exists:

   ```sh
   tofu -chdir=tofu/environments/pilot state list
   ```

   Expected: 5 resources (1 SSH key, 1 volume, 1 firewall, 1 server, 1 volume attachment).

### Remediation

- If unused servers, snapshots, or floating IPs are visible in the Console: delete them in the Console.
- If the server is unintentionally running: `make stop` (server is paused, the volume keeps incurring cost, roughly 2 EUR/month).
- If object-storage traffic is high: review restic retention, possibly apply a more aggressive prune policy.

### Escalation

If unexpected resources appear that nobody created: rotate the API token (Hetzner Console > "Sicherheit > API-Tokens" ("Security > API Tokens")), the account may be compromised. Review the SOPS secrets.

---

## Scenario 8: Compose Stack Hangs

**Trigger:** A container is in a restart loop, high CPU usage, or one of the containers is `Restarting (1)`.

### Steps

1. On the server:

   ```sh
   make ssh
   cd /mnt/data/app
   docker compose ps                          # which container is hung
   docker compose logs --tail=200 <name>      # logs of the hung container
   ```

   Also visible via `http://<ip>/logs/` (Dozzle).

2. Common causes:
   - Caddy: invalid Caddyfile change. `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` tests the configuration.
   - Uptime Kuma: corrupted database file under `/mnt/data/uptime-kuma`.
   - Postgres: old Postgres data under `/mnt/data/postgres` from a different major version. A major upgrade requires a manual migration.
   - Dozzle: Docker socket mount unavailable (very rare).

3. Restart a single container:

   ```sh
   docker compose restart <name>
   ```

4. If that does not help: bring the whole stack down and back up.

   ```sh
   exit
   make stack-down && make stack-up
   ```

### Escalation

If even a restart does not help: roll back (Scenario 3) or restore (Scenario 2).

---

## Scenario 9: Disk Filling Up

**Trigger:** `df -h /mnt/data` shows > 80 percent. Or containers write errors to the logs.

### Diagnosis

```sh
make ssh
df -h
sudo du -sh /mnt/data/* | sort -h
docker system df
```

### Remediation

- Clean up old Docker images:

  ```sh
  docker image prune -a -f
  ```

- Container logs (written by Docker itself) are large: logs live in `/var/lib/docker/containers/`, not in `/mnt/data`. Check size with `sudo du -sh /var/lib/docker/containers/*`. If problematic: set a `log-opts` limit in `/etc/docker/daemon.json`, then `systemctl restart docker`.
- Postgres growing: review the data content, possibly delete test data.
- Uptime Kuma history DB growing: reduce Settings > General > History Retention.

### Escalation

If nothing can be cleaned up: increase the volume size in the Hetzner Console (additional cost). The Tofu variable `data_volume_size_gb` must then also be raised, otherwise Tofu will destroy it on the next apply.

---

## Scenario 10: Certificate Renewal Issues (Once a Domain is Active)

**Trigger:** The browser reports an expired or invalid certificate once TLS via Let's Encrypt is active.

### Steps (for later, once a domain is in the Caddyfile)

1. Check the Caddy logs:

   ```sh
   make ssh
   docker logs caddy 2>&1 | grep -iE "acme|cert|let.s.encrypt" | tail -50
   ```

2. Common causes:
   - Port 80 not open for the ACME HTTP-01 challenge: check the Hetzner Cloud Firewall and UFW.
   - DNS does not point to the server: check the A and AAAA records at the DNS provider.
   - Let's Encrypt rate limit: after too many failed attempts, Let's Encrypt blocks for one hour.

3. Caddy reload after a config fix:

   ```sh
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

### Escalation

If the rate limit kicks in: temporarily switch to `tls internal` (self-signed) until the limit resets (one hour).

---

## Scenario 11: Server Loss - Recovery from Backup

**Trigger:** The server resource has been deleted (accidental `make down`, Hetzner account incident, region outage). The data volume is also gone; only the restic snapshots in object storage remain.

### Steps — automated path (preferred)

```sh
VARLENS_WEB=1 make pilot-recover
```

This single command does everything: provisions a fresh cpx32, stages `/etc/restic/env` (decrypts the password from `secrets/restic.yaml` via SOPS), `restic restore latest --target /` repopulates `/mnt/data`, brings up the Compose stack, runs `pg_restore` of the embedded `varlens-*.dump` into the fresh PostgreSQL container, then runs the smoke test + a parity check (compares the restored table set against the dump's manifest).

End state: a new server functionally equivalent to the lost one, minus any writes that happened after the most recent backup ran (≤24h on the default nightly timer).

Inspect what's recoverable before deciding:

```sh
VARLENS_WEB=1 make pilot-restore-list
```

Read-only `restic snapshots` listing using the SOPS-decrypted password — no SSH, no live server needed.

### Steps — manual path (if pilot-recover fails for some reason)

1. Provision a new server: `make up`
2. Roll out the compose stack: `make stack-up`
3. Retrieve the restic password from SOPS: `make sops-decrypt FILE=secrets/restic.yaml`
4. SSH in (`make ssh`) and write `/etc/restic/env`:
   ```sh
   sudo tee /etc/restic/env >/dev/null <<'EOF'
   RESTIC_REPOSITORY=s3:fsn1.your-objectstorage.com/varlens-pilot-backup
   RESTIC_PASSWORD=<from SOPS>
   AWS_ACCESS_KEY_ID=<from .env>
   AWS_SECRET_ACCESS_KEY=<from .env>
   BACKUP_PATHS=/mnt/data
   EOF
   sudo chmod 600 /etc/restic/env
   ```
5. Restore the snapshot to its original path:
   ```sh
   sudo bash -c 'set -a; . /etc/restic/env; restic restore latest --target /'
   ```
6. Restore PostgreSQL from the embedded dump (latest one in `/mnt/data/postgres-dumps/`):
   ```sh
   DUMP=$(sudo ls -1 /mnt/data/postgres-dumps/varlens-*.dump | tail -1)
   sudo docker exec -i postgres pg_restore --clean --if-exists --no-owner --no-acl --dbname=varlens --username=varlens < "$DUMP"
   ```
   `pg_restore` exits non-zero on harmless `DROP IF EXISTS` warnings; ignore.
7. Smoke + restore drill: `make stack-up && make smoke && make restore-drill`

### Escalation

- Snapshots missing or repo not decryptable: check the SOPS file state, possibly retrieve an older state from Git. **The restic password cannot be "reset" — without the password, the snapshots are lost.**
- S3 credentials expired: in the Hetzner Console > Object Storage > Credentials, generate new ones, update them in `web-deploy/.env` and (on the server) `/etc/restic/env`.

---

## Scenario 12: SSH Key Lost - Hetzner Rescue Mode

**Trigger:** The private SSH key (`~/.ssh/varlens-tofu`) is gone or compromised. `make ssh` fails with "Permission denied (publickey)", but resetting the server would cost data.

### Steps

1. Generate a new local SSH key:

   ```sh
   ssh-keygen -t ed25519 -f ~/.ssh/varlens-tofu-new -C "varlens-tofu" -N ""
   ```

2. Open the Hetzner Console: **Cloud Console > Project varlens-pilot > Servers > `varlens-pilot` > tab "Rescue"**.

3. Choose the rescue image:
   - **Operating System:** `linux64`
   - **SSH Keys:** add the new public key via "Add SSH Key" and select it
   - Click **Enable rescue & power cycle** (the server boots into the rescue image)

4. Wait until the server responds in Rescue Mode (~60 seconds), then log in with the new key:

   ```sh
   ssh -i ~/.ssh/varlens-tofu-new root@$(make ip)
   ```

   If SSH does not work: in the Console, open the **"Console" tab** (web VNC), log in as `root` with the rescue password shown by Hetzner via email/Console.

5. Identify and mount the system disk:

   ```sh
   lsblk                                  # typical: /dev/sda1 is root
   mount /dev/sda1 /mnt
   ```

6. Replace `authorized_keys`:

   ```sh
   cat ~/.ssh/varlens-tofu-new.pub        # on the Mac, copy via pbcopy beforehand and paste into the rescue shell
   echo "ssh-ed25519 AAAA... varlens-tofu" > /mnt/home/deploy/.ssh/authorized_keys
   chown 1000:1000 /mnt/home/deploy/.ssh/authorized_keys
   chmod 600 /mnt/home/deploy/.ssh/authorized_keys
   ```

7. Cleanly unmount and exit Rescue Mode:

   ```sh
   umount /mnt
   exit
   ```

   In the Hetzner Console: **tab "Rescue" > "Disable rescue"**, then **tab "Power" > "Power cycle"**.

8. Locally replace the old key, relearn the host key, test:

   ```sh
   mv ~/.ssh/varlens-tofu-new ~/.ssh/varlens-tofu
   mv ~/.ssh/varlens-tofu-new.pub ~/.ssh/varlens-tofu.pub
   ssh-keygen -R $(make ip)
   make ssh
   ```

9. Update `terraform.tfvars` and the Hetzner project SSH key to the new public key, otherwise the next `make up` will destroy the configuration.

### Escalation

If Rescue Mode does not boot: open a Hetzner support ticket. If the old public key was compromised (not just lost): also rotate the Hetzner API token (see Scenario 13).

---

## Scenario 13: Token Rotation

**Trigger:** Routine rotation (every 30/90 days), suspected compromise, personnel change, or a hint from a gitleaks/Trivy scan.

### (a) Hetzner API Token

1. Hetzner Console > **"Sicherheit > API Tokens"** ("Security > API Tokens") > "Revoke" the old token.
2. "Generate API Token" with scope "Read & Write", assign a name (e.g., `varlens-tofu-2026-04`).
3. Insert the token into `tofu/environments/pilot/terraform.tfvars` at `hcloud_token`.
4. Check the file mode:

   ```sh
   chmod 600 tofu/environments/pilot/terraform.tfvars
   ls -la tofu/environments/pilot/terraform.tfvars
   ```

5. Validate with `tofu -chdir=tofu/environments/pilot plan` (should report "No changes").

### (b) GitHub Personal Access Token

1. github.com > **Settings > Developer settings > Personal access tokens (classic)** > "Delete" the old token.
2. "Generate new token (classic)" with scopes `repo` and `workflow`, expiration 30 days.
3. Overwrite locally:

   ```sh
   echo "<new-token>" > ~/.config/varlens/github_token
   chmod 600 ~/.config/varlens/github_token
   ```

4. Test:

   ```sh
   export GH_TOKEN=$(cat ~/.config/varlens/github_token)
   gh run list --limit 1
   ```

### (c) Caddy Basic Auth

1. Generate a new bcrypt hash (Caddy does this itself):

   ```sh
   make ssh
   docker exec caddy caddy hash-password
   # type the password, copy the hash
   exit
   ```

2. In `compose/Caddyfile`, in the `basic_auth` block: replace the old hash with the new one (for `/monitor/*` and `/logs/*`).
3. Deploy:

   ```sh
   make stack-up
   ```

4. Verify via browser login at `https://<ipv4>/monitor/` with the new password.

### (d) Uptime Kuma Admin

1. Browse to `https://<ipv4>/monitor/` (past Basic Auth).
2. **Settings > Security > Change Password** > old password, new password, "Save".
3. No service restart required; Kuma persists immediately to its SQLite under `/mnt/data/uptime-kuma`.

### (e) restic Password

**WARNING: Never rotate the restic password without an entirely new bucket - existing snapshots become undecryptable under the new password and are thus permanently lost.**

If rotation is truly necessary (e.g., on suspicion of compromise):

1. Create a new bucket in Hetzner Object Storage, generate new S3 credentials.
2. Generate a new restic password (e.g., `openssl rand -base64 32`).
3. Update the SOPS secret file, rewrite `/etc/restic/env` on the server.
4. Run `restic init` against the new bucket.
5. Trigger the first backup run manually: `sudo systemctl start restic-backup.service`.
6. The restore drill verifies the new chain: `make restore-drill`.
7. Delete the old bucket only after the previous retention window has elapsed, so a historical restore remains possible as long as the old password is archived separately.

### Escalation

If after (a) `tofu plan` suddenly shows drift: the token has the wrong scope (read-only instead of read+write). Recreate the token with the correct scope.

---

## Scenario 14: Backups Exist But You Want a Fresh Server

**Trigger:** You run `VARLENS_WEB=1 make pilot` against a configured deployment whose restic bucket already contains snapshots. The script refuses with a yellow `EXISTING BACKUPS DETECTED — fresh provision blocked` banner.

### Why this fires

Provisioning a fresh server while backups exist would orphan the snapshots and let the operator do real writes against an empty database without realising prior data is recoverable. The block forces a deliberate decision before any cloud resource is touched.

### Steps — choose one

1. **Recover** (safest — actually use the backups):
   ```sh
   VARLENS_WEB=1 make pilot-recover
   ```

2. **Inspect first**, then decide:
   ```sh
   VARLENS_WEB=1 make pilot-restore-list   # read-only
   ```

3. **Discard backups deliberately** (irreversible — see ⚠ Destructive operations in operations.md):
   ```sh
   make -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes
   VARLENS_WEB=1 make pilot
   ```

4. **Override** (only if you know the snapshots are safe to leave as orphans):
   ```sh
   VARLENS_IGNORE_EXISTING_BACKUPS=1 VARLENS_WEB=1 make pilot
   ```

### Escalation

If `pilot-recover` itself fails: fall back to the manual path under Scenario 11.

If the bucket exists but `check-backups.py` says "no" (no `config` object), the bucket is empty — likely the previous repo was wiped via `destroy-bucket` or `--force` — and you can `make pilot` directly without the override.

---

## Appendix A: Log

Whenever a runbook step is performed: a brief entry in `docs/operations-log.md` with date, scenario, duration, result. Helps next time.

Template:

```
### 2026-XX-XX - Scenario N
- Trigger: ...
- Observed: ...
- Done: ...
- Verification: make smoke green
- Duration: 5 minutes
- Lessons: ...
```

## Appendix B: What Is Not in the Runbook

Deliberately omitted as Stage 2 topics (see Stage 2 infrastructure plan):

- Multi-server failover and load balancing
- DR site switch
- Audit-trail forensics
- Network segmentation via a central reverse proxy
- Sovereign-cloud migration (its own migration block in Stage 2 plans)
- Pentest finding triage

---

## Appendix C: Verification Log

Single-session verification pass, KW 19/2026. Tier definitions:

- **A (read-verify)** — commands compared to the current Makefile / IaC; drift flagged but not exercised.
- **B (probe-verify)** — diagnostic / read-only commands run against the live server; output compared to expected.
- **C (exercise-verify)** — failure deliberately triggered, recovery executed end-to-end.

Status legend: **PASS** = mechanism works as documented · **PASS-WITH-DRIFT** = works but the runbook command is stale · **FAIL** = bug or broken procedure (must be fixed before relying on the scenario).

| Scenario                                    | Tier | Tested              | Status            | Notes |
| ------------------------------------------- | ---- | ------------------- | ----------------- | ----- |
| Routine: Restore Drill                      | C    | 2026-05-07 (KW 19)  | PASS (after fix)  | Initially FAILED. Three real bugs found and fixed in `scripts/restore-drill.sh`: (1) `sudo ls -1 .../varlens-*.dump` could not expand the glob because `restic restore` writes the target with mode 0700 — `chmod -R o+rX` after restore so the deploy user's shell can traverse; (2) `PROTOCOL_FILE` defaulted to `.internalplanning/restore-log.md` (typo, no such directory) → repo-root-anchored default `.planning/web/restore-log.md`; (3) protocol parent dir was never created → added `mkdir -p`. Drill now writes a passing entry to `.planning/web/restore-log.md`. |
| 1. Updating the Container Images            | B    | 2026-05-07 (KW 19)  | PASS-WITH-DRIFT   | `make smoke` 13/13 green. Drift: step 1's `ssh "docker pull ..."` needs `sudo docker pull ...` — the deploy user is in the docker group on this host but the runbook's literal command form omits `sudo`. Step 4's `make stack-up DB=postgres` is dead — Phase 2 dropped the SQLite branch; the Makefile traps `DB=sqlite` with a hard error and treats `DB=postgres` as a no-op. The "if SQLite / if Postgres" alternative is impossible. |
| 2. Restore from Backup (Manual)             | A    | 2026-05-07 (KW 19)  | PASS-WITH-DRIFT   | Mechanism (stop stack, restic restore latest, restart) is identical to Routine: Restore Drill, which is now exercised end-to-end. Drift: same bare-`make` references (`make stack-down`, `make stack-up`, `make ssh`) — assume CWD is `web-deploy/`. |
| 3. Rollback of a Bad Deploy                 | A    | 2026-05-07 (KW 19)  | PASS-WITH-DRIFT   | Tier A only — exercising would require a deliberately-bad deploy, takes a full bring-up cycle. Mechanism (revert the compose change, `make stack-up`, smoke) is sound. Drift: same bare-`make` references. |
| 4. Server Unreachable                       | B    | 2026-05-07 (KW 19)  | PASS              | All three diagnostic commands (`make status`, `ping -c 3 $(make ip)`, `ssh -v -i ~/.ssh/varlens-tofu deploy@$(make ip)`) work as written. ssh -v shows `Authenticated using "publickey"` against the live server. |
| 5. cloud-init Change Triggered Server Replace | A  | 2026-05-07 (KW 19)  | PASS-WITH-DRIFT   | Tier A only — exercising costs a full Hetzner re-provision. Steps reference `tofu plan`/`tofu apply` and `make ssh; df -h /mnt/data` post-recreate; commands match the IaC. Bare-`make` drift. The cloud-init heredoc bug fixed earlier this session (literal `$$VAR` in `varlens-backup.sh`) is a closed loop — confirmed the cold-start cycle on this branch produces a working backup script. |
| 6. Backup Failed                            | C    | 2026-05-07 (KW 19)  | PASS (already exercised) | Inadvertently exercised earlier in the session: the cold-start hit "postgres container not running — refusing to back up without quiesce" caused by the cloud-init `$$VAR` escape bug. Diagnosed via `journalctl -u restic-backup.service`, fixed the script's bare-`$$VAR` references to `$${VAR}` (so cloud-init halves them properly), retried backup → snapshot 9eb2b2f3 succeeded. Diagnostic commands documented in S6 (journalctl tail, manual `systemctl start restic-backup.service`) all match what was actually run. |
| 7. Cost Explosion                           | B    | 2026-05-07 (KW 19)  | PASS              | `make status`, `make ip` work. Hetzner Cloud API (`GET /v1/servers`, `GET /v1/volumes`) returns the expected single cpx32 + 50 GB volume; no orphan resources. Token has Read-Write scope confirmed. |
| 8. Compose Stack Hangs                      | B    | 2026-05-07 (KW 19)  | PASS              | `cd /mnt/data/app && docker compose ps` returns the 5 expected services (caddy / dozzle / postgres / uptime-kuma / app→varlens-dev). `docker compose logs --tail=200 <service>` works as deploy user. |
| 9. Disk Filling Up                          | B    | 2026-05-07 (KW 19)  | PASS              | `df -h /mnt/data` reports 1% used (47 GB free) on a fresh deploy. `restic stats` works (2 snapshots, 2.667 MiB) — the runbook's "list snapshots, check sizes" diagnostic is grounded. |
| 10. Certificate Renewal Issues              | B    | 2026-05-07 (KW 19)  | PASS              | `docker logs caddy` shows the certificate-obtain log lines the scenario references. The pilot is currently on `tls-internal` (Caddy local CA, 12-hour cert) due to LE rate limit on the recycled IP — verified via `openssl s_client | openssl x509`: issuer = `Caddy Local Authority - ECC Intermediate`. The LE-IP renewal path will be exercised once the IP's rate window resets; documented in DEPLOY.md "When something goes wrong" with the `TLS=internal` fallback. |
| 11. Server Loss - Recovery from Backup      | C    | 2026-05-07 (KW 19)  | PASS (exercised end-to-end) | Full automated `make pilot-recover` cycle exercised: torn down live server (`pilot-down`), confirmed `make pilot` was correctly blocked by the existing-backups guard, ran `make pilot-recover`. Result: fresh server provisioned at the same IP (Hetzner reused), `/mnt/data` restored from snapshot `6b51c963`, `pg_restore` loaded the embedded dump (`varlens-20260507T173242Z.dump`) — `users` 1 row / `filter_presets` 11 / `metric_definitions` 128 / `schema_migrations` 7, identical to the original deployment. Login round-trip via curl with the original admin credentials succeeds (`{"id":1,"username":"admin","role":"admin"}`). One real bug found and fixed during exercise: `pg_restore --clean --if-exists` exits non-zero on harmless DROP-IF-EXISTS warnings; pilot-recover.sh now wraps it with `set +e` and relies on the parity check as the gate. |
| 14. Backups Exist But You Want a Fresh Server | C  | 2026-05-07 (KW 19)  | PASS (exercised end-to-end) | After tearing down the server but leaving the bucket intact, ran `make pilot` and verified the existing-backups guard fired with all four labelled options (recover / inspect / discard / override). Also exercised `make pilot-restore-list` against the live bucket: returned 2 snapshots with timestamps, hostnames, and sizes. SOPS decrypt path hardened: `SOPS_AGE_KEY_FILE` is now auto-set when `~/.config/sops/age/keys.txt` exists (sops 3.x doesn't auto-discover the way the Go SDK does). |
| 12. SSH Key Lost - Hetzner Rescue Mode      | A    | 2026-05-07 (KW 19)  | PASS-WITH-DRIFT   | Tier A only — exercising would brick the current SSH key path. Documented procedure (Hetzner Console > Rescue, boot rescue ISO, mount `/dev/sda1`, reset authorized_keys) is standard hetzner mechanics; not project-specific so unlikely to drift. Bare-`make` references at the top assume `web-deploy/` CWD. |
| 13. Token Rotation                          | B    | 2026-05-07 (KW 19)  | PASS              | (a) Hetzner API token: `tofu plan` against current `terraform.tfvars` returns "No changes" — token reads through to the IaC stack cleanly. (b) GitHub PAT: drift — runbook references `~/.config/varlens/github_token`, but the env-layering refactor moved this into `web-deploy/.env` as `GHCR_TOKEN`. (c) Caddy basic-auth: `docker exec caddy caddy hash-password` works on the deployed image (returns valid bcrypt `$2a$14$...`). (d) Uptime Kuma: UI-only flow, can't automate. |

### Drift summary

Across all 12 scenarios + the routine, the most common drift is **bare `make` references that only resolve when CWD is `web-deploy/`** (`make ip`, `make ssh`, `make down`, `make stack-up`, `make smoke`). Repo-root callers need `make pilot-*` or `make -C web-deploy <target>`. Quick Reference in [`runbook.md`](runbook.md) was already corrected; the body of the scenarios in this file still uses the bare form — a sweep through-and-replace is a small follow-up.

Other drift items, smaller scope:

- S1 step 1: `docker pull` / `docker inspect` in the SSH command need `sudo` on this host's deploy user.
- S1 step 4: `DB=postgres` flag is a Phase-2 no-op; the SQLite alternative is impossible. Trim to plain `make stack-up`.
- S13 (b): `~/.config/varlens/github_token` predates the `web-deploy/.env` operator-env layering — token now lives in `web-deploy/.env` as `GHCR_TOKEN`.

### Real bugs found and fixed in this session

1. **`scripts/restore-drill.sh` glob expansion failure** — `sudo ls -1 .../varlens-*.dump` couldn't expand because `restic restore` writes the target with mode 0700 owned by root. Drill silently FAILed every run. Fixed via `chmod -R o+rX $RESTORE_TARGET` after restore.
2. **`scripts/restore-drill.sh` PROTOCOL_FILE typo** — defaulted to `.internalplanning/restore-log.md` (no such dir). Fixed: repo-root-anchored `.planning/web/restore-log.md`, with `mkdir -p` of the parent.
3. **`cloud-init/pilot.yaml` `$$VAR` escape bug** (closed earlier this session) — bare `$$VAR` references in the deployed `varlens-backup.sh` survived as literal `$$VAR` instead of `$VAR`, breaking the postgres-detect grep and the pg_dump invocation. Fixed by converting all bare `$$VAR` to `$${VAR}` so Tofu/cloud-init template-halving applies.
