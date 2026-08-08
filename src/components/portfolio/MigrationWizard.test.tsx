/**
 * <MigrationWizardButton> — "Claim Legacy Allocation".
 *
 * 151 review A4 — this component had ZERO test coverage while carrying a money
 * write (`portfolio_strategies.upsert`) that Phase 150's D-03-A trigger made
 * REFUSABLE. It is one of the three sanctioned position writers pinned by
 * `src/__tests__/phase-150-capital-ownership-invariant.test.ts` (P2), and the
 * only one of the three that had no behavioural spec at all: the structural gate
 * can see that the write EXISTS, never what the user is told when it is refused.
 *
 * What is pinned here is the three-armed error branch, because that is where a
 * regression is both silent and user-visible:
 *
 *   ARM 1 — 23514 whose message carries `capital_ownership=team_review`. Fires
 *           for ANYONE, owner or third-party allocator. The owner-voiced remedy
 *           is actively wrong for a third party (they cannot see that row in My
 *           Strategies and no route lets them mark it), so its ABSENCE is
 *           asserted as a first-class fact, not as the complement of the
 *           positive assertion.
 *   ARM 2 — 23514 without that needle: a self-owned strategy that was never
 *           marked (every pre-150 row is NULL). Here the remedy is real and
 *           reachable, so the copy names it.
 *   ARM 3 — any other code (42501 RLS, 23503 FK, a future trigger `RAISE`).
 *           151 review E3 moved this oracle: it used to PIN the leak (assert
 *           `psError.message` reached the DOM verbatim); it now asserts the
 *           fixed sentence and that no fragment of the driver's text survives.
 *           The `allocation_events` insert carried the identical leak and is
 *           covered in the same block, with its own copy — the position row is
 *           already saved when it fires, so the two states must not share a
 *           sentence.
 *
 * On both 23514 arms the raw PL/pgSQL text and the internal strategy UUID it
 * embeds must never reach the DOM: the message is the SIGNAL the branch reads,
 * not copy.
 *
 * ORACLE INDEPENDENCE — every copy string is typed here as a literal and is
 * never imported from the component or from `@/lib/capital-ownership`.
 * Importing the string under test would make the assertion agree with whatever
 * the code happens to say (this file's sibling, AddToPortfolio.test.tsx, follows
 * the same rule).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockUpsert, mockEventInsert, mockDocInsert, mockLimit, mockGetUser } =
  vi.hoisted(() => ({
    mockUpsert: vi.fn(),
    mockEventInsert: vi.fn(),
    mockDocInsert: vi.fn(),
    mockLimit: vi.fn(),
    mockGetUser: vi.fn(),
  }));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// Table-aware supabase client mock. The strategy search chain is
// `.from("strategies").select().ilike()` → `withPublishedOnly` appends `.eq()`
// → `.limit(10)`; the real `withPublishedOnly` runs (it is a pure helper), so
// the mock must expose `.eq()` returning the same builder or the search step
// throws rather than filtering.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === "portfolio_strategies") return { upsert: mockUpsert };
      if (table === "allocation_events") return { insert: mockEventInsert };
      if (table === "relationship_documents") return { insert: mockDocInsert };
      // strategies — the published-only search chain
      const builder = {
        select: () => builder,
        ilike: () => builder,
        eq: () => builder,
        limit: mockLimit,
      };
      return builder;
    },
  }),
}));

import { MigrationWizardButton } from "./MigrationWizard";

// jsdom ships no <dialog> implementation; the shared <Modal> drives
// showModal()/close() imperatively. Same polyfill as
// strategy/RenameStrategyDialog.test.tsx.
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

// --- Fixtures ---------------------------------------------------------------

const PORTFOLIO_ID = "44444444-4444-4444-8444-444444444444";
const STRATEGY_ID = "55555555-5555-4555-8555-555555555555";
const STRATEGY_NAME = "Legacy Helios";
const AMOUNT = "25000";

/**
 * The REAL Postgres message the D-03-A trigger raises, formatted by
 * supabase/migrations/20260806120000_strategies_capital_ownership.sql:
 *   'strategy % cannot become a position: capital_ownership=% (required: own_capital)'
 * with `%` fed `NEW.strategy_id` and `COALESCE(v_mark, 'unmarked')`.
 *
 * A fixture that omitted the message would make the component's
 * `.includes(...)` needle `undefined` and route BOTH 23514 cases into the
 * owner-voiced fallback — i.e. the two arms would be indistinguishable and the
 * spec vacuous. That the SQL still emits `capital_ownership=%` is pinned
 * structurally by src/__tests__/phase-150-capital-ownership-invariant.test.ts.
 */
