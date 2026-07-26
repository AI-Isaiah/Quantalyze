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
| `no-passthrough-on-ipc` | B9 | Zod `.passthrough()` / `.catchall()` / `.loose()` / `z.looseObject()` (all four Zod-v4 "keep unknown keys" forms) on a boundary parser (NEW-C40-01 leak class) | `.strict()` (fail loud) or default `.strip()` | per-site inline `// eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception:` (~22 forward-compat read-only envelopes: HTTP responses + widget render contracts); test files. **Enforced repo-wide, not file-scoped** — a file allowlist could go stale when a new boundary module is added. Matched by method NAME (not Zod-type resolution): a future unrelated non-Zod `.passthrough()`/`.loose()` would also flag and the same inline escape is the sanctioned mechanism. |
| `no-rem-less-clamp` | DS-04 (v1.4 ph49) | a CSS `clamp()` whose preferred (middle) term is viewport-only (no `rem`/`em`) — the WCAG 1.4.4 / W3C F94 zoom-unsafe shape, e.g. `clamp(2rem, 3vw, 4rem)` | a `rem`-anchored middle term, e.g. `clamp(1rem, 0.95rem + 0.25vw, 1.125rem)` | numeric `Math.clamp(...)` (no viewport unit) is invisible to it; `src/components/charts/**`; test/fixture files; files with `DS-04 sanctioned-exception:`. **Enforced repo-wide at `"error"`** (the baseline has zero rem-less clamp strings). |
| `no-raw-analytics-fetch` | SEAM-01 (v1.16 ph140) | a raw `fetch()` of the analytics service base URL — any identifier INITIALIZED from `process.env.ANALYTICS_SERVICE_URL` (through `??`/`||` chains, destructuring or computed access) that is then fetched as a bare arg, a template slot, or a `+` concatenation | `resilientFetch(budgetKey, path, init)` (`@/lib/resilient-fetch`), which owns the `SEAM_BUDGETS` timeout and the shared `breaker:railway` circuit breaker | a CLOSED four-path allowlist in `eslint.config.mjs`: the core itself plus the three documented `SEAM_EXCLUSIONS` (`debug-key-flow/**` bespoke SSE, `cron/warm-analytics/**` and `warmup-analytics.ts` health warmers). **No in-file escape hatch, by design** — a violation means a new seam call site, which belongs in the core, so widening the allowlist is always the wrong fix (T-140-26). `contracts-registry.test.ts` asserts both the repo-wide error and all four exemptions, frozen at four. |
| `no-raw-font-px` | DS-04 (v1.4 ph49) | a raw px font-size — `text-[NNpx]` arbitrary class or `fontSize: "NNpx"` inline style (decimal + uppercase variants too) | a fluid `--text-*` token / `text-*` utility | `src/components/charts/**`; test files; files with `DS-04 sanctioned-exception:`. **SCOPED, not repo-wide:** `"error"` only on the clean `src/lib/design-tokens/**` surface, `"warn"` on the 558-site dirty baseline — a strangler that ratchets to error per-surface in phases 52/53 (a repo-wide error would red-CI the existing app). |

Most rules are `"error"` repo-wide (not `"warn"`): the recon proved a clean baseline, so they fail
CI by construction on a future raw offender — the literal goal of the capstone.
The escape hatch is a greppable, batch-tagged `B<n> sanctioned-exception:` comment.
The one deliberate exception is `no-raw-font-px` (DS-04), which is `"error"` only on the
clean `src/lib/design-tokens/**` surface and `"warn"` on the dirty `text-[NNpx]` baseline
pending the per-surface strangler in phases 52/53 — `contracts-registry.test.ts` asserts both
its scoped error and its intentional warn so neither can silently flip.

## Registered invariant guards

The authoritative list is `CONTRACT_GUARDS` in `contracts-registry.test.ts`
(grep sweeps, parity matrices, compile-time pairings, registry-completeness checks,
and the three `check-*` CI-gate scripts). Edit that array + this file together when
adding or removing a guard.

