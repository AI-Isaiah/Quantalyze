---
status: passed
verified_at_sha: fb03a642a03e65a39cce31779905168b873a667d
drift_subjects:
  - src/lib/finalize-rerun.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/lib/stored-analytics-result.ts
  - src/lib/closed-sets.ts
  - src/lib/strategyGate.ts
  - src/lib/status-surface-copy.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/v2-joint.ts
  - src/lib/factsheet/headline-basis.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/api/admin/strategy-review/route.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - analytics-service/services/job_worker.py
---

# Phase 190: FACTSHEETQUEUED Verification Report

**Phase goal (ROADMAP):** Finishing the strategy wizard does not queue a second analytics run that is not needed. A queued or running re-compute never hides a strategy's already-computed factsheet: it keeps showing with a small "updating" note. A strategy with no analytics yet still shows the queued or computing state.

**Verified at:** the worktree HEAD recorded above, branch `feat/190-factsheetqueued` (holds the shipped code from PR #1194 plus the post-ship records commits).
**Re-verification:** No, initial verification.

## Verdict in one paragraph

The goal is achieved in code and tests, and the PROD evidence the roadmap asks for in SC-5 is only half there. SC-3 (a re-compute never hides computed figures) has a valid PROD reading at both the pre-derive and the post-derive capture. SC-2 (finalize queues only a needed re-run) and SC-4 (a strategy with no analytics still shows the queued state) are verified by code and tests only: the PROD finalize reading is VOID, because no wizard finalize happened after the deploy and the controlled run was not performed. The founder accepted that on 2026-11-03 ("Read it from real use later"). A VOID is not a pass, so the status is `human_needed`, not `passed`. Nothing was found that is genuinely unmet in code.

## Founder acceptance 2026-11-03

Status moved from `human_needed` to `passed` on the founder's decision of 2026-11-03 (AskUserQuestion, answer "Read it from real use later (Recommended)"), option text quoted verbatim: "Close 190 with the finalize check recorded as VOID. The post-deploy query is already saved, so it gets re-run after the next real contribution and the result added. The TODO already tracks it."

- **SC-2 PROD reading: VOID, accepted.** No wizard finalize happened after the deploy, so the zeros in the organic reading prove nothing. The SC-2 verdict above (code and tests) stands; the PROD half is not claimed.
- **SC-4 PROD reading: VOID, accepted.** The verdict above (code and tests) stands; the PROD half is not claimed.
- **390 px rendering of the updating line: unmeasured, accepted.** Only the component test covers it.
- **SC-3 PROD confirmation stands.** The owner lane showed the figures and the updating line mid-run at the pre-derive and post-derive captures.
- **Tracking.** All three open items are carried in `TODOS.md` as `[190-SC5-POSTDEPLOY-REREAD]` (booked 2026-11-04; the decision text said an entry already tracked it, none did, so it was booked at close). This replaces the "No `TODOS.md` entry tracks this re-read" note under "Human verification required" below, which was true when written. The D-05 surfaces stay in `[190-RERUN-SURFACES-NOT-HOLDING]`.
- **`190-UAT.md`.** Its three items are marked carried to that TODOS entry, not passed.

## Success criteria

| SC | Criterion | Verdict | Basis |
|----|-----------|---------|-------|
| SC-1 | A read-only PROD count of finalize-sourced re-runs after a first computation is recorded before any code change | VERIFIED, PROD reading | `190-01-SUMMARY.md` records 4 of 4 finalize-sourced jobs in the 30-day retention window landing after a finished computation. Its commit (`c5c2bdf6c`, 2026-11-03 20:52) precedes every code commit on the branch. Known limit recorded there: retention only shows about the last 30 days. |
| SC-2 | Finalize queues a re-run only when one is needed; a test goes RED on today's behaviour | VERIFIED by code and tests only; PROD reading VOID | `src/lib/finalize-rerun.ts` `decideFinalizeRerun` exists and is wired at both enqueue sites in `finalize-wizard/route.ts` (composite arm and single-key arm), before the RPC, marker retraction and audit event. Skips only for a current terminal success or a live in-flight job; every read error, absent timestamp, dead job and asset-class change queues. `create-with-key` queues no compute job (0 `enqueue_compute_job` in the file, re-checked). Test files: `finalize-rerun.test.ts` (28 cases) and the route test assert the skip and the queue. I did not re-demonstrate RED against the old unconditional enqueue (no file edits allowed here). |
| SC-3 | A stored-analytics strategy keeps showing its figures during a pending or computing re-compute, with a small "updating" note; a test goes RED on today's behaviour | VERIFIED, code and tests plus PROD reading | See "Wiring" below. PROD: owner lane showed the figures and the updating line mid-run at the pre-derive and post-derive captures; rest-state fetches before and after carried no line (`190-08-SUMMARY.md`). Public lane not applicable in that reading (strategy was private). |
| SC-4 | A strategy with no analytics yet still shows the queued or computing state | VERIFIED by code and tests only; PROD reading VOID | `hasStoredAnalyticsResult` requires a stored series, a finite headline and a success-written marker; a first-ever compute has none, so `analyticsUpdating` stays false and `resolve` returns `not_computed`. `strategyGate.test.ts` "pending and computing WITHOUT a stored result keep refusing"; `page.stale-analytics.test.tsx` "SC-4: a row with no stored series stays withheld". The PROD check (new draft before first computation) was part of the unperformed controlled run. |
| SC-5 | After deploy, a PROD reading or UI check confirms SC-2 and SC-3 | PARTIAL: SC-3 confirmed, SC-2 VOID | SC-2 organic reading: 0 finalize jobs and 0 wizard finalizes after the deploy, so the zeros prove nothing. Controlled run not performed (the wizard needs a pasted key and secret). Founder decision recorded. 390 px overflow of the updating line was not measured on PROD (component test only). |
| SC-6 | Never invent data | VERIFIED by code | Admission needs a stored series, a finite stored headline and success-written flags; a snapshot of the last success's flags is used only when its `computed_at` is the same instant as the row's, otherwise the row fails closed. A `failed` row is never admitted. D-04: a terminal-success row whose derive prestamp left no bound snapshot falls back to the queued state rather than mixing old numbers with new flags. The updating line promises no duration. |

## Wiring checked in the code

- **Gate (D-02):** `isRecomputeOverStoredResult(status, hasStoredResult)` in `src/lib/closed-sets.ts` returns true only for `pending` or `computing` with stored-result evidence; `failed` and missing rows are not admitted. `checkStrategyGate` in `src/lib/strategyGate.ts` passes `ANALYTICS_PENDING`/`ANALYTICS_COMPUTING` only through it; `hasStoredResult` is a required input. Used by `admin/strategy-review/route.ts` and the wizard SyncPreviewStep.
- **Factsheet:** `fetch-and-build-payload.ts` computes `analyticsUpdating`, withholds a non-terminal row without evidence, withholds a composite while updating, applies D-04, and builds from `effectiveDataQualityFlags`. `analyticsUpdating` flows through `build-payload.ts` and `types.ts` (required field) to `FactsheetView.tsx`, which renders `data-testid="factsheet-analytics-updating"` with `ANALYTICS_UPDATING_LINE`. The copy matches the D-06 wording exactly. Rendering depends on the payload alone, so every lane shows it.
- **Cache key:** `page.tsx` uses `factsheet-v2-payload-v20`.
- **Lists, joint, compare:** `queries.ts`, `StrategyTable.tsx`, `v2-joint.ts`, `headline-basis.ts` and `compare/page.tsx` follow the same rule (plan 07).
- **Analytics service:** `job_worker.py` writes `data_quality_flags.last_success_snapshot` on the derive prestamp (`_last_success_snapshot`, `LAST_SUCCESS_SNAPSHOT_KEY`), and fails the job on a failed pre-read instead of prestamping a null snapshot.
- **Debt markers:** none (`TBD`, `FIXME`, `XXX`) added in the touched source files.

## Tests run (this session, in the worktree)

| Command | Result |
|---------|--------|
| vitest: `finalize-rerun`, `stored-analytics-result` (+ parity), `closed-sets`, `strategyGate`, `status-surface-copy`, `FactsheetView.updating-line`, `page.public-cache-key`, `page.stale-analytics`, `fetch-and-build-payload`, `v2-joint`, `headline-basis`, `finalize-wizard/route`, `admin/strategy-review/route`, `queries.stale-analytics-detail`, `StrategyTable.stale-analytics` | 16 files, 808 tests passed |
| vitest: `src/app/(dashboard)/compare`, `composite-read-path`, `queries`, `build-payload`, `src/app/factsheet-share` | 12 files, 603 tests passed |
| pytest from `analytics-service/`: `tests/test_derive_last_success_snapshot.py` | 28 passed |

Not run here: the full workspace suite, lint, mypy and the cross-phase regression gate. The coordinator's evidence for those is main CI on the shipped merge commit (CI and Contracts green), which I did not re-read. The shipped merge commit is not an ancestor in this worktree (squash merge), so I verified the equivalent code on this branch directly.

## Recorded rather than fixed (not gaps)

- **Premise correction (RESEARCH OQ-5):** a re-compute never changes `strategies.status`. The "UNPUBLISHED" the founder saw is the owner-lane notice for a private contribution and was present before the rename. What this phase fixes is the factsheet body being withheld. This report does not claim a status flip was fixed.
- **Surfaces deliberately not holding during a re-run (D-05),** booked in `TODOS.md` as `[190-RERUN-SURFACES-NOT-HOLDING]`: share card image, tear sheet and PDF routes, returns API, recommendations, portfolios and their PDF, scenario composer, `getStrategyDetailV2` and the three detail reads (`getPublicStrategyDetail`, `getFactsheetDetail`, `getStrategyDetail`), composite approval during a re-stitch (still 409).
- **Known limits (a) to (g)** for the derive-to-success window, in `190-08-SUMMARY.md` "VERIFICATION hand-off": no-snapshot rows are withheld on the factsheet and joint; the public cache can serve a pre-prestamp entry for up to its 1 h TTL; deploy skew for chains derived before plan 09; the composite stitch's short csv window; legacy rows without the `cumulative_method` marker; /compare has no status gate; PDF route captures the placeholder in state (b). The lists do not apply D-04.
- **RESEARCH OQ-3:** the unified manager single-key `onboard` re-run is unchanged; the founder decides whether to book it.
- **Defaults still flippable by the founder:** OQ-2 (ranking stays terminal), OQ-4, plan 09's snapshot design, plan 07's /compare dating choice (PROD row counts affected: unmeasured).
- **Follow-up cleanup:** the `composite-read-path.ts` JSDoc still names /compare as caller of the cash-series covered-from reader.
- **Review state:** three code-review rounds (`190-REVIEW.md`); round 3's WR-04 and the SFH-M1 conventions-echo fix landed after round 3 as commits `a1b4a50a8` and `ad035209d` and were not re-reviewed in a fourth round (I read the resulting code and ran its tests; I did not independently re-audit them).

## Human verification required

### 1. SC-2 on PROD after the next real wizard contribution

**Test:** After a real wizard contribution finalizes, re-run `190-MEASUREMENT-postdeploy.sql` (read-only; marker query first, as always) and record the result. The reading only counts if `wizard_contributions_finalized_after_deploy` is at least 1.
**Expected:** `finalize_jobs_after_deploy_after_first_compute_done` is 0 for that finalize (no redundant finalize-sourced `sync_trades` after a finished computation).
**Why human:** needs a real finalize with a pasted key and secret, which the session may not type. Founder accepted the VOID on 2026-11-03. **No `TODOS.md` entry tracks this re-read** (checked at this HEAD: the only phase-190 entry is the surfaces entry), so this item is its only tracker; the coordinator should either book it or keep it on the UAT list.

### 2. SC-4 on PROD: a new draft before its first computation

**Test:** Open a new draft strategy before its first computation completes.
**Expected:** The existing queued/computing line (KCS-09) shows, and no `factsheet-analytics-updating` line.
**Why human:** part of the unperformed controlled run; covered by unit and route tests only.

### 3. 390 px rendering of the updating line

**Test:** View a re-running factsheet at 390 px.
**Expected:** The line wraps inside the header with no sideways scroll (UI-SPEC overflow row).
**Why human:** the browser could not resize below desktop width; component test only.

## Gaps Summary

No gap in code or wiring was found, so there is no `gaps_found`. The status is `human_needed` because SC-5 asks for a PROD confirmation of SC-2 that does not exist yet, and SC-4 and the 390 px row have no PROD reading. If the founder's acceptance of the VOIDs is treated as closing those items, the phase can be completed as passed with the three items above carried forward.

---

_Verified: 2026-11-04_
_Verifier: Claude (gsd-verifier)_
