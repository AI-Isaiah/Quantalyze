# Phase 208: UIQUICK — alert-digest link, browse error state and share-link failures tell the truth - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Three user-facing lies are fixed (ROADMAP `### Phase 208`):

1. The alert digest email (`sendAlertDigest`, `src/lib/email.ts`) stops claiming the dashboard shows
   the alerts it lists.
2. `/browse` tells a failed category read apart from an empty one (`getPopulatedCategorySlugs`,
   `src/lib/queries.ts`; `getBrowseCategories`, `src/app/browse/browse-categories.ts`).
3. `ShareableLink.tsx` share failures are logged, say what happened, and always leave the URL on
   screen when the copy did not land.

Closes TODOS: `195-ALERT-DIGEST-LINK-TARGET`, `195-BROWSE-EMPTY-VS-ERROR`,
`170.6.1-SFH2-SHARE-FAILURES-UNLOGGED`, `170.6.1-R2-DIALOG-COPY-BUTTON`, `170.6.1-R2-IOS-SELECT`,
`170.6.1-SFH2-PUBLISHED-LANE-NO-URL`, `170.6.2-SHAREABLELINK-D05-RED`.

Out of scope: building an alerts page or widening `AlertBanner` (founder chose the wording fix);
any change to the share route's status codes; the factsheet `ShareLinkButton`'s own failure
wording (only its bound changes, per R2-DIALOG-COPY-BUTTON).

</domain>

<decisions>
## Implementation Decisions

### Alert digest wording
- **D-01 (FOUNDER DECISION, 2026-11-14, via the coordinator's AskUserQuestion: "Fix the email
  wording", option A).** The digest stops claiming the dashboard shows these alerts. The link
  keeps pointing at `${APP_URL}/allocations` and its text becomes "Open your allocation →". The
  email contains neither "View in dashboard" nor any other claim that the dashboard lists the
  alerts. Pinned by `src/lib/email.test.ts` (the existing Phase 195 arm is updated: href still
  `/allocations`, new label present, old label absent, no `/portfolios`).
  - Measured evidence behind the decision (2026-11-14, at `b3214f449`): `/allocations` mounts only
    `AlertBanner`. It shows critical alerts only, one at a time, and is `hidden md:flex`, so a phone
    shows nothing. No component reads `alertCount`, and `GET /api/portfolio-alerts` has no UI
    caller. The digest sends every severity.
  - Rejected: (B) widen `/allocations` to list every alert; (C) a new alerts page.

### Browse: error vs empty
- **D-02 (Recommended, taken):** `getPopulatedCategorySlugs()` THROWS on a read error, after the
  `console.error` and `captureToSentry` it already does, and returns `[]` only for a real empty
  result. Throwing was chosen over a discriminated return because both production callers
  (`src/app/(dashboard)/layout.tsx` and `getBrowseCategories`) already wrap it in try/catch. The
  dashboard layout's behaviour is therefore unchanged: on error it already ended with
  `populatedSlugs` undefined.
- **D-03 (Recommended, taken):** `getBrowseCategories()` reports a read state of `"ok"`, `"empty"` or
  `"error"`:
  - **empty:** no cards. The existing line "No strategies published yet. Check back soon." renders
    (today it cannot render).
  - **error:** no cards and no redirect. A distinct error block (`role="alert"`) says the categories
    could not be loaded and offers a way to retry (a link back to `/browse`). The fallback cards
    are NOT shown: a card is a claim that the category has strategies, and a failed read has no
    data.
  - **ok:** today's behaviour (cards, plus the one-category redirect).
  - **Both states:** the heading, the sign-up block and the disclaimer render as today.
- **D-04 (Recommended, taken):** The one-category redirect and the breadcrumb rule stay gated on
  `"ok"`: a failed or empty read never redirects and never drops the Browse crumb (Phase 195 D-08,
  WR-02). The Phase 195 arm "renders the fallback cards ... when the read returns empty" in
  `src/app/browse/page.test.tsx` is REWRITTEN to the new truth, which is a deliberate behaviour
  change; its header comment must say so.
- **Claude's discretion:** the exact error copy and styling. Follow DESIGN.md (`role="alert"`; if an
  `ErrorEnvelope` code fits, use it, otherwise match the envelope shell classes). The UI-SPEC, if
  one is generated, pins the copy.

### ShareableLink failures (SFH2-SHARE-FAILURES-UNLOGGED)
- **D-05 (Recommended, taken):** Every catch in `ShareableLink.tsx` logs `{ strategyId, err }`: the
  mint, the bounded clipboard write, the `execCommand` fallback, and the new dialog copy button.
  The log uses `console.warn` with a `[ShareableLink]` tag, matching the sibling `mintAndCopy` in
  `FactsheetView.tsx`. No URL or token is logged (the minted URL is a capability).
