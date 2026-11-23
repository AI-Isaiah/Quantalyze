---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
verified: 2026-11-20T12:20:00Z
status: passed
score: 7/7 must-haves verified
verified_at_sha: 9941aac10521494ed92900d24ad9dcf562b839c1
drift_subjects:
  - analytics-service/routers/exchange.py
  - analytics-service/services/mt5_terminal_scrub.py
  - analytics-service/services/closed_sets.py
  - analytics-service/services/ingestion/mt5.py
  - src/lib/wizardErrors.ts
  - src/lib/wizard/resume-banner.ts
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
behavior_unverified: 0
overrides_applied: 0
---

# Phase 218: SELFHEAL Verification Report

**Phase Goal:** When the validation terminal owes a scrub (boot mark or relaunch debt), the wizard's MT5 key check pays the scrub inline under the held lease and runs the check in the same request. No probe ever runs on an unscrubbed terminal. A failed heal names the real cause, never "briefly busy". Plus the 2026-11-19 widening: the resume banner holds the step until Resume or Start fresh in a browser without the pointer, and its copy matches key type and says nothing about re-entry when none is needed.
**Verified:** 2026-11-20
**Status:** passed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Owed scrub (boot mark or relaunch debt) is paid inline under the held lease and the check runs in the same request | VERIFIED | `routers/exchange.py` ~1189-1305: inside `async with mt5_terminal_lease(...)`, `if mt5_scrub_owed(...) or mt5_relaunch_debt(...)` calls `pay_owed_validation_scrub_in_lease` (no second lease; `mt5_terminal_scrub.py:755`), then `probe_timeout = remaining` and falls to `asyncio.wait_for(_connect_and_probe(), timeout=probe_timeout)`. Tests `test_scrub_wizard_owed_gate_heals_inline_and_probes_in_the_same_request`, `..._relaunch_debt_alone_heals_inline...`, `..._on_a_missed_scrub_heals_inline_without_paging` use the real scrub double and pass. |
| SC-2 | No probe after any non-`scrubbed` kind | VERIFIED | Gate raises before any client is built when `kind != SCRUB_KIND_SCRUBBED`. `test_scrub_wizard_owed_gate_never_probes_after_a_non_scrubbed_kind` is parametrized over all 5 transient kinds plus `skipped_no_house_credentials`, asserting `factory.call_count == 0` and no logins. I neutered the `kind != SCRUB_KIND_SCRUBBED or` disjunct from a byte backup: 7 tests went RED (all 4 sampled parametrized kinds plus the refusal-pages-once test); file restored byte-equal. |
| SC-3 | Failed heal names the real cause (`MT5_TERMINAL_NOT_READY` / `MT5_VALIDATION_UNCONFIGURED`), never "briefly busy" | VERIFIED | Python: 424 `MT5_TERMINAL_NOT_READY` recoverable, or 500 `MT5_VALIDATION_UNCONFIGURED` retryable=False for `skipped_no_house_credentials`. The only remaining `MT5_TERMINAL_BUSY` raise is the held-lease arm (`exchange.py:1687`). TS: `VENUE_WIRE_CODE_TO_VERDICT` row `MT5_TERMINAL_NOT_READY -> KEY_MT5_TERMINAL_NOT_READY` (424), new copy contains no "busy", added to the rotate-secret dialog roster. Seam-vocabulary, parity, dialog-envelope and roster tests pass. |
| SC-4 | 105 s server worst case / 120 000 ms client budget holds | VERIFIED | Scrub runs inside the 75 s envelope anchored at lease acquisition (`deadline_started_at = lease_held_at`); event-loop bound clamped `min(30, 75-5-40)`; 40 s probe floor refuses otherwise. `test_mt5_validate_worst_case_stays_inside_the_client_budget` (105 000 < 120 000) and `..._inline_scrub_budget_fits_inside_the_envelope` pass; `seam-budgets.invariant.test.ts` passes. Thread deadline stays `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)` (`mt5_terminal_scrub.py:524`), pinned by a test. |
| SC-5 | Logging/alerting: `owed_scrub` stage event, `scrub_unhealed` outcome, one page per incident, quiet park skip after a heal | VERIFIED | `emit_mt5_stage_event("owed_scrub", ...)`, `trace.outcome = "scrub_unhealed"`; `report_scrub_owed_refusal` no longer called (single remaining mention is a comment); `test_..._refusal_pages_exactly_once_with_the_real_cause` and the park-skip tests pass. |
| SC-6 | Banner holds the step until Resume / Start fresh when no matching pointer; same-browser silent resume unchanged | VERIFIED | `WizardClient.tsx:300` `stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner)`; the whole step tree is wrapped in `!stepHeld && (...)`; step-view analytics suppressed while held; hydration wrapped in try/finally so a throw cannot strand the user. Start fresh -> confirmed delete clears the banner and mounts the first step; Resume mounts `draftResumeStep`. `WizardClient.resume-hold.test.tsx` (no pointer, other-draft pointer, CSV, Resume, matching pointer silent, hydration throw, no draft) passes. |
| SC-7 | Banner copy matches key type; no re-entry sentence when none needed | VERIFIED | `resume-banner.ts`: re-entry sentence only when `resumeStep === "connect_key"`, noun by `venueSecretIsVerbatim` (investor password vs API secret); CSV keeps re-select copy. Confirmed `SyncPreviewStep.tsx` has no secret input, so today's API/MT5 banners (resuming onto `sync_preview`) say nothing about re-entry, as CONTEXT "Amended after research" specifies. Matrix test passes. |

