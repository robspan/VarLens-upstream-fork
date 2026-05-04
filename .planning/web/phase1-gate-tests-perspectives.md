# Phase 1 Gate Tests — 10 Agent Perspectives (raw)

Companion to `phase1-gate-tests.md`. Captured 2026-05-04 from 10 parallel Opus 4.7 sub-agents, each briefed with the same Phase 1 context but a distinct lens. Kept verbatim for traceability — the synthesis in the sibling doc deliberately rejects parts of these proposals (notably most of the up-front abstraction work).

---

## 1. Test architect

**BackendDriver shape — domain method, not channel, not scenario.**

Domain method (`cases.list(args)`, `variants.query(filter)`) is the right level. Raw channel leaks the Electron transport into the test. Scenario-step is too coarse. Domain method matches `src/shared/ipc/domains/<name>.ts` one-to-one.

```ts
// tests/parity/drivers/BackendDriver.ts
export interface BackendDriver {
  readonly kind: 'electron' | 'web'
  setup(fixture: FixturePlan): Promise<void>
  teardown(): Promise<void>
  cases: CasesDomain
  variants: VariantsDomain
  imports: ImportsDomain
}
```

Both drivers `unwrapIpcResult` internally so scenarios assert on `T`. Scenarios live at `tests/parity/scenarios/<domain>.parity.test.ts`. Hard rule: no `if (driver.kind === ...)` branches inside scenarios.

First scenario: `cases.list({}) → []` then `cases.list({}) → [c1]` after insert. Proves driver lifecycle, fixture reset, IpcResult unwrap, dispatch, ordering.

## 2. Electron platform engineer

**Reuse `electron-app.ts`, don't fork.** Drive through `window.api` (full stack) — for a parity gate the whole point is "does the user-facing path produce equivalent results?". Skipping to `ipcRenderer.invoke` would miss preload bugs.

Parity tests run under Electron ABI only (`make build && make rebuild && make test-parity`). WebDriver runs under Node ABI. Keep on separate make targets.

Lifecycle mitigations: await `renderer-interactive` perf milestone before first IPC; pre-warm with a no-op `cases:list`; gate on `await page.waitForFunction(() => window.api != null)`.

**Shared app + DB reset, not per-scenario boot.** 50 scenarios × 3s = 2.5 min wasted. Boot once per worker, reset state by closing DB / replacing SQLite file / re-opening. Reserve full relaunch only for boot-behaviour scenarios, tagged `@cold-boot`.

## 3. Fastify / WebDriver engineer

**Use `fastify.inject()`** (light-my-request). No socket, no port collisions, ~10× faster than `listen`. Reserve `listen` only for SIGTERM tests.

```ts
class WebDriver {
  async start() { this.app = await buildApp({ db: ':memory:' }); await this.app.ready() }
  async call(method, url, body?) {
    const res = await this.app.inject({ method, url, payload: body, headers: { cookie: ... }})
    for (const c of res.cookies ?? []) this.cookies.set(c.name, c.value)
    return res
  }
}
```

Auth state: cookie jar on driver + `@fastify/secure-session`. Don't invent bearer-token shortcut for tests.

Minimum scaffold for first green scenario: `buildApp(opts)` factory, `@fastify/sensible`, DB plugin with migrations, `@fastify/cookie` + `@fastify/secure-session`, `preHandler` auth hook → `req.userId`, `GET /api/cases`, `GET /healthz`.

Envelope: HTTP-idiomatic (2xx + raw JSON, 4xx/5xx + `{ error: SerializableError }`). Keep `IpcResult` strictly inside Electron. Parity assertions compare unwrapped `T`, not envelopes.

SIGTERM: don't send a real signal in unit tests. Export `gracefulShutdown(app, signal)` and unit-test it. One isolated process-fork test for the real signal path.

Migration idempotency: start, stop, reopen same path, start again, snapshot `sqlite_master` between boots — must be byte-identical.

## 4. DB / migration / fixture isolation

**Per-scenario tmp DB on tmpfs, with shared snapshot + per-scenario copy.** Migrations once into `tests/.cache/parity-base.sqlite`, then `fs.copyFile` per scenario. `:memory:` rejected: better-sqlite3-multiple-ciphers can't share across processes.

Reset between scenarios: delete file, re-copy snapshot. Don't `DELETE FROM` — autoincrement counters and `sqlite_sequence` leak state.

Result normalization: replace stripped fields with sentinels (`'<ID>'`, `'<TS>'`) rather than deleting. Sort by stable composite key (`chrom, pos, ref, alt, sample_id`).

```ts
normalize<T>(rows: T[], opts: {
  stripPks?: string[]; stripTimestamps?: string[]; stripPaths?: string[];
  stripUuids?: string[]; auditRunIdField?: string;
}): T[]
```

