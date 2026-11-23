---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
verified: 2026-11-14T12:50:00Z
verified_at_sha: 8fab0ff5d9b313aba295e5248874080a0d77d98d
status: passed
score: 5/5 contract truths verified (SC-1..SC-4 + D-16); 2 backstop truths insufficient_spec, accepted on the recorded simulation by founder decision 2026-11-14
behavior_unverified: 0
drift_subjects:
  - src/lib/email.ts
  - src/lib/queries.ts
  - src/app/browse/browse-categories.ts
  - src/app/browse/page.tsx
  - src/components/strategy/ShareableLink.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/api/strategies/[id]/share/route.ts
  - src/app/api/allocator/scenario/share/route.ts
founder_decisions:
  - item: "WR-01 per-deployment host"
    decision: "Accept and record (option A, founder, 2026-11-14). A link minted on production's own per-deployment *.vercel.app host, or on an extra NEXT_PUBLIC_ALLOWED_ORIGINS host, comes back on that host. Recorded in 208-CONTEXT.md D-16 and in the ROADMAP Phase 208 SC-5. No code change."
  - item: "D-09 WebKit / iOS reading"
    decision: "Accept the simulation (founder, 2026-11-14). The executor-recorded Playwright WebKit iPhone 15 reading in 208-04-SUMMARY.md stands as the evidence; no iOS Safari device run."
human_verification_resolved:
  - test: "WR-01 founder decision (208-REVIEW.md, orchestrator disposition: OPEN, blocks merge)"
    expected: "Founder picks (A) accept and record in D-16 + ROADMAP, (B) trust the origin on production only when canonical, or (C) gate the NEXT_PUBLIC_VERCEL_URL allow-list entry in src/lib/csrf.ts to non-production. Until then a link minted on production's own per-deployment *.vercel.app host (or an extra NEXT_PUBLIC_ALLOWED_ORIGINS host) comes back on that host."
    why_human: "Not a success-criterion failure (see classification below), but a regression against pre-D-16 production behaviour on one entry path, and the only agent fix (VERCEL_ENV=production env-first) would undo the case D-16 was added for. Needs a founder call."
  - test: "D-09 WebKit reading, UI-SPEC overflow and long-text rows (two `verification: backstop` truths in 208-04-PLAN)"
    expected: "At 393 px a long URL scrolls inside the read-only field, is fully selected on open and after a failed Copy link, nothing overflows the page; the published lane opens a Public link dialog; the in-dialog execCommand copy reads Copied."
    why_human: "Evidence is one executor-recorded Playwright WebKit run (208-04-SUMMARY, readings with selection 0..125 of 125, pageScrollW 393 = clientW 393, `Copied`). The throwaway harness page was deleted by design (D-09: one-off, no CI project), so the verifier cannot reproduce it, and it is Playwright WebKit with an iPhone profile, not iOS Safari (the SUMMARY's honest limit). Backstop truths abstain without a reproducible test or directly observed behaviour. Accept the recorded reading, or re-run on a device."
---

# Phase 208: UIQUICK Verification Report

