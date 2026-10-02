# Phase 140 — closure MUTATION SAMPLE, run 2 (Clusters B / C / D)

**Question.** `.planning/reviews/140-RED-closure-refalsify.md` marked **58 of 94** findings CLOSED
while running **zero mutations**. Every one of those verdicts means *"the mechanism reads correctly
at source"*. This run asks the other question: **does the harness bite when you break the
mechanism?**

**Environment.** Isolated git worktree `agent-aaa7ce7087f164283`, reset to the refalsify doc's HEAD
`a77d607e` (tip of `feat/v1.16-production-resilience`). Nothing is committed. `node_modules` is
symlinked from the shared checkout.

**Branch protection on `main` is OFF** (settled founder decision). Every CI gate named here is
**advisory at merge** — read every RED as *"would have caught"*, never as *"did stop"*.

## Sampling rule (stated up front, so the number is interpretable)

1. **Cluster weighting** — a separate worktree run already established 10/10 caught in the seam core
   (Cluster A). This run spends its budget on the clusters that run did not cover:
   **B (wizard/client, 10 CLOSED against 14 PARTIAL + 4 OPEN — the weakest)**, **C (Python contract,
   16 CLOSED)**, **D (harness integrity, 10 CLOSED)**.
2. **Mechanism weighting** — within those clusters I preferred fixes whose mechanism is a
   **hand-typed roster**, an **allow-list**, a **comment**, or a **single-file edit**, because the
   measured coverage law from this programme says those under-cover, and that is where a false CLOSED
   is most likely.
3. **Second-member rule** — where a finding names a class, I mutate the **second** member, not the
   one the fix was written against. The first member is the one everybody remembers to cover.
4. **Semantic only** — every mutation changes a value, moves a boundary, flips a branch direction, or
   deletes a guard. **No syntax errors, no type errors, no test edits.**
5. **No tuning** — the first honest mutation per finding is the one recorded. If it passes GREEN,
   that is the result, not a prompt to hunt for a mutation that reddens.
6. **One live mutant at a time**, reverted and re-verified green before the next.

## Baselines measured in this worktree

| Command | Result |
|---|---|
| `npx vitest run` | **715 files passed / 19 skipped · 9792 passed / 287 skipped**, 138.7 s |
| `cd analytics-service && python3 -m pytest -q` | _(recorded with the first Cluster C entry)_ |

Both match the baselines supplied with the task.

---

## Results (appended one at a time, in execution order)

### M1 · B-01 (Cluster B) — `ConnectKeyStep`'s hand-typed wire-code roster

- **Mechanism claimed CLOSED:** "B-01 — closed at two of three wizard surfaces. `SubmitStep` and
  `ConnectKeyStep` translate correctly." Second-member rule → I mutate `ConnectKeyStep`, not
  `SubmitStep`.
- **Mutation:** deleted the member `"SERVICE_UNAVAILABLE_RETRY"` from
  `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx:228`) — the one member that carries a breaker
  trip. A breaker trip now falls through to `UNKNOWN`, which is exactly the harm B-01 describes.
- **Ran:** `npx vitest run src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx`
- **Result: RED** — `1 failed | 31 passed (32)`, file `ConnectKeyStep.test.tsx`, case
  *"POSITIVE: a code from the route's classifier half is emitted UNCHANGED (a reject-everything guard
  would fail here)"* (asserts `data-error-code="SERVICE_UNAVAILABLE_RETRY"`).
- **Reverted →** `32 passed`.
- **Verdict: GENUINELY CLOSED.**

### M2 · B-14 (Cluster B) — the fail-OPEN publish gate, mutated at the SCHEMA it depends on

- **Mechanism claimed CLOSED:** "B-14 CLOSED — the fail-OPEN publish gate is now
  `LivePermissionsSchema.safeParse` → `PROBE_PARSE_MISS` → the fail-CLOSED 502 arm."
- **Mutation:** in `src/lib/analytics-schemas.ts:365`, `trade: z.boolean()` →
  `trade: z.boolean().optional()`. This attacks the *reason the fix works*, stated in the route's own
  comment — *"`read`/`trade`/`withdraw` are REQUIRED in the schema precisely because their absence is
  that drift"*. With `trade` optional, a 2xx `{}` or a renamed field parses **successfully**, the
  `probe_error` arm is never reached, and `livePerms.trade === true` is `undefined === true` → the
  key publishes as read-only-verified. That is the original vulnerability verbatim. I chose `trade`
  over `read` under the second-member rule.
