# Phase 202: RESIDCHURN - Research

**Researched:** 2026-11-06
**Domain:** PROD read-only measurement (control capture + attribution) and one reason-code explanation in the analytics service (Python, pandas, pytest, mypy strict)
**Confidence:** HIGH on the attribution mechanism and on b3 (both reproduced offline from 188's own capture rows); MEDIUM on s6/s9/s10 (a candidate cause, not yet a measured one); the deploy-proof channel is LOW until the plan reads it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** PROD reads go through the Supabase MCP (`execute_sql`), one read-only query per call, marker query first. Only if the MCP does not work, fall back to the CLI, one query per Bash call, never chained. Founder words: "try MCP. If it does not work, then do the prod reads through CLI, but split them up, so that there are not mistakes." Large row sets are reduced to SQL-side per-scope digests so results stay small.
- **D-02** Every hand-saved MCP result is checked against a PROD-side md5 over the same result set (`d_checks.sql`) before it is used. Rationale: one transcription error was caught this way in c0.
- **D-03** The pair is `c0` and `c1`, both from the byte-identical SQL in `~/.cache/quantalyze/residchurn/sql/d_*.sql` (untracked scratch). `c0` was taken 2026-11-06 15:02:09Z (marker PRODUCTION before and inside the last query; all four checks matched; manifest at `~/.cache/quantalyze/residchurn/c0/MANIFEST.md`). `c1` is taken after the 2026-11-07 00:40Z nightly's derive and compose jobs are all done.
- **D-04** "No deploy between" is proven from the Railway deployment list of the analytics service and the PROD migration ledger, both empty between `c0` and `c1`. Vercel (frontend) deploys do not void the pair, because they change no stored value (founder rule recorded in the ROADMAP calendar constraint).
- **D-05** Hold: merges touching `analytics-service/` or `supabase/migrations/**` wait until `c1` is taken. This phase's own b3 fix ships only after `c1`.
- **D-06** A deploy inside the window voids the pair; take a new `c0` before the next nightly and use that one.
- **D-07** The c0/c1 digests say which scopes move across a quiet nightly. Per-day rows are read only for scopes that move, through small MCP queries, and diffed against 188's row-level captures `b0` (2026-11-05 08:32:31Z) and `b1` (2026-11-06 07:04:02Z) in `~/.cache/quantalyze/tinybase-gc/`.
- **D-08** Cause buckets: (a) the nightly re-derive's own movement with unchanged inputs, (b) upstream input changed (refetched trades, funding, flows), (c) a named code path (for example #1205), (d) unexplained, listed by scope.
- **D-09** "Changed" stays 188's exact comparison. The report adds size bands (<=1e-9, <=1e-6, larger) beside it and does not redefine the rule.
- **D-10** The non-nightly `derive_broker_dailies` job that finished 2026-11-06 11:25:40Z (after the nightly and after `b1`) is examined as a named cause candidate for any `b1`->`c0` movement.
- **D-11** b3's two reasons are explained read-only from its seven stored `key_inputs:*` payloads and the reason logic in `analytics-service/services/allocator_equity_derive.py` (`OUT_OF_WINDOW_FLOW` added near `:1673`, `WINDOW_TRUNCATED` near `:2490`).
- **D-12** Where a reason is a defect, fix it TDD-style with a test that is RED on today's behaviour, shipped after `c1` (D-05). Record b3's trust state after the next nightly that follows the fix.
- **D-13** Where a reason is correct behaviour, record why and leave b3 untrustworthy. No fix is invented to make it green.

### Claude's Discretion
- How the per-day reads for moved scopes are batched, as long as each stays one read-only MCP query and is checked per D-02.
- The SUMMARY line format, following 188's `gc-*` style.

### Deferred Ideas (OUT OF SCOPE)
- TODOS `185-BOOK-CUMULATIVE-UNEXPLAINED` is related but not owned here.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESID-01 | A control capture across a nightly with no deploy in between shows whether stored values move without a code change, and each moved value from the 188 re-reading (1214) is attributed to a cause or named as unexplained. | Sections "Attribution of the 1214" (cluster table, mechanism proof, size bands), "Derive triggers", "Proving no deploy", "How c1 is compared". |
| RESID-02 | Book b3's earlier reasons (`out_of_window_flow`, `window_truncated`) are explained, and fixed where they are a defect. | Section "Book b3": both reasons reproduced offline; verdict is correct behaviour, so D-13 applies. Contingency RED-first design included in case c1 contradicts it. |
</phase_requirements>

## Summary

The 1214 moved values are not 1214 independent events. They are four clusters on 14 scopes, and for three of the four clusters the mechanism is already provable from 188's own captures. (1) **An OKX account** appears as five key scopes and three key-linked strategy scopes (k18, k19, k24, k27, k32, s1, s15, s16; 69 days each, 552 rows) and (2) **a Bybit account** appears as one key and one strategy (k15, s14; 277 days each, 554 rows). On every flow-free stretch of these scopes the old and new rows differ by exactly one constant additive offset in the reconstructed NAV (coefficient of variation 0.0000 on every stretch tested). That is the signature of the derive re-rolling its NAV backward from a different terminal: `reconstruct_nav` computes `NAV_{t-1} = NAV_t - pnl_t - F_t` from `terminal_nav = anchor - upnl`, and the anchor is the live balance read at derive time, which moved in every capture. So these rows move whenever the live balance moves by something other than the new day's realized P&L, with no code change. That answers RESID-01's criterion 1 for these scopes: **yes, stored values move across a quiet nightly, because an input (the live anchor) changed**. (3) **k38** (MT5, 36 rows) moves by at most 2.0e-16 absolute: float rounding of the same backward roll from a new terminal. (4) **s6, s9, s10** (72 rows, the only large moves, up to 0.094 absolute with sign flips and one-day shifts) do not look like re-anchoring. Their latest derive in `b0` was 2026-11-02, before #1196 and #1197 reached main on 2026-11-04, and their latest in `b1` was 2026-11-06 under post-#1196/#1197/#1202/#1205 code. That makes bucket (c), a named code path, the leading candidate, but the deploy history must confirm which code wrote each side.

Two findings change how the plan must run the control. **First, the pair is almost certainly not "deploy-empty" in the literal sense.** Prod `/health` `git_sha` is expected to track main HEAD, and Railway deploys every green main push, so a planning-only or frontend-only merge may still create a Railway deployment of unchanged analytics code. The plan must define "no deploy between" as "no deployment whose commit changes `analytics-service/` or `supabase/migrations/**` content", proved from the deployment list plus `git diff` between the two commits, not as an empty list. **Second, 54 of 54 scope digests in `c0` equal a digest recomputed from `b1`'s rows** (38 key scopes, 16 strategy scopes), so nothing moved between 07:04Z and 15:02Z on 2026-11-06, including the 11:25:40Z non-nightly derive. That is a positive deterministic-re-derive control for D-10 and it also validates the float-text recipe for comparing Postgres `float8::text` digests to JSON rows.

**Book b3 (RESID-02): neither reason is a defect.** `window_truncated` is BENIGN by enum classification and true for any book whose keys start on different days (b2, b5 and b7 carry it and are trustworthy). b3 is untrustworthy because of `out_of_window_flow` alone, and that comes from one flow on k15 (the Bybit key): a deposit dated the day before k15's first return day. Bybit is not in the pinned `FULL_HISTORY_VENUES`, so the positional rule counts it. Replaying k15's stored `b1` inputs reproduces `{'out_of_window_flows': 1}` exactly. Even if the inception rule were extended to Bybit, the zero-start check would still block (implied start is 0.82% of the first-return-day level against a 0.01% band). So D-13 applies: record why, leave b3 untrustworthy, invent no fix.

**Primary recommendation:** Plan the phase as a read-only measurement with one pre-registered prediction set (below), take `c1` with a prefix-digest variant (a new day is appended at every nightly, so whole-scope digests always differ), prove "no deploy" by commit content on both Railway services, attribute by cluster using the additive-offset test and the deploy-history check for s6/s9/s10, and write b3 up as correct behaviour with its offline replay as the evidence. Ship no analytics code unless `c1` contradicts a prediction.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily return rows per key and per key-linked strategy | API / Backend (analytics worker `derive_broker_dailies`) | Database / Storage (`csv_daily_returns`) | The worker fetches venue data, rolls NAV, upserts rows; the table only stores. |
| Nightly and hourly derive triggers | Database / Storage (pg_cron + SQL enqueue functions) | API / Backend (worker claims `compute_jobs`) | Schedules live in `cron.job`, jobs in `compute_jobs`. |
| Book trust state and reasons | API / Backend (`allocator_equity_derive.py`, `allocator_equity_compose.py`) | Database / Storage (`allocator_equity_derived`) | The compose writes `degrade_reasons` and `is_trustworthy`. |
| Control capture, digests, attribution | Local tooling reading PROD through the Supabase MCP | — | Read-only; scratch files are untracked. |
| Deploy proof | Railway (deployment list for the API service and the worker) + PROD migration ledger | Git (commit content diff) | The pair is valid only if analytics-service and migration content are unchanged. |
| Frontend | Not touched | — | No stored value changes from a Vercel deploy (D-04). |

## Standard Stack

No new libraries. The phase uses what 188 built plus the repo's existing test stack.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Supabase MCP `execute_sql` | n/a | Read-only PROD queries, one per call (D-01) | Founder-chosen channel. |
| `~/.cache/quantalyze/residchurn/sql/d_*.sql` | untracked | The byte-identical c0/c1 digest SQL (D-03) | Already used for `c0`. |
| `~/.cache/quantalyze/tinybase-gc/bin/{diff,summarize,recheck}.py` | untracked | 188's comparison rule and scope labels | D-09: "changed" is 188's exact comparison. |
| Python 3 stdlib (`json`, `hashlib`, `statistics`) | system | Digest recompute, size bands, additive-offset test | No dependency needed. |
| pytest 9 / pandas 3.0.3 / numpy 2.5.4 (analytics-service pins) | per `requirements.txt` | Only if a fix ships (contingency) | `requirements.txt:136,156` [VERIFIED: analytics-service/requirements.txt]. |
| mypy `--strict` | per CI | Type gate for any analytics edit | `.github/workflows/ci.yml` step "Type gate - mypy strict over the running-service surface" [VERIFIED: ci.yml]. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Whole-scope digest `h` for c1 vs c0 | Prefix digest (rows with `date <= '2026-11-05'`) | The whole-scope digest changes at every nightly because a new day is appended. The prefix variant is required to see rewrites of old days. See Pitfall 1. |
| Reading every moved scope's full row set by MCP | Per-month md5 per moved scope, then rows only for differing months | Fewer hand-saved floats, fewer D-02 transcription risks. |

**Installation:** none. **Package Legitimacy Audit:** no external packages are installed by this phase; the audit is not applicable.

## Architecture Patterns

### System Architecture Diagram

```
 00:10Z cron-sync-trades --> cron_sync_tick() --> /api/cron-sync --> enqueue derive_broker_dailies
        (strategies that got new trades; routers/cron.py:1351-1420)                         |
 00:40Z derive-allocator-key-dailies --> enqueue_derive_broker_dailies_for_allocator_keys() |
        (one job per eligible key; key-mode)                                                |
 hourly :25 ledger_refresh_fanout --> enqueue_ledger_refresh_for_strategies()  (non-nightly) |
        (stale strategies; per-strategy attempt cooldown)                                   v
                                                       compute_jobs (pending) --> worker claims
                                                                                      |
   venue read (trades/bills/funding/flows + LIVE equity anchor) ----------------------+
        |                                                                             |
        v                                                                             v
   combine_realized_and_funding -> reconstruct_nav_and_twr:                    nav marks (api_key_nav_marks)
     terminal_nav = anchor - open_unrealized                                    apply_marks: rows before first
     NAV_{t-1} = NAV_t - pnl_t - F_t   (rolled BACKWARD)                        mark day S keep the realized value
        |                                                                             |
        +--------------------------> returns series <---------------------------------+
                                           |
              upsert csv_daily_returns (api_key_id,date) / (strategy_id,date)   [updated_at NOT in payload]
              then delete span days the payload does not carry (reconcile)
                                           |
             key-mode epilogue: key_inputs:<key> row --> compose (derive_allocator_equity)
                                           |
                       allocator_equity_derived: equity_curve (returns, curve, degrade_reasons, is_trustworthy)
```

### Recommended capture layout (untracked scratch, as 188 did)
```
~/.cache/quantalyze/residchurn/
  sql/d_*.sql            # byte-identical c0/c1 queries; add d_keys_prefix.sql, d_strats_prefix.sql, d_anchor.sql, d_jobs_subject.sql (new files, do not edit the existing ones)
  c0/ c1/                # one JSON per query + MANIFEST.md (marker answers, taken-at, PROD md5 checks)
  rows/<label>/          # row-level reads for moved scopes only
```

### Pattern 1: Prefix digest for a scope whose day set grows
**What:** compare c1 to c0 over `date <= '2026-11-05'`. `c0`'s `h` is exactly that prefix digest for every scope, because every c0 scope has `last <= 2026-11-05` [VERIFIED: `c0/keys.json` and `strats.json`, max `last` = 2026-11-05].
**When to use:** every scope-level comparison across a nightly.
**Example:**
```sql
-- same shape as d_keys.sql, one added predicate; run for c1 only, compare to c0's h
SELECT api_key_id::text AS scope, count(*) AS n, min(date)::text AS first, max(date)::text AS last,
       md5(string_agg(date::text || '|' || coalesce(daily_return::text,'null'), ',' ORDER BY date)) AS h
  FROM public.csv_daily_returns WHERE api_key_id IS NOT NULL AND date <= DATE '2026-11-05'
 GROUP BY api_key_id ORDER BY api_key_id
-- (the d_keys.sql shape also selects max(updated_at); keep it, it moves only when a new row is INSERTED)
```
The byte-identical `d_keys.sql` still runs at c1 too (D-03); it shows the appended day. The prefix variant is the comparison key.

### Pattern 2: Additive-offset test (the attribution oracle for the OKX and Bybit clusters)
**What:** if a scope's rows moved only because the backward NAV roll started from a different terminal, then on a stretch with no external flow every moved day satisfies `(1 - old/new) / prod_{u>=t}(1 + r_u)` = constant (the NAV offset divided by the NAV at the stretch end). The test needs only the old and new rows. Result on `b0` vs `b1`: coefficient of variation 0.0000 for k18 (68 days), k19, k32, and for k15 on three flow-free stretches (47, 203 and 18 days) [VERIFIED: offline analysis of b0/b1 captures this session; script in Code Examples].
**When to use:** at c1, per moved scope, to separate "same mechanism" from "something else".

### Anti-Patterns to Avoid
- **Using `updated_at` as evidence that a row was or was not rewritten.** The upsert payload carries no `updated_at` and the only trigger on the table is the owner-coherence one, so `updated_at` moves only on INSERT. All 1214 moved rows have identical `updated_at` in b0 and b1 [VERIFIED: offline, 0 of 1214 differ]. The migration comment claiming the column "ADVANCES on every refresh" (`supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql`, the "Grace anchor rationale" block) is wrong for the key-mode and strategy-mode upserts.
- **Comparing whole-scope digests across a nightly.** See Pitfall 1.
- **Treating "unchanged inputs" as achievable for OKX and Bybit scopes.** The live anchor is an input and changes every night (`anchor_usd` changed on 19 of the 30 `key_inputs` rows from b0 to b1, including all seven key scopes of the moved clusters [VERIFIED: ki payload diff, offline]). Bucket (a) can be shown only where the terminal is not a live read.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| The "changed" rule | A new tolerance-based comparison | 188's exact `n[d] != b[d]` in `bin/diff.py` plus size bands beside it (D-09) | The founder rule says the report adds bands and does not redefine the rule. |
| Float text for digests | A custom number formatter | Python `repr(float)` and `str(int)` | Reproduced all 54 `c0` digests from `b1` rows with this recipe, with zero mismatches [VERIFIED: offline]. |
| Scope labels | New label scheme | `map.json` plus `diff.py`'s ordered assignment | `map.json` holds only C and k1..k8; k9+ and s1+ are assigned by `diff.py`'s sorted-id order. Reuse `ordmap` from `diff.py` so labels match 188-16 (they did in this research: k15, k18, s6 etc. reproduce 188-16's list). |
| Deploy proof | A hand-read of the dashboard | `railway deployment list --json` (or the Railway MCP) per service plus `git diff --stat <sha>..<sha> -- analytics-service supabase/migrations` | The list alone is not enough, see Pitfall 3. |
| b3 explanation | A guess about which key carries the flow | `replay_key_equity` on the stored `b1`/`c1` rows (Code Examples) | It reproduces the exact flag and reason. |

**Key insight:** every question in this phase has an offline check that needs only data already on disk plus the repo's own pure functions. The PROD reads exist to confirm and to extend the data to `c1`, not to discover the mechanism.

## Attribution of the 1214 (answers question 1)

All numbers below are [VERIFIED: offline analysis of `b0`/`b1` row captures this session] and reproduce 188-16's `gc-r-diff` counts exactly (changed per scope, 1214 total, 186 above 1e-6, 54 scopes). Absolute difference bands: low <=1e-9, mid (1e-9, 1e-6], high >1e-6.

| Cluster | Scopes (rows each) | Rows | low / mid / high | Changed-day range | Max abs diff | Inputs changed? | Leading cause |
|---------|--------------------|------|------------------|-------------------|--------------|-----------------|---------------|
| OKX account (same account under 5 keys + 3 strategies) | k18, k19, k24, k27, k32, s1, s15, s16 (69) | 552 | 0 / 424 / 128 | 2026-08-02 .. 2026-10-26 | about 1.0e-4 to 1.2e-4 | Yes: anchor, nav mark and realized terminal changed in each key's `key_inputs` | (b): re-roll from a moved live anchor; constant additive NAV offset (CV 0.0000) |
| Bybit account (1 key + 1 strategy) | k15, s14 (277) | 554 | 12 / 542 / 0 | 2026-01-23 .. 2026-10-26 | 4.5e-7 | Yes: same fields changed | (b): same mechanism, offset about 2e-6 of NAV |
| MT5 key | k38 (36) | 36 | 36 / 0 / 0 | 2026-05-28 .. 2026-10-23 | 2.0e-16 | Terminal changed by several percent | (a/rounding): float rounding of the backward roll from a new terminal; ratio is 1.0 to the last ULP |
| Strategies on one or two accounts | s6 (31), s9 (24), s10 (17) | 72 | 14 / 0 / 58 | 2025-10-30 .. 2026-10-28 | 0.094 | Last derive in b0 is 2026-11-02 21:13-22:12Z; in b1 it is 2026-11-06 00:25 / 01:25Z | (c) candidate: derive moved from pre-#1196 to post-#1205 code; to be confirmed from deploy history. |
| **Total** | 14 scopes | **1214** | **62 / 966 / 186** | | | | |

Scope-level size bands for the report (low / mid / high): k15 6/271/0, s14 6/271/0, k18 0/53/16, k19 0/53/16, k24 0/53/16, k27 0/53/16, k32 0/53/16, s1 0/53/16, s15 0/53/16, s16 0/53/16, k38 36/0/0, s6 9/0/22, s9 3/0/21, s10 2/0/15. (The k15 and s14 rows are identical series; the OKX eight share the same 69 dates. Report them as clusters and per scope, since 188-16 listed per scope.)

**Why the OKX and Bybit rows move (proved, mechanism of record).**
- `nav_twr.reconstruct_nav` rolls backward: `nav[t - 1] = nav[t] - pnl[t] - flows[t]` from `terminal` (`analytics-service/services/nav_twr.py:479-483`) [VERIFIED: Read]. `reconstruct_nav_and_twr` sets `terminal_nav = anchor - upnl` (`nav_twr.py:1464`) [VERIFIED: Read, 1460-1464].
- For ccxt venues the derive passes the live `equity` as the anchor ("only where the combine used it as the anchor", `job_worker.py:8657-8664`) [VERIFIED: Read].
- Rows before the first mark day `S` keep their realized value (`nav_marks_apply.py`, rule 2, "Every input day before ``S`` keeps its value exactly (L1)") [VERIFIED: Read]. For all seven key scopes of the moved clusters `marks_since` is 2026-10-26, and the last changed day is 2026-10-26 itself, with no changed day on or after 2026-10-27 [VERIFIED: offline, b1 `key_inputs` and diff]. So the moving region is the realized-basis era up to `S` (day `S` itself moves by about 2e-6 relative, its return being booked against the realized level of the day before); marked days after `S` are stable.
- The constant additive offset test (CV 0.0000) is the observable consequence. It rules out nondeterminism and rules out a coefficient change.
- What the offset physically is (a wallet balance that moved by something other than realized P&L, such as accrued fees or funding, or a small non-stable balance) is [ASSUMED]. It is not needed for bucket (b), and the plan should not spend PROD reads on it.

**Why k38 is rounding.** The ratio new/old is 1.000000000 to the 16th digit on 36 days while its terminal moved several percent. A different terminal changes the magnitude of the subtraction in `reconstruct_nav` and so the last-ULP result. This is deterministic given the terminal, so it belongs with (b) in cause and with "float noise" in size.

**Why s6, s9, s10 are different.** The ratio is wild (return 0 becomes -0.0044, signs flip, one value moves from 2026-03-25 to 2026-03-26), which a NAV offset cannot do. They share changed dates (s9 and s10: 2026-04-06..08, 04-13/14, 04-22/23, 06-02/03, 08-07/08), so they look like one underlying account. Commits to `analytics-service/` or `supabase/migrations/` between the b0 derive (2026-11-02) and the b1 derive (2026-11-06 00:25Z): #1196 TINYBASE (merged 2026-11-04 07:39Z, `nav_twr.py`, `broker_dailies.py`, `transforms.py`, `nav_marks_apply.py`, `tiny_base.py`), #1197 DERIVEGAPS (2026-11-04 11:44Z), #1200 (migration only plus a test), #1202 REFUSALRACE PR 2 (2026-11-05 07:35Z, `job_worker.py`, `long_fetch.py`), #1205 (2026-11-05 09:36Z, deployed 09:49:36Z per 188-15) [VERIFIED: `git log` with `--since/--until`]. 188-16 read #1205 alone and concluded it does not change how a day's return is computed; that reading did not consider that the b0 rows of these scopes were written before #1196 existed. The plan must read the deployment history (which commit was live at each derive) to name the code path, and check the prediction below.

**Which writers write `csv_daily_returns` for these scopes** [VERIFIED: grep + Read]:
1. `run_derive_broker_dailies_job` key-mode upsert `on_conflict="api_key_id,date"` and strategy-mode `strategy_id,date`: payload builders at `job_worker.py:9970-9991`, upsert at `:10067`, then the reconcile delete at `:10085` (`ctx.supabase.table("csv_daily_returns").delete()`).
2. The key-mode under-two-days branch re-upsert and stale-day delete (`job_worker.py:9744-9768`, the one value write #1205 added).
3. The CSV finalize path and the stitched-composite path (`job_worker.py:13345-13352`) write other scopes (keyless CSV, composites), not key or key-linked strategy scopes.
The payload rows hold `api_key_id`, `allocator_id`, `strategy_id`, `date`, `daily_return` and no `updated_at`.

**Determinism given unchanged inputs.** In the four core modules (`nav_twr.py`, `broker_dailies.py`, `transforms.py`, `nav_marks_apply.py`) a grep for iteration over sets finds only `frozenset` constants and membership uses; the sums are a Python loop (`reconstruct_nav`) and `df.groupby("date")["daily_pnl"].sum()` (`transforms.py:159`), whose order follows the fetched row order [VERIFIED: grep, so a negative claim limited to those four files]. Wall-clock reads inside the derive: `datetime.now(timezone.utc)` at `job_worker.py:4921, 6867, 7205, 8229, 8620, 9425, 9659`. The flow-retention floor (`8229`) and the flow-coverage terminus (`8620`) are now-relative windows: they change which flows are fetched and which pre-terminus days are NaN-ed as the date moves. The empirical control is stronger than the grep: all 54 scope digests were unchanged from 07:04Z to 15:02Z on 2026-11-06 (see below).

## Derive triggers (answers question 2)

From `scripts/prod-prober/cron-manifest.json` (captured 2026-11-01T15:32:04Z; the live schedule for `derive-allocator-key-dailies` was re-confirmed by `b0/cron.json` and `b1/cron.json`: `[{"jobname": "derive-allocator-key-dailies", "schedule": "40 0 * * *"}]`) [VERIFIED: Read]:

| Job | Schedule | Command | What it enqueues |
|-----|----------|---------|------------------|
| `cron-sync-trades` | `10 0 * * *` | `SELECT public.cron_sync_tick();` | POST to `/api/cron-sync`; `routers/cron.py:1351-1420` enqueues `derive_broker_dailies` per strategy that got new trades. This is the 00:10Z wave for s1, s14, s15, s16 in `b0`/`b1` jobs. |
| `derive-allocator-key-dailies` | `40 0 * * *` | `SELECT enqueue_derive_broker_dailies_for_allocator_keys();` | One key-mode `derive_broker_dailies` per eligible key (`is_active`, `sync_status IS DISTINCT FROM 'revoked'`, `disconnected_at IS NULL`; function in `20260717233529_allocator_equity_derived_surface.sql`). Each key's epilogue then composes books. |
| `ledger_refresh_fanout` | `25 * * * *` | `SELECT public.enqueue_ledger_refresh_for_strategies();` | Hourly strategy refresh. The per-strategy attempt cooldown makes it about one derive a day per stale strategy (20 hours; 7 days once marks have been paused 3+ days, `20261030120000_ledger_fanout_marks_paused_weekly.sql`). **This is the non-nightly trigger.** |
| `poll-allocator-positions` | `0 1 * * *` | `SELECT enqueue_poll_allocator_positions_for_all_keys();` | Position polls, not dailies. |

The job that finished 2026-11-06 11:25:40Z was created at :25:00 (`c0/jobs.json` says only `last_updated`), which is the `ledger_refresh_fanout` tick. Other non-cron triggers exist (add-key flow `process_key.py`, the manual sync paths), but none is expected inside the window. The latest s7 derive was created 2026-11-04 17:25:00Z in `b0` and 2026-11-05 14:25:00Z in `b1` (a :25 tick each, 21 hours apart [VERIFIED: b0/b1 jobs.json]); with the 20-hour cooldown the 11:25:40Z job is probably s7 again [ASSUMED]; the per-subject jobs read names it.

**Evidence for D-10 (positive control).** `c0`'s key and strategy digests equal digests recomputed from `b1` rows for **all 38 key scopes and all 16 strategy scopes** [VERIFIED: offline recompute using `repr(float)` and `str(int)` against `c0/keys.json` and `c0/strats.json`; 38/38 and 16/16 equal]. So the 11:25:40Z derive, and every other derive in that 8-hour interval, moved nothing. Record it as `b1`->`c0` movement = 0 scopes, and the 11:25 job cleared as a cause.

## Proving "no deploy" (answers question 3)

Facts [VERIFIED: Read memory note and runbooks]:
- Two Railway services deploy independently: the API service and the backfill worker (memory `railway-analytics-deploy.md`). **Derive jobs run in the worker**, so the proof must cover both services, not only the API `/health`.
- Railway deploys only when main CI is green, and prod `/health` `git_sha` is expected to equal main HEAD (`docs/runbooks/railway-worker.md`: "git_sha ≠ current main HEAD → prod is on stale code"). `analytics-service/railway.toml` carries no watch paths [VERIFIED: Read]; whether the Railway dashboard sets any is not knowable from the repo. If it does not, **every** green merge to main deploys analytics code, including a planning-only merge that changes no analytics byte.
- The CLI command the runbook documents is `railway deployment list --json` (status `SUCCESS`, `commitHash`, `skippedReason`) [CITED: docs/runbooks/mt5-go-live.md Step 6]. The Railway MCP is available in this environment; use whichever lists deployments for both services. Do not use MCP `connect-service-source`, and recovery of a skipped deploy is the founder's (memory).
- The API `/health` returns `git_sha` [VERIFIED: `analytics-service/main.py:127-131`, `:982`]. The URL is in the memory note (the `quantalyze-production` host is wrong).
- PROD's migration ledger is `supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text)` [VERIFIED: `scripts/restore-test-from-baseline.sh:1861`]. It has **no applied-at column**, and `version` is the 14-digit filename timestamp, not the application time. So "empty between c0 and c1" can only mean `count(*)`, `max(version)` and an md5 over the sorted version list are equal at both ends, plus `git log` showing no `supabase/migrations/**` merge in the window. On PROD, `statements` stores the applied SQL (CLAUDE.md), so it is usable evidence of what ran.

**Recommended definition for D-04 (the plan should state it explicitly and get it accepted, since D-04 says "both empty").** For each of the two services, take the deployments whose creation time falls between the c0 and c1 capture instants and require that, for every such deployment, `git diff --stat <commit at c0>..<its commit> -- analytics-service supabase/migrations` is empty. If the list is non-empty but every diff is empty, the pair stands and the report says so; if any diff is non-empty, D-06 applies. Record `<commit at c0>` from the deployment list taken immediately before `c1` is not enough: take it at c0 time too. **c0 was taken 2026-11-06T15:02Z and the deployment listing for that instant was not recorded in MANIFEST.md**, so the plan should read the history now, before any new merge, and record it as the c0 deploy anchor (an Open Question below).

## Book b3 (answers question 4)

b3's stored inputs (b1 capture, `key_inputs:*` for seven keys: C, k4, k8, k10, k14, k15, k35) and the reason logic in `allocator_equity_derive.py`:

**`window_truncated` (benign, not what blocks).**
- `WINDOW_TRUNCATED = "window_truncated"` is listed under `# ── BENIGN (curve is correct) ──` (`allocator_equity_derive.py:109`) and is not a member of `_BLOCKING_REASONS` (`:182-196`) [VERIFIED: Read].
- It is added when `window_truncated = any(key_first[k] != union_days[0] or key_last[k] != union_days[-1] for k in anchored)` (`:2476-2490`) [VERIFIED: Read]. It is therefore true for every multi-key book whose keys start or end on different days. In `b1`, b2, b3, b5 and b7 carry it; b2, b5 and b7 are trustworthy [VERIFIED: `b1/books.json`].
- Verdict: correct behaviour. The token name is a misnomer ("keys have unequal windows"), which is not a defect of the computation. Record it as explained.

**`out_of_window_flow` (blocking, and the whole reason b3 is untrustworthy).**
- `OUT_OF_WINDOW_FLOW = "out_of_window_flow"` (`:121`) is in `_BLOCKING_REASONS` [VERIFIED: Read].
- Per key, `replay_key_equity` counts `out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)` where `lo, hi` are the first and last stored return days and `opening_run` is non-empty only when `history_reaches_inception` is true (`:1492-1498`), then `reasons.add(DegradeReason.OUT_OF_WINDOW_FLOW)` when the count is non-zero (`:1671-1673`) [VERIFIED: Read]. `_opening_flow_run` (`:2301-2311`) is the run of consecutive flow days ending the day before the first return day.
- The compose passes `history_reaches_inception` only for keys on `FULL_HISTORY_VENUES`, pinned as `FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})` (`:1144`) [VERIFIED: Read] and wired at `job_worker.py:17043-17046` and `allocator_equity_compose.py:832`.
- Applying that rule to each of b3's seven keys' stored flows and stored return days (`b1` capture): six keys (C, k4, k8, k10, k14, k35) each have one flow dated the day before their first return day, and each is absorbed by the opening run because the venue is deribit or mt5. **Only k15 (Bybit) has one**: a flow dated 2026-01-22, first return day 2026-01-23, empty opening run, so the count is 1. k15 is the only Bybit key in any book, so only b3 is affected [VERIFIED: offline, `b1`; same result on `b0`].
- **Reproduction:** `replay_key_equity` over k15's stored `b1` rows and flows returns `flags {'out_of_window_flows': 1}`, reasons `['out_of_window_flow']`, `is_trustworthy False`, with and without the stored realized terminal [VERIFIED: offline run of the repo function on the capture rows].
- **Would extending the inception rule to Bybit green the book?** With `history_reaches_inception=True` the same inputs read `inception_unreconciled_flows: 1`, reason `inception_unreconciled`, which is also BLOCKING. The implied start (capital before the funding day) is 0.82% of the first-return-day level against `_INCEPTION_ZERO_START_BAND = 1e-4` (0.01%) (`:1101`) [VERIFIED: offline run; band read from the module and pinned by `tests/test_allocator_equity_inception.py:271-278`].
- **The behaviour is pinned.** `tests/test_allocator_equity_inception.py:233-250` (`test_venue_without_full_history_is_unchanged`) asserts a clean opening deposit on a non-full-history key "still counts as one out-of-window flow", and `:271-278` pins `FULL_HISTORY_VENUES == frozenset({"deribit", "mt5"})` [VERIFIED: Read]. These come from 167.1.2.2 D-13/D-14 (founder 2026-10-08). 188-05 and the 188 review call the same shape "a pre-existing OKX funding-day treatment", and 188-16 records the reason as already present in `b0`.

**What would a defect look like?** A key whose opening flow reconciles to a zero start (|implied start| within the band) being blocked only because its venue is not on the list, or a flow outside the return window that no key input explains. b3 shows neither: the flow is real, the venue list is the founder's pin, and the zero-start check fails on the numbers.

**Verdict for D-12/D-13: correct behaviour, so D-13.** Record why (this section), leave b3 untrustworthy, ship no fix. This verdict depends on k15's rows, which move nightly (the same cluster as above); re-run the replay on `c1` rows and record the implied-start share and the flag line. If the share on `c1` came within the band, that would be a new fact and would reopen D-12.

**Contingency, only if c1 contradicts the verdict.** RED-first design: extend `tests/test_allocator_equity_inception.py` with a case built forward in exact `Fraction` arithmetic (the file's own oracle, `_exact_book`, `_start_for_share`) for a Bybit-venue key whose pre-funding capital is inside the band, asserting the book is trustworthy; it must fail on today's `FULL_HISTORY_VENUES`. The fix would need a stored per-key inception verdict (the derive already computes `ccxt_history_reaches_inception`, `job_worker.py:4475-4500`, "True for every Bybit account") carried in `key_inputs` and read by the compose, not a wider venue list. That is a founder-pinned venue decision, so it would be a plan-level decision, not an executor choice.

## How c1 is compared (answers question 5)

- **c1 against c0 (digests).** Use the prefix digest (Pattern 1). Expected equal for all non-cluster scopes. The appended day changes `n`, `last`, `max_updated` and the whole-scope `h` of every scope that gets a row for 2026-11-06 and nothing else.
- **c1 against b1 (row level).** For scopes whose prefix digest moved, read rows and compare with `diff.py`'s exact rule. Float text: Postgres `daily_return::text` (the column is `DOUBLE PRECISION`, `20260522111839_csv_daily_returns.sql`) equals Python `repr(float)` on the parsed JSON number, and integer-valued rows parse to `int` and print as `0`; the recipe reproduced 54/54 PROD digests [VERIFIED: offline]. Compare parsed floats with `!=` (188's rule); never compare strings by hand.
- **Books.** `payload->'returns'` is a list of `{date, r}` and `payload->'curve'` a list of `{date, equity_usd}` [VERIFIED: `b1/books.json`]. Whole-payload `h_returns`/`h_curve` always change at a nightly (new day appended and the realized-terminal roll moves). For a book digest add SQL-side prefix hashes over `jsonb_array_elements(payload->'returns')` filtered to `date <= '2026-11-05'` (D-02 check as well). Books move downstream of their member keys: b1, b4, b6 each hold one OKX key from the moved cluster, b5 holds k19, b2 holds k24 and k38, b3 holds k15 [VERIFIED: offline key lists]; b7 holds none and read `returns_changed=8, curve_rule=ok`. So 188-16's `curve_rule=broken` on b1, b4, b5, b6 is explained by their member keys' moves, with the book-level day counts larger than the key's because the weights shift on days the key's own return did not change.
- **Jobs.** ⚠️ `c0/jobs.json` is an aggregate (`kind, status, n, last_updated`, two rows), but `sql/d_jobs.sql` selects the latest job per subject (`DISTINCT ON`). They are not the same query, so "byte-identical" does not hold for the jobs capture. Treat `c0/jobs.json` as a summary only (no pending or running derive in the last 2 days; last derive done 11:25:40Z). For the gate and for attribution take `d_jobs.sql` per-subject at c1, and take it once more right before the nightly (about 00:05Z) so each scope's pre-nightly job state exists.
- **Anchors.** Add a read-only `d_anchor` query returning, per key, `payload->>'anchor_usd'`, `payload->'nav_mark'`, `payload->>'realized_terminal_usd'`, `realized_terminal_day`, `marks_since` (and `computed_at`) from `allocator_equity_derived WHERE kind LIKE 'key_inputs:%'`. These are account balances: keep them in the scratch directory and put only ratios and flags in tracked text.

### Pre-registered predictions (so the control can fail)
1. Prefix digest unchanged between c0 and c1 for every scope outside {k15, s14, k18, k19, k24, k27, k32, s1, s15, s16, k38}.
2. The OKX eight and the Bybit two move again, on days up to 2026-10-26 only, and each moved stretch passes the additive-offset test (CV near zero). No moved day after 2026-10-26 on those scopes (k38: none after 2026-10-23).
3. k38 moves, if at all, by <=1e-9 absolute.
4. **s6, s9, s10 do not move** (same code before and after, deterministic). If they move, bucket (c) is falsified for them and they are listed unexplained by scope (D-08(d)), not forced into a cause.
5. b3 still reads `out_of_window_flow,window_truncated`, trustworthy false; b2, b5, b7 still trustworthy.

If 2 holds, RESID-01 criterion 1 reads: stored values move across a quiet nightly on the live-anchored scopes, because an input moved, and on no other scope.

## Common Pitfalls

### Pitfall 1: Whole-scope digests always differ across a nightly
**What goes wrong:** the nightly appends a day to nearly every scope, so `h`, `n`, `last` and `max_updated` change and the control reads "everything moved".
**Why:** the digest covers all rows. **How to avoid:** the prefix digest (Pattern 1), added as a new SQL file, with the byte-identical `d_*.sql` still run as D-03 requires. **Warning sign:** every scope moved.

### Pitfall 2: `c0`'s jobs capture is not the `d_jobs.sql` shape
See "How c1 is compared, Jobs". **Warning sign:** a c1 jobs file with a different key set than `c0/jobs.json`.

### Pitfall 3: "Deployment list empty" may be unattainable
Prod tracks main HEAD, so unrelated green merges deploy unchanged code. Define the criterion by content (see "Proving no deploy"). **Warning sign:** a non-empty deployment list whose `git diff --stat` for the two paths is empty is being read as "voided".

### Pitfall 4: A deploy to the worker is invisible to the API `/health`
The two services deploy independently (memory). Check both. A skipped worker deploy can leave worker and API on different code; recovery is the founder's.

### Pitfall 5: Hourly fanout derives continue after the nightly
The :25 tick keeps deriving stale strategies all day (the 01:25 derive of s10 finished at 01:37:27Z on 2026-11-06). Take the jobs read inside c1 (nothing pending, running or `failed_retry`) and again after it, so a derive landing mid-capture is caught; abort and retake if one did.

### Pitfall 6: Hand-saving floats
D-02 exists because one transcription error occurred. Prefer per-month md5 first and read rows only for months that differ.

### Pitfall 7: Public repo
Tracked text must hold labels (k1, s1, b3), no PROD ids, account balances, passwords or home paths. The `d_anchor` figures stay in scratch.

## Code Examples

### Additive-offset test (offline; uses only old and new rows)
```python
# Source: this research's offline analysis of the b0/b1 captures (not a repo file).
# For a flow-free stretch of days, if the new rows come from the SAME returns with the NAV shifted by
# a constant s, then (1 - old/new) / prod_{u>=t}(1 + r_u) is constant over t. CV ~ 0 confirms it.
import statistics
def offset_cv(old, new, lo, hi):        # old/new: {iso_day: daily_return}
    days = sorted(d for d in old if lo <= d <= hi and d in new)
    prod, cum = 1.0, {}
    for d in reversed(days):
        prod *= 1 + old[d]; cum[d] = prod
    vals = [(1 - old[d] / new[d]) / cum[d] for d in days if abs(old[d]) > 1e-9 and new[d] != old[d]]
    return statistics.pstdev(vals) / abs(statistics.mean(vals))
```

### b3 replay (offline; reproduces `out_of_window_flows: 1`)
```python
# Source: analytics-service/services/allocator_equity_derive.py (replay_key_equity) on the stored key rows.
import pandas as pd
from services.allocator_equity_derive import replay_key_equity
from services.external_flows import ExternalFlow
returns = pd.Series(rows_by_day)                      # k15's stored daily_return rows, ISO-day index (strings)
flows = [ExternalFlow(f["utc_day_iso"], f["usd_signed"]) for f in key_inputs["flows"]]
ke = replay_key_equity(returns, flows, key_inputs["anchor_usd"],
                       history_reaches_inception=False,
                       realized_terminal=(key_inputs["realized_terminal_day"], key_inputs["realized_terminal_usd"]))
# ke.flags == {'out_of_window_flows': 1}; reasons == {out_of_window_flow}; ke.is_trustworthy is False
```

### Size bands (D-09, beside 188's exact rule)
```python
band = lambda a, b: "low" if abs(a - b) <= 1e-9 else "mid" if abs(a - b) <= 1e-6 else "high"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Positional `OUT_OF_WINDOW_FLOW` on every venue | Zero-start check for `deribit` and `mt5` opening runs | 167.1.2.2 D-13/D-14 (2026-10-08) | Bybit and OKX keep the positional rule on purpose; b3 is the one book it still blocks. |
| Whole-history re-derive overwrites rows each night | Rows before the first mark day still re-roll from the live anchor on ccxt venues | Marks era from 2026-10-26 (`apply_marks`) | The realized-basis era moves nightly; marked days are stable. The marks era will cover more days over time. |

**Deprecated/outdated:** the migration comment that `csv_daily_returns.updated_at` "ADVANCES on every refresh" (see Anti-Patterns).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The physical origin of the constant NAV offset on the OKX and Bybit scopes is a wallet-vs-realized wedge (accrued fees or funding, small non-stable balance). | Attribution | Low: bucket (b) holds on the proved mechanism (re-roll from a moved terminal) either way. |
| A2 | The 11:25:40Z job is probably s7's derive (20-hour cooldown arithmetic). | Derive triggers | Low: it moved nothing regardless; the per-subject jobs read names it. |
| A3 | s6, s9, s10 moved because their rows were written by pre-#1196 code in `b0` and post-#1205 code in `b1`. | Attribution | Medium: if the deploy history shows the same code on both sides, the bucket becomes (d) unexplained for 72 rows. Prediction 4 tests it at c1. |
| A4 | Railway redeploys the analytics services on every green main push regardless of path. | Proving no deploy | Medium: if watch paths exist the literal "empty list" criterion is attainable; the content-based criterion is still valid in both cases. |
| A5 | The Railway MCP can list deployments for both services; if not, the CLI form in the runbook is the fallback. | Proving no deploy | Low. |

## Open Questions (RESOLVED)

Resolved 2026-11-06 at planning time. Each question keeps its original text as lineage; the `RESOLVED:` line under it names the plan task or decision that answers it. Where the answer is only partly measurable, the line says which part is measured and which is inferred.

1. **Which commit was live in each Railway service at c0 (2026-11-06T15:02Z), and when did each deployment since then land?**
   - Known: #1205 deployed 2026-11-05T09:49:36Z (188-15); merges since are records-only (#1206-#1209, `git log` shows no `analytics-service/` or migration path).
   - Unclear: the worker's own deployment times, and whether records merges created deployments.
   - Recommendation: read both services' deployment lists first thing in the plan and write the c0 deploy anchor into `c0/MANIFEST.md`.
   - RESOLVED: plan 04. Task 1 Part A has the orchestrator read both services' deployment lists, deep enough to reach before 2026-11-02. Task 3's `deploy_proof.py` derives the c0-live commit per service (`gc-c-anchor`), judges every later deployment by the content rule, and appends the anchor to `c0/MANIFEST.md`. Plan 06 Task 2 re-derives the anchor from the c1 lists and requires it to be unchanged.
2. **Which code was live at the b0 derive of s6, s9, s10 (2026-11-02 21:13-22:12Z) and at their b1 derive (2026-11-06 00:25 / 01:25Z)?** Needs the deployment list for the window 2026-11-02 to 2026-11-06 (A3).
   - RESOLVED: plan 05 Task 1 reads plan 04's worker list, which must reach before 2026-11-02 or the run is FATAL. It names the worker commit live at each side's derive (`gc-c-codepath-derive`) and marks any straddling deployment. Task 2 names a code path only under the fixed rule (1)-(3). Plan 07 then requires prediction 4 to hold before bucket (c) stands.
3. **Per-key anchors at c0 and c1** (`d_anchor`, read through the MCP, one query per call, with a PROD-side md5 per D-02).
   - RESOLVED: at c0, plan 01 Task 1 shows all 30 `key_inputs` rows carry b1's `computed_at` (`ki_computed_at=30/30`). So b1's stored payloads are c0's anchors, with no extra PROD read. At c1, plan 06 Task 1 reads `n_anchor.sql`, which carries its own PROD-side `chk` and also returns flow days. Plan 07 Task 2 turns that read into `inputs-c1.json`.
4. **PROD ledger `count(*)`, `max(version)` and an md5 over `version` at c0 time and at c1 time.** c0 recorded none; the plan can read the c0-time state only if no migration was applied since (check `git log` for `supabase/migrations/**`, none found since `20261106120000`).
   - RESOLVED, partly measured and partly inferred: c0 recorded no ledger, and the ledger has no applied-at column, so the c0-time state cannot be recovered. The first ledger read is the pre read (plan 04 Task 1, about 9 hours after c0). The c1 read (plan 06 Task 1) is compared with it, so pre to c1 is measured (`gc-c-ledger: capture=c1 ... equal_to_pre`). From c0 to pre, "no new row" is inferred, not measured. It rests on two signals that plan 04 Task 3 records: zero `supabase-migrate.yml` runs, and zero commits on `origin/main` touching `supabase/migrations` in that window (`gc-c-ledger-basis`). Plan 06 Task 2 repeats both signals over c0 to c1 and makes them conditions of `gc-c-pair: verdict=valid`. Plan 07's `202-REPORT.md` names this inference under `## Limits`. The signals do not cover a row written by a path other than that workflow, such as a developer CLI push from a PROD-linked checkout.
5. **Per-subject derive jobs now and just before the nightly** (the `d_jobs.sql` shape; Pitfall 2), plus the same at c1.
   - RESOLVED: plan 04 Task 1 Part B reads `d_jobs.sql` plus `n_jobs_check.sql` before the nightly. It also defines a late path and a missed-window path, both checked by plan 04 Task 2. Plan 06 Task 1 reads the same pair before and after the c1 capture, and `check_capture.py --kind c1 --pre` requires the two to be equal and the nightly to have covered every key.
6. **The founder's acceptance of the content-based "no deploy" definition** (D-04 says "both empty"). The plan should surface it as a one-line decision, not assume it.
   - RESOLVED: founder decision 2026-11-06, recorded as the D-04 amendment in `202-CONTEXT.md` (AskUserQuestion answer "Content-based (Recommended)") and as the Phase 202 "Amendment 2026-11-06" paragraph in `ROADMAP.md`. The amendment changes only the Railway half. The ledger half, "no new ledger row between c0 and c1", is unchanged (see question 4 for which part of it is measured).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP `execute_sql` (PROD) | All PROD reads (D-01) | Not probed here (PROD safety rule) | n/a | CLI, one query per Bash call (D-01) |
| Railway MCP / `railway` CLI | Deploy proof | MCP instructions present in this environment; CLI link state in this worktree not probed | n/a | `/health` `git_sha` for the API only (weaker) |
| `~/.cache/quantalyze/{tinybase-gc,residchurn}` scratch | All offline analysis | yes | untracked | None; read-only |
| python3 with pandas, numpy | Offline analysis and tests | yes | pandas 3.0.1 (system); analytics pins 3.0.3 | analytics venv |
| pytest from `analytics-service/` | Contingency test | yes | `tests/test_allocator_equity_inception.py`: 19 passed in 5.9 s | none needed |

**Missing dependencies with no fallback:** none. **Missing with fallback:** the Railway link state, to be confirmed by the plan's first task.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

This phase's deliverables are measurements and a written explanation. The validation that can fail is the capture integrity and the cross-checks, plus a gate that proves the b3 verdict.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), plus stdlib Python check scripts in the untracked scratch directory |
| Config file | `analytics-service/pytest.ini` (`pythonpath = .`, `asyncio_mode = auto`) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_inception.py -x -q` |
| Full suite command | `cd analytics-service && python3 -m pytest -q` and `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (only if analytics code changes) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESID-01 | c1 capture integrity: marker PRODUCTION before and inside the last query, all PROD-side md5 checks equal the local recompute, no pending/running derive job at c1 | scratch script (stdlib) | `python3 ~/.cache/quantalyze/residchurn/bin/check_capture.py c1` (to write; fails loud on any mismatch) | Wave 0 |
| RESID-01 | Float-text recipe: digests recomputed from `b1` rows equal `c0` digests (54/54) | scratch script | `python3 ~/.cache/quantalyze/residchurn/bin/recompute_digest.py` (to write from Code Examples; must be able to fail: feed it a row edited by 1 ULP and see RED) | Wave 0 |
| RESID-01 | Every one of the 1214 values lands in exactly one cause bucket or is listed unexplained by scope; per-cluster counts sum to 1214; band counts 62/966/186 | scratch script | `python3 ~/.cache/quantalyze/residchurn/bin/attribute.py b0 b1` (to write; asserts the sums) | Wave 0 |
| RESID-01 | Additive-offset test per moved stretch; falsifiable (a stretch with a deliberately altered row must give CV far from 0) | scratch script | same script, `--neuter` self-test | Wave 0 |
| RESID-01 | No code-changing deploy in the window: for each deployment in the window `git diff --stat` for `analytics-service` and `supabase/migrations` is empty; ledger count/max/md5 equal | shell + MCP read | `git diff --stat <c0sha>..<csha> -- analytics-service supabase/migrations` (empty output) | n/a |
| RESID-02 | b3's flag and reason reproduce from stored inputs: `{'out_of_window_flows': 1}` for the Bybit key, none for the six deribit/mt5 keys | scratch script using the repo function | script from Code Examples (b3 replay), asserting the flag line on `b1` and on `c1` rows | Wave 0 |
| RESID-02 | The pinned venue rule is unchanged: `FULL_HISTORY_VENUES == frozenset({"deribit", "mt5"})` and the "unchanged" case holds | pytest | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_inception.py -x -q` | yes, 19 passed |
| RESID-02 (contingency) | A RED-first test for a defect, only if `c1` contradicts the verdict | pytest | new test in `tests/test_allocator_equity_inception.py`, RED before the change and GREEN after, with `mypy --strict` over `services/` | contingency |

### Sampling Rate
- **Per task commit:** the relevant scratch check, plus `git diff --name-only origin/main...HEAD -- analytics-service supabase/migrations` empty for this branch (the phase ships no code unless the contingency fires).
- **Per wave merge:** all scratch checks green; the planning-only ship rule applies (the branch changes nothing outside `.planning/` unless the contingency fired).
- **Phase gate:** attribution sums to 1214, b3 section committed with the replay output, SUMMARY carries the marker answers and the `gc-*`-style lines.

### Wave 0 Gaps
- [ ] `check_capture.py`, `recompute_digest.py`, `attribute.py` in `~/.cache/quantalyze/residchurn/bin/` (untracked scratch, written the way 188 wrote its `bin/` kit). Each must be shown RED on a deliberately broken input before it is trusted (the repo rule: a gate that cannot fail is wrong).
- [ ] New SQL files (never edit the existing `d_*.sql`): `d_keys_prefix.sql`, `d_strats_prefix.sql`, `d_books_prefix.sql`, `d_anchor.sql`, a per-subject jobs file, and PROD-side md5 checks for each (D-02).
- [ ] The c0 deploy anchor and the ledger state, recorded in `c0/MANIFEST.md` before any merge.

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | The PROD password is not read; reads use the MCP session (task rule). |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Read-only statements only, marker query first, one statement per call; no write, no DDL. |
| V5 Input Validation | yes | Queries are static text from the scratch directory; no interpolated user input. |
| V6 Cryptography | no | md5 is used as a transport checksum (D-02), not for security. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Writing to PROD by mistake | Tampering | Marker query first (CLAUDE.md `which_database` query), read-only statements, MCP one-per-call; no `q.sh`, no CLI link use. |
| PROD ids, balances or secrets in tracked text | Information disclosure | Labels only; anchors and balances stay in untracked scratch; the repo is public. |
| A transcription error accepted as a measurement | Tampering | D-02 PROD-side md5 per result set; recompute locally before use. |
| A void pair read as valid | Repudiation | Content-based deploy proof recorded in the MANIFEST (D-04, D-06). |

## Project Constraints (from CLAUDE.md)

- **Database marker first**, every time: `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();` The checkout's CLI is linked to PROD; `current_database()` proves nothing. This phase uses the MCP, not the CLI link.
- **Public repo with `.planning/` tracked:** no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence.
- **Ship guard:** a ship branch must change nothing under `.planning/` (memory note); this phase's records go to main afterwards. A measurement-only phase ships no `analytics-service/` change unless the contingency fires.
- **Hold (D-05):** no merge touching `analytics-service/` or `supabase/migrations/**` until `c1`. `VERSION`/`package.json` bumps and CHANGELOG discipline apply to any code ship (never `npm version`; byte-equal 4-digit strings; no skip-CI tokens in commit messages, not even to deny them).
- **Verification files:** use `verified_at_sha` and `drift_subjects`, never `covered_digest` or `covered_files`.
- **Tests verify intent and can fail:** neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work). Always `grep -a`. pytest only from `analytics-service/`; never `importlib.reload` in tests; mypy strict is in every analytics-touching brief.
- **Executors via `/gsd-execute-phase`**, never hand-dispatched; review only MEDIUM+ findings.
- **No AI authorship attribution trailers** in commits or PR text for this repo (memory note, founder 2026-10-20), which overrides the generic attribution reminder.
- **Not touched:** DESIGN.md (no UI), the shared TEST database.

## Sources

### Primary (HIGH confidence, files read this session)
- `analytics-service/services/allocator_equity_derive.py` (reason enum, `_BLOCKING_REASONS`, `FULL_HISTORY_VENUES`, `replay_key_equity`, `window_truncated` rule).
- `analytics-service/services/nav_twr.py` (`reconstruct_nav`, `reconstruct_nav_and_twr`, `ccxt_history_reaches_inception`).
- `analytics-service/services/job_worker.py` (derive upsert, reconcile delete, anchor and terminal comments, `now()` sites, `FULL_HISTORY_VENUES` wiring).
- `analytics-service/services/nav_marks_apply.py` (rules 1-6, L1).
- `analytics-service/tests/test_allocator_equity_inception.py` (pinned venue rule).
- `scripts/prod-prober/cron-manifest.json`, `analytics-service/routers/cron.py:1351-1420`, `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql`, `20261030120000_ledger_fanout_marks_paused_weekly.sql`, `20260522111839_csv_daily_returns.sql`, `supabase/schema/baseline.sql:15669` (the only trigger on `csv_daily_returns`).
- 188 artifacts: `188-CONTEXT.md` (D-10..D-13), `188-15-SUMMARY.md`, `188-16-SUMMARY.md`, `188-VERIFICATION.md`, `188-05-SUMMARY.md`, `166.3.1-SC5-DECISION.md`.
- Untracked scratch: `tinybase-gc/{b0,b1,map.json,bin/diff.py}` and `residchurn/{c0,sql}`.
- `git log` over `analytics-service/` and `supabase/migrations/` for 2026-11-04 to 2026-11-07.

### Secondary (MEDIUM confidence)
- `docs/runbooks/railway-worker.md`, `docs/runbooks/mt5-go-live.md` (deployment list command), memory note `railway-analytics-deploy.md`.

### Tertiary (LOW confidence)
- None used as a basis. Claims tagged `[ASSUMED]` are in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new tools; existing kit reused.
- Attribution (OKX, Bybit, k38): HIGH, reproduced and mechanism proven offline.
- Attribution (s6, s9, s10): MEDIUM, candidate cause from timestamps and commit times, to be confirmed by deploy history and prediction 4.
- b3: HIGH for the explanation (reproduced with the repo function); the "correct behaviour" verdict is MEDIUM-HIGH because it rests on k15's rows, which move nightly (re-run at c1).
- Deploy proof: LOW until the plan reads the deployment lists.
- Pitfalls: HIGH.

**Research date:** 2026-11-06
**Valid until:** the c1 capture (2026-11-07); every figure above is bound to the b0, b1 and c0 captures and should be regenerated rather than trusted after that.
