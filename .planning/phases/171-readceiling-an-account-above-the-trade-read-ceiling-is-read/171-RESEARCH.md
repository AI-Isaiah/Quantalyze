# Phase 171: READCEILING - Research

**Researched:** 2026-10-27
**Domain:** Python analytics worker (allocator history rebuild), Bybit v5 execution-list paging, Postgres/Supabase migration with RLS, closed-vocabulary probe and refusal tokens
**Confidence:** MEDIUM (code structure HIGH, read this session; the design is new and unbuilt; Bybit server-side behaviour beyond the documented parameters is LOW and marked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried (not re-asked)**
- TRADEPAGES 167.2.1.1.2.1 D-01 ("Shorten the window"), D-02 (a walk stops only on an empty page, a non-advancing cursor or the window end; Bybit in 7-day windows), D-05 ("Rebuild none, book follow-ups").
- ACCTREBUILD 167.2.1.1.2 D-01..D-03: older stored days kept; a stored in-window day the rebuild does not reproduce refuses the account and writes nothing; the seam is recorded. UPNLVENUES D-04/D-05 and ACCTREBUILD AR-5/AR-7: one window shared by all members, anchor required.
- RECONMARKER 167.1.2.1 D-06, D-09, D-14, D-17 (daily re-enqueue, stop after 5 attempts, non-gating note, attempts counted in SQL).
- The forced-refusal vocabulary is a closed, pinned set; a new token moves the pin test, the probe and the handoff together.
- Never write a partial read as the whole history (TRADEPAGES REVIEW-2 WR-01).

**D-01 Measure first.** The first plan re-probes a6 (read-only, counts only, the allocator_history_probe pattern) and records which limit stopped the read (the 100-page window ceiling vs the stall/no-progress site), the window age bucket, call count and elapsed seconds. The probe's closed record schema changes with it. Code that depends on which limit fired waits for this reading.

**D-02 Read model: resumable across runs.** Founder 2026-10-27, AskUserQuestion: "Resumable across runs" (chosen over the recommended single time budget with stall-splitting). The read position and what has been read are kept between runs so a book of any size eventually completes; each run reads within the existing crawl bound and defers (`defer_compute_job`) instead of refusing. Nothing is written to the allocator's history until the read is complete (ACCTREBUILD D-02). Persisted trade data needs a migration with owner/service-role RLS and an expiry, migration-reviewer and rls-policy-auditor clean before merge (PROD auto-applies after TEST), and a catalogue-only verify block.

### Claude's Discretion
- What is persisted (raw trades vs fold state), how the fixed two-year edge and the moving `now` are pinned at job start, and the expiry.
- Whether OKX walks use the same mechanism in this phase or stay booked (OKX ordering is Phase 173's gate).
- How a job that keeps making no progress is stopped by name (a stall still refuses loud; a resumable read never loops forever).

### Deferred Ideas (OUT OF SCOPE)
- Showing a shorter recent span while the read completes (not chosen).
- Phase 173 REBUILDGATES (Bybit transfer depth, OKX order) depends on this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were provided (ROADMAP: `**Requirements**: TBD`). The three ROADMAP success criteria are the contract:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | An a6-shaped account (one Bybit member plus other venues, 730-day window) is read in full within a bounded budget, or refused with a named reason a later run can clear | Sections "Recommended design" (in-run continuation + resumable window store + budgeted defer + named stall token), "Refusal vocabulary" |
| SC-2 | Tests go RED on the current ceiling behaviour (a truncated read that refuses on every attempt) | "Validation Architecture": finite over-ceiling book. RED at base was reproduced this session (see Summary) |
| SC-3 | After deploy the TRADEPAGES probe re-reads a6 and the outcome is recorded (counts and tokens only) | "D-01 / SC-3 probe changes"; the probe stays read-only and never sets the resume scope |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (from `./CLAUDE.md`, `AGENTS.md` and the user memory the orchestrator supplied):

- **Database safety.** The checkout's Supabase CLI is linked to PRODUCTION. Never run `supabase ... --linked`, `db push`, `--db-url` from here. Run the `COMMENT ON DATABASE` marker query before any statement that writes (shared TEST is shared with other people's CI). SQL gates run on the throwaway local lanes (`scripts/pg-lane/run.sh`, `scripts/local-stack/run.sh`), never TEST or PROD.
- **Migration rules.** Merging `supabase/migrations/**` applies to TEST and then to PROD with no human stop. Verify block must read the catalogue only (no data census: shared TEST holds PROD's catalogue and none of its data, `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`). Before `CREATE OR REPLACE` re-base on the latest definition (this phase should not need one). No explicit transaction statements; `SET LOCAL lock_timeout`. No `cron.schedule`.
- **SQL gate integrity.** A new `supabase/tests/*.sql` file moves several censuses (listed in "Census files"). Every arm needs a `RED-UNDER` / `RED-UNDER-M` annotation; `WAIVED_CEILING` is 0, do not add a waiver. Read `FILES_FLOOR`, `ARMS_FLOOR`, `WAIVED_CEILING` by symbol from `scripts/mutation-floors.mjs`, never restate a number from prose. Cite code by symbol, not line number, in tracked prose that must outlive the next commit.
- **Gates for Python.** `pytest` runs only from `analytics-service/`. mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. Never `importlib.reload` in tests. `grep -a` always.
- **Testing doctrine.** Data-integrity gates must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Money-math oracles are independent invariants.
- **Ship rules.** Every ship writes a CHANGELOG entry (themes cross-checked against commits) and bumps `VERSION` and `package.json` as byte-equal 4-digit strings, in the same `chore(release)` commit; never `npm version`. Never write the CI skip tokens in a commit message or PR body, not even to deny them. A ship branch must change nothing under `.planning`. No AI authorship trailers (user memory, founder 2026-10-20).
- **Public repo hygiene.** No secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence. The probe's output is counts and tokens only.
- **Review gates.** migration-reviewer and rls-policy-auditor clean before merge; gsd-code-reviewer plus silent-failure-hunter, MEDIUM and above.
- **Agent briefs / CI.** `mypy` belongs in every analytics-touching brief. Verification frontmatter uses `verified_at_sha` + `drift_subjects`, never `covered_digest` / `covered_files`.
- `AGENTS.md` (Next.js caveat) and `DESIGN.md` do not apply: this phase has no UI.

## Summary

**What the code does today.** The whole-account rebuild (`_crawl_whole_account`) runs every exchange member concurrently through `_crawl_account_key` -> `_fetch_and_price_window` -> `_fetch_trades_with_pagination` -> `_fetch_bybit_trades`, under one `asyncio.wait_for(..., _RECONSTRUCT_CRAWL_TIMEOUT_S)`. `_fetch_bybit_trades` tiles the range into 7-day windows and pages each with Bybit's cursor, at most `_BYBIT_WINDOW_PAGE_CEILING` pages per window; reaching that count, or a full page that does not advance, raises `TruncatedTradeRead` (a `ccxt.BadRequest`), which `classify_exception` calls permanent. The result is deterministic: the forced rebuild refuses `account_key_read_failed` on every attempt and an unforced first-connect reconstruct ends FAILED permanent with no history.

**Reproduced this session (SC-2 is real).** On the unmodified tree a throwaway script outside the repo, using the repo's own `VenueTradeBook` fake, showed: (a) a FINITE book of 10,500 trades inside one 7-day window raises `TruncatedTradeRead` after exactly 100 calls (RED at base); (b) an a6-shaped finite book of 104 windows x 1,200 trades (124,800 rows) is read whole in 1,249 calls. So a6's probe numbers (127,471 trades, 1,378 calls) are equally consistent with "one window above 10,000 executions" or with "a stall in a later window"; the calls and rows alone cannot decide. That is exactly what D-01 must measure. `[VERIFIED: local run this session against the repo's fakes]`

**Two findings the planner must weigh against D-02.**
1. **a6 was not time-bound.** The probe wraps each member in `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)` (1500 s) and records a timeout as its own failure class; a6's class was `truncated`, so the 1,378-call read ended in under 1,500 s. ccxt prices `v5/execution/list` at cost 5 against a 20 ms `rateLimit` (about 100 ms per call), so one claim can read on the order of 10^5 to 10^6 trades. Whether a6 therefore needs cross-run persistence at all depends on D-01: if the stop was the window ceiling, an in-run continuation past 100 pages reads a6 in one claim and the persistence layer is exercised only by books beyond roughly one claim's budget. D-02 is locked (founder), so the plan builds both layers, but SC-1's a6 case may be satisfied by layer 1 alone and the cross-run path is then proven by synthetic books, not by a6. Say so in the plans. `[ASSUMED: per-call latency; the probe's new elapsed reading settles it]`
2. **Memory.** A parsed ccxt trade dict measured about 4.9 KB deep in memory (local ccxt 4.5.64, synthetic Bybit execution; prod pins 4.5.88), so 127k trades is on the order of 600 MB resident before `_compute_daily_equity` makes a shallow copy of each into its event list. A compact projection (7 fields) measured about 1.0 KB as a dict, 141 B as JSON; as a positional array, 54 B as JSON. Project each trade when its window completes (both for persistence and in memory) so the replay sees one shape whatever its origin. `[VERIFIED: local measurement this session; real records and symbol strings will differ]`

**Primary recommendation.** Build the phase in two layers behind one stopping contract. Layer 1 (no migration): replace the Bybit "100 pages then raise" with continuation BY TIME (the proven OKX backward-walk technique, applied inside a Bybit window: after a page budget, restart the window with `until = oldest_seen + 1`), keeping a loud stop when an iteration does not lower the end bound. Layer 2: persist each COMPLETED 7-day window (compact projection, pure function of key + window + read version) in a new service-role-only table pair; a soft per-claim read budget checked at window boundaries raises a new `TradeReadDeferred` after the progress is stored, and the handler turns it into `defer_compute_job`. A claim that completes no new window counts as stalled; three stalled claims, or a job older than 24 h, refuse by one new closed token. OKX and the generic walk stay out of this phase (booked to Phase 173).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reading trades across 7-day windows, continuation, budget, projection | Analytics worker (`services/equity_reconstruction.py`) | ccxt (request mapping) | Only the worker holds decrypted keys and talks to Bybit |
| Persisting completed windows and the stall counter | Database / Storage (new tables, service_role only) | Analytics worker (new `services/trade_read_store.py`) | The state must survive worker restarts and watchdog reclaim; nothing in the browser reads it |
| Deferring between claims | Database (`defer_compute_job`, claim-token fenced) | Analytics worker handler | Existing RPC; the handler is the only caller |
| Naming a stalled read | Analytics worker (closed token in `FORCED_REBUILD_ACCOUNT_REASONS`) | Probe vocabulary, post-deploy handoff doc | The token set is pinned in three places |
| Keeping the allocator's history untouched until the read is whole | Analytics worker persist half (unchanged) | `replace_allocator_equity_snapshots_window` | ACCTREBUILD D-02: the deferral happens before the persist half, so no new write path exists |
| Measuring the raise site, window age, calls, elapsed | Probe script (`scripts/allocator_history_probe.py`) | Operator step on the backfill worker | Read-only; closed record schema |
| Access control on persisted trades | Database RLS + grants | -- | RLS forced, no policy for anon/authenticated, grants only to service_role |

## Standard Stack

### Core

No new libraries. Everything below is already in the tree.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | 4.5.88 pinned (`analytics-service/requirements.txt`); 4.5.64 installed locally | `fetch_my_trades` request building and parsing for Bybit | Already the rebuild's read path; the repo's fakes drive REAL ccxt parsing (`tests/_trade_pages.py::real_ccxt_client`) |
| supabase-py via `services.db.db_execute` | existing | PostgREST access for the new store | Same access path as every other table |
| pytest + pytest-asyncio (`asyncio_mode = auto`) | pytest 9.0.2 locally | analytics tests | `analytics-service/pytest.ini` |
| mypy strict | 2.0.0 locally; `python_version = "3.12"` | the CI type gate | `analytics-service/pyproject.toml` |
| vitest | repo-pinned | TS census tests that read the SQL gate roster | existing |

### Supporting

| Item | Purpose | When to Use |
|------|---------|-------------|
| `contextvars.ContextVar` (stdlib) | carry the resume scope into `_fetch_and_price_window` without a new keyword | the existing PD-J pin forbids new keywords on the crawl call (see Pitfall 3) |
| `time.monotonic` | the claim deadline | budget checks at window boundaries |
| `services.okx_archive_job` patterns (`_defer_job`, `MIN_DEFER_S`, `BACKSTOP_AFTER_S`, `_ClaimBudget`) | the deferral template | copy the idea, not the module: it imports `job_worker` and is OKX-specific |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw compact trades per window | Replay fold state (quantities + perp positions per day) | Rejected, see "What is persisted". Fold needs `_compute_daily_equity` split into fold and mark, and float addition is not associative, so reordering transfers against trades could move cents; raw trades make the replay input identical to a single pass |
| New tables | `kind='trade_read:<key>:<window>'` rows in `allocator_equity_derived` ("add a new family = INSERT a new row; no ALTER TABLE") | Rejected: that table is owner-readable and read by dashboard code (`AllocatorExchangeManager.tsx`, `queries.ts`), has no expiry column, and CONTEXT already demands a migration |
| Cursor persisted between claims | Window-granular persistence | Bybit documents no cursor lifetime (`[CITED: bybit-exchange.github.io/docs/v5/order/execution]` says only "Use the `nextPageCursor` token ..."), so resuming mid-window on a stored cursor would rest on an undocumented property. Window granularity needs nothing undocumented |
| `set_compute_job_progress` for the stall counter | a typed state row | That RPC merges into `metadata->'member_progress'`, which the stitch poll route reads as an array; overloading it is a hidden coupling |

**Installation:** none.

**Version verification:** no package is added. ccxt's `v5/execution/list` cost (5) and `rateLimit` (20) were read from the locally installed 4.5.64 (`ccxt.bybit().api['private']['get']['v5/execution/list']`); the pinned 4.5.88 was not installed here, so the cost is `[ASSUMED]` equal in 4.5.88.

## Package Legitimacy Audit

No external package is installed or recommended by this phase. Audit table: not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 reconstruct_allocator_history job (claimed, token T, attempts n)
        |
        v
 run_reconstruct_allocator_history_job
   preflight -> end_date=today -> forced? --yes--> _read_account_keys
        |                                   |
        |                          _crawl_whole_account (asyncio.wait_for 1500 s, hard bound)
        |                                   | sets the claim deadline (soft, ~900 s) once
        |                                   v
        |                  gather( _crawl_account_key(member) ... )   one task per member
        |                                   |
        |         non-Bybit member: unchanged crawl (trades, transfers, OHLCV, anchor)
        |                                   |
        |         Bybit member:  [trade-read scope: store handle + api_key_id + deadline]
        |                                   v
        |              _fetch_bybit_trades(since, now)
        |                 load state (discard if expired / other read_version / since < grid origin)
        |                 for each grid window W (origin + 7d*k) that overlaps [since, now]:
        |                    persisted?  --yes--> use stored rows
        |                    no: deadline passed? --yes--> save progress, raise TradeReadDeferred
        |                        read W: cursor pages (<=100) -> still more? -> until=oldest+1, again
        |                          (strictly lowering end, else TruncatedTradeRead(site))
        |                        W ended before now-1h? -> project rows, save_window(W)   [immutable]
        |                 tail window [last grid start, now] is never persisted; read live
        |                 return rows with timestamp >= since, in original append order
        |                                   v
        |              transfers, OHLCV, anchor (only when the trade read finished)
        |                                   |
        |    gather outcomes, key order:  refusal wins > DispatchResult > TradeReadDeferred > retryable > permanent
        |                                   v
        +--> TradeReadDeferred --> _defer_job (defer_compute_job, reason = counts only) --> DEFERRED
        +--> TradeReadStalled  --> ForcedRebuildRefusedError("account_key_read_stalled") / unforced FAILED permanent (state kept)
        +--> complete rows ----> persist half (unchanged: replace_equity_snapshots_window) --> DONE
                                   then best-effort purge of this key's store rows
```

### Recommended Project Structure

```
analytics-service/
  services/
    equity_reconstruction.py     # _fetch_bybit_trades continuation + scope read; token; gather/handler arms
    trade_read_store.py          # NEW: ContextVar scope, load/save_window/touch/purge, projection (no job_worker import)
  scripts/allocator_history_probe.py   # D-01: new closed record keys
  tests/
    test_trade_pages.py          # existing ceiling tests: two pins move (see Pitfall 6)
    test_trade_read_resume.py    # NEW: resumable read, equivalence oracle, stall, never-ending venue
    test_trade_read_store.py     # NEW: store mapping against the fake client
    test_allocator_history_probe.py
supabase/
  migrations/<ts>_allocator_trade_reads.sql        # NEW (+ down/<ts>-rollback.sql)
  tests/test_allocator_trade_reads.sql             # NEW gate
  schema/baseline.sql, BASELINE.md, baseline-carried-migrations.txt   # re-dump AFTER the PROD apply
```

### Recommended design

#### 1. What is persisted: raw compact trades, one row per COMPLETED window

**Decision.** Persist the trades of each fully read 7-day window, projected to the 7 fields the replay reads, in the exact append order the read produced them. Not fold state.

Why (all `[VERIFIED: read this session]` unless tagged):
- `_compute_daily_equity` consumes `timestamp`, `symbol`, `side`, `amount`, `price`, `cost`, `fee` (a dict with `cost`, or a number) and `info.instType` (OKX only; Bybit passes no inst_type). With the same list in the same order the replay output is bit-identical to a single pass; a test can assert exactly that.
- Fold state would need the replay split into fold and mark, and the valuation needs the full symbol set for OHLCV, which is only known when the read is complete. It also changes the addition order of float operations (transfers fold in at read time), so cents could move. The rebuild is a data-integrity path guarded by ACCTREBUILD/RECONMARKER gates; do not touch the 430-line replay in this phase.
- Same-millisecond ties are ordered by insertion index (`sort_events_stable`), so the stored rows must keep the append order, not be re-sorted by time.
- A stored window is a pure function of (api_key, window start, read version). That makes writes idempotent under duplicate runs and watchdog reclaim with no claim-token fence (see 4).

**Storage estimate** (local measurement, synthetic Bybit execution parsed by ccxt 4.5.64; the symbol string will be longer in production, about +6 B):

| Form | Per trade | 127,471 trades | 1,000,000 trades |
|------|-----------|-----------------|------------------|
| ccxt dict in memory | about 4.9 KB | about 620 MB | about 4.9 GB |
| 7-field dict in memory | about 1.0 KB (about 0.55 KB with `fee` as a number) | about 130 MB | about 1 GB |
| JSON object, 7 keys | 141 B | about 18 MB | about 141 MB |
| JSON positional array | 54 B | about 6.9 MB | about 54 MB |

TOAST compression will shrink the jsonb further `[ASSUMED: ratio unmeasured]`. The data is transient: deleted on a successful rebuild, expires after 7 days otherwise. Recommend the positional array form with a documented column order that is part of `read_version`. Replace `fee` by its `cost` number when projecting: the replay does `_fee_raw.get("cost") or 0.0` for a dict and `float(_fee_raw or 0.0)` for a number, which is the same value.

**Fidelity risk to test:** JSON round-trip through PostgREST jsonb must return floats equal to the originals (Postgres keeps the decimal digits Python's shortest `repr` produced, so parsing returns the same float). Assert it in a test; do not assume it.

#### 2. Window grid, `now`, the two-year edge, expiry (answers Q2)

- **Grid origin.** Windows tile on `origin + 7d * k`. The first claim stores `origin = since_ms` (today's `since` is UTC midnight, 729 days back). Later claims reuse the stored origin so persisted windows stay aligned even though `since` moves forward by a day per UTC day (`_account_rebuild_window` recomputes it from the new `end_date`).
- **Reuse rules on load:** discard everything if `read_version` differs, `expires_at` has passed, or the new `since_ms` is EARLIER than `origin` (a longer window than the one stored); otherwise keep, skip windows that end before `since_ms`, and filter the output to `timestamp >= since_ms` so the replay input equals a single pass started at `since_ms` (events before the curve start are never consumed by the replay loop anyway, but they would add symbols to the OHLCV fetch).
- **`now` is NOT pinned.** Only complete windows that ended at least an hour before `now` are persisted. The window containing `now` (the tail) is never persisted and is read live in the final claim. A trade made after the first claim is therefore read by the claim that finishes, exactly as in a single pass; the anchor is also fetched in that claim.
- **The two-year edge needs no pin beyond the origin.** The guard compares the caller's `since_ms` with the real `now` at each claim, and `since` moves forward with the date, so it passes. Only the first request of a fresh read can be that old.
- **Cursor shape.** No cursor is stored. A window is atomic: it is either stored complete or re-read next claim.
- **Expiry (no cron).** `expires_at` column, 7 days. Cleanup is opportunistic and in the app: at read start delete this key's rows that are expired or of another `read_version`, plus one global `DELETE ... WHERE expires_at <= now()`; after the persist half returns DONE, delete the members' rows; both are best-effort WARNING-on-failure because the expiry is the backstop. Key deletion and account deletion cascade.
- **Keep state on a non-stall refusal.** After `anchor_skipped_implausible`, `history_days_unreproduced` and similar, keep the windows (7 days) so a re-run after the cause is fixed reuses them. This is also why `read_version` must exist: Phase 173 will change what the Bybit read covers (transfer depth; non-linear categories are unread today), and stale windows must not be reused across that change.

#### 3. Continuation inside a window (layer 1, no migration)

Bybit documents `/v5/execution/list` as "sorted by `execTime` in descending order" and warns that "items with the same `execTime` may sort inconsistently" `[CITED: bybit-exchange.github.io/docs/v5/order/execution]`. The repo already implements the matching technique for OKX: walk backward, ask for fills up to one millisecond past the oldest read, absorb the overlap by id dedupe (`_fetch_okx_inst_type_trades`, `_extend_unseen`), retry a stalled page once with the end at the oldest. Apply it to a Bybit window:

- One "segment" is today's cursor loop, still capped at `_BYBIT_WINDOW_PAGE_CEILING` pages.
- When a segment ends on the ceiling with a cursor still present, do not raise. Set `until = oldest_ms + 1` (inclusive-or-exclusive tolerant, as OKX does) and start a new cursor-less segment on `[w_start, until]`. Dedupe absorbs the boundary overlap.
- If a segment does not lower the end bound (`next_end >= end`), or a full page adds nothing even after the one-time retry with `until = oldest`, raise `TruncatedTradeRead` carrying a typed `site` (below).
- A hard row ceiling per window (recommend `_BYBIT_WINDOW_SEGMENT_CEILING` segments, i.e. about 10^6 rows) makes "a venue that never runs out" terminate loudly even when each segment lowers the bound by a millisecond. Structural termination otherwise: windows are finite, every segment strictly lowers `until` or raises, and the outer `wait_for` is the final bound.
- This continuation does not rely on the cursor surviving anything, and it works for both D-01 outcomes (a window above 10,000 executions, or a cursor that repeats).
- What it cannot pass: more than one page (100) of executions at one millisecond. That stays a loud stop (`site` = no-advance).

#### 4. Claim budget, deferral and idempotency (answers Q2)

- **Two bounds, deliberately apart.** The existing hard bound is `asyncio.wait_for(..., _RECONSTRUCT_CRAWL_TIMEOUT_S)` (1500 s; handler timeout 30 min; watchdog 35 min). Add a SOFT read budget (recommend 900 s, env-overridable, validated at import to be below the hard bound, the `WORKER_HEARTBEAT_INTERVAL_S` precedent) checked only at window boundaries, with a deadline taken once at crawl start so all members share it. The 600 s of headroom covers the window in flight and the post-read steps (30-day transfer windows, concurrent OHLCV, a sequential 2 s-per-symbol CoinGecko fallback, the anchor) `[ASSUMED: post-read worst case under 600 s]`.
- **Deferral.** On budget exhaustion the read stores its progress, then raises `TradeReadDeferred` (NOT a `ccxt` class, NOT `BadRequest`). The handler converts it with `defer_compute_job(p_job_id, p_defer_seconds, p_reason, p_claim_token)`: the RPC returns the row to `pending` at `now + n`, decrements `attempts` (a defer burns no retry), nulls the token, and raises above 3600 s (`IF p_defer_seconds > 3600 THEN`). Reuse `_defer_lost_ownership` from `job_worker` so a watchdog-preempted worker yields DEFERRED instead of failing. Recommend a 120 s defer (precedent: OKX `MIN_DEFER_S` = 60 s is the "tight loop" floor); `p_reason` is a static class plus counts ("windows", "trades"), never venue text.
- **Idempotency.** A stored window depends only on (key, window start, read version), so two workers writing it write the same bytes: upsert on the primary key. The stall counter is advisory and last-writer-wins. No claim-token fence is needed or available (the store is keyed by api_key, not by job).
- **Nothing is written to the allocator's history before the read is whole.** The deferral/refusal is raised before the persist half, so `replace_equity_snapshots_window` (and the sole-key and multi-key writers) are unreached. Test that `allocator_equity_snapshots` is untouched on a deferred claim.
- **Outcome precedence in `_crawl_whole_account`.** `asyncio.gather(..., return_exceptions=True)` returns the deferral as a plain `BaseException`; the existing loop would classify it. Insert an explicit arm before the generic `BaseException` arm, and decide precedence over ALL outcomes first: a member's refusal beats a sibling's deferral (a refusal is deterministic, deferring would waste claims), then a settled `DispatchResult`, then deferral, then retryable, then permanent. Handler arm order: the new `except` must precede `except Exception`.
- **Wasted sibling work.** Other members finish their full crawl in a deferred claim and the result is discarded. Accept for this phase (bounded by a normal crawl); an optimisation is to cancel siblings on the first deferral.

#### 5. Stopping a job that makes no progress (answers Q4)

- **Definition of progress:** at least one newly stored complete window in the claim. A claim that ends on the budget with none increments `stalled_claims` on the per-key state row; any progress resets it to 0. The state row is created at claim start so the counter has a home even when the first claim completes nothing.
- **Stop rule.** `stalled_claims >= 3` (recommended), or the job older than 24 h from `compute_jobs.created_at` (the OKX F7 backstop, `BACKSTOP_AFTER_S`; unreadable `created_at` counts as too old), raises `TradeReadStalled`. Because a defer does not consume an attempt, nothing else would ever stop such a job; this rule is the only bound.
- **Named refusal.** One new token in `FORCED_REBUILD_ACCOUNT_REASONS`; recommended name `account_key_read_stalled` `[ASSUMED name]`. Forced path: `_crawl_whole_account` converts `TradeReadStalled` into `ForcedRebuildRefusedError("account_key_read_stalled")` (literal string at the raise site: the raise-site scan test regex only sees literals). Unforced path: map it to FAILED permanent with a static, counts-only message (do not route an unforced job through the "forced rebuild refused" text). State is KEPT, which is what makes it a reason "a later run can clear": the next fan-out job (attempts +1 per enqueue under RECONMARKER D-17) or a forced re-run resumes from the stored windows.
- **What moves with a new token** (all `[VERIFIED: read this session]`): `FORCED_REBUILD_ACCOUNT_REASONS` and the comment above it ("these 15 tokens"); `tests/test_reconstruct_force_rebuild.py::test_forced_rebuild_refusal_reasons_are_a_closed_set` (the `account` frozenset, `len(anchor) + len(account) == 15`, and the raise-site equality scan); `tests/test_bybit_two_year_window.py::test_the_two_year_refusal_adds_no_token` (`assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 15`); the probe vocabulary (`_SELECTION_TOKENS`, `_REFUSAL_TOKENS` derive from the set, and `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` loops it); the post-deploy handoff text that matches the `forced rebuild refused (` prefix and the tokens (find it in the ACCTREBUILD 09 SUMMARY handoff B'0-B'6 and in the TRADEPAGES runbook text; they are `.planning` artefacts, update them in the planning commit, not in the ship branch).
- **No new audit action.** `services/audit.py` and the TS union must stay in parity (`test_action_literal_matches_ts_union`); deferral is visible through `compute_jobs.last_error` and one counts-only log line. Do not add `reconstruct_deferred`.

#### 6. RECONMARKER interaction (answers Q4)

`[VERIFIED: migration 20261021120000 header/body read this session]` The fan-out counts one attempt per ENQUEUE (`history_reconstruct_attempts + 1` in the same inner block as the enqueue) and treats a key as in flight when a reconstruct job is `pending`, `running`, `done_pending_children` or `failed_retry`. A deferred job stays `pending`, so (a) the fan-out never enqueues a second job for the key, (b) a deferral burns no attempt, (c) the cap of 5 (`HISTORY_RECONSTRUCT_ATTEMPT_CAP`) counts re-enqueues after a terminal result, so a stall that ends FAILED permanent is retried by the next day's fan-out until the cap, each retry resuming from the stored windows. `dispatch()` runs the D-09 capped event only for DONE or terminal FAILED, never for DEFERRED. One side effect to accept and document: a `pending` reconstruct holds a zero-snapshot book's first daily refresh (`_RECONSTRUCT_IN_FLIGHT_STATUSES`, `_owed_reconstructs_for_zero_snapshot_book`), so a deferred read holds that row for the life of the job, bounded by the 24 h backstop.

#### 7. Migration shape (answers Q3)

Two service-role-only tables. House precedent: `20261029120000_api_key_nav_marks.sql` (read in full this session) for header discipline, `REVOKE ALL` first then explicit grants, FORCE RLS, catalogue-only verify block, rollback in `supabase/migrations/down/`.

```sql
-- Source: structure copied from the api_key_nav_marks migration; names and columns are proposed.
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.allocator_trade_reads (
  api_key_id       UUID        PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE,
  venue            TEXT        NOT NULL,
  grid_origin_ms   BIGINT      NOT NULL,
  read_version     SMALLINT    NOT NULL,
  claims           INTEGER     NOT NULL DEFAULT 0,
  stalled_claims   INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  CONSTRAINT allocator_trade_reads_counts_chk CHECK (claims >= 0 AND stalled_claims >= 0),
  CONSTRAINT allocator_trade_reads_venue_chk  CHECK (venue IN ('bybit'))   -- widen when OKX adopts it
);

CREATE TABLE public.allocator_trade_read_windows (
  api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start_ms  BIGINT      NOT NULL,
  window_end_ms    BIGINT      NOT NULL,
  read_version     SMALLINT    NOT NULL,
  n_trades         INTEGER     NOT NULL,
  trades           JSONB       NOT NULL,          -- array of [ts, symbol, side, amount, price, cost, fee_cost]
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (api_key_id, window_start_ms),
  CONSTRAINT allocator_trade_read_windows_span_chk   CHECK (window_end_ms > window_start_ms),
  CONSTRAINT allocator_trade_read_windows_count_chk  CHECK (n_trades >= 0),
  CONSTRAINT allocator_trade_read_windows_array_chk  CHECK (jsonb_typeof(trades) = 'array')
);

ALTER TABLE public.allocator_trade_reads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_reads        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_read_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_read_windows FORCE  ROW LEVEL SECURITY;
-- No policy for anon or authenticated, on purpose: nothing in the browser reads these rows.
REVOKE ALL ON TABLE public.allocator_trade_reads, public.allocator_trade_read_windows
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocator_trade_reads, public.allocator_trade_read_windows
  TO service_role;   -- UPDATE/DELETE are needed (unlike the write-once marks): counters, purge
```

Design choices to carry into the plan:
- **No `allocator_id` column, no coherence trigger, no function.** Ownership follows `api_key_id`; user deletion cascades `profiles -> api_keys -> these tables` (`api_keys_user_id_fkey ... ON DELETE CASCADE` `[VERIFIED: supabase/schema/baseline.sql]`). That avoids a SECURITY DEFINER function, hence no `supabase/schema/functions/*.sql` snapshot, no `dump-sql-functions` entry and no VAC-04 body acknowledgement.
- **"Owner/service-role RLS" in CONTEXT.** Recommend service-role only (no owner SELECT policy). An owner policy would expose per-fill rows to the browser through PostgREST for no consumer. If the founder wants the literal owner read, add the three-line NAV-marks policy plus `allocator_id`; flag this as Open Question 2.
- **Verify block:** catalogue only (`to_regclass` for both tables, the two primary keys by name, `pg_class.relrowsecurity` is NOT asserted, as the NAV-marks block explains: asserting what the gate mutates would abort the mutated apply). No row is read. No data statement. No `cron.schedule`.
- **No data-reading `DO` block** (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`): TEST has the catalogue and none of the data.
- **Deploy order is safe in both directions:** an old worker never touches the tables; the migration auto-applies to PROD before the new worker deploys. Say so in the header, as NAV marks does.

#### 8. Census files a new `supabase/tests` file and a new table move (answers Q3)

Found by grepping the NAV-marks table/gate name across the repo this session; re-measure each at the time of the PR (the numbers below are the values read now and WILL move):

| File | What moves |
|------|------------|
| `supabase/tests/test_allocator_trade_reads.sql` | NEW gate; ends with `ALL N ARMS EXECUTED (1,...,N)`; every arm carries `RED-UNDER` and `RED-UNDER-M`; `RED-UNDER-SETUP` list; `WAIVED_CEILING` stays 0 |
| `scripts/mutation-floors.mjs` | `FILES_FLOOR` (80 when read), `ARMS_FLOOR` (803 when read), `WAIVED_CEILING` (0 when read): raise to the measured run, read by symbol |
| `.github/workflows/ci.yml` | `sql-tests` sentinel roster table (rows are a contiguous, equally indented block read by `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`); `SENTINEL_FLOOR` and its arms floor; the new file's row |
| `src/__tests__/mutation-runner-floors.test.ts` | several pins (file count, arm count, per-file line `sections N / judged N / annotated N / waived 0 / biting N`) |
| `src/__tests__/mutation-annotation-parser.test.ts` | `armsSeen`, `stepsSeen`, file count (`coverage: files X/Y`) |
| `src/__tests__/lint-sql-gates.test.ts` | `lint-sql-gates: scanned N file(s)` |
| `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/drift-check-scripts.test.ts` | floor mirrors and the sql-tests roster comment |
| `scripts/check-gdpr-export-coverage.ts` | add both tables to the CASCADE-erasure allowlist (mirror the `api_key_nav_marks` and `allocator_equity_derived` entries); `src/lib/gdpr-export-manifest.ts` needs no row for an allowlisted table |
| `src/lib/database.types.ts` | hand-maintained in this repo (the NAV-marks edit is hand-written); add the two tables |
| `supabase/schema/baseline.sql`, `BASELINE.md`, `baseline-carried-migrations.txt` | re-dump AFTER the PROD apply, in the follow-up `chore(release)` commit that also regenerates the marker (see commit 53f25ac3e for the shape); `scripts/baseline-content-drift-check.mjs` only changes if a function is added (none here) |
| `CHANGELOG.md`, `VERSION`, `package.json` | the ship commit (byte-equal 4-digit strings) |

The SQL gate's arms (proposed, 6 to 8): anon and authenticated have no privilege (pinned privilege error text, not the RLS error, as NAV marks arm 5 does); service_role can insert, update, delete (this table is not write-once); cascade from `api_keys` deletion (use the app path `delete_allocator_api_key`, as NAV marks arm 6) and from the auth user; CHECK constraints each naming their own constraint; catalogue (RLS enabled and forced, zero policies, privilege matrix). pgTAP is not installed; plain `DO` blocks with `RAISE EXCEPTION`, every `TEST FAILED (N)` raise directly in the DO body.

#### 9. Whether OKX walks share the mechanism now (answers Q7)

**Recommend: no.** Reasons: (1) OKX's backward walk rests on an ordering premise that is unmeasured (`okx-order: unmeasured`, Phase 173 gate); building resumable persistence over an unproven premise stores data whose completeness cannot be asserted. (2) Its window is 89 days and the ceiling is 500 pages x 100 fills per instrument type (50,000), and a4 read 1,282 trades; no observed account is near it. (3) The generic walk serves venues that never produced a trade (`[CITED: 167.2.1.1.2.1-RESEARCH.md Q-Binance: fetch_my_trades requires a symbol]`). Make the store venue-agnostic (a `venue` column with a CHECK to widen, `window_*_ms`, no Bybit-only names) so Phase 173 can adopt it without a redesign, but keep `_TRADE_PASS_PAGE_CEILING` and the OKX raise sites unchanged and say so in the SUMMARY.

#### 10. D-01 / SC-3 probe changes (answers Q5)

Closed additions to `ACCOUNT_RECORD_KEYS` (every key needs a validator in `_ACCOUNT_VALIDATORS`, a default in `_account_record`, and `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` already pins that the two key sets are equal):
- `truncated_site`: one of a closed token set, `none` unless `failure_class == "truncated"`. Recommended source: a typed `site` attribute on `TruncatedTradeRead` set at each raise site (exact; the nine raise sites are known). Alternative with no production change: derive from the recorded call log (calls sharing the last call's `until` equal the page ceiling -> window ceiling; otherwise no-advance), which cannot see a `NotSupported` mid-walk because a raised call is never recorded.
- `last_window_age_bucket`: a closed bucket token (for example `none`, `0-29`, `30-89`, `90-179`, `180-364`, `365-546`, `547-729`), derived from the recorder's last call `since` against the run date, so no timestamp finer than the run date leaves the process.
- `read_elapsed_s`: integer seconds (`_is_count`), summed over members, measured with a monotonic clock around `_read_member`.
- `trade_calls` (existing) already carries the call count; add the last window's call count only if the site token is derived from the log.

The probe keeps logging off and routes everything through `emit_record`/`assert_sanitized`. It never sets the resume scope, so it never touches the new tables, and its static pins (`test_the_probe_source_calls_no_writer`, `test_the_probe_names_only_the_two_tables_it_reads`) stay green. After the fix ships, the same probe measures the in-run continuation (layer 1) against a6, which is what SC-3 needs; the cross-run path (layer 2) is not exercised by the read-only probe by construction.

**Sequencing constraint (Open Question 1).** The probe runs from the DEPLOYED commit (plan 06 ran it on the backfill worker, whose start command was changed temporarily, with founder approval). The D-01 reading of the BASE read therefore needs the instrumented probe deployed while the base read is still deployed: ship the probe change alone first (Python only, no migration), take the reading, then plan the dependent code. If the founder prefers one PR, the layer-1 design above is robust to both outcomes, and the reading then informs only tuning and the SC-3 record.

### Anti-Patterns to Avoid

- **Persisting a partial window** (or any window whose walk raised or ended on the soft deadline). A window is stored only after it ended by its normal terminators.
- **Re-sorting stored trades** by time (breaks same-millisecond tie order).
- **Reusing stored windows across a change to what the read covers**: gate on `read_version`.
- **Adding a keyword to `_fetch_and_price_window`**: see Pitfall 3.
- **Raising `TradeReadDeferred` as a `ccxt.BadRequest`** (it would classify permanent and refuse).
- **Using `logger.exception` / venue text** in any new log or `last_error` (H-3: signed URLs). Counts and static tokens only.
- **A deferral that skips `_defer_lost_ownership`**: a preempted worker would fail the job with a stale token.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backward time continuation with overlap dedupe | A new paging algorithm | The OKX technique already in `_fetch_okx_inst_type_trades` and `_extend_unseen` (end = oldest + 1, one retry with end = oldest, id dedupe) | Its edge cases (inclusive vs exclusive end, same-millisecond groups) are already tested in `tests/test_trade_pages.py` |
| Deferral | A new queue or timer | `defer_compute_job` + `_defer_lost_ownership` | Claim-token fenced, burns no attempt, capped at 3600 s |
| Venue-faithful fakes | New fake exchanges | `tests/_trade_pages.py::VenueTradeBook` and `real_ccxt_client` | They model Bybit's 7-day rule, 100-row pages, descending order, `nextPageCursor` placement and the two-year rejection |
| Probe output hygiene | A new printer | `emit_record` / `validate_record` / `assert_sanitized` | The only path to stdout; refuses unknown keys and unrounded floats |
| Table privileges | Policies for service_role | `REVOKE ALL` then explicit `GRANT` (service_role has BYPASSRLS; a policy cannot gate it) | ADR-0001/0003 and the NAV-marks migration header |
| Expiry | `pg_cron` job | `expires_at` + opportunistic app delete | A `cron.schedule` is out of scope for this phase and adds a TEST/PROD apply hazard |

**Key insight:** every part of this phase has an in-repo precedent (OKX backward walk, OKX archive deferral and backstop, NAV-marks table shape). The work is reconciling them under the existing pins, not inventing.

## Common Pitfalls

### Pitfall 1: Stale persisted windows reused after the read changes
**What goes wrong:** Phase 173 widens the Bybit read; a forced re-run reuses 7-day-old windows read with the old rules and the rebuild is silently incomplete.
**Why:** a stored window looks complete.
**How to avoid:** `read_version` on both tables, checked on load, and bumped by any change to what the read covers or to the projection order; 7-day `expires_at`; delete on DONE.
**Warning signs:** a test that loads a window with another version and still uses it.

### Pitfall 2: A job that never makes progress loops forever
**What goes wrong:** `defer_compute_job` decrements `attempts`, so `max_attempts` never ends a deferring job (the OKX archive job needed its own F7 backstop for the same reason).
**How to avoid:** the stalled-claims counter plus the job-age backstop (section 5). Test both.

### Pitfall 3: The crawl call shape is pinned
**What goes wrong:** `tests/test_reconstruct_force_rebuild.py::test_unforced_reconstruct_calls_the_crawl_and_the_anchor_with_their_existing_arguments` asserts the unforced crawl is called with exactly five positional arguments and no keywords, and the forced crawl with exactly `{"require_anchor": True}`; many fakes (`test_reconstruct_whole_account.py`, `test_equity_reconstruction.py`, `test_job_worker_flipretry.py`, `test_ana_recon_audit.py`) replace `_fetch_and_price_window` with fixed signatures.
**How to avoid:** carry the resume scope in a `ContextVar` set inside `_crawl_account_key` and in the unforced branch, as the repo already does for the anchor set (`_AnchorPartialSet` "rides the existing return so the function's signature ... is unchanged (PD-J)"). Without a scope the read is layer 1 only: no budget, no store. The probe sets no scope.

### Pitfall 4: Gather outcome ordering
**What goes wrong:** the deferral is classified as an unknown fault by the generic `BaseException` arm and becomes `_AccountCrawlRetryableError`, or a sibling's permanent refusal is masked by a deferral and the job defers forever.
**How to avoid:** explicit arm before the generic one; precedence decided over all outcomes (section 4); handler `except` order test.

### Pitfall 5: Memory
**What goes wrong:** 127k ccxt dicts is about 600 MB and the replay copies each event dict; a book ten times larger OOMs the worker, and the watchdog reclaim burns an attempt per OOM.
**How to avoid:** project to the compact form when a window completes, in memory and in storage; do not keep `info`. Record peak resident size in the SUMMARY of the plan that adds it `[ASSUMED: Railway worker memory limit unknown]`.

### Pitfall 6: Existing tests whose pins must move deliberately
- `test_a_bybit_window_that_never_runs_out_hits_the_page_ceiling_loudly` asserts `calls == er._BYBIT_WINDOW_PAGE_CEILING` and a "ceiling" WARNING; under continuation the endless fake (constant timestamps, new ids, new cursors) stops on the no-advance rule after a second segment. Re-pin to the new loud-stop contract, do not weaken it.
- `test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning[bybit]` expects exactly one WARNING; the one-time retry must not add a second.
- `test_bybit_two_year_window.py` and the 15-token pins (section 5).
- `tests/test_allocator_history_probe.py` end-to-end and emitter tests (new keys).
Each such move needs a "RED before, GREEN after" note in the plan.

### Pitfall 7: Request size and the fake client
**What goes wrong:** a window with 100k trades is a multi-MB jsonb upsert; the PostgREST/gateway body limit is not documented here `[ASSUMED]`. Separately, `FakeSupabaseClient` (tests/test_equity_reconstruction.py) supports `upsert`, `select` with `eq/in_/gte/lte`, `delete` with `eq/neq/is`, but has NO `lt`.
**How to avoid:** measure one multi-MB upsert in the plan that writes the store (against a local lane, never TEST), and chunk only if needed; write the expiry purge with `lte` or extend the fake with `lt` in the same plan.

### Pitfall 8: Float and tie-order fidelity of the stored form
Covered in section 1: assert JSON round-trip float equality and append-order preservation with the equivalence oracle.

### Pitfall 9: The soft budget must not run mid-window
A check inside a window would discard up to a window of work each claim and can starve progress. Check only at window boundaries; a single pathological window is bounded by the hard 1500 s bound and the segment ceiling, and a window too large for any claim ends in the named stall.

## Code Examples

### A. Continuation inside a Bybit window (sketch; reuses the OKX walk's rule)
```python
# Sketch only. Names of existing helpers (_extend_unseen, _next_page_cursor, _rate_limit_sleep,
# _TRADE_PAGE_LIMIT, _BYBIT_WINDOW_PAGE_CEILING) are quoted from services/equity_reconstruction.py.
async def _read_bybit_window(exchange, w_start, w_end, trades, seen):
    end = w_end
    for _segment in range(_BYBIT_WINDOW_SEGMENT_CEILING):          # new constant
        cursor = None
        oldest = None
        for _ in range(_BYBIT_WINDOW_PAGE_CEILING):                # a segment = today's loop
            params = {"until": end}
            if cursor:
                params["cursor"] = cursor
            page = await exchange.fetch_my_trades(None, w_start, _TRADE_PAGE_LIMIT, params) or []
            if not page:
                return
            added = _extend_unseen(trades, seen, page)
            oldest = min(int(t.get("timestamp") or 0) for t in page) if oldest is None else min(
                oldest, min(int(t.get("timestamp") or 0) for t in page))
            nxt = _next_page_cursor(page)
            if not nxt:
                return                                             # window ended (warn rule unchanged)
            if added == 0 or nxt == cursor:
                break                                              # stalled page: fall to continuation
            cursor = nxt
            await _rate_limit_sleep(exchange)
        next_end = (oldest or 0) + 1
        if oldest is None or oldest <= w_start:
            return
        if next_end >= end:
            raise TruncatedTradeRead(_TRUNCATED_READ_MESSAGE)      # carries site="no_advance"
        end = next_end                                             # strictly lowers; overlap absorbed by ids
    raise TruncatedTradeRead(_TRUNCATED_READ_MESSAGE)              # site="window_rows": never-ending venue
```

### B. The resume scope without a new keyword (sketch)
```python
# services/trade_read_store.py (new). No import of job_worker or equity_reconstruction.
_SCOPE: ContextVar[TradeReadScope | None] = ContextVar("trade_read_scope", default=None)

@contextmanager
def trade_read_scope(scope: TradeReadScope):
    token = _SCOPE.set(scope)
    try:
        yield
    finally:
        _SCOPE.reset(token)
# _crawl_account_key: `with trade_read_scope(TradeReadScope(supabase, key_id, deadline)):` around the
# unchanged five-positional call; _fetch_bybit_trades reads _SCOPE.get() and behaves as layer 1 when None.
```

### C. Conversion in the handler (order matters)
```python
# In run_reconstruct_allocator_history_job's inner try, BEFORE `except Exception`:
except TradeReadDeferred as exc:
    return await _defer_reconstruct(ctx.supabase, job, exc)   # defer_compute_job + _defer_lost_ownership
# In _crawl_whole_account's outcome loop: decide precedence over ALL outcomes before raising anything.
```

### D. The equivalence oracle (the test that makes the persisted form safe)
```python
# Independent invariant, not a re-implementation: the same finite book read (1) in one pass and
# (2) across N claims with a tiny deadline must give identical _compute_daily_equity rows.
rows_single = er._compute_daily_equity(single_pass_trades, ...)
rows_resumed = er._compute_daily_equity(resumed_trades, ...)
assert rows_resumed == rows_single       # dict equality, including value_usd to the cent
```

### E. Reproducing RED at base (run this session, kept outside the repo)
```python
book = VenueTradeBook(ex, trade_rows(10_500, SINCE + DAY_MS, 50, id_prefix="w"))   # finite, one window
# -> TruncatedTradeRead after 100 calls on the unmodified tree
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One trade page, short-page stop | Venue-specific stop rule; 7-day Bybit windows; OKX backward walk | Phase 167.2.1.1.2.1 (2026-10-23/26) | Reads every page, but raises at fixed ceilings |
| Truncated read returned as the whole history | Truncated read raises `TruncatedTradeRead` | same phase, WR-01 | Safe, but deterministic refusal for any account above a ceiling (TODOS READ-CEILING-STRANDS-ACCOUNT) |
| Stateless retry | Window-granular resumable read with a named stall | this phase | A book of any size completes across claims or stops by name |

**Deprecated/outdated:** the "split the window that hits the ceiling" remedy in the TODOS entry and REVIEW-2 WR-04 is superseded by continuation by time, which needs no cursor lifetime.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bybit's `nextPageCursor` has no usable lifetime across hours (undocumented); the design does not rely on it | Alternatives, section 2 | None for the design; if a cursor survives, a mid-window resume becomes possible later |
| A2 | Per-call latency and throughput: about 100 ms ccxt throttle plus network, giving 10^5 to 10^6 trades per 900 s claim | Summary, section 4 | Budget numbers (900 s, 3 stalled claims, 120 s defer) need retuning; the elapsed reading from the probe settles it |
| A3 | Bybit `endTime` inclusivity is unknown; `until = oldest + 1` is tolerant of both | section 3 | Rare same-millisecond under-read, the same risk class as OKX A2 |
| A4 | PostgREST / gateway accept a multi-MB jsonb upsert | Pitfall 7 | Must chunk windows; measure in the store plan |
| A5 | Railway worker memory is enough for the compact form at the largest realistic book | Pitfall 5 | OOM and burned attempts; cap or fold-state later |
| A6 | Supabase storage headroom for tens of MB transient per account | section 1 | Add a stored-trade cap and a second named stop |
| A7 | The real a6 stop site (window ceiling vs stall) | Summary | Decides whether layer 2 is exercised by a6; D-01 answers it |
| A8 | A Bybit execution's `info` carries no `instType`, so dropping `info` does not change the replay | section 1 | Replay differs for Bybit; the oracle test catches it |
| A9 | The interactive worker loop tolerates a 15-minute claim (it already tolerates a 30-minute handler timeout) | section 4 | Move reconstruct to a backfill role (founder/ops call) |
| A10 | Post-read steps (transfers, OHLCV, CoinGecko fallback, anchor) fit in 600 s | section 4 | Lower the soft budget |
| A11 | The new token name `account_key_read_stalled` | section 5 | Naming only; pin tests follow the chosen name |
| A12 | 7 days is the right store expiry and 3 stalled claims / 24 h the right stop | sections 2, 5 | Tuning only |
| A13 | ccxt 4.5.88 prices `v5/execution/list` like the locally read 4.5.64 | Standard Stack | Budget tuning only |

## Open Questions (RESOLVED)

Each question carries a one-line resolution (2026-10-27, planning; revised after the plan check) naming the decision or plan that closes it.

1. **Does D-01 need its own ship before the dependent plans?**
   - Known: the probe runs from the deployed commit; D-01 says code that depends on which limit fired waits for the reading; the layer-1 design is robust to both outcomes.
   - Unclear: whether the founder wants a probe-only PR first.
   - Recommendation: plan 01 is probe-only (Python, no migration) and shipped alone; the orchestrator runs it on the backfill worker (operator step, not an executor task) and records the reading before plans 02+ are executed. If the founder declines a split ship, proceed with layer 1 and read the outcome at SC-3.
   - **RESOLVED:** superseded by orchestrator decision 2: no probe-only PR. Plan 01 makes the probe derive the stop site from its own call log (and refuse an older rebuild module by `DEPLOYED_ER_NAMES`), plan 05 runs that file on the backfill worker against the code deployed today before the phase ships, and plan 12 Task 1 step 0 is the ship gate that requires plan 05's `d01-ship: go`. No code branches on the site (plan 02's continuation covers both), so plans 02-11 do not wait on the reading; the ship does.

2. **Owner read policy on the new tables?**
   - Known: CONTEXT says "owner/service-role RLS"; no UI reads the rows.
   - Recommendation: service-role only. If an owner SELECT is wanted, add `allocator_id` (cascade) and the NAV-marks coherence trigger (which adds a SECURITY DEFINER function and its snapshot/VAC-04 work).
   - **RESOLVED:** CONTEXT D-02, narrowed at planning (orchestrator 2026-10-27): service-role only, RLS forced, no owner policy, no `allocator_id`, no trigger or SECURITY DEFINER function. Implemented in plan 03 (TR-2, gate arms 1 and 8).

3. **A cap on stored trades (the "any size" tension).**
   - Known: no cap means unbounded storage for a venue that keeps producing; the stall and age stops bound it in time, not in size.
   - Recommendation: no cap and no extra token in this phase; the segment ceiling bounds one window and the 24 h backstop bounds the job. Record a number in the plan if storage proves a problem.
   - **RESOLVED:** no size cap and no extra token. One request is bounded by the 5,000-trade chunk and its CHECK (plan 03 TR-1, plan 04), one window by the segment ceiling (plan 02), one job in time by the stalled-claims stop and the 24 h backstop (plans 04, 08), and storage in time by the 7-day expiry with its purges: at claim start, on DONE (plan 07) and the hourly watchdog sweep that also reaches an idle key (plan 08).

4. **Is cross-run persistence exercised by a6 at all?** (see Summary finding 1). Surface it in the plan so the SC-3 record is not misread as having proven layer 2.
   - **RESOLVED:** layer 2 is proven by synthetic books and the live lane (plans 07, 08, 09, 10, 11); plan 12 Task 2 writes the fixed `sc3-layer2-proof:` line and a `sc3-layer2-needed:` line from a6's elapsed seconds, so the post-deploy probe (which reads without a store scope) is never read as proof of layer 2.

5. **Where do the post-deploy handoff docs live and who updates them?** They are `.planning` artefacts; the ship branch must change nothing under `.planning` (user memory), so update them in the planning commit.
   - **RESOLVED:** plan 10 Task 2 appends a dated amendment (adds lines only) to the ACCTREBUILD 09 SUMMARY handoff on the phase branch; it reaches main through the orchestrator's records PR, never through the ship branch.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | pytest, mypy, the scratch reproduction | yes | 3.14.3 (mypy config targets 3.12) | -- |
| pytest | analytics tests | yes | 9.0.2 | -- |
| mypy | CI type gate | yes | 2.0.0 | -- |
| ccxt | fakes using real parsing | yes | 4.5.64 installed, 4.5.88 pinned in requirements | tests passed locally (43 passed: `test_trade_pages.py`, `test_bybit_two_year_window.py`) |
| node | vitest census tests, `scripts/*.mjs` | yes | 25.8.1 | -- |
| docker | local-stack / pg-lane SQL gates | client present; daemon not probed | 29.5.3 client | run the SQL gate in CI if no daemon |
| psql | pg-lane | yes | on PATH | -- |
| supabase CLI | linked to PRODUCTION | present | -- | DO NOT USE for this phase (no `--linked`, no `db push`) |
| Railway backfill worker | the D-01 and SC-3 probe runs | operator step | -- | the orchestrator runs it; `railway ssh` is known broken (plan 06 used a temporary start-command change with founder approval) |

**Missing dependencies with no fallback:** none for planning. The probe re-runs depend on operator access to the worker and to Bybit from that worker's egress IP.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9 + pytest-asyncio (`asyncio_mode = auto`); vitest for the TS census; plain PL/pgSQL `DO` gates for SQL |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy), `scripts/mutation-floors.mjs` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_trade_pages.py tests/test_trade_read_resume.py tests/test_trade_read_store.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py tests/test_reconstruct_whole_account.py tests/test_bybit_two_year_window.py -q -p no:cacheprovider` |
| Full suite command | `cd analytics-service && python3 -m pytest -q` (the CI `python` job's pytest step carries extra pinned arguments: read it with `grep -n 'cov-fail-under' .github/workflows/ci.yml`); type gate: `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; TS census: `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`; SQL: `node scripts/lint-sql-gates.mjs --self-test` and `node scripts/mutation-runner/run.mjs` (throwaway local cluster, never TEST) |

### Phase Requirements -> Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-2 | A FINITE book of 10,500 trades in one 7-day window is read whole (RED at base: raises after 100 calls, reproduced) | unit | `pytest tests/test_trade_read_resume.py -k over_ceiling_window -x` | Wave 0 |
| SC-1 | A finite a6-shaped book read across N claims with a tiny deadline equals the single-pass `_compute_daily_equity` rows exactly | unit (oracle) | `pytest tests/test_trade_read_resume.py -k equals_single_pass -x` | Wave 0 |
| SC-1 | Claim 1 stores complete windows and raises `TradeReadDeferred`; claim 2 completes; the allocator's snapshot table is untouched until the end | unit | `pytest tests/test_trade_read_resume.py -k defers_then_completes -x` | Wave 0 |
| SC-1 | Handler returns DEFERRED, calls `defer_compute_job` with the claim token and a static counts-only reason, burns no attempt, writes no audit failure | unit | `pytest tests/test_reconstruct_whole_account.py -k deferred -x` | Wave 0 |
| SC-1 | A window too big for any claim stalls: three stalled claims refuse `account_key_read_stalled`, state kept; job older than 24 h refuses the same | unit | `pytest tests/test_trade_read_resume.py -k stalled -x` | Wave 0 |
| SC-1 | A venue that never runs out terminates loudly (constant-timestamp endless fake; strictly-decreasing-timestamp endless fake hits the segment ceiling) | unit | `pytest tests/test_trade_pages.py -k never_runs_out -x` | pin moves |
| SC-1 | A sibling's refusal beats a Bybit member's deferral; a deferral is not classified as an unknown fault | unit | `pytest tests/test_reconstruct_whole_account.py -k precedence -x` | Wave 0 |
| SC-1 | Stale state (other `read_version`, expired, `since` earlier than origin) is discarded; duplicate writers of one window leave one identical row | unit | `pytest tests/test_trade_read_store.py -x` | Wave 0 |
| SC-1 | Projection round trip: float equality through JSON, append order preserved, fee dict vs number replay-equal | unit | `pytest tests/test_trade_read_store.py -k projection -x` | Wave 0 |
| SC-1 | The token set: 16 tokens, raise-site scan, probe vocabulary | unit | `pytest tests/test_reconstruct_force_rebuild.py -k closed_set -x` | pin moves |
| D-01 | The probe records `truncated_site`, `last_window_age_bucket`, `read_elapsed_s`; unknown values refused by the emitter | unit | `pytest tests/test_allocator_history_probe.py -x` | pin moves + Wave 0 |
| SC-3 | Probe stays read-only: no writer, names only the two tables it reads, sets no scope | static | `pytest tests/test_allocator_history_probe.py -k source -x` | exists |
| Migration | Tables, cascade from key and user, privilege matrix, CHECKs, RLS forced with zero policies | SQL gate | `node scripts/mutation-runner/run.mjs` (full) / the CI `sql-tests` job | Wave 0 |
| SC-3 | After deploy the probe re-reads a6; outcome recorded as counts and tokens | operator | the orchestrator runs it on the backfill worker | n/a |

Every gate for data integrity must be seen to fail: for each new test, neuter the production line it guards, observe RED, restore from a byte backup (never `git checkout`/`stash` on uncommitted work).

### Sampling Rate
- **Per task commit:** the quick run command above (about a minute, 43 tests ran in 11 s for the two pre-existing files).
- **Per wave merge:** full analytics suite plus mypy; for the SQL wave, the mutation runner and the TS census tests.
- **Phase gate:** full suite green and CI bound to the head SHA with the expected check count before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_trade_read_resume.py` - resumable read, oracle, stall, never-ending venue (SC-1, SC-2)
- [ ] `analytics-service/tests/test_trade_read_store.py` - store mapping on the fake client (extend `FakeSupabaseClient` with `lt`, or purge with `lte`)
- [ ] `analytics-service/tests/test_allocator_history_probe.py` - new record keys and site derivation
- [ ] `supabase/tests/test_allocator_trade_reads.sql` - the SQL gate with `RED-UNDER` twins
- [ ] Census pins listed in section 8 (their values are measured at PR time)
- [ ] Framework install: none

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | yes | RLS forced with no policy for anon/authenticated, `REVOKE ALL` then grants to service_role only; the SQL gate proves the privilege matrix (policy cannot gate service_role) |
| V5 Input Validation | yes | Venue rows are untrusted: read `timestamp`/`id` defensively as the existing walks do; the stored form is a fixed positional array with CHECKs (`jsonb_typeof = 'array'`, counts >= 0); reject a stored window whose rows do not parse instead of using it |
| V6 Cryptography | no | no new secret; decrypt path unchanged |
| V7 Error handling / logging | yes | counts and static tokens only in logs, `last_error` and refusal text; never `logger.exception` (H-3, signed URLs) |
| V8 Data protection | yes | per-fill trade rows at rest are the owner's data: service-role only, 7-day expiry, delete on success, cascade on key/user deletion, GDPR coverage allowlist entry |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read of stored trades through PostgREST | Information disclosure | no authenticated/anon grant, forced RLS, gate arm on the privilege matrix |
| Stale or poisoned stored window reused for another purpose | Tampering | `read_version`, expiry, validate-on-load, delete on success |
| Runaway loop on a misbehaving venue / a job that defers forever | Denial of service | strictly-lowering end bound, segment ceiling, stalled-claims counter, 24 h backstop, hard `wait_for` |
| Watchdog-preempted worker acting on a reclaimed job | Tampering | `defer_compute_job` claim-token fence plus `_defer_lost_ownership` |
| Credential or signed-URL leakage through a new log/refusal text | Information disclosure | static text only; tests assert a planted signature never appears in log records (the existing pattern in `test_trade_pages.py`) |
| Unbounded storage growth | Denial of service | expiry, delete on success, cascade; cap is Open Question 3 |

## Sources

### Primary (HIGH confidence)
- Repository, read this session at this branch: `analytics-service/services/equity_reconstruction.py` (Bybit/OKX/generic walks, `_fetch_and_price_window`, `_compute_daily_equity`, `_crawl_whole_account`, `run_reconstruct_allocator_history_job`, the refusal sets), `services/okx_archive_job.py` (deferral, backstop, claim budget), `services/job_worker.py` (`dispatch`, `TIMEOUT_PER_KIND`, `_check_circuit_breaker`, `_defer_lost_ownership`), `main_worker.py` (watchdog override, `BACKFILL_KINDS`), `scripts/allocator_history_probe.py`, `tests/_trade_pages.py`, `tests/test_trade_pages.py`, `tests/test_reconstruct_force_rebuild.py`, `tests/test_bybit_two_year_window.py`, `tests/test_allocator_history_probe.py`, `supabase/migrations/20261029120000_api_key_nav_marks.sql`, `20261001120000_compute_job_fence_errcode_55006.sql`, `20260712130000_set_compute_job_progress.sql`, `20261021120000_refresh_fanout_owed_key_reconstruct.sql`, `supabase/schema/baseline.sql` (claim RPC, `allocator_equity_derived`, `api_keys_user_id_fkey`), `scripts/mutation-floors.mjs`, `.github/workflows/ci.yml` roster comments, the TRADEPAGES CONTEXT/06-SUMMARY/RESEARCH/REVIEW-2, TODOS entry `167.2.1.1.2.1-READ-CEILING-STRANDS-ACCOUNT`.
- Local executions this session: RED-at-base reproduction and the 124,800-row finite book (repo fakes); memory/JSON size measurement of a ccxt-parsed Bybit execution (ccxt 4.5.64); `pytest` of the two pre-existing Bybit test files (43 passed).

### Secondary (MEDIUM confidence)
- [Bybit V5 Get Trade History (2 years)](https://bybit-exchange.github.io/docs/v5/order/execution) `[CITED]`: `limit` [1, 100] default 50; startTime/endTime rules (both passed: at most 7 days); `cursor`/`nextPageCursor`; "sorted by `execTime` in descending order"; same-`execTime` items may sort inconsistently; no stated cursor expiry or total depth; the two-year limit appears only in the page title.
- [Bybit V5 rate limit](https://bybit-exchange.github.io/docs/v5/rate-limit) `[CITED]`: IP limit 600 requests per 5 seconds; `GET /v5/execution/list` 50 requests/s per UID, not upgradable; HTTP 403 "access too frequent" requires waiting at least 10 minutes; retCode 10006 with `X-Bapi-Limit-*` headers.

### Tertiary (LOW confidence)
- Throughput, memory and gateway-limit figures marked `[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; versions read from the tree.
- Architecture: MEDIUM - built on precedents that exist and were read, but the combination is new and unbuilt; the OKX technique transfers to Bybit by documented parameters only.
- Pitfalls: HIGH for the pinned tests and call shapes (read), MEDIUM for runtime behaviour (memory, request size).
- Venue facts: LOW beyond the documented parameters (cursor lifetime, endTime inclusivity, a6's real stop site).

**Research date:** 2026-10-27
**Valid until:** 2026-11-03 for repo-derived facts (the tree moves daily: re-measure floors, roster tables and line-bound claims at PR time); 30 days for the Bybit documentation facts.
