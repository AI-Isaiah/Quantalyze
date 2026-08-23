# Phase 160: PROVENANCE — The server's venue is the venue that annualizes - Research

**Researched:** 2026-08-23
**Domain:** Postgres privilege architecture (Supabase grants/triggers/CHECKs), Next.js API-route service-role writers, money-math annualization stamps, PROD data census discipline
**Confidence:** HIGH on mechanism (all load-bearing claims verified against HEAD source this session); LOW on population sizing until B-M1 runs (by design — the census is task 1)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### B-M1 census & B-D1 scope gating
- Census is a committed early phase artifact (`160-CENSUS.md`) with pinned counts — discipline copied from migration `20260811210000` (count-pinned, abort-on-drift).
- The census decides B-D1 scope mechanically (all of B-1..B-4 vs B-4-alone-with-null-guard): threshold documented in the artifact, no separate user gate.
- At REVOKE time, the migration guard re-runs the count-pinned census and aborts on drift.

#### Server-authoritative INSERT rollout
- Writer = extend `validate-and-encrypt` (already knows the canonical venue) to insert the `api_keys` row and return `{ api_key_id }` — Phase-156 service-role-writer pattern.
- Client INSERT sites (`ApiKeyManager.tsx:254`, `StrategyForm.tsx:140`) stop inserting; DELETE (`ApiKeyManager.tsx:352`) stays client-side — REVOKE INSERT only. Grep every `.from("api_keys")` mutation before the REVOKE.
- Two PRs: writer deploy FIRST, soak, then the REVOKE migration — ⚠️ never migration-first.
- Soak = one deploy cycle + prod smoke of the wizard key-add flow before landing the REVOKE PR.

#### asset_class stamp + B-D2 oracle
- The `finalize-wizard` stamp derives from the attested venue, and the swap lands in the SAME change as the null-attestation extension of `skipAssetClassWrite`: a NULL attestation SKIPS — never stamps `traditional`/√252 (the `isCryptoExchange(null) === false` trap).
- Oracle pins the ECONOMICS ("a null attestation annualizes on nothing — it skips"), never the implementation's own expression (founder testing rule).
- Census-identified affected strategies get golden-parity re-annualization; no blanket backfill.

### Claude's Discretion
- Exact census SQL shape, artifact formatting, and the documented B-D1 threshold value.
- Test file placement and naming, following existing route.test.ts conventions.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RANK-03 | `api_keys.exchange` is server-authoritative at every INSERT path — no client-supplied venue can differ from the venue the server validated (extends the Phase-156 service-role-writer pattern) | §Architecture Patterns (B-cluster rollout), §Code Examples (writer, REVOKE skeleton), §Common Pitfalls 1–5. **Correction to CONTEXT's site list: there are THREE client INSERT sites, not two** — `AllocatorExchangeManager.tsx:591` is the third (verified at HEAD, see §The write surface). |
| RANK-04 | The `asset_class` annualization stamp (√365 vs √252) derives from the server-validated venue, never from client-supplied `apiKeyExchange`; the swap moves together with a null-attestation extension of `skipAssetClassWrite`, gated on the B-M1 census | §The stamp swap + guard, §Code Examples (guard shape, B-D2 oracle), §Common Pitfalls 6–8, §Census (B-M1 SQL) |
</phase_requirements>

## Summary

This phase closes two residuals that migration `20260811210000` explicitly deferred: (1) `api_keys.exchange` is still client-supplied at row creation on the **three** non-wizard INSERT paths, and (2) the finalize-wizard `asset_class` stamp still reads that forgeable column. Both fixes reuse machinery that already exists and is live on PROD: Phase 156 moved the *wizard's* api_keys writes behind server-called SECURITY DEFINER RPCs and then revoked `authenticated` EXECUTE (both landings merged: PR #680 `25e28d3a` = v0.60.0.0 additive, PR #682 `5d43df6b` = v0.61.0.0 revoke) `[VERIFIED: git log on supabase/migrations/20260813150106…, 20260814120000…]`. Phase 160 does the same for the non-wizard connect flows, with `REVOKE INSERT` mirroring `20260810120000`'s `REVOKE UPDATE` shape, and then — only then — swaps the stamp input to `attested_venue` WITH the null-skip guard.

The single most dangerous trap is already named in the locked decisions and confirmed at source: `isCryptoExchange(null) === false` (`closed-sets.ts:570` — `if (!exchange) return false;`), so a naive one-identifier swap stamps `traditional`/√252 onto every strategy whose key carries a NULL attestation — trigger-scrubbed client inserts since 2026-08-11 and any row the dated backfill did not reach. The guard extension (`skipAssetClassWrite` keyed on the attestation, not the lookup fault) is what makes the swap correct, and the B-M1 census is what bounds how many strategies the change actually touches.

**Primary recommendation:** Two PRs. PR-1 is TS-only (no migration): `validate-and-encrypt` gains a persist arm that writes the row with the **admin client** — a direct `.from("api_keys").insert({ …, exchange: exchangeNormalized, attested_venue: exchangeNormalized })` survives the scrub trigger because `service_role` is on its allowlist, and the existing CHECK enforces the coupling; the three client components stop inserting; the stamp swap + guard + B-D2 oracle land here too (they need no migration). PR-2 is the `REVOKE INSERT` migration carrying a re-run count-pinned census guard, landed only after PR-1 has soaked on PROD. The census (`160-CENSUS.md`) is the phase's first task and is **orchestrator-executed** (Supabase MCP is stripped from subagents), copying `159-CENSUS.md`'s artifact discipline verbatim.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Venue validation (which venue did the key authenticate at) | API route (`validate-and-encrypt` → Python `/validate-key`) | Analytics service | Already server-side; the route normalizes the venue (`exchangeNormalized`, route.ts:78) before validating |
| api_keys row creation (RANK-03) | API route (admin client, service_role) | Postgres (scrub trigger + CHECK backstop) | The writer must be the same request that validated; DB trigger/CHECK make forgery structurally impossible, not just unimplemented |
| Privilege withdrawal (REVOKE INSERT) | Postgres migration | supabase/tests SQL gate | Grants are the enforcement layer (RLS `api_keys_owner FOR ALL` stays untouched); mirrors `20260810120000` |
| asset_class stamp (RANK-04) | API route (`finalize-wizard`) | — | The stamp is a server-side strategies UPDATE; `create-with-key`'s draft stamp is already server-validated (reads route-local `exchange`) |
| Annualization consumption (√365 vs √252) | Analytics worker (Python) | — | Worker reads `strategies.asset_class` DIRECTLY as the clock (`periods_per_year_for_asset_class`); it never re-derives from venue — which is why a wrong stamp is a silent money bug |
| B-M1 census | PROD database (read-only) via orchestrator | `.planning` artifact | MCP tools are stripped from subagents; the 159-CENSUS.md pattern is the template |
| UI key-connect flows | Browser components (3 sites) | — | They keep validating via the route; they stop writing and consume `{ api_key_id }` |

