/**
 * Phase 140.5-03 / SEAMPROSE-03 — NO WIZARD TRANSPORT CATCH MAY ASSERT A VENUE
 * FAULT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROPERTY
 * ═══════════════════════════════════════════════════════════════════════════
 * `KEY_NETWORK_TIMEOUT`'s copy is *"We could not reach the exchange."* A `catch`
 * around a `wizardFetch` fires when the request to **our own route** never
 * completed — one hop from the browser, with the exchange very possibly never
 * contacted at all. Setting that code there asserts a VENUE fault for a fault on
 * OUR hop. `wizardErrors.ts` states the rule by name beside the entry:
 *
 *   > "KEY_NETWORK_TIMEOUT — we could not reach the EXCHANGE. Reusing it here
 *   >  would assert a venue fault for a fault on our own hop, which is exactly
 *   >  the 'copy that asserts something false' class this phase exists to kill."
 *
 * The rule was written down and then broken at five sites. This guard is what
 * makes it hold rather than be narrated.
 *
 * ⚠️ THE CODE ITSELF IS NOT BANNED — only its use INSIDE A CATCH BODY. The
 * routes genuinely do emit `KEY_NETWORK_TIMEOUT` when the server-side exchange
 * probe times out, which is a real venue fault, so it is a legitimate member of
 * `KNOWN_CREATE_WITH_KEY_CODES`, `KNOWN_ADD_KEY_CODES` and
 * `KNOWN_FINALIZE_CODES`. Those rosters sit outside every catch body and are
 * deliberately untouched by this scan. A file-level `grep` would ban them and
 * would be wrong.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A DERIVED POPULATION (coverage-law row 1 over this directory)
 * ═══════════════════════════════════════════════════════════════════════════
 * `140-SYNTHESIS.md` named **three** transport catches — `ConnectKeyStep`,
 * `SubmitStep`, `SyncPreviewStep` — and the real population is **five**:
 * `MultiKeyConnectStep` holds two and was missed entirely, while all three
 * cited line numbers had drifted. That is the instance-not-class shape
 * occurring inside the register that exists to catch it. A hand-typed roster
 * here would re-create it; the file list is read from disk instead, so a
 * seventh step file added next month is scanned without an edit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY `CsvUploadStep` IS DELIBERATELY ALLOWED
 * ═══════════════════════════════════════════════════════════════════════════
 * Its catch sets `CSV_NETWORK_TIMEOUT`, whose copy is *"The server did not
 * respond within 30 seconds"* — that names OUR server and asserts no venue
 * fault, so it is not the same defect. The CSV branch has no
 * `SERVICE_UNREACHABLE` equivalent today; that is a decision recorded here
 * rather than an omission, and the CSV surface's own copy work belongs to
 * 140.5-05. **This guard bans the VENUE-FAULT code specifically**, not
 * "timeout-shaped codes in general" — banning the class would redden a correct
 * file and the natural fix for a guard that cries wolf is to weaken it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS GUARD DOES **NOT** PROVE — read before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. It is a SOURCE scan. It proves the token is absent from catch bodies, not
 *     that the replacement renders correctly. The per-surface behavioural tests
 *     in each step's own suite are the other half and neither substitutes for
 *     the other.
 *  2. It sees ONE directory. A wizard client living outside
 *     `wizard/steps/` — `WizardClient.tsx` itself, or a future hook — is not
 *     scanned. Widening is a one-line change to `STEPS_DIR`; the reason it is
 *     not done here is that the ban is specific to `WizardErrorCode`-setting
 *     catch bodies and no other directory has been measured for them.
 *  3. It cannot see a code reached INDIRECTLY — a catch that sets a variable
 *     that resolves to the venue-fault code elsewhere. Every site in this
 *     directory sets a literal today; an indirection would pass this scan.
 *  4. `composite/members` is the one route behind a `buildEnvelope` surface with
 *     NO `Retry-After` producer at all, so its `buildEnvelope` site is
 *     structurally excluded from this phase's wait-threading work. If a limiter
 *     is ever added there, that site becomes actionable SILENTLY — recorded here
 *     because this file is where the next person looks.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEF-16-2 — COMMENT-STRIP BEFORE COUNTING
 * ═══════════════════════════════════════════════════════════════════════════
 * This milestone's subject matter is PROSE, so a needle is more likely to sit in
 * a comment than anywhere else — and the fix commits deliberately WRITE the old
 * code's name into comments explaining why it was removed. A raw scan would
 * redden on its own explanation. Every scan below runs through
 * `stripCommentsPreserveLines` (140.5-01), which blanks comment characters
 * one-for-one so reported line numbers stay real.
 *
 * That module's docblock places a VACUITY-FENCE OBLIGATION on every caller,
 * because it blanks trailing comments too and therefore fails SILENT rather than
 * loud. The fence is the first `it()` below and its floors are hand-typed
 * literals, never `xs.length`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

/** The wizard-step surface. Widening this guard is a one-line change here. */
const STEPS_DIR = "src/app/(dashboard)/strategies/new/wizard/steps";

