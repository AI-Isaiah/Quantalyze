# Phase 208: UIQUICK - Research

**Researched:** 2026-11-14
**Domain:** Next.js 16.4.2 App Router copy + state fixes (server page, email template, client share component), Vitest + Testing Library gates
**Confidence:** HIGH (every key claim below was measured in this worktree this session; the few `[ASSUMED]` items are listed in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied verbatim from `208-CONTEXT.md` `## Implementation Decisions`, lines 31-132; the planner MUST honour these.)

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
- **D-02 (Recommended, taken).** `getPopulatedCategorySlugs()` THROWS on a read error, after the
  `console.error` and `captureToSentry` it already does, and returns `[]` only for a real empty
  result. Throwing was chosen over a discriminated return because both production callers
  (`src/app/(dashboard)/layout.tsx` and `getBrowseCategories`) already wrap it in try/catch. The
  dashboard layout's behaviour is therefore unchanged: on error it already ended with
  `populatedSlugs` undefined.
- **D-03 (Recommended, taken).** `getBrowseCategories()` reports a read state of `"ok"`, `"empty"` or
  `"error"`:
  - **empty:** no cards. The existing line "No strategies published yet. Check back soon." renders
    (today it cannot render).
  - **error:** no cards and no redirect. A distinct error block (`role="alert"`) says the categories
    could not be loaded and offers a way to retry (a link back to `/browse`). The fallback cards
    are NOT shown: a card is a claim that the category has strategies, and a failed read has no
    data.
  - **ok:** today's behaviour (cards, plus the one-category redirect).
  - **Both states:** the heading, the sign-up block and the disclaimer render as today.
- **D-04 (Recommended, taken).** The one-category redirect and the breadcrumb rule stay gated on
  `"ok"`: a failed or empty read never redirects and never drops the Browse crumb (Phase 195 D-08,
  WR-02). The Phase 195 arm "renders the fallback cards ... when the read returns empty" in
  `src/app/browse/page.test.tsx` is REWRITTEN to the new truth, which is a deliberate behaviour
  change; its header comment must say so.
- **Claude's discretion:** the exact error copy and styling. Follow DESIGN.md (`role="alert"`; if an
  `ErrorEnvelope` code fits, use it, otherwise match the envelope shell classes). The UI-SPEC, if
  one is generated, pins the copy.

### ShareableLink failures (SFH2-SHARE-FAILURES-UNLOGGED)
- **D-05 (Recommended, taken).** Every catch in `ShareableLink.tsx` logs `{ strategyId, err }`: the
  mint, the bounded clipboard write, the `execCommand` fallback, and the new dialog copy button.
  The log uses `console.warn` with a `[ShareableLink]` tag, matching the sibling `mintAndCopy` in
  `FactsheetView.tsx`. No URL or token is logged (the minted URL is a capability).
- **D-06 (Recommended, taken).** `mintShareUrl` throws an error that carries the HTTP status.
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
- **D-07 (Recommended, taken).** The failure text is also placed in a polite live region
  (`role="status"` / `aria-live="polite"`, DESIGN.md: non-blocking state change). A changing button
  label alone is not reliably announced.

### ShareableLink dialog and copy (R2 entries)
- **D-08 (R2-DIALOG-COPY-BUTTON, Recommended, taken).** The copy-failed URL field gets its own Copy
  button.
  - It copies the URL already shown, straight from its click handler, with no network call first,
    through the bounded write and then the `execCommand` fallback.
  - Its outcomes are visible: copied, or failed with the URL still selected.
  - `FactsheetView.tsx`'s `mintAndCopy` is bounded the same way, so a hanging clipboard write ends
    in `failed` rather than `working` for good. The bounded write and fallback become ONE exported
    helper in `ShareableLink.tsx`, which `FactsheetView.tsx` already imports `mintShareUrl` from;
    the logic is not copied.
- **D-09 (R2-IOS-SELECT, Recommended, taken).** The field focus/select also calls
  `setSelectionRange(0, value.length)`, and the field's own Copy button is the main action.
  - **Done:** checked ONCE in Playwright WebKit on a mobile (iPhone) device profile. This is a
    one-off local run whose reading is recorded in the plan SUMMARY and VERIFICATION.
  - **No CI change:** no WebKit project is added to CI (install cost; the TODO asks for one check,
    not a gate).
- **D-10 (SFH2-PUBLISHED-LANE-NO-URL, Recommended, taken).** On the published lane, when both copy
  paths fail, the URL is shown on screen too. The same Modal opens with the URL field and its Copy
  button, under a title fitting a public link (not "Private link"), and WITHOUT the
  `OwnerUnpublishedPanel`, which is owner-unpublished only. The "copy the URL manually" text then
  points at a URL that is actually visible.
- **D-11 (170.6.2-SHAREABLELINK-D05-RED, Recommended, taken).**
  - **Root cause first.** The Private link Modal's panel loads through `next/dynamic` from the
    large `FactsheetView` module, so under load its first import takes longer than `findByRole`'s
    1 s default.
  - **Fix:** await that content with an explicit, commented per-call timeout, or remove the lazy
    import cost from the test.
  - **Never** raise a global timeout.
  - **Done:** the arm passes repeatedly under a loaded run.

### Tests
- **D-12.** Each fix has a test that goes RED when the fix is reverted (ROADMAP SC-4):
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

### Deferred Ideas (OUT OF SCOPE)
(Verbatim from `208-CONTEXT.md` `<deferred>`, lines 182-185.)

- A full alerts list on `/allocations`, or `AlertBanner` on phones (rejected option B). If wanted, it
  needs its own phase.
- Factsheet `ShareLinkButton` 401/403/404 wording (sibling of D-06): not required by SC-3.
- Also out of scope per the CONTEXT `<domain>` boundary: building an alerts page or widening `AlertBanner`; any change to the share route's status codes; the factsheet `ShareLinkButton`'s own failure wording (only its bound changes).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (ROADMAP: "Requirements: TBD"). The phase is bound to ROADMAP SC-1..SC-4 and seven TODOS entries.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Digest link reads "Open your allocation →", still targets `/allocations` | Section "Digest wording notes", `email.ts:1002-1004`, `email.test.ts:549-568`, pin in `trim-removed-surfaces.test.tsx` |
| SC-2 | `getPopulatedCategorySlugs` distinguishes error from empty; browse renders each state | Caller/mock inventory, page + helper test plan, Next `Link` re-run measurement |
| SC-3 | Every `ShareableLink.tsx` catch logs; 401/403(404) says what it is; manual-copy fallback shows the URL | ShareableLink design notes, redirect-on-signed-out finding, WebKit `execCommand` finding |
| SC-4 | Each fix has a test that goes RED when reverted | Validation Architecture (neuter targets per fix) |
| TODOS x7 | `195-ALERT-DIGEST-LINK-TARGET`, `195-BROWSE-EMPTY-VS-ERROR`, `170.6.1-SFH2-SHARE-FAILURES-UNLOGGED`, `170.6.1-R2-DIALOG-COPY-BUTTON`, `170.6.1-R2-IOS-SELECT`, `170.6.1-SFH2-PUBLISHED-LANE-NO-URL`, `170.6.2-SHAREABLELINK-D05-RED` | One mapping row per entry in the "TODOS closure map" section below (before "Common Pitfalls") |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Actionable directives that bear on this phase (`./CLAUDE.md`, `AGENTS.md`, user memory):

- **AGENTS.md:** this Next.js (16.4.2, `[VERIFIED: node_modules/next/package.json "version": "16.4.2"]`) differs from training data; read `node_modules/next/dist/docs/` first. Done for `Link`/prefetch/staleTimes below.
- **Surgical changes / read before write / match conventions** (global CLAUDE.md rules 3, 8, 11): touch only the files listed in the integration map.
- **Tests verify intent (rule 9) + D-12 neuter proof:** neuter the fix, see RED, restore from a BYTE backup (never `git checkout/restore/stash` on uncommitted work).
- **DESIGN.md governs all visual decisions;** `208-UI-SPEC.md` (approved) is the contract. New markup is reuse-only.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry in the same commit as the `VERSION` bump (VERSION and package.json byte-equal 4-digit strings; never `npm version`); never write a CI-skip token (even to deny it) in a commit message or PR body.
- **No AI authorship trailers** in commits/PRs (user memory, founder 2026-10-20; overrides the harness attribution reminder). Never mention a skip token.
- **Ship planning guard:** a ship branch must change nothing under `.planning`.
- **Always `grep -a`.** pytest n/a here. New test files may move censuses: grep `supabase/tests` is irrelevant (no SQL here) but `src/__tests__/*census*` matter (see Gate Census).
- **Public repo with `.planning/` tracked:** no secrets, home paths, PROD ids in tracked text. (This file quotes none; the harness script uses a placeholder strategy UUID that already exists in the test file.)
- **Never use Grok or Codex.** Ask before any `/simplify` run.
- **`next dev` rewrites `AGENTS.md`** (see Pitfall 7): do not commit it.

## Summary

