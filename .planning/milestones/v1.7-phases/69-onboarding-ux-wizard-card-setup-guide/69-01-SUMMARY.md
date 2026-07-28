---
phase: 69-onboarding-ux-wizard-card-setup-guide
plan: 01
subsystem: onboarding-ux
tags: [deribit, wizard, security-guide, closed-sets, ui-exchange-codes]
requires:
  - "Phase 68: SUPPORTED_EXCHANGES + DRB-03 scope gate admit deribit at the key-save boundary"
  - "EXCHANGE_DISPLAY already carries deribit: \"Deribit\""
provides:
  - "Deribit wizard card (Client ID / Client Secret labels, no passphrase)"
  - "/security#deribit-readonly setup guide naming account:read"
  - "4-value UI_EXCHANGE_CODES (deribit offered on public/marketing surfaces)"
affects:
  - "VerificationForm dropdown, RequestIntroButton chips, marketing exchange count (auto-widen)"
tech-stack:
  added: []
  patterns:
    - "per-exchange presentation-only credentialLabels/credentialPlaceholders on ExchangeOption"
    - "single-source labels from EXCHANGE_DISPLAY (no local drift map)"
    - "inverted (not deleted) gate pins as post-flip regression guards"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx"
    - "src/app/(marketing)/security/page.tsx"
    - "src/app/(marketing)/security/page.test.tsx"
    - "src/lib/closed-sets.ts"
    - "src/lib/closed-sets.test.ts"
    - "src/lib/utils.ts"
    - "src/components/landing/VerificationForm.tsx"
    - "src/components/landing/__tests__/VerificationSection.test.tsx"
decisions:
  - "credentialLabels/credentialPlaceholders are optional ExchangeOption fields (per-exchange, presentational); payload keys api_key/api_secret + storage columns unchanged"
  - "Task 3 landed as ONE atomic commit (const flip + inverted pins + label-source fix) so CI is never red between commits"
  - "FUNDING_EXCHANGES kept 3-value (Phase-70 gate); parity backstop unchanged"
requirements: [UX-01, UX-02]
metrics:
  duration: ~10m
  tasks: 3
  files: 9
  completed: "2026-07-04"
---

# Phase 69 Plan 01: Onboarding UX — Wizard Card & Setup Guide Summary

Ships the conscious Phase-69 "offer Deribit to users" presentation flip: a Deribit strategy-wizard card with Client ID / Client Secret credential labels and no passphrase field, a `/security#deribit-readonly` scope guide naming `account:read`, and a 4-value `UI_EXCHANGE_CODES` whose consumers all render a real "Deribit" label — with the Phase-68 gate-pin tests inverted (not deleted) into post-flip regression guards. Presentation-only; the server route, encryption path, and DRB-03 scope gate are untouched.

## What Was Built

### Task 1 — Deribit wizard card (UX-01, SC-1)
- Fourth `EXCHANGES` entry in `ConnectKeyStep.tsx`: `{ id: "deribit", name: "Deribit", caption: "Spot + Inverse Perpetuals + Options supported.", requiresPassphrase: false }`.
- Extended `ExchangeOption` with optional `credentialLabels`/`credentialPlaceholders` (per-exchange, presentation-only). Deribit → labels "Client ID"/"Client Secret", placeholders "Paste the Deribit Client ID"/"Paste the Deribit Client Secret".
- Resolved active-exchange labels/placeholders once with defaults "API Key"/"API Secret" and "Paste the read-only key"/"Paste the secret", then wired to the key `<Input>` (label + placeholder) and the RAW secret `<input>` (label text node + placeholder attribute). Show/Hide toggle, `wizard-api-secret` id, and `htmlFor` association untouched (A11Y-4).
- No passphrase branch for deribit (`requiresPassphrase:false` hides the field and nulls the payload); grid classes and OKX passphrase copy unchanged.
- Setup-guide deep-link resolves to `/security#deribit-readonly` via the existing generic `#${exchange}-readonly` href — zero bespoke JSX.
- RED→GREEN: 4 new tests (card render, no-passphrase w/ OKX contrast, label/placeholder swap both directions, deep-link href). Suite: 8/8.

### Task 2 — /security#deribit-readonly setup guide (UX-02, SC-2)
- One new `<SubAnchor id="deribit-readonly" title="Deribit">` after the bybit block inside `Section id="readonly-key"`, reusing the helper + classes verbatim.
- 3-step ordered list: (1) OAuth Client ID/Secret with no passphrase; (2) grant read-only scopes — `account:read` strong-wrapped, plus trade:read/wallet:read, steer away from Trade/Withdraw/`:read_write`; (3) copy into the wizard. Scope wording grounded in `deribit-ground-truth.md` (`account:read trade:read wallet:read …`, zero `:read_write`).
- RED→GREEN: 3 new tests (anchor+heading, literal `account:read`, granting-phrased steer-away — asserted on granting phrasing, not bare tokens, per the UI-SPEC trap). Pre-existing anchor-preservation pin untouched. Suite: 11/11.