## Standard Stack

### Core
No new libraries. This phase is entirely in-repo: Next.js API routes (existing), `@supabase/supabase-js` admin client (existing `createAdminClient()`), raw SQL migrations under `supabase/migrations/`, SQL gates under `supabase/tests/`, vitest for TS tests.

| Asset | Where | Why standard here |
|---------|---------|--------------|
| `createAdminClient()` service-role writer | already used in the same file region (`finalize-wizard/route.ts:1194` `assetClassAdmin`) | The repo's established privileged-write mechanism `[VERIFIED: src/app/api/strategies/finalize-wizard/route.ts:1193-1199]` |
| Scrub trigger allowlist | `scrub_client_supplied_attested_venue()` | Admits `service_role` by name — the direct-insert writer's attestation survives `[VERIFIED: supabase/migrations/20260811210000:534]`, verbatim: `IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN` |
| Coupling CHECK | `api_keys_attested_venue_matches_exchange` | Verbatim: `CHECK (attested_venue IS NULL OR attested_venue = exchange)` `[VERIFIED: supabase/migrations/20260811210000:294]` — any writer that lets the columns diverge FAILS |
| REVOKE precedent | `20260810120000` | Verbatim: `REVOKE UPDATE ON public.api_keys FROM anon, authenticated;` `[VERIFIED: supabase/migrations/20260810120000_lock_api_keys_exchange_column.sql:104]` — B-3 mirrors with `INSERT` |
| Census discipline | `20260811210000` §5 + `159-CENSUS.md` | Hand-typed pins, PROD-signature discriminator, abort-on-drift `[VERIFIED: supabase/migrations/20260811210000:590-674]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct admin-client INSERT in the route (recommended) | New SECDEF RPC `create_connected_key` (milestone ARCHITECTURE.md's B-1) | The RPC adds a migration to PR-1 (breaking the clean "PR-1 is TS-only, PR-2 is the only migration" shape), a new function ACL surface, and CREATE-OR-REPLACE hygiene burden — for no additional guarantee: the scrub trigger + CHECK already police a service_role direct insert identically. Choose the RPC only if the planner wants the writer body SQL-testable in isolation; the recommended compensator is a `supabase/tests` gate proving a `service_role` INSERT retains `attested_venue` (see Wave 0 gaps). |
| REVOKE INSERT at table level | RLS policy change | Wrong lever — RLS `api_keys_owner` is ownership, not venue (`CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());` `[VERIFIED: supabase/migrations/20260405061912_rls_policies.sql:22]`). The repo's precedent for withdrawing a verb is the grant layer (`20260810120000`), and RLS must stay untouched for SELECT/DELETE. |

**Installation:** none — zero new packages.

## Package Legitimacy Audit

No external packages are installed by this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none.

## The system today (verified at HEAD)

### The write surface — every `.from("api_keys")` site, classified

Full-repo grep this session (`src/`, non-test):

| Site | Verb | Client role | Phase-160 action |
|---|---|---|---|
| `src/components/strategy/ApiKeyManager.tsx:254` | INSERT (`{ user_id, exchange, label, ...dbFields }` then `.select("id").single()`) | browser (authenticated) | **stops inserting**; consumes `{ api_key_id }`; keeps the `strategies.api_key_id` link update at :269-272 |
| `src/components/strategy/StrategyForm.tsx:140` | INSERT (`{ user_id, exchange: exchangeCanonical, label, ...dbFields }`, no id captured) | browser | **stops inserting** |
| `src/components/exchanges/AllocatorExchangeManager.tsx:591-604` | INSERT (`{ user_id, exchange, label, …, sync_status: "idle" }` then `.select(API_KEY_USER_COLUMNS).single()`) | browser | **stops inserting** — ⚠️ THE THIRD SITE, absent from CONTEXT.md's list; missing it makes the REVOKE kill the allocator connect flow at merge |
| `src/components/strategy/ApiKeyManager.tsx:352` | DELETE | browser | **stays** (REVOKE INSERT only, per locked decision) |
| `src/app/api/strategies/finalize-wizard/route.ts:2080` | UPDATE `last_sync_at` | admin (service_role) | unaffected |
| `finalize-wizard/route.ts:1249`, `:1712`; `create-with-key/route.ts:188`; `keys/sync/route.ts:408`; `keys/[id]/permissions/route.ts:391`; `queries.ts:617`, `:2893`; `ApiKeyManager.tsx:147`; `SyncProgress.tsx:170`; `SyncPreviewStep.tsx:1486` | SELECT only | mixed | unaffected (column-level SELECT allowlist from migration 027 covers them) |
| `e2e/helpers/seed-test-project.ts`, `scripts/seed-full-app-demo.ts`, `tests/integration/mig-128-batch-concurrency.test.ts`, `analytics-service/tests/test_compute_jobs_fencing.py`, `src/lib/test-helpers/live-db.ts` | INSERT/DELETE | **service_role admin clients throughout** (`TEST_SUPABASE_SERVICE_ROLE_KEY`, `[VERIFIED: e2e/helpers/seed-test-project.ts:50]`) | unaffected by the REVOKE |

Per the v1.10 lesson (grep the WHOLE repo, not `src/` only): the grep above covered `src/`, `e2e/`, `tests/`, `scripts/`, `analytics-service/`. The REVOKE-PR plan must re-run it at that commit's HEAD — the list above is this session's snapshot.

All three client INSERT sites POST `/api/keys/validate-and-encrypt` first. That route already normalizes and validates the venue server-side — `const exchangeNormalized = isSfox ? "sfox" : isMt5 ? "mt5" : exchange;` `[VERIFIED: src/app/api/keys/validate-and-encrypt/route.ts:78]` — then returns ciphertext and lets the browser write the row (which the scrub trigger lands as `attested_venue = NULL`).

### The stamp today

`finalize-wizard/route.ts` reads both columns in ONE query (`.select("exchange, attested_venue")` at :1254) into two deliberately separate bindings, routes the **security** probe gate through `attestedVenue` (:1358) and the **money-math** stamp through the forgeable `apiKeyExchange`. Verbatim, the two lines this phase changes `[VERIFIED: src/app/api/strategies/finalize-wizard/route.ts:1292, 1319-1329]`:

```ts
const skipAssetClassWrite = Boolean(apiKeyId) && apiKeyExchange === null;
…
      .update({
        asset_class: apiKeyId
          ? isCryptoExchange(apiKeyExchange)
            ? "crypto"
            : "traditional"
          : isCompositeForAssetClass
            ? "crypto"
            : fields.asset_class,
      })
