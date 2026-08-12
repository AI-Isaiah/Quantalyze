---
phase: 154
slug: wizcont-stale-wizard-continuity-no-stale-screens
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-12
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
| TBD | 01 | 0 | STALE-01 | — | Q1/Q2 read-only PROD SELECTs settle which supplier mechanism (M2/M3/M4) fired — **no fix may be designed before this lands** | investigation | Supabase MCP read-only SELECT | n/a | ⬜ pending |
| TBD | 01 | 0 | STALE-01a | — | **T1:** a poll reading `pending` forever stops claiming "Fetching trades…" after the existing patience window and surfaces an honest state | component (fake timers) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 0 | STALE-01a | — | **T1b:** with `isComposite === false` and the SF-1 backstop fired, `wizard-sync-interrupted` renders (the `SyncPreviewStep.tsx:2290-2291` gate) | component | same file | ❌ W0 | ⬜ pending |
| TBD | 01 | 0 | STALE-01a | T-154-02 | **T2:** a `{data: null, error: null}` zero-rows read is **not** coerced to `pending`; the absent row is observable | unit (hook) | `npx vitest run src/hooks/useStrategySyncPoller.test.ts` | ❌ W0 — **no test file for this hook exists today** | ⬜ pending |
| TBD | 01 | 0 | STALE-01a | — | **T2b:** the kickoff arm does not enter `waiting_for_complete` on a 200 whose body says `queued: false` (M4) | component | `SyncPreviewStep.stale.runtime.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | 02 | 0 | STALE-01b | — | **T3:** single-key arm, terminal status + zero `csv_daily_returns` rows ⇒ **no** `gate_failed`, no `ErrorEnvelope`, no `wizard_error` event — it repolls | component | `npx vitest run "…/SyncPreviewStep.stale-refusal.runtime.test.tsx"` | ❌ W0 | ⬜ pending |
| TBD | 02 | 0 | STALE-01b | — | **T3b (symmetry):** the composite arm in the identical state repolls (passes today) — the **pair** makes the divergence the subject, not one arm | component | same file | ❌ W0 | ⬜ pending |
| TBD | 02 | — | STALE-01b | — | Amber in-flight state renders `role="status"` + warning tokens, **never** the red envelope; any unknowable count renders `—`, never a stale number | component | same file | ❌ W0 | ⬜ pending |
| TBD | 01 | — | STALE-01 (backend arm — **only if** Q1/Q2 implicate M3/H-a) | — | `process_key_long` cannot report DONE while its declared child was never enqueued | unit (pytest) | `cd analytics-service && pytest tests/test_long_fetch_follow_on_guard.py -x` | ✅ extend | ⬜ pending |
| TBD | 01 | — | STALE-01 (DB arm — **only if** implicated) | — | bridge branch (d) / `done_pending_children` behaviour pinned | SQL gate | `supabase/tests/test_*.sql` | ⚠️ extend existing bridge tests, do **not** fork | ⬜ pending |
| TBD | 03 | — | WIZCONT-01 | — | Overlay opened with an existing API draft renders the resume banner (`wizard-resume` + `wizard-start-fresh`) **and `sync_preview` actually renders** on Resume | component | `npx vitest run "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx"` | ✅ extend | ⬜ pending |
| TBD | 03 | — | WIZCONT-01 | T-154-01 | "Start fresh" **opens the confirm-delete dialog** and never deletes directly (TRAP-4 standing invariant) | component | same | ✅ exists | ⬜ pending |
| TBD | 03 | — | WIZCONT-01 | — | A **CSV** draft resumes: `WizardClient` with `source="csv"` + a CSV `initialDraft` does not short-circuit to `csv_upload` (`WizardClient.tsx:198`) | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` | ✅ extend | ⬜ pending |
| TBD | 03 | 0 | WIZCONT-01 | — | The overlay's draft read and `wizard/page.tsx` issue the **same** query shape (both import one helper) | contract test | `npx vitest run src/__tests__/contracts/` | ❌ W0 | ⬜ pending |
| TBD | 03 | — | WIZCONT-01 | — | E2E: open overlay from My Strategies empty state with a **seeded** draft → banner → Resume → `sync_preview` | e2e | `npx playwright test e2e/api-key-flow.spec.ts` | ✅ extend — ⚠️ assert the **seeded draft id**, never global empty-state | ⬜ pending |
| TBD | 04 | — | WIZCONT-02 | T-154-03 | Second `create-with-key` with the same MT5 login and a **different** `wizard_session_id` returns the **existing** row; no second `api_keys` row; `strategy_keys` membership untouched | integration (route) | `npx vitest run "src/app/api/strategies/create-with-key/route.test.ts"` | ✅ extend | ⬜ pending |
| TBD | 04 | 0 | WIZCONT-02 | T-154-03 | The partial UNIQUE exists, **is partial** (`WHERE … IS NOT NULL`), and rejects the duplicate | SQL gate | `supabase/tests/test_api_keys_venue_identity_uniq.sql` | ❌ W0 | ⬜ pending |
| TBD | 04 | — | WIZCONT-02 | — | The 23505 handler **distinguishes** the new constraint from `strategies_user_wizard_session_source_uniq` | integration | `create-with-key/route.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 04 | — | WIZCONT-02 | T-154-04 | Dedup notice renders as the neutral strip, **not** an `ErrorEnvelope`, and **never echoes the account id** | component | wizard component test | ❌ W0 | ⬜ pending |
| TBD | 05 | — | WIZCONT-01 | — | REQUIREMENTS.md WIZCONT-01 entry-path claim is **corrected** (`/strategies/new` is a pure `redirect()`, not a chooser) | doc | manual review | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/hooks/useStrategySyncPoller.test.ts` — **no test file exists for this hook at all**; covers T2
- [ ] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx` — covers T1, T1b, T2b (STALE-01a)
- [ ] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` — covers T3, T3b (STALE-01b)
- [ ] `supabase/tests/test_api_keys_venue_identity_uniq.sql` — covers WIZCONT-02's DB backstop
- [ ] A contract test pinning the single-sourced draft query — covers WIZCONT-01's stated criterion
- [ ] Framework install: **none needed** — vitest, Playwright, pytest all present and wired

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
| SC-1 (resume) | `ContributionWizardOverlay.tsx`: revert the draft prop to the literal `initialDraft={null}` | overlay resume-banner component test | ⬜ pending | — |
| SC-1 (resume, 2nd member) | `WizardClient.tsx:198`: restore `if (source === "csv") return "csv_upload";` **above** the `initialDraft` check | CSV-draft resume test in `WizardClient.test.tsx` | ⬜ pending | — |
| SC-1 (TRAP-4) | `ContributionWizardOverlay.tsx`: make "Start fresh" call the delete directly instead of opening the confirm dialog | confirm-dialog test | ⬜ pending | — |
| SC-2a (stall) | `SyncPreviewStep.tsx:2290-2291`: re-add the `isComposite &&` gate on the SF-1 stall backstop | T1b | ⬜ pending | — |
| SC-2a (zero-rows) | `useStrategySyncPoller.ts:228-229`: restore `statusRow?.computation_status ?? "pending"` | T2 | ⬜ pending | — |
| SC-2b (stale refusal) | `SyncPreviewStep.tsx` single-key arm: remove the `series.length === 0 → repoll` guard | T3 | ⬜ pending | — |
| SC-2b (2nd member / symmetry) | Remove the **composite** arm's existing R2-5 guard (`:1092-1096`) | T3b | ⬜ pending | — |
| SC-3 (dedup) | `create-with-key/route.ts`: drop the venue-identity arm from the fence, keeping only `wizard_session_id` | route dedup integration test | ⬜ pending | — |
| SC-3 (DB backstop) | Drop the `WHERE … IS NOT NULL` predicate so the index is total, not partial | `test_api_keys_venue_identity_uniq.sql` | ⬜ pending | — |
| SC-3 (fail-toward) | Make the dedup path UPDATE the existing `api_keys` row instead of returning it | route test asserting `strategy_keys` membership + ciphertext unchanged | ⬜ pending | — |