**Phase Goal:** Three user-facing lies are fixed: the alert digest email stops claiming the dashboard shows its alerts (D-01), the browse page tells a failed read apart from an empty one, and share-link failures are logged and tell the user what happened. D-16 (SHARE-HOST-01, founder addition) makes share links come back on the host they were minted on.
**Verified:** 2026-11-14, at `8fab0ff5d9b313aba295e5248874080a0d77d98d` (branch `feat/208-uiquick`, worktree `quantalyze-208`)
**Status:** passed (2026-11-14, both human items answered by the founder: WR-01 "Accept and record", WebKit check "Accept the simulation"; the original status was human_needed)
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Digest email link reads "Open your allocation →", still targets `/allocations`, no dashboard claim | VERIFIED | `src/lib/email.ts:1003` reads `Open your allocation →` inside `<a href="${APP_URL}/allocations">`; `grep -rn "View in dashboard" src` finds only the negative assertion in `email.test.ts:569`; no "dashboard" word in the `sendAlertDigest` template (grep of lines 955-1010: no match). Neuter: label reverted to "View in dashboard →" turned `email.test.ts` RED (D-01 arm), restored `cmp` 0. |
| SC-2 | `getPopulatedCategorySlugs` separates error from empty; browse renders each state distinctly | VERIFIED | `queries.ts` now `if (error) failAnonRead(...)` (log + Sentry + throw, returns `[]` only for no rows); `browse-categories.ts` returns `{ state: ok/empty/error, categories, onlySlug }`; `page.tsx` renders cards only on `ok`, the "No strategies published yet. Check back soon." line only on `empty`, a `role="alert"` block with `Try again` -> `/browse` only on `error`. The only other caller (`(dashboard)/layout.tsx:93-103`) already try/catches. Neuters (each RED, each restored cmp 0): helper reverted to `return []` (queries arm RED); `state = "error"` -> `"empty"` (page error arm RED); D-14 line removed (D-14 arm RED); empty block disabled (2 arms RED). One neuter survived (`onlySlug` without the `state === "ok"` guard): equivalent mutant, `categories` is `[]` outside `ok` so the guard is redundant belt-and-braces, not a gap. |
| SC-3 | Every `ShareableLink.tsx` catch logs; 401/403 says what it is; manual-copy fallback shows the URL | VERIFIED | Catches: mint (`:364`, logs `{ strategyId, err }`), clipboard write and `execCommand` inside `copyTextBounded` (both `console.warn` with `{ strategyId, err }`, URL never logged, a refused execCommand logged with `err: null`); `.json().catch(() => null)` at `:121` falls into a logged mint catch downstream. `ShareMintError` carries the status; 401 and the `/login` redirect (D-13) -> "Signed out — sign in again to share"; 403/404 -> "You can't share this strategy here"; others keep "try again"; polite `LiveRegion` mounted outside the Modal. Dialog has its own `Copy link` (no fetch), `setSelectionRange(0, len)`, published lane opens a `Public link` dialog with the URL and without `OwnerUnpublishedPanel`; `FactsheetView.mintAndCopy` goes through the one shared `copyTextBounded`. 12 neuters RED, all restored cmp 0 (see spot-check table). |
| SC-4 | Each fix carries a test that goes RED when reverted; D-11 carve-out (no neuter-RED claimed for D05-RED) | VERIFIED | Every D-12 item has an arm that failed under a neuter (table below). D-11: file-level `beforeAll` warm-up of `FactsheetView` (`ShareableLink.test.tsx:121`), 5 explicit `{ timeout: 5000 }` awaits, no change to `vitest.config.ts`/`package.json`/`scripts` since the base (empty diffstat); file re-run here: 53/53 pass. 208-04-SUMMARY records 3 quiet + 3 loaded green runs, `left: 0`. No neuter-RED is claimed for it, consistent with the carve-out. |
| D-16 | Both share routes build the URL from the CSRF-validated request origin ahead of `NEXT_PUBLIC_APP_URL`; localhost literal last | VERIFIED (literal D-16), see WR-01 | Both `resolveAppUrl(req)` read `Origin ?? Referer` first, then `NEXT_PUBLIC_APP_URL`, then the localhost literal. Strategies route calls `assertSameOrigin` at step (1); scenario route reaches it through `withAllocatorAuth` -> `withAuth` (no second call, `csrf.ts` untouched, new real-chain test `route.csrf-integration.test.ts` pins forged-origin and header-less 403 and the preview-host 200). `NEXT_PUBLIC_APP_URL` and other readers unchanged. Neuter: env-first restored in each route -> D-16 arms RED in both, restored cmp 0. |

**Score:** 5/5 contract truths verified. Two plan-04 truths tagged `verification: backstop` are `insufficient_spec` and listed under Human Verification Required.

### WR-01 classification (explicit)

WR-01 is NOT classified as a failure of any success criterion and is NOT a gap. SC-1..SC-4 are untouched by it. D-16 as literally decided ("build the share URL from the CSRF-validated request origin, ahead of `NEXT_PUBLIC_APP_URL`; test: minting on a non-production host returns that host") is met and tested. WR-01 describes a consequence D-16's text did not account for: production's own per-deployment `NEXT_PUBLIC_VERCEL_URL` host (and any `NEXT_PUBLIC_ALLOWED_ORIGINS` host) is allow-listed by `src/lib/csrf.ts` and not covered by the `next.config.ts` 308, so a mint made there returns a link pinned to that host. I confirmed in the code that this is as the review describes (route comments at `strategies/[id]/share/route.ts:93-98` now name it as an open point; the false claim was already corrected in `a2b2a421f`). Because the orchestrator marked it merge-blocking and no safe agent default exists, it is carried as a human decision item and drives the `human_needed` status. If the founder picks option A, record it in CONTEXT D-16 and the ROADMAP, and the status can move to `passed` with no code change.

### Behavioral Spot-Checks

Full `npm test` under Node 22 at this SHA (supplied evidence): 1239 files passed, 26132 tests passed, exit 0. Targeted re-run by the verifier: 14 files, 243 tests passed. Neuter spot-checks (byte backup in the scratchpad with prefix `208-verify-`, `cp -p` restore, `cmp` exit 0 every time, `git status --short` clean afterwards):

