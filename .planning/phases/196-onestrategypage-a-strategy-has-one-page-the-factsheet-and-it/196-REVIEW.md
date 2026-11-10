---
phase: 196-onestrategypage
reviewed: 2026-11-09T10:08:09Z
depth: standard
files_reviewed: 62
files_reviewed_list:
  - next.config.ts
  - src/lib/factsheet/origin.ts
  - src/lib/factsheet/viewer.ts
  - src/lib/factsheet/peer-ranks.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/routing/route-contract-manifest.ts
  - src/lib/queries.ts
  - src/lib/types.ts
  - src/components/factsheet/BackLink.tsx
  - src/components/factsheet/ViewerBar.tsx
  - src/components/factsheet/VisitorHeader.tsx
  - src/components/strategy/RequestIntroButton.tsx
  - src/components/strategy/PeerRanksSection.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/components/ui/Button.tsx
  - src/components/ui/PrintButton.tsx
  - src/components/admin/AdminTabs.tsx
  - src/components/landing/VerificationResults.tsx
  - src/components/portfolio/PortfolioOptimizer.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/AdvancedDisclosure.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/HistogramChart.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/MasterBrush.tsx
  - src/app/factsheet/[id]/v2/chart-hint.tsx
  - src/app/factsheet/[id]/v2/error.tsx
  - src/app/factsheet/[id]/v2/loading.tsx
  - src/app/factsheet/[id]/v2/not-found.tsx
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/app/factsheet-share/[token]/page.tsx
  - src/app/api/factsheet/[id]/pdf/route.ts
  - src/app/browse/layout.tsx
  - src/app/browse/page.tsx
  - src/app/browse/[slug]/page.tsx
  - src/app/browse/session.ts
  - src/app/browse/BrowseDiscoveryLink.tsx
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
  - src/app/(dashboard)/allocations/lib/add-allocation.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/WatchlistPanel.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx
  - src/app/(dashboard)/admin/csv-status/page.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - scripts/factsheet-census/count.ts
  - scripts/factsheet-census/run.ts
  - .github/workflows/ci.yml
  - src/__tests__/contracts/spec-disabling.invariant.test.ts
  - src/__tests__/strategy-route-redirects.test.ts
  - src/app/(dashboard)/allocations/lib/add-allocation.test.ts
  - src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx
  - src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx
findings:
  critical: 1
  warning: 3
  info: 0
  total: 4
status: issues_found
---

# Phase 196: Code Review Report

**Reviewed:** 2026-11-09T10:08:09Z
**Depth:** standard, with call chains traced across modules where the brief asked for it
**Files Reviewed:** 62 surviving non-test source files changed, plus the tests that pin the risk areas
**Status:** issues_found

## Summary

Diff reviewed: `46ec9945..b3f72251`, excluding `.planning`. I read the four retired routes' redirects, the origin and back-link contract, the factsheet page's session and viewer reads and their relation to the cached payload, the share-token session read, the tearsheet rebuild, the PDF route's Advanced step, published-only indexing, the per-request peer ranks, the `?add=` deep link and its own-capital test, `/browse` session awareness, and the deletion sweep.

The scope was MEDIUM and above. I found one HIGH and three MEDIUMs, listed below.

