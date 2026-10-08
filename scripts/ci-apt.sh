#!/usr/bin/env bash
# scripts/ci-apt.sh
#
# The ONE place a GitHub Actions workflow touches apt (Phase 164.9.8 APTHANG).
# A guard test fails when a workflow calls apt-get directly instead of this
# script.
#
# WHY IT EXISTS. On 2026-10-07 several CI jobs sat in an `apt-get` step until
# their job-level timeout. The runner image ALREADY sets one Acquire retry and
# 15 s http/https timeouts (apt.conf.d/zz-retries), and the failing logs show
# apt's mirror failover working. What hangs is a mirror that keeps trickling
# bytes AFTER the fallback: apt's Timeout options are INACTIVITY timers, so a
# connection that never goes fully quiet is never ended by them. The only bound
# that ends a trickle is a wall-clock one. This script therefore:
#   1. keeps the explicit Acquire options (command-line -o is applied last by
#      apt, so they survive any apt.conf.d ordering bug);
#   2. kills each NETWORK phase (index update, archive download) at a
#      wall-clock cap and retries it in a fresh apt process, inside ONE total
#      budget, never re-running a phase that already succeeded;
#   3. unpacks with dpkg only after the archives are cached, with
#      --no-download and NO wall-clock wrapper (dpkg is never killed mid-unpack);
#   4. skips apt entirely when the tool is already on PATH (--provides), which
#      is the cheapest bound of all; and
#   5. ends as a named ::error::MEASURE_FAIL, exit 1, never as a silent hang.
#
# MEASURED BASIS for the defaults (GitHub jobs API over 600 ci.yml runs,
# 2026-09-11 to 2026-10-07, plus the logs of the 53 slowest successful apt
# steps; see the 164.9.8 RESEARCH "Planning addendum"):
#   - successful psql install steps: n=1920, median 10 s, p99 39 s, max 91 s.
#   - slowest successful UPDATE phase: 37.7 s. In a stalled run the InRelease
#     failover reached the primary archive at +65 s.
#   - slowest successful FETCH phase: 69.2 s (two ~31 s mirror timeouts, then
#     the primary archive). The archives here are tiny (11.6 kB and 107 kB), so
#     failover, not throughput, drives this phase.
#   - slowest working throughput seen: 112 kB/s, so the 10-12.6 MB of indices
#     an update reads takes about 115 s at that rate.
#   => update cap 150 s (above both 65 s and ~115 s), fetch cap 120 s (1.7 x
#      69.2 s), kill-after 10 s, retry sleep 3 s, total budget 400 s. Worst case
#      wall clock is the budget + kill-after + one sleep + the local unpack,
#      about 430 s, under the 8-minute step limit the psql sites carry.
#   A dead-primary failover across EVERY index file has never been observed
#   succeeding in that sample. If one happens it runs past the update cap, is
#   retried inside the budget, and ends as a MEASURE_FAIL, not a hang.
#
# Usage:
#   bash scripts/ci-apt.sh install [--provides CMD] [--budget S]
#                                  [--update-timeout S] [--fetch-timeout S] PKG...
#   bash scripts/ci-apt.sh --self-test
#
# Env overrides (for --self-test only): APT_KILL_AFTER (default 10),
# APT_RETRY_SLEEP (default 3), APT_MIN_PHASE (default 10: when less than this
# many seconds of budget remain, no further phase is started).
#
# Never add an option here that weakens signature verification.
set -euo pipefail

SELF="${BASH_SOURCE[0]}"

DEFAULT_BUDGET=400
DEFAULT_UPDATE_TIMEOUT=150
DEFAULT_FETCH_TIMEOUT=120
KILL_AFTER="${APT_KILL_AFTER:-10}"
RETRY_SLEEP="${APT_RETRY_SLEEP:-3}"
MIN_PHASE="${APT_MIN_PHASE:-10}"

# The network options, defined ONCE. These equal what the runner image sets;
# stating them here makes them independent of apt.conf.d ordering.
APT_NET_OPTS=(-o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)

TIMEOUT_BIN=""

usage() {
  cat >&2 <<'EOF'
usage:
  bash scripts/ci-apt.sh install [--provides CMD] [--budget S] [--update-timeout S] [--fetch-timeout S] PKG...
  bash scripts/ci-apt.sh --self-test
EOF
}

die_usage() {
  echo "ci-apt: $1" >&2
  usage
  exit 2
}

# Positive integers only. Zero is refused on purpose: `timeout 0` means NO
# time limit, which is exactly the unbounded state this script exists to end.
is_pos_int() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }
is_nonneg_int() { [[ "$1" =~ ^[0-9]+$ ]]; }

validate_env() {
  is_pos_int "${KILL_AFTER}" || die_usage "APT_KILL_AFTER must be a positive integer, got '${KILL_AFTER}'"
  is_nonneg_int "${RETRY_SLEEP}" || die_usage "APT_RETRY_SLEEP must be a non-negative integer, got '${RETRY_SLEEP}'"
  is_pos_int "${MIN_PHASE}" || die_usage "APT_MIN_PHASE must be a positive integer, got '${MIN_PHASE}'"
}