```

And the trap, verbatim `[VERIFIED: src/lib/closed-sets.ts:569-574]`:

```ts
export function isCryptoExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return (CRYPTO_EXCHANGES as readonly string[]).includes(
    exchange.toLowerCase(),
  );
}
```

with `CRYPTO_EXCHANGES = ["binance", "okx", "bybit", "deribit", "sfox"]` `[VERIFIED: src/lib/closed-sets.ts:553-559]` — `mt5` deliberately excluded (√252). So `isCryptoExchange(null)` → `false` → `"traditional"` → √252: the naive swap silently mis-annualizes every null-attestation crypto strategy, inflating Sharpe ~×1.20 (√365/√252 ≈ 1.203).

`create-with-key`'s draft stamp is ALREADY server-validated — it reads the route-local `exchange` the same request validated: `asset_class: isCryptoExchange(exchange) ? "crypto" : "traditional",` `[VERIFIED: src/app/api/strategies/create-with-key/route.ts:1089]`. **No change needed there; the plan should say so explicitly** (milestone ARCHITECTURE.md B.3 asked for exactly this confirmation). This is also why the null-attestation SKIP is safe: the draft row a skip preserves already carries a venue-aware, server-derived stamp for every wizard-created strategy.

### Null-attestation populations (why the guard is not optional)

`attested_venue` is NULL in two live populations `[VERIFIED: supabase/migrations/20260811210000:204-219, 695-700]`:
1. every non-privileged client INSERT since first apply (the scrub trigger's deliberate output), i.e. rows minted by the three component paths since ~2026-08-11;
2. rows the dated backfill did not reach — the backfill is bounded: `SET LOCAL quantalyze.attest_backfill_cutoff = '2026-08-11 00:00:00+00';` with `WHERE attested_venue IS NULL AND created_at < …cutoff` (verbatim at :695-700), explicitly NOT a fill-forever rule.

## Architecture Patterns

### System Architecture Diagram

```
TODAY (non-wizard connect)                    TARGET (after PR-1)
──────────────────────────                    ───────────────────
browser (3 components)                        browser (3 components)
  │ POST /api/keys/validate-and-encrypt         │ POST /api/keys/validate-and-encrypt  (persist arm)
  ▼                                             ▼
route: normalize venue ──▶ Python /validate-key route: normalize venue ──▶ /validate-key ──▶ /encrypt-key
  │  ◀── ciphertext ◀── /encrypt-key            │
  ▼                                             ▼
returns ciphertext to browser                 admin client INSERT api_keys
  │                                             { exchange: V, attested_venue: V, … }
  ▼                                             │  ── BEFORE INSERT trigger: service_role → value kept
browser INSERTs api_keys                        │  ── CHECK: attested_venue = exchange enforced
  (client-chosen venue;                         ▼
   trigger scrubs attested_venue→NULL)        returns { api_key_id } to browser
                                                │
                              AFTER PR-2 (soaked): REVOKE INSERT ON api_keys
                                                   FROM anon, authenticated
                                                   (guarded by re-run census pin)

STAMP PATH (finalize-wizard, PR-1):
  api_keys read (exchange, attested_venue — one query, unchanged)
      │
      ├─ attestedVenue ──▶ runScopeBroadeningProbe   (unchanged, Phase 153.6)
      └─ attestedVenue ──▶ asset_class stamp          (THE SWAP)
             │
             ├─ null ──▶ SKIP (guard extension — draft stamp stays; worker keeps
             │            reading the create-with-key server-derived clock)
             └─ non-null ──▶ isCryptoExchange(attestedVenue) ? crypto : traditional
                                  │
                                  ▼
                    strategies.asset_class ──▶ worker periods_per_year_for_asset_class
                                               (√365 crypto / √252 traditional)
