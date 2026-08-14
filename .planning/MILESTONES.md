# Milestones


## v1.17 — MT5: ingested, wizardable, surfaced (CLOSED 2026-08-14, v0.53.x → v0.62.0.0, Phases 147–154 + 156)

⚠️ **Scope amended on close, and the amendment is the headline.** Originally *"MT5 — usable
end-to-end, not merely ingested"* (147–155). Phase 155 (MT5-VERIFY — the live trading-day parity
run) was **carried to v1.18**, taking MT5-06..10, MT5-15 and the umbrella acceptance MT5-GOAL-01.
A bounded alternative — move 155 to TODOS and tick v1.17 complete — was offered and **declined**.
⛔ **Do not advertise MT5.** Our rendered numbers have never been compared to the terminal's.

- **147 SCEN-01** — the scenario engine receives the real series (silent money-path correctness bug, not MT5-specific).
- **148 OWN** — the owner can view the full factsheet of their own unpublished strategy, no cache disclosure.
- **149 NAV-01** — my-strategies, a ranking at discovery parity. ⚠️ Zero e2e coverage (TODOS `E2E-NAV-01`).
- **150 OWN-03** — the wizard asks whose capital this is; the money-path write isolated.
- **151 AUM** — a book you can reach and a size you can set.
- **152 SCEN** — composer legibility.
- **153 WIZFORM (+153.1–153.7)** — form errors belong on the form; MT5 declarable. ⭐ Goal met via the INSERTED 153.7; the 153.1→153.6 span verdict REMAINS `failed` 5/6 as the historical record that the span shipped short on WIZFORM-02.
- **153.7 WIZFORM-02-CLASS** — the coverage law's population went 17 → 37 codes and a new undisposed code now reds CI *by name*. Landed RED by design, greened only by the dispositions.
- **154 WIZCONT/STALE** — draft-aware entry, stale-screen root cause found BEFORE it was fixed, token-less credential dedup toward the existing row.
- **156 CONNECT-REFACTOR** — the venue the server validated is the venue the server writes; `authenticated` EXECUTE withdrawn from both wizard RPCs. Two PRs with a live PROD gate between them.

**Audit:** `v1.17-MILESTONE-AUDIT.md` — `gaps_found` 82/100. All four blockers were ledger-honesty,
zero source changes, all closed before archiving. ⭐ Three of the four were the *refused claim
resurfacing in a file the amendment commit never touched* — the lesson being that a scope
amendment landing in one file is almost always incomplete.
**Archive:** `milestones/v1.17-ROADMAP.md` + `v1.17-REQUIREMENTS.md`.

## v1.15 MetaTrader 5 — live api_verified account sync — SHIPPED + LIVE (2026-07-25)

**Phases:** 134–139 (6, all complete) | **Timeline:** 2026-07-23 → 2026-07-25
**App version:** v0.49.0.0 → v0.49.4.0 | **Tag:** `v1.15`
**PRs:** #636 (`feat/v1.15-mt5-api-verified`, be8ebdf8, v0.49.0.0 — milestone code, DARK) + go-live hardening #637/#640/#641 (v0.49.1.0→0.49.3.0 — mt5linux/rpyc bridge + 6 soak-surfaced bugs) + #642 (v0.49.4.0 — server-time offset + CI).
**Audit:** `v1.15-MILESTONE-AUDIT.md` (engineering_complete: true, 6/6 integration WIRED, migration prod-verified). The 4 `human_needed` go-live legs completed 2026-07-25 with evidence. Archive: [v1.15-ROADMAP.md](milestones/v1.15-ROADMAP.md) · [v1.15-REQUIREMENTS.md](milestones/v1.15-REQUIREMENTS.md).

Elevated MetaTrader 5 from the legacy `self_reported` EA/CSV push (fabricatable) to a
LIVE `api_verified` account sync — the sFOX 118–123 arc applied to MT5's forex/CFD world.
Self-hosted `gmag11/metatrader5_vnc:2.3` Wine gateway (RPyC :8001) + `mt5linux` net client;
the Windows-only `MetaTrader5` pkg never runs in the Linux worker. Deal-ledger equity
reconstruction (no native equity series) → the ONE `derive_basis_series` backbone with
`api_verified`; √252 TRADITIONAL annualization; 3-field credentials (login / investor pw /
broker server).

- **134 MT5SPIKE** — offline `Mt5Client`/`Mt5ClientError` RPyC facade + 25-test contract + `scripts/mt5_spike.py` four-leg live harness. mt5linux supply-chain verified + pinned.
- **135 MT5SRC** — `'mt5'` first-class Source lockstep; worker read-only validate branch (3-cred, master rejection, wrong-server distinct); 3 key routes; RED-guarded 4-CHECK migration `20260723172032` (prod-verified).
- **136 MT5RECON** — `combine_mt5_deal_ledger` → daily NAV → backbone + `api_verified`; √252 mutation-guarded; ground-truth parity vs `account_info().equity`; deposit-day-not-a-spike; fail-loud unclassifiable DEAL_TYPE. ⚠️ **"ground-truth parity" here means the OFFLINE reconstruction anchor only — a single `account_info().equity` read used to anchor the ledger. It is NOT a trading-day comparison of rendered performance against the terminal's own figures, which has never been done and is v1.18 Phase 155 (MT5-07/08).** Qualified 2026-08-14 (v1.17 milestone audit, W4): this line is where someone asking *"have MT5 numbers ever been checked?"* would land, and unqualified it answers yes.
- **137 MT5CONC** — `to_thread`+`wait_for` + terminal-restart-on-timeout (WEDGE-01 lesson); per-terminal lock + `login==expected` bracket so `api_verified` never stamps the wrong account.
- **138 MT5UI** — flag-gated wizard (`NEXT_PUBLIC_MT5_ENABLED`, OFF=byte-identical) 3-field + investor-pw guide + `api_verified` badge + all-roles e2e.
- **139 MT5GOLIVE** — soak runner `scripts/mt5_soak.py` + `docs/runbooks/mt5-go-live.md` + `deploy/mt5-gateway/`; founder LIVE-ops legs done 2026-07-25.

**Go-live (2026-07-25):** prod gateway `mt5-gateway` on Railway, FULLY PRIVATE (0 domains/proxies on :8001), bridge fixed via 3-pin `PIP_CONSTRAINT` (mt5linux 0.1.9 + rpyc 5.0.1 + numpy<2 — the "server started" false-green was a stacked rpyc-6↔5 + numpy-2↔1 skew). Live cold-boot PROVEN: Vantage acct **26547876 @ `VantageMarkets-Live 5`**, REAL, **trade_allowed=False**, equity=balance=$199,268.44. Soak day-1 GREEN (recon_residual 1.4e-10); full factsheet on the real ledger (−20.9% cumulative, √252, reconciled to trading-pnl/deposits). Flags flipped LIVE: worker `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal:8001` (Railway 9d310b40) + Vercel `NEXT_PUBLIC_MT5_ENABLED=true`; server-time offset `MT5_SERVER_UTC_OFFSET_S=10800` (EEST); quantalyze.xyz → 200.
**Tech debt / deferred:** DST edge (EET↔EEST) founder VNC-confirm; DEAL_TYPE ambiguous middle + master-reject retcode [ASSUMED]; mt5linux 0.1.9 arg-form fragility (handled at Mt5Client); `requirements.in` vs lock pandas drift; read-only investor pw leaked in a `railway variables` dump (founder declined rotation).

## v1.14 Smoothed options MTM (third factsheet basis) — SHIPPED + LIVE (2026-07-23)

**Phases:** 131–133 (3, all verified + review-clean) | **Timeline:** 2026-07-22 → 2026-07-23
**App version:** v0.48.0.x | **Tag:** `v1.14` @ `0adde939`
**PRs:** #633 (`feat/phase-83-smoothed-mtm`, d60e6fed, v0.48.0.0 — milestone code, landed DARK) + #635 (`fix/equity-reconstruction-test-isolation`, 0adde939, v0.48.0.1 — date-bomb test fix)
**Review (audit substitute):** `v1.14-BIG-REVIEW.md` **Verdict SHIP** (no CRITICAL/HIGH; 3 LOW). No formal `/gsd:audit-milestone` — big review + full /ship specialist+Fable-red-team + authed-prod /qa dogfood substitute. Archive: [v1.14-ROADMAP.md](milestones/v1.14-ROADMAP.md) · [v1.14-REQUIREMENTS.md](milestones/v1.14-REQUIREMENTS.md).

An additive THIRD factsheet `pnl_basis` — `smoothed_mtm` — that spreads a Deribit
options book's settlement-day P&L lump across the days it actually accrued via daily
option marks (`Book[d]−Book[d−1]`), total-preserving. Existing `cash_settlement`
(headline/peer-rank) and `mark_to_market` stay BYTE-IDENTICAL (SC-4). Landed DARK
behind two kill-switches, then flipped LIVE the same day (red-team GLB-2/3 degrade-
safety + RT-4 headline-path gate made the flip safe).

- **131 — Analytics core**: `fetch_deribit_option_daily_marks` (source `get_tradingview_chart_data` 1D), pure `replay_option_positions` + `option_mtm_daily`, adapter ΔMTM merge; sparse-marks FAIL LOUD (no interpolation); deribit_txn.py stays pandas/async-free. (verifier 9/9 + reviewer PASS, 2 fix rounds / 11 findings.)
- **132 — Worker persistence**: `smoothed_mtm` series + scalars in BOTH routes, `KIND_SMOOTHED_MTM` (no DDL), `metrics_json_by_basis.smoothed_mtm`; SEPARATE availability predicate leaves the MTM gate byte-identical. (verifier 9/9 + reviewer PASS, 1 fix round: HIGH-01/02.)
- **133 — Factsheet third toggle**: SegmentedControl third option + series swap across every basis surface (single-key + composite), honest-disabled-with-reason where marks missing; cash/MTM byte-identical. (verifier 9/9 + reviewer PASS, 1 fix round: WR-01/02.)

**Go-live:** flipped LIVE 2026-07-23 — Railway worker `4bcd9bc7` (healthy, git_sha 0adde939, `SMOOTHED_MTM_ENABLED=true`) + Vercel prod `7zjbr2l7q` (`NEXT_PUBLIC_SMOOTHED_MTM_ENABLED=true`).
**Deferred (out of scope):** LIVE acceptance on a real Deribit options key (Phoenix `95089958` + Zav2) — prod has NO Deribit option-trade data (dogfood: `trades` deribit-options = 0 rows; Astra books are seed metadata). Live-but-dormant, nothing to break until a real options key is onboarded (founder action). Non-Deribit venues out of scope.

## v1.12 sFOX Verified Integration — FOUNDATION (flag-OFF) (Shipped: 2026-07-19)

**Phases:** 6 archived (118–123; 124 never opened) | **Plans:** ~18 executed | **Timeline:** 2026-07-18 → 2026-07-19
**App version:** v0.46.0.0 | **Tag:** `v1.12` @ `92be47af`
**PR:** #623 (branch `gsd/v1.12-sfox-verified-integration`)
**Audit:** `status: foundation_close` (2026-07-19) — **not a full-coverage audit.** Shipped the sFOX foundation **dormant**; go-live ops + open defects **re-homed to v1.13 Infra** (enumerated), not silently accepted. A formal `/gsd:audit-milestone` was deliberately skipped (the "gaps" are the known founder-gated go-live ops). [v1.12-MILESTONE-AUDIT.md](milestones/v1.12-MILESTONE-AUDIT.md)
**Re-homed → v1.13:** 121-03 (Fly deploy + IP whitelist), 122-04 (factsheet e2e defect), 123 go-live (FLIP cutover/enqueue/cron + E2 live validation), 124 (deribit `correction`), plus the worker-architecture rebuild + test-DB retention hygiene. Seed: `milestones/v1.13-infra-ROADMAP-SEED.md`.

Shipped the **foundation** for live sFOX verified integration — flag-OFF, zero prod impact. A live API read of the real sFOX account is `api_verified` ground truth a submitter can't fabricate (the Phase-111 provenance tier that justifies the big non-ccxt adapter over the trivial CSV path). Everything landed **dormant** (`NEXT_PUBLIC_SFOX_ENABLED`/`SFOX_ENABLED` empty): no user can connect sFOX, nothing reads live. The flip to live is a v1.13 sequence gated on the Fly static-egress IP-bind + the remaining go-live gates.

- **118 — SFOX Research + adapter contract**: non-ccxt `SfoxClient` (Bearer, prod+sandbox base URLs, 4 read endpoints, explicit per-request proxy seam with `trust_env=False`, per-endpoint rate gate, scrubbed `SfoxApiError`); 25-test offline contract suite. NOT added to `EXCHANGE_CLASSES`. SC-3 live sandbox smoke founder-gated (`human_needed`, skips green).
- **119 — Read adapter + key validation + DB constraint-widen**: worker `validate_key` non-ccxt `is_sfox` branch proving auth+read via `SfoxClient.get_balances()`, `read_only` asserted STRUCTURALLY (no write surface, no sFOX scope endpoint — never a probed permission triple), 401/403→`KEY_AUTH_FAILED` (byte-identical ccxt string, zero TS edits); Q1 empty-`api_secret` carve-out in all 3 key routes (ccxt unchanged); RED-guarded constraint-widening migration admitting `'sfox'` across the ≥5 hardcoded exchange CHECKs — **applied + verified on prod**, invalid values still rejected.
- **120 — Equity reconstruction + backbone**: `SfoxAdapter` (`compute_metrics`/`fetch_raw` fail-loud — sFOX returns only ever come from the balance-history `usd_value` series via the ONE `chain_linked_twr`→`derive_basis_series` backbone, never a fill-based snapshot); `'sfox'` registered in the `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` in lockstep; `api_verified` auto-stamps; degenerate input renders honest empty. Live ground-truth parity leg founder-gated.
- **121 — Static-IP egress (Fly.io)** *(code-complete groundwork)*: `fly-egress-proxy/` deployable (tinyproxy image, secret-rendered BasicAuth conf, `ams` fly.toml, dual-IP founder runbook) + worker wiring (`WORKER_EGRESS_PROXY_URL`→`make_sfox_client` at all 4 sites + opt-in ccxt `aiohttp_proxy`; UNSET = byte-identical, tested). 121-03 founder deploy + IP-whitelist → v1.13.
- **122 — Add-key UI + e2e**: SFOX 3-letter tag (both maps) + `api_verified` VerifiedBadge coverage + F6 canonical-lowercase insert; flag-gated wizard offer (`NEXT_PUBLIC_SFOX_ENABLED`, OFF = byte-identical tested) with token-only F3-honest cards + sfox-aware `ApiKeyForm`; `/security#sfox-readonly` setup guide (mint read-only token, whitelist egress IP via contact channel, no hardcoded IP). 122-04 seed-gated e2e RED on the connected-key `api_verified` factsheet render (real defect) → v1.13.
- **123 — FLIPRETRY (root-caused flip retry)** *(code-complete groundwork)*: every derived-equity exchange crawl `asyncio.wait_for`-bounded (a hung crawl can never block the worker loop — the v1.11 rollback root cause); kind-filtered claim RPC migration (`20260719073701`, **prod-applied**) + `WORKER_CLAIM_ROLE`; E2 anchor-consistency + derived↔legacy flip fixtures with a P115-independent hand-derived oracle; 146-line go-live/rollback runbook. Founder go-live checkpoint (deploy/cutover/pilot/live-E2/enqueue/cron) `human_needed`-OPEN → v1.13.

