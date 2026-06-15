#!/usr/bin/env bash
# Phase 16 / OBSERV-08 — local repro of the unified key flow against vcrpy cassettes.
#
# Replays 8 pre-recorded cassettes (OKX + Bybit × 4 scenarios each) with NO
# network access and asserts the unified flow passes deterministically. Binance
# was dropped 2026-05-27 — no production test keys are provisioned for the
# Binance test fixture, so the broker is out of scope until creds reappear.
#
# Includes a TWO-layer CI grep gate that fails if any secret leaked into the
# committed cassettes:
#   - Layer A: known DEBUG_KEY_FLOW_* env value match
#   - Layer B: high-entropy literal scan inside lines that name signing-key fields
#     (catches missed values from rotated test creds OR new secret formats not
#     in the known-env list)
#
# Usage:
#   bash scripts/repro-key-flow.sh                     # replay + leak gate (default)
#   bash scripts/repro-key-flow.sh --record            # record fresh cassettes
#                                                       from live brokers, then
#                                                       run the leak gate.
#                                                       Requires DEBUG_KEY_FLOW_*
#                                                       env vars set.
#   bash scripts/repro-key-flow.sh --record --allow-partial
#                                                       as --record, but a broker
#                                                       that fails to record (e.g.
#                                                       geo-block) is restored from
#                                                       git and skipped instead of
#                                                       aborting; reachable brokers
#                                                       still refresh. CI-only —
#                                                       local runs should stay strict.
#
# Exit codes:
#   0 — replay clean, no leaks
#   1 — replay failed OR a known DEBUG_KEY_FLOW_* env value found in cassettes
#       OR a high-entropy literal found in a signing-key-named field
#   2 — pre-flight failure (missing test files, vcrpy not installed)
#   3 — --record failed: missing creds, a broker call failed, OR (under
#       --allow-partial) a failed broker could not be safely restored from git
#
# Run daily during the Phase 19 stability window per Theme 5 mitigation. The
# .github/workflows/cassette-refresh.yml workflow invokes --record mode + opens
# an auto-PR if cassettes diverge from main.

set -euo pipefail

cd "$(dirname "$0")/.."

PREFIX="[repro-key-flow]"
log() { echo "$PREFIX $*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

# --- --record subcommand --------------------------------------------------
MODE="replay"
ALLOW_PARTIAL=0   # --allow-partial: a broker that fails to record (e.g. geo-block)
                  # is restored from git and skipped instead of aborting the whole
                  # run, so reachable brokers still refresh. Used by
                  # cassette-refresh.yml; OFF by default so local runs stay strict.
for arg in "$@"; do
  case "$arg" in
    --record) MODE="record" ;;
    --allow-partial) ALLOW_PARTIAL=1 ;;
    --help|-h)
      grep -E '^#( |$)' "$0" | sed 's/^# \?//' | head -40
      exit 0
      ;;
    *) fail "unknown arg: $arg (use --record, --allow-partial, or --help)" ;;
  esac
done

cd analytics-service

