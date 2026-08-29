#!/usr/bin/env bash
# VAC-04 — repo-snapshot-vs-PROD function-body drift gate (Phase 164.3).
#
# ── THE DEFECT CLASS THIS EXISTS FOR ─────────────────────────────────────────
# DRIFT-02 nearly shipped a GDPR regression and was caught by a HUMAN reading a
# diff. A whole-body `CREATE OR REPLACE FUNCTION` overwrites whatever is live —
# including a surgical patch applied directly to PROD that exists nowhere in
# this repository. `sql-function-snapshot.yml` cannot see that: it proves
# migrations produce the committed bodies, which is a statement about the repo,
# not about PROD. This gate is the missing half — it reads PROD.
#
# ── WHAT IT COMPARES ─────────────────────────────────────────────────────────
# LEFT  : supabase/schema/functions/<name>.sql — the committed canonical body.
#         VERIFIED 2026-08-28: 118 bodies exist, including the three the phase
#         criterion names. This IS the canonical left-hand side (D-12); the
#         gate does not try to reconstruct an intended body from migrations.
# RIGHT : PROD's live definition, obtained through an INJECTABLE fetcher so the
#         gate's logic is testable without touching production.
# Both sides are comment-stripped and whitespace-normalized by
# scripts/sql-body-normalize.mjs before matching (D-05 — MEASURED: PROD's
# 7-param `_enqueue_compute_job_internal` reports 0 `INTO STRICT` in code and 1
# including comments).
#
# ── NON-NEGOTIABLES ──────────────────────────────────────────────────────────
# 1. NEVER SKIP. The credential check is the FIRST thing this script does and
#    an absent credential is `exit 1`, never `exit 0` and never a `::notice::`
#    skip. D-11's reasoning survives its supersession by D-12: shipping this as
#    a skip would be this phase committing SKIP-01, its own named defect.
# 2. NEVER PRINT PROD TEXT. This repository is PUBLIC. Output carries function
#    names, argument counts, sha256 hashes and differing-line counts — nothing
#    else. No DSN, no host, no username, no project ref, no body. (T-164.3-04;
#    redaction precedent: the sql-tests mutex step, ci.yml:1237-1245.)
# 3. NEVER PASS SOMETHING IT DID NOT COMPARE. A fetcher that errors, a body it
#    cannot extract, or a missing snapshot are all `exit 1`. "Could not
#    measure" and "measured zero problems" do not share a code path here.
#
# ── THE ACKNOWLEDGMENT PRAGMA ────────────────────────────────────────────────
# Drift is sometimes legitimate (the PR is deliberately replacing an
# out-of-band patch). To wave it through, the PR's migration must carry
#     -- prod-body-ack: <sha256>
# where <sha256> is the hash of the NORMALIZED PROD body, which this gate
# prints when it fails. The hash BINDS the acknowledgment to the exact PROD
# content: a stale ack, or one written without looking, does not match. That is
# DRIFT-02b's claim-vs-thing requirement made mechanical.
#
# ── ENVIRONMENT ──────────────────────────────────────────────────────────────
# Required credentials (presence only — values are never read or printed here):
#   SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD
# Required input:
#   BODY_FETCH_CMD    command prefix, invoked as `$BODY_FETCH_CMD <fn-name>`;
#                     stdout is the live definition text, empty = absent in
#                     PROD. Word-split on IFS, so its arguments must not
#                     contain spaces (RUNNER_TEMP paths do not).
# Optional:
#   CHANGED_MIGRATIONS  newline-separated migration paths. When unset, derived
#                       from `git merge-base HEAD $BASE_REF`.
#   BASE_REF            default origin/main
#   SNAPSHOT_DIR        default supabase/schema/functions
#   NORMALIZER          default scripts/sql-body-normalize.mjs
#
# ── USAGE (CI pastes this verbatim — mode identity) ──────────────────────────
#   bash scripts/prod-body-drift-check.sh
set -euo pipefail

GATE="VAC-04 repo-vs-PROD function-body drift gate"

fail() {
  echo "::error::${GATE}: $*"
  exit 1
}

