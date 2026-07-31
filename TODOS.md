# Quantalyze — Backlog (single source of truth)

**Consolidated 2026-07-23.** This file replaces and supersedes every prior scattered
tracker. The following were folded in here and then deleted so there is ONE ground
truth going forward:

- `TODOS.md` (old 60KB sprawl), `.planning/FUTURE-MILESTONES.md`,
  `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md`,
  `.planning/tech-debt/TECH-DEBT-AUDIT-2026-06-09.md`,
  `.planning/DOGFOODING-FINDINGS-2026-07-16.md`, `.planning/DEMO-REPOINT-SCOPE.md`,
  `.planning/BACKBONE-BYPASS-INVENTORY.md`, `.planning/debug/bybit-reconcile-3-findings.md`,
  `.planning/SCENARIO-COVERAGE-WINDOW-ADR.md`, `.review/b7-tweaks/DEFERRED-FOLLOWUPS.md`,
  `.review/follow-ups.md`, `audit/tech-debt-round-1.md`, `audit/tech-debt-round-2.md`,
  `tasks/ADVERSARIAL_USER_NOTES.md`, `.gstack/handoff-2026-04-26-uat-followup.md`.

Kept (NOT backlog): `.planning/milestones/*` (shipped history), `.planning/codebase/*`
+ `research/*` (architecture), `.planning/{STATE,ROADMAP,REQUIREMENTS,PROJECT,MILESTONES}.md`
(active GSD state), `.planning/RETROSPECTIVE.md` (process history), `CHANGELOG.md`.

Items resolved by intervening milestones (v1.10–v1.14) and stale-but-in-prod-without-issue
items were dropped, not carried. Categories: **Fix now** / **Fix mid-term** / **Don't fix**.

---

## 🔴 FIX NOW — live correctness, trust-boundary security, active go-live

1. **`RESEND_API_KEY` unset in Vercel prod** — founder-LP report cron + all transactional
   email are dead (code soft-skips, only Sentry fires). **Founder action:** set the key in
   Vercel prod. Do before the first warned founder month. (Note: portfolio email *alerts*
   are out of the pipeline as of 2026-07-25 — the `alert-digest` cron was removed; alerts
   surface in-app + engineering failures via Sentry. This item is now only about the
   founder-LP report + transactional email.)
2. **Deribit / Zavara mandate reconciliation (go-live).** Performance reconstructs from the
   API alone (green: cum 62.66% / maxDD −4.13%). The reported capital **4M/10M/1M/2M is
   custodied at Matrixport (keys 1&2) / LiquidityTech (key3), NOT in the Deribit keys** —
   the accounts hold only a $150–750K working-margin slice. **Custodian-statement
   reconciliation is dropped (founder call 2026-07-25) — the API reconstruction stands as
   ground truth.** Zavara live *activation* (write the proven reconciliation config to a
   `strategies` row) remains, pending a founder trigger + strategy id.
3. **sFOX / Nautilus manager-data go-live (v1.13 founder flags).** Pending founder ops:
   EGRESS / WORKER-01/03/04 / FACTSHEET / E2GT-01 / FLIP / GOLIVE. **Reframe:** manager
   data = Nautilus DD API (`api.nautilus.finance`, x-api-key), not sFOX direct — the "sFOX
   key" was a Nautilus key. Enable path = set `NEXT_PUBLIC_SFOX_ENABLED` + `SFOX_ENABLED`
   in Vercel + redeploy main (build-time flag); IP-whitelist the 3 worker egress IPs
   {208.77.244.242, 152.55.184.240/.241} with Nautilus (7-day access, email all 3).
   **Founder decision:** sFOX-venue vs Nautilus-manager path; actual vs adjusted NAV.
4. **Land v1.14 Smoothed-MTM milestone.** Code-complete on `feat/phase-83-smoothed-mtm`,
   dark behind kill-switch (`SMOOTHED_MTM_ENABLED` + `NEXT_PUBLIC_SMOOTHED_MTM_ENABLED`,
   both default OFF). Do: version + CHANGELOG bump → PR → merge. Live acceptance (Phoenix
   key) stays deferred. ⚠️ landing risk documented: a structural smoothed mark-hole fails
   the WHOLE job — that's why it ships dark.
5. **v1.15 MT5 — LIVE on quantalyze.xyz 2026-07-25 (flags flipped).** ✅DONE: worker
   `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal` + `MT5_GATEWAY_PORT=8001`
   (Railway deploy 9d310b40 from main HEAD — also retired the decoupled CLI-snapshot, so the
   worker deploy source is GitHub-tracked again) + Vercel `NEXT_PUBLIC_MT5_ENABLED=true`
   (`vercel --prod` fresh build dpl_AMiWsz…, since NEXT_PUBLIC_ is build-time inlined). Founder
   flipped without pre-rotating the investor pw (read-only) and shortcut the 5–10d soak window
   (day-1 green + full factsheet already proven on the real Vantage acct). Gateway RPyC bridge +
   worker deps + soak history: v0.49.1.0→0.49.3.0, see memory `project_v1_15_metatrader5_milestone`.
   **Server-UTC offset now SET (2026-07-25):** `MT5_SERVER_UTC_OFFSET_S=10800` on the worker
   (EEST/UTC+3, matching the validated soak) — the live derive was defaulting to 0 (raw
   server-time bucketing). The spike's misleading `−810` estimate was root-caused (stale-deal
   artifact: estimator assumed the latest deal ≈ now) and hardened to emit no candidate beyond
   ±13h. **Only remaining (non-blocking):** founder VNC/live-tick confirm of the DST edge (a
   fixed env can't auto-switch EET↔EEST at the Oct/Mar transition; affects day-bucketing only,
   NOT the balance-anchored parity). Optional: rotate the read-only investor pw
   (`Vantage_investor_password_26547876`).

### v1.14 Smoothed-MTM go-live blockers — FIXED in the v1.14 landing (2026-07-23)
Surfaced by the /ship Fable red team; the safety-critical ones fixed in the landing PR so
flipping `SMOOTHED_MTM_ENABLED` ON can never sink a healthy book's cash+MTM factsheet.
- ✅ **GLB-2 (FIXED)** — single-key smoothed pass now catches `LedgerValuationError` + the
  structural tuple and DEGRADES (omit the smoothed by-basis key, keep cash+MTM), mirroring the
  MTM second pass. RED-verified.
- ✅ **GLB-3 (FIXED)** — composite smoothed fan-out bounded by `asyncio.wait_for` at a remaining-
  budget slice (single-key FIX-2 pattern) and degrades on timeout/structural error; the
  degenerate-length/overlap/ValueError arms also degrade (single-key parity). RED-verified.
  (The RT-3 over-fix — shrinking `_composite_max_members` — was reverted; the cap is byte-
  identical to main again.)
