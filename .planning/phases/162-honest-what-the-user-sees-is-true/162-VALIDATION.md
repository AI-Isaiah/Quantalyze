---
phase: 162
slug: honest-what-the-user-sees-is-true
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-25
---

# Phase 162 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `162-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (v8 coverage, thresholds 82/80/74/72) + pytest (`analytics-service/`, `--cov-fail-under=80`) + SQL tests (`supabase/tests/test_*.sql`) |
| **Config file** | `vitest.config.ts`; `analytics-service/` pytest config |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npx vitest run` (Node 22 parity); `python3 -m pytest` from `analytics-service/` |
| **Estimated runtime** | ~250s vitest full; ~120s pytest |

⚠️ **Three environment traps that make a green run meaningless — all measured, not theoretical:**
1. **Worktree agents get no `node_modules`.** `npx vitest` exits 1 with MODULE_NOT_FOUND and `npx tsc` resolves an unrelated package. Symlink `node_modules` before any run in a worktree.
2. **File-scoped runs cannot clear contract tests.** `src/__tests__/contracts/` scan ALL of `src/`; only a full-suite run is a clean signal.
3. **pytest must run from `analytics-service/`.** A repo-root run misses the VCR cassettes and issues LIVE broker calls. Use `python3`, not `python`.

---

## Sampling Rate

- **After every task commit:** targeted file run + `npx tsc --noEmit`
- **After every plan wave:** full vitest suite (Node 22 parity)
- **Before `/gsd-verify-work`:** full vitest + pytest green
- **Before shipping any `analytics-service/` change:** `mypy --strict` (the GSD milestone runs pytest only, so mypy errors stay latent until PR CI)
- **Max feedback latency:** ~30s targeted, ~250s full

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists |
|-----|----------|-----------|-------------------|-------------|
| HONEST-01 | unknown-arm returns curated copy; raw text absent from column writes | unit (py) | `python3 -m pytest tests/ -k classify -x` (from `analytics-service/`) | ❌ W0 |
| HONEST-01 | bridge branch-(b) copy semantics, if changed | SQL | `supabase/tests/test_*.sql` | ❌ W0 |
| HONEST-01 | portfolio `_fail` catch-all curated | unit (py) | pytest portfolio router tests | ❌ W0 |
| HONEST-02 | badge honours series recency per chosen fix | unit (tsx) | `npx vitest run "src/app/factsheet/[id]/v2/"` | ⚠️ partial |
| HONEST-03 | example rows never advertise Synced (per D-162-1) | unit (tsx) | `npx vitest run src/components/strategy/StrategyTable.stale-analytics.test.tsx` | ✅ extend |
| HONEST-04 | failed constituent → null curve; success → real wealth points; false comment gone | unit (tsx) | `npx vitest run "src/app/(dashboard)/portfolios"` | ❌ W0 |
| HONEST-05 | widened route withholds scalars on failed rows; drawer leg renders metrics | unit (ts+tsx) | `npx vitest run "src/app/api/strategies/[id]/returns" "src/app/(dashboard)/allocations"` | ✅ extend |
| HONEST-06 | preselect mounts wizard with key chosen; orphan path never re-INSERTs | unit (tsx) | `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx` + new overlay spec | ✅ extend + ❌ new |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] pytest cases for the `classify_exception` unknown-arm mapping — must fail if `str(exc)` returns to the message slot
- [ ] SQL test for `sync_strategy_analytics_status` copy semantics if the bridge changes (re-base on `20260825150000`, which is now live in PROD)
- [ ] Portfolio-page equity-series spec — fixtures: one success row with `returns_series`, one failed row carrying best-in-class stale values (the STALE-01 fixture discipline)
- [ ] Overlay/WizardClient preselect spec proving the step mounts with the key chosen

---

## Anti-Vacuity Contract (founder rule — non-negotiable)

**A test that cannot fail is worse than none.** Every regression test added in this phase
must be witnessed RED against its own neutered fix before being accepted:

1. Neuter the fix (revert the specific line, not the file).
2. Run the test. **Observe the failure first-hand** — a predicted failure does not count.
3. Restore byte-identically (`shasum -a 256` before and after).

⛔ Never restore with `git checkout -- <path>` in a neuter harness: it resets to HEAD and
silently destroys uncommitted work. Use a byte copy.

Four distinct vacuity mechanisms have shipped in this repo in a single day. Two specific
traps apply here:
- **Self-referential oracles.** A money-math test that asserts the implementation's own
  formula pins nothing. Pin the ECONOMICS (an invariant), not the code's arithmetic.
- **Prose-satisfied anchors.** `pg_get_functiondef` returns comments, so a SQL guard that
  greps a function body for a bare identifier is satisfied by the function's own
  documentation. Strip comments before asserting, and pick the token by diffing versions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HONEST-01 root-cause trace | HONEST-01 | The specific `str`/`None` compare needs PROD job history / Sentry; not reproducible from fixtures | Run the diagnostic protocol in RESEARCH.md before choosing the fix |
| HONEST-02 flat-vs-gap census | HONEST-02 | The success criterion mandates investigation BEFORE a fix is chosen | Census query #1 in RESEARCH.md; result routes to ledger mechanism vs ccxt filter |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Every new regression test witnessed RED, then restored byte-identically
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
