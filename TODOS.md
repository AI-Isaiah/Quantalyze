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

1. **`/api/alert-digest` cron dead** — vercel.json crons it daily (`0 9 * * *`) but the
   route only exports `POST` → HTTP 405 every tick; alert digest never sends. *Verified
   live 2026-07-23.* Fix: `export const GET = POST;` (or a GET handler).
2. **`RESEND_API_KEY` unset in Vercel prod** — founder-LP report cron + all transactional
   email are dead (code soft-skips, only Sentry fires). **Founder action:** set the key in
   Vercel prod. Do before the first warned founder month.
3. **Deribit / Zavara mandate reconciliation (go-live).** Performance reconstructs from the
   API alone (green: cum 62.66% / maxDD −4.13%). The reported capital **4M/10M/1M/2M is
   custodied at Matrixport (keys 1&2) / LiquidityTech (key3), NOT in the Deribit keys** —
   the accounts hold only a $150–750K working-margin slice. To close end-to-end: obtain a
   read-only Matrixport / LiquidityTech statement or key. **Founder action.** Zavara live
   *activation* (write the proven reconciliation config to a `strategies` row) also pending
   a founder trigger + strategy id.
4. **sFOX / Nautilus manager-data go-live (v1.13 founder flags).** Pending founder ops:
   EGRESS / WORKER-01/03/04 / FACTSHEET / E2GT-01 / FLIP / GOLIVE. **Reframe:** manager
   data = Nautilus DD API (`api.nautilus.finance`, x-api-key), not sFOX direct — the "sFOX
   key" was a Nautilus key. Enable path = set `NEXT_PUBLIC_SFOX_ENABLED` + `SFOX_ENABLED`
   in Vercel + redeploy main (build-time flag); IP-whitelist the 3 worker egress IPs
   {208.77.244.242, 152.55.184.240/.241} with Nautilus (7-day access, email all 3).
   **Founder decision:** sFOX-venue vs Nautilus-manager path; actual vs adjusted NAV.
5. **Land v1.14 Smoothed-MTM milestone.** Code-complete on `feat/phase-83-smoothed-mtm`,
   dark behind kill-switch (`SMOOTHED_MTM_ENABLED` + `NEXT_PUBLIC_SMOOTHED_MTM_ENABLED`,
   both default OFF). Do: version + CHANGELOG bump → PR → merge. Live acceptance (Phoenix
   key) stays deferred. ⚠️ landing risk documented: a structural smoothed mark-hole fails
   the WHOLE job — that's why it ships dark.

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
- **npm advisories: 3 HIGH + 8 MODERATE** (13 stacked Next.js, on auth/proxy surface); nightly
  gate only alarms on CRITICAL.
- **CSP uses `unsafe-inline`/`unsafe-eval`** — move to nonce-based CSP.
- **Signup allows 6-char passwords** — `minLength={6}` client-only; server-side Supabase policy
  unverified/undocumented.
- **VCR cassette over-redaction** — misses token/hmac/digest/nonce (and over-matches
  signal/signedAt/pubkey); replace with per-broker allowlist.
- **ccxt tracebacks not secret-scrubbed** (`exc_info=True`) — an API key could land in Railway
  logs. Add a `redact_secrets` util.
- **`alert-digest` CRON_SECRET compare is non-constant-time** — use the existing
  `timingSafeCompare`.
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
- **No `docs/architecture/` ADRs** — every decision is implicit in code; actively-inconsistent
  mechanisms to codify + consolidate: multiple auth wrappers, multiple cron mechanisms
  (vercel.json vs `pg_cron`+`pg_net`), multiple admin checks. (17 existing decisions to
  document + 5 open questions per the 2026-04 architecture audit.)

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
