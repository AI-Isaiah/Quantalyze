# Pitfalls Research

**Domain:** Hardening a live analytics product so that every number, label and alert is correct or fails loudly (milestone v1.22 TRUTH). Stack: Next.js 16 frontend on Vercel, FastAPI analytics worker on Railway, Supabase Postgres with RLS, leased `compute_jobs` workers, pg_cron and pg_net, Sentry, nightly derives from Bybit, OKX, Deribit and MT5.
**Researched:** 2026-11-23
**Confidence:** HIGH for repo-specific pitfalls. Each was read at HEAD of the v1.22 worktree and is cited by path and symbol. MEDIUM where a mechanism is a hypothesis built from two code facts that no one has measured together (marked *hypothesis, measure first*). LOW for the two web lookups. The confidence seam returns LOW for an unverified web search and MEDIUM for a cross-checked one. Both lookups are tagged where they are used.

**How to read this file**

- **Read at HEAD** means I opened the file in this worktree. **TODOS says** means the claim comes from a `TODOS.md` entry and was not re-measured. The `file:line` citations inside TODOS entries are often stale, so this file cites by symbol.
- **No ratchet value or corpus count is restated here, on purpose.** Each such value has a command that prints it, and the command is named instead (CLAUDE.md, "Current reading — SUPERSEDED"). Commands:
  - floors: `grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-floors.mjs`
  - lint rules: `node scripts/lint-sql-gates.mjs --self-test`
  - data-dependent guard census: `node scripts/lint-migration-data-dependence.mjs`
  - live-DB ledger: `ENTRY_COUNT` in `scripts/live-db-execution-ledger.txt`
- The **Owner** column names the topic group from the triage. The roadmapper turns groups into phase numbers after 225.
- The v1.18 file `.planning/research/PITFALLS.md` still governs Phase 155.2 LIVEPARITY: tautological oracle, window-end trap, basis mismatch, tolerance drift. It is not repeated here. Section E only adds what changes when 155.2 runs alongside this milestone's MT5 fixes.

**Scope guards (founder rulings, 2026-11-23)**

- No composite work anywhere.
- GLB-1 is not triggered.
- The Binance and sFOX groups stay latent.
- The demo accounts are deleted and their literals removed from the tree.
- Binance appears below only as a class example (Pitfall 3). It recommends no Binance work.

---

## A. Critical pitfalls: how these fixes regress (Question 1, class level)

### Pitfall 1: The retry that heals hides the first failure, and three different producers look identical

**What goes wrong:**
`175-NIGHTLY-MT5-DERIVE-CHECK` (TODOS says): MT5 `derive_broker_dailies` jobs end `done` with `attempts=2` and a null `last_error`, so what the first attempt hit is unreadable. The tempting fixes are to raise the retry budget, lengthen the watchdog, or stop clearing `last_error`. Each one hides the fault or breaks something else. Read at HEAD, three code paths produce a row that looks like that, and each needs a different fix:

1. **Re-claim after `failed_retry`.**
   - The claim RPC sets `last_error = NULL, error_kind = NULL` and `attempts = attempts + 1` (`supabase/schema/functions/claim_compute_jobs_with_priority.sql`, the `M-1137/M-1138` comment).
   - This is deliberate: it keeps a stale error off a job that later succeeds.
   - So a first attempt that failed loudly is erased by the second claim.
2. **The worker's watchdog.**
   - `watchdog_tick` in `analytics-service/main_worker.py` calls `reset_stalled_compute_jobs`. Its body (`supabase/schema/functions/reset_stalled_compute_jobs.sql`) sets the row to `pending`, writes `last_error = 'worker_stalled'` and leaves `attempts` alone.
   - The block comment above `_reconcile_heal_key` in `main_worker.py` records that this is how an `attempts <= 1` de-dupe once lost an alert.
   - The next claim then erases `worker_stalled` the same way it erases a real error (path 1). A job reset while still running and re-run to `done` therefore reads `attempts=2` with a null error, exactly like path 1.
3. **The reaper `reclaim_stuck_compute_jobs`.**
   - It decrements `attempts` and bumps `reclaim_count` (`supabase/schema/functions/reclaim_stuck_compute_jobs.sql`).
   - So it does not produce `attempts=2`. That distinguishes it, but only if someone reads `reclaim_count`.

*Hypothesis, measure first:* path 2 is the batch-mate reset that `166.5.1-DERIVE-BATCH-RESET-RESIDUAL` describes (TODOS says): one `claimed_at` per batch, jobs run one after another, so a job's staleness clock includes its batch-mates' runtime. Backfill batch-mates are `derive_broker_dailies` jobs with long handler timeouts. If that is the producer, MT5DERIVE2 and JOBHEAL share one root cause, a missing lease heartbeat, and fixing them separately produces two partial fixes.

So the one eraser is the claim RPC. Paths 1 and 2 write different first-attempt errors (a real error against `worker_stalled`), and the re-claim wipes both before anyone reads them.

**Why it happens:**
`done` reads as success. The clearing of `last_error` was a correct fix for an older defect (M-1137), so removing it re-opens that defect. Everyone reads `attempts` as a heal counter, and `main_worker.py` says in capitals that it is not one.

**How to avoid:**
- First make the first attempt readable, without removing the clear on re-claim:
  - add an append-only per-attempt record (attempt number, terminal status, error or `reset_by_watchdog`, `claimed_at`, ended-at);
  - or add a `first_error` column the claim RPC copies into before it clears `last_error`.
  - The record must be written before the claim clears `last_error`, so a `worker_stalled` reset and a real failure stay distinguishable (add the claim age to the stalled case).
- Then fix the named cause at its root, for example a lease heartbeat that renews `claimed_at` while a runner works.
- Never close by raising the attempt budget or the `WATCHDOG_PER_KIND_OVERRIDES` threshold. `test_every_kind_has_watchdog_headroom` is not a proof of correctness.
- Success criteria:
  - (a) a job that fails attempt 1 and succeeds on attempt 2 still shows attempt 1's error, in a test against the real RPC on the lane;
  - (b) a watchdog reset of a running job leaves a reason;
  - (c) seven consecutive nightly MT5 derives at `attempts=1`, or the named cause fixed with a test that reproduces it. Condition (c) is the TODOS closure rule.

**Warning signs:**
- A PR that edits retry counts, timeouts or the watchdog map but adds no new readable field.
- "Retries now succeed" offered as the closure.
- `attempts=2` rows that still have no recorded cause after the fix ships.

**Phase to address:** MT5DERIVE2 (owns 175), coordinated with JOBHEAL (`166.5.1-DERIVE-BATCH-RESET-RESIDUAL`, `164.2-RECLAIM-PROVENANCE`). The migration halves need migration-reviewer and rls-policy-auditor before merge (see Pitfall 8).

---

### Pitfall 2: `done` is not fresh. A derive ends `done` while its series stays weeks stale

**What goes wrong:**
The new 2026-11-23 observation (read at HEAD in `.planning/debug/derivecron-compose-divergence.md`, resolution note): one Deribit account's stored returns end 2026-10-26, it has a flow dated 2026-11-09, and its daily `derive_broker_dailies` jobs are all `done`. It is **undiagnosed**. Do not plan from a guessed mechanism. The same shape exists elsewhere already:

- `L4282` (TODOS says): a first-hop `sync_trades` enqueue that dropped leaves "no dailies and no jobs". That is byte-identical to a brand-new strategy, so no sweep predicate catches it.
- `167.1.2.2.2-OKX-PERSISTENT-TRUNCATION`: a first OKX window above the page cap errors every tick.
- `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`: a cursor sits ahead of stored data, so the next reader skips days it never stored.
- `L2244`: the readmit ceiling gives up silently.

