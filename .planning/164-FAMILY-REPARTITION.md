# The 164 family — audit and re-partition

**Date:** 2026-09-05 · **Status:** DECIDED, not yet executed
**Executes:** at the end of Phase 164.4.1, before any 164.1/164.2 planning
**Authority:** founder decisions taken 2026-09-05 (partition, 164.6, REQUIREMENTS re-sync, 165)

Every claim below was measured at HEAD by reading code, not by trusting `TODOS.md` or
`ROADMAP.md` prose. Both were found stale in specific, named ways. Where a sub-agent's
claim conflicted with the code, the code won and the conflict is recorded.

---

## 1. Why this document exists

Phases 164.1 and 164.2 could not be planned as written. Three independent defects:

1. **The 2026-08-28 dedup was applied to one paragraph and not the next.** 164.1's DEDUP
   table moved five carry-overs to 164.3. Its title and its carried-in list still claim all
   five in full prose. A planner reading top-down would re-plan work another phase owns.
2. **Routing an item to a phase was mistaken for closing it.** Of the five moved to 164.3,
   164.3 closed roughly one and a half.
3. **Work was routed to phases that do not exist.** Four open items name "Phase 164.5".
   There is no such phase, and there never was.

---

## 2. What 164.3 / 164.3.1 / 164.4 / 164.4.1 actually closed

