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
   **Widened 2026-07-31 (phase 141.1-08):** the flag-monitor error-rate alert now also
   depends on this key. `sendErrorRateAlert` only emails when `resend && founderEmail` are
   truthy; otherwise it returns `action: "alerted"`, logs, and sends nothing — founder-facing
   silence one layer *below* the numerator 141.1-08 just repaired. Test `I-T6` pins the
   soft-skip as intended code behaviour, but the operational gap is unverified. **Founder
   action:** confirm `RESEND_API_KEY` *and* `FOUNDER_LP_REPORT_TO` in Vercel prod before
   treating this alert as live.
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
| **141 SEAM (retry)** | **FULL — the deepest of the milestone** | Retry means **double-executing side effects**. Its own SC3 pins that a retried `teaser` mints duplicate `strategy_verifications` rows / `public_token`s / leads. ⚠️ **Mandatory extra:** 141 converts `recoverable` from a *render hint* into an **automated retry input** — TS-35's W-4 rider says the `unknown ⇒ true` polarity **must be RE-DERIVED** at that moment, because the harm asymmetry that justifies `true` does not survive the change of consumer. → **✅ DISCHARGED 2026-07-31 (141.1-09), and the re-derivation is that the PREMISE IS FALSE.** Re-traced at HEAD: `recoverable` appears **zero times** in `src/lib/resilient-fetch.ts`. The retry loop branches on `verdict.counts` (from `seamBreakerVerdict`) and on `isDeadlineError`; *whether* a call may retry at all is the required `retriesOverride` argument, fed from the committed audit in `seam-retry-registry.ts`. `recoverable` stayed exactly what it was — an envelope field the clients emit for the UI. It never became a retry input, so the harm asymmetry never changed consumer and the `unknown ⇒ true` polarity needs no re-derivation. **That finding IS the discharge**; the rider was written from a plausible forecast of 141's shape, and 141 took a different one (a registry gate, not a flag read). |
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

### MT5 wizard — founder-observed on live UI (added 2026-08-02) — ✅ BOTH DEFECTS CLOSED

> ⚠️ **Neither defect is open.** Kept as a record because the *shape* of the fix (a class fix, not
> the instance) and one **rejected** remedy are what future readers need. Do not re-open either
> item; the residual scope lives in `DEF-142.2-02` below (the 9 out-of-scope emitting sites).
> ⛔ **Closing these means the MT5 connect flow is REACHABLE and its rejections are HONEST. It does
> NOT mean MT5's rendered numbers are correct** — that is Phase 142.3's gate (D-17).

- **MT5 connect failed with copy that named the wrong exchanges.** Submitting the MT5 form
  (login / investor password / broker server, all filled) rendered *"This does not look like a
  valid API key for the selected exchange… Binance secrets are 64 hex characters; OKX and Bybit
  use different formats"* with `code: KEY_INVALID_FORMAT`. Two defects were stacked, both real:
  1. ✅ **CLOSED — it WAS the client-on/server-off half-state, and it was an env fix.**
     `create-with-key/route.ts:147` returned exactly this code when `isMt5EnabledServer()` was
     false, and that gate is strict `MT5_ENABLED === "true"` on the **Vercel/Next server** — a
     *different* variable from the worker's `MT5_ENABLED` and from `NEXT_PUBLIC_MT5_ENABLED`
     (which is what renders the MT5 card the founder clicked). **Resolved 2026-08-03 by MT5-01:**
     the server-side flag was set in Vercel prod and the app redeployed, verified by the
     `/security` mt5-readonly curl. No code was written for it — it was never a code defect.
  2. ✅ **CLOSED as a CLASS by Phase 142.2 plan 07 (MT5-04), not as the instance.** The single
     `KEY_INVALID_FORMAT` bucket was split across **24 emitting sites (12 + 12)** in
     `create-with-key/route.ts` and `composite/add-key/route.ts` into four honest codes
     (`KEY_MISSING_REQUIRED_FIELD`, `KEY_UNSUPPORTED_VENUE`, `KEY_VENUE_NOT_ENABLED`,
     `KEY_INPUT_TOO_LONG`); `KEY_INVALID_FORMAT` now survives on exactly one genuine format guard
     per route and its copy no longer claims a browser-side check that never ran. Guards, HTTP
     statuses and `error` strings are byte-identical at every site — only the `code:` literal
     moved. `wizardErrors.invariant.test.ts` reddens if a future code is emitted without landing
     in all three registries. ⚠️ Fixing the *class* was deliberate: MT5-01 had already made the
     founder's own failing arm unreachable, so an instance fix would have repaired a line that
     can no longer fire.
     ⛔ **The "surface the server's `error` string" half was REJECTED by founder decision D-05 —
     copy-by-code only.** Do not re-open it as an unfinished half of this item. The wizard renders
     copy keyed on the code and deliberately renders no server-supplied string.

---

## 🟡 FIX MID-TERM

