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
#                     stdout is the live definition text, empty = the name was
#                     not found in the source it reads. Word-split on IFS, so
#                     its arguments must not contain spaces (RUNNER_TEMP paths
#                     do not).
#   BODY_NAME_INDEX_CMD
#                     command invoked with NO arguments; stdout is the
#                     newline-separated list of function names the fetcher's
#                     source actually contains.
#                     ⛔ WHY THIS IS REQUIRED AND NOT OPTIONAL (WR-04/WR-01):
#                     `BODY_FETCH_CMD` exits 0 with EMPTY stdout for a name it
#                     cannot find, and this gate used to read that as "absent
#                     in PROD — a NEW function (pass)". "Could not extract" and
#                     "genuinely not there" then shared one code path, so any
#                     regression in the extractor's name matching turned EVERY
#                     name into a pass and the whole gate green. The index
#                     makes absence a MEASUREMENT: a name that IS in the index
#                     but yields no body is an extractor failure and exits 1.
#                     An optional index would reinstate the hole for anyone who
#                     forgot to set it, which is the SKIP-01 shape.
#   BODY_NAME_INDEX_XCHECK_CMD
#                     command invoked with NO arguments; a SECOND, INDEPENDENTLY
#                     DERIVED index of the same source.
#                     ⛔ WHY A SECOND ONE EXISTS (SP-C05). The paragraph above
#                     claims the index makes absence "a MEASUREMENT". It did
#                     not: the index and the fetcher were BOTH
#                     `extractFunctionDefs()` over the SAME dump, and that
#                     function silently skips a definition it cannot parse. A
#                     dropped definition was therefore missing from the index
#                     AND from the fetch, so the two AGREED BY CONSTRUCTION and
#                     the gate printed "measured absent — Treated as a NEW
#                     function (pass)". MEASURED 2026-08-29 with the CI-shaped
#                     commands, on `CREATE OR REPLACE FUNCTION
#                     public.sanitize_user$v2(p uuid)` — a `$` in the
#                     identifier is enough — the whole gate exited 0 having
#                     compared nothing. Two readings that share an
#                     implementation are one measurement wearing two hats.
#                     The two indexes are UNIONED: a name is treated as absent
#                     from PROD only when BOTH readings fail to find it. In CI
#                     this is scripts/sql-function-names-naive.mjs, which
#                     imports nothing from the normalizer.
# Optional:
#   PROD_DUMP_SCHEMAS space-separated schemas the fetcher's source covers.
#                     Default "public", matching `supabase db dump --linked
#                     --schema public` in migration-drift-check.yml. A migration
#                     that defines a function in a schema NOT listed here is a
#                     hard failure: the dump cannot see it, so this gate cannot
#                     compare it, and reporting it as a new function would be a
#                     pass for something never looked at. Keep this in step with
#                     the dump command — they are two halves of one claim.
#   CHANGED_MIGRATIONS  newline-separated migration paths. When unset, derived
#                       from `git merge-base HEAD $BASE_REF`.
#   BASE_REF            default origin/main
#   SNAPSHOT_DIR        default supabase/schema/functions
#   NORMALIZER          default scripts/sql-body-normalize.mjs
#   NAIVE_NAMES         default scripts/sql-function-names-naive.mjs — the
#                       independent second reading applied to THIS PR's
#                       migrations, for the same reason
#                       BODY_NAME_INDEX_XCHECK_CMD exists on the PROD side.
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
[ -n "${BODY_NAME_INDEX_CMD:-}" ] || fail "BODY_NAME_INDEX_CMD is unset — without PROD's function-name index this gate cannot tell 'genuinely absent from PROD' from 'the extractor returned nothing', and it would read the second as a pass."
[ -n "${BODY_NAME_INDEX_XCHECK_CMD:-}" ] || fail "BODY_NAME_INDEX_XCHECK_CMD is unset — with ONE index, 'absent from PROD' is measured by the same code that produced the absence, and the gate passes on every definition that code cannot parse (SP-C05, MEASURED). Optional would reinstate that hole for anyone who forgot to set it, which is the SKIP-01 shape."
command -v node >/dev/null 2>&1 || fail "node is not on PATH; the shared normalizer cannot run."

PROD_DUMP_SCHEMAS="${PROD_DUMP_SCHEMAS:-public}"

SNAPSHOT_DIR="${SNAPSHOT_DIR:-supabase/schema/functions}"
NORMALIZER="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
NAIVE_NAMES="${NAIVE_NAMES:-scripts/sql-function-names-naive.mjs}"
BASE_REF="${BASE_REF:-origin/main}"
[ -f "$NORMALIZER" ] || fail "normalizer not found at ${NORMALIZER}."
[ -f "$NAIVE_NAMES" ] || fail "the independent name reader was not found at ${NAIVE_NAMES}. Without a SECOND derivation, 'this PR's migrations define no functions' is a claim the normalizer makes about its own parse (SP-C05)."
# ⛔ The two readings must not be the same program. If they were, the union
# below would be one measurement printed twice — the exact defect SP-C05 named,
# reintroduced by a configuration mistake rather than a code one.
if [ "$(cd "$(dirname "$NORMALIZER")" && pwd)/$(basename "$NORMALIZER")" = "$(cd "$(dirname "$NAIVE_NAMES")" && pwd)/$(basename "$NAIVE_NAMES")" ]; then
  fail "NORMALIZER and NAIVE_NAMES resolve to the SAME file (${NORMALIZER}). Two readings that share an implementation agree by construction; this gate needs two derivations, not two invocations."
