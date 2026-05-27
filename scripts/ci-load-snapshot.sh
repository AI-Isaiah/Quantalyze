#!/usr/bin/env bash
#
# F10 — stand up an ephemeral local Supabase and load the committed schema
# snapshot, so DB tests run against an isolated per-job stack instead of the
# shared remote test project (`qmnijlgmdhviwzwfyzlc`). Encodes the verified load
# recipe; see supabase/ci-snapshot/README.md for the rationale.
#
# Requires: supabase CLI, Docker. Uses host `psql` if present, else the stack's
# postgres container (so it runs both in CI and on dev machines without libpq).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
SNAP_DIR="supabase/ci-snapshot"

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; }

# --- 1. Staleness guard: snapshot must reflect the current migration tree -----
expected="$(cat "$SNAP_DIR/MIGRATIONS.sha256")"
actual="$( cd supabase/migrations && find . -name '*.sql' | LC_ALL=C sort | xargs cat | sha256 | awk '{print $1}' )"
if [ "$expected" != "$actual" ]; then
  echo "::error::CI schema snapshot is STALE — supabase/migrations/** changed since"
  echo "::error::$SNAP_DIR was generated (expected $expected, got $actual)."
  echo "::error::Regenerate: gh workflow run ci-db-snapshot.yml  (see $SNAP_DIR/README.md)"
  exit 1
fi
echo "Snapshot staleness guard OK ($actual)."

# --- 2. Bootstrap-only init: relocate migrations + seed so `supabase start` -----
#        brings up the base stack without replaying the (locally-unreplayable)
#        migration train. Restored on exit so the checkout is left pristine.
STASH="$(mktemp -d)"
mv supabase/migrations "$STASH/migrations"
mkdir -p supabase/migrations
[ -f supabase/seed.sql ] && mv supabase/seed.sql "$STASH/seed.sql" || true
restore() {
  rm -rf supabase/migrations
  mv "$STASH/migrations" supabase/migrations
  [ -f "$STASH/seed.sql" ] && mv "$STASH/seed.sql" supabase/seed.sql || true
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT

# --- 3. Start the base stack (auth/storage/postgrest/postgres) ----------------
supabase start

# --- 4. Resolve a psql invocation (host libpq, else the postgres container) ----
DB_URL="$(supabase status -o json | python3 -c 'import sys,json;print(json.load(sys.stdin)["DB_URL"])')"
if command -v psql >/dev/null 2>&1; then
  psql_file() { psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$1"; }
  psql_cmd()  { psql "$DB_URL" -v ON_ERROR_STOP=1 -c "$1"; }
else
  CID="supabase_db_$(grep -E '^[[:space:]]*project_id' supabase/config.toml | head -1 | sed -E 's/.*=[[:space:]]*"?([^"]+)"?.*/\1/')"
  psql_file() { docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$1"; }
  psql_cmd()  { docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1"; }
fi

# --- 5. Load snapshot in numeric order: 01 neutralize, 02 schema, 03 cron ------
for f in "$SNAP_DIR"/0*.sql; do
  echo "=== loading $(basename "$f") ==="
  psql_file "$f"
done

# --- 6. Reload PostgREST schema cache so REST/python tests see the schema ------
psql_cmd "NOTIFY pgrst, 'reload schema';"

echo "Ephemeral Supabase ready: snapshot loaded, PostgREST reloaded."
