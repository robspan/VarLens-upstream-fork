# VarLens Security & Supply-Chain Audit — 2026-05-25

Scope: Electron hardening, IPC surface, SQL injection, external URL handling,
encryption posture, renderer XSS, preload contract drift, supply chain,
worker/sub-process boundaries.

Audit input: source tree at `/home/bernt-popp/development/VarLens` (branch
`main`, HEAD `f23709db`), `npm audit --omit=dev` output, `.github/workflows/*`,
`@electron/fuses@^2.1.1` shipped types.

## Executive summary

VarLens has a **mature security posture** for an Electron desktop app handling
sensitive genomic data. The baseline is strong: full sandbox/contextIsolation,
SHA-pinned workflows, parameterized SQL throughout, Argon2id auth with
lockouts, Electron `safeStorage` for Postgres credentials, and a strict CSP
that only relaxes `unsafe-eval` where pdbe-molstar absolutely requires it.

The previously flagged "typed-args without runtime Zod validation" gaps from
the 2026-05-06 review are **partially closed**. Most domain handlers now
validate at the IPC boundary (159 `safeParse` calls across the handler tree).
The remaining gaps are concentrated in `import.ts`, `batch-import.ts`, and
two `system:*` channels — these are not direct RCE vectors today because the
renderer is the only IPC client and lives inside the same sandboxed Electron
process, but they remain a defense-in-depth concern if a renderer XSS or
preload bug ever exposed `window.api` to attacker-controlled JavaScript.

`npm audit --omit=dev` reports **0 critical, 0 high, 1 moderate, 5 low**. No
release blockers. Moderate is a transitive `qs` DoS (`GHSA-q8mj-m7cp-5q26`)
under `pg`; lows are all `elliptic`/`crypto-browserify` chain reachable only
through `pdbe-molstar`'s build-time browserify polyfill, which is bundled
asset code only.

## Findings

### F-01 — IPC handlers in `import.ts` accept typed args without runtime validation (HIGH, unfixed since 2026-05-06)

**Evidence:** `src/main/ipc/handlers/import.ts`
- L117-129 `import:start` — accepts `filePath: string, caseName: string, vcfOptions?: {...}` with TypeScript types only, no `safeParse` on any of the three inputs.
- L131-157 `import:startMultiFile` — same pattern, plus `files: MultiFileImportSpec[]` and `filtersPayload?: ImportFiltersIpcPayload` un-validated. `payload.bedFile` is then passed to `BedFilter.fromFile(...)` (`src/main/import/vcf/bed-filter.ts:28-31`) which calls `readFileSync(filePath)` with no path validation.
- L165-169 `import:vcfPreview` — `filePath: string` un-validated, passed to `getVcfPreview(filePath)`.
- L171-175 `import:vcfMultiPreview` — `filePaths: string[]` un-validated.

The 2026-05-06 review listed these and they remain unchanged. By contrast,
`shell:openExternal`, `shell:showItemInFolder`, all `case-metadata:*`, all
`auth:*`, all `variants:*`, and 21 of the 25 domains in
`src/main/ipc/handlers/` now go through Zod (`safeParse`).

**Exploit scenario:** Two-step: (1) an attacker achieves any JS execution in
the renderer (e.g. via a future XSS in a Markdown/comment rendering path, an
Electron escape via a future CVE, or via a malicious browser-installable
extension that gets loaded against the dev DevTools port — unlikely in
prod but the threat model has to assume the renderer can be subverted).
(2) Attacker calls `window.api.import.startMultiFile(...)` with a
`filtersPayload.bedFile` pointing at any path readable by the user —
including `~/.ssh/id_ed25519`, the SQLite DB itself, or, in the Postgres
backend, the unencrypted credentials file under userData. `BedFilter.fromFile`
will `readFileSync` it without any allow-list check.

The other input-path channels (`vcfPreview`, `vcfMultiPreview`) read VCF
headers from an arbitrary path; the parsed header is then routed to
renderer/log paths. Not RCE, but a clear information-disclosure primitive.

**Recommended fix:** Add Zod schemas in `src/shared/types/ipc-schemas.ts`:
- `ImportStartParamsSchema` validating `filePath` (string, non-empty, max 4096),
  `caseName`, and `vcfOptions`.
- `MultiFileImportSpecSchema` and `ImportFiltersIpcPayloadSchema` for the
  multi-file path.
