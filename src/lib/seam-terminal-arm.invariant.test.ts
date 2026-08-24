// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

/**
 * ⭐ 161-08 / WIZERR-06 — A SEAM ROUTE'S TERMINAL 5xx ARM FORWARDS THE CODE IT
 * WAS GIVEN, AND STILL REFUSES THE MESSAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS LAW EXISTS — THE COLLAPSE IS A SHAPE, NOT FIVE BUGS
 *
 * Five route handlers had independently grown the SAME arrangement: an
 * `AnalyticsUpstreamError` arm range-split to 4xx that forwards
 * `err.seamCode ?? "UNKNOWN"`, and a terminal catch below it that hard-codes
 * `code: "UNKNOWN"`. The consequence is precisely backwards — the MORE severe
 * half of the seam vocabulary was the half the client could not discriminate.
 * A 500 the service had classified exactly (`EVAL_FAILED`, `KEK_UNAVAILABLE`,
 * `SIMULATION_FAILED`, `SERVICE_KEY_UNCONFIGURED`) arrived at the client
 * indistinguishable from a transport failure nobody could name.
 *
 * Fixing five files does not close that. A SIXTH route copying the shape is how
 * the class regrows, and the class HAS regrown before: WIZFORM-02 was measured
 * closed at Phase 153's span verification and was live again on PROD afterwards.
 * So the fix is a shape law, derived from disk, that fails BY NAME on the day a
 * new route adopts the arrangement without the forward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PREDICATE, IN FULL PROSE, so the count below is reproducible without
 * reading a single regex:
 *
 *   A file named `route.ts` anywhere under `src/app/api`, read from disk and
 *   COMMENT-STRIPPED, is a member iff all three hold:
 *
 *     1. it names `AnalyticsUpstreamError`; AND
 *     2. it carries a 4xx RANGE SPLIT — an upper bound of the form
 *        `status < 500` — which is what makes its upstream-forward arm answer
 *        4xx ONLY and lets a 5xx fall through to the terminal; AND
 *     3. its TERMINAL ARM — operationally, the LAST `return NextResponse.json(`
 *        in the file, which in every one of these handlers is the final
 *        statement of the outermost catch — carries a `code:` channel.
 *
 *   Measured 2026-08-24: **5** members.
 *
 * ⚠️ CONDITION 2 IS THE LOAD-BEARING ONE, and it is there because of a MEASURED
 * near-miss, not a hypothetical. `grep -ral 'seamCode ?? "UNKNOWN"' src/app/api`
 * returns **six** route files at HEAD, one more than this population. The extra
 * one is `src/app/api/scenario/optimize/route.ts`, and it is EXCLUDED ON
 * PURPOSE:
 *
 *   · `scenario/optimize` has NO range split. Its `AnalyticsUpstreamError` arm
 *     answers EVERY status — 4xx and 5xx alike — with a flat 502 that already
 *     forwards `err.seamCode ?? "UNKNOWN"`. Its terminal arm's bare
 *     `code: "UNKNOWN"` is therefore CORRECT by construction: no seam error can
 *     reach it. That route's own comment says so in as many words ("THIS ROUTE
 *     HAS NO RANGE SPLIT"). Widening it would be a change with no defect behind
 *     it, and admitting it to this population would make the law demand one.
 *
 * ⚠️ A SECOND MEASURED NEAR-MISS, recorded for the same reason.
 * `src/app/api/strategies/create-with-key/route.ts` names
 * `AnalyticsUpstreamError` and has no range split either. Its terminal arm ends
 * `return NextResponse.json({ code }, …)` where `code` comes from
 * `classifyKeyValidationError(err)` — which reads the seam code through
 * `recogniseSeamErrorCode` / `VENUE_WIRE_CODE_TO_VERDICT`. It never collapsed,
 * so it is not this law's business. Both near-misses are named here rather than
 * left to be rediscovered, because "why is this route not in the list" is the
 * question a reader of a derived population always has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORACLE INDEPENDENCE (the rule this file must not break)
 *
 * A derivation may NEVER be its own oracle. `derived.length` appears nowhere as
 * its own expected value. Two INDEPENDENT hand-typed literals fence the
 * population — `EXPECTED_ROUTE_COUNT` and `EXPECTED_ROUTES` — and both must be
 * edited deliberately for the population to change. A scanner that silently
 * stopped matching would otherwise make every assertion below pass vacuously
 * over an empty set, which is the exact shape "a test that cannot fail" takes
 * when it is written carelessly.
 *
 * The sibling law `analytics-upstream-error.parity.invariant.test.ts` (161-06)
 * is the form this file follows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ COMMENT-STRIPPING IS LOAD-BEARING HERE, AND IT IS MEASURED, NOT ASSUMED
 *
 * The companion law below asserts that the terminal arm's region contains no
 * `.message` read. Measured at HEAD on the UNSTRIPPED source, **2 of the 5**
 * members contain a `.message` occurrence in exactly that region — three
 * occurrences in total:
 *
 *   bridge 2 · simulator 1 · admin/match/recompute 0 · admin/match/eval 0 ·
 *   keys/validate-and-encrypt 0
 *
 * Every one of those three is a COMMENT — H-1062 at bridge and its restatement
 * at simulator — saying that `err.message` must NOT be echoed there. An
 * unstripped scan would therefore report two routes as violating the rule those
 * very comments state: the prose explaining the fix would invalidate the gate
 * that holds it. `SELF-TEST — comment-stripping is doing real work` re-measures
 * that delta on every run so the claim cannot go stale.
 *
 * ⚠️ The count moved during authoring, and the reason is recorded because it
 * is the kind of thing a reader will otherwise re-derive wrongly. Under a first,
 * WRONG region definition (starting AT the previous `return NextResponse.json(`
 * rather than after it closes) the reading was 4 of 5 — because that definition
 * swallowed the preceding arm's body, and on `admin/match/eval` and
 * `admin/match/recompute` the preceding arm is the 4xx forward, which reads
 * `err.message` LEGITIMATELY. The law fired on the one place the message is
 * allowed. See `TerminalArm.region` for the corrected boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ SOURCE, NOT BEHAVIOUR. Every assertion here reads text. That a route's
 * terminal arm mentions `seamCode` does not prove it answers the right code —
 * the four per-route cases in each `route.test.ts` (forwarded code / null code /
 * non-seam throwable / no-message-substring) are where that lives. The two tiers
 * are complementary and neither substitutes for the other: a behavioural case
 * cannot see a SIXTH route that has not been written yet, and this law cannot
 * see a route that reads `seamCode` and then answers with something else.
 */

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The five members, HAND-TYPED from the measurement in the docblock, sorted.
 * Naming them rather than only counting them is what makes a failure say WHICH
 * route appeared or disappeared.
 *
 * ⚠️ A SIXTH ENTRY IS A DECISION, NOT A LITERAL TO BUMP. Read the two
 * near-misses above first: a route reaches this list only by having a 4xx range
 * split, which is what makes a 5xx capable of reaching its terminal arm at all.
 */