const RAW_UUID_IN_MESSAGE = "99999999-9999-4999-8999-999999999999";
function pgCheckViolationMessage(mark: string): string {
  return `strategy ${RAW_UUID_IN_MESSAGE} cannot become a position: capital_ownership=${mark} (required: own_capital)`;
}

// --- Literal oracles --------------------------------------------------------

const TRIGGER = "Claim Legacy Allocation";
const SEARCH_LABEL = "Search strategies";
const AMOUNT_LABEL = "Amount ($)";
const NEXT = "Next";
// 151 review I3 — the team arm now carries the remedy ATTRIBUTED to the owner.
// See the mapper's own note: the arm fires for the owner too, and the error
// object cannot tell owner from third party, so one sentence has to serve both.
const COPY_TEAM_REVIEW =
  "This strategy is marked as a trading team's capital under review, so it can't be added to a portfolio. Its owner can change that mark in My Strategies.";
const COPY_OWNER_REMEDY =
  "This strategy isn't marked as your own capital — mark it in My Strategies first.";
// 151 review E3 — the two fixed sentences that replaced the raw PostgREST
// `message`. Typed as literals here (never imported) per the oracle-independence
// note above: importing them would make the assertion agree with any edit,
// including one that put the driver text back.
//
// 151 review I1/I2 — REWORDED, and the reason is the point. supabase-js reports
// a lost response as a `PostgrestError` (`code: ''`) rather than throwing, so
// the branch below cannot distinguish "the server refused" from "it committed
// and the answer never came back". The first cut therefore (I1) asserted a
// database state it could not establish — "nothing was changed" — and (I2)
// instructed a resubmit into `allocation_events`, a table with NO uniqueness
// constraint (20260407075303_portfolio_intelligence.sql:11-21), which turns one
// allocation into two deposits on exactly the lost-response case. The
// properties those two defects violate are asserted in their own block below,
// separately from these strings, so a reword that restores either defect
// reddens on the property and not merely on a byte-compare.
const COPY_GENERIC_WRITE_FAILED =
  "We couldn't confirm whether this claim saved. Reload this page and check your allocations before you try it again.";
const COPY_DEPOSIT_NOT_RECORDED =
  "The allocation was saved, but we couldn't confirm its deposit record. Reload this page and check this allocation's history — recording the deposit a second time would double it.";

beforeEach(() => {
  mockUpsert.mockReset();
  mockEventInsert.mockReset();
  mockDocInsert.mockReset();
  mockLimit.mockReset();
  mockGetUser.mockReset();
  mockRefresh.mockReset();
  mockLimit.mockResolvedValue({
    data: [{ id: STRATEGY_ID, name: STRATEGY_NAME }],
    error: null,
  });
  mockUpsert.mockResolvedValue({ error: null });
  mockEventInsert.mockResolvedValue({ error: null });
  mockDocInsert.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
});

/**
 * Drive the wizard to the point of submission: open → search → pick → amount →
 * notes → Claim. The search step is debounced 250ms, so the result button is
 * awaited rather than queried.
 */
async function submitClaim() {
  render(<MigrationWizardButton portfolioId={PORTFOLIO_ID} />);
  fireEvent.click(screen.getByRole("button", { name: TRIGGER }));

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
    target: { value: "Legacy" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: STRATEGY_NAME }, { timeout: 3000 }),
  );

  fireEvent.click(screen.getByRole("button", { name: NEXT }));
  fireEvent.change(screen.getByLabelText(AMOUNT_LABEL), {
    target: { value: AMOUNT },
  });
  fireEvent.click(screen.getByRole("button", { name: NEXT }));
  fireEvent.click(screen.getByRole("button", { name: "Claim Allocation" }));

  await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
}

describe("<MigrationWizardButton> — the happy path reaches the position write", () => {
  it("upserts the position with the typed amount, then records the deposit event", async () => {
    // Non-vacuity for every error case below: without this, a wizard that never
    // reached `handleSubmit` at all would satisfy each "no leak" assertion.
    await submitClaim();

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        allocated_amount: 25000,
        relationship_status: "connected",
      }),
    );
    await waitFor(() => expect(mockEventInsert).toHaveBeenCalledTimes(1));
    expect(mockEventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        event_type: "deposit",
        amount: 25000,
      }),
    );
    expect(screen.queryByText(COPY_TEAM_REVIEW)).toBeNull();
    expect(screen.queryByText(COPY_OWNER_REMEDY)).toBeNull();
  });
});