# ── 1. CREDENTIALS: FIRST, UNCONDITIONAL, AND FATAL WHEN ABSENT ──────────────
# Deliberately before ANY work detection, so this gate can never rationalise an
# exit 0 out of "there was nothing to do" while it is unconfigured.
for var in SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "::error::${GATE}: ${var} is not configured, so this gate CANNOT read PROD."
    echo "::error::This is a HARD FAILURE, not a skip. A gate that reports success while"
    echo "::error::unconfigured is the SKIP-01 defect this phase exists to remove: it would"
    echo "::error::be green having checked nothing, on the workflow guarding production"
    echo "::error::migrations. Configure the secret, or delete this gate deliberately."
    exit 1
  fi
done

[ -n "${BODY_FETCH_CMD:-}" ] || fail "BODY_FETCH_CMD is unset — there is no way to read PROD bodies, and a gate that cannot read cannot pass."
command -v node >/dev/null 2>&1 || fail "node is not on PATH; the shared normalizer cannot run."

SNAPSHOT_DIR="${SNAPSHOT_DIR:-supabase/schema/functions}"
NORMALIZER="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
BASE_REF="${BASE_REF:-origin/main}"
[ -f "$NORMALIZER" ] || fail "normalizer not found at ${NORMALIZER}."
[ -d "$SNAPSHOT_DIR" ] || fail "committed snapshot dir not found at ${SNAPSHOT_DIR}."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 2. WHICH MIGRATIONS THIS PR TOUCHES ──────────────────────────────────────
if [ -n "${CHANGED_MIGRATIONS:-}" ]; then
  printf '%s\n' "$CHANGED_MIGRATIONS" | sed '/^[[:space:]]*$/d' > "$TMP/changed.txt"
else
  MERGE_BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)"
  # Failing closed here is the existing dry-run step's own convention
  # (migration-drift-check.yml: "Could not resolve merge base; failing closed").
  # An unresolvable merge base means the file list is unknown, not empty.
  [ -n "$MERGE_BASE" ] || fail "could not resolve the merge base against ${BASE_REF}; failing closed rather than checking an unknown file set."
  git diff --diff-filter=ACMR --name-only "$MERGE_BASE"...HEAD -- 'supabase/migrations/*.sql' > "$TMP/changed.txt" || true
fi

# Read into an array rather than re-splitting an unquoted command substitution
# at every use site. `mapfile` is avoided deliberately: this script must run
# identically under the bash a developer has locally (macOS ships 3.2) and the
# runner's bash 5 — mode identity, Pitfall 2.
CHANGED_FILES=()
while IFS= read -r _line; do
  [ -n "$_line" ] && CHANGED_FILES+=("$_line")
done < "$TMP/changed.txt"

CHANGED_COUNT="${#CHANGED_FILES[@]}"
if [ "${CHANGED_COUNT:-0}" -eq 0 ]; then
  # HONEST EXIT 0, and narrowly so: the merge base RESOLVED and the diff is
  # genuinely empty. This workflow's paths filter also matches edits to the
  # workflow file itself, which is exactly how a run reaches here with no
  # migration changes. It is NOT the F11 empty-glob trap — an unresolvable
  # merge base above is a hard failure, so "could not measure" never lands here.
  echo "::notice::${GATE}: this PR changes no migration files — nothing to compare against PROD."
  exit 0
fi

echo "Migrations changed by this PR: ${CHANGED_COUNT}"

# Function names come from the shared normalizer, which reads with node `fs` and
# ignores a `CREATE OR REPLACE FUNCTION` that sits inside a comment or a string.
# (Shell grep is silently blind past a NUL byte — measured in this repo.)
node "$NORMALIZER" --function-names "${CHANGED_FILES[@]}" > "$TMP/names.txt" \
  || fail "could not extract function names from the changed migrations."

NAMES=()
while IFS= read -r _line; do
  [ -n "$_line" ] && NAMES+=("$_line")
done < "$TMP/names.txt"

NAME_COUNT="${#NAMES[@]}"
if [ "${NAME_COUNT:-0}" -eq 0 ]; then
  echo "::notice::${GATE}: this PR's migrations define no functions — nothing to compare."
  exit 0
fi

echo "Functions defined or replaced by this PR: ${NAME_COUNT}"
echo ""

# ── 3. COMPARE, PER FUNCTION ─────────────────────────────────────────────────
bad=0
checked=0
matched=0
acked=0
absent=0

