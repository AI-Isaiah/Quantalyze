/**
 * Phase 167 CREDTRUST / D-16 — the UNTRUSTED-KEY-STATUS closed set.
 *
 * WHY THIS EXISTS, measured. Before this set the holdings and open-positions
 * surfaces decided "is this row's source key healthy?" with SEVEN hand-kept
 * equalities against the single literal `revoked` — six in `HoldingsTable.tsx`
 * and one in `OpenPositionsTable.tsx`. There was no allow-list, no enum and no
 * closed set over `api_keys.sync_status` anywhere, so **every status that was
 * not `revoked` defaulted to the healthy branch**. Once plan 167-04 made the
 * worker write `sign_in_failed`, a holding sourced from a key the venue has
 * stopped accepting would have rendered un-chipped, un-filtered and counted in
 * the headline AUM — the exact false-confidence failure the phase exists to
 * remove, reproduced one surface over.
 *
 * ⛔ THE EQUALITY *SHAPE* IS THE DEFECT, NOT THE MISSING VALUE. A fix that
 * appended `|| status === "sign_in_failed"` beside each `=== "revoked"` would
 * reproduce it for the tenth status. So the assertions below are about the
 * DEFAULT — an unknown status must not silently reach the trusted branch by
 * anyone forgetting a site — and about the chip label being TOTAL over the
 * set, not about the two members that happen to be in it today.
 *
 * ORACLE INDEPENDENCE: the chip labels are typed here as literals and are
 * deliberately NOT imported from the label map they pin. A test that reads its
 * expectation out of the thing under test cannot fail when that thing drifts.
 * These two strings are the ALREADY-SHIPPED vocabulary — "Key revoked" is the
 * byte-unchanged Phase 08 MANAGE-02 chip, "Sign-in failed" is the pill label
 * plan 167-03 shipped in `AllocatorSyncStatus` — so this file is also the pin
 * that stops a third vocabulary being invented for the same two states.
 */
import { describe, it, expect } from "vitest";
import {
  UNTRUSTED_KEY_SYNC_STATUSES,
  isUntrustedKeySyncStatus,
  untrustedKeyChipLabel,
} from "./closed-sets";

/** Typed independently of the source. See ORACLE INDEPENDENCE above. */
const EXPECTED_CHIP_LABELS: Record<string, string> = {
  revoked: "Key revoked",
  sign_in_failed: "Sign-in failed",
};

/**
 * Every OTHER value `api_keys.sync_status` can hold, per the CHECK constraint
 * as migration 20260922120000 left it. Typed by hand so that a future widening
 * of the constraint does not silently widen this control too.
 */
const TRUSTED_OR_NEUTRAL_STATUSES = [
  "idle",
  "syncing",
  "computing",
  "complete",
  "complete_with_warnings",
  "error",
  "rate_limited",
];

describe("[D-16] untrusted-key sync_status closed set", () => {
  it("the set is non-empty and every member is chipped — anti-vacuity first", () => {
    // Without this, every assertion below could pass over an empty set.
    expect(UNTRUSTED_KEY_SYNC_STATUSES.length).toBeGreaterThan(0);
    for (const status of UNTRUSTED_KEY_SYNC_STATUSES) {
      expect(isUntrustedKeySyncStatus(status)).toBe(true);
      // TOTALITY: a member with no label would render an EMPTY chip — visible
      // as a coloured blank, silent to every type check, because the label map
      // is only keyable at compile time.
      const label = untrustedKeyChipLabel(status);
      expect(label).toBeTruthy();
      expect(label).toBe(EXPECTED_CHIP_LABELS[status]);
    }
  });

  it("names BOTH measured states — the venue's assertion and our own failure", () => {
    // `revoked` = the venue ASSERTED the rejection. `sign_in_failed` = we could
    // not sign in and cannot say why. Two different claims, one shared
    // consequence: this key's data is not to be trusted as current.
    expect([...UNTRUSTED_KEY_SYNC_STATUSES].sort()).toEqual([
      "revoked",
      "sign_in_failed",
    ]);
  });

  it("does NOT swallow the healthy / in-flight statuses", () => {
    for (const status of TRUSTED_OR_NEUTRAL_STATUSES) {
      expect(isUntrustedKeySyncStatus(status)).toBe(false);
      expect(untrustedKeyChipLabel(status)).toBeNull();
    }
  });

  it("a status nobody has heard of is NOT untrusted — the predicate must not fail open either", () => {
    // Symmetry control for the case above: the fix for "everything defaults to
    // trusted" must not be "everything defaults to untrusted", which would
    // strike through a healthy book on a value drift.
    expect(isUntrustedKeySyncStatus("a-status-invented-later")).toBe(false);
    expect(isUntrustedKeySyncStatus(null)).toBe(false);
    expect(isUntrustedKeySyncStatus(undefined)).toBe(false);
    expect(isUntrustedKeySyncStatus("")).toBe(false);
    expect(untrustedKeyChipLabel(null)).toBeNull();
    expect(untrustedKeyChipLabel(undefined)).toBeNull();
  });
});
