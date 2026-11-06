---
phase: 183-dupcount-a-book-whose-marked-duplicate-key-is-already-counte
plan: 05
subsystem: per-key account-share note (Exchanges page row and strategy key card)
tags: [copy, d-02, tdd, design-tone, account-share-note, tracer]
status: complete
requires: ["183-01", "183-02"]
provides:
  - "accountShareNote(key, keysById) returns 'This key reads the same exchange account as <holder>. We count that account once.' and takes no verb argument"
  - "both key cards render the note in the muted tone (text-text-muted), not amber"
  - "no note the function can produce names a control or asks the owner to remove a key; a guard test fails if a remedy returns"
affects: [183-04]
requirements-completed: [D-02]
key-files:
  modified:
    - src/lib/account-share-note.ts
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/strategy/ApiKeyManager.tsx
    - src/lib/account-share-note.test.ts
    - src/components/exchanges/AllocatorExchangeManager.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.liveness.test.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
decisions:
  - "D-02 (founder 2026-11-01): the per-key note for a marked duplicate states a fact (same exchange account, counted once) in a neutral muted line and asks for nothing, because one account behind several logins is intended."
  - "Scope extension, recorded in the plan: the strategy edit page's key card shows the same sentence from the same function, so it changes too; its old remedy (Delete one of the keys) is the request D-02's reason rejects."
  - "The action parameter and its exported union type are REMOVED (Claude's choice, per the plan): the new sentence names no control, so tsc now rejects a third argument and a verb cannot come back silently."
  - "D-03 and D-04 are non-changes: nothing under src/app/ is edited, and no non-test file under src/ names the counted-once flag."
metrics:
  tasks: 2
  commits: 2
  files: 7
actuals:
  tokens: 45000
  tasks: 2
  commits: 2
plan_head_before: 6a5d1edea14a4fbc2918734d6a19e985482805b4
plan_head_after: 8b105ca123060cfb8364f6b11c7954f827e8185c
completed: 2026-11-01
coverage:
  - id: D1
    description: "A key marked duplicate of a working holder shows exactly 'This key reads the same exchange account as <holder label>. We count that account once.' on the allocator Exchanges row and on the strategy key card."
    requirement: D-02
    verification:
      - kind: unit
        ref: "src/lib/account-share-note.test.ts#says the key reads the same account as its holder and that we count that account once (Phase 183 D-02)"
        status: pass
      - kind: unit
        ref: "src/components/exchanges/AllocatorExchangeManager.test.tsx#names the holder on the duplicate row and says we count that account once, in the muted tone (Phase 183 D-02)"
        status: pass
      - kind: unit
        ref: "src/components/strategy/ApiKeyManager.test.tsx#renders the counted-once sentence on the marked key card, in the muted tone, naming no remedy (Phase 183 D-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No note asks the owner to remove a key, on any venue or working holder status; accountShareNote takes no verb."
    requirement: D-02
    verification:
      - kind: unit
        ref: "src/lib/account-share-note.test.ts#no note asks the owner to remove a key, on any venue or working holder status (Phase 183 D-02)"
        status: pass
      - kind: other
        ref: "npm run -s typecheck (tsc rejects a third argument; AccountShareNoteAction no longer exists)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The note renders in the muted caption tone on both cards, not the amber warning class."
    requirement: D-02
    verification:
      - kind: unit
        ref: "AllocatorExchangeManager.test.tsx and ApiKeyManager.test.tsx toHaveClass text-text-muted / not text-warning (mutation m3 seen RED)"
        status: pass
    human_judgment: true
    rationale: "Whether a muted line reads as neutral on the live page against DESIGN.md is a visual judgment; the class is pinned, the look is not."
  - id: D4
    description: "When the note shows is unchanged (silent cases, D-03 panel line, D-04 no flag reader)."
    requirement: D-02
    verification:
      - kind: unit
        ref: "silent-case tests unchanged; AllocationDashboardV2.rebuilding.test.tsx passes unedited"
        status: pass
    human_judgment: false
duration: ~12min
---

# Phase 183 Plan 05: The share note says we count the account once Summary

The per-key account-share note now reads "This key reads the same exchange account as <holder>. We count that account once." in the muted tone on the Exchanges page row and the strategy key card, with the Disconnect / Delete remedy, the `action` parameter and its union type removed.

## What changed

