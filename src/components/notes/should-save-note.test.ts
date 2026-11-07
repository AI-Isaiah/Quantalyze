/**
 * Phase 193 (QUIETVIEW) D-09: the truth table of the shared blur predicate.
 * Every row encodes WHY: opening and leaving a note must never write a row the
 * user did not author by typing (TRUST-06), while a real edit and a deliberate
 * clear must always reach the route.
 */

import { describe, it, expect } from "vitest";
import { shouldSaveNoteOnBlur } from "./should-save-note";

describe("shouldSaveNoteOnBlur (D-09)", () => {
  it.each([
    // [draft, persisted, expected, why]
    ["", "", false, "opened empty, left untouched: no row"],
    ["   ", "", false, "whitespace only over nothing saved: no row"],
    ["x", "", true, "first real text saves"],
    ["x", "x", false, "unchanged saved note: no write"],
    ["y", "x", true, "edited saved note saves"],
    // Q-1 row: founder override of D-09 (2026-11-07, "Allow clearing").
    ["", "x", true, "Q-1: a saved note cleared saves the clear"],
    ["  ", "x", true, "a saved note blanked to whitespace saves (it clears the note)"],
    ["", "  ", false, "persisted whitespace is already blank: nothing to clear"],
  ] as const)("(%j, %j) -> %s (%s)", (draft, persisted, expected, _why) => {
    expect(shouldSaveNoteOnBlur(draft, persisted)).toBe(expected);
  });
});
