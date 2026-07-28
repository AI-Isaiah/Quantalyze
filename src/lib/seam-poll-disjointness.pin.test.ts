import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 140.3 / plan 16, RE-TIERED at gap closure (plan 140.3-G1) — NEGATIVE
 * PIN: the poll paths are structurally disjoint from the breaker-feeding paths.
 *
 * ⚠️ WHAT CHANGED AT GAP CLOSURE, AND WHY
 * ---------------------------------------
 * This file used to assert "ZERO fetch calls exist on the poll path". **That
 * claim was FALSE at file granularity.** `SyncPreviewStep.tsx` — a module on
 * this file's own roster — makes three real network calls, two of them to
 * `/api/keys/sync`, which IS a seam route. The assertion passed anyway because
 * its needle was `/\bfetch\s*\(/` and every one of those calls is spelled
 * `wizardFetch(`. The guard stayed green under the exact mutation it existed to
 * prevent.
 *
 * Widening the needle does not repair that: the file-scoped property is simply
 * not true, so a wider needle reddens on a clean tree. The property that IS true
 * is **tick-scoped** — *the repeating poll tick must not target a seam route,
 * while the user-initiated kickoff may* — and tick-ness is a runtime fact about
 * WHEN a callback fires, not a lexical fact about a file. That half now lives at
 * runtime in
 * `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.poll-disjointness.runtime.test.tsx`.
 *
 * What is left here is the SOURCE BACKSTOP, and it is deliberately kept: it
 * covers the two roster modules the runtime pin does not render, and it catches
 * an edit made without running the render suite. Its claim is now the honest,
 * checkable one — an inverted ALLOW-LIST of the `/api/` URLs the poll path may
 * name at all, with each entry's seam-ness hand-typed and independently checked
 * against the seam-route set derived from disk.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The wizard's sync poll runs every few seconds for up to fifteen minutes while
 * a strategy computes. Its authoritative data source is Supabase, read directly.
 * The stall backstop that decides "this has taken too long" is wall-clock
 * arithmetic over `RETRY_THRESHOLD_MS`, not a seam response.
 *
 * That disjointness is why **no retry storm is possible from the poll.** If the
 * poll went through a seam route, then during an analytics outage every waiting
 * wizard in every open tab would hammer the seam on a 3–10 second cadence:
 * each tick would record a failure, the breaker would re-arm continuously, and
 * the poll would itself become the thing keeping the circuit open. The outage
 * would be extended by our own recovery UI, and the more users were affected
 * the longer it would last.
 *
 * Nothing enforced that. This file is the fence.
 *
 * ⚠️ THE ONE RULE THAT MAKES THIS FILE WORK
 * -----------------------------------------
 * **Every expectation below is a hand-typed literal**, including the roster of
 * poll modules and the expected call count. `expect(found.length).toBe(
 * discovered.length)` is the shape to forbid — it is satisfied by any list,
 * including one that has silently grown a seam call, and it reads as coverage
 * while asserting nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PIN DOES **NOT** PROVE — read this before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the honest part, and it matters more than the assertions.
 *
 *  1. **It is a SOURCE scan over a HAND-TYPED roster of three files.** It proves
 *     those three modules contain no seam call. It does NOT prove no other
 *     component in the repo polls anything — a fourth poller added tomorrow in a
 *     new file is invisible here until someone adds it to the roster. The roster
 *     is hand-typed on purpose (see the rule above), and that choice buys
 *     falsifiability at the cost of coverage. Both halves are stated.
 *  2. **It checks DIRECT calls and DIRECT import edges only.** A poll module
 *     that called a local helper which in turn called the seam would pass. There
 *     is no such helper today; there is also no graph walk here that would find
 *     one.
 *  3. **It does not prove the poll is harmless in general** — only that it
 *     cannot feed the breaker. Poll cadence, Supabase load, and the fifteen-
 *     minute patience window are all outside this file.
 *  4. **It proves nothing about runtime, and it no longer pretends to.** It
 *     observes which URLs the poll modules NAME, not which of them a repeating
 *     tick actually requests. The tick-scoped property is proven at runtime in
 *     `SyncPreviewStep.poll-disjointness.runtime.test.tsx`; this file is the
 *     source backstop beside it. Read the two together — neither is sufficient
 *     alone, which is why both exist.
 *  5. **The wall-clock assertion is structural.** It pins that the stall
 *     threshold is a numeric constant compared against elapsed time. It does not
 *     prove the timer is correct, only that its input is a clock rather than a
 *     seam response.
 *  6. **The URL allow-list is a LEXICAL set, not a call graph.** It knows which
 *     `/api/` strings appear in the roster's source. It cannot tell which of
 *     them is on the tick, and a URL assembled from fragments at runtime would
 *     be invisible to it. Both of those are the runtime pin's job.
 *
 * A pin that overclaims is worse than no pin, because the next reader stops
 * checking. The six limits above are the reason this docblock is longer than
 * the assertions.
 */

