import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractComments, type SourceLang } from "./source-scan";
import { citationsIn, CONVERSION_PROTOCOL } from "./seam-citations-needle";

/**
 * Phase 140.5 / SEAMPROSE-01 — no bare `file:line` citation on the seam surface.
 *
 * WHAT IT BANS, AND WHY THAT FORM. A "bare citation" is a comment token of the
 * shape `<path-or-basename>.<ext>:<line>` (optionally a range `:88-92` or a list
 * `:66,78`) — the census's variants A/B/C. It names a coordinate in a file, and
 * a coordinate goes stale the instant that file grows or shrinks a line above
 * the target. This milestone was bitten by exactly that eight separate times: a
 * comment citing a line deep in `analytics_runner.py` that lands well past the
 * file's own end, a `route.ts` coordinate cited three times after the function
 * moved, a `queries.ts` coordinate that now lands on an unrelated type
 * assertion. (Those forms are described here, not written, because this file is
 * the LAST place that should plant the exact token it bans.) The fix is a
 * SYMBOL-ANCHORED reference — name the function, the constant, the arm
 * (`assertPortfolioOwnership in queries.ts`, `the 4xx-forward arm in
 * simulator/route.ts`) — which survives line drift because it names the thing,
 * not its address.
 *
 * ⚠️ COVERAGE-LAW ROW 1 *ON THE SEAM SURFACE*, AND EXPLICITLY NOT A REPO-WIDE
 * CLOSURE (founder decision §4b, said in those words). The population is the 35
 * ratified seam files below — the 34 from 140.5 plus `seam-retry-registry.ts`,
 * appended by 141.1 because that file is an AUDIT ARTIFACT whose prose a future
 * allowlist extension reasons from; widening the guard to the rest of the repo is a
 * one-line change — append to `SEAM_CITATION_SURFACE` — but is a DECISION with
 * prerequisites, enumerated under WIDENING below. The 881-citation repo-wide
 * corpus is deliberately out of scope for this phase.
 *
 * ⚠️ WHY THE MECHANISM IS A FORM-BAN AND NOT A PAST-EOF CHECK — THE VACUITY
 * FINDING THAT DECIDED IT. The literal §4b scope ("correct known-bad citations")
 * suggests a guard that resolves each citation and flags the ones whose line is
 * past end-of-file. Measured on the 34-file surface as it stood at 140.5
 * (`MODE=full` over `140.5-seam-surface.txt`): **51 citations, ZERO past-EOF**, while 9 were
 * provably wrong but IN RANGE. A past-EOF guard scoped here is GREEN FOREVER —
 * the "scanner that matches nothing reports agreement forever" failure in its
 * type-checking form. So this guard does not resolve citations at all: it FORBIDS
 * the path-qualified coordinate FORM outright. Resolvability and basename
 * ambiguity (10 of 51 on this surface, 20%) are therefore irrelevant to its
 * verdict — ambiguity mattered only during the one-time conversions, where each
 * citation was resolved by a human reading the target (waves 2-3 + plan 140.5-08
 * Task 1).
 *
 * ⚠️ PARTIAL BY CONSTRUCTION for the self-relative forms. Citations come in six
 * variants; D/E/F (`line 55`, `(:1027)`, `at line 67` — 69 repo-wide under the
 * pattern-mapper's predicate) name a line in the file they sit IN, carry no path,
 * and are NOT covered here. Closing them needs a SECOND predicate
 * (containing-file-scoped, self-relative), which is named as a residual and not
 * built here. This guard is row 1 for the path-qualified forms and silent for the
 * self-relative ones — in those words.
 *
 * ⚠️ WHAT THIS GUARD STRUCTURALLY CANNOT REACH, STATED SO NOBODY ASKS IT TO.
 * Value/set-size claims — the "5 minutes", "exactly three predicates", "six seam
 * files" class (RESEARCH §10.4) — are not citations and no citation guard can
 * see them. They were closed at source by DELETING the derivable integers (waves
 * 2-3) and correcting them to predicate references. The durable rule that closes
 * that class, in one sentence: **never write an integer or a duration in prose
 * that a test can derive.** This guard enforces the citation half only.
 *
 * ⚠️ `.planning/**` IS PERMANENTLY EXCLUDED, BY DESIGN, NOT OVERSIGHT. A planning
 * ledger is a FROZEN RECORD of what was true when it was written (17,259
 * citations / 216 past-EOF live in there). "Correcting" a citation inside a
 * committed plan or summary would falsify the very history this milestone's
 * re-measurement discipline depends on. No seam-surface entry is under
 * `.planning/`, and none may be added.
 *
 * ---------------------------------------------------------------------------
 * THE SIX PARTS, copied from `seam-log-coverage.test.ts` in PATTERNS §8's order,
 * with the one INVERSION this artefact requires: a citation lives INSIDE a
 * comment, so this guard EXTRACTS comments (`extractComments`) where the log
 * guard STRIPS them. The extractor is line-preserving, so a reported offence
 * carries the real coordinate of the rot.
 * ---------------------------------------------------------------------------
 *
 * WIDENING — the four prerequisites §4b requires this file to name:
 *   1. `.planning/**` must stay excluded (frozen record, above).
 *   2. The ambiguity policy is already settled (form-ban, so ambiguity is
 *      irrelevant to the verdict) — but a repo-wide run surfaces hundreds of
 *      pre-existing stale citations that need human triage, which §4b declined to
 *      take on inside this phase.
 *   3. Variants D/E/F need the second, self-relative predicate.
 *   4. Only then is the widening the one-line glob/roster change §4b asks for.
 */

