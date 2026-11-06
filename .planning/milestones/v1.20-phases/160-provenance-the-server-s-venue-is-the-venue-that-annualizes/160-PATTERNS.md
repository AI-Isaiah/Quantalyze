# Phase 160: PROVENANCE — Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 12 new/modified files
**Analogs found:** 12 / 12 (every file has an in-repo analog; several are self-analogs — the file being modified already contains the pattern to extend)

All excerpts verified at HEAD `bf00ad0c` this session. RESEARCH.md's line coordinates were re-confirmed for every load-bearing site.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/160-…/160-CENSUS.md` (NEW, PR-1 task 1) | census artifact | batch (read-only PROD SELECT) | `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md` | exact |
| `src/app/api/keys/validate-and-encrypt/route.ts` (MODIFY: persist arm) | route (API) | request-response + privileged CRUD write | self (legacy handler in same file) + `finalize-wizard/route.ts:1192` admin-client pattern | exact |
| `src/app/api/keys/validate-and-encrypt/route.test.ts` (MODIFY: persist-arm tests) | test | request-response | self (H-0281 harness, same file) | exact |
| `src/components/strategy/ApiKeyManager.tsx` (MODIFY: stop inserting, consume `api_key_id`) | component | request-response | self (`:220-277`) — the fetch→insert flow being converted | exact |
| `src/components/strategy/StrategyForm.tsx:140` (MODIFY: stop inserting) | component | request-response | `ApiKeyManager.tsx` conversion (same shape, no id captured today) | exact |
| `src/components/exchanges/AllocatorExchangeManager.tsx:590-606` (MODIFY: stop inserting; needs the row back) | component | request-response | self (`:560-611`) | exact |
| Component test specs for the three components (MODIFY) | test | request-response | existing specs beside each component (extend, do not create) | role-match |
| `src/app/api/strategies/finalize-wizard/route.ts` (MODIFY: stamp swap + guard extension) | route (API) | request-response + CRUD update | self (`:1246-1331`) — swap `apiKeyExchange`→`attestedVenue`, extend `skipAssetClassWrite` | exact |
| `src/app/api/strategies/finalize-wizard/route.test.ts` (MODIFY: B-D2 oracle) | test | request-response | self (`#597 asset_class persistence` describe, `:1394-1497`) | exact |
| `supabase/tests/test_api_keys_insert_not_client_writable.sql` (NEW, Wave-0 gap) | SQL gate (test) | batch | `supabase/tests/test_api_keys_exchange_not_user_writable.sql` | exact |
| `supabase/migrations/<PR-2>_revoke_api_keys_insert.sql` (NEW, PR-2 ONLY) | migration | batch | `supabase/migrations/20260810120000` (REVOKE shape) + `20260811210000` §5 (census-pin guard) | exact |
| `src/app/api/strategies/create-with-key/route.ts` | route | request-response | **NO CHANGE** — draft stamp already server-derived (`:1089` reads route-local `exchange`); the plan must state this explicitly (ARCHITECTURE.md B.3) | n/a |

## Pattern Assignments

### `160-CENSUS.md` (census artifact, orchestrator-executed)

**Analog:** `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md` — copy the structure verbatim.

**Header pattern** (159-CENSUS.md:1-6): artifact name, authored date (scaffold) vs executed-against-PROD date, and the PROD project-ref confirmation line:
```markdown
**Executed against PROD:** <date> (plan 160-01 Task N, orchestrator, read-only)
**PROD project ref (confirmed at execution):** `khslejtfbuezsmvmtsdn` (name `quantalyze`, ACTIVE_HEALTHY) — confirmed against the project list before any query ran; the TEST ref `qmnijlgmdhviwzwfyzlc` (`quantalyze-test`) was NOT used.
```

**PII rule pattern** (159-CENSUS.md:25-35) — copy the "Rule of this file: no PII, ever" section verbatim (repo is PUBLIC, `.planning/` tracked): counts, dates, strategy/key ids ONLY; "All queries below are read-only `SELECT`s… The orchestrator executes exactly the blocks on this page — nothing improvised."

**Query + results pattern** (159-CENSUS.md:51-80): each query in a fenced sql block ("Copied verbatim from 160-RESEARCH.md §Code Examples" — Q1/Q1b/Q2 are already written there), followed by a `### Results` markdown table and a bolded one-sentence interpretation. The B-D1 threshold and its mechanical decision go in a dedicated section, per the locked decision.

**Execution constraint:** Supabase MCP is orchestrator-only (stripped from subagents) — the census task must be an orchestrator task or explicit checkpoint, exactly as 159-CENSUS.md:5 records.

