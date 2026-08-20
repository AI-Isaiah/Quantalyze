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

**Purged 2026-08-20 (milestone v1.20 Backlog Burndown):** ~56 verified-open items moved into `.planning/REQUIREMENTS.md` (v1.20 scope — RANK/SHARE/WIZERR/HONEST/OPS/SEC/DEPS) and deleted here; ~28 entries verified STALE at HEAD by a 17-agent triage (solved by earlier milestones) and deleted. Founder-gated and remaining open items below are untouched. Snapshot of the pre-purge file: `git show 2e67c4a0:TODOS.md`.

---

## 🔴 FIX NOW — live correctness, trust-boundary security, active go-live

0. **⛔ MT5 ARCHITECTURE — the shared gateway cannot safely serve more than ONE user, and the
   read-only guarantee can fail OPEN.** Found 2026-08-08 by the platform research that Phase 134
   specified but never executed (`153-EVIDENCE-mt5-platform.md`, `153-EVIDENCE-mt5-latency.md`).
   **Founder decision needed before any further MT5 build.**
   - **Structural:** `mt5linux` 0.1.9 starts a single `ThreadedServer(SlaveService)`; every rpyc
     connection `import MetaTrader5` resolves through that one process's `sys.modules`, so **all
     callers share ONE C-extension holding ONE logged-in account**. `login()` on any connection
     silently reassigns the account every other caller sees, and our `finally:` `close()` →
     `mt5.shutdown()` (`routers/exchange.py:449-466`) tears down the IPC pipe *for concurrent
     callers*, who then see `-10004`. rpyc namespaces isolate variable names, not C globals.
     Our own `Mt5AccountMismatchError` bracket (`routers/exchange.py:364-368`, test named
     `test_mt5_login_bracket_post_hijack`) **detects** this race — it cannot remove it.
     MQL5 moderators are explicit: one account per terminal, a separate installation per account.
   - **🔒 Security — read-only verification can FAIL OPEN.** `is_trade_capable`
     (`services/mt5_validation.py:133-149`) concludes "investor/read-only" when BOTH signals are
     negative (`trade_allowed` false AND `order_check` retcode ≠ 10009). But `trade_allowed` is
     false for several documented reasons besides investor mode — including the terminal's
     **default-ON** *"Disable automatic trading through the external Python API"*. Under that
     default a **MASTER password passes our investor probe** and is stored stamped read-only.
     We call `terminal_info()` **nowhere** (verified: zero hits in `analytics-service/`), so we
     cannot distinguish the two. Also: `_TRADE_RETCODE_DONE = 10009` is `[ASSUMED]`, and the real
     investor signal `10017 TRADE_RETCODE_TRADE_DISABLED` is never tested.
   - **Login classification is inverted both ways** (`services/mt5_validation.py:37-56`, both
     token tables `[ASSUMED]`): a wrong-but-known server returns `-6 AUTH_FAILED` → we blame the
     user's password; an *unknown* server **times out** rather than erroring.
   - **Data integrity:** MT5 history syncs asynchronously after login; first-call-empty is widely
     reported, with an unresolved **Wine-specific** report of history never arriving. Our
     `()` → `[]` "honest empty" rule turns that into a **confidently flat account**.
   - **Why none of this was caught:** CI never installs `mt5linux` (`Dockerfile:29` installs it
     into the image only); every contract test injects a `_connect` double
     (`services/mt5_client.py:135-141`). The real transport has never run outside production.
     Phase 134 designed `scripts/mt5_spike.py` to answer exactly these four unknowns — **the
     harness was never built and `analytics-service/docs/mt5-spike-gonogo.md` still has 38
     `human_needed` cells.** v1.15 shipped through a gate that was never opened.
   - **RESOLVED 2026-08-08 — founder chose option (3), and the "once per day" fact makes it the
     right answer on cost too.** See `docs/notes/mt5-scaling-cost-2026-08-08.md` (prices read
     2026-08-08) — but note that report models **one terminal per account**, which is the wrong
     model for us. MT5 accounts refresh **once per day**, and a daily sync is sequential, so ONE
     terminal serves many accounts across a day (capacity ≈ daily window ÷ cycle time). Corrected
     comparison:
     | | one-terminal self-host (what we have) | MetaApi, duty-cycled nightly |
     |---|---|---|
     | 25 accounts | ~$20/mo **flat** | ~$124/mo |
     | 100 accounts | ~$20/mo **flat** | ~$495/mo |
     | per extra account | **≈ $0** | $4.95/mo |
     The per-account marginal cost is ~zero until we exceed one terminal's daily throughput —
     then we add a second container, not a subscription. ⚠️ Throughput is currently
     **unquantified** because cycle time is uninstrumented; D-32 fixes that and is the input to
     any future revisit.
   - **Credential custody is the decisive non-price factor and it points the same way.** A managed
     provider means a third party holds customers' broker investor passwords — a GDPR
     sub-processor whose blast radius is every MT5 user at once. Quantalyze sells verified track
     records to allocators; this surfaces in diligence. Self-hosting keeps it in our own store.
   - ⚠️ Useful even though we are not buying: MetaApi bills **6 hours minimum per server start**,
     so a wizard validation there would cost ~$0.144 a click — rate-limiting interactive
     validation is sound design regardless of provider.
   - ⛔ **API2Trade: do not use** for anything holding credentials — domain created 2026-04-13,
     no Wayback history, ~5h of status-page history, yet claims "10,000+ Active Accounts", two
     different legal entities named across the site, mail-forwarding address in the Imprint.
   - **Revisit trigger** (not a task): if we ever need *interactive* MT5 at a rate that saturates
     one terminal, or if a second replica is proposed (which breaks the one-session invariant —
     D-33), re-open this with real cycle-time data in hand.
   - ⚠️ **Interacts with Phase 153 WIZFORM-05:** the 30 s wall is *also* a real timeout inversion
     (`initialize()` unbounded at its 60 s vendor default inside a 30 s rpyc bound — D-24), but
     fixing the timeout on a one-account architecture buys a working single user, not a working
     product. Decide the architecture before sizing the budget.

0.4 **⛔ PHASE 153.6 — PARITY: the fixes that only landed on one path (✅ SHIPPED 2026-08-12 as PR #675, v0.58.0.0 — residual above).**
   Raised by `/code-review xhigh` over the whole 153→153.5 span (40 agents, 29 verified findings
   → 13 distinct defects). **Nine come here**; two were fixed unplanned in the same session; two
   are deliberately out. Full charter in `.planning/ROADMAP.md` under *Phase 153.6*.
   ⭐ **The shape is "the fix landed once, not twice."** Three of the four root causes are the
   same failure — a correct remedy applied to one path while its duplicate went untouched, with
   no guard asserting the two agree. Found *inside the span whose own charter said "fix it at
   the SINK, not three times"*. Close each cluster by making the two paths **unable to diverge
   again**, not with N patches.
   | Cluster | What |
   |---|---|
   | **A** (3) | `services/ingestion/mt5.py` never got 153.3's `routers/exchange.py` fixes: the `order_check` short-circuit (without it `_WRONG_SERVER_TOKENS` turns an operator refusal into a 400 accusing the user's BROKER SERVER — the exact documented incident), the broad materialization catch (an unscrubbed rpyc raise is a credential-disclosure surface, T-134-01), and a bare `RuntimeError` documented PERMANENT that the worker actually **RETRIES** via `classify_exception`'s unknown fall-through |
   | **B** (3) | broad `except`s re-absorbing `Mt5SessionAbandoned` upstream of D-42's classify arms: one mislabels a fence incident as a gateway fault that never happened; one 503s it into the **mt5-gateway breaker**; plus `restart()` check 2 raising inside `_timed`, emitting the stage event check 1 was placed outside `_timed` to avoid |
   | **C** (1) | `connectAbortDeadlineMsFor` sized against the branch table's **closed**-breaker column when the governing one is **failing** (175 500 vs 165 000 ms serialized) → CR-01's "nothing was saved" lie is reachable again ~10.5 s before the route finishes writing. ⛔ **Two halves — the number AND the oracle**, which pins the wrong column and so cannot red on it |
   | **D** (1) | 🔒 **SECURITY, LIVE ON PROD.** `REVOKE UPDATE ON api_keys` is bypassable by DELETE + re-INSERT (`authenticated` keeps INSERT/DELETE; the browser already holds the server-minted ciphertext), and that same client-writable `exchange` is the sole authority for skipping finalize-wizard's ASVS V4 scope probe. ⚠️ SELF-targeted control bypass, **not** a tenant leak. The migration is on `main` and `supabase/migrations/**` auto-applies to PROD. ⛔ Needs a design decision, not a patch |
   | **E** (1) | a probe parse miss moved off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE`, removing Retry for a condition a rolling deploy produces. Here rather than ad-hoc because error codes ripple into 153.1's pinned tables (re-cut, never delete) |
   📌 **OUT (decided):** MT5 as a **composite member** — 153.4's CR-03 fix made an MT5 composite
   panel reachable for the first time and `run_stitch_composite_job` has no `mt5` arm, so it
   permanently `_stamp_failed`s the job. That is a **product decision** (teach the worker MT5, or
   block MT5 in the composite wizard), natural neighbour **Phase 155**. Also out: the epoch never
   re-binds (`_assert_live` binds on first touch only, so one `Mt5Client` serves exactly one
   lease) — no production path does this, all five lease blocks ast-verified, and 153.5 already
   pinned the constraint naming its future fix (rebind on lease entry).

0.5 **✅ PHASE 153.5 COMPLETE 2026-08-11 — the abandoned-`to_thread` class (three review findings, ONE defect).**
   Raised by the `/code-review high` of Phase 153.3 (2026-08-09, 10 findings reported, 4 fixed
   immediately). **CLOSED: 5/5 plans, verification passed 22/22 must-haves.** The fence is TWO
   mechanisms (D-36 as amended) — a `terminal_key`-keyed epoch registry fencing method calls, and
   a lease-occupancy `ContextVar` fencing construction, since a method-level fence cannot reach
   finding #6 (the zombie sits inside `__init__`'s blocking connect with no method to guard).
   Preconditioned on routing the three raw `async with _mt5_terminal_lock_for(...)` acquisitions
   through the lease — **including finding #5's own path**, without which a bump in the lease
   `finally` would have left the headline finding open with every test green.
   ⚠️ **Two limits ACCEPTED, in code not just docs:** the fence cannot un-send an rpyc call already
   dispatched on the wire (`sync_request_timeout` is client-side only), and a construction
   *completing* between the `wait_for` firing and the bump still leaks one socket — narrowed, not
   closed. ⚠️ Its follow-on review findings are booked as **Phase 153.6** (item 0.4 above).
   Historical charter lives in `.planning/ROADMAP.md`
   § *Phase 153.5*; context at
   `.planning/phases/153.5-wizform-abandon-work-that-outlives-its-timeout/153.5-CONTEXT.md`.
   This entry is the backlog mirror of that charter, not the reminder that it is unplanned.
   **The one defect:** work handed to `asyncio.to_thread` **outlives its `asyncio.wait_for`**. The
   `wait_for` raises, the caller unwinds and releases the terminal lease, and the abandoned thread
   keeps driving the same process-global MT5 session. Three faces, all in the 153.3 diff:
   📌 **Anchors are SYMBOLS, not line numbers** — the original 153.3-era citations rotted (#6 and
   #7 were off by ~30 and ~130 lines; #5 still held). Line hints are `as of 2026-08-11` only:
   **if a hint disagrees with its symbol, the symbol wins.**
   | # | Site (symbol anchor; line hint as of 2026-08-11) | Symptom |
   |---|---|---|
   | 5 | `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)` (~L118) | `_mt5_bounded_restart` abandons at 10s; the one permitted `mt5.shutdown()` can fire **after** the lease is released, under the next holder |
   | 6 | `routers/exchange.py` › `_validate_mt5_key_probe` › nested `_connect_and_probe`, **STAGE 1 — connect** (~L513) (+ `services/ingestion/mt5.py` › `Mt5Adapter.validate`, the `wait_for(to_thread(_build_client))` inside the lease, ~L207) | connect-stage timeout orphans an `Mt5Client` the thread then constructs — `client` was never assigned, so the Pitfall-6 `finally` releases nothing and the rpyc session leaks |
   | 7 | `routers/exchange.py` › `_validate_mt5_key_probe` — **THE ONE END-TO-END DEADLINE (D-03)**, `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)` (~L817) | the end-to-end deadline fires; the abandoned probe keeps issuing rpyc calls, so D-29's serialization does not hold on the timeout path |
   ⭐ **Fix it at the SINK, once — not three times.** Patching three call sites is precisely the
   instance-not-class mistake this milestone has paid for sixteen times, and #5/#6/#7 are the same
   mechanism. Candidate designs (needs a real decision, do NOT let a fixer improvise):
   a cancellation-aware wrapper; a generation/epoch counter the terminal checks before each call;
   or refusing to release the lease until the worker thread confirms it has stopped.
   ⚠️ **The AST lease-roster CANNOT see this** — its enclosure proof is *lexical*, so it reads the
   `shutdown` as inside `async with` and passes while the runtime escapes. Any fix needs a
   **runtime** assertion (observe the abandoned thread touching the session after release), not a
   second static pin. Guard #16 of the phase lives here.
   **Deferred to Phase 155 (needs the real latency data D-32 just made collectable — do NOT guess
   these numbers):** finding #8, the 60s per-stage ceiling wraps SIX round-trips whose own ceilings
   are 45 000ms IPC / 55s rpyc, so "innermost fires first" holds per round-trip but not per stage
   (re-censors exactly the slow-but-working login D-24 unblocked); and finding #10, the 20s
   interactive lease wait is smaller than the worker's 40s read + 10s restart hold, so an
   interactive validate can never wait out one in-flight derive.

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

### Phase 153.3 (WIZFORM-GW) — recorded residuals (added 2026-08-09)

- [x] **✅ RESOLVED 2026-08-09 by plan 153.3-06 (D-35) — the WORKER path no longer calls
  `mt5.shutdown()` on the SHARED gateway session.**
  Plan 153.3-03 (D-30) took `shutdown()` off the **request** path: `routers/exchange.py`'s
  `_validate_mt5_key` calls `Mt5Client.release()` (transport close only) in its `finally`, so a
  validate no longer tears the IPC pipe down under a concurrent caller (`-10004` — the mechanism
  item 0 above describes). Recorded here as remaining: `services/exchange.py:924-938`
  (`aclose_exchange`'s mt5 arm) and `services/ingestion/mt5.py:~337`. An ast scan found a **third**
  (`routers/exchange.py`) — three callers through **two** `shutdown()` call nodes.
  **Plan 153.3-06 closed the class AT THE SINK:** `Mt5Client.close()` no longer calls
  `mt5.shutdown()` at all, so all three callers are fixed with **zero call-site edits** (neither
  worker site could be fixed at its own site anyway — both run in a `finally` outside the lease,
  so leasing them would mean queueing inside an error path to buy permission to do something
  destructive). `close()` still releases our own rpyc socket. The knowingly-temporary
  `test_close_alone_still_calls_shutdown_exactly_once` pin was **re-cut**, not deleted, as
  `test_close_alone_never_reaches_shutdown` (`shutdown_calls == 0`, D-35 named in its docstring);
  the eight "the session never leaks" assertions in `tests/test_ingestion_mt5.py` were re-pointed
  to the transport-close observable. A new `shutdown()` call site anywhere in `analytics-service`
  now reds `tests/test_mt5_shutdown_roster.py`, which derives the roster from source (ast) with a
  vacuity floor and self-tests — nobody has to hand-edit a list.

  ⚠️ **The ONE residual that genuinely remains — cross-REPLICA.** The surviving teardown is
  `Mt5Client.restart()`'s (the deliberate heal of a wedged pipe, MT5CONC-01). It is safe because
  every call site holds the terminal lease — but that lease is an `asyncio.Lock`, which is
  **single-event-loop** and serializes **nothing across replicas**: two analytics replicas own two
  registries and two Lock objects. That is precisely why **D-33** pins the gateway to a SINGLE
  replica (runbook `docs/runbooks/mt5-go-live.md` Step 1 + the `[ ] SCALE` gate-check row, plan
  153.3-05). ⛔ **A scale-up is a correctness change, not a capacity knob** — it needs a durable
  cross-process serializer first. **Owner: D-33.**

- [ ] **GSD `gsd-sdk query state.*` verbs take NAMED flags, not positional args — the executor
  prompt documents positional.** Found 2026-08-09 during plan 153.3-05's state update.
  `state.record-session "" "<stopped-at>" "None"` silently records only `Last Date` and drops the
  stopped-at; `state.record-metric` and `state.add-decision` return `{"error": …}` on positional
  argv. Correct forms: `--stopped-at/--resume-file`, `--phase/--plan/--duration/--tasks/--files`,
  `--summary`. ⚠️ Also: **every** SDK write to `.planning/STATE.md` REGRESSES the frontmatter
  `last_activity` to a stale value (observed: `2026-08-09 -- Phase 153.3 wave 4 complete` →
  `2026-08-07 -- Phase 152 execution started`, three times in a row). Repaired in place each time.
  Same defect family as the `### Decisions` heading drift already annotated in `STATE.md`.
  ⚠️ `state.record-metric` is also NOT idempotent — running it twice appends a duplicate row.

### Phase 153.7 review + verification — findings routed onward (added 2026-08-14)

The 153.7 fix round closed WR-01, WR-02, WR-03, W-153.7-1 (with a real guard, not a note),
W-153.7-2 and W-153.7-4 in code. The three below are recorded rather than fixed, each for a
stated reason. ⛔ Neither of the first two is a 153.7 regression — both are pre-existing and are
listed now only because 153.7 is what made them reachable or re-read them.

- [ ] **`ROSTER-DERIVE-01` — the two key-step rosters are still HAND-TYPED, and the class fix has
  no owner until this line does.** `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and
  `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are hand-maintained allow-lists. Their own
  docblock used to assign the derived-roster class fix to *"Phase 153 / WIZFORM-02"* — which is
  now **ticked COMPLETE** (`REQUIREMENTS.md`), so that pointer named a closed requirement and the
  fix was ownerless. **This item is that owner**; both docblocks now cite it by name.
  ⭐ **WHAT CHANGED IN THE MEANTIME, so this is no longer a silent hazard.** 153.7's verifier
  MEASURED that deleting `"SEAM_INTERNAL_FAULT",` from either roster left the whole suite green
  while the wizard rendered `UNKNOWN` **with a Retry control** against `retryable=False` faults —
  the 2026-08-05 `SERVICE_UNREACHABLE` incident shape. The 153.7 fix round closed that with
  `[153.7 review W-153.7-1]` in `wizardErrors.invariant.test.ts`: the classifier-reachable
  population is derived (cascade literals by source scan + the LIVE `VENUE_WIRE_CODE_TO_VERDICT`)
  and checked against each roster under the translate-first admission rule. **A missing roster row
  now reds CI by name.** So what remains is DUPLICATION, not exposure.
  What is blocked: nothing ships wrong today. What unblocks it: deriving both rosters from the
  route contract instead of typing them, so the guard has nothing left to catch.
  ⚠️ **The obvious shortcut is wrong and is written down so it is not re-attempted:** merging the
  two rosters. They are separate on purpose (`ConnectKeyStep`'s docblock argues it at length — a
  step admits the codes ITS route emits, not the whole vocabulary), and a merged set would pass the
  guard while admitting each route's codes at the other.

- [ ] **`W-153.7-3` (pre-existing, low) — coverage-law row 1 enumerates exactly THREE Next route
  files, which is narrower than the phase goal's wording.** `ROUTES` in
  `wizardErrors.invariant.test.ts` still lists `create-with-key`, `composite/add-key` and
  `finalize-wizard`, and matches only literal `NextResponse.json({ code: "X" }, { status })` sites.
  **Six** of our own Next routes mint `code: "UNAUTHENTICATED"` in TypeScript (named in the
  UNAUTHENTICATED exemption row) and sit outside any derived population.
  153.7's declared scope was the PYTHON half plus the four `missing` items — all discharged — so
  this is out of scope rather than skipped. It is recorded because it **bounds the literal claim**
  *"every code that can reach a user-facing surface"*: that claim is true of the analytics-service
  vocabulary and not yet of the Next-minted one.
  What is blocked: nothing user-facing. What unblocks it: extend `ROUTES` to the Next routes that
  mint codes, or state the boundary in the file's docblock the way `EXPECTED_EMITTED_CODES` now
  states its exclusions — ⛔ the one thing that must not happen is the claim staying broader than
  the mechanism.

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

