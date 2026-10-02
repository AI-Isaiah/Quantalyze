// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 146.1 / B2 (2026-08-18) — NO `src/` FILE MAY PUT A LIVE END-USER
 * SUPABASE JWT ON THE Vercel→Railway WIRE.
 *
 * ── THE ADJUDICATION THIS FILE ENFORCES ──────────────────────────────────────
 *
 * Phase 19.1 taught `process-key-client` to forward the end user's Supabase
 * access token as `X-User-Access-Token`, so the analytics service could build a
 * user-scoped, RLS-enforcing client and satisfy `auth.uid() = p_user_id` on
 * SECURITY DEFINER RPCs. TS-15 (140.3-02) then extended that forward to
 * `keys/sync` and `verify-strategy`.
 *
 * The v1.19 xhigh review measured the FAR side and found the transport had no
 * consumer at all:
 *
 *   · `analytics-service/services/db.py`'s `get_user_scoped_supabase` — the
 *     only reader — has had ZERO production callers since Phase 145 deleted the
 *     csv-finalize branch that used it;
 *   · `analytics-service/tests/test_process_key.py` (~:2220) actively PINS that
 *     non-use with `not hasattr(process_key_module, "get_user_scoped_supabase")`;
 *   · nothing else in `analytics-service` reads the header — only that one
 *     docstring even mentions it.
 *
 * So a LIVE end-user JWT was crossing a service boundary on every resync and
 * every session-bearing teaser submit, and being read by nobody: pure exposure
 * surface. Option (a) — STOP forwarding — was taken, and the Phase 140.2
 * obligation was amended in the same commit
 * (`.planning/phases/140.1-.../140.1-TS-OBLIGATIONS.md`, TS-15).
 *
 * Option (b) — genuinely WIRING the user-scoped client — was NAMED AND NOT
 * TAKEN. It would require flipping that Python non-use gate and an RLS analysis
 * for every read that would newly run as the user rather than `service_role`.
 * It remains available; `get_user_scoped_supabase` was deliberately NOT deleted.
 *
 * ── WHY A GATE AND NOT JUST A DIFF ───────────────────────────────────────────
 *
 * The removal is three lines in two routes. Re-adding it is also three lines,
 * and it would look like a helpful fix to whoever hits a 42501. This gate makes
 * that re-addition a CONSCIOUS act: the emitter set is DERIVED FROM DISK and
 * compared to an EMPTY roster BY EQUALITY, so a new emitter reds CI by name and
 * its author has to come here and write down why.
 *
 * ⛔ THIS FILE DOES NOT FORBID THE HEADER NAME. `resilient-fetch.ts` keeps
 * `x-user-access-token` in `CREDENTIAL_HEADER_NAMES` ON PURPOSE — that scrub
 * DERIVES its per-request secrets from the outgoing headers, so an entry with
 * no current emitter costs one array member and covers the next one
 * automatically. Pruning it would convert a class fix into an instance fix. The
 * corroborator below asserts that entry is still findable, which is also what
 * proves this scanner is reading the right files at all.
 */

// ---------------------------------------------------------------------------
// Population, DERIVED FROM DISK. Never hand-typed.
// ---------------------------------------------------------------------------

const SRC_ROOT = "src";

/**
 * Strip comments before scanning.
 *
 * ⚠️ LOAD-BEARING, NOT COSMETIC, AND THIS EXACT POPULATION PROVES IT. The B2
 * change deliberately left LONG provenance comments naming
 * `X-User-Access-Token` at each site the forward was removed from — in
 * `keys/sync/route.ts`, `verify-strategy/route.ts`, `process-key-client.ts`,
 * `resilient-fetch.ts` and `seam-redaction.ts`. An unstripped scan would read
 * those comments as EMITTERS and report this class open while it is closed —
 * the mirror image of `seam-ratelimit-posture.invariant.test.ts`'s finding,
 * where an unstripped scan reported a class CLOSED while it was open. Both
 * polarities are self-tested at the bottom of this file.
 *
 * Duplicated rather than imported from that sibling on purpose: a test file
 * must not import another test file, and two independent scanners that agree
 * are worth more than one shared helper whose single bug blinds both.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

/**
 * An EMITTER: source that SETS this header on an outgoing request object.
 *
 * Matches the two shapes this repo can express it in — a quoted object key
 * (`"X-User-Access-Token": value`) and a `Headers`/`set`-style call
 * (`.set("X-User-Access-Token", value)`) — case-insensitively, because HTTP
 * header names are case-insensitive on the wire and a lower-cased re-add would
 * be sent exactly the same way.
 *
 * ⛔ A BARE MENTION IS NOT AN EMITTER, AND THIS DISTINCTION WAS MEASURED, NOT
 * ASSUMED. `CREDENTIAL_HEADER_NAMES` in `resilient-fetch.ts` lists the name as
 * a SCRUB TARGET — `"x-user-access-token",` — and the first draft of this
 * pattern accepted a trailing comma, so it flagged that defence as an emitter
 * and the empty-roster equality demanded deleting the very thing that keeps the
 * class closed. The corroborator below caught it. What separates the two is
 * what FOLLOWS the name: a `:` assigns a value to a header key, a `,` after a
 * bare string is list membership.
 */
