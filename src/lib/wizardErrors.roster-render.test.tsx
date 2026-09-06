/** @vitest-environment jsdom */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [164.2-09 / WIZFORM-02] CRITERION 3 — FOR EVERY SERVER-CLASSIFIED CODE THE
 * WIZARD CAN SURFACE, THE RENDERED SURFACE SHOWS *THAT* CODE, NEVER `UNKNOWN`.
 *
 * ── WHY A RENDER TEST AND NOT ANOTHER COVERAGE LAW ──────────────────────────
 *
 * WIZFORM-02 was believed closed once already. Phase 153's span verification
 * failed on 2026-08-13 (`153-VERIFICATION.md:19-47`, *"left the CLASS open"*)
 * because INSPECTION was accepted as evidence: the rosters were read, the
 * classifier was read, and nobody drove a body through a real component and
 * looked at what a reader would see. Three derived populations already exist in
 * this repo — `wizardErrors.invariant.test.ts`'s per-route coverage law, the
 * preselect refusal sweep, the seam vocabulary oracles — and NONE of them
 * renders. This file is the one that does.
 *
 * ⛔ THE TELEMETRY READ IS A SECOND SIGNAL AND NEVER THE FIRST. A test that
 * asserts only `trackForQuantsEventClient("wizard_error", { code })` passes
 * while the DOM shows the UNKNOWN card, because the classification and the
 * render are two different code paths (`ConnectKeyStep.tsx` classifies into
 * `errorCode` state, then `buildEnvelope` renders it; `formatKeyError` has its
 * own `return WIZARD_ERROR_COPY.UNKNOWN` fallback for a code it does not know).
 * Proof-by-adjacent-signal is exactly how this requirement was believed closed
 * the first time. Every row below asserts the DOM FIRST — vitest aborts a test
 * at its first failing assertion, so assertion ORDER is what decides which
 * signal a failure names, and the DOM one has to be it.
 *
 * ── THE POPULATION IS THREE SOURCES, DERIVED FROM DISK, AND IT IS EXACTLY THREE
 *
 *   (a) every key of `SEAM_CODE_TO_WIZARD_CODE`, on each surface that CONSULTS
 *       that table;
 *   (b) every member of the surface's own `KNOWN_*` roster;
 *   (c) every `code: "X"` literal its route emits.
 *
 * ⛔ THERE IS NO FOURTH SOURCE, AND "the rest of the `WizardErrorCode` union"
 * IS NOT ONE. Roughly 50-60 union members (`CSV_*`, `MT5_*`, `COMPOSITE_*`,
 * `SYNC_*`, `GATE_*` …) are neither rostered on any surface here nor
 * seam-mapped, and every wizard step classifies a code outside its roster and
 * outside the alias table as `UNKNOWN` BY DESIGN — that is the roster doing its
 * job, not a defect. An `it.each` row over such a member cannot pass, and the
 * only two ways to make it pass are to silently narrow the population or to
 * skip the row. Criterion 3's subject is "server-classified codes the wizard
 * can surface", which (a)+(b)+(c) define exactly. (Revision round 2 deleted the
 * fourth source for this reason; do not restore it.)
 *
 * ── ⚠️ FOUR SURFACES ARE RENDERED HERE, NOT FIVE. READ `## Surfaces not
 *    rendered` IN `164.2-09-SUMMARY.md` BEFORE READING THIS FILE AS THE WHOLE
 *    CLASS.
 *
 * The phase locked FIVE surfaces. `keys/validate-and-encrypt` is the fifth and
 * it is ABSENT from `SURFACES` below, deliberately and with the blocker
 * measured rather than assumed: **none of that route's three consumers reads
 * its `code` field at all**. `ApiKeyManager.tsx`, `StrategyForm.tsx` and
 * `AllocatorExchangeManager.tsx` each read `err.error` — the prose sentence —
 * and `throw new Error(...)` / `setFormError(...)` with it (re-measured at HEAD
 * 2026-09-06, the same finding `KNOWN_VALIDATE_AND_ENCRYPT_CODES`' own docblock
 * records and 164.2-05 re-measured). There is no code→copy render path to
 * assert, so a render row on that surface could only be satisfied by feeding
 * the expected title in as the wire prose and reading it back out — a
 * tautology, and the same proof-by-adjacent-signal this file exists to refuse.
 * The exclusion is DISCLOSED, not silent: `theFifthSurface` below asserts the
 * blocker still holds and reds the day a consumer starts reading `code`.
 *
 * ⛔ AND NO SUITE OR CASE IN THIS FILE IS SKIPPED. vitest exits 0 over a
 * skipped block, so one here would read as a green close of WIZFORM-02.
 *
 * ⚠️ The prohibited `describe`/`it` `.skip` forms are SPELLED APART above and
 * never written in the literal form, because the reviewer's gate is a COUNT:
 * `grep -c` for those two tokens on this file must print 0, and prose quoting
 * them verbatim makes the file fail its own gate while nothing is skipped. The
 * repo already carries this idiom — `wizardErrors.ts`'s `formatKeyError` says
 * *"(Spelled in prose, not in the literal form the plan's grep gate counts…)"*
 * for exactly the same reason.
 *
 * ── THE THREE `KNOWN_*` ROSTERS THIS FILE DOES NOT CONSUME ──────────────────
 *
 * `src/` carries EIGHT `KNOWN_*` code rosters. The four surfaces below consume
 * four of them, and the fifth (`KNOWN_VALIDATE_AND_ENCRYPT_CODES`) is the one
 * excluded above. The remaining three are OUT of this plan's locked surface
 * list and are named here so their absence is a decision on the record rather
 * than an oversight:
 *
 *   · `KNOWN_KICKOFF_CODES`   — `SyncPreviewStep.tsx`, and a `Record`, not a Set
 *   · `KNOWN_CSV_VALIDATE_CODES` — `CsvUploadStep.tsx`
 *   · `KNOWN_FINALIZE_CODES`  — `SubmitStep.tsx`, function-scoped
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ConnectKeyStep,
  type PreselectedKey,
} from "@/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep";
import { MultiKeyConnectStep } from "@/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep";
import { CsvSubmitStep } from "@/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep";
import type { MetadataDraft } from "@/app/(dashboard)/strategies/new/wizard/steps/MetadataStep";
import { _resetWizardCorrelationIdForTests } from "@/lib/wizard/wizard-correlation";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import {
  WIZARD_ERROR_COPY,
  formatKeyError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";

const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const REPO = process.cwd();
const WIZARD_STEPS = join(
  REPO,
  "src/app/(dashboard)/strategies/new/wizard/steps",
);

function stripped(path: string): string {
  return stripCommentsPreserveLines(readFileSync(path, "utf-8"), "ts");
}

// ───────────────────────────────────────────────────────────────────────────
// SOURCE SCANNERS
//
// COPIED WITH ATTRIBUTION from `src/lib/wizardErrors.invariant.test.ts`
// (`deriveRoster` at its `:532`-equivalent, `deriveAliasPairs` below it). They
// are not exported from that file — it is a test module — and re-deriving them
// from memory is how two scanners drift into disagreeing about the same
// declaration. Each carries its own SELF-TEST below, on a hand-built fixture,
// because a scanner that returns `[]` satisfies every "the missing set is
// empty" assertion in this file and would make the whole population vacuous.
// ───────────────────────────────────────────────────────────────────────────

/** The string literals inside a `const <name> ... new Set<...>([ … ])`. */
function deriveRoster(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  const open = openMatch.index;
  const closeMatch = /\]\s*,?\s*\)/.exec(tail.slice(open));
  if (closeMatch === null) return [];
  const block = tail.slice(open, open + closeMatch.index);
  return [...block.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

/** The wire→wizard ALIAS TABLE's pairs, read out of its declaration. */
function deriveAliasPairs(source: string): [string, string][] {
  const start = source.indexOf("const SEAM_CODE_TO_WIZARD_CODE");
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  const open = openMatch.index;
  const closeMatch = /\]\s*,?\s*\)/.exec(tail.slice(open));
  if (closeMatch === null) return [];
  const block = tail.slice(open, open + closeMatch.index);
  return [
    ...block.matchAll(
      /\[\s*"([A-Z][A-Z0-9_]*)"\s*,\s*"([A-Z][A-Z0-9_]*)"\s*\]/g,
    ),
  ].map((m) => [m[1], m[2]] as [string, string]);
}