### Dependency pass — the 9 open dependabot PRs (booked 2026-08-05, founder call)
- **One campaign, NOT piecemeal merges.** All 9 dependabot PRs are red — and NOT only the
  TEST-DB infra flake: #657 (npm minor-patch group, 25 updates) genuinely fails
  `frontend-build`/`frontend-lint`/`contracts`/`deps-cache`. The pile hides real majors:
  typescript 6→7 (#614), jsdom 30 (#646), jest-dom 7 (#645), actions/setup-node+python+checkout
  majors (#626/#627/#643), supabase/setup-cli 3 (#612), plus grouped pip (#658) and npm (#657).
  Branches are 1–3 weeks stale vs main.
- **Order:** rebase + land the two GROUPS first (pip, then npm — bisect the npm group's build
  break, it may be one member); then majors ONE at a time with a full local suite + typecheck
  each (CI's python/e2e-seeded jobs can't be trusted as the only gate while the shared-TEST-DB
  flake persists). actions/* majors need a workflow-syntax review, not just green CI.
- **When:** after v1.17 phases or in a maintenance window — never mid-phase.
- None of the 9 touch the banned-packages list (checked 2026-08-05).
- Related: #606 (nightly npm-audit p1) is a DEV-ONLY chain — all 4 highs via `@lhci/cli` →
  old `uuid`; not fixed by the minor-patch group; needs an @lhci/cli bump or override in this
  same pass. #616 (stale analytics deploy) is NOT a deps issue — it's the Phase 144 TEST-DB
  flake keeping main CI red so Railway skips deploys; currently harmless (no analytics-service
  changes in the undeployed delta).

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
- 🔁 **RECURS DAILY 05:30 UTC — nothing reaps stale `pending` compute_jobs on the TEST
  project, and a full claim queue starves every live claim test** (diagnosed 2026-08-03
  while landing v0.52.0.0; cleaned by hand, NOT fixed).
  Chain: TEST holds ~1,900 `api_keys` (1,437 older than 7 days — fixture rows no test
  cleans up) → the `derive-allocator-key-dailies` cron (`30 5 * * *`, jobid 9,
  `SELECT enqueue_derive_broker_dailies_for_allocator_keys()`) runs on TEST exactly as on
  prod and fans out ONE `derive_broker_dailies` job per key → 1,884 rows landed at
  `2026-08-02 05:30:00.236555+00` → nothing on TEST drains them.
  ⚠️ **The starvation is the part to understand, and it is not a flake.**
  `claim_compute_jobs_with_priority` ends `ORDER BY <priority rank>, next_attempt_at, id
  LIMIT p_batch_size`. A test seeding a fresh job gets `next_attempt_at = now()`, so it
  sorts BEHIND every stale row. `_claim_one` (`test_compute_jobs_fencing.py:692`) claims
  `p_batch_size=50` and returns only its own `want_job_id`, so with 989 stale rows ahead
  the seeded job sits at position ~990 and `_claim_one` returns `None` **every time**.
  10 tests fail identically (7 in `test_compute_jobs_fencing.py`, 3 in
  `test_drain_semantics.py`). It reddens `python` on ANY branch, including main — main's
  last green CI ran 05:01 on 2026-08-02, 29 minutes before the cron fired.
  **Retention coverage gap = the root cause**: `retention_compute_jobs_done` (jobid 4),
  `retention_compute_jobs_failed` (jobid 8, `failed_final`/`failed_retry`) and
  `retention_compute_jobs_orphaned_running` (jobid 11) exist — **there is no sweep for
  stale `pending`**, the one status an undrained enqueue cron produces.
  ➡️ **OWNER: Phase 144 (JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence)**
  for the retention half. Same table, same cron family (it already edits jobid 11), and two
  of its success criteria are this problem's shape: SC 1 (orphan → terminal `failed` so a
  poller sees a real outcome and the row survives for audit) and SC 3 (reconcile the
  TEST-DELETE / PROD-reset split into ONE behavior — the exact TEST-vs-PROD mechanism gap
  below).
  ⚙️ **It is WIRED, not just noted.** GSD never reads `TODOS.md` (zero references anywhere
  in `~/.claude/get-shit-done/`), and the planner's coverage audit checks only
  `REQUIREMENTS.md`, `RESEARCH.md`, the ROADMAP **goal** and `CONTEXT.md` decisions — a
  ROADMAP *Note* is NOT audited. So this was promoted to **`JOB-08`** in
  `.planning/REQUIREMENTS.md`, added to Phase 144's `Requirements:` line, and given **SC 4**
  on the phase. The audit iterates the phase's REQ-IDs and flags any not claimed by a plan,
  so 144 cannot be planned without JOB-08 being answered. Measure-first: "stale `pending`
  population is zero on prod" is a valid close.
  ⛔ Sweep it the 144 way — **terminal UPDATE, never DELETE**. A `DELETE` of stale `pending`
  shipped under `supabase/migrations/**` auto-applies to PRODUCTION on merge and destroys
  real queued work; transitioning a long-unclaimable row to terminal `failed` loses nothing
  and makes the failure visible, which is what 144 exists to do. Size the threshold, not the
  cadence, to protect live jobs (the WORKER-04 2h→4h lesson).
  Preferred fix (test-side, no prod blast radius, and it encodes the invariant the recorded
  lesson already asks for — *assert your OWN seed, never global empty-state*): make the
  live claim tests independent of queue depth rather than assuming an empty queue. Seeding
  at `priority: 'high'` puts the seed ahead of an all-`normal` backlog and survives any
  depth. ⚠️ Check first that no test in scope is itself asserting priority ordering or
  low-priority claim behaviour — `v_high_pending` gates low-priority rows out entirely once
  any high row is pending, so a blanket change is not safe.
  Second, independent fix worth doing: TEST `api_keys` grow without bound (1,900 and
  climbing). Fewer fixture keys = a smaller daily fan-out.
- **CI speed/flake (founder 2026-08-05, watched python at 20min/12%) — 4TH MECHANISM FOUND: a WEDGED PostgREST pool.** All-day 504s on TEST (every CI cluster: 07:45, ~11:00, 18:0x, 19:2x) were PGRST003 while Postgres sat at 14/60 connections nearly idle and the same DELETE ran instantly via direct SQL — PostgREST's own pool slots were leaked/wedged after the morning's 2,144-job backlog connection storm, and the state persists until PostgREST's connections are recycled. REMEDY (proven 2026-08-05): `select pg_terminate_backend(pid) from pg_stat_activity where application_name='postgrest' and backend_type='client backend'` → PostgREST rebuilds the pool → instant 200s. Contributing causes booked: python + e2e-seeded run CONCURRENTLY (workflow `needs:` sequencing fix); daily backlog (purged 2,144 `derive-dailies-%` pending, cron untouched). Real fix (Phase 144, owner): per-run isolated DB. Also: e2e-seeded's seed should FAIL FAST with a "PostgREST wedged?" hint on PGRST003 rather than burning the run.
- **Workflow `needs:` sequencing fix** — `python` + `e2e-seeded` run CONCURRENTLY against the one shared TEST DB (a contributing cause booked under the wedged-PostgREST 4th mechanism above); sequence them via `needs:` in `.github/workflows/ci.yml` so the two DB-heavy jobs never overlap.
- 44 live-DB vitest files + ~112 python tests are green-skipped in CI while migrations
  auto-apply to prod.
- pytest 80% gate measures only `services/` (routers/ ~7.8k LOC + `main_worker.py` uncovered).
- Shared test-DB sql/e2e race (fence flake); Railway analytics deploys skip silently on red
  main CI (verify `commitHash` + `/health`); `repro-key-flow.sh` Layer-A leak gate is a CI
  no-op; `cassette-refresh.yml` failed 17/17 with no alerting.
- 20 of 35 Playwright specs wired to no workflow; migrations auto-apply to prod but not the
  test project; generated DB types have no regen/drift gate.
- **`analytics-service/tests/` is entirely untyped — 5,439 `mypy --strict` errors across 182 of
  213 test files** (MEASURED 2026-08-02 from Phase 142; `test_main_worker.py` alone = 59, which
  is typical at ~30/file, NOT an outlier). ⚠️ **This is CONFORMANCE, not drift**: `ci.yml:1130`
  states *"tests/ stays untyped by design"* and the gate is deliberately
  `mypy --strict --follow-imports=silent services/ routers/ models/`. So the open question is a
  **policy** one — should the staged B-mypy program (ingestion → `services/` part g →
  `routers/` part h → `models/` part i) get a part j for `tests/`? — not a bug to fix.
  **No owning phase, and deliberately not given one:** it belongs to none of 143/144/145 (JOB —
  job-state integrity) or 146 (RATE), and it does NOT justify a Phase 147 inside v1.16 — a
  5,439-error program is milestone-scale and orthogonal to "Production Resilience & Reliability"
  money-path plumbing. Route to a future milestone as B-mypy part j, or close as WON'T-FIX if
  the untyped-tests posture is reaffirmed. Surfaced because a Phase 142 executor ran
  `mypy --strict` on a path the gate excludes; **zero errors fell in Phase 142's added ranges.**
- **All 16 Phase 142 review/verification items are OWNED BY PHASE 142.1** — not tracked here.
  Full text with per-item failure scenarios: `.planning/STATE.md` § "Phase 142.1 scope".
  Raised by three independent passes (high-effort workflow review, blind `gsd-code-reviewer`,
  `gsd-verifier`). Seven are test-quality/doc items that would normally live here under the
  stopping rule; they were pulled into 142.1 on 2026-08-02 because the phase existed anyway.
  ⚠️ **If 142.1 is descoped or cut, re-file those seven here** — they have no other owner.
  ✅ **RESOLVED in v0.52.0.0 (2026-08-03)** — the one item that was a hard-red CI gate
  (`scripts/dump-sql-functions.ts --check` exiting 1 at `sql-function-snapshot.yml:84`, because
  `supabase/schema/functions/` had not been regenerated after migration `20260802120000`) was
  fixed twice on this branch: commit `fea74933` for `20260802120000` and `400070c3` after the
  `20260803120000` trigger migration. `npm run schema:functions:check` now reports the snapshot
  current (105 functions). Phase 142.1 shipped, so the "re-file those seven here" contingency
  below did not fire.
  The narrow real risk worth separating out, if anyone revisits this: an untyped fixture/double
  can drift from the real contract it stands in for — but the fix for that is targeted
  contract-pinning (already the repo's practice), not blanket typing.

### UX / product polish (founder-requested)
- **Header "+ Allocation" lacks a path-to-existing-strategy affordance** (deferred 2026-08-06 at
  Phase-150 plan-check rev-2): the Allocations header button offers no route to allocate an
  already-onboarded strategy; Phase 150's arm-2 "Go to My Strategies →" empty-state link is the
  interim mitigation. A full affordance needs its own UI-SPEC surface before build. See
  150-CONTEXT.md Deferred Ideas.

- **MT5 "Broker server" should not be a masked field, and should be searchable.**
  `ConnectKeyStep.tsx:696` renders the passphrase-slot input as
  `type={showSecret ? "text" : "password"}`, which is right for an OKX passphrase but wrong for
  MT5 — a broker server name is not a secret, and masking it makes the "copy it exactly as it
  appears in your terminal" instruction hard to satisfy (you cannot proofread what you typed).
  Two parts: (a) render this slot as plain text when the venue's passphrase slot is
  non-secret — needs a per-exchange flag next to the existing `passphraseLabel` /
  `passphrasePlaceholder` / `passphraseHelper` overrides, not a blanket change, since OKX must
  stay masked; (b) turn it into a typeahead — user types a fragment, we scan available MT5
  servers matching it and present a dropdown. **Open question for (b):** where the server list
  comes from — the MT5 gateway can enumerate what its terminal knows, but that is one terminal's
  view, not a global registry. Decide between gateway-enumerated, a curated broker→servers map,
  or free-text-with-suggestions before planning.

- **⭐ Expose an MCP server so a client can read their own stored data and analyse it with their own
  AI** (founder-requested 2026-08-03, during `/gsd-plan-phase 142.2`). Once we have ingested and
  derived a client's data, they should be able to point their own AI assistant at it — Claude
  Desktop, Claude Code, ChatGPT, whatever they use — and ask their own questions, rather than being
  limited to the analyses we chose to render. This is a **product** idea, not a refactor: it turns
  Quantalyze from "the dashboard we built" into "your data, queryable", and it is a natural fit for
  the backbone because **dailies are canonical** — one clean series to expose rather than N bespoke
  panels.
  **Not planned, not scoped, not scheduled** — captured so it is not lost. Before it can be planned,
  four things need a decision, and the first two are the ones that make it non-trivial:
  - **Auth.** MCP has no ambient session. This needs a per-user credential (scoped token / OAuth)
    with a revocation story, and it must be **read-only** and **owner-scoped** — the RLS discipline
    that governs every other read path applies here, and a SECURITY DEFINER shortcut would be a
    tenant-leak risk. See the `get_published_trust_signals` SECDEF precedent for how narrow such a
    surface has to be.
  - **What is exposed.** Dailies + derived metrics is the honest answer (canonical, already the
    single source). Raw `trades` is tempting and mostly wrong — it is a partly-redundant
    representation only some venues populate (see Phase 142.2 / D-16). Exposing it would re-teach
    clients the same wrong model the strategy gate just had to unlearn.
  - **Hosting shape.** Remote MCP endpoint on our infra vs. a small local server the client runs
    against an API token. Remote is far easier to support and revoke; local is easier to trust.
  - **Whether it is a paid tier.** Likely yes, but that is a CEO call, not an engineering one.
  ⚠️ Note the adjacent risk: an MCP surface is a **new public read boundary**. Every hardening
  lesson already paid for on the public factsheet path applies to it from day one, not later.

- **⚠️ `strategy_analytics (*)` splats EVERY analytics column to anon on two public paths.**
  Found 2026-08-03 by the migration review of Phase 142.2 plan 01, while checking whether a new
  column would be publicly readable. It would — but so is everything else, and that is the finding.
  - `src/lib/queries.ts:218` — `getStrategiesByCategory`, wrapped in `withPublishedOnly` → public
    discovery/browse by category.
  - `src/app/(dashboard)/compare/page.tsx:68` — same `withPublishedOnly` shape.
  Policy `analytics_read` (`20260405061912:35-44`) is `status = 'published' OR user_id = auth.uid()`
  **with no `TO` clause**, so it applies to `anon`. RLS is row-level and cannot hide a column, so the
  `(*)` embed hands an anonymous reader every column on the row for any published strategy —
  including `daily_returns`, `metrics_json` and `data_quality_flags`.
  **The fix already exists in the same file and is half-applied:** `queries.ts:410` and `:448` use
  the curated `PUBLIC_ANALYTICS_COLUMNS` (`:284`), and the comment at `:700` explicitly says to
  replace `select("*, strategy_analytics (*)")` with explicit column lists. These two sites were
  missed. ⚠️ Not a drop-in edit — consumers are typed (`StrategyWithAnalytics`) and browse/compare
  must be re-checked against the narrowed projection, so it needs its own change with its own tests.
  ⛔ **Do NOT "fix" this with a column-level `REVOKE` on `anon`.** PostgREST errors on a `(*)` embed
  when the role lacks a column, so a REVOKE would take **public browse down** until the splats are
  narrowed first. Narrow the projection, then consider grants — in that order.
  Phase 142.2 deliberately did NOT special-case its own new `series_completeness` column here: it is
  an enum carrying no magnitude, and protecting one column while the splat stands would be machinery
  that secures nothing.

### Tech-debt / maintainability (opportunistic, don't force)
- **149 review IN-01:** `MyStrategiesSection.tsx` comment claims namespaced prefs persistence, but with no `userId` the prefs hook is a persistence no-op on that surface — fix the comment (or pass userId if prefs are wanted there).
- **149 review IN-02:** `getOwnRowPercentiles` fully computes `publishedMap` only for its key-count; name the future consumer or reduce to a count.
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

- **✅ CLOSED 2026-08-01 by phase 141.2 plan 01 (findings 10 + 11) — after being RE-OPENED the
  same day.** Both halves are fixed and both were observed to fail before they were:
  - **Half 1 (arming).** `recordSeamFailure`'s trip path now decides its write from the RAW
    store value's presence, not from the decode, so a corrupt-but-present value is DISPLACED by
    the existing `SET … GET` and the circuit arms with a truthful transition event. The absent
    key keeps the `nx` arm, so concurrent-trip idempotency is unchanged, and the displacement
    arm's ownership rule still refuses a racer that displaced a live lock. Zero extra store
    round trips, which the SC-4b headroom ceiling requires.
  - **Half 2 (the bound).** `decodeBreakerLock` gained a ONE-SIDED absolute plausibility bound:
    an expiry further into the future than the widest legitimate span is rejected.
    ⚠️ **State plainly what this does NOT close.** The PAST side is deliberately unbounded —
    `isBreakerOpen` must decode expired locks to announce the close, so a symmetric bound would
    delete the close event. And the bound rejects implausible values; it does not authenticate
    them. The store remains writable only by us.
  - **Evidence, not assertion.** Three new pins drive `recordSeamFailure`'s WRITE path with the
    corrupt value present (the half 141.1 never drove), plus a decoder case and a separate
    one-sidedness case. Both ledger mutations were applied to production source and observed
    RED, then restored GREEN. Repairing this also exposed a THIRD instance of the same shape:
    the A-25 production-wiring pin was seeded with a REVERSED pair, which decodes to `null`, so
    it had been satisfied by a refused `SET NX` rather than by the guard it is named for. Its
    fixture is now a real tombstone armed mid-flight, and it was shown to redden under its own
    mutation.
  - **Was it live?** A read-only probe of the production Upstash store on 2026-08-01 found all
    five breaker keys ABSENT, so no corrupt value was resident at that instant: this landed as
    hardening, not as incident remediation. The defect itself was live on every seam call for
    the whole period, and a probe is a point-in-time observation, not a history.
  - Advisory-gate language discipline: the new pins **would have caught** this regression at
    141.1; nothing in CI *did* stop it, because they did not exist.

  *The RE-OPENED write-up is kept below in full, unedited, because it is the record of what was
  believed when the defect was found:*

- **⛔ RE-OPENED 2026-08-01 — the 141.1-06 fix is a REGRESSION, and the discharge below was
  false. Owned by phase 141.2 (findings 10 + 11), TOP priority.** The xhigh review of 141.1
  found two defects in `f308b460` itself, and `git log -S "MAX_BREAKER_LOCK_SPAN_MS"` confirms
  that commit is the sole origin — this is ours, not pre-existing:
  1. **The breaker can now fail to arm at all.** A corrupt value that is still PRESENT in Redis
     decodes to `null` under the new span bound, which routes `recordSeamFailure`'s trip path
     into the `nx: true` branch — and `SET NX` cannot overwrite an existing key. So the write is
     refused, no lock is stored, and `emitBreakerTransition` never fires. **For that key's full
     TTL the circuit cannot open on any of the fifteen seam routes, silently.** Before
     `f308b460` the same value decoded to a lock and took the `get: true` overwrite branch,
     which armed correctly. Strictly worse than what it replaced.
  2. **The claim "a `Retry-After` of 1e17 can no longer be minted" is false.** The bound is
     span-only — it never compares either timestamp to `Date.now()` — so
     `open:100000000000000000:100000000000030000` has a legal 30 000 ms span, decodes fine, and
     still puts `Retry-After: 100000000000000` on the wire, including to the anonymous teaser.
     The reachable production variant is a clock-skewed writer telling every reader to retry in
     ~3 600 s instead of 30.
  The regression test cited below exercised only `isBreakerOpen`; it never drove
  `recordSeamFailure` with the corrupt value present, which is why it stayed green.
  *Original (now-false) discharge text kept for provenance:* "The prescribed fix landed exactly
  as written below: `decodeBreakerLock` now rejects a span that is `<= 0` or
  `> MAX_BREAKER_LOCK_SPAN_MS` … A `Retry-After` of 1e17 can no longer be minted."
  Original text kept for provenance: `src/lib/resilient-fetch.ts`, the `^open:(\d+):(\d+)$` regex: it accepts any digit
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
- **Citation/prose harness residuals (§3a–3f):** D/E/F self-relative citations (`line 55`, `(:1027)`) need a second file-scoped predicate; string-literal citations invisible to the comment-scoped census — ⚠️ **NARROWED 2026-07-31 (141.1-02):** `seam-retry-registry.ts` was appended to `SEAM_CITATION_SURFACE` (now 35 files) and given a registry-LOCAL guard that scans all 13 evidence strings and reds on any `file.ext:NN` coordinate, so the registry's own string literals are covered; the residual is now the **other 34 files'** string literals, still comment-scoped only; a marked-quotation-exclusion guard is unbuilt; two RESEARCH offset/count figures (§3.8 `+72`, WP-13 "3+1") are mis-shaped — re-read, don't inherit.
- **Type hazard (§4a):** `AnalyticsUpstreamError`'s positional params — same adjacent-same-typed-argument class as `mintTenantClaim`, more call sites; wants its own scoped plan, not a drive-by.
- **Harness/CI residuals (§5a–5g):** 17 `stripComments` copies unrewired (needs a third string-erasing mode); `ci.yml:1633` left narrow deliberately (subsumed by `spec-disabling.invariant.test.ts`); two PR #108 e2e follow-ups stay skipped; `handleRetrySync` reset is defence for the path 141 adds — ⚠️ **CORRECTED 2026-07-31 (141.1-09): no longer "unreachable today".** 141 shipped that path; it is live and reachable on the five retry-enabled budgets, so this reset is now active defence rather than anticipatory.
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

### v1.16 Phase-141 / 141.1 (SEAM / SEAMBACKOFF) — deferred items (added 2026-07-31)

**This section discharges G4** — the obligation that Phase 141 have a deferrals section at all, which every prior v1.16 phase had and 141 did not. All items below are **non-blocking** by the founder blast-radius bar (nothing here is user-facing or data-integrity); they are recorded so the canonical backlog owns them, not scheduled. Verdicts, one per 141 obligation — the other four are closed **in place** rather than restated here, so the original text stays where a reader will look for it:

- **G1** — TS-35 W-4 `recoverable` rider (annotated in the 141–146 review-depth table above): **DISCHARGED**. The re-derivation is that the rider's premise is false — `recoverable` never became a retry input.
- **G2** — LO-02 / TS-39 `decodeBreakerLock` unbounded span (annotated on its own row above): **DISCHARGED** in code at `f308b460`, exactly as prescribed.
- **G3** — the `handleRetrySync` "unreachable today" parenthetical (annotated in the 140.5 section above): **DISCHARGED** by correction — 141 shipped that path, so the statement is now the opposite of what it said.
- **G4** — Phase 141 has no deferrals section: **DISCHARGED** by this section's existence.
- **G5** — `141-REVIEW.md` untracked: **DISCHARGED** already, at `2e36016d`. **No action owed**; recorded only so the enumeration is complete.

**Bucket H — recorded, deliberately NOT fixed** (from `141-REVIEW-CONSOLIDATED.md`; each re-verified against HEAD on 2026-07-31 before being written here):

- **H1 — a seam retry double-consumes the PYTHON-side per-tenant limiter, during exactly the incidents it fires in.** The retry is a second HTTP request to the analytics service, so it burns a second token from *that* service's limiter: `/optimize-weights` is `20/minute` per tenant and `/process-key` is `100/hour` tenant / `30/hour` anon under a `500/hour` platform ceiling (values read from the routers, not inherited). The Vercel-side limiter is **not** doubled — it is checked once per user request, before the handler. Net user-visible risk: during upstream degradation a tenant can hit "rate limited" for a fault that is not theirs. Worth a recorded decision (accept, or exempt retries from the Python limiter); not a defect today.
- **H2 — the retry `continue`s past a counting-status `Response` without `res.body?.cancel()`.** Confirmed: there is no `body.cancel()` anywhere in `resilient-fetch.ts`. undici buffers the abandoned response body until the attempt's signal fires. Bounded by the per-attempt deadline, so it is memory churn rather than a leak.
- **H3 — `admittedAtMs` is captured ONCE, outside the retry loop.** Confirmed at HEAD (captured well above the `for (let attempt …)` header). Attempt 2's failure is therefore judged against a pre-loop admission instant and cannot re-arm a just-expired lock. **Know it; don't fix it** — the miss is fail-open, which is this module's doctrine per A-25, and the founder's stance on it is explicit.
- **H4 — `keys/sync` forwards the upstream status verbatim where the legacy contract promised `'syncing'`, and 200 where it promised 202.** Confirmed: the `WIZARD_DUPLICATE` branch emits `status: typeof upstream.status === "string" ? upstream.status : "syncing"`, so a `'draft'` upstream status reaches a caller documented to receive `'syncing'`. Nobody reads it today — no client branches on that field on this route.
- **H5 — the resync draft pre-check uses `.limit(1)` with no `ORDER BY`.** Confirmed in `process_key.py`. With ≥2 draft rows the row chosen is planner-dependent. Consider `ORDER BY created_at DESC` and bounding the read to the retry window. Note the pre-check's own comment says `.limit(1)` exists to keep `.maybe_single()` from raising on that rare two-draft residual — so this is a determinism nit, not a correctness hole.
- **H6 — the 10-param `_enqueue_compute_job_internal` still uses `SELECT id INTO STRICT` on the lost-race re-read; the 7-param overload was deliberately de-STRICT-ed (P3).** Confirmed in `20260716090000_retire_compute_analytics_kind_rpc_guard.sql`: all four lost-race branches of the 10-param body are `INTO STRICT`, while the 7-param body carries the P3 comment explaining why STRICT was removed. The header comment calling the 10-param "verbatim" from its ancestor is true of that ancestor and is exactly why it never inherited the fix. **Pre-existing, not 141.**
- **H7 — `H-0562` (multi-worker durability) had no ledger target.** It is cited as OPEN inside the registry's `match-recompute` NO-verdict evidence, but appeared nowhere in this file, so a reader asked to confirm "still OPEN" had nowhere to look. **This bullet is that target.** Substance: `match.py`'s `_get_recompute_lock` is process-local (an in-memory `dict[str, asyncio.Lock]`), NOT distributed, and there is no unique constraint on `match_batches` — so it bounds the single-process race but does not serialize across worker instances. Unproven ⇒ no-retry, which is why `match-recompute` is a NO.

**Deferred by decision (own phase, own soak):**

- **D-03 — server-side request cancellation in the analytics service.** A retry on any of the four heavy analytics budgets (`bridge` 15 s, `simulator` 15 s, `portfolio-optimizer` 15 s, `optimize-weights` 30 s) adds a **second concurrent full compute while attempt 1 is still burning Railway CPU**, because nothing on the FastAPI side awaits `request.is_disconnected()`. Accepted as a known consequence of 141 and recorded per-entry in `seam-retry-registry.ts` so it cannot be inherited silently; also written into `docs/runbooks/seam-breaker.md`, because during a degradation it is a live contributor to the CPU saturation rather than a red herring. Closing it is its own phase with its own soak.

**D-16 follow-ups** (the denominator/numerator repair itself LANDED in 141.1-08 — these are its residuals, not a re-booking).
⚠️ **Re-framed 2026-08-01: D-16's DENOMINATOR half no longer exists.** Phase 141.2 / D-02 deleted the distinct-`correlation_id` dedup outright (it was wire-steerable, silently truncated at PostgREST `max_rows`, and collapsed nothing on real traffic — 42/42 production rows carried distinct server-minted ids), replacing it with an attempt-grained server-side COUNT. The three residuals below are kept because **all three are about the NUMERATOR or the release record, not the dedup**; nothing here schedules work on deleted code. Read "D-16" in them as "the 141.1-08 flag-monitor repair", not as the dedup:

- **(i) The corrected two-cause diagnosis, recorded FORWARD.** The flag-monitor numerator had been structurally 0 since Phase 19. The 2026-05-27 region-URL fix (`8904b204`) addressed **one of two independent, separately-sufficient causes**; the second is that this repo writes `path` to Sentry `extra` (unindexed) and **never** to `tags`, so a `path:` filter matched nothing regardless of its value — and the value was wrong too (`/api/process-key` vs the FastAPI `/process-key`). ⛔ **Do NOT edit the historical `[0.24.x]` CHANGELOG entries** — a shipped changelog records what was believed at release time, and the partial diagnosis is itself the useful evidence. The corrected account lives in the `[0.51.0.0]` entry.
- **(ii) Post-repair recovered-retry visibility residual.** Now that the numerator *can* fire, a transient failure that fails then succeeds on attempt 2 emits no Sentry error event — so the repaired alert still under-counts degradation, in the direction of silence. Follow-up: a warning-level capture on retry exhaustion plus a numerator widening to match. (Note this is the *only* form in which the review's original "retries suppress the alert" premise is true; as originally stated it was moot, because the alert had never fired at all.)
- **(iii) Confirm the first real process-key event's `transaction` form.** The scoping term `transaction:/process-key` is **derived** from the FastAPI `APIRouter(prefix="/process-key")` plus its bare mount — not observed in the index (the 90-day probe saw no process-key-shaped transaction at all). When the first process-key-origin error is indexed, verify the SDK's actual transaction string (it may take the `POST /process-key` form) and correct the term. Until then the numerator is correctly scoped but **unproven**.

**Still-open carry-forwards from the phase's own `deferred-items.md`** (all four items;
02-B and 09-A were added here at phase verification, which found this list and that file
disagreed):

- **✅ DEF-141.1-02-A — DISCHARGED 2026-08-01 by phase 141.2 plan 02.** The `process_key.py` SCOPE BOUND comment was corrected in place (`71d5b3ab`): the zero-Python fence that blocked it in 141.1 was opened deliberately for this one comment-only edit, because leaving the Python side asserting the sequential class is CLOSED while the TypeScript registry's `resync` evidence asserts it is OPEN is the two-artifacts-disagree drift class 141.2 existed to end. No behaviour change. *Original write-up kept below for provenance:*
- **DEF-141.1-02-A (ORIGINAL, now discharged) — `process_key.py`'s SCOPE BOUND comment still over-claims the thing D-05 corrected.** Confirmed unchanged at HEAD: the comment says the resync draft pre-check "closes the SEQUENTIAL retry class only", i.e. that the sequential class IS closed. D-05 established it is not — the filter is `status='draft'`, and the worker's 30 s tick advances SV#1 out of `draft`, so when that transition lands inside the 15 s-timeout blip window the pre-check matches nothing and a SECOND draft SV row is inserted. The registry evidence for `resync` now states this correctly; **the Python comment still says the opposite**, so two artifacts disagree about one fact — the exact doc-drift class this phase existed to close, in the other direction. Unfixable inside 141.1: every plan that could reach it carried a zero-Python fence (including this one, whose files are docs and release artifacts). Comment-only fix, no behaviour change.
- **DEF-141.1-06-A — the counting arm's FALL-THROUGH exit is still unlogged.** 141.1-06 gave the arm's `continue` (retry) exit a voice, deliberately worded "retrying" so it can never be misread. The fall-through covers **two different operator facts** — the D-01 `Retry-After` fail-fast and a last-attempt surrender — and neither is logged, so in production they remain **mutually indistinguishable**. Not a regression (it was silent before too); left rather than half-done, because one sentence covering both would report neither, which is the over-claim class this phase existed to remove. Closing it needs two distinct sentences, and the fail-fast one arguably belongs with the D-01 surface. Recorded in the runbook as a known gap so on-call is not misled by the absence of a line.
- **DEF-141.1-02-B — `teaser`'s NO evidence overstates two of its three named writes.** It says each call writes a new `strategy_verifications` row "plus a NEW `public_token` and a NEW lead". Traced: the SV row is real; `public_token` is an UPDATE onto that **same** row, not a third write; the "lead" is a PostHog event (ADR-0023 §3), explicitly not a DB row — the route's own `@audit-skip` comment says so. Pre-existing text, outside the D-03…D-06 buckets 141.1-02 discharged, and the imprecision errs **conservative** (it overstates the write surface), so it cannot authorise a wrong retry. Verdict unaffected — `teaser` stays NO on the uncontested first item. Prose-only fix.
- **DEF-141.1-09-A — two runbooks are indexed nowhere.** `docs/runbooks/` holds 26 runbooks + README; `sfox-go-live.md` and `flipretry-derived-equity-go-live.md` appear in no index. Both are go-live procedures — the class most likely to be needed under time pressure by someone who does not know the filename — and the README presents itself as the entry point, so a reader who trusts it will not find them. Needs a category call (the README has no "Go-live" section), not just two rows. Documentation discoverability only, not user-facing.

### v1.16 Phase-141.2 (SEAMFIX) — known limitations, residuals and class censuses (added 2026-08-01)

141.2 closed the 13 verified findings of the 141.1 xhigh review. **"Closed per their dispositions", not "all 13 fixed in code":** twelve were remediated in code or prose; **finding 8 was DISPOSITIONED — accepted, documented, booked — and its mechanism is still live** (entry 2 below). The items here are the limitations and out-of-fence classes the phase deliberately did not fix; none is user-facing or data-integrity, so none clears the founder blast-radius bar. Advisory-gate language throughout: the new pins **would have caught** these regressions, nothing in CI *did* stop them.

1. **KNOWN LIMITATION (D-02) — the flag-monitor error rate is ATTEMPT-grained on both sides, so retries bias it DOWNWARD.** Deliberate, and the safe direction: the alternative that 141.1's D-16 reached for (dedup on `metadata->>correlation_id`) bought a fabricated denominator above PostgREST's `max_rows` and a denominator the wire could pin to 1 through the unauthenticated teaser route. Quieter-under-retry beats false pages plus attacker-chosen silence. A true PER-REQUEST rate needs a **server-minted request id that the retry reuses** — the client-side id cannot serve, because the Python handler re-mints any non-bare-UUID inbound value. That is a cross-seam contract change with its own blast radius, and it is the deferred work. Two further honest caveats already in the docblock, repeated here because they bound what the instrument can see at all: `429`/`401` attempts are refused ABOVE the audit write and produce no row, and the write is fire-and-forget so a lost row biases the rate UPWARD.
2. **FINDING 8 RESIDUAL — DISPOSITIONED, NOT REMEDIATED. The retry→limiter amplification is STILL LIVE.** A granted retry spends a second token of both `/process-key` limiters, including the platform-wide ceiling that is one shared bucket for every caller; draining it refuses the anonymous teaser and the CSV path, neither of which retries. The breaker structurally cannot contain it — `seamBreakerVerdict` classifies `429` caller-throttled and non-counting — and **no signal covers a ceiling drain at all**, because a 429 is refused above the audit write, so neither the breaker nor the flag-monitor denominator advances. **No limiter code was written and no constant moved.** What changed is exposure, not mechanism: post-D-01/D-03 the retry-eligible population is `onboard`-with-a-key only, and `resync` — just under half of all `/process-key` traffic ever recorded, per the 2026-08-01 production audit history — no longer retries, so the worst case applies to an order of magnitude less traffic. Recorded in the `retriesForFlow` docblock in `seam-retry-registry.ts`. *Re-raise if:* a new YES flow verdict lands, `resync` is re-granted, or `RetrySafeEntry.retries` widens past one. **Supersedes H1 above**, which named the same mechanism before it had been measured.
3. **D-01 FOLLOW-UP — a CLIENT-MINTED stable idempotency key.** 141.2 made `onboard`'s retry conditional on the key it already had (`retriesForFlow` refuses a retry when `context.wizard_session_id` is falsy, using `Boolean()` to byte-match the Python truthiness gate). The better end state is to make the antecedent unconditionally TRUE rather than conditionally checked — and it is the same key `resync` would need to earn its grant back. Rejected in-phase on blast radius: it changes the cross-seam contract and the `strategy_verifications` uniqueness semantics, which is more than a defect fix should carry. Needs its own decision, not an inference from the registry entry.
4. **CLASS — unbounded `.select()` on unbounded-growth tables (8 remaining sites).** 141.2 / D-02 closed the one instance the findings named (the flag-monitor denominator, proven truncating in production: `audit_log` held 7350 rows and an unbounded select returned exactly 1000 with HTTP 200 and `error: null`). The class census found 93 unbounded chains, of which these grow without bound: ⚠️ **`api/benchmark/btc` is the highest risk — ASC-ordered over one row per day forever, so past 1000 daily closes the BTC chart silently drops the NEWEST data and the series just ends**; then the two cron enqueue sweeps (`sync-funding`, `reconcile-strategies`, which would silently fund-sync/reconcile only the first 1000 strategies while reporting the truncated number as truth); then `allocator/scenario/commit`'s holdings recompute, the `queries.ts` discovery aggregates, and the marketing page's headline AUM sum. Distinct sub-shape, note only: `cron/cleanup-ack-tokens` caps its DELETE's RETURNING body, so the reported deletion COUNT is wrong, not the deletion. One entry, not eight, deliberately — the fix is the same three-way choice each time (COUNT / `.range()` pagination / an explicit `.limit()` that says so).
5. **CLASS — error-collapse-to-a-healthy-looking-default.** 141.2 / D-05 closed the flag-monitor instance (a failed denominator read returned literal `0`, which `handleZeroDenominator` then diagnosed as "no traffic OR the audit write is failing" — the wrong diagnosis, sending the operator at the Python audit path when the fault was the query). The strongest surviving sibling is `src/lib/observability.ts`'s `checkStuckNotifications`, which returns `{stuck: 0}` on a failed read: byte-identical failure mode, on a read documented for exactly the cron/admin-dashboard surfaces that would trust it, where `0` means BOTH "nothing is stuck" and "I could not tell". The repo's own rule (stated verbatim in `portfolio-exposure.ts` and `allocations/page.tsx`) is that an empty result and a query error are distinct states. A collapse is acceptable only when it fails in the safe direction AND the code says so AND the error escapes to Sentry — `api/benchmark/btc`'s empty-state degrade satisfies all three and is the precedent, not a defect; `checkStuckNotifications` satisfies none.
6. **FLAG-MONITOR — a failed denominator read pages NOBODY, and Vercel records the run as a success.** Found by the 141.2 final review round, not by the phase's own plans. `getDenominator`'s terminal arm returns `NextResponse.json({ok:false, reason:"denominator_read_failed"})` at the **default HTTP 200**, before both the streak increment and the streak reset, and sends no email. So a persistent Supabase read failure is now silent on every channel: no page, no streak, and a green cron run in the Vercel dashboard. The pre-141.2 code eventually sent a SEV-2 with the WRONG diagnosis; the remedy replaced a wrong page with no page, which is better for the operator who gets paged and worse for the one who never does. Below the founder bar (operator-facing, not user-facing, not data-integrity) — but the fix is small and has its own blast radius worth deciding deliberately: a non-200 status makes the cron run register as failed, which is the loud signal, at the cost of changing what the Vercel cron history means. *Re-raise if:* the monitor is ever relied on as the primary process-key alerting path.
7. **DEF-141.2-03-A — stale route coordinates inside a skipped test's comment.** `src/__tests__/audit-coverage.test.ts:962-964` cites three `flag-monitor/route.ts:NN` coordinates, one of them a "feature_flags upsert — kill-switch flip" site Phase 106 (Stage B) retired. Already stale before 141.2 and inside an `it.skip(...)` comment rather than an assertion, so nothing reds and plan 03's edits shifted the numbers further. Comment-only drift, below the bar. Booked here because `deferred-items.md` is a per-phase scratch file and this file is the one backlog.
8. **`Boolean()` does NOT byte-agree with Python's `bool()` for empty JSON collections — the docblock says it does.** Found by the ship red-team pass. `seam-retry-registry.ts` `retriesForFlow` gates on `Boolean(context?.wizard_session_id)` and its docblock claims "the same truthiness predicate the Python gate uses" (`process_key.py`'s `bool(body.context.get("wizard_session_id"))`). True for `null` / `undefined` / `""` / `0` / `false` — the empty-string case it explicitly names is genuinely correct. **False for `[]` and `{}`**: truthy in JS, falsy in Python. A context carrying `wizard_session_id: []` would grant the retry TS-side while Python falls to `… or str(uuid.uuid4())`, mints a fresh session per attempt, skips the duplicate pre-check, and inserts a second draft `strategy_verifications` row — the exact harm D-03 withdrew resync's grant over. **Unreachable at HEAD**, which is why it is logged and not fixed: `retriesForFlow` short-circuits to 0 for every flow but `onboard`, and `onboard`-through-`postProcessKey` has one producer (`finalize-wizard`), whose context is a hand-listed allowlist of validated scalars plus a `wizardSessionId` read off a uuid DB column. Fix when touched: `typeof context?.wizard_session_id === "string" && context.wizard_session_id.length > 0`. Founder call 2026-08-01: ship as-is, the surface is well tested. *Re-raise if:* a second `onboard` producer appears, or any context field stops being an allowlisted scalar.
9. **`hasContractualWait`'s docblock contradicts itself on the HTTP-date form.** `resilient-fetch.ts` states "A date-form wait is a contractual wait like any other and fails fast; there is no deliberate gap here to work around" two lines after correctly noting that no `Date` header yields null. `retry-after.ts` returns null when `Date` is absent, so a date-form 503 WITHOUT a `Date` header does not fail fast — it retries. Harmless in practice (HTTP/1.1 origins must send `Date`; our own emitter uses delta-seconds), but the gap is real and the sentence denies it. Prose-only, below the bar.
10. **The denominator's "attempt over attempt" caveats miss a third class.** `flag-monitor/route.ts` names attempts refused above the audit write (429/401) and lost fire-and-forget writes. A seam attempt failing at the TRANSPORT layer (deadline, refused connection) can produce a Sentry event with no audit row in the window — numerator up, denominator flat. Same safe direction as the lost-write caveat, but unnamed.
11. **`tests/integration/cron-flag-monitor.test.ts` is not a second falsifier for the denominator rewrite.** It gained a shape-distinguishing double and an `auditLogRows` option, but no test in the file passes `auditLogRows`, and none exercises a read error, `count: null`, or `count: NaN`. Under both denominator mutations the integration file stayed fully green — every failure came from the unit route test. The upgraded double SURVIVES the change rather than CHECKING it.

### v1.16 SEAM-group close-out — live-ops items still owed (added 2026-08-01)

Booked when the SEAM group (140 → 141.2) had its phase-close bookkeeping run in one
pass. Everything else from those eleven phases is now closed; these need a human with
live access, so they cannot be planned around.

1. **⚠️ FOUNDER/OPS OWED — Phase 140's only `human_verification` item, never dispositioned.** "Watch Sentry during the next real Railway degradation window: confirm `CIRCUIT_OPEN` 503 envelopes appear and that no cascade-500s occur in the same window." Expected: `breaker:railway` trips against the LIVE Upstash, seam callers receive 503 `CIRCUIT_OPEN` + `Retry-After`, and no route emits a raw 500. **Not closable from the repo** — there is no live Upstash in CI/local (20+ test files delete the env vars) and no controllable Railway failure injection; declared manual-only in `140-VALIDATION.md`. `140-VERIFICATION.md` therefore still reads `human_needed` for this one reason, and that is correct, not a defect. *Close it opportunistically the next time Railway degrades.*
2. **⏳ PR #656 is OPEN and unmerged** — `feat/v1.16-141-jobs-rate-retry`, 131 commits ahead of `origin/main`, MERGEABLE. Phases 141, 141.1 and 141.2 are all verified `passed` but unshipped. Founder call.
3. **The fourth 141.2 human item stays PARKED, by design.** "Capture a real Railway-edge 503 carrying an empty, zero or non-numeric `Retry-After`." Cannot be induced: the only contract-bound 503 emitter we own (`error_contract._validate`) raises on `retry_after <= 0` and structurally cannot emit one, and a local dev server sits behind no platform edge. The docblock's and runbook's "whether the platform edge can is unverified" sentences **stay as written** — that is the accurate state. Re-open only if such a trace is ever captured in the wild.
4. **✅ Discharged 2026-08-01 (recorded so the numbers are not re-probed):** the other three 141.2 production probes were run read-only against prod (`khslejtfbuezsmvmtsdn` + live Upstash). `audit_log` `entity_type='process_key'` → **42 rows, 42 distinct `correlation_id`, 0 carrying a `wizard:` prefix**; flow_type **resync 20 · csv 20 · onboard 2** (resync = 47.6%, the quoted "48%"). Unbounded `.select()` → **HTTP 200, `error: null`, exactly 1000 rows** against a 7351-row table, reproducing the silent `max_rows` truncation. All five breaker keys **ABSENT**. ⚠️ One correction owed if anyone re-reads it: the CHANGELOG quotes the table as **7350** rows; it measured **7351** — one row landed between the two reads. The claim is unaffected; the figure is stale by one.

### v1.16 Phase-142 (JOB) — deferred items (added 2026-08-02)

1. **BOTH TypeScript type files are stale on `strategy_analytics` by `computation_warned` + `metrics_json_by_basis`.** `grep -n "computation_warned\|metrics_json_by_basis" src/lib/types.ts src/lib/database.types.ts` returns **zero hits in either file**, while both columns are live in the DB and read by app code (`src/app/api/strategies/finalize-wizard/route.ts`, `src/app/factsheet/[id]/v2/page.tsx`). The last `strategy_analytics` column that actually threaded into `types.ts` was `volume_metrics`/`exposure_metrics` (migration `20260412125725`) — four months and two columns ago, so the interface reads as maintained when it is not. Phase 142 added **only** `computing_started_at` (plan 142-06: the `types.ts` line plus its compile-forced blast radius, 9 files total — `types.ts` + `src/lib/utils.ts` `EMPTY_ANALYTICS` + 7 test fixtures) and deliberately did NOT widen to the other two: that is scope containment, not an oversight, and it is recorded here so the next agent does not read the single addition as evidence the file is current. `database.types.ts` was left untouched entirely and has **no CI freshness gate** (`package.json` + `ci.yml` mention `database.types` nowhere), which is the reason the drift went four months unnoticed. Fix when either file is next touched; the honest fix is all three columns plus a gate, not a fourth one-off addition.
2. **`.claude/agents/migration-reviewer.md` invariant #14 contradicts the repo's actual `BEGIN`/`COMMIT` convention.** The reviewer doc forbids `BEGIN`/`COMMIT` in migrations; **150 of 231 migrations use them, including the repo tip**. Per Rule 11 (conformance over taste inside the codebase) and Rule 7 (pick one, don't blend), Phase 142 followed the repo and pre-documented the deviation in its own migration header so review would not re-litigate it — but that is a per-migration workaround, and every future migration author hits the same contradiction and pays the same cost. The doc is the artifact that is wrong. Fix = update invariant #14 to match the repo (and say what `ROLLBACK` outside `supabase/tests/` still means, which is the part that IS enforced). Documentation-only, no runtime surface.

### v1.16 Phase-142.1 — planning residuals (added 2026-08-02, at plan time — NOT execution findings)

Items 1–5 and 7 were raised by the `gsd-plan-checker` across three verification rounds on 142.1's
plans. **None of those clears the founder blast-radius bar** — all are documentation-rationale or
comment-coverage. Logged here so the next reader does not mistake their absence for oversight. W-1
and W-2 were folded into plan `142.1-05` before execution and are recorded as discharged.

⚠️ **Item 6 (`D-19`) is different in kind and the section heading does not cover it: it is an
EXECUTION finding, not a planning residual** — a real defect found by running the gate against TEST
on 2026-08-02, already fixed on this branch, with a live PROD residual that must be closed at merge.
Read it as such.

1. **⛔ `DEF-142.1-08` — D-08 was CUT from Phase 142.1, and must not be closed by bumping a
   literal.** The finding: `test_main_worker.py:1295`'s `assert len(TIMEOUT_PER_KIND) == 15`
   couples every future job-kind addition to the reaper suite, and the cheapest way to green it is
   to bump the literal WITHOUT the re-derivation the assertion message demands — the trip-wire
   trains the exact behaviour it exists to prevent. It was cut because **no derivation source
   exists for the proposed replacement**: `grep -rn "STRATEGY_SCOPED\|_SCOPED_KINDS\|ALLOCATOR_KINDS"`
   over `analytics-service/` returns **zero hits**, so there is no machine-readable
   strategy-scoped/allocator-scoped partition to assert against. Both remedies are bad — a
   hand-maintained `frozenset` beside `TIMEOUT_PER_KIND` **re-imports D-08's own complaint one
   level up**, and deriving from the `compute_jobs` enqueue surface (which kinds are ever enqueued
   with a non-NULL `p_strategy_id`) is a genuine derivation but materially larger than a
   remediation phase should carry. ⚠️ **There is also a live convention conflict:** the GSD
   VALIDATION template's Oracle Independence checklist requires *"Table/registry sizes are pinned
   to a **literal count**, not to `len(THE_TABLE)`"* — which is precisely the form D-08 argues
   against. That conflict deserves its own decision on the merits, not a drive-by change. ⛔ **Hard
   rule: never close this by bumping the literal to 16.** That is the exact behaviour the trip-wire
   exists to prevent, and it is why the item was raised. Confirmed unchanged at 142.1 execution time
   (`test_main_worker.py:1295` still asserts `len(TIMEOUT_PER_KIND) == 15`) — Phase 142.1
   deliberately implemented no part of D-08.
2. **W-3 — inverted arm D's determinism rests on an unpinned assumption.** The D-11 companion cron
   arm's `LIMIT 25` has no `ORDER BY`, so the inverted arm-D assertion is deterministic only while
   fewer than 25 foreign `(computing, NULL, no-active-job)` rows exist on the shared TEST project.
   Plan 142.1-05 requires the GATE-DETERMINISM NOTE in prose but — unlike plan 03's header
   assumption, which carries an acceptance grep — pins it with none. Add acceptance greps on both
   the migration side and the gate side when either is next touched.
3. **W-4 — `sql-tests` against TEST is expected RED for 142.1's waves 3–4.** Plan 05 inverts arm D
   to require the companion arm, but migration `20260803120000` is not applied to TEST until plan
   07 Task 1 (wave 5), because MCP is stripped from subagents. Unavoidable, and plan 07 already
   documents the false-positive verification state. The residual risk is only that a wave gate is
   misread as a defect — one line in the wave-3/4 SUMMARY templates would close it.
4. **W-5 — gate-file comments owned by no task.** In
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`: the file header (`:5`
   "Guards migration 20260802120000", `:111` "Run order"), the Part-2 arm summary at `:263`, and
   `:380`'s "arm D: the writer-bug skip rule". Plan 05 step 9 names only `:332-336` and `:390`.
   After 142.1 these comments describe a superseded migration and a superseded arm-D semantics.
   Comment rot only.
5. **W-6 — `142.1-RESEARCH.md` § "Architecture Patterns" still carries the superseded
   `BEFORE INSERT OR UPDATE` trigger sketch verbatim.** Every consuming plan carries an inline
   ⚠️ supersession note in `read_first`, and CONTEXT § D-18 Part 1 states the supersession — but
   the research document itself is never annotated, so a reader who opens it first gets the wrong
   shape. One banner line fixes it.
6. **⚠️ `D-19` — the reaper's `LIMIT`-25 bound is restored on THIS BRANCH ONLY; the PROD cron body
   still carries the unbounded shape until it merges.** Found by the first end-to-end run of
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` against TEST (phase 142.1
   plan 07 / D-16). Part 3 arm E: 26 seeded stranded rows, **zero** foreign competitors, one tick
   terminalized **26 of 26** — expected 25. Cause: both arms bound their batch through
   `WHERE strategy_id IN (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED)`; `FOR UPDATE` makes the subplan
   un-hashable, so the planner attaches it as the inner side of a nested-loop semi-join and
   **re-executes it once per outer row**, applying a fresh `LIMIT` each time — the cap is
   per-rescan, never global (measured on PostgreSQL 17.6). Fixed by
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql` (commit `2b8c016f`),
   which forces single evaluation of the bounded batch on **both** arms; verified on TEST before the
   migration was written (`failed=25`, `still_computing=1`, the 26th survives) and the gate re-ran
   green after. ⚠️ **A FROM-clause subquery form was ALSO measured and ALSO reaps 26 of 26** — the
   planner is equally free to nest-loop it, so forcing single evaluation is load-bearing, not
   stylistic; do not "simplify" it away. **Impact is a LOCK-DURATION and BLAST-RADIUS defect, NOT
   data corruption** — the rows are genuinely stranded (>16 h, no active job), but unbounded, one
   `*/15` tick against a backlog of N terminalizes all N in one statement and holds row locks on all
   N, on a table every live analytics write touches. **RESIDUAL / ACTION:** ⛔ the migration is
   applied to **TEST only** (stamped `20260802212852`). PROD's registered cron body is still the
   unbounded shape until `feat/v1.16-142-146-job-rate` merges to `main` and the auto-apply runs.
   **The merge-time PROD verification must re-confirm the deployed body carries the bound as TWO
   single-evaluation batches — one per arm — not just that the `LIMIT` token is present.** That
   token-presence check is exactly what every gate in phases 142 and 142.1 passed over. Class census
   at discovery: of the 8 registered cron jobs, only `reap_strategy_analytics_stuck_computing` puts
   a `LIMIT` inside an `IN (…)` subquery; the other seven carry no `LIMIT` at all — the class is
   closed at one member, so no sweep is owed.
   **✅ CLOSED 2026-08-03 (post-merge QA, PR #659 in `main`):** the merge-time PROD verification ran
   read-only against `khslejtfbuezsmvmtsdn` and the deployed `cron.job.command` carries the bound as
   required — NOT by token presence but by shape: the full body was read and eyeballed; each arm is a
   single-evaluation `WITH batch AS MATERIALIZED (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED) UPDATE …
   FROM batch`, the `AS MATERIALIZED` count is exactly 2, and no `IN (SELECT … LIMIT` shape remains.
   Job registered `*/15 * * * *`, `active=true`. Bonus: the deployed body includes the non-destructive
   clock-start companion arm for `(computing, NULL-stamp)` rows, which also closes 142-VERIFICATION
   Gap 3's deploy-ordering observability window. PROD stuck-`computing` census at check time: **0**.
7. **✅ Discharged at plan time (recorded so they are not re-raised): W-1 and W-2.** W-1: plans
   claimed SQL-gate Part 4b "stays falsifiable" after the D-18 retrofit; it does not — 4b is a
   **double-mutation** defence-in-depth assertion (trigger arm (a) and the bridge's own keep-arm
   each independently preserve the sentinel). W-2: after the retrofit Part 4a's
   `IF v_stamp IS NULL THEN RAISE` is satisfied by its own seed and can no longer fail. Both were
   over-claims of assertion strength — **the same failure class that produced this phase** (142's
   ledger was reported 11/11 Observed when 7 rows had never been run) — so both were corrected in
   `142.1-05-PLAN.md` rather than deferred, and the plan now forbids crediting either as the SC-2b
   observable in the D-16 evidence. SC-2b's single-mutation proof is Part 6/6a in plan 142.1-08.

8. **WR-01 — a D-19 self-verify guard that provably cannot fire (dead guard, NOT a hole).**
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:188` asserts
   `v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT'` to ban the un-hashable-subplan shape D-19 removed.
   `[^)]*` cannot cross a `)`, and BOTH arms carry `AND NOT EXISTS ( SELECT 1 … cj.status IN (…) )`
   between `IN (SELECT` and `LIMIT` — measured against the exact superseded body: **no match**. The
   bound is still genuinely guarded by the `v_mat <> 2` MATERIALIZED-count check immediately above
   it (that one fires, and fails closed on formatting drift), so this is redundancy, not exposure.
   ⚠️ **Deliberately NOT fixed in place:** `20260803130000` is already applied to TEST (stamped
   `20260802212852`), and editing an applied migration is itself a tracked invariant violation
   (migration-reviewer #11) — desyncing TEST's applied text from the file to repair a *redundant*
   guard is the worse trade. Close it in the NEXT forward-only migration that touches this job, or
   by asserting something that can actually fire (e.g. `FROM batch` occurring exactly twice).
   Danger if left unread: the guard's `RAISE` text is what the next engineer will read as proof the
   broken shape is banned. Found by migration review, 2026-08-03.

9. **WR-02 — the `awk`-range hazard recurred in the gate file, and a SUMMARY over-claims it closed.**
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:16-18` explains that its final
   part is named descriptively *because* its acceptance gate is an `awk '/Part 6/,0'` range. Plan
   `142.1-05` (a different wave) then mentioned that literal twice in the Part 4 header, so the range
   now starts at `:595` and sweeps Parts 4–6 instead of Part 6 alone. **The measured value is 0
   either way, so there is no false green** — the exposure is that `142.1-08-SUMMARY.md:304` records
   the hazard as closed when it is not. Fix: anchor the criterion on `^-- Part 6 --`, which matches
   exactly once. Worth reading as a pattern rather than a nit: this phase was bitten by `awk` range
   semantics **three separate times** (plans 05, 08, and here), always because prose *about* a gate
   sits inside that gate's blast radius. Found by code review, 2026-08-03.

10. **`sql-tests` is in no aggregator's `needs:`, so the reaper's only behavioural gate can vanish
    silently.** `.github/workflows/ci.yml`'s `frontend` aggregator gates branch protection on the
    `frontend-*` jobs; `sql-tests` is not among them and self-disables when
    `vars.E2E_TEST_DB_CONFIGURED` is unset. It is the ONLY gate that `EXECUTE`s the real deployed
    cron body — the one that caught D-19 after every static gate passed over it. Partial mitigation
    exists: `e2e-seeded`'s go-live check errors on a skip for trusted events and its message notes
    that the same variable also disables `sql-tests` — so a missing variable is loud, but a
    `sql-tests` job that is *present and failing* is not gated on by anything. ⚠️ With branch
    protection deferred until paying clients, every CI gate here is advisory at merge anyway, so
    this is about SIGNAL, not enforcement: say "would have caught", never "did stop". Fix: mirror
    the `e2e-seeded` result check for `sql-tests`, or add it to an aggregator's `needs:`.
    Found by the /ship coverage audit, 2026-08-03. **Related and already FIXED in 0.52.0.0:** the
    same job had been made the third member of the one-pending-slot `shared-test-db` concurrency
    group, which cancelled a pending gate outright; it is now gated behind `python`.

### v1.16 Phase-142.2 (MT5 on the unified backbone) — deferred items (added 2026-08-04)

Booked at phase close (plan `142.2-08`). ⛔ **Read the boundary first: 142.2 delivered MT5
*reachable and honest* — the connect flow works and its rejections name their true cause. It did
NOT verify that MT5's rendered performance NUMBERS are correct.** That is Phase 142.3 (MT5-06..10,
decisions D-07..D-11), against the live terminal on a trading day. Nothing below, and no artifact
of 142.2, may be read as evidence of MT5 number-correctness.

None of these clears the founder blast-radius bar as blocking. Each names its source decision.

1. **`DEF-142.2-01` — MT5 broker-server typeahead (D-04). ⛔ NOT a simple UI task: there is no data
   source.** The field ships as plain text (now legible rather than dot-masked, MT5-03) plus the
   helper copy at `ConnectKeyStep.tsx:144` ("copy the server name exactly as it appears in your MT5
   terminal") — which is the only reliably correct instruction we can give. **The blocker is data,
   not UI.** `grep` for `broker_server` / `server_name` across `.py`/`.ts`/`.tsx` returns **zero
   hits repo-wide**, and there is no public canonical registry of MT5 broker server names. Three
   candidate sources were considered and rejected: (a) **curated static list** — rots silently as
   brokers add/rename servers, and the field must stay free-text anyway, so the list can only ever
   be a hint; (b) **learn-from-successful-connections** — empty until MT5 has real users, and it
   leaks one user's broker choice to every other user; (c) **public registry** — does not exist.
   ⚠️ A *partial* list is worse than none: it invites picking a near-match that then fails
   validation, which is precisely the confusing-rejection class this phase just closed. Re-open
   only with a named, maintainable data source attached.
2. **`DEF-142.2-02` — `KEY_INVALID_FORMAT` split, the remaining 2 routes (D-06): 9 emitting sites,
   not 11.** Measured at HEAD by `grep -c 'code: "KEY_INVALID_FORMAT"'`:
   `src/app/api/keys/validate-and-encrypt/route.ts` → **4**, `src/app/api/verify-strategy/route.ts`
   → **5**. (The research's "11" and the 142.2-CONTEXT D-06 text counted comment prose; the same
   two-per-file delta that made the in-scope routes read 14 instead of 12.) **Same defect class** as
   the 24 sites plan 07 fixed — one code bucketing unrelated causes — but **different callers and
   different copy contracts**: `validate-and-encrypt` is an internal surface and `verify-strategy`
   is the public/teaser verification path, so the four new codes' wizard copy is not automatically
   the right copy there. Deliberately untouched by 142.2: both files are byte-unchanged.
3. **`DEF-142.2-03` — the destructive remedy on a gate refusal is still live.** `GATE_INSUFFICIENT_TRADES`
   offers "try another key"; `onTryAnotherKey` (`WizardClient.tsx:911-926`) fires
   `void handleDeleteDraft()`, which destroys the draft **and cascades away every `strategy_keys`
   member**. MT5-12 removed the *unwinnable* case for MT5 (a complete daily series can now pass the
   gate on its own verdict, so an MT5 user is no longer cornered into pressing it), but **the
   destructive remedy itself is unchanged** and still the offered remedy on every other refusal.
   Classed DoS (user-inflicted) in the 142.2 RESEARCH security table. Verified still live at HEAD.
4. **`DEF-142.2-04` — ccxt/perp verdict refinement is blocked on the ingestion truncation bugs,
   deliberately.** `combine_realized_and_funding` stamps `fill_derived_unproven` **always — a
   constant, not a computation**. A data-driven refinement (stamp `ledger_complete` when realized
   records provably span the series) would newly **ADMIT** exactly the accounts a silent-truncation
   bug makes look healthy. Fix the known truncating inputs first — the **OKX bills paginator** and
   the **bybit funding cursor**, both already booked under § Money-path correctness — then revisit.
   Order matters: refining first would publish understated track records with a certified verdict.
5. **`DEF-142.2-05` — `_LEDGER_BACKED_SOURCES` → `adapter.fetches_fills` (optional follow-up).**
   `analytics-service/services/ingestion/long_fetch.py:63` still holds a venue literal set. ⚠️ It is
   **NOT** the set MT5-12 deleted and must not be removed: it answers an **adapter-capability**
   question (does this adapter implement `fetch_raw` / `compute_fingerprint` /
   `reconstruct_positions`, or does it raise `NotImplementedError` by design?), which is legitimately
   a venue property. The TypeScript mirror was the trust judgement, and that one is gone. Turning
   the ingestion set into a property on the adapter that already knows the answer would remove the
   last venue literal; it is cheap, and **not required by the MT5-12 invariant**.
6. **`DEF-142.2-06` — `database.types.ts` is drifting and there is no regeneration script.** Phase
   142.2 plan 06 hand-patched **only** `series_completeness` (3 sites: `Row`/`Insert`/`Update`).
   Three pre-existing `strategy_analytics` columns remain missing: `computing_started_at`,
   `computation_warned`, `metrics_json_by_basis`. `package.json` has **no** types-generation script
   and `ci.yml` mentions `database.types` nowhere, so there is no freshness gate — which is why the
   drift went months unnoticed. The honest fix is all three columns **plus a gate**, not a fourth
   one-off addition. **Supersedes/absorbs** the narrower Phase-142 item above (§ "BOTH TypeScript
   type files are stale…"), which names the same two columns for `types.ts`; do not fix them
   separately.
7. **`DEF-142.2-07` — Deribit `twr_chain_broken` tightening: FOUNDER DECISION, with the census
   number attached.** Plan 03 shipped the **behaviour-preserving** default — deribit keeps
   `ledger_complete` on **both** return paths even when `meta` carries `twr_chain_broken`.
   Tightening it (stamp a non-admissible verdict when the chain is broken) is a real option, and the
   read-only PROD census that governs it was run in plan 04: **deribit rows carrying
   `twr_chain_broken` = 0 — total AND published** (1 row carries the flag on a non-deribit venue).
   **So tightening would affect nothing today.** ⚠️ Not decided by the phase, on purpose — it is a
   trust-policy call, not an implementation detail. **Remedy rule if it is ever tightened: affected
   series get a RE-DERIVE, never a backfill `UPDATE`** (see item 9 for why).
8. **`DEF-142.2-08` — renaming `csv_daily_returns`.** The table is the canonical daily series for
   **every** producer (keyed derive, composite stitch, CSV upload), so the `csv_` prefix now names
   only one of three producers. Cosmetic relative to the MT5-12 invariant, which is satisfied by the
   verdict column regardless of the table's name. Low value, non-trivial blast radius; do it only if
   the table is being touched for another reason.
9. **`DEF-142.2-09` — the Pitfall-6 healing population: 6 unpublished strategies, THREE remedies,
   one per producer. ⛔ NEVER a backfill `UPDATE`.** Every pre-existing `strategy_analytics` row has
   `series_completeness IS NULL`, and the gate is fail-closed on NULL. Plan 04's read-only PROD
   census (44 strategies: 33 published, 8 `pending_review`, 1 draft, 1 private, 1 archived) sized it:
   - **1 keyed** → **RE-DERIVE** (`derive_broker_dailies`; the combiner re-examines the venue inputs
     and stamps the verdict it can still justify).
   - **4 keyless CSV** (`api_key_id IS NULL`, non-composite) → **RE-RUN `compute_analytics_from_csv`**,
     whose `run_csv_strategy_analytics` pass stamps `user_supplied`. ⚠️ **This is the remedy that is
     easy to omit and it covers the LARGEST group.** No derive job ever runs for a keyless
     non-composite and no stitch exists for it, so a note saying only "re-derive or re-stitch" hands
     the founder an *impossible instruction* for 4 of the 6.
   - **1 composite** → **RE-STITCH** (`run_stitch_composite_job` stamps `composite_stitched`).
   - **0 published composites** — the composite regression `composite_stitched` exists to prevent has
     **no live victims** today.
   The population **self-heals**: the gate runs at exactly two moments (wizard `SyncPreviewStep`,
   admin approve), so a NULL verdict cannot un-publish anything already live; it only refuses the
   next preview until the series is re-produced. ⛔ **A backfill `UPDATE` is forbidden** — it would
   fabricate a trust claim about series whose inputs were never examined and, for some, no longer
   exist. That is the exact lie the verdict column was added to make impossible.
10. **`DEF-142.2-10` — Vercel tooling recommends Workflow DevKit on both wizard connect routes;
    DECLINED, with the reasoning that must survive.** (Was `DEF-142.2-07-A` in the phase's
    `deferred-items.md`.) The repo's Vercel plugin hook fires on every edit to
    `create-with-key/route.ts` (~`:270`, the post-validation seam) and its `composite/add-key`
    mirror, recommending durable execution for the seam's retry handling. **Not applied, and the
    reason is a threat-model question rather than a taste call: these are the two SECRET-BEARING
    routes** — raw `api_key` / `api_secret` / `passphrase` arrive in the request body — so moving
    them onto a durable-execution substrate puts live credentials across a **new persistence
    boundary**. Second reason: both routes spend two seam budgets back to back (`validate-key`, then
    `encrypt-key`) under `maxDuration = 300`, and the 140-series work built a deliberate
    circuit-breaker + classification posture around that seam (`SERVICE_UNAVAILABLE_RETRY`,
    `SERVICE_UNREACHABLE`, `SEAM_MISCONFIGURED`) that a large body of route tests pins. Any move
    must preserve that classification contract. **Disposition:** evaluate as its own phase with a
    threat model, or reject explicitly and silence the hook on these two paths so it stops
    recommending a change the security posture does not want.
11. **`DEF-142.2-11` — `EquityChart.tsx:1119` `react-hooks/exhaustive-deps` warning
    (`useMemo` missing dep `period`).** Pre-existing, untouched by 142.2, recorded by plans 02, 06
    and 07 as the sole output of `npm run lint` (0 errors, 1 warning). Batch it with the next edit to
    that file.
12. **`DEF-142.2-12` — the 7-row CSV floor is still not evaluated on the wizard's COMPOSITE arm.**
    Surfaced by the FIX 3 work (2026-08-04) and **pre-existing** — it predates 142.2 and is *not*
    the verdict-term divergence FIX 3 closed. The admin path applies `STRATEGY_GATE_MIN_CSV_ROWS`;
    the composite preview does not, so a composite with fewer than 7 stitched days previews as
    `passed` and 409s at publish — the same preview/publish disagreement class, one term over.
    ⚠️ Fixing this makes residual 13 below live: it is the path that would route
    `INSUFFICIENT_CSV_HISTORY` through the wizard mapper for the first time. **Fix the two together
    or neither.**
13. **`DEF-142.2-13` — `INSUFFICIENT_CSV_HISTORY` maps to `UNKNOWN`** in `gateFailureToWizardError`,
    on the documented premise that it "never flows through the wizard error mapper". That premise is
    true **only while `DEF-142.2-12` is open**. Closing 12 without this one ships a real gate refusal
    rendered as the generic unknown-error copy.
14. **`DEF-142.2-14` — recognised-but-refused verdicts still render `INSUFFICIENT_TRADES` copy.**
    A gapped perp (`fill_derived_unproven`, 0 trades, 135 rows) is still told *"only 0 trade(s), a
    minimum of 5 is required"* — the same class of false sentence FIX 1 deleted for the NULL case,
    left standing for the examined case because the **D-15 acceptance test pins that exact code** and
    the review scoped FIX 1 to NULL/unrecognised. ⚠️ **The refusal itself is correct** — this is a
    copy decision, not a safety one, which is why it was not smuggled into a fix commit. The honest
    remedy is a fourth outcome meaning "your series was examined and found incomplete"; doing it
    requires re-cutting D-15's oracle deliberately, never incidentally.
15. **`DEF-142.2-15` — the six code-review findings deferred by founder scope call (2026-08-04).**
    All six cleared the *stopping rule* bar (none user-facing, none data-integrity), which is why
    they were not fixed alongside the four that were. Recorded here so the deferral is a decision
    with a record, not an omission. Batch them with the next edit to each file:
    - **(a) `analytics_runner.py:1564` — `_stamp_user_supplied` infers "not broker-sourced" from a
      null `api_key_id`, which `ON DELETE SET NULL` also produces.** Delete an API key, and a later
      recompute stamps `user_supplied` on a series that was actually broker-derived — overstating
      how the numbers were obtained. Needs a structural check, not a null test.
    - **(b) `broker_dailies.py:524` — `nav_gap_days` reindexes over the FULL span,** so leading and
      trailing gaps count the same as interior holes. An sFOX account whose NAV history simply
      starts later than the requested span is stamped `sampled_gapped` with no interior holes, and
      is refused. Should count interior-only.
    - **(c) `analytics_runner.py:1500` — the composite exclusion rests on the `existing_flags`
      `'composite'` marker, not structural identity.** If that flag is ever cleared or rebuilt
      without the key, a composite recompute stamps `user_supplied` and erases the
      machine-stitched-vs-human-uploaded distinction.
    - **(d) `strategyGate.ts` — the publish-time TOCTOU re-check still refuses with trade-count
      wording** when analytics are recomputed between wizard preview and admin approve. Same false-
      sentence class as `DEF-142.2-14`; fix them together.
    - **(e) `broker_dailies.py:91` — only ONE of the three producer paths validates its stamp
      against `SERIES_COMPLETENESS_VALUES`.** The other two can emit an unregistered string. Drift
      direction is fail-closed (an unrecognised verdict refuses), so this is a missing loud signal
      at the producer, not a live money bug.
    - **(f) `broker_dailies.py:91` + `strategyGate.ts` — the verdict list is hand-maintained in
      BOTH Python and TypeScript.** ⚠️ **Do not "fix" this by importing one from the other** — the
      duplication is deliberate (producer set vs admissibility policy) and documented in the
      migration comment. The hygiene item is drift *detection*, not de-duplication.

⚠️ **Cross-reference, do NOT duplicate:** the anon-readable `strategy_analytics` splat that plan
04's A2 check re-confirmed (`anon` holds `SELECT` on `series_completeness`, as it does on every
column of that table) is already booked above under § Security — *"`strategy_analytics (*)` splats
every analytics column to anon on two public paths"* (commit `d935fa61`). The new column adds no
new exposure class: it is an enum carrying no magnitude, and protecting one column while the splat
stands would secure nothing.

### v1.16 milestone human-audit QA sweep — authed-browser + PROD probes (added 2026-08-03)

Run via /qa over the open GSD human-verification items of phases 140→142.1 against live PROD
(authed browser as `qa-demo@quantalyze.app` + read-only Supabase/Upstash probes). Discharged that
day: D-19 PROD cron body (see ✅ on the 142.1 item 6 above), PROD stuck-`computing` census = 0,
TEST reaper cron registered/active, 140.1 index shape on PROD correct
(`strategy_verifications_strategy_wizard_session_uniq` present, old index gone), 141.2 audit
numbers re-confirmed (42/42/0 `wizard:`-prefix; resync 20/42; five breaker keys still ABSENT),
wizard AUTH_FAILED arm renders named+actionable copy with Retry/Diagnostics and clean diagnostics
(`code` + `correlation_id` only, no internals), teaser `/api/verify-strategy` rejection envelope
carries `human_message` end-to-end and the TS-17 client fix (`human_message` read first) is live.
New findings, none clearing the founder blast-radius bar as blocking:

1. **Raw Python exception leaks into user-facing `computation_error`.** PROD row: strategy
   `ec722557` ("Alpha Centauri", owner `helmut@metaworldfund.com`) has
   `computation_error = "'<' not supported between instances of 'str' and 'NoneType'"`.
   That is an internal TypeError string in the field the wizard/factsheet renders as failure
   copy — the exact attribution class 140.x closed on the HTTP seam, still open on the
   `computation_error` persistence path. Fix shape: map non-contract exceptions to the
   user-recoverable message at the writer (same pattern the 142 reaper message uses) and keep
   the raw string in logs/Sentry only. Also worth a one-off: root-cause the `str`-vs-`None`
   comparison itself (likely a missing-field sort/compare in analytics for that strategy).
2. **Wizard AUTH_FAILED copy names the wrong venue.** With **Binance** selected, the rejection
   panel's example text reads "(e.g. Deribit returns invalid_credentials)" and a bullet says
   "on Deribit the key is the ClientId and the secret is the ClientSecret". The copy block is
   venue-generic where it should be parameterized by the selected exchange. Cosmetic/prose —
   batch with the next wizardErrors.ts copy pass.
3. **Verified factsheet shows FRESH while its return series ended 89 days ago.** Phoenix
   Protocol (API-verified, "Synced 8h ago", "COMPUTED · FRESH (0d)") has an observation window
   ending 2026-05-06. Sync succeeds and compute is fresh, but no dailies exist after May 6 —
   either the account went flat (then the factsheet arguably should say so) or the daily-derive
   stopped attributing new days (then it's a data-pipeline gap). Needs a look at the dailies for
   that key before deciding which. Investigate — data-integrity-adjacent.
4. **Example strategies advertise "Synced 67d ago" on discovery.** All example rows (Hide
   examples OFF, the default) show a stale sync badge; real strategies show "Synced 8h ago".
   Allocators can read the stale badge as platform-wide staleness. Consider suppressing the
   sync badge on example rows. Cosmetic.
5. **Validation-rejected keys leave no audit trail (observation, decide-only).** A failed wizard
   key validation (AUTH_FAILED) writes no `audit_log` `process_key` row — audit starts only when
   a key enters processing. Consistent with current design; recorded so the 141.2 audit censuses
   are read correctly (they count processed flows, not attempts). No action unless rejected-attempt
   telemetry is wanted beyond Sentry.

### Phase 147 (SCEN-01) class-closure audit — `getPortfolioStrategies` consumers (added 2026-08-05)

Phase 147 fixed FOUR readers that selected only `strategy_analytics.daily_returns` and therefore
saw `null` for every API-ingested strategy (whose track lives in `returns_series` as a cumprod
wealth index). Plan 147-06 T3 ran the class-closure audit over `getPortfolioStrategies` — the
query already selects BOTH columns (`queries.ts:1305`), but a *consumer* reading only
`daily_returns` would still strand the series. **Grep, log, do not fix** (orchestrator ruling —
these are outside the phase's locked scope).

**Audit result: 0 bare consumers.** Commands run against `HEAD`:

```
grep -rn --include="*.ts" --include="*.tsx" "getPortfolioStrategies" src/ | grep -v "\.test\."
  → 3 consumers: portfolios/[id]/page.tsx, .../manage/page.tsx, .../documents/page.tsx
grep -n "daily_returns\|returns_series" <each consumer>
  → zero `daily_returns` reads in all three
```

None of the three touches `daily_returns` at all — they read the scalar metrics
(`cagr`/`sharpe`/`max_drawdown`/`sparkline_returns`) via `extractAnalytics`. The bare-reader class
is closed there. Two adjacent findings were surfaced by the audit and are booked, not fixed:

1. **`DEF-147-A` — `buildEquityCurveSeries` hard-codes `equityCurve: null` behind a comment that is
   now false.** `src/app/(dashboard)/portfolios/[id]/page.tsx:211-231` returns `null` for every
   per-strategy equity curve, justified by an inline comment reading *"Returns_series is not
   selected in the existing query (would balloon the response)"*. That has not been true since
   `getPortfolioStrategies` began selecting `returns_series` (`src/lib/queries.ts:1305`) — the data
   is already on the wire and is being thrown away. Not user-facing as a WRONG number (the chart
   renders the portfolio composite line and simply omits per-strategy lines), which is why it is
   not fixed here. **Fix shape:** pipe `returns_series` through `resolveDailyReturnSeries` +
   the existing cumprod transform instead of returning `null`, and delete the stale comment.
   ⚠️ Confirm the response-size concern the comment cites is still acceptable before wiring it —
   the reason may be stale but the cost is real.

2. **`DEF-147-B` — two dead `daily_returns?: unknown` type annotations promise a column the query
   never selects.** `src/lib/queries.ts:420` (`getPublicStrategyDetail`) and `:458`
   (`getFactsheetDetail`) both annotate their `.single<…>()` generic with
   `strategy_analytics: { daily_returns?: unknown; … }`, but both selects use
   `PUBLIC_ANALYTICS_COLUMNS` (`queries.ts:290`), which contains **neither** `daily_returns` **nor**
   `returns_series`. No consumer reads the field today (`browse/[slug]/[strategyId]/page.tsx`,
   `strategy/[id]/page.tsx`, `factsheet/[id]/tearsheet/page.tsx` — checked, zero hits), so nothing
   is broken. It is a latent trap: the type invites a future reader to consume a field that is
   always `undefined`, which is exactly how the four Phase-147 readers came to render `[]`.
   **Fix shape:** delete the `daily_returns?: unknown` member from both generics (type-only, no
   behaviour change). The Phase 147 grep-gate does **not** flag this — by design, it targets select
   payloads, not type annotations, because a scan wide enough to catch this would redden on prose.

3. **`DEF-147-C` — `queries.my-allocation.test.ts` mock returns fixtures wholesale instead of
   projecting to selected columns.** The mock (`:267-272`) records the select string but hands back
   the full fixture regardless, so narrowing the `getMyAllocationDashboard` embed back to bare
   `daily_returns` would NOT redden that behavioural file (unlike `returns/route.test.ts:296-308`,
   which projects as PostgREST does). Not a phase gap: the 147-04 SC-1 ledger mutation targeted the
   resolver-call argument (falsifiable in that harness), and the select-width regression is held by
   the phase-147 gate's Layer B (verifier confirmed RED under exactly that mutation). Test hygiene
   only (2026-08-05, booked from 147-VERIFICATION.md).
   **Fix shape:** make the mock's `maybeSingle`/embed resolution project to the columns named in the
   recorded select string, mirroring the returns-route harness.

### Phase 148 (OWN) — factsheet v2 payload cache is id-only-keyed (added 2026-08-05)

**`DEF-148-A` — a fresh `strategy_analytics.computed_at` does NOT bust the factsheet v2
payload cache, so the factsheet can serve metrics up to 3600s stale.** The page's header
comment claimed the opposite until phase 148 corrected it; the *behaviour* is unchanged and
deliberately NOT fixed here.

Mechanics. `src/app/factsheet/[id]/v2/page.tsx` passes `` `${id}::${computedAt}` `` into
`buildFactsheetPayloadCached`, which splits at `"::"` and **discards everything after the id**
(`page.tsx:229` pre-148 numbering — the `const [id] = cacheKey.split("::")` line). What actually
keys the entry is Next's own derivation
(`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:55,82`):
`fixedKey = ${cb.toString()}-${keyParts.join(',')}`, then
`invocationKey = ${fixedKey}-${JSON.stringify(args)}`. Here `cb.toString()` is constant source
text, `keyParts` is `["factsheet-v2-payload-v6", id]`, and `args` is `[]` because the returned
function is invoked with no arguments. **Effective key: id only.** `computed_at` never
participates.

Existing mitigations (why this does not clear the founder's blast-radius bar):
- `revalidate: 3600` is a hard 1h staleness ceiling.
- `revalidateTag(\`factsheet-v2:${id}\`, "max")` at
  `src/app/api/admin/strategy-review/route.ts:501` busts the entry on the admin publish/review
  flow — the only writer, and the only transition where a stale payload would be user-visible
  as *wrong* rather than merely *late*.

This is **staleness, not user-facing incorrectness and not data integrity**, so per the founder
stopping rule it is logged, not fixed (phase 148 orchestrator ruling; RESEARCH §3a consequence 3).
**Fix shape if it is ever taken:** make `computed_at` a real `keyParts` member (and update the
`factsheet-v2-payload-v6` bump ledger + the admin revalidator together) — do **not** try to encode
it in the `cacheKey` string, which is exactly the mechanism that already fails.

⛔ **Load-bearing corollary, do not lose:** because the key is id-only, appending a suffix to the
`cacheKey` string yields the *same* entry. Any attempt at viewer/lane separation via that string
would write a viewer-dependent payload into the shared entry and serve it to anonymous readers
for the full TTL. This is why phase 148's owner lane bypasses the cached wrapper entirely rather
than "giving the owner lane its own cache key".

### Phase 148 (OWN-04) — two in-wizard link-style divergences from the UI-SPEC treatment (added 2026-08-05)

**`DEF-148-B` — the two pre-existing `target="_blank"` links in the wizard tree do not match the
now-authoritative link treatment shipped by OWN-04.** Logged only; deliberately **NOT** fixed in
phase 148 (out of the task's blast radius — Rule 3 / phase-148 orchestrator ruling).

The OWN-04 link (`SyncPreviewStep.tsx`, `ViewFullFactsheetLink`) follows 148-UI-SPEC:122/126:
`underline underline-offset-4` (persistent) + `rel="noopener noreferrer"`. Two older siblings
diverge, each in a different way:

| File:line | Divergence | Why the UI-SPEC treatment is the correct one |
|-----------|-----------|----------------------------------------------|
| `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:257` | `className="text-accent underline-offset-4 hover:underline"` — underline appears on **hover only** | It is an inline link inside body prose (`<p className="text-caption text-text-muted">Wizard help · …`), distinguished from the surrounding text by the accent teal ALONE until hover. That is the exact `link-in-text-block` shape DESIGN.md's 2026-06-28 decision ruled a WCAG 1.4.1 failure and remediated on `/security`; this instance was not swept in. |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:662` | `rel="noopener"` — no `noreferrer` | `noopener` alone closes the reverse-tabnabbing hole but still leaks the full wizard URL (including the draft strategy id path) as `Referer` to `/security`. Same-origin here, so the exposure is low — which is why this is logged, not escalated. |

Fix shape if taken: one sweep, both files, plus a check for any third instance
(`grep -rn 'hover:underline' src/app/(dashboard)/strategies/new/wizard/` and
`grep -rn 'rel="noopener"' src`) — a point-fix of these two would leave the class open.
⚠️ Scope caveat: DESIGN.md's persistent-underline rule applies to **body-prose links only**; nav
links, button-styled links, and card links keep their existing hover treatment, so a blanket
`hover:underline` purge would be wrong.

### Phase 148 review IN-01 — `withPublishedOrOwner` uid interpolation lacks shape validation (added 2026-08-05)

**`DEF-148-C` — `withPublishedOrOwner` (`src/lib/visibility.ts:115-125`) builds the PostgREST
`.or()` group by raw interpolation: `` `status.eq.published,user_id.eq.${authUserId}` ``.**
Logged only; deliberately **NOT** fixed in phase 148 (pre-existing phase-110 helper — outside the
founder blast-radius bar for review blocking).

Not exploitable today: every current caller (including both phase-148 `page.tsx` sites) passes the
session `user.id`, a GoTrue-minted UUID. But the helper's contract ("`authUserId` MUST come from
the authenticated session") is enforced only by convention — a future caller passing a
user-influenced string could inject additional PostgREST filter clauses into the OR group
(e.g. `x,status.eq.draft`), widening visibility. On the admin-client call path introduced in
phase 148 the injected predicate is the **ONLY** gate, which is what upgrades this from hygiene
to a real landmine for future callers.

**Fix shape:** belt-and-suspenders inside the helper, fail-loud —
`if (!/^[0-9a-f-]{36}$/i.test(authUserId)) throw new Error("withPublishedOrOwner: authUserId is not a uuid")` —
plus a unit test proving a non-uuid throws (the test must fail if the guard is removed).

### Phase 149 (NAV-01, `/my-strategies`) — deferred items (added 2026-08-05)

All three were routed out of phase 149 by ruling, not by omission. None is user-blocking: the
surface ships fully functional with each of them open.

**`DEF-149-A` — "Finish setup →" opens the contribution wizard FRESH, with no key preselected.**
The Delta-5 placeholder rows (`StrategyTable.tsx`, one per active key with no derived strategy)
fire `onFinishSetup`, which mounts `ContributionWizardOverlay` on its API-key branch. The overlay's
interface is `{ isOpen, onClose, onSuccess? }` — there is **no preselect seam**, so the owner
re-picks the key they just clicked. Pretending a key was already chosen would have been worse than
asking again (no-invented-state), which is why the founder ruling shipped it this way.
**Fix shape:** one optional prop threaded from `ContributionWizardOverlay` into `WizardClient` and
down to the key-selection step (e.g. `preselectApiKeyId?: string`), plus a spec proving the step
mounts with that key already chosen. Both `/my-strategies` mounts (`MyStrategiesSection.tsx` and
`MyStrategiesEmptyState.tsx`) would pass it; every other caller keeps today's fresh-open behaviour
by omitting it.

**`DEF-149-B` — two live surfaces now render an `h1` reading "My Strategies".**
The manager surface `/strategies` and the allocator surface `/my-strategies` share the title. This
is **benign at runtime** — they are role-disjoint (the allocator never sees `/strategies`, gated by
`requireRolePage`) and the sidebar entries differ. It is a TEST-AUTHORING landmine (research
Pitfall 10): any future unit/e2e selector written as a bare `getByRole("heading", { name: /my
strategies/i })` or `page.getByText("My Strategies")` can silently bind to the wrong surface and
still pass. **Convention going forward (not a code change):** scope every selector for either
surface by route, `href`, or `data-testid` — never by bare heading text. The phase-149 Sidebar
cases already do this (`a[href="/my-strategies"]`).

**`DEF-149-C` — `StrategyGrid` card links dead-end for any FUTURE owner-scoped grid consumer.**
`StrategyGrid.tsx:52-53` builds `${basePath}/${categorySlug}/${s.id}`, which resolves through
`getStrategyDetail` (`queries.ts:776`) → `withPublishedOnly` (`queries.ts:833`) → `notFound()`. For an own
unpublished row that is both a dead end and an existence oracle. Phase 149 resolved it by making
grid **unreachable** on the owner surface instead — the `effectiveViewMode` derivation forces
`"table"` and `showViewToggle` hides the toggle (founder ruling; RESEARCH had recommended the prop
instead). Both halves are pinned (gate pin 7 + `StrategyTable.visibility.test.tsx`). **The debt is
latent, not live:** it becomes real the moment any surface passes
`visibility="owner-all-statuses"` *and* wants grid view. **Fix shape then:** a `rowLinkMode` prop
(`"category-detail" | "factsheet"`) threaded from `StrategyTable` into `StrategyGrid`, defaulting
to today's category-detail form, plus a `StrategyGrid.test.tsx` case pinning the `/factsheet/{id}`
href under the owner mode. Note the grid carries a second owner-surface problem that the
toggle-hide also defers: `StrategyGrid.tsx:79-82` renders `VerifiedBadge` with
`trustTier={s.trust_tier}`, which is null by construction for an unpublished row.

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

## Phase 150 review — non-blocking findings (logged 2026-08-06, founder stopping rule)

- [ ] WR-03: guard-test case 7c auth.uid() occurrence-count runs over pg_get_functiondef incl. comments (4 comment hits ≥ 3 threshold) — vacuous as a live-DB control; vitest pin P4 already covers the invariant comment-stripped. Fix: strip comments in 7c or count against exact === 7 total occurrences. (.planning/phases/150-*/150-REVIEW.md)
- [ ] IN-01: three route docblocks still claim strategies_update has NO WITH CHECK — stale since 20260410225610; migration rev-3 corrected its own copy, routes didn't.
- [ ] IN-02: allocation route lacks the archived-status gate the marked-set query enforces (query-side filter only).
- [ ] IN-03: mid-request mark flip surfaces as 500/UNKNOWN instead of the 409 arm (no row refresh) — race window only.
- [ ] IN-04: MarkOwnershipDialog "Keep own capital" stays clickable while destructive removal is in flight.
- [ ] (verifier INFO) finalize-wizard/route.ts:1339-1342 carries the same stale no-WITH-CHECK claim as IN-01's route docblocks — fix together.
- [ ] (verifier INFO) MigrationWizard.tsx:72-76 surfaces raw psError.message — give it the W-6 23514→honest-copy mapping AddToPortfolio got. Reachable only for an owner migrating their own unmarked published strategy.
- [ ] (WR-02 fix note) `bg-card` is a dead class — no `--color-card` token in globals.css @theme; 7 files repo-wide render transparent notice backgrounds. One cleanup pass wanted.
- [ ] (/code-review high, lens 3+5) The stale "strategies_update has NO WITH CHECK" claim also lives in src/app/api/strategies/finalize-wizard/route.test.ts:76-77 and :2996-2997, and ownership/name route docblocks — fix together with IN-01 using the migration rev-3 framing (defence-in-depth, cite 20260410225610).
- [ ] (/code-review high, lens 5) HoldingsTable.tsx D-15 comment cites StrategyTable.tsx:1067-1085; the precedent now lives at :1169-1179 — cite by phrase not line number.
- [ ] (/code-review high, lens 5, low-confidence) strategies-row-adapter.ts Half-2 comment says "honest — rather than a fabricated manager" but code sets manager: s.codename ?? null — codename-present path renders own codename in the manager column and is untested; decide intended behavior and pin it.

### Phase 151 (AUM) — deferred by ruling from plan 151-04 (added 2026-08-07)

- [ ] **sFOX holdings: consider the `get_balance_history` `usd_value` NAV anchor instead of per-asset `get_balances`** — deferred from Phase 151, RESEARCH Open Q2. `_fetch_sfox_balance_rows` honours the CONTEXT lock on `get_balances()`, whose rows carry a STRING quantity and NO USD valuation, and whose facade has no ticker endpoint — so a non-stable asset is honestly SKIPPED and named rather than priced at an invented rate. `get_balance_history` returns a daily `usd_value` NAV series: an account-level USD anchor structurally identical to MT5's `account_info().equity`, which would value the whole book with no pricing problem at all. Switching is a CONTEXT amendment (a different method than the one locked), so it belongs to the sFOX go-live phase, not to 151. Until then a live sFOX key with non-stable holdings under-reports its AUM by exactly those assets — visibly, via the `complete_with_warnings` copy that names them.
- [ ] **Overview "your live book" baseline: consider a partial-blend baseline now that the composer shows a partial book** — deferred from Phase 151, RESEARCH Open Q6. The honest-empty baseline is arguably too conservative once a partial-coverage book renders in the composer; 151-05 deliberately left the Overview on the old gate. Revisit as a product call, with an explicit test of what the baseline shows when only some keys contribute.

### Phase 151 (AUM) — code-review Info findings, logged per stopping rule (added 2026-08-07)

- [ ] **IN-01** `_mt5_bounded_restart` logs a hardcoded `derive_broker_dailies:` prefix even when invoked from the holdings path (`mt5_concurrency.py:91-95`) — misleading ops log channel, cosmetic.
- [ ] **IN-02** A manual AUM cannot be cleared once set — `setManualAum(undefined)` has no production caller (`scenario-state.ts:818-832`). UX affordance decision (small ✕ / empty-string-clears), needs founder call on interaction.
- [ ] **IN-03** MT5 holding symbol truncates the key id to 8 chars (`ACCOUNT-{id[:8]}`) for no gain — full UUID satisfies the symbol regex and removes any birthday-collision thought (`allocator_positions.py:560`). ⚠️ Changing it AFTER first PROD write mints duplicate rows; decide before MT5_ENABLED flip or accept forever.
- [ ] **IN-04** Copy-leak test docstring claims broader scope than it checks (`test_allocator_positions_non_ccxt.py:261-288`) — align claim with the (now AST-widened) gate.
- [ ] **IN-05** `test_timeout_constants_survived_the_move` couples to env var defaults (`test_mt5_concurrency.py:166`) — derive expected from the same source, not a literal.
- [ ] **IN-06** Composer defensively `?? false`/`?? []` on payload fields the SSR layer declares required — pick one contract (six sites in ScenarioComposer.tsx).
- [ ] **IN-07** The unregistered-non-ccxt-venue honest-skip arm is unreachable today (both members have fetchers) — kept deliberately as the class safety net; note documents it.
- [ ] **IN-08** Role-discriminator degradation on a failed `strategy_keys`/`strategies` read re-admits manager keys as book constituents (`queries.ts:3868-3898`) — fail-open vs fail-closed decision; today's blast radius is the founder's own account only.
- [ ] **IN-09** `key={displayed}` remounts the dollar input on Enter, dropping focus (`ScenarioComposer.tsx:5804`) — keyboard-flow polish.
- [ ] **WR-08 residual** `MT5_ENABLED=false` does not stop the preflight's RPyC connect — `Mt5Client.__init__` opens the connection before the kill-switch is consulted; a true pre-connect gate changes disabled-path semantics of two job kinds, deferred deliberately.

### Phase 152 (SCEN composer legibility) — deferred residuals (added 2026-08-07)

- [ ] **Pitfall 6 — a stale persisted draft's factsheet link can 404.** The SCEN-03 row-detail panel emits `href="/factsheet/{id}"` for every added strategy. The link resolves under OWN-02's two-lane access control for the viewer's OWN strategies and for currently-PUBLISHED third-party ones — but a draft persisted weeks ago can still name a third-party strategy that has since been archived or deleted, and that link dead-ends on `notFound()`. Detecting it would require a per-row existence fetch, which Phase 152's CONTEXT explicitly locks out (the panel is an in-memory projection with no loading and no failure state by construction). Acceptance was scoped accordingly. Revisit if/when the composer gains a draft-reconciliation pass — the right fix is to prune or mark unresolvable rows at draft load, not to fetch per row at render.
- [ ] **WR-02 — the composer row-detail's CAGR/SHARPE never render for drawer-added strategies (their entire population).** `addedStrategyMetadataLookup` sources `cagr`/`sharpe` from ONE place: `strategyById`, built from `payload.strategies`, which is BOOK-ONLY (the portfolio_strategies join). Unlike `asset_class`, `trust_tier` and `is_composite` — each of which has a lazily-fetched fallback (`addedAssetClassById`, `addedProvenanceById`) — the metrics have none, and `/api/strategies/[id]/returns` does not serve them (its select is `daily_returns, returns_series, computation_status, data_quality_flags`). A strategy added from the Browse drawer is by construction one the allocator does not hold, so for that whole population `metricsAbsent` is always true and the SCEN-03 panel is markets + types + provenance + a link. Phase 152's CONTEXT locked "no new fetches", so the fix pass only corrected the honest-copy side (the note now names the composer, and the code comment states the reachability). **The real fix:** widen `/api/strategies/[id]/returns` to co-serve `cagr, sharpe` from `strategy_analytics` — same row, same RLS, no new round-trip — and add an `addedMetricsById` lazy fallback mirroring `addedProvenanceById`. Keep the metric pair either way: it is live for an in-book leg (e.g. a Bridge candidate the allocator holds).
- [ ] **D-1 residual — same-day own-row duplicates stay indistinguishable in Browse.** The SCEN-05 disambiguation line is `Created {Mon D, YYYY} · {Status}`; the key-count segment was omitted entirely (D-1) because `created_at` alone resolves the founder's real case (two "Alpha Centauri" rows 15 days apart) and a key count costs a second query on the browse path. Two own rows with the same name created on the SAME day therefore render identical lines. Revisit only if the founder treats key count as load-bearing for the choice — the amendment is a wire field plus a segment, not a redesign.

### Phase 152 (SCEN) — code-review Info findings, logged per stopping rule (added 2026-08-07)

- [ ] **IN-01** `isOwn` breaks the browse wire's snake_case convention (route emits snake_case elsewhere) — cosmetic wire-style inconsistency, rename = coordinated schema+client change, not worth it standalone.
- [ ] **IN-02** Five elements share `data-testid="scenario-added-header-label"` — fine for the count assertions today; per-label testids would make header tests sharper.
- [ ] **IN-03** Header labels sit ~8px right of the numbers they label (gap-2 offset accumulation) — visual polish; founder-eyes call.
- [ ] **IN-04** Stale line citation in a SCEN-04 code comment — comment hygiene.
- [ ] **IN-05** Dedup date renders in the viewer's local timezone — could show "Aug 3" for a UTC "Aug 4" creation; consider pinning UTC if it ever confuses.
- [ ] **IN-06** Detail panel repeats the provenance badge and pushes the row's own state notes below its hairline — layout polish for design-review.
- [ ] **IN-07** Row-wide pointer amplification collapses the panel on incidental clicks (e.g. selecting text in the row) — interaction polish; founder-eyes call.

### Phase 151/152 UAT fix round — deliberately deferred halves (added 2026-08-08)

- [ ] **F-3 wizard-UI half: render the `capital_ownership_persisted: false` sidecar.** The finalize-wizard route now returns a non-error sidecar in its 200 body when the capital-mark UPDATE fails or matches no row (fixed 2026-08-08 — the server had Sentry'd it but reported plain success, so a user who answered "my own capital" silently got an unmarked, non-allocatable strategy and only discovered it days later as a missing `Allocate…` affordance). **Nothing consumes the flag yet.** `SubmitStep.tsx` reads the 200 body then calls `onSubmitted(data.strategy_id)`; surfacing the warning means threading a fourth piece of state through `onSubmitted` → `WizardClient` → the success screen, which is wizard restructuring beyond the "ship a warning string" bound the founder set for this round. Fix: thread the flag to the success screen and render one line — "We couldn't save your capital answer — set it from My Strategies" — pointing at the Mark dialog. The server half and its regression tests (failure arms + the omitted-on-success control) are already landed.
