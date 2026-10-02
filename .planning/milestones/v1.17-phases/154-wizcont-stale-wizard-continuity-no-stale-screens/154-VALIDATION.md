---
phase: 154
slug: wizcont-stale-wizard-continuity-no-stale-screens
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-12
closed_by: 154-08
closed: 2026-08-12
---

# Phase 154 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `154-RESEARCH.md` § Validation Architecture (lines 1012-1078).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom + node projects) + @testing-library/react + @vitest/coverage-v8 · pytest + VCR for `analytics-service/` · Playwright for `e2e/` · pgTAP-style SQL gates in `supabase/tests/test_*.sql` |
| **Config file** | `vitest.config.ts` (`environment: "jsdom"`, `setupFiles: ["src/test-setup.ts"]`) |
| **Quick run command** | `npx vitest run <path> --no-file-parallelism` |
| **Full suite command** | `npm test` (CI: sharded with `--coverage`, merged by the `frontend-coverage` job) |
| **Estimated runtime** | ~10-20s targeted; full suite several minutes |

⚠️ **Environment landmines that invalidate a run:**
- `pytest` **must** be invoked from `analytics-service/`, never repo root — otherwise the VCR
  `cassette_library_dir` misses and **live broker calls fire**, producing two bogus failures.
- CI is **Node 22**, local is **Node 25**. A CI-only vitest failure is **not** a flake; reproduce
  with `PATH=/opt/homebrew/opt/node@22/bin`.
