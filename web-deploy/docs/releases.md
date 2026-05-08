# Releases — shipping a new version of the web app

A GitHub Release with a tag of the form **`web-vX.Y.Z`** triggers
[`.github/workflows/release-web.yml`](../../.github/workflows/release-web.yml),
which builds the versioned image, pushes it to GHCR, recreates the
`app` container on the running pilot, and runs the full smoke suite.
A red smoke fails the release page so a bad ship is visible
immediately.

## Why the `web-v` prefix?

The desktop track (Electron installers) owns the bare `vX.Y.Z` tag
namespace via [`release.yml`](../../.github/workflows/release.yml).
Sharing prefixes would mean every desktop release fires the web
deploy and every web release builds .dmg/.exe artefacts — neither is
what the operator intended. The `web-` prefix keeps the two
disjoint:

| Tag pattern        | Workflow                  | What ships                              |
| ------------------ | ------------------------- | --------------------------------------- |
| `vX.Y.Z`           | `release.yml`             | desktop installers as release assets    |
| `web-vX.Y.Z`       | `release-web.yml`         | versioned GHCR image + pilot redeploy   |
| (push to branch)   | `publish-web.yml`         | rolling `:edge` GHCR image, no deploy   |

## One-time setup

`make pilot` already does this on a fresh bring-up — both repo
secrets land automatically. You only run this manually if you skipped
it during provisioning, or after `pilot-down + pilot` cycles the IP
and the older `DEPLOY_HOST` is stale (`make pilot` will re-upload on
the next bring-up too — running it manually just lets you fix it
without re-provisioning).

| Need                                | Command                  |
| ----------------------------------- | ------------------------ |
| Upload `DEPLOY_SSH_KEY` + `DEPLOY_HOST` repo secrets | `make web-release-enable` |
| Dry-run (show what would be uploaded, no API calls)  | `web-deploy/scripts/enable-github-release.sh --dry-run` |

Prerequisites: `gh` installed and authenticated (`gh auth login` with
`repo` scope), `~/.ssh/varlens-tofu` present, and either tofu state
or `--host <ip>` available.

## Shipping a release

| Need                                | Command                  |
| ----------------------------------- | ------------------------ |
| Cut + ship a release with auto notes | `make web-release VERSION=web-v0.1.0 NOTES_FROM=auto` |
| Cut + ship without notes (write later) | `make web-release VERSION=web-v0.1.0`               |
| Ship via GitHub UI                  | <https://github.com/robspan/VarLens/releases/new> (target: `VarLens-Web`) |
| Watch the running deploy            | `gh run watch` or `gh run list --workflow=release-web.yml -L 5` |
| List recent deploys                 | `gh run list --workflow=release-web.yml`                |

`VERSION` must match `vMAJOR.MINOR.PATCH[-suffix]` — the workflow's
`resolve-version` job rejects anything else. Both the `make
web-release` wrapper and the workflow validate this independently.

## Rollback

A release ships an immutable, version-pinned image to the server's
`.env` (`VARLENS_IMAGE=ghcr.io/robspan/varlens-web:web-v0.1.0`). To roll
back, redeploy the previous tag — no rebuild needed:

```
gh workflow run release-web.yml -f version=web-v0.0.9 -f skip_build=true
```

`skip_build=true` reuses the GHCR image you already shipped, so
rollback is the same path as forward and is bounded by the time it
takes to pull + recreate the container (~30 seconds).

## What the deploy step does (and doesn't)

It pins `VARLENS_IMAGE` in `/mnt/data/app/.env`, runs `docker compose
pull app`, then `docker compose up -d --no-deps app`. The `--no-deps`
flag means **only the app container** is recreated. Caddy, Postgres,
Uptime Kuma and Dozzle stay up across releases — no LE rate-limit
churn, no DB bounce, no monitoring blackout. The smoke step then
runs the same probe set as `make pilot-smoke`, against the live IP
from the runner.

If a release ships a `compose/Caddyfile` or `compose/docker-compose.yml`
change, those tracked-in-the-image-but-rsync'd-to-the-server files
won't be updated by the release flow. Sync them with `make -C
web-deploy stack-up` separately — the release only touches the app
runtime, not the compose-tree-on-disk.

## What stays operator-only on purpose

- **Hetzner provisioning** — the hcloud token has full account
  control. It does not belong in CI. `make pilot` / `make pilot-down`
  remain the only way to spin servers up or down.
- **Backup setup** — restic creds + bucket lifecycle. Same blast-
  radius reasoning. `make setup-backup` is the only path.
- **Server-side SOPS keys** — never travel through GitHub Actions.

## Required repo secrets

`make web-release-enable` (or `make pilot`) sets these:

| Secret           | Source                          | Purpose                       |
| ---------------- | ------------------------------- | ----------------------------- |
| `DEPLOY_SSH_KEY` | `~/.ssh/varlens-tofu`           | SSH as `deploy@<host>`        |
| `DEPLOY_HOST`    | `tofu output -raw ipv4`         | Where to SSH                  |

`GITHUB_TOKEN` (auto-provisioned per workflow run) handles GHCR
push/pull. No other CI secrets are required.

## Troubleshooting

| Symptom                              | Likely cause / fix                                                      |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `Missing repo secrets DEPLOY_SSH_KEY and/or DEPLOY_HOST` | Run `make web-release-enable` (or re-provision via `make pilot`). |
| `version 'X' does not match web-vMAJOR.MINOR.PATCH` | Use `web-vX.Y.Z`, not bare `vX.Y.Z` — the `web-` prefix keeps the web release track disjoint from the desktop installer track.   |
| GitHub Release published but `release-web.yml` didn't fire | Tag was bare `vX.Y.Z` (desktop). Web releases must use `web-vX.Y.Z`; `release-web.yml` ignores anything else by design. |
| `app container did not reach healthy within 60s` | New image is broken. `gh workflow run release-web.yml -f version=<previous> -f skip_build=true` to roll back, then investigate via `make pilot-ssh` + `docker logs varlens-dev`. |
| Smoke `Login wall: anon /varlens/ → 302 /login` fails (got 200) | The image being deployed predates the login-wall change — bump VERSION to a tag built from `VarLens-Web` after that commit. |
| Want to redeploy with no changes (e.g. flush a wedged container) | Trigger `workflow_dispatch` with the same `version` and `skip_build=true`. |
| Running `make web-release` outside `VarLens-Web` branch | The workflow targets `VarLens-Web` explicitly; the branch you're on doesn't matter. The release tag will sit on whatever commit `VarLens-Web` points to at trigger time. |
