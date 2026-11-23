# Phase 218: SELFHEAL - Research

**Researched:** 2026-11-19
**Domain:** analytics-service MT5 validation terminal (asyncio lease, scrub, wire contract) + Next.js wizard (resume banner, error vocabulary)
**Confidence:** HIGH on code reach and mechanics (every claim read this session); MEDIUM on the proposed time-budget numbers (no measured validate duration exists in the repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(pasted byte-for-byte from `218-CONTEXT.md` `<decisions>`, which holds the locked decisions, the autonomous decisions and the discretion section)

## Implementation Decisions

### Inline scrub inside the wizard request — time budget
- The inline scrub is paid INSIDE the existing server worst case (105 s) and D-26's 120 000 ms client ceiling, which do NOT move. The scrub gets its own wizard-side bound, and the probe's end-to-end deadline is what is left of the budget after the scrub (with a floor, so a probe never starts with too little time to be meaningful). The ordering test in `tests/test_mt5_validate.py` that asserts the budget arithmetic is extended to cover the scrub term. — **Reversibility:** costly — D-26's client ceiling is a cross-seam contract owned by Phase 153.4's seam-budget gate; raising it would touch the Next.js routes, the wizard client timeout and that gate together.
- Exact bound values are for research to derive from measurement (the observed boot-mark scrub took about 6 s; `_VALIDATION_SCRUB_BUDGET_S` is 160 s at the worker's rpyc ceiling, which the wizard cannot afford). Env-overridable, following the existing `MT5_VALIDATE_*` convention.
- Safety invariants that must survive the bound: never probe after a non-`scrubbed` kind; never release the lease while a scrub thread is still running on the terminal unless the existing machinery (owed mark / relaunch debt) already guarantees the next holder scrubs first. Research must show which holds for `abandoned` and `skipped_probe_in_flight`, as the worker's comment says "after `abandoned` the scrub thread may still be running under this lease".

### The answer when the inline scrub does not come to `scrubbed`
- A NEW wire code distinct from `MT5_TERMINAL_BUSY`, mapped to a new wizard error key with its own copy, so the wizard names the real cause (the terminal could not be reset/prepared for this check) instead of "briefly busy". `MT5_TERMINAL_BUSY` and `KEY_MT5_TERMINAL_BUSY` stay for the held-lease emitter only; their comments and copy rationale (which today must be true at the owed gate too) are narrowed to that one emitter. — **Reversibility:** costly — a wire code is a contract between analytics-service, both wizard connect routes, `VENUE_WIRE_CODE_TO_VERDICT`, `seam-venue-vocabulary.invariant.test.ts` and the contracts registry.
- `recoverable` is set per scrub kind by what Retry can actually fix: transient kinds (`abandoned`, `skipped_probe_in_flight`, `failed`, `relaunch_unverified`, `refused`) answer recoverable; `skipped_no_house_credentials` (the house credential is unset on our side, Retry cannot help) answers not recoverable with copy that says the problem is on our side. Researcher may refine the per-kind split from what each kind means in `mt5_terminal_scrub.py`; the rule is "recoverable iff a retry can succeed without an operator". The per-cause ERROR alert and the scrub row are kept exactly as the scrub already writes them.
- `trace.outcome` gets a distinct value for the healed path and for the inline-scrub-failed path, so Railway logs tell "owed and healed" apart from "owed and could not heal" (the old `scrub_owed` outcome no longer describes a refusal).

### Wizard resume banner
- Without a matching local pointer, while the banner is showing, NO wizard step is mounted under it: the banner (Resume draft / Start fresh) is the only content until the founder chooses. Resume mounts the draft's resume step; Start fresh mounts the first step. Same-browser silent resume (matching pointer) is unchanged.
- Banner copy by key type: an API-key draft says the API secret must be pasted again; an MT5 draft says the investor password must be entered again; CSV keeps its re-select-the-file copy; when the resumed step needs no secret re-entry, the banner says nothing about re-entry. Wording follows the existing banner voice and DESIGN.md; no new visual treatment.

### Decided autonomously
- [Server] Q: "Where does the healed path live?" → Selected: "In place at the owed gate of `_validate_mt5_key_probe`, calling the existing scrub-under-lease machinery (reuse `run_owed_validation_scrub_in_lease` or a sibling that returns the kind), not a new module" — local to one function; undo is a revert.
- [Server] Q: "Does the scheduled-scrub path (`schedule_validation_terminal_scrub`) stay?" → Selected: "Yes for every post-check scrub; the owed gate no longer schedules, it pays inline" — internal control flow only.
- [Server] Q: "Does the `report_scrub_owed_refusal` reporter stay?" → Selected: "Only where a refusal still happens (the inline scrub failed); a healed check logs at INFO, not ERROR" — logging level and call site only.
- [Tests] Q: "How is the heal proven?" → Selected: "pytest from `analytics-service/` with the scrub stubbed per kind: scrubbed → probe runs in the same request; each non-scrubbed kind → new code, no probe; plus the budget-arithmetic ordering test; vitest for the new wizard error key and both banner behaviours; each gate neutered once to see RED" — tests only.
- [Wizard] Q: "How is 'hold the step' implemented?" → Selected: "Derive whether a choice is pending from the same inputs `deriveWizardResumeOverrides` uses, and render the banner alone while pending, instead of mounting `draftResumeStep` in the `useState` initializer" — component-local state.

### Claude's Discretion
- Exact copy of the new error key (title / cause / fix) and of the per-key-type banner lines, within the spec above and the existing wizardErrors voice (static copy, true at its only emitter, pinned by `wizardErrors.test.ts`).

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned to 218 (ROADMAP: `**Requirements**: TBD`; REQUIREMENTS.md read in full: its traceability table has no 218 row). The resume half relates to **FCONF-01** ("with a live draft, `+ Strategy` shows the resume banner and Resume lands on the draft's step"), which Phase 157 owns and which the founder observed 2026-11-19 (STATE.md line 180). 218 does not close it. Success criteria derived from the ROADMAP goal and CONTEXT:

| ID (derived) | Description | Research Support |
|----|-------------|------------------|
| SC-1 | An owed terminal (mark or debt) is scrubbed inline under the wizard's lease and the check runs in the same request; no user-visible error on the boot-mark path | Q1, Q2, Q5, Pattern 1 |
| SC-2 | No probe ever runs on a terminal whose inline scrub did not come to `scrubbed` | Q2, Pitfall 1 |
| SC-3 | Inline-scrub failure answers a NEW wire code (never `MT5_TERMINAL_BUSY`), per-kind `recoverable`, existing alert + row unchanged | Q3, Q4 |
| SC-4 | Server worst case stays 105 s inside D-26's 120 s; ordering test extended | Q1 |
| SC-5 | `trace.outcome` distinguishes healed from could-not-heal | Pattern 2 |
| SC-6 | No wizard step mounts under the resume banner; Resume / Start fresh then mount their step; matching-pointer silent resume unchanged | Q6 |
| SC-7 | Banner copy matches key type; no re-entry sentence when none is needed | Q6, Open Question 2 |
</phase_requirements>

## Summary

The heal is a small change in one function plus a parameterised sibling in `services/mt5_terminal_scrub.py`, but four coupled facts decide whether it works, and none is visible from CONTEXT alone. **(1)** `_scrub_under_lease` returns the kind but is private; `run_owed_validation_scrub_in_lease` throws the kind away (returns bool), and the wizard needs the kind to choose `recoverable`. A public never-raises sibling that returns the kind and accepts a bound is required. **(2)** The scrub's relaunch step is gated by `_affordable(deadline, 2)`, which reserves 2 x 30 s of the thread's `deadline` regardless of measured speed. Passing the wizard's short bound as the thread `deadline` would silently turn every healed scrub into `relaunch_unverified`. The event-loop `wait_for` bound and the thread `deadline` must be two different numbers. **(3)** The scrub also performs a W-1 wait (up to `_SCRUB_PROBE_WAIT_S`, 60 s) and a row insert (up to 5 s) that sit outside `_VALIDATION_SCRUB_BUDGET_S`; the wizard bound must cover wait + blocking + row. **(4)** One new wire code cannot carry both `recoverable=true` and `recoverable=false`: the TS parity contract pins one `recoverable` per wire code, and the wizard Retry control is derived from the key's static actions. The not-recoverable kind (`skipped_no_house_credentials`) should reuse the existing `MT5_VALIDATION_UNCONFIGURED` 500 arm.

Safety holds for the bounded path by existing machinery: the scrub-owed mark is cleared only on `scrubbed`, relaunch debt only on a house-verified relaunch, both are in-process and re-set at boot, and the lease's `finally` bumps the terminal epoch before releasing the lock so an abandoned scrub thread's later session touches are refused. The scheduled scrub already abandons and releases the same way, so the wizard adds no new residual class (the one in-flight crossing that cannot be un-sent, D-43, is accepted and pre-existing).

For the wizard, the step is mounted by the `useState` initializer (`draftResumeStep`) before the async localStorage load decides whether the banner shows. Holding the step needs a render gate keyed on `Boolean(initialDraft) && (!hydrated || showResumeBanner)`. The banner copy rule collides with a fact: the only step a banner resumes onto (`sync_preview`) has no secret entry, so the API and MT5 re-entry sentences never apply today (Open Question 2).

**Primary recommendation:** Add `pay_owed_validation_scrub_in_lease(host, port, *, site, budget_s) -> str` (never raises, returns the kind), thread `budget_s` through `_scrub_under_lease`/`_scrub_decide`/`_wait_for_unfinished_probes` while keeping the thread `deadline` at `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)`; anchor the 75 s envelope at lease acquisition so scrub time is subtracted from the probe deadline; answer a new flat 424 `MT5_TERMINAL_NOT_READY` (recoverable) for five kinds and the existing `MT5_VALIDATION_UNCONFIGURED` for `skipped_no_house_credentials`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pay owed scrub, then probe, in one request | API / Backend (analytics-service router) | Service leaf `mt5_terminal_scrub` | Owns the terminal lease; the scrub machinery is a service leaf the router imports |
| Time budget (75 s envelope, scrub bound, floor) | API / Backend | Browser (120 s abort, unchanged) | Server worst case must stay under the client ceiling `VALIDATE_KEY_SERIALIZED_BUDGET_MS` |
| New wire code and recoverable flag | API / Backend | Frontend Server (Next.js routes map it) | Python mints the code; `VENUE_WIRE_CODE_TO_VERDICT` is the only TS recognition path |
| Error card copy and Retry control | Frontend (wizardErrors.ts) | Browser | Static copy; Retry derived from key `actions` |
| Resume banner hold | Browser / Client (WizardClient) | Frontend Server (draft prop) | Pure client state; localStorage pointer is browser-only |
| Draft key type for banner copy | Browser (from `initialDraft.supported_exchanges`) | Database (column written by `create_wizard_strategy`) | No extra read needed (Open Question 2, A1) |

## Standard Stack

No new libraries. Everything is the existing stack. `[VERIFIED: grep + Read this session]`

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pytest (+ pytest-asyncio, `asyncio_mode = auto`) | repo-pinned; ran `2 passed in 33.41s` this session | analytics-service tests | `analytics-service/pytest.ini` |
| mypy | 2.0.0 local (`python3 -m mypy --version`) | CI strict gate | `ci.yml` step "Type gate - mypy strict over the running-service surface" |
| vitest | `^5.0.3` (`package.json`) | frontend tests | `npm test` = `vitest run` |
| React / Next.js | repo (AGENTS.md: breaking-change Next; read `node_modules/next/dist/docs/` only if touching routing, which this phase does not) | WizardClient | n/a |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New public sibling returning the kind | Make `run_owed_validation_scrub_in_lease` return the kind | That function is the worker's contract (bool) and is pinned in `tests/test_mt5_session_episodes.py::_GUARDED_SYMBOLS`; leave it, add a sibling |
| One new code, per-kind `recoverable` | Two new codes, or one always-recoverable code | See Open Question 1; per-kind on one code is unrepresentable in the parity contract |

**Installation:** none. **Package Legitimacy Audit:** no external package is installed or added by this phase; the audit gate does not apply.

## Architecture Patterns

### System Architecture Diagram

```
POST /api/validate-key (Next.js route -> analytics-client, 120 s abort)
        |
        v
_validate_mt5_key -> _validate_mt5_key_probe(trace)
   parse creds -> gateway endpoint -> known-server pre-check   (unchanged, no terminal touched)
        |
        v
   async with mt5_terminal_lease(wait_s=20)  ----- Mt5TerminalBusyError -> MT5_TERMINAL_BUSY (held-lease emitter, UNCHANGED)
        |  t0 = lease acquired  (NEW: envelope anchor, _park_clock)
        v
   owed? = mt5_scrub_owed(key) or mt5_relaunch_debt(key)
        |--- no ----------------------------------------------+
        |--- yes                                               |
        v                                                      |
   pay_owed_validation_scrub_in_lease(budget_s=S)  (NEW sibling, no lease of its own, never raises)
        |   _scrub_decide: W-1 wait(<=S) -> thread scrub(deadline stays 160 s) under wait_for(rest of S)
        |   _scrub_under_lease: alert on non-scrubbed + ONE cron_runs row (UNCHANGED), returns kind
        v
   kind == scrubbed ?                                          |
     no -> report_scrub_owed_refusal; trace.outcome="scrub_unhealed";   |
           kind==skipped_no_house_credentials -> 500 MT5_VALIDATION_UNCONFIGURED
           else -> 424 MT5_TERMINAL_NOT_READY recoverable=true  (NO probe)
     yes -> INFO log; stage event owed_scrub outcome=scrub_healed      |
        |<-----------------------------------------------------+
        v
   remaining = 75 - (clock - t0);  (floor check only if a scrub ran)
   wait_for(_connect_and_probe(), timeout=remaining)  -> verdict (trace.outcome = read_only / auth / ...)
   finally: park (needs >=60 s of the SAME envelope), release (<=10 s), schedule post-check scrub (unchanged)
```

### Recommended change set (files)
```
analytics-service/services/mt5_terminal_scrub.py   # budget_s plumb + public sibling + __all__
analytics-service/routers/exchange.py              # owed gate, envelope anchor, 2 constants, park noise, header comment
analytics-service/services/closed_sets.py          # MT5_TERMINAL_NOT_READY_DETAIL (+ narrow BUSY comment)
src/lib/wizardErrors.ts                            # key union, copy entry, VENUE_WIRE_CODE_TO_VERDICT row, dialog roster, comments
src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx   # hold gate + banner copy
```

### Pattern 1: bounded inline scrub, sibling of the worker's path
**What:** a public coroutine with the exact never-raises shape of `run_owed_validation_scrub_in_lease`, returning the kind. It takes NO lease (a lease-site roster pin forbids a new one).
**Evidence:**
- `run_owed_validation_scrub_in_lease` today: `return await _scrub_under_lease(host, port, site=site) == SCRUB_KIND_SCRUBBED` (`mt5_terminal_scrub.py:693`), kind discarded. `_scrub_under_lease` returns the kind (`:495-524`) and writes the alert and the row on every exit.
- Roster pin: `_PRODUCTION_LEASE_SITES` lists `("routers/exchange.py", "_validate_mt5_key_probe")` and `("services/mt5_terminal_scrub.py", "scrub_validation_terminal")` only (`tests/test_mt5_concurrency.py`, ~line 1040). The sibling must not contain `async with mt5_terminal_lease`.
- Never-raises predicate: `_GUARDED_SYMBOLS` in `tests/test_mt5_session_episodes.py:1632-1654` includes `mt5_terminal_scrub.run_owed_validation_scrub_in_lease`; the sibling must be appended there. The mutant table anchors on the literal lines `    except Exception as exc:` and `        except BaseException:` (`tests/test_mt5_relogin.py:5413-5422`), so the sibling must contain both lines verbatim (copy the shape, do not restyle).
**Bound plumbing (read call-time, never default-arg, so existing monkeypatches keep working):**
```python
# Source shape: services/mt5_terminal_scrub.py (current _scrub_decide at :469-492)
async def _scrub_decide(host, port, *, budget_s: float | None = None):
    key = mt5_terminal_key(host, port)
    started = time.monotonic()
    wait_s = _SCRUB_PROBE_WAIT_S if budget_s is None else min(_SCRUB_PROBE_WAIT_S, budget_s)
    if not await _wait_for_unfinished_probes(key, wait_s=wait_s):
        return SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT, None
    ...
    blocking_s = (_VALIDATION_SCRUB_BUDGET_S if budget_s is None
                  else max(0.0, budget_s - (time.monotonic() - started)))
    # thread deadline stays heal_deadline(_VALIDATION_SCRUB_BUDGET_S): see Pitfall 2
    result = await asyncio.wait_for(asyncio.to_thread(_scrub_validation_terminal_blocking, host, port, house,
                                    heal_deadline(_VALIDATION_SCRUB_BUDGET_S)), timeout=blocking_s)
```
Existing tests patch `_SCRUB_PROBE_WAIT_S` (`tests/test_mt5_validation_park.py:1709`) and `_VALIDATION_SCRUB_BUDGET_S` (`tests/test_mt5_terminal_scrub.py:547`) as module attributes; the plumb must read them at call time.

### Pattern 2: `trace.outcome` for healed vs not healed
`trace.outcome` is ONE final value per request (`_validate_mt5_key` emits it in a `finally`), and a healed request goes on to set the probe's own outcome (`read_only`, `auth`, ...). A "healed" value on `trace.outcome` would therefore be overwritten. Recommended: set `trace.outcome = "scrub_unhealed"` on the failure raise (final), and for the healed path emit a separate stage event `emit_mt5_stage_event("owed_scrub", t, ok=..., terminal_key=..., outcome="scrub_healed" | "scrub_" + kind)`. `emit_mt5_stage_event` already accepts any `stage` string and `outcome` (`services/mt5_client.py:213-221`), no test pins a stage-name set (grep of `emit_mt5_stage_event` found only `tests/test_mt5_validation_park.py`; a grep for the event name `mt5.stage` / stage literals was not run, so tag [ASSUMED]), and `duration_ms` on it is the heal-cost measurement Phase 155 lacks. `_capture_outcomes` in the park tests records only `stage == "validate"` (`tests/test_mt5_validation_park.py:1609-1620`), so the extra event does not disturb it. The old literal `"scrub_owed"` stays only in the old tests, which change (see Validation Architecture).

### Anti-Patterns to Avoid
- **Passing the wizard bound as the thread `deadline`:** relaunch is never attempted (Pitfall 2).
- **A second `mt5_terminal_lease` for the inline scrub:** `asyncio.Lock` is not re-entrant; deadlock (comment at `exchange.py:1366-1367`), and the roster pin.
- **Calling `schedule_validation_terminal_scrub` from the owed gate:** it would queue a task that races the user's Retry into `lease_busy`; CONTEXT decided against it.
- **Deriving the floor unconditionally:** existing tests patch `_MT5_VALIDATE_DEADLINE_S` to 0.05 / 0.3 (`tests/test_mt5_validate.py:1621, 1820, 2596`); apply the floor only when a scrub ran.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scrub + relaunch + row + alert | A new scrub routine in the router | `_scrub_under_lease` via the sibling | It already writes exactly one row and one per-cause alert; CONTEXT requires both unchanged |
| Budget clock | `time.monotonic()` in the router | `_park_clock` seam (`exchange.py:202`) | Tests drive the floor boundary through it; the park gate reads the same clock |
| Wire body | A hand-built dict | `VenueTransientHTTPException(status_code=424, code=..., detail=..., recoverable=True)` / `service_error(500, "MT5_VALIDATION_UNCONFIGURED", ...)` | Flat shape is load-bearing (`exchange.py:320-353` comment block); both already exist |
| Draft key type | A new server read | `initialDraft.supported_exchanges` + `venueIsSerialized` (Open Question 2) | Avoids touching the byte-pinned `WIZARD_DRAFT_COLUMNS` and the single-source scan test |
| Roster of wizard keys | Hand edits to `KNOWN_*_CODES` | Add the `VENUE_WIRE_CODE_TO_VERDICT` row; `wizardKeyRosters.ts` derives both rosters from it | Then move the frozen arrays in the roster test |

**Key insight:** every part of this phase except the budget arithmetic is "route an existing outcome through an existing seam"; the risk is in the censuses that pin those seams, not in new logic.

## Question-by-question findings

### Q1. Budget (HIGH on structure, MEDIUM on numbers)

Facts, each read this session:
- Header chain: `_MT5_VALIDATE_DEADLINE_S: Final[float] = float(os.getenv("MT5_VALIDATE_DEADLINE_S", "75.0"))` (`routers/exchange.py:171`); `_MT5_RELEASE_TIMEOUT_S ... "10.0"` (`:178`); `_MT5_VALIDATE_STAGE_TIMEOUT_S: Final[float] = MT5_VALIDATE_REQUEST_TIMEOUT_S + 5.0` (`:156`, 55 + 5 = 60); lease wait 20 s. Header text: "Server worst case = 75 + 10 = 85s; plan 153.3-04 adds a bounded 20s lease wait for 105s total, inside D-26's 120 000ms client ceiling with 15s of margin."
- Client ceiling: `export const VALIDATE_KEY_SERIALIZED_BUDGET_MS = 120_000;` (`src/lib/wizard/validate-budget.ts:65`).
- Ordering test (`tests/test_mt5_validate.py:1908-1975`): `test_mt5_validate_timeout_chain_is_strictly_nested` hand-types 45_000 / 45_000 / 55_000 / 60_000 / 75_000 and strict `<` between links; `test_mt5_validate_worst_case_stays_inside_the_client_budget` asserts `worst_case_ms == 105_000`, `< 120_000`, `router._MT5_LEASE_WAIT_S == 20.0`, and `mt5_concurrency._MT5_LEASE_WAIT_S == router._MT5_LEASE_WAIT_S`.
- Scrub bounds today: `_VALIDATION_SCRUB_BUDGET_S = SCRUB_RELAUNCH_RESERVE_CROSSINGS * MT5_REQUEST_TIMEOUT_S + _VALIDATION_SCRUB_CONNECT_SLACK_S` = 5 x 30 + 10 = 160 s (`mt5_terminal_scrub.py:155-158`); it is both the `wait_for` timeout and the thread's `heal_deadline` (`:483-485`). `_SCRUB_PROBE_WAIT_S: Final[float] = MT5_VALIDATE_REQUEST_TIMEOUT_S + 5.0` = 60 s (`:167`) bounds the W-1 wait separately. `_SCRUB_RECORD_TIMEOUT_S: Final[float] = 5.0` (`:170`) bounds the row insert, which `_scrub_under_lease` awaits before returning (`:523`).
- Neither bound is parameterisable today; both are module constants. Yes, the wizard can pass a shorter bound once a keyword-only `budget_s` is added (Pattern 1).
- Measured scrub cost: kill plus delete about 2 s, credentialed `initialize` to authorized 2.1 to 3.4 s, kill-to-authorized 6.0 s (S-05, S-09, S-11 in `.planning/milestones/v1.20-phases/164.6.6.1-.../164.6.6.1-CONTEXT.md`); scrub rows after boot-owed runs landed "within 1-3 s" (`164.6.6.1-07-SUMMARY.md` L-1); the 2026-11-19 trigger was about 6 s. No measured wizard validate duration (connect + login + read + probe) exists: validate-budget.ts says "no uncensored successful MT5 validation exists anywhere".

**The coupling that decides the design.** `scrub_and_relaunch_as_house` runs the relaunch only `if _affordable(deadline, _CREDENTIALED_RELAUNCH_READING_CROSSINGS)` (`mt5_relogin.py:1699`), and `_affordable` is `return deadline - _clock() >= crossings * _MT5_REQUEST_TIMEOUT_S` (`:575-578`), 2 x 30 = 60 s. The scrub verb itself is not gated (`:1683`). So a thread `deadline` shorter than about 62 s means: verb runs, relaunch is skipped, `post_status` stays `_POST_RELAUNCH_NOT_REACHED`, `_classify` returns `relaunch_unverified`. A 30 s thread deadline would never heal. Therefore:
1. Event-loop bound `S` (what the wizard can afford) and thread `deadline` (what `_affordable` needs) are different numbers. Keep the thread deadline at `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)`.
2. Cost of that choice, stated: on a slow terminal the loop gives up at S (`abandoned`) while the thread may continue until its first post-release session touch is fenced (Q2).

**Proposed numbers (ASSUMED, to be confirmed in plan-phase; all env-overridable, `MT5_VALIDATE_*` convention):**

| Constant | Default | Derivation |
|---|---|---|
| `_MT5_INLINE_SCRUB_BUDGET_S` (env `MT5_VALIDATE_SCRUB_BUDGET_S`) | 30.0 | covers W-1 wait + blocking scrub; about 5 x the measured 6 s; also at most `E - record - floor` (clamp) |
| `_SCRUB_RECORD_TIMEOUT_S` (existing) | 5.0 | counted, because `_scrub_under_lease` awaits the row before returning |
| `_MT5_VALIDATE_PROBE_FLOOR_S` (env) | 40.0 | `E - S - record = 75 - 30 - 5 = 40`, so the floor holds by construction; refuse (new code) if an overrun leaves less |
| envelope `E` | 75.0 unchanged | `_MT5_VALIDATE_DEADLINE_S`; worst case stays 20 + 75 + 10 = 105 s |

The arithmetic works because the anchor moves, not because a term is added: take `t0 = _park_clock()` right after the lease is acquired (before the owed gate), run the scrub inside it, and give the probe `timeout = E - (clock - t0)`. Set `deadline_started_at = t0` so the park gate (`E - (clock - deadline_started_at) < _MT5_PARK_MIN_BUDGET_S`, `exchange.py:1388-1391`) reads the same envelope; otherwise scrub + probe + a 60 s park could reach 20 + 6 + 75 + 60... and exceed 120 s. Extension of the ordering test: keep the 105_000 assertions byte-unchanged and add (a) hand-typed `S == 30.0`, `FLOOR == 40.0`, strict `S + 5.0 + FLOOR <= router._MT5_VALIDATE_DEADLINE_S`; (b) a behavioural test that makes the stubbed inline scrub consume N seconds through `_park_clock` and asserts the probe's `wait_for` timeout equals `E - N` (spy on `asyncio.wait_for`), and that a scrub that overruns past the floor refuses without probing; (c) a pin that the thread deadline given to the scrub is NOT the wizard bound (drive the real `scrub_and_relaunch_as_house` with a fake `_clock` and assert the relaunch was attempted).

### Q2. Safety after `abandoned` / `skipped_probe_in_flight` (HIGH)

- **`abandoned`:** `_scrub_decide` catches `TimeoutError` and returns `SCRUB_KIND_ABANDONED` (`:487-488`); the `to_thread` worker is not cancellable and may still be running. Yes, it can still be on the terminal when the wizard's lease releases. What guarantees the next holder scrubs first: (a) the owed mark is cleared only at `clear_mt5_scrub_owed(key)` after `kind == SCRUB_KIND_SCRUBBED` (`:490-491`), which the abandoned branch never reaches; (b) relaunch debt is recorded before the verb crosses (`note_mt5_relaunch_debt(self.terminal_key)`, `mt5_client.py:3801-3806` region) and cleared only `if post_status == _POST_RELAUNCH_VERIFIED: clear_mt5_relaunch_debt(...)` (`mt5_relogin.py:1710-1711`); (c) the wizard only pays inline when one of the two was already set, and nothing on the abandoned path clears either; (d) both marks are in-process and `mark_validation_terminal_owed_at_boot` re-marks the validation terminal at every start. (e) The lease `finally` runs `bump_mt5_terminal_epoch(terminal_key)` BEFORE `lock.release()` (`mt5_concurrency.py:493-496`, comment "BUMP BEFORE RELEASE ... no successor can hold the terminal while the outgoing generation is still current"), and `Mt5Client` fences every later session touch: `_assert_live` guards `initialize_credentialed` (`:2989`), `session_snapshot` (`:3147`), `terminal_scrub` (`:3783`). So a zombie scrub thread is stopped at its next crossing. Residual, pre-existing and accepted (D-43 comment, `exchange.py:1327-1330`): a crossing already on the wire cannot be un-sent, so a late relaunch can land during the next holder's scrub; the next holder's own scrub ends and relaunches the terminal regardless, so the state converges.
- **`skipped_probe_in_flight`:** the scrub made no crossing (W-1 gate precedes everything, `:471-472`). The live thread is an earlier request's PROBE thread, registered through `_register_probe`; its lease already released and bumped, so it is fenced. Mark and debt stay. The registry `_UNFINISHED_PROBES` persists, so every later scrub waits for that thread's event again.
- **Does the worker mirror hold?** Yes: the worker treats False as "do not probe in this lease", raises its transient `Mt5ClientError(0, ...)` and releases (`services/ingestion/mt5.py:291-300`, comment "after `abandoned` the scrub thread may still be running under this lease, and after `skipped_probe_in_flight` a probe thread is still on the terminal ... the next attempt pays the scrub again"). The scheduled scrub abandons and releases identically (`scrub_validation_terminal`). Difference to price in: the wizard bound is 30 s instead of 160 s, so `abandoned` becomes more likely on a slow-but-working relaunch, widening how often the D-43 residual window opens. It is bounded by the 30 s rpyc ceiling of one crossing.
- Never-probe-after-non-scrubbed is enforced by raising in the owed gate before the `try` that builds the client (the gate sits before `deadline_started_at`/`_connect_and_probe`); also nothing is scheduled, because the post-check `finally` schedules only `if login_attempted`, which is still False.

### Q3. Kinds and recoverability (HIGH)

Classification order in `_classify` (`:430-450`): verb raised -> `failed`; delete refused -> `refused`; delete faults (accounts_errors, trades_errors, profile tripwire) -> `failed`; relaunch not verified -> `relaunch_unverified`; else `scrubbed`. Kind set, quoted: `SCRUB_KIND_SCRUBBED = "scrubbed"`, `"refused"`, `"relaunch_unverified"`, `"failed"`, `"abandoned"`, `"skipped_probe_in_flight"`, `"skipped_no_house_credentials"` (`:181-200`).

| kind | meaning | alert cause (`_KIND_CAUSES`, unchanged) | retry-fixable | `recoverable` |
|---|---|---|---|---|
| `scrubbed` | deleted and house-VERIFIED; clears the mark | none (INFO log) | n/a | proceed to probe |
| `refused` | the scrub literal refused the delete (a process did not exit, none matched, walk failed) | `refused` | usually (process state is transient) | true |
| `relaunch_unverified` | delete landed; house relaunch did not verify (other login, disconnected, `-6`, not answering, not affordable) | `relaunch_unverified` | mostly; NOT when the broker refuses the house triple (`-6`), which the kind does not expose (`ScrubRelaunchResult.relaunch_code` would) | true (cannot split) |
| `failed` | verb raised, delete reported errors, client unbuildable, unexpected raise, profile tripwire | `failed` | mixed: the `_classify` comment says the tripwire "stays refused until an operator acts: fail loud, by intent" | true per CONTEXT; see Open Question 5 |
| `abandoned` | wizard bound fired | `abandoned` | yes (a later scrub finds the terminal settled) | true |
| `skipped_probe_in_flight` | an earlier probe thread was still on the terminal at the wait bound | `probe_in_flight` | yes | true |
| `skipped_no_house_credentials` | the house triple is unset | `house_credentials_unset` | no | false |

Row and alert are written by `_scrub_under_lease` for every kind (`:515-523`); the sibling must not add a second writer. Cause strings are the closed set `_SCRUB_ALERT_CAUSES` (`:236-238`).

### Q4. Full reach of the new wire code (HIGH, enumerated by grep + Read)

New code (name is Claude's discretion; this document uses `MT5_TERMINAL_NOT_READY` / `KEY_MT5_TERMINAL_NOT_READY`). Files that must move:

**analytics-service**
1. `routers/exchange.py` - owed gate raise (flat `VenueTransientHTTPException`, 424, `recoverable=True`) and the `skipped_no_house_credentials` arm (`service_error(500, "MT5_VALIDATION_UNCONFIGURED", dependency="mt5-gateway", retryable=False, ...)`); header comment; comments at `:1096-1143` and `:1457-1464`.
2. `services/closed_sets.py` - new `MT5_TERMINAL_NOT_READY_DETAIL`; narrow the `MT5_TERMINAL_BUSY_DETAIL` comment (`:117-135`) to the held-lease emitter. The detail is forwarded VERBATIM by the dashboard key forms and must dodge every cascade needle.
3. `tests/test_mt5_server_known.py` - twin of `test_terminal_busy_detail_collides_with_no_cascade_needle` for the new detail. `_CASCADE_NEEDLES` includes `"rate"`, `"probe"`, `"timeout"`, `"trading"`, `"withdraw"`, `"signature"`, `"broker server"`; note `"rate"` is a substring of "operate", "separate", "generate".
4. `tests/fixtures/validate_key_venue_transient_contract.json` - C9 (`site_id: "C9"`, `trigger: "mt5_scrub_owed"`, code `MT5_TERMINAL_BUSY`) is re-pointed to the new code and re-worded; C10 (held lease) keeps `MT5_TERMINAL_BUSY`, so BUSY stays represented. Its prose notes also name C9.
5. `tests/test_validate_key_venue_transient.py` - `EXPECTED_FIXTURE_TRIGGERS` (line 210 `"mt5_scrub_owed"`), the C9 test (`:849-890`, which currently stubs `schedule_validation_terminal_scrub` and arms the factory to FAIL if a client is built), `EXPECTED_MT5_TERMINAL_BUSY_DETAIL` family, and `test_terminal_busy_detail_claims_nothing_false_at_scrub_owed` (`:1657`): its premise (the BUSY detail must be true at the owed gate) lapses; keep the assertion only if the copy is unchanged (it is), but fix the docstring.
6. `docs/STATUS_CONTRACT.md` - row S-30 (`:436`) is documented as TWO raise sites sharing one code; split: S-30 keeps the held lease, a new S-31 for the inline-scrub refusal; prose tallies at `:445-449` ("30 rows", "27 explicit editable sites") move. No test reading the row count was found: of the ten test files that mention STATUS_CONTRACT, the three that cite S-rows were inspected (`test_mt5_validate.py`, `test_validate_key_venue_transient.py`, `test_status_contract_exchange_internal.py`) [ASSUMED for the other seven]; treat it as a documentation gate and grep `'^| S-'` before shipping.
7. Comment-only: `mt5_terminal_scrub.py` module docstring `:17-19` and `mark_validation_terminal_owed_at_boot` docstring `:651-654` ("the first wizard validation after each deploy is refused"), `services/mt5_client.py` scrub-owed block (`:965-983` says the next validation "refuses (wizard)"), `services/ingestion/mt5.py` `:281-286` ("unlike the wizard, which refuses"), `main.py` and `services/mt5_validation_liveness.py` mention owed scrub. Fix as dated CORRECTED notes (repo convention).

**Next.js / vitest**
8. `src/lib/wizardErrors.ts` - (a) `WizardErrorCode` union beside `| "KEY_MT5_TERMINAL_BUSY"` (`:180`); (b) copy entry beside `KEY_MT5_TERMINAL_BUSY: {` (`:2071`), `actions: ["clear_and_retry", "request_call"]` so `buildEnvelope` derives `recoverable: true`; (c) row `["MT5_TERMINAL_NOT_READY", { code: "KEY_MT5_TERMINAL_NOT_READY", status: 424 }]` in `VENUE_WIRE_CODE_TO_VERDICT` after `:5225`; (d) `DASHBOARD_DIALOG_ROUTE_CODES` rotate-secret roster (`:6379-6387` is where `KEY_MT5_VALIDATION_UNCONFIGURED` / `KEY_MT5_TERMINAL_BUSY` sit) because `rotate_key_secret` runs the same probe; (e) comments at `:165-178` and `:2061-2070` narrowed to the held-lease emitter. NOT added to `OUR_DEFECT_KEY_ERROR_CODES` (`:5989`) by default: BUSY's reasoning is "contention, not our defect"; here the Python scrub already pages per cause. If added, the copy may then say "we have been alerted", otherwise it must not: the fragment is pinned as forbidden elsewhere (`:2034-2035`, `src/app/api/strategies/create-with-key/route.test.ts:3745`).
9. No edit needed in `create-with-key/route.ts` or `composite/add-key/route.ts`: both import and call `classifyKeyValidationError(err)` (`composite/add-key/route.ts:741`, import `:28`; `create-with-key/route.ts` import `:21`) and page via `OUR_DEFECT_KEY_ERROR_CODES.has(code)` (`add-key:762`); `classifyKeyValidationError` reads `VENUE_WIRE_CODE_TO_VERDICT.get(seamCode)` (`wizardErrors.ts:5745`). Grep found no per-code list in either route. `keys/validate-and-encrypt/route.ts` was not opened; it forwards the Python detail verbatim per `closed_sets.py` comment [ASSUMED from that comment].
10. `src/lib/wizardKeyRosters.ts` derives `KNOWN_CREATE_WITH_KEY_CODES` / `KNOWN_ADD_KEY_CODES` from `VENUE_WIRE_CODE_TO_VERDICT.values()`, so the new key auto-joins both. `src/lib/wizardKeyRosters.test.ts` freezes them: `FROZEN_CREATE_WITH_KEY_215` and `FROZEN_ADD_KEY_215` (sorted, hand-typed, `KEY_MT5_TERMINAL_BUSY` at `:39` and `:80`) must gain the new key in sorted position; the floors (28 and 23) do not move.
11. `src/lib/seam-venue-vocabulary.invariant.test.ts` - hand-typed emitted-code roster (`"MT5_TERMINAL_BUSY"` at `:834`) gains the new code; the lineage block at `:930-953` records 47 codes; becomes 48; `DERIVED_FLOOR = 28` stays (0.6 x 48 = 28.8 floors to 28, the file's own rule).
12. `src/lib/dialog-envelope.invariant.test.ts` - the rotate-secret roster census, `expect(checked).toBe(37)` (`:~897`) becomes 38 (row at `:879` documents the pattern).
13. `tests/lib/validate-key-venue-transient-parity.test.ts` - an `EXPECTED` entry for the new code (`wireRecoverable: true, envelopeRecoverable: true`); `TOTAL_CASES = 18` (stays 18 if C9 is re-pointed, 19 if a case is added), `DISTINCT_WIRE_CODES = 10` becomes 11. Hand-typed, never derived.
14. New tests, parallel to the existing BUSY ones: `src/app/api/strategies/create-with-key/route.test.ts` (`:3784` BUSY twin), `src/app/api/strategies/composite/add-key/route.test.ts` (`:1616`), `src/app/api/keys/[id]/rotate-secret/route.test.ts` (`:869`), `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx` (`:410`), `src/components/strategy/UpdateMt5SecretDialog.test.tsx` (`:332`).
15. Sweepers that auto-include the new key and must be RUN (no edit expected): `src/lib/wizardErrors.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/wizardErrors.roster-render.test.tsx`. On the two dashboard forms (`StrategyForm`, `AllocatorExchangeManager`) a 424 stays unrecognised by design (`StrategyForm.test.tsx:495` pins that for BUSY); the new code behaves the same, no edit.
16. **`src/__tests__/contracts/contracts-registry.test.ts` needs NO edit** unless a NEW guard file is added: it pins the set of guard FILES (it registers `seam-venue-vocabulary.invariant.test.ts` and `validate-key-venue-transient-parity.test.ts` by path, and a floor of rows), not wire codes. CONTEXT lists it as a seam; research found it unaffected by a code addition. Registering a new `*.invariant.test.ts` would be the only trigger.

### Q5. Pending scheduled scrub vs inline payment (HIGH; reasoning anchored on an existing test)

`tests/test_mt5_validation_park.py::test_scrub_a_wizard_validation_already_queued_is_refused_quietly_and_one_scrub_runs` (`:2022-2067`) documents the mechanics: B queues on the lease while A runs; A's `finally` schedules a task and marks the key pending; B gets the lock ahead of A's scrub task (`asyncio.Lock` is FIFO, cited from that test's docstring) and sees the mark. With the heal: B pays the scrub inline (W-1 registry holds A's probe event, set when A's probe ended), clears the mark on `scrubbed`, probes, and B's own `finally` calls `schedule_validation_terminal_scrub`, which runs `note_mt5_scrub_owed(key)` FIRST and then returns early because `key in _PENDING_SCRUB_KEYS` (`:603-607`), registering B's probe event. The single pending task then runs after B releases and scrubs B's residue. So the queued task is NOT redundant and no dedupe change is needed: it is B's post-check scrub. Result: two scrub rows (inline then task), two crossings sets, B's check passes, no error. If the inline scrub FAILS while a task is pending, `report_scrub_owed_refusal` still behaves correctly (pending: one WARNING, no capture; `:353-361`); not pending: ERROR plus capture. Concurrency safety: a pending task cannot be mid-scrub while B holds the lease (it needs the same lock).

### Q6. Wizard resume (HIGH)

Mechanics, read from source:
- `const draftResumeStep: WizardStepKey = draftKind === "csv" ? "csv_upload" : "sync_preview";` (`WizardClient.tsx:253-254`); the `useState` initializer returns `connect_key` under a preselect, else `draftResumeStep` when `initialDraft` is set (`:256-275`). It runs once, synchronously, SSR-deterministic.
- `showResumeBanner` starts false (`:289`) and is set only inside the async effect after `loadWizardState()` (HMAC verify), `if (overrides.showResumeBanner) setShowResumeBanner(true)` (`:564-566`), then `setHydrated(true)` (`:570`).
- `deriveWizardResumeOverrides` sets `showResumeBanner` in exactly two cases: no local payload and a draft id (`if (!loaded) return initialDraftId ? { showResumeBanner: true } : {};`, `localStorage.ts:788`), or a payload whose `strategyId !== initialDraftId` (`:926-928`). A matching pointer restores `connect_key` / `sync_preview` (API) or `csv_upload` (CSV) silently with no banner (`:893-924`).
- Therefore in both banner cases the draft step is already mounted (and its effects, e.g. the sync poll, already fired) when the banner appears. Also before hydration, the step is mounted for every draft mount, including the silent-resume ones.

**Minimal change.** `const stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner);` and render both step branches (`source === "api" ? ... : ...` starting `:1437`) only when `!stepHeld`. The `!hydrated` half is not optional: pending is only knowable after the async load, so the draft step must not mount before it. Cost, stated: every draft mount (including matching-pointer silent resume) gains one async tick of no step content. Mounts with no draft are untouched (`initialDraft` null), preserving the "no draft: no banner, wizard still mounts" cases (`ContributionWizardOverlay.test.tsx:462-470`). Resume (`handleResume` -> `setShowResumeBanner(false)` + `setStep(draftResumeStep)`, `:1236-1270`) and the confirmed delete (`handleDeleteDraft` sets step to `csv_upload` / `connect_key` and `setShowResumeBanner(false)`, `:1165-1226`) then mount the right step with no further change. Start fresh only opens the confirm dialog and keeps the banner (`:1306-1308`), unchanged. Preselect mounts are NOT exempt (Pitfall 10). Optional hygiene: the `step_view` effect fires on `hydrated` with `step`; with a held step it reports a view of a step that is not shown. `loadWizardState` never throws (all paths inside `try`, returns null), so `hydrated` cannot stay false.

**Existing tests that pin the current behaviour (they assert a step visible UNDER the banner and must change):**
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx`: "a CSV draft resumes ON the CSV branch: banner + csv_upload + the draft bound" (asserts `wizard-csv-dropzone` beside the banner, ~`:512-532`); "a COMPOSITE draft resumes on sync_preview" (finds `mock-sync-preview` with the banner up, ~`:547`); the TRAP-4 ANTI-REGRESSION case (clicks `sync-try-another` while `showResumeBanner` is true, ~`:1308-1330`) must Resume first. Tests that only click Resume/Start fresh (`:430-460`, `:1289-1380`) are unaffected.
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx:398-415`: "an existing API draft renders the real resume banner and lands on the draft" asserts `sync-strategy-id` before clicking Resume.
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx` (`:549-552`, resume click path) and `...csv-preselect-burn.test.tsx`, `WizardClient.csv-durable-mint.test.tsx`, `ConnectKeyStep.preselect-refusal-class.test.tsx`: grep hits on `wizard-resume`; re-run, expect green or small edits.
- `e2e/wizard-resume.spec.ts` (Playwright, banner then `wizard-delete-draft` visible after Resume then sync polls the seeded id): behaviour after Resume is unchanged.
- `src/lib/wizard/localStorage.test.ts` and `derive-resume-overrides-arity.contract.test.ts`: `deriveWizardResumeOverrides` itself is not changed by the recommended approach, so these stay green.
New tests: banner-only while pending (no `mock-sync-preview`, no `wizard-csv-dropzone`, no `mock-connect-key`); Resume mounts `draftResumeStep`; confirmed Start fresh mounts the first step; matching pointer mounts the step with no banner (unmocked `deriveWizardResumeOverrides`, since the existing file mocks it); no-draft mount unchanged. Neuter-once: revert the gate and see RED.

**Key type and re-entry.** `InitialDraft` has no venue field (`src/lib/wizard/draft-query.ts:33-47`); it carries `supported_exchanges` and `api_key_id`. `create_wizard_strategy` writes `supported_exchanges` as `ARRAY[p_exchange]` (`supabase/schema/functions/create_wizard_strategy.sql:306-319`, quoted `'{}', '{}', '{}', ARRAY[p_exchange]`), and `MetadataStep` re-adds the detected venue on every save (`withDetectedVenue`). MT5 is not a user-selectable chip (`closed-sets.ts:144-148`: "it stays OUT of UI_EXCHANGE_CODES"), so `supported_exchanges` containing `mt5` is a sound proxy for an MT5 key `[ASSUMED: A1]`. Use the capability predicate, never a name: `venueSecretIsVerbatim` (true only for mt5) or `venueIsSerialized` (`closed-sets.ts:243-258`; both case-insensitive). Draft kinds: `"api" | "csv" | "composite"` (`draft-query.ts:62`); comment there says no CSV wizard draft exists server-side, so `csv` is effectively unreachable from the read but still handled by the existing branch.

**The collision (Open Question 2).** The only steps a banner can resume onto are `sync_preview` (api/composite) and `csv_upload` (csv). `SyncPreviewStep.tsx` has no password or secret input (grep for `password|api_secret|apiSecret` returned only `onTryAnotherKey` navigation matches), so the existing sentence "you will need to paste your API secret again" is false at the Resume landing, and CONTEXT's own rule ("says nothing about re-entry when the resumed step needs none") empties the API and MT5 variants. Recommend a pure function `resumeBannerBody({ source, keyType, resumeStep })` with a tested matrix: CSV keeps its sentence; a secret sentence appears only when `resumeStep` is `connect_key` (never true for a banner today), with the noun chosen by key type ("investor password" for MT5, "API secret" otherwise). Needs user confirmation: this removes the founder-visible sentence entirely for API/MT5 drafts.

### Q7. Validation commands

See Validation Architecture.

## Common Pitfalls

### Pitfall 1: probing after a non-`scrubbed` kind
**What goes wrong:** treating "not scrubbed" as "scrub attempted, carry on". **Why:** the old gate refused; the new gate must refuse on EVERY non-`scrubbed` kind. **Avoid:** branch on `kind != SCRUB_KIND_SCRUBBED` and raise before `_connect_and_probe`; drive each of the six non-scrubbed kinds in a test and assert the client factory is never called (the C9 test already arms the factory to fail if built). **Warning sign:** a `("login",)` event in the recording transport.

### Pitfall 2: the thread deadline starves the relaunch
**What goes wrong:** every healed scrub ends `relaunch_unverified`, the wizard refuses forever, the mark never clears. **Why:** `_affordable` (`mt5_relogin.py:575-578`) needs 60 s left of the thread deadline after the verb. **Avoid:** keep `heal_deadline(_VALIDATION_SCRUB_BUDGET_S)` for the thread; bound only the event-loop wait. **Detect:** a test that runs the REAL `scrub_and_relaunch_as_house` with the wizard's bound and requires `scrubbed`.

### Pitfall 3: unmodelled scrub terms blow the 105 s
**What goes wrong:** the W-1 wait (up to 60 s) and the row insert (5 s) sit outside `_VALIDATION_SCRUB_BUDGET_S`. **Avoid:** one `budget_s` covering wait + blocking, plus the 5 s record counted in the floor arithmetic.

### Pitfall 4: the park gate and the envelope anchor
**What goes wrong:** (a) anchoring `deadline_started_at` after the scrub lets scrub + probe + park exceed 120 s; (b) anchoring before the scrub makes the park skip whenever scrub + connect + probe exceeds 15 s (`75 - 60`), and a skip pages: `report_park_skipped` -> `_alert_park_failed` (ERROR plus windowed capture; "every other skip or failure still pages"). With a 6 s scrub the park survives only if connect + probe takes at most 9 s. **Avoid:** anchor before the scrub; and when an inline scrub ran in this request, downgrade a `budget_exhausted` park skip to an INFO line (local `healed_inline` bool in `_validate_mt5_key_probe`). That is sound because the post-check scrub is scheduled on every post-login exit (`if login_attempted:` in the outer `finally`) and itself ends the terminal and relaunches it on the house account, which is what the park exists to achieve `[ASSUMED: A6]`. Needs user confirmation (Open Question 3).

### Pitfall 5: existing tests that patch the small deadline
`_MT5_VALIDATE_DEADLINE_S` is patched to 0.05 / 0.3 in `tests/test_mt5_validate.py` (`:1621, 1820, 2596`). An unconditional floor or clamp would refuse every one of them. Apply floor and clamp only inside the owed branch.

### Pitfall 6: call-time vs import-time constants
`def f(wait_s=_SCRUB_PROBE_WAIT_S)` freezes the value at import and breaks `monkeypatch.setattr(mt5_terminal_scrub, "_SCRUB_PROBE_WAIT_S", 0.3)`. Resolve `None` to the module global inside the body.

### Pitfall 7: new detail collides with the substring cascade
The detail text is classified by substring on the dashboard forms. Avoid `rate` (inside "operate", "separate"), `timeout`, `probe`, `trading`, `withdraw`, `signature`, `broker server`; add the sweep test. Do not write the words "terminal", "lease", "queue", "lock" (WIZFORM-03, `closed_sets.py:122-126`).

### Pitfall 8: pinned lineage text
Hand-typed counts and the frozen roster arrays are pinned in several suites; each must move in the same commit and say why (repo convention). Missing one gives a RED that names the number. Do the TS censuses together: vocabulary roster (47 -> 48), dialog-envelope (37 -> 38), parity (`DISTINCT_WIRE_CODES` 10 -> 11), frozen rosters (two arrays).

### Pitfall 9: the floor can invert the timeout nesting
**What goes wrong:** the chain's stated property is IPC 45 < rpyc 55 < stage 60 < deadline 75 (test `test_mt5_validate_timeout_chain_is_strictly_nested`). Handing the probe `E - elapsed` breaks `stage < deadline` once scrub plus row exceeds 15 s (75 - 60): the deadline then fires before any stage can name a cause, and at the proposed 40 s floor it can cut a login the 45 s IPC bound still allows (the censoring the C-3 evidence names). In the typical healed case (6 s scrub, about 69 s left) the nesting still holds.
**Options (Open Question 8):** A) floor >= the stage ceiling (60 s), so scrub budget is about 10 s (`75 - 60 - 5`), nesting always preserved, but 10 s is thin against the measured 6 s and an overrun answers the recoverable refusal; B) S = 30 s, floor 40 s, accept the inversion only when scrub and probe are BOTH slow (outcome `deadline_exceeded` names nothing but still fails closed and retryable). Recommendation: B, confirmed by the founder.
**Test:** whichever is chosen, hand-type it: A pins `FLOOR >= router._MT5_VALIDATE_STAGE_TIMEOUT_S` and `S + record + FLOOR <= E`; B pins `FLOOR < stage` as a DELIBERATE inversion with the reason in the assertion message, plus `S + record + FLOOR <= E`.

### Pitfall 10: hold gate under a preselect
With `preselectKey` plus a draft and no pointer the initializer mounts `connect_key` (with the preselect summary) under the banner today. The gate hides it while the banner shows. Nothing is lost: Resume already replaces it with `sync_preview` (`handleResume` sets `draftResumeStep`), and a confirmed Start fresh sets `connect_key`, which renders the summary. No exemption for preselect mounts. `ContributionWizardOverlay.sessionid-fence.test.tsx` mounts `WizardClient` with a preselect and a draft and clicks `wizard-resume` straight away, so it is unaffected; its non-draft preselect cases (`findSummary`) are unaffected because `initialDraft` is null there.

## Code Examples

### Owed gate (sketch; names illustrative)
```python
# routers/exchange.py, inside `async with mt5_terminal_lease(...)`, replacing the
# `if mt5_scrub_owed(...) or mt5_relaunch_debt(...):` block (currently :1124-1143)
lease_held_at = _park_clock()
healed_inline = False
if mt5_scrub_owed(terminal_key) or mt5_relaunch_debt(terminal_key):
    scrub_started_at = time.perf_counter()
    kind = await pay_owed_validation_scrub_in_lease(
        host, port, site=SITE_VALIDATE_WIZARD, budget_s=_MT5_INLINE_SCRUB_BUDGET_S
    )
    emit_mt5_stage_event(
        "owed_scrub", scrub_started_at, ok=kind == SCRUB_KIND_SCRUBBED,
        terminal_key=terminal_key,
        outcome="scrub_healed" if kind == SCRUB_KIND_SCRUBBED else f"scrub_{kind}",
    )
    remaining = _MT5_VALIDATE_DEADLINE_S - (_park_clock() - lease_held_at)
    if kind != SCRUB_KIND_SCRUBBED or remaining < _MT5_VALIDATE_PROBE_FLOOR_S:
        report_scrub_owed_refusal(site=SITE_VALIDATE_WIZARD, key=terminal_key)
        trace.outcome = "scrub_unhealed"
        if kind == SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS:
            raise service_error(500, "MT5_VALIDATION_UNCONFIGURED", dependency="mt5-gateway",
                retryable=False,
                detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.")
        raise VenueTransientHTTPException(status_code=424, code="MT5_TERMINAL_NOT_READY",
            detail=MT5_TERMINAL_NOT_READY_DETAIL, recoverable=True)
    healed_inline = True
    logger.info("validate_key: owed MT5 terminal scrub paid inline, check continues")
deadline_started_at = lease_held_at          # the park gate reads the same envelope
probe_deadline = _MT5_VALIDATE_DEADLINE_S - (_park_clock() - lease_held_at)
# ... `asyncio.wait_for(_connect_and_probe(), timeout=probe_deadline)`; unowed path keeps ~E
```
Notes: the `skipped_no_house_credentials` branch reuses the existing detail string verbatim from the two existing arms (`exchange.py:550`, `:598`). The unowed path computes `probe_deadline` with ~0 elapsed, so it equals today's 75 s (tests patching the deadline small still pass).

### Sibling (shape to copy verbatim; anchors are load-bearing)
```python
# services/mt5_terminal_scrub.py, next to run_owed_validation_scrub_in_lease (:687-703)
async def pay_owed_validation_scrub_in_lease(
    host: str, port: int, *, site: str, budget_s: float
) -> str:
    """... NEVER RAISES ``Exception``. Returns the kind."""
    try:
        return await _scrub_under_lease(host, port, site=site, budget_s=budget_s)
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.error("mt5 validation terminal scrub: the inline scrub failed (exc_class=%s)",
                         type(exc).__name__)
            return SCRUB_KIND_FAILED
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            return SCRUB_KIND_FAILED
```

### Banner hold
```tsx
// WizardClient.tsx, before the return (new)
const stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner);
// ...wrap the existing `{source === "api" ? (...) : (...)}` block in `{!stepHeld && (...)}`
```

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Wizard refuses on owed gate, schedules scrub, user retries (164.6.6.1 D-08, Decision 6) | Wizard pays the scrub inline under its own lease, probes in the same request | Phase 218 | Removes the once-per-deploy founder-visible refusal and its misleading "briefly busy" card |
| Owed-gate answer `MT5_TERMINAL_BUSY` (164.6.6.3.2 D-02) | New code for "could not be made ready"; BUSY only for held lease | Phase 218 | Card names the real cause |

**Deprecated/outdated after this phase:** the header sentence "an owed scrub REFUSES this request ... rather than running inside it" (`exchange.py:127-130`), the `⛔ DECISION 6` block (`:1104-1109`), `trace.outcome = "scrub_owed"`, and the "first validation after each deploy is refused" statements in `mt5_terminal_scrub.py`, `mt5_client.py`, `closed_sets.py`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `initialDraft.supported_exchanges` containing `mt5` identifies an MT5 key (MT5 is not a user chip; `create_wizard_strategy` seeds it; `MetadataStep` re-adds the detected venue) | Q6 | Wrong banner noun; low blast radius, copy-only |
| A2 | 30 s inline scrub bound, 40 s probe floor, 5 s row term (about 5x the measured 6 s typical scrub; no measured validate duration exists) | Q1 | Too small: more `abandoned` refusals and zombie-thread windows; too large: floor breach. All env-overridable |
| A3 | `sync_preview` needs no secret entry (grep over `SyncPreviewStep.tsx`; absence evidence) | Q6 | If it does, the API/MT5 re-entry sentences are live, not dead |
| A4 | Reusing `MT5_VALIDATION_UNCONFIGURED` (500, no Retry, paged Next-side, "we have been alerted") for `skipped_no_house_credentials` is acceptable instead of a second new code | Q3/Q4 | Founder wanted one dedicated code; costs one extra code and TS surface if rejected |
| A5 | The in-flight crossing of an abandoned scrub thread (D-43) is an accepted residual for the wizard as it is for the scheduled scrub | Q2 | A zombie late launch could briefly overlap the next holder's scrub; converges because the next scrub ends and relaunches again |
| A6 | A skipped park after an inline heal is redundant because the post-check scheduled scrub ends the terminal and relaunches on the house account | Pitfall 4 | A master-password session could outlive its probe by the scrub's queue time; the scrub also alerts on failure |
| A7 | `asyncio.Lock` FIFO ordering (B before A's scrub task) | Q5 | Dedupe analysis in Q5 assumes it; cited from the existing test's docstring |

## Open Questions

1. **One code cannot carry both `recoverable` values.**
   - Known: the TS parity contract pins ONE `wireRecoverable` per wire code (`tests/lib/validate-key-venue-transient-parity.test.ts`, `EXPECTED` and `DIVERGENT_WIRE_CODE = "AUTH_FAILED"`); the wizard Retry derives from the key's static `actions`; a Retry on a house-credentials-unset card would offer something that cannot work.
   - Unclear: whether the founder meant one code with a per-kind flag.
   - Recommendation: new code for the five transient kinds; `skipped_no_house_credentials` answers the existing `MT5_VALIDATION_UNCONFIGURED`. Confirm before planning (A4).
2. **Banner re-entry copy has no live case for API/MT5.** See Q6. Recommend the matrix function; confirm the founder accepts that API and MT5 banners lose the re-entry sentence.
3. **Park skip noise after heal.** Recommend INFO instead of ERROR when `healed_inline` (Pitfall 4). Confirm.
4. **Bound numbers** are proposals (A2); Phase 155's histogram (the new `owed_scrub` stage event feeds it) is the long-term owner.
5. **Residual retry loops.** `failed` includes the profile tripwire (operator-only) and `relaunch_unverified` includes `-6` (our house credential refused); both answer recoverable per CONTEXT, so a Retry can loop while the per-cause ERROR alert pages. Splitting needs `ScrubRelaunchResult` data the kind does not carry; out of scope, booked as the residual.
7. **DEPARTURE FROM A LOCKED DECISION: where the healed-path outcome lives.** CONTEXT locks "`trace.outcome` gets a distinct value for the healed path". `trace.outcome` is one final value per request, and every arm after the owed gate overwrites it with the probe's verdict, so a `scrub_healed` value set before the probe is never observed. Recommendation: failure path sets `trace.outcome = "scrub_unhealed"` (final, honours the decision); the healed path emits a separate `owed_scrub` stage event with `outcome="scrub_healed"` (and `duration_ms`). Needs founder confirmation that this satisfies the intent.
8. **Floor vs timeout nesting** (Pitfall 9): options A and B above.
9. **Reusing `MT5_VALIDATION_UNCONFIGURED` adds a fourth emitter** (OQ1). Pins found: `analytics-service/tests/test_raw_5xx_census.py` `EXPECTED_SUBCLASS_CONSTRUCTION_SITES = 15` counts `VenueTransientHTTPException` constructions only (`service_error` is not counted there): it stays 15 if the new 424 REPLACES the owed gate's raise in place (one construction before, one after) and the 500 uses `service_error`. The existing arms set `trace.outcome = "gateway_unconfigured"`; the proposed `scrub_unhealed` is a deliberately different outcome (it is an operator-config-by-scrub cause, not an env gap) so Railway can tell them apart. No "three arms" emitter-count test was found in `analytics-service/tests` by grep (`test_mt5_validate.py` D-07 test drives the inverted-chain arm only); the TS D-07 route tests assert the capture per route via `OUR_DEFECT_KEY_ERROR_CODES`. [ASSUMED complete: grep, not a full read of every test.]
6. **Double alert on failure.** `_scrub_under_lease` already alerts the real cause; keeping `report_scrub_owed_refusal` (CONTEXT) adds a second windowed capture under cause `owed_validation_refused` when nothing is pending. Bounded (one per cause per hour). Recommend keeping, per CONTEXT.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 + pytest | analytics tests | yes | `2 passed in 33.41s` (ran `tests/test_mt5_validate.py -k "worst_case or strictly_nested"`) | none needed |
| mypy | strict gate | yes | 2.0.0 | none needed |
| node | vitest | yes | v25.8.1 (CI runs Node 22; `validate-budget`/CI notes warn local vs CI Node differs) | none |
| `node_modules` | vitest, tsc, eslint | NOT in this worktree (`ls -d node_modules` fails); present in the main checkout | n/a | `npm ci` in the worktree, or run vitest from the main checkout path |
| PROD / TEST DB | none | not needed | n/a | n/a (all new tests stub the scrub and the cron sink; `_install_scrub_double`, `_install_scrub_sink` exist) |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`asyncio_mode = auto`, `analytics-service/pytest.ini`) and vitest `^5.0.3` |
| Config file | `analytics-service/pytest.ini`; `vitest.config.ts` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_mt5_validate.py tests/test_mt5_validation_park.py tests/test_mt5_terminal_scrub.py tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py -q -x` (pytest only from `analytics-service/`) |
| Full suite command | `cd analytics-service && python3 -m pytest -q` ; `npm test` ; `npm run typecheck` ; `npm run lint` |
| Type gate (CI) | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | owed mark/debt: inline scrub, probe in same request, verdict normal, rows + order | pytest | `pytest tests/test_mt5_validation_park.py -k wizard_owed -q` | rewrite 4 existing + 1 new |
| SC-2 | each non-scrubbed kind: new code, factory never called, no login | pytest | same file, parametrised over the six kinds | new |
| SC-3 | per-kind code/recoverable, detail has no cascade needle, alert/row unchanged | pytest + vitest | `pytest tests/test_validate_key_venue_transient.py tests/test_mt5_server_known.py -q`; `npx vitest run tests/lib/validate-key-venue-transient-parity.test.ts src/lib/wizardErrors.test.ts` | edit + new |
| SC-4 | budget arithmetic and floor | pytest | `pytest tests/test_mt5_validate.py -k "worst_case or nested or inline_scrub" -q` | extend |
| SC-5 | outcome and stage event | pytest | `_capture_outcomes` + a stage spy | new |
| SC-6 | banner-only hold, Resume, Start fresh, silent resume | vitest | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` (+ overlay tests) | rewrite 3 + new |
| SC-7 | banner copy matrix | vitest | same file | new |
| census | roster, vocabulary, dialog, parity pins | vitest | `npx vitest run src/lib/wizardKeyRosters.test.ts src/lib/seam-venue-vocabulary.invariant.test.ts src/lib/dialog-envelope.invariant.test.ts` | edit |
| guard | sibling is never-raises + no lease | pytest | `pytest tests/test_mt5_session_episodes.py tests/test_mt5_concurrency.py -q` | edit `_GUARDED_SYMBOLS` |

### Existing tests that change
- Python: `tests/test_mt5_validation_park.py` `_assert_wizard_owed_refusal` (`:1719`) and its callers `test_scrub_wizard_owed_gate_refuses_without_probing_and_schedules_the_scrub`, `..._on_a_missed_scrub_pages_once_then_schedules`, `test_scrub_wizard_relaunch_debt_alone_refuses_the_same_way`, `test_scrub_the_first_wizard_validation_after_boot_pages_once_and_the_next_probes` (all assert refusal + `scrub_owed` + a scheduled task + BUSY code); `test_scrub_a_wizard_validation_already_queued_is_refused_quietly_and_one_scrub_runs` (now: B heals and probes, two scrub rows/crossings, no WARNING, B logs in); `tests/test_validate_key_venue_transient.py` C9 + trigger census; `tests/test_mt5_validate.py` budget tests (extend only); `tests/test_mt5_session_episodes.py` `_GUARDED_SYMBOLS`.
- TS: items 10-14 of Q4, and the Q6 list.

### Sampling Rate
- Per task commit: the quick pytest line for server tasks; the single touched vitest file for TS tasks.
- Per wave merge: full analytics pytest + mypy strict + `npm test` for touched folders.
- Phase gate: full suites green, then `/gsd-verify-work`.
- Neuter-once (project rule): (a) make the gate probe after a non-`scrubbed` kind -> the per-kind test REDs; (b) pass the wizard bound as the thread deadline -> the real-scrub test REDs; (c) drop the `!hydrated`/banner hold -> the banner-only test REDs. Restore from a byte backup, never `git checkout`.

### Wave 0 Gaps
- [ ] `tests/test_mt5_validation_park.py` - inline-heal tests (healed, six failure kinds, bound overrun, floor)
- [ ] `tests/test_mt5_terminal_scrub.py` - `budget_s` plumb (W-1 wait capped, blocking capped, `None` unchanged) and sibling never-raises
- [ ] `src/lib/wizard/...` - banner copy pure function + test
- [ ] `node_modules` for the executor's worktree (see Environment Availability)
- [ ] Locate the real pin for "no sentence may say or imply another check is using the terminal": `wizardErrors.ts` cites `wizardErrors.test.ts`, but grep of `wizardErrors.test.ts`, `.invariant.test.ts` and `.roster-render.test.tsx` found no `TERMINAL_BUSY`, `briefly` or `been alerted` text (the only `been alerted` source pin found is `src/app/api/strategies/create-with-key/route.test.ts:3745`). Treat the cited pin as unverified until found; do not rely on it to catch a copy mistake.

## Security Domain

`security_enforcement` is treated as enabled (the first 40 lines of `.planning/config.json` do not set it false; the full file was not read) [ASSUMED].

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth path) | n/a |
| V4 Access Control | no | existing route auth unchanged |
| V5 Input Validation | yes (wire code vocabulary) | closed set via `VENUE_WIRE_CODE_TO_VERDICT` (a `Map`, never a `Record`; `wizardErrors.ts` states the prototype-key reason); detail text swept against cascade needles |
| V7 Error handling / logging | yes | no host, port, terminal key, login, password or server in any log, alert or row (`mt5_terminal_scrub.py` header "Never an account number, login, password, broker server, host, port or terminal key"); the new INFO and stage event carry only a kind and the terminal key already allowed on `mt5.stage` events |
| V6 Cryptography | no | house triple only reaches `initialize_with_credentials` (unchanged) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A client's saved login left on the shared terminal | Information disclosure | The inline scrub runs BEFORE the probe, so the previous client's `accounts.dat` is deleted before the next client logs in; the mark/debt keep the obligation across `abandoned` |
| Probing on an unscrubbed terminal after a failed heal | Information disclosure / Tampering | Raise on every non-`scrubbed` kind before any client is built; tested per kind |
| Zombie scrub thread overlapping the next holder | Tampering | Epoch fence on every later session touch; D-43 residual accepted |
| Error body leaking infrastructure | Information disclosure | Detail names no terminal, lease, queue or lock (WIZFORM-03); flat 424 carries no `dependency` |
| Breaker poisoning | Denial of service | 424 counts nowhere in `breaker:mt5-gateway` (`resilient-fetch.ts`, 424 is `caller-exchange`/`counts:false`); the 500 UNCONFIGURED arm is `retryable=False` and likewise breaker-inert per STATUS_CONTRACT R-1 |

## Project Constraints (from CLAUDE.md)

- Never run a gsd agent by hand; workflows dispatch. (Applies to the orchestrator, not to this research.)
- Cite by symbol, not line numbers, in anything that lands in prose (`[164.7-CITATION-DRIFT-01]`); line numbers here are for the planner's navigation only and drift.
- Hand-typed censuses and counts move in the same commit, each with a dated lineage line; never derive a pinned expectation from the corpus it guards.
- CHANGELOG discipline: every ship writes an entry; VERSION and package.json byte-equal. A booking entry for 218 already exists at `CHANGELOG.md` line 8; the ship step unifies it.
- Delete the `TODOS.md` entries the phase closes in the same PR (grep found none naming 218 or the owed-gate refusal).
- No AI authorship attribution trailers; never write the CI-skip tokens in a commit or PR body.
- pytest only from `analytics-service/`; mypy strict is in CI; `grep -a`; a new supabase/tests file moves censuses (none here, no migration, no schema change).
- No secrets, PROD ids, home paths or account numbers in tracked text.
- Design: read DESIGN.md before visual decisions; the banner change is copy-only, no new visual treatment.
- Next.js here has breaking changes (AGENTS.md); this phase touches a client component only, not routing, config or APIs.

## Sources

### Primary (HIGH confidence, read this session)
- `analytics-service/services/mt5_terminal_scrub.py` (whole file); `analytics-service/routers/exchange.py` `:112-210, :1046-1502`; `analytics-service/services/ingestion/mt5.py:281-300`
- `analytics-service/services/mt5_relogin.py` `_affordable`, `scrub_and_relaunch_as_house`, `_relaunch_as_house`, `heal_deadline`; `analytics-service/services/mt5_concurrency.py` `mt5_terminal_lease`; `analytics-service/services/mt5_client.py` marks, `emit_mt5_stage_event`, `scrub_terminal_account_data`
- `analytics-service/tests/test_mt5_validate.py:1898-1976`, `tests/test_mt5_validation_park.py:1476-1620, 1719-2090`, `tests/test_validate_key_venue_transient.py:195-260, 849-890`, `tests/test_mt5_server_known.py:260-312`, `tests/test_mt5_session_episodes.py:1620-1700`, `tests/test_mt5_concurrency.py:985-1060`, `tests/test_mt5_relogin.py:5402-5427`
- `src/lib/wizardErrors.ts` (union, copy, verdict map, dialog roster, `OUR_DEFECT_KEY_ERROR_CODES`), `src/lib/wizardKeyRosters.ts` and test, `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/dialog-envelope.invariant.test.ts`, `tests/lib/validate-key-venue-transient-parity.test.ts`, `src/__tests__/contracts/contracts-registry.test.ts`, `src/lib/wizard/validate-budget.ts`, `src/lib/closed-sets.ts`
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`, `src/lib/wizard/localStorage.ts` (`deriveWizardResumeOverrides`, `loadWizardState`), `src/lib/wizard/draft-query.ts`, `WizardClient.test.tsx`, overlay tests, `e2e/wizard-resume.spec.ts`
- Measurements: `.planning/milestones/v1.20-phases/164.6.6.1-mt5scrub-.../164.6.6.1-CONTEXT.md` (S-05, S-09, S-10, S-11), `164.6.6.1-07-SUMMARY.md`

### Secondary / Tertiary
- None. No external web sources were needed; no library API was consulted. No Context7 / network lookups.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new.
- Architecture and safety: HIGH, every mechanism read in source and cross-checked against an existing test.
- Budget numbers: MEDIUM, derived from measured scrub timings but no measured validate duration exists (A2).
- Banner copy rule: MEDIUM, a CONTEXT-internal tension (Open Question 2).
- Pitfalls: HIGH.

**Research date:** 2026-11-19
**Valid until:** 2026-12-03 (the MT5 files change often; re-measure at HEAD before planning, per the repo rule that plan premises are claims)
