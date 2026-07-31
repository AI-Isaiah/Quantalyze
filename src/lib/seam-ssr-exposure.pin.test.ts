import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 140.3 / plan 16 — NEGATIVE PIN: the seam has ZERO server-side exposure.
 *
 * WHAT THIS PROTECTS, AND WHY IT IS WORTH A FILE
 * ----------------------------------------------
 * Every seam call in this repo is made either from a route handler under
 * `src/app/api/` or from a `"use client"` component's `fetch`. **No server
 * component, no `page.tsx`, no `layout.tsx` and no Server Action reaches the
 * seam.** That is the single reason a breaker trip can never 500 a page: when
 * the analytics service is down the shell still renders, and the failure arrives
 * inside a component that can show a sentence and a retry. **No user is ever
 * locked out of the product by an analytics outage.**
 *
 * Nothing enforced that. It held by accident of how the code grew, and a single
 * server directive on a seam-touching module — or one seam import moved into a
 * server component "so we can render it on the server" — would end it silently,
 * with every existing test still green. This file is the fence.
 *
 * A `use server` directive is the sharp edge: it turns a module into a Server
 * Actions module, so its exports run on the server and any seam call inside them
 * throws during render rather than inside a client handler.
 *
 * ⚠️ THE ONE RULE THAT MAKES THIS FILE WORK
 * -----------------------------------------
 * **Every expectation below is a hand-typed literal.** No count is read from the
 * list it is checking. Asserting a found list's size against the size of the
 * list it was derived from is the shape to forbid: it is satisfied by ANY list,
 * including one that has silently grown a member, and it reads as coverage
 * while asserting nothing. The
 * allow-list is likewise typed out by hand rather than discovered — an
 * allow-list built by scanning is just the scan again, and the pin degrades to
 * `expect(true).toBe(true)`.
 *
 * ⚠️ THIS FILE DOES NOT CONTAIN THE DIRECTIVE IT SEARCHES FOR
 * -----------------------------------------------------------
 * The needles are ASSEMBLED at runtime from fragments, so this file's own bytes
 * never contain the quoted directive. That is deliberate and it is not a trick:
 * the repo-wide acceptance check for this property is a plain recursive grep for
 * the quoted directive across `src/`, and a guard that plants the very string it
 * forbids makes that check return 1 forever and trains the next reader to
 * ignore it. Seven executors in this phase were bitten by their own comments
 * matching their own greps. This file refuses to be the eighth — which is also
 * why neither the prose above nor below ever spells the directive in quotes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PIN DOES **NOT** PROVE — read this before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. **It checks DIRECT import edges only.** A server component that imports a
 *     helper that imports `resilient-fetch` is invisible here. Closing that
 *     needs a module-graph walk, which this file deliberately does not attempt —
 *     a half-working graph walk that silently resolves nothing is worse than an
 *     honest direct-edge scan.
 *  2. **It is a SOURCE scan, not a runtime proof.** It cannot observe that a
 *     page actually rendered without touching the seam; it observes that the
 *     code has no way to.
 *  3. **It says nothing about whether the seam calls that DO exist are correct.**
 *     Route arms, copy and envelopes are other requirements entirely
 *     (SEAMUX-03/04); this pin only cares WHERE the seam is reachable from.
 *  4. **A dynamic `await import()` of a seam module would evade the regex.**
 *     There are none today; if one appears, this pin will not see it.
 */

/**
 * The directive, assembled so this file's own bytes never carry it.
 *
 * Both quoting forms are checked. Prettier normalises to double quotes in this
 * repo, but a hand-edited file or a paste from the Next.js docs can arrive with
 * single quotes, and a needle that only knows one form is a fence with a gate in
 * it.
 */
const DIRECTIVE_BODY = `${"use"} ${"server"}`;
const DIRECTIVE_NEEDLES: readonly string[] = [
  `"${DIRECTIVE_BODY}"`,
  `'${DIRECTIVE_BODY}'`,
];

/**
 * Hand-typed. The number of files under `src/` that may carry a server
 * directive: none.
 *
 * This is the whole property in one integer. If the product ever legitimately
 * needs a Server Action, this literal changes in the SAME commit — and the
 * reviewer of that commit is then forced to answer whether the new server
 * module can reach the seam, which is the conversation this pin exists to
 * force.
 */
