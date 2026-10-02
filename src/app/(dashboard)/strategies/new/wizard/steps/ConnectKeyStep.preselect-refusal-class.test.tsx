/** @vitest-environment jsdom */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * [162-06 review / B-2 CLASS] EVERY REFUSAL THE SAVED-KEY SUMMARY CAN RENDER
 * MAY NAME ONLY CONTROLS THAT ARE PAINTED ON IT.
 *
 * ⚠️ WHY THIS FILE EXISTS RATHER THAN A THIRD CASE IN THE B-2 DESCRIBE. The
 * guard that shipped with the B-2 fix scanned ONE code — `KEY_REUSE_UNAVAILABLE`
 * — for form-shaped phrases. It was green, correct, and blind: two more
 * instances of the identical defect were sitting in the same table, reachable on
 * the same screen, and a red team found them within a day.
 *
 *   · `DRAFT_ALREADY_EXISTS` said "Resume the existing draft" and "delete it and
 *     start fresh here". Those are `WizardClient`'s resume-banner buttons; the
 *     banner is not on this screen. It is also NON-recoverable, so no Retry
 *     rendered either — a refusal naming two absent controls, whose only
 *     working control discards the key the reader chose.
 *   · `KEY_MISSING_REQUIRED_FIELD` said "Fill in every field shown" and "Submit
 *     again" to a reader with no fields and nothing to submit, and carried
 *     `clear_and_retry`, so its Retry blanked the banner and changed nothing.
 *
 * ⭐ SO THE SUBJECT IS THE POPULATION, AND THE POPULATION IS DERIVED. The code
 * list is read out of `create-with-key/route.ts`'s reuse arm and out of
 * `ConnectKeyStep`'s own reuse handler at test time. A code that becomes
 * reachable on this screen is swept the day it is added, without anyone
 * remembering to add it here — which is the only property that distinguishes
 * this from the one-code pin it replaces.
 *
 * ⭐ AND THE ORACLE IS THE RENDERED DOM. Painted control labels are read off the
 * tree and never typed here, so renaming a control without following the copy
 * reds this. A string-vs-string assertion is what let the class ship twice.
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* ASSERTED, so the next reader does not mistake
 * silence for coverage: this file polices CONTROLS AND ACTIONS, not every claim.
 * `KEY_MISSING_REQUIRED_FIELD`'s title still reads "One of the required fields
 * is empty." on this screen — a false STATE, disclosed in that entry's own
 * comment, whose fix belongs at the emitter (`create-with-key`'s reuse arm must
 * stop answering a credential-shaped code for a request that carries no
 * credentials) and NOT in a copy table shared with the credential form, where
 * the sentence is true and useful.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ConnectKeyStep, type PreselectedKey } from "./ConnectKeyStep";
import { WIZARD_ERROR_COPY, type WizardErrorCode } from "@/lib/wizardErrors";

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: () => {},
}));

const REPO = process.cwd();
const ROUTE_PATH = join(
  REPO,
  "src/app/api/strategies/create-with-key/route.ts",
);
const STEP_PATH = join(
  REPO,
  "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx",
);

const ROUTE_SRC = readFileSync(ROUTE_PATH, "utf-8");
const STEP_SRC = readFileSync(STEP_PATH, "utf-8");

/**
 * The body of a top-level `function NAME(...)` / `async function NAME(...)`,
 * brace-balanced. Brace counting rather than a regex because the arm under test
 * is ~10k characters of nested blocks and a lazy match would silently return a
 * prefix — a shorter body means fewer codes found, which is the failure mode
 * that makes a derivation-based sweep vacuous instead of red.
 */
function bodyOf(src: string, name: string): string {
  const decl = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = src.match(decl);
  if (!m || m.index === undefined) {
    throw new Error(`bodyOf: no declaration of ${name} — the source moved.`);
  }
  const open = src.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`bodyOf: unbalanced braces in ${name}`);
}

/** The whole use-existing-key arm — every refusal the preselect POST can meet. */
const REUSE_ARM = bodyOf(ROUTE_SRC, "handleReuseExistingKey");

/**
 * The POST handler's prelude — everything it runs BEFORE dispatching to the arm.
 * Its one refusal ("the body is not an object") answers the preselect POST too,
 * so a sweep that started at the arm would miss it.
 */
