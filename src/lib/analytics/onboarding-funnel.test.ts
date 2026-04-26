import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 11 / Plan 03 — onboarding-funnel.ts unit tests.
 *
 * Behavior under test:
 *   1. USAGE_EVENTS contains all 10 strings (5 existing + 5 new D-13 funnel events).
 *   2. maybeEmitOnboardingEvent fires + stamps when marker_at is set and emitted_at is absent.
 *   3. maybeEmitOnboardingEvent is a no-op when marker_at is absent.
 *   4. maybeEmitOnboardingEvent is a no-op when marker_at AND emitted_at are both set.
 *   5. maybeEmitOnboardingEvent does NOT throw when admin updateUserById errors (logs a warn).
 *   6. maybeEmitSignup fires once per user; subsequent calls are no-ops.
 *   7. stampOutcomeMarker writes first_outcome_at if absent; idempotent on re-call.
 *   8. isoWeekString returns the ISO week format YYYY-Www for known dates.
 *   9. When PostHog client returns null (no NEXT_PUBLIC_POSTHOG_KEY) the helper still
 *      stamps the emitted_at marker — but the trackUsageEventServer call itself is the
 *      no-op gate (verified independently in usage-events.test.ts). This test asserts
 *      the helper still completes without throwing when the inner track is a no-op.
 *
 * `import "server-only"` is stubbed (jsdom can't load it).
 */

vi.mock("server-only", () => ({}));

const trackMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./usage-events", () => ({ trackUsageEventServer: trackMock }));

import {
  maybeEmitOnboardingEvent,
  maybeEmitSignup,
  maybeEmitFirstBridgeSurfaced,
  stampOutcomeMarker,
  isoWeekString,
} from "./onboarding-funnel";
import { USAGE_EVENTS, FUNNEL_STEP } from "./usage-events-types";

// ---------------------------------------------------------------------------
// Helpers — fake admin client
// ---------------------------------------------------------------------------

type AdminAuthAdmin = {
  updateUserById: ReturnType<typeof vi.fn>;
  getUserById: ReturnType<typeof vi.fn>;
};

function makeAdmin(opts: {
  updateError?: { message: string } | null;
  getUserResult?: { user: { id: string; user_metadata: Record<string, unknown> } | null; error: { message: string } | null };
} = {}): { admin: { auth: { admin: AdminAuthAdmin } }; calls: AdminAuthAdmin } {
  const updateUserById = vi.fn().mockResolvedValue({
    error: opts.updateError ?? null,
  });
  const getUserById = vi.fn().mockResolvedValue({
    data: opts.getUserResult ?? { user: null, error: null },
    error: opts.getUserResult?.error ?? null,
  });
  const admin = {
    auth: { admin: { updateUserById, getUserById } },
  };
  return { admin, calls: { updateUserById, getUserById } };
}

function makeUser(metadata: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000aaa",
    email: "lp@example.com",
    user_metadata: metadata,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — USAGE_EVENTS extension
// ---------------------------------------------------------------------------

describe("usage-events-types USAGE_EVENTS extension", () => {
  it("contains all 5 existing + 5 new D-13 funnel events", () => {
    expect(USAGE_EVENTS).toContain("session_start");
    expect(USAGE_EVENTS).toContain("widget_viewed");
    expect(USAGE_EVENTS).toContain("intro_submitted");
    expect(USAGE_EVENTS).toContain("bridge_click");
    expect(USAGE_EVENTS).toContain("alert_acknowledged");
    expect(USAGE_EVENTS).toContain("signup");
    expect(USAGE_EVENTS).toContain("first_api_key_added");
    expect(USAGE_EVENTS).toContain("first_sync_success");
    expect(USAGE_EVENTS).toContain("first_bridge_surfaced");
    expect(USAGE_EVENTS).toContain("first_outcome_recorded");
    expect(USAGE_EVENTS.length).toBeGreaterThanOrEqual(10);
  });

  it("FUNNEL_STEP maps each marker to ordinals 1..5", () => {
    expect(FUNNEL_STEP.signup).toBe(1);
    expect(FUNNEL_STEP.first_api_key_added).toBe(2);
    expect(FUNNEL_STEP.first_sync_success).toBe(3);
    expect(FUNNEL_STEP.first_bridge_surfaced).toBe(4);
    expect(FUNNEL_STEP.first_outcome_recorded).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tests 2-5, 9 — maybeEmitOnboardingEvent
// ---------------------------------------------------------------------------

describe("maybeEmitOnboardingEvent", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    trackMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("fires + stamps emitted_at when marker_at is set and emitted_at is absent", async () => {
    const user = makeUser({
      first_api_key_added_at: "2026-04-26T10:00:00.000Z",
      cohort_week_iso: "2026-W17",
    });
    const { admin, calls } = makeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitOnboardingEvent(admin as any, user as any, "first_api_key_added");
    expect(fired).toBe(true);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "first_api_key_added",
      user.id,
      expect.objectContaining({
        funnel_step: 2,
        funnel_event_name: "first_api_key_added",
        cohort_week_iso: "2026-W17",
        stamped_at: "2026-04-26T10:00:00.000Z",
      }),
    );

    expect(calls.updateUserById).toHaveBeenCalledTimes(1);
    const [updatedUserId, updatedPayload] = calls.updateUserById.mock.calls[0];
    expect(updatedUserId).toBe(user.id);
    expect(updatedPayload.user_metadata).toMatchObject({
      first_api_key_added_at: "2026-04-26T10:00:00.000Z",
      cohort_week_iso: "2026-W17",
    });
    expect(updatedPayload.user_metadata.first_api_key_added_emitted_at).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("is a no-op when marker_at is absent", async () => {
    const user = makeUser({});
    const { admin, calls } = makeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitOnboardingEvent(admin as any, user as any, "first_api_key_added");
    expect(fired).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
  });

  it("is a no-op when marker_at AND emitted_at are both set (single-fire across requests)", async () => {
    const user = makeUser({
      first_api_key_added_at: "2026-04-26T10:00:00.000Z",
      first_api_key_added_emitted_at: "2026-04-26T10:00:01.000Z",
    });
    const { admin, calls } = makeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitOnboardingEvent(admin as any, user as any, "first_api_key_added");
    expect(fired).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
  });

  it("does NOT throw when admin updateUserById errors; logs warn instead", async () => {
    const user = makeUser({
      first_sync_success_at: "2026-04-26T10:05:00.000Z",
    });
    const { admin } = makeAdmin({ updateError: { message: "simulated update failure" } });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      maybeEmitOnboardingEvent(admin as any, user as any, "first_sync_success"),
    ).resolves.toBe(true);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain("first_sync_success");
  });

  it("completes without throwing even when the underlying track is a no-op", async () => {
    // Simulate the no-PostHog-key case — trackUsageEventServer just returns
    // undefined silently. The helper must still stamp the emitted_at marker
    // (so once a key is set later, we don't double-fire).
    trackMock.mockResolvedValueOnce(undefined);
    const user = makeUser({
      first_outcome_at: "2026-04-26T10:10:00.000Z",
    });
    const { admin, calls } = makeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitOnboardingEvent(admin as any, user as any, "first_outcome_recorded");
    expect(fired).toBe(true);
    expect(calls.updateUserById).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — maybeEmitSignup single-fire
// ---------------------------------------------------------------------------

describe("maybeEmitSignup", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    trackMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("fires the signup event with funnel_step=1 on first call; no-op afterwards", async () => {
    const user = makeUser({});
    const { admin, calls } = makeAdmin();

    // First call: fires + stamps signup_emitted_at + cohort_week_iso.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firedFirst = await maybeEmitSignup(admin as any, user as any);
    expect(firedFirst).toBe(true);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "signup",
      user.id,
      expect.objectContaining({
        funnel_step: 1,
        funnel_event_name: "signup",
        cohort_week_iso: expect.stringMatching(/^\d{4}-W\d{2}$/),
      }),
    );
    expect(calls.updateUserById).toHaveBeenCalledTimes(1);
    const updatedMeta = calls.updateUserById.mock.calls[0][1].user_metadata;
    expect(updatedMeta.signup_emitted_at).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
    expect(updatedMeta.cohort_week_iso).toEqual(expect.stringMatching(/^\d{4}-W\d{2}$/));

    // Second call (simulate that signup_emitted_at is now set on metadata).
    const userAfter = makeUser({
      signup_emitted_at: updatedMeta.signup_emitted_at,
      cohort_week_iso: updatedMeta.cohort_week_iso,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firedSecond = await maybeEmitSignup(admin as any, userAfter as any);
    expect(firedSecond).toBe(false);
    expect(trackMock).toHaveBeenCalledTimes(1); // still 1
  });
});

// ---------------------------------------------------------------------------
// Test 7 — stampOutcomeMarker idempotent
// ---------------------------------------------------------------------------

describe("stampOutcomeMarker", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    trackMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("writes first_outcome_at when absent and is idempotent on re-call", async () => {
    const userId = "00000000-0000-0000-0000-000000000aaa";

    // First call: getUserById returns metadata WITHOUT first_outcome_at — stamp writes.
    const { admin: admin1, calls: calls1 } = makeAdmin({
      getUserResult: {
        user: { id: userId, user_metadata: {} },
        error: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stampOutcomeMarker(admin1 as any, userId);
    expect(calls1.updateUserById).toHaveBeenCalledTimes(1);
    const stampedPayload = calls1.updateUserById.mock.calls[0][1].user_metadata;
    expect(stampedPayload.first_outcome_at).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );

    // Second call: getUserById now returns metadata WITH first_outcome_at — no-op (no update).
    const { admin: admin2, calls: calls2 } = makeAdmin({
      getUserResult: {
        user: {
          id: userId,
          user_metadata: { first_outcome_at: "2026-04-26T10:00:00.000Z" },
        },
        error: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await stampOutcomeMarker(admin2 as any, userId);
    expect(calls2.updateUserById).not.toHaveBeenCalled();
  });

  it("logs warn (does NOT throw) when getUserById errors", async () => {
    const userId = "00000000-0000-0000-0000-000000000aaa";
    const { admin } = makeAdmin({
      getUserResult: {
        user: null,
        error: { message: "user not found" },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(stampOutcomeMarker(admin as any, userId)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 8 — isoWeekString
// ---------------------------------------------------------------------------

describe("isoWeekString", () => {
  it("returns YYYY-Www format for a known date", () => {
    // Sunday, 26 April 2026 → ISO week 17 (Mon 20 Apr 2026 starts week 17)
    expect(isoWeekString(new Date("2026-04-26T12:00:00.000Z"))).toBe("2026-W17");
    // Monday, 4 January 2027 → ISO week 1 of 2027 (per the ISO-8601 "first Thursday" rule)
    expect(isoWeekString(new Date("2027-01-04T12:00:00.000Z"))).toBe("2027-W01");
    // Sunday, 31 December 2023 → ISO week 52 of 2023
    expect(isoWeekString(new Date("2023-12-31T12:00:00.000Z"))).toBe("2023-W52");
  });
});

// ---------------------------------------------------------------------------
// Bonus — maybeEmitFirstBridgeSurfaced
// ---------------------------------------------------------------------------

describe("maybeEmitFirstBridgeSurfaced", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    trackMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("no-ops when flaggedCount is 0", async () => {
    const user = makeUser({});
    const { admin, calls } = makeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitFirstBridgeSurfaced(admin as any, user as any, 0);
    expect(fired).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
  });

  it("fires + stamps both *_at and *_emitted_at on first surface", async () => {
    const user = makeUser({});
    const { admin, calls } = makeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitFirstBridgeSurfaced(admin as any, user as any, 3);
    expect(fired).toBe(true);
    expect(trackMock).toHaveBeenCalledWith(
      "first_bridge_surfaced",
      user.id,
      expect.objectContaining({
        funnel_step: 4,
        funnel_event_name: "first_bridge_surfaced",
      }),
    );
    expect(calls.updateUserById).toHaveBeenCalledTimes(1);
    const meta = calls.updateUserById.mock.calls[0][1].user_metadata;
    expect(meta.first_bridge_surfaced_at).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
    expect(meta.first_bridge_surfaced_emitted_at).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it("is a no-op when first_bridge_surfaced_emitted_at is already set (single-fire)", async () => {
    const user = makeUser({
      first_bridge_surfaced_at: "2026-04-26T10:00:00.000Z",
      first_bridge_surfaced_emitted_at: "2026-04-26T10:00:01.000Z",
    });
    const { admin, calls } = makeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fired = await maybeEmitFirstBridgeSurfaced(admin as any, user as any, 5);
    expect(fired).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
    expect(calls.updateUserById).not.toHaveBeenCalled();
  });
});