---

### `src/app/api/keys/validate-and-encrypt/route.ts` — the persist arm (RANK-03 writer)

**Analog 1 — request discrimination + handler dispatch (self, `route.ts:46-186`).** The POST handler already normalizes (`route.ts:78`) and dispatches to `legacyValidateAndEncryptHandler` with `userId` threaded from `withAuth` (never a body field — `route.ts:182-185`, the TS-04/SC7 precedent the persist arm must copy):
```ts
const exchangeNormalized = isSfox ? "sfox" : isMt5 ? "mt5" : exchange;
…
// TS-04 / SC7 — `userId` is threaded into the legacy handler (rather than
// re-derived inside it) so the tenant identity provably comes from THIS
// route's withAuth session and cannot drift to a body field.
return await legacyValidateAndEncryptHandler({ exchange: exchangeNormalized, api_key, api_secret: api_secret_normalized, passphrase, userId: user.id });
```
The skew discriminator (Pattern 2 in RESEARCH: `persist: true` in the body) branches HERE, after normalization, before the handler — old bodies must fall through to the legacy handler byte-unchanged.

**Analog 2 — error-envelope conventions (self, `route.ts:94-163, 319-416`).** Every arm returns `NextResponse.json({ error, code }, { status, headers: NO_STORE_HEADERS })` with a machine code from the SEAMUX-03 union (`KEY_INVALID_FORMAT` for request-shape rejections, `KEY_RATE_LIMIT`/`SEAM_MISCONFIGURED` on the limiter, `CIRCUIT_OPEN`/`UPSTREAM_TIMEOUT`/`UNKNOWN` on the typed catch arms). New persist-arm failures (e.g. the INSERT itself failing) reuse this envelope — curated copy, coded, never raw PG text (Pitfall 3).

**Analog 3 — secrets scrub on every new arm (self, `route.ts:395-409`).** The request body carries RAW key material; any new catch/log path must copy:
```ts
const perRequestSecrets = [api_key, api_secret, passphrase];
console.error("[keys/validate-and-encrypt] …", scrubSeamError(err, perRequestSecrets));
captureToSentry(err, { tags: { route: "api/keys/validate-and-encrypt" }, secrets: perRequestSecrets });
```

**Analog 4 — admin-client privileged write (`finalize-wizard/route.ts:1192-1196`).** The repo's established service-role write mechanism in the same route family:
```ts
const assetClassAdmin = createAdminClient();
const { count: assetClassMemberCount } = await assetClassAdmin
  .from("strategy_keys")
  .select("*", { count: "exact", head: true })
```
The persist arm does the same with `.from("api_keys").insert({ user_id: userId, exchange: exchangeNormalized, attested_venue: exchangeNormalized, label, …ciphertext fields, sync_status defaults via DDL }).select("id").single()`. Both venue columns MUST come from the ONE `exchangeNormalized` binding — the CHECK `attested_venue IS NULL OR attested_venue = exchange` (migration 20260811210000:294) enforces it; the scrub trigger admits `service_role` by name (`:534`) so the value survives.

**Response contract** (RESEARCH §Code Examples, locked shape): persist mode returns `{ api_key_id, valid: true, read_only: true }` and NO ciphertext; absent-discriminator mode returns today's envelope verbatim.

---

### The three component conversions (RANK-03 client side)

**Analog:** each component is its own analog — the conversion DELETES the `.from("api_keys").insert` block and consumes the route's `{ api_key_id }` (or re-fetches the row).

**`ApiKeyManager.tsx` — current shape to replace (`:230-277`).** The fetch→insert→link sequence; after conversion the fetch body gains the persist discriminator, the insert block (`:250-261`) is deleted, and the `strategies.api_key_id` link update SURVIVES with its NEW-C37-03 error surfacing:
```ts
// keeps: link + surfaced error (ApiKeyManager.tsx:269-277)
const { error: linkError } = await supabase
  .from("strategies")
  .update({ api_key_id: newKey.id })   // newKey.id → the route's api_key_id
  .eq("id", strategyId);
if (linkError) {
  throw new Error(`Failed to link key to strategy: ${linkError.message}`);
}
```
Also keep the background-sync HTTP-outcome observation below it (`:279+`, SEAMUX-05) unchanged. DELETE at `:352` stays — REVOKE is INSERT-only.

**`StrategyForm.tsx:140`** — same conversion, simpler: no id is captured today, so the component just stops inserting and sends `label` (default `` `${exchangeCanonical} key` ``) in the route body. StrategyForm already redacts errors (H-0405) — keep that arm.

