# Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 21 (8 new, 13 modified)
**Analogs found:** 20 / 21 (1 composite-of-two-donors, 1 doc file n/a)

> ⛔ **Read the "Twin Register" section before any plan is written.** This phase's dominant
> failure mode is the instance-fix masquerading as a class-fix — RESEARCH.md's central
> STALE-01b finding is literally "a guard exists on the composite arm and is missing on its
> single-key twin". Every file below carries an explicit **TWIN** row. A plan that edits one
> arm of a named twin and does not state what it did with the other arm is incomplete.

> ⚠️ **AGENTS.md gate, unresolved at mapping time (RESEARCH Assumptions Log A1).** The new
> route handler's conventions (cache defaults, `dynamic`, `runtime`) must be checked against
> `node_modules/next/dist/docs/` before the plan locks them. The excerpts below are transcribed
> from **routes that ship in this repo today**, which is the correct grounding — but they do not
> discharge the docs read.

---

## File Classification

### New files

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/wizard/draft-query.ts` | utility (shared query) | CRUD read | `src/lib/sync-progress.ts` (shared contract module imported by route + component); body verbatim from `wizard/page.tsx:79-89` | role-match |
| `src/app/api/strategies/wizard-draft/route.ts` | route (GET) | request-response | `src/app/api/strategies/composite/members/route.ts` | **exact** |
| `src/hooks/useStrategySyncPoller.test.ts` | test (hook) | event-driven / polling | **composite of two**: `src/components/notes/useNoteAutoSave.test.ts` (renderHook + fake timers) + `SyncPreviewStep.readfailure.runtime.test.tsx:146-199` (supabase chainable double) | composite |
| `…/steps/SyncPreviewStep.stale.runtime.test.tsx` | test (component runtime) | polling | `…/steps/SyncPreviewStep.readfailure.runtime.test.tsx` | **exact** |
| `…/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` | test (component runtime) | polling | same file, plus its "SECOND member" twin-symmetry case | **exact** |
| `supabase/migrations/<ts>_api_keys_venue_account_id.sql` | migration | DDL | `supabase/migrations/20260811210000_api_keys_attested_venue.sql` | **exact** (same table, same RPC pair, most recent) |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql` | test (SQL gate) | DDL assertion | `supabase/tests/test_wizard_session_idempotency.sql` | **exact** |
| `src/__tests__/…-draft-query-single-source.test.ts` | test (contract, source scan) | build-time | `src/__tests__/strategies-published-sole-writer-guard.test.ts` | **exact** |

### Modified files

| Modified file | Role | Data Flow | Analog / donor | Match |
|---------------|------|-----------|----------------|-------|
| `…/allocations/components/ContributionWizardOverlay.tsx` | component (client portal) | request-response | own file `:45-78` (hooks-above-null-gate, close-reset) | self |
| `…/strategies/new/wizard/WizardClient.tsx` `:198-202` | component | — | own `:194-266` initializer block | self |
| `…/strategies/new/wizard/page.tsx` `:79-91` | server component | CRUD read | becomes the helper's first caller | self |
| `…/wizard/steps/SyncPreviewStep.tsx` (3 sites) | component | polling | own composite arm `:1092-1103` is the guard donor | self |
| `src/hooks/useStrategySyncPoller.ts` `:226-231` | hook | polling | own **interval arm** `:149-159` (see TWIN-3) | self |
| `src/app/api/strategies/[id]/sync-progress/route.ts` `:184-196` | route | request-response | own file | self |
| `src/app/api/strategies/create-with-key/route.ts` `:262-290`, `:428-440` | route | CRUD write | own fence + `composite/add-key/route.ts:404` | self |
| `…/components/ContributionWizardOverlay.test.tsx` | test | — | ⚠️ see WARNING under Pattern 1 | self |
| `…/wizard/WizardClient.test.tsx` | test | — | existing | self |
| `src/app/api/strategies/create-with-key/route.test.ts` | test | — | existing (1784 lines — extend, do not fork) | self |
| `src/app/api/strategies/[id]/sync-progress/route.test.ts` | test | — | existing (581 lines — the composite byte-identity pin lives here) | self |
| `e2e/api-key-flow.spec.ts` (or new resume spec) | e2e | browser | `e2e/composite-onboarding.spec.ts:405-500` | **exact** |
| `.planning/REQUIREMENTS.md` | doc | — | n/a | n/a |

---

## Twin Register

⭐ **The load-bearing section.** Each row names a code path that has a sibling arm. Nine twins;
three of them are NOT named in RESEARCH.md and were found during this mapping pass.

| # | Twin | Arm A (has it) | Arm B (missing it) | In RESEARCH? |
|---|------|----------------|--------------------|--------------|
| TWIN-1 | Empty-series repoll guard (STALE-01b) | `SyncPreviewStep.tsx:1101-1103` composite | `SyncPreviewStep.tsx:1398-1447` single-key | ✅ yes |
| TWIN-2 | Stall-backstop render gate | `:2290-2291` `isComposite && (…)` | single-key never renders `wizard-sync-interrupted` | ✅ yes |
| TWIN-3 | **Absent-row handling INSIDE the poller** | `useStrategySyncPoller.ts:151-159` interval arm — `if (!data) { … return; }`, **never calls `onStatus`** | `:228-231` ladder arm — `?? "pending"` fabricates a domain value | ⛔ **NEW — not in RESEARCH.md** |
| TWIN-4 | "Absence is not a value" rule, stated vs applied | `SyncPreviewStep.tsx:596-618` (binds `error`), `:1404-1413` (throws on null count) | `useStrategySyncPoller.ts:228` | ✅ yes (as Pattern 1) |
| TWIN-5 | In-flight datum gate — **three** gates on one axis | route filter `sync-progress/route.ts:185`; client fetch gate `SyncPreviewStep.tsx:910` (`if (isComposite)`); render gate `:2290` | single-key blocked at all three | ⚠️ partially (RESEARCH names 2 of 3; `:910` is the third) |
| TWIN-6 | "Draft not consulted before step is chosen" | — | `ContributionWizardOverlay.tsx:146` (`initialDraft={null}`) **and** `WizardClient.tsx:199` (CSV short-circuit) | ✅ yes |
| TWIN-7 | Wizard `api_keys` INSERT RPCs | `create_wizard_strategy` | `add_wizard_composite_key` — migration `20260811210000` edited **both** for `attested_venue` | ⛔ **NEW — RESEARCH names only `create_wizard_strategy`** |
| TWIN-8 | 23505 → user-facing code | `create-with-key/route.ts:429` | `composite/add-key/route.ts:404` — the same undifferentiated 23505 arm | ⛔ **NEW** |
| TWIN-9 | Idempotency fence, app layer vs DB layer | app: `create-with-key/route.ts:262-290`; DB: advisory lock + select-existing inside the RPC | CONTEXT.md requires "one fence, two keys" — **both layers** must learn the second key or they drift | ✅ yes (as a decision) |

