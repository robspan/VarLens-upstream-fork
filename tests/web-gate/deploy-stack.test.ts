import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * §infrastruktur2 application-container slot — the IaC compose stack must
 * actually carry the VarLens app. Before the monorepo merge this slot
 * was an explicit TODO comment ("Still to come: application container");
 * after the wiring lands, this gate prevents anyone from accidentally
 * removing the slot or breaking the operator's plug-and-play path.
 *
 * The test reads the deploy artifacts as plain text. Operators don't
 * round-trip through this code, so brittle YAML parsers are unnecessary —
 * substring checks against the canonical wiring keep the gate fast and
 * the failure mode obvious.
 */

const DEPLOY = resolve(process.cwd(), 'web-deploy')
const COMPOSE = resolve(DEPLOY, 'compose/docker-compose.yml')
const CADDYFILE = resolve(DEPLOY, 'compose/Caddyfile')
const ENV_EXAMPLE = resolve(DEPLOY, 'compose/.env.example')
const MAKEFILE = resolve(DEPLOY, 'Makefile')
const CLI = resolve(DEPLOY, 'bin/varlens')

describe.skipIf(!existsSync(DEPLOY))('deploy-stack wiring gate', () => {
  test('compose/docker-compose.yml registers the varlens service', () => {
    const yaml = readFileSync(COMPOSE, 'utf8')
    expect(yaml, 'compose must declare a varlens service block').toMatch(/^\s+varlens:/m)
    expect(yaml, 'compose must reference the GHCR image').toMatch(
      /image:\s*\$?\{?VARLENS_IMAGE.*ghcr\.io\/.*varlens-web/
    )
    expect(yaml, 'varlens must join the existing varlens network').toMatch(
      /varlens:[\s\S]+?networks:[\s\S]+?-\s*varlens/
    )
    // Volume mount uses the data subdir specifically (see d2f2c829): the
    // parent /mnt/data/app stays deploy-owned for rsync, /mnt/data/app/data
    // is chowned to the container's varlens uid (1001) for SQLite writes.
    expect(yaml, 'varlens must mount /mnt/data/app/data:/data subdir').toMatch(
      /\/mnt\/data\/app\/data:\/data/
    )
    expect(yaml, 'varlens must declare a healthcheck against /healthz').toMatch(
      /varlens:[\s\S]+?healthcheck:[\s\S]+?\/healthz/
    )
  })

  test('Caddyfile reverse-proxies /varlens/* to the app container', () => {
    const caddy = readFileSync(CADDYFILE, 'utf8')
    expect(caddy, 'Caddyfile must reverse_proxy to varlens:8080').toMatch(
      /reverse_proxy\s+varlens:8080/
    )
    expect(caddy, 'route prefix must be /varlens (handle_path strips it)').toMatch(
      /handle_path\s+\/varlens\*/
    )
  })

  test('.env.example documents the operator-configurable web envvars', () => {
    const env = readFileSync(ENV_EXAMPLE, 'utf8')
    // Phase 2: VARLENS_DB_PATH dropped (web is Postgres-only);
    // VARLENS_RECOVERY_KEY_DIR replaces dirname(VARLENS_DB_PATH) as
    // the recovery-key location.
    for (const required of [
      'VARLENS_IMAGE=',
      'VARLENS_RECOVERY_KEY_DIR=',
      'VARLENS_LOG_LEVEL=',
      'VARLENS_ADMIN_USERNAME=',
      'VARLENS_ADMIN_PASSWORD=',
      'VARLENS_ADMIN_DISPLAY_NAME='
    ]) {
      expect(env, `.env.example must mention ${required}`).toContain(required)
    }
  })

  test('Makefile smoke target probes the app /healthz', () => {
    const makefile = readFileSync(MAKEFILE, 'utf8')
    expect(makefile, 'smoke must curl /varlens/healthz').toMatch(/\/varlens\/healthz/)
    expect(makefile, 'running-services check must include varlens (4 services)').toMatch(
      /\(caddy\|uptime-kuma\|dozzle\|varlens\)/
    )
  })

  test('CLI bin/varlens _smoke() probes the app /healthz', () => {
    const cli = readFileSync(CLI, 'utf8')
    expect(cli, 'CLI smoke must include /varlens/healthz').toMatch(/\/varlens\/healthz/)
    expect(cli, 'CLI services check must include varlens').toMatch(
      /\(caddy\|uptime-kuma\|dozzle\|varlens\)/
    )
  })

  test('smoke uses ss -tlnp bind-shape probes for Kuma/Dozzle (F5)', () => {
    // Regression gate for F5 from the 2026-05-06 orchestrator audit:
    // probing "direct port closed" via curl rc=000 conflated bind-shape
    // (the security property: bound to loopback only) with connection
    // failure modes (refused, timeout, dropped, unreachable). Replace
    // with a positive assertion via `ss -tlnp` that the listener is
    // bound to 127.0.0.1 / [::1] only. Both the Makefile and the CLI
    // smoke must use this shape.
    const makefile = readFileSync(MAKEFILE, 'utf8')
    expect(makefile, 'Makefile smoke must use ss -tlnp for bind-shape checks').toMatch(/ss -tlnp/)
    expect(makefile, 'Makefile smoke must probe Kuma localhost bind').toMatch(
      /Kuma bound to localhost only/
    )
    expect(makefile, 'Makefile smoke must probe Dozzle localhost bind').toMatch(
      /Dozzle bound to localhost only/
    )
    expect(
      makefile,
      'Makefile smoke must not retain the legacy "Direct port closed" probe'
    ).not.toMatch(/Direct port \d+ closed/)
    const cli = readFileSync(CLI, 'utf8')
    expect(cli, 'CLI smoke must use ss -tlnp for bind-shape checks').toMatch(/ss -tlnp/)
    expect(cli, 'CLI smoke must probe Kuma localhost bind').toMatch(/Kuma bound to localhost only/)
    expect(cli, 'CLI smoke must probe Dozzle localhost bind').toMatch(
      /Dozzle bound to localhost only/
    )
  })

  test('Phase 2: varlens service receives VARLENS_PG_URL + depends_on postgres', () => {
    // Phase 2 deliverable #5: web mode is Postgres-only. Anchor every
    // assertion on the varlens service block specifically (extracted
    // by header) so a future refactor that moves env or depends_on to
    // a different service is caught.
    const yaml = readFileSync(COMPOSE, 'utf8')

    // Extract the varlens service block: from `^  varlens:` through
    // the start of the next top-level key (`^  \w+:` or end of file).
    const varlensMatch = yaml.match(/^ {2}varlens:[\s\S]+?(?=^ {2}\w[\w-]*:|^\w|$(?![\r\n]))/m)
    expect(varlensMatch, 'compose must declare a varlens service block').not.toBeNull()
    const varlensBlock = varlensMatch![0]

    expect(varlensBlock, 'varlens must declare VARLENS_PG_URL').toContain('VARLENS_PG_URL')
    expect(varlensBlock, 'VARLENS_PG_URL default must use postgres:// scheme').toMatch(
      /VARLENS_PG_URL:[\s\S]*?postgres:\/\//
    )
    expect(varlensBlock, 'VARLENS_PG_URL default must interpolate POSTGRES_PASSWORD').toMatch(
      /VARLENS_PG_URL:[\s\S]*?\$\{POSTGRES_PASSWORD/
    )
    expect(
      varlensBlock,
      'POSTGRES_PASSWORD interpolation must use the `:?` fail-fast guard'
    ).toMatch(/\$\{POSTGRES_PASSWORD:\?/)
    expect(varlensBlock, 'VARLENS_PG_URL default must target the in-stack postgres host').toMatch(
      /@postgres:5432\//
    )
    expect(varlensBlock, 'varlens must depend_on postgres health').toMatch(
      /depends_on:[\s\S]*?postgres:[\s\S]*?condition:\s*service_healthy/
    )
    expect(varlensBlock, 'VARLENS_RECOVERY_KEY_DIR must be wired (Phase 2 path moved)').toContain(
      'VARLENS_RECOVERY_KEY_DIR'
    )
    expect(
      varlensBlock,
      'VARLENS_DB_PATH must NOT survive on the varlens service (Phase 2 dropped SQLite)'
    ).not.toMatch(/VARLENS_DB_PATH/)
  })

  test('Phase 2: postgres service is unconditional (no profile gate)', () => {
    // The `profiles: [postgres]` gate from Stage 1.5 was dropped:
    // postgres is mandatory in Phase 2 and varlens depends_on it
    // directly. A regression that re-introduces the profile would
    // make `docker compose up` fail when COMPOSE_PROFILES is unset.
    const yaml = readFileSync(COMPOSE, 'utf8')
    const postgresMatch = yaml.match(/^ {2}postgres:[\s\S]+?(?=^ {2}\w[\w-]*:|^\w|$(?![\r\n]))/m)
    expect(postgresMatch, 'compose must declare a postgres service block').not.toBeNull()
    expect(
      postgresMatch![0],
      'postgres service must NOT carry a profiles: [postgres] gate'
    ).not.toMatch(/^\s+profiles:\s*\[\s*postgres\s*\]/m)
    expect(
      postgresMatch![0],
      'postgres service must declare a healthcheck (depends_on service_healthy needs it)'
    ).toMatch(/healthcheck:[\s\S]+?pg_isready/)
  })

  test('Phase 2: Makefile drops conditional postgres-profile branching', () => {
    // The DB=sqlite escape hatch is gone. Makefile must not branch on
    // `ifeq ($(DB),postgres)` for COMPOSE_PROFILES (postgres is on
    // unconditionally) and must hard-error on `DB=sqlite`.
    const makefile = readFileSync(MAKEFILE, 'utf8')
    expect(makefile, 'no `ifeq ($(DB),postgres)` branching for COMPOSE_PROFILES_FLAG').not.toMatch(
      /ifeq\s*\(\$\(DB\),postgres\)\s*\n\s*COMPOSE_PROFILES_FLAG/
    )
    expect(
      makefile,
      'DB=sqlite must hard-error (silent fall-through to Postgres is the trap)'
    ).toMatch(/\$\(error[^)]*DB=\$\(DB\)[^)]*not supported/)
  })

  test('deploy-stack rsync --delete preserves runtime data/ and operator .env', () => {
    // Regression gate for the F1 critical finding from the 2026-05-06
    // orchestrator audit: rsync --delete in the deploy-stack target
    // strips /mnt/data/app/data (SQLite DB + admin-recovery-key) and
    // /mnt/data/app/.env (server-generated POSTGRES_PASSWORD) on every
    // re-run unless explicitly excluded. Image rotation, config update,
    // or any subsequent `make stack-up` would silently delete user data.
    const makefile = readFileSync(MAKEFILE, 'utf8')
    expect(makefile, 'rsync invocation must --exclude data').toMatch(/--exclude\s+data\b/)
    expect(makefile, 'rsync invocation must --exclude .env').toMatch(/--exclude\s+\.env\b/)
  })
})