- ✅ **GLB-4 (FIXED)** — `fetch_deribit_option_daily_marks` now treats a malformed/error HTTP-200
  as retryable within the existing backoff (`_FlakyChartResponse`); genuine `no_data` stays
  benign. RED-verified.
- ✅ **GLB-5 (FIXED)** — retention horizon is env-overridable (`DERIBIT_OPTION_MARK_RETENTION_DAYS`)
  and a wholly-empty instrument within 30d of the cutoff buckets as pre-retention cash-fallback
  instead of hard-failing D-07. RED-verified.
- ⏳ **GLB-1 (REMAINS — now non-catastrophic, dogfood-driven):** on an option expiry day the
  ΔMTM grid caps at `last_settled=T-1` while the anchor read is post-08:00-UTC delivery on day T,
  so the book-channel residual can breach `_assert_smoothed_book_channel`
  (`deribit_ingest.py`~2032, `deribit_txn.py`~1746) → `LedgerValuationError`. With GLB-2/GLB-3
  in place this now DEGRADES safely (smoothed omitted for that book/day, cash+MTM intact) rather
  than failing the whole job — so it is NO LONGER a flag-flip safety blocker, but it does mean
  smoothed may be unavailable on expiry days for active options books. Proper fix (reconcile the
  book channel at a boundary consistent with the anchor) is best validated against real options
  books in the live dogfood, not blind. Watch for it in the /qa + Phoenix acceptance.

### v1.16 branch `feat/v1.16-production-resilience` — merge guards (added 2026-07-26)

- **No branch protection on `main` at all.** GitHub `rulesets: []` and
  `branches/main/protection` → 404 — verified first-hand. There are **no required status checks**,
  so nothing mechanically blocks a merge with red CI. Combined with the next item this is the live
  risk. ~~**Founder action:** enable branch protection requiring the `frontend`, `python` and
  `sql-tests` aggregator checks.~~
  → ✅ **DECIDED 2026-07-27 (founder): DEFERRED until there are paying clients.** Raised twice and
  declined twice; **this is settled — do not re-raise it each phase.** The reasoning is a solo-founder
  velocity trade, and it is defensible while the only committer is the founder.
  ⚠️ **The one consequence that must not go invisible:** every CI gate in this repo — including the
  real-Redis lane 140.2 built and wired strictly into the `frontend` aggregator — is **advisory at
  merge**. So *"CI is green"* is a statement about a **run**, never about **what landed on `main`**.
  Any phase-closure or verification wording must say **"the workflow would have caught it"**, never
  **"the workflow did stop it"**. `140.3-VALIDATION.md` already carries this rule verbatim; keep it
  in every subsequent phase's validation doc. **Re-open when the first paying client lands** — at
  that point the merge-time guarantee starts protecting someone other than us.

### v1.16 Phases 141–146 — review-depth policy (DECIDED 2026-07-27, founder-approved)

Not every remaining phase earns the 140.2/140.3 treatment. Depth is set by **blast radius**, not by
habit. This replaces "run the full pipeline everywhere" for the rest of the milestone.

| Phase | Depth | Why |
|---|---|---|
| **141 SEAM (retry)** | **FULL — the deepest of the milestone** | Retry means **double-executing side effects**. Its own SC3 pins that a retried `teaser` mints duplicate `strategy_verifications` rows / `public_token`s / leads. ⚠️ **Mandatory extra:** 141 converts `recoverable` from a *render hint* into an **automated retry input** — TS-35's W-4 rider says the `unknown ⇒ true` polarity **must be RE-DERIVED** at that moment, because the harm asymmetry that justifies `true` does not survive the change of consumer. |
| **142–145 JOB** | **SPLIT: full on migrations/DDL, light on application code** | Bounded blast radius in app code, but these write **migrations, which auto-apply to PROD on merge to `main`** — and per the decision above that merge is unguarded. Scars to respect: the 106 janitor reaped on the wrong column and was **reverted**; WR-02 (144) is an open call with a prod-outage history. Keep falsifiability ledgers on both halves. |
| **146 RATE** | **LIGHT — researcher + planner + ledger, no deep review round** | Self-described mechanical: a re-grep artifact and a limiter-value audit. Nothing in it can silently corrupt data or money. |

**Keep everywhere, regardless of depth:** the **Falsifiability Ledger** and the **Oracle Independence**
checklist. They are cheap and they are what actually caught the breaker firing at 30-instead-of-5, the
vacuous `status_code=400` grep, and the fake that agreed with itself. The expensive part being cut is
the multi-round red-team fan-out, **not** the mutation discipline.

**Rejected reasoning, recorded so it isn't re-litigated:** the case for going lighter is NOT *"we've
found most of it"* — the data refutes that (140.2 found 3 criticals; 140.3's planning gate found 3
blockers before a line was written). The case is *"this particular phase cannot hurt much,"* which is
true for 146 and half of 142–145, and **false for 141**.
- **`sql-tests` will be RED on the v1.16 PR until migration `20260726000225` is hand-applied to
  TEST** (`qmnijlgmdhviwzwfyzlc`), per this repo's standing MCP→TEST-before-merge convention.
  Failure mode: reviewer sees an *expected* red, merges anyway, and **merging auto-applies the
  migration to PROD**. The migration itself was validated hard (real PG15, idempotent, abort-safe,
  20 PROD rows) so the apply risk is low — the risk is normalising red-check merges on a
  prod-DB event.

### v1.16 Phase-140.1 review — HOMELESS findings (no owning phase; added 2026-07-26)

> ⚠️ **Why these are here:** they lived only in `.planning/phases/140.1-*/140.1-REVIEW.md` and
> `140.1-TS-OBLIGATIONS.md`, which are **gitignored and have zero git backup** (`git ls-files
> .planning` → 5 legacy phase-19 files only), in a repo whose memory records two prior accidental
> destructions of exactly these ledgers. Full evidence stays in those files while they exist.

- **Tests that run in NO environment (three findings).** (a) `TEST_SUPABASE_DB_URL` is wired into
  the `sql-tests` CI job only (`ci.yml:810`), never the `python` job (`ci.yml:1030-1033`) — so
  **31 pytest cases skip in CI exactly as they do locally**. (b) `HAS_PY_ENV` is set in **zero files
  repo-wide** — the 5 Phase-4-vs-Phase-5 **money-math KPI parity** cases it gates are permanently
  dormant. (c) 4 `tests/test_repro_key_flow.py` cases skip on missing **binance** cassettes
  (`tests/cassettes/` holds only `okx/` and `bybit/`). CI wiring; no owning phase.
