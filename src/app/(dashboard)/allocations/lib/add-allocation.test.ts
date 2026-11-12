/**
 * Phase 198 plan 05 — the pure half of the allocator's "+ Allocation" flow.
 *
 * WHY THESE CASES EXIST (each pins a decision, not just a return value):
 *
 *  - D-05 routes by OWNERSHIP. An own strategy becomes a Holdings row through the
 *    allocation route. Someone else's strategy is recorded as one `voluntary_add`
 *    diff through the scenario commit route. A branch that posts to the wrong
 *    route either invents a Holdings row for a strategy the allocator does not
 *    hold, or loses the record entirely.
 *  - C3: because the commit route only writes an Outcomes record, the success
 *    copy for that branch must never promise a Holdings row.
 *  - P2: the commit route has no per-strategy uniqueness. Duplicate protection is
 *    therefore the idempotency key plus the held set, and the held set has to see
 *    an `allocated` outcome as well as a Holdings row, or a strategy recorded
 *    under Outcomes could be added a second time.
 *  - No share of book is guessed: with no usable Book equity the third-party
 *    branch refuses, it does not send `percent_allocated: 0`.
 */

import { describe, expect, it } from "vitest";
import {
  BOOK_EQUITY_UNAVAILABLE_MESSAGE,
  COMMIT_ROUTE,
  aboveBookEquityMessage,
  buildAllocationRequest,
  commitSucceeded,
  heldStrategyIdsFrom,
  isNotOwnCapital,
  resolveDeepLink,
  successAnnouncement,
  validateAllocationDate,
} from "./add-allocation";
import { ALLOCATION_ROUTE } from "../components/AllocateDialog";
import {
  ALLOCATED_FIELDS,
  OUTCOME_DATE_FUTURE_MESSAGE,
  OUTCOME_DATE_TOO_OLD_MESSAGE,
} from "@/lib/bridge-outcome-schema";

const OWN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";

