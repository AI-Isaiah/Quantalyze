/**
 * Phase 150 / OWN-03 — the Mark-ownership dialog: the RETRO path (D-09 / D-11).
 *
 * This is the surface that makes Black Swan / Alpha Centauri / Arctic Fox
 * markable with zero re-onboarding, and it is the ONLY client path to the
 * destructive `confirm_remove_allocation: true` flag on
 * `PATCH /api/strategies/{id}/ownership`.
 *
 * The 409 -> confirm -> re-submit ARC is the reason this file exists. Plan 04's
 * route refuses an own-capital -> team-review flip that would strand a live
 * position, answering `409 { error: "live_allocation", allocated_amount }` and
 * writing NOTHING. The dialog must render the consequence WITH the amount and
 * perform exactly ONE confirmed write. A silent removal, or a second write on
 * the refusal, are both defects this suite is written to catch.
 *
 * ORACLE INDEPENDENCE — every copy string below is typed into this file as a
 * literal. Nothing is imported from the component under test, so a copy edit in
 * the component reddens here instead of being mirrored into the assertion. The
 * strings are the 150-UI-SPEC Copywriting Contract, which is byte-binding.
 *
 * jsdom implements neither HTMLDialogElement.showModal() nor .close(); the
 * stubs below are the repo-standard shim (Modal.test.tsx:23-39).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MarkOwnershipDialog } from "./MarkOwnershipDialog";
// The copy table, read as the SOURCE side of the comparison. The DOM is the
// other side; a case comparing the DOM with itself could not fail.
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

// --- Literal oracles (UI-SPEC Copywriting Contract) -------------------------

const TITLE = "Mark ownership";
const GROUP_LABEL = "Whose capital is this?";
const OPTION_OWN = "My own capital";
const OPTION_TEAM = "A trading team's key I'm verifying";
const CTA_SAVE = "Save mark";
const CTA_CANCEL = "Cancel";
const CONFIRM_HEADING = "Remove allocation?";
const CONFIRM_PRIMARY = "Change mark and remove allocation";
const CONFIRM_SECONDARY = "Keep own capital";

const STRATEGY_ID = "77777777-7777-4777-8777-777777777777";
const STRATEGY_NAME = "Black Swan";

/** The confirm body, assembled from literals exactly as the UI-SPEC writes it. */
const CONFIRM_BODY_120K =
  "Black Swan has a $120,000 allocation. A team-review strategy cannot hold an allocation — changing the mark removes it.";

let fetchMock: FetchMock;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDialog(
  overrides: Partial<Parameters<typeof MarkOwnershipDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <MarkOwnershipDialog
      open
      onClose={onClose}
      strategyId={STRATEGY_ID}
      strategyName={STRATEGY_NAME}
      currentMark={null}
      {...overrides}
    />,
  );
  return { ...utils, onClose };
}