- **Ran:** `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts src/lib/analytics-schemas.test.ts`
- **Result: RED** — `2 files failed · 4 failed | 162 passed (166)`. Cases:
  `analytics-schemas.test.ts` — *"REJECTS a body missing trade — absence must never read as 'not
  granted'"*, *"REJECTS a renamed scope field (trade → can_trade) rather than defaulting it"*,
  *"inherits the scope requirement — a body missing `trade` is REJECTED here too"* (the derived
  `KeyPermissionsPayloadSchema`); `finalize-wizard/route.test.ts` — *"a 2xx with `trade` RENAMED
  (can_trade) REFUSES the publish"*.
- **Reverted →** `166 passed`.
- **Verdict: GENUINELY CLOSED** — and the guard bites at the *derived* sibling schema too, which is
  the class-level property the fix claimed.

### M3 · B-15 (Cluster B) — `ApiKeyManager`'s enqueue-evidence guard, SECOND call site

- **Mechanism claimed PARTIALLY CLOSED:** the fix landed on `ApiKeyManager`, whose own comment
  certifies *"one shape at both members of the class, not two"*. The un-fixed third member
  (`SyncPreviewStep`) is the finding's residual and is **not** what I mutate — I mutate the half the
  register calls fixed.
- **Mutation:** at the **background-sync** call site (`ApiKeyManager.tsx:309`, the second of the two
  in-file members), `if (!isSyncEnqueued(body)) throw …` → `if (body === undefined) throw …`. Any 2xx
  now counts as enqueued — the pre-fix behaviour that started a 15-minute poll for a job that was
  never enqueued. The helper itself is untouched, so this is a call-site weakening, not a
  helper-deletion the whole file would notice.
- **Ran:** `npx vitest run src/components/strategy/ApiKeyManager.test.tsx`
- **Result: RED** — `1 failed | 17 passed (18)`, case *"observes an unrecognised 200 on the
  BACKGROUND sync too (same shape, both members)"*.
- **Reverted →** `18 passed`, `git status` clean.
- **Verdict: GENUINELY CLOSED** for the half the register claims. The per-site test exists, so the
  in-file class really is guarded at both members — the residual is coverage of the *third* member,
  which the register already reports as open.

### M4 · B-26 (Cluster B) — the error-first render guard (NOT the famous `setSuggestions(null)`)

- **Mechanism claimed CLOSED:** "B-26 CLOSED (I verified this one directly) — `PortfolioOptimizer.tsx:211`
  `setSuggestions(null)` before the fetch, `:280` error-first render guard, `:231` array guard."
  Second-member rule → I mutate the **render guard**, not the `setSuggestions(null)` everyone quotes.
- **Mutation:** `if (error || (computationStatus === "failed" && !suggestions))` →
  `if (computationStatus === "failed" && !suggestions)` — i.e. dropped the `error` disjunct the fix
  added, restoring the pre-fix guard that the file's own comment calls *unreachable after a re-run
  failure*. A client-side failure now falls through to the "never run" empty state.
- **Ran:** `npx vitest run src/components/portfolio/PortfolioOptimizer.test.tsx`
- **Result: RED** — `4 failed | 9 passed (13)`. Cases: *"removes every 'Add to portfolio' control when
  the re-run hits a breaker 503"*, *"reaches the client-side error state, which the server-rendered
  prop cannot express"*, *"renders the route's breaker sentence rather than swallowing it (B-27 must
  not over-fire)"*, *"does NOT render a raw caught message when the fetch itself rejects (B-27)"*.
- **Reverted →** `13 passed`.
- **Verdict: GENUINELY CLOSED.** Notably the *second* member of the fix is guarded by four
  independent cases, not one.

### M5 · D-14 / A-12 (Cluster D) — mutate the GUARD'S SUBJECT: an exclusion that enters the core

- **Mechanism claimed CLOSED:** "`seam-budgets.invariant.test.ts:723-759` reads each `SEAM_EXCLUSIONS`
  path from disk (comment-stripped) and asserts it neither **imports** nor **calls** the core."
  This is the highest-value shape to mutate: an allow-list whose members are hand-typed.
- **Mutation:** the **second** exclusion, `src/app/api/cron/warm-analytics/route.ts`, was made to
  enter the core — added `import { resilientFetch } from "@/lib/resilient-fetch"` and replaced its
  raw `fetch(\`${url}/health\`, …)` with `resilientFetch("portfolio-analytics", "/health", …)`. The
  file remains on the exclusion list, which is precisely the drift the guard exists to see.