7. **Doc defects in the 153 records (non-blocking, logged per the founder stopping rule).**
   (a) `REQUIREMENTS.md:1366` claims `ConnectKeyStep`/`MultiKeyConnectStep` "still pass neither"
   `surface` nor `venue`; at HEAD both pass `surface: "connect"` **and** `venue`, and the row
   directly beneath at `:1368` says so — two adjacent rows contradict. WIZFORM-03 is closed
   *further* than its own record admits. (b) `ROADMAP.md` Phase 153's success-criteria list is
   misnumbered — it runs 1, 2, 3, **5**, 4, **5**, so "SC5" is ambiguous in any report.
   (c) `REQUIREMENTS.md:1434` rollup reads "153 WIZFORM-01..04 + MT5-14", omitting WIZFORM-05.

---

## 🟡 FIX MID-TERM

### ✅ DECIDED + SHIPPED — should the measure ladder have a px cap at all? (raised 2026-08-09, DECIDED 2026-08-09, closed 2026-08-10)
Founder report, with screenshots: *"zooming out should allow me to see more of the
content… it should never produce dead/empty areas."*

**⭐ FOUNDER CHOSE (B): the founder's rule wins for DATA surfaces only.** Dense tables
go fluid (`max-w-full`, **no px ceiling**) and reveal columns as the viewport grows;
prose and forms keep 1100px, where a bounded measure is a genuine readability control
rather than decoration. Rung 3 of DESIGN.md's ladder is therefore FLUID, not 1920px.
Per Rule 7 the conflict was surfaced and one side picked — it was **not** blended into
a compromise cap. (The alternatives weighed were (A) keep the ladder and accept the
dead space, and (C) drop caps everywhere including prose; both were rejected.)

**Landed in:** `ecb7140a` (the `/my-strategies` instance) → `0f4dd69f` (the general
rule: `DashboardChrome`'s `isWide` shell becomes `max-w-full` and gains
`my-strategies`; the page-level `max-w-[1920px]` caps on `/my-strategies`,
`/allocations` (+loading), `/compare` (+loading) and `/discovery/[slug]` are deleted so
the shell is the sole owner) → **153.2 review WR-02** (the two surviving
`max-w-[1440px]` caps on `/allocations`' Scenario tab — `ScenarioComposer` and its
`AllocationsTabs` skeleton — which had kept the founder's reported symptom alive on
that tab, plus DESIGN.md's rule restated with its real scope and its one carve-out
named).

**Recorded in:** DESIGN.md's measure-ladder section and its 2026-08-09 decision-log row.

⚠️ **Two statements in the previous version of this item were false at HEAD** and are
corrected above rather than left to be re-litigated: *"The general principle is NOT
fixed"* (it was decided the same day) and *"It now gets the 1920px dense-table measure
it earns"* (there is no 1920px measure any more — `/my-strategies` is fluid).

**Carve-out, so it is inherited rather than rediscovered:** the four `/admin` prose
pages (`users`, `users/[id]`, `partner-import`, `for-quants-leads`) keep `max-w-[1100px]`.
They live under the `isWide` `/admin` prefix for navigation reasons, but the ladder
governs by CONTENT TYPE, and their content is prose/forms — rung 1.