/**
 * Every `code: "X"` literal on a comment-stripped route source — source (c).
 *
 * ⚠️ DELIBERATELY WIDER THAN `wizardErrors.invariant.test.ts`'s `emitterRe`,
 * and the reason is measured, not stylistic. That scanner requires the literal
 * to be the FIRST key of the first argument of a `NextResponse.json(` call. It
 * derives 13 / 8 / 1 codes on the three key routes — and **ZERO** on
 * `csv-finalize/route.ts`, which answers through `refuse()` / `failClosed()`
 * helpers and object literals whose `code` is not in first position. A
 * population source that returns `[]` on one of its four routes is a blind
 * source, and a blind source in a render sweep is indistinguishable from a
 * route with no defects (the 153.1-01 lesson, stated in that file's
 * `deriveRoster` docblock). Measured 2026-09-06, this scanner derives
 * 14 / 9 / 4 / 6 on the four routes.
 *
 * ⛔ It is deliberately NOT relaxed further: the `[A-Z][A-Z0-9_]*` class keeps a
 * lowercase `draft_state_invalid` VISIBLE as a defect rather than legalising it,
 * and comments are stripped FIRST so the ~40 codes quoted in this repo's route
 * prose do not enter the population. Both properties are self-tested below.
 */
function deriveCodeLiterals(source: string): string[] {
  return [...source.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]*)"/g)].map(
    (m) => m[1],
  );
}

// ───────────────────────────────────────────────────────────────────────────
// THE ALIAS TABLE, AND THE ONE ORACLE THAT DECIDES WHAT A WIRE CODE MUST RENDER
// ───────────────────────────────────────────────────────────────────────────

const WIZARD_ERRORS_SRC = stripped(join(REPO, "src/lib/wizardErrors.ts"));
const ALIAS_PAIRS = deriveAliasPairs(WIZARD_ERRORS_SRC);
const ALIAS = new Map(ALIAS_PAIRS);
const SEAM_KEYS = ALIAS_PAIRS.map(([wire]) => wire);

/**
 * The wizard code a given WIRE code must render as.
 *
 * ⭐ THIS IS THE CONTRACT, NOT A COPY OF ANY HANDLER'S BRANCH ORDER, and the
 * distinction is the difference between an oracle and a tautology. The four
 * surfaces do NOT agree on order — three translate through the alias table
 * first and then membership-check their roster (`ConnectKeyStep`'s
 * `recogniseCreateWithKeyCode`, `MultiKeyConnectStep`'s add-key arm), one
 * membership-checks its roster FIRST and translates second (`CsvSubmitStep`
 * branch 1, whose own comment says *"ORDER IS BINDING"*), and one does not
 * translate at all (`MultiKeyConnectStep`'s `handleContinue`). Re-implementing
 * those four orders here would make every row assert that the code does what
 * the code does.
 *
 * The rule below is the PROPERTY the repo states instead: *"THE NECESSARY
 * PROPERTY IS AGREEMENT"* (`ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`,
 * both correcting an earlier disjointness claim). A wire code is either
 * translated by the ONE shared alias table, or it is already the wizard code.
 * Every overlap on record today is a SELF-MAP, so both orders give the same
 * answer — and if a future alias ever disagrees with a roster, THIS is the file
 * that goes red, which is the behaviour we want.
 *
 * ⚠️ THE RETURN TYPE IS `string`, NOT `WizardErrorCode`, AND THE WIDTH IS THE
 * HONEST ONE. Four of `KNOWN_CSV_FINALIZE_CODES`' five members
 * (`CSV_FINALIZE_FAIL`, `CSV_INVALID_FORMAT`, `CSV_PERSIST_FAIL`,
 * `CSV_SESSION_REUSED`) are deliberately NOT union members — that roster is a
 * `ReadonlySet<string>` and its docblock says the codes travel *"on the wire in
 * its OWN vocabulary"*. Casting them to `WizardErrorCode` here would make the
 * type say something measurably false and would let a copy-table lookup on them
 * typecheck while returning `undefined` at runtime.
 */
function mustRenderAs(wireCode: string): string {
  return ALIAS.get(wireCode) ?? wireCode;
}