fi
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
  # ⛔ SP-C06. This line ended in `|| true`, which converted "could not list the
  # changed files" into "no migration files changed". With the merge base
  # RESOLVED but the diff itself failing (a bad object, a shallow object
  # database, a pathspec error), changed.txt was empty, CHANGED_COUNT was 0, and
  # the run took the "HONEST EXIT 0" branch below — whose own comment asserts
  # that "could not measure" never lands there. `set -e` would have caught it;
  # the `|| true` was what defeated `set -e`.
  set +e
  git diff --diff-filter=ACMR --name-only "$MERGE_BASE"...HEAD -- 'supabase/migrations/*.sql' > "$TMP/changed.txt"
  _diff_rc=$?
  set -e
  [ "$_diff_rc" -eq 0 ] || fail "MEASURE_FAIL: could not enumerate this PR's migration changes (git diff exited ${_diff_rc} against merge base ${MERGE_BASE}). An unreadable file list is not an empty one, and this gate must not read it as 'nothing changed'."
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
node "$NORMALIZER" --function-names "${CHANGED_FILES[@]}" > "$TMP/names.lexer.txt" \
  || fail "could not extract function names from the changed migrations."
# ⛔ SP-C05, LEFT-HAND SIDE. The exit-0 below says "this PR's migrations define
# no functions". That was the NORMALIZER's opinion of its own parse, and the
# normalizer skips a definition it cannot read. MEASURED 2026-08-29: a migration
# whose only content is
#     CREATE OR REPLACE FUNCTION public.sanitize_user$v2(p uuid)
# produced zero names and the gate exited 0 having compared nothing, because a
# `$` in the identifier stops its name reader before the argument list. So the
# claim is now checked against an INDEPENDENT reading (a line-anchored regex,
# no lexer, `$` in the identifier charset, no imports from the normalizer) and
# the two are UNIONED. MEASURED over all 380 .sql files under
# supabase/migrations/ and supabase/schema/functions/: the two readings return
# identical name sets, so the union refuses nothing that exists.
node "$NAIVE_NAMES" "${CHANGED_FILES[@]}" > "$TMP/names.naive.txt" \
  || fail "the independent name reader failed on the changed migrations."
sort -u "$TMP/names.lexer.txt" "$TMP/names.naive.txt" | sed '/^[[:space:]]*$/d' > "$TMP/names.txt"

NAMES=()
while IFS= read -r _line; do
  [ -n "$_line" ] && NAMES+=("$_line")
done < "$TMP/names.txt"

# Names only ONE reading can see are the evidence that the two are not one code
# path. Reported, never swallowed: a name the normalizer cannot see is a name
# `--extract-fn` cannot fetch either, so this gate will FAIL CLOSED on it if
# PROD has it — which is the whole change from the silent pass it used to be.
# LC_ALL=C on BOTH sides: `comm` requires its inputs in the same collation
# order as its own comparison, and a locale mismatch makes it silently emit
# wrong rows instead of failing.
LC_ALL=C comm -13 <(LC_ALL=C sort -u "$TMP/names.lexer.txt") <(LC_ALL=C sort -u "$TMP/names.naive.txt") | sed '/^[[:space:]]*$/d' > "$TMP/names.naive-only.txt"
if grep -aqE '[^[:space:]]' "$TMP/names.naive-only.txt"; then
  echo "::warning::${GATE}: the independent name reader found function definition(s) the normalizer's parser did not:"
  sed 's/^/::warning::  /' "$TMP/names.naive-only.txt"
  echo "::warning::They are included below. The body fetcher shares the normalizer's parser, so if"
  echo "::warning::PROD holds any of them this gate will report an EXTRACTION FAILURE and exit 1"
  echo "::warning::rather than the 'new function — pass' it used to report (SP-C05)."
fi

