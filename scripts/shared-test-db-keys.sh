#!/usr/bin/env bash
# scripts/shared-test-db-keys.sh
#
# The schema-apply-IN-FLIGHT FLAG for the shared TEST project
# ([164.8-PUSH-RACE-VAC08], Phase 164.9 plan 06, ROADMAP criteria 3 and 4).
#
# ── TWO KEYS, TWO DIFFERENT UNITS ──────────────────────────────────────────
#
#   1. THE MUTUAL-EXCLUSION KEY (unchanged, and NOT defined in this file).
#      Unit: *the shared TEST database*. Every DB-touching job takes it, and
#      contenders BLOCK on it. It is a working mechanism proven end to end by
#      .github/workflows/mutex-probe.yml.
#
#   2. THE SCHEMA-APPLY-IN-FLIGHT FLAG (defined below, and new).
#      Unit: *"a schema apply against this project is in flight"*.
#      ⛔ IT IS NOT A LOCK BETWEEN PEERS. NOTHING BLOCKS ON IT. It is HELD by
#      the two schema WRITERS (supabase-migrate.yml's `apply-test` and
#      test-restore-from-baseline.yml's `restore`) for the duration of their
#      apply, and READ — non-blockingly, from the lock catalogue — by the
#      readers in ci.yml. Calling it a lock would be a naming error that
#      invites someone to make a reader block on it; it is named as a flag
#      here, in the workflows and in docs/runbooks/shared-test-db-mutex.md.
#
# ⛔ THE ASYMMETRY IS DELIBERATE, NOT AN OVERSIGHT. Only the NEW key lives in
# this file. The mutual-exclusion key stays a literal at each of its existing
# call sites and NOT ONE of them is rewritten: it is correct today, its
# occurrence counts are pinned by this repo's own gates, and rewriting a
# working lock's call sites to gain a shared constant is risk taken for
# tidiness. A future phase may move it; this one does not, and says so rather
# than leaving the reader to wonder which key was forgotten.
#
# ⛔ GIVING THE WRITER ITS OWN LOCK INSTEAD WOULD HAVE BEEN THE WRONG FIX, and
# it is the tempting one. It would make the writer STOP excluding the readers,
# and Phase 164.8 Area 4 recorded a schema apply racing a running gate as the
# one collision that CORRUPTS a reading rather than merely delaying it. The
# writers keep taking the mutual-exclusion key exactly as before; this flag is
# purely additive.
#
# Usage:
#   . scripts/shared-test-db-keys.sh                   # source: constant + functions
#   bash scripts/shared-test-db-keys.sh --self-test    # prove the file's own claims
#
# ⚠️ Sourceable on purpose, so this file deliberately does NOT `set -euo
# pipefail` at the top level — that would silently change the shell options of
# every caller that sources it. The self-test sets them for itself.

# ── THE CONSTANT ───────────────────────────────────────────────────────────
# Unit: "a schema apply against this project is in flight". A FLAG, not a
# lock — nothing blocks on it, and a reader that finds it held waits on the
# Actions API, not on this key.
#
# The value is a 32-bit advisory key, distinct from the mutual-exclusion key
# and deliberately adjacent to it in the same visual family so a reader seeing
# one in a log recognises the other as related rather than unrelated noise.
# Chosen once here; ⛔ never restated as a literal anywhere else.
export SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY=61616146

# shared_test_db_inflight_acquire_sql — the statement a schema WRITER runs, in
# its own session, to announce that its apply is in flight.
#
# ⭐ `pg_try_advisory_lock`, NOT `pg_advisory_lock`, and that is load-bearing.
# An announcement must never be able to block the thing it announces: a stale
# holder of this key would otherwise wedge a schema apply behind a flag that
# exists only to inform readers. The caller inspects the returned marker and
# treats a BUSY answer as a warning, never as a failure.
shared_test_db_inflight_acquire_sql() {
  printf "%s" "SELECT CASE WHEN pg_try_advisory_lock(${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}) THEN 'INFLIGHT-FLAG-HELD' ELSE 'INFLIGHT-FLAG-BUSY' END;"
}

# shared_test_db_inflight_probe_sql — the READ-ONLY probe a reader runs to ask
# whether a schema apply is in flight right now. Answers with a single count.
#
# ⛔ IT MUST NEVER TRY TO TAKE THE LOCK TO FIND OUT. A `pg_try_advisory_lock`
# probe ACQUIRES the key whenever it is free — the exact opposite of a read —
# and would leave every reader holding the writers' flag. This queries the
# lock catalogue instead: `pg_advisory_lock(bigint)` on a value below 2^31
# registers as classid 0, objid <key>, objsubid 1, which is precisely the
# decomposition asserted here.
shared_test_db_inflight_probe_sql() {
  printf "%s" "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = ${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY} AND objsubid = 1 AND granted;"
}