- **Ran:** `npx vitest run src/lib/seam-budgets.invariant.test.ts src/__tests__/contracts/contracts-registry.test.ts src/lib/resilient-fetch.wiring.test.ts`
- **Result: RED** — `2 files failed · 3 failed | 144 passed (147)`. Cases:
  `seam-budgets.invariant.test.ts` — *"excluded path src/app/api/cron/warm-analytics/route.ts does not
  enter the resilience core"*; `resilient-fetch.wiring.test.ts` — *"every discovered binding is
  classified in the roster (a 14th binding FAILS)"* **and** *"only the six known files call the core
  (catches a variable-key call site)"*.
- **Reverted →** `147 passed`.
- **Verdict: GENUINELY CLOSED.** Two independent guards fired, including A-13/D-11's roster fence —
  so the roster is not merely present, it is load-bearing.

### M6 · D-10 (Cluster D) — a leg dropped from the SECOND multi-leg route-budget row

- **Mechanism claimed CLOSED:** "`SEAM_ROUTE_BUDGETS` rows are deep-compared to a hand-typed 15-row
  map, so **dropping a leg from a multi-leg row reddens**." This is the exact property, so I test it
  exactly — on the second multi-leg row, not the first (`validate-and-encrypt`, the 3-leg row the fix
  was written against).
- **Mutation:** removed `{ key: "encrypt-key", calls: 1 }` from
  `"src/app/api/strategies/create-with-key/route.ts"` (`resilient-fetch.ts:585-586`). A dropped leg
  silently halves that route's modelled worst case, and makes both SC-4a and SC-4b *more* comfortable
  — the failure mode D-10 names.
- **Ran:** `npx vitest run src/lib/seam-budgets.invariant.test.ts src/lib/seam-constants.pin.test.ts`
- **Result: RED** — `1 failed | 145 passed (146)`, case *"SC-4d / D-10 — every route row's CONTENTS
  match the hand-typed map"* in `seam-budgets.invariant.test.ts`.
- **Reverted →** `77 passed`.
- **Verdict: GENUINELY CLOSED.** Note the honest reading: **only one** assertion caught it — the
  headroom invariants stayed green, exactly as D-10 predicted. The deep-compare is the sole guard,
  and it works.

### M7 · D-12 (Cluster D) — a SECOND production declaration of the breaker sentence

- **Mechanism claimed CLOSED:** "One declaration: `src/lib/seam-copy.ts:65`… **Measured:** every
  remaining literal copy of the string in the repo is in a `*.test.ts` file; **zero production
  re-declarations**. Cross-file production drift is now unconstructable rather than merely asserted."
- **Mutation:** in the **second** of the ten production importers, `src/app/api/bridge/route.ts:157`,
  replaced `{ error: CIRCUIT_OPEN_COPY }` with the sentence **inlined as a literal** and dropped the
  now-unused import. Byte-identical copy, so nothing user-visible changes today — this is purely the
  re-declaration that makes future drift constructible.
- **Ran:** `npx vitest run src/lib/seam-copy.pin.test.ts src/app/api/bridge`
- **Result: RED** — `2 failed | 54 passed (56)`. Cases: *"ZERO production files re-declare the
  sentence — the leaf is the only source"* and *"EXACTLY ten production files import the leaf —
  pinned to a literal count"*.
- **Reverted →** `5 passed`.
- **Verdict: GENUINELY CLOSED.** Two independent framings (re-declaration scan **and** importer
  count) both fired, so an "innocent" refactor cannot slip past either.

**Python baseline confirmed in this worktree:** `python3 -m pytest -q` → **4778 passed, 96 skipped**,
75.7 s. Matches the supplied baseline.

### M8 · C-09 (Cluster C) — the anonymous teaser's rate-limit VALUE

- **Mechanism claimed CLOSED:** "C-09 CLOSED, and it is a real redesign — … the anonymous teaser gets
  its own `process_key:anon` 30/h bucket."