| Item | Verdict | Evidence at HEAD |
|---|---|---|
| SKIP-01 | **REFRAMED, not built.** Premise failed re-measurement; became VAC-08, a drift *detector*. The condition it named survives. | `ci.yml` sql-tests, verbatim: "Nothing applies migrations to the TEST project (this job has no apply step; supabase-migrate.yml targets PRODUCTION only)" |
| DRIFT-01 | Same VAC-08 coverage. TEST still an older revision. | as above |
| OPS-08-F9 | **Verify-and-record only** (plan 164.3-02's own title). | `supabase/tests/test_enqueue_internal_destrict.sql:251` still records that it carries no `ALL N ARMS EXECUTED` sentinel |
| OPS-08-F8 | **Untouched.** 164.3-05 aggregated the *mutation runner*, a different corpus. | `.github/workflows/ci.yml:2533-2540` — still `exit "$status"` on first failure |
| H-0001 | **Detection fixed** (164.3-03); gate blindness `[AUDCOV-01]` fixed (164.3.1-06). | `src/__tests__/audit-coverage.test.ts:103` |
| PROC-01 | **Delivered** (164.3), extended by 164.4.1 (pg_cron on the lane). | `scripts/pg-lane/README.md:122` |
| PROC-03 | **Mostly delivered.** 42/71 gate files annotated, convention documented AND machine-enforced. | `scripts/mutation-runner/GRAMMAR.md`; pin at `mutation-annotation-parser.test.ts:2229` |
| PII-01 | **Closed** 2026-08-28. `13-REVIEWS/` no longer exists. | `TODOS.md:2231` |
| wizardSessionId root cause | **Closed.** This is 164.2's success criterion 6. | `src/lib/wizard/localStorage.ts:535` — restore gated by source |
| frozen-spine retirement | **Effectively closed.** `FORBIDDEN_MIGRATION_RE` no longer exists; two gates already retired as reviewed acts; all three survivors still bite. | `phase-29-frozen-spine-guards.test.ts:339,348`, and `:191-194` instructs 164.1 **not** to edit it a third time |

Everything else is open exactly as described. All four observability targets are absent:
`net._http_response` appears **only** in `TODOS.md` and `ROADMAP.md` — zero code or workflow hits.

### Conflicts resolved against the code
- **OPS-08-TS** — one audit reported it closed at `csv-finalize/route.ts:2044`. It is a *copy*
  branch, not a retry; the file's own docblock says "MEASURED at HEAD: nothing in this repo
  retries a 40001", and `allocator/holdings/sync/route.ts:73-86` has no 40001 arm. **Open.**
- **A flagged test contradiction was a false alarm.** `159-VERIFICATION.md` does contain
  "blocked on PHASE 164.5" — inside a `⛔ RE-POINTED 2026-08-29` clause. The test passes.
- **"Composite-stamp twin" is 161.1-D13**, not the runner's `RED-UNDER-M` vocabulary. Python
  honours the marker (`long_fetch.py:66`); the two TS enqueue sites have zero `retract`. Half-closed.

---

## 3. The re-partition (founder-selected: 4 phases, split by substrate)

**164.1 → PROD-OBSERVABILITY** — one periodic prober, four targets. Loses its gate-hygiene half.
PYAPI-06 (both halves: `analytics-client.ts:466` omits the header silently; `main.py:825`
discards the absent-header case), CRON-OBS-01, CRON-DRIFT-01, MT5-WEDGE-OBS-01 (−10004 vs
−10005 distinguished). Keeps its anti-silent-skip discipline: a probe that SKIPs on an absent
credential is the defect, not the fix.

**164.2 → CURATED-COPY** — thesis unchanged. Provenance column + bridge
(`20260826120000:907` records it as OWED WORK; no later migration adds it), WIZFORM-02,
the three surviving copy falsehoods, WR-06-UTC **both** bucketers (`freshness.ts:207-213`
has only a 5-*minute* clock-skew allowance, not day-granularity; `FactsheetView.tsx:1108-1115`
has none), HONEST-08-RESIDUAL, and **161-ERRPREFIX moved here from 164.1** — it is a sentence
a user reads. Drop criterion 6, already satisfied.

**164.5 → BASELINE-SNAPSHOT** — CREATE. ⛔ **Must be numbered exactly 164.5**: CI pins the
literal string across ~13 assertions (`verify-plan-anchors.test.ts`, `baseline-wiring-claim.test.ts`),
and `164.3-07-DEFERRED.md` is exempt from the pending-plan scan *because* it names this owner.
Ordered: repoint `scripts/local-stack/run.sh:50` at `supabase/schema/baseline.sql`; drop
`.gitignore:138`; baseline staleness gate with sha256 vs `BASELINE.md`; **DRIFT-04**; DRIFT-05
both directions; VAC08-LEDGER-32; then VAC-07. Also discharges 164.1's old advisory-lock
concurrency test and Phase 159's two blocked items.
⚠️ VAC-07 stays `Pending` even once this phase exists — its deferral record forbids scoring it.

**164.6 → GATE-HYGIENE** — CREATE. OPS-08-F9 sentinel + the two `ci.yml` integers in ONE diff;
OPS-08-F8 aggregation; OPS-08-TS retry at **both** call sites; OPS-08-F2 fan-out failure count;
composite-stamp twin TS half; PROC-02; PROC-03 residual (discoverability — `GRAMMAR.md` is
referenced by nothing a newcomer reads); H-0001 residual (shrink the 7-entry allowlist —
both ledgers still say six).

**Dropped from scope entirely:** PROC-01, PII-01, wizardSessionId, frozen-spine retirement.

---

## 4. DRIFT-04 — the item that was owned by nobody

`create_allocator_connected_strategy` exists in PRODUCTION under **no migration**.
SECURITY DEFINER, `GRANT ALL … TO authenticated`, writes encrypted credential material.
A founder decision to drop it was taken 2026-08-29 (`DROP FUNCTION`, no `IF EXISTS`, no
`CASCADE`, three pre-flight assertions) and assigned to Phase 164.5 — which did not exist.
It has been unowned since. It is now 164.5's, and it is the reason 164.5 should not sit idle.

---

## 5. Phase 165 stays in the milestone

The founder's preference was for dependabot work to happen outside v1.20. It stays, because:

1. **There is no destination.** No v1.21 exists in `MILESTONES.md`, `ROADMAP.md` or `STATE.md`.
   Moving it would recreate the exact orphan defect this document exists to fix.
2. **165 is already not last.** Phase 166 QSTATS-TRUTH was appended after it, so its own
   "dependency churn lands last, never before" invariant is already violated. Membership was
   never what protected it — ordering was.
3. **166's dependency on 165 is cosmetic** — "ordering only, no code dependency" — so the
   order flips to **164.6 → 166 → 165**, restoring the invariant without inventing a milestone.

**Carried decision, with a trigger:** when v1.21 is created, if 165 is still open, it moves then.

---

## 6. Also owed in the same pass

- **`REQUIREMENTS.md` full re-sync** (founder-selected). It claims "50/50 mapped, Unmapped: 0"
  at `:257-262` while `HONEST-07` reads `| Unassigned | Pending |` at `:230`. Every
  `VAC-01`…`VAC-08` still reads `Pending` though 164.3 shipped — the file's footer dates it
  2026-08-20, before that phase ran. A coverage attestation contradicted on its own page is the
  same vacuity shape this family exists to stop.
- **WINDOWS ledger.** Entries 30 and 31 are stale: the Primitive-D rule has been BLOCKING since
  plan 164.3.1-08, which is complete (`self-referential-oracle.test.ts:21,43`). Mark fixed with
  that citation, and audit the other 27 open entries against completed phases in the same sweep.
  (The 2026-09-05 reconciliation moved the count 26 → 29 by re-rendering from the JSON source of
  truth; that was right, but it did not check whether the entries were still live. Two are not.)
- **v1.20 progress table.** 164.3 still reads "0/? RUNS FIRST", 164.4 "0/13", and there are no
  rows at all for 164.3.1 or 164.4.1.
- **Stale cross-references to fix:** `164.3-VERIFICATION.md:114` claims "164.5 already exists";
  `CLAUDE.md:38-45` still describes four lane-blocked files and 100 deferred sections.
- **Broken pointers:** the ROADMAP tells planners to read `TODOS.md` entries for `161-ERRPREFIX`,
  `PROC-02` and `PROC-03`. All three have **zero** entries. Write them or stop citing them.
- **164.3's plan-07 row stays unchecked.** It is deferred, not done, and that is correct.
