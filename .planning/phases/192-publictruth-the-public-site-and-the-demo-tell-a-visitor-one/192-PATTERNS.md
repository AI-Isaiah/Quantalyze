# Phase 192: PUBLICTRUTH - Pattern Map

**Mapped:** 2026-11-06
**Files analyzed:** 19 new or modified (plus 9 removal-chain files)
**Analogs found:** 19 / 19 (every analog verified git-tracked with `git ls-files`)

All paths are relative to the repo root. Line numbers were read at the phase worktree's HEAD. Per the repo's own rule, the planner re-resolves a line number before citing it in a PLAN (`plan-anchor-verify`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/status-surface-copy.ts` (add `KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK`, `LISTING_COST_SENTENCE`, `EXCHANGE_LIST`) | utility (copy constants) | transform | same file, `KCS10_PUBLIC_SENTENCE` / `SHARE_CARD_COPY` / `EXCHANGE_DISPLAY` import | exact |
| `src/lib/status-surface-copy.test.ts` (add literal pins) | test | transform | same file, `KCS10-PUBLIC` pin + the oracle-independence header | exact |
| `src/__tests__/public-truth-copy.test.tsx` (new: render pins + fs census) | test | request-response (render) + file-I/O (census) | `src/__tests__/security-packet-date-drift.test.ts` (fs) + `src/app/(marketing)/security/page.test.tsx` (sync render) + `src/__tests__/display-sign-single-source.test.ts` (walk + anti-vacuity) | role-match (composite) |
| `src/app/(marketing)/page.tsx` (replace `VerificationSection` with sign-up section) | component (RSC page) | request-response | same file, footer CTA block `:255-277` | exact |
| `src/app/(marketing)/page.stat-errors.test.tsx` (drop the `VerificationSection` mock, add no-key-input pins) | test | request-response | itself | exact |
| `src/app/(marketing)/security/page.tsx` | component (RSC page) | static | itself (`id="key-handling"` `:131-139`, TLS `:106-117`, `Last reviewed` `:392`) | exact |
| `src/app/(marketing)/security/page.test.tsx` (extend) | test | static render | itself | exact |
| `src/app/(marketing)/for-quants/page.tsx` | component (RSC page) | static | itself (`TRUST_ATOMS` `:285-305`) | exact |
| `src/app/(marketing)/legal/terms/page.tsx` | component (RSC page) | static | itself (§2 `:20-30`, §7 `:73-77`, date `:15`) | exact |
| `scripts/build-security-packet.html` + `public/security-packet.pdf` | config/artifact | file-I/O (puppeteer render) | `scripts/build-security-packet.mjs` + `docs/runbooks/security-packet-update.md` | exact |
| `src/__tests__/security-packet-date-drift.test.ts` (extend with fact parity) | test | file-I/O | itself | exact |
| `src/app/(marketing)/demo/page.tsx` (fail-loud reads, drop loading card, name/hero logic) | component (RSC page) | CRUD read (admin client) | itself (Phase 1 error logging `:121-134`) + `src/app/(marketing)/page.tsx` `captureToSentry` | exact |
| `src/app/(marketing)/demo/layout.tsx` (banner copy) | component | static | itself | exact |
| `src/app/(marketing)/demo/page.truth.test.tsx` (new) | test | request-response (RSC render, mocked admin client) | `src/app/(marketing)/demo/page.max-dd-tone.test.tsx` | exact |
| `src/components/portfolio/EditorialHero.tsx` (+ tests) | component | transform | itself (`MetricCell` always renders) | exact |
| `src/lib/routing/route-contract-manifest.ts` (remove `/demo/founder-view` entry, if D-09 removes) | config | static | precedent: Rule 4 STALE in `scripts/check-route-contract.ts` | exact |
| `e2e/demo-public.spec.ts` (rewrite for loud failure) + sweeps (`reflow-sweep`, `no-clip-sweep`, `axe-app-wide`, `marketing-shell`) | test (e2e, unseeded) | request-response | `e2e/demo-public.spec.ts` + `e2e/security-page.spec.ts` | exact |
| seeded-lane `/demo` coverage | test (e2e-seeded) | request-response | `e2e/no-clip-sweep.spec.ts` `HAS_SEED_ENV` + `test.skip` seeded describe `:170-223` | exact |
| `.github/workflows/ci.yml` (drop `e2e/demo-founder-view.spec.ts` from the unseeded command `:6398`, comments `:6192`, `:6454`) | config | batch | `src/__tests__/critical-regressions.test.ts` `:1035-1060` (it pins that command) | role-match |

---

## Pattern Assignments

### `src/lib/status-surface-copy.ts` (utility, transform) - the shared-copy constants

**Analog:** same file. It is the module CONTEXT names. It already imports `closed-sets` (`EXCHANGE_DISPLAY`), so adding `EXCHANGES` is the same import line.

**Imports pattern** (lines 21-35): note the existing value import from `./closed-sets`; extend it, do not add a second import.
```typescript
import { EXCHANGE_DISPLAY } from "./closed-sets";
import type { ComputeState, RecipientArm } from "./compute-state";
```
Change to `import { EXCHANGE_DISPLAY, EXCHANGES } from "./closed-sets";`. The module has no client directive and is "called by server pages"; `closed-sets` is pure, so the import is safe. Confirm with `npx tsc --noEmit`.

**Core pattern, plain exported sentence** (lines 614-616):
```typescript
/** True in every state, no timing, no internal state (KCS10-PUBLIC). */
export const KCS10_PUBLIC_SENTENCE =
  "The detailed factsheet for this strategy is not available yet.";
```
Copy this shape for `KEY_STORAGE_SENTENCE` and `LISTING_COST_SENTENCE`: a JSDoc naming the UI-SPEC id, then a `export const X = "...";` with an ASCII apostrophe. For the link, use `export const KEY_STORAGE_LINK = { href: "/security#key-handling", label: "How we store keys" } as const;` (the `as const` object form already used by `SHARE_CARD_COPY`, `:628-641`).

**Special-character rule** (file header, lines 5-12): em dash is `EM_DASH` (U+2014) and middle dot `MIDDLE_DOT` (U+00B7), both named constants at `:36-37`. The new sentences contain none; if a sentence ever needs one, use the named constant. "Numbers inside a sentence are rendered from their constants, never typed": this is the rule that justifies `EXCHANGE_LIST` being derived.

**Derived value** (no in-file analog for `Intl.ListFormat`; RESEARCH Code Examples gives the shape):
```typescript
export const EXCHANGE_LIST = new Intl.ListFormat("en", { style: "long", type: "disjunction" })
  .format(EXCHANGES.map((e) => e.name)); // verify the field: see note
```
Note: RESEARCH passes `EXCHANGES` directly to `format`, but `EXCHANGES` is `readonly ExchangeDisplay[]` (objects, `closed-sets.ts:470`). `ListFormat.format` needs strings, so the planner must read `ExchangeDisplay`'s label field in `closed-sets.ts` and map it. Do not type the names.

**Flag-awareness caveat:** `EXCHANGES` follows `NEXT_PUBLIC_SFOX_ENABLED` (build-time), `/security`'s walkthrough follows `SFOX_ENABLED` at runtime. The census asserts list and count from `EXCHANGES` only.

---

### `src/lib/status-surface-copy.test.ts` (test, transform) - literal pins

**Analog:** same file, `KCS10-PUBLIC` pin (line 591) and the header (lines 22-29).

**Oracle independence header to keep** (lines 22-29):
```typescript
 * ORACLE INDEPENDENCE: every expected string below is typed as a literal in
 * THIS file, never imported from the module under test. ...
 * One `it` per UI-SPEC pin id; the id is in the test name.
```
**Pin pattern** (line 590-592, abridged):
```typescript
    expect(KCS10_PUBLIC_SENTENCE).toBe("The detailed factsheet for this strategy is not available yet.");
```
Add one `it` per UI-SPEC id (S-KEY, S-COST, S-EXCH), the expected sentence typed verbatim from `192-UI-SPEC.md` Copywriting Contract. For `EXCHANGE_LIST`, the expected string is derived from a literal four-name array typed in the test, not from the module (independent oracle).

**Census-style leaf walk already present** (lines ~795-805): the file has a block that spreads `...leaves(SHARE_CARD_COPY), KCS10_PUBLIC_SENTENCE, ...` into a banned-word scan. Add the three new constants to that list so the no-adjective and no-internal-term checks cover them.

---

### `src/__tests__/public-truth-copy.test.tsx` (test, render + fs census) - NEW

Three analogs, each supplying one half. The test must exercise both (UI-SPEC "Copy census gate").

**(a) Sync server page render, no mocks needed** - `src/app/(marketing)/security/page.test.tsx` lines 23-34:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SecurityPage, { metadata } from "./page";
...
    render(<SecurityPage />);
```
`/security`, Terms and `/for-quants` are plain synchronous RSCs, so `render(<Page />)` works. `/for-quants` embeds the client component `ForQuantsCtas`; mock `@/lib/supabase/client` the way `for-quants/ForQuantsCtas.test.tsx:20-25` does (`vi.hoisted` state with `getSession`), plus `@/lib/for-quants-analytics` and `@/lib/sentry-capture` if they touch the network.

**(b) Async server page render (home)** - `src/app/(marketing)/page.stat-errors.test.tsx` lines 20-69 and 71-82. Reuse the whole mock set verbatim:
```typescript
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: (err: unknown, opts: unknown) => { seeded.sentry.push({ err, opts }); } }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) }, from: (table: string) => { /* thenable chain builder */ } }) }));
import Home from "./page";
async function renderHome() { render(await Home()); }
```
Delete the now-pointless `vi.mock("@/components/landing/VerificationSection", ...)` (lines 38-40) when the import leaves `page.tsx` (RESEARCH Pitfall 7). Home-specific assertions to add: no `input[type=password]`, no text matching `/never stored/i`, exactly one link with `href="/signup"` inside `#verify`, S-KEY sentence and `/security#key-handling` link present.

**(c) fs census with anti-vacuity** - `src/__tests__/security-packet-date-drift.test.ts` lines 20-35 and 40-65 (path resolution and "throw if marker absent, never pass vacuously"):
```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const HTML_PATH = resolve(process.cwd(), "scripts", "build-security-packet.html");
const PAGE_PATH = resolve(process.cwd(), "src", "app", "(marketing)", "security", "page.tsx");
...
  if (markerIdx === -1) { throw new Error(`${label}: "Last reviewed" marker not found (markup refactored?)`); }
```
and the walk and strip helpers from `src/__tests__/display-sign-single-source.test.ts` (lines 65-66, 1224-1252):
```typescript
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
const REPO_ROOT = process.cwd();
function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}
function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) { walk(abs, out); continue; }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}
```
Adaptations: scan `src/app/(marketing)`, `src/components/landing`, plus the single file `scripts/build-security-packet.html` (not `.tsx?`, so push it by name). Strip comments with `stripCommentsPreserveLines` (`src/lib/source-scan.ts`) so a banned phrase quoted in a docblock does not red the census (that module's header explains the grep-in-comments hazard). Anti-vacuity, copied from the display-sign file's `CENSUS_FILES` idea (lines 104-110): assert the scanned list is non-empty and contains the packet HTML, `security/page.tsx` and `for-quants/page.tsx` by name.

**Banned list** (UI-SPEC census gate, verbatim): `never stored.`, `AES-256-GCM`, `Supabase Vault`, `TLS 1.0, 1.1, and 1.2`, `qualified allocators only`, `Retail discovery never sees`, `Binance, OKX, or Bybit`, `Demo data is loading`, `Recommendations computing`, `Strong fit for this allocator`, and regex `/(Strategy|Exploratory) #[0-9a-f]{8}/`.

**Caveat to resolve in the plan:** `src/components/landing/VerificationForm.tsx:219` still says "Your keys are never stored." and the component stays on disk (RESEARCH Pitfall 7). Either scope the source scan to rendered output (render Home and assert) or edit that one line; do not leave the source scan and the "leave the components" rule in contradiction. Two wizard files (`ConnectKeyStep.tsx:198`, `MultiKeyConnectStep.tsx:225`) carry the same false AES-256-GCM text and sit outside the scanned tree on purpose (Open Question 4); if the founder pulls them in, extend the scan roots.

**RED-then-restore:** repo rule. `cp` a byte backup of the page, reinstate the banned phrase, show RED naming it, restore from backup. Never `git checkout/restore/stash`.

---

### `src/app/(marketing)/page.tsx` (RSC page) - sign-up section replaces the key form

**Analog:** the same file's footer CTA, lines 255-277. Copy it byte for byte (UI-SPEC: "class string of the Get Started link, byte for byte", left-aligned layout).

**Section layout and CTA class string** (lines 255-277):
```tsx
      {/* CTA */}
      <section className="border-t border-border bg-page">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-h2 tracking-tight text-text-primary">
                Ready to see verified performance?
              </h2>
              <p className="mt-3 text-text-secondary">
                Join the marketplace where every number is backed by exchange data.
              </p>
            </div>
            <Link
              href="/signup"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-accent px-6 py-3 text-body font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>
```
**What it replaces** (lines 201-213): the `<section className="mx-auto max-w-6xl px-6 py-20" id="verify">` with the centred header and `<VerificationSection />`. Keep `id="verify"`. Remove the import at line 8 (`import { VerificationSection } from "@/components/landing/VerificationSection";`). `Link` (line 2) and `EXCHANGES` (line 6, `from "@/lib/constants"`) are already imported. New imports: the shared constants from `@/lib/status-surface-copy`.

**Exchange count reads** (lines 145, 245): `{EXCHANGES.length} exchanges supported` already read the shared value; leave unchanged (D-06).

**Redirect for signed-in users** (UI-SPEC: lines 70-72): untouched, which is why the section replaces outright instead of branching.

**Inline link class for the S-KEY link:** `text-accent underline underline-offset-4` (DESIGN.md 2026-06-28, WCAG 1.4.1).

---

### `src/app/(marketing)/security/page.tsx`, `for-quants/page.tsx`, `legal/terms/page.tsx` (RSC pages, static)

**Analog:** each file itself. The edit is a copy swap at the lines named in the UI-SPEC tables; the structural pattern to keep:

`/security` TLS paragraph to rewrite (lines 106-117, current text):
```tsx
                1.3. We disable TLS 1.0, 1.1, and 1.2 at the edge; internal
                service-to-service calls use the same profile. Certificates ...
```
`/security` anchor to preserve (lines 131-139): `<section aria-labelledby="key-handling" ...>` and `<h2 id="key-handling" ...>Key handling</h2>`. `security/page.test.tsx` header says every `aria-labelledby` ID and `Section id` "must stay byte-identical because wizard error `docsHref` deep-links ... land on `/security#...`". The S-KEY link target `/security#key-handling` depends on it.

`/security` role-name `<code>` style to keep (lines ~148-155): `<code className="rounded bg-page px-1 py-0.5 font-mono text-caption">anon</code>`.

`/security` date (line 392): `Last reviewed: 2026-10-07.` Bump together with the packet HTML (see the date-drift test below).

`/for-quants` data array to edit (lines 285-305), a plain `{ title, body }[]`:
```tsx
const TRUST_ATOMS: { title: string; body: string }[] = [
  { title: "Envelope encryption at rest", body: "Every credential is encrypted with a per-row Fernet data key, itself wrapped by a KEK stored in Supabase Vault. ..." },
  { title: "Codename anonymization", body: "Your firm name is never public. ..." },
  { title: "Listed to qualified allocators only", body: "..." },
```
`body` is typed `string`, so the S-KEY row (sentence plus a link) cannot stay a string. The planner either widens that row's body type to `React.ReactNode` or renders the S-KEY row outside the array; decide in the plan and keep the other rows as strings. Note the second row "Codename anonymization / Your firm name is never public ... until you explicitly accept an intro" is NOT in the UI-SPEC change list but contradicts the new "Public by link, under your codename" row (RESEARCH Open Question 6). The hero sub-line (`:95-98`) and step 01 (`:317`) take `LISTING_COST_SENTENCE` and `EXCHANGE_LIST`.

Terms edits (lines 15, 20-30, 73-77): paragraphs are bare `<p>`; the layout (`legal/layout.tsx`) supplies `legal-article text-sm text-text-secondary leading-relaxed`, so add no classes except the inline-link class. Terms imports `PLATFORM_NAME` already; the file has no other imports to model, so import `Link` from `next/link` plus the constants.

**Copy-claim caution (RESEARCH A4 / Pitfall 4):** the UI-SPEC row says "your firm name stays hidden until you accept an intro", but the attested-allocator tearsheet (`factsheet/[id]/tearsheet/page.tsx:364-368`) shows manager identity with no accepted intro. The sentence to pin in tests and ship is the scoped one: "A published factsheet opens for anyone who has its link, without signing in, and shows no firm name." This needs the planner to flag it to the orchestrator before it is locked.

---

### `scripts/build-security-packet.html` + `public/security-packet.pdf` + date-drift test (artifact, file-I/O)

**Analog:** `scripts/build-security-packet.mjs` (renderer) and `docs/runbooks/security-packet-update.md` (the checklist; step 2 is the paired date bump). Commands:
```sh
node scripts/build-security-packet.mjs            # writes public/security-packet.pdf
pdftotext public/security-packet.pdf -            # verify text; record in the evidence file
```
Chrome path defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on darwin (override with `PUPPETEER_EXECUTABLE_PATH`). `build-security-packet.mjs:20-24,45-47` shows the `existsSync` and `executablePath` logic; no edit to the script is needed.

**Edits in the HTML source** (RESEARCH census): lines ~202-206 (AES-256-GCM / Supabase Vault), ~253-254 (`<dt>Supported exchanges</dt><dd>Binance, OKX, Bybit ...`, hard-coded three venues versus four in `EXCHANGES`), the `Last reviewed <span class="mono">2026-10-07</span>` date. Static HTML cannot import `EXCHANGES`, so write the current list by hand and let the census assert equality.

**Date parity test to keep green** (`src/__tests__/security-packet-date-drift.test.ts`): extractor anchors on the marker and reads within a 120-char window:
```typescript
function extractLastReviewedDate(source: string, label: string): string {
  const markerIdx = source.search(/Last reviewed/i);
  if (markerIdx === -1) { throw new Error(`${label}: "Last reviewed" marker not found (markup refactored?)`); }
  const window = source.slice(markerIdx, markerIdx + 120);
  const dateMatch = window.match(/(\d{4}-\d{2}-\d{2})/);
  ...
```
Do not reword "Last reviewed" in either file or the test throws. Extend this file (or the new census) with a fact-parity block: packet HTML contains the same cipher string and TLS sentence as `/security` (read both with `readFileSync`, assert `includes` of the shared literal). The PDF is binary and unasserted; its check is the `pdftotext` output in the evidence file.

---

### `src/app/(marketing)/demo/page.tsx` (RSC page, admin-client read) - fail-loud reads

**Analog:** the same file's Phase 1 handling, plus `(marketing)/page.tsx`'s Sentry use.

**Existing error-log pattern to extend to Phase 2** (lines 121-134):
```typescript
  if (profileRes.error) { console.error("[demo] profile fetch failed:", profileRes.error); }
  if (batchesRes.error) { console.error("[demo] batches fetch failed:", batchesRes.error); }
  if (portfolioRes.error) { console.error("[demo] portfolio fetch failed:", portfolioRes.error); }
```
**Phase 2 reads that never look at `.error`** (lines 146-174): `holdingsRes` and `analyticsRes` come from `Promise.all([...])`, and the no-portfolio branches return `Promise.resolve({ data: null })`, which has no `error` key, so the code reading `.error` must tolerate `undefined` (typing: `{ data: null; error?: undefined }`). Then:
```typescript
  const holdings = adaptHoldings(holdingsRes.data ?? null);
  const analytics = adaptPortfolioAnalytics(analyticsRes.data);
```
**Sentry call shape** (home page, used by `page.stat-errors.test.tsx:84-95`): `captureToSentry(err, { tags: { op: "...", ... }, level: "error" })` from `@/lib/sentry-capture`. Copy the `tags: { op: ..., stat/stage: ... }` convention.

**Load-bearing existing blocks to delete** (lines 345-370): the "Recommendations computing" `<p>` and the "Demo data is loading" `<div className="rounded-lg border border-border bg-surface p-8 text-center">`. The footer (lines 373-382) keeps `Sign up` and loses the `Founder view →` link if D-09 removes the route.

---

### `src/app/(marketing)/demo/page.truth.test.tsx` (test, RSC render with mocked admin client) - NEW

**Analog:** `src/app/(marketing)/demo/page.max-dd-tone.test.tsx`. Copy the harness; extend the `multi()` and `single()` fixtures so each test can set a Phase-2 `error`, a null `strategies` embed, or an empty holdings list.

**Header and environment** (lines 1-2, 12-16):
```typescript
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children) }));
```
**Hoisted seed state and table-keyed fixture builders** (lines 18-52):
```typescript
const seeded = vi.hoisted(() => ({ holdingDd: null as number | null, recDd: null as number | null }));
type Result = { data: unknown; error: null };
const single = (): Record<string, Result> => ({ profiles: {...}, portfolios: {...} });   // maybeSingle() tables
const multi  = (): Record<string, Result> => ({ match_batches: {...}, portfolio_strategies: {...} }); // thenable tables
```
Widen `Result.error` to `null | { code: string; message: string }` (as `page.stat-errors.test.tsx:15` does) so a read error can be injected.

**Admin client mock** (lines 54-64): chainable builder where every method returns `c`, `maybeSingle` resolves from `single()`, and `then` resolves from `multi()`:
```typescript
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve(single()[table] ?? { data: null, error: null });
    c.then = (res, rej) => Promise.resolve(multi()[table] ?? { data: null, error: null }).then(res, rej);
    return c;
  } }),
}));
```
**Mocks to retain / drop** (lines 65-102): keep `@/lib/warmup-analytics` and `@/lib/demo-recommendations`. The existing test stubs every section component (`EditorialHero`, `CounterfactualStrip`, `WinnersLosersStrip`, `WhatWedDoCard`, ...) to `() => null`. For the truth test the opposite is needed: do NOT stub `EditorialHero`, `WinnersLosersStrip`, `WhatWedDoCard`, `NextFiveMillionCard` when asserting no UUID/`Strategy #xxxxxxxx` in rendered text and that null BTC cells are absent. Add a `vi.mock("@/lib/sentry-capture", ...)` collector (from `page.stat-errors.test.tsx:29-34`) to assert the capture before the throw.

**Render helper and invocation** (lines 108-126):
```typescript
import DemoPage from "./page";
async function renderPage() {
  const ui = await DemoPage({ searchParams: Promise.resolve({}) });
  render(ui);
```
For "must throw" cases: `await expect(DemoPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(...)`.

**Note on file placement:** `max-dd-tone.test.tsx` sits beside `page.tsx`, so `src/app/(marketing)/demo/page.truth.test.tsx` fits (RESEARCH Wave 0). Because the two tests share `Max DD` expectations (`getAllByText("Max DD")` toHaveLength(2)), removing the founder link or changing holdings rows can alter that test only if the fixtures change; run it after editing.

---

### `src/components/portfolio/EditorialHero.tsx` (component, transform)

**Analog:** itself. `MetricCell` always renders its `<dt>/<dd>` pair, so removing a null cell needs a conditional here (RESEARCH Pitfall 5; the UI-SPEC claim of "not its markup" is wrong). Tests to update, found by the RESEARCH grep: `EditorialHero.test.tsx`, `portfolio.signed-zero.test.tsx`, `display-sign-census-misses.test.tsx`, `display-sign-single-source.test.ts` (it has a path-keyed allowlist entry for `src/app/(marketing)/demo/page.tsx` at line ~867 and lists the page in `SCAN_FILES`, lines 96 and 162). If the demo page's color/sign code changes, run `npx vitest run src/__tests__/display-sign-single-source.test.ts` and update the pinned count for that file in the same commit.

**Filesystem census pattern behind that test** (`display-sign-single-source.test.ts`): `SCAN_DIRS` plus `SCAN_FILES` define the population (lines 77-98), `CENSUS_FILES` (line 104+) asserts the population includes every named file (anti-vacuity), and the count rule uses `pinProblems(rule, actual, allow)` (line 1188). Adding a new scanned file means adding it to the right list, and a count that changes must be edited in the allowlist, never widened.

---

### `src/lib/routing/route-contract-manifest.ts` + `scripts/check-route-contract.ts` (config, route removal)

**Analog:** the gate itself. Removing `src/app/(marketing)/demo/founder-view/page.tsx` requires removing the manifest entry in the same change (Rule 4, STALE), otherwise `npm run lint` fails.

**Entry to delete** (`route-contract-manifest.ts` lines 314-319):
```typescript
  {
    route: "/demo/founder-view",
    class: "public",
    notes:
      "Founder-side demo twin — covered by the /demo PUBLIC_ROUTES prefix + bounce-exempt.",
  },
```
**Rules that apply** (`scripts/check-route-contract.ts` header lines 14-36): Rule 1 UNCLASSIFIED (page exists, no entry), Rule 4 STALE (entry exists, no page). Deleting the page and the entry together satisfies both. `PUBLIC_ROUTES` in `src/proxy.ts` keeps `"/demo"` (the `/demo` entry stays, and `/api/demo/portfolio-pdf` remains), so Rule 2 is unaffected. The `/factsheet/:id` entry (`class: "public"`, "NEVER MOVE") is unchanged by D-04 since behaviour is not changed.

**Test precedent:** `src/__tests__/check-route-contract.test.ts` builds a fixture tree with `writeRoute(...)`, a `proxyWithPublicRoutes([...])` fixture, and asserts on the returned violation strings via the pure `runCheck`. Phase 192 adds no new rule, so it needs no edit there; it only has to leave the real tree green (`npm run check:route-contract`, also part of `npm run lint`).

**Full removal reference list** (RESEARCH, "Founder-view removal"): delete `demo/founder-view/page.tsx`; the `/demo` footer link; `layout.tsx:11` docblock; the manifest entry; `eslint.config.mjs:267` scope-array path; `e2e/demo-founder-view.spec.ts`; `marketing-shell.spec.ts:46` row; `ci.yml:6398` command token and the `:6192`, `:6454` comments; `src/lib/demo.ts:4` docblock. If the API goes too: `src/app/api/demo/match/[allocator_id]/route.ts` and its test, `vitest.node-env.ts:168`, `src/lib/api/limiter-ordering.test.ts:150` (check bucket behaviour for a missing route first, A7). Closes `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]` as a side effect. Re-grep at execution: `grep -rn "founder-view\|api/demo/match" src e2e .github eslint.config.mjs vitest.node-env.ts`.

---

### e2e specs (test, request-response) - unseeded `e2e` lane versus `e2e-seeded` lane

**Unseeded lane analog:** `e2e/demo-public.spec.ts`. The lane builds with placeholder env (`NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY: placeholder_service_role`), so the admin client cannot connect. Today the spec's header documents that `/demo` falls to the "Demo data is loading" card (lines 8-13) and asserts `response.status() < 400` (line ~67). With the throw, `/demo` becomes the root error boundary. The unseeded lane therefore gets exactly one `/demo` assertion about the loud failure (heading "Something went wrong", no "Demo data is loading"), and its HTTP status must be PROBED with `next build && next start` under that env before it is written (RESEARCH A3, assume nothing about 500).

**Persona-driven pattern to keep for any retained cases** (`demo-public.spec.ts:45-64`): iterate the canonical `PERSONAS` constant so a new persona is a compile error, and assert exactly one `aria-current="page"` link:
```typescript
import { PERSONAS, type PersonaKey } from "../src/lib/personas";
const PERSONA_CASES = (Object.keys(PERSONAS) as PersonaKey[]).map((key) => ({ slug: key, label: PERSONA_LABEL[key] }));
```
**Unseeded static-page analog for the truth strings:** `e2e/security-page.spec.ts` lines 25-58 (status `< 400`, headings by role, link by `href`). `/security` and `/for-quants` render without a database, so key-storage, TLS and cost sentence checks belong in this unseeded lane, not the seeded one.

**Seeded lane analog:** `e2e/no-clip-sweep.spec.ts` lines 170-223. The seed-gated describe uses a `HAS_SEED_ENV` constant plus `test.skip`:
```typescript
const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
test.describe("no-clip sweep (VERIFY-03) — authed", () => {
  test.skip(!HAS_SEED_ENV, /* reason */);
```
The `e2e/for-quants-landing.spec.ts:20-22` file uses the same constant. The file header (lines 21-30) calls this "FLOW-01 dual-wiring": a spec is only a gate if it is in BOTH the ci.yml Playwright list for its lane AND carries its own `HAS_SEED_ENV` skip. The seeded step runs `SEED_CONFIRM_STAGING=true npx tsx scripts/seed-demo-data.ts` against a private local-stack database (`ci.yml:6829`), BEFORE the rebuild, so `/demo` there renders with data. The `/demo` rows in the sweeps (`reflow-sweep.spec.ts:53`, `no-clip-sweep.spec.ts:156`, `axe-app-wide.spec.ts:101`, each with anchor `#editorial-hero-headline`) must move to the seeded describe, since under placeholder env the page no longer renders that anchor.

**Probe helper to reuse for a retained `/demo` seeded case** (`no-clip-sweep.spec.ts:106-136`, `probeNoClip`): throws LOUD on `status >= 400` and asserts a visible anchor first, "so a blank/login/unhydrated page fails loud".

**Screenshot gate:** `e2e/demo-screenshot.spec.ts` with three committed `*-chromium-linux.png` baselines pins the placeholder empty state ("NOT the seeded production render"). It cannot survive: retire it or retarget it to the seeded lane and re-bake through the `bake_demo_screenshots` dispatch. Retiring a gate is a founder-level decision (RESEARCH Open Question 1); surface it, do not decide it in the plan.

**CI structure pin** (`src/__tests__/critical-regressions.test.ts:1035-1060`): the unseeded command is located by anchoring on `e2e/smoke.spec.ts` with a regex, and must keep `e2e/auth.spec.ts`. Editing the `ci.yml:6398` command (remove `e2e/demo-founder-view.spec.ts`, possibly `e2e/demo-screenshot.spec.ts`) is safe as long as `smoke.spec.ts` and `auth.spec.ts` stay. Run `npx vitest run src/__tests__/critical-regressions.test.ts` after any `ci.yml` edit. Also `grep -rn "demo-founder-view\|demo-screenshot" src/__tests__` first.

---

## Shared Patterns

### Oracle-independent literal pins
**Source:** `src/lib/status-surface-copy.test.ts:22-29`.
**Apply to:** every new sentence test. Expected strings are typed in the test, never imported from the module under test. One `it` per UI-SPEC id with the id in the test name.

### Server-component render under vitest
**Source:** `src/app/(marketing)/page.stat-errors.test.tsx:20-82` (async page) and `src/app/(marketing)/security/page.test.tsx:23-34` (sync page).
**Apply to:** `public-truth-copy.test.tsx`, `page.truth.test.tsx`. Mock `next/navigation` `redirect` to throw, mock `@/lib/sentry-capture` into a collector, mock the Supabase module with a thenable chain builder, `render(await Page())`.

### Fail-loud error capture
**Source:** `src/app/(marketing)/page.stat-errors.test.tsx:84-95` (the contract: capture to Sentry with `{ tags: { op, ... }, level: "error" }`), plus `demo/page.tsx:121-134` (`console.error("[demo] ... failed:", err)`).
**Apply to:** `/demo` Phase 2 reads. Log, capture, then throw (UI-SPEC "log, report, throw"). In production Next masks the thrown message to a digest, so the real message must be in `console.error`/Sentry first.

### Filesystem census that cannot pass vacuously
**Source:** `src/__tests__/security-packet-date-drift.test.ts:40-65` (throw when the anchor is absent) and `src/__tests__/display-sign-single-source.test.ts:104-110, 1224-1252` (named-file population assertion, `walk`, `isTestPath`).
**Apply to:** the banned-phrase census. Always assert the scanned list is non-empty and contains specific named files.
**Comment handling:** use `stripCommentsPreserveLines` from `src/lib/source-scan.ts` (line-preserving, shared by the repo's structural guards) so a docblock quoting a banned phrase does not red a clean tree.

### Route lockstep
**Source:** `scripts/check-route-contract.ts` Rules 1 and 4; `src/lib/routing/route-contract-manifest.ts`.
**Apply to:** any page file deleted or added. Page and manifest entry change together; `npm run lint` is the gate.

### Paired date bump with the downloadable packet
**Source:** `docs/runbooks/security-packet-update.md` step 2; `security-packet-date-drift.test.ts`.
**Apply to:** any change to `/security` facts. Bump `Last reviewed` in `security/page.tsx:392` and `build-security-packet.html`, rebuild the PDF, `pdftotext` it, record the output in the evidence file.

### Neuter-and-restore proof
**Source:** repo testing rule (founder memory, RESEARCH "RED-then-restore").
**Apply to:** every new census, render and throw test. `cp` a byte backup, reintroduce the banned text or remove the `.error` check, show RED naming it, restore from the backup. Never `git checkout`, `git restore` or `git stash` on uncommitted work.

### Public-repo hygiene for the evidence file
**Source:** CLAUDE.md and RESEARCH Project Constraints.
**Apply to:** the phase evidence file (handshakes, factsheet probe, D-08 reads). Record counts and "present/absent" only; no PROD ids, no emails, no home paths.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Intl.ListFormat` derived `EXCHANGE_LIST` | utility | transform | No existing `Intl.ListFormat` use among copy constants; `untrustedKeyCaption` (`status-surface-copy.ts:664-681`) joins names with `", "` and `EXCHANGE_DISPLAY`, a different shape (no "or"). Use the RESEARCH snippet and map `EXCHANGES` to its label field. |
| Unseeded loud-failure `/demo` assertion | test (e2e) | request-response | Nothing asserts an error boundary under placeholder env today. HTTP status must be probed with a real `next build && next start` under the CI placeholder env before the assertion is written (A3). Use `security-page.spec.ts` for structure. |
| Evidence file (handshakes, signed-out factsheet, D-08 PROD reads) | artifact | batch | It is a recorded artifact, not code. The commands are in RESEARCH ("Research readings", "Factsheet visibility"). |

## Metadata

**Analog search scope:** `src/lib`, `src/app/(marketing)`, `src/__tests__`, `src/components/portfolio`, `scripts`, `e2e`, `.github/workflows/ci.yml`, `docs/runbooks`.
**Files scanned (read or grepped):** about 35.
**Tracked-source gate:** all named analogs confirmed with `git ls-files`; no gitignored capability mirror is cited.
**Pattern extraction date:** 2026-11-06
