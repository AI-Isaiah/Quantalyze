#!/usr/bin/env bash
# scripts/derive-restore-channels.sh — Phase 164.8.4-05.
# Closes SC-3 / [164.8.2-CHANNEL-ALLOWLIST-STALE].
#
# Derives the set of diagnostic-channel basenames staged into the
# world-readable test-restore artifact, by scanning what the TWO PRODUCERS'
# own SOURCE TEXT declares as write targets into the shared output directory —
# never a hand-typed list, and never a runtime directory glob.
#
# ⛔ A RUNTIME GLOB OVER THE OUTPUT DIRECTORY IS THE CLOSED
# [164.8.2-REFUSAL-STILL-PUBLISHES] DEFECT. A reviewer proved it by seeding a
# file nobody writes (`future-census.out`, carrying reconstructed CREATE
# POLICY DDL) and watching it reach the world-readable artifact. This script
# scans DECLARED INTENT in source text, and only that — it must never `ls`,
# `stat` or glob a runtime directory. Re-opening that shape here "to save six
# words" is exactly the mistake the incident is about.
#
# Usage:
#   derive-restore-channels.sh <producer1> <producer2>
#   derive-restore-channels.sh --self-check
#
# Restricted to the three diagnostic extensions (.err/.log/.out) ONLY. The
# producers also declare `.sql` and `.ok` write targets (survivors.sql,
# credential-scan.ok, backup-scan.ok, ...) — those are staged, or refused, by
# a SEPARATE default-DENY path in the staging step, gated on the two scan
# verdicts (`scan_ok`, `backup_ok`), not on this derivation. Widening the
# extension restriction here would sweep that guard's own INPUT
# (credential-scan.ok) and the content `.sql` files into the diagnostic loop —
# load-bearing, not cosmetic.
set -euo pipefail

GATE="derive-restore-channels"

fail() {
  echo "::error::${GATE}: $*" >&2
  exit 1
}

# The two output-directory variable names the producers use for the directory
# that becomes the staged artifact's SOURCE:
#   - scripts/restore-test-from-baseline.sh writes via `$RESTORE_OUT_DIR`.
#   - .github/workflows/test-restore-from-baseline.yml writes via `${outdir}`,
#     and itself does `export RESTORE_OUT_DIR="${RUNNER_TEMP}/test-backup"` —
#     the SAME directory `outdir` points at, handing that path to the script.
# Anchoring on these two names (rather than any bash variable at all) is what
# excludes the restore script's own SELFTEST_TMPD/SELFTEST_PGD self-test
# scratch files and the workflow's RUNNER_TEMP-rooted activity.err/
# ancestry.err/mutex-log — none of those land in the directory that gets
# staged. Both names are scanned against BOTH producer arguments (rather than
# assigning one name per argument), so the derivation is order-independent
# and keeps working if a producer's write targets move between the two names.
# [164.8.4] IN-02 — THE BASENAME MUST BE A LITERAL. A producer writing
# "${outdir}/${dynamic_name}.err" is NOT matched, so that channel is never
# derived and therefore never staged. This fails in the SAFE direction (a
# channel that cannot be derived stays unpublished, which is what default-DENY
# means here) and is recorded rather than fixed. ⛔ A future producer needing a
# dynamically-named diagnostic channel must NOT answer this by relaxing the
# pattern toward a glob — that re-opens the publish-by-default defect this
# derivation replaced. Give the channel a literal name instead.
WRITE_TARGET_RE='\b(RESTORE_OUT_DIR|outdir)\}?/[A-Za-z0-9_.-]+\.(err|log|out)'

# Scans one producer's source text for its declared write targets and prints
# their basenames, one per line (zero lines is a legitimate result for THIS
# producer — the empty-derivation check happens after the union, in derive()).
# Exits non-zero via `fail` if the producer path is absent or unreadable: an
# unreadable producer is not a producer with no channels.
scan_producer() {
  local producer="$1"
  if [ ! -r "$producer" ]; then
    fail "producer '${producer}' is absent or unreadable — refusing to derive (an unreadable producer is not a producer with no channels)."
  fi
  local matches rc
  # grep -a: this repo has a file elsewhere (src/lib/wizardErrors.test.ts)
  # carrying a deliberate NUL byte, and a blind (non -a) grep is silently
  # blind to it — reporting "no match", which here would silently mean "this
  # producer declares nothing". Every scan in this repo uses -a for exactly
  # that reason. rc-bounded: 0 = matches found, 1 = no match (not an error —
  # a producer may legitimately declare targets under only one of the two
  # directory variables), >=2 = grep itself broke and must be treated as an
  # ERROR, never as an empty result.
  set +e
  matches="$(grep -aoE "$WRITE_TARGET_RE" "$producer")"
  rc=$?
  set -e
  if [ "$rc" -ge 2 ]; then
    fail "grep itself failed scanning '${producer}' (exit ${rc}) — treated as an ERROR, never as an empty result."
  fi
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$matches" | sed -E 's#.*/##'
  fi
  return 0
}

