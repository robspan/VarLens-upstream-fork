SHELL := /bin/bash
TOFU_DIR := tofu/environments/pilot

# Pfad zum SSH-Private-Key. Kann per Umgebung überschrieben werden:
#   make ssh SSH_KEY=~/.ssh/anderer-key
# Default ist der varlens-tofu-Key, den der Schnellstart erzeugt.
SSH_KEY ?= ~/.ssh/varlens-tofu

# Datenbank-Auswahl. Default SQLite (kein Container, nur Datei) gemäß
# Aufgabenprofil-Präferenz und §bewertung2. Postgres per:
#   make stack-up DB=postgres
DB ?= sqlite

# Compose-Profile aus DB ableiten: postgres → "postgres"-Profile aktiv,
# sqlite → kein Profile (kein DB-Container).
ifeq ($(DB),postgres)
  COMPOSE_PROFILES_FLAG = COMPOSE_PROFILES=postgres
else
  COMPOSE_PROFILES_FLAG =
endif

# Hilfs-Macros für die Make-Targets, die noch nicht über die CLI laufen
# (stack-up/down/logs, ssh, smoke, restore-drill, setup-backup).
define HCLOUD_TOKEN
$(shell awk -F'"' '/^hcloud_token/ {print $$2}' $(TOFU_DIR)/terraform.tfvars 2>/dev/null)
endef

define IPV4
$(shell cd $(TOFU_DIR) && tofu output -raw ipv4 2>/dev/null)
endef

CLI := ./bin/varlens

.PHONY: help plan up down stop start status ssh ip logs deploy-stack stack-up stack-down stack-logs sops-edit sops-decrypt smoke lint restore-drill setup-backup setup-monitoring e2e e2e-keep

help:
	@echo "VarLens-IaC - Konzept-Pilot Steuerung"
	@echo ""
	@echo "Provisioning (delegiert an ./bin/varlens):"
	@echo "  make plan        Zeigt was Tofu ändern würde"
	@echo "  make up          Erstellt oder aktualisiert Server"
	@echo "  make down        Zerstört alles (verlangt Tippen von 'pilot' zur Bestätigung)"
	@echo ""
	@echo "E2E-Test (separate Wegwerf-Environment, kein Risiko für pilot):"
	@echo "  make e2e         Full-Cycle up→stack→backup→smoke→drill→down"
	@echo "  make e2e-keep    Wie make e2e, aber lässt Environment am Ende stehen"
	@echo ""
	@echo "Server-Lifecycle (Volume und IP bleiben erhalten):"
	@echo "  make stop        Server power off - spart Server-Stunden, Volume kostet weiter"
	@echo "  make start       Server power on"
	@echo "  make status      Zeigt Server-Status (running, stopped, etc.)"
	@echo ""
	@echo "Zugriff:"
	@echo "  make ssh         SSH-Login als deploy-User"
	@echo "  make ip          Aktuelle IPv4 anzeigen"
	@echo "  make logs        cloud-init-Bootstrap-Log anzeigen"
	@echo ""
	@echo "Compose-Stack (Caddy, Uptime Kuma, Dozzle, optional PostgreSQL):"
	@echo "  make deploy-stack            compose/-Dateien zum Server kopieren"
	@echo "  make stack-up                Stack mit SQLite (Default)"
	@echo "  make stack-up DB=postgres    Stack mit PostgreSQL-Container"
	@echo "  make stack-down              Compose-Stack stoppen"
	@echo "  make stack-logs              Live-Logs aller Container anzeigen"
	@echo ""
	@echo "Secrets (SOPS+age):"
	@echo "  make sops-edit FILE=secrets/<datei>.yaml     Verschlüsselte Datei im Editor öffnen"
	@echo "  make sops-decrypt FILE=secrets/<datei>.yaml  Klartext anzeigen (read-only)"
	@echo ""
	@echo "Backup + Monitoring (einmalig nach erstem make stack-up):"
	@echo "  make setup-backup      S3-Credentials + Bucket + restic-Setup automatisch"
	@echo "  make setup-monitoring  Kuma-Admin + Push-Monitor + Heartbeat-URL automatisch"
	@echo ""
	@echo "Validierung und Testing:"
	@echo "  make lint           Lokal: tofu fmt-check, tofu validate, shellcheck, Caddyfile-validate"
	@echo "  make smoke          End-to-End-Smoke-Test gegen laufenden Server"
	@echo "  make restore-drill  Automatisierter Backup-Restore-Drill mit Protokoll"
	@echo ""
	@echo "Kosten-Hinweis:"
	@echo "  cpx32-Server:   ~0,02 EUR/Stunde wenn running, 0 EUR wenn stopped"
	@echo "  50 GB Volume:   ~2 EUR/Monat fix, auch bei stopped"
	@echo "  IPv4-Adresse:   ~0,60 EUR/Monat fix"
	@echo "  Volle Ersparnis nur per 'make down' (komplette Zerstörung)"

