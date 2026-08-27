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

- [x] **SHARE-01** (L27): "Copy Link" always yields a URL its recipient can view — a revocable per-strategy share token carried in the URL, mint-or-reuse on copy; the bare `/factsheet/<id>` URL stays owner-only and the id stays a non-secret. (URL shape — `?s=<token>` on the id route vs a separate `/factsheet-share/[token]` route — is the SHARE phase plan's decision; research disagrees and the choice must be argued, not defaulted: A-D1.)
- [x] **SHARE-02** (L27): The token lane never contaminates the id-keyed public cache — after any token-lane render, an anonymous request for `/factsheet/<id>` of an unpublished strategy STILL 404s (adversarial acceptance, same class as OWN-02).
- [ ] **SHARE-03** (L27): A revoke control regenerates the token and kills previously-copied links.
- [ ] **SHARE-04** (L27): The share affordance is honest as a CLASS — no "Link copied!" success for a link that cannot work, consistent across `FactsheetView` and the strategies page, and covering the two research-found siblings: a token-link RECIPIENT must not see a Copy-Link control that rebuilds the URL without the token (`FactsheetView.tsx:1312` strips it today), and `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence must be corrected in the same phase (it becomes false the moment tokens ship).

### WIZERR — Honest error surfaces (the recorded WIZFORM-02 class residue)

- [x] **WIZERR-01** (L75): The MT5 "gateway misconfigured" copy names the actual blocker, derived from the `terminal_info` flags the probe already holds (`tradeapi_disabled` vs `trade_allowed`) — fixed as a class across all six carrier sites, within the curated-message test fence.
- [x] **WIZERR-02** (L1788): "Try another key" never destroys the draft or cascades away composite members.
- [x] **WIZERR-03** (L2466): An orphaned live key (no strategy) surfaces an honest remedy instead of a false `DRAFT_ALREADY_EXISTS` 409.
- [x] **WIZERR-04** (L410): The `keys/[id]/permissions` private `PROBE_*` cascade gets a derived-population coverage law, and `KEY_UNDECRYPTABLE`'s remedy sentence says "reconnect the key", not "try again".
- [x] **WIZERR-05** (L486): `MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` threads end-to-end (a fourth optional `AnalyticsUpstreamError` field, relayed by both key-route catches).
- [x] **WIZERR-06** (L436): The five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward recognized `seamCode`s instead of collapsing the severe half of the vocabulary.
- [x] **WIZERR-07** (L2581): `AllocateDialog`, `RenameStrategyDialog`, and `MarkOwnershipDialog` stop minting `code: UNKNOWN` — the coverage law reaches the dashboard dialogs this class regrew on.
- [x] **WIZERR-08** (L1779): The `KEY_INVALID_FORMAT` one-code-many-causes split lands on the remaining 2 routes / 9 sites, honoring their internal-vs-public copy contracts.
- [x] **WIZERR-09** (L1871 + L1879): The 7-row CSV floor is evaluated on the wizard composite arm, and `INSUFFICIENT_CSV_HISTORY` renders its own copy instead of UNKNOWN — landed together or not at all.
- [x] **WIZERR-10** (L1883 + L1907): Examined-but-refused verdicts render truthful copy (a fourth outcome replaces the false "only 0 trade(s)" sentence; the publish-time TOCTOU re-check wording follows), with D-15's oracle re-cut deliberately.
- [x] **WIZERR-11** (L1948): Wizard `AUTH_FAILED` copy is parameterized by the selected venue — never names Deribit while Binance is selected.
- [x] **WIZERR-12** (L3091): The csv-finalize A2 409 sentence describes the actual case (same track record, different flow).
- [x] **WIZERR-13** (L1518): The per-row CSV breakdown renders its data half without leaking `'nan'` or echoing untrusted cell contents.

### HONEST — User-visible data honesty

- [x] **HONEST-01** (L1939): Raw Python exception strings never render as user-facing `computation_error` copy — curated at the write boundary.
- [ ] **HONEST-07** (split from HONEST-01, 2026-08-26): Root-cause the `str`/`None` compare behind the 2 damaged rows. Stage (`poll_positions`), window (2026-06-10 … 06-14) and population (2 strategies, one shared 59-char `TypeError`) are pinned; no site exists at HEAD and no traceback survives, and the job kind is retired (0 successes ever, dead since 2026-06-14). May prove unclosable — reassess rather than carry forever.
- [x] **HONEST-08** (found by post-deploy QA 2026-08-26, assigned to Phase 163): The public discovery table's "Synced Nd ago" badge must not advertise freshness a dead return series contradicts. MEASURED ON PROD: `Phoenix Protocol` renders "Synced 7h ago" on `/browse/crypto-sma` while its series ends 2026-05-06 — **112 days stale**; its own factsheet chip correctly reads `Track record · old`. Two public surfaces, one strategy, contradicting each other. HONEST-02 fixed the factsheet chip; HONEST-03 scoped the badge fix to EXAMPLE rows only, so real published strategies were never covered — and with the 15 examples deleted the `is_example` gate now sees no row that would exercise it. ⛔ Do NOT close by removing the badge: bucket it on the staler of sync- and series-recency, mirroring `FreshnessChip`.
  ✅ **VERIFIED LIVE ON PROD 2026-08-26** (real browser, unauthenticated). Both original defect
  rows now name the staler clock: `Momentum Sphinx` renders "Track record ends 7d ago" (was
  "Synced 16m ago") and `Phoenix Protocol` renders "Track record ends 112d ago" (was
  "Synced 7h ago"). The badge changed SUBJECT, not just wording.
  ⚠️ Limit not cleared: both visible rows legitimately bind to the series arm, so this page
  cannot distinguish correct staler-of-two from always-binds-to-series — the over-binding
  failure `FreshnessChip` warns about (it would delete the sync copy everywhere) needs a
  published row with a FRESH series to prove absent. Newest series end across PROD is 1 day
  old, so such a row exists but is not on this cohort.

- [x] **HONEST-02** (L1953): The factsheet freshness badge reflects series recency — a strategy whose return series ended 89 days ago cannot read FRESH; investigate (flat account vs derive gap) before fixing.
- [x] **HONEST-03** (L1959): Example strategies don't advertise stale "Synced Nd ago" badges on discovery.
- [x] **HONEST-04** (L1991): `buildEquityCurveSeries` serves real per-strategy equity curves now that `returns_series` is selected — the hard-coded `equityCurve: null` and its false comment go.
- [x] **HONEST-05** (L2209): Drawer-added strategies render CAGR/Sharpe like book rows.
- [x] **HONEST-06** (L2110): "Finish setup →" opens the wizard with the clicked key preselected.

### OPS — CI/deploy integrity & reliability

- [x] **OPS-01** (L2258 + L2259): The `shared-test-db` concurrency group no longer evicts queued main-branch jobs — a PR opened mid-run cannot make main CI conclude `cancelled` and silently skip the Railway analytics deploy; GitHub issue #616 closed on the fix. ⚠️ Research correction is binding: shrinking the group does NOT fix this (eviction is cross-run — one member + three runs still evicts queued main); the fix is an external FIFO mutex for DB-touching jobs plus a `cancelled`-conclusion watcher. ⛔ Hard prerequisite for DEPS-01.
- [x] **OPS-02** (L1741): `sql-tests` is in an aggregator's `needs:` — the only gate that executes the deployed cron body cannot be present-and-failing with nothing gating on it.
- [x] **OPS-03** (L2570 + L1035): The orphaned e2e specs (incl. the NAV-01 surface) run in a CI batch, and DB-types drift gets a regeneration gate (or an explicit recorded decision not to).
- [x] **OPS-04** (L2715 + L2265 + L2730): The TEST stale-`pending` backlog gets a TEST-only drain (⛔ never a migration, never `cron.unschedule(9)`), and `test_compute_jobs_fencing.py` stamps `claimed_at` in its two direct UPDATEs.
- [x] **OPS-05** (L360): The structlog frozen-proxy class is fixed at the class level (no module-level proxy can bind a pre-`configure_logging` chain that skips `_redact_processor`), with a regression test. ⚠️ Two failure modes, each candidate fix closes only one: dropping `cache_logger_on_first_use` misses module-scope `.bind()` (broken regardless of the cache flag per structlog docs) — needs a source-scan gate for Mode A plus a behavioral redaction test for Mode B.
- [x] **OPS-06** (L3116): `createAdminClient()` cannot throw on the request path after an irreversible commit — the class is closed at all three known sites.
- [x] **OPS-07** (L1594 + L1595 + L1600): Flag-monitor honesty — a failed monitor read PAGES instead of logging success, and the integration test actually falsifies it.
  ⚠️ AMENDED 2026-08-26. The original wording opened with "`checkStuckNotifications` distinguishes 'nothing stuck' from 'could not tell'". That clause is closed BY DELETION, not by implementation: the phase did rewrite the function to a discriminated union so `0` would stop meaning both — and review WR-11 then found the function had ZERO production callers and never had any. It originated in a v1.0.0 diagnostic spike that was never wired. The whole module is gone (`src/lib/observability.ts`, 68 lines, its test, its byte-gate fixture, and a `knip.json` entry-point declaration that existed solely to silence the dead-code detector on it — three separate guards protecting code nobody called).
  ⭐ The reason this is a closure and not a regression: an uncalled monitor is not observability. It reads as coverage while providing none, which is the same defect the requirement's own word "honesty" is about. Wiring a caller would have manufactured a monitor no one asked for or consumed.
  The surviving clauses are MET and strengthened — review WR-02 found the fix had closed one of four blind arms, and the three numerator arms (sentry fetch threw, non-ok response, missing credentials) now return 503 like the denominator arms already did.

- [~] **OPS-08** (L1562): The 10-param `_enqueue_compute_job_internal` no longer uses `INTO STRICT` on its lost-race branches (parity with the deliberately de-STRICT-ed 7-param overload).
  ✅ MET — MEASURED ON PROD 2026-08-26 after the merge: the 10-param body carries **0**
  `INTO STRICT` lost-race re-reads, raises `serialization_failure`, and holds the OPS-08 marker
  comment. Prior note said "no database has the migration"; that is now true only of TEST.
  ⛔ TEST still runs the PRE-FIX body and nothing applies migrations to it, so the SQL gate's
  pre-apply SKIP is PERMANENT there and no test executes the deployed body — see SKIP-01.
  ⚠️ MET-AT-MERGE, not pending. The requirement is worded about the DEPLOYED function and
  merging was the only automated apply path, so the merge WAS the remedy and blocking on it
  would have been causally backwards. ⛔ Verified consequence: the gate's
  `SKIP (Part 3)` marker does not match CI's anti-SKIP net, so the lane stays green and NO CI
  signal will ever redden to report the unapplied state — only prose tracks it. See DRIFT-01.

- [x] **OPS-09** (L1561): The resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window).
- [x] **OPS-10** (L1558): The retry loop cancels abandoned response bodies (`body.cancel()`) so undici stops buffering until the attempt signal fires.
- [x] **OPS-11** (L1531): The `MultiKeyConnectStep` order-sensitive flake is root-caused (unrestored `vi.stubGlobal`/`vi.mock` class) and fixed, not retried-away.

### LEDGER — Recurring strategy refresh for ledger-backed venues (Phase 161.1)

- [x] **LEDGER-01**: A recurring enqueuer reaches `strategy_analytics` for every ledger-backed venue via the strategy-keyed chain TAIL (`derive_broker_dailies` strategy-mode = `JOB_CHAIN_FOLLOW_ON["process_key_long"][0]`), never the ccxt fill path and never a re-enqueue of `process_key_long` (provably a no-op: `long_fetch.py:154` returns DONE on `published`, `:193` on the whole advanced-status set). Cohort scoped off `_LEDGER_BACKED_SOURCES`, never off absence from `EXCHANGE_CLASSES` — deribit is in `EXCHANGE_CLASSES`.
- [x] **LEDGER-02**: It ships DORMANT behind two locks with real readers — no schedule registered anywhere in the repo (WORKER-03 rule: `supabase/migrations/**` auto-applies to PROD) plus a fail-closed activation setting the fan-out itself reads — and activation is a documented, ordered, reversible founder LIVE op (`docs/runbooks/ledger-refresh-go-live.md`). Merging changes no prod behaviour.
- [x] **LEDGER-03**: Staleness is observable on a timestamp that advances ONLY when new analytics data lands — the max date inside `strategy_analytics.returns_series`, conjoined with `computation_status` treating BOTH `complete` and `complete_with_warnings` as success. ⛔ Never `last_sync_at` (advanced daily by key-scoped jobs) and never `strategy_analytics.computed_at` (re-stamped `now()` on EVERY job transition including the `failed` arm), proven by a test that advances both rejected timestamps without new data and shows the check still fails.
- [x] **LEDGER-04**: A regression pin fails if any ledger venue is dropped from the refresh set, behind an anti-vacuity floor, proven RED by neutering. The venue set is written in exactly ONE place in SQL and drift-gated against the Python constant; no TypeScript mirror (`strategyGate.invariant.test.ts` bans venue literals after a mirror drifted).

### SEC — Small security hardening

- [x] **SEC-01** (L940): The server-side password policy is verified and enforced — client `minLength={6}` is backed by an explicit Supabase-side policy, documented. ⚠️ MEASURED 2026-08-26 and recorded as a point-in-time READING, never as an invariant.
  ⚠️ QUALIFIED 2026-08-26 (review WR-10). What was delivered is a MEASUREMENT, not a raised
  floor: the hosted minimum was READ from the live endpoint's own rejection (6 characters,
  `reasons: ["length"]` alone ⇒ no character-class rule) and mirrored in one exported constant,
  retiring the assumption that it was the GoTrue default. That is what "verified" means here.
  ⛔ It does NOT mean the floor was found adequate. A platform custodying decryptable exchange
  keys still accepts a six-character all-lowercase password, and nothing in this phase raised
  the actual gate — the client constant is UX only, the real gate is hosted GoTrue, and both the
  minimum and leaked-password protection are dashboard-owned with no repo representation.
  ✅ ACCEPTED RISK — founder decision 2026-08-26 (WR-10 in TODOS.md). The six-character,
  no-character-class floor stands, knowingly, with the key-material exposure path understood.
  This entry therefore claims exactly two things and no more: the hosted policy was MEASURED
  rather than assumed, and the resulting floor was ACCEPTED rather than cleared. It does not
  claim the floor is adequate. Revisit on paying clients, a custody/compliance requirement, or
  any evidence of credential stuffing; the remedy in TODOS does not expire.

  1. **The reading.** The hosted production project's minimum password length is **6**, with **no character-class requirement**. Both facts are the server's own, not the GoTrue default — which is exactly what RESEARCH assumption A1 assumed and this measurement retires.
  2. **The method, and why it was the only lane.** No management-API token exists on the machine that ran this (`~/.supabase/access-token` absent, `SUPABASE_ACCESS_TOKEN` unset) and the Supabase MCP exposes no auth-config reader, so the policy was read directly off the live signup endpoint with a deliberately-failing 1-character password — rejected at validation, so no account is created. It answered `422 weak_password` ("Password should be at least 6 characters.") with `weak_password.reasons = ["length"]`. The second fact needs no second probe: a 1-character lowercase password violates length AND every character class at once, GoTrue enumerates every violated reason, and a configured character policy would have added `"characters"`. It returned `["length"]` alone.
  3. **"Enforced" cannot mean enforced HERE — and that is not a shortfall.** Signup goes browser → hosted GoTrue directly (`supabase.auth.signUp`); there is no Next.js server hop to enforce anything on, and `minLength` on an input is an HTML affordance devtools bypasses. So the client floor is UX only, and the requirement's "backed by" is the real claim: the hosted minimum is EQUAL to the client floor, not merely compatible with it. The plan's escalation branch (hosted minimum < 6 ⇒ a founder-visible live op to raise it) did not fire.
  4. **Drift-proofing.** The two independent client constants — a bare `minLength={6}` literal in `SignupForm.tsx` and a private `const MIN_PASSWORD_LENGTH = 6` in `ResetPasswordForm.tsx` — are unified into one exported `MIN_PASSWORD_LENGTH` in `src/lib/auth/password-policy.ts`, whose docblock carries the value, the date and the method. Both forms now derive their `minLength` **and** their user-facing copy from it. ⛔ `supabase/config.toml` (`minimum_password_length`, `password_requirements`) is NOT the hosted policy — it governs only the LOCAL dev stack, and citing it as evidence is the specific mis-citation this entry exists to prevent.
  5. **The limit of the guarantee, stated rather than papered over.** The setting is dashboard-owned with no repo representation; it can change outside git at any time and no test here can observe that. `src/lib/auth/password-policy.test.ts` therefore pins only what the repo controls — that the constant still equals the recorded reading, and that neither form has re-hardcoded a numeric `minLength`. Proven able to fail in three directions (each neuter observed RED, then restored and hash-verified): re-hardcoding `minLength={6}` in `SignupForm.tsx`, dropping the constant to 5, and reverting `ResetPasswordForm.tsx` to its own private constant.
- [x] **SEC-02** (L2953): The tracked docs no longer carry local absolute paths / the macOS username; verified by a no-allowlist scan (the gitleaks allowlist is path-based and blind here). ⚠️ MEASURED 2026-08-26 (pre-edit, NUL-safe, tree-wide): **95** tracked files of 5693 carry the token — **88** under `.planning/` and **7** outside it — across ~940 raw occurrences. Earlier figures were undercounts: the ROADMAP's "~50" was low, and both "80" and "87" are `.planning/`-only figures that leave the 7 non-planning files leaking. Always re-measure live; the count drifts as files are added.

  Four decisions are RECORDED here because the requirement, not just the code, has to carry them:

  1. **Founder ruled forward-only redaction; history rewrite declined (2026-08-26).** The username was pushed to a PUBLIC repo, so it is already cloned, forked, and cached. A `filter-repo` over ~700 commits would break every open PR ref, invalidate the `archive/v1.20-phase-162-planning-artifacts` tag, and STILL not unpublish the strings. The scrub therefore stops NEW leakage; it does not undo the old. That limit is accepted, not overlooked.
  2. **Severity framing: metadata, not credentials — do not inflate it.** The token is a macOS username and local directory layout. It is not a secret, no runtime reads it, and nothing needs rotating (RESEARCH runtime-state inventory: zero stored data, zero service config, zero env vars). This entry exists to stop drip-leakage of local identity on a public repo, and treating it as a credential incident would misprice every future finding of this class.
  3. **Scope extended beyond `.planning/`, including a COMMENT-ONLY exception on two APPLIED migrations.** A gate scoped to `.planning/` would itself be a path restriction — the very blindness it exists to fix — so the scrub covered the whole tracked tree: 5 files under `docs/` and 2 applied Supabase migrations. Editing an applied migration violates migration-reviewer rule 11, so this is a DELIBERATE, recorded deviation, bounded three ways: only comment lines changed (every changed line begins with `--`, zero SQL bytes), each file carries a `⚠️ RECORDED EXCEPTION` header stating what was edited and why, and the precondition was verified read-only BEFORE the edit — the Supabase CLI reconciles applied migrations by VERSION, never by content hash (history table `schema_migrations (version text NOT NULL PRIMARY KEY)`; reconciliation read `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`; upsert `ON CONFLICT (version)`; upstream `FindPendingMigrations` diffs version strings parsed from filenames). Had reconciliation been content-hashed, the plan's precondition required a HALT instead. Exception headers: `supabase/migrations/20260517013000_revoke_probe_oracle_assert_strategy_visible_to_allocator.sql` and `supabase/migrations/20260517013100_sanitize_user_recipient_email_case_insensitive.sql`.
  4. **The gate is no-allowlist BY CONSTRUCTION** (`scripts/check-planning-hygiene.ts`, chained into `npm run lint`, which rides the `frontend-lint` CI job already inside the `frontend` aggregator — ⛔ deliberately NOT the `secret-scan` job, which is outside the aggregator and already red on `workflow_dispatch`). It scans every tracked file with ZERO path exclusions — not its own source, not tests, not `supabase/migrations/`, not fixtures. Its ONE exemption is by VALUE: the placeholder `<user>` immediately following a matched prefix, which is non-identifying wherever it sits. A path carve-out is forbidden — that is precisely how gitleaks went blind. Two blind spots are closed structurally: the needle is stored base64/char-coded so the scanner passes its own scan without needing the carve-out it forbids, and every file is read `latin1` (byte-exact) so a NUL byte cannot hide content the way `git grep -I` does on `src/lib/wizardErrors.test.ts`. Proven able to fail in BOTH directions: a scratch tracked file with one raw occurrence took `npm run lint` green → exit 1 → green, and injecting a `supabase/migrations/` path allowlist into the scanner turned its own no-path-allowlist test RED (restored).
- [x] **SEC-03** (L2511): `add_wizard_composite_key` is policed by the audit-coverage gate — the pragma-vs-real-emission decision is made and recorded, not dodged.

  1. **The decision: KEEP the pragma; do NOT emit at add-key time.** `add_wizard_composite_key` writes a DRAFT strategy plus an `api_keys` row that is not yet user-visible; the user-visible creation is audited at finalize time in `strategies/finalize-wizard/route.ts`. Its sibling `create_wizard_strategy` — column-for-column the same signature — already follows that draft-then-finalize audit shape, so emitting here would duplicate the finalize event and make the audit log say a strategy was created twice. The pragma's stated reason was already coherent; what was missing was any mechanism that reads it.
  2. **Why the entry was needed at all — MEASURED, not argued.** The gate's RPC detection is allowlist-driven, and the name's ABSENCE from `MUTATING_RPC_NAMES` is what made the `@audit-skip` pragma at the call site decorative: the gate never saw the call, so it never evaluated the pragma. Control run 2026-08-26 — with the name unlisted, DELETING the pragma entirely left `audit-coverage.test.ts` GREEN (17 passed): an unaudited, unpragma'd mutating RPC sailing through the audit law. That is the escape, observed rather than inferred.
  3. **The pragma is now live law.** With `"add_wizard_composite_key"` listed, the same deletion turns the gate RED, naming the exact site (`strategies/composite/add-key/route.ts:477`); restoring the pragma returns it to green. Falsifier observed in both directions on 2026-08-26, restore hash-verified.
  4. **Phase 164 prerequisite.** This allowlist is the ONE edit SHARE's mint/revoke RPCs must land in. They now land in a gate proven to work — SEC-03 standing is what makes that dependency real rather than nominal.
  5. **Adjacent debt corrected, not inherited (DEF-141.2-03-A).** The `it.skip` H-0001 comment in the same file cited retired coordinates. Its census was re-measured: every line number was stale, the "kill-switch flip" site it named no longer exists (Phase 106 Stage B made flag-monitor alert-only), and three sites it never listed do exist — the uncovered single-line-mutation set is **6**, not 4. The comment now carries the re-measured list, the method that produced it, and a warning not to trust the numbers past the next refactor. ⚠️ Those six remain UNFIXED and out of this requirement's scope; H-0001 is still deferred.
- [x] **SEC-04** (L3006 + L3013): The bridge and portfolio-optimizer flows get a named `bridgeComputeLimiter` sized to backend reality (closing the 30× front/back mismatch) — ⛔ without resizing the shared `userActionLimiter`.
- [x] **SEC-05** (L604): The tenth IP-keyed route (`simulator.py`) is repaired along with the test whose wrapper-check conceals it (equality assertion, quarantine shrinks to 0).
- [x] **SEC-06** (L2361): Removing a panel mid-validate aborts the in-flight credential-carrying POST.

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
| SHARE-01 | Phase 164 | Complete |
| SHARE-02 | Phase 164 | Complete |
| SHARE-03 | Phase 164 | Pending |
| SHARE-04 | Phase 164 | Pending |
| WIZERR-01 | Phase 161 | Complete |
| WIZERR-02 | Phase 161 | Complete |
| WIZERR-03 | Phase 161 | Complete |
| WIZERR-04 | Phase 161 | Complete |
| WIZERR-05 | Phase 161 | Complete |
| WIZERR-06 | Phase 161 | Complete |
| WIZERR-07 | Phase 161 | Complete |
| WIZERR-08 | Phase 161 | Complete |
| WIZERR-09 | Phase 161 | Complete |
| WIZERR-10 | Phase 161 | Complete |
| WIZERR-11 | Phase 161 | Complete |
| WIZERR-12 | Phase 161 | Complete |
| WIZERR-13 | Phase 161 | Complete |
| LEDGER-01 | Phase 161.1 | Complete |
| LEDGER-02 | Phase 161.1 | Complete |
| LEDGER-03 | Phase 161.1 | Complete |
| LEDGER-04 | Phase 161.1 | Complete |
| HONEST-01 | Phase 162 | Complete |
| HONEST-07 | Unassigned | Pending |
| HONEST-08 | Phase 163 | Complete |
| HONEST-02 | Phase 162 | Complete |
| HONEST-03 | Phase 162 | Complete |
| HONEST-04 | Phase 162 | Complete |
| HONEST-05 | Phase 162 | Complete |
| HONEST-06 | Phase 162 | Complete |
| OPS-01 | Phase 158 | Complete |
| OPS-02 | Phase 158 | Complete |
| OPS-03 | Phase 158 | Complete |
| OPS-04 | Phase 158 | Complete |
| OPS-05 | Phase 163 | Complete |
| OPS-06 | Phase 163 | Complete |
| OPS-07 | Phase 163 | Complete |
| OPS-08 | Phase 163 | Complete — APPLIED + verified on PROD 2026-08-26. ⛔ NOT on TEST (see SKIP-01) |
| OPS-09 | Phase 163 | Complete |
| OPS-10 | Phase 163 | Complete |
| OPS-11 | Phase 158 | Complete |
| SEC-01 | Phase 163 | Complete |
| SEC-02 | Phase 163 | Complete |
| SEC-03 | Phase 163 | Complete |
| SEC-04 | Phase 163 | Complete |
| SEC-05 | Phase 163 | Complete |
| SEC-06 | Phase 163 | Complete |
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
