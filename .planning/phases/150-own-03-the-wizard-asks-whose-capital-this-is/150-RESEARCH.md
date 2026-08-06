# Phase 150: OWN-03 — The wizard asks whose capital this is - Research

**Researched:** 2026-08-06
**Domain:** In-repo product engineering — Next.js 16 App Router + Supabase/Postgres RLS, money-path write, structural invariant gates
**Confidence:** HIGH (every claim below is grepped/read at cited file:line in this session; zero external-library research was needed)

---

## Summary

This phase needs **no new library, no new package, no external API**. The UI-SPEC pins `Tool: none` and "no new packages", and every primitive the phase requires (`Modal`, `Button`, `Field`, `Input`, `Badge`, `buildEnvelope`, `assertSameOrigin`, `checkLimit`, `logAuditEvent`, `isValidDollar`) already exists in-repo. `150-PATTERNS.md` already supplies the analog-by-analog map at line level and is **the primary implementation reference**; this document does not repeat it. Its job is to (a) resolve the open decisions the pattern map explicitly deferred to the planner, with evidence, and (b) surface findings that CONTEXT, UI-SPEC and PATTERNS did not cover.

The headline finding is a money-path one: **`portfolio_strategies.current_weight` has no writer anywhere in this repo** — not in `src/`, not in `supabase/`, not in `analytics-service/`. It is read-only from the app's perspective and consumed by three analytics-service call sites with a `NULL → 1.0` cold-start fallback. Writing a real weight in the new allocate path would therefore not merely populate a column; it would silently change composite portfolio math for any portfolio that mixes a written weight with legacy `NULL` rows. The safe move for this phase is to write `allocated_amount` only and leave `current_weight` untouched.

The second headline finding is an OWN-05 blocker hiding in plain sight: **the Holdings row label never reads `strategies.name`.** `displayStrategyName` returns the codename first, then the real name **only** at `disclosure_tier === 'institutional'`, then a synthetic `Strategy #<id8>`. Wizard-created strategies have `codename IS NULL` and inherit the column default `disclosure_tier = 'exploratory'`, so they land on the synthetic branch. Renaming `strategies.name` will show up instantly on `/my-strategies` (which renders `{s.name}` raw) and on the owner factsheet, and will change **nothing** on Holdings. SC 1c names Holdings explicitly, so this needs a decision, not a discovery-at-execution-time.

