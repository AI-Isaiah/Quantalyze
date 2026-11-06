# Phase 166: QSTATS-TRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-24
**Phase:** 166-qstats-truth-every-quantstats-derived-number-reflects-the-returns-it-was-given
**Mode:** `--auto` — founder asleep; every area auto-selected, every choice taken from repo evidence (no AskUserQuestion).
**Areas discussed:** library shape, closure mechanism, undefined-ratio semantics, gate shape, disclosure and PRODUCTION rows, KPI-array derivation, UI

---

## Library shape

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 0.0.81, close every site ourselves (kwarg where behaviourally proven, inline mirror otherwise) | 159 D-04 precedent; PyPI's latest is 0.0.81 | ✓ |
| Upgrade the pin | No newer PyPI release exists (measured); a bump is Phase 165's lane | |
| Adopt a fork / unreleased commit | Supply-chain one-way door | OPEN-1 (founder) |
| Drop quantstats from production now | Loses the live parity oracle; dependency change belongs to 165 | deferred |

`[auto] Library shape — Q: "Upgrade, fork, mirror or drop?" → Selected: "keep pin, close sites" (evidence: PyPI release list; 159 D-04)`

## Closure mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Kwarg only where a trigger-fixture test proves it on every leg; else inline mirror on extracted primitives | `cvar` precedent: a signature can lie | ✓ |
| Kwarg wherever the signature accepts it | Would repeat the measured `cvar` false-closure | |
| Hand-copy each transitive mirror | Forbidden by TODOS 0f (no third hand-copy) | |

`[auto] Closure — Q: "How is a site counted closed?" → Selected: "behaviourally proven kwarg, else mirror" (recommended)`

## Undefined-ratio semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Undefined → None | Precedent in `src/lib/factsheet/compute.ts`; kelly/cpc already None | ✓ |
| Undefined → 0.0 | Implies a real zero ratio — the current `common_sense_ratio=0.0` lie | |
| Undefined → inf | Not JSONB-safe; sanitised away anyway | |

`[auto] Semantics — Q: "Zero-drawdown / no-loss ratios?" → Selected: "None" (recommended)`

## Gate shape

| Option | Description | Selected |
|--------|-------------|----------|
| AST walk over every production module importing quantstats, sees getattr dispatch and aliases, printed census, proven RED per shape | Criterion 3 verbatim + TODOS 0f | ✓ |
| Extend the line scan to more functions | Still blind to getattr dispatch | |

`[auto] Gate — Q: "Scan shape?" → Selected: "module-wide AST walk" (recommended)`

## Disclosure and PRODUCTION rows

| Option | Description | Selected |
|--------|-------------|----------|
| Code-only; before/after table in SUMMARY; read-only census query handed to founder | No remote DB access in this phase | ✓ |
| Trigger recomputes of affected PRODUCTION strategies | PRODUCTION data write | OPEN-2 (founder) |

## KPI-array derivation (TODOS 0f)

| Option | Description | Selected |
|--------|-------------|----------|
| Include, byte-neutral, independent TS plan | ROADMAP carries it by name; 159 D-03 binds bytes | ✓ |
| Defer | Would leave a carried requirement undone | |

## UI

| Option | Description | Selected |
|--------|-------------|----------|
| No UI-SPEC; confirm null renders as absence on every reader | No copy/layout change | ✓ |

## Claude's Discretion

Plan/wave split, extracted-primitive names beyond the TODOS 0f names, benchmark trigger fixture shape.

## Deferred Ideas

Dropping quantstats from production (Phase 165 lane); OPEN-1; OPEN-2.
