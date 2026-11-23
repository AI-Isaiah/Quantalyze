# Phase 209: SCRUBLEAKS - Pattern Map

**Mapped:** 2026-11-14 (worktree `quantalyze-209`, HEAD `b8cc9adc6`)
**Files analyzed:** 14 (6 source edits, 1 comment-only source edit, 7 test files)
**Analogs found:** 14 / 14 (every edit has an in-repo analog; the beforeSend guarded walk has only a partial one)

All analog paths below were checked tracked with `git ls-files` (none is a gitignored mirror). Line numbers are for HEAD; cite by symbol if they drift.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/seam-redaction.ts` | utility (pure leaf) | transform | itself: `describeThrown` / `scrubSeamError` (`:357-456`) | exact (extend in place) |
| `src/lib/sentry-capture.ts` | utility | transform + request-response (lazy import) | itself: `scrubCaptureInput` (`:99-127`) | exact |
| `src/instrumentation.ts` (`scrubSentryEvent`, `scrubRecordStrings`) | hook (Sentry `beforeSend`) | transform (in-place tree walk) | itself (`:79-174`); fail-safe precedent `scrubRecord` in `sentry-capture.ts:150-162` | partial (no existing guarded walk) |
| `src/app/api/og/factsheet/[id]/route.tsx` | route handler | request-response (public, cached) | `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:163` (`isUuid` guard) | role-match |
| `src/app/api/keys/validate-and-encrypt/route.ts` | route handler | request-response | `src/app/api/strategies/create-with-key/route.ts:915-921` | exact |
| `src/app/api/allocator/scenario/share/route.ts` | route handler | CRUD (RPC + audit) | `src/app/api/strategies/[id]/share/route.ts` (literal-call shape, `CreateShareRpcClient`) | role-match |
| `src/app/api/strategies/[id]/share/route.ts` | route handler | comment-only edit (JSDoc `:145-160`) | itself | n/a |
| `src/lib/sentry-capture.test.ts` | test | unit, mocked Sentry SDK | itself (`describe("[SEAMCORE-06] ...")`, `:100-267`) | exact |
| `src/lib/seam-redaction.test.ts` | test | unit | itself (log-path cases `:405-495`, export pin `:624`) | exact |
| `src/instrumentation.test.ts` | test | unit, registered-callback | itself (`describe("[164 SHARE-01] ...")`, `:90-262`) | exact |
| `src/app/api/og/factsheet/[id]/route.public-access.test.tsx` | test | unit, route with fake supabase | itself + `route.test.tsx` `F1` (`:566`, `STATE.readError`) | exact |
| `src/app/api/keys/validate-and-encrypt/route.test.ts` | test | unit, route | itself (`makeReq` `:204`) | exact |
| `src/lib/wizardErrors.invariant.test.ts` | test (census) | source scan | itself (`ROUTES` row `:470-490`) | exact |
| `src/__tests__/audit-coverage.test.ts` | test (gate) | source scan | itself (`MUTATING_RPC_NAMES` `:380-431`, Phase 191 pin `:1030-1042`) | exact |

## Pattern Assignments

### `src/lib/seam-redaction.ts` (utility, transform) — S1 capture mode

**Analog:** itself. The edit threads a flag through `describeThrown`; no import may be added (purity guard `seam-redaction.test.ts:504-677` fails on any import, `require(`, `import(`, module-scope `process.env`).

**Existing key list to leave UNTOUCHED (D-03)** (`:178-186`):
```ts
const PLAIN_OBJECT_DIAGNOSTIC_KEYS: readonly string[] = [
  "name", "code", "message", "details", "hint", "errno", "syscall",
];
```
Add a SECOND constant beside it (capture list `name, code, message, errno, syscall`) and a fixed placeholder string. Both in-file.

**Core pattern to extend: `describeThrown` signature and its two recursion/branch points** (`:357-437`):
```ts
function describeThrown(err: unknown, depth: number, seen: Set<object>): string {
  ...
    if (err instanceof Error) {
      ...
      if (cause !== undefined && cause !== null) {
        rendered += ` [cause: ${describeThrown(cause, depth + 1, seen)}]`;   // <- must pass the flag (Pitfall 1)
      }
      return rendered;
    }
    if (typeof err === "object") {
      const record = err as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of PLAIN_OBJECT_DIAGNOSTIC_KEYS) {                       // <- choose list by flag
        const field = record[key];
        if (typeof field === "string" || typeof field === "number") parts.push(`${key}=${field}`);
      }
      if (parts.length > 0) return parts.join(" ");
      // <- capture mode: return placeholder HERE, before the String(err) / JSON.stringify fallbacks (D-05)
      let rendered: string | null = null;
      try { rendered = String(err); } catch { rendered = null; }
      ...
```

**Entry-point pattern to copy for the new export** (`scrubSeamError`, `:447-456`):
```ts
export function scrubSeamError(err: unknown, extraSecrets: readonly unknown[] = []): string {
  try {
    return scrubSeamString(describeThrown(err, 0, new Set<object>()), extraSecrets);
  } catch {
    return "[seam-redaction: unrepresentable thrown value]";
  }
}
```
New `scrubSeamErrorForCapture` is this verbatim with the flag set. Total by construction; never throws.

**Export-surface pin that must move on purpose** (`seam-redaction.test.ts:624-637`): hand-typed SET of six names; add the new name with a one-line reason.

---

### `src/lib/sentry-capture.ts` (utility, transform) — S1 two call sites

**Analog:** itself. Imports exactly one module and must keep that property (six `"use client"` importers).

**Imports** (`:1`): `import { scrubSeamError, scrubSeamString } from "./seam-redaction";` — add the new export to this same import; `scrubSeamError` may become unused (remove it from the import only if it is).

**The two call sites to change** (`scrubCaptureInput`, `:99-127`):
```ts
    if (err instanceof Error) {
      let message = scrubSeamString(err.message ?? "", secrets);
      const cause = (err as { cause?: unknown }).cause;
      if (cause !== undefined && cause !== null) {
        message += ` [cause: ${scrubSeamError(cause, secrets)}]`;     // :108 -> capture variant
      }
      const rebuilt = new Error(message);
      ...
      return rebuilt;
    }
    return scrubSeamError(err, secrets);                              // :117 -> capture variant
  } catch {
    return new Error("[sentry-capture] scrubbing failed — the original error was withheld rather than dispatched unscrubbed");
  }
```
Keep the rebuilt-Error shape (D-04) and the fail-safe catch (deliver, withhold content). Do not touch `scrubValue` / `scrubRecord` (the `extra` residual is recorded, not fixed: RESEARCH Open Q2).

---

### `src/instrumentation.ts` (hook, transform) — S2 guarded `scrubSentryEvent`

**Analog:** itself for structure (`:44-52` `ScrubbableEvent`, `:79-95` `scrubRecordStrings`, `:120-174` `scrubSentryEvent`). No guarded-walk analog exists; the closest fail-safe idiom is `scrubRecord` in `sentry-capture.ts:150-162` (catch, degrade to content-free, never throw into the caller).

**Imports** (`:1`): `import { scrubSharePath } from "@/lib/scrub-share-path";` (leave).

**Current unguarded walk to replace** (`:79-95`):
```ts
function scrubRecordStrings(record: unknown, depth = 0): void {
  if (record == null || typeof record !== "object" || depth > 8) return;
  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i++) {
      const value: unknown = record[i];
      if (typeof value === "string") record[i] = scrubSharePath(value);   // unconditional write: frozen => throw
      else scrubRecordStrings(value, depth + 1);
    }
    return;
  }
  const obj = record as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];                                                // getter read: unguarded
    if (typeof value === "string") obj[key] = scrubSharePath(value);
    else scrubRecordStrings(value, depth + 1);
  }
}
```
Keep: depth cap 8, array branch, `Object.keys` iteration, the field list walked by `scrubSentryEvent` (do NOT turn it into a generic whole-event walk, RESEARCH "Alternatives").

**Unconditional direct assignments and unguarded iteration (D-09)** (`:124-157`):
```ts
  if (e.request && typeof e.request.url === "string") { e.request.url = scrubSharePath(e.request.url); }
  if (typeof e.transaction === "string") { e.transaction = scrubSharePath(e.transaction); }
  for (const crumb of e.breadcrumbs ?? []) {          // non-iterable value throws
    ...crumb.message = scrubSharePath(crumb.message);
    scrubRecordStrings(crumb.data);
  }
  for (const span of e.spans ?? []) { ...span.description = ...; scrubRecordStrings(span.data); }
  const trace = e.contexts?.trace;  ...trace.description = ...; scrubRecordStrings(trace.data);
  scrubRecordStrings(e.extra);
  scrubRecordStrings(e.tags);
  return event;
