# Phase 148: OWN — Owner factsheet without cache disclosure - Pattern Map

**Mapped:** 2026-08-05
**Files analyzed:** 9 (3 modified production, 1 modified test, 4 new tests, 1 doc append)
**Analogs found:** 9 / 9 (every file has an in-repo analog — this phase mints no new mechanism)

> **Headline for the planner:** every primitive already exists. There is no "build X" task in this
> phase — only "wire X at site Y". The three production edits are all *additive at an existing
> seam*: a required 2nd parameter on `fetchAndBuildPayload`, an optional field on
> `FactsheetBodyOptions`, and a sibling `<Link>` under an existing `<FactsheetPreview>`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/factsheet/[id]/v2/page.tsx` (MOD) | RSC page / route | request-response + cached read | **itself** `:341-371` (Lane A) + `src/app/api/strategies/[id]/returns/route.ts:211-233` (Lane B probe) | exact (two analogs, one per lane) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (MOD) | component (server-rendered) | render / prop threading | **itself** — `scenarioMode` additive-prop precedent (`:143-211`) + `NotEnoughDataPanel` (`:555-564`) | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (MOD) | client component (wizard step) | render / navigation | **itself** `:1781` (`<Link>` structural-presence idiom) + `WizardChrome.tsx:250-260` (`target="_blank"`) | exact |
| `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` (MOD) | test (page-level RSC harness) | request-response | **itself** `:20-41` mock block | exact (edit-in-place) |
| `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` (NEW) | test (page-level RSC) | request-response | `page.smoothed-wiring.test.tsx` (harness) + `returns/route.test.ts:127-147,639-660` (R8 predicate capture) | exact (two analogs, composed) |
| `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (NEW) | test (source-scan CI invariant) | batch / static analysis | `src/__tests__/phase-147-series-resolution-guards.test.ts` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` (NEW) | test (component render) | render | `FactsheetBody.scenario-mode.test.tsx` | exact |
| `.../wizard/steps/SyncPreviewStep.own04-link.test.tsx` (NEW) | test (component render) | render | `SyncPreviewStep.render.test.tsx:820-900` (single-key `passed`) + `SyncPreviewStep.composite.render.test.tsx:1-120` (composite `passed`) | exact |
| `TODOS.md` (APPEND — §3a cache-key staleness) | doc | — | existing TODOS.md entries | n/a |

**Roles NOT present in this phase (assert-by-absence in review):** no migration, no API route, no
service, no model, no config, no middleware. Zero DB writes.

---

## Pattern Assignments

### 1. `src/app/factsheet/[id]/v2/page.tsx` (RSC page, request-response)

**Analog A (Lane A — leave byte-identical):** itself.
**Analog B (Lane B — the owner probe):** `src/app/api/strategies/[id]/returns/route.ts`.

#### 1a. Imports pattern — the file's existing block (`page.tsx:1-15`)

```typescript
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withPublishedOnly } from "@/lib/visibility";          // ← becomes { withPublishedOnly, withPublishedOrOwner }
...
import { FactsheetView } from "./FactsheetView";
```

⚠️ `captureToSentry` is **NOT** imported here today. Lane B's fail-loud probe-error arm needs it:
`import { captureToSentry } from "@/lib/sentry-capture";` — the existing test already mocks that
module (`page.smoothed-wiring.test.tsx:21`), so the harness survives the new import.

#### 1b. The DI seam — copy the *shape* of the existing builder head (`page.tsx:35-49`)

Existing (the gate to parameterize — **G2**, the one the ROADMAP never names):

```typescript
async function fetchAndBuildPayload(id: string): Promise<FactsheetPayload | null> {
  const supabase = createAdminClient();
  const { data: strategy, error } = await withPublishedOnly(
    supabase
      .from("strategies")
      .select(
        `id, name, codename, disclosure_tier, status, markets, strategy_types,
       description, subtypes, supported_exchanges, leverage_range, aum,
       max_capacity, avg_daily_turnover, start_date, benchmark, asset_class,
       returns_denominator_config,
       strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status )`,
      )
      .eq("id", id),
  )
    .maybeSingle();
  if (error || !strategy) {
    console.warn("[factsheet] fetchAndBuildPayload — admin probe returned no strategy", {
      id, hasError: !!error, errorMessage: error?.message, errorCode: error?.code,
    });
    return null;
  }
```

⛔ **Do not touch the `.select(...)` string.** It names `daily_returns` AND `returns_series`; the
147 Layer-A repo-wide gate reddens if a future edit drops `returns_series` from it. The parameter
is added to the **signature and the `withPublishedOnly(` call only**.

**Visibility-predicate helper contract to copy** (`src/lib/visibility.ts:74-86` / `:115-125`) — both
are the `<Q>(query: Q) => Q` structural-cast shape, so a `type StrategyVisibility = <Q>(q: Q) => Q`
seam types cleanly against both:

```typescript
export function withPublishedOnly<Q>(query: Q): Q {
  return (query as { eq(column: "status", value: "published"): Q }).eq("status", "published");
}

export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}
```

#### 1c. Cached wrapper — keep the signature parameter-free (`page.tsx:226-266`, condensed)

```typescript
function buildFactsheetPayloadCached(cacheKey: string): Promise<FactsheetPayload | null> {
  const [id] = cacheKey.split("::");                     // ⚠ :229 — computedAt is DISCARDED here
  return unstable_cache(
    async () => fetchAndBuildPayload(id),                // ← becomes (id, withPublishedOnly) — a LITERAL, never a variable
    ["factsheet-v2-payload-v6", id],                     // :260 — keyParts: id ONLY
    { revalidate: 3600, tags: ["factsheet-v2", `factsheet-v2:${id}`] },  // :261-264
  )();
}
```

**The structural claim SC2-B asserts:** this function has **no** visibility parameter, so an owner
predicate is *unrepresentable* here (type error, not a lint finding). Keep it that way.

**Shape-version comment block lives at `:236-259`** (the v2→v3→v4→v5→v6 bump ledger). Per RESEARCH
§4 the `viewerNotice` prop is **not** on `FactsheetPayload`, so **no v6→v7 bump**. If the planner
nonetheless changes the payload shape, that block is the documented protocol to append to.

#### 1d. Lane A — the untouched published gate (`page.tsx:341-350`)

```typescript
  const [signRes, verificationSignals] = await Promise.all([
    withPublishedOnly(
      supabase
        .from("strategies")
        .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
        .eq("id", id),
    )
      .maybeSingle(),
    readPublicVerificationSignals([id]),
  ]);
```

The Lane B probe **must select the same column list** — `signature` is consumed downstream at
`:366-369` (`strategy_analytics.computed_at`) and `:385-393` (the payload-pending fallback names the
strategy from `signature.name / codename / disclosure_tier`). A narrower owner-lane select breaks
that fallback on the owner lane only.

#### 1e. Error/notFound pattern — the existing 404 arm (`page.tsx:352-365`)

```typescript
  const signature = signRes.data;
  if (signRes.error || !signature) {
    console.warn("[factsheet/v2/page] signature gate -> notFound", {
      id,
      hasError: !!signRes.error,
      errorCode: signRes.error?.code,
      errorMessage: signRes.error?.message,
      hasSignature: !!signature,
      hint: signRes.error
        ? "supabase query errored — check RLS on strategies / strategy_analytics for the calling user"
        : "no row matched (id, status='published') — strategy may be draft / archived or RLS-hidden",
    });
    notFound();
  }
```

**Copy this structured-`console.warn` + `hint` idiom** for the Lane B miss. Note the existing arm's
prose ("no row matched (id, status='published')") becomes *inaccurate* once a Lane B miss reaches
it — update the hint text to name which lane fell through.

#### 1f. Lane B probe — copy verbatim from `src/app/api/strategies/[id]/returns/route.ts:211-233`

```typescript
      const { data: strat, error: probeError } = await withPublishedOrOwner(
        supabase
          .from("strategies")
          .select("id, asset_class")
          .eq("id", id),
        user.id,
      ).maybeSingle();
      if (probeError) {
        // error-absent ≠ legit-absent: a PostgREST error … returns {data:null,error} and would 404 a REAL
        // published strategy with no signal. The 404 stays (never an oracle), but log the
        // breadcrumb server-side so a schema fault is debuggable (Rule 12).
        console.error("[api/strategies/returns] probe error:", probeError);
        captureToSentry(probeError, {
          tags: { route: "api/strategies/returns", stage: "probe" },
        });
      }
      if (!strat) {
        return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }
```

Three load-bearing properties to preserve on the factsheet page (adapt `NextResponse.json(404)` →
`notFound()`):
1. **`user.id` is session-only.** In the route it comes from `withAllocatorAuth`; on the RSC page it
   must come from `(await supabase.auth.getUser()).data.user` **in the same function** — never
   `params`/`searchParams`. The route's own comment at `:195` states the rule verbatim.
2. **Probe error logs + Sentry, then still 404s.** Error-absent ≠ legit-absent; the status never
   becomes an oracle.
3. **The probe runs on the request-scoped client** (`createClient()`), not the admin client — RLS is
   the backstop there. The `no-owner-or-on-admin-client` ESLint rule (repo-wide `"error"`,
   `eslint.config.mjs:51`) cannot catch `withPublishedOrOwner(createAdminClient()…)`; only review
   and this ordering can.

#### 1g. `force-dynamic` precedent (RESEARCH A3 — planner's call) — `src/app/factsheet/[id]/tearsheet/page.tsx:17-25`

```typescript
// Pin to dynamic rendering. The disclosure-tier redaction depends on the
// per-request authentication state (cookies → supabase.auth.getUser()).
// A future caching PR or `use cache` wrapper that introduced
// `revalidate > 0` here would be a fail-open vulnerability: an
// authenticated-rendered HTML response (full institutional identity) could
// be cached and served to anonymous visitors. force-dynamic mirrors the
// /discovery/layout.tsx pin that gates the rest of the disclosure-tier
// system on attestation.
export const dynamic = "force-dynamic";
```

If the planner takes this, copy the **comment too** — the sibling public factsheet route already
carries this exact reasoning, and comment parity is what makes the pin survive a future refactor.

---

### 2. `src/app/factsheet/[id]/v2/FactsheetView.tsx` (component, render)

**Analog:** itself — the `scenarioMode` field is the exact precedent for an additive
`FactsheetBodyOptions` field that defaults to a no-op on every existing call site.

**Options interface** (`:143-161`) — the field to extend:

```typescript
export interface FactsheetBodyOptions {
  /** Suppress the strategy-name header (caller already provides its own). */
  hideHeader?: boolean;
  /** Suppress the demo allocator-portfolio section (skip on allocator dashboards). */
  hideAllocatorSection?: boolean;
  /** Suppress the QSF footer + disclaimer (caller already provides closing chrome). */
  hideFooter?: boolean;
  /** Render an optional slot above the KpiStrip — used to inject a live
   *  equity curve at the top of the allocator's Overview without
   *  reordering the rest of the factsheet body. */
  topSlot?: ReactNode;
  /** Composer-mount flag (default false). … Default false keeps every existing call
   *  site (page.tsx, the Discovery detail page, the Overview EquityChartWidget)
   *  byte-identical. */
  scenarioMode?: boolean;
}
```

**Copy the `scenarioMode` doc-comment convention verbatim:** each field names *who* passes it and
*why the default keeps every other call site byte-identical*. That sentence is the GUARD-02 proof
obligation written into the type.

**Render position** (`:199-211`) — ⛔ `topSlot` at `:208` is **below** the header:

```tsx
      <article
        id="factsheet-main"
        tabIndex={-1}
        data-theme={darkMode ? "dark" : "light"}
        data-colorblind={colorblind ? "1" : "0"}
        className="factsheet-v2-shell mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12"
        style={{ background: "var(--color-page)", ...shellStyle }}
      >
        {!hideHeader && <FactsheetHeader payload={payload} />}   // :207  ← banner goes ABOVE this line
        {topSlot}                                                 // :208  ← NOT the banner slot (UI-SPEC:97)
        <KpiStrip />
```

**Prop threading chain to extend** (`:87-93` → `:100,140` → `:171-178`):

```tsx
export function FactsheetView({ payload }: { payload: FactsheetPayload }) {   // :87 — ONE prop today
  return (
    <FactsheetProvider payload={payload}>
      <FactsheetShell payload={payload} />
    </FactsheetProvider>
  );
}
// FactsheetShell :100 … returns <FactsheetBody payload={payload} />          // :140
export function FactsheetBody({
  payload, hideHeader = false, hideAllocatorSection = false, hideFooter = false, topSlot, scenarioMode = false,
}: { payload: FactsheetPayload } & FactsheetBodyOptions) {                     // :171-178
```

⚠️ Three hops (`FactsheetView` → `FactsheetShell` → `FactsheetBody`); `FactsheetShell` currently
takes only `payload`. All three signatures need the new optional field.

**Banner primitive to copy** (`:555-564`) — reuse the *treatment*, not the component:

```tsx
function NotEnoughDataPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="border border-border bg-surface-subtle px-4 py-3">
      <h3 className="text-caption font-semibold uppercase tracking-[0.18em] text-text-primary">
        {title}
      </h3>
      <p className="mt-1 text-micro text-text-muted">{body}</p>
    </section>
  );
}
```

**Three UI-SPEC deltas from this primitive (do not copy blindly):**
| Aspect | `NotEnoughDataPanel` | Owner banner (UI-SPEC) |
|--------|----------------------|------------------------|
| Body size | `text-micro` (10–11px) | **`text-caption`** (12px) — UI-SPEC:66 override, "too small for a load-bearing disclosure" |
| Element semantics | bare `<section>` | `<section role="note" aria-label="Visibility notice">` — UI-SPEC:110 |
| Bottom gap | none | `mb-6` (24px before the masthead) — UI-SPEC:97 |
| Heading level | `<h3>` | `<h2>` (it precedes the masthead, so it is the article's first heading) |

**Other consumers of `FactsheetBody` that must stay byte-identical** (verified: three call sites,
none pass the new field): `page.tsx:463`, `AllocationDashboardV2.tsx:162`,
`ScenarioFactsheetChart.tsx:237`.

---

### 3. `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (client component, render)

