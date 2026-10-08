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

# --self-test -- proves the wall-clock cap, the budget, the retry, the loud
# failure and the skip against a stub apt-get. The wall-clock binary under test
# is the REAL one (timeout or gtimeout), because the bound under test is real.
self_test() {
  local tb
  tb="$(command -v timeout || command -v gtimeout || true)"
  if [ -z "${tb}" ]; then
    echo "::error::MEASURE_FAIL: self-test needs 'timeout' or 'gtimeout' on PATH; refusing to pass without the real wall-clock binary."
    return 1
  fi

  # Global on purpose: the EXIT trap runs after this function has returned.
  work="$(mktemp -d)"
  trap 'rm -rf "${work}"' EXIT
  mkdir -p "${work}/bin"

  # sudo stub: just run the command unprivileged.
  cat >"${work}/bin/sudo" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
  # apt-config stub: echo the three keys.
  cat >"${work}/bin/apt-config" <<'EOF'
#!/usr/bin/env bash
echo 'Acquire::Retries "1";'
echo 'Acquire::http::Timeout "15";'
echo 'Acquire::https::Timeout "15";'
EOF
  # apt-get stub. Per-scenario behaviour comes from STUB_HANG: "<kind>:<n>"
  # hangs the nth call of that kind (n=all hangs every call), where kind is
  # update, fetch or unpack. Every invocation is logged BEFORE it can hang, so
  # a killed call is still counted. A hang is a plain `sleep 300`: only the
  # real wall-clock cap can end it.
  cat >"${work}/bin/apt-get" <<'EOF'
#!/usr/bin/env bash
kind=other
for a in "$@"; do
  case "$a" in
    update) kind=update ;;
    --download-only) kind=fetch ;;
    --no-download) kind=unpack ;;
  esac
done
echo "${kind} $*" >>"${STUB_DIR}/apt-get.log"
cnt="${STUB_DIR}/count.${kind}"
n=$(( $(cat "${cnt}" 2>/dev/null || echo 0) + 1 ))
echo "${n}" >"${cnt}"
case "${STUB_HANG:-}" in
  "${kind}:all" | "${kind}:${n}") sleep 300 ;;
esac
exit 0
EOF
  chmod +x "${work}/bin/sudo" "${work}/bin/apt-config" "${work}/bin/apt-get"

  local out rc t0 t1 elapsed log

  # run_scenario NAME HANG ARGS... : fresh state, run the script, set
  # out/rc/elapsed/log.
  run_scenario() {
    local name="$1" hang="$2"
    shift 2
    rm -f "${work}"/count.* "${work}/apt-get.log"
    : >"${work}/apt-get.log"
    t0="$(date +%s)"
    set +e
    out="$(PATH="${work}/bin:${PATH}" STUB_DIR="${work}" STUB_HANG="${hang}" \
      APT_MIN_PHASE=1 APT_KILL_AFTER=1 APT_RETRY_SLEEP=0 \
      bash "${SELF}" install "$@" 2>&1)"
    rc=$?
    set -e
    t1="$(date +%s)"
    elapsed=$((t1 - t0))
    log="$(cat "${work}/apt-get.log")"
    SCENARIO="${name}"
  }
  fail() {
    echo "ci-apt self-test FAILED in scenario '${SCENARIO}': $1" >&2
    echo "--- output ---" >&2
    echo "${out}" >&2
    echo "--- stub apt-get log ---" >&2
    echo "${log}" >&2
    exit 1
  }
  count_lines() { grep -a -c "$1" <<<"$2" || true; }

  # 1. retry-after-hang: the first update hangs, the retry succeeds.
  run_scenario retry-after-hang update:1 \
    --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(count_lines '^::warning::apt update' "${out}")" -eq 1 ] \
    || fail "expected exactly one '::warning::apt update' line"
  [ "$(awk '{print $1}' <<<"${log}" | paste -sd, -)" = "update,update,fetch,unpack" ] \
    || fail "expected stub call order update,update,fetch,unpack"
  grep -a -q -- '--download-only' <<<"$(grep -a '^fetch' <<<"${log}")" \
    || fail "fetch call lacks --download-only"
  [ "${elapsed}" -ge 2 ] || fail "elapsed ${elapsed}s < 2s: the first phase was not really killed at its cap"

  # 2. fail-on-budget: every update hangs, the budget ends it.
  run_scenario fail-on-budget update:all \
    --budget 7 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 1 ] || fail "expected exit 1, got ${rc}"
  grep -a -q '^::error::MEASURE_FAIL' <<<"${out}" || fail "no ::error::MEASURE_FAIL line"
  [ "$(count_lines '^update' "${log}")" -ge 2 ] || fail "expected at least two update invocations"
  [ "$(count_lines '^fetch\|^unpack' "${log}")" -eq 0 ] || fail "a fetch or unpack ran although update never succeeded"
  [ "$(count_lines '^::warning::apt update' "${out}")" -ge 2 ] || fail "expected at least two '::warning::apt update' lines"
  { [ "${elapsed}" -ge 6 ] && [ "${elapsed}" -le 13 ]; } \
    || fail "elapsed ${elapsed}s outside 6..13s"

  # 3. no-update-rerun: update ok, first fetch hangs, second fetch ok.
  run_scenario no-update-rerun fetch:1 \
    --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "expected exactly ONE update invocation"
  [ "$(count_lines '^fetch' "${log}")" -eq 2 ] || fail "expected exactly TWO fetch invocations"
  [ "$(count_lines '^::warning::apt fetch' "${out}")" -eq 1 ] \
    || fail "expected exactly one '::warning::apt fetch' line"

  # 4. skip-when-present: the tool is on PATH, no apt is invoked.
  run_scenario skip-when-present "" --provides sh x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  grep -a -q '^apt-skip: sh' <<<"${out}" || fail "no 'apt-skip: sh' line"
  [ -z "${log}" ] || fail "apt-get was invoked on the skip path"

  # 5. fall-through-when-absent: the tool cannot exist, so apt runs (healthy stub).
  run_scenario fall-through-when-absent "" \
    --provides "ci-apt-absent-tool-$$" --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(awk '{print $1}' <<<"${log}" | paste -sd, -)" = "update,fetch,unpack" ] \
    || fail "expected stub call order update,fetch,unpack"
  if grep -a -q '^apt-skip:' <<<"${out}"; then fail "skipped although the tool is absent"; fi

  echo "ci-apt self-test OK: retry-after-hang, fail-on-budget, no-update-rerun, skip-when-present, fall-through-when-absent."
}

case "${1:-}" in
  --self-test) self_test ;;
  install) shift; do_install "$@" ;;
  "") die_usage "missing subcommand" ;;
  *) die_usage "unknown subcommand: $1" ;;
esac
