/**
 * Phase 88 / ONB-02 — keyWindowsSchema: the 4 LOCKED validation rules.
 *
 * One test per rule firing (asserting exact issue path + UI-SPEC message) plus
 * the two clean PASS cases (Zavara-style sequential handoff, single open-ended
 * key). Adjacency is NOT overlap (the shared convention), so a handoff-day-
 * shared sequence validates clean.
 */
import { describe, it, expect } from "vitest";
import type { ZodIssue } from "zod";
import { keyWindowsSchema } from "@/lib/composite/keyWindowsSchema";

/** Future / today helpers computed relative to run time so the tests never rot. */
const DAY_MS = 24 * 60 * 60 * 1000;
const todayIso = () => new Date().toISOString().slice(0, 10);
const isoOffset = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

function issuesFor(input: unknown): ZodIssue[] {
  const res = keyWindowsSchema.safeParse(input);
  return res.success ? [] : res.error.issues;
}

function hasIssue(
  issues: ZodIssue[],
  path: (string | number)[],
  message: string,
): boolean {
  return issues.some(
    (i) =>
      i.message === message &&
      i.path.length === path.length &&
      i.path.every((seg, idx) => seg === path[idx]),
  );
}

describe("keyWindowsSchema — 4 LOCKED superRefine rules", () => {
  it("RULE overlap: overlapping windows fire at ['keys', j, 'window_start'] with the UI-SPEC message", () => {
    const issues = issuesFor({
      keys: [
        { window_start: "2025-01-01", window_end: "2025-02-01", seq: 1 },
        { window_start: "2025-01-15", window_end: "2025-03-01", seq: 2 },
      ],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 1, "window_start"],
        "Key 1 and Key 2 cover overlapping dates. Ranges must be non-overlapping (a handoff day may be shared).",
      ),
    ).toBe(true);
  });

  it("RULE non-monotone seq: window_start out of order fires at ['keys', j, 'seq'] with the UI-SPEC message", () => {
    // Later array position starts EARLIER than its predecessor → inconsistent
    // order. The two windows are disjoint, so the overlap rule stays silent.
    const issues = issuesFor({
      keys: [
        { window_start: "2025-06-01", window_end: "2025-07-01", seq: 1 },
        { window_start: "2025-01-01", window_end: "2025-02-01", seq: 2 },
      ],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 1, "seq"],
        "Key order is inconsistent — reorder so each window starts on or after the previous one.",
      ),
    ).toBe(true);
  });

  it("RULE end<start: window_end before window_start fires at ['keys', i, 'window_end']", () => {
    const issues = issuesFor({
      keys: [{ window_start: "2025-02-01", window_end: "2025-01-01", seq: 1 }],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 0, "window_end"],
        "End date must be after the start date.",
      ),
    ).toBe(true);
  });

  it("RULE end<start: window_end EQUAL to window_start is also invalid (mirrors DB CHECK strict >)", () => {
    const issues = issuesFor({
      keys: [{ window_start: "2025-01-01", window_end: "2025-01-01", seq: 1 }],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 0, "window_end"],
        "End date must be after the start date.",
      ),
    ).toBe(true);
  });

  it("RULE future window: window_start after today fires at ['keys', i, 'window_start']", () => {
    const issues = issuesFor({
      keys: [{ window_start: isoOffset(2), window_end: null, seq: 1 }],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 0, "window_start"],
        "Windows can't extend into the future.",
      ),
    ).toBe(true);
  });

  it("RULE future window: window_end after today fires at ['keys', i, 'window_end']", () => {
    const issues = issuesFor({
      keys: [{ window_start: "2024-01-01", window_end: isoOffset(2), seq: 1 }],
    });
    expect(
      hasIssue(
        issues,
        ["keys", 0, "window_end"],
        "Windows can't extend into the future.",
      ),
    ).toBe(true);
  });

  it("PASS: a 3-key Zavara-style sequential handoff (adjacency, last open-ended) validates clean", () => {
    const res = keyWindowsSchema.safeParse({
      keys: [
        { window_start: "2024-01-01", window_end: "2024-06-01", seq: 1 },
        { window_start: "2024-06-01", window_end: "2025-01-01", seq: 2 },
        { window_start: "2025-01-01", window_end: null, seq: 3 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("PASS: a single open-ended key validates clean", () => {
    const res = keyWindowsSchema.safeParse({
      keys: [{ window_start: "2024-01-01", window_end: null, seq: 1 }],
    });
    expect(res.success).toBe(true);
  });

  it("PASS: today itself is not 'future' (boundary — window_start === today allowed)", () => {
    const res = keyWindowsSchema.safeParse({
      keys: [{ window_start: todayIso(), window_end: null, seq: 1 }],
    });
    expect(res.success).toBe(true);
  });

  it("accepts an optional api_key_id uuid on a member", () => {
    const res = keyWindowsSchema.safeParse({
      keys: [
        {
          api_key_id: "11111111-2222-3333-4444-555555555555",
          window_start: "2024-01-01",
          window_end: null,
          seq: 1,
        },
      ],
    });
    expect(res.success).toBe(true);
  });
});