- **A tenth IP-keyed route + the test that conceals it.** `analytics-service/routers/simulator.py:92`
  returns `f"simulator:ip:{get_remote_address(request)}"`; its module docstring still claims it reads
  `X-User-Id`, which it does not. `test_simulator_router.py::…::test_route_uses_user_keyed_key_func_not_ip`
  asserts `key_func is not get_remote_address` — which **passes because the key func *wraps* the IP
  function** rather than being it. Mechanically quarantined by `IP_KEYED_QUARANTINE` with an
  *equality* assertion, so the exemption cannot grow and goes red when repaired. **PYAPI-03's
  reconciliation is 9/9 — do not report 10 closed.** Repairing the route must also repair the test's
  name and docstring.
- **Nine test modules mount a bare `FastAPI()`**, so they never see the app-global 422/429 handlers
  and their 422s render in FastAPI's default **leaking** shape. **Negative half: none of them is
  vacuous today — do NOT schedule a "fix the broken tests" sweep.** Positive half: the credential-safe
  422 is gated by exactly ONE file (`tests/test_validation_error_contract.py`), and
  `test_process_key.py` is where a future author would "prove the 422 is safe" and prove nothing.
  A shared app-factory fixture closes it.
- **403-vs-422 split unowned.** `_scope_rejected` (`routers/process_key.py:1295-1299`) is a three-arm
  OR behind one return, so ordinary `not val.valid` failures (incl. a malformed CSV) now answer
  **403** where 422 would be sharper. The consumer half is tracked as TS-14; the split decision itself
  has no owner.
- **Worker raises an HTTP exception.** `analytics_runner.py:1725` raises `HTTPException(500)` from the
  WORKER — a category error that can never render.
- **Anonymous teaser bucket 30/hour** (`routers/process_key.py:99`) — deliberate and founder-retunable;
  wants a saturation alert so exhaustion is visible rather than silent.
- **Process item (TRAP-9 class B2):** plans enumerate production sites exhaustively but not the TESTS
  those changes invalidate. Plan-check found 4; plans 06, 07 and 08 each found one *more* the plan did
  not predict. Fold into the planning template, not a code phase.

---

## 🟡 FIX MID-TERM

### Money-path correctness (latent / flag-gated / edge cases)
- **Unified-backbone CSV-finalize breaks if flag on** — service-role client has no
  `auth.uid()` → 42501 every time when `PROCESS_KEY_UNIFIED_BACKBONE=on`. Skip unified for
  finalize or forward JWT. Make `USE_COMPUTE_JOBS_QUEUE` permanent + delete both legacy
  finalize placeholder-write branches.
