// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";
import {
  CSV_CAUSE_FALSE_AT_EMISSION,
  CSV_CAUSE_TRUE_AT_EMISSION,
} from "@/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope";

/**
 * 140.5-05 / SEAMPROSE-08 — EVERY WIZARD CLIENT OF A `rateLimitDenyJson` ROUTE
 * CONSULTS THE SHARED WIRE→WIZARD HOP. THE CLASS, NOT THE INSTANCE.
 *
 * ── THE RESIDUAL THIS CLOSES, IN ITS OWN WORDS ───────────────────────────────
 *
 * 140.4 shipped its fix round and recorded, verbatim: *"no guard asserts that
 * every wizard client consuming a `rateLimitDenyJson` route consults the shared
 * wire→wizard table, so the hole reopens at whichever client lacks the hop."*
 * It reopened at two of them. `CsvUploadStep` and `CsvSubmitStep` were measured
 * at **zero** references to `recogniseSeamErrorCode` while the other four had
 * it, which is mechanically why a forwarded 401 rendered *"Validation failed.
 * See per-row breakdown below."* with no breakdown and `correlation_id: —` on a
 * real founder CSV in a browser (DEF-140.4-C).
 *
 * The instance was fixable in one file. This guard is what makes "both clients"
 * a HELD property instead of a claim: it derives the client population from
 * disk on every run, so the SEVENTH client — the one nobody has written yet —
 * fails here BY NAME on the day it is written, rather than shipping a fifth
 * surface that renders our fault as the user's.
 *
 * ── HONEST STATEMENT OF SCOPE — READ BEFORE TRUSTING THIS FILE ───────────────
 *
 * ⚠️ **DECLARED BLINDNESS.** The route population is defined by a CALL to
 * `rateLimitDenyJson`. Routes that throttle only through `checkLimit` or
 * `withAuthLimited` are OUTSIDE it, and this guard says NOTHING about their
 * clients. That is not hypothetical: `strategies/finalize-wizard` throttles via
 * `checkLimit`, so `SubmitStep` — a real wizard client with a real roster and a
 * real hop — is not in the derived population here. **This guard is PARTIAL for
 * that family, in those words.** Widening it means widening the route predicate,
 * which is a one-line change to `DENY_CALL` plus a re-measured floor; it is not
 * done here because `withAuthLimited`'s default deny is a different artefact
 * with a different failure mode, and folding them together would make the
 * failure message unable to say which property broke.
 *
 * ⚠️ **SOURCE, NOT BEHAVIOUR.** Every assertion below reads text. That a client
 * *references* `recogniseSeamErrorCode` does not prove it renders the right
 * copy — the per-client behavioural cases in `CsvUploadStep.upstream-arm.
 * test.tsx`, `CsvSubmitStep.upstream-arm.test.tsx`, `ConnectKeyStep.test.tsx`
 * and `SyncPreviewStep`'s runtime specs are where that lives. The two tiers are
 * complementary and neither substitutes for the other.
 *
 * ── COVERAGE-LAW ROWS (CONTEXT §2) ──────────────────────────────────────────
 * The POPULATIONS are row 1 — derived from disk by the causal definition of
 * membership, so a new member arrives without an edit here. The ROSTERS this
 * guard checks (`KNOWN_*_CODES`, and the two CSV cause sets) are row 2 —
 * hand-typed and PARTIAL BY CONSTRUCTION. What the guard adds to them is
 * strictly FAIL-LOUD ARRIVAL: a roster that cannot silently miss a new member
 * is still a roster.
 *
 * ── DEF-16-2 IS LIVE IN THIS EXACT POPULATION, MEASURED ─────────────────────
 * Comment-stripping is not tidiness here. Under the three candidate predicates,
 * at the time of writing:
 *   · comment-stripped CALL scan  → **19** route files  ← the one used
 *   · raw CALL scan               → **20** — it admits `admin/match/eval`,
 *     whose only occurrence is the comment *"Same pairing as rateLimitDenyJson
 *     (…)"* and which **has no limiter at all**
 *   · raw bare-MENTION scan       → **21** — it also admits `bridge`, which
 *     mentions the symbol while explaining why it does NOT converge onto it
 * An unstripped scan therefore reports two routes as adopting a chokepoint they
 * do not call. Every count in this file publishes its predicate beside it.
 */

