---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
verified: 2026-08-12T11:04:34Z
status: human_needed
score: 3/3 must-haves verified (code-level); 4 items require human/CI confirmation
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Open `+ Strategy` (allocations / scenario / My Strategies empty state) with a live wizard draft present. Confirm the resume banner appears and Resume lands on the draft's step, not step 1. Repeat for a CSV draft."
    expected: "`Checking for a saved draft…` briefly, then the resume banner; Resume lands on `sync_preview` for an API/composite draft and on `csv_upload` for a CSV draft. Start fresh opens the confirm-delete dialog, never deletes directly."
    why_human: "The founder is the only observer of the original 2026-08-04 restart; only they can confirm the restart is gone. Carried forward verbatim from 154-VALIDATION.md § Manual-Only Verifications."
  - test: "Drive a single-key wizard into the mid-re-derive window and look at the amber `wizard-sync-recomputing` block on screen."
    expected: "Amber (warning) block with heading `Recomputing this strategy's analytics`; no red envelope; no metric numbers; contrast and spacing per 154-UI-SPEC."
    why_human: "Visual/semantic-colour appearance and copy legibility cannot be verified by grep. Known accepted limit — no browser pass has been run on this block."
  - test: "Run the `e2e-seeded` CI batch (`npx playwright test e2e/wizard-resume.spec.ts`) against the shared TEST DB."
    expected: "Seeded draft → overlay → banner → Resume → `sync_preview`."
    why_human: "Playwright needs the shared TEST DB and seeded fixtures; not runnable in this checkout. Authored and CI-wired (`.github/workflows/ci.yml:1785`), never executed."
  - test: "Run the SQL gate `supabase/tests/test_api_keys_venue_identity_uniq.sql` in CI's DB job."
    expected: "The partial UNIQUE exists, is partial (predicate TEXT asserted, not just the index name), and rejects the duplicate."
    why_human: "A pgTAP-style SQL gate needs a live Postgres. 154-03-TEST-APPLY.md records the TEST/PROD application, but the gate itself has not been executed."
---

# Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens — Verification Report

**Phase Goal:** Re-entering the wizard continues where the founder left off, screens never show a state the backend has already left, and a token-less credential re-connect cannot mint duplicates
**Verified:** 2026-08-12T11:04:34Z
**HEAD:** `c5106aad` (branch `docs/phase-156-connect-refactor`; phase base `54a0d26d`)
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Gates — re-run by the verifier, not read from SUMMARY

| Gate | Command | Result | Status |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | exit **0**, no output | ✓ PASS |
| Full vitest | `npx vitest run` | **779 test files passed, 19 skipped · 11759 passed, 0 failed, 287 skipped (12046)**, 180.6 s | ✓ PASS |
| Debt markers on phase-modified production files | `git diff 54a0d26d..HEAD` grep `TBD\|FIXME\|XXX` and `TODO\|HACK\|PLACEHOLDER` | **0 added** | ✓ PASS |
| `grep -rn MUTANT src/` after my own mutation battery | — | **0** | ✓ PASS |
| `git status --short` after my mutation battery | — | **clean** | ✓ PASS |

⭐ **Both reported numbers are confirmed, not accepted.** `tsc` exit 0 and `11759 passed | 0 failed | 287 skipped` reproduce exactly at `c5106aad`.

