/**
 * 151 review E6 — THE RETRY HANDLER ITSELF, not just the rendered control.
 *
 * `AllocateDialog.test.tsx` asserts the user-visible outcome: no Retry button
 * for the mark-flipped 409. That assertion passes for TWO different reasons —
 * because the dialog withholds `onRetry`, and because `ErrorEnvelope` gates its
 * control on `envelope.recoverable && Boolean(onRetry)`. The second reason alone
 * is enough to keep it green, so it cannot see a dialog that hands a live retry
 * handler to a refusal the server will decline identically forever. A renderer
 * change that reads only `onRetry` would then resurrect the dead button with
 * every existing test green.
 *
 * This file closes that gap by observing the PROP CONTRACT directly: the
 * envelope renderer is replaced with a probe that records what it was given.
 * Both directions are asserted — a non-recoverable envelope gets NO handler, a
 * recoverable one still gets a working one — because a guard that degrades into
 * "this surface never retries" is a different defect, not a fix.
 *
 * Kept in its own file because the module mock is file-scoped: the sibling spec
 * deliberately renders the REAL envelope, and mocking it there would take its
 * copy and code assertions dark.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const envelopeProps = vi.hoisted(
  () => [] as Array<{ code: string; recoverable: boolean; onRetry: unknown }>,
);

vi.mock("@/components/error/ErrorEnvelope", () => ({
  ErrorEnvelope: (props: {
    envelope: { code: string; recoverable: boolean };
    onRetry?: () => void;
  }) => {
    envelopeProps.push({
      code: props.envelope.code,
      recoverable: props.envelope.recoverable,
      onRetry: props.onRetry,
    });
    return (
      <div data-testid="envelope-probe" data-error-code={props.envelope.code}>
        {/* The probe exposes the handler so the recoverable direction can prove
            the one it received actually re-issues the write. */}
        {props.onRetry ? (
          <button type="button" onClick={props.onRetry}>
            probe-retry
          </button>
        ) : null}
      </div>
    );
  },
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: (...args: unknown[]) => refresh(...args),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { AllocateDialog } from "./AllocateDialog";

// jsdom lacks HTMLDialogElement.showModal()/close(); the Modal primitive calls
// them from a useEffect when `open` is true (Modal.test.tsx:23-39).
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

/** `fetch` is spied (never stubGlobal — a leaked stub reddens CI only). */
let fetchSpy: ReturnType<typeof vi.spyOn>;

function failResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

const onClose = vi.fn();

beforeEach(() => {
  envelopeProps.length = 0;
  refresh.mockClear();
  onClose.mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderEdit() {
  return render(
    <AllocateDialog
      open
      onClose={onClose}
      mode="edit"
      strategyId="strat-1"
      strategyName="Black Swan"
      currentAmount={120_000}
    />,
  );
}

describe("<AllocateDialog> — the retry handler is withheld from unretryable failures", () => {
  it("[E6] a mark-flipped 409 reaches the renderer with NO onRetry at all", async () => {
    fetchSpy.mockResolvedValue(failResponse(409, { error: "not_allocatable" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    await screen.findByTestId("envelope-probe");
    const last = envelopeProps.at(-1)!;
    expect(last.code).toBe("ALLOCATION_NOT_ALLOCATABLE");
    expect(last.recoverable).toBe(false);
    // THE assertion: not merely "the button did not render", but "no handler
    // was handed over for a renderer to find".
    expect(last.onRetry).toBeUndefined();
    expect(screen.queryByRole("button", { name: "probe-retry" })).toBeNull();
  });

  it("[E6 control] a retryable failure still receives a handler that re-issues the write", async () => {
    fetchSpy.mockResolvedValue(failResponse(500, { error: "internal error" }));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save allocation" }));

    await screen.findByTestId("envelope-probe");
    const last = envelopeProps.at(-1)!;
    expect(last.code).toBe("UNKNOWN");
    expect(last.recoverable).toBe(true);
    expect(typeof last.onRetry).toBe("function");

    fireEvent.click(screen.getByRole("button", { name: "probe-retry" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});