**Analog A — structural-presence `<Link>` idiom, same file (`:1775-1785`):**

```tsx
          {/* UNCONDITIONAL — condition 3 above. Non-destructive, and it is the
              state's OWN fix line: "Start a new strategy from the strategies
              page." Navigating away destroys nothing, which is the property
              that matters both when the draft may still exist and simply not be
              ours to read, and when the only other control on the row deletes it. */}
          <Link href="/strategies" data-testid="wizard-back-to-strategies">
            <Button type="button" variant="ghost">
              Back to strategies
            </Button>
          </Link>
```

This is the "renders ALWAYS, never as a disabled else-branch" convention UI-SPEC:128 requires. The
OWN-04 link is the same class: present when the branch renders, structurally absent otherwise —
**never `disabled`, never a greyed placeholder**.

**Analog B — `target="_blank"` in this same wizard tree (`WizardChrome.tsx:250-260`):**

```tsx
          <p className="text-caption text-text-muted">
            Wizard help ·{" "}
            <Link
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-4 hover:underline"
            >
              Review our security posture →<span className="sr-only"> (opens in new tab)</span>
            </Link>
          </p>
```

Two notes the planner must resolve deliberately:
- ⚠️ **Style conflict (Rule 7 — pick one, don't blend).** This precedent uses `hover:underline`
  (underline on hover only); UI-SPEC:122 mandates a **persistent** `underline underline-offset-4`
  for WCAG 1.4.1 (link distinguishable in flowing content). **UI-SPEC wins** — it is the approved,
  more recent contract. Log the WizardChrome/ConnectKeyStep divergence to `TODOS.md`; do not "fix"
  those two here (Rule 3).
- The `<span className="sr-only"> (opens in new tab)</span>` suffix appears **once** in the repo —
  it is a good a11y idiom rather than an established convention. `e2e/axe-app-wide.spec.ts` covers
  this surface; adding it is cheap and cannot regress. Planner's call.
- `ConnectKeyStep.tsx:658-664` is the second in-wizard precedent and uses `rel="noopener"` (no
  `noreferrer`). UI-SPEC:126 pins `rel="noopener noreferrer"` — follow UI-SPEC.

**The two insertion sites (identical shape — extract ONE local component so copy cannot drift):**

Composite branch, `:1916-1924`:
```tsx
        <div className="mt-6">
          <FactsheetPreview
            strategyName={"Your draft composite"}
            metrics={snapshot.metrics}
            sparklineReturns={snapshot.sparkline}
            computedAt={snapshot.computedAt}
            verificationState="draft"
          />
        </div>
        {/* ← OWN-04 link goes here (mt-3 under the panel) */}
```

Single-key branch, `:2193-2219`:
```tsx
        <div className="mt-6">
          <FactsheetPreview
            strategyName={"Your draft strategy"}
            subtitle={ … }
            metrics={snapshot.metrics}
            sparklineReturns={snapshot.sparkline}
            computedAt={snapshot.computedAt}
            verificationState="draft"
          />
        </div>
        {/* ← OWN-04 link goes here — ABOVE the CTA row below (UI-SPEC:120) */}

        <div className="mt-6 flex gap-3">
          <Button onClick={handleUseThisKey} data-testid="wizard-use-this-key">
            Use this key and continue
          </Button>
          <Button variant="ghost" onClick={…} data-testid="wizard-try-another-key">
            Try another key
          </Button>
        </div>
```

`Link` is already imported at `:4`. `strategyId` is a **required, non-optional** prop (`:274`,
destructured `:406`) — no null-guard needed inside these branches. `data-testid` convention in this
file is `wizard-<kebab-action>` (`wizard-use-this-key`, `wizard-try-another-key`,
`wizard-back-to-strategies`) → use `wizard-view-full-factsheet`.

---

### 4. `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` (MODIFY — guaranteed break)

**The exact block to edit (`:32-36`):**

```typescript
// withPublishedOnly → passthrough builder: the published-only visibility gate
// is SQL-side and owned by its own tests; here every fixture row is published.
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
}));
```

The moment `page.tsx` imports `withPublishedOrOwner`, this factory returns `undefined` for it →
`TypeError` at call time. **Same commit as the page import** — not a "run the suite and see".

⚠️ Also note `:29-31`:
```typescript
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
```
This identity stub is **fine to leave here** (this file's subject is series threading, and Lane A
still runs). It is **not** fine to copy into the SC2 test — see §5.

Also: the request-client stub (`:154-171`) returns a row unconditionally, so this file always takes
Lane A. If the two-lane refactor changes the number of `.from()` calls on the request client, this
stub still satisfies them (`from: () => chain`, chain is reusable) — no change needed there.

---

### 5. `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` (NEW — page-level RSC)

**Analog A — harness:** `page.smoothed-wiring.test.tsx` (clone `:1-46`, `:154-193`).

Mock block to clone (`:17-41`), with the two mandatory changes marked:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound() called"); },
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,   // ⛔ CHANGE 1 → vi.fn((fn) => fn), a SPY
}));
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,                        // ⛔ CHANGE 2 → add withPublishedOrOwner
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ readPublicVerificationSignals: vi.fn() }));
```

The `findPayload` DFS helper (`:173-186`) is the payload-extraction idiom — copy verbatim:

```typescript
/** Depth-first search of an RSC element tree for the FactsheetView payload prop. */
function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findPayload(child); if (hit) return hit; }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}
```
⚠️ It returns the **payload only**. Asserting `viewerNotice` needs a sibling helper that returns the
whole `props` object (or the `FactsheetView` element) — write `findViewProps()` alongside it rather
than mutating `findPayload`.

RSC invocation idiom (`:210-213`):
```typescript
    const jsx = await FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
