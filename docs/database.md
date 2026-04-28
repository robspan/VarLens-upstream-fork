# Datenbank-Backend für den Konzept-Pilot

Plan-Bezug: `bewertungen.html` §bewertung2 empfiehlt SQLite als Default für Stufe 1
(Aufgabenprofil-Präferenz). PostgreSQL ist die Stufe-2-Pflicht (RLS, Append-Only-Trigger,
JSON-Operatoren) und wird über das Repository-Interface der Anwendung abstrahiert.

Damit der Stakeholder beim Kickoff zwischen beiden wählen kann ohne Wartezeit, bietet der
Compose-Stack beide Backends. Default ist SQLite (kein Container-Overhead). PostgreSQL
wird per Profile-Schalter aktiviert.

## Default: SQLite

```sh
make stack-up        # entspricht make stack-up DB=sqlite
```

- Kein Datenbank-Container wird gestartet.
- Die Anwendung legt ihre SQLite-Datei selbst unter `/mnt/data/app/` an, sobald sie
  zum Compose-Stack hinzukommt.
- Vorteil: minimaler Footprint, keine Backup-eigene Postgres-Sicherung nötig (`/mnt/data`
  geht ohnehin per restic ins Backup).
- Nachteil: Mehrnutzer-Last über etwa fünf gleichzeitig schreibenden Sessions hinaus
  wird langsam (siehe Bewertung in `bewertungen.html` §bewertung2).

## Wechsel auf PostgreSQL

```sh
make stack-up DB=postgres
```

Was passiert:
- Der `postgres`-Service im Compose-Stack wird durch das `postgres`-Profile aktiviert.
- Beim ersten Aufruf wird auf dem Server `/mnt/data/app/.env` aus `.env.example` erzeugt
  und das `POSTGRES_PASSWORD`-Feld mit einem zufälligen 32-Zeichen-Base64-Wert gefüllt.
- Datenbank-Volume liegt unter `/mnt/data/postgres` (von cloud-init bereits angelegt,
  überlebt Server-Replace).
- Postgres bindet nur an `127.0.0.1:5432`, ist also vom Internet nicht direkt erreichbar.
  Der spätere Anwendungs-Container greift über das interne `varlens`-Docker-Netzwerk zu.

Default-Werte (überschreibbar in `.env`):
- Datenbank-Name: `varlens`
- Benutzer: `varlens`
- Passwort: zufällig generiert beim ersten Stack-Up

## Anwendung anbinden (kommt mit dem Anwendungs-Container)

Der Anwendungs-Container wird über die Umgebungs-Variable `DATABASE_URL` an die Datenbank
angebunden. Beispiele:

| DB | DATABASE_URL |
|---|---|
| SQLite | `sqlite:////app/data/varlens.db` |
| Postgres | `postgres://varlens:${POSTGRES_PASSWORD}@postgres:5432/varlens` |

Das Repository-Interface der Anwendung (siehe `app.html` §app2.1, §adr0) abstrahiert beide
Backends, damit der Wechsel transparent für die Geschäftslogik ist.

## Wechsel zwischen Backends

Die Daten wandern nicht automatisch. Bei Wechsel:

1. Aktuellen Stand sichern (restic-Snapshot oder `docker exec postgres pg_dump …`).
2. `make stack-down` zum Stoppen.
3. Daten manuell migrieren falls vorhanden (für Konzept-Pilot mit Test-Daten typischerweise
   nicht relevant - frisch starten).
4. `make stack-up DB=<neue-engine>`.

## Brücke nach Stufe 2

| Stufe-1-Wahl | Stufe-2-Anschluss |
|---|---|
| SQLite | `pg_dump` aus SQLite-Datei oder Re-Import via Anwendung. Zielsystem ist Postgres mit RLS und Append-Only-Triggern (Stufe 2 §infrastruktur3.2 Phase 2). |
| Postgres | Direkt fortsetzbar. Schema-Migrations-Pfad bleibt, RLS-Policies werden in Stufe 2 ergänzt. |

ADR-0 in `adr.html` dokumentiert die Engine-Entscheidung im Detail.

## Verifikation

PostgreSQL läuft:

```sh
make ssh
docker exec postgres pg_isready -U varlens -d varlens   # accepting connections
docker exec postgres psql -U varlens -d varlens -c 'SELECT version();'
```

Stack-Status mit aktivem Profile:

```sh
make ssh
cd /mnt/data/app && docker compose --profile postgres ps
```