Phase 208 is three independent copy/state fixes plus one test-hardening item. The digest fix is a one-text-node change pinned by two existing tests. The browse fix changes a helper contract (`getPopulatedCategorySlugs` throws on error) and a page contract (`getBrowseCategories` returns a tri-state); the blast radius is small and fully enumerated below: 5 test files mock the helper, 2 of them need a changed arm (one rewritten, one verified unchanged), and the dashboard layout is unaffected. The ShareableLink fix is the bulk of the work, and measurement turned up four facts the CONTEXT/UI-SPEC did not know and the planner cannot guess: (1) a signed-out POST to the mint route is a **307 redirect to /login**, which `fetch` follows to a 200 HTML page, so the real "signed out" case never carries a 401 and would fall into the generic "try again" bucket unless `mintShareUrl` also maps the redirect; (2) in **WebKit the `execCommand("copy")` fallback returns `false` when its temp `<input>` is appended to `document.body` while a native modal `<dialog>` is open** (body is inert), but returns `true` when the temp element lives inside the dialog or the visible field is used; (3) D05-RED's mechanism is as CONTEXT says, but a module-warming `beforeAll` already landed six hours after the TODO was logged and the arm measured green 7/7 at HEAD including under heavy CPU load, so the remaining work is a durable, commented explicit timeout, not a new discovery; (4) `<a href>` to an internal route is flagged by `@next/next/no-html-link-for-pages` in this Next version (it reads app-dir routes), so `<Link>` is the only lint-clean choice, and a same-URL `<Link>`/`router.push` DOES re-run the dynamic server read (measured in `next dev`).

**Primary recommendation:** Plan two wave-1 plans exactly as CONTEXT suggests (digest + browse; ShareableLink + FactsheetView), use `<Link href="/browse" prefetch={false}>` as in the UI-SPEC, make the shared copy helper take a host element so the dialog fallback runs inside the open dialog, and add a `res.redirected`-to-`/login` branch (status 401) to `mintShareUrl` (**NEEDS CONFIRMATION:** this extends locked D-06 beyond "carry the HTTP status"; it is the only way the 401 wording is reachable for a cookie-less signed-out tab, so recommend the planner/founder confirm it as a recorded decision, see Open Question 1).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Digest email wording | API / Backend (`src/lib/email.ts`, server-rendered HTML) | — | Static template text; no client involvement |
| Failed-vs-empty category read | Database / Storage read in API/Backend (`src/lib/queries.ts`) | Frontend Server (SSR `/browse` page) | The read owns the truth (throw vs `[]`); the server page only renders the state |
| Browse error/empty/ok rendering | Frontend Server (SSR) | — | `/browse` is a dynamic server component (reads session cookie via `hasBrowseSession`) |
| Retry from the browse error block | Browser / Client (`next/link` client navigation) | Frontend Server (re-runs the read) | Click triggers a client navigation whose RSC fetch re-executes the server page (measured) |
| Share-mint status mapping, logging, live region | Browser / Client (`ShareableLink.tsx`, `"use client"`) | API (route status codes, unchanged) | State machine and a11y live in the client; route contract is fixed and out of scope |
| Clipboard write + `execCommand` fallback | Browser / Client | — | Pure browser API; must run synchronously inside the click handler |
| Redirect-on-signed-out for fetch | Frontend Server (`src/proxy.ts`) | Browser (fetch follows redirect) | The proxy, not the route, answers a cookie-less POST (measured) |

## Standard Stack

No new library, no new component, no new token (UI-SPEC: "REUSE-ONLY"). Everything below is already in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.4.2 | `Link`, `next/dynamic`, App Router server pages | Project framework `[VERIFIED: node_modules/next/package.json]` |
| react | repo-pinned | client state, `renderToStaticMarkup` in page tests | existing |
| vitest | repo-pinned (4.x per `vitest.config.ts` comments) | all unit/component gates | existing `[VERIFIED: vitest.config.ts "Vitest 4.x: maxWorkers"]` |
| @testing-library/react | repo-pinned | ShareableLink / FactsheetView arms | existing |
| @playwright/test | 1.64.1 (`npx playwright --version`: "Version 1.64.1") | D-09 one-off WebKit check only | already a devDependency; WebKit browser installed (`ms-playwright/webkit-2370` present) |

### Supporting (in-repo primitives to reuse)
| Primitive | Path | Use here |
|-----------|------|----------|
| `Button` / `buttonClassName` | `src/components/ui/Button.tsx` | dialog Copy link button; browse Try again link (no `"use client"`, server-callable) |
| `Input` (forwards ref, `wrapperClassName`, spreads props) | `src/components/ui/Input.tsx` | URL field in both dialog lanes |
| `Modal` | `src/components/ui/Modal.tsx` | both dialog lanes (`title` prop; native `<dialog>`, `showModal()` in a `[open]` effect) |
| `LiveRegion` | `src/components/ui/LiveRegion.tsx` | polite announcement; always mounted, `className` is exactly `sr-only`, pinned by `LiveRegion.test.tsx` |

**Installation:** none. **Version verification:** no package is added, so no `npm view` / legitimacy check is required.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Packages removed due to SLOP: none. Packages flagged SUS: none. (Playwright and WebKit are existing devDependency / already-installed browser; D-09 adds no CI project.)

## Architecture Patterns

### System Architecture Diagram

```
 Alert-digest cron (/api/alert-digest) --> sendAlertDigest(email, name, alerts)
        --> HTML with <a href="${APP_URL}/allocations">Open your allocation →</a>   [Surface A: one text node]

 Visitor --> GET /browse (SSR, dynamic: session cookie read)
        --> getBrowseCategories()
              try getPopulatedCategorySlugs()
                 supabase error ---> console.error + captureToSentry + THROW  --> state "error"
                 data empty/null --> []                                       --> state "empty"
                 rows ----------->  slugs                                     --> state "ok"
              catch(any throw) --> state "error"
        --> page: ok -> (1 cat -> redirect) | cards     empty -> "No strategies published yet..."
                  error -> role="alert" block + <Link href="/browse" prefetch={false}> Try again
        click Try again --> client nav to same URL --> RSC fetch --> server page re-runs the read  [measured]

 Owner clicks row button (ShareableLink, client)
   published ──sync──> url = origin + /factsheet/<id> ──> copyTextBounded(url)   (NO await before writeText)
   unpublished ──> mintShareUrl(id): POST /api/strategies/<id>/share
         307 /login (no cookie, proxy) --followed--> 200 HTML  ==> must map to 401  [finding]
         401 (cookie but no user) / 403 (CSRF) / 404 (not owner) / 400,429,500,503 / network / empty body
         --> ShareMintError{status} --> console.warn + status-mapped row label + LiveRegion
   url known --> copyTextBounded(url, {strategyId, host})
         navigator.clipboard.writeText (3 s bound) --fail--> execCommand("copy") on a temp input
              (temp input MUST live inside the open <dialog> in WebKit) --fail--> copyFailed
   copyFailed --> Modal opens with URL field + [Copy link] button (mint lane: + OwnerUnpublishedPanel; published lane: title "Public link", no panel)
   dialog Copy link --> copyTextBounded(fieldUrl) straight from click handler (no fetch) --> copied | failed(+reselect)
 FactsheetView.ShareLinkButton.mintAndCopy --> mintShareUrl --> copyTextBounded (same helper) --> copied | failed
```

### Recommended file changes (integration map)

```
src/lib/email.ts                                   # 1 text node (line 1003)
src/lib/email.test.ts                              # update the Phase 195 arm (lines 546-568)
src/lib/queries.ts                                 # getPopulatedCategorySlugs: throw after log+sentry (1459-1481)
src/lib/queries.anon-read-errors.test.ts  (or new queries.populated-slugs.test.ts)  # helper arms
src/app/browse/browse-categories.ts                # tri-state return
src/app/browse/page.tsx                            # empty/error blocks; keep ONE <Disclaimer
src/app/browse/page.test.tsx                       # rewrite 2 arms (see below)
src/components/strategy/ShareableLink.tsx          # ShareMintError, copyTextBounded export, dialog, live region, lanes
src/components/strategy/ShareableLink.test.tsx     # extend + fix single-button queries
src/app/factsheet/[id]/v2/FactsheetView.tsx        # mintAndCopy uses the shared helper
src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx  # hang arm (+ keep existing arms green)
```

### Pattern 1: Throw-after-capture read helper (precedent AND a reusable function already exist)
**What:** a read that fails throws after logging and Sentry, so callers' try/catch decide the UI. **Precedent:** `src/lib/queries.ts` already has the shared helper `failAnonRead(op, subject, error): never` whose docblock states "The three anonymous strategies readers share ONE failure contract: a read error is reported to Sentry and THROWN, so the route's error boundary engages." Its body (`queries.ts:609-613`):
```typescript
function failAnonRead(op: string, subject: string, error: { code?: string; message?: string }): never {
  console.error(`[queries.${op}] supabase error:`, error.message ?? error);
  captureToSentry(error, { tags: { op, code: error.code ?? "none" }, level: "error" });
  throw new Error(`${op}(${subject}) failed: ${error.message ?? "unknown error"}`);
}
```
`getPopulatedCategorySlugs` (`queries.ts:1459-1481`) today hand-rolls the first two lines with the IDENTICAL log format (`"[queries.getPopulatedCategorySlugs] supabase error:"`, `queries.ts:1474`) and then `return [];` (`queries.ts:1476`). **Recommended change (minimal, one contract):** replace those three lines with `failAnonRead("getPopulatedCategorySlugs", "published", error);` and keep `if (!data) return [];`. Consequences to state in the plan: the Sentry tags gain `code` (was `{ op }` only), and the thrown message becomes `getPopulatedCategorySlugs(published) failed: <message>`; it embeds `error.message` exactly as the three siblings already do (the raw-`details`/`hint` scrub is Phase 209 SCRUBLEAKS' job at the capture boundary and is independent: ROADMAP `### Phase 209`, "Error reports never carry raw PostgREST `details`/`hint`"; this phase adds no new capture site, it changes one existing site's return to a throw). Also update the stale comment block above it (NEW-C03-06) and the docblock in `browse-categories.ts` ("returns [] for both an empty result and a DB error" becomes false). The helper test asserts the same shape as `getStrategiesByCategory`'s: `rejects.toThrow(/getPopulatedCategorySlugs.*failed/)` and Sentry opts `{ tags: { op: "getPopulatedCategorySlugs", code: "42501" }, level: "error" }` (use the `PERMISSION_DENIED` fixture already typed in `queries.anon-read-errors.test.ts`).