const EXPECTED_SERVER_DIRECTIVE_FILES = 0;

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/**
 * `import … from "@/lib/<seam module>"` or the relative form used inside
 * `src/lib`. Matches the IMPORT EDGE, never a bare mention.
 *
 * ⚠️ This distinction is the entire accuracy of the scan. Fourteen files under
 * `src/` name these modules in prose — `wizardErrors.ts` and `seam-errors.ts`
 * each carry a docblock explaining, at length, why they must NOT import them.
 * A substring grep reports all fourteen as violations, and the natural "fix" is
 * to weaken the guard until it stops complaining. The edge regex plus the
 * comment strip below is what keeps this file honest enough to be believed.
 */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/**
 * Hand-typed allow-list: the ONLY non-route files permitted a seam import edge.
 *
 * Both entries are seam modules themselves — `analytics-client.ts` and
 * `process-key-client.ts` are the two clients, and each imports
 * `resilient-fetch` because that is the transport they are built on. Excluding
 * them is excluding the subject from its own rule, not carving out an exception.
 *
 * ⚠️ TYPED OUT, NOT DISCOVERED. An allow-list computed by running the scan and
 * recording whatever it found cannot fail: every violation is admitted the
 * moment it appears. If a third entry is ever needed, it is typed here by a
 * human who has answered "can a server render reach this?" first.
 */
const ALLOWED_SEAM_IMPORTERS: readonly string[] = [
  "src/lib/analytics-client.ts",
  "src/lib/process-key-client.ts",
  // Phase 141 / SEAM-05 — the retry-safety registry. Its ONLY edges to the seam
  // modules are `import type { FlowType } from "./process-key-client"` and
  // `import type { SeamBudgetKey } from "./resilient-fetch"` — TYPE-only imports,
  // erased at build, so they create no runtime import edge and the leaf can never
  // reach the seam during a server render (that browser-safety is the leaf's whole
  // purpose; `seam-retry-registry.test.ts` pins the type-only imports). This
  // source scan is a DIRECT-EDGE regex that cannot tell `import type` from a value
  // import (per the "DOES NOT PROVE" note above, it is a source scan, not a
  // runtime proof), so the registry is admitted here by hand with the reason
  // written down.
  "src/lib/seam-retry-registry.ts",
];

/**
 * Strip comments before matching.
 *
 * Block comments are blanked character-for-character so line numbers survive
 * into the failure message; a whole-line `//` becomes an empty line. Trailing
 * `//` comments are LEFT IN, which can only produce a false POSITIVE — the safe
 * direction for a guard whose job is to fail loud.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

/** Every `.ts`/`.tsx` under `src/` that is production code, tests excluded. */
function productionSourceFiles(): string[] {
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
  walk("src");
  return files;
}

const PRODUCTION_FILES = productionSourceFiles();

/** Comment-stripped source, read once. */
const SOURCE = new Map<string, string>(
  PRODUCTION_FILES.map((f) => [
    f,
    stripComments(readFileSync(join(process.cwd(), f), "utf8")),
  ]),
);

/** A `"use client"` module runs in the browser and is out of scope by definition. */
function isClientModule(src: string): boolean {
  return /^\s*["']use client["']/.test(src);
}

describe("[140.3-16] NEGATIVE PIN: no server directive exists anywhere under src/", () => {
  it("the scanner actually reads production source (fail-loud on a broken scan)", () => {
    // A walker that found nothing would report the repo clean forever — the
    // failure mode that makes a source guard worse than no guard, because it
    // reads as protection. The bound is hand-typed and far below the real
    // figure so ordinary growth never touches it.
    expect(
      PRODUCTION_FILES.length,
      `The production-source scan found almost no files, so every assertion in ` +
        `this file is vacuously true. Fix the walker before trusting it.`,
    ).toBeGreaterThan(200);
  });

  it("the needles are the real directive, assembled (fail-loud on a broken needle)", () => {
    // If the assembly above were ever "simplified" into something that produced
    // the wrong bytes, the scan would search for a string no file contains and
    // pass forever. This pins the assembled result against a second, independent
    // hand-typed spelling of the same thing.
    expect(DIRECTIVE_BODY.split(" ")).toEqual(["use", "server"]);
    expect(DIRECTIVE_NEEDLES).toHaveLength(2);
  });

  it("ZERO files under src/ carry a server directive — pinned to a hand-typed 0", () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      const src = SOURCE.get(file) ?? "";
      return DIRECTIVE_NEEDLES.some((needle) => src.includes(needle));
    });

    expect(
      offenders,
      `A server directive appeared under src/. This repo has had ZERO of them, ` +
        `and that is the only reason an analytics outage can never 500 a page: ` +
        `every seam call happens in an API route handler or in a "use client" ` +
        `component's fetch, so when the breaker trips the shell still renders ` +
        `and the failure surfaces as a sentence with a retry rather than as a ` +
        `broken page. A Server Actions module that reaches the seam throws ` +
        `during render instead, and the user is locked out. If this directive ` +
        `is genuinely wanted, the question to answer first is whether the new ` +
        `server module can reach the seam — then change the hand-typed literal ` +
        `in this file in the SAME commit.`,
    ).toEqual([]);

    expect(offenders.length).toBe(EXPECTED_SERVER_DIRECTIVE_FILES);
  });
});