Migration idempotency (cheapest first): `PRAGMA user_version` unchanged → `sqlite_master` dump byte-equal → row counts per table unchanged.

`user_id` gate: schema introspection, not AST. Migrations rot; live schema doesn't. Maintain a small explicit allowlist of exempt tables.

Encrypted DB: fixed key per test run, not per scenario. One dedicated scenario with rotated key covers cipher path.

Order sensitivity: every parity-asserted query must `ORDER BY` a unique composite. Add a lint that scans `src/shared/sql/` for `ORDER BY` clauses without a trailing PK.

## 5. Auth/security engineer

**AuthProvider interface:**

```ts
interface AuthProvider {
  authenticate(credentials: Credentials): Promise<AuthResult>
  createSession(userId: number, ctx: SessionContext): Promise<Session>
  validateSession(token: string): Promise<SessionClaims | null>
  revokeSession(sessionId: string): Promise<void>
  refreshSession?(token: string): Promise<Session>
  listActiveSessions(userId: number): Promise<Session[]>
}
```

`Credentials` is a discriminated union (`{kind:'password'}` | `{kind:'oidc-callback'}`). Keep `userId` canonical — never let OIDC `sub` leak above the provider boundary.

8 parity scenarios: valid login, wrong password (no oracle), lockout after N, concurrent multi-user, session validation after restart, logout invalidates, audit log entries match, expired session rejected.

`@node-rs/argon2` ships prebuilt binaries for `linux-x64-gnu/musl`, `linux-arm64`, `darwin`, `win32` — **no rebuild in standard Node containers.** Hashes are bit-identical between native and WASM.

Web-only security tests: CSRF, cookie flags, CSP+HSTS, rate limit on login, log scrubbing.

**Trap to avoid: do not key sessions or audit rows by username. Use numeric `user_id` everywhere.** Stage 2 OIDC will bind one local `user_id` to `(issuer, sub)`.

## 6. Static / structural test specialist

| Rule | Mechanism |
|---|---|
| `getDatabaseService` ban | Vitest + ts-morph |
| No SQL outside repo | ESLint custom rule |
| `domain:action` IPC naming | Vitest static scan |
| `user_id` schema | Schema introspection |
| No Electron in web bundle | Bundle introspection (skip-if-missing) |
| `IpcResult<T>` locked | already covered |

Concrete db-seam test:

```ts
const ALLOW = new Set(['src/main/storage/session.ts']);
const BANNED = ['getDatabaseService', 'getDbPool'];
test('only StorageSession touches DB factories', () => {
  const p = new Project({ tsConfigFilePath: 'tsconfig.node.json' });
  const violations: string[] = [];
  for (const sf of p.getSourceFiles('src/**/*.ts')) {
    const rel = sf.getFilePath().replace(`${process.cwd()}/`, '');
    if (ALLOW.has(rel)) continue;
    for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (BANNED.includes(id.getText()) &&
          id.getParent()?.getKind() === SyntaxKind.CallExpression) {
        violations.push(`${rel}:${id.getStartLineNumber()} ${id.getText()}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
```

Web bundle leak — skip-if-missing keeps it forward-compatible:

```ts
test.skipIf(!existsSync(dist))('web bundle has no Electron deps', () => {
  const src = readFileSync(dist, 'utf8');
  for (const banned of ['require("electron")', 'better-sqlite3-multiple-ciphers', '\\.node"'])
    expect(src).not.toMatch(banned);
});
```

False-positive mitigations: comment-based escape hatch for db-seam, scoped SQL-string lint, monotonically-shrinking LEGACY_CHANNELS set, per-table opt-out for user_id.

## 7. CI/ops engineer

**Targets:**

```make
gate-static       # <60s
gate-web-only     # needs web build
gate-parity       # needs both builds
gate              # = sum of above
gate-report       # emits .planning/artifacts/gate/summary.json
```

`gate-static` on every PR. `gate-web-only` skips with status `pending` until web build exists. `gate-parity` Linux-only on PRs; matrix nightly; release tag requires full matrix.

WebDriver probes `out-web/server.js`; missing → driver reports `unavailable`, scenarios emit `skip` with reason `web-build-missing`. Once Fastify lands, `VARLENS_REQUIRE_WEB=1` flips skips to failures.

Parallelism: sharded Vitest, n=4 on Ubuntu, n=2 on Win/macOS. Reuse Electron app per shard, reset between scenarios.

Visualization: single composite status check `gate / phase-1` + sticky PR comment with `Phase 1 gate: 8/12 green | 2 pending | 2 failing`.

**Anti-pattern: do not gate on flaky parity scenarios by retrying.** `retries: 2` hides the IPC↔HTTP races this suite exists to catch. Quarantine flakes to a non-blocking target.

## 8. Result normalization / golden snapshot

Equivalence model per scenario class:

| Class | Model |
|---|---|
| Filter result | Structural diff with masking + ordered-or-keyed compare |
| Import outcome | Schema-level invariants |
| Export content | Golden snapshot shared by both drivers |
| ACMG verdict | Strict deep equal after normalize |
| HPO matches | Structural diff, set-equality on (term_id, score_bucket) |
| Audit/log entries | Schema-level (event types and counts), not content |

Hybrid normalize: global registry + scenario overrides.

Order heuristic: order is meaningful iff API declares `ORDER BY` or UI renders ordered. `orderSensitive: true` by default — unordered must be opt-in.

Snapshot maintenance: one file per scenario in `__snapshots__/`. `make parity-update` only updates failing snapshots. CI is read-only. **Rule: a PR may update snapshots OR change normalization, never both.**

Export-roundtrip: hash the canonical row stream, not the DB file (page layout differs across SQLite/Postgres). Sorted columns, `canonicalJson` (sorted keys, no whitespace), masked fields replaced via the same registry.

Meta-test against over-masking — two guards:

1. **Mutation canary** — inject a known semantic perturbation, assert parity test fails. Green canary = normalization swallowed a real bug.
2. **Mask budget** — track `masked_field_count / total_field_count`. CI fails if ratio > 0.25 or new mask added without `// reason:` comment.