**`AllocatorExchangeManager.tsx:560-611`** — ⚠️ the THIRD site CONTEXT.md missed. Its insert (`:590-606`) selects `API_KEY_USER_COLUMNS` back because the UI needs the full row for optimistic render (`:613-619`, `pending_insert` stamp). After conversion: either the persist arm returns the row, or the component re-fetches by `api_key_id` with `.select(API_KEY_USER_COLUMNS)` — the migration-027 SELECT allowlist covers every column in `API_KEY_USER_COLUMNS` (`src/lib/constants.ts:170-171`), so a re-fetch works. Its error handling is setState-based (`setFormError(...)`), not throw-based — match each component's own existing style.

---

### `finalize-wizard/route.ts` — stamp swap + guard extension (RANK-04)

**Analog:** self. The change is surgical inside `:1246-1331`.

**The read (unchanged, `:1248-1283`):** one query already selects both columns; `attestedVenue` is already bound with the ⛔ NEVER-`?? apiKeyExchange` rule (`:1274-1282`). The swap consumes this existing binding — zero new queries (SEAM_ROUTE_BUDGETS pin, `:1250-1253`).

**Guard today (`:1292`) → new guard (Pitfall 7: one binding, the attested one — attestation-null is a strict superset of lookup-fault):**
```ts
// today:
const skipAssetClassWrite = Boolean(apiKeyId) && apiKeyExchange === null;
// becomes:
const skipAssetClassWrite = Boolean(apiKeyId) && attestedVenue === null;
```
`apiKeyExchange` may survive only in the warn log ("venue resolved as X but unattested — skipping"); it must not feed the stamp.

**Stamp today (`:1319-1329`) → swap ONLY the branch input:**
```ts
.update({
  asset_class: apiKeyId
    ? isCryptoExchange(apiKeyExchange)   // ← becomes isCryptoExchange(attestedVenue)
      ? "crypto"
      : "traditional"
    : isCompositeForAssetClass
      ? "crypto"
      : fields.asset_class,
})
.eq("id", fields.strategy_id)
.eq("user_id", user.id);
```
Composite/CSV arms unchanged. The non-blocking error handling below (`:1332-1339`, `console.warn` + `captureToSentry({ level: "warning" })`) stays.

**⛔ Pragma window (Pitfall 4, `:1311-1318`):** the `@audit-skip` pragma must stay within 8 lines of `.update(` — `audit-coverage.test.ts` scans that window. New commentary goes ABOVE the pragma. The stale OQ-2 "ONE-IDENTIFIER change" comment block (`:1299-1309`) is rewritten by the swap commit (RESEARCH flags it as measured-wrong framing).

**The trap being guarded (`src/lib/closed-sets.ts:569-574`):**
```ts
export function isCryptoExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;   // ← null ⇒ "traditional" ⇒ √252: the silent money bug
  return (CRYPTO_EXCHANGES as readonly string[]).includes(exchange.toLowerCase());
}
```

---

### `finalize-wizard/route.test.ts` — B-D2 oracle

**Analog:** self — the `#597 asset_class persistence` describe (`:1394-1497`). Extend it; the harness already exists (`STATE.strategyRow`, `STATE.adminApiKeysExchange`, `STATE.adminApiKeysSelectError`, `STATE.assetClassUpdates`, `okProbe()` fetch spy, `importPost()`).