- **Mutation:** `analytics-service/routers/process_key.py:100`,
  `_PROCESS_KEY_ANON_LIMIT = "30/hour"` → `"300/hour"` — the anonymous bucket now exceeds a paying
  tenant's, inverting the property the constant's own docstring states (*"Deliberately BELOW a
  tenant's… anonymous traffic is the untrusted half"*).
- **Ran (1):** `pytest -q tests/test_rate_limit_contract.py tests/test_limiter_identity.py` →
  **GREEN, 75 passed**. The two files whose names say "rate limit" do not pin the size.
- **Ran (2):** full `pytest -q` → **RED, `2 failed, 4776 passed, 96 skipped`**, both in
  **`tests/test_process_key.py`**: `test_process_key_limit_sizing_literals`
  (`assert '300/hour' == '30/hour'`) and
  `test_anon_bucket_exhausts_at_30_without_touching_a_tenant` (*"the 31st anonymous call must be
  throttled"*).
- **Reverted →** `103 passed` in `test_process_key.py`.
- **Verdict: GENUINELY CLOSED** — with a caveat worth recording: the guard is **not** where a reader
  would look for it. A reviewer running only the contract-named files would have concluded the value
  was unpinned. The behavioural test (`31st call throttled`) is the stronger of the two, because it
  pins the economics rather than the literal.

### M9 · C-09 second guard (Cluster C) — the tenant claim's EXPIRY boundary, not its MAC

- **Mechanism claimed CLOSED:** "a tenant bucket keyed on an **HMAC-verified `X-Tenant-Claim`**
  (`services/rate_limit.py:305-349`)". Second-member rule: `verify_tenant_claim` enforces **two**
  things — the MAC (the one everybody remembers) and `exp` (*"so a claim captured once — from a log,
  a proxy, a replayed request — is not a permanent tenant-bucket credential"*). I moved the
  **expiry** boundary.
- **Mutation:** `services/rate_limit.py:287`, `if int(exp_raw) < int(time.time()):` →
  `if int(exp_raw) < int(time.time()) - 86400:` — a captured claim stays valid for a further 24 h.
- **Ran:** full `pytest -q`
- **Result: RED** — `2 failed, 4776 passed, 96 skipped`:
  `tests/test_limiter_identity.py::TestBucketBehaviour::test_expired_claim_cannot_reach_a_tenant_bucket`
  and `tests/test_process_key.py::test_key_func_expired_claim_falls_to_unverified`.
- **Reverted →** `171 passed` across both files.
- **Verdict: GENUINELY CLOSED.** The replay window is pinned behaviourally at two independent call
  sites, not just at the MAC.

### M10 · C-08 (Cluster C) — the cross-tenant read scope, at the SECOND read site

- **Mechanism claimed CLOSED:** "The cross-tenant leak **is** closed: … both `process_key.py` read
  sites filter on both columns." (The register separately reports that this fix introduced a
  double-submit regression — that is a *different* defect and is not what this mutation tests.)
- **Mutation:** at the **second** read site (`process_key.py:1276-1281`, the 23505 race-winner
  re-fetch), removed `.eq("strategy_id", strategy_id)` so the row is fetched by
  `wizard_session_id` alone — the pre-fix key, i.e. "re-fetch and echo another strategy's row".
- **Ran:** full `pytest -q`
- **Result: RED** — `1 failed, 4777 passed, 96 skipped`:
  `tests/test_process_key.py::test_pyapi_01d_race_winner_read_is_tenant_scoped` —
  *"PYAPI-01d: the 23505 race-winner re-fetch must be scoped to…"*.
- **Reverted →** `103 passed`.
- **Verdict: GENUINELY CLOSED.** The less-obvious of the two read sites has its own named test.

### M11 · PYAPI-05 / Cluster C — the 503 arm's "wait comes from the TABLE" guard

- **Mechanism claimed CLOSED:** the PYAPI-05 status contract in
  `analytics-service/services/error_contract.py`. Second-member rule: the register and its tests
  concentrate on the **500** arm's dependency-membership check, so I mutate the **503** arm's C4(a)
  guard instead — *"the advertised wait must come FROM the table, never from the raise site"*.
- **Mutation:** deleted the `if retry_after != _expected: raise ValueError(...)` block in
  `_validate` (`error_contract.py:148-154`). A raise site may now inline any wait it likes while
  still passing every other 503 check.
- **Ran:** full `pytest -q`
- **Result: RED** — `4 failed, 4774 passed, 96 skipped`, all in
  **`tests/test_error_contract_retry_after_source.py`**:
  `test_503_supabase_rejects_a_drifted_retry_after` and
  `test_503_mt5_gateway_rejects_a_drifted_retry_after`, each parametrised over both entry points
  (`service_error`, `service_error_response`) — *"DID NOT RAISE ValueError"*.
- **Reverted →** `12 passed`.
- **Verdict: GENUINELY CLOSED.** Both dependencies in the table and both entry points are covered —
  this is a class-shaped test, not a spot check.

### M12 · PYAPI-06 / C-11 (Cluster C) — the unset-vs-mismatched tag split, SECOND site

- **Mechanism claimed CLOSED:** the operator signal for a missing/stale platform secret, whose stated
  core is *"**distinct** tags for *unset* (deploy/config fault) vs *mismatched* (rotation drift or an
  attack) — conflating them is what makes a rotation look like an attack"*.
- **Mutation:** there are two `"mismatched"` call sites; I took the **second**
  (`main.py:805`, `SERVICE_KEY`) and changed it to `_capture_secret_misconfig("unset", "SERVICE_KEY")`
  — a rotation drift now reports as an unset secret. Nothing else changed; the log line above it is
  untouched, so a reviewer reading the diff sees only one word.
- **Ran:** full `pytest -q`
- **Result: RED** — `1 failed, 4777 passed, 96 skipped`:
  `tests/test_secret_misconfig_signal.py::test_unset_and_mismatched_carry_distinct_tags` —
  *"absent and mismatched must be distinguishable"*.
- **Reverted →** `17 passed`.
- **Verdict: GENUINELY CLOSED.**

### M13 · B-23 (Cluster B) — the non-429 "advertised wait" arm in `PortfolioImpactPanel`

- **Mechanism claimed CLOSED:** "B-23 (`PortfolioImpactPanel`) is genuinely fixed" — the
  `Retry-After` read was hoisted above the status branch so a **breaker 503**, not just a 429, drives
  the countdown and disables Retry.
- **Mutation:** deleted the entire `if (retryAfter !== undefined) { … }` arm
  (`PortfolioImpactPanel.tsx:172-192`), so a 503 that advertised a wait falls through to
  `throw new Error(...)` and the wait is discarded — the pre-fix behaviour. The hoisted *read* is
  left in place, so only the consumption is removed; a diff reader sees the read still there.
- **Ran:** `npx vitest run src/components/portfolio/PortfolioImpactPanel.test.tsx`
- **Result: RED** — `2 failed | 43 passed (45)`: *"[140.3-09] a breaker 503 carrying Retry-After
  disables retry and drives the countdown"* and *"[140.3-09] a 503 with an HTTP-DATE Retry-After
  yields a finite wait, not NaN"*.
- **Reverted →** `45 passed`.
- **Verdict: GENUINELY CLOSED.**

### M14 · A-13 / D-11 (Cluster D) — a budget key SWAPPED for another VALID key

- **Mechanism claimed CLOSED:** "a discovery walk over the two clients + literal call sites is
  compared by **sorted set equality** to a hand-typed `EXPECTED_BINDINGS` roster… a vacuity fence
  (`discovered.length >= 14`)". The interesting mutation is not deleting a binding (a length check
  would catch that) but **swapping** one for another valid key — the case the register says a length
  check would pass.