### Money-path correctness (latent / flag-gated / edge cases)
- ~~**Unified-backbone CSV-finalize breaks if flag on**~~ — **CLOSED 2026-08-17 (Phase 145
  SC#1, verdict CANNOT REPRODUCE)**. Of this bullet's own two remedies, **"forward JWT"
  shipped in Phase 19.1** (2026-05-27; verified at HEAD: `route.ts:1324` forwards
  `X-User-Access-Token`, `process_key.py:1135` reads it and builds the user-scoped client);
  "skip unified for finalize" was not taken, and the flag concept itself was later deleted
  (zero runtime readers at HEAD). Live confirmation + census:
  `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md` (four arms, all
  GREEN; PROD's 18 csv orphans are all incident-era fossils predating the fix). The 42501
  GUARD stays live and is now pinned by a permanent CI gate
  (`supabase/tests/test_csv_finalize_auth_guard.sql`).
- **Backbone-bypass parity surfaces** — `_compute_portfolio_analytics` (routers/portfolio.py:632)
  and `equity_reconstruction.py` run independent Sharpe/TWR stacks; frontend TS
  (`portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) and matching
  (`match.py`) compute bespoke annualization/Sharpe. Parity-gated but real divergence risk —
  absorb into the unified backbone.
- **Deribit `correction` residual** — a capital-reason row carrying a trading token and no
  capital word still classifies as trading P&L. Tighten the word-boundary classifier.
- **Worker orphaned-`running` purge: DELETE vs reset** (founder decision at FLIP) — same
  migration; TEST wants DELETE, PROD wants reset (a sustained >4h outage would lose live
  jobs). Window already widened 2h→4h.

### Reliability / observability
- **No cron migration in the repo has EVER asserted `cron.job.username`/`database`** (found
  2026-08-19 by the RLS audit of Phase 146.2's R3 migration; INHERITED gap, not introduced —
  logged as a CLASS fix, deliberately not point-fixed into `20260819150000`).
  `cron.job.username` defaults to `current_user` **at `cron.schedule` time**, so re-registration
  is precisely the operation that re-derives a job's privilege. Every cron self-verify in this
  repo reads `command` + `schedule` and never `username`/`database`/`active`. Two undetectable
  drift paths, both requiring a non-`postgres` applier:
  (a) a different superuser (e.g. `supabase_admin`) → the body silently runs with superuser
  rights thereafter, and the `count(*) = 1` gate still passes;
  (b) a non-BYPASSRLS applier → pg_cron's stock `cron.job` RLS (`USING (username = current_user)`)
  HIDES the postgres-owned row → `IF EXISTS` is false → no unschedule → the unique index on
  `(jobname, username)` permits a **SECOND** row → the sweep fires twice hourly (per-tick radius
  25 → 50). ⚠️ **The `v_count <> 1` guard is RLS-BLIND to this and would read 1 and pass green.**
  **Measured 2026-08-19:** owner is `postgres` on both PROD and TEST, so neither path is currently
  reachable via the normal merge pipeline — this is hardening, not a live break.
  **Fix:** add `username = 'postgres'` + `database = current_database()` equality assertions to
  the STEP-2 self-verify of every cron-registering migration going forward, with a
  consequence-naming message. Evidence of the ratified owner: `20260816140000:375`.
- **The readmit ceiling is SILENT at exactly the moment it gives up** (found 2026-08-19 by the
  RLS audit of Phase 146.2 R3; the fix's own new blind spot). At the ceiling the sweep inserts
  nothing → no `compute_jobs` row → no `{"source":"reconcile-sweep"}` metadata → the worker-side
  capture at `analytics-service/main_worker.py:754` never fires. **The alert is keyed on the
  HEAL**, so the transition from "recovering hourly" to "abandoned for ~90 days" emits NO signal,
  and the strategy's owner has no user surface for it. Not a leak and not a data-integrity
  defect — filed against Rule 12 (fail loud). **Founder decision needed:** body-side audit row on
  exhaustion vs. an external exhaustion query/alert. ⚠️ Interacts with the 90-day retention wall,
  which DELETES the marker rows that ARE the counter — so the bound is "3 per retention window",
  and a strategy can silently resume cycling after ~90d with no notification at either edge.
- **Phase-19 hourly cron never decommissioned** (PR-D) — soak gate passed, cron still running.
- **Match-engine cron health check missing** — no `/api/cron/health-check` route; match-engine
  cron failures are invisible (silent data staleness).
- ~~**Rate limiting only on 6 routes**~~ — **CLOSED 2026-08-18** (Phase 146 / RATE-01):
  stale since at latest audit-2026-05-07. Every route this bullet named
  (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`,
  `admin/partner-import`, `trades/upload`, `intro`) is verified LIMITED at HEAD
  `70a8918d`; `admin/match/eval` (the one real remaining gap) gained its limiter
  in the same phase. The authoritative census — route × limiter × value × key
  shape, fresh-derived twice — is `.planning/phases/146-rate/146-AUDIT.md` §1,
  which replaces this list.
- **Cron/email idempotency & budget** — founder-LP cron double-email if lambda dies post-Resend
  (idempotency row on `(cron_name, year_month)`); founder-LP 85s worst-case > 60s maxDuration;
  Resend webhook svix-id idempotency store; email correlation-id fragmentation (per-email not
  per-batch); email retry false-alarm on UNIQUE(23505).
- [ ] Circuit-breaker state/ops dashboard (observability depth; from archived v1.16 v2-requirements).
- [ ] Job-queue depth + age metrics (observability depth; from archived v1.16 v2-requirements).
- [ ] Adaptive/load-aware rate limiting driven by the breaker signal (from archived v1.16 v2-requirements).

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
- **VCR cassette over-redaction** — misses token/hmac/digest/nonce (and over-matches
  signal/signedAt/pubkey); replace with per-broker allowlist.

### CI / test-infra ratchet
- **CI speed/flake (founder 2026-08-05, watched python at 20min/12%) — 4TH MECHANISM FOUND: a WEDGED PostgREST pool.** All-day 504s on TEST (every CI cluster: 07:45, ~11:00, 18:0x, 19:2x) were PGRST003 while Postgres sat at 14/60 connections nearly idle and the same DELETE ran instantly via direct SQL — PostgREST's own pool slots were leaked/wedged after the morning's 2,144-job backlog connection storm, and the state persists until PostgREST's connections are recycled. REMEDY (proven 2026-08-05): `select pg_terminate_backend(pid) from pg_stat_activity where application_name='postgrest' and backend_type='client backend'` → PostgREST rebuilds the pool → instant 200s. Contributing causes booked: python + e2e-seeded run CONCURRENTLY (workflow `needs:` sequencing fix); daily backlog (purged 2,144 `derive-dailies-%` pending, cron untouched). Real fix (Phase 144, owner): per-run isolated DB. Also: e2e-seeded's seed should FAIL FAST with a "PostgREST wedged?" hint on PGRST003 rather than burning the run.
- 44 live-DB vitest files + ~112 python tests are green-skipped in CI while migrations
  auto-apply to prod.
- Shared test-DB sql/e2e race (fence flake); Railway analytics deploys skip silently on red
  main CI (verify `commitHash` + `/health`); `repro-key-flow.sh` Layer-A leak gate is a CI
  no-op; `cassette-refresh.yml` failed 17/17 with no alerting.
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

  **UPDATE 2026-08-08 (founder, with screenshots of the MT5 mobile flow):**
  - **(a) is CLOSED** — delivered by **MT5-03**: the per-venue `passphraseSecret` flag renders
    MT5's slot as `type="text"` (`ConnectKeyStep.tsx:739`) while OKX stays masked. The line
    number in the paragraph above is stale (`:696` → `:739`).
  - **(b) is now specified, as TWO levels**, matching how the MT5 app actually behaves:
    **level 1 = broker family** (e.g. `VantageMarkets`), showing brokers this user/allocator has
    connected before; **level 2 = every server in that family** (`VantageMarkets-Live 5`,
    `-Live 19`, `-Live 14`, `-Live 3`, `-Live 6`, `-Live 4`, `VantageMarkets-Live`). Typing an
    exact server name is cumbersome and error-prone; a picker removes a whole error class.
  - ⛔ **The real blocker for level 1 is a STORAGE shortcut, not a missing API.** The broker
    server flows into the OKX passphrase slot and is persisted in `api_keys.passphrase_encrypted`
    (`exchange.py:234` states the rationale: *"No new columns"*). A broker server name is public
    information, so encrypting it buys nothing and costs the ability to render a history without
    decrypting secrets. **Fix = a plain `mt5_server` column**; that makes level 1 trivial.
  - **Level 2 direction — REVISED 2026-08-08 after the platform research came back. The founder's
    "just download and store it" is RIGHT in substance but must change its SOURCE.**
    - ⛔ **Auto-syncing MetaQuotes' directory is OUT.** The broker/server list is only obtainable
      inside a terminal; `config/servers.dat` is **binary and undocumented**, and MQL5 warns that
      third-party parsing may violate MetaQuotes' ToS. There is no endpoint and no API. So the
      "our own terminal already has it" idea — mine, 2026-08-08 — does **not** survive: the file
      is there, but reading it is not a route we should take.
    - ✅ **Curating from broker-published pages is IN, and is ToS-clean.** Server names are
      **public** — brokers document them (Vantage publishes its `VantageMarkets-Live N` set).
      Seed a small `broker → servers[]` table by hand for the brokers we actually support,
      refresh rarely, free-text escape hatch for anything unseeded. Hand-curated, not synced.
    - Net: the two-level picker is still achievable and still worth it; it is a **content**
      problem (curate a short list) rather than an **integration** problem.
  - **Not in Phase 153.** 153 deletes an error class and is already 25 files; a server picker is
    a new surface. Needs its own requirement + UI-SPEC.

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

### Tech-debt / maintainability (opportunistic, don't force)

- **The two wizard connect surfaces keep TWO hand-maintained `EXCHANGES` rosters (added 2026-08-11,
  153.4 review CR-03).** `ConnectKeyStep.tsx` and `MultiKeyConnectStep.tsx` each hold a private
  option table, justified by a "State-A neutrality over DRY" docblock. The composite copy fell an
  entire venue behind — no MT5 card, `MT5_UI_ENABLED` not even imported — so a draft-carried MT5
  member panel POSTed `passphrase: null`, dropping the broker server, and rendered no field to
  re-enter it. **Fixed pointwise** (the card + the four third-field overrides are now in the
  composite roster) **and fenced** (`MultiKeyConnectStep.test.tsx` "[CR-03] … THE CLASS GUARD"
  compares both surfaces' rendered exchange cards with both flags ON). ⭐ The CLASS fix is one
  shared option table both steps import — a THIRD module, which the neutrality argument does not
  forbid (it forbids `ConnectKeyStep` growing an export). Do it the next time a venue is added.

- **⭐ AUDIT METHOD + two more unfalsifiable guards (2026-08-09).** Phase 153 found **14** guards
  that could not fail. The method that finds them, in order of cost:
  1. **Grep triage** on six smells: literal-vs-literal · fixture sized off the constant under test ·
     matcher-driven sweep with no positive control · derived roster with no vacuity floor ·
     assertion on absence with no proof the detector works · self-referential oracle.
  2. **Check provenance** — do both sides of the assertion trace to the SAME definition? If yes it
     is a tautology wearing a check's clothes.
  3. **Mutation decides.** Grep only nominates. Break what the guard claims to protect; no red = decorative.
  4. ⭐ **Read the comment as a suspect, not a witness.** 3 of the 14 carried comments asserting
     precisely the capability they lacked. A confident comment over a weak assertion is a signal.
  ⭐ **Highest yield: guards over a CROSS-FILE coupling** (budget↔breaker, roster↔emitter,
  definition↔restatement). Same-file assertions are usually honest; cross-file ones go stale.
  **Scope recommendation:** sweep the money-path and security guards only (`seam-*`, `closed-sets`,
  RLS, `analytics-service/services/`). A mutation pass over 10 000 tests costs more than it returns.

  - **#13 `src/__tests__/scenario-commit-rls.test.ts:971` — a tautology.** `HAS_FULL_LIVE` is
    DEFINED at `:169` as `HAS_LIVE_DB && HAS_BASE_URL && HAS_ANON_KEY`, and `:971` asserts it
    equals that same expression re-evaluated in the same file. Its comment claims it catches
    "e.g. inverts `HAS_BASE_URL`" — inverting it changes BOTH sides identically, so it stays green.
    All three flags come from env vars, so CI (all false) gives `false === false` and a configured
    env (all true) gives `true === true`. It can only red in a mixed state neither environment
    produces. **Fix:** assert the gating BEHAVIOUR (that the suite skips) or delete it.
  - **#14 `grep -c "if (code === "` is a BLIND gate — and the orchestrator authored it.** Used
    across several 153.1 executor prompts as evidence that a fix was class-level rather than
    instance-level ("arm count unchanged at 3"). It is a single-line pattern; `wizardErrors.ts`
    has **six** multi-line arms (`if (` alone on `:2330 :2357 :2373 :2383 :2743 :2789`) that it
    structurally cannot see. Same blindness class as D-34's fourteen `error`-first emitters.
    **The sound invariant is `grep -c "applyFixRequirements("` → 2** (declaration + the one call).
    ⚠️ Lesson: a prose/regex gate in a PROMPT is exactly as falsifiable as one in a test, and
    nobody mutation-tests a prompt. Prefer an invariant a test can hold.
  - **#15 An innocence proof that could not fail — in 153.1's OWN paperwork.** ✅ corrected
    2026-08-09 by the 153.1 verifier. `ROADMAP.md:353` absolved 153.1 of the red
    `seam-citations` gate on the strength of an empty `git diff aff52516..HEAD`. But
    `aff52516` is a 153.1-05 **docs** commit dated AFTER every source edit in 153.1-03/04/05,
    so that diff was empty **by construction**, whoever caused the citations. The truth is the
    opposite: `git log -S'<citation>'` attributes **all nine** to `712c01a9`/`aeea5455`/
    `3011c659` — 153.1's own commits, two of them added by the CR-01 review fix and recorded
    nowhere. `deferred-items.md` said "PRE-EXISTING", then named 153.1-04 as introducer one
    paragraph later, and counted 7 against a live 9.
    ⚠️ Lesson — **this is the first instance found in a PLANNING LEDGER rather than a test**,
    and it is the highest-leverage location of all: a false exoneration is read by the next
    phase's planner and never re-derived. Same taxonomy row as "guards over a CROSS-FILE
    coupling" — the coupling here is commit-order vs file-content. **Rule: a
    baseline commit used to prove "we didn't cause this" must PREDATE the work, and you must
    show that it does.** Prefer `git log -S` (names the author) over `git diff <base>` (names
    nobody).

- **✅ FIXED 2026-08-09 — the STATE.md "SDK bugs" were OUR schema drift, not the SDK.**
  Founder challenge (*"Probably something we do rather than SDK. Didn't have those problems
  before"*) was correct. Root cause: two customised headings that sit inside SDK match patterns.
  | gsd-sdk matches | we had written | consequence |
  |---|---|---|
  | `/##\s*Session\s*\n/i` | `## Session Continuity` | section never found |
  | `/###?\s*(?:Decisions\|…)\s*\n/i` | `### Decisions (requirements-time, …)` | every decision dropped |
  Both verbs **fail silently** — they return `"No session fields found"` / `"Decisions section not
  found"` as data, and nothing checks the string. That is why it went unnoticed for months.
  ⭐ **The `stopped_at` "regression" was a two-sources-of-truth bug.** `stopped_at` lives in YAML
  frontmatter **and** as `**Stopped At:**` in the body, and the SDK rebuilds frontmatter FROM the
  body. With the section unmatched the two floated free; we only ever updated frontmatter, so the
  body copy had been stale since `9e990a90`. Three executors "restoring an accurate value" each
  reconciled against that stale copy in good faith — one fact, two homes, one unmaintained.
  **Fix:** headings renamed to `## Session` / `### Decisions` with load-bearing comments naming
  the exact regex that depends on each. Verified end-to-end: `record-session` → `recorded: true`
  (was `false`), `add-decision` → `added: true` (was an error string), frontmatter ↔ body in sync.
  ⚠️ **Lesson worth keeping:** the first fix attempt put the explanatory comment INSIDE the
  Session block, and because the comment contained the literal `**Last Date:**` markers the SDK's
  regex matched **the comment instead of the data**. Same class as `EMITTER_RE` matching
  commented-out code. Keep prose out of a machine-parsed block. The verb bumps
  `completed_plans` but rewrites `stopped_at` to an older/pre-wave value, silently discarding the
  most recent progress note. Both executors caught it in their own diff and restored an accurate
  string rather than committing the regression — but an executor that did *not* diff-check would
  have committed a ledger that lies about where the run stopped, which is exactly what a resume
  reads. ⚠️ `STATE.md` is the file `/gsd-autonomous` and every resume path trusts.
  **Interim:** always `git diff .planning/STATE.md` before committing after that verb runs.
  **Fix:** make the verb merge rather than overwrite, or stop it touching `stopped_at` at all —
  progress counters and the human-readable stop note are different concerns.
- **149 review IN-01:** `MyStrategiesSection.tsx` comment claims namespaced prefs persistence, but with no `userId` the prefs hook is a persistence no-op on that surface — fix the comment (or pass userId if prefs are wanted there).
- **149 review IN-02:** `getOwnRowPercentiles` fully computes `publishedMap` only for its key-count; name the future consumer or reduce to a count.
- God-files: `queries.ts` (3,205 lines), `job_worker.run_sync_trades_job` (688 lines),
  `portfolio.py` (2,423), `exchange.py` (2,777).
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

  ⛔ **FALSE AS WRITTEN — corrected 2026-08-14.** `docs/architecture/` contains **18 ADRs** (`adr-0001` … `adr-0024`), and `REQUIREMENTS.md:1001-1002` cites ADR-0001/ADR-0003 by name. This line is the same ledger-vs-reality class the v1.17 milestone audit was convened over, found by the ADR conflict synthesis. ⭐ What IS true, and is the useful residue: the ADRs are **not all current** — `.planning/INGEST-CONFLICTS.md` records 4 blockers where an ADR contradicts HEAD.
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

- **⚠️ CORRECTED root cause — the `python` red was NOT a straddle; it was a fastapi 0.139 harness incompatibility (FIXED, commit `b3686767`).** `test_validate_key_venue_transient.py` failed all 14 venue-transient cases in CI ("no `/api/validate-key`/`/api/verify-strategy` route on `main.app`") on EVERY cut, and it did NOT self-resolve at the tip — my earlier "23/23 at the tip" was a false read from running the file **in isolation on a local fastapi 0.135.1** (flat routes). Real cause: fastapi **0.139.0** (deps bump #592) made `include_router()` lazy — multi-route sub-routers become a single `_IncludedRouter` placeholder in `app.routes` (routing still works; TestClient reaches every endpoint), so the harness' FLAT `main.app.routes` scan missed the exchange/portfolio routes. Reproduced authoritatively under the exact CI env (Python 3.12.13, fastapi 0.139.0, starlette 0.46.2 via a `uv` venv). Fix descends through `_IncludedRouter.original_router` (correct on both the pre-0.139 flat and 0.139+ lazy shapes). **Consequence to note honestly:** PR2–PR5 were merged on the belief this was a self-resolving straddle — it was not, so `main`'s `python` CI (and thus the Railway worker deploy, which gates on green CI) stayed red from PR2 until this fix. `sql-tests` DID straddle (red 140.1–140.3, green from 140.4).
- **Genuinely separate, still-open: the `MultiKeyConnectStep` WIZ-02 frontend test-isolation flake** (44/44 in isolation, order/shard-sensitive) — did NOT hit PR6's `frontend-test` shard; left as tracked test-hygiene, fix if it reddens a future shard.
- **✅ RESOLVED — `e2e-seeded` red on `main` after the v1.16 ship (`discovery-hide-examples-default.spec.ts:122`, DISCO-05).** NOT a product regression: the spec waited for a "No strategies" empty-state row, silently assuming the `crypto-sma` category held zero non-example published rows — false in the shared test DB (`qmnijlgmdhviwzwfyzlc`), which accumulates other specs' seed data. Fixed (PR #654, merge `4f45dcab`) by gating on the "Hide examples" checkbox reaching `checked=true` (bound `checked={!showExamples}`, flips in the same render that applies the `is_example` filter) instead of a global empty-state, then asserting zero `SEED_NAMES` (polled). Verified: e2e-seeded PASSED against the live polluted DB. ⭐Lesson: e2e specs on the shared DB must assert their OWN seed invariant, never a global DB state. See memory `project_e2e_seeded_shared_db_pollution_global_emptystate`.

### v1.16 carried-forward residuals — 140.3 / 140.4 `gaps_found` (added 2026-07-30)

Both phases SHIPPED to main (PR #651 / #652) with their VERIFICATION marked `gaps_found`; the named residuals below were accepted as tracked tech-debt (per the founder blast-radius bar). **Two are user-facing** and are candidates to fold into a 140.3/140.4 gap-closure pass before or alongside Phase 141 — founder decision owed at 141 kickoff.

- **✅ RESOLVED 2026-07-31 — SEAMUX-03 typed `{code}` envelope.** Closed via gap series G4–G9 (branch `feat/v1.16-141-jobs-rate-retry`). Class-map found **10** bare routes, not the 9 the VERIFICATION named — it missed `admin/strategy-review` (instance-not-class). All 16 seam-importing routes now carry a `code:` on every reachable route-emitted arm (csv-validate was already wire-coded via `csvErrorBody` — audit-only). Opus verifier PASSED: 817/817 tests, RED-on-neuter confirmed on 4 routes, `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. **Remaining non-blocking residual:** 2 `rateLimitDenyJson` deny bodies stay codeless — `verify-strategy` (route.ts:71) and `scenario/optimize` (route.ts:163) — because SEAMRIM-05 tests pin their exact codeless bodies; it's the rate-limiter boundary (our throttle / Upstash-misconfig, NOT the analytics seam), low blast radius (teaser has no discriminating client; scenario's 429 is a pre-existing no-Retry-After contract). One-line follow-up if ever wanted: give them `throttledBody`/`misconfiguredBody` codes + update the SEAMRIM-05 pins. Also still open (out of this gap's scope): the poll-disjointness pin (test-hygiene) and the SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual — 140.3-VERIFICATION.md overall stays `gaps_found` for those two.
- **✅ RESOLVED (was flagged user-facing) — SEAM_MISCONFIGURED→UNKNOWN on the two wizard clients** (140.4). Re-verified against current code **2026-07-31**: the translate-first hop IS present — `ConnectKeyStep.tsx:496` and `MultiKeyConnectStep.tsx:829` both call `recogniseSeamErrorCode(seamErrorCode(data))` before the `KNOWN_*_CODES` membership check, and the docblocks (`ConnectKeyStep.tsx:220-243`) document `SEAM_MISCONFIGURED` handling via the translation. The 140.4-VERIFICATION.md gap was **stale** (fix landed after it was written). No action owed.

### v1.16 Phase-141 / 141.1 (SEAM / SEAMBACKOFF) — deferred items (added 2026-07-31)

**This section discharges G4** — the obligation that Phase 141 have a deferrals section at all, which every prior v1.16 phase had and 141 did not. All items below are **non-blocking** by the founder blast-radius bar (nothing here is user-facing or data-integrity); they are recorded so the canonical backlog owns them, not scheduled. Verdicts, one per 141 obligation — the other four are closed **in place** rather than restated here, so the original text stays where a reader will look for it:

- **G1** — TS-35 W-4 `recoverable` rider (annotated in the 141–146 review-depth table above): **DISCHARGED**. The re-derivation is that the rider's premise is false — `recoverable` never became a retry input.
- **G2** — LO-02 / TS-39 `decodeBreakerLock` unbounded span (annotated on its own row above): **DISCHARGED** in code at `f308b460`, exactly as prescribed.
- **G3** — the `handleRetrySync` "unreachable today" parenthetical (annotated in the 140.5 section above): **DISCHARGED** by correction — 141 shipped that path, so the statement is now the opposite of what it said.
- **G4** — Phase 141 has no deferrals section: **DISCHARGED** by this section's existence.
- **G5** — `141-REVIEW.md` untracked: **DISCHARGED** already, at `2e36016d`. **No action owed**; recorded only so the enumeration is complete.

**Bucket H — recorded, deliberately NOT fixed** (from `141-REVIEW-CONSOLIDATED.md`; each re-verified against HEAD on 2026-07-31 before being written here):

- **H1 — a seam retry double-consumes the PYTHON-side per-tenant limiter, during exactly the incidents it fires in.** The retry is a second HTTP request to the analytics service, so it burns a second token from *that* service's limiter: `/optimize-weights` is `20/minute` per tenant and `/process-key` is `100/hour` tenant / `30/hour` anon under a `500/hour` platform ceiling (values read from the routers, not inherited). The Vercel-side limiter is **not** doubled — it is checked once per user request, before the handler. Net user-visible risk: during upstream degradation a tenant can hit "rate limited" for a fault that is not theirs. Worth a recorded decision (accept, or exempt retries from the Python limiter); not a defect today.
- **H3 — `admittedAtMs` is captured ONCE, outside the retry loop.** Confirmed at HEAD (captured well above the `for (let attempt …)` header). Attempt 2's failure is therefore judged against a pre-loop admission instant and cannot re-arm a just-expired lock. **Know it; don't fix it** — the miss is fail-open, which is this module's doctrine per A-25, and the founder's stance on it is explicit.
- **H4 — `keys/sync` forwards the upstream status verbatim where the legacy contract promised `'syncing'`, and 200 where it promised 202.** Confirmed: the `WIZARD_DUPLICATE` branch emits `status: typeof upstream.status === "string" ? upstream.status : "syncing"`, so a `'draft'` upstream status reaches a caller documented to receive `'syncing'`. Nobody reads it today — no client branches on that field on this route.
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
7. **DEF-141.2-03-A — stale route coordinates inside a skipped test's comment.** `src/__tests__/audit-coverage.test.ts:962-964` cites three `flag-monitor/route.ts:NN` coordinates, one of them a "feature_flags upsert — kill-switch flip" site Phase 106 (Stage B) retired. Already stale before 141.2 and inside an `it.skip(...)` comment rather than an assertion, so nothing reds and plan 03's edits shifted the numbers further. Comment-only drift, below the bar. Booked here because `deferred-items.md` is a per-phase scratch file and this file is the one backlog.
8. **`Boolean()` does NOT byte-agree with Python's `bool()` for empty JSON collections — the docblock says it does.** Found by the ship red-team pass. `seam-retry-registry.ts` `retriesForFlow` gates on `Boolean(context?.wizard_session_id)` and its docblock claims "the same truthiness predicate the Python gate uses" (`process_key.py`'s `bool(body.context.get("wizard_session_id"))`). True for `null` / `undefined` / `""` / `0` / `false` — the empty-string case it explicitly names is genuinely correct. **False for `[]` and `{}`**: truthy in JS, falsy in Python. A context carrying `wizard_session_id: []` would grant the retry TS-side while Python falls to `… or str(uuid.uuid4())`, mints a fresh session per attempt, skips the duplicate pre-check, and inserts a second draft `strategy_verifications` row — the exact harm D-03 withdrew resync's grant over. **Unreachable at HEAD**, which is why it is logged and not fixed: `retriesForFlow` short-circuits to 0 for every flow but `onboard`, and `onboard`-through-`postProcessKey` has one producer (`finalize-wizard`), whose context is a hand-listed allowlist of validated scalars plus a `wizardSessionId` read off a uuid DB column. Fix when touched: `typeof context?.wizard_session_id === "string" && context.wizard_session_id.length > 0`. Founder call 2026-08-01: ship as-is, the surface is well tested. *Re-raise if:* a second `onboard` producer appears, or any context field stops being an allowlisted scalar.
9. **`hasContractualWait`'s docblock contradicts itself on the HTTP-date form.** `resilient-fetch.ts` states "A date-form wait is a contractual wait like any other and fails fast; there is no deliberate gap here to work around" two lines after correctly noting that no `Date` header yields null. `retry-after.ts` returns null when `Date` is absent, so a date-form 503 WITHOUT a `Date` header does not fail fast — it retries. Harmless in practice (HTTP/1.1 origins must send `Date`; our own emitter uses delta-seconds), but the gap is real and the sentence denies it. Prose-only, below the bar.
10. **The denominator's "attempt over attempt" caveats miss a third class.** `flag-monitor/route.ts` names attempts refused above the audit write (429/401) and lost fire-and-forget writes. A seam attempt failing at the TRANSPORT layer (deadline, refused connection) can produce a Sentry event with no audit row in the window — numerator up, denominator flat. Same safe direction as the lost-write caveat, but unnamed.

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

### Phase 149 (NAV-01, `/my-strategies`) — deferred items (added 2026-08-05)

All three were routed out of phase 149 by ruling, not by omission. None is user-blocking: the
surface ships fully functional with each of them open.

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
- [x] ~~IN-01: three route docblocks still claim strategies_update has NO WITH CHECK~~ **CLOSED 2026-08-08** (/ship review round, D6): all three re-based onto 20260410225610_sec005_follow_ups.sql:102-106; the `.eq("user_id")` predicates kept and re-justified as defence-in-depth. — stale since 20260410225610; migration rev-3 corrected its own copy, routes didn't.
- [ ] IN-02: allocation route lacks the archived-status gate the marked-set query enforces (query-side filter only).
- [x] ~~IN-03: mid-request mark flip surfaces as 500/UNKNOWN~~ **CLOSED 2026-08-08** (/ship review round, E4-E6): allocation route maps 23514 -> 409 `not_allocatable`; AllocateDialog decodes it via the new `ALLOCATION_NOT_ALLOCATABLE` envelope and no longer offers a Retry the server will refuse forever. instead of the 409 arm (no row refresh) — race window only.
- [ ] IN-04: MarkOwnershipDialog "Keep own capital" stays clickable while destructive removal is in flight.
- [x] ~~(verifier INFO) finalize-wizard/route.ts:1339-1342 carries the same stale no-WITH-CHECK claim~~ **CLOSED 2026-08-08** with IN-01 (symbol-anchored there, since that file is on the SEAMPROSE-01 surface that bans bare file:line). as IN-01's route docblocks — fix together.
- [x] ~~(verifier INFO) MigrationWizard.tsx:72-76 surfaces raw psError.message~~ **CLOSED 2026-08-08** (/ship review round): both call sites now map to curated copy; driver text goes to console.error only. Copy also corrected so it no longer asserts a DB state the error object cannot prove, nor instructs a re-submit that would double-write the append-only `allocation_events` ledger. — give it the W-6 23514→honest-copy mapping AddToPortfolio got. Reachable only for an owner migrating their own unmarked published strategy.
- [ ] (WR-02 fix note) `bg-card` is a dead class — no `--color-card` token in globals.css @theme; 7 files repo-wide render transparent notice backgrounds. One cleanup pass wanted.
- [ ] (/code-review high, lens 3+5) The stale "strategies_update has NO WITH CHECK" claim also lives in src/app/api/strategies/finalize-wizard/route.test.ts:76-77 and :2996-2997, and ownership/name route docblocks — fix together with IN-01 using the migration rev-3 framing (defence-in-depth, cite 20260410225610).
- [ ] (/code-review high, lens 5) HoldingsTable.tsx D-15 comment cites StrategyTable.tsx:1067-1085; the precedent now lives at :1169-1179 — cite by phrase not line number.
- [x] ~~(/code-review high, lens 5, low-confidence) strategies-row-adapter.ts Half-2 comment~~ **RESOLVED 2026-08-08**: kept `manager: s.codename ?? null` and reworded the comment. Half 1 resolves `organization_name ?? codename ?? null` and an owner's own strategy has a null org, so half 1 lands on the codename too; dropping half 2 to null would make one strategy render "—" while unallocated and its codename once money sits behind it. Cross-half agreement now pinned by test. says "honest — rather than a fabricated manager" but code sets manager: s.codename ?? null — codename-present path renders own codename in the manager column and is untested; decide intended behavior and pin it.

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
- [ ] **IN-08** Role-discriminator degradation on a failed `strategy_keys`/`strategies` read re-admits manager keys as book constituents (`queries.ts:3868-3898`) — fail-open vs fail-closed decision; today's blast radius is the founder's own account only.
- [ ] **IN-09** `key={displayed}` remounts the dollar input on Enter, dropping focus (`ScenarioComposer.tsx:5804`) — keyboard-flow polish.
- [ ] **WR-08 residual** `MT5_ENABLED=false` does not stop the preflight's RPyC connect — `Mt5Client.__init__` opens the connection before the kill-switch is consulted; a true pre-connect gate changes disabled-path semantics of two job kinds, deferred deliberately.

### Phase 152 (SCEN composer legibility) — deferred residuals (added 2026-08-07)

- [ ] **Pitfall 6 — a stale persisted draft's factsheet link can 404.** The SCEN-03 row-detail panel emits `href="/factsheet/{id}"` for every added strategy. The link resolves under OWN-02's two-lane access control for the viewer's OWN strategies and for currently-PUBLISHED third-party ones — but a draft persisted weeks ago can still name a third-party strategy that has since been archived or deleted, and that link dead-ends on `notFound()`. Detecting it would require a per-row existence fetch, which Phase 152's CONTEXT explicitly locks out (the panel is an in-memory projection with no loading and no failure state by construction). Acceptance was scoped accordingly. Revisit if/when the composer gains a draft-reconciliation pass — the right fix is to prune or mark unresolvable rows at draft load, not to fetch per row at render.
- [ ] **D-1 residual — same-day own-row duplicates stay indistinguishable in Browse.** The SCEN-05 disambiguation line is `Created {Mon D, YYYY} · {Status}`; the key-count segment was omitted entirely (D-1) because `created_at` alone resolves the founder's real case (two "Alpha Centauri" rows 15 days apart) and a key count costs a second query on the browse path. Two own rows with the same name created on the SAME day therefore render identical lines. Revisit only if the founder treats key count as load-bearing for the choice — the amendment is a wire field plus a segment, not a redesign.

### Phase 152 (SCEN) — code-review Info findings, logged per stopping rule (added 2026-08-07)

- [ ] **IN-01** `isOwn` breaks the browse wire's snake_case convention (route emits snake_case elsewhere) — cosmetic wire-style inconsistency, rename = coordinated schema+client change, not worth it standalone.
- [ ] **IN-02** Five elements share `data-testid="scenario-added-header-label"` — fine for the count assertions today; per-label testids would make header tests sharper.
- [ ] **IN-03** Header labels sit ~8px right of the numbers they label (gap-2 offset accumulation) — visual polish; founder-eyes call.
- [ ] **IN-05** Dedup date renders in the viewer's local timezone — could show "Aug 3" for a UTC "Aug 4" creation; consider pinning UTC if it ever confuses.
- [ ] **IN-06** Detail panel repeats the provenance badge and pushes the row's own state notes below its hairline — layout polish for design-review.
- [ ] **IN-07** Row-wide pointer amplification collapses the panel on incidental clicks (e.g. selecting text in the row) — interaction polish; founder-eyes call.

### Phase 151/152 UAT fix round — deliberately deferred halves (added 2026-08-08)

- [x] ~~**F-3 wizard-UI half: render the `capital_ownership_persisted: false` sidecar.**~~ **CLOSED 2026-08-08** (/ship review round, E8): `SubmitStep.tsx` reads the flag with a strict `=== false` and renders a non-blocking `role="status"` notice naming the My Strategies remedy; because `onSubmitted` navigates, the id is held in state and `Continue` completes the hand-off. Two controls pin that an absent/true field renders nothing. The unified (manager) arm now emits the same sidecar, so one contract covers both arms. ORIGINAL ITEM: The finalize-wizard route now returns a non-error sidecar in its 200 body when the capital-mark UPDATE fails or matches no row (fixed 2026-08-08 — the server had Sentry'd it but reported plain success, so a user who answered "my own capital" silently got an unmarked, non-allocatable strategy and only discovered it days later as a missing `Allocate…` affordance). **Nothing consumes the flag yet.** `SubmitStep.tsx` reads the 200 body then calls `onSubmitted(data.strategy_id)`; surfacing the warning means threading a fourth piece of state through `onSubmitted` → `WizardClient` → the success screen, which is wizard restructuring beyond the "ship a warning string" bound the founder set for this round. Fix: thread the flag to the success screen and render one line — "We couldn't save your capital answer — set it from My Strategies" — pointing at the Mark dialog. The server half and its regression tests (failure arms + the omitted-on-success control) are already landed.
- [x] ~~**Bottom-up AUM cold start: the USD cell is not yet the entry point when AUM is UNSET.**~~ **CLOSED 2026-08-08** (/ship review round, finding [8]): the em-dash guard is now `(scenarioAum <= 0 && !bottomUpAum)`, so in blank mode the row renders a real input and the first amount typed becomes the portfolio. The em-dash stays correct in BOOK mode, where the figure genuinely cannot exist before custody answers. ORIGINAL ITEM: 151 UAT item 1 landed bottom-up edit semantics for blank mode (editing a row's dollars resizes the portfolio and holds the other rows' dollars fixed). But when `scenarioAum <= 0` the row still renders 151-UI-SPEC §2's honest em-dash + "Set portfolio AUM to size in dollars" and there is NO input to type into — so the "the USD input is THE entry point on which weight is built" framing only becomes live once an AUM exists by some other route. The arithmetic already handles the cold case correctly (all other dollars are 0, so AUM' = the typed amount); what is missing is an editable empty cell and its copy, which replaces a deliberately-designed, test-pinned honest-absence state. Needs a founder copy call for that cell before implementing.

### Phase 151/152 `/ship` review round — deferred residuals (added 2026-08-08)

Context: a `/code-review high` (32 agents) plus 7 specialists + 3 red-team passes produced
48 findings across three fix rounds. 23 CRITICAL and all warnings were fixed. What follows
is what was deliberately NOT fixed, with the reason. Two red-team rounds each found that a
previous round's *remedy* had created a new defect — so the items below were left alone on
purpose, not by omission.

**Founder calls (the first one is the significant one):**

- [ ] **⭐ `size_at_decision_usd` is recorded on a NOTIONAL basis while the composer sizes on an EQUITY basis.** The composer computes each row as `weight × scenarioAum`, where `scenarioAum` is now equity (Σ `holdingEquityContribution`, which uses `unrealized_pnl_usd` for derivatives). The commit route records `percent × serverAumUsd`, where that is Σ `value_usd` — notional. On a leveraged derivatives book the two diverge by roughly the leverage factor **on every row**, and `route.ts:~842` documents `size_at_decision_usd` as the denominator a downstream daily-delta cron divides realized PnL by. **The founder's own production book is Deribit, i.e. exactly this case.** Not changed because moving the sized figure is a money decision with a downstream consumer that may live outside this repo. The audit row now at least carries `client_manual_aum_usd` on every row plus a `server_aum_manual_conflict` sentinel, so the divergence is forensically visible rather than silent. **Decide before the next mandate commit on a derivatives book.**
- [ ] **No UI path removes a manual AUM override.** `setManualAum(undefined)` has no production caller. Once a manual Portfolio AUM is set, clearing the field and blurring re-displays the committed value — the draft still holds it. The refusal copy was corrected so it no longer *instructs* the impossible ("Clear the field instead to leave it unset" is gone), but the capability gap stands. The mechanism is available (`aumTouchedRef` separates a clear-to-revert from a bare blur on an empty field, proven by mutation), and a test is already positioned to go red the day it is built. Deferred because it is a behaviour change on a seam that produced three regressions in one session, in service of a LOW finding. Supersedes Phase-151 IN-02 with the mechanism now known.
- [ ] **HoldingsTable's Weight denominator lives only in a `title`.** `<StrategySortableHeader label="Weight" title="share of allocated capital" />` — hover-only, invisible on touch and to sighted keyboard users, inconsistently announced. The D-12-B denominator is stated nowhere else on the table (only inside the AllocateDialog modal). Fix is visible text (a second-line caption in the mono micro-label voice, or a table footnote) — a layout/taste call.
- [ ] **The Portfolio AUM form label uses the mono data-eyebrow voice.** DESIGN.md's typography section names this exact inversion as the failure mode ("the mono on a form label reads like a value"). Needs either a move to DM Sans medium or an explicit DESIGN.md amendment blessing mono on composer form labels.
- [ ] **The Portfolio AUM input is 12px type in a ~26px control.** iOS focus-zooms any input under 16px, and DESIGN.md wants ~44px touch targets; every shared input primitive carries `min-h-[44px]`. It matches the composer's existing dense number strip, so this is a class decision — either bump this field or record the dense strip as an accepted exception, noting it now covers a money entry point rather than only fine-tuning controls.

**Repo-wide sweeps:**

- [ ] **~20 files still use `focus-visible:ring-accent/20` or `/50` without `ring-inset`.** A 20%-alpha accent ring is ~1.3:1 against the surface, far under WCAG 1.4.11's 3:1 floor. Four surfaces were fixed this round (AllocateDialog's money input and its "Remove allocation" button, StrategyTable's ghost row actions, FactsheetView's masthead Rename). The rest remain: **`ui/Button.tsx:35` and `ui/Modal.tsx:33`** (shared primitives mounted by every dialog — the Modal close button is icon-only, so its ring is also its entire keyboard affordance), plus `ui/Input.tsx`, `ui/Select.tsx`, `ui/Textarea.tsx`, the `mandate/*` family, `ApiKeyForm.tsx`, `RenameStrategyDialog.tsx`, `MatchQueueIndex.tsx` and several wizard steps. Most have a border or background so the ring is not the sole affordance, but the 1.4.11 argument is identical. ⚠️ `AllocateDialog.test.tsx`'s focus sweep carves the two primitives out **by identity** and asserts the exempted set still carries `ring-accent/50` — so it goes RED the day they are fixed. That is the signal to delete the carve-out.
- [ ] **`job_worker.py:~7183`'s transient arm hardcodes `error_kind="transient"`** and never walks the `raise … from exc` chain, so a classification lost at a call site is unrecoverable by design. This round's fix prevents the specific downgrade (a geo-block being retried forever against a host that will never answer); it does not make that arm defensive.

**Smaller residuals:**

- [ ] A permanent DERIVATIVE-only failure discards the day's healthy spot rows, so Holdings shows the previous `asof` (stale, not wrong) under a "Sync failed" pill. Kept deliberately: restoring "permanent ⇒ partial success" needs a second hand-tuned axis, which is the exact mechanism that produced the regression being repaired — and it is wrong for Deribit, where spot is deferred so the derivative arm *is* the whole book.
- [ ] A partial-book commit can still trip `server_aum_manual_conflict`: the client narrows its AUM to the contributing keys' toggled-on holdings while the server sums the allocator's whole book. That is a key-SET difference, not a basis error (the basis was fixed); closing it needs the key set on the request.
- [ ] Two stale comments at `ScenarioComposer.tsx:~3806` and `~3943` enumerate a drawdown-USD-scaling consumer of `liveHoldingsSum` that was actually deleted in Phase 38-03.
- [ ] `phase-150-capital-ownership-invariant.test.ts`'s header docblock still says P2 pins "EXACTLY the sanctioned three" writers; the test now sanctions five (the CI demo seed was added).
- [ ] The geo-block's operator-actionable text ("move region or proxy") no longer reaches `api_keys.sync_error` — by design, since that column is end-user copy. It stays in `compute_jobs.last_error`, the audit metadata and the log/Sentry chain. Confirm that is where ops actually looks.

**Found at land time (2026-08-08), not by any review:**

- [ ] **⭐ Stale `file:line` citations live in SOURCE files too, and one class is invisible to any path-based guard.** Found 2026-08-08 while repairing the ledgers. Confirmed stale in shipped code: `src/lib/process-key-onboard-contract.ts:116` cites `process_key.py:680-690` (emitter is now :717-750); `analytics-service/routers/exchange.py:152` cites `wizardErrors.ts:936-1035` (`classifyKeyValidationError` is now :1927-2110); `analytics-service/docs/STATUS_CONTRACT.md:379` cites `routers/internal.py:442`/`:471` (now :488/:517). ⚠️ **The nastiest one is SELF-RELATIVE:** `analytics-service/services/broker_dailies.py:552`'s docstring cites `combine_native_ledger` **(:174)** when it is at **:268** — a coordinate pointing *inside its own file*, which no path-resolving checker would ever flag because there is no path to resolve. Any citation gate must therefore handle bare `:NNN` and same-file references, not just `path:NNN`.
- [ ] **`file:line` citations across `.planning/REQUIREMENTS.md` and `ROADMAP.md` rot silently, and nothing catches it.** ✅ **BOTH LEDGERS REPAIRED 2026-08-08** — ROADMAP: 50 audited / 38 renumbered / 8 anchored / 0 undeterminable. REQUIREMENTS: 91 audited / 60 renumbered / 29 anchored / 2 deliberately left (both are quotations of coordinates *inside another document*, pinned to named commits where the drift IS the argument). Verified: 101 requirement IDs + checkbox states byte-identical, headings identical, independent drift audit 0 problems. **The gate itself is still unbuilt** — that is what remains open below. Audited all **109** distinct code citations on 2026-08-08. Cheap tests found little (1 missing file — `extension.py:506` in ROADMAP.md; 0 out-of-range), because an out-of-range check is far too weak: a citation can be *in range* and still point at unrelated code, which is exactly what WIZFORM-02's `:345` did. A symbol-anchored content check found **~13 high-confidence drifts**, several large: `wizardErrors.ts:967 → classifyKeyValidationError` actually at **:1927** (+960), `allocator_positions.py:154 → _fetch_spot_rows` at **:418**, `ScenarioComposer.tsx:2180 → addedStrategyMetadataLookup` at **:2486**, `wizardErrors.ts:1728 → EXCHANGE_PROBE_FAILED` (symbol no longer in that file at all). **Only the WIZFORM-01..05 + MT5-14 citations were repaired** (phase 153 is about to consume them); the rest stand. ⚠️ **A bare filename is itself the bug in one case: `exchange.py` is ambiguous** — `routers/exchange.py` and `services/exchange.py` both exist and only `routers/` holds `_MT5_PROBE_TIMEOUT_S` / `_validate_mt5_key`. Two candidate fixes: (a) a CI gate that resolves every `path:line` in the ledgers and fails on drift — needs symbol anchoring to be meaningful, and generic anchors (`href`, `ValueError`, `UNKNOWN`, `idempotent`) must be excluded or it is pure noise; (b) drop line numbers from the ledgers entirely in favour of symbol names, which do not rot. Cost of leaving it: every planner and executor that trusts a citation walks to the wrong code, and the reader cannot tell a stale pointer from a correct one without re-deriving.

- [ ] **No gate catches an `e2e/` assertion whose copy no longer exists in `src/`.** Phase 150-03 renamed the MetadataStep heading and updated its own component test; two e2e specs kept waiting 15s for the dead string and only one of them reddened (the other is seed-gated and did not run). Ten specialist review passes, a red team, and 10,193 local tests all missed it, because the phase's own grep never left `src/`. A gate is buildable — extract literals from `getByRole(name:)` / `getByText` / `getByLabel` in `e2e/` and fail when one is absent from `src/` — but a naive version has ~6 false positives today (composed date ranges like `"2026-01-05 → 2026-01-09"`, seeded fixture names like `"E2E Test Key"`, and chart headings built at runtime), so it needs an allowlist to be useful rather than noisy. Same family as the v1.10 lesson that e2e grep-gates scan `src/` only.

### Phase 153.1-02 — deferred open questions from the venue-capability foundation (added 2026-08-09)

Both are explicitly OUT OF SCOPE for phase 153 (RESEARCH §Open Questions Q2 and Q5); logged here so the decision is visible rather than implied by a default.

- [ ] **Should sFOX also opt out of the submit-time scope probe?** `VENUE_CAPABILITIES.sfox` (`src/lib/closed-sets.ts`) asserts NO capability at all, so sFOX's submit path is byte-unchanged — that is D-22, pinned by `closed-sets.test.ts`'s *"sFOX asserts NO capability at all"* assertion. The question stands because sFOX asserts `read_only=True` **structurally** for the same reason MT5 does (`_validate_sfox_key`: the SfoxClient adapter has no order/withdraw/transfer surface, and sFOX exposes no per-key scope endpoint) — the same argument that earned MT5 `scopeProbeSupported: false`. What is unknown: whether the ccxt permissions probe currently *succeeds* for sFOX or has been silently failing on every sFOX submit. ⚠️ This is a SECURITY decision (the scope-broadening probe is ASVS V4) — do not flip it as a tidy-up; measure the probe's current behaviour against a live sFOX key first. Owner: unassigned. Reference: 153.1 D-22, RESEARCH Q2.
- [ ] **`Validating…` (U+2026) at `CsvUploadStep.tsx:751` is the odd one out.** The four other live sites use ASCII `Validating...` (`ConnectKeyStep.tsx:782`, `MultiKeyConnectStep.tsx:1637`, `ApiKeyForm.tsx:199`, `StrategyForm.tsx:356`), and ASCII is the **recorded superseding decision** (`MultiKeyConnectStep.test.tsx:19-21` states it supersedes the UI-SPEC's typographic form). D-21 settles the spelling; a repo-wide copy sweep to apply it is not in phase 153's scope. ⚠️ Before changing any of these strings, grep `e2e/` — `e2e/api-key-flow.spec.ts:212` matches on the prefix regex `/Validating/i` and survives either form, but that is luck, not a guarantee for the next one. Owner: unassigned. Reference: 153.1 D-21, RESEARCH Q5.

### Phase 153.4-03 (the long-wait card) — non-blocking findings, logged per the stopping rule (added 2026-08-10)

Both are recorded rather than fixed: neither is user-facing today and neither is a
data-integrity risk, so both sit below the founder stopping rule. Each is a conflict the
plan resolved by SURFACING it (Rule 7), not by blending.

- [ ] **`ui/Button.tsx:35` cannot be given a full-opacity focus ring by a caller.** It
  hard-codes `focus-visible:ring-2 focus-visible:ring-accent/50` on EVERY variant, and
  `cn` (`src/lib/utils.ts:72`) is a plain `filter(Boolean).join(" ")` — **not**
  tailwind-merge — so a `className` passed in does not override the baked-in utility; it
  merely appends a second, losing declaration. Consequence for this phase: the UI-SPEC
  specifies `Button variant="ghost" size="sm"` for `Stop waiting`, but forbidden item #9
  forbids a `/50` ring on a control this phase creates, so `ValidateWaitCard` renders a
  plain `<button type="button">` carrying the ghost look plus the verbatim focus
  contract. ⚠️ Fixing `Button.tsx` is a CROSS-SUITE change, not a one-line edit:
  `AllocateDialog.test.tsx`'s focus sweep carves `ui/Button.tsx` and `ui/Modal.tsx` out
  **by identity** and asserts they still carry `ring-accent/50`, so the fix reds an
  unrelated suite and the carve-out must be deleted in the same commit. Same item as the
  repo-wide `~20 files still use ring-accent/20 or /50` sweep above — this entry records
  the *mechanism* (plain-join `cn`) that makes the two primitives un-overridable rather
  than merely unfixed. Owner: the focus sweep.
- [ ] **The UI-SPEC's queue-disclosure sentence names `MetaTrader` literally while its
  render condition is the class-shaped `serialized` capability.** Copy (UI-SPEC Surface 1,
  40% rung, shipped verbatim in `ValidateWaitCard.tsx`): *"Still signing in. MetaTrader
  allows one sign-in at a time, so your check may be waiting behind another."* The gate is
  `venueIsSerialized(exchange)` — correctly a class check, so a second serialized venue
  would render this line automatically **and would read wrong**, naming a broker the user
  is not connected to. Not fixed here because the remedy is a copy decision, not a code
  one (`{VenueName} allows one sign-in at a time` loses the concrete, recognisable noun
  that makes the sentence land for the only venue that has it today), and the copy table
  is 153.1's. ⚠️ The trigger is not hypothetical-forever: it fires the day any second
  venue gets `VENUE_CAPABILITIES.<venue>.serialized = true`. Whoever adds that row owns
  this sentence. Owner: unassigned; reference 153.4-03, UI-SPEC Surface 1.

### Phase 153.4-04 (the connect step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [ ] **`ui/Button.tsx` accepts no `ref`, so a caller cannot move focus to a shared
  button.** `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`, which carries
  no `ref`, and the component is a plain function — so `<Button ref={…}>` is a compile
  error (measured 2026-08-11: `TS2322: Property 'ref' does not exist on type
  'IntrinsicAttributes & ButtonProps'`). React 19 passes `ref` as an ordinary prop, so the
  fix is one optional prop spread through `...props`; the reason it was not taken here is
  the SAME cross-suite carve-out recorded in the 153.4-03 `Button.tsx` item above
  (`AllocateDialog.test.tsx` asserts that component by identity), plus this phase's
  UI-SPEC ⛔ on editing `Button.tsx`. Consequence today: `ConnectKeyStep`'s cancel path
  holds a ref on the submit ROW and queries `button[type="submit"]` inside it to restore
  focus — correct and asserted, but indirection a `ref` prop would delete. Bundle this
  with the focus-ring sweep; both edits land in the same file. Owner: the focus sweep.
- [ ] **`e2e/api-key-flow.spec.ts:41` expects 401 for an Origin-less POST and the route
  answers 403 — a pre-existing spec drift, not a regression.** Measured 2026-08-11 against
  a local dev server: `POST /api/keys/validate-and-encrypt` with no `Origin` header →
  **403**; the identical request WITH `Origin: http://localhost:3000` → **401**
  `{"error":"Unauthorized"}`, exactly what the spec asserts. `withAuth`
  (`src/lib/api/withAuth.ts:53`) runs `assertSameOrigin` BEFORE authenticating on every
  mutating method, so a Playwright `request`-fixture POST is refused as cross-origin
  before auth is ever consulted. Two cases fail on this (`…returns 401 for
  unauthenticated request`, `…rejects request with missing fields`). ⚠️ The remedy is to
  add an `Origin` header to those requests, NOT to relax the CSRF guard — and the same
  trap is already recorded for the verify-strategy probes. Found while running this
  phase's e2e gate; out of scope (no file this plan touches is involved). Owner:
  unassigned. Reference: 153.4-04 verification.

### Phase 153.4-05 (the composite step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [x] ~~`MultiKeyConnectStep`'s `EXCHANGES` array has no MT5 card, so a serialized venue
  reaches a composite member panel only sideways~~ **CLOSED 2026-08-11** by the 153.4 review
  fix round (CR-03): the MT5 card and its four third-field overrides are in the composite
  roster, and a class guard compares both surfaces' rendered exchange cards with both flags
  ON. ⛔ This entry contradicted its own file for a day — the fix was recorded under
  *Tech-debt / maintainability* ("The two wizard connect surfaces keep TWO hand-maintained
  `EXCHANGES` rosters") while this one still called the defect "Reachable in production".
  ONE entry now: the tech-debt one, which carries the residual (the CLASS fix is a shared
  option table both steps import).
- [ ] **The composite step's `Loading your saved keys…` banner is the file's one remaining
  U+2026.** D-21 settles the busy label as ASCII and this plan added no new typographic
  ellipsis, but the rehydrate banner (a different surface, untouched here) still carries
  one — as does `CsvUploadStep.tsx:751`. Fold into the repo-wide ellipsis sweep already
  logged under 153.4-03. Owner: that sweep.

### Phase 153.4 code review — the findings the fix round consciously did NOT fix (added 2026-08-11)

⚠️ **Logged late, and that is the point.** The stopping rule blocks only on user-facing or
data-integrity defects; everything else gets **logged instead**. The 153.4 fix round closed
4 criticals + 2 warnings and then recorded the other eight findings nowhere — they survived
only in `.planning/phases/153.4-*/153.4-REVIEW.md`. The verifier escalated that as F-4. The
bargain has two halves; this section is the second one. Source: `153.4-REVIEW.md`.

- [x] ~~WR-04 — `ConnectKeyStep`'s 300 ms mount gate can fire AFTER the request finished~~
  **FIXED 2026-08-11.** The gate was a macrotask cleared only by the timer effect's cleanup,
  which React commits at its own priority, so a sub-300 ms answer could leave a ghost card
  frozen at `0s` whose `Stop waiting` aborted a ref the `finally` had already nulled. Was
  logged here as *user-facing* — the one of the eight that did not qualify for logging-only.
  The gate now self-guards on a `waitStartedAtRef`; the regression case drives the ordering
  and was observed to red without it.
- [ ] **WR-05 — `validatePanel` dereferences `panelsRef.current[idx]` with no guard**, while
  its neighbour `handleStopWaiting` opens with `if (!p) return;`. `panelsRef` lags state by
  one commit, so a click landing between a removal and the sync throws a `TypeError` out of
  an unawaited async callback. **Non-blocking:** a one-commit ref-sync window nobody has hit.
  ⭐ Wider than the review reported — `requestRemove` has the same unguarded shape, so fix the
  CLASS (every `panelsRef.current[idx]` read in this file), not the one line. Owner: unassigned.
- [ ] **IN-01 — the composite wait card mounts at ~1 s, the single-key one at exactly 300 ms.**
  The composite gate is `p.waitElapsedMs >= WAIT_CARD_MOUNT_DELAY_MS` and `waitElapsedMs` only
  moves on the 1 s tick. **Non-blocking:** it satisfies the property (never earlier than
  300 ms) and is deliberate, documented "please do not 'fix' it by adding one". Residual is a
  one-line note on the constant that it is a FLOOR at one surface and an exact delay at the
  other. Owner: unassigned.
- [ ] **IN-02 — the abort-grace assertion in `validate-budget.test.ts` is near-tautological**
  (both operands resolve to the same constant, so it restates `WAIT_ABORT_GRACE_MS > 0`).
  **Non-blocking:** the property that actually matters after CR-01 — the client deadline
  exceeds the ROUTE's 158 500 ms worst case — is now pinned separately in the same file, so
  the vacuous line is redundant rather than misleading. Delete it on the next pass through.
  Owner: unassigned.
- [ ] **IN-03 — a backward system-clock step renders a negative elapsed figure** in
  `ValidateWaitCard` (`Math.floor(elapsedMs / 1000)` over a `Date.now()` delta). **Non-blocking:**
  user-visible but requires an NTP correction or a laptop resume mid-wait. `Math.max(0, …)`
  costs nothing and keeps the card's one number honest under the Numbers Contract. Owner:
  unassigned.
- [x] ~~IN-04 — raising the tombstone widened `MAX_BREAKER_LOCK_SPAN_MS` from 90 s to 120 s~~
  **ADDRESSED 2026-08-11 by disclosure**, which is all it needed: the derived widening (and the
  matching loosening of the clock-skew tolerance from the 141.2 review) is now written into the
  tombstone docblock that otherwise enumerates what moves with the constant. Both consequences
  were already acceptable; only their absence from the notes was not.
- [ ] **IN-05 — `handleStopWaiting` can leave a stale `"user"` abort reason with no controller
  to consume it** (the reason is written before the optional `abort()` call, so pressing the
  control in a race with the `finally` records one for nothing). **Non-blocking:** provably
  unread — the next submit clears it. The composite step takes the stricter delete-per-attempt
  shape; matching it removes the question. Owner: unassigned.
### Phase 153.6 (PARITY) — infrastructure findings surfaced while shipping, logged per stopping rule (added 2026-08-12)

- [ ] **P156-IN-01 — the migration chain cannot be replayed from scratch locally** (`supabase start`
  / `supabase db reset` both die at `20260416125432_rebalance_drift_weekly_index.sql` with
  `CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)`;
  **15** migrations under `supabase/migrations/` use `CONCURRENTLY`). **Non-blocking:** CI
  applies SQL tests against the remote TEST project via `psql`, so nothing in the pipeline
  depends on a local replay. **Why it matters anyway:** a migration that auto-applies to PROD
  on merge currently has no from-zero rehearsal environment — the only pre-merge signal is the
  TEST apply against an already-migrated database, which cannot catch ordering/chain defects.
  Discovered 2026-08-11 while trying to certify phase 153.6's `20260811210000`. A fix would
  likely split CONCURRENTLY statements out of the pipelined path. Owner: unassigned.
- [ ] **P156-IN-02 — assertion 5's gate marker has no symmetric post-verify** in
  `20260811210000_api_keys_attested_venue.sql`. Assertion 5 (5a–5e) in
  `supabase/tests/test_api_keys_exchange_not_user_writable.sql` arms on the `20260811210000`
  substring in `api_keys.attested_venue`'s column comment. The migration post-verifies the
  *exchange* marker (check (d)) but has no symmetric check for this one, which gates strictly
  more. **Measured 2026-08-12 (round-3 audit):** dropping the substring COMMITS the migration
  and makes the whole 5a–5e family print `SKIP (5)` — a silent loss of the RPC-door coverage.
  **Non-blocking:** the file carries the marker today and all of 5a–5e were proven to run; the
  realistic way to lose it is a *future* migration re-stamping that comment, at which point
  this file's `$verify$` no longer runs, so a symmetric check would buy little. Guard hygiene.
  Owner: unassigned.

### Phase 154-02 (WIZCONT-01 plumbing) — residual recorded while single-sourcing the draft query (added 2026-08-12)

- [ ] **A THIRD latest-wizard-draft read still lives outside the helper** — `src/app/(dashboard)/strategies/page.tsx:41-49`
  issues the same `source='wizard' AND status='draft' ORDER BY created_at DESC LIMIT 1` read that
  `src/lib/wizard/draft-query.ts` now single-sources for the two wizard entry points, but with a
  different column set (`id, name, created_at, review_note`) for a different consumer: the Resume
  CTA + rejected-draft notice on the strategies list. It could not adopt the helper without widening
  `InitialDraft` with `review_note`/`created_at` for a page outside Phase 154's scope. Consequence:
  the /strategies Resume CTA and the wizard's own resume decision can still drift apart. The
  divergence is NOT silent — `src/__tests__/wizard-draft-query-single-source.test.ts` Scan B pins the
  latest-reader set to exactly these two files, so a THIRD one reddens. Fold it in when the helper
  grows a column-set parameter. Owner: unassigned.

### Phase 154 ship review — non-blocking findings (logged 2026-08-12, founder stopping rule)

Raised by the `/ship` pre-landing + adversarial reviews. The four that met the blast-radius bar
(user-facing or data-integrity) were FIXED in v0.59.0.0 and are not listed here. These did not.

- [ ] **C-2 / A-4 — a rotated venue password re-connect reports success and stores nothing.**
  `create-with-key/route.ts` — the dedup arm returns BEFORE `validateKey`, and keys on the MT5
  login alone; `api_secret`/`passphrase` are never consulted. A user re-running the wizard to
  update a rotated investor password is told the account is already connected, while the stored
  ciphertext still holds the OLD password and the key keeps failing to sync with no signal. Same
  shape for a typo'd password. ⭐ Highest-value of this batch: silent, and it is the ordinary
  "I rotated my credentials" path. Needs a product call — update-in-place, or refuse with copy
  that names the remedy (there is no credential-update UI today; the client UPDATE is revoked).
- [ ] **A-3 — `venue_account_id` is the MT5 login alone, but a login is only unique within a broker
  server.** Two accounts at different brokers sharing a login number collide on
  `(user_id, exchange, venue_account_id)` → wrong-account resolution. Server-qualifying the value
  (`<broker_server>:<login>`, already carried as `passphrase`) closes it. ⚠️ NOT a patch: the column
  is live on PROD, so changing what is stored is a migration decision with a backfill question.
  Not declared anywhere before this review.
- [ ] **Orphaned `api_keys` rows from a deleted composite draft are never swept.**
  `cleanup_abandoned_wizard_drafts.sql:19-24,41-49` cannot see them (the draft row is gone, and the
  keys were never in `strategy_keys`). Found while fixing the composite-draft misclassification;
  the deletion path is now closed, but rows already orphaned in PROD stay orphaned.
- [ ] **C-4 — `sync-progress` picks the strictly-newest job of any kind, with no in-flight
  preference.** A short-circuit `process_key_long` answering `done` in seconds can mask a prior
  chain's `compute_analytics_from_csv` still `running`, suppressing the amber block in exactly the
  state the UI-SPEC says must show it. Bounded by the stall backstop. Changing it means revisiting
  154-04's deliberate two-pass selection.
- [ ] **C-5 — SF-3's keep-last-known now pins `jobStatus`, which is newly load-bearing.**
  Composite-only. If a `stitch_composite` row is DELETEd out from under the client (the
  orphaned-running purge does DELETE in prod), `jobStatus` freezes and `showRecomputing` latches.
  Bounded by the stall backstop.
- [ ] **INFO — the `as unknown as …Args` cast on the scenario-commit RPC suppresses all future type
  checking of that argument object.** `allocator/scenario/commit/route.ts:582-598`. Deliberate: it
  preserves three explicit `null`s that T_R20/T_R24/CR-01 pin by name against a types regeneration
  that made DEFAULT-ed params optional. Cost: a later added or renamed required param compiles
  clean and fails at runtime. Money path.
- [ ] **Two copy-honesty nits in `SyncPreviewStep.tsx`.** (a) the lead paragraph still asserts a
  present-tense exchange fetch under the amber/interrupted blocks, where the identical in-card
  claim was just suppressed as false — gate it on `inFlightClaimIsCurrent` too; (b) with the
  in-flight claim withheld, the status panel can collapse to a bordered box containing only an
  unlabeled number.
- [ ] **Residual: a genuinely-empty account still waits out the patience clock if `/sync-progress`
  is dead or sustained-429.** The zero-history refusal needs positive finished-evidence, which that
  route supplies. Closing this needs a threshold, which Phase 154 bans. Declared, not hidden.
- [ ] **`154-03-TEST-APPLY.md` contradicts itself on whether the SQL gate ran.** §2 records a PASS
  on TEST; §5 records a post-hoc migration amendment and says the seeded cases have NEVER executed;
  `154-VERIFICATION.md` says the gate has not been executed. Honest reading: a pre-amendment
  structural subset ran, the shipped file never has. Correct one of the two records.

### Phase 156 (CONNECT) — the two things this phase deliberately did NOT fix (added 2026-08-13)

Both were raised at planning, decided out of scope there (`156-RESEARCH.md` § "Open Questions" 3 and
4), and are logged here rather than patched in passing. Plan `156-05`'s acceptance asserts BOTH
named files are unmodified by the phase, so neither was quietly half-done.

- [ ] **`p_venue_account_id` has no in-database oracle — Phase 156 closed its REACHABILITY half and
  RESTATED the rest** (added 2026-08-13 by `156-10`; the plan assumed this was already logged and it
  was not). `src/app/api/strategies/create-with-key/route.ts` at the `p_venue_account_id` argument,
  and `create_wizard_strategy`'s `COMMENT ON FUNCTION`
  (`20260814120000_wizard_rpcs_revoke_authenticated.sql:536-550`). ⭐ **What Phase 156 DID close:**
  after Migration B only the server can pass the value at all, so "a browser chose this account id"
  is no longer reachable. ⛔ **What it did NOT close, and cannot:** nothing in the database can ask
  MT5 whether a login is real, so the stored value is *"what the server passed"*, never *"what the
  venue confirmed"* — the same CR-01 class as `p_exchange`, at a narrower scope. An oracle means
  calling the venue, which is an application-tier probe; the MT5 gateway already performs one at
  validate time, so persisting *its verdict* alongside the value is the plausible remedy and needs
  its own decision (it is a migration + backfill question on a column that is live on PROD).
  ⚠️ **Distinct from A-3 above:** A-3 is about this value's *shape* (a login is unique only within a
  broker server); this entry is about its *provenance*. Fixing either does not fix the other.

### Phase 153.7 ship gate — one unnamed vitest flake, recorded rather than lost (added 2026-08-14)

- [ ] **`FLAKE-153.7-01` — the full local vitest suite failed exactly one test once, in parallel
  mode, and I could not name it.** ⚠️ **This is a known-unknown on purpose.** Evidence, in order:
  run 1 (`vitest run`, default parallel) → `Test Files 1 failed | 780 passed | 19 skipped`,
  `Tests 1 failed | 11852 passed`; run 2 (identical command, no code change between) → exit 0;
  run 3 (`vitest run --no-file-parallelism`) → `781 passed | 19 skipped`, `11853 passed`, exit 0.
  Two clean full runs against one failure, so the phase gate is green and Phase 153.7 shipped on it.
  ⛔ **Why this is written down instead of shrugged off:** the failing run's output was not captured,
  so the test has no name. An unnamed flake that fires once locally is the shape that later fires in
  a CI shard and reads as a regression in whatever PR happens to be open — costing a bisect against
  an innocent diff. If a single-test failure appears in a vitest shard and does not reproduce under
  `--no-file-parallelism`, check this entry BEFORE bisecting.
  **What would close it:** capture a failing run (`vitest run > /tmp/run.txt 2>&1` in a loop until
  non-zero) and name the test; then either fix the race or pin the file to `--no-file-parallelism`.
  ⚠️ Local is Node 25, CI is Node 22 — reproduce under
  `PATH=/opt/homebrew/opt/node@22/bin:$PATH` before concluding it is local-only.

### v1.17 milestone-audit residuals — logged per the stopping rule (added 2026-08-14)

- [ ] **`PLANNING-PROJECTREF-01` — the PROD and TEST Supabase project refs are written into tracked
  `.planning/` files, against the standing "never record the PROD project ref in `.planning/`"
  rule.** Found 2026-08-14 by a no-allowlist sweep at the v1.17 close (gitleaks itself: **no leaks
  found** — this is below its threshold, which is why the rule exists separately). Occurrences
  include `REQUIREMENTS.md:910,1433`, `STATE.md:1336`, `TODOS.md:584,1477,1554,1641`.
  ⭐ **Assess the actual exposure before spending effort:** a Supabase project ref is the subdomain
  of `NEXT_PUBLIC_SUPABASE_URL` and therefore ships in every browser bundle already — it is not a
  credential and redacting it buys no security. The real issue is that a stated rule and the repo
  state disagree, and an unenforced rule teaches people to ignore the enforced ones.
  **Decide one way:** either scrub + add a CI grep, or amend the rule to name refs as non-secret
  and keep the prohibition for keys/JWTs/connection strings only. ⛔ Do NOT half-do it.

### Branch & worktree adjudication, 2026-08-14 — four survivors with real unmerged work

Context: 37 stale branches and 9 orphaned agent worktrees accumulated. Every one was adjudicated
**by content** (`grep -aF` per added line against `origin/main`), not by branch age or `git cherry`
— ⭐ patch-id is USELESS here because squash-merges give shipped work a different id, so merged
branches read as "62 commits ahead" forever. 33 were verified shipped and deleted. **These four
were NOT, and all four are now pushed to `origin` so they are no longer local-only:**

> ⚠️ Triage 2026-08-20: all four verified superseded/stale at HEAD — branch deletion is the remaining act, pending founder.

- [ ] **`fix/scenario-empty-daily-returns` — 143 of 164 added lines absent from main.** A real bug
  fix: resolves the lazy-returns series through the analytics column-drift resolver, across
  `api/strategies/[id]/returns/route.ts`, `factsheet/allocator-portfolio-payload.ts` and
  `portfolio-math-utils.ts`. Its own comment records the load-bearing fact: **the legacy
  `daily_returns` column has NO production writer** — the real series lives in `returns_series`,
  the `(1+r).cumprod()` wealth curve the analytics service writes (`metrics.py:775-778`).
  ⚠️ Dated 2026-08-04 and never merged. **Decide: land it or close it with a reason.**

- [ ] **`fix/sync-status-superseded-failed` — an entire MIGRATION that never landed.**
  `supabase/migrations/20260705130000_sync_status_supersede_failed.sql` and its gate
  `supabase/tests/test_sync_status_supersede_failed.sql` are **absent from main**.
  ⚠️ A migration sitting unmerged for 5+ weeks is either abandoned-on-purpose or dropped by
  accident, and the branch name does not say which. ⛔ Do NOT merge it blind — merging
  `supabase/migrations/**` AUTO-APPLIES to PROD. Read it first; it is adjacent to Phase 144's
  reaper-status work, so check for conflict before v1.16 Phase 144 lands.

- [ ] **`ci/pytest-xdist-parallel` — 23% of its additions absent from main.** Parallelizes the
  analytics-service Python CI (`pytest.ini`, `Makefile`, `conftest.py`, `requirements-dev.txt`,
  `ci.yml`). Cheap, useful, never merged. ⚠️ Check it against the `-p no:randomly`/VCR-cassette
  constraints before landing — parallel pytest plus cassettes is exactly where LIVE broker calls
  leak in.

- [ ] **`wip/v1.16-phase140-fix-archive` — 91% divergent (4,046 of 4,441 added lines absent).**
  Highest divergence of any branch, but **no file it touches is missing from main**, so this reads
  as a superseded WIP approach from the Phase 140 era (2026-07-25) rather than lost work. Kept
  rather than deleted *because* 91% is too high to dismiss on a heuristic. **Decide: skim it once
  and delete, or cherry-pick anything still true.**

⭐ Also rescued: `.claude/worktrees/agent-a06a853e5acc0cdd0` held **264 uncommitted lines** across
`SyncPreviewStep.tsx` and three of its tests. Main already carries the recomputing block so it
looks superseded, but the diff was saved rather than assumed — session scratchpad,
`rescued-worktree-a06a853e-uncommitted.patch`. ⚠️ Scratchpad is session-scoped; if this matters,
move it into the repo.

## Phase 143 — recorded deferrals (logged 2026-08-17)

Both are DELIBERATE non-coverages of the JOB-04 dropped-enqueue sweep
(`supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql`), documented in that
file's header and in `143-CONTEXT.md`. Neither is a bug in the sweep; each needs its own mechanism.

- [ ] **(D-09) Composite strategies stranded without analytics are EXCLUDED from the sweep — they
  need a `stitch_composite` re-run mechanism with its own predicate.** The sweep excludes any
  strategy with a `public.strategy_keys` member row. This is **money safety, not optimization**:
  `run_stitch_composite_job` writes `csv_daily_returns` itself (`job_worker.py:6786-6803`) but
  `JOB_CHAIN_FOLLOW_ON["stitch_composite"]` is the empty tuple (`job_worker.py:527`), so a composite
  is chain-terminal and legitimately never gets a `compute_analytics_from_csv` job. Enqueueing one
  would hand the composite headline to the single-key computation its own handler deliberately
  abandoned — a √252-vs-√365 annualization divergence plus a 0.0 gap-fill that "fabricated flat
  performance" (`job_worker.py:6808-6822`). Silent corruption of a CORRECT row on a money surface is
  strictly worse than the un-healed hole. ⚠️ Not hypothetical: the 143-02 census found **1 composite
  on PROD carrying dailies**, currently protected only by a terminal analytics row — i.e. one failed
  terminal write away from being the exact false positive this conjunct stops.

- [ ] **(D-05) The wizard/API first-hop enqueue drop is NOT covered.** A `finalize-wizard` strategy
  whose `sync_trades` enqueue dropped has **no dailies at all**, and "no dailies AND no jobs" is
  byte-identical to a brand-new strategy that has not synced yet, and to a key whose first sync
  legitimately returned nothing. No predicate catches the drop without also catching those, so the
  sweep would re-enqueue healthy strategies forever. Closing it needs a different signal
  (`api_key_id` present + no job EVER + a longer grace) with its own false-positive analysis — a
  separate mechanism, not a second predicate bolted into this migration.

- [ ] **(follow-on, from the 143-04 live tick) `cron.job_run_details.return_message` does NOT carry
  a pg_cron body's RAISE NOTICE text on this Supabase build — it carries the command tag (`DO`).**
  Observed 2026-08-17. This affects **142's reaper too**, whose header relies on the same premise for
  its operator-observability section; that file was not touched by Phase 143. Either correct
  `20260802120000`'s wording or build a real count surface. Until then, count healed rows with
  `SELECT count(*) FROM public.compute_jobs WHERE metadata->>'source' = 'reconcile-sweep' AND
  created_at >= <tick start>`, not by reading the run log.

### Phase 143 red-team residuals (logged 2026-08-17, deliberate trade-offs)

Both have a SAFE failure direction. Recorded so the trade-off is visible, not so it is forgotten.

- [ ] **Sweep-alert de-dupe is in-process (bounded FIFO), not durable.** A worker restart between two
  claims of the same heal costs ONE DUPLICATE alert. The dangerous direction — a heal whose first
  claim died going unreported — was a real bug and is FIXED (red-team F-2). Exactly-once across
  restarts needs a `compute_jobs.metadata` write and therefore a migration, which auto-applies to
  PROD on merge; not worth it for a duplicate. `analytics-service/main_worker.py`.

- [ ] **The D-19 IN-subquery-LIMIT gate is a TEXT gate and remains partially escapable.** Widened
  2026-08-17 from `[^)]*` (which could not match any realistic rewrite, since the predicate needs
  `EXISTS (...)` parens) to `[^;]*`. A rewrite placing a `;` between `IN (SELECT` and `LIMIT` still
  escapes it. Inherent to text gates: the per-tick bound's only real proof is SQL gate Part 4
  executing the deployed body against LIMIT+1 rows. Do not mistake a green text gate for a bound proof.

- [ ] **TEST's migration ledger disagrees with the repo filename for this migration** (logged
  2026-08-17 at land time). Applying via Supabase MCP `apply_migration` stamps `now()`, so TEST
  recorded `supabase_migrations.schema_migrations.version = 20260817092430`, while the repo file —
  and therefore PROD, which got it through the normal `Supabase Migrate` workflow — is
  `20260816140000_reconcile_dropped_enqueue_sweep.sql`. **PROD is correct and unaffected**; this is
  TEST-only bookkeeping. Consequence: TEST still considers `20260816140000` unapplied, so a future
  `supabase db push` at TEST would re-run it. That re-run is believed benign (`cron.schedule` is
  upsert-by-name and the body is unchanged) but has **not** been exercised. Known trap, previously
  seen as the PR-Y2 rename. Reconcile the TEST ledger row, or leave it and never `db push` TEST.

## Phase 145 — recorded deferrals (logged 2026-08-17)

Three DELIBERATE deferrals from the JOB-06 csv-finalize atomicity fold
(`finalize_csv_strategy_with_returns`, migration `20260819120000`; 145-CONTEXT.md `<deferred>`).
None is a defect in the fold; each carries the constraint that made it out-of-scope. Census
citations are from `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md`
(taken 2026-08-17: PROD `khslejtfbuezsmvmtsdn`, TEST `qmnijlgmdhviwzwfyzlc`).

- [ ] **(Window E) Enqueue-errored strategies are visible and alerted but never healed — nothing
  re-enqueues them.** Shape: dailies present, the `after()` enqueue errored, `strategy_analytics`
  = `'failed'`, no `compute_jobs` row ever created. The user's poller breaks out on `failed` and
  Sentry fires (`step: csv-analytics-enqueue`), so it is not silent — but Phase 143's sweep
  deliberately excludes it via the terminal-analytics conjunct (`20260816140000:737`), and the
  Phase 145 fold leaves hop 5 (the post-response enqueue) outside the transaction by physical
  necessity (`after()` runs post-commit), so this window survives the fold. Census query (3)
  measured 2026-08-17: **PROD = 1, TEST = 0**. The pre-registered re-rank trigger ("non-zero PROD
  → live cleanup") technically fired, but the single PROD row is the KNOWN composite already
  tracked by the Phase 143 (D-09) entry above — composites are chain-terminal by design and need a
  `stitch_composite` re-run mechanism, not a csv re-enqueue — so there is no genuine window-E
  population today and the item stays mid-term. Any future healer must key on a signal that
  distinguishes "enqueue errored" from "composite, legitimately job-terminal" (the D-09
  false-positive class).

- [ ] **(Wizard first-hop drop) The API/wizard first-hop enqueue drop remains uncovered — ⛔ never
  absorb it into Phase 145's surface by widening a predicate.** Phase 143 filed it as documented
  non-coverage (`20260816140000:259-265`; the D-05 entry above): a dropped first `sync_trades`
  enqueue leaves "no dailies AND no jobs", byte-identical to a brand-new strategy, so no csv-side
  predicate catches it without re-enqueueing healthy strategies forever. It is shape-identical to
  145's pre-fold windows A–C but has an UNSOLVED distinguishing-signal problem — which is exactly
  why 145 dissolved its own windows via the fold instead of sweeping. Census (1)-minus-(2)
  measured 2026-08-17: **PROD = 0** (no wizard first-hop population; PROD's 18 csv no-dailies rows
  are all 2026-05 incident-era fossils), **TEST = 8107** (all non-csv — the e2e-seed residue
  class). Closing it needs its own signal (`api_key_id` present + no job EVER + a longer grace)
  with its own false-positive analysis — a separate mechanism, never a second predicate bolted
  onto `20260816140000` or onto the fold's resolve arm.

- [ ] **(Inert flag cleanup) Delete the dead `feature_flags.process_key_unified_backbone` row and
  the dead `PROCESS_KEY_UNIFIED_BACKBONE` env vars (Vercel Production + Railway
  `quantalyze-analytics`) — respecting the apply-time RAISE trap.** Zero code readers at HEAD
  (145-REPRODUCTION.md arm 2: the token survives only in two comments and one test constant; the
  historical readers named in `106-RATIFICATION.md:29-30` are gone), so row and env vars are dead
  config, not a live switch. Census (4), 2026-08-17: the row is present on BOTH projects — PROD
  reads `'on'` (updated 2026-05-25), TEST reads `'off'` (diverges). ⛔ Constraint, verbatim from
  145-CONTEXT.md: "Do not flip or delete it in this phase —
  `20260620120000_verification_requests_view_shim_apply.sql:86-89` RAISEs at apply time if it
  reads `off`, so a 'cleanup' delete could redden a future migration apply." (Precisely: the gate
  RAISEs when `value = 'off'` AND `updated_by <> 'migration-104-seed'` — the pristine db-reset
  seed is exempt; a DELETE leaves `v_value` NULL, which passes, but a flip to `'off'` trips it,
  and TEST's row ALREADY reads `'off'`, so re-applying that migration on TEST is hazardous today
  unless its `updated_by` is the seed exemption — unverified.) Cleanup order: retire or guard the
  `20260620120000:86-89` check first, then remove the row and both env vars in the same pass.

## Phase 145 ship-review findings (logged 2026-08-18, /ship review army — none blocking per the blast-radius bar)

Fixed at ship time (not listed): the CSV_PERSIST_FAIL retry fence (user-facing dead button)
and the pytest discriminator-suite re-point. Everything below is deliberate deferral —
clean up opportunistically; none is a persistent user-facing defect or data-integrity break.

**→ ABSORBED INTO PHASE 146.1 (2026-08-18):** the v1.19 xhigh milestone review picked this
whole list up as roster item C4 (with overlaps mapped: fold value guards + fmt-blind
empty-rows → A1, copy honesty → A3, 23505 second source → B3, rpc-test re-point → B5).
Items stay open HERE until 146.1 ships; close them here when it does.

- [x] **Python tombstone envelope — MESSAGE fixed in Phase 146.1-07 (2026-08-18).**
  `flow_type=csv, step=finalize` still answers 422 `MISSING_STRATEGY_ID` (deliberately —
  see the gated option below), but the `human_message` no longer tells the caller to supply
  `context.strategy_id`. It now states that CSV finalize moved to the Next.js route in
  migration `20260819120000` and that this service is no longer a writer for that flow.
  The default sentence is byte-identical for every other caller, pinned by
  `test_non_csv_missing_strategy_id_message_is_byte_identical` and
  `test_csv_non_finalize_step_keeps_the_default_message` (neuters C4-BLEED and
  C4-FLOWONLY both observed RED).
- [ ] ⛔ **OPTION `CSV_FINALIZE_MOVED` — a dedicated error code for the tombstone arm.
  GATED ON WIZFORM-02 CLOSING. Do not pick this up before that gate opens.**
  **What it is:** replace the `MISSING_STRATEGY_ID` code on the
  `flow_type='csv' + step='finalize'` arm with a code that names the actual refusal, so a
  caller can branch on the code rather than parse the sentence.
  **Why it is NOT shipped:** a new code must enter the WIZFORM-02 coverage-law population,
  and **WIZFORM-02 is recorded OPEN** — server-classified codes still render as
  `code: UNKNOWN` at the wizard (Phase 153 span verification FAILED 2026-08-13). Minting the
  code today ships it straight into a known-broken classification path, which is strictly
  worse than an honest message under an existing, correctly-rendered code.
  **Cost when the gate opens:** (1) add the code to the coverage-law population and satisfy
  whatever the law requires of a new code; (2) add a wizard-side classification entry so it
  does not render UNKNOWN, and a render test proving it; (3) the honest sentence shipped by
  146.1-07 stays — the code is additive to it, not a replacement, or the message regresses
  to naming only a code.
  **Where:** `analytics-service/routers/process_key.py` (the tombstone branch beside the
  API-6 envelope); the deliberate non-minting is recorded in the comment there.
- [x] **Stale-comment batch from the fold re-point — DONE in Phase 146.1-07 (2026-08-18).**
  Every claim was grep-verified at HEAD BEFORE it was touched; the ones the grep CONFIRMED
  were left alone rather than given a fresh date. Ground truth for the batch: migration
  `20260819120000:349-350` DROPs both `finalize_csv_strategy` and `persist_csv_daily_returns`.
  - CORRECTED: csv-validate-route.test.ts TOC items 6 and 7 (item 6 named the dropped persist
    RPC; item 7 named `CSV_PERSIST_FAIL`, which no test in the file pins — Test 7 pins
    `CSV_FINALIZE_FAIL`). csv-validate-route.test.ts:~898 beforeEach ("Phase 106 Stage B ...
    the SHARED persist_csv_daily_returns RPC"). csv-finalize/route.test.ts:~60 `rpcMock`
    comment (named both dropped RPCs).
  - LEFT ALONE, verified accurate: TOC item 8 — Tests 8a (runtime), 8b (source-shape) and
    8c (arity lock) all exist and match the comment.
  - REMOVED: the orphaned `process.env.INTERNAL_API_TOKEN` set in
    csv-finalize-cross-submission-merge.test.ts (line 177 at HEAD, not the 150 this item
    recorded). The route reads no such variable; the suite was re-run to confirm the
    removal changed nothing.
  - ANNOTATED: atomic-fold gate Part 2c — the enclosing `BEGIN ... EXCEPTION WHEN OTHERS`
    is an implicit PL/pgSQL subtransaction, so once Part 2a establishes that the call
    RAISED, the 0/0/0 counts follow by savepoint semantics rather than by anything the fold
    does. Kept (it still discriminates a write that ESCAPES the subtransaction) with a note
    saying so, so nobody reads a green 2c as independent atomicity evidence.
- [ ] **Residual: `INTERNAL_API_TOKEN` env sets inside csv-validate-route.test.ts.** NOT
  touched by the 146.1-07 batch, deliberately. The file mixes csv-VALIDATE describes (which
  legitimately forward to the Python service with that token, and pin its absence at
  `:808`/`:1883`) with csv-FINALIZE describes (which no longer need it). Separating the ~28
  occurrences requires per-describe analysis, and a wrong removal would make a token-absence
  arm vacuous rather than merely untidy. Cosmetic; do it as its own pass with the suite run
  between each removal, or split the file.
## v1.19 xhigh milestone review (2026-08-18) → Phase 146.1 owns the residue

15 confirmed findings across `43069db9..4e3effb0` (PRs #687–#690). Full roster with file
anchors: `.planning/phases/146.1-review-v1-19-xhigh-close-out-fold-guards-resolve-arm-honesty/146.1-CONTEXT.md`.

**Fixed same-day** (`fix/v1.19-review-easy`): dead CSV_DUPLICATE_SESSION fence + vacuous
predicate test deleted; `TestTerminalizerWindowInvariant` couples the 4h terminalizer
window to `p_batch_size × max(TIMEOUT_PER_KIND)` (RED observed at simulated 5h); three
false "nobody forwards X-User-Access-Token" comments corrected; fold self-verify check (d)
`%5000%` substring → comment-stripped bounded regex (proven on TEST: widen-RAISES,
guard-deleted-comment-kept-RAISES — the old check false-PASSed the latter).

**→ Phase 146.1** (not re-listed item-by-item here; the CONTEXT roster is the working
copy): A1 fold NULL/[] zero-dailies commits · A2 resolve arm ignores private-vs-
pending_review status · A3 "Nothing was saved" copy on unknowable-commit arms · A4
echoed-outcome metadata overwrite + missing re-enqueue · B1 Python rate-limit
bypass-by-omission (route-enumeration gate) · B2 X-User-Access-Token drop-vs-wire
adjudication · B3 any-23505 undiscriminated (pgConstraintName) · B4 terminalizer×sweep
non-composition (widen conjunct — same item as the RESEARCH §6 residual above) · B5
csv-finalize-rpc.test.ts points at a DROPped RPC (nine 22023 assertions coverage-gone) ·
C1 interior-values echo (FOUNDER: hash vs honest copy) · C2 duplicate handler collapse ·
C3 TEST sweep-cron seed residual (mitigated).

### C1 option (a) — content hash over the CSV payload (NOT taken in Phase 146.1)

**Status: filed, not scheduled. Option (b) — honest copy — SHIPPED in Phase 146.1
(plan 146.1-04), and option (b) is what a reader finds in the code today.** The 200
resolve echo in `src/app/api/strategies/csv-finalize/route.ts` now carries a
`human_message` stating that the arm compared the committed series' ROW COUNT and its
FIRST and LAST dates — and explicitly NOT the individual daily values — and the residual
comment beside the series-equality check records this founder call. The predicate did not
change; the envelope stopped implying an observation that was never made.

**The residual that stays open.** The resolve arm makes exactly two reads of the committed
series (count, and [min,max] boundary dates). A resubmit whose payload has the SAME row
count and the SAME first/last dates but DIFFERENT interior values is indistinguishable to
those two reads and is still echoed 200. The identical-retry case dominates by
construction, which is why (b) is defensible; but the hole is real and is not closed.

**What option (a) would cost — filed WITH its price, because an option without its cost is
an option nobody can decide:**

- [ ] **A content hash persisted at CREATE time.** Requires a new column on `strategies`
      (or a field on `strategy_verifications`) holding a digest of the canonicalised
      daily-returns payload, written inside `finalize_csv_strategy_with_returns` so it
      shares the fold's transaction. The resolve arm then compares the resubmit's digest
      against the committed one and refuses on mismatch — a real equality check instead of
      two boundary reads.
- [ ] **Cost 1 — a THIRD migration.** Phase 146.1 already carries two
      (`20260819130000` fold input guards, `20260819130500` sweep readmit), each with its
      own PROD-risk TEST rehearsal. A third means a third rehearsal and a third apply
      window.
- [ ] **Cost 2 — a BACKFILL question for every already-committed row.** Existing CSV
      strategies have no digest. Computing one requires re-reading each strategy's
      `csv_daily_returns` series and canonicalising it exactly as the write path does — and
      any canonicalisation drift between backfill and write silently refuses honest
      retries forever.
- [ ] **Cost 3 — a nullable-hash FAIL-OPEN period.** Between the migration and the
      completed backfill, `hash IS NULL` means "not measured", not "no match". The arm must
      keep the count+boundary behaviour for those rows (absence is not a value), so the
      residual persists for every pre-backfill row until the backfill lands. That window
      needs a decided length and an observable end.

**Re-opening it is a phase of its own, not an amendment to 146.1.** If the founder chooses
(a), the honest-copy sentence shipped by (b) becomes wrong in the other direction (it would
under-claim) and must be revised in the same change.

## Phase 146.1 execution notes (logged 2026-08-18)

- [ ] ⚠️ **Two competing FastAPI route-enumeration helpers now coexist; consolidate on one.**
  `fastapi>=0.139` defers `include_router`, so `app.routes` holds opaque `_IncludedRouter`
  placeholders and a flat `isinstance(r, APIRoute)` scan sees only app-decorated handlers.
  Two independent fixes exist:
  (a) `tests/test_validate_key_venue_transient.py::_effective` — hand-rolled recursion into
      `route.original_router.routes`; yields the ORIGINAL route objects, whose `.path` is
      **UNPREFIXED**. Correct only because every `include_router` in `main.py:811-825` is
      currently bare. **Latent trap:** the first `include_router(..., prefix="/x")` makes its
      path matching silently miss, and that file's lookup then raises "no route registered"
      (loud) — but any future path-based reader of the same helper would go quietly wrong.
  (b) `tests/test_limiter_route_coverage.py` — `fastapi.routing.iter_route_contexts`, the
      flattener FastAPI's own `get_openapi` uses; composes prefixes correctly.
  Prefer (b) and retire (a). Not done here: (a) is green today and is outside this PR's scope.
  ⭐ Process note: (a) already documented this exact behaviour **in-repo** before I began
  debugging it. Grep for `_IncludedRouter` / `original_router` before theorising next time.

- [ ] **`--reporter=basic` is invalid in vitest 4** and appears in the `<verify>` blocks of plans
  146.1-01/03/04/05/06/07. MEASURED: it exits 1 with `Failed to load custom Reporter from basic`.
  ✅ It fails LOUD rather than passing vacuously, so no green in this phase rests on it, and
  ✅ plan 146.1-08 (the merge gate) does NOT use it. Drop the flag from the plan template.

- [x] ~~**146.1-07 task 1 DEFERRED — types regen needs a Supabase access token.**~~
  ✅ **CLOSED 2026-08-18, same day — the deferral rested on MY OWN measurement error.** I
  reported that the Supabase MCP fallback was unusable because `prettier` could not parse it.
  It could not parse it because I fed prettier the **JSON envelope**, not the TypeScript:
  `generate_typescript_types` returns `{"types":"export type Json =…"}`, so the 129,458
  "one line" was a JSON string containing 4,133 escaped newlines. Extracting the `types` field
  yields ordinary TypeScript that needs no formatting at all — the Supabase CLI emits
  semicolon-free output and so does the MCP, so running prettier over it was itself the thing
  that produced a 7,758-line churn diff. Raw extraction diffs **34 lines**.
  **Executed without any token:** extract `types` → prepend the hand-written header (which the
  generator does NOT emit, so a naive `> file` redirect would have destroyed it, including the
  CRITICAL NUMERIC-precision audit note) → re-apply the two `HAND-PATCHED` tripwire comments the
  file itself warns must survive a regen → delete the cast at `route.ts:592`.
  **Verified:** net diff to the types file is **11 lines**, purely the fold's signature; the
  `notify_*` columns and the `scenarios` block survived; `tsc` clean WITH the cast deleted (which
  is the actual proof the signature is right); `database.types.test.ts` + `audit-coverage` +
  the three csv-finalize suites 138 passed; lint 0 errors; and re-introducing an `as any` cast
  trips 3 lint errors, so the type safety is enforced rather than merely present.
- [ ] ⭐ **Comment-blind greps have now failed THREE times in one phase — make it a lint, not
  a habit.** (1) the fold self-verify's `%5000%` substring, satisfied by a widened `50000`
  (fixed, PR #691); (2) my own `BETWEEN -10 AND 100` check, which false-flagged a COMMENT
  explaining the neuter as executable drift; (3) plan 146.1-04's C1 gate,
  `grep -qiE '…checksum…' && fail`, which was **already broken at its own base commit** —
  it matches honest prose at `route.ts:819` ("closing it needs a checksum, not two reads").
  The executor correctly REFUSED to delete truthful prose to make a grep pass and measured
  intent instead (`sha256|createHash|content_hash|digest` → zero, no crypto import;
  orchestrator re-verified with a comment-stripping parse). ⭐ The general rule: a grep over
  source that does not strip comments is unreliable in BOTH directions — vacuous when it
  should fire, false-positive when it should not. Candidate fix: a shared
  `scripts/grep-code.sh` that strips comments, used by every plan `<verify>`.
## Phase 146 — RATE-04 value-parity candidates (logged 2026-08-18, D-146-4: retuning is founder territory)

Source: `.planning/phases/146-rate/146-AUDIT.md` §3 (fresh at HEAD `e912e38b`). Every number
below was re-read from source that session. Standing caveats: Python slowapi storage is
`memory://` PER REPLICA (values are floors ×N, order-of-magnitude only); `userActionLimiter`
backs ~9 surfaces — the remedy for any of its flows is a NEW named limiter, never a resize.

- [ ] **L-9 `/optimize-weights` per-tenant floor out of pattern (post-TS-04 re-look).**
  Measured: Python 20/min/tenant = 1200/h (`optimizer.py:43-45`) vs max legitimate
  Vercel-forwarded 5/min/user = 300/h (`scenario/optimize/route.ts:151`) — 4× headroom where
  the match.py siblings deliberately size 1.5× (30/min over 20/min). No UX harm (Vercel gates
  first); defense-in-depth sizing only, ×N replicas under memory://. Recommendation: tighten
  to 10/minute per tenant (2× headroom, sibling pattern); the literal pin in
  `analytics-service/tests/test_limiter_identity.py` MUST move in the same commit.
- [ ] **verify-strategy teaser: per-IP front door cannot see the shared anon bucket.**
  Measured: Vercel `publicIpLimiter` 10/min per IP = 600/h/IP (`ratelimit.ts:117`;
  `verify-strategy/route.ts:59`) vs Python `/process-key` anon tier 30/h in ONE platform-wide
  shared bucket (`rate_limit.py:107`, `:148` "Everything anonymous shares ONE bucket",
  `:337`). A handful of concurrent anonymous visitors exhaust the platform's teaser capacity;
  it is also a growth ceiling (~30 verifications/h total). The shared bucket is a deliberate
  anti-abuse control (docblock: one anon IP once drained the whole platform window,
  `rate_limit.py:89-91`) — founder call required. Recommendation: key the anon tier per-IP
  (30/h per IP) to preserve the anti-abuse intent while removing the shared ceiling, or raise
  the shared tier when teaser traffic warrants.
- [ ] **csv-validate: 12× over the shared `/process-key` tenant tier + stale docblock
  citation.** Measured: Vercel `csvValidateLimiter` 20/min/user = 1200/h (`ratelimit.ts:206`)
  vs `/process-key` tenant 100/h (`rate_limit.py:100`) SHARED with keys/sync and
  finalize-wizard. The docblock's own 3-5/min iteration estimate sustained = 180-300/h >
  100/h — plausible legitimate exhaustion mid-iteration (softened ×N replicas). Also the
  `csvValidateLimiter` docblock (`ratelimit.ts:195-206`) still justifies its value against
  "the upstream 30/hour cap" in `routers/csv.py`, but the route rides `/process-key` at HEAD
  (`csv-validate/route.ts:6` imports `postProcessKey`; `/csv/validate` has no TS caller).
  Recommendation: founder call between raising `_PROCESS_KEY_TENANT_LIMIT` or adding a
  csv-scoped tier; fix the stale docblock citation in the same commit as whichever lands.

## Phase 146 close-out notes (logged 2026-08-18)

- [ ] **`analytics-service/tests/` are outside the mypy --strict gate — test_match_router.py
  alone carries 274 strict errors.** The canonical gate (`python3 -m mypy --strict
  --follow-imports=silent services/ routers/ models/`, clean at 91 files) deliberately
  excludes tests/; measured 2026-08-18 while verifying the limiter-flake fix: running strict
  on tests/test_match_router.py reports 274 errors (untyped fixtures/mocks — pre-existing,
  not introduced by Phase 146). Decide: either annotate the test tree incrementally and
  widen the gate directory-by-directory (start with the limiter/parity test files, which are
  newest), or record tests/ as permanently out of strict scope in a mypy config comment so
  the next session doesn't re-derive this. Never widen the gate in the same commit as a
  behavior change.

## Phase 146.2 — recorded deferrals (logged 2026-08-19)

*The founder rule: an item ABSORBED into a phase is deleted from this file, but an item the
phase deliberately does NOT fix must be re-recorded here. Silent drop is forbidden. The FIRST
FOUR below were re-verified against HEAD on 2026-08-19 before being written down. The fifth
(WR-01, the `createAdminClient()` request-path throw) was appended on 2026-08-20 from the
Phase 146.2 code review and is verified as of that date — it was NOT part of the 2026-08-19
sweep. Recorded because appending it silently left this preamble asserting "all four", which
was then false: the same scope-amendment class this file exists to prevent.*

- [ ] **`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:283-288` — the performance
  note cites the WRONG index.** It says the scalar subquery runs "over compute_jobs indexed by
  strategy_id (20260808120000 and the table's own FK index)". Neither citation holds:
  `20260808120000` creates `idx_strategies_user_id` on `strategies(user_id)` (`:127`), which is
  a different table and a different column; and PostgreSQL does **not** auto-create indexes for
  foreign keys, so there is no "table's own FK index". The index that actually supports the
  subquery is `compute_jobs_strategy_id ON compute_jobs (strategy_id) WHERE strategy_id IS NOT
  NULL`, created by `20260412094454_sync_strategy_analytics_status.sql:68-70`.
  ⚠️ **The SUBSTANCE of the performance claim survives** — a supporting index does exist and no
  new one is needed; only the provenance is wrong. Prose-only, non-blocking (the stopping rule
  keeps citation defects off the blocking path). **Fix:** re-point the citation to
  `20260412094454:68-70` and delete the FK-index phrase, in whatever commit next touches that
  migration's header. Do NOT edit the migration solely for this — it is already applied.
- [ ] **`20260819150000_...:283-288` — the same note asserts an execution ORDER the planner does
  not promise.** It says the subquery runs "only AFTER the three cheaper NOT EXISTS conjuncts
  have already discarded the corpus". PostgreSQL gives no guarantee about conjunct evaluation
  order; cost estimates normally place the `NOT EXISTS` semi-joins first, but that is a
  tendency, not a contract. **Reword to:** "the planner is free to order these conjuncts; cost
  estimates normally place the NOT EXISTS semi-joins first." No behavioural impact — the
  candidate set is bounded by `LIMIT 25` downstream and the sweep runs hourly. Prose-only,
  non-blocking; same commit as the citation fix above.
- [ ] **`process-key-client.ts` transport catch: a TRAP-1-shaped error could inline BODY
  credentials into a seam-level CONSOLE line.** The catch scrubs via `scrubSeamError(err)` whose
  per-request secret set is DERIVED from the OUTGOING HEADERS
  (`resilient-fetch.ts` `CREDENTIAL_HEADER_NAMES` → `credentialHeaderValues`, documented at
  `process-key-client.ts:505-509`). That is a deliberate class fix for header-borne credentials,
  and it is strictly better than the caller-declared list it replaced — but a credential carried
  in the request BODY is not in the derived set, so an upstream error message echoing it back
  would survive the scrub into the console line. **Sentry is unaffected: verified 2026-08-19,
  the file contains zero `captureToSentry` call sites**, so the exposure is Vercel function logs
  only. Not a live leak — no known body-borne credential crosses this seam today; recorded so
  the next credential added to a `/process-key` body is not added blind. **Fix direction:** widen
  the derived secret set to include body values of known credential-shaped keys, or assert at the
  seam that no credential-shaped key appears in the body.

## Phase 146.2 — recorded deferrals, SECOND PASS (logged 2026-08-20)

*Why a second pass: the PR #694 body reported the Phase 146.2 code review as closing with
"5 INFO (recorded)". That was false — not one of IN-01…IN-05 had ever been written into this
file — and four further items the phase knowingly did not fix were also missing. A red team
caught it on 2026-08-20; every entry below was re-measured against HEAD (`181eed3b`) before
being written down, and route.ts line numbers are paired with symbol anchors because that
file moves. The founder rule stands, with a sharpened edge: "recorded" is a claim about THIS
FILE, so grep it before you type it.*

- [ ] **IN-01 — `CsvSubmitStep.tsx:473` and `CsvSubmitStep.test.tsx:305` cite a route function
  that does not exist.** Both docblocks (under
  `src/app/(dashboard)/strategies/new/wizard/steps/`) name `resolveExistingCsvStrategy`.
  Measured 2026-08-20: `grep -rn resolveExistingCsvStrategy src` returns exactly those two
  COMMENT lines and nothing else — the symbol exists nowhere in the repo as code. The function
  they mean is `resolveExistingStrategyOrRefuse`
  (`src/app/api/strategies/csv-finalize/route.ts:1080`, called at `:814`). The SEAMPROSE-01
  protocol asks client-side prose to carry a symbol-anchored citation back to the server arm it
  renders; a citation that resolves to NOTHING is worse than none, because the next reader
  greps, finds zero hits, and cannot tell whether the arm was renamed or deleted. Prose-only,
  non-blocking per the stopping rule. **Fix:** rename both references to
  `resolveExistingStrategyOrRefuse` in whatever commit next touches the wizard directory.
- [ ] **IN-02 — dead conjunct in a c14 assertion.**
  `src/__tests__/csv-finalize-c14-regression.test.ts:740-743` reads
  `expect(opts && call![0], "…").toMatchObject({ code: "57014" })`. `opts` is unconditionally
  truthy at that point, so `opts &&` contributes nothing and the expression is just `call![0]`.
  The assertion still pins the real property (the fail-closed 503's Sentry capture must carry
  the READ error's SQLSTATE, so ops can tell a statement timeout from an RLS hide), so nothing
  is unpinned today — but a dead conjunct in an oracle is exactly the shape that lets a later
  edit "preserve the assertion" while changing its subject. **Fix:**
  `expect(call![0], "…").toMatchObject({ code: "57014" })`.
- [ ] **IN-05 — the "verbatim" wire fixtures in the wizard tests remain unverifiable by the
  suite (self-declared).** `CsvSubmitStep.test.tsx:308` (`ROUTE_ECHO_SENTENCE`), `:319`
  (`ROUTE_CLASSIFICATION_CONFLICT`), `CsvSubmitStep.upstream-arm.test.tsx:96`
  (`ROUTE_PERSIST_FAIL`), `:105` (`ROUTE_SESSION_REUSED`) — all under
  `src/app/(dashboard)/strategies/new/wizard/steps/`. Each constant is BOTH the mocked wire
  payload and the expected DOM text, so the suite is green for ANY string; the correspondence
  to `csv-finalize/route.ts` is enforced by a comment, not by code. W1 fixed a real drift and
  the comment now says this out loud, which is the right disclosure — recorded so the standing
  risk is tracked rather than re-discovered. ⚠️ All four were hand-verified byte-exact against
  their route literals on 2026-08-19; **a hand check does not survive the next edit**, which is
  the whole point of the entry. **Fix (reach for it on the third drift):** the declined static
  coupling — a build-time assertion that each fixture string is a substring of `route.ts`.
- [ ] **`supabase/tests/test_csv_finalize_atomic_fold.sql:565-574` — Part 3e's trailing
  "committed nothing" count block CANNOT FAIL.** The fold call sits inside the probe's own
  `BEGIN … EXCEPTION WHEN OTHERS` (`:545-553`). A plpgsql exception block is an implicit
  SUBTRANSACTION, so any rows the fold wrote are rolled back when it raises — BEFORE `n_strat`
  / `n_sv` / `n_dl` are read at `:565-571`. They are 0/0/0 for a healthy body AND 0/0/0 for the
  exact defect the RAISE at `:572-574` names ("GUARD 1 ran AFTER a write instead of as the
  FIRST statement"). ⚠️ **The Part is NOT vacuous as a whole** — its first three assertions
  (`:555` raised-at-all, `:558` SQLSTATE is 22023, `:561` the message names `p_terminal_status`)
  each discriminate, and the un-provable placement property is separately pinned by the new
  Part 1d no-handler check (`:256-267`). This is guard hygiene, not a live break. ⚠️ **The same
  shape is copied from PRE-EXISTING Part 3d (`:475-481`) — fix both or neither**; removing one
  and leaving the other tells the next reader the shape was reviewed and blessed. ⭐ The sibling
  file states these exact semantics as MEASURED fact —
  `supabase/tests/test_csv_finalize_double_submit.sql:246-253`: a catch-write-and-re-raise
  handler is "NOT caught, and not catchable by ANY row count" because the subtransaction rolls
  the handler's own writes back too. Part 3e was written after that note and did not apply the
  lesson to itself. **Fix:** delete both count blocks and replace them with a comment pointing
  at Part 1d as the real pin, rather than leaving two assertions that read like coverage.
- [ ] **Phase 146.2's own close-out made two completeness claims that were false when
  written.** (a) The PR #694 body reports "5 INFO (recorded)" — the five entries above ARE that
  record, first written 2026-08-20. (b) `146.2-VERIFICATION.md:176-177` states "all appear in
  plan `requirements-completed` fields"; measured 2026-08-20, that field exists in five
  SUMMARYs only (01→R1, 02→R2, 03→R4, 06→R7, 07→R6+W1), while `146.2-04-SUMMARY.md` (R3) and
  `146.2-05-SUMMARY.md` (R5, W2, W3) carry NO such field — so **R3, R5, W2 and W3 appear in no
  plan's `requirements-completed` at HEAD even though all four shipped**. ⚠️ Why this is more
  than tidiness: that frontmatter is what a later milestone audit reads to decide a requirement
  was delivered, so four silently-absent entries make shipped requirements look dropped — the
  precise failure the field exists to prevent, and the inverse of the failure this section
  exists to prevent. **Fix:** add `requirements-completed` to the 04 and 05 summaries, correct
  the PR body, and treat "recorded" / "all appear" as claims to be grepped before typing.
- [ ] **The audit-coverage window is stated as 60 lines; the mechanism is brace-balanced with a
  200-line cap.** `src/app/api/strategies/csv-finalize/route.ts:708-711` warns "⚠️ THE EMISSION
  MUST STAY WITHIN 60 LINES BELOW THIS CALL. That is the law's own coverage window
  (audit-coverage.test.ts `isCovered`)". Measured at HEAD: `isCovered`
  (`src/__tests__/audit-coverage.test.ts:374-424`) walks forward brace-balanced from the
  mutation and stops at the close-brace of the ENCLOSING FUNCTION, with
  `AUDIT_WINDOW_MAX_LINES = 200` (`:331`) only as a hard fail-safe. The flat 60-line window is
  the PRE-P694 behaviour the brace walk deliberately replaced — a flat window let a mutation in
  `POST()` be "covered" by a `logAuditEvent` inside `PATCH()` in the same file. Three lines of
  `146.2-06-SUMMARY.md` (`:52`, `:235`, `:538`) repeat the 60. ⚠️ **The SUBSTANCE survives**:
  the emission sits inside the same function body, 39 lines below the `.rpc(`, so the coverage
  law does hold and the placement warning is still the right warning — only the integer and the
  rule it names are wrong. The failure mode of leaving it: someone "safely" moves the emit 80
  lines down (still same function, still covered) and, believing they broke the law, contorts
  the code instead. **Fix:** restate the route docblock as "the emission must stay inside the
  SAME FUNCTION BODY as the `.rpc(` call — brace-balanced walk, 200-line fail-safe" next time
  that file is touched. Leave the SUMMARY as-is (a shipped artifact is history), but do not
  re-copy the 60 into new prose.
- [ ] **FOLLOW-UP PHASE CANDIDATE — make the FILL arm's recompute actually guaranteed instead
  of refusing when it cannot be.** Phase 146.2 closed the classification gap by REFUSING the
  fill when a recompute is already in flight. That is honest, but it is a NARROWING, not a
  repair: those users get a 409 instead of their classification. Root cause, measured at HEAD:
  `_enqueue_compute_job_internal`
  (`supabase/migrations/20260420073003_allocator_holdings.sql:330-402`) dedupes onto any job
  for the same target + kind with `status IN ('pending','running','done_pending_children')`
  (`:370-376`) and RETURNS the existing id (`:400-402`) — so a fill arriving mid-compute is
  ABSORBED into the running job, and that job already snapshotted the OLD classification. The
  worker reads `asset_class` once at job start
  (`analytics-service/services/analytics_runner.py:1212-1219`, into `_strategy_row` at `:1231`)
  and consumes it far later at `:1399-1401` via `periods_per_year_for_asset_class`, so the
  annualization basis for the whole run is fixed before the fill's UPDATE lands. The route's
  enqueue passes no idempotency key
  (`src/app/api/strategies/csv-finalize/route.ts:1776-1780` sends `p_strategy_id`, `p_kind`,
  `p_metadata` only), so it cannot opt out of the dedupe. ⚠️ **Residual sliver even WITH the
  shipped refusal**: the snapshot at `:1212-1219` runs BEFORE the job marks
  `computation_status='computing'` (`:1238-1242`), so a guard keyed on 'computing' closes the
  dominant window but leaves a millisecond gap between the two. **Fix direction:** either force
  a follow-on job rather than letting the enqueue be absorbed (a distinct idempotency key, or a
  supersede arm), or have the worker RE-READ `asset_class` at write time and compare-and-set.
  Both change the job/worker contract and the queue's dedupe invariant ⇒ **own phase, not a
  point fix.**
- [ ] **CI went RED mid-Phase-146.2 and no artifact records it — plus the operating rule that
  prevents the repeat.** The `sql-tests` job failed at commit `44cc4370` in
  `supabase/tests/test_claim_kind_filter.sql` (the FLIPRETRY-04 double-fan-out DO block,
  `:183-219`) with `compute_jobs_api_key_id_fkey` violated. ROOT CAUSE, measured — not a code
  defect, and not one of the four known shared-TEST-DB flake mechanisms: a LOCAL `npm run test`
  was running against the shared TEST database concurrently with the CI run.
  `enqueue_derive_broker_dailies_for_allocator_keys()`
  (`supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:236-240`) fans out
  over EVERY active, non-revoked, non-disconnected `api_keys` row in the whole shared database
  — it has no test-seed scoping — so the test's own `PERFORM` (`test_claim_kind_filter.sql:204-205`)
  enqueued against ANOTHER writer's key that was deleted between the cursor read and the FK
  check. ⚠️ The fan-out's inner handler catches `unique_violation` ONLY (`:249-250`), so a
  concurrently-deleted key (23503) propagates out and reds the whole file — worth knowing
  before "hardening" it, since a blanket `WHEN OTHERS` there would hide real breakage. It
  re-ran green at `181eed3b` with no code change. ⚠️ **OPERATING RULE: never run the local
  suite while any CI run is in flight — `gh run list` FIRST.** And note the ordering that makes
  this entry honest: the mechanism was identified BEFORE the green re-run. A green re-run is
  never itself proof that the first failure was noise.

## v1.19 milestone audit — integration findings (logged 2026-08-20, audit status: tech_debt; none blocking per the blast-radius bar)

All four were found by the milestone-close integration check at HEAD `00e73aa5`, re-measured by
the orchestrator (code greps + PROD counts) before filing. None blocks the close: the affected
populations measured ZERO on PROD, the failure direction is fail-safe (under-healing, not
runaway), and every v1.19 requirement is satisfied as written.

- [ ] **INT-1 — the 144→143 readmit composition is unreachable for real terminalized orphans
  (and its SQL gate arms pass for the wrong reason).** The sweep's `strategy_analytics`
  exclusion (`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:397-402`, list
  includes `'computing'` and `'failed'`) drops any worker-started orphan before the B4 marker
  exemption (`:387-388`) or the `< 3` ceiling (`:390-396`) ever evaluates:
  `analytics_runner.py:1275` runs the unconditional `_mark_computing()` upsert on entry, and
  142's reaper (`20260802120000`) later flips that `computing` → `failed`. Both values are in
  the exclusion list, so a mid-compute orphan terminalized by 144 is never readmitted — it
  settles at a visible `failed` with no auto-retry. The only population that DOES reach the
  ceiling is the claim→mark window (seconds). MEASURED 2026-08-20 on PROD: terminalizer
  markers = **0** (population has never existed); silent under-healed candidates = **0** (the
  one census hit is an honest May-2026 enqueue-failure row). ⚠️ The milestone goal ("detected
  and terminates VISIBLY") is met — readmit was defensive hardening from 146.1-B4, not a
  requirement. TWO sub-items if this is ever picked up: (a) any widening of the analytics
  conjunct must respect that it is THE protection against mass re-enqueue of the
  retention-aged corpus (`test_reconcile_dropped_enqueue_sweep.sql:371-372` gates on exactly
  this); (b) arms C4/C5/C5b seed NO `strategy_analytics` row
  (`test_reconcile_dropped_enqueue_sweep.sql:705-746`), so they prove the ceiling's predicate
  arithmetic, not reachability — seeding analytics at `computing`/`failed` in a NEW arm would
  make the gap executable (and RED until (a) is decided). Migration-header prose at
  `20260819150000:15-26` overstates the readmit path's reach; migrations are immutable, so the
  correction belongs in the successor migration if one is ever written.
- [ ] **INT-2 — no whole-surface limiter coverage law on the Next side (RATE-05 residue).**
  `src/lib/api/limiter-ordering.test.ts:232-234` derives its population from routes that
  ALREADY consume a limiter; `seam-ratelimit-posture.invariant.test.ts:167` derives from seam
  imports only. A new limiterless non-seam Next route is invisible to both. The Python side
  has the wanted shape (`analytics-service/tests/test_limiter_route_coverage.py:407-442`:
  whole-surface derivation ∪ quarantine ∪ `in_neither` anti-vacuity arm) — port that
  partition to `src/app/api`. Phase 146's verification scoped this honestly (D-146-1); this
  item is the widening, not a regression.
- [ ] **INT-3 — RATE-05's requirement text names an artifact that does not exist in source.**
  `withRateLimit` appears in ~15 `.planning/` files and ZERO source files; the shipped
  mechanism is `src/lib/api/withAuthLimited.ts` + `withAdminAuth({rateLimitKey})` (locked
  D-146-1: VERIFIED-EXISTING, no second wrapper). Re-point the REQUIREMENTS.md RATE-05 text
  (and any future grep-gates) at the real symbols so the ledger stops asserting a
  ungreppable name.
- [ ] **INT-4 — note: Phase 145's fold silently shrank Phase 146's seam census by one.**
  csv-finalize left the seam-import edge when the fold replaced the seam client
  (`seam-ratelimit-posture.invariant.test.ts:197-200` records it), so the milestone's busiest
  write route is now covered by `limiter-ordering.test.ts:103` alone. Documented, not broken —
  kept here as the worked example of one phase's refactor moving another phase's gate
  boundary (relevant to INT-2's design).

## Phase 158 — recorded deferrals (logged 2026-08-20)

- [ ] **[158-OPS-03/SEC] ⛔ ROTATE the two leaked demo accounts — NOT done, and only a human can
  do it (158-REVIEW CR-03).** `matratzentester24@gmail.com` / `Test12` and
  `demo-allocator@quantalyze.test` / `DemoAlpha2026!` were committed in plaintext to a **PUBLIC**
  repository. Both pairs remain in git history and **must be treated as published**, so removing
  the text is *not* remediation — **disabling or rotating the accounts on every project they
  exist in (TEST, preview, and PROD) is the only step that actually remediates this.** No agent
  can perform it; do not mark this closed on the basis of the scrub commits below.
  **Done in-pass (text surfaces only):** `scripts/seed-full-app-demo.ts` now reads
  `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD` and refuses without them;
  `docs/demos/2026-04-09-full-app-walkthrough.md` and the `CHANGELOG.md` entry are redacted;
  `.gitleaks.toml` no longer blanket-exempts `.planning/`. Live-surface grep for both pairs
  outside `.planning/` is now clean **except** `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts`,
  where the literals are the needle of an absence-assertion and are retained deliberately (that
  guard cannot be written without them; see the comment in that file).
  **Still open beyond rotation:** the `matratzentester24` pair remains quoted in
  `.planning/milestones/v0.17.0.0-phases/13-*` and `.planning/milestones/v0.16.0.0-phases/11-PATTERNS.md`.
  Those are historical artifacts and were deliberately left untouched in this pass; the full
  `.planning/` sweep belongs to **v1.20's SEC-02 requirement**, which owns it end to end.

- [x] **[158-OPS-04] drain execution deferred — the TEST `compute_jobs` backlog is NOT yet
  drained.** CLOSED 2026-08-20: 5-step protocol executed from the credentialed main checkout — measured no-op (BEFORE stale set 0; reaper live on TEST + worker churn had already dissolved the 08-11 backlog; 0 terminalized, residual 0, idempotency zero-delta); measured tables in 158-OPS04-DRAIN-EVIDENCE.md.
  Plan 158-03 landed both halves it could land: the `claimed_at` stamps in the two
  direct running-flip UPDATEs (`analytics-service/tests/test_compute_jobs_fencing.py:1148`,
  `:1200`) and the guarded tool `scripts/drain-test-compute-backlog.ts` (five interlocks, all
  OBSERVED refusing). What did NOT happen is the thing OPS-04 actually closes on: the
  before/after row counts. The executing worktree had no TEST service-role credentials
  (`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset; only `.env.example` present)
  and was explicitly barred from running the drain against a live database or improvising
  access. Measured counts were therefore NOT taken, and
  `.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS04-DRAIN-EVIDENCE.md` carries
  empty BEFORE/AFTER tables marked NOT MEASURED rather than invented numbers. ⚠️ The stale
  backlog keeps growing daily until someone runs this. **Fix:** run the 5-step protocol in
  that evidence file from a checkout with TEST credentials, paste the real tables in, then
  close OPS-04. ⚠️ Do NOT close it on "the fencing tests are green" — the exactly-10 red was
  structurally fixed by PR #674 (`c726a250`, 2026-08-12) and would be green either way.
- [ ] **[158-OPS-04] eligibility flip deferred: MODE 2 never measured (same missing
  credentials).** `scripts/drain-test-compute-backlog.ts --flip-eligibility` reduces tomorrow's
  fan-out by narrowing the job's own eligibility predicate on `api_keys` (never by touching the
  schedule), but neither the eligible-key population nor the proposed flip set was measured, so
  no key was flipped. Without it, MODE 1 is a decaying fix: the daily fan-out refills `pending`
  at roughly one row per eligible key. The allowlist is already settled in code (parsed from
  `scripts/seed-full-app-demo.ts`'s `API_KEY_IDS`, plus `is_example`/`published` strategies'
  keys, plus a 7-day age cutoff covering the per-run e2e fixtures), so this is a run, not a
  design. **Fix:** step 4 of the evidence file's protocol, then step 5 if step 4's output reads
  unambiguous.
- [ ] **[158-OPS-04] the two stamped fencing tests did not execute locally.** `python3 -m pytest
  tests/test_compute_jobs_fencing.py -q` from `analytics-service/` reports `16 passed, 28
  skipped`, and `test_defer_compute_job_token_fence` + `test_defer_compute_job_null_token_backcompat`
  are among the skips (`test Supabase project not configured (local dev)`). The stamps were
  verified by region-scoped grep only (falsifiable: the same grep returns 0 against the
  pre-change revision). CI carries the `TEST_SUPABASE_*` secrets and hard-fails rather than
  skipping, so the first real execution of the stamped payloads is the phase's CI run — watch
  it rather than assuming.
- [ ] **[158-OPS-04] e2e specs leak 2 `auth.users` rows per CI run, by convention (158-REVIEW
  WR-11).** `seedTestAllocator` mints users that nothing ever deletes: `seed-test-project.ts`
  calls `auth.admin.createUser` in **four** places and `deleteUser` in **none**, and the
  `cleanup*` helpers it does export delete strategies, not users. Specs affected today:
  `my-strategies` (new this phase, 2 users/run), plus the pre-existing `composer-axe`,
  `composite-onboarding` and `axe-app-wide`. This is exactly the unbounded TEST-artifact
  accumulation OPS-04's drain script exists to mop up, arriving through a second door that the
  drain does **not** cover (it targets `compute_jobs` and `api_keys`, not `auth.users`).
  ⚠️ Do **not** point-fix this in a single spec — that forks the convention in one file and
  leaves the class open. **Fix:** add user teardown to the shared helper (register minted ids,
  `admin.auth.admin.deleteUser` in a `cleanupSeededUsers`), audit the FK cascade for every
  caller, then adopt it across all four specs. Its own reviewed change.
  Counted first: `select count(*) from auth.users where email like '<seed pattern>%'` on TEST,
  so the close is measured rather than asserted.

## Phase 158 — OPS-03 orphan e2e spec dispositions (logged 2026-08-20)

OPS-03 closes as a CLASS, not a partial fix. Census re-derived at HEAD this session (not
carried forward from the dated research table): **53 spec files in `e2e/`, 20 referenced by no
workflow batch list.** Plan 158-06 wired 5 of them (`api-key-flow` + `sync-analytics-flow` →
unseeded batch; `full-flow` + `csv-upload-flow` + `my-strategies` → seeded MA-8 batch), each
run-and-repaired first by plan 158-05. The remaining 15 get a recorded disposition below, one
line each, plus a 16th correcting the `portfolio-pdf-demo` row and a 17th for the DB-types
residual found while recording the decision.

**The class-level finding — read this before wiring any of them.** These specs are not
orphaned individually by accident. Between them they reach for **four mutually incompatible
identity mechanisms**, none of which any CI job provisions: `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`,
`QUANTALYZE_E2E_PASSWORD`, `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, and hardcoded in-file
credential literals — plus a fifth, `PLAYWRIGHT_TEST_STRATEGY_ID`, for fixture identity. They
also use **two different seed-gate constant names** (`HAS_SEED_ENV`, which the MA-8 joining rule
keys on, and `HAS_SEEDED_SUPABASE`, which it does not). The real blocker is therefore ONE
missing convention, not 15 wirings: the seed-helper identity contract (`seedTestAllocator` /
`loginViaForm`, the pattern `wizard-resume` and the new `my-strategies` spec use, and the one
plan 158-05 converted `csv-upload-flow` onto). ⚠️ Wiring any spec below **before** converting it
produces an all-skip run, which is the SAME false-coverage state as orphanhood — a green batch
proving nothing. Verify ≥1 executed, non-skipped case per spec before calling it wired.

Dispositions are one of **wire-later** (belongs in a batch; needs a run-and-repair pass first),
**defer** (blocked on env/identity nobody provisions; tracked, low value until unblocked), or
**delete-candidate** (surface gone — deletion would need its own reviewed change, not done here).
No spec below is a delete-candidate: every route they target still exists (verified against
`src/app/` this session), so deletion would destroy coverage intent rather than dead weight.

- [ ] **[158-OPS-03] ⚠️ two of the five wired specs are ADVISORY, not gating (158-REVIEW WR-06).**
  `api-key-flow.spec.ts` and `sync-analytics-flow.spec.ts` went into the **unseeded `e2e` job**,
  which cannot fail a merge for two independent reasons: its test step carries
  `continue-on-error: true` (kept deliberately for the unfixed
  `getaddrinfo ENOTFOUND placeholder.supabase.co` flake), and the `e2e` job is in **no**
  aggregator's `needs:` — `frontend` gates on `e2e-seeded`, not on `e2e`. In the required form:
  after 158-06 these two **would surface** a regression in a run log; they **would not** have
  stopped it merging or deploying. The other three (`full-flow`, `csv-upload-flow`,
  `my-strategies`) went to `e2e-seeded`, which IS in `frontend`'s `needs:` — that half is
  genuinely blocking. Do not describe the OPS-03 wiring as "now gated".
  **To close:** promote the two contract describes into a lane that can fail. They are pure
  `request.post` contract assertions against localhost and do **not** touch the
  `placeholder.supabase.co` DNS path that motivated the tolerance, so either a
  no-`continue-on-error` step in the `e2e` job or the `e2e-seeded` batch would work.
  ⚠️ Requires a MEASURED run in the target env first — 158-05 measured them green under the
  unseeded job's placeholder env, which is **not** evidence about the seeded job's env, and
  promoting an unverified spec into a blocking gate is how a required check reddens on an
  innocent PR. The ci.yml comment at the unseeded batch list carries the same warning.

- [ ] **[158-OPS-03] `admin-csv-status-axe.spec.ts` — wire-later (seeded list).** Already
  conforms to the seeded contract (`HAS_SEED_ENV` present, uses the seed helpers) and
  `/admin/csv-status` still exists, so it is a list-membership change plus one run-and-repair
  pass; it is a single axe case, so the cost of proving it is small.
- [ ] **[158-OPS-03] `discovery-sparkline-regression.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant and pins a DESIGN.md rule (DIFF-05 single-accent sparklines) that
  nothing else asserts; its 4 cases read live seeded rows, so it needs the seeded batch and a
  run against the shared TEST DB before it can gate PRs.
- [ ] **[158-OPS-03] `discovery-watchlist.spec.ts` — wire-later (seeded list), HIGHEST value of
  the 15.** 544 lines including two genuine RLS proofs (unauthenticated `PUT /api/watchlist`
  → 401, and user-B cannot read user-A's favorites) plus an anon `/browse/[slug]` chrome
  check — security assertions currently running nowhere. Prioritize this one.
- [ ] **[158-OPS-03] `for-quants-landing.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant; most of its 11 cases are anon (`/for-quants`, `/security`,
  `security.txt`) but one describe is logged-in-gated, so the seeded batch is the right home.
  ⚠️ When wiring, dedupe against `security-page.spec.ts` below — both assert `/security`.
- [ ] **[158-OPS-03] `discovery.spec.ts` — wire-later (unseeded list).** 9 lines, one
  placeholder-safe assertion (unauthenticated `/discovery/crypto-sma` redirects to login) that
  no wired spec covers — checked `auth`, `smoke` and `route-redirects`, none of which touch
  discovery. Cheap to prove, cheap to wire; it just has never been run.
- [ ] **[158-OPS-03] `security-page.spec.ts` — wire-later (unseeded list).** Fully anon
  (`/security` and `/`), no seed env, no identity — genuinely placeholder-safe, so the unseeded
  batch fits with no conversion work. ⚠️ Overlaps `for-quants-landing`'s `/security` describe;
  wire one of them, not both, or the assertion runs twice under different owners.
- [ ] **[158-OPS-03] `bridge-flow.spec.ts` — wire-later (unseeded list), with one case to
  tighten first.** 4 of its 5 cases hit the public `/demo` page (placeholder-safe); the 5th
  (`/allocations`) is written to pass EITHER way — it asserts the login redirect when
  unauthenticated and the InsightStrip when not. ⚠️ That case cannot fail, so wiring it as-is
  buys coverage theatre; split it or gate it properly when wiring.
- [ ] **[158-OPS-03] `simulator-flow.spec.ts` — defer.** Gated on `QUANTALYZE_E2E_PASSWORD`, an
  identity env name used by this spec alone and set in no workflow, so wiring it today yields
  an all-skip batch entry. Unblocks by converting to the seed-helper identity contract.
- [ ] **[158-OPS-03] `strategy-detail-tabs.spec.ts` — defer.** Gated on
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`, which this phase recorded a decision NOT to provision
  (see 158-05); it would self-skip every case in CI. Same unblock: convert to seed helpers,
  which mint their own users and need no repo secret.
- [ ] **[158-OPS-03] `match-queue.spec.ts` — defer.** Gated on
  `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and targets `/admin/match`, so it needs an ADMIN
  identity; the seed helpers mint allocator/manager roles only, so this needs an admin-seeding
  path that does not exist yet — a real piece of work, not a list edit.
- [ ] **[158-OPS-03] `sync-flow-queue.spec.ts` — defer.** Gated on
  `PLAYWRIGHT_TEST_STRATEGY_ID`, which no workflow sets, so all 3 cases would skip. This is the
  same never-run env gate that keeps `api-key-flow`'s and `sync-analytics-flow`'s UI describes
  dormant even now that those two are wired — a fixture-identity problem, not a spec-rot one.
- [ ] **[158-OPS-03] `wizard-sync-regression.spec.ts` — defer.** Same
  `PLAYWRIGHT_TEST_STRATEGY_ID` gate, same all-skip outcome; wire it in the same change that
  provisions a seeded strategy id, not before.
- [ ] **[158-OPS-03] `mandate-form.spec.ts` — wire-later (seeded list), after renaming its seed
  gate.** It IS seed-gated and mints its own user via the service role (the acceptable
  pattern), but its gate constant is `HAS_SEEDED_SUPABASE`, not `HAS_SEED_ENV`. ⚠️ The MA-8
  joining rule keys on `HAS_SEED_ENV`, so adding this spec to the list would satisfy the
  documented contract's list half while the in-spec half silently does not apply. Rename the
  constant in the same change that wires it.
- [ ] **[158-OPS-03] `wizard-hydration-probe.spec.ts` — defer, blocked on removing in-file
  credentials.** Carries a hardcoded demo email + password literal at `:38-39` — the same class
  plan 158-05 removed from `csv-upload-flow` (whose hardcoded login was additionally MEASURED
  not to authenticate against the TEST project). Convert to the seed-helper contract and drop
  the literals; do not wire it with them in place.
  2026-08-20: credential blocker RESOLVED — the `:38-39` literals are scrubbed to env-sourced
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` with a visible `test.skip` (same commit as the
  `for-quants-onboarding` scrub below). Seed-helper conversion + wiring still open.
- [x] **[158-OPS-03] ⚠️ `for-quants-onboarding.spec.ts` — defer, blocked on a PUBLIC-REPO
  credential scrub (act on this independently of wiring).** `:31-32` hardcode a
  personal-looking gmail address and a short password literal, committed in a repository that
  is world-readable. Deliberately not quoted here so this entry does not re-publish them.
  The credential removal is worth doing on its own schedule — it is not contingent on anyone
  ever wiring this spec — after which the spec converts to the seed-helper contract like the
  others. Flagged by plan 158-06 while triaging; NOT fixed there because scrubbing a
  credential belongs in its own reviewed change, not buried in a CI-wiring commit.
  ✅ 2026-08-20: scrubbed — creds are env-sourced (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`) with a
  visible `test.skip` on the authed describe; comment-only echoes of the same pair in
  `match-queue.spec.ts`/`discovery-watchlist.spec.ts` reworded in the same commit. Wiring +
  seed-helper conversion stay deferred per the entry above.
- [ ] **[158-OPS-03] `portfolio-pdf-demo.spec.ts` — wire-later (unseeded list); the census row
  for this spec was WRONG and is corrected here.** The research table recorded "non-@nightly
  cases orphaned", implying a split. Measured at HEAD: BOTH describes carry the `@nightly` tag
  in their titles (`:99`, `:160`), and `nightly.yml:109` runs the spec with `--grep @nightly`,
  which matches on the full title — so every one of its 8 cases runs nightly and none is
  orphaned. ⚠️ The real defect is the opposite of the one recorded: the token-shape describe's
  own docblock (`:85-97`) states those cases need no `DEMO_PDF_SECRET` and *"MUST run in main CI
  to keep verifier-branch coverage on every PR"*, and an audit split the describes precisely to
  restore that — but the split describe still carries `@nightly` in its title, so the intended
  per-PR coverage never happened. **Fix:** drop `@nightly` from the token-shape describe title
  and add the spec to the unseeded list, so a regression weakening the hex-regex/indexOf
  verifier guard is caught per-PR rather than up to 24h later.
- [ ] **[158-OPS-03] DB-types residual — defer (fix in its own reviewed change):
  `scenario_shares` lost its hand-patch tripwire comment.** Found while recording
  `158-DB-TYPES-DECISION.md`. `database.types.ts:2326` is a
  hand-patched block per its own test docblock (`database.types.test.ts:75-81`, migration
  `20260622120000`) but carries NO in-file `HAND-PATCHED` warning comment, unlike its two
  siblings `for_quants_leads` (`:1072`) and `scenarios` (`:2375`). Its type-level pins are
  intact so the load-bearing control still holds; what is missing is the warning to the next
  person who regenerates — and `:1080-1081` records that a prior regen stripped exactly such a
  comment and a human re-applied it by hand. **Fix:** re-apply a tripwire comment above the
  block. Not done in plan 158-06: it edits a generated file outside that plan's declared scope.