**Score:** 7/7 truths verified, 0 behavior-unverified.

## Behavioral Spot-Checks (run by verifier)

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Python key tests | `cd analytics-service && python3 -m pytest tests/test_mt5_validate.py tests/test_mt5_validation_park.py tests/test_mt5_terminal_scrub.py tests/test_validate_key_venue_transient.py` | 331 passed, 1 skipped (pre-existing empty-parameter-set skip at `test_mt5_validate.py:713`) | PASS |
| CI mypy strict line | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | no issues in 142 files | PASS |
| Vitest set | the 5 named files | 5 files, 431 tests passed | PASS |
| Extra TS | `seam-budgets`, `dialog-envelope`, `wizardKeyRosters` invariants; `tsc --noEmit` | 113 passed; tsc clean | PASS |
| Neuter probe-after-non-scrubbed gate | edit + pytest + restore from byte backup | RED then restored (`cmp` equal) | PASS |

## Key Links

| From | To | Via | Status |
|------|----|-----|--------|
| `_validate_mt5_key_probe` owed gate | `pay_owed_validation_scrub_in_lease` | called under the held lease, kind decides probe vs refusal | WIRED |
| owed gate refusal | `MT5_TERMINAL_NOT_READY_DETAIL` / 500 `MT5_VALIDATION_UNCONFIGURED` | raise sites in `exchange.py` | WIRED |
| wire code | `KEY_MT5_TERMINAL_NOT_READY` copy | `VENUE_WIRE_CODE_TO_VERDICT`, dialog roster | WIRED |
| `resumeBannerBody` | banner JSX in `WizardClient.tsx` | direct call with `draftResumeStep` | WIRED |
| `stepHeld` | step render and step-view effect | gate wrapper and effect guard | WIRED |

## Anti-Patterns

No TBD/FIXME/XXX debt markers in the touched source files. Review round 3: 0 Critical, 0 Warning, 3 Info (recorded only in 218-REVIEW.md, per repo rule).

## Notes (not gating)

- Known limits recorded in `STATUS_CONTRACT.md` S-31: `failed` and `relaunch_unverified` answer recoverable although only an operator can fix them; the per-cause scrub ERROR alert pages for both. After `abandoned`, the scrub thread may still run when the lease releases; the owed mark is not cleared, so the next holder scrubs first (same machinery the worker path relies on).
- While the step is held, the chrome stepper still displays the draft's step label; the held step cannot mount (`stepHeld` outranks `setStep`). Cosmetic only.
- The stale `ruff` F401 pair in `exchange.py` predates the phase (review round 3).

## Post-deploy observation (not a gate)

The real-terminal check cannot run before deploy: the first wizard MT5 validation after the analytics deploy should succeed without Retry, and Railway logs should show an `owed_scrub` stage event with `outcome=scrub_healed` and `ok=true`. The code paths are exercised against the real scrub double in pytest, and the 6 s measured scrub fits the 30 s bound, so this is recorded as an observation rather than a human gate. If the first post-deploy check refuses, read `scrub_unhealed` plus the per-cause scrub alert.

## Gaps Summary

None. Phase goal achieved in the codebase.

---

_Verified: 2026-11-20_
_Verifier: Claude (gsd-verifier)_