const EXPECTED_ROUTES = [
  "src/app/api/admin/match/eval/route.ts",
  "src/app/api/admin/match/recompute/route.ts",
  "src/app/api/bridge/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/simulator/route.ts",
] as const;

/** Hand-typed, and asserted INDEPENDENTLY of the roster above. */
const EXPECTED_ROUTE_COUNT = 5;

// ---------------------------------------------------------------------------
// PART 0 — the scanner. Exported so the SELF-TESTs can drive it on synthetic
// source rather than only on the repo, which is what makes them able to fail.
// ---------------------------------------------------------------------------

/** The upstream-error type this whole family is about. */
const NAMES_UPSTREAM_ERROR = /\bAnalyticsUpstreamError\b/;

/**
 * The 4xx RANGE SPLIT. `status < 500` is the upper bound that makes the forward
 * arm answer 4xx only; without it every upstream error is answered above and
 * the terminal arm is unreachable to the seam (the `scenario/optimize` case).
 */
const FOUR_XX_RANGE_SPLIT = /\bstatus\s*<\s*500\b/;

const TERMINAL_RETURN = "return NextResponse.json(";

/** Scan forward from an opening paren to its match, returning its index. */
function matchParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface TerminalArm {
  /** The terminal `NextResponse.json( … )` call, verbatim (comment-stripped). */
  body: string;
  /**
   * The terminal REGION: everything AFTER the previous `NextResponse.json( … )`
   * call closes, through the end of the terminal one. This is the stretch of
   * handler in which the terminal arm's decision is made — its prose, its
   * logging, its capture and its response — and it is what the `err.message`
   * companion law scans.
   *
   * ⚠️ IT STARTS AFTER THE PREVIOUS ARM CLOSES, not at it, and the boundary is
   * load-bearing. On `admin/match/eval` and `admin/match/recompute` the
   * preceding arm IS the 4xx forward, whose body reads `err.message`
   * LEGITIMATELY — a 4xx `detail` is operator-curated copy. Including it would
   * make the companion law fire on the one place the message is allowed.
   */
  region: string;
  /** The `code:` channel's expression text, or `null` when there is none. */
  codeExpression: string | null;
}

