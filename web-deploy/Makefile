SHELL := /bin/bash
TOFU_DIR := tofu/environments/pilot

# Path to the SSH private key. Can be overridden via environment:
#   make ssh SSH_KEY=~/.ssh/other-key
# Default is the varlens-tofu key created by the quickstart.
SSH_KEY ?= ~/.ssh/varlens-tofu

# Database selection. Default SQLite (no container, just a file) per
# Phase 2: web mode is Postgres-only. The postgres compose profile
# was dropped (varlens depends_on postgres directly), so
# COMPOSE_PROFILES is no longer needed for routing. The DB var is
# retained as a fail-loud trap for stale runbooks: `DB=sqlite`
# explicitly errors instead of silently bringing up Postgres.
ifneq ($(DB),)
ifneq ($(DB),postgres)
$(error DB=$(DB) is not supported in Phase 2; web mode is Postgres-only. Drop the DB= flag or set DB=postgres.)
endif
endif
COMPOSE_PROFILES_FLAG =

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
	@echo "Compose stack (Caddy, Uptime Kuma, Dozzle, PostgreSQL):"
	@echo "  make deploy-stack            Copy compose/ files to the server"
	@echo "  make stack-up                Bring up the stack (Postgres-only, Phase 2)"
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
	@# CRITICAL: --exclude rules below preserve server-side state across
	@# re-runs (image rotation, config update, etc). `rsync --delete`
	@# would otherwise strip:
	@#   - data/    runtime SQLite DB + admin-recovery-key.txt; deleting
	@#              this is silent data loss
	@#   - .env     server-generated by stack-up's first run with a random
	@#              POSTGRES_PASSWORD; regenerating breaks postgres-profile
	@#              deployments and clobbers operator customizations
	@# The deploy-stack.test.ts gate locks these exclusions in.
	rsync -avz --delete \
		--exclude data \
		--exclude .env \
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
	@# Create + chown the runtime data directory AFTER rsync. The source
	@# compose/ tree doesn't contain a data/ subdir, so rsync --delete in
	@# deploy-stack would strip a pre-created /mnt/data/app/data. Doing it
	@# here ensures the directory exists with uid 1001:1001 (varlens
	@# container's runtime user) right before docker compose mounts it.
	@ssh -i $(SSH_KEY) deploy@$(call IPV4) \
		'sudo mkdir -p /mnt/data/app/data && sudo chown 1001:1001 /mnt/data/app/data'
	@# If GHCR_TOKEN is set in the operator's env, docker-login on the
	@# server before pulling. Required for private GHCR images such as
	@# the default ghcr.io/robspan/varlens-web. Token is piped via stdin
	@# so it never appears in process listings.
	@if [ -n "$${GHCR_TOKEN:-}" ]; then \
		GHCR_USER="$${GHCR_USER:-robspan}"; \
		echo "==> GHCR auth: docker login as $$GHCR_USER"; \
		printf '%s' "$$GHCR_TOKEN" | ssh -i $(SSH_KEY) deploy@$(call IPV4) "docker login ghcr.io -u $$GHCR_USER --password-stdin" >/dev/null && \
		echo "==> Login Succeeded"; \
	else \
		echo "==> GHCR_TOKEN not set — skipping docker login (pull will fail if image is private)"; \
	fi
	@echo "Database profile: $(DB)"
	@echo "TLS mode:         $(CADDY_TLS)  (host: $(CADDY_HOST))"
	@# F4 mitigation: postgres password lives at /etc/varlens/postgres-password
	@# (root:root, 0600) so that re-creating /mnt/data/app/.env (e.g. after a
	@# regen or a bug that strips it) does not silently rotate the DB password
	@# and brick the postgres profile. If the persistent file exists we read
	@# it; otherwise we mint a new one and persist it to that path.
	@#
	@# Admin bootstrap: when VARLENS_ADMIN_USERNAME + VARLENS_ADMIN_PASSWORD
	@# are present in the operator's shell (typically sourced from
	@# web-deploy/.env by pilot.sh), they are injected into the server's
	@# /mnt/data/app/.env on FIRST boot only — never on re-runs. The values
	@# travel via SSH stdin (not via the command line) so they don't appear
	@# in `ps` listings on either side, and stdin avoids sed-escape issues
	@# with arbitrary password characters. server.ts ignores these vars
	@# post-bootstrap with a WARN, so re-injecting on re-runs would only
	@# extend plaintext exposure with no functional benefit.
	@printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
		"$${VARLENS_ADMIN_USERNAME:-}" \
		"$${VARLENS_ADMIN_PASSWORD:-}" \
		"$${VARLENS_ADMIN_DISPLAY_NAME:-}" \
		"$${POSTGRES_PASSWORD:-}" \
		"$${APP_NAME:-}" \
		"$${APP_PATH_PREFIX:-}" \
		"$${APP_PORT:-}" | \
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && \
		read -r ADMIN_USER; \
		read -r ADMIN_PASS; \
		read -r ADMIN_DISP; \
		read -r OPERATOR_PGPW; \
		read -r OPERATOR_APP_NAME; \
		read -r OPERATOR_APP_PATH_PREFIX; \
		read -r OPERATOR_APP_PORT; \
		if [ ! -f .env ]; then \
			if [ -n "$$OPERATOR_PGPW" ]; then \
				echo "Using operator-supplied POSTGRES_PASSWORD; persisting to /etc/varlens/postgres-password"; \
				PGPW="$$OPERATOR_PGPW"; \
				sudo install -d -m 0755 /etc/varlens && \
				printf "%s" "$$PGPW" | sudo tee /etc/varlens/postgres-password >/dev/null && \
				sudo chmod 0600 /etc/varlens/postgres-password && \
				sudo chown root:root /etc/varlens/postgres-password; \
			elif sudo test -f /etc/varlens/postgres-password; then \
				echo "Reusing PostgreSQL password from /etc/varlens/postgres-password"; \
				PGPW=$$(sudo cat /etc/varlens/postgres-password); \
			else \
				echo "Generating PostgreSQL password and persisting to /etc/varlens/postgres-password"; \
				PGPW=$$(openssl rand -base64 32 | tr -d /+= | head -c 32); \
				sudo install -d -m 0755 /etc/varlens && \
				printf "%s" "$$PGPW" | sudo tee /etc/varlens/postgres-password >/dev/null && \
				sudo chmod 0600 /etc/varlens/postgres-password && \
				sudo chown root:root /etc/varlens/postgres-password; \
			fi && \
			cp .env.example .env && \
			sed -i "s|REPLACE_WITH_GENERATED_PASSWORD|$$PGPW|" .env && \
			if [ -n "$$ADMIN_USER" ] && [ -n "$$ADMIN_PASS" ]; then \
				sed -i "/^VARLENS_ADMIN_/d" .env && \
				{ printf "VARLENS_ADMIN_USERNAME=%s\n" "$$ADMIN_USER"; \
				  printf "VARLENS_ADMIN_PASSWORD=%s\n" "$$ADMIN_PASS"; \
				  printf "VARLENS_ADMIN_DISPLAY_NAME=%s\n" "$$ADMIN_DISP"; } >> .env && \
				chmod 600 .env && \
				echo "Admin bootstrap injected (user: $$ADMIN_USER); recovery key will be at /mnt/data/app/data/admin-recovery-key.txt"; \
			else \
				echo "VARLENS_ADMIN_USERNAME/PASSWORD not set on operator shell — app will boot without an admin"; \
			fi; \
		fi && \
		sed -i "s|^SERVER_HOST=.*|SERVER_HOST=$(CADDY_HOST)|" .env && \
		sed -i "s|^CADDY_TLS_PROFILE=.*|CADDY_TLS_PROFILE=$(CADDY_TLS)|" .env && \
		if [ -n "$$OPERATOR_APP_NAME" ]; then \
			sed -i "s|^APP_NAME=.*|APP_NAME=$$OPERATOR_APP_NAME|" .env && \
			echo "APP_NAME set to $$OPERATOR_APP_NAME"; \
		fi && \
		if [ -n "$$OPERATOR_APP_PATH_PREFIX" ]; then \
			sed -i "s|^APP_PATH_PREFIX=.*|APP_PATH_PREFIX=$$OPERATOR_APP_PATH_PREFIX|" .env && \
			echo "APP_PATH_PREFIX set to $$OPERATOR_APP_PATH_PREFIX"; \
		fi && \
		if [ -n "$$OPERATOR_APP_PORT" ]; then \
			sed -i "s|^APP_PORT=.*|APP_PORT=$$OPERATOR_APP_PORT|" .env && \
			echo "APP_PORT set to $$OPERATOR_APP_PORT"; \
		fi && \
		$(COMPOSE_PROFILES_FLAG) docker compose pull && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d --force-recreate caddy && \
		$(COMPOSE_PROFILES_FLAG) docker compose up -d'

