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
#   5. ends as a named ::error::MEASURE_FAIL, exit 1, never as a silent hang; and
#   6. classifies a failed phase and retries everything a retry MAY fix: a wall-clock
#      kill (exit 124/137) and any apt exit 100 whose output carries no known
#      deterministic signature (a 5xx, a closed connection, "Mirror sync in progress",
#      a resolver error and so on all retry). A typo'd package, a held dpkg lock, a
#      bad or unsigned source, a failed dpkg, a bad operation, a full or read-only disk,
#      a file apt cannot open, a source whose Origin changed and a pinned version that
#      does not exist fail at once with apt's own exit code and a "failed
#      deterministically" MEASURE_FAIL, never as a mirror failure. An exit 100 nobody
#      has classified yet retries until the budget ends, and then the MEASURE_FAIL
#      quotes it and does NOT blame the mirror unless the detail names a network
#      failure. A 404 ("Not Found") on either phase, or a package the index does not
#      list on the fetch, earns ONE fresh `update` (the index may simply be stale).
#   An `update` that exits 0 with `W:` lines (a flaky THIRD-PARTY source) is a
#   success: apt's default mode downgrades a failure of one source to a warning on
#   purpose, and the runner image also configures packages.microsoft.com, which no
#   wrapped install needs. The wrapper prints the warning and REMEMBERS it. If the
#   fetch then succeeds, the dead source did not matter and nothing is re-run. If the
#   fetch reports "Unable to locate package" right after such an update, the source
#   that failed may be the primary Ubuntu mirror itself (apt turns that into the same
#   `W:` + exit 0), so that is a RETRY inside the budget, with a fresh `update` and no
#   stale-index credit spent, and a budget MEASURE_FAIL quotes the saved warning.
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

# apt exit 100 is a catch-all (a 503, a closed connection and a typo'd package all
# exit 100), so the classifier is INVERTED: exit 100 is retryable UNLESS the output
# carries a signature that a retry cannot fix. Add to this list when a new
# deterministic failure is seen; do not add network wording to a list instead.
# The local-state group (free space, a read-only fs, a lock or file apt cannot open) and the
# source-change group (`changed its 'Origin' value`, a pinned `Version 'x' for 'y' was not
# found`) fail identically on every attempt. Bare `Permission denied` is deliberately NOT here:
# apt also prints it for a network policy block (`connect (13: Permission denied)`), which
# a retry can outlive; the permission failures that are local arrive as `Could not open
# (lock )?file ... (13: Permission denied)` and are matched by that wording.
DETERMINISTIC_RE='Unable to locate package|has no installation candidate|Could not get lock|dpkg returned an error code|dpkg was interrupted|NO_PUBKEY|EXPKEYSIG|is not signed|The following signatures|Malformed|Conflicts:|unmet dependencies|Invalid operation|enough free space|No space left on device|Read-only file system|Could not open (lock )?file|changed its '"'"'|Version '"'"'[^'"'"']*'"'"' for '"'"'[^'"'"']*'"'"' was not found'
# Wording that names a network or download failure: the only detail the closing message
# may answer with "a dead or trickling mirror" (apt exit 124/137 is a kill and also counts).
NET_DETAIL_RE='Failed to fetch|Err:|Could not (resolve|connect)|Connection (timed out|refused|failed|reset)|Temporary failure|unreachable|No route to host|Cannot initiate|Remote end closed|Error reading from server|Service Unavailable|Bad Gateway|Gateway Time|Mirror sync|unexpected size|Hash Sum mismatch|Undetermined Error|Some index files failed|Some files failed to download|Unable to fetch some archives'
# apt exits 0 on an `update` where any source failed and prints these two `W:` lines.
UPDATE_WARN_RE='^W: (Failed to fetch|Some index files failed)'
# A 404 anywhere means the index and the mirror disagree: worth ONE fresh update.
STALE_404_RE='[[:space:]]404[[:space:]]+Not Found'
# On the fetch phase a package the index does not list is the same stale-index shape.
STALE_LOCATE_RE='Unable to locate package'
# apt's own generic trailers: they name no source, so they are not the line to quote.
GENERIC_E_RE='Some index files failed|Some files failed to download|Unable to fetch some archives|Sub-process .* returned an error|Unable to lock directory|Unable to acquire the dpkg|Unable to correct problems'

TIMEOUT_BIN=""
PHASE_DIR=""

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

