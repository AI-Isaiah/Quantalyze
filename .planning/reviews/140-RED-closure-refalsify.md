# Phase 140 findings — closure RE-FALSIFICATION at HEAD `a77d607e`

**Method.** Every verdict below is re-derived from source at HEAD. No SUMMARY, PLAN, ledger row or
VERIFICATION doc was accepted as evidence for any verdict. Where a verdict is CLOSED the receipt is a
`file:line`, a measured command output, or a named test that pins the property.

**Constraint that shaped the method.** The no-write rule forbade running mutations, which is the
strongest available receipt and the one Phase 140 faked. In its place I checked, for every "pinned"
claim, whether the assertion reads a **hand-typed literal** or reads the **module under test** — the
two-layer self-referential oracle that made D-07/D-08 unfalsifiable. That check is mechanical and is
reported per finding.

**Measured, not asserted:** `npx vitest run --no-file-parallelism src/lib/seam-constants.pin.test.ts
src/lib/seam-budgets.invariant.test.ts src/lib/resilient-fetch.wiring.test.ts
src/lib/seam-log-coverage.test.ts src/lib/seam-copy.pin.test.ts src/lib/seam-errors.purity.test.ts`
→ **6 files passed, 217 tests passed**, 3.17 s.

Branch protection on `main` is OFF, so every gate named here is **advisory at merge**. Read every
"would redden" as *would have caught*, never as *did stop*.

---

## Verdict summary — Clusters A + D (43 findings, all adjudicated)

| Verdict | Count |
|---|---|
| CLOSED | 32 |
| PARTIALLY CLOSED | 7 |
| OPEN | 2 |
| SUPERSEDED | 2 |

---

## Cluster A — seam core / breaker internals

