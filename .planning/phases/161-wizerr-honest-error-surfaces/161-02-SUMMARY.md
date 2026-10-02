---
phase: 161-wizerr-honest-error-surfaces
plan: 02
subsystem: analytics-service
tags: [error-handling, copy, curated-message-fence, mt5, anti-vacuity, seam, operator-fault]

requires:
  - phase: 153.6-PARITY-01
    provides: "`services/mt5_probe.py` — the ONE login+read+probe body both validate paths call, and the home of the curated operator-facing copy"
  - phase: 153.3-D-31
    provides: "`terminal_trade_permission_off` — the single four-condition cause predicate both raise sites branch on"
provides:
  - "`mt5_probe.mt5_gateway_misconfigured_detail(terminal)` — the ONE flag→cause builder, consumed by BOTH raise sites"
  - "Two new curated `Final[str]` cause constants (161-UI-SPEC arms 1 and 2, verbatim) inside the curated-message fence"
  - "`mt5_probe.curated_gateway_detail(exc)` — the allow-list the worker's classify sink reads through, so a curated cause reaches the operator intact while raw remote text cannot"
  - "A parity fence parametrized over EVERY builder-emittable constant, with blank-constant and blank-token vacuity guards"
affects: [161-03, 161-04, 161-05, 161-06, 161-07, 161-08, 161-09, 161-10, WIZERR-01]

actuals:
  tokens: 13700
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A curated-copy FAMILY exposed as one tuple, so the fence parametrizes over the whole emittable set at a single seam instead of over the one constant a test was written for"
    - "Allow-list read of an exception message: the cause survives the sink, anything unrecognised degrades to the generic constant, so a security property and an honesty property hold at once"
    - "The cause BUILDER calls the existing cause PREDICATE rather than re-deriving its shape test — the predicate answers 'is it ours?', the builder answers 'which one?'"

key-files:
  created: []
  modified:
    - analytics-service/services/mt5_probe.py
    - analytics-service/services/mt5_validation.py
    - analytics-service/services/mt5_client.py
    - analytics-service/services/ingestion/mt5.py
    - analytics-service/routers/exchange.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_mt5_validate_parity.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_ingestion_mt5.py

key-decisions:
  - "The builder lives in `mt5_probe.py`, not `mt5_validation.py`: `mt5_probe` already imports `mt5_validation`, so the reverse import is a cycle, and the curated constants plus the `Mt5GatewayMisconfigured` default-argument property already live in `mt5_probe`. The plan pre-authorised this choice"
  - "The builder CALLS `terminal_trade_permission_off` instead of re-testing `trade_allowed` directly — a fourth copy of that shape test would drift silently, and using the seam makes a DETACHED terminal fall to the honest generic rather than to a cause it cannot support"
  - "Precedence when both flags indicate blockage: the NAMED option (`tradeapi_disabled`) wins, because it names a specific checkbox and subsumes the permission it already forces off"
  - "`job_worker.classify_exception` had to change: it hard-returned the generic constant, which would have discarded the cause the raise site had just derived. It now reads through an ALLOW-LIST, keeping the T-134-01 property while delivering the cause"
  - "161-UI-SPEC arm 3 (the generic constant, unchanged) still names one specific option. It is now structurally unreachable from both raise sites; the residual is documented at the constant rather than re-worded, because the copy contract is the founder's, not the executor's"

requirements-completed: [WIZERR-01]

