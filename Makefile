# Developer shortcuts. Run `make` (or `make help`) to list them.

PID_FILE := .dev.pid
# Port of the local npm registry used by `make local-*` (your apps use 3000).
REGISTRY_PORT ?= 4873
LOG_FILE := .dev.log

.DEFAULT_GOAL := help
.PHONY: help install up down clean local-up local-publish local-down

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-14s %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

up: install ## Install, build, then keep rebuilding packages in the background on every change
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	  echo "Already running (pid $$(cat $(PID_FILE))). Logs: $(LOG_FILE)"; exit 0; \
	fi; \
	pnpm turbo run build --output-logs=errors-only || exit 1; \
	nohup pnpm turbo run dev --ui=stream > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
	echo "Watching packages in the background (pid $$(cat $(PID_FILE)))."; \
	echo "Logs: tail -f $(LOG_FILE)    Stop: make down"

down: ## Stop the background rebuild started by `make up`
	@if [ ! -f $(PID_FILE) ]; then echo "Not running."; exit 0; fi; \
	kill_tree() { for child in $$(pgrep -P $$1); do kill_tree $$child; done; kill $$1 2>/dev/null; }; \
	kill_tree $$(cat $(PID_FILE)); \
	rm -f $(PID_FILE); \
	echo "Stopped."

local-up: ## Start a local npm registry and publish sabit to it (test `npm create sabit`)
	@SABIT_REGISTRY_PORT=$(REGISTRY_PORT) scripts/local-registry.sh up
	@SABIT_REGISTRY_PORT=$(REGISTRY_PORT) scripts/local-registry.sh publish

local-publish: ## Rebuild and republish sabit to the local registry after changes
	@SABIT_REGISTRY_PORT=$(REGISTRY_PORT) scripts/local-registry.sh publish

local-down: ## Stop the local npm registry
	@SABIT_REGISTRY_PORT=$(REGISTRY_PORT) scripts/local-registry.sh down

clean: down ## Stop, then remove build output, node_modules and caches
	rm -rf node_modules .turbo coverage $(LOG_FILE) \
	  packages/*/node_modules packages/*/dist packages/*/.turbo packages/*/coverage \
	  packages/adapters/*/node_modules packages/adapters/*/dist packages/adapters/*/.turbo \
	  tests/*/node_modules tests/*/.turbo \
	  examples/*/node_modules apps/*/node_modules \
	  packages/cli/test/.tmp
	@find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
	@echo "Clean. Run 'make install' (or 'make up') to start again."