const ROOT = process.cwd();

/**
 * THE POPULATION — the 35 ratified seam files, hand-typed. The first 34 are the
 * roster `140.5-seam-surface.txt` ratified (A6): the 19-file `seam-log-coverage`
 * derived roster + the seam leaves (`seam-copy`, `seam-errors`,
 * `seam-redaction`, `seam-discriminator`, `sentry-capture`) + `envelope.ts`,
 * `wizardErrors.ts` + the 6 wizard steps + `CsvValidationEnvelope.tsx` +
 * `ErrorEnvelope.tsx`. The 35th, `seam-retry-registry.ts`, was appended by
 * Phase 141.1 (see the comment on that entry).
 *
 * ⚠️ WIDENING IS APPENDING TO THIS ONE ARRAY — §4b's one-line-ratchet
 * requirement, satisfied literally. It is hand-typed rather than derived because
 * a new seam file joining the surface is a DECISION (does its comment discipline
 * now matter?), and because there is no single import-edge that defines this
 * roster — it spans leaves, routes and client components. Every entry is asserted
 * to exist on disk below, so a rename fails LOUD rather than silently shrinking
 * the scanned population.
 */
export const SEAM_CITATION_SURFACE: readonly string[] = [
  // The 11 lib leaves / tables.
  "src/lib/analytics-client.ts",
  "src/lib/process-key-client.ts",
  "src/lib/ratelimit.ts",
  "src/lib/resilient-fetch.ts",
  "src/lib/seam-discriminator.ts",
  "src/lib/seam-errors.ts",
  "src/lib/seam-copy.ts",
  "src/lib/seam-redaction.ts",
  "src/lib/sentry-capture.ts",
  "src/lib/envelope.ts",
  "src/lib/wizardErrors.ts",
  // The 15 seam routes.
  "src/app/api/admin/match/eval/route.ts",
  "src/app/api/admin/match/recompute/route.ts",
  "src/app/api/bridge/route.ts",
  "src/app/api/keys/[id]/permissions/route.ts",
  "src/app/api/keys/sync/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/portfolio-optimizer/route.ts",
  "src/app/api/scenario/optimize/route.ts",
  "src/app/api/simulator/route.ts",
  "src/app/api/strategies/composite/add-key/route.ts",
  "src/app/api/strategies/create-with-key/route.ts",
  "src/app/api/strategies/csv-finalize/route.ts",
  "src/app/api/strategies/csv-validate/route.ts",
  "src/app/api/strategies/finalize-wizard/route.ts",
  "src/app/api/verify-strategy/route.ts",
  // The 6 wizard steps + 2 envelopes.
  "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx",
  "src/components/error/ErrorEnvelope.tsx",
  // Appended by Phase 141.1 / D-06. The retry registry is the SC1 idempotency
  // AUDIT as well as the runtime allowlist, so its comments are reasoning a
  // future engineer extends an allowlist from — the same "prose a reader
  // trusts" property that put the other 34 here. It joined carrying REAL rot:
  // a wrong migration id and several coordinate citations, since converted.
  //
  // ⚠️ THIS HALF GUARDS COMMENTS ONLY, AND IN THIS FILE THAT IS THE MINOR HALF.
  // The registry's load-bearing prose lives in its evidence STRING LITERALS,
  // which `extractComments` deliberately does not see (the `-1` self-test
  // below pins exactly that). The string-literal half is guarded separately by
  // the registry-local guard in `seam-retry-registry.test.ts`.
  "src/lib/seam-retry-registry.ts",
];