- **D-06 (Recommended, taken):** `mintShareUrl` throws an error that carries the HTTP status.
  ShareableLink maps it to the button text:
  - **401** → a sign-in message (signed out). No "try again".
  - **403 and 404** → a non-retryable "you can't share this strategy from this account / this
    page" message. No "try again". Measured in `src/app/api/strategies/[id]/share/route.ts` and
    `src/lib/csrf.ts`: lost ownership answers **404**, not 403 (the route hides row existence),
    and 403 is the same-origin/CSRF refusal. The TODO's "retries a 403 for ever" is really a 404,
    so both are covered.
  - **Every other failure** (5xx, 429, 503, network, empty body) keeps "Couldn't create the link —
    try again".
  - The exact strings are pinned in the UI-SPEC/plan.
- **D-07 (Recommended, taken):** The failure text is also placed in a polite live region
  (`role="status"` / `aria-live="polite"`, DESIGN.md: non-blocking state change). A changing button
  label alone is not reliably announced.

### ShareableLink dialog and copy (R2 entries)
- **D-08 (R2-DIALOG-COPY-BUTTON, Recommended, taken):** The copy-failed URL field gets its own Copy
  button.
  - It copies the URL already shown, straight from its click handler, with no network call first,
    through the bounded write and then the `execCommand` fallback.
  - Its outcomes are visible: copied, or failed with the URL still selected.
  - `FactsheetView.tsx`'s `mintAndCopy` is bounded the same way, so a hanging clipboard write ends
    in `failed` rather than `working` for good. The bounded write and fallback become ONE exported
    helper in `ShareableLink.tsx`, which `FactsheetView.tsx` already imports `mintShareUrl` from;
    the logic is not copied.
- **D-09 (R2-IOS-SELECT, Recommended, taken):** The field focus/select also calls
  `setSelectionRange(0, value.length)`, and the field's own Copy button is the main action.
  - **Done:** checked ONCE in Playwright WebKit on a mobile (iPhone) device profile. This is a
    one-off local run whose reading is recorded in the plan SUMMARY and VERIFICATION.
  - **No CI change:** no WebKit project is added to CI (install cost; the TODO asks for one check,
    not a gate).
- **D-10 (SFH2-PUBLISHED-LANE-NO-URL, Recommended, taken):** On the published lane, when both copy
  paths fail, the URL is shown on screen too. The same Modal opens with the URL field and its Copy
  button, under a title fitting a public link (not "Private link"), and WITHOUT the
  `OwnerUnpublishedPanel`, which is owner-unpublished only. The "copy the URL manually" text then
  points at a URL that is actually visible.
- **D-11 (170.6.2-SHAREABLELINK-D05-RED, Recommended, taken):**
  - **Root cause first.** The Private link Modal's panel loads through `next/dynamic` from the
    large `FactsheetView` module, so under load its first import takes longer than `findByRole`'s
    1 s default.
  - **Fix:** await that content with an explicit, commented per-call timeout, or remove the lazy
    import cost from the test.
  - **Never** raise a global timeout.
  - **Done:** the arm passes repeatedly under a loaded run.

### Added after research (2026-11-14, Recommended defaults taken by the phase agent; RESEARCH open questions 1-3)
- **D-13:** A signed-out mint does not reach the route's 401. `src/proxy.ts` answers a cookie-less
  POST with a 307 to `/login`, `fetch` follows it, and today `mintShareUrl` reads that as "returned
  no url", so the button says "try again" for ever. `mintShareUrl` treats a response that was
  redirected to `/login` as status 401, so D-06's sign-in wording covers the real signed-out path.
  This extends D-06; it does not change it.
- **D-14:** If an "ok" read returns slugs, but none of them matches a known `DISCOVERY_CATEGORIES`
  entry, the page renders the "empty" state. A card is never invented, and the error block is not
  shown for a read that succeeded.
- **D-15:** The shared copy helper returns a boolean (`copyTextBounded(text, { strategyId, host? })`)
  and owns the catch logging. Its `execCommand` temp input is placed inside the open `<dialog>`
  when there is one: measured in WebKit, a body-appended input fails while a modal is open.
- **D-11 note:** The D05-RED arm already has a warm-up (`f1f5ca30d`) and passes locally even under
  load. The fix is to add explicit, commented per-await timeouts on the lazy panel. No neuter-RED
  is claimed for this item, because the 1 s CI failure does not reproduce locally.