NAME_COUNT="${#NAMES[@]}"
if [ "${NAME_COUNT:-0}" -eq 0 ]; then
  # ── VAC04-ZERO-PATH-FAILS-CLOSED ───────────────────────────────────────────
  #
  # ⛔ [VAC04-C1]. This branch used to be a one-line `::notice::` and `exit 0`:
  #     "this PR's migrations define no functions — nothing to compare.
  #      (Two independent readings agree; see SP-C05.)"
  # and the parenthesis was doing work it cannot do. TWO READINGS AGREEING IS
  # NOT A MEASUREMENT WHEN THEIR BLIND SPOTS OVERLAP — that is one absence
  # observed twice, not two observations of absence. SP-C05 bought INDEPENDENCE
  # (the two readers do not share an implementation); independence is not
  # COVERAGE.
  #
  # MEASURED 2026-09-01 at bab02576 on the P8 composing shape — one line, two
  # statements, a `$` in the identifier:
  #     SELECT 1; CREATE OR REPLACE FUNCTION public.fn$v2(p uuid) …
  # The line-anchored reader never starts (the line does not BEGIN with
  # `CREATE`); the lexer's `readQualifiedName` stops at the `$`. Both print
  # NOTHING and exit 0, and this gate printed:
  #     "Migrations changed by this PR: 1"
  #     "::notice::… define no functions — nothing to compare. (Two independent
  #      readings agree; see SP-C05.)"                                  exit 0
  # A gate over PRODUCTION function bodies, green, having compared nothing.
  # That is Primitive C's canonical case: a VERDICT not bounded by what was
  # MEASURED. So this path now REFUSES — and prints its evidence FIRST, because
  # a gate that ships a bare conclusion is the same defect one level down
  # (D-12 / SC-7).
  #
  # ⚠️ WHAT THIS COSTS, AND WHO PAYS IT — AMENDED 2026-09-01 (D-13, second
  # refinement). The first fail-closed version refused EVERY migration PR whose
  # changed migrations define no function, not only the exotic composing shape.
  # MEASURED at HEAD over all 262 migrations in this repo: 111 define no
  # function that either structural reader can see, so that version permanently
  # blocked roughly two migration PRs in five — `ALTER TABLE`, `INSERT`, policy
  # and index changes — from a gate whose subject is FUNCTION BODY drift. That
  # satisfies the criterion's letter while making the gate a NUISANCE on
  # legitimate work, and a nuisance gate acquires an escape hatch from whoever
  # is on call at 2am. That is a slower version of the failure this gate exists
  # to prevent. So the zero path now SEPARATES two states that look identical
  # to the two structural readers:
  #
  #   (a) LEGITIMATE zero — the changed migrations genuinely contain no
  #       function definition at all. PASSES, with a notice naming what was
  #       scanned and why the zero is trustworthy.
  #   (b) BLIND zero — a definition IS present and both readers missed it.
  #       REFUSES, exactly as below, with the full evidence block.
  #
  # SC-4 is preserved in letter AND in intent: never exit 0 having compared
  # nothing WHEN THERE WAS SOMETHING TO COMPARE.
  #
  # ── VAC04-ZERO-PATH-TRIPWIRE — the discriminator, and why it stays CRUDE ───
  #
  # ⛔ DO NOT "IMPROVE" THIS INTO A PARSER. Its crudeness is the entire reason
  # it is admissible here. It is a THIRD reading, and its BLIND SPOTS DO NOT OVERLAP
  # the other two precisely because it understands neither statements
  # nor identifiers: it sees the non-line-start shape the line-anchored reader
  # misses, and the `$`-identifier the lexer's `readQualifiedName` misses. Give
  # it structure and it starts sharing their assumptions — and a tripwire that
  # shares the blind spots of the instruments it is checking turns "two
  # independent readings agree" into one absence observed three times, which is
  # the exact defect ([VAC04-C1]) this branch was written to close.
  #
  # It was correctly REJECTED as a REPLACEMENT reader, because it cannot tell
  # code from prose. MEASURED at HEAD: of the 111 migrations no structural
  # reader sees a function in, 3 mention `CREATE … FUNCTION` inside a COMMENT
  # while defining none —
  #     20260515130001_enqueue_compute_job_internal_acl_remediation.sql
  #     20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql
  #     20260517013200_notification_dispatches_recipient_email_lower_idx.sql
  # As a READER those 3 would be false extractions. As a TRIPWIRE they cause a
  # BLOCK — which is FAIL-SAFE, and rare. The measured separation is 108 of 262
  # passing as legitimate zeros against 3 of 262 blocking on a comment (D-10:
  # thresholds by measurement, wide separation, never taste). Erring toward the
  # block is the correct direction for a gate over PRODUCTION function bodies.
  #
  # ⛔ MIGRATION PRs ARE STILL HELD UNTIL PHASE 164.3.1 AND PHASE 164.4 HAVE
  #    BOTH LANDED. This refinement narrows WHICH PRs are held; it does not
  #    retire the sequencing (founder decision, amended D-07, 2026-09-01). If
  #    you are reading this because your PR is blocked here, the gate is
  #    WORKING. Route the ordering, not the gate. Do NOT revert this branch to
  #    an unconditional `exit 0`, and do NOT add an acknowledgment pragma or
  #    any other human override to it: the tripwire is a MEASUREMENT, not a
  #    knob. The reopen pin in src/__tests__/drift-check-scripts.test.ts
  #    ("[VAC04-C1] — the zero path FAILS CLOSED") REDs by execution if you
  #    revert it, and by name if you delete the marker above.
  #
  # ⚠️ Residual, still stated: a definition assembled at run time inside
  # dynamic SQL (`EXECUTE 'CREATE FUNCTION …'`) is claimed by neither
  # structural reading. It does not reach an exit 0 — the textual tripwire sees
  # the token and routes it to the refusal below, with everything else.
  _lexer_n="$(grep -ac '[^[:space:]]' "$TMP/names.lexer.txt" || true)"
  _naive_n="$(grep -ac '[^[:space:]]' "$TMP/names.naive.txt" || true)"

  # THE SCAN. Whole-file and newline-FLATTENED, so a `CREATE OR REPLACE` split
  # across lines from its `FUNCTION` is still seen; case-insensitive; `grep -a`
  # because this repo carries a measured NUL byte that makes a plain grep exit
  # 1 and read as "clean", and a tripwire defeated by one byte is not a
  # tripwire. Exit status captured with the `grep_rc` idiom from
  # scripts/test-ledger-drift-check.sh:311-318 — grep exits 0 on a match, 1 on
  # none, and >= 2 on an ERROR, and an UNREADABLE migration must never be
  # counted as a migration with no function in it.
  : > "$TMP/textual-hits.txt"
  for _f in "${CHANGED_FILES[@]}"; do
    tr '\n' ' ' < "$_f" > "$TMP/flat.txt" \
      || fail "MEASURE_FAIL: could not read ${_f} for the zero-path textual scan. An unreadable migration is not a migration without a function in it."
    set +e
    grep -aoiE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION' "$TMP/flat.txt" > "$TMP/flat.hits.txt"
    _tw_rc=$?
    set -e
    [ "$_tw_rc" -le 1 ] || fail "MEASURE_FAIL: the zero-path textual scan could not read ${_f} (grep exited ${_tw_rc}). An unscannable file is not a clean one."
    if [ "$_tw_rc" -eq 0 ]; then
      printf '%s\n' "$_f" >> "$TMP/textual-hits.txt"
    fi
  done

  # WR-04 (164.3.1 review): the hit-list test is a grep too, and it carried the
  # bare idiom: an exit >= 2 (unreadable hit list, broken locale) fell into the
  # LEGITIMATE-ZERO branch below and the run exited 0 — a zero path this gate
  # could not read, reported as one it read and found clean. Captured and
  # branched with the [VAC04-C3] discipline; only a grep that RAN and found no
  # line may reach the pass.
  set +e
  grep -aqE '[^[:space:]]' "$TMP/textual-hits.txt"
  _hits_rc=$?
  set -e
  [ "$_hits_rc" -le 1 ] || fail "MEASURE_FAIL: could not read the zero-path textual scan's hit list at ${TMP}/textual-hits.txt (grep exited ${_hits_rc}). A hit list this gate could not read is not one that measured zero hits, so the legitimate-zero pass is not reachable from it."
  if [ "$_hits_rc" -eq 1 ]; then
    # ── (a) LEGITIMATE ZERO ───────────────────────────────────────────────────
    echo "::notice::${GATE}: no functions defined, and the zero is LEGITIMATE — nothing to compare."
    echo "::notice::WHAT WAS SCANNED (evidence first — D-12/SC-7):"
    echo "::notice::  changed migration file(s): ${CHANGED_COUNT}"
    sed 's|^|::notice::    |' "$TMP/changed.txt"
    echo "::notice::  ${NORMALIZER} --function-names -> ${_lexer_n:-0} name(s)"
    echo "::notice::  ${NAIVE_NAMES} -> ${_naive_n:-0} name(s)"
    echo "::notice::  crude textual scan for 'CREATE [OR REPLACE] FUNCTION' -> 0 of ${CHANGED_COUNT} file(s)"
    echo "::notice::A THIRD reading — deliberately crude, sharing neither structural reader's"
    echo "::notice::blind spots — finds no such text ANYWHERE in the changed set. So the two"
    echo "::notice::readers' zero is an absence of FUNCTIONS, not an absence of VISION, and"
    echo "::notice::there was genuinely nothing here to compare against PROD. Had that scan"
    echo "::notice::found the text with both readers still empty, this run would have REFUSED."
    exit 0
  fi

  # ── (b) BLIND ZERO ──────────────────────────────────────────────────────────
  echo "::error::${GATE}: MEASURE_FAIL — NOTHING WAS COMPARED."
  echo "::error::"
  echo "::error::WHAT THE TWO READERS SAW (evidence first — D-12/SC-7):"
  echo "::error::  changed migration file(s): ${CHANGED_COUNT}"
  sed 's|^|::error::    |' "$TMP/changed.txt"
  echo "::error::  ${NORMALIZER} --function-names -> ${_lexer_n:-0} name(s)"
  grep -aqE '[^[:space:]]' "$TMP/names.lexer.txt" \
    && sed 's|^|::error::    |' "$TMP/names.lexer.txt" \
    || echo "::error::    (none)"
  echo "::error::  ${NAIVE_NAMES} -> ${_naive_n:-0} name(s)"
  grep -aqE '[^[:space:]]' "$TMP/names.naive.txt" \
    && sed 's|^|::error::    |' "$TMP/names.naive.txt" \
    || echo "::error::    (none)"
  echo "::error::  crude textual scan for 'CREATE [OR REPLACE] FUNCTION' -> HIT in:"
  sed 's|^|::error::    |' "$TMP/textual-hits.txt"
  echo "::error::"
  echo "::error::[VAC04-C1] Two independent readings agreeing on ZERO is not evidence of"
  echo "::error::absence when their blind spots OVERLAP — it is one absence observed twice."
  echo "::error::This is a BLIND zero, not a legitimate one: a THIRD reading, too crude to"
  echo "::error::share either structural reader's blind spots, FOUND the text they missed in"
  echo "::error::the file(s) listed above. A changed set with no function in it at all would"
  echo "::error::have passed here with a notice; this one did not."
  echo "::error::MEASURED 2026-09-01: a mid-line definition carrying a '\$' in its identifier"
  echo "::error::is invisible to BOTH readers, and this gate exited 0 on it having compared"
  echo "::error::nothing at all, over PRODUCTION function bodies. A gate cannot report a pass"
  echo "::error::for a comparison it never made, so this path fails closed."
  echo "::error::"
  echo "::error::⛔ ORDERING, not a defect to route around: migration PRs are HELD until Phase"
  echo "::error::164.3.1 AND Phase 164.4 have both landed (founder decision, amended D-07,"
  echo "::error::2026-09-01). A block here is this gate WORKING."
  echo "::error::To proceed on a PR that genuinely defines a function, make the definition"
  echo "::error::visible to at least one reader — put 'CREATE OR REPLACE FUNCTION' at the"
  echo "::error::start of its own line — and re-run."
  exit 1
