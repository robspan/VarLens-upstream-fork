VarLens Web-Portierung — Plan
Plan-Version: v1 · Vertrags-Version: v1 · Stand April 2026

1. Auftrag und Zielbild
Auftrag. VarLens als Web-App auf eigenem Server in der AWS Sovereign Cloud verfügbar machen, intern für Nutzer des Stakeholders — statt Desktop-App mit SQLite-Bingo. Initialer Auftrag ist Iteration 1 (siehe §6); Iterationen 2 und 3 sind Folge-Iterationen, die nicht zum initialen Auftrag gehören, aber das Zielbild ergänzen.

Zielbild. Die App spricht nur gegen den App-Vertrag (§2) und ist plattform-agnostisch. Hetzner ist Brücken-Plattform, bis die AWS-Sovereign-Cloud-Zugänge da sind; Migrations-Block (§4) wechselt auf die Ziel-Plattform. Dev-/Test-Modus mit Fake-Daten ist Hauptarbeitsmodus. Echt-Daten-Aufnahme ist eine Stakeholder-Entscheidung außerhalb dieses Plans (siehe §10).

Leitplanken. §7 listet alle Architektur-Entscheidungen (ADRs). §2.4 und §10 grenzen ab, was nicht zum Plan gehört. §6 definiert Sync-Punkte zwischen den Strängen.

Dieser Plan ist Aufgabenprofil, keine vollständige Spezifikation. Konkrete Werkzeug-Wahl, ENV-Variablen-Namen, Endpunkt-Schemata, Compose-Files etc. entstehen jeweils zum Start der betreffenden Phase, nicht im Plan.

2. App-Vertrag (sehr stabil, Pflege nur mit Versions-Bump)
Definiert die Schnittstelle App ↔ Laufzeit-Umgebung. Die App spricht nur gegen diese Schnittstellen — welche Plattform sie erfüllt, ist Implementierungs-Frage. Macht die Hetzner→AWS-Migration bezahlbar.

2.1 Prinzipien
ENV-Konfiguration. Keine Plattform-Werte im Repo.
App ist zustandslos. Persistenter Zustand in der Datenbank.
TLS-Terminierung außerhalb der App.
JSON-Logs auf stdout, /healthz als Endpunkt.
2.2 Schnittstellen (Plattform → App)
Nr	Was	Garantien
Schnittstelle 1	PostgreSQL via Verbindungs-URL aus ENV	Konsistenz nach Commit; Row-Level-Security, JSON, Trigger, gängige Extensions; Plattform liefert Backups + Engine-Updates
Schnittstelle 2	OIDC-Identity-Provider via Discovery-URL aus ENV	PKCE-Flow, stabile Subject-ID, MFA konfigurierbar
Schnittstelle 3	Reverse-Proxy mit TLS-Terminierung	Terminiert TLS, leitet HTTP weiter, setzt X-Forwarded-*
Schnittstelle 4	Temporärer Schreibpfad aus ENV	Beschreibbar; min. Container-Lebensdauer; Faktor 3 der größten erwarteten VCF-Datei
2.3 App-Garantien
Garantie	Detail
HTTP-Server	Port aus ENV, default 3000, nur HTTP
/healthz	200 wenn Datenbank+Migration ok, 503 sonst, kein Login-Schutz
JSON-Logs auf stdout	Keine Datei-Logs
Migrationen beim Start	Schlägt fehl → Exit ≠ 0
ENV-Doku im Image-Label	Welche Variablen erwartet werden
SemVer-Tag pro Image	Plattform pinnt explizit
SIGTERM-Handler	Grace-Period 30 s
2.4 Out-of-Scope
Backups · Netzwerk-Zugang · Monitoring · Host-Härtung · konkrete Werkzeug-Wahl · App-Mail · Object-Storage (kommt als v1.1 falls Bedarf entsteht; VCF-Daten leben in der Datenbank, Region-Files und Gene-Reference sind Datenbank-Blobs oder Build-Time-Assets).

2.5 Versionierung
SemVer. Major = Breaking, Minor = abwärtskompatible Erweiterung, Patch = Erläuterung. Vertrags-Änderung braucht ADR. Vertrag und Plan-Versionen sind unabhängig versioniert.