# Derives the union of both producers' declared channels, sorted and
# de-duplicated. Fails loud, printing the measured per-producer raw match
# counts, if the union is empty.
derive() {
  local p1="$1" p2="$2"
  local c1 c2 combined n1 n2
  c1="$(scan_producer "$p1")"
  c2="$(scan_producer "$p2")"
  n1="$(printf '%s\n' "$c1" | grep -c '.' || true)"
  n2="$(printf '%s\n' "$c2" | grep -c '.' || true)"
  combined="$(printf '%s\n%s\n' "$c1" "$c2" | grep -v '^$' | sort -u || true)"
  if [ -z "$combined" ]; then
    fail "derivation over '${p1}' (${n1} raw match(es)) and '${p2}' (${n2} raw match(es)) yielded ZERO diagnostic channels. Both producers demonstrably write diagnostics today, so an empty result means the scan broke — a producer's shape changed, or WRITE_TARGET_RE no longer matches it — not that the channels vanished. Refusing to stage anything (default-DENY)."
  fi
  printf '%s\n' "$combined"
}

# Builds two scratch producers under a temp directory, each declaring a known
# synthetic write target, and asserts: (1) both synthetic diagnostic targets
# are derived, (2) a synthetic NON-diagnostic-extension target is NOT. The
# synthetic names are obviously fabricated (`zzz-selfcheck-*`) and deliberately
# do not name any real diagnostic channel anywhere in this file — this file
# embeds no known channel name, by design (see the header comment).
self_check() {
  local tmpd p1 p2 derived
  tmpd="$(mktemp -d)" || fail "self-check: could not create a scratch directory."
  trap 'rm -rf "'"$tmpd"'"' EXIT
  p1="$tmpd/scratch-producer-one.sh"
  p2="$tmpd/scratch-producer-two.sh"
  cat > "$p1" <<'SCRATCH_PRODUCER_ONE'
#!/usr/bin/env bash
# scratch producer one — derive-restore-channels.sh --self-check fixture ONLY.
# Never a real producer; never referenced by the actual restore/workflow.
echo "x" > "${outdir}/zzz-selfcheck-alpha.err"
SCRATCH_PRODUCER_ONE
  cat > "$p2" <<'SCRATCH_PRODUCER_TWO'
#!/usr/bin/env bash
# scratch producer two — derive-restore-channels.sh --self-check fixture ONLY.
# Never a real producer; never referenced by the actual restore/workflow.
echo "x" > "${RESTORE_OUT_DIR}/zzz-selfcheck-beta.out"
echo "x" > "${RESTORE_OUT_DIR}/zzz-selfcheck-gamma.sql"
SCRATCH_PRODUCER_TWO
  derived="$(derive "$p1" "$p2")" || fail "self-check: the derivation over the two scratch producers failed — it must succeed given two producers that each declare a diagnostic write target."
  if ! printf '%s\n' "$derived" | grep -qx 'zzz-selfcheck-alpha.err'; then
    fail "self-check: expected 'zzz-selfcheck-alpha.err' in the derived set; got: $(printf '%s' "$derived" | tr '\n' ' ')"
  fi
  if ! printf '%s\n' "$derived" | grep -qx 'zzz-selfcheck-beta.out'; then
    fail "self-check: expected 'zzz-selfcheck-beta.out' in the derived set; got: $(printf '%s' "$derived" | tr '\n' ' ')"
  fi
  if printf '%s\n' "$derived" | grep -qx 'zzz-selfcheck-gamma.sql'; then
    fail "self-check: non-diagnostic-extension target 'zzz-selfcheck-gamma.sql' leaked into the derived set — the extension restriction is broken."
  fi
  echo "derive-restore-channels.sh --self-check OK: two synthetic diagnostic targets derived (zzz-selfcheck-alpha.err, zzz-selfcheck-beta.out); one synthetic non-diagnostic-extension target (zzz-selfcheck-gamma.sql) correctly excluded."
}

main() {
  case "${1:-}" in
    --self-check)
      self_check
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: derive-restore-channels.sh <producer1> <producer2>
       derive-restore-channels.sh --self-check
USAGE
      ;;
    *)
      if [ "$#" -ne 2 ]; then
        fail "expected exactly two producer paths as arguments (got $#). Usage: derive-restore-channels.sh <producer1> <producer2>"
      fi
      derive "$1" "$2"
      ;;
  esac
}

main "$@"
