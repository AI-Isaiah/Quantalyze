---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
verified: 2026-11-26T19:00:00Z
status: human_needed
score: 3/3 roadmap success criteria verified in code and tests; 3 items need a browser or a live broker
verified_at_sha: 8527f0457ed747b4daaeed6c81273534299a7686
drift_subjects:
  - src/app/api/strategies/create-with-key/route.ts
  - src/lib/api/rotate-key-secret.ts
  - src/lib/key-secret-outcome.ts
  - src/lib/analytics-client.ts
  - src/lib/analytics-schemas.ts
  - src/lib/wizardErrors.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - analytics-service/routers/internal.py
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/lib/seam-budgets.invariant.test.ts
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open /strategies/new/wizard, reproduce a same-account MT5 reconnect that renders the password outcome notice above the 409 envelope, and sweep at 320 px width."
    expected: "The notice (data-testid wizard-key-outcome-notice) and the WizardErrorEnvelope both reflow with no horizontal scroll and no clipped text; a screen reader announces the notice sentence through the polite LiveRegion."
    why_human: "Visual reflow and live-region announcement order cannot be asserted in jsdom (VALIDATION.md Manual-Only row)."
  - test: "Run axe on /strategies/new/wizard with the notice and the envelope both rendered."
    expected: "No axe violations."
    why_human: "Needs a real browser rendering the page (VALIDATION.md Manual-Only row)."
  - test: "Against a live MT5 broker: store an MT5 key, then reconnect the same login and server in the wizard with (a) the correct new password, (b) the unchanged password, (c) a mistyped password, (d) the master password."
    expected: "(a) 409 answer plus 'We updated the password on your key X' and the key signs in on the next sync; (b) 'already uses this password and it signs in, so we changed nothing'; (c) KEY_AUTH_FAILED, nothing stored; (d) KEY_MT5_MASTER_PASSWORD, nothing stored."
    why_human: "Every test double stands in for the Railway MT5 gateway; only a real broker proves the probe-then-compare order end to end."
---

# Phase 228: KEYANSWERS Verification Report

**Phase Goal:** A reconnect with a rotated or mistyped MT5 password and an orphaned key each get an answer that names the key and matches what was stored.
**Verified:** 2026-11-26 at head 8527f0457
**Status:** human_needed (no gaps; browser and live-broker items remain)
**Re-verification:** No, initial verification

## Success criteria

| # | Criterion (ROADMAP) | Verdict | Evidence |
|---|---|---|---|
| 1 | Reconnecting an MT5 account with a rotated password gets a named answer that matches `api_keys` afterwards; a mistyped password is never reported as success (CONN-02) | VERIFIED | `create-with-key/route.ts` rotate leg: `resolveByVenueIdentity` sets `rotate` only for a WORKING holder whose stored `venue_server` equals the typed server (`picked.venue_server !== null && === venueServer`). The leg runs as the first statement of the `try`, re-reads the key owner-scoped (`id`+`user_id`+`exchange=mt5`+live), calls `rotateKeySecret` (probe before re-encrypt), then `persistRotatedMt5Secret` (UPDATE filtered on `id`+`user_id`+`exchange`). `updated` is answered only when `persisted.kind === "ok"`; `write_failed`, `write_zero_rows`, `venue_collision` and `holder_read_failed` answer UNKNOWN 500 or the 503 holder-read body, never `updated`. Probe refusals (auth failed, master password, wrong server) throw into the existing classifier catch with zero UPDATEs and no `key_secret`. Python `rotate_key_secret` computes `secret_changed` with `secrets.compare_digest` over UTF-8 bytes only after `_validate_mt5_key` accepted. `key_secret` has one builder (`key-secret-outcome.ts`); the browser renders it above the envelope. F6 fallback strip no longer claims the credentials are connected. |
| 2 | An allocator-role owner who hits `KEY_ORPHANED` is told by name which key to Disconnect; a test drives the allocator and manager roles (CONN-04) | VERIFIED | `wizardErrors.ts` `formatKeyError`: with a named key holder the `KEY_ORPHANED_DISCONNECT_FIX` bullet is replaced by the version naming the key; a blank name or strategy holder keeps the table sentence. `route.test.ts` SC-2 role-parity `it.each` over `allocator`, `manager`, `both` asserts byte-equal bodies naming the key and that `profiles` is never read. |
| 3 | PROOF-01: each test goes RED on a neutered copy of its route arm, named arm first, restored from a byte backup, GREEN (recorded in SUMMARY) | VERIFIED | Plans 01, 02, 03 and 04 SUMMARYs carry neuter, RED, `cp` back, `cmp`, GREEN transcripts. I reproduced two independently (byte backups in the scratchpad, `cmp` identical after each): (A) answering `updated` on a `write_failed` persist turned `an UPDATE error answers UNKNOWN 500 with no key_secret` RED (1 failed, 257 passed); (B) disabling the named Disconnect bullet turned two `[228-02 / CONN-04]` tests RED. Both restored and GREEN (597 passed across the two files). |