const POST_PRELUDE = (() => {
  const start = ROUTE_SRC.indexOf("export const POST");
  const dispatch = ROUTE_SRC.indexOf("return handleReuseExistingKey(", start);
  if (start < 0 || dispatch < 0) {
    throw new Error("POST prelude: the reuse dispatch moved or was renamed.");
  }
  return ROUTE_SRC.slice(start, dispatch);
})();

/**
 * Same-file helpers the arm CALLS, resolved and folded in.
 *
 * ⛔ WITHOUT THIS THE SWEEP IS SILENTLY SHORT ONE CODE.
 * `VENUE_ALREADY_CONNECTED` never appears as a literal inside the arm — the arm
 * calls `venueAlreadyConnectedResponse(...)`, which is exactly the shape a
 * "scan the function body" derivation cannot see. That is asserted below as a
 * positive control rather than trusted.
 */
const RESOLVED_HELPERS: string[] = [];
const HELPER_BODIES = (() => {
  const called = new Set<string>();
  for (const m of REUSE_ARM.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)) {
    called.add(m[1]);
  }
  let out = "";
  for (const name of called) {
    if (name === "handleReuseExistingKey") continue;
    if (!new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(ROUTE_SRC)) {
      continue;
    }
    RESOLVED_HELPERS.push(name);
    out += "\n" + bodyOf(ROUTE_SRC, name);
  }
  return out;
})();

/**
 * code → the HTTP status the route answers it with, where the source states one
 * literally next to it. Codes handed to `rateLimitDenyJson` (which owns their
 * status) fall back to 409.
 *
 * ⚠️ ONLY ONE STATUS CHANGES BEHAVIOUR, and it is the reason this map exists at
 * all: a 400 on this arm is a refusal of the body WE built out of a prop and
 * wizard state that this screen paints no control to edit, so re-sending is
 * refused identically and no Retry may be offered. Every other status turns on
 * something outside the request. The extractor is positive-controlled below
 * against that one value.
 */
const SERVER_REFUSALS: Map<string, number> = (() => {
  const out = new Map<string, number>();
  for (const chunk of [REUSE_ARM, POST_PRELUDE, HELPER_BODIES]) {
    for (const m of chunk.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]*)"/g)) {
      const after = chunk.slice(m.index!, m.index! + 400);
      const status = after.match(/\bstatus:\s*(\d{3})\b/);
      const parsed = status ? Number(status[1]) : 409;
      // A 400 anywhere for a code wins: the strictest posture the arm can put
      // that code on the wire with is the one the screen has to survive.
      const prev = out.get(m[1]);
      out.set(m[1], prev === undefined ? parsed : Math.min(prev, parsed));
    }
  }
  return out;
})();

/**
 * The codes `ConnectKeyStep` MINTS on this arm without a server ever naming
 * them — read out of its own reuse handler, not typed here.
 */
const CONTINUE_HANDLER = bodyOf(STEP_SRC, "handleContinueWithKey");
const CLIENT_MINTED: string[] = [
  ...CONTINUE_HANDLER.matchAll(/setErrorCode\("([A-Z][A-Z0-9_]*)"\)/g),
].map((m) => m[1]);

/**
 * The whole population, plus `UNKNOWN` — the fallback
 * `recogniseCreateWithKeyCode` returns for a body carrying no code we admit,
 * which every arm of this handler routes through.
 */
const PRESELECT_REACHABLE: [WizardErrorCode, number][] = [
  ...new Map<string, number>([
    ...SERVER_REFUSALS,
    ...CLIENT_MINTED.map((c) => [c, 0] as [string, number]),
    ["UNKNOWN", 500],
  ]),
].map(([code, status]) => [code as WizardErrorCode, status]);

const PRESELECT: PreselectedKey = {
  id: "55555555-5555-5555-5555-555555555555",
  exchange: "bybit",
  exchangeLabel: "Bybit",
  keyLabel: "Zavara main",
};
const SESSION = "wizard-session-12345";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A host in miniature. The real one (`ContributionWizardOverlay`) drops the
 * preselect and tears the step down by remount; this one flips the same prop, so
 * BOTH sanctioned Retry outcomes — "the reader lands on the credential form" and
 * "the banner clears and the saved key survives" — are observable in the tree
 * rather than through a spy.
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