3. App-Strang (App-Phasen 1 bis 5)
Annahmen Repo-Stand April 2026: ~27 IPC-Domains, ~180 Channels. Eine StorageSession-Abstraktion für SQLite und Postgres existiert, hat aber zwei Compatibility-Escape-Hatches, die App-Phase 1 schließt. Domain-Logic-Splits sind zur Hälfte vorhanden; App-Phase 1 zieht die fehlenden nach. Worker laufen heute über Electron-utilityProcess; App-Phase 1 führt einen Worker-Adapter ein. better-sqlite3-multiple-ciphers ist nur in der Electron-Variante nötig; der Web-Build erzeugt einen Container ohne dieses native Modul.

App-Phase 1 — Web-Tauglichkeit
Werkzeug	Zweck
Vite Web-Build-Target	Container ohne Electron-Module
Fastify	HTTP-Backend, Port aus ENV, SIGTERM-Handler
Auth-Abstraktion (Argon2 als erste Implementation)	Schnittstelle 2; OIDC kommt in App-Phase 2 als zweite Implementation
Repository-Interface (StorageSession verfestigt)	Escape-Hatches geschlossen, Service-Klassen sprechen nur das Interface
Worker-Adapter	Electron-utilityProcess vs. Node-worker_threads hinter gemeinsamer Schnittstelle
I/O-Adapter	Native Dialoge (Electron) vs. Multipart-Upload + Download (Web)
Native-Module-Conditional-Build	better-sqlite3 nur im Electron-Pfad
PostgreSQL-Anbindung	Schnittstelle 1; user_id-Spalten mit Default 1 als Vorbereitung für App-Phase 2
Pino · /healthz · Migrations-Tool (dbmate o. ä.)	App-Garantien aus dem Vertrag
Gate App-Phase 1: Web-Container startet ohne Electron; Migrationen laufen; /healthz liefert 200/503 korrekt; Argon2-Login funktioniert im Browser; Service-Klassen greifen ausschließlich über das Repository-Interface zu; die Electron-Variante baut weiter; Logs als JSON auf stdout; SIGTERM beendet ohne Daten- oder Request-Verlust; ADR-1, ADR-2, ADR-3 sind im Repository abgelegt.

App-Phase 2 — Mehrnutzer und OIDC
oidc-client-ts (PKCE-Flow gegen OIDC_ISSUER) · Vue Router Guards · Pinia Token-Handling im Browser-Memory · Postgres-Row-Level-Security aktivieren · Audit-Log-Einträge für Login und Logout.

Gate App-Phase 2: PKCE-Flow gegen den konfigurierten Provider funktioniert; welcher Provider verwendet wird, ist konfigurations-, nicht code-abhängig; Router-Guards greifen; Row-Level-Security ist aktiv; Login- und Logout-Events erscheinen im Audit-Log mit Aktor, Zeitpunkt, IP. Sync-Punkt: der produktive Abschluss hängt am Webzugriffe-Logbuch (siehe ADR-5).

App-Phase 3 — DSGVO-Endpunkte und Re-Authentifizierung
Admin-Endpunkt für Daten-Export (DSGVO Art. 15) · Admin-Endpunkt für Löschung (DSGVO Art. 17) · Re-Authentifizierung bei sensitiven Aktionen · Session-Timeout · Audit-Action-Types data_export und data_delete.

Gate App-Phase 3: Export-Archiv ist verifizierbar; Löschung führt vollständige Löschung mit Audit-Eintrag aus; Re-Authentifizierung wird vor Export, Löschung und Berechtigungsänderung verlangt; Session-Timeout greift nach konfigurierbarer Inaktivitätsdauer.

App-Phase 4 — Audit-Tauglichkeit
Append-Only-Constraints auf der Audit-Tabelle · separate Datenbank-Rolle nur mit INSERT-Recht auf die Audit-Tabelle · erweiterte Audit-Action-Types · pre_state, post_state, ip, user_agent im Audit-Schema · MIME-Sniffing für Datei-Uploads.