**Why it happens:**
Job status measures that the handler returned. It does not measure that the published series covers the inputs. "Hold last good on a bad read" (Phase 186 D-05) is correct, but nothing reports how long "last good" has been held. A pg_cron tick that calls `net.http_post` succeeds once the request is queued, because pg_net is asynchronous; responses land in `net._http_response`, which by default is kept for 6 hours (Supabase pg_net docs; web, MEDIUM after cross-check against the repo's `20261020120000_ops_staleness_check.sql` comment that `net.http_post` returns a request id).

**How to avoid:**
- State the fix as an invariant, not a mechanism: *for every key whose derive runs daily, the last stored return date is no older than its latest flow date and its anchor date minus one day, or the key carries a named, user-visible stale reason.*
- Check that invariant for every venue, not for Deribit only. The defect may be a class.
- Freshness is `strategy_analytics.computed_at` plus the series end date, never `last_sync_at`, which the daily poll overwrites (v1.18 Phase 211 goal in `.planning/milestones/v1.18-ROADMAP.md`).
- Diagnose the Deribit account read-only first, then fix the root. Ship the invariant check as its own gate so the next instance on any venue is caught.

**Warning signs:**
- A fix that re-derives the one account and declares it closed.
- A freshness check keyed on job status or `last_sync_at`.
- A "held last good" with no age.

**Phase to address:** the Deribit stale-returns goal (new; DERIBITBOOK is the nearest group). Generalise into JOBHEAL's "no strategy is stranded" goal.

---

### Pitfall 3: A fix scoped to one venue when the defect is a class

**What goes wrong:**
TODOS says, for every member of BYBITREADS, OKXTRADES and DERIBITBOOK:

| Entry | The narrow read |
|---|---|
| `167.2.1.1-DERIVE-USDT-ONLY-ANCHOR` | Bybit derive anchor reads the USDT coin only, while holdings sum every stable coin |
| `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY` | Bybit positions cover USDT-settled linear contracts only |
| `167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY` | OKX `fetch_daily_pnl` sums `pnl + fee` across currencies at face value |
| `167.2.1.1.2.1-STRATEGY-BYBIT-7DAY` | Bybit execution list sends a start and no end |
| `L2219` | the Deribit `correction` word classifier books a capital row as trading |

The regression pattern is fixing the one venue or one coin the evidence names, leaving the sibling read paths (derive anchor, holdings poll, strategy trade sync, allocator rebuild) on the old rule.

Two failure modes make it worse:

- **A probe that cannot tell the alternatives apart.** `186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED`: with zero on-chain rows, "replace" and "union" give the same flows, so the verdict rested on no evidence.
- **Mocks that share the bug.** `187-BINANCEINCOME-NEXT-MILESTONE` (out of scope, cited only as the class): "the mocks use the same wrong names, which is why the tests pass". A mock written from the code under test cannot catch the code's misreading of the exchange.

**How to avoid:**
- Before fixing, census the class. Enumerate every read path for the axis: coin, settle category, currency, time window or classifier word. Produce one table of venue by path. Then fix every row, or record a row as decided, with a test per row.
- The pinning tests that encode today's narrow behaviour (for example `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin`) must be flipped deliberately in the fix PR, not deleted.
- Use fixtures parsed from real exchange payload shapes (recorded raw responses with values scrubbed), not hand-built dicts mirroring our parser.
- When a probe returns zero rows for the distinguishing case, the verdict is "undecided", not "replace".

**Warning signs:**
- A diff touching one function where the census shows three readers.
- A test fixture written in the same commit as the parser, with the same field names.
- "No exposure today" used as the reason not to fix a read that is wrong by construction.

**Phase to address:** BYBITREADS, OKXTRADES, DERIBITBOOK. Phase 223 FLOWKINDS for the flow-source half.

---

### Pitfall 4: Two engines, two constants. Annualisation and deviation drift between TS and Python

**What goes wrong:**
Read at HEAD:

- Python stored engine: `_CALENDAR_DAYS_PER_YEAR = 365.0` in `analytics-service/services/metrics.py`. Its comment says "Not 365.25".
- TS calendar clock: `calendarYears` in `src/lib/closed-sets.ts`, documented as 365.25 days. Used by `src/lib/scenario.ts` and mirrored by `src/lib/factsheet/compute.ts`.
- TS narrowed-range Sharpe: `sharpeRatio(basisReturns, { periodsPerYear, ddof: 0, rf })` in `src/lib/factsheet/compute.ts`. TODOS `194-ENGINE-CONSTANTS` says the stored engine uses ddof 1.

Other members of the family:

- `QUANTSTATS-0086-REDERIVE-01`: quantstats is held at 0.0.81, and 0.0.86 moves CVaR and other figures.
- `167.1.2.2.1-CAGR-EMPTY-SPAN`: CAGR annualises over emptied stretches.

The regression patterns:

- Aligning one engine and leaving its mirror.
- Aligning the constant and leaving the rolling windows on another ddof (D-14 residual).
- "Fixing" a red parity test by re-pinning expected values from the new output.

The family is wider than the three engines. `L2214` (TODOS says) names more bespoke annualisation and Sharpe stacks: `_compute_portfolio_analytics` in `routers/portfolio.py`, `equity_reconstruction.py`, `portfolio-stats.ts`, `scenario-blend-panels.ts`, `health-score.ts` and `match.py`. A pin over two literals stays green while those drift.

**Why it happens:**
`src/lib/scenario.ts` sits behind frozen-spine guards (`src/__tests__/phase-29-frozen-spine-guards.test.ts`), so editing it feels risky and people align around it. The year length is already decided on one side: PROJECT.md's v1.8 Key Decision says CAGR annualises on "365 (calendar)", and the `metrics.py` comment cites that wording for `365.0`. The TS engines use 365.25 anyway, and no decision covers ddof. Aligning them changes every narrowed-range and Scenario figure, so it is still a **founder decision**, not an executor's.

**How to avoid:**
- Get the founder's ruling on one year length and one ddof first.
- Put them in one named constant per language, with a cross-language pin that reads both literals and fails when they differ.
- Census every annualising site, including the `L2214` list, so a new or forgotten stack fails the census instead of drifting under a two-literal pin.
- Re-baseline the frozen spine as a reviewed act, following the v1.5 precedent "spine guards re-baselined as a reviewed act, never deleted".
- The CHANGELOG states that every figure moves on next recompute.
- For quantstats: re-derive each inline mirror against 0.0.86 and decide per metric.
- Forbidden closure (TODOS says): loosening the parity tolerance, or re-pinning expected values without the re-derivation.

**Warning signs:**
- A parity test whose tolerance changed in the same PR as the constant.
- `regen_golden.py` re-run in a constants PR. That bakes the new engine into "expected"; see `analytics-service/tests/fixtures/regen_golden.py` and the trap recorded in `src/__tests__/metrics-parity.test.ts`'s header.
- `scenario.ts` edited without the spine guards changing.

**Phase to address:** FIGUREMATH. A founder decision gate comes before planning.

---

### Pitfall 5: A cache that re-serves the old truth, across deployments

**What goes wrong:**
Next 16's `unstable_cache` "persist[s] the result across requests and deployments", has been superseded by `use cache`, and treats `keyParts` as the identity (local docs, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`, read at HEAD). The doc also says the default key includes the arguments and the stringified cached function. So a fix inside the callback's own text changes the key, but **a fix in a helper it imports, or in the data it reads, does not flush a wrong answer already cached, across deployments.** Two more facts are read at HEAD in `src/app/factsheet/[id]/v2/page.tsx` (`buildFactsheetPayloadCached` comment):

- `unstable_cache` stores `null` unconditionally.
- The writer is the Python worker, "which cannot reach Next's cache".

The SURFACECACHE members are each a variant (TODOS says):

- `164.6.6.2.1-USDVIEW-READFAIL-CACHED`: a failed BTC price read is returned as a normal payload, so it is cached for the TTL.
- `170.3-OG-NOTFOUND-CACHE`: a not-yet-published card is served under `LONG_CACHE_CONTROL`, which means 1 day `s-maxage` plus 7 days `stale-while-revalidate`.
- `201.1-COMPOSER-RANGE-AS-DATES`: the range is stored as indices that drift when the axis grows at the front. This is persisted state, a cache in effect.
- Class example only, not a triaged member: `166.5-PDF-MIXED-VINTAGE-WINDOW`, a PDF rendered between the stamp and the sibling-series write.

**How to avoid:**
- Use the house pattern that already exists. A failed or degraded build is **thrown inside the cache callback**, so it is never stored. See `FactsheetReadError` and `FactsheetDegradedBuildError` in `page.tsx`. Apply it to `buildUsdView`'s failure.
- Every fix that changes payload shape bumps the shape-version key member.
- A not-found response gets a short or no-store cache header, distinct from a found card.
- For the composer, a persisted-draft upgrade branch must read old saved drafts (the v1.5 PERSIST-01..03 precedent: a non-destructive schema upgrade with a named upgrade arm).
- Do not migrate to `use cache` in this milestone. It is a semantics change, not a truth fix.
- Success criterion per surface: a failed read followed by a good read returns the good one within the TTL, in a test that drives the real cache wrapper.

**Warning signs:**
- A degraded payload returned as a value from inside a cached function.
- A fix verified only after a cold deploy.
- A key that omits the member the fix changes.

**Phase to address:** SURFACECACHE, plus FACTSHEETHONEST for `190-RERUN-SURFACES-NOT-HOLDING`.

---

### Pitfall 6: A "fails loudly" path that pages hourly, never closes, or reaches nobody

**What goes wrong:**
The ALERTPAGE and ALERTREADERS entries (TODOS says) are the full set of ways an alert path rots:

| Entry | How it rots |
|---|---|
| `164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS` | one flaky key pages every hour with no recovery. This shape gets a channel muted, and a muted channel cannot report a real outage |
| `164.6.8-F4-WR03-DEBT-PAGE-NEVER-ENDS` | the page never ends |
| `164.6.8-R4-SFH-F1-DUPLICATE-RECOVERY` | a duplicate recovery goes out with false "restarted" wording |
| `164.6.8-F3-SENTRY-HALF-NOOP` | `capture_message` returns None and is ignored |
| `164.6.8-F5-READER-DELIVERY-UNOBSERVED` | `net.http_post` is asynchronous and the response is never read |
| `164.6.8-N2-…`, `164.6.8-WR05-…` | the paging path's own failures log at WARNING |
| `164.6.8-N3-SCRUB-SECOND-FAILURE-SUPPRESSED` | a second failure of the same cause is dropped |
| `164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL` | an outage is credited to Sentry while the rule's 60-minute action interval suppresses the notification |
| `164.6.8-WR-D16-01-PROBE-BOUND-INLINE-CLOSE` | a Sentry-credited recovery closes the page inline, outside the probe tick's budget |
| `164.6.8-F6-SCRUB-READER-NEWEST-ONLY` | the scrub reader reads one row per tick, so a failure followed by a success in one interval is never seen |

Also, `164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED` (founder D-15, accepted) makes Sentry the only live channel. A test that assumes the email hop delivers proves nothing about production.

**Why it happens:**
Each fix is local to one tick handler. Nobody models the episode: open once, recover once, close once. Positive delivery is never checked, because a fire-and-forget call returns success.

**How to avoid:**
- Model the page as an episode with a stored open record. Every handler decides from that record, not from tick-local state.
- Page `cron_sync` on a failed **run**, not a non-ok key.
- Read the previous tick's `net._http_response` for the stored request ids and raise on non-2xx.
- Log ERROR when Sentry returns no event id, and once at startup when `SENTRY_DSN` is unset in production.
- Success criteria are scenario tests over a fake clock:
  - two days of one flaky key produce at most one page and one recovery;
  - a debt cleared between two ticks closes the page;
  - a dropped Sentry capture logs ERROR;
  - a 401 on the reader's POST reds the next tick;
  - a second outage inside the Sentry rule's action interval is not credited as delivered;
  - a failed scrub row followed by a success inside one interval still pages.
- Each scenario is shown RED on today's code before the fix (Section C).

**Warning signs:**
- An alert test that asserts "a page was sent" and nothing about the second tick.
- A handler `except` that logs at WARNING.
- An alert keyed on `attempts` (the `main_worker.py` warning again).

**Phase to address:** ALERTPAGE, ALERTREADERS. Sequence the `ops_staleness_check` migration edit with Phase 222 ALERTTRUTH, since both move SQL by migration.

---

### Pitfall 7: A rate limit fixed at the edge but not at the shared bucket, or keyed on the proxy

**What goes wrong:**
Read at HEAD in `analytics-service/services/rate_limit.py`:

- Storage is `memory://` and therefore per-replica.
- Behind Railway's edge, `get_remote_address` collapses to the proxy IP.
- "Everything anonymous shares ONE bucket" (comment above the teaser payload constant).

The Vercel limiters in `src/lib/ratelimit.ts` use Upstash Redis. TODOS `L4491` and `L4501`:

- The teaser's per-IP edge limit is far above the one shared anonymous bucket behind it.
- `csvValidateLimiter` is far above the `/process-key` tenant tier it shares with key sync and finalize.
- Its docblock cites a cap on a route it no longer calls.

The obvious fix, "key the anonymous tier per IP" at the Python layer, keys on the proxy IP and changes nothing. Raising only the edge number moves the 429 one hop inward.

The mechanism a per-client fix needs already exists (read at HEAD): `verify_tenant_claim` checks an HMAC-signed claim header keyed on `INTERNAL_API_TOKEN`, and `tenant_or_platform_key` maps a valid claim with payload `public` to one `<scope>:anon` bucket. The anonymous half of the claim carries no per-client part today.

**How to avoid:**
- Founder call first (TODOS says): per-IP anonymous tier, or a raised shared tier. The criteria below depend on that choice.
- If per-client: decide bucket identity where the shared bucket lives (Python), and carry a client part in the existing signed claim (proposal, not yet designed: a hashed client address minted by the Vercel route). Do not key on a raw `X-Forwarded-For` the client controls, and do not add a second secret.
- If a raised tier: raise `_PROCESS_KEY_TENANT_LIMIT` or the anonymous tier with a measured rationale, and keep the single bucket.
- Either way, keep the anti-abuse intent recorded in the docblock (one anonymous IP once drained the platform window), and fix the stale docblock citation in the same commit.
- Success criteria:
  - per-client option: two distinct signed client parts get separate buckets, one client part shares, and an unsigned or forged claim falls back to the shared bucket;
  - either option: the edge limit is no looser than the bucket it fronts, or the gap is named in the docblock with its reason.

**Warning signs:**
- A test that hits the Python limiter directly with distinct `remote_addr` values. That cannot happen behind the edge.
- Per-replica counts assumed to be global.

**Phase to address:** RATELIMITFAIR.

---

### Pitfall 8: A migration auto-applies to PROD with no human stop, and the house-style guard refuses on an empty TEST

**What goes wrong:**
Since 2026-09-23 a migration that passes `apply-test` reaches PROD with no reviewer (CLAUDE.md, "Currency 2026-09-09"; PROJECT.md Key Decisions). Several groups need migrations: JOBHEAL (`reclaim_stuck_compute_jobs` must call `sync_strategy_analytics_status`), MT5DERIVE2 (attempt history), ALERTREADERS (`ops_staleness_check`), DBACCESS, SQLGATES2, 222 and 224. Their failure modes:

1. **A data-reading `DO` guard.** It raises on an empty table, so it applies on PROD and refuses on TEST, which then withholds the PROD deploy. `scripts/lint-migration-data-dependence.mjs` now refuses this shape at PR time with no opt-out marker (read at HEAD). Its rule: self-verification must be catalogue-only, or tolerant of an empty table.
2. **`CREATE OR REPLACE` written from memory,** not rebased on the latest body. That silently reverts a later fix. The canonical current bodies are dumped to `supabase/schema/functions/*.sql` by `npm run schema:functions`.
3. **Editing an already-applied migration,** even comment-only. `164.7-MIGRATION-COMMENT-DRIFT` (TODOS says): a reviewer graded that CRITICAL and it was reverted. Correct forward in the next migration's header.
4. **The dispatch escape.** `164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED` (TODOS says): `apply-test` refused a correct state, the error's own remedy (re-run via `workflow_dispatch`) applied to PROD while its TEST leg applied zero.
5. **A Vercel deploy that is not ordered against the apply.** New TS reading a column the migration has not created yet. Phase 191 D-06 solved this with two PRs, migration first.
6. **`DROP FUNCTION` in 224 with a live caller.** Callers can be a pg_cron job body, a Python RPC call or a SECDEF policy helper. TS grep alone misses them.

**How to avoid:**
- migration-reviewer and rls-policy-auditor run clean before merge. There is no stop after merge.
- Rebase every replaced function on its dump in `supabase/schema/functions/`.
- Data checks go in `supabase/tests` gates run on the lane, not in the migration.
- Two-PR ordering when TS depends on schema.
- For a drop: grep `supabase/migrations`, `analytics-service`, `src`, and `cron.schedule` calls, and dump the function's dependants.
- Remedy for a merged migration that refuses on TEST: **revert the merge.** Never edit `supabase-migrate.yml` and never use the dispatch escape to get a deploy out.

**Warning signs:**
- A `DO` block with `RAISE EXCEPTION`, `INTO STRICT`, `IF NOT FOUND THEN RAISE` or `ASSERT` after a read of an application table.
- A function body in a migration that differs from its dump by more than the intended change.
- A PR that touches both `supabase/migrations/` and a TS reader of the new column.

**Phase to address:** every group shipping a migration. SQLGATES2 owns `164.8-APPLYTEST-…` and `164.7-MIGRATION-COMMENT-DRIFT`.

---

### Pitfall 9: A credential removed from the tree but still in history, still valid, or still needed as a needle

**What goes wrong:**
`158-OPS-03` (TODOS says): two demo-account credential pairs were committed in plaintext. The founder ruled: delete the accounts and remove the literals. GitHub's own guidance (web, LOW unverified search summary, consistent with the TODOS entry's own reasoning) is to revoke or rotate first, because a history rewrite does not reach clones, forks, cached views or PR refs. The founder already declined a history rewrite for SEC-02 (PROJECT.md Key Decisions). Removal is therefore forward-only, and **deleting the accounts on every project they exist on (TEST, preview, PROD) is the remediation.** The text edit is hygiene.

