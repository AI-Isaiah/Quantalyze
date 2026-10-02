#!/usr/bin/env bash
# Install pg_cron for the postgresql@16 keg the pg-lane boots on macOS.
#
# WHY THIS EXISTS. Phase 164.4.1 makes `scripts/pg-lane/run.sh` preload pg_cron
# on every lane, because five idiom SQL gate files probe `pg_extension` for it
# and three read `cron.job.command` as an ORACLE. On ubuntu CI that is one apt
# line (see the `Provision pg_cron` step in .github/workflows/ci.yml). On macOS
# there was no route at all: 164.4.1-RESEARCH built it BY HAND on the authoring
# box on 2026-09-04, which made that box SPECIAL — a fresh clone has nothing,
# and the lane would refuse to start with a diagnosis nobody could act on.
# This script is that hand-build, made repeatable. RESEARCH Pitfall 6.
#
#   bash scripts/pg-lane/install-pg-cron-macos.sh              # check if present, else install
#   bash scripts/pg-lane/install-pg-cron-macos.sh --check      # report only; exit 1 naming what is missing
#   bash scripts/pg-lane/install-pg-cron-macos.sh --install    # idempotent; no rebuild unless --force
#   bash scripts/pg-lane/install-pg-cron-macos.sh --force      # rebuild even when already installed
#   bash scripts/pg-lane/install-pg-cron-macos.sh --uninstall  # remove exactly what this script writes
#
# ENV: PGBIN=<dir containing pg_config> names the server binaries explicitly,
# exactly as the lane honours it (scripts/pg-lane/run.sh:252 takes PGBIN over
# its own resolve_pgbin). Set it when a pg_ctl on PATH belongs to a different
# keg than the one the lane should boot. Setting it ALSO skips the PATH-vs-keg
# agreement refusal below — the two programs read the SAME variable, so they
# agree FOR AS LONG AS PGBIN STAYS IN THE ENVIRONMENT. It must still name a
# major-16 keg; that check is not skippable and has no env-var bypass.
#
# ⛔ EXPORT it. `PGBIN=… bash scripts/pg-lane/install-pg-cron-macos.sh` — the
# natural shape, and the one the usage lines above are un-prefixed for — is a
# ONE-SHOT assignment scoped to that single command. It does not reach a LATER
# `bash scripts/pg-lane/run.sh` in the same shell, and that is a real failure,
# not a pedantic one: install into the @16 keg via a one-shot PGBIN, then run
# the lane with PGBIN unset, and resolve_pgbin takes `pg_ctl` on PATH, boots
# @18, and finds no pg_cron there. Use `export PGBIN=<dir>` once, then run both.
#
# ⛔ NOT VIA HOMEBREW'S pg_cron FORMULA. Its `depends_on` names postgresql@17
# and postgresql@18 only, so it emits no @16 artifact; an extension library
# built for another server major cannot load into 16.13, and the resulting
# failure is byte-identical to "not installed at all" (RESEARCH Pitfall 1).
# This script builds the pinned upstream tag from source instead, and touches
# no formula other than the postgresql@16 keg it installs into.
#
# ⛔ WHY IT WRITES INTO THE KEG. PostgreSQL 16 has no `extension_control_path`
# GUC — that is PG18 — so `CREATE EXTENSION pg_cron` can only find the control
# file in the server's OWN sharedir. A scratch-prefix install is not viable on
# 16 for the control file, and the gates need the EXTENSION, not just the
# worker. `--uninstall` removes exactly the paths written here and nothing else.
set -euo pipefail

