# Built Image And Postgres Smoke

Status: backlog  
Created: 2026-05-12

## Why This Exists

`make web-ci` proves the source tree and web server behavior before image build. The release path also smokes the live deployment after replacing the app container. What is still missing is a pre-push proof that the exact Docker image boots with PostgreSQL and serves `/healthz`.

## Target Behavior

- Build the web Docker image in CI.
- Start it against a disposable PostgreSQL service.
- Wait for container health.
- Probe `/healthz`.
- Fail before publishing/pushing if the image cannot boot.

## Constraints

- Do not add this to default desktop CI.
- Keep it under web workflows or explicit `make web-*` targets.
- Avoid requiring a browser; this is a container/server smoke only.

## Acceptance Checks

- `publish-web.yml` proves the image before publishing the rolling tag.
- `release-web.yml` proves the image before deploying a versioned tag.
- Failure output includes app logs and enough Postgres connection context to debug quickly.