- Coverage is a **blocking** CI gate: lines 82 / statements 80 / functions 74 / branches 72.
- `*_live.py` and `skipIf` vitest specs **never run in CI** — they cannot be the proof of anything.
- e2e runs against a **shared TEST DB**: every spec asserts its **own seed invariant**, never a
  global empty-state.

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched paths> --no-file-parallelism`
- **After every plan wave:** `npm test` + (if `analytics-service/` touched)
  `cd analytics-service && pytest && mypy --strict .`
- **Before `/gsd:verify-work`:** full suite green
- **Max feedback latency:** ~20s targeted / ~5 min full

---

## Per-Task Verification Map

> Task IDs are minted by the planner. Rows below are the **requirement-level** contract every task
> map must satisfy; the planner expands them to `154-NN-MM` granularity.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 154-01-01 | 01 | 0 | STALE-01 | — | Q1/Q2 read-only PROD SELECTs settle which supplier mechanism (M2/M3/M4) fired — **no fix may be designed before this lands** | investigation | Supabase MCP read-only SELECT | ✅ `154-INVESTIGATION.md` | ✅ done — **verdict M2(ii)**; M3/M4/M2(i) ruled out |
| 154-01-02 | 01 | 0 | STALE-01a | — | **T1:** a poll reading `pending` forever stops claiming "Fetching trades…" after the existing patience window and surfaces an honest state | component (fake timers) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx"` | ✅ exists | ✅ **GREEN at `116397ad`** (was ❌ red-observed at `8a74683f` — rendered the claim at `1000s` elapsed) |
| 154-01-02 | 01 | 0 | STALE-01a | — | **T1b:** with `isComposite === false` and the SF-1 backstop fired, `wizard-sync-interrupted` renders (the render gate that was `isComposite && (…)`) | component | same file | ✅ exists | ✅ **GREEN at `116397ad`** (was ❌ red-observed at `8a74683f` — `expected null not to be null`) |
| 154-01-02 | 01 | 0 | STALE-01a | T-154-02 | **T2:** a `{data: null, error: null}` zero-rows read is **not** coerced to `pending`; the absent row is observable | unit (hook) | `npx vitest run src/hooks/useStrategySyncPoller.test.ts` | ✅ created (none existed) | ✅ **GREEN at `1aa83aee`** (154-04) (was ❌ red-observed at `8a74683f` — 13 fabrications from 13 empty reads) |
| 154-01-02 | 01 | 0 | STALE-01a | — | **T2b:** the kickoff arm does not enter `waiting_for_complete` on a 200 whose body says `queued: false` (M4) | component | `SyncPreviewStep.stale.runtime.test.tsx` | ✅ exists | ✅ **GREEN at `116397ad`** (was ❌ red-observed at `8a74683f`) |
| 154-01-02 | 01 | 0 | STALE-01a | — | **SYM-interval (symmetry):** the interval arm reports NOTHING for the identical zero-rows read (TWIN-3) — the **pair** makes the divergence the subject | unit (hook) | `npx vitest run src/hooks/useStrategySyncPoller.test.ts` | ✅ exists | ✅ **green at HEAD** — the module already contains its own correct answer |
| 154-01-03 | 01 | 0 | STALE-01b | — | **T3:** single-key arm, terminal status + zero `csv_daily_returns` rows ⇒ **no** `gate_failed`, no `ErrorEnvelope`, no `wizard_error` event — it repolls | component | `npx vitest run "…/SyncPreviewStep.stale-refusal.runtime.test.tsx"` | ✅ exists | ✅ **GREEN at `116397ad`** (was ❌ red-observed — rendered `data-error-code="GATE_INSUFFICIENT_TRADES"`, ⚠️ **not** the predicted provenance code) |
| 154-01-03 | 01 | 0 | STALE-01b | — | **T3b (symmetry):** the composite arm in the identical state repolls (passes today) — the **pair** makes the divergence the subject, not one arm | component | same file | ✅ exists | ✅ **still GREEN at `116397ad`** — the composite `return "repoll"` is byte-unchanged by the twin |
| 154-08 | 08 | 3 | STALE-01b | T-154-08-B/C | Amber in-flight state renders `role="status"` + warning tokens, **never** the red envelope; any unknowable count renders `—`, never a stale number | component | `SyncPreviewStep.stale-refusal.runtime.test.tsx` (`AMBER`, `NO-RED-WHILE-IN-FLIGHT`, `NO-EVIDENCE`, `NUMBERS`) | ✅ extended | ✅ **green at `116397ad`** — ⚠️ the em-dash CELL is unreachable in this state (the recomputing screen renders no metric cell at all), so `NUMBERS` discharges the contract by **absence**: six hand-typed stale renderings and both fabricated-zero sentences are asserted absent, with the amber heading as the non-vacuity fence |
| 154-08 | 08 | 3 | STALE-01a | T-154-08-A | `heavyFetchErrorsRef` is reset by the new NON-throwing repoll, so a healthy heal window cannot be escalated to `SYNC_FAILED` (RESEARCH **A6**) | component | same file (`A6`) | ✅ new case | ✅ **green at `116397ad`**; mutation-proven RED with the reset removed |
| 154-08 | 08 | 3 | STALE-01a | — | TWIN-5 half 3: the single-key arm **issues** the sync-progress fetch and gets the banner, while the per-key panel stays composite-only | component | `SyncPreviewStep.progress.render.test.tsx` | ✅ premise changed | ✅ **green at `116397ad`** — the case previously asserted `progressFetches.toHaveLength(0)`, i.e. it pinned the gate |
| 154-07 | 07 | — | STALE-01 (backend arm — **only if** Q1/Q2 implicate M3/H-a) | — | `process_key_long` cannot report DONE while its declared child was never enqueued | unit (pytest) | `cd analytics-service && pytest tests/test_long_fetch_follow_on_guard.py -x` | ✅ extend | ⏭️ **NOT RUN — arm not activated.** M3 ruled out by Q2 (22 job rows, all `done`, `attempts=1`, `last_error` null). 154-07 recorded `ARM C: NO-OP`; `git diff 555fb78f..HEAD -- analytics-service/` is **empty**, so there is no Python change for a pytest run to be evidence about |
| 154-07 | 07 | — | STALE-01 (DB arm — **only if** implicated) | — | bridge branch (d) / `done_pending_children` behaviour pinned | SQL gate | `supabase/tests/test_*.sql` | ⚠️ extend existing bridge tests, do **not** fork | ⏭️ **NOT RUN — arm not activated.** Same verdict; `git diff … -- supabase/` is empty |
| 154-05 | 05 | 2 | WIZCONT-01 | — | Overlay opened with an existing API draft renders the resume banner (`wizard-resume` + `wizard-start-fresh`) **and `sync_preview` actually renders** on Resume | component | `npx vitest run "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx"` | ✅ extend | ✅ **green** (154-05, `96135051`) |
| 154-05 | 05 | 2 | WIZCONT-01 | T-154-01 | "Start fresh" **opens the confirm-delete dialog** and never deletes directly (TRAP-4 standing invariant) | component | same | ✅ exists | ✅ **green** (154-05) |
| 154-05 | 05 | 2 | WIZCONT-01 | — | A **CSV** draft resumes: `WizardClient` with `source="csv"` + a CSV `initialDraft` does not short-circuit to `csv_upload` | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` | ✅ extend | ✅ **green** (154-05, `f8a6d169`) |
| 154-02 | 02 | 0 | WIZCONT-01 | — | The overlay's draft read and `wizard/page.tsx` issue the **same** query shape (both import one helper) | contract test | `npx vitest run src/__tests__/wizard-draft-query-single-source.test.ts` | ✅ created (154-02) | ✅ **green** |
| 154-05 | 05 | 2 | WIZCONT-01 | — | E2E: open overlay from My Strategies empty state with a **seeded** draft → banner → Resume → `sync_preview` | e2e | `npx playwright test e2e/wizard-resume.spec.ts` | ✅ created + wired into the `e2e-seeded` CI batch | ⚠️ **authored + CI-wired, NOT run in this worktree** — Playwright needs the shared TEST DB and seeded fixtures; it runs in the `e2e-seeded` job, not here. Recorded as unverified-by-me rather than claimed |
| 154-06 | 06 | 2 | WIZCONT-02 | T-154-03 | Second `create-with-key` with the same MT5 login and a **different** `wizard_session_id` returns the **existing** row; no second `api_keys` row; `strategy_keys` membership untouched | integration (route) | `npx vitest run "src/app/api/strategies/create-with-key/route.test.ts"` | ✅ extend | ✅ **green** (154-06, `bac9a981`) |
| 154-03 | 03 | 0 | WIZCONT-02 | T-154-03 | The partial UNIQUE exists, **is partial** (`WHERE … IS NOT NULL`), and rejects the duplicate | SQL gate | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ✅ created (154-03) | ⚠️ **authored, NOT run in this worktree** — a SQL gate needs a live Postgres; it runs in CI's DB job. 154-03-TEST-APPLY records the TEST/PROD application |
| 154-06 | 06 | 2 | WIZCONT-02 | — | The 23505 handler **distinguishes** the new constraint from `strategies_user_wizard_session_source_uniq` | integration | `create-with-key/route.test.ts` + `src/lib/api/pgConstraintName.test.ts` | ✅ created (154-06) | ✅ **green** (`0b92ada0`, `64f88b98`) |
| 154-06 | 06 | 2 | WIZCONT-02 | T-154-04 | Dedup notice renders as the neutral strip, **not** an `ErrorEnvelope`, and **never echoes the account id** | component | `WizardClient.test.tsx` | ✅ created (154-06) | ✅ **green** (`9e45b11c`) — ⚠️ the strip landed in `WizardClient`, not `ConnectKeyStep`; see 154-06 deviation 2 |
| 154-05 | 05 | 2 | WIZCONT-01 | — | REQUIREMENTS.md WIZCONT-01 entry-path claim is **corrected** (`/strategies/new` is a pure `redirect()`, not a chooser) | doc | manual review | n/a | ✅ **done** (154-05 / 154-06 REQUIREMENTS edits) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/hooks/useStrategySyncPoller.test.ts` — **no test file existed for this hook at all**; covers T2 + the `SYM-interval` twin (landed `8a74683f`)
- [x] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx` — covers T1, T1b, T2b (STALE-01a) (landed `8a74683f`)
- [x] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` — covers T3, T3b (STALE-01b)
- [x] `supabase/tests/test_api_keys_venue_identity_uniq.sql` — covers WIZCONT-02's DB backstop (landed 154-03; asserts the predicate TEXT, not merely that an index by that name exists)
- [x] `src/__tests__/wizard-draft-query-single-source.test.ts` — the contract test pinning the single-sourced draft query — covers WIZCONT-01's stated criterion (landed 154-02)
- [x] Framework install: **none needed** — vitest, Playwright, pytest all present and wired

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Q1/Q2 PROD discriminator SELECTs | STALE-01 | Read-only queries against the PROD Supabase project; no automated harness has PROD credentials, and by design should not | Run the two SELECTs verbatim from `154-RESEARCH.md` § STALE-01 Step 6 via the Supabase MCP against project `khslejtfbuezsmvmtsdn`. Match the result against the discriminator table to select M2 / M3 / M4. **Read-only — no writes, no migrations.** |
| Founder confirmation that the overlay resume lands on the right step | WIZCONT-01 | The founder is the only observer of the original restart; only they can confirm the restart is gone | Open `+ Strategy` with a live draft present; confirm the resume banner appears and Resume lands on the draft's step, not step 1 |

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**
> ⭐ Standing project lesson: three money bugs survived six review passes behind self-referential
> oracles. Mutations must be **semantic** edits to production code, and the second member of a
> class is the one worth mutating.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (resume) | `ContributionWizardOverlay.tsx`: revert the draft prop to the literal `initialDraft={null}` | overlay resume-banner component test | ✅ **observed** (154-05) | RED, 3 cases: `× an existing API draft renders the real resume banner and lands on the draft` · `× Start fresh only OPENS the confirm dialog — it never deletes (TRAP-4)` · `× switching to the CSV tab offers a FRESH flow, never the API draft` — `TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-resume"]`; `Tests 3 failed \| 11 passed (14)` |
| SC-1 (resume, 2nd member) | `WizardClient.tsx`: restore `if (source === "csv") return "csv_upload";` **above** the `initialDraft` check | CSV-draft resume test in `WizardClient.test.tsx` | ⚠️ **observed GREEN — reported as a finding, not a catch** (154-05) | `30 passed, 0 failed`. With `draftMatchesSource` applied by BOTH callers a draft only ever reaches its own branch, so the two orderings return the same step: **the reorder is defense-in-depth, not the behavioral fix.** 154-05 located the real member and mutated it instead ⤵ |
| SC-1 (resume, 2nd member — SUBSTITUTE, the one that caught it) | `WizardClient.tsx`: restore `handleResume`'s hard-coded `setStep("sync_preview")` | CSV-draft resume test | ✅ **observed** (154-05) | RED: `× Resume on a CSV draft stays on csv_upload — it never lands on sync_preview` — `TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-csv-dropzone"]`; `Tests 1 failed \| 29 passed (30)` |
| SC-1 (silent resume — third, added by 154-05) | `localStorage.ts`: restore `if (!loaded) return {};` (the silent-resume gate) | banner-for-unpointed-draft tests | ✅ **observed** (154-05) | RED, 4 cases across two files — `AssertionError: expected {} to deeply equal { showResumeBanner: true }`; `Tests 4 failed \| 46 passed (50)` |
| SC-1 (TRAP-4) | `ContributionWizardOverlay.tsx`: make "Start fresh" call the delete directly instead of opening the confirm dialog | confirm-dialog test | ✅ **observed** (154-05) | RED, 4 cases — `AssertionError: Start fresh must ASK before it destroys — TRAP-4 is a standing invariant, and reaching the wizard through the overlay must not weaken it.: expected false to be true`; `Tests 4 failed \| 40 passed (44)` |
| SC-2a (stall) | `SyncPreviewStep.tsx`: re-add the `isComposite &&` conjunct on `showInterruptedBanner` | T1b | ✅ **observed TWICE** — pre-fix ⭐ **and re-applied to the FIXED tree (154-08)** | Post-fix, at `116397ad`: **3 cases RED**, not one — `× T1` · `× T1b` · `× T2b`. T1b: `AssertionError: The SF-1 stall backstop fired … and the amber recoverable banner … was suppressed because isComposite is false …: expected null not to be null`. T1: `expected 'Computing your verified factsheetWe a…' not to contain 'Fetching trades...'`, received `"…Fetching trades...1000sSync is taking much longer than expected…"`. Reverted; `grep -rn MUTANT src/` → 0 |
| SC-2a (zero-rows) | `useStrategySyncPoller.ts`: restore `statusRow?.computation_status ?? "pending"` (and neuter the `if (!statusRow)` arm) | T2 | ✅ **observed TWICE** — pre-fix ⭐ **and re-applied to the FIXED tree (154-08)** | Post-fix: **2 cases RED** — `× T2: a zero-rows read is NEVER reported as the fabricated "pending" status` (`expected [ 'pending', 'pending', …(11) ] to not include 'pending'`) and `× GRACE-ladder: a persistently absent row escalates via onError at the grace boundary` (`expected "vi.fn()" to be called at least once`). Reverted |
| SC-2b (stale refusal) | `SyncPreviewStep.tsx` single-key arm: remove the empty-series `→ repoll` guard | T3 | ✅ **observed TWICE** — pre-fix ⭐ **and re-applied to the FIXED tree (154-08)** | Post-fix: **6 cases RED** — `× T3` · `× AMBER` · `× NO-RED-WHILE-IN-FLIGHT` · `× NO-EVIDENCE` · `× NUMBERS` · `× A6`. T3: `AssertionError: The wizard rendered a TERMINAL red envelope during the series heal-delete window …: expected <div role="alert" …(4)>…(4)</div> to be null`. Reverted |
| SC-2b (2nd member / symmetry) | Remove the **composite** arm's existing R2-5 guard | T3b | ✅ **observed** — run by 154-08, the plan that greened T3, exactly as 154-01 required | `× T3b: the composite arm in the IDENTICAL empty-series state repolls instead of refusing` — `AssertionError: The composite arm's R2-5 guard … is gone. It is the ONLY in-repo precedent for "an empty series is a moment, not a verdict" … Losing it closes TWIN-1 in the wrong direction: two arms agreeing on the WRONG answer is not symmetry.: expected <div role="alert" …(4)>…(5)</div> to be null`; `Tests 1 failed \| 7 passed (8)`. Reverted. ⭐ **Exactly one case reddened** — the class-fix did not make the two arms redundant |
| SC-2c (A6 counter — added by 154-08) | `SyncPreviewStep.tsx`: remove `heavyFetchErrorsRef.current = 0` from the single-key repoll | `A6` case | ✅ **observed** (154-08) | `× A6: a clean read into the repoll state RESETS the consecutive heavy-failure count` — `AssertionError: A healthy run was escalated to a terminal envelope. Three heavy failures were counted, but they were not CONSECUTIVE …: expected <div role="alert" …(4)>…(5)</div> to be null`, rendering `data-error-code="SYNC_FAILED"`. Reverted |
| SC-2d (amber evidence — added by 154-08) | `SyncPreviewStep.tsx`: drop the `isJobInFlight(...)` conjunct so the amber block renders on the repoll state alone | `NO-EVIDENCE` case | ✅ **observed** (154-08) | `× NO-EVIDENCE: with NO job in flight the amber block is withheld` — `AssertionError: The screen announced "Recomputing this strategy's analytics" while the in-flight datum reported no job at all. That is the same defect this phase closes, pointing the other way: a reading turned into a claim.`; `Tests 1 failed \| 7 passed (8)`. Reverted |

⭐ **Why three rows read "observed" without a mutation being applied.** Each of those mutations
describes *restoring the defect*. At `8a74683f` **the defect is still present** — this plan lands the
tests before any fix, so HEAD **is** the mutated tree, and the RED runs above are the mutation
evidence in its strongest available form: the assertion was observed failing against real production
code, not against a hand-applied edit. ⚠️ **This does NOT discharge the row for the post-fix tree.**
Once 154-04 / 154-08 land, each mutation must be re-applied to the FIXED source and re-observed —
otherwise a fix that greens the test by weakening the test is indistinguishable from one that works.
Owner: the plan that greens each row.

✅ **DISCHARGED by 154-08.** All four SC-2 mutations were re-applied to the FIXED tree at
`116397ad`, observed RED with the assertions pasted above, and reverted; `grep -rn MUTANT src/` → 0
and `git status --short` → clean afterwards. The post-fix runs are recorded in the rows themselves
("observed TWICE"), so the pre-fix evidence is no longer load-bearing on its own.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-3 (dedup) | `create-with-key/route.ts`: drop the venue-identity arm from the fence, keeping only `wizard_session_id` (`if (venueAccountId)` → `if (false)`) | route dedup integration test | ✅ **observed** (154-06) | RED, 7 cases: `× THE BUG: same MT5 login + a DIFFERENT wizard_session_id resolves to the EXISTING row, not a second draft` · `× FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes and never re-encrypts` · `× reads the LIVE row only — the fence filters disconnected_at IS NULL` · `× trims the login so a stray space cannot make the dedup MISS` · `× a fence READ FAULT falls through to the RPC and never 500s` · `× a MISSING service-role credential degrades to a dark fence` · `× venue-identity constraint + resolvable → 200 deduped with the EXISTING ids`; `Tests 7 failed \| 90 passed (97)` |
| SC-3 (DB backstop) | Drop the `WHERE … IS NOT NULL` predicate so the index is total, not partial | `test_api_keys_venue_identity_uniq.sql` | ⏭️ **SKIPPED, with reason — never "caught"** | 154-06 authored **no DDL**, so there was no live index for it to mutate in that plan's tree, and the SQL gate needs a Postgres this worktree does not have. The property is held by 154-03's gate, which asserts the predicate **TEXT** rather than merely that a partial index by that name exists. Recorded as skipped rather than claimed |
| SC-3 (fail-toward) | Make the dedup path UPDATE the existing `api_keys` row instead of returning it | route test asserting `strategy_keys` membership + ciphertext unchanged | ✅ **observed** (154-06) | RED: `× FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes and never re-encrypts` — `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`; `Tests 1 failed \| 96 passed (97)` |
| SC-3 (dedup strip — added by 154-06, since the strip moved files) | `WizardClient.tsx`: delete the dedup strip | `WizardClient.test.tsx` strip cases | ✅ **observed** (154-06) | RED, 3 cases: `× renders the neutral strip after a connect the server resolved onto the existing strategy` · `× is NEUTRAL, not an error: no ErrorEnvelope, and none of the warning/negative tokens` · `× is SELF-CLEARING: a later ordinary connect takes the notice down`; `Tests 3 failed \| 27 passed (30)` |

*Rules:*
- **Observed means run.** "The test covers it" is not evidence. Paste the failing assertion.
- **A mutation that is skipped** (ambiguous anchor, unreachable) is recorded as **skipped**, never as caught.
- **Prefer the second member of a class** — that is what detects instance-fixes masquerading as class-fixes (the exact defect class that scrapped 37 fix commits on Phase 140).

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test,
> so the test passes for any implementation.

> **Scope of the ticks below: the three Wave-0 files landed by plan 154-01 only.** Plans 154-03/04/07/08
> add further tests and must re-verify each line against their own files; a tick here is not a
> phase-wide clearance.

**154-08 re-verification of its own additions (the extension to `SyncPreviewStep.stale-refusal.runtime.test.tsx`
and the premise change in `SyncPreviewStep.progress.render.test.tsx`):**

- [x] **No constant imported from the module under test.** `grep -n "RETRY_THRESHOLD_MS\|WARN_THRESHOLD_MS\|SLOW_HINT_MS\|POLL_BACKOFF_MS\|isComputedAnalytics\|MAX_CONSECUTIVE_POLL_ERRORS"` over both 154-01 pin files and `useStrategySyncPoller.test.ts` matches **only prose inside comments** — every match is a line explaining why the identifier is *not* imported. The stale-refusal file's import list is still four lines (`@testing-library/react`, `vitest`, the module under test, and the analytics mock it spies on).
- [x] **The new needles are hand-typed, not read off the component.** `RECOMPUTING_HEADING` / `RECOMPUTING_BODY` are transcribed from the UI-SPEC; `AMBER_TOKENS` (`border-warning/40`, `bg-warning/5`) is hand-typed and asserted **against** the absence of `negative`, so it is a colour-SEMANTICS oracle rather than a class-name spelling test; `STALE_RENDERED` is six hand-computed renderings of the seeded numbers. ⛔ Neither `FINISHED_JOB_STATUSES` nor `isJobInFlight` — the new closed set 154-08 derives from `StitchJobStatus` — is imported: the tests pass the plain wire string `"running"` and the literal `null`.
- [x] **Table/registry sizes:** no registry is asserted by 154-08's additions, and **no new `WizardErrorCode` was minted**, so `EXPECTED_TABLE_SIZE` at both `wizardErrors.test.ts` sites is untouched (its two hand-typed literals are unchanged in the diff). Verified against the plan's GATE-1 condition: the verdict is M2(ii), which surfaces existing affordances and demands no new code.
- [x] **Every fake pinned to the contract it stands in for.** The sync-progress double is the route's real projection shape (`{jobStatus, stalled, memberProgress, degraded}`), and `jobStatus` defaults to `null` — 154-04's "zero compute_jobs rows" meaning — which is what makes T3/T3b assert the repoll on the empty series ALONE. The `csvFailPlan` double answers a real PostgREST error-as-value (`57014`, statement timeout), the same shape `readfailure.runtime.test.tsx` uses. `AMBER`'s vacuity fence is `NO-EVIDENCE`, and it was mutation-proven (SC-2d).
- [x] **Every absence assertion has a positive counterpart.** `NO-RED-WHILE-IN-FLIGHT` asserts the amber block IS up; `NUMBERS` asserts the amber heading IS present and the passed-branch CTA is NOT; `A6` asserts the run is still waiting rather than merely un-refused. The changed `progress.render.test.tsx` case pairs its widened-fetch assertion with the half that did NOT widen (the per-key panel stays composite-only against a body carrying three member rows).

- [x] No test imports a **constant** from the module it tests — expected values are **literals** in the test.
      Verified: `grep -n "RETRY_THRESHOLD_MS\|WARN_THRESHOLD_MS\|SLOW_HINT_MS\|POLL_BACKOFF_MS\|isComputedAnalytics"`
      over the three files matches **only prose inside comments** (each match is a line explaining why
      the identifier is *not* imported). The import lists are three lines each: `vitest`,
      `@testing-library/react`, and the module under test. Advances are the hand-typed literals
      `1_000_000` / `30_000` / `60_000`; schedules are the hand-typed `[3000, 3000, 5000]` and `3000`.
      ⚠️ Specifically: T1/T1b must **not** import `RETRY_THRESHOLD_MS` / `WARN_THRESHOLD_MS` from
      `SyncPreviewStep.tsx`. Advance fake time by a literal, or the test passes for any threshold —
      including a regression that moves it.
- [x] No assertion compares a value to itself via a re-export, fixture, or table under test.
      Verified: `TERMINAL_STATUSES = ["failed", "complete", "complete_with_warnings"]` is hand-typed
      in `useStrategySyncPoller.test.ts` with an inline citation to the DB CHECK constraint in
      migration `20260602120000` as its independent authority; `isComputedAnalytics` is never
      imported. The rendered needles (`"Fetching trades..."`, `code: <CODE>`,
      `"Stitching your composite track record"`) are all hand-transcribed from the component with
      file:line comments, never read off `WIZARD_ERROR_COPY` or the component.
      ⭐ **This discipline paid for itself in T3.** The plan named
      `RENDERED_CODE("GATE_SERIES_PROVENANCE_UNVERIFIED")` as the needle; measured, HEAD renders
      `GATE_INSUFFICIENT_TRADES` (the provenance arm requires `csvRowCount > 0`, and the heal-delete
      window has zero). A name-only needle would have reported T3 **GREEN against the defect**. T3
      therefore asserts a structural `[data-error-code]` probe — which catches *any* refusal — plus
      both named codes.
- [x] Table/registry sizes pinned to a **literal count**, not `len(THE_TABLE)`. (No registry is
      asserted by the Wave-0 files; the closed set above is the only table-shaped oracle and it is a
      hand-typed literal.)
- [x] Any fake/double pinned against the real contract it stands in for.
      The zero-rows double is the literal `{ data: null, error: null }` and is itself pinned by the
      `DOUBLE:` case, which asserts the key set and both null values — so a later edit to
      `{ data: undefined }` reddens instead of silently hollowing T2. The chain double additionally
      supports **both** await forms (`.maybeSingle()` for the ladder arm, `.single()` for the
      interval arm); `INTERVAL-CTRL:` exists precisely so `SYM-interval` cannot pass vacuously on a
      double that rejects rather than reads.

*Deliberate self-referential oracles:* none. If one is introduced, name it here and state what
independently covers it.

**Vacuity fences (154-01 files).** Every absence assertion carries a positive counterpart
(`WAITING-CTRL`, `REFUSAL-CTRL`, `LADDER-CTRL`, `INTERVAL-CTRL`) **and** `expect(text.length).toBeGreaterThan(0)`.
`WAITING-CTRL` and `REFUSAL-CTRL` additionally state the property a fix must NOT break: the in-flight
sentence is correct *inside* the patience window (the defect is the unbounded claim, not the claim),
and an unstamped series that genuinely exists still earns its refusal.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — all five Wave-0 rows above are now `[x]`
- [x] No watch-mode flags — every command in this file is `vitest run … --no-file-parallelism`
- [x] Feedback latency < 20s (targeted) — the two pin files run in **1.3 s** together
- [x] **Every success criterion has a Falsifiability Ledger row**
- [x] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason** — 13 observed (one of them, SC-1 2nd-member, observed **GREEN and reported as a finding**, with the substitute mutation that did catch it recorded beside it); **1 skipped-with-reason** (SC-3 DB backstop — no Postgres in this worktree and no DDL in 154-06's tree; held by 154-03's predicate-TEXT gate). **Zero ⬜ pending rows remain.**
- [x] **Oracle Independence checklist complete** — including 154-08's re-verification of its own additions above
- [x] ⛔ **T1/T2/T3 demonstrated RED at the pre-fix commit, with the failing output pasted into the
      plan ledger** — this is the CONTEXT.md/ROADMAP gate for STALE-01, not a nice-to-have.
      **Discharged:** T1, T1b, T2, T2b RED at `8a74683f`; T3 RED; `SYM-interval` and T3b GREEN.
      Failing output pasted verbatim into `154-INVESTIGATION.md` § "RED evidence". Zero production
      source files were modified to produce it.
- [x] `nyquist_compliant: true` set in frontmatter

### Phase-gate runs (154-08, worktree `agent-ac39fe6ff7ea88adb` at `3dd63220`)

| Gate | Result |
|---|---|
| `npm test` (full vitest) | **779 test files passed, 19 skipped; 11759 tests passed, 287 skipped, 0 failed** |
| Coverage thresholds (82 / 80 / 74 / 72) | **CLEAR** — lines **88.52%**, statements **86.48%**, functions **83.41%**, branches **80.95%**; `npm run test:coverage` emitted no threshold error |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors**, 2 warnings — both pre-existing and in files this plan did not touch (`ContributionWizardOverlay.tsx` unused disable directive; `EquityChart.tsx` exhaustive-deps). Route/admin manifest checks OK |
| `analytics-service` pytest + `mypy --strict` | **NOT RUN — correctly.** `git diff 555fb78f..HEAD -- analytics-service/ supabase/` is **empty**: 154-07 is the NO-OP arm and no plan in this phase authored Python or SQL after 154-03 |
| `grep -rn MUTANT src/` | **0** |
| `git status --short` after the mutation quartet | clean |

⚠️ **One gate was RED at the phase base and is recorded rather than hidden.**
`src/lib/seam-citations.invariant.test.ts` (a repo-wide blocking gate) failed at `555fb78f` on two
bare `file:line` citations in `create-with-key/route.ts` left by **154-06**, and 154-08 added two
more of its own. All four were converted to symbol-anchored references in `3dd63220`
(comment-only, no behaviour). Without that the "full suite green" criterion could not have been met.

**Approval:** ✅ signed off by 154-08 (executor), 2026-08-12.