/**
 * Hand-typed roster: every module on the wizard sync-poll path.
 *
 * - `useStrategySyncPoller.ts` is the poll ENGINE — the self-scheduling timer,
 *   the status read and the consecutive-error escalation all live here.
 * - `SyncPreviewStep.tsx` is the wizard's consumer of that engine, and the file
 *   that owns the fifteen-minute stall backstop.
 * - `SyncProgress.tsx` is the engine's OTHER consumer, outside the wizard. It is
 *   on the roster precisely because it is the one a reader thinking only about
 *   the wizard would forget, and a poller is dangerous wherever it runs.
 *
 * ⚠️ TYPED OUT, NOT DISCOVERED. A roster built by grepping for "poll" is the
 * grep again, and would silently admit a module that stopped matching.
 */
const POLL_PATH_MODULES: readonly string[] = [
  "src/hooks/useStrategySyncPoller.ts",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
  "src/components/strategy/SyncProgress.tsx",
];

/**
 * Hand-typed INVERTED ALLOW-LIST: the complete set of `/api/` URLs the poll
 * path is permitted to name, each with its seam-ness typed out by a human.
 *
 * ⚠️ THIS REPLACED A HAND-TYPED `0`. The old constant asserted that the poll
 * path made zero network calls. It makes three. A hand-typed literal that is not
 * the truth is worse than no literal, because it reads as a pinned fact and
 * trains the next reader to believe the scan beneath it.
 *
 * Inversion is the repo's own precedent for this shape:
 * `scripts/check-admin-route-manifest.ts:298-322` treats "no known mechanism
 * matched" as a HARD ERROR rather than a pass. Here the same idea: a URL the
 * poll path names that nobody typed out below is a failure, not a shrug.
 *
 * The `seam` flag is the negative discriminator and it is checked INDEPENDENTLY,
 * against the seam-route set derived from disk. If
 * `/api/strategies/[id]/sync-progress` ever acquires a seam import, this file
 * reddens even though not one URL string changed.
 */