coverage:
  - id: D1
    description: "With trade_allowed false and the named API option NOT in force, the user-facing detail names the Allow-algorithmic-trading cause — the founder-measured live case renders the true blocker"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal0] and [terminal1]"
        status: pass
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_mt5_gateway_misconfigured_operator_fault_on_both_paths (end-to-end through BOTH callers)"
        status: pass
      - kind: unit
        ref: "tests/test_ingestion_mt5.py::test_validate_terminal_trade_disabled_never_returns_readonly"
        status: pass
    human_judgment: false
  - id: D2
    description: "When tradeapi_disabled is true the detail names that option; when BOTH flags indicate blockage the option arm wins deterministically"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal2] and [terminal3] (the precedence row)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Absent / ambiguous / unreadable flags render the generic constant unchanged — an absent key can never KeyError and never mis-selects an arm (the A1 quarantine)"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal4..terminal8] — absent key, {}, None, detached, non-mapping"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every constant the builder can emit passes the curated-message fence (case-insensitive substring over all 14 denylist tokens plus the credential words)"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free (parametrized over MT5_GATEWAY_MISCONFIGURED_DETAILS)"
        status: pass
      - kind: unit
        ref: "tests/test_job_worker.py::test_mt5_gateway_misconfigured_message_carries_no_classify_vocabulary (sweep widened to every emittable arm)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both raise sites consume the ONE shared builder, so the next carrier inherits the class fix"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_mt5_gateway_misconfigured_operator_fault_on_both_paths — asserts router detail == adapter message (same cause, one builder)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Mt5GatewayMisconfigured() with no arguments still yields a curated constant (default-argument property preserved)"
    requirement: WIZERR-01
    verification:
      - kind: unit
        ref: "tests/test_mt5_validate_parity.py::test_the_curated_family_is_the_measured_three_and_they_are_distinct"
        status: pass
    human_judgment: false
  - id: D7
    description: "No loading branch and no success branch on the MT5 gateway-misconfigured surface (E1) is edited"
    requirement: WIZERR-01
    verification:
      - kind: other
        ref: "Task 1 touched exactly one raise-arm detail per path; Task 2 was proven prose-only by AST comparison. No TS/renderer file is in the diff"
        status: pass
    human_judgment: false
  - id: D8
    description: "The two new curated causes wrap within the existing wizard envelope body without truncation; the MT5 envelope body grows downward with no fixed-height clipping"
    requirement: WIZERR-01
    verification: []
    human_judgment: true
    rationale: "Backstop per the plan's must_haves. Rendered-layout property jsdom does not measure. The two new sentences are 253 and 247 chars vs the incumbent's 237 — a 7% growth on a surface whose existing envelope render tests already cover the tallest curated cause. No renderer was touched."

duration: 41min
completed: 2026-08-24
status: complete
---

# Phase 161 Plan 02: MT5 gateway-misconfigured copy names the actual blocker — Summary

**One curated sentence that asserted the wrong checkbox became a three-arm flag→cause builder consumed by both raise sites and by the worker's classify sink, with the curated-message fence parametrized over every constant the builder can emit and the false claim corrected at all nine prose carriers.**

## Performance

- **Duration:** ~41 min
- **Tasks:** 2/2
- **Files modified:** 9 (0 created)
- **Full Python suite:** 5229 passed / 89 skipped (all skips pre-existing; this plan added none)
- **`mypy --strict --follow-imports=silent services/ routers/ models/`** (the CI invocation): clean, 91 source files

## What changed, per task

### Task 1 (tracer) — the builder, both raise sites, the worker sink, the fence — `fe757564`

**The defect.** `MT5_GATEWAY_MISCONFIGURED_DETAIL` told the operator that the *'Disable automatic trading through the external Python API'* option was in force. The founder measured that FALSE on the live gateway (2026-08-13): `Config/terminal.ini [Experts]` read `Api=0, Enabled=0` — `tradeapi_disabled` was False while `trade_allowed` was False. The real blocker was `Enabled`, the Expert-Advisors *"Allow algorithmic trading"* option. So the sentence sent the operator to a checkbox that was already correct, on the one surface they triage from.

**The seam.** `mt5_probe.mt5_gateway_misconfigured_detail(terminal)` returns one of three module-level `Final[str]` constants:

| Arm | Selected when | Constant |
|---|---|---|
| 1 | `tradeapi_disabled` falsy AND `terminal_trade_permission_off(terminal)` | `MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL` (**new** — UI-SPEC arm 1, verbatim) |
| 2 | `tradeapi_disabled` truthy (wins over arm 1 — documented precedence) | `MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL` (**new** — UI-SPEC arm 2, verbatim) |
| 3 | terminal not a mapping / key absent / detached / nothing supports a cause | `MT5_GATEWAY_MISCONFIGURED_DETAIL` (today's, unchanged) |

**Wiring.** `services/ingestion/mt5.py` passes the `terminal` dict it already holds into `Mt5GatewayMisconfigured(mt5_gateway_misconfigured_detail(terminal))`; `routers/exchange.py`'s `undetermined` arm derives its `MT5_GATEWAY_UNCONFIGURED` detail from the same call. The env-gap raises at `exchange.py:465/477/620` keep their own sentence — they hold no terminal dict, so naming a cause there would be a guess.

**The sink change the plan implied and the code required.** `job_worker.classify_exception` hard-returned `MT5_GATEWAY_MISCONFIGURED_DETAIL` regardless of what the raise carried. Left alone, it would have thrown away the cause the raise site had just derived, and the operator surface (`sanitized_message`, persisted and rendered) would have kept showing the false sentence — the whole plan would have died one layer above the fix. It now calls `curated_gateway_detail(exc)`, an **allow-list**: a message that is a member of `MT5_GATEWAY_MISCONFIGURED_DETAILS` rides out intact, anything else — including raw remote text — degrades to the generic constant. Both properties hold: T-134-01 (mt5linux interpolates the password into remotely-eval'd source) and the honesty requirement.

### Task 2 — the false-claim prose at all nine carriers — `8549e992`

Corrected, each re-located by content at HEAD:

| File | Locations |
|---|---|
| `services/mt5_probe.py` | generic-constant doc comment; `Mt5GatewayMisconfigured` class docstring; the `run_probe` short-circuit comment that named the option as *"the very setting that makes trade_allowed false"* |
| `services/mt5_validation.py` | module docstring (`"undetermined"` bullet); `classify_trade_capability` docstring; the branch-5 comment; `terminal_trade_permission_off` docstring |
| `services/mt5_client.py` | `terminal_info` docstring — it claimed `trade_allowed` **subsumes** the external-API option, which is exactly the conflation the measurement disproved |
| `services/ingestion/mt5.py` | raise-site comment (×2 hunks) |
| `routers/exchange.py` | raise-site comment |
| `services/job_worker.py` | `classify_exception` arm comment |

Every correction states the measured mechanism *and* the recurrence: `Account=1`/`Profile=1` re-set `Enabled` off on every account change, and the worker logs in on every job — which is why an operator fix does not stay fixed.

**Prose-only, proven not asserted.** For each of the six files, `ast.dump()` with all docstrings normalised to a placeholder is byte-identical between `fe757564` and `8549e992`. Comments are invisible to the AST by construction, so the pair of facts (AST identical, diff non-empty) is exactly "comments and docstrings only".

## The fence check I performed on each new constant

Run against the **live** tables imported from `services.mt5_validation` at HEAD, not against the plan's or the UI-SPEC's transcription of them. Tokens actually read (15 entries, 14 distinct — `password` appears in both `_AUTH_TOKENS` and the credential words):

`server, connect, ipc, network, terminal, not found` · `authoriz, account, invalid, password, login` · `password, investor, master, secret`

| Constant | Length | Case-insensitive substring hits |
|---|---|---|
| Arm 1 — Allow-algorithmic-trading | 253 | **none** |
| Arm 2 — external-API option in force | 247 | **none** |
| Arm 3 — generic (unchanged) | 237 | **none** |

All three are `> 40` chars and mutually distinct (`len(set(...)) == 3`), which is what stops the arm-selection cases from passing without selecting anything.

⚠️ I re-read the token tuples at `mt5_validation.py:79-96` first-hand before writing any constant and did not trust the plan's or the prompt's transcription. They matched. The substring traps were checked explicitly: "reconnect" (contains `connect`) and "unaccountable" (contains `account`) appear in neither constant; neither does "gateway server", "terminal", or any credential word. Both constants are byte-identical to `161-UI-SPEC § Copy Spec WIZERR-01`; no wording was improvised.

## How the A1 absent-key case is handled

A1 (`terminal_info()` carrying `tradeapi_disabled`) was founder-measured **once** with zero production readers, so the builder is written to be correct whether or not it holds:

1. `isinstance(terminal_info, Mapping)` is checked **first**, so `None` (which `read_terminal` returns on any failure, by design) and a non-dict remote shape return the generic constant instead of raising `AttributeError`.
2. Every flag read is `.get()`. An absent `tradeapi_disabled` is falsy, so it can never *select* arm 2 — it falls through to the arm the other, long-proven flag supports.
3. When nothing supports a cause, the honest generic ships. No arm is guessed.

A `KeyError` here would fail the whole job **permanently** (T-161-05), which is why this is a correctness requirement and not a style preference. Five of the nine parametrized rows exist solely to pin it: absent key, `{}`, `None`, detached-but-`trade_allowed`-false, and a bare string masquerading as a terminal.

## Anti-Vacuity Proof

Two mutation cycles, as the plan's `<action>` requires. Each records what was mutated → the **observed** RED, copied from the run → restoration.

### Cycle A — insert a fence-illegal token into a NEW constant (working tree only)

Mutated arm 1: `"The MT5 gateway has ..."` → `"The MT5 terminal has ..."`, injecting `_WRONG_SERVER_TOKENS` member `terminal`.

**Observed RED (1 of 3 parametrized cases failed — the one carrying the mutated constant):**

```
E           AssertionError: curated copy carries the classify token 'terminal'
E           assert 'terminal' not in 'the mt5 ter...-go-live.md.'
E
E             'terminal' is contained here:
E             ?         ^^^^
E               the mt5 terminal has 'allow algorithmic trading' switched off, so read-only capability cannot be proven. the gateway switches it off again whenever it changes users, so turning it back on needs an operator, not a retry — see docs/runbooks/mt5-go-live.md.
FAILED tests/test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free[The MT5 terminal has 'Allow algo]
1 failed, 2 passed, 20 deselected
```

Note *which* parametrized id failed: the fence is scanning the new constant on its own, not just the incumbent. **Restored** by the inverse replacement; the three fence cases returned green.

### Cycle B — neuter the builder to always return the generic constant

Replaced the builder's four-line body with `return MT5_GATEWAY_MISCONFIGURED_DETAIL`.

**Observed RED — 7 failures across all three suites:**

```
E  AssertionError: THE FOUNDER-MEASURED LIVE CASE (2026-08-13): trade_allowed false
   with the named option NOT in force. The pre-161-02 copy asserted that option WAS
   in force — a sentence measured to be false about the user's situation, on a
   founder-hit surface.
E  assert 'MT5 gateway ...5-go-live.md.' == 'The MT5 gate...5-go-live.md.'

E  AssertionError: the flag is PRESENT and falsy — the option is not in force, so the
   cause is the algorithmic-trading setting, same as above
E  AssertionError: the named option IS in force and is the only blockage reported
E  AssertionError: PRECEDENCE: both flags indicate blockage and the NAMED option wins,
   deterministically — it subsumes the permission it already forces off
E  AssertionError: the sweep below must cover BOTH cause arms AND the generic fallback
E  assert 1 == 3

FAILED tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal0-…]
FAILED tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal1-…]
FAILED tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal2-…]
FAILED tests/test_mt5_validate_parity.py::test_builder_selects_the_cause_arm_the_flags_actually_support[terminal3-…]
FAILED tests/test_mt5_validate_parity.py::test_builder_never_names_a_flag_to_the_user
FAILED tests/test_mt5_validate_parity.py::test_mt5_gateway_misconfigured_operator_fault_on_both_paths
FAILED tests/test_ingestion_mt5.py::test_validate_terminal_trade_disabled_never_returns_readonly
7 failed, 169 passed, 1 skipped
```

The last two matter most: the neuter reddened the **end-to-end both-paths** case and the **ingestion raise site**, not only the unit cases over the builder — so the wiring is pinned, not just the helper. **Restored** from a pre-mutation snapshot; suite back to 176 passed / 1 skipped, and the five A1-quarantine rows (which the neuter could not redden, because the neutered builder returns the same generic they expect) still pass, as they must.

### Vacuity guards added before either cycle ran

161-01's Deviation 2 recorded that `"x".includes("")` is `true` in JS; the Python equivalent (`"" in "anything"` is `True`) applies to this fence identically, in **both** directions:

- a **blanked constant** would satisfy every `token not in text` while asserting nothing → guarded by `len(text) > 40` per constant, in both the parity fence and the widened `job_worker` sweep;
- a **blanked token** would match everything → guarded by `assert token` inside the sweep, alongside the pre-existing `assert _WRONG_SERVER_TOKENS and _AUTH_TOKENS`.

And the copy oracles are hand-typed literals transcribed from `161-UI-SPEC`, never imported from the module under test — an oracle that reads its expectation out of the thing it tests asserts `copy(X) == copy(X)` and cannot fail.

## Verification

| Command | Result |
|---|---|
| `python3 -m pytest tests/test_mt5_validate_parity.py tests/test_job_worker.py tests/test_ingestion_mt5.py -x` (Task 1 `<verify>`) | **176 passed, 1 skipped** (baseline before the plan: 162 passed, 1 skipped → +14 cases) |
| `python3 -m pytest tests/test_mt5_validate.py tests/test_status_contract_exchange_internal.py tests/test_mt5_probe_parity_roster.py` (adjacent suites over the changed router arm) | **100 passed** |
| `python3 -m pytest -x -q` (Task 2 `<verify>`, full suite) | **5229 passed, 89 skipped** in 123s |
| `python3 -m mypy --strict --follow-imports=silent services/ routers/ models/` (the CI invocation, `ci.yml:1617`) | **Success: no issues found in 91 source files** |

Invocation constraints honoured: pytest run **from `analytics-service/`** with `python3` (a repo-root run misses the VCR cassettes and issues LIVE broker calls); no `gstack-evidence run` wrapper; work done on the main working tree on `feat/v1.20-phase-161-wizerr`, no worktree, no branch changes. No TypeScript was touched, so vitest was not required.

> Branch protection is deliberately off until there are paying clients, so every CI gate is **advisory at merge**. Stated correctly: these cases **would have caught** a regression of the wrong-cause class — a re-collapsed builder, an un-fenced fourth constant, or a sink that discards the cause again; they did not *stop* anything at merge time.

## Deviations from Plan

### 1. [Rule 2 — missing correctness wiring] `job_worker.classify_exception` had to change

- **Found during:** Task 1, reading the sink before wiring the raise sites.
- **Issue:** The arm read `return ("permanent", MT5_GATEWAY_MISCONFIGURED_DETAIL)` — a hard constant, ignoring the raised message entirely. Every plan artifact assumed the ingestion raise's cause reaches the operator; it would not have. The plan's `<action>` says to extend the `test_job_worker` pins "so `classify_exception` … still carry curated constants … for every arm", which presumes an arm-carrying sink; the production change to make that true was not spelled out.
- **Fix:** `curated_gateway_detail(exc)` — an allow-list over `MT5_GATEWAY_MISCONFIGURED_DETAILS`. Curated cause in, curated cause out; anything else out is the generic constant.
- **Why not `str(exc)`:** that delivers the cause and also delivers a credential-disclosure surface (T-134-01 / T-161-04). The allow-list is the only shape that satisfies both the existing security pin and the new honesty requirement, and the existing pin (a raise carrying `"raw operator detail with investor-pw"` must return the curated constant) still passes unmodified.
- **Committed in:** `fe757564`.

### 2. [Expected — the plan's own target] Two pre-existing equality pins re-pointed

`test_mt5_validate_parity.py::test_mt5_gateway_misconfigured_operator_fault_on_both_paths` and `test_ingestion_mt5.py::test_validate_terminal_trade_disabled_never_returns_readonly` both asserted `== MT5_GATEWAY_MISCONFIGURED_DETAIL` on the fixture `{"connected": True, "trade_allowed": False}` — which **is** the founder-measured live case. They were pinning the precise wrong sentence WIZERR-01 exists to remove. Both now expect the arm-1 sentence, hand-typed. The fixtures are byte-identical (same real driven paths), so what each case certifies otherwise is unchanged, and Cycle B proved both redden when the builder is neutered. The parity case additionally gained a **strengthening** assertion — `router_outcome.detail["detail"] == message` — so a second copy of the flag→cause rule on either path would now surface there.

### 3. [Plan-authorised choice, stated as required] The builder lives in `mt5_probe.py`

The plan says "beside `terminal_trade_permission_off` in `mt5_validation.py` (or `mt5_probe.py` if import cycles force it — decide and state why)". Cycles force it: `mt5_probe` imports `mt5_validation`, so `mt5_validation` cannot import `mt5_probe`'s curated constants, and relocating the widely-imported `MT5_GATEWAY_MISCONFIGURED_DETAIL` into `mt5_validation` would be a large blast radius for no behavioural gain (CLAUDE.md Rule 3). `mt5_probe` is also the correct home on merit: it is the ONE shared body both raise sites already call, and it already owns the curated copy, the fence's subject, and the default-argument property. The prohibition against duplicating the four-condition shape test is honoured *by calling* `terminal_trade_permission_off` from the builder.

### 4. [Rule 1 — my own test bug, fixed before commit] `len(set(rendered)) == 2`

`test_builder_never_names_a_flag_to_the_user` initially asserted its three sampled terminals produced 2 distinct sentences; they produce 3 (both cause arms plus the generic). Caught by the first run of the new suite, corrected to 3 with a message explaining what the count is guarding (that the sweep is not silently scanning one sentence three times). No production code involved.

### 5. [Rule 3 — declined, out of scope] The generic constant's own residual wording

`MT5_GATEWAY_MISCONFIGURED_DETAIL` still reads *"MT5 gateway refuses automated trading (the 'Disable automatic trading through the external Python API' option is in force)…"* — i.e. arm 3, the fallback for "no cause is provable", names a specific cause. `161-UI-SPEC § Copy Spec WIZERR-01` arm 3 explicitly holds it **unchanged**, and the plan repeats that. I did not improvise a replacement. It is now unreachable from both raise sites (they enter the operator arm only via `terminal_trade_permission_off`, which guarantees the builder selects arm 1 or arm 2), so it survives only as `Mt5GatewayMisconfigured()`'s default and as the allow-list's degradation target. The residual is documented at the constant. **See "Notes for the next executor" #1** — this is a copy decision for the phase owner.

---

**Total deviations:** 5 — 1 auto-fixed wiring (Rule 2), 1 expected (the plan's own target), 1 plan-authorised, 1 self-inflicted test bug fixed pre-commit, 1 declined as out of scope.

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME, or unwired data sources were introduced. No test was skipped or marked `xfail`; the 89 skips in the full suite are pre-existing and unchanged. No `<verify>` went unrun.

## Threat Flags

None — no new security-relevant surface. The plan's register is honoured:

- **T-161-04 (Information Disclosure, `mitigate`)** — the fence is now parametrized over EVERY builder-emittable constant rather than the one it was written for, in both the parity file and `test_job_worker`; the default-argument property is re-asserted; and the new allow-list at the worker sink means the set of strings that can reach a human is *closed by construction*, not merely fenced by test.
- **T-161-05 (DoS on a malformed terminal dict, `mitigate`)** — `.get()` reads behind an `isinstance` guard, pinned by five parametrized rows including `None` and a non-mapping.
- **T-161-06 (Spoofing via gateway-supplied flags, `accept`)** — unchanged: the flags select between three curated constants and nothing else; no interpolation surface exists.

One property strengthened beyond the register: the router's `undetermined` arm previously rendered a hand-typed literal shared with the env-gap arms; it now renders a member of the fenced family, so that surface came *inside* the fence rather than sitting beside it.

## Notes for the next executor

1. **⚠️ Open copy question for the phase owner, not a defect I left:** arm 3 is a "no cause is provable" fallback whose sentence names a specific cause. It is unreachable from both raise sites today, but if a future raise site calls the builder from a place where `terminal_trade_permission_off` was *not* already true, arm 3 becomes user-visible and is a false sentence again. The clean fix is a cause-free fallback sentence, which requires a UI-SPEC amendment (and a re-run of the 14-token fence check on the new wording).
2. **The fence is now parametrized over `MT5_GATEWAY_MISCONFIGURED_DETAILS`.** Adding a fourth cause arm requires three deliberate edits: the constant, joining the tuple, and moving the hand-typed `== 3` in `test_the_curated_family_is_the_measured_three_and_they_are_distinct` / `test_mt5_gateway_misconfigured_is_permanent_with_curated_message`. That friction is the point — a constant that skips the tuple is unreachable through the allow-list.
3. **`MT5_GATEWAY_MISCONFIGURED_DETAILS` is imported at MODULE level in `test_mt5_validate_parity.py`**, unlike the rest of that file's in-body imports. `@pytest.mark.parametrize` evaluates at collection time; that is the whole reason.
4. **`read_terminal` returns `client.terminal_info()` unprojected**, and `Mt5Client.terminal_info` runs `_materialize(info)` — so the terminal is a real `dict` at both raise sites even when the underlying fake is a namedtuple. Any future flag is available without a re-probe.
5. **`mypy --strict .` from `analytics-service/` reports 6072 pre-existing errors across `tests/`.** That is NOT a regression signal. CI runs `mypy --strict --follow-imports=silent services/ routers/ models/` (`ci.yml:1617`), which is clean. Use the CI invocation.
6. **Manual-only item still open (161-VALIDATION):** live re-measurement of `tradeapi_disabled` on the gateway. Nothing in this plan depends on A1 holding — arm 2 is simply unreachable if the key never appears — but arm 2's *correctness* is unverified against a live gateway.

## Self-Check: PASSED

- `analytics-service/services/mt5_probe.py` — FOUND, contains `mt5_gateway_misconfigured_detail`, `curated_gateway_detail`, and both new constants
- `analytics-service/tests/test_mt5_validate_parity.py` — FOUND, contains `test_every_builder_emittable_constant_is_curated_and_credential_free` and the 9 arm-selection rows
- `analytics-service/services/ingestion/mt5.py` / `routers/exchange.py` — FOUND, both call the builder
- Commit `fe757564` — FOUND
- Commit `8549e992` — FOUND