**Consumer-ripple correction (found this pass, contradicts RESEARCH.md's list):** the real
`ContributionWizardOverlay` renderers are `MyStrategiesEmptyState.tsx:47`,
`MyStrategiesSection.tsx:129`, `AllocationsTabs.tsx:1035`, `ScenarioComposer.tsx:166`.
`StrategyBrowseDrawer.tsx` mentions the overlay **only in comments** (`:124`, `:559`, `:775`) and
does not render it; RESEARCH.md lists it as a consumer and **omits `ScenarioComposer.tsx`**, which
is a real one. Mock setup lives in `ScenarioComposer.test.tsx:125-126` and `:655`.

---

## Pattern Assignments

### 1. `ContributionWizardOverlay.tsx` (component, request-response) — WIZCONT-01

**Analog:** its own file. No sibling overlay fetches on open, so the pattern to copy is the file's
own hooks-above-null-gate + close-reset discipline.

**Hooks-above-the-null-gate + close-reset** (`:52-80`) — the fetch effect MUST live here, above
`if (!isOpen) return null`:
```tsx
  // Esc-to-dismiss + reset-on-close. Hooks MUST run unconditionally, so this
  // sits ABOVE the `!isOpen` early return (StrategyBrowseDrawer discipline).
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource("api");
      return;
    }
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;
```
⭐ The `setSource("api")` close-reset is the precedent for resetting a fetched-draft state on
close. A draft fetched on open must be cleared on close, or a reopen resumes a deleted draft.

**The defect site** (`:135-149`) — the comment must be replaced, not just the value:
```tsx
        <div className="px-6 py-5">
          {/*
            initialDraft={null} = a fresh wizard on every open. The overlay does
            not resume server drafts in Phase 110; …
          */}
          <WizardClient
            key={source}
            entryContext="contribution"
            sourceOverride={source}
            initialDraft={null}
            onSuccess={(id) => onSuccess?.(id)}
            onClose={onClose}
          />
        </div>
```

**Pitfall W-1 resolution — the two conformant shapes.** `WizardClient`'s initializers read
`initialDraft` once at mount (`:198`, `:204`, `:207`, `:228`), so a late prop does nothing.
Either (a) defer the `WizardClient` mount until the read settles (`undefined`=loading /
`null`=none / row=draft), or (b) extend the existing key: `key={`${source}:${draft?.id ?? "new"}`}`.
The `key={source}` precedent is documented at `:45-47` and mirrors `wizard/page.tsx:120-121`.

⚠️ **WARNING on `ContributionWizardOverlay.test.tsx`.** The existing file mocks `WizardClient`
wholesale (`:21-59`) and asserts the prop by rendering it into a testid:
```tsx
          <span data-testid="wizard-initial-draft">
            {props.initialDraft === null ? "null" : "present"}
          </span>
```
That assertion shape is **exactly RESEARCH Pitfall 2's warning sign**. The resume case MUST render
the REAL `WizardClient` and assert `wizard-resume` / `wizard-start-fresh` / the `sync_preview` step
render. Keep the mocked cases for the portal/Esc/keying contract; add the resume case with the real
component (or a second file).

---

### 2. `src/app/api/strategies/wizard-draft/route.ts` (route handler, request-response) — NEW

**Analog:** `src/app/api/strategies/composite/members/route.ts` — a GET, `withAuth`, user-scoped
`createClient()`, field-by-field projection, `NO_STORE_HEADERS` on **every** response.

**Imports + wrapper** (`composite/members/route.ts:1-7`, `:41`):
```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { isUuid } from "@/lib/utils";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { getCorrelationId } from "@/lib/correlation-id";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const GET = withAuth(async (req: NextRequest, user: User) => {
```

**Error handling + never-forward-the-raw-message** (`:105-115`, `:146-158`):
```ts
    if (error) {
      const correlationId = await getCorrelationId();
      console.error(
        `[strategies/composite/members] member read error [correlation_id=${correlationId}]:`,
        error.message,
      );
      return NextResponse.json({ code: "UNKNOWN" }, { status: 500, headers: NO_STORE_HEADERS });
    }
  } catch (err) {
    // Never forward the raw message — it can carry internal detail (H-0305).
    const message = err instanceof Error ? err.message : "Member read failed";
    …
  }
```

**No-rate-limiter precedent** (`:36-39`) — directly applicable, the draft read fires on overlay open:
```
 * NO rate limiter: userActionLimiter buckets are for mutations. This read is
 * idempotent, RLS-bounded, and fires on every wizard step re-mount — rate-
 * limiting it would break legitimate rehydration.
```
If the planner prefers a limiter anyway, the **B15 ordering** donor is
`sync-progress/route.ts:104-131` (validate the id → `checkLimit` → handler), including
`"Retry-After": String(rl.retryAfter)` and `runtime = "nodejs"` at `:63`.

**Security constraints carried from RESEARCH §Security Domain:** the route takes **no id
parameter** (it reads the caller's own latest draft), so there is no enumeration surface and no
`isUuid` check is needed. It MUST use `@/lib/supabase/server` `createClient()` and MUST NOT use
`createAdminClient()`.

---

### 3. `src/lib/wizard/draft-query.ts` (utility) — NEW, single-sourced

**Analog:** `src/lib/sync-progress.ts` — the existing precedent for "one contract module imported
by both a route handler and the component that consumes it". Sibling modules in the same directory
(`src/lib/wizard/`): `localStorage.ts`, `validate-budget.ts`, `wizard-correlation.ts` — each has a
colocated `*.test.ts`, so `draft-query.test.ts` is expected.

**The query body to move VERBATIM** (`…/strategies/new/wizard/page.tsx:79-89`):
```ts
  const { data: draft } = await supabase
    .from("strategies")
    .select(
      "id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, asset_class, created_at",
    )
    .eq("user_id", user.id)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
```
The `InitialDraft` interface at `page.tsx:33-47` is the return type (note: it does **not** include
`created_at` even though the select does). Moving both to the helper keeps the type single-sourced too.

⚠️ **A4 / Pitfall W-2 remains open.** `api_key_id === null` is true for BOTH a CSV draft and a
member-bearing composite draft. If the CSV short-circuit fix keys off `api_key_id`, it will route
a composite draft to the CSV step. The composite discriminator that exists today is
`strategies.api_key_id IS NULL AND a strategy_keys count > 0` (`keys/sync/route.ts` composite
branch). Resolve at planning; do not assume.

---

### 4. `src/hooks/useStrategySyncPoller.ts` (hook, polling) — STALE-01a

**Analog: its own interval arm, 70 lines up.** ⭐ TWIN-3 — the correct behaviour already exists in
this file. The interval arm never fabricates:

```ts
// Source: src/hooks/useStrategySyncPoller.ts:149-159  ← ARM A, CORRECT
        // A missing row (PGRST116 or any error with null data) consumes grace
        // like a missing row — no escalation until the grace boundary.
        if (!data) {
          if (missingRowGracePolls !== undefined && attempts > missingRowGracePolls) {
            onErrorRef.current();
          }
          return;            // ← onStatus is NEVER called with a fabricated value
        }
        onStatusRef.current(data.computation_status, data.computation_error ?? null);
```

```ts
// Source: src/hooks/useStrategySyncPoller.ts:226-249  ← ARM B, THE DEFECT
        consecutiveErrors = 0;                       // reset BEFORE inspecting the row

        const nextStatus = (statusRow?.computation_status ??
          "pending") as ComputationStatus;           // absent row becomes a domain value
        const nextError = statusRow?.computation_error ?? null;
        onStatusRef.current(nextStatus, nextError);

        if (nextStatus === "failed" || isComputedAnalytics(nextStatus)) { … }

        scheduleNext();                              // pending / null: unbounded
```

The ladder arm even has a `missingRowGracePolls` option in its own `UseStrategySyncPollerOptions`
(`:61`) that it **never reads** — only the interval arm consumes it. A plan that adds a
"missing row" concept to the ladder arm should ask whether it is re-inventing that option.

**Effect-deps + latest-callback-ref discipline that must survive any edit** (`:89-104`, `:275-283`):
```ts
  const onStatusRef = useRef(opts.onStatus);
  const onTerminalRef = useRef(opts.onTerminal);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onStatusRef.current = opts.onStatus;
    onTerminalRef.current = opts.onTerminal;
    onErrorRef.current = opts.onError;
  });
  // …deps: [enabled, strategyId, schedule, isLadder, maxConsecutiveErrors,
  //         maxAttempts, missingRowGracePolls]  — all stable
```
⛔ Adding a non-primitive to those deps re-runs the effect on every render and resets
`consecutiveErrors`/`tick` — the exact hazard the ref indirection exists to prevent (`:89-96`).

⚠️ **A fix in this hook reaches `SyncProgress.tsx` too** (RESEARCH State-of-the-Art row 4). If the
edit lands in the shared hook, a `SyncProgress` regression test ships in the same commit
(`src/components/strategy/SyncProgress.poll.test.tsx` is the existing file).

---

### 5. `SyncPreviewStep.tsx` (component, polling) — STALE-01a + STALE-01b

**Analog: its own composite arm.** The guard to clone into the single-key arm:

```ts
// Source: SyncPreviewStep.tsx:1092-1103 — ARM A (composite), HAS the guard
            // R2-5 (stale-complete race): the stitch_composite worker does a
            // wholesale delete→re-upsert of csv_daily_returns. A poll landing
            // inside that window can read a 'complete' status with 0 series
            // rows … Treat an empty series as NOT-yet-terminal …
            if (series.length === 0) {
              return "repoll";
            }
```

```ts
// Source: SyncPreviewStep.tsx:1398-1447 — ARM B (single-key), NO guard
          const csvRowCount = csvRowCountRes.count;
          // COUNTS ARE PART OF THE CLASS. … a null count with NO error is as
          // unrepresentable as an error — and `?? 0` on it is the same
          // fabrication by another route.
          if (tradeCount === null) { throw new Error(…); }
          if (csvRowCount === null) { throw new Error(…); }
          …
          const gate = checkStrategyGate({
            apiKeyId, tradeCount, earliestTradeAt: …, latestTradeAt: …,
            computationStatus: nextStatus, computationError: nextError,
            csvRowCount,
            seriesCompleteness: analytics?.series_completeness ?? null,
          });
          if (!gate.passed) { setGateResult(gate); … }   // ← terminal red envelope
```
⭐ Note the asymmetry precisely: Arm B already distinguishes *null count* (throw) from *zero count*
(a real measurement). What it does **not** have is Arm A's "a real zero may still be mid-re-derive"
reading. The fix is a third state, not a fourth `??`.

**The render gate to widen (TWIN-2)** (`:2290-2291`):
```tsx
  const showInterruptedBanner =
    isComposite && (syncProgress?.stalled === true || stallBackstop);
```
The banner markup + testid live at `:2406-2408` (`data-testid="wizard-sync-interrupted"`), and the
UI-SPEC state 3 amber block copies that banner's shape verbatim
(`role="status"`, `rounded-md border border-warning/40 bg-warning/5 px-4 py-3`).

**The client-side fetch gate (TWIN-5, third gate)** (`:910`) — RESEARCH names the route filter and
the render gate but not this one:
```tsx
      if (isComposite) {
        void wizardFetch(`/api/strategies/${strategyId}/sync-progress`)
          .then((r) => (r.ok ? r.json() : null))
          .then((json: SyncProgressResponse | null) => { … });
      }
```
Widening `sync-progress/route.ts:185` alone changes nothing for a single-key strategy — the client
never asks. **All three gates are one class.**

**The status line whose truth is the subject** (`:2315-2323`) — the string that must stop being a
lie; do not re-copywrite it (UI-SPEC §2):
```tsx
{computationStatus === "failed"        ? "Sync reported a failure"
 : phase === "kicking_off"             ? "Contacting exchange..."
 : isComposite                         ? (…)
 : computationStatus === "computing"   ? "Computing analytics..."
 :                                       "Fetching trades..."}
```

---

### 6. `src/app/api/strategies/[id]/sync-progress/route.ts` (route) — the additive widening

**Analog: its own file.** The one-line filter (`:184-192`):
```ts
      for (const row of jobRows) {
        if (row?.kind !== "stitch_composite") continue;
        if (latest === null ||
            Date.parse(row.created_at ?? "") > Date.parse(latest.created_at ?? "")) {
          latest = row;
        }
      }
```

**The two contracts that must survive the widening** (excerpts to keep verbatim):
```ts
// :198-218 — field-by-field projection, NEVER spread an RPC row (T-95-07)
      const memberProgress: MemberProgressEntry[] = rawEntries.map((e) => {
        const entry = (e ?? {}) as Record<string, unknown>;
        return {
          seq: Number(entry.seq),
          exchange: typeof entry.exchange === "string" ? entry.exchange : null,
          label: typeof entry.label === "string" ? entry.label : null,
          status: coerceMemberProgressStatus(entry.status),
        };
      });
// :226-231 — the stall heartbeat is stitch-SPECIFIC (RESEARCH A5)
      const heartbeat = latest.metadata?.member_progress_at ?? latest.claimed_at ?? null;
      const stalled = jobStatus === "running" && heartbeat != null &&
        Date.now() - Date.parse(heartbeat) > STALL_THRESHOLD_MS;
```
⚠️ `stalled` derives from `metadata.member_progress_at`, which only the stitch worker writes. A
naive widening emits `stalled: false` forever for a single-key job (heartbeat falls back to
`claimed_at`, which never refreshes → could emit a **false** `stalled: true` on a long legitimate
job). Pin composite byte-identity with the existing `route.test.ts` **before** widening.
The route's own docblock (`:20-35`) records the RT-1 invariant the amber state depends on — "this
route NEVER reads the analytics table" — and must stay true.

---

### 7. `src/app/api/strategies/create-with-key/route.ts` (route, CRUD write) — WIZCONT-02

**Analog: its own idempotency fence.** The fence to extend with a second key (`:262-290`):
```ts
  const supabase = await createClient();
  const { data: existingDraft, error: existingDraftErr } = await supabase
    .from("strategies")
    .select("id, api_key_id")
    .eq("user_id", user.id)
    .eq("wizard_session_id", wizard_session_id)
    .maybeSingle();
  if (existingDraftErr) {
    // Fence read failed — fall through to the RPC … but surface that the cheap
    // pre-Railway short-circuit went dark (Rule 12 / the file's console.error convention).
    console.error(
      "[strategies/create-with-key] idempotency fence SELECT failed; proceeding to RPC (DB fence still dedups):",
      scrubSeamError(existingDraftErr),
      existingDraftErr.code,
    );
  }
  if (existingDraft?.id && existingDraft.api_key_id) {
    return NextResponse.json(
      { ok: true, strategy_id: existingDraft.id, api_key_id: existingDraft.api_key_id },
      { headers: NO_STORE_HEADERS },
    );
  }
```
⭐ **Copy the failure posture, not just the query:** a failed fence read logs and *falls through*
(the DB layer still dedups); it never 500s. The second key must behave identically.
⭐ **Copy the fail-toward-the-existing-row posture:** the arm returns the existing ids and never
writes. CONTEXT.md requires exactly this for the credential key.

**The 23505 arm that must learn to discriminate** (`:428-440`) — TWIN-8, and note the second
copy at `composite/add-key/route.ts:404`:
```ts
    if (error) {
      console.error("[strategies/create-with-key] RPC error:", scrubSeamError(error), error.code);
      if (error.code === "23505") {
        return NextResponse.json(
          { code: "DRAFT_ALREADY_EXISTS",
            error: "A wizard session with this key is already in progress." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      if (error.code === "42501") { … }
      captureToSentry(error, {
        tags: { surface: "strategies-create-with-key", step: "draft-rpc-error" },
        extra: { pg_code: error.code },
        secrets: [api_key, apiSecretNormalized, passphraseOrNull],
      });
```
⭐ Note the `secrets: [...]` array on `captureToSentry` — any new credential-shaped value the
route handles must be added there.

**MT5 venue-shape normalisation already in the route** (`:103-172`) — the login is in scope at the
right place:
```ts
  const isMt5 = exchange.toLowerCase() === "mt5";
  // ccxt API keys are long secrets; an MT5 login is a short broker ACCOUNT NUMBER
  // (commonly 5-8 digits …), so mt5 requires only a NON-BLANK login …
  if (typeof api_key !== "string" ||
      (isMt5 ? api_key.trim().length === 0 : api_key.length < 8)) { … }
```

---

### 8. `supabase/migrations/<ts>_api_keys_venue_account_id.sql` (migration, DDL) — NEW

**Analog: `supabase/migrations/20260811210000_api_keys_attested_venue.sql`** — the most recent
migration in the repo, it adds a **non-secret column to `api_keys`**, it re-bases **both** wizard
RPCs, and it lands a BEFORE INSERT scrub trigger. It is the exact shape this phase needs.

**Naming + transaction form** (from `20260728120000:101-108`, quoted there as the house rule):
```
-- Form: TRANSACTIONAL, not CONCURRENTLY — same reasoning as 20260726000225:53-64.
-- CONCURRENTLY cannot run inside a transaction block (25001) and a failed build
-- leaves an INVALID index behind that enforces nothing while still costing every
-- writer.
-- Ordering: CREATE the new index BEFORE dropping the old one.
```
Filename convention: `YYYYMMDDHHMMSS_snake_case_description.sql`, monotonically after
`20260811210000`. Header opens with a `-- ===` banner, the phase id, and the date.

**Column + skeleton** (`20260811210000:222-228`):
```sql
BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────────── 1. the column
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS attested_venue text;
```

**Partial UNIQUE index** — copy the shape from `20260602190000:52-57`, the predicate discipline
and the tenant-leading rule from `20260728120000`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS strategies_user_wizard_session_uniq
  ON public.strategies (user_id, wizard_session_id)
  WHERE wizard_session_id IS NOT NULL;

COMMENT ON INDEX public.strategies_user_wizard_session_uniq IS
  'F6: at most one wizard draft per (user, wizard_session_id). Backstop for …';
```
⭐ `user_id` MUST LEAD. From `test_wizard_session_idempotency.sql:66-68`: *"user_id must LEAD —
wizard_session_id is caller-supplied and a non-tenant-leading unique index over it is the C-08
cross-tenant leak."* The WIZCONT-02 key is `(user_id, exchange, <col>) WHERE <col> IS NOT NULL`.

**Pre-flight duplicate census** (`20260728120000:135-166`) — required because `api_keys` has PROD rows:
```sql
DO $$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT user_id, wizard_session_id, source
      FROM public.strategies
     WHERE wizard_session_id IS NOT NULL
     GROUP BY user_id, wizard_session_id, source
    HAVING count(*) > 1
  ) AS d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'SEAMRIM-03 ABORT: % duplicate … groups present; resolve manually before applying the composite UNIQUE INDEX', v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;
```
(New column backfills to NULL, so this is satisfied by construction on day one — RESEARCH says
**say so in the header** rather than relying on it silently.)

**RPC re-base rule, verbatim from `20260811210000:124-137`:**
```
--   2. CREATE OR REPLACE create_wizard_strategy, re-based VERBATIM on the
--      LATEST definition — migration 20260602190000, lines 62-157 — with
--      EXACTLY two additions … A repo-wide grep finds four definitions
--      (20260411103316, 20260513084844, 20260515114310, 20260602190000) …
--      (B5b lesson: grep ALL migrations for the function name and re-base on the
--      newest body before CREATE OR REPLACE, or an older body is silently restored)
--   3. CREATE OR REPLACE add_wizard_composite_key, re-based VERBATIM on the
--      LATEST definition — migration 20260710180000, lines 53-141 …
```
⛔ **TWIN-7: `20260811210000` IS NOW THE LATEST BODY FOR BOTH RPCs.** Re-base on
`20260811210000:306-411` (`create_wizard_strategy`) and `:418-512` (`add_wizard_composite_key`),
NOT on `20260602190000`. Taking the older body silently reverts the `attested_venue` stamp.

**⛔ Two live constraints on `api_keys` that a new column interacts with:**
```sql
-- 20260811210000:292-295 — the coupling CHECK
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_attested_venue_matches_exchange
      CHECK (attested_venue IS NULL OR attested_venue = exchange);

-- 20260811210000:548-552 — the BEFORE INSERT scrub trigger
DROP TRIGGER IF EXISTS api_keys_scrub_attested_venue ON public.api_keys;
CREATE TRIGGER api_keys_scrub_attested_venue
BEFORE INSERT ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.scrub_client_supplied_attested_venue();
```
The scrub function's `current_user IN ('postgres','service_role','supabase_admin')` allowlist and
its `SECURITY INVOKER` declaration (`:515-546`) are the pattern for "a column only a privileged
writer may set". **A venue-confirmed account id is exactly that class of value** — decide
explicitly whether it needs the same trigger treatment, and say why if not.

**Post-verify block that ABORTS** (`20260811210000:771-948`) — the house form; copy checks (b)
(fence canary — "did the re-base take a stale body?"), (e) (grants unchanged), and (g)
(constraint present **and** `convalidated`):
```sql
  IF v_cws_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_cws_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION
      'Migration … failed: create_wizard_strategy lost its wizdraft: advisory-lock fence — the re-base took a stale definition. Rolling back.';
  END IF;
```

⚠️ **Ops (binding, from CONTEXT.md + memory):** merging `supabase/migrations/**` to `main`
AUTO-APPLIES to PROD (`khslejtfbuezsmvmtsdn`). Apply to TEST (`qmnijlgmdhviwzwfyzlc`) via Supabase
MCP `apply_migration` before merge and run the migration reviewer. ⛔ Never `supabase db push`.
`20260811210000:6-26` also documents a **deploy-order** hazard (migration must be live BEFORE the
Vercel build that reads the column) — the same hazard applies here.

---

### 9. `supabase/tests/test_api_keys_venue_identity_uniq.sql` (SQL gate) — NEW

**Analog: `supabase/tests/test_wizard_session_idempotency.sql`** — the exact partial-unique gate
shape, including the `pg_index` column-order assertion that a naive `ILIKE` would miss.

**House form** (`:22-28`, `:121`) — pgTAP is not set up; assertions `RAISE EXCEPTION`:
```sql
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_wizard_session_idempotency.sql
DO $$
DECLARE
  v_col_type   TEXT;
  v_idx_def    TEXT;
  v_idx_cols   TEXT[];
  v_fn_src     TEXT;
BEGIN
…
  RAISE NOTICE 'PASS: F6 wizard-session idempotency invariants intact (column + partial-unique + advisory-lock fence + grants).';
END $$;
```

**Column existence + type** (`:29-40`):
```sql
  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategies'
     AND column_name = 'wizard_session_id';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: strategies.wizard_session_id column is missing';
  END IF;
```

**⭐ The partial-UNIQUE assertion — copy all three halves** (`:53-84`):
```sql
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'strategies'
     AND indexname = 'strategies_user_wizard_session_source_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: … index is missing';
  END IF;
  IF v_idx_def NOT ILIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'TEST FAILED: … must be UNIQUE: %', v_idx_def;
  END IF;
  -- Assert the indexed column LIST AND ORDER from pg_index rather than
  -- substring-matching indexdef: an ILIKE for '%source%' also matches the index
  -- NAME inside its own definition text, so it would report agreement even if the
  -- column were dropped. user_id must LEAD …
  SELECT array_agg(a.attname ORDER BY k.ord) INTO v_idx_cols
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'strategies_user_wizard_session_source_uniq';
  IF v_idx_cols IS DISTINCT FROM ARRAY['user_id','wizard_session_id','source']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED: index must cover exactly (…) in that order, got %', v_idx_cols;
  END IF;
  -- Must be PARTIAL … otherwise every NULL collides.
  IF v_idx_def NOT ILIKE '%wizard_session_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED: index must be partial (WHERE … IS NOT NULL): %', v_idx_def;
  END IF;
```

**Grant assertions** (`:111-119`) — repeat for the re-based RPCs (both of them, TWIN-7):
```sql
  IF NOT has_function_privilege('authenticated',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated lost EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon', '…', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;
```
⚠️ Per RESEARCH §Validation Architecture: SQL gates in `supabase/tests/test_*.sql` are the only
DB assertions that run in CI. `*_live.py` and `skipIf` vitest never do.

---

### 10. `src/hooks/useStrategySyncPoller.test.ts` (test, hook) — NEW, from zero

⚠️ **No test file exists for this hook today.** No single analog composes all three needs
(renderHook + fake timers + a mocked Supabase client), so this is a **two-donor composite**.
No `renderHook` test in this repo currently mocks `@/lib/supabase/client` — verified by scan.

**Donor A — renderHook + fake timers + async advance** (`src/components/notes/useNoteAutoSave.test.ts:13-15, 40-73`):
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNoteAutoSave } from "./useNoteAutoSave";
…
  it("happy path: …", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNoteAutoSave("portfolio", "abc"));
    …
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.saveState).toBe("idle");
  });
```
⛔ **DO NOT copy Donor A's `vi.stubGlobal("fetch", …)` at `:31`.** That is this repo's known
CI-only failure class (DEF-16-1, CI Node 22 vs local Node 25). Use `vi.spyOn` + `vi.restoreAllMocks()`
per Donor B. Two conventions conflict here; the 140.x runtime tests are more recent and more tested,
and they state the rule explicitly — follow them.

**Donor B — the Supabase client double** (`SyncPreviewStep.readfailure.runtime.test.tsx:146-199`):
```ts
interface ChainState { ascending: boolean | null; }

/**
 * A chainable postgrest-builder double. The resolver is invoked LAZILY, at
 * await time … Both await forms the production code uses are supported:
 * `.maybeSingle()` and awaiting the builder directly (a thenable).
 */
function chain(resolve: (state: ChainState) => unknown) {
  const state: ChainState = { ascending: null };
  const self = {
    eq: () => self,
    neq: () => self,
    limit: () => self,
    order: (_c: string, opts?: { ascending?: boolean }) => {
      state.ascending = opts?.ascending ?? true; return self;
    },
    maybeSingle: () => Promise.resolve(resolve(state)),
    then: (onFulfilled: (value: unknown) => void) => onFulfilled(resolve(state)),
  };
  return self;
}

const okRow = (data: unknown) => ({ data, error: null });

let currentClientFactory: () => unknown = () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(okRow(null)) }) }) }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));
```
⚠️ The poller's ladder arm uses `.select(...).eq(...).maybeSingle()` and the interval arm uses
`.single()` — the double needs **both**. `chain()` above covers `maybeSingle`; add `single`.

**Donor B — teardown** (`:342-353`):
```ts
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({ … });   // reset the module-level factory
  });