# forensics: what the killed phase left behind, so the NEXT occurrence names the
# stalled host. Prints only the apt partial-file listing and the socket table.
# Nothing from the environment: no tokens, no DSNs.
forensics() {
  echo "--- apt forensics (what the failed phase left behind) ---"
  ls -l /var/lib/apt/lists/partial 2>/dev/null | head -n 15 || true
  ss -tn 2>/dev/null | head -n 15 || true
}

# net_phase CAP APT-ARGS... -- one NETWORK phase under a wall-clock cap.
# The timeout binary sits INSIDE sudo so the signal reaches apt-get itself, and
# its resolved absolute path survives sudo's secure_path.
net_phase() {
  local cap="$1"
  shift
  sudo "${TIMEOUT_BIN}" --kill-after="${KILL_AFTER}" "${cap}" apt-get "${APT_NET_OPTS[@]}" "$@"
}

do_install() {
  local provides="" budget="${DEFAULT_BUDGET}"
  local update_cap="${DEFAULT_UPDATE_TIMEOUT}" fetch_cap="${DEFAULT_FETCH_TIMEOUT}"
  local pkgs=()
  validate_env
  while [ $# -gt 0 ]; do
    case "$1" in
      --provides|--budget|--update-timeout|--fetch-timeout)
        [ $# -ge 2 ] || die_usage "option $1 needs a value"
        case "$1" in
          --provides) provides="$2" ;;
          --budget)
            is_pos_int "$2" || die_usage "--budget needs a positive integer, got '$2'"
            budget="$2" ;;
          --update-timeout)
            is_pos_int "$2" || die_usage "--update-timeout needs a positive integer, got '$2'"
            update_cap="$2" ;;
          --fetch-timeout)
            is_pos_int "$2" || die_usage "--fetch-timeout needs a positive integer, got '$2'"
            fetch_cap="$2" ;;
        esac
        shift 2
        ;;
      -*) die_usage "unknown option: $1" ;;
      *) pkgs+=("$1"); shift ;;
    esac
  done
  [ "${#pkgs[@]}" -gt 0 ] || die_usage "no packages given"

  # (a) D-04 skip: the tool is already on the image, run no apt at all.
  if [ -n "${provides}" ] && command -v "${provides}" >/dev/null 2>&1; then
    local resolved version
    resolved="$(command -v "${provides}")"
    version="$("${resolved}" --version 2>&1 | head -n 1 || true)"
    echo "apt-skip: ${provides} is already on PATH at ${resolved}: ${version}"
    return 0
  fi

  # (b) Say what bound is in force, and measure the effective apt config.
  echo "apt-bound: budget=${budget}s update-cap=${update_cap}s fetch-cap=${fetch_cap}s kill-after=${KILL_AFTER}s"
  apt-config dump Acquire::Retries Acquire::http::Timeout Acquire::https::Timeout || true

  # (d) Resolve the wall-clock binary once.
  TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
  if [ -z "${TIMEOUT_BIN}" ]; then
    echo "::error::MEASURE_FAIL: neither 'timeout' nor 'gtimeout' is on PATH, so no apt phase can be bounded by wall clock. Install GNU coreutils."
    return 1
  fi

  # (e) Retry loop bounded by one total budget.
  local lists_updated=0 remaining cap phase
  SECONDS=0
  while :; do
    remaining=$((budget - SECONDS))
    [ "${remaining}" -ge "${MIN_PHASE}" ] || break

    if [ "${lists_updated}" -eq 0 ]; then
      phase="update"
      cap=$((update_cap < remaining ? update_cap : remaining))
      if net_phase "${cap}" update -y; then
        lists_updated=1
      else
        echo "::warning::apt ${phase} attempt failed or hit its ${cap} s cap (${SECONDS} s of ${budget} s budget used)"
        forensics
        sleep "${RETRY_SLEEP}"
        continue
      fi
      remaining=$((budget - SECONDS))
      [ "${remaining}" -ge "${MIN_PHASE}" ] || break
    fi

    phase="fetch"
    cap=$((fetch_cap < remaining ? fetch_cap : remaining))
    if net_phase "${cap}" install -y --no-install-recommends --download-only "${pkgs[@]}"; then
      # Archives are cached: the unpack touches no network and is never killed.
      sudo apt-get "${APT_NET_OPTS[@]}" install -y --no-install-recommends --no-download "${pkgs[@]}"
      return $?
    fi
    echo "::warning::apt ${phase} attempt failed or hit its ${cap} s cap (${SECONDS} s of ${budget} s budget used)"
    forensics
    sleep "${RETRY_SLEEP}"
  done

  # (f) Budget spent.
  echo "::error::MEASURE_FAIL: apt could not fetch '${pkgs[*]}' within the ${budget} s budget (update cap ${update_cap} s, fetch cap ${fetch_cap} s). A dead or trickling package mirror, not a repo defect."
  return 1
}

# --self-test -- filled in by the next task of this plan (stub).
self_test() {
  echo "ci-apt: --self-test is not implemented yet" >&2
  return 1
}

case "${1:-}" in
  --self-test) self_test ;;
  install) shift; do_install "$@" ;;
  "") die_usage "missing subcommand" ;;
  *) die_usage "unknown subcommand: $1" ;;
esac