/**
 * The banned token. A LITERAL, not an import from `wizardErrors.ts`: importing
 * the constant under test would make this assertion compare a value to itself,
 * and renaming the code would silently disarm the guard rather than redden it.
 */
const VENUE_FAULT_CODE = "KEY_NETWORK_TIMEOUT";

/** Non-test `*.tsx` under the steps directory, read from disk. */
function deriveStepFiles(): string[] {
  return readdirSync(join(process.cwd(), STEPS_DIR))
    .filter((n) => n.endsWith(".tsx") && !n.includes(".test."))
    .map((n) => `${STEPS_DIR}/${n}`)
    .sort();
}

interface CatchBlock {
  /** 1-based line of the `catch` keyword in the ORIGINAL source. */
  line: number;
  /** The body between the braces, comment-blanked. */
  body: string;
}

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

/**
 * Advance past a quoted string / template literal starting at `i`; returns the
 * offset just after it.
 *
 * Template interpolation is walked as a nested frame so a `}` inside `${…}`
 * cannot be mistaken for the end of the catch body, and a `` ` `` inside an
 * interpolation can open another template.
 */
function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (quote !== "`" && c === "\n") return j; // unterminated: stop at the line
    if (quote === "`" && c === "$" && src[j + 1] === "{") {
      // Walk the interpolation to its matching `}`.
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (d === '"' || d === "'" || d === "`") {
          j = skipString(src, j);
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        j += 1;
      }
      continue;
    }
    j += 1;
  }
  return src.length;
}

/**
 * Extract every `catch` block body by a balanced-brace walk over the
 * COMMENT-STRIPPED source.
 *
 * The optional binding — `catch {`, `catch (err) {`, `catch (e: unknown) {` —
 * is skipped by taking the first `{` after the keyword. Strings and template
 * literals are walked so a brace inside one cannot close the body early; that
 * is not hypothetical here, since these steps hold JSON bodies and template
 * literals in and around their handlers.
 */
function catchBlocks(strippedSource: string): CatchBlock[] {
  const out: CatchBlock[] = [];
  const src = strippedSource;
  const lineOf = (offset: number) =>
    src.slice(0, offset).split("\n").length; // 1-based

  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== "c" || !src.startsWith("catch", i)) continue;
    // Not part of a longer identifier (`catcher`, `mycatch`).
    if (isIdentChar(src[i - 1]) || isIdentChar(src[i + 5])) continue;
    // ⚠️ A PROMISE `.catch(` IS NOT A CATCH CLAUSE, and rejecting it needs the
    // DOT specifically — `.` is not an identifier character, so the test above
    // lets it through. That is not hypothetical: this directory is full of
    // `res.json().catch(() => ({}))`, whose arrow body contains a `{`, so the
    // brace walk happily consumed `({})` as a "catch body" and the population
    // came out at 22 against an independently-counted 11. A guard that
    // DOUBLE-COUNTS its population is a guard whose vacuity floor no longer
    // means what it says — the fence would have passed on a walk that had lost
    // half the real bodies.
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k -= 1;
    if (src[k] === ".") continue;
    const keywordAt = i;

    // First `{` after the keyword opens the body. Anything between is the
    // optional binding.
    let j = i + 5;
    while (j < src.length && src[j] !== "{") {
      if (src[j] === ";" || src[j] === "}") break; // not a block form — bail
      j += 1;
    }
    if (src[j] !== "{") continue;

    const bodyStart = j + 1;
    let depth = 1;
    j = bodyStart;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '"' || c === "'" || c === "`") {
        j = skipString(src, j);
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      j += 1;
    }
    out.push({ line: lineOf(keywordAt), body: src.slice(bodyStart, j - 1) });
    // Deliberately NOT `i = j - 1`. Resuming after the block would skip any
    // NESTED catch, which both undercounts the vacuity floor and reports an
    // inner offence at the OUTER catch's line. Scanning on finds both, so the
    // message points at the right handler.
  }
  return out;
}