Checked and clean:
- **Origin parsing.** The closed set uses own-property lookups, so `__proto__`, `constructor` and `toString` give no origin. A repeated `from` is rejected. `cat` is checked against `DISCOVERY_CATEGORIES`. No raw query value reaches an href, so the back link has no open redirect.
- **Cache isolation.** `buildFactsheetPayloadCached` takes the same arguments as before. The viewer, peer ranks, AUM and note card are all applied after the cache read and never written back into the cached object.
- **Share-token route.** The session read happens after the HMAC match and the 410 paths. It returns one boolean, and that boolean only picks the header chrome. The "Print view" link is guarded by `!recipientShare`.
- **Tearsheet.** The `investor_attestations` gate on `ManagerIdentityPanel` is kept as it was.
- **Deletion sweep.** No dangling imports, `vi.mock` targets or file-reading tests point at deleted modules. The remaining `strategy-v2/` imports are `SegmentedControl` and `PartialDataBanner`, which still exist.
- **Next.js behaviour.** Redirects pass incoming query values through to the destination (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md:43`). `buttonClassName` is exported from a non-`"use client"` module, so server components can call it.
- **Targeted tests.** These 5 files pass, 144 tests: `origin.test.ts`, `viewer.test.ts`, `peer-ranks.test.ts`, `strategy-route-redirects.test.ts`, `add-allocation.test.ts`.

Below the threshold, so not filed:
- A signed-out reader arriving from `/browse` loses the old category breadcrumb. The visitor header has no link back into `/browse`.
- The "Go to Discovery" fallback sends a manager-only user to a route that redirects them away.
- `RequestIntroButton` can stay disabled if `checkExisting` throws. This was already true before the phase.

## Critical Issues

### CR-01 (HIGH): "Request intro" and "Add to my allocation" now skip the accredited-investor attestation gate

**Files:** `src/lib/factsheet/viewer.ts:46-61`, `src/components/factsheet/ViewerBar.tsx:44-54`, `src/app/api/intro/route.ts:86-106`
**Category:** security/compliance, user-facing

**Issue:** Before this phase, `RequestIntroButton` was mounted only in `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`:

```
$ git grep -n "RequestIntroButton\b" 46ec9945 -- src | grep -v test | grep -v RequestIntroButton.tsx
46ec9945:src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:169: ...
46ec9945:src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:202: ...
```

That page sat behind `src/app/(dashboard)/discovery/layout.tsx`. The layout renders `AccreditedInvestorGate` in place of the page unless the user has an `investor_attestations` row, and it fails closed ("Compliance default is 'blocked'"). The old factsheet had no intro action at all: its only contact link was `contactHref({ topic: "support" })`.

After this phase the button is mounted on the public `/factsheet/[id]`, inside `ViewerBar`. It shows whenever `viewer.canAllocate` is true, and `canAllocate` checks only `profiles.role` and `isProfileApproved`:

```ts
canAllocate =
  isProfileApproved(data as Parameters<typeof isProfileApproved>[0]) &&
  (role === "allocator" || role === "both");
```

`/api/intro` does not check attestation either; it checks approval and role only. An approved allocator who never signed the accreditation attestation can now request an introduction to any published strategy's manager from the factsheet. The same user can also reach the factsheet through the old `/discovery/<slug>/<id>` URLs, which the 308 now sends to the factsheet instead of the gate. `196-RESEARCH.md` covers the attestation gate only for the tearsheet's `ManagerIdentityPanel`. No CONTEXT decision says the intro action should drop the gate.

**Fix:** Add attestation to the affordance in `resolveFactsheetViewer`: read `investor_attestations.attested_at` for `user.id` beside the profile read, fail closed, and require it for `canAllocate`. Better, enforce it on the server in `/api/intro` as well, so the UI is not the only gate. If the founder wants unattested allocators to request intros, record that as a decision in CONTEXT/ROADMAP instead.

## Warnings

### WR-01 (MEDIUM): A published factsheet whose payload is pending renders no header at all

**File:** `src/app/factsheet/[id]/v2/page.tsx:763-775`
**Category:** user-facing

**Issue:** The fallback that renders when `payload` is null only builds viewer chrome on the owner lane:

```ts
const pendingViewer =
  lane === "owner"
    ? await resolveFactsheetViewer(supabase as unknown as SupabaseClient, sessionUser ?? null, signature.user_id)
    : null;
return (
  <>
  {pendingViewer?.kind === "signed_in" && (
    <ViewerBar backTarget={backTarget} viewer={pendingViewer} strategyId={signature.id} />
  )}
```

On the published lane, `payload` can be null when the payload is not buildable or after a transient `FactsheetReadError` (`publicReadFailed`). In that case nobody gets a header:
- A signed-in reader who came through `/discovery/<slug>/<id>` or a list link carrying `from=` has no named back link (D-01, SC-3).
- The owner of a published strategy has no "Edit strategy".
- A reader with no session gets no visitor header, although UI-SPEC's Viewer-State Matrix row 172 says such a reader gets the visitor header on `/factsheet/[id]`.

The page already resolves `backTarget` at the top, and then drops it on this path.

**Fix:** On the pending path, read the session the same way the published render does, then render `ViewerBar` for a signed-in viewer on either lane, or `VisitorHeader showSignUp` for a reader with no session:
```ts
if (sessionUser === undefined) { /* same guarded getUser as the published render */ }
const pendingViewer = await resolveFactsheetViewer(supabase as unknown as SupabaseClient, sessionUser, signature.user_id);
// render: pendingViewer.kind === "signed_in" ? <ViewerBar …/> : <VisitorHeader showSignUp />
```

### WR-02 (MEDIUM): The newly indexable factsheet has no canonical URL, so the redirects create duplicate indexed URLs

**Files:** `src/app/factsheet/[id]/v2/page.tsx:345-354`, `next.config.ts:239-252`, `src/app/factsheet/[id]/page.tsx`
**Category:** user-facing (search; this is what D-07 is for)

**Issue:** D-07 drops `noindex` on the published lane so that the 308s from indexed `/browse/[slug]/[strategyId]` and `/strategy/[id]` land on an indexable page. But:
- The redirect destinations are query URLs (`/factsheet/:strategyId?from=browse&cat=:slug`, and the same with `from=discovery`).
- The published "Copy share link" hands out `/factsheet/[id]?share=1` (UI-SPEC line 180).
- `/factsheet/[id]/v2` still renders the same page, through the same `generateMetadata`.

`generateMetadata` sets no `alternates.canonical`, and nothing else in the app sets one for this route (`grep -rln "canonical\|metadataBase" src/app` finds only `(marketing)` pages and comments). One strategy is therefore indexable under at least four URLs: bare, `?from=browse&cat=…`, `?share=1` and `/v2`. Search engines will see the old browse URL's replacement as `?from=browse&cat=<slug>`, an origin parameter that exists only to drive the back link.

**Fix:** In the published branch of `generateMetadata`, add `alternates: { canonical: \`/factsheet/${id}\` }`. Set a `metadataBase`, or use an absolute URL, so it resolves. Keep `noindex` on the other lanes as they are now. Optionally add a `/factsheet/:id/v2` to `/factsheet/:id` redirect.

### WR-03 (MEDIUM): The PDF route's new waits can run past `maxDuration`, so its own 503 path never fires

**File:** `src/app/api/factsheet/[id]/pdf/route.ts:16`, `:318`, `:334-365`
**Category:** user-facing (the founder's LP report)

**Issue:** The function is capped at `export const maxDuration = 30`. Inside that cap it can already spend up to 15 s waiting for the queue (`QUEUE_TIMEOUT_MS = 15_000`, `src/lib/puppeteer.ts:36`), then launch Chromium, then `page.goto(..., { timeout: 25000 })`. Phase 196 adds two more waits before `page.pdf()`: `waitForSelector("[data-advanced-contents]", { timeout: 10_000 })` and `waitForNetworkIdle({ idleTime: 500, timeout: 10_000 })`. That is up to 20 s more.

The new `AdvancedOpenError` branch is meant to answer 503 with `Retry-After` and report to Sentry instead of shipping a short report (T-196-32). It is only reachable if the function is still alive when a 10 s timeout expires. In the slow case it exists for (a cold or slow `goto`, then heavy Advanced charts), the platform kills the function first. The caller gets a platform timeout with no Sentry event and no `Retry-After`. The unit test mocks every wait as instant, so it cannot catch this.

**Fix:** Budget the waits against the deadline instead of using fixed 10 s timeouts. Take `const deadline = start + (maxDuration - 3) * 1000` and pass `timeout: Math.max(0, deadline - Date.now())` to both waits. Then the 503 branch fires inside the function's lifetime. Alternatively, raise `maxDuration` to cover queue + goto + Advanced + pdf, if the plan allows it.

---

_Reviewed: 2026-11-09T10:08:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (round 1, pr-review-toolkit:silent-failure-hunter) — appended by the orchestrator

### SF-01 (MEDIUM, user-facing): a failed session read shows a signed-in viewer the anonymous chrome, unreported
Sites: `src/app/factsheet/[id]/v2/page.tsx` (published-lane `getUser()` result: an `error` is dropped silently; the throw path only `console.error`s), `src/app/factsheet-share/[token]/page.tsx` `readRecipientSession` (bare `catch {}`, ignores returned `error`), `src/app/browse/session.ts` `hasBrowseSession` (bare `catch {}`). An approved allocator on an auth blip gets Sign up / no viewer bar with no Sentry signal. Fix: `captureToSentry` when `error` is set and is not `AuthSessionMissingError`; replace bare catches with capture + `return false`. Keep the fail-to-anonymous direction.

### SF-02 (MEDIUM, user-facing, LP report): the PDF route ships a short/wrong PDF on "absent", and ignores the goto status (overlaps WR-03)
Site: `src/app/api/factsheet/[id]/pdf/route.ts`. `advanced === "absent"` skips the guard, but "absent" is also the result for a pending article, a not-found or error render. `page.goto` response is discarded (the sibling tearsheet.pdf route checks `response.status() >= 400`). The result is cached `public, s-maxage=3600`. Fix: check the goto response status; treat "absent" as OK only when a positive factsheet marker is present; share one deadline across the waits (see WR-03).

### SF-03 (MEDIUM, user-facing): `RequestIntroButton` can stay disabled forever, now with a normal-looking label
Site: `src/components/strategy/RequestIntroButton.tsx` `checkExisting` (no try/catch; a throw leaves `uiState` "checking" and the button disabled; a returned `error` on the `contact_requests` read is ignored; the 409 branch hard-codes "pending"). The phase put this button on the public factsheet for every approved allocator and replaced the "..." label with a static one. Fix: try/catch with capture, fall back to "idle" (the server 409 is the backstop); surface the real status on 409 only if the response carries it, otherwise keep the existing copy.

### SF-04 (MEDIUM, user-facing): the tear sheet answers every no-payload reason with 404
Site: `src/app/factsheet/[id]/tearsheet/page.tsx` (`if (!builtPayload) notFound()`). `fetchAndBuildPayload` collapses read_error / not_computed / composite_unbuildable / too_few_points / malformed_series into null; the v2 page uses `fetchAndBuildPayloadWithReason`. A DB blip or a recompute window 404s a published strategy's tear sheet. Fix: use the reason-bearing builder; 404 only for not-visible, otherwise a retryable or pending render. (Closes TODOS `196-TEARSHEET-NONTERMINAL-404-01`.)

### SF-05 (MEDIUM, user-facing): the error / loading / not-found boundaries do not cover the canonical `/factsheet/[id]`
Sites: `src/app/factsheet/[id]/v2/error.tsx`, `loading.tsx`, `not-found.tsx` live under `v2/` only; `src/app/factsheet/[id]/page.tsx` re-exports the v2 page with no boundaries beside it, and every retired route now 308s there. Also `reset()` does not re-fetch a server-component throw (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`); the retired `/strategy/[id]/error.tsx` used `unstable_retry`. Fix: boundaries at `src/app/factsheet/[id]/` (the `/v2` alias keeps working), using the retry the docs specify.

---

## Fix round 1A (topic A: factsheet viewer, chrome, routing) — gsd-code-fixer

Scope: CR-01, WR-01, WR-02, SF-01, SF-05. WR-03 and SF-02..SF-04 are left to the next fixer (PDF route, tear sheet page, `RequestIntroButton` untouched). One commit per finding. No Co-Authored-By trailer, no CI-skip token.

| Finding | Status | Commit |
|---|---|---|
| CR-01 | fixed: requires human verification (security gate; founder may still prefer unattested allocators to request intros, which would be a recorded decision) | `773eae155` |
| WR-01 | fixed | `5ed20ddad` |
| WR-02 | fixed (closes TODOS `196-CANONICAL-LINK-01`, dated sub-bullet added, original kept) | `49fd2f3a4` |
| SF-01 | fixed | `93129176c` |
| SF-05 | fixed | `c74825fbd` |

### CR-01
- `resolveFactsheetViewer` (`src/lib/factsheet/viewer.ts`) now reads `investor_attestations.attested_at` for the viewer after the profile read says "approved allocator or both", and `canAllocate` needs a non-null `attested_at`. A missing row, a null `attested_at`, a returned error (captured, tag `stage: "attestation-read"`) and a thrown read all leave `canAllocate: false`. The owner short-circuit is unchanged (no reads).
- `/api/intro` (`src/app/api/intro/route.ts`) runs the same read right after the role check and before the body parse, fail closed, answering 403 `{ error: "Accredited investor attestation required" }` (the route's existing refusal shape). Read errors are captured (`area: "api-intro"`).
- Tests (red first): `viewer.test.ts` (4 new arms plus owner-no-read), `route.test.ts` (4 refusal arms: no row, null `attested_at`, error, throw; each asserts 403, no `contact_requests` insert, no audit; plus an attested allocator still gets 200), `page.viewer-chrome.test.tsx` (the harness gained an `investor_attestations` table, default attested; 2 new arms: no row and failed read give the back link and no actions).
- RED evidence: before the fix, 4 viewer arms failed; 4 route arms failed. After the fix, neutered (`canAllocate = true` in viewer.ts, `if (false)` in route.ts) from a `cp` backup: 6 arms RED (`an approved allocator with no attestation row cannot allocate`, `... a row with a null attested_at ...`, and the four `returns 403 ... on <reason>` arms), plus the page arm `an approved allocator with no attestation row gets the back link and no actions`. Restored with `cp`, `cmp` clean, GREEN (33 tests).

### WR-01
- The published lane's pending render now reads the session through one local `readViewerSession` (shared with the full render, so there is still at most one `getUser()` per render, after the lane decision) and renders `ViewerBar` for a signed-in reader on either lane or `VisitorHeader showSignUp` otherwise.
- Tests: four new arms in `page.viewer-chrome.test.tsx` (signed-in reader from Discovery gets the named back link and actions; published owner gets Edit strategy; no-session reader gets the visitor header outside the single `<main>`; lane order: published probe first, one `getUser`).
- RED evidence: before the fix 4 arms failed. Neuter 1 (`if (false)` in place of the session read on the pending path): 3 arms RED (named back link, Edit strategy, lane-order). Neuter 2 (visitor header replaced by `null`): the no-session arm RED. Restored by `cp`, `cmp` clean, GREEN (37).

### WR-02
- `generateMetadata`, published branch only: `alternates.canonical = ${NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/factsheet/<encoded id>`. The repo sets no `metadataBase` (the marketing pages use a relative canonical and rely on Next's default base, which on Vercel can resolve to the `vercel.app` alias the 2026-09-27 note in `next.config.ts` warns about), so the URL is absolute on the origin the build asserts as canonical. The probe-miss and probe-error branches keep `noindex` and carry no `alternates`. No `/v2` redirect added (the canonical covers the alias).
- Tests: `page.metadata.test.tsx` (published gets the absolute bare URL; miss and error carry none). RED: before the fix 1 arm failed; neutered (canonical set to `/factsheet/<id>/v2`) the arm is RED; restored by `cp`, `cmp`, GREEN (9).

### SF-01
- `captureToSentry` when `getUser()` returns an error that is not `AuthSessionMissingError` (`isAuthSessionMissingError` from `@supabase/supabase-js`) and in the catch, at the three sites: `src/app/factsheet/[id]/v2/page.tsx` (`readViewerSession`, area `factsheet-viewer-session`), `src/app/factsheet-share/[token]/page.tsx` `readRecipientSession` (`factsheet-share-session`), `src/app/browse/session.ts` `hasBrowseSession` (`browse-session`). The fall-to-anonymous direction is unchanged. The Lane B `getUser()` at the owner probe (not one of the three named sites) still drops `error`; left as is.
- Tests: three arms each in `layout.session.test.tsx`, the share `page.test.tsx` and `page.viewer-chrome.test.tsx` (error captured, rejection captured, `AuthSessionMissingError` not captured). Two harness fixes: `page.public-cache-key.test.tsx` and `page.composite-read-error.test.tsx` built a request client with no `auth`, so their (silently swallowed) `getUser()` TypeError is now a capture and broke their capture counts; both clients now answer anonymous.
- RED evidence: before the fix 6 arms failed. Neutered (all three capture calls turned into `void (...)`): the same 6 arms RED. Restored by `cp`, `cmp` clean, GREEN (103).

### SF-05
- `error.tsx`, `loading.tsx` and `not-found.tsx` moved with `git mv` from `src/app/factsheet/[id]/v2/` to `src/app/factsheet/[id]/`. Segment boundaries wrap every child segment, so the canonical route and the `/v2` alias are both covered and no copies under `v2/` are needed. One `<main>` per state kept (the plan 19 arm now imports `../not-found`, `../error`, `../loading`).
- The installed Next is 16.4.2 and its `error.md` specifies `retry()` (stable in 16.3.0; `unstable_retry` was 16.2.0). The boundary takes `retry` and the button calls it; `reset` is not used. The boundary also reports to Sentry (`area: "factsheet-error-boundary"`), because the canonical route used to fall through to the root `error.tsx`, which captures, and the nearer boundary would otherwise swallow it. Digest only on screen.
- Tests: new `src/app/factsheet/[id]/boundaries.test.tsx` (retry called and reset not, one main with digest only and no thrown message, Sentry capture). RED: before the move the import failed; neutered (button calls `reset`, capture removed) 2 arms RED; restored by `cp`, `cmp`, GREEN.
- Side effect to know: the boundaries now also wrap `/factsheet/[id]/tearsheet` (no boundaries of its own before), including the loading skeleton and the not-found card.

### Gates
`npx tsc --noEmit` clean; `npm run lint` 0 errors (4 pre-existing warnings, none in touched files); `npx vitest run src/__tests__ src/app src/lib/factsheet src/components`: 17958 passed, 276 skipped, 2 failed. The 2 failures are `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (frozen snapshot mismatch); nothing in this round touches `compute.ts` or its tests, so they are not caused by these commits (not bisected against the pre-round base; disk is tight).

### Found, not fixed (out of topic)
- The repo's other error boundaries (`src/app/error.tsx`, `(auth)`, `(dashboard)`, `strategies`, `allocations`, `compare`, `admin`, the wizard) still take `unstable_retry`. The installed Next 16.4.2 passes `{ error, reset, retry }` and its `error-boundary.js` has no `unstable_retry`, so their Try again buttons would throw `unstable_retry is not a function`. Needs its own fix across those boundaries and their tests.
- Lane B's `getUser()` in `v2/page.tsx` (owner probe) also ignores a returned error.

---

## Fix round 1B (topic B: LP report PDF route, tear sheet, Request intro button) — gsd-code-fixer

Scope: WR-03, SF-02, SF-03, SF-04. One commit per finding (WR-03 and SF-02 share the one route and one commit). No Co-Authored-By trailer, no CI-skip token. Topic A is untouched.

| Finding | Status | Commit |
|---|---|---|
| WR-03 | fixed (deadline arithmetic fits; `maxDuration` NOT raised) | `6b4453654` |
| SF-02 | fixed | `6b4453654` |
| SF-04 | fixed (closes TODOS `196-TEARSHEET-NONTERMINAL-404-01`, dated sub-bullet added, original kept) | `927e31e77` |
| SF-03 | fixed (the 409 half is conditional on a body field the server does not send today, see below) | `d1ffa5371` |

### WR-03 + SF-02 (`src/app/api/factsheet/[id]/pdf/route.ts`)
- Deadline: `deadline = Date.now() + (maxDuration - 3) * 1000` taken at the top of `GET`; `timeLeft() = Math.max(1, deadline - Date.now())`. Chosen over raising `maxDuration`: the budget now fits inside 30 s by construction (27 s to the point where the 503 + Sentry path must already have run, 3 s reserve for the response and the browser close). The cost is that a genuinely slow render now answers the designed 503 earlier instead of being killed by the platform. The floor is 1 ms, not the reviewer's 0, because puppeteer reads a timeout of 0 as "no timeout".
- Both Advanced waits use `timeout: timeLeft()`. `page.goto` is capped at `Math.min(25_000, timeLeft())`, because after a long queue wait its fixed 25 s alone could outlive the function (that path is the route's existing 500 + Sentry).
- Status: `page.goto`'s response is checked like the sibling tearsheet route: a missing response or status >= 400 throws into the existing catch (500 `{ error: "PDF generation failed" }` plus Sentry), never a PDF.
- Positive marker: the open-step page function returns `"absent"` only when `#factsheet-advanced` is missing AND `#factsheet-main` (the `id` on the rendered factsheet's `<article>` in `FactsheetView.tsx`; the pending, error, not-found and loading renders do not carry it) exists. Otherwise it returns `"no-factsheet"`, which throws `AdvancedOpenError`: the existing 503 `Retry-After` `no-store` Sentry path (`step: advanced_open`). The check is `=== "no-factsheet"` and not a whitelist, so the other route tests' `evaluate` stubs are unaffected.
- Tests (`route.test.ts`): `goto` mocks now resolve `{ status: () => 200 }`; the document stub in the Advanced describe gained the `factsheet-main` marker. New arms: absent plus no marker gives 503 and Sentry; goto 404 and 500 give the 500 JSON shape, Sentry, no PDF; a null navigation response is refused; with `Date` faked, a goto that spends 20 s leaves both waits exactly `(maxDuration - 3) * 1000 - 20_000`; an exhausted budget gives a 1 ms timeout, never 0.
- RED evidence (backup in the scratchpad, neuter, RED, `cp` restore, `cmp` clean, GREEN 38/38 each time): status check turned into `if (false)` -> 3 arms RED (goto 404, goto 500, null response). Marker check replaced by `return "absent"` -> 1 arm RED (`Advanced absent AND no factsheet article ...: 503`). Both waits back to a fixed `10_000` and goto back to `25_000` -> 2 arms RED (`a slow goto leaves the Advanced waits only what is left ...` and `a navigation timeout is capped by the deadline too ...`).

### SF-04 (`src/app/factsheet/[id]/tearsheet/page.tsx`)
- Now `fetchAndBuildPayloadWithReason(id, withPublishedOnly)`. `reason === "not_visible"` is the only `notFound()`; `read_error` throws `new Error("tearsheet payload read failed")` to the error boundary SF-05 put above it (the resolve stage already reported the read once); every other reason (`not_computed`, `composite_unbuildable`, `too_few_points`, `malformed_series`) renders a pending `<main data-testid="tearsheet-pending">` with the display name, the factsheet's own `KCS10_PUBLIC_SENTENCE` ("The detailed factsheet for this strategy is not available yet.", no new copy) and the existing "Back to factsheet" link. No opening view and no figure is mounted.
- Tests: the four tearsheet page tests moved their builder mock to `fetchAndBuildPayloadWithReason` (`{ payload, reason: null }`); `page.test.tsx` gained arms for each non-terminal reason (pending, no 404, no view), `read_error` (throws, no 404) and `not_visible` (404); `page.stale-analytics.test.tsx` T1 and T5 (a `failed` and a `computing` run, real builder through the real page) now assert the pending state with no view and no leaked figure instead of the 404.
- RED evidence (backup, neuter, `cp` restore, `cmp` clean, GREEN 48/48): `notFound()` for every null payload -> 7 arms RED (the four reasons, `read_error`, T1, T5). `read_error` swallowed into the pending page -> 1 arm RED (`a failed read is thrown to the error boundary`).
- TODOS `196-TEARSHEET-NONTERMINAL-404-01`: dated closure sub-bullet added under it. It also records one residual: `/api/factsheet/[id]/tearsheet.pdf` gates on the status only, so for a strategy whose status is complete but whose payload cannot build (composite_unbuildable, too_few_points, malformed_series) it now prints the pending page as a 200 PDF cached for `s-maxage`, where it used to answer 500. No figure leaks. Not fixed here (out of the named scope); a marker check like SF-02's in that route would close it.

### SF-03 (`src/components/strategy/RequestIntroButton.tsx`)
- `checkExisting` is wrapped in try/catch: a throw (auth read or otherwise) and a returned `contact_requests` read error (thrown as an `Error` carrying the message) both go to `captureToSentry` (tag `area: request-intro-existing-check`, level warning) and fall back to `idle`, so the button enables; the server 409 stays the duplicate backstop.
- 409 branch: it reads the body and shows the real status only when `body.status` is an own key of `STATUS_MESSAGES` (`Object.hasOwn`, so `"toString"` does not pass); otherwise "pending" as before. The server's 409 body today is `{ error: "Already requested" }` and carries no status, so this changes no behaviour until the server sends one; I did not touch `/api/intro` (out of scope). The non-JSON 5xx message is unchanged.
- Tests (`RequestIntroButton.test.tsx`): thrown read enables the button and reports; returned read error does the same; a clean read reports nothing; a 409 carrying `intro_made` shows "Introduction in progress"; a 409 with an unknown status keeps "Pending review".
- RED evidence (backup, neuter, `cp` restore, `cmp` clean, GREEN 16/16): catch body reduced to nothing -> 2 arms RED (thrown read, returned read error; the button stays disabled). `if (readError) throw` removed -> 1 arm RED. 409 hard-coded to "pending" -> 1 arm RED.

### Gates
`npx tsc --noEmit` clean; `npm run lint` 0 errors (the same 4 pre-existing warnings, none in touched files) and the planning-hygiene checks OK; `npx vitest run src/__tests__ src/app src/lib/factsheet src/components`: 17974 passed, 276 skipped, 2 failed. The 2 failures are the known `src/lib/factsheet/compute.conventions.test.ts` fixture snapshot skew (Node 25 local vs Node 22 CI), untouched by this round. No build and no Playwright were run (disk).

### Found, not fixed (out of topic)
- The tearsheet.pdf residual above (booked in the TODOS closure bullet, no new entry).
- `/api/intro` 409 does not return the existing request's status, so the client's "real status" branch is dormant until it does.

---

## Re-review round 2 (gsd-code-reviewer)

**Reviewed:** 2026-11-09, diff `b3f72251..d1ffa537` excluding `.planning` (8 fix commits, 27 files). Scope is MEDIUM and above. Next.js 16.4.2 behaviour was checked against `node_modules/next/dist/docs/` and `node_modules/next/dist/client/components/error-boundary.js`. **Targeted vitest:** 14 files, 269 tests, all pass. They cover viewer, intro route, boundaries, the tearsheet suite, both PDF routes, RequestIntroButton, viewer-chrome, metadata, browse session and the share page. No build, no Playwright, no full suite (disk at 99%).

### Round-1 findings: status

| Finding | Fixed at root? | Notes |
|---|---|---|
| CR-01 | yes | `resolveFactsheetViewer` and `/api/intro` both read `investor_attestations.attested_at` for `user.id`. A missing row, a null `attested_at`, a returned error and a throw all refuse. This is the predicate `(dashboard)/discovery/layout.tsx:47-66` applies. The viewer is stricter, because it also needs `isProfileApproved`, as `/api/intro` already did. The owner short-circuit does no reads. The new test arms assert `canAllocate: false` / 403 and no insert, so they fail if the gate is removed. See R2-02 for the gate's reach beyond the factsheet. |
| WR-01 | yes | The pending path reads the session once, after the lane decision, and renders `ViewerBar` or `VisitorHeader` on both lanes. |
| WR-02 | yes | An absolute canonical on the published branch only. It uses the same `NEXT_PUBLIC_APP_URL ?? localhost` pattern as the PDF routes, and `assertCanonicalAppUrl` guards it on production builds. |
| WR-03 | yes for the stated defect | The 503 + Sentry path now fires inside `maxDuration`. Below threshold: `page.pdf()` is not budgeted. If the waits succeed close to the deadline, the PDF step can still outlive the function. That was already possible before (goto 25 s plus queue 15 s) and is not new. |
| SF-01 | yes | All three sites capture any error except `AuthSessionMissingError`, and still fall back to anonymous. |
| SF-02 | yes, but the marker does all the work; the status check rarely can | See R2-01. With `loading.tsx` now above `/factsheet/[id]`, an in-page `notFound()` or throw answers **200**, so `response.status() >= 400` only sees failures that happen before streaming starts. The `#factsheet-main` marker check turns those cases into a 503 with `no-store`, so the LP report does not cache a bad PDF. The goto-404/500 test arms (`pdf/route.test.ts:469,491`) model a status the page can no longer return for these failures. |
| SF-03 | yes | try/catch with capture, fallback to idle; the 409 status uses an `Object.hasOwn` guard. |
| SF-04 | yes in the page; not in its PDF route | See R2-01. |
| SF-05 | `error.tsx` / `not-found.tsx` yes; `loading.tsx` no | `retry` is the right prop: `error-boundary.js:43-47,113-114` passes `{error, reset, retry}`, and `retry` calls `router.refresh()` then `reset()`. But `loading.tsx` at the `[id]` segment changes the HTTP status semantics of the canonical route and the tear sheet. That is R2-01. |

### R2-01 (HIGH, user-facing): `[id]/loading.tsx` makes the tear sheet stream a 200 for every throw and `notFound()`, so `tearsheet.pdf` prints and publicly caches error, not-found and pending pages

**Files:** `src/app/factsheet/[id]/loading.tsx` (moved here by `c74825fbd`), `src/app/factsheet/[id]/tearsheet/page.tsx:117,200-214`, `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:223-231,273-274`

**Who it hurts:** an allocator or LP who presses "Download PDF" on a tear sheet (`tearsheet/page.tsx:329`). For the next 5 to 10 minutes, every reader of that strategy's tear sheet PDF gets the same bad file from the CDN.

**Evidence:**
- **Streaming fixes the status at 200.** `loading.md:103` says: *"Streaming page responses begin with a `200` status code."* `loading.md:116-120` says the body starts streaming when a `loading.tsx` fallback renders, and *"Starting the stream sends the response headers and fixes the status code."* `not-found.md:15` says: *"After streaming starts, the status code remains `200`."* A `loading.tsx` wraps the pages of all child segments (`loading.md:86`). Before `c74825fbd`, nothing above `/factsheet/[id]/tearsheet` or `/factsheet/[id]` had a `loading.tsx`; it lived only under `v2/`. So those routes answered real 404s and 500s.
- **Bots are not exempt.** The renderer's UA, `Quantalyze-PDF-Renderer/1.0` (`pdf/route.ts:47`; the tearsheet route does not set one, so headless Chrome's default is used), is not a bot to Next: `isBot("Quantalyze-PDF-Renderer/1.0") === false`, measured against `next/dist/shared/lib/router/utils/is-bot.js`. The streaming behaviour applies.
- **The guard is now dead.** `tearsheet.pdf/route.ts:229` refuses only on `response.status() >= 400`. Its comment states the invariant: *"170.6.1.1-TEARSHEET-PDF-STATUS: never print an error page as a cached 200 PDF."* That check no longer sees in-page failures, and the route has no positive marker check.
- **Three render paths now become a 200 PDF**, served with `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` (`:273`):
  1. **Any throw in the tear sheet render.** This includes SF-04's own new `read_error` throw (`:201`), which means one DB blip during a PDF render. The file holds the factsheet error boundary: "We couldn't render this factsheet … Try again / Back to discovery".
  2. **A `notFound()`** at `:117` or `:200`. The file holds the not-found card.
  3. **The pending page** at `:203`, for a strategy whose status is complete but whose payload cannot build. Fixer 1B recorded this residual itself. It is the same mechanism and the same missing marker.
- **Why the tests stay green.** The route tests mock `goto` with a status, so they cannot see this.
- **Secondary effects of the same move:**
  - The canonical `/factsheet/<id>` for a not-visible id is now a soft 404 (200 plus `noindex`), where it used to be a real 404. The 308s from retired `/browse/...` and `/strategy/...` URLs of unpublished strategies now land on a 200.
  - The e2e `res.status() >= 400` guards on `/factsheet/<id>` (`e2e/axe-app-wide.spec.ts:192`, `e2e/reflow-sweep-authed.spec.ts:169,250`) cannot fire for in-page failures. Their `#factsheet-main` anchors still protect them.

**Data integrity:** no figure leaks. The harm is that a shareable LP artifact is a cached error or placeholder page.

**Fix (root):** take `loading.tsx` back out of the `[id]` segment. Return it to `v2/`, or drop it, so the canonical route and the tear sheet keep real 404 and 500 statuses. Keep `error.tsx` and `not-found.tsx` at `[id]`: an error boundary does not start the stream. Separately, close 1B's pending residual. Give the full tear sheet render a positive marker, for example an `id` on its root that the pending, error and not-found renders lack, and have `tearsheet.pdf` refuse with 503 `no-store` when the marker is absent, as SF-02 did. Add a route test where `goto` resolves 200 and the marker is absent.

### R2-02 (MEDIUM, user-facing): the new `/api/intro` attestation gate also refuses the Bridge's "Request Intro" on `/allocations`, with no recorded decision and a misleading message

**Files:** `src/app/api/intro/route.ts:109-137`, `src/components/portfolio/ReplacementCard.tsx:71-76,91-113`

**Who it hurts:** an approved allocator with no `investor_attestations` row who opens the Bridge drawer on `/allocations` and presses "Request Intro" on a replacement candidate.

**Evidence:**
- `/api/intro` has two callers: `RequestIntroButton` and `ReplacementCard` (`grep -rn 'fetch("/api/intro"' src`). `/allocations` has no attestation gate; only `(dashboard)/discovery/layout.tsx` and `(dashboard)/recommendations/page.tsx:106-126` read `investor_attestations`. So before `773eae155`, the Bridge intro worked for an unattested approved allocator. It now gets a 403.
- `ReplacementCard` maps every 403 to *"You don't have permission to request this intro."* (`:73`). The page offers no way to attest.
- CR-01 itself asked for a recorded decision on the gate's reach ("If the founder wants unattested allocators to request intros, record that as a decision"). Fixer 1A marked CR-01 "requires human verification". Nothing in CONTEXT, ROADMAP or this REVIEW says the Bridge path is meant to close too (`grep -i attest` over the phase CONTEXT and ROADMAP finds nothing).

**Data integrity:** none. Fail-closed is the safe direction for compliance.

**Fix:**
- Get the founder's decision on whether attestation gates all intros. The likely answer is yes, as the compliance default.
- Then have `/api/intro` return a distinct code, for example `{ error: …, code: "attestation_required" }`.
- Have `ReplacementCard` render an attestation prompt for that code, or link to the `AccreditedInvestorGate` (reached through `/discovery`), instead of "You don't have permission".
- Record the decision in CONTEXT and ROADMAP.

### Below threshold (not filed)
- `viewer.ts` catch tags a thrown attestation read as `stage: "profile-read"`.
- The `[id]/error.tsx` and `[id]/loading.tsx` copy is factsheet-specific ("Back to discovery", the factsheet skeleton) and now also shows on the tear sheet.
- An unattested approved allocator on the factsheet sees a back link and no explanation of why no actions are offered.
- `page.pdf()` is outside the WR-03 deadline budget, which was already true before this round.

_Re-reviewed: 2026-11-09 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, with cross-file call chains_

---

## Fix round 2 — gsd-code-fixer

Scope: R2-01 (with silent-failure M1), R2-02 (with M3), M2, M4, M5, per the orchestrator's decisions. Not in scope: M6, the repo-wide `unstable_retry` boundaries, the `vi.unstubAllEnvs` finally. One commit per item. No Co-Authored-By trailer, no CI-skip token, no PROD access.

| Item | Status | Commit |
|---|---|---|
| R2-01 + M1 | fixed | `143e71811` |
| R2-02 + M3 | fixed (decision: parity with pre-phase, the route gate is removed) | `207af09ee` |
| M2 | fixed (dead 409 branch and its two tests deleted) | `9adab284a` |
| M4 | fixed | `ee38d63ec` |
| M5 | fixed | `7db7739af` |

### R2-01 + M1
- `loading.tsx` moved back with `git mv` to `src/app/factsheet/[id]/v2/` (content identical to base `46ec99450`); `error.tsx` and `not-found.tsx` stay at `[id]/`. Docs check, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` ("Status codes", "When is the response body streamed?"): a `loading.tsx` renders a Suspense fallback, which starts the stream and "fixes the status code" at 200, and it wraps the pages of its segment and children. At `v2/` it wraps only `/factsheet/[id]/v2`; `/factsheet/[id]` and `/factsheet/[id]/tearsheet` no longer sit under one, so `notFound()` and a throw keep their 404 and 500. `not-found.md:15` ("After streaming starts, the status code remains 200") is the same rule. Not run against a live server (no build, disk).
- Positive marker: the full tear sheet's root `<main>` carries `id="tearsheet-main"`; the pending, not-found and error renders do not. `tearsheet.pdf/route.ts` runs `page.evaluate(() => !!document.getElementById("tearsheet-main"))` after the status check and, when absent, answers 503 `{ error: "PDF render incomplete, retry shortly" }` with `Retry-After: 10` and `Cache-Control: no-store`, reported to Sentry (`area: tearsheet-pdf`, `step: marker_absent`, level error), and never calls `page.pdf()`. This also closes the pending-page residual round 1B booked in the TODOS closure bullet for `196-TEARSHEET-NONTERMINAL-404-01` (that bullet's residual sentence is now stale; I did not edit TODOS).
- Tests: `tearsheet.pdf/route.test.ts` (an `evaluateOn(ids)` stand-in runs the route's own callback against a document holding only the given ids; the three page mocks gained `evaluate`; new arms: no marker gives 503/no-store/Sentry/no PDF, only the factsheet marker still 503, marker present prints), `tearsheet/page.test.tsx` (full render has `#tearsheet-main`, pending does not), `boundaries.test.tsx` (no `loading.tsx` at `[id]/`, `error.tsx` and `not-found.tsx` present), `v2/page.viewer-chrome.test.tsx` (the one-main arm imports `./loading` now).
- RED evidence (backups in the scratchpad, neuter, RED, `cp` restore, `cmp` clean, GREEN 65/65): marker check turned into `if (false)` -> `a 200 page without #tearsheet-main ...` and `a 200 page that carries only the factsheet marker ...` RED; page id renamed -> `the full render carries #tearsheet-main ...` RED; a copy of `loading.tsx` put back at `[id]/` -> `there is no loading.tsx at factsheet/[id]/ ...` RED.

### R2-02 + M3
- Reverted `src/app/api/intro/route.ts` and `route.test.ts` to their state before `773eae155` (the attestation read, the 403 and its four refusal arms are gone). `resolveFactsheetViewer` keeps the attestation test for the factsheet buttons; `ReplacementCard` untouched. New arm: `an approved allocator with no attestation row is not refused` (source `bridge`, 200, insert made); the harness throws on any `from(investor_attestations)`, so an attestation read in the route fails it.
- RED evidence: the `773eae155` version of `route.ts` put back from a `cp` backup -> that arm RED (plus the 8 existing arms, which hit the harness throw and get 403); restored by `cp`, `cmp` clean, GREEN 32/32.
- Note for the record: the `viewer.ts` header comment still says `/api/intro` keeps its own server checks and that a wrong answer can only show a button that refuses. After this item the viewer is the stricter of the two for an unattested allocator (the buttons are hidden, the route would accept). That is an affordance decision, not a grant, so the comment stays true; no edit.

### M2
- `RequestIntroButton.tsx`: the 409 branch is back to `setUiState("sent"); setRequestStatus("pending")`. The two tests that fed a status in the 409 body are deleted; `a 409 from /api/intro shows the pending badge, not an error` remains. The rest of SF-03 (try/catch, capture, idle fallback) is kept. Tests 14/14. No new or changed gate, so no RED (pure deletion of a branch the server never feeds).

### M4
- `v2/page.tsx` Lane B owner probe: `getUser()` destructures `error`; when set and not `isAuthSessionMissingError`, `captureToSentry(error, { tags: { area: "factsheet-viewer-session", stage: "owner-probe-get-user" } })`. The `notFound()` for no user is unchanged.
- Tests (`page.viewer-chrome.test.tsx`, new describe): an auth error is captured and the page is a 404; `AuthSessionMissingError` is not captured; a clean no-session read is not captured.
- RED evidence: condition neutered to `if (false)` -> the captured arm RED; condition widened to `if (ownerProbeAuthError)` -> the `AuthSessionMissingError` arm RED; restored by `cp`, `cmp` clean, GREEN 43/43 (44 with M5's arm).

### M5
- Reliable pending marker: none existed (the pending `<article>` had no id or test id), so `data-testid="factsheet-pending"` was added to it in `v2/page.tsx`; no other render carries it.
- `pdf/route.ts`: the open-step page function now returns `"absent"` (article present, no Advanced), `"opened"`, `"pending"` (no article, no Advanced, pending marker) or `"no-factsheet"` (none of them). `"pending"` answers a non-retryable 409 `{ error: "Factsheet not available yet" }` with `Cache-Control: no-store`, no `Retry-After`, a `console.warn` and no Sentry event; `"no-factsheet"` keeps the 503 plus error-level Sentry; a mounted factsheet whose Advanced fails to open keeps the 503. `page.pdf()` now gets `timeout: timeLeft()` (the same 1 ms floor).
- Tests: `pdf/route.test.ts` (the document stand-in gained `querySelector`; new arms: pending gives 409/no-store/no Retry-After/no Sentry/no PDF; mounted factsheet whose Advanced fails stays 503 with Sentry even with a pending marker present; `page.pdf()` gets `(maxDuration - 3) * 1000 - 22_000` after a slow wait, and 1 when the budget is exhausted), `page.viewer-chrome.test.tsx` (pending render carries `factsheet-pending`, the full render does not).
- RED evidence: pending branch disabled and the `pdf` timeout dropped -> the 409 arm and the `page.pdf()` timeout arm RED; the page marker renamed -> the marker arm RED; restored by `cp`, `cmp` clean, GREEN 85/85.

### Gates
`npx tsc --noEmit` clean; `npm run lint` 0 errors (the same 4 pre-existing warnings) and the hygiene checks OK; `npx vitest run src/__tests__ src/app src/lib/factsheet src/components`: 17980 passed, 276 skipped, 2 failed. The 2 failures are the known `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (snapshot skew, untouched by this round). No build and no Playwright were run (disk). The status behaviour of the real routes after the `loading.tsx` move is confirmed from the docs and the unit seams only, not from a running server; an e2e or a manual `curl -I` of an unpublished id's `/factsheet/<id>` (expect 404) is the check to run when disk allows.

### Found, not fixed
- `e2e/axe-app-wide.spec.ts:192` and `e2e/reflow-sweep-authed.spec.ts:169,250` status guards on `/factsheet/<id>` work again as written now that the canonical route is no longer streamed through a loading boundary; not re-run.
- The canonical `/factsheet/[id]` has no loading skeleton any more (it never had one before round 1; only `/v2` does). A skeleton there would need the status question to be answered differently.

---

## Re-review round 3 (gsd-code-reviewer, final)

**Reviewed:** 2026-11-09T10:56:45Z, diff `d1ffa5371..HEAD` excluding `.planning` (5 fix commits, 14 files). Scope is MEDIUM and above. Next.js behaviour was checked against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` ("Status codes", "When is the response body streamed?"), `not-found.md:15` and `generate-metadata.md` ("Streaming metadata"). **Targeted vitest:** 9 files, 216 tests, all pass. The files are both PDF routes, the intro route, boundaries, the tear sheet page, viewer-chrome, RequestIntroButton, `viewer.ts` and the founder-lp-report cron. No build, no Playwright (disk at 99%).

### Round-2 items: status

| Item | Fixed at root? | Evidence |
|---|---|---|
| R2-01 | yes | No `loading.tsx` sits above `/factsheet/[id]` or `/factsheet/[id]/tearsheet` now. The only one is `v2/loading.tsx`. The root `layout.tsx` renders no `<Suspense>` (it renders only `PlausibleScript` and children), there is no `template.tsx`, and neither `generateMetadata` calls `notFound()`. So nothing starts the stream before the pages' own `notFound()` or throw, and loading.md's "calling `notFound()` before this point preserves its 404" applies. `error.tsx` and `not-found.tsx` stay at `[id]/`. The tests can fail: `boundaries.test.tsx:70` fails if a `[id]/loading.tsx` comes back. `tearsheet.pdf/route.test.ts`'s `evaluateOn` runs the route's own callback against a stubbed document, so renaming the id on either side turns it red. The `/v2` alias is still streamed, as the orchestrator decided. |
| R2-01 marker | yes | The tear sheet has one full-render `return` (`tearsheet/page.tsx:229-343`), and `id="tearsheet-main"` is on its root. The AUM gate (`showAum`) and the attestation gate (`isAttested`) only change props inside that tree, so every legitimate full render carries the marker. The pending (`:203`), `notFound()` (`:117`, `:200`) and throw (`:201`) renders do not. The 503 return in `tearsheet.pdf/route.ts:238-249` sits inside the `try`, so `finally` still closes the browser and releases the slot. |
| R2-02 / M3 | yes | `git diff 773eae155^ HEAD -- src/app/api/intro/route.ts` is empty, so the route is byte-identical to its state before the phase. The attestation test lives only in `resolveFactsheetViewer` (`viewer.ts:67-78`), which `ViewerBar` uses to show the buttons. |
| M2 | yes | The 409 branch is back to the fixed "pending" copy. |
| M4 | yes | The `v2/page.tsx:499-510` owner probe captures a non-`AuthSessionMissingError` error and still returns 404. |
| M5 | **no, see R3-01** | The pending marker also marks a transient read failure, so a retryable outage gets the non-retryable 409. |
| `page.pdf` timeout | yes for the function | `timeout: timeLeft()` with a 1 ms floor. But the deadline is set against the function, not against its one automated caller (R3-02). |

### R3-01 (MEDIUM, user-facing): the LP report PDF answers a one-request DB read failure with the non-retryable 409 "Factsheet not available yet", so the daily founder LP cron skips its retry and fails the day's report

**Files:** `src/app/factsheet/[id]/v2/page.tsx:691-705,830-833`, `src/app/api/factsheet/[id]/pdf/route.ts:367-381`, `src/app/api/cron/founder-lp-report/route.ts:355`

**Who it hurts:** the founder's daily LP report email (`/api/cron/founder-lp-report`, the route's only automated caller), and anyone downloading the LP report during a read blip.

**Evidence:**
- On the public lane, a `FactsheetReadError` from `buildFactsheetPayloadCached` sets `publicReadFailed = true; payload = null` (`v2/page.tsx:700-705`). It then goes down the same `if (!payload)` branch as a not-yet-built payload, and renders the same `<article data-testid="factsheet-pending">` (`:830-833`). The page's own comment (`:684-689`) describes this as "a public build whose admin read failed … renders the same public placeholder". So the marker cannot tell "not built yet" from "the read failed this once".
- M5 maps that marker to `"pending"`, which returns a 409 with `no-store` and no `Retry-After` (`pdf/route.ts:369,374-381`). The comment says it is "a fact about the strategy (not built yet), which retrying shortly cannot change". That is false for the read-failure render. Before M5, the same render went to `"no-factsheet"`, which returned a 503 with `Retry-After: 10`.
- The PDF route has already refused every status other than `complete` and `complete_with_warnings` (`pdf/route.ts:252-261`). For a published, computed strategy, the reachable "pending" cases are the transient `read_error` and the persistent `composite_unbuildable`, `too_few_points` and `malformed_series`. The transient case is the one a strategy that is fine in steady state will actually hit.
- The cron retries only on 503 (`founder-lp-report/route.ts:355`: `if (first.status !== 503) return first;`). A 409 goes straight to `!pdfRes.ok`, a throw, and `dualAlert` (`:488-491`, `:563-577`). The alert also carries the wrong cause ("not available yet" instead of a read failure). The orchestrator's decision covers a *pending factsheet*. A read outage is not one, so this is a defect in the implementation, not a re-run of the decision.

**Data integrity:** none. Nothing is cached (`no-store`), and the resolve stage has already captured the read error in Sentry.

**Fix (minimal):** keep the pending marker off the read-failure render, so that render falls through to `"no-factsheet"` and gets the existing 503 with `Retry-After`. For example:
```tsx
<article
  data-testid={publicReadFailed ? undefined : "factsheet-pending"}
  className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12"
>
```
Add a `page.viewer-chrome` arm where the cached builder throws `FactsheetReadError`, and assert that no `factsheet-pending` is rendered. Also correct the comment at `pdf/route.ts:365-366`.

### R3-02 (MEDIUM, user-facing; carried from round 1B, not introduced by round 2): the WR-03 deadline is 27 s, but the LP cron aborts its fetch at 25 s, so every Advanced-timeout 503 arrives after the caller has hung up and its designed retry never runs

**Files:** `src/app/api/factsheet/[id]/pdf/route.ts:223-225,389-390,406`, `src/app/api/cron/founder-lp-report/route.ts:92,351,355`

**Who it hurts:** the founder's daily LP report on a slow render: a cold Chromium, a slow `goto`, or heavy Advanced panels.

**Evidence:**
- The route's deadline is `Date.now() + (maxDuration - 3) * 1000` = 27 s (`:223`). Both Advanced waits get `timeout: timeLeft()` (`:389-390`), so when one times out it expires at the deadline. Every `AdvancedOpenError` 503 from a wait timeout is therefore answered at about 27 s.
- The cron fetches with `AbortSignal.timeout(FETCH_TIMEOUT_MS)`, where `FETCH_TIMEOUT_MS = 25_000` (`:92`, `:351`). Its only recovery is "single 503 retry honoring Retry-After" (`:311-316`, `:355`). The fetch aborts at 25 s with an `AbortError`, before the 503 at about 27 s can reach it. So the cron never retries, and it goes to `dualAlert`. The cron's own header says it relied on "factsheet endpoint maxDuration is 30s — 25s leaves a buffer", which assumed a 503 inside 25 s.
- Round 2's `page.pdf({ timeout: timeLeft() })` (`:406`) extends the same 27 s budget to the print step. That part is not new harm.
- **Not a regression against the state before the phase:** before WR-03, the slow case was killed at 30 s and the cron aborted at 25 s, with the same alert outcome. The defect is that WR-03's purpose, a reachable 503 with `Retry-After`, is still unreachable for the one caller that acts on it. The unit tests fake `Date` inside the route only, so they cannot see the caller's budget.

**Data integrity:** none. It fails loud: the founder gets an alert, not a short PDF.

**Fix:** budget the route against the caller. For example, `const deadline = Date.now() + Math.min((maxDuration - 3) * 1000, 22_000);`, documented as "the founder-lp-report cron aborts at 25 s". Or export the budget as a constant that both routes import, and pin it in a test that asserts the route budget is below the cron's `FETCH_TIMEOUT_MS`. The orchestrator may book this rather than fix it, since it does not regress the state before the phase.

### Below threshold (not filed)
- On a strategy whose status is complete but whose payload cannot build (`composite_unbuildable`, `too_few_points`, `malformed_series`), `tearsheet.pdf` now answers a persistent condition with 503 "retry shortly" and an error-level Sentry event on every hit. The LP route got the 409 distinction for this case, and the tear sheet did not. Safe direction (`no-store`), and the pending tear sheet page has no Download PDF button.
- The round-1B TODOS closure bullet for `196-TEARSHEET-NONTERMINAL-404-01` still records the tearsheet.pdf residual that R2-01's marker has now closed (the fixer noted this and left it).

_Re-reviewed: 2026-11-09T10:56:45Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, with cross-file call chains (page → PDF route → cron caller)_