/**
 * PHRASES THAT NAME A CONTROL OR AN ACTION THE SAVED-KEY SUMMARY DOES NOT
 * OFFER, each paired with ITS OWN positive control.
 *
 * ⛔ THE PER-PHRASE CONTROL IS NOT DECORATION. A single OR-based control over a
 * list detects TOTAL blindness and nothing else: dropping one phrase while a lie
 * using only that phrase is reintroduced leaves the suite green. Measured on
 * this very file's ancestor. Every row is exercised on its own sentence below.
 */
const ABSENT_CONTROLS: readonly { phrase: string; control: string }[] = [
  {
    phrase: "resume the existing draft",
    control: "Resume the existing draft to continue where you left off.",
  },
  {
    phrase: "resume draft",
    control: "Press Resume draft in the banner at the top of the wizard.",
  },
  {
    phrase: "start fresh",
    control: "Or delete it and start fresh here.",
  },
  {
    phrase: "delete it and start",
    control: "Or delete it and start fresh here.",
  },
  {
    phrase: "fill in every field",
    control:
      "Fill in every field shown for the exchange you selected — the fields differ by exchange.",
  },
  {
    phrase: "the fields shown",
    control: "Check the fields shown for this exchange before resubmitting.",
  },
  {
    phrase: "the form on this",
    control: "the form on this step still works normally",
  },
  {
    phrase: "the form below",
    control: "Use the form below to connect this account.",
  },
  {
    phrase: "the form above",
    control: "Use the form above to connect this account.",
  },
  {
    phrase: "still works normally",
    control: "the form on this step still works normally",
  },
  {
    phrase: "connect this account here",
    control: "Connect this account here with its API credentials instead.",
  },
  {
    phrase: "submit again",
    control: "Submit again once each one has a value.",
  },
  {
    phrase: "paste ",
    control: "Paste the read-only key and the secret here.",
  },
  {
    phrase: "re-enter",
    control: "Re-enter your credentials below and try once more.",
  },
  {
    phrase: "manage keys",
    control: "Disconnect the unused key under Manage keys, then connect it here.",
  },
  {
    phrase: "reconnect here",
    control: "Reconnect here using the login and the investor password.",
  },
];

const namesAnAbsentControl = (haystack: string): string[] =>
  ABSENT_CONTROLS.filter((row) =>
    haystack.toLowerCase().includes(row.phrase),
  ).map((row) => row.phrase);

/**
 * Labels the copy QUOTES typographically. The table's convention is that a
 * control is named inside “ ” — "Choose “Use a different key” on this screen" —
 * so a quoted string is a claim that a control by that name is there to press.
 */