- **Mutation:** `src/lib/analytics-client.ts:606`, `{ budgetKey: "encrypt-key" }` →
  `{ budgetKey: "validate-key" }` on the **second** binding. Both keys exist, both typecheck, and the
  encrypt call now spends the validate budget and its breaker semantics.
- **Ran:** `npx vitest run src/lib/resilient-fetch.wiring.test.ts src/lib/seam-budgets.invariant.test.ts src/lib/analytics-client.test.ts`
- **Result: RED** — `3 failed | 172 passed (175)`, all in `resilient-fetch.wiring.test.ts`:
  *"'B-02' 'encryptKey' binds the 'encrypt-key' budget to '/api/encrypt-key'"*, *"every discovered
  binding is classified in the roster (a 14th binding FAILS)"*, and *"the roster covers exactly the
  13 budget keys (no orphan key, no unbound key)"*.
- **Reverted →** `22 passed`.
- **Verdict: GENUINELY CLOSED.** The set-equality framing does what the register claims a count could
  not: it saw a swap, not just a deletion.

### M15 · D-08 (Cluster D) — a budget timeout moved off its pinned literal

- **Mechanism claimed CLOSED:** "`EXPECTED_TIMEOUT_MS` hand-types **all 13** budgets; `it.each`
  asserts each row against its literal… `0 of 13 pinned` → `13 of 13 pinned`."
- **Mutation:** `resilient-fetch.ts:404`, `"encrypt-key".timeoutMs` `30_000` → `45_000` (the second
  row, not the first).
- **Ran:** `npx vitest run src/lib/seam-constants.pin.test.ts src/lib/seam-budgets.invariant.test.ts`
- **Result: RED** — `1 failed | 145 passed (146)`, case *"encrypt-key.timeoutMs is the pinned
  literal"*.