# forensics: what the failed phase left behind, so the NEXT occurrence names the
# stalled host. Prints only the apt partial-file listing and the socket table.
# Nothing from the environment: no tokens, no DSNs. Both partial/ directories are
# _apt-owned 0700, so they are read with sudo (-n: never block on a password), and
# a failure to read them is printed, not hidden: a forensic that silently shows
# nothing is indistinguishable from a phase that left nothing behind.
forensics() {
  echo "--- apt forensics (what the failed phase left behind) ---"
  sudo -n ls -l /var/lib/apt/lists/partial /var/cache/apt/archives/partial 2>&1 | head -n 30 || true
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

# run_capture LOG CMD... -- run CMD with its output streamed to the job log AND
# captured in LOG, so the retry decision can read what apt said. Sets CAPTURE_RC to
# CMD's own exit code (never tee's), whatever errexit state the caller is in.
run_capture() {
  local log="$1" rcfile="${PHASE_DIR}/capture.rc"
  shift
  : >"${log}"
  { rc=0; "$@" || rc=$?; echo "${rc}" >"${rcfile}"; } 2>&1 | tee "${log}"
  CAPTURE_RC="$(cat "${rcfile}")"
}

# run_phase CAP APT-ARGS... -- one capped network phase, captured. Sets PHASE_RC
# and PHASE_LOG.
run_phase() {
  local cap="$1"
  shift
  PHASE_LOG="${PHASE_DIR}/phase.log"
  run_capture "${PHASE_LOG}" net_phase "${cap}" "$@"
  PHASE_RC="${CAPTURE_RC}"
}

# classify RC LOG PHASE -- sets VERDICT to retry | stale | fatal.
#   124/137            a wall-clock kill: retry.
#   100 + 404 / (fetch) a package the index lacks: stale, ONE fresh update.
#   100 + a signature in DETERMINISTIC_RE: fatal, a retry cannot fix it.
#   100 otherwise      retry: apt exits 100 for every network failure too.
#   any other code     fatal.
classify() {
  local rc="$1" log="$2" phase="$3"
  case "${rc}" in
    124|137) VERDICT=retry; return 0 ;;
    100) ;;
    *) VERDICT=fatal; return 0 ;;
  esac
  if grep -a -E -q "${STALE_404_RE}" "${log}" \
    || { [ "${phase}" = fetch ] && grep -a -E -q "${STALE_LOCATE_RE}" "${log}"; }; then
    VERDICT=stale
  elif grep -a -E -q "${DETERMINISTIC_RE}" "${log}"; then
    VERDICT=fatal
  else
    VERDICT=retry
  fi
}

# failure_detail LOG -- what to quote in a MEASURE_FAIL: the first line that names the
# failing source (`E: Failed to fetch <url>  <cause>` or `Err:`), then apt's last
# specific `E:` line. apt prints the specific line first and a generic trailer last,
# so quoting only the last line names neither the URL nor the cause.
failure_detail() {
  local first last
  first="$(grep -a -m 1 '^E: Failed to fetch' "$1" | cut -c1-300 || true)"
  # An `Err:` header carries the URL and its cause on the NEXT line.
  [ -n "${first}" ] || first="$(grep -a -m 1 -A 1 '^Err:' "$1" | tr '\n' ' ' | tr -s ' ' | cut -c1-300 || true)"
  [ -n "${first}" ] || first="$(grep -a -m 1 '^W: Failed to fetch' "$1" | cut -c1-300 || true)"
  last="$(grep -a '^E:' "$1" | grep -a -v -E "${GENERIC_E_RE}" | tail -n 1 | cut -c1-300 || true)"
  [ -n "${last}" ] || last="$(grep -a '^E:' "$1" | tail -n 1 | cut -c1-300 || true)"
  if [ -n "${first}" ] && [ "${first}" != "${last}" ] && [ "${first#W: }" != "${last#E: }" ]; then
    echo "${first} | ${last:-(no further E: line)}"
  else
    echo "${last:-${first:-(no E: or Err: line in the apt output)}}"
  fi
}

