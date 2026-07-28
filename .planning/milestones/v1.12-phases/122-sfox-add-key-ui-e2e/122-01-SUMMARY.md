---
phase: 122-sfox-add-key-ui-e2e
plan: 01
subsystem: ui
tags: [sfox, exchange-badge, provenance, react, verified-badge, frontend]

# Dependency graph
requires:
  - phase: 120-sfox-ingestion-registration
    provides: "process_key.py:828 auto-stamps trust_tier=api_verified for a synced sfox key (VerifiedBadge dispatch source)"
  - phase: 119-sfox-read-adapter-key-validation
    provides: "server validate route WR-01 exchange normalization — the client-side F6 gap this plan closes complements it"
provides:
  - "SFOX 3-letter mono tag in both connected-key tag maps (ApiKeyManager exchangeIcon + AllocatorExchangeManager EXCHANGE_TAGS), ships UNCONDITIONALLY (independent of the SFOX-08 offer flag)"
  - "F6 class-closed: both client add-key sites canonicalize exchange to lowercase before the validate body AND the api_keys insert, so a mixed-case value can never hit the DB lowercase-only CHECK (23514)"
  - "VerifiedBadge api_verified coverage proving the exchange-agnostic dispatch renders for a sfox-sourced api_verified strategy"
affects: [122-02, 122-03, 122-04, sfox-add-key-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side exchange canonicalization at handleAddKey entry — single lowercase-trim reused for the validate fetch body and the direct api_keys insert"
    - "Passthrough component mock (wrap real ApiKeyForm, capture onSubmit) to drive a real handler with a vector the jsdom <select> cannot inject"

key-files:
  created: []
  modified:
    - "src/components/strategy/ApiKeyManager.tsx — exchangeIcon sfox:'SFOX' + F6 canonicalization"
    - "src/components/strategy/ApiKeyManager.test.tsx — SFOX badge test + F6 wiring tests"
    - "src/components/exchanges/AllocatorExchangeManager.tsx — EXCHANGE_TAGS sfox slate chip + F6 canonicalization"
    - "src/components/exchanges/AllocatorExchangeManager.test.tsx — SFOX tag test + ApiKeyForm passthrough mock + F6 wiring tests"
    - "src/components/ui/VerifiedBadge.test.tsx — SFOX-09 api_verified coverage block"

key-decisions:
  - "SFOX tag ships unconditionally (no offer-flag gate) — a founder-connected sfox key must render before the public flag flips"
  - "sfox tag label 'SFOX' (per plan mandate) on a neutral slate pairing bg #F1F5F9 / fg #0F172A (~17:1, past WCAG AA), both hexes already present in DESIGN.md / the file"
  - "F6 fold-in widened to the whole class (both client insert sites) per the close-the-whole-batch rule, not just the CONTEXT-named AllocatorExchangeManager:575"

patterns-established:
  - "Canonicalize user-supplied exchange client-side at the DB-insert chokepoint; credential fields stay untouched (their .trim() lives server-side)"

requirements-completed: [SFOX-09]

# Metrics
duration: 14min
completed: 2026-07-19
---

# Phase 122 Plan 01: SFOX badge surfaces + F6 canonical-lowercase insert Summary

**SFOX 3-letter mono tag in both connected-key tag maps (unconditional), VerifiedBadge api_verified coverage for a sfox strategy, and the F6 class closed — both client add-key sites canonicalize the exchange to lowercase before the validate body and the api_keys insert.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-19T07:19Z
- **Completed:** 2026-07-19T07:29Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- A connected sfox key now renders the mono tag "SFOX" (never the "?"/"SFO" fallback) in both the ApiKeyManager key card and the AllocatorExchangeManager connected-key rows — shipping regardless of the SFOX-08 offer flag.
- Both client add-key handlers (`ApiKeyManager.handleAddKey`, `AllocatorExchangeManager.handleAddKey`) now lowercase-canonicalize the exchange once at entry and reuse it for BOTH the `/api/keys/validate-and-encrypt` body AND the direct `api_keys` insert, closing the phase-119-deferred F6 gap as a class: a mixed-case "sFOX" can no longer pass server validation (burning a live probe) then 23514 on the DB lowercase-only CHECK.
- VerifiedBadge's exchange-agnostic api_verified dispatch is now pinned for a sfox-sourced strategy (SFOX-09 provenance leg), with fail-closed re-pins for sfox self_reported / csv_uploaded.

## Task Commits

Each task was committed atomically:

1. **Task 1: SFOX 3-letter mono tag in both tag maps** — `b0af494a` (feat)
2. **Task 2: F6 canonical-lowercase exchange at both client insert sites** — `ba7b2266` (fix)
3. **Task 3: VerifiedBadge api_verified coverage for a sfox strategy** — `0a7a6b88` (test)

_Note: `.planning/**` is gitignored/local — no plan-metadata git commit; SUMMARY/STATE/ROADMAP updated on disk only._

## Files Created/Modified
- `src/components/strategy/ApiKeyManager.tsx` — `exchangeIcon` gains `sfox: "SFOX"`; `handleAddKey` canonicalizes `data.exchange.trim().toLowerCase()` for the validate body + insert.
- `src/components/strategy/ApiKeyManager.test.tsx` — SFOX badge render test; extended supabase mock with `insert`; F6 wiring tests (sFOX→sfox at fetch body + insert; binance byte-identical).
- `src/components/exchanges/AllocatorExchangeManager.tsx` — `EXCHANGE_TAGS` gains the sfox slate chip; `handleAddKey` canonicalizes for the validate body + insert.
- `src/components/exchanges/AllocatorExchangeManager.test.tsx` — SFOX tag render test; passthrough `ApiKeyForm` mock capturing `onSubmit`; F6 wiring tests at the allocator call site.
- `src/components/ui/VerifiedBadge.test.tsx` — SFOX-09 api_verified coverage describe block (greppable "sfox").

## Decisions Made
- **SFOX tag is unconditional** — no reference to the SFOX-08 offer flag anywhere; the tag ships now because a founder-connected sfox key exists before the public flag flips (122-CONTEXT locked decision). The only offer-flag mentions in the touched files are explanatory comments asserting this unconditionality — no gating code.
- **Tag label "SFOX" on neutral slate** (bg `#F1F5F9`, fg `#0F172A`, ~17:1 contrast). Both hexes already appear in DESIGN.md / the file (near-black navy + slate-100 fallback bg); no new colour token, no emoji (AI-Slop Ban honored). Note the label is 4 chars vs the 3-char precedent (BNB/DRB) — followed the plan's explicit `sfox: "SFOX"` mandate.
- **F6 widened to the whole class** — the CONTEXT named only `AllocatorExchangeManager.tsx:575`, but `ApiKeyManager` had the identical raw-`data.exchange` pattern; both were fixed per the close-the-whole-batch rule.
- **Allocator F6 test drives the real handler via a passthrough ApiKeyForm mock** — jsdom's `<select>` resets a non-option value to "", so "sFOX" cannot be injected through the real Select; wrapping ApiKeyForm to capture `onSubmit` lets the test drive the real `handleAddKey` with the mixed-case vector while every existing real-form test keeps rendering the real component untouched.

## Deviations from Plan

None — plan executed exactly as written. All three tasks implemented per spec; F6 widened to both sites was explicitly directed by the plan's Task 2 action (close-the-whole-batch), not an unplanned deviation.

## Issues Encountered
- **jsdom `<select>` cannot hold a non-option mixed-case value** for the allocator F6 test (the real Select's options are lowercase-only). Resolved with a passthrough `ApiKeyForm` mock that delegates to the real component and captures `onSubmit`, so the real `handleAddKey` is driven with "sFOX" without changing any existing test's behavior.
- **prove-it-fails discipline honored:** both F6 canonicalizations were temporarily neutered (`data.exchange.trim().toLowerCase()` → `data.exchange`); the sFOX tests failed (`Expected "sfox", Received "sFOX"`) at both the fetch-body and insert assertions, then were restored and re-verified green.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- SFOX-09 badge + provenance legs shipped and independent of plan 122-02 (offer flag) — zero dependency between the two.
- Plan 122-02 owns the closed-sets `UI_EXCHANGE_CODES` / offer-flag edits; this plan deliberately did NOT touch `src/lib/closed-sets.ts` (surgical).
- Verification all green: `npx vitest run` on the three touched files = 66 passed; `npx tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing warning in the untouched EquityChart.tsx, out of scope).

## Self-Check: PASSED

- Files verified on disk: 122-01-SUMMARY.md, ApiKeyManager.tsx, AllocatorExchangeManager.tsx, VerifiedBadge.test.tsx — all FOUND.
- Task commits verified in git log: `b0af494a`, `ba7b2266`, `0a7a6b88` — all FOUND.

---
*Phase: 122-sfox-add-key-ui-e2e*
*Completed: 2026-07-19*