```

`notFound()` assertions use the throwing mock: `await expect(FactsheetV2Page({…})).rejects.toThrow(/notFound/)`.

**Analog B — predicate capture (non-vacuity):** `returns/route.test.ts:127-147` (the observer) and
`:639-660` (the R8 assertion).

Observer state shape (`:127-147`):
```typescript
  observedFilters: {
    status: null as string | null,          // withPublishedOnly's .eq("status","published")
    ownerOrFilter: null as string | null,   // withPublishedOrOwner's .or("status.eq.published,user_id.eq.<uid>")
    strategiesEqId: null as string | null,
    strategiesSelect: null as string | null,
  },
```

R8 assertion (`:639-660`) — **copy this assertion style for Lane B**:
```typescript
  it("R8 — non-vacuity: existence probe is owner-inclusive (withPublishedOrOwner, session-keyed) + no admin client", async () => {
    …
    expect(STATE.observedFilters.ownerOrFilter).toBe(
      "status.eq.published,user_id.eq.00000000-0000-0000-0000-000000000001",
    );
    // The legacy published-only .eq("status","published") is gone.
    expect(STATE.observedFilters.status).toBeNull();
```

This is what proves the **session** id (not a param) reached the predicate — the T-110-05/07 threat.
⚠️ It only works if `@/lib/visibility` is **NOT** mocked to a passthrough for the probe under test.
Two options for the planner: (a) `vi.importActual("@/lib/visibility")` + spread so the real
predicates append observable filters to a recording builder stub (preferred — strictly stronger),
or (b) mock `withPublishedOrOwner` with a recording fn that captures `(qb, authUserId)` and asserts
on the captured `authUserId`. Option (a) matches the route test; option (b) is cheaper. Either
satisfies SC4's session-keying clause; state which one in the plan.

**SC2-A cache-spy assertions** (the Pitfall-5 fix — invocation count, not identity):
`expect(unstable_cache).toHaveBeenCalledTimes(0)` on an owner render, `1` on a public render, with
a sequence test (owner render for id X → anon render for id X → `notFound()`, shared spy).

**Neuter-check header convention** (`page.smoothed-wiring.test.tsx:13-15`) — every guard file in
this repo states the one-line regression that reddens it:
```
 * … Neuter check: drop the `readSingleKeyBasisOpts`
 * spread (or regress it to the old 4-arg inline copy) in this page's
 * single-key arm → the `seriesByBasis.smoothed_mtm` assertion reddens.
```
For 148 the neuter check is: *"point Lane B at `buildFactsheetPayloadCached` → the
`unstable_cache` call-count-0 assertion reddens."* Run it, record the output in the header.

---

### 6. `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (NEW — structural CI invariant)

**Analog:** `src/__tests__/phase-147-series-resolution-guards.test.ts` — clone its architecture
wholesale. It is the repo's canonical two-layer source-scan gate.

**Header intent statement to mirror (`:20-23`):**
```
 * ROADMAP SC2 has a structural clause: every surface resolves through the ONE
 * existing `resolveDailyReturnSeries`, with no third resolution mechanism
 * minted. That clause is what this file enforces — as a CI invariant, not as an
 * observation made once during the phase.
```

**Helper set to copy verbatim** (`:99-179`):

```typescript
const ROOT = join(__dirname, "..", "..");

/** Read an allowlisted source fail-loud (missing file → explicit failure). */
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(`… allowlist file is missing: ${relPath}. A rename or move must carry this guard with it — a missing pinned source is a FAILURE, not a skip …`);
  }
  return readFileSync(abs, "utf8");
}

/** Strip `//` line comments and block comments so documentation prose … can neither redden nor green a scan. */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
}

/** Walk src/ for production sources (no tests, no __tests__, no .d.ts). */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(abs, acc); continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(abs);
  }
  return acc;
}
```

⚠️ **`stripComments` is load-bearing for 148 specifically.** `page.tsx` will carry prose naming both
`withPublishedOnly` and `withPublishedOrOwner` in its header; without the strip, the gate
self-invalidates. The 147 file documents this exact hazard at `:94-96`.

**Paren-balanced argument extraction** (`:245-259`) — the idiom for "what is passed INTO a call",
which a bare `toContain("identifier")` cannot see. Adapt `resolverCallArgs` → `cachedBuilderArgs` /
`unstableCacheCallbackBody`:

```typescript
function resolverCallArgs(src: string): string {
  const start = src.indexOf(RESOLVER_CALL);
  if (start === -1) return "";
  let i = start + RESOLVER_CALL.length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(start + RESOLVER_CALL.length, i - 1);
}
```

**Layer A (repo-wide, non-allowlist) + Layer B (per-surface pin) structure** (`:185-234`, `:261+`)
— and note 147's **anti-vacuity test**, which 148 must copy in spirit:

```typescript
  it("the scan is non-vacuous: it DOES see the phase's own two-column selects (so an empty offender list means clean, not blind)", () => {
    …
    expect(twoColumn.length).toBeGreaterThanOrEqual(4);
    expect(twoColumn).toContain("src/app/api/strategies/[id]/returns/route.ts");
```

For 148: assert the extractor genuinely finds the ONE `unstable_cache` occurrence in `page.tsx`
(so "exactly once" cannot pass because the scanner is blind).

**Rule-9 non-vacuity ledger** (147 header `:60-92`) — the repo convention is to run **two real
mutations**, record the exact failure output in the header AND the commit message AND
`148-VALIDATION.md`, then revert by **re-editing the mutated line** (never `git checkout --`).
148's two mutations should be: (1) point Lane B at the cached builder; (2) swap the literal
`withPublishedOnly` inside the `unstable_cache` callback for a variable.

---

### 7. `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` (NEW — component render)

**Analog:** `FactsheetBody.scenario-mode.test.tsx` — the PERMANENT GUARD-02 file.

**Render harness (`:98-110`)** — copy the mount shape and the `omitProp` trick, which is exactly the
absent-vs-explicit-default distinction the new prop needs:

```tsx
function renderBody(scenarioMode: boolean | undefined, omitProp = false) {
  return render(
    <FactsheetProvider payload={populatedPayload} persist={false}>
      <FactsheetBody
        payload={populatedPayload}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
        {...(omitProp ? {} : { scenarioMode })}
      />
    </FactsheetProvider>,
  );
}
```

**Byte-identity assertion (`:112-120`)** — the pattern the new prop must satisfy:
```tsx
  it("renders byte-identically with default props vs scenarioMode={false}", () => {
    const def = renderBody(undefined, /* omitProp */ true);
    const explicitFalse = renderBody(false);
    expect(def.container.innerHTML).toBe(explicitFalse.container.innerHTML);
  });
```
⚠️ **That existing test is the phase's proof obligation, not a template to duplicate.** It must stay
green untouched (`viewerNotice` absent on both renders → identical DOM). The NEW file proves the
positive: `viewerNotice="owner_unpublished"` renders the banner with UI-SPEC copy + `role="note"` +
`aria-label="Visibility notice"`, **above** `FactsheetHeader` (assert DOM order, not just presence),
and renders **zero nodes** when unset.

⚠️ Note this file mounts `FactsheetBody` directly (not `FactsheetView`) with `hideHeader` — so a
DOM-order assertion "banner precedes the masthead" needs `hideHeader={false}`.

**Required stub block (`:47-74`)** — `FactsheetProvider`'s persistence primitive touches
`localStorage` + sentry on mount; the file documents that the stub must be installed **per test**
(`beforeEach`), not at module scope, because `vitest.config.ts` sets `unstubGlobals: true`
(DEF-16-1). Copy the whole block verbatim, including the `beforeEach(() => vi.stubGlobal(...))`.

---

### 8. `SyncPreviewStep.own04-link.test.tsx` (NEW — component render)

**Analog A — single-key `passed` branch driver:** `SyncPreviewStep.render.test.tsx:855-900`.

```tsx
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("keyed Deribit with 0 trades + >=7 csv rows + complete reaches the factsheet preview", async () => {
    installDeribitPassMock(30);
    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByRole("heading", { name: /your verified factsheet is ready/i })).toBeInTheDocument();
    expect(screen.getByTestId("wizard-use-this-key")).toBeInTheDocument();
  });
```

Base props + mock set (`:37-68`):
```tsx
let currentClientFactory: () => unknown = () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => currentClientFactory() }));
vi.mock("@/lib/for-quants-analytics", () => ({ trackForQuantsEventClient: vi.fn() }));
vi.mock("@/components/connect/KeyPermissionBadge", () => ({ KeyPermissionBadge: () => null }));

