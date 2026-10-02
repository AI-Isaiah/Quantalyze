---
phase: 122-sfox-add-key-ui-e2e
plan: 02
subsystem: ui
tags: [sfox, feature-flag, exchange-picker, wizard, frontend]

# Dependency graph
requires:
  - phase: 119-sfox-read-adapter-key-validation
    provides: "validate/create-with-key/composite-add-key sfox carve-out — empty api_secret normalized to '' and accepted; 401/403 → KEY_AUTH_FAILED"
  - phase: 122
    plan: 01
    provides: "SFOX mono tag + api_verified badge ship UNCONDITIONALLY (independent of this offer flag)"
provides:
  - "SFOX_UI_ENABLED flag (strict === 'true', default OFF) gating UI_EXCHANGE_CODES + both wizard pickers + the ApiKeyForm Select — OFF is byte-identical to today, ON offers sfox"
  - "Token-only sfox credential collection across ConnectKeyStep, MultiKeyConnectStep, ApiKeyForm (no secret input; POST/add-key carry api_secret '')"
  - "F3 honest read-only copy on every sfox surface — no false verified-scope claim"
affects: [122-03, 122-04, sfox-add-key-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source env flag: process.env.NEXT_PUBLIC_SFOX_ENABLED read ONCE in closed-sets.ts as SFOX_UI_ENABLED (one static member expr for Next.js build-time inlining); consumers import the const, never re-read env"
    - "Flag-conditional closed set via two `as const satisfies readonly SupportedExchange[]` literals (base 4-tuple / widened 5-tuple) selected at module load, exported as `readonly SupportedExchange[]`"
    - "requiresSecret?: boolean on the wizard ExchangeOption (absent→true) mirrors the existing requiresPassphrase pattern; drives conditional secret rendering + submit gating + empty-secret payload"
    - "Flag-ON component tests: vi.stubEnv + vi.resetModules + dynamic import, vi.unstubAllEnvs in afterEach (Node22 stub-leak guard)"

key-files:
  created:
    - "src/lib/closed-sets.sfox-flag.test.ts — OFF byte-identity + ON widening + strict-equality fail-closed proof"
  modified:
    - "src/lib/closed-sets.ts — SFOX_UI_ENABLED const + flag-conditional UI_EXCHANGE_CODES (both literals keep `satisfies`)"
    - "src/lib/closed-sets.test.ts — corrected stale SUPPORTED_EXCHANGES 4-tuple assertion (phase 119 added sfox)"
    - "src/lib/utils.ts — re-export SFOX_UI_ENABLED from the closed-sets hub"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx — flag-gated token-only sfox card + F3 trust-atom swap + empty-secret POST"
    - "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx — flag OFF absence + flag ON token-only / setup-link / F3 / KEY_AUTH_FAILED / secret-required pins"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx — mirror sfox card + panel requiresSecret handling + empty-secret add-key + step-level F3 note"
    - "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx — flag OFF panel 4-card pin + flag ON token-only add-key pin"
    - "src/components/strategy/ApiKeyForm.tsx — isSfox token-only body (API Token relabel, no secret block, empty-secret submit, honest footer)"
    - "src/components/strategy/ApiKeyForm.test.tsx — OFF 4-option Select pin + ON offers sfox + token-only body/submit + non-sfox secret-required"

key-decisions:
  - "Reused the project's process.env.NEXT_PUBLIC_* convention (no dedicated flag lib exists) — a single static read in closed-sets.ts, Claude's-discretion per 122-CONTEXT"
  - "UI_EXCHANGE_CODES exported type widened from the frozen 4-literal tuple to `readonly SupportedExchange[]`; the two literal-narrowing consumers (VerificationForm[0], RequestIntroButton.map) still typecheck (tsc clean)"
  - "MultiKeyConnectStep step-level 'What we reject' atom is shared across mixed panels, so the F3 sfox note is APPENDED only when a token-only panel is present (rather than replacing the true ccxt claim)"

patterns-established:
  - "Build the offer READY behind a default-OFF flag; the founder flips NEXT_PUBLIC_SFOX_ENABLED=true in Vercel after the backend clears (121-03 egress + SFOX-06 + phase-123)"

requirements-completed: [SFOX-08]

# Metrics
metrics:
  duration_minutes: 15
  tasks_completed: 3
  files_created: 1
  files_modified: 9
  completed_date: 2026-07-19
---

# Phase 122 Plan 02: Flag-gated sFOX offer (picker + wizard cards + honest copy) Summary

Offered sFOX across the user-facing exchange pickers behind a default-OFF
`NEXT_PUBLIC_SFOX_ENABLED` flag: OFF is byte-identical to today (proven), ON
surfaces a token-only sfox card with F3-honest read-only copy and an
empty-string `api_secret` payload that the Phase-119 server carve-out accepts.

## What shipped

**Task 1 — flag-gate the closed set (commit a749267e).** Added
`SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true"` (one static
member read so Next.js inlines it into the client bundle; strict equality
fail-closes "1"/"TRUE"/"on"/"" to OFF). `UI_EXCHANGE_CODES` now selects between a
private base 4-tuple and a widened 5-tuple (base + "sfox"), each carrying
`as const satisfies readonly SupportedExchange[]`, exported as
`readonly SupportedExchange[]`. `EXCHANGES` auto-widens (OQ4) only when the flag
flips — every chip surface inherits the offer with zero edits. `FUNDING_EXCHANGES`,
`SUPPORTED_EXCHANGES`, and `EXCHANGE_DISPLAY` untouched.

**Task 2 — both wizard pickers (commit 1ca2eaf7).** Extended the (deliberately
unshared) `ExchangeOption` interface in ConnectKeyStep and MultiKeyConnectStep
with `requiresSecret?` (absent→true). The sfox card is appended to each private
array only when `SFOX_UI_ENABLED` is on (flag OFF leaves the literal
byte-identical — the State-A neutrality pin stays green). sfox renders one
credential field ("API Token"), no secret input, relaxes the submit/validate
gate off the secret, and POSTs/add-keys `api_secret: ""`. The setup-guide link
auto-resolves `/security#sfox-readonly`. F3: ConnectKeyStep's "What we reject"
atom swaps to the structural read-only claim for sfox; MultiKeyConnectStep
appends the honest note to its shared step-level atom when a token-only panel is
present.

**Task 3 — ApiKeyForm (commit ffd45c82).** The Select auto-widens via EXCHANGES.
`isSfox` (from the lowercased Select value) relabels the key input to "API
Token", drops the secret block, submits `apiSecret: ""`, and swaps the footer to
the honest read-only / no-scope-check copy. Non-sfox exchanges keep the secret
input and the "will be rejected" copy — the scope-probe claim is true for ccxt.

## Verification

- `npx vitest run` on all four touched suites — **59 passed** (closed-sets.sfox-flag
  5+, ConnectKeyStep 16, MultiKeyConnectStep 44, ApiKeyForm 7).
- `npx tsc --noEmit` — clean (both literals keep `satisfies`; the two
  literal-narrowing consumers still typecheck against the widened export).
- `npm run lint` — 0 errors (1 pre-existing unrelated `react-hooks/exhaustive-deps`
  warning in EquityChart.tsx, out of scope).
- Flag-OFF byte-identity: closed-sets deep-equals today's 4-tuple; the wizard
  State-A neutrality snapshot pin passes; ApiKeyForm Select offers exactly the
  four options.
- Single-source: `grep` confirms `process.env.NEXT_PUBLIC_SFOX_ENABLED` is read
  ONLY in closed-sets.ts; wizard steps import `SFOX_UI_ENABLED`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a stale test assertion in closed-sets.test.ts**
- **Found during:** Task 1 (running the adjacent closed-sets suite for flag-OFF
  byte-identity)
- **Issue:** `closed-sets.test.ts` asserted `SUPPORTED_EXCHANGES` equals the
  4-tuple `["binance","okx","bybit","deribit"]`, but Phase 119 already widened
  `SUPPORTED_EXCHANGES` (closed-sets.ts:39) to include "sfox". The test was RED
  on the branch before any of my changes (confirmed by `git stash`).
- **Fix:** Updated the assertion to the 5-tuple with a comment noting the
  Phase-119 sfox widening and that the USER-FACING offer stays flag-gated.
- **Files modified:** src/lib/closed-sets.test.ts
- **Commit:** a749267e
- **Scope note:** in the same file I was actively editing and would block the
  phase's CI; fixed as a documented deviation rather than deferred.

## Threat surface

No new trust boundaries introduced beyond the plan's `<threat_model>`. The sfox
token flows through the EXISTING `api_key` field + scrub lifecycle (T-122-05:
unmount/cancel/finally scrubs untouched); the empty-secret payload is accepted by
the Phase-119 server carve-out (T-122-04: server is the authoritative gate).
`requiresSecret` defaults true so ccxt exchanges still require a secret
(T-122-07, pinned by tests). No false verified-scope copy renders for sfox
(T-122-06, pinned by tests).

## Known Stubs

None. Every sfox surface is wired to real behavior; the offer is hidden by the
default-OFF flag by design (the founder flips it live after 121-03 + SFOX-06 +
phase-123), not stubbed.

## Self-Check: PASSED
- src/lib/closed-sets.sfox-flag.test.ts — FOUND
- Commits a749267e, 1ca2eaf7, ffd45c82 — FOUND in git log
- All 9 modified files present in the three task commits
