# Phase 208: UIQUICK - Pattern Map

**Mapped:** 2026-11-14
**Files analyzed:** 12 (0 new source files; 7 source files modified, 5 test files modified or extended)
**Analogs found:** 12 / 12 (every file is its own analog for the code it changes; cross-file analogs named where a new construct is added)

All paths below were verified git-tracked (`git ls-files`). Line numbers were read at HEAD of this worktree and drift on the first edit; re-anchor by symbol.

## File Classification

| Modified file | Role | Data flow | Closest analog | Match |
|---------------|------|-----------|----------------|-------|
| `src/lib/email.ts` (`sendAlertDigest`, l.1002-1004) | utility (email template) | transform (static HTML) | itself; sibling `src/lib/email.test.ts` arm | exact |
| `src/lib/email.test.ts` (l.546-568) | test | request-response (stubbed send) | the same arm | exact |
| `src/lib/queries.ts` (`getPopulatedCategorySlugs`, l.1459-1481) | service (read helper) | CRUD read | `failAnonRead` (l.609-613) + `getStrategiesByCategory` | exact |
| `src/lib/queries.anon-read-errors.test.ts` (or new `queries.populated-slugs.test.ts`) | test | CRUD read | its own `getStrategiesByCategory` describe (l.86-104) | exact |
| `src/app/browse/browse-categories.ts` | service (page rule) | transform | itself (tri-state per RESEARCH Pattern 2) | exact |
| `src/app/browse/page.tsx` | component (server page) | request-response (SSR) | itself; `src/app/factsheet/[id]/tearsheet/page.tsx` for `Link` + `buttonClassName` | exact |
| `src/app/browse/page.test.tsx` | test | request-response (`renderToStaticMarkup`) | itself (header + `render()` helper) | exact |
| `src/components/strategy/ShareableLink.tsx` | component (client) + exported helpers | request-response + event-driven (click, clipboard, timers) | itself; `LiveRegion` + `Modal` + `Input` primitives | exact |
| `src/components/strategy/ShareableLink.test.tsx` | test | event-driven | itself (`mount`, `clickGet`, `findField`, fake-timer arm) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`ShareLinkButton.mintAndCopy`, l.2777-2803) | component (client) | request-response | itself (catch + `console.warn` already present) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx` | test | event-driven | its arms l.344-375 | exact |
| D-09 harness `src/app/browse/harness-208/page.tsx` (temporary, never committed) | page (throwaway) | manual check | RESEARCH "D-09 recipe" | recipe-only |

## Pattern Assignments

### `src/lib/email.ts` (utility, transform)

**Analog:** itself. One text node at l.1002-1004 changes; the `href` must keep `${APP_URL}/allocations` (pinned by `src/__tests__/trim-removed-surfaces.test.tsx`).

```html
<a href="${APP_URL}/allocations" style="color:${BRAND_COLOR};font-weight:500;">
  View in dashboard →          <!-- becomes: Open your allocation → (U+2192 kept) -->
</a>
```

**Test** (`src/lib/email.test.ts` l.546-568) rename the arm and flip assertions. Keep the existing scaffold:

```typescript
vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
vi.resetModules();
const { sendAlertDigest } = await import("./email");
await sendAlertDigest("allocator@example.com", "Core book", [ { id: "a-1", severity: "high",
  message: "Drawdown breached the limit", triggered_at: "2026-11-07T00:00:00Z" } ] as unknown as Parameters<typeof sendAlertDigest>[2]);