- Inside `BedFilter.fromFile`, also resolve the path against
  `app.getPath('home')` and refuse anything that contains `..` or is absolute
  outside the user's home/temp/last-opened-import directory unless it was
  produced by an Electron file dialog in this session.

**Validation:** Add tests under
`tests/main/ipc/handlers/import.test.ts` asserting invalid payloads throw a
`SerializableError` with `code === 'INVALID_PARAMETERS'`. Extend
`tests/shared/types/preload-contract.test.ts` to assert the new schemas are
referenced.

### F-02 — `system:setWorkerThreads` accepts unvalidated number (MEDIUM)

**Evidence:** `src/main/ipc/handlers/system.ts:71-75`

```ts
ipcMain.handle('system:setWorkerThreads', async (_event, count: number) => {
  return wrapHandler(async () => {
    setWorkerThreads(count)
  })
})
```

The TypeScript annotation `count: number` is purely advisory — at runtime
this can be any value: a string, an array, an object with a `valueOf`. Inside
`setWorkerThreads` (`src/main/ipc/dbPoolManager.ts`), the value drives worker
thread pool sizing. Out-of-bounds values (Infinity, negative, NaN, a 1e9-byte
string) can cause unhandled exceptions or excessive memory allocation.

**Exploit:** Renderer compromise → DoS via `window.api.system.setWorkerThreads(2**31)`.

**Fix:** `safeParse(z.number().int().min(0).max(64))`.

### F-03 — Two `database:*` handlers bypass `wrapHandler` (LOW)

**Evidence:** `src/main/ipc/handlers/database.ts:197-212` (`database:selectFile`),
L217-241 (`database:selectSaveLocation`).

Both invoke `dialog.showOpenDialog`/`showSaveDialog` directly. The first takes
no args; the second validates `defaultName` via `FilePathSchema.safeParse`
but then runs the dialog outside `wrapHandler`. If the dialog throws (e.g.
GTK init failure on Linux), the renderer receives an Electron-serialized
exception rather than the structured `SerializableError` envelope every other
handler returns. Minor consistency issue — not a security bug.

**Fix:** Wrap both in `return wrapHandler(async () => { ... })` for envelope
consistency.

### F-04 — `setUserDomains` extends the `shell.openExternal` allowlist with weak hostname check (LOW)

**Evidence:** `src/main/utils/url-validation.ts:17-28`, `src/main/ipc/handlers/shell.ts:27-39`.

`shell:updateUserDomains` accepts a list of hostnames, validates each with
`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i`,
and persists them in process memory. `isDomainAllowed` then matches with
`hostname === domain || hostname.endsWith('.' + domain)`. The dot-boundary
check is correct (`evilgithub.com` ≠ `github.com`).

Risks:
1. **No persistence policy described:** user-added domains live only in
   `userDomains` (in-memory). If they are persisted elsewhere I did not find,
   that wasn't audited. If they aren't, every restart resets the allowlist —
   that's the safe direction.
2. **No length cap on the array** (each hostname is `max(253)`, but the array
   itself is unbounded). A renderer compromise can push tens of thousands of
   entries and slow down every external-URL check.
3. The hostname check allows TLDs that are themselves attacker-registered
   (`example.attacker.tld` will match `endsWith('.attacker.tld')`). Document
   that the user is the trust boundary here.

**Fix:** Cap `UserDomainsSchema` to `z.array(z.string().min(1).max(253)).max(100)`.
Surface in the UI that user-added domains are trusted at full subtree level.

### F-05 — Encryption key interpolated into PRAGMA SQL via quote-escape (LOW, defense-in-depth)

**Evidence:**
- `src/main/database/DatabaseService.ts:72-73` — `const safeKey = encryptionKey!.split("'").join("''"); this.db.pragma(\`key='${safeKey}'\`)`
- Same pattern at L304-305 (`rekey`).
- `src/main/workers/worker-db.ts:37-38, 60-61` and `src/main/workers/db-worker.ts:32-33`, `src/main/workers/delete-worker.ts:108-109`.

The escaping is correct for single quotes inside SQLite string literals, but
SQLCipher's `PRAGMA key` also supports `x'...'` hex blob and `"..."` quoted
identifier syntax — a key containing a leading `x'` followed by hex would be
interpreted as a different key than the application intended. The risk is
low because keys come from the user (free-form), never from network input,
and a user setting their own oddly-shaped key produces wrong-key failure,
not silent compromise. But this is *not* parameterized binding.