### Pattern 2: Tri-state read for the server page
```typescript
// src/app/browse/browse-categories.ts
export type BrowseReadState = "ok" | "empty" | "error";
export async function getBrowseCategories() {
  let populatedSlugs: string[] = [];
  let state: BrowseReadState;
  try {
    populatedSlugs = await getPopulatedCategorySlugs();
    state = populatedSlugs.length > 0 ? "ok" : "empty";
  } catch {
    state = "error";            // already logged + captured at the source: do NOT capture again
  }
  const categories = state === "ok" ? DISCOVERY_CATEGORIES.filter((c) => populatedSlugs.includes(c.slug)) : [];
  const onlySlug = state === "ok" && categories.length === 1 ? categories[0].slug : null;
  return { state, categories, onlySlug };
}
```
Edge: `state === "ok"` with `categories.length === 0` (DB returns a slug not in `DISCOVERY_CATEGORIES`) renders neither cards nor the empty line today (the empty line is keyed on `categories.length === 0`). Key the empty line on `state === "empty"` per D-03 and decide explicitly what an ok-but-zero-known-categories read shows (recommend: treat as `"empty"`; one-line `if (categories.length === 0) state = "empty"`).

### Pattern 3: One shared copy helper with a host element
**Recommended signature (discretion area; both returns work, a boolean keeps callers branch-free):**
```typescript
export async function copyTextBounded(
  text: string,
  ctx: { strategyId: string; host?: HTMLElement | null },
): Promise<boolean>
```
- Step 1: `writeClipboardBounded(text)` (existing, 3 s `CLIPBOARD_WAIT_MS`). On failure `console.warn("[ShareableLink] clipboard write failed", { strategyId, err })`.
- Step 2: the existing temp-`<input>` + `execCommand("copy")` block, appended to **`ctx.host ?? document.querySelector("dialog[open]") ?? document.body`**, removed in `finally`, keeping the identifier `fallbackSucceeded` (see Gate Census, `critical-regressions.test.ts`). Resolving the open dialog INSIDE the helper (rather than relying on each caller to pass `host`) is deliberate: `OwnerUnpublishedPanel` -> `ShareLinkButton` -> `mintAndCopy` renders INSIDE the open Private link Modal (`ShareableLink.tsx` mounts `<OwnerUnpublishedPanel .../>` as a `Modal` child), so a FactsheetView caller that "omitted host" would append to the inert body in exactly the WebKit-failing case (Pitfall 2). With the default above every caller is correct without passing anything; `host` stays only as an explicit override for tests. The temp-input arms in jsdom assert on `parentNode`. On failure `console.warn("[ShareableLink] execCommand copy failed", { strategyId, err })`.
- Sync rule (`ShareableLinkProps` comment): `navigator.clipboard.writeText` must be reached with NO `await` between the click and the call. `writeClipboardBounded` is an `async` function whose body runs synchronously to its first `await`, so calling `copyTextBounded(url, …)` as the first awaited expression in a click handler preserves the gesture; the published lane must keep computing `url` synchronously and must not insert any `await` before the call.
- `FactsheetView.mintAndCopy` calls it after `await mintShareUrl(...)` (no `host` argument needed: the helper finds the open dialog). That lane already awaited the network first, so it gains the fallback and the bound but not a gesture guarantee; it must treat `false` as failure (throw into its existing catch or set `failed` directly) and keep its own `"[factsheet] share mint/copy failed"` log.

### Anti-Patterns to Avoid
- **Re-introducing an async `resolveShareUrl(published, …)` helper** (explicitly forbidden by the comment above `ShareableLinkProps`).
- **Raising any global test timeout** to fix D05-RED (D-11).
- **A third `text-negative`/`bg-negative`/`border-negative` token in `ShareableLink.tsx`** (R5 census pins exactly 2; see Gate Census). Vary only the mint-failed string, keep one icon.
- **Duplicating `<Disclaimer variant="footer" />` per state branch in `browse/page.tsx`** (`trim-removed-surfaces.test.tsx` pins exactly 1 `<Disclaimer` tag in that file).
- **Logging the URL** (the minted URL is a capability). Log `{ strategyId, err }` only; make sure `err` never embeds the URL (`ShareMintError` message must carry the status only).
- **Using `<a href="/browse">`** for the retry (lint error, see Pitfall 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Screen-reader announcement | a bespoke `aria-live` `<p>` | `LiveRegion` (`src/components/ui/LiveRegion.tsx`) | Pinned inert (`className === "sr-only"`), always mounted before its message |
| Button-styled link | copied class string | `buttonClassName({ size: "sm", className: "mt-3 pointer-coarse:min-h-[44px]" })` | single source of button classes; server-callable |
| Modal | custom overlay | `Modal` | focus return via native `dialog.close()` is relied on by existing tests |
| Clipboard + fallback | a second copy of the logic in `FactsheetView` | one exported `copyTextBounded` | D-08: "the logic is not copied" |
| Status-carrying error | string-matching `"share mint failed: 404"` | `class ShareMintError extends Error { status: number }` + `instanceof` | message strings are not a contract |
| Non-global test timeout | `testTimeout` bump | a per-call `{ timeout }` with a comment on the lazy-panel awaits | D-11 |

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted.

## TODOS closure map

Each TODOS entry's own "Done when / Closed when" text (`TODOS.md:1149-1154`, `3718`, `3724`) mapped to decision, files and the test row that proves it. Close each entry with a dated reason when the phase ships.

| TODOS id | Its own closing condition (abridged) | Decision | Files | Proving test (see Validation Architecture) |
|----------|--------------------------------------|----------|-------|-------------------------------------------|
| `195-ALERT-DIGEST-LINK-TARGET` | link opens a page that shows the alerts, OR the email stops claiming it, pinned by `email.test.ts` | D-01 (option A, wording fix) | `src/lib/email.ts`, `src/lib/email.test.ts` | SC-1 row |
| `195-BROWSE-EMPTY-VS-ERROR` | read reports error separately from empty; empty shows the empty line; failed read shows an error state; a test covers both | D-02, D-03, D-04 | `src/lib/queries.ts`, `browse-categories.ts`, `browse/page.tsx`, `browse/page.test.tsx`, helper test | SC-2a, SC-2b rows |
| `170.6.1-SFH2-SHARE-FAILURES-UNLOGGED` | log `{ strategyId, err }` in each catch; 401/403 wording not "try again"; failure text in an `aria-live` region; a test asserts the log and the 403 wording | D-05, D-06, D-07 | `ShareableLink.tsx`, `ShareableLink.test.tsx` | SC-3a, SC-3b, SC-3c rows |
| `170.6.1-R2-DIALOG-COPY-BUTTON` | URL field gets its own Copy button copying straight from the click handler (no network first) through bounded write + `execCommand`; `mintAndCopy` bounded the same way; a test clicks the dialog copy while the URL is shown; a hang ends in a visible failure, not a disabled button | D-08 | `ShareableLink.tsx`, `FactsheetView.tsx`, both test files | SC-3d, SC-3e, SC-3g rows |
| `170.6.1-R2-IOS-SELECT` | add `setSelectionRange(0, value.length)`; field's Copy button is the main action; checked once in real iOS Safari or Playwright WebKit on a mobile profile | D-09 | `ShareableLink.tsx` (+ one-off recipe, no committed harness) | SC-3d (jsdom: selectionStart/End) + SC-3h manual WebKit reading |
| `170.6.1-SFH2-PUBLISHED-LANE-NO-URL` | a test fails both copy paths on the published lane and finds the URL on screen | D-10 | `ShareableLink.tsx`, `ShareableLink.test.tsx` | SC-3f row |
| `170.6.2-SHAREABLELINK-D05-RED` | passes on a loaded machine (explicit timeout or find why the button mounts late), or is rewritten with a dated reason; never raise a global timeout | D-11 | `ShareableLink.test.tsx` | D05-RED row |

## Common Pitfalls

### Pitfall 1: The "signed out" case is not a 401 in the browser (BIGGEST surprise)
**What goes wrong:** D-06 maps 401 to "Signed out — sign in again to share", but a cookie-less POST to `/api/strategies/<id>/share` never reaches the route. `src/proxy.ts` redirects every non-public route without a session to `/login`.
**Evidence:** `[VERIFIED: ran against a worktree dev server]` `curl -X POST -H 'Origin: http://localhost:3208' .../api/strategies/11111111-1111-4111-8111-111111111111/share` returned `HTTP/1.1 307 Temporary Redirect` with `location: /login`; with `-L` it ended `200 http://localhost:3208/login`. The proxy source: `if (!session && !isPublicRoute) { ... url.pathname = "/login"; return NextResponse.redirect(url); }` (`src/proxy.ts:81-84`), and `/api/strategies` is not in `PUBLIC_ROUTES` (`src/proxy.ts:19`).
**Consequence:** `fetch` follows the redirect, `res.ok` is true, `res.json()` fails, `mintShareUrl` throws `"share mint returned no url"`, and the user sees the generic "try again" forever. The route's own 401 (`route.ts:201-203`, `{ status: 401 ...}`) only fires when a session cookie exists but `getUser()` returns no user.
**How to avoid:** in `mintShareUrl`, before the `res.ok` check, `if (res.redirected && new URL(res.url).pathname === "/login") throw new ShareMintError(401)`; tests mock `{ ok: true, status: 200, redirected: true, url: "https://example.test/login", json: ... }`. This is within D-06's intent ("signed out"); flag to the founder only if the planner wants it as a recorded decision (Open Question 1).

### Pitfall 2: WebKit `execCommand("copy")` fails on a body-appended temp input while a modal dialog is open
**What goes wrong:** the dialog Copy button's fallback uses the legacy temp-input trick; `document.body` is inert behind a native `showModal()` dialog.
**Evidence:** `[VERIFIED: Playwright run, standalone page, real click gesture]` with a `<dialog>` opened via `showModal()`: chromium `{"body":true,"inDialog":true,"field":true}`; webkit iPhone 15 profile `{"body":false,"inDialog":true,"field":true}`; webkit desktop `{"body":false,"inDialog":true,"field":true}` (keys: temp input appended to `document.body`, appended to the `<dialog>`, selecting the visible read-only field).
**Control (rules out "WebKit just can't do it"):** `[VERIFIED: Playwright run, same probe, NO dialog open]` `chromium {"bodyNoDialog":true}`, `webkit-iphone15 {"bodyNoDialog":true}`, `webkit-desktop {"bodyNoDialog":true}`. So a body-appended temp input works in WebKit when no modal dialog is open; the failure is specific to the inert body behind `showModal()`.
**How to avoid:** the helper resolves the host itself (`ctx.host ?? document.querySelector("dialog[open]") ?? document.body`, Pattern 3), so the row lane (no dialog open at click time: body), the dialog Copy button, and `mintAndCopy` inside the panel (dialog open: the dialog) are all correct with no per-caller argument. Add a unit arm asserting the temp input's `parentNode` is the open `<dialog>` when one is open and `document.body` otherwise (jsdom can check `parentNode`; jsdom's `dialog[open]` is set by the polyfill/`showModal` in this file). This is an engine-behaviour fix that jsdom cannot prove; the WebKit recipe below should include one forced-clipboard-failure Copy tap that reads the label (`Copied` when `execCommand` is left real and `writeText` is forced to reject).