- `src/lib/account-share-note.ts`: `accountShareNote(key, keysById)` has two parameters and returns the counted-once sentence built from `holderLabel(holder)`; the four null checks before it are unchanged. `AccountShareNoteAction` is deleted (nothing else imported it). The module docstring says what the note says and when it says nothing ("Phase 183 D-02"); the D-18 reader-rule, composite_member and T-167.1.2-17 paragraphs are kept.
- `src/components/exchanges/AllocatorExchangeManager.tsx` and `src/components/strategy/ApiKeyManager.tsx`: the call is `accountShareNote(key, keysById)`; the `<p role="note">` class is `text-xs text-text-muted mt-0.5` (was amber `text-warning`); the JSX comments are rewritten by concept.
- Tests: `account-share-note.test.ts` calls with two arguments, retitles the remedy describe, replaces the verb test with the counted-once pin, and adds the no-remedy guard (4 holder statuses by 6 venues, one `it`). The allocator and strategy component tests pin the exact sentence, the muted class, the absence of the amber class and of any remedy wording; the liveness file moves two expected strings. Every silent-case assertion is unchanged.

Copy, exactly:

- Before (allocator row): `This key reads the same exchange account as Binance — Primary Binance. Disconnect one of them.`
- Before (strategy card): `This key reads the same exchange account as OKX — Main OKX. Delete one of them.`
- After (both cards): `This key reads the same exchange account as Binance — Primary Binance. We count that account once.` / `This key reads the same exchange account as OKX — Main OKX. We count that account once.`

No branch keeps a disconnect remedy: the whole note changed (see Collision verdict).

## RED evidence

Task 1, against the unmodified source (commit `14207595b`, tests only, source untouched): `Tests  23 failed | 284 passed (307)`. Received values were the old remedy sentence (for example `... Holder Binance. Disconnect one of them.`). Semantic assessment: every target failed on its planned assertion (the new sentence, the muted class, the no-remedy match), none on an import, syntax or fixture fault. The 23 FAIL names:

- `a connected, active holder whose last sync completed is working, and the duplicate shows the counted-once sentence`
- `WORKING: an active, connected holder whose last sync is idle still counts the account`
- `WORKING: an active, connected holder whose last sync is complete still counts the account`
- `WORKING: an active, connected holder whose last sync is rate_limited still counts the account`
- `WORKING: an active, connected holder whose last sync is never synced (NULL) still counts the account`
- `says the key reads the same account as its holder and that we count that account once (Phase 183 D-02)`
- `no note asks the owner to remove a key, on any venue or working holder status (Phase 183 D-02)`
- `binance → Binance`, `okx → OKX`, `bybit → Bybit`, `deribit → Deribit`, `sfox → sFOX`, `mt5 → MT5`
- `names the holder on the duplicate row and says we count that account once, in the muted tone (Phase 183 D-02)`
- `names the holder while it is working, last sync idle`
- `names the holder while it is working, last sync complete`
- `names the holder while it is working, last sync never synced (NULL)`
- `three keys on one account show the balance once, on the holder; the other two name it`
- `a working duplicate keeps its share note and also names the balance row`
- `renders the counted-once sentence on the marked key card, in the muted tone, naming no remedy (Phase 183 D-02)`
- `names the holder on the duplicate's card while it is working, last sync idle`
- `names the holder on the duplicate's card while it is working, last sync complete`
- `names the holder on the duplicate's card while it is working, last sync never synced (NULL)`

GREEN (commit `8b105ca12`): the four files print `Tests  307 passed (307)`; with the D-03 pin (`AllocationDashboardV2.rebuilding.test.tsx`, unedited) the five files print `Tests  362 passed (362)`.

## Mutation checks

- mutation-m1: red (pre-fix `account-share-note.ts` copied back over the fix: `Tests  23 failed | 284 passed (307)`, "no note asks the owner to remove a key, on any venue or working holder status (Phase 183 D-02)" among the failures). restore: cmp clean (and `git diff --quiet HEAD` clean).
- mutation-m3: red (amber `text-warning` put back on both `<p role="note">` lines: `Tests  2 failed | 250 passed (252)`, naming "names the holder on the duplicate row and says we count that account once, in the muted tone (Phase 183 D-02)" and "renders the counted-once sentence on the marked key card, in the muted tone, naming no remedy (Phase 183 D-02)"). restore: cmp clean (both components, byte backups; `git diff --quiet HEAD -- src` clean).