Gate App-Phase 4: UPDATE und DELETE auf der Audit-Tabelle scheitern mit Datenbank-Fehler, auch durch privilegierte Rollen; Audit-Inserts laufen ausschließlich über die separate Rolle; Action-Types decken alle in App-Phase 3 und 4 eingeführten sensiblen Aktionen ab; Audit-Einträge enthalten Pre- und Post-State sowie IP und User-Agent; Datei-Uploads mit manipulierter Endung werden erkannt.

App-Phase 5 — Release-Reife
API-Versionierung unter /api/v1/ · Playwright-End-to-End-Tests gegen den Web-Build.

Gate App-Phase 5: alle Web-Aufrufe nutzen den versionierten Pfad; Playwright-End-to-End-Tests gegen die Web-Variante laufen in CI grün.

4. Infra-Strang (Infra-Phasen 1 bis 5 plus Migrations-Block)
Hetzner ist Brücken-Plattform — Infra-Phasen 1 und 2 halten das Investment minimal, bis die AWS-Sovereign-Cloud-Zugänge da sind. Der Migrations-Block (§4.3) wechselt die Plattform. Infra-Phasen 3 bis 5 sind plattform-agnostisch als Capabilities formuliert (AWS-Default).

4.1 Vertrags-Mapping (Soll)
Schnittstelle	Hetzner-Brücke	AWS Sovereign Cloud (validiert beim Migrations-Block)
Schnittstelle 1: PostgreSQL	Container im Compose-Stack, Volume mit LUKS2 verschlüsselt	Managed PostgreSQL (RDS o. ä.) mit KMS-Verschlüsselung
Schnittstelle 2: OIDC	Folgt der Webzugriffe-Logbuch-Entscheidung; lokaler Stub als Übergang zulässig	Folgt derselben Logbuch-Entscheidung
Schnittstelle 3: Reverse-Proxy	Caddy; bei zentralem Reverse-Proxy des Stakeholders nur interner Service-Proxy dahinter	Cloud-Load-Balancer mit Cloud-Cert-Manager, oder Caddy weiterhin als interner Proxy
Schnittstelle 4: Temp-Pfad	Volume-Mount auf der VM	Cloud-Block-Storage oder ephemerer Container-Speicher
4.2 Phasen
Infra-Phase 1 — Hetzner-Brücke, Grundbetrieb
OpenTofu modular geschnitten in compute/network/storage/secrets · hcloud-Provider · cloud-init · Ubuntu LTS · Docker Engine + Docker Compose v2 · Caddy · PostgreSQL mit angepasstem Tuning · restic gegen ein S3-API-Ziel · LUKS2 auf dem Daten-Volume · Hetzner Cloud Firewall · key-only SSH · unattended-upgrades · Backup-Heartbeat · GitHub Actions + GitHub Container Registry + Trivy.

Bewusst nicht in Infra-Phase 1: auditd, fail2ban, UFW, Off-Host-Logging, Object-Lock-Backups. Die LUKS-Schlüssel-Strategie und die Verfügbarkeit von Object Lock auf dem gewählten Hetzner-Storage-Produkt sind vor Phase-Start zu klären.

Gate Infra-Phase 1: tofu apply ist idempotent; LUKS-Volume eingebunden; Compose-Stack startet alle Services; HTTPS-Aufruf der App-Domain erreicht den App-Container über Caddy; restic-Backup läuft täglich, Heartbeat überwacht Erfolg; mindestens eine Restore-Übung mit Test-Daten ist protokolliert; Trivy-Scan in CI verhindert das Pushen von Images mit kritischen CVEs; ADR-6 und ADR-7 sind im Repository abgelegt.

Infra-Phase 2 — Identity, Monitoring, Staging
OIDC nach Logbuch (Föderation gegen das zentrale Identity-System des Stakeholders, oder lokaler Übergangs-Stub) · leichtgewichtiges Single-Host-Monitoring (z. B. Netdata) · Image-Update-Beobachter (z. B. Diun; Update-Anwendung bleibt manuell) · innen-fähiger Uptime-Check · Staging-Umgebung mit anonymisierten oder synthetischen Daten · OpenTofu-Linter und Validator in CI · SOPS + age mit mehreren Recipients.