/**
 * Locate the terminal arm of a comment-stripped handler source.
 *
 * "Terminal" is defined operationally as the LAST `return NextResponse.json(`
 * in the file. In every member of this population that is the final statement
 * of the outermost catch — the arm reached when no typed branch matched — and
 * defining it positionally rather than by status keeps it from confusing a
 * same-status response emitted elsewhere in the handler. That is not a
 * hypothetical distinction: `keys/validate-and-encrypt` returns a SECOND
 * `code: "UNKNOWN"` at status 500 from its persist-INSERT failure arm, which is
 * inside the try and whose fault is a PostgREST error carrying no seam code.
 * A status-based rule would drag that arm into this law and demand a forward
 * for a code that does not exist.
 */
export function findTerminalArm(strippedSource: string): TerminalArm | null {
  const last = strippedSource.lastIndexOf(TERMINAL_RETURN);
  if (last === -1) return null;
  const parenOpen = strippedSource.indexOf("(", last);
  const parenClose = matchParen(strippedSource, parenOpen);
  if (parenClose === -1) return null;

  const body = strippedSource.slice(last, parenClose + 1);

  // The region starts where the PREVIOUS arm's response call closes, so the
  // preceding arm's own body — which on two of the five members is the 4xx
  // forward and legitimately reads `err.message` — is outside it.
  const prev = strippedSource.lastIndexOf(TERMINAL_RETURN, last - 1);
  const prevEnd =
    prev === -1 ? last : matchParen(strippedSource, strippedSource.indexOf("(", prev));
  const region = strippedSource.slice(
    prevEnd === -1 ? last : prevEnd + 1,
    parenClose + 1,
  );

  return { body, region, codeExpression: readCodeChannel(body) };
}

/**
 * Read the expression assigned to the `code:` key, up to the top-level comma or
 * closing brace. Depth-aware so a nested call or object in the expression does
 * not truncate it.
 */
function readCodeChannel(body: string): string | null {
  const at = body.indexOf("code:");
  if (at === -1) return null;
  let depth = 0;
  let out = "";
  for (let i = at + "code:".length; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

/** Every `route.ts` under `src/app/api`, as repo-relative POSIX paths. */
function allRouteFiles(relDir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO_ROOT, relDir), {
    withFileTypes: true,
  })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      allRouteFiles(rel, acc);
      continue;
    }
    if (entry.name === "route.ts") acc.push(rel);
  }
  return acc;
}

function readStripped(relPath: string): string {
  return stripCommentsPreserveLines(
    readFileSync(join(REPO_ROOT, relPath), "utf8"),
    "ts",
  );
}

/** The three membership conditions, in the docblock's order. */
export function isTerminalArmRoute(strippedSource: string): boolean {
  if (!NAMES_UPSTREAM_ERROR.test(strippedSource)) return false;
  if (!FOUR_XX_RANGE_SPLIT.test(strippedSource)) return false;
  const arm = findTerminalArm(strippedSource);
  return arm !== null && arm.codeExpression !== null;
}

const DERIVED_ROUTES = allRouteFiles("src/app/api")
  .filter((path) => isTerminalArmRoute(readStripped(path)))
  .sort();

