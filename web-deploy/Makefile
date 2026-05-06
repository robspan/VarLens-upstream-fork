SHELL := /bin/bash
TOFU_DIR := tofu/environments/pilot

# Path to the SSH private key. Can be overridden via environment:
#   make ssh SSH_KEY=~/.ssh/other-key
# Default is the varlens-tofu key created by the quickstart.
SSH_KEY ?= ~/.ssh/varlens-tofu

# Database selection. Default SQLite (no container, just a file) per
# task profile preference and §bewertung2. Postgres via:
#   make stack-up DB=postgres
DB ?= sqlite

# Derive Compose profiles from DB: postgres -> "postgres" profile active,
# sqlite -> no profile (no DB container).
ifeq ($(DB),postgres)
  COMPOSE_PROFILES_FLAG = COMPOSE_PROFILES=postgres
else
  COMPOSE_PROFILES_FLAG =
endif

# Helper macros for the Make targets that do not yet go through the CLI
# (stack-up/down/logs, ssh, smoke, restore-drill, setup-backup).
define HCLOUD_TOKEN
$(shell awk -F'"' '/^hcloud_token/ {print $$2}' $(TOFU_DIR)/terraform.tfvars 2>/dev/null)
endef

define IPV4
$(shell cd $(TOFU_DIR) && tofu output -raw ipv4 2>/dev/null)
endef

CLI := ./bin/varlens

.PHONY: help plan up down stop start status ssh ip logs deploy-stack stack-up stack-down stack-logs sops-edit sops-decrypt smoke lint restore-drill setup-backup setup-monitoring e2e e2e-keep install-hooks

help:
	@echo "VarLens-IaC - Concept Pilot control"
	@echo ""
	@echo "Provisioning (delegated to ./bin/varlens):"
	@echo "  make plan        Show what Tofu would change"
	@echo "  make up          Create or update server"
	@echo "  make down        Tear everything down (requires typing 'pilot' as confirmation)"
	@echo ""
	@echo "E2E test (separate Disposable environment, no risk to pilot):"
	@echo "  make e2e         Full-cycle up->stack->backup->smoke->drill->down"
	@echo "  make e2e-keep    Like make e2e, but leaves the environment standing at the end"
	@echo ""
	@echo "Server lifecycle (volume and IP are preserved):"
	@echo "  make stop        Power off server - saves server hours, volume still costs"
	@echo "  make start       Power on server"
	@echo "  make status      Show server status (running, stopped, etc.)"
	@echo ""
	@echo "Access:"
	@echo "  make ssh         SSH login as deploy user"
	@echo "  make ip          Show current IPv4"
	@echo "  make logs        Show cloud-init bootstrap log"
	@echo ""
	@echo "Compose stack (Caddy, Uptime Kuma, Dozzle, optional PostgreSQL):"
	@echo "  make deploy-stack            Copy compose/ files to the server"
	@echo "  make stack-up                Stack with SQLite (default)"
	@echo "  make stack-up DB=postgres    Stack with PostgreSQL container"
	@echo "  make stack-down              Stop the Compose stack"
	@echo "  make stack-logs              Show live logs of all containers"
	@echo ""
	@echo "Secrets (SOPS+age):"
	@echo "  make sops-edit FILE=secrets/<file>.yaml     Open encrypted file in editor"
	@echo "  make sops-decrypt FILE=secrets/<file>.yaml  Show plaintext (read-only)"
	@echo ""
	@echo "Backup + monitoring (one-time after first make stack-up):"
	@echo "  make setup-backup      S3 credentials + bucket + restic setup automatically"
	@echo "  make setup-monitoring  Kuma admin + push monitor + heartbeat URL automatically"
	@echo ""
	@echo "Validation and testing:"
	@echo "  make lint           Local: tofu fmt-check, tofu validate, shellcheck, Caddyfile validate"
	@echo "  make smoke          End-to-end smoke test against running server"
	@echo "  make restore-drill  Automated backup/restore drill with protocol"
	@echo ""
	@echo "Cost note:"
	@echo "  cpx32 server:   ~0.02 EUR/hour when running, 0 EUR when stopped"
	@echo "  50 GB volume:   ~2 EUR/month fixed, also when stopped"
	@echo "  IPv4 address:   ~0.60 EUR/month fixed"
	@echo "  Full savings only via 'make down' (full Teardown)"

# Provisioning and lifecycle targets delegate to the CLI wrapper.
# Destructive actions (down, stop) are guarded there by confirmation prompts.
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

