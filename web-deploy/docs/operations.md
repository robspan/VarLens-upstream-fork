# Operations Guide

Detailed operational documentation. For the quick-start sequence see the repository `README.md`. For day-to-day commands see `runbook.md`. For incident recovery see `incident-runbook.md`.

## Lifecycle and Cost Control

The `Makefile` at the repository root bundles all common operations.

| Command | Effect | Cost Impact |
|---|---|---|
| `make plan` | Shows what Tofu would change | - |
| `make up` | Creates or updates resources | Server billed, volume and IPv4 fixed |
| `make down` | Full teardown (server + volume + firewall + SSH key). Requires literally typing `pilot` to confirm. | Full cost savings. **Warning: data is gone.** |
| `make stop` | Server power off (requires y-confirm) | Server hours saved, volume and IPv4 still billed |
| `make start` | Server power on | Server billed again |
| `make status` | Current server state | - |
| `make ssh` | SSH login as deploy | - |
| `make ip` | Print IPv4 (for script chaining) | - |
| `make logs` | cloud-init bootstrap log | - |
| `make stack-up` | Sync and start the Compose stack | - |
| `make stack-down` | Stop the Compose stack | - |
| `make stack-logs` | Live logs of all containers | - |
| `make setup-backup` | Sets up restic bucket, credentials, password, `/etc/restic/env`. `SETUP_BACKUP_ARGS=--reuse` to reuse, `--force` for a greenfield reset. | - |
| `make setup-monitoring` | Sets up Uptime Kuma admin and heartbeat push monitor | - |
| `make smoke` | End-to-end smoke test (10 assertions including HTTPS) | - |
| `make restore-drill` | Backup restore drill with marker file and log | - |
| `make lint` | Local linter (tofu fmt/validate, shellcheck, yamllint, Caddyfile validate) | - |
| `make e2e` | Full-cycle E2E test in the `e2e` environment, dedicated SSH key `~/.ssh/varlens-e2e`. Provisions, tests, cleans up. | ~0.01 EUR/hour during the run (cpx11), no effect on pilot |
| `make e2e-keep` | Like `make e2e`, leaves the e2e environment up for inspection | Continues to incur cost until manual `./bin/varlens e2e down --yes` |
| `make sops-edit FILE=secrets/<f>.yaml` | Open encrypted file in editor | - |
| `make sops-decrypt FILE=secrets/<f>.yaml` | Show plaintext (read-only) | - |

Cost reference values for the Concept Pilot (as of April 2026):

- cpx32 running: ~0.02 EUR/hour
- 50 GB volume: ~2 EUR/month fixed
- IPv4 address: ~0.60 EUR/month fixed

Full cost savings only via `make down`. Bringing it back up: `make up` plus `make stack-up` (about five minutes total until the setup is fully running again).

## Verbose mode

Tofu's `apply` and `destroy` both dump the full plan (every resource, every attribute) before any operation runs. Once you've already confirmed an action, that's noise. The CLI filters tofu's output by default to keep only the per-resource progress lines plus the summary; the rest is suppressed.

To see the raw firehose (debugging, audit log capture):

```bash
./web-deploy/bin/varlens pilot up   --verbose
./web-deploy/bin/varlens pilot down --verbose
./web-deploy/bin/varlens e2e   run  --verbose
```

Or set the env var once for the shell session:

```bash
export VARLENS_VERBOSE=1
```

The legacy `VARLENS_TOFU_VERBOSE=1` is honored as an alias.

## ⚠ Destructive operations

Each requires a literal confirmation token — `y` / `yes` is rejected on purpose.

| Action                                                                              | Command                                                                      | Required input                              | Effect                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tear down the Hetzner environment (server + 50 GB volume + IPv4 + firewall + SSH key) | `make pilot-down`                                                            | type literally `pilot`                      | All data on the volume is gone. Restic snapshots in the bucket are untouched and can rebuild a new server via `make -C web-deploy restore-drill` / `restore.sh`.                                                                                                |
| Destroy the restic bucket and ALL snapshots in it                                   | `make -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes`                | `--yes` flag                                | Every backup ever taken into this bucket is irrecoverable. Run only if you accept losing all snapshot history. Requires `RESTIC_S3_ACCESS_KEY` / `RESTIC_S3_SECRET_KEY` exported in the shell.                                                                  |
| Force-overwrite an initialised restic repo                                          | `make -C web-deploy setup-backup SETUP_BACKUP_ARGS=--force`                  | `--force` flag                              | All prior snapshots become undecryptable; only valid if you also rotated the password and accept that loss.                                                                                                                                                     |
| Rekey the restic password mid-life                                                  | edit `RESTIC_PASSWORD=` in `web-deploy/.env`, re-run `setup-backup`          | manual edit                                 | Snapshots encrypted with the prior password become undecryptable. The script logs a `WARNING` line on mismatch.                                                                                                                                                 |