const ALLOWED_POLL_PATH_URLS: ReadonlyArray<{
  url: string;
  seam: boolean;
  why: string;
}> = [
  {
    url: "/api/keys/sync",
    seam: true,
    why:
      "user-initiated kickoff (SyncPreviewStep.tsx:582) and explicit retry " +
      "(:1230). NOT on the tick — the tick-scoped proof lives in the runtime pin.",
  },
  {
    url: "/api/strategies/*/sync-progress",
    seam: false,
    why: "the piggybacked tick read (:745)",
  },
];

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/** Matches the IMPORT EDGE, never a bare mention — see the SSR pin for why. */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/** The data source the poll is allowed to have. */
const SUPABASE_CLIENT_EDGE = /from\s*["']@\/lib\/supabase\/client["']/;

/**
 * Strip comments before matching.
 *
 * ⚠️ NOT COSMETIC HERE. `SyncPreviewStep.tsx` carries a docblock that names
 * `process-key-client` while explaining the envelope it renders, and this file's
 * own subject matter guarantees more such prose over time. An unstripped scan
 * would report a comment as a seam call — and the natural "fix" for a guard that
 * cries wolf is to delete it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

const SOURCE = new Map<string, string>(
  POLL_PATH_MODULES.map((f) => [
    f,
    stripComments(readFileSync(join(process.cwd(), f), "utf8")),
  ]),
);

// ---------------------------------------------------------------------------
// Seam-route set — DERIVED FROM DISK, never hand-typed.
//
// Duplicated (not imported) from the runtime pin on purpose: a test file must
// not import another test file, and two independent scanners that agree are
// worth more than one shared helper whose single bug blinds both tiers.
// ---------------------------------------------------------------------------

function deriveSeamRoutePaths(apiRoot: string): string[] {
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
      if (entry.name !== "route.ts") continue;
      if (!SEAM_IMPORT_EDGE.test(readFileSync(join(process.cwd(), rel), "utf8")))
        continue;
      paths.push(`/${rel.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")}`);
    }
  };
  walk(apiRoot);
  return paths.sort();
}

const SEAM_ROUTE_PATHS = deriveSeamRoutePaths("src/app/api");

/**
 * Segment-wise match. A `[bracketed]` segment on the ROUTE side and a `*`
 * segment on the URL side are each single-segment wildcards.
 *
 * ⚠️ SEGMENT-WISE IS LOAD-BEARING. `includes()` would classify
 * `/api/keys/syncing` as the seam route `/api/keys/sync`. Depth matters too: the
 * tick's target `/api/strategies/*​/sync-progress` has the same segment COUNT as
 * the seam route `/api/strategies/composite/add-key` and is told apart only at
 * the last segment.
 */
function isSeamRoutePath(url: string): boolean {
  const pathOnly = url.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
  const segs = pathOnly.split("/").filter(Boolean);
  return SEAM_ROUTE_PATHS.some((seamPath) => {
    const seamSegs = seamPath.split("/").filter(Boolean);
    if (seamSegs.length !== segs.length) return false;
    return seamSegs.every(
      (s, i) =>
        (s.startsWith("[") && s.endsWith("]")) || segs[i] === "*" || s === segs[i],
    );
  });
}

/**
 * Every `/api/…` string or template literal named in a comment-stripped module,
 * with `${…}` interpolations normalised to a `*` wildcard.
 */
function extractApiUrlLiterals(src: string): string[] {
  return [...src.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((m) =>
    m[1].replace(/\$\{[^}]*\}/g, "*"),
  );
}

// ---------------------------------------------------------------------------
// The CALL_EDGE needle + its yield bound.
// ---------------------------------------------------------------------------

/**
 * Matches a network call REGARDLESS OF WRAPPER SPELLING: any (optionally
 * dot-qualified) identifier whose last component ends in `fetch`/`Fetch` and is
 * immediately applied.
 *
 * The leading `(?:^|[^A-Za-z0-9_$])` is what stops `refetch` being read as
 * `fetch` with a two-character prefix — the same word-boundary discipline that
 * BL-01 in this repo's Deribit classifier settled on after a substring denylist
 * mis-fired.
 */
const CALL_EDGE = /(?:^|[^A-Za-z0-9_$])((?:[A-Za-z0-9_$]+\.)*[A-Za-z0-9_$]*[Ff]etch)\s*\(/gm;

/**
 * Callee names that END in `fetch` but are NOT network calls.
 *
 * Matched as WHOLE leaf identifiers, never as substrings. Re-derive both
 * populations before changing this set:
 *
 *   grep -rnoE 'prefetch\s*\(' --include='*.ts' --include='*.tsx' src/ | grep -v '\.test\.' | grep -v '/test/'
 *   grep -rnoE 'refetch\s*\('  --include='*.ts' --include='*.tsx' src/ | grep -v '\.test\.' | grep -v '/test/'
 *
 * ⚠️ No count is transcribed here on purpose. A number nobody can re-derive from
 * the line beside it rots the moment the code moves, and an earlier draft of
 * this very comment carried TWO wrong figures — both produced by a `grep -h`
 * whose `.test.` filter had no filenames left to filter. Run the commands.
 *
 * `refetch` is live production usage (react-query-style refresh callbacks).
 * `router.prefetch` is a live Next.js API that a contributor may reach for
 * tomorrow; it is hazard-SHAPED rather than currently present in production.
 */
const NEAR_MISS_CALLEES = new Set(["prefetch", "refetch"]);

function callEdgeSites(src: string): string[] {
  const sites: string[] = [];
  for (const m of src.matchAll(CALL_EDGE)) {
    const callee = m[1];
    const leaf = callee.split(".").pop() ?? callee;
    if (NEAR_MISS_CALLEES.has(leaf)) continue;
    sites.push(callee);
  }
  return sites;
}

/** The 19 production modules of the wizard, tests excluded. */
function wizardProductionFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        files.push(rel);
    }
  };
  walk("src/app/(dashboard)/strategies/new");
  return files;
}

