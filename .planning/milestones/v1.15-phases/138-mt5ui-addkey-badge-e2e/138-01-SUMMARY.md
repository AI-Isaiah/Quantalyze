---
phase: 138-mt5ui-addkey-badge-e2e
plan: 01
subsystem: ui
tags: [mt5, feature-flag, wizard, connect-key, error-envelope, vitest, next-public-flag]

# Dependency graph
requires:
  - phase: 135-mt5-server-seam
    provides: "isMt5EnabledServer() server gate, KEY_MT5_MASTER_PASSWORD / KEY_MT5_WRONG_SERVER envelope copy, login→api_key/investor-pw→api_secret/server→passphrase slot mapping"
  - phase: 136-mt5-recon
    provides: "api_verified derive for mt5 at process_key; mt5 excluded from CRYPTO_EXCHANGES (√252)"
provides:
  - "MT5_UI_ENABLED client-build flag const (strict === 'true', re-exported from @/lib/utils)"
  - "Flag-gated MT5 venue card in ConnectKeyStep with 3-credential labeled variant (login / investor password / broker server)"
  - "Passphrase-slot label/placeholder/helper override + secretHelper on ExchangeOption (label-only, byte-neutral for OKX)"
  - "mt5-keyed 'What we reject' trust-atom swap (MT5 master-password-honest body)"
  - "Component-level proof of 3 distinguishable KEY_* error envelopes for MT5"
affects: [138-02, 138-03, 139-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NEXT_PUBLIC flag const cloned from SFOX_UI_ENABLED (single static member access, fail-closed)"
    - "Presentation-only ExchangeOption overrides (passphraseLabel/Placeholder/Helper + secretHelper) defaulting to today's OKX strings"
    - "Trust-atom swap keyed on venue id (mt5) before the sfox !requiresSecret branch"

key-files:
  created:
    - src/lib/closed-sets.mt5-flag.test.ts
  modified:
    - src/lib/closed-sets.ts
    - src/lib/utils.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx

key-decisions:
  - "MT5 card lives ONLY in ConnectKeyStep's local EXCHANGES array; mt5 stays OUT of UI_EXCHANGE_CODES/EXCHANGES (no manager <Select> widening) — test-pinned both flag states"
  - "Third (passphrase) field carries a per-venue LABEL override; payload key `passphrase` + storage column unchanged (label-only, like credentialLabels)"
  - "requiresPassphrase:true reuses the existing :435 submit-gate predicate for the required broker server (no new gating logic)"
  - "Trust-atom swap keyed on activeExchange.id === 'mt5' (checked first), NOT !requiresSecret — mt5 requires a secret so the sfox branch can never fire for it"

patterns-established:
  - "Pattern 1: flag-gated venue card append behind a NEXT_PUBLIC const — spread empty when OFF (byte-identical), mirroring the sFOX precedent"
  - "Pattern 2: presentation-only field overrides with today's strings as defaults keeps existing venues byte-neutral through the refactor"

requirements-completed: [MT5UI-01, MT5UI-02]

# Metrics
duration: ~20min
completed: 2026-07-24
---

# Phase 138 Plan 01: Flag-gated MT5 add-key card Summary

**MT5 now surfaces as a dark, flag-gated (`NEXT_PUBLIC_MT5_ENABLED`) three-credential add-key card in the wizard — login/investor-password/broker-server mapped to the existing {api_key, api_secret, passphrase} slots, with a muted investor-password steer, an MT5-honest trust atom, and three distinguishable pre-authored error envelopes — byte-identical to today when the flag is off.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-24T00:33:00Z
- **Completed:** 2026-07-24T00:40:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 (+1 created)

## Accomplishments
- Added `MT5_UI_ENABLED` client flag (strict `=== "true"`, fail-closed) adjacent to `SFOX_UI_ENABLED`, re-exported from `@/lib/utils`; updated the Phase-135 anticipating comment to point at the now-defined const.
- Appended the MT5 venue card behind the flag (byte-identical when OFF, test-pinned) with a 3-field labeled variant: `MT5 login` / `Investor password` / `Broker server` (required), the muted master-vs-investor steer, and the broker-server find-it helper.
- Extended `ExchangeOption` with presentation-only `passphraseLabel/Placeholder/Helper` + `secretHelper` overrides defaulting to today's OKX strings (OKX regression pinned byte-neutral).
- Swapped the "What we reject" trust atom to the MT5-honest master-password body (keyed on venue id), leaving sfox + generic venues unchanged.
- Proved three distinguishable envelopes (`KEY_AUTH_FAILED` / `KEY_MT5_WRONG_SERVER` / `KEY_MT5_MASTER_PASSWORD`) each render their own `data-error-code` + title through the existing `buildEnvelope` — zero new copy.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): MT5_UI_ENABLED strict-true flag + no-widening test** - `a21d0f5f` (test)
2. **Task 1 (GREEN): MT5_UI_ENABLED const + re-export** - `cd9884ac` (feat)
3. **Task 2 (RED): MT5 wizard-card component tests** - `7d4a7cc6` (test)
4. **Task 2 (GREEN): flag-gated MT5 card + 3-field variant** - `0eb4531f` (feat)