# --------------------------------------------------------------------------
# Supply-chain pins. The tag is pinned; the archive is verified before any of
# its bytes are executed by `make`.
#
# ⭐ THE HASH WAS MEASURED, THEN CORROBORATED BY AN INDEPENDENT PUBLISHER.
# Computed locally 2026-09-04 with `shasum -a 256` on the download, and the same
# digest is published for the same URL in Homebrew core's pg_cron formula
# (`Formula/p/pg_cron.rb`, fetched from raw.githubusercontent.com the same day).
# Two independent sources agreeing on one digest is what makes this a pin rather
# than a transcription of whatever the network happened to serve.
# --------------------------------------------------------------------------
PG_CRON_TAG="v1.6.7"
PG_CRON_SHA256="d950bc29155f31017567e23a31d268ff672e98276c0e9d062512fb7870351f03"
PG_CRON_URL="https://github.com/citusdata/pg_cron/archive/refs/tags/${PG_CRON_TAG}.tar.gz"

REQUIRED_MAJOR="16"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANE_SH="$SCRIPT_DIR/run.sh"
REPO=$(cd "$SCRIPT_DIR/../.." && pwd)
ENABLE_MIGRATION="$REPO/supabase/migrations/20260513094906_enable_pg_cron.sql"

fail() { echo "ERROR: $*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Resolve the SAME server binaries the lane will boot. `PGBIN` is honoured
# first, exactly as run_lane honours it, so a caller pointing the lane at one
# keg cannot silently have the extension installed next to another.
# --------------------------------------------------------------------------
resolve_pgbin() {
  local d
  if [ -n "${PGBIN:-}" ]; then echo "$PGBIN"; return 0; fi
  for d in /opt/homebrew/opt/postgresql@*/bin; do
    if [ -x "$d/pg_config" ]; then echo "$d"; return 0; fi
  done
  echo "ERROR: no Homebrew postgresql@* keg found under /opt/homebrew/opt." >&2
  echo "       Set PGBIN=<dir containing pg_config> to name one explicitly." >&2
  return 1
}

# Record whether PGBIN came from the CALLER before resolve_pgbin overwrites it.
# The agreement guard below reasons only about the case where this script had to
# GUESS which keg to use; an explicitly-set PGBIN is not a guess, and run.sh:252
# honours the same variable first, so the two cannot disagree FOR AS LONG AS
# PGBIN STAYS IN THE ENVIRONMENT. ⚠️ That proviso is the whole of the guarantee,
# and a one-shot `PGBIN=… bash …/install-pg-cron-macos.sh` does not satisfy it:
# the variable is gone by the next command, so a later lane run resolves afresh
# and can boot a different keg than the one just installed into. Skipping the
# guard here is therefore trust in the CALLER's environment, not a proof.
if [ -n "${PGBIN:-}" ]; then PGBIN_EXPLICIT=1; else PGBIN_EXPLICIT=""; fi

PGBIN=$(resolve_pgbin) || exit 1
PGC="$PGBIN/pg_config"
[ -x "$PGC" ] || fail "PGBIN=$PGBIN has no executable pg_config"

# ⛔ The lane's own resolve_pgbin prefers `pg_ctl` on PATH over the keg glob. If
# those disagree, this script would install next to binaries the lane never
# boots — an install that succeeds and buys nothing, which is the silent-degrade
# shape phase 164.4.1 exists to remove. Refuse instead of guessing.
#
# ⚠️ Scoped to the GUESSING case only. run.sh:252 is `if [ -z "${PGBIN:-} ]; then
# PGBIN=$(resolve_pgbin)`, so an EXPORTED PGBIN wins in BOTH programs and the
# disagreement this guard describes cannot arise while it is set — firing it
# there refused the operator who did the correct thing (naming the @16 keg on a
# box whose PATH pg_ctl is @18) and sent them, via the old remediation text,
# straight into the REQUIRED_MAJOR refusal below. ⛔ What the skip does NOT buy
# is agreement with a lane run that no longer sees PGBIN: a one-shot prefix on
# THIS command is scoped to this command, so the guard is being traded for the
# caller keeping the variable exported. The remediation text below says so. There is deliberately no env-var kill switch:
# the previous `PGBIN_CHECKED` bypass was set nowhere in the repo, documented
# nowhere, and silently disabled a safety guard. PGBIN is the documented
# override, and it is one the lane honours identically.
if [ -z "$PGBIN_EXPLICIT" ] && command -v pg_ctl >/dev/null 2>&1; then
  path_bin=$(dirname "$(command -v pg_ctl)")
  if [ "$path_bin" != "$PGBIN" ]; then
    fail "$(printf '%s\n' \
      "the lane and this script would resolve DIFFERENT PostgreSQL binaries:" \
      "  scripts/pg-lane/run.sh would boot: $path_bin  (pg_ctl on PATH wins there)" \
      "  this script would install into:    $PGBIN" \
      "Installing pg_cron for the second would leave the first without it." \
      "EXPORT PGBIN to name ONE keg for both — this guard then has nothing to" \
      "compare and is skipped:" \
      "  export PGBIN=$path_bin   # if that is the major-$REQUIRED_MAJOR keg you want the lane on" \
      "  export PGBIN=$PGBIN   # if it is not; the lane will honour this too" \
      "⛔ It must be EXPORTED, not one-shot. A \`PGBIN=... bash $0\` prefix is" \
      "scoped to that single command and is GONE by the time you run" \
      "scripts/pg-lane/run.sh, which then resolves afresh and can boot the keg" \
      "you did not install into — an install that succeeds and buys nothing." \
      "Whichever you pick must be major $REQUIRED_MAJOR or the next check refuses" \
      "it. Taking the stray pg_ctl off PATH also works.")"
  fi
