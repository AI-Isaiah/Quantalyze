#!/usr/bin/env bash
# DRIFT-04 PRE-FLIGHT — the measurements that must pass before
# public.create_allocator_connected_strategy is removed from PRODUCTION.
# Phase 164.5 / plan 06 / criterion 3. 2026-09-07.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
# public.create_allocator_connected_strategy is SECURITY DEFINER, OWNER TO
# postgres, SET search_path TO public,pg_catalog, and it writes encrypted
# credential material into api_keys + strategies + portfolio_strategies. It
# holds `GRANT ALL` for BOTH `authenticated` AND `service_role`
# (supabase/schema/baseline.sql:13755-13756 — TODOS `[DRIFT-04]` records only
# the first). No file under supabase/migrations/ defines it; its own COMMENT
# cites "migration 043", a legacy numbered file that is not in this repository.
# Founder decision 2026-08-29: remove it. No exploit is claimed; the issue is
# governance — an `authenticated`-reachable SECDEF credential-writing RPC that
# no PR ever reviewed and that any hardening of the wizard RPCs silently will
# not cover.
#
# The removal migration deliberately carries NEITHER the existence-tolerant
# modifier NOR the dependent-removing modifier: the first silently no-ops on a
# signature mismatch (a vacuous pass) and the second silently removes
# dependents. Both turn a loud failure into a quiet wrong outcome. Refusing them
# is only SAFE if the facts they would have papered over have been MEASURED
# first. Measuring them is this script's entire job.
#
# ⛔ THIS SCRIPT ONLY MEASURES AND REPORTS. It issues no DDL, it writes nothing,
# and it removes nothing.
#
# ⚠️ NARROWED 2026-09-07 (review LOW). The previous wording claimed DDL verbs
# appear "nowhere in it — in code OR in prose", which was FALSE: `GRANT ALL` is
# spelled in prose ten lines above, describing the grants the removal destroys.
# The claim this file actually honours is NARROWER: the plan's acceptance
# criterion (164.5-06-PLAN.md, the criterion at its line 150) greps for exactly
# FOUR tokens — the removal verb, the definition verb, the modification verb,
# and the CLI push subcommand — and those four appear nowhere in this file, in
# code or in prose.
#
# ⛔ THOSE FOUR ARE DELIBERATELY NOT SPELLED IN THIS PARAGRAPH, for the same
# reason the two refused modifiers are not spelled below: prose that quotes the
# token its own gate greps for makes the gate answer about the prose. Spelling
# them here was MEASURED to break the criterion — all four went from 0
# occurrences to 1 — which is a live demonstration of exactly the self-
# invalidating-comment hazard the migration header names.
#
# The wider claim was worse than merely imprecise: it was unfalsifiable against
# this file's own contents, which is the defect class the rest of this script
# exists to refuse.
#
# ── THE ASSERTIONS, IN ORDER ─────────────────────────────────────────────────
#   IDENTITY   ⭐ ADDED 2026-09-07 (review HIGH-1 / HIGH-2). The FIRST
#              measurement of every credentialed run, in BOTH modes. It reads
#              `shobj_description(oid,'pg_database')` for `current_database()`
#              and requires (i) exactly ONE row and (ii) a marker CONTAINING
#              ALLOC_EXPECT_DB_MARKER. A NULL/absent marker ABORTS.
#              ⛔ WHY IT IS NOT OPTIONAL, and what it repairs:
#              (HIGH-1) `--expect-absent` inverts the signature assertion, so
#              `rows=0` becomes the PASS. Before this assertion, a reader that
#              touched no database at all — `printf 'rows=0\n'` — produced
#              "verdict: NOT FOUND" and exit 0. That is a check that CANNOT
#              FAIL, in the one mode that records "the one-way removal took
#              effect". IDENTITY is that mode's POSITIVE CONTROL: a reader
#              pointed at nothing yields no `rows=1` marker either, so the run
#              refuses instead of certifying an absence it never measured.
#              (HIGH-2) The credential check below USED TO assert three Supabase
#              variables non-empty and then NEVER USE THEM — the readers are
#              free-form command prefixes from the environment, so presence of a
#              variable proves nothing about WHICH database was read.
#              ⭐ FIXED 2026-09-07 (founder decision). Those three are GONE from
#              the requirement, and the check now asserts only what this run
#              CONSUMES: the identity PIN, and every reader command the chosen
#              MODE invokes unconditionally. ENVIRONMENT below carries the
#              per-variable justification. Nothing was relaxed — the loop got
#              LONGER, because reader absence was previously caught only lazily,
#              mid-run. What did NOT change is the reason IDENTITY exists: a
#              CONFIGURED reader is a command that exists, never a database that
#              was reached, so IDENTITY is still the only assertion in this file
#              that binds a MEASUREMENT to PROD.
#              ⚠️ STATED BOUND. The readers are independent command prefixes, so
#              this file cannot force IDENTITY and the signature read into one
#              TCP session; it proves they run under the same reader
#              CONFIGURATION, in the same run, moments apart. An operator who
#              points the two readers at different databases defeats it. That is
#              a narrower hole than "no binding at all" and it is stated rather
#              than papered over.
#   SIGNATURE  exactly ONE live overload, whose argument TYPES equal the 11 the
#              committed baseline records. This is the assertion the
#              existence-tolerant modifier would have swallowed.
#   (a) BODY    the live definition equals supabase/schema/baseline.sql's,
#              normalized by scripts/sql-body-normalize.mjs — the declared
#              single normalizer. Both sha256 hashes and the differing-line
#              count are PRINTED.
#   (b) DEPENDENTS  TWO readings, because ONE of them is structurally blind.
#         (b.1) pg_depend, joined to pg_proc on the 11-argument overload's oid,
#              must report ZERO rows. The count is PRINTED; a non-zero count
#              lists the dependents' kinds and catalogue identities.
#         (b.2) ⭐ ADDED 2026-09-07 (review MED-1). pg_proc.prosrc scanned for
#              the function NAME, excluding the target's own oid, must report
#              ZERO rows. ⛔ WHY: a plpgsql function body that CALLS another
#              function creates NO pg_depend row — the call is resolved at
#              execution time out of the body TEXT, not recorded in the
#              catalogue. So (b.1) alone printed "ZERO — nothing in the
#              catalogue depends on this overload" while an in-database caller
#              sat invisible, and the removal (which correctly refuses the
#              dependent-removing modifier) does NOT abort on such a caller
#              either: it succeeds, and the caller breaks at RUNTIME, after the
#              one-way DDL. Unlike a PostgREST caller, this class IS measurable,
#              so it is measured.
#              ⚠️ STATED BOUND: a TEXT scan. It over-reports (the name inside a
#              comment or a string literal matches) and under-reports (a caller
#              that builds the name dynamically does not). Over-reporting is the
#              safe direction — it refuses and a human dispositions the hit.
#   (c) CALL EVIDENCE  pg_stat_statements availability is PROBED against
#              pg_extension FIRST. ABSENT is an ABORT with its own exit code
#              (D-02). Only a PRESENT extension yields a reading, and only that
#              reading is evidence.
#
# ── NON-NEGOTIABLES (inherited verbatim in behaviour from the sibling gate
#    scripts/prod-body-drift-check.sh) ─────────────────────────────────────────
# 1. NEVER SKIP. The credential check is the FIRST thing this script does and an
#    absent credential is `exit 1` naming the variable — never `exit 0`, never a
#    `::notice::`.
# 2. NEVER PRINT PROD TEXT. This repository is PUBLIC. Output carries function
#    names, argument counts and TYPES, sha256 hashes, differing-line counts,
#    dependent kinds and catalogue identities, and call counts — nothing else.
#    No DSN, no host, no username, no project ref, no body. Every reader's
#    stderr is withheld.
# 3. NEVER PASS SOMETHING IT DID NOT MEASURE. A reader that errors, a reader
#    that violates the row protocol below, a body it cannot extract, and an
#    unavailable pg_stat_statements are each non-zero. "Could not measure" and
#    "measured zero problems" never share a code path here.
#
# ── D-02, MECHANICALLY: THE `rows=<N>` PROTOCOL ──────────────────────────────
# Every catalogue reader below MUST print, as its FIRST line, `rows=<N>`, then
# exactly N payload lines. A reader that prints NOTHING therefore fails the
# header check instead of arriving as "zero rows". That is the whole point: an
# absent measurement can never be rendered as a measured zero, because the two
# are different bytes on the wire and only one of them parses.
#
# ── ENVIRONMENT ──────────────────────────────────────────────────────────────
#
# ⭐ NARROWED 2026-09-07 (founder decision; review finding HIGH-2). This file used
# to demand SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD
# be non-empty. All three are GONE from the requirement. Why, per variable:
#
#   SUPABASE_DB_PASSWORD    Never read by this file, and IRRELEVANT on a reader
#     path that works: `supabase db query --linked` reaches the linked project
#     through the Management API on the CLI's stored token and consumes no
#     database password at all. Demanding one forced an operator to INVENT a
#     value to satisfy a gate. ⛔ A gate satisfied by a meaningless value is
#     exactly the defect class the rest of this script exists to refuse, so
#     demanding it was not merely useless — it was this file contradicting
#     itself, in the first thing it did.
#   SUPABASE_ACCESS_TOKEN   Never read by this file either. The reader that does
#     use a token reads the CLI's own stored credential, not this variable, so
#     asserting it non-empty constrains nothing about whether that reader can
#     authenticate. A reader that cannot authenticate fails LOUDLY at the reader
#     protocol below (`ON_ERROR_STOP=1` -> non-zero -> MEASURE_FAIL), which is a
#     measurement of the failure rather than a guess ahead of it.
#   SUPABASE_PROJECT_REF    The weakest of the three, and the most misleading.
#     Naming a project in a variable nobody reads is strictly LESS than measuring
#     which database answered, and the two can disagree in silence — a ref
#     naming PROD beside readers pointed at TEST would have passed this check.
#     ALLOC_EXPECT_DB_MARKER plus the IDENTITY assertion do that job by
#     MEASUREMENT, which is the whole reason IDENTITY was added. Keeping the ref
#     would preserve a weaker duplicate of an assertion that already exists.
#
# ⛔ WHAT NOW CARRIES THE WEIGHT — strictly MORE than before, not less:
#   1. ALLOC_EXPECT_DB_MARKER — a VALUE, read and compared. Unset is EX_USAGE.
#   2. Every READER COMMAND the chosen MODE invokes UNCONDITIONALLY, asserted up
#      front by the same loop, each unset one an EX_USAGE naming itself. Before
#      this change a missing reader was caught only LAZILY, mid-run, by
#      `run_reader`. That refusal still exists as defence in depth and is now the
#      sole owner of the one CONDITIONAL reader (ALLOC_CALLS_CMD, invoked only
#      when the availability probe reports PRESENT).
#   3. The IDENTITY assertion — the only MEASUREMENT in this file that binds a
#      verdict to a database.
#
# ⚠️ THE STATED BOUND IS UNCHANGED AND STILL TRUE. The readers are independent
# command prefixes. Asserting a reader is CONFIGURED proves a command exists to
# run; it never proves which database that command reaches. Only IDENTITY speaks
# to that, and only per-reader-CONFIGURATION, never per-TCP-session.
#
# Required identity pin (a VALUE, read and compared — the ONE variable in this
# file whose CONTENTS are consumed, and the reason the readers below are not
# trusted on presence alone):
#   ALLOC_EXPECT_DB_MARKER  a substring the live database's own
#                         `COMMENT ON DATABASE` must CONTAIN. Each Supabase
#                         project in this org carries a hand-set marker naming
#                         itself (project CLAUDE.md, "Which database am I on?"),
#                         and `current_database()` is `postgres` on BOTH
#                         projects, so the comment is the only discriminator.
#                         ⚠️ It is compared, never PRINTED: this repository is
#                         PUBLIC. Only "MATCHED" or "DID NOT MATCH" is emitted.
#                         Unset is EX_USAGE — a run that does not know which
#                         database it should be reading cannot assert it read
#                         the right one, and must not proceed to a verdict that
#                         authorises a one-way production removal.
#
# Required readers. Each is a command PREFIX, word-split on IFS (so its
# arguments must not contain spaces), invoked with NO arguments.
#
# ⭐ REQUIRED PER MODE, ASSERTED UP FRONT (2026-09-07). `--expect-absent` runs
# only IDENTITY and the inverted signature assertion, so it requires exactly
# ALLOC_DB_IDENTITY_CMD and ALLOC_SIGNATURE_CMD. `--expect-present` additionally
# requires ALLOC_BODY_FETCH_CMD, ALLOC_DEPENDENTS_CMD, ALLOC_PLPGSQL_CALLERS_CMD
# and ALLOC_EXTENSION_CMD.
# ⛔ ALLOC_CALLS_CMD IS DELIBERATELY IN NEITHER LIST. It is invoked ONLY when the
# availability probe reports PRESENT, so hoisting it would demand a value a run
# may never consume — the same theatre this change removes, re-introduced one
# variable later. It keeps its own refusal in `run_reader`, and a self-test arm
# runs `--expect-present` with it unset to prove that refusal still bites.
# ⛔ The mode-scoping is likewise MEASURED, not asserted: a self-test arm runs
# `--expect-absent` with every (a)/(b)/(c) reader unset and requires it to still
# reach its NOT FOUND verdict. Without that arm, "conditional" would be a claim.
#
#   ALLOC_DB_IDENTITY_CMD `rows=<N>` then N lines carrying the live database's
#                         `shobj_description(oid,'pg_database')`. Exactly ONE
#                         row is required. ⛔ A SQL NULL marker renders as an
#                         EMPTY line, which the row protocol below strips, so a
#                         marker-less database arrives as `rows=1` with ZERO
#                         payload lines and is caught as a self-contradiction —
#                         it can never pass as a matched identity. This is the
#                         positive control for `--expect-absent`, whose own
#                         signature assertion PASSES on `rows=0` and therefore
#                         cannot, by itself, distinguish "the removal took
#                         effect" from "this reader read nothing at all".
#   ALLOC_SIGNATURE_CMD   `rows=<N>` then N lines, one per live overload of
#                         public.create_allocator_connected_strategy, each line
#                         the overload's comma-separated argument TYPES in
#                         positional order.
#   ALLOC_BODY_FETCH_CMD  the live definition TEXT on stdout. Plain text, no row
#                         header — the row protocol does not apply, and empty or
#                         unparseable stdout is an ABORT, never an absence.
#   ALLOC_DEPENDENTS_CMD  `rows=<N>` then N lines of `<kind>` TAB `<identity>`
#                         for every pg_depend row referencing the function.
#   ALLOC_PLPGSQL_CALLERS_CMD  `rows=<N>` then N lines of
#                         `<schema>.<name>(<args>)` for every OTHER pg_proc row
#                         whose `prosrc` mentions the function's name. This is
#                         the class pg_depend cannot see; see (b.2) above.
#   ALLOC_EXTENSION_CMD   `rows=<N>` then N lines, one per pg_extension row
#                         named `pg_stat_statements`. 0 = measured ABSENT (an
#                         ABORT), 1 = measured PRESENT. It carries a payload
#                         line like every other reader deliberately: ONE
#                         protocol, so a probe that answers `rows=1` while
#                         emitting nothing is caught as a self-contradiction
#                         rather than trusted as a PRESENT verdict.
#   ALLOC_CALLS_CMD       `rows=<N>` then N lines of `calls=<integer>`. Only
#                         invoked when the probe above reported PRESENT.
#
# Optional:
#   BASELINE_FILE  default supabase/schema/baseline.sql
#   NORMALIZER     default scripts/sql-body-normalize.mjs
#
# ── READER RECIPES (catalogue reads only; no DDL, no writes) ─────────────────
# These are the shapes the readers must produce. They are recorded here so a
# credentialed operator does not have to invent them, and so a reviewer can see
# that nothing below writes. Substitute the operator's own connection handling;
# this file deliberately contains no DSN and no connection flags.
#
# ⛔ EVERY RECIPE CARRIES `-v ON_ERROR_STOP=1`, ADDED 2026-09-07 (review MED-2).
# Without it, `psql -c` reports a FAILED statement and still exits 0. The
# `rows=` protocol below does catch that — the errored statement printed no
# header — but it hands the operator the WRONG DIAGNOSIS: "the reader did not
# begin with a rows= header" instead of "the query ERRORED, here is why". A gate
# that refuses for a reason that is not the true reason is one confused debugging
# session away from being "fixed" into a pass. `ON_ERROR_STOP=1` makes the reader
# exit non-zero, which lands on the reader-exited-<rc> branch instead.
# ⚠️ `ALLOC_BODY_FETCH_CMD` HAS NO ROW PROTOCOL AT ALL — it returns plain text.
# `ON_ERROR_STOP=1` is therefore load-bearing there rather than merely
# clarifying: without it a permission-denied fetch exits 0 with empty stdout and
# surfaces as "the body fetcher returned EMPTY output", which reads as an
# extraction problem when the true fact is that the credential could not read the
# catalogue at all.
#
#   ALLOC_DB_IDENTITY_CMD   ⭐ the IDENTITY assertion's reader. Two statements,
#     one protocol. The marker is a hand-set `COMMENT ON DATABASE` that each
#     project carries naming itself; `current_database()` is `postgres` on BOTH
#     projects and therefore discriminates nothing.
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM pg_database
#            WHERE datname = current_database()
#              AND shobj_description(oid, 'pg_database') IS NOT NULL" \
#       -c "SELECT shobj_description(oid, 'pg_database') FROM pg_database
#            WHERE datname = current_database()
#              AND shobj_description(oid, 'pg_database') IS NOT NULL"
#     ⛔ The `IS NOT NULL` in the COUNT is what makes a marker-less database
#     report `rows=0` rather than `rows=1` with an empty payload. Both refuse,
#     but only the first refuses with the reason that is TRUE: the marker is
#     absent, so this run cannot tell which database it is on. Re-set the
#     COMMENT before proceeding; do NOT relax the assertion.
#
#   ALLOC_SIGNATURE_CMD
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM pg_proc p
#             JOIN pg_namespace n ON n.oid = p.pronamespace
#            WHERE n.nspname='public'
#              AND p.proname='create_allocator_connected_strategy'" \
#       -c "SELECT string_agg(format_type(a.typid, NULL), ', ' ORDER BY a.ord)
#             FROM pg_proc p
#             JOIN pg_namespace n ON n.oid = p.pronamespace
#             CROSS JOIN LATERAL unnest(p.proargtypes)
#                  WITH ORDINALITY AS a(typid, ord)
#            WHERE n.nspname='public'
#              AND p.proname='create_allocator_connected_strategy'
#            GROUP BY p.oid ORDER BY p.oid"
#
#   ALLOC_BODY_FETCH_CMD  ⚠️ NO ROW PROTOCOL — see the note above.
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT pg_get_functiondef(p.oid) FROM pg_proc p
#             JOIN pg_namespace n ON n.oid = p.pronamespace
#            WHERE n.nspname='public'
#              AND p.proname='create_allocator_connected_strategy'"
#
#   ALLOC_DEPENDENTS_CMD  ⚠️ NO EXISTING ZERO-DEPENDENTS READ EXISTS IN THIS
#     REPOSITORY TO COPY. The join below is standard PostgreSQL catalogue usage,
#     not a codebase pattern: pg_depend rows whose `refobjid` is the function's
#     oid in the pg_proc catalogue (`refclassid = 'pg_proc'::regclass`) are the
#     objects that depend ON it. The `deptype <> 'i'` filter excludes the
#     INTERNAL self-dependency a function has on itself; `classid <> 0` excludes
#     pinned-system rows. Both exclusions are stated so a reviewer can widen
#     them deliberately rather than discover them.
#     psql -X -A -t -F $'\t' -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM pg_depend d
#            WHERE d.refclassid = 'pg_proc'::regclass
#              AND d.refobjid = (
#                    SELECT p.oid FROM pg_proc p
#                      JOIN pg_namespace n ON n.oid = p.pronamespace
#                     WHERE n.nspname='public'
#                       AND p.proname='create_allocator_connected_strategy')
#              AND d.deptype <> 'i' AND d.classid <> 0" \
#       -c "SELECT c.relname::text AS kind,
#                  pg_describe_object(d.classid, d.objid, d.objsubid) AS identity
#             FROM pg_depend d JOIN pg_class c ON c.oid = d.classid
#            WHERE d.refclassid = 'pg_proc'::regclass
#              AND d.refobjid = (…same subselect…)
#              AND d.deptype <> 'i' AND d.classid <> 0"
#
#   ALLOC_PLPGSQL_CALLERS_CMD  ⭐ (b.2), the reading pg_depend cannot give.
#     A plpgsql body that calls another function records NOTHING in pg_depend;
#     the call is resolved from the body TEXT at execution time. So the ONLY
#     catalogue place an in-database caller is visible is pg_proc.prosrc.
#     The target's own oid is excluded — the function's body naturally mentions
#     nothing, but a self-recursive definition would otherwise report itself and
#     make this assertion refuse forever on a fact that is not a dependency.
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM pg_proc p
#            WHERE p.prosrc ILIKE '%create_allocator_connected_strategy%'
#              AND p.oid <> (
#                    SELECT p2.oid FROM pg_proc p2
#                      JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
#                     WHERE n2.nspname='public'
#                       AND p2.proname='create_allocator_connected_strategy')" \
#       -c "SELECT n.nspname || '.' || p.proname
#                  || '(' || pg_get_function_identity_arguments(p.oid) || ')'
#             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
#            WHERE p.prosrc ILIKE '%create_allocator_connected_strategy%'
#              AND p.oid <> (…same subselect…)
#            ORDER BY 1"
#     ⚠️ The scalar subselect assumes ONE overload. The SIGNATURE assertion runs
#     FIRST and refuses on any other count, so by the time this reader is
#     invoked that assumption has been MEASURED rather than assumed — and if an
#     operator runs the recipe by hand against a two-overload database, psql
#     errors (21000, more than one row) and `ON_ERROR_STOP=1` turns that into a
#     reader failure rather than a silent zero.
#
#   ALLOC_EXTENSION_CMD   ⚠️ IDIOM SOURCE, NOT AN ANALOG. scripts/mutation-
#     runner/run.mjs probes pg_extension for pg_cron the same way; there is NO
#     pg_stat_statements reference anywhere else in this repository except the
#     baseline dump's own extension list, and a DATED dump is not a probe.
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM pg_extension
#            WHERE extname = 'pg_stat_statements'" \
#       -c "SELECT extname FROM pg_extension
#            WHERE extname = 'pg_stat_statements'"
#
#   ALLOC_CALLS_CMD  ⚠️ In this project pg_stat_statements lives in schema
#     `extensions`, so the view is `extensions.pg_stat_statements`.
#     psql -X -A -t -v ON_ERROR_STOP=1 \
#       -c "SELECT 'rows=' || count(*) FROM extensions.pg_stat_statements s
#            WHERE s.queryid IN (
#              SELECT queryid FROM extensions.pg_stat_statements
#               WHERE query ILIKE '%create_allocator_connected_strategy%')" \
#       -c "SELECT 'calls=' || s.calls FROM extensions.pg_stat_statements s
#            WHERE s.query ILIKE '%create_allocator_connected_strategy%'"
#
# ── USAGE (paste VERBATIM — mode identity) ───────────────────────────────────
#   bash scripts/preflight-drop-allocator-fn.sh                  # pre-removal
#   bash scripts/preflight-drop-allocator-fn.sh --expect-absent  # post-apply
#   bash scripts/preflight-drop-allocator-fn.sh --self-test      # no credential
set -euo pipefail

