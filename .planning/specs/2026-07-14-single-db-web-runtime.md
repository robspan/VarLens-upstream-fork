# Single-DB Web Runtime Contract

**Status:** Accepted implementation scope from the 2026-07-10 platform meeting  
**Scope:** VarLens web runtime and app-owned database schema  
**Supersedes:** the active topology in `2026-06-22-public-private-annotation-db-boundary.md` and the Web 11/13 control, workspace-router, shared-annotation-DB, and annotation-sync plans

## Context

LB-MAP will run one dedicated VarLens application instance per approved user.
The platform, not VarLens, creates and removes the instance, database, roles,
Secrets, Service, route, storage, and runtime resources. Each VarLens process
therefore receives exactly one PostgreSQL connection and has no reason to know
about other users' instances or databases.

VARVIS performs annotation outside VarLens. Doctors export annotated JSON from
VARVIS and import it into VarLens through the existing app import surface. If
reference-annotation tables are supplied for lookup, the operator copies them
into the same instance database; VarLens does not connect to a shared or
separate annotation database and does not run the former annotation-bundle sync
pipeline.

## Acceptance Criteria

1. The web server has one database contract: `VARLENS_PG_URL` plus the existing
   optional single-database settings such as `VARLENS_PG_SCHEMA` and pool limits.
2. The server opens one PostgreSQL pool for app data, app users, audit writes,
   and optional reference-annotation reads in that same database.
3. VarLens contains no active control-DB mode, request-time database router,
   workspace credential resolver, per-workspace pool cache, or separate
   public-annotation connection.
4. App-owned migrations remove the obsolete per-user routing/resource columns
   from the VarLens `users` table and define the optional reference-annotation
   read tables in the instance database. These tables have data class
   `public_reference_annotations`; case data and audit retention are unchanged.
5. The former annotation-bundle-to-public-DB sync command is not built or
   shipped. Annotation-manifest validation utilities remain available until the
   separate parser/manifest decision is resolved.
6. Platform OIDC remains supported. The ID token is always verified for
   signature, issuer, audience, time, nonce, and configured MFA claims. Access
   token JWT verification is opt-in because valid providers may issue opaque
   access tokens.
7. A platform session requires both an active app entitlement and an active
   local VarLens user with the same OIDC subject. Entitlement role mapping is
   retained; database/resource lifecycle fields are not part of the login
   contract.
8. Local platform-user binding is an operator-only image command. It may create
   or update the app-local user row, but it accepts no database, workspace,
   annotation-snapshot, Kubernetes, or infrastructure parameters. The
   request-serving app exposes no privileged provisioning endpoint.
9. Web 12 telemetry remains independent of the removed topology. Server-created
   request IDs, correct import-operation accounting, mandatory upload audit,
   structured logs, metrics, and health endpoints remain covered by tests.
10. Desktop SQLite behavior and the normal JSON/VCF import paths do not change.

## Repository Ownership

VarLens owns:

- the single PostgreSQL runtime contract;
- app schema migrations and app-local user mapping;
- OIDC token/session validation and app-role consumption;
- app telemetry, imports, audit events, and optional same-DB reference reads.

LB-MAP Operations, IAC, and the Helm chart own:

- one application instance and one database per approved user;
- database/role/Secret/Service/route creation, suspension, and cleanup;
- storage, RAM, shared CPU, backup, and restore policy;
- copying approved reference data into an instance database;
- instance inventory and lifecycle state.

## Non-Goals

- No infrastructure or database creation from VarLens.
- No control database or multi-database routing compatibility mode.
- No shared annotation database or annotation-workflow integration.
- No new VARVIS JSON importer in this change; importer completeness remains an
  app-owner decision.
- No choice between Keycloak, Lab Genius, Entra, or another OIDC provider. The
  app contract stays provider-compatible.
- No final decision on platform entitlement ownership or MFA claim vocabulary;
  the current fail-closed contract remains until those stakeholders decide.
  Provider and claim decisions are tracked in
  [berntpopp/VarLens#330](https://github.com/berntpopp/VarLens/issues/330).
- No resource-size values in the app repository.

## Validation

- Static/type tests prove hosted topology symbols and build entries are gone.
- Migration tests prove obsolete routing fields are removed and same-database
  reference tables are present.
- Auth tests prove local subject binding, entitlement role mapping, denial, MFA,
  and opaque access-token compatibility.
- Web gate tests cover server-generated request IDs, telemetry accounting,
  mandatory upload audit, same-database reference lookup, and PostgreSQL-only
  startup.
- `VARLENS_WEB=1 make ci` is the minimum completion gate; Postgres integration
  tests run when the local engine is available.
