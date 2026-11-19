#!/usr/bin/env bash
# Test sabit like a published package, using a local npm registry (Verdaccio).
#
#   scripts/local-registry.sh up        start the registry on http://localhost:4873
#   scripts/local-registry.sh publish   build and publish every sabit package to it
#   scripts/local-registry.sh down      stop the registry
#
# Then, from any folder:
#   npm_config_registry=http://localhost:4873 npm create sabit@latest
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local-registry"
PORT="${SABIT_REGISTRY_PORT:-4873}"
REGISTRY="http://localhost:$PORT"
VERDACCIO="verdaccio@7.1.1"
PACKAGES=(packages/router packages/schema packages/adapters/common packages/adapters/express packages/adapters/hono packages/adapters/fastify packages/adapters/nest packages/cli packages/create-sabit)

running() { curl -sf "$REGISTRY/-/ping" >/dev/null 2>&1; }

up() {
  if running; then
    echo "Local registry already running at $REGISTRY"
  else
    mkdir -p "$DATA"
    echo "Starting local registry at $REGISTRY ..."
    nohup npx --yes "$VERDACCIO" --config "$ROOT/scripts/local-registry/config.yaml" --listen "127.0.0.1:$PORT" \
      >"$DATA/verdaccio.log" 2>&1 &
    echo $! >"$DATA/verdaccio.pid"
    for _ in $(seq 1 60); do running && break; sleep 1; done
    running || { echo "Registry didn't start; see $DATA/verdaccio.log"; exit 1; }
  fi
  login
  echo "Local registry is up."
}

# Logs in as the local publishing user, creating it on first use, and keeps
# the token in a private npmrc used only for publishing.
login() {
  local body='{"name":"sabit","password":"sabit-local","email":"local@sabit.invalid"}'
  local url="$REGISTRY/-/user/org.couchdb.user:sabit"
  local token
  # Existing user: Verdaccio only logs in when the credentials are sent as auth.
  token=$(curl -s -u sabit:sabit-local -X PUT "$url" -H 'content-type: application/json' -d "$body" | read_token)
  # First run: create the user.
  [[ -n "$token" ]] || token=$(curl -s -X PUT "$url" -H 'content-type: application/json' -d "$body" | read_token)
  [[ -n "$token" ]] || { echo "Couldn't log in to the local registry at $REGISTRY"; exit 1; }
  printf '//localhost:%s/:_authToken=%s\n' "$PORT" "$token" >"$DATA/npmrc"
}

read_token() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.stdout.write(JSON.parse(s).token ?? ""); } catch {}
    });'
}

publish() {
  running || up
  [[ -f "$DATA/npmrc" ]] || login
  local version="0.0.0-local.$(date +%s)"
  echo "Building ..."
  (cd "$ROOT" && pnpm -s turbo run build --output-logs=errors-only)

  # Publish under a fresh version so npm/npx caches never serve a stale build.
  # package.json versions are restored afterwards, even on failure.
  restore() { for dir in "${PACKAGES[@]}"; do (cd "$ROOT/$dir" && npm pkg set version=0.0.0); done; }
  trap restore EXIT
  for dir in "${PACKAGES[@]}"; do (cd "$ROOT/$dir" && npm pkg set version="$version"); done
  for dir in "${PACKAGES[@]}"; do
    (cd "$ROOT/$dir" && NPM_CONFIG_USERCONFIG="$DATA/npmrc" \
      pnpm publish --registry "$REGISTRY" --no-git-checks --tag latest >/dev/null)
    echo "  published $(cd "$ROOT/$dir" && node -p 'require("./package.json").name')@$version"
  done
  restore
  trap - EXIT
  echo
  echo "Try it from any folder:"
  echo "  npm_config_registry=$REGISTRY npm create sabit@latest"
}

down() {
  if [[ -f "$DATA/verdaccio.pid" ]]; then
    local pid; pid=$(cat "$DATA/verdaccio.pid")
    kill_tree() { for child in $(pgrep -P "$1"); do kill_tree "$child"; done; kill "$1" 2>/dev/null || true; }
    kill_tree "$pid"
    rm -f "$DATA/verdaccio.pid"
    echo "Local registry stopped."
  else
    echo "Local registry isn't running."
  fi
}

case "${1:-}" in
  up) up ;;
  publish) publish ;;
  down) down ;;
  *) echo "usage: $0 up|publish|down"; exit 1 ;;
esac