GATE="DRIFT-04 pre-flight (create_allocator_connected_strategy)"
FN_SCHEMA="public"
FN_NAME="create_allocator_connected_strategy"

# ⛔ An INDEPENDENT hard pin, not derived from the baseline. The baseline is
# also the source the expected TYPE list is parsed out of, so a parser that
# silently returned a short list would agree with a baseline-derived count by
# construction. 11 is the number the plan measured by hand at
# supabase/schema/baseline.sql:2618.
EXPECTED_NARGS=11

# ── DISTINCT EXIT CODES, so every abort is machine-distinguishable ───────────
# The plan requires that "pg_stat_statements ABSENT" and "pg_stat_statements
# PRESENT with zero rows" differ in BOTH printed text and exit code. They do:
# 6 versus 0. The rest are separated on the same principle — a caller must never
# have to parse prose to learn which assertion refused.
EX_USAGE=1              # unusable invocation: absent credential, unknown mode
EX_MEASURE=2            # MEASURE_FAIL: a measurement could not be TAKEN
EX_SIGNATURE=3          # the signature assertion measured a mismatch
EX_BODY=4               # (a) the live body measured different from baseline
EX_DEPENDENTS=5         # (b) at least one dependent object measured
EX_STATS_UNAVAILABLE=6  # (c) pg_stat_statements measured ABSENT — D-02 abort
EX_IDENTITY=7           # IDENTITY: this run is not reading the expected database
EX_PLPGSQL_CALLERS=8    # (b.2) at least one in-database plpgsql caller measured
# ⛔ 7 and 8 are DISTINCT codes rather than reuses of 3 and 5, on this file's own
# stated principle: a caller must never have to parse prose to learn which
# assertion refused. "The signature does not match" (3) and "I am not on the
# database I was told to read" (7) are different facts with different remedies,
# and so are "a catalogue dependent exists" (5) and "a plpgsql body names this
# function while the catalogue records nothing" (8).
# ⚠️ ANY OTHER NON-ZERO CODE is the shell aborting this script under `set -e`
# before it reached a verdict. It is still a refusal — 0 is emitted from exactly
# two places, both at the very end of a completed assertion run — but it is not
# one of the states below, and it must not be read as one.

