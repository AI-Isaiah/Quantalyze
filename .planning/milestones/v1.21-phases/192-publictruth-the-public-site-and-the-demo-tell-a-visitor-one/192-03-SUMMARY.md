---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 03
subsystem: ui
tags: [copy, marketing, terms, for-quants, home, render-pins, trust]

requires:
  - phase: 192-publictruth
    provides: "192-EVIDENCE.md lines 'D-01 code facts:' and 'D-04 signed-out factsheet:' (plan 192-01)"
provides:
  - "KEY_STORAGE_SENTENCE, KEY_STORAGE_LINK, LISTING_COST_SENTENCE, EXCHANGE_LIST in src/lib/status-surface-copy.ts, each with a literal pin"
  - "Terms, /for-quants and the home page render those constants instead of three drifting private versions"
  - "The home page asks an anonymous visitor for no key: the #verify key form is replaced by a sign-up band"
affects: [192-04, 192-10]

actuals:
  tokens: 6300
  tasks: 3
  commits: 3
plan_head_before: 86a118d9c76e9a4e497f2ba4ee2f3decfb2496d6
commits: 3
plan_head_after: 74b6a040b1d76e7eb15a3820fdb27b03fcb6f699

tech-stack:
  added: []
  patterns:
    - "One exported constant per public fact, pinned by a literal typed in the test (oracle independence), rendered by every surface that states it"
    - "TRUST_ATOMS rows take an optional link field rather than widening body to a React node"

key-files:
  created:
    - src/__tests__/public-truth-copy.test.tsx
  modified:
    - src/lib/status-surface-copy.ts
    - src/lib/status-surface-copy.test.ts
    - src/app/(marketing)/legal/terms/page.tsx
    - src/app/(marketing)/for-quants/page.tsx
    - src/app/(marketing)/page.tsx
    - src/app/(marketing)/page.stat-errors.test.tsx

key-decisions:
  - "Every S-KEY clause shipped: 192-EVIDENCE.md reads 'D-01 code facts: S-KEY clauses true', so nothing was deleted from the sentence."
  - "The codename sentences shipped: the D-04 line reads published=200, firm-name=absent, title=codename, non-codename-titles=0, so the Task 2 precondition held and no checkpoint was needed."
  - "/for-quants says what a signed-out request returns and drops 'until you accept an intro' (orchestrator resolution 6): an attested institutional allocator can see a manager's identity before any intro, so the UI-SPEC clause would be false for some viewers."
  - "EXCHANGE_LIST is Intl.ListFormat over EXCHANGES with no map: EXCHANGES is already display labels, so the orchestrator's resolution-7 premise did not hold at HEAD."

requirements-completed: [TRUST-01]

coverage:
  - id: D1
    description: "Four shared constants exist with exact literal pins (key sentence, key link, listing-cost sentence, exchange list)"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/lib/status-surface-copy.test.ts#192 PUBLICTRUTH shared sentences"
        status: pass
    human_judgment: false
  - id: D2
    description: "Terms section 2 and 7 render the shared key and cost sentences, with a dated Last updated line"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/__tests__/public-truth-copy.test.tsx#Terms (D-02, D-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/for-quants renders the shared key, cost and exchange values and a visibility sentence scoped to a signed-out request; the unbacked sentences are gone"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/__tests__/public-truth-copy.test.tsx#/for-quants (D-02, D-04, D-05, D-06)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Home renders no input, textarea or form and no 'never stored' text; #verify holds one Create an account link with the Get Started class string; the exchange count still reads EXCHANGES.length"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/__tests__/public-truth-copy.test.tsx#Home (D-07, D-06, D-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The home sign-up band is left-aligned, stacks the CTA below the text on mobile and to the right on desktop, and does not scroll horizontally at 390px"
    verification: []
    human_judgment: true
    rationale: "Layout at 390px and desktop width was not opened in a browser in this run (no browser session, jsdom has no layout). It copies the footer CTA block's classes, but a person has to look."

duration: ~30min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 03: Shared public sentences Summary

