# Contracts registry (B25 lint-consolidation capstone)

This directory is the **discoverable home + fail-loud pin** for the cross-cutting
refactor program's by-construction invariant guards. The guards themselves live
where they're most local (next to the code they protect); `contracts-registry.test.ts`
pins the *set* of them so a guard can't be deleted/renamed and leave CI green —
the silent-reintroduction gap B25 closes.

Two enforcement layers ship here:

1. **`tools/eslint-plugin-quantalyze/`** — edit-time AST rules (set to `"error"`
   in `eslint.config.mjs`, so a future raw offender fails `frontend-lint` CI).
2. **`contracts-registry.test.ts`** — the registry guard (existence + plugin/config
   wiring integrity) + **`.github/workflows/contracts.yml`** — the named CI surface.

## Honesty gate — what does NOT get a lint rule

The capstone's first job was an inventory pass: skip anything already enforced.
Most classes are closed by a **type brand / discriminated union / SECDEF RPC**,
which is strictly stronger than a bypassable lint rule — so they get NO rule:

| Batch | Class | Enforced by | Rule? |
|---|---|---|---|
| B1 | money-unit mixing | nominal `Usd`/`Ratio`/`Fraction` brands + `safe*` validators | type-enforced — no rule |
| B6 | factsheet no-invented-data | `FactsheetApiPayload\|FactsheetCsvPayload` union | type-enforced — no rule |
| B8 | closed-sets | `SUPPORTED_EXCHANGES` + `satisfies` + `closed-sets.test.ts` | type-enforced — no rule |
| B4c | audit action↔entity_type | `AUDIT_ACTION_ENTITY_TYPE_MAP` union + `@ts-expect-error` test | type-enforced — no rule |
| B19 | chunked IN-query | `analytics-service/services/db.py` (Python) | out of ESLint scope |
| B14 | freshness-signal-consumption | `freshness.ts` shipped; lint half not | **deferred → lands after B25** |
| B17 | labeled-metric-consumption | (runtime half not shipped) | **deferred → lands after B25** |

## eslint-plugin-quantalyze rules (the genuine AST delta)

| Rule | Batch | Bans | Canonical helper | Exemptions |
|---|---|---|---|---|
| `no-raw-localstorage` | B7 | `localStorage` / `window.localStorage` member access | `useCrossTabStorage` (`@/lib/storage`) | `src/lib/storage/**`; files with `B7 sanctioned-exception:`; test files |
| `no-raw-published-predicate` | B10 | `.eq("status","published")` | `withPublishedOnly` (`@/lib/visibility`) | files with `B10 sanctioned-exception:` / `B10 visibility:`; test files |
| `no-raw-retry-after-parse` | B20 | `Number()/parseInt()` of a Retry-After header | `parseRetryAfterSeconds` (`@/lib/retry`) | `src/lib/retry/**`; files with `B20 sanctioned-exception:`; test files |
| `no-passthrough-on-ipc` | B9 | Zod `.passthrough()` / `.catchall()` on a boundary parser (NEW-C40-01 leak class) | `.strict()` (fail loud) or default `.strip()` | per-site inline `// eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception:` (~13 forward-compat HTTP envelopes); test files. **Enforced repo-wide, not file-scoped** — a file allowlist could go stale when a new boundary module is added. |

Rules are `"error"` (not `"warn"`): the recon proved a clean baseline, so they fail
CI by construction on a future raw offender — the literal goal of the capstone.
The escape hatch is a greppable, batch-tagged `B<n> sanctioned-exception:` comment.

## Registered invariant guards

The authoritative list is `CONTRACT_GUARDS` in `contracts-registry.test.ts`
(grep sweeps, parity matrices, compile-time pairings, registry-completeness checks,
and the two `check-*` CI-gate scripts). Edit that array + this file together when
adding or removing a guard.

## Adding a new by-construction guard

1. Write the guard where it's most local (or add a rule to `eslint-plugin-quantalyze`).
2. Register it in `CONTRACT_GUARDS` + this file.
3. If it's an eslint rule, wire it in `eslint.config.mjs` and add a RuleTester fixture
   under `tools/eslint-plugin-quantalyze/tests/`.
