# Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable) — Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 25 (23 modified, 2 candidate-new)
**Analogs found:** 24 / 25 (1 partial — see §No Analog Found)

> **How to read this file.** Every excerpt below is copied verbatim from HEAD with its
> real path and line range. Where a plan action says "follow the X pattern", it must
> instead say "copy the shape at `<path>:<lines>`". Three items in this phase are
> **structural invariants** the UI-SPEC/RESEARCH demand rather than stylistic choices —
> they are called out as ⭐ and each has a live precedent in the tree.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | component (form step) | request-response | itself `:210-233` + `AllocateDialog.tsx:248-262` | exact |
| `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` | component (dialog form) | request-response | `MetadataStep.tsx:325-336` (aria-derived border) | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` | component (form step) | request-response | `SyncPreviewStep.tsx:2309-2390` (long-wait card) + `BridgeDrawer.tsx:195-239` (abort) | role-match |
| `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` | component (form step) | request-response | `ConnectKeyStep.tsx` (structural mirror by construction) | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | component (submit step) | request-response | `ConnectKeyStep.tsx:265-315` roster + `SubmitStep.tsx:229-…` | exact |
| *(candidate new)* long-wait card component | component (presentational) | event-driven (timer) | `SyncPreviewStep.tsx:2309-2390` | role-match |
| `src/app/api/strategies/finalize-wizard/route.ts` | route handler | request-response | `create-with-key/route.ts` coded-400 arms; local `:549-644` | exact |
| `src/lib/wizardErrors.ts` | shared copy registry (isomorphic) | transform | `ALLOCATION_NOT_ALLOCATABLE` `:1564-1592` (last additive member) | exact |
| `src/lib/closed-sets.ts` | config / closed-set registry | transform | `EXCHANGE_DISPLAY :48-55` + `UI_EXCHANGE_CODES :199-216` | exact |
| `src/lib/resilient-fetch.ts` | config (seam budget table) | config | `SEAM_BUDGETS["validate-key"]` row + `finalize-wizard` branch legs `:810-817` | exact |
| `src/lib/analytics-client.ts` | service (seam client) | request-response | `process-key-client.ts:111-136` `budgetKeyFor` | exact |
| `src/lib/seam-retry-registry.ts` | config (audit registry) | config | `RETRY_AUDIT_NO_ANALYTICS :518-543` | exact |
| `src/lib/wizardErrors.invariant.test.ts` | test (source-scan invariant) | file-I/O | itself `:103-127` `ROUTES` | exact |
| `src/lib/seam-constants.pin.test.ts` | test (literal pin) | config | `:274-292` / `:262-272` / `:694-718` | exact |
| `src/lib/seam-budgets.invariant.test.ts` | test (arithmetic invariant) | transform | `:386-469` + `:931-943` | exact |
| `src/lib/seam-retry-registry.test.ts` | test (set equality) | config | key-set equality at `:188-191` | exact |
| `src/lib/closed-sets.mt5-flag.test.ts` | test (flag pin, DELIBERATE RE-CUT) | config | itself `:55-71` | exact |
| `src/lib/closed-sets.test.ts` | test (pin) | config | `MAGNITUDE_CAPS` pin `:323` | exact |
| `src/lib/wizardErrors.test.ts` | test (table sweep) | transform | `EXPECTED_TABLE_SIZE :1437` / `:1649` | exact |
| `src/app/api/strategies/finalize-wizard/route.test.ts` | test (route unit) | request-response | itself (exists) | exact |
| `…/steps/MetadataStep.test.tsx` | test (RTL) | request-response | itself `:1-60` | exact |
| `…/steps/ConnectKeyStep.test.tsx` | test (RTL) | request-response | itself | exact |
| `…/allocations/components/AllocateDialog.test.tsx` | test (RTL) | request-response | itself | exact |
| `analytics-service/routers/exchange.py` | service (FastAPI probe) | request-response | `services/exchange.py:869` `_ACLOSE_TIMEOUT_S` + `mt5_concurrency.py:53-70` | role-match |
| `analytics-service/tests/test_mt5_validate.py` | test (pytest) | request-response | `test_exchange.py:127-147` (monkeypatched timeout) + `test_mt5_client_contract.py:304-305` | exact |

---

## ⭐ Pattern Assignments — the four load-bearing mechanisms

### ⭐1. Inline field validation — the aria-derived red border

**The invariant the UI-SPEC demands:** *"a red control without `aria-invalid=true`"* must be
**structurally impossible**. That is achieved by deriving the border from the aria state in
CSS, never from a JS ternary.

**Analog A — the a11y wrapper (`src/components/ui/Field.tsx:60-95`), read in full:**

```tsx
const generatedId = useId();
const id = providedId ?? generatedId;
const hintId = hint ? `${id}-hint` : undefined;
const errorId = error ? `${id}-error` : undefined;
const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

const control = Children.only(children);
const wiredControl = isValidElement(control)
  ? cloneElement(control, {
      id,
      "aria-describedby": describedBy,
      "aria-invalid": error ? "true" : undefined,   // ← line 72: the ONLY writer
      ...control.props,
    })
  : control;

return (
  <div className={cn("flex flex-col gap-1.5", className)}>   {/* ← 6px, UI-SPEC FLAG-7 */}
    <label htmlFor={id} className="text-small font-medium text-text-primary">{label}</label>
    {wiredControl}
    {hint && <p id={hintId} className="text-caption text-text-muted">{hint}</p>}
    {error && <p id={errorId} className="text-caption text-negative">{error}</p>}
  </div>
);
```

⚠️ `...control.props` is spread **last** — a child that sets its own `aria-invalid` WINS. Do
not hand-set `aria-invalid` on the control; let `Field` own it.

**Analog B — the three sites that already derive the border correctly** (grep-verified, these
are the complete set at HEAD):

| Site | Class string (the load-bearing suffix) |
|---|---|
| `MetadataStep.tsx:334` | `…focus:ring-accent/20 aria-[invalid=true]:border-negative` |
| `CsvUploadStep.tsx:624` | `…focus:ring-accent/20 aria-[invalid=true]:border-negative` |
| `RenameStrategyDialog.tsx:178` | `…focus:ring-accent/20 aria-[invalid=true]:border-negative` |

`MetadataStep.tsx:325-336` in full — **this is the exact element the phase edits**, and it
already carries the correct mechanism plus the weak focus ring the UI-SPEC requires upgrading
in the same edit:

```tsx
<Field label="Description" error={showDescriptionError}>
  <textarea
    ref={descriptionRef}
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    onBlur={() => setDescriptionBlurred(true)}
    rows={3}
    placeholder="One paragraph describing the strategy, edge, and risk framing."
    required
    className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-negative"
  />
</Field>
```

**Analog C — the ONE site that does NOT** (UI-SPEC FLAG-1, D-12 puts it in scope).
`AllocateDialog.tsx:354-357`:

```tsx
className={`min-h-[44px] rounded-lg border bg-surface px-3 py-2.5 text-body text-text-primary transition-colors focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
  fieldError ? "border-negative" : "border-border"   // ← convert to aria-[invalid=true]
}`}
```

⚠️ Note this site **already has the correct focus ring** (`focus-visible:ring-inset
focus-visible:ring-accent`, no alpha). Copy the focus ring FROM here TO `MetadataStep.tsx:334`;
copy the border mechanism FROM `MetadataStep.tsx:334` TO here. The rationale comment at
`AllocateDialog.tsx:343-353` (WCAG 1.4.11, ~1.3:1 at 20% alpha) is the reasoning to cite.

**Analog D — the behavioural precedent: client mirror → refuse inline → focus → never disable.**

`AllocateDialog.tsx:84-108` (the mirror, with its "server stays authoritative" docblock):

```ts
/**
 * Client mirror of the route's `parseAmount` (route.ts:115-128) — the SERVER
 * stays authoritative; this exists so a typo is caught at the field instead of
 * as a terminal envelope (this form is explicitly in scope for Phase 153's
 * inline-validation criterion).
 * … The bound is `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD` …
 */