/**
 * The status each wire code is delivered on.
 *
 * MEASURED, not decorative: the only two `res.status` reads on any of the four
 * render paths are `ConnectKeyStep.tsx`'s `setReuseRequestShapeRefused(
 * res.status === 400)` (a UI hint, not the code) and `CsvSubmitStep.tsx`'s
 * `res.status === 409 && data.ok === true` idempotent-success guard (which no
 * row below trips — none sends `ok: true`). So no row's RENDERED CODE depends
 * on this number; it is chosen to be a plausible refusal status for the family
 * so the fixture reads honestly, and `!res.ok` is the only property the
 * handlers actually branch on.
 */
const STATUS_BY_FAMILY: readonly [RegExp, number][] = [
  [/^(RATE_LIMITED|KEY_RATE_LIMIT|CSV_RATE_LIMIT)$/, 429],
  [
    /^(DRAFT_ALREADY_EXISTS|DRAFT_SESSION_COLLISION|VENUE_ALREADY_CONNECTED|KEY_ORPHANED|KEY_REUSE_UNAVAILABLE|STALE_CLIENT|CSV_SESSION_REUSED)$/,
    409,
  ],
  [/^(SEAM_MISCONFIGURED|CIRCUIT_OPEN|SERVICE_UNAVAILABLE_RETRY)$/, 503],
  [/^(UPSTREAM_TIMEOUT|UPSTREAM_NETWORK_ERROR|SERVICE_UNREACHABLE)$/, 504],
  [
    /^(CSV_FINALIZE_FAIL|CSV_PERSIST_FAIL|SEAM_INTERNAL_FAULT|GUARD_BLOCKED)$/,
    500,
  ],
];
function statusFor(wireCode: string): number {
  for (const [re, status] of STATUS_BY_FAMILY)
    if (re.test(wireCode)) return status;
  return 400;
}

// ───────────────────────────────────────────────────────────────────────────
// THE FOUR SURFACES
// ───────────────────────────────────────────────────────────────────────────

type SurfaceId =
  "connect-key" | "multi-key-add" | "multi-key-set-members" | "csv-submit";

interface SurfaceUnderTest {
  readonly id: SurfaceId;
  /** The file declaring the roster this surface membership-checks. */
  readonly rosterFile: string;
  readonly rosterName: string;
  /** The route whose `!res.ok` body this surface classifies. */
  readonly routeFile: string;
  /**
   * Whether this surface consults `SEAM_CODE_TO_WIZARD_CODE` at all.
   *
   * ⚠️ HAND-TYPED, AND IT SCOPES SOURCE (a). A seam wire code is only a code
   * "the wizard can surface" on a surface that consults the table: `handleContinue`
   * (set-members) reads `data.code && KNOWN_SET_MEMBERS_CODES.has(data.code)`
   * and falls straight to `"UNKNOWN"` with no translate hop, so `CIRCUIT_OPEN`
   * on that surface renders the UNKNOWN card by design — and its route emits no
   * such code (measured: `composite/set-members/route.ts` emits GUARD_BLOCKED,
   * MULTI_KEY_WINDOWS_INVALID, RATE_LIMITED, UNKNOWN and nothing else). Pushing
   * the seam keys onto it would manufacture a red row for a body no server
   * sends. The value is pinned by `seamHopCensus` below, which reds if a
   * surface silently gains or loses its translate hop.
   */
  readonly consultsSeamMap: boolean;
  /**
   * HAND-TYPED floors, measured at authoring 2026-09-06.
   *
   * ⚠️ NEVER `derived.length`. A size compared against its own derivation
   * cannot fail — delete the roster and both sides go to zero together. Same
   * Oracle-Independence rule `wizardErrors.invariant.test.ts` states for
   * `expectedSites`, and the same live precedent behind it.
   */
  readonly rosterFloor: number;
  readonly literalFloor: number;
  readonly populationFloor: number;
}

const SURFACES: readonly SurfaceUnderTest[] = [
  {
    id: "connect-key",
    rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
    rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
    routeFile: join(REPO, "src/app/api/strategies/create-with-key/route.ts"),
    consultsSeamMap: true,
    // 31 roster members, 14 distinct route literals, 36 population rows after
    // de-duplication and after dropping UNKNOWN.
    rosterFloor: 28,
    literalFloor: 12,
    populationFloor: 34,
  },
  {
    id: "multi-key-add",
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_ADD_KEY_CODES",
    routeFile: join(REPO, "src/app/api/strategies/composite/add-key/route.ts"),
    consultsSeamMap: true,
    // 26 roster members, 9 distinct route literals, 31 population rows.
    rosterFloor: 23,
    literalFloor: 8,
    populationFloor: 28,
  },
  {
    id: "multi-key-set-members",
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_SET_MEMBERS_CODES",
    routeFile: join(
      REPO,
      "src/app/api/strategies/composite/set-members/route.ts",
    ),
    consultsSeamMap: false,
    // 5 roster members, 4 distinct route literals, 4 population rows.
    rosterFloor: 4,
    literalFloor: 3,
    populationFloor: 4,
  },
  {
    id: "csv-submit",
    rosterFile: join(WIZARD_STEPS, "CsvSubmitStep.tsx"),
    rosterName: "KNOWN_CSV_FINALIZE_CODES",
    routeFile: join(REPO, "src/app/api/strategies/csv-finalize/route.ts"),
    consultsSeamMap: true,
    // 5 roster members, 6 distinct route literals, 11 population rows.
    rosterFloor: 4,
    literalFloor: 5,
    populationFloor: 10,
  },
];

// ───────────────────────────────────────────────────────────────────────────
// THE POPULATION
// ───────────────────────────────────────────────────────────────────────────

type PopulationSource = "seam-map" | "roster" | "route-literal";

interface PopulationRow {
  readonly surface: SurfaceId;
  readonly wireCode: string;
  /** See `mustRenderAs` for why this is `string` and not `WizardErrorCode`. */
  readonly expectedCode: string;
  readonly status: number;
  /** Every source that contributed this (surface, wireCode) pair. */
  readonly sources: readonly PopulationSource[];
  /**
   * Which channel renders the headline sentence on this row.
   *
   * `"copy"` — the surface builds the envelope from the code
   * (`buildEnvelope(code, …)` → `human_message: formatKeyError(code).title`),
   * so the copy table's title is what a reader sees.
   *
   * `"wire-prose"` — `CsvSubmitStep`'s BRANCH 1, and only it. That branch
   * forwards the SERVER's own sentence
   * (`data.human_message ?? data.error ?? WIZARD_ERROR_COPY.CSV_SUBMIT_FAILED.title`)
   * rather than the code's copy, deliberately: those five codes carry curated
   * per-arm sentences that the shared table cannot state (the route's
   * `CSV_PERSIST_FAIL` sentence declines to claim "Nothing was saved", which
   * the generic entry asserts). ⛔ So on those rows the copy-title assertion is
   * NOT skipped in favour of nothing — it is replaced by the assertion that the
   * SERVER's sentence reached the reader, beside the same `data-error-code` and
   * same UNKNOWN-absence checks every other row makes.
   */
  readonly titleChannel: "copy" | "wire-prose";
}

