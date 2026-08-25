/**
 * Phase 150 / OWN-05 — the owner rename dialog.
 *
 * Two things are pinned here that a "it submits and it works" suite would miss:
 *
 *   1. VALIDATION IS INLINE AND THE CTA STAYS CLICKABLE. The no-disabled-buttons
 *      direction says a blocked action is either ABSENT or clickable-with-a-
 *      remedy. A greyed `Save name` would be neither, and a validation arm that
 *      still issued the request would put the product rule on the server only.
 *      Both halves are asserted: the CTA is not disabled AND no fetch happened.
 *
 *   2. THE CLIENT DOES NOT PRE-TRUNCATE. Plan 04's route REJECTS an over-long
 *      name (400 `name too long`) rather than silently capping it, deliberately
 *      diverging from the alias route. A client-side `.slice(0, 80)` would hide
 *      that contract and re-introduce the fail-quiet, so the source pin forbids
 *      it and the behavioural case asserts the inline message instead.
 *
 * ORACLE INDEPENDENCE — every copy string is typed here as a literal, never
 * imported from the component (150-UI-SPEC Copywriting Contract is byte-binding).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RenameStrategyDialog } from "./RenameStrategyDialog";
// The copy table, read as the SOURCE side of the comparison. The DOM is the
// other side; a case comparing the DOM with itself could not fail.
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
import { installFetchMock, restoreFetchMock, type FetchMock } from "@/test/helpers/fetch";

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

// --- Literal oracles --------------------------------------------------------

const TITLE = "Rename strategy";
const FIELD_LABEL = "Name";
const HELPER =
  "Only you see this name. Public surfaces keep showing the codename.";
const CTA_SAVE = "Save name";
const CTA_CANCEL = "Cancel";
const ERR_EMPTY = "Enter a name.";
const ERR_TOO_LONG = "Keep it under 80 characters.";

const STRATEGY_ID = "88888888-8888-4888-8888-888888888888";
const CURRENT_NAME = "Alpha Centauri";

let fetchMock: FetchMock;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDialog(
  overrides: Partial<Parameters<typeof RenameStrategyDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const utils = render(
    <RenameStrategyDialog
      open
      onClose={onClose}
      strategyId={STRATEGY_ID}
      currentName={CURRENT_NAME}
      {...overrides}
    />,
  );
  return { ...utils, onClose };
}

const nameInput = () => screen.getByLabelText(FIELD_LABEL) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: CTA_SAVE });

beforeEach(() => {
  mockRefresh.mockReset();
  fetchMock = installFetchMock();
  fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, name: "x" }));
});

afterEach(() => {
  restoreFetchMock();
});

// ---------------------------------------------------------------------------

describe("RenameStrategyDialog — the form", () => {
  it("renders the title, a prefilled Name field and the D-18 helper line", () => {
    renderDialog();

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(nameInput()).toHaveValue(CURRENT_NAME);
    expect(screen.getByText(HELPER)).toBeInTheDocument();
  });

  it("Cancel closes without writing", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: CTA_CANCEL }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("RenameStrategyDialog — inline validation, clickable CTA, zero requests", () => {
  it("empty after trim → inline `Enter a name.`, field focused, CTA still clickable, NO fetch", async () => {
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_EMPTY)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // A blocked action stays clickable with an inline remedy — never greyed.
    expect(saveButton()).not.toBeDisabled();
    expect(document.activeElement).toBe(nameInput());
  });

  it("81 characters → inline `Keep it under 80 characters.`, NO fetch, nothing truncated", async () => {
    renderDialog();

    const tooLong = "a".repeat(81);
    fireEvent.change(nameInput(), { target: { value: tooLong } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_TOO_LONG)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveButton()).not.toBeDisabled();
    // The input keeps every character the user typed: the route REJECTS an
    // over-long name, so quietly capping it here would hide the contract.
    expect(nameInput()).toHaveValue(tooLong);
  });

  it("exactly 80 characters is accepted — the boundary is inclusive, matching the route", async () => {
    renderDialog();

    const atCap = "b".repeat(80);
    fireEvent.change(nameInput(), { target: { value: atCap } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ name: atCap });
  });

  it("a name that is legal only AFTER trimming is sent trimmed, not rejected", async () => {
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "  Helios sleeve  " } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ name: "Helios sleeve" });
  });
});

describe("RenameStrategyDialog — the write", () => {
  it("a valid submit PATCHes the name route, closes and refreshes", async () => {
    const { onClose } = renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/strategies/${STRATEGY_ID}/name`,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Helios alpha sleeve",
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("a server failure renders the canonical envelope, keeps the dialog open and preserves the input", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal error" }));
    const { onClose } = renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    expect(await screen.findByTestId("error-envelope")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue("Helios alpha sleeve");
  });

  it("the route's own 400 arms surface INLINE at the field, not as a terminal envelope", async () => {
    // Client and server validation can disagree on exotic whitespace, so the
    // server's two documented 400s must still land where the user is looking.
    //
    // 161-10 — the fixture now carries the route's `code`, because the dialog
    // discriminates on THAT and no longer on the `error` prose. The sentence is
    // still here, byte-identical, precisely so this fixture keeps describing a
    // real response rather than a convenient one.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: "NAME_TOO_LONG", error: "name too long" }),
    );
    renderDialog();

    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(ERR_TOO_LONG)).toBeInTheDocument();
    expect(screen.queryByTestId("error-envelope")).toBeNull();
  });
});

/**
 * [161-10 / WIZERR-07] THE DIALOG READS THE ROUTE'S CODE.
 *
 * Before this, the component recognised exactly TWO of the name route's nine
 * error arms — and it recognised them by matching `body.error` PROSE through a
 * local `ROUTE_FIELD_ERRORS` table. Every other arm, all of them classified by
 * the route, rendered `buildEnvelope("UNKNOWN", …)`: "Something went wrong. We
 * could not classify this failure." That sentence was false about a rate limit,
 * a signed-out session, a 500 and a 404 alike.
 *
 * ORACLE INDEPENDENCE: the assertions read the envelope's `data-error-code`
 * attribute and hand-typed phrases from the copy. Nothing is imported from
 * `wizardErrors.ts`, so an edit that put the vague sentence back reddens here.
 */
