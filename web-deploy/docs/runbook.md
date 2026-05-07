# Runbook - Concept Pilot

Day-to-day operations reference for the VarLens Concept Pilot. Read this for: status checks, restarts, lifecycle, image updates, backup verification, the danger table.

Companion docs:

- [`/DEPLOY.md`](../../DEPLOY.md) — first-time bring-up from a fresh clone
- [`incident-runbook.md`](incident-runbook.md) — 13 broken-something scenarios (server unreachable, backup failed, rollback, …)
- [`operations.md`](operations.md) — full command-by-command reference
- [`smoke-remediation.md`](smoke-remediation.md) — per-probe failure causes for the smoke gate

Plan reference: Stage 1 infrastructure plan §infrastruktur4 Phase 1 requires Runbook v1 (update, restore, rollback) as a documentation deliverable.

## Quick Reference

The repo-root `Makefile` exposes pilot operations as `pilot-*` targets. The lower-level scoped targets (`stack-up`, `stack-down`, `setup-backup`, …) live in `web-deploy/Makefile` and are reached either by `make -C web-deploy <target>` or by running `make` from inside `web-deploy/`.

All commands below run from repo root.

### Inspect (read-only, safe)

| Action | Command |
|---|---|
| Server status (running / stopped / absent) | `make pilot-status` |
| Server IP (machine-friendly) | `make pilot-status \| awk '/IPv4:/ {print $2}'` |
| SSH into the server | `make pilot-ssh` |
| Re-run smoke probes | `make pilot-smoke` |
| Container ps on the server | `IP=$(make pilot-status \| awk '/IPv4:/ {print $2}') && ssh -i ~/.ssh/varlens-tofu deploy@$IP 'cd /mnt/data/app && docker compose ps'` |
| Live logs of all containers | `make -C web-deploy stack-logs` |
| cloud-init log on the server | `make -C web-deploy logs` |

### Lifecycle (safe — no data loss)

| Action | Command |
|---|---|
| Restart the stack | `make -C web-deploy stack-up` |
| Restart with self-signed TLS | `make -C web-deploy stack-up TLS=internal` |
| Stop the stack (containers down, volume preserved) | `make -C web-deploy stack-down` |
| Stop the server (volume preserved, billing for volume + IPv4 continues) | `make -C web-deploy stop` |
| Start a stopped server (volume preserved) | `make -C web-deploy start` |
| Re-run backup setup | `make -C web-deploy setup-backup SETUP_BACKUP_ARGS=--default-reuse-when-resumable` |

### Provision (creates billable resources)

| Action | Command | Confirmation |
|---|---|---|
| One-shot fresh bring-up (Hetzner cpx32 + 50 GB volume + IPv4) | `make pilot` | none — runs immediately |

> Cost: the cpx32 VM is hourly-billed by Hetzner; the 50 GB volume and IPv4 carry small monthly fees. Use `make -C web-deploy stop` (NOT `make pilot-down`) to pause billing for the VM hours while keeping data.

### ⚠ DANGER — destructive, irreversible

These operations destroy resources and/or data. Each requires you to type a literal confirmation string — `y` / `yes` is rejected on purpose.

| Action | Command | Required input | Effect |
|---|---|---|---|
| Tear down the Hetzner environment (server + volume + IPv4 + firewall + SSH key) | `make pilot-down` | type literally `pilot`<br>(then ↵) | All data on the volume is gone. Restic snapshots in the bucket are untouched and can rebuild a new server via `make -C web-deploy restore-drill` / `restore.sh`. |
| Destroy the restic bucket and ALL snapshots in it | `make -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes` | `--yes` flag must be present | Every backup ever taken into this bucket is irrecoverable. Run only if you accept losing all snapshot history (e.g. rotating to a new bucket name). Requires `RESTIC_S3_ACCESS_KEY` / `RESTIC_S3_SECRET_KEY` exported in the shell. |
| Force-overwrite an initialised restic repo | `make -C web-deploy setup-backup SETUP_BACKUP_ARGS=--force` | `--force` flag must be present | All prior snapshots in the bucket become undecryptable; only valid if you also rotated the password and accept that loss. |
| Rekey the restic password mid-life | edit `RESTIC_PASSWORD=` in `web-deploy/.env` to a new value, then re-run `make -C web-deploy setup-backup` | manual edit | Snapshots encrypted with the prior password become undecryptable. The script logs a `WARNING` line on mismatch. |