| Guard | Batch | Invariant |
|---|---|---|
| `src/lib/sample-floor.test.ts` | Phase22 | `SAMPLE_FLOOR_OVERLAPPING_DAYS=60` value pin + every `evaluateSampleFloor` gate branch (ok / below-floor / no-usable-n incl. null/NaN/Infinity/negative / per-call override). The HONEST-02 single-source floor — fails loud if a future feature (Phases 26/27) forks its own floor instead of importing this one. |
| `src/lib/seam-constants.pin.test.ts` | 140.2 (v1.16) | The seam core's tuning values, every expectation a hand-typed literal: 13 `SEAM_BUDGETS` `timeoutMs` values, the `SeamBudgetKey` SET as a **sorted equality rather than a length** (a length check passes a RENAME), all six breaker constants, the A-14 ordering invariant (`BREAKER_COOLDOWN_S` ≥ `BREAKER_WINDOW`, or the counter has not decayed when the lock expires and the breaker flaps forever), `SEAM_RETRIES === 0` as a NEGATIVE pin (Phase 141 owns raising it), and the two fake↔production literal pins. **Exists because Phase 140 certified "5/5 mutation-tested" while ten simultaneous semantic mutations to the core produced a byte-identical `8859 passed`** — 0 of 13 budgets and 5 of 6 breaker constants were pinned to anything, every assertion having read its expected value out of the table under test. Zero module mocking, grep-asserted. |
| `src/lib/seam-budgets.invariant.test.ts` | 140.2 (v1.16) | The seam budget invariant. Reads each of the 15 route files' `export const maxDuration` **from disk** (anchored `^…/m`, so a comment cannot satisfy the guard) and checks it against `SEAM_ROUTE_BUDGETS`, then checks the summed `timeoutMs × calls × (1 + SEAM_RETRIES)` fits inside it. Plus (140.2) a deep compare of every route row's CONTENTS against a hand-typed 15-row map — the only assertion that can see a **leg dropped from a multi-leg row**, which silently halves that route's worst case while SC-4a and SC-4b both get *more* comfortable — and a sorted-set pin of the three `SEAM_EXCLUSIONS` paths. |
| `src/lib/seam-errors.purity.test.ts` | 140.2 (v1.16) | The seam error leaf stays a dependency-free leaf. Comment-stripped, `^…/m`-anchored source scan of `src/lib/seam-errors.ts` asserting **no import statement, no `export … from` re-export** (a dependency edge in everything but name), **no `require()`** and **no `process.env` read**, plus a hand-typed SET of its exported class names and a byte-for-byte pin of `CircuitOpenError`'s static message asserted across two different `retryAfterS` values (so an interpolated message cannot pass by coincidence — T-140-05: the unauthenticated `verify-strategy` teaser reaches the seam). The purity is load-bearing twice over: `wizardErrors.ts` value-imports the class and is value-imported by ten `"use client"` components (so a dependency here ships a Redis client to the **browser bundle**), and sixteen route tests replace the seam clients wholesale (so `instanceof` through a re-export would evaluate against `undefined` and throw a `TypeError` from inside a catch block, turning a clean 503 into a crash). **Exists because prepending an `@upstash/redis` import to the leaf was GREEN across the full suite — there was no `seam-errors.test.ts` at all.** |
| `src/lib/resilient-fetch.wiring.test.ts` | 140 / 140.2 (v1.16) | Both seam clients demonstrably invoke the ONE core (SC-1c), the two security-critical headers forwarded byte-for-byte — and, added in 140.2, **the 13 budget-key BINDINGS**. The class is bindings, not the 5 lexical call sites: two of the five take their key from a **variable** (nine `analytics-client` wrappers fan out through one; `budgetKeyFor(flow_type)` computes another), so a call-graph enumeration reports 5 and is wrong. Each binding's key AND upstream path are pinned to hand-typed literals through a partial mock of the transport only, so the genuine `SEAM_BUDGETS` table stays in play. The load-bearing half is the **completeness mechanism**: the three binding families are DISCOVERED by reading source from disk and compared **as a SET** against a hand-typed 13-member roster (`EXPECTED_BINDINGS`), in the `limiter-ordering.test.ts` walk-classify-fail-on-unclassified idiom. A 14th binding that REUSES an existing budget key breaks no individual pin and fails only here (ledger row M22b); a hand-typed six-file seam-call set additionally catches a new call site that passes its key as a variable and would therefore belong to no family. |
| `scripts/check-route-contract.ts` | NAV-03 (Phase 51) | `ROUTE_CONTRACT_MANIFEST` ↔ `proxy.ts` `PUBLIC_ROUTES` + `next.config.ts` `redirects()` lockstep (the #512 class). A CI-gate script run in `npm run lint`: walks the `src/app/**` page tree and fails if a page route is unclassified, a manifest-`public` route is not covered by `PUBLIC_ROUTES` (anon would 307→login), a `redirectFrom` has no `redirects()` source (old link 404s), or a non-`exception` manifest entry maps to no page. Closes the route-drift class by construction at lint time. |

## Adding a new by-construction guard

1. Write the guard where it's most local (or add a rule to `eslint-plugin-quantalyze`).
2. Register it in `CONTRACT_GUARDS` + this file.
3. If it's an eslint rule, wire it in `eslint.config.mjs` and add a RuleTester fixture
   under `tools/eslint-plugin-quantalyze/tests/`.
