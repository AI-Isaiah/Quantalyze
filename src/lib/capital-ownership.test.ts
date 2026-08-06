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
  isAllocatable,
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