```

### Recommended rollout (the B-cluster, mapped to the two locked PRs)

| Landing | Content | Safe because |
|---|---|---|
| **PR-1** (deploy first) | (a) `validate-and-encrypt` persist arm: admin-client INSERT stamping `exchange` AND `attested_venue` from `exchangeNormalized`, returns `{ api_key_id }`; (b) all THREE components stop inserting and consume the id; (c) the stamp swap + `skipAssetClassWrite` null-attestation extension + B-D2 oracle; (d) TS tests | No migration in this PR at all. Old stale-tab clients keep working (see skew handling below). The swap is safe pre-REVOKE because the guard makes null-attestation rows a SKIP, not a mis-stamp |
| *soak* | one deploy cycle + PROD smoke of the key-add flows (see Pitfall 5 on WHICH flows) | |
| **PR-2** (revoke second) | migration: `REVOKE INSERT ON public.api_keys FROM anon, authenticated;` + re-run count-pinned census guard + ABORTING post-verify; state-adaptive `supabase/tests` gate; drop the route's legacy ciphertext-returning arm in the same deploy | The browser no longer needs INSERT; merge auto-applies to PROD and fires the Vercel build on the same merge — acceptable ONLY in this direction (never migration-first) `[VERIFIED: supabase/migrations/20260813150106:22-30 records exactly this asymmetry for Phase 156]` |

B-D1 mechanics per the locked decision: the census artifact documents a threshold and decides scope mechanically. Recommended threshold framing (Claude's discretion): B-4-alone-with-null-guard is the minimal correct cut **only if** the census finds zero un-attested rows carried by a strategy with `wizard_session_id` (SUMMARY.md:323's "if (2) is zero the swap+skip is inert-but-correct"); any linked population, or any ongoing client-INSERT flow (which there always is, until REVOKE), argues for the full B-1..B-4 = PR-1 + PR-2 as scoped above. Since CONTEXT already locks the writer + REVOKE, the realistic census decision is narrower: **whether a re-annualization/golden-parity task exists at all, and for which strategy ids.**

### Pattern 1: Service-role direct insert that survives the scrub trigger
**What:** The persist arm writes with `createAdminClient()`. PostgREST executes the statement as `service_role`, which the BEFORE INSERT trigger admits by name, so the supplied `attested_venue` is retained; the CHECK forces it to equal `exchange`.
**When to use:** PR-1 writer.
**Why not an RPC:** see Alternatives Considered. The trigger comment itself names this class of writer: "the analytics worker and the support/admin routes run as service_role" `[VERIFIED: supabase/migrations/20260811210000:530-533]`.

### Pattern 2: Request-versioned skew window (old JS + new route)
**What:** PR-1's route must not double-write. A stale browser tab running pre-PR-1 JS will still POST the old body and then client-INSERT. If the new route wrote a row for EVERY call, stale tabs would produce two rows (one attested server row + one scrubbed client row). Discriminate on an explicit request field (e.g. `persist: true`) that only the new components send: with it → server writes, returns `{ api_key_id }` and NO ciphertext; without it → today's ciphertext response, unchanged, until the REVOKE turns stale-tab inserts into an honest 42501 failure.
**Bonus:** in persist mode the ciphertext stops round-tripping through the browser at all — a strict security improvement.

### Pattern 3: Count-pinned census with PROD-signature discriminator (copy, don't re-invent)
**What:** hand-typed CONSTANT pins; a two-sided discriminator so a PROD apply can never silently take the lenient branch; abort message printing the pin it used from the same constants. Verbatim pin shape being copied `[VERIFIED: supabase/migrations/20260811210000:627-629]`:

```sql
  c_pin_total CONSTANT INT    := 29;
  c_pin_mt5   CONSTANT INT    := 2;
  c_pin_dates CONSTANT DATE[] := ARRAY[DATE '2026-08-04'];