**Primary recommendation:** Ship the mark as a nullable, un-backfilled `strategies.capital_ownership TEXT CHECK IN ('own_capital','team_review')`; enforce D-03 with an **INSERT-scoped** DB trigger plus the structural vitest gate; write **only `allocated_amount`** in the allocate path and render weight from the honest-fallback arm; and give the Holdings adapter an owner-row carve-out for the display name (the precedent and its security reasoning already exist verbatim in `src/app/api/strategies/browse/route.ts:44-56`).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The capital question + mark (founder model 2026-08-05, verbatim in REQUIREMENTS OWN-03)**
- **D-01:** Question fires at allocator key-add, as the FIRST question of the categorization step (MetadataStep). Two-way, crisp copy: (a) "a key with my own capital in it" vs (b) "a trading team's key I am verifying". **(b) is the DEFAULT.**
- **D-02:** The answer is stored as a persistent ownership mark. The wizard writes NO position and asks NO amount (mark in wizard, allocate in Holdings — supersedes the 2026-08-04 finalize-form reading).
- **D-03:** ⛔ HARD INVARIANT: a team-review-marked strategy can NEVER become a position — no code path creates an allocation from it. Assert structurally (phase-gate style, like the visibility gates).
- **D-04 (mark storage, Claude analysis — planner to confirm against schema):** the mark is STRATEGY-level (allocation is strategy-level; a multi-key strategy like Alpha Centauri has ONE mark; adding a key to an existing strategy inherits the strategy's mark). Question is asked at key-add; answer lands on the derived strategy.

**Cull list (founder decision 2026-08-06)**
- **D-05:** Keep THREE fields visible: codename, description, category. Category survives because it drives percentile population and crypto-vs-trad annualization.
- **D-06:** Everything else — strategy types, subtypes, markets, supported exchanges, leverage range, AUM, max capacity — moves behind a collapsed optional "More details" disclosure. NOT deleted: collapsed fields keep downstream factsheet panels possible without fabricating; absent answers keep hiding panels per no-invented-data.
- **D-07:** Cull applies to the step for ALL users (one form); the capital question renders for allocator-role users.
- **D-08:** ⚠️ Check every culled field's downstream consumers (factsheet panels, browse filter pills, mandate-fit chips, StrategyTable AUM column) — hiding, never fabricating.

**Retro mark affordance (founder decision 2026-08-06)**
- **D-09:** The mark is SET from a /my-strategies row action ("Mark as own capital" / "Mark as team review"); the row shows the current mark as a small tag. The owner factsheet shows the mark READ-ONLY. Primary surface = the Phase-149 My Strategies ranking.
- **D-10:** NO wizard "allocate now" shortcut — strictly mark in wizard, allocate in Holdings.
- **D-11:** Retro path: existing own strategies (Black Swan, Alpha Centauri, Arctic Fox — all currently unmarked) become markable via D-09, then allocatable from Holdings.

**Holdings add interaction (founder decision 2026-08-06)**
- **D-12:** The Holdings STRATEGIES panel lists own-capital-marked strategies with an "Allocate…" action asking a USD AMOUNT (matches existing `portfolio_strategies.allocated_amount` + `current_weight` machinery; weight derives from book equity). Approved mock: unallocated own-capital rows show "— not allocated" + [Allocate…]; allocated rows show amount · weight + [Edit allocation…].
- **D-13:** Duplicate-add is impossible by construction: selecting an already-allocated strategy opens EDIT of the existing position — never a second row, never a double-count (satisfies ROADMAP SC4).
- **D-14:** Reuse the existing `portfolio_strategies` write path/RLS — no new table. The money-path review scopes to THIS write.
- **D-15:** The Holdings empty state stops being a dead end: when marked-own strategies exist but none are allocated, the panel names them (honest state) instead of "No strategies onboarded yet."

**Rename — OWN-05 (founder decision 2026-08-06)**
- **D-16:** Rename affordance on BOTH the /my-strategies row and the owner factsheet header.
- **D-17:** Allowed while status is private/draft ONLY (published rename deferred — trust surface).
- **D-18:** Rename writes `strategies.name`. The public codename/disclosure-tier redaction contract (C-0112) is byte-untouched — public surfaces render codename per disclosure rules regardless; the proper name is the owner's label.

### Claude's Discretion

Exact copy of the two-way question (crisp; founder tone), the "More details" disclosure styling per DESIGN.md, mark tag styling, where the mark column/tag sits in the row, dialog vs inline for the Allocate amount input, validation of the amount (positive, bounded by sanity), and the structural-gate mechanics for D-03.

> **Note:** all six discretion items are now *closed* by the approved `150-UI-SPEC.md` (revision 1). The planner should treat the UI-SPEC as binding and NOT re-open them.

### Deferred Ideas (OUT OF SCOPE)

- Published-own rename (D-17 deferral) — trust-surface implications; revisit post-v1.17.
- Wizard-side "allocate now" shortcut (D-10) — only if the two-step flow proves annoying in dogfooding.
- Role-gated form variants (allocator vs manager forms diverging beyond the capital question).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **OWN-03** | Wizard asks own-capital vs team-review, stores a persistent strategy-level ownership mark; only own-capital-marked strategies are allocatable from Holdings; team-review can NEVER become a position (hard invariant); no auto-add; duplicate-add has a defined behaviour. | Schema shape + nullable/no-backfill rationale (§ Schema Findings 1); D-03 enforcement recommendation, INSERT-scoped trigger + the two bypass call sites (§ Don't Hand-Roll, § Pitfall 1); duplicate-add is a composite PRIMARY KEY, not a UI convention (§ Schema Findings 3); allocator render signal is `entryContext`, not a role query (§ Architecture Patterns 4). |
| **OWN-03 (1b)** | Categorization step culled to essentials; every culled answer's downstream consumer checked. | Cull is a RENDER-only change — `MetadataDraft`, `onComplete`, and the finalize payload all stay intact (PATTERNS §2), so the D-08 consumer sweep has zero server-side surface. The one live money-math risk is the asset-class select on the editable CSV path (§ Pitfall 4). |
| **OWN-03 (SC 2/2b)** | Holdings allocate + hard structural invariant + retro path. | `current_weight` has no writer (§ Schema Findings 2) — this is the money-path decision; widened read + `age` nullability ripple (§ Architecture Patterns 3); pgTAP is the only CI-real DB gate (§ Validation Architecture). |
| **OWN-05** | Allocator renames OWN private/draft strategies; owner-authz only; codename redaction contract byte-untouched; all owner surfaces render the new name coherently. | `displayStrategyName` never reads `name` for these rows (§ Schema Findings 4) — the SC-1c blocker, with a recommended precedent-backed remedy; rename is the first path putting free text into `strategies.name`, which today is allow-list-constrained (§ Pitfall 3). |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Consequence for this phase |
|-----------|--------|----------------------------|
| **This is NOT the Next.js you know** — read `node_modules/next/dist/docs/` before writing code; heed deprecation notices | `AGENTS.md` | The three new route handlers and the `<details>` disclosure are ordinary App Router / React work, but any `params`/`cookies()`/`headers()` touch must use the async form. Middleware is `proxy.ts` in this version. |
| **Always read `DESIGN.md` before any visual/UI decision** | `CLAUDE.md` | Already discharged by the approved UI-SPEC, which cites DESIGN.md tokens throughout. Do not re-derive. |
| **Coverage is a BLOCKING CI gate** — lines 82 / statements 80 / functions 74 / branches 72 via `vitest.config.ts` thresholds; merged across shards by the `frontend-coverage` job | `CLAUDE.md` | New components, adapters and routes must ship with tests in the same PR or the ratchet reddens. Three new dialogs + three new routes is a large uncovered surface if tests lag. |
| **Rule 3 — surgical changes; Rule 11 — match conventions** | global `CLAUDE.md` | Do not "fix" the RLS `WITH CHECK` gaps, the `AddToPortfolio` client-direct insert, or `formatDays` while passing through. Log them; gate only what D-03 requires. |
| **Rule 6 — root-cause obsession; Rule 12 — fail loud** | global `CLAUDE.md` | The zero-rows-is-a-404 discipline in the alias route (never `{ok:true}` on zero rows) is the house expression of Rule 12. Reproduce it in all three new routes. |
| **Banned packages list** | global `CLAUDE.md` | No packages are added this phase — vacuously satisfied. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ownership mark storage + value constraint | Database / Storage | — | A CHECK-constrained column on `strategies`; the value set must hold against any client. |
| D-03 hard invariant (team-review can never become a position) | Database / Storage | API (route pre-check) | Two live client-direct insert paths bypass any route-level gate (§ Pitfall 1). Only a DB trigger holds against a direct PostgREST call. The route pre-check exists for the clean 404/409, not for the invariant. |
| Capital question rendering + default | Browser / Client | — | Pure form state inside `MetadataStep`; the default is (b), so a never-touched question is behaviour-identical to today. |
| Allocator-vs-manager render gate | Browser / Client | Frontend Server (SSR) | `entryContext` already exists as a client prop and already reaches the server as `entry_context`. It is a *context selector*, not a privilege flag — no authz weight (§ Architecture Patterns 4). |
| Mark write (wizard) | API / Backend | Database (RLS) | Owner-scoped `UPDATE strategies` after the finalize RPC returns — keeps the 13-arg SECURITY DEFINER RPC signature untouched. |
| Mark write (retro, /my-strategies) | API / Backend | Database (RLS) | Same route, second caller. |
| Rename write | API / Backend | Database (RLS) | `strategies.name`, owner-scoped, status-gated server-side — not just by hiding the button. |
| Allocate / edit / remove position | API / Backend | Database (RLS + PK) | The money write. Composite PK gives duplicate-impossibility; RLS gives tenancy; the route gives CSRF + rate limit + audit. |
| Mark-flip-with-live-allocation (two-table atomic) | Database / Storage (RPC) | API | Two sequential PostgREST calls can strand a position — precisely the D-03 hole the confirm arm exists to close. Must be one transaction. |
| Weight display | Browser / Client | — | Derived at render only. Nothing writes `current_weight` this phase (§ Schema Findings 2). |
| Owner name display | Browser / Client | API (query projection) | The redaction helper is a client-side pure function; the carve-out is a display decision on already-owner-scoped data. |

---

## Standard Stack

**No new dependencies.** This phase composes existing in-repo modules only.

### Core (existing, verified present)

| Module | Path | Purpose | Why it is the standard here |
|--------|------|---------|------------------------------|
| `Modal` | `src/components/ui/Modal.tsx` | All three dialogs | Native `<dialog>` + `showModal()`; props are exactly `{ open, onClose, title, children }` — **no footer slot**, footers compose in `children`. Read at line level this session. `max-w-lg p-6`, title `text-h3 font-semibold`. [VERIFIED: file read] |
| `Button` | `src/components/ui/Button.tsx` | CTAs | Variants `primary \| secondary \| ghost \| danger`; sizes `sm \| md \| lg`. UI-SPEC's "primary styled `bg-negative`" **is** `variant="danger"` — use the variant, not a className override. [VERIFIED: PATTERNS §4, file cited] |
| `Field` + `Input` | `src/components/ui/Field.tsx`, `Input.tsx` | Rename + amount inputs | `Field` closes the `aria-describedby` / `aria-invalid` gap; `Input` also carries its own `label`/`error`. Use `Field` + bare control — do **not** double-wrap (two labels). |
| `buildEnvelope` / `ErrorEnvelope` | `src/lib/envelope.ts` | Write-failure rendering in dialogs | Canonical; `WizardErrorEnvelope` is a shim re-export of it (`envelope.ts:4`). No invented error strings. [VERIFIED: grep of exports] |
| `assertSameOrigin` / `NO_STORE_HEADERS` | route-handler stack | CSRF + cache headers on all 3 new routes | `src/__tests__/no-store-coverage.test.ts` enforces `NO_STORE_HEADERS` on **every** response including errors. |
| `checkLimit` + `mandateAutoSaveLimiter` | `src/lib/ratelimit.ts:156` | Rate limiting | 30 req / 60 s. The alias route's own justification ("closest sibling allocator-write surface") applies identically. **Do not mint a new limiter.** [VERIFIED: `grep -n "export const.*Limiter"`] |
| `logAuditEvent` + `AuditAction` | `src/lib/audit.ts` | Audit rows | `"allocation.update"` → `"allocation"` already exists (`:379`, `:592`) so allocate/remove need **no** union change. There is **no** `strategy.rename`/`strategy.update` today (only `strategy.delete\|approve\|reject`, `:413-415`) → the mark + rename routes need a new literal **and** a map entry; omitting the map entry is a compile error by design (`as const satisfies Record<AuditAction, AuditEntityType>`, `:536-592`). [VERIFIED: grep] |
| `isValidDollar` / `MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD` | `src/app/api/strategies/finalize-wizard/route.ts:404-409` | $1B sanity cap | Already the repo's server-side dollar validator. Currently route-local — lift to a shared module rather than minting a second validator. [VERIFIED: grep] |
| `formatPercent` / `formatNumber` | `src/lib/utils.ts:3-30` | All percentage rendering | Signature `formatPercent(value, decimals = 2, options?: { signed?: boolean })`; **`signed` defaults to `true`**. `src/__tests__/format-percent-contract.test.ts` fails CI if any file outside `utils.ts` declares a local `formatPercent`. [VERIFIED: file read] |
| `formatUsd` | `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:72-80` | Money cells | Module-private today; **export it** if the dialog needs it. A second inline `toFixed` on the money surface is what the UI-SPEC forbids. |

### Supporting (existing)

| Module | Path | When to use |
|--------|------|-------------|
| `displayStrategyName` | `src/lib/strategy-display.ts` | Any surface that may render exploratory rows. **Read § Schema Findings 4 before touching.** |
| `withPublishedOnly` | `src/lib/visibility.ts` | Any published predicate. A raw `.eq("status","published")` anywhere in `src/**` (non-test) fails `src/lib/visibility.test.ts:87-134` (B10 sweep, quote/whitespace-tolerant regex, only `visibility.ts` + `notes/ownership.ts` exempt). [VERIFIED: file read] |
| `requireRole` | `src/lib/auth.ts:332-425` | **Not needed this phase** — these are owner-scoped row writes, not role-gated features (§ Architecture Patterns 4). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate owner-scoped `UPDATE strategies SET capital_ownership` after the finalize RPC | 14th parameter on `finalize_wizard_strategy` (DROP + CREATE, 13→14 args) | The RPC is `SECURITY DEFINER` on the wizard's critical path; DROP discards grants and must re-issue `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated`, and `CREATE OR REPLACE` is forbidden (registers a second overload, breaks PostgREST named-arg dispatch). **Recommend the separate UPDATE**: a lost mark degrades to `NULL`, which is non-allocatable — the safe state — so the atomicity cost is bounded by design. [VERIFIED: signature read at `supabase/schema/functions/finalize_wizard_strategy.sql:6-19`, 13 params] |
| INSERT-scoped DB trigger for D-03 | Route-level check only | Two live client-direct insert paths bypass routes entirely (§ Pitfall 1). Route-only makes D-03's "no code path" claim **false**. |
| INSERT-scoped DB trigger | `BEFORE INSERT OR UPDATE` trigger | An UPDATE-covering trigger breaks the existing alias `UPDATE` on any legacy row whose strategy is unmarked (§ Pitfall 2). Scope to `INSERT` (+ optionally `UPDATE OF allocated_amount`). |
| Owner carve-out in the Holdings adapter for the display name | Also write `portfolio_strategies.alias` on rename | The alias write couples rename to the position (and a marked-but-unallocated strategy has no `portfolio_strategies` row to carry an alias). The adapter carve-out has direct precedent with its security reasoning already written down (§ Schema Findings 4). |
| Honest fallback for the weight preview ("Weight appears once your book equity is known.") | Compute a live weight from a book-equity scalar | No single "current book equity" scalar is exposed on the Holdings payload — the allocations dashboard resolves an equity *curve* (`queries.ts:2135` `equityCurveSource`, `:3215` `allocator_equity_derived`). Phase 151 owns AUM mechanics. Inventing a divisor here is a fabricated number. |

**Installation:** none. `Tool: none`, `components.json` absent by design, no registry blocks used.

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.**

The approved UI-SPEC pins `Component library: bespoke in-repo primitives … no radix/base-ui, no new packages` and `Icon library: in-repo inline SVG only … No new icon package`. `150-PATTERNS.md` maps all 21 new/modified files to in-repo analogs; none introduce a dependency. Verified: no `npm install` appears in any upstream artifact for this phase.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| *(none)* | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

⚠️ If the planner's decomposition introduces any package (it should not), the Package Legitimacy Gate must be run before that task is written.

---

## Schema Findings (this research's primary contribution)

### 1. `capital_ownership` is genuinely greenfield — zero prior art, and NULLABILITY is the load-bearing call

`grep -rn "capital_ownership\|own_capital\|team_review" src/ supabase/` returns **zero matches**. No column, no type, no constant, no test. [VERIFIED: grep, this session]

The UI-SPEC family table (line 71) states unmarked legacy rows render **no tag** — "absence is honest; the remedy is the row action". That is only expressible if the column is **NULLABLE with NO DEFAULT and no backfill**. A `DEFAULT 'team_review' NOT NULL` would stamp Black Swan / Alpha Centauri / Arctic Fox as team-review, which is a fabricated claim about the founder's own capital (no-invented-data). So the phase ships a genuine **three-state** display domain (`null` / `'own_capital'` / `'team_review'`) that collapses to **two states** in the *allocatable* predicate (`null` and `'team_review'` are both non-allocatable). The planner must state this explicitly in the migration comment and pin it in the gate; a reviewer who sees three display states and two logic states will otherwise "simplify" one of them.

⚠️ **The column is publicly readable on published rows.** `strategies_read` (`supabase/migrations/20260405061912_rls_policies.sql:28-30`) is `status='published' OR user_id = auth.uid()` with no column projection, so anon can `select capital_ownership` on any published strategy. UI-SPEC invariant 3 ("public surfaces render zero pixels of this phase") is a **render** invariant, not a data one. Decide consciously: the value is arguably not sensitive (it says "this allocator has capital in this"), but it is a new public-readable fact about the owner's book. Do not discover this at review time.

### 2. ⛔ `current_weight` HAS NO WRITER — and writing it changes cross-service math

Exhaustive census, this session:

| Layer | `current_weight` occurrences | Any write? |
|-------|------------------------------|-----------|
| `src/**` | 20+ sites | **zero** — every one is a read, a type declaration, an `.order(...)`, or a test fixture. `grep -rn "current_weight" src/ \| grep -iE "update\|upsert\|insert"` → **empty**. |
| `supabase/**` | 1 — `20260407075303_portfolio_intelligence.sql:107` (the `ADD COLUMN`) | **zero** |
| `analytics-service/**` | reads at `routers/portfolio.py:596,704,1683,1976`, `routers/simulator.py:296,346`, `routers/match.py:727,792` | **zero** |

[VERIFIED: three greps, this session]

Both consumer sites default `NULL → 1.0` as a cold-start placeholder:

- `analytics-service/routers/portfolio.py:594-597` — `_build_normalized_weights` uses `is not None` (so an explicit `0` is preserved as paused) and otherwise substitutes `1.0`, then renormalizes to sum 1.
- `analytics-service/routers/match.py:786-792` — the comment says it outright: *"a portfolio with mixed NULL and filled rows will still skew toward the NULL row."*

**Consequence:** if the new Allocate write sets `current_weight = 0.24` on one strategy while sibling rows stay `NULL` (→ `1.0`), the renormalized composite gives the *properly weighted* strategy ~19% and the *unweighted* siblings ~81% each of the remainder. That is a real, silent distortion of `portfolio_returns_series` and of match scoring.

**Recommendation (money-path):** the allocate write sets **`allocated_amount` only**. Leave `current_weight` untouched, and let the Weight cell render `—` per the Numbers Contract (uncomputed → em-dash, never 0). Rederiving weights from allocated amounts is AUM/book mechanics and belongs to **Phase 151** — which the ROADMAP already flags as this phase's coordination partner. Write this decision into the plan as an explicit non-goal so a later reviewer does not read the empty Weight column as an oversight.

**Consequence for the UI-SPEC:** the approved mock's allocated row reads `$120,000 · 24.00%`. Under this recommendation the weight sub-cell renders `—` until Phase 151. This is a **spec-vs-reality delta the planner must record**, not silently resolve. It does not break any UI-SPEC invariant (invariant 4 explicitly blesses `—` for uncomputed values), but it changes what the founder sees.

### 3. D-13 / SC 4 hold at the DATABASE level, not just in the UI

`portfolio_strategies` has `PRIMARY KEY (portfolio_id, strategy_id)` (`supabase/migrations/20260405061911_initial_schema.sql:138-143`). An `upsert` on that pair is **structurally incapable** of minting a second row. State this in the plan and in the gate — it is a far stronger argument than "the UI only shows `Edit allocation…`", and it survives a future surface that forgets the rule.

RLS: `portfolio_strategies_owner … FOR ALL USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()))` (`20260405061912_rls_policies.sql:67-69`). No explicit `WITH CHECK`; under `FOR ALL` Postgres reuses `USING` as the check, so INSERT/UPSERT is covered. **Note it in the money-path review; do not "fix" it** (Rule 3).

### 4. ⛔ OWN-05 SC-1c blocker: the Holdings label never reads `strategies.name`

`src/lib/strategy-display.ts` (read in full this session):

```ts
export function displayStrategyName(strategy) {
  if (!strategy) return "(strategy)";
  if (strategy.codename) return strategy.codename;
  if (strategy.disclosure_tier === "institutional" && strategy.name) return strategy.name;
  return `Strategy #${strategy.id.slice(0, 8)}`;
}
```

And for wizard-created strategies:

- **`codename` is NULL.** `strategies.codename` is written by *nothing* in `src/` and by *nothing* in `supabase/migrations/` except the `sanitize_user` NULL-outs. `pickPlaceholderCodename()` (`create-with-key/route.ts:61-65`) picks from `STRATEGY_NAMES` and writes it to **`name`**, not `codename` — the sentinels "Alpha Centauri" / "Black Swan" / "Arctic Fox" live in `strategies.name`, and `finalize-wizard/route.ts:365` validates the submitted `name` against `STRATEGY_NAME_SET`. [VERIFIED: greps + file reads]
- **`disclosure_tier` defaults to `'exploratory'`** — `20260408113028_disclosure_and_tenancy.sql:63`: `ADD COLUMN IF NOT EXISTS disclosure_tier TEXT NOT NULL DEFAULT 'exploratory'`. [VERIFIED: file read]

So `displayStrategyName` falls to the **synthetic** branch and the Holdings row for the founder's own strategy renders `Strategy #8d382aaf`. This is almost certainly the mechanism behind the **2026-08-05 holdings-confusion incident** that motivated OWN-05 in the first place, and it explains why the requirement names *"holdings alias"* specifically.

Surface-by-surface effect of a rename that writes `strategies.name`:

| Surface | Renders | Rename visible? |
|---------|---------|-----------------|
| `/my-strategies` row | `{s.name}` raw (`StrategyTable.tsx:893`) | ✅ yes, immediately |
| Owner factsheet masthead | `payload.strategyName` | ✅ yes (confirm the payload field's source at plan time) |
| Browse own rows | redaction applied at `browse/route.ts:184-236` (codename wins, else synthetic) | ❌ no |
| **Holdings STRATEGIES panel** | `ps.alias?.trim() \|\| displayStrategyName(...)` (`strategies-row-adapter.ts:83-90`) | ❌ **no** |

**Recommendation:** give the adapter an **owner-row carve-out** — when the viewer owns the strategy, prefer `strategies.name`. The precedent and its security argument are already written, verbatim, at `src/app/api/strategies/browse/route.ts:44-56`: *"the owner already knows their own name + codename … disclosure to nobody."* The Holdings panel is by construction owner-scoped (it reads *this allocator's* portfolio), so the carve-out is provably safe there and requires no new predicate. Alternative (also acceptable, weaker): accept the gap and record it as a documented SC-1c partial with a follow-up. **Do not** solve it by writing `alias` on rename — a marked-but-unallocated strategy has no `portfolio_strategies` row to hold an alias.

### 5. `getMyStrategies` uses `select("*")` — the mark arrives free on /my-strategies

`src/lib/queries.ts:299-303`:

```ts
.from("strategies").select(`*, strategy_analytics (*)`).eq("user_id", userId).neq("status", "archived")
```

The splat means `capital_ownership` reaches `/my-strategies` rows with **no query change**. Two consequences: (a) the planner should not write a task to widen this projection, and (b) the row type (`RankedStrategyRow` / `Strategy` in `src/lib/types.ts`) must gain the field or the TSX will not typecheck. `strategy_analytics (*)` also already satisfies the phase-147 `daily_returns`-with-`returns_series` pairing.

### 6. The strategy-rows Weight cell is signed TODAY — the UI-SPEC is a bug fix, not a citation error

`150-PATTERNS.md` §6 flags the UI-SPEC's `formatPercent(w, 2, { signed: false })` citation to `HoldingsTable.tsx:739` as pointing at "a different table" and asks the planner to choose between spec and neighbour. **Resolved with evidence — take the spec:**

- `HoldingsTable.tsx:739` (holdings rows): `formatPercent(row.weight, 2, { signed: false })` → `18.50%`
- `HoldingsTable.tsx:293-295` (strategy rows): `formatPercent(row.weight)` → **`+24.00%`** (default `signed = true`, `utils.ts:9`)
- `src/__tests__/format-percent-contract.test.ts:144` already pins: *"HoldingsTable Weight cell is unsigned ('18.50%', no leading +)"* — and its header (`:107-108`) states the rationale: *"every weight would silently render '+18.50%' instead of '18.50%'"*.

So the two Weight columns in the **same file** disagree, one of them is already contract-pinned, and the strategy-rows column is the non-conforming one. Adopt `{ signed: false }` **and extend `format-percent-contract.test.ts` to pin the strategy-rows Weight cell too**, so the pair cannot drift again. `HoldingsTable.strategy-rows.test.tsx` contains no `%` assertions, so nothing else breaks. [VERIFIED: file reads + grep]

### 7. Widening the Holdings row set is cheaper than it looks

`StrategyRow.age: number` is derived from `ps.added_at` (`strategies-row-adapter.ts:97-99`). A marked-but-unallocated strategy has no `portfolio_strategies` row and therefore **no `added_at`** — so `age` must become `number | null`. The ripple is small and already handled downstream:

- `formatDays(n: number | null)` already returns `"—"` for `null` (`HoldingsTable.tsx:93-96`). ✅ no change.
- `compareStrategyRows` already sorts `null` to the end regardless of direction (`HoldingsTable.tsx:212-214`). ✅ no change.

Only the `StrategyRow` interface, the adapter's return arm, and the adapter tests need edits. **Do not** default `age` to `0` — that is a fabricated "added today". Same for `manager`: it currently resolves `s.organization_name ?? s.codename ?? null` (`:94`), which for an owner's own strategy is `null ?? null ?? null` → `—`. Honest; leave it.

---

## Architecture Patterns

> `150-PATTERNS.md` is the line-level implementation map (19/21 files have exact analogs). This section adds only what the pattern map did not settle.

### System Architecture Diagram

```
                    ┌──────────────────────────────────────────────┐
   allocator ──────▶│ WIZARD  /strategies/new  (entryContext=       │
   adds a key       │          "contribution" ⇒ show the question)  │
                    │  MetadataStep: capital question FIRST         │
                    │   ▸ More details (collapsed, unchanged data)  │
                    └───────────────┬──────────────────────────────┘
                                    │ finalize (13-arg RPC, UNCHANGED)
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ POST /api/strategies/finalize-wizard          │
                    │   → finalize_wizard_strategy(...)  status=…   │
                    └───────────────┬──────────────────────────────┘
                                    │ THEN a separate owner-scoped write
                                    ▼
   retro path  ────▶┌──────────────────────────────────────────────┐
   /my-strategies   │ PATCH /api/strategies/[id]/ownership          │
   "Mark ownership…"│   assertSameOrigin → getUser → validate →     │
                    │   rateLimit → .eq(id).eq(user_id) →           │
                    │   .select() count-check → audit               │
                    └───────────────┬──────────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │  strategies.capital_ownership                 │
                    │    NULL | 'own_capital' | 'team_review'       │
                    │    (nullable, no default, no backfill)        │
                    └───┬───────────────────────┬──────────────────┘
        display          │                       │  allocatable predicate
      ┌──────────────────┘                       └────────────────┐
      ▼                                                            ▼
 /my-strategies tag        owner factsheet tag        ┌────────────────────────────┐
 (select("*") — free)      (owner LANE only,          │ HOLDINGS strategies panel  │
                            never the cached payload) │  rows = own_capital marked │
                                                      │  (allocated OR not)        │
                                                      └──────────┬─────────────────┘
                                                                 │ Allocate… / Edit…
                                                                 ▼
                                          ┌────────────────────────────────────────┐
                                          │ POST /api/portfolio-strategies/allocation│
                                          │   upsert(portfolio_id, strategy_id,     │
                                          │          allocated_amount)              │
                                          │   ⛔ current_weight NOT written          │
                                          └──────────┬─────────────────────────────┘
                                                     ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │ portfolio_strategies   PK(portfolio_id, strategy_id) ⇒ no dup row  │
        │ ⛔ BEFORE INSERT TRIGGER: strategies.capital_ownership must be      │
        │    'own_capital' else RAISE  ← D-03 holds against EVERY path,      │
        │    including the two client-direct inserts below                    │
        └────────────────────────────────────────────────────────────────────┘
                    ▲                              ▲
                    │                              │
   AddToPortfolio.tsx:54 (client .insert)   MigrationWizard.tsx:72 (client .upsert)
        ── both bypass every route ⇒ route-only enforcement is NOT D-03 ──

   mark FLIP own→team with a live position:
        ONE plpgsql RPC (update mark + delete position in one txn)
        — two PostgREST calls can strand a position = the hole this closes
```

### Pattern 1: The three-defence write (route + RLS + DB constraint)

**What:** every new write gets a route-level pre-check (for a clean 404/409 and a good error), RLS (tenancy), and — where an invariant is claimed — a DB-level constraint or trigger (universality).
**When:** all three new routes. The DB tier is mandatory only for D-03.
**Why the third tier is not belt-and-braces here:** `strategies_update` is `FOR UPDATE USING (user_id = auth.uid())` with **no `WITH CHECK`** (`20260405061912_rls_policies.sql:32`), so the explicit `.eq("user_id", user.id)` in the UPDATE chain is load-bearing, not decorative.

### Pattern 2: Owner-scoped route stack (all three routes)

Copy `src/app/api/portfolio-strategies/alias/route.ts` in full — its docblock (`:20-30`) enumerates the six defences and the ordering matters: **rate limit is consumed AFTER validation** so a 400 does not burn a token (`:99-104`). Zero rows from `.select(<pk>)` is a **404, never `{ok:true}`**. `NO_STORE_HEADERS` on every response including errors.

### Pattern 3: Widened read for the Holdings panel

Today `HoldingsTabPanel.tsx:93-96` feeds `toStrategyRows({ strategies })` where `strategies` are `portfolio_strategies` rows from `queries.ts:3710-3748` — an **admin-client** read gated by an explicit `.eq("portfolio_id", portfolio.id)`.

The new read is an own-scoped `strategies` query LEFT-joined to the position. Two hard requirements:
1. **The tenant gate must be inline with the query** (`.eq("user_id", userId)`) — the existing embed's comment says exactly this: *"keep it inline with the query so a reviewer can't accidentally drop it"* (`queries.ts:3752-3757`).
2. **`daily_returns` may never be selected without `returns_series`** — `src/__tests__/phase-147-series-resolution-guards.test.ts:204` sweeps every production select repo-wide, and its non-vacuity pin (`:208-226`) asserts the scan really sees two-column payloads. Copy the analytics embed shape from `queries.ts:3734-3743`, which already carries both.

### Pattern 4: The allocator render gate is `entryContext`, NOT a role query

`WizardClient.tsx:74` declares `entryContext?: "manager" | "contribution"`, `:147` defaults it to `"manager"`, `:157` derives `const isContribution = entryContext === "contribution"`, and `:980` already threads it into `SubmitStep` (from which it reaches the server as `entry_context`, validated against a closed set with a hard 400 on garbage at `finalize-wizard/route.ts:445-469`, where it is documented as a **trusted context selector, not a client-trusted privilege flag**).

`MetadataStep` does **not** currently receive it (`MetadataStepProps`, `:46-56`) — adding it is one prop on an existing thread, not new plumbing. Reuse that exact reasoning in the code comment.

**Correspondingly, D-07 is a RENDER condition, not an authz boundary.** A manager who POSTs a mark for their own strategy commits no violation. Use `auth.getUser()` + an explicit owner predicate; **do not** call `requireRole` (`src/lib/auth.ts:332-425`) on these routes.

### Pattern 5: Factsheet owner lane — one flag satisfies both the tag and the D-17 gate

`src/app/factsheet/[id]/v2/page.tsx:422-499` resolves `lane: "public" | "owner"` via a two-probe sequence (published-lane first, then an owner-inclusive probe with the **session** id — never a caller-supplied owner id), and threads `viewerNotice={lane === "owner" ? "owner_unpublished" : undefined}` at `:623`.

`lane === "owner"` is reachable **only** when the published probe missed, i.e. the row is unpublished **and** the viewer owns it. That is exactly the D-17 predicate (private/draft + owner) for free. Thread one owner-only prop the same way `viewerNotice` is threaded — nothing enters the cached payload, so the phase-148 pins stay green.

### Anti-Patterns to Avoid

- **Client-direct Supabase writes from a dialog.** `RemoveStrategyButton.tsx:32-36` writes `portfolio_strategies` straight from the browser under RLS only — no CSRF, no rate limit, no audit. Copy its *shape* (Modal + status machine + `router.refresh()`), `fetch()` the route for the *write*.
- **Adding keys to `Badge`'s `statusMap`.** `Badge.tsx:55` falls back `statusMap[label] ?? statusMap.draft`, so an unknown ownership string renders as a **Draft** badge. A separate component reusing the class string has no such fallback.
- **Silent truncation of the renamed name.** The alias route `.slice(0, 120)`s; for a user-visible name that is a fail-quiet. Reject with 400.
- **Defaulting `age`/`weight`/`manager` to `0`/`""` on the new unallocated rows.** Uncomputed → `—`.
- **A second `formatPercent` or a second dollar validator.** Both are contract-pinned/single-definition today.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "No path creates an allocation from a team-review strategy" | A check in the new route only | **DB trigger** on `portfolio_strategies` (`BEFORE INSERT`) reading `strategies.capital_ownership` | Two live client-direct paths bypass routes entirely (`AddToPortfolio.tsx:54`, `MigrationWizard.tsx:72`), plus any direct PostgREST call. Route-only makes D-03 literally false. Trigger idiom: `supabase/migrations/20260716131000_guard_strategies_publish_transition.sql:44-59`. |
| Mark flip + position removal as one write | Two sequential `fetch`es | A `plpgsql` RPC (transaction) | Two calls can strand a position — the exact hole the confirm arm exists to close. Nearest idiom: `20260716130500_…sql:118-127` (`SELECT … FOR UPDATE`) or the `commit_scenario_batch` RPC family. |
| Duplicate-position prevention | UI conditional only | The composite `PRIMARY KEY (portfolio_id, strategy_id)` + `upsert` | Structural, survives any future surface. |
| Percentage rendering | A local formatter | `formatPercent` from `@/lib/utils` | `format-percent-contract.test.ts` fails CI on any local declaration. |
| USD formatting in the dialog | Inline `toFixed` | Export `formatUsd` from `HoldingsTable.tsx` (or lift to allocations `lib/`) | UI-SPEC line 278 forbids a second money formatter on this surface. |
| $1B sanity cap | A new validator | `isValidDollar` + `MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD` | One definition today (`finalize-wizard/route.ts:404-409`); a second would drift. |
| Rate limiting the new writes | A new limiter | `mandateAutoSaveLimiter` (30/60s) | The alias route's own documented justification applies identically. |
| Role checking | An inline roles query | Nothing — these are owner-scoped row writes | `requireRole` returns a discriminated union and 500s (not 403s) on a roles-fetch fault; hand-rolling loses that. But this phase doesn't need role checks at all. |
| Collapsible form section | `CollapsibleSection` | Native `<details>/<summary>` | `CollapsibleSection` carries `useCrossTabStorage` localStorage persistence (`:80-90`), a `COLLAPSIBLE_OPEN_ALL_EVENT` window listener (`:108-116`) and an uppercase-mono `<h2>` — all wrong for a transient form control. In-file precedent for the bare form: `StrategyTable.tsx:1014-1018`. |
| Radio-group keyboard model | Roving-tabindex arrow navigation | The `SignupForm.tsx:174-207` shape (each `role="radio"` button is a tab stop) | That is the established repo baseline; inventing a new keyboard model in this phase is a Rule-11 violation and an untested a11y surface. |

**Key insight:** every "custom solution" temptation in this phase is a place where the repo has already paid for the edge cases *and pinned them with a test that will redden.* The gates are not advisory documentation — `format-percent-contract`, `visibility.test.ts` B10, `no-store-coverage`, `phase-147/148/149` and the `audit.ts` `satisfies` map are all live CI teeth.

---

## Common Pitfalls

### Pitfall 1: Route-level D-03 enforcement is provably incomplete

**What goes wrong:** the gate asserts "no code path creates an allocation from a team-review strategy" while two production files insert into `portfolio_strategies` directly from the browser.
**Evidence (census re-verified this session, `grep -rn 'from("portfolio_strategies")' src/ analytics-service/`):**

| Site | Shape | Creates a row? |
|---|---|---|
| `src/components/portfolio/AddToPortfolio.tsx:54` | client `.insert({portfolio_id, strategy_id})` | **YES** |
| `src/components/portfolio/MigrationWizard.tsx:72` | client `.upsert({…, allocated_amount})` | **YES** |
| `src/components/portfolio/RemoveStrategyButton.tsx:33` | client `.delete()` | no |
| `src/app/api/portfolio-strategies/alias/route.ts:148` | `.update({alias})` | no |
| `src/app/api/admin/allocators/[id]/holdings/route.ts:119`, `api/admin/match/send-intro/route.ts:329`, `queries.ts:1613,3710`, `demo/page.tsx:148`, `portfolio-pdf/[id]/page.tsx:76`, `lib/intro/snapshot.ts:118` | reads | no |

**How to avoid:** a `BEFORE INSERT` trigger on `portfolio_strategies` that looks up `strategies.capital_ownership` and RAISEs unless `'own_capital'`. The structural test then pins the *trigger's existence and definition* rather than trying to enumerate call sites forever. Back it with a **pgTAP** test (see Validation Architecture).
**Warning sign:** a plan task that says "add a mark check to the allocate route" and stops there.

### Pitfall 2: An `INSERT OR UPDATE` trigger breaks the existing alias write on legacy rows

**What goes wrong:** the natural trigger spelling is `BEFORE INSERT OR UPDATE`. But `alias/route.ts:148` issues `UPDATE portfolio_strategies SET alias=…` on rows whose strategy is (and will remain) **unmarked** — every pre-existing position in PROD and every seeded demo row. An UPDATE-covering trigger turns those into a `RAISE`, breaking a shipped feature for exactly the rows the retro path has not reached.
**Root cause:** the invariant is about *creating* a position, not about *touching* one.
**How to avoid:** scope the trigger to `BEFORE INSERT` — optionally plus `BEFORE UPDATE OF allocated_amount` if the plan wants the amount-edit path covered, in which case the trigger must tolerate the unchanged-amount case. Whichever is chosen, add a pgTAP case that proves an alias UPDATE on a legacy unmarked row still succeeds.
**Warning sign:** the migration's self-verifying block only tests the happy insert.

### Pitfall 3: Rename is the first path putting free text into `strategies.name` — and published rows render `name` publicly

**What goes wrong:** today `strategies.name` for every wizard-created strategy is constrained to the `STRATEGY_NAMES` allow-list (`finalize-wizard/route.ts:365`, `STRATEGY_NAME_SET`). The rename route deliberately bypasses that. Meanwhile `StrategyTable.tsx:893` renders `{s.name}` **raw** — and the same component serves `/discovery` and `/browse` with `visibility="published-only"`. D-17 restricts renaming to private/draft, but nothing stops a renamed draft from later being published, at which point the owner-chosen string becomes public.
**Why it happens:** the redaction contract (C-0112) is enforced in `browse/route.ts` and `displayStrategyName`, **not** in `StrategyTable`, which trusts its row set.
**How to avoid:** (a) enforce the private/draft gate **server-side** via `.in("status", ["private","draft"])` in the UPDATE chain so the `.select()` count-check turns a published rename into a clean 404/409 — hiding the button is not enforcement; (b) validate/normalize the name (trim, non-empty, ≤80, reject rather than truncate); (c) record explicitly in the plan that publication is admin-gated (`20260716131000_guard_strategies_publish_transition.sql`) and that an admin therefore reviews the name before it goes public. This is a conscious acceptance, not an oversight.
**Warning sign:** a rename route with no `.in("status", …)` predicate.

### Pitfall 4: Collapsing the asset-class select makes a √252-on-crypto default likelier to ship

**What goes wrong:** `MetadataStep.tsx:100-110` derives `assetClassLocked = isCryptoExchange(detectedExchange)`. On the API-key path the select is `disabled` and force-derived server-side — collapsing it is inert. On the **CSV / unknown-exchange path it is EDITABLE and defaults to `"traditional"`** → √252 annualization on a crypto book, which inflates Sharpe. Hiding it behind a collapsed disclosure removes the last prompt to examine it.
**How to avoid:** either keep-and-accept (documented), or hoist the select out of the disclosure **only when `!assetClassLocked`**. The latter is a two-line conditional and preserves the founder's cull for the 95% path. `phase-84-asset-class-flow.test.ts:22-48` pins three server projections that must keep selecting `asset_class` — those are unaffected either way, so no existing gate forces the answer.
**Warning sign:** a plan that lists asset-class among the collapsed fields with no note.

### Pitfall 5: The phase-149 pin-7 300-character window

**What goes wrong:** `phase-149-my-strategies-parity.test.ts:433-436` does `strategyTableSrc.slice(mount - 300, mount)` and asserts the window contains `'s.status === "published"'`. Inserting the new row-action cluster between the guard and `<SimulateImpactButton>` — or adding a long conditional above it inside the same `<td>` — pushes the guard out of the window and reddens pin 7 with a *misleading* failure message.
**How to avoid:** render the new cluster in its own JSX block **before** the `{s.status === "published" && (` line, or in a sibling element, keeping those two tokens adjacent. Verify by running that one test file before touching anything else.
**Warning sign:** the executor "fixes" pin 7 by widening the window constant.

### Pitfall 6: The mark must not enter the cached factsheet payload

**What goes wrong:** `phase-148-owner-lane-cache-isolation.test.ts:301-349` pins that v2 `page.tsx` calls `unstable_cache` exactly once, that the cached callback contains `fetchAndBuildPayload(id, withPublishedOnly)` literally and **never** `withPublishedOrOwner`, and that the cached wrapper's declaration head contains no `visibility`/`StrategyVisibility`. Adding `capital_ownership` to the cached payload would let an owner's draft render populate an entry an anon visitor can read.
**How to avoid:** ride the owner lane (Pattern 5) — one extra prop threaded alongside `viewerNotice`, nothing added to the payload.
**Warning sign:** any new field appearing inside the cached callback.

### Pitfall 7: Minting a new wizard error code

**What goes wrong:** the v0.53.3.1 hotfix roster invariant means a wizard error code absent from `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx:265`) / `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx:214`) renders the **UNKNOWN** card.
**How to avoid:** **mint no new wizard error code.** The mark write is a separate owner-scoped UPDATE *after* finalize (§ Alternatives Considered), so a mark failure is not a wizard failure arm — which is also why the separate-UPDATE recommendation is the right one for Phase 153's boundary. If a code becomes unavoidable, roster membership in **both** sets plus the WR-11 overlap pins are mandatory.

### Pitfall 8: `.eq("status","published")` anywhere new

`src/lib/visibility.test.ts:87-134` walks all of `src/**` (non-test) with a quote/whitespace-tolerant regex; only `visibility.ts` and `notes/ownership.ts` are exempt, and `:136-146` guards against allowlist rot. Any new published predicate must route through `withPublishedOnly()`. The D-17 status gate is `.in("status", ["private","draft"])`, which the regex does not match — no collision, but confirm before writing it.

---

## Runtime State Inventory

> Included because this phase ships a schema migration and a retro path over **existing PROD rows**.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `strategies` rows finalized before the question existed — Black Swan, **Alpha Centauri (`8d382aaf`, PROD, `status=private`, confirmed 2026-08-04)**, Arctic Fox. All will have `capital_ownership IS NULL` after the migration. | **No data migration.** Deliberately un-backfilled (§ Schema Findings 1) — the retro path (D-09/D-11 Mark dialog) is the remedy. Code must treat `NULL` as non-allocatable and render no tag. |
| **Stored data** | Existing `portfolio_strategies` rows (seed/demo + any real positions) reference strategies that will be `NULL`-marked. | **No migration.** But the D-03 trigger must not break UPDATEs on these rows (§ Pitfall 2). |
| **Live service config** | None. No n8n workflow, Datadog service, Tailscale ACL or Cloudflare tunnel references `capital_ownership`, `own_capital` or `team_review` — verified by repo-wide grep returning zero matches across `src/`, `supabase/`, `analytics-service/`. | None. |
| **OS-registered state** | None — verified: this phase adds no scheduled task, no cron entry, no pm2 process. `pg_cron` jobid 9 (derive-dailies fan-out) is untouched. | None. |
| **Secrets / env vars** | None — no new env var, no feature flag. Verified: the phase ships behind no flag (unlike v1.13/v1.14). | None. ⚠️ Note the absence of a flag: this ships **live on merge**. |
| **Build artifacts / installed packages** | None — zero dependency changes, so no lockfile churn, no egg-info, no image rebuild. | None. |
| **Migration ops** | `supabase/migrations/**` merged to `main` **AUTO-APPLIES to PROD** (MEMORY: `project_supabase_migrate_auto_on_push`). | Apply via MCP to **TEST (`qmnijlgmdhviwzwfyzlc`)** before merge. MCP `apply_migration` stamps `now()` — watch timestamp drift. Grep ALL migrations and re-base on the latest definition before any `CREATE OR REPLACE`. |

---

## Code Examples

### The allocatable predicate — spell it ONCE

```ts
// src/lib/capital-ownership.ts (new — the single source the gate pins)
//
// Three DISPLAY states, two LOGIC states. `null` (never asked) and
// 'team_review' are both non-allocatable, but they are NOT the same
// thing on the display surfaces: null renders no tag (absence is honest,
// the remedy is the Mark dialog), 'team_review' renders the muted tag.
// Do not "simplify" these into one — see 150-RESEARCH.md § Schema Findings 1.
export type CapitalOwnership = "own_capital" | "team_review";

export function isAllocatable(
  mark: CapitalOwnership | null | undefined,
): boolean {
  return mark === "own_capital";
}
```

### The D-03 trigger — INSERT-scoped

```sql
-- Source idiom: supabase/migrations/20260716131000_guard_strategies_publish_transition.sql:44-59
-- ⚠️ INSERT ONLY. An `OR UPDATE` arm breaks the shipped alias write on every
--    legacy row whose strategy is unmarked (150-RESEARCH.md § Pitfall 2).
CREATE OR REPLACE FUNCTION guard_allocation_requires_own_capital()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mark TEXT;
BEGIN
  SELECT capital_ownership INTO v_mark
    FROM public.strategies WHERE id = NEW.strategy_id;

  IF v_mark IS DISTINCT FROM 'own_capital' THEN
    RAISE EXCEPTION
      'strategy % is not marked own_capital (mark=%); it cannot become a position',
      NEW.strategy_id, COALESCE(v_mark, 'unmarked')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
```

### Owner-scoped rename UPDATE — the status gate is server-side

```ts
// Source: src/app/api/portfolio-strategies/alias/route.ts:147-166 (shape),
//         supabase/migrations/20260405061912_rls_policies.sql:32 (why .eq(user_id) is load-bearing:
//         strategies_update is FOR UPDATE USING (...) with NO WITH CHECK)
const { data: updatedRows, error: updateErr } = await supabase
  .from("strategies")
  .update({ name })
  .eq("id", strategyId)
  .eq("user_id", user.id)               // tenant gate — NOT belt-and-braces
  .in("status", ["private", "draft"])   // D-17 enforced server-side, not by hiding the button
  .select("id");

if (updateErr) { /* log + 500 */ }
if (!updatedRows || updatedRows.length === 0) {
  // NOT ok-on-zero-rows (Rule 12). Zero rows = wrong owner, wrong id, or published.
  return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE_HEADERS });
}
```

### The Holdings display-name owner carve-out

```ts
// src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
//
// Source of the reasoning, VERBATIM: src/app/api/strategies/browse/route.ts:53 —
// "disclosure to nobody — the owner already knows their own name + codename."
// This panel is owner-scoped by construction (it reads THIS allocator's book),
// so preferring the owner's own `name` widens disclosure to no one, and it is
// the only way OWN-05's rename reaches this surface: displayStrategyName()
// returns `name` ONLY at disclosure_tier==='institutional', and wizard rows
// default to 'exploratory' with codename NULL → `Strategy #<id8>`.
const strategy =
  ps.alias?.trim() ||
  (viewerOwnsStrategy ? s.name : null) ||
  displayStrategyName({ id: s.id, name: s.name, codename: s.codename ?? null,
                        disclosure_tier: s.disclosure_tier ?? null });
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| `CREATE OR REPLACE FUNCTION` for signature changes | `DROP FUNCTION IF EXISTS <exact signature>` then `CREATE FUNCTION`, re-issuing grants | `20260716130500_finalize_terminal_status_param.sql:27-31` | If (against recommendation) the mark rides the finalize RPC, `CREATE OR REPLACE` registers a **second overload** and breaks PostgREST named-arg dispatch. |
| Client-direct Supabase writes from components | Owner-scoped route handlers with the six-defence stack | `alias/route.ts` (2026-04) | `AddToPortfolio` / `MigrationWizard` / `RemoveStrategyButton` are the legacy tail. Do not extend the pattern. |
| Ad-hoc percentage formatting per component | One `formatPercent` in `utils.ts`, contract-pinned | `format-percent-contract.test.ts` (Phase A1) | Resolves the UI-SPEC's `signed:false` question in favour of the spec (§ Schema Findings 6). |
| Prose "we assert X" claims in plans | Structural phase gates with mutation ledgers | `phase-147/148/149` | D-03's gate must follow this shape or it is not an assertion. |

**Deprecated / superseded:**
- `StrategyForm.tsx:206` (`supabase.from("strategies").update(payload).eq("id", …)` from the browser, no `user_id` predicate, no count-check, no audit) — the legacy manager form. **Do not copy for the rename.**
- The 2026-08-04 "finalize-form with an amount" reading of OWN-03 — superseded by the 2026-08-05 two-step model (mark in wizard, allocate in Holdings).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (`vitest.config.ts`), jsdom environment, `@vitejs/plugin-react` |
| Config file | `/Users/helios-mammut/claude-projects/quantalyze/vitest.config.ts` — `maxWorkers = cpus - 1`, `unstubGlobals: true`, `unstubEnvs: true`, coverage thresholds lines 82 / statements 80 / functions 74 / branches 72 |
| Quick run command | `npx vitest run <path> --no-file-parallelism` |
| Full suite command | `npm test` (`vitest run`) |
| Coverage command | `npm run test:coverage` — **blocking CI gate** via the `frontend-coverage` job |
| DB gate (the only CI-real one) | pgTAP: `supabase/tests/test_*.sql` (53 files today), discovered and run by `.github/workflows/ci.yml:1015-1017` |
| E2E | Playwright, `npm run test:e2e`, specs in `e2e/` |
| Python | `pytest` from **`analytics-service/`** only (repo-root runs miss the VCR cassette dir → live broker calls) |

⚠️ **MEMORY, `reference_db_test_ci_wiring`:** `*_rls.test.ts` live-DB vitest files **never run in CI** (they skip on missing env). Any RLS/trigger assertion that matters must be pgTAP.
⚠️ **MEMORY, `reference_ci_node22_vs_local_node25`:** local Node is v25.8.1, CI is Node 22. Reproduce CI-only failures with `PATH=/opt/homebrew/opt/node@22/bin`.

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| OWN-03 | `capital_ownership` column exists with the exact CHECK value set, nullable, no default | DB | `supabase/tests/test_capital_ownership_column.sql` | ❌ Wave 0 |
| OWN-03 (D-03) | INSERT of a `portfolio_strategies` row for a `team_review` **and** for a `NULL`-marked strategy RAISEs; for `own_capital` succeeds | DB | `supabase/tests/test_capital_ownership_allocation_guard.sql` | ❌ Wave 0 |
| OWN-03 (D-03) | An alias UPDATE on a **legacy unmarked** row still succeeds (Pitfall 2 regression) | DB | same file | ❌ Wave 0 |
| OWN-03 (D-03) | Structural: allocatable predicate spelled once; no production file inserts `portfolio_strategies` outside the sanctioned allowlist; no component renders an allocate affordance without the mark in scope; the mark-flip removal is one statement | static-analysis | `npx vitest run src/__tests__/phase-150-capital-ownership-invariant.test.ts` | ❌ Wave 0 |
| OWN-03 (D-01) | The question defaults to `team_review`; a never-touched submit is byte-identical to today's payload | unit (RTL) | `npx vitest run src/components/strategy/CapitalOwnershipRadioGroup.test.tsx` | ❌ Wave 0 |
| OWN-03 (D-01/D-07) | The question renders only when `entryContext === "contribution"` | unit (RTL) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx"` | ❌ check for existing file |
| OWN-03 (1b) | Cull is render-only: `MetadataDraft`, `onComplete` payload and the finalize body are unchanged | unit | same MetadataStep test | ❌ Wave 0 |
| OWN-03 (D-12/D-15) | Widened row set: marked-unallocated rows appear with `— not allocated`, `age` null → `—`; team-review and unmarked never enter the row set | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts"` | ✅ extend |
| OWN-03 (D-12) | Three empty-state arms fire in priority order | unit (RTL) | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"` | ✅ extend |
| OWN-03 (§6) | Strategy-rows Weight cell is **unsigned** | unit (RTL) | `npx vitest run src/__tests__/format-percent-contract.test.ts` | ✅ extend |
| OWN-03 (D-13/SC4) | Allocate route upserts; a second allocate for the same pair edits, never duplicates | route unit + DB | `npx vitest run "src/app/api/portfolio-strategies/allocation/route.test.ts"` + pgTAP PK case | ❌ Wave 0 |
| OWN-03 (money) | `current_weight` is NOT written by the allocate path | static-analysis | pin in `phase-150-*.test.ts` | ❌ Wave 0 |
| OWN-05 | Rename: owner-only, private/draft-only **server-side**, ≤80 rejected not truncated, zero rows → 404 | route unit | `npx vitest run "src/app/api/strategies/[id]/name/route.test.ts"` | ❌ Wave 0 |
| OWN-05 (SC 1c) | Renamed name renders on /my-strategies, owner factsheet, **and Holdings**; Browse public redaction byte-unchanged | unit (RTL) | adapter + StrategyTable + browse route tests | ❌ Wave 0 |
| OWN-03 (cache) | After an owner views their draft, an anon request for the same id still 404s | integration | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | ✅ must stay green |
| All | Existing gates stay green | regression | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts src/__tests__/phase-148-owner-lane-cache-isolation.test.ts src/__tests__/phase-149-my-strategies-parity.test.ts src/lib/visibility.test.ts src/__tests__/no-store-coverage.test.ts` | ✅ |

### Sampling Rate

- **Per task commit:** the touched file's test + the collision-risk gates (`phase-149`, `phase-147`, `visibility`, `format-percent-contract`) — all five run in seconds.
- **Per wave merge:** `npm test` plus the pgTAP suite against TEST.
- **Phase gate:** full suite + `npm run test:coverage` green (blocking ratchet) + `npm run lint` + `npx tsc --noEmit` before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `supabase/tests/test_capital_ownership_column.sql` — column shape (OWN-03)
- [ ] `supabase/tests/test_capital_ownership_allocation_guard.sql` — trigger positive/negative/null + the legacy-alias-UPDATE regression (D-03, Pitfall 2)
- [ ] `src/__tests__/phase-150-capital-ownership-invariant.test.ts` — structural gate with a Rule-9 mutation ledger (D-03)
- [ ] `src/components/strategy/CapitalOwnershipRadioGroup.test.tsx` — default, a11y semantics, single-source copy
- [ ] `src/app/api/strategies/[id]/ownership/route.test.ts`
- [ ] `src/app/api/strategies/[id]/name/route.test.ts`
- [ ] `src/app/api/portfolio-strategies/allocation/route.test.ts`
- [ ] Extensions to `strategies-row-adapter.test.ts`, `HoldingsTable.strategy-rows.test.tsx`, `format-percent-contract.test.ts`
- [ ] Framework install: **none needed** — Vitest, Playwright and pgTAP CI wiring all exist

---

## Security Domain

`security_enforcement` is absent from `.planning/config.json` ⇒ **enabled**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control (in-repo) |
|---------------|---------|----------------------------|
| V2 Authentication | yes | `createClient()` + `supabase.auth.getUser()` → 401 with `NO_STORE_HEADERS`. Never trust a caller-supplied user/owner id — the factsheet lane probe (`v2/page.tsx:442-446`) documents this rule explicitly. |
| V3 Session Management | yes (indirect) | Supabase SSR cookie session; no new session surface. `NO_STORE_HEADERS` on every response prevents caching authenticated bodies (`no-store-coverage.test.ts` enforces). |
| V4 Access Control | **yes — the phase's core risk** | Three layers: explicit `.eq("user_id", user.id)` / `portfolios.user_id` predicate **inline with the query**; RLS (`strategies_update`, `portfolio_strategies_owner`); DB trigger for D-03. ⚠️ `strategies_update` has **no `WITH CHECK`** — the explicit predicate is the real gate. Zero affected rows ⇒ **404, never `{ok:true}`**. |
| V5 Input Validation | yes | `typeof` guards + trim + bounds before the write, and **before** the rate-limit token is consumed. Mark value against a closed set (`'own_capital' \| 'team_review'`) with a 400 on anything else — mirrored by the DB CHECK. Amount via `isValidDollar` + `MAX_DOLLAR_VALUE_USD`. Name: non-empty after trim, ≤80, **reject not truncate**. |
| V6 Cryptography | no | No new crypto surface. |
| V7 Error Handling & Logging | yes | `logAuditEvent` on every write; `catch` blocks **bind and log** the error (never bare `catch {}`); `buildEnvelope()` for user-facing failures — no invented strings. |
| V13 API / Web Service | yes | `assertSameOrigin(req)` (CSRF) as statement one of every route; `checkLimit(mandateAutoSaveLimiter, …)` → 429 + `Retry-After`, consumed after validation so a 400 does not burn a token. |
| V14 Configuration | yes (advisory) | Migrations merged to `main` auto-apply to PROD; no feature flag guards this phase. Apply to TEST via MCP first. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant write via a forged `strategy_id`/`portfolio_id` in the JSON body | Elevation of Privilege | Explicit owner predicate inline with the query + RLS + zero-rows-is-404. Never a caller-supplied owner id. |
| Mass assignment (an extra body key reaching the UPDATE) | Tampering | Destructure and whitelist the exact fields; `.select(<pk>)` count-check. `alias/route.ts:147-166` is the reference. |
| Silent success on zero affected rows (fail-quiet authz) | Repudiation | 404 on zero rows, always. Rule 12. |
| CSRF on a state-changing `PATCH`/`POST` from a browser dialog | Tampering | `assertSameOrigin(req)` first. Note the existing client-direct writes have **none** — do not extend that pattern. |
| Bypassing D-03 via a direct PostgREST call under the user's own RLS grant | Elevation of Privilege | The DB trigger — a route check cannot see this path. |
| Pseudonymity bypass: a user-chosen `strategies.name` leaking a real identity to public surfaces after publication | Information Disclosure | Server-side private/draft gate on rename + admin-gated publication (`guard_strategies_publish_transition`). `browse/route.ts` redaction unchanged (codename wins). **Accept consciously** (Pitfall 3). |
| New public-readable column on published rows (`capital_ownership` via the `strategies_read` splat) | Information Disclosure | Decide explicitly: accept, or exclude from public projections. Not sensitive on its face; must not be discovered later. |
| Rate-limit token exhaustion via malformed bodies | Denial of Service | Validate before `checkLimit` (B15 ordering). |
| Stranded position from a non-atomic mark flip | Tampering / integrity | One transactional RPC, not two `fetch`es. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vitest, Next build | ✓ | v25.8.1 (**CI runs 22** — see MEMORY) | `PATH=/opt/homebrew/opt/node@22/bin` to reproduce CI |
| npm | dependency graph, scripts | ✓ | 11.11.0 | — |
| Python 3 | analytics-service tests (read-only relevance this phase) | ✓ | 3.14.3 | — |
| Supabase CLI | local migration lint / diff | ✓ | 2.84.2 | Supabase MCP `apply_migration` against TEST |
| `gh` CLI | PR flow | ✓ | 2.92.0 | — |
| Supabase MCP (TEST `qmnijlgmdhviwzwfyzlc`) | applying the migration before merge | assumed available per MEMORY | — | `supabase db push` against TEST with explicit credentials |
| Playwright browsers | e2e | not probed | — | e2e is not required to prove this phase; vitest + pgTAP are the gates |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none blocking.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The owner factsheet masthead renders `payload.strategyName` sourced (directly or transitively) from `strategies.name`, so the rename shows there without extra work. | Schema Findings 4 | If it routes through `displayStrategyName`, the factsheet joins Holdings in the SC-1c gap and the carve-out must cover two surfaces, not one. **Planner: confirm at `FactsheetView.tsx:668-675` / the payload builder before task-writing.** |
| A2 | There exist live `portfolio_strategies` rows in PROD whose strategies will be `NULL`-marked (making Pitfall 2 a real, not theoretical, breakage). | Pitfall 2 · Runtime State Inventory | If PROD has zero positions, the `INSERT OR UPDATE` trigger would be harmless — but scoping to INSERT costs nothing and is correct regardless, so the recommendation is unchanged. |
| A3 | Supabase MCP access to TEST (`qmnijlgmdhviwzwfyzlc`) is available in the execution session. | Environment Availability | Migration cannot be validated pre-merge; falls back to `supabase db push` with credentials, or the migration ships unverified to PROD on merge — **unacceptable**; escalate rather than skip. |
| A4 | No existing `MetadataStep` test file — Wave 0 must create one. | Validation Architecture | Trivially checkable; if it exists, extend rather than create. |
| A5 | The founder accepts an em-dash Weight cell on allocated rows until Phase 151 (consequence of not writing `current_weight`). | Schema Findings 2 | If not, Phase 151's weight derivation must be pulled forward into this phase — a scope change that must be surfaced at plan review, **not** solved by writing a raw `current_weight`. |

---

## Open Questions

1. **Does `current_weight` stay unwritten, and does the founder accept `—` in the Weight column?**
   - What we know: nothing in the repo writes it; two analytics-service consumers default `NULL → 1.0` and would be skewed by a mixed NULL/filled portfolio.
   - What's unclear: whether the approved mock's `$120,000 · 24.00%` is a hard expectation.
   - **Recommendation:** write `allocated_amount` only this phase; record the em-dash Weight cell as an explicit, documented non-goal owned by Phase 151. Surface it at plan review so it is a decision, not a surprise.

2. **Does the rename need to reach the Holdings label (SC 1c), and via which mechanism?**
   - What we know: `displayStrategyName` will never return `name` for these rows; the owner carve-out has a documented in-repo precedent (`browse/route.ts:44-56`).
   - What's unclear: whether the founder reads "holdings alias" in OWN-05 as "the alias column" or as "the label on Holdings".
   - **Recommendation:** implement the adapter owner carve-out. It satisfies the stricter reading, widens disclosure to nobody, and does not couple rename to a position row.

3. **INSERT-only trigger, or INSERT + `UPDATE OF allocated_amount`?**
   - What we know: an UPDATE-covering trigger breaks the shipped alias write on legacy rows.
   - **Recommendation:** INSERT-only for this phase, with a pgTAP case pinning that the legacy alias UPDATE still succeeds. Revisit if a future surface can move an amount onto an unmarked strategy.

4. **Is `capital_ownership` acceptable as a publicly-readable column on published strategies?**
   - **Recommendation:** accept and state it in the migration header (mirroring `strategies_status_private.sql:20-27`, which documents *why no RLS change is needed*). If not acceptable, the fix is projection-level, not RLS-level, and should be its own task.

5. **Asset-class select: keep collapsed, or hoist when editable?**
   - **Recommendation:** hoist out of the disclosure **only when `!assetClassLocked`** — two lines, preserves the cull for the API-key path, and removes a live Sharpe-inflation vector on the CSV path. If the planner prefers keep-and-accept, it must be written down as an accepted risk, not omitted.

---

## Sources

### Primary (HIGH confidence — read at file:line this session)

- `src/lib/strategy-display.ts` (full) — the `displayStrategyName` precedence chain
- `src/lib/utils.ts:3-30` — `formatPercent` signature and default `signed: true`
- `src/lib/queries.ts:294-311, 3695-3760` — `getMyStrategies` splat; the my-allocation `portfolio_strategies` embed
- `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` (full) — row shape, `age`, `manager`, name resolution
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:72-101, 203-320, 730-745` — formatters, comparator, both Weight cells, dead-end empty state
- `src/components/ui/Modal.tsx` (full) — no footer slot; native `<dialog>`
- `src/components/strategy/StrategyTable.tsx:885-925` — the name cell and the Delta-3 marker rationale
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:74, 147, 157, 960-1000` — `entryContext` thread
- `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx:1-60` — `MetadataDraft`, `MetadataStepProps`
- `src/app/api/strategies/finalize-wizard/route.ts:350-380, 404-433` — `STRATEGY_NAME_SET` allow-list, `isValidDollar`
- `src/app/api/strategies/create-with-key/route.ts:55-75` — `pickPlaceholderCodename` writes to `name`
- `src/app/api/strategies/browse/route.ts:44-56, 153, 184-236` — the owner carve-out precedent and its security reasoning
- `src/lib/ratelimit.ts:97-216` — limiter inventory
- `src/lib/audit.ts:379, 391, 413-415, 536-592` — action union and the compile-enforced map
- `src/lib/envelope.ts:4, 25, 75` — canonical envelope exports
- `src/lib/visibility.test.ts:87-146` — B10 sweep + rot guard
- `src/__tests__/format-percent-contract.test.ts:1-40, 95, 107-146` — the signed/unsigned policy and its existing pin
- `src/__tests__/phase-147-series-resolution-guards.test.ts:204-236` — `daily_returns`/`returns_series` sweep + non-vacuity pin
- `src/__tests__/phase-149-my-strategies-parity.test.ts:420-437` — pin 7 and its 300-char window
- `supabase/schema/functions/finalize_wizard_strategy.sql:6-25` — the 13-parameter signature
- `supabase/migrations/20260405061911_initial_schema.sql:52, 138-143` — `strategies.name TEXT NOT NULL`; the composite PK
- `supabase/migrations/20260405061912_rls_policies.sql:28-32, 67-69` — `strategies_read`, `strategies_update` (no `WITH CHECK`), `portfolio_strategies_owner`
- `supabase/migrations/20260408113028_disclosure_and_tenancy.sql:63-73` — `disclosure_tier` default `'exploratory'`
- `supabase/migrations/20260408155411_strategy_codename.sql:14-19` — codename nullable, UI falls back to name
- `supabase/migrations/20260407075303_portfolio_intelligence.sql:105-107` — `current_weight` / `allocated_amount` added
- `analytics-service/routers/portfolio.py:575-607` — `_build_normalized_weights` NULL→1.0
- `analytics-service/routers/match.py:780-800` — the documented mixed-NULL skew
- `vitest.config.ts:1-60`, `package.json` scripts, `.github/workflows/ci.yml:831, 1015-1017` — test/CI wiring
- `.planning/REQUIREMENTS.md:533-602` — OWN-03 and OWN-05 verbatim
- `.planning/phases/150-.../150-CONTEXT.md`, `150-UI-SPEC.md`, `150-PATTERNS.md` — upstream contracts

### Secondary (MEDIUM confidence)

- Repo-wide greps for `capital_ownership` / `own_capital` / `team_review` (zero matches), `current_weight` writers (zero), `from("portfolio_strategies")` census (18 sites, 2 creators) — mechanical and reproducible, but a grep can miss a dynamically-constructed table name.
- MEMORY entries: `reference_db_test_ci_wiring`, `reference_ci_node22_vs_local_node25`, `project_supabase_migrate_auto_on_push`, `project_cross_cutting_refactor_program`.

### Tertiary (LOW confidence)

- A1 (factsheet `strategyName` source) — inferred from the masthead excerpt in `150-PATTERNS.md` §10, not read at the payload builder this session. Flagged in the Assumptions Log.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no external dependencies; every module verified present at file:line.
- Schema findings: **HIGH** — each is a direct grep/read result, reproducible in one command.
- Architecture: **HIGH** — patterns are in-repo analogs cross-checked against `150-PATTERNS.md`.
- Pitfalls: **HIGH** for 1, 2, 3, 5, 6, 7, 8 (each cites a live gate or a live call site); **MEDIUM** for 4 (the money-math consequence is real but its likelihood depends on CSV-path usage).
- Validation architecture: **HIGH** — config, CI wiring and existing test files read directly.
- Security domain: **HIGH** for the control inventory; **MEDIUM** for the ASVS mapping (judgement, not verification).

**Research date:** 2026-08-06
**Valid until:** 2026-09-05 (30 days — this is an internal-codebase phase with no external dependency drift; the only staleness vector is the codebase itself, so **re-verify the `current_weight` and `portfolio_strategies` write censuses if Phase 151 lands first**).