function parseAmount(raw: string): ParsedAmount {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: ERROR_NON_POSITIVE };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: ERROR_NON_POSITIVE };
  if (n > MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD) return { ok: false, error: ERROR_ABOVE_CAP };
  return { ok: true, value: n };
}
```

`AllocateDialog.tsx:248-262` (the submit guard — **this is the shape `handleSubmit` must take**):

```ts
function handleSave() {
  const parsed = parseAmount(amount);
  if (!parsed.ok) {
    // Inline at the field, and the field takes focus — never a terminal
    // envelope for a field-level problem, and never a disabled CTA.
    setFieldError(parsed.error);
    inputRef.current?.focus();
    return;
  }
  setFieldError(null);
  void runWrite("POST", { strategy_id: strategyId, allocated_amount: parsed.value });
}
```

`AllocateDialog.tsx:370-375` — the never-disabled rule, already written down:

```tsx
{/* Disabled ONLY while a write is in flight (double-submit guard on
    a money write). Validation never disables it — an invalid amount
    surfaces inline at the field instead. */}
<Button type="button" onClick={handleSave} disabled={busy}>
```

**⛔ The FLAG-3 trap, at source.** `MetadataStep.tsx:210-233` is the code to REPLACE, and the
comment at `:225-229` is the stale justification that must be rewritten in the same edit:

```ts
const descriptionError = !description.trim()
  ? WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause     // ← UI-SPEC: use .title, not .cause
  : undefined;
const showDescriptionError =
  (descriptionBlurred || submitAttempted) && descriptionError ? descriptionError : undefined;

function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSubmitAttempted(true);
  // … The Submit button stays disabled until
  // both are present, so this is a defense-in-depth focus aid …   ← the stale premise
  if (!description.trim()) {           // ← .trim()-ONLY; categoryId unchecked
    descriptionRef.current?.focus();
    return;
  }
  onComplete({ … });
}
```

paired with `MetadataStep.tsx:486-493`, the gate the UI-SPEC deletes:

```tsx
{/* WR-03 — gate on the SAME .trim() predicate as the descriptionError
    derivation + the handleSubmit guard, so a whitespace-only
    description ("   ") does not enable a button that then silently
    no-ops in handleSubmit. The disabled-prop must not drift from the
    validation rule. */}
<Button type="submit" disabled={!description.trim() || !categoryId}>
```

The reveal-timing state already exists at `MetadataStep.tsx:153-155` and is the shape to widen
per-field:

```ts
const [descriptionBlurred, setDescriptionBlurred] = useState(false);
const [submitAttempted, setSubmitAttempted] = useState(false);
const descriptionRef = useRef<HTMLTextAreaElement>(null);
```

**Announcement channel** — `src/components/ui/LiveRegion.tsx:45-69`, whose contract forbids
authoring new copy in it (UI-SPEC FLAG-6):

```tsx
export interface LiveRegionProps {
  /** The sentence to announce. Pass the SAME sentence the surface already
   *  renders visually — this primitive is a second channel for existing copy,
   *  never a place to author new copy. */
  message: string | null;
  assertive?: boolean;
}
export function LiveRegion({ message, assertive = false }: LiveRegionProps) {
  return (
    <p role={assertive ? "alert" : "status"} aria-live={assertive ? "assertive" : "polite"}
       className="sr-only">{message}</p>
  );
}
```

---

### ⭐2. The derived-roster invariant test — `ROUTES` entry shape, verbatim

**Analog:** `src/lib/wizardErrors.invariant.test.ts` (read in full, 422 lines). Add a **third
entry**; do not build a second mechanism.

**The entry shape (`:103-127`) — copy this literally:**

```ts
interface RouteUnderTest {
  /** Human name used in failure messages. */
  readonly label: string;
  /** Path to the route handler, relative to the repo root. */
  readonly route: string;
  /** Path to the file holding the roster this route's codes must clear. */
  readonly rosterFile: string;
  /** The roster's declared name. */
  readonly rosterName: string;
}