### Share-link host (SHARE-HOST-01), scope addition
- **D-16 (FOUNDER DECISION, 2026-11-14, via the coordinator's AskUserQuestion: "Add share-link host fix to 208"):**
  Both share routes, `src/app/api/strategies/[id]/share/route.ts` and
  `src/app/api/allocator/scenario/share/route.ts`, build the share URL from the CSRF-validated
  request origin, ahead of `NEXT_PUBLIC_APP_URL`.
  - **Test:** minting a link on a non-production host returns that host.
  - **Fallbacks:** the localhost literal stays as the last rung.
  - **Where the fix lives:** in the routes, not the env var. The PDF routes and
    `founder-lp-report` treat `NEXT_PUBLIC_APP_URL` as PROD's app URL, so it stays as it is.
  - **Closes:** TODOS `SHARE-HOST-01` (deleted in the release commit).
  - **ROADMAP:** the new criterion arrives through a separate records PR, so the ship branch does
    not edit ROADMAP.
  - **Open point for the plan (measured 2026-11-14):** the scenario route's `resolveAppUrl()` takes
    no `req` and that route does not call `assertSameOrigin`. "CSRF-validated" therefore needs that
    route to validate the origin before trusting it. Planner and research decide how: call
    `assertSameOrigin`, or check the parsed origin against the same allow-list without adding a new
    403 path. Whichever is chosen, it must be recorded with the evidence.
  - **Resolved by plan 208-05:** the route FILE does not call `assertSameOrigin`, but its request path does. `POST = withAllocatorAuth(...)` → `withAuth`, which calls `assertSameOrigin` on every non-GET/HEAD/OPTIONS request before the handler runs. So `resolveAppUrl(req)` reads the origin that was already validated. There is no second call and no new 403 path, and a new integration test pins the gate.
  - **Accepted consequence, WR-01 (FOUNDER DECISION, 2026-11-14, "Accept and record"):** the CSRF
    allow-list in `src/lib/csrf.ts` also admits production's own per-deployment
    `NEXT_PUBLIC_VERCEL_URL` host and any extra `NEXT_PUBLIC_ALLOWED_ORIGINS` host, and the
    `next.config.ts` 308 does not cover them. A link minted on one of those hosts therefore comes
    back on that host. The founder accepted this (review option A) over (B) trusting the origin on
    production only when canonical and (C) gating the `NEXT_PUBLIC_VERCEL_URL` entry to
    non-production. No code change; `208-REVIEW.md` "Orchestrator disposition" holds the options.
  - **WebKit reading (FOUNDER DECISION, 2026-11-14, "Accept the simulation"):** the D-09 check
    stands on the Playwright WebKit iPhone 15 reading in `208-04-SUMMARY.md`; no iOS Safari device
    run is required.

### Tests
- **D-12:** Each fix has a test that goes RED when the fix is reverted (ROADMAP SC-4):
  - digest wording;
  - browse error vs empty (page and helper);
  - each ShareableLink catch logs;
  - the 401 and 403/404 wording;
  - the live region;
  - the dialog Copy button copies without a fetch;
  - a hanging clipboard write ends visibly failed (ShareableLink dialog and factsheet
    `mintAndCopy`);
  - the published lane shows the URL after both copy paths fail.

  Each one is proved by neutering the fix, seeing RED, and restoring from a byte backup.

### Claude's Discretion
- Exact copy strings (UI-SPEC pins them if generated).
- Whether the bounded-copy helper returns a boolean or throws.
- The plan split. Suggested: one plan for digest + browse, one for ShareableLink + FactsheetView,
  both wave 1 with no file overlap.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `writeClipboardBounded` (3 s bound, `CLIPBOARD_WAIT_MS`) and the inline `execCommand` fallback
  in `src/components/strategy/ShareableLink.tsx`: to be lifted into one exported helper.
- `Modal` (`src/components/ui/Modal.tsx`) and `Input` (`src/components/ui/Input.tsx`): already
  used for the Private link dialog.
- `captureToSentry` + `console.error` in `getPopulatedCategorySlugs`: kept, then rethrown.
- `ErrorEnvelope` (`src/components/error/ErrorEnvelope.tsx`): DESIGN.md's canonical error shell.

### Established Patterns
- Honest-failure discipline: a failure never reaches the success badge (audit-#43, T-164-15).
- Published lane copies synchronously (no await before `clipboard.writeText`): do not route it
  through an async resolver (the comment above `ShareableLinkProps`).
- Tests: vitest + Testing Library. Server pages are tested via `renderToStaticMarkup(await Page())`
  (`src/app/browse/page.test.tsx`).

### Integration Points
- `getPopulatedCategorySlugs` callers: `src/app/(dashboard)/layout.tsx` (already catches),
  `src/app/browse/browse-categories.ts` (used by `/browse` and the `/browse/[slug]` breadcrumb),
  `src/lib/anon-strategies-live-probe.test.ts` (happy path only).
- Mocks of `getPopulatedCategorySlugs` in `breadcrumb-root.test.tsx`, `disclaimer-once.test.tsx`,
  `[slug]/page.session.test.tsx`, `layout.unprocessed-leads.test.tsx`: check that they still hold.
- `mintShareUrl` is also called by `FactsheetView.tsx` `mintAndCopy`. A status-carrying error must
  not break its catch.

</code_context>

<specifics>
## Specific Ideas

- Digest link text: "Open your allocation →" (founder's example wording).
- `/browse` empty line already exists verbatim: "No strategies published yet. Check back soon."

</specifics>

<deferred>
## Deferred Ideas

- A full alerts list on `/allocations`, or `AlertBanner` on phones (rejected option B). If wanted, it
  needs its own phase.
- Factsheet `ShareLinkButton` 401/403/404 wording (sibling of D-06): not required by SC-3.

</deferred>