/**
 * THE ALLOWLIST — frozen, length-pinned, each entry carrying a REASON.
 *
 * Sole member: `resilient-fetch.ts`'s reference to `@upstash/ratelimit@2.0.8`'s
 * bundled `dist/index.mjs`. It is an OUT-OF-REPO artefact this repo does not
 * ship — version-pinned and deliberately EXPECTED to be wrong for any other
 * version, which is the OPPOSITE of the in-repo rot this guard bans. It was
 * annotated in place by 140.5-07 rather than converted, because there is no
 * in-repo symbol to anchor it to.
 *
 * ⚠️ A NEW ROW HERE NEEDS A REASON, NOT A CONVENIENCE. The length is pinned to 1
 * below; growing it to silence an in-repo citation is always the wrong fix —
 * convert the citation to a symbol reference instead.
 */
const CITATION_ALLOWLIST: ReadonlyArray<{
  file: string;
  target: string;
  reason: string;
}> = [
  {
    file: "src/lib/resilient-fetch.ts",
    target: "dist/index.mjs",
    reason:
      "OUT-OF-REPO evidence reference to @upstash/ratelimit@2.0.8's bundled " +
      "dist/index.mjs — a third-party artefact this repo does not ship, " +
      "version-pinned and expected to be wrong for any other version. No " +
      "in-repo symbol exists to anchor it to; annotated in place by 140.5-07.",
  },
];

/**
 * THE NEEDLE now lives in `seam-citations-needle.ts` (Phase 141.1 / D-06). It
 * was hoisted out of this file, unchanged, so the registry-local evidence guard
 * in `seam-retry-registry.test.ts` could share it rather than grow a second
 * regex. Importing THIS file from that one was measured and rejected: vitest
 * re-registers an imported test file's suites into the importer, which double-
 * counted this file's whole suite. The self-tests below still exercise the
 * needle end-to-end through `extractComments`, so the hoist is covered here.
 */

interface Offence {
  file: string;
  line: number;
  cite: string;
}

/** Run the real pipeline (extract → match) over one source string. */
function scanSource(source: string, lang: SourceLang = "ts"): Offence[] {
  const offences: Offence[] = [];
  for (const { line, text } of extractComments(source, lang)) {
    for (const c of citationsIn(text)) {
      offences.push({ file: "<sample>", line, cite: `${c.target}:${c.lines}` });
    }
  }
  return offences;
}

/** Scan a real surface file, honouring the allowlist. */
function scanFile(file: string): Offence[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const lang: SourceLang = file.endsWith(".py") ? "py" : "ts";
  const offences: Offence[] = [];
  for (const { line, text } of extractComments(source, lang)) {
    for (const c of citationsIn(text)) {
      const cite = `${c.target}:${c.lines}`;
      const allowed = CITATION_ALLOWLIST.some(
        (a) => a.file === file && cite.startsWith(`${a.target}:`),
      );
      if (!allowed) offences.push({ file, line, cite });
    }
  }
  return offences;
}

