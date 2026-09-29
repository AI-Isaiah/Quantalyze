---
phase: 169
topic: T3
fixed_at: 2026-09-29
review_path: .planning/phases/169-pagetruth/169-REVIEW-SFH.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 169: Code Review Fix Report, topic T3 (discovery detail page)

**Fixed at:** 2026-09-29
**Source review:** `.planning/phases/169-pagetruth/169-REVIEW-SFH.md` (H-3); `169-REVIEW.md` swept for this file
**Branch:** `feat/169-fix3`, cut from `feat/169-pagetruth` at `8d9155b7a`
**Iteration:** 1
**Files in scope:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` and its tests

**Summary:**
- Findings in scope: 1 (H-3)
- Fixed: 1
- Skipped: 0
- LOW/Info items about this file: none in either review (see the sweep below)

## Fixed Issues

### H-3: A composite outage on the discovery detail page reaches no alert, and the copy tells the user it is a permanent state

**Files modified:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx`
**Commit:** `2f1daac40`
**Status:** fixed

**Applied fix:**
- **Alert.** The `CompositeSeriesReadError` catch now calls `captureToSentry` from `@/lib/sentry-capture`. That is the repo's server-side helper. The other server pages call it fire-and-forget with `{ tags: { route, stage } }` (`factsheet/[id]/v2/page.tsx:370`, `factsheet-share/[token]/page.tsx:310`), so this call does the same and adds no `after()`.
  - Level: `error`.
  - Tags: `route: "discovery/strategy-detail"`, `stage: "composite-read"`, `reason: "read_error"`, `code: <err.code>`, `strategy_id`, `read: "csv_daily_returns"`.
  - Identifiers: `strategy_id` is the only one. The factsheet resolve stage already sends it for the same failure (`fetch-and-build-payload.ts:427-436`).
- **The captured object is the reader's own error.** It is not a new `Error` carrying only the code. That means the PostgREST message rides along as `cause`. SFH L-2 records the code-only event as a defect on the resolve stage, and sending the reader's error keeps this site from repeating it. The L-2 site itself is not in this topic's files and was not touched.
- **Console line.** The `console.error` line stays, because the helper's contract is that the caller logs and Sentry is additive. It now also carries `errorMessage` (the cause), as the resolve stage's line does.
- **Copy.** A local `compositeReadFailed` flag is set only inside that catch. When it is set, the fallback `<article>` renders `COMPOSITE_READ_FAILED_SENTENCE`: "We could not load this strategy's factsheet right now. Reload this page to try again." It never renders `KCS10_PUBLIC_SENTENCE` on that branch.
  - Voice: active and declarative, with no em dash, per DESIGN.md "Voice / microcopy".
  - The remedy is the owner lane's existing unreadable remedy, word for word (`RETRY_READ_REMEDY` / KCS09-UNREADABLE, "Reload this page to try again."). The subject follows KCS09-FINISHED-UNREADABLE's "We could not read ...".
- **Unchanged behaviour.** Every other throw still propagates. An untrusted composite headline (the reader returns `null` and does not throw) still renders KCS-10 and raises no alert.

**Wording source, and a deliberate divergence.** The brief asked to match the factsheet's own `read_error` wording if one exists. There is none to match:
- The public v2 lane catches `FactsheetReadError`, sets `publicReadFailed` (used only in a `console.warn`) and renders KCS-10 (`factsheet/[id]/v2/page.tsx:497-515`). It fails closed by design.
- The closest user-facing analogue is the owner lane's unreadable family, so the sentence is built from that family.

This authed allocator surface now says something different from the anon public lane on the same outage. That difference is intended: it is what the brief and H-3 ask for.

**Where the sentence lives.** It is a module-level const in `page.tsx`, because `status-surface-copy.ts` is outside this topic's files. It has one caller. The docblock says its home is `status-surface-copy.ts` if Phase 169.1 plan 169.1-01 does not retire this page's assembly.

### Tests (test-first, recorded)

The following changes were made in `page.pending-fallback.test.tsx`:

- The mocked `captureToSentry` is imported and cleared in `beforeEach`.
- A new hand-typed oracle, `READ_FAILED`. It is not imported, following the file's existing KCS10 rule.
- The outage case now asserts:
  - the read-failure line is rendered;
  - KCS-10 is not rendered;
  - no em dash appears;
  - the `console.error` line still carries code `57014`.
