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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetadataStep, type MetadataDraft } from "./MetadataStep";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

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
    // An empty-but-readable category list leaves categoryId=null and Submit
    // permanently disabled. On the CSV path there is no detected-markets hint
    // to explain the block, so the step must surface an honest reason rather
    // than a silent dead-end (ISSUE-010 must never reopen via category_id=null).
    orderResult = { data: [], error: null };
    render(<MetadataStep {...baseProps} />);
    // Wait for the fetch to settle (categoriesLoaded gates the hint).
    expect(
      await screen.findByTestId("metadata-categories-empty"),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).toBeDisabled();
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

  it("pre-selects the canonical exchange chip from detectedExchange (lowercase → canonical)", () => {
    // detectedExchange is the lowercase api_keys.exchange ('okx'); the chip
    // group matches case-sensitively against EXCHANGES ('OKX'). The default
    // must canonicalize so the chip renders pre-selected (aria-pressed).
    render(<MetadataStep {...baseProps} detectedExchange="okx" />);
    const chip = screen.getByRole("button", { name: "OKX" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("disables Submit until both description and categoryId are present", async () => {
    // Start with no categories so auto-select cannot fill categoryId, and an
    // empty description: the gate must keep Submit disabled.
    orderResult = { data: [], error: null };
    render(<MetadataStep {...baseProps} detectedMarkets={["BTC"]} />);
    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).toBeDisabled();
  });

  it("[WR-03] keeps Submit disabled for a whitespace-only description (gate matches .trim() rule)", async () => {
    // A whitespace-only description ("   ") is truthy but invalid. The
    // disabled-gate must use the SAME .trim() predicate as the validation
    // rule, so it stays disabled — otherwise the user reaches an "enabled"
    // button that handleSubmit then silently no-ops on (the inconsistency
    // that breeds regressions).
    render(<MetadataStep {...baseProps} />);
    const select = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-aaa"));

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "   " },
    });

    const submit = screen.getByRole("button", { name: /review and submit/i });
    expect(submit).toBeDisabled();
  });

  // ── Phase 53 / APPLY-02 — inline per-field validation surfacing ──────────
  it("[APPLY-02] blur on an empty description surfaces the wizardErrors copy through Field a11y", async () => {
    render(<MetadataStep {...baseProps} />);
    const description = (await screen.findByLabelText(
      "Description",
    )) as HTMLTextAreaElement;

    // No error before interaction.
    expect(description.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.blur(description);

    // Field wires aria-invalid + aria-describedby pointing at the message id.
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    const describedBy = description.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    // The described element exists and carries the EXISTING wizardErrors copy
    // (not a new inline string) — message id matches aria-describedby.
    const messageNode = document.getElementById(describedBy!);
    expect(messageNode).not.toBeNull();
    expect(messageNode!.textContent).toBe(
      WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause,
    );
  });

  it("[APPLY-02] the per-field description message is NOT role=alert (envelope owns the summary)", async () => {
    render(<MetadataStep {...baseProps} />);
    const description = await screen.findByLabelText("Description");
    fireEvent.blur(description);

    const message = await screen.findByText(
      WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause,
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
      WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause,
    );

    fireEvent.change(description, { target: { value: "A real description." } });
    await waitFor(() =>
      expect(
        screen.queryByText(
          WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause,
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

    it("leaves the submit gate unchanged when the question renders", async () => {
      // The gate stays exactly `!description.trim() || !categoryId`. Answering
      // the capital question must NOT become a new precondition (wizard
      // validation UX belongs to Phase 153) — and since it is preselected,
      // it never could be. Guard against someone widening the gate.
      render(<MetadataStep {...baseProps} showCapitalQuestion />);
      const select = (await screen.findByLabelText(
        "Category",
      )) as HTMLSelectElement;
      await waitFor(() => expect(select.value).toBe("cat-aaa"));

      const submit = screen.getByRole("button", { name: /review and submit/i });
      expect(submit).toBeDisabled(); // no description yet

      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: DESCRIPTION },
      });
      await waitFor(() => expect(submit).not.toBeDisabled());
    });
  });
});
