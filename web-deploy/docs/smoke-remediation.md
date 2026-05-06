# Smoke-test remediation guide

If `make pilot-smoke` reports a failure, the table here maps the failing
check to its likely cause and the exact diagnostic + remedy commands to
run. Each check shows up in the output as `FAIL <label>  expected X, got Y`.

The smoke target is defined in `web-deploy/Makefile` (target: `smoke`). It
runs 13 probes against the running pilot. Re-run any time with
`make pilot-smoke` (or `make -C web-deploy smoke`).

Conventions used below:

- `$IP` — the pilot's IPv4. Get it with `make -C web-deploy ip`.
- `make pilot-ssh` is equivalent to `ssh -i ~/.ssh/varlens-tofu deploy@$IP`.
- `got: 000` from curl means the connection was refused, dropped, or timed
  out — curl never received an HTTP status line.

## Quick-check matrix

| #  | Check label                              | Expected | Common cause when red                                                |
| -- | ---------------------------------------- | -------- | -------------------------------------------------------------------- |
| 1  | SSH reachable                            | yes      | server stopped, cloud-init still running, IP reused, key mismatch    |
| 2  | HTTP redirect to HTTPS                   | 308      | Caddy not running, port 80 firewalled, wrong Caddyfile               |
| 3  | Welcome page 200                         | 200      | Caddy site block missing, TLS handshake failing                      |
| 4  | Kuma root 302->/dashboard                | 302      | Kuma container down, Caddy upstream unreachable                      |
| 5  | Kuma /dashboard 200                      | 200      | Kuma still booting, sqlite db corrupt, port collision                |
| 6  | Kuma /manifest.json 200                  | 200      | Kuma static-asset path broken (rare; usually a Kuma upgrade)         |
| 7  | Old /monitor redirects                   | 301      | Caddyfile redirect block removed/edited                              |
| 8  | Logs without auth 401                    | 401      | basicauth block stripped from Caddyfile                              |
| 9  | Logs with auth ok                        | 200      | password rotated, Dozzle container down                              |
| 10 | VarLens /varlens/healthz                 | 200      | varlens container failing to start, GHCR pull failed, image missing  |
| 11 | Direct port 3001 closed                  | 000      | hcloud firewall opened to public, Kuma exposed by mistake            |
| 12 | Direct port 8080 closed                  | 000      | hcloud firewall opened to public, Dozzle exposed by mistake          |
| 13 | Compose stack: 4 services running        | 4        | one of caddy/uptime-kuma/dozzle/varlens is exited or restarting      |

## Remediation per check

### 1. SSH reachable

**What it tests:** `ssh deploy@$IP echo yes` returns `yes`.

**Failure modes:**

- `got:` (empty) — SSH did not connect at all. Server may be off, still
  booting, behind a firewall, or the host key changed.
- `got: yes` but check still red — impossible (means upstream regression);
  re-run.

**Diagnose:**

```
make -C web-deploy status
make -C web-deploy ip
ssh-keygen -R "$(make -C web-deploy ip)"
ssh -i ~/.ssh/varlens-tofu -o ConnectTimeout=5 deploy@$(make -C web-deploy ip) 'cloud-init status'
```

**Fix:**

- Server `off` → `make -C web-deploy start`.
- Cloud-init still `running` → wait. First boot finishes in ~2 min; the
  pilot orchestrator waits with `cloud-init status --wait` (see
  `wait_for_server_ready` in `scripts/pilot.sh`).
- Cloud-init `error` → `ssh ... 'sudo tail -200 /var/log/cloud-init-output.log'`.
- Hetzner reused a released IP → `ssh-keygen -R $IP` clears the stale
  known_hosts entry.
- No server in tofu state → `make -C web-deploy up` (or full `make pilot`).

### 2. HTTP redirect to HTTPS

**What it tests:** `curl http://$IP/` returns `308`. Caddy's automatic
HTTP→HTTPS redirect.

**Failure modes:**

- `got: 000` — Caddy not listening on :80, or hcloud firewall blocks 80.
- `got: 200` — site is serving plain HTTP; Caddyfile broken.
- `got: 502` — Caddy up but its HTTP-to-HTTPS handler is misconfigured.

**Diagnose:**

```
make pilot-ssh
docker ps --filter name=caddy
docker logs caddy --tail=100
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
```

**Fix:**

