# Phase 202: RESIDCHURN — the value churn left by 188 is attributed and book b3's earlier reasons are explained - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Measure, on PROD and read-only, whether stored daily returns and book curves move across a nightly with no deploy in between; attribute each of the 1214 values that moved in 188's re-reading (188-16 `gc-r-diff-total`) to a cause or name it unexplained by scope; explain book b3's `out_of_window_flow` and `window_truncated` reasons from its stored inputs and fix them where they are a defect (RESID-01, RESID-02, Phase 188 D-13). Never invent data.

</domain>

<decisions>
## Implementation Decisions

### Channel for PROD reads (founder 2026-11-06)
- **D-01:** PROD reads go through the Supabase MCP (`execute_sql`), one read-only query per call, marker query first. Only if the MCP does not work, fall back to the CLI, one query per Bash call, never chained. Founder words: "try MCP. If it does not work, then do the prod reads through CLI, but split them up, so that there are not mistakes." Large row sets are reduced to SQL-side per-scope digests so results stay small.
- **D-02:** Every hand-saved MCP result is checked against a PROD-side md5 over the same result set (`d_checks.sql`) before it is used. Rationale: one transcription error was caught this way in c0.

### Control capture (area 1, accepted as recommended)
- **D-03:** The pair is `c0` and `c1`, both from the byte-identical SQL in `~/.cache/quantalyze/residchurn/sql/d_*.sql` (untracked scratch). `c0` was taken 2026-11-06 15:02:09Z (marker PRODUCTION before and inside the last query; all four checks matched; manifest at `~/.cache/quantalyze/residchurn/c0/MANIFEST.md`). `c1` is taken after the 2026-11-07 00:40Z nightly's derive and compose jobs are all done.
- **D-04:** "No deploy between" is proven from the Railway deployment list of the analytics service and the PROD migration ledger, both empty between `c0` and `c1`. Vercel (frontend) deploys do not void the pair, because they change no stored value (founder rule recorded in the ROADMAP calendar constraint).
  - **D-04 AMENDED 2026-11-06 (founder, AskUserQuestion answer "Content-based (Recommended)").** The Railway half of the proof is content-based, not a literal empty list: every Railway deployment in the `c0`→`c1` window, on both the API and the worker services, must have an empty `git diff --stat <c0-live commit>..<its commit> -- analytics-service supabase/migrations`. Other merges may land meanwhile, as long as they do not touch those paths. This replaces the literal "deployment list empty" wording above; the PROD migration ledger half (no new ledger row between `c0` and `c1`) is unchanged. The original sentence is kept as lineage.
- **D-05:** Hold: merges touching `analytics-service/` or `supabase/migrations/**` wait until `c1` is taken. This phase's own b3 fix ships only after `c1`.
- **D-06:** A deploy inside the window voids the pair; take a new `c0` before the next nightly and use that one.

### Attribution of the 1214 values (area 2, accepted as recommended)
- **D-07:** The c0/c1 digests say which scopes move across a quiet nightly. Per-day rows are read only for scopes that move, through small MCP queries, and diffed against 188's row-level captures `b0` (2026-11-05 08:32:31Z) and `b1` (2026-11-06 07:04:02Z) in `~/.cache/quantalyze/tinybase-gc/`.
- **D-08:** Cause buckets: (a) the nightly re-derive's own movement with unchanged inputs, (b) upstream input changed (refetched trades, funding, flows), (c) a named code path (for example #1205), (d) unexplained, listed by scope.
- **D-09:** "Changed" stays 188's exact comparison. The report adds size bands (≤1e-9, ≤1e-6, larger) beside it and does not redefine the rule.
- **D-10:** The non-nightly `derive_broker_dailies` job that finished 2026-11-06 11:25:40Z (after the nightly and after `b1`) is examined as a named cause candidate for any `b1`→`c0` movement.