Gate Infra-Phase 2: OIDC-Login funktioniert; MFA ist nach Logbuch-Vorgabe konfiguriert; Monitoring liefert Live-Metriken und Mail-Alerts; Image-Update-Beobachter benachrichtigt bei simulierter Update-Verfügbarkeit; Staging-Umgebung steht; alle Secrets im Repo SOPS-verschlüsselt, CI verhindert Klartext-Commits; ADR-5 als Logbuch-Verweis dokumentiert.

4.3 Migrations-Block — Hetzner zu AWS Sovereign Cloud
Trigger. Wird ausgelöst, sobald die AWS-Sovereign-Cloud-Zugänge verfügbar sind. Realistisches Zeitfenster: Quartal+. Verfügbarkeits-getrieben, nicht termin-getrieben (siehe ADR-12).

Schritte:

Vorbereitung: AWS-Account, Region-Service-Verfügbarkeits-Check, KMS-Strategie. DNS-TTL spätestens hier auf 60 s senken.
AWS-Module schreiben und auf separater AWS-Staging-Umgebung testen.
App auf AWS-Staging deployen, End-to-End-Tests durch.
Daten-Migration probehalber: pg_dump --no-owner --no-privileges aus Hetzner, Restore in den AWS-Postgres-Service. Erforderliche Postgres-Extensions vorab in der Parameter-Group freischalten. Row-Level-Security-Policies und Audit-Trigger nach Restore neu binden.
Read-Only-Fenster auf Hetzner schalten, finalen Daten-Sync, AWS produktiv schalten, DNS-Switch.
Hetzner-Umgebung bleibt mindestens 14 Tage parallel als Rollback-Reserve, dann protokollierter Abbau.
Was sich ändert: OpenTofu-Module · Cloud-Provider · Backup-Ziel mit Object Lock · Cloud-Firewall → Security Groups · LUKS → cloud-seitige Block-Storage-Encryption mit KMS · TLS-Topologie nach Logbuch · IaC-State-Backend mit S3-nativem Locking (kein DynamoDB).

Was sich nicht ändert: App-Container-Image · App-Code · Compose-File-Struktur (nur ENV-Werte ändern sich) · OIDC-Discovery-Flow in der App · Repository-Interface zwischen SQLite und Postgres.

Rollback: nur möglich, solange das Read-Only-Fenster eingehalten wurde und auf AWS keine schreibenden Operationen stattgefunden haben — sonst ist es ein Daten-Merge-Problem, kein DNS-Schritt.

Gate Migrations-Block: App läuft auf AWS Sovereign Cloud, alle Vertrag-Schnittstellen erfüllt; DNS-Switch vollzogen; Restore-Übung auf AWS durchgeführt und protokolliert; Migrations-Protokoll in der Doku; Hetzner-Umgebung ≥ 14 Tage als Rollback-Reserve.

Infra-Phase 3 — Produktionsreife (Capability)
Backups Append-Only: Schreib- und Prune-Identität sind getrennt.
Object Lock im Compliance-Mode (30–90 Tage). Muss bei Bucket-Erstellung aktiviert werden — nachträglich nicht möglich.
Netzwerk-Zugang final nach ADR-5.
TLS passt zum Netzwerk-Modell.
IaC-State liegt remote, S3-natives Locking.
Restore-Drill mit produktionsähnlichem Datenvolumen, RTO und RPO dokumentiert.
Infra-Phase 4 — System-Härtung und Off-Host-Logging (Capability)
Host-Audit (auditd auf Container-Hosts plus CloudTrail auf AWS) · Brute-Force-Schutz (WAF/GuardDuty wenn in der Sovereign-Region verfügbar, sonst fail2ban auf den Hosts) · Off-Host-Logs mit Schreib-, ohne Lösch-Recht · SBOM (syft) und license-checker.

Infra-Phase 5 — Lieferketten-Sicherung
cosign keyless via GitHub-Actions-OIDC · SLSA-Provenance · Base-Image-Pinning per Hash-Digest · Self-Hosting-Doku in docs/.

5. Doku-Strang (Doku-Phasen 1 bis 5)
Kein DSGVO-Theater: DSFA, AVV, TOM, Pseudonymisierung, MDR-Klärung sind Stakeholder-Routine, kein Plan-Inhalt. AWS Sovereign Cloud löst Souveränitäts-Fragen designtechnisch. Pentest und externe Audits sind nicht Plan-Inhalt — falls beauftragt, würde technische Zuarbeit auf Abfrage entstehen.

