# Phase 148: OWN — Owner factsheet without cache disclosure - Research

**Researched:** 2026-08-05
**Domain:** Next.js 16 RSC visibility lanes + `unstable_cache` disclosure safety; Supabase RLS vs service-role query predicates; wizard link affordance
**Confidence:** HIGH (every load-bearing claim verified against repo source, migrations, or `node_modules/next` source in this session)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cache safety — two-lane design (Area 1)**
- TWO LANES. Lane A (public, unchanged): `withPublishedOnly` → `unstable_cache`
  (`factsheet-v2-payload-v6` key, per-id tags) — anon path byte-identical to today.
  Lane B (owner-only, new): on published-miss + authed session, probe ownership via the
  existing `withPublishedOrOwner` (`src/lib/visibility.ts:115`), then call
  `fetchAndBuildPayload` DIRECTLY — no cache read, no cache write. Disclosure impossible
  BY CONSTRUCTION: the shared cache is only ever populated by the published-only builder.
- Lane order: published/cached lane FIRST; owner probe only on its miss (no extra query on
  public authed views).
- SC2 acceptance is BOTH layers: behavior (owner renders draft → anon request for same id
  still 404s, cache untouched) AND structural (the cached builder is provably unreachable
  from the owner lane — asserted, not observed).

**Owner draft view — honest absence (Area 2)**
- Full factsheet payload on the owner lane — same panels, real analytics.
- Trust/verification badge HIDES: the SECDEF `get_published_trust_signals` already returns
  null for owner-own-unpublished; never fabricate a tier for a draft.
- A clear "Unpublished — only you can see this" banner on the owner lane (exact copy/tokens
  in UI-SPEC). Without it, owners share the URL and recipients 404 — reads as a bug.
- `generateMetadata` on the owner lane: minimal + `robots: noindex` — draft name/description
  never enters page meta. Published metadata path untouched.

**OWN-04 preview link — reuse the real factsheet (Area 3)**
- Link target: `/factsheet/{id}/v2` from SyncPreviewStep's existing factsheet-preview area,
  rendered only once the strategy id resolves. No separate preview route (a second factsheet
  implementation is the drift class the reuse rules forbid).
- Cannot dead-end: owner lane covers unpublished, and OWN-04 lands strictly after OWN-02.
- Exact placement/copy pinned by UI-SPEC; finalize-step repetition left to UI-SPEC judgment.

### Claude's Discretion
- Internal naming/structure of the two lanes, test file placement, and how the structural
  unreachability assertion is implemented (module boundary, grep-gate, or DI seam) — provided
  SC2's both-layer acceptance holds and no third factsheet-resolution mechanism is minted.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **OWN-02** | The owner can view the FULL factsheet of their own unpublished strategy from the account that uploaded it, without the public `unstable_cache` ever serving an owner-built payload to anon. | §1 Gate Site Census (FOUR sites, not three — `fetchAndBuildPayload:37` is the one the ROADMAP does not name), §2 RLS Reality Check (owner-readable via RLS on every table the payload touches), §3 Cache Mechanics (⛔ `computedAt` is NOT in the cache key — lane separation cannot be achieved by varying the `cacheKey` string), §4 Lane Signaling |
| **OWN-04** | The wizard preview links to the full factsheet, and the link can never land on `notFound()`. | §5 SyncPreviewStep Link Mechanics (prop `strategyId` at `:274` is required + non-null in both success branches; `Link` already imported at `:4`; `target="_blank"` precedent in the same wizard) |
</phase_requirements>

---

## Summary

Phase 148's real difficulty is **not** the visibility predicate — `withPublishedOrOwner`
already exists, is realized, tested, and used in production by two routes. The difficulty is
that the factsheet v2 page has **four** published-only gates, not the three CONTEXT names, and
the fourth one lives **inside `fetchAndBuildPayload` itself** at `page.tsx:37`, running on a
**service-role admin client** where RLS is bypassed and the query predicate is the *only* gate.
CONTEXT's Lane B says "call `fetchAndBuildPayload` DIRECTLY" — but calling it as it exists today
returns `null` for every draft, so the owner would land on the "still computing" placeholder
instead of their factsheet. **`fetchAndBuildPayload` must be parameterized by a visibility
predicate; that parameterization is the load-bearing design decision of this phase.**

The second discovery is a cache-key falsehood carried in the page's own header comment. The
header claims *"Cache key = `${id}::${computedAt}` so a new analytics row automatically misses
cache."* Verified against `node_modules/next/dist/server/web/spec-extension/unstable-cache.js:55,82`
and `page.tsx:229`: the `computedAt` half of the string is **split off and discarded**, and
`unstable_cache`'s effective key is `cb.toString() + "factsheet-v2-payload-v6," + id` — `computedAt`
never participates. Two consequences for the planner. (a) You **cannot** separate the lanes by
handing `buildFactsheetPayloadCached` a different `cacheKey` string (e.g. `${id}::${computedAt}::owner`)
— it collapses to the same id-keyed entry and would collide with the public one. (b) An
owner-populated entry would be served to anon for the **full 3600s TTL**, not just until the
next re-derive — which raises SC2's stakes and is precisely why CONTEXT's "no cache read, no
cache write" formulation is correct.

Everything else is favourable. RLS is genuinely owner-inclusive on every table the payload
needs (`strategies_read`, `analytics_read`), the tables that are *not* owner-readable
(`strategy_analytics_series` is deny-all, `csv_daily_returns` is owner-select) are read on the
admin client inside the builder where RLS does not apply anyway. The SECDEF trust-signal gate is
already correct-by-construction for drafts (DB-level `WHERE s.status='published'`, pinned by a
DB test). And the repo already owns the exact idioms both SC2 layers need: a page-level RSC
harness (`page.smoothed-wiring.test.tsx`) for the behavioural layer, and a repo-wide source-scan
CI invariant (`src/__tests__/phase-147-series-resolution-guards.test.ts`) for the structural layer.

**Primary recommendation:** Parameterize `fetchAndBuildPayload(id, visibility)` with an injected
predicate; hard-code `withPublishedOnly` inside `buildFactsheetPayloadCached` so the cached
builder is *typed and textually* incapable of receiving an owner predicate; give Lane B its own
uncached call; thread the banner via a new **optional** `FactsheetBodyOptions` field (never the
payload); and pin SC2 with a two-layer test pair modelled on the 147 guard file.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner identity resolution (who is asking) | Frontend Server (RSC) | — | `createClient()` + `auth.getUser()` reads the request cookie; only the server can validate the JWT. `user.id` is session-only, NEVER a param. |
| Visibility predicate (published vs published-OR-owner) | Frontend Server (RSC) query builder | Database (RLS) | `withPublishedOnly` / `withPublishedOrOwner` are the isolation layer; `strategies_read` RLS is the backstop — **except on the admin client, where service_role has BYPASSRLS and the predicate is the sole gate** (see §Pitfall 1). |
| Payload build (analytics → FactsheetPayload) | Frontend Server (RSC) via service-role admin client | — | Deliberate: the builder reads `strategy_analytics_series` (deny-all RLS) and needs visibility-deterministic content for the shared cache. |
| Cache population + invalidation | Frontend Server (Next data cache) | API (admin review route) | `unstable_cache` writes; `revalidateTag('factsheet-v2:${id}', "max")` at `api/admin/strategy-review/route.ts:501` busts on publish. |
| Trust/verification tier for drafts | Database (SECDEF RPC) | — | `get_published_trust_signals` gates at `WHERE s.status='published'` in SQL — a draft's tier is structurally unreachable, no app code needed. |
| Banner render decision | Frontend Server (RSC prop) | Browser (static render) | **Contract term (UI-SPEC:112):** derives from the lane decision, never from a cached-payload field. |
| Preview link render | Browser (client component) | — | `SyncPreviewStep` is `"use client"`; `strategyId` is already in props. |

---

## 1. Gate Site Census — the factsheet v2 page and its data path

**Answer to "the COMPLETE census": there are FOUR published-only gates on this page, not three.**
CONTEXT and ROADMAP name three (`payload build ~:37`, `generateMetadata :275`, `signature gate :342`).
The census below separates the *page-level* build call from the gate that actually lives **inside**
the builder, because they need different treatment.

| # | Site | File:line | Client | What it gates | Returns to whom today | Owner-lane decision required |
|---|------|-----------|--------|---------------|----------------------|------------------------------|
| **G1** | Signature probe | `src/app/factsheet/[id]/v2/page.tsx:342` | **request-scoped** `createClient()` (RLS on) | Existence + `computedAt` derivation | `notFound()` for every unpublished id, to everyone incl. owner | **Owner-inclusive.** This is the gate the ROADMAP names (as `:344` — see line-drift note below). Must become `withPublishedOrOwner(q, user.id)` on a **miss**, and must also tell the caller *which lane won*. |
| **G2** | Payload builder's own gate | `src/app/factsheet/[id]/v2/page.tsx:37` (inside `fetchAndBuildPayload`, `:35`) | **service-role** `createAdminClient()` (`:36`, RLS BYPASSED) | The entire payload row read | `null` for every unpublished id → page falls to the "still computing" placeholder (`:372-416`) | ⛔ **THE ONE THE ROADMAP DOES NOT NAME.** Must be **parameterized**. Leaving it as `withPublishedOnly` while flipping only G1 produces the placeholder, not the factsheet — SC1 silently unmet with a green-looking page. |
| **G3** | `generateMetadata` | `src/app/factsheet/[id]/v2/page.tsx:275` | **request-scoped** `createClient()` (RLS on) | `<title>` / description / OG image | Falls through to `"Strategy"` + generic description for unpublished (no crash, no leak) | **Leave published-only.** CONTEXT locks minimal + `robots: noindex` for the owner lane. `robots:"noindex"` is already unconditional at `:301`. The current fallback already yields a non-disclosing title. The *minimal* change satisfying CONTEXT is: no query change at all, so no draft name enters meta — verify this reading against the planner's reading of "minimal". |
| **G4** | Cached-builder wrapper | `src/app/factsheet/[id]/v2/page.tsx:226-266` | n/a (wraps G2) | Which builder result is shared across users | Public payload | **Must remain hard-wired to `withPublishedOnly`.** This is where SC2's structural layer lands. |