fi

PG_VERSION_RAW=$("$PGC" --version)
PG_MAJOR=$(echo "$PG_VERSION_RAW" | awk '{print $2}' | cut -d. -f1)
if [ "$PG_MAJOR" != "$REQUIRED_MAJOR" ]; then
  fail "$(printf '%s\n' \
    "$PGC reports '$PG_VERSION_RAW' (major $PG_MAJOR), not major $REQUIRED_MAJOR." \
    "ubuntu-latest CI runs PostgreSQL 16, and success criterion 1 of phase" \
    "164.4.1 is that CI and the authoring box measure the SAME corpus. Building" \
    "pg_cron against another major would split them, and the resulting library" \
    "could not load into a 16 postmaster anyway. Point PGBIN at a $REQUIRED_MAJOR keg.")"
fi

PKGLIBDIR=$("$PGC" --pkglibdir)
SHAREDIR=$("$PGC" --sharedir)
EXTDIR="$SHAREDIR/extension"
CONTROL="$EXTDIR/pg_cron.control"
LIB="$PKGLIBDIR/pg_cron.dylib"

# The MEASURED install set, 2026-09-04 on this keg: 1 library + 1 control file +
# 8 SQL scripts (the 1.0 base plus seven upgrade paths) = 10 paths.
# ⚠️ 164.4.1-RESEARCH calls this "the nine paths" and then lists ten; the count
# in that prose is an arithmetic slip. `--uninstall` removes the measured SET,
# not the stated number — and it removes nothing it did not name.
INSTALLED_SQL=(
  "$EXTDIR/pg_cron--1.0.sql"
  "$EXTDIR/pg_cron--1.0--1.1.sql"
  "$EXTDIR/pg_cron--1.1--1.2.sql"
  "$EXTDIR/pg_cron--1.2--1.3.sql"
  "$EXTDIR/pg_cron--1.3--1.4.sql"
  "$EXTDIR/pg_cron--1.4--1.4-1.sql"
  "$EXTDIR/pg_cron--1.4-1--1.5.sql"
  "$EXTDIR/pg_cron--1.5--1.6.sql"
)