fail() {
  local code="$1"; shift
  local line
  for line in "$@"; do echo "::error::${GATE}: ${line}"; done
  exit "$code"
}

# ── MODE, VALIDATED BEFORE ANYTHING ELSE ─────────────────────────────────────
# An UNRECOGNISED argument is a hard failure rather than a silent fall-through:
# a typo'd flag that quietly ran a different assertion set than the caller asked
# for is the same class of lie as a skip that reads as a pass.
MODE="${1:-}"
# ⚠️ INTENTIONAL COLLAPSE, stated because it is invisible otherwise (review LOW):
# an ABSENT first argument and an EMPTY-STRING first argument both become
# `--expect-present`. That direction is the SAFE one — the default runs the FULL
# assertion set, so a caller who fumbles the argument gets more measurement than
# they asked for, never less, and never the `--expect-absent` mode whose pass
# condition is an absence. Widening this to reject the empty string would be
# correct too, and is deliberately not done: `bash "$0" ""` is how the self-test
# harness would have to spell "no argument", and the collapse keeps the default
# path identical in both spellings.
[ -n "$MODE" ] || MODE="--expect-present"
case "$MODE" in
  --expect-present | --expect-absent | --self-test) ;;
  *) fail "$EX_USAGE" "unknown mode '${MODE}'. Usage: $0 [--expect-present|--expect-absent|--self-test]" ;;
esac

# ── 1. WHAT THIS RUN WILL CONSUME: FIRST, UNCONDITIONAL, FATAL WHEN ABSENT ───
#
# ⛔ WHAT THIS DOES AND DOES NOT PROVE (review HIGH-2, stated at the code rather
# than only in the header). It proves the identity PIN carries a value and that
# every reader this MODE invokes unconditionally is configured. It does NOT
# prove — and CANNOT prove — that any measurement in this run read PRODUCTION:
# every reader is a free-form command prefix taken from the environment, so a
# CONFIGURED reader is a command that exists, not a database that was reached.
# "The credential check is the FIRST thing this script does" is TRUE and it is
# still not an identity claim. `assert_database_identity` below is the
# measurement that closes it, and `ALLOC_EXPECT_DB_MARKER` heads this list for
# exactly that reason: the identity assertion is not optional, so its pin is a
# credential.
#
# ⭐ NARROWED 2026-09-07 (founder decision). This loop used to also demand
# SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD, none of
# which this file has ever read — and on the reader path that actually works
# (`supabase db query --linked`, authenticating with the CLI's stored token) no
# database password exists to supply, so the demand forced an operator to
# fabricate a value in order to pass a gate. ⛔ NOTHING WAS WEAKENED. The list got
# LONGER: the reader commands that were previously caught only lazily, mid-run,
# by `run_reader` are asserted HERE, before any measurement is attempted. Every
# refusal this file could make before, it still makes.
assert_credentials() {
  local mode="$1"
  local var
  # ⛔ MODE-SCOPED ON PURPOSE. `--expect-absent` runs IDENTITY and the inverted
  # signature assertion and nothing else — (a), (b.1), (b.2) and (c) have no
  # subject once the object is gone — so demanding their readers in that mode
  # would re-introduce the very defect being fixed: a value the run will never
  # consume. The scoping is proven by a self-test arm, not asserted here.
  local -a required=(ALLOC_EXPECT_DB_MARKER ALLOC_DB_IDENTITY_CMD ALLOC_SIGNATURE_CMD)
  if [ "$mode" != "--expect-absent" ]; then
    required+=(ALLOC_BODY_FETCH_CMD ALLOC_DEPENDENTS_CMD ALLOC_PLPGSQL_CALLERS_CMD ALLOC_EXTENSION_CMD)
  fi
  # ⛔ ALLOC_CALLS_CMD is absent from BOTH lists by design — it is invoked only
  # when the availability probe reports PRESENT. Its refusal lives in
  # `run_reader` and has its own arm; see the header's reader block.
  for var in "${required[@]}"; do
    if [ -z "${!var:-}" ]; then
      echo "::error::${GATE}: ${var} is not configured, so this pre-flight CANNOT read PROD."
      echo "::error::This is a HARD FAILURE, not a skip. A pre-flight that reports success while"
      echo "::error::unconfigured would authorise a one-way production removal on the strength of"
      echo "::error::measurements it never took."
      if [ "$var" = "ALLOC_EXPECT_DB_MARKER" ]; then
        echo "::error::ALLOC_EXPECT_DB_MARKER is the substring the live database's own COMMENT ON DATABASE"
        echo "::error::must contain. Without it this run cannot assert WHICH database it read, and every"
        echo "::error::verdict below — including --expect-absent's 'NOT FOUND' — would be a statement"
        echo "::error::about an unidentified database. Set it to the marker of the project you intend"
        echo "::error::to measure; do not remove this assertion."
      else
        echo "::error::${var} is a catalogue READER that mode ${mode} invokes UNCONDITIONALLY. A reader"
        echo "::error::that is not configured takes no measurement, and a measurement never taken is"
        echo "::error::never a measurement that passed. This matters most in --expect-absent, whose"
        echo "::error::pass condition is an ABSENCE ('rows=0') — a state that silence also produces."
        echo "::error::Set it to the recipe recorded in this file's header. Do NOT remove it from this"
        echo "::error::list to make the run start."
      fi
      exit "$EX_USAGE"
    fi
  done
}

