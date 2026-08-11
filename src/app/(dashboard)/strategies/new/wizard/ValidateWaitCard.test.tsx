/** @vitest-environment jsdom */
/**
 * Phase 153.4-03 / D-05 / WIZFORM-05 — `ValidateWaitCard` (UI-SPEC §Surface 1).
 *
 * ⚠️ EVERY EXPECTED STRING BELOW IS HAND-TYPED, never imported from the component.
 * Importing the copy constants would assert that the component equals itself. The
 * strings are byte-copies of the UI-SPEC copy table with ONE deliberate divergence,
 * recorded in the component: ASCII `...` rather than U+2026 (D-21 — one spelling,
 * chosen, everywhere; the incumbent busy label beside this card is ASCII at four of five
 * live sites with a superseding decision recorded at `MultiKeyConnectStep.test.tsx:19`).
 *
 * The durations in the expected strings (`120s`, `30s`) are hand-typed too, and that is
 * the point: they are the numbers the SEAM grants, pinned to `SEAM_BUDGETS` by the
 * agreement pin in `seam-constants.pin.test.ts`. If the budget moves, these strings move
 * with it — visibly, in a reviewed edit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidateWaitCard } from "./ValidateWaitCard";

afterEach(cleanup);

// ── The two live budgets, hand-typed (see the docblock) ──────────────────────────────
const SERIALIZED_BUDGET_MS = 120_000;
const DEFAULT_BUDGET_MS = 30_000;

// ── The copy, hand-typed ─────────────────────────────────────────────────────────────
const SIGNING_IN = "Signing in to your broker...";
const CHECKING_BINANCE = "Checking your key with Binance...";
const CHECKING_UNNAMED = "Checking your key...";
const WAIT_PROMISE_120 = "We wait up to 120s for your broker to answer.";
const QUEUE_LINE =
  "Still signing in. MetaTrader allows one sign-in at a time, so your check may be waiting behind another.";
const SLOW_LINE_120 =
  "This is slower than usual. We will wait until 120s, then tell you what we found.";
const SLOW_LINE_30 =
  "This is slower than usual. We will wait until 30s, then tell you what we found.";
const STOP_WAITING = "Stop waiting";

function renderCard(props: {
  exchange: string;
  elapsedMs: number;
  onStopWaiting?: () => void;
}): HTMLElement {
  render(
    <ValidateWaitCard
      exchange={props.exchange}
      elapsedMs={props.elapsedMs}
      onStopWaiting={props.onStopWaiting ?? (() => {})}
    />,
  );
  return screen.getByTestId("validate-wait-card");
}

/**
 * Elements carrying `text` that a SIGHTED user can see — the `sr-only` live region is
 * excluded.
 *
 * ⚠️ THE EXCLUSION IS THE POINT, not a convenience. `LiveRegion` announces the same
 * sentence the card renders visually (PATTERNS Shared Pattern G — an announcement
 * re-states visible copy and never authors new copy), so EVERY copy string in this card
 * legitimately appears twice in the DOM. A bare `getByText` therefore throws
 * "found multiple elements" on the happy path, and the tempting fixes — `getAllByText`
 * with a hard-typed count, or dropping the announcement — would either encode the
 * duplication as a magic number or delete the accessibility channel to make a query
 * simpler. This helper asks the question the assertion actually means: is it ON SCREEN?
 */
function visibleText(text: string | RegExp): HTMLElement[] {
  return screen.queryAllByText(text, {
    ignore: "script, style, [role='status']",
  });
}

/** Every `class` attribute rendered inside the card, joined. */
function allCardClasses(card: HTMLElement): string {
  return [card, ...Array.from(card.querySelectorAll("*"))]
    .map((el) => el.getAttribute("class") ?? "")
    .join(" ");
}

describe("[WIZFORM-05] ValidateWaitCard — the steady state (t = 0)", () => {
  it("a serialized venue states its label and the wait promise, and nothing else", () => {
    renderCard({ exchange: "mt5", elapsedMs: 0 });

    expect(visibleText(SIGNING_IN)).toHaveLength(1);
    expect(visibleText(WAIT_PROMISE_120)).toHaveLength(1);

    // ⛔ Nothing escalates at t=0. A queue disclosure or a cancel control on a wait that
    // has not yet begun would train the user to read the card as trouble.
    expect(visibleText(QUEUE_LINE)).toHaveLength(0);
    expect(visibleText(SLOW_LINE_120)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: STOP_WAITING })).toBeNull();
  });

  it("a ccxt venue names the venue and makes NO wait promise", () => {
    renderCard({ exchange: "binance", elapsedMs: 0 });

    expect(visibleText(CHECKING_BINANCE)).toHaveLength(1);
    // The default budget is short enough to need no promise; promising a 30 s wait for a
    // call that usually answers in two would be an invented expectation.
    expect(visibleText(WAIT_PROMISE_120)).toHaveLength(0);
    expect(
      visibleText(/We wait up to \d+s for your broker to answer\./),
    ).toHaveLength(0);
  });

  it("an unrecognised venue is never echoed back as a venue name (T-153.4-11)", () => {
    // `exchange` reaches a user-visible sentence. It resolves through EXCHANGE_DISPLAY,
    // a CLOSED record, and falls back to a label naming no venue at all.
    const card = renderCard({ exchange: "<script>kraken</script>", elapsedMs: 0 });

    expect(visibleText(CHECKING_UNNAMED)).toHaveLength(1);
    expect(card.textContent).not.toContain("kraken");
    expect(card.textContent).not.toContain("script");
  });
});

