.PHONY: help rebuild dev web-dev build preview lint lint-check test test-watch test-coverage typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build ci-checks ci-startup-smoke ci-package-linux ci-packaged-smoke-linux ci-actions docs docs-dev docs-preview docs-screenshots pg-up pg-down pg-logs pg-psql pg-reset build-web web-ci web-gate web-gate-static web-gate-integration web-gate-postgres web-gate-parity web-parity-e2e web-test-report web-data-gather web-data-prepare web-data-verify sync-upstream install-hooks pilot pilot-down pilot-status pilot-smoke pilot-ssh web-release-enable web-release

# Default target - show help
.DEFAULT_GOAL := help

CI_NODE_VERSION ?= $(shell tr -d '\n' < .nvmrc)
XVFB_RUN ?= $(shell if command -v xvfb-run >/dev/null 2>&1; then printf 'xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" '; fi)
WEB_DEV_PORT ?= 8787
WEB_DEV_SCHEMA ?= web_dev
WEB_DEV_RECOVERY_KEY_DIR ?= /tmp/varlens-web-dev
WEB_DEV_API_LATENCY_MS ?= 75
WEB_DEV_ADMIN_USERNAME ?= admin
WEB_DEV_ADMIN_PASSWORD ?= varlens-dev-password-2026

define ensure_ci_node
	@current_node="$$(node -v | sed 's/^v//')"; \
	if [ "$$current_node" != "$(CI_NODE_VERSION)" ]; then \
		echo "Node version mismatch: expected $(CI_NODE_VERSION) from .nvmrc, got $$current_node"; \
		echo "Switch Node versions locally before running this target."; \
		exit 1; \
	fi
endef

#---------------------------------------------------------------------------
# Mode toggle: desktop (default) / web (opt-in via VARLENS_WEB=1)
#
# Sets which projects vitest runs and whether `make dev` starts the web
# server. Direct targets (web-gate-static, etc.) still work standalone for
# web-only invocations.
#---------------------------------------------------------------------------

# Web mode is opt-in only. A populated web-deploy/.env is operator
# context for deploy commands, but it must not change the default
# desktop developer/test lane. Set VARLENS_WEB=1 explicitly when a
# target should extend itself with web checks.
VARLENS_WEB ?= 0

# Export so it propagates to sub-makes and child processes — the deploy
# CLI (web-deploy/bin/varlens) reads VARLENS_WEB from os.environ to gate
# itself, and make doesn't export variables by default.
export VARLENS_WEB

ifeq ($(VARLENS_WEB),1)
    VITEST_EXTRA_ARGS := -- --project web-gate
else
    VITEST_EXTRA_ARGS :=
endif

#---------------------------------------------------------------------------
# Help
#---------------------------------------------------------------------------

help: ## Show this help message
	@echo "VarLens - Available Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

#---------------------------------------------------------------------------
# Development
#---------------------------------------------------------------------------

rebuild: ## Rebuild native modules for Electron (fixes native module version mismatch)
	npm run rebuild:electron

rebuild-node: ## Rebuild native modules for Node.js (needed before running tests)
	npm run rebuild:node

ifeq ($(VARLENS_WEB),1)
dev: web-dev ## Start development server (set VARLENS_WEB=1 for web mode)
else
dev: rebuild ## Start development server (set VARLENS_WEB=1 for web mode)
	npm run dev
endif

web-dev: ## Start local Postgres-backed web mode at http://localhost:$(WEB_DEV_PORT)/
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	$(MAKE) pg-up
	VARLENS_WEB_BASE=/ npm run build:web
	@echo ""
	@echo "Starting VarLens web mode:"
	@echo "  URL:      http://localhost:$(WEB_DEV_PORT)/"
	@echo "  Health:   http://localhost:$(WEB_DEV_PORT)/healthz"
	@echo "  Postgres: .env.postgres.local"
	@echo "  Schema:   $(WEB_DEV_SCHEMA)"
	@echo "  Secrets:  $${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}"
	@echo "  API delay: $${VARLENS_WEB_API_LATENCY_MS:-$(WEB_DEV_API_LATENCY_MS)}ms"
	@echo "  Dev admin bootstrap (first run only): $(WEB_DEV_ADMIN_USERNAME) / $(WEB_DEV_ADMIN_PASSWORD)"
	@echo ""
	@set -a; . ./.env.postgres.local; set +a; \
		NODE_ENV=development \
		APP_PATH_PREFIX=/ \
		VARLENS_WEB_HOST="$${VARLENS_WEB_HOST:-127.0.0.1}" \
		VARLENS_WEB_PORT="$${VARLENS_WEB_PORT:-$(WEB_DEV_PORT)}" \
		VARLENS_WEB_API_LATENCY_MS="$${VARLENS_WEB_API_LATENCY_MS:-$(WEB_DEV_API_LATENCY_MS)}" \
		VARLENS_PG_SCHEMA="$(WEB_DEV_SCHEMA)" \
		VARLENS_RECOVERY_KEY_DIR="$${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}" \
		VARLENS_ADMIN_USERNAME="$${VARLENS_ADMIN_USERNAME:-$(WEB_DEV_ADMIN_USERNAME)}" \
		VARLENS_ADMIN_PASSWORD="$${VARLENS_ADMIN_PASSWORD:-$(WEB_DEV_ADMIN_PASSWORD)}" \
		node out/web/server.cjs