# ── THE `rows=<N>` READER, AND WHY THE HEADER IS MANDATORY ───────────────────
# Sets READER_ROWS and writes the payload lines to <payload>. A reader that
# exits non-zero, that omits the header, that emits a malformed count, or whose
# payload line count contradicts its own header is a MEASURE_FAIL — never a
# zero. This is the mechanism, not the aspiration: an empty stdout has no
# `rows=` header, so it cannot reach the zero branch at all.
READER_ROWS=0
run_reader() {
  local label="$1" cmd="$2" raw="$3" payload="$4"
  [ -n "$cmd" ] || fail "$EX_USAGE" \
    "the ${label} reader command is unset. There is no way to take this measurement, and a pre-flight that cannot measure cannot report that the measurement passed."
  local rc=0
  # shellcheck disable=SC2086  # word-split on IFS by contract; see ENVIRONMENT.
  $cmd > "$raw" 2>"${raw}.err" || rc=$?
  [ "$rc" -eq 0 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the ${label} reader exited ${rc} (stderr withheld — this repository is PUBLIC)." \
    "A reader that failed did not measure zero. This run took no verdict on ${label}."
  # `head`'s own status is captured rather than swallowed: an unreadable file and
  # an empty one both yield an empty `first`, and they are different facts. Both
  # refuse, but they refuse with the reason that is true.
  local first head_rc=0
  set +e
  first="$(head -n 1 "$raw" 2>/dev/null)"
  head_rc=$?
  set -e
  [ "$head_rc" -eq 0 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not READ the ${label} reader's output (head exited ${head_rc})." \
    "Output this run could not read is not output that measured zero."
  case "$first" in
    rows=*) ;;
    *)
      fail "$EX_MEASURE" \
        "MEASURE_FAIL — the ${label} reader did not begin with a 'rows=<N>' header." \
        "It emitted $( [ -s "$raw" ] && echo "a first line that is not a row header" || echo "NOTHING AT ALL" )." \
        "⛔ D-02. An absent measurement is never read as a measured zero. A reader that" \
        "prints nothing fails HERE, at the protocol, rather than arriving downstream as" \
        "'rows=0' and being reported as evidence of absence."
      ;;
  esac
  local n="${first#rows=}"
  case "$n" in
    '' | *[!0-9]*)
      fail "$EX_MEASURE" \
        "MEASURE_FAIL — the ${label} reader's row header was '${first}', which does not carry a non-negative integer count."
      ;;
  esac
  tail -n +2 "$raw" | sed '/^[[:space:]]*$/d' > "$payload"
  # grep exit discipline (0 = counted rows, 1 = zero rows, >= 2 = could not
  # read), copied from scripts/test-ledger-drift-check.sh. An uncountable
  # payload is not an empty one.
  local got grc=0
  set +e
  got="$(grep -ac '' "$payload")"
  grc=$?
  set -e
  [ "$grc" -le 1 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not count the ${label} reader's payload lines (grep exited ${grc})."
  got="${got:-0}"
  [ "$got" = "$n" ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the ${label} reader declared rows=${n} but emitted ${got} payload line(s)." \
    "A reader whose own two statements disagree has not measured anything this run can use."
  READER_ROWS="$n"
}

# ── THE EXPECTED SIGNATURE, PARSED OUT OF THE COMMITTED BASELINE ─────────────
# Reads the argument list of the committed definition and prints one normalized
# argument TYPE per line. Deliberately anchors on the function NAME and the next
# balanced parenthesis rather than on any DDL keyword — this file contains no
# DDL verbs, by its plan's acceptance criteria.
#
# ⚠️ STATED LIMIT: argument MODES. This parser strips a leading in/out/inout/
# variadic keyword so a moded argument is read as its type. The live reader's
# `proargtypes` covers IN and INOUT arguments only, so a definition carrying OUT
# arguments in its parenthesised list would produce two lists of different
# LENGTHS and refuse — loudly, which is the correct direction. This function has
# no moded arguments (it returns TABLE), so the limit is latent today.
derive_expected_arg_types() {
  local defn_file="$1"
  node -e '
const fs = require("node:fs");
const [file, name] = process.argv.slice(1);
const src = fs.readFileSync(file, "utf8");
const at = src.indexOf(name);
if (at < 0) { console.error("name not present in the extracted definition"); process.exit(3); }
const open = src.indexOf("(", at);
if (open < 0) { console.error("no argument list follows the function name"); process.exit(3); }
let depth = 0, close = -1;
for (let i = open; i < src.length; i++) {
  const ch = src[i];
  if (ch === "(") depth++;
  else if (ch === ")") { depth--; if (depth === 0) { close = i; break; } }
}
if (close < 0) { console.error("unbalanced argument list"); process.exit(3); }
const inner = src.slice(open + 1, close);
const parts = [];
let buf = "", d = 0, q = false;
for (let i = 0; i < inner.length; i++) {
  const ch = inner[i];
  if (ch === "\"") q = !q;
  if (!q && ch === "(") d++;
  if (!q && ch === ")") d--;
  if (!q && d === 0 && ch === ",") { parts.push(buf); buf = ""; continue; }
  buf += ch;
}
if (buf.trim() !== "") parts.push(buf);
const MODES = new Set(["in", "out", "inout", "variadic"]);
const out = [];
for (const raw of parts) {
  let s = raw.trim();
  if (s === "") continue;
  // Strip a leading argument-mode keyword, then the parameter NAME (quoted or
  // bare). Whatever remains is the TYPE.
  const eat = () => {
    if (s.startsWith("\"")) {
      const e = s.indexOf("\"", 1);
      const tok = s.slice(1, e);
      s = s.slice(e + 1).trim();
      return tok;
    }
    const m = s.match(/^[^\s]+/);
    const tok = m ? m[0] : "";
    s = s.slice(tok.length).trim();
    return tok;
  };
  let tok = eat();
  if (MODES.has(tok.toLowerCase())) tok = eat();
  const type = s.replace(/"/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (type === "") { console.error("argument '" + tok + "' has no type"); process.exit(3); }
  out.push(type);
}
if (out.length === 0) { console.error("the argument list parsed to zero arguments"); process.exit(3); }
process.stdout.write(out.join("\n") + "\n");
' "$defn_file" "$FN_NAME"
}

# ── IDENTITY ASSERTION — THE POSITIVE CONTROL ────────────────────────────────
#
# ⛔ THIS IS THE ONLY ASSERTION IN THIS FILE THAT BINDS A MEASUREMENT TO A
#    DATABASE. Everything below it measures the SHAPE of whatever the readers
#    happen to be pointed at. Added 2026-09-07 for review HIGH-1 and HIGH-2.
#
# ⛔ WHY IT IS A POSITIVE CONTROL AND NOT MERELY ANOTHER CHECK. Every other
#    assertion in this file is self-defending in `--expect-present`: a reader
#    pointed at the wrong database (or at nothing) yields `rows=0`, which
#    `assert_signature present` refuses. `--expect-absent` INVERTS exactly that
#    predicate — `rows=0` becomes the PASS — so in that mode the same broken
#    reader produces "verdict: NOT FOUND" and exit 0. MEASURED before this fix,
#    with a reader that was literally `printf 'rows=0\n'` and no database
#    anywhere: exit 0, "NOT FOUND — zero overloads measured in the live
#    catalogue". That is a check that CANNOT FAIL, in the one mode whose whole
#    job is to record that a ONE-WAY production removal took effect.
#
#    A positive control fixes that class, and only a positive control can: it is
#    an assertion whose PASS requires the measurement apparatus to have
#    genuinely reached the subject. `rows=1` for a row that must exist on the
#    real database, carrying a marker that must match, cannot be produced by a
#    reader that reads nothing — while `rows=0` can be produced by anything,
#    including silence.
assert_database_identity() {
  echo "IDENTITY (which database did this run actually read?)"
  run_reader "database identity" "${ALLOC_DB_IDENTITY_CMD:-}" "$TMP/ident.raw" "$TMP/ident.txt"
  local marked="$READER_ROWS"
  echo "  pg_database rows with a non-null COMMENT for current_database(): ${marked}"

  # ⛔ The NULL case. A SQL NULL marker renders as an empty line; the row
  #    protocol strips blank payload lines, so a database whose COMMENT was lost
  #    reports either rows=0 here or a rows=1/0-payload self-contradiction
  #    upstream. Both refuse. NEITHER is ever rendered as "identity confirmed".
  if [ "$marked" -eq 0 ]; then
    fail "$EX_IDENTITY" \
      "the live database carries NO 'COMMENT ON DATABASE' marker, so this run CANNOT NAME the" \
      "database it just connected to. current_database() is 'postgres' on every project in this" \
      "org and discriminates nothing; the hand-set comment is the only discriminator there is." \
      "⛔ This is also the POSITIVE CONTROL for --expect-absent. A reader that reached no" \
      "database at all produces this same refusal, which is the point: an absence measured by an" \
      "apparatus that demonstrably reached nothing is not a measured absence." \
      "Re-set the marker on the intended project before re-running. Do NOT relax this assertion."
  fi
  if [ "$marked" -ne 1 ]; then
    fail "$EX_IDENTITY" \
      "the identity reader returned ${marked} rows for current_database(), which is not one." \
      "A run that cannot resolve its own database to a single marked row has not identified it."
  fi

  # ⚠️ COMPARED, NEVER PRINTED. This repository is PUBLIC (NON-NEGOTIABLE 2).
  # Only the verdict is emitted — never the marker, never the expectation.
  local grc=0
  set +e
  grep -aqF -- "$ALLOC_EXPECT_DB_MARKER" "$TMP/ident.txt"
  grc=$?
  set -e
  # grep exit discipline: 0 = matched, 1 = did not match, >= 2 = could not read.
  # The third is a MEASURE_FAIL and must not join the second's branch — an
  # unreadable marker file is not a marker that failed to match.
  [ "$grc" -le 1 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not READ the identity reader's payload (grep exited ${grc})." \
    "A marker this run could not read is not a marker that mismatched, and is not one that matched."
  [ "$grc" -eq 0 ] || fail "$EX_IDENTITY" \
    "the live database's marker does NOT contain ALLOC_EXPECT_DB_MARKER." \
    "⛔ This run is reading a database other than the one it was told to measure. Neither the" \
    "marker nor the expectation is printed — this repository is PUBLIC — but they disagree." \
    "Every verdict below would have been a statement about the wrong database, and in" \
    "--expect-absent that statement would have been 'the removal took effect'."
  echo "  marker vs ALLOC_EXPECT_DB_MARKER                                : MATCHED"
  echo "  verdict                                                         : IDENTITY CONFIRMED — the readers reached the intended database."
  echo "  ⚠️ STATED BOUND: the readers are independent command prefixes, so this proves the"
  echo "     identity reader reached the intended database moments before the assertions below"
  echo "     ran under the same reader configuration. It cannot force one TCP session, and an"
  echo "     operator who points two readers at two databases defeats it."
  return 0
}

# ── SIGNATURE ASSERTION ──────────────────────────────────────────────────────
# Runs BEFORE (a), (b) and (c). This is the assertion the existence-tolerant
# modifier would have swallowed: with it, a removal aimed at a signature PROD
# does not hold succeeds while removing nothing, and every downstream claim
# ("the function is gone") is a verdict over an operation that did not happen.
assert_signature() {
  local expect="$1"   # present | absent

  run_reader "signature" "${ALLOC_SIGNATURE_CMD:-}" "$TMP/sig.raw" "$TMP/sig.txt"
  local overloads="$READER_ROWS"
  echo "SIGNATURE"
  echo "  function                 : ${FN_SCHEMA}.${FN_NAME}"
  echo "  live overload(s) measured: ${overloads}"

  if [ "$expect" = "absent" ]; then
    if [ "$overloads" -ne 0 ]; then
      echo "::error::${GATE}: the function is still PRESENT in ${overloads} overload(s):"
      sed 's|^|::error::    live: |' "$TMP/sig.txt"
      fail "$EX_SIGNATURE" \
        "This run was invoked with --expect-absent, i.e. to confirm the removal took effect." \
        "It did not. Do NOT record the removal as done."
    fi
    echo "  verdict                  : NOT FOUND — zero overloads measured in the live catalogue."
    return 0
  fi

  if [ "$overloads" -eq 0 ]; then
    fail "$EX_SIGNATURE" \
      "the live catalogue holds ZERO overloads named ${FN_SCHEMA}.${FN_NAME}." \
      "The committed baseline records one. Either PROD already lost it out of band, or this" \
      "credential is not reading the database the baseline was captured from. Neither is a" \
      "state in which a removal migration should be authorised, and a removal written against" \
      "an absent function is exactly the vacuous pass the existence-tolerant modifier produces."
  fi
  if [ "$overloads" -ne 1 ]; then
    echo "::error::${GATE}: ${overloads} overloads are live; the removal names ONE signature:"
    sed 's|^|::error::    live: |' "$TMP/sig.txt"
    fail "$EX_SIGNATURE" \
      "A removal that names one signature leaves the others reachable, and this function is" \
      "SECURITY DEFINER over credential material. Disposition every overload before proceeding."
  fi

  # ── the TYPE comparison ────────────────────────────────────────────────────
  node "$NRM" --extract-fn "$BASELINE" "$FN_NAME" > "$TMP/base.defn.sql" \
    || fail "$EX_MEASURE" "MEASURE_FAIL — ${NRM} could not extract ${FN_NAME} from ${BASELINE}."
  # ⛔ F-03 IDIOM, corrected 2026-09-07 (review LOW). `grep -q` exits 0/1/2 and
  # `|| fail` collapses 1 (no match) and 2 (COULD NOT READ) into one branch, so
  # an unreadable extract refused with the WRONG reason — "yielded NO definition"
  # rather than "could not be read". Same class as the fix at the fetched-body
  # check below, which already branched correctly; made consistent here.
  local brc=0
  set +e
  grep -aqE '[^[:space:]]' "$TMP/base.defn.sql"
  brc=$?
  set -e
  [ "$brc" -le 1 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not READ the definition extracted from ${BASELINE} (grep exited ${brc})." \
    "An extract this run could not read is not an extract that was empty."
  [ "$brc" -eq 0 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — ${BASELINE} yielded NO definition for ${FN_NAME}." \
    "A baseline this run could not read is not a baseline that agrees with PROD."

  derive_expected_arg_types "$TMP/base.defn.sql" > "$TMP/expected-types.txt" \
    || fail "$EX_MEASURE" "MEASURE_FAIL — could not parse the committed definition's argument list out of ${BASELINE}."

  # ⛔ NOT `$(grep -ac '' … || true)`. That idiom is SP-C06's shape: `grep` exits
  # 0 when it counted rows, 1 when there are none and >= 2 on an ERROR, and
  # `|| true` collapses all three, so an UNREADABLE list would arrive here as a
  # count of zero — refused below, but refused with the wrong reason and one
  # message away from being "fixed" into a pass. Captured and branched instead.
  local expected_n exp_rc=0
  set +e
  expected_n="$(grep -ac '' "$TMP/expected-types.txt")"
  exp_rc=$?
  set -e
  [ "$exp_rc" -le 1 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not COUNT the argument types parsed out of ${BASELINE} (grep exited ${exp_rc})." \
    "A list this run could not read is not a list of zero arguments."
  expected_n="${expected_n:-0}"
  [ "$expected_n" = "$EXPECTED_NARGS" ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the committed baseline parsed to ${expected_n} argument(s), but this" \
    "pre-flight pins ${EXPECTED_NARGS} independently of that parse. Either the baseline changed or the" \
    "parser stopped reading the whole list; both make the type comparison below a comparison" \
    "against an unknown, so it is not attempted."

  local expected_sig live_sig
  expected_sig="$(tr '\n' ',' < "$TMP/expected-types.txt" | sed 's/,$//' | sed 's/,/, /g')"
  live_sig="$(sed -e 's/[[:space:]]\{1,\}/ /g' -e 's/^ //' -e 's/ $//' "$TMP/sig.txt" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]*,[[:space:]]*/, /g')"

  echo "  expected argument types  : ${expected_sig}"
  echo "  live argument types      : ${live_sig}"
  echo "  argument count           : expected ${EXPECTED_NARGS}, pinned independently of the baseline parse"

  [ "$expected_sig" = "$live_sig" ] || fail "$EX_SIGNATURE" \
    "the live argument TYPES differ from the committed baseline's." \
    "A removal naming the baseline's 11 types would not match this overload. With the" \
    "existence-tolerant modifier that mismatch is a SILENT no-op — the migration applies," \
    "the self-verifying block sees no surviving row for the signature it looked up, and the" \
    "function stays live. That is why the modifier is refused and why this assertion exists."
  echo "  verdict                  : MATCH — one overload, ${EXPECTED_NARGS} arguments, types equal."
  return 0
}

# ── (a) LIVE BODY vs COMMITTED BASELINE ──────────────────────────────────────
assert_body() {
  echo ""
  echo "(a) LIVE BODY vs ${BASELINE}"
  # ⛔ ORDERING, asserted rather than assumed. `$TMP/base.defn.sql` is produced
  # by assert_signature. A reorder that ran (a) first would hand the comparator a
  # missing file, and the failure would surface as a normalizer error naming
  # nothing. Named here instead, so the cause is in the message.
  [ -s "$TMP/base.defn.sql" ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the committed definition has not been extracted yet." \
    "Assertion (a) runs AFTER the signature assertion, which is what extracts it. Nothing was compared."
  [ -n "${ALLOC_BODY_FETCH_CMD:-}" ] || fail "$EX_USAGE" \
    "ALLOC_BODY_FETCH_CMD is unset — there is no way to read PROD's definition, and a run that cannot read it cannot report that it matches."
  local rc=0
  # shellcheck disable=SC2086
  $ALLOC_BODY_FETCH_CMD > "$TMP/live.defn.sql" 2>"$TMP/live.defn.err" || rc=$?
  [ "$rc" -eq 0 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the body fetcher exited ${rc} (stderr withheld — this repository is PUBLIC)." \
    "A body this run could not fetch is not a body that matches."

  local lrc=0
  set +e
  grep -aqE '[^[:space:]]' "$TMP/live.defn.sql"
  lrc=$?
  set -e
  [ "$lrc" -le 1 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — could not READ the fetched definition (grep exited ${lrc})."
  [ "$lrc" -eq 0 ] || fail "$EX_MEASURE" \
    "MEASURE_FAIL — the body fetcher returned EMPTY output." \
    "The signature assertion above already measured the overload PRESENT, so an empty body" \
    "is an extraction failure, not an absence. It is never reported as 'nothing to compare'."

  node "$NRM" --diff-bodies "$TMP/base.defn.sql" "$TMP/live.defn.sql" > "$TMP/diff.rows" \
    || fail "$EX_MEASURE" "MEASURE_FAIL — ${NRM} could not compare the two definitions."

  local rows=0 status name nargs base_hash live_hash hunks
  local seen_status="" seen_name="" seen_nargs="" seen_base="" seen_live="" seen_hunks=""
  while IFS=$'\t' read -r status name nargs base_hash live_hash hunks; do
    [ -n "${status:-}" ] || continue
    rows=$((rows + 1))
    seen_status="$status"; seen_name="$name"; seen_nargs="$nargs"
    seen_base="$base_hash"; seen_live="$live_hash"; seen_hunks="$hunks"
  done < "$TMP/diff.rows"

  # Defensive, and stated as such: with a non-empty baseline definition the
  # comparator always emits at least a SNAPSHOT_ONLY row, so zero rows is not a
  # state this script can currently produce. It is refused rather than assumed
  # unreachable, because "the comparator returned nothing" must never fall
  # through to a verdict.
  if [ "$rows" -eq 0 ]; then
    fail "$EX_MEASURE" \
      "MEASURE_FAIL — the comparison produced NO rows at all, so nothing was compared."
  fi
  if [ "$rows" -ne 1 ]; then
    fail "$EX_MEASURE" \
      "MEASURE_FAIL — the comparison produced ${rows} rows for a single-overload function."
  fi

  echo "  function/args : ${seen_name}/${seen_nargs}"
  echo "  baseline sha256: ${seen_base}"
  echo "  live     sha256: ${seen_live}"
  echo "  differing lines: ${seen_hunks}"
  echo "  status         : ${seen_status}"

  case "$seen_status" in
    MATCH)
      echo "  verdict        : MATCH — the live definition equals the committed baseline's, normalized."
      ;;
    DRIFT)
      fail "$EX_BODY" \
        "the live definition DIFFERS from the committed baseline's." \
        "The baseline is what makes this removal reversible: a revert migration is cut from" \
        "supabase/schema/baseline.sql. If the live body is not that body, the revert would" \
        "restore something PROD never ran, and the reviewers approved a body that is not the" \
        "one being removed. Both hashes and the differing-line count are printed above."
      ;;
    SNAPSHOT_ONLY)
      # ⛔ The signature assertion above ALREADY measured this overload PRESENT
      # in the live catalogue. So "the committed baseline has a definition and
      # the fetched text has none" is an EXTRACTION FAILURE, not an absence —
      # the fetcher returned bytes (a psql notice, an error line, a stray
      # comment) that carry no definition. Reporting it as anything other than a
      # refusal would be a verdict over a comparison that never happened.
      fail "$EX_MEASURE" \
        "MEASURE_FAIL — the fetched text carried NO extractable definition for ${FN_NAME}." \
        "The signature assertion measured the overload PRESENT, so this is an extraction" \
        "failure and never an absence. 'Could not extract' and 'compared and matched' do not" \
        "share a code path here."
      ;;
    *)
      fail "$EX_MEASURE" \
        "MEASURE_FAIL — the comparison returned status '${seen_status}', which is neither a" \
        "measured match nor a measured difference. A body that could not be compared is not a" \
        "body that matched."
      ;;
  esac
  return 0
}

# ── (b) ZERO DEPENDENTS — TWO READINGS, BECAUSE ONE IS STRUCTURALLY BLIND ────
#
# ⛔ (b.1) ALONE IS NOT A COMPLETENESS CLAIM, and used to be worded as one.
#    Review MED-1: a plpgsql function body that CALLS another function creates
#    NO pg_depend row — the call is resolved out of the body TEXT at execution
#    time, never recorded in the catalogue. So (b.1) printed "ZERO — nothing in
#    the catalogue depends on this overload" while an in-database caller sat
#    invisible to it. Worse, the removal does not catch that caller either: it
#    correctly refuses the dependent-removing modifier, but a bare removal does
#    not ABORT on a textual caller — it SUCCEEDS, and the caller breaks at
#    RUNTIME, after the one-way DDL, with nothing left to roll back.
#    (b.2) measures that class. It is the one caller class this run CAN measure;
#    PostgREST callers remain out of reach and are named as such in the closing
#    scope notice, which no longer implies (b) covered them.
assert_dependents() {
  echo ""
  echo "(b.1) CATALOGUE DEPENDENTS (pg_depend joined to pg_proc on this overload's oid)"
  run_reader "dependents" "${ALLOC_DEPENDENTS_CMD:-}" "$TMP/dep.raw" "$TMP/dep.txt"
  echo "  dependent row(s) measured: ${READER_ROWS}"
  if [ "$READER_ROWS" -ne 0 ]; then
    echo "::error::${GATE}: ${READER_ROWS} object(s) depend on ${FN_SCHEMA}.${FN_NAME}:"
    sed 's|^|::error::    dependent: |' "$TMP/dep.txt"
    fail "$EX_DEPENDENTS" \
      "The removal names no dependent-removing modifier, so it would ABORT at apply time —" \
      "mid-file, on the auto-apply-to-PROD route. That is the loud outcome and it is the one" \
      "we want, but it belongs HERE and not in a production apply. Disposition each dependent" \
      "above first. Adding the dependent-removing modifier would silently remove them instead," \
      "which is the outcome this pre-flight exists to make impossible to reach by accident."
  fi
  echo "  verdict                  : ZERO pg_depend rows reference this overload."
  echo "  ⚠️ SCOPE OF THIS LINE: pg_depend ONLY. It is BLIND to a plpgsql body that calls the"
  echo "     function by name — such a call records nothing in the catalogue. That class is"
  echo "     measured separately in (b.2) below; this verdict never stood for it."

  echo ""
  echo "(b.2) IN-DATABASE plpgsql CALLERS (pg_proc.prosrc naming the function, excluding its own oid)"
  run_reader "plpgsql callers" "${ALLOC_PLPGSQL_CALLERS_CMD:-}" "$TMP/callers.raw" "$TMP/callers.txt"
  echo "  caller row(s) measured   : ${READER_ROWS}"
  if [ "$READER_ROWS" -ne 0 ]; then
    echo "::error::${GATE}: ${READER_ROWS} in-database function body/bodies NAME ${FN_SCHEMA}.${FN_NAME}:"
    sed 's|^|::error::    caller: |' "$TMP/callers.txt"
    fail "$EX_PLPGSQL_CALLERS" \
      "⛔ THE REMOVAL WILL NOT CATCH THESE. A plpgsql call records no pg_depend row, so (b.1)" \
      "measured zero and the removal statement — which correctly carries no dependent-removing" \
      "modifier — does not abort on them either. It SUCCEEDS, and each caller above starts" \
      "failing at RUNTIME, after a one-way production DDL, with nothing to roll back." \
      "Disposition every caller listed before the removal merges. A TEXT scan over-reports (the" \
      "name in a comment or a string literal matches), so a hit may be benign — but it is a" \
      "human who decides that, from the list above, and never this script by widening the scan."
  fi
  echo "  verdict                  : ZERO — no other function body in the catalogue names this function."
  echo "  ⚠️ STATED BOUND: a prosrc TEXT scan. It over-reports (comments, string literals) and"
  echo "     under-reports (a caller that builds the name dynamically). Over-reporting is the"
  echo "     safe direction. Together (b.1) and (b.2) cover catalogue dependents and in-database"
  echo "     textual callers; they do NOT cover callers outside the database."
  return 0
}

# ── (c) CALL EVIDENCE — D-02 APPLIES TWICE ───────────────────────────────────
# ⛔ THE TWO STATES BELOW MUST NEVER BE FOLDED INTO ONE BRANCH.
#   pg_stat_statements ABSENT            -> ABORT, exit ${EX_STATS_UNAVAILABLE}.
#                                           The measurement was UNAVAILABLE.
#   pg_stat_statements PRESENT, no entry -> evidence, exit 0. Zero calls were
#                                           OBSERVED in the current window.
# Only the second is evidence. An absent extension is never rendered as a zero.
assert_call_evidence() {
  echo ""
  echo "(c) CALL EVIDENCE"
  run_reader "pg_stat_statements availability probe" "${ALLOC_EXTENSION_CMD:-}" "$TMP/ext.raw" "$TMP/ext.txt"
  local installed="$READER_ROWS"
  echo "  pg_extension rows named pg_stat_statements: ${installed}"

  if [ "$installed" -eq 0 ]; then
    echo "::error::${GATE}: CALL EVIDENCE UNAVAILABLE — pg_stat_statements is NOT INSTALLED."
    fail "$EX_STATS_UNAVAILABLE" \
      "⛔ D-02. This run measured that the measurement CANNOT BE TAKEN. It did not measure" \
      "zero calls, and it must never be reported as having done so. There is no evidence" \
      "either way about whether anything calls this function, so the removal is not" \
      "authorised by this run. Install the extension, or take the decision on some other" \
      "evidence and record WHICH — but not on this run's silence." \
      "(Exit ${EX_STATS_UNAVAILABLE}; a PRESENT extension with no entry for the function exits 0 and prints" \
      "a different sentence entirely.)"
  fi

  echo "  availability                              : PRESENT — a reading can be taken."
  run_reader "call count" "${ALLOC_CALLS_CMD:-}" "$TMP/calls.raw" "$TMP/calls.txt"
  local entries="$READER_ROWS"
  echo "  pg_stat_statements entries for the function: ${entries}"

  if [ "$entries" -eq 0 ]; then
    echo "  observed calls                            : 0 — zero calls OBSERVED."
    echo "  verdict                                   : EVIDENCE TAKEN. The extension is installed and reports"
    echo "                                              no entry for this function, so no call to it was observed."
  else
    local line total=0 n
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      case "$line" in
        calls=*) ;;
        *) fail "$EX_MEASURE" "MEASURE_FAIL — the call-count reader emitted '${line}', which is not a 'calls=<integer>' row." ;;
      esac
      n="${line#calls=}"
      case "$n" in
        '' | *[!0-9]*) fail "$EX_MEASURE" "MEASURE_FAIL — the call-count reader emitted a non-integer count in '${line}'." ;;
      esac
      total=$((total + n))
      echo "  entry                                     : ${line}"
    done < "$TMP/calls.txt"
    echo "  observed calls                            : ${total} across ${entries} entr(y|ies)."
    echo "  verdict                                   : EVIDENCE TAKEN. Calls WERE observed; the removal is a"
    echo "                                              breaking change for whoever issued them."
  fi

  echo "  ⚠️ STATED BOUND: pg_stat_statements is a bounded, resettable store. It evicts"
  echo "     entries under pressure and is cleared by pg_stat_statements_reset() and by a"
  echo "     server restart. 'Zero calls observed' therefore means zero in the CURRENT"
  echo "     window — it is not, and is never reported as, proof that the function was"
  echo "     never called."
  return 0
}

# ── --self-test ──────────────────────────────────────────────────────────────
#
# ⚠️ SCOPE, stated rather than implied: this proves this script's DECISION LOGIC
# and exit codes with stubbed readers and no credential. It does NOT prove the
# psql recipes in the header, and it does not touch PROD. Those are the first
# credentialed run.
#
# ⛔ ANTI-VACUITY. Every red arm asserts BOTH its exit code AND a substring that
# NAMES its own failing assertion. Exit codes alone are not admissible: a broken
# environment also exits non-zero, so an arm that only checks "non-zero" passes
# when the script is unrunnable. The body fixtures are the REAL committed
# definition, and the drift fixture is a MUTATION of it whose bite is verified
# before the arm runs — a mutation that changed nothing would make the drift arm
# a test of nothing.
self_test() {
  local tmp
  tmp="$(mktemp -d)"
  # ⛔ Split traps, copied from scripts/test-ledger-drift-check.sh. RETURN fires
  # when this function returns and misses every `exit` path; EXIT catches those.
  # A single combined `trap … EXIT INT TERM` is WRONG: a bash signal handler
  # RESUMES the script when it returns.
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local nrm="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
  local baseline="${BASELINE_FILE:-supabase/schema/baseline.sql}"
  [ -f "$nrm" ] || { echo "SELF-TEST FAIL: normalizer not found at ${nrm} (run from the repository root)."; return 1; }
  [ -f "$baseline" ] || { echo "SELF-TEST FAIL: committed baseline not found at ${baseline} (run from the repository root)."; return 1; }

  # ── FIXTURES: the REAL committed definition, and a MUTATION of it ──────────
  node "$nrm" --extract-fn "$baseline" "$FN_NAME" > "$tmp/live.match.sql" \
    || { echo "SELF-TEST FAIL: could not extract ${FN_NAME} from ${baseline}."; return 1; }
  if ! grep -aqE '[^[:space:]]' "$tmp/live.match.sql"; then
    echo "SELF-TEST FAIL: ${baseline} yielded no definition for ${FN_NAME}; every body arm below would be a test of nothing."
    return 1
  fi
  # The mutation targets a string literal, so it survives normalization (which
  # strips comments and collapses whitespace but preserves literals).
  sed "s/'allocator_connected'/'allocator_connected_MUTANT'/" "$tmp/live.match.sql" > "$tmp/live.drift.sql"
  if cmp -s "$tmp/live.match.sql" "$tmp/live.drift.sql"; then
    echo "SELF-TEST FAIL: the drift fixture is BYTE-IDENTICAL to the match fixture — the mutation did not bite, so the body-drift arm below would prove nothing."
    return 1
  fi
  printf 'psql: NOTICE: nothing here is a function definition\n' > "$tmp/live.garbage.sql"

  local SIG_OK='rows=1
uuid, uuid, text, text, text, text, text, text, text, text, integer'

  # ── STUB READERS, driven by env so one script serves every arm ─────────────
  cat > "$tmp/sig.sh" <<'STUB'
#!/usr/bin/env bash
[ "${STUB_SIG_RC:-0}" = "0" ] || exit "$STUB_SIG_RC"
[ -n "${STUB_SIG_OUT:-}" ] && printf '%s\n' "$STUB_SIG_OUT"
exit 0
STUB
  cat > "$tmp/body.sh" <<'STUB'
#!/usr/bin/env bash
[ "${STUB_BODY_RC:-0}" = "0" ] || exit "$STUB_BODY_RC"
[ -n "${STUB_BODY_FILE:-}" ] && cat "$STUB_BODY_FILE"
exit 0
STUB
  cat > "$tmp/dep.sh" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_DEP_OUT:-}" ] && printf '%s\n' "$STUB_DEP_OUT"
exit 0
STUB
  cat > "$tmp/callers.sh" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_CALLERS_OUT:-}" ] && printf '%s\n' "$STUB_CALLERS_OUT"
exit 0
STUB
  cat > "$tmp/ident.sh" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_IDENT_OUT:-}" ] && printf '%s\n' "$STUB_IDENT_OUT"
exit 0
STUB
  cat > "$tmp/ext.sh" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_EXT_OUT:-}" ] && printf '%s\n' "$STUB_EXT_OUT"
