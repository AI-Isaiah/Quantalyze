/**
 * Phase 167.2 KEYCARDSYNC / KCS-14: every locked S1-S2 key-card string, pinned
 * character for character.
 *
 * WHY THIS FILE EXISTS. The strings in `key-card-copy.ts` are the card's claims
 * about a sync it cannot see the end of: that a sync is blocking a new key,
 * that the panel stopped checking, that a bound expired before the sync was
 * confirmed. Each one was authored once, in `167.2-UI-SPEC.md`, so that none of
 * them says more than the card knows (above all, none of the KCS-03 lines may
 * say the sync failed). A paraphrase in code is how such a claim drifts, so
 * every expected value below is a HAND-TYPED literal copied from the UI-SPEC,
 * never imported from the module under test: an import would make the oracle
 * agree with whatever the module says.
 */
import { describe, it, expect } from "vitest";
import {
  addKeyBlockedReason,
  formatBoundDuration,
  DELETE_COMPOSITE_MEMBER_COPY,
  EMPTY_NOLINK_COPY,
  PANEL_STOP_COPY,
  SHAPE_UNKNOWN_CARD_NOTE,
  SYNC_SLOW_NOTE,
} from "./key-card-copy";

describe("KCS-01 (S1): why Connect Key is blocked", () => {
  it("KCS01-BLOCKED: names the attempt's key label inside ASCII double quotes", () => {
    const text = addKeyBlockedReason("Synthetic Key A");
    expect(text).toBe(
      'Wait for the sync of "Synthetic Key A" to finish before connecting another key.',
    );
    // The quotes are U+0022, not typographic quotes.
    expect(text.charCodeAt(text.indexOf("Synthetic") - 1)).toBe(0x22);
    expect(text).not.toMatch(/[“”]/);
  });

  it("KCS01-BLOCKED: a label carrying replacement patterns is inserted literally", () => {
    // A string replacement would expand `$&` into the placeholder itself.
    expect(addKeyBlockedReason("Key $& one")).toBe(
      'Wait for the sync of "Key $& one" to finish before connecting another key.',
    );
  });

  it.each([null, undefined, "", "   "])(
    "KCS01-BLOCKED-NOLABEL: a %j label selects the no-label line",
    (label) => {
      expect(addKeyBlockedReason(label)).toBe(
        "Wait for the current sync to finish before connecting another key.",
      );
    },
  );
});

describe("KCS-22 (S2): the panel stopped checking", () => {
  it("KCS22-CAP: label and detail", () => {
    expect(PANEL_STOP_COPY.poll_cap.label).toBe("No result yet");
    expect(PANEL_STOP_COPY.poll_cap.detail).toBe(
      "This panel stopped checking after 2 minutes. The sync may still be running: reload this page later to see its result.",
    );
  });

  it("KCS22-NOROW: label and detail", () => {
    expect(PANEL_STOP_COPY.missing_row.label).toBe("No result yet");
    expect(PANEL_STOP_COPY.missing_row.detail).toBe(
      "This panel stopped checking after 30 seconds with nothing recorded yet. The sync may still be running: reload this page later to see its result.",
    );
  });
});

describe("KCS-03 (S2): a client-side bound expired before the sync was confirmed", () => {
  it("KCS03-LINK: label and detail", () => {
    expect(PANEL_STOP_COPY.link_bound.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.link_bound.detail).toBe(
      "This sync did not start: linking the key to this strategy did not answer within 15 seconds. Reload this page to check which key is linked before you sync again.",
    );
  });

  it("KCS03-ENQUEUE: label and detail", () => {
    expect(PANEL_STOP_COPY.enqueue_bound.label).toBe("Sync not confirmed");
    expect(PANEL_STOP_COPY.enqueue_bound.detail).toBe(
      "We could not confirm this sync started: the request did not answer within 3 minutes, so it may still be running. Reload this page to see the latest status before you sync again.",
    );
  });

  it("neither KCS03 line claims a failure the card cannot know", () => {
    for (const reason of ["link_bound", "enqueue_bound"] as const) {
      const { label, detail } = PANEL_STOP_COPY[reason];
      expect(`${label} ${detail}`).not.toMatch(/fail|error/i);
    }
  });
});

describe("PANEL_STOP_COPY covers exactly the pinned reasons", () => {
  it("a new stop reason cannot ship without a pin in this file", () => {
    expect(Object.keys(PANEL_STOP_COPY).sort()).toEqual(
      ["chain_in_flight", "chain_unreadable", "enqueue_bound", "link_bound", "missing_row", "poll_cap"],
    );
  });
});

describe("formatBoundDuration: the durations the sentences state", () => {
  it.each([
    [15_000, "15 seconds"],
    [30_000, "30 seconds"],
    [120_000, "2 minutes"],
    [180_000, "3 minutes"],
  ])("%d ms reads as %j", (ms, text) => {
    expect(formatBoundDuration(ms)).toBe(text);
  });

  it("90 000 ms is not a whole number of minutes, so it throws rather than round", () => {
    expect(() => formatBoundDuration(90_000)).toThrow();
  });
});

describe("KCS-SLOW (167.2-REVIEW WR-07): the in-flight panel names its own limit, never a sync duration", () => {
  it("KCS-SLOW: the line and the poll budget it states", () => {
    expect(SYNC_SLOW_NOTE).toBe(
      "Large accounts can take longer. This panel checks for 2 minutes; the sync may still be running after that.",
    );
  });
});

describe("Review-fix round 1 (2026-09-24): the S3 strings authored for the review findings", () => {
  it("KCS-SHAPE-UNKNOWN (SFH H-2)", () => {
    expect(SHAPE_UNKNOWN_CARD_NOTE).toBe(
      "We could not confirm how this strategy's keys are set up, so syncing and adding keys are paused on this page. Reload this page to try again.",
    );
  });

  it("KCS-EMPTY-NOLINK (SFH H-2)", () => {
    expect(EMPTY_NOLINK_COPY).toBe("No API keys connected.");
  });

  it("KCS-DELETE-COMPOSITE (REVIEW WR-05)", () => {
    expect(DELETE_COMPOSITE_MEMBER_COPY).toBe(
      "This key is part of a composite strategy, so it is not deleted here. Contact support@quantalyze.com to change which keys the composite uses.",
    );
  });
});

describe("KCS-GATE (167.2-REVIEW CR-01 / WR-06): the pre-attempt job-state gate refused the attempt", () => {
  it("KCS-GATE-INFLIGHT: label and detail", () => {
    expect(PANEL_STOP_COPY.chain_in_flight.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.chain_in_flight.detail).toBe(
      "This sync did not start: a sync for this strategy is still running. Try again once it has finished.",
    );
  });

  it("KCS-GATE-UNREADABLE: label and detail", () => {
    expect(PANEL_STOP_COPY.chain_unreadable.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.chain_unreadable.detail).toBe(
      "This sync did not start: we could not check whether a sync for this strategy is still running. Try again in a moment.",
    );
  });

  it("neither gate line claims a failure the card cannot know", () => {
    for (const reason of ["chain_in_flight", "chain_unreadable"] as const) {
      const { label, detail } = PANEL_STOP_COPY[reason];
      expect(`${label} ${detail}`).not.toMatch(/fail|error/i);
    }
  });
});