describe("[WIZFORM-05] the escalation ladder is FRACTIONS of the budget", () => {
  it("at EXACTLY 40% the queue line and Stop waiting appear (the boundary is >=)", () => {
    renderCard({
      exchange: "mt5",
      elapsedMs: SERIALIZED_BUDGET_MS * 0.4, // 48 000 ms
    });

    expect(visibleText(QUEUE_LINE)).toHaveLength(1);
    expect(screen.getByRole("button", { name: STOP_WAITING })).toBeTruthy();
    // Still muted, still inside budget: the queue disclosure is a FACT, not a flag.
    expect(visibleText(SLOW_LINE_120)).toHaveLength(0);
  });

  it("at 39.9% neither appears — the boundary can fail in BOTH directions", () => {
    renderCard({ exchange: "mt5", elapsedMs: SERIALIZED_BUDGET_MS * 0.399 });

    expect(visibleText(QUEUE_LINE)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: STOP_WAITING })).toBeNull();
  });

  it("⭐ the DEFAULT arm crosses at 12 000 ms, not 48 000 — the thresholds are fractions", () => {
    // THE assertion that proves the ladder is a fraction and not a constant. 40% of the
    // default budget is 12 000 ms; a hard-coded 48 000 (40% of the SERIALIZED budget)
    // would leave a ccxt user with no escape until after their deadline had passed.
    renderCard({ exchange: "binance", elapsedMs: DEFAULT_BUDGET_MS * 0.4 });

    expect(
      screen.queryByRole("button", { name: STOP_WAITING }),
      "`Stop waiting` did not appear at 40% of the DEFAULT budget (12 000 ms). The " +
        "ladder has been re-cut against absolute milliseconds instead of a fraction of " +
        "the configured venue budget — the exact delta UI-SPEC Surface 1 mandates " +
        "against its SyncPreviewStep analog.",
    ).toBeTruthy();
  });

  it("at 75% the slow line renders in the WARNING token, and nothing is red", () => {
    const card = renderCard({
      exchange: "mt5",
      elapsedMs: SERIALIZED_BUDGET_MS * 0.75, // 90 000 ms
    });

    const slow = visibleText(SLOW_LINE_120);
    expect(slow).toHaveLength(1);

    // ── THE SEMANTIC-COLOUR GATE, ASSERTED RATHER THAN NARRATED ──────────────────
    // DESIGN.md §Semantic-color gates is NORMATIVE: red asserts a PERMANENT failure.
    // This wait is still inside its budget and may yet answer correctly, so red here
    // would tell the user their key failed 30 seconds before we know anything.
    //
    // ⚠️ ORDERED FIRST, ahead of the positive `text-warning` check, on purpose. Both red
    // under the same mutation, but only ONE of them explains what went wrong: a
    // "expected 'text-negative' to contain 'text-warning'" failure names a class, while
    // the message below names the rule. The 153.2-04 audit lesson, applied.
    const classes = allCardClasses(card);
    expect(
      classes,
      "A negative (red) tone appeared while the wait is still INSIDE its budget. " +
        "Red asserts permanent failure; a slow-but-live check is a recoverable " +
        "disclosure with a user action attached, which is what the warning token means.",
    ).not.toContain("text-negative");
    expect(
      classes,
      "A raw amber Tailwind class appeared where the `text-warning` token belongs " +
        "(UI-SPEC forbidden item #12). The raw class is what the SyncPreviewStep analog " +
        "this card was lifted from uses; it must not be copied.",
    ).not.toContain("amber");

    expect(slow[0].getAttribute("class")).toContain("text-warning");
  });

  it("the slow line reads the DEFAULT budget on the default arm", () => {
    // Same sentence, different number, from the same interpolation — the proof that no
    // duration is typed into copy (UI-SPEC forbidden item #8).
    renderCard({ exchange: "binance", elapsedMs: DEFAULT_BUDGET_MS * 0.75 });
    expect(visibleText(SLOW_LINE_30)).toHaveLength(1);
  });
});