```

For PR-2 the enforced population is the phase's own: the count of un-attested rows measured by B-M1 (drift = a key was connected/deleted between census and merge → re-measure and re-cut, never soften — but see Pitfall 9 on which count carries teeth vs which is report-only).

### Pattern 4: Golden-parity re-annualization (bounded, per-strategy, no blanket backfill)
**What:** if B-M1 finds strategies whose `asset_class` will change on their next finalize (or which are mis-stamped today), each gets an old-vs-new metric snapshot with every delta explained — the Phase 78 "golden parity gated the production switch (flow-less accounts unmoved… every delta explained)" discipline `[CITED: .planning/MILESTONES.md:264]`. Expected delta shape for a √252→√365 correction: Sharpe/vol scale by √(365/252) ≈ 1.203; CAGR/cumulative-return are calendar-based and must NOT move (per the #597 RISK=frequency / RETURN=CALENDAR split).

### Anti-Patterns to Avoid
- **Migration-first:** revoking while the old deploy still calls with the user-scoped client 42501s every connect for the width of the merge window; "the merge IS the apply" with no ordering against the Vercel build `[VERIFIED: supabase/migrations/20260813150106:23-30]`.
- **`?? apiKeyExchange` fallback on the attestation read:** the in-file comment forbids it verbatim — "⛔ NEVER `?? apiKeyExchange`… Falling back to the forgeable column there would make the whole thing a no-op for every row that has one" `[VERIFIED: finalize-wizard/route.ts:1275-1278]`. The stamp swap inherits this rule.
- **Editing applied migrations:** `20260811210000` and `20260810120000` are applied to PROD/TEST; corrections live in NEW files (the repo's own M2-05 precedent).
- **DROP+CREATE for any SQL function touched:** a fresh function's default ACL grants EXECUTE to PUBLIC — a silent escalation `[VERIFIED: supabase/migrations/20260813150106:72-76]`. (Only relevant if the planner chooses the RPC-writer option.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Attestation-vs-label coupling | route-level equality checks | existing CHECK `api_keys_attested_venue_matches_exchange` | Already enforced for every writer, present and future |
| Client-supplied attestation defense | new trigger | existing `api_keys_scrub_attested_venue` BEFORE INSERT trigger | Already scrubs every non-privileged INSERT; the new writer simply joins its allowlist by role |
| Privilege withdrawal | RLS surgery | table-level `REVOKE INSERT … FROM anon, authenticated` | Exact `20260810120000` precedent; RLS stays for SELECT/DELETE ownership |
| Census framework | ad-hoc queries | `159-CENSUS.md` artifact pattern + `20260811210000` §5 pin shape | Both are in-repo, reviewed, and PROD-proven |
| Annualization clock | any re-derivation | `strategies.asset_class` read by the worker | The whole point: one stamp, one clock; surfaces that re-derive are the known bug class (MT5-09) |

**Key insight:** every enforcement mechanism this phase needs already exists in the database; the phase's work is moving the *writers* onto the privileged side of mechanisms Phase 153.6/156 built, then withdrawing the unprivileged verb.

## Runtime State Inventory

(This phase changes who may write a PROD table and re-derives money-math stamps — the census categories apply.)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | PROD `api_keys` rows with `attested_venue IS NULL` (both populations above); PROD `strategies.asset_class` values stamped from client-supplied venues pre-swap | B-M1 census (task 1, orchestrator, read-only); per-strategy golden-parity re-annualization ONLY for census-identified rows — locked: no blanket backfill |
| Live service config | None — no env vars, flags, or dashboards change. Vercel deploy + Supabase auto-apply are the only carriers | Sequencing only (deploy-first / revoke-second) |
| OS-registered state | None — verified: no cron/scheduler references `api_keys` INSERT paths (pg_cron jobs touch compute_jobs, not api_keys grants) | none |
| Secrets/env vars | None change. `SUPABASE_SERVICE_ROLE_KEY` already present on Vercel (admin client in the same routes today) | none |
| Build artifacts | None — TS-only + one migration; no package/binary renames | none |

## Common Pitfalls

### Pitfall 1: The third INSERT site
**What goes wrong:** CONTEXT.md lists two client INSERT sites; `AllocatorExchangeManager.tsx:591` is a third (verified INSERT at HEAD). Converting only two and revoking kills the allocator connect flow at PR-2 merge.
**How to avoid:** all three components convert in PR-1; the PR-2 plan re-greps the whole repo (not `src/` only) immediately before landing.
**Warning signs:** any `.from("api_keys").insert(` outside admin/service-role contexts at REVOKE time.

### Pitfall 2: Stale-tab double insert during the soak window
**What goes wrong:** new route writes a row AND old client JS inserts a second (unattested) one → duplicate keys, duplicated syncs.
**How to avoid:** Pattern 2 (request-versioned persist arm). Old bodies keep old behavior verbatim.

### Pitfall 3: ApiKeyManager leaks raw PG errors on insert failure
**What goes wrong:** `throw new Error(insertError.message)` at `ApiKeyManager.tsx:261` surfaces raw Postgres text (42501/constraint names) to the UI — StrategyForm already redacts (H-0405) but ApiKeyManager doesn't. If any insert path survived to REVOKE, users see SQLSTATE soup.
**How to avoid:** moot once the component stops inserting — but the persist-arm error copy must be curated (route already emits coded envelopes; reuse `KEY_INVALID_FORMAT`/`UNKNOWN` conventions in-file).

### Pitfall 4: The audit-coverage 8-line pragma window
**What goes wrong:** the `@audit-skip` pragma above the asset_class mutation must stay within 8 lines of the `.update(` — `audit-coverage.test.ts` scans that window and prose inserted between them silently un-instruments the site ("measured: this note, on its first placement") `[VERIFIED: finalize-wizard/route.ts:1311-1314]`. The guard/swap edit lands exactly there.
**How to avoid:** new commentary goes ABOVE the pragma; keep the pragma adjacent to the mutation. Same rule at the persist arm if it mutates audited tables.

### Pitfall 5: Smoking the wrong flow during soak
**What goes wrong:** the locked decision says "prod smoke of the wizard key-add flow" — but the wizard's writes have been server-side since Phase 156 and don't exercise the new persist arm at all (`create-with-key` calls the RPC via `rpcAdmin` `[VERIFIED: create-with-key/route.ts:835]`).
**How to avoid:** smoke the wizard flow as locked AND the three converted surfaces — ApiKeyManager (strategy page key add), StrategyForm modal, AllocatorExchangeManager — which are the flows the REVOKE can actually break. Recorded here as an augmentation, not a contradiction, of the locked decision.

### Pitfall 6: `isCryptoExchange(null)` — the swap without the guard
**What goes wrong:** √252 stamped onto crypto strategies through NULL attestations; worker consumes `strategies.asset_class` directly, so Sharpe/vol inflate ~×1.20 silently.
**How to avoid:** guard and swap in the SAME change (locked); B-D2 oracle observed RED with the guard neutered before the fix is trusted (founder anti-vacuity rule).

### Pitfall 7: A skip that regresses the fault-arm behavior
**What goes wrong:** today's guard keys on `apiKeyExchange === null` (lookup FAULT). The new guard keys on `attestedVenue === null` — which is a strict superset (fault ⇒ both null; unattested row ⇒ only attestation null). Getting this backwards (e.g. `&&`-ing both) re-opens the fault arm.
**How to avoid:** `skipAssetClassWrite = Boolean(apiKeyId) && attestedVenue === null` — one binding, the attested one. `apiKeyExchange` may be retained solely for the warn log ("venue resolved as X but unattested — skipping"), or deleted; it must not feed the stamp.

### Pitfall 8: Self-referential oracle
**What goes wrong:** a test that re-computes `isCryptoExchange(attestedVenue) ? … : …` and compares to the implementation cannot fail (3 money bugs survived 6 passes this way).
**How to avoid:** pin outcomes as literals against fixtures: attested `deribit` ⇒ the captured update equals `{ asset_class: "crypto" }`; attested `mt5` ⇒ `{ asset_class: "traditional" }`; attestation NULL with exchange RESOLVED ⇒ **no** asset_class update captured for that strategy (the economics: a null attestation annualizes on nothing). The existing harness already captures updates in `STATE.assetClassUpdates` `[VERIFIED: finalize-wizard/route.test.ts:1394-1495 — the "#597 asset_class persistence" describe, incl. :1463 "does NOT overwrite asset_class to 'traditional' when the single-key venue lookup faults"]`.

### Pitfall 9: Census join fan-out and a pin with the wrong teeth
**What goes wrong:** (a) LEFT JOINing `strategies` and `strategy_keys` double-counts keys (a key can be a composite member AND linked); use `EXISTS`. (b) Pinning the TOTAL row count and aborting on it is the latent-outage shape `20260811210000` explicitly walked back (":660-666 — THE TOTAL IS REPORTED, NEVER ENFORCED… `api_keys` is live and user-mutable"). The PR-2 guard must enforce the population whose drift changes the DECISION (un-attested count), and report totals as deltas.
**How to avoid:** copy the two-tier abort/report split verbatim; on drift, re-measure and re-cut constants together — never soften the comparison.

### Pitfall 10: `.planning` is PUBLIC
**What goes wrong:** the census artifact is world-readable on push.
**How to avoid:** `159-CENSUS.md`'s rule verbatim: counts, dates, and strategy/key ids ONLY — never emails, auth uids, names, credentials, or project URLs beyond the already-public refs.

### Pitfall 11: sql-tests gates that red every open PR
**What goes wrong:** a `supabase/tests` gate asserting "authenticated cannot INSERT" reds `sql-tests` on every PR the moment it lands, because TEST hasn't received the REVOKE migration yet (or vice versa reds after).
**How to avoid:** the Phase-156 state-adaptive shape — the gate SKIPs on a pre-REVOKE database and ARMs after (STATE.md records this design for the 5d/5f/5g/5h set and its consequence: nothing is observed armed-and-green until the migration reaches TEST; note that explicitly in VERIFICATION).

## Code Examples

### B-M1 census — Query 1: the un-attested population (exact SQL, Claude's-discretion shape)

```sql
-- 160-CENSUS Q1 — un-attested api_keys since the 20260811210000 cutoff,
-- split by exchange × strategy linkage × wizard_session_id carriage.
-- READ-ONLY. EXISTS (not JOIN) to avoid fan-out double counting.
SELECT
  k.exchange,
  count(*)                                                          AS unattested,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategies s WHERE s.api_key_id = k.id))          AS linked_single,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategy_keys sk WHERE sk.api_key_id = k.id))     AS linked_composite,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategies s
     WHERE s.api_key_id = k.id AND s.wizard_session_id IS NOT NULL)) AS wizard_carriage