const baseProps = {
  strategyId: "strat-1", apiKeyId: "key-1", wizardSessionId: "session-1",
  onComplete: vi.fn(), onTryAnotherKey: vi.fn(),
};
```
⚠️ `strategyId: "strat-1"` is not a UUID in this fixture — fine for a `href` assertion
(`/factsheet/strat-1/v2`), but pick a UUID if the plan wants realism parity with the composite file.

**Analog B — composite `passed` branch driver:** `SyncPreviewStep.composite.render.test.tsx:1-120`
(`CompositeMockOpts` fixture builder, `DEFAULT_MEMBERS` / `DEFAULT_SERIES` / `DEFAULT_DQ`). Its
header (`:1-26`) also records the repo convention worth copying: *"The 874-line
`SyncPreviewStep.render.test.tsx` … stay FROZEN/untouched. This sibling adds the composite-only
pins."* → **148 should add a THIRD sibling file rather than editing either existing one.**

**Structural-absence assertions** (SC3): the link must be absent in `kicking_off` /
`waiting_for_complete` / `gate_failed`. Use `queryByTestId(...)` `.not.toBeInTheDocument()` and
additionally assert **no disabled variant exists** (`queryByRole("link", { name: /view full factsheet/i })`
is null) — the standing no-disabled-buttons UAT direction.

---

## Shared Patterns

### S1. Owner-probe access-control triad
**Source:** `src/app/api/strategies/[id]/returns/route.ts:190-233`
**Apply to:** `page.tsx` Lane B (the only new gated code path in this phase)

1. Probe on the **request-scoped** client (RLS on) → 2. build on the **admin** client (RLS bypassed,
predicate is the sole gate) → 3. `user.id` from `auth.getUser()` in the same function, never a param.
The route's own comment at `:193-195` states the rule in-repo: *"The `analytics_read` RLS policy is
ALSO owner-inclusive … `user.id` is session-only (withAllocatorAuth), NEVER a request param."*

### S2. Fail-loud-but-non-oracular error handling (Rule 12)
**Source:** `returns/route.ts:218-227` + `page.tsx:353-364`
**Apply to:** every new error arm in Lane B
```typescript
console.error("[factsheet/v2/page] owner probe error:", probeError);
captureToSentry(probeError, { tags: { route: "factsheet/v2/page", stage: "owner-probe" } });
// … then still 404 — error-absent ≠ legit-absent, and the status never becomes an oracle
```
Non-owner-authed and anon must collapse to the **same** `notFound()`.

### S3. Additive-prop byte-identity discipline
**Source:** `FactsheetView.tsx:155-160` (`scenarioMode` doc-comment) + `FactsheetBody.scenario-mode.test.tsx:112-120`
**Apply to:** the `viewerNotice` field and every `FactsheetBody` consumer
The type's doc-comment must name the call sites that stay byte-identical; the GUARD-02 test is the
proof. Undefined ⇒ zero nodes ⇒ identical `innerHTML`.

### S4. Source-scan CI invariant (structural proof, not observation)
**Source:** `src/__tests__/phase-147-series-resolution-guards.test.ts` (whole file)
**Apply to:** the SC2-B gate
Two layers (repo-wide walk + per-surface allowlist), `stripComments` before matching, missing
allowlist file = FAILURE not skip, an explicit anti-vacuity test, and a Rule-9 mutation ledger in
the header.

### S5. `data-testid` naming
**Source:** `SyncPreviewStep.tsx:1781, 2209, 2215`
**Apply to:** the OWN-04 link → `wizard-view-full-factsheet` (`wizard-<kebab-action>`).

### S6. Structured `console.warn` with a `hint` field
**Source:** `page.tsx:354-363, 373-377`
**Apply to:** every new log line on the page. The `hint:` key carries the *diagnostic next step*,
not a restatement of the condition. If Lane B changes which conditions reach an existing warn, the
hint text must be updated with it — a stale hint sends the next engineer to the wrong gate.

---

## Pinned Literals — CI breaks if these change

| # | Gate | File:line | Literal / invariant pinned | 148 exposure |
|---|------|-----------|---------------------------|--------------|
| P1 | **Phase 147 Layer A** (repo-wide) | `src/__tests__/phase-147-series-resolution-guards.test.ts:204` | **Every** production `.select(...)` under `src/` naming `daily_returns` must ALSO name `returns_series` | 🔴 **HIGH.** Any new/edited select on the owner lane. Mitigation: don't add an analytics select — reuse the parameterized builder. A probe select must stay `id / name / codename / disclosure_tier / user_id / status`. |
| P2 | **Phase 147 Layer B** (per-surface pin) | same file, allowlist `:263-269` incl. `"src/app/factsheet/[id]/v2/page.tsx"` | That file must (a) obtain `returns_series` and (b) contain the literal `resolveDailyReturnSeries(` | 🔴 **HIGH.** Both live inside `fetchAndBuildPayload` (`page.tsx:45`, `:71`) — the exact function being refactored. A missing file is a **FAILURE not a skip** (so a rename breaks it too). |
| P3 | **Phase 147 anti-vacuity** | same file, `:208-226` | ≥4 two-column selects repo-wide; must include `returns/route.ts` + `queries.ts` | 🟢 Low — 148 touches neither. |
| P4 | **Phase 147 column regex** | same file, `:228-233` | `csv_/mtm_/smoothed_mtm_daily_returns` must NOT match the bare column | 🟢 Low — informational; explains why the composite path is not an offender. |
| P5 | **GUARD-02 byte-identity (PERMANENT)** | `FactsheetBody.scenario-mode.test.tsx:113-120` | `FactsheetBody` default props ≡ `scenarioMode={false}` `innerHTML` | 🔴 **HIGH.** The `viewerNotice` field must default to undefined and render zero nodes. Must be run and stay green. |
| P6 | **GUARD-02 Overview scan** | same file, `:138-141` | `widgets/performance/EquityChart.tsx` contains neither `"FactsheetBody"` nor `"factsheet-main"` | 🟢 Low — 148 does not touch that widget. |
| P7 | **Phase 84 asset_class flow** | `src/__tests__/phase-84-asset-class-flow.test.ts:33+` | `returns/route.ts` probe select still projects `asset_class`; `queries.ts` dashboard join too | 🟡 **Medium-indirect.** 148 *copies from* `returns/route.ts:211-217` but must not *edit* it. If a planner "harmonizes" that probe's select while copying, P7 reddens. **Copy, never refactor the source.** |
| P8 | **Phase 29 frozen-spine** (git-delta) | `src/__tests__/phase-29-frozen-spine-guards.test.ts:16-31, 88-110` | No new migration touching `scenarios`/`scenario_shares`; `src/lib/scenario.ts` zero-diff vs `git merge-base origin/main HEAD`; the two RLS `.sql` tests byte-unchanged | 🟡 **Medium — worktree hazard, not a code hazard.** 148 adds zero migrations and touches none of these files. But the gate resolves its baseline via `merge-base origin/main HEAD` and **fails loud if it cannot resolve** — a worktree that forked wrong (Pitfall 7) can redden it for reasons unrelated to 148. If it goes red, check the branch base before touching code. |
| P9 | **Phase 52 frozen-spine** (git-delta) | `src/__tests__/phase-52-frozen-spine-guards.test.ts:222-239, 271-285` | Frozen islands: `useBreakpoint.ts`, `montecarlo.worker.ts`, `TouchTooltip.tsx`, `useTapPin.ts` — zero-diff vs baseline | 🟢 **Low — verified.** `FactsheetView.tsx`, `factsheet-context.tsx` and `page.tsx` are **NOT** in the frozen set (`factsheet-context.tsx` was explicitly removed in Phase 103). Same baseline-resolution caveat as P8. |
| P10 | **Phase 63 series-space** | `src/__tests__/phase-63-series-space-guards.test.ts` | No production module reintroduces holdings-snapshot engine machinery | 🟢 Low — 148 adds no engine code. |
| P11 | **v2 type-scale grep** | `tests/visual/strategy-v2-type-scale.test.ts:16-46` | Bans `text-sm/xl/2xl`, `text-[11px]/[13px]/[14px]`, `font-medium/light/bold` — **scoped to `src/components/strategy-v2/**` + 6 named chart files** | 🟢 **Low — verified NOT in scope.** Neither `src/app/factsheet/[id]/v2/**` nor the wizard is covered, so UI-SPEC's `font-medium` on the OWN-04 link (`:122`) does not trip it. ⚠️ Do not "helpfully" widen this test's glob in this phase. |
| P12 | **`no-raw-published-predicate`** (eslint, repo-wide `error`) | `eslint.config.mjs:46`; rule `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` | A raw `.eq("status","published")` on a `strategies` query is banned outside `visibility.ts` | 🔴 **HIGH.** Both lanes must route through the helpers. Escape hatch is a greppable `B10 visibility:` marker — do not use it. |
| P13 | **`no-owner-or-on-admin-client`** (eslint, repo-wide `error`) | `eslint.config.mjs:51` | A raw `.or(...user_id.eq...)` outside `visibility.ts` is banned | 🔴 **HIGH.** ⚠️ The rule's own header (`no-owner-or-on-admin-client.mjs:22-35`) admits it **cannot** catch `withPublishedOrOwner(createAdminClient()…)` — that shape is guarded by review + the probe-first ordering only. |
| P14 | **`no-raw-font-px`** (eslint) | `eslint.config.mjs` glob layer; rule header `:22-30` | `text-[NNpx]` / `fontSize:'NNpx'` — `error` on `src/lib/design-tokens/**`, `warn` over broader `src/**` | 🟢 Low — the banner + link use named tokens (`text-caption`, `text-small`). |
| P15 | **Cache shape-version string** | `page.tsx:260` | `["factsheet-v2-payload-v6", id]` + tags `["factsheet-v2", \`factsheet-v2:${id}\`]` | 🟡 The single invalidator is `api/admin/strategy-review/route.ts:501` (`revalidateTag(\`factsheet-v2:${id}\`, "max")`). Keeping `viewerNotice` off the payload means **no v6→v7 bump**; if the planner bumps anyway, that revalidator and the bump-ledger comment (`:236-259`) must be updated together. |
| P16 | **Contracts registry** | `src/__tests__/contracts/contracts-registry.test.ts` + `REGISTRY.md` | Every lint rule / greppable marker is registered | 🟡 Only if 148 mints a new marker or rule. It should not. |
| P17 | **DB published-gate proof** | `supabase/migrations/20260719140000_get_published_trust_signals.sql:86` + `supabase/tests/test_get_published_trust_signals.sql` | `WHERE s.status='published'` in the SECDEF RPC | 🟢 Low, but load-bearing: this is WHY the draft badge hides for free. **Do not duplicate this gate in TS** and do not add an owner-scoped verification read (re-opens the Phase-126 class in mirror image). |
| P18 | **Coverage thresholds** (blocking CI) | `vitest.config.ts` / `CLAUDE.md` | lines 82 / statements 80 / functions 74 / branches 72 | 🟡 New lane code must carry tests or the merged-shard coverage job reddens. |

---

## No Analog Found

None. Every file in this phase has a same-role, same-data-flow analog in the repo.

The two things with **no exact precedent** are *combinations*, not files, and both are noted above:

| Thing | Why there is no single analog | Guidance |
|-------|------------------------------|----------|
| A two-lane RSC where one lane is cached and the other is not | No existing page splits cached/uncached by viewer identity. The nearest precedent is `tearsheet/page.tsx`, which solves it by refusing to cache at all (`force-dynamic`, `:25`). | Compose S1 (probe triad) + the existing Lane A. The novelty is the *branch*, not either arm. |
| An `unstable_cache` **spy** in a page-level RSC test | Every existing page test stubs it to identity (`page.smoothed-wiring.test.tsx:29-31`). | `vi.fn((fn) => fn)` — same behaviour, now countable. This is the Pitfall-5 fix and the whole of SC2-A's teeth. |

---

## Metadata

**Analog search scope:** `src/app/factsheet/[id]/**`, `src/app/api/strategies/[id]/returns/**`,
`src/app/(dashboard)/strategies/new/wizard/**`, `src/lib/visibility.ts`, `src/__tests__/**`,
`tests/visual/**`, `tools/eslint-plugin-quantalyze/rules/**`, `eslint.config.mjs`.

**Files read this session (all read-only):** `page.tsx` (full 466), `visibility.ts` (full 125),
`page.smoothed-wiring.test.tsx` (full 250), `FactsheetView.tsx` (`:80-229`, `:540-569`),
`returns/route.ts` (`:180-274`), `returns/route.test.ts` (`:110-204`, `:630-679`),
`phase-147-series-resolution-guards.test.ts` (`:1-270`), `FactsheetBody.scenario-mode.test.tsx`
(full 183), `SyncPreviewStep.tsx` (`:1770-1794`, `:1895-1939`, `:2178-2227`),
`SyncPreviewStep.render.test.tsx` (`:1-140`, `:840-924`), `SyncPreviewStep.composite.render.test.tsx`
(`:1-120`), `WizardChrome.tsx` (`:250-262`), `ConnectKeyStep.tsx` (`:655-667`),
`tearsheet/page.tsx` (`:14-31`), `phase-52-frozen-spine-guards.test.ts` (`:200-285`),
`phase-84-asset-class-flow.test.ts` (`:1-40`), `phase-29-frozen-spine-guards.test.ts` (`:1-30`),
`phase-63-series-space-guards.test.ts` (`:1-30`), `tests/visual/strategy-v2-type-scale.test.ts`
(`:1-60`), `no-raw-font-px.mjs` (`:1-30`), `eslint.config.mjs` (`:35-60`).

**Pattern extraction date:** 2026-08-05