## 9. Skeptic / minimum-viable-gate

**5 tests. That's it.**

1. Web `/healthz` returns 200 with version + db status.
2. SIGTERM closes DB and exits 0 within 5s.
3. **One round-trip parity test:** import small VCF, query 3 filters, assert identical row counts + first 10 IDs across both backends.
4. Migration idempotency: run twice, identical schema hash.
5. Static rule: grep for `ipcRenderer`, `electron.app`, `BrowserWindow` in shared/web code.

Cut: `BackendDriver` (YAGNI — you have one parity test), golden snapshots (rot, mask real diffs), schema introspection framework (sha256 of `sqlite_master` dump beats it), AST-based static rules (grep + code review), cross-OS matrix, ~50 parity scenarios.

**Biggest YAGNI risk: the BackendDriver abstraction.** Build it the day the second real test demands it.

**Framework-never-scenarios risk: ship 5 real, ugly, copy-pasted parity assertions before any helper extraction. Rule of three.**

Scenario to exclude: ACMG classification parity. Pure computation over already-loaded data; can't differ between backends unless something more fundamental broke (test #3 catches it).

2-week cut: tests 1, 2, 3, 5. Skip migration idempotency (manual). 4 tests, ~1 day writing, 9 days for actual Phase 1 code.

## 10. Bridge Clause / Stage 2 risk auditor

**Per-concern tests (all static/AST or schema):**

- Auth abstraction: grep — no service/IPC file imports `argon2`/`bcrypt`/`jsonwebtoken` directly. Plus `AuthProvider` interface declaration with `Credential` discriminated union and `Principal.claims: Record<string,unknown>`. Compile-time test: a fake `OidcProvider` stub typechecks.
- Repository boundary: AST rule — no SQL string literal outside `src/main/storage/**`.
- `user_id` presence: schema introspection. **Single highest-leverage test.**
- File I/O adapter: grep — no `fs.readFile`/`fs.createReadStream` outside `src/main/io/adapters/**`.

**Audit log future-shape:** assert `audit_log` columns are subset of `{id, ts, user_id, action, entity, entity_id, pre_state, post_state, ip, user_agent}`. Lexical, costs nothing.

**Postgres-readiness lint:** ban `AUTOINCREMENT`, `||` for non-string, `strftime`, `INSERT OR REPLACE`, `ROWID`, `LIMIT` without `ORDER BY`. Kysely wrapper that throws if `.limit()` called without prior `.orderBy()`.

**Token-shaped credential now:** `Credential = {kind:'password'} | {kind:'token', jwt:string}`. Phase 1 only handles password; token throws `NotImplemented`. Cheapest non-YAGNI bet.

**Heuristic for cargo-cult tests:** a real Bridge-Clause test fails when someone writes plausible Phase 1 code that closes the door. If failure requires writing code no one would write, it's wishful — delete it.

**Quiet door-closer to flag:** SQLite `INTEGER PRIMARY KEY` rowid IDs as canonical entity identifier exposed over IPC. Closes the door because (a) BIGSERIAL collides across per-user shards under RLS, (b) rowid IDs leak creation order (§203 side-channel for Charité tenant), (c) federation/export needs stable IDs surviving dump/restore. Switch to ULIDs (`TEXT PRIMARY KEY`) **now**, while there's one user and zero external references.
