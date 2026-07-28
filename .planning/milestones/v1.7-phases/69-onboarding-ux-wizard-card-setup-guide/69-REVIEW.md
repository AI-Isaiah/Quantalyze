---
phase: 69-onboarding-ux-wizard-card-setup-guide
reviewed: 2026-07-04T22:55:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
  - src/app/(marketing)/security/page.tsx
  - src/app/(marketing)/security/page.test.tsx
  - src/lib/closed-sets.ts
  - src/lib/closed-sets.test.ts
  - src/lib/utils.ts
  - src/components/landing/VerificationForm.tsx
  - src/components/landing/__tests__/VerificationSection.test.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 69: Code Review Report

**Reviewed:** 2026-07-04T22:55:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (no blockers)

## Summary

Reviewed the full 9-file diff for the Phase-69 Deribit onboarding-UX flip
(`git diff origin/main...feat/69-deribit-onboarding-ux`). This is a
presentation-only change: a Deribit wizard card, a `/security#deribit-readonly`
scope guide, and the conscious `UI_EXCHANGE_CODES` widening from 3 to 4 values
with inverted (not deleted) gate-pin tests.

**The diff is internally consistent and every material SUMMARY claim verified
true against the code:**

- `UI_EXCHANGE_CODES` is now `["binance","okx","bybit","deribit"]`;
  `FUNDING_EXCHANGES` stays byte-identical 3-value — the Phase-70 funding/cron
  gate is intact (D-08). Confirmed in `closed-sets.ts` and the inverted
  `closed-sets.test.ts` pins.
- The chip-surface source-scan guard (`closed-sets.test.ts:60-76`) still passes:
  `VerificationForm` imports `UI_EXCHANGE_CODES` (present) and does NOT import
  `SUPPORTED_EXCHANGES`; the new `EXCHANGE_DISPLAY` import does not trip the
  regex.
- The `VerificationForm` label source moved from a local `Record<string,string>`
  drift map (which could return `undefined`) to the single-source
  `EXCHANGE_DISPLAY` (`Record<SupportedExchange,string>`) — a genuine type-safety
  improvement; a new code can no longer render a blank option.
- Wizard `credentialLabels`/`credentialPlaceholders` are optional,
  presentation-only, and correctly defaulted; the raw-secret `htmlFor`
  association, Show/Hide toggle, and submit payload keys are untouched.
- The scope guide literally names `account:read` (strong-wrapped) and steers
  away from write grants with granting-phrased negatives — reinforcing the
  server-side DRB-03 gate (no security regression).
- Task-3 landed as a single atomic commit (`2a58a22f`: const flip + inverted
  pins + label fix + utils comment), so CI is never red between commits.

**Independently verified:** targeted suites `59/59 passed`; `npx tsc --noEmit`
exits 0; `RequestIntroButton` and the marketing `{EXCHANGES.length}` count
auto-widen to 4 with no hardcoded "3" in non-test code.

No blockers. One roadmap-sequencing risk and two cosmetic staleness items below.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Deribit onboarding is exposed to users before the ingestion pipeline exists

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:78-89`, `src/components/landing/VerificationForm.tsx:19-22`
**Issue:** This phase makes a strategy manager able to save a Deribit key
(wizard card + verify dropdown + 4-value `UI_EXCHANGE_CODES`), but per
`69-CONTEXT.md` the trades/dailies/funding ingestion is deferred to Phase 70,
allocator positions to Phase 71, and live LTP onboarding/rotation to Phase 72.
A user who connects a Deribit key in this window will have a stored key that
produces **no trades, no dailies, and no positions** — with nothing in this diff
signalling "data coming soon." The wizard caption ("Spot + Inverse Perpetuals +
Options supported.") actively implies the data path already works. This is a
deliberate, documented phased-rollout decision, not a code defect, but it is a
real degraded-UX risk that should be a conscious ship-gate call rather than an
implicit consequence of the flip.
**Fix:** Confirm the ship decision explicitly. Either (a) land Phase 70
ingestion close behind this before Deribit onboarding is broadly discoverable,
or (b) add a lightweight "analytics for Deribit is rolling out" note on the
Deribit card / post-save state so a connected key with empty analytics is not
read as a bug. No code change required if the sequencing is intentional and
accepted.

## Info

### IN-01: Stale gate comment in `RequestIntroButton` now contradicts the flipped behavior

**File:** `src/components/strategy/RequestIntroButton.tsx:21-24`
**Issue:** The comment reads "Deribit is accepted at key-saving boundaries
(Phase 68) but must not appear in the UI until the wizard ships it (Phase 69) —
OQ4 gate." Post-flip, `EXCHANGE_OPTIONS` maps the now-4-value
`UI_EXCHANGE_CODES`, so Deribit **does** now render as a selectable chip here.
The comment frames Deribit as excluded and reads as stale/misleading. The
executor's Gap-4 flag list (SUMMARY) covers `for-quants/page.tsx:317`,
`AllocatorExchangeManager.tsx:684`, `wizardErrors.ts:143`, and
`security/page.tsx:11`, but missed this one — arguably the comment most directly
contradicted by the flip.
**Fix:** Refresh the comment to note Phase 69 has flipped the const so Deribit
is now offered, while still explaining why `UI_EXCHANGE_CODES` (not
`SUPPORTED_EXCHANGES`) is the binding source.

### IN-02: Deliberately-left stale 3-exchange prose (acknowledged, do-not-fix)

**File:** `src/app/(marketing)/security/page.tsx:11` (+ `for-quants/page.tsx:317`, `AllocatorExchangeManager.tsx:684`, `wizardErrors.ts:143`)
**Issue:** The security-page header comment still lists "Binance/OKX/Bybit
walkthroughs," and the three sibling files carry equivalent 3-exchange prose.
None of these derive from `UI_EXCHANGE_CODES`, so the flip does not
auto-correct them. Per the review focus and CLAUDE.md Rule 3 (surgical changes),
these were consciously left untouched and flagged as follow-up candidates in the
SUMMARY (Gap-4). Recorded here only for traceability — not a fix for this PR.
**Fix:** Track a small copy-sweep follow-up to align this prose with the
4-exchange offered set once Deribit onboarding is user-visible.

---

_Reviewed: 2026-07-04T22:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