describe("buildAllocationRequest", () => {
  it("own strategy: allocation route, no date, no Book equity needed, not idempotent", () => {
    const out = buildAllocationRequest({
      row: { id: OWN_ID, isOwn: true },
      amountUsd: 25000,
      dateIso: "2026-11-01",
      bookEquityUsd: null,
      allKeysStale: false,
    });
    expect(out).toEqual({
      ok: true,
      route: "/api/portfolio-strategies/allocation",
      body: { strategy_id: OWN_ID, allocated_amount: 25000 },
      idempotent: false,
    });
    expect(out.ok && out.route).toBe(ALLOCATION_ROUTE);
  });

  it("someone else's strategy: one voluntary_add diff on the commit route, idempotent, no fingerprint key at all", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID, isOwn: false },
      amountUsd: 25000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: false,
    });
    expect(out).toEqual({
      ok: true,
      route: "/api/allocator/scenario/commit",
      body: {
        diffs: [
          {
            kind: "voluntary_add",
            strategy_id: OTHER_ID,
            percent_allocated: 25,
            size_at_decision_usd: 25000,
            effective_date: "2026-11-01",
          },
        ],
      },
      idempotent: true,
    });
    expect(out.ok && out.route).toBe(COMMIT_ROUTE);
    // A fingerprint would turn a record-only add into a stale-draft fence (409).
    expect(JSON.stringify(out)).not.toContain("init_holdings_fingerprint");
  });

  it("an absent isOwn is treated as not own (the === true rule)", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID },
      amountUsd: 1000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: false,
    });
    expect(out.ok && out.route).toBe(COMMIT_ROUTE);
  });

  it.each([null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "someone else's strategy with Book equity %s refuses at the amount field and sizes nothing",
    (bookEquityUsd) => {
      const out = buildAllocationRequest({
        row: { id: OTHER_ID, isOwn: false },
        amountUsd: 25000,
        dateIso: "2026-11-01",
        bookEquityUsd,
        allKeysStale: false,
      });
      expect(out).toEqual({
        ok: false,
        field: "amount",
        message:
          "We cannot size this allocation until your allocation equity is available.",
      });
      expect(BOOK_EQUITY_UNAVAILABLE_MESSAGE).toBe(
        "We cannot size this allocation until your allocation equity is available.",
      );
    },
  );

  it("someone else's strategy above Book equity is refused, naming the Book equity", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID, isOwn: false },
      amountUsd: 150000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: false,
    });
    expect(out).toEqual({
      ok: false,
      field: "amount",
      message: "Enter an amount up to your allocation equity ($100,000).",
    });
    expect(aboveBookEquityMessage(100000)).toBe(
      "Enter an amount up to your allocation equity ($100,000).",
    );
  });

  it("an amount equal to Book equity is allowed (100%, not above it)", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID, isOwn: false },
      amountUsd: 100000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: false,
    });
    expect(out.ok).toBe(true);
    if (out.ok && out.idempotent) {
      expect(out.body.diffs[0].percent_allocated).toBe(100);
    }
  });

  it("percent is the raw ratio times 100 with no rounding", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID, isOwn: false },
      amountUsd: 1,
      dateIso: "2026-11-01",
      bookEquityUsd: 3,
      allKeysStale: false,
    });
    expect(out.ok).toBe(true);
    if (out.ok && out.idempotent) {
      expect(out.body.diffs[0].percent_allocated).toBe((1 / 3) * 100);
    }
  });

  it.each([0, -1, Number.NaN])(
    "the amount rule is parseAmount's, on both branches (amount %s)",
    (amountUsd) => {
      for (const isOwn of [true, false]) {
        const out = buildAllocationRequest({
          row: { id: OWN_ID, isOwn },
          amountUsd,
          dateIso: "2026-11-01",
          bookEquityUsd: 100000,
          allKeysStale: false,
        });
        expect(out).toEqual({
          ok: false,
          field: "amount",
          message: "Enter an amount above $0.",
        });
      }
    },
  );

  it("the ticket cap is parseAmount's on both branches", () => {
    for (const isOwn of [true, false]) {
      const out = buildAllocationRequest({
        row: { id: OWN_ID, isOwn },
        amountUsd: 2_000_000_000,
        dateIso: "2026-11-01",
        bookEquityUsd: 5_000_000_000,
        allKeysStale: false,
      });
      expect(out).toEqual({
        ok: false,
        field: "amount",
        message: "That's above the $1B sanity cap — check the amount.",
      });
    }
  });

  it("someone else's strategy with every key stale is refused at the amount: the stored percent is never built from stale Book equity", () => {
    const out = buildAllocationRequest({
      row: { id: OTHER_ID, isOwn: false },
      amountUsd: 25000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: true,
    });
    expect(out).toEqual({
      ok: false,
      field: "amount",
      message: BOOK_EQUITY_UNAVAILABLE_MESSAGE,
    });
  });

  it("an own strategy is unaffected by stale keys (it stores an amount, never a share of book)", () => {
    const out = buildAllocationRequest({
      row: { id: OWN_ID, isOwn: true },
      amountUsd: 25000,
      dateIso: "2026-11-01",
      bookEquityUsd: 100000,
      allKeysStale: true,
    });
    expect(out.ok && out.route).toBe(ALLOCATION_ROUTE);
  });
});

describe("validateAllocationDate", () => {
  it("rejects tomorrow with the schema's own future message", () => {
    expect(validateAllocationDate("2026-11-09", "2026-11-08")).toBe(
      OUTCOME_DATE_FUTURE_MESSAGE,
    );
    expect(OUTCOME_DATE_FUTURE_MESSAGE).toBe("Date cannot be in the future");
  });

  it("rejects 366 days back, accepts today and exactly 365 days back", () => {
    // 2026-11-08 minus 365 days is 2025-11-08 (no leap day in between).
    expect(validateAllocationDate("2025-11-07", "2026-11-08")).toBe(
      OUTCOME_DATE_TOO_OLD_MESSAGE,
    );
    expect(validateAllocationDate("2025-11-08", "2026-11-08")).toBeNull();
    expect(validateAllocationDate("2026-11-08", "2026-11-08")).toBeNull();
    expect(OUTCOME_DATE_TOO_OLD_MESSAGE).toBe(
      "Date cannot be more than 365 days ago",
    );
  });

  it("counts 365 calendar days across a leap day the way the bridge schema does", () => {
    // 2028-03-01 minus 365 days is 2027-03-02 (2028-02-29 sits inside the window).
    expect(validateAllocationDate("2027-03-02", "2028-03-01")).toBeNull();
    expect(validateAllocationDate("2027-03-01", "2028-03-01")).toBe(
      OUTCOME_DATE_TOO_OLD_MESSAGE,
    );
  });

  it("an empty or malformed date is refused, never sent", () => {
    expect(validateAllocationDate("", "2026-11-08")).not.toBeNull();
    expect(validateAllocationDate("2026-13-45", "2026-11-08")).not.toBeNull();
    expect(validateAllocationDate("11/01/2026", "2026-11-08")).not.toBeNull();
  });

  it("agrees with the schema refine at the boundaries (one source for the window)", () => {
    const today = new Date().toISOString().slice(0, 10);
    const back = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    for (const dateIso of [back(364), back(365), back(366), back(-1), today]) {
      const schemaOk = ALLOCATED_FIELDS.safeParse({
        percent_allocated: 5,
        allocated_at: dateIso,
      }).success;
      expect(validateAllocationDate(dateIso, today) === null).toBe(schemaOk);
    }
  });
});