- **Reverted →** `69 passed`.
- **Verdict: GENUINELY CLOSED.** Worth noting what did **not** fire: SC-4b's headroom invariant stayed
  green, because 45 s still fits the route's 300 s ceiling. The pin is the only guard for a
  within-headroom drift — which is precisely why D-08 mattered.

### ⚠️ M16 · B / `VENUE_WIRE_CODE_TO_VERDICT` — **GREEN. The first honest miss.**

- **Mechanism claimed CLOSED:** the wizard's venue wire-code table — *"THE TABLE IS CLOSED AND
  HAND-TYPED"*, six members, consumed by `classifyKeyValidationError` before the substring cascade.
  A hand-typed roster is exactly the shape my sampling rule targets.
- **Mutation:** deleted the member `["PROBE_FAILED", { code: "KEY_PROBE_FAILED", status: 503 }]`
  from `src/lib/wizardErrors.ts:1344`. Second-member rule chose it: it is the second entry, and it
  sits in the table's *first* group (the ones the row comment calls *"already correct through the
  cascade; mapped explicitly so the verdict no longer depends on an accident of substring
  ordering"*).
- **Ran (1):** `npx vitest run src/lib/wizardErrors.test.ts` → **GREEN, 116 passed**.
- **Ran (2):** full `npx vitest run` → **GREEN — `715 files passed | 19 skipped · 9792 passed | 287
  skipped`, byte-identical to baseline.**
- **Reverted →** `116 passed`.
- **Is the deleted row live code?** Yes. `analytics-service/services/exchange.py:1254` sets
  `result["error_code"] = "PROBE_FAILED"`, and `tests/test_envelope_recoverable.py:46` lists it in the
  recoverable set. It is a wire code this service really emits.