describe("<MigrationWizardButton> — the 23514 branch speaks to the reader who is actually there", () => {
  it("ARM 1 — a `team_review` refusal uses the TEAM copy and never tells a third party to go mark a row that isn't theirs", async () => {
    mockUpsert.mockResolvedValue({
      error: { code: "23514", message: pgCheckViolationMessage("team_review") },
    });

    await submitClaim();

    expect(await screen.findByText(COPY_TEAM_REVIEW)).toBeInTheDocument();
    // Load-bearing, not the complement: this arm fires for allocators who do
    // NOT own the strategy, and the remedy sentence asserts the row is theirs.
    expect(screen.queryByText(COPY_OWNER_REMEDY)).toBeNull();
    // The refusal must stop the flow — no deposit event for a position that
    // was never created.
    expect(mockEventInsert).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    // Raw PL/pgSQL text carries an internal strategy UUID. It is the signal the
    // branch reads, never something the reader sees.
    expect(document.body.textContent).not.toContain(RAW_UUID_IN_MESSAGE);
    expect(document.body.textContent).not.toContain("capital_ownership=");
  });

  it("ARM 2 — an unmarked self-owned refusal names the remedy the reader can actually reach", async () => {
    mockUpsert.mockResolvedValue({
      error: { code: "23514", message: pgCheckViolationMessage("unmarked") },
    });

    await submitClaim();

    expect(await screen.findByText(COPY_OWNER_REMEDY)).toBeInTheDocument();
    expect(screen.queryByText(COPY_TEAM_REVIEW)).toBeNull();
    expect(mockEventInsert).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(RAW_UUID_IN_MESSAGE);
    expect(document.body.textContent).not.toContain("capital_ownership=");
  });
});

describe("<MigrationWizardButton> — the non-23514 arm speaks English, not Postgres", () => {
  /**
   * 151 review E3 — THE ORACLE MOVED, AND THAT IS THE FIX.
   *
   * This case previously PINNED the leak: it asserted that `psError.message`
   * reached the DOM verbatim, so a 42501 RLS refusal, a 23503 foreign-key
   * violation, or any future trigger `RAISE` on `portfolio_strategies` showed
   * the allocator an internal table / policy / constraint name. That is the
   * same defect class as the PROD sync_error that put a raw Python
   * AttributeError in front of three founder accounts.
   *
   * The assertion is written as a PROPERTY over several unrelated driver
   * messages, not as one string comparison: what must hold is that NO fragment
   * of the driver's text reaches the reader, on any code the branch does not
   * decode.
   */
  const RAW_DRIVER_CASES: Array<{ code: string; message: string; needles: string[] }> = [
    {
      code: "42501",
      message: "permission denied for table portfolio_strategies",
      needles: ["permission denied", "portfolio_strategies"],
    },
    {
      code: "23503",
      message:
        'insert or update on table "portfolio_strategies" violates foreign key constraint "portfolio_strategies_portfolio_id_fkey"',
      needles: ["foreign key", "fkey", "violates"],
    },
    {
      code: "P0001",
      message: `strategy ${RAW_UUID_IN_MESSAGE} is locked by pending_review_guard`,
      needles: [RAW_UUID_IN_MESSAGE, "pending_review_guard"],
    },
  ];

  for (const { code, message, needles } of RAW_DRIVER_CASES) {
    it(`a ${code} refusal renders fixed copy — no driver text, no identifier`, async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockUpsert.mockResolvedValue({ error: { code, message } });

      await submitClaim();

      expect(await screen.findByText(COPY_GENERIC_WRITE_FAILED)).toBeInTheDocument();
      for (const needle of needles) {
        expect(document.body.textContent).not.toContain(needle);
      }
      // The 23514 mapping must not widen into "any error is a mark problem".
      expect(screen.queryByText(COPY_TEAM_REVIEW)).toBeNull();
      expect(screen.queryByText(COPY_OWNER_REMEDY)).toBeNull();
      expect(mockEventInsert).not.toHaveBeenCalled();
      // The diagnosis is not destroyed — it moves to the console, which is
      // where an engineer reads it and where no allocator ever looks.
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), message);
      consoleSpy.mockRestore();
    });
  }

  it("the allocation_events failure names the PARTIAL state instead of the driver's text", async () => {
    // The position row IS written by the time this fires, so the copy must not
    // claim nothing changed — and it still must not carry PostgREST's message.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEventInsert.mockResolvedValue({
      error: { code: "42501", message: "permission denied for table allocation_events" },
    });

    await submitClaim();

    expect(await screen.findByText(COPY_DEPOSIT_NOT_RECORDED)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("permission denied");
    expect(document.body.textContent).not.toContain("allocation_events");
    expect(screen.queryByText(COPY_GENERIC_WRITE_FAILED)).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.any(String),
      "permission denied for table allocation_events",
    );
    consoleSpy.mockRestore();
  });
});

