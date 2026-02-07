# Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Signed artifacts

Windows installers (NSIS setup and portable executables) are signed using a certificate issued to SignPath Foundation. Linux and macOS builds are currently unsigned.

## Team roles

- **Committers and reviewers:** [Repository contributors](https://github.com/berntpopp/VarLens/graphs/contributors) with write access
- **Approvers:** [Repository owner](https://github.com/berntpopp) (Bernt Popp)

All code changes are reviewed via GitHub pull requests. Only approved changes merged into the `main` branch are eligible for signed releases.

## Signing process

1. A version tag (`v*.*.*`) pushed to the `main` branch triggers the release workflow.
2. The Windows job builds unsigned executables using electron-builder.
3. Unsigned artifacts are uploaded as GitHub Actions artifacts.
4. A signing request is submitted to SignPath via the [GitHub Action](https://github.com/SignPath/github-action-submit-signing-request).
5. The repository owner approves the signing request on SignPath.io.
6. Signed artifacts are downloaded and attached to the GitHub Release.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

VarLens is an offline-first application. Optional network requests occur only when the user explicitly triggers external API lookups (VEP variant annotation, HPO term search, SpliceAI predictions). No telemetry, analytics, or automatic update checks are performed.