describe("[161-08 / WIZERR-06] the terminal 5xx arm forwards its code and refuses its message", () => {
  // -------------------------------------------------------------------------
  // SELF-TESTS — the scanner is not answering by accident.
  // -------------------------------------------------------------------------
  describe("SELF-TEST — the scanner recognises and rejects the right shapes", () => {
    const COMPLIANT = `
      export async function POST() {
        try { return NextResponse.json({ ok: true }); }
        catch (err) {
          if (err instanceof AnalyticsUpstreamError && err.status >= 400 && err.status < 500) {
            return NextResponse.json({ error: err.message, code: err.seamCode ?? "UNKNOWN" });
          }
          const rawSeamCode = (err as { seamCode?: unknown })?.seamCode;
          const seamCode = typeof rawSeamCode === "string" ? rawSeamCode : null;
          return NextResponse.json({ error: "Static.", code: seamCode ?? "UNKNOWN" });
        }
      }
    `;

    const COLLAPSED = `
      export async function POST() {
        try { return NextResponse.json({ ok: true }); }
        catch (err) {
          if (err instanceof AnalyticsUpstreamError && err.status >= 400 && err.status < 500) {
            return NextResponse.json({ error: err.message, code: err.seamCode ?? "UNKNOWN" });
          }
          return NextResponse.json({ error: "Static.", code: "UNKNOWN" });
        }
      }
    `;

    it("POSITIVE: a handler written in the real compliant shape is a member, and its terminal code reads seamCode", () => {
      const stripped = stripCommentsPreserveLines(COMPLIANT, "ts");
      expect(isTerminalArmRoute(stripped)).toBe(true);
      const arm = findTerminalArm(stripped);
      expect(arm?.codeExpression).toBe('seamCode ?? "UNKNOWN"');
    });

    it("NEGATIVE: a terminal arm written with a BARE hard-coded UNKNOWN is a member but is NOT compliant", () => {
      const stripped = stripCommentsPreserveLines(COLLAPSED, "ts");
      // It IS in the population — that is the point. The law must be able to
      // SEE the collapse, not exclude it and report the class closed.
      expect(isTerminalArmRoute(stripped)).toBe(true);
      const arm = findTerminalArm(stripped);
      expect(arm?.codeExpression).toBe('"UNKNOWN"');
      expect(/\bseamCode\b/.test(arm?.codeExpression ?? "")).toBe(false);
    });

    it("NEGATIVE: a handler with NO 4xx range split is excluded (the scenario/optimize shape)", () => {
      // Every AnalyticsUpstreamError is answered above with the code already
      // forwarded, so nothing from the seam can reach the terminal arm and its
      // bare UNKNOWN is correct. Admitting it would make the law demand a
      // change with no defect behind it.
      const NO_SPLIT = `
        export async function POST() {
          try { return NextResponse.json({ ok: true }); }
          catch (err) {
            if (err instanceof AnalyticsUpstreamError) {
              return NextResponse.json({ error: "Static.", code: err.seamCode ?? "UNKNOWN" }, { status: 502 });
            }
            return NextResponse.json({ error: "Static.", code: "UNKNOWN" }, { status: 500 });
          }
        }
      `;
      expect(isTerminalArmRoute(stripCommentsPreserveLines(NO_SPLIT, "ts"))).toBe(
        false,
      );
    });

    it("NEGATIVE: a terminal arm whose only err.message is in a COMMENT does not trip the companion law", () => {
      // This is the exact prose shape that sits beside four of the five real
      // arms. Scanned unstripped, the comment explaining that err.message must
      // NOT be echoed would itself register as an echo.
      const PROSE_ONLY = `
        export async function POST() {
          try { return NextResponse.json({ ok: true }); }
          catch (err) {
            if (err instanceof AnalyticsUpstreamError && err.status < 500) {
              return NextResponse.json({ error: err.message, code: err.seamCode ?? "UNKNOWN" });
            }
            // H-1062: echoing err.message here leaked Python contract-drift
            // strings and the service base URL. Keep it server-side only.
            return NextResponse.json({
              // The terminal arm — never err.message, only the code.
              error: "Static.",
              code: seamCode ?? "UNKNOWN",
            });
          }
        }
      `;
      const arm = findTerminalArm(stripCommentsPreserveLines(PROSE_ONLY, "ts"));
      expect(arm).not.toBeNull();
      expect(arm!.region).not.toContain(".message");

      // ...and the SAME source scanned WITHOUT stripping does contain it, which
      // is what makes the strip load-bearing rather than decorative.
      const unstripped = findTerminalArm(PROSE_ONLY);
      expect(unstripped!.region).toContain(".message");
    });
  });

  // -------------------------------------------------------------------------
  // The population is real, and it is the measured one.
  // -------------------------------------------------------------------------
  describe("the population is real, and it is the measured one", () => {
    it("is NOT empty — an empty-set law passes trivially and guards nothing", () => {
      expect(
        DERIVED_ROUTES.length,
        "The scanner found no routes carrying the 4xx-forward / 5xx-terminal " +
          "shape at all. Either every one was rewritten (in which case delete " +
          "this law deliberately) or the scanner broke — and a broken scanner " +
          "makes every assertion below pass vacuously.",
      ).toBeGreaterThan(0);
    });

    it("has exactly the hand-typed measured size", () => {
      expect(
        DERIVED_ROUTES.length,
        `Expected ${EXPECTED_ROUTE_COUNT} routes carrying the shape; found ` +
          `${DERIVED_ROUTES.length}: ${DERIVED_ROUTES.join(", ")}. A SIXTH is ` +
          "not a literal to bump — it is a sixth place the terminal collapse " +
          "can regrow, and it needs the same deliberate decision the other " +
          "five got. Read the two near-misses in this file's docblock first.",
      ).toBe(EXPECTED_ROUTE_COUNT);
    });

    it("is exactly the hand-typed roster, by path", () => {
      expect(DERIVED_ROUTES).toEqual([...EXPECTED_ROUTES]);
    });
  });

  // -------------------------------------------------------------------------
  // THE LAW.
  // -------------------------------------------------------------------------
  describe("every member's terminal arm forwards the seam's own code", () => {
    it.each([...EXPECTED_ROUTES])(
      "%s — the terminal code channel READS seamCode, and is not a bare literal",
      (route) => {
        const arm = findTerminalArm(readStripped(route));
        expect(arm, `no terminal NextResponse.json found in ${route}`).not.toBeNull();

        const expression = arm!.codeExpression ?? "";
        expect(
          expression.length,
          `${route}'s terminal arm has no code: channel at all`,
        ).toBeGreaterThan(0);

        expect(
          /^"[^"]*"$/.test(expression),
          `${route}'s terminal arm hard-codes a bare string (${expression}). ` +
            "That is the WIZERR-06 collapse: a 5xx the service classified " +
            "precisely reaches the client as 'we could not classify this'. " +
            "Forward the code the 4xx arm above already forwards.",
        ).toBe(false);

        expect(
          /\bseamCode\b/.test(expression),
          `${route}'s terminal code expression (${expression}) does not read ` +
            "seamCode. The collapse regrows exactly here.",
        ).toBe(true);
      },
    );
  });

  describe("COMPANION LAW — no member's terminal arm reads err.message", () => {
    it.each([...EXPECTED_ROUTES])(
      "%s — the terminal region contains no .message read (comment-stripped)",
      (route) => {
        const arm = findTerminalArm(readStripped(route));
        expect(arm).not.toBeNull();
        expect(
          arm!.region,
          `${route}'s terminal region reads .message. On a 5xx that value ` +
            "carries FastAPI detail, the parseResponse() contract-drift string " +
            "and the analytics service's base URL (H-1062 at bridge, F5b at " +
            "keys/validate-and-encrypt). WIZERR-06 widened the CODE only — the " +
            "message restriction was NOT relaxed alongside it.",
        ).not.toContain(".message");
      },
    );

    it("SELF-TEST — comment-stripping is doing real work on the REAL sources", () => {
      // Re-measured every run so the docblock's claim cannot go stale. At
      // 2026-08-24 the unstripped count was 2 of 5 — bridge 2 occurrences,
      // simulator 1, the other three 0 — and all three occurrences are comments
      // stating that err.message must NOT be echoed there.
      const unstrippedOffenders = EXPECTED_ROUTES.filter((route) => {
        const raw = readFileSync(join(REPO_ROOT, route), "utf8");
        return findTerminalArm(raw)?.region.includes(".message") ?? false;
      });

      expect(
        unstrippedOffenders.length,
        "No member's terminal region mentions .message in prose any more, so " +
          "the comment strip is no longer demonstrably load-bearing on real " +
          "source. That is not necessarily a defect — but re-read the " +
          "synthetic negative above and confirm it still covers the hazard " +
          "before assuming this file is safe without the strip.",
      ).toBeGreaterThan(0);

      // ...and the stripped scan clears every one of them.
      for (const route of unstrippedOffenders) {
        expect(findTerminalArm(readStripped(route))!.region).not.toContain(
          ".message",
        );
      }
    });
  });
});