dev-postgres: ## Start development server with PostgreSQL backend enabled
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	@set -a; . ./.env.postgres.local; set +a; VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres $(MAKE) dev

preview: ## Preview production build locally
	npm run preview

#---------------------------------------------------------------------------
# Build
#---------------------------------------------------------------------------

build: ## Build for production
	npm run build

dist: ## Build and package for current platform (for releases)
	npm run dist

dist-linux: ## Build and package for Linux only
	npm run dist:linux

dist-mac: ## Build and package for macOS only
	npm run dist:mac

dist-win: ## Build and package for Windows only
	npm run dist:win

package: build ## Package app for all platforms (mac, win, linux)
	npx electron-builder --mac --win --linux

package-linux: build ## Package app for Linux only
	npx electron-builder --linux

package-mac: build ## Package app for macOS only
	npx electron-builder --mac

package-win: build ## Package app for Windows only
	npx electron-builder --win

#---------------------------------------------------------------------------
# Code Quality
#---------------------------------------------------------------------------

lint: ## Lint and auto-fix code
	npm run lint

lint-check: ## Check linting without auto-fix
	npm run lint:check

format: ## Format all files with Prettier
	npm run format

format-check: ## Check Prettier formatting without writing
	npm run format:check

typecheck: ## Run TypeScript type checking
	npm run typecheck

#---------------------------------------------------------------------------
# Testing
#---------------------------------------------------------------------------

test: ## Run tests once (set VARLENS_WEB=1 to include web-gate project)
	npm run test $(VITEST_EXTRA_ARGS)

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Run tests with coverage report
	npm run test:coverage

#---------------------------------------------------------------------------
# Phase 1 web-migration gate (see .planning/web/completed/testing/desktop-to-web-parity.md)
#---------------------------------------------------------------------------

build-web: ## Build the opt-in web server + browser bundle
	npm run build:web

web-gate-static: ## Run Layer 1 static gate tests (assumes Node ABI — run `make rebuild-node` first if needed)
	npx vitest run --project web-gate

web-gate-integration: ## Run Layer 2 web-only integration tests (skipped until out/web/ exists)
	npx vitest run --project web-gate tests/web-gate/integration

web-gate-postgres: build-web ## Run fail-loud Postgres-backed web integration tests (requires VARLENS_PG_URL)
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-gate-postgres. This is intentionally opt-in and never part of default desktop CI."; exit 2; fi
	npx vitest run --project web-gate tests/web-gate/integration

web-gate-parity: ## Run Layer 3 parity scenarios (opt-in; boots Electron, switches native ABI)
	@echo "=== web-gate-parity (opt-in; switches native module to Electron ABI) ==="
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-gate-parity. This validates desktop↔web parity against PostgreSQL."; exit 2; fi
	@if [ ! -f out/main/index.js ]; then echo "out/main/index.js missing — running 'make build' first"; npm run build; fi
	npm run rebuild:electron
	VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 npx vitest run --project web-gate-parity tests/web-gate/parity/data-manifest-parity.test.ts tests/web-gate/parity/ipc-fixture-parity.test.ts

web-parity-e2e: web-data-verify ## Run manifest-backed desktop↔web parity E2E (requires VARLENS_PG_URL)
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-parity-e2e. This is opt-in and never part of default desktop CI."; exit 2; fi
	@echo "=== web-parity-e2e (opt-in; switches native module to Electron ABI) ==="
	npm run rebuild:electron
	npm run build
	VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 npx vitest run --project web-gate-parity tests/web-gate/parity/data-manifest-parity.test.ts tests/web-gate/parity/ipc-fixture-parity.test.ts