FROM api_keys k
WHERE k.attested_venue IS NULL
  AND k.created_at >= TIMESTAMPTZ '2026-08-11 00:00:00+00'
GROUP BY 1 ORDER BY 1;

-- Q1b — the pre-cutoff residual (should be 0 by post-verify (a); measure anyway):
SELECT count(*) FROM api_keys
 WHERE attested_venue IS NULL
   AND created_at < TIMESTAMPTZ '2026-08-11 00:00:00+00';
```

### B-M1 census — Query 2: affected strategies (the golden-parity candidate list)

```sql
-- Strategies linked to un-attested keys: current stamp vs the venue-derived
-- expectation. asset_class_expected mirrors CRYPTO_EXCHANGES
-- ('binance','okx','bybit','deribit','sfox') = closed-sets.ts:553-559.
SELECT
  s.id                                             AS strategy_id,
  k.id                                             AS api_key_id,
  k.exchange,
  s.asset_class                                    AS stamped,
  CASE WHEN k.exchange IN ('binance','okx','bybit','deribit','sfox')
       THEN 'crypto' ELSE 'traditional' END        AS venue_derived,
  s.wizard_session_id IS NOT NULL                  AS wizard_carriage,
  s.status
FROM api_keys k
JOIN strategies s ON s.api_key_id = k.id
WHERE k.attested_venue IS NULL
ORDER BY k.exchange, s.id;
-- A row where stamped <> venue_derived is a re-annualization candidate
-- (golden-parity treatment, per-strategy, no blanket backfill).
```

### The guard + swap (finalize-wizard, PR-1 — the two-line core)

```ts
// RANK-04: the stamp reads the ATTESTATION, and a null attestation SKIPS.
// isCryptoExchange(null) === false would stamp 'traditional'/√252 onto a
// crypto strategy — the exact mis-annualization the RED-TEAM skip exists to
// prevent, reintroduced through the front door. SKIP leaves create-with-key's
// server-derived draft stamp intact (route-local `exchange`, same request
// that validated it — create-with-key/route.ts:1089).
const skipAssetClassWrite = Boolean(apiKeyId) && attestedVenue === null;
…
        asset_class: apiKeyId
          ? isCryptoExchange(attestedVenue)   // was: apiKeyExchange
            ? "crypto"
            : "traditional"
          : …unchanged composite/CSV arms…
```

### PR-2 REVOKE migration skeleton (shape only; constants re-cut from B-M1 at landing)

```sql
BEGIN;
SET lock_timeout = '3s';

-- 1. Census re-run guard (Pattern 3): PROD signature discriminator + abort
DO $census$
DECLARE
  c_pin_unattested CONSTANT INT := <B-M1 number, hand-typed at landing>;
  -- + a PROD-signature discriminator (stable public-safe fingerprint) so a
  --   TEST/local/CI apply takes the lenient NOTICE branch, PROD never can.
BEGIN
  -- abort on un-attested-population drift; REPORT totals as deltas only.
END $census$;

-- 2. THE verb withdrawal — mirrors 20260810120000:104 exactly, INSERT for UPDATE.
--    DELETE is deliberately untouched (live client path, ApiKeyManager.tsx:352).
REVOKE INSERT ON public.api_keys FROM anon, authenticated;

-- 3. ABORTING post-verify: has_table_privilege('authenticated','public.api_keys','INSERT')
--    must be false; 'DELETE' must remain true; SELECT column allowlist intact
--    (spot-check has_column_privilege on id/exchange); RLS policy untouched.
COMMIT;
```

### Persist-arm response contract (PR-1)

```ts
// persist: true  → { api_key_id, valid: true, read_only: true }   // NO ciphertext
// (absent)       → today's envelope verbatim (ciphertext + valid + read_only)
// Server INSERT payload MUST set both columns from the ONE normalized value:
//   { user_id, exchange: exchangeNormalized, attested_venue: exchangeNormalized,
//     label, …ciphertext fields… }   // CHECK enforces the coupling; trigger
//                                    // admits service_role so the value survives
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser INSERTs api_keys for wizard flows | SECDEF RPCs called server-side; `authenticated` EXECUTE revoked | Phase 156 (v0.60.0.0 / v0.61.0.0, live on PROD) | The exact two-landing pattern this phase replays for non-wizard flows |
| Probe gate read `api_keys.exchange` | Probe gate reads `attested_venue`, NULL ⇒ PROBE | Migration 20260811210000 (Phase 153.6) | The stamp is the last reader of the forgeable column — this phase's RANK-04 |
| `asset_class` unconditional 'crypto' | Venue-aware stamp via `isCryptoExchange` | MT5RECON-02 (Phase 136-era) | Why null-handling matters: mt5 made `false` a meaningful answer |