**One key-storage sentence, one listing-cost sentence and one flag-aware exchange list, each a pinned constant in `status-surface-copy.ts`, now rendered by Terms, /for-quants and the home page, and the home page no longer shows an anonymous visitor a key form.**

## Performance

- **Tasks:** 3 (one tracer, two TDD)
- **Files modified:** 7 (1 new)
- **Commits:** 3 task commits, measured from the plan-head ledger

## Accomplishments

- `KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK`, `LISTING_COST_SENTENCE` and `EXCHANGE_LIST` live in `src/lib/status-surface-copy.ts`; the closed-sets import gained `EXCHANGES` on the one existing line. The three sentences are also in `everyRenderedString()`, so the passive/timing phrase ban covers them.
- Terms section 2 ends with the shared key sentence and a "How we store keys" link; section 7 reads "The platform is currently free for allocators." plus the shared cost sentence; Last updated is 2026-11-07.
- /for-quants: hero sub-line ends with the cost sentence; "Envelope encryption at rest" body is the key sentence with its link (new optional `link` on `TRUST_ATOMS`); "Listed to qualified allocators only" became "Public by link, under your codename"; the codename row, step 01 (`EXCHANGE_LIST`), step 03 and the factsheet-sample sentence are scoped to what a signed-out request returns. The Supabase Vault, "Free to list", "qualified allocators only", "Retail discovery never sees", "Binance, OKX, or Bybit" and "accept an intro" strings are gone.
- Home: `#verify` is a left-aligned sign-up band copied from the footer CTA block, with the exchange list, the key sentence and its link, and one "Create an account" link to `/signup` whose class string equals "Get Started"'s. The `VerificationSection` import left the page; both `EXCHANGES.length` reads are unchanged.

## Task Commits

1. **Task 1 (tracer): key-storage and cost sentences, constants, Terms, render pin** - `82b4a6c7b` (feat)
2. **Task 2: /for-quants reads the shared sentences** - `abb9cb388` (feat)
3. **Task 3: home page asks an anonymous visitor for no key** - `74b6a040b` (feat)

**Plan metadata:** the SUMMARY commit follows this file.

## RED evidence (new pins shown failing against HEAD, then GREEN)

Byte backups of every edited file were taken to the scratchpad before the first edit.

- **Task 1, Terms:** HEAD's `terms/page.tsx` copied over the new one, `npx vitest run src/__tests__/public-truth-copy.test.tsx` gave 4 failed of 4: the S-KEY assertion (`expected ... to contain 'We store your read-only API key encry...'`), the link lookup, the S-COST assertion (`Expected: "The platform is currently free for allocators. Listing a strategy is free. ..."`, received the old "Managers may be subject to a success fee ..." tail) and the Last updated date (`expected '2026-04-07' not to be '2026-04-07'`). The new file was copied back and the run was GREEN (92 passed with `status-surface-copy.test.ts`). The four `status-surface-copy` constants did not exist at HEAD, so their pins fail by missing export.
- **Task 2, /for-quants:** the test was written while the page was still at HEAD and run before any page edit: 5 of 5 `/for-quants` cases failed on assertions (key sentence missing, hero ends "Free to list.", step 01 "Binance, OKX, or Bybit", row "Public by link, under your codename" not found, "qualified allocators only" present). After the edit all five passed. This was RED-before-edit rather than the plan's cp-over-the-new-file shuffle; the failing evidence is the same, taken from the same HEAD page.
- **Task 3, Home:** same order against HEAD's home page: 3 of 4 `Home` cases failed (`Verify Your Performance` instead of `Verify your track record`; `Cannot read properties of null (reading 'className')` on the missing Create link; a `<form>` present). The fourth, the "Exchanges supported" stat pin, passed at HEAD on purpose: it is a regression guard that D-06 left both `EXCHANGES.length` reads alone. After the edit all four passed.

## Gates (run from the worktree root)