const ROUTES: readonly RouteUnderTest[] = [
  {
    label: "create-with-key",
    route: join(REPO, "src/app/api/strategies/create-with-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
    rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
  },
  {
    label: "composite/add-key",
    route: join(REPO, "src/app/api/strategies/composite/add-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_ADD_KEY_CODES",
  },
];
```

`WIZARD_STEPS` is built at `:60-69` (`join(REPO,"src","app","(dashboard)","strategies","new","wizard","steps")`)
— the third entry's `rosterFile` is `join(WIZARD_STEPS, "SubmitStep.tsx")`.

**⚠️ THE EMITTER REGEX CONSTRAINS THE CODE YOU WRITE (`:100-101`):**

```ts
const EMITTER_RE =
  /NextResponse\.json\(\s*\{\s*code:\s*"([A-Z][A-Z0-9_]*)"\s*,\s*error:[^}]*\}\s*,\s*\{[^}]*status:\s*400/g;
```

It requires, in order: `NextResponse.json(` → `{` → **`code:` as the FIRST key** → a
`"UPPER_SNAKE"` string literal → `,` → **`error:`** → `}` → `,` → `{ … status: 400`.
All nine `finalize-wizard` arms are `{ error: "…" }` today. Writing `{ error: "…", code: "…" }`
makes the scanner **blind, not satisfied** (Pitfall 3). Either emit `{ code, error }` at all
nine sites, or relax the regex **and add a SELF-TEST proving the relaxed form matches**, per
the file's own discipline. The 400-only clause must also widen, because `finalize-wizard`
answers 400/403/404/502/503.

**The three literal oracles that must gain a third-route value (`:183`, `:191`, `:203`):**

```ts
const EXPECTED_SITES_PER_ROUTE = 12;          // ⚠️ PINNED AS LITERALS, NEVER AS `derived.length`
const EXPECTED_FORMAT_EMITTERS_PER_ROUTE = 1;
const DERIVED_FLOOR = 14;                     // anti-vacuity: ~60% of 24 measured sites
```

Their docblocks (`:169-203`) state the doctrine to preserve: *"A size compared against its own
derivation cannot fail: delete every guard in the route and both sides go to zero together."*

**The vacuity assertion to extend (`:230-250`):**

```ts
it("the derivation is NOT VACUOUS — population floor, with its predicate", () => {
  const total = derived.reduce((n, d) => n + d.codes.length, 0);
  expect(total, `Derived only ${total} rejection-emitting sites … PREDICATE: comment-stripped
    via stripCommentsPreserveLines(src,"ts"), then every NextResponse.json( call whose first
    argument is { code: "<LITERAL>", error: … } and whose second carries status: 400. A number
    this low means the SCANNER broke …`).toBeGreaterThanOrEqual(DERIVED_FLOOR);
  expect(union.size, "the WizardErrorCode union parsed as empty").toBeGreaterThan(30);
  for (const d of derived) {
    expect(d.roster.size, `${d.rosterName} parsed as empty`).toBeGreaterThan(10);
  }
});
```

**The SELF-TEST shape a widened predicate owes (`:333-343`) — the positive half:**

```ts
it("SELF-TEST — the scanner reads a code out of real emitter syntax", () => {
  const real = [
    "    return NextResponse.json(",
    '      { code: "REAL_CODE", error: "something is required" },',
    "      { status: 400, headers: NO_STORE_HEADERS },",
    "    );",
  ].join("\n");
  expect(deriveEmittedCodes(real)).toEqual(["REAL_CODE"]);
});
```

**⚠️ A5 verification (Finding 3):** `deriveRoster` (`:159-167`) uses
`source.indexOf(\`const ${name}\`)` then `indexOf("([")`. `KNOWN_FINALIZE_CODES` is declared
**inside a function body** at `SubmitStep.tsx:229-231`, indented:

```ts
const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(
  [
    "KEY_SCOPE_BROADENED",
    …
```

`indexOf` is not anchored, so it matches — but the `new Set<…>(\n  [` line break puts `([` on
different lines than the two existing rosters. **Run the test before trusting the derivation.**

**The comment-safe scanner to use (never a raw grep):**
`src/lib/source-scan.ts:400` → `export function stripCommentsPreserveLines(...)`, imported at
`wizardErrors.invariant.test.ts:6`. The 14-vs-12 lesson is in the file header at `:47-54`.

---

### ⭐3. Per-venue CAPABILITY (class), never `venue === "mt5"` (instance)

**There is NO existing `substitutable` / `serialized` / `scopeProbeSupported` record in the
tree** (grep-verified). Three precedents give the shape; the plan composes them.

**Analog A — the closed record over `SupportedExchange` (`src/lib/closed-sets.ts:43-56`).
This is THE class-not-instance shape: a new venue becomes a COMPILE error.**

```ts
/**
 * Lowercase code → display label. The `satisfies Record<SupportedExchange,…>`
 * makes a missing label a COMPILE error, so a new exchange code physically
 * cannot ship without a display label.
 */
export const EXCHANGE_DISPLAY = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
  deribit: "Deribit",
  sfox: "sFOX",
  mt5: "MT5",
} as const satisfies Record<SupportedExchange, string>;
export type ExchangeDisplay = (typeof EXCHANGE_DISPLAY)[SupportedExchange];
```

**Analog B — optional-boolean whose ABSENCE preserves today's behaviour
(`ConnectKeyStep.tsx:39-81`). This is the default-direction precedent MT5-13 cites:**

```ts
interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
  // Whether this exchange authenticates with an api_key + api_secret PAIR.
  // Absent → true (every ccxt exchange). sFOX authenticates with a SINGLE Bearer
  // token (no secret), so its card sets requiresSecret false: …
  requiresSecret?: boolean;
  …
  // Whether the passphrase slot holds a genuine SECRET that must render masked.
  // Absent → true, which is OKX's behaviour, so every existing and future venue
  // that omits the key renders byte-identically to today (D-03 …). MT5
  // sets false: the slot carries a broker SERVER NAME, not a credential, …
  passphraseSecret?: boolean;
}
```

⚠️ `ExchangeOption` is **client-local to `ConnectKeyStep.tsx`**. This phase needs the same
facts on the server (`finalize-wizard`'s probe gate) and in an isomorphic module
(`wizardErrors.ts`'s copy gating) ⇒ the record belongs in `src/lib/closed-sets.ts`, which is
already imported by client components (`MetadataStep.tsx:19` imports `isCryptoExchange`).

**Analog C — the subset-registry + predicate pair (`closed-sets.ts:280-301`), the shape a
`scopeProbeSupported(venue)` / `venueIsSubstitutable(venue)` helper should mirror, including
its null handling:**

```ts
export const CRYPTO_EXCHANGES = [
  "binance", "okx", "bybit", "deribit", "sfox",
] as const satisfies readonly SupportedExchange[];

export function isCryptoExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return (CRYPTO_EXCHANGES as readonly string[]).includes(exchange.toLowerCase());
}
```

⚠️ **Fail direction inverts for the probe gate.** `isCryptoExchange(null) === false` is the
safe answer there; `venueSupportsScopeProbe(null)` must return **`true`** (Pitfall 4 — an
unresolved venue must still be probed). The local precedent for "null ⇒ do the conservative
thing" is `finalize-wizard/route.ts:864-872`:

```ts
const skipAssetClassWrite = Boolean(apiKeyId) && apiKeyExchange === null;
if (skipAssetClassWrite) {
  console.warn(
    "[strategies/finalize-wizard] asset_class venue unresolved for a single-key " +
      "strategy — leaving the draft's venue-aware stamp intact (no √252 overwrite)",
  );
}
```

**Where the gate goes — `finalize-wizard/route.ts:839-856` then `:902-905`.** The venue is
already in scope 48 lines above the probe:

```ts
let apiKeyExchange: string | null = null;
if (apiKeyId) {
  const { data: keyVenueRow, error: keyVenueErr } = await assetClassAdmin
    .from("api_keys").select("exchange").eq("id", apiKeyId).single();
  …
  apiKeyExchange = typeof keyVenueRow?.exchange === "string" ? keyVenueRow.exchange : null;
}
…
// Probe runs BEFORE both legacy and unified paths so the
// scope-broadening defense covers either code path (Phase 19 /
// Open Question 1 — RETAINED at the thin-adapter layer).
if (apiKeyId) {
  const probe = await runScopeBroadeningProbe(apiKeyId);
  if (!probe.ok) return probe.response;
}
```

⚠️ **`runScopeBroadeningProbe` is a security control** (ASVS V4). The justification for a
per-venue skip must be written AT the skip site, in the voice of the existing MT5-13 comment
at `:594-599`.

**The composite arm** — `finalize-wizard/route.ts:1102` calls the same helper inside a loop
whose `select` fetches only `api_key_id` (`:978-993`). Widening it is a real edit; RESEARCH
Finding 2b flags that composites may be crypto-only, so the planner must decide, not assume.

**The flag-gated widening (MT5-14) — `closed-sets.ts:199-216`, the exact sFOX precedent:**

```ts
const UI_EXCHANGE_CODES_BASE = [
  "binance", "okx", "bybit", "deribit",
] as const satisfies readonly SupportedExchange[];

const UI_EXCHANGE_CODES_WITH_SFOX = [
  "binance", "okx", "bybit", "deribit", "sfox",
] as const satisfies readonly SupportedExchange[];

export const UI_EXCHANGE_CODES: readonly SupportedExchange[] = SFOX_UI_ENABLED
  ? UI_EXCHANGE_CODES_WITH_SFOX
  : UI_EXCHANGE_CODES_BASE;
```

and the derived display set (`:246-248`) whose `.length` is the public marketing count:

```ts
export const EXCHANGES: readonly ExchangeDisplay[] = UI_EXCHANGE_CODES.map(
  (code) => EXCHANGE_DISPLAY[code],
);
```

⚠️ Two independent flags (`SFOX_UI_ENABLED` + `MT5_UI_ENABLED`) ⇒ **four** literals under
Option A. `as const satisfies` must survive on each.

**The chip group + preselect (MT5-14) — `MetadataStep.tsx:446-453` and `:507-533`:**

```tsx
<InlineChipGroup
  label="Supported exchanges"
  items={[...EXCHANGES]}
  selected={supportedExchanges}
  onToggle={(item) => toggle(supportedExchanges, item, setSupportedExchanges)}
/>
```

```tsx
function InlineChipGroup({ label, items, selected, onToggle }: InlineChipGroupProps) {
  return (
    <div>
      <p className="text-caption font-medium text-text-primary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.includes(item);
          return (
            <button key={item} type="button" onClick={() => onToggle(item)}
              className={`rounded-md border px-3 py-1.5 text-caption font-medium transition-colors ${
                active ? "border-accent bg-accent/10 text-accent"
                       : "border-border text-text-muted hover:border-accent/50"}`}
              aria-pressed={active}>{item}</button>
          );
        })}
      </div>
    </div>
  );
}
```

The UI-SPEC's pinned-fact chip is this `active` branch's className rendered on a **`<span>`**
(not a `<button>`, not `disabled`). The preselect already works via `:110-113`:

```tsx
const [supportedExchanges, setSupportedExchanges] = useState<string[]>(
  initial?.supportedExchanges ??
    (detectedExchange ? [canonicalizeExchange(detectedExchange)] : []),
);
```

---

### ⭐4. Seam budgets, `branch` legs, and pin re-cutting

**`budgetKeyFor` — the many-to-one precedent (`src/lib/process-key-client.ts:111-136`):**

```ts
function budgetKeyFor(flowType: FlowType): SeamBudgetKey {
  switch (flowType) {
    // INLINE on the server (`_is_long_fetch` false) …
    case "teaser":
    case "csv":
      return "process-key-sync";
    // ENQUEUED (`_is_long_fetch` true) …
    case "onboard":
    case "resync":
      return "process-key-enqueue";
    default: {
      // Fail loud per Rule 12 … There is no correct silent answer here …
      const _exhaustive: never = flowType;
      throw new Error(
        `budgetKeyFor: unhandled flow_type — FlowType grew without a budget arm? got=${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
```

⚠️ **Invert the `default` arm for the venue variant.** `exchange` is a caller-supplied
`string` at `analytics-client.ts:669`, not a closed union. `default:` must **return
`"validate-key"`**, never throw, and must never interpolate the venue into a key (T-140-01,
`resilient-fetch.ts:102-108`). Say so in the docblock — the divergence from this analog is
deliberate.

**The one-literal call site (`src/lib/analytics-client.ts:669-687`):**

```ts
export async function validateKey(
  exchange: string,          // ← the venue is ALREADY here
  apiKey: string, apiSecret: string, passphrase: string | undefined, tenant: TenantIdentity,
) {
  const data = await analyticsRequest(
    "/api/validate-key",
    { exchange, api_key: trimCredential(apiKey), api_secret: trimCredential(apiSecret),
      passphrase: passphrase ?? null },
    { budgetKey: "validate-key", tenantId: tenant.userId },   // ← this literal
  );
  return parseResponse(ValidateKeyResponseSchema, data, "/api/validate-key");
}
```

**The `SEAM_BUDGETS` row to clone (`resilient-fetch.ts`, the `"validate-key"` entry). Note the
row carries `dependencies`, `retries` and a prose `notes` — all three are pinned elsewhere:**

```ts
"validate-key": {
  timeoutMs: 30_000,
  // `exchange.py`'s `_validate_mt5_key` raises MT5_GATEWAY_UNREACHABLE —
  // service_error(503, dependency="mt5-gateway") — reached by POST
  // /api/validate-key. …
  dependencies: ["mt5-gateway"],
  retries: SEAM_RETRIES,
  notes:
    "Live exchange auth probe — genuinely slow and venue-variable (Deribit, Binance, OKX all differ). Was the analytics-client 30s default.",
},
```

**`branch` legs — the ONLY labelled row today (`resilient-fetch.ts:795-817`), with the comment
style a new labelled row owes:**

```ts
// TWO EXCLUSIVE BRANCHES, and the row must not be read as their sum.
//
//   composite  (strategies.api_key_id IS NULL and >=1 strategy_keys member):
//              one cache-bypassing scope-broadening probe PER MEMBER, in
//              sequence, then `runLegacyFinalize`. …
//   single-key (strategies.api_key_id IS NOT NULL): ONE probe for that key,
//              then the unified arm's `/process-key` enqueue.
//
// A strategy cannot be both: a composite's api_key_id is NULL by
// construction and the hoist that fans out is scoped to exactly that.
"src/app/api/strategies/finalize-wizard/route.ts": {
  expectedMaxDurationS: 300,
  budgets: [
    { key: "keys-permissions", calls: 10, branch: "composite" },
    { key: "keys-permissions", calls: 1,  branch: "single-key" },
    { key: "process-key-enqueue", calls: 1, branch: "single-key" },
  ],
},
```

and the grouping function SC-4b uses (`seam-budgets.invariant.test.ts:566-584`):

```ts
function branchesOf<T extends { calls: number; branch?: string }>(budgets: readonly T[]) {
  const shared = budgets.filter((b) => b.branch === undefined);
  const labels = [...new Set(budgets.map((b) => b.branch).filter((b): b is string => typeof b === "string"))];
  if (labels.length === 0) return [{ label: "(single path)", legs: [...shared] }];
  return labels.map((label) => ({ label, legs: [...shared, ...budgets.filter((b) => b.branch === label)] }));
}
```

⚠️ **An unlabelled leg is charged to EVERY branch.** On `validate-and-encrypt`, `encrypt-key`
and `process-key-unified-dormant` stay unlabelled (shared); only the two `validate-key` legs
get `branch: "ccxt"` / `branch: "mt5"`.

**Pin-test assertion styles to mirror (`src/lib/seam-constants.pin.test.ts`):**

*Set equality, never length (`:262-272`):*

```ts
it("declares exactly the 13 pinned budget keys (SET equality, not length)", () => {
  // Sorted SET equality. A length assertion is green under a rename, which is
  // how a call site quietly loses the budget it was supposed to spend.
  expect(
    Object.keys(SEAM_BUDGETS).sort(),
    "The SeamBudgetKey set drifted from the pinned 13. A key was ADDED, REMOVED or " +
      "RENAMED. Adding one is fine — pin it here in the same commit, together with its " +
      "timeoutMs, so the new call site's budget is reviewable as a value rather than " +
      "inferred from a diff.",
  ).toEqual([...EXPECTED_BUDGET_KEYS].sort());
});
```

*Value pin driven by a hand-typed map, iterating the ORACLE not the table (`:274-292`):*

```ts
it.each(Object.entries(EXPECTED_TIMEOUT_MS))("%s.timeoutMs is the pinned literal", (key, expectedMs) => {
  const row = BUDGET_TABLE[key];
  expect(row, `The budget table has NO row for "${key}", which this oracle pins at ${expectedMs}ms. …`).toBeDefined();
  expect(row?.timeoutMs, `"${key}" now budgets ${row?.timeoutMs}ms; this oracle pins ${expectedMs}ms. …`).toBe(expectedMs);
});
```

The four maps to extend live at `:97-112` (`EXPECTED_TIMEOUT_MS`), `:119-133`
(`EXPECTED_BUDGET_KEYS`), `:157-171` (`EXPECTED_DEPENDENCIES`), `:185-199`
(`EXPECTED_RETRIES`). Each carries a docblock explaining WHY it is hand-typed — extend the
prose, do not just add a line.

*The three prose/literal restatements that stay GREEN while their premise breaks
(RESEARCH Pitfall 1 — Table C rows 8, 9, 10):*

`:558-565`:
```ts
it("uses exactly three magnitudes — 15s, 30s and 60s — spelled out", () => {
  expect(BUDGET_TABLE.bridge?.timeoutMs).toBe(15_000);
  expect(BUDGET_TABLE["validate-key"]?.timeoutMs).toBe(30_000);
  expect(BUDGET_TABLE["process-key-sync"]?.timeoutMs).toBe(60_000);
});
```

`:708-718` — the A-25 assertion, both sides hand-typed:
```ts
it("A-25: the tombstone outlives the longest seam budget", () => {
  // Both sides literal. The worst case the guard must span is a request
  // admitted the instant before a lock is armed and failing at the end of the
  // longest budget in the table — `process-key-sync` / the dormant handler, at
  // 60 000 ms. …
  expect(BREAKER_LOCK_TOMBSTONE_S * 1_000, "…").toBeGreaterThanOrEqual(60_000 - 30_000);
});
```

⭐ The RESEARCH-recommended NEW assertion (derivation-vs-hand-typed) belongs **beside** this
one, not instead of it — the existing test catches the constants moving; the new one catches
the coupling breaking.

**Retry-registry verdict (Table C row 11) — `src/lib/seam-retry-registry.ts:518-543`:**

```ts
export const RETRY_AUDIT_NO_ANALYTICS: Readonly<Partial<Record<SeamBudgetKey, string>>> =
  freezeVerdicts({
    "validate-key":
      "validateKey — runs a live exchange probe against caller credentials; " +
      "non-idempotent by construction, REQUIREMENTS Out of Scope. A retry re-probes the venue.",
    …
  } as const satisfies Partial<Record<SeamBudgetKey, string>>);
```

The new MT5 row needs a verdict string in this voice, and the key-set equality at
`seam-retry-registry.test.ts:188-191` must gain the key in the same commit.

**Route-budget deep-equality mirror — `seam-budgets.invariant.test.ts:386-469`.** Every leg
added to `SEAM_ROUTE_BUDGETS` must be mirrored byte-for-byte into `EXPECTED_ROUTE_BUDGETS`,
and the multi-branch roster at `:931-943` currently asserts exactly one row:

```ts
it("exercises the branch MAX on at least one row — a table of single-path rows would not", () => {
  // Without this, `branchesOf` could be deleted and replaced by the old sum
  // and only the numbers above would notice. Hand-typed 1: exactly one row
  // is multi-branch today.
  const multiBranch = Object.entries(SEAM_ROUTE_BUDGETS).filter(
    ([, entry]) => branchesOf(entry.budgets).length > 1,
  );
  expect(multiBranch.map(([path]) => path)).toEqual([FINALIZE_WIZARD_ROUTE]);
  expect(branchesOf(SEAM_ROUTE_BUDGETS[FINALIZE_WIZARD_ROUTE].budgets).length).toBe(2);
});
```

**⭐ The DELIBERATE pin re-cut (D-16) — `src/lib/closed-sets.mt5-flag.test.ts:55-71`.** These
two cases go red and must be re-cut in the same commit, with reasoning rewritten:

```ts
it("does NOT widen UI_EXCHANGE_CODES / EXCHANGES with mt5, even when the flag is ON", async () => {
  // MT5 is wizard-card-only this phase — the manager <Select> derives from
  // UI_EXCHANGE_CODES and must not silently gain an unlabeled MT5 option.
  vi.stubEnv("NEXT_PUBLIC_MT5_ENABLED", "true");
  const { MT5_UI_ENABLED, UI_EXCHANGE_CODES, EXCHANGES } = await loadClosedSets();
  expect(MT5_UI_ENABLED).toBe(true);
  expect((UI_EXCHANGE_CODES as readonly string[]).includes("mt5")).toBe(false);
  expect((EXCHANGES as readonly string[]).includes("MT5")).toBe(false);
});

it("keeps UI_EXCHANGE_CODES mt5-free when the flag is OFF too", async () => { … });
```

The module-reload harness to reuse for any new flag-ON case (`:24-31`):

```ts
async function loadClosedSets() {
  vi.resetModules();
  return import("./closed-sets");
}
afterEach(() => { vi.unstubAllEnvs(); });
```

The prose that must be rewritten alongside it is `closed-sets.ts:119-122`:

> `mt5 stays OUT of UI_EXCHANGE_CODES / EXCHANGES / FUNDING_EXCHANGES / CRYPTO_EXCHANGES
> regardless of this flag — the manager-surface <Select> must not silently widen …`

⚠️ **`CRYPTO_EXCHANGES` must stay mt5-free** — `closed-sets.ts:271-278` records that mt5 is
√252 forex/CFD, and widening it is a money-math regression, not a UI one.

---

## Pattern Assignments — remaining files

### `src/lib/wizardErrors.ts` (shared registry, transform)

**Analog: the last additive member, `ALLOCATION_NOT_ALLOCATABLE` (`:1564-1592`).** This is the
exact template for `SEAM_DEADLINE_EXCEEDED` — including the structural Retry suppression:

```ts
ALLOCATION_NOT_ALLOCATABLE: {
  title: "This strategy isn't marked as your own capital.",
  cause:
    "Money can only sit against a strategy you have marked as your own capital. …",
  fix: [
    "Open My Strategies and mark this strategy as your own capital, then allocate again.",
    "If it is marked as a trading team's capital under review, it cannot take an allocation until that changes.",
    "Close this dialog to see the strategy's current state — the list reloads with the mark as it stands now.",
  ],
  docsHref: "/security",
  // ⚠️ NO `clear_and_retry` and NO `try_another_key` — the two members of
  // `RECOVERABLE_ACTIONS`. Their absence derives `recoverable: false` and
  // suppresses the Retry control, and that BEHAVIOUR is half of what this
  // entry exists to change: the server refuses the identical request forever
  // until the mark changes, so a Retry CTA is a false affordance.
  actions: ["leave_and_return", "expand_log"],
},
```

The mechanism it relies on — `src/lib/envelope.ts:54-57, 88`:

```ts
const RECOVERABLE_ACTIONS: ReadonlySet<WizardErrorAction> = new Set([
  "clear_and_retry",
  "try_another_key",
]);
…
recoverable: copy.actions.some((a) => RECOVERABLE_ACTIONS.has(a)),
```

and `envelope.ts:86` — `debug_context: copy.fix` — a **verbatim pass-through**, which is why
`fix[]` gating (UI-SPEC Gates B and C) cannot live in `buildEnvelope`.

**The copy-entry type (`wizardErrors.ts:361-370`) and the action vocabulary (`:343-351`):**

```ts
export interface WizardErrorCopy {
  title: string;
  /** Single-sentence summary of WHY the error happened. */
  cause: string;
  /** Numbered fix steps. Each step is an imperative sentence. */
  fix: string[];
  /** Anchor URL on /security with a walkthrough + screenshots. */
  docsHref: string;
  /** Action IDs the UI should render as buttons/links. */
  actions: WizardErrorAction[];
}
export type WizardErrorAction =
  | "try_another_key" | "clear_and_retry" | "expand_log"
  | "resume_draft" | "start_fresh" | "request_call" | "leave_and_return";
```

**Context-field extension (`:1598-1630`) — the shape `charCount`/`surface`/`venue` copy,
including the TRAP-3 warning the UI-SPEC's budget interpolation must honour:**

```ts
export interface WizardErrorContext {
  trades?: number;
  days?: number;
  draftId?: string;
  computationError?: string | null;
  sizeMb?: string;
  issueCount?: number;
  /**
   * 140.3-09 / SEAMUX-06 — the advertised wait, in SECONDS …
   * OPTIONAL, and absence means "no wait was advertised" — never "zero" and
   * never "retry immediately". A surface MUST NOT name a duration it did not
   * receive: an error arm that invents a wait turns a vague failure into a
   * specific lie (TRAP-3). The renderer skips the line entirely when absent.
   */
  retryAfterSeconds?: number;
}
```

**Interpolation arms (`:1635-1701`) — the ONLY place a table entry may be modified.**
⚠️ Every existing arm is instance-shaped (`if (code === "X" && context?.y)`):

```ts
if (code === "CSV_FILE_TOO_LARGE" && context?.sizeMb !== undefined) {
  return { ...base, title: base.title.replace(SIZE_MB_PLACEHOLDER, context.sizeMb) };
}
if (code === "MULTI_KEY_WINDOWS_INVALID" && context?.issueCount !== undefined) {
  const n = context.issueCount;
  return { ...base, title: `Fix ${n} issue${n === 1 ? "" : "s"} before continuing` };
}
```

⛔ Adding three more `if (code === …)` arms for `KEY_PROBE_FAILED` / `KEY_RATE_LIMIT` /
`KEY_NETWORK_TIMEOUT` **re-ships the instance-not-class defect**. Gate C needs ONE filter over
`fix[]` driven by a per-entry requirement, not three conditionals. The `SIZE_MB_PLACEHOLDER`
const-then-replace note at `:352-359` is the in-file precedent for adding an interpolation
slot.

**Alias table (`:2157-2192`) — where `CIRCUIT_OPEN` is legitimately excused, and the model for
any exemption the derived roster needs:**

```ts
const SEAM_CODE_TO_WIZARD_CODE: ReadonlyMap<string, WizardErrorCode> = new Map<string, WizardErrorCode>([
  ["VALIDATION_FAILED", "VALIDATION_FAILED"],
  ["RATE_LIMITED", "RATE_LIMITED"],
  ["CIRCUIT_OPEN", "SERVICE_UNAVAILABLE_RETRY"],
  ["UPSTREAM_TIMEOUT", "SERVICE_UNREACHABLE"],
  ["UPSTREAM_NETWORK_ERROR", "SERVICE_UNREACHABLE"],
  // … Listed EXPLICITLY rather than admitted by an identity rule — writing the
  // mapping as `code as WizardErrorCode` would silently admit `SEAM_DEGRADED`,
  // `MT5_GATEWAY_UNREACHABLE` and every venue code too …
  ["SEAM_MISCONFIGURED", "SEAM_MISCONFIGURED"],
  ["CSV_RATE_LIMIT", "RATE_LIMITED"],
]);
```

The two live-UNKNOWN residuals RESEARCH Finding 4 surfaces are recorded at `:2149-2151`.

**Table-size pin (`src/lib/wizardErrors.test.ts:1437` AND `:1649`, both currently `64`):**

```ts
/** … Deliberately NOT `Object.keys(WIZARD_ERROR_COPY).length`: reading the
 *  subject to build the expectation is how a guard stops being able to fail.
 *  Bumping the LITERAL when the table legitimately grows is the intended
 *  maintenance cost; replacing it with a derived value removes the guard. */
const EXPECTED_TABLE_SIZE = 64;
```

⚠️ The docblock at `:1415-1436` **re-runs the reasoning over the new entries** each time the
number moves. Do the same, per new member — do not just bump the integer.

---

### `src/app/api/strategies/finalize-wizard/route.ts` (route handler)

**The nine code-less arms — arm 1 (`:342-350`) as the uniform shape to change:**

```ts
if (!body || typeof body !== "object") {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    ),
  };
}
```

**The already-correct emitter shape in the SAME file (`:614-618`) — `code` present, but note
the key ORDER is `error, code`, which the scanner regex would NOT match:**

```ts
return {
  ok: false,
  response: NextResponse.json(
    { error: "Could not verify key scopes", code: "KEY_NETWORK_TIMEOUT" },
    { status: 502, headers: NO_STORE_HEADERS },
  ),
};
```

⇒ the canonical shape to write at all nine sites (matching `EMITTER_RE` and the two other
wizard routes) is **`{ code: "X", error: "…" }`**.

**⚠️ Arm 9's comment ARGUES FOR the defect (`:486-495`) and must be rewritten in the same edit:**

```ts
// A garbage value is a hard 400, NOT a silent coercion to the safe value.
// Coercing would let a broken or hostile client believe it had set a mark
// it did not set. Deliberately mirrors the entry_context arm above: a bare
// `error` string with NO `code`, because every code the wizard renders must
// exist in its error roster — an unknown one renders the UNKNOWN card, which
// tells the user nothing (Pitfall 7). …
```

WIZFORM-02 removes the premise (the roster becomes derived). Leaving this comment invites the
next reader to restore the bug.

**The description arm to re-point at a minted `MIN_DESCRIPTION_CHARS` (`:388-397`):**

```ts
if (
  typeof description !== "string" ||
  description.length < 10 ||                                  // ← naked literal
  description.length > MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS   // ← single-sourced
) {
```

The cap record to extend — `src/lib/closed-sets.ts:529-546`:

```ts
export const MAGNITUDE_CAPS = {
  /** strategy_name + display chip names. */
  MAX_NAME_CHARS: 80,
  …
  /** strategy description free text. */
  MAX_DESCRIPTION_CHARS: 5000,
  …
} as const;
```

pinned at `closed-sets.test.ts:323` — a new `MIN_DESCRIPTION_CHARS` needs a pin line there in
the same commit.

**Error-scrubbing at every new catch (`:589-592`), the ONE scrubber:**

```ts
console.error(
  `[strategies/finalize-wizard] live permissions probe failed: ${scrubSeamError(probeErr)}`,
);
```

---

### `SubmitStep.tsx` (roster + field-level code routing)

**Analog: the roster additions with in-commit justification (`SubmitStep.tsx:229-…`) —
note that EVERY member carries a comment saying it was admitted in the same commit the route
started emitting it:**

```ts
const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(
  [
    "KEY_SCOPE_BROADENED",
    "KEY_NETWORK_TIMEOUT",
    // MT5-13 — the permanent half of the probe-failed split, admitted
    // HERE IN THE SAME COMMIT the route started emitting it. Omit this
    // line and the new code fails the membership check below, falls
    // through to UNKNOWN — whose copy IS recoverable — and the fix ships
    // invisible: the user gets a Retry button again …
    "KEY_SCOPE_CHECK_UNAVAILABLE",
    …
  ]);
```

and `ConnectKeyStep.tsx:298-315`, the stopgap block that names this phase as the owner of the
class fix:

```ts
// ⚠️ STOPGAP (hotfix 2026-08-06, incident 2026-08-05): … This is exactly the
// hand-typed allow-list edit the docblock above warns about — the CLASS fix (a
// roster DERIVED from the route contract instead of hand-maintained) stays with
// Phase 153 / WIZFORM-02; do not grow this list further, derive it there.
"SERVICE_UNREACHABLE",
"KEY_MISSING_READ_SCOPE",
"KEY_PERMISSION_DENIED",
```

**⛔ No analog exists for "field-level code → field id" routing** — see §No Analog Found.

---

### `ConnectKeyStep.tsx` / `MultiKeyConnectStep.tsx` (long-wait card + surface context)

**Analog A — the house long-wait card (`SyncPreviewStep.tsx:2309-2390`), the anatomy the
UI-SPEC lifts verbatim:**

```tsx
<div className="mt-6 rounded-md border border-border bg-page px-4 py-3">
  <div className="flex items-center gap-3">
    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
    <p className="text-body font-medium text-text-primary">{ /* status label */ }</p>
    <span className="ml-auto font-metric text-caption tabular-nums text-text-muted">
      {elapsedSeconds}s
    </span>
  </div>
  …
  {showSlowHint && !showWarn && (
    <p className="mt-2 text-caption text-text-muted">…</p>
  )}
  {showWarn && !showRetry && (
    <p className="mt-2 text-caption text-amber-600">…</p>   {/* ⛔ :2378 raw class — DO NOT COPY */}
  )}
  {showRetry && !showInterruptedBanner && (
    <p className="text-caption text-negative">…</p>
  )}
</div>
```

with the threshold ladder derived at `:2275-2278`:

```ts
const elapsedSeconds = Math.floor(elapsedMs / 1000);
const showSlowHint = elapsedMs >= SLOW_HINT_MS;
const showWarn = elapsedMs >= WARN_THRESHOLD_MS;
const showRetry = elapsedMs >= RETRY_THRESHOLD_MS;
```

⚠️ Three deltas the UI-SPEC mandates against this analog: (a) the dot must be `aria-hidden`
and reduced-motion-suppressed; (b) the elapsed span must be `aria-hidden`; (c) thresholds must
be **fractions of the configured venue budget**, not module constants — and `text-amber-600`
becomes `text-warning`.

**Analog B — the abort/cancel precedent (`BridgeDrawer.tsx:113, 122-124, 195-208, 239`),
the only in-flight-cancel pattern in the dashboard:**

```tsx
const abortRef = useRef<AbortController | null>(null);
…
// F9 H-0084 — own an AbortController so a drawer dismiss mid-flight cancels
// the POST. Stored in abortRef for the close paths (Esc/backdrop/×).
const controller = new AbortController();
abortRef.current = controller;
…
// Aborted = the user dismissed mid-flight; the drawer is already closing
// and its state has been reset. Nothing to surface.
if (controller.signal.aborted || (!result.ok && result.aborted)) return;
…
if (abortRef.current === controller) abortRef.current = null;
```

⚠️ The UI-SPEC's `Stop waiting` differs: it must NOT unmount the form, must keep every field
value, and must render a **neutral** line (not an `ErrorEnvelope`).

**Analog C — the `buildEnvelope` call site that gains `surface` (`ConnectKeyStep.tsx:608-614`):**

```tsx
const errorEnvelope = errorCode
  ? buildEnvelope(errorCode, correlationId, {
      // 140.3-10's rule, inherited: `?? undefined` because ABSENCE IS NOT
      // ZERO. `null` would be carried into the envelope slot and a `0` there
      // is a wait we were never told about.
      retryAfterSeconds: retryAfterSeconds ?? undefined,
    })
  : null;
```

Sibling call sites that must pass their own `surface`: `MultiKeyConnectStep.tsx:995, 1007,
1320`, `SubmitStep.tsx:414`, `SyncPreviewStep.tsx:1641`, `CsvUploadStep.tsx:476`,
`CsvSubmitStep.tsx:386`, `AllocateDialog.tsx:147, 157, 159, 220`.

---

### `analytics-service/routers/exchange.py` (Python probe deadline)

**The three stages to collapse — `exchange.py:56-62`, `:326-330`, `:378-381`, `:448-465`:**

```python
# The event-loop bound for the SYNCHRONOUS Mt5Client probe (login+read+order_check
# run off the loop via asyncio.to_thread). A margin above the client's own rpyc
# sync_request_timeout so a hung terminal fails its round-trip first and this outer
# wait_for is the last-resort ceiling — a hung RPyC pipe must NEVER wedge the
# event loop / healthz (the v1.11 WEDGE-01 failure class, T-135-12).
_MT5_PROBE_TIMEOUT_S = MT5_REQUEST_TIMEOUT_S + 5.0
```

```python
client = await asyncio.wait_for(
    asyncio.to_thread(lambda: Mt5Client(host, port)), timeout=_MT5_PROBE_TIMEOUT_S,
)                                                                        # :326-329 connect
…
info, probe = await asyncio.wait_for(
    asyncio.to_thread(_probe), timeout=_MT5_PROBE_TIMEOUT_S
)                                                                        # :379-381 probe
…
finally:
    # RED-TEAM: bounded, off-loop close. client.close() is blocking RPyC (a hung
    # Wine shutdown on the loop would wedge FastAPI); mirror aclose_exchange's
    # mt5 arm. … Runs on EVERY path (success, master-reject, auth/
    # server fail, mismatch, transient/timeout) so the session never leaks.
    try:
        await asyncio.wait_for(
            asyncio.to_thread(client.close), timeout=_MT5_PROBE_TIMEOUT_S
        )                                                                # :455-457 close
```

**Analog for a NEW env-overridable, derived-from-base deadline —
`analytics-service/services/mt5_concurrency.py:42-70`:**

```python
# … derived
# from MT5_REQUEST_TIMEOUT_S (+10s margin) so a retuned rpyc bound carries through
# — mirrors ingestion/mt5.py:_MT5_PROBE_TIMEOUT_S so the derive and probe paths
# … stay in step.
_MT5_DERIVE_READ_TIMEOUT_S: Final[float] = float(
    os.getenv("MT5_DERIVE_READ_TIMEOUT_S", str(_MT5_REQUEST_TIMEOUT_S + 10.0))
)
…
_MT5_RESTART_TIMEOUT_S: Final[float] = float(os.getenv("MT5_RESTART_TIMEOUT_S", "10.0"))
```

**Analog for the small independent close bound the `finally` should keep —
`analytics-service/services/exchange.py:869`:**

```python
_ACLOSE_TIMEOUT_S = float(os.getenv("EXCHANGE_CLOSE_TIMEOUT_S", "10"))
```

**⭐ Analog for the nested-ordering GUARD (D-02) — `analytics-service/services/mt5_client.py:206-220`.
This repo already fails LOUD at construction when the chain inverts; a new outer deadline
should extend the same chain, not replace it:**

```python
# Enforce the load-bearing dual-timeout ORDERING (Pitfall 3 / T-134-04)
# where the two effective values finally meet: the MT5 login IPC timeout
# (ms) MUST stay strictly BELOW the rpyc sync_request_timeout (s -> ms) so
# MT5 fails its own pipe first and rpyc surfaces a clean error instead of a
# raw mid-handshake abort. A too-small request_timeout_s (ctor arg or a low
# MT5_REQUEST_TIMEOUT_S env) silently inverts it and reopens the v1.11
# WEDGE-01 wedge class, so fail loud at construction rather than at a hung
# live login.
if MT5_LOGIN_TIMEOUT_MS >= request_timeout_s * 1000:
    raise ValueError(
        "MT5 login IPC timeout must be strictly below the rpyc request "
        f"timeout ({MT5_LOGIN_TIMEOUT_MS}ms >= "
        f"{request_timeout_s * 1000:.0f}ms) — this inversion reopens the "
        "v1.11 WEDGE-01 wedge class."
    )
```

with its base constants at `mt5_client.py:82, 88`:

```python
MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))
MT5_LOGIN_TIMEOUT_MS  = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))
```

**Python test analogs:**

- ordering assertion — `analytics-service/tests/test_mt5_client_contract.py:304-305` and
  `:367-382`: `assert MT5_LOGIN_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000`
- firing a deadline in a unit test without a real wait —
  `analytics-service/tests/test_exchange.py:127-147`:
  `monkeypatch.setattr(exchange_mod, "_ACLOSE_TIMEOUT_S", 0.05)`, and
  `test_ingestion_mt5.py:352`: `monkeypatch.setattr("services.ingestion.mt5._MT5_PROBE_TIMEOUT_S", 0.1)`
- the file to extend: `analytics-service/tests/test_mt5_validate.py` (plus
  `test_mt5_validate_parity.py`)
- ⚠️ pytest **must run from `analytics-service/`** or VCR cassettes miss and live broker calls
  fire.

---

### Test-file analogs (RTL)

`src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx:1-55` — the harness
shape to extend (jsdom pragma, supabase `from().select().order()` mock, telemetry mock,
`baseProps`, importing copy from `@/lib/wizardErrors` rather than typing strings):

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetadataStep, type MetadataDraft } from "./MetadataStep";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({ order: (_col: string) => Promise.resolve(orderResult) }),
    }),
  }),
}));

const baseProps = {
  strategyId: "strat-1", wizardSessionId: "session-1", initial: null,
  detectedMarkets: [] as string[], detectedExchange: null as string | null,
  onComplete: vi.fn(), onBack: vi.fn(),
};
```

⛔ `AllocateDialog.test.tsx:555` exempts `ui/Button.tsx:35` and `ui/Modal.tsx:33` **by
identity** and asserts they still carry `ring-accent/50`. Do not "fix" those two primitives —
it reds an unrelated suite (UI-SPEC, confirmed by the checker).

---

## Shared Patterns

### A. The red border derives from ARIA, never from JS
**Source:** `src/components/ui/Field.tsx:72` + `MetadataStep.tsx:334`
**Apply to:** every field this phase touches — `MetadataStep` (description, category, AUM,
capacity, codename), `AllocateDialog` (amount).
**Statement:** the control class ends in `aria-[invalid=true]:border-negative`; the ONLY writer
of `aria-invalid` is `Field`'s `error` prop. A JS ternary on the border class is the FLAG-1
defect.

### B. Structural Retry suppression is an ABSENCE, never a prop
**Source:** `src/lib/envelope.ts:54-57, 88` + `wizardErrors.ts:1586-1591`
**Apply to:** `SEAM_DEADLINE_EXCEEDED` and every new non-recoverable member.
**Statement:** give the entry no member of `RECOVERABLE_ACTIONS` (`clear_and_retry`,
`try_another_key`). Four codes already rely on this. ⛔ Do not add a `hideRetry` prop.
Belt-and-braces at the call site is also precedented (`AllocateDialog.tsx:286-298`: pass
`onRetry` as `undefined` when `!envelope.recoverable`).

### C. A hand-typed pin is a MANUAL checklist item when it restates a table fact
**Source:** `seam-constants.pin.test.ts:558-565` and `:708-718`; the doctrine at
`wizardErrors.invariant.test.ts:169-182`
**Apply to:** every literal this phase moves.
**Statement:** never replace a pin with a derivation of its own subject; ADD a derived
assertion beside it when the coupling (not the value) is what can break.

### D. A new code is admitted to its roster IN THE SAME COMMIT the route starts emitting it
**Source:** `SubmitStep.tsx` `KNOWN_FINALIZE_CODES` member comments; `ConnectKeyStep.tsx:269-274`
**Apply to:** all nine `finalize-wizard` arms + `SEAM_DEADLINE_EXCEEDED`.
**Statement:** an unlisted code renders `UNKNOWN` **silently** — no test reddens on the route
side. After WIZFORM-02 the derived assertion makes it loud; until it lands, the comment
discipline is the guard.

### E. Every error path scrubs through the ONE shared leaf
**Source:** `finalize-wizard/route.ts:589-592` (`scrubSeamError`), `route.ts:283-305` records
why a route-local scrubber was removed.
**Apply to:** every new catch in the route and in `exchange.py`.

### F. Flag-gated widening keeps `as const satisfies` on EACH literal
**Source:** `closed-sets.ts:199-216`
**Apply to:** any MT5 set widening (Option A or B).
**Statement:** the exported value is typed `readonly SupportedExchange[]` and SELECTS between
two `as const satisfies` literals at module load — so the closed-set guarantee survives the
flag.

### G. Announcements re-state visible copy; never author new copy in `LiveRegion`
**Source:** `LiveRegion.tsx:45-51`
**Apply to:** the wait-ladder announcements and the submit-with-errors summary (UI-SPEC FLAG-6
— either render the sentence visibly or record the deviation).

---

## No Analog Found

| File / mechanism | Role | Data Flow | Reason |
|---|---|---|---|
| **field-level 400 `code` → field id map** (UI-SPEC Surface 2, in `MetadataStep.tsx` / `SubmitStep.tsx`) | component | request-response | Grep for `fieldFor` / `FIELD_BY_CODE` / `codeToField` returns **nothing**. Every existing server-code consumer maps a code → a whole-page `ErrorEnvelope` (`SubmitStep.tsx:414`, `ConnectKeyStep.tsx:608`). The closest structural neighbour is the `ReadonlySet<WizardErrorCode>` roster idiom (`SubmitStep.tsx:229`) — a `ReadonlyMap<WizardErrorCode, FieldId>` in the same file, with the same "admitted in the same commit" comment discipline and a totality assertion, is the natural extension. **Planner must design it; there is no precedent to copy.** |
| **venue-capability record** (`scopeProbeSupported` / `substitutable` / `serialized`) | config | transform | No `substitutable` or `serialized` exists anywhere in `src/`. Compose from the three precedents in ⭐3 (`EXCHANGE_DISPLAY`'s `as const satisfies Record<SupportedExchange,…>`, `ExchangeOption`'s absent→default optional booleans, `isCryptoExchange`'s predicate + null handling). |
| **budget-derived escalation thresholds + `Stop waiting`** | component | event-driven | `SyncPreviewStep.tsx:2275-2390` gives the card and the ladder but its thresholds are module constants and it has no cancel. `BridgeDrawer.tsx:195-239` gives the abort but no ladder. The composition is new. |
| **one end-to-end `wait_for` spanning connect+probe while `finally`-close keeps its own bound** | service (Python) | request-response | No existing site wraps two stages in a single outer deadline. `mt5_concurrency.py:73-93` (`_mt5_bounded_restart`) is the nearest bounded-composite shape; `services/exchange.py:869-900` is the bounded-close shape. ⚠️ Pitfall 6: the `finally` must stay OUTSIDE the new deadline or the RPyC session leaks. |

---

## Metadata

**Analog search scope:** `src/lib/`, `src/components/ui/`, `src/components/strategy/`,
`src/app/(dashboard)/strategies/new/wizard/steps/`, `src/app/(dashboard)/allocations/components/`,
`src/app/api/strategies/`, `analytics-service/routers/`, `analytics-service/services/`,
`analytics-service/tests/`
**Files read at source:** 24
**Greps run:** `aria-[invalid=true]`, `satisfies Record<SupportedExchange`,
`substitutable|serialized`, `AbortController`, `buildEnvelope(`, `fieldFor|FIELD_BY_CODE|codeToField`,
`_ACLOSE_TIMEOUT_S`, `MT5_LOGIN_TIMEOUT_MS`
**Pattern extraction date:** 2026-08-08