**Deprecated/outdated:** TODOS.md's "one-identifier change" framing for RANK-04 — measured WRONG by the milestone research and re-confirmed at source this session; the in-file comment at `finalize-wizard/route.ts:1302-1303` still carries that framing and should be rewritten by the swap commit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A PostgREST request under the service-role key executes with `current_user = 'service_role'`, so the scrub trigger's allowlist admits the admin-client direct INSERT and `attested_venue` survives | Pattern 1 | The persist arm would mint unattested rows silently (trigger scrubs to NULL → CHECK still passes → no error). **Mitigation is cheap and should be planned:** a `supabase/tests` SQL gate that `SET ROLE service_role; INSERT …; ASSERT attested_venue retained` — this converts A1 from assumption to CI-enforced fact. In-repo support: the trigger's own comment names service_role writers as the kept-value class `[VERIFIED: 20260811210000:529-535]`, but no existing test exercises a service_role INSERT's attestation retention |
| A2 | No fourth client INSERT path exists outside the greps run this session (src/, e2e/, tests/, scripts/, analytics-service/) | Write surface | REVOKE breaks an unconverted flow. Mitigated by the locked re-grep-before-REVOKE step |
| A3 | The B-M1 populations are small (PROD had 29 api_keys rows total on 2026-08-11 per the pinned census) | Census | If large, the golden-parity task grows; does not change the mechanism |
| A4 | `strategy_keys` linkage uses column `api_key_id` keyed by `owner_id` (observed in `queries.ts:619` projection) — census Q1 composite arm depends on it | Census SQL | Q1's `linked_composite` filter errors loudly (column not found) — self-correcting at census execution |

## Open Questions

1. **Writer mechanism: direct admin insert vs new SECDEF RPC (B-1).**
   - What we know: both satisfy the locked "Phase-156 service-role-writer pattern"; trigger + CHECK police both identically; the RPC costs a migration in PR-1 and ACL hygiene.
   - Recommendation: direct admin insert (PR-1 stays migration-free), with the A1 SQL gate as compensator. Planner decides; either is compliant.
2. **Response/skew contract details** (exact request discriminator name, whether the persist arm returns the API_KEY_USER_COLUMNS row or the components re-fetch by id — Allocator needs the row for UI; the SELECT allowlist covers `API_KEY_USER_COLUMNS = "id, user_id, exchange, label, is_active, sync_status, last_sync_at, account_balance_usdt, created_at, sync_error, last_429_at, disconnected_at"` `[VERIFIED: src/lib/constants.ts:170-171]`, so a re-fetch works).
3. **Whether the census finds ANY affected strategy.** If zero, the golden-parity task is a recorded no-op; if non-zero, the plan needs a re-annualization task (recompute trigger + before/after metric snapshot with each delta explained ≈ ×1.203 on RISK metrics only).
4. **`label` handling in the persist arm** — clients currently supply it at INSERT (StrategyForm defaults to `` `${exchangeCanonical} key` ``); the route body must accept it (length-capped, since it becomes server-written). `sync_status` needs no handling: `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'idle'` `[VERIFIED: supabase/migrations/20260406065011_security_hardening.sql:65]`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (PROD read) | B-M1 census, REVOKE verification | ✓ orchestrator ONLY (stripped from subagents) | — | none — census/PROD steps must be orchestrator tasks or explicit checkpoints |
| supabase CLI | local migration checks | ✓ | 2.84.2 | — |
| psql | direct DB access | ✗ | — | Supabase MCP / CLI; not blocking |
| Node | vitest/tsc | ✓ local v25.8.1 (CI = Node 22 — CI-only failures are a known class, reproduce with `PATH=/opt/homebrew/opt/node@22/bin`) | — | — |
| TEST DB creds | sql-tests, live-db suites | ✓ CI; local `.env.test.local` un-skips live suites (~274 local reds BY DESIGN — valid local gate = worktree without the .env files) | — | — |
| node_modules in GSD worktrees | executor validation | ✗ (measured: worktree agents get NO node_modules; `npx tsc` resolves a joke package) | — | run gates from the main checkout / orchestrator |

**Missing dependencies with no fallback:** none blocking — but the census and any PROD verification are structurally orchestrator-only.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS; config `vitest.config.ts`, coverage thresholds 82/80/74/72) + pgTAP-style SQL DO-block gates in `supabase/tests/` |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <file> --no-file-parallelism` |
| Full suite command | `npm run test` (⚠️ local reds ~274 by design with `.env.test.local`; CI shards are the gate) + `npm run lint` + `npx tsc --noEmit` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RANK-03 | persist arm writes `exchange` AND `attested_venue` from `exchangeNormalized`; persist response carries `api_key_id`, no ciphertext; legacy body byte-unchanged | unit (route) | `npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts --no-file-parallelism` | ✅ file exists — extend |
| RANK-03 | three components stop inserting; ApiKeyManager still links `strategies.api_key_id` | unit (component) | `npx vitest run src/components/strategy src/components/exchanges --no-file-parallelism` (narrow to the three specs at plan time) | ✅ component specs exist — extend |
| RANK-03 | `service_role` INSERT retains `attested_venue` (A1); post-REVOKE: authenticated INSERT denied, DELETE retained, SELECT allowlist intact | SQL gate (CI `sql-tests`) | runs in CI via `supabase/tests/test_*.sql` | ❌ Wave 0 — new file, state-adaptive (SKIP pre-REVOKE) |
| RANK-04 | attested crypto ⇒ `{asset_class:"crypto"}`; attested mt5 ⇒ `{asset_class:"traditional"}`; NULL attestation with RESOLVED exchange ⇒ NO update captured (the B-D2 economics); lookup-fault arm unchanged | unit (route) | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts --no-file-parallelism` | ✅ the `#597 asset_class persistence` describe exists (:1394) — extend |
| RANK-04 | every new oracle observed RED under a neuter (guard reverted to `apiKeyExchange === null`, or swap reverted) before restore | mutation discipline | manual neuter → observe → restore, recorded in SUMMARY | per-plan |