**Does `fetchAndBuildPayload` contain published-only reads deeper in the stack?**
**No — verified.** `grep -rn "withPublishedOnly\|status.*published\|from(\"strategies\")" src/lib/factsheet/` returns
**zero** matches. The three helpers the builder calls —
`readCompositeFactsheet` (`src/lib/factsheet/composite-read-path.ts`),
`singleKeyDataQuality`, `readSingleKeyBasisOpts` — all receive the already-created admin handle
and read `csv_daily_returns` / `strategy_analytics_series` **by `strategy_id` only**, with no
status predicate. `resolveDailyReturnSeries` is pure. So **G2 is the single, complete published
gate inside the builder** — parameterizing it is sufficient; there is no second hidden gate.
[VERIFIED: repo grep + read of `page.tsx:35-224`]

**Line-drift note:** ROADMAP and REQUIREMENTS both cite `factsheet/[id]/v2/page.tsx:344` for the
signature gate. The actual `withPublishedOnly(` token is at **`:342`** (the `.eq("id", id)` is at
`:346`, the `.maybeSingle()` at `:348`). Two-line drift, harmless, but the planner should cite
`:342` in tasks so a future reader is not sent to the wrong line. [VERIFIED: file read 2026-08-05]

**Sibling surfaces the gate change does NOT touch** (relevant to SC4's "every surface"):
`src/app/strategy/[id]/page.tsx` and `src/app/strategy/[id]/v2/page.tsx` resolve through
`getPublicStrategyDetail` / `getStrategyDetailV2` — different helpers, no `withPublishedOnly`,
outside this phase. `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` has its own
gate. The **shared component** `FactsheetBody` is mounted by three other consumers
(`AllocationDashboardV2.tsx:162`, `ScenarioFactsheetChart.tsx:237`, and the v2 page itself) — an
additive optional prop keeps them byte-identical, which the **permanent GUARD-02 byte-identity
gate** (`FactsheetBody.scenario-mode.test.tsx:112`) will prove. [VERIFIED: repo grep]

---

## 2. RLS Reality Check — can the owner actually read their own draft?

**Yes, on the request-scoped client, for every table the owner lane needs.** Cited from migrations:

| Table | Policy | Definition | Owner-own-unpublished readable? | Source |
|-------|--------|-----------|---------------------------------|--------|
| `strategies` | `strategies_read` | `USING (status = 'published' OR user_id = auth.uid())` | ✅ **Yes** | `supabase/migrations/20260405061912_rls_policies.sql:28-30` |
| `strategy_analytics` | `analytics_read` | `USING (EXISTS (SELECT 1 FROM strategies s WHERE s.id = strategy_analytics.strategy_id AND (s.status='published' OR s.user_id = auth.uid())))` | ✅ **Yes** — including the embedded `strategy_analytics ( computed_at )` on the G1 signature probe | `…rls_policies.sql:36-42` |
| `csv_daily_returns` | `csv_daily_returns_owner_select` | `TO authenticated USING (strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid()))` | ✅ Yes (owner) | `supabase/migrations/20260522111839_csv_daily_returns.sql:70-75` |
| `strategy_analytics_series` | `strategy_analytics_series_deny_all` | `FOR ALL USING (false) WITH CHECK (false)` | ❌ **No — deny-all for every non-service caller** | `supabase/migrations/20260428120919_strategy_analytics_series.sql:109-113` |

**Conclusion for the read path:** the owner lane does **not** need a different read path.
`strategy_analytics_series` is the one table the owner cannot read via RLS — and the payload
builder already reads it on the **service-role admin client** (`page.tsx:36`, threaded into
`readSingleKeyBasisOpts` at `:143-149`), where RLS does not apply. So the existing
"probe on request client → build on admin client" split already has exactly the privileges the
owner lane requires. **No new RLS policy, no new migration, no new RPC is needed for this phase.**
[VERIFIED: migration reads + `page.tsx:36,103,143`]

**Confirmed precedent — the identical shape is already in production.**
`src/app/api/strategies/[id]/returns/route.ts:211` runs
`withPublishedOrOwner(supabase.from("strategies").select("id, asset_class").eq("id", id), user.id).maybeSingle()`
on the **request-scoped** client, with `user.id` sourced from `withAllocatorAuth` and explicitly
documented as "session-only, NEVER a request param". Its inline comment (`:190-194`) already
records that `analytics_read` is owner-inclusive "so the series read below serves the owner's
own private analytics too". This is the reference implementation for Lane B's probe.
[VERIFIED: file read]

**Publication stays admin-only — DB-enforced, not code-enforced (SC4).**
`supabase/migrations/20260716131000_guard_strategies_publish_transition.sql` installs a
BEFORE INSERT OR UPDATE trigger blocking any transition into `status='published'` when
`current_user='authenticated'`. The admin review route writes via `createAdminClient`
(`current_user='service_role'`) and passes. **Nothing in this phase touches writes**, so SC4's
"publication remains admin-only" clause is satisfied by construction — but say so explicitly in
verification rather than leaving it unasserted. [VERIFIED: migration read]

---

## 3. Cache Mechanics — how `unstable_cache` + `notFound()` actually interact

### 3a. ⛔ `computedAt` is NOT part of the cache key (the header comment is wrong)

`page.tsx:32-33` states: *"Cache key = `${id}::${computedAt}` so a new analytics row
automatically misses cache."* **This is false as implemented.**

```ts
function buildFactsheetPayloadCached(cacheKey: string) {
  const [id] = cacheKey.split("::");          // page.tsx:229 — computedAt DISCARDED here
  return unstable_cache(
    async () => fetchAndBuildPayload(id),
    ["factsheet-v2-payload-v6", id],          // page.tsx:260 — keyParts: id only
    { revalidate: 3600, tags: [...] },        // page.tsx:261-264
  )();
}
```

Next 16.2.11 derives the key as
`fixedKey = ${cb.toString()}-${keyParts.join(',')}` then `invocationKey = ${fixedKey}-${JSON.stringify(args)}`
[VERIFIED: `node_modules/next/dist/server/web/spec-extension/unstable-cache.js:55,82`].
Here `cb.toString()` is the constant text `async () => fetchAndBuildPayload(id)` (an arrow
closing over `id`; its **source text** does not vary with the value), `keyParts` carries only
`id`, and `args` is `[]` because the returned function is invoked with no arguments. So the
effective key is **id-only**.

**Three planner-facing consequences:**

1. ⛔ **Lane separation cannot be achieved by varying the `cacheKey` string.** Passing
   `` `${id}::${computedAt}::owner` `` produces the *same* cache entry as the public lane —
   `split("::")[0]` is still `id`. A planner reaching for "just give the owner lane its own cache
   key" would ship the exact disclosure bug SC2 forbids, with a test that looks like it passes.
   This is the single highest-value trap in this section.
2. Any owner-populated entry would be served to anon for the **full 3600s TTL**, not "until the
   next computed_at". CONTEXT's "no cache read, no cache write" is therefore the only safe
   formulation — and it is the locked decision. Good.
3. **Pre-existing latent defect, OUT OF SCOPE:** a re-derive that stamps a fresh `computed_at`
   does *not* bust the cache; the factsheet can be up to 1h stale despite the comment claiming
   otherwise. Per the founder's stopping rule (blast-radius bar: user-facing or data-integrity
   only), this is a **staleness** issue with an existing 1h ceiling and an explicit
   `revalidateTag` bust on publish — it does **not** clear the bar. **Log to `TODOS.md`; do not
   fix in this phase** (Rule 3, surgical changes). If the planner touches the header comment at
   all, correct it to describe reality — a comment that misdescribes a cache is how the next
   engineer ships a disclosure bug.

### 3b. Is a `null` / 404 result cached?

**`null` IS cached; `notFound()` is not reachable from inside the cache scope.**

- `unstable_cache` calls `cacheNewResult(result, …)` unconditionally on the callback's return
  value with **no null check** — lines `:177`, `:218`, `:256` of the Next source. A `null` from
  `fetchAndBuildPayload` is JSON-serialized and stored for the TTL.
  [VERIFIED: `node_modules/next/.../unstable-cache.js`]
- **But `notFound()` never enters the cache scope.** The `notFound()` call is at `page.tsx:364`,
  in the page body, *before* `buildFactsheetPayloadCached` is invoked at `:371`. So today, for an
  unpublished id, **the cache is never touched at all** — G1 404s first. This is why the current
  code is safe, and it is exactly the property Lane B must preserve.
- The "cached null for a draft id that later publishes" bug class the research brief worried
  about **cannot occur today** (drafts never reach the cache) and **must not be introduced**.
  Under CONTEXT's locked two-lane design it cannot be: Lane B never calls the cached wrapper.
  ⚠️ It *would* occur under the naive alternative (flip G1 owner-inclusive, leave G2 published-only):
  the owner passes G1, reaches `:371`, the cached builder returns `null` (G2 still published-only),
  **and that `null` is written to the shared id-keyed cache entry for 3600s** — so a subsequent
  publish + `revalidateTag` is the *only* thing that clears it. This is a second, independent
  reason the one-line swap is wrong, and it is worth a named test.

### 3c. Where does `computedAt` come from on the owner lane?