**Fix:** `better-sqlite3-multiple-ciphers` supports a key-setting API that
takes the raw bytes; using that (or `db.pragma('key', { simple: false })`
where applicable) removes the literal-construction step. If kept as string
PRAGMA, additionally reject keys matching `^x'` or containing un-paired
double quotes.

### F-06 — Postgres `InsecureLocalPostgresSecretStore` writes plaintext credentials in dev (LOW)

**Evidence:** `src/main/ipc/handlers/database.ts:113-153, 174-182`.

When `VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local` is set in a
non-packaged build, Postgres passwords land in plaintext JSON under
`userData/varlens-postgres-secrets.insecure-local.json`. The gate
(`app.isPackaged → throw`) is correct, but a developer running with that env
var set is one stray PR away from leaking real credentials.

**Fix:** Add a startup warning to `mainLogger.warn` (or even a transient
dialog in dev) when this code path is active. Add a CI assertion that the
literal string `insecure-local` does not appear in any `.env.example` or
docs that ship to users.

### F-07 — `pdbe-molstar` pulls in `elliptic@<=6.6.1` low-sev CVE (LOW)

**Evidence:** `npm audit --omit=dev` (run during this audit):

- `elliptic` (`GHSA-848j-6mx2-7j84`, CWE-1240, CVSS 5.6, severity low)
  used by `browserify-sign` ← `crypto-browserify` ← `pdbe-molstar`.
- The "fix" in npm's view is `pdbe-molstar@3.1.3` which is a **major** rev
  and ignores that Phase X already moved molstar loading into the Vite asset
  graph (`src/renderer/src/composables/useMolstarViewer.ts:46-51`).

The browserify chain is a build-time polyfill set; the elliptic vulnerability
is timing-related on ECDSA verification. VarLens does not perform ECDSA
verification at runtime via this chain — molstar uses crypto polyfills only
during bundling. Risk is effectively zero, but `npm audit` will continue to
flag it.

**Fix:** Either bump `pdbe-molstar` to 3.1.3 (and run the molstar viewer
test/regression pass) or document the suppression in `.planning/` with the
upstream issue link.

### F-08 — `qs@6.11.1-6.15.1` DoS in `pg` chain (MODERATE)

**Evidence:** `npm audit` — `GHSA-q8mj-m7cp-5q26` (DoS via TypeError on null
in comma-format arrays when `encodeValuesOnly` is set), reachable through the
`pg` driver. `fixAvailable: true`.

**Risk:** `pg` is server-bound and parses URLs/queries we construct ourselves;
the attacker would need to control the `qs.stringify` input shape. Not
exploitable in VarLens today, but it's a one-line bump.

**Fix:** Run `npm audit fix` (does not require a major upgrade per the report).

### F-09 — `import:start` allows arbitrary `caseName` strings logged into structured logs (LOW)

**Evidence:** `src/main/ipc/handlers/import-logic.ts` `caseName: string` flows
into multiple `mainLogger.info`/`mainLogger.error` calls (e.g.
`Failed to import file ${spec.filePath}: ${message}`). Combined with F-01, a
hostile renderer could embed control characters / log-forging sequences in
`caseName` to forge log entries.

**Fix:** Same Zod schema as F-01 (`z.string().min(1).max(200).regex(/^[\w\s\-.()]+$/)`)
will defang this naturally. Optionally also strip ANSI/control chars in
`MainLogger` before emitting.

### F-10 — No `will-navigate` / `did-create-window` handler on the main BrowserWindow (LOW)

**Evidence:** `src/main/index.ts:58-101`. `setWindowOpenHandler` correctly
denies and routes through `isUrlSafeForExternal`, but there is no
`webContents.on('will-navigate', ...)` guard. With sandbox + contextIsolation
+ `nodeIntegration:false` + `OnlyLoadAppFromAsar` fuse + CSP `default-src 'self'`,
a drive-by navigation is already heavily constrained. Adding the handler is
trivial defense-in-depth and recommended by Electron's hardening checklist.

**Fix:** Add `mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(rendererUrl) && !url.startsWith('file://')) event.preventDefault() })`.

## Areas confirmed clean

1. **Electron lifecycle hardening** — `sandbox: true`, `contextIsolation: true`,
   `nodeIntegration: false` in `src/main/index.ts:68-74`. `setWindowOpenHandler`
   denies all and routes through validated `shell.openExternal`. Single-instance
   lock present. Renderer never imports from `src/main`.

