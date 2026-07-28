# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.5 — Scenario Coverage-Window Blend

**Shipped:** 2026-07-03
**Phases:** 7 (55–61) | **Plans:** 16 | **Timeline:** 2026-07-01 → 2026-07-03

### What Was Built
- Coverage-window membership replaced the frozen blend convention (member iff enabled AND span ⊇ window; member-only divisor; renormalized weights) — pinned to an independent numpy re-derivation to fp precision before any UI work.
- Window control (intersection default, dual presets, auto-drop/restore, guided empty-intersection fix) + full coverage legibility (honest header, three-state chips, mini-gantt, include-cost disclosure).
- Windows persisted across save/share/compare (non-destructive schema v2→v3), share threading the owner's window verbatim through the SECDEF RPC.
- P61-BUG-1/2 fixes: added strategies join per-key book blends (`mergeAddedIntoPerKeySet`); compare mirrors the composer's engine-set; book-only shares refuse honestly at mint.
- Adjacent: CI wall time 14.6m → 8.4m and merge gate ~7m → ~5.5m (#568/#569).

### What Worked
- **The safety ordering held up exactly as designed**: compute core → parity re-verify → UI → persistence → re-bake → canary. Each phase's gate (numpy pin, parity guard, restored e2e net, live canary) caught real defects the previous layer could not.
- **The authed prod canary earned its phase slot**: it found two real prod bugs (inert drawer-adds, empty book-draft share/compare) that 7,400 green tests missed — because all add-tests ran gate=false and drove the OTHER adapter path.
- **Tests-first bug fixing with confirmed-red regression tests** plus a fresh-context adversarial review of the diff; the red team's FIX-FIRST finding (empty-state card contradicting a live blend) was itself a consequence of the fix and would have shipped otherwise.
- **Honest re-scoping of Phase 60**: proving the golden bake was a no-op (with evidence) instead of performing a ritual re-bake — and the restored e2e net immediately caught 3 latent bugs.

### What Was Inefficient
- The two adapter paths (holdings-snapshot vs per-key) disagreeing by construction generated the whole P61-BUG family; the divergence was known since Phase 37 but not priced as a risk. One engine-set selector should have been forced then.
- Phase 58/59 `human_needed` verification frontmatter was never flipped after P61 closed the items — surfaced only at milestone close as phantom "open artifacts."
- `.vitest-reports` hidden-dir upload failure cost a full CI round (#568 round 1) — upload-artifact v4.4+ hidden-file exclusion.

### Patterns Established
- **A view-derived default that isn't persisted diverges cross-surface** (RT-1 class): persist it, or derive it via ONE shared helper chain at every surface. Now locked for windows; generalizes.
- **Merge-point normalization**: when two unit systems must blend (raw USD per-key vs fractional added), normalize at exactly one merge point and prove the pre-existing path byte-identical (scale-invariance argument + reference-equality fast path).
- **Call-site wiring tests** (T_CP8 class): a tested helper + an untested call site is an untested feature. Pin the threading, not just the function.
- **Canary-found bugs get: root-cause file:line chain → confirmed-red regression tests → fix → red team → prod re-verify** — the full loop inside the same milestone.

### Key Lessons
1. Test-suite coverage follows the adapter paths you drive: 153 composer tests were green while the production path (gate=true) had zero add-coverage. Enumerate the path matrix, not the feature list.
2. "Fails honest" (em-dash shells, 0-overlapping-days columns) is better than inventing numbers but still reads as broken to a user — refuse early with the reason (the 409 mint gate) beats degrading late.
3. Flip verification/UAT ledger statuses the moment the closing evidence lands, not at milestone close.

### Cost Observations
- Model mix: predominantly opus (main loop + review/red-team subagents per /effort max policy); sonnet for the integration checker.
- Notable: the CI-speed work (#568/#569) paid for itself within the same milestone — 4 PR rounds after it landed each saved ~6 minutes wall.

---

## Milestone: v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification

**Shipped:** 2026-07-15
**Phases:** 12 (98–108) | **Plans:** 43 | **Tag:** `v1.10` @ `32494ba2` (v0.43.0.0)

*(v1.6–v1.9.1 were not individually retrospected here — their per-phase detail is in `MILESTONES.md` + `milestones/`. This entry resumes the living retro at v1.10.)*

### What Was Built
- **Demo-hero dashboard (PI-01..07):** real Exposure/Net-Exposure/Allocation widgets over an owner-scoped secretless read layer, optimizer sleeve replacing the hardcoded 10% favorites, Notes storage, a shared `KpiPanel` fold, and a real-PG partial-UNIQUE cross-process recompute fence.
- **Options MTM toggle that moves the WHOLE factsheet (MTM-01..04):** the basis toggle swaps the daily return SERIES (not just seven scalars) so every chart follows, single-key + composite, with a per-basis coverage mask and honest degrade-with-reason gating; cash byte-identical (SC-4).
- **The dailies-canonical backbone (BB-01..03):** `services/basis_series.py::derive_basis_series` became the ONE shared route; composite + onboarding routed onto it; the ~910-LOC trades-based legacy analytics chain + all 4 dark re-entry points deleted; `USE_COMPUTE_JOBS_QUEUE` made mandatory (kill-switches gone).
- **Leverage + scenario-planner onto the backbone (LEV-BB, SCEN-BB):** leverage became an `r→L·r` dailies transform re-deriving the whole factsheet (β→L·β / α→L·α honest); the scenario-planner routes through the canonical rolling primitives; ~990 LOC of frontend re-scale + second-Sharpe disclosure deleted, each behind a permanent liveness-proven delete-gate.

### What Worked
- **The fresh-context Fable red team earned its slot on EVERY phase.** It caught real defects that both the opus code-review AND the opus verifier missed — on 107 (L=0 pin misfire showing a persisted Sharpe over a flat-0% chart; peer/allocator/signature panels bypassing the levered view = an "entire factsheet" overclaim) and 108 (a crypto-√365 mutation guard silently lost in the migration because every test call-site used the 252 default). Two independent opus passes are not a substitute for a differently-modelled adversary.
- **The delete-then-gate discipline generalized cleanly** from 107's leverage-disclosure kill to 108's scenario-blend kill: delete the bypass, then land a permanent comment-stripped source-scan gate (forbidden tokens built by string-concat so the gate never self-matches; retired-line fixture so a regex typo can't pass everything; neuter-confirmed live once).
- **Measure, don't vibe, on perf:** the 235ms derive-debounce decision came from a real `tsx` timing probe against the ≥100ms rule, not a guess.

### What Was Inefficient
- **A deleted UI string lingered in an `e2e/` spec and only CI caught it.** The 107 SC-3 grep-gate scans `src/` only, so `composite-factsheet-render.spec.ts` still waited on the deleted `MODELED · 2×` eyebrow → e2e-seeded went red post-merge-attempt. The delete-gate's scan scope must include `e2e/` (or a whole-repo grep for deleted UI tokens must run) before shipping any disclosure delete.
- **I twice mis-described a change to the user** (108: called the population-std shift "invisible" when it's hover-visible in tooltips ~0.2–0.8%). The red team / user re-confirmation corrected the record — but the claim should have been checked against the actual tooltip render before asserting it.
- **Verification bookkeeping drifted again** (phases 98/103/107/108 left `human_needed`), surfacing as phantom open artifacts at close — the same class as v1.5's Phase 58/59.

### Patterns Established
- **Dailies are canonical → derive everything.** The single source of truth is the daily return series through the one backbone; scalars are a derived cache. This killed the Phase-101 √252 divergence class and is now the governing principle for any new metric/chart.
- **A different model is a different lens.** opus-review + opus-verify + Fable-red-team is not redundancy — each catches a class the others structurally miss. Budget the Fable pass every phase, not just the risky ones.
- **Delete-gates must scan the whole surface, not just `src/`.** Deleted UI tokens can hide in `e2e/` specs, docs, and fixtures.

### Key Lessons
1. Two same-model review passes ≠ two lenses. The adversary must be a different model to catch the class your own model rationalizes past.
2. When you delete a user-facing string, grep the WHOLE repo (incl. `e2e/`) for it before shipping — `src/`-only gates leave e2e specs waiting on ghosts.
3. Verify a UI claim against the actual render before telling the user it's "invisible"/"no change" — hover/tooltip states count.
4. Flip verification ledger statuses when closing evidence lands, not at milestone close (still unlearned since v1.5).

### Cost Observations
- Model mix: opus for the main loop + execution + code-review + verifier + fixers (per `/effort max` policy); **Fable for the fresh-context red team every phase** (where a differently-modelled adversary pays off) and the planner; sonnet for cheap mapping.
- Notable: the Fable red-team pass is cheap relative to a shipped-then-reverted defect — it caught a would-have-shipped headline-fabrication and a lost mutation-guard across the two phases.

---

## Milestone: v1.12 — sFOX Verified Integration (FOUNDATION close)

**Shipped:** 2026-07-19 (flag-OFF)
**Phases:** 6 archived (118–123; 124 never opened) | **Plans:** ~18 | **Timeline:** 2026-07-18 → 2026-07-19

### What Was Built
- A live non-ccxt sFOX read adapter (`SfoxClient` + `SfoxAdapter`) that reconstructs daily equity from the balance-history series through the ONE `derive_basis_series` backbone and carries the `api_verified` provenance stamp — the trust tier a CSV submitter can't fabricate.
- Every key chokepoint accepts `sfox` (worker validate/encrypt + all 3 Vercel routes, empty-secret Q1 carve-out), read-only asserted STRUCTURALLY, honest `KEY_AUTH_FAILED` on failure; a constraint-widening migration admitting `'sfox'` across the ≥5 exchange CHECKs (prod-applied).
- Flag-gated add-key UI (OFF = byte-identical, tested) + `api_verified` badge + read-only setup guide.
- Worker-hardening groundwork: `asyncio.wait_for`-bounded derive crawls (the v1.11-rollback root cause) + a kind-filtered claim RPC (prod-applied) + E2 anchor/flip fixtures + a go-live/rollback runbook + Fly egress-proxy artifacts.
- **All shipped dormant** (`NEXT_PUBLIC_SFOX_ENABLED`/`SFOX_ENABLED` empty): zero prod impact, nothing reads live.

### What Worked
- **Flag-OFF Foundation shipping decoupled code-landing from founder ops.** The whole spine landed to prod green and dormant, so the go-live sequence (Fly deploy + IP-whitelist, FLIP cutover, live E2) can run on the founder's clock without a stalled branch rotting. Byte-identical-when-OFF was tested at every UI seam, so "dormant" is proven, not asserted.
- **P115 economic-oracle discipline carried forward cleanly** into the sFOX reconstruction + the E2 anchor fixtures (hand-derived economics, never the module's own formula as oracle).
- **Honest re-scope over fake completion.** The go-live gaps were enumerated + re-homed to v1.13 with a continuous seed, not stamped done — the close is a Foundation with a plan, not a milestone pretending to be finished.

### What Was Inefficient
- **The GSD ledger diverges from this repo's reality** — `.planning/*` is gitignored (`commit_docs:false`), the milestone shipped flag-OFF with 4 phases re-homed, and the code shipped via a normal PR — so the stock `/gsd-complete-milestone` workflow's git-heavy steps (safety commits, `git rm REQUIREMENTS.md`, branch merges) were all no-ops and had to be recognized and skipped. The close is real, but the workflow assumes a clean "everything done, `.planning` in git" path this project doesn't run.
- **The close happened in two passes** (a prior-session "safe slice" — tag + ROADMAP reconcile + seed + archives — then this session's formal finish) because the first ran near context exhaustion. A single fresh-context pass would have been cleaner.
- **Recurring shared-test-DB fence flake resurfaced** (orphaned `running` compute_jobs from a workerless-project cron) and had to be hand-purged to green CI — the root-cause retention purge is itself re-homed to v1.13, so it will re-fire until built.

### Patterns Established
- **Foundation close (flag-OFF) as a first-class milestone outcome:** when a milestone is code-complete but its acceptance is founder-gated ops, close it as a Foundation with the go-live spine re-homed to a named next milestone + a seed — rather than blocking the ledger or faking completion. Frontmatter `close_type: foundation`, an audit doc with `verdict: shipped_flag_off_gaps_rehomed`, and an explicit re-home table.
- **Recognize when the close-workflow's git steps don't apply.** In a `commit_docs:false` / gitignored-`.planning` repo where code ships via PR, milestone close is a pure local-ledger operation — do the archives/entries/frontmatter, skip every `git rm`/safety-commit/branch step.

### Key Lessons
- A flag-OFF Foundation is the right shape when go-live is founder-ops-gated — but the re-home must be *explicit and enumerated* (table + seed + audit doc), or "closed as Foundation" silently becomes "closed with hidden gaps."
- Don't run a milestone close near context exhaustion; the format-heavy archive/audit/evolution steps want a fresh pass.

### Cost Observations
- Model mix: opus main loop + execution + code-review + verifier; Fable fresh-context red team every phase; sonnet cheap mapping (per `/effort max` policy).
- Notable: the two-pass close (safe-slice then formal-finish) cost an extra context reset that a single fresh pass would have avoided.

---

## Cross-Milestone Trends

### Process Evolution
- v1.2.2 → v1.5: every milestone now ends with a live authed prod canary; v1.5 is the first where the canary phase found (and the milestone fixed) real prod bugs — the pattern graduates from "verification" to "discovery."
- Frozen-engine discipline survived its first deliberate unfreeze: re-baseline as a reviewed act with independent re-derivation, then re-freeze. The mechanism (spine guards + zero-diff checks) works in both directions.
- v1.10: the per-phase **fresh-context Fable red team** graduated from optional to standard — it caught real defects the opus review + opus verifier missed on multiple phases, confirming that model diversity (not just pass count) is what closes the gap. The recurring miss is the reverse: verification-ledger bookkeeping drift keeps resurfacing at close (v1.5 → v1.10).