if [ "$MODE" = "record" ]; then
  # Pre-flight: which broker creds are available? Each broker is opt-in based on
  # env presence, so a partial credential set (e.g. OKX only) still records what
  # it can rather than aborting the whole run.
  log "recording mode — live broker calls"
  if [ ! -x .venv/bin/python ]; then
    fail "missing analytics-service/.venv/bin/python — bootstrap the venv first"
  fi
  recorded=0
  failed_brokers=""
  skipped_brokers=""   # creds absent — intentional locally, but a MISCONFIG in CI
                       # where every DEBUG_KEY_FLOW_* secret is expected. Tracked so a
                       # silently-dropped broker is surfaced (a skip ≠ a green run).
  for broker in okx bybit; do
    case "$broker" in
      okx)
        if [ -z "${DEBUG_KEY_FLOW_OKX_KEY:-}" ] \
          || [ -z "${DEBUG_KEY_FLOW_OKX_SECRET:-}" ] \
          || [ -z "${DEBUG_KEY_FLOW_OKX_PASSPHRASE:-}" ]; then
          log "skip $broker — DEBUG_KEY_FLOW_OKX_KEY/SECRET/PASSPHRASE not all set"
          skipped_brokers="${skipped_brokers:+$skipped_brokers,}$broker"
          continue
        fi
        ;;
      bybit)
        if [ -z "${DEBUG_KEY_FLOW_BYBIT_KEY:-}" ] \
          || [ -z "${DEBUG_KEY_FLOW_BYBIT_SECRET:-}" ]; then
          log "skip $broker — DEBUG_KEY_FLOW_BYBIT_KEY/SECRET not all set"
          skipped_brokers="${skipped_brokers:+$skipped_brokers,}$broker"
          continue
        fi
        ;;
    esac
    log "recording $broker (idempotent — happy/auth-fail re-used if present)"
    if .venv/bin/python scripts/record_cassettes.py "$broker"; then
      recorded=$((recorded + 1))
    elif [ "$ALLOW_PARTIAL" = "1" ]; then
      # Broker unreachable (geo-block / outage). The restore below is load-bearing,
      # not cosmetic: force_refresh may have deleted this broker's happy/auth-fail,
      # and a partial recording can leave a 4xx body in happy.yaml — either would
      # land a broken cassette in the auto-PR and break the replay suite. Restore
      # the whole broker dir from git so the diff (and any PR) covers ONLY the
      # brokers that recorded cleanly. If we cannot prove the dir is byte-identical
      # to HEAD afterward the on-disk state is untrusted, so hard-fail (exit 3)
      # rather than risk a corrupt cassette. Do NOT swallow the checkout error.
      log "WARN: record_cassettes.py failed for $broker — restoring its cassettes from git and continuing (--allow-partial)"
      if ! git checkout -- "tests/cassettes/$broker"; then
        log "FAIL: could not git-restore tests/cassettes/$broker after a failed record — refusing to continue with possibly-corrupt cassettes"
        exit 3
      fi
      # --porcelain (not `git diff --quiet`) so a stray UNTRACKED file also trips
      # this — `git checkout` restores tracked files but does not remove untracked
      # ones, and an untracked cassette would still be swept into the auto-PR.
      if [ -n "$(git status --porcelain -- "tests/cassettes/$broker")" ]; then
        log "FAIL: tests/cassettes/$broker not clean after restore (tracked diff or stray untracked file) — refusing to continue with possibly-corrupt cassettes"
        exit 3
      fi
      failed_brokers="${failed_brokers:+$failed_brokers,}$broker"
    else
      log "FAIL: record_cassettes.py exited non-zero for $broker"
      exit 3
    fi
  done
  if [ "$recorded" = "0" ]; then
    fail "no broker recorded — creds unset or every broker unreachable (set DEBUG_KEY_FLOW_OKX_* / DEBUG_KEY_FLOW_BYBIT_* and check egress)"
  fi
  if [ -n "$failed_brokers" ]; then
    log "PARTIAL: $recorded broker(s) recorded; UNREACHABLE (restored from git, unchanged): $failed_brokers"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "failed_brokers=$failed_brokers" >> "$GITHUB_OUTPUT"
    fi
  fi
  if [ -n "$skipped_brokers" ]; then
    log "SKIPPED (creds not set): $skipped_brokers — fine locally, but in CI every broker secret is expected, so a skip means an expired/unset DEBUG_KEY_FLOW_* secret silently stopped that broker refreshing"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
      echo "skipped_brokers=$skipped_brokers" >> "$GITHUB_OUTPUT"
    fi
  fi
  log "recorded $recorded broker(s); running leak gate next"
  # Fall through to leak-gate sections below.
fi

# Pre-flight: cassettes + test file present (only OKX + Bybit — Binance dropped).
required_cassettes=(
  tests/cassettes/okx/happy.yaml
  tests/cassettes/okx/auth-fail.yaml
  tests/cassettes/okx/rate-limit.yaml
  tests/cassettes/okx/schema-drift.yaml
  tests/cassettes/bybit/happy.yaml
  tests/cassettes/bybit/auth-fail.yaml
  tests/cassettes/bybit/rate-limit.yaml
  tests/cassettes/bybit/schema-drift.yaml
)
for f in "${required_cassettes[@]}"; do
  [ -s "$f" ] || { log "missing or empty cassette: $f"; exit 2; }
done