**Close basis:** per-phase full close pipeline (opus verifier + opus code-review + fresh-context Fable red team); findings fixed fail-loud with P115 economic-oracle discipline. All required CI gates green at land (advisory e2e-red only); full analytics suite 4050 passed; tsc/lint clean. Migrations verified on prod; Vercel healthy; Railway force-deployed via `railway up` (auto-deploy skipped on advisory-e2e-red main CI). QA verified the flag-OFF invariant (sFOX not offerable).
**Foundation-close rationale:** v1.12 is code-complete but its go-live is founder-gated ops (Fly deploy + IP-whitelist, the FLIP cutover, live E2) plus a real e2e defect and an evidence-gated deribit phase — none of which is code this session can land. Rather than fake completion or block indefinitely, closed as **Foundation** with the full go-live spine re-homed to v1.13 with a continuous plan.

**Archive:** [v1.12-ROADMAP.md](milestones/v1.12-ROADMAP.md) · [v1.12-REQUIREMENTS.md](milestones/v1.12-REQUIREMENTS.md) · [v1.12-MILESTONE-AUDIT.md](milestones/v1.12-MILESTONE-AUDIT.md) · [v1.12-phases/](milestones/v1.12-phases/) · [v1.13-infra-ROADMAP-SEED.md](milestones/v1.13-infra-ROADMAP-SEED.md)

---

## v1.11 Scenario Composer v2 (Shipped: 2026-07-18)

**Phases:** 11 (109–117, incl. inserted 110.1 + 115.1) | **Plans:** 42 | **Tasks:** 71 | **Timeline:** 2026-07-16 → 2026-07-18
**App version:** v0.45.0.0 | **Tag:** `v1.11` @ `a42f4bcf`
**PRs:** #620 (Phases 109–113) + #622 (114–117 tail + deribit key-connect dogfood fixes)
**Audit:** `status: tech_debt` (2026-07-18) — 29/29 requirements satisfied/wired, 8/8 cross-phase seams WIRED, E2E flows complete; 0 blocking gaps. [v1.11-MILESTONE-AUDIT.md](milestones/v1.11-MILESTONE-AUDIT.md)
**Known deferred items at close: 4** (see STATE.md → Deferred Items) — 3 `human_needed` verification gaps (109/110/117, QA-pending not code gaps) + 1 stale diagnosed debug session (`bybit-reconcile-3-findings`, 2026-07-04, unrelated).

Turned the scenario composer from a position-editor with a broken role surface into a strategy-blend tool where every source is a daily-series constituent, gated by a coherent manager/allocator role model — and finished the dailies-canonical backbone tail on the allocator surface. Additive over the FROZEN `scenario.ts` engine (SC-3 byte-frozen the whole milestone); zero new deps.

- **109 — ROLE**: nav + all page/API guards derive from one predicate (`profiles.role` persona; `is_admin` ops-overlay only) — dropped `|| isAdmin` from both Sidebar derivations (with an idempotent staff `role='both'` backfill migration), added server-side role enforcement across 7 owned-route entry points incl. 2 new manager segment layouts (closes the ROLE-04 nested-route bypass + the `withAllocatorAuth` 403 cluster).
- **110 — CONTRIB**: allocator "bring your own strategy" via the role-neutral wizard, private-by-default — owner-only `status='private'` (widened CHECK + guarded `p_terminal_status` through both SECDEF finalize RPCs so `published` is finalize-unreachable), `withPublishedOrOwner` Browse predicate + `no-owner-or-on-admin-client` ESLint backstop, and a reusable `ContributionWizardOverlay` (createPortal, zero URL nav). Fable red-team HIGH (owner self-publish via direct PostgREST) closed by `guard_strategies_publish_transition` trigger.
- **110.1 — Dogfooding fixes (INSERTED)**: EmptyState no-keys-vs-connected-but-empty branch, holdings-gated Exchanges affirmative (no fabricated data), honest `PROBE_FAILED` across all 3 key routes.
- **111 — CONSTIT**: the unified constituent model — deleted the separate "Data Sources" section; every source (api-key / CSV / catalog / composite) renders as ONE uniform badged constituent row, per-key include/exclude unified onto the draft's `toggleByScopeRef` channel; 4th `composite` provenance badge + `deriveProvenance`; CONSTIT-05 parity GATE proved the blend = interpretation A (fixed-weight-per-key) to 1e-9 via independent pandas re-derivation; permanent whole-repo grep gate against Data-Sources reintroduction.
- **112 — WEIGHTS (leverage)**: per-key (strategy-level) constituent rows made weight- AND leverage-editable end-to-end onto the engine-unit basis (`wᵢ·Lᵢ·rᵢ`, Pitfall 2 closed), derived read-only Notional column, honest leverage-invariance caveat. A1/Route-1 locked (weight = equity-capital share; notional derived read-only).
- **113 — WEIGHTS (max-DD→L solver)**: a per-row Leverage|Target-max-DD mode toggle back-solves the implied leverage from a target sleeve max-DD — ruin-clamped monotone smallest-L bisect over the frozen engine's `r→L·r` sleeve transform (founder lock 5%→20%→L=4.000), one-shot calculator, honest infeasible states, no schema bump.
- **114 — BACKBONE E1**: golden-gated deletion of `portfolio_metrics.py`'s 2nd Sharpe/vol/TWR stack — re-routed 6 legacy call sites onto backbone-derived helpers, deleted `compute_twr` + `_compute_sharpe_and_vol`, added a permanent delete-gate. Infra phase, no user-facing change.
- **115 / 115.1 — BACKBONE E2 (allocator equity reconstruction)**: Python owns the canonical capital-weighted allocator blend (STITCH-01, port of the Phase-36 TS precedent) + backward $-equity reconstruction from the terminal anchor through the cashflow-neutral return path (STITCH-03/04), real flows + synthetic rotation-seam jumps sharing ONE dated ledger the KEPT Modified-Dietz/MWR scalars consume (STITCH-05/06); 115.1 wires the key-mode broker derive to persist flows + anchor and enqueue an owner-scoped `derive_allocator_equity` compose job that upserts the allocator `equity_curve` display row. **Derived path is DORMANT in prod** behind an `is_trustworthy`-else-legacy fallback until two founder-gated ops run (key-mode backfill + `E2_GROUND_TRUTH_*` anchor reconciliation).
- **116 — ADDALLOC**: context-aware header button — "+ Strategy" opens the Browse drawer on Scenario, "+ Allocation" opens the `ContributionWizardOverlay` inline elsewhere; focus-return + dynamic-import pending-drain so the click is never a silent no-op.
- **117 — UIFIX**: Tooltip converted to SSR-safe `createPortal` + `position:fixed` with viewport clamp + genuine above/below flip + z-clearance over Dialog/drawer; 6 overflow-site focus indicators moved to the clip-proof `ring-inset` idiom (WCAG 2.4.7/1.4.11); CUM RETURN KPI value un-truncated (`break-words` + `min-w-0`, Numbers-Contract integrity).

**Close basis:** per-phase full close pipeline (opus verifier + opus code-review + fresh-context Fable red team) — Fable caught real money-math defects on 112/113 (per-key renorm basis, transient-state seam strandings) both opus passes missed. Deribit key-connect dogfood fixes (credential `.trim()` chokepoint + shared `classifyKeyValidationError`→`KEY_AUTH_FAILED`) landed in the #622 tail. Migration `20260717233529` applied+verified; Vercel + Railway healthy.
**⛔ Rolled back at close (2026-07-18):** the derived-allocator-curve FLIP (`phase35_backfill_enqueue`, 24 keys) WEDGED the sequential prod worker on a slow live exchange crawl (deribit native ledger ~inception; bybit 19k rows) → healthz stale 12 min. Recovered by deleting flip jobs + emptying `allocator_equity_derived` (0 curves ever shown) + unscheduling the `derive-allocator-key-dailies` cron. **Root-cause fix required before retry** (→ v1.12): hard `asyncio.wait_for` per derive exchange-crawl + batched/off-hours backfill on its own worker, THEN E2_GROUND_TRUTH validation.

**Archive:** [v1.11-ROADMAP.md](milestones/v1.11-ROADMAP.md) · [v1.11-REQUIREMENTS.md](milestones/v1.11-REQUIREMENTS.md) · [v1.11-MILESTONE-AUDIT.md](milestones/v1.11-MILESTONE-AUDIT.md) · [v1.11-phases/](milestones/v1.11-phases/)

---

## v1.10 Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification (Shipped: 2026-07-15)