### Sampling Rate
- **Per task commit:** the two route quick-runs above + `npx tsc --noEmit`
- **Per wave merge:** full vitest (CI shards) + lint; no Python changes expected (worker untouched) — if any Python is touched, `cd analytics-service && python3 -m pytest` + `mypy --strict`
- **Phase gate:** full suite green; `sql-tests` green (with the new gate's SKIP-vs-ARM state recorded honestly — armed-and-green is only observable after the REVOKE reaches TEST)

### Wave 0 Gaps
- [ ] `supabase/tests/test_api_keys_insert_not_client_writable.sql` — RANK-03 SQL gate: (a) service_role INSERT retains attested_venue (A1, armable immediately); (b) authenticated INSERT denied + DELETE retained (state-adaptive, arms post-REVOKE). Model on `test_api_keys_exchange_not_user_writable.sql`.
- [ ] `160-CENSUS.md` scaffold (plan task 1) with the exact Q1/Q1b/Q2 SQL — orchestrator executes; committed with real numbers before the swap lands.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | **yes — the phase's core** | Table-grant withdrawal (`REVOKE INSERT`), SECURITY INVOKER scrub trigger, CHECK-enforced coupling; server-side writer binds identity from `withAuth` session (`userId` threaded, never a body field — route.ts:182-185 precedent) |
| V5 Input Validation | yes | `exchangeNormalized` chokepoint (route.ts:78); label length-cap at the persist arm; DB CHECK admits lowercase venue codes only |
| V6 Cryptography | yes (touch, don't change) | Existing Fernet envelope via Python `/encrypt-key`; persist mode STOPS returning ciphertext to the browser — never hand-roll any crypto here |
| V2/V3 Auth/Session | no new surface | `withAuth` unchanged |

### Known Threat Patterns for this change
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client forges venue at row creation (the RANK-03 threat itself) | Tampering | Server writes both columns from the value IT validated; REVOKE removes the client verb entirely |
| Ciphertext exposure in transit/DOM | Information Disclosure | persist arm omits ciphertext from the response |
| service_role trust ceiling | Elevation | UNCHANGED and must be stated honestly: any server route holding `createAdminClient()` can still pass any uid/venue — the standing ADR-0001/ADR-0003 boundary; "only our own server code can forge" is the ceiling, never claim "cannot be forged" `[VERIFIED: finalize-wizard/route.ts:1231-1238]` |
| Secrets in error paths | Information Disclosure | keep the `perRequestSecrets` scrub discipline (route.ts:401-409) on every new arm — the request body carries RAW key material |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- Next.js in this repo may differ from training data — consult `node_modules/next/dist/docs/` before route-API changes (route handlers here are standard `withAuth(async (req, user) …)` wrappers; no new Next surface is expected).
- Coverage is a blocking CI gate (lines 82 / stmts 80 / fns 74 / branches 72) — new route arms need tests, not just the oracle.
- DESIGN.md governs UI — this phase's component edits are behavior-only (remove inserts, consume id); no visual changes, so no DESIGN.md surface.
- Workflow (from memory ledger, binding): feature branch + `/ship`, never manual commits; edits → verify → commit as separate steps; one PR landed at a time; VERSION + package.json bump in the same commit; per-phase review = gsd-code-reviewer + gsd-verifier only; every bug found gets a regression test that fails without the fix; supabase/migrations merge to main AUTO-applies to PROD.

## Sources

### Primary (HIGH confidence — read this session, cited with line ranges)
- `supabase/migrations/20260811210000_api_keys_attested_venue.sql` (full read) — trigger, CHECK, backfill cutoff, census pin discipline
- `supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:1-90` — deploy-first/revoke-second rationale, DROP+CREATE hazard
- `supabase/migrations/20260810120000` (grants region), `20260410225608` (SELECT allowlist), `20260405061912:22` (RLS), `20260406065011:65` (sync_status default)
- `src/app/api/keys/validate-and-encrypt/route.ts` (full read); `src/app/api/strategies/finalize-wizard/route.ts:1150-1400` + `route.test.ts` asset_class describe; `src/app/api/strategies/create-with-key/route.ts` (stamp + RPC regions); `src/lib/closed-sets.ts:540-590`; `src/lib/constants.ts:170-171`
- `src/components/strategy/ApiKeyManager.tsx:190-385`, `src/components/strategy/StrategyForm.tsx:80-190`, `src/components/exchanges/AllocatorExchangeManager.tsx:580-610`
- Repo-wide greps for `.from("api_keys")` and `isCryptoExchange` (this session)
- `git log` on the two Phase-156 migrations (merge evidence)

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` §B (milestone-level, 2026-08-20) — B-1..B-4/B-M1/B-D1/B-D2 definitions; its site list and line coordinates re-verified at HEAD this session
- `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md` — artifact + orchestrator-execution pattern; `.planning/MILESTONES.md:264` — golden-parity precedent

### Tertiary
- None — no web fetches were needed; the phase installs zero packages and every load-bearing mechanism is in-repo and PROD-applied. (Configured search providers are all disabled in `.planning/config.json`; nothing external was consulted, so nothing is tagged from web sources.)

## Metadata

**Confidence breakdown:**
- Mechanism (writer, trigger survival path, REVOKE shape, guard/swap): HIGH — every discrete value quoted verbatim from source read this session; the one behavioral assumption (A1) has a planned CI-enforced discharge
- Architecture/sequencing: HIGH — replays a pattern already landed twice on PROD (156's two landings) with the direction-asymmetry rationale recorded in the migration itself
- Population sizing / blast radius: LOW until B-M1 — by design; the census is task 1 and gates the stamp swap

**Research date:** 2026-08-23
**Valid until:** the next commit that touches `api_keys` writers or `closed-sets.ts` — line coordinates are HEAD-of-2026-08-23 (`bf00ad0c`); re-grep before the REVOKE PR regardless.
