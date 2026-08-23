# Requirements: Quantalyze — Milestone v1.20 Backlog Burndown

**Defined:** 2026-08-20
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.

Every requirement below maps 1:1 to verified-open TODOS.md items (re-measured at HEAD 2026-08-20
by a 17-agent triage; L-refs cite TODOS.md line numbers at that snapshot). On scope commit the
included items are DELETED from TODOS.md — this file is their new home. Founder-gated and
verified-stale items are excluded by construction.

## v1.20 Requirements

### RANK — Public-trust & provenance correctness

- [x] **RANK-01** (L818): Published percentile rankings never fold failed/stale-computation KPIs into any strategy's rank. ⚠️ Research corrections are binding: gate on `isComputedAnalytics` semantics (a literal `complete` filter would wrongly drop `complete_with_warnings`); use a separate gate constant, NOT a `computation_status` append to `PERCENTILE_ANALYTICS_COLUMNS` (that falsifies the csv-finalize mirror prose at three sites); fix BOTH the TS side and the `get_verified_cohort_rank` SQL RPC (documented parity-by-construction); measure per-category population counts first (C-M1 — the <5/<20 floors mean a filter can blank a whole category's badges).
- [x] **RANK-02** (L1143): Anonymous readers receive only the columns the public surface needs — the `strategy_analytics (*)` splats (`queries.ts:218`, `compare/page.tsx:68`) become explicit projections excluding `daily_returns`/`metrics_json`/`data_quality_flags`.
- [ ] **RANK-03** (L947): `api_keys.exchange` is server-authoritative at every INSERT path — no client-supplied venue can differ from the venue the server validated (extends the Phase-156 service-role-writer pattern).
- [ ] **RANK-04** (L2522): The `asset_class` annualization stamp (√365 vs √252) derives from the server-validated venue, never from client-supplied `apiKeyExchange` (`finalize-wizard/route.ts:1288-1311`). ⚠️ NOT the "one-identifier change" TODOS claimed: `attested_venue` is NULL for trigger-scrubbed and pre-backfill rows and `isCryptoExchange(null) === false`, so a naive swap stamps `traditional`/√252 onto crypto strategies — the swap moves together with a null-attestation extension of the `skipAssetClassWrite` guard, gated on the B-M1 PROD census.
- [x] **RANK-05** (L855): The quantstats price-detection sign-flip is closed on the strategy-analytics path (all-non-negative returns with a >100% day must not be re-read as prices).
- [x] **RANK-06** (L858): Blend annualization treats unknown-`asset_class` legs as crypto for RISK, so a sole crypto leg no longer inflates Sharpe via √252.
- [x] **RANK-07** (L3184): Two concurrent same-session resubmits cannot both take the FILL arm — the FILL UPDATE is compare-and-set (`.is("category_id", null)`).
- [x] **RANK-08** (L3169): The re-mint fingerprint accounts for classification, so the classification-conflict 409's own remedy can mint a fresh session (or the exclusion is documented at the fingerprint).
- [x] **RANK-09** (L2088): `withPublishedOrOwner` validates the uid's shape before interpolating it into the PostgREST `.or()` filter.

### SHARE — SHARELINK-01 revocable share links (founder-decided model)

