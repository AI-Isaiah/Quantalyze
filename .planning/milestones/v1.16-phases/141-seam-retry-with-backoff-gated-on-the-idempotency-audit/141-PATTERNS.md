# Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit - Pattern Map

**Mapped:** 2026-07-31
**Files analyzed:** 9 (1 new registry, 4 modified prod, 4 new/extended tests) + 2 test-pin edits
**Analogs found:** 9 / 9 (every file has a strong in-repo analog; only the retry-loop-with-jitter primitive is partly novel — see No Analog Found)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/seam-retry-registry.ts` **(NEW)** | config / const-registry leaf | transform / lookup | `src/lib/process-key-onboard-contract.ts` + `src/lib/seam-discriminator.ts` | exact (leaf convention) |
| `src/lib/resilient-fetch.ts` **(MODIFY: retry loop + `retriesOverride`)** | service / transport | request-response | itself — the `timeoutMsOverride` escape hatch + `isBreakerOpen` gate + `BREAKER_STORE_*` retry config | exact (self-precedent) |
| `src/lib/resilient-fetch.ts` **(MODIFY: `SEAM_BUDGETS[*].retries` flips)** | config const-map | — | the existing `retries: SEAM_RETRIES` rows in the same table | exact |
| `src/lib/process-key-client.ts` **(MODIFY: consult registry by `flow_type`)** | controller / seam client | request-response | itself — `budgetKeyFor` + the `resilientFetch(budgetKey, …)` init at `:400-433` | exact |
| `src/lib/analytics-client.ts` **(MODIFY: consult registry by `budgetKey`)** | controller / seam client | request-response | itself — `analyticsRequest` budget resolution `:344` + `resilientFetch` init `:407-419` | exact |
| `analytics-service/routers/process_key.py` **(MODIFY: resync draft-SV dedup)** | controller / service | CRUD (dedup insert) | the onboard `idempotent_by_session` SELECT-pre-check `:1351-1396` in the same file | exact (same file, same effect) |
| `src/lib/seam-constants.pin.test.ts` **(MODIFY: two negative pins)** | test | — | the two `retries===0` pins at `:283-296` and `:339-350` (edit-in-place) | exact |
| `src/lib/seam-retry-registry.test.ts` **(NEW, SC1)** | test | — | `src/lib/seam-discriminator.purity.test.ts` + `seam-constants.pin.test.ts` | exact |
| `src/lib/resilient-fetch.retry.test.ts` **(NEW, SC2 mechanics + SC4)** | test | — | `src/lib/resilient-fetch.test.ts` (fetch mock + `seedBreakerOpen` + fake timers) | exact |
| `supabase/tests/test_resync_retry_single_job.sql` **(NEW, SC2 DB proof)** | test (SQL gate) | — | `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql` | exact |
| `analytics-service/tests/test_teaser_non_idempotent.py` **(NEW, SC3 DB pin)** | test (pytest) | — | `analytics-service/tests/test_process_key.py` + the SQL fence pattern | exact |
| `src/lib/seam-budgets.invariant.test.ts` **(VERIFY, likely no code change)** | test (invariant) | — | itself — already reads `SEAM_BUDGETS[b.key].retries` (`:631`) | self |

---

## ⚠️ Instance-not-class enumeration (READ FIRST)

The prior phase's skipped pattern-map produced an instance-not-class defect that scrapped 37 fix commits (MEMORY: `feedback_always_run_pattern_mapper_and_researcher`). Phase 141 touches **five classes of call sites**. Every member of each class is named here — the planner must address ALL members per class, not the first.

### Class A — the retry-override consultation (N = 2 seam clients)
The registry decision is keyed at the layer that knows the discriminator, NOT in `resilientFetch` (which sees only `budgetKey`, many-to-one over flow_types). BOTH clients must consult a registry and pass `retriesOverride`:
1. `src/lib/process-key-client.ts::postProcessKey` — keys on **`args.flow_type`** via `RETRY_SAFE_FLOW_TYPES`. (budgetKey would retry `teaser` — SC3 violation.)
2. `src/lib/analytics-client.ts::analyticsRequest` — keys on **`options.budgetKey`** (1:1) via `RETRY_SAFE_ANALYTICS`.

Missing either = a whole seam silently never retries (or, for process-key, retries the wrong flow).

### Class B — `SEAM_BUDGETS` rows flipped to `retries: 1` (N = 5 rows)
In `src/lib/resilient-fetch.ts` `SEAM_BUDGETS` (`:423-565`). RESEARCH primary recommendation = flip the ROW for 1:1 allowlisted budgets so SC-4b stays honest. The five allowlisted rows:
1. `process-key-enqueue` (`:504-510`) — serves onboard + resync, both job-idempotent.
2. `bridge` (`:448-454`) — pure compute.
3. `simulator` (`:455-461`) — pure compute.
4. `portfolio-optimizer` (`:462-468`) — pure compute.
5. `optimize-weights` (`:469-474`) — pure compute.

**Rows that MUST stay `retries: SEAM_RETRIES` (0)** — naming them is the belt: `validate-key`, `encrypt-key`, `match-eval`, `match-recompute`, `portfolio-analytics`, **`process-key-sync`** (teaser+csv — the SC3 landmine), `keys-permissions` (fan-out breach — Pitfall 2), `process-key-unified-dormant`.
Note: the shared seed `export const SEAM_RETRIES = 0` (`:252`) stays 0 — only the five rows carry a literal `1`.

### Class C — the negative pins to edit in the SAME commit (N = 2)
In `src/lib/seam-constants.pin.test.ts`. RESEARCH §"The Typed Registry — consistency with SC-4b" and Q4 non-vacuity guard: these are intended tripwires — EDIT deliberately, never delete:
1. `:283-296` — `it.each(Object.keys(EXPECTED_DEPENDENCIES))("%s.retries is 0 — the per-row NEGATIVE pin")`. Must move the five flipped rows to expect `1` (others still `0`).
2. `:339-350` — `it("SEAM_RETRIES is 0 …")`. The seed stays 0, so this pin likely stays — but re-read it against whatever design the planner picks; if any code path reads `SEAM_RETRIES` directly for an allowlisted route the pin must move.

### Class D — the recording sites the retry loop wraps (N = 3, inside `resilientFetch`)
The loop re-issues around all three and must preserve failure-classification/breaker semantics:
1. the `fetch(…)` call `:1914-1925`;
2. the transport catch `:1926-1973` (`seamBreakerVerdict(null)` → `recordOnce`);
3. the status/body verdict `:1998-2001` (`seamBreakerVerdict(res.status, …)` → `recordOnce`).
⚠️ The `recordOnce` latch (`:1882-1887`) currently caps ONE recorded failure per `resilientFetch` call. With a retry each attempt's counting failure should advance the breaker — the planner must decide whether the latch resets per attempt (recommended: yes, so two transient failures count twice) without double-counting a single attempt's status+body arms. This is the sharpest mechanics landmine.

### Class E — analytics wrappers inheriting the decision (N = 9 wrappers, 4 benefit)
`analyticsRequest` is the ONE chokepoint (like `tenantId` was — see its `:324-336` docblock warning about "a tenth wrapper added with no identity"). All nine wrappers route through it, so consulting the registry there covers every current and future wrapper. The four that become retry-eligible: `findReplacementCandidates`(bridge, `:774`), `simulateAddCandidate`(simulator, `:800`), `runPortfolioOptimizer`(portfolio-optimizer, `:759`), `optimizeScenarioWeights`(optimize-weights, `:712`). The five that stay no-retry by registry absence: `validateKey`, `encryptKey`, `computePortfolioAnalytics` (zero callers), `recomputeMatch`, `evalMatch`.

---

## Pattern Assignments

### `src/lib/seam-retry-registry.ts` (NEW — config / const-registry leaf) — SC1 SEAM-05

**Analog 1 (leaf convention & contract):** `src/lib/process-key-onboard-contract.ts`
**Analog 2 (frozen closed-vocab const-map + `Partial<Record>` semantics):** `src/lib/seam-discriminator.ts`
**Analog 3 (per-row metadata const-map):** `SEAM_BUDGETS` in `src/lib/resilient-fetch.ts:413-565`

**Leaf-purity docblock to copy** (`process-key-onboard-contract.ts:1-31`) — zero imports, zero env, zero module-load side effects, ONE implementation, callable from a test with no mocks. Same two forcing constraints as `seam-errors.ts` / `seam-discriminator.ts`: (1) browser-bundle reachability via `"use client"` wizard components, (2) survival under the ~16 wholesale seam-client mocks. State both.

**Shape (from RESEARCH Q3 — a `Partial<Record>` so ABSENCE ⇒ no-retry by construction):**
```typescript
// Key at TWO grains: process-key seam by FlowType (budgetKey is many-to-one),
// analytics seam by SeamBudgetKey (1:1 with the wrapper).
export interface RetrySafeEntry {
  readonly retries: 1;        // exactly one, locked
  readonly evidence: string;  // traced server-side proof = the committed SC1 audit text
}
export const RETRY_SAFE_FLOW_TYPES: Partial<Record<FlowType, RetrySafeEntry>> = {
  onboard: { retries: 1, evidence: "…strategy_verifications_strategy_wizard_session_uniq + compute_jobs_one_inflight_per_kind_strategy (process_key.py:643-714)." },
  resync:  { retries: 1, evidence: "compute job deduped on (strategy_id,kind); KNOWN tolerated secondary effect: duplicate DRAFT SV row (process_key.py:1018) — NOW deduped by this phase." },
  // teaser: ABSENT — process_key.py:936-938 mints fresh uuid4; SC3 pins the absence.
  // csv:    ABSENT — validate side-effect-free but shares budget row with teaser.
};
export const RETRY_SAFE_ANALYTICS: Partial<Record<SeamBudgetKey, RetrySafeEntry>> = {
  bridge: {…}, simulator: {…}, "portfolio-optimizer": {…}, "optimize-weights": {…},
};
```

**Type-import note:** `FlowType` is exported from `process-key-client.ts:51`; `SeamBudgetKey` from `resilient-fetch.ts:316`. A leaf importing `resilient-fetch.ts` VALUE breaks purity — import both as **`import type`** only (type imports are erased and do not pull the module into the bundle). Confirm this keeps the purity test green, mirroring how `seam-discriminator.ts` hand-duplicates the vocabulary rather than importing the core (`:46-56`).

**"Frozen closed vocabulary" precedent** (`seam-discriminator.ts:75-80`): `Object.freeze([...])` so a consumer cannot mutate the allowlist at runtime. Apply if the registry exposes any array.

---

### `src/lib/resilient-fetch.ts` — the retry loop + `retriesOverride` (MODIFY — service / transport) — SC2/SC4 SEAM-06

**Analog (self — the `timeoutMsOverride` escape hatch):** `ResilientFetchInit` at `:1418-1426`.
Add a sibling optional field, exactly mirroring the existing one:
```typescript
export type ResilientFetchInit = Omit<RequestInit, "signal"> & {
  timeoutMsOverride?: number;
  retriesOverride?: number;   // NEW — resolved as init.retriesOverride ?? SEAM_BUDGETS[budgetKey].retries
};
```
**Resolution pattern to copy** (`:1801-1821`): the same **VALUE check, not `"key" in init`** rule (ME-03, `:1790-1800`) — under this repo's tsconfig an explicit `undefined` is type-identical to absent, so a `retriesOverride !== undefined` guard with bounds-validation + `throw new SeamConfigError` on an invalid value, then `const retries = retriesOverride ?? SEAM_BUDGETS[budgetKey].retries;`.

**Breaker gate to re-use for the SC4 pre-attempt-2 re-check** (`:1853-1856`):
```typescript
const breaker = await isBreakerOpen(budgetKey);
if (breaker.open) throw new CircuitOpenError(breaker.retryAfterS ?? DEFAULT_RETRY_AFTER_S);
```
SC4 requires this exact check ALSO fire before the second attempt — if the breaker tripped between attempts, the retry throws `CircuitOpenError` rather than firing. `CircuitOpenError` must NEVER be caught-and-retried by the loop (Pitfall 4).

**Retry-eligibility class to copy (which failures to re-issue):** only the COUNTING/transient classes `seamBreakerVerdict` already identifies — transport throw / deadline (`:1926-1973`), 503, other-5xx (`:1998-2001`). NEVER retry a 4xx, a `SeamConfigError` (raised above the window, `:1801-1851`), or a `CircuitOpenError`. Branch using the existing `isDeadlineError` helper and `verdict.counts`.

**In-repo precedent for "1 retry, FIXED backoff, declared-not-defaulted":** the breaker STORE's own config at `:288-309`:
```typescript
export const BREAKER_STORE_RETRIES = 1;      // one, not the SDK's five
export const BREAKER_STORE_BACKOFF_MS = 250; // FIXED not exponential — SC-4b needs one stateable number
```
The docblock's rationale ("a constant is the property SC-4b needs", `:301-309`) applies verbatim to the seam retry backoff. **Jitter has NO in-repo analog** — see No Analog Found.

**SC-4b honesty:** the invariant at `seam-budgets.invariant.test.ts:631` already computes `timeoutMs × calls × (1 + SEAM_BUDGETS[b.key].retries)` reading the ROW — so flipping a row automatically tightens the headroom check. If the planner instead uses `retriesOverride` while leaving rows at 0, the invariant UNDER-states and must be reworked (RESEARCH strongly recommends flipping the row).

---

### `src/lib/process-key-client.ts` — consult registry by `flow_type` (MODIFY — controller / seam client)

**Analog (self):** the budget resolution + the `resilientFetch` init object it already builds.
- `budgetKeyFor(args.flow_type)` and `const budgetKey = budgetKeyFor(args.flow_type)` at `:64-68` / `:322` — the existing flow_type→config mapping to sit the registry lookup beside.
- The `resilientFetch(budgetKey, "/process-key", { … })` init at `:400-433` — add `retriesOverride: RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries` here (the `?? 0` falls out of the `Partial<Record>` absence). Import the registry (a leaf, mock-safe).

**Critical:** decision keys on `args.flow_type`, NEVER `budgetKey` — `budgetKeyFor` collapses teaser+csv onto `process-key-sync` (`:65-67`) and a budgetKey-keyed retry would replay `teaser` (SC3 violation, Pitfall 1). The docblock at `:53-68` already explains the many-to-one; extend that reasoning to the retry decision.

---

### `src/lib/analytics-client.ts` — consult registry by `budgetKey` (MODIFY — controller / seam client)

**Analog (self):** `analyticsRequest` at `:318-341`.
- Budget resolution at `:344`: `const timeoutMs = options.timeoutMs ?? SEAM_BUDGETS[options.budgetKey].timeoutMs;` — sit the registry lookup beside it: `const retries = RETRY_SAFE_ANALYTICS[options.budgetKey]?.retries;`.
- The `resilientFetch(options.budgetKey, path, { … timeoutMsOverride: options.timeoutMs })` call at `:407-419` — add `retriesOverride: retries`.

**Centralization mandate** (`:324-336` `tenantId` docblock): making the decision in `analyticsRequest` (not per-wrapper) is exactly the pattern that closed the "tenth wrapper added with no identity" instance-not-class defect. All nine wrappers inherit the decision; the four allowlisted budgets get `retries: 1` via their `RETRY_SAFE_ANALYTICS` entry, the five absent ones get `undefined → 0`.

---

### `analytics-service/routers/process_key.py` — resync draft-SV dedup (MODIFY — controller / service, CRUD) — SC2

**Analog (same file, the onboard idempotency path resync must mirror):** `:1335-1396`.
Today `idempotent_by_session` (`:1033-1035`) is `flow_type != "teaser" and bool(context.get("wizard_session_id"))` — resync mints a fresh uuid4 (`:1018`), so it is `False` and SKIPS the SELECT-pre-check, minting a duplicate DRAFT `strategy_verifications` row on a retry.

**The pre-check to mirror** (`:1351-1396`): SELECT on `strategy_verifications` scoped by a STABLE key, and on a hit route to `_resume_duplicate_job` + `_wizard_duplicate_reply`. For onboard the key is `(strategy_id, wizard_session_id)`. **resync has no stable wizard_session_id**, so its dedup key must be resync's own stable identity — e.g. `(strategy_id, flow_type='resync')` restricted to NON-terminal / `draft` status (mirroring the compute_jobs dedup window in `test_enqueue_compute_job_dedupe_non_terminal.sql`, which dedups on non-terminal statuses only). The draft INSERT at `:1399-1415` is the write to guard; it already has a 23505 TOCTOU catch at `:1416+` (mirror the onboard race-loser recovery).

**Do NOT change teaser** (`:936-938`) — its non-idempotency is deliberate and SC3 depends on it. Keep `idempotent_by_session` excluding teaser. Surface RESEARCH's landmine (Pitfall 3 / assumption A2): SC2 measures ONE **compute_job**, not one SV row — the phase makes the SV row single too, but the assertion of record is against the job.

**Migration check:** RESEARCH "Runtime State Inventory" says NO new migration — the dedup keys on existing columns (`strategy_id`, `flow_type`, `status`) via an application-level SELECT-then-INSERT, not a new unique index. If the planner wants a DB-enforced fence instead, that is a migration and a scope decision to flag.

---

### Test files

**`src/lib/seam-retry-registry.test.ts` (NEW — SC1 SEAM-05)**
Analog: `src/lib/seam-discriminator.purity.test.ts` (the `EXPECTED_EXPORTS` surface pin + zero-import purity assertion) and `seam-constants.pin.test.ts` (hand-typed literal pins). Assert: `teaser`/`csv` ABSENT from `RETRY_SAFE_FLOW_TYPES` (the SC3 belt); each present entry has `retries === 1` and a non-empty `evidence` string; `RETRY_SAFE_ANALYTICS` keys are a subset of allowlisted `SEAM_BUDGETS` rows carrying `retries: 1` (the consistency pin from RESEARCH Q3). Purity: no imports beyond `import type`.

**`src/lib/resilient-fetch.retry.test.ts` (NEW — SC2 mechanics + SC4)**
Analog: `src/lib/resilient-fetch.test.ts`. Copy its harness verbatim:
- `vi.mock("@upstash/redis", …)` + `fakeRedisFor` / `fakeRatelimitFor` (`:281-352`) and `seedBreakerOpen(shared.store, "breaker:railway", n)` (`:597`, imported from `@/test/helpers/upstash-breaker`).
- The fetch mock pattern using **`mockImplementation` not `mockResolvedValue`** because a `Response` body is one-shot (`:422` note) — for SC2 inject a single transient rejection then a success (`mockRejectedValueOnce`→resolve).
- ⚠️ MEMORY `reference_ci_node22_vs_local_node25`: leaked `vi.stubGlobal("fetch")` is this repo's CI-only Node-22 flake — use `vi.spyOn` + `restoreAllMocks` (the file header at `:44` flags exactly this).
- Assertions: allowlisted budget → exactly 2 `fetch` calls; non-allowlisted → exactly 1; fixed-backoff+jitter delay observed via **fake timers**; SC4 — `seedBreakerOpen` → 0 `fetch` calls + `CircuitOpenError`, and breaker-tripped-between-attempts → retry throws `CircuitOpenError` (0 second fetch).

**`supabase/tests/test_resync_retry_single_job.sql` (NEW — SC2 DB proof, against the REAL index)**
Analog: `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql` (read in full). Copy the entire skeleton: plain PL/pgSQL `DO $$ … $$` with `RAISE EXCEPTION` on failure (pgTAP is NOT installed — CLAUDE.md); literal fixture ids; **every count scoped to the literal fixture strategy id, NEVER a global count** (shared test DB); expected values as literals (`1`, not read back from the RPC); `SET LOCAL ROLE service_role` to mirror the real caller; defensive pre-clean + `BEGIN … ROLLBACK`; `test_*.sql` filename so CI `sql-tests` (`.github/workflows/ci.yml:692-838`, `psql -v ON_ERROR_STOP=1`) auto-discovers it. Assert: two resync submissions for one strategy → exactly ONE non-terminal `compute_jobs` row (job kind `process_key_long`, `:92`) AND — after the dedup fix — exactly ONE draft `strategy_verifications` row. Comment WHY the job is the money-bearing effect.

**`analytics-service/tests/test_teaser_non_idempotent.py` (NEW — SC3 DB pin, real, not a mock tautology)**
Analog: `analytics-service/tests/test_process_key.py` (TestClient-driven `/process-key` calls) + the SQL fence's row-count discipline. CONTEXT `<specifics>` requires a real DB-observing test: two identical `flow_type=teaser` submissions → TWO `strategy_verifications` rows (distinct fresh uuid4 session ids, proving `:936-938` genuine non-idempotency). This makes the TS no-retry rule load-bearing rather than decorative. Prefer a `.sql` gate or a pytest against the test Supabase project — per MEMORY `*_live.py` do NOT run in CI.

**`src/lib/seam-constants.pin.test.ts` (MODIFY — Class C above)** — edit the two negative pins in the SAME commit as the row flips, or CI reddens (this is the intended tripwire, `:286-294`).

**`src/lib/seam-budgets.invariant.test.ts` (VERIFY — likely no code change)**
Already models the retry cost (`:631` reads `SEAM_BUDGETS[b.key].retries`). Flipping the five rows auto-tightens it. Verify each flipped route still clears its on-disk `maxDuration` (keys/sync at retries=1 ≈ 42,750ms vs 300k ceiling per RESEARCH). NEVER allowlist `keys-permissions` — the header at `:94-95` warns finalize-wizard's composite breaches at retries=1 (Pitfall 2).

---

## Shared Patterns

### Dependency-free leaf (applies to the NEW registry)
**Source:** `src/lib/process-key-onboard-contract.ts:1-31`, `src/lib/seam-errors.ts:1-35`, `src/lib/seam-discriminator.ts:1-44`
Zero imports (or `import type` only), zero env reads, zero module-load side effects. Forced by (1) browser-bundle reachability from `"use client"` wizard components, (2) survival under the ~16 wholesale seam-client mocks. Pin the export surface in the `.test.ts` (`EXPECTED_EXPORTS` pattern).

### Config escape-hatch on `ResilientFetchInit`
**Source:** `resilient-fetch.ts:1418-1426` (`timeoutMsOverride`) + entry-validation `:1801-1821`
**Apply to:** the new `retriesOverride`. Same VALUE-check-not-presence-check rule (ME-03), same `?? SEAM_BUDGETS[budgetKey].<field>` fallback, same `SeamConfigError`-with-log on invalid input.

### Breaker gate BEFORE any I/O (SC4)
**Source:** `resilient-fetch.ts:1853-1856` (`isBreakerOpen` → `throw CircuitOpenError`)
**Apply to:** the pre-attempt-2 re-check. `CircuitOpenError` is caught-first by both clients (`process-key-client.ts:441-462`) and must never be swallowed by the retry loop.

### DB-observing row-count test (NOT a mock tautology)
**Source:** `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql`
**Apply to:** SC2 (`test_resync_retry_single_job.sql`) and SC3 (`test_teaser_non_idempotent.py`). Literal-scoped counts, literal expected values, `BEGIN…ROLLBACK`, service-role context, `test_*.sql`/pytest CI auto-discovery.

### Failure classification reuse
**Source:** `src/lib/seam-discriminator.ts::seamBreakerVerdict` (`:421-510`) + `seam-errors.ts` (`CircuitOpenError`, `SeamBodyReadError`)
**Apply to:** the retry loop's "which failures re-issue" branch — retry only `verdict.counts` transient classes; never `SeamConfigError` / `CircuitOpenError` / 4xx.

---

## No Analog Found

| File / primitive | Role | Data Flow | Reason |
|------------------|------|-----------|--------|
| the **jitter** in the retry backoff | utility | — | No in-repo retry uses jitter. `BREAKER_STORE_BACKOFF_MS` (`resilient-fetch.ts:309`) is FIXED, no jitter. The Upstash SDK's `Math.exp(i)*50` (`:261-263`) is exponential-no-jitter and is described as the anti-pattern. Planner picks the jitter form (e.g. fixed base + `Math.random()` bounded add); it must remain stateable enough for SC-4b (bound the max jitter and charge the max in the invariant). Not a blocker — the retry LOOP structure (1 attempt, fixed backoff, declared constants) has a strong analog in `BREAKER_STORE_RETRIES`/`BREAKER_STORE_BACKOFF_MS`. |

Everything else has a concrete in-repo analog.

---

## Metadata

**Analog search scope:** `src/lib/` (seam infrastructure — resilient-fetch, both clients, discriminator, errors, onboard-contract, budgets/constants tests, upstash-breaker helper), `analytics-service/routers/process_key.py`, `analytics-service/tests/`, `supabase/tests/`.
**Files scanned:** 12 source + 4 test analogs read at HEAD on `feat/v1.16-production-resilience`.
**Pattern extraction date:** 2026-07-31