### Task 3 — UI_EXCHANGE_CODES flip + VerificationForm fix + inverted pins (SC-3) — single atomic commit
- `closed-sets.ts`: `UI_EXCHANGE_CODES` now `["binance","okx","bybit","deribit"]`; refreshed the two stale doc comments. `FUNDING_EXCHANGES`, `SUPPORTED_EXCHANGES`, `EXCHANGE_DISPLAY` byte-identical.
- `closed-sets.test.ts`: inverted (not deleted) the display pin (`EXCHANGES` → 4-value incl. "Deribit") and the UI pin (`UI_EXCHANGE_CODES` contains deribit); the two `FUNDING_EXCHANGES` assertions kept byte-identical (3-value, excludes deribit); chip-surface source-scan guard (`:58-74`) untouched.
- `VerificationForm.tsx`: deleted the local `EXCHANGE_LABELS` drift map (Gap 1); `EXCHANGE_OPTIONS` labels now source from `EXCHANGE_DISPLAY` (imported from `@/lib/closed-sets`); kept the `UI_EXCHANGE_CODES` import from `@/lib/utils` (guard requirement); no change to the okx-only passphrase gate/payload spread.
- `utils.ts`: comment-only refresh of the re-export note (UI 4-value, funding 3-value).
- `VerificationSection.test.tsx`: new describe block rendering the REAL VerificationForm (via `vi.importActual` to bypass the file's module-level mock) — asserts a "Deribit" option, every option has non-empty trimmed text (Gap-1 revert-proof), and deribit shows no passphrase while okx does (contrast).
- All edits in ONE commit (`2a58a22f`) so CI is never red between commits (Gap 3). Suite: closed-sets + VerificationSection + parity = 40/40.

## Gap-2 auto-widen confirmation (verify-only, no edit)
- `RequestIntroButton.tsx`: `EXCHANGE_OPTIONS = UI_EXCHANGE_CODES.map(...)` with `e === "okx" ? "OKX" : capitalize(e)` → "deribit" renders "Deribit" with zero change. Confirmed.
- Marketing count `src/app/(marketing)/page.tsx:115,215` renders `{EXCHANGES.length}` where `EXCHANGES` (via `@/lib/constants` → `closed-sets.EXCHANGES` derived from `UI_EXCHANGE_CODES`) auto-widens to 4. No edit; no test hardcodes "3 exchanges" (grep-verified — the sole `3 exchanges` hit is an unrelated data-audit comment in `metrics-parity-helper.ts:85`).

## Deviations from Plan

None — plan executed exactly as written. No off-plan-list files touched; no auto-fixes required (Rules 1-3 did not trigger).

## Gap-4 stale-prose flag (out of scope, Rule 3 — follow-up candidates)

Stale "Binance, OKX, or Bybit" (or equivalent 3-exchange) prose that does NOT derive from `UI_EXCHANGE_CODES` and is NOT part of UX-01/UX-02/SC-3 was left untouched:
- `src/app/(marketing)/for-quants/page.tsx:317`
- `src/components/allocator/AllocatorExchangeManager.tsx:684`
- `src/lib/wizardErrors.ts:143`
- `src/app/(marketing)/security/page.tsx:11` (stale 3-exchange header comment)

Recommend a small copy-sweep follow-up to align these with the 4-exchange offered set once Deribit onboarding is user-visible.

## Verification

- Targeted suites GREEN: ConnectKeyStep (8) + security/page (11) + closed-sets (present) + VerificationSection (present) + check-zod-db-check-parity — full targeted run **59/59 passed**.
- `npx tsc --noEmit`: clean (exit 0).
- `npm run lint`: 0 errors (1 pre-existing warning in untouched `EquityChart.tsx`, out of scope).
- Grep gates: `"deribit"` in closed-sets.ts count = 3; `EXCHANGE_LABELS` in VerificationForm = 0; `deribit-readonly` in security/page.tsx = 1.
- Parity backstop (`check-zod-db-check-parity.test.ts`) unchanged and green — funding surfaces still exclude deribit (D-08 leak backstop; Phase-70 gate intact).

## Commits

- `b8908318` test(69-01): failing tests for Deribit wizard card
- `7ac5d5b7` feat(69-01): Deribit wizard card with Client ID/Client Secret labels
- `2a8973ce` test(69-01): failing tests for /security#deribit-readonly guide
- `07f1f8d7` feat(69-01): /security#deribit-readonly setup guide
- `2a58a22f` feat(69-01): flip UI_EXCHANGE_CODES + drift-proof labels + inverted pins (atomic)

## Self-Check: PASSED

All 9 modified files present on disk; all 5 task commits present in git history.
</content>
</invoke>
