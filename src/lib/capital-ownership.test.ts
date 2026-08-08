/**
 * Phase 150 / Plan 150-02 / OWN-03 — the allocatable predicate, spelled ONCE.
 *
 * THREE display states, TWO logic states (150-RESEARCH.md § Schema Findings 1):
 * `null` (never asked) and `"team_review"` are both NON-allocatable, but they
 * are not the same thing on the display surfaces — `null` renders no tag,
 * `"team_review"` renders the muted tag. This truth table pins the collapse so
 * a later "simplification" of the three display states into two reddens here.
 *
 * Oracle independence: expected values are literal booleans typed into this
 * file, never re-derived from the module under test.
 */

import { describe, it, expect } from "vitest";
import {
  capitalOwnershipRefusalMessage,
  isAllocatable,
  isCapitalOwnership,
  OWN_CAPITAL,
  TEAM_REVIEW,
  type CapitalOwnership,
} from "./capital-ownership";

describe("capital-ownership constants", () => {
  it("pins the two wire values as literals (they are DB column values)", () => {
    expect(OWN_CAPITAL).toBe("own_capital");
    expect(TEAM_REVIEW).toBe("team_review");
  });
});

describe("isAllocatable — the single-source allocatable predicate", () => {
  it("own_capital is the ONLY allocatable mark", () => {
    expect(isAllocatable("own_capital")).toBe(true);
  });

  it("team_review is NOT allocatable (a team's key can never join the allocation)", () => {
    expect(isAllocatable("team_review")).toBe(false);
  });

  it("null (legacy row, never asked) is NOT allocatable", () => {
    expect(isAllocatable(null)).toBe(false);
  });

  it("undefined (field absent from the row) is NOT allocatable", () => {
    expect(isAllocatable(undefined)).toBe(false);
  });

  it("accepts the exported constants at the type level and agrees with the literals", () => {
    const own: CapitalOwnership = OWN_CAPITAL;
    const team: CapitalOwnership = TEAM_REVIEW;
    expect(isAllocatable(own)).toBe(true);
    expect(isAllocatable(team)).toBe(false);
  });

  it("does not fall open for an unknown value cast in from an untyped DB read", () => {
    // The column is `text` in Postgres — a future/garbled value must fail
    // CLOSED (non-allocatable), never unlock the money action.
    expect(isAllocatable("Own_Capital" as unknown as CapitalOwnership)).toBe(false);
    expect(isAllocatable("" as unknown as CapitalOwnership)).toBe(false);
    expect(isAllocatable("owner" as unknown as CapitalOwnership)).toBe(false);
  });
});

/**
 * 151 informational D4 — the closed-set narrowing, previously hand-spelled at
 * four call sites (OwnershipTag, the v2 factsheet's owner lane, and the wizard
 * finalize's validate + narrow pair).
 *
 * The property that matters is the SAME one `isAllocatable` above carries, and
 * it is why this must not be a `!== null` check: the value reaching every one
 * of those sites comes off an untyped `text` column, so anything other than the
 * two exact literals must be REFUSED, not passed through. A copy written by
 * someone reasoning about only the two known values fails OPEN for the third
 * case — and the third case is the one a schema change or a hostile write
 * supplies.
 */
describe("isCapitalOwnership — the single-source closed-set narrowing", () => {
  it("accepts exactly the two marks", () => {
    expect(isCapitalOwnership("own_capital")).toBe(true);
    expect(isCapitalOwnership("team_review")).toBe(true);
  });

  it("REFUSES null and undefined — absence is not a mark", () => {
    // The column is deliberately NULLABLE with no DEFAULT and no backfill, so
    // `null` is the COMMON case on legacy rows. Treating it as a mark would
    // render a tag nobody set.
    expect(isCapitalOwnership(null)).toBe(false);
    expect(isCapitalOwnership(undefined)).toBe(false);
  });

  it("REFUSES anything else the untyped text column could hand back", () => {
    expect(isCapitalOwnership("")).toBe(false);
    expect(isCapitalOwnership("Own_Capital")).toBe(false);
    expect(isCapitalOwnership("own_capital ")).toBe(false);
    expect(isCapitalOwnership("owner")).toBe(false);
    expect(isCapitalOwnership(0)).toBe(false);
    expect(isCapitalOwnership(1)).toBe(false);
    expect(isCapitalOwnership(true)).toBe(false);
    expect(isCapitalOwnership({})).toBe(false);
    expect(isCapitalOwnership(["own_capital"])).toBe(false);
  });

  it("narrows at the TYPE level, which is what lets the call sites drop their casts", () => {
    const fromDb: unknown = OWN_CAPITAL;
    if (isCapitalOwnership(fromDb)) {
      // Assignable without a cast ⇒ the predicate really is `v is
      // CapitalOwnership`. A `boolean` return would not compile here.
      const narrowed: CapitalOwnership = fromDb;
      expect(narrowed).toBe("own_capital");
    } else {
      throw new Error("expected OWN_CAPITAL to narrow");
    }
  });

  it("agrees with isAllocatable on the ONE mark that unlocks the money action", () => {
    // Two predicates, two jobs: `isCapitalOwnership` says "this is a mark",
    // `isAllocatable` says "this mark permits an allocation". team_review is a
    // valid mark AND non-allocatable, and conflating them is the drift this
    // pins.
    expect(isCapitalOwnership(TEAM_REVIEW)).toBe(true);
    expect(isAllocatable(TEAM_REVIEW)).toBe(false);
  });
});