## CLI Reference

`./bin/varlens` is the wrapper to which the Makefile delegates destructive actions. Invoke it directly for E2E control or to explicitly bypass confirms.

```
varlens <env> <action> [--yes]

env:    pilot | e2e
action: plan | up | down | stop | start | status | ssh | ip
        e2e: additionally `run` (full cycle including cleanup)
        e2e run --keep: leaves the environment up
--yes:  skips confirm prompts (for CI)
```

`pilot down` requires literally typing `pilot` as a safety measure. `pilot stop` requires a y/N confirm. Both can be bypassed with `--yes`, e.g. in CI pipelines.

## TLS Modes

Three certificate strategies are supported, switched via `make stack-up`. All three renew automatically inside the Caddy container; no host-level cron, no certbot, no manual steps.

| Mode | Invocation | Cert source | Validity | Browser trust |
|---|---|---|---|---|
| **`tls-le-ip`** (default) | `make stack-up` | Let's Encrypt `shortlived` profile via TLS-ALPN-01 against the raw public IP | 7 days, renewed every ~5 days | ✅ green padlock for raw IP, no DNS needed |
| **`tls-le-classic`** | `make stack-up DOMAIN=foo.example.de` | Let's Encrypt default profile via HTTP-01 against the domain | 90 days, renewed every ~60 days | ✅ green padlock |
| **`tls-internal`** | `make stack-up TLS=internal` | Caddy's internal CA (self-signed) | 12h ECC + auto-rotated | ⚠️ browser warning unless Caddy root cert is imported |

### `tls-le-ip` (the default)

Let's Encrypt rolled out IP-address-cert support in 2025 via a separate `shortlived` profile. Caddy's site block uses `tls { issuer acme { profile shortlived } }`, ACME runs the TLS-ALPN-01 challenge directly against port 443, no DNS involvement. The IP must be:

- Public IPv4 (or IPv6). Hetzner Cloud IPs qualify.
- Reachable from Let's Encrypt's validation servers on port 443.

Cert validity is **7 days** to keep the issuance trail short. Caddy renews every ~5 days transparently. **Rate-limit caveat**: Let's Encrypt allows 50 certs per IP per week — destroying and re-creating the server many times in quick succession can hit this. For development cycles use `TLS=internal` to avoid burning rate-limit budget.

### `tls-le-classic` (with a domain)

Set when SERVER_HOST should be a real DNS name. Caddy auto-detects the domain identifier and falls into the standard 90-day Let's Encrypt path via HTTP-01. Prerequisites:

- A domain (or sub-domain) registered, with an A-record pointing to the server's public IP. Free options for adopters: DuckDNS, FreeDNS, or sub-domain of an existing domain.
- DNS propagation complete — verify with `dig +short A foo.example.de` before issuing.

### `tls-internal` (no internet / dev)

Caddy's internal CA, no external dependencies. The browser warns unless you import Caddy's root certificate into your trust store once:

```bash
ssh -i ~/.ssh/varlens-tofu deploy@$(make ip) \
  'docker exec caddy cat /data/caddy/pki/authorities/local/root.crt' \
  > /tmp/caddy-root.crt
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /tmp/caddy-root.crt
```

After that the browser shows a green padlock for the raw IP under `tls-internal` too, but only on the machine where the root was imported.

### Switching back

To roll back from one mode to another: rerun `make stack-up` with the new flag. Caddy stores certificates per issuer in `/mnt/data/caddy/data` (Tofu-managed volume), so existing certs survive a profile switch and aren't re-issued unnecessarily.

## CI Workflow on GitHub and PAT Configuration