describe("[WIZFORM-05] the queue disclosure is gated on the CAPABILITY, not a venue", () => {
  it("never renders for a non-serialized venue, even past 40%", () => {
    renderCard({ exchange: "binance", elapsedMs: DEFAULT_BUDGET_MS * 0.9 });

    expect(visibleText(QUEUE_LINE)).toHaveLength(0);
    // …but the ladder itself did fire, so this is not a vacuous "nothing rendered".
    expect(screen.getByRole("button", { name: STOP_WAITING })).toBeTruthy();
    expect(visibleText(SLOW_LINE_30)).toHaveLength(1);
  });

  it("⭐ a MIXED-CASE serialized venue still gets the queue line", () => {
    // ── THE ASSERTION THAT REDS UNDER AN INSTANCE FIX ────────────────────────────
    // A gate rewritten as `exchange === "mt5"` satisfies every OTHER case in this file:
    // mt5 still queues, binance still does not. This one does not — the wizard's own
    // display value is `MT5` (canonicalizeExchange returns the DISPLAY form), so an
    // instance check silently drops the disclosure for the only venue that needs it.
    renderCard({ exchange: "MT5", elapsedMs: SERIALIZED_BUDGET_MS * 0.5 });

    expect(
      visibleText(QUEUE_LINE),
      "A serialized venue passed in its DISPLAY casing lost the queue disclosure. " +
        "The gate must be the `serialized` CAPABILITY; a venue-name comparison is an " +
        "instance fix wearing a class fix's name.",
    ).toHaveLength(1);
    expect(visibleText(WAIT_PROMISE_120)).toHaveLength(1);
  });

  it("⭐ the component body names NO venue code — a class fix, not an instance fix", () => {
    // The behavioural cases above can all be satisfied by a venue-name branch (the
    // mixed-case one excepted). This one reds BY NAME, which is what makes the class
    // property legible in the failure rather than inferable from a boundary.
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/(dashboard)/strategies/new/wizard/ValidateWaitCard.tsx",
      ),
      "utf8",
    );
    // Comments stripped: this file's own docblocks name mt5 to EXPLAIN the class rule,
    // and a substring scan that flagged them would be "fixed" by deleting the
    // explanation (the seam-ssr-exposure.pin.test.ts lesson).
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n")
      .map((line) => (line.trim().startsWith("//") ? "" : line))
      .join("\n");

    // Vacuity floor — a strip that blanked everything would pass forever.
    expect(stripped).toContain("venueIsSerialized");
    expect(stripped.length).toBeGreaterThan(1_000);

    const named = ["binance", "okx", "bybit", "deribit", "sfox", "mt5"].filter(
      (code) => stripped.toLowerCase().includes(code),
    );
    expect(
      named,
      "ValidateWaitCard's CODE names a venue. Every venue-shaped decision here must " +
        "read a capability (`venueIsSerialized`) or the closed display record — a " +
        "second serialized venue must be covered by editing VENUE_CAPABILITIES, never " +
        "this component.",
    ).toEqual([]);
  });
});

describe("[WIZFORM-05] `Stop waiting` — unconfirmed, and reachable by keyboard", () => {
  it("fires the callback on click and shows no confirmation UI", () => {
    const onStopWaiting = vi.fn();
    renderCard({
      exchange: "mt5",
      elapsedMs: SERIALIZED_BUDGET_MS * 0.5,
      onStopWaiting,
    });

    fireEvent.click(screen.getByRole("button", { name: STOP_WAITING }));

    expect(onStopWaiting).toHaveBeenCalledTimes(1);
    // ⛔ No confirmation step — and NOT because "cancelling loses nothing". That
    // reasoning (validate-key is pre-encrypt / pre-RPC) was CR-02's category error: the
    // browser aborts the ROUTE, which runs on past validate and may store the key. The
    // ground is that the request finishes or fails on its own either way, so a
    // confirmation on the one control whose purpose is escaping a stall protects
    // nothing and is the opposite affordance.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("carries the full-opacity inset focus ring, not the weak repo-wide one", () => {
    renderCard({ exchange: "mt5", elapsedMs: SERIALIZED_BUDGET_MS * 0.5 });
    const cls =
      screen.getByRole("button", { name: STOP_WAITING }).getAttribute("class") ??
      "";

    // UI-SPEC §Focus-ring contract, verbatim. A 20%- or 50%-alpha accent ring measures
    // far under WCAG 1.4.11's 3:1 floor (forbidden item #9).
    expect(cls).toContain("focus-visible:ring-2");
    expect(cls).toContain("focus-visible:ring-inset");
    expect(cls).toContain("focus-visible:ring-accent");
    expect(cls).not.toContain("ring-accent/50");
    expect(cls).not.toContain("ring-accent/20");
  });
});