const html = state.sendCalls[0].html as string;
expect(html).toContain('href="https://app.example.test/allocations"');
expect(html).toContain("Open your allocation →");
expect(html).not.toContain("View in dashboard");
expect(html).not.toMatch(/dashboard/i);   // fixed template text; data ("Core book", message) has no such word
expect(html).not.toContain("/portfolios");
```

Neuter for RED: restore the old label.

---

### `src/lib/queries.ts` `getPopulatedCategorySlugs` (service, CRUD read)

**Analog:** `failAnonRead` in the same file (l.609-613), whose docblock already states the contract "a read error is reported to Sentry and THROWN":

```typescript
function failAnonRead(op: string, subject: string, error: { code?: string; message?: string }): never {
  console.error(`[queries.${op}] supabase error:`, error.message ?? error);
  captureToSentry(error, { tags: { op, code: error.code ?? "none" }, level: "error" });
  throw new Error(`${op}(${subject}) failed: ${error.message ?? "unknown error"}`);
}
```

**Change** (l.1473-1477): replace the hand-rolled `console.error` + `captureToSentry` + `return [];` with `failAnonRead("getPopulatedCategorySlugs", "published", error);`, keep `if (!data) return [];`, and rewrite the stale NEW-C03-06 comment above it. Side effects to state in the plan: Sentry tags gain `code`; the thrown message is `getPopulatedCategorySlugs(published) failed: <message>`.

**Helper test analog** (`queries.anon-read-errors.test.ts` l.86-104). Reuse `seeded`, `PERMISSION_DENIED`, the Sentry capture mock and the `console.error` spy in `beforeEach`:

```typescript
it("throws on a 42501 and reports it to Sentry with the op and the code", async () => {
  seeded.error = PERMISSION_DENIED;
  await expect(getPopulatedCategorySlugs()).rejects.toThrow(/getPopulatedCategorySlugs.*failed/);
  expect(seeded.sentry).toHaveLength(1);
  expect(seeded.sentry[0].opts).toEqual({ tags: { op: "getPopulatedCategorySlugs", code: "42501" }, level: "error" });
});
it("still returns [] and stays quiet for a genuinely empty read", async () => {
  seeded.error = null;
  await expect(getPopulatedCategorySlugs()).resolves.toEqual([]);
  expect(seeded.sentry).toHaveLength(0);
});
```

The mock always answers `data: null`, so a rows-to-slugs arm needs a `seeded.data` field added to `buildChain` (both `single` and `then`) or a new `queries.populated-slugs.test.ts`. Add `getPopulatedCategorySlugs` to the `import { ... } from "./queries"` line (l.65). Neuter: restore `return [];` in the error branch.

---

### `src/app/browse/browse-categories.ts` (service, transform)

**Analog:** itself (current body l.17-35). Target shape from RESEARCH Pattern 2, plus D-14:

```typescript
export type BrowseReadState = "ok" | "empty" | "error";
export async function getBrowseCategories() {
  let populatedSlugs: string[] = [];
  let state: BrowseReadState;
  try {
    populatedSlugs = await getPopulatedCategorySlugs();
    state = populatedSlugs.length > 0 ? "ok" : "empty";
  } catch {
    state = "error";   // already logged + captured at the source: do NOT capture again
  }
  const categories = state === "ok" ? DISCOVERY_CATEGORIES.filter((c) => populatedSlugs.includes(c.slug)) : [];
  if (state === "ok" && categories.length === 0) state = "empty";   // D-14
  const onlySlug = state === "ok" && categories.length === 1 ? categories[0].slug : null;
  return { state, categories, onlySlug };
}
```

Rewrite the docblock sentence "returns [] for both an empty result and a DB error", now false. `src/app/browse/[slug]/page.tsx:45` destructures `onlySlug` only, so it needs no edit. `src/app/(dashboard)/layout.tsx:94-103` already try/catches: no edit.

---

### `src/app/browse/page.tsx` (server component, request-response)

**Analog:** itself (imports l.1-5, empty line l.58-62) and `src/app/factsheet/[id]/tearsheet/page.tsx` (l.2, l.7, l.225), which already calls `buttonClassName` from a server page next to `next/link`:

```tsx
import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
// ...
<Link href={buildFactsheetHref(id)} className={buttonClassName({ variant: "secondary", size: "md", className: "mt-6" })}>
```

**Changes** (markup is pinned verbatim by `208-UI-SPEC.md` "Error block"; apostrophe as `&apos;`):
- `const { state, categories, onlySlug } = await getBrowseCategories();`. The redirect stays gated on `onlySlug` (already `ok`-only).
- Card grid renders only when `state === "ok"`. Key the empty line on `state === "empty"` (today `categories.length === 0`, which cannot render). Add the `state === "error"` block:

```tsx
<div role="alert" className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3">
  <p className="text-base font-semibold text-text-primary">We couldn&apos;t load the strategy categories.</p>
  <p className="mt-2 text-sm text-text-secondary">No categories are listed because the read failed, not because nothing is published.</p>
  <Link href="/browse" prefetch={false} className={buttonClassName({ size: "sm", className: "mt-3 pointer-coarse:min-h-[44px]" })}>Try again</Link>
