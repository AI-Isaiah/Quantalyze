# Phase 164: SHARE — Copy Link always works, and never discloses - Research

**Researched:** 2026-08-26
**HEAD at research time:** `2625a02d1`
**Domain:** Revocable capability-URL share lane on a Next.js 16 App Router factsheet, HMAC-derived tokens over Supabase Postgres/RLS, with a load-bearing cache-isolation invariant (SL-1)
**Confidence:** HIGH on every in-repo claim (all read from HEAD this session, cited file:line); LOW/[ASSUMED] on the four external-behaviour claims listed in the Assumptions Log (network was unavailable this session — no external docs could be fetched)

⚠️ **Line-number reality check:** `research/ARCHITECTURE.md`, `research/FEATURES.md`, `research/PITFALLS.md` and 164-CONTEXT.md all cite line numbers from HEAD `ca3f0c5c` (2026-08-20), when `v2/page.tsx` was 664 lines. At current HEAD it is **699 lines** and every citation has shifted. Section "Stale-citation remap" below is the authoritative translation table. Planners MUST use the HEAD numbers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (FOUNDER DECISIONS, 2026-08-26 — CLOSED; do not re-open, do not default, do not re-litigate)

**A-D1 — URL shape: separate route `/factsheet-share/<token>`.** The token lives in its own route, NOT as `?s=` on `/factsheet/[id]`. Enforcement becomes STRUCTURAL (a separate module physically cannot reach the `["factsheet-v2-payload-v6", id]` cache entry); the SL-1c failure mode (silent, TTL-long) justifies the stronger guard; the id never enters the URL; precedent is CI-pinned at `/scenario-share/[token]`. Cost: +1 entry at `proxy.ts:17` and +1 prefix arm (accepted). **This supersedes a premise in `research/FEATURES.md`** — treat as VOID: the `?s= must imply shareMode` dependency (FEATURES :121), the FEATURES :96 row rejecting a separate route, and any reasoning downstream of "the URL contains the id". Everything else in FEATURES.md (honest affordances, 410-vs-404 asymmetry, revoke semantics, mint-on-copy, no auto-mint, no disabled buttons) still governs. Do not blend the two documents.

**Token model — HMAC + stored generation counter.** `token = HMAC(SHARE_TOKEN_SECRET, strategy_id || generation)`. The table stores `(strategy_id, generation, revoked_at)` and **never a token, raw or hashed**. Only a re-derivable token delivers mint-or-REUSE across sessions (a verbatim `/scenario-share` port stores only the hash and unconditionally revokes on mint — regenerating the founder-hit bug in slow motion). Nothing secret at rest. Revoke = one atomic increment; double-revoke converges. ⚠️ `SHARE_TOKEN_SECRET` is a PROD-ONLY failure mode: validate at module load / boot, fail LOUD with a named remedy — never at first share. ⚠️ Separate module from `scenario-share-token.ts` — do not reuse or extend it (`scenario-share-token.test.ts` pins its digest; one token namespace for two resources invites cross-resource replay).

**A-D2 — Revoke lives on the factsheet; `StrategyActions` is UNCHANGED.** Its `return null` fall-through for `status='private'` stays exactly as it is. ⛔ No publish flow grows inside this phase.

**A-D3 — Token scope: HTML factsheet ONLY.** `/factsheet/[id]/tearsheet` and the PDF routes are OUT. A recipient hitting them gets the normal 404. Each excluded surface would need its own SL-1 argument and adversarial test.

### Claude's Discretion
- Table and RPC naming, migration timestamp, and whether `create_strategy_share` is INVOKER or SECDEF — subject to the three-reviewer migration gate.
- The inline-confirm copy for revoke (must match the `SavedScenariosList.tsx` inline-confirm precedent shape, NOT a `window.confirm`).
- Whether the owner's "a live link exists" state reuses the `has_active_share` + local-override shape from `SavedScenariosList.tsx` (recommended) or derives it fresh.