describe("[140.3-16] NEGATIVE PIN: no server-rendered module imports a seam client", () => {
  it("the allow-list is exactly the two seam clients plus the type-only registry leaf", () => {
    // Hand-typed on both sides. This is what stops the allow-list quietly
    // absorbing a real violation: growing it is a visible, reviewable edit. The
    // third entry (seam-retry-registry) reaches the seam modules through
    // `import type` ONLY — erased at build, no runtime edge — which is why it is
    // safe on a server render despite this direct-edge scan flagging it.
    expect(ALLOWED_SEAM_IMPORTERS).toEqual([
      "src/lib/analytics-client.ts",
      "src/lib/process-key-client.ts",
      "src/lib/seam-retry-registry.ts",
    ]);
  });

  it("the import-edge regex matches an edge and NOT a prose mention", () => {
    // The negative half is the load-bearing one. `wizardErrors.ts` and
    // `seam-errors.ts` both carry docblocks naming all three modules precisely
    // to explain why they must never import them; a scan that flagged those
    // would be "fixed" by weakening it.
    expect(SEAM_IMPORT_EDGE.test(`import { x } from "@/lib/resilient-fetch";`)).toBe(true);
    expect(SEAM_IMPORT_EDGE.test(`import { y } from "./analytics-client";`)).toBe(true);
    expect(SEAM_IMPORT_EDGE.test(`// do NOT simplify this to @/lib/resilient-fetch`)).toBe(false);
    expect(SEAM_IMPORT_EDGE.test(`import { z } from "@/lib/seam-errors";`)).toBe(false);
  });

  it("no server-rendered module outside src/app/api/ imports a seam client", () => {
    const offenders = PRODUCTION_FILES.filter((file) => {
      if (file.startsWith("src/app/api/")) return false; // route handlers ARE the seam callers
      if (ALLOWED_SEAM_IMPORTERS.includes(file)) return false;
      const src = SOURCE.get(file) ?? "";
      if (isClientModule(src)) return false; // runs in the browser, not on a render
      return SEAM_IMPORT_EDGE.test(src);
    });

    expect(
      offenders,
      `A module that can run during a server render now imports a seam client ` +
        `directly. Everything outside src/app/api/ that touches the seam today ` +
        `is a "use client" component doing a browser fetch, which is why a ` +
        `breaker trip degrades a panel instead of failing a page render. Move ` +
        `the call into a route handler under src/app/api/, or mark the module ` +
        `"use client" — and if neither is right, add the path to the hand-typed ` +
        `allow-list in this file with the reason written down.`,
    ).toEqual([]);
  });

  it("every page.tsx and layout.tsx in the app is free of seam imports", () => {
    // Stated separately from the scan above even though it is a subset of it.
    // These two filenames are the ones a future contributor reaches for when
    // asked to "render it on the server", and naming them in their own failing
    // assertion is what makes the failure message land on the right change.
    const shells = PRODUCTION_FILES.filter(
      (f) => f.endsWith("/page.tsx") || f.endsWith("/layout.tsx"),
    );

    expect(
      shells.length,
      `No page.tsx or layout.tsx was found at all, so the assertion below is ` +
        `vacuous. Fix the walker before trusting it.`,
    ).toBeGreaterThan(20);

    const offenders = shells.filter((f) => SEAM_IMPORT_EDGE.test(SOURCE.get(f) ?? ""));

    expect(
      offenders,
      `A page or layout imports a seam client. These render on the server, so ` +
        `a breaker trip inside one is an unhandled throw during render — the ` +
        `whole route 500s and the user is locked out, rather than seeing a ` +
        `degraded panel on a page that still works.`,
    ).toEqual([]);
  });
});