**Shipped:** v0.43.0.0 @ `32494ba2` (PR #619, tag `v1.10`) — Phases 98–108 (12 phases, 43 plans, 65 tasks).

**Key accomplishments:**

- **Portfolio Intelligence dashboard (PI-01..07)** — Exposure-by-Class, Net-Exposure-over-Time, and Allocation-over-Time widgets rendering real position/weight-history data over an owner-scoped secretless read layer (`allocator_holdings`); the hardcoded 10% favorites sleeve replaced by the real score-ranked optimizer output (sort/group/bulk + narrative tooltips); a Notes widget on new owner-scoped `user_notes` storage; `PortfolioKPIRow` folded into a shared `KpiPanel` primitive; and a real-PG partial-UNIQUE fence killing cross-process duplicate-`computing` rows (PI-07).
- **Options MTM toggle moves the WHOLE factsheet (MTM-01..04)** — the `cash_settlement ↔ mark_to_market` basis toggle now swaps the daily return SERIES (not just the seven scalars), so every chart follows for both single-key and composite, with a full per-basis coverage mask (MTM gaps marked, never zero-filled) and honest degrade-with-reason gating; `cash_settlement` stays byte-identical (SC-4).
- **The dailies-canonical backbone (BB-01..03)** — `services/basis_series.py::derive_basis_series` became the ONE shared "persist dailies → derive scalars → build coverage mask" route both derive sites call; the composite stitch and onboarding arms route through it (throwaway `_metrics_result_for` retired, grep-gate 0); the trades-based legacy analytics chain (~910 LOC) + all 4 dark re-entry points deleted; `USE_COMPUTE_JOBS_QUEUE` made mandatory (kill-switches gone).
- **Leverage as a dailies transform (LEV-BB)** — leverage became an `r→L·r` preparation transform composed into the one `useBasisSeriesView` hook so the whole factsheet re-derives levered (charts + rail + honest α→L·α, β→L·β); the frontend `useLeveragedMetrics`/`useModeledLeverage` re-scale + MODELED/CAVEAT disclosure apparatus (~780 LOC) deleted; L=1 by-reference byte-identity; measured-235ms derive debounced via `useDeferredValue`.
- **Scenario-planner onto the backbone (SCEN-BB)** — blend panels derive from a new `scenario-blend-adapter.ts` calling the canonical `factsheet/rolling.ts` population-std primitives; the bespoke 211-LOC `scenario-blend-panels.ts` second-Sharpe compute + its 251-LOC test deleted behind a permanent liveness-proven delete-gate; SC-4 pixel parity via a 3-line render-tree-untouched consumer rewire.
- **Quality**: every phase ran the full close pipeline (opus code-review + opus verifier + fresh-context Fable red team); Fable caught real defects on 107 (L=0 pin misfire, per-panel base-1× overclaim) and 108 (lost crypto-√365 mutation guard) that both opus passes missed. Full suite 8161+ green; coverage thresholds held.

**Known deferred items at close: 5** (acknowledged tech-debt, see STATE.md → Deferred Items):

- 4 optional `human_needed` VERIFICATION.md bookkeeping gaps (phases 98/103/107/108) — all phases shipped + prod-verified; verification artifacts are bookkeeping, not functional gaps.
- 1 stale/diagnosed debug session (`bybit-reconcile-3-findings`, 2026-07-04) — unrelated to v1.10.

**Deferred → v1.11:** M-C CI/Test-Infra Ratchet (incl. the `-n auto` fence parallelization); E1/E2 portfolio-aggregation + allocator-equity-reconstruction onto the backbone (out-of-scope live Sharpe stacks); M-B cron/notification reliability.

---

## v1.9.1 Composite Onboarding Hardening (Shipped: 2026-07-12)

**Phases:** 6 (92–97) | **Timeline:** 2026-07-11 → 2026-07-12
**App version:** v0.41.1.0 (PR #611, `be215b15`)
**Tag:** `v1.9.1` @ commit `be215b15`
**Diff:** 79 files, +12,368/−1,596 (squash commit `be215b15`)
**Ledger note:** Shipped via ONE PR at milestone close (branch `gsd/v1.9.1-composite-onboarding-hardening` accumulated all phases; `.planning` gitignored/local). `/gsd-complete-milestone` run at ship time (this archive). Closed on the green `frontend` branch-protection gate + all post-merge deploys verified.

Hardens the v1.9 multi-key composite onboarding flow, driven by live SC-3 dogfooding failures (Zavara 3-key Deribit composite). Single-key + existing published Deribit-only composite metrics stay byte-identical (SC-4).

- **92 — Composite Metric Blow-Up & Annualization Honesty**: `pnl_dominated_guard` clamps degenerate inverse-Deribit days (`|r|≥10`, strict no-op below); `insufficient_window` DQ flag at the CAGR site; shared `NAV_TWR_GUARD_KEYS` registry.
- **93 — Composite Data-Path Correctness**: first-key window persisted; `cumulative_method` persisted at stitch (read-path prefers persisted); multi-venue (Bybit/OKX/Binance) reconstruct honestly or degrade with a DQ reason.
- **94 — Wizard Resumability**: secretless `composite/members` GET + `set-members`; draft rehydration; non-destructive "Review your keys"; clickable stepper; cached-snapshot back-nav.
- **95 — Stitch Progress Transparency**: secretless `sync-progress` route; fenced per-member progress (`set_compute_job_progress` SECDEF RPC); `useStrategySyncPoller`; 12-min stall backstop + interrupted banner + idempotent retry.
- **96 — Draft & Key Hygiene + Onboarding Polish**: daily `cleanup_abandoned_wizard_drafts` SECDEF cron (7d draft delete + orphaned-key sweep, published-guard + sanitize_user GUC respected); wizard `X-Correlation-Id`; Deribit `DRB` badge.
- **97 — Composite CI & Schema Debt**: live compute-job claim scoping (`want_job_id`) + offline decoy regression; audit instrumentation; 3 owed SQL-fn snapshots. **`-n auto` parallelization DEFERRED** (global-claim fence tests flake under xdist; `python` kept serial, green); #610 closed as absorbed.

**Close basis:** whole-diff specialist fan-out (frontend/analytics-SC-4/RLS) → 1 HIGH fixed (retry patience-clock) → whole-diff fable red team → 2 fixed (set-members draft gate MEDIUM; fence-boolean contract LOW) → migration re-clearance CLEAN → green CI (after mypy narrowing + test-DB catch-up + serial revert).
**Deploy verified 2026-07-12:** 3 migrations on prod (functions + draft gate + ACLs); Railway analytics worker on `git_sha be215b15` (/health ok, ticking); Vercel prod (quantalyze.xyz 200).
**⚠️Open gate:** SC-3 piece 3 — live GUI-onboarded Zavara smoke test (real Deribit keys + running worker + `USE_COMPUTE_JOBS_QUEUE=true`) still user-run; NEVER claimed live-attested.
**Carry-forward (TODOS.md):** in-flight `computing` stale-attest window (finalize `after()` backstop); D-1 cleanup READ-COMMITTED race; same-user set-members TOCTOU; **Phase-97 `-n auto` parallelization deferral** (needs per-test claim-space isolation).
**Archive:** [v1.9.1-ROADMAP.md](milestones/v1.9.1-ROADMAP.md) · [v1.9.1-REQUIREMENTS.md](milestones/v1.9.1-REQUIREMENTS.md) · [v1.9.1-phases/](milestones/v1.9.1-phases/)

## v1.9 Multi-Key Composite Strategy (Shipped: 2026-07-11)

**Phases:** 8 (85–91 + 90.5) | **Timeline:** 2026-07-10 → 2026-07-11
**App version:** v0.41.0.0 (PR #607, `044bee50`)
**Tag:** `v1.9` @ commit `044bee50`
**Diff:** 122 files, +20,412/−141 (squash commit `044bee50` — the milestone's self-contained content; intervening main PRs #599–#605 were non-milestone asset-class/dep work under v0.39–v0.40)
**Ledger note:** Shipped via ONE PR at milestone close (branch accumulated all phases; `.planning` gitignored/local). Milestone closed on the green `frontend` branch-protection gate + the #338 invariant proven 4 independent ways; the sole red check was one redundant advisory `e2e-seeded` test (#338 discoverability 200-vs-404), deferred to a post-deploy fix per user decision.

Onboards ONE strategy from N API keys — each with its own active window — through the wizard → stitched track record → composite factsheet with gap markers + an honestly-gated `cash_settlement ↔ mark_to_market` basis toggle + dynamic per-strategy leverage. Composites are geometric-by-default (arithmetic only for the Zavara allocated-capital override), route through a shared `composite-read-path.ts` on both the `/factsheet/[id]/v2` and discovery detail surfaces, and finalize via the `stitch_composite` queue path (prod backbone on + `USE_COMPUTE_JOBS_QUEUE=true`).

- **85 — Thin Data Model (`strategy_keys`)**: per-key active-window rows + owner-coherence + RLS; migration-first.
- **86 — Production Stitch Endpoint**: `stitch_composite` worker path; Zavara 3-key composite corroborated LIVE at cum 62.6646% / maxDD −4.1328%.
- **87 — #338 All-N-Keys-Complete Publish Gate**: a composite only publishes once every member key's ingestion is complete (published-sole-writer guard + supersede-failed-per-kind).
- **88 — Wizard Multi-Key Onboarding UX**: `MultiKeyConnectStep` + composite finalize routing (branches to the stitch_composite queue before the unified-backbone arm, which rejects composites).
- **89 — Composite Preview**: `SyncPreviewStep` composite render + `attributionBasisFromConfig` (geometric/arithmetic mirror of `job_worker.py`).
- **90 — Factsheet Markers + Basis Toggle**: gap markers on the stitched series + fail-loud-gated `cash_settlement ↔ mark_to_market` toggle (basis-context; structural-absence vs degenerate-null contract).
- **90.5 — Dynamic Per-Strategy Leverage**: LEV-01 single-key factsheet leverage (composites fail-closed); LEV-02 scenario-planner Save persistence across all three draft readers (composer/share/compare) with clamp-on-read.
- **91 — Frontend Test & QA**: seed-gated composite onboarding + render e2e, wizard axe, published-sole-writer guards; verifier 7/8.

**Close basis:** green `frontend` gate + M-1/M-2 ship-review fixes (member 429 arm + coverage-mask preservation) with fable red-team CLEAN sign-off. Deploy verified: 5 migrations on prod, Railway analytics worker force-deployed past a red-CI-timing skip (healthy), Vercel prod Ready.
**⚠️Open gate:** SC-3 piece 3 — the one-shot LIVE GUI-onboarded 3-key Zavara session (real Deribit keys + running worker) is a user-run smoke test; NEVER claimed live-attested by the orchestrator.
**Carry-forward:** #338 discoverability 200-vs-404 (draft composite returns 200 not 404 at `/strategy/[id]`; app-layer, needs live route instrumentation) → post-deploy fix; Phase-90 LOW-2 chart-method/headline drift → worker-side persist-method root-cause.
**Formally closed:** 2026-07-11 via manual reconciliation (`/gsd-complete-milestone` never run at ship time). Local phase working-dirs (85–91) and v1.9 `REQUIREMENTS.md` were deleted/overwritten by a `phases.clear` during `/gsd-new-milestone v1.9.1` before this archive existed — unrecoverable (`.planning` gitignored); all shipped code is safe under tag `v1.9`.
**Archive:** [v1.9-MILESTONE-AUDIT.md](milestones/v1.9-MILESTONE-AUDIT.md) · [v1.9-ROADMAP.md](milestones/v1.9-ROADMAP.md) · [v1.9-phases/](milestones/v1.9-phases/) (stub — artifacts un-recovered)

---

## v1.8 Flow-Aware Time-Weighted Returns + Native-Unit NAV (Shipped: 2026-07-09)

**Phases:** 8 (73–80) | **Timeline:** 2026-07-07 → 2026-07-09
**App versions:** v0.38.0.0 (PR #590, `4b3a2c24`) → v0.38.2.0 (PR #598, `eb8e357e`, Phase 80 native adapter)
**Tag:** `v1.8` @ commit `eb8e357e`
**Diff:** 92 files, +26,358/−1,117 (9a1e7b8e→eb8e357e, 10 commits)
**Ledger note:** Recorded 2026-07-10 via manual reconciliation — `/gsd-complete-milestone` was never run at ship time (closed on founder sign-off + git tag). Phases 79–80 (native-unit) were locally mislabeled "v1.9" in a premature roadmap; they shipped **inside this v1.8 tag** (PR #598) and are folded here. Boundary set to Phases 73–80 per the 2026-07-10 versioning decision.

Replaces anchor-to-today return reconstruction with true chain-linked time-weighted returns from a daily NAV series that dates every external cash flow — flow-heavy accounts stop being silently over/under-stated on every venue. Phases 73–78 built the USD-space flow-aware TWR core + per-venue dated flows + fail-loud DQ guards + golden parity; Phases 79–80 added per-settlement-currency **native-unit** reconstruction (coin-margined accounts valued at daily `{ccy}_usd` marks; USD-native byte-identical via SC-4) and routed Deribit through it. Discharges the v1.7 P72 LTP acceptance canary (ACC-02).

- **73 — Pure NAV/TWR Core**: backward daily-NAV reconstruction + chain-linked TWR (GIPS) + fail-loud DQ-01 guards + split annualization basis; ACC-01 parity classifier primitive. I/O-free, revert-proof.
- **74 — Funnel Wiring (both callers)**: routed both callers of the buggy `trades_to_daily_returns_with_status` through the core with `external_flows` + `open_unrealized_usd`; deleted the silent `estimated_start ≤ 0 → account_balance` fallback. Zero-flow byte-identical.
- **75 — Deribit Dated-Flow Adapter (RISKY)**: `ExternalFlow` contract + in-band txn-log dated flows, inverse BTC/ETH coin→USD event-time valuation, fail-loud on absent settlement index.
- **76 — Binance/Bybit/OKX Flow Adapters + Reconciliation Gate**: per-venue dated flows via promoted-shared fetch with own-transfer exclusion + DQ-02 missing-flow/retention-terminus gate.
- **77 — uPnL Basis Reconciliation**: explicit realized-basis roll; uPnL re-added only to current NAV; `unrealized_pnl_in_anchor` DQ flag when the wedge is material (FLOW-04 end-to-end).
- **78 — Golden Parity + P72 Acceptance (GATING)**: old-vs-new golden parity gated the production switch (flow-less accounts unmoved, LTP068 moves, every delta explained); v1.7 LTP P72 canary re-ran green.
- **79 — Pure Native-Unit Core + Guard Hardening**: `native_nav.py` core, classifier + refuse errors, `cumulative_twr_segmented` (no silent chain-bridging), `_INVERSE_CURRENCIES` generalization, SC-4 identity suite. Pure/additive.
- **80 — Deribit Native Adapter + Production Switch (RISKY, GATING)**: `build_deribit_native_ledger` + Deribit routed through the native core; merge hard-gated on SC-4 identity + §5 inception on 3 real keys + founder-signed golden parity. Absorbed ACC-02; Zavara track corroborated (cum 62.66% vs 62.60%, maxDD −4.13% vs −4.11%).

**Close basis:** founder sign-off 2026-07-10 ("keys stitched, results match their claims" = ACC-02 gate iii; "gate ii is reconciled" = INCEPT-01). All 3 Phase-80 gates green.
**Carry-forward (deferred to Backlog):** Phase 81 (ccxt venues native + USD-space legacy retirement — Bybit/OKX/Binance per-venue-when-verifiable) never started; the daily-option mark-to-market exploration (Phase 83 dir) stayed uncommitted (5 stashes). `mark_to_market` remains a live `pnl_basis`; multi-day-option MTM smoothing surfaces as the v1.9 factsheet basis toggle.
**Archive:** [v1.8-phases/](milestones/v1.8-phases/) · [v1.8-native-unit-ROADMAP.md](milestones/v1.8-native-unit-ROADMAP.md)

---

## v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down (Shipped: 2026-07-05)

**Phases:** 7 (66–72) | **Timeline:** 2026-07-04 → 2026-07-05
**App versions:** v0.37.0.0 → v0.37.7.0
**Tag:** `v1.7` @ commit `9a1e7b8e`
**Diff:** 118 files, +14,552/−1,285 (f78f036b→9a1e7b8e, 15 commits)
**Ledger note:** Recorded 2026-07-10 via manual reconciliation (never run through `/gsd-complete-milestone`; closed on founder sign-off + git tag). P72 LTP acceptance was carried into v1.8 and discharged there (ACC-02).

Added Deribit as a first-class exchange (the first coin-margined/inverse venue) end-to-end — live harness + ground truth, key validation + boundary wiring, onboarding wizard UX, trades/dailies ingestion via the txn-log `change` field, allocator derivative positions — and burned down the v1.6 carry-forward list.

- **66 — Carry-Forward Burn-Down**: v1.6 deferred items (dead SSR pipeline, share-mint disjunct, save-cap error, deploy-skew window).
- **67 — Deribit Live Harness + Exchange Ground Truth**: authenticated live probe + ground-truth reconciliation scaffolding.
- **68 — Boundary Wiring + Key Validation**: Deribit credential resolution + scope assertions at the ingestion boundary.
- **69 — Onboarding UX (wizard card + setup guide)**: Deribit path through the strategy wizard.
- **70 — Trades Ingestion + Dailies (RISKY)**: realized dailies via the txn-log `change` field (v1.7 RISKY).
- **71 — Allocator Positions**: Deribit allocator derivative positions (v1.7 DRB-09).
- **72 — LTP Onboarding + Acceptance**: LTP068 onboarding through the ledger path; the P72 canary that discovered the anchor-to-today +458%/229,214% inflation (root cause of v1.8).

**Close basis:** ACC-02 / P72 canary satisfied under v1.8's corrected returns (founder-confirmed 2026-07-10).
**Archive:** [v1.7-phases/](milestones/v1.7-phases/)

---

## v1.6 Scenario Series-Space Purification (Shipped: 2026-07-04)

**Phases:** 4 (62–65) | **Plans:** 12 | **Timeline:** 2026-07-03 → 2026-07-04
**App version:** v0.36.0.0 (single PR #572, squash `f78f036b`)
**Tag:** `v1.6` @ commit `f78f036b`
**Audit:** PASSED (gsd-audit-milestone 2026-07-04; 16/16 requirements, 4/4 phases, 6/6 integration seams WIRED, 0 blockers) — [v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)
**Diff:** 53 files, +4,301/−3,691

The scenario tab now operates purely in SERIES SPACE (return streams blended over a window), never position space: both P61 bugs were position-space machinery leaking into series space, and this milestone removed the machinery. MEMBER landed before ENGINE by design — persisted membership replaced the runtime gate as the draft's source of truth, so the deletion had a persisted selector to stand on. The frozen engine (`scenario.ts` + `scenario-window.ts`) stayed zero-diff the whole milestone (GUARD-03, vs pre-milestone `e5e83247`).

- **62 — Explicit draft series membership (schema v4)**: `memberKeyIds` persisted alongside `addedStrategies` (v2/v3 → v4 NON-destructive codec branches + reopen derive-and-stamp); tolerant shared codec vs strict save-route schema; compare selects the engine by persisted membership (blank drafts NEVER merge the live book — red-team F5 closed by construction); ONE `isBookOnlyDraft` across mint/resolve; ineligible-member reopen disclosure; memberKeyIds round-trip pinned in the shares RLS SQL (over-return guard byte-intact).
- **63 — Holdings-snapshot fallback engine removal**: staged deletion (blank-mode init → composer path → compare path → adapter builder + gate=false SSR `emptyDefault` repoint → scenario-dealias retirement behind a 3-precondition gate); ONE `buildAddedOnlySet` engine across composer/compare; optimizer apply-back renormalizes over the engine universe; ENGINE-05 source-scan + runtime guard (non-vacuity proven); GUARD-01 prod residue holdings deleted (gate_false_holders=0); P61 suites survived or reviewed-repointed (GUARD-02).
- **64 — Presentation purification**: scenario KPI strip return-form only — AUM cell + dead prop chain removed, 4-up @lg reflow (PRESENT-01) with the commit-modal weight×AUM boundary byte-intact (PRESENT-02); public mixed shares carry the verbatim honesty caption "computed from this scenario's catalog strategies only", derived server-side from membership with zero member-UUID exposure (PRESENT-03).
- **65 — Authed prod canary (GUARD-04)**: full chain live on v0.36.0.0 (qa-demo, Atlas book) — book/blank/mixed render, F-1 fix verified at the persisted-draft layer (blank-session reopen adopts book basis; Update preserves membership), compare on persisted membership with the P61 goldens reproduced (155 overlapping days; Sharpe 0.11 @ 40d; "Mean of 5"), share mint/resolve honest (caption + leak-clean + book-only 409), delete cascade → 404. **0 bugs found.**

**Ship-review chain:** 6-specialist fan-out (8 findings) → fix pass → **Fable red team** caught F-1 CRITICAL pre-landing (blank-session "Update portfolio" silently wiped persisted book membership — an emergent interaction of two individually-correct fixes, invisible to per-dimension review) → root fix + 3 RED-verified regression tests → canary-confirmed live.

**Carry-forward (TODOS.md, git-tracked):** P1 dead `holdingReturnsByScopeRef` SSR pipeline removal (planning-locked KEEP through v1.6); P2 dead share-mint `isBookOnlyDraft` disjunct (F-3); P3 >64-key save-cap misleading error (F-5); P3 deploy-skew membership strip window (F-4). Ledger-only: `holdingsSummary` SSR removal, 6 `phase10-rpc-*` residue auth.users rows, D3 toggle persistence, friendly gantt key labels, compare-panel payload-cast type-safety.

**Archive:** [v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md) · [v1.6-REQUIREMENTS.md](milestones/v1.6-REQUIREMENTS.md) · [v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md) · phases: [v1.6-phases/](milestones/v1.6-phases/)

---

## v1.5 Scenario Coverage-Window Blend (Shipped: 2026-07-03)

**Phases:** 7 (55–61) | **Plans:** 16 | **Tasks:** 29 | **Timeline:** 2026-07-01 → 2026-07-03
**App versions:** v0.35.0.26 (#565) → v0.35.0.31 (#570)
**Tag:** `v1.5` @ commit `f8b502e7`
**Audit:** PASSED (gsd-audit-milestone 2026-07-03; 28/28 requirements satisfied, 7/7 phases, 6/6 integration seams WIRED, 5/5 flows) — [v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md)
**Diff:** 88 files, +28,116/−623 (excl. lockfile), across PRs #565/#566/#567/#570 (+ CI-speed #568/#569 adjacent)

The frozen `scenario.ts` engine's union/0-fill/every-started-divides convention was DELIBERATELY rewritten to coverage-window membership: a strategy is a blend member iff enabled AND its span covers the explicit window; the divisor counts members only, weighted blends renormalize, and an ended strategy no longer dilutes the tail toward zero. The change is legible in the UI, durable across save/share/compare, and was verified live on authed prod. SCENARIO-05 zero-diff + frozen-spine guards re-baselined as a reviewed act (first deliberate engine change since v1.2).

- **55 — Coverage-window compute core**: explicit `state.window` on `computeScenario`; member iff span ⊇ window; `member_count`/`member_ids`/`effective_start`/`effective_end` exposed on `ComputedMetrics`; pure zero-dep `scenario-window.ts` helpers; BLEND-07 gate pins the blend to an independent from-scratch numpy re-derivation to fp precision. /ship review caught+fixed a CRITICAL: the diversification panel computed on the raw union axis (re-leaking exactly what v1.5 removes). (#565, v0.35.0.26)
- **56 — Factsheet parity re-verify**: two-layer PARITY-01 guard — source-scan pins the factsheet payload re-derives no blend; runtime case proves factsheet == engine on the member-windowed series. (#565)
- **57 — Window control & auto-toggle**: intersection default (seeded once), "Common period (all in)" ⟷ "Full range (some drop out)" presets, widen→auto-drop / narrow→auto-restore strictly within the selected subset, guided empty-intersection fix naming the outlier(s); brush-zoom stays a view axis (POLISH-01 guard). (#565)
- **58 — Coverage legibility**: honest blend header (members · window · N, "1 strategy — not a blend" degrade), three-state row chips, coverage-timeline mini-gantt, include-cost affordance ("Include → shortens window to {date} (−N mo)"), one-time default-change note. (#566, v0.35.0.27)
- **59 — Persisted windows**: `draft.window` in the saved JSONB (schema v2→v3 NON-destructive `upgraded_v2_windowless` codec branch); reopen recomputes at the owner's window; share threads it verbatim through the SECDEF RPC (leak-scan proven); compare computes each column at its own window with per-column effective-window labels. 27-finding review cycle (25 fixed). (#566)
- **60 — Golden & e2e re-bake**: honestly re-scoped — the assumed bake was a PROVEN no-op (evidence artifact); the restored unconditional e2e net immediately caught 3 latent bugs (browse-catalog row cap, heatmap WCAG dead-band, scroll-region focus), all fixed at root. (#567, v0.35.0.28)
- **61 — Authed prod canary**: core VERIFY-02 all pass live (qa-demo, Atlas book); all six deferred 58/59 HUMAN-UAT items executed; canary DISCOVERED P61-BUG-1 (drawer-adds inert in book mode — the CSV-strategies+API-keys path) and P61-BUG-2 (saved/shared/compared book drafts empty) — both root-caused, fixed tests-first (`mergeAddedIntoPerKeySet`; compare mirrors the composer engine-set; book-only shares 409 honestly), red-teamed, and prod-re-verified ("Mean of 5"). (#570, v0.35.0.31)

**Carry-forward:** series-space purification scoped as v1.6 input (`.planning/v1.6-SERIES-SPACE-INPUT.md`) — remove the (now user-less) holdings-snapshot fallback engine, persist explicit draft series-membership (closes red-team F5), AUM out of the KPI strip, share-page partial-projection caption (F3). Pre-existing /demo empty state still open (task #7).

**Archive:** [v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md) · [v1.5-REQUIREMENTS.md](milestones/v1.5-REQUIREMENTS.md) · [v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md) · phases: [v1.5-phases/](milestones/v1.5-phases/)

---

## v1.4 Frontend Excellence (Shipped: 2026-06-30)

**Phases:** 6 (49–54) | **Plans:** 41 | **Tasks:** 81 | **Timeline:** 2026-06-29 → 2026-06-30
**App versions:** v0.35.0.6 (#538) → v0.35.0.12 (#553)
**Tag:** `v1.4` @ commit `4c4ca537`
**Audit:** PASSED (gsd-audit-milestone 2026-06-30; 36/36 requirements code-satisfied, 6/6 phases, 33/33 integration REQ-IDs wired, 5/5 flows) — [v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md)
**Known deferred items at close:** 10 (2 UAT + 8 verification gaps; see STATE.md Deferred Items). The two design-deferrals that matter: real-device authed sign-off (VERIFY-05, human checkpoint) + live golden-PNG bake (VERIFY-01/04, deliberate per-chart CI re-baseline, never blind `--update-snapshots`). The rest are historical per-phase statuses accepted at each ship point, plus stale leftovers from already-closed milestones (phases 16/23/24).

App-wide UI/UX overhaul: a state-of-the-art design system + fluid token spine, refreshed/added primitives, a restructured shell/IA, per-surface application of the evolved system across every surface, and app-wide verification — while the `scenario.ts`/`compute.ts`/`FactsheetBody` math and the WCAG-AA floor stayed LOCKED (desktop byte-identity lifted). Net-new prod footprint was one dep (`radix-ui@1.6.0`, scoped to non-native widgets); fluid type / container queries / motion / visual regression all rode existing platform features.

- **49 — Design-system refresh + fluid token spine**: DESIGN.md refreshed to a state-of-the-art aesthetic; fluid `--text-*`/`--space-*` in a plain `@theme` block; `clamp-without-rem` (F94 zoom) / `no-raw-hex` / `no-raw-px-font-size` lint guards; DESIGN.md↔token drift tests + a v1.4 frozen-spine guard. (#538, v0.35.0.6)
- **50 — Primitive refresh + missing primitives**: refreshed Button/Card/Input/Badge/Modal/Skeleton + new Table/Tabs/Dialog/Select/Field/Breadcrumb (`radix-ui` scoped to non-native widgets only); `ErrorEnvelope` + 9-state matrix + `MetricCell` em-dash-for-null as reusable state primitives; strangler migration. (#539, v0.35.0.7)
- **51 — Shell + IA restructure**: `(marketing)` URL-invisible route group + shared masthead/footer; nav refinement + breadcrumbs + searchParams-aware active/back states; route-contract inventory + guard + `PUBLIC_ROUTES` sync + redirect map + authed canary (avoids the #512 307→login regression class). ⌘K palette deferred (NAV-F1). (#545, v0.35.0.8)
- **52 — Per-surface: allocator journey**: /allocations, composer, factsheets, discovery, single-strategy render the evolved system — fluid no-clip type, `@container` reshape, data-table reshape, honest route loading/error states, fluid-fill to ~1920px; composer stays a frozen client island (BODY-02 byte-identical). (#551, v0.35.0.10)
- **53 — Per-surface: wizard/security/admin/public**: the lower-traffic surfaces render the evolved system with a per-surface DESIGN.md-conformance exit gate (prevents "two apps" drift); wizard gains a review step + inline validation; full `loading.tsx`/`error.tsx`/skeleton/empty coverage; no-invented-data held. (#552, v0.35.0.11)
- **54 — Verification + v1.3 debt cleanup + VR replacement**: 2560px ultra-wide row added to the axe/reflow matrix; authed/mobile axe rows re-enabled hermetically (seeded MA-8, crypto-sma teardown by id); lhci ratcheted 0.60→0.65; runtime no-clip CI guard (`e2e/no-clip-sweep.spec.ts`); tolerance-based Playwright goldens (bake deferred-to-CI via WR-02 green-by-skip); `no-raw-font-px` flipped to `error` repo-wide (233 raw-px sites across 60 files migrated byte-identically, frozen-chart islands off-glob exempted); app-wide design-review audit PASS; 7206 tests green. (#553, v0.35.0.12)

**Archive:** [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) · [v1.4-REQUIREMENTS.md](milestones/v1.4-REQUIREMENTS.md) · [v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md) · phases: [v1.4-phases/](milestones/v1.4-phases/)

---

## v1.3 Mobile & Adaptive UI (Shipped: 2026-06-28)

**Phases completed:** 5 phases, 21 plans, 55 tasks

**Key accomplishments:**

- Extracted TimeSeriesChart's responsive SVG recipe into a reusable `ResponsiveChartFrame` (forwardRef <svg> emitting verbatim viewBox / preserveAspectRatio='xMidYMid meet' / 'block w-full' / aspect-ratio style), then refactored TimeSeriesChart to render through it with byte-identical output — guarded by a falsifiable structural unit test, not the dead e2e parity spec.
- A falsifiable Vitest source-scan guard (clone of chart-accessibility-layer.test.ts) that fails the build on any zoom-disabling viewport directive anywhere in src/, plus an explicit zoom-permissive `export const viewport: Viewport` in the root layout — closing the WCAG 1.4.4 Resize Text gap axe structurally cannot test.
- A reusable `e2e/helpers/reflow.ts` (`assertNoReflow` + `assertTargetSizes`) plus a 320px reflow gate and a 44px target-size gate on the public `/security` route, both FLOW-01 dual-wired into ci.yml's unseeded list — closing the two WCAG checks axe structurally cannot do (1.4.10 Reflow, 2.5.8 Target Size), with the false-green and never-run traps both designed out.
- Role-aware mobile bottom nav single-sourced from a new `buildPrimaryMobileNav` helper (no hardcoded TABS), plus a hardened drawer shell: background `<main inert={menuOpen}>` and an app-shell skip-link targeting `<main id="main-content" tabIndex={-1}>` on every authed route.
- CSS-first horizontally-scrollable allocator tab strip at `<sm` (flex-nowrap + overflow-x-auto, scroll-snap, hidden scrollbar) with active-tab `scrollIntoView` honoring prefers-reduced-motion — JOURNEY-03 role=tablist/role=tab siblings and the `data-allocator-tabstrip` anchor preserved.
- A SEEDED authed Playwright spec (`e2e/mobile-drawer-keyboard.spec.ts`) that proves the Plan 45-01 drawer hardening: skip-link is the first focusable and jumps to `#main-content`, focus moves into the drawer on open, Tab/Shift+Tab stay contained inside `#mobile-sidebar-drawer` while the background `<main>` is `inert`, Escape restores focus to the hamburger, and at 320px the nav shell does not reflow with bottom-nav/hamburger targets ≥44px — dual-wired into BOTH FLOW-01 sites.
- Wrapped the 3 HoldingsTable inner tables + OpenPositionsTable in the existing `ResponsiveTable` (CSS-first horizontal scroll + ARIA region, zero restyle) and added a falsifiable all-columns render guard pinning legacy-7 and design-9 holdings columns against a future `hidden`/`truncate` column-drop.
- Two parametrized Playwright reflow sweeps (public unseeded + seeded authed, with a degenerate honest-empty route) proving every curated route has no horizontal page overflow at 320px — FLOW-01 dual-wired into ci.yml and grep-proven; honest-state components verified fluid with zero code change.
- Extracted the TimeSeriesChart touch tap-to-pin gesture core into one thin shared `useTapPin` hook (slop 8px / <350ms / touch-only / re-tap-toggle / pointerleave-survival) with a caller-supplied `pointerToIndex` contract and a 100%-branch, falsifiable unit suite — TimeSeriesChart.tsx left byte-identical.
- Brought the 5 no-hover hand-rolled SVG panels (EndOfYearBars / QuantileBoxPlot / CorrelationStrip / CorrelationsMatrix / Signatures / CrossSignatures / Histogram / MasterBrush) to 320px legibility + portrait tuning by wrapping each root svg in ResponsiveChartFrame and gating font/tick/viewBox-height behind a `useBreakpoint` mobile branch — desktop branch returns today's exact literals (byte-identical), correlation matrix keeps ALL cells, and a Wave-1 both-branch test holds the branch-coverage ratchet in-wave with a falsifiable desktop byte-identity assertion.
- Brought the THREE hand-rolled SVG charts with a real desktop value-reveal to touch tap-reveal/pin parity (CHART-01a) via the shared `useTapPin` hook — a tap reveals AND pins the SAME value the desktop hover/`<title>` shows, with pointer-coarse-only ≥44px hit targets — plus their 320px legibility (CHART-02) and portrait (CHART-03) tuning, while the desktop hover path and the desktop render stay byte-identical (every tuning gated behind `isMobile`; the hook fires only for `pointerType "touch"`), no value recomputed, and both viewport arms + the tap path covered in-wave so the BLOCKING branch ratchet (75.33% ≥ 72) holds.
- Brought the two standalone (non-factsheet-panel) no-hover hand-rolled SVG charts — ReturnQuantiles (box plot) and MonteCarloBandChart (allocations confidence-band fan) — to 320px legibility + portrait tuning by wrapping each root svg in ResponsiveChartFrame and gating font/tick/viewBox-height behind a `useBreakpoint` mobile branch (desktop branch returns today's exact literals, byte-identical), dispositioned Sparkline as an explicit NO-OP, and proved MonteCarloBandChart's desktop byte-identity via a falsifiable Vitest COMPONENT test because the seeded e2e route renders 0 positions and never mounts the fan (Pitfall 4) — both new isMobile branches exercised in-wave so the BLOCKING branch ratchet (>=72) holds at 75.32%.
- Stood up the falsifiable verification for the whole of Phase 47: a fresh seeded `e2e/svg-chart-parity.spec.ts` that bakes DESKTOP byte-identity goldens (the no-recompute proof, CHART-03) AND 320px PORTRAIT snapshots (CHART-02 legibility floor + CHART-03 portrait) for the in-scope hand-rolled SVG factsheet panels; an extension to `e2e/target-size.spec.ts` asserting the tap-reveal charts' coarse hit-rects ≥44px at 320px (CHART-01a); and FLOW-01 dual-wiring both gates into the ci.yml MA-8 seeded list — with the corrected route (`/factsheet/[id]/v2`, the real FactsheetView mount point, not the plan's literal `/strategy/[id]/v2` whose in-scope charts the seed suppresses), no placeholder PNGs committed (the seed env is absent locally so goldens bake on the first seeded CI run), the dead Recharts spec left for Phase 48, and the coverage ratchet (lines 84.85 / stmts 82.68 / fns 78.66 / branches 75.33, all ≥ thresholds) + SCENARIO-05 + BODY-02 + metrics-parity all green and un-weakened.
- All 18 tooltip-bearing Recharts charts now render their tooltip through the breakpoint-gated TouchTooltip shim (mobile tap-to-pin via `trigger="click"`, desktop byte-identical via the default `trigger="hover"`); OutcomesWidget and EquityChart deliberately untouched.
- Wired CHART-01b touch parity into the 2277-LOC hand-rolled EquityChart by integrating the Phase-47 `useTapPin` hook additively onto its existing `<svg>` — a tap pins exactly what desktop hover reveals because `pointerToIndex` and `handleMove` route through ONE shared pure helper (`epochIndexFromPx`); the desktop mouse path and the ResizeObserver/projection-memo regions are untouched.
- One parametrized WCAG-AA axe matrix over every primary route × {Desktop, mobile 375}, the 4 public routes remediated at root so the full strict matrix is honestly green, the EquityChart coarse tap-rect gate, and the spec FLOW-01 dual-wired into both ci.yml lists.
- 1. [Rule 1 - Bug] Wave-0 lighthouserc stub used an invalid `preset: "mobile"`

---

## v1.2.2 — scenario-tab-factsheet-parity (Complete Payload → Mount Real Body → Constituent Correlation → Peer Override + Mandate → Fold & Guards)

**Shipped:** 2026-06-26
**Phases:** 5 (39–43) | **Plans:** 14 (39: 2 · 40: 2 · 41: 2 · 42: 5 · 43: 3) | **Timeline:** 2026-06-25 → 2026-06-26
**App versions:** v0.34.0.0 (PR #526, squash `43e57dd0`, Phases 39–43) → post-ship QA hardening v0.34.0.1 (#527), v0.34.0.2 (#528), v0.34.0.3 (#529)
**Tag:** `v1.2.2` @ commit `43e57dd0`
**Audit:** PASSED (gsd-audit-milestone 2026-06-26; 24/24 requirements, 5/5 phases, 24/24 integration, 1/1 E2E flow) — [v1.2.2-MILESTONE-AUDIT.md](milestones/v1.2.2-MILESTONE-AUDIT.md)
**Archive:** [v1.2.2-ROADMAP.md](milestones/v1.2.2-ROADMAP.md) · [v1.2.2-REQUIREMENTS.md](milestones/v1.2.2-REQUIREMENTS.md)
**Known deferred items at close:** 6 — 2 authed-Chromium UAT (Phase 43 visual canaries) + 4 verification gaps (Phase 16 old v1.0 leftover; Phases 23/24 v1.1.0 leftovers; Phase 43), all deferred-by-construction authed-UAT / pre-existing un-archived-phase-dir gaps, not v1.2.2 code gaps.

### Delivered

Made the /allocations Scenario composer render the REAL factsheet on a hypothetical blend, computed client-side (`compute.ts`) with parity by construction to the real `/factsheet/[id]/v2` route. Per the user's north-star directive (2026-06-25) the factsheet UI was NOT rebuilt — the existing factsheet was taken wholesale and fed the blend as input, collapsing the milestone to ONE payload adapter + the REAL `FactsheetBody` + one new constituent-correlation panel. `buildScenarioFactsheetPayload` was extended minimal→complete so every scalar + panel-array metric is computed client-side, degenerate-safe (39); the real `FactsheetBody` mounts under the existing scenario `FactsheetProvider(persist=false)` behind an additive `scenarioMode` flag that keeps the real factsheet byte-identical, with api-only panels absent on the csv blend (40); a constituent correlation matrix surfaces a "too similar" flag (ρ≥0.85), percent-contribution-to-risk, and cluster reordering — the diversification check (41); an honest AGGREGATE peer rank lands for the blend via an additive `scenarioPeer` carve-out (a deliberate, audited override of the no-peer-rank-a-hypothetical invariant — NEVER an `ingestSource` flip, never per-constituent), plus per-constituent mandate chips and an own-book delta (42); the compose toggles fold into the factsheet layout behind four permanent guards — byte-identity, axe a11y, coverage ratchet, no-state-bleed (43). Additive client-TS/TSX + Python over the FROZEN `scenario.ts` engine (zero-diff); no storage migration. The no-invented-data invariant stayed LOCKED.

### Key Accomplishments

1. **Complete client-side payload (39)** — `buildScenarioFactsheetPayload` computes the full scalar set + panel arrays (bootstrap CIs, Calmar-by-year, rolling, streaks, monthly/daily heatmaps, EoY) from the blend via `compute()`, with the population-std/252/365.25 convention golden-pinned, honest `n` overlap counts driving the n<252 caveat, and a returns-degenerate gate collapsing bad blends to safe-empty before `compute()`.
2. **Real factsheet body, byte-identical (40)** — the composer mounts the REAL `FactsheetBody` (not a reimplementation) under `persist={false}`; an additive `scenarioMode` (default false) keeps every existing call site byte-identical while `scenarioMode={true}` suppresses exactly Share+Compare; api-only panels (allocator/signatures/peer) proven absent on the csv blend by render-absence assertions.
3. **Constituent diversification (41)** — pairwise correlation off the engine's frozen `correlation_matrix`, a ρ≥0.85 "too similar" flag, percent-contribution-to-risk (PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw)), cluster reordering, de-aliased labels, and honest empties for 0/1-constituent / n<10.
4. **Honest peer override + mandate + own-book delta (42)** — an additive `scenarioPeer` path ranks the blend in AGGREGATE vs the verified universe (the audit-c20 behavioral pin replaced, never an `ingestSource` flip), disclosed "hypothetical blend · ranked vs verified strategies", suppressed below the n<252 floor and a ~20 min-cohort gate; per-constituent mandate chips from genuinely-available data; an own-book delta (blend ratios minus the live book). Claude red-team caught a stale-peer-rank-across-blend-edit bug before merge.
5. **Fold + four permanent guards (43)** — toggle folded into `CollapsibleSection` (WR-01 leverage `!== 1` fix), the `FactsheetBody.scenario-mode` byte-identity gate + the `guard04-no-bleed` no-state-bleed gate both PERMANENT, the composer-axe e2e gating `#factsheet-main`/`#factsheet-diversification`, and the coverage ratchet (lines:82/fns:74/branches:72/stmts:80) held.

### Post-ship QA hardening (v0.34.0.1 → v0.34.0.3)

- **#527 (v0.34.0.1)** — diversification DR denominator derived from the shared covariance so the Choueifaty bound holds on staggered-inception blends.
- **#528 (v0.34.0.2)** — optimizer aliased apply-back drifted on multi-venue books → `mapDeAliasedWeightsToRawBasis`.
- **#529 (v0.34.0.3)** — composer live-book BASELINE leg blended a revoked key the BLEND leg excluded → eligible-filter at the SSR source (LIVE-VERIFIED on prod).

### Known follow-ups (deferred, not blocking)

- **Authed post-deploy UATs (deferred-by-construction):** 43-HUMAN-UAT (2 scenarios — live folded layout seam/ordering + footer-gate prop threading). Headless can't hydrate authed pages; structure CI-proven (4/4 GUARDs, full suite 6768 green, axe e2e CI-wired, byte-identity + no-bleed permanent gates).
- **Pre-existing un-archived-phase-dir verification gaps:** Phase 16 (old v1.0 diagnostic-spike), Phases 23/24 (v1.1.0 persistence/benchmark) remain `human_needed` in their un-archived phase dirs under `.planning/phases/` — chronic out-of-scope debt, not v1.2.2.
- **STYLE-V2-01:** `styleDrift: null` is a deliberate Out-of-Scope v2 deferral.

## v1.2.1 — scenario-tab-hardening (Annualize → Per-Key Dailies → Repoint → Honest Toggle → Factsheet Parity)

**Shipped:** 2026-06-25
**Phases:** 5 (34–38) | **Plans:** 16 (34: 2 · 35: 3 · 36: 3 · 37: 3 · 38: 5) | **Timeline:** 2026-06-24 → 2026-06-25
**App versions:** v0.30.1.0 (PR #522, prelude) → Phases 34–36 → v0.33.0.0 (PR #525, squash `e5e4f3d2`, Phases 37–38)
**Tag:** `v1.2.1` @ commit `e5e4f3d2`
**Audit:** PASSED (gsd-audit-milestone; 18/18 requirements, 5/5 phases, 18/18 integration, 2/2 E2E flows) — [v1.2.1-MILESTONE-AUDIT.md](milestones/v1.2.1-MILESTONE-AUDIT.md)
**Archive:** [v1.2.1-ROADMAP.md](milestones/v1.2.1-ROADMAP.md) · [v1.2.1-REQUIREMENTS.md](milestones/v1.2.1-REQUIREMENTS.md)
**Known deferred items at close:** 4 (see STATE.md Deferred Items) — 2 authed-UAT + 2 verification gaps, all deferred-by-construction post-deploy authed Chromium UATs (Phases 37/38), not code gaps.

### Delivered

Unified every exchange API key's stats through the ONE CSV → `compute_all_metrics` path so Overview, Scenario, and factsheets read the same honest source, and finished the scenario composer's convergence onto the factsheet. The annualization basis is now explicit at the call site (default 252 unified) and the `equity_reconstruction`@365 vs `compute_all_metrics`@252 ×1.20 mismatch is gone (converged to 252) (34); `csv_daily_returns` carries an `api_key_id` axis fed by an allocator-key-scoped realized+funding derive job with backfill and a per-key owner RLS policy (35); the Overview equity curve + KPIs now blend the per-key dailies through the frozen `computeScenario` engine behind an all-or-nothing gate that falls back to snapshot reconstruction, with live HOLDINGS untouched on the poll/snapshot path (36); the composer surfaces an honest per-`api_key` include/exclude toggle that re-blends the curve + KPIs from the remaining per-key series — never a cosmetic hide (37); and the composer's scenario equity + drawdown now render through the REAL factsheet `TimeSeriesChart` + `MasterBrush` under one additive `persist={false}` provider at 1440 width, with blank-slate rendering the scenario overlay (38). Additive client-TS/TSX + Python over the FROZEN `scenario.ts` engine; Phase 35 shipped the milestone's one storage migration. The no-invented-data and no-peer-ranking-a-hypothetical-blend invariants stayed LOCKED.

### Key Accomplishments

1. **Explicit unified annualization (34)** — `periods_per_year: int = 252` (one `DEFAULT_PERIODS_PER_YEAR` constant) threaded through every annualization site in `metrics.py` (explicit `np.sqrt(252)`/`*252` AND the quantstats calls), default-252 output byte-identical, with a mutation-verified `periods_per_year=365` rescale-by-≈√(365/252) proof; `equity_reconstruction` converged to 252 so the two paths agree with no residual scale factor.
2. **Per-key dailies foundation (35)** — `csv_daily_returns` became a dual-axis store (strategy XOR `api_key_id`) with a per-key owner RLS policy + owner-coherence trigger (committed live SQL/RLS tests for NULLs-distinct coexistence, both upsert arbiters, CHECK rejections, cross-tenant isolation); `run_derive_broker_dailies_job` branches on the job's identity axis to derive realized+funding dailies keyed `(api_key_id, date)`; idempotent, 23505-safe, fail-loud backfill enqueue.
3. **Repointed stats reads (36)** — Allocator Overview equity-curve + KPIs (Sharpe / returns / vol / max-DD / avg-ρ) now derive from a per-`api_key_id` blend of `csv_daily_returns` through the frozen `computeScenario` engine, behind an all-or-nothing gate that falls back to the existing snapshot reconstruction whenever any active key lacks a series — AUM stays from holdings and the holdings read is provably untouched.
4. **Honest per-data-source toggle (37)** — `scenario-adapter.ts` keys projection units per `api_key`; the composer's include/exclude toggle re-blends `computeScenario` over the remaining per-key series (curve + KPIs change for real), with a single SSR-side eligibility SoT (`eligibleApiKeyIds`) the composer mirrors (no divergence from Overview) and a mutation-falsifiable DSRC-03 honesty oracle. /ship red-team caught + fixed RT1 (soft-disconnected keys rode the blend untoggleably) before merge.
5. **Composer factsheet parity + blank-mode fix (38)** — the scenario equity + drawdown render through the REAL factsheet engine under ONE `FactsheetProvider(persist=false)` fed `buildScenarioFactsheetPayload`'s synth payload (shared brush-zoom window, accent scenario line / muted benchmark, 3M/6M/12M/ALL SegmentedControl, 1440 width); blank-slate renders the scenario overlay on the final factsheet-backed path (mutation-falsifiable). /ship red-team caught + fixed RT2 (Overview factsheet URL/localStorage state had bled cross-tab) — `persist={false}` now gates the hydration READ too.

### Known follow-ups (deferred, not blocking)

- **Authed post-deploy UATs (deferred-by-construction):** 37-HUMAN-UAT (3 scenarios — per-source toggle on real per-key data) and 38-HUMAN-UAT (2 scenarios — factsheet-grade interaction feel + blank-slate overlay end-to-end). Headless can't hydrate authed pages / JSDOM has no layout+D3-zoom; code paths are proven by the vitest RTL suites incl. the DSRC-03 and PARITY-03 mutation-falsifiable oracles.
- **Nyquist discovery gap on phases 34–36** (built before this run's Nyquist discipline; verified `passed` regardless). Optional retroactive `/gsd:validate-phase 34|35|36` — non-blocking.
- **Pre-existing tech debt surfaced:** unused import `trackUsageEventClient` (`AllocationsTabs.tsx:33`); `gdpr-export-schema.test.ts` references `csv_daily_returns`'s 36-01 surrogate `id` PK (DEFER-36-02-01). Out of scope, no functional impact.

## v1.2 — Allocator Cohesion (Unify the Composer → Graphs on the Blend → Polish the Journey)

**Shipped:** 2026-06-24
**Phases:** 5 (29–33) | **Plans:** 16 | **Timeline:** 2026-06-23 → 2026-06-24
**App versions:** v0.29.0.0 → v0.30.0.1 (PRs #518, #520 squash `0408ee77`, #521 squash `1177546`)
**Tag:** `v1.2` @ commit `11775460`
**Audit:** PASSED (gsd-audit-milestone; 5/5 phases must-haves verified; FLOW-01 + FLOW-02 e2e flows confirmed) — [v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md)
**Archive:** [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · [v1.2-REQUIREMENTS.md](milestones/v1.2-REQUIREMENTS.md) · [v1.2-phases/](milestones/v1.2-phases/)

### Delivered

Collapsed the three fractured allocator surfaces — the example-universe Strategy Sandbox (`/scenarios`), the legacy Portfolios pages, and the own-book Scenario composer — into ONE factsheet-grade Scenario composer on the live blended book. An allocator now reaches a single composer that starts from a blank slate or seeds from their book, browses verified + example strategies in one tagged catalog, lazily resolves an added strategy's returns so it moves the projection, and saves/reopens named portfolios (29); sees factsheet-grade graphs on the blend — equity/drawdown in the factsheet identity + returns-distribution + rolling Sharpe/vol/Sortino, each declaring method/overlap-N/horizon with peer/percentile panels structurally suppressed (30); collapses the composition controls so the graphs lead, with in-progress edits surviving (hide-not-unmount) (31); hits zero dead links — `/scenarios` 307-redirects into the composer, ScenarioBuilder is gone, nav is one allocator entry (32); and lands on a polished journey — Bridge → composer continuity, DESIGN.md-consistent focus rings, and a live WCAG-AA axe gate (33). Every phase was additive client-TS/TSX over the FROZEN `scenario.ts` engine (zero-diff, no migration, no second annualization path).

### Key Accomplishments

1. **Unified composer spine (29)** — one surface with an entry-mode control ("From my book" / "Blank slate", routed through the reset-confirmation modal so a switch never silently wipes edits); a merged verified+example Browse catalog (`is_example` co-fetched, pseudonymity-safe, neutral-outline Example pill); and a scoped RLS lazy-returns route (`GET /api/strategies/[id]/returns`) that closes the H-0133/example-add data gap so a catalog-added strategy actually moves the projection.
2. **Factsheet graphs on the blend (30)** — a single pure-TS `buildBlendPanels` adapter (cumulative-wealth histogram + quantiles + rolling metrics, numerically pinned to the existing rolling-stats convention) feeding a Returns-distribution Card + a Rolling-metrics Card (3M/6M/12M); equity/drawdown reskinned to the shared chart-tokens identity; per-panel method/overlap-N/horizon disclosure + honest below-floor empty states; the IMPACT-02 honesty guard extended non-vacuously WITH the panels mounted (no peer/percentile/signature on a hypothetical blend).
3. **Graphs-lead layout (31)** — the factsheet `CollapsibleSection` primitive lifted to `src/components/ui/` and used to wrap `CompositionList` as an unconditional native-`<details>` child, so collapsing the controls makes the graphs lead with zero panel reorder and in-progress weight/leverage edits survive collapse→expand by construction.
4. **Dead-link fix + route retirement (32)** — `/scenarios` is now a server-component 307 redirect into the unified composer, `ScenarioBuilder.tsx` is deleted (eliminating its `createAdminClient()` RLS-bypass institutional-universe read — a net security win), the sidebar is consolidated to one allocator entry (managers keep `/portfolios`), and portfolio-context add-strategy attaches back with no dead link — all with NO table DDL.
5. **Journey polish (33)** — a non-vacuous Bridge→composer seam regression (projection MOVES, not just membership), DESIGN.md accent focus rings on the blank-slate CTAs, and a composer WCAG-AA axe e2e gate that — once it ran in CI — caught and fixed **3 genuine production a11y violations** on `/allocations` (duplicate `<main>`, Export/+Allocation inside `role=tablist`, `role=region` on `<footer>`) that 5 specialists + code review + prior /qa all missed.

### Known follow-ups (deferred to v1.2.1 scenario-tab-hardening)

- `api_key_id`-per-key dailies unification, Overview-stat repoint onto the unified composer source, composer chart-parity items #3/#4, and the blank-mode equity-projection gap — all deferred to the next milestone, **v1.2.1**.
- **PR #522 (v0.30.1.0)** shipped post-tag as a **v1.2.1-prelude**: an honest-Overview / blank-slate fix.
- WR-03 (pre-existing from Phase 25-03): "Copy link" silently rotates the share token, invalidating prior recipients without warning — advisory, not a v1.2 blocker.
- Ledger debt: the `.planning` v1.2 ROADMAP/REQUIREMENTS were lost to the gitignore-drop hazard during execution and reconstructed at archive (this entry + the two archive files); the process fix is to reconcile the ledger before tagging in future milestones.

## v1.1.0 — Scenario Analysis (Surface → Honesty → Persist → Read → Quant)

**Shipped:** 2026-06-22
**Phases:** 8 (21–28) | **Plans:** ~22 | **Timeline:** 2026-06-21 → 2026-06-22
**App versions:** v0.25.0.0 → v0.28.0.2 (PRs #510, #511, #512, #513, #514, #515, #516, #517)
**Audit:** none formal — each phase shipped + prod-verified per-PR; closed with the deploy-reliability follow-ups landed (#516/#517)
**Archive:** [v1.1.0-ROADMAP.md](milestones/v1.1.0-ROADMAP.md) · [v1.1.0-REQUIREMENTS.md](milestones/v1.1.0-REQUIREMENTS.md) · [v1.1.0-phases/](milestones/v1.1.0-phases/)

### Delivered

Turned the already-built scenario draft engine (R4 leverage + H-0133 weight plumbing, PR #493) into a complete, honest scenario-analysis product for the own-book composer: surfacing + correlation heatmap + "PROJECTED — hypothetical" framing (21); a shared methodology-disclosure + minimum-sample gate the heavy quant features reuse (22); the persistence spine — save/reopen/list/rename/delete named scenarios + side-by-side compare, DB + RLS + schema_version (23); benchmark overlay with active-return metrics (24); revocable read-only share links with leak-scoped SECURITY DEFINER resolution (25); β-propagated stress shocks + historical VaR/CVaR (26); block-bootstrap Monte-Carlo forward confidence bands in the repo's first Web Worker, honest-to-N (27); and the milestone's lone new Python analytics endpoint — a min-vol/max-Sharpe weight optimizer (hand-rolled Ledoit-Wolf + scipy SLSQP, long-only, write-to-draft-only) with TS↔Python golden-fixture parity (28). Every projected statistic discloses method + overlap-N + horizon; nothing is fabricated below the sample floor.

### Key Accomplishments

1. **Honest projection scaffolding (21–22)** — scenario surfacing, pairwise correlation heatmap, "PROJECTED — hypothetical" framing, and a shared per-stat method/overlap-N/horizon disclosure + minimum-sample gate that the distributional/tail features reuse (the no-invented-data invariant).
2. **Persistence spine + compare (23)** — `scenarios` table with owner-scoped RLS and `schema_version`; save/reopen/list/rename/delete; compare 2+ scenarios and the live book side-by-side. JSONB draft stores refs/weights/leverage only, never raw return series.
3. **Benchmark + sharing (24–25)** — benchmark overlay with tracking error / information ratio / alpha-beta over the aligned window; revocable read-only share links resolving ONLY draft-scoped strategies via a leak-guarded SECURITY DEFINER RPC (cross-tenant content asserted in tests).
4. **Tail risk + forward uncertainty (26–27)** — β-propagated market-shock stress + historical VaR/CVaR scaled correctly with leverage; block-bootstrap Monte-Carlo confidence bands (preserving cross-strategy correlation + autocorrelation) with a LINEAR mean-SE drift, run off-main-thread in the repo's first Web Worker, gated below the sample floor.
5. **Weight optimizer (28)** — the lone new analytics-service endpoint: `POST /api/optimize-weights` (min-vol default / max-Sharpe gated), hand-rolled analytical Ledoit-Wolf shrinkage + scipy SLSQP, long-only, deterministic, write-to-draft-only via an atomic apply, with TS↔Python convention parity pinned by a shared golden fixture and honest null-gates instead of fabricated vectors.
6. **Deploy reliability (#516/#517)** — root-caused and fixed the flaky tests (frontend admin-deletion rate-limit mock race; python compute-jobs-fencing shared-DB throttle) that silently skipped the Railway analytics deploy on a red merge-CI; eliminated the test-isolation `vi.doMock`-dance races via call-time state-driven mocks.

### Known follow-ups (deferred, not blocking)

- Manual canaries (headless can't hydrate authed pages): authed Weight-Optimizer Suggest/Apply + MC band-fan render.
- Cross-phase integration **audit** not formally run (gsd-audit-milestone) — each phase was prod-verified per-PR.
- v1.0.0's phase dirs (15–20) were never moved into its archive (pre-existing); left as-is.

## v1.0.0 — API-Key Rewrite (Diagnose → Fix → Unify → Ship to LPs)

**Shipped:** 2026-06-20
**Phases:** 7 (15–20, incl. 19.1) | **Plans:** ~48 | **Timeline:** 2026-04-30 → 2026-06-20
**Commits since v0.17.0.0:** 447 (interleaved with the v0.24.x app-version line)
**Audit:** none formal — closed with acknowledged deferred items (see STATE.md "Deferred Items")
**Archive:** [v1.0.0-ROADMAP.md](milestones/v1.0.0-ROADMAP.md) · [v1.0.0-REQUIREMENTS.md](milestones/v1.0.0-REQUIREMENTS.md)

### Delivered

Took the recurring API-key wizard failure from symptom to root cause, then unified five divergent ingestion entry routes into one observable, idempotent, flag-gated `POST /process-key` backbone — and migrated the legacy `verification_requests` table to a read-only VIEW over `strategy_verifications` behind a 168h production soak. CSV-bridged onboarding works today; the founder-LP dogfood report and MT5 ingestion are wired. The version is structurally credible in front of LPs; the remaining gates are real-customer and live-secret items, acknowledged as deferred (see below).

### Key Accomplishments

1. **CSV Unblock (Phase 15)** — CSV → analytics → factsheet path unblocked end-to-end through the unified finalize; wizard strategy-name persistence on refresh, admin View-factsheet fixes, two-tier (API vs CSV) factsheet rendering.
2. **Diagnostic Spike + Observability (Phase 16)** — single `correlation_id` traceable across five layers (Next.js Sentry, Python Sentry, Supabase audit, Resend webhook, `compute_jobs.metadata`), `debug-key-flow` SSE harness, vcrpy cassette infrastructure (now OKX+Bybit daily via `cassette-refresh.yml`; Binance dropped).
3. **Design Contract (Phase 17)** — design-system contract for the factsheet/wizard surfaces.
4. **Root-Cause Fix + Founder-LP Skeleton (Phase 18)** — fixed the actual wizard hang (bridge race + missing compute_analytics chain) with a failing-without-fix regression test; Python `redact.py` PII mirror wired into Sentry/structlog/audit; monthly founder-LP report cron reusing the factsheet PDF endpoint with dual Sentry+Resend alerting.
5. **Unified Backbone (Phase 19)** — one `POST /process-key` FastAPI RPC behind an `IngestionAdapter` Protocol (validate/fetch_raw/compute_metrics/compute_fingerprint/reconstruct_positions); 6 thin Next.js adapters gated by `isUnifiedBackboneActive()`; feature-flag kill-switch + 15-min cron rollback monitor; open-perp mark-price + funding-rate correctness and TWR≠YTD fixed at the equity-curve layer; `compute_similarity` SQL. The `verification_requests` → `strategy_verifications` VIEW-shim sequence (PR-A…PR-D) completed: **PR-D landed 2026-06-20 (v0.24.15.123)** after the 168h soak ran 620h green with zero legacy writes — `verification_requests` is now a `security_invoker` VIEW.
6. **CSV Analytics Factsheet Pipeline (Phase 19.1)** — broker API key full-history → funding-inclusive daily returns (anchored) → CSV-route factsheet.
7. **MT5 EA Daily-Returns Ingestion (Phase 20)** — read-only MQL5 Expert Advisor exports a flow-adjusted, equity-based dense calendar-daily `date,daily_return` CSV into the existing pipeline; output contract pinned by 13 golden fixtures (T1–T13) + a read-only CI static-check (T16). T14/T15 manual demo reconcile remains founder-pending.

### Decisions Ratified

- Unify five ingestion routes into one `POST /process-key` backbone behind an adapter Protocol, rather than patching each route.
- Migrate `verification_requests` via a 4-PR VIEW-shim behind a 168h soak with a fail-loud stability gate, rather than a big-bang rename.
- Two-tier factsheet: API-ingested = full panels from real data; CSV-ingested = hide non-derivable panels (never synthesize).
- MT5 ingestion via Approach A (read-only EA → existing CSV pipeline) with no production-service change.

### Known Deferred Items (acknowledged at close)

Closed with open founder/customer-gated items rather than blocking: ≥3 onboarding teams reaching `published` and ≥1 customer-feedback entry (no clients yet), MT5 T14/T15 demo reconcile, founder OKX smoke run + dogfood commitment text, Sentry/Vercel live-token probes, and RESEND_API_KEY in Vercel. Full checklist: `.planning/MILESTONE-v1.0.0-FOUNDER-ACTIONS.md`; tracked in STATE.md "Deferred Items".

---

Shipped versions of Quantalyze. Each entry summarizes what changed, how big the cut was, and points at the archive.

---

## v0.14.0.0 — Sprint 8: Bridge V2

**Shipped:** 2026-04-19
**Phases:** 5 (01–05) | **Plans:** 10/10 | **Requirements:** 35/35 ✓
**Timeline:** 2026-04-17 → 2026-04-19 (3 days, 5 sessions)
**Commits since v0.13.1.0:** 70 | **Files:** 116 | **LOC:** +15,036 / −357
**Audit:** PASSED (6/6 integration wiring points, 2/2 E2E flows)
**Archive:** [v0.14.0.0-ROADMAP.md](milestones/v0.14.0.0-ROADMAP.md) · [v0.14.0.0-REQUIREMENTS.md](milestones/v0.14.0.0-REQUIREMENTS.md) · [v0.14.0.0-MILESTONE-AUDIT.md](milestones/v0.14.0.0-MILESTONE-AUDIT.md)

### Delivered

Closed the Bridge feedback loop end-to-end — allocators can now record what they did with a recommendation, the system computes realized 30/90/180-day deltas, a rule-based feedback engine adjusts per-dimension scoring weights from outcome history, and a new widget surfaces it all on My Allocation.

### Key Accomplishments

1. **Outcome Tracker (Phase 1)** — `bridge_outcomes` + `bridge_outcome_dismissals` tables with three-tier RLS, inline banner on the Holdings table, append-only institutional audit semantics, daily `compute_bridge_outcome_deltas` pg_cron with cumulative-equity math and idempotent NULL-guard.
2. **Mandate Profile Builder (Phase 2)** — `allocator_preferences` extended with `max_weight` / `correlation_ceiling` / `liquidity_preference` / `style_exclusions` / `mandate_edited_at`, `update_allocator_mandates` SECURITY DEFINER RPC as the only allocator write path (migration 061 drops the direct-UPDATE RLS policy), auto-save-on-blur MandateForm with aria-live status and per-field validation.
3. **Mandate-Aware Scoring (Phase 3)** — `match_engine.py` v2.0.0 composes `mandate_fit_score` inside `W_PREFERENCE_FIT` (0.6 pref + 0.4 mandate), `scoring_weight_overrides` JSONB column, `compute_jobs` 3-way XOR + `rescore_allocator` kind, `_should_skip_allocator` triple check (force + engine_version + mandate_edited_at) with proactive enqueue from the mandate RPC.
4. **Feedback Loop (Phase 4)** — `feedback_engine.py` with D-05 hybrid rejection-enum/score-dominant attribution, D-13 step function (0.5× floor / 1.5× ceiling / min-5 gate), 3-scenario golden snapshot with anti-silent-accept sentinel, migration 063 two-phase CTE that enqueues rescores only on NULL→non-NULL delta transitions (not every touched row), ADR-0023 audit taxonomy sync in the same commit.
5. **Outcomes Dashboard (Phase 5)** — single-file `OutcomesWidget.tsx` (Voice-D1 consolidation) registered in react-grid-layout with KPI strip + timeline + expandable delta comparison + sparklines; migrations 064 (NULL-allowed original_strategy_id + 6-arg `send_intro_with_decision`) and 065 (NOT NULL tighten) via Supabase MCP; admin SendIntroPanel Holdings dropdown (Option A) supplies the underperformer identity; `computeOutcomeKPIs` has byte-for-byte parity with Phase 4 `_success_value` via cross-runtime pytest harness.

### Decisions Ratified

- Split the 10-task combined sprint into Sprint 8 (Bridge V2) + Sprint 9 (Advanced Analytics) — scope fit the 3-day window.
- Extend `allocator_preferences` in place instead of building a new `allocator_mandates` table.
- `mandate_fit_score` composes inside `W_PREFERENCE_FIT` (0.6/0.4) to preserve total weight sum = 1.0.
- Security gate moved to the DB layer: migration 061 drops the allocator self-update RLS policy; the RPC is the only write path.
- Migration 063 two-phase CTE enqueues rescores only on delta transitions (NULL → non-NULL), not on every UPDATE-touched row.
- Voice-D1: single-file widget with inline sub-components (KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline).

### Known Deferred Items (recorded 2026-04-19 at close)

| Category | Item | Status |
|----------|------|--------|
| verification_gaps | Phase 01: 01-VERIFICATION.md | human_needed (5 seeded-env Playwright items; 5/5 automated PASS) |
| verification_gaps | Phase 02: 02-VERIFICATION.md | human_needed (3 live-DB/UI items; 5/5 SCs + 8/8 reqs COVERED via automation) |

Known deferred items at close: 2 (see STATE.md Deferred Items).

Additional tech debt items documented in `milestones/v0.14.0.0-ROADMAP.md` § Tech Debt Incurred:

- Phase 01 VALIDATION.md never authored (Nyquist scaffold adopted from Phase 2 onward).
- Phase 02 rate-limit WR-02 shared limiter (5/min) may throttle auto-save under rapid edits — decision deferred to live user feedback.
- Phase 03 asymmetric liquidity direction (D-05 by-design) + style_exclusions relaxation (D-06 SOFT).
- Phase 05 LAYOUT_VERSION bump (localStorage-only) — Voice-D8 trigger on "dashboard reset itself" reports.
- Pre-existing CONCERNS.md items (compute_jobs RLS wide-open, wizard-draft cron, Playwright CI coverage, dual-cron path) — out of scope for Sprint 8.

---

## v0.15.0.0 — Sprint 9: Demo-to-Production

**Shipped:** 2026-04-27
**Phases:** 6 (06, 07, 08, 09, 09.1, 10) | **Plans:** 38/38 | **Requirements:** 27/27 ✓ (INGEST-01..09 + PURGE-01..07 + MANAGE-01..06 + LIVE-01..05 + SCENARIO-01..09)
**Timeline:** 2026-04-19 → 2026-04-27 (8 days, ~12 sessions)
**Commits since v0.14.0.0:** 244 | **Files:** 337 | **LOC:** +77,452 / −2,900
**Audit:** PASSED (6/6 cross-phase wiring points, 0 findings, all 4 deferred items retired in-flight)
**Archive:** [v0.15.0.0-ROADMAP.md](milestones/v0.15.0.0-ROADMAP.md) · [v0.15.0.0-MILESTONE-AUDIT.md](milestones/v0.15.0.0-MILESTONE-AUDIT.md) · [v0.15.0.0-INTEGRATION-CHECK.md](milestones/v0.15.0.0-INTEGRATION-CHECK.md)

### Delivered

Every surface an allocator touches works end-to-end with real data. A brand-new institutional LP can now sign up, connect a read-only exchange API key, see Performance populate, and use a Scenario tab to run what-if analyses that commit through the Bridge outcome-recording flow. Zero seed fallback anywhere.

### Key Accomplishments

1. **Allocator API Ingestion (Phase 06)** — new `allocator_holdings` table with 3-tier RLS + 4-way XOR on `compute_jobs.target` (strategy/portfolio/allocator/api_key), `poll_allocator_positions` compute-job kind, idempotent diff-upsert keyed on `(allocator_id, venue, symbol, asof)`, FastAPI worker with CCXT + Deribit explicit-not-supported, 7-state sync pill + Sync now button on AllocatorExchangeManager.
2. **Demo-Mode Purge (Phase 07)** — rewired `/allocations` off seed UUIDs, tabbed Performance + Scenario, single Connect Exchange CTA empty state, `allocator_equity_snapshots` reconstruction with venue-specific warm-up copy, EmptyState replaces zero-holdings ghost widgets, OnboardingWizard no longer seeds.
3. **Connection Management + Notes (Phase 08)** — Disconnect modal with cascade-optional checkbox + revoked-key strikethrough + amber chip, multi-scope `user_notes` reshape (portfolio / holding / bridge_outcome / strategy) keyed on `(user_id, scope_kind, scope_ref)`, NoteRender + useNoteAutoSave + NoteSaveStatus shared primitives, 4-surface autosave matching Phase 02 mandate pattern.
4. **Bridge Live Against Real Holdings (Phase 09)** — `match_engine.py` v2.1.0 reads `allocator_holdings` via pseudo-strategy synthesis (`holding:{venue}:{symbol}:{holding_type}`), InsightStrip flagged-line on Performance tab, `compute_holding_flags` detects max_weight + correlation ceiling breaches, `match_decisions.original_holding_ref` XOR with original_strategy_id, `compute_bridge_outcome_deltas` extended with holding branch.
5. **Allocator Dashboard UI Refresh (Phase 09.1)** — designer-provided Allocator Dashboard.html ported as 4-col CSS snap-grid, 6-tab structure (Overview / Holdings / Outcomes / Mandate / Risk / Scenario), KpiStrip 5-cell rewrite preserving Phase 07 warm-up paths, SVG EquityChart + CustomRangePicker, HoldingsTable 3-tab row-expand (Metrics / Record outcome / Notes), BridgeWidget hero variant + 620px BridgeDrawer 2-stage slide-over, WidgetPicker covering 46+ widgets, behind `allocations.ui_v2` feature flag.
6. **Scenario Builder + What-If (Phase 10)** — Scenario tab on `/allocations` with full ScenarioComposer body, toggle/add/browse composition, reuses frozen `src/lib/scenario.ts::computeScenario` engine via scenario-adapter (zero engine changes), KpiStrip mode='scenario' delta pills, EquityChart + DrawdownChart scenario overlays, sticky ScenarioFooter with diff count + delta summary, `commit_scenario_batch` SECURITY DEFINER RPC for atomic single-tx commit, per-allocator-scoped localStorage with fingerprint-mismatch banner, Bridge "Add to scenario" + StrategyBrowseDrawer power-user surface.

### Decisions Ratified

- Phase 09.1 inserted mid-milestone to land the designer-provided dashboard vision before Phase 10 built on top of it. Cost: ~6 sessions; benefit: cohesive 6-tab shell for Phase 10 instead of grafting onto the legacy 2-tab dashboard.
- Phase 11 spun out as v0.16.0.0 because the onboarding/security work landed independently and v0.15.x had already been shipping incrementally on `main`.
- Pseudo-strategy IDs use `holding:{venue}:{symbol}:{holding_type}` text format; ENGINE_VERSION bumped to v2.1.0 to invalidate cached v2.0.0 batches on first cron run after ship.
- `user_notes` keyed by `(user_id, scope_kind, scope_ref)` with text scope_ref instead of typed FKs — same precedent as Phase 09's `match_decisions.original_holding_ref`.
- Scenario projection reuses frozen `src/lib/scenario.ts::computeScenario` via cast-only adapter, zero engine changes; `commit_scenario_batch` RPC for atomic single-tx commit.

### Post-Verify Tech Debt Retired In-Flight

All four post-verify deferred items resolved 2026-04-27 before milestone close:

- **G-1** (queries.ts !portfolio branch outcomes hardcode) — commit `2161a94`: hoisted bridge_outcomes query + normalization to Step 1, both branches return same payload.
- **IN-05** (Phase 09.1 popover dismissal mousedown vs click) — commit `f364640`: standardized all 4 popovers on mousedown.
- **UI-FLAG-04** (Phase 09.1 gap=10 designer-bundle port) — commit `fe23e23`: formalized as `--space-grid-gap` token; 5 inline literals replaced.
- **ISSUE-001** (Phase 10 scenario projection math edge case under thin returns + zero-weight holding) — commit `1c4c561`: defensive guard nulls KPIs when cumulative wealth flips sign + 2 regression tests.

### Known Deferred Items (recorded 2026-04-27 at close)

| Category | Item | Status |
|----------|------|--------|
| verification_gaps | Phase 01..02, 08, 10, 11 (5 phases) | All 21 items rolled up to `UAT-AUDIT-2026-04-27.md`; 19 covered by tests/QA/downstream-phase reuse, 2 deferred-with-rationale to post-merge probes (BLOCK-3 GitHub secrets + PostHog dashboard ingest). |
| uat_partial | Phase 10 6-scenario browser flow | Resolved via 2026-04-27 milestone-wrap QA report; re-exercise scheduled for post-/ship batched /qa pass. |
| tech_debt | Phase 08 — 5 Info-tier follow-ups | Note-icon prefetch, BridgeOutcomeNoteSection silent error fall-through, useNoteAutoSave defensive guard, NoteSaveStatus tick interval, AllocatorExchangeManager poll cadence — all non-blocking. |
| tech_debt | Phase 10 — `as unknown as DailyPoint[]` cast | ScenarioComposer defensive cast for upstream StrategyAnalytics.daily_returns type mismatch; waits for v0.17 Phase 12 backend metric contracts. |
| tech_debt | Phase 09.1 — D-19 deviation | Tweaks panel QA_MODE gate widened to universal (postMessage safety invariant preserved); cosmetic. |

Known deferred items at close: 21 (rolled up to UAT-AUDIT-2026-04-27.md, mostly already covered).

### Carry-Forward to v0.16.0.0

Phase 11 (Onboarding & Security Readiness) is its own milestone. WR-02 race window in `maybeEmitFirstBridgeSurfaced` was retired today (2026-04-27) via migration 085 `stamp_first_bridge_surfaced` SECURITY DEFINER RPC + helper refactor (commit `841da8a`).

---

## v0.16.0.0 — Phase 11: Onboarding & Security Readiness

**Shipped:** 2026-04-27
**Phases:** 1 (Phase 11) | **Plans:** 7/7 | **Requirements:** 6/6 ✓ (ONBOARD-01..06)
**Timeline:** 2026-04-22 → 2026-04-27 (5 days)
**Audit:** PASSED (5/5 success criteria, 22/22 truths, 0 blockers)
**Archive:** [v0.16.0.0-MILESTONE-AUDIT.md](milestones/v0.16.0.0-MILESTONE-AUDIT.md)

### Delivered

A real LP's first 10 minutes are now friction-free and credible. Every allocator-facing widget renders correctly in all five states (loading / empty / partial / error / success). The end-to-end Playwright acceptance test runs in CI (always-on banner smoke today, full funnel one-variable-away).

Phase 11 was spun out of v0.15.0.0 mid-sprint as its own minor-version release because the onboarding/security work landed independently while v0.15.x had already been shipping incrementally on `main`.

### Key Accomplishments

1. **Onboarding nudge surface (S1 + S2)** — OnboardingBanner + MandateQuickSetCard render above `/allocations` tabs gated server-side on `apiKeysCount === 0` and `mandateIsSet === false`. sessionStorage dismiss with re-surface until first key connects. Phase 02 D-09 LOCKED honored (no silent default save).
2. **`/security` audit page (S4 + S5 + S6 + S7)** — SOC-2 status banner (S4a), audit-log link to /profile?tab=security (S4c), WithdrawalWarningStrip on every wizard step (S5), WizardIpAllowlistHint persistent (S7), AuditLogSubsection with Download CSV last 90 days (S6). All copy verbatim from CONTEXT D-05/D-06/D-07/D-08 LOCKED entries; zero invented attestations.
3. **Audit-log CSV export route** — GET /api/me/audit-log/export with RFC 4180 + WR-01 formula injection neutralization, RLS isolation test, 36KB CSV with JSON metadata properly quoted.
4. **WidgetState 5-mode primitive** — loading/empty/partial/error/success states wired into all 7 DEFAULT_LAYOUT widgets behind `widget_state_v2` feature flag (default OFF). 35-mode matrix test green. Long-tail 32 WIDGET_REGISTRY widgets deferred to Phase 11+1 backlog.
5. **PostHog onboarding funnel** — 5 single-fire events (`signup` → `first_api_key_added` → `first_sync_success` → `first_bridge_surfaced` → `first_outcome_recorded`) via `auth.users.raw_user_meta_data` markers. Migration 084 trigger + RPC LIVE; helpers + reader paths in production code; content-hash dedupe contract proven via deterministic stamping.
6. **Playwright E2E in CI** — `e2e/onboarding-funnel.spec.ts` (full happy path with 5-marker assertion via auth.users.raw_user_meta_data, BLOCK-3 gated on `vars.E2E_TEST_DB_CONFIGURED`) + `e2e/onboarding-banner-smoke.spec.ts` (RISK-2 always-on, fork-PR safe, 3/3 PASS in 15.5s).

### Decisions Ratified

- Phase 11 spun out as v0.16.0.0 mid-sprint because onboarding/security work landed independently while v0.15.x had already been shipping incrementally.
- BLOCK-3 GitHub secrets activation deferred at user direction; CI gate uses `vars.E2E_TEST_DB_CONFIGURED == 'true'` (NOT `secrets.X != ''`) so dormant state is intentional and safe to land before user setup.
- IN-02 WidgetState partial pill `bg-warning/5` contrast deferred pending design-token revision (pill border provides full-strength delineation).
- S4b inline egress IPs deferred pending static-IP infrastructure provisioning; email path preserved as canonical IP-disclosure mechanism.

### Post-Verify Tech Debt Retired In-Flight

- **WR-02** (`maybeEmitFirstBridgeSurfaced` race window) — commit `841da8a`: migration 085 + helper refactor with PGRST202 graceful fallback; legacy `*_emitted_at` sentinel preserved as transition guard. Replaces deterministic-fallback mitigation with atomic Postgres-level stamping.

### Known Deferred Items (recorded 2026-04-27 at close)

| Category | Item | Status |
|----------|------|--------|
| post_merge_probe | BLOCK-3 E2E full funnel activation | User-action item: provision test Supabase project + 3 GitHub secrets + 1 repo variable. CI gate dormant; smoke spec runs always. |
| post_merge_probe | Production smoke on https://quantalyze-rho.vercel.app/security | Run after /ship via /canary or manual probe. |
| post_merge_probe | PostHog dashboard ingest verification | Observable only post-merge in production with real fresh-allocator traffic. |
| tech_debt | IN-02 WidgetState partial pill contrast | Design-token decision needs explicit user/design approval. Deferred to system-wide design-token revision. |
| tech_debt | S4b inline egress IPs on /security | Deferred pending static-IP infrastructure provisioning. |
| tech_debt | Long-tail 32 WIDGET_REGISTRY widgets per-state Vitest fixtures | Universal `<WidgetState>` primitive coverage shipped via widget_state_v2 flag. Per-state fixtures for outside-DEFAULT_LAYOUT widgets deferred to Phase 11+1. |

Known deferred items at close: 6 (3 post-merge probes, 3 tech-debt items).

---

## v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2

**Shipped:** 2026-04-29
**Phases:** 4 (12, 13, 14a, 14b) | **Plans:** 28/28 | **Requirements:** 52/53 ✓ (METRICS-15 path-extraction half outstanding; KPI-17 4-bucket partial by design)
**Timeline:** 2026-04-27 → 2026-04-29 (3 days, ~8 sessions)
**Commits since v0.16.0.0:** 68 | **Files:** 210 changed | **LOC:** +64,297 / −915
**Audit:** `tech_debt` (52/53 REQs covered; METRICS-15 path-extraction half intentionally deferred; 4 accepted deferred items)
**Archive:** [v0.17.0.0-ROADMAP.md](milestones/v0.17.0.0-ROADMAP.md) · [v0.17.0.0-REQUIREMENTS.md](milestones/v0.17.0.0-REQUIREMENTS.md) · [v0.17.0.0-MILESTONE-AUDIT.md](milestones/v0.17.0.0-MILESTONE-AUDIT.md)

### Delivered

Every allocator-facing strategy surface (Discovery list + Single-Strategy detail) now has full qstats parity in Quantalyze identity — every metric `qs.reports.html()` produces has a Quantalyze equivalent in a 7-panel layout with DESIGN.md identity (white card, accent #1B6B5A, DM Sans / Geist Mono tabular-nums). Discovery v2 matches Quants.Space's IA with Watchlist sub-tab, per-user Customize prefs, single-accent sparklines, and hide-examples default ON. Backend metric contracts deliver rolling Sortino/Vol/Greeks series, daily-returns grid, exposure & turnover series, 10 new qstats scalars, and cross-runtime parity tests. First milestone using Grok 4.2 multi-persona pre-execution review — caught 5 BLOCKERs before any code shipped.

### Key Accomplishments

1. **Backend Metric Contracts (Phase 12)** — `metrics.py` extensions: rolling Sortino/Vol/Greeks series, daily_returns_grid, exposure & turnover series, 10 missing qstats scalars, log_returns_series, 7 derived trade metrics + SQN + volume aggregator + Trade Mix (2-bucket audit-gated). Priority-enum throttled backfill (migration 086, 5 jobs/min cap). Heavy-series sibling table `strategy_analytics_series` (migration 087, 12 sibling kinds). Cross-runtime parity tests: Python `test_metrics_parity.py` + TS `metrics-parity.test.ts` on golden 252-day fixture, both 5/5 pass. Phase 12 SC#4 queue-depth max 15 of 50 limit.
2. **Discovery v2 Polish (Phase 13)** — Watchlist sub-tab with StarToggle on row/card + idempotent PUT /api/watchlist. Per-user Customize prefs in `localStorage["discovery_view_preferences:{auth.uid}:{slug}"]` with CustomizeDrawer. Single-accent sparkline rule (sparkline-color.ts helper, final-value sign drives color). is_example backfill + default Hide Examples ON (migration 091, pending push). Filter-by-team deferred by design — org-id audit returned count=0.
3. **Single-Strategy v2 Eager (Phase 14a)** — `/strategy/[id]/v2` route + `isStrategyUiV2Enabled()` flag. 7-panel scrollable shell with IntersectionObserver scaffold (StrategyV2Shell). Eager Panels 1–3: Overview 6-cell row, Headline 6-cell KPI strip + EquityCurve segmented control, DrawdownChart + Worst 5 Drawdowns. DESIGN.md identity baseline: CHART_TICK_STYLE token, CHART_AXIS_TICK #64748B contrast token, chart-contrast test 2/2 green. `@nivo/boxplot` removed (CLEANUP-01, 24 transitive packages dropped). PR template 8-box per-chart identity checklist. DESIGN.md decisions log entries stamped.
4. **Single-Strategy v2 Lazy (Phase 14b)** — Panels 4–7 bodies: ReturnsDistributionPanel (MonthlyHeatmap / DailyHeatmap SVG/Canvas / ReturnHistogram / ReturnQuantiles / YearlyReturns), RollingMetricsPanel (Sharpe/Volatility/Sortino/AlphaBeta 3M/6M/12M toggle), TradeAndPositionPanel (6 metric rows + TradeMix 2-bucket + MetricCell primitive), ExposureAndGreeksPanel (NetGrossExposureChart / TurnoverChart / CorrelationWithBenchmark / BenchmarkGreeksTable). 9 Playwright specs authored (axe-core x2, keyboard, chart-parity, partial-data x2, watchlist, sparkline-regression, prefs isolation). `strategy.ui_v2` default flipped ON browser-side with SSR-safe two-pass mount.
5. **Cross-AI Review** — First milestone using Grok 4.2 multi-persona plan review pre-execution (Grok + fresh Claude adversarial subagent). 5 BLOCKERs caught and fixed before any code shipped: sharpe_180d absent (→ window map), Canvas geometry overflow (→ CELL_W=2), equity panelId (→ migration 087 CASE), panel6 lazy error masking (→ fetchOnIntersect=false), SSR hydration (→ typeof window check).
6. **Code Quality** — Per-phase code review + fix loops: Phase 12 (4 warnings fixed), Phase 14a (5 mediums + 4 lows fixed), Phase 14b (1 critical + 3 warnings + 3 info fixed). UI review pillars 6/6 PASS in spec; 53/60 + 52/60 in retroactive audits with all priority items fixed. 2580/0 TS tests; 592+/0 Python tests at milestone close; TypeScript clean.

### Decisions Ratified

- Phase 14 split into 14a + 14b per cross-AI review — 30 REQs in one phase was too dense; lazy panels (4–7) are a natural cleavage point.
- TRADE_MIX_HAS_MAKER_TAKER=false — production raw_fills empty for Binance/OKX/Bybit is_maker flag; 2-bucket fallback ships; 4-bucket → v0.17.1.
- DISCO-03 filter-by-team deferred to v0.18 — org-id audit returned count=0; no orgs to filter on.
- D-16 frozen TS contract locked (TradeMetrics +7 derived fields, StrategyAnalyticsSeriesKind union with 12 D-01 kinds, equity_series_1y excluded per H-D).
- strategy.ui_v2 default ON browser-side (14b-08) with SSR-safe two-pass mount; v1 route kept pending v0.17.1 cutover.
- H-B: search_path=public,pg_temp hardening on all 3 SECURITY DEFINER RPCs in migrations 086/087.

### Known Deferred Items (recorded 2026-04-29 at close)

| Category | Item | Status |
|----------|------|--------|
| tech_debt | METRICS-15 path-extraction rewrite in `getStrategyDetailV2` | v0.17.1 — React.cache() mitigates double-fetch; single-query latency acceptable; SC#3b p95 < 50ms contract formally unverified |
| tech_debt | KPI-17 Trade Mix 4-bucket maker/taker | v0.17.1 — TRADE_MIX_HAS_MAKER_TAKER=false; panel-count=7 preserved |
| operator_action | DISCO-05 migration 091 remote push | Path A/B/C decision in TODOS.md (11 unapplied local + 8 unaccounted remote drift) |
| operator_action | Phase 12 SC#4 formal operator sign-off | Scripts exist; TODOS.md records max depth 15 (well below 50 limit); autonomous=false plan gate |
| tech_debt | v1 → v2 strategy page cutover | v0.17.1 — remove `/strategy/[id]/page.tsx` v1 route |
| tech_debt | 9 authored Playwright specs (HAS_SEED_ENV gate) | v0.17.1 — CI execution requires seeded test DB wiring |
| design_deferred | DISCO-03 filter-by-team | v0.18.0.0 — count=0 at audit |

Known deferred items at close: 4 accepted deferred items (see `.planning/v0.17.0.0-MILESTONE-AUDIT.md` Section 4).

---

## v1.13 — Infra: sFOX go-live foundation + worker rebuild (SHIPPED FLAG-OFF 2026-07-19, tag `v1.13`, closed 2026-07-22)

**Phases 125–130.** Merged PR #624 (v0.47.0.0, main @ `4b79891a`); both migrations (retention cron `20260719120000`, SECDEF trust-signal `20260719140000`) verified live on PROD.

### Key Accomplishments
1. **WORKER (125)** — dedicated backfill worker + retention hygiene: a derived-equity backfill can never wedge live analytics (bounded, batched, off-hours, own worker); test-DB `compute_jobs` pollution flake killed at root. 4/4 plans.
2. **FACTSHEET (126)** — `api_verified` connected-key factsheet renders (or degrades) with a BLOCKING e2e gate; public trust_tier re-based on correct-by-construction SECDEF primitive `get_published_trust_signals`. 3/3 plans.
3. **E2GT (127)** — derived allocator curve anti-fabrication anchor: live anchor-consistency gate (`within_same_day_tolerance===true`), curve DISPLAYED only when trustworthy. Audit-then-fill (E2GT-02 satisfied; E2GT-01 human_needed).
4. **DERIBITFIX (128)** — deribit `correction` classified PER ROW on `info.reason` (trading allow-list → cash; capital/unknown/missing → fail loud); WR-01 word-boundary denylist-precedence money-safety fix. RED-proven both directions.
5. **FLIP (129)** — derived-curve FLIP retry on the hardened worker (FLIP-02 verified; FLIP-01 human_needed).
6. **GOLIVE (130)** — `docs/runbooks/sfox-go-live.md` (Steps 0–5, explicit GOLIVE-01 gate); ships FLAG-OFF.

### Superseded / Reframed
- **sFOX go-live SUPERSEDED** — the "sFOX key" was a Nautilus DD API key all along (`api.nautilus.finance`, x-api-key); sFOX flags stay OFF. See memory `project_nautilus_dd_api_not_sfox`.

Known deferred items at close: 4 (see STATE.md Deferred Items — 3 human_needed founder LIVE-ops EGRESS/GOLIVE/E2GT + 1 diagnosed bybit debug session). Milestone ships FLAG-OFF by design; rollback trivial (flags → empty restores dormant v1.12).