From the **G1 signature probe's embedded `strategy_analytics ( computed_at )`** (`page.tsx:345`,
read via `signAnalytics` at `:366-369`, defaulting to `"0"`). Since `analytics_read` RLS is
owner-inclusive (§2), the owner's own draft analytics row IS visible on the request client, so
`computedAt` resolves normally on the owner lane. **However** — given §3a, `computedAt` is
functionally decorative for cache-keying. On Lane B it is needed only if the planner keeps the
`${id}::${computedAt}` string shape for symmetry. Recommendation: **Lane B should not construct a
cacheKey string at all** — it calls the builder directly with `(id, ownerPredicate)`, which makes
the "no cache" property visible in the call signature rather than buried in a string convention.

### 3d. Does anything else write this cache?

One invalidator: `revalidateTag(\`factsheet-v2:${id}\`, "max")` at
`src/app/api/admin/strategy-review/route.ts:501` (the admin publish/review flow). No other
writer. [VERIFIED: repo grep for `revalidateTag`]

### 3e. Next 16 framing

`unstable_cache` is marked replaced-by-`use cache` in Next 16
[CITED: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md:6-8`].
`next.config.ts` does **not** enable `experimental.cacheComponents` / `dynamicIO`
[VERIFIED: config read], so `unstable_cache` remains the operative API and **migrating to
`use cache` is explicitly out of scope for this phase** — it would be a cache-semantics rewrite
on a route whose disclosure safety is the phase's acceptance criterion. The sibling public
factsheet route already carries the standing warning about exactly this:
`src/app/factsheet/[id]/tearsheet/page.tsx:18-25` pins `export const dynamic = "force-dynamic"`
with the note that *"a future caching PR or `use cache` wrapper that introduced `revalidate > 0`
here would be a fail-open vulnerability."* The v2 page has **no** `dynamic` export — it is
dynamic only implicitly, via `cookies()` inside `createClient()` at `:323`. **Recommendation
(HIGH value, 1 line):** the planner should consider adding `export const dynamic = "force-dynamic"`
to the v2 page as part of Lane B, mirroring the tearsheet precedent — once the page's render
output varies by session identity, implicit dynamism is a property a future refactor can silently
remove, and the failure mode is an owner-rendered HTML response cached and served to anon.
Note this is a *response*-level concern distinct from the *data*-cache concern SC2 names.

---

## 4. Server → Client Lane Signaling for the banner

**What `FactsheetView` receives today:** exactly one prop.

```ts
export function FactsheetView({ payload }: { payload: FactsheetPayload })   // FactsheetView.tsx:87
  → <FactsheetProvider payload={payload}><FactsheetShell payload={payload} /></FactsheetProvider>
  → FactsheetShell (:100) → <FactsheetBody payload={payload} />              // :139
```

`FactsheetBody` already has an **options object** designed for exactly this kind of additive
call-site variation:

```ts
export interface FactsheetBodyOptions {   // FactsheetView.tsx:143-158
  hideHeader?: boolean;
  hideAllocatorSection?: boolean;
  hideFooter?: boolean;
  topSlot?: ReactNode;      // :153 — rendered AFTER the header (:208)
  scenarioMode?: boolean;
}
```

**⚠️ `topSlot` is the wrong slot.** Its render position is `page.tsx`-equivalent line
`FactsheetView.tsx:208` — *after* `{!hideHeader && <FactsheetHeader payload={payload} />}` at
`:207`. UI-SPEC:97 requires the banner **ABOVE** `FactsheetHeader`, as the first child inside the
`<article id="factsheet-main">` (`:199-206`). Reusing `topSlot` would place the banner between the
masthead and the KpiStrip, violating the approved contract.

**Recommended additive prop shape** (Claude's-discretion area; this is a recommendation, not a lock):

```ts
// FactsheetBodyOptions — ADD:
/** Viewer-context notice rendered as the FIRST child of the article, above the
 *  masthead. Undefined on every existing call site → zero nodes → GUARD-02 holds. */
viewerNotice?: "owner_unpublished";
```

Thread it `FactsheetView({ payload, viewerNotice })` → `FactsheetShell` → `FactsheetBody`, and
render at `FactsheetView.tsx:207`-adjacent:
`{viewerNotice === "owner_unpublished" && <OwnerUnpublishedNotice />}` **before** the header.

**Why a discriminated string union rather than a boolean:** Phase 149 (NAV-01) and Phase 152
(SCEN-03) both consume this gate; a string union extends without a second boolean prop, and it
keeps the *lane* (not the *reason*) as the source of truth.

**Contract compliance:** UI-SPEC:112 forbids deriving the banner from a payload field. A prop on
`FactsheetBodyOptions` satisfies this — it is **not** part of `FactsheetPayload`, so the
`factsheet-v2-payload-v6` shape is unchanged and **no v6→v7 bump is required**. Confirm this
explicitly in the plan; the bump protocol comment block is at `page.tsx:236-259`.

**Byte-identity:** every existing consumer (`page.tsx:463`, `AllocationDashboardV2.tsx:162`,
`ScenarioFactsheetChart.tsx:237`) passes no `viewerNotice` → `undefined` → no node rendered.
The permanent GUARD-02 gate (`FactsheetBody.scenario-mode.test.tsx:112-113`, "renders
byte-identically with default props vs `scenarioMode={false}`") is the proof obligation; it must
be run and must stay green.

**Banner primitive to reuse (UI-SPEC:101):** `NotEnoughDataPanel` at `FactsheetView.tsx:554-563`:
```tsx
<section className="border border-border bg-surface-subtle px-4 py-3">
  <h3 className="text-caption font-semibold uppercase tracking-[0.18em] text-text-primary">{title}</h3>
  <p className="mt-1 text-micro text-text-muted">{body}</p>
</section>
```
⚠️ UI-SPEC:66 explicitly overrides the body size: use **`text-caption` (12px), not `text-micro`**
("10–11px is too small for a load-bearing disclosure"). The `role="note"` +
`aria-label="Visibility notice"` from UI-SPEC:110 replace the bare `<section>`.

---

## 5. SyncPreviewStep Link Mechanics (OWN-04)

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (2397 lines,
`"use client"`).

| Fact | Value | Source |
|------|-------|--------|
| `strategyId` prop | `strategyId: string` — **required, non-optional** | `:274` (interface), `:406` (destructure) |
| Non-null in success branches? | ✅ Yes. `:142-143` documents *"`strategyId` is a required uuid prop, so neither arm is reachable from here [without it]"*. Both success branches already use it for fetches (`:1246-1285` composite, `:1504` single). | file read |
| Composite success branch | `<FactsheetPreview strategyName="Your draft composite" … verificationState="draft" />` inside `<div className="mt-6">` at **`:1917`** | file read |
| Single-key success branch | `<FactsheetPreview strategyName="Your draft strategy" … verificationState="draft" />` inside `<div className="mt-6">` at **`:2194`** | file read |
| CTA row (single-key) | `<div className="mt-6 flex gap-3">` with `wizard-use-this-key` / `wizard-try-another-key` at `:2208-2219` — UI-SPEC:120 puts the link **above** this | file read |
| `Link` import | ✅ already present: `import Link from "next/link";` at `:4` | file read |
| Existing `<Link>` usage in-file | `:1781` — `<Link href="/strategies" data-testid="wizard-back-to-strategies">`; comment at `:1683` notes *"the non-destructive `<Link>` renders ALWAYS, not as an else-branch"* — the same structural-presence idiom UI-SPEC:128 requires | file read |
| `target="_blank"` precedent in this wizard | `WizardChrome.tsx:255`, `ConnectKeyStep.tsx:661` — both in the same wizard tree | repo grep |
| `FactsheetPreview` component | `@/components/strategy/FactsheetPreview` (imported `:9-11`) — **shared**; do NOT modify it, the link is a sibling node | file read |

**No blockers.** The link is an additive sibling `<Link href={`/factsheet/${strategyId}/v2`} target="_blank" rel="noopener noreferrer">`
in two places. ⚠️ Two render sites means **two** places to keep in sync — extract a tiny local
component (or a shared `const`) so the copy cannot drift between the composite and single-key
branches. UI-SPEC:118 mandates "same element, same copy, both sites."

**Route reachability:** `/factsheet` is in `PUBLIC_ROUTES` (`src/proxy.ts:17`) and is explicitly
allow-listed at `:109` (`path === "/factsheet" || path.startsWith("/factsheet/")`), so the link
does not bounce an authed founder through the proxy. [VERIFIED: file read]

---

## 6. Test Patterns — how each SC2 layer gets asserted with existing idioms

### 6a. Page-level RSC harness (the SC1 / SC2-behaviour idiom) — **already exists**

`src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` invokes the RSC directly and walks the
returned element tree for the `FactsheetView` payload prop. Its mock set (`:20-41`) is the
template:

```ts
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound() called"); } }));
vi.mock("next/cache", () => ({ unstable_cache: (fn) => fn }));      // identity
vi.mock("@/lib/visibility", () => ({ withPublishedOnly: (qb) => qb }));  // passthrough
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ readPublicVerificationSignals: vi.fn() }));
```
Plus `findPayload()` (`:174-186`), a depth-first search for `props.payload`.

⚠️ **BREAKING-CHANGE ALERT for the planner:** that file mocks `@/lib/visibility` with **only**
`withPublishedOnly`. The moment `page.tsx` imports `withPublishedOrOwner`, the mocked module
returns `undefined` for it and this existing test **will fail at import/call time**. The planner
must add `withPublishedOrOwner` to that mock factory in the same task that adds the import.
This is a guaranteed, non-obvious break — call it out as an explicit task step, not a
"run the suite and see."

⚠️ Second: the `unstable_cache` **identity mock** makes cache behaviour invisible in this harness.
A behavioural SC2 test that relies on this mock proves nothing about caching. The SC2 behaviour
test must instead assert **that the cached wrapper was never invoked** — i.e. spy on
`unstable_cache` (a `vi.fn()` recording invocations) rather than stubbing it to identity, and
assert `unstable_cache` call-count is `0` on an owner-lane render and `1` on a public render.
That is a real, falsifiable assertion available in the existing harness.

### 6b. Structural-unreachability idiom (the SC2 layer-2 idiom) — **already exists**

`src/__tests__/phase-147-series-resolution-guards.test.ts` is a repo-wide **source-scan CI
invariant** written as a vitest test. Its header states the design intent verbatim:
*"ROADMAP SC2 has a structural clause… That clause is what this file enforces — as a CI
invariant, not as an observation made once during the phase."* It walks every production source
under `src/`, inspects `.select(...)` arguments, and reddens on a new offender — deliberately
**not** an allowlist, so a brand-new file is caught.

**This is the exact model for 148's SC2 structural layer.** Recommended assertions for a
`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`:

1. In `src/app/factsheet/[id]/v2/page.tsx`, the token `unstable_cache` appears **exactly once**,
   and the enclosing function's body contains `withPublishedOnly` and does **not** contain
   `withPublishedOrOwner`. (The "cached builder cannot receive an owner predicate" claim.)
2. Repo-wide: no file other than `page.tsx` calls `buildFactsheetPayloadCached` / imports the
   cached builder. (No third resolution mechanism minted — the 147 "no fifth reader" clause,
   restated.)
3. The owner-lane call site passes an owner predicate to the **uncached** builder only.

**Stronger still — the DI-seam / type-level option (recommended):** if
`buildFactsheetPayloadCached` keeps its signature with **no visibility parameter** while
`fetchAndBuildPayload(id, visibility)` gains one, then "the cached builder can be reached with an
owner predicate" becomes a **type error**, not a lint finding. `npm run typecheck` then carries
part of the structural proof. Combine: types for the seam, source-scan for the "only one
`unstable_cache`" invariant. Both are cheap; neither is sufficient alone.

### 6c. The 147 owner-path route harness (reference, not reuse)

`src/app/api/strategies/[id]/returns/route.test.ts` — 24 tests; **R8** at `:639` is the
non-vacuity guard: *"existence probe is owner-inclusive (`withPublishedOrOwner`, session-keyed)
+ no admin client"*. It asserts the appended predicate string
`status.eq.published,user_id.eq.<uid>` is observable on the captured query builder (`:128-132`,
`:187-192`). **Copy this assertion style** for Lane B's probe: it proves the *session* id (not a
param) reached the predicate, which is the T-110-05/07 threat.

### 6d. Other guards this phase must keep green

| Guard | File | Why it matters here |
|-------|------|---------------------|
| GUARD-02 byte-identity (PERMANENT) | `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx:112` | The additive `viewerNotice` prop must not change default render |
| Frozen-spine exit gates | `src/__tests__/phase-52-frozen-spine-guards.test.ts:260` | Factsheet spine pins |
| 147 series-resolution guard | `src/__tests__/phase-147-series-resolution-guards.test.ts` | Any new `.select()` naming `daily_returns` must also name `returns_series` — **a new owner-lane select would trip this if written narrowly** |
| Contracts registry | `src/__tests__/contracts/contracts-registry.test.ts` | If a new lint rule or marker is added, register it |
| DB published-gate proof | `supabase/tests/test_get_published_trust_signals.sql` | Already pins the SECDEF draft behaviour — do not duplicate in TS |

### 6e. Repo test conventions

| Property | Value |
|----------|-------|
| Framework | vitest (`vitest.config.ts`), jsdom via `/** @vitest-environment jsdom */` file pragma |
| Quick run | `npx vitest run <files> --no-file-parallelism` (local flakes need the flag) |
| Full suite | `npm test` (~300s) |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` (eslint + `check-admin-route-manifest` + `check-route-contract`) |
| e2e | `npm run test:e2e` (playwright) |
| Coverage gate | lines 82 / statements 80 / functions 74 / branches 72 — **blocking CI gate** |
| ⚠️ CI skew | CI = Node 22, local = Node 25. CI-only failures reproduce with `PATH=/opt/homebrew/opt/node@22/bin` |