/** Roster membership per surface, derived once. */
const ROSTERS: ReadonlyMap<SurfaceId, readonly string[]> = new Map(
  SURFACES.map((s) => [
    s.id,
    deriveRoster(stripped(s.rosterFile), s.rosterName),
  ]),
);

/** Route `code:` literals per surface, derived once. */
const ROUTE_LITERALS: ReadonlyMap<SurfaceId, readonly string[]> = new Map(
  SURFACES.map((s) => [s.id, deriveCodeLiterals(stripped(s.routeFile))]),
);

/**
 * ⛔ `UNKNOWN` IS THE TERMINAL, NOT A MEMBER. It is a roster member on three of
 * the four surfaces and a route literal on all four, and it must not enter the
 * population: a row asserting "UNKNOWN renders as UNKNOWN and never UNKNOWN" is
 * a contradiction, and one asserting "UNKNOWN renders as UNKNOWN" would be the
 * one green row that proves the classification is broken. Its exclusion is
 * asserted by its own test below rather than left to this filter.
 */
const TERMINAL = "UNKNOWN";

const POPULATION: readonly PopulationRow[] = (() => {
  const byKey = new Map<
    string,
    { row: PopulationRow; sources: Set<PopulationSource> }
  >();

  function add(surface: SurfaceId, wireCode: string, source: PopulationSource) {
    if (wireCode === TERMINAL) return;
    const key = `${surface}::${wireCode}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sources.add(source);
      return;
    }
    const rosterHere = ROSTERS.get(surface) ?? [];
    byKey.set(key, {
      sources: new Set([source]),
      row: {
        surface,
        wireCode,
        expectedCode: mustRenderAs(wireCode),
        status: statusFor(wireCode),
        sources: [],
        titleChannel:
          surface === "csv-submit" && rosterHere.includes(wireCode)
            ? "wire-prose"
            : "copy",
      },
    });
  }

  for (const s of SURFACES) {
    // (a) seam-map keys, on the surfaces that consult the table.
    if (s.consultsSeamMap)
      for (const wire of SEAM_KEYS) add(s.id, wire, "seam-map");
    // (b) the surface's own roster.
    for (const member of ROSTERS.get(s.id) ?? []) add(s.id, member, "roster");
    // (c) the route's own `code:` literals.
    for (const lit of ROUTE_LITERALS.get(s.id) ?? [])
      add(s.id, lit, "route-literal");
  }

  return [...byKey.values()].map(({ row, sources }) => ({
    ...row,
    sources: [...sources],
  }));
})();

/**
 * ⭐ HAND-TYPED, MEASURED 2026-09-06 AT AUTHORING, NEVER `POPULATION.length`.
 *
 * 36 (connect-key) + 31 (multi-key-add) + 4 (set-members) + 11 (csv-submit)
 * = 82, floored a little under at 78 so an honest single-code removal does not
 * red while a source going blind does. ⛔ A derivation compared against its own
 * length cannot fail: blind every regex in this file and both sides reach zero
 * together, which is the exact vacuity this literal exists to catch.
 *
 * ⚠️ AND THIS FLOOR ALONE IS NOT ENOUGH, WHICH IS WHY IT IS NOT ALONE. It was
 * typed AFTER measuring, so it cannot catch a source that was ALREADY blind at
 * authoring time — 83 would have been typed as (say) 76 and passed. The
 * per-source, per-surface non-zero controls below are what cover that, and each
 * one is proven able to fire by a scanner self-test on a hand-built fixture.
 */
const EXPECTED_POPULATION_MIN = 78;

// ───────────────────────────────────────────────────────────────────────────
// RENDER HARNESSES — one per surface, each driving the REAL component through
// its REAL fetch path to its REAL refusal render.
// ───────────────────────────────────────────────────────────────────────────

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * The prose the server sends alongside the code, distinct per row so a
 * `wire-prose` assertion cannot pass on a neighbour's sentence.
 */
function wireProseFor(wireCode: string): string {
  return `Server sentence for ${wireCode}, sent on the wire.`;
}

const SESSION = "11111111-1111-4111-8111-111111111111";
const STRATEGY_ID = "22222222-2222-4222-8222-222222222222";
const API_KEY_ID = "33333333-3333-4333-8333-333333333333";

const PRESELECT: PreselectedKey = {
  id: "55555555-5555-5555-5555-555555555555",
  exchange: "bybit",
  exchangeLabel: "Bybit",
  keyLabel: "Zavara main",
};

/**
 * `ConnectKeyStep`'s saved-key summary, copied from
 * `ConnectKeyStep.preselect-refusal-class.test.tsx`'s `PreselectHost`.
 *
 * The reuse arm and the credential arm share ONE classifier
 * (`recogniseCreateWithKeyCode`, extracted in 162-05 precisely so a second
 * hand-written copy of an order-sensitive translation could not exist), and the
 * reuse arm reaches a refusal render in two clicks against one mocked POST.
 */
function PreselectHost() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <ConnectKeyStep
      wizardSessionId={SESSION}
      onSuccess={vi.fn()}
      preselectKey={dismissed ? null : PRESELECT}
      onUseDifferentKey={() => setDismissed(true)}
    />
  );
}

async function renderConnectKeyRefusal(
  row: PopulationRow,
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(
      { code: row.wireCode, error: wireProseFor(row.wireCode) },
      row.status,
    ),
  );
  render(<PreselectHost />);
  fireEvent.click(screen.getByTestId("wizard-preselect-continue"));
  return screen.findByTestId("error-envelope");
}

/**
 * `MultiKeyConnectStep`'s PER-PANEL validate arm (`composite/add-key`).
 * Copied from `MultiKeyConnectStep.test.tsx`'s `fillPanel1`.
 */
async function renderMultiKeyAddRefusal(
  row: PopulationRow,
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(
      { code: row.wireCode, error: wireProseFor(row.wireCode) },
      row.status,
    ),
  );
  render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
  fireEvent.click(screen.getByTestId("multi-add-key"));
  const panel1 = screen.getByTestId("key-panel-1");
  fireEvent.change(within(panel1).getByTestId("key-1-api-key"), {
    target: { value: "AK_LIVE_key2" },
  });
  fireEvent.change(within(panel1).getByTestId("key-1-api-secret"), {
    target: { value: "SECRET_key2" },
  });
  fireEvent.change(within(panel1).getByTestId("key-1-window-start"), {
    target: { value: "2024-01-01" },
  });
  fireEvent.click(within(panel1).getByTestId("key-1-validate"));
  return within(screen.getByTestId("key-panel-1")).findByTestId(
    "error-envelope",
  );
}

/**
 * `MultiKeyConnectStep`'s STEP-LEVEL Continue arm (`composite/set-members`).
 * Copied from `MultiKeyConnectStep.test.tsx`'s set-members 429 case, including
 * its adjacent-CLOSED-windows note: an open-ended pair overlaps, which disables
 * Continue and would make every row here pass without ever issuing the request.
 */
async function renderSetMembersRefusal(
  row: PopulationRow,
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("composite/add-key")) {
        return jsonResponse(
          { ok: true, strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID },
          200,
        );
      }
      if (url.includes("composite/set-members")) {
        return jsonResponse(
          { code: row.wireCode, error: wireProseFor(row.wireCode) },
          row.status,
        );
      }
      return jsonResponse({}, 200);
    },
  );
  render(<MultiKeyConnectStep wizardSessionId={SESSION} onSuccess={vi.fn()} />);
  fireEvent.click(screen.getByTestId("multi-add-key"));
  for (const [idx, start, end] of [
    [0, "2024-01-01", "2024-06-01"],
    [1, "2024-06-01", "2024-09-01"],
  ] as const) {
    const panel = screen.getByTestId(`key-panel-${idx}`);
    fireEvent.change(within(panel).getByTestId(`key-${idx}-api-key`), {
      target: { value: `AK_LIVE_${idx}` },
    });
    fireEvent.change(within(panel).getByTestId(`key-${idx}-api-secret`), {
      target: { value: `SECRET_${idx}` },
    });
    fireEvent.change(within(panel).getByTestId(`key-${idx}-window-start`), {
      target: { value: start },
    });
    fireEvent.change(within(panel).getByTestId(`key-${idx}-window-end`), {
      target: { value: end },
    });
    fireEvent.click(within(panel).getByTestId(`key-${idx}-validate`));
    await waitFor(() =>
      expect(screen.getByTestId(`key-${idx}-summary`)).toBeInTheDocument(),
    );
  }
  const cont = screen.getByTestId("multi-continue");
  expect(
    cont,
    "Continue is disabled, so this row would pass without ever issuing the " +
      "set-members request — the windows fixture has drifted.",
  ).not.toBeDisabled();
  fireEvent.click(cont);
  return screen.findByTestId("error-envelope");
}

const CSV_META: MetadataDraft = {
  name: null,
  description: "164.2-09 roster-render coverage",
  categoryId: "cat_test",
  strategyTypes: ["systematic"],
  subtypes: [],
  markets: ["crypto"],
  supportedExchanges: ["Bybit"],
  leverageRange: "1x-3x",
  aum: "1000000",
  maxCapacity: "5000000",
  assetClass: "crypto",
};

const CSV_PREVIEW = {
  row_count: 3,
  date_range: ["2024-01-01", "2024-01-03"] as [string, string],
  columns_detected: ["date", "daily_return"],
  first_rows: [{ date: "2024-01-01", daily_return: 0.01 }],
  last_rows: [{ date: "2024-01-03", daily_return: -0.005 }],
};

/**
 * `CsvSubmitStep`'s submit arm (`csv-finalize`). Copied from
 * `CsvSubmitStep.upstream-arm.test.tsx`'s `mountAndSubmit`.
 *
 * ⚠️ TWO ENVELOPES, ONE SURFACE, AND WHICH ONE APPEARS *IS* THE ASSERTION.
 * Branch 1 (roster) renders `CsvValidationEnvelope` at `wizard-csv-error`;
 * branches 2 and 3 (translate / terminal) render the shared `ErrorEnvelope` at
 * `error-envelope`. Both carry `data-error-code`, so the harness returns
 * whichever appeared and the row's code assertion reads the same attribute
 * either way — a roster row that stops being a roster row moves envelopes AND
 * changes the code, and the row reds on the code.
 */
async function renderCsvSubmitRefusal(
  row: PopulationRow,
): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(
      { code: row.wireCode, error: wireProseFor(row.wireCode) },
      row.status,
    ),
  );
  render(
    <CsvSubmitStep
      wizardSessionId="22222222-2222-2222-2222-222222222222"
      fmt="daily_returns"
      strategyName="Aurora Capital"
      preview={CSV_PREVIEW}
      dailyReturnsSeries={[{ date: "2024-01-01", daily_return: 0.01 }]}
      metadata={CSV_META}
      onSubmitted={() => {}}
      onStartNewStrategy={() => {}}
      onBack={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("wizard-csv-submit-cta"));
  await waitFor(() => {
    const found =
      screen.queryByTestId("wizard-csv-error") ??
      screen.queryByTestId("error-envelope");
    expect(
      found,
      "Neither CSV envelope appeared — the submit never reached a refusal " +
        "render, so nothing below is measuring the classification.",
    ).not.toBeNull();
  });
  return (screen.queryByTestId("wizard-csv-error") ??
    screen.getByTestId("error-envelope")) as HTMLElement;
}

const HARNESS: Record<SurfaceId, (row: PopulationRow) => Promise<HTMLElement>> =
  {
    "connect-key": renderConnectKeyRefusal,
    "multi-key-add": renderMultiKeyAddRefusal,
    "multi-key-set-members": renderSetMembersRefusal,
    "csv-submit": renderCsvSubmitRefusal,
  };

/**
 * The SECOND signal, read the way `SubmitStep.test.tsx:78-83`'s
 * `findWizardError` reads it: off `trackForQuantsEventClient`'s call log — the
 * ANALYTICS payload, not the DOM.
 */
function trackedWizardErrorCode(): string | undefined {
  const calls = trackMock.mock.calls.filter((c) => c[0] === "wizard_error");
  const last = calls[calls.length - 1];
  return last?.[1]?.code as string | undefined;
}

const UNKNOWN_TITLE = WIZARD_ERROR_COPY.UNKNOWN.title;

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TESTS — every scanner proven able to see, and able to MISS.
// ═══════════════════════════════════════════════════════════════════════════

describe("[164.2-09] the population's scanners are not blind", () => {
  it("deriveRoster reads a real multi-line Set declaration and stops at its close", () => {
    const fixture = `
const KNOWN_FIXTURE_CODES: ReadonlySet<string> =
  new Set<string>([
    "ALPHA",
    "BETA",
  ]);
const KNOWN_OTHER_CODES: ReadonlySet<string> = new Set<string>(["GAMMA"]);
`;
    expect(deriveRoster(fixture, "KNOWN_FIXTURE_CODES")).toEqual([
      "ALPHA",
      "BETA",
    ]);
    expect(
      deriveRoster(fixture, "KNOWN_MISSING_CODES"),
      "A roster name that does not exist must derive [] — that is what makes " +
        "the non-zero floors below able to fire.",
    ).toEqual([]);
  });

  it("deriveAliasPairs reads pairs and stops at the map's close", () => {
    const fixture = `
const SEAM_CODE_TO_WIZARD_CODE: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["WIRE_A", "WIZ_A"],
  ["WIRE_B", "WIZ_B"],
]);
export function recogniseSeamErrorCode() { return "NOT_A_PAIR"; }
`;
    expect(deriveAliasPairs(fixture)).toEqual([
      ["WIRE_A", "WIZ_A"],
      ["WIRE_B", "WIZ_B"],
    ]);
  });

  it("deriveCodeLiterals sees a helper-call emitter, and both of its exclusions bite", () => {
    const fixture = stripCommentsPreserveLines(
      [
        '// A quoted code in PROSE must not enter: code: "COMMENT_ONLY"',
        'return refuse(409, { message: m, code: "CSV_SESSION_REUSED" });',
        'return NextResponse.json({ code: "KEY_ORPHANED", error: e }, { status: 409 });',
        'return json({ code: "draft_state_invalid" });',
      ].join("\n"),
      "ts",
    );
    const found = deriveCodeLiterals(fixture);
    // It SEES the helper-call emitter `emitterRe` cannot — the whole reason
    // source (c) uses this scanner and not that one.
    expect(found).toContain("CSV_SESSION_REUSED");
    expect(found).toContain("KEY_ORPHANED");
    // Exclusion 1: comment prose. Exclusion 2: a lowercase code stays VISIBLE
    // as a defect rather than being legalised into the population.
    expect(found).not.toContain("COMMENT_ONLY");
    expect(found).not.toContain("draft_state_invalid");
    expect(found).toHaveLength(2);
  });

  it("the alias table and every roster derived NON-EMPTY from the real sources", () => {
    expect(
      SEAM_KEYS.length,
      "SEAM_CODE_TO_WIZARD_CODE derived empty. Every seam-map row in the " +
        "population would silently vanish and the sweep would pass by " +
        "measuring nothing.",
    ).toBeGreaterThanOrEqual(7);
    for (const s of SURFACES) {
      expect(
        (ROSTERS.get(s.id) ?? []).length,
        `${s.rosterName} derived ${(ROSTERS.get(s.id) ?? []).length} members ` +
          `(floor ${s.rosterFloor}). A roster that parses short takes its ` +
          "codes out of the population without reddening a single row.",
      ).toBeGreaterThanOrEqual(s.rosterFloor);
      expect(
        (ROUTE_LITERALS.get(s.id) ?? []).length,
        `${s.id}'s route derived ${(ROUTE_LITERALS.get(s.id) ?? []).length} ` +
          `code literals (floor ${s.literalFloor}).`,
      ).toBeGreaterThanOrEqual(s.literalFloor);
    }
  });

  it("seam-hop census: the hand-typed `consultsSeamMap` matches the source", () => {
    // The translate hop is `recogniseSeamErrorCode(seamErrorCode(...))` in
    // every case. Read off the SURFACE file, per handler, so a surface that
    // gains or loses the hop moves this census rather than silently changing
    // what source (a) means.
    const census: Record<SurfaceId, boolean> = {
      "connect-key": stripped(
        join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
      ).includes("recogniseSeamErrorCode(seamErrorCode("),
      "multi-key-add": stripped(
        join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
      ).includes("recogniseSeamErrorCode(seamErrorCode("),
      // handleContinue's own branch, read as a whole line: it membership-checks
      // the roster and has no translate hop of its own.
      "multi-key-set-members":
        /recogniseSeamErrorCode[\s\S]{0,200}?KNOWN_SET_MEMBERS_CODES/.test(
          stripped(join(WIZARD_STEPS, "MultiKeyConnectStep.tsx")),
        ),
      "csv-submit": stripped(join(WIZARD_STEPS, "CsvSubmitStep.tsx")).includes(
        "recogniseSeamErrorCode(seamErrorCode(",
      ),
    };
    for (const s of SURFACES) {
      expect(
        census[s.id],
        `${s.id}'s translate hop moved. Source (a) is scoped by this flag, so ` +
          "re-measure before changing the literal.",
      ).toBe(s.consultsSeamMap);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOORS AND THE TERMINAL
// ═══════════════════════════════════════════════════════════════════════════

describe("[164.2-09] the population is real, whole, and excludes the terminal", () => {
  it("clears the hand-typed floor", () => {
    expect(
      POPULATION.length,
      `The population derived ${POPULATION.length} rows against a hand-typed ` +
        `floor of ${EXPECTED_POPULATION_MIN}. Either a source went blind or ` +
        "codes were removed. ⛔ Do NOT lower the floor to make this pass — " +
        "find out which of the three sources shrank.",
    ).toBeGreaterThanOrEqual(EXPECTED_POPULATION_MIN);
  });

  it("every surface, and every source, contributes — none is silently empty", () => {
    for (const s of SURFACES) {
      const rows = POPULATION.filter((r) => r.surface === s.id);
      expect(
        rows.length,
        `${s.id} contributed ${rows.length} rows (floor ${s.populationFloor}).`,
      ).toBeGreaterThanOrEqual(s.populationFloor);
      for (const source of ["roster", "route-literal"] as const) {
        expect(
          rows.filter((r) => r.sources.includes(source)).length,
          `${s.id} contributed ZERO rows from source "${source}".`,
        ).toBeGreaterThan(0);
      }
      if (s.consultsSeamMap) {
        expect(
          rows.filter((r) => r.sources.includes("seam-map")).length,
          `${s.id} consults the alias table but contributed ZERO seam-map rows.`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("⛔ UNKNOWN is the terminal, not a member", () => {
    expect(
      POPULATION.filter((r) => r.wireCode === TERMINAL),
      "UNKNOWN entered the population. A row asserting it renders as itself " +
        "and never as itself is a contradiction, and the only way to make it " +
        "green is to weaken the UNKNOWN-absence assertion for every row.",
    ).toEqual([]);
    expect(POPULATION.filter((r) => r.expectedCode === TERMINAL)).toEqual([]);
    // And the exclusion is a filter doing work, not an accident of the sources:
    // UNKNOWN really is present in what the sources derive.
    const rawSources = SURFACES.flatMap((s) => [
      ...(ROSTERS.get(s.id) ?? []),
      ...(ROUTE_LITERALS.get(s.id) ?? []),
    ]);
    expect(
      rawSources,
      "UNKNOWN is no longer in ANY roster or route literal, so the filter " +
        "above stopped excluding anything — re-check before trusting it.",
    ).toContain(TERMINAL);
  });

  it("every COPY-channel code has copy, and its TITLE does not move under context", () => {
    const copyRows = POPULATION.filter((r) => r.titleChannel === "copy");
    // The filter is not a narrowing dodge: `wire-prose` rows are excluded
    // because the copy table is NOT their render channel, and the case below
    // pins exactly which codes that is and why. Positive control so the filter
    // cannot quietly empty the population it guards.
    expect(copyRows.length).toBeGreaterThanOrEqual(EXPECTED_POPULATION_MIN - 6);
    for (const row of copyRows) {
      const code = row.expectedCode as WizardErrorCode;
      expect(
        WIZARD_ERROR_COPY[code],
        `${row.surface}/${row.wireCode} expects ${row.expectedCode}, which has ` +
          "no entry in WIZARD_ERROR_COPY — formatKeyError would return the " +
          "UNKNOWN card for it, which IS the WIZFORM-02 defect.",
      ).toBeDefined();
      // The copy-title assertion in the sweep calls formatKeyError with NO
      // context. Three arms of that function interpolate the TITLE (sizeMb,
      // charCount, an issue count); none of their codes is in this population
      // today, and this control is what tells the next author if one arrives.
      expect(
        formatKeyError(code, {
          retryAfterSeconds: 5,
          surface: "connect",
          venue: "bybit",
        }).title,
        `${row.expectedCode}'s title interpolates context. The row assertions ` +
          "read formatKeyError(code).title with no context, so this row would " +
          "compare the wrong sentence — pass the surface's real context here.",
      ).toBe(formatKeyError(code).title);
    }
  });

  it("no COPY-channel code shares the UNKNOWN title — the absence check is decidable", () => {
    for (const row of POPULATION.filter((r) => r.titleChannel === "copy")) {
      expect(
        formatKeyError(row.expectedCode as WizardErrorCode).title,
        `${row.expectedCode} renders the same headline as UNKNOWN, so the ` +
          "per-row `queryByText(UNKNOWN_TITLE)` check cannot tell a correct " +
          "render from the generic card.",
      ).not.toBe(UNKNOWN_TITLE);
    }
  });

  /**
   * ⭐ WHY FOUR ROWS ARE EXEMPT FROM THE TWO CONTROLS ABOVE, MEASURED RATHER
   * THAN ASSERTED IN PROSE.
   *
   * `KNOWN_CSV_FINALIZE_CODES` is a `ReadonlySet<string>`, not a
   * `ReadonlySet<WizardErrorCode>`, and its docblock says why: those codes
   * travel *"on the wire in its OWN vocabulary and are not members of that
   * union"*. `CsvSubmitStep`'s branch 1 therefore renders the SERVER's sentence
   * (`data.human_message ?? data.error ?? …`) — there is no copy entry to
   * render. Four of the five are outside the union; `SEAM_MISCONFIGURED` is the
   * one that is inside it, and it is a branch-1 row all the same because the
   * roster is consulted BEFORE the alias table on that surface.
   *
   * ⛔ SO THE EXEMPTION IS SIZED AND NAMED, NOT OPEN-ENDED. If a fifth code
   * joins that roster, or if one of these four gains copy, this case reds and
   * the author has to decide which channel the row belongs on rather than
   * inheriting an exemption that quietly widened.
   */
  it("the wire-prose rows are exactly the CSV branch-1 roster, and 4 of 5 have no union copy", () => {
    const proseRows = POPULATION.filter((r) => r.titleChannel === "wire-prose");
    expect(proseRows.every((r) => r.surface === "csv-submit")).toBe(true);
    expect(
      proseRows.map((r) => r.wireCode).sort(),
      "The CSV branch-1 roster moved. Re-measure which of its members carry " +
        "union copy before widening the exemption.",
    ).toEqual([
      "CSV_FINALIZE_FAIL",
      "CSV_INVALID_FORMAT",
      "CSV_PERSIST_FAIL",
      "CSV_SESSION_REUSED",
      "SEAM_MISCONFIGURED",
    ]);
    const withoutCopy = proseRows
      .filter(
        (r) =>
          (WIZARD_ERROR_COPY as Record<string, unknown>)[r.expectedCode] ===
          undefined,
      )
      .map((r) => r.wireCode)
      .sort();
    expect(withoutCopy).toEqual([
      "CSV_FINALIZE_FAIL",
      "CSV_INVALID_FORMAT",
      "CSV_PERSIST_FAIL",
      "CSV_SESSION_REUSED",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE FIFTH SURFACE — excluded, and the exclusion is asserted, not narrated.
// ═══════════════════════════════════════════════════════════════════════════

describe("[164.2-09] the FIFTH surface is excluded, and the blocker is measured", () => {
  const CONSUMERS = [
    "src/components/strategy/ApiKeyManager.tsx",
    "src/components/strategy/StrategyForm.tsx",
    "src/components/exchanges/AllocatorExchangeManager.tsx",
  ];

  it("keys/validate-and-encrypt has no code-channel reader, so it cannot be a render row", () => {
    // The three POSTers, enumerated by grep over src/ (this list is pinned by
    // the case below, which reds if a fourth appears).
    for (const rel of CONSUMERS) {
      const src = stripped(join(REPO, rel));
      expect(
        src,
        `${rel} POSTs to keys/validate-and-encrypt; confirm before reading the ` +
          "code-channel claim below.",
      ).toContain("/api/keys/validate-and-encrypt");
      // ⭐ THE BLOCKER. Each consumer reads the PROSE (`err.error` /
      // `result.error`) and never the machine code, so there is no
      // code→WIZARD_ERROR_COPY render path on this surface at all. Asserting a
      // title here would mean feeding the title in as the wire prose and
      // reading it back — the tautology this file refuses.
      expect(
        /\b(err|result|data|body)\.code\b/.test(src),
        `${rel} has started reading the validate-and-encrypt response's \`code\` ` +
          "field. ⭐ THAT IS GOOD NEWS AND IT INVALIDATES THIS EXCLUSION: the " +
          "surface now has a code→copy render path, so add it to SURFACES with " +
          "a real harness and delete this case. See `## Surfaces not rendered` " +
          "in 164.2-09-SUMMARY.md.",
      ).toBe(false);
    }
  });

  it("the consumer census is complete — a FOURTH poster would go unmeasured", () => {
    // Every source file under src/ that POSTs to the route, comment-stripped so
    // the ~20 files that merely NAME it in prose do not count.
    const posters = CONSUMERS.length;
    expect(
      posters,
      "Hand-typed at 3 (measured 2026-09-06). If a fourth consumer appears it " +
        "must be added to CONSUMERS above, or the blocker claim covers only " +
        "three of four.",
    ).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ THE SWEEP.
// ═══════════════════════════════════════════════════════════════════════════

describe("[164.2-09 / WIZFORM-02] every server-classified code renders as itself", () => {
  beforeEach(() => {
    trackMock.mockClear();
    _resetWizardCorrelationIdForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it.each(
    POPULATION.map(
      (row) =>
        [`${row.surface}/${row.wireCode}`, row] as [string, PopulationRow],
    ),
  )(
    "%s renders its own code, never the UNKNOWN card",
    async (_label, row) => {
      const envelope = await HARNESS[row.surface](row);

      // ── ORACLE 1, THE DOM, AND IT IS FIRST ON PURPOSE. vitest aborts a test
      // at its first failing assertion, so whichever assertion runs first is
      // the one a failure NAMES. Criterion 3's subject is the rendered
      // surface; the telemetry read below is the second signal and must never
      // be the one that fails.
      expect(
        envelope.getAttribute("data-error-code"),
        `${row.surface} rendered ${envelope.getAttribute("data-error-code")} ` +
          `for wire code ${row.wireCode}, which must surface as ` +
          `${row.expectedCode}. Either the alias table lost its row, the ` +
          "surface's roster lost this member, or the surface stopped " +
          "classifying — see the failure's own attribute value for which.",
      ).toBe(row.expectedCode);

      // ── ORACLE 2: the headline sentence a reader actually reads.
      if (row.titleChannel === "copy") {
        expect(
          envelope.textContent,
          `${row.surface}/${row.wireCode}: the code reached the envelope but ` +
            `the copy for ${row.expectedCode} did not reach the DOM.`,
        ).toContain(formatKeyError(row.expectedCode as WizardErrorCode).title);
      } else {
        expect(
          envelope.textContent,
          `${row.surface}/${row.wireCode}: this is a CsvSubmitStep branch-1 ` +
            "row, so the SERVER's own sentence is what must render — the " +
            "shared copy table cannot state these five arms' claims.",
        ).toContain(wireProseFor(row.wireCode));
      }

      // ── ORACLE 3: the UNKNOWN card is nowhere on the screen.
      expect(
        screen.queryByText(UNKNOWN_TITLE),
        `${row.surface}/${row.wireCode} rendered "${UNKNOWN_TITLE}" — the ` +
          "generic card, for a failure the server named precisely. This is " +
          "the WIZFORM-02 defect itself.",
      ).toBeNull();

      // ── THE SECOND SIGNAL, and only now. It reads trackMock's call log —
      // the analytics payload — not the DOM.
      expect(trackedWizardErrorCode()).toBe(row.expectedCode);
      expect(trackedWizardErrorCode()).not.toBe(TERMINAL);
    },
    15000,
  );

  /**
   * ⭐ THE PROD REPRODUCTION, NAMED.
   *
   * 2026-08-25, PROD: `POST /api/keys/validate-and-encrypt` answered a bare
   * upstream 401 as `{"error":"Unauthorized","code":"UNKNOWN"}` — the seam-level
   * `?? "UNKNOWN"` for an envelope that carried no code of its own. 164.2-05
   * closed it AT THE ROUTE with `UPSTREAM_STATUS_TO_SEAM_CODE` (401/403 →
   * `SEAM_MISCONFIGURED`).
   *
   * ⚠️ AND IT IS RENDERED HERE ON `connect-key`, NOT ON THE ROUTE'S OWN
   * SURFACE, because that surface has no code-channel reader (the describe
   * above). `SEAM_MISCONFIGURED` at 401 is what a wizard step now receives for
   * this failure, and this case proves a wizard step renders it as itself — the
   * half of the fix that is about what the reader sees.
   */
  it("⭐ THE 2026-08-25 PROD ROW: a bare-401 SEAM_MISCONFIGURED renders as itself", async () => {
    const row: PopulationRow = {
      surface: "connect-key",
      wireCode: "SEAM_MISCONFIGURED",
      expectedCode: "SEAM_MISCONFIGURED",
      status: 401,
      sources: ["seam-map"],
      titleChannel: "copy",
    };
    const envelope = await renderConnectKeyRefusal(row);
    expect(envelope).toHaveAttribute("data-error-code", "SEAM_MISCONFIGURED");
    expect(envelope.textContent).toContain(
      formatKeyError("SEAM_MISCONFIGURED").title,
    );
    expect(screen.queryByText(UNKNOWN_TITLE)).toBeNull();
    expect(trackedWizardErrorCode()).toBe("SEAM_MISCONFIGURED");
  }, 15000);
});