**The exact fixture pattern to copy — the existing fault-arm test (`:1463-1478`) is the closest template for the new NULL-attestation SKIP oracle:**
```ts
it("does NOT overwrite asset_class to 'traditional' when the single-key venue lookup faults", async () => {
  const fetchSpy = okProbe();
  STATE.strategyRow = { api_key_id: API_KEY_ID };
  STATE.adminApiKeysExchange = "bybit";                       // the key IS a crypto venue…
  STATE.adminApiKeysSelectError = { message: "transient PG blip" };
  const POST = await importPost();
  const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
  expect(res.status).toBe(200);
  expect(STATE.assetClassUpdates).not.toContainEqual({ asset_class: "traditional" });
  expect(STATE.assetClassUpdates).toHaveLength(0);            // ← the economics: no update captured
  fetchSpy.mockRestore();
});
```
New oracles pin LITERAL outcomes against fixtures (Pitfall 8 — never re-compute the implementation's own expression): the harness needs an `adminApiKeysAttestedVenue` (or equivalent) fixture knob; then: attested `deribit` ⇒ `toContainEqual({ asset_class: "crypto" })`; attested `mt5` ⇒ `{ asset_class: "traditional" }`; attestation NULL with exchange RESOLVED (`adminApiKeysExchange: "bybit"`, attestation fixture null) ⇒ `toHaveLength(0)`. The existing fault-arm test above must stay green (fault ⇒ both null ⇒ still SKIP). Each new oracle must be observed RED under a neuter (guard reverted to `apiKeyExchange === null`, or swap reverted) — founder anti-vacuity rule, recorded in SUMMARY.

**Comment style:** every `it` carries a prose block naming WHY the behavior matters economically and what revert reddens it (see `:1404-1406`, `:1455-1462`).

---

### `route.test.ts` extension for validate-and-encrypt (persist-arm tests)

**Analog:** self — the H-0281 harness (`route.test.ts:1-90`).

**Harness pattern (`:38-82`):** `vi.hoisted` for shared mocks; `vi.mock("server-only", () => ({}))`; `@/lib/supabase/server` stubbed to return an authenticated `TEST_USER`; `@/lib/ratelimit` EXTENDED-not-replaced via `importActual` (pure helpers real, `checkLimit` stubbed); `@/lib/analytics-client` mocked wholesale with real-shape error classes. The persist-arm tests add a `createAdminClient` mock (mirror the finalize-wizard test's STATE-capture idiom: record the `.insert(...)` payload, assert `exchange === attested_venue === exchangeNormalized` and that the response carries `api_key_id` and NO ciphertext; legacy body ⇒ byte-identical old envelope).

---

### `supabase/tests/test_api_keys_insert_not_client_writable.sql` (NEW)

**Analog:** `supabase/tests/test_api_keys_exchange_not_user_writable.sql` — copy its structure wholesale. It is the exact same table, the exact same discipline, one verb over.

**Structural elements to copy:**
1. **Header essay** (`:1-129`): background, numbered asserted invariants, gate-choice rationale, "Run with `psql -v ON_ERROR_STOP=1`. CI auto-discovers supabase/tests/test_*.sql", `BEGIN; … ROLLBACK;` whole-file rollback.
2. **Fixture seeding as owner role** (`:172-183`): `auth.users` + `profiles` + `api_keys` rows with `gen_random_uuid()` ids, then JWT forgery + role switch:
```sql
PERFORM set_config('request.jwt.claims',
                   json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                   true);
SET LOCAL ROLE authenticated;
… ; RESET ROLE;
```
3. **Anti-vacuity positive controls run UNCONDITIONALLY** (`:192-201`, `:270-284`): owner can still SELECT own row; owner can still DELETE own row (assertion 4 there is EXACTLY the post-REVOKE DELETE-retained assertion this phase needs — reuse its wording).
4. **The A1 gate — service_role INSERT retains attestation** (armable immediately, no state gate needed): model on assertion 5b (`:409-423`) — privileged INSERT with `attested_venue` supplied, read back, `RAISE EXCEPTION` if scrubbed. Include the 5e-style divergence check reference only if not duplicating (5e already covers the CHECK; don't re-assert it here — cite the sibling file instead).
5. **State-adaptive negative — authenticated INSERT denied** (Pitfall 11): gate on the PR-2 migration's own COLUMN-COMMENT MARKER, the measured idiom (`:208-217`):
```sql
SELECT COALESCE(
  col_description('public.api_keys'::regclass,
    (SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.api_keys'::regclass
        AND attname = 'exchange' AND NOT attisdropped)
  ) LIKE '%<PR-2 migration id>%', false) INTO v_fix_live;
```
(The PR-2 migration must therefore stamp/re-stamp a column comment carrying its id AND preserve every older substring — assertions 5a/5a′ in the analog exist because a re-stamp once dropped one.) Pre-REVOKE: loud `RAISE NOTICE 'SKIP …'`. Armed: refusal asserted TWO ways — SQLSTATE `42501` exactly, and no row minted (`count(*)` before/after), per the 5d three-part idiom (`:510-559`).

---

### PR-2 REVOKE migration (NEW, second PR ONLY)

**Analog 1 — the verb withdrawal (`supabase/migrations/20260810120000_lock_api_keys_exchange_column.sql:104`):**
```sql
REVOKE UPDATE ON public.api_keys FROM anon, authenticated;
-- becomes: REVOKE INSERT ON public.api_keys FROM anon, authenticated;
```
DELETE untouched (live client path, `ApiKeyManager.tsx:352`). RLS `api_keys_owner FOR ALL` (20260405061912:22) untouched — grants are the lever, not RLS.

**Analog 2 — census-pin guard (`supabase/migrations/20260811210000:590-674`).** Hand-typed CONSTANT pins + PROD-signature discriminator + abort-on-drift:
```sql
c_pin_total CONSTANT INT    := 29;
c_pin_mt5   CONSTANT INT    := 2;
c_pin_dates CONSTANT DATE[] := ARRAY[DATE '2026-08-04'];
```
⚠️ Copy the two-tier teeth split verbatim (Pitfall 9 / `:660-666`): the ENFORCED pin is the un-attested count (the population whose drift changes the decision); TOTAL row count is REPORTED as a delta, NEVER enforced (`api_keys` is live and user-mutable — pinning it is the latent-outage shape that migration explicitly walked back). Constants are hand-typed from `160-CENSUS.md` at landing; on drift, re-measure and re-cut, never soften.

**Post-verify pattern:** ABORTING checks — `has_table_privilege('authenticated','public.api_keys','INSERT')` false; `'DELETE'` true; spot-check `has_column_privilege` on the SELECT allowlist; column-comment marker stamped preserving older ids (20260810120000, 20260811210000, 20260814120000 substrings — the SQL-gate arming chain depends on it).

**Anti-patterns:** never edit applied migrations (new files only); never DROP+CREATE any function (pg_default_acl re-grants PUBLIC — 20260813150106:72-76); never migration-first (merge = PROD apply; 20260813150106:22-30 records the direction asymmetry).

## Shared Patterns

### Service-role privileged write
**Source:** `createAdminClient()` usage at `finalize-wizard/route.ts:1192`; scrub-trigger allowlist `20260811210000:534` (`IF current_user IN ('postgres','service_role','supabase_admin')`); coupling CHECK `:294`.
**Apply to:** the persist arm. Both venue columns from ONE binding; state the trust ceiling honestly ("only our own server code can forge" — ADR-0001/0003, never "cannot be forged"; wording template at `finalize-wizard/route.ts:1231-1238`).

### Coded error envelopes + NO_STORE_HEADERS
**Source:** `validate-and-encrypt/route.ts` throughout.
**Apply to:** every new persist-arm response and error path. `{ error, code }` with a stable machine code; never raw PG/SQLSTATE text to the UI.

### Secrets scrub
**Source:** `validate-and-encrypt/route.ts:395-409` (`perRequestSecrets` + `scrubSeamError` + `captureToSentry({ secrets })`).
**Apply to:** every new arm in that route — the body carries raw key material.

### Anti-vacuity test discipline
**Source:** SQL gate assertion 1/4/5b positives; route-test RED-observation notes.
**Apply to:** all new tests — positives run unconditionally; negatives assert the refusal REASON (exact SQLSTATE) and the unchanged state; every new oracle observed RED under a neuter before restore.

### State-adaptive SQL gate (column-comment marker)
**Source:** `test_api_keys_exchange_not_user_writable.sql:203-217, 266-268` + the 5a/5a′/5a″ marker-durability cross-checks.
**Apply to:** the new SQL gate's post-REVOKE assertions (loud SKIP pre-migration, hard fail after).

### Count-pinned census with report-vs-enforce split
**Source:** `20260811210000:590-674` + `159-CENSUS.md` artifact shape.
**Apply to:** `160-CENSUS.md` and the PR-2 guard.

## No Analog Found

None. Every file has a direct in-repo analog; the two genuinely NEW files (SQL gate, REVOKE migration) each have a same-table, same-mechanism template.

## Explicit Non-Changes (planner must state these)

| File | Why untouched |
|------|---------------|
| `src/app/api/strategies/create-with-key/route.ts:1089` | Draft stamp already reads route-local `exchange` from the same validated request — server-derived. ARCHITECTURE.md B.3 asks for this confirmation in the plan. |
| `ApiKeyManager.tsx:352` DELETE | Locked: REVOKE INSERT only; DELETE stays client-side (SQL-gate assertion 4 is its canary). |
| RLS policies, scrub trigger, coupling CHECK | Existing enforcement — the phase moves writers, never the mechanisms. |
| Analytics worker (Python) | Reads `strategies.asset_class` directly as the clock; no Python change expected. |

## Metadata

**Analog search scope:** `src/app/api/keys/**`, `src/app/api/strategies/**`, `src/components/strategy/**`, `src/components/exchanges/**`, `src/lib/closed-sets.ts`, `supabase/tests/**`, `supabase/migrations/**`, `.planning/phases/159-*/`
**Files read this session:** 8 (validate-and-encrypt route + test, finalize-wizard route region + test region, ApiKeyManager region, AllocatorExchangeManager region, SQL gate model, 159-CENSUS header) — plus RESEARCH.md's HEAD-verified excerpts for the migrations
**Pattern extraction date:** 2026-08-23