</div>
```

- Keep exactly ONE `<Disclaimer` tag in the file (`trim-removed-surfaces.test.tsx` pins 1). Never use `<a href="/browse">` (`@next/next/no-html-link-for-pages` is lint-red here).

---

### `src/app/browse/page.test.tsx` (test, request-response)

**Analog:** itself. Keep the `vi.hoisted` `populatedMock`, `redirectMock`, `getUser` mocks and the `render()` helper (l.18-52). Rewrite two arms and the header comment (l.1-17, which says ZERO/FAILED are "indistinguishable at HEAD"; it must state the Phase 195 arm is replaced on purpose, D-04):

```typescript
async function render(): Promise<string> { return renderToStaticMarkup(await BrowsePage()); }
// empty arm:  populatedMock.mockResolvedValue([]);
//   expect "No strategies published yet. Check back soon."; no href="/browse/<slug>" for any DISCOVERY_CATEGORIES;
//   no role="alert"; redirectMock not called.
// error arm:  populatedMock.mockRejectedValue(new Error("db down"));
//   expect role="alert", the UI-SPEC title + body, a link named "Try again" with href="/browse",
//   no category cards, no empty line, redirectMock not called.
```

Unchanged and still valid: `breadcrumb-root.test.tsx` (`mockRejectedValue(new Error("db down"))`), `disclaimer-once.test.tsx`, `[slug]/page.session.test.tsx`, `layout.unprocessed-leads.test.tsx`. Neuter: map the catch to `"empty"`, or render cards on error.

---

### `src/components/strategy/ShareableLink.tsx` (client component, event-driven)

**Analog:** itself. Excerpts to reuse or lift:

**Bounded write to lift into one exported helper** (l.110-127, keep as is):

```typescript
const CLIPBOARD_WAIT_MS = 3000;
async function writeClipboardBounded(text: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("clipboard write timed out")), CLIPBOARD_WAIT_MS);
    });
    await Promise.race([navigator.clipboard.writeText(text), timedOut]);
  } finally { clearTimeout(timer); }
}
```

**`execCommand` fallback to lift** (l.259-270). Keep the identifier `fallbackSucceeded` (pinned by `src/__tests__/critical-regressions.test.ts:366-380`, together with `copyFailed` and the `Copy failed` string):

```typescript
let fallbackSucceeded = false;
const input = document.createElement("input");
try { input.value = url; document.body.appendChild(input); input.select(); fallbackSucceeded = document.execCommand("copy"); }
catch { fallbackSucceeded = false; }
finally { if (input.parentNode) input.parentNode.removeChild(input); }
```

**New helper shape** (D-08, D-15, RESEARCH Pattern 3). Boolean return; the helper owns the logging; the host is `ctx.host ?? document.querySelector("dialog[open]") ?? document.body`:

```typescript
export async function copyTextBounded(text: string, ctx: { strategyId: string; host?: HTMLElement | null }): Promise<boolean> {
  try { await writeClipboardBounded(text); return true; }
  catch (err) { console.warn("[ShareableLink] clipboard write failed", { strategyId: ctx.strategyId, err }); }
  // ... fallback block above, appended to the resolved host;
  // catch -> console.warn("[ShareableLink] execCommand copy failed", { strategyId, err })
}
```

Sync rule (comment above `ShareableLinkProps`, l.129-142): the published lane must compute `url` synchronously and call `copyTextBounded` with NO `await` before it. Do not add a `resolveShareUrl` helper.

**Status-carrying error** (RESEARCH Code Examples). Edit `mintShareUrl` l.87-94 and add the redirect branch (D-13). Guard against `res.url` being undefined in test mocks:

```typescript
export class ShareMintError extends Error {
  constructor(public readonly status: number | null, message: string) { super(message); this.name = "ShareMintError"; }
}
if (res.redirected === true && res.url?.endsWith("/login")) throw new ShareMintError(401, "share mint redirected to login");
if (!res.ok) throw new ShareMintError(res.status, `share mint failed: ${res.status}`);
// url missing -> new ShareMintError(null, "share mint returned no url")   (message carries status only, never the URL)
```

**Mint catch** (l.231-240): bind `err`, log `console.warn("[ShareableLink] share mint failed", { strategyId, err })`, replace `useState(false)` `mintFailed` (l.216) with `null | "signed-out" | "forbidden" | "other"`, and keep the 4000 ms reset. Keep the render ternary order `copied > copyFailed > mintFailure > minting` with ONE icon in the mint-failed branch. R5 (`display-sign-single-source.test.ts:1046-1051`) pins exactly 2 negative tokens in this file, so do not write the token in a comment either. Strings per UI-SPEC: `Signed out — sign in again to share` (401), `You can't share this strategy here` (403 and 404), `Couldn't create the link — try again` (other). The first two must not contain "try again" or "retry".

**LiveRegion** (`src/components/ui/LiveRegion.tsx`; `message: string | null`, always mounted, no `className` prop). Mount as the sibling after the row `Button`, outside `Modal`, with `message` set to the visible failure label or `null`. Mount a second one inside the dialog URL block:

```tsx
import { LiveRegion } from "@/components/ui/LiveRegion";
<Button ...>{/* labels */}</Button>
<LiveRegion message={rowFailureText} />
```

**Dialog URL block** (current l.364-379, `Modal` l.358-363). Generalise `mintedUrl` into a `dialogUrl` state serving both lanes. Gate the URL block on `panelOpen && dialogUrl`, and gate `OwnerUnpublishedPanel` on `panelOpen && !published` (Modal stays mounted: `modalMounted` never goes false). Title `Public link` vs `Private link`; labels `Public link URL` vs `Private link URL`; helper paragraph gets `id={helperId}` (use `useId`). Add `aria-describedby`, `wrapperClassName="min-w-0 flex-1"`, and a primary `Copy link` Button beside the `Input`, exactly as the UI-SPEC "URL row layout" block shows. The existing focus effect (l.203-208) extends to `setSelectionRange(0, value.length)`; keep the `onFocus` select on the field. Dialog Copy phases `idle | working | copied | failed` = `Copy link` | `Copying link…` | `Copied` | `Copy failed` (reset 2000 ms and 4000 ms). The click handler calls `copyTextBounded(dialogUrl, { strategyId })` directly, with no `fetch` first. Clear `dialogUrl` where `setMintedUrl(null)` is cleared today (l.394).

**Published-lane double failure** (D-10): in the `else` at l.275-288 drop the `shareAffordanceMode(published) === "mint-token"` gate, so both lanes set the dialog URL, `setModalMounted(true)` and `setPanelOpen(true)`.

---

### `src/components/strategy/ShareableLink.test.tsx` (test, event-driven)

**Analog:** itself. Reuse:
- Helpers `setClipboard`, `setExecCommand`, `STRATEGY_ID`, and the `afterEach` restore (l.66-107). Mint-lane scaffold `mount()`, `clickGet()`, `findField()`, `MINTED_URL`, `FIELD`, `fetchMock` (l.662-702).
- Hang arm idiom (l.738-759): `vi.useFakeTimers({ shouldAdvanceTime: true }); setClipboard({ writeText: vi.fn().mockReturnValue(new Promise<void>(() => {})) });` then `await act(async () => { await vi.advanceTimersByTimeAsync(3500); });`. Reuse it for the dialog Copy button and the bound.
- Log assertion idiom: `vi.spyOn(console, "warn").mockImplementation(() => {})` (as in `FactsheetView.share-affordance.test.tsx` l.173). Assert the `[ShareableLink]` tag, `{ strategyId, err }`, and that NO argument contains the minted URL substring.
- Status mocks: existing `{ ok: false, status: 500, json: ... }` lack `redirected`, which is falsy, so the redirect branch must tolerate it. The new redirect arm mocks `{ ok: true, status: 200, redirected: true, url: "https://example.test/login", json: async () => { throw new Error("html") } }`.

**Breakage to fix** (Pitfall 5): the two published-lane both-fail arms (~l.139 and ~l.159) use bare `screen.getByRole("button")`. Once D-10 opens a Modal they need `getByRole("button", { name: /Copy failed — copy the URL manually/ })`. Query failure strings by role + name and use `getAllByRole("status")`, because the label now also appears in the sr-only region. Match dialog button names as exact strings (`Copy link`, `Copying link…`, `Copied`, `Copy failed`).

**D05-RED (D-11)** (current warm-ups: `beforeAll(async () => { await import("@/app/factsheet/[id]/v2/FactsheetView"); }, 30_000)` at ~l.453 and ~l.666). Hoist ONE file-level `beforeAll` with a comment naming the `next/dynamic` loadable singleton, delete the two describe-level copies, and add `{ timeout: 5000 }` with a comment on `findByRole("button", { name: "Copy share link" })` (~l.485, 528) and `findByRole("button", { name: "Revoke link" })` (~l.548, 839, 857). Never touch a global timeout. No neuter-RED is claimed for this item.

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` `mintAndCopy` (client, request-response)