The CI workflow (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull request. It checks:

- OpenTofu format and validate
- Trivy scan (config + images), findings tracked in `.trivyignore` with quarterly review
- Gitleaks secret scan
- Shellcheck (scripts/), yamllint (compose + workflow), Caddyfile validate

Manual interventions (pulling logs, triggering re-runs, modifying the workflow file) require a GitHub Personal Access Token.

**Token requirements (Classic PAT):**

| Scope | Purpose |
|---|---|
| `repo` | Read+push, read run logs, trigger re-runs |
| `workflow` | Required as soon as a push modifies `ci.yml` (otherwise GitHub rejects it) |

No other scopes are needed. Recommended expiration: 30 days, then rotate.

**Local storage location:** `~/.config/varlens/github_token` (mode `0600`, outside the repo, not in Git).

```bash
export GH_TOKEN=$(cat ~/.config/varlens/github_token)
gh run list --limit 5
gh run view <run-id> --log-failed
```

`gh auth login --with-token` refuses without `read:org`. Working directly via the `GH_TOKEN` env var is the leaner approach and is fully sufficient for our use cases.

## cloud-init Changes Trigger Server Replacement

Hetzner cannot change user_data in place. When `cloud-init/pilot.yaml` is edited, `tofu apply` destroys the old server and provisions a new one. The data volume survives (it is a separate resource), but the Compose stack must be redeployed via `make stack-up`.

Adopters who want to protect their server from this behavior can enable the commented-out `lifecycle { ignore_changes = [user_data, ssh_keys] }` block in `tofu/environments/pilot/main.tf`. cloud-init changes then take effect only on the next manual server replacement.

## Troubleshooting

| Problem | Cause and Resolution |
|---|---|
| `tofu apply` fails with "401 Unauthorized" | API token invalid or expired. Create a new token in the Hetzner Console, update it in `terraform.tfvars`. |
| `make ssh` with "Connection refused" | cloud-init has not finished yet. Wait two to five minutes, then try again. |
| `make ssh` with "Permission denied" | SSH key is not the same one uploaded to Hetzner. Check `cat ~/.ssh/varlens-tofu.pub` against `ssh_pubkey` in `terraform.tfvars`. |
| `make ssh` with "Host key verification failed" / "REMOTE HOST IDENTIFICATION HAS CHANGED" | Server was reprovisioned through a cloud-init change or the IP was recycled. Clean up with `ssh-keygen -R <ipv4>`. |
| `make stack-up` with "Permission denied (publickey)" for rsync | SSH key is not loaded automatically. Help ssh-agent auth along via `ssh-add ~/.ssh/varlens-tofu`. |
| Uptime Kuma shows "Setup" although already configured | Volume mount interrupted. `make ssh` and check `df -h /mnt/data`. |
| `make setup-backup` with "Preflight detect: existing backup artifacts found" | Default mode protects against data loss. Use `make setup-backup SETUP_BACKUP_ARGS=--reuse` to keep the existing password, `--force` only for a deliberate greenfield reset. |
| Self-signed cert warning in the browser at `https://<ipv4>/` | Expected on the Concept Pilot intranet. Click "Proceed anyway / Advanced". Replaced in Stage 2 (public domain) by a public CA via Let's Encrypt. |
| Heartbeat monitor in Kuma red despite successful backups | Check the push interval (Kuma UI > Monitor > Edit). On the server: `journalctl -u restic-backup.service --no-pager -n 30` shows whether the `curl` push at the end of the backup went through. |

## Plan Documentation and Confluence Mirror

Stage 1 (Concept) and Stage 2 (Operations) plan documents live on Confluence at [Roadmap for the VarLens Port Task Profile](https://laborberlin.atlassian.net/wiki/spaces/ITGM/pages/991002629). The HTML source files are kept locally outside the repository (in `.internalplanning/`, gitignored) so that the team can paste them into Confluence verbatim; they are not part of the public IaC repository.

Anchor references in this repository (`§infrastruktur2`, `§adr7`, `§vertrag5`, etc.) point to sections in those Confluence pages.

Confluence paste workflow (when editing the local HTML sources):

```bash
open .internalplanning/konzept/fahrplan.html
# In the browser: Cmd+A, Cmd+C
# In the Confluence page in edit mode: Cmd+V
```

Confluence natively accepts tables, headings, lists, and blockquotes. CSS from the `<style>` block is dropped on paste, but the semantic structure survives.