```
Every `x = scrubSharePath(x)` becomes "read guarded, assign only if `next !== value`, read back, return clean-or-not". Keep the signature `scrubSentryEvent<T>(event: T): T` and return the SAME object on in-place success (existing tests read the mutated input back).

**Fail-safe precedent to copy in spirit** (`sentry-capture.ts:150-162`):
```ts
  try {
    return scrubValue(record, secrets, 0) as T;
  } catch {
    // A hostile getter in `extra` must not cost the capture. Drop the payload
    // rather than dispatch it unscrubbed.
    return undefined;
  }
```
Here the analogue is: on unreadable/unwritable, withhold at the nearest writable parent (placeholder), root-unwritable returns a minimal replacement event (copy `type` guarded so `beforeSendTransaction` keeps routing), never `null`, never the unscrubbed event.

**Comment to correct (D-09)**: `:36-43` ("...never to a throw inside `beforeSend`, which would drop the whole event") must describe what is now delivered.

**Wiring (read, do not edit):** `Sentry.init({ beforeSend: scrubSentryEvent, beforeSendTransaction: scrubSentryEvent })` in `register()`.

---

### `src/app/api/og/factsheet/[id]/route.tsx` (route handler, request-response) — S3

**Analog:** `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:14, :163-165`.

**Import** (tearsheet route `:14`): `import { isUuid } from "@/lib/utils";` — add to the OG route's import block (`:1-28`).

**Guard shape in the analog** (`:163-165`, there a 400):
```ts
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid strategy id" }, { status: 400 });
  }
