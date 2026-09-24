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
  deleteCompositeWarning,
  DELETE_MEMBERSHIP_UNCHECKED_COPY,
  EMPTY_NOLINK_COPY,
  FINISH_UNVERIFIED_NOTE,
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
      [
        "chain_in_flight",
        "chain_unreadable",
        "chain_unreadable_persistent",
        "enqueue_bound",
        "enqueue_late_started",
        "link_bound",
        "link_unverified",
        "missing_row",
        "poll_cap",
        "unreadable",
      ],
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
      "We could not confirm whether this strategy is a composite, so keys are not linked or synced from this card. Contact support@quantalyze.com to link a key or start a sync.",
    );
  });

  it("KCS-EMPTY-NOLINK (SFH H-2)", () => {
    expect(EMPTY_NOLINK_COPY).toBe("No API keys connected.");
  });

  // KCS-DELETE-COMPOSITE's round-1 refusal string was retired by the founder
  // decision of 2026-09-24 (round 2): the Delete now warns and proceeds. Its
  // pin moved to the round-2 describe below (`deleteCompositeWarning`).
});

describe("Review-fix round 2 (2026-09-24, founder decision): the Delete confirm's composite warning (167.2-REVIEW-R2 WR-02)", () => {
  it("KCS-DELETE-COMPOSITE: one named composite", () => {
    expect(deleteCompositeWarning([{ name: "Synthetic Composite A", status: "draft" }])).toBe(
      'This key is part of 1 composite strategy: "Synthetic Composite A". Deleting it removes the key from every composite listed, and a composite with no other key left becomes unlinked.',
    );
  });

  it("KCS-DELETE-COMPOSITE: several, one unnamed, one published", () => {
    expect(
      deleteCompositeWarning([
        { name: "Synthetic Composite A", status: "archived" },
        { name: null, status: null },
        { name: "Synthetic Composite P", status: "published" },
      ]),
    ).toBe(
      'This key is part of 3 composite strategies: "Synthetic Composite A", a composite whose name could not be read, "Synthetic Composite P". Deleting it removes the key from every composite listed, and a composite with no other key left becomes unlinked. A key used by a published composite cannot be deleted: contact support@quantalyze.com to change that composite\'s keys.',
    );
  });

  it("a name carrying a replacement pattern is rendered literally", () => {
    expect(deleteCompositeWarning([{ name: "$& $'", status: "draft" }])).toContain('"$& $\'"');
  });

  it("KCS-DELETE-UNCHECKED", () => {
    expect(DELETE_MEMBERSHIP_UNCHECKED_COPY).toBe(
      "We could not check whether this key is part of a composite strategy. If it is, deleting it also removes it from that composite, and a composite with no other key left becomes unlinked.",
    );
  });
});

describe("KCS-GATE (167.2-REVIEW CR-01 / WR-06): the pre-attempt job-state gate refused the attempt", () => {
  it("KCS-GATE-INFLIGHT: label and detail", () => {
    expect(PANEL_STOP_COPY.chain_in_flight.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.chain_in_flight.detail).toBe(
      "This sync did not start: this strategy still has a sync or computation in progress. Try again once it has finished.",
    );
  });

  it("KCS-GATE-UNREADABLE: label and detail", () => {
    expect(PANEL_STOP_COPY.chain_unreadable.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.chain_unreadable.detail).toBe(
      "This sync did not start: we could not check whether a sync for this strategy is still running. Try again in a moment.",
    );
  });

  it("KCS-GATE-UNREADABLE-PERSISTENT (167.2-REVIEW-R2 IN-04 / SFH-R2 R2-L1): label and detail", () => {
    expect(PANEL_STOP_COPY.chain_unreadable_persistent.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.chain_unreadable_persistent.detail).toBe(
      "This sync did not start: we cannot check whether this strategy has a sync in progress, and trying again will not change that. Contact support@quantalyze.com to start a sync.",
    );
    expect(PANEL_STOP_COPY.chain_unreadable_persistent.detail).not.toMatch(/in a moment/i);
  });

  it("neither gate line claims a failure the card cannot know", () => {
    for (const reason of ["chain_in_flight", "chain_unreadable", "chain_unreadable_persistent"] as const) {
      const { label, detail } = PANEL_STOP_COPY[reason];
      expect(`${label} ${detail}`).not.toMatch(/fail|error/i);
    }
  });
});

describe("KCS-UNREADABLE (167.2-REVIEW-SFH M-3): the panel stopped because it could not read", () => {
  it("label and detail", () => {
    expect(PANEL_STOP_COPY.unreadable.label).toBe("No result yet");
    expect(PANEL_STOP_COPY.unreadable.detail).toBe(
      "This panel could not read the sync's status for 2 minutes. The sync may still be running: reload this page later to see its result.",
    );
  });
});

describe("KCS-LINK-UNVERIFIED (167.2-REVIEW WR-04): the link read back before the enqueue was not this attempt's key", () => {
  it("label and detail, and no failure claim", () => {
    expect(PANEL_STOP_COPY.link_unverified.label).toBe("Sync not started");
    expect(PANEL_STOP_COPY.link_unverified.detail).toBe(
      "This sync did not start: we could not confirm this strategy is linked to the key you chose. Reload this page to check which key is linked before you sync again.",
    );
    const { label, detail } = PANEL_STOP_COPY.link_unverified;
    expect(`${label} ${detail}`).not.toMatch(/fail|error/i);
  });
});

describe("KCS-LATE-STARTED (167.2-REVIEW-SFH M-1): the enqueue answered after its bound, with enqueue evidence", () => {
  it("label and detail, and no failure claim", () => {
    expect(PANEL_STOP_COPY.enqueue_late_started.label).toBe("Sync started");
    expect(PANEL_STOP_COPY.enqueue_late_started.detail).toBe(
      "The sync request was accepted after this panel stopped waiting for it. Reload this page later to see its result.",
    );
    const { label, detail } = PANEL_STOP_COPY.enqueue_late_started;
    expect(`${label} ${detail}`).not.toMatch(/fail|error/i);
  });
});

describe("KCS-FINISH-UNVERIFIED (167.2-REVIEW-SFH L-1)", () => {
  it("the note a success withheld for an unverified list leaves", () => {
    expect(FINISH_UNVERIFIED_NOTE).toBe(
      "This sync finished, but the key list could not be re-read to confirm the key's status. Reload this page to see it.",
    );
  });
});