exit 0
STUB
  cat > "$tmp/calls.sh" <<'STUB'
#!/usr/bin/env bash
[ -n "${STUB_CALLS_OUT:-}" ] && printf '%s\n' "$STUB_CALLS_OUT"
exit 0
STUB
  chmod +x "$tmp/sig.sh" "$tmp/body.sh" "$tmp/dep.sh" "$tmp/callers.sh" "$tmp/ext.sh" "$tmp/calls.sh" "$tmp/ident.sh"

  # ⛔ The identity fixture is a SUBSTRING relationship, exercised as one: the
  # stub emits a longer sentence than the pin, so a `=` comparison written by
  # mistake in place of the substring test would redden every green arm below.
  local IDENT_MARKER='quantalyze PRODUCTION project (stub fixture) — do not write'
  local IDENT_PIN='quantalyze PRODUCTION project'
  local IDENT_OK="rows=1
${IDENT_MARKER}"

  local pass=0 total=0
  local -a results=()

  # Per-arm inputs, reset before every arm so nothing leaks between them.
  local A_SIG A_SIG_RC A_BODY A_BODY_RC A_DEP A_CALLERS A_EXT A_CALLS A_MODE
  local A_IDENT A_PIN
  # ⭐ ADDED 2026-09-07. The reader COMMANDS are now per-arm inputs rather than
  # hardcoded in `arm`, so an arm can UNSET one. That is what makes the new
  # credential check falsifiable: without it, every arm would supply every
  # reader and no arm could ever observe the check refuse.
  local A_IDENT_CMD A_SIG_CMD A_BODY_CMD A_DEP_CMD A_CALLERS_CMD A_EXT_CMD A_CALLS_CMD
  reset_arm() {
    A_IDENT="$IDENT_OK"; A_PIN="$IDENT_PIN"
    A_SIG="$SIG_OK"; A_SIG_RC=0
    A_BODY="$tmp/live.match.sql"; A_BODY_RC=0
    A_DEP="rows=0"
    A_CALLERS="rows=0"
    A_EXT='rows=1
pg_stat_statements'
    A_CALLS="rows=0"
    A_IDENT_CMD="bash $tmp/ident.sh"
    A_SIG_CMD="bash $tmp/sig.sh"
    A_BODY_CMD="bash $tmp/body.sh"
    A_DEP_CMD="bash $tmp/dep.sh"
    A_CALLERS_CMD="bash $tmp/callers.sh"
    A_EXT_CMD="bash $tmp/ext.sh"
    A_CALLS_CMD="bash $tmp/calls.sh"
    A_MODE="--expect-present"
  }

  # arm <label> <want-exit> <required-substring> [<forbidden-substring>]
  arm() {
    local label="$1" want="$2" needle="$3" forbid="${4:-}"
    total=$((total + 1))
    local rc=0
    STUB_SIG_OUT="$A_SIG" \
    STUB_SIG_RC="$A_SIG_RC" \
    STUB_BODY_FILE="$A_BODY" \
    STUB_BODY_RC="$A_BODY_RC" \
    STUB_DEP_OUT="$A_DEP" \
    STUB_CALLERS_OUT="$A_CALLERS" \
    STUB_IDENT_OUT="$A_IDENT" \
    STUB_EXT_OUT="$A_EXT" \
    STUB_CALLS_OUT="$A_CALLS" \
    ALLOC_DB_IDENTITY_CMD="$A_IDENT_CMD" \
    ALLOC_EXPECT_DB_MARKER="$A_PIN" \
    ALLOC_SIGNATURE_CMD="$A_SIG_CMD" \
    ALLOC_BODY_FETCH_CMD="$A_BODY_CMD" \
    ALLOC_DEPENDENTS_CMD="$A_DEP_CMD" \
    ALLOC_PLPGSQL_CALLERS_CMD="$A_CALLERS_CMD" \
    ALLOC_EXTENSION_CMD="$A_EXT_CMD" \
    ALLOC_CALLS_CMD="$A_CALLS_CMD" \
    BASELINE_FILE="$baseline" \
    NORMALIZER="$nrm" \
    SUPABASE_PROJECT_REF="" \
    SUPABASE_ACCESS_TOKEN="" \
    SUPABASE_DB_PASSWORD="" \
      bash "$0" "$A_MODE" > "$tmp/arm.out" 2>&1 || rc=$?
    # ⭐ THE THREE EMPTIES ARE THE PIN FOR THE 2026-09-07 FIX, and they are set on
    # EVERY arm rather than on one dedicated arm on purpose. This script no
    # longer reads SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN or
    # SUPABASE_DB_PASSWORD, so the entire suite — every GREEN verdict and every
    # red arm's exit code alike — is measured with all three ABSENT. Restoring a
    # demand for any of them does not fail one arm; it reddens the whole file.
    # They are set EMPTY rather than left to inherit, because the operator's own
    # shell may export them and an inherited value would hide exactly that.

    # ⛔ NON-NEGOTIABLE 2, CHECKED RATHER THAN ASSERTED. The fixtures ARE the
    # real dollar-quoted PROD body, so this arm can genuinely fail. Discarding
    # the arms' output would make the redaction claim unfalsifiable.
    #
    # ⛔ F-03 IDIOM, corrected 2026-09-07 (review MED-3). This used to be a bare
    # `if grep -aqE …; then`, which routes exit 2 (COULD NOT READ arm.out) into
    # the ELSE branch — the BENIGN one — so an unreadable arm.out reported "no
    # dollar-quoted SQL reached the output" and the arm passed. The guards that
    # exist to make the self-test falsifiable were themselves unfalsifiable
    # against an unreadable file. Branched on the status the way this file
    # already does at the fetched-body and baseline-extract checks.
    local redrc=0
    set +e
    grep -aqE '\$[A-Za-z_0-9]*\$' "$tmp/arm.out"
    redrc=$?
    set -e
    if [ "$redrc" -ge 2 ]; then
      results+=("  FAIL ${label} — REDACTION GUARD COULD NOT READ arm.out (grep exited ${redrc}); an unreadable output is not a redacted one")
      return 0
    fi
    if [ "$redrc" -eq 0 ]; then
      results+=("  FAIL ${label} — REDACTION: dollar-quoted SQL reached the output")
      return 0
    fi
    # A failing arm DUMPS what the run actually printed. A self-test that
    # reports only "expected 0, got 2" makes the maintainer re-derive the arm by
    # hand; the redaction check above has already run, so the dump is safe.
    if [ "$rc" -ne "$want" ]; then
      results+=("  FAIL ${label} (exit ${rc}, expected ${want})")
      while IFS= read -r _l; do results+=("         | ${_l}"); done < <(tail -n 12 "$tmp/arm.out")
      return 0
    fi
    if [ -n "$needle" ] && ! grep -aqF -- "$needle" "$tmp/arm.out"; then
      results+=("  FAIL ${label} (exit ${rc} as expected, but the output never NAMED its assertion: '${needle}')")
      while IFS= read -r _l; do results+=("         | ${_l}"); done < <(tail -n 12 "$tmp/arm.out")
      return 0
    fi
    # ⛔ F-03 IDIOM, corrected 2026-09-07 (review MED-3). Same defect as the
    # redaction guard above and the OPPOSITE polarity to the `needle` check on
    # the lines just before it: `! grep -aqF` fails SAFE (exit 2 satisfies the
    # negation and the arm reports "never NAMED its assertion"), but a bare
    # `grep -aqF` fails UNSAFE — exit 2 lands in the else branch, so an
    # unreadable arm.out reported "the forbidden text is absent" and the arm
    # passed. Only this one needed changing; the `needle` check does not.
    if [ -n "$forbid" ]; then
      local frc=0
      set +e
      grep -aqF -- "$forbid" "$tmp/arm.out"
      frc=$?
      set -e
      if [ "$frc" -ge 2 ]; then
        results+=("  FAIL ${label} — FORBIDDEN-TEXT GUARD COULD NOT READ arm.out (grep exited ${frc}); an unreadable output does not prove '${forbid}' is absent")
        return 0
      fi
      if [ "$frc" -eq 0 ]; then
        results+=("  FAIL ${label} (exit ${rc} as expected, but the output ALSO carried the forbidden text '${forbid}')")
        return 0
      fi
    fi
    results+=("  ok   ${label} (exit ${rc}, expected ${want})")
    pass=$((pass + 1))
  }

  # ── GREEN: everything measured and passing ────────────────────────────────
  reset_arm
  arm "ALL GREEN — signature MATCH, body MATCH, dependents 0, stats PRESENT with no entry" \
      0 "verdict        : MATCH — the live definition equals the committed baseline's, normalized."

  # (b) dependents = 0 is asserted by its own printed verdict on the same run.
  reset_arm
  arm "(b) dependents ZERO — GREEN with its count printed" \
      0 "dependent row(s) measured: 0"

  # ── IDENTITY arms — the POSITIVE CONTROL, and its own falsification ───────
  #
  # ⛔ THE ARMS THAT MAKE HIGH-1 UNABLE TO REGRESS. The defect was that
  #    `--expect-absent` passed while touching no database, because `rows=0` is
  #    its PASS. The three `--expect-absent` red arms below each break the
  #    identity measurement in a DIFFERENT way while leaving the signature
  #    reader saying `rows=0` — i.e. each one reproduces "the mode that used to
  #    pass vacuously" — and each asserts a REFUSAL that NAMES its assertion.
  #    Deleting the identity assertion turns all three red.
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_IDENT='rows=0'
  arm "--expect-absent REFUSES when the database carries NO marker (the positive control did not fire)" \
      "$EX_IDENTITY" "the live database carries NO 'COMMENT ON DATABASE' marker" \
      "verdict                  : NOT FOUND"

  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_IDENT=''
  arm "--expect-absent REFUSES when the identity reader is SILENT — MEASURE_FAIL, never 'NOT FOUND'" \
      "$EX_MEASURE" "It emitted NOTHING AT ALL." \
      "verdict                  : NOT FOUND"

  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'
  A_PIN='some-OTHER-project-marker'
  arm "--expect-absent REFUSES when the marker does not match the pin (wrong database)" \
      "$EX_IDENTITY" "does NOT contain ALLOC_EXPECT_DB_MARKER" \
      "verdict                  : NOT FOUND"

  # rows=1 with a payload the protocol strips (a SQL NULL marker) is a
  # self-contradiction, not a matched identity.
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_IDENT='rows=1'
  arm "--expect-absent REFUSES a NULL marker (rows=1, no payload) — MEASURE_FAIL, never a match" \
      "$EX_MEASURE" "declared rows=1 but emitted 0 payload line(s)" \
      "IDENTITY CONFIRMED"

  # The same falsifications must bite in --expect-present too, or the identity
  # assertion would be a mode-local decoration.
  reset_arm; A_IDENT='rows=0'
  arm "--expect-present REFUSES when the database carries NO marker" \
      "$EX_IDENTITY" "the live database carries NO 'COMMENT ON DATABASE' marker"

  reset_arm; A_PIN='some-OTHER-project-marker'
  arm "--expect-present REFUSES when the marker does not match the pin" \
      "$EX_IDENTITY" "does NOT contain ALLOC_EXPECT_DB_MARKER"

  reset_arm; A_IDENT='rows=2