```
The OG route DIFFERS on purpose (D-10): not an early 400, but treat as not-found. Wrap the existing read (`GET`, `:107-173`) so `data` stays `null`, `failed` stays `false`, and the existing tail yields the generic card with `LONG_CACHE_CONTROL`:
```ts
  const { id } = await ctx.params;
  let data: OgStrategyRow | null = null;
  let failed = false;
  try {                                   // <- gate this whole try body on isUuid(id)
    const supabase = await createClient();
    const res = await withPublishedOnly(supabase.from("strategies").select(...).eq("id", id)).maybeSingle();
    if (res.error) { failed = true; reportOgFailure("read", id, res.error); }
    data = (res.data ?? null) as unknown as OgStrategyRow | null;
  } catch (err) { failed = true; reportOgFailure("read", id, err); }
```
Slot-spending point to keep unreachable for a malformed id (`:50-64`): `reportOgFailure` -> `shouldCaptureNow(\`og-factsheet:${stage}\`)` -> `after(() => captureToSentry(...))`.

**Do-not-touch census facts:** keep `const FAILURE_CACHE_CONTROL = "no-store";` literal (the public-access test regex-reads it by symbol); do not add a second `displayStrategyName(` call (`strategy-display.test.ts` pins one `visible: true` in this file); tail sets `response.headers.set("Cache-Control", failed ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL)`.

---

### `src/app/api/keys/validate-and-encrypt/route.ts` (route handler, request-response) — S4

**Analog:** `src/app/api/strategies/create-with-key/route.ts:914-921` (copy EXACTLY, D-13).

**Current line to replace** (`validate-and-encrypt/route.ts:144`): `const body = await req.json();` (a literal `null` body then throws at the destructure on `:145`).

**Excerpt to copy** (create-with-key `:915-921`):
```ts
export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
```
`NextResponse` (`:1`) and `NO_STORE_HEADERS` (`:41`) are already imported in the target. Swallow the parse error: do NOT log or capture it (a V8 `SyntaxError` can echo a fragment of a body that carries raw exchange credentials; RESEARCH Pitfall 5). The guard sits before the limiter, so no limiter token is burned.

---

### `src/app/api/allocator/scenario/share/route.ts` (route handler, CRUD) — S5

**Analog:** the plain typed call shape recorded in RESEARCH Pattern 5 (verified to type-check against `database.types.ts:3920-3923`); the `logAuditEvent` block already in this file is the audited half.

**Cast to delete** (`:231-244`, including the "types not regenerated" comment block at `:231-235`):
```ts
    const { data: shareId, error } = await (
      supabase.rpc as unknown as (
        fn: "create_scenario_share",
        args: { p_scenario_id: string; p_token_hash: string },
      ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>
    )("create_scenario_share", {
      p_scenario_id: scenarioId,
      p_token_hash: hash,
    });
```
**Replacement** (name MUST stay on the SAME line as `.rpc(`: the detector is per-line; never write that literal in a comment, the scan is not block-comment aware):
```ts
    const { data: shareId, error } = await supabase.rpc("create_scenario_share", {
      p_scenario_id: scenarioId,
      p_token_hash: hash,
    });
```
Audited half to leave intact (`:264-269`): `logAuditEvent(supabase, { action: "scenario.share", entity_type: "scenario", entity_id: scenarioId, metadata: { share_id: shareId as string } });`. `metadata: { share_id: shareId as string }` still type-checks with `Returns: string | null` handling; re-run `npm run typecheck`.

### `src/app/api/strategies/[id]/share/route.ts` (comment-only)

**Analog:** itself. The JSDoc at `:145-160` says the scenario route casts and writes a literal `.rpc("create_scenario_share"` inside a comment (`:153-154`). Once the name is listed, `findRpcMutations` matches that comment line (passes today only because a `logAuditEvent(` sits ~188 lines ahead inside the 200-line forward cap). Reword so no `.rpc("create_scenario_share"` literal remains in any comment, and stop claiming the scenario route casts. Keep the `create_strategy_share` cast paragraph, which is still true for this file.

---

## Test Idioms (the phase's main copy-target)

### `src/lib/sentry-capture.test.ts` — SC1 cases

**Analog:** the `describe("[SEAMCORE-06] ...")` block, `:40-267`.

**Mock recorder and wait helper** (`:40-98`):
```ts
const capturedExceptions: Array<{ err: unknown; options: { tags?: Record<string,string>; extra?: Record<string,unknown>; level?: string } }> = [];
vi.mock("@sentry/nextjs", () => sentryRecorderModule());
async function nextCapture() {
  await vi.waitFor(() => { expect(capturedExceptions.length).toBeGreaterThan(0); });
  return capturedExceptions[capturedExceptions.length - 1];
}
beforeEach(() => { capturedExceptions.length = 0; });
```
**Case shape to copy** (cause chain case, `:180-194`):
```ts
    const outer = new Error("seam body read failed", { cause: inner });
    captureToSentry(outer, { tags: { route: "api/strategies/finalize-wizard" } });
    const captured = await nextCapture();
    const dispatched = captured.err as Error & { cause?: unknown };
    ...expect(serialized).not.toContain(INTERNAL_TOKEN);
    expect(dispatched.message).toContain("ETIMEDOUT");
```
New cases (D-02): plain object `{code, message, details: "...SENTINEL", hint: "...SENTINEL"}`; `new Error("x", { cause: pg })`; `Error -> Error -> pg`. Assert sentinels absent from `JSON.stringify` of the whole `captured` entry (payload + tags + extra) AND the preserve side (`code=42501 message=...` still present, per the file's own "over-redaction is the same TRAP-1 failure" comment `:119-121`). Add a no-allowlisted-field object (`{ status: 503, row: { email } }`) asserting the placeholder, an array and a `URL`. Per-site neuter targets: `:108` and `:117`.

**Sentinel idiom** (Phase 204, `src/app/api/intro/route.test.ts:488-505`): `details: "DETAILS-SENTINEL-row-values"`, `hint: "HINT-SENTINEL-row-values"`, then `expect(rendered).not.toContain("DETAILS-SENTINEL")` and `expect(rendered).toContain(base.code)`. Reuse these exact sentinel literals.

**Existing totality case that must stay green** (`:251-266`): `never throws, for any thrown shape` (circular, hostile `toString`).

### `src/lib/seam-redaction.test.ts`
Log-path oracle, DO NOT EDIT (`:420-433`): `preserves the SQLSTATE, message, details and hint of a PostgREST-shaped object` calls `scrubSeamError({code:"42501", ..., details, hint})` and expects all four. Add the new export name to the hand-typed set at `:624-637`. Optionally add direct `scrubSeamErrorForCapture` unit cases here (same hand-typed-literal discipline: nothing read back out of the module).

### `src/instrumentation.test.ts` — SC2 cases

**Analog:** `describe("[164 SHARE-01] Sentry never receives a share token")`, `:90-262`.

**Fixtures and invoking the REAL registered callback** (`:91-98, :173-182`):
```ts
  const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";
  const TOKEN_SHAPED = /[A-Za-z0-9_-]{43}/;
  async function registeredInitOptions() {
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    process.env.VERCEL_ENV = "preview";
    await register();
    expect(sentryInitMock).toHaveBeenCalledTimes(1);
    return sentryInitMock.mock.calls[0][0] as { beforeSend?: (e: unknown) => unknown; beforeSendTransaction?: (e: unknown) => unknown };
  }
```
**Assertion shape** (`:184-206`): call `opts.beforeSend!(event)`, then `JSON.stringify(out)` must not contain `TOKEN` nor match `TOKEN_SHAPED`; add a non-null assertion (`expect(out).not.toBeNull()`) and `expect(() => ...).not.toThrow()`. Anti-vacuity floor to copy (`:166-171`): assert the fixture really holds the token before claiming absence.

New cases (D-09a, gate = conflict case): `contexts.trace.data = Object.freeze({ "http.target": \`/factsheet-share/${TOKEN}\` })` (also under `extra` and `tags`); getter-only property holding a token; throwing getter; frozen no-token (weaker case); `breadcrumbs: 5` and `breadcrumbs: {a:1}`; whole event frozen -> replacement event with marker; run both `beforeSend` and `beforeSendTransaction`. Existing `byte-identical` case (`:219-228`) must stay green. Note: `scrubSentryEvent` is also directly importable (`import { scrubSentryEvent } from "./instrumentation"`) for cases that do not need the registered wiring.

### `src/app/api/og/factsheet/[id]/route.public-access.test.tsx` — SC3

**Analog:** itself + `route.test.tsx` `F1` (`:566-587`).

**ImageResponse mock has no status (D-12, `170.3-OG-P3-STATUS-VACUOUS`)** (`:70-77`):
```ts
vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown, options?: unknown) { ogCalls.push({ element, options }); }
  },
}));
```
Add `status: number` set from `options.status ?? 200`, then assert `expect(res.status).toBe(200)` (replaces the vacuous `res.status ?? 200` at `:285`).

**STATE and fake** (`:54-63, :97-132`): add `readError: null as { code: string; message: string } | null` to `STATE` and reset it in `beforeEach` (`:241-249`); return it from `maybeSingle` (route.test.tsx precedent: `error: STATE.readError`, `:143`, reset at `:243`). The real `shouldCaptureNow` runs (only `captureToSentry` is mocked, `:81-84`) and `beforeEach` calls `__resetCaptureThrottleForTests()`, which is why the behavioural slot test works.

**Cases that move:**
- P3 (`:279-289`): rewrite to generic card, `LONG_CACHE`, `res.status` 200, `STATE.observed.tables` equals `[]`, `afterSpy` and `captureToSentry` not called, `console.error` not called.
- P5 `it.each` row `["malformed", MALFORMED_ID, "published"]` (`:305-318`): remove the row or invert (tables stay `[]`).
- New slot test: malformed GET first, then `STATE.readError = { code: "57014", message: "canceling statement due to statement timeout" }` and GET `PUBLISHED_ID`; expect `captureToSentry` called once with `STATE.readError` and `extra` containing `strategy_id: PUBLISHED_ID`, and `Cache-Control` equal to `failureCacheControl()` (`:139-144`, reads the symbol from `route.tsx`).
- Update the matrix docblock `:36-37` (P3 text).

`F1` precedent to mirror for the capture assertion (`route.test.tsx:576-584`):
```ts
    expect(captureToSentry).toHaveBeenCalledWith(
      STATE.readError,
      expect.objectContaining({
        tags: expect.objectContaining({ route: "api/og/factsheet", stage: "read" }),
        extra: expect.objectContaining({ strategy_id: PUBLISHED_ID }),
      }),
    );
```

### `src/app/api/keys/validate-and-encrypt/route.test.ts` — SC4

**Analog:** itself. `makeReq` (`:204-210`) only takes an object body and JSON-stringifies it; add a raw-body sibling (RESEARCH S4 test seam):
```ts
new NextRequest("http://localhost:3000/api/keys/validate-and-encrypt", {
  method: "POST",
  headers: { "content-type": "application/json", ...VALID_ORIGIN },   // VALID_ORIGIN at :47
  body: "{not json",        // second case: body "null"
});
```
Assert `status` 400, `body.code === "KEY_MISSING_REQUIRED_FIELD"`, `body.error === "Invalid request body"`, `cache-control` contains `no-store`, `mockValidateKey` / `mockEncryptKey` not called. Note the file mocks `@/lib/sentry-capture` as `{ captureToSentry: captureSpy }` (`:197-198`); assert `captureSpy` not called (the parse error must not be reported).

**Census that moves on purpose** (`:2221`): `expect(src.match(/code:\s*"KEY_MISSING_REQUIRED_FIELD"/g)?.length).toBe(2);` becomes `3`. The adjacent `KEY_VENUE_NOT_ENABLED` `toBe(2)` (`:2220`) is unaffected.

### `src/lib/wizardErrors.invariant.test.ts` — census

`ROUTES` row `label: "keys/validate-and-encrypt"` (`:478-489`): `expectedSites: 12,` (`:483`) becomes `13`; update that row's comment block that lists the emitters and `KEY_MISSING_REQUIRED_FIELD x2`. The second row at `:2541` (rate-limit census) does not move.

### `src/__tests__/audit-coverage.test.ts` — SC5 / S5

**List the name** (`MUTATING_RPC_NAMES`, `:380-431`; append after the last entry with the house comment style, each entry carries a dated "why listing is what makes the law reach it" comment, e.g. `create_strategy_share` `:410-416`):
```ts
  "create_strategy_share",
  ...
  "retract_ledger_refresh_marker",
];
```
**Positive-control pin to add** (model on Phase 191 pin `:1030-1042`):
```ts
describe("audit-coverage — the Sync routes' retraction helper (Phase 191)", () => {
  it("retractInheritedRefreshMarker counts as a mutator, ... (Phase 191)", () => {
    const helperSrc = fs.readFileSync(path.resolve(__dirname, "../lib/ledger-refresh-marker.ts"), "utf8");
    expect(moduleExportMutates(helperSrc, "retractInheritedRefreshMarker")).toBe(true);
  });
});
```
The new pin: read `src/app/api/allocator/scenario/share/route.ts`, `const lines = src.split("\n")`, `const hits = findRpcMutations(file, src)`, expect `hits` to have length 1 and `isCovered(hits[0], lines)` to be `{ covered: true, reason: "audit-call" }`. `findRpcMutations` (`:451-476`) and `isCovered` (`:591-640`) are file-local (not exported), so the pin lives in this same file. Detection is per raw line after `stripLineComment`, regex `/\.rpc\(\s*['"](?:names)['"]/` (`:439-441`); a cast never matches. Neuter proofs: re-introduce the cast (pin RED); delete route's `logAuditEvent(` block (corpus test RED, naming `scenario/share/route.ts`). Floors unaffected: `H_0001_UNCOVERED_ALLOWLIST` length 6 (`:1847`), `detectedMutationSites >= 60` (`:1866`). `phase-29-frozen-spine-guards.test.ts` lists the name but scans `supabase/migrations/` only (`:329-330`), so it does not trip.

## Shared Patterns

### Fail-safe scrubbing: deliver, withhold content, never throw, never lose the report
**Source:** `src/lib/sentry-capture.ts:118-126` (fallback Error) and `:150-162` (`scrubRecord` catch).
**Apply to:** the S1 capture variant and every guarded read/write in S2.
```ts
  } catch {
    // Fail SAFE, and still capture: an alert that never fires is a worse outcome
    // than an alert with no detail, and shipping the original would defeat the
    // whole function.
    return new Error("[sentry-capture] scrubbing failed — the original error was withheld rather than dispatched unscrubbed");
  }
```

### Non-throwing PostgREST path returns a PLAIN object, not an `Error`
**Source:** `src/lib/seam-redaction.ts:381-394` comment (postgrest-js builds the class only under `throwOnError`).
**Apply to:** every S1 test fixture: the leaking input is a plain object `{ code, message, details, hint }`; an `Object.assign(new Error(...), {...})` shape is already safe (Error branch reads `message` only) and is NOT the gate.

### Coded 400 envelope with no-store
**Source:** `src/app/api/strategies/create-with-key/route.ts:915-921`; helper `NO_STORE_HEADERS` from `@/lib/api/headers`.
**Apply to:** validate-and-encrypt only (no new error code, wizard catalogue must not grow).

### Neuter-to-RED proof discipline
**Source:** RESEARCH "Neuter-to-RED matrix" and project rule: neuter, see RED, restore from a byte backup (never `git checkout` / `restore` / `stash` on uncommitted work); record each in the SUMMARY.
**Apply to:** all five fixes (S1 per call site, S2 slot/escalation/iteration, S3 guard + status, S4 `req.json()`, S5 cast + `logAuditEvent`).

### Test-command and census hygiene
Quick run: `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts src/instrumentation.test.ts src/lib/scrub-share-path.test.ts src/app/api/og src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.test.ts src/__tests__/audit-coverage.test.ts src/app/api/allocator/scenario/share src/__tests__/phase-29-frozen-spine-guards.test.ts src/app/api/intro src/app/api/strategies/create-with-key` (baseline 21 files, 911 tests). Use `grep -a`, quote zsh globs, `npm run typecheck` after un-casting the RPC.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| guarded in-place walk with escalation inside `src/instrumentation.ts` | hook | transform | No existing code walks an untrusted tree with per-read/per-write guards, read-back verification and parent-escalation. Use RESEARCH "Code Examples S2" (`scrubSlot` sketch) and the `scrubRecord` catch idiom above. The minimal replacement-event mechanism is design-only (RESEARCH A3, A4 unverified against ingest). |

## Metadata

**Analog search scope:** `src/lib`, `src/instrumentation*`, `src/app/api/{og,keys,strategies,allocator,factsheet,intro}`, `src/__tests__`
**Files read:** `seam-redaction.ts` (`:150-456`), `sentry-capture.ts` (`:1-280`), `instrumentation.ts` (`:1-200`), the four route files and eight test files named above (targeted ranges).
**Tracked-source check:** every named analog passes `git ls-files` (no `.gsd/capabilities` mirrors involved).
**Pattern extraction date:** 2026-11-14

## PATTERN MAPPING COMPLETE
