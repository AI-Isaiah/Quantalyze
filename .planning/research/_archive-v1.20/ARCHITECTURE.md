# Architecture Research — v1.20 Backlog Burndown (TARGETED: the three risky items)

**Domain:** Integration design inside an existing Next.js 16 App Router / Supabase RLS / FastAPI-worker system
**Researched:** 2026-08-20
**Confidence:** HIGH — every claim below is read from live source at HEAD (`ca3f0c5c`) with file:line; nothing is inferred from training data. Two items carry an explicitly-named MEASUREMENT that is still owed (B-M1, C-M1) and one carries a founder DECISION that is still owed (A-D1).

> Scope note: this is **not** ecosystem research. No new technology is required for A, B or C — every gap closes with code already idiomatic here (`unstable_cache` + `revalidateTag`, hash-in-Node share tokens, SECURITY DEFINER RPCs, `createAdminClient()` writers, `withPublishedOnly`). The value of this document is *where the new code attaches* and *what breaks if it attaches in the obvious place*.

---

## The three items at a glance

| | A — SHARELINK-01 token lane | B — server-authoritative venue provenance | C — public-ranking integrity |
|---|---|---|---|
| **Layer** | read path + write path + DDL + cache | write path + DDL (maybe) + one money-math read | read path only |
| **New DDL** | YES — `strategy_shares` table + `get_shared_factsheet` SECDEF RPC + `create_strategy_share` INVOKER RPC | MAYBE — only if the non-wizard INSERT paths move server-side (`REVOKE INSERT ON api_keys FROM authenticated`) | NO |
| **New routes** | 3 (mint, revoke, public read surface) | 1 modified (`validate-and-encrypt` returns a row id) or 1 new | 0 |
| **Cache design** | LOAD-BEARING (this is the landmine) | none | none |
| **Blast radius** | 13 currently-unpublished rows become reachable-by-token; 0 published rows change | annualization clock (√365 vs √252) on API-keyed strategies | every percentile badge on `/browse/[slug]`, `/discovery/[slug]`, the tearsheet, and `/my-strategies` |
| **Depends on** | nothing in this milestone | Phase 156 (LANDED, PR #682) | nothing |
| **Recommended order** | 3rd | 2nd | 1st |

---

## A — SHARELINK-01: the revocable share-token lane

### A.0 The system as it exists today

```
                          GET /factsheet/<id>            GET /factsheet/<id>/v2
                                   │                              │
                                   └──────────┬───────────────────┘
                    src/app/factsheet/[id]/page.tsx:5 re-EXPORTS ./v2/page
                                              │
                            ┌─────────────────▼──────────────────┐
                            │  FactsheetV2Page  (force-dynamic)  │
                            │  v2/page.tsx:33, :378              │
                            └─────────────────┬──────────────────┘
                                              │
                     LANE A (published)  ─────┼─────  LANE B (owner)
                     v2/page.tsx:402-411      │       v2/page.tsx:438-521
                     request-scoped client    │       request-scoped client
                     withPublishedOnly        │       withPublishedOrOwner(q, user.id)
                              │               │                │
                              ▼               │                ▼
        buildFactsheetPayloadCached           │   fetchAndBuildPayload(id, ownerPredicate)
        v2/page.tsx:279-327                   │   v2/page.tsx:535-538
        unstable_cache(                       │   ⛔ DIRECT — no cache read, no cache write
          keyParts ["factsheet-v2-payload-v6", id]
          revalidate 3600
          tags ["factsheet-v2", `factsheet-v2:${id}`]
        )
                              │
                              ▼
        fetchAndBuildPayload(id, withPublishedOnly)   ← predicate is a LITERAL, v2/page.tsx:296
        runs on createAdminClient() (SERVICE ROLE)    ← v2/page.tsx:86
```

Four measured facts that constrain every design below:

1. **The effective cache key is id-ONLY.** `buildFactsheetPayloadCached` receives `` `${id}::${computedAt}` `` (v2/page.tsx:538) and *discards everything after the `::`* (`const [id] = cacheKey.split("::")`, v2/page.tsx:282). Next derives the key from callback source + `keyParts` + args; the suffix never reaches it. The file states this itself at :63-73.
2. **Therefore lane separation can never be expressed through the key string** (v2/page.tsx:75-80). The wrapper deliberately takes **no** visibility parameter so a viewer-dependent predicate is *unrepresentable*.
3. **The builder runs on the service-role client** (v2/page.tsx:86) — the injected predicate is the ONLY gate. There is no RLS backstop inside `fetchAndBuildPayload`.
4. **`/factsheet/[id]` and `/factsheet/[id]/v2` are the same module** (page.tsx:5 re-exports `default` and `generateMetadata`). They share ONE `unstable_cache` entry per id. Any token handling added to the v2 page is automatically live on the bare path too — which is a feature, not a hazard, provided the invariant in A.1 holds.

Related surfaces the current affordance touches:

| Site | Gate today | Verdict |
|---|---|---|
| `FactsheetView.tsx:1565` → `ShareLinkButton` (`:1307-1338`) | `!scenarioMode` only — **no publish check**; copies `${origin}${pathname}?share=1` and flashes "Link copied" | the defect |
| `(dashboard)/strategies/page.tsx:175` | `{s.status === "published" && <ShareableLink …/>}` | the correct rule, one screen over |
| `(dashboard)/discovery/[slug]/[strategyId]/page.tsx:187` | inherits the page's published gate | third site of the same class — **fix the CLASS, all three** |

### A.1 ⛔ The poison-proof invariant — stated precisely

> **INVARIANT SL-1 (cache):** For any strategy id `X`, the value stored in the `unstable_cache` entry whose `keyParts` are `["factsheet-v2-payload-vN", X]` MUST be *exactly* the value `fetchAndBuildPayload(X, withPublishedOnly)` returns — i.e. it must be a pure function of `(X, database state)` and independent of the request's viewer, session, cookies, query string, headers, and of **any** share token. Equivalently: **the token lane must produce zero cache WRITES and consume zero cache READS at that key.** A `null` return is a value like any other and is subject to the same rule (`unstable_cache` stores `null` unconditionally — v2/page.tsx:530-533).

Three corollaries, each of which has already bitten this file once and is written into it:

- **SL-1a — a key SUFFIX is not a key.** Appending `::token` yields the *same* entry (A.0 fact 1). Any design whose safety argument is "we vary the cacheKey string" is wrong by construction.
- **SL-1b — the wrapper must stay predicate-free.** The single structural defence is that `buildFactsheetPayloadCached` accepts no visibility argument (v2/page.tsx:287-294). Do not "generalise" it to take one. If a token lane needs a payload, it calls `fetchAndBuildPayload` **directly**, exactly as the owner lane does at v2/page.tsx:535-538.
- **SL-1c — the failure is silent and TTL-long.** A violation ships green: the poisoning request is the *owner's own*, so it renders correctly; the 3600s window in which every anonymous visitor to `/factsheet/<id>` receives a private strategy opens afterwards. There is no error, no log, no Sentry event. **The regression test must therefore be adversarial in the phase-148 shape**: owner-with-token request first, then an anonymous request for the same id must still `notFound()`. That test already exists in spirit for lane B (T-148-04) and is the template.

A fourth, easily-missed corollary specific to this milestone:

- **SL-1d — the CDN is a second cache.** `generateMetadata` (v2/page.tsx:329-376) points `openGraph.images` at `/api/og/factsheet/${id}`, and that route is **published-only** (`og/.../route.tsx:40` `withPublishedOnly`) and served `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` (`:154`). For an unpublished strategy it will not render a card. ⛔ **Do not "fix" that by making the OG route token-aware** — it would put a CDN-cached, URL-keyed, un-revocable public image of a private strategy behind a 7-day `stale-while-revalidate`. The correct answer is: the token lane ships **no** OG image, keeps `robots: "noindex"` (already set at v2/page.tsx:361), and its `generateMetadata` must not leak the strategy NAME either (today's fallback path resolves the name from a `withPublishedOnly` probe, so it already degrades to `"Strategy"` — verify, do not widen).

### A.2 Recommended shape: a **separate token route**, not a `?s=` param on the id route

The founder's stated shape is `?s=<token>` on the existing URL (TODOS.md:53). That is a UX statement about what the recipient sees; it is not a routing decision, and there are two defensible realisations. **This is decision A-D1 (see A.6) — but the architectural recommendation is the separate route**, for reasons that are measured, not stylistic:

| | Option 1 — `?s=` on `/factsheet/[id]` (in-place lane C) | Option 2 — `/factsheet-share/[token]` (RECOMMENDED) |
|---|---|---|
| SL-1 enforcement | **behavioural** — a third branch inside a 664-line page that already has two lanes and three "⛔ do not route this through the cache" comments; correctness depends on a future editor reading them | **structural** — a different module, a different `unstable_cache` callback (or none), literally cannot reach `["factsheet-v2-payload-v6", id]` |
| Shares the id-keyed entry? | yes, by construction (A.0 fact 4) — one mistake away from SL-1c | no |
| Proxy / public-route registration | none needed (`/factsheet` already in `PUBLIC_ROUTES`, `proxy.ts:17`) | +1 entry in `proxy.ts:17` and +1 prefix arm at `proxy.ts:117` — exactly what `/scenario-share` has |
| Precedent in-repo | none | **`/scenario-share/[token]` — the whole pattern already exists and is CI-pinned** |
| Recipient URL aesthetics | `/factsheet/<id>?s=<tok>` — id visible | `/factsheet-share/<tok>` — id NOT in the URL, which *strengthens* the founder's "the id must stay a non-secret" rationale (TODOS.md:48-51) |
| Owner "Copy Link" for a PUBLISHED strategy | unchanged, no token needed | unchanged, no token needed |

The `/scenario-share` precedent is the strongest argument, and it is complete:

- `src/app/scenario-share/[token]/page.tsx:56-61` — `export const dynamic = "force-dynamic"; export const runtime = "nodejs";` with a comment that states exactly why: *"Shared caches are keyed on the URL, not the token's revocation state. A cached response could be replayed after the token is revoked."*
- `src/lib/scenario-share-token.ts` — 256-bit `randomBytes(32).toString("base64url")`, sha256 hex hashed **in Node** (pgcrypto `digest` is enabled nowhere in this repo — see the migration header at `20260622120000:24-29`). Raw token lives ONLY in the URL; only the hash is at rest.
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` — `scenario_shares` table, owner RLS with an owner-coherence `EXISTS` clause (`:81-91`), `UNIQUE (scenario_id) WHERE revoked_at IS NULL` partial index (`:111-116`), a `get_shared_scenario(p_token_hash)` SECDEF reader `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO service_role` (`:296-297`), an `_assert_no_public_execute` self-verify (`:304`), and a **body-shape DO-block** that reads `pg_get_functiondef` and aborts the apply if the body lost `revoked_at IS NULL` or `status = 'published'` (`:315-342`).
- `POST /api/allocator/scenario/share` (mint) and `.../share/revoke` — three-layer ownership (route probe → RLS `WITH CHECK` → RPC predicate), atomic revoke-prior-then-insert via a SECURITY **INVOKER** RPC `create_scenario_share`, `NO_STORE_HEADERS` on every response, rate-limit *after* validation, redacted DB-error envelopes.

Reusing that spine means item A is **mostly a transposition**, not an invention — which is why it is a phase and not a patch, but also why it is lower-risk than its size suggests.

⚠️ **One thing the scenario precedent does NOT transfer:** `get_shared_scenario` hard-codes `status = 'published'` on the series it resolves. The factsheet share RPC's entire purpose is the opposite — resolving a row that is **not** published. So the pinned body-shape assertion must be re-authored, not copied: assert `revoked_at IS NULL`, assert the `token_hash` predicate, assert the ownership-coherence join to `strategies.user_id`, and assert the body does **not** reference `api_keys` / `portfolios` / `holdings`. Copying the `status='published'` assertion verbatim would abort the apply; deleting it without replacement would leave the reader unpinned.

### A.3 Components — new vs modified

**NEW**

| Component | Kind | Contract |
|---|---|---|
| `supabase/migrations/<ts>_strategy_shares_and_read_rpc.sql` | migration | `strategy_shares(id, strategy_id FK, created_by, token_hash, created_at, revoked_at)`; owner RLS mirroring `scenario_shares_owner` with the owner-coherence `EXISTS (SELECT 1 FROM strategies s WHERE s.id = strategy_id AND s.user_id = auth.uid())`; `UNIQUE (strategy_id) WHERE revoked_at IS NULL`; index on `token_hash`; `REVOKE ALL … FROM anon` |
| `get_shared_factsheet(p_token_hash TEXT)` | SECDEF RPC | resolves token → the SAME column list `fetchAndBuildPayload` selects (v2/page.tsx:90-95) + its `strategy_analytics` embed, gated on `revoked_at IS NULL`. `REVOKE … FROM PUBLIC, anon`; `GRANT EXECUTE … TO service_role`. Body-shape DO-block per A.2 ⚠️ |
| `create_strategy_share(p_strategy_id UUID, p_token_hash TEXT)` | SECURITY **INVOKER** RPC | atomic: revoke any active row + insert the new one in one transaction (mirrors `create_scenario_share`, `20260622120000:233,289`) |
| `src/lib/strategy-share-token.ts` | lib | ⚠️ **do not import `scenario-share-token.ts`** — see A.5 anti-pattern 5 |
| `POST /api/strategies/[id]/share` | route | mint-or-reuse; owner-scoped client; returns `{ url }` exactly once |
| `POST /api/strategies/[id]/share/revoke` | route | sets `revoked_at = now()`; never deletes |
| `src/app/factsheet-share/[token]/page.tsx` | RSC | `force-dynamic`, `runtime = "nodejs"`, `publicIpLimiter` (`ratelimit.ts:117`, 10/60s — the same limiter `/scenario-share` uses), **no `unstable_cache` anywhere in the module** |

**MODIFIED**

| Site | Change |
|---|---|
| `FactsheetView.tsx:1307-1338` (`ShareLinkButton`) | becomes state-aware: published → today's plain-URL copy; unpublished + owner → mint-or-reuse then copy the token URL; never flashes success for an action that cannot succeed |
| `FactsheetView.tsx:1565` | the `!scenarioMode`-only gate |
| `(dashboard)/strategies/page.tsx:175` and `(dashboard)/discovery/[slug]/[strategyId]/page.tsx:187` | ⛔ **class fix** — all three share affordances derive from ONE predicate/helper, not three literals. This is the `feedback_close_whole_batch_complete_surface` rule and the 153.6 lesson (a fix landing on one of two twins) |
| `src/proxy.ts:17` + `:117` | register `/factsheet-share` (Option 2 only) |
| `src/app/factsheet/[id]/v2/page.tsx` | **ideally zero diff under Option 2.** If it must change, the only acceptable diff is *strengthening* the SL-1 comments. Under Option 1 this file gains a third lane and becomes the phase's entire risk surface |

**Revoke UI** — a control has to live where the owner can find it. `StrategyActions` is the natural home and it has a known hole: it branches on `draft`/`pending_review`/`published`/`archived` then `return null`, so **`status='private'` renders zero actions** (TODOS.md:64-69). Contribution-flow strategies are minted `private` (`finalize-wizard/route.ts:1000`). So a revoke control placed in `StrategyActions` is **unreachable for exactly the rows most likely to be shared**. That is decision A-D2.

### A.4 Data flows

```
MINT                                          READ (recipient, anonymous)
────                                          ──────────────────────────
owner clicks Copy Link                        GET /factsheet-share/<raw>
  → POST /api/strategies/<id>/share             → publicIpLimiter (10/60s)
    → withAuth (session)                        → hashShareToken(raw)          [Node]
    → owner probe on RLS client → 404 if not    → createAdminClient()
    → mintShareToken() → {raw, hash}            → rpc get_shared_factsheet(hash)
    → create_strategy_share(id, hash)              ├ token miss → notFound()
    → 200 { url }   ← raw externalised ONCE        └ revoked   → notFound()
                                                → build payload from the RPC ROW
REVOKE                                          → render FactsheetView
──────                                          ⛔ zero unstable_cache calls in this module
owner clicks Revoke
  → POST .../share/revoke → revoked_at = now()
  → next recipient load 404s IMMEDIATELY
    (force-dynamic + no-store ⇒ no cache outlives the write)
```

⚠️ **The payload-builder seam is the one real integration question.** `fetchAndBuildPayload` (v2/page.tsx:82) is a *query + build* fused into one function, and it takes a visibility predicate rather than a row. The token lane has already done its gating in SQL, so it needs the *build* half without the *query* half. Two shapes:

- **(a) Extract the build half** into a shared function taking the fetched row — the "ONE path" discipline this file already applies for composites (`readCompositeFactsheet`, v2/page.tsx:153) and single-key basis opts (`readSingleKeyBasisOpts`, v2/page.tsx:196). Higher up-front cost, but it prevents the token surface and the id surface from drifting — which is the exact failure `readSingleKeyBasisOpts` was created to fix (WR-01, v2/page.tsx:182-186).
- **(b) Pass a token-derived predicate** into `fetchAndBuildPayload` — i.e. `(q) => q.eq("id", resolvedId)` after the RPC has authorised. Cheaper, but it re-queries on the admin client with a predicate that is *not* a visibility predicate, which is precisely the shape `StrategyVisibility` (v2/page.tsx:46) exists to prevent, and it re-opens SL-1b pressure.

**Recommend (a).** Note that (a) touches the composite arm and the single-key basis arm, so its diff is wider than it looks — budget for it in the phase, don't discover it.

### A.5 Anti-patterns (each one is a way this ships green and leaks)

1. **Varying the cacheKey string to separate lanes** — SL-1a. The suffix is discarded (v2/page.tsx:282).
2. **Adding a `visibility` parameter to `buildFactsheetPayloadCached`** — deletes the structural defence at v2/page.tsx:287-294.
3. **Letting the token lane store `null`** — a token pointing at a strategy whose payload fails to build must not reach the wrapper (v2/page.tsx:530-533).
4. **Making `/api/og/factsheet/[id]` token-aware** — SL-1d. A CDN-cached, un-revocable public image.
5. **Reusing `scenario-share-token.ts` for factsheets.** `scenario-share-token.test.ts:53-55` pins `hashShareToken("scenario-share")` to a literal digest; more importantly, one token namespace for two resources invites a cross-resource replay if either RPC ever loosens. Separate module, same algorithm, separate pin.
6. **Reaching for `use cache` / `cacheLife` / `cacheTag`.** `next.config.ts` does **not** enable `cacheComponents` (verified — no such key), and Next is 16.2.11. The existing `revalidateTag(tag, "max")` call at `admin/strategy-review/route.ts:501` is the Next-16 two-arg form and works today. Introducing Cache Components in this phase would be an unrelated, repo-wide behaviour change riding a security fix.
7. **Any `Cache-Control` other than no-store on the token surface** — `/scenario-share/[token]/page.tsx:56-61` records the replay-after-revoke reasoning verbatim.
8. **Fixing the Share button on one of the three sites.** See A.3 MODIFIED.

### A.6 Decisions owed (NOT research — a human/founder call)

- **A-D1 — route vs query param.** `/factsheet-share/[token]` (structural SL-1 enforcement, id not in the URL, +2 proxy lines) vs `?s=` on `/factsheet/[id]` (founder's literal words, zero proxy change, behavioural SL-1 enforcement). Architecture recommends the route.
- **A-D2 — `status='private'` has no actions at all.** Is a contribution record permanently private (leave `StrategyActions` alone, put revoke on the factsheet itself) or does `private` need a publish path (widen `StrategyActions`)? TODOS.md:64-69 names this an *open product question*. It is on A's critical path because the revoke control needs a home.
- **A-D3 — does the token lane extend to `/factsheet/[id]/tearsheet` and the PDF routes?** The tearsheet carries its own `force-dynamic` pin and disclosure-tier redaction; the PDF route is separate again. Scoping the token to the HTML factsheet only is defensible and smaller; deciding it *implicitly* is how a second unguarded surface appears.

---

## B — Server-authoritative venue provenance

### B.0 What Phase 156 actually closed, and what it left

Phase 156 landed both migrations (`20260813150106_wizard_rpcs_service_role_writer.sql` = Migration A, `20260814120000_wizard_rpcs_revoke_authenticated.sql` = Migration B, PR #682 @ `5d43df6b`). At HEAD the **wizard** connect path is server-authoritative:

- `create_wizard_strategy` / `add_wizard_composite_key` are SECURITY DEFINER, owned by `postgres`, with a role gate written on `auth.role()` (never `current_user` — the no-op bug named at `20260813150106:125-129`), and `authenticated` holds **no** EXECUTE (Migration B).
- Both write `exchange` **and** `attested_venue` from the SAME `p_exchange` parameter (`20260813150106:243-255`, `:383-395`), inseparable by CHECK `api_keys_attested_venue_matches_exchange` (post-verify (g), `:585-592`).
- `attested_venue` survives only because the DEFINER body runs as the OWNER — the `api_keys_scrub_attested_venue` trigger NULLs it for every non-privileged INSERT (`20260813150106:62-67`, `:205-207`).
- The honest ceiling is written into the code and must not be exceeded: *"the venue is the one this server observed a successful read-only authentication at… NEVER write 'the venue cannot be forged'"* (`finalize-wizard/route.ts:1228-1233`).

Two residuals remain, and **they are one item with two halves**:

**B-i — the non-wizard INSERT paths (TODOS.md:947-975).** Three client components still perform the `api_keys` INSERT themselves, on the user-scoped client, with a client-chosen `exchange` string:

| Site | Payload |
|---|---|
| `src/components/strategy/ApiKeyManager.tsx:254` | `{ user_id, exchange, label, ...dbFields }` then auto-links `strategies.api_key_id` (`:270-273`) |
| `src/components/strategy/StrategyForm.tsx:140` | `{ user_id, exchange: exchangeCanonical, label, ...dbFields }` |
| `src/components/exchanges/AllocatorExchangeManager.tsx:591` | `{ user_id, exchange, label, …, sync_status: "idle" }` |

All three POST `/api/keys/validate-and-encrypt` first — a route that **already knows the canonical venue it validated** (`validate-and-encrypt/route.ts:78` `exchangeNormalized`, `:185` passed into the legacy handler, `:309` `validateKey(exchange, …)`, `:325` `encryptKey(exchange, …)`). It returns ciphertext but **not** a row id, so the browser does the write. RLS `api_keys_owner` (`20260405061912_rls_policies.sql:22`) is `FOR ALL USING (user_id = auth.uid())` — it constrains *ownership*, not the venue label. Rows created this way carry `attested_venue = NULL` (scrubbed).

**B-ii — the annualization stamp (TODOS.md:2522-2533).** `finalize-wizard/route.ts` reads `exchange, attested_venue` in ONE query (`:1249-1256`), binds them to two deliberately-separate variables (`:1266`, `:1279`), routes the **security** gate through `attestedVenue` (`:1358` `runScopeBroadeningProbe(apiKeyId, attestedVenue)`), and routes the **money-math** stamp through the forgeable `apiKeyExchange` (`:1323` `isCryptoExchange(apiKeyExchange)`), with the reason written out at `:1299-1310`.

### B.1 ⛔ Why "a one-identifier change" is the wrong mental model

TODOS.md:2529 calls B-ii *"a one-identifier change with a two-outcome money-math blast radius"*, and the code comment at `:1303` says the same. **That framing is dangerously incomplete, and this is the single most important architectural finding in this document.**

`attested_venue` is `NULL` in two live populations:

- rows created **on or after 2026-08-11** through the three client-INSERT paths in B-i (trigger-scrubbed);
- any row the backfill did not reach — the one-time backfill in `20260811210000` is bounded by a DATED cutoff, `SET LOCAL quantalyze.attest_backfill_cutoff = '2026-08-11 00:00:00+00'` with `WHERE attested_venue IS NULL AND created_at < cutoff` (`:695-700`). It is explicitly **not** a "fill forever" rule (`:204-219`).

Now trace the naive swap. `isCryptoExchange` (`closed-sets.ts:569`) answers **false** for `null`. The stamp at `:1321-1329` is `apiKeyId ? (isCryptoExchange(V) ? "crypto" : "traditional") : …`. So `V = attestedVenue = null` ⟹ **`"traditional"` ⟹ √252 on a crypto strategy** — the exact mis-annualization the neighbouring RED-TEAM comment (`:1285-1291`) engineered `skipAssetClassWrite` to prevent, reintroduced through the front door. And it is *worse* than a skip, because `strategies.asset_class` is read **directly** by the worker as the annualization clock (`job_worker` `periods_per_year_for_asset_class(strategies.asset_class)`, per `:1206-1208`) — it does not re-derive from venue.

**Therefore the swap must move with its guard.** The correct shape is: extend the existing fail-toward-honesty rule — `skipAssetClassWrite = Boolean(apiKeyId) && <the venue this stamp reads> === null` — so a null **attestation** produces a SKIP (leave `create-with-key`'s venue-aware draft stamp intact, `create-with-key/route.ts:1089`), never a `'traditional'` default. That is a two-line change, not a one-identifier change, and it is the difference between a correct fix and a silent Sharpe inflation of ~1.20× on every affected crypto strategy.

**B-M1 — MEASUREMENT OWED (blocks B-ii, do not plan around it).** Count, on PROD:
1. `api_keys` rows with `attested_venue IS NULL AND created_at >= '2026-08-11'`, split by `exchange` and by whether any `strategies` row links them (`api_key_id`);
2. of those, how many belong to a strategy that has passed or will pass through `finalize-wizard` (i.e. carries `wizard_session_id`).
If (2) is zero the swap+skip is inert-but-correct; if non-zero, those strategies' `asset_class` changes and that is a re-annualization event needing the golden-parity treatment. This is exactly the pre-flight census pattern `20260811210000:567-676` already established — copy its discipline (a *count-pinned* census that ABORTs on drift), not just its intent.

### B.2 Recommended architecture — extend the Phase-156 writer pattern, don't invent a second one

The Phase-156 pattern generalises cleanly, and its two-migration split is the deployment lesson to reuse verbatim (`20260813150106:16-29`): **deploy-first, revoke-second, never migration-first** — because revoking a grant while the old deploy is still calling with the user-scoped client 42501s every connect for the width of the merge window, and *"the merge IS the apply"* with no ordering against the Vercel build.

```
TODAY (non-wizard)                        TARGET
──────────────────                        ──────
browser                                   browser
  → POST /api/keys/validate-and-encrypt     → POST /api/keys/validate-and-encrypt
      (server validates venue V)                (server validates venue V)
  ← ciphertext                                  → server WRITES the row with V
  → browser INSERTs api_keys                       via a SECDEF writer RPC
       with a CLIENT-chosen venue                  (stamps exchange = attested_venue = V)
                                            ← { api_key_id }
                                            then: REVOKE INSERT ON api_keys FROM authenticated
```

Sequenced as three landings, mirroring 156 exactly:

| PR | Content | Safe because |
|---|---|---|
| **B-1** | migration: `create_connected_key(p_user_id, p_exchange, …)` SECDEF writer + `GRANT EXECUTE TO service_role`. **No REVOKE.** Additive; the client INSERT path keeps working unchanged | `service_role` already holds EXECUTE by `pg_default_acl` (measured for the 156 twins at `20260813150106:417-425`) — verify, don't assume, for a NEW function |
| **B-2** | `validate-and-encrypt` (or a sibling route) writes the row via the admin client and returns `{ api_key_id }`; the three client components stop inserting and consume the id | deploy-first; both paths work simultaneously |
| **B-3** | migration: `REVOKE INSERT ON api_keys FROM authenticated` + post-verify. **After B-2 is live on PROD** | the browser no longer needs INSERT |
| **B-4** | `finalize-wizard/route.ts:1323` `apiKeyExchange` → `attestedVenue`, **with** the null-guard extension of `skipAssetClassWrite` (`:1292`) | after B-3 every new row is attested; B-M1 bounds the legacy tail |

⚠️ **B-3 has a wider surface than `exchange`.** DELETE is also a live client path (`ApiKeyManager.tsx:352`) and `20260810120000` deliberately left both INSERT and DELETE alone (TODOS.md:962-963). Revoking INSERT without checking every other client writer is how a connect flow dies at merge. Grep for every `.from("api_keys")` mutation before B-3 — at HEAD the write sites are `ApiKeyManager.tsx:254/:352`, `StrategyForm.tsx:140`, `AllocatorExchangeManager.tsx:591`, plus reads/updates at `SyncPreviewStep.tsx:1486`, `SyncProgress.tsx:170`, `keys/sync/route.ts:408`, `keys/[id]/permissions/route.ts:391`.

⚠️ **Migration hygiene that is non-negotiable here** (all sourced from `20260813150106`): `CREATE OR REPLACE`, never `DROP+CREATE` (a fresh function's default ACL grants EXECUTE to PUBLIC — a silent escalation introduced by the act of dropping, `:69-73`); `SET search_path`; `SET lock_timeout`; a role gate on `auth.role()` inside a fail-closed `BEGIN…EXCEPTION` wrapper (`:130-134`); **no `auth.uid()` check on the service_role arm** — it is a permanent silent no-op there (measured, `:139-142`); and a post-verify DO-block that asserts the *comparison*, not merely the *call* (`:540-562` — the "flat union" tell).

### B.3 Components — new vs modified

**NEW:** one migration for the SECDEF writer (B-1); one migration for the REVOKE + post-verify (B-3); `supabase/tests/test_*.sql` gates (RLS/SQL gates MUST live there to run in CI).
**MODIFIED:** `src/app/api/keys/validate-and-encrypt/route.ts` (returns a row id); `ApiKeyManager.tsx:254`, `StrategyForm.tsx:140`, `AllocatorExchangeManager.tsx:591` (stop inserting); `finalize-wizard/route.ts:1292` + `:1323` (guard + swap); `create-with-key/route.ts:1089` — **audit whether its stamp reads a server-validated venue too** (it reads the route-local `exchange`, which the same request validated, so it is already correct; confirm, and say so in the plan rather than leaving it ambiguous).

### B.4 Decisions owed

- **B-D1 — scope.** Does v1.20 take all of B-1..B-4, or only B-4 (the stamp) gated on B-M1? B-4 alone is small and closes the *money-math* residual; B-1..B-3 close the *provenance* residual and are a three-component connect-flow refactor that TODOS.md:972-975 has deferred twice. Splitting them is legitimate — but B-4-alone is only correct **with** the null-guard, and its value is bounded by how many un-attested rows exist (B-M1).
- **B-D2 — the oracle.** TODOS.md:2530 says the swap *"needs its own oracle over √365 vs √252"*. Per `feedback_economic_invariant_oracles_not_self_referential`, that oracle must pin the ECONOMICS (a crypto venue annualizes on the calendar clock; a null attestation annualizes on *nothing* — it skips), never re-derive the implementation's own expression. Who authors it, and against what fixture, is a plan-level call.

---

## C — Public-ranking integrity (`getPercentiles`)

### C.0 The system today

```
/browse/[slug]/page.tsx:39 ─┐
/discovery/[slug]/page.tsx:42 ─┼─→ getPercentiles(slug)  ──┐
/factsheet/[id]/tearsheet/page.tsx:147 ─┘                  │
                                                            ├─→ scoreAgainstPopulation(rows, rows)
/my-strategies/page.tsx ──→ getOwnRowPercentiles(ownRows) ─┘        src/lib/percentile-core.ts
                                                                     (the ONE core, founder ruling 2026-08-05)
```

Both callers project the SAME hoisted constant so they cannot drift:

```
src/lib/queries.ts:126-127
const PERCENTILE_ANALYTICS_COLUMNS =
  "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";
```

used at `:144`/`:150`/`:155` (`getPercentiles`) and `:625` (`getOwnRowPercentiles`). Neither selects `computation_status`, so a published strategy whose analytics row is `failed` contributes its stale KPIs to **every other strategy's denominator**. Measured on PROD 2026-08-19: 7 CSV strategies carry a non-null `sharpe` + `cagr` on a `failed` row (TODOS.md:828-829).

The gating is **per-surface, not systemic** — `queries.ts:1197` (`isComputedAnalytics(a?.computation_status)`), `:1951`, `:1959-1960` all gate; `PUBLIC_ANALYTICS_COLUMNS` (`:704`) already ships `computation_status` to anonymous readers. The percentile path is the outlier.

### C.1 Where the fix belongs: **query projection + filter, at the ONE core boundary**

Not a view, not a recompute:

- **A DB view is wrong here.** The population is already assembled in TS by two callers that must stay byte-identical to each other; a view would add a migration, a second definition of "published + complete", and a `.planning`-visible DDL surface, while the *actual* defect is a missing column in a string constant. The repo's own precedent for this shape is the hoisted constant at `:123-127` ("so the two projections cannot drift") — strengthen it, don't route around it.
- **A recompute is wrong here.** Nothing is mis-computed. The KPI values on a `failed` row are honest artefacts of an older successful run or a partial one; the defect is that they are **admitted to a population** they should not be in. Recomputing them would be fixing a different problem (and PROD's 7 rows are historical-class fossils — `csv-finalize/route.ts:1497-1506` documents exactly why they exist and that no current writer can create more).
- **Projection + filter is right,** and the filter must be applied **once**, on the population construction that both callers share — not twice, in two loops, which is how the two surfaces drift and the same strategy shows two ranks (`percentile-core.ts:10-13`).

### C.2 ⛔ Two landmines that a literal reading of the TODO walks straight into

**C-L1 — `!== "complete"` is the wrong predicate.** TODOS.md:831 says *"exclude non-`complete` rows"*. Taken literally, that also excludes `complete_with_warnings`, which is a **terminal SUCCESS** — a run whose factsheet is valid but had a DQ guard fire (`closed-sets.ts:696-719`). The closed set is `["pending","computing","complete","complete_with_warnings","failed"]` and the codebase-wide rule is written into that file: *"every read-gate MUST use this predicate instead of an exact-match on `'complete'`"* or *"a warned strategy dead-ends"*. **Use `isComputedAnalytics(status)`** (`closed-sets.ts:715`). Note `complete_with_warnings` is a live, populated state — the v1.8 uPnL DQ decision (`PROJECT.md`, `unrealized_pnl_in_anchor`) writes it deliberately. Excluding warned rows would silently shrink the public population and change every rank for a *correctness* reason that does not exist.

**C-L2 — the `< 5` cliff is a rank-disappearance event, not a rank-shift event.** Both functions return `null` below five population rows, in two places each (`:141`/`:171` in `getPercentiles`; `:634`/`:645` in `getOwnRowPercentiles`) and the thresholds are documented as *mirroring each other exactly, "so the page's Pnn presence and its 'ranked against N strategies' copy flip together"* (`:611-614`). Category-scoped calls (`/browse/[slug]`, `/discovery/[slug]`) run against a **much smaller** population than the un-scoped call. Filtering out failed rows in a thin category can push it under 5 ⟹ **every percentile badge in that category vanishes**, plus `/my-strategies` loses its comparison copy. That is a user-visible regression shipped as a correctness fix.

**C-M1 — MEASUREMENT OWED (cheap, blocks nothing but the copy decision).** Per `discovery_categories.slug` on PROD: count published strategies with an analytics row, and the same count after the `isComputedAnalytics` filter. Any slug crossing 5 → 4 is the decision surface for C-D1.

### C.3 The mirror the fix must not break

`src/app/api/strategies/csv-finalize/route.ts:1029-1048` defines `CLOCK_SAFETY_KPI_COLUMNS` and states it **mirrors `PERCENTILE_ANALYTICS_COLUMNS` member for member**, deliberately duplicated rather than imported (`queries.ts` is client-reachable and the constant is not exported), with the instruction *"If that set ever changes, this one must follow."* And at `:1509-1515` it records the 146.2-03/G1 ruling that `computation_status` **joins the projection but is NOT a member of the KPI set** — *"it is not a ranked KPI, it is the marker that says whether the KPI columns are final."*

**Therefore: do NOT append `computation_status` to `PERCENTILE_ANALYTICS_COLUMNS`.** That would make the csv-finalize mirror prose false at three sites (`:1031`, `:1489`, and the `:1509` ruling) and re-open exactly the KPI-set-vs-marker conflation 146.2-03 just resolved. The clean shape preserves both invariants literally:

```ts
// queries.ts — KPI set unchanged; the marker is appended at the projection site.
const PERCENTILE_ANALYTICS_COLUMNS =
  "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";
/** The gate marker. NOT a ranked KPI — see csv-finalize 146.2-03/G1. */
const PERCENTILE_GATE_COLUMN = "computation_status";
const PERCENTILE_PROJECTION = `${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN}`;
```

…and the filter applied where `extractAnalytics` already runs (`:169-174` and `:636-643`), through one shared helper so both loops cannot diverge.

⚠️ `extractAnalytics` (`utils.ts:171-176`) is a pure unwrap — array-or-object, no field filtering — so `computation_status` passes through untouched. And it changes **no disclosure boundary**: `PUBLIC_ANALYTICS_COLUMNS` (`queries.ts:704`) already ships the column to anon.

### C.4 Blast radius on published factsheets

| Surface | Effect |
|---|---|
| `/browse/[slug]`, `/discovery/[slug]` | every `Pnn` suffix in `StrategyTable` re-ranks (the suffix rides the active sort column, `StrategyTable.tsx:1078-1096`); the excluded rows lose their badges entirely |
| `/factsheet/[id]/tearsheet` (`:147`) | `PercentileRankBadge` values shift |
| `/my-strategies` | `publishedMap` **and** `populationSize` shift together (`:661-665`) — the "ranked against N strategies" copy is derived from the same map, so it stays coherent by construction. Verify it does |
| A **failed** published strategy's own factsheet | its percentile panel disappears. This is the honest outcome, but it is a visible change to a live page and belongs in the phase's UAT, not in a footnote |
| `/api/scenario/peer-rank` | **NOT affected** — it goes through `get_verified_cohort_rank` (migration `20260626120000`), a separate cohort path that only *cites* the getPercentiles convention (`peer-rank/route.ts:159`). ⚠️ Check whether that RPC has the same defect; if it does, it is a *sibling* item, not this one, and should be logged rather than absorbed |
| **Direction is not uniform.** Removing rows changes each surviving strategy's denominator *and* the count of values `<= v`. A strategy can move up or down. Any test asserting "ranks improve" is wrong | |

`StrategyTable.tsx:1091` rendering `formatNumber(s.analytics.sharpe)` ungated (only the status *chip* is gated) is a **separate, adjacent** question — TODOS.md:831-832 explicitly says "decide separately". Keep it separate; bundling it turns a read-path filter into a table-rendering redesign.

### C.5 The test must pin the economics, not the projection

TODOS.md:832 is explicit and matches `feedback_economic_invariant_oracles_not_self_referential`: **a failed row must not move another strategy's percentile rank.** The shape that can actually fail: construct a population, score it, then add a `failed` row carrying an extreme KPI, re-score, and assert every other strategy's rank is *identical*. A test that merely asserts the SQL projection string contains `computation_status` cannot fail when the filter is deleted, and is worse than no test (`feedback_every_test_must_be_able_to_fail`).

⚠️ `queries.percentiles.test.ts` is named at `percentile-core.ts:22` as *"the untouched behaviour oracle"* for the byte-identity of the pre-extraction map. Filtering the population **will** change its fixtures if any carry a non-complete status. Re-baselining it is a deliberate act to be recorded, not a green-making edit.

### C.6 Decisions owed

- **C-D1 — the `< 5` cliff.** If C-M1 shows a category crossing 5 → 4: accept the disappearance (honest, matches the existing convention), or lower the threshold for filtered populations (a second convention — argues against), or fall back to the un-scoped population (changes the meaning of the rank — argues strongly against). Recommend **accept**, and say so in the UAT.
- **C-D2 — `StrategyTable`'s ungated KPI cells.** Explicitly in-or-out for v1.20. Recommend **out**, logged.

---

## Build order for the milestone

```
   C  (read-path only, no DDL, no deploy ordering)
   │   └─ unblocks: nothing. Blocked by: nothing.  ← START HERE
   ▼
   B  (extends a LIVE migration pattern; multi-PR deploy ordering)
   │   B-M1 census ─→ B-4 (stamp + null-guard)          [small, high value]
   │   B-1 → B-2 → B-3 (writer → deploy → revoke)       [larger, deploy-ordered]
   ▼
   A  (own migration + own cache design + own public surface + 2 open decisions)
       blocked on A-D1 (route vs param) and A-D2 (private-status actions)
```

**Rationale.**

1. **C first.** Zero DDL, zero deploy ordering, one file plus tests, and it is the only one of the three that is purely a read path — so it can land, be observed on PROD, and be reverted trivially. It also front-loads the two measurements-and-decisions (C-M1, C-D1) that are cheapest to resolve.
2. **B second.** It *extends a pattern that is already applied to PROD* (`20260813150106` + `20260814120000`), so the risky design work is done and re-usable; what remains is sequencing discipline. It must not be last, because B-3's REVOKE needs a full deploy-then-migrate cycle with soak time. If the milestone runs short, **B-4 alone (stamp + null-guard, gated on B-M1) is the correct minimal cut** and closes the money-math half.
3. **A last.** It is the only item that introduces a NEW public, anonymous, un-authenticated surface; it needs its own migration, its own token module, its own cache invariant (SL-1) and an adversarial regression test, and it carries two unresolved product decisions. It also has the largest "ships green and leaks" surface (SL-1c). It should get the full plan → discuss → execute → red-team treatment, and it should not share a PR with anything else.

⚠️ **No file-level collisions between the three** (A: `factsheet/**` + new share module; B: `api/keys/**`, `api/strategies/finalize-wizard`, three components, migrations; C: `lib/queries.ts` + `lib/percentile-core.ts`). They *can* be planned in parallel. They should **not** be executed in parallel by concurrent agents — `feedback_concurrent_agents_share_git_index_race` applies, and B and C both touch `supabase/tests/`.

---

## Integration points summary

| Boundary | A | B | C |
|---|---|---|---|
| Next `unstable_cache` / `revalidateTag` | **load-bearing (SL-1)** | — | — |
| `src/proxy.ts` PUBLIC_ROUTES | +1 (Option 2 only) | — | — |
| Supabase RLS | new owner policy + owner-coherence EXISTS | `api_keys_owner` unchanged; grant-level REVOKE | — |
| SECURITY DEFINER | new reader RPC | new writer RPC (Phase-156 shape) | — |
| Service-role client (`createAdminClient`) | token read surface | connect writer | — |
| `src/lib/visibility.ts` | ⚠️ B25 lint bans a raw `.eq("status","published")` on `strategies` — a token predicate must respect that boundary or be explicitly exempted | — | `withPublishedOnly` unchanged, filter is downstream |
| Vercel CDN | `/api/og/factsheet/[id]` must stay published-only (SL-1d) | — | — |
| Railway worker | — | reads `strategies.asset_class` as the annualization clock — the reason B-ii is money-math | — |
| CI SQL gates | `supabase/tests/test_strategy_shares_rls.sql` (content-by-field, per the `20260622120000:16-22` discipline) | `supabase/tests/test_*.sql` for the grant state | vitest only |

---

## Confidence

| Area | Level | Basis |
|---|---|---|
| A — cache invariant + poison mechanism | **HIGH** | read at v2/page.tsx:63-80, :279-327, :527-538; the file documents it against itself |
| A — token pattern transposability | **HIGH** | `/scenario-share` read end-to-end (token lib, migration, both routes, the page) |
| A — payload-builder seam (extract vs predicate) | **MEDIUM** | the extraction's true diff width depends on the composite/basis arms; not measured |
| B — what 156 closed | **HIGH** | both migrations read in full; Migration B confirmed landed at `5d43df6b` (PR #682) |
| B — the null-attestation √252 trap | **HIGH** | `isCryptoExchange(closed-sets.ts:569)` + the dated backfill cutoff (`20260811210000:695-700`) + the stamp expression (`finalize-wizard:1321-1329`) |
| B — reachability of un-attested rows through finalize-wizard | **LOW → B-M1** | requires a PROD census; not inferable from source |
| C — where the fix belongs | **HIGH** | both callers, the shared core, and the csv-finalize mirror read directly |
| C — `complete_with_warnings` landmine | **HIGH** | `closed-sets.ts:696-719` states the rule explicitly |
| C — per-category population sizes | **LOW → C-M1** | requires a PROD census |

## Sources

All in-repo at HEAD `ca3f0c5c` (2026-08-20). Confidence tier for every claim below: **HIGH — primary source, this repository.**

- `src/app/factsheet/[id]/v2/page.tsx` (:33, :46, :63-80, :82-99, :279-327, :329-376, :402-411, :413-521, :527-538)
- `src/app/factsheet/[id]/page.tsx:5`; `src/app/api/og/factsheet/[id]/route.tsx` (:40, :154)
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` (:690, :1307-1338, :1565)
- `src/app/(dashboard)/strategies/page.tsx:175`; `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:187`; `src/components/strategy/ShareableLink.tsx`
- `src/app/scenario-share/[token]/page.tsx` (:1-19, :56-61); `src/app/scenario-share/[token]/share-resolve.ts`; `src/lib/scenario-share-token.ts`; `src/app/api/allocator/scenario/share/route.ts`; `.../share/revoke/route.ts`
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` (:5-54, :81-91, :111-116, :233, :289, :296-297, :304, :315-342)
- `supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql` (:16-29, :62-73, :125-142, :205-255, :383-395, :412-433, :540-592)
- `supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql`; `20260811210000_api_keys_attested_venue.sql` (:143-219, :294, :567-676, :695-700, :790-805); `20260810120000_lock_api_keys_exchange_column.sql`; `20260405061912_rls_policies.sql:22`
- `src/app/api/strategies/finalize-wizard/route.ts` (:1160-1233, :1235-1262, :1266, :1279, :1285-1330, :1352-1358); `src/app/api/strategies/create-with-key/route.ts` (:1075-1089); `src/app/api/keys/validate-and-encrypt/route.ts` (:63-78, :185, :306-326)
- `src/components/strategy/ApiKeyManager.tsx` (:254, :270-273, :352); `src/components/strategy/StrategyForm.tsx:140`; `src/components/exchanges/AllocatorExchangeManager.tsx:591`
- `src/lib/queries.ts` (:116-127, :141-181, :575-665, :704, :1197, :1951-1960); `src/lib/percentile-core.ts` (:1-30, :31-80); `src/lib/utils.ts:171-208`; `src/lib/closed-sets.ts` (:569, :696-719); `src/components/strategy/StrategyTable.tsx:1078-1096`
- `src/app/api/strategies/csv-finalize/route.ts` (:1029-1048, :1485-1520); `src/app/api/admin/strategy-review/route.ts:501`; `src/lib/visibility.ts`; `src/lib/ratelimit.ts` (:97, :117); `src/proxy.ts` (:17, :117); `next.config.ts` (no `cacheComponents`); `next@16.2.11`
- `TODOS.md` (:27-73, :818-833, :940-975, :2522-2534); `.planning/PROJECT.md` § Current Milestone v1.20

---
*Targeted integration research for v1.20 items A (SHARELINK-01), B (venue provenance), C (ranking integrity).*
*Researched: 2026-08-20*