# E2E test environment: separate Hetzner Resources, separate state,
# automatic cleanup at the end. Safe against accidentally hitting pilot.
e2e:
	$(CLI) e2e run --yes

e2e-keep:
	$(CLI) e2e run --yes --keep

status:
	$(CLI) pilot status

ssh:
	@if [ -z "$(call IPV4)" ]; then echo "No server present (Tofu state empty)."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4)

ip:
	@echo "$(call IPV4)"

logs:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'sudo tail -200 /var/log/cloud-init-output.log'

deploy-stack:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	rsync -avz --delete \
		-e "ssh -i $(SSH_KEY)" \
		compose/ \
		deploy@$(call IPV4):/mnt/data/app/

# TLS strategy resolution. Three modes (see compose/Caddyfile snippets):
#   default                            -> raw IP + Let's Encrypt shortlived (public CA, 7-day cert)
#   make stack-up DOMAIN=foo.de        -> domain + Let's Encrypt classic (90-day cert)
#   make stack-up TLS=internal         -> self-signed (no public CA, browser warning)
# All three renew automatically via Caddy; no host cron, no certbot.
ifneq ($(DOMAIN),)
  CADDY_HOST = $(DOMAIN)
  CADDY_TLS = tls-le-classic
else ifeq ($(TLS),internal)
  CADDY_HOST = $(call IPV4)
  CADDY_TLS = tls-internal
else
  CADDY_HOST = $(call IPV4)
  CADDY_TLS = tls-le-ip
endif

stack-up: deploy-stack
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	@echo "Database profile: $(DB)"
	@echo "TLS mode:         $(CADDY_TLS)  (host: $(CADDY_HOST))"
	@ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && \
		if [ ! -f .env ]; then \
			echo "Generating random PostgreSQL password for compose/.env"; \
			cp .env.example .env && \
			sed -i "s|REPLACE_WITH_GENERATED_PASSWORD|$$(openssl rand -base64 32 | tr -d /+= | head -c 32)|" .env; \
		fi && \
		sed -i "s|^SERVER_HOST=.*|SERVER_HOST=$(CADDY_HOST)|" .env && \
		sed -i "s|^CADDY_TLS_PROFILE=.*|CADDY_TLS_PROFILE=$(CADDY_TLS)|" .env && \
		$(COMPOSE_PROFILES_FLAG) docker compose pull && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d --force-recreate caddy && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d'

stack-down:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	# On down, always include all profiles so any running postgres container
	# is also stopped (compose ignores profile services on "up" when the
	# profile is not active, but "down" with the profile cleans them up).
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && COMPOSE_PROFILES=postgres docker compose down'

stack-logs:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && docker compose logs --tail=100 -f'

sops-edit:
	@if [ -z "$(FILE)" ]; then echo "Usage: make sops-edit FILE=secrets/<file>.yaml"; exit 1; fi
	SOPS_AGE_KEY_FILE=$$HOME/.config/sops/age/keys.txt sops $(FILE)

sops-decrypt:
	@if [ -z "$(FILE)" ]; then echo "Usage: make sops-decrypt FILE=secrets/<file>.yaml"; exit 1; fi
	SOPS_AGE_KEY_FILE=$$HOME/.config/sops/age/keys.txt sops -d $(FILE)

# Install the tracked pre-commit hook into .git/hooks. Idempotent.
# Run once per fresh clone. Versioned source: scripts/git-hooks/pre-commit.
install-hooks:
	@chmod +x scripts/git-hooks/pre-commit
	@if [ -e .git/hooks/pre-commit ] && [ ! -L .git/hooks/pre-commit ]; then \
		echo "Backing up existing .git/hooks/pre-commit -> .git/hooks/pre-commit.bak"; \
		mv .git/hooks/pre-commit .git/hooks/pre-commit.bak; \
	fi
	@ln -sfn ../../scripts/git-hooks/pre-commit .git/hooks/pre-commit
	@echo "Pre-commit hook installed: .git/hooks/pre-commit -> scripts/git-hooks/pre-commit"
	@echo "Bypass for emergency: git commit --no-verify"