# 1. Run the replay suite (zero network).
# Prefer the analytics-service venv: the --record path above hard-requires it
# (line 63) and CI installs deps ONLY into .venv, never onto the global PATH —
# so a bare `pytest` here is not found under cassette-refresh.yml. Fall back to
# a global `pytest` for local replay-only runs that skip the venv.
pytest_cmd=(pytest)
[ -x .venv/bin/python ] && pytest_cmd=(.venv/bin/python -m pytest)
log "running pytest tests/test_repro_key_flow.py (replay-only)..."
if ! "${pytest_cmd[@]}" tests/test_repro_key_flow.py -x -q; then
  fail "pytest replay failed"
fi
log "replay PASS (12 cassettes)"

# 2a. Layer A — CI gate: grep cassettes for ANY known DEBUG_KEY_FLOW_* env value.
# Binance vars stay in the list defensively — if creds reappear and a Binance
# cassette is later recorded, the leak gate must still catch them.
DEBUG_VARS=(
  DEBUG_KEY_FLOW_OKX_KEY
  DEBUG_KEY_FLOW_OKX_SECRET
  DEBUG_KEY_FLOW_OKX_PASSPHRASE
  DEBUG_KEY_FLOW_BINANCE_KEY
  DEBUG_KEY_FLOW_BINANCE_SECRET
  DEBUG_KEY_FLOW_BYBIT_KEY
  DEBUG_KEY_FLOW_BYBIT_SECRET
)

leak_count=0
for var in "${DEBUG_VARS[@]}"; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    continue  # env not set in this shell — skip (CI may set them; recording-only path)
  fi
  # A 4+ char fragment is the danger threshold; full string match avoids false-positive
  # on header literals.
  if grep -q -r -F "$val" tests/cassettes/ 2>/dev/null; then
    log "LEAK: \$$var value found in cassettes (value redacted)"
    leak_count=$((leak_count + 1))
  fi
done

if [ "$leak_count" -gt 0 ]; then
  fail "$leak_count DEBUG_KEY_FLOW_* env value(s) leaked into cassettes — DO NOT COMMIT"
fi

log "Layer A OK: no DEBUG_KEY_FLOW_* values found in cassettes"

# 2b. Layer B — high-entropy literal scan inside signing-key-named fields.
# Looks for ANY 40+ char [A-Za-z0-9+/=_-] run on a YAML line whose key name
# matches sign|signature|api_key|api[-_]?secret|passphrase. Catches:
#   - rotated test creds whose values are not in the current shell's env
#   - new secret formats that bypass the static denylist
# Whitelist: lines whose value is exactly `[REDACTED]` are skipped.
#
# Note: this is a heuristic — false-positive on legitimate 40-char hashes is
# possible. The fix is to redact those values too (broaden conftest_vcr.py).
HIGH_ENTROPY_RE='[A-Za-z0-9+/=_-]{40,}'
KEY_FIELD_RE='(sign(ature)?|api[-_]?key|api[-_]?secret|passphrase)'

# grep exits 1 when no signing-key line matches — the HEALTHY (clean) case.
# Under `set -euo pipefail` that 1 propagates and aborts the gate before the
# count is ever checked. Lift errexit just for the scan so only a genuine
# count > 0 (below) fails the gate; a clean scan must pass, not abort.
set +e
high_entropy_hits=$(grep -rEi "${KEY_FIELD_RE}.*${HIGH_ENTROPY_RE}" tests/cassettes/ 2>/dev/null \
  | grep -v -F '[REDACTED]' \
  | grep -v -F '<REDACTED>' \
  | wc -l | tr -d '[:space:]')
set -e

if [ "${high_entropy_hits:-0}" -gt 0 ]; then
  log "Layer B FAIL: $high_entropy_hits high-entropy literals found in signing-key-named fields"
  log "Lines (first 10):"
  grep -rEi "${KEY_FIELD_RE}.*${HIGH_ENTROPY_RE}" tests/cassettes/ 2>/dev/null \
    | grep -v -F '[REDACTED]' \
    | grep -v -F '<REDACTED>' \
    | head -10 >&2
  fail "broaden conftest_vcr.py filters OR re-record cassettes after fixing the leak"
fi

log "Layer B OK: no high-entropy literals in signing-key-named fields"
log "ALL CHECKS PASSED"
exit 0