**Analog:** itself (l.2777-2803). Add `copyTextBounded` to the existing import from `@/components/strategy/ShareableLink` (l.36-41). Replace the hand-rolled clipboard block (l.2790-2797) with the shared helper. Keep `onShareLiveChange?.(true)` right after the mint, the `[factsheet] share mint/copy failed` log, `setPhase("failed")` and the 4000 ms reset. A `false` return must reach the existing catch:

```typescript
const url = await mintShareUrl(strategyId);
onShareLiveChange?.(true);
if (!(await copyTextBounded(url, { strategyId }))) throw new Error("clipboard copy failed");   // lands in the existing catch
setPhase("copied");
```

`copyPublishedUrl` and `shareButtonLabel` stay byte-unchanged (Phase 164 D-09). `ShareMintError` must not break this catch (it logs `err`).

**Test analog** (`FactsheetView.share-affordance.test.tsx` l.344-375): arms "a successful mint whose CLIPBOARD write is denied still fails visibly" and "an ABSENT clipboard API fails" use `fetchMock.mockResolvedValue(jsonResponse(200, { url: MINTED_URL }))`, `givenClipboardDenied()` / `givenNoClipboardApi()`, `renderBody({ ownerShare: { hasActiveShare: false }, viewerNotice: "owner_unpublished" })`, `fireEvent.click(shareButton(container))`, `await waitFor(() => expect(shareButton(container).textContent).toBe(LABEL_FAILED))`. They must stay green: jsdom has no `document.execCommand`, so the helper's fallback must catch the TypeError and return false. Add a hang arm in the same style: a never-settling `writeText`, `vi.useFakeTimers({ shouldAdvanceTime: true })`, advance 3500 ms inside `act`, then expect `LABEL_FAILED` and the button enabled (not stuck on `working`).

