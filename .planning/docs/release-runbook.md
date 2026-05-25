# VarLens Release Runbook

> One-page checklist for tagging a VarLens release.

## Before bumping `package.json` version

1. **Promote `## [Unreleased]` in `CHANGELOG.md`.**
   - Rename the `[Unreleased]` heading to `[X.Y.Z] — YYYY-MM-DD`.
   - Insert a new, empty `## [Unreleased]` block above it.
   - Reviewer checks: every change merged since the previous tag is reflected.
   - **Phase 1 chose runbook-line enforcement over a CI hook.** If a release
     ships with a stale changelog, that is the failure mode to learn from.
     Sprint A may add a `pre-tag` workflow step gating on a populated
     `[X.Y.Z]` block.

2. **Bump `package.json` version** to match the new heading.

3. **Tag with the same version**, prefixed `v`:
   `git tag -a vX.Y.Z -m "vX.Y.Z"`.
   Before pushing the tag, confirm `package.json` contains `"version": "X.Y.Z"`.

## After tagging

- Push the tag: `git push origin vX.Y.Z`.
- Watch `Build` workflow on the tagged SHA; release.yml waits for it.
- Promote draft release once OS builds + signing complete.