Phase	Artefakte	Gate
Doku-Phase 1	README · Deploy-Anleitung · ADR-Sammlung (adr/) · Runbook v1 (Update/Restore/Rollback) · Restore-Test-Protokoll (Test-Daten) · MDR-Disclaimer	Alle 6 im Repo; Deploy-Anleitung erlaubt Infra-Phase-1-Aufbau ohne Rückfragen
Doku-Phase 2	IdP-Setup-Doku · Staging-Workflow · SemVer-Schema · Selbstbindung “keine Echt-Daten auf Hetzner-Brücke”	IdP-Setup für Staging reproduzierbar; SemVer im Release-Flow; Selbstbindung im Repo
Doku-Phase 3	Bedrohungsmodell · Netzwerk-Konzept (Ergebnis ADR-5) · Restore-Drill-Protokoll (produktionsähnlich) · Migrations-Protokoll · Cloud-Portabilitäts-Doku · Datenfluss-Beschreibung (auf Abfrage)	Bedrohungsmodell im Repo; Netzwerk-Konzept Logbuch-konform; Restore-Drill mit RTO/RPO; Migrations-Protokoll vollständig
Doku-Phase 4	SECURITY.md · Audit-Trail-Konzept (technisch)	SECURITY.md mit CVE-Meldepfad; Audit-Trail-Konzept im Repo
Doku-Phase 5	Supported-Version-Policy · CVE-Advisory-Prozess · Self-Hosting-Doku · Go-Live-Selbst-Checkliste	Policies veröffentlicht; CVE-Prozess eingerichtet; Self-Hosting-Doku inkl. Adoptions-Aufwands-Hinweis
6. Iterations-Mapping
Iteration	Phasen	Gate (binär abprüfbar)	Plattform
Iteration 1 (initialer Auftrag)	App-Phasen 1+2, Infra-Phasen 1+2, Doku-Phasen 1+2	Pilot-Reife mit Fake-Daten	Hetzner-Brücke; ggf. schon AWS, falls der Migrations-Block früh kommt
Migrations-Block	(Übergang)	Plattform-Wechsel + Rollback-Reserve	Hetzner → AWS Sovereign Cloud
Iteration 2	App-Phasen 3+4, Infra-Phasen 3+4, Doku-Phasen 3+4	Audit-Tauglichkeit (technisch)	AWS Sovereign Cloud (Default)
Iteration 3	App-Phase 5, Infra-Phase 5, Doku-Phase 5	Release-Reife, Adopter-tauglich	AWS Sovereign Cloud
Sync-Punkte zwischen den Strängen
OIDC ↔ Logbuch (App-Phase 2 ↔ Infra-Phase 2 ↔ ADR-5): produktiver Abschluss hängt am Logbuch-Stand.
Pilot-Reife (App-Phasen 1+2 ↔ Infra-Phasen 1+2 ↔ Doku-Phasen 1+2): Iteration 1 ist erst fertig, wenn alle drei Stränge ihre Phasen 1+2 abgeschlossen haben.
Audit-Tauglichkeit (App-Phase 4 ↔ Infra-Phase 4 ↔ Doku-Phase 4): App-Audit (Datenbank-Append-Only) und System-Audit (Off-Host) ergänzen sich; das Audit-Trail-Konzept verbindet beides.
Release-Reife (App-Phase 5 ↔ Infra-Phase 5 ↔ Doku-Phase 5): API-Versionierung, Lieferketten-Sicherung und Self-Hosting-Doku müssen zusammen reif sein.
7. Leitplanken — Architektur-Entscheidungen (ADRs)
ADRs sind versionierte Entscheidungs-Dokumente. Immutable; ein neuer ADR ersetzt einen alten (status: superseded by ADR-X). Alle hier gelisteten ADRs sind accepted.

