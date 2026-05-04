.PHONY: help rebuild dev build preview lint lint-check test test-watch test-coverage typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build ci-checks ci-startup-smoke ci-package-linux ci-packaged-smoke-linux ci-actions docs docs-dev docs-preview docs-screenshots pg-up pg-down pg-logs pg-psql pg-reset web-gate web-gate-static web-gate-integration web-gate-parity sync-upstream install-hooks

# Default target - show help
.DEFAULT_GOAL := help

CI_NODE_VERSION ?= $(shell tr -d '\n' < .nvmrc)
XVFB_RUN ?= $(shell if command -v xvfb-run >/dev/null 2>&1; then printf 'xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" '; fi)

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

VARLENS_WEB ?= 0

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

dev: rebuild ## Start development server with hot reload (set VARLENS_WEB=1 for web mode)
ifeq ($(VARLENS_WEB),1)
	@echo "Web dev mode is not yet implemented — no web build target exists."
	@echo "See .planning/web/testing/desktop-to-web-parity.md for status."
	@exit 1
else
	npm run dev
endif

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

test: ## Run tests once (set VARLENS_WEB=1 to also run web-gate static + integration)
	npm run test $(VITEST_EXTRA_ARGS)

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Run tests with coverage report
	npm run test:coverage

#---------------------------------------------------------------------------
# Phase 1 web-migration gate (see .planning/web/testing/desktop-to-web-parity.md)
#---------------------------------------------------------------------------

web-gate-static: ## Run Layer 1 static gate tests (assumes Node ABI — run `make rebuild-node` first if needed)
	npx vitest run --project web-gate

web-gate-integration: ## Run Layer 2 web-only integration tests (skipped until out/web/ exists)
	npx vitest run --project web-gate tests/web-gate/integration

web-gate-parity: ## Run Layer 3 parity scenarios (opt-in; boots Electron, switches native ABI)
	@echo "=== web-gate-parity (opt-in; switches native module to Electron ABI) ==="
	@if [ ! -f out/main/index.js ]; then echo "out/main/index.js missing — running 'make build' first"; npm run build; fi
	npm run rebuild:electron
	VARLENS_RUN_WEB_GATE_PARITY=1 npx vitest run --project web-gate-parity

web-gate: web-gate-static ## Run the Phase 1 gate fast tests (parity is opt-in via web-gate-parity)
	@echo "Static + integration done. Run 'make web-gate-parity' to validate the desktop↔web parity path (opt-in)."

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
	@echo "==> Fetching upstream..."
	git fetch upstream
	@echo "==> Fast-forwarding main..."
	git checkout main
	git merge --ff-only upstream/main
	@echo "==> Merging main into VarLens-Web (ours wins on conflict)..."
	git checkout VarLens-Web
	git merge -X ours main
	@echo "==> Done. Review with 'git log --oneline main..HEAD' then push when ready."

install-hooks: ## Install repo git hooks into .git/hooks/ (currently: pre-commit)
	@mkdir -p .git/hooks
	@ln -sf ../../scripts/git-hooks/pre-commit .git/hooks/pre-commit
	@chmod +x scripts/git-hooks/pre-commit
	@rm -f .git/hooks/pre-push  # cleanup: hook moved from pre-push to pre-commit
	@echo "==> Installed: .git/hooks/pre-commit -> scripts/git-hooks/pre-commit"
	@echo "    Bypass for one commit: VARLENS_HOOK_SKIP=1 git commit ..."