Read at HEAD, three things collide with "remove the literals":

1. **The absence guard needs its needle.** `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` holds one pair as constants. Its docblock argues that a placeholder needle "would make every assertion below pass unconditionally". Deleting the literal without redesign leaves a guard that cannot fail.
2. **Source-text pins name the seed script.** `src/__tests__/critical-regressions.test.ts` has the `[AUDIT-2026-05-07 #35] seed-full-app-demo staging allowlist guard` block, which reads `scripts/seed-full-app-demo.ts`.
3. **The drain script parses the seed script.** `scripts/drain-test-compute-backlog.ts` parses `API_KEY_IDS` from `scripts/seed-full-app-demo.ts` to build its allowlist.

Also: `SECRETSCAN-FULLHISTORY-01` (a full-history gitleaks scan finds fixture-shaped literals a PR scan never sees), and `164.8.4-REDACT-NO-POSITIVE-SCAN` (`sed` exits 0 whether or not it redacted anything).

**How to avoid:**
- Sequence: founder deletes the accounts first, recorded with a date. Then the text PR.
- Redesign the absence guard so it keeps failing without the literal. For example, compare a committed digest of the literal against digests of string tokens in the spec, so the guard still reds if the credential returns. Prove it RED by re-inserting the old pattern in a scratch copy.
- Retire or redirect the seed and drain coupling in the same PR, with the `critical-regressions` block updated deliberately.
- Sweep `.planning/milestones/` historical quotes too, since the founder said "from the tree".
- Never quote a credential-shaped literal in CHANGELOG, `TODOS.md` or commit text. A push-to-main scan sees the squash diff.
- Add a positive post-substitution scan to the redaction step.