web-test-report: ## Generate web test report artifacts (VARLENS_WEB=1 runs full parity; uses VARLENS_PG_URL or .env.postgres.local)
	node scripts/reports/run-web-test-report.mjs

web-gate: web-gate-static ## Run the Phase 1 gate fast tests (parity is opt-in via web-gate-parity)
	@echo "Static + integration done. Run 'make web-gate-parity' to validate the desktop↔web parity path (opt-in)."

web-ci: rebuild-node build-web web-gate-static web-gate-postgres ## Opt-in web readiness gate; requires VARLENS_PG_URL

#---------------------------------------------------------------------------
# Web parity data gathering (opt-in; see .planning/web/completed/data/)
#---------------------------------------------------------------------------

DATA_ARGS ?=

web-data-gather: ## Gather/verify public parity data sources into gitignored cache (use DATA_ARGS='--fixture ID --allow-large')
	node scripts/data-fixtures/download-fixtures.mjs $(DATA_ARGS)

web-data-prepare: web-data-gather ## Transform gathered data into VarLens-ready generated fixtures
	node scripts/data-fixtures/prepare-fixtures.mjs $(DATA_ARGS)

web-data-verify: web-data-prepare ## Verify generated parity fixtures and source contracts
	node scripts/data-fixtures/verify-fixtures.mjs $(DATA_ARGS)

#---------------------------------------------------------------------------
# CI / Full Checks
#---------------------------------------------------------------------------

ci: lint-check format-check typecheck rebuild-node test ## Run all CI checks (lint, format, typecheck, rebuild, test). Set VARLENS_WEB=1 to include web-gate.

ci-checks: ## Run the GitHub Actions "Checks (Ubuntu)" job under Node $(CI_NODE_VERSION)
	@echo "=== Checks (Ubuntu) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/6: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/6: Rebuilding native modules for Node.js..."
	npm run rebuild:node
	@echo ""
	@echo "Step 3/6: Running linter..."
	npm run lint:check
	@echo ""
	@echo "Step 4/6: Running Prettier format check..."
	npm run format:check
	@echo ""
	@echo "Step 5/6: Running type check..."
	npm run typecheck
	@echo ""
	@echo "Step 6/6: Running tests..."
	npm run test
	@echo ""
	@echo "=== Checks (Ubuntu) PASSED ==="

ci-startup-smoke: ## Run the GitHub Actions "Startup Smoke (Linux)" job under Node $(CI_NODE_VERSION)
	@echo "=== Startup Smoke (Linux) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/4: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/4: Rebuilding native modules for Electron..."
	npm run rebuild:electron
	@echo ""
	@echo "Step 3/4: Building Electron app..."
	npm run build
	@echo ""
	@echo "Step 4/4: Running startup smoke..."
	npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
	@echo ""
	@echo "=== Startup Smoke (Linux) PASSED ==="

ci-package-linux: ## Run the Linux package validation job under Node $(CI_NODE_VERSION)
	@echo "=== Package (ubuntu-latest) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/5: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/5: Rebuilding native modules for Electron..."
	npm run rebuild:electron
	@echo ""
	@echo "Step 3/5: Building Electron app..."
	npx electron-vite build
	@echo ""
	@echo "Step 4/5: Running startup smoke..."
	$(XVFB_RUN)npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
	@echo ""
	@echo "Step 5/5: Packaging Linux artifacts..."
	CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never
	@echo ""
	@echo "=== Package (ubuntu-latest) PASSED ==="

ci-packaged-smoke-linux: ## Run the packaged-binary smoke on Linux (requires a built Linux artifact in release/)
	@echo "=== Packaged Smoke (Linux) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/1: Running packaged smoke against release/linux-unpacked/varlens..."
	$(XVFB_RUN)npx playwright test tests/e2e/packaged-smoke.e2e.ts --workers=1
	@echo ""
	@echo "=== Packaged Smoke (Linux) PASSED ==="

ci-full: ci-actions ## Run the local GitHub Actions parity pipeline

ci-actions: ## Run the required local GitHub Actions parity pipeline under Node $(CI_NODE_VERSION)
	@echo "=== GitHub Actions parity pipeline using Node $(CI_NODE_VERSION) ==="
	$(MAKE) ci-checks
	$(MAKE) ci-startup-smoke
	$(MAKE) ci-package-linux
	$(MAKE) ci-packaged-smoke-linux
	@echo ""
	@echo "=== GitHub Actions parity pipeline PASSED ==="