const EMITTER_PATTERN = new RegExp(
  [
    // Object-literal header key: `"X-User-Access-Token": value`
    `["']x-user-access-token["']\\s*:`,
    // Headers API: `.set("X-User-Access-Token", value)` / `.append(...)`
    `\\.(?:set|append)\\(\\s*["']x-user-access-token["']\\s*,`,
  ].join("|"),
  "i",
);

/** The scrub-list entry: the name as a bare array member, no value assigned. */
const SCRUB_LIST_PATTERN = /["']x-user-access-token["']\s*,?\s*$/im;

interface FileScan {
  /** Repo-relative path, e.g. `src/lib/process-key-client.ts`. */
  path: string;
  /** Source with comments blanked out. */
  code: string;
}

function deriveSourceFiles(root: string): string[] {
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      // Tests are EXCLUDED from the emitter population on purpose: the seam
      // suites deliberately embed this header name in fixtures and assertions,
      // and a gate that counted those would be unsatisfiable while the
      // regression coverage exists.
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      if (rel.includes("/__tests__/")) continue;
      paths.push(rel);
    }
  };
  walk(root);
  return paths.sort();
}

const SOURCE_FILES: FileScan[] = deriveSourceFiles(SRC_ROOT).map((path) => ({
  path,
  code: stripComments(readFileSync(join(process.cwd(), path), "utf8")),
}));

const EMITTERS = SOURCE_FILES.filter((f) => EMITTER_PATTERN.test(f.code)).map(
  (f) => f.path,
);

/**
 * The roster of files permitted to put a live end-user Supabase JWT on the
 * Vercel→Railway wire.
 *
 * ⭐ EMPTY, AND COMPARED BY EQUALITY RATHER THAN CONTAINMENT. Containment would
 * let a stale exemption outlive the thing it exempted; equality forces this
 * roster to SHRINK in the same commit as the code, which is exactly the
 * discipline `NO_LIMITER_QUARANTINE` in
 * `seam-ratelimit-posture.invariant.test.ts` already enforces next door.
 *
 * ⛔ A NEW ENTRY HERE MEANS A LIVE END-USER JWT IS CROSSING A SERVICE BOUNDARY
 * AGAIN. Before adding one, establish that something on the far side actually
 * READS it — the last time this was true, nothing did, for two whole phases.
 * If you are adding an entry because a SECURITY DEFINER RPC answered 42501,
 * that is option (b) above and it needs the RLS analysis and the founder call,
 * not a one-line re-add. Write the reason down beside this roster either way.
 */
const EXPECTED_JWT_EMITTERS: readonly string[] = [];