# --------------------------------------------------------------------------
# --check — report, and exit 1 NAMING the first missing path. "could not find
# it" and "found it" must not share an exit code.
# --------------------------------------------------------------------------
do_check() {
  local default_version="(unreadable)"
  echo "server binaries: $PGBIN"
  echo "server version:  $PG_VERSION_RAW"
  if [ ! -f "$LIB" ]; then
    echo "library:         MISSING -> $LIB"
    echo "ERROR: pg_cron is not installed for this keg. Run:  bash $0 --install" >&2
    return 1
  fi
  echo "library:         $LIB"
  if [ ! -f "$CONTROL" ]; then
    echo "control file:    MISSING -> $CONTROL"
    echo "ERROR: the library is present but the control file is not, so CREATE EXTENSION" >&2
    echo "       pg_cron cannot run (PG16 has no extension_control_path). Run: bash $0 --force" >&2
    return 1
  fi
  default_version=$(awk -F"'" '/^default_version/ {print $2}' "$CONTROL")
  echo "control file:    $CONTROL"
  echo "default_version: ${default_version:-(absent from the control file)}"
  return 0
}

# --------------------------------------------------------------------------
# --install — build the pinned tag from source against THIS keg's pg_config.
# --------------------------------------------------------------------------
do_install() {
  local build sdk cppflags ldflags computed
  # OUTSIDE the repo on purpose: a build tree under the checkout would show up
  # as untracked files and, worse, inside the mutation runner's global
  # dirty-checkout assertion.
  build=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$build'" EXIT

  echo "=== fetching $PG_CRON_URL ==="
  curl -sSL -o "$build/pg_cron.tar.gz" "$PG_CRON_URL" \
    || fail "could not download $PG_CRON_URL"

  computed=$(shasum -a 256 "$build/pg_cron.tar.gz" | awk '{print $1}')
  echo "sha256 (computed): $computed"
  echo "sha256 (pinned):   $PG_CRON_SHA256"
  if [ "$computed" != "$PG_CRON_SHA256" ]; then
    fail "$(printf '%s\n' \
      "sha256 MISMATCH on $PG_CRON_URL." \
      "  expected: $PG_CRON_SHA256" \
      "  got:      $computed" \
      "Nothing was built and nothing was installed. Either the tag moved or the" \
      "download was tampered with; do NOT re-pin the constant to the new digest" \
      "without establishing where the new bytes came from.")"
  fi

  tar xzf "$build/pg_cron.tar.gz" -C "$build"
  local src="$build/pg_cron-${PG_CRON_TAG#v}"
  [ -d "$src" ] || fail "unpacked archive has no $src directory"

  # ------------------------------------------------------------------------
  # ⚠️ BUILD TRAP 1 — PG_LDFLAGS=-lintl.
  # MEASURED failure when omitted: the link step cannot resolve libintl symbols
  # on macOS (pg_cron issue #269). Homebrew's own formula sets the same flag.
  #
  # ⚠️ BUILD TRAP 2 — the keg's pg_config emits a STALE -isysroot.
  # MEASURED 2026-09-04: `pg_config --cppflags` and `--ldflags` both carry
  # `-isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk`, an SDK
  # that DOES NOT EXIST on this box. Both must be sanitised and re-pointed at
  # the live SDK. Sanitising only ONE gets you a clean COMPILE and then fails at
  # link with `ld: library 'System' not found` — the failure that reads as a
  # broken toolchain rather than as a stale flag. `COPT=` does not work either:
  # the stale flag arrives via CPPFLAGS, clang sees it last, and the last
  # -isysroot wins.
  # ------------------------------------------------------------------------
  sdk=$(xcrun --show-sdk-path)
  [ -d "$sdk" ] || fail "xcrun --show-sdk-path returned '$sdk', which is not a directory"
  cppflags="$("$PGC" --cppflags | sed 's|-isysroot [^ ]*||') -isysroot $sdk"
  ldflags="$("$PGC" --ldflags  | sed 's|-isysroot [^ ]*||') -isysroot $sdk"
  echo "=== building pg_cron ${PG_CRON_TAG} against $PGC (SDK: $sdk) ==="
  make -C "$src" install \
    PG_CONFIG="$PGC" \
    PG_LDFLAGS=-lintl \
    CPPFLAGS="$cppflags" \
    LDFLAGS="$ldflags"

  echo "=== install written; re-checking ==="
  do_check || fail "the build reported success but --check cannot see the artifacts"
}