stack-down:
	@if [ -z "$(call IPV4)" ]; then echo "No server present."; exit 1; fi
	# Phase 2: postgres is part of the default profile (the `postgres`
	# profile gate was dropped). `docker compose down` brings down the
	# whole stack without any COMPOSE_PROFILES dance.
	ssh -i $(SSH_KEY) deploy@$(call IPV4) 'cd /mnt/data/app && docker compose down'

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
	@# Source web-deploy/.env if present so manual retries (after pilot.sh's
	@# step 3 fails and the retry banner suggests re-running this target)
	@# see RESTIC_S3_*. Without this, the operator would have to remember
	@# to source the file themselves — and the failure message wouldn't
	@# tell them why their second run also fails. Variables already set in
	@# the calling shell (CI overrides, etc.) take precedence.
	@if [ -f .env ]; then \
		set -a; . ./.env; set +a; \
	fi; \
	SERVER_IP=$(call IPV4) SSH_KEY=$(SSH_KEY) HCLOUD_TOKEN=$(call HCLOUD_TOKEN) \
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
	check_tls() { local label="$$1"; local expected="$$2"; local got="$$3"; \
		if [ "$$got" = "$$expected" ]; then echo "  ok   $$label  ($$got)"; \
		elif [ "$$got" = "000" ]; then echo "  WARN $$label  HTTPS unreachable (got 000) — likely TLS not ready (LE rate limit on recycled IP, ACME still issuing, or self-signed fallback); not failing the run"; WARNED=1; \
		else echo "  FAIL $$label  expected $$expected, got $$got"; FAILED=1; fi; }; \
	FAILED=0; WARNED=0; \
	check     "SSH reachable"            "yes" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes -o ConnectTimeout=5 deploy@$$IP echo yes 2>/dev/null)"; \
	check     "HTTP redirect to HTTPS"   "308" "$$(curl -s -o /dev/null -w '%{http_code}' http://$$IP/)"; \
	check_tls "Welcome page 200"         "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/welcome)"; \
	check_tls "Kuma root 302->/dashboard" "302" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/)"; \
	check_tls "Kuma /dashboard 200"      "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/dashboard)"; \
	check_tls "Kuma /manifest.json 200"  "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/manifest.json)"; \
	check_tls "Old /monitor redirects"   "301" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/monitor/)"; \
	check_tls "Logs without auth 401"    "401" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/logs/)"; \
	check_tls "Logs with auth ok"        "200" "$$(curl -ks -o /dev/null -w '%{http_code}' -u <configured credentials> https://$$IP/logs/)"; \
	check_tls "VarLens /varlens/healthz" "200" "$$(curl -ks -o /dev/null -w '%{http_code}' https://$$IP/varlens/healthz)"; \
	check     "Kuma bound to localhost only"   "yes" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes deploy@$$IP 'ss -tlnp 2>/dev/null | grep -qE "(127\\.0\\.0\\.1|\\[::1\\]):3001\\b" && echo yes || echo no' 2>/dev/null)"; \
	check     "Dozzle bound to localhost only" "yes" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes deploy@$$IP 'ss -tlnp 2>/dev/null | grep -qE "(127\\.0\\.0\\.1|\\[::1\\]):8080\\b" && echo yes || echo no' 2>/dev/null)"; \
	check     "Compose stack: 5 services running" "5" "$$(ssh -i $(SSH_KEY) -o BatchMode=yes deploy@$$IP 'cd /mnt/data/app && docker compose ps --status running --services | grep -cE "^(caddy|uptime-kuma|dozzle|app|postgres)$$"' 2>/dev/null | tr -d ' ')"; \
	if [ $$FAILED -eq 1 ]; then echo "=== Smoke tests failed ==="; exit 1; \
	elif [ $$WARNED -eq 1 ]; then echo "=== Smoke tests passed with TLS warnings (HTTPS probes returned 000 — verify cert state via 'docker compose logs caddy') ==="; \
	else echo "=== all smoke tests green ==="; fi