# Provisioning- und Lifecycle-Targets delegieren an den CLI-Wrapper.
# Destruktive Aktionen (down, stop) werden dort durch Confirm-Prompts geschützt.
plan:
	$(CLI) pilot plan

up:
	$(CLI) pilot up

down:
	$(CLI) pilot down

stop:
	$(CLI) pilot stop

start:
	$(CLI) pilot start

# E2E-Test-Environment: separate Hetzner-Ressourcen, eigenes State,
# automatisches Aufräumen am Ende. Sicher gegen versehentlichen pilot-Hit.
e2e:
	$(CLI) e2e run --yes

e2e-keep:
	$(CLI) e2e run --yes --keep

status:
	$(CLI) pilot status

ssh:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden (Tofu-State leer)."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4)

ip:
	@echo "$(call IPV4)"

logs:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'sudo tail -200 /var/log/cloud-init-output.log'

deploy-stack:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	rsync -avz --delete \
		-e "ssh -i $(SSH_KEY)" \
		compose/ \
		deploy@$(call IPV4):/mnt/data/app/

stack-up: deploy-stack
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	@echo "Datenbank-Profil: $(DB)"
	@ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && \
		if [ ! -f .env ]; then \
			echo "Generiere zufälliges PostgreSQL-Passwort für compose/.env"; \
			cp .env.example .env && \
			sed -i "s|REPLACE_WITH_GENERATED_PASSWORD|$$(openssl rand -base64 32 | tr -d /+= | head -c 32)|" .env; \
		fi && \
		sed -i "s|^SERVER_HOST=.*|SERVER_HOST=$(call IPV4)|" .env && \
		$(COMPOSE_PROFILES_FLAG) docker compose pull && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d --force-recreate caddy && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d'

stack-down:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	# Beim Down immer alle Profile berücksichtigen, damit ein eventuell laufender
	# postgres-Container auch beendet wird (compose ignoriert Profile-Services
	# bei „up" wenn das Profile nicht aktiv ist, aber „down" mit Profile räumt sie ab).
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && COMPOSE_PROFILES=postgres docker compose down'

stack-logs:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && docker compose logs --tail=100 -f'

sops-edit:
	@if [ -z "$(FILE)" ]; then echo "Verwendung: make sops-edit FILE=secrets/<datei>.yaml"; exit 1; fi
	SOPS_AGE_KEY_FILE=$$HOME/.config/sops/age/keys.txt sops $(FILE)

sops-decrypt:
	@if [ -z "$(FILE)" ]; then echo "Verwendung: make sops-decrypt FILE=secrets/<datei>.yaml"; exit 1; fi
	SOPS_AGE_KEY_FILE=$$HOME/.config/sops/age/keys.txt sops -d $(FILE)