marker-a
marker-b'
  arm "IDENTITY REFUSES when current_database() resolves to more than one marked row" \
      "$EX_IDENTITY" "which is not one."

  # GREEN, and it asserts the SUBSTRING relationship rather than equality: the
  # stub marker is strictly longer than the pin.
  reset_arm
  arm "IDENTITY GREEN — the marker CONTAINS the pin (substring, not equality) and the marker is never printed" \
      0 "verdict                                                         : IDENTITY CONFIRMED" \
      "do not write"

  # ── SIGNATURE red arms ────────────────────────────────────────────────────
  reset_arm; A_SIG='rows=1
uuid, uuid, text, text, text, text, text, text, text, text, bigint'
  arm "SIGNATURE type mismatch ABORTS" \
      "$EX_SIGNATURE" "the live argument TYPES differ from the committed baseline's."

  reset_arm; A_SIG='rows=0'
  arm "SIGNATURE not found (rows=0) ABORTS" \
      "$EX_SIGNATURE" "the live catalogue holds ZERO overloads"

  reset_arm; A_SIG='rows=2
uuid, uuid, text, text, text, text, text, text, text, text, integer
uuid, text'
  arm "SIGNATURE two overloads ABORTS" \
      "$EX_SIGNATURE" "2 overloads are live"

  # ⛔ THE D-02 ARM. An empty reader has no row header, so it can never arrive
  # downstream as a measured zero.
  reset_arm; A_SIG=''
  arm "SIGNATURE reader SILENT — no row header — MEASURE_FAIL, never a zero" \
      "$EX_MEASURE" "It emitted NOTHING AT ALL."

  reset_arm; A_SIG='rows=3
