# Roadmap: Quantalyze

## Shipped Milestone: v1.17 MT5 — ingested, wizardable, surfaced (Phases 147–154, 156) ✅ CLOSED 2026-08-14

⚠️ **SCOPE AMENDED 2026-08-14, and the amendment is the point.** This milestone originally ran
147–155 and its title claimed *"usable end-to-end, not merely ingested"*. Phase 155 (MT5-VERIFY —
the live trading-day parity run against the terminal's own figures) was **REMOVED from scope and
carried to v1.18**. It was neither silently dropped nor ticked unmet. With it went MT5-06, MT5-07,
MT5-08, MT5-09, MT5-10, MT5-15 and the umbrella acceptance MT5-GOAL-01.

**Founder decision (2026-08-14).** A bounded alternative — move 155 to TODOS.md and tick v1.17
complete — was offered and **declined**, on the grounds that it would leave every ledger reading
"MT5 usable end-to-end" while our numbers had never once been compared to the broker's.

⛔ **CLOSED but NOT ARCHIVED, and MT5 is NOT advertised.** What v1.17 actually earns: MT5
*ingests*, is *declarable in the wizard*, *projects in a scenario*, has a *viewable factsheet*,
and the wizard's write is the server's alone. What it does NOT earn: any claim that the
performance we render matches the terminal's. Nobody has compared them.

⭐ **MT5-GOAL-01 was written as a tripwire against exactly this reading** — it exists, in its own
words, "so 'MT5-05 ✅' can never again be mistaken for 'MT5 works'." Carrying it into v1.18 keeps
the tripwire armed. Discharging it by relocation would have disarmed it, which is precisely
v1.15's failure mode: shipped 6/6 green with both open items intact.

---

## Current Milestone: v1.20 Backlog Burndown (Phases 158+)

**Goal:** Close the largest relevancy-ranked, agent-deliverable slice of the verified-open
backlog — public-trust correctness, money-path honesty, founder-hit error surfaces, CI/deploy
integrity, small security hardening, and the booked dependabot campaign — and leave TODOS.md
telling the truth.

**Scope:** 50 requirements — RANK-01..09, SHARE-01..04, WIZERR-01..13, HONEST-01..06,
OPS-01..11, SEC-01..06, DEPS-01 — per `.planning/REQUIREMENTS.md`. Every one is a verified-open
TODOS.md item re-measured at HEAD `ca3f0c5c` (17-agent triage, 2026-08-20). Research: TARGETED
(`.planning/research/SUMMARY.md`) — and in three places TODOS.md's own recorded remedy is
measured WRONG (#686 "bisect", #606's booked claims, the concurrency "shrink the group"); the
phases below carry the corrections, not the bullets.

**Ordering rationale (BINDING — measured dependencies, not preferences):**

- **Phase 158 (OPS — CI/deploy integrity) FIRST.** The `shared-test-db` concurrency eviction
  makes a main-branch run conclude `cancelled` (grey — nobody triages grey) and Railway then
  silently SKIPS the analytics deploy (issue #616). Every later phase merges PRs through this
  pipeline, and the 9-PR DEPS campaign against the unfixed group *guarantees* at least one
  silently-skipped deploy. ⚠️ Research correction is binding: shrinking the group does NOT fix
  this (eviction is cross-run) — the fix is an external FIFO mutex for DB-touching jobs plus a
  `cancelled`-conclusion watcher.

- **Phase 159 (RANK) EARLY** — pure read-path, zero DDL, trivially revertible, observable on
  PROD; it must precede new publications so the percentile population delta is measured against
  a stable cohort, and it front-loads the cheapest owed census (C-M1).

- **RANK → provenance → SHARE arc:** Phase 160's write-path REVOKE needs a full
  deploy-first / revoke-second cycle with soak time, so it cannot be late; Phase 164 (SHARE) is
  the ONLY new anonymous public surface and lands alone, late, in its own PR — ⛔ never branched
  from `feat/phase-156-connect-refactor` (its Migration B is pending against `strategies`; two
  concurrent migrations on one table on an auto-apply-to-PROD path is an ordering surprise
  waiting to happen).

- **Phase 163 (hardening) before Phase 164:** SEC-03's RPC audit-coverage decision must be
  standing when SHARE mints its new mint/revoke RPCs — two REQ groups, one edit
  (`MUTATING_RPC_NAMES`).

- **Phase 165 (DEPS) LAST, strictly after OPS-01.** Dependency churn before the correctness
  work makes every red ambiguous, and #685 is 100% `analytics-service/` — exactly the PR that
  would sit undeployed behind a grey main.

- **Owed measurements and decisions are EARLY TASKS inside their phases, never separate
  phases:** C-M1 + the percentile before/after snapshot in 159; B-M1 + B-D1/B-D2 in 160; A-D1
  (URL shape), A-D2 (private-status revoke home), A-D3 (tearsheet/PDF scope) + the token model
  in 164.

### Phases (v1.20)

- [x] **Phase 158: OPS-CI — A merge means a deploy** - External FIFO mutex + `cancelled`-conclusion watcher close the shared-test-db eviction (#616); `sql-tests` gated by an aggregator; orphaned e2e specs run; TEST stale-`pending` drained; MultiKeyConnectStep flake root-caused (completed 2026-08-21)
- [ ] **Phase 159: RANK — Public-ranking integrity** - Failed/stale-computation KPIs out of published percentiles on BOTH engines; anon `(*)` splats become explicit projections; quantstats sign-flip + blend-annualization default closed; FILL-arm CAS; uid shape validated
- [ ] **Phase 160: PROVENANCE — The server's venue is the venue that annualizes** - `api_keys.exchange` server-authoritative at every INSERT; the `asset_class` √365/√252 stamp derives from the attested venue WITH the null-attestation guard; B-M1 PROD census first
- [ ] **Phase 161: WIZERR — Honest error surfaces** - The recorded WIZFORM-02 class residue: thirteen surfaces stop rendering `UNKNOWN`, false sentences, or unwinnable "try again"
- [ ] **Phase 162: HONEST — What the user sees is true** - No raw Python exceptions as copy, no FRESH badge on a dead series, real equity curves, metrics on drawer rows, the clicked key preselected
- [x] **Phase 163: HARDEN — Fail safe, closed, and loud** - structlog redaction closed at BOTH failure modes, post-commit `createAdminClient` 500 class, flag-monitor honesty, deterministic worker plumbing, password policy, `.planning` username scrub, RPC audit gate, `bridgeComputeLimiter`
- [ ] **Phase 164: SHARE — Copy Link always works, and never discloses** - Revocable share-token lane on the factsheet; the id-keyed public cache is NEVER poisoned (ordered adversarial acceptance); revoke; the affordance class honest at all three sites
- [ ] **Phase 165: DEPS — The 9-PR dependabot campaign** - pandas `requirements.in` prerequisite commit FIRST, then one PR at a time in the research-verified order, full suite between each; #614 and #606 CLOSED with reasons

### Phase 158: OPS-CI — A merge means a deploy

**Goal**: A merged PR always produces an honestly-reported CI verdict and a deployed analytics service — main CI can no longer conclude `cancelled` and silently skip the Railway deploy, no gate is present-but-ungating, and the two known deterministic false-reds are gone
**Depends on**: Nothing (first phase of v1.20; hard prerequisite of Phase 165)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-11
**Success Criteria** (what must be TRUE):

  1. A PR opened mid-run can no longer evict a queued main-branch run: three SIMULTANEOUS DB-touching runs serialize through an external FIFO mutex (with a TTL/steal path and a documented manual-unlock runbook — a requirement of adoption, not a follow-up), and a forced `cancelled` main-run conclusion raises a loud signal (issue or rerun) instead of a silently-skipped Railway deploy — GitHub issue #616 closed on the MECHANISM, not on symptom convergence. ⚠️ Shrinking the concurrency group is NOT an acceptable fix (eviction is cross-run); ⚠️ do NOT "finish the chain" with more `needs:` edges (the `if:` conditions diverge on `workflow_dispatch` and it would disable `e2e-seeded` on every manual run).
  2. A failing `sql-tests` job blocks an aggregator via `needs:` — the only gate that executes the deployed cron bodies can no longer be present-and-failing with nothing gating on it.
  3. The orphaned e2e specs (incl. the NAV-01 surface) execute in a CI batch, and DB-types drift has a regeneration gate OR an explicitly recorded decision not to.
  4. The TEST stale-`pending` `compute_jobs` backlog is drained TEST-only (⛔ never a migration, never `cron.unschedule(9)`) so the deterministic exactly-10 claim-path red is gone, and `test_compute_jobs_fencing.py` stamps `claimed_at` in its two direct UPDATEs.
  5. `MultiKeyConnectStep` passes under any test ordering — the unrestored `vi.stubGlobal`/`vi.mock` root cause is fixed, not retried away.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 158-01-PLAN.md — Tracer mutex probe (session-mode go/no-go, 3-contender RED→GREEN) + ci.yml advisory-lock adoption + `sql-tests` aggregator gating (OPS-01, OPS-02) [Wave 1]
- [x] 158-02-PLAN.md — `cancelled`-conclusion watcher (issue-only, exit-0 doctrine) + shared-test-db mutex runbook (OPS-01) [Wave 1]
- [x] 158-03-PLAN.md — `claimed_at` stamps in the two fencing UPDATEs + guarded TEST-only backlog drain closed on measured row counts (OPS-04) [Wave 1]
- [x] 158-04-PLAN.md — MultiKeyConnectStep flake: reproduce-first sweep, then leak-source fix or mechanism closure with evidence (OPS-11) [Wave 1]
- [x] 158-05-PLAN.md — Repair the 4 named orphan specs + author e2e/my-strategies.spec.ts (NAV-01 surface) (OPS-03) [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 158-06-PLAN.md — Batch-list wiring + 15-orphan triage into TODOS + DB-types recorded decision (OPS-03) [Wave 2]

**Research note:** mechanism understood — skip a research phase; the repo already carries the dedup'd-issue pattern to copy (`analytics-deploy-verify.yml`). Verification must simulate THREE concurrent runs, not two.

### Phase 159: RANK — Public-ranking integrity

**Goal**: Published percentile ranks and anonymous public reads reflect only computed, honestly-annualized analytics — and a resubmit race cannot corrupt a session's classification
**Depends on**: Phase 158 (attributable CI reds; a stable cohort measured before anything else moves)
**Requirements**: RANK-01, RANK-02, RANK-05, RANK-06, RANK-07, RANK-08, RANK-09
**Success Criteria** (what must be TRUE):

  1. A strategy with a failed/stale computation neither contributes to nor receives a published percentile rank — gated on `isComputedAnalytics` SEMANTICS (⚠️ a literal `complete` filter wrongly drops `complete_with_warnings`, a terminal SUCCESS), implemented as a separate `PERCENTILE_GATE_COLUMN` at the projection site with `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged (the csv-finalize mirror prose depends on it), ONE shared filter helper for both TS callers, and the `get_verified_cohort_rank` SQL RPC moved in lockstep or its exclusion explicitly recorded (its prose claims parity-by-construction).
  2. The C-M1 PROD census (per-category published-with-analytics counts before/after the filter, against the <5 badge floor and the RPC's min-N 20) plus a per-strategy percentile before/after snapshot exist as phase artifacts BEFORE the filter lands — a rank that disappears is the HONEST outcome, but it must be a decided one (C-D1), surfaced in UAT, never a surprise; no test may assert "ranks improve" (direction is not uniform).
  3. Anonymous readers receive explicit column projections at both `strategy_analytics (*)` splat sites (`queries.ts:218`, `compare/page.tsx:68`) — `daily_returns`/`metrics_json`/`data_quality_flags` are absent from anon responses.
  4. The two money-math defects are closed on the strategy-analytics path: an all-non-negative return series with a >100% day is never re-read as prices (no sign-flipped Sharpe), and a blend leg with unknown `asset_class` is treated as crypto for RISK (a sole crypto leg no longer inflates Sharpe via √252).
  5. Two concurrent same-session resubmits cannot both take the FILL arm (compare-and-set on `category_id IS NULL`); the classification-conflict 409's own remedy can mint a fresh session (the re-mint fingerprint accounts for classification, or the exclusion is documented at the fingerprint); and `withPublishedOrOwner` validates the uid's shape before interpolating it into the PostgREST `.or()` filter.

**Plans**: 7 plans

Plans:
**Wave 1**

- [ ] 159-01-PLAN.md — C-M1 PROD census artifact `159-CENSUS.md` (checkpoint: ORCHESTRATOR runs the read-only SQL against PROD and commits results — the D-01 gate) (RANK-01) [Wave 1]
- [ ] 159-05-PLAN.md — quantstats price-guess closed across `compute_all_metrics`: kwarg arm + P114 inline mirror for headline sharpe/sortino, benign-parity oracles, golden adjudication (RANK-05) [Wave 1]
- [ ] 159-06-PLAN.md — FILL-arm CAS `.is("category_id", null)` + observed row count + honest `raced` refusal on the real POST harness (RANK-07) [Wave 1]
- [ ] 159-07-PLAN.md — Re-mint fingerprint includes classification (both call sites + both dep arrays) + `withPublishedOrOwner` strict-UUID fail-closed validation (RANK-08, RANK-09) [Wave 1]

**Wave 2** *(blocked on the 159-01 census — D-01 hard ordering)*

- [ ] 159-02-PLAN.md — Percentile gate: `PERCENTILE_GATE_COLUMN` + one shared helper for BOTH TS callers, `get_verified_cohort_rank` lockstep re-base migration, first CI SQL gate for the RPC (RANK-01) [Wave 2]

**Wave 3** *(blocked on 159-02 — file overlap on queries.ts / closed-sets.ts)*

- [ ] 159-03-PLAN.md — Splat-class closure: three explicit projections + owner exemption comment + repo-wide class inventory (RANK-02) [Wave 3]
- [ ] 159-04-PLAN.md — `blendPeriodsPerYear` unknown-leg-as-crypto for RISK + production call-site wiring pin (RANK-06) [Wave 3]

**Research note:** fix locations and predicates read directly from source — skip a research phase; only the cheap C-M1 census remains. `StrategyTable`'s ungated KPI cells are OUT of scope, logged (C-D2).

### Phase 160: PROVENANCE — The server's venue is the venue that annualizes

**Goal**: No client-supplied venue can differ from the venue the server validated, and the √365/√252 annualization stamp derives from the server's attestation — without ever stamping √252 onto a crypto strategy through a NULL attestation
**Depends on**: Phase 159 (the RANK → provenance → SHARE arc; deliberately NOT late — the REVOKE needs deploy-then-soak time before Phase 164)
**Requirements**: RANK-03, RANK-04
**Success Criteria** (what must be TRUE):

  1. The B-M1 PROD census (un-attested `api_keys` rows since 2026-08-11, split by exchange, strategy linkage, and `wizard_session_id` carriage) is measured and committed as an EARLY phase artifact — it gates the stamp swap and decides B-D1 scope (all of B-1..B-4, or B-4-alone-with-null-guard as the minimal correct cut). Copy the count-pinned, abort-on-drift census discipline from `20260811210000`.
  2. Every INSERT path into `api_keys` writes the server-validated exchange — the Phase-156 service-role-writer pattern extended (`validate-and-encrypt`, which already knows the canonical venue, writes the row and returns `{ api_key_id }`; the client components stop inserting; then REVOKE INSERT) — with deploy-first / revoke-second discipline, ⚠️ never migration-first, and every `.from("api_keys")` mutation grepped before the REVOKE (DELETE is also a live client path).
  3. The `asset_class` stamp at `finalize-wizard` derives from the attested venue, and the swap MOVES WITH the null-attestation extension of the `skipAssetClassWrite` guard — a NULL attestation SKIPS; it never stamps `traditional`/√252 onto a crypto strategy (⚠️ TODOS.md's "one-identifier change" framing is measured WRONG; `isCryptoExchange(null) === false` is the trap).
  4. The B-D2 oracle pins the ECONOMICS (a null attestation annualizes on nothing — it skips), never the implementation's own expression; if the census finds affected strategies, their re-annualization gets golden-parity treatment.

**Plans**: 7 plans (6 executed + 1 gap closure)

Plans:
**Wave 1**

- [ ] 160-01-PLAN.md — B-M1 PROD census artifact `160-CENSUS.md` (checkpoint: ORCHESTRATOR runs the read-only SQL against PROD, fills the mechanical B-D1 decision, commits) (RANK-03, RANK-04) [Wave 1]

**Wave 2** *(blocked on the 160-01 census — it gates everything downstream)*

- [ ] 160-02-PLAN.md — TRACER: `validate-and-encrypt` persist arm (admin INSERT stamps exchange + attested_venue from `exchangeNormalized`, returns `{ api_key_id }`, strict `persist: true` skew discriminator) + ApiKeyManager conversion end-to-end (RANK-03) [Wave 2]
- [ ] 160-04-PLAN.md — RANK-04 stamp swap + `skipAssetClassWrite` null-attestation extension in ONE change + B-D2 economics oracles observed RED under neuters; create-with-key confirmed unchanged (RANK-04) [Wave 2]

**Wave 3** *(blocked on 160-02 — the persist contract)*

- [ ] 160-03-PLAN.md — StrategyForm + AllocatorExchangeManager conversions (the THIRD insert site) + state-adaptive SQL gate `test_api_keys_insert_not_client_writable.sql` (A1 retention positive armable now) (RANK-03) [Wave 3]

**Wave 4** *(PR-2 — the second landing; blocked on PR-1 merged + deployed + soaked)*

- [ ] 160-05-PLAN.md — Soak checkpoint (prod smoke of wizard + all three converted surfaces, census re-measure addendum) → blocking-human go/no-go → census-guarded `REVOKE INSERT` migration + whole-repo write-surface re-grep + legacy ciphertext arm retired (RANK-03) [Wave 4]

**Wave 5**

- [ ] 160-06-PLAN.md — Golden-parity re-annualization for census-identified strategies (`160-PARITY.md`; RISK ×≈1.203 / RETURN unmoved adjudication) or the recorded no-op (RANK-04) [Wave 5]

**Wave 6** *(gap closure, 2026-08-23 — from 160-VERIFICATION.md; the STALE_CLIENT retirement itself already landed at `2fe28b89`)*

- [ ] 160-07-PLAN.md — Gap closure: independent gsd-verifier re-adjudication of the retired-legacy-arm must_have at HEAD + human PROD smoke of the persist arm (the writer's first real exercise) + honest record and TODOS hygiene (RANK-03) [Wave 6]

**Research note:** ARCHITECTURE confidence is LOW without B-M1 — the census is this phase's first task, not a nicety.

### Phase 161: WIZERR — Honest error surfaces

**Goal**: Every founder-hit wizard, key, and CSV error surface names the actual blocker in truthful copy — no `code: UNKNOWN`, no false sentence, no "try again" that can never succeed
**Depends on**: Phase 158 (attributable CI; the curated-message test fence is exercised heavily here)
**Requirements**: WIZERR-01, WIZERR-02, WIZERR-03, WIZERR-04, WIZERR-05, WIZERR-06, WIZERR-07, WIZERR-08, WIZERR-09, WIZERR-10, WIZERR-11, WIZERR-12, WIZERR-13
**Success Criteria** (what must be TRUE):

  1. The MT5 "gateway misconfigured" copy names the actual blocker derived from the `terminal_info` flags the probe already holds (`tradeapi_disabled` vs `trade_allowed`), fixed as a CLASS across all six carrier sites, within the curated-message test fence.
  2. Key-lane remedies are safe and truthful: "Try another key" never destroys the draft or cascades away composite members; an orphaned live key surfaces an honest remedy instead of a false `DRAFT_ALREADY_EXISTS` 409; the `KEY_INVALID_FORMAT` one-code-many-causes split lands on the remaining 2 routes / 9 sites honoring their internal-vs-public copy contracts; wizard `AUTH_FAILED` copy names the venue the user actually selected — never Deribit while Binance is selected.
  3. The coverage law reaches every surface the class regrew on: the `keys/[id]/permissions` private `PROBE_*` cascade gets a derived-population coverage law (and `KEY_UNDECRYPTABLE`'s remedy says "reconnect the key", not "try again"); `AllocateDialog`, `RenameStrategyDialog`, and `MarkOwnershipDialog` stop minting `code: UNKNOWN`; the five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward recognized `seamCode`s; `MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` threads end-to-end through both key-route catches.
  4. CSV verdicts tell the truth: the 7-row floor is evaluated on the wizard composite arm AND `INSUFFICIENT_CSV_HISTORY` renders its own copy (landed together or not at all); examined-but-refused verdicts render a truthful fourth outcome replacing the false "only 0 trade(s)" sentence (D-15's oracle re-cut deliberately, the TOCTOU re-check wording following); the csv-finalize A2 409 sentence describes the actual case (same track record, different flow); and the per-row CSV breakdown renders its data half without leaking `'nan'` or echoing untrusted cell contents.

**Plans**: 10/10 plans executed
**UI hint**: yes

Plans:

- [x] 161-01-PLAN.md — WIZERR-04: KEY_UNDECRYPTABLE honest remedy + derived-population PROBE_* coverage law (wave 1, tracer)
- [x] 161-02-PLAN.md — WIZERR-01: MT5 flag→cause builder across both raise sites, inside the curated fence (wave 1)
- [x] 161-03-PLAN.md — WIZERR-12/-13: csv-finalize A2 sentence + per-row breakdown nan-guard and no cell echo (wave 1)
- [x] 161-04-PLAN.md — WIZERR-02: "Try another key" becomes a pure, non-destructive step transition (wave 1)
- [x] 161-05-PLAN.md — WIZERR-03/-11: KEY_ORPHANED honest refusal + venue-parameterized AUTH copy (wave 2)
- [x] 161-06-PLAN.md — WIZERR-05: Retry-After threads end-to-end + parity law over the five local error doubles (wave 3)
- [x] 161-07-PLAN.md — WIZERR-09/-10: 7-row composite floor with its copy (atomic) + truthful fourth CSV verdict (wave 3)
- [x] 161-08-PLAN.md — WIZERR-06: five 5xx terminal arms forward the recognized code + shape law (wave 4)
- [x] 161-09-PLAN.md — WIZERR-08: KEY_INVALID_FORMAT split on 2 routes / 9 sites + 4th ROUTES row (wave 5)
- [x] 161-10-PLAN.md — WIZERR-07: three dashboard dialogs stop minting UNKNOWN + first dashboard coverage law (wave 4)

### Phase 161.1: LEDGER-REFRESH — Recurring strategy refresh for ledger-backed venues, shipped dormant behind a founder-gated schedule (INSERTED)

**Goal**: Every ledger-backed venue (mt5/sfox/deribit) has a recurring path that refreshes
`strategy_analytics` after onboarding — shipped DORMANT, with activation a founder-gated live op.
**Depends on:** nothing. Independent of Phase 161 (that phase is error copy; this is data flow).
Inserted after 161 for roadmap ordering only — it MAY be pulled ahead, and it is the more urgent
of the two because it is a live, founder-reported data-integrity defect.
**Requirements**: LEDGER-01, LEDGER-02, LEDGER-03, LEDGER-04
**Plans:** 5/5 plans executed

**Root cause (measured on PROD 2026-08-24; ⚠️ CORRECTED 2026-08-25 by re-measurement at HEAD
`57a407ea` — two claims below were false as originally written):**

No recurring enqueuer reaches `strategy_analytics` for a ledger-backed venue. Both daily strategy
crons gate on ccxt-only closed sets excluding mt5 (`reconcile-strategies` 03:30 →
`RECONCILABLE_EXCHANGES`; `sync-funding` 04:00). Measured: 4 MT5 strategies with
`strategy_analytics` between 2026-08-04 and 2026-08-21, versus okx at 2h old.

⚠️ **CORRECTION 1 — the three ledger venues are ASYMMETRIC, not uniform.** The original text said
`cron_sync` "defers anything outside `EXCHANGE_CLASSES`", implying all three are deferred.
`deribit` IS in `EXCHANGE_CLASSES` (`analytics-service/services/exchange.py:812`). Only **mt5** and
**sfox** hit the `routers/cron.py:182` deferral. Deribit takes the ccxt branch and is then filtered
by `stored > 0` (`routers/cron.py:471-472`) — a fill-count predicate that is structurally wrong for
a settlement-ledger venue. **A fix scoped as "venues absent from `EXCHANGE_CLASSES`" silently drops
deribit.** Scope the cohort off `_LEDGER_BACKED_SOURCES` (`long_fetch.py:63`), not off absence.

⚠️ **CORRECTION 2 — `process_key_long` is the wrong recurring unit, and re-enqueuing it is a
provable no-op.** The original text said it is "enqueued in exactly one place — strategy creation
(`api/strategies/finalize-wizard`)". At HEAD it is enqueued at two Python sites
(`routers/process_key.py:1517`, `:765`), not from that route. More importantly
`long_fetch.py:154` returns `DONE` on `status == "published"` and `:193` returns `DONE` on the whole
`advanced_statuses` set — every onboarded strategy is `published`. A recurring enqueue against the
existing `verification_id` therefore yields a GREEN job, a new `compute_jobs` row, and
`strategy_analytics` UNTOUCHED. The recurring unit must be the chain **tail** —
`derive_broker_dailies` strategy-mode, which is `JOB_CHAIN_FOLLOW_ON["process_key_long"][0]` — or a
newly minted verification row, the way the user-triggered resync does it.

⛔ **A7 — LOAD-BEARING UNKNOWN.** The recurring mt5 `derive_broker_dailies` → `strategy_analytics`
path **has never actually run end-to-end**. The plan's FIRST verification must be one manual enqueue
for one MT5 strategy, observed to completion, BEFORE anything is scheduled. Do not schedule an
unproven path.

⛔ **No TS mirror of the venue set.** `_LEDGER_BACKED_SOURCES` (`long_fetch.py:63`) is the sole
authority. A hand-copied mirror previously drifted (TS at 1 venue, Python at 3) and cost a funded
MT5 account its publish path. This rules out a Vercel-cron / TS-route implementation unless a drift
gate is explicitly accepted. **This fence is the authority for the rule.**

⚠️ **Corrected 2026-08-25 — do not restore the earlier justification.** This entry previously said
`src/lib/strategyGate.invariant.test.ts` "BANS venue literals in TS". Measured: `:64` scopes
`BANNED_VENUE_LITERALS` to `GATE_PATH = src/lib/strategyGate.ts` **only** — a venue set added to
`src/lib/closed-sets.ts` would NOT trip it. The rule stands on this fence and the measured drift
incident, NOT on a repo-wide mechanical gate that does not exist. Never cite that test as the
enforcement mechanism: a stated reason that is falsifiable-and-false teaches the next reader a rule
they will correctly discover is untrue, and then discard along with the real constraint.

**Success Criteria** (what must be TRUE):

  1. A recurring enqueuer exists that reaches `strategy_analytics` for every ledger-backed venue,
     via the strategy-keyed `process_key_long` chain — never the ccxt fill path.

  2. It ships DORMANT: the schedule is NOT registered, activation is a documented founder-executed
     live op, matching the SFOX_ENABLED / WORKER-03 pattern. Merging changes no prod behavior.

  3. The staleness is observable before it is user-visible: a check that fails on a timestamp
     that advances ONLY when new analytics data actually lands — never on `last_sync_at` (advanced
     daily by key-scoped jobs; this is what hid the bug), and never on `strategy_analytics.computed_at`.

     ⚠️ **This criterion's original wording named `computed_at` and was WRONG — corrected 2026-08-25
     by measurement at HEAD.** The SQL status bridge re-stamps `computed_at = now()` on EVERY job
     transition (`20260802120000_strategy_analytics_stuck_computing_reaper.sql:342,398,421`), so it
     reproduces the `last_sync_at` lie one column over. That migration says so itself at `:82` and
     `:230`, and RAISES at `:678` if the reaper body so much as references `computed_at` — it names
     this "the Phase 106 janitor bug". This same ROADMAP already warns against the identical mistake
     at line ~1811 ("never the 106-janitor-revert `updated_at`/`computed_at` mistake").

     The planner MUST pick the column, and MUST prove the choice by writing a test that advances the
     rejected timestamps WITHOUT new data and shows the check still fails. Recommended starting
     candidate: the latest date present in `strategy_analytics_series` (a status transition cannot
     move it). `computing_started_at` is NOT the answer either — it is the stuck-row reap anchor,
     not a freshness signal.

  4. A regression pin fails if any ledger venue is dropped from the refresh set — proven
     falsifiable by neutering and observing RED.

**⛔ SCOPE FENCES — two approaches already investigated and REJECTED. Do not re-enter:**

  - **Do NOT add mt5 to `RECONCILABLE_EXCHANGES`.** `run_reconcile_strategy_job` calls
    `fetch_raw_trades` (ccxt). mt5 is in `_LEDGER_BACKED_SOURCES`; this is the BYB-02 corruption
    class that "crashed EVERY onboard in prod" when sfox fell into it.

  - **Do NOT re-register the `derive-allocator-key-dailies` cron.** It is key-mode and never
    stamps `strategy_analytics`; it was DELIBERATELY unscheduled at the v1.11 recovery; and
    `docs/runbooks/flipretry-derived-equity-go-live.md:171` forbids scheduling it from a migration
    (auto-apply + a silently-skipped worker deploy recreates the v1.11 wedge verbatim). A migration
    doing exactly this was written and deleted unmerged on 2026-08-24.

**⚠️ Risk shape:** fanning jobs at a fixed hour carries the v1.11 worker-wedge shape — MT5
serializes on ONE shared terminal (`services/mt5_concurrency.py`) at a 15-min timeout per key.

Plans:

- [x] 161.1-01-PLAN.md — LEDGER-03 tracer: staleness view keyed on the returns-series date (not `computed_at`, not `last_sync_at`) + the A7 PROD tracer + the D-COMP founder decision (wave 1)
- [x] 161.1-02-PLAN.md — LEDGER-01/-02/-04: the dormant, staleness-gated, bounded single-key fan-out on the chain tail + matched-pair SQL gate + venue-drift/no-schedule static gates (wave 2)
- [x] 161.1-03-PLAN.md — LEDGER-02: the founder go-live runbook (two ordered LIVE ops, two rollback levels incl. detect/repair/verify remediation for rows a failed tick downgraded) + TODOS filings (wave 3)
- [x] 161.1-05-PLAN.md — LEDGER-02/-04: the static drift / dormancy / bound gates, sliced out of plan 02 (wave 3)
- [ ] 161.1-04-PLAN.md — LEDGER-01: the composite arm on `stitch_composite` so deribit has real coverage — CONDITIONAL on D-01 (wave 4)

### Phase 162: HONEST — What the user sees is true

**Goal**: Every number, badge, and affordance a user sees reflects the data underneath it — no raw exceptions as copy, no freshness claim a dead series contradicts, no missing metric where data exists
**Depends on**: Phase 158 (attributable CI)
**Requirements**: HONEST-01, HONEST-02, HONEST-03, HONEST-04, HONEST-05, HONEST-06
**Success Criteria** (what must be TRUE):

  1. A computation failure renders mapped user copy, never a raw Python exception string — mapped at the WRITER, with the underlying str/None compare root-caused.
  2. Freshness claims are true: a strategy whose return series ended 89 days ago cannot read FRESH (⚠️ investigated FIRST — flat account vs derive gap — before any fix is chosen), and example strategies advertise no stale "Synced Nd ago" badges on discovery.
  3. `buildEquityCurveSeries` serves real per-strategy equity curves now that `returns_series` is selected (the hard-coded `equityCurve: null` and its false comment are gone), and drawer-added strategies render CAGR/Sharpe like book rows.
  4. "Finish setup →" opens the wizard with the clicked key preselected.

**Plans**: 9/9 plans executed (2 waves)

> ⚠️ **162-08 Task 1 was SUPERSEDED, not completed as written.** It planned a recompute of the
> 15 example rows. Measured 2026-08-26: `csv_daily_returns` held **0 rows for all 15** while the
> handler needs ≥2, so the recompute arm was structurally impossible — an enqueue would have
> fired the fence 15 times. The executor correctly halted (its PROD credential lane was also
> blocked by the harness) and touched nothing. Founder ruled: unpublish AND delete. Executed and
> verified on PROD the same day — 15 strategies deleted, 0 examples remain; cascades took 1470
> match_candidates, 29 portfolio memberships, 5 favourites and 3 contact_requests; 28
> allocation_events and 3 match_decisions were cleared first as FK blockers. Full backup retained
> outside the repo. HONEST-03 therefore closes on measurement rather than on recompute.

Plans:

- [x] 162-01-PLAN.md — Diagnostics census: HONEST-02 flat-vs-derive-gap verdict + HONEST-01 str/None root cause, read-only vs PROD (wave 1)
- [x] 162-02-PLAN.md — HONEST-01 curated copy at every writer (classify_exception arms, 18-site stamp choke point, portfolio _fail) + wizard Details-appendix removal, D-162-4 strict (wave 1)
- [x] 162-03-PLAN.md — HONEST-04 gated real equity curves + C-3 coverage caption + HONEST-03 is_example SyncBadge class guard (wave 1)
- [x] 162-04-PLAN.md — HONEST-05 widened /returns co-serves gated cagr/sharpe + addedMetricsById composer fallback, C-4 five-state contract (wave 1)
- [x] 162-05-PLAN.md — HONEST-06 server use-existing-key path (D-162-3): decision gate + tracer RPC/route arm + state-adaptive SQL gate — service-role boundary (wave 1, checkpoint)
- [x] 162-06-PLAN.md — HONEST-06 client preselect thread + C-5 saved-key summary, all three key populations pinned (wave 2)
- [x] 162-07-PLAN.md — HONEST-02 verdict fix: D-162-2 "Track record through {date}" recency line (flat arm) or recorded pipeline routing (gap arm) (wave 2)
- [x] 162-08-PLAN.md — HONEST-03 D-162-1 recompute of the 15 example rows (unpublish fallback, never synthesize) + HONEST-01 follow-throughs + TODOS filings (wave 2)
- [x] 162-09-PLAN.md — KeyPermissionBadge: scope chips/caption gated on probe_error — a failed probe can no longer render scope facts (PROD QA finding 2026-08-25, phase-goal class) (wave 1)

**UI hint**: yes

### Phase 163: HARDEN — Fail safe, closed, and loud

**Goal**: The backend fails safe, closed, and loud — secrets cannot reach logs, monitors cannot report false health, committed work cannot 500, and every mutating or compute-heavy surface is limited and audited
**Depends on**: Phase 158 (attributable CI). ⛔ Must complete before Phase 164 — SEC-03's audit-gate decision polices SHARE's new mint/revoke RPCs (two REQ groups, one edit)
**Requirements**: OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, HONEST-08
**Success Criteria** (what must be TRUE):

  1. The structlog frozen-proxy class is closed at BOTH failure modes — a source-scan gate for module-scope `.bind()` (Mode A) AND a behavioral redaction test for first-use-before-`configure_logging()` (Mode B) — each demonstrated RED when neutered. ⚠️ Fixing one and closing the audit is false closure; the leak class is ccxt HMAC signatures and MT5 passwords.
  2. Failure paths are honest: `createAdminClient()` cannot throw on the request path after an irreversible commit (the class closed at all three known sites); `checkStuckNotifications` distinguishes "nothing stuck" from "could not tell"; a failed denominator read PAGES instead of logging success; and the integration test actually falsifies both.
  3. Worker/request plumbing is deterministic and bounded: the 10-param `_enqueue_compute_job_internal` drops `INTO STRICT` on its lost-race branches (parity with the de-STRICT-ed 7-param overload); the resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window); the retry loop cancels abandoned response bodies (`body.cancel()`).
  4. The security floor is measured, not assumed: the server-side password policy backing client `minLength={6}` is verified, enforced, and documented; the tracked `.planning/` docs pass a NO-ALLOWLIST scan (MEASURED 2026-08-26: **80** files carry the username, 57 carry `\/Users\/` paths — the "~50" estimate was low) for the macOS username / local absolute paths (the gitleaks allowlist is path-based and blind here); the tenth IP-keyed route (`simulator.py`) is repaired along with the concealing wrapper-check test (equality assertion, quarantine shrinks to 0); and removing a panel mid-validate aborts the in-flight credential-carrying POST.
  5. Coverage gates close their gaps: `add_wizard_composite_key` is policed by the audit-coverage gate with the pragma-vs-real-emission decision RECORDED, and the bridge + portfolio-optimizer flows get a named `bridgeComputeLimiter` sized to backend reality (closing the 30× front/back mismatch) ⛔ without resizing the shared `userActionLimiter`.
  6. A freshness claim is not surface-local: the public discovery table's "Synced Nd ago" badge buckets on the **staler** of sync- and series-recency, exactly as `FreshnessChip` already does on the factsheet (HONEST-08). ⚠️ MEASURED ON PROD 2026-08-26 — `Phoenix Protocol` advertises "Synced 7h ago" on `/browse/crypto-sma` over a series that ended 2026-05-06, **112 days** earlier, while its own factsheet reads `Track record · old`. The rule HONEST-02 wrote ("a series dead 89 days cannot read FRESH") is violated on the most public surface in the product. ⛔ Do NOT close by deleting the badge, and ⛔ do NOT rely on the `is_example` gate — HONEST-03 scoped that to example rows and all 15 were deleted, so it now guards nothing here. The test must use a REAL published row with a stale series and be demonstrated RED when the staler-of-two logic is neutered.

**Plans**: 9/9 plans executed (2 waves)

Plans:

- [x] 163-01-PLAN.md — OPS-05 structlog frozen-proxy closed at BOTH modes; Mode B is LIVE on the worker (`main_worker.py` never configures) — planned first as the phase's highest-risk item (wave 1)
- [x] 163-02-PLAN.md — SEC-04 `bridgeComputeLimiter` sized from a MEASURED PROD backend number (measurement is an explicit early task); ⛔ `userActionLimiter` untouched; roster pin moves in the same commit (wave 1)
- [x] 163-03-PLAN.md — SEC-02 username/absolute-path scrub across the measured **94** tracked files (87 `.planning/` + 5 docs/ + 2 applied-migration comment headers, exception recorded — 87 is the `.planning/`-only figure, not the total) + NEW no-allowlist scanner wired into `npm run lint` (wave 1)
- [x] 163-04-PLAN.md — HONEST-08 discovery "Synced Nd ago" badge buckets on the staler of sync- and series-recency via ONE shared resolver mirroring FreshnessChip; regression test on a real published fixture row, RED under neutering (wave 1)
- [x] 163-05-PLAN.md — OPS-06 createAdminClient hoisted above the commit at the measured FOUR occurrences in three files + OPS-07 monitor honesty (discriminated union; denominator failure PAGES non-200; integration falsifiers) (wave 1)
- [x] 163-06-PLAN.md — OPS-08 forward-only migration de-stricting the 10-param enqueue overload's four lost-race branches + pg_get_functiondef SQL gate (expected RED until TEST hand-apply); blocking three-reviewer checkpoint before apply (wave 1)
- [x] 163-07-PLAN.md — OPS-09 deterministic resync draft pre-check (ordered + bounded, prose debts settled) + SEC-05 simulator tenant-keyed with the concealing quarantine/carve-out removed (equality at 0, class size 10) (wave 1)
- [x] 163-08-PLAN.md — OPS-10 capability-checked `body.cancel()` on the single abandoning retry arm + SEC-06 panel removal aborts the in-flight credential POST by identity, reason "user" (wave 1)
- [x] 163-09-PLAN.md — SEC-01 hosted password policy READ, unified `MIN_PASSWORD_LENGTH`, documented + SEC-03 `add_wizard_composite_key` under the audit law with the pragma decision RECORDED (wave 2, serialized on REQUIREMENTS.md after 163-03)

### Phase 164: SHARE — Copy Link always works, and never discloses

**Goal**: "Copy Link" on a strategy its owner can view yields a URL its recipient can view — a revocable per-strategy share token — and the token lane can never disclose an unpublished strategy through the id-keyed public cache
**Depends on**: Phase 160 (provenance REVOKE soaked), Phase 163 (RPC audit gate standing). ⛔ Its own phase, its own PR, shares a PR with NOTHING; ⛔ never branched from `feat/phase-156-connect-refactor`
**Requirements**: SHARE-01, SHARE-02, SHARE-03, SHARE-04
**Success Criteria** (what must be TRUE):

  1. The owed decisions are argued and RECORDED as early tasks before implementation: A-D1 URL shape (`?s=<token>` on the id route vs `/factsheet-share/[token]` — the two research files disagree DELIBERATELY; surface to the founder, never defaulted by a planner), the token model (raw-at-rest vs HMAC + stored generation counter — the deviation from `scenario-share-token.ts`'s hash-only discipline argued, and model B's new required Vercel env var named as a prod-only failure mode), A-D2 (where revoke lives for `status='private'`, whose `StrategyActions` falls through to `return null` — ⛔ no publish flow grows inside this phase), and A-D3 (tearsheet/PDF routes in or out, decided explicitly).
  2. Copy Link on an unpublished strategy yields a URL an anonymous recipient can view, mint-or-REUSE across sessions (⚠️ a verbatim `/scenario-share` port cannot deliver reuse — it stores only the hash and unconditionally revokes on mint, regenerating the original bug in slow motion); the bare `/factsheet/<id>` URL stays owner-only and the id stays a non-secret.
  3. ORDERED adversarial cache isolation: after a token-lane render of an unpublished strategy, an anonymous request for `/factsheet/<id>` STILL 404s — the token lane calls the payload builder directly with ZERO reads and ZERO writes at the id key (⛔ never a token in `cacheKey`/`keyParts`, never a token-aware `/api/og/factsheet/[id]`), and the acceptance test is demonstrated RED with the bypass neutered.
  4. Revoke is immediate and convergent: regeneration kills previously-copied links; a revoked/unknown token renders a content-free `410` + `no-store` on the TOKEN lane only (the bare-id lane keeps its uniform 404 or the id becomes an existence oracle); soft-revoke, never DELETE; double-revoke converges; the owner can see whether a live link exists.
  5. The share affordance is honest as a CLASS: no "Link copied!" for a link that cannot work, ONE predicate across all three affordance sites (`FactsheetView`, strategies page, discovery detail), a token-link RECIPIENT never sees a Copy-Link control that rebuilds the URL without the token, and `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence is corrected in this same phase.

**Plans**: 7/7 plans executed
**UI hint**: yes

Plans:

- [x] 164-01-PLAN.md — TRACER: builder seam extracted to `src/lib/factsheet/` + phase-148 guard re-pointed to pin the MODULE; HMAC+generation token module (loud at module load); `/factsheet-share/[token]` recipient route + 410 `gone` sibling + proxy/route-contract wiring + structural recipient mode (wave 1)
- [x] 164-02-PLAN.md — phase-29 guard narrowed to the scenario locked set (never a migration rename) + `strategy_shares` migration (generation model, no token at rest, two INVOKER RPCs) + SKIP-01-clean SQL gate; blocking three-reviewer + TEST hand-apply checkpoint (wave 1)
- [x] 164-05-PLAN.md — leak-channel closure (Sentry path scrub net-new, per-route no-referrer, Plausible exclusion, recipient analytics suppression) + the ORDERED adversarial cache test, RED-demonstrated (wave 2 — MOVED UP 2026-08-27, gate condition 5)
- [x] 164-06-PLAN.md — **N1 ONLY** (founder ruling 2026-08-27: N2 dropped): `BEFORE INSERT` trigger forcing `generation = 1`, a **bounded-increment** rule on UPDATE so an owner cannot PATCH `generation` toward the bigint ceiling, and `sanitize_user`'s Art.17 arm made provably non-abortable. ⛔ Do NOT add `SELECT … FOR UPDATE`, and do NOT touch STEP 6 arm (i-b) — see gate row 3 (wave 2 — NEW 2026-08-27, gate condition 2)
- [x] 164-07-PLAN.md — F6: the cache guard pinned over the TRANSITIVE import graph rather than one file's bytes (wave 2 — NEW 2026-08-27, gate condition 4)
- [x] 164-03-PLAN.md — mint-or-reuse + atomic-revoke API routes under the audit law; byte-identical-reuse regression pin; 404-as-convergence (wave 3 — DEMOTED 2026-08-27; ⛔ its merge is the gate)
- [x] 164-04-PLAN.md — SHARE-04 honesty class: status-aware Copy Link (published lane byte-unchanged), factsheet revoke with inline confirm, OwnerUnpublishedNotice corrected, ONE predicate across three affordance sites (wave 3 — DEMOTED 2026-08-27, follows 164-03)

**⛔ Wave restructure 2026-08-27 — 164-03's merge is a gate, not a step.** Six red teams plus a
synthesizer established that the moment `164-03` merges, the mint route makes `strategy_shares`
writable by owners — and **N1 becomes reachable by any owner, on their own row, with a single
PATCH, unrecoverably without DDL, aborting that data subject's own Art.17 erasure.** That is a
regulatory failure mode the data subject can trigger themselves with no operator remedy, and the
synthesizer named it the single worst item in the corpus. It is harmless *only* while the table has
zero rows, which is exactly the window that closes at 164-03.

So the phase is now three waves, and the six conditions at `SYNTHESIS.md:270-287` must ALL hold at
the moment 164-03 merges:

| # | Condition | Where it lands | State at 2026-08-27 |
|---|---|---|---|
| 1 | Nonce in the MAC pre-image **plus** `REVOKE INSERT(nonce), UPDATE(nonce) FROM authenticated`, with a test proving neither RPC names the column | 164-02 | ✅ shipped (`a48b8bf6d`) |
| 2 | N1 closed at the root: `BIGINT` **plus** `BEFORE INSERT` forcing `generation = 1` **plus** a bounded-increment rule; `sanitize_user`'s Art.17 arm provably non-abortable | 164-02 + **164-06** | ✅ **CLOSED 2026-08-28 (164-06), verified by the orchestrator on a fresh cluster.** Trigger widened to `BEFORE INSERT OR UPDATE`; INSERT forces 1 (closing R3 for BYPASSRLS roles grants never reach); rule (6) bounds every UPDATE to +1, so overflow is unreachable BY CONSTRUCTION and the Art.17 arm needs no handler. The N1 reproduction now rejects at **step 2** — yesterday it ended `Art.17 ERASURE ABORTED 22003`. Gate **103** arms, floors ARMS_FLOOR=166 / SENTINEL_FLOOR=8 (the 106/169 pair written here on 2026-08-27 was a forecast that the final arm count undershot; the file, its closing sentinel roster and ci.yml are mutually consistent at 103 and were re-counted 2026-08-28) |
| 3 | ~~N2 race in `revoke_strategy_share`~~ | ~~164-06~~ | ✅ **CLOSED AS NOT-A-DEFECT — founder ruling 2026-08-27.** Measured: 3 interleavings × 2 concurrent sessions, all converge; both RPCs are single statements so there is no read-then-write window. ⛔ AND THE PRESCRIBED FIX WAS THE HAZARD — `revoked_at IS NULL` is the convergence CONTRACT, and rewriting arm (i-b) *so the fix could land* would have removed the guard and created the counter-inflation bug. **Nobody may re-open this by adding `FOR UPDATE` or editing arm (i-b) without new measured evidence.** `EXECUTION-EVIDENCE.md` §6 |
| 4 | F6: cache guard pinned over the transitive graph, `page.cache-isolation.test.tsx` written and demonstrated RED first | **164-07** + 164-05 | ✅ **CLOSED 2026-08-28.** Static half (164-07): the builder's 38-module closure pinned against `next/cache`, RED proven at depth 3. Behavioural half (164-05): the ORDERED spec written and RED-first. ⚠️ 164-05 MEASURED that the plan's claim of two detectors was FALSE — phase-148 stayed green under the poison (it counts `unstable_cache(` in one file; its repo-wide walks ban two symbols the neuter never used), and 164-07 does not cover it either because the page imports the builder, not the reverse. Gap was unowned; closed with a third file. Two detectors is now true BY MEASUREMENT |
| 5 | F1/F2/F4 shipped (Plausible exclusion, Sentry path scrub, per-route `no-referrer`) | 164-05 | ✅ **CLOSED 2026-08-28.** ⚠️ Two plan errors corrected by measurement: Plausible's `data-exclude` is REMOVED from the current script and its exclusion is gated behind `pageview` while `location.href` rides every event — mitigated by not loading the script on the lane at all; and the `Referrer-Policy` justification was my error (cross-origin sends origin ONLY, so path-vs-query is Referrer-neutral) — the header stands on the SAME-ORIGIN gap, and the false mechanism is now recorded as false in all four files that carried it |
| 6 | Every one of the above **executed against a real PostgreSQL instance**, run output in the plan — not asserted in prose | all | 🟡 **discharged for what exists today** — 2026-08-27, PostgreSQL 16.13 throwaway cluster: both migrations APPLIED, `test_strategy_shares_rls.sql` **ALL 101 ARMS EXECUTED** exit 0, sequence `{1,1,2,2,2,3}`; arms proven able to fail (3 mutations on 130000, a `USING (true)` tenant leak caught by TENANT 4a). See `EXECUTION-EVIDENCE.md` + `pg-harness/run.sh`. ⛔ Re-arms for 164-06/164-07 |

⚠️ Wave 2 is now `164-05` + `164-06` + `164-07`; wave 3 is `164-03` + `164-04`. `164-06` and
`164-07` are net-new and unplanned. ⛔ **`20260827130000_sanitize_user_revoke_strategy_shares.sql`
is BLOCKED on `DRIFT-02`** (root `TODOS.md`) — it was re-based on a repo file that PROD superseded
via a surgical in-place patch, and shipping it as written would revert a mandatory GDPR repoint,
pointing Art.17 erasure at a VIEW. Re-base it on `pg_get_functiondef` output from PROD before it
moves. The three residuals accepted rather than closed (`SHARE-RES-R4`, `SHARE-RES-R2g`,
`SHARE-RES-F5`) are named in root `TODOS.md`.

**Research note:** the payload-builder seam is the one un-measured integration (extracting the build half of `fetchAndBuildPayload` touches the composite arm AND the single-key basis arm — MEDIUM confidence, wider than it looks). Budget a research pass at plan time; don't discover it. Token-leak channels: Sentry `beforeSend` scrub verified against a REAL captured event, `Referrer-Policy: no-referrer` per-route, generic metadata (link-unfurl dullness accepted explicitly — a private link SHOULD be dull in a chat preview). *(Planning update 2026-08-26: the seam measurement is now done — the composite/basis arms moved to `src/lib/factsheet/` in July, so the extraction in 164-01 is a one-function verbatim move per the founder's final D-06 ruling.)*

### Phase 164.7: APPSETTINGS — every app.* GUC reader moves to a mechanism this platform actually grants, because ALTER DATABASE and ALTER ROLE both return 42501 here (INSERTED)

**Goal:** Every `current_setting('app.…')` reader in `supabase/migrations/**` moves to a configuration mechanism this platform actually grants, and a machine stops the next one being written. ⛔ **MEASURED ON PROD 2026-09-05, not inferred from docs** — all three forms, in the Supabase SQL editor as `postgres`:

| Form | Result |
|---|---|
| `ALTER DATABASE postgres SET app.ledger_refresh_enabled = 'true'` | **`ERROR: 42501: permission denied to set parameter`** |
| `ALTER ROLE postgres SET app.ledger_refresh_enabled = 'true'` | **`ERROR: 42501: permission denied to set parameter`** |
| `SET app.ledger_refresh_enabled = 'true'` (session) | ✅ returns `true` |

So the value can only be set per-session, which no out-of-band operator action can do. **12 read sites across 4 settings depend on a mechanism that cannot be configured here**, in five migrations: `20260407164606_perfect_match.sql:31` (`app.admin_email`), `20260408113029_cron_heartbeat.sql:144,145,167,170` and `20260408215026_schedule_match_cron_hourly.sql:45,46,70,73` (`app.analytics_service_url` ×4, `app.analytics_service_key` ×5), and `20260825130000_ledger_refresh_fanout_dormant.sql:275` + `20260825140000_ledger_refresh_composite_arm.sql:220` (`app.ledger_refresh_enabled` ×2).

⭐ **This is a THIRD independent discovery of one defect.** `CRON-DRIFT-01` found it in the match-engine cron (booked, PROD hand-fixed onto Vault 2026-09-01, repo never updated — Phase 164.5.1 item (7) repairs that ONE job). Phase 161.1 then shipped an entire fail-closed activation switch on the same mechanism and it was never exercised, because the phase shipped dormant by design — so the switch has never once been thrown and **cannot be**. Two phases independently designed operator controls on a Postgres feature this platform does not grant, a year apart, and neither found out until someone tried. The pattern, not the instance, is this phase's subject.

⛔ **The blast radius is a shipped, blocked deliverable.** Phase 161.1 LEDGER-REFRESH is complete, verified 4/4, merged as v0.73.0.0, and **cannot be turned on**. Four PROD mt5 strategies carry `strategy_analytics` days stale against okx at hours, which is the exact gap 161.1 was built to close.

⛔ **The available workaround is REJECTED, and the rejection is the point.** Setting the flag inside the cron command (`$$SET app.… = 'true'; SELECT enqueue_…();$$`) works and was offered to the founder on 2026-09-05. **Founder chose the proper fix over shipping it.** It would hold a fail-closed guard permanently open by its own caller, and it would silently invalidate `docs/runbooks/ledger-refresh-go-live.md`'s FAST rollback ("reset the activation setting; the schedule keeps firing, the function returns 0") — a documented incident procedure that would then succeed while changing nothing. A kill switch that reports success and does not stop the thing is worse than no kill switch.

**Two mechanisms, chosen per setting rather than one-size-fits-all:** `app.analytics_service_key` is a SECRET and belongs in Vault (`vault.decrypted_secrets` — the mechanism PROD's jobid 1 was hand-repaired onto and the only one PROVEN working here); `app.analytics_service_url`, `app.admin_email` and `app.ledger_refresh_enabled` are non-secret configuration and belong in a table an operator can UPDATE, which restores the out-of-band kill switch 161.1's design depends on.

⛔ **SCOPE FENCE vs Phase 164.5.1 item (7).** 164.5.1 repairs the LIVE `match_engine_cron` `cron.job` row to match a committed manifest. THIS phase changes what the MIGRATIONS READ. They are not the same act and must not be merged: 164.5 fixes one production row, 164.7 fixes the class. 164.7 runs FIRST so 164.5's repair migration is written against the settled mechanism rather than inventing a second answer to the same question.

⭐ **CARRIED IN 2026-09-05 — `VAC04-ARMS-OBSERVE`, an OBSERVATION obligation, not a work item.** `[VAC04-ARMS-UNRUN]` (TODOS.md) records that VAC-04's three behavioural arms have never executed against the real PROD credential: the D-13 legitimate-zero branch (`scripts/prod-body-drift-check.sh:448`), the normal compare verdict, and the absurdity floor (`:608+`). PR #730 carried the credential but changed no `supabase/migrations/**` file, so the script exited at its EARLIEST short-circuit (`:198`, *"this PR changes no migration files — nothing to compare against PROD"*). ⛔ That entry FORBIDS manufacturing a migration PR to tick this off, which is why the obligation had no owner. This phase writes a genuine forward migration anyway, and in the queued order (164.1 → 164.2 → **164.7** → 164.5 → 164.6) its PR is the FIRST real chance for those arms to fire — so the obligation is to READ the result, not to create the occasion. ⚠️ If this phase's migration turns out not to change a function BODY (it may touch only cron rows and GUC readers), that is a legitimate outcome: say so explicitly and ROLL THE OBLIGATION FORWARD to Phase 164.5, whose DRIFT-04 `DROP FUNCTION` and CRON-DRIFT-01-REPAIR migrations are the backstop. Either way `.planning/WINDOWS.md` entry 25 gets its disposition from a MEASUREMENT, never an assertion. ✅ **RESOLVED 2026-09-07 — the roll-forward branch did NOT fire and this obligation is DISCHARGED.** Phase 164.7's migration `20260907130000` DID change function bodies, and VAC-04's DRIFT branch fired against the real PROD credential on BOTH ledger arms (`enqueue_ledger_refresh_for_strategies` and `enqueue_ledger_composite_refresh`), with real hashes and 15-line counts, each acknowledged by an earned `prod-body-ack:` pragma. Nothing rolls forward to Phase 164.5, and the CRON-DRIFT-01-REPAIR backstop named above has since moved to Phase 164.5.1 anyway. `WINDOWS.md` entry 25 has its measurement. ⛔ NOT in scope: `[VAC-04-ROLE]` (the zero-grant credential swap) stays unowned in TODOS by its own instruction — it changes WHICH credential is used, not whether the control works, and its entry says not to let it gate a phase.

**Success Criteria**:

1. Zero `current_setting('app.` occurrences remain in `supabase/migrations/**` outside a dated, commented lineage block — proven by a grep in CI, with a RED fixture showing the gate fires when one is reintroduced. A gate that cannot fire is this milestone's named defect.
2. Each of the 4 settings is dispositioned BY NAME with its chosen mechanism and a migration that moves it: `analytics_service_key` → Vault, `analytics_service_url` → the settings table, `ledger_refresh_enabled` → the EXISTING `system_flags` table. No setting is silently dropped.

   ⚠️ **SCOPE AMENDMENT 2026-09-07 (phase 164.7 discuss, D-04) — `app.admin_email` is ANNOTATED, not "either migrated or DELETED".** The original wording offered exactly those two dispositions; measurement at `14dc1f5e` says neither is correct. `20260407164606_perfect_match.sql:31` is not a live reader — it sits inside a one-shot `DO $$ … END $$` block that ran ONCE when the migration applied on 2026-04-07 and can never run again (no function body, no cron command, no view; `grep -rln 'perfect_match\|v_admin_email' supabase/migrations/` returns that one file). **Migrating it** would re-point code that will never execute. **Deleting it** would edit an APPLIED migration so the repo no longer describes the statements that ran against PROD — a cosmetic grep win paid for with a false permanent record. Disposition: a dated, commented lineage block, which is the exemption criterion 1 already defines, carrying the evidence that nothing reads it. ⚠️ Criterion 1's gate is a grep and a grep cannot tell a comment from a statement, so `20260408113029_cron_heartbeat.sql:113` — an `app.analytics_service_key` mention inside a `--` comment, which the ROADMAP's original "12 read sites / key ×5" census counted as a read site and which is NOT one — gets a lineage block on the same grounds. The executable census is **11 sites**, not 12.
3. ⭐ **The 161.1 activation switch is THROWN on PROD and observed working** — this phase is not done when the code changes, it is done when `enqueue_ledger_refresh_for_strategies` returns a non-zero count on a real tick and `ledger_refresh_staleness.days_since_last_return` goes DOWN for the mt5 cohort. ⚠️ A green `compute_jobs` row is NOT success: the defect 161.1 fixes wore a green badge for weeks (`process_key_long` returns DONE and leaves `strategy_analytics` untouched). Check the view, not the job.
4. The out-of-band kill switch is REAL and proven by measurement: with the schedule still registered and firing, flipping the setting makes the next tick enqueue 0 — observed, not asserted. This is the property the rejected workaround would have destroyed.
5. `docs/runbooks/ledger-refresh-go-live.md` is corrected at every step whose privilege claim was falsified — Step 1a/1b/1c and the Rollback section — and records the 2026-09-05 measurement that closes its own open question OQ-3. ⚠️ The runbook currently instructs an operator to run two statements that BOTH 42501, then verify in a new session; anyone following it today stalls at step one.
6. Three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any migration applies, per project rule. Merging `supabase/migrations/**` to `main` auto-applies to PROD.
7. `VAC04-ARMS-OBSERVE`: the SUMMARY quotes the `VAC-04 — repo-vs-PROD function body drift` step's OWN output from this phase's migration PR verbatim and names, by line reference, which branch it took. If that branch was again the `:198` short-circuit, the SUMMARY says exactly that and records the roll-forward to Phase 164.5 — it does NOT claim the arms ran. ⚠️ A green `migration-drift-check` job is not evidence: the whole point of `[VAC04-ARMS-UNRUN]` is that the job was green while the arms never executed.

⭐ **CARRIED OUT 2026-09-07 — `BASELINE-CONTENT-DRIFT`, a MEASUREMENT this phase makes and a
HAND-OFF it does not fix.** ⛔ Deliberately NOT an eighth success criterion: this phase's seven plans
were already written, checked and executing when it was found, and a criterion no plan delivers is a
phase that fails its own bar. It is recorded here because 164.7 is where it was measured and 164.7 is
what makes it worse.

**Measured at `14dc1f5e`:** `supabase/schema/baseline.sql` still contains the SUPERSEDED Lock B —
`grep -c ledger_refresh_enabled` returns **4** — and `grep -rn baseline.sql .github/workflows/*.yml`
returns **0**. Nothing in CI reads that file today. This phase's `20260907130000` migration replaces
both ledger bodies, so the committed baseline becomes staler the moment 164.7 lands.

⚠️ **Phase 164.5 criterion 2 does NOT catch this, and that is the point of the hand-off.** That gate
fails "on a one-byte change to `baseline.sql` without a matching `BASELINE.md` update" — a CO-EDIT
gate. 164.7 changes no byte of `baseline.sql`, so no `BASELINE.md` update is owed and the co-edit gate
stays GREEN while the content silently diverges from the migration chain. Co-editedness and
correctness are different properties. Booked as 164.5 criterion 8.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries CRON-DRIFT-01 (the GUC half only — the LIVE-row repair is 164.5.1), `VAC04-ARMS-UNRUN` (the OBSERVATION half only — the credential swap `[VAC-04-ROLE]` is NOT this phase's), and the 161.1 ACTIVATION human-verification item in `161.1-VERIFICATION.md`, which this phase exists to unblock — read each before planning, do not re-derive
**Depends on:** Phase 164. ⛔ **MUST run BEFORE Phase 164.5.1**, whose repair should consume this phase's settled mechanism rather than inventing a parallel one.
**Plans:** 7 plans

Plans:

- [ ] 164.7-01-PLAN.md — Criterion-1 gate: `scripts/lint-app-guc.mjs` (hermetic, raw-text, exact-count lineage header + script-side allowlist), red/green fixtures, vitest pin, two steps in `sql-gate-lint`; corpus reads 12 findings / 5 files by design until plan 05 (wave 1)
- [ ] 164.7-02-PLAN.md — `20260907120000`: `system_settings` (D-03) + `match_engine_cron_tick()` reading Vault + the table (D-02 as DRIFT-02), schedules nothing; vault stand-in fixture 32; 7-arm gate; types block (wave 1)
- [ ] 164.7-03-PLAN.md — `20260907130000`: both ledger fan-outs re-based with Lock B as a fail-CLOSED `system_flags` read (D-01/C-03), seed FALSE; fixture 31; snapshots regenerated; pytest gates re-anchored (wave 1)
- [ ] 164.7-04-PLAN.md — Re-point all 28 edit-kind twins at the superseding migration, table activation, arms A/K/L (missing row / FALSE / raising read ⇒ 0) in both ledger gates, 17/17 RED each (wave 2)
- [ ] 164.7-05-PLAN.md — Floors separated both directions and pinned (46 files); five dated lineage headers + allowlist → gate 0 findings (D-04/D-05); ledger + match-engine runbooks corrected (two live ops, manifest re-capture, OQ-3 closed, #747 note); CLAUDE.md/TODOS currency (wave 3)
- [ ] 164.7-06-PLAN.md — Three reviewers before the PR (D-07); ship checkpoint; VAC-04 output READ and branch named by line, ack EARNED via `--diff-bodies` (D-08); dry-run + expected `sql-tests`/VAC-08 reds read; WINDOWS 25 dispositioned (wave 4, checkpoint)
- [ ] 164.7-07-PLAN.md — PROD activation as a founder `checkpoint:decision` (D-06): measured pre-flight, two live ops + view-based observation + kill-switch proof + manifest re-capture, or DEFER with the blocker named; closes the 161.1 ACTIVATION item (wave 5, checkpoint)

### Phase 164.3: VACUITY — a control that cannot fail must be caught by machine, not by red team (INSERTED)

**Goal**: A control that cannot fail is detected by a machine, on every push, instead of by a six-team red team once per milestone.
**Depends on:** Phase 164 (its measured corpus is this phase's specification).
⛔ **RESEQUENCED 2026-08-28 — this phase now runs FIRST, before 164.1 and 164.2.** Founder-approved.
The previous line read "ordered after 164.1 and 164.2 — numeric order only, no dependency on either",
and that "no dependency" is exactly what makes the move free. The direction was backwards: criterion 2
builds a real disposable PostgreSQL lane and criterion 1 builds a mutation runner, and those two ARE
the substrate on which 164.1's gate work would otherwise be hand-tested. Doing 164.1 first means
building gate machinery twice.
**Requirements**: VAC-01, VAC-02, VAC-03, VAC-04, VAC-05, VAC-06, VAC-07, VAC-08 (defined in
REQUIREMENTS.md by the 2026-08-28 discuss pass; the line previously read `TBD`)

+ **absorbed from 164.1:** SKIP-01, DRIFT-01, OPS-08-F9, OPS-08-F8, H-0001 (see the DEDUP table

under Phase 164.1 for the reasoning per item).
⚠️ SKIP-01's premise FAILED re-measurement — see the VERIFIED CORRECTIONS block in
`164.3-CONTEXT.md`. It is now VAC-08 (a drift check that joins on `name`), NOT a migration-apply lane.

**Why this exists — measured, not felt.** Phase 164 produced **five distinct vacuity mechanisms**,
and the DRIFT family alongside them. ⛔ Every single one was **GREEN in CI**, survived code review,
and was found only by executing adversarially after a red team. That is the finding: not "we write
weak tests", but **nothing in the pipeline can tell a control that holds from one that cannot fail.**
Detection currently costs a red team.

| # | Mechanism | Where it hid |
|---|---|---|
| 1 | Post-rejection probe inside a PL/pgSQL `BEGIN…EXCEPTION` — an implicit subtransaction, so the arm reads its own rollback | Found twice: removed at TRIGGER 1, survived undeclared at TENANT 5d-5g. A genuine cross-tenant write placed inside the handler moved the victim's counter **and the file went green** |
| 2 | `pg_get_functiondef` regex satisfiable by an in-body `--` comment | Migration STEP 2 arms |
| 3 | A diagnostic computing `pre + 1`, which overflowed in exactly the state it was diagnosing — the arm aborted on its own arithmetic | N1 3a / N1 1c |
| 4 | Partial bitmask: `tgtype & 16` only, so a trigger narrowed back to `BEFORE UPDATE` satisfied every remaining term and the INSERT pin could be deleted invisibly | Fixed in the migration, **still blind in the durable gate** |
| 5 | An arm made structurally unreachable by an earlier arm covering the same state — the reachable one then reported the defect as its **exact opposite** ("row is STILL LIVE" when the row was deleted) | SANITIZE 1c / 1e |

Plus the **drift** half, same root — *the claim and the thing are never compared*: `DRIFT-02`
(repo vs PROD, which nearly shipped a GDPR regression), `DRIFT-01` (TEST vs repo), `SKIP-01` (a gate
that SKIPs forever and reads as PASS), and stale comments that **argued away** the coverage which
would have caught a token-resurrection bug.

**Success Criteria** (what must be TRUE):

  1. **A mutation runner exists and runs in CI.** Arms carrying a
     `RED-UNDER: <the exact mutation that makes me fail>` annotation are machine-mutated by the
     runner, which asserts the file goes RED and then restores it. ⭐ This alone would have caught
     mechanisms 1, 4 and 5 with no human involved. It is the highest-value item in the phase by a
     distance.
     ⛔ **CORRECTED 2026-08-28 — this criterion previously read "Every arm in `supabase/tests/*.sql`
     already carries" one. MEASURED at HEAD, that is 1 file of 71** (**30** arm-anchored
     annotations, all in `test_strategy_shares_rls.sql`; a naive `grep -c "RED-UNDER"` says 33 because
     it counts the file's own header documenting the syntax at :46/:48 plus a prose reference at
     :1541 — re-measured 2026-08-29). The sentence was a claim never compared to the thing — the
     exact defect this phase exists to catch, sitting in its own spec. Do NOT plan against the old
     wording: the runner covers the annotated corpus, and **Phase 164.4 (REDUNDER-BACKFILL)** closes
     the remaining 70 files using this runner as the oracle.
     ⭐ This phase stays shippable regardless: all five measured mechanisms (`TENANT`, `TRIGGER`,
     `SANITIZE`, `STEP 2`, `N1`) live in the already-annotated file, so criterion 6 is reachable with
     the 33 annotations that exist today.
     ⚠️ The runner MUST print its coverage (files annotated / files total) on every run. A runner
     reporting PASS while silently covering 1.4% of the corpus is the same shape as `SKIP-01`, which
     is on this phase's own list.

  2. **The throwaway-PostgreSQL lane is real** — `PROC-01`'s implementation. Today it is a script under `.planning/`, written mid-phase, whose own two defects (reusing another agent's cluster then `DROP SCHEMA public CASCADE`; RLS enabled on nothing but the table under test) were found by reviewers using it.
  3. **A static linter rejects the four statically-decidable measured shapes** on new gate files (mechanisms 1, 2, 4 and a narrow 3), so a further mechanism of those kinds is a lint failure rather than a red-team finding. Mechanism 5 is **delegated** to the mutation runner's first-failure identity per D-16 — it is not decidable in SQL text, and a rule that cannot fire is the defect this phase exists to remove. Machine-pinned via the linter's `DELEGATED_MECHANISMS` export. ⭐ **UPDATE 2026-09-04 (Phase 164.4, review finding WR-03):** the linter now ships **seven** rules, not four — R5/R6/R7 close a SIXTH mechanism (a pg-lane stand-in that SHADOWS the object under test) found by hand twice during the 164.4 backfill. ⛔ This does NOT touch the mechanism-5 delegation above, and R5/R6/R7 are not "a fifth rule to round the count up": mechanism 5 is still delegated to first-failure identity, and each new rule was proven to make live contact with the real corpus by DISABLING its repair escape and counting the reds (R5=1, R6=3, R7=5 real gate files), pinned as a per-rule floor. *(Corrected 2026-08-29, gap G3 — this criterion said "five" after D-16 narrowed it; the plan line at :538 already said four.)*
  4. **No whole-body `CREATE OR REPLACE` merges without a repo-vs-PROD diff** (`DRIFT-02b`). A function that has ever been surgically patched has no true body in the repo, and "re-base on the latest definition" is unsatisfiable from files alone.
  5. **A plan's claims about the codebase are verified, not trusted.** A PLAN.md asserts line
     anchors, function signatures and RPC return shapes — and NOTHING compares them to the tree.
     Both wave-3 plans were stale when execution reached them: `164-03` specified a two-argument
     `deriveShareToken` that would have minted links failing verification (the token gained a third
     input mid-phase), and `164-04` anchored edits at `v2/page.tsx:563-573` in a file that had
     shrunk to 423 lines. Neither is catchable by review — a reviewer reads the plan against the
     plan. Both were caught by grepping the plan for what the phase had learned and re-resolving
     its anchors, which is mechanisable: resolve every `file:line` and every named symbol in a
     PLAN.md at execute time, and fail loud on a miss.

  6. ⛔ **Each of the five is demonstrated against the phase-164 corpus** — re-introduce each historical mechanism and show the new machinery catches it. A vacuity detector that has never caught a vacuity is the joke that writes itself.

**Explicitly OUT of scope:** the GSD-machinery gaps — `depends_on` yielding `blocked_by: {}` so plan
ordering is unenforced, wave frontmatter drifting from ROADMAP, and `NYQ-01`. Same smell, different
system (upstream `gsd-core`, not this repo). Mixing them in makes this unshippable. Book them
separately.

**Plans:** 9/10 plans executed

Plans:

- [x] 164.3-01-PLAN.md — Disposable-PG lane promoted (trap cleanup, PGBIN chain, free port) + SHAPE 1c tracer proof (VAC-02) [wave 1]
- [x] 164.3-02-PLAN.md — Drift family: shared normalizer, VAC-04 PROD-body step in migration-drift-check.yml (D-12/D-13/D-17), VAC-08 name-join ledger check + body assertion, OPS-08-F9 verify-and-record (VAC-04, VAC-08, SKIP-01, DRIFT-01) [wave 1]
- [x] 164.3-03-PLAN.md — H-0001: findMutations single-line detection fixed, un-skipped, re-censused, counted allowlist [wave 1]
- [x] 164.3-04-PLAN.md — VAC-07 SPIKE: 263-migration replay measured + local-stack lane with trapped teardown (D-15) [wave 1]
- [x] 164.3-05-PLAN.md — Mutation runner core: RED-UNDER-M grammar + parser + first-failure identity + both exit-1 modes + aggregation (VAC-01, OPS-08-F8) [wave 2]
- [x] 164.3-06-PLAN.md — Static vacuity linter, mechanisms 1/2/4 + narrow 3, red fixtures per rule, NO mechanism-5 rule (VAC-03, D-16) [wave 2]
- [ ] 164.3-07-PLAN.md — Phase 159 closure spec: two concurrent csv-finalize POSTs, one 2xx + one honest 409, winner holds (VAC-07, D-08) [wave 2]
- [x] 164.3-08-PLAN.md — Corpus annotation backfill (30 arm-anchored markers, measured), full run green, ARMS_FLOOR pinned, sql-mutation CI job + aggregator row (VAC-01) [wave 3]
- [x] 164.3-09-PLAN.md — Plan-anchor verifier: range + quote re-resolution over pending plans, CI seam + execute-time convention (VAC-05, D-06 own wave) [wave 4]
- [x] 164.3-10-PLAN.md — All five mechanisms re-introduced and demonstrated caught, durable via vitest pin + every-push runner (VAC-06) [wave 5]

### Phase 164.3.1: SOUND-PRIMITIVES — all FOUR cycling primitives closed by construction: neuter scan, mutation identity, VAC-04, self-referential oracle (INSERTED)

**Goal:** SOUND-PRIMITIVES — four control primitives on this branch have each re-opened FOUR times, every round closing the reviewer's EXAMPLE and then declaring the CLASS closed in code comments, in GRAMMAR.md and in the fix report. Each must now be sound BY CONSTRUCTION, not by which files happen to be annotated or which spelling happens to be in the corpus today. Scope covers all four (founder decision 2026-08-29, widened from the original two). PRIMITIVE A — an accepted neuter leaves privileged state live. Lineage WR-07 -> R2-C01 (a `--` comment containing EXCEPTION) -> R3-C01 (keyword in a string literal, block comment, dollar-quoted body) -> R4-C01, where `isBranchHead` (scripts/mutation-runner/run.mjs:322-329) has two UNANCHORED arms, so the compound line `SET ROLE postgres; IF NOT ok THEN` is accepted as structurally a branch head, the backward scan breaks, and `neuterArm` returns found:true with `SET ROLE postgres;` still live; a leaked superuser then makes every downstream GRANT arm pass for a reason unrelated to its grant. SEVEN lines of exactly this shape ALREADY EXIST in supabase/tests/test_profiles_privileged_columns_locked.sql (96/101/106/111/116/121/132), the directory phase 164.4 backfills. The round-3 fixer's disclosed line-local residual was NOT the hole; the predicate is, and a fifth regex pass will not close it. Carries [MUT-I01]: `neuterArm`'s forward scan and `statementEndLine` walk raw characters tracking only `'`, so a legal multi-line RAISE with an apostrophe inside a `--` comment returns a spurious neuter-missed, and the even-parity case over-neuters SILENTLY. PRIMITIVE B — an arm counts toward `biting` without executing. Lineage WR-03 -> R2-W04 -> R3-C02 (a split literal) -> the runtime identity nonce -> R4-C02, where the nonce is forgeable with NO file read and NO superuser: the stamped text sits in the query text of the statement the gate is running, and Postgres hands it to server-side code via current_query(). MEASURED — an AFTER INSERT trigger installed by a `sql` step scored RED (identity ok) and biting: 1 for an arm guarded by IF FALSE; the control with a constant scored NO-IDENTITY, biting 0. The real corpus already ships CREATE OR REPLACE FUNCTION RETURNS TRIGGER plus CREATE TRIGGER `sql` steps, so the capability cannot be revoked without refusing a legitimate arm; this needs a DESIGN decision about where the identity lives, not another guard. PRIMITIVE C — a gate's VERDICT is not bounded by what it actually measured, in EITHER direction. Originally scoped as "VAC-04 reports PASS having compared nothing"; widened 2026-08-30 after the mirror case shipped and was caught in this branch's own CI. VAC-08's first real run reported "253 of 262 repo migrations are not present in the TEST ledger" against a database e2e-seeded was passing on in the SAME run — a finding the gate never really measured, phrased so confidently it pointed a reader at hand-applying 253 migrations to a SHARED database. Same root cause as the PASS direction: the gate held every number needed to know its own verdict was absurd (repo total, missing count) and never compared them. VAC-08 now carries an ABSURDITY FLOOR; VAC-04 and the mutation runner do not, and that is this phase's work. Lineage WR-01 ("absent -> new function, pass" with no floor on `checked`) -> R2-W03 (the `accounted != NAME_COUNT` floor was tautological) -> ship-stage SP-C05 (the name index and the body fetcher were one code path, so `sanitize_user$v2` vanished from both) -> round 4. Members, all measured at HEAD: [VAC04-C1] the two readers' blind spots COMPOSE (the naive reader cannot see a definition that does not START a line; the lexer cannot see `$` in an identifier), so three shapes return the empty set from BOTH and the gate exits 0 printing "Two independent readings agree"; [VAC04-C2] the main-module guard `import.meta.url === file://${process.argv[1]}` no-ops on any symlinked path or path containing a space, so `main()` never runs, stdout is empty and the script exits 0 — measured with a PASSING CONTROL (plain path true, symlink false, space false) — and BOTH union members carry the identical guard, so the two "independent" derivations fail together through one mechanism; [VAC04-C3] `grep -aqxF` exit 2 (unreadable index) and exit 1 (not in index) both land in the else that prints "measured absent — Treated as a NEW function (pass)", turning the fail-CLOSED arm into a fail-OPEN one; [VAC04-C4] a non-ASCII identifier is TRUNCATED by one reader and dropped by the other, so the gate compares the WRONG function body and can report MATCH for a different subject. The unifying defect: the gate's "nothing to compare" path exits 0, so every blindness in any reader converts directly into a green gate over PRODUCTION function bodies. PRIMITIVE D — a control whose own oracle or fixture agrees with it BY CONSTRUCTION. Instances: the four vacuity mechanisms found in round 1 (including a five-row table named INDEPENDENT ORACLE whose values never reached the system under test, proven by neuter — replacing all five with garbage left 63 tests green); SP-C04, removed from local-stack-teardown-assertion.test.ts; [VAC-SELFREF-01], the SAME shape reintroduced within that same fix round at src/__tests__/lint-sql-gates.test.ts:182-186, where two assertions describe a string constant defined two lines above and cannot fail for any change to lintFile, the fixtures or the rule set; [AUDCOV-01], where all three shipped SP-I01 arms use single-line strings so the fixture agrees with the claim by construction and cannot catch the multi-line case; and [MUT-W02], where the per-job tolerance pin asserts ONE literal spelling so an equivalently-written tolerance arm widens the aggregator unseen. This primitive recurs through hand-authored test code written fast to close vacuity findings, which is why it needs a MACHINE check, not another careful pass. [AUDCOV-01] additionally carries a LIVE REGRESSION and is the one item here that must not merge as-is: the SP-I01 fix deleted the comment justifying line-leading `/*` entry and widened `unmatchedBlockOpen`, which tracks quote state per line reset at every newline, so a multi-line template literal containing `/*` opens a phantom block and blanks the rest of the file. MEASURED against the file's own real bytes: A) multi-line template with `/*` -> sites [] ; B) control without the `/*` -> sites [line 5] ; C) the shipped single-line arm -> sites [line 3]. The PRE-FIX code found site A. This makes main's H-0001 audit-coverage gate blinder than it was, unlike the rest of the branch which is incomplete-but-new. DELIVERABLES. (1) Replace the line-and-regex neuter classifier with a SQL-aware tokenizer carrying quote, dollar-quote and block-comment state ACROSS lines and classifying STATEMENTS rather than lines, and route `neuterArm`'s forward scan and `statementEndLine` through it so the file has ONE definition of what is code. (2) Move the arm identity somewhere the executing SQL cannot observe, or PROVE no server-side construct can reach it, and record which. (3) Make VAC-04's ZERO path fail closed rather than trusting agreement between readers with overlapping blind spots, and fix the three concrete members: the realpath idiom already at scripts/check-banned-packages.mjs:446 in BOTH union members, explicit exit-code branching on the name-index grep with >= 2 a hard fail, and refuse-rather-than-truncate on any identifier leaving the unquoted charset. (4) Fix the audit-coverage stripper by carrying string state across lines with quoteAtEnd forced to null for `'` and `"`, and add the three-arm table with B as the calibration control. (5) Add a MACHINE check for primitive D that flags an assertion whose subject is a constant defined in the same block, and re-express [MUT-W02] as a parse of the aggregator's branch conditions with its own non-vacuity floor. (6) A REGRESSION CORPUS carrying every measured instance across all four primitives as EXECUTABLE arms, so instance five reds in CI rather than in a review. (7) Re-derive ARMS_FLOOR and the biting count under the sound primitives and record any movement, because today's 30/30/0 is correct by SCOPE, not by mechanism. (8) DIAGNOSTIC-FIRST — every gate in this family must PRINT WHAT IT SAW when it fails, not only its conclusion. This is the strongest measured result of the 2026-08-29/30 ship: adding a shape diagnostic to VAC-08 surfaced two further ledger conventions in two CI cycles that FOUR review rounds of reasoning had missed, and reasoning is what produced the wrong join key in the first place. A failure that asserts a conclusion without showing its evidence is another unchecked claim. (9) Carry the VAC-08 instances into the REGRESSION CORPUS of deliverable (3) as executable arms — the 253-of-262 verdict and the three-convention join — so instance four of the Primitive C family reds in CI rather than in a review. Extend the absurdity floor to VAC-04 (which can still report "every function is new — pass" when its name reader breaks) and to the mutation runner (which can report arm counts it did not execute). Pick every threshold the way VAC-08's was picked — by measurement with wide separation (9/262 fires, 232/262 silent), never by taste. ⚖️ RULE, deliberately NOT a fifth primitive: where a gate's key, threshold or join is justified by a measurement, record that measurement's SAMPLE SIZE and COVERAGE beside it, and carry an arm asserting it against the FULL corpus. VAC-08's join key was validated on 12 rows and applied to 262; it was wrong for 253 of them and nothing caught it for four rounds because the gate had never executed. This shape has exactly ONE measured instance, and A-D each reopened FOUR times — promoting one instance to a primitive would inflate the taxonomy to look thorough, which is a species of the same disease. If it reopens, promote it then, with evidence. HARD DEPENDENCY: must complete BEFORE 164.4 REDUNDER-BACKFILL, which annotates ~70 files each asserting a machine proved the arm bites — against unsound primitives those are not 70 bugs but 70 FALSE ATTESTATIONS. EXCLUDES only two prose items, which stay in TODOS.md: [MUT-I02], a header denominator saying 114 migrations where there are 262, and [MUT-I03], a one-line note that concurrent agents editing the tree redden the runner's own dirty-checkout gate.
**Requirements**: TBD
**Depends on:** Phase 164.3
**Success Criteria**:

1. Every one of the measured instances across all four primitives is an EXECUTABLE arm in the regression corpus, and each is proven to RED by neutering its fix and observing the failure — a corpus entry that cannot fail is itself a primitive-D instance.
2. The neuter classifier is statement-based: the seven compound lines already in supabase/tests/test_profiles_privileged_columns_locked.sql are classified correctly, and no accepted neuter leaves `SET ROLE postgres;` live on any corpus file.
3. The arm identity cannot be produced by any SQL the gate executes — demonstrated by re-running the R4-C02 `current_query()` trigger and observing NO-IDENTITY — or the reachability proof is recorded with the constructs it covers.
4. VAC-04 cannot exit 0 having compared nothing: the zero path fails closed, and each of [VAC04-C1]..[VAC04-C4] is driven end-to-end through the real gate and observed to exit non-zero on its own measured input.
5. `stripBlockComments` finds the multi-line-template site (case A) while the B control still passes, and the machine check for primitive D flags the `lint-sql-gates.test.ts:182-186` shape at HEAD before it is fixed.
6. ARMS_FLOOR and the biting count are re-derived under the sound primitives, and any movement from today's 30/30/0 is recorded with the reason.
7. Every gate in the family PRINTS ITS EVIDENCE on failure, demonstrated by driving each one to its failure path and reading the output: the failure names what was measured (counts, keys, samples), not only the conclusion. An arm asserts this so a future gate cannot ship a bare conclusion.
8. The absurdity floor exists on VAC-04 and on the mutation runner as well as VAC-08, each proven able to fire AND proven silent on a legitimate finding — a two-directional neuter, because a floor that fires unconditionally also passes its own RED arm. Every threshold records the measurement that set it and the separation it achieves.
9. Every gate whose key, threshold or join rests on a measurement carries that measurement's SAMPLE SIZE and COVERAGE beside it, plus an arm asserting the key against the full corpus. Verified by grepping the family for justifying measurements and finding no bare ones.

**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 164.3.1-01-PLAN.md — TRACER + Primitive A: statement tokenizer, neuter path routed through it (Wave 1) [SC-2]
- [x] 164.3.1-02-PLAN.md — Primitive-D AST rule REPORT-ONLY + calibration at HEAD on lint-sql-gates.test.ts:182-186 (Wave 1) [SC-5]
- [x] 164.3.1-03-PLAN.md — [AUDCOV-01] before-state calibration: A/B/C = []/[5]/[3] via extracted real bytes (Wave 1) [SC-5]
- [x] 164.3.1-04-PLAN.md — VAC-04 union readers hardened: realpath guards (C2) + charset refusal (C4) (Wave 1) [SC-4, SC-7]
- [x] 164.3.1-13-PLAN.md — GAP CLOSURE: [VAC04-C2]/[VAC04-C4] driven THROUGH THE REAL GATE (symlink/space reader paths; `fúnc_é` refusal), standing calibration legs + recorded neuters, registry `also:` gate-level bindings (Wave 1, gap_closure) [SC-4]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 164.3.1-05-PLAN.md — Primitive B: source-location attribution replaces the nonce; single-frame chain rule; verbose pg-lane (Wave 2) [SC-3, SC-7]
- [x] 164.3.1-06-PLAN.md — [AUDCOV-01] fix: cross-line quote state; A finds its site, B/C controls hold (Wave 2) [SC-5]
- [x] 164.3.1-07-PLAN.md — VAC-04 gate: grep exit branching (C3), fail-closed zero path + reopen pin, absurdity floor (Wave 2) [SC-4 PARTIAL, SC-7, SC-8, SC-9]
- [x] 164.3.1-08-PLAN.md — Primitive-D rule BLOCKING with measured allowlist; :182-186 fixed; [MUT-W02] structural parse (Wave 2) [SC-5, SC-9]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 164.3.1-09-PLAN.md — Measure-first: ARMS_FLOOR + biting re-derived under sound primitives, movement recorded (Wave 3) [SC-6, SC-9]

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 164.3.1-10-PLAN.md — Mutation-runner absurdity floor: armsExecuted vs lane invocations, printed + CI-asserted (Wave 4) [SC-7, SC-8, SC-9]

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 164.3.1-11-PLAN.md — Regression corpus A+B: four lane-driven selftest fixtures, recursive RED proofs (Wave 5) [SC-1]
- [x] 164.3.1-12-PLAN.md — Regression corpus C+D + VAC-08 instances, instance→arm registry, SC-7/SC-9 meta-arms (Wave 5) [SC-1, SC-7, SC-9]

### Phase 164.4: REDUNDER-BACKFILL — every SQL gate arm gets a RED-UNDER annotation that a machine PROVES bites (INSERTED)

**Goal**: Every arm in **the 39 idiom files the pg-lane can reach** (4 more are printed by the
runner as lane-blocked every run and a 5th under `pending:` — SCOPE AMENDMENT #2 and its 2026-09-04
ARITHMETIC CORRECTION, 100 sections owed to `[REDUNDER-PGCRON]`) of `supabase/tests/*.sql` carries a
`RED-UNDER` annotation naming the exact mutation that makes it fail, and the Phase 164.3 mutation
runner PROVES each one bites — red under its own mutation, green when restored. ✅ ACHIEVED
2026-09-04, MEASURED: `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, 0 waivers, exit 0.
Coverage moved from 1 file to those 39 reachable files,
behind a floor that cannot regress, with the **27 excluded non-idiom files and the 4 deferred
lane-blocked files each printed by name on every run**. (Scope narrowed from "all of them" by
founder decision 2026-09-02, and again 2026-09-03 — see both SCOPE AMENDMENTs below; the rename of
the 27 is booked as `[REDUNDER-NONIDIOM]` and the 4 as `[REDUNDER-PGCRON]` in `TODOS.md`.)
**Depends on:** ⛔ **Phase 164.3 — HARD, not ordering.** 164.3 builds the mutation runner, and the
runner is the only thing that makes this phase safe to do at all.
**Requirements**: SC-1, SC-2, SC-3, SC-4 — the four success criteria below stand in for requirement IDs (no `REQUIREMENTS.md` IDs exist for this inserted phase; RESEARCH § Phase Requirements). Discussed 2026-09-02 (`164.4-CONTEXT.md`).

**Why this is its own phase, and why it CANNOT come first.** MEASURED at HEAD 2026-08-28:
`grep -rl RED-UNDER supabase/tests/` returns **1 file of 71** — 33 annotations, all in
`test_strategy_shares_rls.sql`, the file Phase 164 wrote. 164.3's criterion 1 asserts that "every arm
in `supabase/tests/*.sql` **already carries**" one. That is false by a factor of 71, and it is
false in exactly the way 164.3 exists to catch: **a claim and the thing were never compared.**

⭐ **The ordering is load-bearing, not tidiness.** A hand-written `RED-UNDER` is itself a CLAIM —
"this mutation reddens this arm". Authoring ~166 such claims at speed, by hand, is a vacuity
mechanism manufactured at scale: an annotation that does not actually redden its arm passes
silently and reads as coverage. Doing the backfill BEFORE the runner exists would be the phase
group defeating its own thesis. With the runner in CI the claim is machine-checked — a
`RED-UNDER` that fails to redden its arm **fails the build**. That single fact converts this work
from faith-based to verified, and it is why this phase waits.

⚠️ 164.3 remains shippable without this phase, and deliberately so: all five measured vacuity
mechanisms (`TENANT`, `TRIGGER`, `SANITIZE`, `STEP 2`, `N1`) live in the already-annotated file,
so 164.3's criterion 6 is reachable with the 33 annotations that exist today. This phase closes the
corpus gap; it is not a prerequisite for 164.3 being real.

⚖️ **SCOPE AMENDMENT — founder decision 2026-09-02, criterion 1 NARROWED. Read this before
planning.** Criterion 1 below originally read "every arm in `supabase/tests/*.sql`". MEASURED at
HEAD (164.4-RESEARCH.md): the corpus holds **1398 `RAISE EXCEPTION` sites across all 71 files —
zero files have none** — but only **890** use the `TEST FAILED (<arm>)` idiom the runner keys on
(`run.mjs:544`, the one identity definition at `run.mjs:947`). **27 files / 334 raises assert
through their own message prefixes** (`'MT5SRC-03 (1a): …'`, `'FLIPRETRY-02: …'`) and are
structurally unreachable by the runner.

Three options were measured and put to the founder. **Option (c) was chosen:** scope this phase to
the **39 idiom files the pg-lane can reach** (of 44 — 4 lane-blocked plus 1 `pending:`, SCOPE
AMENDMENT #2 as corrected 2026-09-04, founder 2026-09-03, `[REDUNDER-PGCRON]`), and have the runner
**PRINT the 27 excluded files BY NAME on every
run** so the gap is emitted by the gate itself rather than asserted in a ledger. Rejected: **(a)** renaming
the 27 files into the idiom — not an assertion edit (nothing external reads those strings; the
sentinel gate counts `RAISE EXCEPTION` lines at `ci.yml:2360` and `sql-tests` uses `ON_ERROR_STOP`)
but genuine *authoring*, since the 321 no-idiom raises carry only **139 distinct prefixes** (`B5b:`
heads 28) so identities must be INVENTED, not transformed; **(b)** generalising the runner's
identity grammar to a declared per-file prefix — the literal is spelled in ~150 places, it weakens
primitives 3a/3b that Phase 164.3.1 just closed, and it buys no precision because prefixes are
SHARED across arms.

⚠️ **Why this is not the v1.17 trap.** The v1.17 refusal was of a reduction that would have left
every ledger reading "usable end-to-end" while untrue. Here the exclusion is PRINTED by the gate on
every run, so no ledger can drift from what is measured. The successor rename is booked in
`TODOS.md` as `[REDUNDER-NONIDIOM]`.

⚖️ **SCOPE AMENDMENT #2 — founder decision 2026-09-03, criterion 1 NARROWED AGAIN (count, not
standard).** Of the 44 idiom files, **4 probe `pg_extension` for pg_cron** and the pg-lane
(`scripts/pg-lane/run.sh`) has none — the founder decided on 2026-09-03 NOT to install it there.
MEASURED at HEAD, and this corrects the record: `test_reconcile_dropped_enqueue_sweep.sql:268` (39
sections) and `test_retention_orphaned_running.sql:212` (25) **RAISE EXCEPTION** on the absent
extension, so their lane baseline can never be GREEN and the runner judges no arm in a red-baseline
file; `test_strategy_analytics_stuck_computing_reaper.sql:282/326/483` (29) and
`test_derive_allocator_keys_fanout.sql:159/169` (7) baseline **GREEN** but withhold whole Parts
behind a pg_cron-conditional `RAISE NOTICE`, so those arms are un-falsifiable on the lane. (The
earlier record said all of them RAISE; two do not.) CONTEXT's batch rule — *each plan lands its
files FULLY proven, no file left half-annotated* — defers all four together: **40 files / 255
sections are reachable; 100 sections are owed to `[REDUNDER-PGCRON]`.** ⛔ That 40 / 255 is
SUPERSEDED — see the ARITHMETIC CORRECTION below; the paragraph stays as the dated record of the
amendment itself.

This is criterion 4 applied, not criterion 4 waived. The runner DERIVES the four from the corpus
and prints them every run as `lane-blocked: 4 file(s) … (deferred 2026-09-03, TODOS
[REDUNDER-PGCRON])`, `sql-mutation` MEASURE_FAILs when that line is absent or when its count
disagrees with the names beside it, and — because "the pg-lane cannot host pg_cron" is a claim about
the LANE that no derivation measures — **every lane-spawning run probes the lane itself** and exits
1 with `lane-blocked-stale` the day pg_cron is available while the class is non-empty. The deferral
can therefore expire; it cannot outlive its cause. (Plan 164.4-03.)

⚖️ **SCOPE AMENDMENT #2 — ARITHMETIC CORRECTION, 2026-09-04 (plan 164.4-11).** #2's count was
**40 files / 255 sections reachable**. MEASURED at the phase's end state, it is **39 files / 252
sections / 262 twins**. Its STANDARD is unchanged and no new decision is taken here: this records
the arithmetic consequence of a founder decision already made in plan 09. A FIFTH idiom file,
`test_compute_jobs_error_kind_copy_parity.sql`, is equally un-baselineable without pg_cron — its
blocker is migration `20260826140000` in its APPLY LIST rather than its own text, so
`gateNeedsPgCron` cannot see it and the runner prints it under `pending:` instead of
`lane-blocked:` (TODOS `[REDUNDER-LANEBLOCKED-BLIND]`). The founder chose to retire
`[REDUNDER-PGCRON]` by putting pg_cron ON the lane as its own phase (164.4.1 PGCRON-LANE) rather
than work around it, so that file is owed there too. ⛔ The runner's `pending:` line therefore
names exactly ONE file at the end of this phase and must NOT be read — or made — empty;
`src/__tests__/mutation-annotation-parser.test.ts` pins it as a one-name SET for that reason.
Measured 2026-09-04: `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, 0 waivers, exit 0.

⚠️ **The arm unit is the SECTION** (founder decision 2026-09-02): one `RED-UNDER-M` per NAMED
assertion group (`"arm":"NAME"`), NOT one per raise. Under option (c) as amended that is
**252 sections / 262 twins** across the 39 reachable idiom files (MEASURED at the phase's end
state 2026-09-04; the projection was 255 / ~265 over 40 files); the 100 sections in the 4
lane-blocked files, plus the sections of the 5th `pending:` file, are owed to `[REDUNDER-PGCRON]`
(SCOPE AMENDMENT #2 as corrected 2026-09-04). The identity unit would
have been 516 and would have pushed CI past the 20-minute split threshold.

⚠️ **The reference file does NOT meet criterion 1 today.** `test_strategy_shares_rls.sql` is one
2,602-line `DO $$` block holding 103 identities in **35 sections with only 30 twins — 15 sections
have no twin.** The "1 file fully annotated" baseline was never true. Closing those 15 is part of
this phase, not a precondition of it.

**Success Criteria** (what must be TRUE):

  1. **Every arm in the 39 REACHABLE idiom files carries a `RED-UNDER`** naming the exact mutation
     that makes it fail — arm = section, per the amendments above. The 27 non-idiom files are OUT of
     scope, the 4 lane-blocked files are DEFERRED and a 5th is printed under `pending:` (SCOPE
     AMENDMENT #2, 2026-09-03, as corrected 2026-09-04, `[REDUNDER-PGCRON]`); **the runner names ALL
     THREE sets in its output every run**;
     a silent exclusion fails this criterion just as a missing annotation does.
  2. **The 164.3 runner executes ALL of them** — each demonstrated RED under its own mutation and
     GREEN when restored. An annotation that never reddens its arm is a FAILURE, not a pass.

  3. **The coverage figure is CI output and floor-ratcheted.** A runner reporting PASS while covering
     a fraction of the corpus is the same shape as a gate that SKIPs forever and reads as PASS —
     which is on 164.3's own defect list. No silent caps: the number is printed every run.

  4. ⛔ **Any arm that cannot be given a falsifying mutation is RECORDED with its reason, never
     silently skipped.** An arm nobody can make fail is the finding, not an exception.

**Explicitly OUT of scope:** writing new gate coverage. This phase annotates and proves what already
exists; it does not add arms. New coverage is a different phase with a different risk profile.

**Plans:** 12/12 plans executed (REPLANNED 2026-09-03 after the Plan 00 spike: four pg_cron files DEFERRED by founder decision — see `[REDUNDER-PGCRON]`; end state on today's lane is **39** of 44 idiom files annotated + 4 printed as `lane-blocked:`, the 40th having been deferred to Phase 164.4.1 in plan 09)

Plans:

- [x] 164.4-00-PLAN.md — Fixture-strategy spike: stand-ins vs stubbed real chain decided BY MEASUREMENT (timeboxed to 8 stub iterations, 4.0 s/lane rule); largest file's apply list proven GREEN; F1 residual closed
- [x] 164.4-01-PLAN.md — Wave 0 runner/CI: `unreachable:` line naming the 27 excluded files, per-file `judged/annotated/waived/biting` breakdown, ci.yml MEASURE_FAIL assertions, GREEN/RED log fixtures, parse-time refusal of fixture targets with red self-test fixture (arm unit = SECTION, 355 sections / ~365 twins stated on the record)
- [x] 164.4-02-PLAN.md — Reference file: the 15 un-twinned sections of test_strategy_shares_rls.sql; ARMS_FLOOR 30 → measured (≈45); full lockstep-pin choreography rehearsed
- [x] 164.4-03-PLAN.md — Runner: DERIVED `lane-blocked:` line naming the 4 deferred pg_cron files (reconcile 39, reaper 29, retention 25, derive 7 = 100 sections) with reason + TODO id every run, CI MEASURE_FAIL + exact-set pin; `[REDUNDER-PGCRON]` mechanism corrected per file; floors unchanged
- [x] 164.4-04-PLAN.md — Batch 1: the three ledger_refresh gates (15 + 15 + 11 = 41) starting from Plan 00's PROVEN apply list; FILES_FLOOR 1 → 4, ARMS_FLOOR → ≈86
- [x] 164.4-05-PLAN.md — Batch 2: wizard_composite_members, capital_ownership_allocation_guard, create_wizard_strategy_for_key, scenario_shares_rls, strategy_keys_rls (48); FILES_FLOOR → 9, ARMS_FLOOR → ≈134
- [x] 164.4-06-PLAN.md — Batch 3: strategies_private_owner_isolation, api_keys_venue_identity_uniq, capital_ownership_column, csv_daily_returns_perkey_rls (29); FILES_FLOOR → 13, ARMS_FLOOR → ≈163
- [x] 164.4-07-PLAN.md — Batch 4: csv_finalize_atomic_fold, funding_fees_rls, allocator_equity_derived_rls, user_notes_dashboard_scope (26; derive_allocator_keys_fanout deferred); FILES_FLOOR → 17, ARMS_FLOOR → ≈189
- [x] 164.4-08-PLAN.md — Batch 5: six five-section files (30); FILES_FLOOR → 23, ARMS_FLOOR → ≈219; sql-mutation timeout re-justified from measured ubuntu wall clocks
- [x] 164.4-09-PLAN.md — Batch 6: six files (23); FILES_FLOOR → 29, ARMS_FLOOR → ≈242
- [x] 164.4-10-PLAN.md — Batch 7: the last four non-mixed files (8); FILES_FLOOR → **32**, ARMS_FLOOR → **247** (MEASURED 2026-09-04, exit 0, `arms: 247/247/0`, 0 waivers); `pending:` names **8** files — the 7 mixed ones plus test_compute_jobs_error_kind_copy_parity.sql, deferred to Phase 164.4.1. ⚠️ The 33 / ≈250 / 7 this row used to project came from an assumed six-file wave 10 that landed five. ✅ LANDED PR #742 → `75e58cb1` (v0.77.11.0), **23/23 SHA-bound green** at head `4591b17d`, `sql-mutation` run 33882082307 **464 s** on ubuntu. ⏱️ That wall clock confirms the LEGS model and not the arms model: 247 arms but 311 legs (247 + 32 baseline + 32 restore), so ≈334 s of lane time at ≈1.07 s/leg plus ≈130 s job overhead. Projected phase end — 262 arms / 340 legs ≈ **470 s ≈ 7.8 min**, inside `timeout-minutes: 15`. Plan 11 owes ci.yml the corrected formula (legs, not arms).
- [x] 164.4-11-PLAN.md — Batch 8: the seven ⚠️ mixed files (15), waivers only via founder checkpoint; end state FILES_FLOOR **39**, ARMS_FLOOR **262** (MEASURED 2026-09-04, exit 0, `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, tallies agree, **0 waivers** — cumulative 0 across all eight arms moves), `pending: 1` naming exactly test_compute_jobs_error_kind_copy_parity.sql, 27 non-idiom + 4 lane-blocked files printed by name, final prose sweep done. ⚠️ 39 / 262 / 1, NOT the 40 / ≈265 / 0 of SCOPE AMENDMENT #2 — that predates plan 09's founder-decided pg_cron deferral, and the amendment is now corrected in ROADMAP+STATE. ci.yml's timeout projection re-derived on a LEGS model (arms + 2 × files); `timeout-minutes` stays 15. ✅ LANDED PR #743 → `3ed6919e` (v0.77.12.0), **24/24 SHA-bound green** at head `e0d05068` (`frontend`, `secret-scan`, `sql-mutation`, `sql-gate-lint`, `plan-anchor-verify` all success). Merged 2026-09-04T19:50:39Z via `/land-and-deploy`.

### Phase 164.4.1: PGCRON-LANE — put pg_cron on the throwaway pg-lane and retire the REDUNDER-PGCRON deferral (INSERTED)

**Goal:** The pg-lane can host pg_cron, so the `[REDUNDER-PGCRON]` deferral is RETIRED
rather than grown — five gate files and ~100 sections become provable, and the runner's
`lane-blocked:` class goes to 0.

**Requirements**: SC-1, SC-2, SC-3, SC-4, SC-5 — the five success criteria below stand in for requirement IDs (no `REQUIREMENTS.md` IDs exist for this inserted phase, same convention as 164.4). Planned 2026-09-04 (`164.4.1-CONTEXT.md`, `164.4.1-RESEARCH.md`, `164.4.1-PATTERNS.md`).
**Depends on:** Phase 164.4 (must COMPLETE first — 164.4's floors ratchet sequentially
across its remaining waves, and pg_cron changes lane startup cost for EVERY arm)
**Mode:** RESEARCH-FIRST
**Plans:** 6/6 plans executed

### Why this is a phase and not a plan inside 164.4

Phase 164.4 **SCOPE AMENDMENT #2** (founder) deferred 4 idiom gate files / 100 sections
because `scripts/pg-lane/run.sh` spins throwaway PostgreSQL clusters that cannot host
pg_cron: `test_derive_allocator_keys_fanout.sql`, `test_reconcile_dropped_enqueue_sweep.sql`,
`test_retention_orphaned_running.sql`, `test_strategy_analytics_stuck_computing_reaper.sql`.

Wave 10 then hit a **FIFTH** file blocked by the same substrate for a different reason.
`test_compute_jobs_error_kind_copy_parity.sql` can only be baselined with migration
`20260826140000` — the sole migration widening `compute_jobs_error_kind_check` to admit
`'orphaned'` — and that migration **hard-RAISEs `0A000` at lines 206-208** when
`pg_extension` has no pg_cron. Founder decision 2026-09-04: retire the deferral, do not
grow it.

Retiring a recorded founder scope amendment is a phase-level act, not a plan-level one;
adding it to 164.4 would silently reverse an amendment that is true as written. It also
needs its own research (below) and perturbs a timing model that was only just stabilised.

### Success criteria

1. The pg-lane loads pg_cron on **BOTH** macOS (authoring box, PostgreSQL 16.13) and
   ubuntu CI. If the two disagree, the CI job and the authoring box measure different
   corpora — which is the failure this whole phase family exists to prevent.
2. The 5 unblocked gate files are annotated and machine-proven; `FILES_FLOOR` and
   `ARMS_FLOOR` ratchet to the MEASURED values.
3. `lane-blocked:` reaches **0**, and the runner's `lane-blocked-stale` tripwire is
   EXERCISED, not merely left green. That probe MEASURE_FAILs when pg_cron is AVAILABLE
   while files remain classified — so making pg_cron available is exactly the condition
   that must be shown to fire and then be cleared.
4. `[REDUNDER-LANEBLOCKED-BLIND]` is closed deliberately. `gateNeedsPgCron`
   (`scripts/mutation-runner/parse.mjs:1043`) reads a gate file's executable text and is
   blind to its `RED-UNDER-SETUP` apply list. The defect stops MATTERING once nothing is
   lane-blocked, but the classifier is still wrong; its tripwire test must be resolved on
   purpose rather than allowed to lapse.
5. The lane stays a throwaway cluster under a scratch `--workdir`. ⛔ It must NEVER point
   at a Supabase database.

### Research first (do not plan from assumption)

- pg_cron requires `shared_preload_libraries`, which requires a cluster restart, and the
  extension must match the server major version. Availability differs between the macOS
  box and `ubuntu-latest`.
- **Measure per-lane cost before and after.** The timing model was only just stabilised at
  `mean 1.0s/lane` (ubuntu run 33854344121: 219 arms in 333 s). Every arm pays lane
  startup, so any preload cost multiplies across ~265+ arms against `timeout-minutes: 15`.
- If the measured cost is prohibitive, the fallback is a pg_cron **SHIM** providing only
  the `cron` schema and the catalog rows these five gates actually probe. Decide that from
  measurement, not assumption.

Plans:

- [x] 164.4.1-01-PLAN.md — Substrate: pg_cron preloaded on the lane's single `pg_ctl -o` start (+ `cron.max_running_jobs=0`), fail-loud when absent, scripted macOS build, ubuntu apt provisioning step, `--self-test` 6/6, and the `lane-blocked-stale` tripwire OBSERVED firing on the real corpus (committed log)
- [x] 164.4.1-02-PLAN.md — File move 1: `test_compute_jobs_error_kind_copy_parity.sql` (3) + `test_derive_allocator_keys_fanout.sql` (7) annotated and proven; floors ratcheted to the printed values; the one-name `pending:` pin re-measured as its own task
- [x] 164.4.1-03-PLAN.md — File move 2: `test_retention_orphaned_running.sql` (25); floors; lane-blocked pinned at 2
- [x] 164.4.1-04-PLAN.md — File move 3: `test_strategy_analytics_stuck_computing_reaper.sql` (29, NOTICE-skip shape — zero skip lines measured); floors; lane-blocked pinned at 1
- [x] 164.4.1-05-PLAN.md — File move 4: `test_reconcile_dropped_enqueue_sweep.sql` (39); `lane-blocked: 0`, tripwire CLEARED (full run exit 0 with probe AVAILABLE); end-state floors; empty sets pinned with AIMs
- [x] 164.4.1-06-PLAN.md — Closure: `[REDUNDER-LANEBLOCKED-BLIND]` closed deliberately (text-only classifier documented + calibrated), honest runner prints, ubuntu measurement via `workflow_dispatch` (apt source, version, wall clock), ci.yml DECISION block updated by the MEASURED rule, docs currency

✅ **PHASE COMPLETE 2026-09-05.** End state MEASURED on BOTH platforms, identically:
`coverage: files 44/71`, `arms: 361/361/0`, `biting: 361`, `lane-invocations: 361`
(the two independent tallies agree), `pending: 0`, `lane-blocked: 0`,
`lane-probe: pg_cron AVAILABLE`, `No defects`, exit 0. `FILES_FLOOR` 44, `ARMS_FLOOR` 361,
`WAIVED_CEILING` **0** with ZERO waivers corpus-wide — the record survived four separate
opportunities to break it. ubuntu proof: run **33973362161** @ `ab0d5644`, `sql-mutation`
success in 646 s, `PGBIN the lane will boot: /usr/lib/postgresql/16/bin`, pg_cron 1.6.2-1 from
noble/universe. Verification: PARTIAL -> PASS once SC-1 was re-measured at the shipping tree
(`164.4.1-VERIFICATION.md`).

⚠️ **THE SECTION COUNTS IN THE PLAN ROWS ABOVE ARE THE AS-PLANNED FIGURES AND ARE NOW WRONG.**
Measured at close: plan 03's file is **24** sections (not 25), plan 04's **28** (not 29), plan 05's
**37** (not 39). The rows stay as dated lineage. Three arms were RECLASSIFIED — their
`TEST FAILED (` identity removed, kept as named INVARIANTs — after being MEASURED to have no
first-failure mutation, and two more had gate-self twins replaced by production ones. None was
waived. `ARMS_FLOOR` therefore moved DOWN twice, 363 -> 361, because those arms were never
proven against a production regression.

⚠️ **`test_reconcile_dropped_enqueue_sweep.sql` is the most contested file in the phase** — its
twins were revised in THREE successive review rounds, each finding real defects in the previous
round's work (one Critical, then two more arms of the same class, then a step-count pin). Treat any
"no production mutation can reach this" sentence in a gate as UNPROVEN until a lane says otherwise;
that exact sentence was refuted three times here.

⚠️ Execution shape (planner, 2026-09-04): plans run strictly sequentially (one wave each — the floors ratchet). Between plan 01's commit and plan 05's, every full runner invocation on a pg_cron-equipped host exits 1 with exactly one defect, `lane-blocked-stale` — that IS success criterion 3's tripwire firing, each such commit carries a `TRIPWIRE-RED:` line, and the branch must not be pushed or shipped until plan 05 lands (main only receives the squash-merged PR head). `CREATE EXTENSION pg_cron` comes from the real migration `20260513094906_enable_pg_cron.sql` in each gate's apply list, never from a fixture or a lane bootstrap. Section counts above are the runner's own derivation (103 total); every floor is written from the run's printed lines, never from these numbers.

### Phase 164.1: PROD-OBSERVABILITY — one periodic prober, four targets: the analytics service-key mismatch (PYAPI-06), the async cron HTTP result (CRON-OBS-01), PROD cron-job drift (CRON-DRIFT-01) and the MT5 round-trip (MT5-WEDGE-OBS-01) — every silent production failure in scope becomes loud (INSERTED)

**Goal:** One periodic prober that fails loud on the four places production has been MEASURED broken while every instrument read green. (1) PYAPI-06, BOTH halves: `src/lib/analytics-client.ts:466` omits the service-key header silently when the env var is absent, and `analytics-service/main.py:825` discards the absent-header case instead of rejecting it — a production key mismatch ran with every guarded route refusing and nothing alarming. (2) CRON-OBS-01: `net.http_post` is ASYNC, so `cron.job_run_details` reads `succeeded` for ENQUEUING; PROD jobid 1 returned 401 hourly for 7 days behind a green history. The result lives in `net._http_response` and nothing reads it. (3) CRON-DRIFT-01: nothing compares PROD `cron.job` against the repo; the oracle must be what is ACHIEVABLE on Supabase (Vault), not the `20260408215026` GUC design, which returns 42501 and could never have run here. (4) MT5-WEDGE-OBS-01: a probe that round-trips MT5 (not a port check, not `/health`) and distinguishes `-10004` (bridge not attached) from `-10005` (bridge attached, terminal not answering — the modal-dialog wedge that survives redeploys via the persistent volume). One mechanism, four targets; plan it as one prober, not four slices. A probe that SKIPs on an absent credential is the defect, not the fix.

⛔ RE-PARTITION 2026-09-05 (founder-selected, `.planning/164-FAMILY-REPARTITION.md`): this phase LOST its gate-hygiene half. Frozen-spine gate retirement is DROPPED (the 164-02 `/scenario/i` narrowing is the done slice). The advisory-lock concurrency test → **164.5 BASELINE-SNAPSHOT** (it is VAC-07's spec on the new lane). Composite-stamp twin (TS half), OPS-08-TS, OPS-08-F2, OPS-08-F8, OPS-08-F9, PROC-02, PROC-03 residual, H-0001 residual → **164.6 GATE-HYGIENE**. 161-ERRPREFIX → **164.2 CURATED-COPY** (it is a sentence a user reads). PROC-01 and PII-01 are closed/decided and leave the roadmap. SKIP-01, DRIFT-01 were 164.3's and shipped there. The DEDUP tables and carried-in item statements below are retained as dated lineage; the owner column above supersedes them where they disagree.

**Success Criteria**:

1. ONE prober covers all four targets and exits NON-ZERO on: a missing or mismatched analytics service key (PYAPI-06), a non-2xx row in `net._http_response` for a pg_cron-issued request (CRON-OBS-01), PROD `cron.job` drift from the repo's achievable configuration (CRON-DRIFT-01), and MT5 `-10004` or `-10005` (MT5-WEDGE-OBS-01). Proven PER ARM by removing that arm's credential or injecting that arm's fault and observing the non-zero exit — never a SKIP. A SKIP on an absent credential fails the criterion.
2. PYAPI-06 is closed at BOTH halves, each with a test that fails when its guard is removed: `analytics-client.ts` refuses to send a guarded request without the header (loud, not silent omission), and `main.py` rejects an absent header with a code distinct from a wrong header.
3. The MT5 arm reports `-10004` and `-10005` as DIFFERENT failures with different remedies, tested per state. An arm that reports them as one failure has not met this.
4. CRON-DRIFT-01's oracle is what is achievable on Supabase (Vault-backed `cron.job` command), not the 42501 GUC design; drift fails loud; the comparison is recorded so the next reader knows which side moved.
5. No item that was listed in this phase before 2026-09-05 is silently dropped: each is either closed here with measured evidence or named in the re-partition block above with its new owning phase (164.2 / 164.5 / 164.6) or its DROPPED reason.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries PYAPI-06, CRON-OBS-01, CRON-DRIFT-01, MT5-WEDGE-OBS-01 — read each entry before planning, do not re-derive
**Depends on:** Phase 164, and now **Phase 164.3** (see DEDUP below — 164.3 builds the substrate this phase's gate work is tested on)
**Plans:** 5/6 plans executed

⛔ **DEDUP 2026-08-28 — five carry-overs LEFT this phase, three MOVED to 164.2, one DECIDED inline.**
Founder-approved. Before this, ten items were listed here and five of them were ALSO claimed by
164.3's success criteria — the second such overlap in this phase group (the 164.1↔164.2 one is
flagged below). An item claimed by two phases gets built twice or by neither.

| Carry-over | Now owned by | Why |
|---|---|---|
| SKIP-01, DRIFT-01 | **164.3** | 164.3's own thesis names both in its "drift half", and its criterion 2 (throwaway-PostgreSQL lane, `PROC-01`) removes the pre-apply state and the older mirror at the root. |
| OPS-08-F9, OPS-08-F8 | **164.3** | Criterion 1's mutation runner walks every `RED-UNDER` arm in `supabase/tests/*.sql`; a sentinel-free file and a first-failure-truncated loop are the same defect it exists to catch. |
| H-0001 | **164.3** | A coverage gate blind to an idiom IS one of the five measured vacuity shapes (criterion 3). |
| WR-06-UTC, HONEST-08-RESIDUAL | **164.2** | Both are user-facing rendered truth, which is 164.2 CURATED-COPY's subject, not gate integrity. |
| WIZFORM-02 (`code: UNKNOWN`) | **164.2** | Same reason — a failure sentence the user reads. |
| PII-01 | **decided inline** | `13-REVIEWS/` deleted forward; history retains them and that limit is recorded. No build work, so it needs no phase. |

⛔ **SKIP-01 shape ruled 2026-08-28: NOT option (a).** TODOS offers (a) apply `supabase/migrations/**`
to TEST in CI or (b) expire the pre-apply SKIP. (a) was recommended and is **WITHDRAWN**: it changes
what `sql-tests` may do to a shared database that has no worker and is already contended, and 164.3's
disposable per-run cluster replaces that machinery anyway. Building (a) first means building it twice
and taking shared-database risk in between.

⭐ **ADDED 2026-09-01 — two production-observability blind spots, both measured live.** Routed
here rather than to 164.3/164.3.1 on purpose: those own **gate integrity** (a control that cannot
fail), these are **production observability** (a service that is down while every instrument reads
green). This phase already owns that class — its title names the PYAPI-06 blind spot that let a
production service-key mismatch run silently. Full statement, measurement, and root cause for each
live in root `TODOS.md`; read the entry before planning, do not re-derive.

- ⛔ **[CRON-OBS-01] Nothing watches `net._http_response`.** `net.http_post` is ASYNC, so pg_cron
  logs `succeeded` for ENQUEUING and never sees the status code. Measured live: PROD jobid 1
  returned **401 hourly for 7 days** (ids 3479-3484) behind a green `cron.job_run_details`. Every
  other alarm is structurally blind — `/health` skips `SERVICE_KEY`, and a 4xx never trips the
  140.2 breaker. Needs a periodic check that fails loud on non-2xx, counted and surfaced.
  ⚠️ Ships with **CRON-DRIFT-01** (nothing compares PROD `cron.job` against the repo's
  migrations — `VAC-04`'s shape applied to `cron.job`, which has no equivalent). ⛔ The GUC design
  in `20260408215026` is UNRUNNABLE on Supabase at all (`ALTER DATABASE … SET` on a custom
  placeholder GUC needs superuser, returns 42501), so any gate must compare against what is
  ACHIEVABLE, not what the migration says. Vault is the working mechanism.

- ⛔ **[MT5-WEDGE-OBS-01] Nothing probes MT5.** A user-facing key-connect outage ran with Railway
  reporting the service healthy, `/health` green (it never touches MT5), and the gateway logging
  `accepted … welcome … goodbye` with no ERROR line. The only instrument was a human clicking
  connect, and it told them `KEY_NETWORK_TIMEOUT` — "your broker is slow". Needs a probe that
  actually round-trips MT5 (not a port check, not `/health`) and fails loud on `-10005`/`-10004`.
  ⚠️ Root cause 2026-09-01 was a **modal login dialog** blocking `terminal64.exe`'s message loop;
  it survives redeploys because the Wine prefix is on a persistent volume. The probe must therefore
  distinguish "bridge not attached" from "bridge attached, terminal not answering" — the two states
  have different remedies and `-10005` alone identifies neither.

⭐ **These two are ONE mechanism with two targets** — a periodic prober that fails loud — and should
be planned as such, not as two unrelated slices.

⚠️ **Both inherit this phase's anti-silent-skip discipline (`SKIP-01`'s):** a probe that SKIPs when
its credential is absent is the defect, not the fix. Absent credential must go loud.

**Cross-phase note from Phase 164 planning (2026-08-26):** the phase-29 frozen-spine migration
guard's `FORBIDDEN_MIGRATION_RE` is narrowed IN PHASE 164 (plan 164-02, founder ruling) from the
two-alternative substring to `/scenario/i` — the guard's own locked set (`scenario_shares`,
`get_shared_scenario`, `create_scenario_share`) all match it, and the second alternative
false-positived on `strategy_shares`. When 164.1 retires frozen-spine gates, treat that narrowing
as the already-done 164 slice — do not edit the same guard a second time with a second rationale.

**Carried in from Phase 163 (routed 2026-08-26).** Each item's full statement, measurement, and
the reason it was NOT fixed in 163 live in root `TODOS.md` — the single source of truth. Do not
re-derive them here; read the entry before planning.

- ⛔ **[SKIP-01] Nothing applies migrations to TEST, so the OPS-08 SQL gate SKIPs permanently.**
  Measured live 2026-08-26: `supabase-migrate.yml` targets the PROD ref only; `sql-tests` has no
  migration-apply step; TEST therefore sits in the gate's *true pre-apply* state (pre-fix body,
  no marker comment) — the one state the gate deliberately waves through. **The de-stricted body
  live on PROD is executed by no test, anywhere.** Fix (a) apply migrations to TEST before
  `sql-tests` — this closes **DRIFT-01** too, same root cause — or (b) make the pre-apply arm
  expire so a permanent SKIP goes loud. ⚠️ (a) touches a shared, contended, worker-less database;
  not a one-line CI edit. ⚠️ Generalises: ANY migration self-check that tolerates pre-apply is
  permanently silent on TEST.

- **[OPS-08-TS]** The SQL half of OPS-08 raises `serialization_failure` (40001); nothing in `src/`
  branches on it. Measured at HEAD 2026-08-26: zero non-test hits. A lost race still answers a
  blanket 500. Fix: retry once at the enqueue call sites (allocator holdings sync, csv-finalize).

- **[OPS-08-F2]** Both pg_cron fan-out paths catch `WHEN OTHERS` around the enqueue and report
  success, so a tick UNDER-COUNTS silently. Pre-existing. Fix: surface a non-zero failure count.

- **[OPS-08-F9]** `test_enqueue_internal_destrict.sql` has no `ALL N ARMS EXECUTED` sentinel — any
  arm can be neutered and the file still exits 0. ⚠️ Not free-standing: needs `SENTINEL_FLOOR`
  7→8 and `ARMS_FLOOR` 63→68 in `ci.yml` plus the derivation entry in
  `ci-anti-skip-gate.contract.test.ts`, in ONE diff.

- **[OPS-08-F8]** The `sql-tests` loop exits on first failure, so one expected-red file suppresses
  ~40 of ~70 others. Fix: aggregate failures, or make expected-red a per-file declaration.

- **[WR-06-UTC]** `series_end` is day-granular; a row stamped with a future UTC date renders
  "ends in the future". ⛔ Must fix `bucketSeriesAge` (`src/lib/freshness.ts`) and `bucketByAge`
  (`FactsheetView.tsx`) in ONE commit — half-fixing manufactures a new two-surface contradiction.
  ⚠️ The VIEWER's timezone is irrelevant (both sides are absolute instants); the offset enters on
  the write side. LATENT on PROD — census 2026-08-26: 20 strategies with a series, **0**
  future-dated. The regression test must SEED the future-dated row; a browser sweep proves nothing.

- **[DRIFT-01]** TEST runs an **older revision** of `_enqueue_compute_job_internal` (corrected
  2026-08-26 — not a comment-stripped copy: PROD stripped = 3172 chars vs TEST raw = 3093), so no
  CI run exercises the migration gate's comment-strip. Root cause is now known: TEST is
  `db push`-ed, with duplicate applications in its ledger. Subsumed by **SKIP-01** fix (a).

- **[H-0001]** `findMutations`' single-line `from(...).insert(...)` regex is blind at **6** known
  call sites (re-measured 2026-08-26 — the count grew, it was not just stale line numbers). Fix
  the detection, un-skip the intended-behavior test in `audit-coverage.test.ts`, re-run the census.

- **[161-ERRPREFIX]** (founder ruling 2026-08-26) `KeyPermissionBadge.tsx:140` renders
  `err.code ? `${err.code}: ${message}` : message`, so a founder with a broken key reads
  `KEY_UNDECRYPTABLE: This stored key can no longer be decrypted…`. RULED: **split** — prose to the
  user, structured code to the log and Sentry breadcrumb. ⚠️ CLASS change: the same site emits other
  codes (PROBE_BACKEND_UNAVAILABLE…), so branch the class, not the one string. The prefix was
  deliberate (comment at :137-138, support-ticket greppability) — preserve that property in the logs.

- **[HONEST-08-RESIDUAL]** The shipped staler-of-two badge is verified live on PROD, but both
  visible rows bind to the series arm, so "correct staler-of-two" and "always binds to series"
  are not yet distinguished. `FreshnessChip`'s own comment warns over-binding would delete the
  sync copy everywhere. Prove the sync arm still renders, using a published row with a fresh
  series (one exists — newest series end is 1 day old — but not on the `crypto-sma` cohort).

- **[PII-01]** Decide whether the `13-REVIEWS/` AI-review payload artifacts stay tracked (5
  occurrences of a personal address, public repo, no ongoing consumer). Deleting forward does not
  remove them from history — that limit is deliberate and stands. If kept, record the decision.

**Carried in from Phase 164's red-team (routed 2026-08-27).** Six red teams plus a synthesizer
found that ~13 of 17 items in the 164 corpus were **caused by the workflow, not by the domain**
(`SYNTHESIS.md` §7). The founder adopted three of the eight proposed process changes and declined
the fourth (a `gsd-plan-checker.md:752` change — upstream gsd-core, not ours to fork). These are
the adopted three. They are **process standards, not features**: each one is a gate that would have
caught defects this phase spent 39 commits and three fix rounds failing to close.

- ⭐ **[PROC-01] A runnable throwaway PostgreSQL instance BEFORE authoring, and its run output in
  the plan.** Root cause of every `[M]`-severity finding in the corpus (R1, R2a, R2b, R2b′, R3, N1,
  N2). A 456-line migration and a 536-line SQL gate were authored, committed, declared done, and
  reviewed by three specialists with **zero executions** — the executor's own words were "NOT RUN
  — no local psql run was attempted", and the plan's `<automated>` block was English prose. Every
  one of those seven defects was later found on an ad-hoc cluster that exists in no plan, no skill
  and no CI lane. Fix: an `initdb`/docker script plus one CI lane, and a PLAN rule that a migration
  task's `<automated>` block must be a **command**, not a sentence. ⛔ Do not conflate with
  **SKIP-01** — that is about applying migrations to TEST; this is about executing them *anywhere*
  before review. Both are needed; neither substitutes for the other.

- ⭐ **[PROC-02] Reviewers must declare execution status, and UNEXECUTED blocks.** `gsd-code-reviewer`
  is read-only **by construction**, and nothing in the loop ever said so out loud — so three clean
  reviews of a never-executed migration read exactly like three clean reviews of a tested one. This
  is the cheapest item in the corpus (one agent-prompt field) and it is what would have surfaced
  PROC-01 at review time instead of at red-team time.

- **[PROC-03] Per-arm `RED-UNDER` annotation in SQL gate files.** Every assertion arm states, inline,
  the single mutation that makes it fail. Already applied by hand across
  `test_strategy_shares_rls.sql`'s 101 arms during 164's fix rounds — this routes the *convention*
  so the next gate file is born with it. Directly serves the founder rule that **a test that cannot
  fail is worse than none**: two structurally-unfailable arms were found and deleted in 164 (a
  post-rejection mutation probe inside a PL/pgSQL `BEGIN…EXCEPTION` implicit subtransaction, and a
  `pg_get_functiondef` regex satisfiable by an in-body `--` comment).

⚠️ **Explicitly NOT adopted** (founder, 2026-08-26): the "paths not facts" change to
`gsd-plan-checker.md:752`, and Team 6's remedy #9 (redesign `strategy_shares` as an insert-only
generations table with the current state as a view). #9 would close R1/R2a/R2b/R3/N2 *by
construction* and is recorded as the better design — it was declined on cost, and because the
per-row nonce buys ~90% of its benefit today on an empty table. If this table is ever redesigned,
start from `SYNTHESIS.md` §6 remedy 2.

Plans:

- [x] 164.1-01-PLAN.md — TRACER: prober skeleton (run.mjs + seams.mjs), ARMS_FLOOR=4, credential-absent gate, absurdity floor, PYAPI-06 arm, --self-test 13/13 (wave 1)
- [x] 164.1-02-PLAN.md — PYAPI-06 both halves: SeamConfigError before the fetch (TS) + SERVICE_KEY_ABSENT 401 (Python), vocabulary disposition, neuter→RED→restore proofs (wave 1)
- [x] 164.1-03-PLAN.md — CRON-OBS-01 + CRON-DRIFT-01 arms: psql seam, net._http_response time-window join, committed-manifest compare with both readings, --capture-manifest, --self-test 32/32 (wave 2)
- [x] 164.1-04-PLAN.md — MT5-WEDGE-OBS-01 arm: railway ssh seam, committed read-only probe, -10004 ≠ -10005 with distinct remedies, floor met at 4/4, --self-test 42/42 (wave 3)
- [x] 164.1-05-PLAN.md — prod-prober.yml (hourly, own workflow, hard-fail credentials, self-test-then-live, pinned Railway CLI, dedup'd issue, capture-manifest mode) + vitest wiring pin (wave 4)
- [ ] 164.1-06-PLAN.md — SHA-bound dispatches: capture + commit the PROD cron manifest, live four-arm read, D-20/D-18 measurements, TODOS closure, criterion-5 ledger, founder posture decision (wave 5, checkpoints)

### Phase 164.2: CURATED-COPY — the curated failure sentence must reach the user (INSERTED)

**Goal:** Every failure sentence a user reads is the true, specific one. Two mechanisms, one
thesis:

- **(a) The curated sentence survives the write.** A computation failure shows what its writer
  produced — "Insufficient CSV history. At least 2 data points required." — instead of a generic
  per-kind sentence that replaces it seconds later.

- **(b) The wizard's refusals stop misattributing.** Four copy falsehoods enumerated below name a
  cause the code never tested, or blame a party that did not cause the failure.

The status bridge (`sync_strategy_analytics_status`) overwrites `strategy_analytics.computation_error`
on BOTH branches, so D-162-4's curation reaches no user on any path where a `compute_jobs` row
transitions. Measured 2026-08-26 while closing Phase 162; it PRE-DATES v1.20 — Phase 162 did not
introduce it, and the red-team claim that 162 caused a regression here was refuted (the retired
COALESCE read `last_error`, which is non-NULL on all 103 PROD `failed_final` rows, so its left arm
always won).

⚠️ NOT soundly fixable inside SQL. The bridge cannot tell a curated sentence from a stale one
because the column carries no provenance. Needs a writer/generation marker on `computation_error`
that the Python writers set and the bridge respects. Recorded as owed work in migration
`20260826120000`'s header — deliberately, as owed, not as an accepted trade.

**Also in scope — four wizard-copy falsehoods surfaced 2026-08-26.** Same thesis (the sentence a
user reads must be true); different mechanism and different files from the SQL bridge above. Each
was found by the fixer that closed the preselect-refusal class and deliberately left open because
it lived outside that fixer's files — named, not silently dropped:

1. **`KEY_MISSING_REQUIRED_FIELD`'s title and cause stay credential-shaped on the preselect
   screen** ("One of the required fields is empty.") where there are no fields. `fixRequires`
   gates `fix[]` only, so the surface-split fix could not reach them. The real fix is at the
   emitter in `src/app/api/strategies/create-with-key/route.ts`, whose own guard comment already
   says that arm "may not wear a `KEY_*` verdict that blames a credential". Minting a new copy
   member moves `EXPECTED_TABLE_SIZE` plus three roster/coverage laws — do it deliberately.

2. **`KEY_RATE_LIMIT` blames the exchange for OUR limiter.** The 429 comes from
   `userActionLimiter`, but the copy says "The exchange asked us to slow down… exchange-side
   throttle", and `fix[1]` "try a different exchange account" cannot clear a per-USER bucket.
   Identical on the credential arm; `route.ts:891` already records it ("our outage, blamed on
   their exchange") and accepted it. This is a misattribution class with an existing owner.

3. **`DRAFT_ALREADY_EXISTS`'s cause says "with the same API key"** — false on the stale-session
   path, where the collision is on `(user_id, wizard_session_id, source)` and not the key. True
   on the TOCTOU path and on the credential arm, so the shared `cause` needs splitting, not
   replacing.

4. **The stale-`wizardSessionId` ROOT CAUSE is still open** (functional, not copy).
   `deriveWizardResumeOverrides` restores `wizardSessionId` from localStorage unconditionally on
   the API branch, so an abandoned draft over key A lends its session id to a preselect for key B
   and 23505s forever — `resolveStrategiesForKey` looks up by `api_key_id` and never finds B.
   Re-pressing Continue can never win. Fix belongs in `WizardClient`/`localStorage.ts` (mint a
   fresh session id when a preselect is supplied) or in the route (re-resolve on 23505). Phase 162
   shipped honest copy describing this dead end; it did not remove the dead end.

5. **The public "still computing" factsheet placeholder speaks to a DEVELOPER, on production, to an
   anonymous reader** (added 2026-09-05, found while re-measuring Phase 159's composite-render item
   in a real browser). MEASURED on PROD at `/factsheet/8581f739-1a7b-42a4-a209-3acfa327e259`
   (`Fibonacci Ghost`, published, uncomputed) — the anonymous page ends with the sentence
   **"See the dev-server console for the exact gate the request fell through."** There is no
   dev-server console for a production visitor and an anonymous reader has no console to open, so
   the one actionable-sounding instruction on the page is inert. The same paragraph also volunteers
   an internal gate detail ("insufficient observations inside the bundled benchmark window
   (2023-04-26 onward)") to an unauthenticated reader. Same thesis as (a) and (b): the sentence a
   user reads must be true and must be addressed to them. ⚠️ This is COPY scope only — whether
   `Fibonacci Ghost` should be published-but-uncomputed at all is a separate question and is NOT
   claimed here.

✅ **Overlap RESOLVED in the 2026-08-28 dedup — do NOT re-open at planning time:** WIZFORM-02's
`code: UNKNOWN` class and items 1–3 above are wizard error-surface work and belong to THIS phase.
164.1's title no longer claims them (amended 2026-09-03; the dedup had updated 164.1's DEDUP table
and this section's Absorbed line, but left 164.1's title and this note contradicting both).

⛔ RE-PARTITION 2026-09-05 (founder-selected, `.planning/164-FAMILY-REPARTITION.md`): **161-ERRPREFIX moves here from 164.1** — `KeyPermissionBadge.tsx:140` renders a sentence a user reads, which is this phase's subject, not gate integrity. WR-06-UTC is BOTH bucketers, not one: `src/lib/freshness.ts:207-213` has only a 5-MINUTE clock-skew allowance (not day granularity) and `FactsheetView.tsx:1108-1115` has none. The provenance column of criterion 2 is still OWED WORK — `20260826120000:907` records it and no later migration adds it. The stale-`wizardSessionId` root cause (old criterion 6) is DROPPED from scope: already satisfied, verify by reading the preselect path rather than re-planning it.

**Success Criteria**:

1. A computation failure shows the sentence its WRITER produced, on every path where a `compute_jobs` row transitions — proven by a test that performs the transition and asserts the curated sentence survives it. Inspection of the bridge is not evidence.
2. `computation_error` carries writer/generation provenance and `sync_strategy_analytics_status` respects it. A SQL-only fix is NOT accepted as closing this — the column cannot today tell a curated sentence from a stale one, and that debt is recorded as owed in migration `20260826120000`'s header.
3. WIZFORM-02 is closed by MEASUREMENT, not inspection: for every server-classified error code the wizard can surface, a test asserts the rendered surface shows THAT code and never `code: UNKNOWN`. The test must be shown to fail when the classification is neutered. Phase 153's span verification FAILED on 2026-08-13 — inspection is why this was believed closed once already.
4. No refusal blames a party that did not cause the failure. `KEY_RATE_LIMIT` stops attributing `userActionLimiter`'s 429 to the exchange, and `KEY_MISSING_REQUIRED_FIELD` stops wearing a credential-shaped title on the preselect screen where there are no fields.
5. `DRAFT_ALREADY_EXISTS`'s cause is SPLIT, not replaced — it stays true on the TOCTOU and credential arms while telling the truth on the stale-session path, where the collision is on `(user_id, wizard_session_id, source)` and not on the key.
6. 161-ERRPREFIX per the 2026-08-26 founder ruling — SPLIT: `KeyPermissionBadge.tsx:140` renders prose only to the user (no `CODE: ` prefix), while the structured `err.code` goes to the log and the Sentry breadcrumb so support-ticket greppability (the reason the prefix existed, `:137-138`) is preserved. CLASS change, not one string: the same site emits `PROBE_BACKEND_UNAVAILABLE` and others, so the branch covers every code. Proven by a rendering test that fails when the prefix returns AND a test that fails when the code stops reaching the log.
7. WR-06-UTC: BOTH bucketers — `freshness.ts` and `FactsheetView.tsx` — carry a day-granularity allowance for a future-dated `series_end`, each proven by a test that fails with the allowance removed; fixing one bucketer does not close this.
8. HONEST-08-RESIDUAL: the sync arm of the staler-of-two badge is PROVEN to still render — `FreshnessChip` shown binding to the sync copy on a published row whose series is fresh (one exists off the `crypto-sma` cohort) — so "correct staler-of-two" and "always binds to series" are distinguished by measurement, not inspection.
9. The public uncomputed-factsheet placeholder addresses the reader it actually has: no dev-only instruction (`dev-server console`) and no internal gate detail on the anonymous path, proven by a rendering test over the uncomputed branch that FAILS when the developer-facing sentence is restored. Inspection of the string is not evidence — the test must bind to the anonymous render, since that is the surface where it was measured.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries WIZFORM-02, WR-06-UTC, HONEST-08-RESIDUAL, 161-ERRPREFIX — read each entry before planning, do not re-derive
**Depends on:** Phase 164 (ordered AFTER 164.1 — no dependency between them, numeric order only)
**Absorbed from 164.1 in the 2026-08-28 dedup:** WR-06-UTC, HONEST-08-RESIDUAL, and WIZFORM-02's
`code: UNKNOWN` class — all three are sentences a user reads, which is this phase's subject.
**Plans:** 10 plans

Plans:

- [x] 164.2-01-PLAN.md — 161-ERRPREFIX split: KeyPermissionBadge renders prose, code goes to console.error + Sentry breadcrumb (wave 1)
- [x] 164.2-02-PLAN.md — WR-06-UTC one constant for both bucketers + joint two-surface test; HONEST-08-RESIDUAL FreshnessChip twin + live observation (wave 1)
- [x] 164.2-03-PLAN.md — anonymous factsheet placeholder addresses its reader; V2b test over the anonymous render (wave 1)
- [x] 164.2-04-PLAN.md — mint PRESELECT_REQUEST_INVALID + DRAFT_SESSION_COLLISION, create-with-key emitters, RATE_LIMITED on its limiter arms, five roster laws (wave 1)
- [x] 164.2-05-PLAN.md — RATE_LIMITED across the other three userActionLimiter routes + rosters; bare-upstream-status map on validate-and-encrypt (wave 2)
- [x] 164.2-06-PLAN.md — provenance columns + re-based sync_strategy_analytics_status, three-reviewer gate, human checkpoint (wave 2)
- [x] 164.2-07-PLAN.md — pg-lane gate that performs the transition through the RPC, RED-UNDER-M twins, coupled apply lists, floors, runner to No defects (wave 3)
- [x] 164.2-08-PLAN.md — Python writers stamp provenance in the same statement; AST census (wave 3)
- [x] 164.2-09-PLAN.md — WIZFORM-02 roster-driven render test over every server-classified code, observed RED under neuter (wave 3)
- [x] 164.2-10-PLAN.md — TODOS closes by citation, gate marker down, serial full-suite run (wave 4)

### Phase 164.2.1: SESSIONID-FENCE — the stale wizardSessionId root cause: a preselect for key B must never inherit an abandoned draft's idempotency token from key A (INSERTED)

**Goal:** Close the FUNCTIONAL dead end that Phase 162 shipped honest copy about but did not
remove: an abandoned wizard draft over key A lends its `wizardSessionId` to a preselect for
key B, and the resulting 23505 can never be cleared by re-pressing Continue.

⛔ **WHY THIS PHASE EXISTS AT ALL — a dropped criterion resting on a false claim.** The
2026-09-05 re-partition DROPPED this from Phase 164.2 (old criterion 6) with the instruction
"already satisfied, verify by reading the preselect path rather than re-planning it". That was
never verified. MEASURED FALSE 2026-09-06: the preselect path that would satisfy it does not
exist.

**THE MECHANISM, measured — an asymmetry inside ONE function.**
`deriveWizardResumeOverrides` (`src/lib/wizard/localStorage.ts:493`) takes
`(loaded, source, initialDraftId)` and has ZERO preselect awareness — grepping that file for
`preselect`, `apiKeyId` or `api_key_id` returns nothing, and its only call site
(`WizardClient.tsx:443`) passes no key. Inside it:

- the **session-id** restore is gated on SOURCE ONLY, with no pointer check (`:538-539`)
- the **API-branch step** restore IS pointer-gated — `initialDraftId && loaded.strategyId === initialDraftId` (`:563`)

So on a preselect for key B with an abandoned key-A draft still in localStorage, both sides are
`source: "api"`, the source gate passes, and key A's idempotency token is handed to key B's
submission. The STEP is correctly not restored (the user gets the resume banner); the TOKEN
silently carries across. `clearWizardState` fires only on submit / delete-draft / start-fresh,
so an ABANDONED draft leaves the payload intact — the file says so itself at `:519-522`.

`create-with-key` then takes 23505 on `strategies_user_wizard_session_source_uniq`, falls
through the constraint dispatch at `route.ts:1300` to the `DRAFT_ALREADY_EXISTS` 409 — "A
wizard session with this key is already in progress" — which is FALSE, the colliding row
belongs to key A. `resolveStrategiesForKey` looks up by `api_key_id` (key B) and never finds
it. The stored id is stable, so re-pressing Continue can never win.

⭐ **The file predicted this.** `localStorage.ts:524-530`: "THIS IS TRIGGER REMOVAL, NOT THE
GUARANTEE. The guarantee is the partial unique index … This line removes the one known trigger;
if a second one is ever found, the DB still holds." This IS that second trigger, and the index
holding is exactly why it presents as a permanent 23505 rather than as corruption.

**DELIVERABLE — remove the trigger, leave the index as the guarantee** (the file's own
doctrine, applied literally): persist the draft's `api_key_id` in the localStorage payload,
give `deriveWizardResumeOverrides` a fourth parameter for the incoming preselect key, and
DECLINE the session-id restore when they differ. Declining is already documented safe at
`:534-536` — `WizardClient` seeds from `newWizardSessionId()` on mount, so key B keeps its own
fresh token, which is what a distinct submission should carry anyway.

⚠️ A server-side re-resolve on 23505 is the SECOND choice, not the first: it means the server
rewriting a client-owned idempotency token, and it fixes the symptom one route at a time.
Record the reasoning if it is chosen anyway.

⛔ NOT in scope: the `DRAFT_ALREADY_EXISTS` COPY split — that is Phase 164.2's criterion 5 and
stays there. This phase removes the dead end; 164.2 makes the sentence describing it true. They
are deliberately separable and each ships alone.

**Success Criteria**:

1. A preselect for key B does NOT inherit an abandoned key-A draft's `wizardSessionId` —
   proven by a test that seeds localStorage with key A's payload, mounts the wizard with a key
   B preselect, and asserts the emitted session id is neither A's nor equal across the two.
   ⛔ INSPECTION IS NOT EVIDENCE: this exact item was declared "already satisfied" once on a
   read, and the read was wrong.
2. The test is SHOWN to fail with the fix neutered — remove the new pointer gate, observe RED,
   restore byte-identically (`shasum -a 256` before == after, never `git checkout --`). A test
   that passes with the gate removed has not closed this.
3. The SOURCE gate at `localStorage.ts:538` is NOT narrowed or removed in the process — it
   closes a DIFFERENT trigger (the cross-source api→csv carry, Phase 140.4 / SEAMRIM-03) and
   its own comment forbids reading it as permission to narrow the index. A change that fixes
   the preselect case by loosening the source case trades one dead end for another.
4. The partial unique index `strategies_user_wizard_session_source_uniq` (migration
   `20260728120000`) is UNTOUCHED. It is the guarantee, not the bug; the fix removes a trigger
   that reaches it, and a phase that "fixes" this by widening the index has removed the
   guarantee instead.
5. The existing `localStorage.test.ts` pins for the source gate still pass unmodified — if any
   must change, the change is an INVERSION with its history stated, never a deletion.

**Requirements**: TBD (no v1.20 requirement IDs) — this phase carries NO TODOS entry, because
the item was never in TODOS: it lived as Phase 164.2's old criterion 6 and was dropped from the
ROADMAP on 2026-09-05. ⚠️ Read `.planning/164-FAMILY-REPARTITION.md` and Phase 164.2's
RESEARCH.md (Open Question 2) before planning — RESEARCH is what refuted the drop, and its
verdict is the reason this phase exists.
**Depends on:** Phase 164.2 (ordering only — 164.2 owns the copy half of the same bug and
should land first so the sentence and the dead end are fixed in a legible order; no code
dependency)
**Plans:** 2/2 plans executed

Plans:

- [x] 164.2.1-01-PLAN.md — Key fence: `incomingApiKeyId` 4th param + `sessionKeyMatches` gate, `apiKeyId` payload field + validator (absent-or-null OK), wired call site, `persistPointer` explicit key arg + all 14 save sites, unit + component proofs with positive control
- [x] 164.2.1-02-PLAN.md — Neuter → RED → byte-identical restore at helper AND call site (SEAMRIM pins green under neuter), then full-suite / tsc / migration-untouched / append-only-pins gates

### Phase 164.5: BASELINE-SNAPSHOT — the committed PROD schema baseline becomes the local stack's source and a gate, and the one production object no migration owns is dispositioned under review (INSERTED)

**Goal:** `supabase/schema/baseline.sql` (committed 2026-08-29, WR-04) becomes load-bearing instead of decorative, in this order: (1) repoint `scripts/local-stack/run.sh:50` at `supabase/schema/baseline.sql` and drop the `.gitignore:138` exclusion (`REPLAY-SPIKE.md:135` records that the current path makes `run.sh up` exit FATAL); (2) a baseline STALENESS gate — sha256 of the file against the hash recorded in `BASELINE.md`, failing loud on mismatch (WINDOWS 29: "committed with NO staleness gate AND NO consumer"); (3) **DRIFT-04** — `create_allocator_connected_strategy` exists in PROD under NO migration, is `SECURITY DEFINER` with `GRANT ALL … TO authenticated`, and writes encrypted credential material. FOUNDER DECISION 2026-08-29: DROP it — `DROP FUNCTION public.create_allocator_connected_strategy(<exact 11 arg types>)` with **NO `IF EXISTS` and NO `CASCADE`**, pre-flight asserting (a) live body == `baseline.sql`, (b) zero dependents, (c) `pg_stat_statements` read for call evidence and ABORT when it is unavailable — never infer zero calls from an absent measurement. Three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply; the drop is production DDL on a credential surface. (4) **DRIFT-05** as TWO gates, not conflated: (a) hermetic name-set diff, both directions, `baseline.sql` vs `supabase/schema/functions/*.sql`, a third assertion inside `dump-sql-functions.ts --check`; (b) baseline-vs-LIVE staleness on the credentialed job VAC-04 already rides. (5) **VAC08-LEDGER-32** — **31** repo migrations have no TEST ledger row (the entry ID keeps its original `-32` suffix as a stable identifier; the COUNT is 31 as of 2026-09-07, after `20260823120000_revoke_api_keys_insert` reached TEST); disposition each by name. (6) **VAC-07** — Phase 159's two blocked items as ONE spec on the pg-lane: two concurrent `csv-finalize` POSTs on one never-classified `wizard_session_id`; this is also where the advisory-lock concurrency test that left 164.1 lives. ⚠️ VAC-07 stays `Pending` in REQUIREMENTS until its spec is observed RED with the fence removed and GREEN with it — `[VAC-07-DEFER]` forbids scoring it earlier. Substrate: the pg-lane with pg_cron (164.4.1); nothing here touches shared TEST or PROD except the reviewed DRIFT-04 migration. ⛔ **SCOPE AMENDMENT 2026-09-07 (founder): item (7) CRON-DRIFT-01-REPAIR was SPLIT OUT to Phase 164.5.1.** It was the only item touching the migration-vs-runbook conflict that Phase 164.7 opened, and it is not built on an unresolved convention. See Phase 164.5.1 for the item and the conflict.

**Success Criteria**:

1. `scripts/local-stack/run.sh up` boots from `supabase/schema/baseline.sql`; the old path is gone from the script and `.gitignore` no longer excludes the file. Proven by running it.
2. The staleness gate FAILS on a one-byte change to `baseline.sql` without a matching `BASELINE.md` update, and passes when both move — proven by mutation, not inspection.
3. DRIFT-04: the DROP migration reaches PROD only after all three pre-flight assertions pass and PRINT their measurements; a signature mismatch, a dependent object, or an unavailable `pg_stat_statements` ABORTS the deploy. Afterwards the function is absent in PROD and `database.types.ts` is regenerated without it.
4. DRIFT-05 (a) is a hermetic assertion in `dump-sql-functions.ts --check` that fails when a function name is present on one side and not the other — proven with a red fixture in each direction; (b) runs on the credentialed job and exits 1 when its credential is absent, never skips.
5. VAC08-LEDGER: every one of the **31** unledgered migrations is applied to TEST or dispositioned by name, and VAC-08's next credentialed run prints **`0 NEW drift`** with all 31 carrying a named disposition. ⚠️ **AMENDED 2026-09-07 by founder decision.** It previously read "every one of the **32** … VAC-08 reports **zero unledgered migrations**". BOTH halves were wrong. (a) The count is 31, not 32 — `20260823120000_revoke_api_keys_insert` was applied to TEST on 2026-09-07. (b) "zero unledgered migrations" is UNSATISFIABLE on the disposition route and always was: the gate's seam is `sed 's/#.*//'` (`scripts/test-ledger-drift-check.sh:361`), which STRIPS comments before comparing, so a disposition is invisible to it by construction. It can print `0 NEW drift`; it can never print "zero unledgered". Only APPLYING all 31 to shared TEST yields that, and TODOS `[VAC08-LEDGER-32]` explicitly forbids an agent doing so. The criterion is now pinned to what the tool actually PRINTS. ⛔ The stronger goal — TEST genuinely holding these migrations — is NOT abandoned; it moves to **Phase 164.8 TESTPREPROD**, which exists to make TEST a real pre-prod. MEASURED: adding the 31 dispositions left the gate's own name-parse BYTE-IDENTICAL (`087de909…` before and after), so this weakens nothing VAC-08 detects. ✅ **CLOSED 2026-09-09 — and the STRONGER goal deferred to 164.8 is met, not merely the weakened criterion.** Phase 164.8 restored shared TEST from the PROD dump (`test-restore-from-baseline.yml` run **`34274355596`**, head **`88581b8bc66415bfa86b7d5a019741b1cbd0ff49`**, COMMITTED), re-seeding the ledger to one row per repo migration file (243 → 266), so TEST GENUINELY HOLDS these migrations rather than carrying 31 named dispositions for their absence. `scripts/vac08-ledger-baseline.txt` therefore went **31 → 0 entries**, emptied BESIDE AN AIM with a dated lineage header (commit `776c4dbb`, `ENTRY_COUNT = 0`). The SHA-bound reading, from `sql-tests` job `102416204141` in CI run **`34335526540`** at head **`b895113264af79858f77682b20d539595df582b0`** (conclusion `success`), verbatim: `ledger presence: 0 absent, all 0 baselined (see scripts/vac08-ledger-baseline.txt); 0 NEW drift.` ⚠️ That exact wording is itself dated: PR #767 (`06db9958`, Phase 164.8.1) added a ledger-frontier exemption and the line now reads `ledger presence: 0 absent — 0 baselined (see scripts/vac08-ledger-baseline.txt), 0 exempt as above the ledger frontier; 0 NEW drift.` — measured on run **`34367061423`** at head **`dbd1324690eb05f3d4a567e93eaca2323513ef3b`**. Both readings are `0 absent`; quote the one that matches the sha you are reading. ⛔ **AMENDED 2026-09-09 — TWO corrections to the attribution above, found by the Phase 164.8 verifier and confirmed independently by the orchestrator. Neither weakens the closure; both make it attributable.** (a) Run **`34274355596` concluded `failure`**, not success (`gh run view 34274355596` → `conclusion=failure`): it COMMITTED the transaction — which is why the ledger really did move 243 → 266 — and then exited 1 on the post-COMMIT extension guard, a guard that fires on a legitimate GAIN and is itself booked as Phase 164.9's routed item 1. The bare `COMMITTED` parenthetical above was carrying that whole story alone. (b) **It is NOT the run that left shared TEST in its present state.** A second, complete destructive rebuild ran the next morning at head `a622df27`, actor `AI-Isaiah`: **`34329459044`** (preflight, 08:30Z) and **`34330741339`** (`mode=restore`, confirm token enforced, 08:44Z, conclusion `success`). Measured 2026-09-09: `grep -rn "34330741339\|34329459044" .planning/` returned **zero hits** before this amendment, so for a database other people's CI depends on, "who rebuilt it, from what, and when" was not answerable from the planning record at all. Both run ids are now in `164.8/164.8-04-RESTORE.log` with their readings.
6. VAC-07: the concurrent csv-finalize spec exists on the pg-lane, was observed RED with the advisory lock removed and GREEN with it restored, and only then does REQUIREMENTS flip VAC-07 to Complete.
7. ⭐ **BASELINE-CONTENT-DRIFT (carried in from Phase 164.7, 2026-09-07): the baseline is pinned to the MIGRATION CHAIN, not merely to its own changelog.** Criterion 2 above is a CO-EDIT gate — it fires on a byte change to `baseline.sql` with no `BASELINE.md` update. It cannot fire when a migration changes a function body and `baseline.sql` is left untouched, which is exactly what Phase 164.7 does. MEASURED at `14dc1f5e`: `baseline.sql` still carries the superseded Lock B (`grep -c ledger_refresh_enabled` = **4**) and **zero** workflows in `.github/workflows/` reference the file at all. **Done when** a gate compares the committed baseline against the applied migration chain and FAILS on a body that disagrees — proven by mutation in BOTH directions (regenerate the baseline and observe GREEN; revert one function body and observe RED naming that function), never by inspection. ⛔ This must land BEFORE any squash: collapsing 263 migrations onto an unpinned, already-drifted baseline freezes the drift into the new floor permanently. ⚠️ 44 function names in `supabase/migrations/**` carry more than one definition (`mark_compute_job_done` × 9), which is the weight a squash would reclaim and the reason the ordering matters.

**Requirements**: VAC-07 (deferred here from 164.3) + TODOS entries DRIFT-04, DRIFT-05, VAC08-LEDGER-32, `[VAC-07-DEFER]` — read each before planning, do not re-derive
**Depends on:** Phase 164.4.1 (the pg-lane with pg_cron is the substrate), Phase 164.3 (VAC-04/VAC-08 credentialed jobs that (4b) and (5) ride), **Phase 164.7** (item (7) must consume 164.7's settled `app.*` replacement mechanism, not invent a second answer — the `20260408215026` GUC design is exactly what 164.7 retires)
**Plans:** 1/8 plans executed

Plans:

- [x] 164.5-01-PLAN.md — crit 1: repoint the local-stack lane at the committed `supabase/schema/baseline.sql`, drop the `.gitignore` exclusion, retire `BASELINE.md`'s NOT WIRED YET claim, prove by RUNNING `run.sh up` (wave 1, tracer)
- [x] 164.5-02-PLAN.md — crit 2: hermetic baseline staleness (co-edit) gate + CI placement in `sql-function-snapshot.yml`, mutation-proven in three arms (wave 1)
- [x] 164.5-03-PLAN.md — crit 7: BASELINE-CONTENT-DRIFT gate over the existing `sql-body-normalize.mjs --diff-bodies`, hash-pinned ratchet for the measured 6 DRIFT + 2 SNAPSHOT_MISSING, wired into `ci.yml`'s aggregator-blocking `sql-gate-lint` (wave 1)
- [x] 164.5-04-PLAN.md — crit 4: DRIFT-05 as TWO gates — (a) hermetic name-set diff inside `dump-sql-functions.ts --check` with a red fixture in each direction, (b) baseline-vs-LIVE on VAC-04's credentialed job, exit 1 on an absent credential (wave 1)
- [x] 164.5-05-PLAN.md — crit 5: disposition all 31 unledgered migrations by name, pin them with an independent vitest, and amend criterion 5's wording to the `0 NEW drift` reading the gate can actually print (wave 1)
- [x] 164.5-06-PLAN.md — crit 3 / DRIFT-04: **APPLIED AND SHIPPED 2026-09-08**, in the revised two-PR sequence exactly as specified: PR 1 the DROP only (CHANGELOG `[0.77.20.0]` — "DRIFT-04: the unowned PROD function is dropped"), PR 2 the baseline regeneration plus the `NAME_SET_RATCHET` row deletion together (`[0.77.21.0]` — "DRIFT-04 closed: baseline regenerated, ratchet row retired"). The migration is `supabase/migrations/20260908120000_drop_create_allocator_connected_strategy.sql`; `create_allocator_connected_strategy` now appears ZERO times in `supabase/schema/baseline.sql`, and the row is in TEST's ledger.
  ⛔ **CORRECTED 2026-09-09.** This line read `[~] … NOT APPLIED … the pre-flight SCRIPT must run against PROD first` for a full day after the apply landed. A ROADMAP that under-reports finished work sends the next reader to redo it, or makes the queue look longer than it is — the same record-vs-reality class this milestone exists to remove, in the planning artifacts rather than the database. Re-measure a status line before trusting it; three independent sources (CHANGELOG, the migration file, the TEST ledger) disagreed with this one.
- [x] 164.5-07-PLAN.md — crit 6 / VAC-07: two-client concurrent csv-finalize race spec on the local-stack lane (NOT the pg-lane), observed RED-then-GREEN, made to EXECUTE in CI, then VAC-07 flips to Complete (wave 2, depends on plan 01)

### Phase 164.8: TESTPREPROD — TEST becomes a real pre-prod: every migration is proven on a real Postgres before it reaches a customer (INSERTED)

**Goal:** The shared TEST project stops being a stale bystander and becomes the stage every migration crosses BEFORE production. Two halves: (1) bring TEST current — the migration backlog it has accumulated while nothing applied to it; (2) apply on merge to TEST FIRST, then PROD, so a migration that cannot apply is caught against a real Postgres instead of against customers.

⚖️ **FOUNDER DECISION 2026-09-06**, in the founder's own framing: *"Make TEST a real pre-prod — bring it current, then apply on merge before PROD. This is what you'd expect, and it's the only thing that fixes e2e running against a stale schema."*

⛔ **The defect this closes is that NOTHING applies migrations to TEST today.** `sql-tests` has no apply step and the migrate workflow is PROD-only, so every pre-apply gate SKIP is PERMANENT and deployed function bodies are tested nowhere. Read TODOS `[NOTHING-APPLIES-MIGRATIONS-TO-TEST]` and `[164.2-TEST-APPLY-PROVENANCE]` before planning — the second is the concrete, dated instance: Phase 164.2's PR went RED on `sql-tests` for exactly two named arms purely because its provenance migration had not reached TEST, and was resolved by a HAND apply through the Management API. That hand apply is the thing this phase automates.

⚠️ **Constraints that are not negotiable and are already measured:**

| Constraint | Consequence for this phase |
|---|---|
| TEST is **SHARED** with other people's CI | A write there is not private and a global assertion there is not reliable (`FANOUT-GLOBAL-01`). Per-run isolation, not global truncation. |
| This checkout's Supabase CLI is linked to **PRODUCTION** | `supabase db push`, `db reset --linked`, `--project-ref` and `--db-url` from this directory all target PROD. The link is deliberate (the pre-flight gates diff against PROD on purpose) — do NOT "fix" it by unlinking. |
| `current_database()` is `postgres` on BOTH projects | It proves nothing. Verify via the hand-set `shobj_description(oid, 'pg_database')` marker before ANY write; a NULL marker means STOP, not proceed. |
| Pre-flight migration gates run against PROD, not TEST | A TEST-first pipeline does NOT de-risk them — measured: a PROD-only `INTO STRICT` would have aborted the deploy while TEST had none. |

**Downstream consequence, NOT a goal of this phase:** per-run isolation on TEST is the precondition for raising Playwright workers above 1 in the `e2e-seeded` job (`playwright.config.ts`, the `workers: process.env.CI ? 1 : undefined` line). Today the MA-8 batch shares ONE test database across all specs, which is why serialisation is load-bearing rather than sloppy. ⛔ Do NOT plan parallelism as an objective here: measured on main run `34059839696`, `e2e-seeded` sits behind `sql-mutation` (503s), so parallelism buys ~1-2 min of wall clock and is worth nothing on its own. It is a thing that becomes SAFE, not a thing to chase.

⛔ **SCOPE ADDED 2026-09-08 — `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]`, AND IT IS A HOLE IN THIS PHASE'S OWN DESIGN, not a bolt-on.** Migration `20260908120000_drop_create_allocator_connected_strategy.sql` (Phase 164.5, PR #758) is a bare `DROP FUNCTION` with an exact 11-argument signature and deliberately **no `IF EXISTS`**, so that a moved signature aborts loudly instead of dropping nothing quietly. TEST carries **ZERO** overloads of that function (measured 2026-09-08 against TEST's own `pg_database` marker). Therefore:

- **Half (1) "bring TEST current"** replays the accumulated backlog, which now contains this migration → `42883`, abort.
- **Half (2) "apply on merge to TEST FIRST, then PROD"** applies it to TEST on merge → `42883`, abort.

⭐ **So the pipeline this phase exists to build FAILS CLOSED on a migration that is CORRECT for PROD.** Planning must settle this before either half is built, not after. ⚠️ The three wrong answers, each already refused with its reason in the TODOS entry — read it rather than re-deriving: adding `IF EXISTS` (reintroduces the vacuous no-op the migration's own STEP 1 exists to refuse, on PROD as well as TEST); adding it to `scripts/vac08-ledger-baseline.txt` (that file's header says it is "a RATCHET, not a mute button" whose purpose is stopping a KNOWN gap from masking a NEW one, and every existing entry means *"should reach TEST, hasn't yet"* while this one means *"can never reach TEST"* — two meanings in one list); and hand-applying (there is nothing there to drop).

⛔ **THE DELIVERABLE IS A DISPOSITION, AND ITS ANTI-VACUITY BAR IS THE WHOLE DIFFICULTY.** A rule classifying "repo migration DROPs object X and TEST has zero of X" as not-applicable has exactly the shape of a gate silently not running — the defect class this milestone exists to remove. It ships only with a fixture PAIR: one proving the disposition FIRES on this shape, and one proving it does **NOT** swallow a genuine missing apply (a migration that should have reached TEST and did not must still go RED). A disposition proven only in the first direction is worse than the red it replaces.

✅ **SETTLED 2026-09-09 by plan 06, and the answer is NOT the one this paragraph anticipated. Read TODOS `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]`'s closure for the verdict in full; it is in two parts and neither half stands alone.** **(1) NARROW — CLOSED.** No disposition was built and none was needed for `20260908120000`. The restore (run `34274355596`, head `88581b8b`) rebuilt TEST's `public` from the 2026-09-08 PROD dump, which `BASELINE.md` records as a **pure deletion of 91 lines, zero added** — the deleted block being `create_allocator_connected_strategy` itself. The object is therefore in neither PROD, nor the dump, nor TEST, while the ledger row for `20260908120000` IS present, so VAC-08 prints `0 absent` with no pragma anywhere in the repo. `supabase db push --include-all` never selects a migration the ledger already holds, so the `42883` batch abort predicted above has no occasion to occur. All three wrong answers stayed refused and not one was needed. **(2) GENERAL — OPEN, and it is a DIFFERENT hole than the one this paragraph names.** The restore was SCHEMA-ONLY (`BASELINE.md`: 0 data statements), so TEST reproduces PROD's CATALOGUE and never its ROWS. A migration in this repo's house style — a data-reading `DO` block that `RAISE EXCEPTION`s on an unexpected count — applies cleanly to PROD and REFUSES on an empty TEST, and Area 1 Q2 makes that refusal block the production deploy. The retired pragma was the declared escape hatch for exactly that. It is booked as `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` with a trigger condition, an interim remedy (revert the merge — never a workflow edit under deploy pressure) and two candidate shapes, and routed to **Phase 164.9 TESTISOLATION**.

⚠️ **COST OF NOT DOING THIS FIRST, measured 2026-09-08:** VAC-08 enumerates EVERY repo migration against the TEST ledger on every `sql-tests` run — it is not scoped to a PR's diff. `main` is red at `78cfaef4` for exactly this, and every PR opened until this lands inherits a red `sql-tests` + `frontend` that a human must triage by hand as "the known one" before each merge. That is a control that has quietly stopped controlling.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries `CI-MIGRATE-01`, `[164.2-TEST-APPLY-PROVENANCE]`, `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]` — read each before planning, do not re-derive. ⚠️ **CORRECTED 2026-09-08:** this line previously cited `[NOTHING-APPLIES-MIGRATIONS-TO-TEST]` and `FANOUT-GLOBAL-01` as TODOS entries. **Neither ID exists in `TODOS.md`** (measured: 0 hits each). The substance of the first is under `### CI-MIGRATE-01` (`TODOS.md:2362`); the second exists only as ROADMAP/CLAUDE.md prose about shared-TEST assertion reliability. Citing a phantom ID sends a planner looking for a spec that was never written.

**Depends on:** nothing outstanding. ⭐ **RE-ORDERED 2026-09-08 — PULLED FORWARD, runs NEXT.** ⚠️ **The SECTION was physically MOVED on 2026-09-08 to sit here, immediately after Phase 164.5 and ahead of 164.5.1.** For several hours it was pulled forward in this prose only while the section still sat after 164.6 — which meant `roadmap.analyze`, which walks FILE ORDER and returns the first incomplete phase, would have handed the next session 164.6. Prose is not the queue; position is. If a phase is re-ordered, MOVE IT. This SUPERSEDES the 2026-09-06 founder decision that queued it LAST; that decision is preserved verbatim in the next sentence because it was taken deliberately and its reasoning still reads correctly for the world before 2026-09-08. It said: *"Queued LAST in the 164.x series by founder decision 2026-09-06, in full knowledge of the counter-argument: Phase 164.7 and Phase 164.5 each write forward migrations and will therefore each hit the hand-apply path this phase automates. That cost is accepted, not overlooked."* What changed is that the accepted cost stopped being a per-PR inconvenience and became a PERMANENTLY RED `main` (see the scope block below), and that the phase's own design was found to break on the migration that caused it. The former dependency on Phase 164.6 was documented as "ordering only — no code dependency", so nothing technical resisted the re-order.

**Status**: ✅ **COMPLETE 2026-09-09.** 6/6 plans with SUMMARYs. `gsd-verifier`: **7/9 must-haves**, 1 present-but-behaviour-unverified, 2 failed — and it proved the ENGINEERING holds: eight mutations of the shipped controls (`apply.if` without the success clause, `apply-test.if` on `always()`, the pre-fix applied-set scrape, a `push:` trigger on the restore workflow, the PROD-marker refusal on `if false`) each observed RED, plus `self-test OK (26/26 arms)` on a real PostgreSQL 16 cluster. **Both failures were record defects, not shipped controls, and both are closed** (`2832e139`): two destructive rebuilds of shared TEST were recorded nowhere while the ROADMAP credited a run that concluded `failure`; and five places asserted the CLI post-verify had never executed when run `34330741339` step 24 concluded `success` under the pinned 2.98.2 — one of them scoping Phase 164.9's work on a false sentence. `gsd-code-reviewer`: **0 Critical, 6 Warning, 7 Info**. WR-01 was fixed here (`ec94788b`) because it was proven-live command substitution inside the script that assembles `DROP SCHEMA public CASCADE` — a fixture carrying a backticked echo came out of bash with the echo already executed; arm 26 gained legs (f) and (g) and goes RED under the old matcher. The other five Warnings are routed to **Phase 164.8.2 GATEHARDENING**, inserted for them. ⚠️ **ONE ITEM IS OPEN AND THIS PHASE CANNOT CLOSE IT:** the applied-set comparison has never run on a NON-EMPTY set — both dispatch proofs (`34354619770`, `34367135073`) ran at 266/266 on both ledgers, so `planned` and `applied` were both empty and equality held trivially. It is carried as `blocked` in `164.8-UAT.md` test 5 and `human_judgment: true` in two coverage blocks, never as a pass. The verifier's judgement, kept verbatim: *"Sufficient to call the applied-set check wired and falsifiable; not sufficient to call the pipeline proven."*
**Plans:** 6/6 plans executed

Plans:

⚠️ **RE-SYNCED 2026-09-08 by the 164.8-01 executor.** The five bullets that stood here described
the PRE-SPLIT plan set and had been stale since `fbb18c98` ("164.8 plan count 5 -> 6"), which moved
the count but not the list: every entry from 02 down named the plan one slot BELOW it on disk, and
06 was missing entirely. Each bullet below is now taken from that plan file's own `<objective>`.

- [x] 164.8-01-PLAN.md — `scripts/restore-test-from-baseline.sh`: the one-transaction drop+replay+survivors+ledger-seed mechanism with SEVEN pre-write refusals, a search_path-independent census (B1) and a derived `pg_depend` closure (B2), plus the `--self-test` SKELETON carrying the two GREEN arms. Writes NO byte to TEST or PROD
- [x] 164.8-02-PLAN.md — finish the proof: every RED path observed on a throwaway Postgres, `EXPECTED_ARMS` introduced ONCE at its final value, the constants pinned in vitest, the header written
- [x] 164.8-03-PLAN.md — `test-restore-from-baseline.yml`: dispatch-only, ref-guarded, `mode=preflight|restore` + `confirm` token, `environment: Test`, backup artifact BEFORE the script, whole-act mutex, CLI post-verify; line-exact wiring pins
- [x] 164.8-04-PLAN.md — WAVE 1 EXECUTION, the one-way door: founder merges the wave 1-3 PR → preflight → **activity gate** (mutex-first probe; `idle in transaction` counts as active; non-zero aborts to the founder — founder delegation 2026-09-08 superseding CONTEXT safety rule 4) → restore → SHA-bound readings → `vac08-ledger-baseline.txt` emptied BESIDE AN AIM with `ENTRY_COUNT` 31 → 0 in the same commit
- [x] 164.8-05-PLAN.md — WAVE 2 PIPELINE: `apply-test` (`environment: Test`, mutex, marker, `db push --include-all --db-url`) + `apply-test-verdict` (`if: always()`, skipped = fault) gate PROD `apply`; pins; SHA-bound dispatch proof
- [ ] 164.8-06-PLAN.md — WAVE 3 CLOSURE: record the verdicts and the SHA-bound readings, TODOS closures with run ids (incl. the `TEST-NOT-APPLICABLE` pragma verdict), first SHA-bound VAC-08 `0 absent` reading, CLAUDE.md + mutex runbook currency
  ⛔ **CORRECTED 2026-09-09.** This bullet read "the `TEST-NOT-APPLICABLE` pragma recorded as DEAD SCOPE by measurement" — the verdict the plan-checker's B4 finding REVERSED on 2026-09-08, before plan 06 ran. The shipped verdict is two-part: unnecessary for `20260908120000` (narrow, evidenced), general case OPEN and routed to Phase 164.9 as `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`. A ROADMAP bullet still carrying the superseded half would send the next reader to close a hole that is open.

### Phase 164.8.6: VAULTTICKFIX — the forward migration Phase 164.7 earned: the verification check that cannot fail is re-run correctly, the Vault read becomes single-row-safe, the whitespace-key guard learns btrim, and the SECURITY DEFINER grant set is asserted whole instead of two names deep (INSERTED)

**Goal:** One forward migration repairs every SQL-side finding Phase 164.7's post-merge audit produced, including a verification check that CANNOT FAIL — shipped through this repo's full migration discipline, not around it.
**Requirements**: [164.7-CR05-VACUOUS-MIGRATION-CHECK], [164.7-WR01-VAULT-NOT-STRICT], [164.7-WR02-SERVICE-ROLE-EXECUTE], [VAULTTICK-EMPTYKEY-01], [164.7-MIGRATION-COMMENT-DRIFT], [APPGUC-WARNING-UNINSTRUMENTED-01] + [164.7-DORMANCY-UNINSTRUMENTED] (⛔ RE-ROUTED from 164.8.5 on 2026-09-10: ONE instrument closes both, and it is SQL in `20260907130000` — a phase whose fence forbids `supabase/**` cannot hold them. A prober-side `system_flags` read-back was considered and REJECTED by measurement: it cannot distinguish WR-10's third dormancy cause, so it would be a control that reports 'fine' for a case it cannot see)
**Depends on:** Phase 164.8
**Plans:** 0 plans

**Success Criteria**:

1. `20260907120000`'s check 6 is re-run in a form that CAN fail: deleting the settings read while keeping the `RAISE EXCEPTION` text must make it RED. ⭐ The correct idiom is already in the repo at `20260907130000:766` — match the sibling rather than inventing one.
2. `match_engine_cron_tick()`'s Vault read is single-row-safe (`STRICT` or an explicit cardinality check), so a duplicate secret name RAISEs by name instead of posting an arbitrary key.
3. The whitespace-key guard tests `btrim(v_key) = ''`, with a gate arm that stores a single space and asserts the function RAISEs by name — ⚠️ that arm moves `ARMS_FLOOR`, so separate the floor in BOTH directions on a real full-corpus lane run before pinning, per the runner's own derivation block.
4. Both migrations' verification blocks assert the WHOLE grantee set of all three SECURITY DEFINER functions, not the `anon`/`authenticated` subset — `service_role`'s EXECUTE is the grant that survived precisely because it was never checked.
5. ⛔ Before ANY comment-only edit to an applied migration, take the reading nobody has taken: does a comment-only edit change what `supabase-migrate`'s plan job plans? (PATTERNS TRAP A, recorded in `164.7-06-SUMMARY.md`; Phase 164.5.1 criterion 6 is blocked on the same question.) If the answer is yes, annotate BESIDE the file rather than editing it.
6. ⛔ The three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) run BEFORE the PR exists, and their findings are fixed — not after, and not in the PR body.
7. ⚠️ Read `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` first: a data-reading `DO` block that RAISEs on an unexpected count can apply to PROD and REFUSE on the empty TEST, and a failed TEST apply BLOCKS the PROD apply. The interim remedy is to revert the merge, never to edit `supabase-migrate.yml`.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.8.6 to break down)

### Phase 164.8.5: PROBERPARSE — the prod-prober hygiene rules stop being dodgeable and its parser stops dropping rows silently: the ||-split service key and the dollar-quoted literal both go RED, an unreadable oracle no longer disables the live credential scan, a malformed cron.job record becomes a measure-fail instead of a continue, and the app-GUC linter successor check stops accepting any readable file (INSERTED)

**Goal:** Every control this phase touches is one a machine can DODGE today, and each fix ships with a red fixture proving the dodge now fails. The reviewer's verdict on Phase 164.7 is the brief: *"the SQL in this phase is careful and genuinely fail-closed; the verification code shipped alongside it is not."*
**Requirements**: ⛔ [164.7-REPAIR-REVERTED] (FIRST WORK — the five prober repairs were written, measured as a net regression, and reverted on 2026-09-10; re-do them with a red control each, hoisting PROD hygiene above every early return BEFORE re-applying anything), [164.7-CR03-HYGIENE-BYPASS], [164.7-WR04-HYGIENE-BELOW-ORACLE], [164.7-WR05-PARSER-DROPS-ROWS], [164.7-APPGUC-SUCCESSOR-VACUOUS], [164.7-REVIEW-INFO-FOUR], [APPGUC-DETECT-DOUBLEQUOTE-01], [APPGUC-UTF16-01]
**Depends on:** Phase 164.8
**Plans:** 7/7 plans complete

**Success Criteria**:

1. ⛔ **Before ANY of the below:** the PROD-side hygiene loop runs at the TOP of `compareManifest`, above every `return`, and a test proves a `cron-secret-in-command` on the PROD side STILL fires when the oracle is absent, stale, hand-edited and marker-mismatched. This is the precondition the 2026-09-10 revert exists to enforce — re-applying the repairs without it re-introduces a measured suppression of credential detection.
2. ⛔ **The redesigned `vault-absent` admits `SELECT public.match_engine_cron_tick();` AND rejects a command naming the table only in a comment or a literal.** These are the two directions Phase 164.5.1 and this phase respectively need, they are the SAME rule, and satisfying only one re-breaks the other. The test is "does this command reach a Vault read that EXECUTES" — an executable read shape on masked text, OR a call to a function whose committed body contains one. ⚠️ This phase owns the redesign and lands FIRST; 164.5.1 consumes it. See `[164.7-VAULT-ABSENT-RULE]`.
3. `hygieneViolations` returns a NON-EMPTY list for a command whose service key is split across a `||` concatenation, and a red fixture in `fixtures/cron-drift/` proves it — neutering the fix must turn the self-test RED naming that fixture. ⛔ NOT by lowering `HEADER_LITERAL_MIN`: the docstring explains why the threshold exists and lowering it fires on the green Vault-backed shape.
4. The literal scanner skips `$tag$ … $tag$` regions wholesale, so `$q$don't$q$` and `$q$dont$q$` in the headers list produce the SAME verdict. Both spellings ship as fixtures.
5. A live `cron.job` command carrying a credential is reported as `cron-secret-in-command` EVEN WHEN the oracle is missing, unparseable, or has a bumped `schema_version` — the property the file header already claims and does not have.
6. A malformed `cron.job` record raises a `measure-fail` naming the count instead of `continue`. A row the parser could not read is not a row that is not there.
7. `lint-app-guc`'s successor check rejects a successor that is not a real successor, and `DETECT_RE` matches all four missed spellings — each with a red fixture in the gate's own `--self-test`. ⚠️ The corpus stays at 0 findings: a fix that moves that number is matching something else.
8. The four Info findings are swept in the same pass (`--files` allowlist enforcement, `sqlFilesUnder` symlinks + `.SQL` case, `parseLineageHeader`'s first-marker-wins, `pg-password`'s plpgsql assignment forms).
9. `node scripts/prod-prober/run.mjs --self-test` exits 0 with `SELF_TEST_SCENARIOS` bumped in the SAME edit as any added scenario, and `src/__tests__/prod-prober-wiring.test.ts` agrees.

Plans:

- [x] 164.8.5-01-PLAN.md — Prober structure: section (0) PROD hygiene above every return in `compareManifest` (positional gate), `run()` never returns before it, mandatory + compared live marker, `{ rows, malformed }` parser with a measure-fail naming the count, `captureManifest` fourth refusal + its scenario; HOIST scenarios (absent / stale / marker-mismatched); individual neuter matrix
- [x] 164.8.5-02-PLAN.md — The four reverted repairs re-applied with a red control each: CR-01 username/database, CR-04 totality loop (three fields neutered ALONE), WR-11 sha binding + the HAND-EDITED hoist state, SR-05/07/08/09 comment fixes; eight-row individual neuter matrix
- [x] 164.8.5-03-PLAN.md — Hygiene lexer: import `scanSql`, `codeSpans()` DO-body recursion, header rules on masked text with derived-length sum (anchored ids at `HEADER_LITERAL_MIN`, every header argument at `HEADERS_LITERAL_MAX` — bypasses a–g, the non-anchored split, `$q$don't$q$` pair), `headerRegions` as a list with an unparseable state → `header-unparseable` measure-fail, IN-04 pg-password forms, `hygiene-bypass.json`, the committed-manifest zero-FP scenario
- [x] 164.8.5-04-PLAN.md — Individual neuter matrix for Plan 03's lexer-era controls (eleven rows) + the CR-03 reproduction
- [x] 164.8.5-05-PLAN.md — `vault-absent` = "reaches an executing Vault read" (executable shape on spans OR resolvable committed callable, injectable snapshot dir, fixture snapshot, real-snapshot 164.5.1 collision scenario) + `long-token-anywhere` with `TOKEN_MIN` DERIVED from `HEADERS_LITERAL_MAX` and pinned (bypasses h, i; zero-FP budget inherited from Plan 03)
- [x] 164.8.5-06-PLAN.md — Individual neuter matrix for Plan 05's controls incl. the `TOKEN_MIN` pin (twelve rows) + the CR-03/SR-02 reproductions and phase-level prober checks
- [x] 164.8.5-07-PLAN.md — `lint-app-guc`: `DETECT_RE` widened in BOTH files with FIVE single-spelling `--self-test` red fixtures, four-arm successor check (T-164.7-02; type and separator as separate predicates), IN-01 banner, IN-02 symlink/case, IN-03 multi-marker, UTF-16 BOM and NUL measureFail (separate tests); corpus stays 0 / 12; sixteen-row individual neuter matrix + the nine-criteria proof table

### Phase 164.8.4: GATERESIDUE — every deferral Phase 164.8.2's four review rounds produced: the shared-TEST credential channels that still reach a public log, the artifact that publishes the file it refuses over, and the gate-integrity leftovers each below the bar that blocked the ship (INSERTED)

**Goal:** Discharge every deferral Phase 164.8.2 produced and nothing else. Four review rounds over that phase's own fixes found ten items that were each, individually, below the bar that would have blocked the ship — and the reason they are one phase rather than ten TODOS lines is that **eight of them are the same defect**: a control narrower than the sentence beside it. 164.8.2 proved three times over that fixing the instance a reviewer named, rather than the class, produces a half-class that the next round finds again.

⛔ **The evidence, the measurements and the forbidden remedies live in each TODOS entry and are NOT restated here.** Every id below carries its own dated measurement, and several carry an explicit *do not close it this way* — read them before planning.

**What this phase owns, grouped by the sweep that discharges it:**

**(a) Credential channels that still reach a PUBLIC log** — plan as ONE sweep over every psql site, never site by site; that is how this became a half-class twice.

- `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` — the `missing`-direction ledger read has no redirect at all, so psql's connect and auth failures put the shared-TEST pooler host and user into a world-readable Actions log, against that file's own NON-NEGOTIABLES. The correct idiom (capture, count, WITHHOLD) already exists three screens below in its sibling read.
- `[164.8.2-REDACT-HOSTNAME-01]` — a routing WORD that was never a routing RECORD: cited in comments and the changelog as booked, measured 2026-09-10 as **0 hits** in TODOS and the ROADMAP. The gap behind it is real — four psql sites can still print a DNS-failure hostname.
- `[164.8.2-EVIDENCE-DOTENV-LEAK]` — a local wrapper's `bun` shebang auto-loads `.env.local` into the child `vitest`, flipping `HAS_LIVE_DB` true and turning 16 SKIPPED live-DB suites into real INSERTs against shared TEST. ⛔ Not closable by editing the skip gates; they are correct.

**(b) The artifact publishes what it refuses over** — a founder decision with a real cost on both sides, not a patch.

- `[164.8.2-REFUSAL-STILL-PUBLISHES]` — the published-`.sql` scan aborts the restore before the transaction but never `rm -f`s the offending file, and the staging step is `if: always()`. Its sibling scan DOES `rm -f`. Withholding it means deleting part of the reversal recipe (`T-164.8-21`) on exactly the run whose restore was refused.
- `[164.8.2-CHANNEL-ALLOWLIST-STALE]` — replacing a glob with an enumerated list was the right direction and bought a new failure mode: a channel added later is silently ABSENT. Fix by DERIVATION (channels the script can write ⇔ channels the step stages), not a second hand-maintained list.

**(c) Gate-integrity leftovers** — controls narrower than their own claims.

- `[164.8.2-SENTINEL-GREP-NUL-BLIND]` — the ancestry sentinel is read with a NUL-blind `grep -q`, and the check is NEGATIVE, so it **fails OPEN**, letting through the false "is not an ancestor" that three fixes exist to delete. ✅ Already held as a CEILING: it is the `-a` rule's ONE dated exemption and the rule reds if the site is fixed without deleting the entry.
- `[164.6-SOURCE-ANCHOR-ROT]` — `plan-anchor-verify` guards PLAN.md anchors; NOTHING guards `file:line` anchors in source comments, which rot faster. ~30 across the touched files, several dead, one already dead on `main`. ⭐ Deliverable is a GATE, and its message should say to prefer a SYMBOL over a re-pinned number.
- `[164.8.2-GATE-RESIDUE]` — seven small items in one sweep over one file family: two assertions bound to text this repo does not control, a softening allowlist that is still a COUNT, hand-copied marker regexes pinned to nothing, a computed-but-never-compared floor, a README describing files the denial path does not stage, a dead local and a misdirected message.

**(d) Carried in, because leaving it unowned a second time is the failure this phase exists to end.**

- `[WINDOWS-LEDGER-DRIFT]` — NOT 164.8.2 residue. Logged 2026-09-02 in Plan 164.4-00 and carried with **no owner, no date and no gate for eight days**. `.planning/WINDOWS.md` refuses every append while its frontmatter counts and its entries disagree. It fits here because a ledger that rejects writes because its own header is stale is a control disagreeing with the thing it describes.

**Success Criteria**:

1. The class-lint's file set is DERIVED from its own scope sentence, or the sentence is derived from the set — one of the two, so a fourth axis (depth, extension, location, symlink) cannot open without something going red. ⛔ A third hand-widening that closes only the depth axis does NOT satisfy this.
2. A calibration proves the mechanism by opening a new axis on a scratch tree and observing RED — not by asserting today's count.
3. The two inline degeneracy demonstrations are routed through `degenerateNarrow`, and an arm asserts no NEW inline demonstration can be added outside it without being reported.
4. Either the helper file is policed again, or a stated, dated reason records why one 79-line single-function file does not need it — ⛔ not silence.
5. Every one of the four `[164.8.4-PROSE-OVERCLAIM]` sentences is corrected to what its code actually does, with its regenerating command beside any number.
6. Each correction is verified by MEASUREMENT at HEAD, not by reading — six rounds on this branch established that a restated claim is the defect class itself, and two of them were corrections that were themselves wrong.
7. ⛔ Nothing in this phase widens `WAIVED_CEILING`, relaxes a floor, or adds an exemption to make a gate pass. Every item here is closed by making a claim true, never by narrowing what is claimed — except where narrowing IS the honest answer, in which case the narrowing is dated and reasoned in-code.

1. Every psql site in `test-ledger-drift-check.sh`, `test-restore-from-baseline.yml` and their shared redaction is swept in ONE pass, with a test that FAILS on a new unredirected site — not a fix to the three known ones.
2. The `gstack-evidence` credential inheritance is closed at the wrapper, with the skip gates untouched, and proven by a run whose skip counts match a plain `npx vitest run` at the same commit.
3. The refuse-vs-withhold tradeoff is DECIDED by the founder and the decision is recorded with its cost on both sides — not silently patched either way.
4. The channel allowlist is DERIVED, and a calibration proves a newly written channel reaches the artifact without anyone editing a list.
5. A source-comment anchor gate exists, fails loud on a dead anchor, and its message names the symbol-over-line-number preference.
6. `[164.8.2-SENTINEL-GREP-NUL-BLIND]`'s exemption entry is DELETED, and the `-a` rule goes red if it is re-added.
7. `.planning/WINDOWS.md` accepts an append, and the mechanism that made its counts drift is closed rather than the counts hand-corrected.
   ⚠️ **HAND-OFF 2026-09-10 (Phase 164.7 plan 06) — part of the mechanism was already removed, so do NOT go looking for it.** Two things happened to this file that day and they are DIFFERENT in kind:
   (a) ⭐ **A REAL DEFECT, already fixed:** the frontmatter carried **TWO `last_updated:` keys**, and the LATER timestamp came first. A YAML parser takes the LAST occurrence, so the ledger reported a value OLDER than its true last edit — a duplicate key that silently loses the newer write is a plausible member of "the mechanism that made its counts drift". Collapsed to one key. ⛔ A planner re-deriving this criterion must READ the frontmatter at HEAD rather than assume the duplicate is still there; it is not, and hunting it will waste a round.
   (b) **NOT a drift correction, and must not be counted as one:** `open_count` 37 → 36 and `fixed_count` 11 went with entry 25 being dispositioned `open` → `fixed` from measurement (VAC-04's first real-PROD execution, run 34146946050). That is the ledger's normal bookkeeping working, not a count being hand-repaired to match reality. `total_count` stayed 47.
   ⛔ **The criterion still stands as written.** Nothing above closes it: whether an APPEND is accepted without a rewrite, and whether the counts can drift by any other route, is unmeasured. What changed is only that one candidate cause is gone and one apparent count change has an innocent explanation on record.
8. Every one of the seven `[164.8.2-GATE-RESIDUE]` items is either fixed or has a recorded, dated reason for staying — ⛔ an unaddressed item silently dropped from the list is this phase's own defect class.

⭐ **FOLDED IN 2026-09-10 — Phase 164.8.5 SCOPEAXIS was created for these five and then withdrawn.** It was opened on a misreading of the founder's stopping rule: that rule was CONDITIONAL on the terminal review round still finding cardinal errors, and it found none. The every-deferral-names-a-phase rule still applied, but the home it required had been created twenty minutes earlier — THIS phase. Two phases for one set, split on a line between "deferrals" and "review-round findings" that does not survive inspection: both are unfinished work from 164.8.2. Recorded rather than quietly deleted, because an over-applied rule is worth the same note as a skipped one.

**(e) What SIX review rounds left behind — none CARDINAL.** The terminal round (2026-09-10, red team + silent-failure-hunter, both re-deriving the shipped logic over all 874 test files rather than reading it) found no control that cannot fail, no assertion vacuous today, no gate green over an empty corpus. These are what it DID find.

- `[164.8.4-SCOPE-DEPTH-AXIS]` — LATENT. 144 test files under `src/__tests__`, 139 scanned. Zero offenders in the 5 unscanned files TODAY, so today's green is true.
- `[164.8.4-DEMOS-OFF-HELPER]` — LATENT. This branch planted two fresh copies of the offending expression, as deliberate calibration subjects, in exactly the two files the docblock names as the next widening step — and neither routes through `degenerateNarrow`, which exists precisely so demonstrations live outside the surface. ⛔ When the widening lands and reds them, the reflex will be to restore the tolerance this branch just deleted. Route them through the helper INSTEAD.
- `[164.8.4-HELPER-UNPOLICED]` — LATENT. `src/test/helpers/degenerate-narrow.ts` left the scanned surface entirely; a second exported helper added there would be policed by nothing. 79 lines, one function, so the blast radius is small — but the deletion that removed the tolerance also removed the only thing watching the rest of that file.
- `[164.8.4-PROSE-OVERCLAIM]` — COSMETIC, four sentences that describe more than the code does: a seam docblock naming a relaxation that would NOT red (its self-test pins a different, genuinely load-bearing property, verified); a sentence stale by one commit on the same branch; a tautological illustration beside three load-bearing legs; and a `SCAN_FILES.length > 130` floor over an actual 139 that would let nine files be deleted silently.
- `[164.8.4-COMMENTISH-FALSE-RED]` — REACH. The whole-directory floor's `commentish` test would false-RED on a legitimately blanked docblock continuation line not starting with `*`. Measured 0 across all 139 files, and it fails in the LOUD direction.

⭐ **`[164.8.4-SCOPE-DEPTH-AXIS]` is the one worth planning first, because it is the THIRD recurrence of one shape on one branch:** a scope sentence outrunning the filter beneath it. 2 files while claiming a class; then 137 while skipping 346 `.test.tsx`; now 139 while `readdirSync` — non-recursive — skips 5 by directory depth. Each fix closed the axis it was SHOWN and left the next. ⛔ **The deliverable is NOT a third widening** but a mechanism making the scope claim and the file set agree by construction, proved by opening a new axis on a scratch tree and observing RED.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries `[164.7-MARKER-GREP-VACUOUS]`, `[164.7-PLAN03-EVIDENCE-01]` (plan 03's lane evidence is not re-derivable from the artifacts it left — a provenance gap, not a contradicted claim), `[164.7-CITATION-DRIFT-01]` (⭐ close it by CONVENTION — cite by SYMBOL, not by line — not by re-numbering prose that will drift again), `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]`, `[164.8.2-REDACT-HOSTNAME-01]`, `[164.8.2-EVIDENCE-DOTENV-LEAK]`, `[164.8.2-REFUSAL-STILL-PUBLISHES]`, `[164.8.2-CHANNEL-ALLOWLIST-STALE]`, `[164.8.2-SENTINEL-GREP-NUL-BLIND]`, `[164.6-SOURCE-ANCHOR-ROT]`, `[164.8.2-GATE-RESIDUE]` and `[WINDOWS-LEDGER-DRIFT]` — read each before planning, do not re-derive.
**Depends on:** Phase 164.8.2 (this is its residue). ⚠️ **Cross-phase coupling, deliberate:** `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` is NOT owned here — it stays with Phase 164.9's `[164.8-PUSH-RACE-VAC08]` because they share one root (two jobs contending for advisory key `61616158` on shared TEST) and splitting them would produce exactly the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.8.4 to break down)

### Phase 164.8.3: PROBERAUTH — the prod-prober names MT5 `-6` as what it is (the terminal has no authorized account) instead of collapsing it into the catch-all `mt5-terminal-error` whose remedy sends the operator to an error table (INSERTED)

**Goal:** The prober's MT5 arm gives a dedicated defect kind to `-6`, so the five consecutive red `prod-prober` runs since 2026-09-07 say what is wrong and what to do. Today only `-10004` and `-10005` get their own kinds; everything else falls into `mt5-terminal-error`, whose remedy tells the operator to "read the reported code against the MT5 error table". `-6` has exactly one cause and exactly one remedy, so that instruction is the whole defect.

⛔ **This phase does NOT clear the live outage.** The terminal has no authorized account; restoring it needs a VNC session and broker credentials and is a founder action. This phase makes the NEXT occurrence self-explanatory. Do not treat a green prober as this phase's acceptance signal — it is not in this phase's gift.

⚠️ **MEASURED LIVE 2026-09-09 from this checkout, quoted so nobody re-derives it:**

```
$ ./scripts/mt5-diag.sh
PROBE {"initialize": false, "last_error": [-6, "Terminal: Authorization failed"], "terminal_info": null}
```

`-6` is `RES_E_AUTH_FAILED`. The rpyc bridge answered (a dead bridge gives `-10004`), so the terminal is up and un-authorized — not a transport fault. The `mt5-gateway` deploy log at the minute of each failing prober run (`34387586781`, `34366806167`, `34340209991`, `34315451286`, `34296899495`) contains ONLY VNC session lines (`SLAVE/8001 accepted/welcome/goodbye`) and no MT5 login attempt at all — the absence is the evidence.

**Success Criteria**:

1. **`-6` reports as its own kind, never as `mt5-terminal-error`.** The kind's detail states what was measured (the bridge answered; no account is authorized), not a code the reader must look up.
2. **The remedy names the action.** VNC to the gateway service, log the terminal back into the investor account with "Save password", and re-check the two Expert-Advisors options a login re-clears. ⛔ It must NOT route the operator to the MT5 error table — that instruction is what this phase removes.
3. **The new kind ships with a red fixture, registered in the arm's `kinds` list**, exactly as `10004.txt` and `10005.txt` are. ⛔ A remedy without a fixture is the vacuity class this repo ranks above correctness: the registry asserts kind coverage, so an unregistered kind is a control that measures nothing.
4. **`mt5-terminal-error` survives and keeps meaning something.** `terminal-info-null.txt` still maps to it — "the bridge answered and the terminal is the problem, cause not enumerated". Splitting `-6` out must not leave the catch-all empty, and the arm's own by-name absence assertions must still discriminate the two.
5. ⛔ **Scope fence — `scripts/mt5-diag.sh` stays READ-ONLY.** It calls `initialize()` + `terminal_info()` and never `login()`, because a login is an "account change" and MT5 re-clears `[Experts] Enabled` on every account change while `Account=1` is armed — a probe that authenticated would re-break the thing it measures (the recorded 2026-08-13 incident, where each diagnostic round re-disabled algo trading). ⛔ Do not close this phase by making the probe log in.
6. **Falsifier observed RED.** Neuter the `-6` branch, watch the fixture fall back to `mt5-terminal-error`, restore from pristine bytes. ⛔ Never `git checkout --` in the harness — it restores to HEAD and silently destroys uncommitted work.

7. ⛔ **`terminal_info()` is recorded as `connected` and `trade_allowed`, two separate booleans — not as present/absent.** MEASURED 2026-09-10: `scripts/prod-prober/arms/mt5.mjs:113-117` sets `out["terminal_info"]` to the string `"present"` or to `None`, and nothing else. Those are precisely the **two fields `docs/runbooks/mt5-go-live.md` Step 2 names as the verification** (*"`terminal_info()` must report **`connected: true` AND `trade_allowed: true`** — both, not either"*), and precisely the two that separate "the terminal is not connected to the broker" from "the terminal is connected but the account is not authorized". Because the probe collapses them, a `-6` cannot be attributed from the prober's output at all. ⛔ This is the gate weaker than the sentence beside it: the runbook states a two-field criterion and the instrument that is supposed to check it records neither field.

8. **The narrowed `--arm` diagnostic PUBLISHES what it measured.** MEASURED 2026-09-10 on dispatch run `34497471175`: `--arm mt5` printed `NARROWED DIAGNOSTIC dispatch of arm mt5: this mode never returns success.` and then `Process completed with exit code 1` — **no arm output at all**, because the step redirects the runner into `$RUNNER_LOG` and the narrowed path neither prints it nor uploads it. The one mode built for "tell me about this arm" is the one mode that tells you nothing, so the operator falls back to the full gate and the issue comment. Either echo `$RUNNER_LOG` on the narrowed path or upload it as an artifact; the mode's exit-2/never-green contract stays exactly as it is (`run.mjs:11,464`).

⚠️ **DATED 2026-09-10 — the second time this remedy cost real debugging time, and the root cause is now on record.** The founder hit `-6` again and worked it with the assistant. What the remedy sent them to (the MT5 error table, "the fault is inside MT5 itself") was not where the answer was. The answer was in the terminal's own **Journal**, and it was unambiguous:

```
2026.09.07 04:05:03  '26547876': disconnected from VantageMarkets-Live 5
2026.09.07 04:05:08  '34043761': authorization on VantageMarkets-Live 14 failed (Invalid account)
2026.09.10 15:48:25  '34043761': authorization on VantageMarkets-Live 14 failed (Invalid account)
```

The terminal dropped a working session and re-attached to an account it could not authorize, then failed identically for three days. Resolved 2026-09-10 ~16:10Z by re-entering valid credentials — `authorized on VantageMarkets-Live 14 through AS05 (ping: 6.97 ms)`, `investor mode` on both trading and balance management. Verified by prober run `34500455961`, whose `Open or update the prod-prober issue` step was **skipped** (that step is gated on a `^❌` line, so skipped ⇒ zero defects); issue #753 closed. ⭐ **Criterion 2's remedy text should name the Journal explicitly** — it is the one place that distinguishes "invalid account" from "no connection", and neither the prober nor `mt5-diag.sh` can currently tell them apart.

**Requirements**: TBD (no v1.20 requirement IDs) + GitHub issue #753 (`prod-prober` red since 2026-09-07)
**Depends on:** Phase 164.1 (owns the prober's MT5 arm and its defect vocabulary)
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.8.3 to break down)

### Phase 164.8.2: GATEHARDENING — the five code-review warnings Phase 164.8 shipped: the VAC-08 frontier exemption gets a ceiling, the ledger drift-check gets an arms ratchet, the reverted-grep stops being NUL-blind, the destructive restore's artifact stops carrying unredacted policy text, and the softening-token scan reaches the workflow that can drop a schema (INSERTED)

**Goal:** Close the five Warnings `gsd-code-reviewer` raised against Phase 164.8's own gates. Every one is a control that is weaker than it reads, and two of them are the SAME shape: the phase hardened one half of a twin pair and left the other. None was user-facing or data-integrity, so none blocked the ship — they are booked here rather than fixed under merge pressure.

⛔ **INSERTED 2026-09-09 at Phase 164.8's review gate.** The sixth Warning, WR-01, is NOT here: it was a proven-live command substitution in a script that assembles `DROP SCHEMA public CASCADE`, so it was fixed in 164.8 itself (`ec94788b`) with arm 26 legs (f) and (g). The five below are real but not acutely exploitable.

⚠️ **Read the review before planning, do not re-derive:** `.planning/phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-REVIEW.md` carries each finding with its file:line, its failure scenario and the reviewer's own measurements. Seven Info findings are in the same file and are in scope for whoever plans this.

**Success Criteria:**

1. **WR-02 — the VAC-08 frontier exemption gets a ceiling.** `scripts/test-ledger-drift-check.sh:425-476`. Today the exemption is unbounded: one failed TEST apply (the booked `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`) leaves every later migration above the tip, so every one is exempted and the ledger-presence ratchet prints `0 NEW drift` indefinitely. Branch protection is deferred, so the bad merge stands. The fix needs a bound whose breach is LOUD.
2. **WR-03 — the same script gets an arms ratchet.** `:815-819` has no `EXPECTED_ARMS`, so deleting an arm reads as a smaller PASSED. The three frontier arms are exactly the ones a cleanup would take, which would leave criterion 1 unarmed. ⭐ The sibling `restore-test-from-baseline.sh` already carries the correct shape — conform to the neighbour, do not invent a second one.
3. **WR-04 — the reverted-grep stops being NUL-blind.** `.github/workflows/supabase-migrate.yml:858` is a NEGATIVE check without `-a`. This repo has a MEASURED rule that grep goes silently blind on a file the locale calls binary and that exit 1 then reads as clean. One byte from `supabase migration list` and `apply` pushes to PROD on a check that never read the file.
4. **WR-05 — the destructive restore's artifact stops carrying unredacted text.** `.github/workflows/test-restore-from-baseline.yml:1407-1411`. Seven script-written files reach the world-readable artifact through neither the secret scan (which runs BEFORE they are written) nor the redaction (whose globs are `*.err/*.log/*.out`). `pre-census.txt` carries reconstructed `CREATE POLICY … USING (<qual>)` and owner-named rows read off live shared TEST. ⛔ The step comment currently states the opposite scope — fix the comment with the code, or the next reader inherits the same false assurance. ⛔ **AMENDED 2026-09-09, and this was not foreseen when the area was decided:** `survivors.sql` IS the reversal recipe AND carries the policy DDL — it is `awk '$1=="survivor" {print $4}'` of `pre-census.txt`, and column 4 is `pg_get_triggerdef(...)` plus a reconstructed `CREATE POLICY … USING (<qual>)`. Founder decision: the DDL appears exactly ONCE, in the file that needs it. `survivors.sql` STAYS; `pre-census.txt`, `post-census.txt` and the two `*-rollback-view.txt` files leave. That is the intent the script already booked as threat `T-164.8-21`. ⚠️ The review's count is wrong: **10 of 18** files pass through neither control, not seven — regenerate the list, do not carry either number.
5. **WR-06 — the softening-token scan reaches the workflow that can drop a schema.** `src/__tests__/test-restore-workflow-wiring.test.ts:210`. Phase 164.8 widened the scan 5 → 9 tokens for `supabase-migrate.yml` and left the DESTRUCTIVE workflow on the 5-token list. The asymmetry is backwards: the restore workflow is the one that cannot be undone by a re-run. ⛔ **SCOPE AMENDED 2026-09-09 — it is a TRIPLET, not a pair.** The pattern-mapper measured a third byte-identical 5-token copy at `src/__tests__/prod-prober-wiring.test.ts:93`, outside the review's file list. Fixing two of three members leaves the class intact, so the third is in scope. Taken without a new founder question because it is measured FREE: `prod-prober.yml` contains **0** occurrences of all four extra tokens, so no allowlist is needed there. The cost that does exist is `test-restore-from-baseline.yml`'s **11** `2>/dev/null` sites — that triage IS this criterion's work and was always in scope. (`supabase-migrate.yml` carries 6 and already ships the 9-token list; read how its twin tolerates them before copying.) ⚠️ Counts measured 2026-09-09 with `grep -cF` — regenerate, do not trust.
6. **Every fix carries a falsifier that was observed RED.** ⛔ Not negotiable here: four of these five findings are controls that pass while measuring nothing, so a fix without an arm that bites reproduces the exact defect class. Neuter, observe RED, restore from pristine bytes — never `git checkout --`.

**Requirements**: TBD (no v1.20 requirement IDs) + the five Warnings and seven Info findings in `164.8-REVIEW.md`
**Depends on:** Phase 164.8
**Plans:** 5 plans

Plans:

- [ ] 164.8.2-01-PLAN.md — WR-03 arms ratchet then WR-02 `FRONTIER_EXEMPT_CEILING` in `scripts/test-ledger-drift-check.sh`, with vitest second layer + SC-9 registration (wave 1)
- [ ] 164.8.2-02-PLAN.md — WR-04 `grep -a` on both C-0331 sites of `supabase-migrate.yml` with an executed NUL-fixture arm; IN-03, IN-04 (wave 1)
- [ ] 164.8.2-03-PLAN.md — WR-05 artifact narrowing by an enumerated staging step (founder-amended set), four truthful comments, WR-04's two post-verify greps, IN-07 (wave 1)
- [ ] 164.8.2-04-PLAN.md — WR-06 nine-token scan across the TRIPLET with an exact-set `2>/dev/null` allowlist (wave 2, after 02 and 03)
- [ ] 164.8.2-05-PLAN.md — IN-06 MEASURE_FAIL wrap with a sourced-copy falsifier; IN-01, IN-02, IN-05 record corrections pinned by derivation (wave 2, after 03)

### Phase 164.5.1: CRONREPOINT — the live `match_engine_cron` row is repointed at the mechanism the repo actually describes, and the migration-vs-runbook rule is settled first (INSERTED)

**Goal:** Close `CRON-DRIFT-01`'s LIVE-ROW half: PROD's `cron.job` jobid 1 runs a hand-repaired 2026-09-01 command that exists in no migration, so a rebuild from migrations does not reproduce it. ⛔ **CORRECTED 2026-09-09 — this sentence used to say the rebuild "reproduces the *unrunnable* GUC-reading job"; that is FALSIFIED, see DECIDED D2 below.** `20260408215026_schedule_match_cron_hourly.sql` reads `app.analytics_service_url` / `app.analytics_service_key` and, when either is empty, takes a skip branch: `RAISE NOTICE`, one `cron_runs` row `status='error', error='GUC unset at migration 015'`, `RETURN` — it never reaches its `cron.schedule`. Those GUCs cannot be set on this platform (`ALTER DATABASE`/`ALTER ROLE` → 42501, measured on PROD 2026-09-05, `scripts/lint-app-guc.mjs:429`: *"this read resolves to NULL wherever it runs"*), so the skip branch is the ONLY branch here. ⛔ **This phase was SPLIT OUT of Phase 164.5 on 2026-09-07 by founder decision, because it is the ONLY item that sits on an unresolved conflict — and nothing should be built on one.**

**⛔ THE CONFLICT — settle it BEFORE writing anything.** Two authoritative sources disagree, and they must not be averaged:

- **Phase 164.5's old criterion 7** said: "Write ONE forward migration re-scheduling `match_engine_cron` to the achievable Vault-backed command."
- **Migration `20260907120000_analytics_service_settings_and_vault_tick.sql:14-21`**, merged 2026-09-07, says: it "REGISTERS NO SCHEDULE and REMOVES NONE … **A migration that schedules is a scope violation**, and the runbook rule it would break is stated in `docs/runbooks/ledger-refresh-go-live.md`: the registration statement lives THERE and never in a migration."

The 164.7 rule is the more recent, shipped and tested convention, and `docs/runbooks/ledger-refresh-go-live.md:412` already carries a live `cron.schedule` registration as its established pattern. ~~⚠️ But honoring it alone does NOT close the reproducibility gap: a fresh apply of `20260408215026` still WRITES the broken job.~~ ⛔ **FALSIFIED 2026-09-09, struck and kept as lineage — the migration takes a skip branch and writes NO job. See D2.** What remains true is that the phase must STATE what a rebuild produces; D2 states it. ~~**Decide this in discuss/plan, record it, do not let an executor pick.**~~ ⛔ **ANSWERED 2026-09-09 — struck, kept as lineage. There is nothing left to decide; see DECIDED below. Do not re-open it in discuss.**

⭐ **NARROWED 2026-09-09 — the convention half is settled by precedent; only the rebuild half is still open.** When this phase was split out, migration-vs-runbook read as a live two-way conflict. It no longer does: the 164.7 rule is shipped AND the tree now carries **two** independent runbook registrations following it (`ledger-refresh-go-live.md:412`, `flipretry-derived-equity-go-live.md:162`). Under this project's own rule — on a contradiction take the more recent and more tested convention, never average them — the answer is determined. ⛔ What is NOT determined, and is the real content of criterion 1, is the SECOND half: `20260408215026` still writes the GUC-reading job on a fresh apply, and the 164.7 rule forbids a migration from removing a schedule as firmly as from adding one (*"REGISTERS NO SCHEDULE and REMOVES NONE"*). So a rebuild-from-migrations produces a job that only the runbook step then replaces. That has to be STATED, with its window named. Settling it is a sentence, not a decision — do not re-litigate the convention.

⭐ **DECIDED 2026-09-09 — nothing in this phase is left to choose.**

⛔ **This block exists so the phase can be planned and executed without a single judgement call. Each entry is an ANSWER with the measurement or precedent it rests on. A planner records these; it does not re-derive them. The ONE thing that is still a gate is D4 — and it is a human gate on purpose, not an open question.**

- **D1 — Registration lives in the RUNBOOK, never in a migration.** Basis: the 164.7 rule shipped in `20260907120000` (*"A migration that schedules is a scope violation"*), plus two in-tree precedents already following it (`ledger-refresh-go-live.md:412`, `flipretry-derived-equity-go-live.md:162`). The losing convention — Phase 164.5's old criterion 7 — is flagged for cleanup, not left to disagree silently.
- **D2 — What a rebuild-from-migrations produces: NO `match_engine_cron` job at all, plus one loud row.** MEASURED, not assumed: `20260408215026` skips scheduling whenever the two `app.*` GUCs are empty, and they are ALWAYS empty here because setting them returns 42501 on this platform. So a rebuilt database has no hourly job and one `cron_runs` row reading `error = 'GUC unset at migration 015'`, and the runbook registration is what creates the job. ⭐ This is the runbook convention working as designed — the migration fails CLOSED and leaves a trace — not a gap to be patched. ⛔ Therefore **no forward migration is written by this phase**, neither to schedule nor to unschedule. The window to name in the runbook is: *from a rebuild until the registration step is run, the hourly recompute does not fire, and `cron_runs` says why.*
- **D3 — The manifest re-capture is a SCRIPT, not hand work.** `scripts/prod-prober/` has no capture tool today. Criterion 3 already demands a pre-flight that ABORTS on a live-vs-manifest mismatch, which is code either way; the capture is the same read plus a write, and the drift arm compares by `command_sha256` and refuses a row without a valid one — so a hand-edited manifest is a defect waiting to happen. Write the small script, use it for the re-capture, commit both.
- **D4 — The PROD apply stays a HUMAN gate, and this block does not weaken it.** Criterion 5 is unchanged: three reviewers (`migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`) before any production statement, and the founder runs or approves the live `cron.schedule`. Everything above removes *guesswork*, not *oversight*.

**⚠️ MEASURED 2026-09-07 — two clauses of the old criterion 7 are FALSIFIED, do not re-derive:**

1. The ROADMAP claimed `grep -rn decrypted_secrets supabase/ scripts/ src/` "returns ZERO hits". It now returns **3 migration files** — `20260408215026`, `20260408113029` and `20260907120000`. The first two are `-- APP-GUC-LINEAGE:` annotation comments **Phase 164.7 itself added** in commit `14b3b6c3`. The claim was true when written and our own work falsified it, so the old scoring clause ("`grep …` returns the new migration") **no longer discriminates** and must be replaced with a real oracle.
2. **Manifest-oracle collision.** `scripts/prod-prober/cron-manifest.json` jobid 1 (captured 2026-09-06) carries `decrypted_secrets` and does **NOT** carry `match_engine_cron_tick`. PROD matches it TODAY, so Phase 164.1's cron-drift arm reads ZERO drift right now. Repointing the row makes that arm RED unless the manifest is re-captured in the SAME phase. The re-capture is therefore part of this phase, not a follow-up.

**⭐ MEASURED 2026-09-09 — THE GATE IS LIFTED, and three of the four remaining pieces are mechanical.** ⛔ These are dated readings bound to a run or a session, not constants; regenerate rather than trust.

1. **`[A1]` HELD — it no longer gates the repoint.** `docs/runbooks/match-engine.md` carried it as NOT measured and as *"it gates the 164.5 repoint"*: whether a `SECURITY DEFINER` function owned by `postgres` may read the real encrypted `vault.decrypted_secrets` on a hosted Supabase project. Read by the founder in the **shared TEST** SQL editor: `has_schema_privilege('postgres','vault','USAGE')` → **true**, `has_table_privilege('postgres','vault.decrypted_secrets','SELECT')` → **true**. The hosted constraint was genuinely present in that same session — `vault.decrypted_secrets` owned by **`supabase_admin`** (not `postgres`), `postgres` **NOT** a superuser, `supabase_vault` installed — so the reading is load-bearing rather than an artefact of an over-privileged role. `SECURITY DEFINER` executes as the OWNER, so those two privileges are what the callable needs. Corroborated by a different instrument: PROD's jobid 1 already performs this same Vault read hourly as `username: postgres` and succeeds (`net._http_response` id 3485 → 200, 2026-09-01). Recorded in `docs/runbooks/match-engine.md` by commit `e2645ebf`.
   ⚠️ **Still NOT proven, and the phase must not upgrade it by retelling:** no `SECURITY DEFINER` wrapper was EXECUTED against the real Vault — the ACL was read, the function was not called, because calling the shipped `match_engine_cron_tick()` fires a real `net.http_post` at the production analytics service. The wrapper is expected to be a role no-op (definer `postgres`, caller `postgres`); that is an argument, not a measurement. ⛔ The pg-lane cannot answer this class at all — its vault is a plaintext stand-in. Do not "confirm" A1 from a lane run.
2. **The callable already EXISTS on both projects.** `public.match_engine_cron_tick()` is present on shared TEST (`to_regprocedure` non-null, measured in the same session) and its migration `20260907120000` is merged, so it is live on PROD too. This phase does not build the replacement — it points the live row at one that is already there.
3. **The registration statement does NOT exist yet.** `grep -n "cron.schedule" docs/runbooks/*.md` finds `ledger-refresh-go-live.md:412` and `flipretry-derived-equity-go-live.md:162` — two in-tree precedents for the runbook convention — and **nothing for `match_engine_cron`**. Writing that section is this phase's work.
4. **There is no manifest re-capture script.** `scripts/prod-prober/` contains `cron-manifest.json` and no capture tool, so the re-capture in criterion 2 needs one — **decided in D3: write the script.** The drift arm compares by `command_sha256` and refuses a row without a valid one, so the sha must be regenerated, not edited.
5. **The dependencies are shipped**, despite `roadmap analyze` reporting 164.1 and 164.7 as `empty` — that is the known under-report for phases whose `.planning/phases/` artifacts the `-pr` filter stripped from `main`, NOT an unfinished phase. The code is present: `scripts/prod-prober/{run.mjs,cron-manifest.json}` + `.github/workflows/prod-prober.yml` (164.1), `20260907120000` + `scripts/lint-app-guc.mjs` + `supabase/schema/functions/match_engine_cron_tick.sql` (164.7), and 164.4.1 reports `complete`.

**Success Criteria**:

1. **D1, D2 and D3 above are TRANSCRIBED into CONTEXT.md verbatim with their measurements, not re-derived and not re-opened.** ⛔ This criterion used to read *"the conflict is settled EXPLICITLY"*; it was settled on 2026-09-09 and the criterion is now a recording step. The runbook text names D2's window — from a rebuild until the registration runs, the hourly recompute does not fire and `cron_runs` says why. The losing convention (Phase 164.5's old criterion 7) is flagged for cleanup, not silently left to disagree.
2. After the repair, Phase 164.1's cron-drift arm reports ZERO drift for `match_engine_cron` against the committed manifest, and the manifest re-capture is part of this phase.
3. The pre-flight ABORTS non-zero WITHOUT writing when the live jobid 1 command does not match the manifest — proven by running it against a deliberately mismatched manifest, not by inspection. Never infer from an absent measurement.
4. A rebuild-from-migrations no longer produces the unrunnable GUC-reading job, and the phase states plainly what it DOES produce.
5. ⛔ Production DDL on a credential-bearing cron row: three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply.
6. Every "Phase 164.5 item 7" reference in the tree is repointed at this phase — 5 source files (`20260408215026`, `20260408113029`, `20260907120000`, `scripts/lint-app-guc.mjs`, `docs/runbooks/match-engine.md`) plus `TODOS.md`. ⚠️ `lint-app-guc.mjs` carries a count-pinned `LINEAGE_ALLOWLIST`; a comment edit must not move those counts.

**Superseded criterion, kept verbatim for lineage (was Phase 164.5 criterion 7):**

> CRON-DRIFT-01-REPAIR: after the migration applies, Phase 164.1's cron-drift arm reports ZERO drift for `match_engine_cron` against the committed manifest, and `grep -rn decrypted_secrets supabase/migrations/` returns the new migration. The pre-flight ABORTS non-zero WITHOUT writing when the live jobid 1 command does not match the manifest — proven by running it against a deliberately mismatched manifest, not by inspection.

⚠️ PROD is currently CORRECT (verified 2026-09-01, `net._http_response` id 3485 returned 200). **This closes a REPRODUCIBILITY gap, not an outage** — there is no time pressure, which is exactly why settling the convention first is affordable.

**Requirements**: TODOS entries CRON-DRIFT-01 (the REPAIR/LIVE-ROW half only — the DETECT half is Phase 164.1's), `[164.7-VAULT-ABSENT-RULE]`, `[VAULTTICK-EMPTYKEY-01]`, `[164.7-ACTIVATION-DEFERRED]` (⚠️ a DISTINCT operation — registering `ledger_refresh_fanout` and flipping `system_flags.ledger_refresh_enabled` — routed here ONLY because it mutates the SAME `scripts/prod-prober/cron-manifest.json` this phase re-captures; 164.7-07-SUMMARY names the coupling: whichever lands second MUST re-capture or the cron-drift arm reports drift on every hourly run. Re-entry gate is P3-C after the 04:00Z/05:00Z ticks) (⚠️ added 2026-09-10: the whitespace-key hole is IN the callable this phase repoints jobid 1 at — `match_engine_cron_tick()` tests `v_key = ''` not `btrim(v_key) = ''`, and a whitespace secret is sent as the `X-Service-Key` header, producing the 401 that `CRON-DRIFT-01` exists because of) (⚠️ added 2026-09-11 from Phase 164.8.5's review loop: `[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` — `compareManifest`'s MANIFEST-side hygiene loop sits BELOW all three early returns and is DEAD on every production run today, because the committed manifest declares `normalization: ws-collapse-v1` while the arm computes `ws-collapse-v2`. ⭐ THE RE-CAPTURE THIS PHASE PERFORMS CLEARS `manifest-invalid` AND THEREBY SILENTLY RE-ANIMATES THAT LOOP — a check that has not run for weeks starts running again as a side effect of an unrelated action, so expect manifest-side `cron-secret-in-command` findings that nobody has seen before and do not read them as new leaks. Measured: valid manifest → 1 manifest-side credential defect; v1 / wrong schema_version / marker mismatch → 0. NOT graded Critical because decision D1 hoisted the PROD-side loop above every `return`, so a credential LIVE IN PROD is still reported on all those paths)
**Depends on:** Phase 164.1 (its committed cron manifest is this phase's oracle), Phase 164.7 (the settled `app.*` replacement mechanism — `system_settings` + Vault — which this MUST consume rather than invent a second answer), Phase 164.4.1 (pg-lane with pg_cron)
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.5.1 to break down)

### Phase 164.5.2: BRIDGELOCK — the per-strategy advisory lock 161.1-D1 asked for, in its own phase as DEC-4 required (INSERTED)

**Goal:** Close `161.1-D1`: `mark_compute_job_done` and `mark_compute_job_failed` both fan into the bridge without serializing per strategy, so two concurrent terminal marks on one strategy can interleave. Add a per-strategy advisory lock to BOTH RPCs, with a real concurrency test observed RED without the lock and GREEN with it.

⛔ **SPLIT OUT of Phase 164.5 on 2026-09-07 by founder decision, honoring `TODOS.md` DEC-4** — *"the D1 advisory lock gets its OWN phase, with a real concurrency test."* Phase 164.5's criterion 6 had folded it into a single clause, which is exactly the compression DEC-4 refused. Its plan was written to lift without rework, is file-disjoint from every 164.5 sibling, and does NOT contribute to VAC-07's scoring fence — so lifting it blocked neither criterion 6 nor VAC-07.

**⚠️ MEASURED before planning, do not re-derive:**

- **`mark_compute_job_done` is redefined NINE times across `supabase/migrations/**`.** The new body MUST be re-based on the LATEST definition, or nine migrations' worth of change is silently reverted by a `CREATE OR REPLACE`. This is the single largest risk in this phase.
- It is DIFFERENT work from Phase 164.5's VAC-07 spec: different objects (`compute_jobs` mark RPCs vs `wizard_session` csv-finalize) and different substrates (bare pg-lane here, the local-stack lane there).
- Scope: ONE migration `CREATE OR REPLACE`ing TWO RPCs, plus a new `RED-UNDER`-annotated SQL gate on the pg-lane, plus a move of BOTH mutation-runner floors.

**Success Criteria**:

1. Both `mark_compute_job_done` and `mark_compute_job_failed` take a per-strategy advisory lock, each body re-based on its LATEST definition — proven by showing the pre-edit body was read from the newest migration defining it, not an older one.
2. The concurrency test is observed RED with the lock removed and GREEN with it restored. ⛔ Two connections with genuinely separate sessions — a single-client `Promise.all` CANNOT produce a race and is a test that cannot fail.
3. The new SQL gate carries `RED-UNDER` annotations the mutation runner PROVES bite, and both `FILES_FLOOR` and `ARMS_FLOOR` move. ⚠️ Read those constants BY SYMBOL from `scripts/mutation-runner/run.mjs` — CLAUDE.md's prose has already drifted from them once.
4. Arm failures print `TEST FAILED (X):`, not `ARM x FAILED` which the runner's identity regex cannot see. An arm no production mutation can redden is labelled an INVARIANT rather than counted.
5. ⛔ Production DDL: merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD, so three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply, and the apply is a founder gate.

**Requirements**: TODOS entries `161.1-D1`, DEC-4
**Depends on:** Phase 164.4.1 (pg-lane with pg_cron). ⚠️ NOT Phase 164.5 — the plan is file-disjoint from it and was lifted whole.
**Plans:** 1 plan (lifted from Phase 164.5 plan 08, unmodified)

Plans:

- [ ] 164.5.2-01 — the advisory lock in both mark RPCs + the concurrency gate (lifted from 164.5-08)

### Phase 164.6: GATE-HYGIENE — every gate-hygiene item that left 164.1: the OPS-08 residue, the composite-stamp twin, the reviewer execution-status rule, the RED-UNDER convention's discoverability and the audit allowlist (INSERTED)

**Goal:** Close the gate-hygiene half that the 2026-09-05 re-partition removed from 164.1, each with a test that is observed to fail when its guard is neutered. (1) **OPS-08-F9**: `test_enqueue_internal_destrict.sql` gets its `ALL N ARMS EXECUTED` sentinel AND the two `ci.yml` integers (`SENTINEL_FLOOR`, `ARMS_FLOOR` — read the LIVE values off `ci.yml`; the `7→8` / `63→68` in the TODOS entry are 2026-08 figures) move in ONE diff with the per-file derivation entry `ci-anti-skip-gate.contract.test.ts` reads. (2) **OPS-08-F8**: the `sql-tests` loop stops exiting on first failure — every file runs, every red file is named, exit is non-zero once. (3) **OPS-08-TS**: nothing in `src/` retries a 40001 — `csv-finalize/route.ts:2044` is a COPY branch, not a retry, and `allocator/holdings/sync/route.ts:73-86` has no 40001 arm; add the retry at BOTH call sites. (4) **OPS-08-F2**: both pg_cron fan-out paths catch `WHEN OTHERS` and report success; record the failed target id and surface a non-zero failure count from the tick. (5) **Composite-stamp twin (161.1-D13), TS half**: Python honours the marker (`long_fetch.py:66`); the two TS enqueue sites have zero `retract`. (6) **PROC-02**: reviewers declare execution status and UNEXECUTED blocks — one agent-prompt field, the cheapest item in the corpus. (7) **PROC-03 residual**: the per-arm `RED-UNDER` convention SHIPPED in 164.4/164.4.1; what remains is discoverability — `scripts/mutation-runner/GRAMMAR.md` is referenced by nothing a newcomer reads. (8) **H-0001 residual**: shrink the `H_0001_UNCOVERED_ALLOWLIST` — it has SEVEN entries while both ledgers still say six; fix the count and the routes. Also carries WINDOWS 23 (the FALSE "Referrer-Policy does not strip" claim still at `gone/route.ts:93` and `route.test.ts:66` — a one-line correction pass). (9) **MYPY-MAINPY-01** — `analytics-service/main.py` is 930 lines of RUNNING-SERVICE code (`uvicorn main:app`) sitting OUTSIDE the `mypy --strict` gate, while that gate's own comment at `ci.yml:3209-3216` states the strict floor "now covers ALL running-service code — `services/` (part g), `routers/` (part h), and `models/` (part i)". ⭐ **The claim is FALSE and the comment is the item, not the annotations.** Nothing under those three packages imports `main.py`, so `--follow-imports=silent` never reaches it, and `python3 -m mypy --strict main.py` reports 5 errors: `:255` `lifespan(_app: FastAPI)`, `:309` `_crash_handler` (missing `Task[None]`), `:741` ×2 `verify_service_key(request, call_next)` and `:891` `health()`. MEASURED on BOTH sides of Phase 164.1-02 — the identical five, one line number shifted by the +34 lines that plan added — and recorded in `.planning/phases/164.1-…/deferred-items.md`. ⚠️ Two of the five sit on the service-key middleware Phase 164.1 just hardened for PYAPI-06, and one on the `/health` endpoint 164.1's own prober arm polls, so the untyped surface is exactly where this milestone is working. A gate that ASSERTS complete coverage while blind to the service's entry module is this milestone's named defect class, which is why this is booked here rather than left to a typing backlog with no phase, no date and no gate. DELIVERABLE: annotate the three functions, add `main.py` to the `ci.yml` mypy invocation, and CORRECT the comment to name the real surface. ⛔ NOT in scope: `analytics-service/tests/` (5,439 strict errors across 182 files) — `TODOS.md:3263` and `:5197` already hold that as an OPEN POLICY question ("B-mypy part j, or record tests/ as permanently out of strict scope"). Folding it in here would smuggle a milestone-sized decision into a hygiene item. (10) **PROBER-CALIBRATION-01** — the calibration arm named `CALIBRATION: an UNGUARDED exit 0 on the probe path is still caught` (`src/__tests__/prod-prober-wiring.test.ts:292`, shipped in PR #748 / v0.77.15.0) does NOT demonstrate catching. It mutates the schedule guard to `if true; then`, then asserts only that the text changed and that the mutant no longer contains the guard string — it never re-runs the assertion it claims to calibrate (the `guardAt` / `exitZeroAt` ordering check at `:279-281`) against the mutant and observes it FAIL. ⭐ The arm would still pass with `:279-281` deleted outright, so it certifies nothing about that assertion's power. ⚠️ NOT vacuous in effect — removing the guard from the workflow IS caught, by the `toContain` at `:277` — but the arm's NAME promises a proof it does not perform, which is precisely the 'a test that cannot fail' shape this milestone exists to remove, sitting inside the prober that Phase 164.1 built to make silent failure loud. FOUND at the #748 merge gate 2026-09-06 by hand, not by a gate; booked here by founder instruction rather than into TODOS. DELIVERABLE: make the calibration EXERCISE the assertion — run the guard-position check against the mutant inside an `expect(...).toThrow()` (or the equivalent shape the file already uses for its other calibration arms, e.g. the phase-19-stability splice arm immediately below it), so the arm goes RED if `:279-281` is weakened or removed. (11) **MT5-GATEWAY-LOGIN-01** — the MT5 terminal's broker session is established ONCE, BY HAND, over VNC, and NOTHING re-establishes it. MEASURED 2026-09-06 while diagnosing issue #747: the prober's credential-less `mt5.initialize()` (`scripts/prod-prober/arms/mt5.mjs:112`; `initialize()` carries no credentials, `mt5_client.py:984`) returned **-6, authorization failed**, while the RPYC bridge was healthy — gateway logs show `accepted`/`welcome`/`goodbye` cycles including the prober's own `127.0.0.1` probe. So the IPC remedies do NOT apply and the fault is the terminal's SAVED SESSION being refused by the broker. `railway variables --service mt5-gateway` carries **no** `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` — only the VNC `CUSTOM_USER`/`PASSWORD`, `mt5server_port` and a `Vantage_investor_password_26547876`. The session lives solely in the Wine prefix on the `/config` volume, exactly as `docs/runbooks/mt5-go-live.md:146` Step 2 (MT5GW-01) prescribes: a ONE-TIME VNC login with 'save account / auto-login'. ⭐ The credentials are not the root cause — the absence of any re-establishment is. Any rotation, expiry or volume event takes MT5 down SILENTLY, and it stayed silent until 164.1's prober went looking, which is that phase's whole argument. DELIVERABLE: make login env-driven — `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` as Railway variables with the gateway performing `login()` at startup, so a restart self-heals; investor credentials suffice (we only read equity and positions). SECOND: give **-6 its own defect kind and remedy** in the mt5 arm — today it falls into the generic `mt5-terminal-error` bucket whose remedy correctly says 'read the error table', which is honest but makes the reader do the lookup by hand. ⚠️ ADJACENT to MT5-VERDICT-SINK-01, already in this phase: that is a CAPABILITY verdict with no durable sink, this is SESSION ESTABLISHMENT. ⛔ NOT in scope: entering any credential — the VNC login is founder-performed, and this phase only removes the need to repeat it. (12) **CI-DOCSPATH-01** — a PR that changes NO code runs the entire gate corpus. ⭐ MEASURED on PR #750 (2026-09-06), whose diff is FOUR `.planning/` markdown files and zero code, zero SQL, zero migrations: **21 jobs, ~3,001 job-seconds (~50 min)**, and that total EXCLUDES `e2e-seeded` and `sql-tests` which were still running when the census was taken. The expensive ones all ran in full — `sql-mutation` 559s, `python` 494s, `e2e` 405s, `frontend-test` 368s+344s, `lighthouse-mobile` 305s. Worse than wasted minutes: `e2e-seeded` and `sql-tests` each take the shared-TEST-DB advisory mutex, so a roadmap typo fix QUEUES BEHIND and DELAYS real code PRs on a database shared with other people's CI. DELIVERABLE: a `paths-ignore`/path-filter so a diff touching only `.planning/**` (and other pure-docs paths) skips the code-gate jobs. ⛔ ANTI-VACUITY IS THE WHOLE RISK, and it is why this is booked HERE rather than in TODOS: a path filter that skips jobs has exactly the shape of a gate silently not running, which is this milestone's named defect class. The filter is NOT shippable on the evidence that a docs PR went fast — it is shippable only on evidence that a CODE PR still runs everything. ⚠️ Beware the GitHub trap that `paths-ignore` on a REQUIRED check reports *pending forever* rather than *passed*, wedging branch protection; whichever mechanism is chosen (job-level `if:` on a changed-files step is usually safer than workflow-level `paths-ignore`) must be demonstrated not to wedge the `frontend` aggregator. ⛔ NOT in scope: changing WHICH gates exist, or their contents — this is about when they are invoked, nothing else.

**Success Criteria**:

1. OPS-08-F9 + F8: the sentinel is present, both integers moved in the same commit and the contract test passes; `sql-tests` runs every file and names every red one in a single run — proven with two deliberately red fixtures in one invocation.
2. OPS-08-TS: both TS call sites retry on 40001, each with a test that fails when that site's retry is removed. A test that passes with the retry gone at either site does not count.
3. OPS-08-F2: a failed fan-out target produces a non-zero failure count from the tick, proven on the pg-lane with one target forced to raise.
4. The composite-stamp twin's TS half is closed with a test that fails when the `retract` is removed at either enqueue site.
5. PROC-02, PROC-03, H-0001: the reviewer prompt carries an execution-status field and a review of an unexecuted change is BLOCKED by it (proven once on a fixture); `GRAMMAR.md` is linked from a file a newcomer actually reads (`supabase/tests/README` or `CLAUDE.md`'s SQL-gate section); the allowlist is ≤ 6 entries and both ledgers state the same number.
6. MYPY-MAINPY-01: `mypy --strict` covers `main.py` in `ci.yml` and the comment above the invocation names the REAL surface, with no remaining claim of coverage the command does not deliver. ⚠️ ANTI-VACUITY: the widened gate is PROVEN able to fail — one annotation is removed, the exact CI command is observed RED naming that line, and it is restored byte-identically (`shasum -a 256` before == after, never `git checkout`). A gate widened without that proof is the defect Phase 164.3 exists to remove, not a fix. The `analytics-service/tests/` policy question is explicitly untouched and stays open in TODOS.
7. PROBER-CALIBRATION-01: the prober's UNGUARDED-exit-0 calibration arm is proven to have power over the assertion it names — the arm runs the `guardAt`/`exitZeroAt` check against the mutated workflow text and asserts that check FAILS. ⛔ Proven by DELETING `prod-prober-wiring.test.ts:279-281` and observing the calibration arm go RED (it is GREEN today with those lines gone, which is the whole defect), then restoring byte-identically — `shasum -a 256` before == after, never `git checkout --`. An arm that still passes with its subject deleted has not been fixed.
8. MT5-GATEWAY-LOGIN-01: the gateway re-establishes its broker session WITHOUT a human — proven by RESTARTING the mt5-gateway service and observing the prober's mt5 arm return no defect afterwards, with no VNC session in between. ⛔ A green arm on a terminal that was logged in by hand before the restart proves nothing; the restart must come FIRST and the login must be re-made by the service. AND `-6` reports as its own defect kind with its own remedy, proven by the self-test isolating it from `mt5-no-ipc`, `mt5-ipc-timeout` and the generic terminal-error arm the way scenarios 20/21 already isolate -10004 from -10005.
9. CI-DOCSPATH-01: a docs-only PR no longer runs the code gates, AND a code PR still runs every one of them. ⛔ BOTH halves are required and the SECOND is the real criterion — proven on TWO real pushes, not on reasoning: (a) a `.planning/**`-only diff, showing the skipped set; (b) a diff touching one `src/**` file AND one `supabase/migrations/**` file, showing `sql-mutation`, `sql-tests`, `e2e-seeded`, `python`, `frontend-test` and `migration-drift-check` all still EXECUTE (not "skipped", not "pending"). A filter demonstrated only on half (a) has not been demonstrated. ⚠️ ALSO required: the `frontend` aggregator still reaches a terminal state on the docs-only PR — a required check left permanently pending wedges branch protection and is a WORSE outcome than the 50 minutes this saves.

10. `[PLANANCHOR-SUMMARY-FILTER-01]`: a plan that has SHIPPED stops reading as pending on `main`, so `plan-anchor-verify` no longer holds its `file:line` anchors live against a tree that has moved on. ⛔ **The gate must NOT be weakened to achieve this** — the fix belongs in how "pending" is decided, never in how anchors are resolved; a change that makes the gate resolve FEWER anchors fails this criterion by definition, because that is the silent-gate class this milestone exists to remove. BOTH halves are required and the second is the one that can go missing silently: (a) a landed phase's PLAN.md, whose SUMMARY the `-pr` filter stripped, no longer appears in `--pending`; (b) a genuinely unfinished plan still does, and its stale anchor is still caught.

⛔ **ROUTED HERE 2026-09-09, out of the PR #767 merge gate — `[PLANANCHOR-SUMMARY-FILTER-01]`.** `/gsd-pr-branch` filters `.planning/phases/` out of the PR head by design, so a plan's SUMMARY never reaches `main` while the PLAN — written in an earlier, unfiltered commit — is already there. The pair is split permanently, and `plan-anchor-verify` treats a PLAN with no SUMMARY as pending.

⚠️ **NOT hypothetical, and not a PR-only artifact.** `164.8-05-PLAN.md` claimed `supabase-migrate.yml:1-251` contains the `Push migrations to production` step — true on `main` (:211). Phase 164.8 plan 05 and its review added ~870 lines and moved it to :1038, so the claim went stale ON `main` the moment the PR landed. `plan-anchor-verify` would have been RED on `main`, not merely on the PR; it surfaced early only because the filtered branch happens to make more plans read as pending. The one-off remedy at #767 — correct that anchor and carry the corrected PLAN through the filter as a named exception — is a workaround that needs repeating every time. **The evidence and the candidate directions are in the TODOS entry; they are not restated here.**

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries OPS-08-F9, OPS-08-F8, OPS-08-TS, OPS-08-F2, PROC-02, PROC-03, H-0001, 161.1-D13, `[PLANANCHOR-SUMMARY-FILTER-01]` (routed here 2026-09-09 out of the PR #767 merge gate — see criterion 10 and its ROUTED HERE block), VAC08-COUNT-SPM01, MT5-VERDICT-SINK-01 (added 2026-09-05 — the MT5 CAPABILITY verdict reaches only `emit_mt5_stage_event` (`analytics-service/services/mt5_client.py:205`), a structured LOG EVENT, so an `undetermined` outcome is unverifiable once it rotates out; this is what has kept Phase 161's first human-verification item unclosable for over a week. ⛔ Routed HERE, not to 164.1, deliberately: 164.1's plans are authored, its criterion-5 ledger was verified to match the RE-PARTITION block EXACTLY, and its `ARMS_FLOOR` is pinned at 4 — adding a fifth target now would break both. ⚠️ ADJACENT to MT5-WEDGE-OBS-01, not the same: that arm probes LIVENESS (-10004/-10005), this is a CAPABILITY verdict (`tradeapi_disabled` → which remedy sentence a founder reads). Fits this phase because "an instrument whose reading cannot be checked afterwards" is the same class as the gate-integrity items it already owns) (added 2026-09-05 — VAC-08's ledger ratchet reads its TWO GATING counts, `new_count`/`stale_count` at `scripts/test-ledger-drift-check.sh:372-373`, with the `grep … || true` + `${:-0}` shape the SAME file documents as a false-clean at `:304-318`, where the fix idiom already exists; a grep error on either temp file reads as zero and the gate prints "clean" over unread NEW drift. ⭐ Ship the fix with a test that makes the grep actually fail and asserts MEASURE_FAIL — a fix with no failing test is the defect class 164.3 exists to remove), `MYPY-MAINPY-01` (added 2026-09-06 from Phase 164.1-02's `deferred-items.md` — the `ci.yml` B-mypy comment claims running-service coverage the invocation does not have; `analytics-service/tests/` stays OUT of scope and its policy question stays open), `PROBER-CALIBRATION-01` (added 2026-09-06 at the PR #748 merge gate — a calibration arm in `src/__tests__/prod-prober-wiring.test.ts:292` whose name promises a proof it does not perform; it passes with its own subject at `:279-281` deleted. Non-blocking by the stopping rule — neither user-facing nor data-integrity — so #748 landed at v0.77.15.0 with this booked rather than fixed. ⚠️ Read the arm and the two calibration arms beside it before planning: the file already contains the correct shape, so this is a conform-to-the-neighbour fix, not a new pattern), `CI-DOCSPATH-01` (added 2026-09-06 while merging PR #750, the Phase 164.8 insertion — measured there, not estimated: 21 jobs / ~50 job-minutes on a four-file `.planning/` diff, two of them holding the shared-TEST-DB mutex against other people's CI. ⚠️ Read criterion 9 before planning: the deliverable is NOT "make docs PRs fast", it is "make docs PRs fast WITHOUT making code PRs skip anything", and only the second half is hard) , `[164.5-STALE-GENERATED-TYPES]` (added 2026-09-08 while closing DRIFT-04 — `src/lib/database.types.ts` carries a generated declaration for `create_allocator_connected_strategy`, dropped from PROD by `20260908120000`. ⭐ The stale entry is NOT the item; the ABSENCE OF ANY MECHANISM is. Measured: `grep -rn 'database.types' .github/workflows/` returns NOTHING and `package.json` carries no `gen:types`-shaped script, so nothing regenerates that file and no gate would notice it drifting from the schema it claims to describe. ⛔ Do NOT resolve this by hand-editing the file to match — that fakes a currency no process maintains, which is this phase's own named defect class, the same shape as `MYPY-MAINPY-01`'s false coverage comment and `PROBER-CALIBRATION-01`'s arm that promises a proof it does not perform. DELIVERABLE: a regeneration step plus a freshness gate, so the file is either provably current or loudly stale) , `DRIFT-05B-FIRST-RUN` (added 2026-09-08 by founder instruction that a deferral must find a phase — gate (b), `bash scripts/prod-body-drift-check.sh --baseline-live`, SHIPPED in Phase 164.5 plan 04 and has **never run against the real credential**; its own entry records it as EXPECTED RED on that first run. ⭐ An unexercised control is not a control: until it has fired once against PROD nobody knows whether it measures what it claims. DELIVERABLE: run it on a credentialed migration PR, READ its output, and record the branch it took by line reference — a green job is NOT evidence, exactly as `VAC04-ARMS-UNRUN` taught), `WR-D-DUMP-SCOPE` (added 2026-09-08, same instruction — a stated scope limit on the repo-vs-PROD dump comparison that is documented in the gate header but pinned by nothing, so the limit can widen without anything noticing) — read each before planning, do not re-derive
➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.6-SOURCE-ANCHOR-ROT]`.** Source-comment `file:line` anchors are unguarded where PLAN.md anchors are not. Still gate-hygiene in kind; owned there because 164.8.2 is what measured it.

**Depends on:** Phase 164.5 (ordering — the substrate work lands first), Phase 164.4.1 (pg-lane with pg_cron)
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.6 to break down)

### Phase 164.8.1: REFDATA — a schema-only restore destroys migration-seeded reference data while the ledger swears those migrations applied (INSERTED)

**Goal:** Make the TEST restore reproduce the reference rows that migrations INSERT, and fail loud when it does not. After Phase 164.8 Plan 04's restore, TEST's ledger holds all 266 migrations while the rows several of them exist to insert are GONE — and `supabase db push` will never replay them, because it skips applied versions.

⛔ **INSERTED 2026-09-09, founder decision, on MEASUREMENT not review.** Restore run `34274355596` committed; CI run `34280468314` then went red in two independent places, both tracing to the same cause:

* `python` — `insert or update on table "compute_jobs" violates foreign key constraint "compute_jobs_kind_fkey"`, `Key (kind)=(sync_trades) is not present in table "compute_job_kinds"`.
* `e2e-seeded` — `[seed] discovery_categories row for slug='crypto-sma' not found. The initial schema migration (20260405061911_initial_schema.sql) seeds this row — if it's missing the migration didn't run.` ⚠️ That seeder's inference is now FALSE and misleading: the migration DID run, and is in the ledger.

⭐ **Why this is not "e2e will re-seed it".** Phase 164.8 Plan 04's threat table accepted `T-164.8-09` (irreversible data loss on TEST) on exactly that compensating control. The control does not exist: the e2e seeder is itself one of the two failing jobs, and it fails because it EXPECTS migration-seeded rows. `T-164.8-09` is reopened.

⭐ **Why it is tractable, measured before planning:** the reference INSERTs are already idempotent — `compute_job_kinds` is written by 14 migrations, all `ON CONFLICT (name) DO NOTHING` — and every value is a LITERAL in the repo, not PROD data. So a replay carries no public-repo disclosure risk. `supabase/schema/baseline.sql` currently carries **0** data statements (562 GRANT/REVOKE, zero INSERT/COPY), which is why nothing puts them back.

⛔ **The hard part is the ALLOWLIST, not the replay.** 39 distinct tables receive an INSERT somewhere in `supabase/migrations/`, and most are data backfills inside DO blocks rather than reference seeding. Deciding which are reference tables is per-table judgment and must not be done with a regex. Two are already established: `compute_job_kinds`, `discovery_categories`.

⛔ **NOT in scope:** re-seeding shared TEST by hand to go green. Phase 164.8 Plan 06 already says such a failure must be NAMED rather than hand-seeded, and TEST is shared with other people's CI.

**Requirements**: the reference-data half of `164.2-TEST-APPLY-PROVENANCE`, the reopened `T-164.8-09`, and TODOS `[164.8-TEST-DATA-RESEEDED]` (which Phase 164.8 Plan 06 owns creating — measured 2026-09-09: it does not exist in `TODOS.md` yet).
**Depends on:** Phase 164.8 Plan 04 (its restore is what exposed this; the fix targets the same script).
**Blocks:** a green `main`. Until this lands, `e2e-seeded` — the go-live badge gate — and `python` are red on every branch.
**Plans:** 4 plans
**Status**: ✅ **COMPLETE** — 4/4 plans; `gsd-verifier` **13/13 must-haves, no gaps**. `gsd-code-reviewer` found **1 blocker + 10 warnings, all fixed**; the verification then found **3 further gaps + 4 record items, all closed**. ⭐ The blocker (CR-01) was on the phase's own instrument: this phase added mutable `refdata:<table>=<count>` rows to the census that `--mode preflight` compares BYTE-FOR-BYTE to prove its rollback — but `auth.users` is outside `public` so `DROP SCHEMA public CASCADE` never locks it, and shared TEST runs other people's CI, so a PERFECT rollback could report `Treat this database as modified.` ⛔ Two anti-vacuity defects were found INSIDE this phase's own new code and are the reason it took two review rounds: the count-aware SHORT branch shipped with **no falsifier at any layer** (reverting it turned nothing red), and the arm ratchet's calibration mutation had become a silent no-op while `EXPECTED_ARMS` moved on. Both are now armed — `EXPECTED_ARMS` 21 → 26, extractor kinds 16 → 19. Separately, bash was **command-substituting SQL comment prose** inside the unquoted `TXN_*` heredocs while assembling the destructive restore; refusal 9 + arm 26 close that, including four delimiter spellings that walked past the guard's first cut.

Plans:

- [x] 164.8.1-01-PLAN.md — (wave 1) the (file, table, count)-keyed allowlist, the refuse-by-default extractor with `--audit`/`--self-test`, the AIM-first contract test, and the audit wired self-test-first into `sql-gate-lint` and the restore workflow
- [x] 164.8.1-02-PLAN.md — (wave 2) the replay + fail-loud gate inside the restore transaction under a `SET LOCAL search_path` bracket, `refdata:` census rows, arms 22-24 (gate proven to bite on a scratch copy), `EXPECTED_ARMS` 21 → 26 with every vitest pin re-measured (arm 23 gained leg (d), the SHORT branch's falsifier, and arm 25 the rollback view's, both at phase review; arm 26 and refusal 9 came out of the phase verification, which found bash command-substituting comment prose inside the unquoted TXN heredocs)
- [x] 164.8.1-03-PLAN.md — (wave 1) the seeder's false "migration didn't run" inference corrected; the TEST-points-at-PROD-compute hazard booked as `[164.8.1-TEST-ANALYTICS-URL-PROD]` routed to Phase 164.9
- [x] 164.8.1-04-PLAN.md — (wave 3, checkpointed) first real run is `--mode preflight` on `main`; founder decides the restore on its `refdata:` readings; SHA-bound green `python` + `e2e-seeded` recorded

### Phase 164.9: TESTISOLATION — a run's assertions against the shared TEST project stop being unreliable: per-run isolation replaces global truth (INSERTED)

**Goal:** Close `FANOUT-GLOBAL-01`. TEST is shared with other people's CI, so a GLOBAL assertion there ("no stuck jobs exist", "the table is empty") is measuring other people's rows as well as ours and is unreliable by construction. Replace global truth with per-run isolation, so a run asserts about its OWN rows and nothing else.

⛔ **INSERTED 2026-09-08 by founder instruction — *"it is important to me, that all things that you defer find a phase"*, narrowed to *"if they belong structurally to what we are currently doing, which is hardening."*** This phase exists because TWO hardening items were deferred to NOWHERE during Phase 164.8's discuss: per-run TEST isolation and `FANOUT-GLOBAL-01`. They are one problem, not two — the second is the symptom, the first is the fix — so they get one phase.

⚠️ **`FANOUT-GLOBAL-01` IS NOT A `TODOS.md` ID.** Measured 2026-09-08: zero hits. It exists only as prose in `CLAUDE.md` ("a global assertion there is not reliable") and in the Phase 164.8 constraints table. Part of this phase's work is to write the entry that should have existed, or to retire the name in favour of one that does.

⭐ **Why this runs AFTER 164.8 and not before:** 164.8 restores TEST from the PROD dump. Designing an isolation scheme against a ledger and schema that are about to be replaced would be work done twice, and the restore changes what "a clean starting state" even means.

⛔ **NOT in scope:** raising Playwright workers above 1. Phase 164.8's ROADMAP entry already states that per-run isolation is the PRECONDITION for it and that parallelism must NOT be chased as an objective — measured, `e2e-seeded` sits behind `sql-mutation` so parallelism buys 1-2 min of wall clock. Isolation is worth doing for ASSERTION RELIABILITY; the parallelism it unlocks is a consequence, not a goal.

**Success Criteria**:

1. ⛔ **`FANOUT-GLOBAL-01` gets a REAL TODOS entry first.** CLAUDE.md records that it is NOT a TODOS id (measured 2026-09-08: 0 hits) and exists only as prose here and in the ROADMAP, and that THIS phase owns writing it. Planning starts by making the phase's own subject a booked item — everything below depends on it having one.
2. A CI run asserts only about the rows IT created on shared TEST. A global assertion ("no stuck jobs exist", "the table is empty") is replaced, not narrowed — and a calibration proves it by seeding a foreign row and showing the assertion stays GREEN where the old one would have gone red for someone else's work.
3. `[164.8-PUSH-RACE-VAC08]` and `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` are planned as ONE unit: they share one root (two jobs contending for advisory key `61616158` with nothing ordering them). ⛔ Splitting them creates the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.
4. ⛔ `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` is NOT closed by restoring the `|| echo ""`. That collapse IS the defect: it made the absurdity floor silently inert. If flakiness is MEASURED rather than feared, the answer is a bounded retry or the isolation this phase builds — both keep an unreadable input distinguishable from a clean one.
5. `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` has a mechanism, not a pragma. A data-reading migration that applies to PROD and refuses on an empty TEST must not block a production deploy — and ⛔ the interim remedy stays REVERT THE MERGE; `supabase-migrate.yml` is never edited to get a deploy out.
6. `[164.8.1-TEST-ANALYTICS-URL-PROD]` is closed by measurement: shared TEST's cron demonstrably no longer reaches PROD compute, shown by reading the live row rather than the migration that set it.
7. `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]` gains a THIRD gate leg pinning expected column VALUES, beside the emptiness and count-floor legs — both existing legs measure `count(*)` and neither can see a row restored in the wrong STATE.
8. The two restore-workflow items routed from Phase 164.8 Plan 04 are discharged by ONE green `mode=restore` dispatch, and its run id is recorded.
9. Every assertion this phase adds or changes is proven able to fail: neutered, observed RED, restored from a **byte backup** — ⛔ never `git checkout --`, which silently destroys concurrent uncommitted work.
10. ⛔ Nothing here is closed by widening an exemption, relaxing a floor, or asserting a smaller scope. Where narrowing IS the honest answer, it is dated and reasoned in-code.

**Requirements**: TBD (no v1.20 requirement IDs) + `FANOUT-GLOBAL-01` (prose only — see the warning above), the per-run isolation item deferred out of Phase 164.8's `<deferred>` block, and TODOS entry `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` — read `164.8-CONTEXT.md` before planning, do not re-derive, plus the two restore-workflow items routed here from Phase 164.8 Plan 04 (see the ROUTED HERE block below), and `[164.8.1-TEST-ANALYTICS-URL-PROD]` plus `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]` routed here from Phase 164.8.1, and `[164.8-PUSH-RACE-VAC08]` routed here from Phase 164.8 plan 05, plus `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` routed here 2026-09-10 out of Phase 164.8.2's round-three review (⛔ `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` was in this list until the security audit caught it: the body below says MOVED to 164.8.4 while this line still claimed it, and an item two phases name is owned by NEITHER — it is 164.8.4's) — ⚠️ the second is the same root as `[164.8-PUSH-RACE-VAC08]` and must be planned WITH it (see their ROUTED HERE blocks below).

⛔ **ROUTED HERE 2026-09-08 by Phase 164.8's plan-checker (B4).** 164.8 restores TEST from a SCHEMA-ONLY dump (`BASELINE.md`: 0 data statements), so TEST mirrors PROD's CATALOGUE, never its DATA. A migration whose DO block reads a PROD-populated table and RAISEs on an unexpected count applies cleanly to PROD and refuses on an empty TEST — and 164.8 Area 1 Q2 makes that BLOCK the PROD apply. The retired `TEST-NOT-APPLICABLE` pragma was the declared escape hatch, and 164.8 retires it. Interim remedy is revert-the-merge, never a YAML edit under deploy pressure. Phase 164.10 was considered and rejected as the home: it is function-body scope only.
⛔ **ROUTED HERE 2026-09-08 by founder instruction, out of Phase 164.8's Plan 04.** Two items were found by RUNNING the restore (run `34274355596`, head `88581b8b`) rather than by review, and neither belongs in a ratchet PR. Both are discharged by ONE green `mode=restore` dispatch, so they are one unit of work:

1. **The post-COMMIT extension guard is defective in three ways** — `scripts/restore-test-from-baseline.sh:1090`. It asserts strict equality on a WHOLE-DATABASE `count(*) FROM pg_extension` while its own comment reasons about extensions "in `public`"; it therefore fired on a **gain** (6 → 7, the dump correctly creating `pg_net`, which PROD had and TEST lacked) and phrased that gain as a loss — *"An extension that lived in public was CASCADE-dropped and the dump did not put it back."* And it runs AFTER the transaction commits, so in `mode=restore` it can only mislabel an outcome, never prevent one. ⚠️ The naive fix (`post_ext -ge pre_ext`) reintroduces the same one-sidedness pointing the other way: the remedy must be TWO-DIRECTIONAL and scoped to the schema it reasons about, with both directions observed RED before it is believed. Full measurement in `164.8/deferred-items.md` item 6.

2. ~~**The Supabase CLI post-verify has NEVER executed**~~ — ✅ **DISCHARGED 2026-09-09. IT EXECUTED AND PASSED; this item is closed and must not scope work here.** The paragraph below is kept as lineage and was TRUE when written on 2026-09-08. It ended "do not close that claim on anything but a run" — and a run then happened: **`34330741339`**, head **`a622df27`**, `mode=restore`, 2026-09-09T08:44Z, step 24 → `success`, printing verbatim `post-verify: the pinned CLI parses the seeded ledger and reports nothing pending — ledger SHAPE is consistent.` Both asserted strings held under the **pinned 2.98.2**, which was the exact uncertainty the item existed to name. Found by the Phase 164.8 verifier on 2026-09-09 and confirmed independently by the orchestrator (`gh run view 34330741339` → `conclusion=success`). ⚠️ It stayed shipped as OPEN for ~8 hours across plan 06's book-closing because nothing re-measured it — the record-vs-reality class this milestone exists to remove, caught here by a verifier that re-ran the claim instead of reading it. `164.8/deferred-items.md` items 4 and 6 and `164.8-04-SUMMARY.md` `coverage.D4b` carry the same correction. **Item 1 above is NOT discharged** and remains this block's work.
   <br>*Superseded text, 2026-09-08:* It was skipped by item 1's exit 1, and was already recorded as never-run before that (`164.8/deferred-items.md` item 4). Its two asserted strings were measured against the LOCAL CLI **2.84.2**; CI pins **2.98.2**, where the wording is INFERRED, not executed. Phase 164.8 Plan 04 marks the must_have it serves (`coverage.D4b`) **UNMET** rather than claiming it passed — do not close that claim on anything but a run.

⚠️ **These two are topically about the RESTORE WORKFLOW, not per-run isolation.** They live here because this phase is the hardening deferrals' home and depends on 164.8's restore, not because they share its subject. Do not let them dilute `FANOUT-GLOBAL-01`, which remains this phase's reason to exist.

⛔ **ROUTED HERE 2026-09-09, out of Phase 164.8.1's plan — `[164.8.1-TEST-ANALYTICS-URL-PROD]`: shared TEST's cron points at PROD compute.**

`system_settings.analytics_service_url` is seeded with the PROD Railway host (`supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql:295`, the literal taken verbatim from `scripts/prod-prober/cron-manifest.json` jobid 1) and that row feeds `public.match_engine_cron_tick()`, a `pg_net` tick. So a TEST cron tick can POST to the PRODUCTION analytics service.

⚠️ **PRE-EXISTING, NOT INTRODUCED — and that is the reason it is routed rather than fixed in 164.8.1.** The restore drops only `public` (the `DROP SCHEMA public CASCADE` in that script's TXN_DROP heredoc — cited by symbol, because the `:861` written here on 2026-09-09 had drifted to an unrelated line inside the same PR), so TEST's `cron.job` schedule was never touched; whatever TEST was doing before the restore, it still does. Phase 164.8.1 therefore replays the statement FAITHFULLY (founder call, 2026-09-09): omitting it would leave TEST missing a setting its own ledger claims applied, and the migration's own guard already requires an allowlisted https host.

⛔ **Do NOT resolve this by editing 164.8.1's allowlist.** That would make the restore silently normalise the hazard, which is the failure class this whole line of work exists to remove. The fix belongs here, with per-run isolation, because "which service does a TEST tick talk to" is the same question as "whose rows is a TEST run asserting about".

⚠️ Two traps for whoever takes it: `pg_net` is ASYNC, so a green cron row proves nothing about the HTTP result — seven days of 401s once hid behind one. And the marker check confirms which DATABASE you are on, never which SERVICE the tick calls.

⛔ **ROUTED HERE 2026-09-09, out of review of Phase 164.8.1's PR — TODOS `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]`: the restore's replay reproduces INSERTs, never the UPDATEs that followed them.**

A migration seeds a row, a LATER migration UPDATEs it, and after a restore the row is PRESENT but in the wrong STATE — while the ledger holds rows for both. Both legs of 164.8.1's in-transaction gate measure `count(*)`, so neither can see it. **The evidence, the worked case and the five measured UPDATEs are in the TODOS entry; they are not restated here.**

✅ **Why THIS phase.** Same family as `FANOUT-GLOBAL-01`: a green reading that is not measuring what it claims. "In what STATE is a restored TEST row" is the same question as "whose rows is a TEST run asserting about", so it belongs with per-run isolation rather than with 164.8.1's criterion.

⚠️ **Bounded, which is why it was routed rather than allowed to block 164.8.1.** All five UPDATEs land on the teaser trio (`profiles`, `strategies`); none touch the FK- and CHECK-bearing reference tables. The fix is a THIRD gate leg pinning expected column VALUES, beside the emptiness and count-floor legs 164.8.1 ships.

⛔ **ROUTED HERE 2026-09-09, out of Phase 164.8 plan 05's review — `[164.8-PUSH-RACE-VAC08]`: `sql-tests` (VAC-08) and `supabase-migrate.yml`'s `apply-test` share ONE advisory lock on the merge push, so their order is undefined.**

MEASURED 2026-09-09: advisory key `61616158` appears 7× in `supabase-migrate.yml` and 26× in `ci.yml`. On a merge both workflows start, both take that key, and nothing orders them. Plan 05 shipped a frontier exemption that makes VAC-08's VERDICT order-independent and stops every migration-adding PR from being red by construction — but it removed the CONSEQUENCE, not the coupling. **The evidence, the three residuals it did not close, and the candidate fixes live in the TODOS entry and are not restated here.**

✅ **Why THIS phase.** Two jobs contending for one lock on a database shared with other people's CI is literally the `FANOUT-GLOBAL-01` family, and the fix shape — distinct keys plus explicit ordering — is the same work as isolating TEST lanes. Two of the three residuals are gate-integrity riders that would sit equally well in a hygiene phase, but they are cheap alongside the first, and splitting them would create the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.

⛔ **Do not close this by widening the exemption.** It is already the widest thing in that gate.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]`.** The `missing`-direction ledger read still puts the shared-TEST pooler host and user into a PUBLIC Actions log. It left this phase because it is one of THREE credential channels 164.8.2 produced and they must be swept together, not because it stopped being a shared-TEST problem.

⛔ **ROUTED HERE 2026-09-10, same review — `[164.8.2-VAC08-FATAL-ON-TRANSIENT]`: an unreadable ledger row count now reds the WHOLE VAC-08 gate, where it used to cost only the absurdity floor.**

This is a CONSEQUENCE of a fix that was correct and must NOT be reverted, recorded so that the next person to see VAC-08 flake looks in the right place. Before 164.8.2 the read was `… 2>/dev/null || echo ""` and an unreadable count silently disabled the absurdity floor — the control that tells a wrong join key from real drift, and whose absence sends a reader to hand-apply migrations to shared TEST. It is now three named MEASURE_FAILs that exit 1.

⚠️ **The exposure this creates.** A transient pooler blip on shared TEST that previously cost one control now fails the entire gate — on a gate that ALREADY contends for advisory key `61616158` with `apply-test` on every merge push (see `[164.8-PUSH-RACE-VAC08]` above; the two are the same root and should be planned together).

⛔ **The remedy is NEVER to restore the `|| echo ""`.** That is the defect, not the mitigation. If flakiness is measured rather than feared, the answer is a bounded retry around the read, or the per-run isolation this phase exists to build — both of which keep an unreadable input distinguishable from a clean one.

✅ **Why THIS phase.** It is the same advisory-key contention on the same shared database as `[164.8-PUSH-RACE-VAC08]`, and the durable fix for both is isolation rather than tolerance.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-REFUSAL-STILL-PUBLISHES]`.** The published-`.sql` scan refuses without withholding, so the flagged file ships anyway. Founder decision, cost on both sides; it sits with the rest of 164.8.2's artifact residue.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-REDACT-HOSTNAME-01]`.** A routing word that was never a routing record, over a psql-redaction gap that is still open. Swept with the other two credential channels.

**Depends on:** Phase 164.8 (its restore settles the schema and ledger this phase isolates against).
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.9 to break down)

### Phase 164.10: BODYDRIFT — PROD runs an EARLIER revision of three function bodies than the migration chain renders (INSERTED)

**Goal:** Close `DRIFT-06`. Three PROD function bodies do not match what the migration chain renders, and the shared "the dump is stale" diagnosis was FALSIFIED for them by the 2026-09-07 regeneration: their `snapshotHash` values did not move by a single bit. They are `check_fan_in_ready/1` (5 hunks), `reject_sentinel_writes/0` (9 hunks) and `retention_delete_guard/0` (2 hunks), retained as the last three rows of `CONTENT_DRIFT_ALLOWLIST` in `scripts/baseline-content-drift-check.mjs`.

⛔ **INSERTED 2026-09-08 by the same founder instruction as Phase 164.9.** `DRIFT-06` was booked in `TODOS.md` on 2026-09-07 and had no phase, no date and no gate for a full day while the milestone worked on its sibling `DRIFT-04`.

⚠️ **THIS IS NOT COSMETIC, and the three differ in kind — plan them separately:**

- **`check_fan_in_ready` is EXECUTABLE drift.** The chain declares `v_row_found BOOLEAN` and SELECTs `true` into it to distinguish "no parent row" from "a parent row of NULLs". PROD has neither. Behaviour differs.
- **`reject_sentinel_writes` is MESSAGE TEXT only.** The guard logic — which sentinel values are refused, on which three tables — is identical on both sides; PROD carries the shorter 2026-05-13 `RAISE` wording.
- ⭐ **`retention_delete_guard` is the specimen that rules out the innocent explanation.** EXACTLY ONE migration in this repository defines it (`20260515113853_retention_crons_safe`), so there is no later revision for PROD to be behind — yet PROD's `RAISE` omits a clause that single defining migration contains. **A live catalogue cannot lag a migration it is the only definition of.**

⛔ **TWO CANDIDATE CAUSES, NOT DISTINGUISHABLE FROM A READ-ONLY DUMP, and neither may be assumed:** either those migrations never reached PROD, or their FILES were retro-edited after being applied. `retention_delete_guard` can only be the second. ⭐ **Settle it by reading, not dating:** PROD's `supabase_migrations.schema_migrations.statements[]` stores the APPLIED SQL text — argue from what a stored statement CONTAINS versus what the repo file contains. Some rows are partial or stubbed, so argue per row from its own `CREATE` head.

⚠️ **The three allowlist rows must NOT be deleted to make the gate green**, and a further baseline regeneration will never clear them — their own `reason`/`clearedBy` text says so and names this entry.

⛔ **THE THREE-REVIEWER RULE APPLIES IN FULL.** Any repair writes PROD function bodies, so it goes through `migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter`, findings fixed, BEFORE asking to apply. This is why it is its own phase rather than an item inside Phase 164.6 GATE-HYGIENE — that phase's other twelve items are lint rules and comment corrections, and folding production DDL in would give the riskiest item the lightest review posture.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entry `DRIFT-06` — read it before planning, do not re-derive.
**Depends on:** nothing outstanding. ⚠️ Ordering is DELIBERATE: queued after 164.9 because the milestone's gate work should be finished before another PROD apply is attempted.
⛔ **CORRECTED 2026-09-09.** This sentence claimed 164.10 was "the only remaining 164.x item that writes PRODUCTION". It is not: **Phase 164.5.1 CRONREPOINT also writes PROD**, and on a more sensitive surface — production DDL on `cron.job` jobid 1, which carries `decrypted_secrets` and whose own success criterion 5 already demands three reviewers before any apply. The ordering principle is unchanged and now applies to BOTH: gate work (164.9) precedes every remaining PROD apply, not just this one.
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.10 to break down)

### Phase 166: QSTATS-TRUTH — every quantstats-derived number reflects the returns it was given

**Goal:** No metric persisted to `metrics_json` or rendered in a chart is the output of quantstats'
price-detection heuristic misreading a return series as prices. RANK-05 (Phase 159) closed that
heuristic in `compute_all_metrics` only; this phase closes the rest of the surface and settles
whether the library stays.

**Depends on:** Phase 164.6 (ordering only — no code dependency). ⭐ RE-ORDERED 2026-09-05: this phase now runs BEFORE 165, restoring 165's own "dependency churn lands last, never before" invariant that appending 166 after it had broken. ⚠️ **RESEARCH-FIRST phase:** the
shape of the work is not decidable from the codebase alone (see criterion 1), so `/gsd-plan-phase 166`
must run its research step, and the discuss step must not be skipped.

**Why this is a phase and not a TODO.** ⚠️ **Not hypothetical — measured.** `.planning/WINDOWS.md`
entries 5 and 9 (both `open`) record wrong values already persisted: on the phase's own trigger
fixture, a 60-day all-winning series whose `max_drawdown` correctly reads `0.0` wrote
`ulcer_index=0.9947`, `common_sense_ratio=0.0`, `recovery_factor=2.0737`, `upi=2.9999`,
`serenity_index=0.3204` into the same `metrics_json` Phase 159 was guarding. The residual is live in
three places:

- `compute_qstats_scalars` — 8 scalars (`analytics-service/services/metrics.py:1771`), dispatched
  through `getattr(qs.stats, qs_attr)` at `:1826`;
- `_rolling_alpha_beta`'s `rolling_greeks` call (`:2071`) — which **feeds rendered chart series**,
  so this one reaches the user's eyes, not just the row;
- the greeks benchmark leg.

Four of the eight (`ulcer_index`, `ulcer_performance_index`, `probabilistic_ratio`, `serenity_index`)
reach `_prepare_prices` **transitively** via `to_drawdown_series` and **cannot** be closed with
`prepare_returns=False`. Measured at HEAD 2026-09-03: 30 `qs.stats.*` call sites in `metrics.py`,
only 8 carrying a `prepare_returns=False` closure; quantstats is pinned at `0.0.81`.

⛔ **The gate that should catch this is blind to it.** The RANK-05 region gate matches LINES, so it
cannot see the `getattr(qs.stats, attr)` dispatch at `:1826` nor `_rolling_alpha_beta` at all — it
reports clean over the exact surface that is still open. That is a Phase 164.3-class vacuity: a
control that cannot fail. Fixing the metrics without fixing the gate leaves the next regression
equally invisible.

**Thesis inherited from Phase 162 (HONEST):** every number a user sees reflects the data underneath
it. A wrong Sharpe is not an error surface — it is a confident lie, which is why 164.2 (error copy)
is the wrong home for it.

**Success Criteria** (what must be TRUE):

1. **The upgrade-vs-mirror decision is made on evidence, not assumption.** Research establishes
   whether `0.0.81` is still current, whether a maintained fork exists, and whether any newer release
   fixes `_utils._prepare_returns`' price detection — and the phase picks its shape from that answer.
   Hand-writing inline mirrors for the transitive four is a fallback, not the default.
2. **Every one of the 30 `qs.stats.*` call sites is either closed or recorded as out of scope with a
   reason** — the same printed-exclusion discipline Phase 164.4 established. A silent omission fails
   this criterion exactly as a wrong value does.
3. **The region gate AST-walks `qs.stats.*` calls** instead of matching lines, sees the `getattr`
   dispatch shape and `_rolling_alpha_beta`, and is PROVEN able to fail: reintroduce an unclosed call
   site, observe the gate go RED naming it, restore.
4. **The measured wrong values are shown to be gone on the same fixture that produced them.**
   The 60-day all-winning series with `max_drawdown == 0.0` yields defensible values for all five
   named scalars — asserted against economic invariants, never against the implementation's own output.
5. **No metric silently changes without being recorded.** Any persisted value this phase corrects is
   named in the SUMMARY with its before and after, since these numbers are already in users' rows.

**Requirements**: TBD — set at planning time from research. Carries `[159-SIMPLIFY-DEFER]` (TODOS 0f):
extract `_downside_rms` / `_annualized_vol_sharpe` as module-level primitives BEFORE a third
hand-copy is added, and derive `PERCENTILE_ANALYTICS_COLUMNS` + csv-finalize's
`CLOCK_SAFETY_KPI_COLUMNS` from one exported KPI array. TODOS 0f explicitly says to do this extraction
as part of the scalars closure, not before.

**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 166 to break down)

---

### Phase 165: DEPS — The 9-PR dependabot campaign

**Goal**: All 9 open dependabot PRs are RESOLVED — landed or deliberately closed — in the research-verified order with the full suite green between each, and production pandas is never downgraded
**Depends on**: Phase 158 (⛔ HARD: OPS-01 — nine CI runs against the unfixed group guarantees a silently-skipped Railway deploy, and #685 is 100% `analytics-service/`). LAST phase of the milestone — dependency churn lands after the correctness work, never before
**Requirements**: DEPS-01
**Ordering (2026-09-05):** runs AFTER Phase 166 — dependency churn lands LAST in the milestone. Carried decision: when v1.21 is created and 165 is still open, it moves there.
**Success Criteria** (what must be TRUE):

  1. A prerequisite commit on `main` (not a PR) fixes `requirements.in` `pandas==2.2.3` → `3.0.3` with its comment corrected and `requirements.txt` untouched, BEFORE #685 is touched at all; #685 then lands rebased with pandas OUT of its diff and `make lock` re-run — production pandas stays 3.0.3. ⚠️ A green pytest is NOT proof of safety here; the pin itself is the assertion.
  2. PRs land ONE at a time in the verified order — #643 → (#627, #626) → #612 ALONE (validated on `migration-drift-check.yml` first, `supabase --version` == 2.98.2 confirmed in the plan-job log; it rides the PROD auto-migrate workflows) → #685 → #686 (rebased + `npm install`, ⚠️ never bisected — its nine reds are ONE mis-materialised lockfile) → #645 @ 7.0.1 → #646 @ jsdom 30.0.1 not 30.0.0 (⚠️ jsdom 30's `engines` excludes local Node 25; decide CI-Node-22-as-authority vs `PATH=/opt/homebrew/opt/node@22/bin` explicitly, don't discover it as a flake) — full local suite between each, every merge asserted `conclusion == "success"`, never "not failure" (with no branch protection, a grey run merges).
  3. #614 (TypeScript 7) and #606 are CLOSED with reasons written on the PRs (the `exports`-map read + the typescript-eslint `<6.1.0` peer range; #606's stale claims) so the next Dependabot reopen is pre-answered; the `fast-uri` override is bumped `^3.1.4` → `^3.1.5`; NO audit-allowlist file is added.
  4. Zero dependabot PRs remain open at phase close, and no Railway deploy was silently skipped across the campaign (the Phase-158 watcher observed quiet or loud, never grey).

**Plans**: TBD

**Research note:** STACK.md is effectively the plan — every verdict registry- or log-measured. ⚠️ The whole campaign is predicted, not executed: no PR was rebased, no lock regenerated, no suite run. Run `mypy --strict` before shipping any `analytics-service/` change (the GSD flow runs pytest only). If #686 stays red after a clean `npm ci`, `knip` (6.25 → 6.32, seven minors, changelogs unread) is the prime suspect and its findings may be LEGITIMATE, not regressions. Update each action's SHA AND its version comment together (C-0293).

### v1.20 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 158. OPS-CI merge=deploy | 6/6 | Complete    | 2026-08-21 |
| 159. RANK ranking integrity | 6/7 | Complete | v0.70.0.0 |
| 160. PROVENANCE venue/annualization | 7/7 | 🟡 Arm proven, 1/3 surfaces | Persist arm smoked via ApiKeyManager 2026-08-25; StrategyForm un-smoked, AllocatorExchangeManager unmounted |
| 161. WIZERR honest errors | 10/10 | Complete | v0.72.0.0 |
| 161.1 LEDGER-REFRESH (shipped dormant) | 5/5 | Complete | v0.73.0.0 |
| 162. HONEST visible truth | 9/9 | Complete | v0.74.0.0 |
| 163. HARDEN reliability + security | 9/9 | Complete | v0.75.0.0 |
| 164. SHARE revocable links | 7/7 | Complete | v0.76.0.0 |
| 164.1 PROD-OBSERVABILITY (one prober: PYAPI-06, CRON-OBS-01, CRON-DRIFT-01, MT5-WEDGE-OBS-01) | 0/? | Queued NEXT (re-partitioned 2026-09-05 from HARDEN-GUARDS) | - |
| 164.2 CURATED-COPY (+ WIZFORM-02, WR-06-UTC both bucketers, HONEST-08-RESIDUAL, 161-ERRPREFIX) | 10/10 | Complete — PR #749 merged `05994f1d`, main CI green, PROD verified by effect | v0.77.16.0 |
| 164.3 VACUITY (+ SKIP-01, DRIFT-01, OPS-08-F9/F8 routed on, H-0001 routed on) | 9/10 | Complete — plan 07 (VAC-07) DEFERRED to 164.5 by founder decision 2026-08-29, stays unchecked | v0.77.0.0 |
| 164.3.1 SOUND-PRIMITIVES (four cycling primitives) | 13/13 | Complete | v0.77.1.x |
| 164.4 REDUNDER-BACKFILL (39 idiom files annotated; 5 pg_cron-blocked files handed to 164.4.1) | 12/12 | Complete | v0.77.12.0 |
| 164.4.1 PGCRON-LANE (pg_cron on the lane; 5 deferred gates annotated; lane-blocked 0; ARMS_FLOOR 361) | 6/6 | Complete — PR #744 merged `e01cc2e6`, ubuntu-measured | v0.77.13.0 |
| 164.7 APPSETTINGS (every `app.*` GUC reader moves off ALTER DATABASE/ROLE — both 42501 on PROD) | 0/? | Queued 2nd (row added 2026-09-06; the phase itself was created 2026-09-05 and had no summary row) | - |
| 164.5 BASELINE-SNAPSHOT (baseline.sql load-bearing, DRIFT-04 drop, DRIFT-05, VAC08-LEDGER, VAC-07) | 7/7 | Complete — DRIFT-04 applied and shipped 2026-09-08 in the two-PR sequence (row corrected 2026-09-09; it read "crit 3 apply pending founder" for a day after the apply) | v0.77.21.0 |
| 164.6 GATE-HYGIENE (OPS-08 residue, composite-stamp twin, PROC-02/03, H-0001) | 0/? | Queued 4th (created 2026-09-05) | - |
| 164.8 TESTPREPROD (TEST becomes a real pre-prod: bring it current, apply on merge to TEST before PROD) | 3/6 | Queued 5th — LAST in the 164.x series by founder decision 2026-09-06 (created 2026-09-06) | - |
| 166. QSTATS-TRUTH | 0/? | Queued 6th (re-ordered ahead of 165, 2026-09-05) | - |
| 165. DEPS dependabot campaign | 0/? | Queued LAST (after 166 — dependency churn lands last) | - |

### Requirement Coverage (v1.20)

| Phase | Requirements |
|-------|--------------|
| 158 | OPS-01, OPS-02, OPS-03, OPS-04, OPS-11 |
| 159 | RANK-01, RANK-02, RANK-05, RANK-06, RANK-07, RANK-08, RANK-09 |
| 160 | RANK-03, RANK-04 |
| 161 | WIZERR-01, WIZERR-02, WIZERR-03, WIZERR-04, WIZERR-05, WIZERR-06, WIZERR-07, WIZERR-08, WIZERR-09, WIZERR-10, WIZERR-11, WIZERR-12, WIZERR-13 |
| 162 | HONEST-01, HONEST-02, HONEST-03, HONEST-04, HONEST-05, HONEST-06 |
| 163 | OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, HONEST-08 |
| 164 | SHARE-01, SHARE-02, SHARE-03, SHARE-04 |
| 164.3 | VAC-01, VAC-02, VAC-03, VAC-04, VAC-05, VAC-06, VAC-08 |
| 164.5 | VAC-07 (deferred from 164.3, `[VAC-07-DEFER]`) |
| 165 | DEPS-01 |

**49/50 v1.20 requirement IDs mapped, each to exactly one phase. ONE deliberately unassigned: HONEST-07 (root cause of a retired job kind with no site at HEAD — REQUIREMENTS marks it Deferred, reassess at the milestone audit; it is not silently counted as mapped). The eight VAC-* IDs were added 2026-08-28 and were missing from this table until 2026-09-05.**
(Per-requirement traceability: `.planning/REQUIREMENTS.md` § Traceability.)

## Parked Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157) — founder-gated

**Goal:** The numbers Quantalyze renders for the live funded MT5 account are proven true against
the terminal's own figures — and the handful of observations only the founder can make are made.

⛔ **EVERY phase in this milestone is founder-gated. That is its defining property, not an
accident of sequencing.** Nothing here can be delivered by an agent. The milestone was created on
2026-08-14 so that the agent-deliverable work in v1.17 could close without waiting on a calendar.

**Blocked on, both required:**

1. ⛔ **New MT5 investor passwords.** The founder changed the account passwords on/around
   2026-08-14, so the stored credentials are stale and will not authenticate. MEASURED on PROD
   that day: three `mt5` keys exist (labels `FX-AI_V`, `MM2`, `MM3` — ⚠️ **there is NO key
   labelled `MM1`**, so the founder's "MM1 and MM2 are erroring" does not map 1:1 onto stored
   rows; **re-verify ALL THREE at reconnect**), all `disconnected_at IS NULL`, all
   `sync_status='complete'` with `last_sync_at` 04:01–04:07 UTC — those are the last *successful*
   syncs, taken **before** the change.
   ⛔ **When these flip to `error`, that is EXPECTED. Do not investigate it as a code defect.**

2. ⛔ **The founder physically at the MT5 terminal, on a TRADING day**, with the live funded
   account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run
   does not satisfy it.

**Settled inputs — do not re-litigate:**

- Parity tolerance **1%, INCLUDING open P&L** (founder call 2026-08-14). Adjustable later; keep it
  a named test constant, never a hardcoded literal.

- ⭐ **The measurement window MUST end before the day of the run.** `broker_dailies` anchors to
  today — initial capital is derived as `current_equity − total_pnl` — so reconstruction error
  accrues *backward into the past*. Comparing today's equity is therefore near-tautological, and a
  historical window is the only one that can actually fail.

**Requirements:** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)

⛔ **Do not advertise MT5 until Phase 155 passes.** Carried verbatim from v1.17.

---

## Shipped Milestone: v1.19 JOB/RATE — job-lifecycle reliability and the rate limits that hold (Phases 143–146 + 146.1, 146.2) ✅ CLOSED 2026-08-20

**Closed 2026-08-20** at v0.68.1.0 (`00e73aa5`), PRs #687–#695. 6/6 phases passed, 9/9
requirements satisfied (JOB-04/05/06/08, RATE-01..05). Audit: `.planning/v1.19-MILESTONE-AUDIT.md`
— `tech_debt`: INT-1..4 filed to TODOS.md (cross-phase readmit reachability + Next-side limiter
coverage law; measured-ZERO populations on PROD, fail-safe direction, none blocking under the
stopping rule). Full section + phase detail archived at
`.planning/milestones/v1.19-ROADMAP.md`; requirements extract at
`.planning/milestones/v1.19-REQUIREMENTS.md`.

**What v1.19 earns:** a dropped compute-job enqueue is detected by absence and healed (sweep LIVE
on PROD, hourly tick observed); an orphaned `running` job terminates VISIBLY (terminal `failed`,
never DELETE — WR-02 resolved); csv-finalize is ONE SECURITY DEFINER transaction (mid-fold fault
proven to leave ZERO rows); every authed route that reaches the Python service carries a limiter
enforced by a coverage law (Python whole-surface; Next seam-scoped — widening filed as INT-2).
Rider: local analytics-service now defaults to TEST and hard-stops before becoming a PROD worker
(#695).

## v1.19 phase detail, retained (Phases 143–146; 146.1/146.2 under Phase Details below)

### Phase 143: JOB — Dropped-enqueue reconciliation sweep

**Goal**: "`after()` never ran at all" enqueue drops — architecturally invisible from inside the route handler — are detected by absence and healed
**Depends on**: Phase 142 (same three-table triangle; scheduled as one non-racing mechanism)
**Requirements**: JOB-04
**Success Criteria** (what must be TRUE):

  1. A strategy with persisted daily-returns data but NO `compute_jobs` row of ANY status and no terminal `strategy_analytics` row, past a grace window, is re-enqueued by a pg_cron sweep and a Sentry alert fires — the hole the in-closure `writeFailedStrategyAnalyticsPlaceholder` guard structurally cannot catch.
  2. Running the sweep twice in a row produces no duplicate job. ⚠️ MECHANISM CORRECTED 2026-08-16 (Phase 143-02, falsified by an observed neuter): the operative guard is the sweep's `FOR UPDATE SKIP LOCKED` — an INSERT into `compute_jobs` key-share-locks its parent `strategies` row — NOT the partial unique index. Sequential double-execution cannot conflict at all, because tick 1's INSERT removes the strategy from the zero-jobs conjunct. The index only redeems a genuine READ COMMITTED race with `SKIP LOCKED` also removed. Corollary: a gate that runs the body twice in one session CANNOT FAIL and must not be written.
  3. A strategy inside the grace window, or with any existing job row, or with a terminal analytics row, is never touched by the sweep.

**Plans:** 4/4 plans executed

Plans:
**Wave 1**

- [x] 143-01-PLAN.md — Worker alert path: init_sentry() into main_worker.main() + reconcile-sweep marker capture on claim (the D-11 correction; RED-first pytests)
- [x] 143-02-PLAN.md — Census (TEST+PROD, STOP rules) + the sweep migration (inline pg_cron body, MATERIALIZED LIMIT 25, hourly at :35, composite-excluded) + throwaway-Postgres end-to-end tracer proof

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 143-03-PLAN.md — CI gates: SQL gate Parts 1-4 (deployed-body oracle), TS migration-content gate, pytest cross-language marker contract; nine observed neuter REDs

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 143-04-PLAN.md — [BLOCKING] Apply to TEST via Supabase MCP, sql-tests RED→GREEN, ONE real tick heals a seeded orphan (the FORCE-RLS/L-2 proof), worker SENTRY_DSN verdict, TODOS deferrals, human gate

**Note**: Constrained by JOB-07 (Phase 142) — sweep runs in pg_cron, never the worker loop. The "what counts as orphaned" design pass is settled in 143-CONTEXT.md + 143-02-PLAN.md's decision map (source-agnostic dailies anchor; ANY-kind/ANY-status job conjunct; terminal-analytics safety conjunct; composites and the wizard first-hop drop excluded as documented non-coverage).

### Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence

**Goal**: An orphaned `running` compute job terminates VISIBLY — pollers break out, the audit trail survives — resolving the founder's open WR-02 DELETE-vs-reset call
**Depends on**: Phase 143 (JOB sequence; independent mechanism on `compute_jobs`)
**Requirements**: JOB-05, JOB-08
**Success Criteria** (what must be TRUE):

  1. An orphaned `running` `compute_jobs` row (past the UNCHANGED 4h `claimed_at` threshold) transitions to a terminal `failed` status instead of being DELETEd — so a wizard poller sees a real outcome and the row survives for audit until the existing 30/90-day retention crons delete it.
  2. Detection latency drops from ~24h to the tightened cadence (e.g. hourly) while a legitimate batch-tail job under 4h is never touched — the threshold, not the frequency, is what protects live jobs (the WORKER-04 2h→4h lesson).
  3. The change ships as a NEW migration layered on `20260720120000` (the shipped migration is never edited), reconciling the TEST-DELETE / PROD-reset split into ONE behavior.
  4. A committed measurement of the stale-`pending` `compute_jobs` population **on PROD** exists BEFORE any stale-`pending` sweep is scoped, and the gap is closed EITHER by adding `pending` as a fourth swept status (using SC 1's terminal-UPDATE pattern, never `DELETE`) OR by an explicit WON'T-FIX carrying that measurement — "zero on prod" is a valid, budget-saving outcome. The retention family covers `done` (jobid 4), `failed_*` (jobid 8) and orphaned `running` (⚠️ jobids are per-project and NOT stable across a re-registration — measured 2026-08-17: TEST moved 11 → 19 when Phase 144's terminalizer applied, and PROD has always been 29, never 11. Identify these jobs by JOBNAME; that is what the SQL gates anchor on); stale `pending` is the one status an undrained enqueue cron produces and the only one nothing sweeps.

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 144-01-PLAN.md — The terminalizer migration (two-arm bounded terminal UPDATE, `'50 * * * *'`, 4h claimed_at arm + derived-48h NULL-claim arm) + throwaway-Postgres tracer proof + the SAME-COMMIT rewrite of test_retention_orphaned_running.sql (B1 DELETE-oracle, B2 hour-band cast, B3 next_attempt_at) + neuter-RED matrix

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 144-02-PLAN.md — TS migration-content gate (occurrence counts recalibrated for the two-arm body, word-bounded LIMIT, later-migration re-registration scan) + JOB-08 WON'T-FIX-with-measurement in REQUIREMENTS.md + three TODOS deferrals

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 144-03-PLAN.md — [BLOCKING, orchestrator-session-only] Pre-apply re-census + §3 NULL-claim confirming query + live slot check, apply to TEST via Supabase MCP, sql-tests RED→GREEN, ≥2 successive real :50 ticks observed against the live 402-row fixture proving the per-arm `LIMIT 100` bound HOLDS and PROGRESSES (exactly 100 arm-A rows per tick, oldest-first, disjoint id sets) — draining the backlog is explicitly NOT the goal and NOT a merge gate; conservation + B3 verified row-by-row; human gate before the one-way merge

**Note**: The "fence flake also clears" claim is observation-only, NOT an acceptance criterion (research correction #4). Constrained by JOB-07 (pg_cron only).
**Note (SC 4 / JOB-08, added 2026-08-03)**: routed here from `TODOS.md` § CI / test-infra ratchet — same table, same cron family this phase already edits, and SC 3's TEST-vs-PROD split is the same gap. Full evidence and the two ⛔ traps (never `DELETE` pending; never `cron.unschedule(9)`) are in `REQUIREMENTS.md` § JOB-08. ⚠️ The gap is CERTAIN on the TEST project and UNMEASURED on prod — that asymmetry is why SC 4 is measure-first rather than build-first.

### Phase 145: JOB — csv-finalize atomicity (reproduce-first)

**Goal**: A mid-request csv-finalize failure leaves no orphan strategy row — and no budget is spent re-fixing the likely-stale 42501 bug
**Depends on**: Phase 144 (JOB sequence; order-independent within JOB — last because its scope needs the reproduction result first)
**Requirements**: JOB-06
**Success Criteria** (what must be TRUE):

  1. A documented reproduction attempt of the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim against current `main` exists (committed pass/fail) BEFORE any fix is scoped — "could not reproduce" is a valid, budget-saving outcome.
  2. A fault injected between `finalize_csv_strategy`, `persist_csv_daily_returns`, and the `after()` enqueue leaves no orphan strategy row — either the steps share one SECURITY DEFINER transaction, or explicit compensating cleanup runs + Sentry alerts (the choice recorded per the reproduction outcome and the CONTRIB-02 `p_terminal_status` owner-only variant's survival).
  3. Happy-path csv-finalize behavior is unchanged — including the CONTRIB-02 owner-only private-finalize path if the RPCs are folded.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 145-01-PLAN.md — SC#1 repo-side arms: 42501 auth-guard SQL CI gate (arm 1, neuter-RED proven on throwaway Postgres against the REAL 20260728120000 body) + fresh arm-2 grep + arm-3 pytest recorded verbatim + 145-REPRODUCTION.md draft + PITFALLS/SUMMARY anchor corrections, ONE commit

**Wave 2** *(blocked on Wave 1; orchestrator-session-only, BLOCKING)*

- [x] 145-02-PLAN.md — [BLOCKING] Census (4 queries × 2 projects, per-row, STOP rules pre-registered) + arm-4 live TEST finalize (doubles as SC#3 baseline) + (i-a) seam latency measurement Steps A/B/C + final CANNOT-REPRODUCE verdict + TODOS 42501 bullet closed + founder decision checkpoint (i-a)/(i-b) recorded in 145-DECISION.md

**Wave 3** *(blocked on Wave 2 — verdict committed before any SC#2 code)*

- [x] 145-03-PLAN.md — The caller-agnostic fold migration (`finalize_csv_strategy_with_returns`, ONE SECDEF transaction, no exception-handler clause, 20260624120000 table shape, guards verbatim, DROP old RPCs + re-grant) + SAME-COMMIT re-point of test_csv_finalize_double_submit.sql (Part 3 widened to 3 tables) and the auth-guard gate + new atomicity-oracle gate + throwaway-Postgres tracer proof + 8-neuter SQL RED matrix

**Wave 4** *(blocked on Wave 3 + the recorded decision)*

- [x] 145-04-PLAN.md — Caller wiring per 145-DECISION.md (both arms specified; exactly one executed) + read-only 23505 resolve arm with CR-01 name/range checks BEFORE metadata (fixes the 409 lie) + three honest copy sentences + finalize-fold-fail / finalize-resolve-refused Sentry captures + SAME-COMMIT re-point of the five CR-01 tests (each observed RED) + pytest/mypy --strict

**Wave 5** *(blocked on Wave 4)*

- [x] 145-05-PLAN.md — Delete the vacuous RED-TEAM-M1 block + replacement gates that CAN fail (3 observed neuter-REDs) + three TODOS deferrals with constraints (window E, wizard first-hop, inert flag cleanup w/ 20260620120000 RAISE trap) + consolidated TS neuter-RED table

**Wave 6** *(blocked on Waves 3-5; orchestrator-session-only, BLOCKING)*

- [x] 145-06-PLAN.md — [BLOCKING] Apply fold to TEST via Supabase MCP (never db push), sql-tests observed RED→GREEN, live finalize + SC#3 measured before/after diff vs the arm-4 baseline, one-time human-reviewed TERMINALIZE of the census list (UPDATE-only: analytics 'failed'+reason then status='archived'; founder ruling β), human gate before the one-way merge

**Note**: Constrained by JOB-07 (any cleanup mechanism stays off the worker loop). Founder rulings locked 2026-08-17: (1) orphan disposition = TERMINALIZE reading (β) — deletion arms out of scope; (2) the (i-a)/(i-b) caller choice is measure-first and founder-reserved — Plan 02 executes the measurement and stops at a decision checkpoint. ⛔ 20260816140000 (143) and 20260817120000 (144) untouched by every plan.

### Phase 146: RATE — Audit + close the two verified gaps

**Goal**: Every authed route hitting the Python service has the RIGHT rate limit — and a newly-added route can't silently ship with none
**Depends on**: Nothing upstream (mechanical; sequenced last so its gap list comes from a fresh grep)
**Requirements**: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05
**Success Criteria** (what must be TRUE):

  1. A committed kickoff re-grep artifact lists every `src/app/api` route calling either seam client × its `checkLimit` status — the authoritative gap list, replacing the stale `TODOS.md` route list (which named seven routes that were already limited).
  2. Burst requests to `admin/match/eval` beyond a per-`user.id` limit sized to real eval-tooling cadence receive `429` + `Retry-After`.
  3. Requests hitting Railway's `routers/match.py` (`/recompute`, `/eval`) directly — bypassing Vercel with a leaked `X-Service-Key` — are rejected `429` by server-side slowapi limits mirroring `portfolio.py`'s pattern (defense-in-depth).
  4. A committed audit of the seven existing limiter VALUES against real Python-side cost exists, with adjustments applied where a value was wrong — the substantive remaining RATE question. *(Disposition locked D-146-4, 146-CONTEXT.md: the audit RECORDS each mismatch with a measured-numbers recommendation (146-AUDIT.md §3, full 14-route surface); value ADJUSTMENTS are founder-queued via TODOS.md "Phase 146 — RATE-04 value-parity candidates" — retuning live limits is founder territory, zero values changed in-phase; reversal point = ship gate.)*
  5. A `withRateLimit(handler, limiter)` HOF exists and composes alongside `withAuth`/`withRole`, wired on the routes this phase touches — so the no-CI-gate hand-wiring weakness has a structural successor. *(Disposition locked D-146-1, 146-CONTEXT.md: satisfied VERIFIED-EXISTING by `withAuthLimited` + `withAdminAuth({rateLimitKey})` + the two CI gates, with a fresh-grep receipt — no second wrapper; reversal point = ship gate.)*

**Plans:** 3/3 plans executed

Plans:
**Wave 1**

- [x] 146-01-PLAN.md — RATE-02 eval limiter (mirror recompute, 3 rosters same-commit) + RATE-01 fresh census + RATE-05 VERIFIED-EXISTING receipt into 146-AUDIT.md; retire stale TODOS bullet

**Wave 2** *(blocked on Wave 1)*

- [x] 146-02-PLAN.md — RATE-03/TS-21 match.py slowapi limiters (5 gates same-commit, tripwire deleted) + TS-23-remainder 429→service_error w/ Retry-After preserved + TS-36 parity pytest; pytest+mypy --strict from analytics-service/

**Wave 3** *(blocked on Waves 1-2)*

- [x] 146-03-PLAN.md — RATE-04/TS-22 value parity audit (fresh tables at HEAD, per-mismatch recommendations, value candidates → TODOS per D-146-4) + phase close w/ checkbox discipline

---

## v1.17 phase detail, retained (Phases 147–156)

**Goal:** MT5 *works* in the founder's sense rather than the wizard's — it ingests (done), it
projects in a scenario, and its factsheet is viewable by the allocator who uploaded it.

**Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD):**
> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it
> in the scenario, and I can still not produce a factsheet."*

**Scope:** 30 in-scope requirement IDs — SCEN-01..05, AUM-01..05, NAV-01, OWN-02..05, MT5-06..10,
MT5-14, MT5-15, WIZFORM-01..05, WIZCONT-01..02, STALE-01, plus the umbrella acceptance requirement
MT5-GOAL-01 — per `.planning/REQUIREMENTS.md`. ⛔ OWN-01 excluded (already met — CONTRIB-03,
verified in code 2026-08-04; do not re-implement). ⛔ SEAM / JOB / RATE / PYAPI* / SEAMCORE /
SEAMUX remain v1.16 (PARKED below) and appear in NO v1.17 phase. Research SKIPPED (zero new
external features; every requirement is an already-root-caused defect carrying PROD evidence and
file:line citations in REQUIREMENTS.md). Phase numbering continues from 147 (v1.16 ended at 146).

⭐ **Defining constraint: almost NONE of this is an MT5 defect.** MT5 is the first venue to
traverse the whole path from a cold start, so it is exposing pre-existing holes in the surfaces
AFTER ingestion. SCEN-01 affects every real strategy at every venue; OWN-02 blocks every
unpublished strategy; AUM-05 will hit sFOX the day its flag flips. **A fix scoped to
`exchange === 'mt5'` is the wrong fix for nearly all of it.**

**Ordering rationale (non-negotiable — these are real dependencies, not preferences):**

- **SCEN-01 (147) FIRST** — a silent money-path correctness bug
  (`strategy_analytics.daily_returns` has NO production writer: 0 of 27 real strategies populated
  vs 15/15 demo seeds) AND it blocks meaningful verification of every other scenario surface —
  you cannot judge a composer whose engine receives an empty series.

- **OWN-02 (148) before NAV-01 (149), OWN-04 (same phase, strictly after) and SCEN-03 (152)** —
  all three link to a factsheet that today 404s; shipping them first builds the exact dead-end the
  previous milestone existed to delete.

- **148/149/150 split (revision 2026-08-04, superseding the approved single Phase 148):** the
  approved roadmap carried OWN-02 + OWN-03 + OWN-04 + NAV-01 as one phase. NAV-01 was then
  SHARPENED by the founder from "an overview" to a full **ranking at discovery parity** over every
  uploaded key incl. `private`/`draft` rows, and the bundled phase would have mixed three review
  profiles that dilute each other: a cache-disclosure fix with an adversarial acceptance test
  (OWN-02), a parity/no-invented-data UI surface (NAV-01), and the OWN set's first money-path
  WRITE (OWN-03, founder-mandated money-path review). Split so each gets the review it needs;
  every ordering constraint is unchanged and now structural (149 cannot start before 148).

- **AUM (151) after SCEN-01** — its symptom (zeros on screen) is entangled with SCEN-01's and
  would otherwise appear unfixed. ⚠️ AUM-01 does NOT fix the 0.00 metrics — that is SCEN-01.

- **MT5-06..10 (155) LAST** — they need a live funded account on a real trading day and a stable
  surface to measure; running them earlier means re-running them.

## Phases

- [x] **Phase 147: SCEN-01 — The scenario engine receives the real series** - Fix the READER (never the writer): every added strategy contributes its actual daily returns via the existing `resolveDailyReturnSeries`; wealth-index `returns_series` is differenced, never forwarded raw (completed 2026-08-05)
- [x] **Phase 148: OWN — Owner factsheet without cache disclosure** - The owner views the full factsheet of their own unpublished strategy; adversarial anon-404 acceptance on the public `unstable_cache`d route; wizard-preview link that can never dead-end (OWN-04 strictly after OWN-02) (completed 2026-08-05)
- [x] **Phase 149: NAV — "My strategies": a ranking at discovery parity** - Sidebar entry showing every uploaded key + derived strategy incl. `private`/`draft` rows, ranked with the SAME component/query as the external ranking (visibility predicate is the only difference); honest pending states, never zeros (completed 2026-08-05)
- [x] **Phase 150: OWN-03 — The wizard asks whose capital this is** - Own-capital-with-allocation vs verifying-a-team question at allocator finalize; (b) stays the default and a no-op; only an explicit (a) creates the portfolio position (money-path reviewed) (completed 2026-08-06)
- [x] **Phase 151: AUM — A book you can reach and a size you can set** - Direct AUM input, non-ccxt holdings-sync crash fixed as a CLASS (MT5 + latent sFOX), all-or-nothing book gate fixed incl. cross-role contamination, honest refusal copy (completed 2026-08-07)
- [x] **Phase 152: SCEN — Composer legibility** - Ownership marker, clickable rows with a working factsheet link, labelled numbers, no duplicate browse entries (completed 2026-08-07)
- [x] **Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)** ✅ **GOAL MET 2026-08-14 — via the INSERTED Phase 153.7, not by the original span.** Inline field validation, honest error codes from emitting sites, transient infra absorbed not surfaced, venue-appropriate copy, MT5 preselected in metadata. ⭐ **The mechanism is named on purpose and a bare tick would erase it:** the 153.1→153.6 span verdict REMAINS `failed` 5/6 in `153-VERIFICATION.md` and must not be rewritten — that file is the historical record that the span shipped short on WIZFORM-02. Phase 153.7 closed all four of its `missing` items, re-derived from source by the v1.17 milestone audit (router-vocabulary disposition at `wizardErrors.ts:3081`; population root widened at `seam-venue-vocabulary.invariant.test.ts:89` plus the `service_error` callee family at `:318`; boundary decision with per-exclusion reasons and count pins at `SCAN_EXCLUSIONS:134`; `KNOWN_CODELESS_FINALIZE_REJECTIONS = 0`), with both invariants executed at this tree — 2 files / 60 tests passed
- [x] **Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens** - Draft-aware entry chooser, stale-screen root cause investigated BEFORE fixed (verdict M2(ii)), token-less credential dedup toward the existing row (completed 2026-08-12)
- [x] **Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered** ✅ **COMPLETE 2026-08-14** (INSERTED 2026-08-14) - The coverage law's population is DERIVED from every user-reachable code (`analytics-service/**`, positional `service_error(...)` as well as `error_code =`), and a code absent from BOTH halves reds CI; closes the one requirement the 153 span failed. 3/3 plans: population 17 → 37, all 37 dispositioned, and the last three code-less `finalize-wizard` rejections coded (ledger 3 → 0 with `EXPECTED_FINALIZE_REJECTION_SITES` never edited). **WIZFORM-02 ticked.** ⛔ NOT "add two rows" — see TODOS.md FIX NOW #6
- [→] **Phase 155: MT5-VERIFY — The numbers are true, live on a trading day** — ➡️ **CARRIED OUT OF v1.17 TO v1.18 on 2026-08-14.** Not started, not dropped, not ticked. Server-UTC offset measured, external-oracle parity on the live funded account, five surfaces agree, discrepancies fixed (uncapped), warnings explained; MT5-GOAL-01 acceptance gate. ⛔ Founder-gated twice over: new investor passwords AND the founder at the terminal on a trading day. Detail block below is retained in place; the milestone header at the top of this file owns its blockers
- [→] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make** — ➡️ **v1.18** (CREATED 2026-08-14). Discharges the human-verification items Phases 153.7 and 154 left open: the resume banner, the amber recomputing block, the four new copy members rendering (with NO Retry on `SEAM_INTERNAL_FAULT`), and the `MT5_SPIKE_INVESTOR_PASSWORD` rotation
- [x] **Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes** ✅ **COMPLETE 2026-08-13** - `attested_venue` written by a service-role writer from the venue this server observed a successful read-only authentication at; `authenticated` EXECUTE withdrawn from both wizard RPCs; closes the PARITY-04 deferred control (CR-01, was live on PROD). Shipped as TWO PRs with a live PROD gate between them. ⛔ The pull-forward-ahead-of-155 trigger (sFOX go-live) is now moot — the residual it protected against is closed

## Phase Details

### Phase 146.1: REVIEW: v1.19 xhigh close-out — fold guards, resolve-arm honesty, rate-gate completeness (INSERTED)

**Goal:** The 15-finding v1.19 xhigh review (2026-08-18) is closed: the fold refuses
NULL/empty/poisoned series (22023), the resolve arm refuses cross-flow and
constraint-mismatched echoes, failure copy never claims rollback it cannot observe, the
Python rate-limit surface has a route-enumeration gate a new route cannot silently bypass,
and the terminalizer's failed_final rows no longer exclude their strategies from the
reconciliation sweep — plus the v1.19-topical TODOS deferrals absorbed into one pass.
**Requirements**: A1-A4, B1-B5, C1-C4 — full roster with file anchors in `146.1-CONTEXT.md`. Four easy findings already fixed and merged as v0.66.0.1 (76adf961).
**Depends on:** Phase 146
**Plans:** 7 plans (plan 08 lifted to Phase 164.5.2 on 2026-09-07) across 6 waves. ⛔ Sequencing is MEASURED, not stylistic: five roster items
(B3/A2/A4/A3/C2) all edit `csv-finalize/route.ts` and run SERIAL in one agent; A1+B5+the new
fold-gate arms all edit `test_csv_finalize_atomic_fold.sql` and share ONE plan. Only the three
CONTEXT-named lanes are parallel (wave 1). ⚠️ Both migrations AUTO-APPLY to PROD on merge —
`146.1-08` is a blocking pre-merge gate and cannot be delegated to a worktree agent.

Plans:

- [x] 146.1-01-PLAN.md — wave 1 · A1 fold input guards (NULL / empty-non-trades / NaN·Inf·magnitude / absurd-date / duplicate-date) as a `CREATE OR REPLACE` forward migration `20260819130000`, its self-verify, the regenerated snapshot, the new fold-gate Parts, B5's re-homed 22023 guards, C4's Part 3d and the `service_role` REVOKE
- [x] 146.1-02-PLAN.md — wave 1 · B1 Python route-enumeration gate over `main.app.routes` with an empty-by-equality quarantine roster — RATE-03's "a new route cannot silently bypass" made true on the Python side, zero runtime change
- [x] 146.1-03-PLAN.md — wave 1 · B4 sweep readmits terminalizer-produced orphans via the NARROW marker predicate (migration `20260819130500`) + new must-heal arm C4; ⛔ the roster's blanket widening is refused — it reddens shipped arms C2/C3. Plus C3 documented
- [x] 146.1-04-PLAN.md — wave 2 · route cluster part 1 (serial): B3 constraint-name discrimination → A2 terminal-status refusal → C1 honest echo copy, plus C4's two resolve-arm fail-closed pins
- [x] 146.1-05-PLAN.md — wave 3 · route cluster part 2 (serial): A4 required `fresh` discriminator gating the metadata UPDATE → A3 commit-agnostic copy on the transport / lost-id classes → C2 handler collapse with its source-shape gates rewritten, not deleted
- [x] 146.1-06-PLAN.md — wave 4 · B2 founder call: STOP forwarding `X-User-Access-Token` from both routes, add a zero-emitter equality gate, and AMEND the Phase 140.2 obligation repo-wide in the SAME commit
- [x] 146.1-07-PLAN.md — wave 5 · C4 remainder: types regen + cast-through-unknown deletion + the audit-law consequence (coupled, one commit); RT-3 burned-signature persistence in the signed envelope; Python tombstone message-only (no new code — WIZFORM-02 is OPEN); the stale-comment batch
- [x] 146.1-08-PLAN.md — wave 6 · ORCHESTRATOR-ONLY pre/post-merge migration gate: PROD+TEST census, TEST rehearsal of both migrations, both SQL gate files EXECUTED on TEST, 14 named neuters observed RED and restored, blocking merge checkpoint, then post-merge PROD verification including one real `cron.job_run_details` tick

### Phase 146.2: REVIEW: 146.1 post-merge close-out — the echo path must not silently drop a strategy's classification, and the passphrase must not reach Sentry (INSERTED)

**Goal:** A CSV finalize that recovers via the resubmit path A3's own copy instructs lands the user's classification instead of silently defaulting it, and no raw exchange credential reaches Sentry.

**Success criteria:**

1. A resubmission that takes the 23505 echo path applies the submitted `category_id`/`asset_class` when the committed row has none, and REFUSES (409 `CSV_SESSION_REUSED`) when a present classification conflicts — the A2 identity rule extended to the second identity field.
2. `passphrase` is scrubbed from every Sentry capture site on the verify-strategy route, and the docblock's enumeration matches the array.
3. The B4 readmit predicate cannot drive an unbounded reaped-orphan retry loop.
4. RT-3's re-mint persists the NEW session id — a reload in the re-mint window cannot resume a spent id with the burn cleared.
5. Each fix carries a regression test that is observed RED under a named neuter.

**Requirements**: R1 (blocker), R2 (security), R3–R7 (correctness/honesty), W1–W3 (carried from the 145/146.1 verifications)
**Depends on:** Phase 146.1 (PR #692, squash `a6a2dee8`) — this phase reviews ITS output
**PROD exposure:** re-measured 2026-08-19 at plan time — `suspect_and_visible = 0`, zero csv strategies created since A4 ⇒ forward-fix only, NO backfill in scope
**Plans:** 8 plans across 3 waves. ⛔ Sequencing is the file-collision map: `csv-finalize/route.ts` is
SINGLE-OWNER SERIAL (plan 01 wave 1, plan 06 wave 2); the two migrations are one-way doors with
in-plan decision checkpoints, and plan 08 is the ORCHESTRATOR-ONLY 146.1-08-pattern migration gate
(TEST rehearsal → blocking merge checkpoint → PROD census) — it cannot be delegated to a worktree
agent. THE CRUX is ratified in plan 01: `category_id IS NULL` is the never-classified discriminator
(asset_class is NOT NULL DEFAULT 'traditional' — indistinguishable from a user choice), and the
trades-echo FILL-safety hole is settled with evidence (trades strategies structurally carry no
stored KPIs: enqueue gate + sweep dailies conjunct, both self-verify-pinned).

Plans:

**Wave 1**

- [ ] 146.2-01-r1-echo-classification-fill-refuse-PLAN.md — R1 BLOCKER: resolve-arm tri-state FILL/REFUSE/no-op on `category_id IS NULL`, A2-residual fail-closed status echo, economic oracle survives unchanged
- [ ] 146.2-02-r2-passphrase-sentry-scrub-PLAN.md — R2 SECURITY: passphrase joins the scrub array via a shared credential tuple; TRAP-1 seam test RED-first
- [ ] 146.2-03-r4-remint-persists-new-id-PLAN.md — R4: mint-first ordering, one save carries new id + cleared burn
- [ ] 146.2-04-r3-readmit-ceiling-migration-PLAN.md — R3: sweep readmit ceiling via marker-row count (zero DDL), migration `20260819150000`, gate arm C5 + the carried B4-BLANKET neuter actually RUN (checkpoint: ceiling N)
- [ ] 146.2-05-r5-fold-guard1-null-safe-w3-pins-PLAN.md — R5+W3+W2: fold GUARD 1 `IS NULL OR` migration `20260819151000` + snapshot regen, standing prosrc no-handler + service_role pins, double-submit prose re-cut (checkpoint: one-way door)

**Wave 2** *(blocked on plan 01)*

- [ ] 146.2-06-r7-resolve-pins-audit-event-PLAN.md — R7 date lower-bound mirror; undriven fail-closed arms pinned by step tag; c14 echo discrimination restored; `strategy.csv_finalize` audit event (absorbed item, decided IN SCOPE); two TODOS deferrals re-recorded
- [ ] 146.2-07-r6-echo-copy-render-w1-fixtures-PLAN.md — R6: echo `human_message` renders in-step with explicit continue (product call taken); W1 provenance constants re-typed from HEAD

**Wave 3** *(blocked on plans 04+05; ORCHESTRATOR-ONLY)*

- [ ] 146.2-08-migration-gate-orchestrator-PLAN.md — 146.1-08 pattern: TEST rehearsal of both migrations with all gate arms armed, blocking merge checkpoint, post-merge PROD census (ceiling body, one cron tick, GUARD 1 arm, ACLs, exposure still 0)

### Phase 147: SCEN-01 — The scenario engine receives the real series

**Goal**: A strategy added to a scenario contributes its actual return series — never silent zeros
**Depends on**: Nothing (first phase of v1.17)
**Requirements**: SCEN-01
**Success Criteria** (what must be TRUE):

  1. Adding any REAL (non-demo) strategy to a scenario — MT5, OKX, Bybit, CSV — projects non-zero metrics with an overlapping-days count matching its stored `csv_daily_returns` span (the founder's MT5 strategy contributes its 136 days, not "0 overlapping days" / 0.00 everywhere).
  2. The series the composer blends for a strategy equals the series that strategy's own detail pages render — both resolved through the ONE existing `resolveDailyReturnSeries`, with no third resolution mechanism minted (structurally asserted, not just observed).
  3. A wealth-index `returns_series` is never forwarded raw: a regression test feeds a series starting at exactly 1.0 and proves it is DIFFERENCED (day one is not +100%).
  4. A strategy with genuinely no stored series renders an honest empty/degraded state — never 0.00 metrics with no error, no warning, no empty-state.

**Plans**: 6 plans, 4 waves
Plans:
**Wave 1**

- [x] 147-01-PLAN.md — Foundation: resolve-series leaf extraction + SeriesState/deriveEmptySeriesState (16h age bound) (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 147-02-PLAN.md — Returns route (the SCEN-01 bug proper) + OG route: widen, resolve, series_state (wave 2)
- [x] 147-03-PLAN.md — Share path: Phase-84 sibling read + pure-layer resolver, zero DDL (wave 2)
- [x] 147-04-PLAN.md — Book path (`src/lib/queries.ts` — `getMyAllocationDashboard` defined :3323, its `portfolio_strategies` read :4217; the 4th reader): server-side resolution + derived series_state (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 147-05-PLAN.md — Composer UI: chip states syncing/no-series, tolerance, notes, SC4 matrix (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 147-06-PLAN.md — P6 reopen/refresh hydration fetch + SC2 structural grep-gate + audit/ledger closure (wave 4)

**Notes (binding traps)**:

- ⛔ **The READER is wrong, not the writer.** `strategy_analytics.daily_returns` has NO production writer at all (only the two demo/e2e seed scripts write it); the composer's returns route (`src/app/api/strategies/[id]/returns/route.ts` — the `strategy_analytics` `.select(` at :251-255) selects only that column. Do NOT backfill the column — that fights migration 087 (`20260428120919`, decision D-02), which deliberately moved heavy series off `strategy_analytics` (1MB TOAST ceiling).
- ⚠️ `returns_series` is a WEALTH INDEX — `_drop_nonfinite(cumprod(1+returns))`, verified on PROD for `4eab92b0`: starts at exactly 1.0, ends 0.7196. Shape-identical to `DailyPoint[]`, semantically inverted. It must be differenced.
- ⭐ Reuse `resolveDailyReturnSeries(daily_returns, returns_series)` — it already backs BOTH strategy-detail surfaces (`src/app/factsheet/[id]/v2/page.tsx` — `resolveDailyReturnSeries` call :121, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — same call :65), has its own tests, and its docstring names this exact bug. Rule 7: do not mint a third mechanism.

### Phase 148: OWN — Owner factsheet without cache disclosure

**Goal**: The allocator who uploaded a strategy can view its full factsheet from that account — while it stays invisible to everyone else, and publication stays admin-only
**Depends on**: Phase 147 (sequencing; OWN-02 is itself the hard prerequisite for every factsheet link shipped later — NAV-01 in 149, SCEN-03 in 152, and OWN-04 within this phase)
**Requirements**: OWN-02, OWN-04
**Success Criteria** (what must be TRUE):

  1. The owner, from the account that uploaded it, views the FULL factsheet of their own unpublished (private/draft) strategy — today `withPublishedOnly` at `src/app/factsheet/[id]/v2/page.tsx` — the public arm `fetchAndBuildPayload(id, withPublishedOnly)` :296, whose miss reaches `notFound()` :454 — 404s them.
  2. **Adversarial, not happy-path:** AFTER an owner has viewed their draft, an anonymous request for the same id still 404s — the public `unstable_cache`d factsheet route never serves a cache entry populated by an owner render. Proven by a test.
  3. The wizard preview links to the full factsheet, and no link shipped in this phase can land on `notFound()` (OWN-04 — strictly after OWN-02 within the phase).
  4. Nothing shipped here widens visibility beyond the owner: anonymous and non-owner authed requests still see published-only on every surface the gate change touches, and publication remains admin-only.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 148-01-PLAN.md — viewerNotice banner capability in FactsheetView (additive prop, byte-neutral, UI-SPEC verbatim)
- [x] 148-02-PLAN.md — DI seam: fetchAndBuildPayload(id, visibility) required param; cached wrapper stays visibility-free with the withPublishedOnly literal; false cache-key comment corrected; force-dynamic pin

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 148-03-PLAN.md — Lane B owner lane (probe-first, uncached build) + page.owner-lane.test.tsx with unstable_cache SPY (SC1/SC2-A/SC4)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 148-04-PLAN.md — SC2-B structural CI invariant (147-guards clone) + Rule-9 mutations at two sites

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 148-05-PLAN.md — OWN-04 wizard link, both success branches, structurally absent pre-success + phase gate & VALIDATION sign-off

**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **OWN-02 is NOT a one-line `withPublishedOnly` → `withPublishedOrOwner` swap.** The route is PUBLIC and `unstable_cache`d keyed on `${id}::${computedAt}`, and its own header justifies the cache as safe *because "the only fields we cache come from the published row."* An owner-inclusive gate without cache work is a disclosure bug (same class as the `strategy_analytics (*)` anon splat in TODOS). Criterion 2 is the acceptance test.
- ⛔ OWN-04 must not land before OWN-02 within the phase — a link to `notFound()` is the dead-end class Phase 142.2 existed to delete.
- ℹ️ NAV-01 (the "my strategies" ranking) moved to Phase 149 in the 2026-08-04 revision; it consumes this phase's cache-safe `withPublishedOrOwner` gate and MUST NOT be pulled forward into this phase.

### Phase 149: NAV — "My strategies": a ranking at discovery parity

**Goal**: The allocator side stops being write-only — a sidebar entry shows every key they uploaded and every strategy derived from them as a ranking at parity with the external/discovery ranking, and every row opens its factsheet
**Depends on**: Phase 148 (OWN-02 — both the cache-safe visibility predicate and a factsheet that resolves; a ranking whose rows link to `notFound()` is the dead-end class Phase 142.2 existed to delete)
**Requirements**: NAV-01
**Success Criteria** (what must be TRUE):

  1. A sidebar "my strategies" entry (MY WORKSPACE) opens a ranking covering **every key the allocator uploaded AND the strategies derived from them — including `private` and `draft` rows**, which are exactly what every existing ranking surface filters out. Proof case: the founder's account (8 active keys — bybit, okx, deribit ×3, mt5 ×3), none of which appears on any ranking today, all present here.
  2. The ranking is at **PARITY with the external/discovery ranking** — same metric columns, same sort affordances, same `#n` + percentile presentation per DESIGN.md — so the allocator judges their own uploads on the same axes they judge third-party strategies.
  3. **Structural reuse, asserted not merely observed:** the surface is the EXISTING ranking component/query, and the visibility predicate is the only genuine difference (own-including-unpublished via OWN-02's `withPublishedOrOwner`, vs published-only). No second ranking implementation exists to drift.
  4. Metrics for `private`/`draft` rows come from the same analytics the factsheet renders — never a placeholder or a reduced column set for unpublished rows; a row whose analytics have not computed yet shows an honest pending state, never zeros (no-invented-data).
  5. Clicking any row — including a `private`/`draft` one — opens its factsheet (via OWN-02), never `notFound()`.

**Plans**: 5 plans in 4 waves (planned 2026-08-05)

Plans:
**Wave 1**

- [x] 149-01-PLAN.md — StrategyTable `visibility` parameterization (Pitfall 1) + grid-toggle suppression + published-gated Simulate button (Wave 1)
- [x] 149-02-PLAN.md — getMyStrategies (own-only predicate, documented deviation) + strategy-less-keys anti-join (both key links) + Badge `private` fix (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 149-03-PLAN.md — status marker + honest pending chip + Delta-5 placeholder rows (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 149-04-PLAN.md — /my-strategies page + comparison-set line + sidebar entry + role wiring (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 149-05-PLAN.md — phase-149 structural CI gate + Rule-9 mutation campaign + phase gate (Wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Reuse cuts both ways.** Parameterize the visibility predicate; do NOT globally widen the shared query — the published-only predicate on discovery/public surfaces must be provably unchanged, or this phase ships the leak OWN-02's cache work exists to prevent. An unpublished row's metrics must never reach any anon or non-owner surface through the shared path.
- ⚠️ **Percentile population is a deliberate plan-time decision** (own rows ranked against the published universe vs among themselves) — decide it explicitly at plan/discuss time, do not let it fall out of whichever query is handy. Whatever is chosen must be honest about its comparison set.
- ⛔ Do not start before Phase 148 lands — the dependency is structural, not stylistic.

### Phase 150: OWN-03 — The wizard asks whose capital this is

**Goal**: When an allocator adds a key the product asks the question it never asked — own capital, or a trading team's key being verified — stores the answer as a persistent ownership mark, and lets ONLY marked own-capital strategies be added to the allocation from the Holdings tab
**Depends on**: Phase 148 (soft — keeps the OWN cluster contiguous, and the created position's strategy is then visible via factsheet/ranking so the write can be verified end-to-end; no hard code dependency)
**Requirements**: OWN-03, OWN-05
**Success Criteria** (what must be TRUE):

  1. At allocator key-add, the wizard ASKS which of two things this is — (a) a key with my own capital in it, or (b) a trading team's key I am verifying (the DEFAULT) — and stores the answer as a persistent ownership mark. The wizard writes NO position and asks NO amount (2026-08-05 refinement: mark in wizard, allocate in Holdings — supersedes the 2026-08-04 finalize-form reading). Copy is CRISP and the question lives in the categorization step.
  1b. The categorization/profile step is culled to essentials: AUM, strategy-size, strategy-type and similar questions are removed or collapsed behind an optional disclosure (founder 2026-08-05, "just essentials, especially for the allocator") — with every culled answer's downstream consumer checked (hide per no-invented-data, never fabricate).
  1c. An allocator can rename their OWN private/draft strategies to a proper name (OWN-05); owner-authz only; the public codename/disclosure redaction contract stays byte-untouched; all owner surfaces (my-strategies, Browse own rows, owner factsheet, holdings alias) render the new name coherently.

  2. In the HOLDINGS tab, a strategy marked own-capital can be ADDED to the allocation (explicit action + amount — the money-path review applies to THIS write). Choosing (b) — or any path that never reaches the question — changes nothing: `status='private'`, portfolio untouched, behaviour-compatible with today.
  2b. ⛔ HARD INVARIANT: a team-review-marked strategy can NEVER become a position — no code path creates an allocation from it (an allocator cannot put money into a trading team's account). Asserted structurally, like the visibility gates. The retro path (marking pre-existing own strategies such as Black Swan so they become allocatable) is part of this phase.

  3. Auto-add remains refused: no code path adds to the portfolio without the explicit (a) answer — the founder has refused auto-add TWICE.
  4. Adding the same strategy twice has a defined, reviewed behaviour — never a silent duplicate position or a double-count.

**Plans**: 8 plans in 4 waves

Plans:
**Wave 1**

- [x] 150-01-PLAN.md — DB: capital_ownership column + D-03 BEFORE INSERT trigger + atomic flip RPC + pgTAP; [BLOCKING] MCP apply to TEST (wave 1)
- [x] 150-02-PLAN.md — Shared contracts: isAllocatable predicate, type widening, OwnershipTag, CapitalOwnershipRadioGroup, dollar-validator lift (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 150-03-PLAN.md — Wizard: capital question first + cull-to-disclosure + asset-class hoist + post-finalize mark persistence (wave 2)
- [x] 150-04-PLAN.md — Routes: PATCH ownership (retro mark + 409/confirm/RPC flip) + PATCH name (OWN-05 rename) + audit actions (wave 2)
- [x] 150-05-PLAN.md — Holdings data: allocation route (upsert, allocated_amount ONLY), getOwnCapitalStrategies, adapter + owner-name carve-out (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 150-06-PLAN.md — my-strategies + factsheet UI: tag, row actions, Mark/Rename dialogs, owner-lane thread (wave 3)
- [x] 150-07-PLAN.md — Holdings UI: rows, AllocateDialog, three-arm empty state, unsigned-weight fix + contract pin (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 150-08-PLAN.md — Structural D-03 gate with mutation ledger + full regression + VALIDATION close (wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **OWN-03 is the first WRITING requirement in the OWN set** → it needs its own money-path review (weights, allocation basis, what happens when the same strategy is added twice). That review is WHY this is its own phase rather than a rider on 148 — do not fold it back.
- ⛔ The deliverable is a WIZARD QUESTION, not an auto-add; (b) must stay the default and stay a no-op.
- ⚠️ Coordinate with AUM-04 (Phase 151): a position created from an owned strategy must not re-introduce cross-role gate contamination or double-count against live holdings.
- ⚠️ **DISCUSS-PHASE DECISION (founder-hit 2026-08-05): the retro path.** SC1's question fires at wizard FINALIZE — but the founder's already-contributed strategies (Black Swan, Alpha Centauri, Arctic Fox) finalized BEFORE the question existed, so they can NEVER be allocated without re-onboarding. Decide the allocate-existing-own-strategy affordance (e.g. an "Allocate…" action on the /my-strategies row or the owner factsheet) — same money-path review, same no-auto-add rule. Related observed confusion: the header "+ Allocation" button on non-Scenario tabs opens the connect-key wizard (Phase 116 design) with no path to an existing strategy, and the Holdings STRATEGIES panel says "No strategies onboarded yet" while contributed strategies exist — copy/affordance both belong to this phase's surface once positions become creatable.

### Phase 151: AUM — A book you can reach and a size you can set

**Goal**: An allocator can always reach their live book, size a hypothetical one directly, and no venue crashes the holdings sync
**Depends on**: Phase 147 (AUM's zeros-on-screen symptom is entangled with SCEN-01's and would otherwise appear unfixed)
**Requirements**: AUM-01, AUM-02, AUM-03, AUM-04, AUM-05
**Success Criteria** (what must be TRUE):

  1. The allocator sets AUM directly in the composer and weights/dollar sizes follow — a blank-slate scenario holding only added strategies can size and commit ("allocate $500k to this strategy" becomes expressible) (AUM-01).
  2. An MT5 account's equity contributes a holdings row, and no key ever again stamps a raw Python `AttributeError` into the user-visible `sync_error` column — fixed at the non-ccxt venue CLASS: the same test shape passes for sFOX (`get_balances`, not `fetch_balance`) BEFORE its go-live flip (AUM-02, AUM-05).
  3. The founder's own book (~$460k, 8 active keys of which 3 deribit + 3 mt5 carry zero per-key dailies) reaches "From my book" — the gate is no longer all-or-nothing over every eligible key, and MANAGER-side MT5 keys no longer pin the ALLOCATOR's book gate false permanently (cross-role contamination) (AUM-04).
  4. The AUM-zero refusal copy names only affordances that actually exist — never the deliberately-never-built live-holding toggle (AUM-03).

**Plans**: 7 plans

Plans:

- [x] 151-01-PLAN.md — Extract MT5 terminal-concurrency machinery into services/mt5_concurrency.py (leaf; the ONE lock registry)
- [x] 151-02-PLAN.md — Split the book gate SSR-side: deriveStrategyLinkedKeyIds + 3 additive payload fields on both branches
- [x] 151-03-PLAN.md — Non-ccxt venue dispatch + MT5 account-equity branch (kill switch, shared lock, honest skips, transient human copy)
- [x] 151-04-PLAN.md — sFOX branch + parametrized class-closure proof (mt5+sfox+unknown) + non-collapse oracle
- [x] 151-05-PLAN.md — Composer gate repoint: partial book reaches "From my book"; contributing-only rows + partial-book note
- [x] 151-06-PLAN.md — manualAumUsd draft field + Portfolio AUM input + AUM-03 refusal copy
- [x] 151-07-PLAN.md — Per-strategy dollar input via handleWeightChange + manual_aum_usd commit persistence (client_manual_aum sentinel)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Fix the non-ccxt venue CLASS, not the MT5 instance** — sFOX carries the identical latent crash, invisible only because its flag is off with zero keys; it must be closed BEFORE the sFOX go-live flip, not discovered by it.
- ⚠️ MT5 holdings fetch is a SECOND job kind contending for the ONE shared Windows terminal — reuse `_mt5_terminal_lock_for`, the login bracket, the bounded-restart helper and the read-timeout discipline (MT5CONC class). Per-symbol MT5 holdings is a SEPARATE decision guarded by a deliberate client-facade pin — do not quietly widen it.
- ⚠️ AUM-01 does NOT cause or fix the 0.00 metrics (that was SCEN-01, closed in 147) — do not let it be planned as that fix.

### Phase 152: SCEN — Composer legibility

**Goal**: The composer is legible: rows say whose they are, what the numbers mean, open detail on click, and browse never presents an unresolvable duplicate
**Depends on**: Phase 147 (rows must carry real series to be worth inspecting), Phase 148 (SCEN-03's factsheet link needs OWN-02 or it is a dead end)
**Requirements**: SCEN-02, SCEN-03, SCEN-04, SCEN-05
**Success Criteria** (what must be TRUE):

  1. In the composition list, a strategy the allocator uploaded themselves is visually distinguishable from a third-party published one — the ownership bit (already computed server-side and discarded at `src/app/api/strategies/browse/route.ts` — `isOwnRow` :264) is wired through additively; this is a persisted-schema decision (`AddedStrategy` is zod-validated at `SCENARIO_SCHEMA_VERSION = 4`), not a client derivation (SCEN-02).
  2. Clicking a scenario row opens richer detail, including a working link to the strategy's factsheet (SCEN-03).
  3. The numbers on a row are labelled — weight, mode, leverage, notional — and a non-derivable notional reads as "not applicable", not as a broken em-dash (SCEN-04).
  4. The strategy browser never shows two indistinguishable rows for the same strategy — the two identical "Alpha Centauri" entries become distinguishable or resolved (SCEN-05; prevention of future duplicates is WIZCONT-02 in Phase 154 — this is the presentation half).

**Plans**: 6 plans in 4 waves (planned 2026-08-07)

Plans:

- [x] 152-01-PLAN.md — Browse-route wire: isOwn on every row + own-only created_at/status through a two-arm H-0300 fence
- [x] 152-02-PLAN.md — Draft-schema wire: isOwn on the NESTED addedStrategySchema, populated-fixture strip guard
- [x] 152-03-PLAN.md — SCEN-04: header label li (WEIGHT USD MODE LEV NOTIONAL) + cause-accurate honest notional
- [x] 152-04-PLAN.md — Drawer: isOwn through handleAdd, own-vs-own dedup line (Created date · Status), shared YoursChip + browse parity
- [x] 152-05-PLAN.md — Composer: isOwn at both twin seams (Bridge deliberately absent) + Yours chip on the added row
- [x] 152-06-PLAN.md — SCEN-03: inline detail expansion + factsheet link + axe expanded-panel coverage + phase-final gates

**UI hint**: yes

### Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)

**Goal**: The wizard stops costing submits — errors land inline on the offending field, transient infrastructure never becomes a user decision, copy never advises the impossible, and an MT5 strategy can declare its venue
**Depends on**: Nothing hard (sequenced after the money-path phases; before 155 so the wizard surface is stable for verification)
**Requirements**: WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, WIZFORM-05, MT5-14
**Success Criteria** (what must be TRUE):

  1. A field the user can get wrong (e.g. a 2-character description) is refused inline at the field, red-highlighted, BEFORE submit — never a terminal full-page envelope after it, and never an error that sends users to corrupt unrelated fields (WIZFORM-01).
  2. No wizard failure renders `code: UNKNOWN` when the server DID classify it — every `finalize-wizard` `validatePayload` 400 arm carries a `code`, and the closing sweep is driven from the emitting sites, not a hand-listed set (the 142.2 plan-07 sweep missed this validator) (WIZFORM-02). SECOND LIVE INSTANCE (founder-hit 2026-08-05, correlation `wizard:0320530a-…`): the client rosters `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are missing `SERVICE_UNREACHABLE`, `KEY_MISSING_READ_SCOPE`, `KEY_PERMISSION_DENIED` — the server's honest verdict is downgraded to `UNKNOWN` client-side, invisible to Sentry. The derived-roster + coverage-assertion fix MUST cover these rosters, not only `validatePayload`. (A 3-member stopgap may land earlier via hotfix — the CLASS fix still belongs here; see REQUIREMENTS WIZFORM-02.)
  3. A transient seam failure on submit is absorbed: FIRST answer whether the per-submit permissions re-validation is needed at all (a recent successful validation + a live synced series is already evidence), and only then add bounded retry — respecting the seam-budget invariant and the `breaker:railway` (never retrying into an open breaker) — surfacing an error only after genuine exhaustion, with copy naming an action the user can take (WIZFORM-04).
  5. The MT5 validate-key deadline inversion is reconciled — an MT5 validation's honest verdict always arrives inside the budget the client grants: today `SEAM_ROUTE_BUDGETS["validate-key"].timeoutMs` (30s — `src/lib/resilient-fetch.ts`, key at :537 and `timeoutMs: 30_000` at :538) loses to `_MT5_PROBE_TIMEOUT_S` (35s) applied SEPARATELY to three stages (`analytics-service/routers/exchange.py` — `_MT5_PROBE_TIMEOUT_S` defined :62, applied :328/:380/:456 inside `_validate_mt5_key` :222), so a slow MT5 login can never report in time. Venue-aware budget or bounded Python probe — either way under this phase's existing seam-budget trap warning (WIZFORM-05, added 2026-08-05).
  4. No venue-shaped error copy renders for venues it cannot apply to — an MT5 user never sees "switch to a different exchange" (WIZFORM-03).
  5. MT5 is declarable in the supported-exchanges metadata step AND preselected from the key the founder already connected — do not ship the widening without the preselect (MT5-14).

**Plans**: TBD
**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **MT5-14: the `closed-sets.mt5-flag` no-widening pin WILL go red — that is the guard working, not a regression to route around.** The pin must be re-cut deliberately, with its reasoning updated, in the same commit. This is NOT the MT5-11 drift class; the exclusion was a deliberate decision that is now outgrown.
- ⚠️ WIZFORM-04: a naive retry loop multiplies the budget `src/lib/seam-budgets.invariant.test.ts` recomputes, and retrying into an open breaker is how one slow venue takes down every other user's submits. The fix starts with "is the call needed", not "add a loop".
- ⚠️ The allocation-amount form Phase 150 (OWN-03) adds is IN SCOPE for the inline-validation criterion — a freshly-shipped wizard step must not re-introduce the terminal-envelope class this phase deletes.

⛔ **PARENT CHECKBOX STAYS UNTICKED — retroactive SPAN verification FAILED 2026-08-13** (`153-VERIFICATION.md`, 5/6 requirements). All six children shipped and 153.6 verified `passed_with_concerns`, but the PARENT goal was not met: **WIZFORM-02 closed two instances, not the class.** The derived-roster coverage law roots on 3 Next route files (`NextResponse.json({code,error},{status})`) and on `analytics-service/services/**` (`error_code =` assignments); `analytics-service/routers/exchange.py:866` matches **neither** — wrong root AND wrong emission shape — so the whole mt5-gateway fault family renders `code: UNKNOWN`. Third live instance hit on PROD 2026-08-12. ⛔ Do NOT tick this phase by adding the two missing codes; the boundary decision and its scope are **TODOS.md FIX NOW #6**. ✅ WIZFORM-01/03/04/05 and MT5-14 all verified (WIZFORM-03 is closed *further* than `REQUIREMENTS.md:1366` admits — that row contradicts `:1368`).

> ⛔ **PHASE 153 IS SPLIT FOUR WAYS (founder-approved 2026-08-08).** The planner measured 15–16 plans across two runtimes against a 3–5 plan budget and returned `## PHASE SPLIT RECOMMENDED` rather than thin the tasks. **Nothing is dropped or deferred** — all 6 requirements and all 34 locked decisions are assigned. Cut lines follow **file ownership**, so every co-commit constraint (D-14, D-15, D-16, D-26, and the admit-a-code-in-the-commit-that-emits-it rule) stays *inside* one sub-phase. Execute 153.1 → 153.2 and 153.3 → 153.4; the Python chain (153.3) is file-disjoint from the TypeScript chain and may run in parallel. Shared artefacts (RESEARCH, PATTERNS, UI-SPEC, VALIDATION, both EVIDENCE files) live in the parent `153-` directory and are read by every sub-phase.

### Phase 153.1: WIZFORM-CODES — Honest codes + the venue-capability foundation (INSERTED)

**Goal**: No wizard failure renders `code: UNKNOWN` when the server did classify it, and the copy layer gains a per-venue capability record so venue-shaped remedies are filtered by a class rule rather than by stacked instance checks
**Depends on**: Nothing (foundation for 153.2 and 153.4)
**Requirements**: WIZFORM-02, WIZFORM-03
**Decisions**: D-08, D-09(a/b), D-10, D-17, D-21, D-22, D-23, D-34 (D-18/D-28 referenced as superseded)
**Owns**: `src/lib/closed-sets.ts`(+test), `src/lib/wizardErrors.ts`(+test, +invariant test), `finalize-wizard/route.ts` (validatePayload only), `SubmitStep.tsx` (roster only), `seam-constants.pin.test.ts` (Wave-0 A-25 assertion only)
**Plans**: 6 plans in 5 waves

Plans:

- [x] 153.1-01-PLAN.md — Wave-0 scanner + A-25 gates: hardened `deriveRoster`, per-route status predicate, interpolation-safe error body, four SELF-TESTs, derived A-25 assertion (all green at HEAD)
- [x] 153.1-02-PLAN.md — `VENUE_CAPABILITIES` + the three predicates (fail-toward-probing on null) + `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS`, pinned
- [x] 153.1-03-PLAN.md — WIZFORM-03 class filter: `FixRequirement` + `fixRequires` + ONE filter in `formatKeyError`; the three venue bullets and the surface bullet tagged; three whole-table sweeps
- [x] 153.1-04-PLAN.md — Ten new `WizardErrorCode` members (seven field-level, `SEAM_DEADLINE_EXCEEDED`, and the two live UNKNOWN residuals); `EXPECTED_TABLE_SIZE` moved at BOTH sites
- [x] 153.1-05-PLAN.md — `finalize-wizard`: 14 emitters reordered code-first, 11 `validatePayload` arms coded, `MIN_DESCRIPTION_CHARS` re-pointed, roster admitted in the same commit
- [x] 153.1-06-PLAN.md — Third `ROUTES` entry, per-route site literals, alias-aware coverage law (`CIRCUIT_OPEN`), vacuity floor sized against the reordered total, SC-2 mutations RUN

**UI hint**: no

- ⚠️ **PLANNER CORRECTION (2026-08-09, verified at `0c4f01d8`): the D-34 reorder is FOURTEEN sites, not six.** The six below are the SINGLE-LINE `{ error, code }` occurrences; eight more put `error:` on its own line inside a multi-line literal — same defect, invisible to a single-line grep (`:605-608`, `:625-628`, `:637-640`, `:952-955`, `:1007-1010`, `:1087-1093`, `:1754-1758`, `:1778-1782`). A THIRD blindness class was also measured: `EMITTER_RE`'s `error:[^}]*\}` cannot cross a `${…}` interpolation, so four bodies stay invisible even after the reorder. And `deriveRoster` returns `[]` for `KNOWN_FINALIZE_CODES` today (`indexOf("([")` → `-1`). All three are closed by 153.1-01 as Wave-0 gates.
- ⛔ **D-34: reordering is not cosmetic.** Six PRE-EXISTING arms (`:573 :617 :767 :1293 :1310` written `{ error, code }`, plus `:1319` lowercase) are invisible to `EMITTER_RE`. They are out of scope only because it gates on `status: 400`; the moment the third `ROUTES` entry lands **and** the predicate widens, the coverage assertion goes blind on them. Size the vacuity floor against the **reordered total**, never against the nine.
- ⚠️ The A-25 **derived** assertion lands here as a Wave-0 gate (green at HEAD) so that 153.4's budget raise cannot pass a pin that cannot fail.

### Phase 153.2: WIZFORM-FIELD — The form refuses at the field; MT5 declarable *and* submittable (INSERTED) ✅ COMPLETE 2026-08-10

**Status**: ✅ **COMPLETE** — 5/5 plans; `gsd-verifier` **25/25 must-haves, no gaps** (`human_needed` only for 5 browser items); `gsd-code-reviewer` found **1 blocker + 6 warnings, all fixed**. ⭐ The blocker (CR-01) was a live security defect: the scope-broadening probe's gate branched on `api_keys.exchange`, a column the key's own owner could rewrite — so the beneficiary could switch an ASVS V4 control off for their own key. Closed by migration `20260810120000` (table-level `REVOKE UPDATE` + a `SECURITY INVOKER` backstop trigger), **verified on TEST**: the exploit succeeded pre-fix and returns `42501` post-fix, with the worker sync path, `service_role` writes, user `SELECT` and user `DELETE` all confirmed intact. Residual (client-supplied `exchange` at INSERT) is self-defeating rather than harmful and is logged in TODOS.md with its real remedy.

**Goal**: A field the user can get wrong is refused inline, at the field, before submit — and an MT5 strategy can both declare its venue and actually complete a submit
**Depends on**: Phase 153.1 (copy members, `VENUE_CAPABILITIES`, `MIN_DESCRIPTION_CHARS`)
**Requirements**: WIZFORM-01, WIZFORM-04, MT5-14
**Decisions**: D-06, D-07, D-11, D-12, D-13, D-14(a+b), D-15, D-16, D-20, D-22
**Owns**: `MetadataStep.tsx`(+test), `AllocateDialog.tsx`(+test), `SubmitStep.tsx` (routing), `finalize-wizard/route.ts` (probe gate + catch-all), `closed-sets.mt5-flag.test.ts`, the wizard chip set — ⚠️ **PLUS `WizardClient.tsx`, added at planning time**: routing a field-level code back to its field requires a step change, and `WizardClient` is the sole owner of `step`. No other 153.x plan touches it.
**Plans**: 5 plans in 4 waves. Wave 1 runs 153.2-01 and 153.2-03 in parallel (disjoint files); waves 2-4 are forced sequential because four plans contend on `MetadataStep.tsx`. **MT5-14 + WIZFORM-04 are ONE plan (153.2-04)** per D-14, with the chip-set widening and the pin re-cut in the SAME task.

Plans:

- [x] 153.2-01-PLAN.md — ⛔ FLAG-3 as ONE indivisible task: the description client mirror reads `MIN_DESCRIPTION_CHARS`, becomes the `handleSubmit` predicate, the `:491` `disabled` and both stale comments go, the `:334` focus ring is upgraded — then the hint / `.title` / live-clear message states (D-11, D-13, D-23)
- [x] 153.2-02-PLAN.md — the rest of the form: category / AUM / capacity refuse through `Field` with aria-derived borders (AUM+capacity import the SERVER's own `isValidDollar`), and submit-with-errors opens the collapsed `<details>` before focusing the first invalid control, with a visible summary line `LiveRegion` re-states (D-11, D-13)
- [x] 153.2-03-PLAN.md — D-12: `AllocateDialog`'s money field converts from the JS ternary to `aria-[invalid=true]:border-negative` and clears live; the two rows that can tell the mechanisms apart (D-12, D-13)
- [x] 153.2-04-PLAN.md — ⛔ MT5-14 + WIZFORM-04 in ONE ship: `WIZARD_EXCHANGE_CODES`/`WIZARD_EXCHANGES` (Option B) with the `closed-sets.mt5-flag` pin re-cut + POSITIVE assertion in the SAME task; the pinned-`<span>` detected-venue chip, its mono provenance eyebrow and a payload that cannot omit the venue; `venueSupportsScopeProbe` gating BOTH probe call sites (fail-toward-probing on `null`) and the catch-all split so a parse miss and a missing internal token stop reading as network blips (D-06, D-07, D-14a+b, D-15, D-16, D-20, D-22)
- [x] 153.2-05-PLAN.md — a field-level server rejection routes back to the field: `FIELD_BY_CODE` + a totality assertion with a vacuity floor in `SubmitStep`, the handoff through `WizardClient`, and `MetadataStep` revealing + focusing the named field with its values intact (D-13, D-17 boundary)

**UI hint**: yes

- ⛔ **FLAG-3 is ONE indivisible task.** Deleting `MetadataStep.tsx:491`'s `disabled` without widening the `.trim()`-only `handleSubmit` guard at `:222-233` lets a 2-character description POST — re-shipping the very defect this phase deletes.
- ⛔ **INHERITED FROM 153.1-03 — WIZFORM-03 does not close without you.** The `fixRequires` class filter is live and correct in `wizardErrors.ts`, but **no `buildEnvelope` call site passes `context.venue` or `context.surface`** (verified across all 14 sites, 2026-08-09), and venue-absence deliberately preserves incumbent copy. **An MT5 user still reads "switch to a different exchange" in production until a call site names its venue.** `SubmitStep.tsx:414` is yours; `ConnectKeyStep.tsx:609` and `MultiKeyConnectStep.tsx` are 153.4's. **No further change to `wizardErrors.ts` is needed** — just pass the context.
  - 💡 **Free with the same edit: `charCount`.** `formatKeyError` grows the sentence to `Add at least 10 characters — you have 2.` when `context.charCount` is present (`wizardErrors.ts:2379`), and **no production emitter supplies it**, so the count never renders. Absence is correct-by-design, not a bug (TRAP-3 — never name a count you did not receive), so this is an upgrade, not a fix. Pass `charCount: description.length` in the same `buildEnvelope` argument you are already adding `venue`/`surface` to. Confirmed live on a TEST dev server 2026-08-09 — see `153.1-HUMAN-UAT.md` item 1.
- ⚠️ **A true sentence is temporarily hidden**: `SERVICE_UNREACHABLE`'s `/strategies` bullet now renders **nowhere** until a call site names its surface.
- ⛔ **INHERITED FROM 153.1-06 — WIZFORM-02 does not close without you either.** 153.1 closed the *named root cause* (the `validatePayload` arms; `deriveEmittedCodes` moved 0 → **25 sites / 19 distinct**), but the requirement's criterion is broader than its root cause. A derived sweep found **five live rejections that still render "We could not classify this failure"** — HTTP **429, 503, 500, 500, 502** — fenced in `src/lib/wizardErrors.invariant.test.ts` as `KNOWN_CODELESS_FINALIZE_REJECTIONS = 5`, with a sixth reddening by name. **Code those five and drive the literal to 0**; that is what ticks WIZFORM-02. ⚠️ Do NOT raise the fence to make a test pass — the fence exists to make the debt visible, and raising it would launder an open requirement into a green suite.
- ⛔ **INHERITED — two `npm test` failures are YOURS to clear.** ⚠️ **`seam-citations` is SELF-CAUSED by 153.1, not pre-existing** (corrected 2026-08-09 by the 153.1 verifier). The earlier "verified unchanged since `aff52516`" claim here was a proof that could not fail: `aff52516` is a 153.1-05 **docs** commit dated after all the source edits, so that diff was empty by construction. `git log -S` attributes all nine to `712c01a9`/`aeea5455`/`3011c659`. It reds on **9 bare `file:line` citations in `src/lib/wizardErrors.ts`, 3 of them already stale** — you are editing that file anyway, so re-derive from HEAD rather than patching the integers (this milestone has burned two full sessions on citation drift). The sibling `seam-venue-vocabulary` failure (`mt5.py:242`) is **Phase 153.3's**, not yours — leave it. That is the UI-SPEC's "fail toward saying less" working as designed, but it is a real loss on the one surface where the bullet applies — restored the moment you pass `surface`.
- ⛔ **MT5-14 and WIZFORM-04 ship together.** Widening the chip set without the probe skip leaves MT5 a HARD BLOCKER — declarable but still unsubmittable.
- ⚠️ The `closed-sets.mt5-flag` pin re-cut and the widening are the SAME commit, and the re-cut ADDS the positive flag-ON assertion the pin lacks today.

### Phase 153.3: WIZFORM-GW — MT5 gateway honesty (Python; file-disjoint) (INSERTED)

**Goal**: An MT5 validation's honest verdict can physically arrive — the nested-timeout inversion is removed, the terminal is shared through the lease that already exists instead of raced, and a key we cannot classify is refused rather than stamped read-only
**Depends on**: Nothing (independent of the TypeScript chain; sequenced BEFORE 153.4 per D-24)
**Requirements**: WIZFORM-05 (server leg)
**Decisions**: D-02, D-03, D-24, D-25, D-27, D-29, D-30, D-31, D-32, D-33 (D-28 superseded)
**Owns**: `analytics-service/services/mt5_client.py`, `services/mt5_validation.py`, `services/mt5_concurrency.py`, `routers/exchange.py`, `tests/test_mt5_*.py`, `docs/runbooks/mt5-go-live.md` — ⚠️ **PLUS `services/ingestion/mt5.py` (+ `tests/test_ingestion_mt5.py`), added at planning time**: it is the SECOND of the two callers of `is_trade_capable` (`:221`), so D-31 cannot be a class-level fail-closed fix without it. Python-only; file-disjoint from 153.1/153.2/153.4.
**Plans**: 6 plans in 6 waves (strictly sequential — every plan contends on `mt5_client.py` and/or `routers/exchange.py`). Wave 6 = **D-35**, the `shutdown()` class closure, added after gating: an `ast` scan measured **three** `Mt5Client.close()` callers (`routers/exchange.py`, `services/exchange.py`'s `aclose_exchange` mt5 arm, and `services/ingestion/mt5.py`'s validate `finally`) reaching exactly **two** `shutdown()` sites (`mt5_client.py:384` `close`, `:436` `restart`). Fixed at the **sink** — the teardown leaves `close()` entirely — so all three callers are fixed with zero call-site edits.

Plans:

- [x] 153.3-01-PLAN.md — 🔒 D-31: `terminal_info()` guard; tri-state `classify_trade_capability`; both call sites refuse what they cannot classify (SECURITY, sequenced FIRST so it is not blocked behind the refactors)
- [x] 153.3-02-PLAN.md — D-24/D-25: bind `initialize()`'s missing `timeout=`; extend the ordering guard to EVERY timeout-carrying call with a source-derived completeness floor; per-instance chain (`MT5_REQUEST_TIMEOUT_S` byte-unchanged)
- [x] 153.3-03-PLAN.md — D-02/D-03/D-30: ONE end-to-end deadline replacing three 35 s stages; `Mt5Client.release()` takes `shutdown()` off the request path; the `finally` survives the deadline and stays outside it (Pitfall 6)
- [x] 153.3-04-PLAN.md — D-29: the validate path takes the terminal lease it is the one caller to skip, with a bounded acquisition wait distinct from the operation timeout (batch keeps queueing patiently; NO account cap)
- [x] 153.3-05-PLAN.md — D-32/D-27/D-33: `stage` + `duration_ms` on every MT5 call and on the lease wait; runbook single-replica invariant, terminal trade-permission step, provisional-budget note

**UI hint**: no

- 🔒 **D-31 is a SECURITY fix, not a refactor.** `is_trade_capable` infers investor mode from two signals that are BOTH false for a MASTER account under the terminal's default-ON "Disable automatic trading through the external Python API". `terminal_info()` is called nowhere and does not exist on `Mt5Client` — it must be ADDED. Fail **CLOSED**: refuse what we cannot classify.
- ⛔ **D-25: `MT5_REQUEST_TIMEOUT_S` stays byte-unchanged.** The validate path takes its own longer chain via the existing `request_timeout_s` ctor arg. Moving the module constant reopens the v1.11 WEDGE-01 wedge class.
- ⭐ **D-29: the lease already exists and this path is the one caller that skips it.** `_mt5_terminal_lock_for` (`mt5_concurrency.py:126-134`) is taken by `job_worker.py:364`/`:3572` and `allocator_positions.py:656`, and by `routers/exchange.py` **zero** times. Add a BOUNDED acquisition timeout distinct from the operation timeout — today `wait_for` sits inside the lock, so a queued caller waits unbounded. No account cap: accounts are unlimited, concurrency is one.

### Phase 153.4: WIZFORM-BUDGET — Venue-aware budget + the honest long wait (INSERTED)

**Goal**: The client grants an MT5 validation a budget its honest verdict fits inside, and a long wait is legible and abortable rather than a silent stall
**Depends on**: Phase 153.1 (`SEAM_DEADLINE_EXCEEDED`, `serialized`); best AFTER 153.3 (a budget cannot fix a structurally censored verdict — D-24)
**Requirements**: WIZFORM-05 (client leg)
**Decisions**: D-01, D-04, D-05, D-19, D-21, D-26, D-27 (D-18 superseded)
**Owns**: `resilient-fetch.ts`, `analytics-client.ts`, `seam-constants.pin.test.ts`, `seam-budgets.invariant.test.ts`, `seam-retry-registry.ts`(+tests), `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` — ⚠️ **PLUS two NEW files added at planning time**: `src/lib/wizard/validate-budget.ts` (a client-safe duplicate of the two budget figures, pinned equal to `SEAM_BUDGETS`) and `src/app/(dashboard)/strategies/new/wizard/ValidateWaitCard.tsx` (the ONE long-wait card both connect steps consume). `resilient-fetch.ts` imports `next/server` and `@upstash/redis`, so a `"use client"` step can never read the budget it must quote in copy — the duplicate + equality pin is the repo's own convention for exactly that.
**Plans**: 5 plans in 3 waves

Plans:

- [x] 153.4-01-PLAN.md — the `validate-key-serialized` 120 000 ms row + `BREAKER_LOCK_TOMBSTONE_S` 60→90 in ONE commit, plus every pin site in `seam-constants.pin.test.ts` and the retry registry (wave 1)
- [x] 153.4-02-PLAN.md — `budgetKeyFor(exchange)` selecting by the `serialized` capability, the three validate routes re-branched, and `seam-budgets.invariant.test.ts` re-derived (wave 2)
- [x] 153.4-03-PLAN.md — the client-safe budget module + its equality pin, and `ValidateWaitCard` with the budget-fraction escalation ladder (wave 2)
- [x] 153.4-04-PLAN.md — `ConnectKeyStep` waits honestly: abortable validate, `Stop waiting`, client deadline → `SEAM_DEADLINE_EXCEEDED` (wave 3)
- [x] 153.4-05-PLAN.md — `MultiKeyConnectStep` gets the same wait, strictly PER PANEL (wave 3, parallel with 04)

**UI hint**: yes

- ⛔ **D-26: the `120_000` budget row and `BREAKER_LOCK_TOMBSTONE_S` 60 → 90 are the SAME commit.** A-25 then holds exactly: `(30 + 90) × 1000 = 120 000`.
- ⚠️ **`budgetKeyFor` must diverge from its analog deliberately.** `process-key-client.ts:123-134` throws on `default:` via a `never` assignment; this one takes a caller-supplied string, so `default:` **returns `"validate-key"` and never throws**. Write the divergence down or a reviewer will "fix" it back. Never interpolate a wire value into a breaker key (T-140-01).
- ⚠️ 16 pin sites (RESEARCH Table C) must move together, including the prose restatements that stay green while their premise breaks.

### Phase 153.5: WIZFORM-ABANDON — Work that outlives its timeout

**Goal**: No `asyncio.to_thread` work can keep touching the MT5 terminal after its `wait_for` fired and its caller released the lease
**Depends on**: Phase 153.3 (complete) — this closes findings its `/code-review high` deliberately deferred
**Requirements**: ABANDON-05, ABANDON-06, ABANDON-07 (minted at planning 2026-08-11 from the three findings below: ABANDON-05 = finding #5, ABANDON-06 = findings #6a/#6b, ABANDON-07 = finding #7)
**Owns**: `analytics-service/services/mt5_client.py` (the sink), `services/mt5_concurrency.py`, `routers/exchange.py`, `services/ingestion/mt5.py`, `services/job_worker.py` + `services/allocator_positions.py` (raw-lock→lease conversions found at planning), `routers/process_key.py` (two uncovered `adapter.validate` sites), `analytics-service/tests/**`
**Plans**: 5 plans in 3 waves
**UI hint**: no

Plans:

- [x] 153.5-01-PLAN.md — epoch registry + Mt5SessionAbandoned + occupancy ContextVar + 6-method fence + lease bump + shared test reset (wave 1)
- [x] 153.5-02-PLAN.md — restart's TWO checks w/ three-invariant fenced cleanup + __init__ construction fence (#5, #6) + rationale re-cuts (wave 2)
- [x] 153.5-03-PLAN.md — ONE release point: convert the 3 raw-lock worker acquisitions to mt5_terminal_lease; re-point neuter patches; ast class pin (wave 2, parallel with 02)
- [x] 153.5-04-PLAN.md — D-40 classification arms at all five caller surfaces incl. process_key's uncovered sites (wave 3)
- [x] 153.5-05-PLAN.md — the two guards: ast abandon-roster + D-37 runtime barrier/spy; shutdown-roster docstring re-cut (wave 3, parallel with 04)

⭐ **ONE defect, three faces — fix it at the SINK, not three times.** Work handed to `to_thread` outlives its `wait_for`; the caller unwinds, releases the terminal lease, and the abandoned thread keeps driving the same process-global MT5 session.

📌 **Anchors below are SYMBOLS, not line numbers** — the original 153.3-era line citations had already
rotted before this phase was planned (#6 and #7 were off by ~30 and ~130 lines respectively; #5 still
held). Line hints are `as of 2026-08-11` only: **if a hint disagrees with its symbol, the symbol wins.**

| # | Site (symbol anchor; line hint as of 2026-08-11) | Symptom |
|---|---|---|
| 5 | `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)` (~L118) | `_mt5_bounded_restart` abandons at its 10s bound; the one permitted `mt5.shutdown()` can fire **after** the lease is released, under the next holder |
| 6 | `routers/exchange.py` › `_validate_mt5_key_probe` › nested `_connect_and_probe`, **STAGE 1 — connect** (~L513) (+ `services/ingestion/mt5.py` › `Mt5Adapter.validate`, the `wait_for(to_thread(_build_client))` inside the lease, ~L207) | a connect-stage timeout orphans an `Mt5Client` the thread then constructs — `client` was never assigned, so the Pitfall-6 `finally` releases nothing and the rpyc session leaks |
| 7 | `routers/exchange.py` › `_validate_mt5_key_probe` — **THE ONE END-TO-END DEADLINE (D-03)**, `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)` (~L817) | the end-to-end deadline fires; the abandoned probe keeps issuing rpyc calls, so D-29's serialization does not hold on the timeout path |

- ⛔ **Patching three call sites is the instance-not-class mistake this milestone has paid for sixteen times.** Candidate designs (a real decision, not a fixer's improvisation): a cancellation-aware wrapper; a generation/epoch counter the terminal checks before each call; or refusing to release the lease until the worker thread confirms it stopped.
- ⚠️ **The AST lease-roster CANNOT catch this.** Its enclosure proof is *lexical* — it reads the `shutdown` as inside the `async with` and passes while the runtime escapes. The fix needs a **runtime** assertion (observe the abandoned thread touching the session after release), never a second static pin. Guard #16 of Phase 153 lives here.
- 📌 Deferred to **Phase 155**, not here (both need the live latency data D-32 made collectable — do NOT guess): the 60s per-stage ceiling wrapping six round-trips of 45 000ms/55s each, and the 20s interactive lease wait being smaller than the worker's 40s read + 10s restart hold.

### Phase 153.6: PARITY — the fixes that only landed on one path (INSERTED)

**Goal**: Every fix the 153 span made on one path exists on its twin, and no broad `except` re-absorbs a refusal the fence was built to surface
**Depends on**: Phase 153.3 (the router fixes whose twins are missing), Phase 153.5 (the fence whose refusals are being swallowed), Phase 153.4 (the budget figure being corrected)
**Requirements**: PARITY-01, PARITY-02, PARITY-03, PARITY-04, PARITY-05 (minted at planning 2026-08-11; defined + traced in `.planning/REQUIREMENTS.md` — the W-153.5-1 debt is NOT repeated)
**Owns**: `analytics-service/services/ingestion/mt5.py`, `analytics-service/routers/exchange.py`, `analytics-service/services/mt5_client.py`, `src/lib/wizard/validate-budget.ts`, `src/lib/seam-budgets.invariant.test.ts`, `src/app/api/strategies/finalize-wizard/route.ts`, `supabase/migrations/**`, `analytics-service/tests/**`
**UI hint**: no
**Plans**: 6 plans

⭐ **Raised by `/code-review xhigh` over the whole 153→153.5 span (2026-08-11, 40 agents, 29 verified findings → 13 distinct defects).** Nine come here; two were fixed unplanned; two are deliberately out (see the bottom).

⛔ **THE SHAPE OF THIS PHASE IS "the fix landed once, not twice."** Three of the four root causes are the same failure: a correct fix applied to one path while its duplicate went untouched, with no guard asserting the two agree. That is the instance-not-class mistake — found *inside the span whose own charter said "fix it at the SINK, not three times."* Do not close these as N point patches; the question each cluster must answer is **what makes the two paths unable to diverge again**.

**A — Adapter parity (3 findings, ONE cause).** `services/ingestion/mt5.py` never received Phase 153.3's `routers/exchange.py` fixes:

| # | Site | Missing twin |
|---|---|---|
| A1 | `ingestion/mt5.py` › `_probe` | the terminal short-circuit that stops `order_check` running when the verdict is already `undetermined` — without it `_WRONG_SERVER_TOKENS` (which carry "terminal") turn an operator-side refusal into a 400 accusing the user their BROKER SERVER is wrong. **This is the exact documented incident the router-side fix was written to prevent.** |
| A2 | `ingestion/mt5.py` › `_read_terminal` | the broad `except Exception` around netref materialization — without it a transport failure escapes as a raw, unscrubbed rpyc exception. ⚠️ `mt5linux` f-string-interpolates the password into remotely-eval'd source, so exception TEXT is a credential-disclosure surface (T-134-01 / T-153.3-23). Only the exception CLASS is safe. |
| A3 | `ingestion/mt5.py` (D-31 arm) | raises a bare `RuntimeError` documented PERMANENT, which escapes `Mt5Adapter.validate` into `job_worker.classify_exception`'s `("unknown", str(exc))` fall-through — **so the worker RETRIES a fault that can never clear**, re-running the whole serialized probe against the ONE shared terminal each time, queueing ahead of every other user's validate, and finally showing the user raw internal copy naming investor/master passwords. |

**B — Absorption: broad `except` re-swallowing the fence (2 findings + 1 telemetry split).** D-42 made absorption structurally impossible *for the classify arms*; pre-existing catch-alls upstream reintroduced it.

- B1 `routers/exchange.py` › `_read_terminal`'s `except Exception` swallows `Mt5SessionAbandoned` → an operator triaging in Railway reads a gateway materialization fault **that never happened**, and the probe continues on a "terminal unreadable" premise that is false.
- B2 `routers/exchange.py` connect stage: the construction fence's `Mt5SessionAbandoned("connect")` is caught by the broad `except Exception as connect_err` before the dedicated D-40 arm, returning a **503 that counts toward the mt5-gateway breaker** — our own abandoned thread driving the breaker toward opening against a healthy gateway.
- B3 `mt5_client.py` › `restart()` check 2 raises from INSIDE `_timed`, which emits an `mt5.stage restart ok=False` event for a restart that was deliberately REFUSED. (Wording corrected per 153.6 D-16: the reconnect round-trip DID happen by the time check 2 fires, so `duration_ms` is real elapsed time — the defect is that a refusal enters the D-32 recovery-latency population Phase 155 reads, under a stage name real round-trips also use; that pollution is the exact thing check 1 was deliberately placed outside `_timed` to avoid, 153.5 RESEARCH §Q-4.) The two checks disagree about the telemetry contract.

**C — The budget correction, and the oracle that cannot see it (1 finding, 2 halves).** `connectAbortDeadlineMsFor` was sized against the branch table's **closed**-breaker column (~158 500 ms) when the governing figure is the **failing** column (175 500 ms serialized / 85 500 ms default) — the failing state being exactly the state a stalling seam is in when a client deadline fires. So CR-01's "nothing was saved" lie is reachable again ~10.5 s before the route finishes writing the key. ⛔ **Fixing the number alone is half the job: `seam-budgets.invariant.test.ts`'s oracle pins the wrong column and so is structurally unable to red on this.** A guard that cannot fail when the behaviour it names changes is the defect class this span shipped repeatedly.

**D — The venue lock is bypassable (1 finding, SECURITY, live on PROD).** Phase 153.2's CR-01 remedy `REVOKE UPDATE ON api_keys` does not hold: `authenticated` retains table-level **INSERT and DELETE**, and the browser already holds the server-minted ciphertext (`/api/keys/validate-and-encrypt` returns it; `ApiKeyManager.tsx` performs the INSERT), so an owner can DELETE and re-INSERT the same row under a different `exchange`. A `BEFORE UPDATE OF exchange` trigger never fires on that path — **neither the primary gate nor the backstop sees it** — and that same client-writable column is the sole authority for skipping `finalize-wizard`'s ASVS V4 scope-broadening probe. The migration header asserts the opposite ("the mislabelled row can never be corrected back"), which is the premise its own "self-defeating forgery" residual argument rests on; `supabase/tests/test_api_keys_exchange_not_user_writable.sql` proves DELETE survives but never tests the round trip.
⚠️ **Calibrate honestly: this is a SELF-targeted control bypass, not a tenant leak** — an owner mislabelling their own key to dodge a probe on their own key. What is lost is the assurance that a key read-only at Connect was not broadened to trade. Serious for a product selling verified performance; not a 3am page.
⚠️ **The migration is already on `main`, and `supabase/migrations/**` auto-applies to PROD on merge — so the hole is live.**
⛔ **This one needs a real design decision, not a patch** (revoke DELETE too? move the INSERT server-side? stop trusting a client-writable column as the probe gate? a trigger comparing against a server-held record?). The options differ materially in blast radius. Decide it in discuss.

**E — Retry affordance (1 finding).** A probe parse miss was moved off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE`, removing the Retry control for a condition that is **not** always permanent — a 2xx body the schema cannot read is also what a rolling analytics deploy produces. Belongs here rather than in an ad-hoc fix because touching a wizard error code ripples into 153.1's pinned code tables (`EXPECTED_TABLE_SIZE` and friends), which must be **re-cut, never deleted**.

📌 **Explicitly OUT of this phase:**

- **MT5 as a composite member** — the 153.4 CR-03 fix made an MT5 composite panel reachable for the first time, and `run_stitch_composite_job` has no `mt5` arm, so it `_stamp_failed`s the whole job as permanent (`venue 'mt5' is not a supported exchange`). That is a **product decision** (teach the stitch worker MT5, or block MT5 in the composite wizard), not a bug fix. Natural neighbour: Phase 155.
- **The epoch never re-binds** (`mt5_client.py` `_assert_live` binds on first touch only), so one `Mt5Client` is usable under exactly one lease for its life. No production path does this today — all five lease blocks were ast-verified — and Phase 153.5 already pinned the constraint with a named future fix (rebind on lease entry). Latent, documented, not scheduled.
- Two trivial findings (compare-route skeleton padding + its blind test oracle; the `as unknown as` composite-embed cast in `finalize-wizard`) were fixed unplanned in the same session.

Plans:

- [x] 153.6-01-PLAN.md — Cluster A + B1: extract `services/mt5_probe.py`, rewire both paths, A3 permanent classification (wave 1)
- [x] 153.6-02-PLAN.md — Cluster C: failing-column deadline on BOTH arms + the state-quantified economic oracle (wave 1)
- [x] 153.6-03-PLAN.md — Cluster D (DB): `attested_venue` migration, INVOKER trigger, count-pinned backfill, RPC re-bases, SQL round-trip test (wave 1)
- [x] 153.6-04-PLAN.md — Cluster D (route): the probe gate reads the attestation, never `exchange`; class sweeps re-pointed (wave 1)
- [x] 153.6-05-PLAN.md — Cluster B remainder (B2 connect-stage arm, B3 `_timed` suppression) + the ast parity roster (wave 2)
- [x] 153.6-06-PLAN.md — Cluster E: `KEY_SCOPE_CHECK_UNREADABLE` recoverable code + pin re-cuts 74→75, 32 UNMOVED (wave 2)

### Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered (INSERTED)

**Goal**: WIZFORM-02's CLASS closes — the coverage law's population is derived from every code that can reach a user-facing surface, so a server-classified failure can never again render `code: UNKNOWN`; and a newly-minted `service_error(...)` code with no disposition reds CI by name instead of arriving on a user's screen
**Depends on**: Phase 153.1 (the pinned code tables being re-cut), Phase 153.6 (the `VENUE_WIRE_CODE_TO_VERDICT` / `VENUE_WIRE_CODES_WITHOUT_VERDICT` halves this widens)
**Requirements**: WIZFORM-02 (the ONE requirement the 153 span failed — see `153-VERIFICATION.md`, status `failed`, 5/6)
**Owns**: `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/wizardErrors.ts`, `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/strategies/finalize-wizard/route.ts`
**UI hint**: no — copy members only, no new surface
**Plans**: 3 plans in 3 waves (strictly sequential: 02 greens 01's designed red; 03 contends with 02 on `wizardErrors.ts` / `wizardErrors.test.ts`)

⛔ **Raised by the retroactive Phase 153 SPAN verification (2026-08-13, `failed`, 5/6).** THIRD live instance, hit by the founder on PROD 2026-08-12 while dogfooding MT5. The server classified the failure completely and the wizard rendered *"We could not classify this failure, so we cannot tell you what happened or whether your last action took effect."*

⭐ **BOUNDARY DECISION (2026-08-13, autonomous — reversible).** The coverage law's boundary becomes **"every code that can reach a user-facing surface"**, not "codes emitted in a particular directory in a particular syntactic shape". The current boundary is an artifact of how the scanners were written, not a product rule: no one decided a 500 from `routers/` deserves less honesty than a 400 from a Next route, and the user cannot tell the difference. Full rationale + scope: **TODOS.md FIX NOW #6**.

⛔ **THE SHAPE OF THIS PHASE IS "the guard's REACH was wrong, not its mechanism."** The derived-roster remedy was genuinely built and genuinely works (falsified: mutating an emitted code literal reds two assertions by name). It misses `routers/exchange.py` for **two structural reasons, either sufficient alone** — wrong root (`routers/`, not `services/`) AND wrong shape (a **positional** arg to `service_error(...)`, not an `error_code =` assignment). Fixing either alone leaves the file invisible.

⛔ **The fix is NOT "add two rows."** Landing `MT5_GATEWAY_UNCONFIGURED` and `MT5_GATEWAY_UNREACHABLE` as verdict rows *without* widening the scanner and adding the both-halves assertion is exactly the fourth instance of this defect.

⭐ **The actual defect is an ASYMMETRY, above any individual missing code.** Both codes are absent from **both halves** of the coverage law — no verdict row *and* no recorded no-verdict — so their absence could never have been loud. The phase does not close until a code missing from both halves is a CI failure.

⚠️ **Do NOT re-open WIZFORM-05 as part of this.** The 45,169/45,159/45,177 ms figures from the same incident are `_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS = 45000` — the innermost, deliberately-first-firing layer. The verdict arrived at 45 s against a 120 s budget; the 30 s inversion is genuinely gone. What failed *after* arrival is WIZFORM-02. Lengthening the budget fixes nothing.

📌 **On completion, Phase 153's parent checkbox may finally tick** — it is unticked today because the span did not meet its own goal, not because a child is outstanding.

**Plans**:

- [x] 153.7-01-PLAN.md — Mechanism: parameterised root + call-shape matcher (AST cross-checked) + pin re-cuts + reach/both-shapes assertions + tmpdir falsifier — ENDS RED BY DESIGN naming the 20 undisposed codes (wave 1) — ✅ 2026-08-14, `153.7-01-SUMMARY.md`. Population 17 → **37**; the file ends with **exactly one** failing test naming exactly the 20 predicted codes, and the AST cross-check earned its keep by catching a real matcher bug (a `class` definition head read as a call). ⛔ **Do NOT "fix" the red** — greening it is Plan 02's whole job.
- [x] 153.7-02-PLAN.md — The 20 dispositions: 8 verdict rows (replay-tested through classifyKeyValidationError) + 12 individually-measured WITHOUT_VERDICT rows — greens 01's red (wave 2) — ✅ 2026-08-14, `153.7-02-SUMMARY.md`. ⭐ **01's designed red is GREEN**: the disposition assertion passes over all 37 codes, and the 8×UNKNOWN/500 replay red was recorded first. One member MINTED (`SEAM_INTERNAL_FAULT`, `EXPECTED_TABLE_SIZE` 76 → 77 in lockstep) because `SEAM_MISCONFIGURED`'s "we stopped before sending the request" is measurably FALSE at `INTERNAL`'s emitter and at one of `MT5_GATEWAY_UNCONFIGURED`'s four. Neuter-proof (FL-1) performed and recorded: deleting the `MT5_GATEWAY_UNREACHABLE` row reds BOTH the disposition assertion and its replay test, by name.
- [x] 153.7-03-PLAN.md — Three coded finalize rejections (ledger 3→0, sites 29→32, total pinned 32) + twin regression on BOTH key routes + prose re-cuts + TODOS.md deferral (wave 3) — ✅ 2026-08-14, `153.7-03-SUMMARY.md`. ⭐ **The ledger is EMPTY and its assertion has collapsed into "every rejection carries a code"** — the constant is KEPT, because at 0 it states the property outright. `EXPECTED_FINALIZE_REJECTION_SITES` was **never edited** and the derived count agreed at every run: 32 − 32 = 0. Three copy members, one per ARM rather than per subject, because each may claim a different amount about server state — `DRAFT_LOOKUP_FAILED` (a SELECT that errored, so "nothing was changed" is observable; the token is REUSED from `keys/sync`, not a synonym), `DRAFT_FINALIZE_FAILED` (the generic tail also catches a transport failure that can lose the answer to a write that landed, so it may NOT say nothing was saved), `SEAM_RESPONSE_UNREADABLE` (upstream answered 2xx — the submission was accepted and only the result is unreadable, so it may claim NEITHER outcome, and it is non-recoverable because a retry there is unpredictable rather than futile). `EXPECTED_TABLE_SIZE` 77 → 80 in lockstep; 3 roster rows. **Twin regressions on BOTH key routes, neuter-proven**: deleting the shared `MT5_GATEWAY_UNREACHABLE` verdict row reds both (503 → 500) plus the classifier replay naming UNKNOWN — zero production route edits. A second falsifier: neutering ONE finalize arm reds three independent oracles while the 32 total holds. Prose re-cuts landed (REGISTRY ×2, the `resilient-fetch` census — where `_validate_mt5_key` was a WRONG symbol that still exists, and the completeness pin was under-counted 13 → **15**, both arrivals inert 500s — and the alias docblock whose "correctly answers UNKNOWN" premise 02 deleted). **TWO** TODOS.md deferrals recorded separately.

✅ **PHASE COMPLETE — WIZFORM-02 TICKED.** All four `missing` items from `153-VERIFICATION.md` are closed across the three plans, and the sweep is driven from EMITTING SITES (falsified three ways). ⚠️ The honesty check that could have stopped the tick was run: `keys/[id]/permissions` **is** reachable from a wizard surface (`SyncPreviewStep` → `KeyPermissionBadge`), but that component never builds a `wizardErrors` envelope — it renders the route's own `{ code, error }` as text — so no `UNKNOWN` card is rendered there. Its defect is a remedy sentence, recorded in TODOS.md as its own item. 📌 **Phase 153's parent checkbox may now tick.**

### Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens

**Goal**: Re-entering the wizard continues where the founder left off, screens never show a state the backend has already left, and a token-less credential re-connect cannot mint duplicates
**Depends on**: Nothing hard (sequenced before 155 so the wizard surface is stable for verification)
**Requirements**: WIZCONT-01, WIZCONT-02, STALE-01
**Success Criteria** (what must be TRUE):

  1. Re-entering "add a strategy" with an existing wizard draft resumes at the draft's step — the entry point BEFORE the wizard (`/strategies/new` branch chooser) becomes draft-aware, with the exact entry path established by observation FIRST (WIZCONT-01 — resume is NOT missing: `WizardClient` already resumes when `initialDraft` is present; fix the chooser, not the state machine).
  2. STALE-01's root cause is investigated and documented BEFORE any fix is planned — the poll loop should have terminated at 11:39:35 and did not; why is the open question. After the fix: the wizard never sits on "Fetching trades…" after the job chain has finished, and never renders a refusal computed from a stale analytics row while a re-derive is in flight.
  3. Re-connecting the same credentials from a context that has LOST the wizard-session token (different browser/profile, cleared localStorage, incognito) fails TOWARD the existing row — identity from a stable non-secret venue value where one exists, never uniqueness on ciphertext, and never a silent overwrite of a key whose `strategy_keys` membership other strategies depend on (WIZCONT-02 — LOW priority within the phase; the common case is already safe).

**Plans**: 8 plans in 3 waves

Plans:

- [x] 154-01-PLAN.md — STALE-01 investigation gate: Q1/Q2 PROD discriminator + T1/T2/T3 RED (wave 1)
- [x] 154-02-PLAN.md — WIZCONT-01 plumbing: single-sourced draft query + wizard-draft route + REQUIREMENTS correction (wave 1)
- [x] 154-03-PLAN.md — WIZCONT-02 DB: venue_account_id column, partial UNIQUE, scrub trigger, RPC re-base, TEST apply (wave 1)
- [x] 154-04-PLAN.md — STALE-01a shared fix: poller absent-row honesty (TWIN-3) + sync-progress widening (wave 2)
- [x] 154-05-PLAN.md — WIZCONT-01 resume UX: overlay deferred mount + CSV short-circuit truth table + e2e (wave 2)
- [x] 154-06-PLAN.md — WIZCONT-02 app: one-fence-two-keys, 23505 discrimination (TWIN-8), dedup notice (wave 2)
- [x] 154-07-PLAN.md — STALE-01 supplier arm (CONTINGENT on 154-01 verdict): Python/SQL root-cause fix or recorded NO-OP (wave 2)
- [x] 154-08-PLAN.md — STALE-01 honest screens: un-gated backstop, R2-5 twin, amber state, ledger closure (wave 3)

**UI hint**: yes

### Phase 155: MT5-VERIFY — The numbers are true, live on a trading day

**Goal**: The performance Quantalyze renders for the live funded MT5 account is proven true against the terminal's own figures on a trading day, on every surface that renders it — and the milestone's umbrella acceptance (MT5-GOAL-01) closes
**Depends on**: Phases 147–154 (needs a stable surface to measure — running earlier means re-running). ⚠️ Human- and calendar-gated: a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run does not satisfy it.
**Requirements**: MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)
**Success Criteria** (what must be TRUE):

  1. The MT5 server-UTC offset is MEASURED live at connect and asserted on — never hardcoded (breaks at the next DST transition, wrong for every other broker) — and a near-midnight deal lands on the day the terminal shows, pinned by a regression test (MT5-06; the one failure MT5-07's oracle cannot see unaided).
  2. Rendered performance matches an EXTERNAL oracle — the terminal's own equity/balance or the broker statement — over a fixed window within a founder-stated tolerance, run against the LIVE funded account on a TRADING day (MT5-07, MT5-08). ⛔ Internal consistency does not satisfy this (the self-referential-oracle shape that let three money bugs survive six passes). ⛔ No tolerance number exists anywhere yet — founder call at /gsd-discuss-phase; do not invent one.
  3. Strategy detail, public factsheet, scenario composer, portfolio PDF and browse all show the same, correct MT5 numbers — the backbone-bypass surfaces (`_compute_portfolio_analytics`, `equity_reconstruction.py`, `portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) are checked, and any divergence is a finding (MT5-09).
  4. Every surfaced discrepancy is fixed WITHIN this phase wherever its root cause lives, including shared backbone money-math affecting every venue (UNCAPPED by founder decision — a bounded alternative was offered and declined; the phase does not close while the terminal and the UI disagree) — and the `complete_with_warnings` carried by ALL THREE PROD MT5 strategies is explained: eliminated, or understood and accepted in writing (MT5-10, MT5-15; ⛔ MT5-07 does NOT close MT5-15 — external parity is not "why did our own pipeline flag itself").
  5. **MT5-GOAL-01 — umbrella acceptance gate, no implementation work of its own:** an MT5 strategy is usable end-to-end by the allocator who uploaded it — it ingests (done), it projects in a scenario (SCEN-01, Phase 147), and its factsheet is viewable (OWN-02, Phase 148) — confirmed live by the founder. It exists so "MT5-05 ✅" can never again be mistaken for "MT5 works".

**Plans**: TBD
**Notes**: Re-homed from v1.16 Phase 142.3 (which was split out of 142.2 at the D-14 valve on 2026-08-03 and will NOT run as a v1.16 phase). ⛔ Do not archive the milestone or advertise MT5 until this phase passes — v1.15's failure mode was shipping 6/6 green with both open items intact.
⚠️ **PRECONDITION — REPLACED 2026-08-14. Read this before re-deriving anything.**

**The blocker is stale credentials, not broken code.** The founder changed the MT5 account
passwords on/around 2026-08-14, so the stored credentials will no longer authenticate. Only the
founder can supply the new read-only investor passwords. See the v1.18 milestone header for the
measured PROD state and the ⚠️ `MM1` label mismatch (three keys exist: `FX-AI_V`, `MM2`, `MM3` —
**no key is labelled `MM1`**, so re-verify all three at reconnect).
⛔ **When the three keys flip to `sync_status='error'`, that is EXPECTED. Do not open an
investigation.**

~~PRECONDITION (found 2026-08-05): all 3 PROD MT5 keys sit at `sync_status='error'` —
`'Mt5Session' object has no attribute 'fetch_balance'`...~~ — ⭐ **STALE, and it was a trap.** That
hotfix **landed** as `e0493913` (PR #667, "MT5 key-sync routing for Mt5Session + wizard roster
stopgap"). MT5 sync has worked since: PROD synced all three keys at 04:01–04:07 UTC on 2026-08-14,
`sync_error` empty on every row. The note is struck through rather than deleted because a red MT5
key plus a roadmap note pointing at `Mt5Session.fetch_balance` is a near-perfect way to send the
next session bisecting a bug that was fixed nine days earlier.

### Phase 157: FOUNDER-CONFIRM — the observations only the founder can make

**Goal**: The handful of checks no test can perform are performed, so the requirements resting on
them stop resting on an assumption
**Depends on**: Nothing. Can run in any order relative to 155, in the same sitting.
**Requirements**: none of its own — it discharges human-verification items left open by Phases
153.7 and 154
**Success Criteria** (what must be TRUE):

  1. **The 2026-08-04 wizard restart is confirmed gone.** Open `+ Strategy` with a live wizard
     draft present: the resume banner appears, and Resume lands on the draft's step rather than
     step 1. ⚠️ The MECHANICS are already covered — `e2e/wizard-resume.spec.ts` ran **green on main
     at `5d43df6b`** (2026-08-13 22:32, `e2e-seeded`; the job asserts its seed secret is non-empty
     and fails loud otherwise, so the `HAS_SEED_ENV` skip predicate was false and the test really
     executed). What no test can cover: the founder is the only person who witnessed the original
     restart, so only they can say it is gone.

  2. **The amber `wizard-sync-recomputing` block is seen on screen.** Heading *"Recomputing this
     strategy's analytics"*; no red envelope, no metric numbers; contrast and spacing per
     `154-UI-SPEC.md`. No browser pass has ever been run on this block.

  3. **The four copy members Phase 153.7 minted are seen rendering in a real wizard** —
     `SEAM_INTERNAL_FAULT`, `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED`,
     `SEAM_RESPONSE_UNREADABLE`. ⭐ `SEAM_INTERNAL_FAULT` must render with **NO Retry control** —
     that single check doubles as the regression catch for the classifier→roster hop
     (`W-153.7-1`), where a missing roster member leaves the whole suite green while the wizard
     offers a Retry against a permanent fault.

  4. **`MT5_SPIKE_INVESTOR_PASSWORD` is rotated.** It sits in plaintext in Railway env and was
     printed to a session scrollback. Founder-only: they hold the credential.

**Plans**: TBD
**Notes**: ⚠️ Criterion 3 shrinks to a glance if the component render tests land first — they are
agent-deliverable and tracked outside this milestone. Criterion 2 likewise: a localhost browser
pass can pre-verify the block, leaving the founder only a confirmation.

### Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes ✅ COMPLETE 2026-08-13

**Goal**: `api_keys.attested_venue` becomes what its name claims — the venue **the server itself validated**, not a parameter the caller chose. The wizard's `api_keys` INSERT moves behind a service-role writer that passes the venue it validated at mint time, and `authenticated` EXECUTE is withdrawn from `create_wizard_strategy` and `add_wizard_composite_key`. This is CR-01 remedy **(a)** — the "connect-flow refactor" that both `20260810120000` and `20260811210000` defer.

**Depends on**: Nothing. ⭐ **PULLED FORWARD AHEAD OF 155 — founder call 2026-08-13.** The 2026-08-12 call sequenced this after MT5-VERIFY; the trigger below then fired. Phase 155 is blocked on three gates none of this phase's work can clear (a founder at the terminal on a trading day, a working MT5 validate — the `[Experts] Account=1` trap is still open — and a tolerance number that does not exist and must not be invented), while sFOX go-live is already booked. Since the block itself states MT5 work **cannot** arm this residual, waiting buys nothing and leaves a live-on-PROD deferred control open for longer. 155 does not depend on this phase, so its ordering is unaffected.

⛔ **PULL-FORWARD TRIGGER — sFOX go-live.** Phase 153.6 shipped remedy **(b)**: a `CHECK` pins `attested_venue = exchange`, so the probe-skip forgery drags the ingestion label with it and the key never syncs. **That defence is a property of the current venue set, not a control.** It holds only while every probe-exempt venue is unsyncable. `mt5` is the sole member today and cannot sync ccxt credentials — which is exactly why MT5 work (153.x, 154, 155) cannot arm this. The moment a **syncable** venue joins `scopeProbeSupported: false` in `src/lib/closed-sets.ts`, the forgery becomes FREE. Phase 153.6 RESEARCH names **sFOX** as the plausible next member, and sFOX go-live is already booked (TODOS 🔴 item 3). **If sFOX is scheduled before 155 completes, this phase moves ahead of it.**

**Requirements**: CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 — ✅ **all five complete 2026-08-13** (minted at planning the same day; the PARITY-04 deferred-control threat flag is CLEARED). Sub-clauses `-01b`/`-01c`/`-02b`/`-03b` are parts of their parent ID, not separate IDs.

**Success Criteria** (what must be TRUE):

  1. A caller holding a valid session and the server-minted ciphertext **cannot** set `attested_venue` by any route — not by client INSERT (already closed by the scrub trigger in 153.6), and not by calling the wizard RPCs directly over PostgREST. Proven by a SQL assertion that calls the RPC as `authenticated` and is REFUSED, replacing 153.6's assertion 5d, which today passes *because* it asserts the door is open.
  2. `attested_venue` is written from a venue the server **verified against the live venue API at mint time**, not from a request parameter — traced from `/api/keys/validate-and-encrypt` through to the INSERT.
  3. The wizard still works end to end for every venue, single-key and composite. ⚠️ Both RPCs currently need the **user-scoped** client because their `auth.uid()` guards demand it; moving to a service-role writer must not lose that ownership check — the row must still be provably the caller's.
  4. The `CHECK (attested_venue IS NULL OR attested_venue = exchange)` from 153.6 is **kept**, not removed as redundant. It is the fence that stops a future writer letting the two columns diverge, independent of who does the writing.
  5. Every prose claim that 153.6 had to weaken is re-strengthened to match: the `attested_venue` column comment, `20260811210000`'s section 1b, `REQUIREMENTS.md` PARITY-04, and the deferred-control threat flag is cleared.
     ⚠️ **SC5 amended in flight:** `20260811210000` §1b was **NOT** edited — it is an applied migration and `migration-reviewer` invariant 11 makes any edit a CRITICAL. It is superseded **by name** in Migration B's header ⛔ (ii). The criterion is met by supersession, not by amendment; a future reader diffing §1b against the current system is not looking at a regression.

**Plans:** ✅ **10/10 executed** — 10 plans in 8 waves, shipping as **TWO PRs** (`156-RESEARCH.md` "Deploy order": both
single-migration orderings produce a total connect-a-key outage window, so Migration A grants
`service_role` while leaving `authenticated`'s grant standing, and Migration B withdraws it only
after PR A's route is verified live on PROD). ⛔ **SC1 does not close until PR B.**

Plans:

- [x] 156-01-PLAN.md — Wave 0: measure A1/A2/A3/A4 against TEST (does a service-key client really reach `auth.role() = 'service_role'` with `auth.uid()` NULL?) — the whole privilege design rests on two facts RESEARCH could not settle
- [x] 156-02-PLAN.md — [PR A] Re-cut both route test files to the post-156 contract and observe them RED (admin-client receiver, `p_user_id === user.id`, 503 `SEAM_MISCONFIGURED`) — incl. the composite twin's missing admin mock
- [x] 156-03-PLAN.md — [PR A] Migration A: transitional two-arm role gate (branched, never unioned) + `GRANT EXECUTE … TO service_role` on both RPCs; applied to TEST, PR-Y2 renamed, snapshots regenerated
- [x] 156-04-PLAN.md — [PR A] Swap both wizard routes onto `createAdminClient()`, fail-closed on a missing service key, pragma moved with the mutation
- [x] 156-05-PLAN.md — [PR A] CONNECT-02b structural guard (a second user-scoped writer reds a normal test run) + TODOS entries for the two logged-not-fixed items + version bump
- [x] 156-06-PLAN.md — ⛔ **THE HARD BOUNDARY**: ship PR A, then verify the service-role writer live on PROD in a real browser (single-key AND composite) before PR B is authored
- [x] 156-07-PLAN.md — [PR B] Migration B: `REVOKE … FROM authenticated`, both bodies narrowed to `auth.role() = 'service_role'` with **zero** `auth.uid()`, column comment re-stamped ⛔ preserving the `20260811210000` gate marker
- [x] 156-08-PLAN.md — [PR B] Invert assertion 5d (42501 + nothing minted) and mint its missing composite twin 5f/5g, plus the two marker cross-checks that stop the block SKIPping green
- [x] 156-09-PLAN.md — [PR B] Flip G1/G2, re-shape the six direct RPC call sites whose `authenticated` role claim the new gate refuses, replace Part 3b's now-vacuous guarantee, twin the stale-re-base canary
- [x] 156-10-PLAN.md — [PR B] Re-strengthen the five prose sites to exactly what is true, clear the PARITY-04 `threat_flag: deferred-control`, full-suite phase gate

**Notes**: Raised by `gsd-code-reviewer` as blocker **CR-01** during Phase 153.6 and shipped as an accepted residual in PR #675 (v0.58.0.0). Full reasoning: `.planning/phases/153.6-parity-the-fixes-that-only-landed-on-one-path/153.6-REVIEW.md` (CR-01, both remedies stated) and `153.6-07-SUMMARY.md` (why (b) was chosen and what it does NOT buy). ⚠️ The residual was **live on PROD** from 2026-08-12; **closed 2026-08-13**.

⭐ **THE WORKED EXAMPLE — copy this shape for the next privilege change.** The phase shipped as **TWO PRs with a live PROD gate between them**, because both single-migration orderings produce a total connect-a-key outage window:

  · **PR A (#680, v0.60.0.0, merged `25e28d3a`)** — Migration A grants `service_role` and keeps a **transitional two-arm role gate (BRANCHED, never unioned)**, because a `service_role`-only body would have refused the still-live old deploy. Both routes swap onto `createAdminClient()`.
  · **THE GATE** — `156-LIVE-ACCEPTANCE.md`, `status: pass`, rows 1–5 (+ optional row 6, MT5). A real browser against real PROD: a single-key connect at 19:02:40 UTC and a 2-member Deribit composite whose SECOND member was minted by `add_wizard_composite_key`. ⭐ The gate sits **between** the landings so PR B cannot convert a working-but-open state into a broken-and-closed one, and so that the REVOKE removes a path our own code was **observed** no longer taking rather than inferred not to take from a unit suite that mocks the very client under test.
  · **PR B** — Migration B revokes `authenticated`, deletes the transitional arm, and lands the SQL gates + prose in the SAME PR (merging the migration alone reddens `sql-tests`).

⚠️ **The most transferable defect of the phase, which recurred THREE times independently:** `pg_get_functiondef` returns `prosrc` VERBATIM **including comments**, so any assertion matching a function body must strip `--` comments first. It bit Migration B's own post-verify (which would have aborted its apply on its own Trap B documentation), plan 08's assertion 5h (permanently un-armed and silently green on exactly the database it guards), and plan 09's state-adaptive arming (armed one twin and not the other — measured end-to-end as letting a re-granted `authenticated` EXECUTE exit 0 green).

⚠️ **The related class: assertions that pass for the WRONG reason.** Migration A shipped a canary that passed on precisely the stale re-base it existed to catch; `test_wizard_composite_fence.sql` Parts 3b/3c would have passed VACUOUSLY after Migration B (catching the role refusal, never reaching the cross-user condition they name) and were **re-cut rather than left reporting safety they no longer provided**; plans 08 and 09 each shipped a provably unreachable assertion and each caught it with their own mutation battery.

⛔ **`REVOKE` is not durable, and that is a CLASS.** Supabase's `pg_default_acl` re-grants `anon` and `authenticated` on any `DROP`+`CREATE`. Nothing in a migration can close this — a post-verify runs once, at apply, and the migration that reopens the door is one nobody has written yet. The durable enforcement is **assertion 5h**, armed from the function body and the live ACL rather than from a comment marker, proven on a PG16 fixture by an actual DROP+CREATE where it was the ONLY assertion that reddened.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 147. SCEN-01 engine series | 6/6 | Complete   | 2026-08-05 |
| 148. OWN owner factsheet | 5/5 | Complete   | 2026-08-05 |
| 149. NAV my-strategies ranking | 5/5 | Complete   | 2026-08-05 |
| 150. OWN-03 portfolio question | 8/8 | Complete    | 2026-08-07 |
| 151. AUM book + sizing | 7/7 | Complete    | 2026-08-07 |
| 152. SCEN composer legibility | 6/6 | Complete    | 2026-08-07 |
| 153. WIZFORM + MT5-14 | span complete | Goal met via inserted 153.7 (span verdict stays `failed` 5/6) | 2026-08-14 |
| 153.7. WIZFORM-02-CLASS (INSERTED) | 3/3 | Complete (shipped v0.62.0.0, merge `c4555fd0`) | 2026-08-14 |
| 154. WIZCONT + STALE | 8/8 | Complete   | 2026-08-12 |
| 155. MT5-VERIFY + acceptance | 0/? | ➡️ **CARRIED to v1.18** | - |
| 156. CONNECT-REFACTOR | 10/10 | Complete (2 PRs, live PROD gate between them) | 2026-08-13 |

**v1.17 closes at 10 phases delivered** (147, 148, 149, 150, 151, 152, 153, 153.7, 154, 156).
⚠️ Phase 153's own SPAN verdict is still the verifier's to issue — every one of its `missing`
items is closed and WIZFORM-02 is ticked in REQUIREMENTS.md, but the box at line 122 is
deliberately left for `gsd-verifier` rather than self-ticked. That re-verification is
agent-deliverable and does not gate the milestone close.

### v1.18 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. MT5-VERIFY + acceptance | 0/? | ⛔ Blocked — founder at terminal + new passwords | - |
| 157. FOUNDER-CONFIRM | 0/? | ⛔ Blocked — founder observations | - |

## Requirement Coverage (v1.17)

| Phase | Requirements |
|-------|--------------|
| 147 | SCEN-01 |
| 148 | OWN-02, OWN-04 |
| 149 | NAV-01 |
| 150 | OWN-03 |
| 151 | AUM-01, AUM-02, AUM-03, AUM-04, AUM-05 |
| 152 | SCEN-02, SCEN-03, SCEN-04, SCEN-05 |
| 150 | OWN-05 |
| 153 | WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, MT5-14 |
| 153.x | WIZFORM-05 (the validate-budget split; ⛔ explicitly FENCED OUT of 153.7) |
| 154 | WIZCONT-01, WIZCONT-02, STALE-01 |
| 155 | ➡️ MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella) — **CARRIED TO v1.18 on 2026-08-14. Not delivered in v1.17.** |
| 156 | CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 ✅ (all five complete 2026-08-13; also closes PARITY-04, whose deferred control 153.6 could not take inside its own phase) |

**31 in-scope requirement IDs mapped (30 work + 1 umbrella), each to exactly one phase.**
⚠️ **Corrected 2026-08-14 — this table said "29/29 mapped, no orphans" while omitting TWO
requirements** (`OWN-05` and `WIZFORM-05`, both added after it was written). Milestone-audit
warning **W2**. A completeness claim that predates the last two additions is worse than no claim:
it reads as a checked invariant when it is a stale count. ⭐ **24 of the 31 were DELIVERED in
v1.17; the 7 on the Phase 155 row were CARRIED to v1.18** and are not v1.17 gaps.
No duplicates. OWN-01 excluded (already met — CONTRIB-03, verified in code 2026-08-04).
⛔ Everything in SEAM / JOB / RATE / PYAPI* / SEAMCORE / SEAMUX remains v1.16 (PARKED below).
Revised 2026-08-04 after NAV-01 was sharpened: the approved Phase 148 (OWN-02/03/04 + NAV-01)
split into 148/149/150; later phases renumbered +2 (149→151 … 153→155) with dependencies intact.

---

## ✅ CLOSED Milestone: v1.16 Production Resilience & Reliability (Phases 140–142) — CLOSED 2026-08-14

⚠️ **SCOPE AMENDED ON CLOSE, and the amendment is dated on purpose.** This milestone ran 140–146
and sat ⏸️ PARKED at 13/19 phases for weeks. Phases **143, 144, 145 and 146 were CARRIED to the new
milestone v1.19 JOB/RATE** on 2026-08-14 — not dropped, not ticked, and not renumbered. With them
went JOB-04, JOB-05, JOB-06, JOB-08 and RATE-01..05.

**Why carried rather than resumed:** GSD models ONE current milestone, and v1.18 already held that
slot. Working four phases under a header reading PARKED is precisely the ledger-vs-reality drift
that produced four blockers in the v1.17 milestone audit. Fifteen phases that shipped weeks ago
also should not share a milestone with four that have never been planned.

⛔ **What v1.16 actually earns:** the shared resilience core and breaker, the Python service
contract, the wizard/client seam surface, retry-with-backoff, and the stuck-computing reaper.
⛔ **What it does NOT earn:** dropped-enqueue detection, orphaned-`running` visible termination,
csv-finalize atomicity, or a rate limit a new route cannot bypass. Those are v1.19's, and none has
been started.

⛔ **PARKED 2026-08-04 at 68% — NOT shipped, NOT complete.** 13/19 phases complete, 119/127
plans (68%). Outstanding: **Phase 143** (dropped-enqueue reconciliation sweep), **Phase 144**
(WR-02 orphaned-running DELETE→terminal UPDATE — ⚠️ carries a LIVE founder decision: the current
purge DELETEs orphaned-`running` rows rather than resetting them; TEST wants DELETE, PROD wants
reset, and both must be reconciled in the SAME migration), **Phase 145** (csv-finalize atomicity,
reproduce-first) and **Phase 146** (RATE audit). **Resume at Phase 143 after v1.17 delivers.**
All 29 phase directories were deliberately preserved (the workflow's `phases.clear` was skipped
by founder call) so this milestone resumes without reconstruction.

⚠️ **Re-homed into v1.17 (2026-08-04):** Phase 142.3's entire scope — MT5-06..10, the live
trading-day numeric verification — now lives in **v1.17 Phase 155**, and MT5-14 (wizard metadata:
MT5 declarable + preselected) in **v1.17 Phase 153**. Phase 142.3 will not run as a v1.16 phase.

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a
silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor
factsheet on a spinner that never resolves.

**Scope:** 18 v1 requirements (SEAM-01..06, JOB-01..07, RATE-01..05) per
`.planning/REQUIREMENTS.md` (written against the research-CORRECTED scope in
`.planning/research/SUMMARY.md`, not the original milestone prose). CRON + MONEY groups deferred
(founder 2026-07-25). Phase numbering continues from 140 (v1.15 ended at 139).

**Ordering rationale (non-negotiable, from research):**

- **Breaker (140) ships BEFORE retry (141)** — fail-fast alone carries zero double-execution risk
  and can land while the SEAM-05 idempotency audit is still being written; retry without a breaker
  actively amplifies an outage.

- **SEAM before JOB** — JOB's sweeps use SEAM's timeout-vs-upstream-vs-network error taxonomy to
  decide re-enqueue vs terminal-fail.

- **Every JOB reaper/sweep lands in pg_cron** — never the worker loop (same failure domain as the
  crash it backstops; re-exposes WEDGE-01) and never Vercel cron (plan cron-slot ceiling, a
  documented past cause of prod going dark).

- **142 before 143** — both sweep the same `strategies`/`strategy_analytics`/`compute_jobs`
  triangle; built in sequence as one non-racing mechanism, not two competing crons.

- **RATE last** — mechanical, and its gap list must come from a fresh kickoff grep, not from
  anything upstream.

## v1.16 Phases (PARKED)

- [x] **Phase 140: SEAM — Shared resilience core + circuit breaker** - Both Vercel→Railway chokepoints fail fast through one Upstash-backed breaker with unified timeout budgets and a clean 503 envelope (no retry yet) (completed 2026-07-25)
- [x] **Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity** (INSERTED) - Tenant-scope the wizard-session leak, make 4xx/5xx attributable at the source, per-tenant `/process-key` throttling, complete idempotency (completed 2026-07-26)
- [x] **Phase 140.1.1: PYAPI-FIX — close Phase 140.1's own review findings** (INSERTED) - Cross-language duplicate-reply contract incoherence (a live 502 arm, but no caller reaches it today); 4 Python High findings; `error_contract.py`'s two remaining guard gaps that no downstream phase can reach; and every test the review's 36 injected mutations proved toothless (12 survived) (completed 2026-07-26)
- [x] **Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route** (INSERTED) - The class 140.1.1 closed on teaser/csv is still open on `/api/validate-key`, where a venue blip renders as `UNKNOWN`/500 "team notified"; plus MT5 permanent-code misclassification (reproduce-first), the raw 429, four 429s missing `Retry-After`, the `_SHAPES` corpus fence, and artifact corrections (completed 2026-07-30; VERIFICATION **passed** 6/6; shipped to main @ 4f45dcab)
- [x] **Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity** (INSERTED) - Record on attributability not `>=500`, cover the body read, bound the store, pin every constant to a literal, verify against real Redis (completed 2026-07-27; 12/12 plans; 7/7 success criteria SATISFIED, SC4 with a named residual; 56 ledger rows re-run at the final tree, 55 RED + 1 GREEN with its replacement RED)
- [x] **Phase 140.3: SEAMUX — Client & wizard seam error surface** (INSERTED) - One source of truth for codes/copy, observe every HTTP outcome, never blame the user for our outage, non-destructive retry (shipped 2026-07-30, PR #651; VERIFICATION **gaps_found** 15/16 — 2 named residuals accepted as tracked tech-debt: **SEAMUX-03** (9 of 15 seam-importing routes still emit bare `{error}` not the typed `{code}` envelope — ⚠️user-facing error attribution) + poll-disjointness pin blind to `wizardFetch` (test-hygiene). See TODOS "v1.16 carried-forward residuals". ⏳ **G4–G8 gap-closure series is coding these arms route-by-route; G7 (2026-07-31) wire-audited `/api/strategies/csv-validate` and found per-arm machine codes ALREADY on the wire — 0 codeless arms — the VERIFICATION `grep -cE 'code:\s*"'` counted 0 only because this route carries `code` positionally through `csvErrorBody`; receipt is the extended `src/__tests__/csv-validate-route.test.ts` (arm-agnostic `json.code` sweep + SENTINEL_PII guard). G8 (2026-07-31) coded both admin match routes — `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies; TS-19 4xx forwards now carry `err.seamCode` with `dependency` intact; T-140-12 ordering preserved. G9 (2026-07-31) coded the TENTH route the VERIFICATION nine-route list MISSED — `/api/admin/strategy-review`, 0→27 coded arms (13 `REVIEW_SOURCE_READ_FAILED` byte-identical 503s, 5 `REVIEW_RECHECK_FAILED` 409s incl. a plan-missed status-pin 409, 2 `UNKNOWN` write-fault 500s, plus the auth/validation/gate tokens); arm-agnostic source-scan fence added; RED-on-neutering observed. Its only seam import is `scrubSeamError` (in-class by definition, no analytics call). **✅ SEAMUX-03 aggregate CLOSED 2026-07-31** — opus verifier PASSED (16/16 seam routes carry typed `{code}` on every reachable route-emitted arm; 817/817 tests; RED-on-neuter confirmed on 4 routes); `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. Non-blocking residuals → TODOS: 2 codeless `rateLimitDenyJson` deny bodies (SEAMRIM-05-pinned, rate-limiter boundary) + poll-disjointness pin (test-hygiene) + SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual.**)
- [x] **Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open** (INSERTED) - Fabricated observations, destructive controls, our-fault-rendered-as-theirs, and the guards that cannot fail (shipped 2026-07-30, PR #652 + CR-01; VERIFICATION was `gaps_found` 39/43 but its user-facing gap is **STALE/RESOLVED** — verified 2026-07-31 that the `SEAM_MISCONFIGURED`→`UNKNOWN` translate hop IS present in current code at `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:538` + `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:851` (`recogniseSeamErrorCode`); the fix landed after the VERIFICATION was written. Only a non-blocking `analytics-client` scrub-test ledger-row residual (doc-hygiene) remains. See TODOS)
- [x] **Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth** (INSERTED) - What the codebase says about itself is true; ⭐carries `Retry-After` travels, a HARD PREREQUISITE for 141 (completed 2026-07-30)
- [x] **Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit** - Committed retry-safety audit, then bounded retry ONLY for allowlisted calls; teaser provably never retried (completed 2026-07-31)
- [x] **Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation** (INSERTED) - Scope from the 8-agent review campaign over 141; **zero user-facing and zero data-integrity defects found**, so no retry verdict changed and no budget row was un-flipped. 9/9 plans (completed 2026-07-31). VERIFICATION was `gaps_found` 19/20 and is now **passed** 20/20 on re-verification 2026-08-01 — all three gaps had been closed in the tree by post-verification work and the file was simply never re-run: D-06's last stale coordinate became a symbol anchor at `22332e34` (the whole self-relative-citation class is now absent from `resilient-fetch.ts`), the two deferred ledgers were reconciled so TODOS.md and `deferred-items.md` both carry all four `DEF-141.1-*` ids, and the Falsifiability Ledger closed at 20/20 observed with `nyquist_compliant: true`
- [x] **Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm** (INSERTED) - 25 findings from the xhigh review (30 agents) deduped to 13; outcome is **twelve remediated, one dispositioned** — finding 8's retry↔limiter amplification is ACCEPTED, not fixed, and is stated as STILL LIVE everywhere it is summarised. Closes the duplicate `strategy_verifications` write on the money path (onboard's retry is now refused unless the call carries a truthy `wizard_session_id`, decided at the single chokepoint) and the three monitoring-integrity regressions D-16 shipped (unbounded `.select()` → `head: true` count, attacker-movable dedup deleted outright, read error now a distinct `denominator_read_failed` outcome rather than zero traffic). 6/6 plans (completed 2026-08-01). VERIFICATION was `human_needed` 17/17 and is now **passed** — three of its four production probes were discharged read-only on 2026-08-01 (42 rows / 42 distinct `correlation_id` / 0 `wizard:` prefix, flow_type resync 20 · csv 20 · onboard 2; unbounded `.select()` returned exactly 1000 rows at HTTP 200 with `error: null` against 7351 total, reproducing the silent truncation; all five breaker keys ABSENT, keeping finding 10 framed as hardening). The fourth — a real Railway-edge 503 carrying a malformed `Retry-After` — stays **Manual-Only and is not a gap**: it cannot be induced, and the only contract-bound 503 emitter we own structurally cannot emit one. ⏳ On PR #656, **not yet merged**
- [x] **Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL** - Writer-stamped transition timestamp + pg_cron reaper to terminal `failed` + threshold-math CI invariant + WEDGE-01 regression test (completed 2026-08-02)
- [→] **Phase 143: JOB — Dropped-enqueue reconciliation sweep** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 145: JOB — csv-finalize atomicity (reproduce-first)** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 146: RATE — Audit + close the two verified gaps** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged

## v1.16 Phase Details (PARKED)

### Phase 140: SEAM — Shared resilience core + circuit breaker

**Goal**: A hung or dying Railway fails fast at BOTH seam chokepoints with a clean typed error — never a lambda held until platform kill, never a cascade-500
**Depends on**: Nothing (first phase of milestone)
**Requirements**: SEAM-01, SEAM-02, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):

  1. With Railway mocked to hang, a `keys/sync` request (via `postProcessKey()`) AND an `admin/match/*` request (via `analyticsRequest()`) each return a typed error within their documented timeout budget instead of holding the lambda open — both chokepoints route through the ONE shared `resilient-fetch` core.
  2. After repeated Railway failures, a seam call from a DIFFERENT module context (simulating a second Fluid Compute instance) short-circuits with the typed `503 CIRCUIT_OPEN` envelope + human message without touching Railway — breaker state lives in the shared Upstash store (`breaker:railway`), never per-instance memory.
  3. When Upstash itself errors, seam calls still attempt the real Railway request — the breaker fails OPEN, so a broken breaker can never itself become the outage (deliberate divergence from the rate limiter's fail-closed).
  4. A CI test asserts `timeout × (1 + retries) < maxDuration` for every route calling either chokepoint, driven from ONE exported per-call-site budget table (replacing the divergent 30s / hardcoded-60s ad-hoc budgets).
  5. No route handler calling either client surfaces a raw fetch/breaker error as a 500 — every failure arrives as the typed envelope (the cascade-500 escape in `analytics-client.ts` callers is retrofitted shut).

**Plans**: 7 plans, 4 waves
Plans:

- [x] 140-01-PLAN.md — resilient-fetch core: SEAM_BUDGETS table + Upstash breaker (fail-OPEN) + full unit contract (wave 1)
- [x] 140-02-PLAN.md — both clients through the ONE core + CIRCUIT_OPEN envelope + SC-1c wiring test (wave 2)
- [x] 140-03-PLAN.md — admin/match Class-1: typed arms, err.message leak closed, SC-1b seam test (wave 3)
- [x] 140-04-PLAN.md — wizard Class-2: type-checked SERVICE_UNAVAILABLE_RETRY before substring cascade (wave 3)
- [x] 140-05-PLAN.md — Class-3 five routes: CIRCUIT_OPEN arms + optimizer refund + dormant fetch through core (wave 3)
- [x] 140-06-PLAN.md — third seam (permissions) through core + B-route maxDuration pins + SC-1a seam test (wave 3)
- [x] 140-07-PLAN.md — SC-4 budget invariant test + no-raw-analytics-fetch ESLint rule + phase gate (wave 4)

> **Phases 140.1–140.3 repair the surface Phase 140 shipped.** Five review rounds against the
> verified Phase 140 tree found 46 + ~120 original-code defects; five ad-hoc fix batches were
> **discarded wholesale** (`wip/v1.16-phase140-fix-archive`) because repairs without the
> plan→plan-check gate ran ~1:1 fix-to-defect. Evidence per finding:
> `.planning/phases/140-seam-shared-resilience-core-circuit-breaker/140-FINDINGS-CONSOLIDATED.md`.
> **PART 2 ("TRAPS") is binding on every plan in these three phases** — it is what survives of the
> discarded batches and it documents how each naive fix breaks.
>
> **They must land before Phase 141.** 141 builds retry on top of the breaker; retry over a breaker
> that under-counts (SEAMCORE-02) or trips on caller faults (SEAMCORE-01) amplifies outages.
>
> **Contract between the three:** 140.1 owns what the service EMITS (status codes, body shapes,
> limiter identity) · 140.2 owns the error TYPES · 140.3 owns how they RENDER. They share almost no
> files, which is what makes independent planning safe — the coupling is what produced the fix-batch
> collisions.

### Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity (INSERTED)

**Goal**: The analytics service tells the truth about whose fault a failure is, cannot leak one tenant's verification to another, and cannot be denied platform-wide by an anonymous caller
**Depends on**: Phase 140 (the seam core exists; this phase fixes what it consumes)
**Requirements**: PYAPI-01..10
**Success Criteria** (what must be TRUE):

  1. Two tenants submitting a colliding `wizard_session_id` each see only their own verification — an RLS/SQL gate under `supabase/tests/` fails if the uniqueness constraint is not tenant-scoped, and the duplicate pre-check cannot return a foreign row.
  2. An exchange-side fault (maintenance, revoked key, IP-allowlist change) and a bad-credential fault each answer **4xx**; only a genuine service-side fault answers 5xx — so a single user's broken key can no longer contribute to a platform-wide breaker trip.
  3. An anonymous caller hammering the public teaser cannot exhaust the `/process-key` allowance for authenticated tenants — throttling is bounded per tenant, not by one bucket keyed on the shared internal token.
  4. On `/process-key`, an unauthenticated request is rejected before validation and before throttling — it can neither enumerate feature flags nor consume throttle budget.
  5. No replay can return "duplicate" for work that was never enqueued, and no state exists from which the client is told to retry with no path to success.
  6. A missing or stale platform secret produces an operator signal; no response body echoes caller credentials; validation detail and throttle responses arrive machine-readable (`Retry-After`, structured `detail`).

**Plans**: 9 plans, 5 waves
Plans:

- [x] 140.1-01-PLAN.md — PYAPI-01 SQL half: tenant-scoped composite unique index + RED-first supabase/tests gate (wave 1)
- [x] 140.1-02-PLAN.md — PYAPI-01 query half + PYAPI-09: pre-check move/scoping/ownership, enqueue-aware duplicate path, RPC dedupe fence (wave 1)
- [x] 140.1-03-PLAN.md — PYAPI-05 contract artifact + R-2 helper; remap exchange.py S-01..S-07 + internal.py S-08..S-12 (wave 1)
- [x] 140.1-04-PLAN.md — PYAPI-05 remap match/simulator/portfolio S-13..S-20 + main.py S-23 JSONResponse literal (wave 2)
- [x] 140.1-05-PLAN.md — PYAPI-10: ok discriminator on all six 200 shapes; scope rejection 200→403 (wave 2)
- [x] 140.1-06-PLAN.md — PYAPI-04 auth-first middleware + PYAPI-02 HMAC tenant-claim limiter + TS mint (wave 3)
- [x] 140.1-07-PLAN.md — PYAPI-03: delete 3 private limiters, rekey all 9 IP-keyed routes, flow-cost table (wave 4)
- [x] 140.1-08-PLAN.md — PYAPI-07 scalar-detail 422 handler + PYAPI-08 machine-readable 429 + PYAPI-06 operator signal (wave 4)
- [x] 140.1-09-PLAN.md — Phase gate: CI-mirror runs, M1-M8 mutation ledger, TS-obligations artifact, PROD wedge count (wave 5)

### Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route + the surviving 140.1.1 review findings (INSERTED)

**Goal**: The venue-transient class is closed on the route real users actually hit, and every finding that survived adversarial refutation is closed or explicitly, reasonedly deferred
**Depends on**: Phase 140.1.1 (closes findings against its 25 commits)
**Requirements**: PYAPIFIX2-01..06
**Evidence**: `140.1.1-STAGE1-FINDINGS.md` (5 lenses) + `140.1.1-STAGE2-FINDINGS.md` (5 red teams) + `140.1.1-REVIEW.md` (36 mutations, 30 caught, 6 survived). **An adversarial refutation pass refuted 4 of 10 findings outright and reduced 3 more — this scope is only what survived.**
**Success Criteria** (what must be TRUE):

  1. **A venue-transient fault answers a typed, classifiable error at EVERY consumer of `validate_key_permissions` — including `/api/validate-key`, the live key-connect route.** Today `analytics-service/routers/exchange.py` (the C6 site — `if result["error"]:` :596) and `analytics-service/routers/portfolio.py` (the C7 site — `if validation.get("error"):` :2338) collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** A test must prove that a Binance-maintenance-shaped failure during key-connect no longer renders as `UNKNOWN`/500 *"our team has been notified"* with no retry affordance. ⚠️ **DISPOSITION (140.1.2 plan 04): PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row `TS-35`) — the *renders* assertion in this criterion is a TypeScript assertion (`create-with-key/route.ts` returns the classifier-computed status and discards the upstream one, RESEARCH C-1), so this criterion is HALF met by this phase, deliberately and on the record.
  2. **A permanent MT5 credential fault is never retried as a transient venue fault** — or the phase records, with evidence, that the path is unreachable. `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` are absent from both `PERMANENT_VALIDATION_ERROR_CODES` and `analytics-service/services/ingestion/long_fetch.py`'s local `permanent_codes` set (:406), so the live worker path burns 3 gateway-serialised retries on a credential that can never succeed — while TypeScript already calls both 400 client faults. **Reproduce-first: "could not reproduce" is a valid outcome** (one red team held MT5 never reaches `validate_key_permissions`).
  3. **`/internal` throttling emits the service's own envelope**, giving the 429 builder arm added in 140.1.1 its first call site — today `analytics-service/routers/internal.py`'s `_consume_rate_limit` throttle (guard :231, emit :251) raises a raw `HTTPException(429)` one line away from it, so the arm has zero callers and the response carries no `code`.
  4. **Every user-facing 429 carries a `Retry-After`** — `analytics-service/routers/match.py:1742`, `analytics-service/routers/portfolio.py:1964`, `analytics-service/routers/simulator.py:249` currently do not.
  5. **The 200-discriminator corpus cannot silently shrink.** Deleting a `_SHAPES` row was OBSERVED to survive (141→140 passed) after 140.1.1 correctly removed a self-referential guard that was *also* the only corpus fence.
  6. **The phase's artifacts state only what they can support**: `140.1.1-VERIFICATION.md` reads `gaps_found` (its "no already-correct test was removed" claim is false, and PYAPIFIX-02's carve-out was evidenced by a `grep -c` that proves a marker exists, not that a list is complete); and in `analytics-service/docs/STATUS_CONTRACT.md` the "not seam-reachable" list no longer points at a **live 424 arm** (`analytics-service/routers/exchange.py` — `service_error(424, "EXCHANGE_PROBE_FAILED", …)` :565), S-11's line ref is correct, the "four classes" heading matches its five-row table, and the dependency census is right. ⚠️ **No general comment sweep** — the "refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.

**Plans**: 4 plans / 3 waves
Plans:

- [x] 140.1.2-01-PLAN.md — PYAPIFIX2-02: gated reproduce-first MT5 permanence (adapter-provenance fix or NOT-REPRODUCIBLE exit) (wave 1)
- [x] 140.1.2-02-PLAN.md — PYAPIFIX2-03 /internal 429 → service_error + PYAPIFIX2-04 Retry-After ×4 + the fenced census-comment exception + TS-34 (wave 1)
- [x] 140.1.2-03-PLAN.md — PYAPIFIX2-01: venue-transient class closed 7/7 via flat scalar-detail shape + machine code; TS-32 corrected + TS-35 added (wave 2)
- [x] 140.1.2-04-PLAN.md — PYAPIFIX2-05 _SHAPES↔AST fence + PYAPIFIX2-06 artifact truth + phase gate (wave 3)

### Phase 140.1.1: PYAPI-FIX — H-5 duplicate-reply contract break + close the 12 surviving mutations (INSERTED)

**Goal**: Phase 140.1's own review findings are closed — nothing it shipped breaks a live consumer, and every test the review's mutations proved toothless now bites
**Depends on**: Phase 140.1 (closes findings against its 41 commits)
**Requirements**: PYAPIFIX-01..06
**Evidence**: `.planning/phases/140.1-.../140.1-REVIEW.md` — `issues_found`, 0 critical / 24 warning / 12 info, **36 mutations injected, 12 SURVIVED**. Each survivor is proof of a toothless test, not an inference.
**Success Criteria** (what must be TRUE):

  1. **The `/process-key` duplicate reply and its consumer agree on ONE contract.** ⚠️ *De-escalated 2026-07-26 — this is NOT a live break.* Source-verified: **no live caller can trigger the 502 today** — `finalize-wizard/route.ts` and `keys/sync/route.ts` contain ZERO `wizard_session_id`; the duplicate path requires a caller-supplied one (`analytics-service/routers/process_key.py` — `idempotent_by_session` :1033-1035); csv arms return before the pre-check; `create-with-key`/`composite/add-key` use it only in direct SQL RPCs. It is **contract incoherence with a live 502 arm** — a trap for the next caller, and 140.2/140.3 add callers. Fix it for coherence, not urgency. `analytics-service/routers/process_key.py` — `_wizard_duplicate_reply` :717, body :737-747 — emits `queued:true` WITH `code`/`idempotent`; the guard at `src/lib/process-key-onboard-contract.ts` — `isProcessKeyOnboardResponse` :97, imported by `src/app/api/strategies/finalize-wizard/route.ts:31` — rejects exactly that shape (`if ("code" in r || "idempotent" in r) return false;` — "mixed envelope = bug"), and the miss arm emits Sentry + **HTTP 502**. A test must exercise the REAL Python reply against the REAL TS guard — today both suites are green **because each mocks the other**, which is precisely how this landed. *(Verified at source: the guard is Phase 140's own commit `57b11813` on this SAME unmerged branch — NOT deployed, and 140.1 never touched that file. So there is no rollout-ordering constraint; pick the fix direction on contract quality. At base `43449cc6` both duplicate arms hardcoded `"queued": False`, which the guard's `queued=false` branch accepts — that branch permits `code`/`idempotent`. The regression is solely that PYAPI-09 made `queued` sometimes true while keeping them.)*
  2. **Venue-transient faults are 424/retryable, not 403** — via a **permanent-code ALLOW-LIST**, never a transient denylist. No response body may say `recoverable:false` beside "Try again in a moment." *(Corrected 2026-07-26 at source: (a) the claim that `/exchange/validate-key` "already gets this right" is **FALSE** — `read_only is False` appears exactly twice repo-wide, `analytics-service/routers/process_key.py:1597` (in `_scope_rejected`) and `analytics-service/services/ingestion/long_fetch.py:331`; that route never evaluates it. The real analog is `analytics-service/services/ingestion/long_fetch.py` — `permanent_codes` :406-409 feeding `_is_permanent` :432-438. (b) The research's proposed **transient denylist fails unsafe — it is literally the existing bug's shape**; `long_fetch` uses a permanent allow-list, follow that. (c) `MISSING_SCOPE` **must** be in the allow-list — `analytics-service/services/exchange.py:1103-1116` (the deribit `scope_detail` branch inside `validate_key_permissions`) sets `read_only=False` + `error_code="MISSING_SCOPE"` and returns without `valid=True`, and it is absent from `long_fetch`'s `permanent_codes`, so a permanent scope fault would otherwise become a retryable 424. (d) The review both over- and under-counted: its "two sites" are one predicate + its single return, and it **missed `analytics-service/routers/process_key.py`'s `recoverable` derivation (:405-412)**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
  3. **`create_exchange` failures are 500, not 424 — at all THREE sites.** `analytics-service/routers/internal.py` — `create_exchange` :485 and its `except Exception:` arm :488-522 (S-11) — classifies them as "problem at the venue", but that function performs **no network I/O** — every real failure (ccxt `TypeError`, `ImportError`, OOM) is ours. As 424 it is breaker-inert AND 4xx, so **nobody is ever paged**. *(Corrected 2026-07-26: the pattern-mapper found this is a **3-site class, not 1** — `analytics-service/routers/portfolio.py:2283` is a third, and the **same function's second `create_exchange` at `:2373` already answers 500**, which is in-repo proof the class is real. This is exactly the instance-not-class defect the mapper exists to catch; a point-fix would have shipped.)*
  4. **The `body.detail.detail` scalar guarantee is ENFORCED, not documented.** `analytics-service/services/error_contract.py` — `service_error_body` :230, its C1 scalar guard :245-256 — is what Phase 140.2 renders from; today lists and dicts emit verbatim (proven by execution). Every other class rule in that module is a hard guard.
  5. **Every one of the 12 surviving mutations turns a test RED**, re-run and observed first-hand. Named in the review; they include S-06's split pinned by a single ccxt subclass (narrowing `except ccxt.BaseError` survived **twice**, and under it `RateLimitExceeded` answers 500 — the exact A-01/C-12 defect this programme exists to fix), `RETRY_AFTER_SECONDS["supabase"]` (15→900 survived), `default_platform_key` returning `""` (**makes slowapi skip limiting entirely** and ships green), and the 429's `Retry-After` value.
  6. **`error_contract.py`'s remaining guard gaps are closed — the circular deferral is broken.** *(Added 2026-07-26 from two red teams; no downstream phase can fix these — 140.2/140.3 are TypeScript-only by their own CONTEXTs and 146 is a rate-limit phase, so they currently have NO reachable owner.)* **(a)** A `429` carrying `Retry-After` is **constructable**: today `retry_after` requires `retryable:true` while the CALLER arm raises on `retryable:true` (`analytics-service/services/error_contract.py` — `_validate` defined :100, its generic-CALLER arm :218-227, the `retry_after`-implies-`retryable` rule :118-119) — yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both MANDATE migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency`: today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`** — a venue name on a 500 poisons a breaker key.

**Plans**: 7 plans / 4 waves
Plans:

- [x] 140.1.1-01-PLAN.md — PYAPIFIX-04+06: all 4 error_contract guard gaps (429 arm, 500-dep membership, scalar detail, retry_after source) + doc reconciliation (wave 1) — **DONE** 2026-07-26, 5 commits `0a195a5f..7454330c`; criteria 4 + 6a/6b observably true; 48 new tests, all RED-first; suite 4668/96 skipped, mypy 89 files clean
- [x] 140.1.1-02-PLAN.md — PYAPIFIX-02: permanent-code allow-list, 424 pre-gate + recoverable fix, TRAP-9 fence unedited, M-4 carve-out BLOCKED-BY: TS-05 (wave 1)
- [x] 140.1.1-03-PLAN.md — PYAPIFIX-01 Python half: predicate extraction to src/lib leaf + committed fixture proven equal to real TestClient bodies (wave 1) — **DONE** 2026-07-26, 2 commits `82f84f28` (extraction, 59 route tests green UNEDITED) + `0c45da2c` (fixture + 6 contract tests). `src/lib/process-key-onboard-contract.ts` has **0 imports**, both symbols exported, one implementation repo-wide; fixture **tracked in git** (5 cases, 2 positive / 3 negative), positives proven equal to REAL full-stack `main.app` TestClient replies on BOTH duplicate arms; falsifiability probe RED observed → reverted → GREEN. No Python production file touched. Suite 4704/96 skipped, mypy 89 files clean, tsc 0, lint 0 errors. **Wave 1 COMPLETE — `wave_0_complete: true`, plan 05 unblocked.**
- [x] 140.1.1-04-PLAN.md — PYAPIFIX-03: create_exchange class 3/3 sites -> 500 retryable:false + M-14 log companions (wave 2) — **DONE** 2026-07-26, 6 commits `9adbedae..6b754def` (3 RED/GREEN pairs). **Class closed at 3/3, not the review's 1 or RESEARCH's 2**: `analytics-service/routers/internal.py:517` (B1), `analytics-service/routers/exchange.py:541` (B2), `analytics-service/routers/portfolio.py:2309` (B3 — named by NOBODY, found only by the pattern-mapper because British "initialise" defeats the grep). All three raise `service_error(500, "ADAPTER_INIT_FAILED", retryable=False)` with ONE shared copy; **no `dependency` on any** (plan 01's C3 guard makes the old shape unconstructable); no `Retry-After`. `EXCHANGE_INIT_FAILED` retired at **0** raise sites; `grep "Failed to initiali" routers/` → **0**. `ValueError` → 400 preserved and newly pinned at all three. B4 (`analytics-service/routers/portfolio.py:2550` — the `500 "Strategy verification failed"` arm) and B5–B8 byte-unchanged. **M-14 closed at 2/2** (`analytics-service/main.py:777` `service_key.secret_unset` + `:804` `service_key.mismatch`), with the absent-header 0-event fence proved falsifiable by a neuter probe (dedent → 1 failed / 3 passed, reverted). 2 new test files, +12 tests. Suite **4716/96 skipped/0 failed**, mypy 89 files clean, 0 new `type: ignore`.
- [x] 140.1.1-05-PLAN.md — PYAPIFIX-01 TS half: widen guard + 3 new invariants, parity test, both-direction neuter proof, TS-OBLIGATIONS reconciliation, M-11 record (wave 2) — **DONE** 2026-07-26, 3 commits `8865400c` (RED parity test) → `2f776271` (GREEN widening + TS-03 comment inversion, same commit per the ledger's own warning) → `58441952` (route.test rewrite). **PYAPIFIX-01 CLOSED.** The mixed-envelope rejection is deleted and the union widened, with THREE compensating invariants (non-empty `code`; `idempotent` ⇒ `true` AND `code === "WIZARD_DUPLICATE"`, one-directional by design; `verification_id` string retained), each pinned by a negative fixture case in BOTH languages. **RED observed first (3 failed / 6 passed) — and richer than predicted: N2 (`code:""`) was ACCEPTED pre-widening, proving invariant 1 is genuinely new teeth, not a trade.** ⭐ **The oracle is BIDIRECTIONAL, both directions observed first-hand:** neutering `_wizard_duplicate_reply` (`"code"`→`"codes"`) ⇒ pytest **2 failed** (*"only in reply: ['codes']; only in fixture: ['code']"*); neutering the predicate (`return true` first) ⇒ vitest **4 failed** (every negative wrongly accepted). Both restored from scratch copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0. `grep -c "vi.mock"` on the parity test → **0**. `src/app/api/strategies/finalize-wizard/route.test.ts:1819` (the "PYAPIFIX-01 — the INVERTED contract" test) **REWRITTEN not deleted** (59 → 61, 0 deleted) with TWO retained negatives. Coverage gate (OQ-6) settled by measurement: 84.36/78.37/81.43/86.49 vs 80/72/74/82; full frontend suite **8878 passed / 0 failed**; tsc 0; lint 0 errors. Python re-verified after the cycles: **4716/96/0**, mypy 89 files clean. Ledger reconciled: TS-01/TS-03 **DONE-IN-140.1.1**, TS-02 sharpened, TS-23 **UNBLOCKED**, TS-32 (M-4 ↔ TS-05 pairing) + TS-33 (M-11) added, 31→33, TS-04..22/24..31 byte-unchanged. **M-11 DECIDED, not implemented.** **WAVE 2 COMPLETE.**
- [x] 140.1.1-06-PLAN.md — PYAPIFIX-05 batch 1: survivors #1/#2/#6/#7/#12 + M-15 AST fence, mutation re-runs observed RED (wave 3) — **DONE** 2026-07-26, 3 commits `33f03757` (ccxt family) → `803198ec` (#6/#7/#12) → `0ff9446e` (M-15 AST fence). **6 mutation cycles / 8 runs, EVERY result OBSERVED FIRST-HAND — zero "asserted only" rows.** #1 `except ccxt.BaseError`→`NetworkError` ⇒ **3 failed / 5 passed** (`PermissionDenied must answer 424, got 500`); #2 →`ExchangeNotAvailable` ⇒ **6 failed / 2 passed** (`RateLimitExceeded must answer 424, got 500`) — both `assert 500 == 424`. The parametrisation straddles BOTH ccxt roots (7 subclasses) so no single narrowing satisfies it, with the non-ccxt `RuntimeError` control INSIDE the table so an `except Exception` widening also fails. #6 `"supabase": 15`→`900` ⇒ **4 failed / 0 passed** `assert '900' == '15'` at all four sites (≥1 red per file, targeted node ids only); the verbatim mt5-gateway idiom is now applied 4×. #7 `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ **1 failed** `assert 1 == 2` — the test is now a **driven three-phase clock** (1 inside / still 1 inside / **2 after the LITERAL 300 s expires**), because the old free-running-clock count assertion was satisfied by any window longer than the test. #12 junk copy ⇒ **1 failed** — the human sentence is pinned by EQUALITY against a literal, the `!= AUTH_FAILED_DETAIL` guard kept. **M-15 DELETED** (`len(_SHAPES) == 6` against a same-file list literal, plus its false docstring) and replaced by an **AST-fingerprint SET** derived from `routers/process_key.py`'s own source — 8 fingerprints, never a count (C-20: the six was a coincidence of one collapse cancelling one expansion) — with a 200-capable filter (no `status_code=` or literal 200) that excludes the 401/403/422/**424** arms, asserted from both sides. **All three probes observed:** (a) a 7th 200 return ⇒ **1 failed / 16 passed** naming `dict:code,mutant,ok`; (b) 3 blank lines above the handler ⇒ **17 passed**; (c) `return JSONResponse(status_code=418, …)` ⇒ **17 passed**. Every restore from a `cp` scratch copy under `/tmp` — **zero** `git stash`/`git checkout`/`git clean`. Wave-3 gate: **4724 passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly), mypy --strict 89 files clean, **0** new `# type: ignore`, `grep -rn MUTANT` → 0, **zero production files modified**. **WAVE 3 COMPLETE.**
- [x] 140.1.1-07-PLAN.md — PYAPIFIX-05 batch 2: slowapi #3/#4/#5 on 0.1.10 + claim-parser #8-#11 (both #11 sites) + phase-wide gates (wave 4) — **DONE** 2026-07-26, 3 commits `b7e7023c` (#3/#4 behavioural) → `d5a49fef` (#5 tight band) → `39688d69` (#8-#11 new file). **8 mutation runs, EVERY RED OBSERVED FIRST-HAND — zero "asserted only", zero non-reddening findings. With batch 1 this is 13/13 phase-wide = ROADMAP criterion 5 COMPLETE.** ⭐ **slowapi synced 0.1.9 → the CI pin `0.1.10` BEFORE any #3/#4/#5 cycle** and both dependent internals re-confirmed on it (`if all(args)` empty-key skip at `slowapi/extension.py:506-527` — the pinned dependency's own source, `analytics-service/.venv/.../site-packages/slowapi/extension.py`, not a repo file; `view_rate_limit` = `(limit, [key, scope])` at `:530`); env left at 0.1.10. #3 `default_platform_key` → `return ""` ⇒ **3 failed / 65 passed** incl. **`never answered 429 within 4 calls`**; #4 → per-request `uuid4().hex` ⇒ **3 failed / 65 passed** incl. the stability assertion + the same missing 429. The old oracle was `assert _key_func is default_platform_key` — object IDENTITY, true for any body — so the new gate drives **real HTTP requests** through a throwaway app whose route declares NO `key_func` (no production route exercises the singleton default at all), decorated ONCE at module scope, bounded-and-driven; the identity assertion (`analytics-service/tests/test_limiter_identity.py:495`) is RETAINED. #5 `_retry_after_seconds` → `return 1` ⇒ **2 failed** — `0 < 1 <= 3600` passed the old bound, so a `> window * 0.9` band was added at **BOTH** weak sites (route A `/api/verify-strategy` AND route B `/api/csv/validate`, different routers), derived from the test-declared limit string, never from the function under test; mutation hits the computation (`analytics-service/main.py` — `_retry_after_seconds` :461-490), oracle reads the header (`:529`). **New file `tests/test_tenant_claim_parsing.py` (14 tests) — the four guards had NO test at all, not weak tests.** #8 drop the 512 bound ⇒ **2 failed** (`a 513-char claim was ACCEPTED` + `ran hmac.new 1 time(s)`) — ⚠️ the fixture is a **correctly-minted, VALID, merely oversized** 513-char claim because 513 chars of junk would NOT redden (rsplit raises, the never-raise except swallows it, `is None` holds either way); the spy substitutes rate_limit's `hmac` MODULE attribute, with a negative control asserting an ordinary claim reaches the MAC exactly once. #9 `rsplit`→`split` ⇒ **3 failed**; #10 drop the empty-payload guard ⇒ **3 failed**, mutant bucket literally `'claimtest:t:'`. **#11 closed 2 of 2**: `:333` ⇒ **1 failed** (the `:417` test GREEN), `:417` ⇒ **1 failed** (the `:333` test GREEN) — the asymmetry is the proof of independent coverage. Zero symbols imported from the module under test except the 3 functions under test; every expectation a literal or stdlib-minted. **PHASE-WIDE GATE (all five, first-hand):** pytest **4743 passed / 96 skipped / 0 failed** (4724 + 5 + 0 + 14, reconciles exactly) · collection **4837**, 0 errors, and the 4837-vs-4839 delta traced to 2 PRE-EXISTING module-level `allow_module_level` skips rather than assumed · `mypy --strict` **89 files clean** · `npx tsc --noEmit` **0** · full `npm run test:coverage` **8878 passed / 0 failed** (697 files) with all four thresholds clear · `npm run lint` **0 errors** · **0** new `# type: ignore` phase-wide · `grep -rn MUTANT` → 0 · **zero production files modified**. **WAVE 4 COMPLETE — PHASE 140.1.1 EXECUTION COMPLETE (7/7 plans).**

### Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity (INSERTED)

**Goal**: The breaker counts the failures it exists for, ignores the ones it must not, and every constant governing it is falsifiable
**Depends on**: Phase 140 (the core), Phase 140.1 (consumes its status contract — do not ship a discriminator against a contract 140.1 is changing)
**Requirements**: SEAMCORE-01..11
**Success Criteria** (what must be TRUE):

  1. A stalling upstream that returns headers fast and the body slow **records a failure** — the recording window covers the body read, and the deadline surfaces as a typed seam error, not a raw `DOMException`.
  2. A caller fault (malformed service URL, bad timeout override) and an exchange-attributable upstream error each record **zero** breaker failures; a genuine service fault records one — including when the body is `text/plain`.
  3. Mutating any breaker constant or any per-route timeout budget turns a test **RED**. Today 10 simultaneous semantic mutations produce a byte-identical pass; this criterion is the direct inversion of that.
  4. The breaker's Redis-side semantics (sliding-window decay, weighted carry-over, `nx` trip idempotency) are verified against **real Redis**, not a fixed-window fake that cannot execute the deployed Lua.
  5. A degraded or hung breaker store cannot hold a lambda past its declared budget, and the budget invariant accounts for store round trips in the closed, open and failing states.
  6. Adding an import to the shared error leaf, swapping a call site's budget key, or routing a health warmer through the core each fail a test — the structural invariants are enforced, not documented.
  7. **`analytics-client.ts` mints the `X-Tenant-Claim` header, flipping the SIX rekeyed Python routes reachable from that client — five live, one dead — from `platform:<path>` to genuine per-tenant throttling.** ⚠️ *Corrected 2026-07-27 by plan 140.2-09, which delivered it.* This criterion previously read **"flipping all nine rekeyed Python routes"**, which is false and was false when written. The behaviour-derived answer comes from a reproducible sweep — `grep -rn "key_func=partial(tenant_or_platform_key" analytics-service/routers/` → 9 sites, each route path then grepped across `src/` and the hit READ: **6 reachable** from `analytics-client` (`validate-key`, `encrypt-key`, `optimize-weights`, `portfolio-optimizer`, `portfolio-bridge` **live**; `portfolio-analytics` reachable but its wrapper `computePortfolioAnalytics` has **zero production callers**, so it flips a dead path) and **3 unreachable from that client by construction**: `fetch-trades` is reached only by an eslint-allowlisted debug raw fetch, and `csv/validate` and `verify-strategy` have their TS routes re-targeted to `/process-key` (which was already per-tenant since 140.1), leaving the Python routes of those names with zero TS callers. Those three are **unaffected** by TS-04 and need a separate owner if they are ever to be flipped. (Inherited obligation **TS-04** from Phase 140.1, which completed the Python half — the same key function provably returns `optimize_weights:t:<user>` the instant a claim appears, and the cross-language HMAC link is proven end-to-end. Until this lands, PYAPI-02's per-tenant guarantee holds for `/process-key` ONLY. ⚠️ *Corrected 2026-07-26:* the claimless arm at `analytics-service/services/rate_limit.py` — `_platform_bucket` :169-188 — is `platform:<path>` **per route**, so the nine sit in **nine separate** platform-wide buckets, not one shared one — exhausting `/api/optimize-weights` does not touch the other eight. Also **not a merge regression**: pre-phase these routes were IP-keyed behind Vercel egress NAT, i.e. already effectively platform-wide. TS-04 makes them better; its absence does not make them worse.) A test must prove a request from tenant A cannot consume tenant B's allowance on at least one of the nine. *Satisfied on all FIVE live routes, not the minimum one, by `src/lib/analytics-client.test.ts` — which drives each wrapper twice with two server-derived identities and reproduces the Python bucket decision (`verify_tenant_claim` + `tenant_or_platform_key`, transcribed by hand) to show `<scope>:t:tenant-a` vs `<scope>:t:tenant-b` rather than one shared `platform:<path>`. It also refuses the payload-splice forgery. The zero-signature-change shortcut — satisfying the clause via `runPortfolioOptimizer`/`findReplacementCandidates` alone, both of which already carried an actor id — was available and deliberately NOT taken: it would have left the two busiest key-connect endpoints and the 20/minute optimizer on a platform bucket.*

**Plans**: 12 plans / 12 waves (`workflow.use_worktrees=false`, so waves order the work sequentially on the main tree rather than parallelising it)

> ⚠️ **Was 14 plans / 14 waves.** On 2026-07-26, during the plan-checker review, the developer re-homed
> two consumer-surface plans to Phase 140.3: `140.2-12` → `140.3-01` (TS-05/08/09) and `140.2-13` →
> `140.3-02` (TS-02/11–15). Old plan 14 became plan 12 (wave 12). **This is a re-home, not a scope
> cut** — the work and its six Falsifiability Ledger rows (M51–M56) moved intact and are recorded in
> `140.3-CONTEXT.md`'s handover note. The 140.2 ledger is correspondingly **55 rows**, not 57.

Plans:

- [x] 140.2-01-PLAN.md — SRH spike, then the real-Redis lane + `frontend-seam-redis` CI gate, and the six mutation rows only that lane can observe (SEAMCORE-09 / SC4)
- [x] 140.2-02-PLAN.md — the literal-pinned constant + budget oracle, the route-row deep compare, **and cutting the self-referential fake at all 4 `fakeRatelimitFor` sites** (SEAMCORE-07 / SC3) — ✅ **both oracle layers closed; `opts.limiter.tokens` → 0 in src/; M14b measured 1-failed → 7-failed across the cut; 20/20 rows OBSERVED RED**
- [x] 140.2-03-PLAN.md — 13/13 budget-key pins **+ a roster mechanism that fails on a 14th**, leaf purity, warmer exclusion (SEAMCORE-08 / SC6)
- [x] 140.2-04-PLAN.md — fixed-point alias taint in `no-raw-analytics-fetch` + all four URL shapes (SEAMCORE-08)
- [x] 140.2-05-PLAN.md — the try block in ONE pass: body-read window, URL/deadline hoist, `redirect: "error"`, override validation (SEAMCORE-02, SEAMCORE-11 / SC1)
- [x] 140.2-06-PLAN.md — attributability discriminator + per-dependency breaker keying + OB-8 (SEAMCORE-01 / SC2)
- [x] 140.2-07-PLAN.md — bounded store, the A-09 sentinel, single-read breaker state, no-re-arm, store-aware budget arithmetic (SEAMCORE-03/04/05 / SC5)
- [x] 140.2-08-PLAN.md — the redaction leaf at 15 log sites + 10 Sentry captures, and the breaker transition event (SEAMCORE-06)
- [x] 140.2-09-PLAN.md — `X-Tenant-Claim` minted from `analytics-client`, five live routes flipped (SC7 / TS-04)
- [x] 140.2-10-PLAN.md — composite fan-out capped at the query; the budget table models the branch actually taken (SEAMCORE-10)
- [x] 140.2-11-PLAN.md — one defined outcome for non-JSON 2xx / 204 / 205 / 304 across both clients; `CircuitOpenError` validation (SEAMCORE-11)
- [x] 140.2-12-PLAN.md — the Falsifiability Ledger re-run at the final tree, phase gates, artifact reconciliation — **DONE** 2026-07-27. **56 rows re-executed at `48e6e3e2` (55 as planned + M19R), 55 RED and 1 GREEN.** ⚠️ **M19 (`nx: true → nx: false`) NO LONGER REDDENS** — wave 7's `existing.expiresAtMs > now` early return now fires ahead of the lock write, so a sequential second trip never reaches `set(..., nx)` and the flag became unobservable by R-3. The property (trip idempotency) is still enforced and is still falsifiable via the replacement row **M19R**, which was OBSERVED RED; the `nx` flag ITSELF is now unfalsified and is handed to Phase 141. **M14b's two-test receipt reconfirmed at the final tree** (pin + the behavioural trip-count case, 8 failures total) and all four `fakeRatelimitFor` sites re-verified by code text as taking the hand-typed default — the wave-2 cut held. Gates: coverage 84.57 / 78.52 / 81.78 / 86.68 vs 80 / 72 / 74 / 82 on 9303 passed / 287 skipped (724 files); `tsc` 0; `lint` 0 errors (cache cleared); real-Redis lane 7/7 with its executed-case fence matching; **zero `.py` in the phase diff**; zero new type suppressions; `SEAM_RETRIES` still 0.

*(Re-homed to Phase 140.3 on 2026-07-26: the former 140.2-12 → `140.3-01`, the former 140.2-13 → `140.3-02`. **This is a re-home, not a scope cut** — recorded here so the 14 → 12 drop is not read as work that was dropped.)*

#### Success-criterion adjudication — plan 140.2-12, 2026-07-27

Each verdict is backed by a named receipt observed first-hand at the final tree, or by an explicit
reason. A phase that reports 7/7 by softening a criterion is the failure this programme exists to end.

| SC | Verdict | Evidence |
|---|---|---|
| **SC1** | **SATISFIED** | `resilient-fetch.test.ts > headers arrive, the body then aborts ⇒ exactly ONE recorded failure and a typed SeamBodyReadError`. Falsifier **M26** RED at the final tree — 12 cases across 4 files, incl. `expected DOMException{…} to be an instance of SeamBodyReadError`. |
| **SC2** | **SATISFIED** | Six attributability-class cases in `resilient-fetch.test.ts` + 65 cases in `seam-discriminator.test.ts`. **Both** `text/plain` readings covered (500 ⇒ ZERO, 503 ⇒ ONE on the residual global key). Falsifiers **M25** (3 RED), **M38** (3 RED), **M35** (3 RED), **M39** (4 RED). |
| **SC3** | **SATISFIED** | 69 cases in `seam-constants.pin.test.ts`. **M1–M13 each RED individually**; **M14/M14b/M15/M16/M17** RED; **M24** RED. "Any breaker constant" verified by MEASUREMENT, not by reading the pin file: five supplementary probes beyond the ledger — `BREAKER_LOCK_TOMBSTONE_S`, `BREAKER_STORE_RETRIES`, `BREAKER_STORE_BACKOFF_MS`, `BREAKER_KEY`, `SEAM_RETRIES` — were each mutated and each reddened (3 / 6 / 4 / 3 / 16 cases). **All ten exported breaker and store constants are falsifiable.** |
| **SC4** | **SATISFIED — with one named residual, and adjudicated on evidence rather than on plan 140.2-01's memo.** | The SRH verdict was PASS-EVALSHA, so the PASS arm applies, and it was re-verified first-hand rather than inherited: the lane ran 7/7 against the two digest-pinned containers, its anti-vacuity fence (`EXPECTED_CASES = 7`) matched the 7 cases executed, and **seven mutations were OBSERVED RED against real Redis executing the deployed Lua** — M14 (R-2), M15 (R-5), M16 (R-7), M18 (R-4), M19R (R-3), M20 (R-1), M20R (R-1). Decay and weighted carry-over (M15/M16) and trip idempotency (M19R) are all falsified. ⚠️ **RESIDUAL, stated rather than absorbed: the `nx` flag named in the criterion's own wording is NOT itself falsified any more** (see M19 above). Trip idempotency is; the `nx` mechanism is NOT redundant and is NOT a second layer — it is ORTHOGONAL. The wave-7 early return requires the read to have SEEN a live lock; `nx` guards the case that return structurally cannot reach, namely two Fluid Compute instances that both read `null` and both write. (Wording corrected post-review per W-1: `140.2-VALIDATION.md` §8 called it "a real behavioural difference and a real open falsifier gap" and the ledger was right. **Closed in the review-fix pass** — the `staleReadOnce` hook in `resilient-fetch.test.ts` makes the concurrent read reachable and M19 (`nx: true → nx: false`) was OBSERVED RED again; the same pass also closed HI-01, the tombstone branch that had no exclusion at all, and W-2's `written`-gates-the-emit property.) ⚠️ **Also outside this phase's control:** the 140.1 review recorded `rulesets: []` on this repo — i.e. **possibly no branch protection at all**, which would make `frontend-seam-redis` a gate in the workflow that nothing enforces at merge, along with every other CI gate. **Recorded for the founder; not acted on.** |
| **SC5** | **SATISFIED** | 45 SC-4b cases (15 routes × 3 breaker states), each against the route's **on-disk** `maxDuration`. Falsifiers **M27** (1 RED — the A-09 sentinel), **M29** (1), **M30** (4), **M40** (2), **M41** (24 RED **including the OPEN state**, `expected 360750 to be less than 300000`). |
| **SC6** | **SATISFIED — and two clauses were ADDITIVE work, not tightenings.** | (a) leaf purity — **M21** RED; (b) warmer exclusion — **M23** RED (3 cases); (c) budget-key bindings — **M22** ×3 RED plus **M22b**, which reddens EXACTLY ONE assertion (the roster-completeness mechanism) while all thirteen individual pins stay green. ⚠️ **SC6's health-warmer clause had NO existing guard to extend** — ESLint sets `no-raw-analytics-fetch` to `"off"` on both warmer paths, so this phase BUILT that guard rather than tightening one. The phase is not credited with tightening something that did not exist. |
| **SC7** | **SATISFIED at the CORRECTED scope — 6 reachable / 5 live, not "all nine".** | The corrected wording is in place above (criterion 7), placed by plan 140.2-09 which delivered it, with the reproducible sweep recorded. Delivered scope is the honest one: **five live routes**, not the zero-signature-change shortcut via `runPortfolioOptimizer`/`findReplacementCandidates` that the literal wording would have permitted. Falsifiers **M28** (16 RED), **M44** (48 RED), **M45** (17 RED), **M46** (4 RED), including `two different tenants land in two DIFFERENT per-tenant buckets` and `a claim minted with the WRONG secret degrades to the platform bucket`. |

**Also stated rather than implied:** **SEAMCORE-06's "every Sentry capture" clause is ADDITIVE.** The
seam captured NOTHING to Sentry before this phase — `captureException` / `captureMessage` across the
core, both clients and the three seam routes is zero. Ten `captureToSentry` calls became safe by one
edit at the chokepoint. **No leak was plugged; a mechanism was built.** Falsifiers **M34** (6 RED),
**M33** (3 RED), **M42** (1 RED), **M43** (2 RED).

### Phase 140.3: SEAMUX — Client & wizard seam error surface (INSERTED)

**Goal**: When the seam fails, every surface says something true, offers a way forward that isn't destructive, and tells us it happened
**Depends on**: Phase 140.2 (renders the error TYPES that phase owns), Phase 140.1 (codes originate there)
**Requirements**: SEAMUX-01..09
**Success Criteria** (what must be TRUE):

  1. With the breaker open, every seam-touching surface renders the breaker's own copy — not "our team has been notified", not "we fetched your trades", not "check your credentials", not "validation failed" with zero rows. No surface asserts work happened, or didn't, that the client cannot know.
  2. Drift between any two production copies of a seam error string fails a test; a code emitted by a route is a code the wizard classifier recognises.
  3. Every seam call site fails on an unrecognised or unparseable body rather than treating it as success — in particular, an unrecognised 200 never starts a poll for a job that was never enqueued.
  4. A recoverable seam error always offers a retry; that retry is never the only route to a destructive control (**TRAP-4** — five clicks of our own copy must not destroy a composite draft); `Retry-After` is honoured for the breaker's 503, not only for 429.
  5. A publish or permission gate fed by a drifted analytics response **fails closed** — a key holding trade/withdraw scope can never publish as read-only-verified.
  6. Funnel events carry the specific error code (an outage is distinguishable from a bad file) from every wizard variant, and failures reach Sentry wherever the copy claims they do.
  7. **A failed recompute never leaves the previous result on screen as if it were current.** With suggestions already loaded and the seam then failing, no ranked allocation, weight set or candidate list remains rendered with live action controls — the money-decision hazard B-26 documents, whose fix shape already exists in `WeightOptimizerSection.tsx`.

**Plans**: 17 plans / 16 waves (waves are sequential — `use_worktrees` is false, so they express dependency order, not parallelism). Plans 01 and 02 were re-homed from 140.2 on 2026-07-26; 03–16 planned 2026-07-27. Plan 13 was split into **13a + 13b** at revision round 2 (both wave 13, sequential) — a context measure, never a scope reduction. ⚠️ **This phase's own planning pass must start numbering at `140.3-03`** — slots 01 and 02 are taken. See `140.3-CONTEXT.md`'s handover note for the six ledger rows (M51–M56) and the two hard cross-phase prerequisites that arrived with them.

Plans:

- [x] 140.3-01-PLAN.md — the three Class-5 `typeof body.detail` sites × two contracts; two `WizardErrorCode` union members (TS-05/08/09) — *re-homed from 140.2-12; needs `seam-discriminator.ts` from 140.2-06.* ⚠️ **AMENDED 2026-07-27 at the planning gate:** the membership was a DIFFERENT 3 — `ScenarioCommitDrawer.tsx` dropped (correction C-2: gated on `409/portfolio_fingerprint_stale`; its route imports no seam module), `PortfolioImpactPanel.tsx` added (C-3: a real member, and the file the plan wrongly cited as the safe template). `STATUS_CONTRACT.md` §2.1 corrected in the same task; M51 re-pointed.
- [x] 140.3-02-PLAN.md — `/process-key` consumers branch on `ok`; `X-User-Access-Token` forwarded and scrubbed (TS-01/02/11/12/13/14/15) — *re-homed from 140.2-13; needs `seam-redaction.ts` from 140.2-08 (a SAFETY ordering: the token is a live user JWT)*
- [x] 140.3-03-PLAN.md — the fail-CLOSED publish gate at **both** members of the unchecked-cast class (`finalize-wizard` + `keys/[id]/permissions`, which caches its unvalidated verdict for 60 s) — SEAMUX-07. *Scheduled at the earliest free wave: a security gate, not error rendering.*
- [x] 140.3-04-PLAN.md — `src/lib/seam-copy.ts` leaf + purity guard + cross-copy pin; all 10 production emitters re-pointed; **the 12 test literals deliberately untouched (C-1 / TRAP-9)** — SEAMUX-01
- [x] 140.3-05-PLAN.md — `CIRCUIT_OPEN` becomes a first-class code at `SubmitStep`; `classifyKeyValidationError` reads `body.code` above the cascade; the S-5 parity test (TS-35) — SEAMUX-01/02/08
- [x] 140.3-06-PLAN.md — **THE PHASE'S ONLY PYTHON EDIT.** `400 → 424` at all 7 `VenueTransientHTTPException` sites + fixture + `EXPECTED_STATUS` in one commit (TS-32). Gated by `mypy --strict` + `pytest`.
- [x] 140.3-07-PLAN.md — discard the invalidated result at **both** live B-26 members (`PortfolioOptimizer`, `KeyPermissionBadge`) + `ReplacementPanel` pinned negatively — SEAMUX-09
- [x] 140.3-08-PLAN.md — observe the HTTP outcome at every seam call site (`ApiKeyManager` ×2, `AllocatorMatchQueue`, `WeightOptimizerSection`); kill the `SUPABASE_SERVICE_ROLE_KEY` copy — SEAMUX-05
- [x] 140.3-09-PLAN.md — **PLUMBING first**: a wait field on `WizardErrorContext` and `ErrorEnvelope` (SC4 is unrepresentable today); `Retry-After` honoured for the breaker's 503; TS-34's status half — SEAMUX-06
- [x] 140.3-10-PLAN.md — **the C-8 unit as ONE task**: codes on `keys/sync`'s five arms + the TRAP-3-live transport split + TRAP-4's confirmation. Table-wide TRAP-4 guard — SEAMUX-03/06
- [x] 140.3-11-PLAN.md — TS-19 (both admin routes stop flattening) then TS-18 (render the 424 as a named, recoverable venue state) — SEAMUX-03/04
- [x] 140.3-12-PLAN.md — the copy honesty pass: **7 false-claim strings across 5 codes** (2 more than any source document listed) + TS-09's real copy + TS-17 — SEAMUX-04
- [x] 140.3-13a-PLAN.md — funnel specificity at every wizard variant (`MultiKeyConnectStep` emits nothing today) + **decides the ONE capture policy** + Sentry at 4 of 9 routes (admin/match ×2, `keys/[id]/permissions`, `verify-strategy`) — SEAMUX-08
- [x] 140.3-13b-PLAN.md — the SAME policy applied verbatim at the remaining 5 routes (strategies ×3, `portfolio-optimizer`, `scenario/optimize`) + the **joint 9-of-9 audit** and the mutations — SEAMUX-08. *(13a+13b are a CONTEXT split of one plan, both at wave 13, sequential via `depends_on`; the 9-of-9 obligation is held jointly and neither half may close SEAMUX-08 alone. ⚠️ `csv-validate`'s test lives at `src/__tests__/csv-validate-route.test.ts`, not beside its route.)*
- [x] 140.3-14-PLAN.md — TS-37 (1 of 4 `COMPOSITE_MEMBERSHIP_UNKNOWN` arms gets a permanent code, `KNOWN_FINALIZE_CODES` same commit) + TS-33 (`wizard_session_id`, ONE field) — SEAMUX-03/04
- [x] 140.3-15-PLAN.md — TS-38 (`SEAM_MISCONFIGURED` stops wearing the upstream's envelope) + TS-20 (`correlation_id` reaches the render slot) — SEAMUX-03/04
- [x] 140.3-16-PLAN.md — **phase gate**: negative pins on the four already-strong properties; all 26 ledger rows re-run at the FINAL tree; 7 criteria / 9 requirements / 19 obligations adjudicated. Has a blocking human checkpoint (copy vs DESIGN.md; the destructive path proven in a real flow).

**Gap-closure series** *(added post-VERIFICATION, `gap_closure: true`; these 8 plans were executed and summarised but had no rows here until the 2026-08-01 close-out — the work itself is described in this phase's milestone-list entry above. There is no G3.)*

- [x] 140.3-G1-PLAN.md — poll-disjointness re-tiering + guard registration
- [x] 140.3-G2-PLAN.md — SC2 residual adjudication + the stale-count class
- [x] 140.3-G4-PLAN.md — SEAMUX-03 coded arms on the key-verification route surface
- [x] 140.3-G5-PLAN.md — SEAMUX-03 coded arms on `scenario/optimize` + simulator
- [x] 140.3-G6-PLAN.md — `/api/bridge` (9 arms) + `/api/portfolio-optimizer` (9 `code:` sites), incl. the B-26 money-bearing arm
- [x] 140.3-G7-PLAN.md — `/api/strategies/csv-validate` **wire audit**: found ZERO codeless arms (already coded positionally via `csvErrorBody`) — measurement, not a rewrite
- [x] 140.3-G8-PLAN.md — both admin match routes: `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies
- [x] 140.3-G9-PLAN.md — `/api/admin/strategy-review`, the TENTH route the VERIFICATION's nine-route list MISSED (instance-not-class): 0→27 coded arms

### Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open (INSERTED)

**Goal**: The surfaces stop asserting things we did not measure, stop offering a destructive control as the way forward, and stop attributing our own faults to the user or their venue — and the guards that claim these classes are closed can actually fail.
**Depends on**: Phase 140.3 (renders the error types; this phase closes the rim 140.1-140.3 left open)
**Requirements**: SEAMRIM-01..NN (to be derived at planning from `.planning/reviews/140-SYNTHESIS.md`)

**Why this phase exists**: the end-of-milestone review (14 registers, 5 specialists + 7 red teams + 2 mutation samples, `.planning/reviews/`) adjudicated all 94 original Phase-140 findings at HEAD: **58 CLOSED / 26 PARTIAL / 8 OPEN / 2 SUPERSEDED**. Cluster A (seam core) has **zero OPEN**; cluster B (wizard/client) is 10 CLOSED against **14 PARTIAL + 4 OPEN**. Two independent mutation samples (28 mutations) measured **93% of sampled CLOSED verdicts genuinely guarded** — so the core is real and the rim is where the work is.

⚠️ **The coverage law governs planning** (measured across everything since Phase 140):
| fix mechanism | measured coverage |
|---|---|
| forced through a shared artefact (chokepoint / leaf / table / component) | **100%** |
| hand-typed roster or allow-list | 9/37 codes · 8/15 files · 2/3 codes |
| per-site edit, no artefact | 1/8 · 2/56 · **0/32** |
Any remedy landing in row 2 or 3 is **partial by construction** and must say so.

**Plans:** 14 plans in 4 waves

Plans:

- [x] 140.4-01-PLAN.md — C-3a: `strategyGate` refuses an unrepresentable span (row 1, both consumers) + the admin publish route's 7 unchecked reads — SEAMRIM-01 *(wave 1)*
- [x] 140.4-03-PLAN.md — C-2: the CSV double-submit — a `(user_id, wizard_session_id, source)` partial index, the CSV writer, the SQL receipt with its cross-source control, the 23505 arm, the copy — SEAMRIM-03 *(wave 1)*
- [x] 140.4-04-PLAN.md — the raw-5xx `ast` census (12 sites / 9 triples) against a multiplicity-preserving quarantine; re-runs the mutation that was GREEN — SEAMRIM-09 *(wave 1)*
- [x] 140.4-05-PLAN.md — a visually-inert `<LiveRegion>` primitive + the 3 measured-regressing surfaces (3 of 27, partial by construction) — SEAMRIM-10 *(wave 1)*
- [x] 140.4-02-PLAN.md — C-3b: the wizard's 7 unchecked gate reads + a runtime receipt that read-failed ≠ genuinely-empty — SEAMRIM-02 *(wave 2)*
- [x] 140.4-06-PLAN.md — C-5a: `captureToSentry` returns its promise (copy `audit.ts`), `after()` at the breaker's three sinks, the limiter's timeout sentinel recorded — SEAMRIM-04 *(wave 2)*
- [x] 140.4-07-PLAN.md — scrub tail A: `keys/sync` (6), `csv-finalize` (6), `verify-strategy` (3) = 15 sites — SEAMRIM-06 *(wave 2)*
- [x] 140.4-08-PLAN.md — scrub tail B: the remaining 6 import-edge routes (12 sites) + `ratelimit.ts`'s Upstash-token log — SEAMRIM-06 *(wave 3)*
- [x] 140.4-09-PLAN.md — C-1 (LOW): `csv-validate`'s static 502 + the text-carrying-channel alias rule + the thrown twin — SEAMRIM-06 *(wave 3)*
- [x] 140.4-11-PLAN.md — C-4: the destructive control must be EARNED — invert the roster into a property (verified count is 1, not 9) — SEAMRIM-07 *(wave 3)*
- [x] 140.4-14-PLAN.md — the `no-unchecked-supabase-read` ESLint ratchet, scoped to the proven-clean glob — SEAMRIM-11 *(wave 3)*
- [x] 140.4-10-PLAN.md — derive `SEAM_FILES` from the IMPORT EDGE + `derived == SEAM_ROUTE_BUDGETS` + registry rows and floor — SEAMRIM-06 *(wave 4)*
- [x] 140.4-12-PLAN.md — the wire↔render vocabulary: translation becomes authoritative; the nested envelope is read — SEAMRIM-08 *(wave 4)*
- [x] 140.4-13-PLAN.md — C-5b: adopt `rateLimitDenyJson` at the 12 seam call sites + a derived-population posture guard — SEAMRIM-05 *(wave 4)*

### Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth (INSERTED)

**Goal**: What the codebase SAYS about itself is true — in user copy, in comments, in citations, and in the tests that stand in for the contract — so the next phase can trust what it reads.
**Depends on**: Phase 140.4 (SEAMRIM closes the behavioural rim; this closes the descriptive one)
**Requirements**: SEAMPROSE-01..NN (derive at planning from `.planning/reviews/140-SYNTHESIS.md` WP-3, WP-10, WP-12, WP-13, WP-14, WP-15)

**Why this phase exists**: 140.4's planner audited its own source coverage and found six in-scope items it could not fit without recreating the context pressure that forced 140.3's 13a/13b split. **Not a difficulty judgement** — none lacks information or has a dependency conflict. They share almost no files with 140.4's waves, and file-disjointness is what made 140.1–140.3 independently plannable.

**Carried scope:**

1. **The comment/citation-rot class** (CONTEXT §6 of 140.4 named it IN SCOPE; moved here deliberately) — 881 citations, 18 provably past-EOF (15 in two files outside these phases); `keys/[id]/permissions` documents *"5 minutes"* vs `revalidate: 60`; `sentry-capture.ts` claims *"the seam captures nothing to Sentry"* when it is **41 sites across all 15 routes**; the contract registry says *"exactly three predicates"* (five) and *"the six seam files"* (eight, and the guard's own docblock says EIGHT). ⚠️ **7 of 17 comment findings were 140.2 comments falsified by 140.3 commits in the same range** — no phase re-measures what its predecessor wrote down.
2. ⭐ **`Retry-After` travels** — honoured at **1 of 4** surfaces; chokepoint is `process-key-client`, then 5 `buildEnvelope` threads. **HARD PREREQUISITE FOR PHASE 141** — retry-with-backoff consumes `Retry-After`, so 141 must not land on plumbing that reaches one surface in four.
3. `SERVICE_UNREACHABLE` at the three transport catches; the dead `"timed out"`/`"timeout"` branch (**B-02, a confirmed OPEN finding** — the commonest Railway outage still renders `UNKNOWN`); `fetchLivePermissions` carrying `{status, code, retryAfterSeconds}`; `PERMISSION_DENIED` + scope codes in `VENUE_WIRE_CODE_TO_VERDICT`.
4. Harness fidelity: `vi.unstubAllGlobals()` + env snapshot in `src/test-setup.ts`; `ci.yml`'s skip regex; `/\bimport\s*\(/` in the four purity pattern sets.
5. `mintTenantClaim(payload: string, secret: string)` — two adjacent same-typed strings (**latent type hazard, NOT a live attacker path** — orchestrator-resolved); `probe_error: z.boolean()`; `SeamBreakerVerdict` as a discriminated union.
6. Test fidelity: the six wrong 429 shapes, the `500 + retryable:true` body `_validate` refuses to construct, the 424 tested where it cannot arrive.
7. ⭐ **DEF-140.4-C — forwarded upstream 4xx renders as "your CSV is invalid"** (`.planning/phases/140.4-*/deferred-items.md`). Found in a **live browser QA pass** (2026-07-29) uploading a real founder CSV, and independently rediscovered server-side by 140.4's code reviewer as CR-02. The fix round closed the **502** arm and the duplicated title/body (`src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` — heading render :162-166, cause render :167-168 — rendered `human_message` as heading AND cause when `errors.length === 0`). **Still live: the `!result.ok` arm forwards upstream verbatim, so a 401 — and equally 403/404/409 — lands on `CSV_VALIDATION_FAILED`.** Deliberately not point-fixed in 140.4: this is the instance-not-class shape that phase exists to stop. Close it as ONE rule over every forwarded upstream status. Also open on the same panel: the copy promises a per-row breakdown that does not render when there are no row-level errors.
8. **The plan-to-plan hand-off hole, twice in 140.4** — a defect class this phase should consider guarding, not just fixing. `SEAM_MISCONFIGURED` reached two wizard clients as `UNKNOWN` because plan 12's GREEN landed before plan 13's and neither plan's `## OPEN` named it; `eslint.config.mjs:175-181` still cited a blocker plan 12 had already removed (measured 0 violations). Both are "plan A's premise falsified by plan B in the same phase, with no re-measurement." Note the fixer's own residual: **no guard asserts that every wizard client consuming a `rateLimitDenyJson` route consults the shared wire→wizard table**, so the hole reopens at whichever client lacks the hop.

**Binding inheritance**: 140.4's CONTEXT §2 (coverage law) and §3 (a grep proves a state; only a guard proves it is held) apply unchanged.

⚠️ **Two false premises 140.4 left corrected — do not re-derive them from stale docblocks**: (a) the wire→wizard table and the client rosters are **NOT disjoint** — `KNOWN_KICKOFF_CODES` shares `RATE_LIMITED` — so the safety property is **agreement**, not disjointness; (b) `VALIDATION.md`'s "no guard to falsify" claim for the thrown twin was false (row M109), and the surviving "no row possible" count is **two**, not three.

**Plans:** 8/8 plans complete

Plans:

- [x] **W1** · 01 — harness fidelity flip + `source-scan.ts` + purity needles *(lands ALONE: the leak closure is TRAP-8 sequence-sensitive, and it creates the comment-handling module every later guard imports)*
- [x] **W2** · 02 — `wizardErrors` vocabulary owner + B-02 + venue codes *(publishes the §4a interface plan 05 consumes)*
- [x] **W2** · 03 — `Retry-After` travels + `SERVICE_UNREACHABLE` at all five transport catches ⭐ *HARD PREREQUISITE FOR 141*
- [x] **W2** · 04 — citation/prose corrections, repo-wide
- [x] **W3** · 05 — the CSV class fix ⭐ *DEF-140.4-C and the §6 hand-off hole closed as ONE defect at row 1*
- [x] **W3** · 06 — test fidelity + spec-disabling guard
- [x] **W3** · 07 — type invariants
- [x] **W4** · 08 — seam-surface conversion remainder + the citation guard + ALL guard registrations + phase gate *(guard lands AFTER conversions — "fix before guard"; single owner of `contracts-registry.test.ts`, which kills the same-wave floor-bump conflict that made plans 10 and 13 collide in 140.4)*

### Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit

**Goal**: Transient Railway blips self-heal — but ONLY for calls with a traced idempotency proof, so a retry can never double-execute a side effect
**Depends on**: Phase 140 (retry must respect the breaker and use the unified budgets)
**Requirements**: SEAM-05, SEAM-06
**Success Criteria** (what must be TRUE):

  1. A committed in-repo audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced server-side side-effect evidence — including the previously-unaudited `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge set — and resolves whether `_get_recompute_lock` is distributed or process-local. Everything unproven defaults to no-retry.
  2. Under an injected single transient failure, an allowlisted call (e.g. `flow_type: resync`) succeeds on retry with exactly ONE server-side effect — proven against the real `compute_jobs` partial-unique-index + `WIZARD_DUPLICATE` contract.
  3. `flow_type: teaser` is provably never retried, and a regression test pins the contract (two identical teaser calls → TWO `strategy_verifications` rows) so a future refactor can't quietly start retrying it and minting duplicate verifications/`public_token`s/leads.
  4. With the breaker open, zero retry attempts fire — no bypass path exists, so retries cannot amplify an outage.

**Plans:** 4/4 plans complete

Plans:

- [x] **W1** · 141-01-PLAN.md — Python resync draft-SV dedup + DB proofs (SQL compute_jobs/SV-index gate, teaser two-rows pytest pin) ⭐ *the LOCKED precondition for allowlisting resync*
- [x] **W1** · 141-02-PLAN.md — retry loop + `retriesOverride` in `resilientFetch` (dormant: all rows stay 0), dual breaker gates, SC-4 mutation observed
- [x] **W2** · 141-03-PLAN.md — `seam-retry-registry.ts` leaf: the SC1 audit = the runtime allowlist (13 evidenced verdicts, absence ⇒ no-retry), SC-1 mutation observed
- [x] **W3** · 141-04-PLAN.md — wire both clients (flow_type-keyed, explicit `?? 0` belt), flip 5 rows + edit pins SAME commit, SC-4b charges backoff+jitterMax, SC-2/SC-3 mutations + phase gate

### Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation (INSERTED)

**Goal:** The retry honours the upstream's own `Retry-After` contract (built by 140.5, never consumed), the breaker threshold is a decided number under per-attempt counting, and the SEAM-05 audit artifact's evidence is re-derived from traced source so the documented audit and the runtime allowlist cannot drift. Scope from the 8-agent review campaign over 141 — see `141-REVIEW-CONSOLIDATED.md`. **Zero user-facing and zero data-integrity defects were found; no retry verdict changes and no budget row is un-flipped.**
**Requirements**: SEAM-05, SEAM-06 (evidence + guard repair; coverage tracked by decision ID D-01…D-20 from 141.1-CONTEXT.md)
**Depends on:** Phase 141
**Plans:** 9 plans

Plans:

- [x] **W1** · 141.1-01-PLAN.md — D-01 `Retry-After` fail-fast (SC-C/SC-C′) + D-02 threshold ratified (docblock + derived pin)
- [x] **W1** · 141.1-02-PLAN.md — D-03/D-04/D-05 evidence re-derived from traced source + D-06 both citation guards (SC-G/G′/H/H′, roster 34→35)
- [x] **W1** · 141.1-03-PLAN.md — D-14c `status='draft'` behaviour pin in Python tests (SC-P; OQ-2 decided: tests outside the fence)
- [x] **W2** · 141.1-04-PLAN.md — D-08 required `retriesOverride: 0 | 1`, fallback dropped (SC-E) + D-07 false prose corrected post-D-08
- [x] **W2** · 141.1-05-PLAN.md — D-11 frozen `as const satisfies` maps + real exhaustiveness + never-defaulted `budgetKeyFor` (SC-I)
- [x] **W3** · 141.1-06-PLAN.md — D-17 logging both silent arms (SC-M/M′ credential-negative) + G2 decodeBreakerLock bounds + D-12/D-13/D-10/D-14d headline mutations (SC-A/B/D/O)
- [x] **W3** · 141.1-07-PLAN.md — D-09 census retry axis (SC-F) + D-14a/b class-γ 3/3 + pins (SC-J/K) + D-15 per-leg SC-4b recharge (SC-L, 56,000ms)
- [x] **W1** · 141.1-08-PLAN.md — D-16 flag-monitor repair: numerator was structurally DEAD (OQ-1 resolved by probe) — rebuild on indexed fields + distinct-correlation_id denominator + anti-`path:` recurrence guard (SC-N strengthened)
- [x] **W4** · 141.1-09-PLAN.md — D-18 seam-breaker runbook + D-19 TODOS ledger (G1–G4 explicit, H1–H7) + D-20 ship-time 0.51.0.0 bump

### Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm (INSERTED)

**Goal:** Close the 13 verified findings from the xhigh code review of 141.1 (30 agents, 25 findings deduped to 13). Two are the priority. **(A) A duplicate WRITE on the money path:** `onboard`'s retry grant rests on `idempotent_by_session`, but `finalize-wizard` omits `wizard_session_id` when `strategies.wizard_session_id` is NULL — nullable by design — so the Python side mints a fresh `uuid4()` per attempt, the unique constraint cannot collide, and ONE user submit inserts TWO `strategy_verifications` rows on a flow the registry marks retry-safe. **(B) The D-16 flag-monitor denominator rewrite shipped three monitoring-integrity regressions in one change** — an unbounded `.select()` PostgREST silently truncates at `max_rows=1000` (HTTP 200, `error: null`); dedup keyed on the attacker-controllable inbound `X-Correlation-Id` reachable via the UNAUTHENTICATED `/api/verify-strategy`; and a dedup that collapses nothing on the only two retry-eligible flows, because the service re-mints a uuid4 whenever the inbound id is not a bare UUID and `wizardFetch` sends `wizard:<uuid>`. 141.1 repaired an alert that never fired and replaced it with one that can be silenced, saturated, or falsely triggered.
**Requirements**: SEAM-05, SEAM-06 (defect closure — the audit's retry verdicts and the alert that watches them; ⚠️ unlike 141.1, this phase DOES change a retry verdict or add a guard, see findings 1 and 6)
**Depends on:** Phase 141.1
**Plans:** 6 plans

⚠️ **Evidence:** `141.2-FINDINGS.md` in the phase dir holds all 13 with per-finding
failure scenarios (inputs → wrong outcome). Two scoping notes there are SUPERSEDED:
research proved findings 10–11 were INTRODUCED by 141.1 (`f308b460`, single-commit
`git log -S`) — finding 10 is the phase's top priority — and the founder ordered all
13 fixed in code, including 12–13 (`141.2-CONTEXT.md` D-05 + ⚠️ RESEARCH CORRECTIONS).

⚠️ **That sentence records the INSTRUCTION, not the outcome.** As shipped: **twelve
remediated, one dispositioned.** Finding 8 (retry → limiter amplification) was accepted
rather than fixed — no limiter code changed, and the amplification is still live; the
re-raise conditions are on `retriesForFlow` and in `TODOS.md`. Do not restate this phase
as "all 13 fixed in code".

Plans:

- [x] 141.2-01-PLAN.md — breaker cluster: corrupt-lock write path arms (f10, REGRESSION), absolute epoch bound (f11), per-attempt admission (f5)
- [x] 141.2-02-PLAN.md — resync verdict map move to NO (f6) + pin surgery + Python comment-only DEF-141.1-02-A
- [x] 141.2-03-PLAN.md — flag-monitor denominator: counting form, attempt grain, fail-loud read error (f2,f3,f4,f7,f12)
- [x] 141.2-04-PLAN.md — Retry-After parsed, not presence-tested (f9)
- [x] 141.2-05-PLAN.md — onboard retry conditional on idempotency-key presence at the chokepoint (f1)
- [x] 141.2-06-PLAN.md — delete the unfalsifiable pin (f13), runbook rewritten once, D-07 recorded, D-08 changelog corrected

### Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL

**Goal**: A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever — a wizard poll or page refresh sees a real terminal outcome
**Depends on**: Phase 141 (SEAM error taxonomy informs re-enqueue-vs-terminal decisions; JOB sequenced after SEAM)
**Requirements**: JOB-01, JOB-02, JOB-03, JOB-07
**Success Criteria** (what must be TRUE):

  1. A `strategy_analytics` row stuck in `computing` past the derived threshold with NO active `compute_jobs` row is transitioned by a recurring pg_cron reaper to a TERMINAL `failed` state carrying a user-recoverable message — superseding the one-off `reset_stuck_computing_rows.py` script.
  2. A row with a fresh `updated_at` but an old `computing_started_at` IS reaped, and a row with an old `updated_at` but a fresh `computing_started_at` is NOT — proving the reaper keys on the dedicated writer-stamped `computing_started_at` (set in the SAME statement that sets `computation_status='computing'`), never the 106-janitor-revert `updated_at`/`computed_at` mistake.
  3. A CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any relevant handler's batch-inclusive worst case exceeds the reaper threshold — the threshold is re-derived from `strategy_analytics`'s own batch-tail math, never copied from the `compute_jobs` 4h number.
  4. A large synthetic backlog does not stall worker `healthz` past `STALE_THRESHOLD` — the JOB-07 regression test proving no reaper/sweep work runs on the worker's shared asyncio event loop (the WEDGE-01 crash class this janitor exists to clean up after).

**Plans**: 6 plans

Plans:
**Wave 1**

- [x] 142-01-PLAN.md — JOB-03 Python side: JOB_CHAIN_FOLLOW_ON topology (enqueue sites read it) + canonical reap-threshold constant + TestReaperThresholdInvariant (wave 1)
- [x] 142-02-PLAN.md — JOB-07 structural gate + healthz blocking-vs-yielding control pair; delete broken reset_stuck_computing_rows.py + stays-absent gate (wave 1)
- [x] 142-06-PLAN.md — JOB-01 row type: StrategyAnalytics.computing_started_at (string | null, never optional) + EMPTY_ANALYTICS + 7 fixture files — the checker-measured 8-file compile blast radius (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 142-03-PLAN.md — JOB-01 app writers: stamp W1 + clear 11 Python & 4 TS exit sites, D.10 census, two-runtime stamp CI gate (wave 2)
- [x] 142-04-PLAN.md — migration 20260802120000: DDL + backfill + index + re-based bridge (conditional stamp) + inline pg_cron reaper; SQL↔Python drift gate (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 142-05-PLAN.md — SQL gate (ungated structural + behavioral arms), [BLOCKING] MCP apply to TEST, ledger mutations SC-1/1b/2/2b, phase gate (wave 3)

**Note**: JOB-07 is a cross-cutting constraint — Phases 143/144/145 must also keep their mechanisms off the worker loop (pg_cron by construction), but the REQ-ID and its regression test land here only.

### Phase 142.1: Close 142 review findings: chain-start stamp preservation, deploy sequencing, terminal-writer parity (INSERTED)

**Goal:** Close the 16 items raised by three independent passes over Phase 142 (high-effort workflow review, blind `gsd-code-reviewer`, and the `gsd-verifier` goal-backward pass that had never run) — so that the reap clock genuinely measures the whole job chain, no terminal writer can launder a failure into a green factsheet, the `sql-function-snapshot` CI gate is green again, and Phase 142's own falsifiability evidence is complete rather than 4/11.
**Requirements**: JOB-01, JOB-02, JOB-03 (remediation of Phase 142 delivery; no new REQ IDs)
**Depends on:** Phase 142
**Plans:** 8/8 plans complete

**Scope + per-item failure scenarios:** `.planning/STATE.md` § "Phase 142.1 scope".
**Evidence:** `142-VERIFICATION.md` (status `gaps_found`, 9/10), `142-REVIEW.md` (0 blockers, 4 warnings).

⚠️ **Phase 142's goal IS achieved** — all four of its ROADMAP success criteria hold behaviourally, proven by executing the real cron body against a throwaway PostgreSQL 16. 142.1 is remediation, not a rescue.
⚠️ **Item 12 is a hard-red CI gate** (`npx tsx scripts/dump-sql-functions.ts --check` exits 1) and is a one-command fix — do it first.
⚠️ **Items 1, 2 and 16 are orchestrator-only** — they need TEST-DB access, and MCP tools are stripped from subagents.

Plans:
**Wave 1**

- [x] 142.1-01-PLAN.md — D-12 run 1 (FIRST commit, clears the hard-red snapshot gate) + D-13 JOB-03 text + D-14 ledger backfill + DEF-142.1-08 deferral

**Wave 2**

- [x] 142.1-02-PLAN.md — test hygiene: D-10 shared _scan_helpers (union surface), D-06 wall-clock deletion, D-09 backlog=0, D-15 arity hoist + new pytest
- [x] 142.1-03-PLAN.md — CI hardening: D-05 neutralizers DELETED — isolation by construction (D-18) + shared-test-db group + one-rule grep gate; D-02/R1 fail-loud migrate + YAML pins

**Wave 3**

- [x] 142.1-04-PLAN.md — stamp-gate rework: D-07 soften raise arms, D-04 widen TS census, D-03 terminal-warned parity + csv-finalize one-line fix
- [x] 142.1-05-PLAN.md — migration 20260803120000: D-17 BEFORE UPDATE trigger (D-18) + D-11 companion arm (arm D inverted + Part 4 retrofit + drift gate/comments re-pointed SAME commit) + D-12 run 2

**Wave 4**

- [x] 142.1-06-PLAN.md — D-01 comment correction + D-02/R2 PGRST204 fallback in _mark_unrecoverable (after D-07, per C-12)
- [x] 142.1-08-PLAN.md — SQL gate Part 6 (G1 trigger sentinel, seeds at INSERT per D-18; grep-gate pin 0→3)

**Wave 5**

- [x] 142.1-07-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + D-01/D-02 TEST confirmations + D-16 end-to-end gate run + ledger consolidation

### Phase 142.2: Get MetaTrader 5 running end to end on the unified backbone (INSERTED)

**Goal:** A founder can connect a real MetaTrader 5 account through the wizard and reach a rendered strategy — key → dailies → backbone → UI — with no step requiring a human to know an internal error code, a server name, or a flag, and with admissibility decided by the canonical daily series rather than a hand-maintained venue list.
**Requirements**: MT5-01..05, MT5-11, MT5-12 (set at /gsd-discuss-phase 2026-08-03; see `142.2-CONTEXT.md` for the sixteen decisions behind them). ⚠️ MT5-11/MT5-12 were added AFTER the discussion, from live dogfood: the gate is not on the unified backbone. MT5-01/02 are already complete.
**Depends on:** Phase 142
**Plans:** 8/8 plans complete — ✅ **SHIPPED TO PRODUCTION as `v0.53.0.0` (PR #660, squash `8b327594`, 2026-08-04).** ⚠️ **STILL NOT CLOSED.**

Migration `20260803150000` applied to PROD via the auto-apply path; verified there read-only as
**text / nullable / no default, 0 CHECK constraints, 0 of 40 rows stamped** (no backfill, as designed).
Vercel Production is on `8b327594`; `quantalyze.xyz` returns 200 with `/api/health` `ok`.

⛔ **MT5-05 is an OUTSTANDING blocking human gate — and the deploy that blocked it has now happened,
so it is RUNNABLE.** `142.2-HUMAN-UAT.md` carries `status: pending` / `gate: blocking-human`: a founder
must complete the MT5 connect flow on **production**, without needing to know an internal error code,
a server name, or a flag. It is deliberately **not** approved — it has not been run.
⛔ **And even once MT5-05 passes, this phase means MT5 is REACHABLE, not CORRECT.** The numbers are
Phase 142.3's gate (D-17). Do not archive the milestone or advertise MT5 on the strength of 142.2 —
that is precisely how v1.15 shipped 6/6 phases green with both open items intact.

⚠️ **SPLIT 2026-08-03 at the D-14 valve, on the researcher's sizing finding (`142.2-RESEARCH.md`).** The original scope (MT5-01..12) was two phases, and the second was unbounded *by construction*: MT5-10 is uncapped by founder decision, and MT5-06/07/08 are human- and calendar-gated on a live trading-day session at the terminal. **MT5-06..10 moved to Phase 142.3.** This is the founder's pre-authorised valve (D-14) — a follow-up phase, **not** a scope cut. The dependency graph across the cut is one-directional: 142.2 makes MT5 *reachable and honest*, 142.3 proves it *correct*.

**Known inputs (do NOT re-derive at plan time):**

- v1.15 shipped MT5 and is ARCHIVED at tag `v1.15`. Live config: worker `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal:8001`, Vercel `NEXT_PUBLIC_MT5_ENABLED=true`. N accounts serialize through ONE gateway lock.
- ⚠️ v1.15 closed with two OPEN items, both live: **server-UTC offset**, and **confirm on a TRADING day** (a weekend run proves nothing).
- Founder-observed dogfood defects are already recorded in `TODOS.md` § "MT5 wizard — founder-observed on live UI": the Broker-server field is password-masked and should be plain text + searchable typeahead, and the connect-failure copy renders a generic `KEY_INVALID_FORMAT` that names Binance/OKX/Bybit at an MT5 user.
- "Unified backbone" here means the ONE pipeline (`key → dailies → backbone → UI`), not a second MT5-specific path. Dailies are canonical; derive metrics/charts/coverage from them.

⚠️ **A green unit suite is not evidence that MT5 is correct** — v1.15 shipped with 6/6 phases green and both open items survived it. That evidence is Phase 142.3's job. What 142.2 *can* prove offline is its own safety property: **a fills-gapped perp fixture must still be REFUSED.** MT5 passing is not the test; that perp still failing is.

Plans:

- [x] 142.2-01-PLAN.md — series_completeness migration (additive nullable, self-verifying) + the CI-counting SQL gate
- [x] 142.2-02-PLAN.md — MT5-03: per-venue passphraseSecret flag; MT5 broker-server plain text, OKX byte-identical (SC-7)
- [x] 142.2-03-PLAN.md — Python producers: SeriesCompleteness registry + all EIGHT combiner return paths accounted for (5 stamped; 3 empty-series early returns exempted **in writing**, justified by the `analytics-service/services/job_worker.py:4365` (`int(returns.notna().sum()) < 2`) non-NaN short-circuit) + the D-15 economic oracle (SC-1 py)
- [x] 142.2-04-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + A1/A2 executed evidence + read-only PROD censuses (A6, Pitfall-6)
- [x] 142.2-05-PLAN.md — worker enforcement: fail-loud assert BEFORE the reconcile-delete + composite_stitched stitch stamp + keyless user_supplied in the runner (SC-5, SC-6; covers all THREE csv_daily_returns producers)
- [x] 142.2-06-PLAN.md — TS gate consolidation: isLedgerBackedExchange DELETED, verdict allow-list, one exported predicate at all three former sites, composites stay approvable (SC-1 ts, SC-2, SC-3, SC-4)
- [x] 142.2-07-PLAN.md — MT5-04: KEY_INVALID_FORMAT split across the 24 emitting sites (12+12), copy honesty fix, registry-drift invariant (SC-8, SC-9, SC-10)
- [x] 142.2-08-PLAN.md — [autonomous:false] TODOS deferrals + falsifiability ledger backfill + MT5-01/02 delivered-record + MT5-05 founder checkpoint (reachable, NOT correct — 142.3 gates correctness)

### Phase 142.3: Prove the MT5 numbers correct against the live terminal on a trading day (INSERTED)

**Goal:** The performance Quantalyze renders for a live funded MT5 account matches the MT5 terminal's own equity and balance figures on a trading day, on every surface that renders it, with the broker-server-to-UTC offset measured rather than assumed — and any discrepancy found is fixed, wherever its root cause lives.
**Requirements**: MT5-06..10 (split out of Phase 142.2 on 2026-08-03 at the D-14 valve; the decisions behind them are D-07..D-11 in `142.2-CONTEXT.md`).
**Depends on:** Phase 142.2 (MT5 must be reachable through the gate before its numbers can be checked)
**Plans:** 0 plans

**Known inputs (do NOT re-derive at plan time):**

- ⚠️ This phase is **human- and calendar-gated**. It cannot be completed by an agent alone or on a weekend: it needs a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password.
- ⚠️ **MT5-10 is uncapped by explicit founder decision** (D-10). A bounded alternative — split shared-cause fixes into their own phase — was offered and **declined**. Shared-backbone money-math root causes are IN scope. Size for the unbounded case; do not treat it as an escape hatch.
- `MT5_SERVER_UTC_OFFSET_S=10800` is **already live** on the worker. The open problem is **DST and multi-broker**, not the base offset. The last-deal offset estimator was already built and already failed (the −810 stale-deal artifact), and `analytics-service/tests/test_mt5_client_contract.py` — `test_read_only_surface_no_trade_methods` :735, its `forbidden` parametrize :720-734 — explicitly forbids `symbol_info_tick` on `Mt5Client` — read `142.2-RESEARCH.md` before proposing a measurement mechanism.
- ⛔ **No tolerance number exists anywhere for MT5-07.** "Matching within a stated tolerance" with no stated number is unverifiable. This needs a founder call before MT5-07 can have an acceptance criterion — surface it at /gsd-discuss-phase 142.3, do not invent one.
- The residual risk MT5-09 exists to test is the **backbone-bypass surfaces** logged in `TODOS.md`: `_compute_portfolio_analytics` (`analytics-service/routers/portfolio.py:628`), `equity_reconstruction.py`, and the bespoke TS stacks — they re-derive metrics rather than reading them. One daily series checked five ways; a divergence is a finding.

⛔ **This phase is the gate on any "MT5 is done" claim.** 142.2 closing does not mean MT5 is verified — it means MT5 is reachable. The v1.15 failure mode was exactly this: ship green, open items survive. Do not archive the milestone or advertise MT5 until 142.3 passes.

Plans:

- [ ] TBD (run /gsd-plan-phase 142.3 to break down)

## v1.16 Progress (PARKED)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 140. SEAM core + breaker | 7/7 | Complete   | 2026-07-25 |
| 140.1. PYAPI contract/status/limiter (INSERTED) | 9/9 | Complete | 2026-07-26 |
| 140.1.1. PYAPI-FIX (INSERTED) | 7/7 | Complete    | 2026-07-26 |
| 141. SEAM retry (audit-gated) | 4/4 | Complete    | 2026-07-31 |
| 142. JOB reaper + DDL | 6/6 | Complete   | 2026-08-02 |
| 143. JOB dropped-enqueue sweep | 0/? | ➡️ **CARRIED to v1.19** | - |
| 144. JOB WR-02 terminal UPDATE | 0/? | ➡️ **CARRIED to v1.19** | - |
| 145. JOB csv-finalize atomicity | 0/? | ➡️ **CARRIED to v1.19** | - |
| 146. RATE audit + close | 0/? | ➡️ **CARRIED to v1.19** | - |

## Requirement Coverage (v1.16)

| Phase | Requirements |
|-------|--------------|
| 140 | SEAM-01, SEAM-02, SEAM-03, SEAM-04 |
| 141 | SEAM-05, SEAM-06 |
| 142 | JOB-01, JOB-02, JOB-03, JOB-07 |
| 143 | JOB-04 |
| 144 | JOB-05 |
| 145 | JOB-06 |
| 146 | RATE-01, RATE-02, RATE-03, RATE-04, RATE-05 |

18/18 v1 requirements mapped, each to exactly one phase. No orphans.

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.

## Current position

⭐ **CURRENT: v1.20 Backlog Burndown (Phases 158–165)** — roadmap created 2026-08-20. Eight
phases over the 50 verified-open requirements (RANK / SHARE / WIZERR / HONEST / OPS / SEC /
DEPS). Next: `/gsd-plan-phase 158`. ⛔ **Ordering is load-bearing:** 158 (OPS — CI/deploy
integrity) FIRST — the shared-test-db eviction silently skips Railway deploys (#616) and every
later phase merges through that pipeline; 165 (DEPS) LAST, hard-blocked on OPS-01; 160
(provenance) before 164 (SHARE) so the REVOKE gets deploy-then-soak time; 164 lands ALONE in
its own PR, ⛔ never branched from `feat/phase-156-connect-refactor`.

⏸️ **v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)** — PARKED 2026-08-20,
founder-gated twice over: new MT5 investor passwords AND the founder at the terminal on a
trading day. Phase numbers 155/157 stay reserved; v1.20 continues from 158. See the parked
milestone header above.

✅ **v1.17 MT5 — ingested, wizardable, surfaced** — CLOSED 2026-08-14, 10 phases delivered
(147–154, 156), shipped through v0.62.0.0. ⚠️ Its original title said *"usable end-to-end, not
merely ingested"*; Phase 155 was carried to v1.18 and the title was amended to match what was
actually delivered. ⛔ **MT5 is NOT advertised** — nobody has compared our numbers to the
terminal's.

✅ **v1.19 JOB/RATE** — CLOSED 2026-08-20 (tag `v1.19`, audit `tech_debt`, 9/9 requirements,
PRs #687–#695, v0.68.1.0). The "resume v1.16 at Phase 143" pointer that lived here is
DISCHARGED: Phases 143–146 became v1.19 and shipped; v1.16 proper closed 2026-08-14 at Phases
140–142.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