describe("successAnnouncement", () => {
  it("own: says it is listed under Strategies on Holdings, with no date", () => {
    expect(
      successAnnouncement({
        name: "Alpha One",
        isOwn: true,
        amountUsd: 25000,
        dateIso: "2026-11-01",
      }),
    ).toBe(
      "Allocation recorded: Alpha One, $25,000. It is listed under Strategies on Holdings.",
    );
  });

  it("someone else's: says it is listed under Outcomes, with the date, and never promises a Holdings row", () => {
    const line = successAnnouncement({
      name: "Alpha One",
      isOwn: false,
      amountUsd: 25000,
      dateIso: "2026-11-01",
    });
    expect(line).toBe(
      "Allocation recorded: Alpha One, $25,000 from Nov\u00a01,\u00a02026. It is listed under Outcomes on Holdings.",
    );
    expect(line).not.toContain("Strategies on Holdings");
  });
});

describe("heldStrategyIdsFrom", () => {
  it("holds every Holdings strategy and every allocated outcome's replacement strategy", () => {
    const held = heldStrategyIdsFrom(
      [{ strategy_id: OWN_ID }],
      [
        { kind: "allocated", replacement_strategy: { id: OTHER_ID } },
        { kind: "rejected", replacement_strategy: { id: THIRD_ID } },
        { kind: "allocated", replacement_strategy: null },
      ],
      [],
    );
    expect([...held].sort()).toEqual([OWN_ID, OTHER_ID].sort());
    expect(held.has(THIRD_ID)).toBe(false);
  });

  it("a rejected outcome and a null replacement add nothing", () => {
    const held = heldStrategyIdsFrom(
      [],
      [
        { kind: "rejected", replacement_strategy: { id: OTHER_ID } },
        { kind: "allocated", replacement_strategy: null },
      ],
      [],
    );
    expect(held.size).toBe(0);
  });

  it("an allocated strategy the capped outcomes list lost (past 200 rows, or a null join) is still held, from the uncapped id read", () => {
    // `outcomes` stops at 200 rows and a row with a null strategy join has no id,
    // so only the uncapped read can stop a held strategy being added twice.
    const held = heldStrategyIdsFrom(
      [],
      [{ kind: "allocated", replacement_strategy: null }],
      [OTHER_ID, THIRD_ID],
    );
    expect([...held].sort()).toEqual([OTHER_ID, THIRD_ID].sort());
  });
});

describe("resolveDeepLink", () => {
  const rows = [
    { id: OWN_ID, name: "Own", isOwn: true },
    { id: OTHER_ID, name: "Other", isOwn: false },
  ];
  const held = new Set([OWN_ID]);

  it("an empty value is none (opens step 1 with no notice)", () => {
    expect(resolveDeepLink("", rows, false, held)).toEqual({ kind: "none" });
  });

  it("a malformed value is unavailable/malformed", () => {
    expect(resolveDeepLink("not-a-uuid", rows, false, held)).toEqual({
      kind: "unavailable",
      reason: "malformed",
    });
  });

  it("a uuid missing from a complete list is unavailable/unlisted", () => {
    expect(resolveDeepLink(THIRD_ID, rows, false, held)).toEqual({
      kind: "unavailable",
      reason: "unlisted",
    });
  });

  it("a uuid missing from a TRUNCATED list is not_loaded: absence proves nothing", () => {
    expect(resolveDeepLink(THIRD_ID, rows, true, held)).toEqual({
      kind: "not_loaded",
    });
  });

  it("a listed held id is held, with its row", () => {
    expect(resolveDeepLink(OWN_ID, rows, false, held)).toEqual({
      kind: "held",
      row: rows[0],
    });
  });

  it("a listed id that is not held is prefill, with its row", () => {
    expect(resolveDeepLink(OTHER_ID, rows, false, held)).toEqual({
      kind: "prefill",
      row: rows[1],
    });
  });
});