fi

echo "Functions defined or replaced by this PR: ${NAME_COUNT}"

# ── 2b. EVERY DEFINITION MUST BE IN A SCHEMA THE SOURCE ACTUALLY COVERS ──────
# The fetcher reads a dump taken with `--schema public`. A `CREATE OR REPLACE
# FUNCTION private.f(...)` is therefore absent from it for a reason that has
# nothing to do with the function being new — and "absent" is a pass below.
# Refusing here keeps the gate's coverage equal to its claim.
# MEASURED 2026-08-29: all 112 function definitions under supabase/migrations/
# are `public.` or unqualified, so this is a latent hole today; it opens with
# the first non-public definition, silently.
# Unioned for the same reason the name list above is: a definition only the
# independent reading can see must still be schema-checked, or it would reach
# the comparison loop as a bare name with its qualifier never examined.
node "$NORMALIZER" --function-qualified-names "${CHANGED_FILES[@]}" > "$TMP/qualified.lexer.txt" \
  || fail "could not read the schema qualifiers of this PR's function definitions."
node "$NAIVE_NAMES" --qualified "${CHANGED_FILES[@]}" > "$TMP/qualified.naive.txt" \
  || fail "the independent name reader could not read the schema qualifiers of this PR's function definitions."
LC_ALL=C sort -u "$TMP/qualified.lexer.txt" "$TMP/qualified.naive.txt" | sed '/^[[:space:]]*$/d' > "$TMP/qualified.txt"
# ⚠️ Split by hand rather than with `IFS=$'\t' read -r a b`. TAB is IFS
# WHITESPACE, so `read` collapses a leading tab and an UNQUALIFIED row
# ("<empty>\tdemo_fn") would arrive as schema="demo_fn", name="" — which
# refused every unqualified definition in the repo. Measured while writing
# this guard.
while IFS= read -r _row; do
  [ -n "$_row" ] || continue
  _schema="${_row%%	*}"
  _name="${_row#*	}"
  # Unqualified is fine: it resolves through search_path, which puts it in the
  # same schema the dump covers. Only an EXPLICIT foreign qualifier is refused.
  [ -n "${_schema:-}" ] || continue
  _ok=0
  for _s in $PROD_DUMP_SCHEMAS; do
    [ "$_schema" = "$_s" ] && _ok=1
  done
  if [ "$_ok" -eq 0 ]; then
    echo "::error::${GATE}: this PR defines ${_schema}.${_name}, but the PROD source this gate reads"
    echo "::error::covers only schema(s): ${PROD_DUMP_SCHEMAS}. That function would be reported"
    echo "::error::'absent in PROD — a NEW function (pass)' whatever PROD actually holds, which is"
    echo "::error::a pass for something never compared. Widen the dump (and PROD_DUMP_SCHEMAS)"
    echo "::error::together, or move the definition."
    exit 1
  fi