- **Why nothing reddened:** `wizardErrors.test.ts` has explicit cases for `EXCHANGE_UNAVAILABLE`,
  `NETWORK_UNAVAILABLE`, `DDOS_PROTECTION` (the table's second group — *"the three the cascade got
  wrong"*) and for `RATE_LIMITED`. It has **no case at all** for `PROBE_FAILED` as a *wire code*.
  Every `KEY_PROBE_FAILED` test in the repo
  (`create-with-key/route.test.ts:397`, `composite/add-key/route.test.ts:218`) reaches the verdict
  through the **substring cascade** on the message *"could not verify permission scopes"* — so they
  keep passing with the table row gone.
- **Blast radius of the real defect this mutation stands in for:** bounded but real. A
  `PROBE_FAILED` whose *message* still matches the cascade is unaffected; a `PROBE_FAILED` whose
  message is reworded upstream — the exact scenario the row's own comment says it exists to defend
  against — now falls through the cascade to `UNKNOWN`. That is the DOGFOOD-3 dead-end class the
  whole programme exists to kill.
- **Verdict: CLOSED AT SOURCE ONLY.** The mechanism is present and correct at source; the harness
  does not bite when you remove it. The tests cover the members whose *behaviour changed* when the
  table was introduced, and not the members added for defence in depth — so the table is guarded
  where it was already right and unguarded where it is the only thing standing.

### M17 · B / `SEAM_CODE_TO_WIZARD_CODE` — the SIBLING closed table (control for M16)

- **Why:** M16 found one hand-typed table unguarded at one member. The honest next question is whether
  that is a property of the *table shape* or of that one row. So I mutated the **other** closed table
  in the same file — same shape, different finding — rather than hunting for a variant of M16 that
  reddens.
- **Mutation:** deleted `["UPSTREAM_NETWORK_ERROR", "SERVICE_UNREACHABLE"]` (`wizardErrors.ts:1559`).
  Second-member rule: the class is "the two transport wire codes that share one wizard target", and
  `UPSTREAM_NETWORK_ERROR` is the second of the pair.
- **Ran:** `npx vitest run src/lib/wizardErrors.test.ts`
- **Result: RED** — `2 failed | 114 passed (116)`: *"both of process-key-client's transport codes
  translate onto SERVICE_UNREACHABLE"* and *"ANTI-REGRESSION: the two transport wire codes still
  translate as they did"*.
- **Reverted →** `116 passed`.
- **Verdict: GENUINELY CLOSED.** So M16's gap is **row-level, not shape-level**: the same file's other
  closed table is pinned member-by-member, including the redundant second member of a pair.

---

# Summary table

| # | Finding | Cluster | Mutation applied | What I ran | RED/GREEN | Failures + files | Verdict |
|---|---|---|---|---|---|---|---|
| M1 | B-01 | B | dropped `"SERVICE_UNAVAILABLE_RETRY"` from `ConnectKeyStep`'s `KNOWN_CREATE_WITH_KEY_CODES` | `ConnectKeyStep.test.tsx` | **RED** | 1 failed / 32 — `ConnectKeyStep.test.tsx` | **GENUINELY CLOSED** |
| M2 | B-14 | B | `LivePermissionsSchema.trade` → `.optional()` (`analytics-schemas.ts:365`) | `finalize-wizard/route.test.ts` + `analytics-schemas.test.ts` | **RED** | 4 failed / 166 — both files | **GENUINELY CLOSED** |
| M3 | B-15 | B | 2nd call site: `isSyncEnqueued(body)` → `body === undefined` (`ApiKeyManager.tsx:309`) | `ApiKeyManager.test.tsx` | **RED** | 1 failed / 18 | **GENUINELY CLOSED** (the half claimed fixed) |
| M4 | B-26 | B | dropped the `error \|\|` disjunct from the render guard (`PortfolioOptimizer.tsx:280`) | `PortfolioOptimizer.test.tsx` | **RED** | 4 failed / 13 | **GENUINELY CLOSED** |
| M5 | D-14 / A-12 | D | 2nd `SEAM_EXCLUSIONS` member (`cron/warm-analytics`) made to import + call the core | 3 seam guard files | **RED** | 3 failed / 147 — `seam-budgets.invariant`, `resilient-fetch.wiring` | **GENUINELY CLOSED** |
| M6 | D-10 | D | dropped the `encrypt-key` leg from the 2nd multi-leg route row | `seam-budgets.invariant` + `seam-constants.pin` | **RED** | 1 failed / 146 | **GENUINELY CLOSED** |
| M7 | D-12 | D | 2nd importer (`bridge/route.ts`) re-declares `CIRCUIT_OPEN_COPY` inline | `seam-copy.pin.test.ts` + `api/bridge` | **RED** | 2 failed / 56 | **GENUINELY CLOSED** |
| M8 | C-09 | C | `_PROCESS_KEY_ANON_LIMIT` `30/hour` → `300/hour` | targeted 2 files → **GREEN**; full pytest | **RED** (full only) | 2 failed / 4778 — `tests/test_process_key.py` | **GENUINELY CLOSED** (guard not where you'd look) |
| M9 | C-09 (2nd guard) | C | `exp` boundary moved 24 h (`services/rate_limit.py:287`) | full pytest | **RED** | 2 failed — `test_limiter_identity.py`, `test_process_key.py` | **GENUINELY CLOSED** |
| M10 | C-08 | C | 2nd read site: dropped `.eq("strategy_id", …)` from the race-winner re-fetch | full pytest | **RED** | 1 failed — `test_process_key.py` | **GENUINELY CLOSED** |
| M11 | PYAPI-05 | C | deleted the 503 arm's `retry_after != _expected` guard | full pytest | **RED** | 4 failed — `test_error_contract_retry_after_source.py` | **GENUINELY CLOSED** |
| M12 | PYAPI-06 / C-11 | C | 2nd `"mismatched"` site → `"unset"` (`main.py:805`) | full pytest | **RED** | 1 failed — `test_secret_misconfig_signal.py` | **GENUINELY CLOSED** |
| M13 | B-23 | B | deleted the non-429 "advertised wait" arm in `PortfolioImpactPanel` | `PortfolioImpactPanel.test.tsx` | **RED** | 2 failed / 45 | **GENUINELY CLOSED** |
| M14 | A-13 / D-11 | D | 2nd binding: `encrypt-key` budget key **swapped** for `validate-key` | 3 files | **RED** | 3 failed / 175 — `resilient-fetch.wiring.test.ts` | **GENUINELY CLOSED** |
| M15 | D-08 | D | `encrypt-key.timeoutMs` 30 000 → 45 000 | `seam-constants.pin` + `seam-budgets.invariant` | **RED** | 1 failed / 146 | **GENUINELY CLOSED** |
| M16 | B / `VENUE_WIRE_CODE_TO_VERDICT` | B | deleted the live `PROBE_FAILED` row from the closed hand-typed table | `wizardErrors.test.ts` **and full `vitest run`** | **GREEN** | **0 failed — 9792 passed / 287 skipped, byte-identical to baseline** | **CLOSED AT SOURCE ONLY** |
| M17 | B / `SEAM_CODE_TO_WIZARD_CODE` | B | deleted the 2nd of the two transport codes (`UPSTREAM_NETWORK_ERROR`) | `wizardErrors.test.ts` | **RED** | 2 failed / 116 | **GENUINELY CLOSED** |

---

# The number that matters

**16 of 17 sampled CLOSED mechanisms are genuinely guarded — 94%.**

By cluster: **B 6/7 (86%)** · **C 5/5 (100%)** · **D 5/5 (100%)**.

## What the number does and does not mean

- **It is a lower bound on quality and an upper bound on comfort.** The sample was *deliberately
  adversarial*: hand-typed rosters, allow-lists, single-file edits, and always the second member of a
  class. If anything, this sampling should have found MORE misses than a uniform sample would, so
  94% is not a flattering draw — it is the pessimistic corner coming back clean.
- **It does not generalise to all 58 CLOSED verdicts.** 17 of 58 is a 29% sample, non-random by
  construction. A 94% point estimate on 17 draws has a wide interval (roughly 71–100% at 95%
  confidence on a binomial reading), and my sample is not i.i.d. anyway.
- **It says nothing about the PARTIAL and OPEN findings** — 34 of 94 — which the register already
  reports as unfixed, nor about the C-08 double-submit regression it flags as live.

## Confidence

**High** that the seam-adjacent machinery (Clusters C and D) bites: 10 of 10 mutations there
reddened, several at more than one independent assertion, and two of them (M5, M14) tripped guards in
*different files* from the one I aimed at — which is what a class-level guard is supposed to do.

**Medium-high** on Cluster B. 6 of 7 reddened, but the one miss is in the cluster the register already
calls "by far the weakest", and it is the exact defect shape the programme keeps rediscovering: a
hand-typed roster is pinned at the members whose behaviour *changed* when it was written, and
unpinned at the members added for defence in depth. I sampled two of the six rows of that table; I do
not know the status of the other four (`AUTH_FAILED` and `RATE_LIMITED` are covered elsewhere in the
file; `EXCHANGE_UNAVAILABLE`, `NETWORK_UNAVAILABLE`, `DDOS_PROTECTION` have named cases).

## Biases I know I carry

1. **Target-selection bias, and it cuts both ways.** I picked mutation points by reading the fix
   comments, which are unusually detailed in this codebase. That *helped* me find semantically
   meaningful mutations, but it also steered me toward mechanisms whose authors were thinking hard —
   i.e. the ones most likely to have written a test. A reviewer who instead mutated code with *no*
   explanatory comment would likely find a lower rate.
2. **Runnability bias.** I could not exercise the live-Redis lane (`tests/redis/*`, D-01/D-13) or any
   SQL/RLS guard, so D-01 — which the register calls "the single most important closure in the set" —
   is **unverified by this run**. Everything I certify is CI-lane-reachable on a laptop.
3. **Green-is-boring bias.** Twelve consecutive REDs create real pressure to stop looking. M16 was the
   16th mutation; had I stopped at 12 — a defensible sample size — the answer would have been
   "12/12, 100%", and it would have been wrong. I did not tune M16 after it passed, and I did not
   re-run it hoping for a different answer.
4. **One-mutation-per-finding.** Each verdict rests on a single mutation. A finding I marked
   GENUINELY CLOSED may still have unguarded *other* members — M16 is the proof that this happens
   inside a single data structure.

## The one thing to act on

**`VENUE_WIRE_CODE_TO_VERDICT` needs a per-member `it.each`, the way `EXPECTED_TIMEOUT_MS` has one.**
The table is a live wire-contract surface, `PROBE_FAILED` is a code `services/exchange.py:1254`
really emits, and today its row can be deleted with a byte-identical `9792 passed`. The fix shape
already exists three files away (`seam-constants.pin.test.ts`'s "fails loud on a **missing** row"
pattern) — this is a copy, not an invention.

Because branch protection on `main` is OFF, every RED above **would have caught** the corresponding
regression at CI time; none of them **did stop** a merge, and the one GREEN would not have been
caught at all.

## Closing state (measured after the last revert)

| Check | Result |
|---|---|
| `grep -rn MUTANT src analytics-service e2e tools` | **0** |
| `git status --short` | **clean** (nothing staged, nothing modified, nothing untracked) |
| `npx vitest run` | **715 files passed / 19 skipped · 9792 passed / 287 skipped** — baseline |
| `cd analytics-service && python3 -m pytest -q` | **4778 passed / 96 skipped** — baseline |

Nothing was committed at any point.

## Provenance

Written incrementally, one entry per mutation, with each mutation reverted and re-verified green
before the next was applied. No two mutants were ever live at once. Nothing was committed.