const STEP_FILES = deriveStepFiles();

interface ScannedFile {
  file: string;
  blocks: CatchBlock[];
}

const SCANNED: ScannedFile[] = STEP_FILES.map((file) => ({
  file,
  blocks: catchBlocks(
    stripCommentsPreserveLines(
      readFileSync(join(process.cwd(), file), "utf8"),
      "ts",
    ),
  ),
}));

describe("[140.5-03 / SEAMPROSE-03] no wizard transport catch asserts a venue fault", () => {
  it("⛔ VACUITY FENCE: the walk finds real catch bodies across real step files", () => {
    // A walk that matched NOTHING would report every file clean forever — the
    // failure mode that makes a source guard worse than no guard, because it
    // reads as protection. `source-scan.ts`'s docblock places this obligation
    // on every caller BY NAME, because it blanks trailing comments and so fails
    // silent rather than loud.
    //
    // MEASURED at 140.5-03, and RE-TAKEABLE without trusting this comment
    // (which is, after all, the subject of this phase): temporarily raise the
    // floor below to an impossible number and read the count back out of the
    // assertion message. That is how the figures here were taken.
    //
    // ⚠️ An env-gated `console.log` census stood here for one revision and was
    // REMOVED: `env-manifest.test.ts` enforces that every literal `process.env`
    // read in `src/` is declared, so a debug flag is not free — it is a new row
    // in a manifest, for a convenience the floor already provides.
    //
    //   PREDICATE: every non-test `*.tsx` in the steps directory, read from
    //   disk, comment-stripped with `stripCommentsPreserveLines`, then walked
    //   for `catch` CLAUSES (a dotted `.catch(` is a promise method, not a
    //   clause, and is excluded).
    //
    //   ConnectKeyStep 1 · CsvSubmitStep 1 · CsvUploadStep 1 · MetadataStep 1
    //   · MultiKeyConnectStep 3 · SubmitStep 1 · SyncPreviewStep 3
    //   = 11 catch bodies across 7 of the 10 files scanned.
    //
    // Only 5 of the 11 classify a TRANSPORT failure — the assertion below
    // covers all 11, and this floor counts what the WALK finds, which is the
    // number that detects a degraded tokenizer.
    //
    // ⚠️ FIX THE WALK, NEVER LOWER THE FLOOR. Both bounds are hand-typed
    // literals, never `xs.length`, and both sit below the measurement with
    // deliberate headroom so ordinary growth cannot touch them:
    //   · 8 of 11 catch bodies (~70%) — a degraded walk finding 6 must FAIL. An
    //     earlier draft used 5, which is the TRANSPORT-catch count, a different
    //     predicate entirely, and it would have let a walk that lost half the
    //     bodies pass in silence.
    //   · 6 of 10 step files (the 60% convention `seam-log-coverage.test.ts`
    //     already uses for its three floors).
    const totalBlocks = SCANNED.reduce((n, s) => n + s.blocks.length, 0);
    expect(
      totalBlocks,
      "the catch-body walk collapsed across the whole steps directory — this " +
        "guard is now BLIND, not satisfied. Fix the walk; do not lower this floor.",
    ).toBeGreaterThanOrEqual(8);
    expect(
      STEP_FILES.length,
      "the step-file derivation found almost nothing, so every assertion below " +
        "is vacuously true. Fix the walker before trusting this file.",
    ).toBeGreaterThanOrEqual(6);
  });

  it("no catch body in any non-test wizard step contains the venue-fault code", () => {
    // ANY occurrence, not just the state assignment. Each of the five transport
    // catches carried the code TWICE — once in the state it set and once in its
    // `wizard_error` telemetry payload — and a funnel still reporting the venue
    // code is the same false attribution in machine-readable form. It is what an
    // operator reads to decide whether the VENUES are flaky or we are.
    const offences: string[] = [];
    for (const { file, blocks } of SCANNED) {
      for (const block of blocks) {
        if (block.body.includes(VENUE_FAULT_CODE)) {
          offences.push(`${file}:${block.line}`);
        }
      }
    }
    expect(
      offences,
      `A wizard catch block sets ${VENUE_FAULT_CODE} ("We could not reach the ` +
        `exchange"). A catch around wizardFetch fires when OUR OWN route never ` +
        `answered — the exchange may never have been contacted. Use ` +
        `SERVICE_UNREACHABLE, and replace EVERY occurrence in the catch body ` +
        `including the telemetry payload. Offending sites: ${offences.join(", ")}`,
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: the roster memberships OUTSIDE catch bodies are untouched", () => {
    // The complement of the assertion above, and the reason this guard is
    // catch-scoped rather than file-scoped. A file-level ban would redden the
    // three routes' legitimate rosters — where the code stands for a REAL
    // server-side exchange-probe timeout — and the natural "fix" for a guard
    // that cries wolf is to weaken it until it stops.
    const filesWithRosterUse = SCANNED.filter(({ file }) =>
      stripCommentsPreserveLines(
        readFileSync(join(process.cwd(), file), "utf8"),
        "ts",
      ).includes(VENUE_FAULT_CODE),
    ).map(({ file }) => file);

    expect(
      filesWithRosterUse.length,
      "no step file mentions the venue-fault code at all any more, so the " +
        "catch-scoped assertion above can no longer distinguish itself from a " +
        "file-scoped one — this control has stopped controlling anything.",
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The needle's own self-tests, BOTH POLARITIES, on synthetic sources.
 *
 * Wave 0 requires this of every new scanner in this phase: it must be shown to
 * CATCH a deliberately-broken input and to STAY SILENT on a correct one. A
 * scanner that matches nothing agrees with everything forever.
 */
describe("[140.5-03] the catch-body walk itself, both polarities", () => {
  function offendingLines(source: string): number[] {
    return catchBlocks(stripCommentsPreserveLines(source, "ts"))
      .filter((b) => b.body.includes(VENUE_FAULT_CODE))
      .map((b) => b.line);
  }

  it("CATCHES the code inside a catch body", () => {
    const src = [
      "function f() {",
      "  try { go(); } catch (err) {",
      '    setErrorCode("KEY_NETWORK_TIMEOUT");',
      "  }",
      "}",
    ].join("\n");
    expect(offendingLines(src)).toEqual([2]);
  });

  it("CATCHES a SECOND occurrence deeper in the same body (the telemetry shape)", () => {
    const src = [
      "async function f() {",
      "  try {",
      "    await go();",
      "  } catch (err) {",
      '    setErrorCode("SERVICE_UNREACHABLE");',
      "    track({",
      '      code: "KEY_NETWORK_TIMEOUT",',
      "    });",
      "  }",
      "}",
    ].join("\n");
    // The nested object literal's braces must not close the body early.
    expect(offendingLines(src)).toEqual([4]);
  });

  it("STAYS SILENT when the code sits OUTSIDE any catch (the roster shape)", () => {
    const src = [
      'const KNOWN = new Set(["KEY_NETWORK_TIMEOUT"]);',
      "function f() {",
      "  try { go(); } catch (err) {",
      '    setErrorCode("SERVICE_UNREACHABLE");',
      "  }",
      "}",
    ].join("\n");
    expect(offendingLines(src)).toEqual([]);
  });

  it("STAYS SILENT when the code appears only in a COMMENT inside a catch (DEF-16-2)", () => {
    // The live specimen: the fix commits deliberately write the old code's name
    // into the catch's own explanatory comment. A raw scan reddens on its own
    // explanation, and the comment-strip is what stops that.
    const src = [
      "function f() {",
      "  try { go(); } catch (err) {",
      "    // KEY_NETWORK_TIMEOUT stood here and asserted a venue fault.",
      "    /* also KEY_NETWORK_TIMEOUT, in a block comment */",
      '    setErrorCode("SERVICE_UNREACHABLE");',
      "  }",
      "}",
    ].join("\n");
    expect(offendingLines(src)).toEqual([]);
  });

  it("does NOT mistake a `.catch(` method call for a catch block", () => {
    const src = [
      "function f() {",
      '  go().catch(() => setErrorCode("KEY_NETWORK_TIMEOUT"));',
      "}",
    ].join("\n");
    // A promise `.catch` is not a `catch` CLAUSE. Reporting it would be a false
    // positive on a shape this directory uses constantly
    // (`res.json().catch(() => ({}))`), and a guard that cries wolf gets weakened.
    expect(offendingLines(src)).toEqual([]);
  });

  it("REGRESSION: `.catch(() => ({}))` — a dotted catch whose arrow body HAS braces", () => {
    // ⚠️ THE BUG THIS FILE ACTUALLY SHIPPED WITH, FOUND BY PUBLISHING THE
    // PREDICATE AND CROSS-CHECKING IT. The identifier-boundary test alone lets
    // `.catch` through, because `.` is not an identifier character; the case
    // above only passed because its arrow body had NO brace before the `;`. The
    // shape below is the one this directory uses constantly, and the walk
    // consumed `({})` as a body — the measured population came out at 22 against
    // an independently counted 11.
    //
    // A double-counted population is worse than a wrong number: it inflates what
    // the vacuity fence measures, so a walk that had lost HALF the real catch
    // bodies would still have cleared the floor. The count and the guard would
    // have gone wrong together and agreed with each other.
    const src = [
      "async function f() {",
      "  const data = await res.json().catch(() => ({}));",
      '  track({ code: "KEY_NETWORK_TIMEOUT" });',
      "  return data;",
      "}",
    ].join("\n");
    expect(offendingLines(src)).toEqual([]);
    expect(catchBlocks(stripCommentsPreserveLines(src, "ts"))).toHaveLength(0);
  });

  it("a brace inside a STRING or TEMPLATE does not close the body early", () => {
    const src = [
      "function f() {",
      "  try { go(); } catch (err) {",
      '    log("}");',
      "    log(`${x} }`);",
      '    setErrorCode("KEY_NETWORK_TIMEOUT");',
      "  }",
      "}",
    ].join("\n");
    // Without string handling the walk closes at the `}` on line 3 and the real
    // offence on line 5 falls outside the body — a SILENT miss, which is the
    // failure mode this whole file guards against.
    expect(offendingLines(src)).toEqual([2]);
  });

  it("handles the bindingless `catch {` form", () => {
    const src = [
      "function f() {",
      "  try { go(); } catch {",
      '    setErrorCode("KEY_NETWORK_TIMEOUT");',
      "  }",
      "}",
    ].join("\n");
    expect(offendingLines(src)).toEqual([2]);
  });

  it("finds a NESTED catch as its own body", () => {
    const src = [
      "function f() {",
      "  try { go(); } catch (outer) {",
      "    try { retry(); } catch (inner) {",
      '      setErrorCode("KEY_NETWORK_TIMEOUT");',
      "    }",
      "  }",
      "}",
    ].join("\n");
    // The OUTER body lexically contains the inner one, so both report. That is
    // correct for an absence assertion: the offence is real either way, and the
    // outer line number still points a reader at the right function.
    expect(offendingLines(src)).toEqual([2, 3]);
  });
});