- `npx vitest run src/lib/status-surface-copy.test.ts src/__tests__/public-truth-copy.test.tsx "src/app/(marketing)"`: 8 files, 189 tests passed, 0 failed.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the four plan-named source files plus both touched tests: exit 0. `npm run lint` as a whole exits 1, and none of it is from this plan: its eslint step and `check-admin-route-manifest` and `check-route-contract` pass, then `check-planning-hygiene` reports `ABSOLUTE-HOME-PATH: .planning/phases/192-.../192-01-SUMMARY.md:110` (a literal home-path prefix named in prose in plan 01's SUMMARY, under "Threat Flags"). I did not edit it (other plan's file, out of scope). `check-canonical-domain` was run separately: OK.
- Acceptance greps: `export const` x4 = 1 each; `import { EXCHANGE_DISPLAY, EXCHANGES } from "./closed-sets"` = 1; `2026-04-07` in Terms = 0; constants referenced in Terms = 2 each; `Free to list` = 0; `Supabase Vault` = 0; `EXCHANGE_LIST` in /for-quants = 2; `Public by link, under your codename` = 1; `VerificationSection` in home = 0 and in the stat-errors test = 0; `id="verify"` = 1; `EXCHANGES.length` = 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Home section comment contained the literal that an acceptance grep counts**
- **Found during:** Task 3 acceptance gate
- **Issue:** my explanatory comment spelled the section id, so `grep -c 'id="verify"'` printed 2 against the plan's 1
- **Fix:** reworded the comment to say "the section id"
- **Files modified:** `src/app/(marketing)/page.tsx`
- **Committed in:** `74b6a040b`

No other deviation. The /for-quants RED ordering (RED-before-edit instead of cp-over-new-file) is a method note above, not a behaviour change.

**Total deviations:** 1 auto-fixed (Rule 3). **Impact:** none on behaviour.

## Issues Encountered

- A shell command that also grepped a protected env file was refused by the secret-read guard before it ran, and nothing executed. The edit was rerun without that grep. Whether the suite runs with sFOX off is therefore not read from an env file here; it is pinned by the S-EXCH and home-stat tests themselves, which assert the four-venue list and fail loudly if the flag is on.

## Observations for the orchestrator (not fixed, out of this plan's scope)

- **/for-quants "Delete anytime" row** still says "One click removes the key and the listing. The encrypted credential row is deleted in the same transaction." The plan said leave every other row as is. 192-EVIDENCE.md's retention section says deleting an API key leaves the strategy and its fills in place, so this sentence is likely unsupported for the key-only case. It belongs to plan 192-04's retention reading or 192-10's routing.
- **/security** (`src/app/(marketing)/security/page.tsx:143`) still says the KEK is "stored in Supabase Vault", the same claim removed from /for-quants. Plan 192-04's surface.
- **Signed-in wizard steps** (`ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`) still show the old encryption sentence, as the plan's decision notes say; routed to Phase 200 LEAN-04 by plan 192-10.
- **`src/components/landing/*` and `/api/verify-strategy`** stay on disk and public, no caller on the home page now (T-192-06, booked by plan 192-10).
- **Two sFOX flags** (`NEXT_PUBLIC_SFOX_ENABLED` for `EXCHANGES`, `SFOX_ENABLED` for /security's guide) remain un-unified, as the plan noted; booked by 192-10.
- **`npm run lint` red** on the plan 01 SUMMARY home-path line, described above. Whoever owns 192-01's SUMMARY should rewrite it before the phase ships, or the lint gate stays red.

## Known Stubs

None. No hardcoded empty values, placeholder text or unwired data in the changed files.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-192-05 is mitigated by the render pin that asserts zero input/textarea/form elements on the home page.

## Next Phase Readiness

- Plan 192-04 can import `KEY_STORAGE_SENTENCE` / `KEY_STORAGE_LINK` and must keep the `key-handling` anchor on /security byte-identical.
- Visual check outstanding: open `/` at 390px and at desktop width and confirm the band layout (D5 above).

## Self-Check: PASSED

- Created and modified files exist (checked below with `[ -f ]`); commits `82b4a6c7b`, `abb9cb388`, `74b6a040b` are ancestors of HEAD; `.planning/STATE.md` and `.planning/ROADMAP.md` are untouched.
