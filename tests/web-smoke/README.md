# VarLens Web Smoke

This suite is the app-owned browser smoke contract for the web release path.
It runs against a real VarLens web URL and verifies login, public entry points,
upload APIs, and rendered case/variant data.

Specs are intentionally small and workflow-oriented. Low-level UI mechanics,
fixture generation, import flows, case rendering, and Data Info checks live in
`tests/web-smoke/support` so spec files read as user-facing smoke contracts.

The Cypress dependency is intentionally isolated in this directory. Normal
desktop/non-web `npm ci` at the repository root does not install or download
web-smoke dependencies.

Run it against a local web server:

```bash
npm --prefix tests/web-smoke ci
npm --prefix tests/web-smoke exec -- cypress install
VARLENS_BASE_URL=http://127.0.0.1:8787 \
VARLENS_ADMIN_PASSWORD='...' \
npm run test:web-smoke
```

`make web-smoke` uses `http://127.0.0.1:8787` by default, matching `make web-dev`.

Local runs record MP4 videos by default under
`tests/web-smoke/artifacts/videos`, one per workflow spec. Set
`VARLENS_CYPRESS_VIDEO=0` to skip recording.

Run it against a deployed environment:

```bash
VARLENS_BASE_URL=https://varlens-dev.example.com \
VARLENS_ADMIN_PASSWORD='...' \
npm run test:web-smoke
```

The platform IaC release workflow checks out this repository and invokes this
same command after Dev has synced. IaC owns environment orchestration; VarLens
owns the smoke specification.