### Pitfall 3: `<a href>` for an internal route is a lint error in this Next version
**Evidence:** `[VERIFIED: node_modules/@next/eslint-plugin-next/dist/rules/no-html-link-for-pages.js:183-190]` the rule builds `appDirUrls` from `src/app` (`var appDirs = rootDirs.map(... _path.join(dir, 'src', 'app'))`, `cachedGetUrlFromAppDirectory`), so it covers app routes, not only `pages/`. `eslint.config.mjs` spreads `eslint-config-next/core-web-vitals`. **Do not plan a plain `<a href="/browse">` fallback**; use `Link` (see Pitfall 4 for why that is sufficient).

### Pitfall 4: Does a same-URL `Link` re-run the server read? Yes (measured), with a dev-mode caveat
**Docs:** `[CITED: node_modules/next/dist/docs/01-app/02-guides/prefetching.md]` "Without Cache Components, a static route is prefetched in full, while a dynamic route is skipped unless it has a `loading.js` boundary", table row "**Server roundtrip on click** | No | Yes, streamed after shell" for dynamic pages; `[CITED: .../staleTimes.md]` "The `dynamic` property ... Default: 0 seconds (not cached)"; `next.config.ts` sets no `staleTimes` (`grep staleTimes next.config.ts` returned nothing). `/browse` is dynamic (its layout and page read the session through `hasBrowseSession`).
**Measurement:** `[VERIFIED: next dev 16.4.2, Playwright Chromium]` with Supabase pointed at a closed port (read fails), `/browse` initial load logged one `[queries.getPopulatedCategorySlugs] supabase error`; two `window.next.router.push('/browse')` calls from `/browse` itself produced two more `GET /browse` server renders and two more error logs (3 total), with `_rsc` requests on each push.
**Caveat (honest scope):** measured in dev (no prefetch runs in dev) via `router.push`, the same navigate action a `Link` click dispatches; no existing `Link href="/browse"` exists on `/browse` to click. `prefetch={false}` is harmless and removes the production-only prefetch variable. The planner should still budget the UI-SPEC's "one manual click against a forced failure" as a verification step (the harness in "D-09 recipe" can double as the forced-failure server: bogus Supabase URL gives `state: "error"` after the fix).