const WIZARD_CORPUS = wizardProductionFiles();

describe("[140.3-16] NEGATIVE PIN: the poll path makes no seam call", () => {
  it("the roster is exactly three modules, and each one was actually read", () => {
    // Fail-loud: a renamed or moved file must break this pin rather than
    // silently reduce it to a scan over nothing. `readFileSync` above already
    // throws on a missing path; this pins the SIZE so a deletion is visible too.
    expect(POLL_PATH_MODULES).toHaveLength(3);
    for (const file of POLL_PATH_MODULES) {
      expect(
        (SOURCE.get(file) ?? "").length,
        `${file} read as empty. The scan below would be vacuous.`,
      ).toBeGreaterThan(500);
    }
  });

  it("the CALL_EDGE needle yields sites in a corpus that demonstrably has them (fail-loud)", () => {
    // ⚠️ THE CONTROL THAT WOULD HAVE CAUGHT THIS FILE'S OWN DEFECT AT AUTHORING
    // TIME, with no mutation and no revert: the SHIPPED needle `/\bfetch\s*\(/`
    // measures ZERO here, and would fail `0 >= 6` on an untouched tree. A needle
    // that finds nothing in a corpus full of call sites reports every file clean
    // forever — the failure mode that makes a source guard WORSE than no guard,
    // because it reads as protection while asserting nothing.
    //
    // ANALOG, and the thing this pin previously lacked:
    // `src/__tests__/critical-regressions.test.ts:134` pairs its negative (no
    // raw fetch in the two seam clients) with a POSITIVE ON THE SAME SUBJECT
    // (`/resilientFetch\s*\(/.test(src)` must be true), so a subject that
    // stopped calling the core reddens even when the negative needle has gone
    // blind. Compare the two implementations before weakening either.
    //
    // Both bounds are hand-typed WELL BELOW the measured actuals so ordinary
    // churn never touches them.
    expect(
      WIZARD_CORPUS.length,
      `The wizard corpus walk found almost nothing, so the yield bounds below ` +
        `are meaningless. Fix the walker before trusting this file.`,
    ).toBeGreaterThanOrEqual(12);

    const corpusSites = WIZARD_CORPUS.flatMap((f) =>
      callEdgeSites(stripComments(readFileSync(join(process.cwd(), f), "utf8"))),
    );

    expect(
      corpusSites.length,
      `The CALL_EDGE needle found no network call sites in the wizard corpus. ` +
        `That corpus contains many. A needle that yields nothing reports every ` +
        `file clean forever, which is exactly how the predicate this control ` +
        `replaced stayed green while the poll path made three real calls.`,
    ).toBeGreaterThanOrEqual(6);

  });

  it("the CALL_EDGE needle yields sites in SyncPreviewStep.tsx specifically (the wrapper discriminator)", () => {
    // Split out from the corpus bound above because the two fail for DIFFERENT
    // reasons and deserve different names on a red run: the corpus bound goes
    // red when the WALKER breaks, this one goes red when the NEEDLE is narrowed
    // back to something a wrapper defeats. The subject file spells every one of
    // its calls with a wrapper, so a wrapper-blind needle scores 0 here
    // specifically while the corpus bound could still be carried by other files.
    const stepSites = callEdgeSites(
      SOURCE.get(
        "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
      ) ?? "",
    );
    expect(
      stepSites.length,
      `The CALL_EDGE needle found no network call site in SyncPreviewStep.tsx, ` +
        `which makes several. The needle has been narrowed to a spelling this ` +
        `file does not use.`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("the CALL_EDGE needle matches every wrapper spelling and NOT a near-miss", () => {
    // Four-slot self-test in the idiom of `seam-ssr-exposure.pin.test.ts:237`,
    // extended with the discriminator this pin's ancestor never had.
    //
    // The NEGATIVE half is the load-bearing one: a guard that cries wolf on a
    // docblock or on a react-query refresh callback gets "fixed" by weakening
    // it, and the weakened version is what silently stops catching the real
    // thing.
    const hits = (fixture: string) => callEdgeSites(fixture).length > 0;

    // Canonical spelling.
    expect(hits(`const r = await fetch("/api/keys/sync");`)).toBe(true);
    // ⭐ THE DISCRIMINATOR. The wrapper is the ONLY network-call spelling in the
    // 19-file wizard corpus — re-derive with:
    //   grep -rhoE '[A-Za-z0-9_$.]*[Ff]etch\s*\(' 'src/app/(dashboard)/strategies/new' | sort | uniq -c
    // A needle keyed on the bare identifier passes every other row here and
    // fails only this one, which is precisely how the shipped predicate went
    // green under the hazard it existed to prevent.
    expect(hits(`const r = await wizardFetch("/api/keys/sync");`)).toBe(true);
    // Qualified global.
    expect(hits(`globalThis.fetch("/api/x")`)).toBe(true);

    // Prose without an application. Comment-stripping already removes most of
    // it, but the needle must not depend on that.
    expect(hits(`// this module does not fetch anything`)).toBe(false);
    // Near-miss, hazard-SHAPED: `router.prefetch` is a live Next.js API a
    // contributor may reach for tomorrow. It is not a seam call.
    expect(hits(`router.prefetch("/x")`)).toBe(false);
    // Near-miss, live in production: a refresh callback, not a network call.
    expect(hits(`refetch()`)).toBe(false);
  });

  it("every /api/ URL the poll path names is on the hand-typed allow-list, with its seam-ness pinned", () => {
    // INVERTED: an unlisted URL is a HARD FAILURE, not a shrug. This replaced a
    // claim ("ZERO fetch calls exist on the poll path") that was FALSE at HEAD —
    // the roster names two seam-route URLs and always did.
    const found = [
      ...new Set(
        POLL_PATH_MODULES.flatMap((file) =>
          extractApiUrlLiterals(SOURCE.get(file) ?? ""),
        ),
      ),
    ].sort();

    expect(
      found,
      `A NEW /api/ URL appeared on the wizard sync-poll path. Two questions, in ` +
        `order: (1) is it on the TICK, or on a user action? (2) is it a seam ` +
        `route? If both, that is the retry storm — the poll ticks every 3-10 ` +
        `seconds for up to fifteen minutes in every open tab, so during an ` +
        `analytics outage it records failures on that cadence, re-arms the ` +
        `breaker continuously and becomes the thing keeping the circuit open. ` +
        `The tick-scoped verdict is decided at runtime in ` +
        `SyncPreviewStep.poll-disjointness.runtime.test.tsx; this list only ` +
        `records that a human looked.`,
    ).toEqual([...ALLOWED_POLL_PATH_URLS.map((e) => e.url)].sort());

    // THE NEGATIVE DISCRIMINATOR, checked independently of the URL strings: each
    // entry's hand-typed seam flag against the seam-route set derived from disk.
    // If `/api/strategies/[id]/sync-progress` ever acquires a seam import, this
    // reddens even though not one URL literal changed — and that is the change
    // that would turn the tick into a breaker feeder.
    for (const entry of ALLOWED_POLL_PATH_URLS) {
      expect(
        isSeamRoutePath(entry.url),
        `${entry.url} (${entry.why}) is hand-typed as seam=${entry.seam}, but ` +
          `the seam-route set derived from src/app/api says otherwise. Either a ` +
          `route gained/lost a seam import edge, or this entry was typed wrong.`,
      ).toBe(entry.seam);
    }
  });

  it("no poll module imports a seam client — structural distance, NOT the retry-storm fence", () => {
    // ⚠️ WHAT THIS COVERS, STATED HONESTLY AFTER THE GAP-CLOSURE REVIEW.
    //
    // This predicate is KEPT — deleting a fence is how coverage disappears
    // silently — but it must stop READING as retry-storm coverage, which is how
    // it was read before. It is not, and it structurally cannot be: a browser
    // module reaches the seam over HTTP and leaves NO import edge behind. All
    // three roster modules are "use client", and ZERO "use client" production
    // modules in this repo carry a seam import edge. Re-derive that zero with a
    // one-line walk (do not trust this comment):
    //
    //   node -e 'const{readFileSync,readdirSync}=require("fs");const E=/from\s*["'"'"'](?:@\/lib\/|\.\/|\.\.\/)?(?:lib\/)?(?:analytics-client|resilient-fetch|process-key-client)["'"'"']/;const w=(d,o=[])=>{for(const e of readdirSync(d,{withFileTypes:true})){const r=d+"/"+e.name;if(e.isDirectory())w(r,o);else if(/\.tsx?$/.test(e.name)&&!e.name.includes(".test."))o.push(r)}return o};console.log(w("src").filter(f=>{const s=readFileSync(f,"utf8");return /^\s*["'"'"']use client["'"'"']/.test(s)&&E.test(s)}))'
    //
    // The load-bearing half is the ZERO, and the zero is what the assertion
    // below already states. The POPULATION size is deliberately not written
    // down: it is a number with no owner and no oracle, and a transcribed
    // integer that nobody re-derives is the class this phase's gap closure is
    // deleting elsewhere.
    //
    // WHERE THE REAL COVERAGE LIVES:
    //   - repo-wide import-edge exposure → `src/lib/seam-ssr-exposure.pin.test.ts`
    //     and `tests/lib/scripts/no-server-only-leak.test.ts`;
    //   - the retry-storm fence → `SyncPreviewStep.poll-disjointness.runtime.test.tsx`
    //     (runtime, tick-scoped) plus the URL allow-list above (source).
    const offenders = POLL_PATH_MODULES.filter((file) =>
      SEAM_IMPORT_EDGE.test(SOURCE.get(file) ?? ""),
    );

    expect(
      offenders,
      `A poll module imports a seam client directly. That is not the retry ` +
        `storm — a "use client" module would still call the seam over HTTP — ` +
        `but it is a module that can now run a seam call inside its own bundle, ` +
        `and the whole property on this roster is structural distance rather ` +
        `than discipline.`,
    ).toEqual([]);
  });

  it("the poll's data source is the Supabase browser client, at every module that reads", () => {
    // The positive counterpart. "No seam call" is an absence, and an absence is
    // also what a deleted poll produces — the M77c lesson from this phase's own
    // ledger. This asserts the mechanism that is SUPPOSED to be there, so a poll
    // that stopped reading anything at all cannot pass as a poll that reads
    // safely.
    const readers = POLL_PATH_MODULES.filter((file) =>
      SUPABASE_CLIENT_EDGE.test(SOURCE.get(file) ?? ""),
    );

    expect(
      readers,
      `Every module on this roster reads its data from @/lib/supabase/client. ` +
        `If one stopped, either the roster is stale or the poll acquired a new ` +
        `data source — and the second of those is the case this pin exists for.`,
    ).toEqual([
      "src/hooks/useStrategySyncPoller.ts",
      "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
      "src/components/strategy/SyncProgress.tsx",
    ]);
  });
});

describe("[140.3-16] NEGATIVE PIN: the stall backstop is wall-clock, not seam-driven", () => {
  const STEP = "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx";

  it("RETRY_THRESHOLD_MS is a numeric constant, not a value read off a response", () => {
    // Hand-typed on both sides: the name AND the number. If the patience window
    // is ever retuned, this literal changes in the same commit — which is the
    // point of pinning a number rather than asserting that some number exists.
    const src = SOURCE.get(STEP) ?? "";
    expect(
      src,
      `The stall threshold stopped being a local numeric constant. If it now ` +
        `comes from a response, the backstop is seam-driven: during an outage ` +
        `the very signal that should trigger "this is taking too long" is the ` +
        `signal that is missing.`,
    ).toContain("const RETRY_THRESHOLD_MS = 900_000;");
  });

  it("the retry affordance is gated on ELAPSED TIME, not on a seam status", () => {
    const src = SOURCE.get(STEP) ?? "";
    expect(
      src,
      `The wizard's retry affordance is no longer driven by elapsed wall-clock ` +
        `time. This is the client-side timer that C-7 in this phase's CONTEXT ` +
        `records as the real mechanism behind what reads like a "retry after" — ` +
        `none of the four wizard surfaces reads a Retry-After header here, and ` +
        `a change that made one do so needs to be a deliberate, reviewed one.`,
    ).toContain("elapsedMs >= RETRY_THRESHOLD_MS");
  });
});