# ── --self-test ────────────────────────────────────────────────────────────
# Proves the three claims this file makes about itself that a reader would
# otherwise have to take on trust. The closing line's check count is DERIVED
# from a counter, never restated, so a deleted check cannot pass silently.
shared_test_db_keys_self_test() {
  set -euo pipefail
  local checks=0 self sql n
  self="${BASH_SOURCE[0]}"

  # ⚠️ THE ONE OCCURRENCE OF THE MUTUAL-EXCLUSION KEY IN THIS FILE, and it is
  # a COMPARISON OPERAND, not a definition. Nothing sources it and nothing
  # emits it; it exists so the distinctness claim below is measured rather
  # than asserted. ⛔ Do not turn it into an exported constant — see the
  # asymmetry note in the header.
  local mutex_key=61616158

  # Check 1 — the constant is a single live assignment line.
  n=$(grep -acE '^(export )?SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY=[0-9]+$' "${self}" || true)
  checks=$((checks + 1))
  if [ "${n}" != "1" ]; then
    echo "SELF-TEST FAIL: expected exactly ONE '${0##*/}' assignment line for SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY, found ${n}. A constant that is defined twice is not a single source of truth." >&2
    exit 1
  fi

  # Check 2 — it differs from the mutual-exclusion key. A flag equal to the
  # lock would make every reader's probe report an apply in flight whenever
  # ANY job held the mutex, which is most of the time.
  checks=$((checks + 1))
  if [ "${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}" = "${mutex_key}" ]; then
    echo "SELF-TEST FAIL: the in-flight flag (${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}) equals the mutual-exclusion key. Two units, two keys — a shared value collapses them." >&2
    exit 1
  fi

  # Check 3 — it is a positive 32-bit value, so the classid/objid/objsubid
  # decomposition the probe asserts is the one Postgres actually registers.
  checks=$((checks + 1))
  case "${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}" in
    ''|*[!0-9]*)
      echo "SELF-TEST FAIL: the in-flight flag is not a bare non-negative integer (value: ${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY})." >&2
      exit 1
      ;;
  esac
  checks=$((checks + 1))
  if [ "${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}" -ge 2147483648 ] || [ "${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}" -le 0 ]; then
    echo "SELF-TEST FAIL: the in-flight flag (${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}) is outside the positive 32-bit range the probe's objid comparison assumes." >&2
    exit 1
  fi

  # Check 4 — the acquire statement names the constant.
  sql="$(shared_test_db_inflight_acquire_sql)"
  checks=$((checks + 1))
  case "${sql}" in
    *"${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}"*) : ;;
    *)
      echo "SELF-TEST FAIL: the acquire statement does not name the constant (${#sql} characters emitted)." >&2
      exit 1
      ;;
  esac

  # Check 5 — the PROBE is read-only. No data-modifying verb, and no
  # advisory-lock ACQUISITION verb: a probe that takes the lock to find out
  # whether it is taken is not a probe.
  sql="$(shared_test_db_inflight_probe_sql)"
  local verb
  for verb in INSERT UPDATE DELETE DROP ALTER TRUNCATE CREATE GRANT REVOKE pg_advisory_lock pg_try_advisory_lock pg_advisory_xact_lock; do
    checks=$((checks + 1))
    case "${sql}" in
      *"${verb}"*)
        echo "SELF-TEST FAIL: the read-only probe's generated SQL contains '${verb}'. The probe READS the lock catalogue; it must neither write nor acquire (${#sql} characters emitted)." >&2
        exit 1
        ;;
    esac
  done

  # Check 6 — the probe actually names the catalogue it claims to read, so a
  # future rewrite cannot quietly turn it into something that reads nothing.
  checks=$((checks + 1))
  case "${sql}" in
    *"pg_locks"*"${SHARED_TEST_SCHEMA_APPLY_INFLIGHT_KEY}"*) : ;;
    *)
      echo "SELF-TEST FAIL: the read-only probe does not query pg_locks for the constant (${#sql} characters emitted)." >&2
      exit 1
      ;;
  esac

  echo "shared-test-db-keys self-test OK (${checks} checks) — one flag constant, distinct from the mutual-exclusion key, with a read-only probe."
}

# Only act when EXECUTED. When SOURCED, defining the constant and the two
# functions is the whole job.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    --self-test) shared_test_db_keys_self_test ;;
    --acquire-sql) shared_test_db_inflight_acquire_sql; echo ;;
    --probe-sql) shared_test_db_inflight_probe_sql; echo ;;
    *)
      echo "ERROR: unknown argument: ${1:-} (usage: --self-test | --acquire-sql | --probe-sql, or source this file)" >&2
      exit 2
      ;;
  esac
fi