/**
 * 198-ADD-DEEPLINK-UNMARKED-OWN. WHY: the picker disables an own strategy that is
 * not marked own capital, because the allocation route answers 409 for it every
 * time. `/allocations?add=<id>` (built by the factsheet's "Add to my allocation")
 * resolved the same row to `prefill`, so the allocator reached the amount step and
 * only learned of the refusal after typing an amount and submitting. The deep link
 * must apply the picker's own test, so one rule decides both.
 */
describe("isNotOwnCapital: the picker's test, single-sourced", () => {
  const marked = new Set([OWN_ID]);

  it("an own, active strategy outside the own-capital set is not selectable", () => {
    expect(isNotOwnCapital({ id: OTHER_ID, isOwn: true, status: "published" }, marked)).toBe(true);
  });

  it("an own strategy inside the set is selectable", () => {
    expect(isNotOwnCapital({ id: OWN_ID, isOwn: true, status: "published" }, marked)).toBe(false);
  });

  it("someone else's strategy is never refused by this test", () => {
    expect(isNotOwnCapital({ id: OTHER_ID, isOwn: false, status: "published" }, marked)).toBe(false);
    expect(isNotOwnCapital({ id: OTHER_ID }, marked)).toBe(false);
  });

  it("an archived own strategy is not decided here: the set omits archived rows, and the route's 409 still refuses", () => {
    expect(isNotOwnCapital({ id: OTHER_ID, isOwn: true, status: "archived" }, marked)).toBe(false);
  });

  it("a failed own-capital read (set undefined) never disables a row", () => {
    expect(isNotOwnCapital({ id: OTHER_ID, isOwn: true, status: "published" }, undefined)).toBe(false);
  });
});

describe("resolveDeepLink: an own strategy not marked own capital", () => {
  const rows = [
    { id: OWN_ID, name: "Marked own", isOwn: true, status: "published" },
    { id: OTHER_ID, name: "Unmarked own", isOwn: true, status: "published" },
    { id: THIRD_ID, name: "Third party", isOwn: false, status: "published" },
  ];
  const marked = new Set([OWN_ID]);

  it("lands on the disabled row's reason, with its row, instead of the amount step", () => {
    expect(resolveDeepLink(OTHER_ID, rows, false, new Set(), marked)).toEqual({
      kind: "unmarked_own",
      row: rows[1],
    });
  });

  it("a marked own strategy still prefills", () => {
    expect(resolveDeepLink(OWN_ID, rows, false, new Set(), marked)).toEqual({
      kind: "prefill",
      row: rows[0],
    });
  });

  it("a third-party strategy still prefills", () => {
    expect(resolveDeepLink(THIRD_ID, rows, false, new Set(), marked)).toEqual({
      kind: "prefill",
      row: rows[2],
    });
  });

  it("with no own-capital set (the read failed) it prefills, so a blip never blocks the link", () => {
    expect(resolveDeepLink(OTHER_ID, rows, false, new Set())).toEqual({
      kind: "prefill",
      row: rows[1],
    });
  });

  it("a held strategy is reported as held, which says more than the own-capital reason", () => {
    expect(resolveDeepLink(OTHER_ID, rows, false, new Set([OTHER_ID]), marked)).toEqual({
      kind: "held",
      row: rows[1],
    });
  });
});

describe("commitSucceeded", () => {
  it("is true only for exactly one recorded and no errors", () => {
    expect(commitSucceeded({ recorded: 1, errors: [] })).toBe(true);
    expect(commitSucceeded({ recorded: 1 })).toBe(true);
    expect(commitSucceeded({ recorded: 1, errors: [], results: [{}] })).toBe(true);
  });

  it.each([
    [{ recorded: 0, errors: [] }],
    [{ recorded: 2, errors: [] }],
    [{ recorded: 1, errors: [{ index: 0, error: "x" }] }],
    [{ errors: [] }],
    [{ recorded: "1", errors: [] }],
    [null],
    ["ok"],
    [undefined],
  ])("is false for %j", (raw) => {
    expect(commitSucceeded(raw)).toBe(false);
  });
});