**Warning signs:**
- A "removed literals" PR with no account-deletion record.
- A guard test whose needle became a placeholder.
- `npm test` red on the seed pin after the deletion.

**Phase to address:** SECRETSHYGIENE. The account deletion is a founder action.

---

### Pitfall 10: Owner and anon read paths diverge, or a fix reaches one surface of many

**What goes wrong:**
TODOS says:

- `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED`: the owner's private factsheet reads the trust tier through `get_published_trust_signals`, an RPC that answers only for published strategies, so it shows "Data source —".
- `190-RERUN-SURFACES-NOT-HOLDING`: the re-run hold reached the factsheet but not the OG card, the PDF routes, the returns API, recommendations, portfolios or the composer.
- `164.6.6.3.3-WITHHELD-RESIDUE`: residue on Withheld factsheets.
- `RANK-SPLAT-01`: `metrics_json_by_basis` is selected whole on an anon path.
- `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`: an optional field removed the compiler's guard on owner reads.
- `170.4-DASHBOARD-MARKER-READ-SILENT`: the dashboard drops `markerReadError`, where the commit route reports it.
- `198-SHARED-ACCOUNT-FALLBACK-UNNAMED`: counts printed lines, not attributed keys, in `src/app/(dashboard)/allocations/lib/key-data-gaps.ts`.

**How to avoid:**
- Before the fix, list every reader of the field or verdict with a grep census committed as a test. The test fails when a new reader appears that is not classified.
- Test each surface as owner and as anon.
- Anon projections are named alias sets, pinned by a test that fails when a new key appears.
- A degraded read carries a flag to the surface, not only a log line.

**Warning signs:**
- A PR description naming "the factsheet" for a verdict that also renders on the OG card or PDF.
- An owner path that calls a `published`-only RPC.

**Phase to address:** FACTSHEETHONEST, HOLDINGSTRUTH, DBACCESS, SENTRYHELD.

---

### Pitfall 11: Tests that pass by skipping, by caching, or by a suppressed run

**What goes wrong:**
TODOS says:

- `164.9-RPC-RETRY-NARROWED-SKIP-REOPENED`: a sustained RPC read timeout reaches `pytest.skip` on a fence assertion, so the `python` job is green on a transport fault.
- `LINT-CACHE-MASKS-WARNINGS`: `eslint --cache` makes the verdict depend on cache warmth.
- `164.9-LIVEDB-LANE-EXECUTION-CENSUS`: known-failing live-DB arms are carried in a shrink-only ledger.
- `158-OPS-03` (the DBACCESS member at `discovery-watchlist.spec.ts`): an e2e spec holding two RLS proofs (unauthenticated `PUT /api/watchlist` answers 401; user B cannot read user A's favourites) is wired to nothing, so those security assertions run nowhere. A proof that never executes is the same class as a skip.

Read at HEAD:

- `src/test-setup.ts` documents `it.skipIf(!HAS_LIVE_DB)` suites.
- `scripts/live-db-execution-ledger.txt`'s header records that the corpus carries its own conditional skips.
- CLAUDE.md's skip-trailer trap: the skip trailer in any commit message suppresses every workflow run, survives a squash into `main`, and reads as a clean board. Railway deploys anyway.

**How to avoid:**
- Fixes must not delete or widen a skip, and must not put `rpc` back on the retried side. Both are forbidden closures named in the TODOS entry. The fix shape is an explicit read-only RPC allowlist.
- Add an executed-arm floor wherever a skip is conditional.
- Run lint without cache in CI.
- Shrink the ledger only. Never add a line to absorb a new failure.
- Never write the skip trailer in a commit or PR body, not even to deny it.

**Warning signs:**
- A green job whose test count dropped.
- A new `skipIf` in a fix PR.
- A ledger diff that adds a line.
- A head SHA with zero workflow runs.

**Phase to address:** TESTLANES. Applies to every group.

---

### Pitfall 12: A soak or oracle that agrees with the code by construction

**What goes wrong:**
TODOS says, for `analytics-service/scripts/mt5_soak.py`:

- `164.6.6.2.3-SOAK-DAY-ATTRIBUTION`: the expected return uses the fold's own per-day P&L, so a deal on the wrong UTC day shifts both sides and stays green.
- `164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED`: timed days reject only infinity, so 7.0 or NaN pass, and there is no floor on the checked share.
- `164.6.6.2.3-SOAK-BTC-FLOORS`: a BTC account is judged on USD floors.

Read at HEAD, `reconcile_parity`'s own docstring calls its reconciliation leg "an identity over the same primitives". v1.18's Pitfall 1 is the same class for 155.2.

**How to avoid:**
- Expected values come from an independent walk over the raw deals: per-day trading P&L accumulated from deals, and a D-17 cohort walk for timed days.
- Enforce a minimum checked share.
- Resolve the account unit with `classify_account_currency`.
- Self-test: a timed-day nudge of 1e-3 goes RED, and a deal moved one day goes RED.

**Warning signs:**
- An expected value computed by calling the fold.
- 100% green with zero residual on the first run.

**Phase to address:** MT5SOAK. Coordinate with 155.2 (Section E).

---

### Pitfall 13: A census pin that goes stale silently

**What goes wrong:**
TODOS says:

- `170.6.1.1-CENSUS-STALE-AXES`: `src/lib/anon-strategies-projection.test.ts` reads hand-copied lists, and nothing asserts that `ANON_ROUTE_DIRS` tracks `PUBLIC_ROUTES` in `src/proxy.ts`.
- `170.6.1.1-GATE-HIDDEN-EXEMPTIONS-UNENFORCED`: `HIDDEN_COLUMN_EXEMPTIONS` in `supabase/tests/test_strategies_anon_grants.sql` removes columns from a sweep, but no arm asserts they are hidden.
- Class example only, not a triaged member: `194.1-CENSUS-NO-FORWARD-CHECK`, where nothing stops a live site moving into `EXCLUDED`.

The pattern: an exclusion list that can grow, or a list copied from its source of truth, turns a census into ceremony.

**How to avoid:**
- Derive the list from its source at test time.
- Assert both directions: every member of the source is classified, and every exemption is checked for the property it claims.
- Pin the exclusion set exactly, with a reason per entry.
- Copy the `RATCHET STALE` shape from `src/__tests__/mutation-runner-floors.test.ts`.

**Warning signs:**
- A `const LIST = [...]` in a census test with no read of the real source.
- An allowlist edit in a feature PR.

**Phase to address:** SQLGATES2.

---

### Pitfall 14: A no-capital or degraded path that treats one transient read as proof

**What goes wrong:**
TODOS says:

- `166.3.1-NOCAP-MT5-A2-CIRCULAR`: for MT5 the stored terminal is the live balance, so the "independent" check is not independent. A transient zero can exit a funded key.
- `166.3.1-NOCAP-NONNAV-EXCEPTIONS`: only `NavReconstructionError` reverts. `KeyError`, `ValueError` and `TypeError` leave the row stale on every retry.
- `166.3.1-NOCAP-FALLBACK-TRACE`: a fallback records only a log line.
- `166.3.1-NOCAP-SEGMENT-REASON-RESIDUE`: a refused candidate leaves a residue reason.
- `167.1.2-MT5-FAILING-HOLDER`: a failing MT5 key can claim its account's holder slot.

**How to avoid:**
- No-capital requires independent proof: a poll-outcome audit, or a terminal not derived from the live read.
- Any exception while candidates are in play reverts once and logs its class.
- Every fallback carries a benign counted payload token.
- A refused candidate leaves the payload byte-equal to the no-candidate payload, pinned by a test.

**Warning signs:**
- A predicate on `balance <= floor` with no second source.
- A broad `except` that re-raises after the stored row was already replaced.

**Phase to address:** NOCAPITAL, MT5DERIVE2 for the holder slot. Apply the same rule to HOLDINGSTRUTH.

---

## B. Per-group regression table (Question 1, every group)

"Prevention" is written as a testable success criterion. Groups already covered in Section A point there.

| Group | How the fix regresses | Warning sign | Prevention (testable) | Owner |
|---|---|---|---|---|
| MT5DERIVE2 | Retry budget raised; first error still lost; one cause fixed while the batch-mate reset continues | `attempts=2` with no recorded cause after ship | Pitfall 1 criteria (a)-(c). For `164.6.6.2.3-EMPTY-COHORT0-REFUND`, a test that is RED today on a refund into an emptied account. For `164.6.6.2.3-MT5-BASIS-SILENT-NONE`, a counted warning or a block on a timed key without basis | MT5DERIVE2 |
| 202-MT5-CLOCK-LEAD-01 | Lead "confirmed" from the repo's record of the setting, not from a replay | No replay under both clock settings | Replay one moved scope under both settings and show the moved days match, or rule the lead out. Weigh the TINYBASE deletions against the vanished rows. Do not cite the untested quiet control (TODOS says) | MT5DERIVE2 |
| BYBITREADS / OKXTRADES | One coin, one settle type or one window fixed | Census table missing | Venue by path table. Every row fixed or decided, with a test per row. OKX non-USDT bill converted at a stated rate or refused loudly, with a test RED on today's code. A long first window completes in chunks, with no daily `error` | BYBITREADS, OKXTRADES |
| OKX cursor ahead | Writer of `last_fetched_trade_timestamp` not traced; queued fills read still trusts it | Fix only in the cron path | Test with a key whose cursor is ahead of its stored trades: the job reads from the stored high-water | OKXTRADES |
| DERIBITBOOK | Classifier widened by word list until the example passes; the x3836 cumulative "explained" by a single day | No per-row-shape fixture | Fixtures for each capital-reason shape (capital word, trading token without a capital word, both). `185-BOOK-CUMULATIVE-UNEXPLAINED` closes on an attribution reading, not a tolerance. The option replay (`189-OPTIONREPLAY-NEXT-MILESTONE`) needs founder approval per worker run (TODOS says) | DERIBITBOOK |
| Deribit stale returns | Re-derive one account and close | Freshness keyed on job status | Pitfall 2 invariant, checked for every venue | new goal |
| HOLDINGSTRUTH | `key:<id>` fallback kept as a silent default; marker read failure still silent; Phase 225 and this group both edit account identity | Two PRs editing `keyAccountOf` or `fetchHoldings` | `fetchHoldings` and `fetchLatestHoldingsPerKey` (`src/lib/portfolio-exposure.ts`) throw on a counted row missing from the identity read, with a test per reader. Dashboard reports `markerReadError` to Sentry and renders a disclosure. The `198` two-key test from TODOS | HOLDINGSTRUTH, sequenced with 225 |
| NOCAPITAL | Pitfall 14 | Pitfall 14 | Pitfall 14 | NOCAPITAL |
| JOBHEAL | Re-enqueue predicate that also catches healthy new strategies (`L4282`); readmit give-up still silent; reclaim fix without the lane arm | A sweep that re-enqueues brand-new strategies | First-hop drop: a separate signal (key present, no job ever, longer grace) with its own false-positive analysis (TODOS says). Exhaustion writes an audit row or alert that survives the 90-day retention wall. `reclaim_stuck_compute_jobs` calls `sync_strategy_analytics_status`, and the lane arm in `supabase/tests/test_sync_status_curated_sentence_survives.sql` re-stamps a different sentence under the same job id | JOBHEAL |
| FIGUREMATH | Pitfall 4 | Pitfall 4 | Pitfall 4 | FIGUREMATH |
| FACTSHEETHONEST | Hold or withheld rule applied to the factsheet only; owner reads the published-only RPC; "wait" copy on rows where nothing runs | Surface list not enumerated | Each surface in `190-RERUN-SURFACES-NOT-HOLDING` follows `hasStoredAnalyticsResult` with `isRecomputeOverStoredResult`. Never-computed rows show no compute date (`166.5-…` needs a founder decision first, because it reverses R-04). `/strategies` notes for `failed`, `stalled` and `never_started` name an action | FACTSHEETHONEST |
| SURFACECACHE | Pitfall 5 | Pitfall 5 | Pitfall 5. Discovery ranking of BTC strategies beside USD strategies: rank within unit or label it, with a test using one BTC strategy and one USD strategy | SURFACECACHE |
| CONNECTTRUTH | Silent `deduped` 200 kept; dedup still keyed on MT5 login without server; same arm edited by 225 | Two branches editing `create-with-key/route.ts` | The connect route refuses by name on a clash with the user's own draft (test RED on today's dedupe). A rotated-password reconnect validates and stores, or says so. Server-qualified MT5 identity is a column migration with a backfill (TODOS says it is not a patch). One error-body shape | CONNECTTRUTH merged with or sequenced after 225 |
| RATELIMITFAIR | Pitfall 7 | Pitfall 7 | Pitfall 7 | RATELIMITFAIR |
| SECRETSHYGIENE | Pitfall 9 | Pitfall 9 | Pitfall 9. Wildcard cron destination (`167.1.2.2.2-CRON-TICK-RESIDUALS`) narrowed by migration under Pitfall 8 rules. Full-history scan on a cadence, with the fixture literals made obviously fake rather than allowlisted | SECRETSHYGIENE |
| DBACCESS | `FORCE RLS` used as the `api_keys` backstop (TODOS: it breaks every connect, since service_role has no `sub`); `MAINTAIN` revoke claimed to close the lock-hold (it does not: UPDATE or DELETE still permits `LOCK TABLE`); revoking UPDATE or DELETE proposed (TODOS: not an option, they are the product's write path) | Wrong remedy in the plan | `BEFORE INSERT` ownership trigger in the existing pattern (`enforce_strategy_keys_owner_coherence`). Lock-hold: the entry's own remedy, a role-level `statement_timeout` and `idle_in_transaction_session_timeout` on `anon` and `authenticated`, which is an unmeasured assumption until the PostgREST path is shown to honour it and no legitimate request needs longer. `RANK-SPLAT-01` alias set pinned. `L2120` (H-0001 uncovered routes) shrinks its allowlist one per-site decision at a time | DBACCESS |
| ALERTPAGE / ALERTREADERS | Pitfall 6. Match-engine cron health added as a route nobody schedules | New check not in `scripts/prod-prober/cron-manifest.json` | Every new check appears in the prober cadence list, and its absence pages | ALERTPAGE, ALERTREADERS |
| SENTRYHELD | `captureToSentry` awaited in one site, fire-and-forget in another; per-page-view throttle that also hides the first event | Capture count per view unbounded or zero | `failAnonRead` holds the capture promise before throwing. Landing captures at most one per page view, and the first always sent. Sequence with Phase 221's `scrubSentryEvent` change, since both touch the capture path | SENTRYHELD after 221 |
| SQLGATES2 | Pitfall 13. Applied-migration comment "fixed" in place (Pitfall 8.3). `apply-test` guard loosened instead of taught to tell seeded from applied | An edit under `supabase/migrations/` to an applied file | The entry's deliverable: the guard distinguishes "recorded but never executed" from "applied", by comparing the ledger row's `statements` with the repo file (a seeded row carries a provenance sentence) or by probing the migration's effect, proven on both states. The entry forbids loosening the refusal. `167.1.2.2.2-PROVENANCE-GATE-RESIDUALS` is listed under "Not analysed individually" | SQLGATES2 |
| TESTLANES | Pitfall 11. The supautils PROD-image crash "measured" on the lane image instead of the PROD image | Measurement on `17.6.1.113` | Reproduce the function-denial shape in a throwaway local container pinned to the PROD image version named in the drift-check log. Never run it against PROD: the shape kills a backend. Do not move the lane pin below `.113` | TESTLANES |
| MT5SOAK | Pitfall 12 | Pitfall 12 | Pitfall 12 | MT5SOAK |
| MT5WEDGE | Auto-recycle erases evidence before capture | Cause named from logs after the recycle | Evidence capture runs before the recycle and is live-gated on a real wedge | MT5WEDGE |
| 221 SENTRYSCRUB2 | Client `Sentry.init` shipped before the last-hop scrub | Order inverted in the plan | ROADMAP already orders scrub first. A test sends a PostgREST-shaped error through every capture site and asserts `details` and `hint` are absent | 221 |
| 222 ALERTTRUTH | `computation_error_copy` arms edited with a data-reading guard; "contact support" left in one Python path | grep for the phrase still hits | Pitfall 8 rules. A copy census over Python and SQL sources for channel words | 222 |
| 223 FLOWKINDS | **Goal text conflicts with the founder ruling** (see Section D) | ROADMAP goal still names `run_stitch_composite_job` | Restate the goal to the flow-source half before planning | 223 |
| 224 DEADLEFTOVERS | Pitfall 8.6. A retired enqueue removed while a cron still calls it | Unscheduled function with a live `cron.job` row | Census of `cron.job` commands and RPC callers before drop | 224 |
| 225 ONEACCOUNTONCE | Same-owner refusal also blocks the allowed cross-user share; existing pairs silently merged | Test only for the refused case | Tests for both: same owner refused by name, and different users allowed. Existing pairs surfaced, not merged | 225 |

---

## C. Proving a gate can fail (Question 2)

### C.1 The protocol, the same for every gate kind

1. **Write the gate against the fixed behaviour. Before the fix lands, run it on today's code.** For a defect fix it must be RED today, naming the arm. A gate written after the fix and never seen failing is unproven: this is the repo's own rule, recorded in `src/__tests__/self-referential-oracle.test.ts`'s header ("a rule written after the fix and never observed firing on the real instance is unproven").
2. **Neuter.** Copy the file under test byte-for-byte to the scratchpad (`cp`, not git). Apply the smallest edit that re-introduces the defect. Run the gate. It must go RED **with the expected named arm as the first failure.** A RED on a different arm is a failed proof (the mutation runner's `wrong-first-failure` kind).
3. **Restore from the byte backup** (`cp` back, then `cmp` against the backup). Never `git checkout`, `git restore` or `git stash` on uncommitted work. Run the gate again; it must go GREEN.
4. **Record it verbatim** in the plan SUMMARY: the neuter edit, the command, the RED line naming the arm, and the GREEN line. Without that record the proof cannot be re-derived (`164.7-PLAN03-EVIDENCE-01` is the class).
5. **Bind CI green to the head SHA with the expected check count.** Use the `actions/runs?head_sha=` command in CLAUDE.md, "CI gate integrity". Count the runs; do not read "no red". The skip trailer gives a board with zero runs that looks clean.

### C.2 What the existing machinery proves by machine, and what it does not

| Machinery (read at HEAD) | What it proves | What it cannot see |
|---|---|---|
| `scripts/mutation-runner/run.mjs` with `RED-UNDER:` and `RED-UNDER-M:` twins (grammar in `scripts/mutation-runner/GRAMMAR.md`) | Every annotated SQL gate arm goes RED under its mutation, with that arm as the first failure. Defect kinds include `no-red`, `wrong-first-failure`, `occurrence-mismatch` (a needle count differs from the annotated `occurrences`) and `bad-file-ref`. Floors are ratcheted in `scripts/mutation-floors.mjs` | **Only `supabase/tests/*.sql`.** Files outside the identity idiom are printed as `unreachable:` and never mutated. Nothing here mutates vitest or pytest |
| `RED-UNDER-SETUP` apply lists plus `scripts/sql-gate-subset.mjs` `judge` | On a push, the subset includes every gate whose setup loads a changed migration (D-03) | **A migration no gate lists is invisible to mutation**, including the nightly. The subset forces FULL on it, but FULL still mutates only the listed gates. A new migration must be added to a gate's `RED-UNDER-SETUP`, or it has no mutation coverage |
| `src/__tests__/mutation-runner-floors.test.ts` | Floors are not stale-low (`RATCHET STALE`) | Whether a floor is right; the floors only bound counts |
| `scripts/lint-sql-gates.mjs --self-test` | Each rule has a red and a green fixture and fires on the red | Only the shapes its rules name, and it masks comments and literals |
| `scripts/lint-migration-data-dependence.mjs` | New data-reading `DO` guards are refused at PR time. The existing corpus is carried by a dated baseline | Guards inside `CREATE FUNCTION` bodies (stored, not executed at apply), by design |
| `scripts/live-db-execution-ledger.mjs` | The live-DB lane's failing set equals the ledger, in both directions. A run that executed nothing is a hard failure. Module import errors and stale artifacts are refused by name | Whether a passing arm asserts anything meaningful. Conditional skips stay skips |
| `src/__tests__/self-referential-oracle.test.ts` | No `const`-bound literal asserted by the same block | **Scans only `.test.ts` files under `src/__tests__/` (recursive).** Colocated tests elsewhere in `src/`, every `.test.tsx`, and all pytest are outside it |
| `src/__tests__/gate-family-meta.test.ts` | Named arms still exist in named files | Whether they still bite; its header says so |
| `src/__tests__/critical-regressions.test.ts` | Source-text invariants (`readText`) and CI wiring | A string present is not behaviour. A source pin can stay green over broken logic |
| `src/__tests__/sql-mutation-nightly-parity.test.ts` | Copied nightly steps' `run:` blocks are byte-equal | `with:` and `env:` differences (CLAUDE.md) |

**The consequence for this milestone:** most v1.22 gates are vitest, pytest or alert-path tests. For those, **no machine proves RED.** The proof is the recorded neuter, RED, restore and GREEN in C.1. The roadmapper should make that recorded proof a success criterion for every new gate, since nothing in CI will notice its absence.

### C.3 Per gate kind: method, expected RED, plug-in point, blind spot

| Gate kind | Neuter method | Expected RED | Plug into | Blind spot to name in the plan |
|---|---|---|---|---|
| **Unit test (vitest or pytest) for a defect fix** | Revert the fix's core line in a byte copy, or run the test on the pre-fix commit's file copied to scratch | The test's own assertion message naming the defect (for example the 198 two-key case naming the unnamed key) | Normal shards. Name the test after the invariant. If under `src/__tests__/`, the self-referential detector covers it | No machine mutation. Mocks written from the code under test (Pitfall 3) |
| **Money-math oracle** | Nudge one input (a flow sign, a day boundary, a constant) by a small amount in a byte copy of the production module | The oracle's per-metric diff line naming the metric and the gap | Copy the pattern in `src/__tests__/metrics-parity.test.ts`: hand-coded formulas over the committed raw input fixture, **importing no production helper**. Python side: `analytics-service/tests/test_golden_parity.py` and the regen guards in `analytics-service/tests/fixtures/test_regen_golden_guards.py` | Re-running `analytics-service/tests/fixtures/regen_golden.py` bakes the engine into "expected". Never regenerate goldens in a fix PR without a hand-derived cross-check. The oracle must be an independent invariant, never the code under test re-derived |
| **SQL gate (`supabase/tests/*.sql`)** | Annotate each arm with `RED-UNDER:` prose plus a `RED-UNDER-M:` twin on the next line, with a measured `occurrences`. Add the migration under test to `RED-UNDER-SETUP` | Runner prints the arm as first failure. Any `no-red` or `wrong-first-failure` is a defect | `sql-mutation` (subset on push), `sql-mutation-nightly`, `sql-tests` on the local stack (which replays the PR's new migration, D-F) | A new gate file or arm moves several censuses (floors, the `unreachable:` set, gate-family registries). Grep `src/__tests__` for `supabase/tests` readers and update each. An arm outside the identity idiom is `unreachable:` and unproven. `WAIVED_CEILING` stays 0: fix the cause, never add a waiver |
| **CI census pin** | Add a fake member to the source of truth in a byte copy (a new public route, a new anon column, a new excluded file) | `NEW` or `RATCHET STALE`-style message naming the member | Exact-set, both directions, derived from the source of truth (Pitfall 13) | A census reading a hand-copied list proves nothing. An exclusion map editable in a feature PR |
| **Alert-path test** | Drive the handler with a fake clock and faked transports: two flaky days, a Sentry capture returning None, a pg_net 401, a debt cleared between ticks | "paged N times, expected 1", "no recovery sent", "capture produced no event id but no ERROR logged" | Python tests beside `analytics-service/services/ops_alert.py` and `mt5_outage_alert.py`. SQL reader changes get a `supabase/tests` gate | Real delivery (Sentry rule interval, the Resend config) is PROD-only. Record a dated drill reading, as the 164.6.8 plan 09 drill did. The email channel is unconfigured by founder decision |
| **Live-DB lane test** | Neuter the RPC or migration in a byte copy and run `bash scripts/local-stack/run.sh up` then `npm run test:live-db` | The arm fails with its signature class. The ledger reports `NEW` | `frontend-live-db-lane`, read through `scripts/live-db-execution-ledger.mjs` | Never add a ledger line to absorb a failure (founder decision only). Never add a `skipIf`. A schema-only baseline lacks privilege state, the cause of the `sanitize_user` arm (TODOS says) |
| **Soak check** | Nudge a timed day by 1e-3, move one deal to the adjacent UTC day, feed a BTC account | `recon_ok=False` naming the day | `analytics-service/scripts/mt5_soak.py`, with the independent per-day walk | Soak runs against live accounts. Record which accounts and days were covered and the checked share |
| **Migration self-check** | n/a. Keep it catalogue-only | A catalogue condition (column, grant, trigger present) | `lint-migration-data-dependence` checks the shape | Data assertions belong in `supabase/tests`, not the migration |
| **Freshness invariant (Pitfall 2)** | Hold a key's series end date back in a lane fixture while its flow date moves forward | "series behind flows by N days" naming the key | A SQL gate on the lane for the predicate, plus a counts-only read-only PROD reading recorded with a date | The shared TEST database holds no data. Assert only on your own rows |

### C.4 Binding a green to the head SHA

- Count workflow runs for the exact head SHA, and compare the count of required checks against the expected count. A Vercel-only board means CI was suppressed.
- After merge, check main's CI on the merge SHA. A planning-only PR has gone red before (`LINT-CACHE-MASKS-WARNINGS`: 56 files under `.planning/phases/`, zero `src/` changes, red `frontend-lint`), so "it only touched docs" is not a reason to skip the check.
- `workflow_dispatch` of CI on `main` scans full history with gitleaks and can red on history. Re-measure a specific commit with the range form in CLAUDE.md, "CI gate integrity" trap 2, not with a dispatch.
- On a push to `main`, `sql-mutation` may run a subset or `none` (D-09). A green there is not a full-corpus proof. The nightly is. A red nightly attaches a failing check to main's head and can block a Railway redeploy (D-11).

---

## D. Forbidden closures and conflicts to surface

### D.1 Forbidden closures (lifted from TODOS entries and CLAUDE.md)

| Closure | Why forbidden | Source |
|---|---|---|
| Loosen a parity tolerance, or re-pin expected values from new output | Hides the drift the gate exists for | `QUANTSTATS-0086-REDERIVE-01`, `194-ENGINE-CONSTANTS` |
| Widen the forward/backward self-check band (hazard, "not recommended" in the source rather than forbidden) | No principled width; hides early-level error | `.planning/debug/derivecron-compose-divergence.md` option C |
| Add a line to the live-DB ledger, or weaken or skip an arm | The ledger is shrink-only; a skip measures nothing | `164.9-LIVEDB-LANE-EXECUTION-CENSUS` |
| Put `rpc` back on the retried side, or widen `pytest.skip` | Replaying a claim RPC can corrupt a fence silently | `164.9-RPC-RETRY-NARROWED-SKIP-REOPENED` |
| Edit an already-applied migration (even comment-only) | Re-enters the apply pipeline; graded CRITICAL before | `164.7-MIGRATION-COMMENT-DRIFT` |
| Loosen `apply-test`'s empty-set refusal. Hazard beside it: the refusal's own documented remedy (a `workflow_dispatch` re-run) once applied to PROD while TEST applied zero, and would do the same for a migration that never ran on TEST | Re-opens the hole Phase 164.8 closed | `164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED` |
| Edit `supabase-migrate.yml` to get a deploy out | TEST blocking PROD is a locked decision; revert the merge instead | CLAUDE.md; `scripts/lint-migration-data-dependence.mjs` header |
| Add an opt-out marker to the data-dependence linter | The hatch was designed and deliberately not built | `scripts/lint-migration-data-dependence.mjs` header |
| Add a mutation waiver | `WAIVED_CEILING` stays 0 | CLAUDE.md |
| Mark the demo-credential item closed on text removal | Account deletion is the remediation | `158-OPS-03` |
| `FORCE RLS` on `api_keys` | Breaks every connect (service_role has no `sub`) | `L2267` |
| Make drift or a verification report gate a merge | Re-creates the demotion defect | CLAUDE.md, "Completion is HISTORICAL" |

### D.2 Conflicts to surface, not blend (Rule 7)

1. **Phase 223 FLOWKINDS goal text against the composite ruling.**
   - `.planning/ROADMAP.md`'s `### Phase 223` goal still reads "The composite and flow-source half" and names `run_stitch_composite_job` and the composite member read.
   - The founder ruled flow-source only, and PROJECT.md's Key Decisions row says so.
   - The roadmapper should restate 223's goal before any planner reads it. Otherwise a planner will quote the ROADMAP and plan composite work.
2. **Demo-literal removal against the absence guard and the seed pins** (Pitfall 9). Pick the redesign (a digest needle, and the seed coupling retired or redirected) in the SECRETSHYGIENE plan, explicitly.
3. **`166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` reverses CONTEXT R-04.** It needs a founder decision before it can enter FACTSHEETHONEST's plan (TODOS says).
4. **FIGUREMATH constants.** The v1.8 Key Decision already names 365 for CAGR, and the Python engine follows it, while the TS engines use 365.25. No decision covers ddof. Do not blend: either the TS engines move to the recorded 365, or the founder amends the decision. Either way it changes published figures and touches the frozen spine, so it is a founder call.

---

## E. Integration pitfalls: parallel phases on the same seam

| Seam | Phases | Risk | Mitigation |
|---|---|---|---|
| `create-with-key` dedup arm and MT5 account identity | CONNECTTRUTH (`167.1.2-DRAFT-CLASH-SAYS-SO`, `L4097`, `L4105`), 225 ONEACCOUNTONCE, HOLDINGSTRUTH | Three branches editing the same refusal path and identity key; the triage flagged two as possible overlaps | Fold `L4097` and `DRAFT-CLASH` into 225, or run CONNECTTRUTH strictly after 225 merges. The server-qualified identity migration lands once |
| Sentry capture path | 221 SENTRYSCRUB2, SENTRYHELD, ALERTPAGE (`F3`) | Client init before scrub; throttling hides the first event; duplicate edits to `captureToSentry` callers | 221 first. SENTRYHELD and ALERTPAGE rebase on it |
| SQL error copy and staleness reader | 222 ALERTTRUTH, ALERTREADERS (`WR06`, `F5`) | Two migrations replacing related functions from stale bodies | Rebase each on `supabase/schema/functions/` dumps. Serialise the merges |
| MT5 derive code and the 155.2 Gate B window | MT5DERIVE2, MT5SOAK, NOCAPITAL (MT5 half), 155.2 LIVEPARITY | A derive change between the broker-statement window and the Gate B run moves the compared numbers. A parity pass or fail is then attributed to the wrong code | Freeze MT5 derive changes for the Gate B window, or re-run Gate B after each derive change and record the worker commit beside the verdict. v1.18 Pitfall 17 (tolerance drift) still applies |
| `compute_jobs` RPCs | MT5DERIVE2 (attempt history), JOBHEAL (reclaim, heartbeat) | Both replace claim, reset or reclaim functions | One owner for the RPC surface, or strict serial merges with re-based bodies |
| Holder slot and shared accounts | HOLDINGSTRUTH, 225, `167.1.2-MT5-FAILING-HOLDER` | A failing key holds the slot while 225 refuses the working duplicate | Settle the holder rule before 225's refusal ships |

---

## F. Members not analysed individually

These triaged members are in scope but got no pitfall of their own here. The class pitfall named beside each applies. Their own TODOS "Done when" text is the closure rule.

| Member | Group | Nearest class pitfall |
|---|---|---|
| `164.6.6.2.3-D15-THRESHOLD-BAND` | MT5DERIVE2 | 4 (a founder-chosen ratio; close by a measured rationale or by recording it as accepted, never by silently moving the constant) |
| `164.6.6.2.3-INCEPTION-DAY0-PNL` | MT5DERIVE2 | 2 (a silent NaN drop; count it or state it as intent) |
| `170.4-MATCH-UNPRICED-PER-KEY` | HOLDINGSTRUTH | 10 (one verdict read differently by match scoring and Holdings) |
| `167.1.2.2.1-WRITER-BASIS-VALUES` | HOLDINGSTRUTH | 3 and 14 |
| `FANOUT-COHORT-SIBLING-POLL-01` | JOBHEAL | 2 |
| `167.1.2-ORPHAN-COPY-FIX` | CONNECTTRUTH | 10 (every role told which key to disconnect) |
| `L2510` | CONNECTTRUTH | 10 |
| `170.1-CSV-ODD-SPELLING-REJECTED` | CONNECTTRUTH | founder acceptance or a month-name parse with a test |
| `L2120` | DBACCESS | 13 (the allowlist shrinks only) |
| `167.1.2.2.2-PROVENANCE-GATE-RESIDUALS` | SQLGATES2 | 8 and 13 |

## Technical Debt Patterns

| Shortcut | Immediate benefit | Long-term cost | When acceptable |
|---|---|---|---|
| Raise retries or watchdog thresholds | Nightly goes green | First failure stays unreadable; doubles runs | Never as a closure |
| Fix the one venue in the evidence | Small diff | The class reappears on the next coin, venue or window | Only with the census row recorded as decided |
| Throttle or mute a noisy page | Quiet channel | Real outage unreported | Only with an episode model that still pages once |
| Ledger or allowlist entry for a new red | Unblocks merge | A control that stops controlling | Never without a founder decision |
| Regenerate goldens | Tests green | Oracle becomes the code | Only with an independent hand-derived cross-check |
| Comment edit on an applied migration | Accurate prose | Apply-pipeline risk | Never; correct forward |

## Integration Gotchas

| Integration | Common mistake | Correct approach |
|---|---|---|
| pg_net | Treat `net.http_post` returning as delivery | Read `net._http_response` for the request id within its retention (6 h default; web, MEDIUM) |
| pg_cron | Read `cron.job_run_details.return_message` for NOTICE text | It carries the command tag (TODOS says, observed 2026-08-17). Count effects in tables |
| Next 16 `unstable_cache` | Expect a deploy to flush it; return failures as values | Throw inside the callback; key on what the writer moves (local docs) |
| Railway edge | Key per IP in Python | Signed forwarded identity from Vercel |
| Exchange mocks | Mirror our parser's field names | Recorded real payload shapes |
| Shared TEST | Global assertions ("table empty") | Assert on your own rows. Schema only, no data |

## Performance Traps

| Trap | Symptom | Prevention | When it breaks |
|---|---|---|---|
| Batch claim with one `claimed_at` | Long jobs reset by the watchdog behind slow batch-mates | Heartbeat or lease renewal | Backfill batches of long derives |
| OKX page cap on a first window | Daily `error` forever | Chunked or windowed walk | First window above the cap |
| Per-replica in-memory limiter | Limits N times looser, uneven resets | Shared store, or documented per-replica intent | More than one Railway replica |
| `sql-mutation` 20-minute ceiling | FULL fallback crosses the ceiling | Never raise it; answered by measurement | Many new gates plus a FULL push |

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Removing a credential literal without deleting the account | Credential stays valid from history | Account deletion first, recorded |
| Quoting a credential-shaped string in CHANGELOG or TODOS | Push-to-main gitleaks red; re-publication | Name by role only |
| Whole-column anon select | New keys leak with no review | Named alias projection and a fail-on-new-key test |
| Admin-client writer with a request-supplied uid | Cross-tenant write, with nothing in the DB to stop it | `BEFORE INSERT` ownership trigger |
| `sed` redaction with no positive scan | Unredacted host or secret in a public artifact | Post-substitution scan that refuses |

## UX Pitfalls

| Pitfall | User impact | Better approach |
|---|---|---|
| "Not available yet, appears once computed" on a failed row | Owner waits for nothing | Name the action |
| Re-running strategy blank on OG card or PDF | Shared link looks broken | Same hold rule on every surface |
| "Data source —" on the owner's own strategy | Owner distrusts their own data | Owner path reads the owner tier |
| BTC returns ranked beside USD returns | Misleading percentile | Rank within unit or label it |

## "Looks Done But Isn't" Checklist

- [ ] **MT5 retries:** attempt 1's error readable after a successful attempt 2; watchdog resets leave a reason; seven nightly `attempts=1` or a named, tested cause.
- [ ] **Freshness:** series end against latest flow and anchor, checked for every venue, not only the reported Deribit account.
- [ ] **Venue class:** a venue by read-path table exists, and every row is fixed or decided with a test.
- [ ] **Engine constants:** one year length and one ddof per founder ruling; cross-language pin; spine re-baselined as a reviewed act; CHANGELOG says figures move.
- [ ] **Caches:** degraded builds throw inside the callback; the shape-version member moved; good-after-bad within the TTL tested.
- [ ] **Alerts:** episode tests (flaky key, debt cleared, Sentry None, pg_net 401), each shown RED first.
- [ ] **Rate limits:** the founder's choice recorded; its criteria from Pitfall 7 met; the docblock citation is true.
- [ ] **Migrations:** catalogue-only self-checks; rebased on dumps; reviewer and auditor clean before merge; no applied-file edits.
- [ ] **Secrets:** accounts deleted on every project (founder, dated); absence guard still RED-able; seed and drain coupling resolved; no literal in any tracked text.
- [ ] **Surfaces:** reader census test fails on an unclassified new reader; owner and anon tested per surface.
- [ ] **Tests:** no new `skipIf`; ledger not grown; executed count not dropped; lint run without cache.
- [ ] **Every new gate:** neuter, RED with the named arm, byte restore, GREEN, recorded verbatim in the SUMMARY; new SQL gates annotated and the migration listed in `RED-UNDER-SETUP`.
- [ ] **CI:** green bound to the head SHA with the expected check count; main checked after merge.

## Recovery Strategies

| Pitfall | Recovery cost | Recovery steps |
|---|---|---|
| Migration refuses on TEST after merge | LOW | Revert the merge; fix the guard to catalogue-only; re-land |
| Migration with a stale `CREATE OR REPLACE` reached PROD | MEDIUM | Forward migration rebased on the dump of the last good body; add a `supabase/tests` arm for the reverted behaviour |
| Wrong cached answer after a fix deploy | LOW | Bump the shape-version key member; ship |
| Constants changed and figures moved unannounced | MEDIUM | CHANGELOG correction; re-derive; founder informed of the moved figures |
| Credential literal re-committed | MEDIUM | Delete or rotate the account again; forward removal; check push-to-main gitleaks on the range |
| Alert channel muted by noise | MEDIUM | Episode model; drill re-sent; dated reading recorded |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention phase (group) | Verification |
|---|---|---|
| 1 Retry hides first failure | MT5DERIVE2 with JOBHEAL | Lane test reads attempt 1's error; nightly reading recorded |
| 2 `done` is not fresh | Deribit stale-returns goal, JOBHEAL | Invariant gate RED on a held-back fixture; per-venue PROD reading |
| 3 Venue-scoped fix | BYBITREADS, OKXTRADES, DERIBITBOOK, 223 | Census table plus a test per row |
| 4 Engine constants | FIGUREMATH (founder gate first) | Cross-language pin RED on a one-sided change |
| 5 Stale caches | SURFACECACHE, FACTSHEETHONEST | Good-after-bad within TTL test |
| 6 Alert paging | ALERTPAGE, ALERTREADERS, 222 | Episode tests RED first |
| 7 Rate-limit identity | RATELIMITFAIR (founder call) | Criteria for the chosen option (Pitfall 7) |
| 8 Migration auto-apply | All migration-shipping groups, SQLGATES2 | Reviewer and auditor clean; linter green; lane gates |
| 9 Credential lifecycle | SECRETSHYGIENE (founder action) | Deletion record; guard RED-able without the literal |
| 10 Owner and anon divergence | FACTSHEETHONEST, HOLDINGSTRUTH, DBACCESS, SENTRYHELD | Reader census; owner and anon tests |
| 11 Pass by skipping | TESTLANES, all | Executed-count floors; ledger shrink-only |
| 12 Tautological soak | MT5SOAK (with 155.2) | Nudge tests RED |
| 13 Stale census | SQLGATES2 | Fake-member RED |
| 14 Transient read as proof | NOCAPITAL, MT5DERIVE2 | Transient-zero test keeps the funded key |

**Research flags for the roadmapper:**

- MT5DERIVE2 and the Deribit stale-returns goal start with a read-only diagnosis step. Both causes are unmeasured.
- FIGUREMATH, RATELIMITFAIR, `166.5-COMPUTED-AT-…` and the 223 restatement need founder decisions before planning.
- DBACCESS's lock-hold remedy needs a lane measurement as a client role.
- TESTLANES's supautils item needs a measurement on the PROD image version.
- Standard patterns, unlikely to need research: SURFACECACHE (the house pattern exists), SENTRYHELD, the 221 ordering, and the SQLGATES2 census fixes.

## Sources

- Repo at HEAD of the v1.22 worktree (HIGH):
  - `analytics-service/main_worker.py` (`watchdog_tick`, `WATCHDOG_PER_KIND_OVERRIDES`, `_ClaimedJobOptional.attempts` comment)
  - `supabase/schema/functions/claim_compute_jobs_with_priority.sql`, `reclaim_stuck_compute_jobs.sql`
  - `analytics-service/services/metrics.py` (`_CALENDAR_DAYS_PER_YEAR`)
  - `src/lib/closed-sets.ts` (`calendarYears`), `src/lib/factsheet/compute.ts` (`sharpeRatio` call)
  - `analytics-service/services/rate_limit.py`, `src/lib/ratelimit.ts`
  - `src/app/factsheet/[id]/v2/page.tsx` (`buildFactsheetPayloadCached`, `FactsheetReadError`)
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`
  - `scripts/mutation-runner/run.mjs`, `GRAMMAR.md`, `scripts/mutation-floors.mjs`, `scripts/sql-gate-subset.mjs`
  - `scripts/lint-sql-gates.mjs` (self-test run), `scripts/lint-migration-data-dependence.mjs` (run and header)
  - `scripts/live-db-execution-ledger.mjs` and `.txt`
  - `src/__tests__/self-referential-oracle.test.ts`, `gate-family-meta.test.ts`, `critical-regressions.test.ts`, `mutation-runner-floors.test.ts`, `metrics-parity.test.ts`, `e2e-match-queue-no-vacuous-admin-gate.test.ts`
  - `scripts/drain-test-compute-backlog.ts`, `analytics-service/scripts/mt5_soak.py`
  - `.planning/debug/derivecron-compose-divergence.md`, `.planning/ROADMAP.md` (Phases 221–225), `.planning/PROJECT.md`, `CLAUDE.md`
- `TODOS.md` entries cited by id (MEDIUM; recorded readings, not re-measured here).
- Triage and scope input for v1.22 (founder rulings 2026-11-23).
- [GitHub Docs: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) (LOW, search summary only; agrees with the repo's own `158-OPS-03` reasoning).
- [Supabase Docs: pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) (MEDIUM after cross-check with the repo's `ops_staleness_check` migration comment on `net.http_post` being asynchronous).
- v1.18 `.planning/research/PITFALLS.md` (still governs 155.2).