## Evidence run by the verifier

| Check | Command | Result |
|---|---|---|
| Python rotate seam | `cd analytics-service && python3 -m pytest tests/test_mt5_rotate_secret_internal.py -q` | 30 passed |
| mypy strict, CI surface | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Success: no issues found in 146 source files |
| Vitest, every file the four plans name (route, audit, bare-401, seam censuses, wizard invariants and rosters, key-secret-outcome, ConnectKeyStep, WizardClient, wizardErrors, rotate-key-secret, rotate-secret route, analytics-client, analytics-schemas) | one `npx vitest run` over the union | 30 files, 1702 tests passed |
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | no errors |
| Debt markers | grep TBD/FIXME/XXX over added lines of every non-planning file | none |
| rotate-secret route behaviour unchanged | `git diff 0e6ebeedb..HEAD --stat -- '*rotate-secret/route.test.ts'` | empty (test file untouched, and it passes) |
| 120 s leg fits the browser deadline | `seam-budgets.invariant.test.ts` `228 / O2`: mt5-rotate worst case 175 500 ms against `connectAbortDeadlineMsFor("mt5") - WAIT_ABORT_GRACE_MS` | passes (hand-typed figure) |

No migration and no new wizard code.

## Key links

| From | To | Via | Status |
|---|---|---|---|
| `create-with-key/route.ts` rotate leg | `analytics-client.rotateKeySecret` | one shared `keys-rotate-secret` seam call, `user_id` passed | WIRED |
| rotate leg | `persistRotatedMt5Secret` | owner-scoped admin UPDATE plus `api_key.rotate_secret` audit | WIRED |
| PATCH `/api/keys/[id]/rotate-secret` | the same two helpers | refactor, its own test unchanged | WIRED |
| route 409 bodies | `ConnectKeyStep` notice | `keySecretField` to `parseKeySecretOutcome` to `keySecretNoticeText` (visible notice and `LiveRegion` share one builder) | WIRED |
| `KEY_ORPHANED` builder | `formatKeyError` | holder name to the named Disconnect bullet | WIRED |

## Requirements

| Requirement | Status |
|---|---|
| CONN-02 | SATISFIED in code and tests; live-broker confirmation is human item 3 |
| CONN-04 | SATISFIED |

## Scope as the founder ruled it (not gaps)

- Rotate in place only at the pre-validation fence, only for a WORKING holder on the EXACT stored server. The null-server legacy tier, a different-server holder, a failing holder (225-07 swap path), the post-validation resolve, the 23505 race arm and the same-session F6 fence keep their prior answers (CONTEXT, amended after research; PROD measured 0 of 11 live MT5 keys with a null server).
- The archived-composite `KEY_ORPHANED` case is out (F-2).
- The up-to-120 s validation returns on the rotate arms, reversing 212-03 SC5 for MT5; recorded as the founder's trade-off.

## Anti-patterns and review findings

- Code review round 1: one MEDIUM (WR-01, transport failures on the rotate leg unwrapped). Fixed in `77664a0b8`; round 2 resolved it with no MEDIUM or higher.
- Recorded LOW or INFO survivors (REVIEW only, not gaps): IN-02 (the rotate write resets a healthy `sync_status` on a working key and the recorded sync race recovers only through the daily poll); a body-read transport failure on the seam response is still unmapped (inherited verbatim from the pre-phase route).
- SUMMARY 01 deviations, accepted in review: the `@audit-skip` pragma on the rotate-secret call into the persist helper (the audit lives in the helper beside its UPDATE) and the chokepoint-count regex in `resilient-fetch.wiring.test.ts`.

## Human Verification Required

1. **320 px reflow with the notice and the envelope rendered** on `/strategies/new/wizard`. Expected: no horizontal scroll, no clipped text, notice announced politely.
2. **axe on `/strategies/new/wizard`** with both rendered. Expected: no violations.
3. **Live MT5 broker**: correct new password, unchanged password, mistyped password and master password against a stored key on the same login and server. Expected: the four answers listed in the frontmatter, and `api_keys` holds the new password only in case (a).

## Gaps Summary

None. All three roadmap success criteria are met in code and by targeted tests that I ran and partly re-neutered. The phase is `human_needed` only because the browser reflow, axe pass and a live-broker round trip cannot be asserted from here.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_