*Rules:*
- **Observed means run.** "The test covers it" is not evidence. Paste the failing assertion.
- **A mutation that is skipped** (ambiguous anchor, unreachable) is recorded as **skipped**, never as caught.
- **Prefer the second member of a class** — that is what detects instance-fixes masquerading as class-fixes (the exact defect class that scrapped 37 fix commits on Phase 140).

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test,
> so the test passes for any implementation.

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test.
      ⚠️ Specifically: T1/T1b must **not** import `RETRY_THRESHOLD_MS` / `WARN_THRESHOLD_MS` from
      `SyncPreviewStep.tsx`. Advance fake time by a literal, or the test passes for any threshold —
      including a regression that moves it.
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test.
      ⚠️ Specifically: the terminal-status assertions must **not** be written against
      `isComputedAnalytics()` from `closed-sets.ts` — that is the function under test. Pin the
      literal set `{failed, complete, complete_with_warnings}` and pin it against the **DB CHECK
      constraint**, which is the independent authority.
- [ ] Table/registry sizes pinned to a **literal count**, not `len(THE_TABLE)`.
- [ ] Any fake/double pinned against the real contract it stands in for.
      ⚠️ Specifically: the poll fake must reproduce PostgREST's real `{data: null, error: null}`
      zero-rows shape for `.maybeSingle()`, not a hand-invented `{data: undefined}` — T2 is
      meaningless against a double that cannot produce the shape the bug rides on.

*Deliberate self-referential oracles:* none. If one is introduced, name it here and state what
independently covers it.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s (targeted)
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] ⛔ **T1/T2/T3 demonstrated RED at the pre-fix commit, with the failing output pasted into the
      plan ledger** — this is the CONTEXT.md/ROADMAP gate for STALE-01, not a nice-to-have
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