ci-build: ci-actions ## Run the local GitHub Actions parity pipeline

all: ci build ## Run CI checks and build

#---------------------------------------------------------------------------
# Documentation
#---------------------------------------------------------------------------

docs: ## Build documentation site
	npm run docs:build

docs-dev: ## Start documentation dev server
	npm run docs:dev

docs-preview: ## Preview built documentation site
	npm run docs:preview

docs-screenshots: rebuild build ## Generate documentation screenshots from Electron app
	npm run docs:screenshots

#---------------------------------------------------------------------------
# PostgreSQL Development
#---------------------------------------------------------------------------

pg-up: ## Start local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local up -d

pg-down: ## Stop local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down

pg-logs: ## Tail local PostgreSQL dev container logs
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local logs -f postgres

pg-psql: ## Open psql in the local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local exec postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

pg-query-perf: build ## Import WGS fixture and run opt-in PostgreSQL WGS query perf benchmark
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	@set -a; . ./.env.postgres.local; set +a; VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
	@set -a; . ./.env.postgres.local; set +a; VARLENS_RUN_WGS_QUERY_PERF=1 VARLENS_PG_QUERY_EXPLAIN=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts

pg-seed-dev: ## Seed deterministic PostgreSQL dev workspace data
	node scripts/postgres/seed-dev-workspace.mjs

pg-hosted-smoke: ## Run hosted PostgreSQL workspace smoke E2E
	VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-hosted-workspace-smoke.e2e.ts --workers=1

pg-reset: ## Destroy local PostgreSQL dev container and volume
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down -v

#---------------------------------------------------------------------------
# Setup & Cleanup
#---------------------------------------------------------------------------

install: ## Install dependencies and rebuild native modules
	npm install

clean: ## Clean build artifacts
	rm -rf out dist release node_modules/.vite

clean-all: clean ## Clean everything including node_modules
	rm -rf node_modules

reinstall: clean-all install ## Clean and reinstall everything

#---------------------------------------------------------------------------
# Upstream sync (private fork → berntpopp/VarLens)
#---------------------------------------------------------------------------

sync-upstream: ## Fetch upstream and merge upstream/main into local main + VarLens-Web (ours wins on conflict)
	@if ! git remote get-url upstream >/dev/null 2>&1; then \
		echo "ERROR: 'upstream' remote not configured."; \
		echo "  Run: git remote add upstream https://github.com/berntpopp/VarLens.git"; \
		exit 1; \
	fi
	@current=$$(git symbolic-ref --short -q HEAD || echo ""); \
	if [ -z "$$current" ]; then \
		echo "ERROR: detached HEAD. Check out main or VarLens-Web first."; exit 1; \
	fi; \
	if [ "$$current" != "main" ] && [ "$$current" != "VarLens-Web" ]; then \
		echo "ERROR: refusing to sync from branch '$$current' (only main / VarLens-Web supported)."; \
		echo "  Check out the right branch first, or override deliberately by running the steps manually."; \
		exit 1; \
	fi
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "ERROR: working tree is dirty. Commit or stash before sync-upstream."; \
		exit 1; \
	fi
	@echo "==> Fetching upstream..."
	git fetch upstream
	@echo "==> Fast-forwarding main..."
	git checkout main
	git merge --ff-only upstream/main
	@echo "==> Merging main into VarLens-Web (ours wins on conflict)..."
	git checkout VarLens-Web
	git merge -X ours main
	@echo "==> Done. Review with 'git log --oneline main..HEAD' then push when ready."

#---------------------------------------------------------------------------
# Concept Pilot — one-shot Hetzner deployment.
# Delegates to web-deploy/ which carries the OpenTofu + Compose + monitoring
# stack. Operator workflow: edit web-deploy/tofu/environments/pilot/terraform.tfvars
# (Hetzner token + SSH pubkey), edit web-deploy/compose/.env (set VARLENS_*
# plus POSTGRES_PASSWORD if profile=postgres), then run `make pilot`.
#

# Web-mode gate for the pilot-* targets. The deploy CLI manages live
# Hetzner / restic / GHCR resources; treating it as available in
# desktop-default mode would let a typo fire a real cloud action.
# Operators have to opt in with VARLENS_WEB=1 — same toggle that
# extends `dev` / `test` / `ci` to include the web layer.
require_web_mode = @if [ "$(VARLENS_WEB)" != "1" ]; then printf '\033[31mvarlens deploy CLI requires VARLENS_WEB=1.\033[0m\nWeb mode is opt-in (see AGENTS.md > Mode toggle). Re-run as:\n    VARLENS_WEB=1 make $@\n' >&2; exit 2; fi