| ID | Verdict | Receipt |
|----|---------|---------|
| A-01 | **CLOSED** | Status contract replaces `>=500`. `seam-discriminator.ts:437-444` → 500 is `service-permanent, counts:false`; `:447-455` → 503 keys `breaker:<dependency>`. `resilient-fetch.ts:804-806` `breakerKeysFor` reads only the row's declared deps + global, so an `mt5-gateway` trip cannot block `/api/simulator`. Measured: `grep -rn "status_code=50[24]\|HTTPException(50[24]" analytics-service/routers/ services/` → **empty**, so no 502/504 remains to reach the counting arm. |
| A-02 | **CLOSED** | Same 500 arm, `seam-discriminator.ts:437-444`. The undecryptable-key 500 is now structurally breaker-inert. |
| A-03 | **CLOSED** (TRAP-2 respected) | Verdict decided from the **status line first**, `resilient-fetch.ts:1826`; the body is consulted only on 503 and only to refine the key. `readDependencyBody` (`:1567-1579`) swallows absent/`text/plain`/aborted bodies and falls back to the global key **while still counting** — the peek can only make the key more specific, never decide whether to record. PART 7 correction #6 (verified against starlette 0.52.1 while prod pins 0.46.2) is now moot: I confirmed `analytics-service/requirements.txt:230` = `starlette==0.46.2`, and the closure no longer depends on any starlette behaviour because the verdict never consults the body to decide *whether* to record. |
| A-04 | **CLOSED** | `resilient-fetch.ts:716-726` — `Redis.fromEnv({retry:{retries:1,backoff:()=>250}, signal:()=>AbortSignal.timeout(2000)})`. Signal is a **factory**, with the SDK's per-command evaluation read at source and the rethrow-vs-fabricated-200 asymmetry documented (`:~688-715`). Constants pinned to literals at `seam-constants.pin.test.ts:413,422,429`. |
| A-05 | **PARTIALLY CLOSED — residual explicitly ACCEPTED in code** | `verify-strategy/route.ts:41-49` is still unauthenticated (only `publicIpLimiter`). The reachable trip vector narrowed (500s no longer count; no 502/504 upstream) but deadline/transport/503 from the anonymous teaser still land on `BREAKER_KEY`, which every call site checks. `resilient-fetch.ts` ME-04 block states this verbatim: *"The exposure is real and is ACCEPTED for now… Vercel's 10 req/60 s per-IP cap is no defence against a distributed caller… Recorded for Phase 141."* The `Retry-After` cooldown-oracle half is unchanged. |
| A-06 | **CLOSED** | `strategies/finalize-wizard/route.ts:122` `MAX_COMPOSITE_MEMBERS = 10`; `:892` `.limit(MAX_COMPOSITE_MEMBERS + 1)`; `:935` fail-loud when the list exceeds the cap. The `+1` is deliberate so "exactly at cap" and "over cap" are distinguishable. SC-4e binds the declared `calls: 10` to the literal **read from the route file on disk** (`seam-budgets.invariant.test.ts:371-381,588-612`), so raising the cap without raising the declaration reddens. |
| A-07 | **PARTIALLY CLOSED** | Budget is still `15_000` and is now pinned to that literal (`seam-constants.pin.test.ts:89-104`) with a source citation in the row (`_is_long_fetch` returns 202 for {onboard, resync}). So it is falsifiable in both directions, which it was not. What is **not** closed: **no latency measurement was ever taken**, and the harm channel is intact — a cold-Railway enqueue exceeding 15 s is a deadline, and a deadline still counts to the global key (`resilient-fetch.ts:1802-1805`), so a false 504 on the wizard SUBMIT step still feeds the breaker while the job may already be enqueued. The paired copy at `src/lib/wizardErrors.ts:516` still promises *"First sync of the day can require up to 60 seconds while the analytics service wakes up"* — though that sentence describes the poll wait, not the enqueue call, so it is weaker evidence than the register implies. The row's justification is now a **source citation** (`_is_long_fetch` returns 202), which is better than the guess it replaced but is still not a measurement of cold-start latency. |
| A-08 | **CLOSED** | Measured against real Redis and pinned: `tests/redis/seam-breaker.redis.test.ts:584-660` R-7 drives two runs with an identical 32 s wait and different epoch alignment, pinning the band `[BREAKER_COOLDOWN_S, BREAKER_COOLDOWN_S + BREAKER_WINDOW]` = [30 s, 60 s]. The docblock at `resilient-fetch.ts:160-187` was corrected **against the measurement**, including the carry-over table. |
| A-09 | **CLOSED** | `resilient-fetch.ts:1092-1101` returns early on `verdict.reason === "timeout"`. The discriminator choice is reasoned rather than incidental: `reason` distinguishes the fail-open sentinel from `"cacheBlock"`, which is a genuine denial that must still trip — a `limit === 0` test would be correct only by accident. |
| A-10 | **PARTIALLY CLOSED — the class is still open on the highest-exposure route** | Real machinery landed: `scrubSeamError` at both core log arms (`:1797`, `:1489`), and `seam-log-coverage.test.ts` scans 8 files for bare caught identifiers **and** for error-shaped destructured bindings (`/^(error\|[\w$]*(Err\|Error))$/`). **But the completeness needle is `CREDENTIAL_BEARING_CALLS = ["validateKey(", "encryptKey("]`.** `verify-strategy/route.ts` handles raw `api_key`/`api_secret` (`:64-73`, forwarded at `:186-187`) via `postProcessKey` — matching **neither** needle — is absent from `SEAM_FILES`, and passes a **bare caught error** to `console.error` at **`:384`** (`configErr`) and **`:440`** (`err`). Sentry capture at those sites *is* scrubbed (`secrets: perRequestSecrets`); the console half is not. This is TRAP-5 recurring: the class was enumerated by the **shape** of the known instances, not by the **behaviour** (routes carrying raw exchange credentials). |
| A-11 | **PARTIALLY CLOSED** | `emitBreakerTransition` (`resilient-fetch.ts:907-923`) now emits `seam.breaker.open` **and** `.close` with `{breakerKey, failures, cooldownS, correlationId}`, the id derived from the lock so open and close pair up. Genuine improvement over "emits nothing". Still: `grep -c "captureToSentry\|Sentry" src/lib/resilient-fetch.ts` → **0**, across 11 console sites. You can reconstruct an incident from Vercel logs; you cannot be alerted to one. Same defect family as the independently-reported "breaker's only health sink is one `console.warn`". |
| A-12 | **CLOSED** | `seam-budgets.invariant.test.ts:723-759` reads each `SEAM_EXCLUSIONS` path from disk (comment-stripped) and asserts it neither **imports** nor **calls** the core; `:709-716` separately pins both `/health` warmers as MEMBERS of the exclusion set, so deleting a row does not silently delete the guard. |
| A-13 | **CLOSED, with genuine class teeth** | `resilient-fetch.wiring.test.ts:661-760`. A discovery walk over the two clients + literal call sites is compared by **sorted set equality** to a hand-typed `EXPECTED_BINDINGS` roster; `EXPECTED_SEAM_CALL_FILES` closes the "budget key passed as a variable" hole; a vacuity fence (`discovered.length >= 14`) means a pattern that stops matching fails loud instead of passing empty. Oracle independence is explicit: nothing in the roster half imports the modules it guards. |
| A-14 | **CLOSED** | `seam-constants.pin.test.ts:385-386` asserts `durationToMs(BREAKER_WINDOW) <= BREAKER_COOLDOWN_S * 1000` with the flap rationale in the failure message. |
| A-15 | **CLOSED** | `seam-errors.ts:75-79` — `RangeError` on non-integer/negative, matching `AnalyticsUpstreamError`'s shape. Explicitly **not a clamp**, with the reason stated. Tested at `seam-errors.purity.test.ts:213-266`, including "does NOT clamp". |
| A-16 | **CLOSED** | `seam-errors.purity.test.ts:65` reads the leaf from disk; `:111-146` assert no `import`, no re-export, no `require()`, no env read, plus set-equality on the exported class list. Prepending an `@upstash/redis` import now reddens four named cases. |
| A-17 | **CLOSED** | Every `SEAM_BUDGETS` row carries its own `retries` (`resilient-fetch.ts:381-391` type + all 13 rows); SC-4b reads the row; `SEAM_RETRIES` is the seed. Per-row negative pin at `seam-constants.pin.test.ts:283-296`. Phase 141 is now a per-row flip, exactly as the finding asked. |
| A-18 | **CLOSED** | Both realistic shapes are now `invalid` fixtures: `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts:143` (`const url = \`${base}/x\`; fetch(url)`) and `:150` (`new URL(path, base)`), plus `:159` inline-`new URL`. The rule implements a fixed-point taint sweep (`rules/no-raw-analytics-fetch.mjs:25-63`) and its docblock now states what taint still does *not* cross rather than describing an unrealistic ceiling. |
| A-19 | **CLOSED** | The malformed-value arm reads CLOSED and is asserted with the direction argued (`resilient-fetch.test.ts:507-521`); the fake exposes explicit knobs for a rejecting read path and a rejecting counter (`:55`, `:65`). The throwing-`ttl` arm is **gone structurally** — there is no `ttl` call left (see A-24). |
| A-20 | **SUPERSEDED** | The single-shared-key property ceased to exist at 140.2-06: keys are per-dependency plus a residual global. Its successor property is pinned harder than the original ever was — `EXPECTED_DEPENDENCIES` sorted-**set** equality per row (`seam-constants.pin.test.ts:259-281`), explicitly not a length check because a length passes a swap. |
| A-21 | **CLOSED** — the headline fix, and it is real | The body read now happens inside the classification window: `instrumentBody` (`resilient-fetch.ts:1445-1535`) wraps `json()`/`text()`, classifies deadline vs other, logs scrubbed, and records via the shared `recordOnce` latch (`:1722-1727`) so a counting status **plus** a stalling body is one failure, not two. `SyntaxError` is rethrown raw so a parse failure is not miscounted as transport (`:1475-1477`) — the A-22 defect is not rebuilt inside the fix. Throws `SeamBodyReadError` rather than returning, because `keys/[id]/permissions` depends on the throw leaving no `unstable_cache` entry (`:1510-1515`). |
| A-22 | **CLOSED** | URL construction, `new URL` parse and an explicit `http:`/`https:` protocol check all sit **above** the try (`:1663-1691`), throwing `SeamConfigError` and logging "CONFIG fault … NOT an analytics-service failure". The `localhost:8002/x` parses-but-is-wrong case is called out and handled. Test: `resilient-fetch.test.ts:1880` — "records ZERO failures and logs CONFIG, not network". |
| A-23 | **CLOSED** | `resilient-fetch.ts:1763` `redirect: "error"`, placed **after** the caller's init spread so a stored init cannot restore `follow` by accident. |
| A-24 | **CLOSED structurally, not by branching** | The expiry moved **into the value** (`encodeBreakerLock`, `:835-857`), so `isBreakerOpen` is one `mget` and there is no `ttl` call to race (`:990+`). Both halves of A-24 are unreachable rather than defended. |
| A-25 | **CLOSED** | `resilient-fetch.ts:1148` `if (admittedAtMs <= existing.armedAtMs) return;`, made answerable by `BREAKER_LOCK_TOMBSTONE_S = 60` (`:210`) letting the key outlive the lock. `admittedAtMs` is captured at admission (`:1707`), not at recording time. The rejected alternative ("skip when already open") is named and shown not to close it. |
| A-26 | **CLOSED** | The SC-4b invariant now charges store cost explicitly: `seam-budgets.invariant.test.ts:154-156` `STORE_COMMAND_WORST_CASE_MS = (1+retries)×TIMEOUT + retries×BACKOFF`, `:184` `STORE_COMMANDS_PER_SEAM_CALL` per breaker state, summed at `:523-524`. The `4_250 ms` per-command worst case is pinned as a literal at `seam-constants.pin.test.ts:442`. |
| A-27 | **CLOSED** | `analytics-client.ts:177` `NULL_BODY_STATUSES = {204,205,304}` with the fork placed outside the `ok` check because 204/205 are `ok` and 304 is not (`:416-420`); the `200 text/html` maintenance page is a typed outcome at `:490` instead of the local-dev port message. |
| A-28 | **CLOSED** | Entry validation at `:1641-1660` — finite, in `[1, 300000]` — with the value logged before throwing (`:1653`). The `!== undefined` (rather than `"x" in init`) choice is argued from this repo's tsconfig lacking `exactOptionalPropertyTypes`. Driven by a hand-typed table of every shape `AbortSignal.timeout` rejects (`resilient-fetch.test.ts:1760-1777`). |
| A-29 | **CLOSED** | `SEAM_ROUTE_BUDGETS` rows carry an optional `branch`; the invariant sums **within** a branch and takes the **maximum across** branches (`resilient-fetch.ts:~554-565` docblock; `seam-budgets.invariant.test.ts` SC-4b). finalize-wizard now models both paths: `keys-permissions × 10 (composite)` vs `keys-permissions ×1 + process-key-enqueue ×1 (single-key)`. |