for fname in "${NAMES[@]}"; do
  live="$TMP/${fname}.live.sql"
  ferr="$TMP/${fname}.fetch.err"

  # shellcheck disable=SC2086
  if ! $BODY_FETCH_CMD "$fname" > "$live" 2>"$ferr"; then
    # The fetcher's stderr is NOT echoed: it can carry a DSN or a host.
    echo "::error::${GATE}: the PROD body fetcher failed for '${fname}' (stderr withheld — public log)."
    echo "::error::A gate that could not read cannot report a pass."
    bad=1
    continue
  fi

  if [ ! -s "$live" ] || ! grep -aqE '[^[:space:]]' "$live"; then
    echo "  ${fname}: absent in PROD — treated as a NEW function (pass)."
    absent=$((absent + 1))
    continue
  fi

  snapshot="${SNAPSHOT_DIR}/${fname}.sql"
  if [ ! -f "$snapshot" ]; then
    echo "::error::${GATE}: '${fname}' exists in PROD but has no committed body at ${snapshot}."
    echo "::error::The snapshot is STALE. sql-function-snapshot.yml should have caught this;"
    echo "::error::run 'npm run schema:functions' and commit the result."
    bad=1
    continue
  fi

  node "$NORMALIZER" --diff-bodies "$snapshot" "$live" > "$TMP/${fname}.rows" \
    || fail "the normalizer could not compare '${fname}'."

  while IFS=$'\t' read -r status name nargs snap_hash live_hash hunks; do
    [ -n "${status:-}" ] || continue
    case "$status" in
      MATCH)
        checked=$((checked + 1))
        matched=$((matched + 1))
        echo "  ${name}/${nargs}: MATCH (${snap_hash})"
        ;;
      SNAPSHOT_ONLY)
        echo "  ${name}/${nargs}: committed body has no PROD counterpart (advisory — not yet deployed, or an overload dropped upstream)."
        ;;
      SNAPSHOT_MISSING)
        checked=$((checked + 1))
        echo "::error::${GATE}: PROD has ${name}/${nargs} but the committed snapshot has no body for it (stale snapshot)."
        bad=1
        ;;
      UNCOMPARABLE)
        checked=$((checked + 1))
        echo "::error::${GATE}: could not extract a comparable body for ${name}/${nargs}."
        echo "::error::This gate FAILS CLOSED rather than reporting a pass for something it did"
        echo "::error::not compare. Functions with no dollar-quoted body are not supported;"
        echo "::error::acknowledge deliberately with a '-- prod-body-ack:' pragma if intended."
        bad=1
        ;;
      DRIFT)
        checked=$((checked + 1))
        # The ack must carry the hash of the NORMALIZED PROD body, so it cannot
        # be written without having seen this gate's output.
        if grep -aqF -- "-- prod-body-ack: ${live_hash}" "${CHANGED_FILES[@]}" 2>/dev/null; then
          echo "::warning::${GATE}: ${name}/${nargs} DRIFTS from PROD (snapshot ${snap_hash} vs prod ${live_hash}, ${hunks} differing line(s)) — acknowledged by a matching '-- prod-body-ack:' pragma."
          acked=$((acked + 1))
        else
          echo "::error::${GATE}: ${name}/${nargs} — PROD's live body is NOT the committed body."
          echo "::error::  committed sha256 : ${snap_hash}"
          echo "::error::  PROD      sha256 : ${live_hash}"
          echo "::error::  differing lines  : ${hunks}"
          echo "::error::This PR's CREATE OR REPLACE would overwrite whatever produced that PROD"
          echo "::error::body — an out-of-band patch this repository has no record of (DRIFT-02's"
          echo "::error::shape). Inspect PROD's definition, then EITHER fold the difference into"
          echo "::error::the migration, OR — if overwriting it is intended — add this line to the"
          echo "::error::migration to record that you looked:"
          echo "::error::  -- prod-body-ack: ${live_hash}"
          bad=1
        fi
        ;;
      *)
        echo "::error::${GATE}: unrecognised comparator status '${status}' for ${name}. Failing closed."
        bad=1
        ;;
    esac
  done < "$TMP/${fname}.rows"
done

echo ""
echo "${GATE}: ${checked} body comparison(s) — ${matched} match, ${acked} acknowledged drift, ${absent} new function(s)."

if [ "$bad" = 1 ]; then
  exit 1
fi
echo "::notice::${GATE}: no unacknowledged repo-vs-PROD body drift."
exit 0