# update_warning LOG -- the `W:` line an rc-0 `update` printed for a failed source, or nothing.
# The line that names the URL wins over apt's generic "Some index files failed" trailer.
update_warning() {
  local w
  w="$(grep -a -m 1 '^W: Failed to fetch' "$1" | cut -c1-300 || true)"
  [ -n "${w}" ] || w="$(grep -a -m 1 -E "${UPDATE_WARN_RE}" "$1" | cut -c1-300 || true)"
  echo "${w}"
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
  [ "${budget}" -ge "${MIN_PHASE}" ] \
    || die_usage "--budget ${budget} is below the ${MIN_PHASE} s minimum a single phase needs; no attempt would ever start"

  # (a) D-04 skip: the tool is already on the image, run no apt at all. Only a
  # binary that actually RUNS counts: on Ubuntu /usr/bin/psql is a pg_wrapper
  # symlink that exists and exits non-zero when no postgresql-client-NN is installed.
  if [ -n "${provides}" ] && command -v "${provides}" >/dev/null 2>&1; then
    local resolved vout vrc=0
    resolved="$(command -v "${provides}")"
    vout="$("${resolved}" --version 2>&1)" || vrc=$?
    if [ "${vrc}" -eq 0 ]; then
      echo "apt-skip: ${provides} is already on PATH at ${resolved}: $(head -n 1 <<<"${vout}")"
      return 0
    fi
    echo "::warning::apt-provides: ${provides} is on PATH at ${resolved} but '--version' exited ${vrc} ($(head -n 1 <<<"${vout}")); not skipping, falling through to apt"
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
  PHASE_DIR="$(mktemp -d)"
  trap 'rm -rf "${PHASE_DIR}"' EXIT

  # (e) Retry loop bounded by one total budget. ONE phase per iteration: update until it
  # succeeds, then the archive fetch, then the unpack. `update` is NOT run with
  # APT::Update::Error-Mode=any: in apt's default mode a failure of one source (the
  # runner also reads packages.microsoft.com, which no wrapped install needs) is a
  # warning, and a dead third-party source must not fail an install that the healthy
  # Ubuntu mirror can serve. A stale index for the package we DO need surfaces in the
  # fetch phase and takes the stale path below.
  local lists_updated=0 stale_retries=0 remaining cap phase last_rc=0 last_phase=none last_detail="(none)" urc=0
  local update_warn="" warned_locate=0
  SECONDS=0
  while :; do
    remaining=$((budget - SECONDS))
    [ "${remaining}" -ge "${MIN_PHASE}" ] || break

    if [ "${lists_updated}" -eq 0 ]; then
      phase="update"
      cap=$((update_cap < remaining ? update_cap : remaining))
      run_phase "${cap}" update -y
    else
      phase="fetch"
      cap=$((fetch_cap < remaining ? fetch_cap : remaining))
      run_phase "${cap}" install -y --no-install-recommends --download-only "${pkgs[@]}"
    fi

    if [ "${PHASE_RC}" -eq 0 ]; then
      if [ "${phase}" = update ]; then
        lists_updated=1
        # rc 0 does not mean every source answered: remember the W: line (empty when clean).
        update_warn="$(update_warning "${PHASE_LOG}")"
        if [ -n "${update_warn}" ]; then
          echo "::warning::apt update exited 0 but a source failed (${SECONDS} s of ${budget} s budget used); installing from the index it left, and re-running update if the package is missing: ${update_warn}"
        fi
        continue
      fi
      # Archives are cached: the unpack touches no network and is never killed.
      # An explicit status: this must not depend on errexit surviving a caller's `||`.
      run_capture "${PHASE_DIR}/unpack.log" \
        sudo apt-get "${APT_NET_OPTS[@]}" install -y --no-install-recommends --no-download "${pkgs[@]}"
      urc="${CAPTURE_RC}"
      if [ "${urc}" -ne 0 ]; then
        echo "::error::MEASURE_FAIL: apt unpack failed (rc=${urc}); the archives were cached, so this is not a network failure: $(failure_detail "${PHASE_DIR}/unpack.log")"
        return "${urc}"
      fi
      return 0
    fi

    last_rc="${PHASE_RC}"; last_phase="${phase}"; warned_locate=0
    classify "${PHASE_RC}" "${PHASE_LOG}" "${phase}"
    case "${PHASE_RC}" in
      124|137) last_detail="killed at its ${cap} s wall-clock cap" ;;
      *) last_detail="$(failure_detail "${PHASE_LOG}")" ;;
    esac
    if [ "${VERDICT}" = stale ] && [ "${phase}" = fetch ] && [ -n "${update_warn}" ] \
      && grep -a -E -q "${STALE_LOCATE_RE}" "${PHASE_LOG}" && ! grep -a -E -q "${STALE_404_RE}" "${PHASE_LOG}"; then
      # The update before this fetch exited 0 but a source failed, and the package is not in
      # the index: the source that failed may be the one that serves it (the primary mirror
      # down for a few seconds looks exactly like this). That is a transient the budget
      # rides out, NOT the stale-index case, so the single stale credit is left unspent.
      warned_locate=1
      lists_updated=0
      echo "::warning::apt fetch cannot find the package after an update that exited 0 with a failed source (rc=${PHASE_RC}); re-running update (${SECONDS} s of ${budget} s budget used): ${last_detail} | update warning: ${update_warn}"
      sleep "${RETRY_SLEEP}"
      continue
    fi
    if [ "${VERDICT}" = stale ] && [ "${stale_retries}" -lt 1 ]; then
      # The index and the mirror disagree (a 404, or a package the index does not list):
      # the index may simply be stale, so ONE fresh update is worth the time. The cap is
      # shared by both phases and a second miss is real, so a typo'd package or a dead
      # path cannot loop for the whole budget.
      stale_retries=$((stale_retries + 1))
      lists_updated=0
      echo "::warning::apt ${phase} found a 404 or a package the index does not list (rc=${PHASE_RC}); re-running update once (${SECONDS} s of ${budget} s budget used): ${last_detail}"
      sleep "${RETRY_SLEEP}"
      continue
    fi
    if [ "${VERDICT}" = fatal ] || [ "${VERDICT}" = stale ]; then
      echo "::error::MEASURE_FAIL: apt ${phase} failed deterministically (rc=${PHASE_RC}): ${last_detail}"
      return "${PHASE_RC}"
    fi
    echo "::warning::apt ${phase} attempt failed (rc=${PHASE_RC}) or hit its ${cap} s cap (${SECONDS} s of ${budget} s budget used): ${last_detail}"
    forensics
    sleep "${RETRY_SLEEP}"
  done

  # (f) Budget spent, every failure so far a retryable one. Blame the mirror only when the
  # evidence says so: a wall-clock kill, a failure naming a fetch or network error, a
  # package missing after a source failed during update, or only time running out (no
  # failed phase at all). Anything else is an exit 100 this wrapper does not recognise:
  # quote it and say so, so the next reader adds its wording to DETERMINISTIC_RE.
  local update_note="" blame
  [ -z "${update_warn}" ] || update_note=" The last update exited 0 but reported: ${update_warn}."
  if [ "${last_phase}" = none ] || [ "${warned_locate}" -eq 1 ] || [ "${last_rc}" = 124 ] || [ "${last_rc}" = 137 ] \
    || grep -a -E -q "${NET_DETAIL_RE}" <<<"${last_detail}"; then
    blame="A dead or trickling package mirror, not a repo defect."
  else
    blame="apt kept exiting ${last_rc} with an error this wrapper does not recognise as a network failure, so the mirror is not blamed; if the quoted error cannot clear by itself, add its wording to DETERMINISTIC_RE in scripts/ci-apt.sh."
  fi
  echo "::error::MEASURE_FAIL: apt could not fetch '${pkgs[*]}' within the ${budget} s budget (update cap ${update_cap} s, fetch cap ${fetch_cap} s; last failure: ${last_phase} rc=${last_rc}: ${last_detail}).${update_note} ${blame}"
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

  # sudo stub: log the call, drop a leading -n, run the command unprivileged.
  cat >"${work}/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"${STUB_DIR}/sudo.log"
