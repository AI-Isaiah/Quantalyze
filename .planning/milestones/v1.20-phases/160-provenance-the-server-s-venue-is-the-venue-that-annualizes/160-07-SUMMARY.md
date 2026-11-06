---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 07
subsystem: api-keys-provenance
tags: [gap-closure, prod-smoke, verification-record, RANK-03]
status: complete
completed: 2026-10-02
requirements: [RANK-03]
requires: ["160-05"]
provides:
  - "dated PROD smoke record for AllocatorExchangeManager (second of three persist-arm surfaces)"
  - "behavior_unverified narrowed to StrategyForm, with exact closing steps"
  - "TODOS.md section D security row annotated with the INSERT-revoke measurement"
affects: [160-VERIFICATION.md, TODOS.md]
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/phases/160-provenance-the-server-s-venue-is-the-venue-that-annualizes/160-07-SUMMARY.md
  modified:
    - .planning/phases/160-provenance-the-server-s-venue-is-the-venue-that-annualizes/160-VERIFICATION.md
    - TODOS.md
decisions:
  - "The numeric score (31.5/32) and status in 160-VERIFICATION.md were NOT re-cut. Only the descriptive surface tally moved (1/3 to 2/3); re-scoring belongs to the independent verifier."
  - "The TODOS.md section D security row is annotated, not closed. The INSERT half is false by measurement, but DELETE is retained and the item asks for a design decision, so closing it is the founder's call."
  - "The count delta is recorded as NOT +1 (42 to 42), with the founder's disconnect-with-delete then reconnect explanation. It is not rounded into a pass."
metrics:
  duration: "~15 min (Task 3 + SUMMARY; Tasks 1 and 2 were completed before this executor ran)"
estimate:
  tokens: 30000
  tasks: 3
actuals:
  tokens: 4500
  tasks: 3
  commits: 1
plan_head_before: 91f4239a19fe2f789e5d14379b4fac3723a12eb3
plan_head_after: 7fe828389b5ce7b40950988d161f8f5eb6d64915
---

# Phase 160 Plan 07: Gap closure, PROD smoke record Summary

**The persist arm on `/api/keys/validate-and-encrypt` is now observed working on PROD through
AllocatorExchangeManager, with the DevTools response `{ api_key_id, valid, read_only }` and an
attested okx row. StrategyForm is the only surface still behavior-unverified.**

## Task 1: independent re-verification (already done, confirmed from the file)