- **Backbone-bypass parity surfaces** — `_compute_portfolio_analytics` (routers/portfolio.py:632)
  and `equity_reconstruction.py` run independent Sharpe/TWR stacks; frontend TS
  (`portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) and matching
  (`match.py`) compute bespoke annualization/Sharpe. Parity-gated but real divergence risk —
  absorb into the unified backbone.
- **bybit funding cursor shares the trade `last_sync_at` cursor** → permanent daily funding
  gaps + pre-adoption history (back to 2026-01-22) never backfilled. Dedicated funding
  cursor with overlap + one-time backfill. (Diagnosis-only; not yet fixed.)
- **OKX bills paginator silently truncates** → returns partial `daily_pnl` with only a
  WARNING, no `partial=true` to caller. Also: OKX branch lacks an inner try, so its failures
  escape at ERROR while bybit/binance fail at WARNING (skewed alerting).
- **quantstats price-detection sign-flip** — `_prepare_returns` misreads all-non-negative
  returns with a >100% day as prices → wrong Sharpe/vol. P114 fixed only the portfolio/verify
  path; the strategy-analytics path is still exposed.
- **Blend annualization understates crypto** — an unknown-`asset_class` crypto leg annualizes
  at √252 not √365 → inflates Sharpe when it's the sole crypto leg. Default unknown→crypto for
  the RISK basis.
- **Deribit `correction` residual** — a capital-reason row carrying a trading token and no
  capital word still classifies as trading P&L. Tighten the word-boundary classifier.
- **Short-window CAGR over-annualization (v1.8 P73)** — a 2-day window annualizes with
  exponent 365 → CAGR explodes (~5e7), stamped `complete` with no DQ flag. Add
  `elapsed_days < N` → `complete_with_warnings`/`insufficient_window` WITHOUT changing CAGR.
- **Worker orphaned-`running` purge: DELETE vs reset** (founder decision at FLIP) — same
  migration; TEST wants DELETE, PROD wants reset (a sustained >4h outage would lose live
  jobs). Window already widened 2h→4h.

### Reliability / observability
- **csv-finalize is non-transactional** → orphan strategy rows on partial failure. Wrap in one
  txn or add Sentry alert + orphan-cleanup cron.
- **`after()` enqueue silent-failure** → strategy has data but no compute job → stuck
  "computing" forever. Sentry alert + dashboard for pending/null rows > 2h.
- **Worker-crash `computing` janitor** — SIGKILL mid-job strands the row; wizard polls forever.
  Cron marking `computing` > 30min as failed. (Also the root of the recurring shared-test-DB
  fence flake — retention purge re-homed here.)
- **`complete_with_warnings` laundered to plain `complete`** when a sibling job hits
  `failed_final` then recovers without re-run.
- **Phase-19 hourly cron never decommissioned** (PR-D) — soak gate passed, cron still running.
- **Strategy sync-failure checkpointing** — persist `last_fetched_trade_timestamp` so retries
  resume instead of re-fetching all trades.
- **Match-engine cron health check missing** — no `/api/cron/health-check` route; match-engine
  cron failures are invisible (silent data staleness).
- **Vercel→Railway seam has no resilience** — `analytics-client.ts` has no fetch timeout /
  retries / circuit breaker; a hung Railway request holds a Vercel lambda open until the
  platform kills it and cascade-500s `keys/sync` / `verify-strategy` / `admin/match/*`.
- **Rate limiting only on 6 routes** — the authed routes that hit the Python service
  (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`,
  `admin/partner-import`, `trades/upload`, `intro`) are unlimited → arbitrary quota burn.
- **Cron/email idempotency & budget** — founder-LP cron double-email if lambda dies post-Resend
  (idempotency row on `(cron_name, year_month)`); founder-LP 85s worst-case > 60s maxDuration;
  Resend webhook svix-id idempotency store; email correlation-id fragmentation (per-email not
  per-batch); email retry false-alarm on UNIQUE(23505).

### Security
- **npm advisories (2026-07-25).** Shipped highs FIXED at root: `next` 16.2.10→16.2.11
  (clears the 9 App-Router SSRF/proxy-bypass/cache-confusion advisories — stable patch exists)
  + `overrides` `sharp ^0.35.3` (prod libvips), `fast-uri ^3.1.4`, `postcss ^8.5.23`, `tmp
  ^0.2.7`. Nightly gate scoped to the PRODUCTION tree (`npm audit --omit=dev --audit-level=high`)
  so it keeps full HIGH teeth on shipped code but isn't red on the one residual, build-only
  high: `brace-expansion` OOM (GHSA-mh99) is fixed only in 5.0.8, which drops the CJS function
  export and breaks `minimatch@3`/eslint — unfixable without replacing the lint toolchain.
  Left to Dependabot. Follow-up: re-check the `sharp` override once `next` bumps its declared
  `sharp` range past 0.34.5.
- **CSP uses `unsafe-inline`/`unsafe-eval`** — move to nonce-based CSP.
- **Signup allows 6-char passwords** — `minLength={6}` client-only; server-side Supabase policy
  unverified/undocumented.
- **VCR cassette over-redaction** — misses token/hmac/digest/nonce (and over-matches
  signal/signedAt/pubkey); replace with per-broker allowlist.
- **ccxt tracebacks not secret-scrubbed** (`exc_info=True`) — an API key could land in Railway
  logs. Add a `redact_secrets` util.
- **No Python lock file; ccxt unpinned** — unreproducible prod builds in the money-math path.

### CI / test-infra ratchet
- 44 live-DB vitest files + ~112 python tests are green-skipped in CI while migrations
  auto-apply to prod.
- pytest 80% gate measures only `services/` (routers/ ~7.8k LOC + `main_worker.py` uncovered).
- Shared test-DB sql/e2e race (fence flake); Railway analytics deploys skip silently on red
  main CI (verify `commitHash` + `/health`); `repro-key-flow.sh` Layer-A leak gate is a CI
  no-op; `cassette-refresh.yml` failed 17/17 with no alerting.
- 20 of 35 Playwright specs wired to no workflow; migrations auto-apply to prod but not the
  test project; generated DB types have no regen/drift gate.

### Tech-debt / maintainability (opportunistic, don't force)
- God-files: `queries.ts` (3,205 lines), `job_worker.run_sync_trades_job` (688 lines),
  `portfolio.py` (2,423), `exchange.py` (2,777).
- ~4.6k LOC dead-code sweep (35 files, stale 3,256-line DB-types twin, unused deps); wire knip.
- Formatter copy-paste drift (20+ local `fmtUsd`/`fmtPct` with diverging null handling) →
  shared util.
- Dual strategy create/edit (retire legacy `StrategyForm` once wizard proven).
- PDF route boilerplate ×4 → shared `pdf-route.ts` (+ `Buffer as BodyInit` casts).
- `withAuth` route-context forwarding; migrate `extractAnalytics` off the `@/lib/queries`
  barrel; `@sparticuz/chromium` 16 majors old + puppeteer PDF cold-start hang (no timeout —
  demo risk).
- Env sprawl (59 keys, no manifest/startup validation); README setup stale/prod-dangerous;
  no CONTRIBUTING/ops runbooks (deploy-rollback, Railway restart, migration-recovery, secrets
  rotation).
- **MT5 transport doubles are stateless about IPC-attach (test robustness).** The
  `_FakeMt5`/`_FakeMt5Transport` doubles return True from `initialize()` unconditionally;
  reads don't depend on it. The bug class ("IPC state exists only on the live terminal,
  doubles never modeled it" — the `-10004` connect crash) stays partially unmodeled. Give
  the doubles an `initialized` flag (reads → -10004 unless `initialize()` ran, `shutdown()`
  clears it) so the restart→re-attach path is proven, not just asserted by call-order.
  Deferred from v0.49.2.0 (conflicts with the isolated-read tests that don't login first;
  needs those restructured). Red-team FABLE 2026-07-25.
- **`requirements.in` vs lock drift (analytics-service).** `.in` pins `pandas==2.2.3` but
  the committed `requirements.txt` lock pins `pandas==3.0.3` — out of sync, so a naive
  `make lock` would silently DOWNGRADE prod pandas 3.0.3→2.2.3 (a money-math dep). Also the
  committed lock predates `--universal` markers / drops `[extra]` annotations vs local uv
  0.11.6 output, so `make lock` isn't reproducible across uv versions. Fix: decide the
  intended pandas, pin the uv version used for locking, regen once, commit. (Surfaced by the
  v0.49.1.0 MT5-deps ship; the rpyc line was hand-added to avoid triggering this drift.)
- **No `docs/architecture/` ADRs** — every decision is implicit in code; actively-inconsistent
  mechanisms to codify + consolidate: multiple auth wrappers, multiple cron mechanisms
  (vercel.json vs `pg_cron`+`pg_net`), multiple admin checks. (17 existing decisions to
  document + 5 open questions per the 2026-04 architecture audit.)

### v1.16 Phase-140.1.2 — routed findings (added 2026-07-26)

> Both are **pre-existing** and were deliberately fenced OUT of Phase 140.1.2, whose scope was
> four named artifact items and no general sweep. Routed here per that phase's own CONTEXT rule.

- **`analytics-service/tests/test_mt5_validate.py` carries 8 self-referential detail
  assertions** — `:286`, `:310`, `:328`, `:347`, `:383`, `:404`, `:420`, `:436` are each
  `assert ei.value.detail == <CONSTANT>` where the constant is imported from the module under
  test, so the assertion cannot fail when the copy changes. (All 8 re-read at HEAD
  `2c55ece0`; the file is untouched by 140.1/140.1.1/140.1.2.) 140.1.1's oracle audit found
  zero self-referential oracles *in the 19 files it added* — this is an older file it never
  rewrote, so that audit's verdict is not contradicted. **Do not copy this pattern**; fix by
  typing the expected copy as a literal in the test, the way 140.1.1 fixed the one assertion
  in this file that it did touch.
- **`analytics-service/docs/STATUS_CONTRACT.md` not-seam-reachable coordinate drift beyond the
  item 140.1.2 repaired** — `routers/portfolio.py:2242` is a comment line (`# Audit H-0535 —
  the credential fields are pydantic.SecretStr…`; the 429 raise is at `:2254-2264`, located by
  the text `if not _check_verify_strategy_email_rate(` at `:2253`) and `:2446` is a comment
  line too (`# Vectorized matching: build a DataFrame…`), not a deliberate error arm.
  **Re-derive both by text before fixing — do not trust these numbers either**; the raise
  shifts whenever anything above it in a 2500-line router moves. 140.1.2 plan 04 corrected
  the `exchange.py` and
  `internal.py` coordinates in that bullet plus the S-11 row and the classes heading, and
  deliberately stopped there. *(Same file, same class: `routers/exchange.py:37` and
  `services/error_contract.py:6,8` still say "the four classes" in prose — the table has had
  five rows since 140.1.1 plan 01. One-word comment fix, batch it with the above.)*

### v1.16 Phase-140.2 (SEAMCORE) review — findings routed onward (added 2026-07-27)

> From the 140.2 code review (1 Critical, 3 High, 4 Medium, 6 Low) + VERIFICATION W-1..W-4.
> **Fixed in the review-fix pass:** CR-01, HI-01, HI-02, HI-03, ME-01, ME-02, ME-03, LO-03,
> LO-04, W-1, W-2 (folded into HI-01). ME-04 was JUDGED and recorded rather than fixed (the
> containment it needs is a cross-language change to a closed dependency set, and 140.2's fence
> is zero Python) — it lives in `140.1-TS-OBLIGATIONS.md` as **TS-39** with the HI-01 residual.
> Copy halves went to 140.3 as **TS-37/TS-38**; branch protection went to ops as **TS-40**.
> The four below are the ones deliberately left, each with its reason. **Coordinates are
> SEARCHABLE CODE TEXT, not line numbers — five waves rewrote these files.**

- **LO-01 — `501` and `505` count toward the breaker, re-creating the self-sustaining outage the
  `500` arm exists to prevent.** `src/lib/seam-discriminator.ts`, the status table: only `500` is
  `service-permanent`; `501 Not Implemented` and `505 HTTP Version Not Supported` fall into the
  `other 5xx → SERVICE-TRANSIENT → COUNTS` arm. Both are DETERMINISTIC — retrying cannot help — so
  five of them in 30 s open the circuit, which then blocks its own recovery probe. That is verbatim
  the R-1 / A-02 reasoning the `500` arm itself cites. A route deployed against a Python version
  that does not implement a method would trip the seam for everyone, one cooldown at a time.
  *Why not fixed now:* it is PRE-PHASE behaviour that 140.2 did not introduce, and the arm is
  shared with 502/504 (platform edge), where transient IS correct — so the change is a re-derivation
  of the status table, which is SEAMCORE-01's subject and cross-pinned to
  `analytics-service/docs/STATUS_CONTRACT.md`. *Fix:* add `501` and `505` to the permanent arm, or
  state in the table why they are considered transient on this seam. Pair with a discriminator pass.

- **LO-02 — `decodeBreakerLock` accepts a reversed or unbounded span, defeating the A-15 guard
  downstream.** `src/lib/resilient-fetch.ts`, the `^open:(\d+):(\d+)$` regex: it accepts any digit
  strings, so `open:0:99999999999999999999` decodes to `expiresAtMs ≈ 1e20`, `isBreakerOpen`
  returns `retryAfterS ≈ 1e17`, `Number.isInteger` accepts it, and `Retry-After:
  100000000000000000` goes on the wire — **including to the anonymous teaser**. A reversed pair
  (`expiresAtMs < armedAtMs`) makes `emitBreakerTransition`'s `cooldownS` negative. The value is
  only writable by us today, so this is bookkeeping corruption rather than an attack path — but
  `CircuitOpenError`'s A-15 guard was added specifically to stop implausible values reaching a
  header, and this is the one remaining path that can produce one that PASSES it. *Fix:* reject a
  span that is `<= 0` or `> (BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) * 1000`, returning
  `null` — corruption reads CLOSED, per locked decision 4. Cheap; belongs with Phase 141's breaker
  pass (**TS-39**) since it touches the same decode path.

- **LO-05 — `sentryCaptureDeps()` resolves ONE hop and re-arms the trap it disarmed.**
  `src/__tests__/gdpr-export-coverage-hook.test.ts`. The change correctly stopped hand-listing
  `sentry-capture.ts`'s deps, but the regex is applied to `sentry-capture.ts` ONLY — it does not
  recurse into what those deps import. It holds today purely because `seam-redaction.ts` has a
  purity guard forbidding imports. The moment `sentry-capture` imports a non-leaf, every mutation
  case in that file fails with `Cannot find module`, for a reason that has nothing to do with what
  they assert — exactly the trap the function's own docblock says it exists to disarm. *Fix:* make
  the walk transitive (worklist over discovered files), or assert the one-hop assumption LOUDLY —
  `expect(depsOf(dep)).toEqual([])` for each discovered dep, with a message naming
  `seam-redaction`'s purity guard as the reason it holds. Test-infra; no production risk.

- **LO-06 — `scrubSeamError(error.message)` passes a STRING into the error renderer.**
  `src/app/api/strategies/finalize-wizard/route.ts`, the site logging `"RPC error:"` with
  `error.code` as a third argument. `scrubSeamString` is the entry point for a string;
  `scrubSeamError` routes it through `describeThrown`, which takes the `String(err)` fallback.
  Harmless (both are total and produce the same bytes for a string) and inconsistent with the six
  sibling sites in the same file. ⚠️ **CR-01 raised its value:** now that `describeThrown` renders a
  plain object's `code`/`message`/`details`/`hint`, passing `error` WHOLE would give this site the
  SQLSTATE, details and hint it currently throws away — the same diagnosis CR-01 restored to the
  other six. *Fix:* `scrubSeamError(error)`, keeping the deliberate raw `error.code` third argument
  (it is an allowlisted `SAFE_PROPERTY`). One line; batch with any finalize-wizard pass.

### v1.16 Phase-140.1.2 review — findings routed onward (added 2026-07-26)

> From the 140.1.2 code review (0 Critical, 0 High, 7 Medium, 6 Low). The four in-fence items
> (M-02, M-04, M-05, M-06) plus L-03/L-04/L-05 and W-02 were fixed in that phase. These are the
> ones deliberately NOT fixed there, each with the reason and the owner. **Every coordinate
> below was re-derived at HEAD by locating the code text; re-derive again before acting.**

- **→ 140.3 (TypeScript, out of 140.1.2's Python fence).** `internal.py:246`'s throttle now
  raises `service_error(429, "RATE_LIMITED", …)`, a NESTED envelope, where it used to answer a
  bare `{"detail": "<scalar str>"}`. Its consumer
  `src/app/api/keys/[id]/permissions/route.ts:147` does `throw new Error(err.detail ?? …)`, so
  `new Error(<object>)` gives `message === "[object Object]"` and the operator log at `:275`
  reads `Error: [object Object]` instead of the human sentence. **Diagnostics only** — the
  classifier at `route.ts:254-268` keys on message substrings (`INTERNAL_API_TOKEN`,
  `Upstream 5`, `ECONNREFUSED`, `not configured`, `aborted`, `timeout`) and the OLD sentence
  matched none of them either, so the reply is `PROBE_FAILED`/502 before and after. Recorded in
  `docs/STATUS_CONTRACT.md` §2 as joining the object-detail set. Fix it **with** the three
  `err.detail ?? …` sites already owed there, not separately — they are one edit.
- **→ 140.3, schedule WITH TS-05 / TS-35 so the ROUTE closes, not a subset.**
  `routers/exchange.py:538`'s `except ccxt.BaseError` arm on the LIVE `/api/validate-key` route
  raises at `:544` `service_error(424, "EXCHANGE_PROBE_FAILED", dependency=req.exchange, retryable=True, …)`
  — a nested envelope, so `analytics-client.ts:179`'s `error.detail ?? …` yields
  "[object Object]", `classifyKeyValidationError` misses every branch, and a verdict the site
  itself marks `retryable=True` renders as `UNKNOWN`/500 "our team has been notified" with no
  retry affordance. **Same user-visible symptom PYAPIFIX2-01 exists to kill, on the same
  route.** It is NOT an escape 140.1.2 created or hid: the site IS typed at `body.detail.code`,
  and the render defect is the pre-existing owned obligation TS-05. But closing TS-05/TS-35
  without this arm leaves the route half-fixed. (140.1.2-VERIFICATION W-01.)
- **→ backlog, beside the four-vocabulary unification.** The provenance channel
  (`ValidationResult.permanent`) has ONE consumer. `routers/process_key.py`'s `_envelope_error`
  `recoverable` derivation and the sync-arm 424 venue-transient pre-gate both still key on
  `_ROUTE_TERMINAL_ERROR_CODES` ∪ `PERMANENT_VALIDATION_ERROR_CODES`, neither of which knows
  `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` or any pandera-minted CSV code. **Unreachable for
  MT5 today** — `process_key.py` admits `mt5` to `onboard`/`resync` only and `_is_long_fetch`
  routes both to the worker — so this is latent, not live. It goes live the moment a second
  adapter states permanence, or `_is_long_fetch` changes: two contradictory verdicts on two
  paths for one rejection. Plumbing exists (`_envelope_error` already takes an explicit
  `recoverable: bool | None`). (Review M-03.)
- **→ backlog. One route, two body shapes for one condition.** After 140.1.2,
  `POST /api/validate-key` answers 400 with `{detail, code, recoverable}` for a ccxt
  `AuthenticationError` but bare `{detail}` — byte-identical `detail`, **no `code` at all** —
  for an sFOX 401 or an MT5 bad password. Same for `MT5_WRONG_SERVER_DETAIL` and
  `MT5_MASTER_PASSWORD_DETAIL`, which carry no machine code anywhere on the HTTP path even
  though the WORKER path now knows they are permanent (PYAPIFIX2-02). A 140.3 consumer
  branching on `body.code` therefore behaves differently per venue for an identical condition.
  Pre-existing class (the permanent 400 arms were never in PYAPIFIX2-01's venue-transient
  scope), but the asymmetry is newly VISIBLE. Close it by giving the permanent 400 arms the
  same flat shape with `recoverable=false`. (Review M-07.)
- **→ backlog, no behaviour change requested.** `recoverable: true` is advertised for
  `UNSUPPORTED_EXCHANGE`, which can never clear by retrying, because it is not in
  `PERMANENT_VALIDATION_ERROR_CODES`. The arm is effectively unreachable (`create_exchange`
  gates on `EXCHANGE_CLASSES` and raises `ValueError` for unknown ids) and
  `UNSUPPORTED_EXCHANGE` was explicitly REFUTED and fenced out of 140.1.2, so the
  classification is inherited; what is new is that the derived boolean is now on the wire.
  Fold into the four-vocabulary unification. (Review L-06.)
- **→ backlog, optional.** Three `Retry-After` values advertise the FULL window when the true
  remainder is known: `routers/simulator.py:260`, `routers/portfolio.py:1971`, `:2263`. All
  three guards are SLIDING windows keeping a list of timestamps, so the true wait is
  `bucket[0] + WINDOW - now` — which can be one second, while the header says `3600`. Safe (it
  never under-advertises) but it can tell a user one second from a free slot to come back in an
  hour. The service already has the better pattern at `main.py:_retry_after_seconds` (`:461`),
  which reads the real remainder and falls back to the window only when it cannot. Fix shape:
  have `_check_*_rate` return `(ok, retry_after)`. (Review L-01.)
- **→ backlog, adds to the STATUS_CONTRACT coordinate-drift item above.** A mechanical sweep of
  all 51 `path:line` coordinates in `docs/STATUS_CONTRACT.md` (added while fixing review M-05)
  found three more pointing at a blank line at HEAD, none of them in M-05's scope:
  `services/exchange.py:978` (cited as the range start `:978-1021` in R-2), `routers/exchange.py:96`
  and `routers/exchange.py:215` (the S-02 row). The §7 S-table is a HISTORICAL census — its
  `Site` column records where each site was when the table was built, alongside a `Today`
  column describing the pre-migration shape — so a row's coordinate going stale is expected
  and is not by itself a defect. Prose coordinates outside the table are a different matter.
  **The durable fix is not another sweep**: cite by searchable code text (or an anchor comment
  in the source), so a coordinate cannot rot silently. Until then, re-derive before trusting.
- **⚠️ Declined in 140.1.2, recorded so it is not re-filed.** Review L-02 asked for one
  `from services.error_contract import …` per module in `routers/exchange.py` and
  `routers/portfolio.py` (each has two, with a comment block above each). It was applied and
  then **reverted**: merging the imports adds 5 lines near the top of both files, which shifts
  every line below and silently invalidated ~16 verified line coordinates in
  `docs/STATUS_CONTRACT.md` — including the six `fetch_trades` arms
  (`exchange.py:660,670,685,689,698,760`) a verifier had just checked line-by-line. In a
  programme this coordinate-dense, a cosmetic import merge is not worth invalidating the
  document 140.2/140.3 read. Do it only as part of a change that re-derives those coordinates,
  or after they stop being line-based.

### v1.16 Phase-140.5 (SEAMPROSE) — deferred items (added 2026-07-30)

Full detail: **`.planning/phases/140.5-seamprose-attribution-copy-harness-fidelity-and-prose-citati/140.5-deferred-items.md`** (tracked; the phase's own carry-forward ledger, ~40 sub-items). All items below are **non-blocking** by the founder bar (guard-hygiene, prose/citation, copy, and deferred breadth do not block); logged here so the canonical backlog owns them. The phase's one user-facing defect (**1d**, `permissions/route.ts` KEK "not configured" misattribution) was **FIXED** post-phase at `a89cedbf` and is NOT carried.

- **User-facing standout — the per-row CSV breakdown DATA half never renders + the `'nan'` leak (QA ISSUE-005).** `_envelope_error` discards `debug_context` before the wire; the client reads a `pandera_errors` key Python never emits; and a user reading a validation failure sees the literal `'nan'` where a column name belongs. Only the *copy* half is done (the false "see per-row breakdown" promise was removed). ⚠️ **Fixing the data half forwards raw cell values — a PII surface**; admit only if closeable WITHOUT echoing untrusted cell contents (three things must move together — see ledger §1a). This is a degraded-message gap, not wrong data.
- **Copy alignments (non-blocking):** `csv-validate` 503 config-missing arm is a bare heading vs the sibling 502's fuller sentence (§1c); `UNSUPPORTED_EXCHANGE` deserves its own wizard member rather than the honest `UNKNOWN`/500 fallback (§1b).
- **Coverage-law guard widenings (guard-hygiene, §2a–2f):** `.tsx` log-roster class open (two instances scrubbed, roster doesn't cover `.tsx`); wait-threading completeness unguarded; `composite/members` has no `Retry-After` producer (recorded in the guard docblock); docblock-prose rewrites have no guard; purity-needle + wire-vocabulary guards partial-by-construction. Each names its one-line ratchet.
- **Citation/prose harness residuals (§3a–3f):** D/E/F self-relative citations (`line 55`, `(:1027)`) need a second file-scoped predicate; string-literal citations invisible to the comment-scoped census; a marked-quotation-exclusion guard is unbuilt; two RESEARCH offset/count figures (§3.8 `+72`, WP-13 "3+1") are mis-shaped — re-read, don't inherit.
- **Type hazard (§4a):** `AnalyticsUpstreamError`'s positional params — same adjacent-same-typed-argument class as `mintTenantClaim`, more call sites; wants its own scoped plan, not a drive-by.
- **Harness/CI residuals (§5a–5g):** 17 `stripComments` copies unrewired (needs a third string-erasing mode); `ci.yml:1633` left narrow deliberately (subsumed by `spec-disabling.invariant.test.ts`); two PR #108 e2e follow-ups stay skipped; `handleRetrySync` reset is defence for the path 141 adds (unreachable today).
- **424 arrival breadth (§7, deferred by decision):** 140.5-06 task 2 landed 1 of 5 arrival routes + 0 of 5 re-homes. Owed to a future plan: 424 arrival cases at `keys/validate-and-encrypt`, `strategies/create-with-key`, `strategies/composite/add-key`, `verify-strategy`; and RE-HOMING (not deleting) five cannot-arrive suites onto an emittable status while keeping their forwarding assertions.
- **Founder-owed (not code — do not plan around, §6):** copy-vs-`DESIGN.md`-§Voice review for the Claude-drafted CSV/KEY copy; **TRAP-4** five-clicks in a real browser (C-4) + **Sentry ingestion** in a preview via an unroutable `ANALYTICS_SERVICE_URL` (C-5); **⛔ D-01 live-Redis lane STILL UNVERIFIED** — `tests/redis/**` needs a live store, registration pins existence not execution.
  - ⚠️ **C-4/TRAP-4 live five-clicks ATTEMPTED in a real browser 2026-07-30 — blocked on key availability, not a defect.** Reaching a gate render (`GATE_NO_DATA_SOURCE` / `GATE_INSUFFICIENT_TRADES` / `COMPOSITE_MEMBERSHIP_UNKNOWN`) requires a read-only key in a valid-but-no/insufficient-data state; none was available, and entering keys is a Claude-prohibited action regardless. Property remains **code-proven** (mutation M103 RED; unconditional `<Link>` escape at `ErrorEnvelope:1609`). Still owed: a human paints it once in a real browser (or a seeded e2e — the PR #108 follow-up).
- **Cosmetic (140.5 verifier/reviewer non-blockers, guard-hygiene):** `SEAMPROSE-01..08` IDs are not in `.planning/REQUIREMENTS.md` (inserted-phase convention, same as SEAMRIM/140.4 — all eight accounted for across the 8 plans); the contracts-registry batch label calls `seam-venue-vocabulary` `SEAMPROSE-05` while plan-02 frontmatter lists `-03/-07` (label drift, no functional effect).

### v1.16 ship findings (per-phase PR landing, 2026-07-30)

- **Cross-file test-isolation flake (non-blocking; product is correct).** Full-suite tip run (Node 25 local) surfaced **1 failed / 10264 passed**: `MultiKeyConnectStep.test.tsx > [WIZ-02] State B rehydration (back-nav) > …resubmits secretlessly via set-members`. In isolation the file is **44/44 green**, so it's a leaked mock from an earlier-running file (`set-members` throws `TypeError: Cannot read properties of undefined (reading 'apiKeyId')`, so the mock is never called). **Not a product defect.** It's order/shard-sensitive: CI shards passed on PR2/PR4, `frontend-test (1)` reddened on PR3. Fix the leak when it actually reddens a shard (likely a `vi.stubGlobal`/`vi.mock` not restored — use `vi.spyOn` + `restoreAllMocks`, cf. `reference_ci_node22_vs_local_node25`). The polluter is **outside** `src/app/(dashboard)/strategies/new/wizard/` (that dir is 392/392 together).
- **⚠️ CORRECTED root cause — the `python` red was NOT a straddle; it was a fastapi 0.139 harness incompatibility (FIXED, commit `b3686767`).** `test_validate_key_venue_transient.py` failed all 14 venue-transient cases in CI ("no `/api/validate-key`/`/api/verify-strategy` route on `main.app`") on EVERY cut, and it did NOT self-resolve at the tip — my earlier "23/23 at the tip" was a false read from running the file **in isolation on a local fastapi 0.135.1** (flat routes). Real cause: fastapi **0.139.0** (deps bump #592) made `include_router()` lazy — multi-route sub-routers become a single `_IncludedRouter` placeholder in `app.routes` (routing still works; TestClient reaches every endpoint), so the harness' FLAT `main.app.routes` scan missed the exchange/portfolio routes. Reproduced authoritatively under the exact CI env (Python 3.12.13, fastapi 0.139.0, starlette 0.46.2 via a `uv` venv). Fix descends through `_IncludedRouter.original_router` (correct on both the pre-0.139 flat and 0.139+ lazy shapes). **Consequence to note honestly:** PR2–PR5 were merged on the belief this was a self-resolving straddle — it was not, so `main`'s `python` CI (and thus the Railway worker deploy, which gates on green CI) stayed red from PR2 until this fix. `sql-tests` DID straddle (red 140.1–140.3, green from 140.4).
- **Genuinely separate, still-open: the `MultiKeyConnectStep` WIZ-02 frontend test-isolation flake** (44/44 in isolation, order/shard-sensitive) — did NOT hit PR6's `frontend-test` shard; left as tracked test-hygiene, fix if it reddens a future shard.
- **✅ RESOLVED — `e2e-seeded` red on `main` after the v1.16 ship (`discovery-hide-examples-default.spec.ts:122`, DISCO-05).** NOT a product regression: the spec waited for a "No strategies" empty-state row, silently assuming the `crypto-sma` category held zero non-example published rows — false in the shared test DB (`qmnijlgmdhviwzwfyzlc`), which accumulates other specs' seed data. Fixed (PR #654, merge `4f45dcab`) by gating on the "Hide examples" checkbox reaching `checked=true` (bound `checked={!showExamples}`, flips in the same render that applies the `is_example` filter) instead of a global empty-state, then asserting zero `SEED_NAMES` (polled). Verified: e2e-seeded PASSED against the live polluted DB. ⭐Lesson: e2e specs on the shared DB must assert their OWN seed invariant, never a global DB state. See memory `project_e2e_seeded_shared_db_pollution_global_emptystate`.

### v1.16 carried-forward residuals — 140.3 / 140.4 `gaps_found` (added 2026-07-30)

Both phases SHIPPED to main (PR #651 / #652) with their VERIFICATION marked `gaps_found`; the named residuals below were accepted as tracked tech-debt (per the founder blast-radius bar). **Two are user-facing** and are candidates to fold into a 140.3/140.4 gap-closure pass before or alongside Phase 141 — founder decision owed at 141 kickoff.

- **✅ RESOLVED 2026-07-31 — SEAMUX-03 typed `{code}` envelope.** Closed via gap series G4–G9 (branch `feat/v1.16-141-jobs-rate-retry`). Class-map found **10** bare routes, not the 9 the VERIFICATION named — it missed `admin/strategy-review` (instance-not-class). All 16 seam-importing routes now carry a `code:` on every reachable route-emitted arm (csv-validate was already wire-coded via `csvErrorBody` — audit-only). Opus verifier PASSED: 817/817 tests, RED-on-neuter confirmed on 4 routes, `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. **Remaining non-blocking residual:** 2 `rateLimitDenyJson` deny bodies stay codeless — `verify-strategy` (route.ts:71) and `scenario/optimize` (route.ts:163) — because SEAMRIM-05 tests pin their exact codeless bodies; it's the rate-limiter boundary (our throttle / Upstash-misconfig, NOT the analytics seam), low blast radius (teaser has no discriminating client; scenario's 429 is a pre-existing no-Retry-After contract). One-line follow-up if ever wanted: give them `throttledBody`/`misconfiguredBody` codes + update the SEAMRIM-05 pins. Also still open (out of this gap's scope): the poll-disjointness pin (test-hygiene) and the SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual — 140.3-VERIFICATION.md overall stays `gaps_found` for those two.
- **✅ RESOLVED (was flagged user-facing) — SEAM_MISCONFIGURED→UNKNOWN on the two wizard clients** (140.4). Re-verified against current code **2026-07-31**: the translate-first hop IS present — `ConnectKeyStep.tsx:496` and `MultiKeyConnectStep.tsx:829` both call `recogniseSeamErrorCode(seamErrorCode(data))` before the `KNOWN_*_CODES` membership check, and the docblocks (`ConnectKeyStep.tsx:220-243`) document `SEAM_MISCONFIGURED` handling via the translation. The 140.4-VERIFICATION.md gap was **stale** (fix landed after it was written). No action owed.
- **Test-hygiene (non-blocking) — 140.3 poll-disjointness pin is blind to `wizardFetch`.** `src/lib/seam-poll-disjointness.pin.test.ts` detects seam calls via `/\bfetch\s*\(/`, but `SyncPreviewStep.tsx` routes every call through `wizardFetch(` (`src/lib/wizard/wizard-correlation.ts:58`); the pin returns identical predicates on HEAD and on a retry-storm mutant. Owed: widen the pin to the `wizardFetch` wrapper.
- **Doc-hygiene (non-blocking) — 140.4 `analytics-client` scrub-test ledger row owed.** `140.4-VALIDATION.md:162` asserts "There is no guard to falsify" for the thrown-twin scrub, but dropping `scrubSeamString` at `analytics-client.ts:548` reddens a named test (`analytics-client.test.ts:1959`). Owed: an `Mxx` ledger row recording the observed RED, or an amended entry saying the guard is instance-scoped rather than absent.

---

## ⚪ DON'T FIX — cosmetic, stale, superseded, speculative, or unsound

- **"Do NOT implement" landmines (keep documented, do not touch):** bridge-scoring precompute;
  optimizer per-candidate `pd.concat` rewrite; `position_reconstruction` OFFSET→keyset /
  page-size raise (data-loss); `funding_fees.raw_data` JSONB retention delete (corrupts funding
  P&L).
- **Cosmetic / a11y (batch only if touching the file):** focus-ring clipping under
  `overflow-x-auto` (WCAG 2.4.7); `ResponsiveTable` migration of bare tables; STRATEGY_PALETTE
  colorblind/WCAG audit; correlation-heatmap palette; EquityChart polish (baseline line,
  legend, period buttons, current-return summary, stale timestamp); wizard mobile responsive;
  eval-dashboard empty-state copy.
- **Speculative product/demo ideas:** Moments 1–3 narrative cards, demo-persona scaffolding,
  custom benchmark, ML/collaborative optimizer, white-label portal, orgs/teams, dark mode,
  realtime WebSocket refresh.
- **Stale / superseded / in-prod-without-issue:** DOGFOODING Deribit reconstruction (subsumed
  by v1.11 STITCH); tech-debt Round-1 (superseded by Round-2); the 13-week-old UAT handoff
  backfill; ADVERSARIAL EquityChart notes; Round-1 LOW backlog (`getPercentiles` O(n²),
  `formatCurrency` sub-$1, native `alert()`/`confirm()`, inline SVG icons); teaser-series
  persistence + 106 janitor DDL (no active reader/trigger).
- **Safe as-is:** admin dual-gate (email vs `is_admin`) — safe while single-admin; Scenario
  coverage-window ADR open decisions (recompute-on-open / 0-fill gaps / renorm) — shipped
  defaults stand, revisit only if the sharing model changes.
- **No forcing function:** FastAPI / pandas / numpy version lag — upgrade only when a feature
  or advisory blocks.
