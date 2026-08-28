#!/usr/bin/env bash
# Throwaway-PostgreSQL harness for Phase 164's migrations + SQL gate.
#
# WHY THIS EXISTS. The red-team synthesis' highest-leverage finding (PROC-01)
# was that a 456-line migration and a 536-line gate were authored, committed,
# declared done and reviewed by three specialists with ZERO executions. This is
# the missing oracle. Run it before asking anyone to review a migration.
#
#   ./run.sh            apply both migrations + run the 101-arm gate
#
# ⛔ It never touches TEST or PROD. It initdb's a fresh cluster under
# scratch/, listens on 127.0.0.1 only, and is safe to delete at any time.
#
# ⚠️ WHAT IT DOES AND DOES NOT PROVE. 01-fixture-core.sql and
# 02-fixture-sanitize-tables.sql are STAND-INS: they carry only the columns the
# migrations' FKs, policies, RPCs and sanitize_user body actually name. The
# objects under test — strategy_shares, its trigger, its grants, its policies,
# both RPCs — are the REAL ones from the real migration files. So this proves
# the DDL applies, the self-verification blocks bite, and the gate's arms pass
# and can fail. It does NOT prove behaviour against the real schema's own RLS,
# constraints or triggers. That still belongs to the TEST hand-apply.
set -euo pipefail
cd "$(dirname "$0")"
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
export PATH="$PGBIN:$PATH"
REPO=$(git rev-parse --show-toplevel)
PGD=${PGD:-$(mktemp -d)/pg164}
PORT=${PORT:-55432}
psqlq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# ⛔ NEVER REUSE A CLUSTER WE DID NOT CREATE. 01-fixture-core.sql opens with
# DROP SCHEMA public CASCADE, so attaching to a port another agent is already
# using DESTROYS their database underneath them. Measured 2026-08-28: a reviewer
# lost an entire session this way and only noticed because sanitize_user
# vanished from pg_proc after it had already called it. Fail loud instead.
if pg_isready -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
  echo "ERROR: something is already listening on 127.0.0.1:$PORT." >&2
  echo "This harness would DROP SCHEMA public CASCADE on it. Refusing." >&2
  echo "Pick a free port and a private data dir:" >&2
  echo "  PORT=\$((55000 + RANDOM % 900)) PGD=\$(mktemp -d)/pg $0" >&2
  exit 2
fi
if true; then
  mkdir -p "$PGD"
  initdb -D "$PGD/data" -U postgres --auth=trust -E UTF8 >/dev/null
  # -k '' => TCP only. A unix socket under a scratch path blows the 103-byte limit.
  pg_ctl -D "$PGD/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k ''" -l "$PGD/pg.log" start >/dev/null
  sleep 2
  psqlq -q -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"
fi

psqlq -q -f 01-fixture-core.sql
psqlq -q -f 02-fixture-sanitize-tables.sql
psqlq -f "$REPO/supabase/migrations/20260827120000_strategy_shares_generation_model.sql"
psqlq -f "$REPO/supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql"
psqlq -f "$REPO/supabase/tests/test_strategy_shares_rls.sql"