done < "$TMP/qualified.txt"

# ── 2c. PROD'S FUNCTION-NAME INDEX — so "absent" is measured, not inferred ───
#
# ⛔ SP-C05. This index decides the gate's only silent pass ("measured absent —
# Treated as a NEW function"). It was produced by the SAME function as the body
# fetcher, over the SAME dump, so a definition that function could not parse was
# missing from both and they AGREED BY CONSTRUCTION — an absence measured with
# the instrument that produced it. Two independently derived indexes are read
# and UNIONED: a name counts as absent from PROD only when BOTH readings miss
# it. Neither is trusted to be the complete one.
# shellcheck disable=SC2086
$BODY_NAME_INDEX_CMD > "$TMP/prod-names.primary.txt" 2>"$TMP/prod-names.err" \
  || fail "could not index PROD's function names (stderr withheld — public log). Without the index, an extractor that stops matching would make every name read as a new function."
# shellcheck disable=SC2086
$BODY_NAME_INDEX_XCHECK_CMD > "$TMP/prod-names.xcheck.txt" 2>"$TMP/prod-names.xcheck.err" \
  || fail "could not build the INDEPENDENT cross-check index of PROD's function names (stderr withheld — public log). With only the primary index, absence from PROD is measured by the same parser that produced the absence."
LC_ALL=C sort -u "$TMP/prod-names.primary.txt" "$TMP/prod-names.xcheck.txt" | sed '/^[[:space:]]*$/d' > "$TMP/prod-names.txt"
# An index with no names at all is not a PROD with no functions — it is an
# index that did not work. The workflow's own dump-shape guard proves the dump
# holds at least one CREATE FUNCTION, so an empty index here contradicts it.
grep -aqE '[^[:space:]]' "$TMP/prod-names.primary.txt" \
  || fail "PROD's function-name index came back EMPTY. A database with zero functions is not a state this gate can distinguish from a broken index, so it fails closed."
grep -aqE '[^[:space:]]' "$TMP/prod-names.xcheck.txt" \
  || fail "the INDEPENDENT cross-check index of PROD's function names came back EMPTY. A cross-check that finds nothing cannot contradict anything, so it would silently degrade this gate back to a single reading of itself."
PROD_NAME_COUNT="$(grep -ac '[^[:space:]]' "$TMP/prod-names.txt" || true)"
# Disagreement between the two readings is EVIDENCE, and it is what tells a
# maintainer that one of the parsers has started missing definitions. It is
# reported, not failed on: the union has already made every per-name decision
# below fail closed, and a pre-existing quirk in PROD's dump must not red every
# migration PR. A name the primary index misses and this PR touches DOES exit 1
# — through the "IS in the index but the fetcher extracted no body" branch.
LC_ALL=C comm -13 <(LC_ALL=C sort -u "$TMP/prod-names.primary.txt") <(LC_ALL=C sort -u "$TMP/prod-names.xcheck.txt") | sed '/^[[:space:]]*$/d' > "$TMP/prod-names.xcheck-only.txt"
XCHECK_ONLY_COUNT="$(grep -ac '[^[:space:]]' "$TMP/prod-names.xcheck-only.txt" || true)"
if [ "${XCHECK_ONLY_COUNT:-0}" -gt 0 ]; then
  echo "::warning::${GATE}: the independent cross-check index found ${XCHECK_ONLY_COUNT} function name(s) the primary index did not:"
  sed 's/^/::warning::  /' "$TMP/prod-names.xcheck-only.txt"
  echo "::warning::The primary index shares its parser with the body fetcher, so those names would"
  echo "::warning::previously have been reported 'absent from PROD — a NEW function (pass)'."
fi