[ "${1:-}" = -n ] && shift
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
  # a killed call is still counted. A hang is a plain `exec sleep 300`: only the
  # real wall-clock cap can end it. The stub also records its PARENT's command name
  # (parent.log), which is how the self-test proves a phase did or did not run under
  # the inner wall-clock `timeout`.
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
parent="$(cat "/proc/${PPID}/comm" 2>/dev/null || ps -o comm= -p "${PPID}" 2>/dev/null || echo unknown)"
echo "${kind} ${parent}" >>"${STUB_DIR}/parent.log"
cnt="${STUB_DIR}/count.${kind}"
n=$(( $(cat "${cnt}" 2>/dev/null || echo 0) + 1 ))
echo "${n}" >"${cnt}"
case "${STUB_HANG:-}" in
  "${kind}:all" | "${kind}:${n}") exec sleep 300 ;;
esac
# STUB_FAIL is a comma list of "<kind>:<n|all>:<mode>" and makes that call fail
# INSTANTLY the way a real apt does. Modes (all exit 100 unless noted):
#   retryable by shape: netfail, net502, net503, net504, resolve, closed, unreach, sync
#   deterministic:      locate, lock, interrupted, nopubkey, expkey, malformed, unmet,
#                       badop, candidate, dpkg, disk, nospace, rofs, openlock, openfile,
#                       origin, version
#   unclassified:       unknown100 (exit 100, wording in neither list: retries to the budget)
#   stale404 (a 404); whalf (exit 0: a flaky third-party source, only W: lines).
IFS=, read -r -a specs <<<"${STUB_FAIL:-}"
for spec in "${specs[@]}"; do
  k="${spec%%:*}"; rest="${spec#*:}"; sn="${rest%%:*}"; mode="${rest#*:}"
  if [ "${k}" = "${kind}" ] && { [ "${sn}" = all ] || [ "${sn}" = "${n}" ]; }; then
    U="http://mirror.invalid/dists/noble/InRelease"
    case "${mode}" in
      locate) echo "E: Unable to locate package x"; exit 100 ;;
      candidate) echo "E: Package 'x' has no installation candidate"; exit 100 ;;
      lock) echo "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 99 (apt-get)"; echo "E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), is another process using it?"; exit 100 ;;
      interrupted) echo "E: dpkg was interrupted, you must manually run 'dpkg --configure -a' to correct the problem."; exit 100 ;;
      nopubkey) echo "W: GPG error: ${U}: The following signatures couldn't be verified because the public key is not available: NO_PUBKEY 0123456789ABCDEF"; echo "E: The repository 'http://mirror.invalid noble InRelease' is not signed."; exit 100 ;;
      expkey) echo "W: GPG error: ${U}: The following signatures were invalid: EXPKEYSIG 0123456789ABCDEF"; echo "E: The repository 'http://mirror.invalid noble InRelease' is not signed."; exit 100 ;;
      malformed) echo "E: Malformed entry 1 in list file /etc/apt/sources.list.d/x.list (URI)"; exit 100 ;;
      unmet) echo "The following packages have unmet dependencies:"; echo " x : Conflicts: y"; echo "E: Unable to correct problems, you have held broken packages."; exit 100 ;;
      badop) echo "E: Invalid operation foo"; exit 100 ;;
      dpkg) echo "E: Sub-process /usr/bin/dpkg returned an error code (1)"; exit 100 ;;
      disk) echo "E: You don't have enough free space in /var/cache/apt/archives/."; exit 100 ;;
      nospace) echo "E: Failed to fetch http://mirror.invalid/dists/noble/main/Packages  Error writing to file - write (28: No space left on device) [IP: 192.0.2.1 80]"; exit 100 ;;
      rofs) echo "E: List directory /var/lib/apt/lists/partial is missing. - Acquire (30: Read-only file system)"; exit 100 ;;
      openlock) echo "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)"; exit 100 ;;
      openfile) echo "E: Could not open file /var/lib/apt/lists/x_Packages - open (2: No such file or directory)"; exit 100 ;;
      origin) echo "E: Repository 'http://mirror.invalid noble InRelease' changed its 'Origin' value from 'A' to 'B'"; exit 100 ;;
      version) echo "E: Version '9.9' for 'x' was not found"; exit 100 ;;
      unknown100) echo "E: Some brand new apt complaint nobody has classified"; exit 100 ;;
      netfail) echo "E: Failed to fetch http://mirror.invalid/x.deb  Connection timed out [IP: 192.0.2.1 80]"; exit 100 ;;
      net502|net503|net504)
        case "${mode}" in net502) c="502  Bad Gateway" ;; net503) c="503  Service Unavailable" ;; *) c="504  Gateway Time-out" ;; esac
        echo "Err:1 ${U} noble InRelease"; echo "  ${c} [IP: 192.0.2.1 80]"
        echo "E: Failed to fetch ${U}  ${c} [IP: 192.0.2.1 80]"
        echo "E: Some index files failed to download. They have been ignored, or old ones used instead."
        exit 100 ;;
      resolve) echo "E: Failed to fetch ${U}  Could not resolve 'mirror.invalid'"; exit 100 ;;
      closed) echo "E: Failed to fetch ${U}  Error reading from server. Remote end closed connection [IP: 192.0.2.1 80]"; exit 100 ;;
      unreach) echo "E: Failed to fetch ${U}  Cannot initiate the connection to mirror.invalid:80 (2001:db8::1). - connect (101: Network is unreachable)"; exit 100 ;;
      sync) echo "E: Failed to fetch ${U}  File has unexpected size (1 != 2). Mirror sync in progress? [IP: 192.0.2.1 80]"; exit 100 ;;
      whalf)
        echo "W: Failed to fetch http://thirdparty.invalid/InRelease  Could not connect to thirdparty.invalid:80 (192.0.2.9). - connect (111: Connection refused)"
        echo "W: Some index files failed to download. They have been ignored, or old ones used instead."
        exit 0 ;;
      stale404)
        echo "E: Failed to fetch http://mirror.invalid/x.deb  404  Not Found [IP: 192.0.2.1 80]"
        echo "E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?"
        exit 100 ;;
    esac
  fi