describe("[161-10 / WIZERR-07] classified failures render their own copy, not UNKNOWN", () => {
  async function submitAndFail(body: unknown, status: number) {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());
    return screen.findByTestId("error-envelope");
  }

  it.each([
    ["a signed-out session", 401, "DASHBOARD_SIGNED_OUT"],
    ["a request our own page built wrong", 400, "DASHBOARD_REQUEST_INVALID"],
    ["the rate limiter", 429, "RATE_LIMITED"],
    ["a failed write", 500, "DASHBOARD_WRITE_FAILED"],
    ["a row that is no longer renameable", 404, "DASHBOARD_ROW_STALE"],
  ])("%s renders its own envelope code", async (_label, status, code) => {
    const envelope = await submitAndFail({ code, error: "x" }, status);
    expect(envelope).toHaveAttribute("data-error-code", code);
    // NON-VACUITY: the envelope really rendered copy, so the negative below is
    // not passing against an empty node.
    expect(String(envelope.textContent).length).toBeGreaterThan(80);
    // …and it is NOT the sentence that admits knowing nothing.
    expect(envelope.textContent).not.toContain("Something went wrong.");
  });

  it("an UNRECOGNISED code still falls to UNKNOWN — recognition is a roster, not a cast", () => {
    // Pitfall 4. If the component ever wrote `body.code as WizardErrorCode`,
    // this arbitrary string would ride onto the envelope as its own code and
    // `formatKeyError` would silently serve UNKNOWN's copy under it.
    return submitAndFail({ code: "TOTALLY_MADE_UP", error: "x" }, 418).then(
      (envelope) => {
        expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
      },
    );
  });

  it("a code belonging to ANOTHER dashboard route is refused by this one", async () => {
    // The roster is per-route on purpose. A flat set would admit this.
    const envelope = await submitAndFail(
      { code: "ALLOCATION_NOT_ALLOCATABLE", error: "not_allocatable" },
      409,
    );
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });

  it("an unreadable body falls to UNKNOWN rather than claiming a verdict", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
  });

  it("both FIELD-LEVEL codes land inline at the Name field, never in an envelope", async () => {
    for (const [code, message] of [
      ["NAME_REQUIRED", ERR_EMPTY],
      ["NAME_TOO_LONG", ERR_TOO_LONG],
    ] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { code, error: "x" }));
      const { unmount } = renderDialog();
      fireEvent.change(nameInput(), {
        target: { value: "Helios alpha sleeve" },
      });
      fireEvent.click(saveButton());

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByTestId("error-envelope")).toBeNull();
      unmount();
    }
  });

  it("PROSE ALONE no longer classifies — the retired lookup cannot come back", async () => {
    // The receipt that `ROUTE_FIELD_ERRORS` is really gone rather than merely
    // renamed: a 400 carrying the old sentence and NO code is not recognised as
    // a field problem any more. This is the deliberate cost of retiring the
    // prose key, and it is asserted rather than discovered.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: "name too long" }),
    );
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "UNKNOWN");
    expect(screen.queryByText(ERR_TOO_LONG)).toBeNull();
  });
});

