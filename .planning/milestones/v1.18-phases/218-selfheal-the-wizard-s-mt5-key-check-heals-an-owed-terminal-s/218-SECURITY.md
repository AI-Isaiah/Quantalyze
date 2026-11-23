---
phase: 218
slug: selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
threats_total: 15
threats_open: 0
asvs_level: 1
block_on: high
status: SECURED
audited_at: 2026-11-20
audited_head: 9941aac10
---

# Phase 218 SELFHEAL - Security Verification

Scope: the threat registers of 218-01..04-PLAN.md (T-218-01..14, plus T-218-SC counted once), 218-RESEARCH.md "Security Domain", 218-REVIEW.md (round 3), and the phase diff against the merge base. Auditor: gsd-security-auditor (read-only). The four analytics test files that touch the owed gate ran green at the audited head (227 passed).

## Threat Verification

| ID | Category | Sev | Disposition | Status | Evidence |
|----|----------|-----|-------------|--------|----------|
| T-218-01 | Info disclosure | high | mitigate | CLOSED | `routers/exchange.py` `_validate_mt5_key_probe` owed gate raises on any non-`scrubbed` kind or a remaining envelope under `_MT5_VALIDATE_PROBE_FLOOR_S`, before `_connect_and_probe`. `test_mt5_validation_park.py::_assert_wizard_owed_unhealed` (six kinds) asserts no client and no login; neuter-once RED recorded in 218-01-SUMMARY. |
| T-218-02 | Tampering | med | accept | CLOSED | D-43 residual accepted: the inline scrub runs under the caller's lease; the owed mark clears only on `scrubbed`; the epoch fence stops an abandoned thread at its next crossing. |
| T-218-03 | DoS | high | mitigate | CLOSED | `mt5_terminal_scrub.py` `_scrub_decide`: `budget_s` bounds only the event-loop wait; the thread keeps `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)`. Pinned by `test_TERMINAL_SCRUB_the_wizard_bound_never_becomes_the_scrub_threads_deadline`. |
| T-218-04 | Info disclosure | low | mitigate | CLOSED | New logs carry static text, seconds, `exc_class` or env var names only. `MT5_TERMINAL_NOT_READY_DETAIL` is swept by `test_terminal_not_ready_detail_collides_with_no_cascade_needle`. See note 1. |
| T-218-05 | Repudiation | low | mitigate | CLOSED | `owed_scrub` stage event (`scrub_healed` / `scrub_<kind>`) and `trace.outcome = "scrub_unhealed"`, asserted in `test_mt5_validation_park.py`. |
| T-218-06 | DoS | med | mitigate | CLOSED | Clamped inline budget (`E - record - floor`), lease-anchored envelope, probe floor; `_check_inline_scrub_budget()` names a misconfigured clamp at boot. Floor test neutered once (218-02-SUMMARY). |
| T-218-07 | Info disclosure | med | accept | CLOSED | Only a heal-caused `budget_exhausted` park skip is quieted (`park_budget_left + inline_scrub_elapsed_s >= _MT5_PARK_MIN_BUDGET_S`); every other skip still pages. |
| T-218-08 | Repudiation | low | mitigate | CLOSED | `analytics-service/docs/STATUS_CONTRACT.md` S-31 added, S-30 narrowed, tally corrected with dated notes. |
| T-218-09 | Tampering | low | mitigate | CLOSED | `src/lib/wizardErrors.ts` `VENUE_WIRE_CODE_TO_VERDICT` (a `ReadonlyMap`) gains `MT5_TERMINAL_NOT_READY`; closed set pinned by the vocabulary, roster, dialog-envelope and parity tests; neuter-once RED in 218-03-SUMMARY. |
| T-218-10 | Repudiation | med | mitigate | CLOSED | `KEY_MT5_TERMINAL_NOT_READY` copy says neither "busy" nor "been alerted"; not in `OUR_DEFECT_KEY_ERROR_CODES`; route twins assert it is not captured. |
| T-218-11 | DoS | low | accept | CLOSED | Flat 424 with no `dependency` is breaker-inert (`resilient-fetch.ts`, unchanged); the 500 UNCONFIGURED arm is `retryable:false` (STATUS_CONTRACT R-1). |
| T-218-12 | Tampering | med | mitigate | CLOSED | `WizardClient.tsx` `stepHeld` gates the step block and the `wizard_step_view` effect; hydration settles in a `finally` (review round 1). `WizardClient.resume-hold.test.tsx` neutered once. |
| T-218-13 | Spoofing | low | accept | CLOSED | `deriveWizardResumeOverrides` / `loadWizardState` HMAC verification untouched. |
| T-218-14 | Info disclosure | low | accept | CLOSED | `src/lib/wizard/resume-banner.ts` names a secret kind only, never a value; nothing new stored in the browser. |
| T-218-SC | Tampering | low | accept / mitigate | CLOSED | No dependency change: package.json, package-lock.json and analytics requirements are untouched. |

## Unregistered Flags

None. All four SUMMARY `## Threat Flags` sections read "None".

## Notes

1. The `owed_scrub` stage event carries `terminal_key` (our validation terminal's endpoint, not user broker data), following the existing `lease_wait` event and the stage-event helper. Recorded, non-blocking.
2. Known limit, accepted in the plans and STATUS_CONTRACT S-31: `failed` (profile tripwire) and `relaunch_unverified` (-6) answer recoverable although only an operator can fix them; the scrub's per-cause ERROR alert pages for both.
3. Review survivors at Info only (218-REVIEW round 3): IN-10, IN-11, IN-12.
4. The auditor did not re-run vitest; TS-side closure rests on code reading and the recorded neuter-once proofs. The orchestrator ran the touched vitest areas and typecheck on the merged branch.
5. ⭐ 2026-11-20, after this audit: the commit security review of `mt5_terminal_scrub.py` raised a MEDIUM. An inline scrub abandoned at the wizard's `asyncio.wait_for` bound left its thread running to `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)`, longer than the caller's wait, so a later scrub or probe could cross the shared terminal under it. It is CLOSED by commit 7c968e37e (shipped in #1293, squash 294ab9848): `_scrub_decide` registers the scrub thread's done-event through `_register_probe`, so the next scrub's W-1 wait covers it, and the owed mark (still set after `abandoned`) routes any probe through that scrub first. The thread deadline is unchanged, because shortening it would starve the relaunch reserve. Pinned by `test_TERMINAL_SCRUB_an_abandoned_scrub_thread_holds_off_the_next_scrub`, which goes red without the registration. `threats_open` stays 0.
