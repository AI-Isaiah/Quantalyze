import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as wizardErrors from "@/lib/wizardErrors";
import * as statusSurfaceCopy from "@/lib/status-surface-copy";
import * as keyCardCopy from "@/components/strategy/key-card-copy";
import * as contact from "@/lib/contact";

/**
 * D-01 of Phase 164.6.6.3.5 (DOMAINONE): no user-facing copy NAMES an email
 * address. A person who needs us is pointed to the contact form
 * (`/contact`, see `src/lib/contact.ts`), never to a mailbox, because the
 * mailbox on the retiring domain is not ours and a wrong address in a failure
 * message is a message nobody reads. The `check-canonical-domain` gate holds
 * the domain half of that; this test holds the WHOLE class, whatever the
 * domain, so a new address on any host also turns it red.
 *
 * Two arms:
 *
 *   1. Every string reachable by walking the EXPORTED VALUES of the four copy
 *      modules (strings, arrays, plain objects, Map and Set members,
 *      recursively) matches no email shape. This is the copy a user reads,
 *      reached by value, so a template literal assembled at import time is
 *      covered as it renders. Functions are NOT called and are skipped; the
 *      ones that exist today are listed below so a reader knows what the walk
 *      cannot see (their output is covered by each module's own tests and by
 *      arm 2's source scan):
 *        wizardErrors:        formatKeyError, gateFailureToWizardError,
 *                             classifyKeyValidationError, recogniseSeamErrorCode,
 *                             recogniseDashboardDialogCode, formatCsvRuleCauseSingle,
 *                             formatCsvRuleCauseFileLevel
 *        status-surface-copy: ownerStateLine, ownerRemedy, recipientShareNote,
 *                             unbuildableNoteKindOf, probeUnreadableShareNote,
 *                             recipientShareNoteFor, untrustedKeyCaption
 *        key-card-copy:       addKeyBlockedReason, formatBoundDuration,
 *                             deleteCompositeWarning
 *        contact:             contactHref, parseContactPrefill
 *
 *   2. The SOURCE TEXT of each named user-facing file carries no email-shaped
 *      literal outside a reasoned allowlist of non-contact examples. This is
 *      the arm that sees what the walk cannot: JSX text, function bodies and
 *      route handlers.
 *
 * Each arm carries an anti-vacuity floor, because a walk that reaches nothing
 * reads as "no address found".
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g;

type Walked = { path: string; value: string };

/** Collect every string reachable from `root`, with the path that reached it. */
function collectStrings(root: unknown, label: string): Walked[] {
  const out: Walked[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      out.push({ path, value: v });
      return;
    }
    if (v === null || typeof v !== "object") return; // numbers, booleans, functions, symbols
    if (seen.has(v)) return;
    seen.add(v);
    if (v instanceof RegExp) return;
    if (v instanceof Map) {
      for (const [k, val] of v) {
        walk(k, `${path}<key>`);
        walk(val, `${path}.get(${String(k)})`);
      }
      return;
    }
    if (v instanceof Set) {
      let i = 0;
      for (const val of v) walk(val, `${path}{${i++}}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((val, i) => walk(val, `${path}[${i}]`));
      return;
    }
    for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
  };
  walk(root, label);
  return out;
}

function emailHits(walked: Walked[]): string[] {
  return walked.flatMap(({ path, value }) =>
    (value.match(EMAIL_RE) ?? []).map((m) => `${path}: ${m}`),
  );
}

const MODULES: Array<[string, unknown]> = [
  ["wizardErrors", wizardErrors],
  ["status-surface-copy", statusSurfaceCopy],
  ["key-card-copy", keyCardCopy],
  ["contact", contact],
];

describe("D-01 arm 1 - exported copy values name no email address", () => {
  it.each(MODULES)("%s", (name, mod) => {
    const walked = collectStrings(mod, name);
    // Anti-vacuity: each module exports real copy. A walk that reaches a
    // handful of strings has stopped seeing the copy tables.
    expect(walked.length, `${name}: the walk reached suspiciously few strings`).toBeGreaterThan(5);
    expect(emailHits(walked)).toEqual([]);
  });

  it("the wizard error table is reached in depth (it is the largest copy surface)", () => {
    const walked = collectStrings(wizardErrors, "wizardErrors");
    expect(walked.length).toBeGreaterThan(300);
  });

  it("the walker finds an address planted at depth, in an array, a Map and a Set", () => {
    const planted = ["person", "example.org"].join("@");
    const tree = {
      a: { b: [{ c: `write to ${planted}` }] },
      m: new Map([["k", { s: planted }]]),
      s: new Set([planted]),
    };
    expect(emailHits(collectStrings(tree, "tree"))).toEqual([
      `tree.a.b[0].c: ${planted}`,
      `tree.m.get(k).s: ${planted}`,
      `tree.s{0}: ${planted}`,
    ]);
  });
});

/**
 * Non-contact examples that are email-SHAPED but are not a place to write to.
 * Every entry is an exact literal in an exact file; a new one needs a reason
 * here, which is the point.
 */
const SOURCE_ALLOWLIST: ReadonlyArray<{ file: string; literal: string; reason: string }> = [
  {
    file: "src/app/(marketing)/for-quants/RequestCallModal.tsx",
    literal: "you@firm.com",
    reason: "the visitor's own email input placeholder: an example of what to type, not an address we publish",
  },
  {
    file: "src/app/api/for-quants-lead/route.ts",
    literal: "Jane@Acme.com",
    reason: "Zod docblock example showing that an email is trimmed and lowercased; never rendered",
  },
  {
    file: "src/app/api/for-quants-lead/route.ts",
    literal: "jane@acme.com",
    reason: "the lowercased half of the same Zod docblock example; never rendered",
  },
];

const USER_FACING_SOURCES = [
  "src/app/(marketing)/contact/page.tsx",
  "src/app/(marketing)/security/page.tsx",
  "src/app/(marketing)/legal/privacy/page.tsx",
  "src/app/(auth)/pending-approval/page.tsx",
  "src/app/(marketing)/for-quants/page.tsx",
  "src/components/contact/ContactForm.tsx",
  "src/app/(marketing)/for-quants/RequestCallModal.tsx",
  "src/components/error/ErrorEnvelope.tsx",
  "src/components/contact/ContactPointerText.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx",
  "src/app/api/for-quants-lead/route.ts",
  "src/app/api/strategies/csv-finalize/route.ts",
] as const;

function sourceHits(
  file: string,
  text: string,
  allow: ReadonlyArray<{ file: string; literal: string }> = SOURCE_ALLOWLIST,
): string[] {
  return (text.match(EMAIL_RE) ?? [])
    .filter((m) => !allow.some((a) => a.file === file && a.literal === m))
    .map((m) => `${file}: ${m}`);
}

describe("D-01 arm 2 - user-facing source files carry no email-shaped literal", () => {
  it.each(USER_FACING_SOURCES)("%s", (file) => {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    // Anti-vacuity: an unreadable or emptied file must not read as clean.
    expect(text.length, `${file} is empty`).toBeGreaterThan(200);
    expect(sourceHits(file, text)).toEqual([]);
  });

  it("every allowlist entry is exact, reasoned and still needed", () => {
    for (const entry of SOURCE_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(20);
      const text = readFileSync(resolve(process.cwd(), entry.file), "utf8");
      expect(text, `${entry.file} no longer carries ${entry.literal}: drop the entry`).toContain(
        entry.literal,
      );
    }
  });

  it("the scanner finds an address in source text and honours an exact allowlist entry", () => {
    const planted = ["you", "firm.example"].join("@");
    const text = `<input placeholder="${planted}" />`;
    expect(sourceHits("x.tsx", text)).toEqual([`x.tsx: ${planted}`]);
    expect(sourceHits("x.tsx", text, [{ file: "x.tsx", literal: planted }])).toEqual([]);
    expect(sourceHits("y.tsx", text, [{ file: "x.tsx", literal: planted }])).toEqual([
      `y.tsx: ${planted}`,
    ]);
  });
});