### Deferred Ideas (OUT OF SCOPE)
- A publish path for `status='private'` strategies — deliberately still open (A-D2).
- Token access for the tearsheet and PDF routes (A-D3).
- Any change to `/api/og/factsheet/[id]` (SL-1d forbids the obvious one).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | "Copy Link" always yields a URL its recipient can view — revocable per-strategy share token in the URL, mint-or-reuse on copy; bare `/factsheet/<id>` stays owner-only; the id stays a non-secret. (A-D1 now decided: separate route.) | §HMAC module spec; §Mint/revoke routes; §Token-verification lookup; §Proxy + route-contract integration |
| SHARE-02 | The token lane never contaminates the id-keyed public cache — after any token-lane render, an anonymous request for `/factsheet/<id>` of an unpublished strategy STILL 404s (adversarial acceptance, OWN-02 class). | §SL-1 verified at HEAD; §Payload-builder seam (quantified); §Phase-148 gate landmine; §Validation Architecture |
| SHARE-03 | A revoke control regenerates the token and kills previously-copied links. | §DDL shape (generation counter semantics); §Revoke route precedent; §410 mechanics |
| SHARE-04 | Share affordance honest as a CLASS across `FactsheetView`, strategies page, discovery detail; a token-link RECIPIENT must not see a Copy-Link control; `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence corrected in the same phase. | §Affordance sites at HEAD (incl. the A-D1 correction to the :1489 rebuild analysis); §Owner share-state precedent |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **This Next.js version differs from training data** — read `node_modules/next/dist/docs/` before writing code (done for the 410 question below).
- Repo is PUBLIC and `.planning/` is TRACKED: no emails, uids, credentials, prod URLs, project refs, usernames, or absolute paths in any artifact. `npm run lint` runs `check-planning-hygiene.ts` (a no-allowlist scanner) plus `check-route-contract.ts` and `check-admin-route-manifest.ts` (`package.json:11`).
- Coverage is a blocking CI gate (lines 82 / statements 80 / functions 74 / branches 72 via vitest thresholds).
- DESIGN.md governs all visual decisions (revoke confirm UI, recipient banner, 410 page).
- ⛔ Three reviewers (`migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`) before ANY migration apply; merging `supabase/migrations/**` to main AUTO-applies to PROD.
- Feature-branch + PR always; ⛔ this phase shares a PR with NOTHING (ROADMAP); ⛔ never branched from `feat/phase-156-connect-refactor`.
- Every bug found gets a regression test that fails without the fix; every gate demonstrated RED with the fix neutered; ⛔ gate tokens counted PRE-EDIT.
- `/ship` not `/gsd-ship`; never manual git commit.

## Summary

Phase 164 builds the revocable share-token lane for unpublished factsheets under four closed founder decisions. The research verified every integration point at HEAD `2625a02d1` and found **five things the planner would otherwise discover mid-execution**:

1. **The payload-builder seam has already collapsed.** ARCHITECTURE.md A.4 warned that extracting the build half of `fetchAndBuildPayload` "touches the composite arm and the single-key basis arm, so its diff is wider than it looks" (MEDIUM confidence, measurement owed). That measurement is now done: since Jul 22–29 the composite and basis arms live in `src/lib/factsheet/composite-read-path.ts` and `build-payload.ts`, and `fetchAndBuildPayload`'s entire post-query body (`v2/page.tsx:111-311`) calls only already-lib functions. The extraction is a one-function move, not a refactor. Confidence on the seam is now HIGH.
2. **Two CI gates will fire on the obvious implementation and must be amended as reviewed acts:** the phase-29 frozen-spine gate fails any migration whose *filename* matches `/scenario|share/i`, and the phase-148 OWN-02 gate fails any production file outside `v2/page.tsx` that mentions the literal `fetchAndBuildPayload`. Both have clean, pre-plannable amendments (narrow the regex to `/scenario/i`; extract under a new name and extend the gate with token-lane rows).
3. **App Router cannot emit HTTP 410 from a page.** This Next version's interrupt APIs are `notFound` (404), `forbidden` (403), `unauthorized` (401) only — verified against the bundled docs. The content-free 410 requires a redirect to a sibling route handler (design given below).
4. **The HMAC token model has an unstated lookup problem** — a pure MAC contains no lookup key and nothing token-derived may be stored, so verification is a bounded constant-time scan over active share rows (trivial at current scale, and rate-limited first). Options and a recommendation are given; the token format itself is not reopened.
5. **The token-leak surface re-derivation (per the A-D1 instruction) finds one genuinely NEW channel** — Plausible analytics records URL *paths* for every pageview site-wide (`layout.tsx:92-96`), so a path token reaches a third party that a query token would not have — and finds that Sentry is server-only here, with the raw request path flowing into events via `instrumentation.ts` (no `beforeSend` exists yet).

**Primary recommendation:** transpose the `/scenario-share` spine (route discipline, RLS shape, mint/revoke conventions) onto a new `/factsheet-share/[token]` module + `strategy_shares` table with a generation counter; extract `v2/page.tsx:111-311` into `src/lib/factsheet/` under a NEW name; verify tokens in Node by bounded scan; ship the Sentry path scrub, the per-route `Referrer-Policy: no-referrer`, and the two gate amendments inside the same phase.

## Stale-citation remap (research docs → HEAD `2625a02d1`)

Every discrete value below was re-read this session.

| Claim | Old cite (docs/CONTEXT) | At HEAD | Verified content |
|---|---|---|---|
| `force-dynamic` pin | v2/page.tsx:33 | **:34** | `export const dynamic = "force-dynamic";` [VERIFIED: src/app/factsheet/[id]/v2/page.tsx:34] |
| `fetchAndBuildPayload` | :82 | **:83-312** | signature `async function fetchAndBuildPayload(id: string, visibility: StrategyVisibility): Promise<FactsheetPayload \| null>` [VERIFIED: :83-86] |
| cacheKey split / SL-1a | :282 | **:317** | `const [id] = cacheKey.split("::");` [VERIFIED: :317] |
| wrapper predicate-free / SL-1b | :287-294 | **:314-329** | "⛔ This wrapper takes NO visibility parameter, and the predicate below is a LITERAL, never a variable." [VERIFIED: :323-324] |
| keyParts + TTL | — | **:356-360** | `["factsheet-v2-payload-v6", id]` … `revalidate: 3600, tags: ["factsheet-v2", `factsheet-v2:${id}`]` [VERIFIED: :356-359] |
| owner-lane direct call / SL-1 null rule | :530-538 | **:562-573** | "⛔ The owner arm calls the builder DIRECTLY: no cache read, no cache write. … The same applies to a `null`: unstable_cache stores it unconditionally" [VERIFIED: :562-567]; `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))` at :572; `buildFactsheetPayloadCached(\`${id}::${computedAt}\`)` at :573 |
| `generateMetadata` | :329-376 | **:364-411** | fallback name resolves to `"Strategy"` when the `withPublishedOnly` probe misses (`data` null): `const name = data?.name ?? data?.codename ?? (data ? displayStrategyName({…}) : "Strategy");` [VERIFIED: :383-388]; `robots: "noindex"` :397; `const ogImage = \`/api/og/factsheet/${id}\`;` emitted **unconditionally** :393 |
| ShareLinkButton | FactsheetView.tsx:1307-1338 | **:1483-1515** | URL rebuild `const url = \`${window.location.origin}${window.location.pathname}?share=1\`;` [VERIFIED: src/app/factsheet/[id]/v2/FactsheetView.tsx:1489] |
| Share button gate | :1565 | **:1741** | `{!scenarioMode && <ShareLinkButton strategyId={payload.strategyId} />}` [VERIFIED: :1741] |
| `useShareMode` | :1300 | **:1470-1481** | keys on `?share=1` via `window.location.search` [VERIFIED: :1470-1481] |
| `OwnerUnpublishedNotice` | :690 | **:693-709** | false-once-tokens-ship sentence: "Anyone else who opens this link sees a 404 until Quantalyze review publishes it." [VERIFIED: :704-706] |
| proxy PUBLIC_ROUTES | proxy.ts:17 | **:17** (unchanged) | array includes `"/scenario-share"` [VERIFIED: src/proxy.ts:17] |
| proxy prefix arm | :117 | **:116-117** + exempt union **:126-136** | `const isScenarioShareRoute = path === "/scenario-share" \|\| path.startsWith("/scenario-share/");` [VERIFIED: :116-117]; used in `isAuthBounceExempt` :126-136; bounce branch :137-144 |
| Referrer-Policy | next.config.ts:79 | **:79** (unchanged) | `{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }` [VERIFIED: next.config.ts:79] |
| StrategyActions private dead-end | :113, :162 | **:113-114, :162** (unchanged) | `pending_review` → `return null` :113-114; final fall-through `return null;` :162 — `private` matches nothing [VERIFIED: src/components/strategy/StrategyActions.tsx:53-162] |
| strategies-page affordance | :175 | **:174-175** | `{s.status === "published" && (<ShareableLink strategyId={s.id} />)}` [VERIFIED: src/app/(dashboard)/strategies/page.tsx:174-175] |
| discovery-detail affordance | :187 | **:196** | `<ShareableLink strategyId={strategy.id} variant="primary" />`, under the page's published gate (`getStrategyDetail(strategyId, slug, "discovery")` → `if (!result) notFound()` :45) [VERIFIED: src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:45,196] |
| SavedScenariosList precedents | :45-51, :199-203, :333-341, :598-615 | **:44-52, :199-205, :333-341, :598-619** | `has_active_share?: boolean` row flag :44-52; `hasActiveShare` local-override :201-205; 404-as-convergence comment :333-341; inline confirm "Revoke this share link? Anyone with the link will lose access." + Revoke / Keep link buttons :599-619 [VERIFIED: src/app/(dashboard)/allocations/components/SavedScenariosList.tsx] |
| OG route CDN header / SL-1d | og route :154 | **:188-189** | `"Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"` [VERIFIED: src/app/api/og/factsheet/[id]/route.tsx:188-189] |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token derivation + constant-time verification | API/Backend (Node, new lib module) | — | HMAC needs the server secret; pgcrypto `digest` is enabled nowhere ("pgcrypto `digest` is not installed" — [VERIFIED: supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:25-31]), so SQL cannot participate |
| Share-state storage (strategy_id, generation, revoked_at) | Database (Supabase, RLS) | — | Owner RLS + anon REVOKE; nothing secret at rest by founder decision |
| Mint / revoke | API/Backend (owner-scoped routes) | Database (RLS WITH CHECK owner-coherence) | Three-layer ownership per the scenario precedent |
| Recipient render | Frontend Server (new RSC route module) | API/Backend (service-role reads) | force-dynamic, no-store, admin transport — the `/scenario-share` pattern verbatim |
| Cache isolation (SL-1) | Frontend Server — structural | CI gates (phase-148 file) | The new module has no `unstable_cache` import at all; the id-keyed entry is unreachable by construction |
| 410 status emission | Frontend Server (redirect) + API route handler | — | App Router pages cannot set 410; see §410 mechanics |
| OG image / metadata | Frontend Server (static metadata on token route) | CDN (untouched) | SL-1d: OG route stays published-only and CDN-cached |
| Token-leak scrubbing | Observability config (`src/instrumentation.ts`) + headers (`next.config.ts`) | Analytics scripts (`layout.tsx`) | Path-based scrubbing, not query-param |

## Standard Stack

### Core — no new packages

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` (`createHmac`, `timingSafeEqual`) | Node 22 builtin | token derivation + constant-time compare | exact precedent in `src/lib/demo-pdf-token.ts` (`createHmac("sha256", secret)` :32-34, `timingSafeEqual` :107-111) [VERIFIED: src/lib/demo-pdf-token.ts:1,32-34,107-111] |
| `zod` (present) | repo-pinned | route body validation | scenario mint/revoke routes use it with the codebase-canonical `isUuid` refine, NOT zod v4 `.uuid()` [VERIFIED: src/app/api/allocator/scenario/share/route.ts:70-80] |
| `@supabase/ssr` clients (present) | repo-pinned | RLS-scoped owner writes; `createAdminClient()` service-role recipient reads | `/scenario-share/[token]/page.tsx:22,134` |
| `next` | 16.x (repo) | new route module, `redirect`, route handler for 410 | bundled docs read this session |

**Installation:** none. This phase adds zero dependencies.

## Package Legitimacy Audit

No external packages are installed by this phase — all cryptography is `node:crypto`, all transport is existing repo dependencies. **Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
MINT (owner)                                   READ (recipient, anonymous)
────────────                                   ───────────────────────────
Copy Link on factsheet (owner lane)            GET /factsheet-share/<raw-token>
  → POST /api/strategies/[id]/share              → proxy.ts: PUBLIC_ROUTES + bounce-exempt
    → auth (createClient + getUser)              → page.tsx (force-dynamic, nodejs,
    → zod body validate (400 burns no token)         NO unstable_cache import — SL-1 structural)
    → checkLimit(userActionLimiter)              → checkLimit(publicIpLimiter, ip) FIRST
    → RLS owner probe → 404 if not owner         → format-guard raw token (43-char base64url)
    → upsert strategy_shares                     → admin.from("strategy_shares")
        (reactivate-or-insert, atomic)               .select("strategy_id, generation")
    → deriveShareToken(strategy_id, generation)      .is("revoked_at", null)      ← bounded scan
    → 200 { url: APP_URL/factsheet-share/<tok> } → for each row: deriveShareToken(...)
    → logAuditEvent (audit-coverage gate)            timingSafeEqual vs presented token
                                                 ├ NO match → redirect("/factsheet-share/gone")
REVOKE (owner, on the factsheet — A-D2)          │    → route handler returns 410 + no-store,
  → POST /api/strategies/[id]/share/revoke       │      content-free copy
    → UPDATE strategy_shares                     └ match → fetch strategies row by id
        SET revoked_at = now(),                        (admin client, shared COLUMN-LIST const,
            generation = generation + 1                 NO status predicate — token IS the authz)
        WHERE strategy_id = $1                       → buildFactsheetPayloadFromRow(admin, row)
          AND revoked_at IS NULL                        (NEW lib fn = verbatim move of
    → 0 rows → 404 (convergence, no oracle)              v2/page.tsx:111-311; zero cache calls)
    → next recipient load → 410 IMMEDIATELY          → <FactsheetView payload recipientMode />
      (force-dynamic + no-store, nothing cached)     → response headers: no-store
```

The bare-id lanes in `v2/page.tsx` are byte-unchanged (ideal diff: comments only). The id-keyed `unstable_cache` entry is written by exactly one callback (`:330-361`) whose predicate stays the literal `withPublishedOnly` (`:331`).

### Recommended structure (new files)

```
src/lib/strategy-share-token.ts            # HMAC module — SEPARATE from scenario-share-token.ts
src/lib/strategy-share-token.test.ts       # namespace + known-vector pins
src/lib/factsheet/build-from-strategy-row.ts   # the extracted build half (NEW NAME — see gate landmine)
src/app/factsheet-share/[token]/page.tsx   # recipient RSC (force-dynamic, nodejs, no unstable_cache)
src/app/factsheet-share/gone/route.ts      # the 410 emitter (content-free, no-store)
src/app/api/strategies/[id]/share/route.ts         # mint-or-reuse
src/app/api/strategies/[id]/share/revoke/route.ts  # revoke
supabase/migrations/<ts>_strategy_link_shares….sql # naming: see frozen-spine landmine first
supabase/tests/test_strategy_shares_rls.sql        # RED until TEST hand-apply (SKIP-01)
```

---

## Q1 — Exact integration points for `/factsheet-share/[token]`

### The `/scenario-share/[token]/page.tsx` pattern (all verified at HEAD)

| Element | Location | Content |
|---|---|---|
| No-edge-cache pin | `src/app/scenario-share/[token]/page.tsx:54-60` | "DO NOT cache at the edge. Shared caches are keyed on the URL, not the token's revocation state. A cached response could be replayed after the token is revoked" → `export const dynamic = "force-dynamic"; export const runtime = "nodejs";` [VERIFIED: :54-60] |
| Limiter FIRST, neutral denial | `:114-130` | `const ip = getClientIp(hdrs); const rl = await checkLimit(publicIpLimiter, \`scenario-share:${ip}\`);` — on denial renders a neutral "Please try again shortly" `EmptyStateCard`, **not** a 404, "so the rate-limit response does not leak token existence" [VERIFIED: :114-130] |
| Service-role transport | `:134-137` | `const admin = createAdminClient(); const { data, error } = await admin.rpc("get_shared_scenario", { p_token_hash: hashShareToken(token) } as never);` [VERIFIED: :134-137] |
| Uniform miss handling + error redaction | `:139-153` | every miss (unknown / revoked / cross-tenant / DB error) → `notFound()`; DB error detail logged server-side, never echoed [VERIFIED: :139-153] |
| Limiter constants | `src/lib/ratelimit.ts:117` | `export const publicIpLimiter = makeLimiter(10, "60 s");` [VERIFIED: ratelimit.ts:117]; `getClientIp(headers)` at `:652` (Vercel `x-real-ip`, else rightmost `x-forwarded-for`, else literal `"unknown"`) [VERIFIED: :652-668] |
| ⚠️ Metadata GAP in the precedent | whole file | the scenario-share page exports **no** `metadata`/`generateMetadata` → it inherits `src/app/layout.tsx:33-36` (`title: "Quantalyze"`) and therefore carries **no `robots: noindex`**. Do NOT copy this gap — see Q5. [VERIFIED: full read of the 418-line file; layout.tsx:33-36] |

### `proxy.ts` — the A-D1 "+2" is really 3 proxy edits + 1 manifest edit

1. `src/proxy.ts:17` — add `"/factsheet-share"` to `PUBLIC_ROUTES`. Prefix matching is `path === route || path.startsWith(route + "/")` (`:69-71`), so the existing `"/factsheet"` entry does **not** cover it (`"/factsheet-share/x".startsWith("/factsheet/")` is false). [VERIFIED: src/proxy.ts:17,69-71]
2. `:116-117` region — add `const isFactsheetShareRoute = path === "/factsheet-share" || path.startsWith("/factsheet-share/");` beside `isScenarioShareRoute`. [VERIFIED: :116-117]
3. `:126-136` — add it to the `isAuthBounceExempt` union. **Omitting this edit is a live bug:** an authed owner opening their own share link would hit the `session && isPublicRoute` branch (`:137-144`) and be 307'd to the dashboard. `/scenario-share` is in the union for exactly this reason. [VERIFIED: :126-144]
4. `src/lib/routing/route-contract-manifest.ts` — add an entry mirroring `:376-381`: `{ route: "/scenario-share/:token", class: "public", notes: "…covered by the /scenario-share PUBLIC_ROUTES prefix + bounce-exempt. In-the-wild link — NEVER MOVE." }` [VERIFIED: route-contract-manifest.ts:376-381]. `npm run lint` runs `scripts/check-route-contract.ts`, whose Rule 1 requires every route to have a manifest entry and Rule 2 requires every `public` entry to appear in `proxy.ts` [VERIFIED: scripts/check-route-contract.ts:6-22; package.json:11]. **The proxy edit and the manifest edit must land in the same commit or lint goes red.**
5. The `gone` route (`/factsheet-share/gone`) is covered by the same prefix — no additional proxy entry.
6. `config.matcher` (`:165-175`) needs no change (it excludes only static assets).

---

## Q2 — The token lane's payload WITHOUT touching the id-keyed cache (SL-1)

### SL-1 verified at HEAD

- The effective cache key is id-ONLY: the passed string is split and the tail discarded — `const [id] = cacheKey.split("::");` [VERIFIED: v2/page.tsx:317]; keyParts `["factsheet-v2-payload-v6", id]` [VERIFIED: :356]; header comment: "⛔ Corollary: viewer/lane separation can NEVER be expressed through the cacheKey string. Appending a suffix yields the SAME entry" [VERIFIED: :76-81].
- The wrapper is predicate-free by design: "⛔ This wrapper takes NO visibility parameter, and the predicate below is a LITERAL, never a variable." [VERIFIED: :323-324]; the callback is `async () => fetchAndBuildPayload(id, withPublishedOnly)` [VERIFIED: :331].
- `null` is stored unconditionally: "The same applies to a `null`: unstable_cache stores it unconditionally, so a draft that fails to build must not reach the wrapper either." [VERIFIED: :565-567].
- The builder runs on the service-role client (`const supabase = createAdminClient();` [VERIFIED: :87]) — the injected predicate is the only gate.

### The seam, quantified (the measurement ARCHITECTURE A.4 owed)

**The extraction has effectively already been paid for.** At the research docs' HEAD the composite/basis arms were treated as page-internal; at current HEAD they are lib imports:

```ts
// v2/page.tsx:16-19 [VERIFIED]
import { buildFactsheetPayload, deriveIngestSource } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { readCompositeFactsheet, singleKeyDataQuality, readSingleKeyBasisOpts } from "@/lib/factsheet/composite-read-path";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
```

The **build half** of `fetchAndBuildPayload` is `v2/page.tsx:111-311` — everything after the strategies query. Its complete callee set, with locations:

| Callee | Defined at | Extra DB reads it performs |
|---|---|---|
| `isComputedAnalytics` | `src/lib/closed-sets.ts` (imported :11) | none — the STALE-01 render gate at :140-146 |
| `resolveDailyReturnSeries` | `src/lib/factsheet/allocator-portfolio-payload.ts:10` (re-export from `resolve-series.ts`) | none |
| `deriveIngestSource` | `src/lib/factsheet/build-payload.ts:44` | none |
| `readCompositeFactsheet` | `src/lib/factsheet/composite-read-path.ts:203` | `csv_daily_returns` (`:226`) — bounded to the passed strategyId [VERIFIED: composite-read-path.ts:203,226] |
| `readSingleKeyBasisOpts` | `composite-read-path.ts:509` | `strategy_analytics_series` via `readMtmSeries` (`:100`) / `readSmoothedSeries` (`:151`) — bounded to the passed id [VERIFIED: :95-151,509] |
| `singleKeyDataQuality` | `composite-read-path.ts:384` | none |
| `buildFactsheetPayload` | `build-payload.ts:324` | none (pure) |
| `displayStrategyName` | `src/lib/strategy-display.ts` (imported :8) | none |

All secondary reads ride the same admin handle and are bounded by construction to the already-authorized strategy id — the disclosure argument for the token lane is identical to the owner lane's.

**Recommended shape (Design 1):**
1. Create `src/lib/factsheet/build-from-strategy-row.ts` exporting `buildFactsheetPayloadFromRow(supabase: SupabaseClient, strategy: StrategyRowWithAnalytics): Promise<FactsheetPayload | null>` — a **verbatim move** of `:111-311`. ⛔ The new module must contain zero `unstable_cache` imports, and its name must NOT be `fetchAndBuildPayload` or `buildFactsheetPayloadCached` (see phase-148 landmine).
2. `fetchAndBuildPayload` in `v2/page.tsx` becomes query (`:87-109`) + one call to the new function. Its two call sites are unchanged: the cached callback (`:331`) and the owner arm (`:572`).
3. Hoist the strategies SELECT column list (`:92-96` — `id, name, codename, disclosure_tier, status, markets, strategy_types, description, subtypes, supported_exchanges, leverage_range, aum, max_capacity, avg_daily_turnover, start_date, benchmark, asset_class, returns_denominator_config` + the `strategy_analytics(daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status)` embed [VERIFIED: :92-96]) into an exported constant in the new lib module, consumed by BOTH the page query and the token route's query — the `PERCENTILE_ANALYTICS_COLUMNS` anti-drift precedent.
4. The token route fetches its row itself: `admin.from("strategies").select(FACTSHEET_ROW_COLUMNS).eq("id", resolvedId).maybeSingle()` — **deliberately no status predicate** (the token IS the authorization; the row is expected to be unpublished) with a loud comment. This avoids Design 2 / ARCHITECTURE option (b) (`(q) => q.eq("id", id)` masquerading as a `StrategyVisibility`), which the type exists to prevent ("the injected predicate is the ONLY gate" [VERIFIED: :42-46]). Note the B25 visibility-lint boundary only bans raw `.eq("status","published")` predicates on `strategies`; a token-lane id-equality read carries no status predicate at all.
5. A `null` build result on the token lane → same 410-redirect as an unknown token? **No** — a valid token whose payload cannot build is the "still computing" state, not a dead link. Render the honest pending placeholder (the `:574-626` fallback pattern) minus owner chrome. A 410 there would tell the recipient the link is dead when it is not.

**SL-1 invariant restated for the planner:** zero cache reads and zero cache writes at `["factsheet-v2-payload-vN", id]` from the token lane. The new route module achieves this structurally by never importing `unstable_cache` and never importing anything from `v2/page.tsx`.

### ⛔ Gate landmine 1 — phase-148 OWN-02 bans a second mention of the builder names

`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts:357-381` walks **every** production source under `src/` (comments stripped), exempts only `src/app/factsheet/[id]/v2/page.tsx`, and fails on any file containing the literal tokens: `for (const token of ["buildFactsheetPayloadCached", "fetchAndBuildPayload"])` [VERIFIED: phase-148-owner-lane-cache-isolation.test.ts:364-372]. Consequences:
- The extracted function and the token route must not use either name (hence `buildFactsheetPayloadFromRow`).
- The gate should be **extended, not routed around**, with token-lane rows (PITFALLS.md already prescribes extending this file rather than a parallel one): assert the token route module contains no `unstable_cache`, no `buildFactsheetPayloadCached`, no `fetchAndBuildPayload`; assert the new lib module contains no `unstable_cache`; keep the existing walk intact. Gate tokens counted PRE-EDIT; demonstrated RED by neutering (e.g., temporarily importing the banned name).
- The file also pins: cached callback names `withPublishedOnly` literally (`:307-326`), wrapper declaration head has no visibility param (`:327`), `generateMetadata` never reaches the owner predicate (`:339`), `force-dynamic` present (`:347`) [VERIFIED: test names at :301-347]. The extraction refactor must keep all 9 green — the extractors parse `v2/page.tsx` by function name, so keeping `fetchAndBuildPayload` and `buildFactsheetPayloadCached` **in the page** (as query + wrapper) preserves them.

### ⛔ Gate landmine 2 — phase-29 frozen-spine fails any migration filename containing "share"

`src/__tests__/phase-29-frozen-spine-guards.test.ts:140-171`: `const FORBIDDEN_MIGRATION_RE = /scenario|share/i;` applied to every changed file `f.startsWith("supabase/migrations/") && FORBIDDEN_MIGRATION_RE.test(f)` in the phase delta vs the merge base [VERIFIED: :140-160]. A migration named `<ts>_strategy_shares_and_read_rpc.sql` **fails this gate**. The gate's locked set is "scenarios / scenario_shares / get_shared_scenario / create_scenario_share; every one matches /scenario|share/i" [VERIFIED: :138-141] — and every one **also** matches `/scenario/i` alone. **Recommendation:** narrow the regex to `/scenario/i` as a reviewed act (the file itself documents two prior reviewed retirements at :176-190), recording that the `|share` half was redundant for the locked set and false-positives on `strategy_shares`. Do NOT game the gate by misnaming the migration. Note Phase 164.1 ("retire the frozen-spine gates that no longer bite") runs AFTER 164, so this cannot be deferred to it.

---

## Q3 — The HMAC module: `src/lib/strategy-share-token.ts`

### Why separate from `scenario-share-token.ts` (verified)

- `src/lib/scenario-share-token.test.ts` pins the scenario digest algorithm to a literal vector: `expect(hashShareToken("scenario-share")).toBe("e1c28b72e9237809e2bd84d2ace94f6b4c7b99096ac6ebf64fe665c46c491676")` [VERIFIED: src/lib/scenario-share-token.test.ts:52-58].
- The scenario module's own header rejects the keyed-MAC model *for its stateless form only*: "impossible with a stateless HMAC token — the revocation requirement is why this is a random+stored-hash model, NOT the keyed-MAC model of `demo-pdf-token.ts`" [VERIFIED: src/lib/scenario-share-token.ts:10-12]. The generation counter makes ours a *stateful* MAC — the plan must state this so a reviewer does not read the founder decision as contradicting the documented one. (FEATURES.md's Critical Finding makes the same distinction.)

### Module contract

```ts
// src/lib/strategy-share-token.ts — NEW module. Do not import scenario-share-token.ts.
import { createHmac, timingSafeEqual } from "crypto";

const SECRET_ENV = "SHARE_TOKEN_SECRET";
const MIN_SECRET_LENGTH = 32; // 256-bit HMAC key floor; demo-pdf's 16 is the weaker precedent

// ⛔ MODULE-LOAD validation (founder decision: "validated at module load / boot,
// not at first share"). A missing/short secret throws HERE, at import time, with
// a named remedy — so every share surface 500s loudly and identically, instead
// of Copy Link failing for the first founder who clicks it in production.
function readSecretOrThrow(): string {
  const s = process.env[SECRET_ENV];
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${SECRET_ENV} must be set to a string >= ${MIN_SECRET_LENGTH} chars. ` +
      `Remedy: add it in Vercel -> Settings -> Environment Variables (all envs) and redeploy; ` +
      `set it in .env.local for dev. Rotating it revokes EVERY outstanding share link.`,
    );
  }
  return s;
}
const SECRET = readSecretOrThrow(); // module scope — the load-time assert

/** token = HMAC-SHA256(secret, `${strategyId}.${generation}`), base64url (43 chars). */
export function deriveShareToken(strategyId: string, generation: number): string {
  return createHmac("sha256", SECRET)
    .update(`${strategyId}.${generation}`)
    .digest("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32-byte base64url, no padding

/** Constant-time verify of a presented token against ONE candidate row. */
export function verifyShareToken(
  presented: string,
  strategyId: string,
  generation: number,
): boolean {
  if (!TOKEN_RE.test(presented)) return false;
  const expected = deriveShareToken(strategyId, generation);
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected)); // equal length by regex
}
```

Design notes the planner must carry:
- **Serialization:** the founder formula is `strategy_id || generation`; the `.` separator is a concrete serialization choice (UUIDs are fixed-width so ambiguity is impossible, but an explicit separator is cheap discipline). Pin it with a known-vector test under a fixed test secret, mirroring the scenario pin's shape — and add a **cross-namespace assertion** that the new module's output for any input differs from `hashShareToken` of the same input (the anti-replay pin A.5-5 asks for).
- **Encoding:** base64url digest, 43 chars, format-guarded before compare — mirrors `mintShareToken`'s 43-char base64url raw-token shape [VERIFIED: scenario-share-token.ts:14,34] and demo-pdf's validate-before-Buffer discipline [VERIFIED: demo-pdf-token.ts:62,95-97].
- **Constant time:** `timingSafeEqual` after the length-fixing regex — demo-pdf precedent [VERIFIED: demo-pdf-token.ts:107-111].
- **Boot-time visibility, in addition to module-load:** `src/instrumentation.ts` `register()` runs at server start. `SOFT_SKIP_PROD_KEYS` (`:8-13`) is the **wrong** home — it is explicitly "Warn-only: never crash a deploy over a soft-skip key" [VERIFIED: src/instrumentation.ts:5-13], and the founder decision demands LOUD. Add a distinct check in `register()` that `console.error`s (and Sentry-captures) a missing `SHARE_TOKEN_SECRET` in production with the named remedy. The module-load throw remains the hard stop on the share surfaces themselves; the boot check makes it visible in the deploy log before anyone clicks.
- **Blast-radius note (be honest in the plan):** a module-scope throw fails every module that imports it — which is exactly the two share routes + the token page + the owner-lane share-state read. It does NOT take down unrelated routes. Tests must set a fixture secret in setup (vitest env) or the import throws.
- **Rotation semantics:** rotating `SHARE_TOKEN_SECRET` instantly invalidates every outstanding link (every derived MAC changes). Document as the global kill-switch, not a bug.

### The verification-lookup problem (a real design point the decision leaves open)

A pure MAC token contains no lookup key, and the decision forbids storing anything token-derived ("NEVER a token, raw or hashed"). So the recipient route cannot do an indexed equality lookup. Two compliant options:

| Option | Mechanics | Cost | Verdict |
|---|---|---|---|
| **(i) Bounded scan (RECOMMENDED)** | `admin.from("strategy_shares").select("strategy_id, generation").is("revoked_at", null)` → derive each candidate's token → `timingSafeEqual` against the presented one | O(active shares) HMACs per anonymous request. Bounded structurally: one row per strategy (UNIQUE below). Scale today: shares start at 0; ARCHITECTURE measured 13 unpublished strategies total (2026-08-20). Rate-limited 10/60s/IP BEFORE any DB/crypto work (the scenario-share ordering) | Literal compliance with the founder formula; trivially fast at any plausible scale; revisit only if active shares reach thousands |
| (ii) Self-locating token `<share_row_id>.<mac>` | O(1) lookup by the row's own UUID (non-secret, NOT the strategy id); MAC still per the founder formula | Extends the token format beyond the decision's literal text | ⛔ Do not adopt silently — it is a founder-formula extension. Log as a future optimization needing sign-off |

Option (i) also keeps the miss path timing-uniform: derive-and-compare against every active row regardless of early match (or accept the early-exit — the comparison is against *different* candidates, not a byte-prefix oracle on one secret; note this in the module comment).

---

## Q4 — DDL shape: `strategy_shares`, RLS, RPCs

### Table (one row per strategy — the counter IS the row)

```sql
CREATE TABLE strategy_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  generation  INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
ALTER TABLE strategy_shares ENABLE ROW LEVEL SECURITY;
```

Column/shape rationale, and one **deliberate deviation from the scenario precedent**:
- The scenario table is N-rows + partial unique (`UNIQUE (scenario_id) WHERE revoked_at IS NULL` [VERIFIED: 20260622120000:…"CREATE UNIQUE INDEX scenario_shares_one_active_idx ON scenario_shares (scenario_id) WHERE revoked_at IS NULL"]) because each mint is a new hashed-token row. Under the generation model there is nothing per-mint to store — the row IS the counter — so a **full** `UNIQUE (strategy_id)` with reactivate-on-reshare is the correct shape. State machine: no row → never shared; `revoked_at IS NULL` → live link (`has_active_share`); `revoked_at NOT NULL` → revoked, generation already incremented. Re-share = `UPDATE … SET revoked_at = NULL` (token re-derives from the already-incremented generation → new link; old links stay dead). Revoke = `UPDATE … SET revoked_at = now(), generation = generation + 1 WHERE strategy_id = $1 AND revoked_at IS NULL` — one atomic statement; 0 rows on double-revoke → 404-as-convergence (the `SavedScenariosList.tsx:333-341` client contract carries over verbatim).
- Mint audit history thins to one row + counter; per-event history rides `logAuditEvent` (the `scenario.share.revoke` precedent [VERIFIED: revoke route :130-138]).
- FK targets mirror `scenario_shares` exactly: `scenario_id … REFERENCES scenarios ON DELETE CASCADE, created_by UUID NOT NULL REFERENCES profiles ON DELETE CASCADE` [VERIFIED: 20260622120000 STEP 1, "CREATE TABLE scenario_shares (… scenario_id UUID NOT NULL REFERENCES scenarios ON DELETE CASCADE, created_by UUID NOT NULL REFERENCES profiles ON DELETE CASCADE …)"] — user deletion cascades, so `sanitize_user` needs no new arm.

### RLS + grants (transpose `scenario_shares_owner` with CR-01 owner-coherence)

```sql
CREATE POLICY strategy_shares_owner ON strategy_shares
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.strategies s
                WHERE s.id = strategy_shares.strategy_id AND s.user_id = auth.uid())
  );