describe("[146.1 / B2] structural — no src/ file forwards a live end-user Supabase JWT to the analytics service", () => {
  it("the scan is not vacuous (a walker that stopped walking agrees with every assertion below it, forever)", () => {
    // ⚠️ THE FENCE, NOT THE MEASUREMENT. Measured 2026-08-18: 900+ non-test
    // `.ts`/`.tsx` files under `src/`. The bound is deliberately far looser
    // than that so ordinary growth or pruning never reddens this file — what it
    // exists to catch is a walker that visited nothing, or a filter that
    // excluded everything, either of which makes the empty-roster equality
    // below trivially true.
    expect(
      SOURCE_FILES.length,
      "the file walker visited almost nothing — every assertion below it is " +
        "vacuous until this is fixed, and an empty scan AGREES with an empty " +
        "roster",
    ).toBeGreaterThan(200);
  });

  it("the scanner is looking in the right place (a known, deliberate, NON-EMITTING occurrence is still found)", () => {
    // ⚠️ THIS IS THE COROBORATOR AND IT IS WHAT THE FENCE ABOVE CANNOT DO.
    // A walker can visit 900 files and still be blind if the needle stopped
    // matching — a renamed header, a changed quote style, a regex typo. So
    // assert a KNOWN occurrence is still visible: `resilient-fetch.ts` keeps
    // `x-user-access-token` in CREDENTIAL_HEADER_NAMES on purpose (the scrub
    // derives per-request secrets from outgoing headers, so an emitter-less
    // entry covers whatever the seam carries next).
    const core = SOURCE_FILES.find(
      (f) => f.path === "src/lib/resilient-fetch.ts",
    );
    expect(
      core,
      "src/lib/resilient-fetch.ts was not visited — the walker's root or its " +
        "extension filter is wrong, so nothing below this line means anything",
    ).toBeDefined();
    expect(
      SCRUB_LIST_PATTERN.test(core!.code),
      "`x-user-access-token` is GONE from resilient-fetch.ts's " +
        "CREDENTIAL_HEADER_NAMES. That is an INSTANCE fix that re-opens the " +
        "class: the scrub derives its per-request secrets from the outgoing " +
        "headers, so the entry costs one array member and covers the next " +
        "emitter automatically. Restore it. (If this reddened because the " +
        "constant was renamed rather than pruned, update SCRUB_LIST_PATTERN — " +
        "but verify the entry really is still there first.)",
    ).toBe(true);
    // …and the scrub-list occurrence must NOT be counted as an emitter, or the
    // equality below would demand deleting the defence.
    expect(
      EMITTER_PATTERN.test(core!.code),
      "the emitter pattern matched resilient-fetch.ts's scrub LIST. It is " +
        "supposed to match only an ASSIGNMENT of the header on an outgoing " +
        "request — tighten it, do not delete the scrub entry.",
    ).toBe(false);
  });

  it("the emitter set equals the EMPTY roster, by equality and not containment", () => {
    expect(
      EMITTERS,
      "A live end-user Supabase JWT is being put on the Vercel→Railway wire " +
        "again. As of Phase 146.1 / B2 the only reader on the far side " +
        "(analytics-service/services/db.py get_user_scoped_supabase) has ZERO " +
        "callers, and a Python gate pins that non-use — so this header is sent " +
        "and never read. If you MEANT to re-open this transport, add the file " +
        "to EXPECTED_JWT_EMITTERS with the reason, and say what reads it.",
    ).toEqual([...EXPECTED_JWT_EMITTERS]);
  });

  // -------------------------------------------------------------------------
  // Self-tests for the two mechanisms above. Both polarities, because a
  // comment-stripper that is too aggressive and one that is too lax fail in
  // opposite directions and only one of them is visible in the numbers.
  // -------------------------------------------------------------------------

  it("SELF-TEST: the emitter pattern fires on a real assignment shape", () => {
    expect(
      EMITTER_PATTERN.test('"X-User-Access-Token": args.userAccessToken'),
    ).toBe(true);
    expect(EMITTER_PATTERN.test('"x-user-access-token": token')).toBe(true);
    // The Headers-API shape, which no caller uses today but which would send
    // the header just as effectively as an object key.
    expect(
      EMITTER_PATTERN.test(
        'h.set("X-User-Access-Token", session.access_token)',
      ),
      "the Headers API is a second way to emit this header and the gate is " +
        "blind to it",
    ).toBe(true);
  });

  it("SELF-TEST: the emitter pattern does NOT fire on a scrub-list membership", () => {
    const scrubList = [
      "const CREDENTIAL_HEADER_NAMES: readonly string[] = [",
      '  "authorization",',
      '  "x-user-access-token",',
      "];",
    ].join("\n");
    // The list entry ends in `,` — deliberately NOT matched, because a comma
    // after a bare string is membership, not assignment.
    expect(
      EMITTER_PATTERN.test(stripComments(scrubList)),
      "the emitter pattern counts scrub-list membership as an emission",
    ).toBe(false);
  });

  it("SELF-TEST: stripComments blanks a commented-out emitter (the too-lax direction)", () => {
    const commented = '  // "X-User-Access-Token": args.userAccessToken,';
    expect(
      EMITTER_PATTERN.test(commented),
      "precondition: the raw line DOES look like an emitter",
    ).toBe(true);
    expect(
      EMITTER_PATTERN.test(stripComments(commented)),
      "a line-comment mentioning the header is being counted as a live " +
        "emitter — the B2 provenance comments would red this gate forever",
    ).toBe(false);
  });

  it("SELF-TEST: stripComments blanks a block-comment emitter too", () => {
    const block = ["/**", ' * "X-User-Access-Token": tok,', " */"].join("\n");
    expect(EMITTER_PATTERN.test(stripComments(block))).toBe(false);
  });

  it("SELF-TEST: stripComments does NOT eat real code (the too-aggressive direction)", () => {
    const live = ["const h = {", '  "X-User-Access-Token": tok,', "};"].join(
      "\n",
    );
    expect(
      EMITTER_PATTERN.test(stripComments(live)),
      "the stripper ate executable code — this gate would then report the " +
        "class closed while a real emitter shipped",
    ).toBe(true);
  });
});