## Files Created/Modified
- `src/lib/closed-sets.mt5-flag.test.ts` (created) - strict-true truth table + UI_EXCHANGE_CODES/EXCHANGES no-widening pin (both flag states)
- `src/lib/closed-sets.ts` - added `MT5_UI_ENABLED` const with docblock; refreshed the isMt5EnabledServer anticipating comment
- `src/lib/utils.ts` - re-export `MT5_UI_ENABLED` alongside `SFOX_UI_ENABLED`
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` - MT5 card append, `ExchangeOption` overrides, secretHelper render, passphrase-slot override wiring, mt5 trust-atom swap
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx` - Phase 138 describe block (11 cases: flag byte-identity, card/caption, 3 labeled fields, muted steer + server helper, submit gating, slot mapping, mt5-readonly href, trust-atom swap, sfox-swap-intact, 3 envelopes via it.each, OKX regression)

## Decisions Made
- Kept `mt5` out of `UI_EXCHANGE_CODES`/`EXCHANGES` regardless of the flag (RESEARCH Pitfall 2 / UI-SPEC §MT5-Manager-Parity) — the manager `<Select>` must not silently widen. Pinned in the flag test under both OFF and ON.
- The third field's label override is presentation-only; the `passphrase` payload key and storage column are unchanged, matching the `credentialLabels` (Deribit) precedent.
- Trust-atom swap checks `activeExchange?.id === "mt5"` first, then the existing sfox `!requiresSecret` branch — mt5 requires a secret, so the sfox condition can never fire for it.

## Deviations from Plan

None - plan executed exactly as written. Both tasks followed the prescribed TDD RED→GREEN cycle; every behavior-block case landed as specified.

## Issues Encountered
None. The pre-existing `react-hooks/exhaustive-deps` lint warning in `EquityChart.tsx` is unrelated to this plan's files (out of scope, not touched).

## Threat surface

No new threat surface introduced. Per the plan's threat register, this plan adds no gate code (T-138-01 two-gate design intact: card behind `MT5_UI_ENABLED`, connect fail-closed via `isMt5EnabledServer`), no new copy, and no `UI_EXCHANGE_CODES` widening (T-138-03 pinned by the no-widening test). The secret field remains `type=password` (T-138-02).

## Verification
- `npx vitest run src/lib/closed-sets.mt5-flag.test.ts src/lib/closed-sets.sfox-flag.test.ts "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx" --no-file-parallelism` → **49 passed**
- `npx tsc --noEmit` → clean
- `git diff --stat src/lib/wizardErrors.ts src/components/ui/VerifiedBadge.tsx src/components/strategy/TrustTierLabel.tsx` → **empty** (zero new copy, zero badge change)
- `npm run lint` → 0 errors (1 pre-existing unrelated warning)

## Next Phase Readiness
- 138-02 (setup guide `#mt5-readonly`) and 138-03 (all-roles badge e2e + seed helper) are unblocked — the flag const + wizard card they surface alongside now exist.
- Flag flip (`NEXT_PUBLIC_MT5_ENABLED` + `MT5_ENABLED`) remains a Phase 139 founder LIVE op; this plan ships dark.

## Self-Check: PASSED

- All created/modified files present on disk (5/5).
- All 4 task commits present in git log (a21d0f5f / cd9884ac / 7d4a7cc6 / 0eb4531f).
- `MT5_UI_ENABLED` present in closed-sets.ts (3×), utils.ts (1×), ConnectKeyStep.tsx (3×).
- MT5 card `id: "mt5"` present in ConnectKeyStep.tsx.

---
*Phase: 138-mt5ui-addkey-badge-e2e*
*Completed: 2026-07-24*