## Shared Patterns

### Honest failure: never reach the success state, log without the capability URL
**Source:** `ShareableLink.tsx` l.232-239 (audit-#43 / T-164-15) and `FactsheetView.tsx` l.2800 (`console.warn("[factsheet] share mint/copy failed", { strategyId, err })`).
**Apply to:** every catch in `ShareableLink.tsx` and the shared helper. Log `{ strategyId, err }` with the `[ShareableLink]` tag. `ShareMintError.message` carries a status only, never a URL or token.

### Throw after log + Sentry for reads
**Source:** `failAnonRead` (`src/lib/queries.ts` l.609-613).
**Apply to:** `getPopulatedCategorySlugs`. Callers (`(dashboard)/layout.tsx`, `getBrowseCategories`) already catch. Do not capture a second time in `getBrowseCategories`.

### Reuse-only UI primitives
**Source:** `src/components/ui/Button.tsx` (`buttonClassName`, no `"use client"`, callable from a server page), `Input.tsx`, `Modal.tsx`, `LiveRegion.tsx`.
**Apply to:** the browse error link, the dialog Copy button, and the live regions. No new component or token (UI-SPEC "REUSE-ONLY").

### Source-text and census gates that read these files
**Apply to:** the ShareableLink and browse plans. Run the gate set after editing:
`npx vitest run src/__tests__/copy-census.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/critical-regressions.test.ts "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"`.
Pins: R5 count 2 in `ShareableLink.tsx`; `fallbackSucceeded`, `copyFailed` and `Copy failed` present in it; `${APP_URL}/allocations` kept in `email.ts`; exactly one `<Disclaimer` in `browse/page.tsx`; no retired word in any new string (copy census).

### D-12 neuter-and-restore proof
**Apply to:** every behaviour fix. Neuter, see RED, restore from a byte backup (never `git checkout`, `restore` or `stash` on uncommitted work). Targets per fix are in `208-RESEARCH.md` "Validation Architecture".

## No Analog Found

| File | Role | Data flow | Reason |
|------|------|-----------|--------|
| WebKit iPhone one-off (D-09 harness page + Playwright script) | throwaway check | manual | Not a repo pattern. Follow `208-RESEARCH.md` "D-09 recipe" exactly. Delete `src/app/browse/harness-208/`, kill the dev server and run `git checkout -- AGENTS.md` afterwards (`next dev` rewrites it); never commit either. |

## Metadata

**Analog search scope:** `src/lib`, `src/app/browse`, `src/app/factsheet/[id]`, `src/components/strategy`, `src/components/ui`, `src/__tests__` (gate census).
**Files read:** about 14 (full: `ShareableLink.tsx`, `browse/page.tsx`, `browse-categories.ts`, `LiveRegion.tsx`; targeted ranges: `queries.ts`, `email.ts`, the four test files, `FactsheetView.tsx`, `tearsheet/page.tsx`, `critical-regressions.test.ts`).
**Pattern extraction date:** 2026-11-14