REVOKE ALL ON strategy_shares FROM anon;
```

The scenario precedent's own words for why the EXISTS clause is load-bearing: "`created_by = auth.uid()` alone is NOT enough — it lets an authenticated allocator mint a share for ANY scenario_id (incl. another tenant's), because the FK only checks the scenario EXISTS" [VERIFIED: 20260622120000, CR-01 comment block preceding `CREATE POLICY scenario_shares_owner`]. Same three layers here: route ownership probe → RLS WITH CHECK → (read-side) the bounded scan only ever authorizes the strategy_id stored in the matched row.

### RPCs — and the anon-EXECUTE question, stated precisely

**The HMAC model removes the need for a `get_shared_factsheet(p_token_hash)` SECDEF reader entirely.** The scenario RPC exists to match `token_hash` in SQL; there is no token_hash here, and SQL cannot compute HMAC (no pgcrypto). Token→strategy resolution happens in Node on the admin transport; the factsheet row fetch is a service-role table read in the token route. Consequences:

- **anon EXECUTE:** the repo rule "a SECDEF function used in a `{public}` RLS policy needs anon EXECUTE (else anon gets 42501 → SSR renders `[]` with a clean console)" applies to functions *referenced inside RLS policies evaluated as anon* (the `get_published_trust_signals` class). It does **not** apply to this design: the recipient lane's reads ride `createAdminClient()` (service_role), exactly like `/scenario-share`, whose reader RPC is explicitly `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO service_role` with an `_assert_no_public_execute` self-verify [VERIFIED: 20260622120000 STEP 3: "REVOKE ALL ON FUNCTION public.get_shared_scenario(TEXT) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.get_shared_scenario(TEXT) TO service_role;" + the DO block calling `public._assert_no_public_execute(...)`]. If the planner nonetheless adds any SECDEF function here, it takes the same REVOKE/GRANT/self-verify treatment — anon gets EXECUTE on nothing.
- **Mint:** either (a) direct RLS-scoped upsert in the route (`INSERT … ON CONFLICT (strategy_id) DO UPDATE SET revoked_at = NULL RETURNING generation` — atomic reactivate-or-insert on the user client, RLS WITH CHECK enforcing ownership), or (b) a `create_strategy_share(p_strategy_id UUID)` SECURITY **INVOKER** RPC wrapping the same statement (the `create_scenario_share` shape: INVOKER, `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated` [VERIFIED: 20260622120000: "REVOKE ALL ON FUNCTION public.create_scenario_share(UUID, TEXT) FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;"]). Discretion per CONTEXT; (a) is smaller, (b) centralizes the state machine. Either way the mutation falls under the audit law:
  - Direct table mutation in a route → `src/__tests__/audit-coverage.test.ts` class (a) detects `.from(...).insert/update/upsert` automatically and requires `logAuditEvent` in the same function body.
  - An RPC → its name MUST be added to `MUTATING_RPC_NAMES` (`audit-coverage.test.ts:203-233`) or the gate never sees the call — the SEC-03 lesson recorded in the list itself: "with the name unlisted, DELETING the pragma left this suite green … with the name listed the same deletion turns it red" [VERIFIED: audit-coverage.test.ts:203-233].
- **Revoke:** direct owner-scoped UPDATE, mirroring `revoke/route.ts:104-128` (0 rows → 404 not 403; never DELETE) [VERIFIED: scenario revoke route :100-128].
- **If any SQL function is created:** `CREATE OR REPLACE`, never DROP+CREATE (pg_default_acl re-grants EXECUTE to anon/authenticated on re-create — "it bit `20260812083206` for `anon`" [VERIFIED: supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql §(v)]); `SET search_path`; and regenerate the function snapshot (`npm run schema:functions`; CI runs `--check` — [VERIFIED: scripts/dump-sql-functions.ts header; package.json:24-25]).

### SKIP-01 discipline for this phase's SQL gates

`supabase/tests/test_strategy_shares_rls.sql` (content-by-field: anon blocked at grant+RLS; cross-tenant WITH CHECK rejection; revoke immediacy — 0 authorizable rows on the request after `revoked_at = now()`; generation monotonicity). ⛔ **No pre-apply tolerance arm**: nothing applies migrations to TEST automatically and `sql-tests` has no apply step, so a "table absent → pass" arm is PERMANENTLY silent. The test must be RED until the migration is **hand-applied to TEST at ship time** (the flow the scenario migration header documents: "The migration applies at /ship-time to the TEST project (the sql-tests CI prerequisite) and to PROD at /land via the Supabase Migrate workflow on push-to-main" [VERIFIED: 20260622120000:52-56]; the 163-06 plan used the same "expected RED until TEST hand-apply" + blocking checkpoint shape). Plan a blocking checkpoint: three reviewers → hand-apply to TEST → sql-tests green → merge (PROD auto-apply).

---

## The 410 mechanics (App Router cannot emit 410 from a page)

**Negative claim, verified against the bundled docs for this exact Next version:** the App Router function reference contains `not-found.md` (404), `forbidden.md` (403), `unauthorized.md` (401) — and no gone/410 API; a repo-wide docs grep for a 410 mechanism returned nothing relevant [VERIFIED: listing of node_modules/next/dist/docs/01-app/03-api-reference/04-functions/ — `forbidden.md`, `not-found.md`, `unauthorized.md`, `use-link-status.md`]. A Server Component page has no general status-code setter.

**Recommended shape:** on token miss, the page calls `redirect("/factsheet-share/gone")`; `src/app/factsheet-share/gone/route.ts` is a route handler returning the content-free HTML with `status: 410` and `Cache-Control: no-store`:

```ts
// src/app/factsheet-share/gone/route.ts
export const dynamic = "force-dynamic";
export function GET(): Response {
  return new Response(GONE_HTML, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
```

- Copy (from CONTEXT, verbatim substance): "This link is no longer active. The person who shared it turned it off. Ask them for a new link." NO strategy name, NO metrics, NO id, NO owner identity.
- Every miss class (malformed, unknown, revoked, DB error on the share read) takes the SAME redirect — uniform, no oracle *within* the token lane. The 410-vs-404 asymmetry is between lanes (410 on tokens, uniform 404 on bare ids), which is safe: "telling a token holder their token *was* valid leaks nothing; telling an id holder the id exists is an existence oracle" (CONTEXT).
- The e2e assertion must follow the redirect and pin the FINAL status 410 + `no-store` + content-free body. If the redirect hop is judged unacceptable, the only alternative is emitting the miss page from the page with status 200 — a deviation from success criterion 4 that would need founder sign-off. Recommend the redirect.
- The bare-id lane is untouched: `notFound()` at `v2/page.tsx:489,534` stays the uniform 404 (T-148-04: "A non-owner authed viewer, an anonymous viewer and a genuinely missing id are indistinguishable from the outside" [VERIFIED: :521-535]).

---

## Q5 — Metadata surface (current fallback behaviour CONFIRMED, not assumed)

The id-route `generateMetadata` (`v2/page.tsx:364-411`) probes through `withPublishedOnly` on the request-scoped client (`:370-377`). For an unpublished strategy the probe misses (`data` null) and the fallback is exactly:

```ts
// v2/page.tsx:383-389 [VERIFIED]
const name = data?.name ?? data?.codename ?? (data ? displayStrategyName({...}) : "Strategy");
const description = (data?.description ?? "Institutional strategy factsheet on Quantalyze.").slice(0, 200);
```

→ title degrades to `"Strategy — Quantalyze Factsheet"`, generic description, `robots: "noindex"` (`:397`) — **but the OG image URL is emitted unconditionally** (`const ogImage = \`/api/og/factsheet/${id}\`;` `:393`), pointing at the published-only, CDN-cached OG route (`Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` [VERIFIED: og route :188-189]).

**The token route must NOT copy either precedent:**
- Not the id-route shape (it would need the id to build the OG URL — SL-1d forbids a token-aware OG route, and the id must not be derivable from the page anyway).
- Not the scenario-share shape (that page exports NO metadata at all → inherits `layout.tsx:33-36` `title: "Quantalyze"` with **no robots directive** — a precedent gap, not a pattern).

**Prescription:** a static `export const metadata: Metadata` on `factsheet-share/[token]/page.tsx` — constant, zero data fetch, zero params read:

```ts
export const metadata: Metadata = {
  title: "Factsheet — Quantalyze",          // no strategy name, no id
  description: "A privately shared factsheet on Quantalyze.",
  robots: "noindex",
  // NO openGraph, NO twitter, NO images — link unfurls stay deliberately dull.
};
```

Link-unfurl dullness is accepted explicitly per the ROADMAP research note ("a private link SHOULD be dull in a chat preview"). Pin with a test that the token page module contains no `generateMetadata`, no `openGraph`, and no reference to `/api/og/`.

---

## Q6 — Sentry: path-based token scrubbing (server-only SDK here)

**What exists at HEAD (all verified):**
- Sentry initializes **server-side only**, in `src/instrumentation.ts` `register()`: `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: … })` — **no `beforeSend`, no `beforeSendTransaction`, no scrubbing of any kind** [VERIFIED: src/instrumentation.ts:26-36].
- `onRequestError` forwards the RAW request path into every captured render error: `extra: { path: request.path, method: request.method, digest: error.digest }` — for a token-page error, `request.path` IS `/factsheet-share/<raw-token>` [VERIFIED: :38-61, extra block :54-58]. `tags.routePath` is the parameterized route (safe).
- There is **no client-side Sentry**: no `instrumentation-client.ts`, no `sentry.client.config.ts` anywhere (verified by filesystem search) — so no browser breadcrumbs/replay channel exists today. Guard-comment this: adding client Sentry later re-opens the channel.
- `captureToSentry` (`src/lib/sentry-capture.ts`) routes all manual captures; its seam-redaction scrubs credential shapes, not URL paths — callers on the token lane must never pass the token in tags/extra.

**Prescription (path-based, because the token is a path segment):**
1. In `register()`'s `Sentry.init`, add `beforeSend` AND `beforeSendTransaction` applying one shared scrubber that rewrites `/factsheet-share/<anything-but-slash>` → `/factsheet-share/[token]` across: `event.request?.url`, `event.transaction`, every breadcrumb `message`/`data.url`, and span descriptions/attributes carrying `http.url`/`url.path`-shaped strings. Regex shape: `/\/factsheet-share\/[^/?#]+/g` → `"/factsheet-share/[token]"`. (Do not scope it to the 43-char token format — malformed-token requests error too and must scrub the same.)
2. In `onRequestError`, scrub `request.path` with the same helper before building `extra`.
3. Export the scrubber from a small pure module so a unit test can pin it (input/output vectors incl. query-suffixed and hash-suffixed forms), and so the future scenario-share cleanup can reuse it.
4. **Verification is against a REAL captured event, not the config file** (CONTEXT mandate): trigger a genuine error on a token URL in a deployed env and read the event's URL fields. A config-file grep proves nothing (`feedback_effect_does_not_identify_the_writer` class).

---

## Token-leak channels RE-DERIVED for a path segment (the A-D1 instruction)

The global policy is `Referrer-Policy: strict-origin-when-cross-origin` [VERIFIED: next.config.ts:79]. One precision correction to the framing in CONTEXT/PITFALLS, stated honestly: under this policy a **cross-origin** request sends the **origin only** — both the path and the query are stripped — while a **same-origin** request carries the full URL (path + query). [ASSUMED — spec semantics from training; could not fetch MDN this session. The mitigation below makes the question moot.] The channels that genuinely change under A-D1 are the ones that sanitize query strings but keep paths:

| # | Channel | Query token (`?s=`) | Path token (A-D1) | Disposition |
|---|---------|--------------------|-------------------|-------------|
| 1 | Referer, cross-origin | stripped (origin only) | stripped (origin only) [ASSUMED, see above] | Belt-and-braces anyway: per-route `Referrer-Policy: no-referrer` via `next.config.ts` `headers()` (`source: "/factsheet-share/:path*"`) — closes same-origin too and removes all dependence on the spec nuance |
| 2 | Referer, same-origin | full URL (to our own server) | full URL (to our own server) | closed by the same per-route header |
| 3 | **Plausible pageviews** — `layout.tsx:92-96` loads `https://plausible.io/js/script.tagged-events.js` with `data-domain` site-wide [VERIFIED: src/app/layout.tsx:49,92-96] | NOT sent (Plausible strips query strings by default) [ASSUMED] | **SENT — Plausible records the page PATH. This is the concrete "strictly more channels" instance: a raw token in a third party's pageview log.** | Mitigate: Plausible's exclusions script extension (`script.tagged-events.exclusions.js` + `data-exclude="/factsheet-share/*"`) [ASSUMED mechanics — MUST be verified against Plausible docs at plan/execute time; if unverifiable, evaluate not loading the script on this route] |
| 4 | **PostHog** — `trackFactsheetEvent` fires from `FactsheetView` handlers via `posthog.capture(event, {...})` [VERIFIED: src/app/factsheet/[id]/v2/factsheet-analytics.ts:71-88]; PostHog attaches `$current_url` by default [ASSUMED] | equivalent (query included) | equivalent | Two-part: (a) note CSP `connect-src` lists no PostHog host [VERIFIED: next.config.ts:95-97 — `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io`], so browser capture is likely blocked at HEAD — verify, but ⛔ do not rely on a CSP accident as the mitigation; (b) suppress `trackFactsheetEvent` in recipient mode (the token page passes a prop; the share_copy event has no recipient meaning anyway) |
| 5 | Server/CDN/platform request logs | logged | logged | Accept — operator-side; revocability is the designed mitigation |
| 6 | Browser history + history sync | carried | carried | Accept — revocability |
| 7 | Link unfurlers fetching server-side | carried | carried | Accept + generic metadata (Q5): the unfurl shows nothing worth having |
| 8 | Sentry server events (URL fields, `extra.path`) | carried | carried | Scrub per Q6, verified on a real event |
| 9 | In-page JS reading `location.href` generally | carried | carried | Channels 3/4 are the only live consumers at HEAD (no client Sentry); recipient-mode suppression + exclusions cover them |

---

## SHARE-04 — affordance sites at HEAD, including one analysis CONTEXT asks re-read

- **The A-D1 correction to the "token-stripping rebuild" claim:** CONTEXT (and FEATURES :126) describe `ShareLinkButton`'s rebuild as stripping the token. That was true for `?s=`. At HEAD the rebuild is `${window.location.origin}${window.location.pathname}?share=1` [VERIFIED: FactsheetView.tsx:1489] — and under A-D1 the token IS the pathname, so a recipient clicking Copy would now copy a **working** token URL (+`?share=1`). The defect changes shape rather than disappearing: the requirement stands as CONTEXT re-states it — **a recipient must not see a Copy-Link control at all** (it hands out re-shares of someone else's capability and duplicates the owner's control surface). Mechanism: the token page renders `FactsheetView` with an explicit recipient-mode prop (structural — NOT `useShareMode`'s query sniffing, which keys on `?share=1` [VERIFIED: :1470-1481]); that prop suppresses `ShareLinkButton` (`:1741`) and anything else owner/outbound (the `?share=1` suppression of Compare at `:1742` is the model).
- **The class fix (ONE predicate, three sites):** `FactsheetView.tsx:1741` (`!scenarioMode` only — the defect), `strategies/page.tsx:174-175` (`s.status === "published"` literal), discovery detail `:196` (inherits page gate). Converge on one shared helper/component so the three sites cannot drift (`feedback_close_whole_batch_complete_surface`). Direction per FEATURES (still governing): always-visible, always-enabled, mint-or-reuse — never hidden, never disabled.
- **`ShareableLink.tsx`** copies `/factsheet/${strategyId}` and models the honest copy-failure branch (execCommand fallback; failure surfaces `copyFailed`, never a false "Link copied!") [VERIFIED: src/components/strategy/ShareableLink.tsx:17,39-49] — reuse the failure discipline in the new mint-then-copy flow, and note the async wrinkle: mint happens over the network BEFORE the clipboard write; a mint failure must surface an error state, never the success flash (SHARE-04's core sentence).
- **`OwnerUnpublishedNotice`** (`:693-709`): the sentence "Anyone else who opens this link sees a 404 until Quantalyze review publishes it." [VERIFIED: :704-706] becomes false the moment tokens ship. Single-sourced component rendered at `:301` (full render) and `v2/page.tsx:605` (pending fallback) — one edit fixes both. Owner variant needs share-state-aware copy; recipient variant (new) needs "shared privately by its owner; not published or reviewed" framing per FEATURES.
- **Owner share-state:** the owner lane (`v2/page.tsx:546-555`) can read `strategy_shares` on the request-scoped client (owner RLS permits) and thread `hasActiveShare` + the current share URL (re-derived server-side from `(strategy_id, generation)` — this is the reuse payoff: the URL is always re-computable, unlike the scenario lane's session-only cache [VERIFIED: SavedScenariosList.tsx:191-197 documents that limitation]). State machine per precedent: none → `Share`; active → `Copy link` + `Revoke` (`:44-52`, `:199-205`); revoke inline-confirm copy shape at `:599-619`; 404-as-convergence client handling at `:333-341`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-time compare | manual `===` or loop | `crypto.timingSafeEqual` after format guard | demo-pdf precedent; `==` on secrets is a listed warning sign |
| Rate limiting | custom counters | `publicIpLimiter`/`userActionLimiter` + `checkLimit` + `isRateLimitMisconfigured` | misconfig → 503 not misleading 429 (T-25-10) |
| Client IP | header parsing | `getClientIp` (`ratelimit.ts:652`) | Vercel-aware, spoof-resistant rightmost-XFF |
| No-store headers | ad-hoc strings | `NO_STORE_HEADERS` from `@/lib/api/headers` | every scenario-share response uses it |
| Audit trail | custom log table | `logAuditEvent` | audit-coverage gate expects it in-scope |
| Owner auth in routes | new wrapper | `createClient` + `getUser` + `.eq("user_id", user.id)` | the `strategies/[id]/name/route.ts` shape [VERIFIED: name/route.ts:127-201] |
| URL origin | hardcoded host | `process.env.NEXT_PUBLIC_APP_URL` per request | scenario mint `resolveAppUrl()` :61-68 |
| Payload assembly | a token-lane copy of the build logic | the extracted `buildFactsheetPayloadFromRow` | a per-surface copy is exactly the drift `readSingleKeyBasisOpts` was created to end (WR-01) |

## Common Pitfalls

### Pitfall 1: Token in `cacheKey`/`keyParts` — the silent no-op that publishes private strategies
The suffix after `::` is DISCARDED (`:317`); a token-keyed `keyParts` "works" but creates unbounded secret-bearing entries. **Avoid:** the token lane lives in a module with no `unstable_cache` import; the phase-148 gate (extended) is the detector; the ordered adversarial test (token render FIRST, then anon `/factsheet/<id>` still 404s) is the behavioural pin, demonstrated RED with the bypass neutered. **Warning sign:** any diff touching `buildFactsheetPayloadCached`'s signature or its literal predicate.

### Pitfall 2: The two CI gates (§landmines) redden mid-execution
Frozen-spine `/scenario|share/i` on the migration filename; OWN-02 literal-token walk on the extraction. Both amendments are pre-plannable reviewed acts; both must have their tokens counted PRE-EDIT and be neutering-verified.

### Pitfall 3: A pre-apply tolerance arm in the SQL gate (SKIP-01)
"Table absent → pass" is permanently silent in CI because nothing applies migrations to TEST. Write the gate RED-until-hand-apply and plan the hand-apply checkpoint.

### Pitfall 4: The 410 written as `notFound()` or as a 200
`notFound()` is 404 (wrong lane semantics); a 200 miss page breaks success criterion 4. Use the redirect→route-handler shape and pin the FINAL status.

### Pitfall 5: Secret validated lazily (the demo-pdf shape)
`demo-pdf-token.ts` validates in `getSecret()` at call time and `verifyDemoPdfToken` silently returns false on a missing secret (`:84-88`) — for shares that would be a silent "every link 404s in prod". The founder decision demands module-load throw + boot-time visibility. Do not add it to warn-only `SOFT_SKIP_PROD_KEYS`.

### Pitfall 6: Trusting a CSP accident as the PostHog mitigation
`connect-src` omits PostHog today, but the CSP can gain the host for unrelated reasons any week. Suppress recipient-mode analytics explicitly.

### Pitfall 7: The valid-token-but-null-payload case routed to 410
A still-computing strategy behind a valid token is honest absence, not a dead link. Render the pending placeholder (owner-chrome-free); 410 only for token misses.

### Pitfall 8: `notFound()`-style uniform-miss discipline dropped on the mint route
Mint 404s (not 403s) when the caller doesn't own the strategy — no existence oracle (scenario CR-01 layer 1 [VERIFIED: mint route :136-150]).

## Code Examples

### Mint-or-reuse core (route excerpt, B15 ordering)
```ts
// POST /api/strategies/[id]/share — after auth + zod-validate + checkLimit(userActionLimiter)
const { data: own } = await supabase.from("strategies")
  .select("id").eq("id", strategyId).eq("user_id", user.id).maybeSingle();
if (!own) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE_HEADERS });

// Atomic reactivate-or-insert on the RLS client (WITH CHECK enforces owner-coherence).
const { data: row, error } = await supabase.from("strategy_shares")
  .upsert({ strategy_id: strategyId, created_by: user.id, revoked_at: null },
          { onConflict: "strategy_id" })
  .select("generation").single();
if (error || !row) { /* redacted envelope + captureToSentry */ }

const token = deriveShareToken(strategyId, row.generation);
logAuditEvent(supabase, { action: "strategy.share.mint", entity_type: "strategy",
  entity_id: strategyId, metadata: { generation: row.generation } }); // NEVER the token
return NextResponse.json({ url: `${resolveAppUrl()}/factsheet-share/${token}` },
  { status: 200, headers: NO_STORE_HEADERS });
```
(⚠️ Verify the upsert does not clobber `created_by`/`created_at` on reactivation — an explicit `ON CONFLICT … DO UPDATE SET revoked_at = NULL` via RPC is the tighter form; planner's call per CONTEXT discretion.)

### Recipient resolution (token route excerpt)
```ts
// src/app/factsheet-share/[token]/page.tsx — force-dynamic, runtime nodejs.
// ⛔ ZERO unstable_cache imports in this module. SL-1 is structural here.
const rl = await checkLimit(publicIpLimiter, `factsheet-share:${getClientIp(await headers())}`);
if (!rl.success) return <NeutralTryAgain />;            // not 404/410 — no token-existence leak

const { token } = await params;
const admin = createAdminClient();
const { data: candidates } = await admin.from("strategy_shares")
  .select("strategy_id, generation").is("revoked_at", null);
const match = (candidates ?? []).find(c => verifyShareToken(token, c.strategy_id, c.generation));
if (!match) redirect("/factsheet-share/gone");          // → route handler emits 410 + no-store

const { data: strategy } = await admin.from("strategies")
  .select(FACTSHEET_ROW_COLUMNS)                        // shared const — cannot drift from the id lane
  .eq("id", match.strategy_id).maybeSingle();           // NO status predicate: the token IS the authz
if (!strategy) redirect("/factsheet-share/gone");
const payload = await buildFactsheetPayloadFromRow(admin, strategy);
if (!payload) return <PendingPlaceholder />;            // valid link, still computing — NOT 410
return <FactsheetView payload={{ ...payload, trustTier: null }} recipientShare />;
```

## Environment Availability

| Dependency | Required By | Available | Notes | Fallback |
|------------|------------|-----------|-------|----------|
| Node crypto (HMAC/timingSafeEqual) | token module | ✓ | builtin | — |
| `SHARE_TOKEN_SECRET` (Vercel, all envs) | mint + recipient lanes | ✗ (new) | RESEND_API_KEY-class prod-only failure; must be set + redeployed BEFORE the feature is reachable; also needed in `.env.local` + vitest env fixture | none — this is why fail-loud is mandated |
| Supabase TEST hand-apply access | sql-tests green | operator step | SKIP-01: no automation applies migrations to TEST | none |
| Network for external-doc verification | Plausible/PostHog claims | ✗ this session | WebFetch/WebSearch unavailable (DNS failure) | verify at plan/execute time; claims tagged [ASSUMED] |

## Validation Architecture

(workflow.nyquist_validation = true in `.planning/config.json` [VERIFIED].)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo-pinned; `vitest.config.ts` thresholds are a blocking gate) + Playwright e2e + `supabase/tests/*.sql` (sql-tests CI lane) |
| Quick run | `npx vitest run <file>` (⚠️ file-scoped runs cannot clear the `src/__tests__/contracts/` global-scan tests — full suite is the arbiter) |
| Full suite | `npm run test`; `npm run lint` (includes route-contract + planning hygiene); `npm run typecheck` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated check | Exists? |
|-----|----------|-----------|-----------------|---------|
| SHARE-01 | same URL across two mints in two sessions (reuse); mint 404 for non-owner | unit + route test | new `strategy-share-token.test.ts` (vectors, namespace pin, determinism) + share route test | ❌ Wave 0 |
| SHARE-02 | ordered adversarial isolation: token render FIRST, anon `/factsheet/<id>` still 404s; RED with bypass neutered | static rows + runtime | extend `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (token-lane rows) + e2e ordered spec | ❌ Wave 0 (extend, don't fork) |
| SHARE-03 | revoke → next load FINAL-status 410 no-store content-free; double-revoke 404 converges; generation increments | route + SQL + e2e | revoke route test; `test_strategy_shares_rls.sql` (RED until TEST hand-apply); e2e follow-redirect | ❌ Wave 0 |
| SHARE-04 | one predicate across three sites; recipient sees no Copy-Link; OwnerUnpublishedNotice corrected | component + e2e | FactsheetView recipient-mode tests; copy-string assertion on the notice | ❌ Wave 0 |

### Sampling Rate
- Per task commit: file-scoped vitest on the touched test files.
- Per wave merge: full `npm run test` (⚠️ serialized — full vitest must not share the box with other suites per repo memory) + `npm run lint` + `npm run typecheck`.
- Phase gate: full suite + sql-tests green (post hand-apply) + the neutering demonstrations recorded.

### Wave 0 Gaps
- `src/lib/strategy-share-token.test.ts`; token-lane rows in the phase-148 file; share/revoke route tests; `supabase/tests/test_strategy_shares_rls.sql`; e2e recipient spec (valid → render; revoked → 410; ordered adversarial). Framework install: none.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (capability URL = bearer credential) | HMAC-SHA256 ≥32-char secret, constant-time verify, format guard |
| V3 Session Management | no (sessionless recipient lane) | — |
| V4 Access Control | yes | three-layer ownership (route probe → RLS WITH CHECK owner-coherence → row-scoped authorization); anon REVOKE on the table |
| V5 Input Validation | yes | zod + `isUuid` on route bodies; 43-char base64url regex on tokens |
| V6 Cryptography | yes | `node:crypto` only — never hand-rolled |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Cache poisoning (id-keyed entry) | Information Disclosure | SL-1 structural separation + extended phase-148 gate + ordered adversarial test |
| Token leak via analytics/observability | Information Disclosure | Sentry path scrub (verified on real event); Plausible exclusion; recipient-mode PostHog suppression; per-route no-referrer |
| Existence oracle (id lane) | Information Disclosure | uniform 404 on bare ids; 410 confined to the token lane; mint 404-not-403 |
| Token enumeration | Elevation of Privilege | 256-bit MAC space + `publicIpLimiter` 10/60s before any DB/crypto work; neutral limiter denial |
| Replay after revoke | Elevation of Privilege | generation increment invalidates all prior MACs; force-dynamic + no-store means nothing cached outlives the write |
| Cross-resource replay (scenario↔strategy) | Spoofing | separate module + separate namespace pin; different derivation (HMAC vs sha256-of-random) |
| Secret-at-rest disclosure | Information Disclosure | nothing token-derived stored (founder decision); DB leak yields only (id, int, timestamp) |
| Silent prod misconfig | — (availability/honesty) | module-load throw + boot log for `SHARE_TOKEN_SECRET`; never the warn-only soft-skip list |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `strict-origin-when-cross-origin` sends origin-only cross-origin (path stripped too) | leak table #1 | none if the per-route `no-referrer` ships — it supersedes the nuance |
| A2 | Plausible records paths and strips query strings by default; exclusions work via the `.exclusions.` script extension + `data-exclude` | leak table #3 | the NEW leak channel stays open — verify against Plausible docs before executing; if exclusions don't compose with `tagged-events`, evaluate conditional script omission |
| A3 | PostHog `capture()` attaches `$current_url` by default | leak table #4 | over/under-mitigation; recipient-mode suppression is correct either way |
| A4 | The `upsert(..., { onConflict: "strategy_id" })` form updates only the listed columns and respects RLS WITH CHECK on the update arm | code example | use the explicit-RPC variant instead; three-reviewer gate will inspect either way |

Everything else in this document is [VERIFIED] against files read at HEAD `2625a02d1` this session or [CITED] to the repo's own research/CONTEXT artifacts.

## Open Questions

1. **410 via redirect hop — acceptable to the founder?** The final status is 410 and the copy is exactly as specified, but the URL bar lands on `/factsheet-share/gone`. Recommendation: accept (content-free, stable, honest); flag in the plan's UAT notes rather than asking pre-emptively.
2. **Mint state-machine home: direct upsert vs INVOKER RPC.** Both compliant; CONTEXT leaves it to discretion behind the three-reviewer gate. RPC centralizes reactivate semantics + gets a body-shape pin; direct upsert is less DDL. Planner picks ONE and records why.
3. **Bounded-scan ceiling.** O(active shares) per anonymous request is fine at current scale; the plan should record the revisit threshold (e.g., >1k active shares) and the pre-approved-in-principle O(1) alternative (self-locating token) that would need founder sign-off.

## Sources

### Primary (HIGH — this repository, read at HEAD `2625a02d1` this session)
- `src/app/factsheet/[id]/v2/page.tsx` (:16-19, :34, :42-47, :83-312, :314-362, :364-411, :437-446, :448-573, :574-626) — SL-1, lanes, metadata, the seam
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` (:301, :693-709, :1470-1481, :1483-1515, :1741-1742) — affordances, notice, share mode
- `src/app/scenario-share/[token]/page.tsx` (full, 418 lines) — the recipient-route spine + its metadata gap
- `src/proxy.ts` (full, 176 lines); `src/lib/routing/route-contract-manifest.ts:376-381`; `scripts/check-route-contract.ts:6-22`
- `src/lib/scenario-share-token.ts` (full); `src/lib/scenario-share-token.test.ts:52-58`; `src/lib/demo-pdf-token.ts` (full)
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` (header, STEP 1 DDL+RLS, STEP 3 grants+self-verify, STEP 4 body-shape block)
- `src/app/api/allocator/scenario/share/route.ts` (:1-150) + `share/revoke/route.ts` (full)
- `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (:40-60, :190-210, :330-345, :595-619)
- `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (:140-300, :355-410); `src/__tests__/phase-29-frozen-spine-guards.test.ts` (:110-200); `src/__tests__/audit-coverage.test.ts` (:1-80, :203-241)
- `src/instrumentation.ts` (full); `src/lib/sentry-capture.ts` (:1-50); `src/app/layout.tsx` (:33-49, :92-96); `next.config.ts` (full)
- `src/lib/ratelimit.ts` (:97-217, :640-675); `src/components/strategy/ShareableLink.tsx` (:1-60); `src/components/strategy/StrategyActions.tsx` (:53-162)
- `src/app/(dashboard)/strategies/page.tsx:174-175`; `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` (:35-50, :175-200)
- `src/lib/factsheet/composite-read-path.ts` (exports :12-646, `.from()` sites :100,:151,:226); `build-payload.ts` (exports); `src/app/api/og/factsheet/[id]/route.tsx` (:35-45, :188-189)
- `src/app/factsheet/[id]/v2/factsheet-analytics.ts` (full); `supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql` (:35-75); `scripts/dump-sql-functions.ts` (:1-40); `package.json` (:11-25)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/` (directory listing — the 410 negative claim)

### Secondary (project artifacts — [CITED], their measurements dated 2026-08-20 at their HEAD `ca3f0c5c`)
- `.planning/phases/164-…/164-CONTEXT.md`; `.planning/ROADMAP.md` Phase 164; `.planning/REQUIREMENTS.md:27-30`
- `.planning/research/ARCHITECTURE.md` §A; `.planning/research/FEATURES.md` (minus the VOID items); `.planning/research/PITFALLS.md` §2-3

### Tertiary (LOW — training knowledge, network unavailable this session)
- Referrer-Policy cross-origin semantics; Plausible path-recording/exclusions; PostHog `$current_url` — all in the Assumptions Log with verification steps.

## Metadata

**Confidence breakdown:**
- Integration points (Q1), SL-1 + seam (Q2), DDL/RLS (Q4), metadata (Q5), Sentry surface (Q6): **HIGH** — every claim file:line-verified at HEAD this session.
- HMAC module shape (Q3): **HIGH** on repo precedent; the lookup-scan recommendation is reasoning, flagged as such.
- Token-leak channel table: **HIGH** for repo-side facts (what loads where), **LOW/[ASSUMED]** for the three third-party behaviours — each has a named verification step.
- Gate landmines: **HIGH** — both gate bodies read in full.

**Research date:** 2026-08-26 · **Valid until:** ~2026-09-25 for repo claims (re-verify line numbers if `v2/page.tsx` or the gates change); the [ASSUMED] items expire on first verification.