ADR-0 PostgreSQL als verbindliche Datenbank-Engine. Postgres-Anbindung ist im Upstream-Konsens gesetzt; die Storage-Abstraktion ist auf beide Backends ausgelegt. Die Web-Variante fordert Postgres-spezifische Features (Row-Level-Security, Append-Only-Trigger, JSON, ggf. pg_trgm); SQLite bleibt für die Electron-Variante über das Repository-Interface erhalten. Andere SQL-Engines sind nicht in v1.
ADR-1 Domain-Extraktion. Die IPC-Handler werden in Service-Klassen umstrukturiert; sowohl der Electron-Main-Prozess als auch der Fastify-Web-Server konsumieren dieselben Service-Klassen. Höherer einmaliger Refactor-Aufwand, dafür kein technischer Schulden-Aufbau.
ADR-2 Electron-Variante bleibt parallel pflegbar. Beide Build-Targets bleiben erhalten, gemeinsame Service-Klassen werden in beiden genutzt, ein verbindliches Repository-Interface zwischen SQLite und Postgres wird formalisiert. Höhere Test-Last, keine Spaltung des Projekts.
ADR-3 Single-User in App-Phase 1, Multi-User-Schema vorbereitet. Argon2-Login in App-Phase 1, user_id-Spalten mit Default 1 bereits im Schema. App-Phase 2 kann OIDC und Row-Level-Security einführen, ohne das Datenbank-Schema im Produktivsystem ändern zu müssen.
ADR-4 Audit-Log in der Anwendungs-Datenbank. Audit-Log lebt als Postgres-Tabelle in derselben Datenbank wie die Anwendungsdaten. Manipulationsschutz wird in App-Phase 4 durch Append-Only-Constraints und eine separate Datenbank-Rolle erreicht. System-Logs werden zusätzlich off-host versendet (siehe ADR-11).
ADR-5 Netzwerk-Zugang und Identity-Provider folgen dem Webzugriffe-Logbuch. VarLens trifft keine eigene Entscheidung; ein lokaler Übergangs-Stub ist zulässig, falls das Logbuch noch nicht entschieden hat. Welche Logbuch-Entscheidung blockiert was: zentrales Identity-System → produktiver Abschluss von App-Phase 2 und Infra-Phase 2; MFA-Schicht (zentral am Reverse-Proxy oder pro App im Identity-Provider) → produktiver Abschluss Infra-Phase 2; Reverse-Proxy-Topologie (zentral vs. dezentral) → TLS-Strategie in Infra-Phase 1, Endform in Infra-Phase 3; VPN-Pflicht für interne Webanwendungen → Netzwerk-Zugangs-Konfiguration in Infra-Phase 3.
ADR-6 OpenTofu-Module schneiden für Cloud-Portabilität. OpenTofu wird in Module zerlegt: compute/network/storage/secrets. Der Wurzel-Plan referenziert nur Modul-Ausgaben, keine Provider-Details. restic spricht S3-API; State-Backends sind S3-API-kompatibel. Hetzner→AWS-Migration ist damit ein Modul-Tausch, kein App-Refactor. Adoptierer mit Helm/Kubernetes ersetzen den OpenTofu-Strang durch ihren eigenen Mechanismus.
ADR-7 SOPS+age für Secrets. Werkzeug-agnostisch und MIT-kompatibel; mehrere age-Recipients für Schlüssel-Wechsel. Vermeidet Lock-In an cloud-spezifische Secret-Manager.
ADR-8 Backups als Capability. Infra-Phase 3 fordert “ransomware-resistente Backups” auf Capability-Ebene; die konkrete Implementierung folgt der aktiven Plattform.
ADR-9 IaC-State remote mit S3-nativem Locking. Keine separate Lock-Datenbank (kein DynamoDB) — moderne OpenTofu-Versionen unterstützen S3-native Conditional Writes.
ADR-10 MDR-Scope mit Erstbetreiber zu klären. Der Plan trifft keine Annahme über den MDR-Status. Default-Disclaimer im Repo: Forschung und Sekundär-Analyse. Klinischer Einsatz erfordert MDR-/IVDR-Klärung durch den Betreiber — Stakeholder-Sache.
ADR-11 Off-Host-System-Logging als Capability. Schützt gegen Spuren-Löschung durch Root-Angreifer; konkrete Werkzeug-Wahl ist plattform-abhängig.
ADR-12 Migrations-Block-Position abhängig von der Sovereign-Cloud-Verfügbarkeit. Ideal zwischen Infra-Phase 2 und Infra-Phase 3; früher (zwischen Infra-Phase 1 und 2) oder später (nach oder mit Infra-Phase 3) möglich. “Später” bedeutet Migration mit Echt-Daten und höherem Risiko.
8. Plattform-Portabilität — zwei Motivationen
Hetzner→AWS-Migration (Bestandteil des initialen Auftrags). Die AWS-Sovereign-Cloud-Zugänge sind zum Projektstart nicht verfügbar; Hetzner ist Brücke. Ohne Modul-Disziplin wäre die Migration ein App-Refactor statt ein Plattform-Tausch.
Adaptions-Tauglichkeit für andere Labore (MIT-Lizenz und Förderlogik). Andere Labore sollen das Projekt adaptieren können (Helm-Chart, AWS-Alternative, On-Premises). Der Plan macht das möglich, indem er Plattform-Annahmen aus dem App-Code heraushält. Den Adaptions-Aufwand trägt der jeweilige Adoptierer; der Plan liefert keine fertigen Module für fremde Plattformen.
9. Bedrohungsmodell (kompakt)
Bedrohung	Lebt am	Hauptmaßnahme
Web-Frontend-Übernahme (XSS, CSRF, Session-Fixation)	App	Standard-Web-Security, CSP, OIDC-PKCE, Re-Authentifizierung
Kompromittiertes Container-Image	Lieferkette	Trivy ab Infra-Phase 1, cosign + SLSA ab Infra-Phase 5, Digest-Pinning
Root auf VM/Host	System	Infra-Phase 4: Off-Host-Logging, key-only SSH, unattended-upgrades
App-Datenbank-Rolle kompromittiert	Datenbank	App-Phase 4: separate Audit-Rolle, Append-Only, Row-Level-Security
Secrets im Repo	Repo / CI	Infra-Phase 2: SOPS+age, CI verhindert Klartext-Commits
Insider-Missbrauch	App	App-Phase 4: Audit-Log mit Pre- und Post-State
Backup-Ransomware	Plattform	Infra-Phase 3: Append-Only-Identitäten, Object Lock
Plattform-Lock-In	Plattform	ADR-6 + ADR-7: Modul-Schnitt, S3-API, SOPS+age
Stiller Plan-Drift	Doku	Plan-Versionierung + Logbuch-Annex (§12)
10. Echt-Daten — außerhalb dieses Plans
AWS Sovereign Cloud + interner Stakeholder-Einsatz = Standard-Klinik-IT. Souveränität, Auftragsverarbeitungsvertrag-Pfad und §203-Verträglichkeit sind designtechnisch adressiert. Compliance-Doku (DSFA, TOM, Berechtigungs-/Löschkonzept) läuft über Stakeholder-Routine. Der Plan liefert technische Zuarbeit auf Abfrage, treibt aber den Compliance-Doku-Apparat nicht.