describe("[WIZFORM-05] accessibility and the Numbers Contract", () => {
  it("the dot and the elapsed counter are both aria-hidden", () => {
    const card = renderCard({ exchange: "mt5", elapsedMs: 61_000 });

    expect(
      screen.getByTestId("validate-wait-dot").getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      screen.getByTestId("validate-wait-elapsed").getAttribute("aria-hidden"),
      "The elapsed counter is exposed to assistive tech. It re-renders every second, " +
        "so exposing it inside a live region floods AT (forbidden item #10).",
    ).toBe("true");
    // The counter IS visible — this is not an "assert nothing rendered" pass.
    expect(card.textContent).toContain("61s");
  });

  it("renders NO progress affordance of any kind (forbidden item #7)", () => {
    // A progress bar or a percentage implies a known completion fraction we do not have
    // — a fabricated figure under the Numbers Contract. `validate-key` is one
    // request/response; the client observes no server stages at all.
    const card = renderCard({ exchange: "mt5", elapsedMs: SERIALIZED_BUDGET_MS * 0.8 });

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(card.querySelector("progress")).toBeNull();
    expect(card.querySelector("[aria-valuenow]")).toBeNull();
    const percentish = Array.from(card.querySelectorAll("*")).filter((el) =>
      /%\s*$/.test(el.textContent ?? ""),
    );
    expect(percentish).toEqual([]);
  });

  it("announces the most specific VISIBLE sentence, politely", () => {
    const { rerender } = render(
      <ValidateWaitCard exchange="mt5" elapsedMs={0} onStopWaiting={() => {}} />,
    );

    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    // ⛔ LiveRegion is a SECOND CHANNEL for copy already on screen, never a place to
    // author new copy (PATTERNS Shared Pattern G) — so every announcement below is a
    // string the card also renders visually.
    expect(region.textContent).toBe(SIGNING_IN);

    rerender(
      <ValidateWaitCard
        exchange="mt5"
        elapsedMs={SERIALIZED_BUDGET_MS * 0.4}
        onStopWaiting={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(QUEUE_LINE);

    rerender(
      <ValidateWaitCard
        exchange="mt5"
        elapsedMs={SERIALIZED_BUDGET_MS * 0.75}
        onStopWaiting={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(SLOW_LINE_120);
  });

  it("does NOT re-announce on the 1 s tick (forbidden item #10)", () => {
    // The announcement changes only at a crossing. Ticking 61s → 62s inside the same
    // rung must leave the announced sentence byte-identical, or an AT user hears the
    // status label ~120 times during one MT5 validate.
    const { rerender } = render(
      <ValidateWaitCard exchange="mt5" elapsedMs={61_000} onStopWaiting={() => {}} />,
    );
    const before = screen.getByRole("status").textContent;

    rerender(
      <ValidateWaitCard exchange="mt5" elapsedMs={62_000} onStopWaiting={() => {}} />,
    );
    expect(screen.getByRole("status").textContent).toBe(before);
    // …and the visible counter DID move, so the tick genuinely happened.
    expect(screen.getByTestId("validate-wait-elapsed").textContent).toBe("62s");
  });

  it("the wait is conveyed by TEXT; the dot's motion is suppressible in CSS", () => {
    renderCard({ exchange: "mt5", elapsedMs: 0 });
    expect(
      screen.getByTestId("validate-wait-dot").getAttribute("class"),
    ).toContain("animate-pulse");

    // ⚠️ THE COMPLIANCE LIVES IN THE STYLESHEET, so the assertion must check the
    // STYLESHEET. Keeping the `animate-pulse` utility IS the reduced-motion path — a
    // bespoke keyframe animation would carry the same class name to a reader and none of
    // the protection. ⛔ Do not hand-roll a media query or a JS `matchMedia` check here.
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation:\s*none/;
    expect(
      block.test(css),
      "globals.css no longer suppresses .animate-pulse under prefers-reduced-motion. " +
        "This card relies on that rule instead of shipping its own media query.",
    ).toBe(true);
    expect(css).toContain(".animate-pulse");
  });
});

describe("[D-21] the card's copy is ASCII throughout", () => {
  it("renders no typographic ellipsis anywhere, at any rung", () => {
    for (const elapsedMs of [0, SERIALIZED_BUDGET_MS * 0.4, SERIALIZED_BUDGET_MS * 0.75]) {
      const card = renderCard({ exchange: "mt5", elapsedMs });
      expect(
        card.textContent,
        "A U+2026 ellipsis reached the card. D-21 settles ONE spelling everywhere, and " +
          "the busy label rendered beside this card is ASCII — mixing the two forms in " +
          "one viewport is the blend Rule 7 forbids.",
      ).not.toContain("…");
      cleanup();
    }
  });
});