/**
 * 151 review I3 — the shared 23514 mapper, and the ONE sentence two readers
 * with opposite powers both have to receive.
 *
 * The trigger's ARM 1 (`v_mark = 'team_review'`, migration
 * 20260806120000_strategies_capital_ownership.sql) has NO owner conjunct, so it
 * fires for the strategy's OWNER as well as for a third-party allocator. The
 * error object carries a code and a message and no identity, and neither
 * browser-direct writer knows the owner at the point of refusal — so there is
 * no branch to write here, only copy that must be true for both.
 *
 * The properties below are what "true for both" MEANS, asserted separately from
 * the sentence itself so a reword that keeps the words and loses the property
 * still reddens:
 *
 *   (a) the remedy must SURVIVE for the owner — the mark is nameable and the
 *       screen that changes it is named. A bare statement of fact ("…so it
 *       can't be added to a portfolio.") is what shipped, and it left the one
 *       reader who can act with nothing to act on.
 *   (b) the remedy must be ATTRIBUTED, never addressed. No second person, no
 *       imperative: a third party told to go mark a row is being sent to a
 *       screen that will not contain it, and the sentence would assert the row
 *       is theirs. That is the original finding and it must stay closed.
 *
 * Oracle independence: the sentences are typed here as literals and never
 * re-derived from the module under test — the same rule
 * `AddToPortfolio.test.tsx` and `MigrationWizard.test.tsx` follow, and the
 * reason all three must be edited deliberately when the copy changes.
 */
describe("capitalOwnershipRefusalMessage — one sentence, two readers", () => {
  const RAW_UUID = "99999999-9999-4999-8999-999999999999";
  const pgMessage = (mark: string) =>
    `strategy ${RAW_UUID} cannot become a position: capital_ownership=${mark} (required: own_capital)`;

  const COPY_TEAM_REVIEW =
    "This strategy is marked as a trading team's capital under review, so it can't be added to a portfolio. Its owner can change that mark in My Strategies.";
  const COPY_OWNER_REMEDY =
    "This strategy isn't marked as your own capital — mark it in My Strategies first.";

  it("ARM 1 (team_review) returns the team sentence", () => {
    expect(capitalOwnershipRefusalMessage({ message: pgMessage("team_review") })).toBe(
      COPY_TEAM_REVIEW,
    );
  });

  it("ARM 1 (a) — the OWNER's remedy survives: the sentence names the mark AND the screen that changes it", () => {
    // The owner is the person who can flip this mark, and ARM 1 reaches them.
    // Copy that only states the refusal leaves them with no lever.
    const msg = capitalOwnershipRefusalMessage({ message: pgMessage("team_review") });
    expect(msg).toMatch(/owner can change/i);
    expect(msg).toMatch(/My Strategies/);
  });

  it("ARM 1 (b) — the remedy is ATTRIBUTED, never addressed: no second person, no imperative", () => {
    // A third-party allocator reaches this identical arm. Telling THEM to mark
    // the row is a dead end, and the copy would also assert the row is theirs.
    const msg = capitalOwnershipRefusalMessage({ message: pgMessage("team_review") });
    expect(msg).not.toMatch(/\byour\b/i);
    expect(msg).not.toMatch(/\byours\b/i);
    // "mark it …" / "go mark …" — an imperative pointed at the reader.
    expect(msg).not.toMatch(/\bmark it\b/i);
  });

  it("ARM 2 (unmarked, owner-only by the trigger's conjunct) keeps the second-person remedy it has earned", () => {
    expect(capitalOwnershipRefusalMessage({ message: pgMessage("unmarked") })).toBe(
      COPY_OWNER_REMEDY,
    );
  });

  it("never returns the driver's own text, so the internal strategy UUID cannot reach a reader", () => {
    for (const mark of ["team_review", "unmarked", "own_capital"]) {
      const msg = capitalOwnershipRefusalMessage({ message: pgMessage(mark) });
      expect(msg).not.toContain(RAW_UUID);
      expect(msg).not.toContain("capital_ownership=");
    }
  });

  it("a missing / null / absent message falls to the owner arm rather than throwing", () => {
    // The needle is read off `message`; absence is not a team_review signal.
    expect(capitalOwnershipRefusalMessage(null)).toBe(COPY_OWNER_REMEDY);
    expect(capitalOwnershipRefusalMessage(undefined)).toBe(COPY_OWNER_REMEDY);
    expect(capitalOwnershipRefusalMessage({})).toBe(COPY_OWNER_REMEDY);
    expect(capitalOwnershipRefusalMessage({ message: null })).toBe(COPY_OWNER_REMEDY);
  });
});
