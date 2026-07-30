/**
 * Phase 140.3-12 / TS-17 — the anonymous teaser renders the rejection it
 * actually receives.
 *
 * ⚠️ THIS FILE DID NOT EXIST BEFORE THIS PLAN. That is the finding, not an
 * aside: `VerificationForm.tsx` renders an UNAUTHENTICATED surface, it is the
 * only consumer of `/api/verify-strategy`, and nothing in the repo exercised
 * its error path. Same shape as 140.3-11's M77b, where the second consumer had
 * no oracle that *could* have failed.
 *
 * The defect: the seam's rejection envelope is
 * `{ok:false, code, human_message, correlation_id, recoverable}` and carries NO
 * `error` key, so `data.error ?? "Verification failed"` always fell through.
 * A user whose key was rejected for being write-capable — a specific,
 * actionable verdict — was told only "Verification failed".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VerificationForm, safeHumanMessage } from "./VerificationForm";

afterEach(() => {
  vi.restoreAllMocks();
  // This repo's known CI-only failure mode (CI Node 22 vs local Node 25) is a
  // leaked global stub. Unstub unconditionally.
  vi.unstubAllGlobals();
});

/** Fills the required fields and submits. */
async function submitForm() {
  fireEvent.change(screen.getByLabelText(/API Key/i), {
    target: { value: "test-key" },
  });
  fireEvent.change(screen.getByLabelText(/API Secret/i), {
    target: { value: "test-secret" },
  });
  fireEvent.change(screen.getByLabelText(/Email/i), {
    target: { value: "someone@example.com" },
  });
  fireEvent.submit(screen.getByRole("button", { name: /Verify My Strategy/i }));
}

/** The real 403 envelope shape, hand-typed from process-key-client's contract. */
function rejection(human_message: string) {
  return new Response(
    JSON.stringify({
      ok: false,
      code: "PERMISSION_DENIED",
      human_message,
      correlation_id: "cid-140312",
      recoverable: false,
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

describe("[140.3-12 / TS-17] the teaser renders the rejection's own message", () => {
  it("a 403 carrying ONLY human_message renders that message, not the generic string", async () => {
    // The real verdict this obligation is about: a write-capable key.
    const verdict =
      "This key can place orders. Create a read-only key and try again.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rejection(verdict));

    render(<VerificationForm onResult={vi.fn()} />);
    await submitForm();

    expect(
      await screen.findByText(verdict),
      "The 403 envelope has no `error` key, so reading `data.error` first " +
        "always fell through to the generic copy and discarded a specific, " +
        "actionable verdict.",
    ).toBeInTheDocument();
    expect(screen.queryByText("Verification failed")).toBeNull();
  });

  it("a body with NEITHER field still renders the generic fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, code: "SOMETHING" }), {
        status: 403,
      }),
    );

    render(<VerificationForm onResult={vi.fn()} />);
    await submitForm();

    expect(await screen.findByText("Verification failed")).toBeInTheDocument();
  });

  it("this route's OWN arms still render their `error` key", async () => {
    // `data.error` is kept as the SECOND reader, not deleted: verify-strategy's
    // own 400/502 arms emit `{error}` and have no human_message.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
      }),
    );

    render(<VerificationForm onResult={vi.fn()} />);
    await submitForm();

    expect(
      await screen.findByText("Invalid email address"),
    ).toBeInTheDocument();
  });

  it("nothing internal reaches an anonymous browser (T-140-08)", async () => {
    // ⚠️ NOT hypothetical. `process-key-client.ts` forwards a non-2xx upstream
    // body VERBATIM, Python's `_envelope_error` does not sanitise, and
    // `human_message` is filled from sources that pass raw text
    // (`okx.py` → `result.get("error")`, `csv_adapter.py` → `str(exc)`).
    const leaky =
      'Traceback (most recent call last): File "/app/services/exchange.py", ' +
      "line 402, in validate — ConnectionError to https://analytics.internal:8001 (500)";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rejection(leaky));

    render(<VerificationForm onResult={vi.fn()} />);
    await submitForm();

    const rendered = await screen.findByText("Verification failed");
    expect(
      rendered,
      "An upstream fault body must degrade to our own copy, never render.",
    ).toBeInTheDocument();

    const body = document.body.textContent ?? "";
    expect(body).not.toContain("http");
    expect(body).not.toContain("analytics.internal");
    expect(body).not.toContain("Traceback");
    expect(body).not.toMatch(/\b[1-5]\d{2}\b/);
  });
});

describe("[140.3-12 / TS-17] safeHumanMessage is a SHAPE guard, not an allow-list", () => {
  it("passes an ordinary curated verdict through untouched", () => {
    // The load-bearing positive. A guard that rejected everything would make
    // every assertion about disclosure pass while re-creating the exact defect
    // TS-17 exists to fix — a real rejection rendering as "Verification failed".
    expect(
      safeHumanMessage(
        "This key can place orders. Create a read-only key and try again.",
      ),
    ).toBe("This key can place orders. Create a read-only key and try again.");
    expect(safeHumanMessage("  Your API secret is not valid.  ")).toBe(
      "Your API secret is not valid.",
    );
  });

  it.each([
    ["a URL", "Upstream failed: https://analytics.example.com/process-key"],
    ["a scheme", "redis://cache:6379 refused the connection"],
    ["a hostname", "could not reach analytics.internal"],
    ["localhost", "connection refused by localhost"],
    ["an IP", "no route to 10.0.0.14"],
    ["a bare status", "the service answered 502"],
    ["a traceback", 'Traceback (most recent call last): File "app.py"'],
  ])("refuses %s", (_label, value) => {
    expect(safeHumanMessage(value)).toBeNull();
  });

  it.each([
    ["a non-string", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", { toString: () => "pwned" }],
    ["an empty string", "   "],
  ])("refuses %s", (_label, value) => {
    expect(safeHumanMessage(value)).toBeNull();
  });

  it("refuses an over-long message — an exception body is not a sentence", () => {
    // Boundary pinned on BOTH sides so the bound is a bound, not a ban.
    expect(safeHumanMessage("a".repeat(200))).toBe("a".repeat(200));
    expect(safeHumanMessage("a".repeat(201))).toBeNull();
  });
});