/**
 * [161-10 / WIZERR-07] THE CORRELATION ID IS GATED TO TERMINAL ARMS.
 *
 * 161-UI-SPEC Copy Principle 4: "Correlation id only on terminal /
 * non-actionable arms. On an actionable error it is noise competing with the
 * remedy."
 *
 * THE MECHANISM, stated so the assertions are not mistaken for a renderer
 * feature: `ErrorEnvelope` prints the id in its diagnostics block whenever it
 * renders at all. What decides whether the user sees one is therefore WHICH
 * ARMS RENDER AN ENVELOPE — and the field-level arms deliberately do not. That
 * is the whole gate, and it is a property of this component, not of the shared
 * renderer (which this plan does not touch).
 */
describe("[161-10 / WIZERR-07] correlation id: present on the terminal arm, absent on the actionable one", () => {
  const CORRELATION_LABEL = "correlation_id:";

  it("the TERMINAL arm shows a correlation id, and it is the one that was SENT", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { code: "DASHBOARD_WRITE_FAILED", error: "internal error" }),
    );
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope.textContent).toContain(CORRELATION_LABEL);

    // …and it JOINS to the server's log line for THIS attempt: the id on screen
    // is the id that rode the request header. An id minted only on the failure
    // path would satisfy the line above and join to nothing.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = new Headers(init.headers).get("X-Correlation-Id");
    expect(sent, "no correlation id was sent on the request").toBeTruthy();
    expect(envelope.textContent).toContain(String(sent));
  });

  it("the ACTIONABLE field arm shows NO correlation id anywhere on screen", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: "NAME_TOO_LONG", error: "name too long" }),
    );
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    // NON-VACUITY: the arm really did render its remedy, so the absence below
    // is a property of a rendered dialog rather than of an empty one.
    expect(await screen.findByText(ERR_TOO_LONG)).toBeInTheDocument();
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
    // `DASHBOARD_ROW_STALE` is the richest remedy list this dialog's route can
    // actually reach. ⚠️ It carries TWO bullets, not three: 161-10-PLAN asked
    // for a ≥3-bullet case on all three dialogs, and on THIS surface no
    // rostered code has three. Padding the copy to reach the number would be
    // writing the product to fit the oracle, which is the inverse of the rule,
    // so the case asserts the REAL maximum and derives it from the table — a
    // third bullet added later is covered with no test edit. The genuine
    // ≥3-bullet case lives on `AllocateDialog`, whose route really does emit
    // a three-remedy code.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, {
        code: "DASHBOARD_ROW_STALE",
        error: "strategy not found",
      }),
    );
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Helios alpha sleeve" } });
    fireEvent.click(saveButton());

    const envelope = await screen.findByTestId("error-envelope");
    const expected = WIZARD_ERROR_COPY.DASHBOARD_ROW_STALE.fix;

    // NON-VACUITY FLOOR: an empty expected list would make the loop below pass
    // trivially, and `"anything".includes("")` would make a blank bullet pass.
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

describe("RenameStrategyDialog — source pins", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src/components/strategy/RenameStrategyDialog.tsx"),
    "utf8",
  );

  it("writes through the route only — no client-direct database client (T-150-28)", () => {
    expect(SRC).not.toContain("supabase");
  });

  it("never pre-truncates the owner's name (the route rejects; a client cap would hide that)", () => {
    expect(SRC).not.toContain(".slice(");
    expect(SRC).not.toContain("maxLength");
  });

  it("uses the shared Field primitive so the error is wired to the control", () => {
    expect(SRC).toContain("Field");
  });

  it("[161-10] carries NO local wire-code lookup table — translation lives once, shared", () => {
    // ⚠️ COMMENT-STRIPPED, and that is not a convenience. The component's
    // docblock NAMES the retired table so the next reader knows what was
    // removed and why; a raw-text pin would match that prose and make the file
    // its own offender (the 140.2-08 / 150-02 self-matching-comment lesson).
    const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    // Anti-vacuity: the stripper really stripped and the source really loaded.
    expect(SRC).toContain("/**");
    expect(CODE).not.toContain("/**");
    expect(CODE).toContain("handleSave");

    // The retired one by name, so a revert is loud…
    expect(CODE).not.toContain("ROUTE_FIELD_ERRORS");
    // …and the SHAPE, so it cannot come back under a new name: no
    // `Record<string, …>` keyed lookup of any kind in this component.
    expect(CODE).not.toMatch(/Record<\s*string\s*,/);
    // What must be here instead: the ONE shared recogniser.
    expect(CODE).toContain("recogniseDashboardDialogCode");
  });
});