- [ ] **SHARE-01** (L27): "Copy Link" always yields a URL its recipient can view — a revocable per-strategy share token carried in the URL, mint-or-reuse on copy; the bare `/factsheet/<id>` URL stays owner-only and the id stays a non-secret. (URL shape — `?s=<token>` on the id route vs a separate `/factsheet-share/[token]` route — is the SHARE phase plan's decision; research disagrees and the choice must be argued, not defaulted: A-D1.)
- [ ] **SHARE-02** (L27): The token lane never contaminates the id-keyed public cache — after any token-lane render, an anonymous request for `/factsheet/<id>` of an unpublished strategy STILL 404s (adversarial acceptance, same class as OWN-02).
- [ ] **SHARE-03** (L27): A revoke control regenerates the token and kills previously-copied links.
- [ ] **SHARE-04** (L27): The share affordance is honest as a CLASS — no "Link copied!" success for a link that cannot work, consistent across `FactsheetView` and the strategies page, and covering the two research-found siblings: a token-link RECIPIENT must not see a Copy-Link control that rebuilds the URL without the token (`FactsheetView.tsx:1312` strips it today), and `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence must be corrected in the same phase (it becomes false the moment tokens ship).

### WIZERR — Honest error surfaces (the recorded WIZFORM-02 class residue)

- [ ] **WIZERR-01** (L75): The MT5 "gateway misconfigured" copy names the actual blocker, derived from the `terminal_info` flags the probe already holds (`tradeapi_disabled` vs `trade_allowed`) — fixed as a class across all six carrier sites, within the curated-message test fence.
- [ ] **WIZERR-02** (L1788): "Try another key" never destroys the draft or cascades away composite members.
- [ ] **WIZERR-03** (L2466): An orphaned live key (no strategy) surfaces an honest remedy instead of a false `DRAFT_ALREADY_EXISTS` 409.
- [ ] **WIZERR-04** (L410): The `keys/[id]/permissions` private `PROBE_*` cascade gets a derived-population coverage law, and `KEY_UNDECRYPTABLE`'s remedy sentence says "reconnect the key", not "try again".
- [ ] **WIZERR-05** (L486): `MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` threads end-to-end (a fourth optional `AnalyticsUpstreamError` field, relayed by both key-route catches).
- [ ] **WIZERR-06** (L436): The five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward recognized `seamCode`s instead of collapsing the severe half of the vocabulary.
- [ ] **WIZERR-07** (L2581): `AllocateDialog`, `RenameStrategyDialog`, and `MarkOwnershipDialog` stop minting `code: UNKNOWN` — the coverage law reaches the dashboard dialogs this class regrew on.
- [ ] **WIZERR-08** (L1779): The `KEY_INVALID_FORMAT` one-code-many-causes split lands on the remaining 2 routes / 9 sites, honoring their internal-vs-public copy contracts.
- [ ] **WIZERR-09** (L1871 + L1879): The 7-row CSV floor is evaluated on the wizard composite arm, and `INSUFFICIENT_CSV_HISTORY` renders its own copy instead of UNKNOWN — landed together or not at all.
- [ ] **WIZERR-10** (L1883 + L1907): Examined-but-refused verdicts render truthful copy (a fourth outcome replaces the false "only 0 trade(s)" sentence; the publish-time TOCTOU re-check wording follows), with D-15's oracle re-cut deliberately.
- [ ] **WIZERR-11** (L1948): Wizard `AUTH_FAILED` copy is parameterized by the selected venue — never names Deribit while Binance is selected.
- [ ] **WIZERR-12** (L3091): The csv-finalize A2 409 sentence describes the actual case (same track record, different flow).
- [ ] **WIZERR-13** (L1518): The per-row CSV breakdown renders its data half without leaking `'nan'` or echoing untrusted cell contents.

### HONEST — User-visible data honesty

- [ ] **HONEST-01** (L1939): Raw Python exception strings never render as user-facing `computation_error` copy — mapped at the writer, with the underlying str/None compare root-caused.
- [ ] **HONEST-02** (L1953): The factsheet freshness badge reflects series recency — a strategy whose return series ended 89 days ago cannot read FRESH; investigate (flat account vs derive gap) before fixing.
- [ ] **HONEST-03** (L1959): Example strategies don't advertise stale "Synced Nd ago" badges on discovery.
- [ ] **HONEST-04** (L1991): `buildEquityCurveSeries` serves real per-strategy equity curves now that `returns_series` is selected — the hard-coded `equityCurve: null` and its false comment go.
- [ ] **HONEST-05** (L2209): Drawer-added strategies render CAGR/Sharpe like book rows.
- [ ] **HONEST-06** (L2110): "Finish setup →" opens the wizard with the clicked key preselected.

### OPS — CI/deploy integrity & reliability

- [x] **OPS-01** (L2258 + L2259): The `shared-test-db` concurrency group no longer evicts queued main-branch jobs — a PR opened mid-run cannot make main CI conclude `cancelled` and silently skip the Railway analytics deploy; GitHub issue #616 closed on the fix. ⚠️ Research correction is binding: shrinking the group does NOT fix this (eviction is cross-run — one member + three runs still evicts queued main); the fix is an external FIFO mutex for DB-touching jobs plus a `cancelled`-conclusion watcher. ⛔ Hard prerequisite for DEPS-01.
- [x] **OPS-02** (L1741): `sql-tests` is in an aggregator's `needs:` — the only gate that executes the deployed cron body cannot be present-and-failing with nothing gating on it.
- [x] **OPS-03** (L2570 + L1035): The orphaned e2e specs (incl. the NAV-01 surface) run in a CI batch, and DB-types drift gets a regeneration gate (or an explicit recorded decision not to).
- [x] **OPS-04** (L2715 + L2265 + L2730): The TEST stale-`pending` backlog gets a TEST-only drain (⛔ never a migration, never `cron.unschedule(9)`), and `test_compute_jobs_fencing.py` stamps `claimed_at` in its two direct UPDATEs.
- [ ] **OPS-05** (L360): The structlog frozen-proxy class is fixed at the class level (no module-level proxy can bind a pre-`configure_logging` chain that skips `_redact_processor`), with a regression test. ⚠️ Two failure modes, each candidate fix closes only one: dropping `cache_logger_on_first_use` misses module-scope `.bind()` (broken regardless of the cache flag per structlog docs) — needs a source-scan gate for Mode A plus a behavioral redaction test for Mode B.
- [ ] **OPS-06** (L3116): `createAdminClient()` cannot throw on the request path after an irreversible commit — the class is closed at all three known sites.
- [ ] **OPS-07** (L1594 + L1595 + L1600): Flag-monitor honesty — `checkStuckNotifications` distinguishes "nothing stuck" from "could not tell"; a failed denominator read pages instead of logging success; the integration test actually falsifies both.
- [ ] **OPS-08** (L1562): The 10-param `_enqueue_compute_job_internal` no longer uses `INTO STRICT` on its lost-race branches (parity with the deliberately de-STRICT-ed 7-param overload).
- [ ] **OPS-09** (L1561): The resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window).
- [ ] **OPS-10** (L1558): The retry loop cancels abandoned response bodies (`body.cancel()`) so undici stops buffering until the attempt signal fires.
- [x] **OPS-11** (L1531): The `MultiKeyConnectStep` order-sensitive flake is root-caused (unrestored `vi.stubGlobal`/`vi.mock` class) and fixed, not retried-away.

### SEC — Small security hardening

- [ ] **SEC-01** (L940): The server-side password policy is verified and enforced — client `minLength={6}` is backed by an explicit Supabase-side policy, documented.
- [ ] **SEC-02** (L2953): The ~50 tracked `.planning/` docs no longer carry local absolute paths / the macOS username; verified by a no-allowlist scan (the gitleaks allowlist is path-based and blind here).
- [ ] **SEC-03** (L2511): `add_wizard_composite_key` is policed by the audit-coverage gate — the pragma-vs-real-emission decision is made and recorded, not dodged.
- [ ] **SEC-04** (L3006 + L3013): The bridge and portfolio-optimizer flows get a named `bridgeComputeLimiter` sized to backend reality (closing the 30× front/back mismatch) — ⛔ without resizing the shared `userActionLimiter`.
- [ ] **SEC-05** (L604): The tenth IP-keyed route (`simulator.py`) is repaired along with the test whose wrapper-check conceals it (equality assertion, quarantine shrinks to 0).
- [ ] **SEC-06** (L2361): Removing a panel mid-validate aborts the in-flight credential-carrying POST.

### DEPS — The booked dependency campaign

- [ ] **DEPS-01** (L798): All 9 open dependabot PRs are RESOLVED — landed or deliberately closed — in the research-verified order, full local suite between each. Binding corrections from STACK research (2026-08-20): prerequisite commit fixes `requirements.in` pandas 2.2.3→3.0.3 on main BEFORE #685 (which otherwise silently downgrades production pandas 3.0.3→2.3.3); #686's nine red checks are one incomplete dependabot lockfile — rebase + `npm install`, don't bisect; #614 (TypeScript 7) is CLOSED with reasons, not landed (compiler-API import in the seam-log coverage gate + typescript-eslint peer <6.1.0); #646 lands jsdom 30.0.1 not 30.0.0 (getComputedStyle calc() regression; note Node-25 local exclusion); #612 (supabase/setup-cli 3 — rides the PROD auto-migrate workflow, install source changes GitHub→npm) lands ALONE, validated on migration-drift-check first; #606 is closed as stale (bump the `fast-uri` override instead). Order: pandas prereq → #643 → #627/#626 → #612 → #685 → #686 → #645 → #646 → close #614/#606. ⛔ Blocked on OPS-01.

## Future Requirements (deferred, stay in TODOS.md)

All verified-open items NOT listed above remain in TODOS.md untouched — notably the r2 quick-win
pool (offered as "even more ambitious", declined), the founder-gated set (33 items), the
L-effort structural items (god-file decomposition, CSP nonce migration, D-09 composite healer,
FILL-arm recompute guarantee L3257, distributed match-recompute lock), and everything blocked on
another workstream.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Founder-gated ops (RESEND key, Zavara activation, sFOX/Nautilus go-live, MT5 live parity) | Not agent-deliverable; v1.18 owns the MT5 half |
| Founder-decision items (AUM basis L2237, manual-AUM clear L2238, retunes D-146-4 beyond the two 30× mismatches) | Value/product calls reserved to the founder |
| The 31 verified-stale TODOS.md entries | Solved by earlier milestones — closed in the same purge commit, not re-done |
| CSP nonce migration (L939) | L-effort, low blast radius today; stays in backlog |
| D-09 composite `stitch_composite` re-run mechanism (L2649) + FILL-arm recompute guarantee (L3257) | Each is its own phase-scale predicate design; deliberately not squeezed into a burndown |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RANK-01 | Phase 159 | Complete |
| RANK-02 | Phase 159 | Complete |
| RANK-03 | Phase 160 | Pending |
| RANK-04 | Phase 160 | Pending |
| RANK-05 | Phase 159 | Complete |
| RANK-06 | Phase 159 | Complete |
| RANK-07 | Phase 159 | Complete |
| RANK-08 | Phase 159 | Complete |
| RANK-09 | Phase 159 | Complete |
| SHARE-01 | Phase 164 | Pending |
| SHARE-02 | Phase 164 | Pending |
| SHARE-03 | Phase 164 | Pending |
| SHARE-04 | Phase 164 | Pending |
| WIZERR-01 | Phase 161 | Pending |
| WIZERR-02 | Phase 161 | Pending |
| WIZERR-03 | Phase 161 | Pending |
| WIZERR-04 | Phase 161 | Pending |
| WIZERR-05 | Phase 161 | Pending |
| WIZERR-06 | Phase 161 | Pending |
| WIZERR-07 | Phase 161 | Pending |
| WIZERR-08 | Phase 161 | Pending |
| WIZERR-09 | Phase 161 | Pending |
| WIZERR-10 | Phase 161 | Pending |
| WIZERR-11 | Phase 161 | Pending |
| WIZERR-12 | Phase 161 | Pending |
| WIZERR-13 | Phase 161 | Pending |
| HONEST-01 | Phase 162 | Pending |
| HONEST-02 | Phase 162 | Pending |
| HONEST-03 | Phase 162 | Pending |
| HONEST-04 | Phase 162 | Pending |
| HONEST-05 | Phase 162 | Pending |
| HONEST-06 | Phase 162 | Pending |
| OPS-01 | Phase 158 | Complete |
| OPS-02 | Phase 158 | Complete |
| OPS-03 | Phase 158 | Complete |
| OPS-04 | Phase 158 | Complete |
| OPS-05 | Phase 163 | Pending |
| OPS-06 | Phase 163 | Pending |
| OPS-07 | Phase 163 | Pending |
| OPS-08 | Phase 163 | Pending |
| OPS-09 | Phase 163 | Pending |
| OPS-10 | Phase 163 | Pending |
| OPS-11 | Phase 158 | Complete |
| SEC-01 | Phase 163 | Pending |
| SEC-02 | Phase 163 | Pending |
| SEC-03 | Phase 163 | Pending |
| SEC-04 | Phase 163 | Pending |
| SEC-05 | Phase 163 | Pending |
| SEC-06 | Phase 163 | Pending |
| DEPS-01 | Phase 165 | Pending |

**Coverage:**

- v1.20 requirements: 50 total
- Mapped to phases: 50 (Phases 158–165; roadmap created 2026-08-20)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-20*
*Last updated: 2026-08-20 after roadmap creation — 50/50 requirements mapped to Phases 158–165*

## Parked Milestone v1.18 requirements (NOT v1.20 scope — restored verbatim 2026-08-20)

v1.18 (MT5-VERIFY & founder confirmations, Phases 155/157) is PARKED, founder-gated: it needs
new MT5 investor passwords and the founder at the terminal on a trading day. These are its
requirements, restored verbatim from the pre-v1.20 accumulated REQUIREMENTS.md (archived at
`.planning/milestones/pre-v1.20-REQUIREMENTS-accumulated-snapshot.md`) so the open milestone
keeps a live requirements home. Do NOT plan these in v1.20.

#### MT5-06..10 — moved to Phase 142.3 (split 2026-08-03 at the D-14 valve)

⚠️ The five requirements below were **split out of Phase 142.2 into Phase 142.3** on 2026-08-03,
on the sizing finding in `142.2-RESEARCH.md`. They are unchanged in content — only their owning
phase moved. The cut is the founder's pre-authorised D-14 valve (*"we can do another phase right
after this one, if this one becomes too large"*), **not** a scope cut: nothing here is dropped,
deferred to v2, or made optional.

Why these five and not others: they are exactly the requirements that **cannot be satisfied
offline**. MT5-06/07/08 need a founder at the MT5 terminal on a trading day with the live funded
account; MT5-09/10 can only run once that comparison has produced numbers. MT5-10 is additionally
**uncapped by founder decision**, so bundling it with the reachability work made the combined
phase unsizeable rather than merely large. The dependency across the cut is one-directional —
142.2 makes MT5 reachable, 142.3 proves it correct.

⛔ **142.2 closing is not "MT5 is done."** It means MT5 is *reachable*. v1.15's failure mode was
shipping 6/6 green with both open items intact; these five are the items. Do not archive the
milestone or advertise MT5 until 142.3 passes.

- [ ] **MT5-06** *(measure-first)*: The MT5 server-UTC offset is **measured live and asserted on**,
  not assumed. The gateway's server time is read against UTC at connect and the observed offset is
  persisted (`139-VERIFICATION.md:12` names `MT5_SOAK_SERVER_OFFSET_MIN` as the intended carrier);
  a **near-midnight deal** becomes an explicit regression test — a deal within the offset window of
  midnight must land on the day the terminal shows. MT5 brokers stamp deals in broker-server time
  (commonly UTC+2/+3, DST-shifting) while dailies bucket by UTC date. ⚠️ This is the one failure the
  MT5-07 oracle **cannot see unaided**: a wrong offset leaves period totals reconciling perfectly
  while the daily series is shifted, corrupting Sharpe, max drawdown and every risk metric derived
  from it. Hardcoding the broker's offset is not acceptable — it breaks at the next DST transition
  and is wrong for every other broker.

- [ ] **MT5-07**: Rendered performance is verified against an **external** oracle — the MT5
  terminal's own equity and balance figures, or the broker statement, over a fixed window, matching
  within a stated tolerance. ⛔ Internal consistency (dailies compound to displayed equity, backbone
  agrees with UI) does **not** satisfy this: that is the self-referential oracle shape that let
  three money bugs survive six review passes. `analytics-service/services/broker_dailies.py` already claims `account_info()
  .equity` is authoritative (`combine_mt5_deal_ledger`'s docstring — "``account_info().equity`` is ALWAYS authoritative" :604; `def combine_mt5_deal_ledger(` :545); this tests the claim.

- [ ] **MT5-08**: Verification runs against the **live funded account** on a **trading day** — real
  fills, fees, swap charges and equity, via the read-only investor password. A demo account does
  not satisfy this (synthetic fills/swaps, artificial starting balance exercising different anchor
  logic), nor does reusing the v1.15 soak account (it shipped green with both open items intact, so
  it has already demonstrated it does not catch these). A weekend run proves nothing.

- [ ] **MT5-09**: Every surface that renders strategy performance shows the same, correct MT5
  numbers — strategy detail, public factsheet, scenario composer, portfolio PDF, browse. The
  architecture says these agree by construction (`analytics-service/services/job_worker.py` — the
  `# 5. #5 collapse (D4): asset_class is THE annualization clock selector` block :6163-6172, whose
  `periods_per_year = periods_per_year_for_asset_class(` is :6170, via shared
  `strategies.asset_class`), and MT5's annualization clock is already correct
  (`src/app/api/strategies/create-with-key/route.ts` stamps `asset_class: isCryptoExchange(exchange) ? "crypto" : "traditional",` :514;
  `src/app/api/strategies/finalize-wizard/route.ts` says "stamp `traditional` for mt5 (forex/CFD)" :829; `portfolio-stats
  .ts` **defaults** to 252, so a caller that forgets the basis still lands on MT5's right clock —
  crypto is the fragile direction, not MT5). This requirement exists to **test that invariant, not
  assume it**: the backbone-bypass surfaces logged in `TODOS.md` — `_compute_portfolio_analytics`
  (`analytics-service/routers/portfolio.py` — `async def _compute_portfolio_analytics(` :628), `equity_reconstruction.py`, and the bespoke TS
  stacks `portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts` — **re-derive**
  metrics rather than reading them, and are the one place it could be false. One daily series
  checked five ways; a divergence is a finding.

- [ ] **MT5-10** *(uncapped by founder decision)*: Any discrepancy MT5-07/09 surfaces is **fixed
  within this phase**, wherever its root cause lives — including in shared backbone money-math
  affecting every venue. A bounded alternative (split shared-cause fixes into their own phase) was
  offered and **declined**, so the planner must size for the unbounded case rather than treat it as
  an escape hatch. The phase does not close while the terminal and the UI disagree: a known-wrong
  number rendered to users is worse than an unfinished phase.

- [ ] **MT5-13** *(found by the MT5-05 live run, 2026-08-04 — BLOCKS a clean MT5-05 pass)*: **A venue
  with no API-scope concept never renders a failed scope probe.** The MT5 success screen shows
  `PROBE_FAILED: Could not check key scopes. Try again.` in red, with copy blaming the venue
  ("This is a problem at the venue — try again shortly"). It is **deterministic, not flaky**: the
  probe handler (`analytics-service/routers/internal.py` — `@router.post("/keys/{key_id}/permissions")` :184 / `async def get_key_permissions(` :185, running to EOF :564) contains **zero `mt5` references**
  and its own docstring names step 5 as *"Open a CCXT exchange + call `detect_permissions`"*. MT5 is
  not a ccxt venue and a login / investor-password / server triple **has no scopes to detect**, so
  `detect_permissions` throws → 424 `EXCHANGE_PROBE_FAILED` → `src/lib/wizardErrors.ts` maps it to
  `KEY_PROBE_FAILED` (`VENUE_WIRE_CODE_TO_VERDICT` :1795, its `["PROBE_FAILED", { code: "KEY_PROBE_FAILED", status: 503 }],` row :1802; cascade fallback :2104). Every MT5 key hits it, every time.
  **Why this blocks MT5-05:** that requirement's wording is "without needing to know an internal
  error code", and a literal `PROBE_FAILED:` string on the success screen is exactly that. The
  "try again" advice is also unwinnable — retrying can never succeed.
  ⛔ **NOT a security hole, and the fix must not be sold as one.** Read-only IS enforced for MT5, by
  a different and appropriate mechanism: `_validate_mt5_key` (`analytics-service/routers/exchange.py` — `async def _validate_mt5_key(` :222; ⚠️ `routers/`, not `services/exchange.py`), built as
  the fail-CLOSED clone of the sFOX validator, probes with `client.order_check(mt5_probe_request())`
  and rejects any credential that can trade. Verified 2026-08-04. The defect is the *badge*, not the
  enforcement.
  **Shape:** follow the D-03 precedent set by `passphraseSecret` — a per-venue capability flag whose
  DEFAULT preserves today's behaviour, so every ccxt venue stays byte-identical and MT5 opts out. MT5
  renders an explanatory line (investor passwords are read-only by design), never a failed probe.

- [x] **MT5-14** *(found by the MT5-05 live run, 2026-08-04)*: An MT5 strategy can declare **MT5** as
  its supported exchange in the wizard metadata step, and the venue is **preselected from the key the
  founder already connected** rather than asked again.
  ⛔ **SEVERITY CORRECTED 2026-08-04 — this was mis-filed as cosmetic and it is a HARD BLOCKER.**
  The same ccxt-only probe is called by `finalize-wizard` on EVERY submit as a scope-broadening
  defence. ⚠️ **Line numbers re-derived from source 2026-08-08** (the previous set — `:175`,
  `:194`, `:519` — had drifted; phases 150–152 moved this file). In
  `src/app/api/strategies/finalize-wizard/route.ts`: the probe fetch of
  `/internal/keys/{id}/permissions?force_refresh=true` at **:220**, the `if (!res.ok)` throw at
  **:237**, and the catch mapping to `KEY_NETWORK_TIMEOUT` at **:617** and **:628**. For MT5 the
  probe throws `Unsupported exchange: mt5` (confirmed in Sentry 2026-08-04T11:53:52 on
  `GET /api/keys/6d36dd92-…/permissions`), so a PERMANENT venue-unsupported condition is
  reported to the user as a temporary network blip that says "try again" — the founder clicked Retry
  **five times** against a failure that can never succeed.
  **Consequence: an MT5 strategy cannot be submitted AT ALL.** MT5 reaching the wizard's preview
  (v0.53.0.0) is real, but the LAST click fails in a different subsystem, so MT5 is **not usable
  end-to-end in production**. MT5-05 is not completable until this lands.
  **Two distinct fixes, both required:** (a) the probe must handle MT5 (or finalize must not demand a
  ccxt scope probe for a venue that has none — read-only is already proven by `_validate_mt5_key`);
  (b) the catch-all mapping of any probe failure to `KEY_NETWORK_TIMEOUT` must stop — a permanent
  unsupported-venue error must never render as a retryable timeout.
  **Observed (the badge, same root cause):** the "Supported exchanges" chips render Binance / OKX / Bybit / Deribit / sFOX — no MT5
  — on a strategy whose only key IS MT5. The founder must either mis-declare the venue or leave it blank.
  ⛔ **This is NOT the MT5-11 drift class — do not "fix the stale list".** It is DELIBERATE:
  `src/lib/closed-sets.ts:119-122` (the docblock above `export const MT5_UI_ENABLED` :124) states *"mt5 stays OUT of UI_EXCHANGE_CODES / EXCHANGES / FUNDING_EXCHANGES
  / CRYPTO_EXCHANGES regardless of this flag — the manager-surface `<Select>` must not silently
  widen"*, citing UI-SPEC §MT5-Manager-Parity and enforced by the `closed-sets.mt5-flag` no-widening
  pin. **A test WILL go red when this changes, and that is the guard working, not a regression to
  route around.** The pin must be re-cut deliberately, with its reasoning updated, in the same commit.
  **Why the decision is now outgrown:** it was taken while MT5 could not reach the end of the wizard.
  As of v0.53.0.0 it can, so a live MT5 strategy now hits a metadata step that cannot describe it.
  **Second half, independent of the list:** the wizard already knows the connected key's exchange, so
  preselecting it removes the question entirely. Do not ship the widening without the preselect —
  widening alone just adds a sixth chip the founder still has to find.

- [ ] **MT5-15** *(raised by the MT5-05 close, 2026-08-04 — the caveat on that checkbox, given its own
  ID so it cannot be lost)*: An MT5 strategy's analytics complete **without warnings**, or the warning
  is understood and accepted in writing. **All three** MT5 strategies on PROD carry
  `computation_status='complete_with_warnings'` (`8d382aaf` Alpha Centauri, `4eab92b0` Black Swan, and
  Arctic Fox) with `computation_error = NULL`.
  ⚠️ **NOT investigated.** MT5-05 is discharged on the wizard-completion criterion it was written
  against, and this does not reopen it — but it is the reason that checkbox must not be read as "the
  MT5 numbers are audited". Establish what the warning IS before deciding whether it matters; it may
  be benign (short history, non-trading days) or it may be the same class MT5-07 exists to catch.
  ⛔ Do NOT plan MT5-07 (external-oracle verification) as closing this — MT5-07 compares rendered
  performance against the terminal; this asks why our own pipeline flagged itself.

---

So the phase requirement measured the wizard, and the founder measures the **product**. Both readings
are defensible; the founder's is the one that decides whether MT5 ships. The gap between them is
exactly SCEN-01 (the series never reaches the scenario engine) and OWN-02 (no factsheet for an
unpublished strategy you own) — neither of which is an MT5 defect. **MT5 is the first venue to
traverse this path from a cold start, so it is exposing pre-existing holes in the surfaces AFTER
ingestion, not bugs of its own.** Every one of the findings below reproduces for non-MT5 strategies.

- [ ] **MT5-GOAL-01**: An MT5 strategy is usable end-to-end by the allocator who uploaded it: it
  ingests (done), it **projects in a scenario** (blocked by SCEN-01), and its **factsheet is
  viewable** (blocked by OWN-02). This is an umbrella acceptance requirement — it closes only when its
  three dependencies close, and it exists so "MT5-05 ✅" can never be mistaken for "MT5 works".
