# Pitfalls Research

**Domain:** Adding five specific changes to a live, continuously-deployed platform — Next.js 16 App Router on Vercel + Supabase Postgres/RLS (migrations auto-apply on merge to `main`) + FastAPI worker on Railway (deploys only on a GREEN main check-suite) + GitHub Actions CI against a SHARED remote TEST Supabase project, with **no branch protection** (every CI gate is advisory at merge).
**Researched:** 2026-08-20
**Confidence:** HIGH on the four repo-verified areas (share-token cache, ranking population, dependency majors, structlog); MEDIUM on GitHub Actions concurrency semantics (verified against current community docs + the repo's own measured evidence, but GitHub does not document the pending-eviction rule in its reference page).

**Scope note.** This is a TARGETED pitfalls pass for v1.20 (founder call 2026-08-20). It covers only the five riskiest areas named in the milestone brief. It is not an ecosystem sweep, and it re-verifies each claim against the code at HEAD rather than against the ledger's description of the code.

**Method.** Every "measured" claim below was read out of the repo at HEAD during this pass (file + symbol cited). Every external claim carries its source. Where TODOS.md states something this pass found to be wrong or incomplete, that is called out explicitly — see Pitfall 1, which corrects the remedy TODOS.md proposes.

---

## Critical Pitfalls

### Pitfall 1: "Shrink the concurrency group" does not fix the eviction — the bug is RUN COUNT, not member count

**What goes wrong:**
`shared-test-db` is a repo-wide GitHub Actions concurrency group with `cancel-in-progress: false`, carried by three jobs in `ci.yml` (`sql-tests` :936, `python` :1143, `e2e-seeded` :1540). A GitHub concurrency group holds **at most one RUNNING + one PENDING entry, globally across all runs**. When a third request arrives it does not queue — it **evicts** the pending one, which concludes `cancelled` with `steps: []` and the log line `Canceling since a higher priority waiting request for shared-test-db exists`. `cancel-in-progress: false` protects only the *running* job; there is no `cancel-pending: false` option (the feature request, community discussion #12835, is still open).

Two consequences, both already observed on this repo (TODOS.md, v0.54.0.0 hotfix `861a4d91`, CI run 31273384829 attempt 1):
1. The run concludes **`cancelled`, not `failure`** — it renders **grey**, reading as "no result" rather than a red gate.
2. Railway waits on the main check-suite and **silently skips the analytics deploy** on a non-green suite (`skippedReason="CI check suite failed"`), so frontend + auto-applied migrations land on PROD while the Python service stays on old code. That is exactly the stale-prod state GitHub issue **#616** was filed for.

**Why it happens:**
Three misreadings compound.
- **`cancel-in-progress: false` reads like "never cancel anything."** It isn't. It is documented as protecting the in-progress run only. The repo's own comment at `ci.yml:1133-1141` reasons correctly about cross-PR contention and then concludes the group "does NOT cancel in-flight runs, so a push-to-main python job still records its required per-SHA green check (it just waits its turn)" — true for the *running* case, false for the *queued* case, which is the one that fired.
- **⛔ TODOS.md's proposed remedy is insufficient.** It says: *"Real fix: serialize the group properly, or return it to two members."* **Reducing membership does not help.** With a single member and three concurrent runs (main push + two PRs), run A is running, run B is pending, run C arrives and evicts B. Membership count changes only how *fast* you reach three simultaneous requests; it does not change the eviction rule. The 2026-08-03 intra-run chain fix (`sql-tests` gained `needs: python`, `ci.yml:1134-1142`) addressed *intra*-run membership and was correct on its own terms — and the eviction still fired five days later, because the 2026-08-08 event was **cross-run**.
- **A cancelled run looks like an operator action.** Nobody triages grey.

**How to avoid:**
Three layers; treat the first two as required and the third as a costed alternative.

1. **Replace the native group with an external FIFO lock on the DB-touching jobs.** `ben-z/gh-action-mutex` implements a distributed mutex via atomic git-ref pushes to an orphan branch (optionally in a separate repo); `softprops/turnstyle` and `actions-mutex` are equivalent-shaped alternatives. All of them *queue* instead of cancelling. Cost to plan for: a job killed mid-hold leaks the lock, so whichever action is chosen must have a TTL / steal path and a documented manual-unlock runbook. Do not adopt one without that.
2. **Stop treating `cancelled` as "no result."** Add a `workflow_run`-triggered watcher that fires when a `push`-to-`main` CI run concludes `cancelled` and either auto-`gh run rerun --failed` or opens a dedup'd P1 issue. This closes the #616 *mechanism* independently of whether the lock works, and it is the only layer that also covers cancellation causes nobody has thought of yet. The repo already has the pattern to copy: `analytics-deploy-verify.yml` (dedup'd issue filing, mirroring `nightly.yml` / `cassette-refresh.yml`).
3. **Structural alternative worth costing:** give PR runs their own ephemeral/branch database so PRs never contend for the shared TEST project at all. Then the group can be scoped to main-only pushes, where serialization is trivially satisfied. Highest cost, permanently removes the whole class — and it also removes the daily stale-`compute_jobs` backlog described in the note at the end of the phase-mapping table.

⛔ **Do NOT "finish the chain"** by adding more `needs:` edges to serialize the group. `ci.yml:1543-1552` and `:1126-1133` both document why: a skipped `needs:` job skips its dependents, and the `if:` conditions diverge on `workflow_dispatch` (`sql-tests` requires `github.event_name == 'push'`; `e2e-seeded` only requires `!= 'pull_request'`), so the chain would disable `e2e-seeded` on every manual run and trip the aggregator's skip check. This trap has already been found once by a `/ship` review (2026-08-03) — it will look like the obvious fix again.

**Warning signs:**
- Any run on `main` with conclusion `cancelled` (grey) rather than `success`/`failure`.
- A job whose API record shows `steps: []` and a duration under a minute.
- `Canceling since a higher priority waiting request for shared-test-db exists` in any job log.
- `analytics /health` `git_sha` != main HEAD for more than ~15 minutes after a merge.
- ⚠️ Detection today is bounded at **~6h** by `analytics-deploy-verify.yml`'s cron — and that workflow deliberately `exit 0`s even when prod is stale (a red check on HEAD would make Railway skip the very deploy it verifies). So the *loud* signal is a filed issue, not a red check. Do not plan a gate that assumes CI will go red here.

**Phase to address:**
**OPS — and it must be the FIRST phase of the milestone (≈158).** It is a hard predecessor of **DEPS**: the dependabot campaign is 9 open PRs (verified: #686, #685, #646, #645, #643, #627, #626, #614, #612). Landing them while the group is unfixed means up to 9 concurrent runs contending for one group slot, which *guarantees* main-branch eviction and therefore guarantees at least one silently-skipped analytics deploy.

---

### Pitfall 2: Threading the share token through the factsheet `cacheKey` string is a silent no-op that publishes private strategies

**What goes wrong:**
`src/app/factsheet/[id]/v2/page.tsx` caches the factsheet payload with `unstable_cache`. The wrapper is:

```ts
function buildFactsheetPayloadCached(cacheKey: string) {
  const [id] = cacheKey.split("::");
  return unstable_cache(
    async () => fetchAndBuildPayload(id, withPublishedOnly),
    ["factsheet-v2-payload-v6", id],
    { revalidate: 3600, tags: ["factsheet-v2", `factsheet-v2:${id}`] },
  )();
}
```

Next derives the cache entry from the callback's source text + the `keyParts` array + the (empty) args array. The `cacheKey` **string** the page passes in is split at `"::"` and everything after the id is **discarded**. The file states this explicitly (header comment, "CACHE KEY REALITY (corrected phase 148 — the previous claim here was false)"): *"Appending a suffix yields the SAME entry."*

So the intuitive SHARELINK-01 fix — "make the cache key include the token, e.g. `${id}::${token}`" — compiles, type-checks, passes a unit test that asserts the constructed key string, and **writes a token-lane (private-strategy) payload into the id-keyed entry that is served to every anonymous visitor for the full 3600s TTL.** That is strictly worse than the bug being fixed, and TODOS.md lines 56-62 already name it as THE landmine.

**Why it happens:**
The wrapper's signature *invites* the mistake: it takes a `cacheKey: string` that looks composable, and the `"::"` split is a vestige of a previous (documented-as-false) belief that `computed_at` busted the cache. A reviewer reading the call site sees a key being built with a token in it and reasonably concludes the lanes are separated. Only the wrapper body disproves it, and the wrapper body is ~250 lines away.

**How to avoid:**
- **The token lane MUST bypass `buildFactsheetPayloadCached` entirely** and call `fetchAndBuildPayload(id, <token-scoped predicate>)` directly — the *exact* shape the owner lane already uses (`page.tsx` ~:527-537: *"⛔ The owner arm calls the builder DIRECTLY: no cache read, no cache write."*). Do not invent a new mechanism; extend the proven one to a third lane.
- Keep `buildFactsheetPayloadCached`'s predicate a **literal** (`withPublishedOnly`) and keep the visibility parameter OFF its signature. `page.tsx` :279-294 documents this as deliberate: *"Keeping the parameter off the signature makes that unrepresentable."* A "small refactor" that parameterizes it to serve three lanes destroys the whole guard.
- Do not remove `export const dynamic = "force-dynamic"` (`:33`). It is the RESPONSE-level half of the protection (the `unstable_cache` concern is the DATA-level half) and its comment states the failure mode is fail-open.
- Set an explicit `Cache-Control: private, no-store` on the token lane's response. `force-dynamic` prevents Next's static cache, but any future `revalidate`/`s-maxage` added to this route would make Vercel's shared CDN the *next* poisoning channel, and a `?s=` query param does not by itself create a distinct CDN entry unless the route varies on it.
- **`generateMetadata` is a second, separate surface.** It runs its own query with `withPublishedOnly` on the request-scoped client. Two rules: (a) never widen it with the token (that would put private titles/descriptions into the metadata path), and (b) expect link unfurlers (Slack, iMessage, Twitter) to fetch the token URL server-side — so whatever metadata the token lane emits ends up in a third party's logs along with the token. Emit generic metadata on the token lane.

**Warning signs:**
- Any diff that adds a parameter to `buildFactsheetPayloadCached`, or makes its `withPublishedOnly` argument a variable.
- Any diff that adds a token/session/user value into the `cacheKey` string rather than into `keyParts` — and note that even the *correct-looking* `keyParts` fix (`["factsheet-v2-payload-v6", id, token]`) is the wrong answer here: it works, but it creates an unbounded per-token entry population and puts the secret into the cache-key namespace. Bypass, don't re-key.
- A test that asserts the *key string* instead of asserting *observable cross-request behavior*.
- The `v6` shape-version suffix being bumped without a corresponding comment — the file's bump log (v2→v6, each naming the specific field and the specific fail-open it prevents) is the institutional memory here.

**Phase to address:**
**SHARE (SHARELINK-01).** Plan as a full GSD phase (migration + read lane + UI + revoke + cache-key change), per TODOS.md line 71. Its acceptance test must be **adversarial and sequenced**: request the factsheet via the token FIRST, then request the bare `/factsheet/<id>` anonymously and assert it STILL 404s. Extend `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` with a token-lane row rather than writing a parallel test file — a second file drifts. The test must be demonstrated RED with the bypass neutered (founder rule: a test that cannot fail is worse than none).

⛔ Do not start this on `feat/phase-156-connect-refactor` — Phase 156's Migration B is still pending against `strategies` (TODOS.md lines 72-73).

---

### Pitfall 3: The share token leaks through channels `Referrer-Policy` does not cover — and the mitigation is not "add a header"

**What goes wrong:**
The founder decision (2026-08-13) is explicitly motivated by the fact that **ids leak structurally**: browser history, `Referer`, analytics, screenshots, support tickets, `/compare?ids=`. A `?s=<token>` URL inherits **every one of those channels**. The difference is that a token is *revocable* — which only helps if revocation is actually immediate and the leak is actually noticed.

The repo sets `Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts:79`). Per MDN and PortSwigger, that policy strips the query string on **cross-origin** navigation only. It does nothing about:
- **Same-origin** navigation and subresource requests, which still carry the full URL including `?s=`.
- **In-page JavaScript reading `location.href`** — which is what `@sentry/nextjs` does for transaction names, breadcrumbs and (if enabled) session replay. A Sentry event from a token page carries the token in its URL field.
- **Server / CDN / platform access logs** — Vercel request logs record the full request line.
- Browser history and history sync.
- Link unfurlers fetching the URL server-side.

**Why it happens:**
"We set a Referrer-Policy" reads as a complete answer, and the modern default *is* the recommended value — for the one channel it covers. The other channels are invisible in code review because none of them appear in the diff.

**How to avoid:**
- **Copy the `scenario_shares` design wholesale.** `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` already solved this exact problem for scenarios, and its header enumerates the invariants: `token_hash` at rest (**never** the raw token); one `SECURITY DEFINER` read RPC as the *only* anon path; `REVOKE ALL FROM anon` on the table itself; a partial `UNIQUE (scenario_id) WHERE revoked_at IS NULL` so a re-share must revoke first; `revoked_at IS NULL` filtered **inside** the RPC body; and a single TS digest source-of-truth (`src/lib/scenario-share-token.ts`) so the hash is computed in exactly one place. The RPC takes a precomputed sha256 hex because `pgcrypto`/`digest` is not installed — the same constraint applies to a strategy token.
- ⚠️ **A SECDEF function reachable by `anon` needs an explicit `GRANT EXECUTE TO anon`.** Without it anon gets 42501, SSR swallows it, and the page renders empty with a clean console — a silent failure that reads as "no data" rather than "broken." (This repo has been bitten by it before.)
- Set `Referrer-Policy: no-referrer` on the factsheet route specifically (a per-route override), not just the global default.
- Scrub the `s` param in Sentry via `beforeSend` / `beforeBreadcrumb` **before** the token lane ships. Verify by triggering a real error on a token URL and reading the event in Sentry — do not assert it from the config file.
- **Unknown token and unknown id must produce the byte-identical 404.** Otherwise the token endpoint becomes an oracle for "this id exists but is private," re-creating the enumeration risk the token was meant to remove.
- Revocation must be provably immediate: assert **0 rows on the very next request** after `revoked_at = now()`. The scenario migration pins exactly this ("revoke immediacy (0 rows after revoked_at = now())") — reuse the assertion. If the token lane is uncached (Pitfall 2), immediacy is free; if anyone later adds caching, revoke silently becomes "revoked in up to an hour."
- **Cross-REQ coupling to flag now:** the milestone's SEC group includes a `MUTATING_RPC_NAMES` gap. A new mint/revoke RPC must be added to that list or the mutation gate misses it. Two REQ groups, one edit — plan the dependency rather than discovering it at review.

**Warning signs:**
- The raw token appearing in any `.select()` projection, log line, Sentry event, or error message.
- A revoke path implemented as `DELETE` rather than setting `revoked_at` (destroys the audit trail and makes "was this link ever live?" unanswerable).
- The token compared with `==` against a stored raw value anywhere.
- A revoke UI that mints a new token without invalidating the old one — the partial unique index is what makes that structurally impossible; omit the index and the invariant is merely a convention.

**Phase to address:**
**SHARE (SHARELINK-01)**, same phase as Pitfall 2. The migration and the read RPC are the same unit of work.

---

### Pitfall 4: Adding a `computation_status` filter to public percentiles has THREE distinct failure modes, and the naive filter hits all three

**What goes wrong:**
`getPercentiles` (`src/lib/queries.ts:141`) projects `PERCENTILE_ANALYTICS_COLUMNS` (`cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return`) from the embedded `strategy_analytics` for every published strategy, with **no `computation_status` filter at all**. Failed computations therefore rank. This is not hypothetical: `src/app/api/strategies/csv-finalize/route.ts:1493-1500` records the measured population — *"PROD carries 7 zero-dailies csv strategies whose failed rows DO hold a sharpe and a cagr, computed 2026-05-27 under older code."*

The obvious fix — `.eq("computation_status", "complete")` — introduces three new bugs:

1. **It silently drops `complete_with_warnings`.** That value marks a *successful* computation that used a documented fallback (`used_heuristic_capital` / `balance_error` DQ flags), written by `analytics_runner.run_csv_strategy_analytics`, `job_worker.run_stitch_composite_job` and `job_worker.run_poll_allocator_positions_job`. It was added by migration `20260602120000` and took a second migration (`20260707120000`) to stop being laundered back to `'complete'` by `sync_strategy_analytics_status`. Every read gate in the app already shares one predicate, `isComputedAnalytics()` in `src/lib/closed-sets.ts`, precisely so this cannot drift. An exact-match literal in `queries.ts` re-forks it and quietly removes every warnings-path strategy from the public ranking.
2. **Population cliff.** `getPercentiles` returns `null` at **two** separate floors (`strategies.length < 5`, then `rows.length < 5`), and the SQL cohort RPC `get_verified_cohort_rank` (migration `20260626120000`) suppresses below **min-N = 20**. Removing rows can cross either floor, turning percentile badges into honest-but-alarming absence across Discovery, Browse, the tearsheet, `/my-strategies` and the scenario peer-rank — for every user, at once, with no announcement.
3. **Filter placement changes join semantics.** Applying the filter on the embed as `strategy_analytics!inner(...)` drops the *strategy row* entirely; applying it after the fetch leaves the strategy present with null analytics. Those two land on **different** early-return gates (`strategies.length < 5` vs `rows.length < 5`). Same intent, different suppression behavior.

**Why it happens:**
The change reads as one line and one-sided. But percentiles are computed over a **live population**, so the moment the filter lands, *every* published factsheet's rank moves — including strategies whose own data did not change. There is no versioning, no audit trail, and no "the market changed" explanation available to a manager who sees their rank drop.

**How to avoid:**
- **Use `isComputedAnalytics()` from `closed-sets.ts`.** Never a status literal. If it must become server-side-filterable, derive the SQL `IN` list from `STRATEGY_ANALYTICS_COMPUTATION_STATUSES` rather than typing the values twice.
- **Move both engines together.** There are two ranking implementations and they claim parity: `percentile-core.ts` (TS — the ONE core `getPercentiles` and `getOwnRowPercentiles` share, per the FOUNDER RULING 2026-08-05) and `get_verified_cohort_rank` (SQL, decile-quantized, min-N 20). The SQL RPC's own comment asserts *"max_dd mirrors getPercentiles' direction exactly … for parity-by-construction"*, and its cohort is `status='published' AND a published strategy_verifications row AND all three rankable metrics non-null` — it **also** does not filter `computation_status`. Filtering only the TS side breaks the stated parity and makes the scenario blend's peer rank disagree with the factsheet's.
- **Measure the population delta on PROD before merging**, and put the numbers in the plan: count of published strategies with rankable analytics *with* and *without* the filter, plus the resulting `cohort_n` for the SQL RPC. If the filtered cohort lands under 20, the SQL side must be planned as a deliberate suppression, not discovered as an outage.
- **Snapshot before/after percentiles per published strategy** into the phase artifact. That is the only way the founder can later answer "why did my rank change?"
- Pin `phase-149-my-strategies-parity.test.ts` as a gate. `getOwnRowPercentiles` promises a draft *"if published, this would rank X"* — a one-sided population change makes the promise and the delivered rank diverge, and that test is the existing detector.
- Decide filter placement (embed `!inner` vs post-fetch) deliberately, and assert **both** counts in the test so a later refactor cannot flip it silently.

**Warning signs:**
- A string literal `"complete"` appearing in a ranking code path.
- A diff touching `queries.ts` or `percentile-core.ts` with no corresponding change to `get_verified_cohort_rank`.
- Percentile badges disappearing in local/CI fixtures — that is the min-N floor firing, not a rendering bug.
- `cohort_n` in the RPC response dropping while the percentiles go NULL.
- `csv-finalize`'s `CLOCK_SAFETY_KPI_COLUMNS` (`route.ts:1039`) drifting from `PERCENTILE_ANALYTICS_COLUMNS` — it is a deliberate duplicate (*"If that set ever changes, this one must follow — the guard is only as honest as the overlap"*) and the two have no automated link.

**Phase to address:**
**RANK**, early in the milestone (public-trust correctness). It should land **before** anything that publishes new strategies, so the population delta is measured against a stable cohort.

---

### Pitfall 5: `structlog`'s two failure modes look identical, and each candidate fix addresses only one — fixing the wrong one produces false closure

**What goes wrong:**
`analytics-service/services/logging_config.py:214` defines `configure_logging()` — its own docstring says *"Call BEFORE app = FastAPI()"* — and it configures with `cache_logger_on_first_use=True` (`:233`). `main.py` calls it **inside the lifespan**, i.e. long after module import. The processor chain it installs includes `_redact_processor`, positioned deliberately *after* `dict_tracebacks` so formatted traceback text (which carries `str(exc)` verbatim) is scrubbed — because ccxt exceptions embed HMAC signatures, and MT5 exception text can embed the account password (`mt5_client.py`, T-134-01 / T-153.3-23). **A logger that misses `_redact_processor` is a credential-disclosure surface, not a formatting nit.**

There are **two distinct** failure modes, and the two candidate fixes address different ones:

- **Mode A — a module-scope `.bind()` / `.new()`.** structlog's docs are explicit: `get_logger()` at module scope returns a *lazy proxy*; you must **never call `bind()` or `new()` in module or class scope**, because that resolves the bound logger against structlog's DEFAULT configuration. This holds **regardless of `cache_logger_on_first_use`**. Dropping the cache flag does not fix Mode A.
- **Mode B — first use before `configure_logging()`.** With `cache_logger_on_first_use=True`, the assembled logger is cached on first use and thereafter **ignores every later `structlog.configure()`**. A module imported before the lifespan that *emits* during import freezes the default chain forever. Dropping the cache flag fixes Mode B; hoisting configuration above router imports also fixes Mode B.

Corollary worth stating plainly, because it inverts the intuition: a module-level proxy that is only ever *called* (never bound) and whose first call happens after the lifespan is **already safe today**. So an audit that flags every module-level `get_logger` will over-report, and a fix that only removes the cache flag will under-fix.

**Why it happens:**
The two modes produce the same symptom (an unredacted log line), so the first plausible fix gets adopted and the audit closes. `mt5_client.py:158-176` already documents the class correctly and works around it with a per-call `_stage_logger()` — which means the repo has one hand-rolled fix and no systemic one.

**How to avoid — pitfalls of each candidate fix:**

**Candidate A — drop `cache_logger_on_first_use=True`:**
- It is a documented **performance** flag (structlog's `performance.md`). The Railway worker is a hot loop; removing it re-assembles the bound logger on every call. Measure the worker's log-heavy path before/after rather than asserting the cost is negligible.
- ⛔ **It does not close Mode A.** If any site does a module-scope `.bind()`, the fix ships green and the disclosure survives. This is the false-closure trap.
- It is a global config change: every test using `structlog.testing.LogCapture` then runs against a different assembly path. Expect at least one test to change color for a reason unrelated to the bug.

**Candidate B — hoist `configure_logging()` above router imports:**
- **Import-order fixes rot.** A future import reorder, a ruff/isort autofix, or a new module that pulls a router in transitively re-breaks it with **no test failing**. Ruff's `E402` (module-level import not at top of file) will fight the hoist, so you will add `# noqa: E402` per import — exactly the kind of line a later tidy-up deletes.
- ⚠️ **It changes the worker, not just the API.** `uvicorn main:app` also runs the worker loop in this repo (a local `uvicorn main:app` claims real compute jobs). Moving configuration from lifespan to module import changes logging initialization for **both** entrypoints (`main` and `main_worker`) — verify both.
- `configure_logging()` is only **partially** idempotent: the `setLogRecordFactory` install is gated by `_REDACT_FACTORY_INSTALLED`, but the `structlog.configure(...)` call is **not**. Calling it twice with the cache flag on leaves already-cached loggers bound to the *first* configuration, so test setup that reconfigures becomes order-dependent.
- ⚠️ `logging_config.py` also wraps the stdlib `LogRecord` factory as a second, handler-agnostic redaction bridge. Any reasoning about "did the redaction run?" must distinguish the structlog path from the stdlib path — a test can pass on one while the other leaks.

**⭐ Recommended shape: neither alone. Two artifacts.**
1. **A source-scan gate** (the repo's established pattern) that fails on any module-scope `structlog.get_logger(...).bind(...)` or module-scope bound-logger assignment under `analytics-service/{services,routers}/**`. This closes Mode A structurally and keeps closing it.
2. **A behavioral test** that imports a router module, THEN calls `configure_logging()`, THEN emits a record containing a synthetic HMAC-shaped string, and asserts it is scrubbed. This closes Mode B by *observation* rather than by import-order reasoning, so it survives a reorder.

Both must be demonstrated **RED with the fix neutered** before being accepted.

**Warning signs:**
- Any `signature=` / `sign=` / `apiKey=` fragment in `compute_jobs.last_error`, a Sentry event, or a Railway log line.
- **`structlog.testing.LogCapture` capturing ZERO events for a module.** `mt5_client.py`'s docstring notes that per-call binding *"is also what makes the events observable to `structlog.testing`"* — a stale cached logger is **invisible** to LogCapture, so a test asserting log content can pass or fail for entirely the wrong reason. Treat an empty capture as a suspected stale-logger symptom, not a missing log call.
- A new module copying the `_stage_logger()` per-call pattern — correct locally, but it means the systemic fix still isn't there.

**Phase to address:**
**OPS** (the "structlog redaction class" item already booked in the milestone's OPS group). Independent of the concurrency fix; can run in parallel.

⚠️ Run `mypy --strict` before shipping any analytics-service change: the GSD milestone flow runs pytest only, so mypy errors stay latent until PR CI.

---

### Pitfall 6: The dependency campaign has one item that lands on the PRODUCTION database and one that is not worth its risk

**What goes wrong:**
The 9 booked dependabot PRs are not equal-risk, and treating them as a uniform "bump and run the suite" campaign gets the ordering wrong. Verified at HEAD:

| PR | Bump | Real risk |
|----|------|-----------|
| #612 | `supabase/setup-cli` 2.1.1 → **3.0.0** | ⛔ **Highest blast radius in the milestone.** Used by `supabase-migrate.yml` (:167, :199) — the workflow that **auto-applies migrations to PROD on merge to main** — plus `migration-policy.yml` (:177) and `migration-drift-check.yml` (:48). All SHA-pinned at v2.1.1 with `version: 2.98.2`. v3 changes the install source from **GitHub releases to npm**, removes the `github-token` input (repo passes none — safe), and now "runs npm from the workspace" honoring caller npm config. |
| #614 | `typescript` 6.0.3 → **7.0.2** | Compiler rewritten in Go. The legacy Strada API (`import * as ts from "typescript"`) **does not exist** in 7.0 — a replacement is slated for 7.1. Anything wrapping it (typescript-eslint, ts-morph, custom transformers, dts plugins) is not guaranteed to work. TS7 also hard-errors what TS6 deprecated: `@types` packages must be listed explicitly (no implicit global pickup), `.js`/JSDoc handling changed, ES5 emit removed, `module` defaults to `esnext`. |
| #646 | `jsdom` 29.1.1 → **30.0.0** | Exactly one breaking change: **Node floor `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`.** Note the gap — **Node 23 and Node 25 are NOT in range.** Everything else is additive, but `getComputedStyle()` now converts lengths to px and CSS function serialization changed, which can move any assertion comparing computed-style strings. |
| #645 | `@testing-library/jest-dom` 6.9.1 → **7.0.0** | `@testing-library/dom` is now a **required peer dependency** and is **not declared** in this repo's `package.json` (only `jest-dom`, `react`, `user-event` are). Min Node 22. |
| #626 / #627 | `actions/setup-node`, `actions/setup-python` → **7.0.0** | Both "migrate to ESM" (runner-runtime change — fine on GitHub-hosted). setup-python 7 **removes the `pip-install` input** (verified: repo does not use it). setup-node 7 removes a dummy `NODE_AUTH_TOKEN` export (repo does not publish to npm). Low risk. |
| #643 | `actions/checkout` 7.0.0 → 7.0.1 | Patch, in the actions group. Low risk. |
| #686 | npm-minor-patch group, **29 updates** | Un-bisectable as one PR. |
| #685 | pip-minor-patch group, 8 updates | Moderate; the analytics-service suite is the gate. |

**Why it happens:**
Dependabot presents nine equally-shaped PRs. The riskiest one (`setup-cli`, which touches the prod-migration path) is visually the *smallest* diff — a SHA and a comment — so it reads as trivial and tends to get batched with the other actions bumps.

**How to avoid:**
- **`supabase/setup-cli@3` lands ALONE, never bundled into an actions-group PR.** Sequence: (1) verify `version: 2.98.2` resolves identically from npm (`npm view supabase@2.98.2`) — the pin's *meaning* changed even though its text didn't; (2) apply to `migration-drift-check.yml` (the dry-run workflow) FIRST and require a `db push` dry-run diff **byte-identical** to the v2 run; (3) only then touch `migration-policy.yml` and `supabase-migrate.yml`. Watch for the workspace-npm behavior picking up the repo's `.npmrc`/registry/proxy or the restored `node_modules` cache.
- **jsdom 30 — fix `engines` before merging.** `package.json` declares `"node": ">=22"` and `.nvmrc` says `22`; CI pins `node-version: 22` at 12 call sites (resolves to latest 22.x — satisfies `^22.22.2`, but verify the resolved patch). **Local dev is Node v25.8.1, which is outside jsdom 30's range entirely.** This **inverts** the repo's known `CI=Node22 vs local=Node25` trap: this bump is green in CI and unsupported locally. Narrow `engines.node` to jsdom's actual range so `npm install` fails loudly instead of warning, and run the suite under `PATH=/opt/homebrew/opt/node@22/bin` before merging. Separately, grep the test suite for `getComputedStyle` — the px-conversion and serialization changes are the only behavioral risk.
- **jest-dom 7 — declare the peer explicitly.** Add `@testing-library/dom` as a direct devDependency at the major `@testing-library/react@16` resolves, then assert `npm ls @testing-library/dom` shows **exactly one** copy. Two hoisted copies mean the matchers operate against a different DOM build than the render helper, which fails in ways that read as flakes.
- **⭐ Defer TypeScript 7.** Recommendation: `@dependabot ignore this major version` on #614 and stay on `typescript@^6`. Rationale: this repo runs `tsc --noEmit`, `eslint` with `@typescript-eslint/*` rules via `eslint-config-next@16.2.10`, `tsx` scripts, and `next build` — a stack with multiple compiler-API consumers, against a 7.0 that has no compiler API. The upside is build speed on a pre-revenue app; the downside is an un-bisectable toolchain break. If the speed is wanted, install `@typescript/native-preview` as a separate binary and leave `typescript` at 6. If it is landed anyway: **alone, last, after everything else is green**, with `npm run typecheck`, `npx next build` and `eslint` all passing.
  - ⚠️ **`eslint --cache` will lie to you here.** `npm run lint` runs with `--cache --cache-location node_modules/.cache/.eslintcache`; after a compiler swap, a cached run reports green on files it never re-linted. The verification run must use `--no-cache`.
- **Actions majors:** bump the SHA **and** the version comment together. Every `uses:` in this repo is SHA-pinned with a `# vX.Y.Z` comment, and a comment/SHA mismatch is a silent supply-chain hazard under the C-0293 pinning invariant.
- **#686 (29 npm updates):** if it reds, do not debug it as one PR — split it.
- **Campaign sequencing:** the OPS concurrency fix lands first (Pitfall 1); the TEST `compute_jobs` backlog is drained first (see the note under the phase map); PRs open **strictly one at a time**.

**Warning signs:**
- A green-looking CI run whose suite never executed (`steps: []`, conclusion `cancelled`) — see Pitfall 1.
- `npm install` emitting `EBADENGINE` and being ignored.
- `npm ls @testing-library/dom` showing two entries.
- `tsc --noEmit` passing while `eslint` errors with a parser/typescript-version message, or the reverse.
- Any `supabase db push` output that differs from the v2 baseline in *ordering*, not just formatting.

**Phase to address:**
**DEPS**, LAST in the milestone, strictly after **OPS**. Suggested intra-phase order: actions-patch (#643) → actions majors (#626, #627) → pip group (#685) → npm-minor-patch group (#686) → jest-dom 7 (#645) → jsdom 30 (#646, with the `engines` change) → `supabase/setup-cli` 3 (#612, alone, drift-check first) → TypeScript 7 (#614) **deferred by recommendation**.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Add the share token to the `cacheKey` string instead of bypassing the cached wrapper | One-line diff, "obviously" scoped | Publishes private strategies to every anon visitor for 3600s; the no-op is invisible in review | **Never** |
| Cache the token lane "just for the TTL, it's fine" | Faster shared pages | Revocation silently becomes "revoked in up to an hour" — kills the founder's entire rationale for tokens over ids | **Never** |
| `.eq("computation_status", "complete")` in the ranking query | One line, reads correct | Drops `complete_with_warnings` (a *success* status); re-forks a predicate two migrations were spent unifying | **Never** — use `isComputedAnalytics()` |
| Filter percentiles on the TS side only, leave `get_verified_cohort_rank` alone | Half the work, half the review | Factsheet rank and scenario peer rank disagree; the RPC's documented "parity by construction" becomes false | **Never** |
| Shrink the `shared-test-db` group to two members and call it fixed | No new dependency, small diff | Does not address the eviction rule at all (three concurrent *runs* still evict); closes #616 falsely | **Never** — it is the remedy TODOS.md proposes and it is wrong |
| Drop `cache_logger_on_first_use` and close the structlog audit | One-line diff | Closes Mode B, leaves Mode A (module-scope `.bind()`) open, and the audit is now marked done | Only alongside a Mode-A source-scan gate |
| Hoist `configure_logging()` with `# noqa: E402` and no behavioral test | Fixes today's ordering | Rots on the next import reorder with no test failing; also silently changes worker-entrypoint logging | Only alongside the behavioral redaction test |
| Land the dependabot majors as one batched PR | One CI run, one review | Un-bisectable; the prod-migration CLI rides in with test-only bumps | **Never** for #612 or #614; acceptable for #643 + the two actions majors |
| Verify a bump on a run that concluded `cancelled` | Looks green-ish | The suite never ran; with no branch protection nothing stops the merge | **Never** — assert `conclusion == success`, not "not failure" |
| Skip `mypy --strict` on analytics-service because pytest is green | Faster loop | GSD's flow runs pytest only; mypy errors surface in PR CI after the branch is stale | Never for `analytics-service/**` |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub Actions `concurrency` | Believing `cancel-in-progress: false` protects queued jobs | It protects the *running* job only. Use an external mutex (`gh-action-mutex` / `turnstyle`) for true FIFO; add a `cancelled`-conclusion watcher |
| Railway ← main CI | Treating "merged" as "deployed" | Railway skips the deploy on any non-green suite, **including `cancelled`**. Verify `/health` `git_sha` == main HEAD; detection today is bounded at ~6h by `analytics-deploy-verify.yml`, which deliberately exits 0 |
| Supabase migrations | Bumping the CLI as a routine actions bump | `supabase-migrate.yml` auto-applies to PROD on merge. Any CLI change is a production-database change; validate on `migration-drift-check.yml` first |
| Supabase SECDEF RPC + anon | Adding the function and the RLS policy but not `GRANT EXECUTE TO anon` | anon gets 42501, SSR returns `[]`, console is clean — a silent empty page. Grant explicitly and assert an anon read in a test |
| Next.js `unstable_cache` | Assuming the entry key is the string you pass | The entry is derived from callback source + `keyParts` + args. In this repo the passed string is split at `"::"` and the tail is **discarded** |
| Vercel CDN + `?s=` token | Assuming a query param creates a distinct cache entry | It does not unless the route varies on it. `force-dynamic` + explicit `Cache-Control: private, no-store` on the token lane |
| Sentry (`@sentry/nextjs`) | Assuming `Referrer-Policy` protects the token | Sentry reads `location.href` in-process. Scrub the `s` param in `beforeSend`/`beforeBreadcrumb`, verified against a real captured event |
| Link unfurlers (Slack/iMessage) | Not accounting for server-side fetches of the shared URL | The token lands in a third party's logs on first paste. Emit generic metadata; rely on revocability |
| structlog + FastAPI lifespan | Configuring inside lifespan and assuming import-time modules inherit it | They do not if they emit first. Test the observable redaction, not the import order |
| `npm` peer deps | Relying on auto-installed transitive peers | jest-dom 7 makes `@testing-library/dom` a required peer; declare it and assert a single hoisted copy |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Dropping `cache_logger_on_first_use` in the worker's hot loop | Worker throughput dips; log-heavy jobs slow | Measure the log-heavy path before/after; prefer the source-scan + behavioral-test fix over the global flag change | Immediately on a log-dense compute job |
| Token-keyed cache entries (`keyParts` including the token) | Cache population grows without bound | Bypass the cache on the token lane rather than re-keying it | As soon as links are re-minted; each revoke orphans an entry for its full TTL |
| `getPercentiles` fetching every published strategy's analytics per request | Discovery/Browse latency grows linearly with the catalog | Out of scope for v1.20, but the `computation_status` filter is the natural moment to push the ranking into SQL | Noticeable in the low hundreds of published strategies |
| 9 dependabot PRs serializing on one `shared-test-db` lock | Campaign wall-clock in many hours; queue thrash | One PR at a time; the `python` job alone is ~7m and `e2e-seeded` queues behind it by design (`ci.yml:1533-1539`) | Immediately, at 3+ concurrent runs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Token-lane payload written into the id-keyed `unstable_cache` entry | **Private strategies published to every anonymous visitor for 3600s** — strictly worse than the bug being fixed | Bypass `buildFactsheetPayloadCached`; adversarial ordered test (token request first, then anon 404) |
| Storing the raw share token at rest | A DB read or backup leak becomes a permanent capability grant | `token_hash` only (sha256 hex computed in ONE TS module), mirroring `scenario_shares` |
| Revoke implemented as `DELETE` | No audit trail; "was this link ever live?" is unanswerable | `revoked_at` timestamp + partial `UNIQUE … WHERE revoked_at IS NULL` |
| Unknown-token 404 differing from unknown-id 404 | The endpoint becomes an existence oracle, re-creating the enumeration risk tokens were meant to remove | Byte-identical 404 on both paths, asserted |
| `revoked_at IS NULL` filtered by the caller rather than inside the SECDEF body | RLS does not protect a SECDEF body; a forgotten filter ships green | Filter inside the RPC; test revoke immediacy (0 rows on the next request) |
| New mint/revoke RPC missing from `MUTATING_RPC_NAMES` | The mutation gate silently does not cover the new surface | Add it in the same phase; the SEC group already tracks this gap |
| Module-scope structlog logger emitting before `configure_logging()` | HMAC signatures (ccxt) and MT5 passwords reach logs/Sentry **unredacted** | Source-scan gate on module-scope `.bind()` + behavioral redaction test |
| `Referrer-Policy: strict-origin-when-cross-origin` treated as complete token protection | Same-origin requests, in-page JS, and platform access logs still carry `?s=` | `no-referrer` on the factsheet route + Sentry param scrub + short-lived, revocable tokens |
| Bumping an action's SHA without its version comment | The pin says one version and runs another — silent supply-chain drift under C-0293 | Update both; review rejects a mismatch |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Percentile badges vanishing catalog-wide when the population crosses min-N | Every manager loses their rank on the same day, with no explanation | Measure the population delta first; if the cohort drops under 20, plan the suppression copy deliberately |
| A manager's rank moving with no data change of their own | Reads as a bug, or as the platform being arbitrary | Snapshot before/after per strategy so the change is explainable |
| "Copy Link" producing a link the recipient cannot view | The exact defect SHARELINK-01 exists to fix | Mint-or-reuse on copy; never surface a copy affordance that can produce a dead link |
| The same affordance gated in one place and not the other | Inconsistent behavior teaches users the product is unreliable | Fix the CLASS — `FactsheetView.tsx` **and** `strategies/page.tsx:174` — not the one component |
| `status='private'` strategies getting zero actions from `StrategyActions` | A contribution-flow strategy can never leave `private` from the UI | Decide the product question in this milestone: are contribution records permanently private? If not, `private` needs a publish path |
| Token-page link previews leaking the strategy name | The title appears in Slack/iMessage unfurls alongside the token | Generic metadata on the token lane |

## "Looks Done But Isn't" Checklist

- [ ] **Share-token lane:** often missing the *adversarial ordering* — verify a token request followed by an anonymous `/factsheet/<id>` request STILL 404s, in that order, in one test.
- [ ] **Share-token lane:** often missing the CDN half — verify `Cache-Control` on the token response, not just the absence of `unstable_cache`.
- [ ] **Share-token lane:** often missing `GRANT EXECUTE TO anon` on the new SECDEF RPC — verify with an actual anon-role read, not a policy inspection.
- [ ] **Share-token lane:** often missing `MUTATING_RPC_NAMES` registration — grep for the new RPC name in that list.
- [ ] **Revocation:** often missing immediacy — verify 0 rows on the *next* request after `revoked_at = now()`, not after a cache TTL.
- [ ] **Percentile filter:** often missing the SQL side — verify `get_verified_cohort_rank`'s cohort moved too, or that leaving it is a recorded decision.
- [ ] **Percentile filter:** often missing `complete_with_warnings` — verify the predicate is `isComputedAnalytics()`, not a literal.
- [ ] **Percentile filter:** often missing the population count — verify the PROD before/after row counts are in the plan artifact.
- [ ] **Concurrency fix:** often missing the cross-run case — verify by simulating **three** concurrent runs, not two.
- [ ] **Concurrency fix:** often missing the detection layer — verify a `cancelled` main run produces a loud signal (issue or rerun), not silence.
- [ ] **#616:** often closed as "fixed" when only the symptom converged — verify the *recurrence mechanism* is gone before closing.
- [ ] **structlog:** often missing Mode A — verify a planted module-scope `.bind()` would fail the gate; neuter and observe RED.
- [ ] **structlog:** often missing worker coverage — verify `main_worker`'s entrypoint, not just `main:app`.
- [ ] **jsdom 30:** often missing the `engines` narrowing — verify `npm install` on Node 25 fails loudly rather than warning.
- [ ] **jest-dom 7:** often missing the explicit peer — verify `npm ls @testing-library/dom` shows exactly one copy.
- [ ] **setup-cli 3:** often missing the dry-run parity — verify a `db push` dry-run diff byte-identical to the v2 baseline before touching `supabase-migrate.yml`.
- [ ] **Any bump:** often missing the run-conclusion check — verify `conclusion == "success"`, not merely "not failure" (with no branch protection, a grey run merges).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Token payload cached into the id-keyed entry | **HIGH** — it is a live disclosure | `revalidateTag("factsheet-v2")` (global) immediately; then per-id tags; revoke all outstanding tokens; assume every id fetched during the window was exposed; then fix and re-verify with the ordered test |
| Ranking population cliff (badges vanish) | LOW | Revert the filter (single query change, no DDL); re-measure the population; re-land with the suppression copy planned |
| Ranking moved and a manager asks why | MEDIUM with a snapshot, unrecoverable without | With the before/after snapshot: answer directly. Without it the answer does not exist — which is why the snapshot is a gate, not a nicety |
| Analytics deploy silently skipped | LOW **if noticed** | `gh run rerun <id> --failed` (this worked on 2026-08-08, attempt 2 fully green); then verify `/health` `git_sha` == main HEAD |
| External mutex leaked by a killed job | LOW | Documented manual unlock (delete the lock ref/branch); this is why a TTL/steal path is a requirement of adopting the action, not a follow-up |
| Unredacted credential reached logs/Sentry | **HIGH** | Rotate the affected key immediately; purge the Sentry events; then fix the logger class. Rotation first — the fix does not un-leak |
| TypeScript 7 breaks the toolchain | LOW if landed alone and last | Revert the single PR; pin `typescript@^6`; `@dependabot ignore this major version` |
| `supabase/setup-cli@3` changes `db push` behavior against PROD | **HIGHEST** | This is why it validates on `migration-drift-check.yml` first. If it reaches `supabase-migrate.yml` and misbehaves, recovery is manual database remediation — plan to never need it |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 — concurrency eviction / silent deploy skip | **OPS, first phase (≈158)** — hard predecessor of DEPS | Simulate 3 concurrent runs; assert no job concludes `cancelled`; assert a forced `cancelled` main run produces a loud signal |
| 2 — token render poisons the id-keyed cache | **SHARE (SHARELINK-01)** | Ordered adversarial test in `phase-148-owner-lane-cache-isolation.test.ts`; demonstrated RED with the bypass neutered |
| 3 — token leakage channels + revocation | **SHARE**, same phase (same migration) | Anon SECDEF read succeeds; revoke → 0 rows next request; token absent from a real Sentry event; unknown-token 404 == unknown-id 404 |
| 4 — percentile population change | **RANK**, early | `isComputedAnalytics()` used; SQL RPC moved or the decision recorded; PROD before/after counts in the artifact; `phase-149-my-strategies-parity.test.ts` green |
| 5 — structlog cached/bound logger | **OPS** (parallel with 1) | Source-scan gate fails on a planted module-scope `.bind()`; behavioral test scrubs a synthetic HMAC after a late `configure_logging()`; both shown RED when neutered |
| 6 — dependency majors | **DEPS, last**, strictly after OPS | One PR at a time; `conclusion == success` asserted per PR; `engines` narrowed for jsdom; single `@testing-library/dom`; setup-cli dry-run parity; TS7 deferred |
| TEST `compute_jobs` backlog (note below) | **OPS**, before DEPS | Backlog drained and a drain owner assigned before the campaign opens |

> **Note — the deterministic red that will masquerade as dependency breakage.** TODOS.md line 2265 documents that cron jobid 9 fans out one `derive_broker_dailies` job per `api_key` at 05:30 UTC, TEST has no worker, and the accumulated `pending` rows sort ahead of anything a test seeds by `next_attempt_at` — reddening **exactly 10** claim-path tests in `test_compute_jobs_fencing.py` / `test_drain_semantics.py`, deterministically, plus ~900 orphaned `running` rows. Running a 9-PR campaign against that backlog produces reds that look like dependency breakage and are not. Drain it first. ⛔ Never `cron.unschedule(9)`.

## Sources

**Repo (HIGH confidence — read at HEAD during this pass):**
- `src/app/factsheet/[id]/v2/page.tsx` — `unstable_cache` wrapper, the `"::"` split, the id-only `keyParts`, the owner-lane bypass, `force-dynamic`, the v2→v6 shape-bump log
- `src/app/factsheet/[id]/page.tsx` — re-export, not redirect
- `src/lib/queries.ts:116-183` — `getPercentiles`, `PERCENTILE_ANALYTICS_COLUMNS`, the two `< 5` floors
- `src/lib/closed-sets.ts:663-702` — `STRATEGY_ANALYTICS_COMPUTATION_STATUSES`, `isComputedAnalytics()`, the `complete_with_warnings` history
- `src/app/api/strategies/csv-finalize/route.ts:1029-1500` — `CLOCK_SAFETY_KPI_COLUMNS`, the measured 7-row PROD contamination population
- `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` — SQL cohort, decile quantization, min-N 20, the parity-by-construction claim
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` — the revocable-token pattern to copy
- `.github/workflows/ci.yml` :39-41, :936-938, :1126-1145, :1533-1552 — concurrency groups, the 2026-08-03 chain fix and its ⛔ notes
- `.github/workflows/analytics-deploy-verify.yml` — the deliberate `exit 0`, the ~6h detection bound, the dedup'd-issue pattern
- `.github/workflows/supabase-migrate.yml`, `migration-policy.yml`, `migration-drift-check.yml` — `supabase/setup-cli@v2.1.1`, `version: 2.98.2`
- `analytics-service/services/logging_config.py:214-245` — `configure_logging`, `cache_logger_on_first_use=True`, the `_redact_processor` position, the stdlib `LogRecord` bridge
- `analytics-service/services/mt5_client.py:155-176` — the documented per-call `_stage_logger()` workaround and the LogCapture observation
- `next.config.ts:79` — `Referrer-Policy: strict-origin-when-cross-origin`
- `package.json` — `engines.node: ">=22"`, `typescript ^6`, `jsdom ^29.1.1`, `@testing-library/jest-dom ^6.9.1`, **no** `@testing-library/dom`; `lint` uses `eslint --cache`
- `.nvmrc` (`22`); local `node -v` = **v25.8.1**
- `TODOS.md` lines 40-73 (SHARELINK-01 founder decision + cache landmine), 2258-2265 (concurrency eviction evidence, #616, TEST backlog)
- `.planning/PROJECT.md` — v1.20 scope, REQ groups, stack constraints

**Vendor release notes via dependabot PR bodies (HIGH confidence — version-exact):**
PR #646 (jsdom 30.0.0), #645 (`@testing-library/jest-dom` 7.0.0), #612 (`supabase/setup-cli` 3.0.0), #626 (`actions/setup-node` 7.0.0), #627 (`actions/setup-python` 7.0.0), #643 (`actions/checkout` 7.0.1), #614 (typescript 7.0.2 — dependabot could not fetch notes).

**External (MEDIUM confidence — web search / Context7, cross-checked against the repo's own measured evidence):**
- [Canceling since a higher priority waiting request exists — Tim Taurit](https://taurit.pl/github-canceling-since-a-higher-priority-waiting-request-exists/)
- [Feature request: concurrency to queue all jobs waiting on a group — community discussion #12835](https://github.com/orgs/community/discussions/12835)
- [Workflow sharing concurrency group cancelled instead of pending — community discussion #32376](https://github.com/orgs/community/discussions/32376)
- [ben-z/gh-action-mutex](https://github.com/ben-z/gh-action-mutex) · [softprops/turnstyle](https://github.com/marketplace/actions/action-turnstyle) · [actions-mutex](https://github.com/marketplace/actions/actions-mutex)
- [structlog configuration docs — lazy proxy, never bind at module scope](https://github.com/hynek/structlog/blob/main/docs/configuration.md) · [structlog performance docs — `cache_logger_on_first_use`](https://github.com/hynek/structlog/blob/main/docs/performance.md)
- [Referer header: Privacy and security concerns — MDN](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Referer_header:_privacy_and_security_concerns) · [Cross-domain Referer leakage — PortSwigger](https://portswigger.net/kb/issues/00500400_cross-domain-referer-leakage) · [Token Leakage Via Referer — Cobalt](https://www.cobalt.io/vulnerability-wiki/v4-access-control/token-leakage-referer)
- [TypeScript 7.0 RC: The Go Rewrite Migration Guide — SitePoint](https://www.sitepoint.com/typescript-70-rc-the-go-rewrite-migration-guide/) · [What Breaks When You Upgrade to TypeScript 7 (tsgo)](https://medium.com/@krunalkanojiya/what-breaks-when-you-upgrade-to-typescript-7-tsgo-614005afbbd0)

---
*Pitfalls research for: v1.20 Backlog Burndown — SHARE, OPS (concurrency + structlog), RANK, DEPS*
*Researched: 2026-08-20*
