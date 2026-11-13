---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 02
subsystem: ui
tags: [copy, security, census, wizard, allocator-exchanges, for-quants]
requires:
  - phase: 192-publictruth
    provides: KEY_STORAGE_SENTENCE, KEY_STORAGE_LINK and the /security#key-handling anchor
provides:
  - key-storage census gate (no encryption restatement outside /security)
  - every in-app key-storage description is the shared sentence plus a /security link
affects: [200-07 (owns the rest of AllocatorExchangeManager.tsx)]
status: complete
commits: 2
plan_head_before: c83dc7a2d0fa9324146a77e9a23053b82666e18b
plan_head_after: 954768022df0fddb5f53f0ca1d555194053e14ed
actuals:
  tokens: 6900
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "census of comment-stripped, whitespace-collapsed source with planted-file self-test and anti-vacuity population check"
key-files:
  created:
    - src/__tests__/key-storage-census.test.ts
    - src/components/exchanges/AllocatorExchangeManager.key-storage-copy.test.tsx
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx
    - src/app/(marketing)/for-quants/page.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx
    - src/__tests__/public-truth-copy.test.tsx
key-decisions:
  - "for-quants (RESEARCH open question 2, recommended default, founder may revisit): chip 'Encrypted at rest', card title 'Keys encrypted at rest'; body and link unchanged."
requirements-completed: [LEAN-04]
---

# Phase 200 Plan 02: One security explanation Summary

The security explanation now lives on `/security#key-handling` only: the single-key and multi-key wizard steps, both `AllocatorExchangeManager` copy sites and `/for-quants` render `KEY_STORAGE_SENTENCE` with a link (or name no mechanism), and a new census fails with `file:line` if any in-app source restates the mechanism.

## What changed

- **Census** `src/__tests__/key-storage-census.test.ts`: roots `src/app`, `src/components`, `src/lib`; exempt `src/app/(marketing)/security`, `src/app/api`, `src/lib/status-surface-copy.ts` and tests. Whole-word `KEK|DEK|AES|Fernet|Vault|per-user` plus `envelope encryption` in any case, on comment-stripped, whitespace-collapsed text. Terms are literals (nothing imported from `status-surface-copy.ts`). Anti-vacuity: population must hold `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `AllocatorExchangeManager.tsx` and contain no exempt path. Planted-file self-test per term (code caught, comment-only ignored, identifier-containing-term ignored, phrase wrapped across lines). Allowlist is empty; each future entry needs a reason and an exact count pin (the test enforces both).
- **Wizard steps**: `TRUST_ATOMS` gets an optional `link`; `What we store` is `{ body: KEY_STORAGE_SENTENCE, link: KEY_STORAGE_LINK }` rendered as a `next/link` anchor after the body in the existing `<dd>`; `Who can decrypt` dropped in both. Read-only-scope guidance atoms untouched.
- **AllocatorExchangeManager**: only the two copy sites. Each says the guidance as its own sentences (`Keys are validated against the exchange. Trading and withdrawal keys are rejected.` / `Quantalyze validates the key against the exchange and confirms it's read-only.`) then the shared sentence and the link. Plus the `Link` and constants imports.
- **WithdrawalWarningStrip**: `Read-only is enforced server-side at validation — keys with Trade/Withdraw scopes are rejected.` Test follows.
- **/for-quants**: chip `Encrypted at rest`, card `Keys encrypted at rest`; `public-truth-copy.test.tsx` follows the title.

## Census RED at HEAD (before any copy change), six hits

```
src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:198
src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:225
src/app/(marketing)/for-quants/page.tsx:141
src/app/(marketing)/for-quants/page.tsx:316
src/components/exchanges/AllocatorExchangeManager.tsx:1394
src/components/exchanges/AllocatorExchangeManager.tsx:1644
```

After Task 1 the `ConnectKeyStep.tsx` line was gone (verify command passed: `AllocatorExchangeManager.tsx:` still listed, no `ConnectKeyStep.tsx:<n>`); after Task 2 the census is GREEN with an empty allowlist.

## RED evidence

