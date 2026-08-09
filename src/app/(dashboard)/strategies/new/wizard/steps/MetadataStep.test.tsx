/** @vitest-environment jsdom */
/**
 * H-0191 — MetadataStep component behavior.
 *
 * Untested before: (a) categoryLoadError state when the discovery_categories
 * fetch errors; (b) auto-select of categories[0] when categoryId is null AND
 * data is non-empty (a regression to default "" would silently submit an
 * invalid category_id and fail at finalize); (c) the detected-exchange chip
 * renders pre-selected (aria-pressed) when initial is null — the canonicalized
 * default; (d) the Submit gate (description + categoryId) and the onComplete
 * payload.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetadataStep, type MetadataDraft } from "./MetadataStep";
import { WIZARD_ERROR_COPY, formatKeyError } from "@/lib/wizardErrors";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";

// Supabase client mock: MetadataStep does
//   supabase.from("discovery_categories").select("id, name").order("sort_order")
// and awaits the result. `orderResult` is overridden per-test.
let orderResult: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        order: (_col: string) => Promise.resolve(orderResult),
      }),
    }),
  }),
}));

// M-0248 (F1 loud-fail): an unreadable discovery_categories table must
// fire wizard_error telemetry so the founder/ops team gets a signal —
// not just show inline copy. We assert the analytics payload directly.
const trackMock = vi.fn();
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: (...args: unknown[]) => trackMock(...args),
}));

const CATS = [
  { id: "cat-aaa", name: "Market Neutral" },
  { id: "cat-bbb", name: "Directional" },
];

const baseProps = {
  strategyId: "strat-1",
  wizardSessionId: "session-1",
  initial: null,
  detectedMarkets: [] as string[],
  detectedExchange: null as string | null,
  onComplete: vi.fn(),
  onBack: vi.fn(),
};

describe("[H-0191] MetadataStep", () => {
  beforeEach(() => {
    orderResult = { data: CATS, error: null };
    baseProps.onComplete = vi.fn();
    baseProps.onBack = vi.fn();
    trackMock.mockClear();
  });

  it("auto-selects categories[0] when categoryId is null and data is non-empty", async () => {
    render(<MetadataStep {...baseProps} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));
  });

  it("surfaces categoryLoadError copy when the supabase query returns an error", async () => {
    orderResult = { data: null, error: { message: "rls denied" } };
    render(<MetadataStep {...baseProps} />);
    expect(
      await screen.findByText(/Could not load strategy categories\./i),
    ).toBeInTheDocument();
  });

  it("[M-0248] fires wizard_error telemetry when the category select errors", async () => {
    // Loud-fail: an RLS regression / Supabase outage that makes
    // discovery_categories unreadable must emit observable telemetry so
    // the founder/ops team sees the user is blocked — the inline copy
    // alone is invisible to them. Asserting the exact code so an
    // "UNKNOWN" or missing event cannot satisfy the test.
    orderResult = { data: null, error: { message: "rls denied" } };
    render(<MetadataStep {...baseProps} />);

    await waitFor(() => expect(trackMock).toHaveBeenCalled());
    const call = trackMock.mock.calls.find(
      (c) => (c as unknown[])[0] === "wizard_error",
    ) as unknown[] | undefined;
    expect(call).toBeDefined();
    const payload = call![1] as {
      code: string;
      step: string;
      wizard_session_id: string;
    };
    expect(payload.code).toBe("METADATA_CATEGORY_LOAD_FAILED");
    expect(payload.step).toBe("metadata");
    expect(payload.wizard_session_id).toBe("session-1");
  });

  it("[M-0248] does NOT fire wizard_error on a genuine empty (readable) result", async () => {
    // Discriminate failure from empty: zero categories that read cleanly
    // is a legitimate (if degenerate) state, not an error — no telemetry.
    orderResult = { data: [], error: null };
    render(<MetadataStep {...baseProps} />);
    // Let the effect settle.
    await screen.findByLabelText("Category");
    const errored = trackMock.mock.calls.some(
      (c) => (c as unknown[])[0] === "wizard_error",
    );
    expect(errored).toBe(false);
  });

  it("[WR-04] surfaces an honest block when categories load to an empty (readable) set", async () => {
    // An empty-but-readable category list leaves categoryId=null, so no submit
    // can succeed. On the CSV path there is no detected-markets hint to explain
    // the block, so the step must surface an honest reason rather than a silent
    // dead-end (ISSUE-010 must never reopen via category_id=null).
    //
    // 153.2 / WIZFORM-01 — this used to assert `toBeDisabled()`. The submit
    // button is no longer disabled for a validation reason (a dead button names
    // nothing), so what must be proven here is the BEHAVIOUR the disabled prop
    // used to stand for: with no category loadable the submit is refused and
    // onComplete is never reached. The honest block above is the explanation
    // the disabled button never gave.
    orderResult = { data: [], error: null };
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    // Wait for the fetch to settle (categoriesLoaded gates the hint).
    expect(
      await screen.findByTestId("metadata-categories-empty"),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A perfectly valid description of a strategy." },
    });
    fireEvent.click(submit);
    expect(onComplete).not.toHaveBeenCalled();
    // The honest empty block must NOT fire wizard_error telemetry (that is the
    // failure path; an empty readable result is a legitimate degenerate state).
    const errored = trackMock.mock.calls.some(
      (c) => (c as unknown[])[0] === "wizard_error",
    );
    expect(errored).toBe(false);
  });

  it("[WR-04] does NOT surface the empty-category block when categories load non-empty", async () => {
    orderResult = { data: CATS, error: null };
    render(<MetadataStep {...baseProps} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));
    expect(screen.queryByTestId("metadata-categories-empty")).toBeNull();
  });

  it("[153.2 / D-15] the detected venue is a FACT, not a choice — it renders as a span, not a control", () => {
    // detectedExchange is the lowercase api_keys.exchange ('okx'); the group
    // matches case-sensitively ('OKX'), so the default must canonicalize or the
    // venue renders unselected — the original ISSUE-004 claim, unchanged.
    //
    // 153.2 / MT5-14 / D-15 — what CHANGED is the element. This row used to
    // assert `getByRole("button", { name: "OKX" })` carried aria-pressed=true.
    // The venue of the connected key is not a question the user is being asked:
    // they answered it by connecting that key, and un-answering it would
    // declare a strategy that excludes the venue it trades on. So it is stated
    // as a fact — a non-interactive <span> wearing the selected tokens, out of
    // the tab order and with nothing to turn off.
    //
    // ⛔ NOT a greyed-out control. A dead thing the user can see and cannot act
    // on is the failure mode this whole phase deletes.
    render(<MetadataStep {...baseProps} detectedExchange="okx" />);
    expect(screen.queryByRole("button", { name: "OKX" })).toBeNull();
    const pinned = screen.getByText("OKX");
    expect(pinned.tagName).toBe("SPAN");
    // The selected tokens, verbatim — it looks chosen because it is chosen.
    expect(pinned.className).toContain("border-accent");
    expect(pinned.className).toContain("bg-accent/10");
    expect(pinned.className).toContain("text-accent");
    // …and every OTHER venue is still a real choice. Without this the row is
    // satisfied by a group that stopped rendering controls altogether.
    expect(screen.getByRole("button", { name: "Binance" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Bybit" })).toBeInTheDocument();
  });

  it("[153.2 / D-15] no venue is pinned when no key was connected (the CSV path)", () => {
    // detectedExchange=null: there is no fact to state, so every venue stays a
    // choice and neither annotation renders. Without this row, a bug that
    // pinned the FIRST item unconditionally would pass every row above.
    render(<MetadataStep {...baseProps} detectedExchange={null} />);
    expect(screen.getByRole("button", { name: "OKX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Binance" })).toBeInTheDocument();
    expect(screen.queryByText("DETECTED FROM YOUR KEY")).toBeNull();
    expect(
      screen.queryByText(/is included because it is the venue of the key/i),
    ).toBeNull();
  });

  // ── 153.2 / WIZFORM-01 — the submit button is NEVER disabled for a
  // validation reason, and the predicate that used to live in the `disabled`
  // prop now lives in handleSubmit where it can NAME the failing field.
  //
  // These three rows replace two `toBeDisabled()` assertions. The old shape
  // could only prove the button was dead; it could not prove the user was ever
  // told why, and "the user was never told why" is the defect (D-13: a
  // nameless refusal sent the founder to corrupt unrelated fields). Each row
  // below therefore asserts the same three things about a differently-invalid
  // draft: the control is REACHABLE, activating it does NOT reach onComplete,
  // and the field says so.
  it("[WIZFORM-01] Submit is enabled but refuses when description and categoryId are both absent", async () => {
    // No categories so auto-select cannot fill categoryId, and an empty
    // description. Formerly asserted `toBeDisabled()`.
    orderResult = { data: [], error: null };
    const onComplete = vi.fn();
    render(
      <MetadataStep
        {...baseProps}
        onComplete={onComplete}
        detectedMarkets={["BTC"]}
      />,
    );
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    const submit = screen.getByRole("button", { name: /review and submit/i });

    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(document.activeElement).toBe(description);
  });

  it("[WR-03] a whitespace-only description leaves Submit enabled and is refused at the field", async () => {
    // A whitespace-only description ("   ") is truthy but invalid. WR-03's
    // original concern — that the button's predicate and the validation rule
    // must not drift — is now structural rather than asserted: there is exactly
    // ONE predicate (`validateDescription`), read by both the message and the
    // submit guard, so they cannot disagree. What is left to prove is that the
    // whitespace draft is still refused, and refused visibly.
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    const description = screen.getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "   " } });

    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
  });

  it("[WIZFORM-01] a 2-character description with a category present is refused at the field, not at the server", async () => {
    // ⭐ THE incident row. Before this phase, a two-character description
    // satisfied every client check, POSTed, and died at `finalize-wizard` as a
    // full-page envelope that named no field — read three times by the founder,
    // who then went and changed the supported-exchanges chips looking for the
    // cause. The client knows this rule; it must refuse here.
    //
    // The fixture is deliberately sized WELL under the bound rather than at
    // `MIN_DESCRIPTION_CHARS - 1`: a fixture derived from the constant under
    // test would still pass if the constant were mutated to something absurd,
    // which is the "guard that cannot fail" shape. Two characters is short by
    // any plausible reading of "at least ten".
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    const description = screen.getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "ab" } });

    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(onComplete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(document.activeElement).toBe(description);
  });

  it("[WIZFORM-01] a description at exactly the minimum length is ACCEPTED", async () => {
    // The companion to the row above, and the reason it can fail honestly: the
    // bound is `< MIN` (reject) / `>= MIN` (accept), matching what
    // `finalize-wizard` enforces. Without this row a mirror that refused
    // EVERYTHING would satisfy the refusal test. Built FROM the constant on
    // purpose — here the constant is the subject, not the oracle: the claim is
    // "whatever MIN is, exactly MIN passes".
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    const atMinimum = "x".repeat(MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: atMinimum },
    });
    fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect((onComplete.mock.calls[0]![0] as MetadataDraft).description).toBe(
      atMinimum,
    );
  });

  // ── Phase 53 / APPLY-02 + 153.2 — inline per-field validation surfacing ───
  //
  // ⚠️ These rows assert against `formatKeyError(...).title` imported from the
  // copy module, never a hand-typed sentence. A hand-typed oracle turns a copy
  // edit into a red test AND, worse, cannot detect the field rendering the
  // WRONG entry — it only proves some string matched some other string.
  //
  // 153.2 moved the field from the entry's `cause` (a paragraph) to its
  // `title` (one sentence), so every `.cause` oracle below became a `.title`
  // one in the same commit.

  /** The id `aria-describedby` reserves for the error line, per Field's wiring. */
  function errorNodeFor(control: Element): HTMLElement | null {
    const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/);
    const errorId = ids.find((id) => id.endsWith("-error"));
    return errorId ? document.getElementById(errorId) : null;
  }

  it("[APPLY-02] blur on an empty description surfaces the wizardErrors copy through Field a11y", async () => {
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    // No error before interaction.
    expect(description.getAttribute("aria-invalid")).not.toBe("true");
    expect(errorNodeFor(description)).toBeNull();

    fireEvent.blur(description);

    // Field wires aria-invalid + aria-describedby pointing at the message id.
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );

    // The described element exists and carries the EXISTING wizardErrors copy
    // (not a new inline string) — message id is the one aria-describedby names.
    const messageNode = errorNodeFor(description);
    expect(messageNode).not.toBeNull();
    expect(messageNode!.textContent).toBe(
      formatKeyError("METADATA_DESCRIPTION_REQUIRED").title,
    );
  });

  it("[153.2] the description field renders the copy TITLE, never the paragraph", async () => {
    // The specific regression this guards: a field message that is a paragraph
    // is a field message nobody reads, and `cause` is written for the error
    // panel ("Nothing was saved, and everything you typed is still on the
    // form") — sentences that make no sense under a control the user is still
    // typing into. Asserted as an inequality against the SAME entry so it can
    // only fail by the field actually reverting.
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    fireEvent.blur(description);

    await waitFor(() => expect(errorNodeFor(description)).not.toBeNull());
    const text = errorNodeFor(description)!.textContent;
    expect(text).toBe(formatKeyError("METADATA_DESCRIPTION_REQUIRED").title);
    expect(text).not.toBe(
      WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause,
    );
  });

  it("[153.2] a too-short description names the rule AND the user's own count", async () => {
    // D-13's behavioural bar: the message must say which field, what the rule
    // is, and where the user currently stands against it. The count is the
    // length the mirror measured, so the sentence and the guard cannot disagree
    // about the number.
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "ab" } });
    fireEvent.blur(description);

    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(errorNodeFor(description)!.textContent).toBe(
      formatKeyError("METADATA_DESCRIPTION_TOO_SHORT", { charCount: 2 }).title,
    );
  });

  it("[153.2] an over-long description is refused with the upper-bound sentence", async () => {
    // The third state. Sized one character past MAX so the boundary is the
    // subject: `> MAX` rejects, `MAX` exactly is accepted (asserted below).
    const tooLong = "x".repeat(MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS + 1);
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: tooLong } });
    fireEvent.blur(description);

    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(errorNodeFor(description)!.textContent).toBe(
      formatKeyError("METADATA_DESCRIPTION_TOO_LONG", {
        charCount: tooLong.length,
      }).title,
    );
  });

  it("[153.2] a description at exactly the upper bound is accepted", async () => {
    // Pins the inclusive boundary the copy claims ("or fewer") and the server
    // enforces (`> MAX` rejects). Without this row the too-long test above is
    // satisfied by an off-by-one that refuses a legal 5,000-character
    // description — a silent tightening of a stated rule.
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    const atMax = "x".repeat(MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS);
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: atMax },
    });
    fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("[153.2] typing into a never-blurred field stays silent", async () => {
    // The silence rule. Turning a field red while the user is still typing the
    // first character teaches them to ignore red, which is the failure mode
    // that makes every later message worthless.
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    fireEvent.change(description, { target: { value: "A" } });

    expect(description.getAttribute("aria-invalid")).not.toBe("true");
    expect(errorNodeFor(description)).toBeNull();
  });

  it("[153.2] the message and the red border clear LIVE, with no second blur", async () => {
    // ⭐ The live-clear rule. Reveal at two characters, then type up to a valid
    // length WITHOUT blurring again: the sentence and the aria-derived border
    // must both go. A message latched into state on blur satisfies every other
    // row in this file and fails only here — which is exactly why this row
    // exists. It also proves the count tracks keystrokes on the way up.
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    fireEvent.change(description, { target: { value: "ab" } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );

    // Still short, one character longer — the count in the sentence moves.
    fireEvent.change(description, { target: { value: "abc" } });
    await waitFor(() =>
      expect(errorNodeFor(description)!.textContent).toBe(
        formatKeyError("METADATA_DESCRIPTION_TOO_SHORT", { charCount: 3 })
          .title,
      ),
    );

    // Now valid — no blur, no submit, no click.
    fireEvent.change(description, {
      target: { value: "A market-neutral basis strategy." },
    });
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).not.toBe("true"),
    );
    expect(errorNodeFor(description)).toBeNull();
  });

  it("[153.2] the pre-emptive hint is visible and referenced by aria-describedby", async () => {
    // The cheapest fix in the phase: state the rule BEFORE the user can break
    // it. Composed from MIN_DESCRIPTION_CHARS, so this reads the constant
    // rather than a typed sentence — a retune of the bound moves the hint, the
    // error copy and the guard together or the suite reds.
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    const ids = (description.getAttribute("aria-describedby") ?? "").split(
      /\s+/,
    );
    const hintId = ids.find((id) => id.endsWith("-hint"));
    expect(hintId).toBeTruthy();
    const hintNode = document.getElementById(hintId!);
    expect(hintNode).not.toBeNull();
    expect(hintNode!.textContent).toBe(
      `At least ${MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS} characters.`,
    );
    // Visible, not a tooltip: it is in the document and carries no aria-hidden.
    expect(hintNode!.getAttribute("aria-hidden")).toBeNull();
  });

  it("[APPLY-02] the per-field description message is NOT role=alert (envelope owns the summary)", async () => {
    render(<MetadataStep {...baseProps} />);
    const description = await screen.findByLabelText("Description");
    fireEvent.blur(description);

    const message = await screen.findByText(
      formatKeyError("METADATA_DESCRIPTION_REQUIRED").title,
    );
    expect(message.getAttribute("role")).not.toBe("alert");
    expect(message.closest('[role="alert"]')).toBeNull();
  });

  it("[APPLY-02] the inline error clears once a description is typed", async () => {
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    fireEvent.blur(description);
    await screen.findByText(
      formatKeyError("METADATA_DESCRIPTION_REQUIRED").title,
    );

    fireEvent.change(description, { target: { value: "A real description." } });
    await waitFor(() =>
      expect(
        screen.queryByText(
          formatKeyError("METADATA_DESCRIPTION_REQUIRED").title,
        ),
      ).toBeNull(),
    );
    expect(description.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("[APPLY-02] submitting with an empty description reveals the error and focuses the field (AT path)", async () => {
    // The Submit button is disabled until valid, so this exercises the
    // submitAttempted branch directly via the form submit — the AT/keyboard
    // path where the handler is reached with an empty description. It must
    // reveal the inline error AND move focus to the offending field, AND NOT
    // call onComplete (the invalid submit is blocked).
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;
    const form = description.closest("form");
    expect(form).not.toBeNull();

    // No error before any submit attempt (description not blurred yet).
    expect(description.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.submit(form!);

    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(document.activeElement).toBe(description);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("emits the captured fields (incl. auto-selected categoryId) via onComplete", async () => {
    const onComplete = vi.fn();
    render(<MetadataStep {...baseProps} onComplete={onComplete} />);
    // Wait for the category auto-select to settle.
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A market-neutral basis strategy." },
    });

    const submit = screen.getByRole("button", { name: /review and submit/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const draft = onComplete.mock.calls[0]![0] as MetadataDraft;
    expect(draft.categoryId).toBe("cat-aaa");
    expect(draft.description).toBe("A market-neutral basis strategy.");
  });

  // ── 153.2-02 / WIZFORM-01 — the OTHER three fields that can be got wrong ──
  //
  // WIZFORM-01 is a CLASS, not the description field. Category, AUM and max
  // capacity each carry a rule `finalize-wizard` enforces and this form can
  // evaluate, so each must refuse at its own control. Leaving them to the
  // server would let all three reproduce the founder's failure through the
  // identical path — a full-page envelope that names no field.
  //
  // Each field gets the same three claims the description has: SILENCE before
  // the first interaction, the copy-table sentence + the ARIA state after it,
  // and a LIVE clear on correction. Any one of the three alone is satisfiable
  // by a mirror that is wrong in one of the other two directions.
  describe("[153.2] category, AUM and capacity refuse at their own fields", () => {
    /** Render, wait for the category auto-select, return the settled select. */
    async function renderSettled(
      extraProps: Partial<React.ComponentProps<typeof MetadataStep>> = {},
    ): Promise<HTMLSelectElement> {
      render(<MetadataStep {...baseProps} {...extraProps} />);
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));
      return select;
    }

    // ── Category ──────────────────────────────────────────────────────────

    it("[FLAG-1] ALL FOUR validated controls derive their invalid border from the ARIA state", async () => {
      // ⭐ The class-level guard, asserted on the RENDERED DOM rather than by
      // grepping the source. Three of the four share one class constant (one
      // spelling cannot drift — the D-23 lesson applied to a class run), so a
      // source grep counts spellings, not fields, and would pass while a field
      // quietly went back to a JS-coloured border. This row counts FIELDS: each
      // control the form validates must carry the derivation token, so the only
      // way to paint any of them red is to hand `Field` an error, which is also
      // the only thing that writes the ARIA state.
      await renderSettled({ detectedExchange: null });
      for (const label of [
        "Description",
        "Category",
        "AUM (USD)",
        "Max capacity (USD)",
      ]) {
        const control = screen.getByLabelText(label);
        expect(control.className).toContain(
          "aria-[invalid=true]:border-negative",
        );
        // …and none of them carries the low-alpha ring the primitives ship,
        // which measures ~1.3:1 against bg-surface (WCAG 1.4.11 wants ≥3:1).
        expect(control.className).not.toContain("ring-accent/20");
        expect(control.className).toContain("focus-visible:ring-inset");
      }
    });

    it("keeps the category select addressable by its label after the Field conversion", async () => {
      // The conversion from the `Select` primitive to `Field` + a bare <select>
      // is only safe because Field wires htmlFor↔id the same way. Every
      // pre-existing row in this file and two e2e specs address this control by
      // label, so the wiring is asserted rather than assumed — and the ARIA
      // state the primitive never wrote is asserted to be available here.
      const select = await renderSettled();
      expect(select.tagName).toBe("SELECT");
      expect(select.className).toContain("aria-[invalid=true]:border-negative");
      expect(document.querySelector('label[for="' + select.id + '"]')?.textContent).toBe(
        "Category",
      );
    });

    it("stays SILENT about a cleared category until the field is blurred", async () => {
      const select = await renderSettled();
      fireEvent.change(select, { target: { value: "" } });

      expect(select.getAttribute("aria-invalid")).not.toBe("true");
      expect(errorNodeFor(select)).toBeNull();
    });

    it("refuses a cleared category AT the category field with the copy-table sentence", async () => {
      const select = await renderSettled();
      fireEvent.change(select, { target: { value: "" } });
      fireEvent.blur(select);

      await waitFor(() =>
        expect(select.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(errorNodeFor(select)!.textContent).toBe(
        formatKeyError("METADATA_CATEGORY_REQUIRED").title,
      );
    });

    it("clears the category message LIVE when a category is chosen again", async () => {
      const select = await renderSettled();
      fireEvent.change(select, { target: { value: "" } });
      fireEvent.blur(select);
      await waitFor(() =>
        expect(select.getAttribute("aria-invalid")).toBe("true"),
      );

      // No second blur — the re-evaluation must be live.
      fireEvent.change(select, { target: { value: "cat-bbb" } });
      await waitFor(() =>
        expect(select.getAttribute("aria-invalid")).not.toBe("true"),
      );
      expect(errorNodeFor(select)).toBeNull();
    });

    it("[T-153.2-06] does NOT demand a category the catalogue cannot offer", async () => {
      // The honesty rule. With zero categories the user cannot choose one, so
      // "Choose a category." is an instruction they cannot follow; the honest
      // block states the real cause instead. ⛔ But the REFUSAL survives — a
      // draft with no category must never reach onComplete (ISSUE-010).
      orderResult = { data: [], error: null };
      const onComplete = vi.fn();
      render(<MetadataStep {...baseProps} onComplete={onComplete} />);
      expect(
        await screen.findByTestId("metadata-categories-empty"),
      ).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: "A market-neutral basis strategy." },
      });
      fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

      expect(onComplete).not.toHaveBeenCalled();
      expect(
        screen.queryByText(formatKeyError("METADATA_CATEGORY_REQUIRED").title),
      ).toBeNull();
      const select = screen.getByLabelText("Category");
      expect(select.getAttribute("aria-invalid")).not.toBe("true");
    });

    // ── AUM and max capacity ─────────────────────────────────────────────
    //
    // ⛔ The bound is NOT re-typed in this file. Every fixture below is built
    // FROM `MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD` — the same constant
    // `isValidDollar` reads and the same one `finalize-wizard` reports — so the
    // claim each row makes is "whatever the cap is, this side of it passes and
    // that side refuses", which survives a retune of the cap.
    const MAX_DOLLARS = MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;

    it.each([
      {
        field: "AUM (USD)",
        code: "METADATA_AUM_INVALID" as const,
      },
      {
        field: "Max capacity (USD)",
        code: "METADATA_CAPACITY_INVALID" as const,
      },
    ])(
      "refuses a negative $field at its own field, and stays silent until blur",
      async ({ field, code }) => {
        await renderSettled();
        const control = screen.getByLabelText(field) as HTMLInputElement;

        fireEvent.change(control, { target: { value: "-5" } });
        // Silence first: a field turning red mid-keystroke teaches the user to
        // ignore red, which makes every later message worthless.
        expect(control.getAttribute("aria-invalid")).not.toBe("true");
        expect(errorNodeFor(control)).toBeNull();

        fireEvent.blur(control);
        await waitFor(() =>
          expect(control.getAttribute("aria-invalid")).toBe("true"),
        );
        expect(errorNodeFor(control)!.textContent).toBe(
          formatKeyError(code).title,
        );

        // …and it clears LIVE on a correction, with no second blur.
        fireEvent.change(control, { target: { value: "250000" } });
        await waitFor(() =>
          expect(control.getAttribute("aria-invalid")).not.toBe("true"),
        );
        expect(errorNodeFor(control)).toBeNull();
      },
    );

    it.each([
      { field: "AUM (USD)" },
      { field: "Max capacity (USD)" },
    ])(
      "refuses a $field AT the cap and accepts one just under it",
      async ({ field }) => {
        // `isValidDollar` is `v < MAX`, so the cap itself is OUT. Without the
        // acceptance half, a mirror that refused every value would satisfy the
        // refusal half — the guard-that-cannot-fail shape, inverted.
        await renderSettled();
        const control = screen.getByLabelText(field) as HTMLInputElement;

        fireEvent.change(control, { target: { value: String(MAX_DOLLARS) } });
        fireEvent.blur(control);
        await waitFor(() =>
          expect(control.getAttribute("aria-invalid")).toBe("true"),
        );

        fireEvent.change(control, {
          target: { value: String(MAX_DOLLARS - 1) },
        });
        await waitFor(() =>
          expect(control.getAttribute("aria-invalid")).not.toBe("true"),
        );
      },
    );

    it("accepts a BLANK AUM and capacity — the server's omitted case, mirrored", async () => {
      // ⭐ The half a paraphrased mirror drops. `finalize-wizard` reads
      // `!isOmitted(x) && !isValidDollar(x)`, and `SubmitStep` sends
      // `metadata.aum ? Number(...) : null` — so an untouched money field is
      // OMITTED and valid. A mirror that checked only `isValidDollar` would
      // refuse every blank AUM client-side while the server accepted it, which
      // is a form stricter than the rule it states. Both fields are blurred
      // deliberately: blur is the reveal trigger, so this proves the silence is
      // a verdict and not merely un-revealed.
      const onComplete = vi.fn();
      render(<MetadataStep {...baseProps} onComplete={onComplete} />);
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      const aum = screen.getByLabelText("AUM (USD)") as HTMLInputElement;
      const capacity = screen.getByLabelText(
        "Max capacity (USD)",
      ) as HTMLInputElement;
      fireEvent.blur(aum);
      fireEvent.blur(capacity);
      expect(aum.getAttribute("aria-invalid")).not.toBe("true");
      expect(capacity.getAttribute("aria-invalid")).not.toBe("true");

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: "A market-neutral basis strategy." },
      });
      fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

      expect(onComplete).toHaveBeenCalledTimes(1);
      const draft = onComplete.mock.calls[0]![0] as MetadataDraft;
      expect(draft.aum).toBe("");
      expect(draft.maxCapacity).toBe("");
    });

    it("refuses the SUBMIT on an invalid AUM, not just the field", async () => {
      // The mirror and the submit predicate are one derivation, so a field that
      // shows red and a submit that goes through anyway is impossible by
      // construction — asserted here because "impossible by construction" is a
      // claim about code that can be rewritten.
      const onComplete = vi.fn();
      render(<MetadataStep {...baseProps} onComplete={onComplete} />);
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: "A market-neutral basis strategy." },
      });
      fireEvent.change(screen.getByLabelText("AUM (USD)"), {
        target: { value: "-5" },
      });
      fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  // ── 153.2-02 Task 2 — a refused submit names the first problem and puts the
  //    cursor in it ────────────────────────────────────────────────────────
  //
  // D-13's bar is behavioural. The founder's failure was not an ugly error, it
  // was an error that named no field — so they edited the wrong ones. Revealing
  // every message is only half of that; the other half is telling the user WHICH
  // one to start with and taking them there, including when "there" is behind a
  // disclosure they have never opened.
  //
  // ⚠️ The summary sentences below ARE typed out, unlike every field-message
  // oracle in this file. That is deliberate: this sentence is composed in the
  // component from a count and a label map, so it has no copy-table entry to
  // import — and its singular form is a recorded deviation from the UI
  // contract's template (which renders "1 fields need attention"). A literal
  // oracle is what makes a silent re-wording, in either direction, red.
  describe("[153.2] submit-with-errors orchestration", () => {
    const VALID_DESCRIPTION = "A market-neutral basis strategy.";

    /** Render, let the category auto-select settle, and hand back the pieces. */
    async function renderSettled(onComplete = vi.fn()) {
      render(<MetadataStep {...baseProps} onComplete={onComplete} />);
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));
      return {
        onComplete,
        select,
        details: document.querySelector("form details") as HTMLDetailsElement,
        submit: screen.getByRole("button", { name: /review and submit/i }),
        description: screen.getByLabelText("Description") as HTMLTextAreaElement,
        aum: screen.getByLabelText("AUM (USD)") as HTMLInputElement,
      };
    }

    it("[FIELD_ORDER] the declared order IS the render order", async () => {
      // The pin behind "first invalid control in DOM order". The order is
      // declared as an explicit array in the component precisely so it is not a
      // silent coupling to an object literal's declaration order — but a
      // declared array can still fall out of step with the JSX. This row is what
      // reds when someone moves a field and does not move the array: it reads
      // the four controls out of the live DOM and asserts they arrive in the
      // order the component claims.
      //
      // ⚠️ 153.2-05 widened FIELD_ORDER from four members to six. The codename
      // joins the scan below (it is a `<select>` and always renders); the
      // capital question does NOT, because it renders only on the allocator
      // surface and its controls are `role="radio"` buttons rather than form
      // elements. Its slot ahead of the codename is asserted by the
      // server-refusal rows further down, which mount it and focus it.
      await renderSettled();
      const form = document.querySelector("form")!;
      const controls = [
        "Strategy codename",
        "Description",
        "Category",
        "AUM (USD)",
        "Max capacity (USD)",
      ].map((label) => screen.getByLabelText(label));

      const inDomOrder = Array.from(
        form.querySelectorAll("textarea, select, input"),
      ).filter((node) => controls.includes(node as HTMLElement));
      expect(inDomOrder).toEqual(controls);
    });

    it("⭐ OPENS the collapsed disclosure before focusing a control hidden inside it", async () => {
      // ⭐ THE row this task exists for. AUM and max capacity live inside the
      // collapsed "More details (optional)" disclosure. Focusing a control the
      // user cannot see moves the keyboard caret somewhere the screen does not
      // show — the page looks as if the click did nothing, which is a worse
      // failure than no focus at all because the next keystroke edits an
      // invisible field.
      //
      // ⚠️ WHICH ASSERTION BELOW ACTUALLY CATCHES THE REGRESSION, measured:
      // deleting the open-the-disclosure step reds `details.open`, NOT
      // `document.activeElement`. jsdom does not implement `<details>` content
      // hiding, so it will happily focus a control inside a shut disclosure —
      // in a real browser that focus call is the one that no-ops. The
      // activeElement line therefore proves the RIGHT control was chosen; the
      // `details.open` line is what proves the user can see it. Both are
      // required, and neither substitutes for the other.
      const { onComplete, details, submit, description, aum } =
        await renderSettled();

      fireEvent.change(description, { target: { value: VALID_DESCRIPTION } });
      fireEvent.change(aum, { target: { value: "-5" } });

      // The disclosure is shut, and the AUM control really is inside it.
      expect(details.open).toBe(false);
      expect(details.contains(aum)).toBe(true);

      fireEvent.click(submit);

      expect(details.open).toBe(true);
      expect(document.activeElement).toBe(aum);
      expect(onComplete).not.toHaveBeenCalled();
      // …and the summary names THAT field, not the description the user can see.
      expect(screen.getByTestId("metadata-submit-summary").textContent).toBe(
        "1 field needs attention. The first is AUM (USD).",
      );
    });

    it("states the COUNT and the FIRST label in DOM order, visibly", async () => {
      // Two problems, one of them below the fold. The sentence must count both
      // and name the one the cursor was sent to — naming the second would send
      // the user to the wrong field, which is the original incident in miniature.
      const { submit, description, aum } = await renderSettled();

      fireEvent.change(description, { target: { value: "ab" } });
      fireEvent.change(aum, { target: { value: "-5" } });
      fireEvent.click(submit);

      expect(screen.getByTestId("metadata-submit-summary").textContent).toBe(
        "2 fields need attention. The first is Description.",
      );
      expect(document.activeElement).toBe(description);
    });

    it("[FLAG-6 / Pattern G] the announcement RE-STATES the visible sentence", async () => {
      // `LiveRegion`'s contract is that it repeats copy the surface already
      // renders — it is never a place to author copy. An announcement that only
      // assistive technology receives is a sentence sighted users are denied and
      // that nobody proof-reads. Asserted as an EQUALITY between the two
      // channels, so the day they are fed by different expressions this reds.
      const { submit, description, aum } = await renderSettled();

      fireEvent.change(description, { target: { value: "ab" } });
      fireEvent.change(aum, { target: { value: "-5" } });
      fireEvent.click(submit);

      const visible = screen.getByTestId("metadata-submit-summary");
      const announced = screen.getByRole("alert");
      expect(announced.textContent).toBe(visible.textContent);
      expect(announced.className).toBe("sr-only");
      // ⛔ The VISIBLE copy is not itself an alert — it summarises messages the
      // fields are already showing; it is not a second alarm.
      expect(visible.getAttribute("role")).not.toBe("alert");
      expect(visible.closest('[role="alert"]')).toBeNull();
    });

    it("clears the summary and submits once every field is corrected", async () => {
      // The other half of a refusal: it has to end. A summary that survives the
      // fix is a form that keeps shouting at a user who has already complied.
      const { onComplete, submit, description, aum } = await renderSettled();

      fireEvent.change(description, { target: { value: "ab" } });
      fireEvent.change(aum, { target: { value: "-5" } });
      fireEvent.click(submit);
      expect(screen.getByTestId("metadata-submit-summary")).toBeInTheDocument();

      fireEvent.change(description, { target: { value: VALID_DESCRIPTION } });
      fireEvent.change(aum, { target: { value: "250000" } });
      await waitFor(() =>
        expect(screen.queryByTestId("metadata-submit-summary")).toBeNull(),
      );
      expect(screen.getByRole("alert").textContent).toBe("");

      fireEvent.click(submit);
      expect(onComplete).toHaveBeenCalledTimes(1);
      const draft = onComplete.mock.calls[0]![0] as MetadataDraft;
      expect(draft.aum).toBe("250000");
    });

    it("reveals EVERY field's message at once, not one per submit", async () => {
      // A form that surfaces one problem, is fixed, then surfaces the next has
      // made the user submit twice to learn something it knew the first time.
      const { submit, description, aum } = await renderSettled();

      fireEvent.change(description, { target: { value: "ab" } });
      fireEvent.change(aum, { target: { value: "-5" } });
      fireEvent.click(submit);

      await waitFor(() =>
        expect(description.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(aum.getAttribute("aria-invalid")).toBe("true");
    });

    it("renders NO terminal error envelope for a field problem", async () => {
      // UI-SPEC forbidden-list item 1. The envelope is what the founder read
      // three times while it named no field; a field-level problem must never
      // escalate to one. Asserted on the rendered DOM (the envelope always
      // renders its Diagnostics disclosure and its docs link).
      const { submit } = await renderSettled();
      fireEvent.click(submit);

      expect(screen.queryByText(/Diagnostics/i)).toBeNull();
      expect(
        document.querySelector('a[href="/security"]'),
      ).toBeNull();
    });
  });

  // ── #597 — asset-class picker: crypto-exchange detection LOCKS to 'crypto' ──
  describe("#597 asset-class picker", () => {
    /** A full MetadataDraft carrying the DB NOT NULL DEFAULT assetClass. */
    function draftWithAssetClass(assetClass: string): MetadataDraft {
      return {
        name: null,
        description: "A resumed draft description.",
        categoryId: "cat-aaa",
        strategyTypes: [],
        subtypes: [],
        markets: [],
        supportedExchanges: [],
        leverageRange: "",
        aum: "",
        maxCapacity: "",
        assetClass,
      };
    }

    it("locks the picker to 'crypto' (value + disabled) when a crypto exchange is detected", async () => {
      render(<MetadataStep {...baseProps} detectedExchange="binance" />);
      const select = (await screen.findByLabelText(
        /Asset class/i,
      )) as HTMLSelectElement;
      expect(select.value).toBe("crypto");
      expect(select).toBeDisabled();
    });

    // P2 regression guard: a RESUMED broker draft whose row carries the DB
    // default 'traditional' must STILL lock to 'crypto' — the detected-exchange
    // lock wins over the stale `initial` value. If someone reverts the state
    // initializer to `initial?.assetClass ?? ...` (letting the stale default
    // short-circuit detection), this reddens.
    it("locks to 'crypto' even when a resumed draft carries initial.assetClass='traditional'", async () => {
      render(
        <MetadataStep
          {...baseProps}
          detectedExchange="binance"
          initial={draftWithAssetClass("traditional")}
        />,
      );
      const select = (await screen.findByLabelText(
        /Asset class/i,
      )) as HTMLSelectElement;
      expect(select.value).toBe("crypto");
      expect(select).toBeDisabled();
    });

    it("stays editable at the resumed value on the CSV path (no detected exchange)", async () => {
      render(
        <MetadataStep
          {...baseProps}
          detectedExchange={null}
          initial={draftWithAssetClass("traditional")}
        />,
      );
      const select = (await screen.findByLabelText(
        /Asset class/i,
      )) as HTMLSelectElement;
      expect(select.value).toBe("traditional");
      expect(select).not.toBeDisabled();
    });
  });

  // ── Phase 150 / OWN-03 — the capital question + the render-only cull ──────
  //
  // Two changes land together in this step and must not contaminate each
  // other: (1) an allocator-only capital question mounted FIRST, and (2) the
  // seven "profile" controls receding behind a collapsed disclosure. The
  // second is a RENDER change only — the payload the step emits must stay
  // byte-compatible, because every downstream consumer (factsheet panels,
  // browse pills, mandate-fit chips) keys on field ABSENCE to hide itself.
  // Deleting a field would silently change what those surfaces show.
  describe("[OWN-03] capital question + More-details cull", () => {
    /**
     * The onComplete payload the step emitted BEFORE this phase, typed in as a
     * literal oracle rather than derived from the component. This is the whole
     * proof of "render-only cull": if a culled field is dropped from
     * MetadataDraft or from handleSubmit's onComplete({...}), this deep-equal
     * reddens. Values are the mount defaults for `baseProps` (initial=null,
     * detectedExchange=null) with only the description typed.
     */
    const DESCRIPTION = "A market-neutral basis strategy.";
    const PRE_CHANGE_PAYLOAD = {
      name: "Alpha Centauri", // STRATEGY_NAMES[0]
      description: DESCRIPTION,
      categoryId: "cat-aaa",
      strategyTypes: [],
      subtypes: [],
      markets: [],
      supportedExchanges: [],
      leverageRange: "",
      aum: "",
      maxCapacity: "",
      assetClass: "traditional",
    };

    /** Render, let the category auto-select settle, type a description, submit. */
    async function submitUntouched(
      extraProps: Partial<React.ComponentProps<typeof MetadataStep>> = {},
    ): Promise<MetadataDraft> {
      const onComplete = vi.fn();
      render(
        <MetadataStep {...baseProps} onComplete={onComplete} {...extraProps} />,
      );
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: DESCRIPTION },
      });

      const submit = screen.getByRole("button", { name: /review and submit/i });
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);

      expect(onComplete).toHaveBeenCalledTimes(1);
      return onComplete.mock.calls[0]![0] as MetadataDraft;
    }

    // ── The question: presence, ordering, default ──────────────────────────

    it("[D-01] renders the capital question as the FIRST interactive element in the form", async () => {
      // D-01: the question the product never asked leads the step. Ordering is
      // the whole point of the founder's direction — a question buried below
      // three fields is a question most allocators will not read. Asserted
      // structurally (DOM order), not by eyeballing JSX.
      render(<MetadataStep {...baseProps} showCapitalQuestion />);
      await screen.findByLabelText("Category");

      const form = document.querySelector("form")!;
      const interactive = form.querySelectorAll(
        "button, input, select, textarea",
      );
      expect(interactive[0]).toBe(
        screen.getByTestId("capital-ownership-own_capital"),
      );

      // …and the whole fieldset precedes the codename select.
      const fieldset = form.querySelector("fieldset")!;
      const codename = screen.getByLabelText("Strategy codename");
      expect(
        fieldset.compareDocumentPosition(codename) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("[D-01] preselects option (b) team_review on mount — never null", async () => {
      // The mark always has a value once the question renders. A null third
      // state would leak an "unanswered" strategy into the allocatable
      // predicate's input space; the default is the SAFE (non-allocatable) one.
      render(<MetadataStep {...baseProps} showCapitalQuestion />);
      await screen.findByLabelText("Category");

      expect(
        screen.getByTestId("capital-ownership-team_review"),
      ).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("[D-07] renders ZERO question DOM when showCapitalQuestion is absent", async () => {
      // D-07 is one form for all users with a RENDER condition, not two forms.
      // The manager path must not merely hide the question — it must not exist,
      // so no manager can submit a mark by poking at the DOM.
      render(<MetadataStep {...baseProps} />);
      await screen.findByLabelText("Category");

      expect(screen.queryByTestId("capital-ownership-own_capital")).toBeNull();
      expect(screen.queryByTestId("capital-ownership-team_review")).toBeNull();
      expect(document.querySelector("form")!.querySelector("fieldset")).toBeNull();
      expect(
        screen.queryByText(/Whose capital is in this key\?/i),
      ).toBeNull();
    });

    // ── The payload: the render-only-cull proof ───────────────────────────

    it("[D-08] an untouched manager submit is deep-equal to the pre-Phase-150 payload", async () => {
      // The cull moves controls; it must not remove data. If someone "tidies"
      // a collapsed field out of MetadataDraft, downstream factsheet panels
      // silently stop rendering for every future strategy — this is the guard.
      const draft = await submitUntouched();
      expect(draft).toEqual(PRE_CHANGE_PAYLOAD);
      expect("capitalOwnership" in draft).toBe(false);
    });

    it("[SC 2] an untouched allocator submit adds ONLY capitalOwnership=team_review", async () => {
      // Behaviour-compatibility with today: a user who never touches the new
      // question submits exactly what they would have before, plus the safe
      // default mark. Nothing else about the payload moves.
      const draft = await submitUntouched({ showCapitalQuestion: true });
      expect(draft).toEqual({
        ...PRE_CHANGE_PAYLOAD,
        capitalOwnership: "team_review",
      });
    });

    it("carries own_capital through to the payload once the allocator picks it", async () => {
      const onComplete = vi.fn();
      render(
        <MetadataStep {...baseProps} onComplete={onComplete} showCapitalQuestion />,
      );
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: DESCRIPTION },
      });
      fireEvent.click(screen.getByTestId("capital-ownership-own_capital"));

      const submit = screen.getByRole("button", { name: /review and submit/i });
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);

      const draft = onComplete.mock.calls[0]![0] as MetadataDraft;
      expect(draft.capitalOwnership).toBe("own_capital");
      // The rest of the payload is untouched by answering the question.
      const { capitalOwnership: _omit, ...rest } = draft;
      expect(rest).toEqual(PRE_CHANGE_PAYLOAD);
    });

    it("restores an already-answered mark when the step is re-entered from Review", async () => {
      // WizardClient keeps the completed draft in `metadataDraft` and feeds it
      // back as `initial` when the user returns from the Review recap. If the
      // question re-mounts at its default instead of the answered value, an
      // allocator who picked "my own capital", reviewed, then came back to fix
      // a typo would submit as team-review WITHOUT being told — their strategy
      // silently becomes non-allocatable. Every other field on this step
      // already round-trips through `initial`; the mark must too.
      const answered: MetadataDraft = {
        name: "Alpha Centauri",
        description: DESCRIPTION,
        categoryId: "cat-aaa",
        strategyTypes: [],
        subtypes: [],
        markets: [],
        supportedExchanges: [],
        leverageRange: "",
        aum: "",
        maxCapacity: "",
        assetClass: "traditional",
        capitalOwnership: "own_capital",
      };
      render(
        <MetadataStep {...baseProps} showCapitalQuestion initial={answered} />,
      );
      await screen.findByLabelText("Category");

      expect(screen.getByTestId("capital-ownership-own_capital")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(
        screen.getByTestId("capital-ownership-team_review"),
      ).toHaveAttribute("aria-checked", "false");
    });

    // ── The disclosure ────────────────────────────────────────────────────

    it("[D-06] collapses the culled controls behind a closed <details> by default", async () => {
      render(<MetadataStep {...baseProps} />);
      await screen.findByLabelText("Category");

      const details = document.querySelector("form details") as HTMLDetailsElement;
      expect(details).not.toBeNull();
      expect(details.open).toBe(false);
      expect(details.querySelector("summary")!.textContent).toContain(
        "More details (optional)",
      );
    });

    it("[D-06] keeps the six culled controls inside the disclosure — collapsed, never deleted", async () => {
      // Fields are collapsed, never deleted (D-06/D-08). Assert each culled
      // control is still in the document AND is a descendant of the disclosure.
      render(<MetadataStep {...baseProps} detectedExchange="binance" />);
      await screen.findByLabelText("Category");

      const details = document.querySelector("form details") as HTMLDetailsElement;
      for (const label of [
        "Strategy Types",
        "Subtypes",
        "Markets",
        "Supported exchanges",
      ]) {
        const node = screen.getByText(label);
        expect(details.contains(node)).toBe(true);
      }
      for (const label of ["Leverage range", "AUM (USD)", "Max capacity (USD)"]) {
        expect(details.contains(screen.getByLabelText(label))).toBe(true);
      }
    });

    it("[Pitfall 4] HOISTS the asset-class select OUT of the disclosure when it is editable", async () => {
      // Money-math guard: on the CSV / unknown-exchange path the select is
      // editable and defaults to `traditional` (√252). Hiding it behind a
      // collapsed disclosure makes √252-on-a-crypto-book the likely silent
      // outcome, which inflates Sharpe. Editable ⇒ visible.
      render(<MetadataStep {...baseProps} detectedExchange={null} />);
      const assetClass = await screen.findByLabelText(/Asset class/i);
      const details = document.querySelector("form details") as HTMLDetailsElement;

      expect(assetClass).not.toBeDisabled();
      expect(details.contains(assetClass)).toBe(false);
    });

    it("[Pitfall 4] keeps the asset-class select INSIDE the disclosure when it is locked", async () => {
      // On a detected crypto exchange the select is disabled and the server
      // force-derives the same value, so it is purely informational — it
      // belongs in the disclosure and carries no money-math risk there.
      render(<MetadataStep {...baseProps} detectedExchange="binance" />);
      const assetClass = await screen.findByLabelText(/Asset class/i);
      const details = document.querySelector("form details") as HTMLDetailsElement;

      expect(assetClass).toBeDisabled();
      expect(details.contains(assetClass)).toBe(true);
    });

    it("does NOT use CollapsibleSection or any persistence for the disclosure", async () => {
      // A wizard step is transient: remembering "open" across sessions (what
      // CollapsibleSection does via localStorage) is wrong here, and its
      // uppercase-mono Hide/Show voice is the factsheet document-section voice.
      const source = await import("node:fs").then((fs) =>
        fs.readFileSync(
          "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx",
          "utf8",
        ),
      );
      expect(source).not.toContain("CollapsibleSection");
      expect(source).not.toContain("storageKey");
      expect(source).not.toContain("useCrossTabStorage");
    });

    // ── Copy + the untouched submit gate ──────────────────────────────────

    it("uses the role-neutral revised step copy", async () => {
      // The old heading ("Tell allocators what this strategy is") is
      // manager-voiced and wrong for the allocator this step is being fixed
      // for. One role-neutral heading — role-gated form variants are deferred.
      render(<MetadataStep {...baseProps} showCapitalQuestion />);
      expect(
        await screen.findByRole("heading", { name: "Describe this strategy" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Codename, description, and category are all we need. Everything else is optional.",
        ),
      ).toBeInTheDocument();
    });

    it("does not make the capital question a submit precondition", async () => {
      // Answering the capital question must NOT become a new precondition —
      // and since it is preselected, it never could be. Guard against someone
      // widening the predicate.
      //
      // 153.2 / WIZFORM-01 — this row's original shape (disabled → enabled as
      // the description is typed) is gone with the `disabled` prop. The claim
      // it was really making survives intact and is asserted directly: with the
      // question rendered and NOT touched, a valid description alone submits.
      const onComplete = vi.fn();
      render(
        <MetadataStep {...baseProps} onComplete={onComplete} showCapitalQuestion />,
      );
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      const submit = screen.getByRole("button", { name: /review and submit/i });
      // Refused while the description is missing — the capital question is
      // answered (preselected), so this refusal can only be the description.
      fireEvent.click(submit);
      expect(onComplete).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: DESCRIPTION },
      });
      fireEvent.click(submit);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Phase 153.2 / MT5-14 — MT5 is declarable, and it is declared FOR the user.
 *
 * `MT5_UI_ENABLED` is a module-scope const read from `process.env` at import
 * time, so every flag-ON render stubs the env, resets the registry and
 * dynamic-imports the step fresh — the ConnectKeyStep MT5 harness, verbatim.
 * `vi.unstubAllEnvs` in afterEach stops a stub leaking into a sibling test
 * (the Node22-vs-Node25 stub-leak lesson).
 *
 * ⚠️ THE FLAG-OFF ROWS ARE NOT DECORATION. "No MT5 pixel when the flag is off"
 * is the contract's own acceptance line, and it is the half that a widening
 * shipped in the wrong place would break silently in production.
 */
describe("[MT5-14] the venue of the connected key is declarable, and pinned", () => {
  const DESCRIPTION = "A perfectly valid description of a strategy.";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadStep(flagOn: boolean) {
    vi.stubEnv(
      "NEXT_PUBLIC_MT5_ENABLED",
      flagOn ? "true" : (undefined as unknown as string),
    );
    vi.resetModules();
    const mod = await import("./MetadataStep");
    return mod.MetadataStep;
  }

  it("flag ON — an MT5 key pins MT5 as a span, with its provenance and its reason", async () => {
    const Fresh = await loadStep(true);
    render(<Fresh {...baseProps} detectedExchange="mt5" />);

    // The lowercase api_keys.exchange resolved to its display form and matched
    // its own item. Without the wizard-set canonicalizer this is the bug
    // ISSUE-004 recorded for OKX, one venue later: "mt5" matches nothing.
    const pinned = screen.getByText("MT5");
    expect(pinned.tagName).toBe("SPAN");
    expect(pinned.className).toContain("border-accent");
    expect(pinned.className).toContain("bg-accent/10");

    // ⛔ Not a control at all — so it cannot be a DEAD control.
    expect(screen.queryByRole("button", { name: "MT5" })).toBeNull();

    // Provenance: the mono eyebrow at the standard tracking (DESIGN.md).
    const eyebrow = screen.getByText("DETECTED FROM YOUR KEY");
    expect(eyebrow.className).toContain("font-mono");
    expect(eyebrow.className).toContain("tracking-[0.18em]");
    expect(eyebrow.className).toContain("text-micro");

    // And the reason, with the venue INTERPOLATED (FLAG-2) — asserted as the
    // composed sentence so a hardcoded "MetaTrader 5" would red here.
    expect(
      screen.getByText(
        "MT5 is included because it is the venue of the key you connected.",
      ),
    ).toBeInTheDocument();

    // The public venues are still offered, and still choices.
    expect(screen.getByRole("button", { name: "Binance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deribit" })).toBeInTheDocument();
  });

  it("flag ON — a crypto key pins ITS OWN venue; the rule is not about MT5", async () => {
    // The instance-not-class guard, asserted rather than asserted-about. If the
    // pin were written `venue === "mt5"` this row reds while every MT5 row above
    // stays green — which is precisely how that defect class ships.
    const Fresh = await loadStep(true);
    render(<Fresh {...baseProps} detectedExchange="bybit" />);
    const pinned = screen.getByText("Bybit");
    expect(pinned.tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: "Bybit" })).toBeNull();
    expect(
      screen.getByText(
        "Bybit is included because it is the venue of the key you connected.",
      ),
    ).toBeInTheDocument();
    // MT5 is offered (flag on) but NOT pinned — it is somebody else's fact.
    expect(screen.getByRole("button", { name: "MT5" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("flag ON — the submitted payload CONTAINS the detected venue even when the resumed draft omits it", async () => {
    // The door the pinned element cannot close: `initial` arrives from a server
    // row that was written before the pin existed, or was normalized by a caller
    // that knows only the public list. A strategy must never declare a venue set
    // that excludes its own key's venue.
    const Fresh = await loadStep(true);
    const onComplete = vi.fn();
    const initial = {
      name: null,
      description: DESCRIPTION,
      categoryId: "cat-aaa",
      strategyTypes: [],
      subtypes: [],
      markets: [],
      supportedExchanges: [] as string[],
      leverageRange: "",
      aum: "",
      maxCapacity: "",
      assetClass: "traditional",
    } satisfies MetadataDraft;

    render(
      <Fresh
        {...baseProps}
        initial={initial}
        detectedExchange="mt5"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const draft = onComplete.mock.calls[0][0] as MetadataDraft;
    expect(draft.supportedExchanges).toContain("MT5");
  });

  it("flag ON — a lowercase venue already in the draft is canonicalized, not duplicated", async () => {
    // `WizardClient` normalizes a resumed draft with the PUBLIC canonicalizer,
    // which does not know a wizard-only venue and hands back "mt5" unchanged.
    // Appending the display form on top of it would persist the exact
    // ['bybit', 'Bybit'] display bug ISSUE-004 records.
    const Fresh = await loadStep(true);
    const onComplete = vi.fn();
    const initial = {
      name: null,
      description: DESCRIPTION,
      categoryId: "cat-aaa",
      strategyTypes: [],
      subtypes: [],
      markets: [],
      supportedExchanges: ["mt5"],
      leverageRange: "",
      aum: "",
      maxCapacity: "",
      assetClass: "traditional",
    } satisfies MetadataDraft;

    render(
      <Fresh
        {...baseProps}
        initial={initial}
        detectedExchange="mt5"
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

    const draft = onComplete.mock.calls[0][0] as MetadataDraft;
    expect(draft.supportedExchanges).toEqual(["MT5"]);
  });

  it("flag OFF — an MT5 key renders NO MT5 pixel: no item, no eyebrow, no caption", async () => {
    const Fresh = await loadStep(false);
    render(<Fresh {...baseProps} detectedExchange="mt5" />);

    // Nothing renders the venue at all — not as a control, not as a span.
    expect(screen.queryByText("MT5")).toBeNull();
    expect(screen.queryByRole("button", { name: "MT5" })).toBeNull();
    expect(screen.queryByText("DETECTED FROM YOUR KEY")).toBeNull();
    expect(
      screen.queryByText(/is included because it is the venue of the key/i),
    ).toBeNull();
    // The public four are byte-identical to today, all still choices.
    for (const venue of ["Binance", "OKX", "Bybit", "Deribit"]) {
      expect(screen.getByRole("button", { name: venue })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("flag OFF — the lowercase wire form still rides through to the payload, exactly as today", async () => {
    // The pre-153.2 behaviour, pinned so the flag-OFF path is proven UNCHANGED
    // rather than merely proven quiet: "mt5" was seeded into state, rendered
    // nowhere, and POSTed verbatim.
    const Fresh = await loadStep(false);
    const onComplete = vi.fn();
    render(
      <Fresh {...baseProps} detectedExchange="mt5" onComplete={onComplete} />,
    );
    const select = (await screen.findByLabelText(
      "Category",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: DESCRIPTION },
    });
    fireEvent.click(screen.getByRole("button", { name: /review and submit/i }));

    const draft = onComplete.mock.calls[0][0] as MetadataDraft;
    expect(draft.supportedExchanges).toEqual(["mt5"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 153.2-05 / WIZFORM-01 — a refusal that arrived from the SERVER lands at the
// field, in a form that still holds everything the user typed.
//
// `SubmitStep` resolves a `METADATA_*` code to one field id and `WizardClient`
// carries it here. What this block pins is the arrival: the field is revealed,
// its disclosure opened if it is hiding inside one, the caret put in it, and the
// message is the LOCAL copy table's sentence — never the server's own string.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153.2-05] a server-side refusal, delivered to its field", () => {
  const FILLED: MetadataDraft = {
    // ⚠️ A REAL member of STRATEGY_NAMES. The codename control is a `<select>`
    // over that list, so a value outside it renders as the first option and the
    // Gate D assertion below would be measuring the fallback rather than the
    // draft. (Behaviour inherited from the primitive this field replaced —
    // unchanged, and out of this plan's scope.)
    name: "Black Swan",
    description: "A market-neutral basis strategy with a documented edge.",
    categoryId: "cat-bbb",
    strategyTypes: ["Directional"],
    subtypes: [],
    markets: ["BTC"],
    supportedExchanges: ["Binance"],
    leverageRange: "1x-3x",
    aum: "2500000",
    maxCapacity: "9000000",
    assetClass: "crypto",
  };

  function errorNodeFor(control: Element): HTMLElement | null {
    const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/);
    const errorId = ids.find((id) => id.endsWith("-error"));
    return errorId ? document.getElementById(errorId) : null;
  }

  async function mountWithRefusal(
    serverFieldError: { field: string; code: string },
    extra: Record<string, unknown> = {},
  ) {
    render(
      <MetadataStep
        {...baseProps}
        initial={FILLED}
        {...extra}
        serverFieldError={
          serverFieldError as unknown as {
            field: "aum";
            code: "METADATA_AUM_INVALID";
          }
        }
      />,
    );
    const select = (await screen.findByLabelText(
      "Category",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-bbb"));
    return {
      details: document.querySelector("form details") as HTMLDetailsElement,
      select,
    };
  }

  it("⭐ OPENS the collapsed disclosure, focuses the control and flags it — for a field hidden inside it", async () => {
    // ⭐ THE row this plan exists for, on the hardest field: AUM lives inside
    // the collapsed "More details (optional)" disclosure, so a naive
    // implementation focuses a control the user cannot see and the page looks
    // as if nothing happened.
    //
    // ⚠️ WHICH ASSERTION CATCHES THE REGRESSION, measured in 153.2-02 and
    // re-confirmed here: deleting the open-the-disclosure step reds
    // `details.open`, NOT `document.activeElement`. jsdom does not implement
    // `<details>` content hiding, so it will happily focus a control inside a
    // shut disclosure — in a real browser it is the focus call that no-ops.
    // Both assertions are required and neither substitutes for the other.
    const { details } = await mountWithRefusal({
      field: "aum",
      code: "METADATA_AUM_INVALID",
    });
    const aum = screen.getByLabelText("AUM (USD)") as HTMLInputElement;

    expect(details.contains(aum)).toBe(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(aum);
    expect(aum.getAttribute("aria-invalid")).toBe("true");
    // The sentence is the COPY TABLE's, imported — the component must not
    // invent one, and the server's `error` string never reaches this surface.
    expect(errorNodeFor(aum)?.textContent).toBe(
      formatKeyError("METADATA_AUM_INVALID").title,
    );
  });

  it("[Gate D] the form still holds everything the user typed", async () => {
    // A form that loses its contents on a validation failure is a WORSE outcome
    // than the envelope this replaces. Every prefilled value survives the trip
    // back — including the one the server complained about, so the user can see
    // what they submitted rather than guess at it.
    await mountWithRefusal({ field: "aum", code: "METADATA_AUM_INVALID" });

    expect(
      (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    ).toBe(FILLED.description);
    expect((screen.getByLabelText("AUM (USD)") as HTMLInputElement).value).toBe(
      "2500000",
    );
    expect(
      (screen.getByLabelText("Max capacity (USD)") as HTMLInputElement).value,
    ).toBe("9000000");
    expect(
      (screen.getByLabelText("Strategy codename") as HTMLSelectElement).value,
    ).toBe("Black Swan");
    expect(
      (screen.getByLabelText("Category") as HTMLSelectElement).value,
    ).toBe("cat-bbb");
  });

  it("editing the field clears the message — with no second submit", async () => {
    // ⛔ A message the user cannot clear by acting on it is a dead end. The
    // client mirror takes over the instant they edit, and `validatePayload`
    // re-judges the new value on the next submit if it still disagrees.
    await mountWithRefusal({ field: "aum", code: "METADATA_AUM_INVALID" });
    const aum = screen.getByLabelText("AUM (USD)") as HTMLInputElement;
    expect(aum.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(aum, { target: { value: "3000000" } });

    expect(aum.getAttribute("aria-invalid")).not.toBe("true");
    expect(errorNodeFor(aum)).toBeNull();
  });

  it("…but an edit that is invalid on the CLIENT's OWN rule keeps a message", async () => {
    // The control on the previous row: "clears on edit" must not become "goes
    // quiet on edit". The server's verdict is retired; the client's replaces it
    // when the new value breaks the mirror, so the field never silently accepts
    // something the next submit will refuse again.
    await mountWithRefusal({ field: "aum", code: "METADATA_AUM_INVALID" });
    const aum = screen.getByLabelText("AUM (USD)") as HTMLInputElement;

    fireEvent.change(aum, { target: { value: "-5" } });

    expect(aum.getAttribute("aria-invalid")).toBe("true");
    expect(errorNodeFor(aum)?.textContent).toBe(
      formatKeyError("METADATA_AUM_INVALID").title,
    );
  });

  it("a field with NO client mirror still receives its refusal — the codename", async () => {
    // `METADATA_NAME_INVALID` is unreachable from this form's own `<select>`,
    // which is exactly why it needed a field: it fires only when client and
    // server disagree about the list, and before this it rendered as a
    // full-page envelope naming no field at all.
    await mountWithRefusal({
      field: "name",
      code: "METADATA_NAME_INVALID",
    });
    const codename = screen.getByLabelText(
      "Strategy codename",
    ) as HTMLSelectElement;

    expect(document.activeElement).toBe(codename);
    expect(codename.getAttribute("aria-invalid")).toBe("true");
    expect(errorNodeFor(codename)?.textContent).toBe(
      formatKeyError("METADATA_NAME_INVALID").title,
    );
  });

  it("a radio GROUP is focused at its first radio, not at its wrapper", async () => {
    // The capital question has no single element that is both the field and a
    // focus target. The resolution is stated as a general rule (a container
    // resolves to its first focusable descendant), so a later composite control
    // needs no second branch — and a `<div>.focus()` would have been a silent
    // no-op that every jsdom assertion about `aria-invalid` still passed.
    await mountWithRefusal(
      {
        field: "capitalOwnership",
        code: "METADATA_CAPITAL_OWNERSHIP_INVALID",
      },
      { showCapitalQuestion: true },
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("capital-ownership-own_capital"),
    );
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(
        formatKeyError("METADATA_CAPITAL_OWNERSHIP_INVALID").title,
      ),
    ).toBeInTheDocument();
  });

  it("⛔ NO terminal error panel renders on this step for a server refusal", async () => {
    // UI-SPEC §What this contract FORBIDS, item 1. The whole point of the
    // routing is that the page-level panel — the thing the founder read three
    // times while it named no field — does not appear for a field problem.
    // Asserted on the rendered DOM rather than by a source grep, because the
    // grep can be satisfied by prose.
    await mountWithRefusal({ field: "aum", code: "METADATA_AUM_INVALID" });

    const copy = WIZARD_ERROR_COPY.METADATA_AUM_INVALID;
    // The envelope renders the entry's `cause` paragraph and its `fix[]`
    // bullets; the field renders the one-sentence `title` and nothing else.
    expect(screen.queryByText(copy.cause!)).not.toBeInTheDocument();
    for (const bullet of copy.fix) {
      expect(screen.queryByText(bullet)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/correlation id/i)).not.toBeInTheDocument();
  });

  it("CONTROL — no serverFieldError means nothing is flagged and nothing is focused", async () => {
    // The negative control the rows above need: every assertion here would also
    // pass on a component that flagged a field for no reason at all.
    render(<MetadataStep {...baseProps} initial={FILLED} />);
    const select = (await screen.findByLabelText(
      "Category",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-bbb"));

    const aum = screen.getByLabelText("AUM (USD)") as HTMLInputElement;
    expect(aum.getAttribute("aria-invalid")).not.toBe("true");
    expect(document.activeElement).not.toBe(aum);
    expect(
      (document.querySelector("form details") as HTMLDetailsElement).open,
    ).toBe(false);
  });
});
