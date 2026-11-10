/**
 * WHY this exists: the factsheet's action set (Add to my allocation, Request
 * intro, Edit strategy) is an affordance decided by role PLUS approval, and a
 * profile read that fails must never grant one. A wrong "can allocate" shows a
 * button a manager or an unapproved account cannot use; a wrong "owner" shows
 * Edit strategy to a stranger. Oracles are typed here by hand, never imported
 * from the module under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const captureToSentry = vi.fn();
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureToSentry(...args),
}));

import { resolveFactsheetViewer } from "./viewer";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

type ProfileResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

const ATTESTED: ProfileResult = { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null };

function client(result: ProfileResult | Error, attestation: ProfileResult | Error = ATTESTED) {
  const eq = vi.fn();
  const select = vi.fn();
  const from = vi.fn();
  const chainFor = (r: ProfileResult | Error) => {
    const chain = {
      select: (cols: string) => {
        select(cols);
        return chain;
      },
      eq: (col: string, val: string) => {
        eq(col, val);
        return chain;
      },
      maybeSingle: () => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)),
    };
    return chain;
  };
  from.mockImplementation((table: string) =>
    chainFor(table === "investor_attestations" ? attestation : result),
  );
  return { supabase: { from } as unknown as SupabaseClient, from, select, eq };
}

const profile = (over: Record<string, unknown>) => ({
  data: { role: "allocator", allocator_status: "verified", manager_status: "newbie", is_admin: false, ...over },
  error: null,
});

beforeEach(() => captureToSentry.mockReset());

describe("resolveFactsheetViewer", () => {
  it("no session is anon and reads nothing", async () => {
    const { supabase, from } = client(profile({}));
    expect(await resolveFactsheetViewer(supabase, null, OWNER)).toEqual({ kind: "anon" });
    expect(from).not.toHaveBeenCalled();
  });

  it("the owner is the owner and never an allocator, even when an approved allocator", async () => {
    const { supabase } = client(profile({}));
    expect(await resolveFactsheetViewer(supabase, { id: OWNER }, OWNER)).toEqual({
      kind: "signed_in",
      userId: OWNER,
      isOwner: true,
      canAllocate: false,
      needsAttestation: false,
    });
  });

  it("an approved allocator who is not the owner can allocate, and the read is keyed on the user's id", async () => {
    const { supabase, from, eq } = client(profile({}));
    expect(await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER)).toEqual({
      kind: "signed_in",
      userId: VIEWER,
      isOwner: false,
      canAllocate: true,
      needsAttestation: false,
    });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", VIEWER);
  });

  it("an approved both-role viewer can allocate", async () => {
    const { supabase } = client(profile({ role: "both", manager_status: "verified" }));
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ isOwner: false, canAllocate: true });
  });

  it.each([
    ["unapproved allocator", profile({ allocator_status: "newbie" })],
    ["both with only one side verified", profile({ role: "both", manager_status: "newbie" })],
    ["approved manager", profile({ role: "manager", allocator_status: "newbie", manager_status: "verified" })],
    ["admin with role manager", profile({ role: "manager", is_admin: true })],
    ["unknown role", profile({ role: "visitor" })],
    ["missing profile row", { data: null, error: null }],
  ])("%s cannot allocate", async (_label, result) => {
    const { supabase } = client(result as ProfileResult);
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ kind: "signed_in", isOwner: false, canAllocate: false });
  });

  it("a read error fails closed and is reported, never granting the action", async () => {
    const { supabase } = client({ data: null, error: { message: "boom" } });
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ isOwner: false, canAllocate: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(captureToSentry.mock.calls[0][1].tags.area).toBe("factsheet-viewer");
  });

  it("a thrown read fails closed and is reported", async () => {
    const { supabase } = client(new Error("exploded"));
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ isOwner: false, canAllocate: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  // CR-01: the discovery layout refuses a user with no `investor_attestations`
  // row, and the intro / allocate actions lived only behind it. These arms pin
  // that the factsheet affordance carries the same test, failing closed.
  it.each([
    ["no attestation row", { data: null, error: null }],
    ["a row with a null attested_at", { data: { attested_at: null }, error: null }],
  ])("an approved allocator with %s cannot allocate", async (_label, att) => {
    const { supabase, from, eq } = client(profile({}), att as ProfileResult);
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ kind: "signed_in", isOwner: false, canAllocate: false });
    expect(from).toHaveBeenCalledWith("investor_attestations");
    expect(eq).toHaveBeenCalledWith("user_id", VIEWER);
  });

  it("an attestation read error fails closed and is reported", async () => {
    const { supabase } = client(profile({}), { data: null, error: { message: "boom" } });
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ isOwner: false, canAllocate: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(captureToSentry.mock.calls[0][1].tags).toMatchObject({
      area: "factsheet-viewer",
      stage: "attestation-read",
    });
  });

  // 194.2 D-04 / D-07: the unattested allocator is offered the attest step, keyed
  // on a SUCCESSFUL read finding no usable row, never on `!canAllocate`.
  it.each([
    ["no attestation row", { data: null, error: null }],
    ["a row with a null attested_at", { data: { attested_at: null }, error: null }],
  ])("an approved allocator with %s needs attestation and still cannot allocate", async (_label, att) => {
    const { supabase } = client(profile({}), att as ProfileResult);
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toEqual({
      kind: "signed_in",
      userId: VIEWER,
      isOwner: false,
      canAllocate: false,
      needsAttestation: true,
    });
  });

  it("an approved both-role viewer with no attestation row needs attestation", async () => {
    const { supabase } = client(profile({ role: "both", manager_status: "verified" }), {
      data: null,
      error: null,
    });
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ canAllocate: false, needsAttestation: true });
  });

  it("an attested allocator can allocate and needs no attestation", async () => {
    const { supabase } = client(profile({}));
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ canAllocate: true, needsAttestation: false });
  });

  it.each([
    ["unapproved allocator", profile({ allocator_status: "newbie" })],
    ["approved manager", profile({ role: "manager", allocator_status: "newbie", manager_status: "verified" })],
    ["missing profile row", { data: null, error: null }],
    ["profile read error", { data: null, error: { message: "boom" } }],
  ])("%s with no attestation row is never offered the attest step", async (_label, result) => {
    const { supabase } = client(result as ProfileResult, { data: null, error: null });
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ canAllocate: false, needsAttestation: false });
  });

  it("an attestation read error or throw is not the needs-attestation state (no prompt that could re-attest an attested user)", async () => {
    const errored = client(profile({}), { data: null, error: { message: "boom" } });
    expect(
      await resolveFactsheetViewer(errored.supabase, { id: VIEWER }, OWNER),
    ).toMatchObject({ canAllocate: false, needsAttestation: false });
    const thrown = client(profile({}), new Error("exploded"));
    expect(
      await resolveFactsheetViewer(thrown.supabase, { id: VIEWER }, OWNER),
    ).toMatchObject({ canAllocate: false, needsAttestation: false });
  });

  it("a thrown attestation read fails closed and is reported", async () => {
    const { supabase } = client(profile({}), new Error("exploded"));
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, OWNER);
    expect(v).toMatchObject({ isOwner: false, canAllocate: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("the owner needs no attestation read", async () => {
    const { supabase, from } = client(profile({}), { data: null, error: null });
    await resolveFactsheetViewer(supabase, { id: OWNER }, OWNER);
    expect(from).not.toHaveBeenCalled();
  });

  it("a strategy with no owner id never makes the viewer the owner", async () => {
    const { supabase } = client(profile({}));
    const v = await resolveFactsheetViewer(supabase, { id: VIEWER }, undefined);
    expect(v).toMatchObject({ isOwner: false });
  });
});