- Caddy not running → `cd /mnt/data/app && docker compose up -d caddy`.
- Caddyfile invalid → fix `web-deploy/compose/Caddyfile` locally, then
  `make -C web-deploy stack-up` (rsyncs and reloads).
- Firewall blocks 80 → check `tofu/environments/pilot/main.tf` firewall
  rules; 80 must be open inbound.

### 3. Welcome page 200

**What it tests:** `curl https://$IP/welcome` returns `200`.

**Failure modes:**

- `got: 000` — TLS handshake failed (cert not yet issued, or 443 closed).
- `got: 404` — `/welcome` route removed from Caddyfile.
- `got: 502` — Caddy's `respond` handler for `/welcome` was changed to a
  `reverse_proxy` against a missing upstream.

**Diagnose:**

```
make pilot-ssh
docker logs caddy --tail=100 | grep -iE 'tls|acme|welcome'
curl -ksv https://$IP/welcome 2>&1 | head -40
```

**Fix:**

- TLS not provisioned yet (first boot) → wait 30–60 s and re-run.
- `tls-le-ip` cert failed (Let's Encrypt rate-limit / IP block) →
  `make -C web-deploy stack-up TLS=internal` to fall back to self-signed.
- `/welcome` route lost → restore from git: `git diff compose/Caddyfile`.

### 4. Kuma root 302->/dashboard

**What it tests:** `curl https://$IP/` returns `302` (Caddy → Kuma → /dashboard).

**Failure modes:**

- `got: 502` — Caddy is up but `uptime-kuma` upstream is unreachable
  (container down or unhealthy).
- `got: 200` — root route is being served by something else (Caddyfile
  edited).
- `got: 000` — TLS or 443 issue (see check 3).

**Diagnose:**

```
make pilot-ssh
docker compose ps
docker logs uptime-kuma --tail=100
```

**Fix:**

- Kuma exited → `cd /mnt/data/app && docker compose up -d uptime-kuma`.
- Kuma restart-looping → check `/mnt/data/app/data/kuma/` ownership
  (`sudo chown -R 1000:1000 /mnt/data/app/data/kuma`) and disk space
  (`df -h /mnt/data`).

### 5. Kuma /dashboard 200

**What it tests:** Kuma's main UI loads.

**Failure modes:**

- `got: 502` — same as check 4 (upstream down).
- `got: 503` — Kuma still booting (it serves 503 until its DB migration
  finishes, ~10 s on first start).

**Diagnose + Fix:** identical to check 4. If only check 5 fails (and 4
passes), wait 15 s and re-run; Kuma's startup is not synchronous with
container `running` state.

### 6. Kuma /manifest.json 200

**What it tests:** Kuma's PWA manifest is reachable. Cheap canary for
"Caddy is forwarding static asset paths to Kuma correctly."

**Failure modes:**

- `got: 404` — usually a Kuma upgrade changed the manifest path. Check
  `docker logs uptime-kuma` for the actual served paths.
- Same 502/503 as checks 4–5.

**Fix:** if Kuma genuinely no longer ships `/manifest.json`, this check
needs updating in `Makefile:smoke` — pin Kuma to a known version in
`compose/docker-compose.yml` first, then update the probe.

### 7. Old /monitor redirects

**What it tests:** legacy `/monitor/` path returns `301` (we moved Kuma
to `/`).

**Failure mode:**

- `got: 404` — the redirect block in `compose/Caddyfile` was deleted.
  Restore from git.

**Fix:**

```
git -C web-deploy diff compose/Caddyfile
make -C web-deploy stack-up
```

### 8. Logs without auth 401

**What it tests:** Dozzle requires basicauth. An unauthenticated
`curl https://$IP/logs/` must return `401`.

**Failure modes:**

- `got: 200` — **security incident.** basicauth block was removed.
  Logs are public. Restore Caddyfile and re-deploy immediately.
- `got: 502` — Dozzle down, but auth would still be evaluated; usually
  this points at the basicauth block referencing a missing handler.

**Fix:**

```
git -C web-deploy diff compose/Caddyfile
make -C web-deploy stack-up
```

### 9. Logs with auth ok

**What it tests:** `authenticated request to https://$IP/logs/`
returns `200`.

**Failure modes:**

- `got: 401` — password rotated. The smoke target hardcodes
  `<configured credentials>`; if the deployment uses a different password
  the check needs updating.
- `got: 502` — Dozzle container is down.

**Diagnose:**

```
make pilot-ssh
docker logs dozzle --tail=50
docker compose ps dozzle
```

**Fix:**

- Dozzle exited → `cd /mnt/data/app && docker compose up -d dozzle`.
- Password mismatch → reconcile `compose/Caddyfile` basicauth hash with
  the documented credential, or update the smoke probe.

### 10. VarLens /varlens/healthz

**What it tests:** the VarLens-Web container responds at its health
endpoint behind Caddy.

**Failure modes:**

- `got: 502` — varlens container is down or its port is wrong. Most
  common during first deploy: GHCR pull failed because `GHCR_TOKEN` was
  not exported before `make stack-up`.
- `got: 404` — Caddy is up but the `/varlens/*` route block is missing
  from `compose/Caddyfile`.
- `got: 503` — varlens is still booting (DB migrations).

**Diagnose:**

```
make pilot-ssh
docker compose ps varlens
docker logs varlens --tail=200
docker images | grep varlens-web
docker compose pull varlens
```

**Fix:**

- GHCR pull denied (`unauthorized` / `manifest unknown`) →
  ```
  export GHCR_TOKEN=ghp_...   # on operator workstation
  make -C web-deploy stack-up
  ```
  `stack-up` pipes the token over SSH into `docker login ghcr.io`
  (see Makefile lines ~159–166).
- Image tag missing from GHCR → check the `VARLENS_IMAGE` env var or the
  `image:` line in `compose/docker-compose.yml`.
- varlens crash-looping → tail container logs (above). Likely causes:
  database file permissions on `/mnt/data/app/data` (must be `1001:1001`),
  or invalid env in `.env`.

### 11. Direct port 3001 closed

**What it tests:** Kuma's container port (3001) is **not** publicly
reachable. Expected `got: 000` (connection refused/timeout).

**Failure mode:**

- `got: 200` / `got: 302` — **security incident.** Kuma is exposed to the
  public internet, bypassing Caddy's TLS + access logging.

**Diagnose:**

```
make pilot-ssh
ss -tlnp | grep 3001
docker compose config | grep -A2 ports
```

**Fix:**

- In `compose/docker-compose.yml`, Kuma must use `expose: ["3001"]` (no
  host bind) — never `ports: ["3001:3001"]`.
- Check the Hetzner firewall (`tofu/environments/pilot/main.tf`): only
  22 / 80 / 443 should be open inbound.

### 12. Direct port 8080 closed

**What it tests:** Dozzle's container port is not public. Same shape as
check 11. Same diagnostic. Same fix path.

### 13. Compose stack: 4 services running

**What it tests:** `docker compose ps --status running --services`
includes all 4 expected services: `caddy`, `uptime-kuma`, `dozzle`,
`varlens`.

**Failure modes:**

- `got: 3` — one service is `exited` or `restarting`.
- `got: 0` — Compose project not up at all (`stack-up` never ran, or
  `stack-down` was just executed).
- `got:` (empty) — SSH failed (cascades from check 1).

**Diagnose:**

```
make pilot-ssh
cd /mnt/data/app && docker compose ps
docker compose ps --all   # includes exited
docker compose logs --tail=100
```

**Fix:**

- One service down → identify it from `docker compose ps --all`, then
  `docker compose up -d <service>` and `docker logs <service>` for the
  underlying error.
- Stack not up → `make -C web-deploy stack-up` (operator workstation).
- For postgres-mode pilots, the expected count is still 4: the `postgres`
  service is in a Compose profile and not counted by this probe. If you
  added a 5th service intentionally, update the regex in `Makefile:smoke`.

## When multiple checks fail at once

Read the failures top-down. The probes are ordered intentionally — an
SSH failure invalidates checks 1 and 13; a TLS failure cascades through
2–10; a single container crash usually shows as one HTTP probe + one
service-count probe.

Useful catch-all log paths:

- Cloud-init bootstrap: `/var/log/cloud-init-output.log` (also
  `make -C web-deploy logs`)
- Per-container: `docker logs <name> --tail=200`
- Restic backup unit: `journalctl -xeu restic-backup.service`
- All Compose logs streaming: `make -C web-deploy stack-logs`

## Last resort

```
make -C web-deploy stack-down
make -C web-deploy stack-up         # remember to export GHCR_TOKEN first
make -C web-deploy smoke
```

If that does not recover the stack, full reset:

```
make pilot-down
make pilot
```

`make pilot` re-runs the orchestrator end to end, including this smoke
target as its final gate (see `scripts/pilot.sh`, step 5/5).