describe("<MigrationWizardButton> — 151 review I1/I2: the copy may not outrun what the code knows", () => {
  /**
   * THE SHARED CAUSE. supabase-js does not throw on a transport failure — it
   * returns a `PostgrestError` with an empty `code`. So a write that COMMITTED
   * and whose response was lost lands in the same `if (error)` branch as one the
   * server refused, and the two are indistinguishable from inside the handler.
   *
   * That makes two things illegal in this copy, and each has its own case
   * below because each fails for a different reason:
   *
   *   I1 — a CLAIM about database state. "nothing was changed" is false in the
   *        lost-response case, where a `portfolio_strategies` row exists.
   *   I2 — an INSTRUCTION that corrupts on the same case. The position write is
   *        an `.upsert` and re-running it is harmless; the deposit is an
   *        `.insert` into `allocation_events`, which has no uniqueness
   *        constraint (20260407075303_portfolio_intelligence.sql:11-21 — the
   *        only key is `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, and no
   *        later migration adds one). "submit again to record it" therefore
   *        writes a SECOND deposit against one allocation, silently doubling an
   *        append-only ledger the user has no way to see is doubled.
   *
   * These are asserted as properties over the rendered text rather than as
   * byte-compares — the sentences are already pinned above; what is pinned HERE
   * is that no reword may reintroduce the state claim or the resubmit
   * instruction.
   */
  const LOST_RESPONSE = { code: "", message: "TypeError: Failed to fetch" };

  it("[I1] the position-write failure states what is KNOWN, never that nothing changed", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The exact shape of a lost response: an empty code, so it takes the
    // non-23514 arm — and the upsert may already have committed.
    mockUpsert.mockResolvedValue({ error: LOST_RESPONSE });

    await submitClaim();

    const shown = await screen.findByText(COPY_GENERIC_WRITE_FAILED);
    const text = shown.textContent ?? "";
    // No assertion about the database's state — only about our knowledge of it.
    expect(text).not.toMatch(/nothing was changed/i);
    expect(text).not.toMatch(/nothing (was|has been) (saved|written|recorded)/i);
    expect(text).toMatch(/couldn't confirm/i);
    // And the remedy has to be safe whichever way the write actually went:
    // look before retrying.
    expect(text).toMatch(/check/i);
    consoleSpy.mockRestore();
  });

  it("[I2] the deposit failure warns about the duplicate instead of asking for one", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEventInsert.mockResolvedValue({ error: LOST_RESPONSE });

    await submitClaim();

    const shown = await screen.findByText(COPY_DEPOSIT_NOT_RECORDED);
    const text = shown.textContent ?? "";
    // The instruction that doubles the ledger, in the forms it could take.
    expect(text).not.toMatch(/submit again/i);
    expect(text).not.toMatch(/try again/i);
    expect(text).not.toMatch(/(submit|record) (it|the deposit) again to/i);
    // What it must do instead: send the reader to the record, and name the
    // consequence of a blind resubmit.
    expect(text).toMatch(/history/i);
    expect(text).toMatch(/double/i);
    // Non-vacuity: the position write really did succeed first, which is why
    // this arm may still say the allocation was saved.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/allocation was saved/i);
    consoleSpy.mockRestore();
  });

  it("[I2 control] the wizard issues exactly ONE deposit insert per submission", async () => {
    // The ledger has no uniqueness constraint, so the only thing standing
    // between one allocation and two deposits is that this handler writes once
    // and the copy does not ask for a second pass.
    await submitClaim();

    await waitFor(() => expect(mockEventInsert).toHaveBeenCalledTimes(1));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
