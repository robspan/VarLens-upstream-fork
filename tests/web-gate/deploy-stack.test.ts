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
    // Phase 2 deliverable #5: web mode is Postgres-only. The varlens
    // service must wire VARLENS_PG_URL into its env (sourced from
    // POSTGRES_* with sane defaults so a fresh stack-up auto-resolves)
    // and depend on the postgres service so compose orchestrates them
    // in the right order.
    const yaml = readFileSync(COMPOSE, 'utf8')
    expect(yaml, 'varlens.environment must include VARLENS_PG_URL').toMatch(
      /varlens:[\s\S]+?environment:[\s\S]+?VARLENS_PG_URL/
    )
    expect(yaml, 'VARLENS_PG_URL default must point at the postgres service hostname').toMatch(
      /VARLENS_PG_URL:[^\n]+postgres:5432/
    )
    expect(yaml, 'varlens must depend_on postgres health').toMatch(
      /varlens:[\s\S]+?depends_on:[\s\S]+?postgres:[\s\S]+?service_healthy/
    )
    expect(yaml, 'VARLENS_RECOVERY_KEY_DIR must be wired (Phase 2 path moved)').toMatch(
      /VARLENS_RECOVERY_KEY_DIR/
    )
  })

  test('Phase 2: Makefile activates the postgres profile unconditionally', () => {
    // The DB=sqlite escape hatch is gone; the postgres profile is
    // always on for web deploys.
    const makefile = readFileSync(MAKEFILE, 'utf8')
    expect(makefile, 'COMPOSE_PROFILES=postgres must be unconditional').toMatch(
      /^COMPOSE_PROFILES_FLAG\s*=\s*COMPOSE_PROFILES=postgres/m
    )
    expect(
      makefile,
      'no `ifeq ($(DB),postgres)` branching for COMPOSE_PROFILES — pg is mandatory'
    ).not.toMatch(/ifeq\s*\(\$\(DB\),postgres\)\s*\n\s*COMPOSE_PROFILES_FLAG/)
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