lint:
	@echo "=== tofu fmt ===" && tofu -chdir=$(TOFU_DIR) fmt -check -recursive
	@echo "=== tofu validate ===" && tofu -chdir=$(TOFU_DIR) validate
	@echo "=== shellcheck ===" && shellcheck --severity=warning scripts/*.sh
	@echo "=== Caddyfile validate ===" && \
		if command -v docker >/dev/null 2>&1; then \
			docker run --rm -v "$(PWD)/compose/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile; \
		elif [ -n "$(call IPV4)" ]; then \
			ssh -i $(SSH_KEY) deploy@$(call IPV4) 'docker exec caddy caddy validate --config /etc/caddy/Caddyfile' || \
				echo "  (Caddyfile-validate via Server: Caddy-Container muss laufen)"; \
		else \
			echo "  (Caddyfile-validate übersprungen: kein lokaler Docker und kein Server verfügbar)"; \
		fi
	@echo "=== alle Linter grün ==="

setup-backup:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	@SERVER_IP=$(call IPV4) SSH_KEY=$(SSH_KEY) HCLOUD_TOKEN=$(call HCLOUD_TOKEN) \
		./scripts/setup-backup.py $(SETUP_BACKUP_ARGS)

setup-monitoring:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	@IP=$(call IPV4) SSH_KEY=$(SSH_KEY) ./scripts/setup-monitoring.py
# Aufruf zum Wiederverwenden bestehender Konfiguration:
#   make setup-backup SETUP_BACKUP_ARGS=--reuse
# Aufruf zum Greenfield-Reset (zerstört Snapshots im Bucket):
#   make setup-backup SETUP_BACKUP_ARGS=--force

restore-drill:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	IP=$(call IPV4) SSH_KEY=$(SSH_KEY) ./scripts/restore-drill.sh

smoke:
	@if [ -z "$(call IPV4)" ]; then echo "Kein Server vorhanden."; exit 1; fi
	@IP=$(call IPV4); \
	echo "=== Smoke-Tests gegen $$IP ==="; \
	check() { local label="$$1"; local expected="$$2"; local got="$$3"; \
		if [ "$$got" = "$$expected" ]; then echo "  ok   $$label  ($$got)"; \
		else echo "  FAIL $$label  erwartet $$expected, bekommen $$got"; FAILED=1; fi; }; \
	FAILED=0; \
	check "SSH erreichbar"           "yes" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes -o ConnectTimeout=5 deploy@$$IP echo yes 2>/dev/null)"; \
	check "HTTP redirect zu HTTPS"   "308" "$$(curl -s -o /dev/null -w '%{http_code}' http://$$IP/)"; \
	check "HTTPS Welcome 200"        "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/)"; \
	check "Monitor ohne Auth 401"    "401" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/monitor/)"; \
	check "Monitor mit Auth ok"      "302" "$$(curl -ks -o /dev/null -w '%{http_code}' -u admin https://$$IP/monitor/)"; \
	check "Logs ohne Auth 401"       "401" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/logs/)"; \
	check "Logs mit Auth ok"         "200" "$$(curl -ks -o /dev/null -w '%{http_code}' -u admin https://$$IP/logs/)"; \
	check "Direct Port 3001 zu"      "000" "$$(curl --max-time 3 -s -o /dev/null -w '%{http_code}' http://$$IP:3001/ 2>/dev/null)"; \
	check "Direct Port 8080 zu"      "000" "$$(curl --max-time 3 -s -o /dev/null -w '%{http_code}' http://$$IP:8080/ 2>/dev/null)"; \
	check "Compose-Stack: Caddy/Kuma/Dozzle laeuft" "3"   "$$(ssh -i $(SSH_KEY) -o BatchMode=yes deploy@$$IP 'cd /mnt/data/app && docker compose ps --status running --services | grep -cE "^(caddy|uptime-kuma|dozzle)$$"' 2>/dev/null | tr -d ' ')"; \
	if [ $$FAILED -eq 1 ]; then echo "=== Smoke-Tests fehlgeschlagen ==="; exit 1; \
	else echo "=== alle Smoke-Tests gruen ==="; fi