### Pitfall 4b: CI's UNSEEDED Playwright job will now render the ERROR block on `/browse`, not five cards
**Evidence:** `e2e/axe-app-wide.spec.ts:9` ("PUBLIC (run UNSEEDED, no skip): /, /security, /contact, /for-quants, /browse") and `:102` (`{ path: "/browse", anchor: "main h1" }`), the same `/browse` row in `e2e/reflow-sweep.spec.ts:49` and `e2e/no-clip-sweep.spec.ts:155`. The unseeded CI job's env is a placeholder Supabase: `.github/workflows/ci.yml:1566-1568` sets `NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder`, `SUPABASE_SERVICE_ROLE_KEY: placeholder_service_role`, and `ci.yml:7039-7041` documents that SSR "hangs on placeholder fetches". Every category read there FAILS, which today is silently rendered as the five fallback cards.
**Consequence:** after this phase those three sweeps (axe at desktop / 375 px / 2560 px, no-clip, reflow) scan the new `role="alert"` block with the red-tinted shell and the button-styled `Try again` link instead of the card grid. The anchor `main h1` still exists in all three states, so they cannot go vacuous, but color-contrast / `link-in-text-block` / no-clip / reflow are now judged on the error block. UI-SPEC claims `text-text-secondary` on `bg-negative/5` is about 7.8:1 (ErrorEnvelope's own measurement); it is not re-measured here. **Recommended verification step (cheap):** the closed-port dev server of the D-09 recipe reproduces the unseeded state locally; run the three specs' `/browse` rows against it (`PLAYWRIGHT_BASE_URL=http://localhost:3208`) before shipping. `[ASSUMED]` that the specs run against an already-running server with that env var (config: `baseURL: process.env.PLAYWRIGHT_BASE_URL || ...`, `webServer.reuseExistingServer: true`).

### Pitfall 5: Single-button queries break when the published lane opens a dialog
`ShareableLink.test.tsx` uses bare `screen.getByRole("button")` throughout the Audit #43 block (lines ~106-195). The two published-lane arms where BOTH copy paths fail ("renders 'Copy failed — copy the URL manually' when both clipboard paths fail" at ~139 and "renders 'Copy failed' when clipboard rejects and execCommand throws" at ~159) assert on `screen.getByRole("button").textContent`. After D-10 the published lane opens a Modal on double failure, so those two arms see the row button + Close + Copy link and throw "multiple elements". Convert them to `getByRole("button", { name: /Copy failed — copy the URL manually/ })` (the row button) . Arms that end in success (no dialog: the first, second and fifth Audit #43 arms and the published-lane arms of the share-predicate block) keep working. Also: with the live region, failure sentences now appear in two nodes, so `getByText(/…/)` on a failure string becomes ambiguous; query by role+name, and use `getAllByRole("status")` (row region + dialog region coexist when the dialog is open and the dialog is not inert to the testing-library tree).

### Pitfall 6: `Modal` stays mounted, so `panelOpen && …` gates matter
`modalMounted` flips true once and never false. Gate the URL block on `panelOpen && dialogUrl` (existing pattern) and gate `OwnerUnpublishedPanel` on `panelOpen && !published` (D-10). The focus/select effect currently depends on `[panelOpen, mintedUrl]`; generalise to the shared dialog-URL state and call `focus()`, `select()`, `setSelectionRange(0, len)` (UI-SPEC "Open-time focus"). Keep the `onFocus` select on the field too.

### Pitfall 7: `next dev` rewrites `AGENTS.md` in the working tree
**Evidence:** `[VERIFIED]` starting `next dev` in this worktree printed "Generated AGENTS.md for AI agents. Set `agentRules: false` in next.config to disable." and `git status` showed ` M AGENTS.md` (heading level changed and two paragraphs added). The D-09 recipe starts a dev server, so the executor MUST run `git checkout -- AGENTS.md` afterwards (own mess; nothing uncommitted of the executor's is in that file) and confirm `git status --short` shows no `AGENTS.md`. Committing it would also break the ship planning/guard hygiene. Also delete the temporary harness page before any commit.

### Pitfall 8: D05-RED as written in the TODO is already half-fixed; do not re-diagnose from scratch
See "D05-RED root cause" below. The risk now is regression of the warm-up when new arms are added in a *new* `describe` block that opens the mint-lane dialog without its own warm-up.

## D05-RED root cause (D-11), measured

- **Mechanism (confirmed in source):** `[VERIFIED: node_modules/next/dist/shared/lib/loadable.shared-runtime.js]` `next/dynamic` in this Next version is a react-loadable implementation, not `React.lazy`: `createLoadableComponent` keeps a module-level `subscription` (`let subscription = null; function init() { if (!subscription) { ... } }`), so the loader runs on the first mount only and its resolved state is shared by every later mount in the file. The first arm that mounts `OwnerUnpublishedPanel` therefore pays the whole dynamic `import("@/app/factsheet/[id]/v2/FactsheetView")` (a 3,442-line module with a large graph) inside `findByRole`'s default 1000 ms. That arm is "D-05: a confirmed live link ... opens the Private link Modal without a fetch" (the first arm of the `Manage private link` describe that opens the panel; it awaits `findByRole("button", { name: "Copy share link" })`).
- **Why the TODO's number matched:** failures "at about 1.0 s, which is the `findByRole` default timeout" (`TODOS.md:1154`).
- **Current state at HEAD `8fc78b69a` (measured, `npx vitest run src/components/strategy/ShareableLink.test.tsx`):** 3 quiet runs: 30/30 pass each (~13 s). 4 runs under 24 busy-loop processes on a 10-core machine: 30/30 pass each; the D-05 arm took 21 ms with the warm-up present. The warm-up is `beforeAll(async () => { await import("@/app/factsheet/[id]/v2/FactsheetView"); }, 30_000)`, present in BOTH the `Manage private link` describe (lines ~453-455) and the `a minted private link is never left invisible` describe (~666-670). It was added by commit `f1f5ca30d` (2026-10-14 19:57 +0200), six hours AFTER the TODO was logged (`5f978b4fb`, 2026-10-14 13:52 +0200).
- **Cold-path cost (warm-up deleted from a scratch copy, then removed):** D-05 arm 143-158 ms quiet and 329-407 ms under 24-process load, all green. 1 s was not reproduced here even without the warm-up. `[ASSUMED]` (not checked): that the difference is this machine's hot vite transform cache and 10 cores versus a cold-cache 4-core CI runner; the only measured fact is 143-407 ms cold here. Mechanism confirmed in source; magnitude on CI not reproducible locally. `[ASSUMED]` that the original CI failures were this cold import (the TODO's own "about 1.0 s" observation is consistent with it).
- **Repo precedent for next/dynamic in tests:** no test mocks `next/dynamic` (`grep 'vi.mock("next/dynamic"'` over `src tests`: no hits). Existing idiom is to pre-resolve the module: `FactsheetBody.degenerate.test.tsx` has `beforeAll(async () => { await import("./HeatmapPanels"); })` with a comment explaining it; `AllocationsTabs*.test.tsx` and `SimulateImpactButton.test.tsx` use `findBy*` with defaults.
- **Recommended fix (D-11, no global timeout):**
  1. Hoist ONE file-level `beforeAll` (30 s) that warms `FactsheetView`, with a comment naming the loadable singleton, and delete the two describe-level copies (so a new Phase 208 `describe` cannot forget it).
  2. Add an explicit, commented per-call `{ timeout: 5000 }` to the awaits that depend on the lazy panel: the D-05 arm's `findByRole("button", { name: "Copy share link" })` and `openLive()`'s `findByRole("button", { name: "Revoke link" })`, as belt-and-braces for a cold module graph on a loaded runner.
  3. Done criterion: the arm passes in 3 quiet + 3 loaded runs (recipe: 24 `yes > /dev/null` background processes, kill them with `pkill -x yes`, confirm `pgrep -x yes | wc -l` is 0).
  4. Close the TODO with the dated reason: warm-up landed in `f1f5ca30d`; explicit timeout added in Phase 208.
- Do NOT mock `next/dynamic` globally: it would stop testing the real lazy-load path that D-05 exists to cover.

## Caller and mock inventory for the browse change (focus item 1)

`grep -a -rn "getPopulatedCategorySlugs|getBrowseCategories" src scripts e2e tests supabase/tests`:

| Site | What it does | Impact |
|------|--------------|--------|
| `src/lib/queries.ts:1459-1481` | defines the helper | Change: throw on error |
| `src/app/(dashboard)/layout.tsx:94-103` | `try { const result = await getPopulatedCategorySlugs(); if (result.length > 0) populatedSlugs = result; } catch (err) { console.error("[dashboard/layout] getPopulatedCategorySlugs failed:", err); }` | Unchanged behaviour (error previously yielded `[]`, so `populatedSlugs` stayed `undefined`; now the catch runs and it stays `undefined`). One extra `console.error` per failure. No test edit. |
| `src/app/browse/browse-categories.ts` | only other production caller | Rewrite to tri-state |
| `src/app/browse/page.tsx:15` | `const { categories, onlySlug } = await getBrowseCategories();` | Add `state`; empty/error blocks |
| `src/app/browse/[slug]/page.tsx:45` | `const [strategies, percentiles, { onlySlug }, signedIn] = ...` destructures `onlySlug` only | No edit needed; return-shape addition is compatible. An error read gives `onlySlug: null`, so the crumb keeps its link (same as today). |
| `src/lib/anon-strategies-live-probe.test.ts:318-320` | happy path, `it.skipIf(!HAS_ANON_PROBE)` | unaffected |
| `src/app/browse/page.test.tsx` | mocks helper via `vi.hoisted` `populatedMock` | **Rewrite two arms** (below) |
| `src/app/browse/breadcrumb-root.test.tsx:30,84` | `mockRejectedValue(new Error("db down"))` arm "a failed/empty read never drops the link" | Already models the new throw; passes unchanged (and becomes the faithful model of production). Optionally tighten its comment. |
| `src/app/browse/disclaimer-once.test.tsx:33,61` | `mockResolvedValue(["crypto-sma","cfd"])` | unchanged (ok state, two cards) |
| `src/app/browse/[slug]/page.session.test.tsx:20,46` | same ok mock | unchanged |
| `src/app/(dashboard)/layout.unprocessed-leads.test.tsx:60` | `getPopulatedCategorySlugs: async () => []` | unchanged (layout treats `[]` as no hint) |

**`src/app/browse/page.test.tsx` arms (verbatim current names):**
- `"renders the fallback cards and never redirects when the read returns empty"` -> REWRITE: `mockResolvedValue([])` expects `"No strategies published yet. Check back soon."`, expects NO `href="/browse/<slug>"` for any `DISCOVERY_CATEGORIES` entry, no `role="alert"`, `redirectMock` not called.
- `"renders the fallback cards and never redirects when the read rejects"` -> REWRITE: `mockRejectedValue(new Error("db down"))` expects `role="alert"`, the exact UI-SPEC title/body, a link named `Try again` with `href="/browse"`, no category cards, no empty line, no redirect.
- `"promises an allocation model, not portfolios"` uses `populatedMock.mockResolvedValue([])` and asserts the sign-up copy: still passes (empty state keeps the sign-up block); leave it.
- Header comment (lines 1-17) says "ZERO / FAILED ... indistinguishable at HEAD ... falls back to every category": rewrite to the new truth and state that the Phase 195 arm is replaced on purpose (D-04 requires this).
- The file mocks `@/lib/queries` wholesale with only `getPopulatedCategorySlugs`, so the tri-state tests need no new mock.

**Helper test (D-12 "page and helper"):** add arms next to the `getStrategiesByCategory` ones in `src/lib/queries.anon-read-errors.test.ts` (same `seeded` mock; `PERMISSION_DENIED` fixture typed there): error -> `rejects.toThrow(/getPopulatedCategorySlugs.*failed/)` + one Sentry event with `{ tags: { op: "getPopulatedCategorySlugs" }, level: "error" }`; `data: null` no error -> `resolves.toEqual([])` and zero Sentry events. For a "rows -> slugs" arm the existing mock always answers `data: null`, so extend the mock with a `seeded.data` field or put the helper arms in a new `queries.populated-slugs.test.ts` with its own chain (`withPublishedOnly` is applied to the builder, which the mock's `eq`/`select` chain tolerates). Neuter targets: restore `return [];` in the error branch (helper arm RED), make `getBrowseCategories` map a throw to `"empty"` (page error arm RED).

## ShareableLink / FactsheetView notes (focus item 4)

**Current structure (read this session):** `mintShareUrl` throws `new Error(\`share mint failed: ${res.status}\`)` (line 88) and `new Error("share mint returned no url")` (line 93); `const CLIPBOARD_WAIT_MS = 3000;` (line 110); the three catches (mint, bounded write, fallback) discard `err`; the `fallbackSucceeded` block is at lines 259-268; Modal title is the literal `"Private link"`; the failure icon branches are `copyFailed` then `mintFailed` (two `text-negative` SVGs).

**Design notes the planner needs:**
- Replace `const [mintFailed, setMintFailed] = useState(false)` with a three-valued state (`null | "signed-out" | "forbidden" | "other"`), keep the render ternary order `copied > copyFailed > mintFailure > minting`, and keep ONE icon in the mint-failed branch (R5 count stays 2). Labels exactly per UI-SPEC: `Signed out — sign in again to share` (401), `You can't share this strategy here` (403/404, written `&apos;` in JSX), `Couldn't create the link — try again` (other). The first two must not contain `try again` or `retry` (case-insensitive).
- `LiveRegion` is one `message` string = the visible failure label while it shows, else `null`; mount it as the sibling AFTER the row `Button`, outside `Modal`. The dialog gets its own `LiveRegion` inside the URL block. `/strategies` mounts one `ShareableLink` per row, so N sr-only status nodes appear; that is inert and acceptable, but tests on `/strategies` that count `role="status"` nodes globally should be grepped (`grep -a -rn 'getByRole("status")\|getAllByRole("status")' src/app/(dashboard)/strategies`).
- Dialog state: add `dialogUrl` (mint lane: the minted URL; published lane: the public URL) rather than reusing `mintedUrl` for both; clear on revoke exactly where `setMintedUrl(null)` is cleared today (published lane has no revoke). Dialog Copy button phases `idle | working | copied | failed` with names `Copy link`, `Copying link…`, `Copied`, `Copy failed`; resets after 2000 ms (copied) / 4000 ms (failed); on failure `focus()`, `select()`, `setSelectionRange(0, value.length)` and announce `Copy failed` in the dialog region.
- Existing test lines that pin current dialog copy: helper paragraph changes (current text "…would not copy it for you. Select the link below and copy it yourself." becomes the UI-SPEC string); `FIELD = "Private link URL"` and `Modal` title `"Private link"` stay on the mint lane (tests find them with `findByLabelText`/`getByText`), so only the published lane gets `Public link` / `Public link URL`.
- **Existing tests that WILL break or need edits** (all in `ShareableLink.test.tsx`, ~860 lines): the two published-lane both-fail arms (Pitfall 5); arms that call `screen.getByRole("button").textContent` after a failure; the "keeps the sm classes when the mint fails" arm's `getByRole("button")` (the live region is not a button, so it keeps working); the `Manage private link` describe is unaffected except for the D05 timeout edit. Typing note: the arms with `status: 500` mocks (`{ ok: false, status: 500, json: ... }`) lack `redirected`/`url`, so `res.redirected` is `undefined` (falsy): the new redirect branch must tolerate that.
- **FactsheetView arms that stay green only if the helper is built right:** `"a clipboard denial leaves the label alone..."` is the PUBLISHED lane (`copyPublishedUrl`, byte-unchanged, D-09) and is not touched. The mint-lane arms `"a successful mint whose CLIPBOARD write is denied still fails visibly"` and `"an ABSENT clipboard API fails..."` (`share-affordance.test.tsx`, ~340-380) must still end in `Couldn't copy the link — try again`: with the shared helper, `[VERIFIED: one-line vitest probe this session]` jsdom's `document.execCommand` is `undefined` (`typeof ... === "undefined"` passed), so the fallback `try` must catch the `TypeError` and return false (this is the same path the existing ShareableLink arm 4 covers). Add a hang arm there: `vi.useFakeTimers({ shouldAdvanceTime: true })`, clipboard `writeText` returns a never-settling promise, advance past 3000 ms (`await act(async () => { await vi.advanceTimersByTimeAsync(3500); })`, the exact idiom at `ShareableLink.test.tsx` ~739-759), expect the label `Couldn't copy the link — try again` and the button enabled.
- `FactsheetView.tsx` imports `{ shareAffordanceMode, mintShareUrl, type ShareAffordanceMode }` from `@/components/strategy/ShareableLink` (lines 36-41); add `copyTextBounded` to that import. Both files are `"use client"`, so calling an exported function across them is legal.

## Gate census: tests/lints that read these files (focus item 5)

Measured with `grep -a -rn` for `ShareableLink`, `View in dashboard`, `No strategies published yet` over `src scripts e2e tests`:

| Gate | What it reads | Constraint on this phase |
|------|---------------|--------------------------|
| `src/__tests__/display-sign-single-source.test.ts:1046-1051` | R5 allowlist: `"src/components/strategy/ShareableLink.tsx": { R5: { count: 2, reason: "The warning icon beside 'Copy failed' and 'Couldn't create the link'; error icons, no figure." } }`; R5 matches any `(text|bg|border|stroke|fill|ring|outline|shadow|from|via|to|divide|decoration|accent|caret)-negative`, `var(--color-negative…)`, `#DC2626`, `CHART_NEGATIVE` after comment-stripping | ShareableLink must keep exactly 2 negative tokens. `[VERIFIED: display-sign-single-source.test.ts:78-97]` `SCAN_DIRS` is exactly `src/app/factsheet`, `src/app/api/og`, `src/components/strategy-v2`, `src/components/charts`, `src/app/(dashboard)/allocations/components`, `src/app/(dashboard)/allocations/widgets`, `src/components/portfolio`, `src/components/strategy`, and `SCAN_FILES` lists six single files; `src/app/browse` is in neither, so the UI-SPEC's browse error shell (`border-negative/30 bg-negative/5`) needs no allowlist entry. `src/components/strategy` IS scanned, so `ShareableLink.tsx` is covered. New `text-negative` in a CLASS or code in ShareableLink raises the count; comments are stripped, but avoid writing the tokens in comments anyway. |
| `src/__tests__/critical-regressions.test.ts:366-380` | source-text pins on `ShareableLink.tsx`: `/fallbackSucceeded/` and `/copyFailed/` plus `/Copy failed/` | The lifted helper must still contain the identifier `fallbackSucceeded` in this file, and the `copyFailed` state plus the `Copy failed` string must remain. |
| `src/__tests__/trim-removed-surfaces.test.tsx:429-437, 576-589` | `files` list contains `src/lib/email.ts` and `expect(code("src/lib/email.ts")).toContain("${APP_URL}/allocations")`; `["src/app/browse/page.tsx", 1]` exactly one `<Disclaimer` tag; `["src/app/browse/layout.tsx", 0]` | Keep `${APP_URL}/allocations` in email.ts; keep exactly ONE `<Disclaimer` in `browse/page.tsx` (do not duplicate per branch). |
| `src/__tests__/one-strategy-page-links.test.ts` | retired-route and raw factsheet-route templates; ShareableLink explicitly out of scope (builds from `window.location.origin`) | The published-lane URL line stays `${window.location.origin}/factsheet/${strategyId}`; do not add a second raw route template. |
| `scripts/copy-census/*` + `src/__tests__/copy-census.test.ts` | Rule A retired words (`portfolio`, `book`, `favorites`, `starred`, `preference`, `my strategies`, `My Allocation`, `My Watchlist`, `Bridge`) in JSX text/user attrs/prose strings across all of `src/`; Rule B registered glossary terms in label positions under `src/app` and `src/components` | None of the UI-SPEC strings contains a retired word. Digest text "Open your allocation →" is clean (note `My Allocation` is the retired capitalised form; the spec uses lower-case "your allocation"). Run the census after writing. |
| `src/__tests__/public-truth-census.test.tsx` | public-site phrases (192 PUBLICTRUTH) | not touched by these strings; run in the full suite |
| `src/components/ui/LiveRegion.test.tsx` + `contracts-registry.test.ts:214` | LiveRegion stays exactly `sr-only` | Do not pass a className to `LiveRegion`; adopting it adds no registry entry (the registry lists tests, not adopters) |
| e2e `axe-app-wide`, `no-clip-sweep`, `reflow-sweep` (`path: "/browse", anchor: "main h1"`) | h1 exists in all three states; the UNSEEDED job runs on a placeholder Supabase, so these rows now render the ERROR block (Pitfall 4b) | All three states keep the `h1`; the error block uses a button-styled link (not inline prose) so `link-in-text-block` cannot fire per the UI-SPEC; verify locally with the closed-port server |
| ESLint `core-web-vitals` incl. `@next/next/no-html-link-for-pages` | `<a href="/…">` | use `Link` |
| `no-raw-font-px` lint (UI-SPEC) | raw px font sizes | use the token classes the spec names |
| `package.json` `lint`: `eslint ... src/ && tsx scripts/check-admin-route-manifest.ts && ... check-planning-hygiene.ts ...` | whole `src/` | run before ship |

Baseline measured at HEAD: `npx vitest run src/app/browse src/lib/email.test.ts src/lib/queries.anon-read-errors.test.ts src/__tests__/copy-census.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/critical-regressions.test.ts "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"` -> `Test Files 12 passed (12) / Tests 374 passed (374)`, 6.77 s.

## Digest wording notes (focus item: Surface A)

- Change `src/lib/email.ts:1003` text node only: `View in dashboard →` -> `Open your allocation →` (U+2192 kept). Inline styles unchanged (`font-weight:500;color:${BRAND_COLOR}`). Link `href="${APP_URL}/allocations"` unchanged (also required by `trim-removed-surfaces`).
- Update `src/lib/email.test.ts` arm "alert digest 'View in dashboard' link targets /allocations, not the retired portfolios route" (current assertions: `toContain('href="https://app.example.test/allocations"')`, `toContain("View in dashboard →")`, `not.toContain("/portfolios")`): keep the href assertion, flip the label to `toContain("Open your allocation →")` and add `not.toContain("View in dashboard")` and, per UI-SPEC "Never present", `not.toMatch(/dashboard/i)` over the FIXED template text (use an empty/neutral alert message and portfolio name so data cannot contain the word; the existing arm uses "Core book" and "Drawdown breached the limit", neither contains "dashboard"). Rename the arm and its lead comment (the Phase 195 comment at ~546-548 quotes the old label).
- Only other occurrence of the old label repo-wide (`grep -a -rn "View in dashboard" src scripts e2e tests docs analytics-service`): `email.ts:1003`, `email.test.ts:546,549,566`. Neuter target for RED proof: restore the old label.

## D-09 recipe: one-off Playwright WebKit iPhone check (focus item 6)

Validated this session (baseline at HEAD, before the new Copy button exists). No CI project, no committed harness.

1. Add a temporary public page (any `/browse/*` path is in `PUBLIC_ROUTES`, so no auth; the static segment beats `[slug]`): `src/app/browse/harness-208/page.tsx`:
   ```tsx
   "use client";
   import { ShareableLink } from "@/components/strategy/ShareableLink";
   export default function Harness208() {
     return (<div style={{ padding: 24 }}>
       <ShareableLink strategyId="11111111-1111-4111-8111-111111111111" published={false} size="sm" />
     </div>);
   }
   ```
   (Add a second harness or a query switch to exercise the published lane: `published` true.)
2. Start the server with a closed-port Supabase so no real backend or secrets are involved (the layout's `hasBrowseSession` tolerates the failure, measured): `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon SUPABASE_SERVICE_ROLE_KEY=svc ADMIN_EMAIL=a@b.c NEXT_PUBLIC_APP_URL=http://localhost:3208 NEXT_PUBLIC_SITE_URL=http://localhost:3208 NEXT_TELEMETRY_DISABLED=1 npx next dev --port 3208` (background, log to the scratchpad). First compile of `/browse` took ~10 s.
3. Run a Playwright script from OUTSIDE the repo (resolve the repo's Playwright with `createRequire('<worktree>/package.json')`): `webkit.launch()`, `newContext({ ...devices['iPhone 15'] })` (viewport 393x659, iOS 17.5 UA, measured), `addInitScript` forcing `navigator.clipboard.writeText` to reject and `document.execCommand = () => false` (natural failure path), `page.route('**/api/strategies/*/share', fulfill 200 { url })` with a 125-char placeholder URL, `goto(.../browse/harness-208)`, `getByRole('button', { name: 'Get private link' }).tap()`, wait for `getByLabel('Private link URL')`, then read `document.activeElement === field`, `selectionStart/End`, `value.length`, `scrollWidth` vs `clientWidth`, and screenshot.
4. **Baseline reading at HEAD (before the fix), recorded as the "before":** `{"active":true,"tag":"INPUT","start":0,"end":125,"len":125,"dialogOpen":true,"scrollW":924,"clientW":303}` in Playwright WebKit iPhone 15; the screenshot shows the dialog, the whole URL highlighted, the OwnerUnpublishedPanel below. The post-fix reading must additionally exercise: tap the new `Copy link` button (expect the visible `Copy failed` label and the field re-selected 0..len while writes are forced to fail), the published-lane dialog (title `Public link`, no panel), and the field + button layout at 393 px (`min-w-0 flex-1` field beside the button; read `getBoundingClientRect` of both to confirm no horizontal page overflow).
5. **Honest limit to write into SUMMARY/VERIFICATION:** Playwright WebKit on a mobile device profile is the WebKit engine with an iPhone viewport/UA/touch emulation, not iOS Safari; it shows the selection API works in that engine but cannot reproduce iOS's real "focus()/select() outside a user gesture is ignored". The TODO and D-09 both accept "Playwright WebKit on a mobile profile", so this satisfies "Done" as written, but the recorded reading should say what it does and does not prove (the Copy button, which is gesture-driven, is the actual mitigation).
6. Teardown (mandatory): delete `src/app/browse/harness-208/`, kill the dev server (`pkill -f "next dev --port 3208"`), `git checkout -- AGENTS.md` (Pitfall 7), confirm `git status --short` is clean of everything but intended files.

Also WebKit is installed (`~/Library/Caches/ms-playwright/webkit-2370`); `npx playwright --version` -> `Version 1.64.1`.

## Code Examples

### ShareMintError + status mapping (shape, not final code)
```typescript
// src/components/strategy/ShareableLink.tsx
export class ShareMintError extends Error {
  constructor(public readonly status: number | null, message: string) { super(message); this.name = "ShareMintError"; }
}
// mintShareUrl: keep every existing throw, but make the first two status-carrying
if (res.redirected && new URL(res.url).pathname === "/login") throw new ShareMintError(401, "share mint redirected to login");
if (!res.ok) throw new ShareMintError(res.status, `share mint failed: ${res.status}`);
// ...unchanged: body.url missing -> new ShareMintError(null, "share mint returned no url")
function mintFailureKind(err: unknown): "signed-out" | "forbidden" | "other" {
  const s = err instanceof ShareMintError ? err.status : null;
  return s === 401 ? "signed-out" : s === 403 || s === 404 ? "forbidden" : "other";
}
```
`new URL(res.url)` can throw on an empty `res.url` (test mocks omit it): guard with `res.redirected === true` first (as written) and wrap in try/catch or use `res.url?.endsWith("/login")`.

### Browse error block (UI-SPEC, exact)
Copied from `208-UI-SPEC.md` "Error block (exact markup contract)": `<div role="alert" className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3">` + title `We couldn't load the strategy categories.` + body `No categories are listed because the read failed, not because nothing is published.` + `<Link href="/browse" prefetch={false} className={buttonClassName({ size: "sm", className: "mt-3 pointer-coarse:min-h-[44px]" })}>Try again</Link>`. In JSX write apostrophes as `&apos;`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `staleTimes.dynamic` default 30 s | default 0 s (not cached) | Next 15.0.0 `[CITED: staleTimes.md "Version History"]` | same-URL dynamic navigation hits the server, so "Try again" works without extra cache busting |
| Pages-only `no-html-link-for-pages` | rule also reads `src/app` routes | in the installed plugin `[VERIFIED: rule source]` | `<a href>` to app routes is lint-flagged |
| `next/dynamic` as `React.lazy` wrapper (older mental model) | react-loadable with a module-level singleton subscription | in this Next 16.4.2 `[VERIFIED: loadable.shared-runtime.js]` | explains why only the first mount in a file pays the import |

**Deprecated/outdated:** the TODO text "retries a 403 for ever" (really a 404 for lost ownership, per D-06) and the TODO D05-RED "not strictly deterministic" framing (warm-up landed after it was logged).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CI D05-RED failures were the cold dynamic import of `FactsheetView` (not reproduced locally cold: 143-407 ms, green) | D05-RED root cause | Medium: the explicit-timeout belt-and-braces would be addressing a cause that is something else; low cost to add anyway |
| A2 | A `Link` click behaves like the measured `router.push('/browse')` for re-running the server read in a production build (measured in dev only, no prefetch) | Pitfall 4 | Low-medium: if a production prefetch served a cached payload the retry would show the same error; `prefetch={false}` + dynamic `staleTimes` 0 doc make this unlikely; one manual click is already in the UI-SPEC |
| A3 | Cookie-less signed-out requests from a real logged-out/expired tab are the dominant "signed out" path (vs cookie-present 401) | Pitfall 1 | Low: the redirect mapping is additive and correct either way |
| A4 | In real iOS Safari the dialog fallback also needs the host inside the dialog (WebKit engine measured; iOS Safari not tested) | Pitfall 2 | Low: placing the temp input inside the dialog is harmless in every engine measured |
| A5 | Dev-mode `router.push` produced one server render per push (the extra ~16 ms GET per push was not identified; likely a dev RSC/flight side request) | Pitfall 4 | Low: the slow 3-7 s GETs that re-run the failing read match 1:1 with pushes |

## Open Questions (RESOLVED)

All three were resolved 2026-11-14 in `208-CONTEXT.md`: Q1 → D-13, Q2 → D-14, Q3 → D-15.

1. **Map the redirect-to-/login mint response to the 401 message?**
   - Known: cookie-less POST gets 307 -> `/login`; `fetch` follows to HTML 200; today that lands in "Couldn't create the link — try again" forever.
   - Unclear: whether the founder wants this recorded as a decision (it is inside D-06's stated purpose but is more than "status carries through").
   - Recommendation: do it (3 lines + 1 test arm) and note it in the SUMMARY; it is the only way the 401 wording is reachable for the common case. No route/proxy change.
   - RESOLVED: D-13.
2. **What should an `"ok"` read that matches zero known `DISCOVERY_CATEGORIES` render?** Recommend treat as `"empty"` (decide in the plan; one-line rule). RESOLVED: D-14.
3. **Boolean vs throwing helper** (discretion): recommendation boolean `copyTextBounded(text, { strategyId, host })` so row, dialog and FactsheetView stay branch-simple; the helper owns logging. RESOLVED: D-15.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | everything | yes | v25.8.1 | — |
| vitest (via npx) | all gates | yes | repo-pinned 4.x | — |
| Playwright + WebKit | D-09 one-off | yes | 1.64.1, `webkit-2370` installed | — |
| next dev (port 3208) | D-09 + manual Try again click | yes | 16.4.2 | — |
| Real Supabase | none needed | n/a | the harness uses a closed-port URL | — |
| `gsd-tools` seam / Context7 | research tooling | not used (authoritative sources were the installed Next docs and source) | — | — |

Missing dependencies: none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (jsdom project) + Testing Library; `renderToStaticMarkup` for server pages |
| Config file | `vitest.config.ts` (`maxWorkers = cpus - 1`; includes `src/**/*.test.{ts,tsx}`) |
| Quick run command | `npx vitest run src/app/browse src/lib/email.test.ts src/lib/queries.anon-read-errors.test.ts` (~7 s) |
| ShareableLink file | `npx vitest run src/components/strategy/ShareableLink.test.tsx` (~13 s; one file per invocation) |
| Gate set | `npx vitest run src/__tests__/copy-census.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/critical-regressions.test.ts "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"` |
| Full suite | `npm test` (`vitest run`) |
| Static | `npm run typecheck` (`tsc --noEmit`) and `npm run lint` |

### Phase Requirements -> Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? | Neuter target (D-12 RED proof) |
|-----|----------|-----------|-------------------|-------------|--------------------------------|
| SC-1 | digest label `Open your allocation →`, href `/allocations`, no old label, no `/portfolios`, no `dashboard` in fixed text | unit | `npx vitest run src/lib/email.test.ts` | arm exists (edit) | restore `View in dashboard →` |
| SC-2a | helper throws + Sentry on error; `[]` quiet on empty | unit | `npx vitest run src/lib/queries.anon-read-errors.test.ts` | file exists, arms new | restore `return [];` in error branch |
| SC-2b | page: empty line, no cards; error `role="alert"` + title/body + `Try again` -> `/browse`; no redirect, no cards | unit (static markup) | `npx vitest run src/app/browse/page.test.tsx` | edit 2 arms | map catch to `"empty"` / render cards on error |
| SC-2c | breadcrumb keeps link on failed read | unit | `npx vitest run src/app/browse/breadcrumb-root.test.tsx` | exists, passes unchanged | n/a (regression pin) |
| SC-3a | each catch logs `{ strategyId, err }` with `[ShareableLink]` tag, no URL in any `console.warn` arg | component | `npx vitest run src/components/strategy/ShareableLink.test.tsx` | new arms | remove one `console.warn` per catch (mint / bounded write / fallback / dialog copy) |
| SC-3b | 401 (and redirect-to-login), 403, 404 wording; 500/429/503/network/empty body keep "try again"; 401/403/404 labels contain neither "try again" nor "retry" | component | same file | new arms | collapse mapping to one string |
| SC-3c | live region: `role="status"` carries the exact failure label while shown, `null` otherwise; always mounted | component | same file | new arms | drop `LiveRegion` / pass wrong message |
| SC-3d | dialog Copy: `writeText` called with the shown URL, `fetch` NOT called, outcomes `Copied` / `Copy failed` (field re-selected 0..len) | component | same file | new arms | make handler call `mintShareUrl` first / drop `setSelectionRange` |
| SC-3e | hanging clipboard ends visibly failed in dialog (fake timers 3.5 s) and in `mintAndCopy` | component | same file + `FactsheetView.share-affordance.test.tsx` | new arms | remove the bound from the helper (both go RED: single helper) |
| SC-3f | published lane: both copy paths fail -> URL on screen (`Public link URL` field, title `Public link`, no `OwnerUnpublishedPanel`/`Revoke link`) | component | same file | new arm | restore `mint-token`-only dialog gate |
| SC-3g | host element: temp input is appended inside the dialog when `host` is passed | component | same file | new arm | append to body always |
| SC-3h (D-09) | WebKit iPhone reading recorded | manual one-off | recipe above | n/a | n/a |
| D05-RED | D-05 arm green repeatedly under load | component | `npx vitest run src/components/strategy/ShareableLink.test.tsx` x3 quiet + x3 under 24 `yes` processes | exists | **No RED proof is reproducible locally.** Removing the warm-up stayed green here (143-407 ms cold, measured). The honest closing evidence is: mechanism cited (loadable singleton), the two protections present (file-level warm-up + explicit commented timeout), and repeated green runs quiet and loaded. Do not claim a neuter-RED for this item; say so in the SUMMARY (D-12 covers the six behaviour fixes, not this test-hardening item). |
| Gates | R5 count 2, `fallbackSucceeded`/`copyFailed`, one `<Disclaimer`, `${APP_URL}/allocations`, copy census | static | the gate-set command above | exist | n/a |

### Sampling Rate
- **Per task commit:** the relevant row's quick command (browse/email/queries ~7 s; ShareableLink ~13 s).
- **Per wave merge:** gate set + both quick commands + `npm run typecheck`.
- **Phase gate:** `npm test` green, `npm run lint` green, D05 arm 3 quiet + 3 loaded passes, D-09 reading recorded, `git status` clean of `AGENTS.md`/harness.

### Wave 0 Gaps
- None for framework (vitest + RTL present). New test files: none strictly required; helper arms can live in `queries.anon-read-errors.test.ts` (needs a `seeded.data` extension for a rows arm) or a new `queries.populated-slugs.test.ts`. Planner choice; both are in `src/**` so the include glob collects them.
- Fake-timer helpers already in `ShareableLink.test.tsx` (`vi.useFakeTimers({ shouldAdvanceTime: true })` + `advanceTimersByTimeAsync`) and a `console.warn` spy idiom in `FactsheetView.share-affordance.test.tsx` (`vi.spyOn(console, "warn").mockImplementation(() => {})`); reuse them.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no change) | the mint route and proxy are untouched; only the client messaging changes |
| V3 Session Management | no | untouched |
| V4 Access Control | no | 404-not-403 existence-hiding stays server-side; the client maps both to one non-revealing message (`You can't share this strategy here` does not distinguish "not yours" from "unknown id", preserving T-164-03) |
| V5 Input Validation | yes (light) | email template interpolates `escapeHtml` data only; the changed link text is a static literal. No user input reaches the new strings |
| V7 Error Handling and Logging | yes | log `{ strategyId, err }` only; never the capability URL or token (D-05). `ShareMintError.message` carries only a status |
| V8 Data Protection | yes | the minted URL is a capability: not logged, not stored in module state; the published URL is public but is still not logged |
| V6 Cryptography | no | none |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Capability URL leaks into logs/Sentry via an error object | Information disclosure | build `err` messages from status only; assert in tests that no `console.warn` argument contains the minted URL substring |
| Status-distinguishing message reveals row existence (403 vs 404) | Information disclosure | one shared 403/404 string, as specified |
| Open redirect via `Try again` | Tampering | the href is the literal `/browse`; the redirect slug comes from the fixed `DISCOVERY_CATEGORIES` list (existing, unchanged) |

## Sources

### Primary (HIGH confidence)
- In-repo reads this session: `208-CONTEXT.md`, `208-UI-SPEC.md`, `ShareableLink.tsx`, `ShareableLink.test.tsx` (full), `FactsheetView.tsx` (`ShareLinkButton`, `OwnerUnpublishedPanel`), `FactsheetView.share-affordance.test.tsx` (helpers + failure arms), `queries.ts` (1440-1500), `browse-categories.ts`, `browse/page.tsx`, `browse/[slug]/page.tsx`, `(dashboard)/layout.tsx` (80-115), `page.test.tsx`, `breadcrumb-root.test.tsx`, `disclaimer-once.test.tsx`, `queries.anon-read-errors.test.ts`, `email.ts` (935-1020), `email.test.ts` (530-580), `LiveRegion.tsx`, `Modal.tsx`, `Input.tsx`, `Button.tsx`, `proxy.ts` (19, 60-100), `share/route.ts` (status arms), `display-sign-single-source.test.ts` (R5), `critical-regressions.test.ts` (366-380), `trim-removed-surfaces.test.tsx`, `copy-census/policy.ts`, `TODOS.md` entries (lines 1149-1154, 3718, 3724).
- Installed Next 16.4.2 docs/source: `docs/01-app/02-guides/prefetching.md`, `.../staleTimes.md`, `.../link.md`, `shared/lib/dynamic.js`, `shared/lib/loadable.shared-runtime.js`, `@next/eslint-plugin-next/.../no-html-link-for-pages.js`.
- Measurements this session: vitest runs (3 quiet, 4 loaded, 3 cold-no-warmup copies); `next dev` + Playwright Chromium same-URL navigation; `curl` POST to the mint route; Playwright WebKit iPhone 15 harness run + screenshot; standalone Playwright `execCommand` probe in chromium / webkit-iPhone / webkit-desktop.

### Process notes (what was NOT run)
- The `init.phase-op`, graph (`graphify`), and `research-plan` / `research-store` / `classify-confidence` seam steps were not run: the worktree was given a fixed scope and every claim here comes from reading in-repo files, the installed Next 16.4.2 docs/source, and direct measurement. No web search or Context7 call was made (the latter needs authentication and the installed docs were authoritative for the Next questions). `package-legitimacy` was not run because no package is added.
- `.planning/REQUIREMENTS.md` (88 lines, milestone v1.18 MT5-VERIFY) and `.planning/STATE.md` (frontmatter `stopped_at: Phase 208 UI-SPEC approved`) were read: neither carries a Phase 208 requirement or constraint beyond what CONTEXT and ROADMAP already state ("Independent of the v1.18 MT5 phases").

### Secondary (MEDIUM confidence)
- none

### Tertiary (LOW confidence)
- none (no web search was needed; the installed docs and source were authoritative)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new; every primitive read.
- Architecture / caller inventory: HIGH, exhaustive grep plus file reads.
- Pitfalls: HIGH for 1, 2, 3, 5, 7 (measured); MEDIUM for 4 (dev-only measurement) and 8.
- D05-RED: HIGH on mechanism and current green state; the CI-failure attribution is `[ASSUMED]` (A1).

**Research date:** 2026-11-14
**Valid until:** 2026-12-14 (Next 16.4.2 pinned; re-measure if Next or `ShareableLink.tsx` moves)