```

**T2's assertion shape** (per RESEARCH §Step 8): drive ladder mode with a read that always answers
`{ data: null, error: null }`; assert `onStatus` is **not** called with a fabricated `"pending"`.
The interval arm's behaviour (TWIN-3) is the oracle — assert both arms in the same file so the
divergence is the test's subject.

---

### 11. `SyncPreviewStep.stale.runtime.test.tsx` / `.stale-refusal.runtime.test.tsx` (tests) — NEW

**Analog: `SyncPreviewStep.readfailure.runtime.test.tsx` — copy the harness verbatim.**
Extract these five blocks unchanged:

```tsx
/** @vitest-environment jsdom */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";
```

```tsx
// :197-207 — the three module mocks every SyncPreviewStep runtime test installs
vi.mock("@/lib/supabase/client", () => ({ createClient: () => currentClientFactory() }));
vi.mock("@/lib/for-quants-analytics", () => ({ trackForQuantsEventClient: vi.fn() }));
vi.mock("@/components/connect/KeyPermissionBadge", () => ({ KeyPermissionBadge: () => null }));
```

```tsx
// :282-299 — the kickoff spy (single-key run) + the base props
function installFetchMock() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true, composite: false }), { status: 200 }),
  );
}
const baseProps = {
  strategyId: "strat-readfailure-1",
  apiKeyId: "key-readfailure-1",
  wizardSessionId: "session-readfailure-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};
```

```tsx
// :310-328 — the settle ladder. THE THREE-STAGE ADVANCE IS LOAD-BEARING:
//   advance(0)   → mount effect + kickoff POST
//   advance(0)   → kickoff body parse
//   advance(N)   → poll ticks (POLL_BACKOFF_MS = 3000,3000,5000,5000,10000)
async function renderAndSettle(…) {
  installClient(failing);
  const view = render(<SyncPreviewStep {...baseProps} … />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  return { text: view.container.textContent ?? "", unmount: view.unmount };
}
```

```tsx
// :229-247 — the analytics-table dispatch keyed on the SELECTED COLUMNS.
// This is how the harness tells the mount freshness probe from the status poll.
        if (table === "strategy_analytics") {
          if (cols === "computation_status, computed_at")        return chain(() => okRow(null));
          if (cols === "computation_status, computation_error")  return chain(() => okRow({ … }));
          if (cols === "data_quality_flags")                     return chain(() => okRow({ data_quality_flags: null }));
          return chain(() => pick("analytics", okRow(null)));   // the heavy read
        }
```

**Two oracle disciplines to copy, not just the plumbing:**

1. **The positive counterpart leads** (`:355-375`) — a negative-only oracle is satisfied by a
   component that renders nothing:
   > `critical-regressions.test.ts:131-144` is the template … a negative-only oracle is satisfied
   > by a component that renders NOTHING AT ALL, which is exactly how mutation M-9 measured a
   > guard going vacuous.
   T1/T3 assert absences ("no `gate_failed`", "no `ErrorEnvelope`"). Each file needs its positive
   counterpart plus the vacuity fence at `:511-514` (`expect(text.length).toBeGreaterThan(0)`).

2. **Hand-typed needles, never imported copy** (`:80-107`):
   ```tsx
   // ⚠️ HAND-TYPED, DELIBERATELY. Importing `WIZARD_ERROR_COPY` … would compare
   // the render to itself through a re-export — Oracle Independence hazard 6.
   const FABRICATED_MEASUREMENT = "filled trade(s) on this key";
   /** ErrorEnvelope renders `code: <CODE>` verbatim, and that string is unique per state. */
   const RENDERED_CODE = (code: string) => `code: ${code}`;
   ```
   ⭐ And the near-miss it records: the envelope TITLE matches three different states and reported
   a broken tree GREEN. For T3, the needle is `RENDERED_CODE("GATE_SERIES_PROVENANCE_UNVERIFIED")`
   or the specific code — **not** the shared title.

3. **The twin-symmetry case gets its own `it()`, never a loop** (`:392-411`):
   > Without this case a fix applied to the `trades` count alone would look complete … That shape —
   > an instance-fix wearing a class-fix's clothes — is what this programme keeps rediscovering, so
   > it gets its own case rather than a loop over the seven.
   T3b (composite arm, identical empty-series state, repolls) is that case for TWIN-1.

---

### 12. Contract test — the draft query is single-sourced

**Analog: `src/__tests__/strategies-published-sole-writer-guard.test.ts`** — the repo's
"exactly one writer / one shape" source-scan guard.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

/** The ONE sanctioned production writer of strategies.status='published'. */
const ALLOWED_TS_WRITER = "src/app/api/admin/strategy-review/route.ts";

const STRATEGIES_TABLE_RE = /from\(\s*["']strategies["']\s*\)/;
…
function isTestPath(rel: string): boolean {
  return /\.test\.[tj]sx?$/.test(rel) ||
    rel.split(/[\\/]/).includes("__tests__") ||
    rel.includes("test-helpers");
}
function walk(dir: string, exts: string[]): string[] { … }
```

Retarget: the offender predicate becomes *"a non-test `src/` file that carries
`.eq("source", "wizard")` together with `.eq("status", "draft")`"*, allow-listed to
`src/lib/wizard/draft-query.ts` alone. The donor's **falsifiability record** (`:62-68`) is the part
to copy hardest — the guard must be demonstrated red by adding a throwaway second query and green
again on removal, and that demonstration recorded in the plan summary.

---

### 13. e2e resume path

**Analog: `e2e/composite-onboarding.spec.ts:405-500`** — seeded-draft resume, spies not stubs,
own-seed invariant, prefix GC.

```ts
test.describe("Phase 94 — wizard resumability (WIZ-03 / WIZ-05)", () => {
  test.skip(!HAS_SEED_ENV, "wizard resumability: seed-helper env vars not wired …");

  test.afterAll(async () => {
    if (HAS_SEED_ENV) { await cleanupStrategiesByNamePrefix("e2e-composite-"); }
  });

  test("owner-seeded resume: …", async ({ page }) => {
    const allocator = await seedTestAllocator({ role: "both" });
    const composite = await seedCompositeStrategy({ variant: "resumable", ownerUserId: allocator.userId });

    // 2. Route SPIES, not stubs … A COUNT of 0 for keys/sync is the WIZ-05 proof
    let syncKickoffCalls = 0;
    await page.route("**/api/keys/sync", async (route) => { syncKickoffCalls += 1; await route.continue(); });

    await loginViaForm(page, allocator.email, allocator.password);
    await page.goto("/strategies/new/wizard");
    await expect(page.getByTestId("wizard-use-this-key")).toBeVisible({ timeout: 15_000 });
    expect(syncKickoffCalls, "WIZ-05: a COMPLETE composite must NOT re-kick …").toBe(0);
  });
});
```
⚠️ **Shared TEST DB (RESEARCH Pitfall 4 + project memory):** assert this spec's **own seeded draft
id** resumes; never a global "no draft exists" or a global row count. The `e2e-composite-` name
prefix + `cleanupStrategiesByNamePrefix` is the isolation mechanism to reuse.
⚠️ The 154 e2e must open the overlay from **My Strategies empty state / `+ Strategy`**, not
`/strategies/new/wizard` — that route already works.

---

## Shared Patterns

### A. `NO_STORE_HEADERS` on every response
**Source:** `@/lib/api/headers`; usage `composite/members/route.ts:47,76,83,113,144,156`,
`sync-progress/route.ts:111,128,148,173,195,234`
**Apply to:** the new draft route and every changed arm of `sync-progress` / `create-with-key`.
There is a repo-wide contract test — `src/__tests__/no-store-coverage.test.ts` — so a new route
missing it reddens.

### B. Never forward a raw DB/seam error to the browser
**Source:** `create-with-key/route.ts:429-432` (`scrubSeamError`), `composite/members/route.ts:146-152`
**Apply to:** every new error arm.
```ts
    const message = err instanceof Error ? err.message : "Member read failed";
    const correlationId = await getCorrelationId();
    console.error(`[strategies/composite/members] caught exception [correlation_id=${correlationId}]:`, message);
    return NextResponse.json({ code: "UNKNOWN" }, { status: 500, headers: NO_STORE_HEADERS });
```

### C. Absence is not a value (the class this phase closes)
**Source:** `SyncPreviewStep.tsx:596-618` and `:1400-1413`; **violated at**
`useStrategySyncPoller.ts:228`; **already correct at** `useStrategySyncPoller.ts:151-159`
**Apply to:** every `.maybeSingle()` / `head:true` count in the poll's blast radius.
```ts
// SyncPreviewStep.tsx:1400-1413
          // COUNTS ARE PART OF THE CLASS. Both of these are `head: true` exact
          // counts, so a null count with NO error is as unrepresentable as an
          // error — and `?? 0` on it is the same fabrication by another route.
          if (tradeCount === null) { throw new Error("… head:true exact count was null"); }
```

### D. Wizard error copy comes from `buildEnvelope()` + `wizardErrors.ts` only
**Source:** UI-SPEC §Copywriting; grep-enforced repo-wide
**Apply to:** any new terminal state. If 154-01's root cause demands a new `WizardErrorCode`, it
lands with `KNOWN_FINALIZE_CODES` + copy-table pins in the **SAME commit** (153.x discipline).

### E. Hydration discipline on `WizardClient`
**Source:** `WizardClient.tsx:178-196`
**Apply to:** anything that touches a `useState` initializer in that component.
```tsx
  // The fix: every useState below initializes from SSR-deterministic
  // inputs (`source`, `initialDraft`) only. The single `useEffect` at
  // the top of the body reads localStorage once after mount and applies
  // any resume overrides via setState … React #418 cannot fire.
```
⛔ Do NOT move the draft read inside `WizardClient` — the component also serves the SSR
`/strategies/new/wizard` page.

### F. Existing markup the fix reuses byte-identically
**Source:** `WizardClient.tsx:899-923` (resume banner) and `:886-897` (session-expired strip —
the UI-SPEC's visual donor for the WIZCONT-02 dedup notice)
```tsx
        {showResumeBanner && initialDraft && (
          <div className="mb-4 rounded-md border border-border bg-white px-4 py-3">
            <p className="text-body font-medium text-text-primary">We saved your progress.</p>
            <p className="mt-1 text-caption text-text-muted">…</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleResume} data-testid="wizard-resume">Resume draft</Button>
              <Button size="sm" variant="ghost" onClick={handleStartFresh} data-testid="wizard-start-fresh">Start fresh</Button>
            </div>
          </div>
        )}
```
```tsx
        {sessionExpired && (
          <div className="mb-4 rounded-md border border-border bg-page px-3 py-2 text-caption text-text-secondary">
            Your session expired. Your draft is saved.{" "}…
          </div>
        )}
```
⛔ **TRAP-4 standing invariant** (`WizardClient.tsx:815-846`): `handleStartFresh` opens the
confirm dialog and does nothing else. Never restore a direct `handleDeleteDraft()` call.

### G. Coverage ratchet
**Source:** `CLAUDE.md`; thresholds lines 82 / statements 80 / functions 74 / branches 72, enforced
by the blocking `frontend-coverage` CI job.
**Apply to:** every new branch in `SyncPreviewStep.tsx` (2448 lines) — ships with its test in the
same commit.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/hooks/useStrategySyncPoller.test.ts` | test (hook) | polling | **Partial gap.** No `renderHook` test in this repo mocks `@/lib/supabase/client` (verified by scan of all 16 `renderHook` files). The two donors above cover the halves; their composition is new. |
| `.planning/REQUIREMENTS.md` correction | doc | — | Ledger edit; no code analog. |

**Nothing else in this phase lacks an analog.** RESEARCH.md's own conclusion holds: *"every
capability this phase needs already exists somewhere in the codebase … Plans should connect, not
build."*

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/strategies/new/wizard/**`,
`src/app/(dashboard)/allocations/components/**`, `src/app/api/strategies/**`, `src/hooks/**`,
`src/lib/wizard/**`, `src/__tests__/**`, `supabase/migrations/**`, `supabase/tests/**`, `e2e/**`
**Files read this session:** 21 (12 source, 5 test, 3 SQL, 1 e2e)
**Pattern extraction date:** 2026-08-12
**Open, deliberately not resolved here:** AGENTS.md Next-docs read (A1); the CSV-vs-composite
draft discriminator (A4 / Pitfall W-2); whether the new `api_keys` identity column needs the
`api_keys_scrub_attested_venue`-style BEFORE INSERT trigger.