const quotedLabelsIn = (haystack: string): string[] =>
  [...haystack.matchAll(/[“"]([^“”"]{3,60})[”"]/g)].map((m) => m[1].trim());

/** Every label the RENDERED screen actually offers — read off the tree. */
function paintedLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button, summary, a")]
    .map((el) => (el.textContent ?? "").trim())
    .filter((t) => t.length > 0);
}

describe("[162-06 review / B-2 CLASS] the preselect-reachable population is DERIVED, not typed", () => {
  it("the extractors are alive — arm, prelude, helper resolution and status all measured", () => {
    expect(
      REUSE_ARM.length,
      "handleReuseExistingKey's body came back short, so the brace walker " +
        "returned a prefix and every sweep below is looking at a fraction of " +
        "the arm.",
    ).toBeGreaterThan(3_000);
    expect(
      POST_PRELUDE.length,
      "The POST prelude collapsed — its own refusal (a body that is not an " +
        "object) would then be missing from the population.",
    ).toBeGreaterThan(200);

    // ⛔ POSITIVE CONTROL FOR HELPER RESOLUTION, and it is the sharpest one in
    // this file: VENUE_ALREADY_CONNECTED is emitted through a helper, so it is
    // ABSENT from the arm's own text. If the resolver stops working the code
    // silently leaves the population and its screen stops being swept.
    expect(
      REUSE_ARM,
      "VENUE_ALREADY_CONNECTED became a literal inside the arm. That is fine " +
        "in itself, but this control no longer proves helper resolution works " +
        "— pick another helper-only code, do not delete the check.",
    ).not.toContain('code: "VENUE_ALREADY_CONNECTED"');
    expect(RESOLVED_HELPERS).toContain("venueAlreadyConnectedResponse");
    expect(
      [...SERVER_REFUSALS.keys()],
      "The helper's refusal did not reach the derived population, so the one " +
        "code the arm emits indirectly is unswept.",
    ).toContain("VENUE_ALREADY_CONNECTED");

    // ⛔ POSITIVE CONTROL FOR THE STATUS EXTRACTOR. 400 is the only status this
    // file's behaviour turns on; if the extractor goes blind it defaults to 409
    // and the "no Retry on a shape rejection" assertion below silently stops
    // running.
    expect(
      SERVER_REFUSALS.get("KEY_MISSING_REQUIRED_FIELD"),
      "The arm's shape guard answers 400. Deriving anything else means the " +
        "status scan is reading the wrong construct.",
    ).toBe(400);

    expect(
      CLIENT_MINTED,
      "ConnectKeyStep's reuse catch mints SERVICE_UNREACHABLE when OUR OWN hop " +
        "fails. Losing it from the derivation drops the one code no server " +
        "response can produce.",
    ).toContain("SERVICE_UNREACHABLE");

    expect(
      PRESELECT_REACHABLE.length,
      "The derived population shrank below the seven refusals measured at " +
        "162-06 review. Re-derive before editing this floor.",
    ).toBeGreaterThanOrEqual(8);

    for (const [code] of PRESELECT_REACHABLE) {
      expect(
        Object.keys(WIZARD_ERROR_COPY),
        `${code} is reachable on the preselect screen but has no copy entry, ` +
          "so it renders UNKNOWN — a recoverable code with a Retry — for a " +
          "refusal we can actually name.",
      ).toContain(code);
    }

    // Anchors: the three entries this class fix rewrote. If any drops out of
    // the derivation the sweep stops covering the very defects it was written
    // for, and would do so silently.
    for (const anchor of [
      "DRAFT_ALREADY_EXISTS",
      "KEY_MISSING_REQUIRED_FIELD",
      "VENUE_ALREADY_CONNECTED",
    ]) {
      expect(PRESELECT_REACHABLE.map(([c]) => c)).toContain(anchor);
    }
  });

  it("every banned phrase is individually CAPABLE of matching — one control each", () => {
    // ⛔ The trap this closes: a list-wide OR control proves the scanner is not
    // TOTALLY blind and proves nothing about any single row. Dropping one
    // phrase while re-introducing a lie that uses only that phrase stayed green
    // under exactly that shape.
    for (const row of ABSENT_CONTROLS) {
      expect(
        namesAnAbsentControl(row.control),
        `The phrase "${row.phrase}" did not match its own control sentence, so ` +
          "it is dead weight in the scan and the lie it was added for would " +
          "ship green. Fix the phrase, never delete the row.",
      ).toContain(row.phrase);
    }
    expect(ABSENT_CONTROLS.length).toBeGreaterThanOrEqual(12);
  });

  it("the quoted-label extractor sees a control name — positive control", () => {
    expect(
      quotedLabelsIn("Press “Resume draft” in the banner above."),
      "The quoted-label extractor found nothing in a sentence built to trip " +
        "it, so the painted-label check below passes for the wrong reason.",
    ).toContain("Resume draft");
    expect(
      quotedLabelsIn("Choose “Use a different key” on this screen."),
    ).toContain("Use a different key");
  });
});

describe("[162-06 review / B-2 CLASS] no preselect refusal names a control that is not painted", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Drives the REAL component to the REAL refusal: mock the reuse POST, press
   * the step's own primary control, and read what the reader reads.
   */
  async function refuseWith(code: string, status: number) {
    if (status === 0) {
      // The client-minted arm: our own hop throws, nothing answers.
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    } else {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({ code, error: "refused" }, status),
      );
    }
    const { container } = render(<PreselectHost />);
    fireEvent.click(screen.getByTestId("wizard-preselect-continue"));
    const envelope = await screen.findByTestId("error-envelope");
    return { envelope, container };
  }

  it.each(PRESELECT_REACHABLE)(
    "%s: names only painted controls, and any Retry it offers does something",
    async (code, status) => {
      const { envelope, container } = await refuseWith(code, status);
      const text = envelope.textContent ?? "";

      // ── THE PREMISE, MEASURED. Every assertion below is about "what is on
      // this screen", so what is on this screen is asserted rather than
      // narrated. If the preselect branch ever starts rendering the credential
      // form or a draft control, the whole file is asking the wrong question.
      expect(
        screen.queryByTestId("wizard-connect-submit"),
        "The preselect branch has started rendering the credential form — " +
          "re-derive this file's premise before touching its assertions.",
      ).toBeNull();
      expect(screen.queryByPlaceholderText("Paste the read-only key")).toBeNull();
      expect(screen.queryByTestId("wizard-resume")).toBeNull();
      expect(screen.getByTestId("wizard-preselect-continue")).toBeInTheDocument();
      expect(screen.getByTestId("wizard-preselect-different")).toBeInTheDocument();

      // ── C1: the phrase class. The defect that shipped twice.
      expect(
        namesAnAbsentControl(text),
        `${code} tells the reader to operate something the saved-key summary ` +
          "does not paint. The screen has exactly two controls — 'Continue " +
          "with this key' and 'Use a different key' — plus whatever Retry the " +
          "envelope itself renders. A remedy naming anything else leaves the " +
          "reader hunting, which is the whole B-2 class. Gate the bullet with " +
          "NOT_ON_PRESELECT_SURFACE and write a preselect one beside it.",
      ).toEqual([]);

      // ── C2: every label the copy QUOTES must be readable off this tree.
      const painted = paintedLabels(container).map((l) => l.toLowerCase());
      const unpainted = quotedLabelsIn(text).filter(
        (label) => !painted.includes(label.toLowerCase()),
      );
      expect(
        unpainted,
        `${code} quotes a control label that is nowhere on the rendered ` +
          `screen. Painted labels right now are: ${JSON.stringify(painted)}. ` +
          "The label is read off the DOM on purpose — renaming a control " +
          "without following the copy has to red something.",
      ).toEqual([]);

      // ── C3: a Retry is offered only where pressing it changes the reader's
      // situation, and a request-shape refusal is where it provably does not.
      const retry = screen.queryByRole("button", { name: "Retry" });
      if (status === 400) {
        expect(
          retry,
          `${code} answered 400 — the server refused the SHAPE of the body we ` +
            "built out of a prop and wizard state this screen cannot edit. A " +
            "Retry wired to 'send the same thing again' re-sends the identical " +
            "two ids and is refused identically: a control that can only fail.",
        ).toBeNull();
      }

      if (retry) {
        fireEvent.click(retry);
        const landedOnForm = screen.queryByTestId("wizard-connect-submit");
        const bannerCleared = screen.queryByTestId("error-envelope") === null;
        expect(
          Boolean(landedOnForm) || bannerCleared,
          `${code} rendered a Retry that left the screen exactly as it was — ` +
            "same panel, same banner, same refusal one click away. Retry must " +
            "either deliver another key (the credential form) or clear the " +
            "banner so the action its own copy names can be pressed again.",
        ).toBe(true);
        if (bannerCleared && !landedOnForm) {
          expect(
            screen.getByTestId("wizard-preselect-continue"),
            `${code} cleared the banner and took the saved key with it. Its ` +
              "copy tells the reader to try the same action again, so the " +
              "control that performs it has to survive.",
          ).toBeInTheDocument();
        }
      }
    },
  );
});