11. Glossar
Begriff	Bedeutung
ADR	Architecture Decision Record. Versionierte Entscheidungs-Dokumentation. Immutable; ein neuer ADR ersetzt einen alten (status: superseded by ADR-X).
age	Modernes File-Encryption-Tool. Schlüssel-Lieferant für SOPS.
ALB / ACM / WAF / GuardDuty / EBS / EFS / KMS / RDS	AWS-Services (Application Load Balancer, Certificate Manager, Web Application Firewall, Threat-Detection, Block-Storage, Filesystem, Key Management Service, Managed PostgreSQL).
Argon2	Passwort-Hash-Funktion. In App-Phase 1 für Single-User-Login.
Auftragsverarbeitungsvertrag (AVV)	Vertrag nach DSGVO Art. 28 zwischen Verantwortlichem und Auftragsverarbeiter.
B3S	Branchenspezifischer Sicherheitsstandard für die Gesundheitsversorgung.
Caddy	Reverse-Proxy mit automatischer TLS-Verwaltung. Erfüllt Schnittstelle 3 in der Hetzner-Variante.
cloud-init	Linux-First-Boot-Mechanismus, der eine YAML-Konfiguration abarbeitet.
cosign / Sigstore / SLSA	Lieferketten-Signatur-Stack für Container-Images.
Datenschutz-Folgenabschätzung (DSFA)	Pflichtdokument nach DSGVO Art. 35 bei hohen Risiken.
Fastify / Pino / Vue 3 / Vuetify 4 / Vite / Pinia / oidc-client-ts	Bestandteile des App-Stacks.
GitHub Container Registry (GHCR)	Container-Image-Registry mit SemVer-Tags.
Identity Provider (IdP)	OIDC-konforme Komponente zur Authentifizierung.
ISO 15189	Norm für Akkreditierung medizinischer Laboratorien.
KEMP	Hardware-Loadbalancer; im Webzugriffe-Logbuch des Stakeholders als Kandidat.
Logbuch	Stakeholder-internes Logbuch zur Zielarchitektur für Webzugriffe, MFA und VPN. Entscheidet ADR-5.
LUKS2	Linux Unified Key Setup, Block-Device-Verschlüsselung.
Medical Device Regulation (MDR)	EU-Verordnung 2017/745. Greift bei Software für die primäre Diagnostik.
MIT	Lizenz, die Adaption durch andere Labore erlaubt.
Netdata / Diun	Single-Host-Monitoring; Container-Image-Update-Watcher.
OpenID Connect (OIDC) / Proof Key for Code Exchange (PKCE)	Auth-Protokoll auf OAuth-2.0-Basis; sicherer Browser-Flow für Public Clients.
Recovery Point/Time Objective (RPO/RTO)	Maximaler tolerierbarer Daten-Verlust bzw. maximale Wiederanlauf-Zeit.
Row-Level-Security (RLS)	Postgres-Funktion, die Zeilen je nach Nutzer ausblendet.
Software Bill of Materials (SBOM) / syft	Auflistung aller Abhängigkeiten eines Builds; Generator.
SOPS	Per-Wert-Verschlüsselung für YAML/JSON, kombiniert mit age als Schlüssel-Lieferant.
Sovereign Cloud	Cloud-Region mit erweiterten Daten-Souveränitäts-Garantien (EU-only Operations, kein Zugriff durch außereuropäische Behörden ohne Rechtsgrundlage).
TOM	Technische und organisatorische Maßnahmen nach DSGVO Art. 32.
Trivy	CVE-Scanner für Container-Images.
Webzugriffe-Logbuch	Siehe Logbuch.
12. Pflege und Logbuch-Annex
Der Vertrag (§2) ist sehr stabil und SemVer-versioniert; Änderung braucht einen ADR.
Die Pläne (§3 bis §5) tragen eine Plan-Version im Header. Vorgänger-Versionen werden als Git-Tag im Repository aufbewahrt, nicht überschrieben.
Status, To-Dos und “wo stehen wir gerade” werden bewusst NICHT im Plan gepflegt. Status gehört in Issues oder den Stand-Block unten.
Pflege-Trigger pro Artefakt-Typ:

Artefakt-Typ	Trigger
ADRs	Bei Änderung der Entscheidung. Immutable; neuer ADR ersetzt alten.
README, Deploy-Anleitung, Runbook	Bei Verhaltens-Änderungen
Bedrohungsmodell, Netzwerk-Konzept	Bei Plattform- oder Logbuch-Änderung
Self-Hosting-Doku	Bei Vertrags- oder Plattform-Änderung
Restore-Test-Protokoll	Nach jedem Restore-Test, mindestens einmal vor dem Migrations-Block
Policies, CVE-Process	Selten
Vorlage Stand-Block:

### Stand YYYY-MM-DD
- Anlass: …
- Entschieden: …
- In Arbeit: …
- Offen / Abhängigkeiten: …
- Plan-Folge: (welche Sektion angepasst)
Stand 2026-04-27 — Plan v1
Anlass: Initialer Plan-Stand für die VarLens-Web-Portierung.
Offen / Abhängigkeiten:
Logbuch-Stand (blockiert produktiven Abschluss App-Phase 2 / Infra-Phase 2; siehe ADR-5).
LUKS-Schlüssel-Strategie auf Hetzner (vor cloud-init-Schreiben in Infra-Phase 1 zu klären).
Object-Lock-Verfügbarkeit beim gewählten Hetzner-Storage-Produkt.
AWS-Sovereign-Cloud-Service-Katalog (zu validieren beim Migrations-Block).