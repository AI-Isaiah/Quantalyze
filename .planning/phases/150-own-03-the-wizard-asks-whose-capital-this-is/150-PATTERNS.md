# Phase 150: OWN-03 — The wizard asks whose capital this is - Pattern Map

**Mapped:** 2026-08-06
**Files analyzed:** 21 new/modified
**Analogs found:** 19 / 21 (2 have no in-repo analog)

> Upstream: `150-CONTEXT.md` (D-01…D-18), `150-UI-SPEC.md` (approved, revision 1).
> No `150-RESEARCH.md` exists — every pattern below is a REAL codebase analog,
> read at the cited lines.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `supabase/migrations/<ts>_strategies_capital_ownership.sql` (NEW) | migration | DDL | `20260716130000_strategies_status_private.sql` + `20260409202758_portfolio_strategies_alias.sql` | exact (two-part) |
| `supabase/migrations/<ts>_finalize_capital_ownership_param.sql` (NEW, conditional) | migration | DDL/RPC | `20260716130500_finalize_terminal_status_param.sql` | exact |
| `src/components/strategy/CapitalOwnershipRadioGroup.tsx` (NEW) | component | form-input | `src/components/auth/SignupForm.tsx:176-207` | exact |
| `src/components/strategy/OwnershipTag.tsx` (NEW) | component | presentational | `src/components/ui/Badge.tsx:52-67` | exact |
| `.../wizard/steps/MetadataStep.tsx` (MOD) | component | form-input | itself + `CollapsibleSection.tsx:137-147` (caret only) | self |
| `.../wizard/WizardClient.tsx` (MOD) | component | state-thread | `WizardClient.tsx:74,147,157,932-980` (`entryContext`) | exact |
| `src/app/api/strategies/finalize-wizard/route.ts` (MOD) | route | request-response | itself `:440-500, :1190-1212` | self |
| `src/components/strategy/StrategyTable.tsx` (MOD) | component | presentational | itself `:896-962` (Delta-3 marker), `:1044-1063` (action cell) | self |
| `src/components/strategy/MarkOwnershipDialog.tsx` (NEW) | component | request-response | `src/components/portfolio/RemoveStrategyButton.tsx` (whole file) | exact |
| `src/components/strategy/RenameStrategyDialog.tsx` (NEW) | component | request-response | `RemoveStrategyButton.tsx` + `Field.tsx` error wiring | exact |
| `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` (NEW) | component | request-response | `src/components/portfolio/MigrationWizard.tsx:63-94` (amount parse) | role-match |
| `src/app/api/strategies/[id]/ownership/route.ts` (NEW) | route | CRUD | `src/app/api/portfolio-strategies/alias/route.ts` (whole file) | exact |
| `src/app/api/strategies/[id]/name/route.ts` (NEW) | route | CRUD | same alias route | exact |
| `src/app/api/portfolio-strategies/allocation/route.ts` (NEW) | route | CRUD (money) | same alias route + `MigrationWizard.tsx:72` upsert shape | exact |
| `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx` (MOD) | component | state-host | itself `:52-60` (client-boundary rationale) | self |
| `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` (MOD) | component | transform | itself `:93-96` | self |
| `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` (MOD) | utility | transform | itself (whole file — pure, injectable `now`) | self |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (MOD) | component | presentational | itself `:224-318` (`StrategyRowsTable`) | self |
| `src/lib/queries.ts` (MOD — own-capital strategy read) | service | CRUD | `queries.ts:3709-3748` (dashboard `portfolio_strategies` embed) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` + `page.tsx` (MOD) | component/route | presentational | `page.tsx:623` (`viewerNotice`) + `FactsheetView.tsx:662-688` masthead | exact |
| `src/__tests__/phase-150-*.test.ts` (NEW — D-03 gate) | test | static-analysis | `src/__tests__/phase-149-my-strategies-parity.test.ts` (whole file) | exact |
| `supabase/tests/test_capital_ownership_*.sql` (NEW) | test | DB | `supabase/tests/*.sql` (53 existing pgTAP files) | exact |

---

## Pattern Assignments

### 1. Wizard capital-question fieldset → `CapitalOwnershipRadioGroup.tsx`

**⚠️ The UI-SPEC's cited analog is the wrong one for SEMANTICS.**
UI-SPEC line 110 says "the broker-selector idiom verbatim (`ConnectKeyStep.tsx:642`)".
That element is `aria-pressed` — **toggle** semantics, not radio. The UI-SPEC's own
anatomy row demands "Real radio semantics (keyboard operable, `aria-checked`)".

**Resolution (Rule 7 — pick one, don't blend):** copy **SEMANTICS from
`SignupForm.tsx`**, **CLASS STRING from either** (they already agree on the
selected treatment `border-accent bg-accent/5`).

**Analog A — semantics (COPY THIS SHAPE):** `src/components/auth/SignupForm.tsx:174-207`

```tsx
<div>
  <p className="mb-2 text-sm font-medium text-text-primary">I am...</p>
  <div role="radiogroup" aria-label="Account type" className="space-y-2">
    {SIGNUP_ROLE_OPTIONS.map((r) => {
      const checked = role === r.value;
      return (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={checked}
          data-testid={`signup-role-${r.value}`}
          onClick={() => setRole(r.value)}
          className={cn(
            "w-full rounded-lg border p-3 text-left transition-colors",
            checked
              ? "border-accent bg-accent/5"
              : "border-border hover:border-accent/50",
          )}
        >
          <p className="text-sm font-medium text-text-primary">{r.label}</p>
          <p className="mt-0.5 text-xs text-text-muted">{r.description}</p>
        </button>
      );
    })}
  </div>
  <p className="mt-2 text-xs text-text-muted">This is locked after signup. …</p>
</div>
```

**Analog B — class string:** `ConnectKeyStep.tsx:630-655` (`<fieldset>` +
`<legend className="text-caption font-medium text-text-primary">` + option cards
`rounded-md border px-4 py-3 text-left transition-colors`, active
`border-accent bg-accent/5`, inactive `border-border bg-white hover:border-accent/50`).

**What differs / what the planner must reconcile:**
- SignupForm uses `rounded-lg p-3` + `text-sm`/`text-xs` raw Tailwind sizes.
  UI-SPEC pins `rounded-md px-4 py-3 text-body` + `text-caption`. Take the
  UI-SPEC/ConnectKeyStep tokens, the SignupForm structure.
- SignupForm's group label is a `<p>`; ConnectKeyStep uses `<fieldset>/<legend>`.
  UI-SPEC says "fieldset radiogroup" — use `<fieldset>` + `<legend>` + an inner
  `role="radiogroup"` wrapper (or `<fieldset role="radiogroup">`), not a bare `<p>`.
- **Neither analog implements roving-tabindex arrow-key navigation.** SignupForm's
  `role="radio"` buttons are each tab-stops. That is the established repo baseline —
  match it (Rule 11), do not invent a new keyboard model in this phase.
- **UI-SPEC invariant 5 ("ONE question component"):** this component is imported by
  BOTH `MetadataStep.tsx` and `MarkOwnershipDialog.tsx`. Only the group label
  differs (`Whose capital is in this key?` vs `Whose capital is this?`) → pass it
  as a prop; the two option labels and the helper line are module constants.
- **Placement:** put it under `src/components/strategy/` (shared), NOT under
  `wizard/steps/` — the dialog mount lives in a different tree.

**InlineChipGroup precedent for the local sub-component idiom:**
`MetadataStep.tsx:386-419` — a private component at the bottom of the file. That
is the pattern for file-local helpers; the capital group is NOT file-local (two
mounts) so it gets its own file.

---

### 2. Collapsed "More details" disclosure in `MetadataStep.tsx`

**UI-SPEC decision (line 125): do NOT use `CollapsibleSection`.** Confirmed correct
by reading it — `src/components/ui/CollapsibleSection.tsx` carries
`useCrossTabStorage` localStorage persistence (:80-90), a
`COLLAPSIBLE_OPEN_ALL_EVENT` window listener (:108-116), an uppercase-mono
`<h2>` summary and a `Hide`/`Show` affordance (:148-159). All wrong for a
transient form control.

**Copy ONLY the CSS caret**, `CollapsibleSection.tsx:139-147`:

```tsx
<span
  aria-hidden
  className="inline-block w-2 h-2 transition-transform group-open:rotate-90"
  style={{
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: "5px solid var(--color-text-muted)",
  }}
/>
```

…which requires `className="group"` on the `<details>` (`:135`) and
`list-none … min-h-[44px]` on the `<summary>` (`:137`).

**A second, closer in-file precedent already exists:** `StrategyTable.tsx:1014-1018`
uses a bare `<details>/<summary>` for the priority-collapse "More" cell — no
component, no persistence. That is the exact weight the wizard disclosure wants.

**Contents to move in verbatim (`MetadataStep.tsx`), in current order:**

| Control | Current lines |
|---|---|
| `InlineChipGroup` Strategy Types | :282-287 |
| `InlineChipGroup` Subtypes | :289-294 |
| Markets + its two detected/not-detected micro notes | :296-314 |
| `InlineChipGroup` Supported exchanges | :316-323 |
| Asset class `Select` (+ locked comment) | :325-343 |
| Leverage / AUM / Max capacity grid | :345-366 |

**⚠️ Asset-class money-math flag (UI-SPEC lines 140-145) — the evidence:**
`MetadataStep.tsx:100-110` is the comment that explains `assetClassLocked =
isCryptoExchange(detectedExchange)`. On the API-key path the select is `disabled`
and force-derived server-side, so collapsing it is inert. On the **CSV /
unknown-exchange path it is EDITABLE and defaults to `"traditional"`** → √252 on a
crypto book. Collapsing it makes that default likelier to ship unexamined. Planner
call, per UI-SPEC: keep-and-accept, or hoist out of the disclosure **only when
`!assetClassLocked`**.

**What must NOT change (D-08 consumer sweep is real, not ceremonial):**
the fields stay in `MetadataDraft` (`:28-45`), stay in `handleSubmit`'s
`onComplete({...})` (`:199-211`), and stay in the finalize-wizard payload
(`route.ts:476-499`). Collapsing is a RENDER change only. The submit gate
(`:377` `disabled={!description.trim() || !categoryId}`) is unchanged —
wizard validation UX is Phase 153's.

---

### 3. Ownership mark tag → `OwnershipTag.tsx`

**Analog:** `src/components/ui/Badge.tsx:52-67` (the class string) and
`StrategyTable.tsx:917-919` (the render site + the 149 Delta-3 rationale comment).

**Class string to reuse VERBATIM** (`Badge.tsx:62`):

```tsx
"inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium"
```

**Ink, per the UI-SPEC family table — precedent for both tokens is already in
`Badge.tsx`:**

| Mark | Classes | In-file precedent |
|---|---|---|
| own-capital | `bg-accent/10 text-accent` | `statusMap.intro_made` (`Badge.tsx:27`) |
| team-review | `bg-badge-other/10 text-text-muted` | `statusMap.private` (`Badge.tsx:24`) / `statusMap.archived` (`:17`) |
| unmarked | render `null` | `StrategyTable.tsx:915-916` — "absence of a marker IS 'published'" |

**⛔ Do NOT add keys to `statusMap`.** UI-SPEC line 76 says so, and the reason is
mechanical: `Badge.tsx:55` falls back `statusMap[label] ?? statusMap.draft`, so an
unknown ownership string would silently render as a DRAFT badge. A separate
component that reuses the class string has no such fallback.

**Render site (name cell, after the status Badge):** `StrategyTable.tsx:889-920` —
the `<div className="flex items-center gap-1.5">` that already holds
link → verified check (`:896-902`) → status Badge (`:917-919`).

**Do NOT reach for the `DATA_STATE_CHIP` constant** (`StrategyTable.tsx:76-77`,
`rounded-sm` / `text-fixed-11` uppercase). Its header comment (`:69-75`) explicitly
says "Do NOT harmonize" — that family is derived pipeline state; the mark is
owner-declared. UI-SPEC lines 54-70 make the same call.

---

### 4. /my-strategies row action + dialogs

**Row-action cell:** `StrategyTable.tsx:1055-1063` — the existing action `<td>`:

```tsx
<td className="px-4 py-3 text-right group-hover:bg-page/50 transition-colors">
  {s.status === "published" && (
    <SimulateImpactButton candidateStrategyId={s.id} candidateName={s.name} portfolioId={portfolioId} />
  )}
</td>
```

**⚠️⚠️ HIGHEST-RISK GATE COLLISION IN THIS PHASE — read before editing this cell.**
`phase-149-my-strategies-parity.test.ts:433-436` (pin 7) does:

```ts
const mount = strategyTableSrc.indexOf("<SimulateImpactButton");
const guardWindow = strategyTableSrc.slice(Math.max(0, mount - 300), mount);
expect(guardWindow).toContain('s.status === "published"');
```

A **300-character** comment-stripped window. Inserting the new action cluster
BETWEEN `{s.status === "published" && (` and `<SimulateImpactButton` — or even
adding a long conditional above it inside the same `<td>` — pushes the guard out of
the window and reddens pin 7 with a misleading message. **Render the new cluster in
its own JSX block BEFORE the `{s.status === "published" && (` line, or in a sibling
element, keeping those two tokens adjacent.**

**Ghost text-action treatment (UI-SPEC lines 168-172):** the closest live idiom is
`RemoveStrategyButton.tsx:51-57`:

```tsx
<button
  type="button"
  onClick={() => setOpen(true)}
  className="text-caption font-medium text-text-muted hover:text-negative transition-colors"
>
  Remove
</button>
```

(swap `hover:text-negative` → `hover:text-text-primary` for non-destructive
actions; add `focus-visible:ring-2 focus-visible:ring-accent/20`).
The accent-underline variant is at `StrategyTable.tsx:1155-1161` ("Finish setup →")
— that is the placeholder-row CTA, deliberately louder; do not copy it here.

**Dialog host:** `RemoveStrategyButton.tsx` (83 lines) is the **complete** analog —
trigger button + `Modal` + `status: "idle" | "loading" | "error"` + `router.refresh()`:

```tsx
const [open, setOpen] = useState(false);
const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
const [error, setError] = useState<string | null>(null);
// …
<Modal open={open} onClose={() => setOpen(false)} title="Remove Strategy">
  <p className="text-small text-text-secondary">…{strategyName}…</p>
  {error && <p className="text-small text-negative mt-3">{error}</p>}
  <div className="flex justify-end gap-3 mt-6">
    <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    <Button type="button" variant="danger" onClick={handleConfirm} disabled={status === "loading"}>
      {status === "loading" ? "Removing..." : "Remove"}
    </Button>
  </div>
</Modal>
```

**What differs (three deliberate deviations):**
1. **The write must NOT be a client-direct supabase call.** `RemoveStrategyButton.tsx:32-36`
   writes `portfolio_strategies` straight from the browser under RLS only — no CSRF,
   no rate limit, no audit row. D-14 scopes a money-path review to this write; copy
   the **route** shape (§5/§7) and `fetch()` it from the dialog.
2. **`disabled={status === "loading"}` violates the no-disabled-buttons direction**
   for the *validation* case. UI-SPEC line 303: the CTA stays clickable and submit
   surfaces the inline field error. In-flight disabling is a different thing and is
   fine (UI-SPEC line 417 asks for an in-flight label).
3. **Error rendering:** UI-SPEC lines 231-235 require the canonical
   `buildEnvelope()` → `ErrorEnvelope` inside the dialog body, not
   `RemoveStrategyButton`'s invented `"Failed to remove strategy. Please try again."`
   string. Envelope machinery: `src/lib/envelope.ts`; wizard render precedent:
   `.../wizard/WizardErrorEnvelope.tsx`.

**`Modal` primitive facts** (`src/components/ui/Modal.tsx`, 50 lines): native
`<dialog>` + `showModal()`, `max-w-lg p-6`, title rendered as
`text-h3 font-semibold`, built-in close X. Props are exactly
`{ open, onClose, title, children }` — **there is no footer slot**; footers are
composed in `children` (as above).

**Dialog host placement:** `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx`
(90 lines) is already the client boundary for this surface, and its header comment
(`:2-17`) states the rule: a function prop cannot cross the RSC→client boundary, so
`onFinishSetup`-style callbacks are minted here. Mint the `onMarkOwnership` /
`onRename` callbacks in the SAME place and pass them down as new optional
`StrategyTable` props.

**Form primitives for the Rename dialog:** `Field` (`src/components/ui/Field.tsx`)
wires `htmlFor`/`id`, `aria-describedby`, `aria-invalid` and renders
`<p className="text-caption text-negative">` for `error` (`:88-92`). `Input`
(`src/components/ui/Input.tsx:27-30`) independently supports `label`/`error` and
adds `border-negative` on error. Use **`Field` + a bare control** (the
`MetadataStep.tsx:239-250` precedent) — `Field` is the primitive that closes the
`aria-describedby` gap; do not double-wrap `Field` around `Input` (both would emit
a label).

**`Button` variants available** (`src/components/ui/Button.tsx:7-19`):
`primary` (`bg-accent text-white`), `secondary` (`bg-white … border-border`),
`ghost`, `danger` (`bg-negative text-white hover:bg-red-700`). Sizes `sm | md | lg`.
The UI-SPEC's "`Button` primary styled `bg-negative`" is exactly `variant="danger"` —
use the existing variant, do not pass a className override.

---

### 5. Rename write → owner-scoped `strategies.name` UPDATE

**Analog (authz shape — copy this file's structure verbatim):**
`src/app/api/portfolio-strategies/alias/route.ts` (179 lines). Its docblock
(`:20-30`) enumerates the six defences; reproduce all six.

```ts
export async function PATCH(req: NextRequest) {
  const csrfError = assertSameOrigin(req);          // 1. CSRF  (:39)
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" },
    { status: 401, headers: NO_STORE_HEADERS });     // 3. auth  (:46-51)

  let body: AliasBody;
  try { body = (await req.json()) as AliasBody; }
  catch (err) {                                      // bound + logged, never bare (:57-70)
    console.error("[api/…] body parse failed:", {
      message: err instanceof Error ? err.message : String(err), userId: user.id });
    return NextResponse.json({ error: "invalid json" },
      { status: 400, headers: NO_STORE_HEADERS });
  }
  // … typeof-guard + trim + slice(0, N) normalisation (:72-97)

  const rl = await checkLimit(mandateAutoSaveLimiter, `alias:${user.id}`);  // 2. (:105)
  if (!rl.success) return NextResponse.json({ error: "Too many requests" },
    { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } });

  // 6. MASS-ASSIGNMENT / SILENT-SUCCESS GUARD — .select() the affected ids (:147-166)
  const { data: updatedRows, error: updateErr } = await supabase
    .from("portfolio_strategies").update({ alias })
    .eq("portfolio_id", portfolioId).eq("strategy_id", strategyId)
    .select("strategy_id");
  if (updateErr) { console.error(…); return 500; }
  if (!updatedRows || updatedRows.length === 0) return 404;  // NOT ok-on-zero-rows

  logAuditEvent(supabase, { action: "allocation.update", entity_type: "allocation",
    entity_id: portfolioId, metadata: { strategy_id: strategyId, alias } });  // (:171-176)
  return NextResponse.json({ ok: true, alias }, { headers: NO_STORE_HEADERS });
}
```

Note ordering (`:99-104`): **rate limit is consumed AFTER input validation** so a
400 does not burn a token (B15). Keep that order.

**What differs for `strategies.name`:**
- Target table is `strategies`, and the tenant predicate is direct:
  `.eq("id", strategyId).eq("user_id", user.id)` — the 149 own-only idiom
  (`queries.ts` `getMyStrategies`, pinned at
  `phase-149-my-strategies-parity.test.ts:471`).
  **This explicit predicate is load-bearing, not belt-and-braces:** RLS
  `strategies_update` is `FOR UPDATE USING (user_id = auth.uid())` with **no
  `WITH CHECK`** (`supabase/migrations/20260405061912_rls_policies.sql:32`).
- **D-17 status gate must be enforced SERVER-SIDE, not only by hiding the button.**
  Add `.in("status", ["private", "draft"])` to the UPDATE chain; the `.select()`
  count-check then turns a published-row rename attempt into a clean 404/409.
- **Length cap:** `strategies.name` is bare `TEXT NOT NULL`
  (`20260405061911_initial_schema.sql:52`) — no DB cap. The UI-SPEC's 80-char cap is
  therefore a product rule the route must enforce (`alias` uses `.slice(0, 120)`
  at `:91`; prefer **reject with 400** over silent truncation for a user-visible
  name — silent truncation is a fail-quiet).
- **Publish-transition trigger is NOT tripped.**
  `20260716131000_guard_strategies_publish_transition.sql:51-58` only RAISEs when
  `NEW.status = 'published'` AND the status is *changing to* published. A name-only
  UPDATE never enters that branch. Verified — no workaround needed.
- **Audit action:** `src/lib/audit.ts:319-…` is a closed union with a
  `Record<AuditAction, AuditEntityType>` map (`:536-592`) — adding a literal without
  a map entry is a **compile error** (`:562` documents the two-step). There is no
  `strategy.rename` / `strategy.update` today (only `strategy.delete|approve|reject`
  at `:413-415`). Adding one is the correct move; `user_note.strategy.update`
  (`:391`) shows the naming shape.
- **Rate limiter:** reuse `mandateAutoSaveLimiter` (30/min, `ratelimit.ts:156`) —
  the alias route's own justification (`:99-104`) is "the closest sibling allocator-
  write surface", which applies identically. Do **not** mint a new limiter.

**Client-side rename precedent (what NOT to copy):** `StrategyForm.tsx:206` does
`supabase.from("strategies").update(payload).eq("id", strategy.id)` from the
browser — no `user_id` predicate, no count-check, no audit. It is the legacy
manager form; the route above supersedes it.

---

### 6. Allocate / Edit / Remove dialogs + USD amount field

**Amount parse + validation analog:** `src/components/portfolio/MigrationWizard.tsx:63-76`

```tsx
async function handleSubmit() {
  if (!selected) return;
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    setError("Amount must be a positive number");
    return;
  }
  setStep("saving"); setError(null);
  const { error: psError } = await supabase.from("portfolio_strategies").upsert({
    portfolio_id: portfolioId, strategy_id: selected.id,
    allocated_amount: parsed, allocated_at: eventDate, relationship_status: "connected",
  });
  …
}
```

This is the **only** existing "USD amount → `allocated_amount`" write in the repo.
Copy: `Number()` + `Number.isFinite() && > 0`. **Do not copy:** the raw error string
(UI-SPEC pins `Enter an amount above $0.`), the client-direct upsert (see §7), or
the absent upper bound.

**Upper-bound precedent for a dollar field is SERVER-side and already exists:**
`src/app/api/strategies/finalize-wizard/route.ts:411-433` validates `aum` /
`max_capacity` with `isValidDollar` against `MAX_DOLLAR_VALUE` and returns
`{ error: "aum must be a finite non-negative number under …" }` at 400. Reuse
`isValidDollar` / `MAX_DOLLAR_VALUE` for the $1B sanity cap rather than minting a
second dollar validator (grep confirms one definition today).

**Currency formatter — DO NOT write a new one.** `HoldingsTable.tsx:72-80`:

```ts
function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
```

It is module-private today. If the Allocate dialog needs it, **export it from
`HoldingsTable.tsx`** (or lift to the allocations `lib/`) — a second inline
`toFixed` on the money surface is exactly what the UI-SPEC forbids (line 278).

**⚠️ UI-SPEC citation error to reconcile (line 278):** the spec pins the weight cell
to `formatPercent(w, 2, { signed: false })` "at `HoldingsTable.tsx:739`". Line 739 is
in a **different** table in that file. The actual strategy-row weight cell is
**`HoldingsTable.tsx:293-295`**:

```tsx
<td className="px-4 py-2 text-right tabular-nums">
  {row.weight == null ? "—" : formatPercent(row.weight)}
</td>
```

— i.e. `formatPercent(row.weight)` with **default** options. Changing it to
`(w, 2, { signed: false })` is a real visual change to an existing shipped column.
Planner must decide: match the spec (and own the column change) or match the
neighbouring row (and correct the spec). Do not do it accidentally.
`src/__tests__/format-percent-contract.test.ts` exists — check it before touching.

**Modal + confirm-inside-dialog:** `RemoveStrategyButton.tsx` again (§4). The
UI-SPEC's two "two-step inline confirm INSIDE the dialog (no nested modal)" arms are
a `useState` swap of the dialog body — there is no nested-modal precedent in the
repo to copy, and `Modal.tsx` uses native `<dialog>.showModal()` which does not
nest cleanly. The inline-confirm choice is correct.

---

### 7. `portfolio_strategies` write path + the D-03 census

**Table shape** (`20260405061911_initial_schema.sql:138-143` +
`20260407075303_portfolio_intelligence.sql:105,107` +
`20260409202758_portfolio_strategies_alias.sql:21`):

```sql
CREATE TABLE portfolio_strategies (
  portfolio_id UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  strategy_id  UUID NOT NULL REFERENCES strategies  ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, strategy_id)          -- ← D-13 "never a 2nd row" is a PK
);
-- + allocated_amount NUMERIC, current_weight NUMERIC, alias TEXT
```

**The composite PK is why D-13 / SC4 holds at the DB level** — an `upsert` on
`(portfolio_id, strategy_id)` is structurally incapable of minting a second row.
State that in the plan; it is stronger than the UI-level argument.

**RLS** (`20260405061912_rls_policies.sql:67-69`):

```sql
CREATE POLICY portfolio_strategies_owner ON portfolio_strategies FOR ALL USING (
  portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
);
```

No explicit `WITH CHECK` — under `FOR ALL` Postgres reuses `USING` as the check, so
INSERT/UPSERT is covered. Note it in the money-path review rather than "fixing" it.
The route still needs the explicit `portfolios.user_id` pre-check for a clean 404
(alias route `:116-137` states exactly this rationale).

**⛔ D-03 CENSUS — every production site that CREATES a `portfolio_strategies` row today.**
The structural gate must enumerate these, not just the new route:

| Site | Shape | Mark-checked today? |
|---|---|---|
| `src/components/portfolio/AddToPortfolio.tsx:54-57` | client `.insert({portfolio_id, strategy_id})` | **NO** |
| `src/components/portfolio/MigrationWizard.tsx:72-75` | client `.upsert({…, allocated_amount})` | **NO** |
| `src/app/api/portfolio-strategies/alias/route.ts:148` | `.update({alias})` — never creates | n/a |
| `src/app/api/admin/allocators/[id]/holdings/route.ts:119` | `.select` only | n/a |
| `src/app/api/admin/match/send-intro/route.ts:329` | `.select` only | n/a |
| `src/lib/queries.ts:1613`, `:3710`; `demo/page.tsx:148`; `portfolio-pdf/[id]/page.tsx:76`; `lib/intro/snapshot.ts:118` | reads | n/a |

**Two live insert paths bypass the invariant.** "No code path creates an allocation
from a team-review strategy" (D-03) is FALSE the moment the column ships unless
those two are gated (server-side, not just visually) or the gate is enforced at the
DB level. **The most robust answer is a DB trigger/CHECK** (a `BEFORE INSERT OR
UPDATE` on `portfolio_strategies` that looks up
`strategies.capital_ownership = 'own_capital'` and RAISEs otherwise) — that makes the
invariant hold against *every* path including a direct PostgREST call, and the
structural test then pins the trigger's existence rather than trying to enumerate
call sites forever. Trigger idiom to copy:
`supabase/migrations/20260716131000_guard_strategies_publish_transition.sql:44-59`.

**Route shape for the new allocate write:** the alias route (§5) verbatim, with
`.upsert({ portfolio_id, strategy_id, allocated_amount })` +
`.select("strategy_id")` count-check, and `logAuditEvent(… action: "allocation.update",
entity_type: "allocation", entity_id: portfolioId, metadata: { strategy_id, allocated_amount })`
— that action + entity pair already exists (`audit.ts:379,592`), so **no audit-union
change is needed for the allocate/remove writes** (only for the rename/mark).

**Widened Holdings read (D-12/D-15) — the panel must list marked-but-unallocated strategies.**
Today `HoldingsTabPanel.tsx:93-96` feeds `toStrategyRows({ strategies })` from
`props.strategies` = `portfolio_strategies` rows only
(`queries.ts:3709-3748`). The new read is an own-scoped `strategies` query
LEFT-joined to the position. Copy the embed shape from `queries.ts:3718-3744` —
**and see §9's phase-147 trap: `daily_returns` may never be selected without
`returns_series`.** The adapter (`strategies-row-adapter.ts`) is pure with an
injectable `now` (:47-51) — keep that discipline; the new "no position" row means
`weight: null, allocation: null` and `age` derived from something other than
`ps.added_at` (which will be absent) — decide honestly, do not default to 0.

---

### 8. The migration (`capital_ownership` column)

**Two analogs, both needed. Compose them.**

**(a) Column addition + comment** — `20260409202758_portfolio_strategies_alias.sql:21-25`:

```sql
ALTER TABLE public.portfolio_strategies
  ADD COLUMN IF NOT EXISTS alias TEXT;

COMMENT ON COLUMN public.portfolio_strategies.alias IS
  'Allocator-provided display name override … NULL means fall back to …';
```

Idempotent `IF NOT EXISTS`; a `COMMENT ON COLUMN` documenting what NULL means.

**(b) Constrained value set + pre-flight + self-verifying block** —
`20260716130000_strategies_status_private.sql` (the closest recent
enum-ish/CHECK migration on the *same table*, `strategies`):

- Header explains **why the migration exists**, cites the exact prior definition
  with file:line (`:15-18`), and states whether it is an RLS migration and why not
  (`:20-27`).
- `BEGIN;` … `COMMIT;`.
- **Pre-flight `DO $$` block** that `RAISE EXCEPTION`s listing offending values
  before the constraint is added (`:44-55`).
- **DROP-then-ADD** constraint idiom (re-runnable, ordering-independent) `:57-61`.
- **Self-verifying `DO $$`** that reads `pg_get_constraintdef(oid)` and RAISEs if
  the new value (and every pre-existing one) is not present (`:65-80`).

**Shape decision the planner owns (D-04 says STRATEGY-level):**
`ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS capital_ownership TEXT`
+ `CHECK (capital_ownership IN ('own_capital','team_review'))`.

**Nullable-vs-defaulted is the load-bearing call, and the UI-SPEC has already
decided it:** the family table (UI-SPEC line 71) says unmarked legacy rows render
**no tag** — "absence is honest… the remedy is the row action (retro path, D-11)".
That requires the column to be **NULLABLE with NO DEFAULT**. A
`DEFAULT 'team_review' NOT NULL` backfill would mark Black Swan / Alpha Centauri /
Arctic Fox as team-review, which is a fabricated claim about the founder's own
capital. **So: nullable, no backfill, and the three-state UI is intentional**
(`null` ≠ `team_review` on the display surfaces; they coincide only in the
*allocatable* predicate, where both are non-allocatable).

**RLS touch: none required.** Same argument as `strategies_status_private.sql:20-27`
— `strategies_read` (`20260405061912_rls_policies.sql:28-30`) is already
`status='published' OR user_id=auth.uid()`, and `strategies_update` is
`user_id = auth.uid()`. Adding a column changes neither. **Say so explicitly in the
migration header** (that file's precedent).

**⚠️ The column is PUBLICLY READABLE on published rows.** `strategies_read` grants
anon SELECT of every column on a published strategy. If a published own-capital
strategy exists, `capital_ownership` is fetchable by anyone who queries the column.
UI-SPEC invariant 3 says public surfaces render zero pixels of this phase — that is
a RENDER invariant, not a data one. Decide consciously: acceptable (it is not
sensitive), or exclude from the public projections. Do not discover this later.

**Ops (from CONTEXT `<specifics>` and MEMORY):** merging `supabase/migrations/**`
to `main` AUTO-APPLIES to PROD. Apply via MCP to TEST (`qmnijlgmdhviwzwfyzlc`)
before merge. MCP `apply_migration` stamps `now()` — watch for timestamp drift.

**Conditional second migration — the finalize RPC.** If the wizard's mark rides
`finalize_wizard_strategy`, the signature must change. Analog:
`20260716130500_finalize_terminal_status_param.sql` — read its header (`:1-56`), it
is written for exactly this situation:

- `DROP FUNCTION IF EXISTS finalize_wizard_strategy(<exact 12-type signature>);`
  then `CREATE FUNCTION` — **never `CREATE OR REPLACE`**: appending a parameter
  registers a SECOND overload and breaks PostgREST named-argument dispatch (`:27-31`).
- Re-base the body **byte-for-byte** on `supabase/schema/functions/finalize_wizard_strategy.sql`
  (the replayed latest def) with only the minimal additions (`:15-25`).
  ⭐ MEMORY rule: re-base on the LATEST def, grep ALL migrations first.
- A FIRST-statement guard that RAISEs on out-of-set values, with
  `USING ERRCODE = 'invalid_parameter_value'` (`:96-105`).
- **DROP discards grants** → re-issue `REVOKE ALL … FROM PUBLIC, anon;` +
  `GRANT EXECUTE … TO authenticated;` after each CREATE (`:54-55`, `:211-214`).
- Call site then needs the untyped-cast escape hatch, because
  `database.types.ts` is not regenerated —
  `finalize-wizard/route.ts:1182-1212`:

  ```ts
  const { data: finalizedId, error } = await (
    supabase.rpc as unknown as (fn: "finalize_wizard_strategy",
      rpcArgs: Record<string, unknown>) => Promise<{ data: string | null; error: {…} | null }>
  )("finalize_wizard_strategy", { p_strategy_id: …, p_terminal_status: terminalStatus });
  ```

**Cheaper alternative worth costing:** write the mark as a **separate owner-scoped
UPDATE after** the finalize RPC returns (the §5 route shape), leaving the RPC
signature untouched. Costs atomicity (a mark could be lost if the second write
fails); saves a DROP/CREATE of a SECURITY DEFINER function on the wizard's critical
path. Given D-01's default is `team_review` (== today's behaviour, SC 2), a lost
mark degrades to the safe state. **Recommend the separate UPDATE**; flag for the
plan-time decision.

---

### 9. Structural phase gate for D-03

**Analog:** `src/__tests__/phase-149-my-strategies-parity.test.ts` (657 lines).
Copy the whole architecture:

- **Header docblock (`:6-104`)** — WHY the file exists; WHY a structural layer at
  all (the measured asymmetry argument); WHAT IS PINNED, one numbered pin per
  `it()` so a failure names the offender; a "comment hygiene" paragraph explaining
  why stripping is load-bearing for the specific negatives being asserted.
- **Rule-9 mutation ledger (`:106-190+`)** — N semantic mutations at N *independent*
  production sites, each RUN, each failure pasted VERBATIM, each reverted by
  RE-EDITING the line (never `git checkout --`). Prefer "second member" sites (the
  one the author did NOT have in mind — M2 mutated `browse`, not `discovery`).
  Record what stayed GREEN too — that asymmetry is the file's justification.
- **Helpers (`:290-380`)** — `stripComments` (block comments then `^\s*//` lines,
  `:300-304`), `productionSources` recursive walk skipping `__tests__`/`node_modules`/
  `.d.ts`/`.test.tsx` (`:307-321`), `bodyBraceIndex` (first `{` after the
  paren-balanced param list — naive "first brace" is wrong for destructured params,
  `:329-342`), `declarationHead` (`:349-354`), `functionBody` (brace-balanced,
  `:357-368`), `countOccurrences` (`:371-380`).
- **Self-pinned literal constants (`:387-396`)** — `EFFECTIVE_VIEW_MODE_DERIVATION`,
  `WIDENING_PROP`, `INVERSION_ARM` regex with a comment on why the character class
  prevents false positives.
- **Occurrence COUNTS, not presence checks** where a surviving second occurrence
  would mask the mutation (pin 5, `:60`; ledger M4 `:169-183` shows a presence check
  is structurally blind there).
- **Repo walk pins (`:79-84`)** — "exactly ONE production file does X, and its path
  is Y".
- **Anti-vacuity pin (`:86-87`, `:451-452`, and 148's `:383-392`)** — assert the
  extractor really found a body, the stripper really stripped (read a file whose
  raw text contains the token only inside a comment and assert the stripped text
  does not), and the walk really found files. **An empty offender list must mean
  clean, not blind.**
- **A missing pinned source is a FAILURE, not a skip** (`:89-90`, Rule 12).

**Second analog for the "no second caller" walk:**
`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts:357-405`.

**What Phase 150's gate should pin (draft — planner refines):**
1. The allocatable predicate is spelled ONE place; the literal
   `'own_capital'` appears in the gate's named helper and in no ad-hoc comparison.
2. Repo walk: no production file writes `portfolio_strategies` (`.insert(`/`.upsert(`)
   outside the sanctioned allocate route — enumerate the §7 census as offenders or
   as an explicit SANCTIONED allowlist with a rot-guard (the B10 `SANCTIONED` idiom,
   `src/lib/visibility.test.ts:98,136-146`).
3. No component renders an allocate affordance without the mark predicate in scope
   (window-guard idiom, pin 7).
4. If a DB trigger is chosen (§7), pin the migration's existence + the constraint
   definition, and back it with a **pgTAP** test.
5. The mark-flip write and the position removal are ONE statement/transaction.

**⚠️ CI reality check (MEMORY, `reference_db_test_ci_wiring`):** `*_rls.test.ts`
live-DB vitest files **never run in CI** (they skip on missing env). The RLS/SQL
half of this gate MUST be `supabase/tests/test_*.sql` (53 pgTAP files exist —
`test_csv_daily_returns_perkey_rls.sql` etc. are the shape). Use
`src/__tests__/portfolio-strategies-alias-rls.test.ts` only as a *documentation*
analog for the T1/T2/T3 cross-tenant scenario structure (`:16-27`), not as the gate.

**⛔ Existing gates that Phase 150's edits can trip — check EACH before editing:**

| Gate | Pinned literal / rule | 150 collision risk |
|---|---|---|
| `phase-149-…:403-418` (pin 1) | `'visibility = "published-only"'` and `'strategies.filter((s) => s.status === "published")'` must survive **verbatim** in `StrategyTable.tsx` | Reformatting the destructuring or the filter breaks it |
| `phase-149-…:420-437` (pin 7) | `EFFECTIVE_VIEW_MODE_DERIVATION` literal; `s.status === "published"` within **300 chars before** `<SimulateImpactButton` | **HIGH** — see §4. The action-cluster insertion is exactly the edit that breaks this |
| `phase-149-…:440-455` (pin 2) | `discovery/[slug]/page.tsx` + `browse/[slug]/page.tsx` contain **no** `visibility=`, `placeholderKeys`, `onFinishSetup` | Any new owner-only prop should JOIN this negative list |
| `phase-149-…` pins 10/11 | exactly ONE production file passes `visibility="owner-all-statuses"`; exactly ONE exports `StrategyTable` | Do not add a second owner mount |
| `phase-148-…:301-349` | v2 `page.tsx` calls `unstable_cache` **exactly once**; the cached callback contains `fetchAndBuildPayload(id, withPublishedOnly)` literally and **never** `withPublishedOrOwner`; the cached wrapper's declaration head contains **no** `visibility`/`StrategyVisibility`; `export const dynamic = "force-dynamic"` | **HIGH** — putting the mark into the CACHED factsheet payload is the failure mode. Ride the owner-only lane instead (see §10) |
| `phase-148-…:375-382` | no production file outside the v2 page mentions `buildFactsheetPayloadCached` / `fetchAndBuildPayload` | Do not add a second payload caller for the mark |
| `phase-147-…:204-236` | **repo-wide sweep**: no production select reads `daily_returns` without `returns_series`; allowlisted surfaces must also call `resolveDailyReturnSeries(` | **HIGH** — the widened Holdings read (§7) selects analytics. Copy `queries.ts:3734-3743` which already has both |
| `src/lib/visibility.test.ts:87-134` (B10) | repo-wide walk of `src/**` (non-test) for `/\.eq\(\s*["']status["']\s*,\s*["']published["']\s*\)/` — quote/whitespace tolerant; only `visibility.ts` + `notes/ownership.ts` exempt | Any new published predicate must use `withPublishedOnly()` (`AddToPortfolio.tsx:48` shows correct usage) |
| `phase-84-asset-class-flow.test.ts:22-48` | three server projections must keep selecting `asset_class` | Low — pins projections, not the form. But see §2's money-math flag |
| v0.53.3.1 hotfix (`e0493913`) roster invariant | `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx:265`), `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx:214`) — a wizard error code absent from the roster renders the **UNKNOWN** card | **150 must mint NO new wizard error code.** The mark write must not introduce a wizard failure arm (Phase 153 owns the class fix). If a code is unavoidable, roster membership in BOTH sets + the WR-11 overlap pins are mandatory |
| `src/lib/audit.ts:536-592` | `as const satisfies Record<AuditAction, AuditEntityType>` | A new action literal without a map entry is a compile error (by design) |
| `src/__tests__/format-percent-contract.test.ts` | percent formatting contract | Check before altering the §6 weight cell |

---

### 10. Server-side owner-authz route guard

**Route-handler guards, three tiers — pick per route:**

| Helper | Source | Use when |
|---|---|---|
| `withAuth(handler)` | `@/lib/api/withAuth`; used by `finalize-wizard/route.ts:609` | Authenticated-only; hands the handler a typed `User` |
| `requireRole(supabase, user, ...roles)` | `src/lib/auth.ts:332-425` | A specific app role is required |
| inline `auth.getUser()` + explicit `.eq("user_id", user.id)` | `alias/route.ts:42-51` + `:119-124` | **Owner-scoped row writes — this phase's three routes** |

`requireRole` returns a discriminated union (`src/lib/auth.ts:305-307`):

```ts
const result = await requireRole(supabase, user, "admin");
if ("forbidden" in result) return result.forbidden;
const { roles } = result;
```

Its docblock (`:322-331`) records that the variadic is typed
`[AppRole, ...AppRole[]]` so a zero-role call is a **compile** error, and
(`:346-360`) that a roles-fetch fault returns **500, not 403** — outages must not
masquerade as authorization errors. **Do not hand-roll a role check.**

**For Phase 150 the correct tier is the third** — these are owner-scoped row
writes, not role-gated features. The allocator/manager distinction (D-07) is a
RENDER condition, not an authz boundary: a manager who POSTs the mark for their own
strategy is not committing a violation. Use `auth.getUser()` + an explicit
`.eq("user_id", user.id)` (or `portfolios.user_id` for the allocation route) with
RLS as the second gate — exactly the alias route's stack.

**The allocator-render signal already exists and is NOT a role lookup:**
`WizardClient.tsx:74` `entryContext?: "manager" | "contribution"` → `:157`
`const isContribution = entryContext === "contribution"`. The contribution mount is
the allocator inline-overlay path (`:68-70`). Thread `isContribution` into
`MetadataStep` as the capital-question render gate — no new role query, no new prop
plumbing pattern. It also already reaches the server as `entry_context`
(`finalize-wizard/route.ts:445-469`), where it is validated against a closed set
with a hard 400 on garbage and is explicitly documented as a **trusted context
selector, not a client-trusted privilege flag** (`:452-453`). Copy that reasoning
verbatim for the mark parameter if it travels the same way.

**Factsheet owner-lane gate (Surface 3):** `src/app/factsheet/[id]/v2/page.tsx:422-499`
resolves `lane: "public" | "owner"` via a two-probe sequence (published-lane first,
then an owner-inclusive probe with the session id — **never** a caller-supplied
owner id, `:442-446`), and passes `viewerNotice={lane === "owner" ? "owner_unpublished" : undefined}`
at `:623`. Consumed by `FactsheetView.tsx:232`.

**This single flag satisfies BOTH the mark display AND the D-17 rename gate for
free:** `lane === "owner"` is reachable only when the published-lane probe MISSED,
i.e. the row is unpublished AND the viewer owns it. A published own strategy
resolves on the public lane → `Rename…` is absent with no extra predicate. Thread
one owner-only prop the same way `viewerNotice` is threaded, and the phase-148
cache pins stay green because nothing enters the cached payload.

Masthead insertion point — `FactsheetView.tsx:668-675`:

```tsx
<h1 className="font-serif text-page-title leading-tight sm:leading-none text-text-primary">
  {payload.strategyName}
</h1>
<div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
  <TrustTierLabel trustTier={payload.trustTier} />
  <span className="text-caption text-text-secondary">{chips.length > 0 ? chips.join(" · ") : "—"}</span>
  …
</div>
```

The ownership tag goes in that `TrustTierLabel` row; the `Rename…` ghost action on
the H1 baseline row.

---

## Shared Patterns

### Owner-scoped route stack (apply to ALL THREE new routes)
**Source:** `src/app/api/portfolio-strategies/alias/route.ts` (whole file; docblock `:20-30`)

1. `assertSameOrigin(req)` → early-return the error response (`:39`)
2. `createClient()` + `auth.getUser()` → 401 with `NO_STORE_HEADERS` (`:42-51`)
3. `req.json()` in try/catch that **binds and logs** the error (never a bare
   `catch {}`) → 400 (`:53-70`)
4. `typeof` guards + trim + bounds on every field (`:72-97`)
5. `checkLimit(mandateAutoSaveLimiter, \`<scope>:${user.id}\`)` → 429 +
   `Retry-After` — **after** validation so a 400 does not burn a token (`:99-114`)
6. Explicit ownership pre-check → clean 404 (`:116-137`)
7. The write with `.select(<pk>)` → **zero rows is a 404, never `{ok:true}`** (`:139-166`)
8. `logAuditEvent(supabase, {action, entity_type, entity_id, metadata})` (`:168-176`)
9. `NextResponse.json({ ok: true, … }, { headers: NO_STORE_HEADERS })` (`:178`)

`NO_STORE_HEADERS` is on EVERY response including errors — `src/__tests__/no-store-coverage.test.ts` enforces it.

### Client dialog + write + refresh
**Source:** `src/components/portfolio/RemoveStrategyButton.tsx` (whole file)
`useState` trigger → `Modal` → `status: "idle"|"loading"|"error"` → `router.refresh()`
on success. **Swap the client-direct supabase write for a `fetch()` to the route.**

### Honest absence (no-invented-data)
- Uncomputed metric → `—`, never `0`: `StrategyTable.tsx:1127-1150`,
  `HoldingsTable.tsx:293-310`, `formatUsd` null-arm `:73`.
- Unmarked row → **no tag**: `StrategyTable.tsx:915-917`.
- A limitation is stated WITH its condition: UI-SPEC's
  `Weight appears once your book equity is known.` mirrors
  `MetadataStep.tsx:303-313` (detected/not-detected markets micro notes).

### Empty-state anatomy
**Source:** `HoldingsTable.tsx:256-259` (current dead end) and
`src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx` (149 anatomy —
`rounded-lg border border-border bg-surface px-6 py-8`, heading + body + link, no icon).
The three-arm priority ordering precedent is `StrategyTable.tsx:1067-1085` — read
that comment block; it explains why arm order is load-bearing (a message about "the
filtered set" must not fire when nothing was filtered).

### Structural-gate authoring
**Source:** `phase-149-my-strategies-parity.test.ts` (§9) + `phase-148-…test.ts` +
`src/lib/visibility.test.ts:87-146` (repo-walk + SANCTIONED allowlist + rot-guard).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| The **coupled mark-flip + position-removal write** (UI-SPEC lines 213-218) | route | CRUD, transactional | No in-repo precedent for "one confirmed write spanning two tables". The nearest transactional idiom is a `plpgsql` function with `SELECT … FOR UPDATE` (`20260716130500_…sql:118-127`) or the `commit_scenario_batch` RPC family (`supabase/tests/test_commit_scenario_batch_*.sql`). **Recommend an RPC**, not two sequential PostgREST calls — two calls can strand a position, which is precisely the D-03 hole this arm exists to close. |
| **Live weight preview** `≈ {w}% of your book (${bookEquity})` | component | derived display | No dialog in the repo previews a derived weight against book equity. Book-equity sourcing lives in the allocator-equity surface (`20260717233529_allocator_equity_derived_surface.sql`, `src/__tests__/allocator-equity-rls.test.ts`) — Phase 151 owns AUM mechanics, so the honest fallback arm (`Weight appears once your book equity is known.`) is likely the only arm this phase can truthfully render. Confirm at plan time rather than inventing a divisor. |

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/strategies/new/wizard/**`,
`src/components/{ui,strategy,portfolio,auth,discovery}/**`,
`src/app/(dashboard)/{allocations,my-strategies}/**`, `src/app/factsheet/[id]/v2/**`,
`src/app/api/{strategies,portfolio-strategies,admin}/**`, `src/lib/{auth,audit,ratelimit,queries,visibility,envelope}.ts`,
`src/__tests__/**`, `supabase/migrations/**`, `supabase/tests/**`

**Files read at line level:** 30 · **Files grepped:** ~90
**Pattern extraction date:** 2026-08-06