// ---------------------------------------------------------------------------
// PART 0 — the scanners. One comment handler (140.5-01's `source-scan.ts`),
// shared by every population below so a tokenizer fix reaches all of them.
// ---------------------------------------------------------------------------

function readStripped(relPath: string): string {
  return stripCommentsPreserveLines(
    readFileSync(join(process.cwd(), relPath), "utf8"),
    "ts",
  );
}

/**
 * A CALL, never a bare mention. The `\s*\(` is the whole difference between 19
 * and 21 — see the DEF-16-2 note above.
 */
const DENY_CALL = /\brateLimitDenyJson\s*\(/;

/**
 * A CALL to the hop. `\b` treats `.` as a word boundary, so this also matches a
 * qualified `x.recogniseSeamErrorCode(` — deliberately: a client that reaches
 * the shared table through an alias is still consulting it. What it does NOT
 * match is the bare identifier in a docblock, which is why four step files that
 * merely NAME the symbol in prose do not satisfy it once stripped.
 */
const HOP_CALL = /\brecogniseSeamErrorCode\s*\(/;

function walkFiles(dir: string, fileName: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      walkFiles(rel, fileName, acc);
      continue;
    }
    if (entry.name === fileName) acc.push(rel);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// PART 1 — the two DERIVED populations.
// ---------------------------------------------------------------------------

const ALL_ROUTE_FILES = walkFiles("src/app/api", "route.ts").sort();

/**
 * PREDICATE, published: every `src/app/api/**\/route.ts` whose COMMENT-STRIPPED
 * source contains a CALL to `rateLimitDenyJson`. Measured **19** at the time of
 * writing, out of 87 route files scanned.
 */
const DENY_ROUTE_FILES = ALL_ROUTE_FILES.filter((p) =>
  DENY_CALL.test(readStripped(p)),
);

/** `src/app/api/strategies/csv-validate/route.ts` → `/api/strategies/csv-validate` */
function routeUrlOf(routePath: string): string {
  return "/" + routePath.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
}

const WIZARD_STEPS_DIR = "src/app/(dashboard)/strategies/new/wizard/steps";

/**
 * PREDICATE, published: every non-test file directly under the wizard steps
 * directory whose COMMENT-STRIPPED source contains a URL LITERAL for one of the
 * derived routes above.
 *
 * ⚠️ NEEDLE CHOICE IS THE WHOLE MEASUREMENT (`contracts-registry.test.ts`
 * records the same lesson). A URL literal is the causal edge — it is what the
 * client actually fetches — whereas keying on the `wizardFetch` import would
 * admit any client that imports the helper for a different route entirely.
 * Measured **5** at the time of writing.
 */
const WIZARD_CLIENT_FILES = readdirSync(join(process.cwd(), WIZARD_STEPS_DIR))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => `${WIZARD_STEPS_DIR}/${f}`)
  .filter((p) => {
    const src = readStripped(p);
    return DENY_ROUTE_FILES.some((r) => {
      const url = routeUrlOf(r);
      return (
        src.includes(`"${url}"`) ||
        src.includes(`'${url}'`) ||
        src.includes(`\`${url}`)
      );
    });
  })
  .sort();

describe("[140.5-05 / SEAMPROSE-08] the populations are real (a scanner that matches nothing agrees forever)", () => {
  it("the route walk found a plausible number of rateLimitDenyJson routes", () => {
    // ⚠️ A FENCE, NOT THE MEASUREMENT. Measured 19 of 87 with the predicate
    // published in this file's header. The floor is deliberately looser so
    // ordinary growth does not redden the file; what it catches is a walker
    // that stopped walking or a needle that stopped matching, either of which
    // makes every assertion below trivially true.
    expect(
      ALL_ROUTE_FILES.length,
      "the route walk found fewer than 40 `route.ts` files under src/app/api — " +
        "the walker's root moved, and every population below is now vacuous.",
    ).toBeGreaterThanOrEqual(40);
    expect(
      DENY_ROUTE_FILES.length,
      "fewer than 12 routes call `rateLimitDenyJson` under the COMMENT-STRIPPED " +
        "call-site predicate (measured 19). Either the chokepoint was renamed, " +
        "or the needle stopped matching — in both cases the client population " +
        "derived from it collapses and this guard silently protects nothing.",
    ).toBeGreaterThanOrEqual(12);
    // Hand-typed anchors: the two routes this plan exists for must be in it.
    expect(DENY_ROUTE_FILES).toContain(
      "src/app/api/strategies/csv-validate/route.ts",
    );
    expect(DENY_ROUTE_FILES).toContain(
      "src/app/api/strategies/csv-finalize/route.ts",
    );
  });

  it("the client walk found the wizard clients of those routes", () => {
    expect(
      WIZARD_CLIENT_FILES.length,
      "fewer than 4 wizard step files were found fetching a `rateLimitDenyJson` " +
        "route (measured 5). The URL-literal needle stopped matching — most " +
        "likely because a step moved its URL into a constant — so the hop " +
        "assertion below is measuring an empty set.",
    ).toBeGreaterThanOrEqual(4);
  });

  it("the derived client population EQUALS the hand-typed roster (a new client fails BY NAME)", () => {
    // Hand-typed on purpose: deriving both sides would be two scanners agreeing
    // with each other, which is not evidence. A new wizard client of a
    // chokepoint route fails HERE, which forces a conscious decision about its
    // error arm rather than letting it inherit whatever its author typed.
    //
    // ⚠️ `SubmitStep.tsx` IS ABSENT AND THAT IS CORRECT, NOT AN OVERSIGHT. Its
    // route, `strategies/finalize-wizard`, throttles through `checkLimit` and
    // never calls `rateLimitDenyJson`, so it is outside this guard's declared
    // scope (see DECLARED BLINDNESS in the header). It has a hop and a roster
    // anyway; the agreement half below still checks its roster.
    expect(WIZARD_CLIENT_FILES).toEqual([
      `${WIZARD_STEPS_DIR}/ConnectKeyStep.tsx`,
      `${WIZARD_STEPS_DIR}/CsvSubmitStep.tsx`,
      `${WIZARD_STEPS_DIR}/CsvUploadStep.tsx`,
      `${WIZARD_STEPS_DIR}/MultiKeyConnectStep.tsx`,
      `${WIZARD_STEPS_DIR}/SyncPreviewStep.tsx`,
    ]);
  });
});

describe("[140.5-05 / SEAMPROSE-08] EVERY derived wizard client consults the shared wire→wizard hop", () => {
  it("no client is missing the hop", () => {
    const missing = WIZARD_CLIENT_FILES.filter(
      (p) => !HOP_CALL.test(readStripped(p)),
    );
    expect(
      missing,
      "A wizard client fetches a `rateLimitDenyJson` route but never CALLS " +
        "`recogniseSeamErrorCode`. Every seam wire code that route can forward " +
        "— `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`, `SEAM_MISCONFIGURED`, a nested " +
        "`service_error` whose code sits at `detail.code` — will reach this " +
        "surface as an unrecognised body and render whatever that arm's default " +
        "copy happens to be. That default is how a 401 came to read " +
        '"Validation failed. See per-row breakdown below." on a valid file. ' +
        "Add the hop; do NOT add the wire codes to the client's own roster " +
        "(that is coverage-law row 2, owed again at the next surface). " +
        `Offending files: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the hop needle is COMMENT-STRIPPED — both polarities", () => {
    // DEF-16-2, and it is a real shape in this exact population: four step
    // files name `recogniseSeamErrorCode` in their docblocks. An unstripped
    // scan would certify a client that only TALKS about the hop.
    const prose = `
      // This step should call recogniseSeamErrorCode(seamErrorCode(data)) one day.
      const code = data.code ?? "UNKNOWN";
    `;
    const real = `
      const code = recogniseSeamErrorCode(seamErrorCode(data));
    `;
    expect(HOP_CALL.test(stripCommentsPreserveLines(prose, "ts"))).toBe(false);
    expect(HOP_CALL.test(stripCommentsPreserveLines(real, "ts"))).toBe(true);
    // …and the unstripped source is what a naive scan would have seen.
    expect(HOP_CALL.test(prose)).toBe(true);
  });

  it("the deny needle is a CALL, not a mention — both polarities", () => {
    const mention = `// Same pairing as rateLimitDenyJson (see ratelimit.ts).\nreturn json(429);`;
    const call = `return rateLimitDenyJson(rl, { headers });`;
    expect(DENY_CALL.test(stripCommentsPreserveLines(mention, "ts"))).toBe(false);
    expect(DENY_CALL.test(stripCommentsPreserveLines(call, "ts"))).toBe(true);
    expect(DENY_CALL.test(mention)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — AGREEMENT (§13.1). The necessary property is AGREEMENT, never
// disjointness: where the two vocabularies overlap they must answer the same.
// ---------------------------------------------------------------------------

/**
 * Extract a named roster's ANSWERS from disk, comment-stripped.
 *
 * ⚠️ READ ON THE RIGHT SIDE OF THE SHAPE. A `Set` roster's members ARE its
 * answers (membership means "surface this string as the wizard code"); a
 * `Record` roster answers with its VALUES and is INDEXED by its KEYS. A
 * quoted-token scan over a Record reads only the values — the wrong side — and
 * `KNOWN_KICKOFF_CODES` proves the difference matters: it carries
 * `MISSING_STRATEGY_ID: "VALIDATION_FAILED"`, so a value-side read reports
 * `VALIDATION_FAILED` as a roster MEMBER and manufactures a PHANTOM OVERLAP
 * with the wire table that does not exist. That exact mistake was made once in
 * this phase and is why the vacuity fence below pins the key-side read.
 *
 * The initializer is found by BALANCED DELIMITER SCANNING rather than by a
 * terminator regex. `KNOWN_FINALIZE_CODES` is function-local and indented, and
 * a line-shaped terminator tuned to top-level declarations silently swallows or
 * truncates it.
 */
function extractRosters(
  relPath: string,
): Array<{ name: string; answers: Map<string, string> }> {
  const src = readStripped(relPath);
  const out: Array<{ name: string; answers: Map<string, string> }> = [];
  const decl = /const\s+(KNOWN_[A-Z0-9_]*CODES)\b/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src)) !== null) {
    const eq = src.indexOf("=", m.index + m[0].length);
    if (eq === -1) continue;
    // Walk to the first opening delimiter of the initializer, then to its match.
    let i = eq + 1;
    while (i < src.length && !"[{(".includes(src[i])) i++;
    if (i >= src.length) continue;
    const depthOf = new Map([
      ["[", "]"],
      ["{", "}"],
      ["(", ")"],
    ]);
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (depthOf.has(c)) depth++;
      else if ("]})".includes(c)) {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = src.slice(start, i + 1);
    const answers = new Map<string, string>();
    if (src.slice(eq, start).includes("new Set")) {
      for (const t of block.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)) {
        answers.set(t[1], t[1]);
      }
    } else {
      for (const t of block.matchAll(
        /^\s*([A-Z][A-Z0-9_]{2,})\s*:\s*"([A-Z][A-Z0-9_]{2,})"/gm,
      )) {
        answers.set(t[1], t[2]);
      }
    }
    out.push({ name: m[1], answers });
  }
  return out;
}

/** The ONE wire→wizard table, read from `wizardErrors.ts` on disk. */
function extractWireTable(): Map<string, string> {
  const src = readStripped("src/lib/wizardErrors.ts");
  const table = /SEAM_CODE_TO_WIZARD_CODE[\s\S]*?\]\s*\)\s*;/.exec(src);
  const out = new Map<string, string>();
  if (!table) return out;
  for (const e of table[0].matchAll(
    /\[\s*"([A-Z][A-Z0-9_]+)"\s*,\s*"([A-Z][A-Z0-9_]+)"\s*\]/g,
  )) {
    out.set(e[1], e[2]);
  }
  return out;
}

/**
 * Every non-test wizard step file — the roster scan's population.
 *
 * DELIBERATELY WIDER THAN THE CLIENT POPULATION ABOVE.
 * `seam-ratelimit-posture.invariant.test.ts` scans a HAND-TYPED list of three
 * files and pins that exactly four rosters exist; `KNOWN_FINALIZE_CODES` lives
 * in a fourth file and has never been inside any agreement check. Deriving the
 * file list closes that by construction.
 */
const ROSTER_SCAN_FILES = readdirSync(join(process.cwd(), WIZARD_STEPS_DIR))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => `${WIZARD_STEPS_DIR}/${f}`)
  .sort();

const WIRE_TABLE = extractWireTable();
const ROSTERS = ROSTER_SCAN_FILES.flatMap((f) =>
  extractRosters(f).map((r) => ({ ...r, file: f })),
);

describe("[140.5-05] AGREEMENT — where the roster and the wire table overlap, they answer the same", () => {
  it("VACUITY FENCE — both sides parsed, and the Record side parsed on its KEYS", () => {
    expect(
      [...WIRE_TABLE.keys()],
      "SEAM_CODE_TO_WIZARD_CODE was not found or not parsed — every agreement " +
        "assertion below is vacuous.",
    ).toContain("SEAM_MISCONFIGURED");
    expect(WIRE_TABLE.size).toBeGreaterThanOrEqual(7);
    expect(
      ROSTERS.map((r) => r.name).sort(),
      "the set of `KNOWN_*_CODES` rosters changed. Either one was renamed out " +
        "of the convention — in which case this scan no longer sees it and the " +
        "guard is silently narrower than it reads — or one was added without a " +
        "decision about its overlap with the wire vocabulary.",
    ).toEqual([
      "KNOWN_ADD_KEY_CODES",
      "KNOWN_CREATE_WITH_KEY_CODES",
      "KNOWN_CSV_FINALIZE_CODES",
      "KNOWN_CSV_VALIDATE_CODES",
      "KNOWN_FINALIZE_CODES",
      "KNOWN_KICKOFF_CODES",
      "KNOWN_SET_MEMBERS_CODES",
    ]);
    for (const r of ROSTERS) {
      expect(r.answers.size, `${r.name} parsed as EMPTY`).toBeGreaterThan(0);
    }
    // The Record-shaped roster, read on the KEY side. If this reads the value
    // side instead, `VALIDATION_FAILED` enters as a member and the overlap pin
    // below gains a third row that does not exist.
    const kickoff = ROSTERS.find((r) => r.name === "KNOWN_KICKOFF_CODES")!;
    expect(kickoff.answers.get("MISSING_STRATEGY_ID")).toBe("VALIDATION_FAILED");
    expect(kickoff.answers.has("VALIDATION_FAILED")).toBe(false);
    // The two new CSV rosters parsed with their real members.
    expect(
      ROSTERS.find((r) => r.name === "KNOWN_CSV_VALIDATE_CODES")!.answers.has(
        "CSV_FILE_TOO_LARGE",
      ),
    ).toBe(true);
    expect(
      ROSTERS.find((r) => r.name === "KNOWN_CSV_FINALIZE_CODES")!.answers.has(
        "CSV_PERSIST_FAIL",
      ),
    ).toBe(true);
  });

  it("no roster DISAGREES with the wire table on a code they both carry", () => {
    // The hop runs FIRST at every surface that has one, so where the two
    // vocabularies overlap the table wins and the roster's answer becomes
    // unreachable. Harmless while they agree; a silent copy swap the moment
    // they do not. Disjointness is sufficient and does NOT hold here;
    // agreement is necessary and is what is asserted (CONTEXT §5).
    const disagreements = ROSTERS.flatMap((r) =>
      [...r.answers.entries()]
        .filter(([code]) => WIRE_TABLE.has(code))
        .filter(([code, answer]) => WIRE_TABLE.get(code) !== answer)
        .map(
          ([code, answer]) =>
            `${r.name}.${code}: roster=${answer} wire=${WIRE_TABLE.get(code)}`,
        ),
    ).sort();
    expect(
      disagreements,
      "a roster and SEAM_CODE_TO_WIZARD_CODE answer DIFFERENTLY for a code " +
        "they both carry. Decide which vocabulary owns it — do not leave both.",
    ).toEqual([]);
  });

  it("records WHICH codes overlap today, so a NEW overlap is visible in review", () => {
    // A visibility property, not a safety one: an overlap is harmless only
    // while it agrees, and "it agrees" is easy to break by accident. Hand-typed
    // so a new overlap shows up as a diff on this line rather than as silence.
    //
    // MEASURED, with the KEY-side predicate stated above:
    //   · KNOWN_KICKOFF_CODES.RATE_LIMITED — the pre-existing one (CONTEXT §5).
    //   · KNOWN_FINALIZE_CODES.SEAM_MISCONFIGURED — the second, and the one no
    //     agreement check had ever covered, because the only guard that ran one
    //     scanned a hand-typed three-file list that omits `SubmitStep.tsx`.
    //   · The TWO CSV rosters, each ∩ = {SEAM_MISCONFIGURED}. ⭐ THIS OVERLAP IS
    //     LOAD-BEARING AND IS WHY THE CSV ARMS TRY THE ROSTER FIRST: the wire
    //     table maps the code to ITSELF, so the two sides agree and the choice
    //     of order cannot change the CODE — but it does change the COPY, because
    //     branch 1 renders the ROUTE's `human_message` and the hop renders the
    //     TABLE's. On both CSV routes the table's copy is false (the file is
    //     already buffered when the deny fires), so roster-first is what keeps
    //     the route's WR-07-corrected sentence on screen.
    //   · `CSV_RATE_LIMIT` does NOT appear, and its absence is asserted
    //     separately below — that absence is what routes it to the hop.
    //   · ⭐ KNOWN_FINALIZE_CODES.VALIDATION_FAILED — added 153.1-05, recorded
    //     here 153.1-06. THE DECISION THIS ROW RECORDS, and it was made
    //     deliberately at the source rather than discovered here: the wire
    //     table maps `VALIDATION_FAILED` to ITSELF, so the two sides agree and
    //     the code cannot change with the order (the agreement check above
    //     covers that). `finalize-wizard` MINTS this code at three of its own
    //     `validatePayload` arms — the body-shape arm, the `strategy_id` arm
    //     and the `entry_context` arm, whose values are never user-typed and so
    //     have no field to route to. `SubmitStep.tsx`'s roster comment states
    //     the reason for listing it anyway: this set is the ROUTE-MINTED
    //     vocabulary, and leaning on the wire table to carry a code we mint
    //     ourselves is the implicit coupling 140.4-12 spent a plan removing.
    //     ⚠️ THE ROSTER IS NOT THE ACTIVE PATH FOR IT — SubmitStep translates
    //     first, so the hop answers and the table's copy is what renders. That
    //     is acceptable here precisely BECAUSE the mapping is to itself; if it
    //     ever became a real alias, this row is where that would have to be
    //     re-decided.
    const overlaps = ROSTERS.flatMap((r) =>
      [...r.answers.keys()]
        .filter((code) => WIRE_TABLE.has(code))
        .map((code) => `${r.name}.${code}`),
    ).sort();
    expect(
      overlaps,
      "the set of roster↔wire overlaps changed. Extend this hand-typed oracle " +
        "DELIBERATELY, having decided which vocabulary owns the new code and " +
        "which copy the user should read.",
    ).toEqual([
      "KNOWN_CSV_FINALIZE_CODES.SEAM_MISCONFIGURED",
      "KNOWN_CSV_VALIDATE_CODES.SEAM_MISCONFIGURED",
      "KNOWN_FINALIZE_CODES.SEAM_MISCONFIGURED",
      "KNOWN_FINALIZE_CODES.VALIDATION_FAILED",
      "KNOWN_KICKOFF_CODES.RATE_LIMITED",
    ]);
  });

  it("⭐ CSV_RATE_LIMIT is in NO roster — the absence is the mechanism", () => {
    // 140.5-02 added `["CSV_RATE_LIMIT","RATE_LIMITED"]` to the wire table and
    // pinned the code's absence from `WIZARD_ERROR_COPY`. This is the other
    // half: the CSV arms try their roster BEFORE the table, so admitting this
    // code to either roster would keep the route's local copy and the
    // `Retry-After` the deny stamps would never reach the shared envelope —
    // which is the only CSV panel that can render a wait at all.
    const carriers = ROSTERS.filter((r) => r.answers.has("CSV_RATE_LIMIT")).map(
      (r) => r.name,
    );
    expect(
      carriers,
      "`CSV_RATE_LIMIT` was added to a client roster. That silently drops the " +
        "one wait the CSV surface advertises: the roster branch runs first, so " +
        "the code never reaches the wire table and the stamped `Retry-After` " +
        "is discarded. Its EXCLUSION is deliberate and is documented at both " +
        "roster declarations and at the wire-table row.",
    ).toEqual([]);
  });

  it("the agreement needle can actually fail (self-test)", () => {
    // Without this, "no disagreements" is indistinguishable from "the extractor
    // returned nothing". A synthetic roster answering a REAL wire code
    // differently must be caught by the SAME expression the case above uses.
    const synthetic = new Map([["SEAM_MISCONFIGURED", "UNKNOWN"]]);
    const caught = [...synthetic.entries()]
      .filter(([code]) => WIRE_TABLE.has(code))
      .filter(([code, answer]) => WIRE_TABLE.get(code) !== answer);
    expect(caught).toEqual([["SEAM_MISCONFIGURED", "UNKNOWN"]]);
  });
});

// ---------------------------------------------------------------------------
// PART 3 — ROSTER COMPLETENESS. The row-2 rosters' fail-loud arrival.
// ---------------------------------------------------------------------------

/**
 * PREDICATE, published: comment-strip the route source, then collect
 *   (a) the first string-literal argument of every `csvErrorEnvelope(` /
 *       `csvErrorBody(` call, and
 *   (b) every `code: "UPPER_SNAKE"` object property.
 *
 * (b) is not redundant: `csv-finalize` builds most of its envelopes with a bare
 * `NextResponse.json({ ok:false, code:"…" })` and never calls the helper, so a
 * call-only predicate would report that route as emitting almost nothing.
 *
 * ⚠️ ONE DYNAMIC EMITTER EXISTS AND IS NOT A GAP: `csv-finalize` forwards
 * `parsedSeries.code`, and `parseDailyReturnsSeries` only ever yields
 * `CSV_INVALID_FORMAT`, which the literal scan already finds at its own emit
 * sites inside that function.
 */
function deriveRouteCodes(relPath: string): Set<string> {
  const src = readStripped(relPath);
  const found = new Set<string>();
  for (const m of src.matchAll(
    /\b(?:csvErrorEnvelope|csvErrorBody)\s*\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
  )) {
    found.add(m[1]);
  }
  for (const m of src.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]{2,})"/g)) {
    found.add(m[1]);
  }
  return found;
}