**Not run (accepted limits, carried from the phase's own record — not new findings):** Playwright `e2e-seeded`, the SQL gates, `pytest`/`mypy` (correctly — `git diff 54a0d26d..HEAD -- analytics-service/` is empty).

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Re-entering "add a strategy" with an existing wizard draft resumes at the draft's step; the entry point BEFORE the wizard becomes draft-aware, entry path established by observation FIRST | ✓ VERIFIED (code) — browser/e2e pending | Entry path re-observed and the wrong diagnosis corrected in `REQUIREMENTS.md:621-632` ("Observed at HEAD: `/strategies/new/page.tsx` is a **pure `redirect()`**"), confirmed against source: that file is a 32-line `redirect()` with no draft logic. The draft-blind point — `ContributionWizardOverlay.tsx` — now fetches `GET /api/strategies/wizard-draft` on open, **defers the `WizardClient` mount** behind `draftRead === undefined` (`overlay-draft-pending`), clears on close, and offers the draft only on its own branch via `draftMatchesSource`. `WizardClient.tsx:238-239` consults `initialDraft` **before** the `source === "csv"` short-circuit, so the CSV twin is closed too; `draftResumeStep` is one expression (`csv → csv_upload`, else `sync_preview`) shared with `handleResume`. Query shape single-sourced in `src/lib/wizard/draft-query.ts`, both callers (`wizard/page.tsx:80`, the route handler) go through `readLatestWizardDraft`, pinned by the repo-scan contract test `src/__tests__/wizard-draft-query-single-source.test.ts`. |
| 2 | STALE-01's root cause investigated and documented BEFORE any fix is planned; after the fix the wizard never sits on "Fetching trades…" after the chain finished, and never renders a refusal computed from a stale analytics row while a re-derive is in flight | ✓ VERIFIED | **Ordering proven by git, not by prose:** `9ab787a2`/`425d320a` (154-01 REDs + investigation) precede `1aa83aee` (154-04 fix) and `116397ad` (154-08 fix). Verdict **M2(ii)** in `154-INVESTIGATION.md` with PROD `compute_jobs` evidence (terminal write `11:39:35.342759`, 22 rows all `done`). **(a)** `useStrategySyncPoller.ts:253-273` — the `?? "pending"` coercion is gone; `if (!statusRow)` reports no status and warns once. `SyncPreviewStep.tsx:2457` — `showInterruptedBanner` no longer carries `isComposite &&`; `inFlightClaimIsCurrent = !showInterruptedBanner && !showRecomputing` withdraws the "Fetching trades…" claim (and its pulsing dot) whenever it is known false. The backstop is reachable for the never-reported case: `statusChangedAtRef` is stamped on mount and only re-stamped on a `computationStatus` change, so a permanently-absent row still trips `stallBackstop` at `RETRY_THRESHOLD_MS`. **(b)** `SyncPreviewStep.tsx:1560-1568` — the single-key R2-5 twin: `tradeCount === 0 && csvRowCount === 0 && analytics != null → repoll` (deliberately narrower than `csvRowCount === 0`), resetting `heavyFetchErrorsRef` (RESEARCH A6). |
| 3 | A token-less credential re-connect fails TOWARD the existing row — identity from a stable non-secret venue value, never uniqueness on ciphertext, never a silent overwrite of a key other strategies depend on | ✓ VERIFIED (code + vitest) — SQL gate unrun | `api_keys.venue_account_id text` + `CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON … WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL` (migration `20260812120000`, with a pre-flight duplicate census that ABORTs rather than half-creating, a `api_keys_venue_account_id_nonblank` CHECK so `''` cannot become an identity, a SECURITY INVOKER scrub trigger, and a self-assertion that rolls back if the index is not partial). **No ciphertext is indexed.** App fence `resolveByVenueIdentity` in `create-with-key/route.ts:131-200` is **read-only** — it `SELECT`s and returns existing ids, issues zero writes, never re-encrypts (mutation-proven by the 154-06 ledger's "FAILS TOWARD THE EXISTING ROW" row). 23505 discrimination via `src/lib/api/pgConstraintName.ts` on **both** wizard-write routes. |

**Score:** 3/3 truths verified at code level. All three carry human/CI confirmation items (below) — status is therefore `human_needed`, not `passed`.

---

## Targeted scepticism checks (the ones this verification was commissioned for)

### 1. The REDs are green for the right reason — oracles not weakened

| Check | Command | Result | Status |
|---|---|---|---|
| `SyncPreviewStep.stale.runtime.test.tsx` unchanged since 154-01 | `git diff 8a74683f..HEAD -- <file>` | **empty** (single commit in `git log --follow`: `8a74683f`) | ✓ **ZERO-LINE DIFF CONFIRMED** |
| No `expect(` removed from `SyncPreviewStep.stale-refusal.runtime.test.tsx` | `git diff 9ab787a2..HEAD -- <file> \| grep '^-' \| grep -c 'expect('` | **0** | ✓ VERIFIED |
| What the 11 deleted lines actually are | manual read of the diff | Pure helper-signature widenings with **behaviour-preserving defaults**: `installClient(n)` → `installClient(n, opts = {})`; `installFetchMock(composite)` → `installFetchMock(composite, jobStatus: string \| null = **null**)` — the removed literal `jobStatus: null` is re-expressed as the parameter's default, so T3/T3b still assert the repoll on the empty series **alone**, with no in-flight datum to lean on. 248 insertions, all additive cases. | ✓ NOT WEAKENED |

**Independent mutation re-run (I applied it myself; the ledger's claim was not accepted).**
SC-2b — replaced the single-key guard with `const seriesMayBeMidReDerive = false; // MUTANT`:

```
× T3: the single-key arm does NOT render a terminal refusal from a mid-re-derive empty series
× AMBER: with the in-flight datum reporting a running job, the mid-re-derive screen is the amber recomputing block
× NO-RED-WHILE-IN-FLIGHT: the recomputing screen renders no error envelope and no wizard_error
× NO-EVIDENCE: with NO job in flight the amber block is withheld — the screen never claims a recomputation it cannot see
× NUMBERS: no stale metric from the mid-re-derive row reaches the screen, and no zero is fabricated in its place
× A6: a clean read into the repoll state RESETS the consecutive heavy-failure count
Tests  6 failed | 2 passed (8)
```

**Exactly the 6 the ledger claims.** Reverted; tree clean; `grep -rn MUTANT src/` → 0.

### 2. The `progress.render.test.tsx` premise change — real or neutered?

**Real, and I proved it.** The rewrite is strictly *stronger*: the old case carried 3 assertions (`progressFetches.toHaveLength(0)`, no member panel, no interrupted banner); the new one carries 4 — `progressFetches.length > 0`, `wizard-sync-interrupted` present, a `Retry sync` button present, **and** the surviving absence assertion (`wizard-member-progress` absent) driven against a body that deliberately carries `memberProgress: MEMBERS_3`. The one assertion that was inverted is exactly the gate 154-08 removes; the one that was dropped (`no interrupted banner`) is the assertion that encoded the defect.

Mutation re-run — I re-added the `isComposite &&` conjunct on `showInterruptedBanner`:

```
× issues the sync-progress fetch on a single-key kickoff, surfaces the interrupted state, and still renders no per-key panel
× T1: a status frozen at pending past the patience window stops claiming trades are being fetched
× T1b: a single-key strategy gets the interrupted-sync affordance the composite arm already gets
× T2b: a kickoff 200 whose body says queued:false does not put the wizard in the in-flight claim
Tests  4 failed | 17 passed (21)
```

The rewritten case **is** among the reds. A neutered case would have stayed green. Reverted; tree clean.

### 3. The `isComposite` gates are gone as a CLASS

| Site | Before | At HEAD | Status |
|---|---|---|---|
| TWIN-2 — `showInterruptedBanner` (`:2449-2458`) | `isComposite && (stalled \|\| stallBackstop \|\| …)` | conjunct removed, replaced by an in-place explanatory comment | ✓ REMOVED |
| TWIN-5 — sync-progress piggyback fetch (`:978`) | `if (isComposite) { … }` | gate removed; fetch issued for both classes | ✓ REMOVED |
| Third site — `sync-progress/route.ts` | "latest `stitch_composite`" only | 154-04 two-pass stitch-**preferring** read (`latestStitch ?? latestAny`); composite bytes pinned byte-identical by `PIN-COMPOSITE-BYTES`/`PIN-COMPOSITE-WINS` | ✓ WIDENED |

**Class sweep.** The 12 surviving `isComposite` references in `SyncPreviewStep.tsx` were read individually: 1 state declaration, 2 explanatory comments about the removed gates, and 9 legitimately composite-specific branches — the composite read arm (`:1062`, a composite has 0 `trades` and must not go through `checkStrategyGate`), the `Review your keys` CTA (`:1907`, `:2345`, `:2423`), heading/body/status copy (`:1946`, `:2484`, `:2489`, `:2506`), the composite passed-snapshot branch (`:1995`), and the per-key member-progress panel (`:2521`, deliberately not widened and asserted so). **No surviving single-key exclusion from an exit or from the in-flight datum.** `stalled` staying stitch-only in the route is deliberate and documented (only the stitch worker writes the heartbeat) — the single-key exit is the `stallBackstop`, which is now un-gated.

### 4. 154-06's admin-client fence — tenant-leak check

✓ **Not a leak.** `resolveByVenueIdentity` (`create-with-key/route.ts:141-149`):

```
admin.from("api_keys").select("id")
  .eq("user_id", userId)            // owner filter — the admin client BYPASSES RLS
  .eq("exchange", exchangeNormalized)
  .eq("venue_account_id", venueAccountId)
  .is("disconnected_at", null)      // mirrors the index predicate exactly
  .maybeSingle()
```

`userId` is `user.id` from the session at both call sites (`:486`, `:703`) — never a request parameter. The projection is **one column, `id`** — no ciphertext, no `dek_encrypted`, no `nonce`, no metadata. The follow-on `strategies` read is deliberately routed **back onto the user-scoped RLS client**, so the returned row is provably the caller's even if the owner filter above were ever weakened. Failure posture is a **dark fence** (log + fall through to the RPC, DB index still backstops), never a 500; the log is scrubbed with this request's secrets *including* the login, because PostgREST can echo filter values.

### 5. 154-07 is a genuine NO-OP

✓ Correct given M2(ii). `git diff 54a0d26d..HEAD -- analytics-service/` is **empty**. Commit `36d208b4` is docs-only ("No source file touched; the candidate SQL gate deliberately not created"). No stub or empty file was committed anywhere in the phase — the only sub-20-line new file in the whole diff is `.planning/phases/156-…/.gitkeep`, which belongs to Phase 156's directory, not to 154. The `supabase/` changes in the phase are 154-03's WIZCONT-02 DDL, not a 154-07 artifact.

### 6. Amber vs red

✓ `SyncPreviewStep.tsx:2596-2613` — `data-testid="wizard-sync-recomputing"`, **`role="status"`**, `border-warning/40 bg-warning/5`; body carries no metric. It clones the existing `wizard-sync-interrupted` banner's shape verbatim rather than inventing a component. Gated on `showRecomputing = seriesRecomputing && isJobInFlight(syncProgress?.jobStatus ?? null)` — both halves required, so the screen never claims a recomputation it has no evidence for (mutation-proven by `NO-EVIDENCE`, which I reddened above).
✓ **Zero `role="alert"` lines added anywhere in the phase** (`git diff … \| grep '^\+.*role="alert"'` → empty).
✓ All wizard error copy still routes through `buildEnvelope()` / `wizardErrors.ts` — `SyncPreviewStep.tsx:24-33` imports both and renders through `WizardErrorEnvelope` at `:1955`; `src/lib/wizardErrors.ts` is **not in the phase diff at all**, so no new `WizardErrorCode` was minted and no copy was inlined past the table.
✓ The WIZCONT-02 dedup notice (`WizardClient.tsx:981-988`) is the neutral `border-border bg-page text-text-secondary` strip — not an envelope, not amber, not red — and its copy names neither the credential nor the account id.

### 7. No new timing constants

| Constant | Base `54a0d26d` | HEAD | Status |
|---|---|---|---|
| `SLOW_HINT_MS` | `15_000` | `15_000` | ✓ UNMOVED |
| `WARN_THRESHOLD_MS` | `60_000` | `60_000` | ✓ UNMOVED |
| `RETRY_THRESHOLD_MS` | `900_000` | `900_000` | ✓ UNMOVED |
| `POLL_BACKOFF_MS` | `[3000, 3000, 5000, 5000, 10_000]` | identical | ✓ UNMOVED |
| `MAX_CONSECUTIVE_POLL_ERRORS` | `3` | `3` | ✓ UNMOVED |
| `MISSING_ROW_GRACE_POLLS` | `10` (`SyncProgress.tsx:30`) | `10`, same line | ✓ PRE-EXISTING, reused not minted |

Scan of every added non-comment line under `src/` (excluding tests) for `_MS`, `TIMEOUT`, `THRESHOLD`, `INTERVAL`, `DELAY`, `BACKOFF`, `setTimeout`, `setInterval`, `maxAge`, `revalidate` returns **six hits, all in the regenerated `src/lib/database.types.ts`** — pre-existing DB function signatures (`p_cooldown_seconds`, `p_defer_seconds`, `p_stale_threshold`), not new logic. ⭐ Note the design choice that made this possible: the new repoll loop is **not** bounded by a count ("Bounding the repoll with a count would be a new threshold") — the *screen* is bounded, by the pre-existing SF-1 patience clock.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/wizard/draft-query.ts` | Single-sourced draft read | ✓ VERIFIED | 187 lines; `readLatestWizardDraft`, `deriveDraftKind`, `draftMatchesSource`; both production callers import it |
| `src/app/api/strategies/wizard-draft/route.ts` | Client-callable draft read | ✓ VERIFIED | `withAuth` wrapper, user-scoped RLS client, field-by-field projection, `NO_STORE_HEADERS`, correlation-id logging, raw DB message never crosses the wire |
| `ContributionWizardOverlay.tsx` | Draft-aware, deferred mount | ✓ VERIFIED | `initialDraft={null}` is gone; fetch-on-open, close-reset, branch filter, `key` carries the offered draft id |
| `WizardClient.tsx` | CSV short-circuit closed | ✓ VERIFIED | `if (initialDraft) return draftResumeStep;` precedes `if (source === "csv") return "csv_upload";` |
| `src/hooks/useStrategySyncPoller.ts` | Absent row observable | ✓ VERIFIED | `if (!statusRow)` arm; `?? "pending"` gone; warn-once |
| `src/app/api/strategies/[id]/sync-progress/route.ts` | Answers single-key | ✓ VERIFIED | Two-pass `latestStitch ?? latestAny`; `stalled` stays stitch-only by design |
| `SyncPreviewStep.tsx` | Un-gated backstop, R2-5 twin, amber block | ✓ VERIFIED | See checks 3 and 6 |
| `create-with-key/route.ts` + `src/lib/api/pgConstraintName.ts` | One fence two keys, 23505 discrimination | ✓ VERIFIED | See check 4 |
| `supabase/migrations/20260812120000_api_keys_venue_account_id.sql` | Column, partial UNIQUE, CHECK, scrub trigger, RPC re-base | ✓ VERIFIED (file) — ⚠️ gate unrun | 1061 lines with pre-flight census, self-assertions and rollback guards; `154-03-TEST-APPLY.md` records the TEST/PROD application |
| `e2e/wizard-resume.spec.ts` | Browser proof of resume | ⚠️ AUTHORED, UNRUN | Exists, wired at `.github/workflows/ci.yml:1785` in the `e2e-seeded` batch |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql` | Partial-index gate asserting predicate TEXT | ⚠️ AUTHORED, UNRUN | Needs a live Postgres |
| `analytics-service/**` | No change (154-07 NO-OP) | ✓ VERIFIED | diff empty |

---

## Falsifiability Ledger claim — audited, not accepted

`154-VALIDATION.md` frontmatter asserts `status: complete`, `nyquist_compliant: true`, `closed_by: 154-08`. **The claim holds.** Audit:

| Ledger property | Verifier finding |
|---|---|
| 13 rows observed + 1 skipped-with-reason, 0 pending | Confirmed by reading all 15 rows; the one skip (SC-3 DB backstop) is genuinely blocked on a Postgres this checkout lacks and is explicitly recorded as *skipped*, never as *caught* |
| SC-1 second-member mutation reported **GREEN as a finding**, with a substitute that did catch it | Present and honest — this is the shape a fabricated ledger does not produce |
| Four SC-2 mutations re-applied to the **fixed** tree at `116397ad` | ⭐ **Independently reproduced.** Two of the four re-run by me at `c5106aad` with the exact case sets the ledger claims (6 and 4 reds respectively) |
| Oracle Independence — no constant imported from the module under test | Spot-confirmed: `AMBER_TOKENS`, `RECOMPUTING_HEADING`, `STALE_RENDERED`, `TERMINAL_STATUSES` are hand-typed literals; `isJobInFlight` / `FINISHED_JOB_STATUSES` are not imported (the tests pass the wire string `"running"` and the literal `null`) |
| RED-before-fix ordering | Proven by git ancestry, not by prose |
| T3's needle correction | ⭐ Load-bearing and real: the planned `GATE_SERIES_PROVENANCE_UNVERIFIED` needle would have reported T3 **green against the defect**; the shipped test uses a structural `[data-error-code]` probe plus both named codes |
| One gate RED at the phase base (`seam-citations.invariant.test.ts`) recorded rather than hidden | Confirmed fixed at `3dd63220`; the gate is green in my full-suite run |

**`nyquist_compliant: true` is upheld.**

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| WIZCONT-01 | Re-entering "add a strategy" continues where the founder left off | ✓ SATISFIED (code) — ⚠️ ledger not marked | Truth 1. The **diagnosis correction** CONTEXT.md demanded IS recorded (`REQUIREMENTS.md:621-632`). The **completion** is not (see W-1) |
| WIZCONT-02 | Token-less re-connect must not mint a duplicate | ✓ SATISFIED | Truth 3; requirement is `- [x]` with a `✅ DELIVERED (Phase 154, plans 03 + 06)` block and three named residuals, two owned by Phase 156 |
| STALE-01 | A wizard screen never shows a state the backend has already left | ✓ SATISFIED (code) — ⚠️ ledger not marked | Truth 2 (see W-2) |

No orphaned requirements: `grep "Phase 154" REQUIREMENTS.md` maps exactly these three, and all three appear in the plans' `requirements` fields.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | none | — | Zero `TBD`/`FIXME`/`XXX` and zero `TODO`/`HACK`/`PLACEHOLDER` added by this phase across `src/`, `supabase/`, `e2e/` |

---

## Findings (all WARNING — none blocks the phase goal)

### W-1 — `REQUIREMENTS.md` still tells the next reader that WIZCONT-01 is undelivered

`REQUIREMENTS.md:617` is `- [ ]` and its body still describes the defect in the **present tense**: *"The draft-blind entry point is `ContributionWizardOverlay.tsx:146`, which hardcodes `initialDraft={null}`"*. That is false at HEAD. The traceability row (`:1241`) repeats it: *"Pending — **OBSERVED**: … the overlay hardcodes `initialDraft={null}`, Phase 110 deferral"*. Contrast WIZCONT-02, which the same phase updated properly with a `✅ DELIVERED` block.

### W-2 — `REQUIREMENTS.md` still forbids planning the STALE-01 fix that already shipped

`REQUIREMENTS.md:896` is `- [ ]` and carries *"⚠️ **Root cause NOT yet established** … Do not plan a fix before answering it."* The traceability row (`:1256`) says *"Pending — root cause NOT yet established; investigate before planning"*. The root cause **is** established (M2(ii), `154-INVESTIGATION.md`) and both instances are fixed and merged.

⭐ W-1 and W-2 are the phase's **own named hazard** pointing at itself: this phase exists partly because *"leaving the wrong diagnosis in REQUIREMENTS.md invites the next reader to re-fix a file that was never broken"* (`154-CONTEXT.md` § Specific Ideas). Per the standing stopping rule these are prose/ledger items and do **not** block — but they should be closed before the phase is marked complete, not logged to TODOS.

### W-3 — ROADMAP ledger is internally inconsistent

`.planning/ROADMAP.md:505` shows `- [ ] 154-08-PLAN.md` unchecked while `:562` reports `154. WIZCONT + STALE | 8/8 | In Progress`. `STATE.md:6` still reads `stopped_at: Phase 154 UI-SPEC approved`. Orchestrator-owned; not touched by me per instruction.

---

## Unverified coverage (accepted limits, restated — not findings)

- Playwright `e2e/wizard-resume.spec.ts` — authored and CI-wired, never executed (no TEST DB here).
- SQL gates including `test_api_keys_venue_identity_uniq.sql` — authored, never executed.
- No browser pass on the amber `wizard-sync-recomputing` block.
- CR-01 (RPC forgery) is a deliberate residual deferred to Phase 156, live on PROD — explicitly out of scope for 154.
- The M2(ii) residual the investigation itself records: PROD data proves the *server* was terminal at 11:39:35 but cannot distinguish a PostgREST zero-rows-under-RLS answer from a genuine absent-row race. Both are discharged by the same fix and T2 pins it at the seam; distinguishing them would need a browser console that no longer exists. Recorded, not guessed — correct handling.

---

## Gaps Summary

**None.** All three ROADMAP success criteria are achieved in the codebase, verified independently of the SUMMARY narrative: the entry-path correction was re-observed against source, the two `isComposite` gates and the `?? "pending"` coercion are demonstrably gone, the single-key R2-5 twin exists and is mutation-proven, the dedup fence is read-only and owner-scoped, 154-07's NO-OP is a genuine empty diff, no timing constant moved, and the two RED-first test files survive with a zero-line diff and zero removed assertions respectively.

The adversarial hypothesis — *tasks completed, goal missed* — is **falsified**. The one place a weakening could have hidden (the deliberately-rewritten `SINGLE-KEY NEUTRALITY` case) was tested by mutation and reddens correctly.

Status is `human_needed` rather than `passed` solely because four items cannot be discharged in this environment: the founder's own confirmation of the resume, a browser look at the amber block, the Playwright `e2e-seeded` batch, and the SQL gate.

---

_Verified: 2026-08-12T11:04:34Z_
_Verifier: Claude (gsd-verifier) — goal-backward, FORCE stance_
