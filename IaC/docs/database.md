# Database backend for the Concept Pilot

Plan reference: `bewertungen.html` §bewertung2 recommends SQLite as the default for Stage 1
(task-profile preference). PostgreSQL is the Stage 2 requirement (RLS, append-only triggers,
JSON operators) and is abstracted via the application's repository interface.

So that the stakeholder can pick either one at kickoff without delay, the Compose stack offers
both backends. The default is SQLite (no container overhead). PostgreSQL is enabled via a
profile switch.

## Default: SQLite

```sh
make stack-up        # equivalent to make stack-up DB=sqlite
```

- No database container is started.
- The application creates its own SQLite file under `/mnt/data/app/` once it is added to the
  Compose stack.
- Advantage: minimal footprint, no dedicated Postgres backup needed (`/mnt/data` is included
  in the restic backup anyway).
- Disadvantage: multi-user load beyond about five concurrently writing sessions becomes
  slow (see assessment in `bewertungen.html` §bewertung2).

## Switching to PostgreSQL

```sh
make stack-up DB=postgres
```

What happens:
- The `postgres` service in the Compose stack is enabled via the `postgres` profile.
- On first invocation, `/mnt/data/app/.env` is generated on the server from `.env.example`
  and the `POSTGRES_PASSWORD` field is filled with a random 32-character base64 value.
- The database volume lives at `/mnt/data/postgres` (already created by cloud-init,
  survives a server replacement).
- Postgres binds only to `127.0.0.1:5432`, so it is not directly reachable from the internet.
  The later application container connects via the internal `varlens` Docker network.

Default values (overridable in `.env`):
- Database name: `varlens`
- User: `varlens`
- Password: randomly generated on the first stack-up

## Connecting the application (ships with the application container)

The application container connects to the database via the `DATABASE_URL` environment
variable. Examples:

| DB | DATABASE_URL |
|---|---|
| SQLite | `sqlite:////app/data/varlens.db` |
| Postgres | `postgres://varlens:${POSTGRES_PASSWORD}@postgres:5432/varlens` |

The application's repository interface (see `app.html` §app2.1, §adr0) abstracts both
backends so that switching is transparent to the business logic.

## Switching between backends

Data does not migrate automatically. When switching:

1. Back up the current state (restic snapshot or `docker exec postgres pg_dump …`).
2. `make stack-down` to stop.
3. Manually migrate data if any exists (typically not relevant for the Concept Pilot with
   test data - just start fresh).
4. `make stack-up DB=<new-engine>`.

## Bridge to Stage 2

| Stage 1 choice | Stage 2 follow-up |
|---|---|
| SQLite | `pg_dump` from the SQLite file or re-import via the application. The target system is Postgres with RLS and append-only triggers (Stage 2 §infrastruktur3.2 phase 2). |
| Postgres | Directly continuable. The schema migration path remains; RLS policies are added in Stage 2. |

ADR-0 in `adr.html` documents the engine decision in detail.

## Verification

PostgreSQL is running:

```sh
make ssh
docker exec postgres pg_isready -U varlens -d varlens   # accepting connections
docker exec postgres psql -U varlens -d varlens -c 'SELECT version();'
```

Stack status with the active profile:

```sh
make ssh
cd /mnt/data/app && docker compose --profile postgres ps
```