No commit in this run, and nothing re-scored by this executor (the plan's prohibition). The
fresh verifier's output is already committed in `160-VERIFICATION.md`. Quoted verbatim:

```yaml
re_verified: "2026-08-23T19:58:08Z @ 939165aa2ce13acf900c4667d7494bf54497d9e5"
status: passed
```

```yaml
  gaps_closed:
    - "Route serves NO ciphertext to any caller: absent-discriminator bodies receive a coded STALE_CLIENT refusal (substance verified at HEAD by an independent pass; the truth's 'same merge as the migration' ordering clause is ruled VIOLATED — see body)"
```

The ordering clause carries an explicit ruling in the body ("VIOLATED, and retroactively
unmeetable"), and the three neuters were re-executed by that verifier. The PROD refusal gate
(Task 2 Part B) is recorded as closed on 2026-08-23, measured after #705 deployed: 409, `code`
STALE_CLIENT, body exactly `{code, error}`, `Cache-Control` private/no-store.

⚠️ **One pre-existing inconsistency, left alone:** the frontmatter says `status: passed`, and
the body's `**Status:**` line still reads `human_needed`. Reconciling them is a re-cut of the
verdict, so it is not this executor's to do.

## Task 2: PROD smoke (checkpoint resolved by the founder)

There is no commit for this task; its evidence is transcribed under Task 3.

- **Exercised:** AllocatorExchangeManager (Profile → Exchanges → "+ Connect exchange"). The
  response body was exactly `{ api_key_id, valid: true, read_only: true }`, with none of the
  five ciphertext key names.
- **Row, measured read-only by the orchestrator:** created 2026-10-02 20:59:39Z, `okx`,
  `attested_venue` = exchange, active. Its follow-on jobs were claimed 21:00:10Z and are
  `done`. Sync is complete at 21:00:22Z. Across the fleet, 0 rows have a NULL `attested_venue`
  and 0 have one that differs from `exchange`, out of 42.
- **Count delta: 42 to 42, not +1.** The founder disconnected the same account first,
  choosing "delete the data", then reconnected.
- **Not exercised:** StrategyForm. That route tree is manager-only and the founder's session
  is allocator-only.
- **Already smoked:** ApiKeyManager, on 2026-08-25 (row `160 gate smoke`, existing record).
- **Part B:** measured on PROD on 2026-08-23 (see Task 1). It is not pending.

## Task 3: record (commit `7fe82838`)

**`160-VERIFICATION.md`:**
- Added a `### Part A — 2026-10-02` subsection under the existing
  `## PROD smoke record (gap closure 160-07)` heading. It holds:
  - the response-key table;
  - the row and fleet table;
  - the count delta, stated honestly;
  - the cleanup outcome (key kept, because it is the founder's real account);
  - the StrategyForm exact steps.
- Corrected the 2026-08-25 claim that AllocatorExchangeManager was "UNREACHABLE — no page
  mounts it". That grep covered `src/app` only. The real mount is `ExchangesTabContent.tsx:61`,
  rendered by `ProfileTabs.tsx`'s allocator-only `exchanges` tab. The old lines are kept as
  lineage.
- Frontmatter changes:
  - The tally now reads 2/3. The numeric score is unchanged.
  - `behavior_unverified` stays 1. `behavior_unverified_items[0]` is narrowed to StrategyForm, and
    its result gained a dated update.
  - `human_verification[0]` gained a dated addendum. It said the DevTools response-shape half was
    "NOT DISCHARGED"; a new connect has now discharged it.
- Added dated pointers on Gap 1 and on the record's 2026-08-23 status line, so neither
  contradicts the newer evidence.
- StrategyForm steps: StrategyForm is mounted only on `/strategies/[id]/edit` (`mode="edit"`).
  The plan pointed at `/strategies/new`, but that route redirects to the wizard, which takes the
  Phase-156 RPC path. The record says so.

**`TODOS.md`:**
- **Legacy-arm deferral item:** none exists. A case-insensitive grep for
  `legacy.{0,10}arm|ciphertext arm|ciphertext envelope` returned 0 hits, so there was nothing
  to close.
- **Section D security row (line 498, Phase 153.6 cluster table):** annotated in-cell, on the
  same line so the table stays intact:
  - `20260823120000_revoke_api_keys_insert`, dated 2026-10-02, "INSERT: false, measured";
  - DELETE is still retained, so the premise is half-dead;
  - the ASVS clause is not ruled on;
  - flagged for founder closure.
- The plan's automated check, `grep -q 20260823120000 TODOS.md`, is vacuous: the id already
  appeared on other lines. It was re-checked on the row itself: `sed -n 498p TODOS.md | grep -c
  20260823120000` gives 1.

## Verification run

- The frontmatter parses as YAML (js-yaml): status `passed`, `behavior_unverified` 1.
- `## PROD smoke record` heading count: 1.
- Email-token grep over the added diff lines (`grep -a`): **0**.
- `scripts/check-planning-hygiene.ts`: OK (8164 tracked files).
- Section D row pipe count is unchanged at 3, matching the neighbouring row.

## Deviations from Plan

- **Tasks 1 and 2 were not executed by this executor.** Both were checkpoints the orchestrator
  had already resolved: Task 1 by an earlier fresh verifier, Task 2 by the founder on
  2026-10-02. This run confirmed Task 1 from the file and transcribed Task 2. As a result,
  `actuals.commits` is 1, the Task 3 commit, plus the SUMMARY commit that follows.
- **Row uuid not transcribed.** The evidence supplied no uuid. The row is identified by its
  `created_at`, which follows the ~20:52Z baseline. No id was invented.
- **Smoke key not deleted (step 8).** It is a real account kept in use, not a throwaway.

## Remaining (not closed by this plan)

- **StrategyForm PROD smoke.** It needs a manager or both-role account. The exact steps are in
  `160-VERIFICATION.md`, under *Still behavior-unverified: StrategyForm*.
- **TODOS section D row.** Waiting on a founder closure decision.

## Self-Check: PASSED

- FOUND: `160-VERIFICATION.md` (modified), `TODOS.md` (modified), this SUMMARY.
- FOUND: commit `7fe82838` on `chore/160-07-close`.