# ── ABSURDITY FLOOR ──────────────────────────────────────────────────────────
# MEASURED 2026-09-01 at 15ab417b, sample size and coverage stated below (SC-9).
# Is this a PROD that genuinely holds almost no functions, or a BROKEN READER?
# The empty-index guards above answer that only for EXACTLY zero. One name
# through and they go quiet — and a near-empty index is the "every function is
# new — pass" shape, because a name absent from a tiny index takes the
# measured-absent pass on every iteration of the loop below. This is D-09's
# VAC-04 half, templated on VAC-08's floor at
# test-ledger-drift-check.sh:320-350 (structure, not numbers).
#
# ── THE RULE, AND WHY IT IS A RATIO AND NOT A LITERAL ───────────────────────
# The floor is calibrated against a SECOND, INDEPENDENTLY PRODUCED population
# the gate already holds: the committed snapshot directory. Those bodies are
# generated FROM PROD by `npm run schema:functions`, so their count is a prior
# measurement of PROD's public-schema function catalogue — not a number someone
# chose. A hardcoded literal would rot the moment PROD's catalogue grew or
# shrank, and D-10 is explicit that thresholds are set by MEASUREMENT, never by
# taste. So: if the snapshot is substantially populated but PROD's index holds
# fewer than HALF as many names, the READER is broken, not the database.
#
# ── SAMPLE SIZE AND COVERAGE (SC-9) ─────────────────────────────────────────
#   Corpus      : 380 `.sql` files — 262 under supabase/migrations/ and 118
#                 under supabase/schema/functions/.
#   Definitions : 359 across that corpus; 122 DISTINCT function names in the
#                 union of the two readers (0 disagreements).
#   PROD proxy  : 118 committed bodies in supabase/schema/functions/, generated
#                 from PROD (`npm run schema:functions`); the gate's own header
#                 records the same 118 verified 2026-08-28.
#   Measured    : 2026-09-01 at 15ab417b, with the SAME two readers this gate
#                 unions, over the whole corpus (not a sample of it).
#
# ── WIDE SEPARATION, BOTH DIRECTIONS STATED WITH THEIR MEASURED VALUES ──────
#   FIRES  : a broken reader scores 0 names. MEASURED 2026-09-01 (plan
#            164.3.1-04's pre-fix probe): the [VAC04-C2] guard defect made BOTH
#            readers print nothing and exit 0 on every symlinked invocation.
#            0 * 2 = 0, far under 118 — fires.
#   SILENT : the real index scores 118-122 names. 122 * 2 = 244, far over 118 —
#            silent. Ordinary churn does not approach the halfway mark: PROD
#            would have to lose ~60 functions in one PR to reach it.
#   The two sides are an order of magnitude apart around the 59-name halfway
#   point, so this is separation, not tuning.
#
# ── WHAT THIS DOES NOT COVER, stated rather than implied ────────────────────
# When the snapshot population is under SNAPSHOT_MIN the ratio has no reliable
# denominator and the floor goes INERT. That state is ANNOUNCED rather than
# silent (the else branch below), because a control that quietly stops
# controlling is the defect this phase exists to stop. It is also loud
# elsewhere: with a depopulated snapshot, every compared function hits the
# "PROD has it but the committed snapshot does not" failure above.
SNAPSHOT_MIN=50
# WR-04 (164.3.1 review): the WALK and the COUNT are two measurements, each
# with its own exit status. They used to share one pipeline under `pipefail`,
# where a `find` that fails mid-walk (permission, I/O) exits 1 — the status
# `grep -c` returns for "counted, no rows" — so a failed walk read as a LOW
# population, the floor went INERT with a `::warning::`, and the "every
# function is new — pass" shape it exists to catch was unguarded for that run.
# The `-d` check at the top bounds only the missing-directory case.
set +e
find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name '*.sql' -print > "$TMP/snapshot-bodies.txt"
_find_rc=$?
set -e
[ "$_find_rc" -eq 0 ] || fail "MEASURE_FAIL: could not enumerate the committed snapshot bodies under ${SNAPSHOT_DIR} (find exited ${_find_rc}). The absurdity floor calibrates against that population, and a walk that failed is not a population of whatever it managed to list."
set +e
SNAPSHOT_BODY_COUNT="$(grep -ac '[^[:space:]]' "$TMP/snapshot-bodies.txt")"
_snap_rc=$?
set -e
# Same grep exit-code discipline as [VAC04-C3] and SP-M01: 0 = counted, 1 = no
# rows, >= 2 = could not read. An uncountable population is not an empty one.
[ "$_snap_rc" -le 1 ] || fail "MEASURE_FAIL: could not count the committed snapshot bodies under ${SNAPSHOT_DIR} (grep exited ${_snap_rc}). The absurdity floor calibrates against that population, and an uncountable denominator is not a denominator of zero."
SNAPSHOT_BODY_COUNT="${SNAPSHOT_BODY_COUNT:-0}"
if [ "${SNAPSHOT_BODY_COUNT:-0}" -ge "$SNAPSHOT_MIN" ]; then
  if [ $(( ${PROD_NAME_COUNT:-0} * 2 )) -lt "$SNAPSHOT_BODY_COUNT" ]; then
    echo "::error::${GATE}: MEASURE_FAIL — this is the GATE failing, not the database."
    echo "::error::"
    echo "::error::WHAT WAS READ (evidence first — D-12/SC-7):"
    echo "::error::  PROD function-name index : ${PROD_NAME_COUNT:-0} name(s), union of two readings"
    echo "::error::  committed snapshot bodies: ${SNAPSHOT_BODY_COUNT} under ${SNAPSHOT_DIR}"
    echo "::error::  absurdity floor          : the index must hold at least half the snapshot"
    echo "::error::                             population ($(( SNAPSHOT_BODY_COUNT / 2 )) name(s)) once that"
    echo "::error::                             population is >= ${SNAPSHOT_MIN}"
    echo "::error::  first names actually read:"
    head -n 10 "$TMP/prod-names.txt" | sed 's|^|::error::    |'
    echo "::error::"
    echo "::error::Those snapshot bodies were generated FROM PROD, so the repository already"
    echo "::error::knows PROD holds roughly that many functions. An index holding a small"
    echo "::error::fraction of them is a reader that stopped matching, not a database that"
    echo "::error::dropped its catalogue — and every name absent from a tiny index takes this"
    echo "::error::gate's measured-absent pass, so the failure mode is 'every function is new"
    echo "::error::— pass' with nothing compared at all."
    echo "::error::Fix the index reader (or the dump it reads); do NOT widen this floor to"
    echo "::error::make the run green."
    exit 1
  fi
else
  # Announced, never silent — see "WHAT THIS DOES NOT COVER" above.
  echo "::warning::${GATE}: the absurdity floor is INERT this run — the committed snapshot"
  echo "::warning::population under ${SNAPSHOT_DIR} is ${SNAPSHOT_BODY_COUNT}, below the ${SNAPSHOT_MIN} needed to"
  echo "::warning::calibrate against it. A near-empty PROD name index would NOT be caught here."
fi
echo "Functions indexed in the PROD source: ${PROD_NAME_COUNT:-0} (union of two independent readings)"
echo ""