## Gates

- `npm run -s typecheck`: exit 0.
- `npm run -s lint`: exit 0 (eslint over `src/` plus the planning-hygiene check).

## Full vitest run

`Test Files  1 failed | 1183 passed | 20 skipped (1204)`, `Tests  2 failed | 23313 passed | 315 skipped (23630)`. The only failing file is `src/lib/factsheet/compute.conventions.test.ts` (2 failures, the known baseline). No other failure.

## Collision verdict

The note is reachable only for a pair the derive counts once, so no real double count (`account_identity_collision`) ever has this note as its remedy, and the whole note changed with no collision branch kept. Evidence points of the plan objective, by name: (1) the note shows only for a `duplicate` marker with a holder id where the key and the holder (found in the owner's own key list, the same set the derive loads) both work; (2) working implies eligible (`working_holder_predicate` against `eligible_key_predicate`: "every working key is eligible"); (3) `account_groups` unions the pair and the group loop keeps exactly one key and sets `duplicate_counted_once`; (4) a collision needs two counted keys, two live keys cannot share a venue id (partial unique index), so a collision on such a book involves a departed key's history, which is disconnected and never carries this note (and that case is the rebuilding panel's `duplicate_account` line, D-03); (5) a marked key whose holder is not working shows no note and the derive counts that account once through the marked key; (6) the reader agrees (183-02 removed the key-list duplicate helper from `src/lib/queries.ts`, and holdings count one account once).

## Strategy card

D-02 names the Exchanges page, but `accountShareNote` also feeds the strategy edit page's key card (`ApiKeyManager`), and its old remedy ("Delete one of them") is the request D-02's reason rejects, so this plan changes the strategy card too, on purpose. The sentence is true there for every owner: (a) the nightly fan-out `enqueue_derive_broker_dailies_for_allocator_keys` enqueues a key-mode derive for every eligible key with no role or strategy condition, and each one enqueues the compose of the owner's whole book (`_run_key_mode_compose_epilogue`), which counts the pair once; (b) no strategy sums the pair (one key per single-key strategy; a composite pair is `composite_member` with no note, or is refused by `assert_windows_disjoint`; two strategies each holding one key are two track records of one account, not a sum).

## Non-changes (D-03, D-04, prohibitions)

- D-03: `git diff <RED~1> HEAD -- src/app` is empty; `EquityHistoryRebuilding.tsx` and `AllocationDashboardV2.rebuilding.test.tsx` are byte-identical and the pin passes.
- D-04: `git grep -l duplicate_shared_account_counted_once -- src ':!*.test.ts' ':!*.test.tsx'` prints nothing.
- `src/lib/queries.ts`, `src/lib/departed-history.ts`, `analytics-service/`, `scripts/`, `supabase/`, the visibility rule, `isWorkingHolder`, `NOT_WORKING_SYNC_STATUSES` and `holderLabel`: no diff from the base. `git diff --name-only <RED~1> HEAD` outside `.planning/` names exactly the seven `files_modified`.

## CHANGELOG sentence for /gsd-ship

Changed: on the Exchanges page and on a strategy's key list, a key that reads the same exchange account as another of your working keys now says 'We count that account once.' in a neutral tone, instead of asking you to disconnect or delete one of the keys (one account behind several logins is intended).

## Task Commits

1. **Task 1: tracer, red half** - `14207595b` (test)
2. **Task 2: green, mutations, gates** - `8b105ca12` (fix)

## Deviations from Plan

None - plan executed exactly as written. (One harness slip, not a plan deviation: the first m1 run passed the four test paths through an unquoted zsh variable and found no files; it was re-run with explicit arguments and the result above is that re-run. The pre-run restore left the source clean.)

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; the holder is still named only through `holderLabel` (T-183-17), the visibility rule is unchanged (T-183-18), the no-remedy guard and m1 cover T-183-19, and m3 covers T-183-20.

## Self-Check: PASSED

- Files modified exist; commits `14207595b` and `8b105ca12` are ancestors of HEAD; the RED commit precedes the fix; `AccountShareNoteAction` appears nowhere under `src/`; `grep -ac 'one of them' src/lib/account-share-note.ts` prints 0; both `role="note"` lines carry `text-text-muted` and neither the amber class.