---

## 7. e2e / SECDEF Interactions

### 7a. `get_published_trust_signals` — null-for-unpublished CONFIRMED at the DB level

```sql
CREATE OR REPLACE FUNCTION public.get_published_trust_signals(p_strategy_ids uuid[])
…
 WHERE s.status = 'published'        -- migration :86
```
`REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO anon, authenticated, service_role;` (`:97-98`).
The function comment (`:91-92`) states: *"WHERE strategies.status='published' is the
published-gate"*, and the migration's own DO block (`:101-132`) runs a **behavioural** proof
(seeds a published + a non-published strategy in a rolled-back savepoint and asserts the
non-published one's signal is absent). There is also a standing DB test at
`supabase/tests/test_get_published_trust_signals.sql`.
[VERIFIED: migration `supabase/migrations/20260719140000_get_published_trust_signals.sql`]

**Therefore:** on the owner lane, `readPublicVerificationSignals([id])` (`page.tsx:349`) returns
an empty map → `rawTrustTier = null` (`:424`) → `trustTier = null` (`:425-428`) → the badge
hides. **This is already correct with zero code change.** CONTEXT's "never fabricate a tier for a
draft" is satisfied by the existing call. ⚠️ The planner must **not** "fix" the null tier by
adding an owner-scoped verification read — that would re-open the exact hole Phase 126 closed in
the other direction and is out of scope.

### 7b. The P126 badge-invisibility lesson — do not regress it

Memory + code both record the Phase 126 defect: the trust read used to be an RLS-scoped
`strategy_verifications` query on the request client, which returned **zero rows for every
non-owner viewer**, so `api_verified` silently vanished on the public factsheet
(`page.tsx:331-340` carries the full postmortem in-file). The fix was the SECDEF RPC. **The owner
lane must not reintroduce any RLS-scoped verification read.** Existing e2e coverage that would
catch a regression: `e2e/mt5-badge.spec.ts` (`:21-28` — asserts a seeded MT5 strategy's
`api_verified` tier through the **public** factsheet) and
`e2e/for-quants-onboarding.spec.ts:173-207` (the `data-testid="factsheet-verification-badge"`
regression block, marked CRITICAL).

### 7c. Existing e2e touching this route

`e2e/composite-factsheet-render.spec.ts`, `e2e/svg-chart-parity.spec.ts`,
`e2e/axe-app-wide.spec.ts`, `e2e/target-size.spec.ts`, `e2e/composite-onboarding.spec.ts`.
The `<main>` landmark that makes the axe scan pass is supplied by the route-scoped
`src/app/factsheet/[id]/v2/layout.tsx` (documented there in full). **The banner renders inside
`<article>`, inside that `<main>` — no landmark change**, so the axe specs stay valid. Do not
promote the banner to a landmark element.

⚠️ **Shared-TEST-DB caution for any new e2e:** seeded e2e specs on this project must assert
**their own seed's invariant**, never a global empty-state — the `discovery-hide-examples`
pollution incident (PR #654) is the precedent. An owner-lane e2e must seed its own
owner+draft pair and assert on that id only.

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Bearing on this phase |
|-----------|--------|----------------------|
| **"This is NOT the Next.js you know"** — read `node_modules/next/dist/docs/` before writing code; heed deprecation notices | `AGENTS.md` | Followed in §3: `unstable_cache` docs + source read from `node_modules`. The doc's `use cache` deprecation notice is acknowledged and explicitly **not** acted on (scope). |
| Read `DESIGN.md` before any visual/UI decision; no deviation without approval | `CLAUDE.md` | UI-SPEC (approved 2026-08-05) already encodes the DESIGN.md derivation. Follow UI-SPEC verbatim. |
| Coverage thresholds are a **blocking** CI gate (82/80/74/72) | `CLAUDE.md` | New lane code must carry tests or the merged-shard coverage job reddens |
| Rule 2 Simplicity / Rule 3 Surgical | `CLAUDE.md` | Do **not** fix the §3a cache-key staleness defect here; log to `TODOS.md` |
| Rule 6 Root-cause | `CLAUDE.md` | The root cause of OWN-02 is **G2**, not G1 — a G1-only change is the bandaid |
| Rule 9 Tests verify intent | `CLAUDE.md` | SC2 tests must fail if the *disclosure property* is broken, not merely if a function was renamed |
| Rule 12 Fail loud | `CLAUDE.md` | Lane B probe errors must log + `captureToSentry` (mirror `returns/route.ts:219-226`), never silently 404 |
| Backlog = root `TODOS.md` only | memory | The cache-key finding goes there, nowhere else |
| Feature branch + `/ship`, never manual commit | memory | Applies to execution, not research |

---

## Standard Stack

**No new packages. No new dependencies. No new migrations.**

| Asset | Location | Purpose | Status |
|-------|----------|---------|--------|
| `withPublishedOrOwner(query, authUserId)` | `src/lib/visibility.ts:115` | The owner-inclusive predicate | REALIZED, 2 consumers, 9 unit tests |
| `withPublishedOnly(query)` | `src/lib/visibility.ts:74` | The public predicate | Unchanged |
| `fetchAndBuildPayload(id)` | `src/app/factsheet/[id]/v2/page.tsx:35` | Payload builder | **Must gain a visibility parameter** |
| `unstable_cache` | `next@16.2.11` | Public payload cache | Unchanged (do not migrate to `use cache`) |
| `NotEnoughDataPanel` shape | `FactsheetView.tsx:554-563` | Banner visual primitive | Reuse the treatment, not the component |
| `Link` | `next/link`, already imported at `SyncPreviewStep.tsx:4` | OWN-04 link | Reuse |
| `readPublicVerificationSignals` | `src/lib/queries.ts:331` | Trust tier | Unchanged — already null for drafts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Parameterized `fetchAndBuildPayload(id, visibility)` | A separate `fetchAndBuildOwnerPayload(id, userId)` | Duplicates ~190 lines of composite/basis threading → the exact drift class WR-01/H-2 exist to prevent. **Rejected.** |
| Uncached Lane B | Owner-scoped cache key | ⛔ Impossible: `page.tsx:229` discards everything after `::` (§3a). Would silently collide with the public entry. **Rejected — and this is the trap.** |
| Lane order: published-first, owner-probe-on-miss (locked) | Single owner-inclusive probe + branch on `status` | One query instead of two, but makes the cached lane's predicate conditional at the call site — exactly the coupling SC2's structural layer must rule out. CONTEXT locks published-first. |
| `viewerNotice` on `FactsheetBodyOptions` | A field on `FactsheetPayload` | Forces the v6→v7 bump and puts lane state in the shared-cache object. **Forbidden by UI-SPEC:112.** |
| Reuse `topSlot` for the banner | — | Renders *below* the masthead (`FactsheetView.tsx:207-208`); violates UI-SPEC:97. **Rejected.** |

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** No `npm install`, no
`requirements.txt` change, no new registry dependency. The slopcheck gate is therefore vacuous
here; recorded explicitly rather than omitted, so a reader can distinguish "checked, none" from
"not checked."

---

## Architecture Patterns

### System Architecture Diagram

```
                      GET /factsheet/{id}/v2   (PUBLIC route — proxy.ts:17,109)
                                   │
                      ┌────────────┴────────────┐
                      │  createClient()  :323   │  request-scoped, RLS ON, cookie session
                      └────────────┬────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ G1  signature probe   :342   │
                    │ withPublishedOnly(...)       │──── HIT (published) ──┐
                    └──────────────┬───────────────┘                       │
                                   │ MISS                                  │
                          ┌────────▼─────────┐                             │
                          │ auth.getUser()   │                             │
                          └────────┬─────────┘                             │
                    no user ───────┤                                       │
                        │          │ user present                          │
                        │   ┌──────▼──────────────────────────┐            │
                        │   │ OWNER PROBE (request client)    │            │
                        │   │ withPublishedOrOwner(q,user.id) │            │
                        │   └──────┬────────────────┬─────────┘            │
                        │      no row            row found                 │
                        ▼          ▼                │                      │
                   ┌─────────────────┐              │                      │
                   │  notFound()     │              │                      │
                   │   :364 (404)    │              │                      │
                   └─────────────────┘              │                      │
                                                    │                      │
   ══════ LANE B (owner, UNCACHED) ═════════════════▼══   ══ LANE A (public, CACHED) ══▼═══
                                                    │                                  │
                            ┌───────────────────────▼──────┐   ┌───────────────────────▼────────┐
                            │ fetchAndBuildPayload(        │   │ buildFactsheetPayloadCached()  │
                            │   id, ownerPredicate )       │   │        :226-266                │
                            │  ── NO cache read/write ──   │   │  unstable_cache(               │
                            └───────────────────────┬──────┘   │    () => fetchAndBuildPayload( │
                                                    │          │       id, withPublishedOnly)   │
                                                    │          │    ["…-v6", id]  ⚠ id-ONLY key │
                                                    │          │    revalidate 3600, tags)      │
                                                    │          └───────────────────┬────────────┘
                                                    │                              │
                            ┌───────────────────────▼──────────────────────────────▼────────────┐
                            │  createAdminClient() :36  — service_role, RLS BYPASSED            │
                            │  strategies + strategy_analytics ── predicate is the ONLY gate    │
                            │  ├─ composite? → readCompositeFactsheet (csv_daily_returns)       │
                            │  └─ single?    → readSingleKeyBasisOpts (strategy_analytics_series)│
                            └───────────────────────┬──────────────────────────────────────────┘
                                                    │
                     readPublicVerificationSignals ─┤  SECDEF: WHERE status='published'
                     (owner lane → null tier)       │  ⇒ draft badge hides, no code change
                                                    ▼
                              <FactsheetView payload={…} viewerNotice={lane==='owner'
                                                        ? "owner_unpublished" : undefined} />
                                                    │
                                                    ▼
                              FactsheetShell → FactsheetBody → <article id="factsheet-main">
                                                    │
                                       ┌────────────┴─────────────┐
                                       │ banner (owner lane only) │  FIRST child, ABOVE masthead
                                       │ FactsheetHeader          │
                                       │ KpiStrip / panels / …    │
                                       └──────────────────────────┘
```

**Invariant the diagram encodes:** the `unstable_cache` box has exactly **one** inbound arrow,
and that arrow carries `withPublishedOnly` as a literal. Lane B's arrow bypasses the box entirely.
That is SC2's structural claim, drawn.

### Pattern 1: Injected visibility predicate (the DI seam)

**What:** the builder takes its gate as a parameter; the cached wrapper hard-codes the public one.
**When to use:** any time one builder must serve two visibility lanes and one of them is cached.

```ts
// Source: derived from src/app/factsheet/[id]/v2/page.tsx:35-37 + src/lib/visibility.ts:74,115
type StrategyVisibility = <Q>(query: Q) => Q;

async function fetchAndBuildPayload(
  id: string,
  visibility: StrategyVisibility,           // NEW — required, no default
): Promise<FactsheetPayload | null> {
  const supabase = createAdminClient();     // :36 — service_role, RLS BYPASSED
  const { data: strategy, error } = await visibility(
    supabase.from("strategies").select(`…`).eq("id", id),
  ).maybeSingle();
  …
}

// LANE A — cached. Note: NO visibility parameter on this function's signature.
// An owner predicate is not merely discouraged here; it is unrepresentable.
function buildFactsheetPayloadCached(cacheKey: string) {
  const [id] = cacheKey.split("::");
  return unstable_cache(
    async () => fetchAndBuildPayload(id, withPublishedOnly),   // literal, not a variable
    ["factsheet-v2-payload-v6", id],
    { revalidate: 3600, tags: ["factsheet-v2", `factsheet-v2:${id}`] },
  )();
}
```

⚠️ Make `visibility` **required, not defaulted**. A default of `withPublishedOnly` would let a
future call site forget the argument and silently get the public gate — which is fail-closed and
therefore safe, but it also lets a *reviewer* miss that a call site made no visibility decision.
Required-parameter forces the decision to be visible at every site. (Counter-argument the planner
may weigh: a required parameter touches the existing test's call sites. Two call sites; trivial.)

### Pattern 2: Probe-on-request-client, build-on-admin-client

**What:** authorization decided by an RLS-backed request-scoped query; data assembled by a
service-role query already narrowed by the decision.
**When to use:** the row-level decision needs `auth.uid()`, but the payload needs tables the user
cannot read.
**Precedent:** `src/app/api/strategies/[id]/returns/route.ts:211` (probe) → `:253` (read).

```ts
// Source: src/app/api/strategies/[id]/returns/route.ts:211-233 (adapted)
const { data: { user } } = await supabase.auth.getUser();
if (!user) notFound();

const { data: owned, error: probeError } = await withPublishedOrOwner(
  supabase.from("strategies").select("id").eq("id", id),
  user.id,                       // session-only — NEVER a request/query/body param
).maybeSingle();

if (probeError) {                // Rule 12: fail loud server-side, 404 stays non-oracular
  console.error("[factsheet/v2/page] owner probe error:", probeError);
  captureToSentry(probeError, { tags: { route: "factsheet/v2/page", stage: "owner-probe" } });
}
if (!owned) notFound();          // cross-tenant + genuinely-missing collapse to the same 404
```

### Anti-Patterns to Avoid

- **The one-line swap** (`withPublishedOnly` → `withPublishedOrOwner` at `:342` only): the owner
  passes G1, hits the *cached* builder, G2 still returns `null`, and **that `null` is written to
  the shared id-keyed cache for 3600s**. Two bugs, one line.
- **Owner-scoped cache key:** collapses to the public entry (§3a). Looks correct, is a disclosure bug.
- **Banner state in `FactsheetPayload`:** forces a v7 bump *and* puts lane state in a
  shared-cache object (UI-SPEC:112 forbids).
- **Reading `strategy_verifications` on the owner lane** to "show something": re-opens the
  Phase-126 class in mirror image.
- **A second owner-only factsheet route or preview page:** the drift class the reuse rules forbid;
  CONTEXT locks reuse of `/factsheet/{id}/v2`.
- **`disabled` / greyed preview link:** violates the standing UAT direction (UI-SPEC:128) — the
  link is structurally absent pre-resolution, never disabled.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Owner-inclusive visibility predicate | A raw `.or('status.eq.published,user_id.eq.…')` | `withPublishedOrOwner` (`visibility.ts:115`) | The `no-owner-or-on-admin-client` ESLint rule (repo-wide `"error"`, `eslint.config.mjs:51`) will reject it at edit time |
| Published-only predicate | A raw `.eq("status","published")` | `withPublishedOnly` (`visibility.ts:74`) | `no-raw-published-predicate` rule, repo-wide `"error"` (`eslint.config.mjs:46`) |
| Draft trust-tier suppression | An app-side `if (status !== 'published') tier = null` | `readPublicVerificationSignals` (already called at `page.tsx:349`) | The gate is in SQL (SECDEF `WHERE s.status='published'`) and is DB-test-pinned. App-side duplication creates a second truth. |
| Cache invalidation on publish | A manual bust in the owner lane | The existing `revalidateTag` at `api/admin/strategy-review/route.ts:501` | Already wired; a second invalidator is a second truth |
| Banner panel chrome | A new "banner" primitive | The `NotEnoughDataPanel` treatment (`FactsheetView.tsx:554-563`) | UI-SPEC:101 explicitly says reuse its shape; a new primitive is DESIGN.md drift |
| Payload assembly for drafts | A parallel owner-only builder | Parameterized `fetchAndBuildPayload` | WR-01/H-2 postmortems: per-surface copies of this assembly have already drifted twice |

**Key insight:** every primitive this phase needs already exists and is lint- or DB-enforced. The
phase's entire risk surface is **where the existing primitives are wired**, not what they are.
A plan whose tasks read "build X" instead of "wire X at site Y" is the wrong plan.

---

## Common Pitfalls

### Pitfall 1: The admin client makes the query predicate the ONLY gate

**What goes wrong:** `fetchAndBuildPayload` runs on `createAdminClient()` (`page.tsx:36`).
`service_role` has **BYPASSRLS**, so `strategies_read` is *off* on that client. A bug in the
injected predicate — a wrong id, a param-sourced id, an accidental no-op — leaks **every user's
drafts**, not just one.
**Why it happens:** the mental model "RLS backstops us" is true on the request client and false
on the admin client. The repo already documents this precisely: the ESLint rule's own header
(`tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs:22-35`) states that the one
shape it **cannot** catch is `withPublishedOrOwner(createAdminClient().from('strategies'), id)` —
"Note RLS is NOT a backstop against an admin-client swap… The only guard against the swap is the
helper's contract that its caller passes a user-scoped `createClient()` (enforced by code review,
not by this rule)."
**How to avoid:** (a) the owner lane must **probe on the request client first** (Pattern 2), so the
admin-side predicate is a second gate rather than the first; (b) the `authUserId` reaching the
predicate must come from `auth.getUser()` in the same function, never from `params`/`searchParams`;
(c) assert the predicate's session-sourcing in a test, R8-style
(`returns/route.test.ts:639`).
**Warning signs:** any `userId` that arrives as a function argument from more than one hop away;
any `visibility` predicate constructed outside the page module.

### Pitfall 2: The existing page test breaks the moment you add the import

**What goes wrong:** `page.smoothed-wiring.test.tsx:34-36` mocks `@/lib/visibility` with **only**
`withPublishedOnly`. Adding `import { withPublishedOrOwner }` to `page.tsx` makes it `undefined`
inside the mocked module → `TypeError` at call time.
**Why it happens:** `vi.mock` factories replace the whole module; a partial factory silently
drops the rest.
**How to avoid:** extend the factory in the same commit. Consider
`vi.importActual` + spread so future exports do not repeat this.
**Warning signs:** "is not a function" in a test that was green five minutes ago.

### Pitfall 3: `computedAt` is decorative in the cache key

Covered in §3a. **Warning sign:** any plan task containing the phrase "owner cache key".

### Pitfall 4: A narrow owner-lane `.select()` trips the 147 guard

**What goes wrong:** `src/__tests__/phase-147-series-resolution-guards.test.ts` scans **every**
production file under `src/` and reddens on any `.select(...)` payload naming `daily_returns`
without also naming `returns_series`. A new owner-lane select written from memory will trip it.
**How to avoid:** the owner lane should not add a new analytics select at all — it reuses the
parameterized builder. If a probe select is added, keep it to `id` / `status` / `user_id` columns.
**Warning signs:** a red test in `phase-147-series-resolution-guards` on a phase that never
touched series code.

### Pitfall 5: SC2's behaviour test proves nothing under an identity `unstable_cache` mock

**What goes wrong:** stubbing `unstable_cache: (fn) => fn` removes caching entirely, so
"anon still 404s after owner render" passes vacuously.
**How to avoid:** spy rather than stub — assert **invocation count** of `unstable_cache` is `0`
on an owner render and `1` on a public render. Add a **neuter check** to the test's header (repo
convention, cf. `page.smoothed-wiring.test.tsx:13-15`): state exactly which one-line regression
reddens the assertion.
**Warning signs:** an SC2 test that would still pass if Lane B called the cached builder.

### Pitfall 6: The banner rendered above the wrong node

**What goes wrong:** using `topSlot` puts it *below* the masthead (`FactsheetView.tsx:207-208`).
**How to avoid:** new render position before `{!hideHeader && <FactsheetHeader …>}`.
**Warning signs:** any plan task that says "reuse topSlot".

### Pitfall 7: Worktree base-branch drift

Execution runs in worktrees; GSD worktrees have measurably forked from `origin/main` instead of
the current feature branch. Phase 148 sits on `feat/v1.17-147-scen-01-real-series` and **depends
on Phase 147's `resolveDailyReturnSeries` work being present**. The `EXPECTED_BASE` + reset block
in `execute-phase.md` is the fix and must not be omitted.

---

## Code Examples

### Lane selection in the page body (recommended shape)

```tsx
// Source: composed from src/app/factsheet/[id]/v2/page.tsx:322-371 (Lane A, unchanged)
//         + src/app/api/strategies/[id]/returns/route.ts:211-233 (owner probe precedent)
const { id } = await params;
const supabase = await createClient();

const [signRes, verificationSignals] = await Promise.all([
  withPublishedOnly(                                    // :342 — LANE A gate, UNCHANGED
    supabase.from("strategies")
      .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
      .eq("id", id),
  ).maybeSingle(),
  readPublicVerificationSignals([id]),                  // :349 — unchanged; null tier for drafts
]);

let lane: "public" | "owner" = "public";
let signature = signRes.data;

if (signRes.error || !signature) {
  // LANE B probe — only on the published MISS (CONTEXT: no extra query on public authed views)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: ownRow, error: probeError } = await withPublishedOrOwner(
    supabase.from("strategies")
      .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
      .eq("id", id),
    user.id,                                            // session-only
  ).maybeSingle();

  if (probeError) {
    console.error("[factsheet/v2/page] owner probe error", { id, code: probeError.code });
    captureToSentry(probeError, { tags: { route: "factsheet/v2/page", stage: "owner-probe" } });
  }
  if (!ownRow) notFound();                              // non-owner authed ⇒ same 404 as anon
  signature = ownRow;
  lane = "owner";
}

const signAnalytics = Array.isArray(signature.strategy_analytics)
  ? signature.strategy_analytics[0] : signature.strategy_analytics;
const computedAt = signAnalytics?.computed_at ?? "0";

const payload = lane === "owner"
  ? await fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUserId))  // UNCACHED
  : await buildFactsheetPayloadCached(`${id}::${computedAt}`);                   // CACHED
```

⚠️ The `ownerUserId` above must be captured from the same `auth.getUser()` call — do not re-fetch,
and do not widen its scope beyond this block. ⚠️ Note the `lane === "owner"` branch reaches
`fetchAndBuildPayload` **directly**, exactly as CONTEXT locks. The `signature` shape must match on
both branches or the payload-pending fallback (`:385-393`) breaks on the owner lane.

### The banner (UI-SPEC verbatim copy + tokens)

```tsx
// Source: UI-SPEC 148 §Component Contract 1 (lines 99-112) + FactsheetView.tsx:554-563 primitive
function OwnerUnpublishedNotice() {
  return (
    <section
      role="note"
      aria-label="Visibility notice"
      className="mb-6 border border-border bg-surface-subtle px-4 py-3"
    >
      <h2 className="text-caption font-semibold uppercase tracking-[0.18em] text-text-primary">
        Unpublished — only you can see this
      </h2>
      <p className="mt-1 text-caption text-text-muted">
        This factsheet is visible only from the account that uploaded the strategy. Anyone else
        who opens this link sees a 404 until Quantalyze review publishes it.
      </p>
    </section>
  );
}
```
No `print:hidden` (UI-SPEC:108 — the banner must print). No dismiss control. `text-caption` on the
body, **not** `text-micro` (UI-SPEC:66 overrides the `NotEnoughDataPanel` default).

### The OWN-04 link (both branches)

```tsx
// Source: UI-SPEC 148 §Component Contract 2 (lines 116-130); Link already imported at
//         SyncPreviewStep.tsx:4; target="_blank" precedent at WizardChrome.tsx:255
<div className="mt-3">
  <Link
    href={`/factsheet/${strategyId}/v2`}
    target="_blank"
    rel="noopener noreferrer"
    data-testid="wizard-view-full-factsheet"
    className="text-small font-medium text-accent underline underline-offset-4
               transition-colors duration-150 ease-out hover:text-accent-hover"
  >
    View full factsheet →
  </Link>
  <p className="mt-1 text-caption text-text-muted">
    Visible only to you until the strategy is published.
  </p>
</div>
```
Placed directly under `<FactsheetPreview …>` at **both** `:1917` (composite) and `:2194`
(single-key), **above** the CTA row at `:2208`.

---

## Runtime State Inventory

> Rename/refactor/migration category check. This phase is a **behavioural gate change**, not a
> rename — but the cache is runtime state that a grep audit cannot see, so the categories are
> answered explicitly rather than skipped.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | **None.** No DB writes, no schema change, no migration. The `strategies` / `strategy_analytics` / `csv_daily_returns` rows are read-only on both lanes. Verified: zero `INSERT`/`UPDATE`/`upsert` in the touched files. | None |
| **Live service config** | **None.** No n8n workflow, Railway variable, Vercel env var, or feature flag is introduced. The phase ships un-flagged (no `*_ENABLED` gate in CONTEXT). Verified: no new `process.env` reference required. | None |
| **OS-registered state** | **None** — no cron, no Task Scheduler entry, no pm2 process. | None |
| **Secrets / env vars** | **None.** `SUPABASE_SERVICE_ROLE` is already consumed by `createAdminClient` at this site. | None |
| **Build artifacts / runtime caches** | ⚠️ **YES — the Next data cache.** Existing `factsheet-v2-payload-v6` entries (id-keyed, 3600s TTL) survive a deploy where the entry store is durable. **This is benign for 148:** the payload *shape* is unchanged (no v6→v7 bump, §4), and every existing entry was built by the published-only path. **But it means a mid-phase mistake is not self-healing** — a bad entry written by a broken Lane B persists for up to 1h or until `revalidateTag`. Verification on a real environment must therefore either use a fresh id or bust the tag first. | Document in verification; no code action |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (TS suite) + Playwright (e2e) + pgTAP-style SQL (`supabase/tests/`) |
| Config file | `vitest.config.ts` (+ `playwright.config.ts`) |
| Quick run command | `npx vitest run <files> --no-file-parallelism` |
| Full suite command | `npm test` (~300s), then `npm run typecheck && npm run lint` |
| Coverage gate | **blocking**: lines 82 / statements 80 / functions 74 / branches 72 |

### Success Criteria → Test Map

| SC | Behavior to prove | Test type | Automated command | File status |
|----|-------------------|-----------|-------------------|-------------|
| **SC1** | Owner (session = `strategies.user_id`) renders the FULL factsheet for an unpublished id — `FactsheetView` receives a real payload with panels, **not** the "still computing" placeholder | page-level RSC unit | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism` | ❌ **Wave 0** — new file, harness cloned from `page.smoothed-wiring.test.tsx` |
| **SC1** | Owner lane passes `viewerNotice="owner_unpublished"` to `FactsheetView`; public lane passes `undefined` | page-level RSC unit | same file | ❌ Wave 0 |
| **SC1** | Banner renders with UI-SPEC copy/role/tokens when the prop is set; renders **nothing** when unset | component unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" --no-file-parallelism` | ❌ Wave 0 |
| **SC1** | Owner-lane trust tier is `null` (badge hides) — no fabricated tier | page-level RSC unit | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC1 (DB)** | SECDEF returns no signal for an unpublished strategy | SQL (existing) | existing CI SQL gate: `supabase/tests/test_get_published_trust_signals.sql` | ✅ exists — **do not duplicate in TS** |
| **SC2-A (behaviour)** | Owner render invokes `unstable_cache` **zero** times; public render invokes it **once** | page-level RSC unit, `unstable_cache` as a **spy** not an identity stub | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC2-A (behaviour)** | Sequence test: owner render for id X, **then** anon render for id X → `notFound()` thrown, and the cache spy recorded no write for the owner pass | page-level RSC unit (two sequential invocations, shared spy) | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC2-A (regression)** | Under the *naive* wiring (owner-inclusive G1, published-only G2) a `null` reaches the cached builder — assert the shipped code does **not** call the cached builder on the owner lane | page-level RSC unit | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC2-B (structural)** | `unstable_cache` appears **exactly once** in `page.tsx`; its callback text contains `withPublishedOnly` and **not** `withPublishedOrOwner` | source-scan CI invariant (147-guard idiom) | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism` | ❌ **Wave 0** |
| **SC2-B (structural)** | No file outside `page.tsx` imports/calls the cached builder — no third factsheet-resolution mechanism minted | source-scan, repo-wide walk of `src/` | same file | ❌ Wave 0 |
| **SC2-B (type-level)** | `buildFactsheetPayloadCached` has **no** visibility parameter ⇒ an owner predicate is unrepresentable there | `npm run typecheck` | `npm run typecheck` | ✅ exists (gate) |
| **SC3** | The link renders in **both** success branches with `href=/factsheet/{strategyId}/v2`, `target="_blank"`, `rel="noopener noreferrer"` | component unit | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx" --no-file-parallelism` | ❌ **Wave 0** |
| **SC3** | The link is **absent** (no node, no disabled variant) in `kicking_off` / `waiting_for_complete` / `gate_failed` | component unit | same file | ❌ Wave 0 |
| **SC3** | Cannot dead-end: the linked route resolves for an owner+draft — this is SC1, so assert the **ordering** (OWN-04 tasks depend on OWN-02 tasks) in the plan's wave graph rather than in a test | plan-structural | plan review | n/a |
| **SC4** | Anon request for an unpublished id → `notFound()` (no auth, G1 miss, no user ⇒ 404 before any probe) | page-level RSC unit | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC4** | **Non-owner authed** request for another user's unpublished id → `notFound()` — the owner probe runs and returns no row | page-level RSC unit | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC4** | The owner probe's predicate is session-keyed (`user_id.eq.<session uid>`), never param-keyed | page-level RSC unit, R8-style predicate capture (`returns/route.test.ts:639` pattern) | `page.owner-lane.test.tsx` | ❌ Wave 0 |
| **SC4** | Publication remains admin-only | DB trigger (existing) + no writes in this phase | existing migration `20260716131000`; assert-by-absence in review | ✅ exists |
| **SC4 (no regression)** | `FactsheetBody` default render is byte-identical after the additive prop | component unit (existing PERMANENT gate) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx" --no-file-parallelism` | ✅ exists — must stay green |
| **SC4 (no regression)** | Existing page wiring guard still green after the `@/lib/visibility` mock is extended | component unit (existing) | `npx vitest run "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" --no-file-parallelism` | ✅ exists — **requires edit** (Pitfall 2) |
| **SC4 (no regression)** | Public factsheet badge still renders for published strategies (P126 class) | e2e (existing) | `npx playwright test e2e/mt5-badge.spec.ts e2e/for-quants-onboarding.spec.ts` | ✅ exists |
| **SC4 (no regression)** | Series-resolution guard unaffected by any new select | source-scan (existing) | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ✅ exists |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched test files> --no-file-parallelism`
- **Per wave merge:** `npm test` + `npm run typecheck` + `npm run lint`
- **Phase gate:** full suite green + `npx playwright test e2e/mt5-badge.spec.ts e2e/composite-factsheet-render.spec.ts` before `/gsd:verify-work`
- **Max feedback latency:** 300s (full), <30s (targeted)

### Wave 0 Gaps

- [ ] `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` — covers SC1, SC2-A, SC4. Clone the
      harness from `page.smoothed-wiring.test.tsx` (mock set `:20-41`, `findPayload` `:174-186`).
      **`unstable_cache` must be a spy (`vi.fn((fn) => fn)`), not a bare identity stub** (Pitfall 5).
      Must mock `@/lib/visibility` with **both** exports.
- [ ] `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — SC2-B structural invariant.
      Model: `src/__tests__/phase-147-series-resolution-guards.test.ts` (repo-wide walk, not an
      allowlist). Include a stated neuter check in the header.
- [ ] `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — banner render + absence.
      (May be folded into an existing FactsheetView test file at the planner's discretion.)
- [ ] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` —
      SC3, both branches + structural absence pre-success. **Must land after OWN-02 tasks.**
- [ ] **Edit** `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx:34-36` — extend the
      `@/lib/visibility` mock factory with `withPublishedOrOwner`. Same commit as the page import.
- [ ] Framework install: **none needed** — vitest, playwright, and the SQL harness are all present.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | **yes** | `supabase.auth.getUser()` (server-side JWT validation, **not** `getSession()` which only reads the cookie — see the precedent note at `factsheet/[id]/tearsheet/page.tsx:104-106`) |
| V3 Session Management | **yes** | Owner identity from the request cookie only; `user.id` never crosses a function boundary from a request param |
| V4 Access Control | **yes — the core of this phase** | `withPublishedOrOwner` (isolation layer) + `strategies_read`/`analytics_read` RLS (backstop, request client only) + the publish trigger (write side). ⚠️ RLS is **not** a backstop on the admin client (Pitfall 1). |
| V5 Input Validation | limited | `id` is a route param used only in `.eq("id", id)` (parameterized by PostgREST). No new user input. |
| V6 Cryptography | no | None introduced |
| **V8 Data Protection (caching)** | **yes — phase-specific** | The disclosure vector is a **shared cache** populated under one principal and read by another. Control: Lane B never reads or writes the cache; enforced structurally (SC2-B). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation | Status here |
|---------|--------|---------------------|-------------|
| Cache-key confusion / cross-principal cache disclosure | Information Disclosure | Never populate a shared cache from a per-principal render; keep authenticated variance out of cached scope | **The phase's acceptance criterion (SC2).** ⚠️ §3a shows the key is id-only, so there is no per-principal dimension available even if wanted. |
| Service-role predicate drop | Elevation of Privilege / Info Disclosure | Route every owner-inclusive query through `withPublishedOrOwner`; probe on the RLS client first | Pattern 2 + `no-owner-or-on-admin-client` lint |
| Existence oracle via differentiated 404 | Information Disclosure | Non-owner authed and anon collapse to the **same** `notFound()`; probe errors log server-side but never change the status | Explicit in the Code Example; mirrors `returns/route.ts:219-233` |
| Draft metadata leakage via `<title>` / OG | Information Disclosure | Leave `generateMetadata` published-only; `robots:"noindex"` already unconditional (`page.tsx:301`) | G3 decision |
| Response-level caching of an authed render | Information Disclosure | `export const dynamic = "force-dynamic"` | ⚠️ **Not currently present on this route** — recommended addition (§3e) |
| Owner self-publication | Elevation of Privilege | DB trigger blocking `→ published` for `current_user='authenticated'` | Already shipped (mig `20260716131000`); this phase adds no writes |
| Shared-DB e2e pollution | — | Assert own-seed invariants, never global empty-state | §7c |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| `unstable_cache` from `next/cache` | `'use cache'` directive + Cache Components | Next.js 16 | Documented deprecation, but `cacheComponents` is **not** enabled in `next.config.ts`. **Do not migrate here** — a cache-semantics rewrite on the route whose cache safety is the acceptance criterion is the wrong phase for it. Log as tech debt if desired. |
| RLS-scoped `strategy_verifications` embed for trust tier | `get_published_trust_signals` SECDEF RPC | Phase 126 / mig 135 (2026-07-19) | Already in place at `page.tsx:349`; gives correct null-for-draft for free |
| Per-page inline copies of basis/series assembly | Shared `readSingleKeyBasisOpts` / `readCompositeFactsheet` | Phases 90 / 103 / 133 (WR-01) | Reinforces: parameterize the one builder, never fork it |

**Deprecated / outdated:**
- The `page.tsx:32-33` header claim about the cache key. It is wrong today (§3a) and is the kind
  of comment that causes the next disclosure bug.
- ROADMAP/REQUIREMENTS citation `page.tsx:344` → actual `:342`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CONTEXT's "generateMetadata on the owner lane: minimal + `robots: noindex`" is satisfied by **leaving G3 published-only** (the existing fallback already yields `"Strategy"` + generic description + unconditional noindex). An alternative reading is that a distinct owner-lane metadata branch is required. | §1 G3 | Low. If the stricter reading is intended, the fix is a small explicit branch — but the planner should decide deliberately rather than inherit my reading. Flag for confirmation. |
| A2 | The recommended `viewerNotice?: "owner_unpublished"` prop shape. CONTEXT places lane naming/structure under Claude's discretion, so this is a recommendation, not a lock. | §4 | Low — any shape satisfying UI-SPEC:112 (not on the payload) works |
| A3 | Adding `export const dynamic = "force-dynamic"` to the v2 page is beneficial. The route is *already* dynamic via `cookies()`; the export is belt-and-braces against a future refactor. It is a 1-line, behaviour-neutral addition — but it **is** a change beyond the minimum, so Rule 3 says the planner should decide, not me. | §3e | Low either way; the tearsheet precedent argues for it |
| A4 | The §3a cache-key staleness finding does **not** clear the founder's blast-radius bar (user-facing or data-integrity only) and should be logged to `TODOS.md` rather than fixed. Judgment call: a 1h-stale factsheet *is* mildly user-facing. | §3a | Medium — if the founder disagrees it becomes a separate small phase, not scope creep here |
| A5 | Two sequential RSC invocations in one vitest file, sharing an `unstable_cache` spy, adequately model "owner renders, then anon requests." This is a unit-level model of a cross-request property; a true cross-request proof needs e2e. | Validation Architecture | Medium — see Open Question 1 |

---

## Open Questions

1. **Does SC2 need an e2e layer, or do unit + structural suffice?**
   - What we know: CONTEXT locks SC2 acceptance to two layers — behaviour and structural — and
     both are achievable in vitest. The structural layer is genuinely stronger than an e2e
     observation (it is a CI invariant, not a one-time observation).
   - What's unclear: the unit "behaviour" layer models the cross-request cache with a spy, not a
     real Next data cache. A true two-request proof (owner GET → anon GET → 404) needs Playwright
     plus a seeded owner+draft fixture on the shared TEST DB.
   - Recommendation: **ship the two locked layers; treat e2e as optional.** The structural layer
     is the load-bearing one — it proves the property *by construction* rather than by
     observation, which is exactly what CONTEXT asked for ("asserted, not observed"). If the
     planner adds e2e, it must seed its own owner+draft pair and assert only on that id (§7c).

2. **Should the `factsheet-v2-payload-v6` header comment be corrected in this phase?**
   - What we know: it is factually wrong (§3a) and it is the comment a future engineer will read
     before touching this cache.
   - What's unclear: Rule 3 (surgical) vs. the fact that a wrong safety comment is itself a hazard.
   - Recommendation: **correct the comment, do not change the behaviour.** A comment fix is
     zero-risk and directly serves the phase's own thesis. Log the behavioural staleness to
     `TODOS.md` separately.

3. **Does Phase 149 (NAV-01) need the lane predicate exported, or is a parameterized builder enough?**
   - What we know: ROADMAP says 149 "consumes this phase's cache-safe gate — parameterize, do not
     build the ranking."
   - What's unclear: whether 149 needs the *page's* lane logic or just `withPublishedOrOwner`
     (which it already has).
   - Recommendation: **do nothing extra.** 149's ranking is a list query, not a factsheet render;
     `withPublishedOrOwner` already exists and browse already uses it. Extracting a "lane helper"
     speculatively would violate Rule 2. The parameterized `fetchAndBuildPayload` is the only
     seam 149 could plausibly want, and it will exist.

---

## Environment Availability

**Not applicable — no new external dependencies.** This phase is code-only within an existing
Next.js app: no new CLI tool, service, runtime, package, or migration. The toolchain it needs
(node/npm, vitest, playwright, tsc, eslint, supabase CLI for the existing SQL gates) is already
in use by the repo's CI and by Phase 147, which just completed on this branch.

⚠️ One environment note carried from repo memory (execution-time, not research-time): CI runs
Node 22 while local runs Node 25; a CI-only vitest failure is skew, not a flake, and reproduces
with `PATH=/opt/homebrew/opt/node@22/bin`.

---

## Sources

### Primary (HIGH confidence — read in this session)
- `src/app/factsheet/[id]/v2/page.tsx` (full, 466 lines) — the four gate sites, cache wrapper, lane targets
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`:87-208`, `:554-566`) — prop shape, article structure, banner primitive
- `src/lib/visibility.ts` (full, 125 lines) — both predicates + their documented contracts
- `src/app/api/strategies/[id]/returns/route.ts` (`:120`, `:182-270`) — the owner-probe reference implementation
- `src/app/api/strategies/[id]/returns/route.test.ts` (`:36`, `:128-192`, `:639`) — R8 non-vacuity idiom
- `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` (full) — the page-level RSC harness + the mock that will break
- `src/__tests__/phase-147-series-resolution-guards.test.ts` (`:1-40`) — the structural-invariant idiom
- `src/app/factsheet/[id]/tearsheet/page.tsx` (`:18-25`, `:100-140`) — `force-dynamic` + auth-lane precedent on a sibling public factsheet
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (`:4`, `:142-143`, `:274`, `:1781`, `:1917`, `:2194`, `:2208-2219`)
- `src/app/factsheet/[id]/v2/layout.tsx` (full) — the `<main>` landmark rationale
- `src/proxy.ts` (`:17`, `:109`) — `/factsheet` public-route allow-list
- `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs` (full) — the rule's own honest scope caveat (Pitfall 1)
- `eslint.config.mjs` (`:46`, `:51`) — both visibility rules wired repo-wide at `"error"`
- `supabase/migrations/20260405061912_rls_policies.sql` (`:28-44`) — `strategies_read`, `analytics_read`
- `supabase/migrations/20260428120919_strategy_analytics_series.sql` (`:105-118`) — deny-all
- `supabase/migrations/20260522111839_csv_daily_returns.sql` (`:55-94`) — owner/admin/service policies
- `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql` (`:63-72`) — per-key owner policy
- `supabase/migrations/20260719140000_get_published_trust_signals.sql` (`:73-98`, `:101-132`) — SECDEF published-gate + self-verifying proof
- `supabase/migrations/20260716131000_guard_strategies_publish_transition.sql` (`:1-40`) — admin-only publication trigger
- `node_modules/next/dist/server/web/spec-extension/unstable-cache.js` (`:17-18`, `:55`, `:80-85`, `:177`, `:218`, `:256`) — key derivation + unconditional null caching
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md` (full) — Next 16 deprecation notice, `keyParts` semantics
- `next.config.ts` — no `experimental.cacheComponents`
- `.planning/phases/148-*/148-CONTEXT.md`, `148-UI-SPEC.md`, `.planning/ROADMAP.md:104-121`, `.planning/REQUIREMENTS.md:519-559`
- `CLAUDE.md`, `AGENTS.md`

### Secondary (MEDIUM confidence)
- `src/__tests__/contracts/contracts-registry.test.ts` + `REGISTRY.md` — lint-rule registry (skimmed)
- `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` (`:11-24`, `:112-176`) — GUARD-02 (headers read, bodies skimmed)
- `e2e/mt5-badge.spec.ts`, `e2e/for-quants-onboarding.spec.ts` — badge regression coverage (headers read)
- `.planning/phases/147-*/147-VALIDATION.md` — validation-doc format precedent

### Tertiary (LOW confidence — flagged, not relied on)
- None. No WebSearch was used; every claim traces to repo source, migrations, or `node_modules`.

---

## Metadata

**Confidence breakdown:**
- Gate site census: **HIGH** — all four sites read in full; the "no deeper gate" claim verified by an exhaustive grep of `src/lib/factsheet/`
- RLS reality: **HIGH** — policy DDL read verbatim from migrations; corroborated by a production consumer (`returns/route.ts`)
- Cache mechanics: **HIGH** — derived from Next's own source, not from documentation or memory. The `computedAt`-not-in-key finding is mechanical, not inferential.
- Lane signaling: **HIGH** (facts) / **MEDIUM** (recommended prop shape — Claude's-discretion area, A2)
- SyncPreviewStep: **HIGH** — every line number read directly
- Test patterns: **HIGH** — both idioms exist in-repo and were read
- SECDEF / e2e: **HIGH** — DB-level gate read from the migration, with an existing SQL test
- `generateMetadata` treatment: **MEDIUM** — depends on reading A1

**Research date:** 2026-08-05
**Valid until:** 2026-09-04 (30 days — internal codebase facts; re-verify line numbers if the
branch rebases, and re-verify §3a if `next` is upgraded)