# ── 3. COMPARE, PER FUNCTION ─────────────────────────────────────────────────
bad=0
checked=0
matched=0
acked=0
absent=0
# ── THE THREE TERMINAL DISPOSITIONS, tallied INDEPENDENTLY ───────────────────
#
# ⛔ R2-W03. The previous version kept a single `accounted` counter incremented
# once on every path through the loop. That is guaranteed by the loop's own
# structure: it could only be made to fire by deleting one of its own
# increments, which is not a proof of anything. It was blind to the failure it
# claimed to detect — a name that reaches the end of the loop having been
# neither compared nor classified.
#
# MEASURED 2026-08-29, the exact input, two functions:
#   the fetcher returns NON-EMPTY text carrying no extractable definition for
#   `ghost_fn` (a psql notice, an error line, a stray comment). It survives the
#   empty-body check, the comparator emits one SNAPSHOT_ONLY row — so `rows`
#   is 1 and the zero-rows guard stays quiet — and SNAPSHOT_ONLY increments
#   NOTHING. With a second name comparing normally, `checked` is non-zero so
#   the `checked -eq 0` branch stays quiet too. Result:
#     "1 body comparison(s) … 0 measured-absent" for 2 named functions
#     "::notice:: no unacknowledged repo-vs-PROD body drift"   exit 0
#   while `ghost_fn` — which PROD's index says EXISTS — was compared against
#   nothing. `accounted` read 2 of 2 throughout.
#
# So the dispositions are now tallied SEPARATELY, each at the point where the
# thing it names actually happens, and required to SUM to NAME_COUNT. A name
# that reaches no disposition is short in the sum and cannot hide behind a
# sibling that did.
# (`absent` above is the third tally — a name measured absent from PROD's
# index, i.e. a genuinely new function.)
compared_names=0   # produced at least one COMPARISON row (MATCH/DRIFT/SNAPSHOT_MISSING/UNCOMPARABLE)
failed_names=0     # reached an ERROR disposition: unreadable, unextractable, or no snapshot

for fname in "${NAMES[@]}"; do
  # ⛔ SP-I07. `fname` becomes a FILESYSTEM PATH COMPONENT on the next line and
  # on the snapshot line below, and it comes from a name reader that accepts a
  # possibly-quoted, possibly-schema-qualified identifier — so
  # `CREATE FUNCTION public."../../x"(…)` yields a traversal write. It takes a
  # maintainer-authored migration to reach, so this is hardening rather than an
  # open hole, but a gate whose failure mode is "wrote outside its scratch
  # directory" has no business being the thing that guards production.
  #
  # Refuse rather than sanitise: silently rewriting the name would compare the
  # WRONG function and report a pass for it. The same reasoning, and the same
  # shape, as test-ledger-drift-check.sh's migration-filename allowlist.
  #
  # The allowlist is exactly Postgres' UNQUOTED-identifier charset,
  # `[A-Za-z0-9_$]`. `$` is deliberately IN it: it is legal in an identifier, it
  # is inert as a path component, and every use site quotes the expansion — so
  # excluding it would refuse a legal function for no safety gain, and would
  # collide with SP-C05's measured `sanitize_user$v2` case, which must reach the
  # comparison so that the gate fails on the RIGHT thing. MEASURED 2026-08-29:
  # all 359 function names in this repo are inside this charset.
  case "$fname" in
    "" | *[!A-Za-z0-9_$]*)
      echo "::error::${GATE}: this PR defines a function named '${fname}', which carries characters"
      echo "::error::this gate refuses to use as a filename component. It would be written into a"
      echo "::error::scratch path and read back out of the committed snapshot directory, so a"
      echo "::error::traversal or a collision there is a comparison against the wrong body."
      echo "::error::Rename the function, or widen this allowlist deliberately."
      exit 1
      ;;
  esac
  live="$TMP/${fname}.live.sql"
  ferr="$TMP/${fname}.fetch.err"

  # shellcheck disable=SC2086
  if ! $BODY_FETCH_CMD "$fname" > "$live" 2>"$ferr"; then
    # The fetcher's stderr is NOT echoed: it can carry a DSN or a host.
    echo "::error::${GATE}: the PROD body fetcher failed for '${fname}' (stderr withheld — public log)."
    echo "::error::A gate that could not read cannot report a pass."
    bad=1
    failed_names=$((failed_names + 1))
    continue
  fi

  # WR-04 (164.3.1 review): the whitespace-only test on the fetched body is a
  # grep too, and it carried the bare idiom [VAC04-C3] fixed just below: an
  # exit >= 2 here (unreadable file, I/O failure, broken locale) was read as
  # "empty body" and routed to the index lookup — fail-CLOSED when the name is
  # in the index (an "extraction failure" with the wrong cause), but the
  # measured-absent PASS when it is not, for a body this run FETCHED and then
  # could not read. Captured and branched three ways.
  set +e
  grep -aqE '[^[:space:]]' "$live"
  _live_rc=$?
  set -e
  if [ "$_live_rc" -ge 2 ]; then
    echo "::error::${GATE}: MEASURE_FAIL — could not READ the body fetched from PROD for '${fname}'."
    echo "::error::  body file   : ${live}"
    echo "::error::  grep exited : ${_live_rc}   (0 = has content, 1 = empty or whitespace, >= 2 = ERROR)"
    echo "::error::A body this gate could not read is neither a body it compared nor one it measured"
    echo "::error::empty; reporting either would be a verdict over bytes this run never saw."
    exit 1
  fi
  if [ ! -s "$live" ] || [ "$_live_rc" -eq 1 ]; then
    # WR-01: empty stdout is TWO different facts. Ask the index which one.
    #
    # ⛔ [VAC04-C3]. This was a BARE `if grep …; then … else … fi`, and `grep`
    # exits 0 on a match, 1 on NO match, and >= 2 on an ERROR — an unreadable
    # file, an I/O failure, a broken locale. Exit 1 and exit 2 both fell to the
    # same `else`, which prints "measured absent … Treated as a NEW function
    # (pass)". So an index this gate COULD NOT READ was reported as an index it
    # read and found nothing in, turning WR-01's one fail-CLOSED arm ("absence
    # is a MEASUREMENT") into a fail-OPEN one. Repeated across every name it is
    # the whole gate green having compared nothing.
    #
    # MEASURED 2026-09-01 with a `grep` shimmed to exit 2 on this call alone:
    #   "  demo_fn: measured absent — not in the PROD source's 1-name index.
    #    Treated as a NEW function (pass)."
    #   "::notice::… ZERO bodies compared … This is a measured zero, not an
    #    unread one."                                                  exit 0
    # The last sentence was the exact inversion of the truth.
    #
    # The status is CAPTURED and branched three ways, using VAC-08's discipline
    # at test-ledger-drift-check.sh:311-318. `-aqxF` is kept verbatim: NUL-safe,
    # fixed-string, whole-line — the reason for each flag is the house idiom.
    set +e
    grep -aqxF -- "$fname" "$TMP/prod-names.txt"
    _idx_rc=$?
    set -e
    if [ "$_idx_rc" -ge 2 ]; then
      echo "::error::${GATE}: MEASURE_FAIL — could not READ the PROD function-name index while"
      echo "::error::deciding whether '${fname}' is absent from PROD."
      echo "::error::  index file  : ${TMP}/prod-names.txt"
      echo "::error::  searched for: ${fname}"
      echo "::error::  grep exited : ${_idx_rc}   (0 = present, 1 = measured absent, >= 2 = ERROR)"
      echo "::error::An index this gate could not read is not an index that measured absence."
      echo "::error::Reporting '${fname}' as a NEW function here would be a pass for a name this"
      echo "::error::run never looked up — and the same failure on every name is the whole gate"
      echo "::error::green having compared nothing."
      exit 1
    fi
    if [ "$_idx_rc" -eq 0 ]; then
      echo "::error::${GATE}: '${fname}' IS in the PROD source's function-name index, but the"
      echo "::error::fetcher extracted no body for it. That is an extraction failure, not a new"
      echo "::error::function. Reporting it as 'new — pass' would be a pass for something this"
      echo "::error::gate could not read; the same failure repeated for every name would turn the"
      echo "::error::whole gate green having compared nothing."
      bad=1
      failed_names=$((failed_names + 1))
    else
      # Exactly status 1 — the >= 2 leg exited above and 0 was taken by the
      # branch above, so the three legs are exhaustive over grep's status. This
      # is the ONE silent pass this gate has, and it is now reachable only from
      # a grep that RAN and reported no match.
      echo "  ${fname}: measured absent — not in the PROD source's ${PROD_NAME_COUNT}-name index. Treated as a NEW function (pass)."
      absent=$((absent + 1))
    fi
    continue
  fi

  snapshot="${SNAPSHOT_DIR}/${fname}.sql"
  if [ ! -f "$snapshot" ]; then
    echo "::error::${GATE}: '${fname}' exists in PROD but has no committed body at ${snapshot}."
    echo "::error::The snapshot is STALE. sql-function-snapshot.yml should have caught this;"
    echo "::error::run 'npm run schema:functions' and commit the result."
    bad=1
    failed_names=$((failed_names + 1))
    continue
  fi

  node "$NORMALIZER" --diff-bodies "$snapshot" "$live" > "$TMP/${fname}.rows" \
    || fail "the normalizer could not compare '${fname}'."

  rows=0
  # Derived from `checked` — the comparison tally itself — rather than set by
  # hand alongside it, so "this name was compared" cannot be true while
  # "something was compared" is false. See the R2-W03 note above.
  checked_before="$checked"
  while IFS=$'\t' read -r status name nargs snap_hash live_hash hunks; do
    [ -n "${status:-}" ] || continue
    rows=$((rows + 1))
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

  if [ "$rows" -eq 0 ]; then
    # A non-empty live body that the comparator turned into zero rows is the
    # same hole as an empty fetch, one layer down: nothing was compared and
    # nothing said so.
    echo "::error::${GATE}: the comparator produced ZERO rows for '${fname}' from a non-empty PROD body."
    echo "::error::Nothing was compared for it, so nothing about it can be reported as clean."
    bad=1
    failed_names=$((failed_names + 1))
  elif [ "$checked" -gt "$checked_before" ]; then
    compared_names=$((compared_names + 1))
  fi
  # ⚠️ DELIBERATELY NO `else`. A name whose rows were ALL advisory
  # (SNAPSHOT_ONLY) reaches neither branch, so it is counted by none of the
  # three tallies and the sum below goes short. That is the point: it is
  # exactly the state where a name was named, fetched, and measured against
  # nothing. Giving it a disposition here would restore the tautology.