### Book b3 (area 3, accepted as recommended)
- **D-11:** b3's two reasons are explained read-only from its seven stored `key_inputs:*` payloads and the reason logic in `analytics-service/services/allocator_equity_derive.py` (`OUT_OF_WINDOW_FLOW` added near `:1673`, `WINDOW_TRUNCATED` near `:2490`).
- **D-12:** Where a reason is a defect, fix it TDD-style with a test that is RED on today's behaviour, shipped after `c1` (D-05). Record b3's trust state after the next nightly that follows the fix.
- **D-13:** Where a reason is correct behaviour, record why and leave b3 untrustworthy. No fix is invented to make it green.
- **D-14 (founder 2026-11-07, "Investigate the gap (Recommended)"):** Plan 03 found that book b6's stored curve holds only k18's window and leaves out k20's days (`gc-c-b3-truncated: capture=b1 book=b6 ... agree=no`, `gc-c-b3-curve: ... curve_holds_all_members=no`, the same on b0). That gap is its own finding: why the compose leaves k20 out of b6's curve is investigated read-only (stored rows plus the compose code, a code path named only under plan 05's evidence rule), and reported in plan 07's report beside the b3 verdict. Plan 03's prediction rule is NOT amended, so b3's `window_truncated` stays `unexplained` and plan 07's routing starts from it.
- **D-14 CLOSED (founder 2026-11-07, "Intended, no flag"):** The orchestrator's read-only PROD read (marker first, PRODUCTION) showed b6's omitted key k20 and b5's omitted key k34 are both Bybit keys with `sync_status=revoked`, `is_active=true`, and `history_inclusion`, `account_share_kind`, `venue_account_id` and `disconnected_at` all NULL (unknown account). `job_worker.py:departed_history_inclusion` excludes an unknown-account departed key by default (founder-confirmed 2025-09-25), so the omission follows that rule. Intended behaviour; no flag and no follow-up are booked.
- **D-15 — FOUNDER DEVIATION (founder 2026-11-07, "Use the plan's wording"):** The phase's attribution of the 1214 is a 0, b 1142, c 0, d 72: a one-day offset stretch (cv undefined, one qualifying day) is not scored as a fail, as the plan's wording says. This overrides the pinned `final_attribution.py` reading (sha12 8a62ca3b1215), which scores that stretch `pass=no` and gives a 0, b 36, c 0, d 1178. The pinned script is NOT edited; the pinned reading stays printed beside the attribution of record as lineage. Recorded here and in the ROADMAP Phase 202 section.
- **D-16 (founder 2026-11-07, "Don't widen; book it"):** Bucket (c) is not widened to cover a worker setting. s6, s9 and s10 (b0 to b1) and s2, s5, s8 and s13 (c0 to c1) stay (d) under the rule as fixed. The MT5 server-clock worker setting switched on 2026-11-03 is recorded as the measured lead, and a TODOS follow-up confirms or rules it out.
- **D-17 (founder 2026-11-07, "book the investigation as a phase"):** b3 is not re-opened inside 202. Plan 08 records the b6 finding, b3's `window_truncated` stays `unexplained`, and no file under `analytics-service/` changes. Why b3 carries `window_truncated` is investigated in a new follow-up phase, booked with `/gsd-phase`, taking 202's evidence as input. Plan 08's contingency choice maps to its `no-fix-override` option (no fix in 202, recorded as a founder deviation), with the investigation moved to that phase.

### Claude's Discretion
- How the per-day reads for moved scopes are batched, as long as each stays one read-only MCP query and is checked per D-02.
- The SUMMARY line format, following 188's `gc-*` style.
- **2026-11-06 (planner, plan 04): D-06's retake also covers a missed pre-nightly read.** D-06 names a deploy inside the window as its trigger. Plan 04 also routes a pre read that is missed, not idle by 2026-11-07T00:35Z, or showing a key or book derived from 00:10Z, to the same retake: `c0b` before the next nightly, `c1b` after it. The 00:35Z cutoff is five minutes before the 00:40Z key-mode trigger. This is planner discretion, not a change to D-06. Consequence: the D-05 hold on merges touching `analytics-service/` or `supabase/migrations/**` lasts one more day, until `c1b` is taken after the 2026-11-08 nightly.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 188's capture kit in `~/.cache/quantalyze/tinybase-gc/` (untracked): `sql/q_*.sql`, row-level captures `b0/`, `b1/`, and `bin/diff.py`, `summarize.py`, `recheck.py`. `bin/q.sh` reads the PROD password from Keychain and must NOT be used (D-01).
- 202's digest SQL in `~/.cache/quantalyze/residchurn/sql/` (`d_counts`, `d_keys`, `d_strats`, `d_books`, `d_ki`, `d_jobs`, `d_checks`).

### Established Patterns
- Read-only PROD measurement phases record `gc-*` style lines in the SUMMARY, with the marker answer recorded (188-12, 188-16).
- Reason codes live in `DegradeReason` in `analytics-service/services/allocator_equity_derive.py` (`WINDOW_TRUNCATED` `:109`, `OUT_OF_WINDOW_FLOW` `:121`).

### Integration Points
- Nightly derive at 00:40Z (pg_cron to the analytics service), producing `csv_daily_returns` rows and `allocator_equity_derived` (`equity_curve`, `key_inputs:*`).
- Railway deploys of the analytics service follow main CI green (memory: railway-analytics-deploy).

</code_context>

<specifics>
## Specific Ideas

- Scope labels (k1…, s1…, b1…) must follow 188's `map.json` so the attribution lines up with 188-16's per-scope list.
- Book b3 (label from 188 `map.json`) reads in c0 (`is_trustworthy=false`, reasons `out_of_window_flow,window_truncated`). Tracked text must use the label, not the id.

</specifics>

<deferred>
## Deferred Ideas

- TODOS `185-BOOK-CUMULATIVE-UNEXPLAINED` is related but not owned here.

</deferred>