/**
 * Exempt BY NAME, with the reason inline: the hop owns this code so that the
 * stamped wait renders. Every other emitted code must be in its client's roster.
 */
const ROSTER_EXEMPT_BY_NAME = "CSV_RATE_LIMIT";

const CSV_SURFACES = [
  {
    route: "src/app/api/strategies/csv-validate/route.ts",
    roster: "KNOWN_CSV_VALIDATE_CODES",
    client: `${WIZARD_STEPS_DIR}/CsvUploadStep.tsx`,
  },
  {
    route: "src/app/api/strategies/csv-finalize/route.ts",
    roster: "KNOWN_CSV_FINALIZE_CODES",
    client: `${WIZARD_STEPS_DIR}/CsvSubmitStep.tsx`,
  },
] as const;

describe("[140.5-05] ROSTER COMPLETENESS — each CSV client admits every code its route emits", () => {
  it.each(CSV_SURFACES)(
    "$roster covers every code $route emits",
    ({ route, roster }) => {
      const emitted = deriveRouteCodes(route);
      // Vacuity fence FIRST: measured 5 codes at csv-validate and 6 at
      // csv-finalize. A derivation that collapsed to nothing would make the
      // containment check below trivially true — the failure mode DEF-16-2
      // produced twice in this phase already.
      expect(
        emitted.size,
        `the emitted-code derivation for ${route} found fewer than 4 codes ` +
          `(found ${emitted.size}: ${[...emitted].sort().join(", ")}). The ` +
          "predicate — comment-stripped `csvErrorEnvelope(`/`csvErrorBody(` " +
          'first argument, plus `code: "…"` properties — stopped matching, so ' +
          "the completeness check below is measuring an empty set and would " +
          "pass on a roster that had lost every member.",
      ).toBeGreaterThanOrEqual(4);
      expect(
        emitted.has("SEAM_MISCONFIGURED"),
        `${route} no longer emits SEAM_MISCONFIGURED. That code arriving here ` +
          "is the whole reason the roster is consulted BEFORE the wire table; " +
          "if the route stopped emitting it, re-derive the order deliberately.",
      ).toBe(true);

      const rosterEntry = ROSTERS.find((r) => r.name === roster);
      expect(rosterEntry, `${roster} not found on disk`).toBeDefined();
      const missing = [...emitted]
        .filter((c) => c !== ROSTER_EXEMPT_BY_NAME)
        .filter((c) => !rosterEntry!.answers.has(c))
        .sort();
      expect(
        missing,
        `${route} emits a code its client's roster (${roster}) does not admit. ` +
          "The client's `!res.ok` arm tries the roster FIRST; a code the roster " +
          "misses falls through to the shared hop and then to the §4a founder " +
          "copy, so the user reads \"This is on our side, not your data\" for a " +
          "failure the route already explained in its own words. Add the code " +
          "to the roster in the SAME commit that adds its emitter. " +
          `(\`${ROSTER_EXEMPT_BY_NAME}\` is exempt BY NAME: the hop owns it so ` +
          "its stamped Retry-After reaches the shared envelope.)",
      ).toEqual([]);
    },
  );

  it("the emitted-code needle is COMMENT-STRIPPED — both polarities", () => {
    const prose = `// We used to answer csvErrorEnvelope("CSV_LEGACY_GONE", "…") here.\nreturn ok();`;
    const real = `return csvErrorEnvelope("CSV_INVALID_FORMAT", "Missing file field.");`;
    const codes = (s: string): string[] => {
      const stripped = stripCommentsPreserveLines(s, "ts");
      return [
        ...stripped.matchAll(
          /\b(?:csvErrorEnvelope|csvErrorBody)\s*\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
        ),
      ].map((m) => m[1]);
    };
    expect(codes(prose)).toEqual([]);
    expect(codes(real)).toEqual(["CSV_INVALID_FORMAT"]);
  });
});