pilot: ## Concept Pilot one-shot: pre-flight, provision, stack-up, backup, monitoring, smoke (with live status)
	$(require_web_mode)
	@web-deploy/scripts/pilot.sh

pilot-down: ## Tear down the Concept Pilot Hetzner environment (banner + interactive confirmation)
	$(require_web_mode)
	@web-deploy/scripts/pilot-down.sh

pilot-status: ## Show Hetzner server status (running / stopped / absent)
	$(require_web_mode)
	$(MAKE) -C web-deploy status

pilot-smoke: ## Re-run the smoke probes against the running pilot
	$(require_web_mode)
	$(MAKE) -C web-deploy smoke

pilot-ssh: ## SSH into the pilot server as the deploy user
	$(require_web_mode)
	$(MAKE) -C web-deploy ssh

pilot-recover: ## Recover from latest restic snapshot onto a freshly-provisioned server
	$(require_web_mode)
	$(MAKE) -C web-deploy pilot-recover

pilot-restore-list: ## List restic snapshots in the configured bucket (read-only)
	$(require_web_mode)
	$(MAKE) -C web-deploy restore-list

web-release-enable: ## Configure GitHub repo secrets so release-web.yml can deploy on a published release
	$(require_web_mode)
	@web-deploy/scripts/enable-github-release.sh $(WEB_RELEASE_ENABLE_ARGS)

web-release: ## Cut and publish a versioned web release (usage: make web-release VERSION=web-v0.1.0 [NOTES_FROM=auto])
	$(require_web_mode)
	@if [ -z "$(VERSION)" ]; then \
		echo "Usage: make web-release VERSION=web-vX.Y.Z [NOTES_FROM=auto]"; \
		echo "  Web releases use the 'web-v' prefix to stay disjoint from the desktop"; \
		echo "  installer track ('vX.Y.Z' tags). release-web.yml only fires on 'web-v*' tags;"; \
		echo "  release.yml (desktop) only fires on bare 'v*' tags."; \
		exit 1; \
	fi
	@command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install: https://cli.github.com"; exit 1; }
	@if ! echo "$(VERSION)" | grep -qE '^web-v[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9._-]+)?$$'; then \
		echo "VERSION '$(VERSION)' is not a valid web release tag (expected web-vMAJOR.MINOR.PATCH[-suffix])"; \
		echo "Hint: desktop releases use bare 'vX.Y.Z' (handled by release.yml — separate workflow)."; \
		exit 1; \
	fi
	@# Sanity: don't ship a release whose commit isn't on origin yet.
	@# `gh release create --target VarLens-Web` resolves the target on
	@# the GitHub side, so an unpushed local HEAD would tag whatever
	@# commit origin currently points at — almost never what you wanted.
	@git fetch --quiet origin VarLens-Web 2>/dev/null || true
	@LOCAL=$$(git rev-parse VarLens-Web 2>/dev/null) ; \
	REMOTE=$$(git rev-parse origin/VarLens-Web 2>/dev/null) ; \
	if [ -n "$$LOCAL" ] && [ -n "$$REMOTE" ] && [ "$$LOCAL" != "$$REMOTE" ]; then \
		echo "ERROR: local VarLens-Web ($$LOCAL) is not in sync with origin/VarLens-Web ($$REMOTE)."; \
		echo "       Push first ('git push origin VarLens-Web') so the release tags the right commit."; \
		exit 1; \
	fi
	@echo "==> Cutting release $(VERSION) — release-web.yml will build, deploy, and smoke."
	@if [ "$(NOTES_FROM)" = "auto" ]; then NOTES_FLAG="--generate-notes"; else NOTES_FLAG=""; fi; \
	gh release create "$(VERSION)" --target VarLens-Web --title "$(VERSION)" $$NOTES_FLAG

install-hooks: ## Install repo git hooks into .git/hooks/ (currently: pre-commit)
	@mkdir -p .git/hooks
	@ln -sf ../../scripts/git-hooks/pre-commit .git/hooks/pre-commit
	@chmod +x scripts/git-hooks/pre-commit
	@rm -f .git/hooks/pre-push  # cleanup: hook moved from pre-push to pre-commit
	@echo "==> Installed: .git/hooks/pre-commit -> scripts/git-hooks/pre-commit"
	@echo "    Bypass for one commit: VARLENS_HOOK_SKIP=1 git commit ..."
