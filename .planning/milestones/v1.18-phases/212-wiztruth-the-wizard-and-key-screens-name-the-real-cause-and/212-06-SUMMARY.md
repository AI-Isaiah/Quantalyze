---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 06
subsystem: strategy key panel (SyncProgress, ApiKeyManager) contact pointers
tags: [sc6, sc8, contact-pointer, red-on-revert, ui-copy]
requires: []
provides:
  - "SyncProgress renders its syncError paragraph (server computation_error) through ContactPointerText with contactHref({ topic: 'support', strategy: strategyId }), same tab"
  - "ApiKeyManager SYNC_UNAVAILABLE_COPY is UI-SPEC row 7 and its error paragraph renders through ContactPointerText with supportContactHref"
affects:
  - src/components/strategy/SyncProgress.tsx
  - src/components/strategy/ApiKeyManager.tsx
key-files:
  created:
    - src/components/strategy/SyncProgress.contact-pointer.test.tsx
  modified:
    - src/components/strategy/SyncProgress.tsx
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
key-decisions:
  - "ApiKeyManager.test.tsx delegates its SyncProgress mock to the real component for one case (flag via vi.hoisted), so the row 7 link is asserted where the user sees it; the stub stays the default for every other case"
status: complete
commits: 2
plan_head_before: 80f35f2d833d4542916bf2542ed4b0779f4ab697
plan_head_after: 9ee13fa574af72d18133044d4ee58f12ec9f8d9e
actuals:
  tokens: 2300
  tasks: 2
  commits: 2
---

# Phase 212 Plan 06: Key panel sync errors link the contact form Summary

A server `computation_error` that says "use the contact form" (UI-SPEC rows 8 and 9, written by plan 07) and the sync-start failure sentence (row 7) now render a working `/contact?topic=support&strategy=<id>` link, same tab, on the strategy key panel.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | d68b55e90 | fix(212-06): sync errors link the contact form on the key panel |
| 2 | 9ee13fa57 | fix(212-06): sync-start failure names a real next step |

## What changed

- `SyncProgress.tsx`: the error-branch `<p>` keeps its element and classes; its content is `ContactPointerText` over `syncError`. Text without the phrase renders unchanged.
- `SyncProgress.contact-pointer.test.tsx` (new): case (a) row 8 sentence yields a link with hand-typed href `/contact?topic=support&strategy=strat-1` and no `target`; case (b) a sentence without the phrase is plain text with no link.
- `ApiKeyManager.tsx`: `SYNC_UNAVAILABLE_COPY` is row 7 verbatim ("... and use the contact form if it keeps failing."); the error `<p>` renders through `ContactPointerText` with `supportContactHref`, no `newTab`.
- `ApiKeyManager.test.tsx`: `SYNC_UNAVAILABLE_SENTENCE` re-typed as row 7; the `./SyncProgress` mock now delegates to the real component when `realSyncProgress.on` is set; new case asserts the link href, absent `target`, and the full paragraph text on a 502 enqueue; the `strategies` branch of the supabase client mock gained a `single()` (null data) because the real panel reads the venue label with it.

## RED-on-revert evidence (SC8)

- Task 1: neutered `SyncProgress.tsx` back to the plain `{syncError}` text node. Observed RED: `SyncProgress.contact-pointer.test.tsx` case (a) failed with `Unable to find an accessible element with the role "link" and name "contact form"` (1 failed, 1 passed; case (b) correctly stays green). Restored from the scratchpad backup; `cmp` exit 0; rerun GREEN (2 passed; all 5 SyncProgress files 66 passed).
- Task 2: tests were first run against the old constant (RED before the component edit: 2 failed). Then, with the component edited and green, neutered `SYNC_UNAVAILABLE_COPY` back to the legacy sentence. Observed RED, 3 failed: `does NOT enter 'computing' on a 200 that carries no enqueue evidence (B-15)`, `renders no SUPABASE-naming copy and throws no parse error on a non-JSON !res.ok (C-9)`, and the new `links 'contact form' in the sync-start failure ... (212 SC6)`. Restored; `cmp` exit 0; rerun GREEN (`ApiKeyManager.test.tsx` + `ApiKeyManager.poll.test.tsx`: 176 passed).

## Verification

- `vitest run` on the five SyncProgress files: 66 passed. `ApiKeyManager.test.tsx` + `ApiKeyManager.poll.test.tsx`: 176 passed (poll file untouched).
- `npm run typecheck` exit 0; eslint on the four touched files clean.
- Scoped census `grep -i 'contact support'` over `ApiKeyManager.tsx` and `SyncProgress.tsx`: 0 (was 1). `verify-plan-anchors.mjs`: OK, 6 claims.
- No file under `supabase/migrations` changed. STATE.md, ROADMAP.md, TODOS.md, CHANGELOG.md, VERSION, package.json untouched.
- No comment written by this plan contains the legacy support phrase.

## Deviations from Plan

None to the plan's behavior. Two notes:

1. **ApiKeyManager's own error `<p>` link is not RED-on-revert provable.** `handleSyncTrades` sets `error` and `syncError` to the same message and sets `syncStatus` to `error`, so the paragraph's hide-when-equal guard suppresses it, and the attempt guard in `handleSyncStatusChange` blocks any later status move. The row 7 sentence therefore reaches the user through the SyncProgress site, which is what the new real-panel test asserts. The paragraph wrap is kept as the plan specifies (defensive: any other `error` string carrying the phrase links), and is exercised only by type and render safety, not by a dedicated RED case. No behavior gap: the visible site is covered.
2. **Test harness change (Rule 3).** The shared `./SyncProgress` mock and supabase client mock in `ApiKeyManager.test.tsx` were extended (see above) so the real panel could mount in one case; every other case still gets the stub.

## Known Stubs

None.

## Threat Flags

None. T-212-15 mitigated: `ContactPointerText` renders text nodes plus one `Link` whose href comes from `contactHref`; the column text cannot inject a URL.

## Self-Check: PASSED

- FOUND: src/components/strategy/SyncProgress.contact-pointer.test.tsx, SyncProgress.tsx, ApiKeyManager.tsx, ApiKeyManager.test.tsx
- FOUND commits: d68b55e90, 9ee13fa57 (ancestors of HEAD)