All neuters applied to the production file with a byte backup in the scratchpad (`.../p200-bak/02/200-02-<name>.bak`), RED captured, restored with `cp`, `cmp` exit 0, tree clean afterwards.

- gc-200-02-neuter: census | `AllocatorExchangeManager.tsx` first site reverted to `encrypted with a per-user KEK before storage` | census failed listing `src/components/exchanges/AllocatorExchangeManager.tsx:1396`; the render test failed `the shared sentence appears at both sites: expected 1 to be 2` | restored, cmp=0.
- `ConnectKeyStep.tsx` | `What we store` atom reverted to the AES-256-GCM / Supabase Vault body | census listed `ConnectKeyStep.tsx:203`; render test failed `expected 'Your API key and secret are encrypted…' to be 'We store your read-only API key encry…'` | restored, cmp=0.
- `MultiKeyConnectStep.tsx` | same revert | census listed `MultiKeyConnectStep.tsx:230`; render test failed with the same body mismatch | restored, cmp=0.
- `WithdrawalWarningStrip.tsx` | closing clause reverted to `scopes are rejected before encryption.` | test failed `Unable to find an element with the text: /Read-only is enforced server-side at validation — keys with Trade\/Withdraw scopes are rejected\./` | restored, cmp=0.
- `/for-quants` chip and card title: census RED at HEAD above (`for-quants/page.tsx:141` and `:316`); not separately re-neutered. `public-truth-copy.test.tsx` row lookup is by the new title and would fail on a revert.

## Gates

- `npx tsc --noEmit -p .`: exit 0.
- `npx vitest run` over `key-storage-census`, `public-truth-copy`, `public-truth-census`, `status-surface-copy`, `src/app/(dashboard)/strategies/new/wizard`, `src/components/exchanges`, `src/app/(marketing)`: 56 files, 1271/1271 passed.
- `npx eslint` over every changed file and the wizard / exchanges directories: exit 0.
- Acceptance greps: AES-256 / Supabase Vault / per-user KEK in non-test, non-api, non-security source prints nothing; `KEY_STORAGE_LINK` count in `AllocatorExchangeManager.tsx` is 5; `before encryption` in `WithdrawalWarningStrip.tsx` code lines 0; `Who can decrypt` in both steps' code lines 0.

## Deviations from Plan

### Auto-added (Rule 2 / CLAUDE.md Rule 9: tests must be able to fail)

**1. Render tests not listed in `files_modified`.**
- **Why:** Task 1's behavior block requires `ConnectKeyStep` to render the sentence and a `/security#key-handling` anchor, and the plan's gate set has no test that fails if the sentence or link is dropped from a component. The census only proves the old text is gone.
- **Added:** a `describe` appended to `ConnectKeyStep.test.tsx` and `MultiKeyConnectStep.test.tsx`; new file `AllocatorExchangeManager.key-storage-copy.test.tsx` (a new file, not an edit to the large `AllocatorExchangeManager.test.tsx`, so plan 07's parallel edits to that file cannot conflict). Each types the sentence as a literal. All were seen RED (above).

**2. MultiKeyConnectStep edit happened in Task 1's working tree.** Both wizard steps were edited in one pass; Task 1's commit holds only `ConnectKeyStep.tsx` (and its test and the census), Task 2's commit holds `MultiKeyConnectStep.tsx`. Task 1's verify was unaffected.

Otherwise the plan executed as written. The census file was edited once after first RED to de-duplicate hits (one sentence with several terms is one `file:line`), which yields the six-hit listing above.

## Known Stubs

None.

## Threat Flags

None. T-200-05 mitigated by the census and render tests; no new endpoint, auth path or schema change.

## Open / notes

- The e2e spec `e2e/for-quants-onboarding.spec.ts` asserts `text=What we store` visible; the atom title is unchanged so it still holds (not run: no playwright in this plan).
- `plan_head_after` and `commits: 2` are measured before the summary commit itself.

## Self-Check: PASSED

Commits `e9af64ae2` and `954768022` are ancestors of HEAD; `src/__tests__/key-storage-census.test.ts` and `src/components/exchanges/AllocatorExchangeManager.key-storage-copy.test.tsx` exist; STATE.md and ROADMAP.md untouched.