uuid'
  arm "SIGNATURE reader self-contradicts (rows=3, one payload line) — MEASURE_FAIL" \
      "$EX_MEASURE" "declared rows=3 but emitted 1 payload line(s)"

  reset_arm; A_SIG_RC=7
  arm "SIGNATURE reader FAILS (exit 7) — MEASURE_FAIL, stderr withheld" \
      "$EX_MEASURE" "the signature reader exited 7"

  # ── (a) BODY red arms ─────────────────────────────────────────────────────
  reset_arm; A_BODY="$tmp/live.drift.sql"
  arm "(a) body DRIFT ABORTS with both hashes printed" \
      "$EX_BODY" "the live definition DIFFERS from the committed baseline's."

  reset_arm; A_BODY="$tmp/live.garbage.sql"
  arm "(a) body UNEXTRACTABLE ABORTS distinctly from a mismatch" \
      "$EX_MEASURE" "the fetched text carried NO extractable definition for create_allocator_connected_strategy."

  reset_arm; A_BODY_RC=5
  arm "(a) body fetcher FAILS (exit 5) — MEASURE_FAIL" \
      "$EX_MEASURE" "the body fetcher exited 5"

  reset_arm; A_BODY="/dev/null"
  arm "(a) body fetcher returns EMPTY — extraction failure, never 'nothing to compare'" \
      "$EX_MEASURE" "the body fetcher returned EMPTY output."

  # ── (b) DEPENDENTS red arm ────────────────────────────────────────────────
  reset_arm; A_DEP='rows=2
pg_proc	function public.caller_a()
pg_rewrite	rule _RETURN on view public.v_alloc'
  arm "(b) dependents PRESENT ABORTS, listing kinds and identities" \
      "$EX_DEPENDENTS" "2 object(s) depend on public.create_allocator_connected_strategy"

  reset_arm; A_DEP=''
  arm "(b.1) dependents reader SILENT — MEASURE_FAIL, never a zero" \
      "$EX_MEASURE" "It emitted NOTHING AT ALL."

  # ── (b.2) IN-DATABASE plpgsql CALLERS — the class pg_depend cannot see ────
  #
  # ⛔ The MED-1 arms. A plpgsql caller records NO pg_depend row, so A_DEP stays
  #    at its GREEN 'rows=0' in the red arm below: that is the whole point —
  #    (b.1) measures zero and (b.2) is what refuses. Deleting (b.2) makes this
  #    arm pass with exit 0 and the completeness claim comes back.
  reset_arm; A_CALLERS='rows=2
public.wizard_connect_strategy(p_user_id uuid)
public.legacy_allocator_shim()'
  arm "(b.2) a plpgsql CALLER ABORTS while (b.1) still measures ZERO pg_depend rows" \
      "$EX_PLPGSQL_CALLERS" "2 in-database function body/bodies NAME public.create_allocator_connected_strategy"

  reset_arm; A_CALLERS='rows=1
public.wizard_connect_strategy(p_user_id uuid)'
  arm "(b.2) the abort NAMES the runtime consequence, not just a count" \
      "$EX_PLPGSQL_CALLERS" "It SUCCEEDS, and each caller above starts"

  reset_arm; A_CALLERS=''
  arm "(b.2) plpgsql-caller reader SILENT — MEASURE_FAIL, never a zero" \
      "$EX_MEASURE" "It emitted NOTHING AT ALL."

  reset_arm; A_CALLERS='rows=4
only.one()'
  arm "(b.2) plpgsql-caller reader self-contradicts (rows=4, one payload line) — MEASURE_FAIL" \
      "$EX_MEASURE" "declared rows=4 but emitted 1 payload line(s)"

  # ⛔ ANTI-VACUITY ON THE WORDING ITSELF. (b.1)'s old verdict claimed
  #    completeness it did not have. This arm pins the CORRECTED sentence and
  #    FORBIDS the old one, so a revert of the wording reddens the self-test.
  reset_arm
  arm "(b.1) GREEN says 'ZERO pg_depend rows' and NEVER 'nothing in the catalogue depends on this overload'" \
      0 "verdict                  : ZERO pg_depend rows reference this overload." \
      "nothing in the catalogue depends on this overload"

  reset_arm
  arm "(b.2) GREEN prints its own count and states the prosrc TEXT-scan bound" \
      0 "caller row(s) measured   : 0"

  # ── (c) CALL EVIDENCE — the two states the plan requires be separable ─────
  #
  # ⛔ These two arms are the point of assertion (c). They must differ in BOTH
  # printed text and exit code, and each forbids the OTHER's wording.
  reset_arm; A_EXT='rows=0'
  arm "(c) pg_stat_statements ABSENT ABORTS (exit ${EX_STATS_UNAVAILABLE}) and never says zero calls" \
      "$EX_STATS_UNAVAILABLE" "CALL EVIDENCE UNAVAILABLE — pg_stat_statements is NOT INSTALLED." \
      "zero calls OBSERVED"

  reset_arm; A_CALLS='rows=0'
  arm "(c) pg_stat_statements PRESENT with zero rows is EVIDENCE (exit 0) and never says unavailable" \
      0 "0 — zero calls OBSERVED." \
      "CALL EVIDENCE UNAVAILABLE"

  reset_arm; A_EXT='rows=1'
  arm "(c) availability probe self-contradicts (rows=1, no payload) — MEASURE_FAIL, never a PRESENT verdict" \
      "$EX_MEASURE" "declared rows=1 but emitted 0 payload line(s)"

  reset_arm; A_CALLS='rows=1
calls=1234'
  arm "(c) pg_stat_statements PRESENT with calls PRINTS the count" \
      0 "observed calls                            : 1234 across 1 entr(y|ies)."

  reset_arm; A_CALLS='rows=1