done
exit 0
EOF
  # A tool that is on PATH and fails --version, like pg_wrapper with no client installed.
  cat >"${work}/bin/ci-apt-broken-tool" <<'EOF'
#!/usr/bin/env bash
echo "You must install at least one postgresql-client-<version> package" >&2
exit 3
EOF
  # A tool that is on PATH and works: prints a version and exits 0. Hermetic on purpose;
  # `sh` is a bad fixture because some shells exit non-zero on --version.
  cat >"${work}/bin/ci-apt-ok-tool" <<'EOF'
#!/usr/bin/env bash
echo "ci-apt-ok-tool 1.2.3"
EOF
  chmod +x "${work}/bin/sudo" "${work}/bin/apt-config" "${work}/bin/apt-get" "${work}/bin/ci-apt-broken-tool" "${work}/bin/ci-apt-ok-tool"

  local out rc t0 t1 elapsed log plog sudolog min_phase=1 stub_fail="" retry_sleep=0 outer_cap=""

  # run_scenario NAME HANG ARGS... : fresh state, run the script, set
  # out/rc/elapsed/log/plog/sudolog. OUTER_CAP, when set, wraps the whole script in an
  # OUTER wall-clock timeout (the real one), the way a job's step limit wraps it.
  run_scenario() {
    local name="$1" hang="$2" runner=(bash "${SELF}")
    shift 2
    [ -z "${outer_cap}" ] || runner=("${tb}" "${outer_cap}" bash "${SELF}")
    rm -f "${work}"/count.* "${work}/apt-get.log" "${work}/parent.log" "${work}/sudo.log"
    : >"${work}/apt-get.log"
    : >"${work}/parent.log"
    : >"${work}/sudo.log"
    t0="$(date +%s)"
    set +e
    out="$(PATH="${work}/bin:${PATH}" STUB_DIR="${work}" STUB_HANG="${hang}" STUB_FAIL="${stub_fail}" \
      APT_MIN_PHASE="${min_phase}" APT_KILL_AFTER=1 APT_RETRY_SLEEP="${retry_sleep}" \
      "${runner[@]}" install "$@" 2>&1)"
    rc=$?
    set -e
    t1="$(date +%s)"
    elapsed=$((t1 - t0))
    log="$(cat "${work}/apt-get.log")"
    plog="$(cat "${work}/parent.log")"
    sudolog="$(cat "${work}/sudo.log")"
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
  order() { awk '{print $1}' <<<"$1" | paste -sd, -; }

  # 1. retry-after-hang: the first update hangs, the retry succeeds.
  run_scenario retry-after-hang update:1 \
    --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(count_lines '^::warning::apt update' "${out}")" -eq 1 ] \
    || fail "expected exactly one '::warning::apt update' line"
  [ "$(order "${log}")" = "update,update,fetch,unpack" ] \
    || fail "expected stub call order update,update,fetch,unpack"
  grep -a -q -- '--download-only' <<<"$(grep -a '^fetch' <<<"${log}")" \
    || fail "fetch call lacks --download-only"
  [ "${elapsed}" -ge 2 ] || fail "elapsed ${elapsed}s < 2s: the first phase was not really killed at its cap"
  grep -a -q '^-n ls -l /var/lib/apt/lists/partial /var/cache/apt/archives/partial' <<<"${sudolog}" \
    || fail "the forensics did not list BOTH 0700 partial/ directories with sudo -n"
  if grep -a -q 'Error-Mode' <<<"${log}"; then fail "update ran with APT::Update::Error-Mode: a dead third-party source would fail the install"; fi

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
  # A wall-clock kill IS the mirror's doing: the closing sentence says so.
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'not a repo defect' \
    || fail "a budget spent on wall-clock kills did not say it was a dead or trickling mirror"

  # 3. no-update-rerun: update ok, first fetch hangs, second fetch ok.
  run_scenario no-update-rerun fetch:1 \
    --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "expected exactly ONE update invocation"
  [ "$(count_lines '^fetch' "${log}")" -eq 2 ] || fail "expected exactly TWO fetch invocations"
  [ "$(count_lines '^::warning::apt fetch' "${out}")" -eq 1 ] \
    || fail "expected exactly one '::warning::apt fetch' line"

  # 4. skip-when-present: a hermetic tool that runs and prints a version is on PATH, so no
  # apt is invoked.
  run_scenario skip-when-present "" --provides ci-apt-ok-tool x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  grep -a -q '^apt-skip: ci-apt-ok-tool' <<<"${out}" || fail "no 'apt-skip: ci-apt-ok-tool' line"
  [ -z "${log}" ] || fail "apt-get was invoked on the skip path"

  # 5. fall-through-when-absent: the tool cannot exist, so apt runs (healthy stub). Also the
  # structural invariant: update and fetch run under the inner wall-clock timeout, the unpack
  # NEVER does (dpkg is not killed mid-unpack). The first two are the positive control that
  # makes the third check non-vacuous.
  run_scenario fall-through-when-absent "" \
    --provides "ci-apt-absent-tool-$$" --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(order "${log}")" = "update,fetch,unpack" ] \
    || fail "expected stub call order update,fetch,unpack"
  if grep -a -q '^apt-skip:' <<<"${out}"; then fail "skipped although the tool is absent"; fi
  grep -a '^update' <<<"${plog}" | grep -a -q timeout || fail "the update did not run under the inner timeout (the parent check is blind)"
  grep -a '^fetch' <<<"${plog}" | grep -a -q timeout || fail "the fetch did not run under the inner timeout (the parent check is blind)"
  [ "$(count_lines '^unpack' "${plog}")" -eq 1 ] || fail "expected exactly one unpack parent record"
  if grep -a '^unpack' <<<"${plog}" | grep -a -q timeout; then fail "the unpack ran under an inner timeout: dpkg could be killed mid-unpack"; fi

  # 6. deterministic-fail: apt refuses instantly (exit 100, no network word). ONE call,
  # a fast exit with apt's own code, and a message that does NOT blame the mirror.
  stub_fail="update:all:locate"
  run_scenario deterministic-fail "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 100 ] || fail "expected apt's own exit code 100, got ${rc}"
  [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "expected exactly ONE update invocation (no retry of a deterministic error)"
  [ "${elapsed}" -le 3 ] || fail "elapsed ${elapsed}s: a deterministic error must fail fast, not spend the budget"
  grep -a -q '^::error::MEASURE_FAIL: apt update failed deterministically (rc=100): E: Unable to locate package x' <<<"${out}" \
    || fail "no 'failed deterministically (rc=100)' MEASURE_FAIL line naming the E: line"
  if grep -a -q 'not a repo defect' <<<"${out}"; then fail "a deterministic error was blamed on the mirror"; fi

  # 7. network-fail-retries: an exit-100 network failure IS retried (one call fails, the next succeeds).
  stub_fail="fetch:1:netfail"
  run_scenario network-fail-retries "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(count_lines '^fetch' "${log}")" -eq 2 ] || fail "expected TWO fetch invocations (network failure retried)"
  [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "expected ONE update invocation"

  # 8. retryable-by-default: apt exit 100 is retried on BOTH phases for every transient
  # shape the real apt prints, none of which carry the words the old allow-list knew
  # (a 5xx, a resolver error, a closed connection, an unreachable network, a mirror mid-sync).
  local mode
  for mode in net502 net503 net504 resolve closed unreach sync; do
    stub_fail="update:1:${mode}"
    run_scenario "retry-update-${mode}" "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
    stub_fail=""
    [ "${rc}" -eq 0 ] || fail "update ${mode}: expected exit 0 after a retry, got ${rc}"
    [ "$(count_lines '^update' "${log}")" -eq 2 ] || fail "update ${mode}: expected TWO update invocations (a transient failure must be retried)"
    stub_fail="fetch:1:${mode}"
    run_scenario "retry-fetch-${mode}" "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
    stub_fail=""
    [ "${rc}" -eq 0 ] || fail "fetch ${mode}: expected exit 0 after a retry, got ${rc}"
    [ "$(count_lines '^fetch' "${log}")" -eq 2 ] || fail "fetch ${mode}: expected TWO fetch invocations (a transient failure must be retried)"
    [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "fetch ${mode}: expected ONE update invocation"
  done

  # 9. deterministic-signatures: each known signature fails FAST on both phases with ONE
  # call of that phase, apt's own code, and a message that does not blame the mirror.
  local phase
  for phase in update fetch; do
    for mode in locate candidate lock interrupted nopubkey expkey malformed unmet badop dpkg disk nospace rofs openlock openfile origin version; do
      # A missing package on the fetch is the stale-index shape, covered by scenario 11.
      [ "${phase}:${mode}" != "fetch:locate" ] || continue
      stub_fail="${phase}:all:${mode}"
      run_scenario "deterministic-${phase}-${mode}" "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
      stub_fail=""
      [ "${rc}" -eq 100 ] || fail "${phase} ${mode}: expected apt's own exit code 100, got ${rc}"
      [ "$(count_lines "^${phase}" "${log}")" -eq 1 ] || fail "${phase} ${mode}: expected exactly ONE ${phase} invocation (a deterministic error must not be retried)"
      grep -a -q 'failed deterministically (rc=100)' <<<"${out}" || fail "${phase} ${mode}: no 'failed deterministically' MEASURE_FAIL"
      if grep -a -q 'not a repo defect' <<<"${out}"; then fail "${phase} ${mode}: a deterministic error was blamed on the mirror"; fi
    done
  done

  # 10. update-half-failure: an `update` that exits 0 with W: lines (a flaky THIRD-PARTY
  # source; apt's default mode keeps going on purpose) PROCEEDS to the fetch. It is not
  # re-run, not promoted to a failure, and APT::Update::Error-Mode is not set.
  stub_fail="update:all:whalf"
  run_scenario update-half-failure-proceeds "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 0 ] || fail "a third-party source that only warned failed the install (rc ${rc})"
  [ "$(order "${log}")" = "update,fetch,unpack" ] || fail "expected stub call order update,fetch,unpack (ONE update, straight to the fetch)"
  if grep -a -q 'treating it as a failure' <<<"${out}"; then fail "a warning-only update was promoted to a failure"; fi

  # 11. stale-index: a 404 earns exactly ONE fresh update on either phase, then it is real.
  stub_fail="fetch:1:stale404"
  run_scenario stale-index-reupdates "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(order "${log}")" = "update,fetch,update,fetch,unpack" ] \
    || fail "expected stub call order update,fetch,update,fetch,unpack (lists_updated reset after a 404)"
  stub_fail="fetch:all:stale404"
  run_scenario stale-index-bounded "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 100 ] || fail "expected exit 100, got ${rc}"
  [ "$(count_lines '^update' "${log}")" -eq 2 ] || fail "expected exactly TWO update invocations (one re-update, then fatal)"
  [ "$(count_lines '^unpack' "${log}")" -eq 0 ] || fail "an unpack ran although the fetch never succeeded"
  grep -a -q 'failed deterministically (rc=100)' <<<"${out}" || fail "no deterministic MEASURE_FAIL for a persistent 404"
  # The half-failed update that left the needed package out of the index: the fetch says so
  # and the update is re-run (the safety net that replaces Error-Mode=any). The update warned,
  # so this is a retry of a possible mirror outage, NOT the stale credit (WR-R3-02).
  stub_fail="update:1:whalf,fetch:1:locate"
  run_scenario half-update-then-missing-package "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(order "${log}")" = "update,fetch,update,fetch,unpack" ] \
    || fail "expected stub call order update,fetch,update,fetch,unpack (a package the index lacks re-updates once)"
  grep -a -q '^::warning::apt update exited 0 but a source failed.*W: Failed to fetch http://thirdparty.invalid/InRelease' <<<"${out}" \
    || fail "the warned update was not announced with its W: line"
  if grep -a -q 're-running update once' <<<"${out}"; then fail "a warned update spent the stale-index credit"; fi
  # A warned update then a SUCCESSFUL fetch (a dead source nobody needs) re-runs nothing: scenario 10.
  # Both mirrors dead for the whole budget (update warns, the package is never there): the
  # loop re-updates every iteration, never takes the stale credit, and the MEASURE_FAIL names
  # the W: URL instead of "failed deterministically: Unable to locate package".
  stub_fail="update:all:whalf,fetch:all:locate"
  # retry_sleep stays 0: the assertion below counts update calls inside the budget, and a
  # 1 s sleep let one slow call plus the sleep spend it (main CI 2026-10-08, shard 2).
  run_scenario warned-update-then-missing-bounded "" --budget 3 --update-timeout 2 --fetch-timeout 2 x
  retry_sleep=0
  stub_fail=""
  [ "${rc}" -eq 1 ] || fail "expected exit 1 (budget spent), got ${rc}"
  [ "$(count_lines '^update' "${log}")" -ge 2 ] || fail "expected at least two update invocations (the outage must be ridden out by re-updating)"
  [ "$(count_lines '^unpack' "${log}")" -eq 0 ] || fail "an unpack ran although the package was never found"
  if grep -a -q 'failed deterministically' <<<"${out}"; then fail "a missing package after a warned update was called deterministic"; fi
  if grep -a -q 're-running update once' <<<"${out}"; then fail "a warned update spent the stale-index credit"; fi
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'W: Failed to fetch http://thirdparty.invalid/InRelease' \
    || fail "the MEASURE_FAIL line does not quote the saved update warning's URL"
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'not a repo defect' \
    || fail "a package missing after a warned update (a source failed) was not attributed to the mirror"
  { [ "${elapsed}" -ge 2 ] && [ "${elapsed}" -le 7 ]; } || fail "elapsed ${elapsed}s outside 2..7s"
  stub_fail="fetch:all:locate"
  run_scenario missing-package-bounded "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 100 ] || fail "expected exit 100, got ${rc}"
  [ "$(order "${log}")" = "update,fetch,update,fetch" ] || fail "expected update,fetch,update,fetch (ONE re-update, then fatal)"
  grep -a -q 'failed deterministically (rc=100): E: Unable to locate package x' <<<"${out}" || fail "no deterministic MEASURE_FAIL naming the missing package"
  # The stale path on the UPDATE phase: one re-run, then fatal.
  stub_fail="update:1:stale404"
  run_scenario stale-update-reruns "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  [ "$(order "${log}")" = "update,update,fetch,unpack" ] || fail "expected update,update,fetch,unpack (an update 404 is retried once)"
  stub_fail="update:all:stale404"
  run_scenario stale-update-bounded "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -eq 100 ] || fail "expected exit 100, got ${rc}"
  [ "$(order "${log}")" = "update,update" ] || fail "expected exactly update,update (ONE re-run of a 404, then fatal)"
  grep -a -q 'failed deterministically (rc=100)' <<<"${out}" || fail "no deterministic MEASURE_FAIL for a persistent update 404"

  # 12. unpack-fails: the local dpkg phase failing is a non-zero exit, never swallowed.
  stub_fail="unpack:all:dpkg"
  run_scenario unpack-fails "" --budget 30 --update-timeout 5 --fetch-timeout 5 x
  stub_fail=""
  [ "${rc}" -ne 0 ] || fail "an unpack that failed exited 0"
  [ "${rc}" -eq 100 ] || fail "expected apt's own exit code 100, got ${rc}"
  [ "$(order "${log}")" = "update,fetch,unpack" ] || fail "expected stub call order update,fetch,unpack"
  grep -a -q 'apt unpack failed (rc=100)' <<<"${out}" || fail "no 'apt unpack failed' error line"

  # 13. provides-broken: on PATH but --version fails => do NOT skip, fall through to apt.
  run_scenario provides-broken-version "" \
    --provides ci-apt-broken-tool --budget 12 --update-timeout 2 --fetch-timeout 2 x
  [ "${rc}" -eq 0 ] || fail "expected exit 0, got ${rc}"
  if grep -a -q '^apt-skip:' <<<"${out}"; then fail "skipped although the tool's --version fails"; fi
  grep -a -q 'falling through to apt' <<<"${out}" || fail "no printed reason for falling through"
  [ "$(order "${log}")" = "update,fetch,unpack" ] \
    || fail "expected stub call order update,fetch,unpack"

  # 14. budget-below-floor: a budget under the one-phase minimum is a usage error, not a silent no-attempt.
  min_phase=10
  run_scenario budget-below-floor "" --budget 5 x
  min_phase=1
  [ "${rc}" -eq 2 ] || fail "expected usage exit 2, got ${rc}"
  [ -z "${log}" ] || fail "apt-get was invoked although the budget cannot fit a phase"

  # 15. fetch-budget-exhausted: every fetch hangs. The update ran once, the budget ends the
  # retries, and the unpack NEVER runs.
  run_scenario fetch-budget-exhausted fetch:all \
    --budget 4 --update-timeout 1 --fetch-timeout 1 x
  [ "${rc}" -eq 1 ] || fail "expected exit 1, got ${rc}"
  grep -a -q '^::error::MEASURE_FAIL' <<<"${out}" || fail "no ::error::MEASURE_FAIL line"
  [ "$(count_lines '^update' "${log}")" -eq 1 ] || fail "expected exactly ONE update invocation"
  [ "$(count_lines '^fetch' "${log}")" -ge 2 ] || fail "expected at least two fetch invocations"
  [ "$(count_lines '^unpack' "${log}")" -eq 0 ] || fail "an unpack ran although no fetch ever succeeded"
  { [ "${elapsed}" -ge 3 ] && [ "${elapsed}" -le 9 ]; } || fail "elapsed ${elapsed}s outside 3..9s"

  # 16. unpack-unbounded: a HANGING unpack is not ended by the inner fetch cap. The OUTER
  # timeout (4 s) ends it, rc 124 from the outer binary, after the 1 s fetch cap has long
  # passed, and the wrapper never reports an unpack failure of its own.
  outer_cap=4
  run_scenario unpack-unbounded unpack:1 --budget 12 --update-timeout 1 --fetch-timeout 1 x
  outer_cap=""
  [ "${rc}" -eq 124 ] || fail "expected the OUTER timeout's rc 124, got ${rc}"
  [ "${elapsed}" -ge 3 ] || fail "elapsed ${elapsed}s < 3s: the unpack was ended by the inner ${tb##*/} cap, not left to dpkg"
  if grep -a -q 'apt unpack failed' <<<"${out}"; then fail "the wrapper ended the unpack itself"; fi

  # 17. measure-fail-names-the-source: when the budget runs out on a retryable failure the
  # MEASURE_FAIL line quotes the failing URL and cause, not only apt's generic trailer.
  stub_fail="update:all:net503"
  retry_sleep=1
  run_scenario measure-fail-quotes-the-source "" --budget 2 --update-timeout 1 --fetch-timeout 1 x
  retry_sleep=0
  stub_fail=""
  [ "${rc}" -eq 1 ] || fail "expected exit 1, got ${rc}"
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'Failed to fetch http://mirror.invalid/dists/noble/InRelease  503  Service Unavailable' \
    || fail "the MEASURE_FAIL line does not quote the failing URL and cause"
  grep -a -q '^::warning::apt update attempt failed (rc=100).*Failed to fetch http://mirror.invalid/dists/noble/InRelease' <<<"${out}" \
    || fail "the retry warning does not quote the failing URL"
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'not a repo defect' \
    || fail "a budget spent on a 503 did not say it was a dead or trickling mirror"

  # 18. unclassified-exit-100: wording in neither list retries for the budget (the classifier
  # is inverted on purpose), and the closing message quotes it WITHOUT blaming the mirror.
  stub_fail="update:all:unknown100"
  # retry_sleep stays 0: the assertion below counts update calls inside the budget, and a
  # 1 s sleep let one slow call plus the sleep spend it (main CI 2026-10-08, shard 2).
  run_scenario unclassified-exit-100-no-mirror-blame "" --budget 2 --update-timeout 1 --fetch-timeout 1 x
  retry_sleep=0
  stub_fail=""
  [ "${rc}" -eq 1 ] || fail "expected exit 1 (budget spent), got ${rc}"
  [ "$(count_lines '^update' "${log}")" -ge 2 ] || fail "an unclassified exit 100 was not retried"
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'E: Some brand new apt complaint nobody has classified' \
    || fail "the MEASURE_FAIL line does not quote the unclassified error"
  grep -a '^::error::MEASURE_FAIL' <<<"${out}" | grep -a -q 'add its wording to DETERMINISTIC_RE' \
    || fail "the MEASURE_FAIL line does not tell the reader to classify the wording"
  if grep -a -q 'not a repo defect' <<<"${out}"; then fail "an unclassified exit 100 was blamed on the mirror"; fi

  echo "ci-apt self-test OK: retry-after-hang, fail-on-budget, no-update-rerun, skip-when-present, fall-through-when-absent, deterministic-fail, network-fail-retries, retryable-by-default, deterministic-signatures, update-half-failure, stale-index, unpack-fails, provides-broken-version, budget-below-floor, fetch-budget-exhausted, unpack-unbounded, measure-fail-names-the-source, warned-update-then-missing-bounded, unclassified-exit-100-no-mirror-blame."
}

case "${1:-}" in
  --self-test) self_test ;;
  install) shift; do_install "$@" ;;
  "") die_usage "missing subcommand" ;;
  *) die_usage "unknown subcommand: $1" ;;
esac