// ---------------------------------------------------------------------------
// PART 4 — the CAUSE PARTITION. Fail-loud arrival for the panel's second line.
// ---------------------------------------------------------------------------

describe("[140.5-05] every CSV-emitted code WITH table copy has a decided cause disposition", () => {
  it("the two sets PARTITION the emitted ∩ copy-table intersection", () => {
    // ── WHY THIS EXISTS ──────────────────────────────────────────────────────
    // `CsvValidationEnvelope` renders the route's per-EMISSION `human_message`
    // as its heading and the code's per-CODE authored `cause` beneath it. Those
    // two can CONTRADICT, and one pair did on the untouched tree:
    // `SEAM_MISCONFIGURED`'s table cause says "Nothing was submitted … Retrying
    // will not clear it" directly under the route's "Nothing was saved … try
    // again in a minute". The suppression set fixes that instance; this
    // assertion is what stops the NEXT one shipping silently.
    //
    // An EQUALITY, not a containment check: a code that gains table copy later
    // must be classified in that commit, and a suppression whose code stopped
    // being emitted must be removed in the commit that removes the emitter.
    const src = readStripped("src/lib/wizardErrors.ts");
    const copyTable = new Set(
      [...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):\s*\{/gm)].map((m) => m[1]),
    );
    // Vacuity fence — the copy table has dozens of entries; a parse that found
    // a handful would make the intersection empty and the equality trivial.
    expect(
      copyTable.size,
      "the WIZARD_ERROR_COPY entry scan found fewer than 30 entries — the " +
        "needle stopped matching and this partition is vacuous.",
    ).toBeGreaterThanOrEqual(30);
    expect(copyTable.has("SEAM_MISCONFIGURED")).toBe(true);

    const emitted = new Set(
      CSV_SURFACES.flatMap((s) => [...deriveRouteCodes(s.route)]),
    );
    const withCopy = [...emitted].filter((c) => copyTable.has(c)).sort();
    const decided = [
      ...CSV_CAUSE_TRUE_AT_EMISSION,
      ...CSV_CAUSE_FALSE_AT_EMISSION,
    ].sort();

    expect(
      withCopy,
      "a code emitted by a CSV route has an entry in WIZARD_ERROR_COPY but no " +
        "decision about whether that entry's `cause` is TRUE at the route's " +
        "emission site. `CsvValidationEnvelope` will print it under the route's " +
        "own sentence. Read the two and add the code to " +
        "CSV_CAUSE_TRUE_AT_EMISSION or CSV_CAUSE_FALSE_AT_EMISSION — the panel " +
        "must not state something its own heading contradicts.",
    ).toEqual(decided);

    // The two sets are disjoint — a code cannot be both.
    for (const c of CSV_CAUSE_FALSE_AT_EMISSION) {
      expect(CSV_CAUSE_TRUE_AT_EMISSION.has(c)).toBe(false);
    }
    // And the suppression set is not empty, so the partition is not satisfied
    // by declaring everything true.
    expect(CSV_CAUSE_FALSE_AT_EMISSION.size).toBeGreaterThan(0);
  });
});