- **New case:** Sentry is captured exactly once, with:
  - the reader's `CompositeSeriesReadError`, whose `cause` is the PostgREST message;
  - level `error`;
  - the exact tag set.
- **New case:** a composite with no `cash_settlement` headline, where the csv read succeeds and the reader returns `null`, keeps KCS-10, does not render the read-failure line, and does not capture. This case stops the flag from firing on the wrong branch.
- **Existing cases now also assert no capture:** the no-analytics fallback and "any other throw propagates".

**RED (before the fix):** 2 failed, 3 passed. The failures were exactly the two outage assertions:
- `× says the load failed, never KCS-10, and does not throw`. It received "...The detailed factsheet for this strategy is not available yet...".
- `× reports the outage to Sentry once, with the code as a tag`. It got `expected "vi.fn()" to be called 1 times, but got 0 times`.

The untrusted-headline guard passed before the fix, which is correct: before the fix, nothing fired on either branch.

**GREEN (after the fix):** `Tests 5 passed (5)`.

**Neuter 1 (the fix reverted by hand, not with `git checkout`).** The fixed file was byte-copied to the scratchpad first. Then two changes were made:
- the sentence branch was changed to `KCS10 : KCS10`;
- the `captureToSentry(err, {` call was replaced with a no-op.

Result: `Tests 2 failed | 3 passed (5)`, the same two cases named above. Restore: `cp` from the backup, then `cmp` → `CMP-OK`, then a grep for the fixed branch and the capture call (2 hits), then a re-run → `Tests 5 passed (5)`.

**Neuter 2 (the discriminant).** `let compositeReadFailed = false;` was changed to `= dqf?.composite === true;`, so the flag fires on every composite. Result: `Tests 1 failed | 4 passed (5)`, the failure being `× an untrusted composite headline (no outage) keeps KCS-10 and raises no alert`. Restore: `cp`, then `cmp` → `CMP-OK`, then a grep showing `let compositeReadFailed = false;`.

### Gates (all run in the fix worktree `quantalyze-169-fix3`, not the main checkout)

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0, 0 lines of output |
| `npm run lint` | exit 0 (eslint, admin-route manifest 20 OK, route contract 58 OK, planning hygiene OK) |
| `npx vitest run "src/app/(dashboard)/discovery"` | `Test Files 2 passed (2)`, `Tests 8 passed (8)` |

The worktree resolves `node_modules` by walking up the directory tree. All three commands actually ran; they did not skip.

## LOW / Info sweep for this file

**None in scope.**
- `169-REVIEW-SFH.md` L-1 to L-7 name `scenario-factsheet-payload.ts`, `MetricsColumn.tsx`, `fetch-and-build-payload.ts`, `dollar-validation`/`formatUsdPrice`, `RiskAttribution.tsx`, `metrics.py` and `basis-context`. None of them names this page.
- `169-REVIEW.md` IN-01 to IN-05 name `types.ts`, `basis-context.tsx`, `fetch-and-build-payload.ts`, `composite-read-path.ts`, `scenario-factsheet-payload`, `DESIGN.md` and `RiskAttribution.tsx`. None of them names this page.
- `169-REVIEW.md` lists this page's console-only catch under "Deliberately not flagged" (D-41, interim until 169.1-01). The orchestrator's brief overrides that for this round, and H-3 is now fixed.

**Not taken, and why.** SFH H-2 cites this page (`:~172`, the single-key arm's missing `cumulativeMethod`). It is HIGH and not in T3's brief, and fixing it correctly means resolving the method through the shared config reader in `composite-read-path.ts`, which is outside this topic's files. It is left for the topic that owns H-2. This is flagged here so it is not assumed covered.

## For the orchestrator

- **D-41's text is now stale on one clause.** `169-CONTEXT.md` D-41 says the discovery detail page "catches the same class and keeps its placeholder until 169.1-01 removes its assembly". After this fix, the page shows a read-failure line and captures to Sentry instead. This topic may not edit CONTEXT/ROADMAP, so the sentence is left for you to amend, with a dated note citing SFH H-3.
- `169-REVIEW.md`'s "Deliberately not flagged" bullet for this catch is superseded in the same way.
- **The public lane divergence** described above is intended. The public v2 lane still renders KCS-10 on `read_error` and still has no read-failure copy. Aligning it is out of T3's scope.

---

_Fixed: 2026-09-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