lint:
	@echo "=== tofu fmt ===" && tofu -chdir=$(TOFU_DIR) fmt -check -recursive
	@echo "=== tofu validate ===" && tofu -chdir=$(TOFU_DIR) validate
	@echo "=== shellcheck ===" && shellcheck --severity=warning scripts/*.sh
	@echo "=== Caddyfile validate ===" && \
		if command -v docker >/dev/null 2>&1; then \
			docker run --rm -e SERVER_HOST=lint.example.invalid -e CADDY_TLS_PROFILE=tls-internal -v "$(PWD)/compose/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile; \
		elif [ -n "$(call IPV4)" ]; then \
			ssh -i $(SSH_KEY) deploy@$(call IPV4) 'docker exec caddy caddy validate --config /etc/caddy/Caddyfile' || \
				echo "  (Caddyfile validate via server: Caddy container must be running)"; \
		else \
			echo "  (Caddyfile validate skipped: no local Docker and no server available)"; \
		fi
	@echo "=== all linters green ==="

setup-backup:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	@SERVER_IP=$(call IPV4) SSH_KEY=$(SSH_KEY) HCLOUD_TOKEN=$(call HCLOUD_TOKEN) \
		./scripts/setup-backup.py $(SETUP_BACKUP_ARGS)

setup-monitoring:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	@IP=$(call IPV4) SSH_KEY=$(SSH_KEY) ./scripts/setup-monitoring.py

# Counterpart to `make down`: empties and deletes the restic backup bucket.
# Required because the bucket is not Tofu-managed (it lives in Hetzner Object
# Storage and is created via S3 API by setup-backup.py). Without this target,
# a "full reset" leaves a half-state where the bucket still holds snapshots
# encrypted with a password that may no longer exist on disk.
#
# Requires RESTIC_S3_ACCESS_KEY/SECRET in the environment.
destroy-bucket:
	@if [ -z "$(RESTIC_S3_ACCESS_KEY)" ] || [ -z "$(RESTIC_S3_SECRET_KEY)" ]; then \
		echo "Set RESTIC_S3_ACCESS_KEY and RESTIC_S3_SECRET_KEY in your shell first."; \
		exit 1; \
	fi
	@RESTIC_S3_ACCESS_KEY=$(RESTIC_S3_ACCESS_KEY) RESTIC_S3_SECRET_KEY=$(RESTIC_S3_SECRET_KEY) \
		BUCKET_NAME=$${BUCKET_NAME:-varlens-pilot-backup} \
		./scripts/teardown-bucket.py $(DESTROY_BUCKET_ARGS)
# Invocation to reuse existing configuration:
#   make setup-backup SETUP_BACKUP_ARGS=--reuse
# Invocation for greenfield reset (destroys snapshots in the bucket):
#   make setup-backup SETUP_BACKUP_ARGS=--force

restore-drill:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	IP=$(call IPV4) SSH_KEY=$(SSH_KEY) ./scripts/restore-drill.sh

smoke:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	@IP=$(call IPV4); \
	echo "=== Smoke tests against $$IP ==="; \
	check() { local label="$$1"; local expected="$$2"; local got="$$3"; \
		if [ "$$got" = "$$expected" ]; then echo "  ok   $$label  ($$got)"; \
		else echo "  FAIL $$label  expected $$expected, got $$got"; FAILED=1; fi; }; \
	FAILED=0; \
	check "SSH reachable"            "yes" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes -o ConnectTimeout=5 deploy@$$IP echo yes 2>/dev/null)"; \
	check "HTTP redirect to HTTPS"   "308" "$$(curl -s -o /dev/null -w '%{http_code}' http://$$IP/)"; \
	check "Welcome page 200"         "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/welcome)"; \
	check "Kuma root 302->/dashboard" "302" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/)"; \
	check "Kuma /dashboard 200"      "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/dashboard)"; \
	check "Kuma /manifest.json 200"  "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/manifest.json)"; \
	check "Old /monitor redirects"   "301" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/monitor/)"; \
	check "Logs without auth 401"    "401" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/logs/)"; \
	check "Logs with auth ok"        "200" "$$(curl -ks -o /dev/null -w '%{http_code}' -u <configured credentials> https://$$IP/logs/)"; \
	check "Direct port 3001 closed"  "000" "$$(curl --max-time 3 -s -o /dev/null -w '%{http_code}' http://$$IP:3001/ 2>/dev/null)"; \
	check "Direct port 8080 closed"  "000" "$$(curl --max-time 3 -s -o /dev/null -w '%{http_code}' http://$$IP:8080/ 2>/dev/null)"; \
	check "Compose stack: Caddy/Kuma/Dozzle running" "3"   "$$(ssh -i $(SSH_KEY) -o BatchMode=yes deploy@$$IP 'cd /mnt/data/app && docker compose ps --status running --services | grep -cE "^(caddy|uptime-kuma|dozzle)$$"' 2>/dev/null | tr -d ' ')"; \
	if [ $$FAILED -eq 1 ]; then echo "=== Smoke tests failed ==="; exit 1; \
	else echo "=== all smoke tests green ==="; fi