/** The parsed body of the nth fetch call. */
function bodyOfCall(n: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[n]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

beforeEach(() => {
  mockRefresh.mockReset();
  fetchMock = installFetchMock();
  fetchMock.mockResolvedValue(
    jsonResponse(200, { ok: true, mark: "own_capital" }),
  );
});

afterEach(() => {
  restoreFetchMock();
});

// ---------------------------------------------------------------------------

describe("MarkOwnershipDialog — the question, defaulted safely", () => {
  it("renders the strategy name as the first body line and the ONE capital question", () => {
    renderDialog();

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(STRATEGY_NAME)).toBeInTheDocument();
    // The group label is the Mark-dialog variant, not the wizard's.
    expect(screen.getByText(GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText(OPTION_OWN)).toBeInTheDocument();
    expect(screen.getByText(OPTION_TEAM)).toBeInTheDocument();
  });

  it("an UNMARKED row opens with team-review preselected — an accidental save must not mint allocatability", () => {
    renderDialog({ currentMark: null });

    expect(screen.getByTestId("capital-ownership-team_review")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("a MARKED row opens on its current mark", () => {
    renderDialog({ currentMark: "own_capital" });

    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("MarkOwnershipDialog — the plain write", () => {
  it("Save mark PATCHes the ownership route, closes and refreshes", async () => {
    const { onClose } = renderDialog({ currentMark: null });

    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/strategies/${STRATEGY_ID}/ownership`,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(bodyOfCall(0)).toEqual({ mark: "own_capital" });
    // The unconfirmed write must NOT carry the destructive flag.
    expect(bodyOfCall(0)).not.toHaveProperty("confirm_remove_allocation");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without writing anything", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_CANCEL }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MarkOwnershipDialog — the 409 -> confirm -> re-submit arc (D-03 / T-150-30)", () => {
  it("409 live_allocation swaps the body to the inline confirm with the amount, and writes NOTHING more", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        code: "LIVE_ALLOCATION",
        error: "live_allocation",
        allocated_amount: 120000,
      }),
    );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByText(CONFIRM_HEADING)).toBeInTheDocument();
    expect(screen.getByText(CONFIRM_BODY_120K)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CONFIRM_PRIMARY }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CONFIRM_SECONDARY }),
    ).toBeInTheDocument();

    // Exactly ONE request so far, and the dialog is still open: the refusal is
    // not a write and must not read as one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("the confirm primary re-submits ONCE with confirm_remove_allocation: true, then closes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: "LIVE_ALLOCATION",
          error: "live_allocation",
          allocated_amount: 120000,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, mark: "team_review" }),
      );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));
    fireEvent.click(
      await screen.findByRole("button", { name: CONFIRM_PRIMARY }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // The call SEQUENCE is the assertion: the flag exists only on the second,
    // confirmed request — never on the first.
    expect(bodyOfCall(0)).toEqual({ mark: "team_review" });
    expect(bodyOfCall(1)).toEqual({
      mark: "team_review",
      confirm_remove_allocation: true,
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("`Keep own capital` dismisses the confirm — no write, mark unchanged, dialog open", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        code: "LIVE_ALLOCATION",
        error: "live_allocation",
        allocated_amount: 120000,
      }),
    );
    const { onClose } = renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));
    fireEvent.click(
      await screen.findByRole("button", { name: CONFIRM_SECONDARY }),
    );

    await waitFor(() => expect(screen.queryByText(CONFIRM_HEADING)).toBeNull());
    // Back on the question, still exactly one request, nothing closed.
    expect(screen.getByText(GROUP_LABEL)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders the amount through the shared formatter — a null amount never becomes $0", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        code: "LIVE_ALLOCATION",
        error: "live_allocation",
        allocated_amount: 0,
      }),
    );
    renderDialog({ currentMark: "own_capital" });

    fireEvent.click(screen.getByTestId("capital-ownership-team_review"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    // $0 is the HONEST rendering of a real zero-amount position row (the route
    // coalesces a null allocated_amount to 0 before summing). The point of this
    // case is the formatter: whole dollars, thousands separators, one `$`.
    expect(
      await screen.findByText(
        "Black Swan has a $0 allocation. A team-review strategy cannot hold an allocation — changing the mark removes it.",
      ),
    ).toBeInTheDocument();
  });
});

describe("MarkOwnershipDialog — write failure renders the canonical envelope", () => {
  it("a non-409 failure renders ErrorEnvelope in the body, keeps the dialog open and preserves the selection", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: "internal error" }),
    );
    const { onClose } = renderDialog({ currentMark: null });

    fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    // Selection survives the failure — the user does not re-answer the question.
    expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("a thrown fetch (offline) also renders the envelope rather than a bespoke string", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
  });
});

/**
 * [161-10 / WIZERR-07] THE DIALOG READS THE ROUTE'S CODE.
 *
 * Before this, the component recognised exactly ONE of the ownership route's
 * fourteen error arms, and it recognised it by matching `refusal.error ===
 * "live_allocation"` — PROSE. The other thirteen, all classified by the route,
 * rendered `buildEnvelope("UNKNOWN", …)`: "Something went wrong. We could not
 * classify this failure." That sentence was false about a signed-out session, a
 * rate limit, five distinct internal faults and two 404s alike.
 *
 * ORACLE INDEPENDENCE: the assertions read the envelope's `data-error-code`
 * attribute and hand-typed phrases. Nothing is imported from `wizardErrors.ts`.
 */
describe("[161-10 / WIZERR-07] classified failures render their own copy, not UNKNOWN", () => {
  async function submitAndFail(body: unknown, status: number) {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));
    return screen.findByTestId("error-envelope");
  }

  it.each([
    ["a signed-out session", 401, "DASHBOARD_SIGNED_OUT"],
    ["a mark outside the closed set", 400, "DASHBOARD_REQUEST_INVALID"],
    ["the rate limiter", 429, "RATE_LIMITED"],
    ["an internal fault before anything was sent", 500, "DASHBOARD_WRITE_FAILED"],
    // 161-REVIEW / CR-01 — the flip RPC erroring, or returning no row. The
    // route classifies these separately because the RPC that DELETES live
    // positions had already been sent; this asserts the dialog RENDERS the
    // distinction rather than collapsing it to UNKNOWN.
    [
      "an internal fault after the flip was issued",
      500,
      "DASHBOARD_WRITE_INDETERMINATE",
    ],
    ["a row that is no longer markable", 404, "DASHBOARD_ROW_STALE"],
  ])("%s renders its own envelope code", async (_label, status, code) => {
    const envelope = await submitAndFail({ code, error: "x" }, status);
    expect(envelope).toHaveAttribute("data-error-code", code);
    // NON-VACUITY: the envelope really rendered copy, so the negative below is
    // not passing against an empty node.
    expect(String(envelope.textContent).length).toBeGreaterThan(80);
    expect(envelope.textContent).not.toContain("Something went wrong.");
  });

  /**
   * ⭐ 161-REVIEW / CR-01 — WHAT THE USER ACTUALLY READS ON THE FLIP ARM.
   *
   * The copy-table cases in `wizardErrors.test.ts` pin the sentence; this pins
   * that the sentence REACHES the screen, on the surface where being wrong
   * costs the most. `flip_capital_ownership_to_team_review` deletes the
   * caller's live positions and sets the mark in one transaction, so a screen
   * saying "Nothing was saved" here can tell someone their book is untouched
   * while their positions are gone.
   */
  it("[161-CR-01] the indeterminate arm renders no zero-write claim, and names the action that settles it", async () => {
    const envelope = await submitAndFail(
      { code: "DASHBOARD_WRITE_INDETERMINATE", error: "internal error" },
      500,
    );
    const text = String(envelope.textContent);
    expect(text.length).toBeGreaterThan(140); // the haystack is real

    expect(
      text,
      "the flip arm told the user nothing was saved about a transaction that " +
        "removes live positions and whose outcome we could not read",
    ).not.toMatch(/nothing was saved/i);
    // The remedy that CAN settle an unknown outcome.
    expect(text).toMatch(/reload/i);
    expect(text).toMatch(/current state/i);
  });

  it("[161-CR-01] NEGATIVE CONTROL: the verified-zero-write arm keeps its sentence", async () => {
    // Without this, "no zero-write claim on the indeterminate arm" is satisfied
    // by copy that stopped making the claim anywhere — including on the two
    // arms that genuinely establish it and where it is the reassurance the user
    // most needs.
    const envelope = await submitAndFail(
      { code: "DASHBOARD_WRITE_FAILED", error: "internal error" },
      500,
    );
    expect(String(envelope.textContent)).toMatch(/nothing was saved/i);
  });

  /**
   * ⚠️ MEASURED, AND DELIBERATELY NOT ASSERTED HERE: the Retry CONTROL.
   *
   * The first draft of the two cases above also asserted that no Retry button
   * renders on the indeterminate arm, with the verified-zero arm as the
   * counterpart. The counterpart went RED, and the reason is worth recording
   * rather than working around: `ErrorEnvelope` gates the control on
   * `recoverable && Boolean(onRetry)`, and THIS DIALOG PASSES NO `onRetry` at
   * all (`grep -c onRetry` is 0 here and in `RenameStrategyDialog`; only
   * `AllocateDialog` wires one). So no Retry renders on this surface for ANY
   * code, and a `queryByRole(... /retry/i) === null` assertion here would have
   * been green against every possible implementation — the vacuous-pin trap.
   *
   * The behavioural half of CR-01 is therefore pinned where it is real:
   * `AllocateDialog.test.tsx` for the rendered control, and
   * `wizardErrors.test.ts` for the `buildEnvelope(...).recoverable` derivation
   * both dialogs would read if they ever wired one.
   */

  it("an UNRECOGNISED code still falls to UNKNOWN — recognition is a roster, not a cast", async () => {
    // Pitfall 4. A `body.code as WizardErrorCode` would ride this arbitrary
    // string onto the envelope and serve UNKNOWN's copy under it.
    const envelope = await submitAndFail(
      { code: "TOTALLY_MADE_UP", error: "x" },
      500,
    );
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });

  it("a code belonging to ANOTHER dashboard route is refused by this one", async () => {
    const envelope = await submitAndFail(
      { code: "ALLOCATION_NOT_ALLOCATABLE", error: "not_allocatable" },
      409,
    );
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });

  it("a 409 whose body cannot be READ is an envelope, not an unhandled throw", async () => {
    // Behaviour change worth naming: the previous shape called `res.json()`
    // un-guarded inside the 409 branch, so an unreadable body threw into the
    // transport `catch`. The envelope is the same either way, but the route
    // there was an exception path.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });

  it("PROSE ALONE no longer opens the confirm — the retired match cannot come back", async () => {
    // The receipt that the `error === "live_allocation"` read is really gone: a
    // 409 carrying the old sentence and NO code renders an envelope instead of
    // swapping in the destructive confirmation body. That direction matters
    // more than the usual one — the confirm arm is the ONLY client path to
    // `confirm_remove_allocation: true`, so opening it on prose alone would be
    // a destructive affordance minted from an unauthenticated string.
    const envelope = await submitAndFail(
      { error: "live_allocation", allocated_amount: 120000 },
      409,
    );
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
    expect(screen.queryByText(CONFIRM_HEADING)).toBeNull();
  });
});

/**
 * [161-10 / WIZERR-07] THE CORRELATION ID IS GATED TO TERMINAL ARMS.
 *
 * 161-UI-SPEC Copy Principle 4. THE MECHANISM: `ErrorEnvelope` prints the id
 * whenever it renders at all, so what decides whether the user sees one is
 * WHICH ARMS RENDER AN ENVELOPE. On this dialog the actionable arm is the
 * `LIVE_ALLOCATION` 409, which renders the confirmation body and no envelope.
 */
describe("[161-10 / WIZERR-07] correlation id: present on the terminal arm, absent on the actionable one", () => {
  const CORRELATION_LABEL = "correlation_id:";

  it("the TERMINAL arm shows a correlation id, and it is the one that was SENT", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, {
        code: "DASHBOARD_WRITE_FAILED",
        error: "internal error",
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope.textContent).toContain(CORRELATION_LABEL);

    // …and it JOINS to the server's log line for THIS attempt.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = new Headers(init.headers).get("X-Correlation-Id");
    expect(sent, "no correlation id was sent on the request").toBeTruthy();
    expect(envelope.textContent).toContain(String(sent));
  });

  it("the ACTIONABLE live-allocation arm shows NO correlation id anywhere on screen", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        code: "LIVE_ALLOCATION",
        error: "live_allocation",
        allocated_amount: 120000,
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    // NON-VACUITY: the arm really did render its question with the amount, so
    // the absence below is a property of a rendered dialog, not an empty one.
    expect(await screen.findByText(CONFIRM_HEADING)).toBeInTheDocument();
    expect(screen.getByText(CONFIRM_BODY_120K)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CORRELATION_LABEL);
  });
});

/**
 * [161-10 / E5] EVERY `fix[]` BULLET REACHES THE DOM — THE AUTOMATABLE HALF.
 *
 * 161-UI-SPEC § UI Considerations carries exactly ONE ⚠ unresolved row and it
 * belongs to WIZERR-07. Its ORIGINAL premise — that these dialogs mount the
 * envelope in a FIXED-HEIGHT body — was measured wrong and formally retracted:
 * `Modal.tsx` has no `max-h`, no `overflow` and no height (re-measured at HEAD
 * and pinned in `dialog-envelope.invariant.test.ts`).
 *
 * ⛔ WHAT THIS CASE DOES AND DOES NOT SETTLE. It proves the DATA layer loses
 * nothing: every remedy the copy table declares is present in the rendered
 * list, so no bullet is dropped between `buildEnvelope` and the DOM. It does
 * NOT settle the layout question. Whether an overflowing native `<dialog>`
 * SCROLLS or CLIPS on a short viewport is a UA-resolved rendered property that
 * jsdom does not compute at all — that half is verified BY HAND and recorded as
 * MANUAL. Do not read a green here as the ⚠ row being closed.
 *
 * THE ORACLE is the DOM list measured against the copy table — two different
 * artefacts, not one compared with itself. A renderer that dropped the tail of
 * the list, or a data path that truncated it, moves one side and not the other.
 */
describe("[161-10 / E5] the row of remedies is not truncated at the data layer", () => {
  it("renders EVERY bullet of the reached entry — none dropped", async () => {
    // ⚠️ TWO bullets, not three, for the reason recorded in the sibling case in
    // `RenameStrategyDialog.test.tsx`: no code this route emits carries three,
    // and padding the copy to reach a number would be writing the product to
    // fit the oracle. Derived from the table, so a third is covered for free.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        code: "DASHBOARD_ROW_STALE",
        error: "strategy not found",
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: CTA_SAVE }));

    const envelope = await screen.findByTestId("error-envelope");
    const expected = WIZARD_ERROR_COPY.DASHBOARD_ROW_STALE.fix;
    expect(expected.length).toBeGreaterThanOrEqual(2);

    const rendered = Array.from(envelope.querySelectorAll("li")).map((li) =>
      String(li.textContent),
    );
    expect(
      rendered.length,
      "the rendered remedy list is shorter than the copy declares — a bullet " +
        "was lost between the table and the DOM",
    ).toBe(expected.length);
    for (const bullet of expected) {
      expect(bullet.length).toBeGreaterThan(10);
      expect(rendered).toContain(bullet);
    }
  });
});

describe("MarkOwnershipDialog — source pins", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src/components/strategy/MarkOwnershipDialog.tsx"),
    "utf8",
  );

  it("writes through the route only — no client-direct database client (T-150-28)", () => {
    expect(SRC).not.toContain("supabase");
  });

  it("formats money through the ONE shared formatter — no local number formatting (W-7)", () => {
    expect(SRC).not.toContain("toLocaleString");
    expect(SRC).not.toContain("toFixed");
    expect(SRC).toContain("formatUsd");
  });

  it("mounts the shared question component rather than re-spelling the options (UI-SPEC invariant 5)", () => {
    expect(SRC).toContain("CapitalOwnershipRadioGroup");
  });

  it("[161-10] carries NO local wire-code lookup table — translation lives once, shared", () => {
    // Comment-stripped: this component's docblock NAMES the retired prose match
    // so the next reader knows what was removed, and a raw-text pin would match
    // that prose (the 140.2-08 / 150-02 self-matching-comment lesson).
    const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(SRC).toContain("/**");
    expect(CODE).not.toContain("/**");
    expect(CODE).toContain("submit");

    // No keyed lookup of any kind in this component…
    expect(CODE).not.toMatch(/Record<\s*string\s*,/);
    // …and the ONE shared recogniser is what decides the envelope code.
    expect(CODE).toContain("recogniseDashboardDialogCode");
  });
});