/**
 * ⚠️ THE ANTI-VACUITY PIN FOR THE SWEEP ABOVE, and it is not optional.
 *
 * Everything in the sweep is a NEGATIVE ("this list is empty"), and a negative
 * over copy that never trips the scanner is green whether the scanner works or
 * not. These two cases prove the sweep's own machinery reds against the two
 * defects it was written for, replayed as the literal sentences that shipped.
 */
describe("[162-06 review / B-2 CLASS] the sweep reds against the sentences that shipped", () => {
  it("catches DRAFT_ALREADY_EXISTS's retired remedy", () => {
    expect(
      namesAnAbsentControl(
        "Resume the existing draft to continue where you left off. | " +
          "Or delete it and start fresh here.",
      ).sort(),
    ).toEqual(
      ["delete it and start", "resume the existing draft", "start fresh"].sort(),
    );
  });

  it("catches KEY_MISSING_REQUIRED_FIELD's retired remedy", () => {
    expect(
      namesAnAbsentControl(
        "Fill in every field shown for the exchange you selected — the fields " +
          "differ by exchange. | Submit again once each one has a value.",
      ).sort(),
    ).toEqual(["fill in every field", "submit again"].sort());
  });

  it("catches the B-2 sentence the one-code pin was written for", () => {
    expect(
      namesAnAbsentControl(
        "Connect this account here with its API credentials instead — the " +
          "form on this step still works normally.",
      ),
    ).not.toEqual([]);
  });
});