describe("[SEAMPROSE-01] no bare file:line citation on the seam surface", () => {
  it("the surface roster is exactly 35 files and every one exists on disk (fail-loud on drift)", () => {
    // A vacuity fence on the POPULATION: `it.each([])` is zero cases, which is a
    // passing suite. If a file was renamed and its entry not updated, this reds
    // rather than silently scanning 33 files.
    expect(
      SEAM_CITATION_SURFACE.length,
      "the ratified seam surface is 35 files (140.5-seam-surface.txt, plus " +
        "seam-retry-registry.ts appended by 141.1). Widening is APPENDING to " +
        "SEAM_CITATION_SURFACE and bumping this pin in the same commit — never " +
        "lower it to match a shrunken roster.",
    ).toBe(35);
    const missing = SEAM_CITATION_SURFACE.filter(
      (f) => !existsSync(join(ROOT, f)),
    );
    expect(
      missing,
      `Seam-surface files missing from disk: ${missing.join(", ")}. A rename ` +
        `must update SEAM_CITATION_SURFACE in the same commit, or this guard ` +
        `silently stops watching the moved file.`,
    ).toEqual([]);
  });

  it("the extractor is not blind — the surface carries a large body of comment text (vacuity fence)", () => {
    // ⚠️ THE FLOOR IS LOAD-BEARING AND HAND-TYPED. `source-scan.ts`'s tokenizer
    // BLANKS trailing comments rather than leaving them in, so a tokenizer bug
    // here now fails SILENT (fewer comment lines extracted) rather than loud.
    // If `extractComments` broke, it would return few or no lines and every
    // file would scan CLEAN forever — protection that inspects nothing. Measured
    // 2026-07-30: 10863 comment lines across the then-34 files. Re-measured
    // 2026-07-31 after 141.1 appended the retry registry: 11255 across 35. The
    // floor stays 6500 — it is a FLOOR, not a tracker, and raising it in
    // lockstep with the roster would make every append a two-line edit for no
    // added detection. The extractor is BLIND, not satisfied, if this reds; fix
    // the extractor, NEVER lower the floor.
    let commentLines = 0;
    for (const file of SEAM_CITATION_SURFACE) {
      const source = readFileSync(join(ROOT, file), "utf8");
      const lang: SourceLang = file.endsWith(".py") ? "py" : "ts";
      commentLines += extractComments(source, lang).length;
    }
    expect(
      commentLines,
      "the comment extractor collapsed across the whole surface — this guard is " +
        "now BLIND, not satisfied. Fix extractComments; never lower this floor.",
    ).toBeGreaterThanOrEqual(6500);
  });

  it("the allowlist is frozen at ONE out-of-repo reference (a widening needs a reason row)", () => {
    expect(
      CITATION_ALLOWLIST.length,
      "the citation allowlist is frozen at one entry: resilient-fetch.ts's " +
        "@upstash/ratelimit dist reference. Silencing an IN-REPO citation by " +
        "adding a row here is always the wrong fix — convert it to a symbol " +
        "reference instead.",
    ).toBe(1);
    for (const entry of CITATION_ALLOWLIST) {
      expect(entry.reason.length, "every allowlist row must carry a reason").toBeGreaterThan(20);
      expect(
        existsSync(join(ROOT, entry.file)),
        `allowlisted file missing: ${entry.file}`,
      ).toBe(true);
    }
  });

  it.each(SEAM_CITATION_SURFACE)("%s carries no bare file:line citation", (file) => {
    const offences = scanFile(file);
    expect(
      offences,
      `${offences
        .map((o) => `${o.file}:${o.line} cites \`${o.cite}\``)
        .join("; ")}. ${CONVERSION_PROTOCOL}`,
    ).toEqual([]);
  });

  it("collects EVERY citation in a file, one per line (the offences idiom)", () => {
    // One file with three rots must be three lines, not one — otherwise a
    // multi-rot file reads as a single defect and two survive the fix.
    const sample = [
      "// see foo.ts:12",
      "const x = 1;",
      "/* and bar.ts:34 plus baz.ts:56 on one line */",
    ].join("\n");
    const offences = scanSource(sample);
    expect(offences.map((o) => o.cite)).toEqual([
      "foo.ts:12",
      "bar.ts:34",
      "baz.ts:56",
    ]);
    expect(offences.map((o) => o.line)).toEqual([1, 3, 3]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BOTH-POLARITY NEEDLE SELF-TESTS — run END-TO-END through the real pipeline
  // (extractComments → citationsIn) on synthetic source strings. Wave-0
  // requirement: "a scanner that matches nothing reports agreement forever", so
  // the guard must be shown to CATCH a planted rot AND to STAY SILENT on the
  // three shapes that look like citations but are not.
  // ───────────────────────────────────────────────────────────────────────────

  it("+1: a bare `foo.ts:123` planted in a comment is caught, with the right line", () => {
    const sample = "const a = 1;\n// TODO: cross-check foo.ts:123 before shipping\nconst b = 2;";
    const offences = scanSource(sample);
    expect(offences).toHaveLength(1);
    expect(offences[0].cite).toBe("foo.ts:123");
    expect(offences[0].line).toBe(2);
  });

  it("+2: a `(route.ts:172)` paren form is caught (the paren-eating regression)", () => {
    const offences = scanSource("// pass-through at (route.ts:172) forwards verbatim");
    expect(offences).toHaveLength(1);
    // The leading `(` is un-eaten, so the target is `route.ts`, not `(route.ts`.
    expect(offences[0].cite).toBe("route.ts:172");
  });

  it("+3: a range `a.ts:88-92` and a list `b.ts:66,78` are both caught", () => {
    const offences = scanSource("// see a.ts:88-92 and b.ts:66,78");
    expect(offences.map((o) => o.cite)).toEqual(["a.ts:88-92", "b.ts:66,78"]);
  });

  it("-1: the SAME token inside a STRING literal is NOT caught (it is not a comment)", () => {
    // A citation is a claim in PROSE about this repo; a `file.ext:NN` inside a
    // string literal is data, not a comment. extractComments returns nothing for
    // string contents, so the pipeline never sees it.
    const offences = scanSource('const path = "foo.ts:123";');
    expect(offences).toEqual([]);
  });

  it("-2: a SYMBOL-anchored reference is NOT caught (this is the conversion target)", () => {
    const offences = scanSource(
      "// resolved by assertPortfolioOwnership in queries.ts — no coordinate",
    );
    expect(offences).toEqual([]);
  });

  it("-3: a bare filename with no `:line` is NOT caught (the ban is the coordinate form)", () => {
    const offences = scanSource("// see resilient-fetch.ts and analytics-client.ts");
    expect(offences).toEqual([]);
  });

  it("-4: a version like `@upstash/ratelimit@2.0.8` is NOT read as a citation", () => {
    const offences = scanSource("// pinned to @upstash/ratelimit@2.0.8 for the coordinates");
    expect(offences).toEqual([]);
  });

  it("the allowlist actually suppresses its one entry (positive: resilient-fetch scans clean)", () => {
    // The only surface file with a census-matching citation is resilient-fetch.ts
    // (the out-of-repo dist reference). It must scan CLEAN under the allowlist,
    // and a bare in-repo citation elsewhere in the same file would still red.
    expect(scanFile("src/lib/resilient-fetch.ts")).toEqual([]);
    // Prove the suppression is specific to the allowed target, not the file: a
    // hypothetical in-repo citation in that file is still an offence.
    const withInRepo =
      "// the dist file (dist/index.mjs:757-761) and also queries.ts:974";
    const offences = scanSource(withInRepo).filter(
      (o) => !o.cite.startsWith("dist/index.mjs:"),
    );
    expect(offences.map((o) => o.cite)).toEqual(["queries.ts:974"]);
  });
});