2. **Fuse baseline** — `scripts/configure-fuses.mjs` declares all 8 Electron-40-supported
   V1 fuses, omits `WasmTrapHandlers` intentionally (Electron 40 fuse wire
   doesn't expose it), and is tested by `tests/main/scripts/configure-fuses.test.ts`
   for completeness. `GrantFileProtocolExtraPrivileges: true` is preserved
   intentionally — flipping it requires explicit threat-model review (e.g.
   `file://` requests for fetched protein structures via molstar would break).
   `strictlyRequireAllFuses: true` will make any new Electron fuse a build-time
   failure.

3. **SQL injection** — both backends are clean:
   - SQLite path: `VariantFilterBuilder` uses Kysely chain builders + `sql\`\`\``
     tagged templates with parameter binding. The two `sql.raw` sites in
     `VariantFilterBuilder.ts:279-282, 729` and `VariantSearchService.ts:102-104`
     interpolate only **internally-controlled** SQL fragments (sort directions
     `ASC|DESC`, `NULLS LAST`, column names that have been allowlisted by
     `BASE_SORTABLE_COLUMNS` or `EXTENSION_SORTABLE_DOTTED_KEYS`). The dynamic
     identifier translator in `variant-where-builder.ts:153, 161` enforces
     `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before letting any user-supplied column key
     near the SQL. `setupPanelIntervalsTable` uses prepared statements +
     `db.transaction`.
   - Postgres path: every dynamic identifier (schema/table) goes through
     `quoteIdentifier` (`src/main/storage/postgres/identifiers.ts`). All
     user-supplied values use `$N` parameter placeholders. `runBulkCopy`
     receives SQL strings built from constants + `quoteIdentifier` only
     (`PostgresVcfImportRepository.ts:241-254`).

4. **External URL handling** — `shell.openExternal` is the only path to the
   system browser. `isUrlSafeForExternal` enforces HTTPS + allowlisted domain
   set (`src/shared/config/allowed-domains.ts` — 12 well-known biomedical
   sites + `github.com`/`github.io` + `opensource.org`). `setWindowOpenHandler`
   denies all and forwards through the same validator.

5. **TLS verification** — all API clients (`Vep`, `Ensembl`, `Gnomad`,
   `MyVariant`, `HPO`, `SpliceAI`, `AlphaFold`, `UniProt`, `InterPro`,
   `PanelApp`, `StringDb`) use the global `fetch` with default options. No
   `rejectUnauthorized: false`, no custom `https.Agent`, no `http://`
   URLs. Base URLs are hard-coded constants pointing at `https://rest.ensembl.org`,
   etc.

6. **Encryption posture** — `better-sqlite3-multiple-ciphers` `PRAGMA key` is
   issued before any other pragma (correct order). The encryption key is
   held in `DatabaseService._encryptionKey`, forwarded to worker threads via
   `workerData` (not `postMessage`), and is **never** logged. Argon2id auth
   (`@node-rs/argon2`, memoryCost 64 MB, parallelism 4) with 5-attempt lockout
   over 15 minutes (`src/main/services/auth/AuthService.ts:12-22`). Recovery
   key uses `nanoid(32)` and is hashed before storage. Postgres credentials
   use Electron `safeStorage` (DPAPI / Keychain / libsecret).

7. **Renderer XSS** — only one `v-html` use (`LogViewer.vue:96`), and it
   passes the input through `escapeHtml` (`L235-242`) before regex-replacing
   the search highlight. No `innerHTML`, `insertAdjacentHTML`, `eval`, or
   `new Function` anywhere in `src/renderer/src`. Molstar runtime is now
   loaded via Vite asset graph (`useMolstarViewer.ts:46-51`) rather than
   the legacy public-JS-injection path. CSP in `src/renderer/index.html:18-21`
   is strict (`default-src 'self'`, no `unsafe-inline` for scripts; only
   `unsafe-eval` + `wasm-unsafe-eval` + `blob:` for the molstar runtime).

8. **Preload contract** — `tests/shared/types/preload-contract.test.ts`
   asserts (a) WindowAPI / preload `api` / mockApi keys align (lines
   381-423), (b) every domain has methods defined (L257-263), (c) scoped
   domains expose `IpcResult<T>` types not raw values (L425-436), (d) the
   `cases`/`database`/`filter-presets` preload domains do **not** call
   `unwrapIpcResult` so renderer-side unwrap discipline is enforced. The
   2026-05-06 finding (`CaseMetadataAPI` / `RegionFilesAPI` typed as raw
   values) is no longer reproducible — these domains now follow the
   `IpcResult<T>` contract pattern, verified through the per-module
   alignment check.

9. **Workflow pinning** — every `uses:` in `.github/workflows/{build,docs,release}.yml`
   is full-SHA pinned with a same-line tag comment (`actions/checkout@de0fac2e... # actions/checkout@v6.0.2`).
   Dependabot is configured to keep both `npm` and `github-actions` ecosystems
   current with sensible groupings (`.github/dependabot.yml`).

10. **Worker boundaries** — `import-worker`, `export-worker`, `db-worker`,
    `delete-worker`, `rebuild-summary-worker` receive `encryptionKey` via
    `workerData` only. No `postMessage` payload includes the key; the
    `console.warn` calls in worker files are allowed per AGENTS.md and do
    not interpolate secrets. `console.*` audit across `src/main/**` returned
    40 hits, every one in either a worker thread, `MainLogger.ts` itself, or
    `main.ts`/`preload/index.ts` (all explicitly permitted in AGENTS.md).

11. **`wrapHandler` discipline** — 226 `wrapHandler` usages against 197
    `ipcMain.handle/.on` registrations across `src/main/ipc/**`. Audit of
    every registration confirmed that the only un-wrapped handlers are
    `database:selectFile` and `database:selectSaveLocation` (F-03).

## Hardening checklist (prioritized)

- [ ] **F-01** — Add Zod schemas to `import:start`, `import:startMultiFile`,
      `import:vcfPreview`, `import:vcfMultiPreview`, and the
      `BedFilter.fromFile` call site. Highest priority.
- [ ] **F-02** — Validate `system:setWorkerThreads` count.
- [ ] **F-08** — `npm audit fix` to upgrade `qs` (transitive under `pg`).
      Trivial.
- [ ] **F-09** — Restrict `caseName` to a printable allowlist; strip control
      chars in `MainLogger` as belt-and-suspenders.
- [ ] **F-10** — Add `will-navigate` guard on `mainWindow.webContents`.
- [ ] **F-04** — Cap `UserDomainsSchema` array length to 100.
- [ ] **F-03** — Wrap two `database:*` dialog handlers in `wrapHandler` for
      envelope consistency.
- [ ] **F-05** — Move PRAGMA key from string interpolation to typed API; reject
      `^x'` prefixes if string form is kept.
- [ ] **F-06** — Add a `mainLogger.warn` at startup when
      `VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local` is active.
- [ ] **F-07** — Plan `pdbe-molstar@3.1.3` upgrade (separate phase) or document
      suppression with rationale.

## What was NOT confirmed

1. **Runtime test of IPC validation enforcement** — I read the schemas and
   the handler call sites; I did not run the test suite to confirm every
   schema actually rejects malformed input. The audit was static.
2. **Cross-renderer XSS in third-party Vuetify components** — Vuetify is
   broadly safe but I did not audit every component variant in use for
   prop-injection of user data into `v-tooltip` titles, `v-snackbar` HTML
   content, etc. A focused renderer-XSS pass against the comment/markdown
   surfaces would be a worthwhile follow-up.
3. **Packaging / signing pipeline secrets** — out of scope; SSL.com eSigner
   credentials and Apple notarization keys live in repo secrets, which the
   audit could not inspect.
4. **Autoupdater signature verification** — `electron-updater` checks
   signatures by default; I did not verify the `dev-app-update.yml` /
   `latest*.yml` provider config or test a downgrade attack.
5. **HPO/VEP/etc. response parsing for prototype pollution** — every API
   client routes through Zod schemas under `src/main/services/api/schemas/`,
   but the parsers themselves were not deeply audited for `__proto__` /
   `constructor` key handling in nested JSON.
6. **Renderer storage of sensitive data** — `localStorage` / `IndexedDB` use
   in the renderer was not audited for PHI persistence.
7. **`gh` queries** — not run during this audit; no open security advisories
   were checked from the GitHub side.

## Appendix — `npm audit --omit=dev` summary

```
critical: 0   high: 0   moderate: 1   low: 5   total: 6
```

- `qs` 6.11.1–6.15.1 (moderate) via `pg`. `npm audit fix` available.
- `elliptic` ≤6.6.1, `browserify-sign`, `create-ecdh`, `crypto-browserify`,
  `pdbe-molstar` (all low) — single chain rooted at `pdbe-molstar`. Fix
  requires `pdbe-molstar@3.1.3` semver-major.

No critical or high CVEs in the production dependency tree. No release
blockers.