# --------------------------------------------------------------------------
# --uninstall — remove EXACTLY the measured set above, and nothing else.
# --------------------------------------------------------------------------
do_uninstall() {
  local p removed=0
  for p in "$LIB" "$CONTROL" "${INSTALLED_SQL[@]}"; do
    if [ -f "$p" ]; then
      rm -f "$p"
      echo "removed $p"
      removed=$((removed + 1))
    else
      echo "absent  $p"
    fi
  done
  echo "=== removed $removed path(s); the postgresql@16 keg is otherwise untouched ==="
}

# --------------------------------------------------------------------------
# PROVE IT LOADS — through the REAL lane, not by looking at the filesystem.
# A file on disk is not a loaded extension: the library must satisfy
# shared_preload_libraries at postmaster start AND CREATE EXTENSION must find
# the control file. Only a lane exercises both, so this script's exit status IS
# the lane's.
# --------------------------------------------------------------------------
prove_via_lane() {
  local proof gate
  proof=$(mktemp -d)
  gate="$proof/pgcron-version.sql"
  cat >"$gate" <<'SQL'
DO $$
DECLARE v_ver text;
BEGIN
  SELECT extversion INTO v_ver FROM pg_extension WHERE extname = 'pg_cron';
  IF v_ver IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (INSTALL-PROOF): pg_extension has no pg_cron row on a lane that applied 20260513094906';
  END IF;
  RAISE NOTICE 'INSTALL-PROOF OK: pg_cron % is loaded on a real lane', v_ver;
END $$;
SQL
  echo "=== proving the install through a real lane ($LANE_SH) ==="
  # set +e / rc / set -e, following scripts/pg-lane/run.sh's own self-test arms:
  # under bare `set -e` a RED lane would abort this function before the `rm`,
  # leaking the proof directory on exactly the path where a human is most likely
  # to re-run and leak again. The lane's status is still this script's status —
  # it is returned, not swallowed.
  local rc
  set +e
  PGBIN="$PGBIN" bash "$LANE_SH" \
    --workdir "$proof/lane" \
    --apply "$SCRIPT_DIR/fixtures/01-fixture-core.sql" "$ENABLE_MIGRATION" \
    --gate "$gate"
  rc=$?
  set -e
  rm -rf "$proof"
  if [ "$rc" -ne 0 ]; then
    echo "ERROR: the install is on disk but a real lane could NOT load pg_cron (lane exit $rc)." >&2
    echo "       Files present is not the same claim as extension loaded; read the lane output above." >&2
  fi
  return "$rc"
}

MODE=""
FORCE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)     MODE="check";     shift ;;
    --install)   MODE="install";   shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --force)     MODE="${MODE:-install}"; FORCE=1; shift ;;
    # Derived, not a pinned offset — same reason as run.sh's --help: a
    # hand-maintained line number truncates the header the next time it grows.
    -h|--help)   awk 'NR > 1 { if (!/^#/) exit; print }' "$0"; exit 0 ;;
    *) fail "unknown argument: $1 (see --help)" ;;
  esac
done

case "$MODE" in
  check)
    do_check
    ;;
  uninstall)
    do_uninstall
    ;;
  install)
    # Idempotent: an install on a box that already has it is a check, not a
    # rebuild — unless --force says otherwise.
    if [ -z "$FORCE" ] && do_check >/dev/null 2>&1; then
      echo "=== pg_cron is already installed for this keg; not rebuilding (use --force) ==="
      do_check
    else
      do_install
    fi
    prove_via_lane
    ;;
  "")
    # No mode given: check when present, install when absent.
    if do_check >/dev/null 2>&1; then
      do_check
    else
      do_install
      prove_via_lane
    fi
    ;;
esac