| D-12 item | Neuter | Result |
|-----------|--------|--------|
| digest wording | label back to "View in dashboard →" | RED (D-01 arm) |
| browse helper throws | `if (error) return []` | RED (throws-and-captures arm) |
| browse error state | catch sets `"empty"` | RED (error block arm) |
| browse empty state | empty block disabled | RED (2 arms) |
| D-14 | line removed | RED (D-14 arm) |
| mint log | `console.warn` removed | RED (9 arms) |
| 404 wording | 404 mapped to retryable | RED |
| 401 wording | 401 branch removed | RED (401 and D-13 arms) |
| D-13 redirect | `res.redirected` branch disabled | RED |
| live region | row `LiveRegion` removed | RED (11 arms) |
| clipboard catch log | `console.warn` -> `console.log` | RED |
| execCommand catch log | same | RED (2 arms) |
| dialog host (D-15) | open-dialog lookup removed | RED |
| dialog Copy link makes no fetch | a `fetch` injected before the copy | RED |
| published lane shows URL | `setDialogUrl` skipped when published | RED |
| no owner panel on published | `!published` guard removed | RED |
| D-09 reselect | `setSelectionRange` removed | RED (2 arms) |
| dialog live region | message set to null | RED |
| hanging copy ends failed (dialog + factsheet) | bound raised to 1 hour | RED (4 arms) |
| factsheet `mintAndCopy` bounded | helper call reverted to bare `writeText` | RED |
| published lane synchronous | an `await` before the copy | RED |
| D-16 strategies route | env-first restored | RED (2 arms) |
| D-16 scenario route | env-first restored | RED (real-chain arm (iii) and T_SH5) |

### Requirements Coverage

`.planning/REQUIREMENTS.md` does not map phase 208 (ROADMAP: `Requirements: TBD`); no plan declares requirement IDs. Nothing orphaned. The phase closes TODOS ids (`195-ALERT-DIGEST-LINK-TARGET`, `195-BROWSE-EMPTY-VS-ERROR`, `170.6.1-SFH2-SHARE-FAILURES-UNLOGGED`, `170.6.1-R2-DIALOG-COPY-BUTTON`, `170.6.1-R2-IOS-SELECT`, `170.6.1-SFH2-PUBLISHED-LANE-NO-URL`, `170.6.2-SHAREABLELINK-D05-RED`, `SHARE-HOST-01`); the TODOS deletion is a release-commit step, not part of this verification. The D-16 ROADMAP criterion arrives via the separate records PR, as the CONTEXT says; it was verified here against CONTEXT D-16.

### Anti-Patterns Found

Debt-marker grep (`TODO|FIXME|TBD|XXX`) over the 16 changed source files: only the literal word "TODOS" inside comments citing ledger ids, no debt markers. No stubs: no empty handlers, no hardcoded-empty render data; browse `categories` is filled from the read, and every ShareableLink state is driven by real mint or clipboard outcomes. Probes: the phase declares none (Step 7c skipped).

Non-blocking review leftovers, recorded not gaps: IN-01 (scheme not validated, only reachable by a non-browser caller with its own session), IN-02 (feedback timers never cleared), IN-03; all LOW per the project rule "never fix LOW/INFO".

### Founder resolution (2026-11-14)

- **WR-01: "Accept and record" (option A).** The per-deployment-host case is accepted: a share link minted on production's own `NEXT_PUBLIC_VERCEL_URL` host, or on an extra `NEXT_PUBLIC_ALLOWED_ORIGINS` host, comes back on that host. Options B and C were not taken, so the code is unchanged. Recorded in `208-CONTEXT.md` D-16 and in ROADMAP Phase 208 SC-5.
- **D-09 WebKit reading: "Accept the simulation."** The Playwright WebKit iPhone 15 reading in `208-04-SUMMARY.md` stands. Its limit stays recorded: it is WebKit with an iPhone profile, not iOS Safari on a device.
- Status moved `human_needed` -> `passed` on these two answers, with no code change.

### Human Verification (resolved 2026-11-14, see Founder resolution)

1. **WR-01 founder decision.** Choose A, B or C from `208-REVIEW.md` "Orchestrator disposition". Why human: no safe agent default; the reviewer's fix would undo the motivating SHARE-HOST-01 case.
2. **D-09 WebKit reading (two backstop truths).** Accept the recorded Playwright WebKit iPhone 15 reading in `208-04-SUMMARY.md`, or re-run it (or check an iPhone). Why human: one-off by design, harness deleted, not reproducible by the verifier, and WebKit-with-iPhone-profile is not iOS Safari (SUMMARY states this limit itself).

### Gaps Summary

No gaps against any success criterion. All four ROADMAP criteria and D-16 are implemented, wired and covered by tests that fail when the fix is reverted. The status is `human_needed` solely for the two items above.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