---

## Cluster D — observability / verification integrity

| ID | Verdict | Receipt |
|----|---------|---------|
| D-01 | **CLOSED — the single most important closure in the set** | `tests/redis/seam-breaker.redis.test.ts`, 666 lines, cases R-1…R-7, against real Redis via SRH. CI job `frontend-seam-redis` at `.github/workflows/ci.yml:359-486` (redis + `hiett/serverless-redis-http`, both digest-pinned), **no `skipIf` anywhere** (asserted in the file's own docblock, `:49`), a **vacuous-corpus guard** at `:455-457` (`No tests/redis/*.test.ts files found … must never pass vacuously`), and wired into the `frontend` aggregator at `:782,796`. This is the artifact whose absence made the breaker unverifiable. |
| D-02 | **SUPERSEDED** | The false-green premise was about `vi.mock` factories under `resetModules()`. The breaker's central properties are now verified in a lane that uses **no `vi.mock` at all** (real Redis), so no negative control depends on the refuted premise. The in-process fake remains, but is no longer the sole oracle for any breaker constant. |
| D-03 | **PARTIALLY CLOSED** | The **crash** half is structurally gone: `CircuitOpenError` lives in `seam-errors.ts`, which nothing mocks, so `x instanceof undefined` can no longer throw from inside a catch. The **coverage** half is not: measured, 29 test files mock a seam client, 15 of them use `importActual` somewhere; only **4** un-mocked `*.seam.test.ts` files exist (`verify-strategy`, `keys/sync`, `keys/[id]/permissions`, `admin/match/recompute`) against **15** seam routes. 11 routes' breaker behaviour is still proven only through a wholesale mock. |
| D-04 | **PARTIALLY CLOSED — a named instance is still present verbatim** | Several rot items were corrected in place, and corrections are annotated rather than silently overwritten (e.g. `resilient-fetch.ts:1747-1753` records that **two** prior corrections landed on that one comment). But the specific instance D-04 named — the `revalidate` ratio the T-140-32 rationale hinges on — survives: **`src/app/api/keys/[id]/permissions/route.ts:166` still says "repeat hits inside 5 minutes"** while **`:344` is `{ revalidate: 60 }`**. |
| D-05 | **OPEN** | Measured: `grep -n "unstubGlobals\|restoreMocks\|clearMocks" vitest.config.ts vitest.redis.config.ts` → **exit 1, no match**. `src/test-setup.ts` is 136 lines with exactly one `afterEach` (`:47`) which calls `cleanup()` only; **zero** occurrences of `unstubAllGlobals`. Per-file discipline is still the only defence against this repo's known CI-only failure cause. |
| D-06 | **OPEN (code half)** | `resilient-fetch.ts:716-717` still gates on `UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN`; `grep -rn "KV_REST_API" src/` → **no matches**. A project carrying only the Vercel-marketplace `KV_*` shape still gets `redis = null` and a silently disabled breaker, announced by one `console.warn`. The ops half ("confirm prod carries the `UPSTASH_*` names") is not verifiable from the tree and I did not verify it. |
| D-07 | **CLOSED** | All six breaker constants pinned to hand-typed literals: `seam-constants.pin.test.ts:321` (threshold 5), `:327-328` (`"30 s"` and 30 000 ms), `:332` (cooldown 30), `:336` (default retry-after 30), `:362` (tombstone 60), `:413/:422/:429` (store 2000/1/250). **Measured oracle-independence:** `grep -cE "mod\.|MODULE\." src/lib/seam-constants.pin.test.ts` → **0**. The two-layer self-referential oracle that made these unfalsifiable is gone. |
| D-08 | **CLOSED** | `EXPECTED_TIMEOUT_MS` at `seam-constants.pin.test.ts:89-104` hand-types **all 13** budgets; `it.each` asserts each row against its literal and fails loud on a **missing** row (so deleting a row cannot silently delete its pin); `:230-237` asserts the key **set** so an add/remove/rename reddens. `0 of 13 pinned` → `13 of 13 pinned`. |
| D-09 | **CLOSED** | Same receipt as A-16 — a real from-disk source scan, not an import-time assertion. |
| D-10 | **CLOSED** | `SEAM_ROUTE_BUDGETS` rows are deep-compared to a hand-typed 15-row map, so dropping a leg from a multi-leg row reddens (registry entry, `src/__tests__/contracts/contracts-registry.test.ts:149`; implementation in `seam-budgets.invariant.test.ts`). On-disk `maxDuration` parity is checked per route. |
| D-11 | **CLOSED** | Same receipt as A-13. The "good news" the finding noted (one site *was* caught by a named test) has been generalised to all thirteen plus a fourteenth-binding fence. |
| D-12 | **CLOSED** | One declaration: `src/lib/seam-copy.ts:65`. `seam-copy.pin.test.ts` walks `src` from disk (`:108-119`) and pins the text to a hand-typed literal (`:55`). **Measured:** every remaining literal copy of the string in the repo is in a `*.test.ts` file (7 of them); **zero production re-declarations**. Cross-file production drift is now unconstructable rather than merely asserted. |
| D-13 | **CLOSED** | Counter identity pinned against real Redis: `tests/redis/seam-breaker.redis.test.ts:368-407` asserts the store receives `breaker:<key>:failures:<epoch window>`, **one counter per key**, via a hand-typed `counterKeyFor`. `nx` now has a real falsifier — `resilient-fetch.test.ts:2190` "HI-01: a stale-reading concurrent instance cannot RATCHET a live lock", and `:2153` records that deleting `nx: true` previously left the entire suite green. `:2131-2137` corrects an earlier case that *claimed* to test `nx` and did not. |
| D-14 | **CLOSED** | Same receipt as A-12 — membership is now asserted, not just existence. |

---

## The five places "closed" is most likely to be wrong — and what I found

1. **A-10 / TRAP-1 is the one that is genuinely still open, and on the worst route.** The redaction
   work is strong and the guard is real, but the *class* was enumerated by the shape of the known
   instances (`validateKey(` / `encryptKey(`) rather than by the behaviour (a route holding raw
   exchange credentials). `verify-strategy/route.ts` — the **anonymous public teaser**, which
   accepts `api_key`/`api_secret` at `:64-73` and forwards them at `:186-187` — is on neither the
   roster nor the needle, and logs a bare caught error at `:384` and `:440`. This is PART 7's own
   meta-lesson (*"enumerate by BEHAVIOUR, not by syntax"*) recurring one layer up.

2. **D-04's comment rot was fixed as instances, and one named instance survived.**
   `permissions/route.ts:166` "5 minutes" against `:344` `revalidate: 60` is the *specific* pair
   D-04 flagged, because the T-140-32 rationale turns on the 60-s-vs-30-s ratio. A reader reasoning
   from the comment reasons from a 5× ratio that does not exist.

3. **A-05 is documented, pinned, and not fixed — and the code says so.** This is the honest failure
   mode, not the dishonest one: the ME-04 block states the residual, names why the obvious fix is
   cross-language, and a test pins the *statement* so it cannot revert to the comfortable version.
   But an anonymous distributed caller can still open the key every one of the fifteen call sites
   checks. Do not let "pinned" read as "closed" here.

4. **D-05 and D-06 are simply open and were never claimed otherwise loudly enough to notice.** Both
   are LOW severity and both are one-line fixes. D-05 in particular guards this repo's known
   CI-only-failure class.

5. **D-03's coverage half.** 4 un-mocked seam lanes against 15 seam routes. The crash mechanism is
   dead, so the severity dropped a lot — but "16 route tests prove mapping and nothing about
   SC-1/SC-5" is still true of 11 of them.

## What I want to flag as genuinely different from Phase 140

The pattern that made Phase 140's verification fake — an assertion reading the value it guards — is
**mechanically absent** from the new pins. I checked for it rather than trusting the claim:
`grep -cE "mod\.|MODULE\." src/lib/seam-constants.pin.test.ts` → 0, and every roster in
`resilient-fetch.wiring.test.ts`, `seam-constants.pin.test.ts` and `seam-log-coverage.test.ts` is
hand-typed with an explicit oracle-independence docblock. Three further habits appear repeatedly and
are the reason the closure rate is real rather than claimed: **vacuity fences** (a discovery pass that
matches nothing fails loud), **set equality rather than counts** (a length check passes a swap — and
the plan measured that), and **corrections annotated rather than overwritten**, so a comment that has
already been wrong twice says so.

The remaining gaps share one shape: **hand-typed rosters whose completeness needle is narrower than
the behaviour it means to cover** (A-10's `validateKey(`/`encryptKey(`; the independently-reported
middle-tier route gap). That is the same defect class, one abstraction level up from where the
programme has been fighting it.

---

# Cluster C — Python service contract (delegated lane, key claims re-verified by me)

Adjudicated by a parallel red-team lane against the PART 7 **corrected** (larger) scope. Headline:
**14 CLOSED · 5 PARTIALLY CLOSED · 2 OPEN · 2 with named residuals** — and one **new regression
introduced by the fix for the register's only CRITICAL**, which I re-derived at source myself.

## ⛔ C-08's fix introduced a data-integrity regression (independently verified)

The cross-tenant leak **is** closed: `supabase/migrations/20260726000225_..._tenant_scope_uniq.sql:123`
creates `UNIQUE (strategy_id, wizard_session_id)`, `:135` drops the old single-column index, both
`process_key.py` read sites filter on both columns, and a `_caller_owns_strategy()` gate runs before
the first read. Good work with a self-verifying `DO` block.

**But the dropped index was `finalize_csv_strategy`'s only double-submit protection.** Verified by me
at source, with the re-base rule applied (`20260716130500` is the latest of two definitions):

- `20260716130500_finalize_terminal_status_param.sql:296-304` — `INSERT INTO strategies (user_id,
  name, status, source, strategy_types, subtypes, markets, supported_exchanges) … RETURNING id INTO
  v_strategy_id`. The column list **omits `wizard_session_id`**, so it is NULL.
- `:315-321` — `INSERT INTO strategy_verifications (strategy_id, wizard_session_id, …) VALUES
  (v_strategy_id, p_wizard_session_id, …)` with a **freshly minted** `strategy_id`.
- Therefore the new composite key **can never collide**: every call supplies a new `strategy_id`.
- The only other backstop cannot fire: `20260602190000_f6_wizard_session_idempotency.sql:52-54` is
  `ON strategies (user_id, wizard_session_id) WHERE wizard_session_id IS NOT NULL`, and the INSERT
  above leaves that column NULL.

**Effect at HEAD:** a CSV double-submit that previously raised 23505 now creates a **second
`strategies` row plus a second `strategy_verifications` row** and returns 200 with a new
`strategy_id`. `src/lib/wizardErrors.ts:882` tells the user *"On the CSV path a repeat submit of the
same wizard session cannot create a second strategy"* — **now false**.

This is the programme's signature failure recurring **inside** the gated pipeline: the fix
enumerated the *readers* of the index and not its *writers*.

## Other Cluster C verdicts worth surfacing

- **C-09 CLOSED, and it is a real redesign** — `process_key.py:817-818` stacks a tenant bucket keyed
  on an **HMAC-verified `X-Tenant-Claim`** (`services/rate_limit.py:305-349`) with a platform
  ceiling; the anonymous teaser gets its own `process_key:anon` 30/h bucket. The single global
  100/h bucket an anonymous caller could drain is gone.
- **C-16 PARTIALLY CLOSED — the exact copy survives on the PUBLIC teaser.** Verified by me:
  `analytics-service/routers/portfolio.py:2326` still raises
  `HTTPException(500, "Key validation failed. Please check your credentials.")` inside
  `verify_strategy` (the `/verify-strategy` route at `:2201`). The breaker half is closed (500 no
  longer counts); the "blames the user's credentials, matches no classifier, renders UNKNOWN" half
  is fully open on the highest-exposure route in the system.
- **C-10 PARTIALLY CLOSED** — all nine PART-7-corrected sites re-keyed, but a **tenth by behaviour**
  (`routers/simulator.py:92`, IP-keyed) is handled by a literal allow-list
  `IP_KEYED_QUARANTINE = frozenset({"simulator.py"})` in the guard test. Quarantined, not fixed —
  and enumerating by behaviour is exactly what PART 7 correction #3 said to do.
- **C-07 OPEN** — `resilient-fetch.ts:1475-1477` rethrows `SyntaxError` **raw and by design**, so
  `process-key-client.ts:242-245` and `keys/validate-and-encrypt/route.ts:225-228` still coerce it to
  `{}` and `keys/sync/route.ts:618` still answers `200 {}`. The silent no-op resync on a truncated
  body is intact.
- **C-17 PARTIALLY CLOSED** — permanent-fault-as-503 survives at `routers/exchange.py:681` and
  `routers/debug_key_flow.py:56,100`.
- **Raw-5xx census: eleven deliberate 5xx sites bypass the PYAPI-05 contract entirely** (no `code`,
  no `dependency`, no `retryable`), including the two above and `csv.py:101` (`detail={dict}` —
  C-14's shape) and `exchange.py:781` (venue fault as 500 — C-12's shape).

**Lane caveat, stated by the lane:** nothing was executed — no pytest, no mypy, no mutation. Every
Cluster C "CLOSED" means *the mechanism is present and correct at source*, not *the harness would
catch its removal*. On this branch that distinction is load-bearing.

---

# Cluster B — wizard / client error surface (delegated lane, key claims re-verified by me)

**Tally: 10 CLOSED · 14 PARTIALLY CLOSED · 4 OPEN.** This is by far the weakest cluster, and the
failure mode is uniform: **a type branch or a copy string was changed while the control flow that
produced the harm was left alone.**

## Three claims I re-derived myself

- **B-02 — the dead branch is still dead. MEASURED.**
  `src/lib/analytics-client.ts:54` → `` `Analytics service timed out after ${timeoutMs}ms on ${path}` ``
  `src/lib/wizardErrors.ts:1485` → `if (lower.includes("timeout") || lower.includes("etimedout"))`
  `node -e '"Analytics service timed out after 15000ms".toLowerCase().includes("timeout")'` → **`false`**.
  The `KEY_NETWORK_TIMEOUT` branch cannot match the error it was written for. Three phases later,
  the *common* Railway degradation (breaker closed, request times out) still renders `UNKNOWN`/500
  in the wizard — the exact DOGFOOD-3 dead end this whole programme exists to kill. And
  `src/lib/wizardErrors.test.ts:611` still pins `"connect ETIMEDOUT 10.0.0.1:443"`, a string the
  register **proved** cannot reach the classifier, so the suite reads as covering the dead arm.
- **B-11 — closed by re-attribution, not by a change.** `140.3-CONTEXT.md:291` records
  *"B-11 / B-23 are the same finding, attributed to different files."* They are not. B-23
  (`PortfolioImpactPanel`) is genuinely fixed. B-11's three **wizard** surfaces are not:
  `SubmitStep.tsx:262` is `buildEnvelope(errorCode, upstreamCorrelationId ?? correlationId)` —
  two arguments, no context — so `retry_after_seconds` is undefined and no wait is rendered, while
  `finalize-wizard/route.ts:498`, `create-with-key:597` and `composite/add-key:529` all put
  `Retry-After` on the wire.
- **B-01 — closed at two of three wizard surfaces.** `SubmitStep` and `ConnectKeyStep` translate
  correctly. `SyncPreviewStep.tsx:147-175` `KNOWN_KICKOFF_CODES` has exactly five members
  (`RATE_LIMITED`, `GATE_DRAFT_GONE`, `COMPOSITE_MEMBERSHIP_UNKNOWN`, `MISSING_STRATEGY_ID`,
  `INVALID_STRATEGY_ID`) — **no `CIRCUIT_OPEN`, no `SERVICE_UNAVAILABLE_RETRY`** — so a breaker trip
  on the sync-kickoff path still falls to `SYNC_FAILED`.

## Other Cluster B items worth surfacing

- **B-04 OPEN — our own missing config renders as the user's exchange being unreachable.**
  `finalize-wizard/route.ts:513-519` maps every non-`CircuitOpenError` probe failure to
  `KEY_NETWORK_TIMEOUT` = *"We could not reach the exchange."*, and the reachable set includes
  `Error("INTERNAL_API_TOKEN is not configured")` thrown at `route.ts:172`. The honest code for that
  fault (`SEAM_MISCONFIGURED`) exists and is emitted at exactly **one** production site
  (`process-key-client.ts:486`). Two files, same fault, one fixed.
- **B-15 PARTIALLY CLOSED — the fix landed on the member that had a backstop.** `ApiKeyManager` grew
  an `isSyncEnqueued` guard and its own comment at `:306-307` certifies *"one shape at both members
  of the class, not two."* The class has **three** members. `SyncPreviewStep.tsx:639-645` — the
  component the finding names by its `waiting_for_complete` state — reads only `composite` off the
  2xx and never `ok`, so `keys/sync/route.ts:616-620`'s un-stamped drift passthrough still starts a
  **15-minute poll for a job that was never enqueued**.
- **B-08 OPEN, unchanged count** — 7 of 10 emitters still carry no `code`
  (`admin/match/eval`, `admin/match/recompute`, `bridge`, `keys/validate-and-encrypt`,
  `portfolio-optimizer`, `scenario/optimize`, `simulator`). `seam-copy.ts:50-54` is candid that this
  was deferred.
- **B-24 PARTIALLY CLOSED** — `evalMatch` is still the only analytics wrapper with no Zod schema
  (`analytics-client.ts:793-794`), and `MatchEvalDashboard.tsx:82` still feeds unvalidated JSON into
  `:193 metrics.intros_shipped.toString()` — one field rename replaces `/admin/match/eval` with the
  error boundary.
- **B-26 CLOSED** (I verified this one directly) — `PortfolioOptimizer.tsx:211` `setSuggestions(null)`
  before the fetch, `:280` error-first render guard, `:231` array guard. The register's only
  Cluster-B CRITICAL is genuinely fixed, using the fix shape the register itself named.
- **B-14 CLOSED** — the fail-OPEN publish gate is now `LivePermissionsSchema.safeParse` →
  `PROBE_PARSE_MISS` → the fail-CLOSED 502 arm (`finalize-wizard/route.ts:215-226`, `:521-531`).

---

# OVERALL VERDICT — 94 findings adjudicated

| Cluster | CLOSED | PARTIAL | OPEN | SUPERSEDED | n |
|---|---|---|---|---|---|
| A — seam core | 22 | 5 | 0 | 2 | 29 |
| B — wizard/client | 10 | 14 | 4 | 0 | 28 |
| C — Python contract | 16 | 5 | 2 | 0 | 23 |
| D — harness integrity | 10 | 2 | 2 | 0 | 14 |
| **Total** | **58** | **26** | **8** | **2** | **94** |

**Fully closed: 58 of 94 = 62%.** Counting SUPERSEDED as resolved: **64%**.
**Not fully closed: 34 of 94 = 36%**, plus **one new regression** introduced by the fix for the
register's only CRITICAL.

## Confidence

**High** on Clusters A and D — I read the core end to end, verified oracle-independence
mechanically (`grep -cE "mod\.|MODULE\."` → 0), and measured 426 passing tests across 11 seam files.
**Medium-high** on B and C: delegated, but I independently re-derived the four highest-stakes claims
(the C-08 regression, C-16's public-teaser residual, B-02's dead branch, B-11's re-attribution) and
all four held at source.

**The load-bearing caveat: no mutations were run in any lane.** The no-write rule forbade it. Every
"CLOSED" therefore means *the mechanism is present and correct at source*, not *the harness bites if
you remove it*. On a branch whose predecessor certified itself mutation-tested while ten
simultaneous mutations produced a byte-identical pass count, that distinction is the whole game.
The mitigating evidence is structural rather than executed: the pins are hand-typed, the rosters are
oracle-independent by construction, discovery passes carry vacuity fences, and D-01's live-Redis lane
is real and CI-wired. That is a genuinely different regime from Phase 140 — but it is inferred from
code shape, not measured.

## The one thing to act on first

**The C-08 fix silently removed `finalize_csv_strategy`'s only double-submit protection.** It is a
live data-integrity regression on the money path, it contradicts user-facing copy that is still
shipped (`wizardErrors.ts:882`), it is recorded nowhere, and it was produced *inside* the gated
pipeline that was supposed to prevent exactly this. It is the strongest available evidence that the
plan→plan-check gate reduced the fix-to-defect ratio without driving it to zero — and it is the same
enumeration failure as always, one level down: the fix enumerated the index's **readers** and never
its **writers**.