oops=1234'
  arm "(c) call reader emits a malformed row — MEASURE_FAIL" \
      "$EX_MEASURE" "which is not a 'calls=<integer>' row."

  reset_arm; A_EXT=''
  arm "(c) availability probe SILENT — MEASURE_FAIL, never 'absent'" \
      "$EX_MEASURE" "It emitted NOTHING AT ALL."

  # ── --expect-absent, the post-apply confirmation mode ─────────────────────
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'
  arm "--expect-absent with zero overloads is GREEN and reports NOT FOUND" \
      0 "verdict                  : NOT FOUND"

  reset_arm; A_MODE="--expect-absent"
  arm "--expect-absent while the function SURVIVES ABORTS" \
      "$EX_SIGNATURE" "the function is still PRESENT in 1 overload(s)"

  # ── usage arms ────────────────────────────────────────────────────────────
  reset_arm; A_MODE="--nonsense"
  arm "unknown mode is a hard failure, not a fall-through to the default" \
      "$EX_USAGE" "unknown mode '--nonsense'"

  # ⛔ The identity PIN is a credential. Unset, the run cannot know which
  #    database it should be reading, so it refuses BEFORE any measurement —
  #    including in --expect-absent, where the alternative is certifying an
  #    absence on an unidentified database.
  reset_arm; A_PIN=""
  arm "ALLOC_EXPECT_DB_MARKER unset is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_EXPECT_DB_MARKER is not configured"

  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_PIN=""
  arm "--expect-absent with ALLOC_EXPECT_DB_MARKER unset REFUSES rather than reporting NOT FOUND" \
      "$EX_USAGE" "ALLOC_EXPECT_DB_MARKER is not configured" \
      "verdict                  : NOT FOUND"

  # ⭐ THE REGRESSION ARM FOR HIGH-1 ITSELF, in the shape the review reproduced
  #    it: `--expect-absent` with a signature reader that touches NO database.
  #    Before the identity assertion this exited 0 and printed NOT FOUND.
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_IDENT='rows=0'; A_PIN="$IDENT_PIN"
  arm "HIGH-1 REGRESSION — --expect-absent over a database-less reader can no longer exit 0" \
      "$EX_IDENTITY" "an absence measured by an" \
      "verdict                  : NOT FOUND"

  # ── ⭐ 2026-09-07: THE CHECK ASSERTS WHAT THIS RUN ACTUALLY CONSUMES ───────
  #
  # ⛔ WHAT THESE ARMS MAKE UNABLE TO REGRESS. The check used to demand
  #    SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD be
  #    non-empty and then never read one of them (review HIGH-2, stated in this
  #    file's own header), while the readers it DOES consume were caught only
  #    lazily, mid-run. The REMOVAL half is pinned by `arm` itself, which runs
  #    every arm in this file with all three set EMPTY. The arms below pin the
  #    REPLACEMENT: each required reader refuses BY NAME; the requirement is
  #    genuinely mode-scoped; and the one CONDITIONAL reader still refuses.
  #
  # ⛔ AN EXIT CODE ALONE WOULD PROVE NOTHING HERE — an unrunnable script also
  #    exits non-zero — so every red arm below asserts a substring NAMING its own
  #    variable, exactly as the identity arms above do.
  #
  # ⚠️ These arms replace a single hand-rolled block that asserted the OLD
  #    behaviour (`SUPABASE_DB_PASSWORD is not configured`). It was deleted
  #    rather than kept, because a test pinning a demand the code no longer makes
  #    is the "claim never compared to the thing" defect from the other side.

  reset_arm; A_IDENT_CMD=""
  arm "ALLOC_DB_IDENTITY_CMD unset is a HARD FAILURE naming the variable, never a ::notice:: skip" \
      "$EX_USAGE" "ALLOC_DB_IDENTITY_CMD is not configured" \
      "::notice::"

  reset_arm; A_EXT_CMD=""
  arm "an unconfigured reader refuses with the 'HARD FAILURE, not a skip' sentence intact" \
      "$EX_USAGE" "HARD FAILURE, not a skip" \
      "::notice::"

  reset_arm; A_SIG_CMD=""
  arm "ALLOC_SIGNATURE_CMD unset in --expect-present is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_SIGNATURE_CMD is not configured"

  reset_arm; A_BODY_CMD=""
  arm "ALLOC_BODY_FETCH_CMD unset in --expect-present is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_BODY_FETCH_CMD is not configured"

  reset_arm; A_DEP_CMD=""
  arm "ALLOC_DEPENDENTS_CMD unset in --expect-present is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_DEPENDENTS_CMD is not configured"

  reset_arm; A_CALLERS_CMD=""
  arm "ALLOC_PLPGSQL_CALLERS_CMD unset in --expect-present is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_PLPGSQL_CALLERS_CMD is not configured"

  reset_arm; A_EXT_CMD=""
  arm "ALLOC_EXTENSION_CMD unset in --expect-present is a HARD FAILURE naming the variable" \
      "$EX_USAGE" "ALLOC_EXTENSION_CMD is not configured"

  # ⛔ THE TWO ARMS THAT MATTER MOST. --expect-absent's pass condition is an
  #    ABSENCE, so an unconfigured reader in THAT mode is the HIGH-1 shape again:
  #    nothing measured, 'NOT FOUND' printed, exit 0. Each forbids that verdict as
  #    well as asserting the refusal that replaces it.
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_IDENT_CMD=""
  arm "--expect-absent REFUSES when ALLOC_DB_IDENTITY_CMD is unset, rather than reporting NOT FOUND" \
      "$EX_USAGE" "ALLOC_DB_IDENTITY_CMD is not configured" \
      "verdict                  : NOT FOUND"

  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'; A_SIG_CMD=""
  arm "--expect-absent REFUSES when ALLOC_SIGNATURE_CMD is unset, rather than reporting NOT FOUND" \
      "$EX_USAGE" "ALLOC_SIGNATURE_CMD is not configured" \
      "verdict                  : NOT FOUND"

  # ⛔ THE ARM THAT KEEPS THE SCOPING HONEST IN THE OTHER DIRECTION. Widening the
  #    required list to "every reader, always" turns this GREEN arm RED — which is
  #    the point. --expect-absent runs neither (a) nor (b) nor (c), so demanding
  #    their readers would be the same theatre this change removed, one variable
  #    name later. Without this arm, "conditional" would be a claim, not a fact.
  reset_arm; A_MODE="--expect-absent"; A_SIG='rows=0'
  A_BODY_CMD=""; A_DEP_CMD=""; A_CALLERS_CMD=""; A_EXT_CMD=""; A_CALLS_CMD=""
  arm "--expect-absent is GREEN with every (a)/(b)/(c) reader UNSET — the requirement is mode-scoped, measured not claimed" \
      0 "verdict                  : NOT FOUND"

  # ⛔ THE CONDITIONAL READER, PROVEN RATHER THAN EXEMPTED. ALLOC_CALLS_CMD is
  #    deliberately absent from the credential list because it is invoked only
  #    when the availability probe reports PRESENT. This arm proves the refusal
  #    that stands in for the hoist still bites and still NAMES the reader —
  #    otherwise "conditional" would be a licence not to check at all.
  reset_arm; A_CALLS_CMD=""
  arm "ALLOC_CALLS_CMD unset still REFUSES at run_reader once the probe reports PRESENT" \
      "$EX_USAGE" "the call count reader command is unset"

  # ⭐ THE POSITIVE HALF OF THE FIX, AND THE ARM THE FOUNDER DECISION IS ABOUT. A
  #    complete --expect-present run reaching its closing notice while
  #    SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD are
  #    ALL EMPTY. Before 2026-09-07 this exact configuration exited EX_USAGE, and
  #    the operator's only way past it was to INVENT values for three variables
  #    this script has never read.
  reset_arm
  arm "FULL RUN GREEN with SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD ALL EMPTY" \
      0 "all assertions PASSED and each printed its measurement."

  printf '%s\n' "${results[@]}"
  if [ "$pass" -ne "$total" ]; then
    echo "SELF-TEST FAIL: ${pass}/${total} arms behaved as declared."
    return 1
  fi
  cat <<EOF
DRIFT-04 pre-flight: self-test OK (${pass}/${total} arms).
  Exit-code map proven by the arms above:
    ${EX_USAGE} usage / absent credential
    ${EX_MEASURE} MEASURE_FAIL — a measurement could not be TAKEN
    ${EX_SIGNATURE} signature mismatch
    ${EX_BODY} live body differs from the committed baseline
    ${EX_DEPENDENTS} (b.1) at least one CATALOGUE dependent object
    ${EX_STATS_UNAVAILABLE} pg_stat_statements measured ABSENT (D-02)
    ${EX_IDENTITY} IDENTITY — this run is not reading the expected database
    ${EX_PLPGSQL_CALLERS} (b.2) at least one IN-DATABASE plpgsql caller
  ⛔ pg_stat_statements ABSENT (exit ${EX_STATS_UNAVAILABLE}) and PRESENT-with-zero-rows (exit 0) are
     proven DISTINGUISHABLE: each arm forbids the other's wording as well as
     asserting its own exit code.
  ⛔ --expect-absent CANNOT PASS WITHOUT A POSITIVE CONTROL (review HIGH-1). Its
     pass condition is 'rows=0', which silence also produces, so five arms above
     break the identity measurement in five different ways while leaving the
     signature reader saying rows=0 — no marker, silent reader, wrong marker,
     NULL marker, unset pin — and each asserts a refusal that NAMES its own
     assertion AND forbids the 'NOT FOUND' verdict. Deleting the identity
     assertion turns all five red.
  ⛔ THE CREDENTIAL CHECK DEMANDS ONLY WHAT THIS RUN CONSUMES (review HIGH-2,
     founder decision 2026-09-07). SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN
     and SUPABASE_DB_PASSWORD are no longer required: this file never read one of
     them, and the reader path that works — the CLI's linked query, which
     authenticates on its own stored token — consumes no database password at
     all, so the demand only ever forced an operator to INVENT a value. EVERY arm
     above runs with all three set EMPTY, so re-introducing a demand for any of
     them reddens the whole suite rather than one arm. In their place the check
     asserts, UP FRONT, the identity pin and every reader the MODE invokes
     unconditionally — each with its own red arm naming its own variable, two of
     them in --expect-absent where they also FORBID the 'NOT FOUND' verdict. The
     scoping is measured in both directions: one arm proves --expect-absent stays
     GREEN with every (a)/(b)/(c) reader unset, and one proves the CONDITIONAL
     reader ALLOC_CALLS_CMD still refuses by name at run_reader. Nothing was
     weakened — the required list got LONGER, and reader absence moved from a
     lazy mid-run refusal to a refusal before any measurement is attempted.
  ⛔ (b.1) NO LONGER CLAIMS COMPLETENESS (review MED-1). pg_depend records
     nothing for a plpgsql body that calls a function by name, so (b.2) measures
     that class separately, and an arm above pins (b.1)'s corrected wording while
     FORBIDDING the old 'nothing in the catalogue depends on this overload'.
  ⚠️ This proves this script's decision logic only. It does NOT exercise the psql
     recipes in the header, and it has not touched PROD. In particular the
     IDENTITY assertion is proven to REFUSE correctly against stubs; whether the
     production database still carries its marker is the first credentialed run.
EOF
  return 0
}

if [ "$MODE" = "--self-test" ]; then
  _rc=0
  self_test || _rc=$?
  exit "$_rc"
fi

# ── CREDENTIALED PATHS ───────────────────────────────────────────────────────
# MODE is passed because the required set is mode-scoped: --expect-absent
# consumes two readers, --expect-present consumes six. Asserting the union in
# both modes would demand values one of them never reads.
assert_credentials "$MODE"

NRM="${NORMALIZER:-scripts/sql-body-normalize.mjs}"
BASELINE="${BASELINE_FILE:-supabase/schema/baseline.sql}"
command -v node >/dev/null 2>&1 || fail "$EX_USAGE" "node is not on PATH; the shared normalizer cannot run."
[ -f "$NRM" ] || fail "$EX_USAGE" "normalizer not found at ${NRM}."
[ -f "$BASELINE" ] || fail "$EX_USAGE" \
  "the committed PROD baseline was not found at ${BASELINE}." \
  "It is the expected body AND the revert source for this removal; without it there is" \
  "nothing to compare PROD against and nothing to restore from."

TMP="$(mktemp -d)"
# shellcheck disable=SC2064
trap "rm -rf '$TMP'" EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "${GATE}"
echo "mode: ${MODE}"
echo ""

if [ "$MODE" = "--expect-absent" ]; then
  # ⛔ ORDER IS LOAD-BEARING. IDENTITY runs BEFORE the inverted signature
  #    assertion, because it is that assertion's POSITIVE CONTROL. Reversed, a
  #    reader that reached nothing would have already printed "NOT FOUND" before
  #    anything checked whether it reached a database at all.
  assert_database_identity
  echo ""
  assert_signature absent
  echo ""
  echo "::notice::${GATE}: the function is ABSENT from the live catalogue, AND this run positively"
  echo "::notice::identified the database it read (see IDENTITY above). Both halves are required:"
  echo "::notice::the absence alone is a 'rows=0', which silence also produces."
  echo "::notice::This run asserts identity and signature only — assertions (a), (b.1), (b.2) and (c)"
  echo "::notice::have no subject once the object is gone, and are not run. Say so rather than"
  echo "::notice::implying they passed."
  exit 0
fi

assert_database_identity
echo ""
assert_signature present
assert_body
assert_dependents
assert_call_evidence

echo ""
echo "::notice::${GATE}: all assertions PASSED and each printed its measurement."
echo "::notice::⛔ SCOPE, stated rather than implied. A pass here means: this run positively"
echo "::notice::identified the database it read, by a marker only the intended project carries;"
echo "::notice::exactly one live overload with the baseline's 11 argument types; a live body equal"
echo "::notice::to the committed baseline's under the shared normalizer; zero catalogue dependents"
echo "::notice::(b.1); zero in-database plpgsql bodies naming the function (b.2); and a call reading"
echo "::notice::TAKEN from an installed pg_stat_statements, bounded by its current window."
echo "::notice::⛔ WHAT IT STILL DOES NOT MEAN — narrowed 2026-09-07, because the previous wording"
echo "::notice::bounded only PostgREST callers while (b) was ALSO blind to in-database plpgsql ones:"
echo "::notice::  • PostgREST callers are NOT covered. Application code that calls this function over"
echo "::notice::    /rest/v1/rpc/ appears in no catalogue this run reads, and (c)'s reading is a"
echo "::notice::    bounded, evicting window that can never prove 'never called'."
echo "::notice::  • (b.2) is a prosrc TEXT scan: it does not see a caller that builds the name"
echo "::notice::    dynamically, and it flags the name in a comment or a string literal."
echo "::notice::  • The identity binding is per-READER-CONFIGURATION, not per-TCP-session."
echo "::notice::It authorises nothing on its own: the removal is a founder decision behind three"
echo "::notice::reviewers, and it reaches PROD by MERGE."
exit 0