done

echo ""
echo "${GATE}: ${checked} body comparison(s) — ${matched} match, ${acked} acknowledged drift, ${absent} measured-absent (new) function(s)."

# ── 4. THE ARITHMETIC MUST CLOSE ─────────────────────────────────────────────
# A floor on `checked` alone would be wrong — a PR that only ADDS functions
# legitimately compares nothing — so the floor is on ACCOUNTING. But the
# accounting must be DERIVED from what happened, not incremented beside it:
# see the R2-W03 note in section 3. The three tallies are raised at the three
# points where the three things actually occur, and a name that occasions none
# of them is short here.
disposed=$((compared_names + absent + failed_names))
if [ "$disposed" -ne "$NAME_COUNT" ]; then
  fail "MEASURE_FAIL: ${NAME_COUNT} function(s) named by this PR's migrations, but the dispositions sum to ${disposed} (${compared_names} compared / ${absent} measured-absent / ${failed_names} failed). At least one named function was fetched and then measured against NOTHING — every row the comparator produced for it was advisory. A pass cannot be reported for a function this run never compared."
fi
if [ "$checked" -eq 0 ] && [ "$absent" -eq "$NAME_COUNT" ]; then
  # The ONE way zero comparisons is legitimate: every named function was
  # measured absent from PROD's index, i.e. this PR only adds functions.
  # Stated out loud rather than left as a silent "0".
  echo "::notice::${GATE}: ZERO bodies compared — all ${NAME_COUNT} function(s) named by this PR were measured absent from the PROD source's ${PROD_NAME_COUNT}-name index, i.e. they are new. This is a measured zero, not an unread one."
elif [ "$checked" -eq 0 ]; then
  # Zero comparisons for any OTHER reason is a gate that ran and looked at
  # nothing. It must not be able to reach the success line below.
  echo "::error::${GATE}: MEASURE_FAIL — ZERO bodies compared, and only ${absent} of ${NAME_COUNT} function(s) were measured absent from PROD. The rest reached no comparison at all, so this run has nothing to report clean."
  bad=1
fi

if [ "$bad" = 1 ]; then
  exit 1
fi
echo "::notice::${GATE}: no unacknowledged repo-vs-PROD body drift."
exit 0
