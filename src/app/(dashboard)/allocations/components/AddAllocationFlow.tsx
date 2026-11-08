"use client";

/**
 * Phase 198 plan 05 — the allocator's "+ Allocation" flow (D-03, ROUTE-06, SC-1).
 *
 * A right-hand slide-over with two steps: pick a strategy, then enter an amount
 * (and a date when the route takes one). It reuses the existing allocation
 * routes, so there is no new endpoint, and it never mounts the manager's
 * wizard or the contribution overlay. Plan 198-08 mounts it on every tab,
 * wires `?add=`, owns the live region and returns focus to the header button.
 *
 * WHAT IS DECIDED WHERE. Which route a pick is written through, the body, the
 * refusals, the date window, the held set, the deep-link resolution and the copy
 * are all in `../lib/add-allocation.ts` (pure, tested without a DOM). This file
 * renders, focuses and posts what that module says.
 *
 * C2: the picker rows carry NO trust tier and NO manager. The browse read carries
 * neither, and joining them client-side would widen disclosure for no gain.
 *
 * The shell follows `StrategyBrowseDrawer` (portal, backdrop, 620px panel, Esc,
 * fetch on each open with the H-0117 loud-fail). Row test ids are the
 * `add-allocation-*` family: never the Browse drawer's per-row family, whose first-match automation
 * contract is the PR #620 collision guard.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import {
  buildEnvelope,
  type ErrorEnvelope as ErrorEnvelopeType,
} from "@/lib/envelope";
import { newCorrelationId } from "@/lib/correlation-id-client";
import { formatUsd } from "@/lib/dollar-validation";
import { formatPercent } from "@/lib/utils";
import { YoursChip } from "./YoursChip";
import { envelopeForResponse, parseAmount } from "./AllocateDialog";
import { generateIdempotencyKey } from "./ScenarioCommitDrawer";
import {
  buildAllocationRequest,
  commitSucceeded,
  earliestAllocationDateIso,
  resolveDeepLink,
  successAnnouncement,
  todayUtcIso,
  validateAllocationDate,
  type AllocationRequest,
} from "../lib/add-allocation";
import type { StrategyBrowseRow } from "./StrategyBrowseDrawer";

export type DeepLinkInvalidReason =
  | "malformed"
  | "unlisted"
  | "unlisted_truncated";

export interface AddAllocationFlowProps {
  open: boolean;
  onClose: () => void;
  /** Called once with the success line, just before `onClose`. The host owns the live region. */
  onRecorded: (announcement: string) => void;
  /** The raw `?add=` value, or null when the flow was opened without one. */
  deepLink: { raw: string } | null;
  onInvalidDeepLink?: (reason: DeepLinkInvalidReason) => void;
  /** Strategies already in the book (Holdings plus allocated outcomes). */
  heldStrategyIds: ReadonlySet<string>;
  /**
   * Own strategies marked as the allocator's own capital. When given, an own row
   * outside it is shown as not selectable: the allocation route refuses it with a
   * 409 every time. Omitted when that read failed, so a blip never disables rows.
   */
  ownCapitalStrategyIds?: ReadonlySet<string>;
  bookEquityUsd: number | null;
  allKeysStale: boolean;
  /** Test seam; defaults to `GET /api/strategies/browse`. */
  fetchStrategies?: () => Promise<{
    strategies: StrategyBrowseRow[];
    hasMore: boolean;
  }>;
}

// ─────────────────────────────────────────────────────────────────────── copy

const TITLE = "Add allocation";
const TITLE_ID = "add-allocation-title";
const STEP_1_EYEBROW = "Step 1 of 2 · Strategy";
const STEP_2_EYEBROW = "Step 2 of 2 · Amount and date";
const AMOUNT_LABEL = "Allocation (USD)";
// The commit route's 422 `error` for a key reused with another body
// (src/app/api/allocator/scenario/commit/route.ts); a rolled-back batch has none.
const IDEMPOTENCY_BODY_MISMATCH_ERROR = "Idempotency-Key reuse with different body";
const HELD_ROW_CAPTION = "Already in your book. Change its amount on Holdings.";
const NOT_OWN_CAPITAL_CAPTION =
  "Not marked as your own capital. Mark it on My Strategies first.";
const NOT_AVAILABLE_NOTICE =
  "That strategy is not available to add. Search for another below.";
const NOT_LOADED_NOTICE =
  "That strategy is past the first 200 we list here, so it cannot be added from this list yet.";

// ────────────────────────────────────────────────────────────────────── styles

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const INPUT_CLASS = `min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary transition-colors focus-visible:border-border-focus ${FOCUS_RING} aria-[invalid=true]:border-negative`;
const LINK_CLASS = `text-accent underline-offset-2 hover:underline ${FOCUS_RING}`;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The enter animation only. It is off under reduced motion, and the panel
// unmounts at once on close (the sibling drawers do the same), which keeps the
// one-dialog-in-the-DOM and focus-return invariants deterministic.
const ANIMATION_CSS = `
@keyframes aa-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes aa-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
.aa-backdrop { animation: aa-fade 250ms ease-out; }
.aa-panel { animation: aa-slide 250ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .aa-backdrop, .aa-panel { animation: none; }
}`;

// ──────────────────────────────────────────────────────────────── list read

class BrowseReadError extends Error {
  constructor(readonly status: number) {
    super(`Failed to load strategies (${status})`);
  }
}

async function readBrowseList(
  signal: AbortSignal,
): Promise<{ strategies: StrategyBrowseRow[]; hasMore: boolean }> {
  const res = await fetch("/api/strategies/browse", { signal });
  if (!res.ok) throw new BrowseReadError(res.status);
  const json = (await res.json()) as {
    strategies?: StrategyBrowseRow[];
    has_more?: boolean;
  };
  return { strategies: json.strategies ?? [], hasMore: json.has_more === true };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; envelope: ErrorEnvelopeType };

type Notice =
  | { kind: "held"; name: string }
  | { kind: "unavailable" }
  | { kind: "not_loaded" };

// ───────────────────────────────────────────────────────────────── component

export function AddAllocationFlow(props: AddAllocationFlowProps) {
  // The panel is a separate component that MOUNTS per open, so every open starts
  // from fresh state and a fresh list read (never cached across opens), and no
  // reset effect is needed. `document` is absent on the server render.
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<AddAllocationPanel {...props} />, document.body);
}

function AddAllocationPanel({
  onClose,
  onRecorded,
  deepLink,
  onInvalidDeepLink,
  heldStrategyIds,
  ownCapitalStrategyIds,
  bookEquityUsd,
  allKeysStale,
  fetchStrategies,
}: AddAllocationFlowProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rows, setRows] = useState<StrategyBrowseRow[]>([]);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"pick" | "amount">("pick");
  const [selected, setSelected] = useState<StrategyBrowseRow | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayUtcIso());
  // D-12 reveal rule: a field is red only after a refused submit, and the
  // keystroke that fixes it clears it. `null` is silence.
  const [amountError, setAmountError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<ErrorEnvelopeType | null>(null);
  const [busy, setBusy] = useState(false);
  // The ref is the double-submit fence: `busy` state lags a rapid second click
  // by a render, the ref does not.
  const inFlightRef = useRef(false);
  // RESEARCH P2: one key per attempt. Minted on the first submit of an attempt,
  // reused on Retry, dropped whenever the strategy, amount or date changes. The
  // exact request body is kept WITH the key: the route binds a key to a hash of
  // its body, and the body carries a percent of the live Book equity, which the
  // 30s refresh moves. A Retry that rebuilt it would answer 422 body-mismatch for
  // a write that had in fact landed.
  const idempotencyKeyRef = useRef<{ key: string; body: string } | null>(null);

  // What the async list read needs at settle time, without making the effect
  // refetch whenever the host hands in a new Set or callback identity.
  const latest = useRef({ deepLink, heldStrategyIds, onInvalidDeepLink });
  useEffect(() => {
    latest.current = { deepLink, heldStrategyIds, onInvalidDeepLink };
  });
  const deepLinkResolvedRef = useRef(false);

  // Fetch on open, once per mount, with the H-0117 loud-fail: `cancelled` is the
  // only signal that an abort was our own cleanup. Any other rejection,
  // AbortError included, is a genuine load failure and must surface.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const loader = fetchStrategies ?? (() => readBrowseList(controller.signal));
    loader()
      .then(({ strategies, hasMore }) => {
        if (cancelled) return;
        setRows(strategies);
        setLoadState({ kind: "ready" });
        // The deep link is resolved once, after the list settles. The URL id is
        // never trusted: it is checked against the server-produced list.
        if (deepLinkResolvedRef.current) return;
        deepLinkResolvedRef.current = true;
        const { deepLink: dl, heldStrategyIds: held, onInvalidDeepLink: report } =
          latest.current;
        if (!dl) return;
        const resolution = resolveDeepLink(dl.raw, strategies, hasMore, held);
        switch (resolution.kind) {
          case "none":
            return;
          case "prefill":
            setSelected(resolution.row);
            setStep("amount");
            return;
          case "held":
            setNotice({ kind: "held", name: resolution.row.name });
            return;
          case "not_loaded":
            setNotice({ kind: "not_loaded" });
            report?.("unlisted_truncated");
            return;
          case "unavailable":
            setNotice({ kind: "unavailable" });
            report?.(resolution.reason);
            return;
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("[AddAllocationFlow] strategy load failed", e);
        const code =
          e instanceof BrowseReadError && e.status === 429
            ? "RATE_LIMITED"
            : "UNKNOWN";
        setLoadState({
          kind: "error",
          envelope: buildEnvelope(code, newCorrelationId("browse")),
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchStrategies, reloadNonce]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !inFlightRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus trap: Tab cycles inside the panel while it is open.
  useEffect(() => {
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const container = panelRef.current;
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => document.removeEventListener("keydown", onTab);
  }, []);

  // Focus follows the step: the search box on step 1, the amount on step 2.
  useEffect(() => {
    if (step === "amount") amountRef.current?.focus();
    else searchRef.current?.focus();
  }, [step]);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      query === ""
        ? rows
        : rows.filter(
            (r) =>
              r.name.toLowerCase().includes(query) ||
              (r.codename ?? "").toLowerCase().includes(query),
          ),
    [rows, query],
  );

  function requestClose() {
    if (!inFlightRef.current) onClose();
  }

  function notOwnCapital(row: StrategyBrowseRow) {
    return (
      row.isOwn === true &&
      // The own-capital set omits archived strategies, so it cannot decide
      // them; the route's 409 still refuses an unmarked one (review R3-02).
      row.status !== "archived" &&
      ownCapitalStrategyIds !== undefined &&
      !ownCapitalStrategyIds.has(row.id)
    );
  }

  function choose(row: StrategyBrowseRow) {
    if (heldStrategyIds.has(row.id) || notOwnCapital(row)) return;
    setSelected(row);
    setNotice(null);
    setAmount("");
    setDate(todayUtcIso());
    setAmountError(null);
    setDateError(null);
    setEnvelope(null);
    idempotencyKeyRef.current = null;
    setStep("amount");
  }

  /** The amount field's current refusal, from the one pure dispatch. */
  function amountProblem(rawAmount: string): string | null {
    if (!selected) return null;
    const req = buildAllocationRequest({
      row: selected,
      amountUsd: rawAmount.trim() === "" ? Number.NaN : Number(rawAmount),
      dateIso: date,
      bookEquityUsd,
      allKeysStale,
    });
    return req.ok ? null : req.message;
  }

  async function postAllocation(
    req: Extract<AllocationRequest, { ok: true }>,
    correlationId: string,
  ): Promise<ErrorEnvelopeType | null> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Correlation-Id": correlationId,
    };
    if (req.idempotent) {
      idempotencyKeyRef.current ??= {
        key: generateIdempotencyKey(),
        body: JSON.stringify(req.body),
      };
      headers["Idempotency-Key"] = idempotencyKeyRef.current.key;
    }
    let res: Response;
    try {
      res = await fetch(req.route, {
        method: "POST",
        headers,
        body: idempotencyKeyRef.current?.body ?? JSON.stringify(req.body),
      });
    } catch (e) {
      // Offline or aborted: the request never reached a status, so retrying on
      // the same key is safe (the route dedups on it).
      console.error("[AddAllocationFlow] allocation request failed before a status", e);
      return buildEnvelope("UNKNOWN", correlationId);
    }
    if (!req.idempotent) {
      if (res.ok) return null;
      // The mark flipped (or was never own capital): ALLOCATION_NOT_ALLOCATABLE
      // promises "the list reloads", so reload it, as AllocateDialog does.
      if (res.status === 409) router.refresh();
      const body = await res.json().catch(() => null);
      return envelopeForResponse(res, correlationId, body);
    }
    if (res.status === 429) return envelopeForResponse(res, correlationId, null);
    // A 422 reading "reused with different body" proves nothing: it means an
    // earlier send under this key landed, so it can never say "nothing was saved".
    if (res.status === 422) {
      const refused = await res.json().catch(() => null);
      if (refused?.error === IDEMPOTENCY_BODY_MISMATCH_ERROR) {
        return buildEnvelope("DASHBOARD_WRITE_INDETERMINATE", correlationId);
      }
    }
    // The commit route answers 400 (body or key refused), 401/403 (auth) and 422
    // (batch rolled back) before or instead
    // of writing, so those say nothing was saved and offer no Retry. 409
    // (in-flight), 5xx and anything else cannot prove either way: they offer
    // Retry, which re-sends the SAME Idempotency-Key, so the route's dedup keeps
    // a second send from recording twice.
    if (res.status === 400 || res.status === 422) {
      return buildEnvelope("DASHBOARD_REQUEST_INVALID", correlationId);
    }
    if (res.status === 401 || res.status === 403) {
      return buildEnvelope("DASHBOARD_SIGNED_OUT", correlationId);
    }
    if (!res.ok) return buildEnvelope("UNKNOWN", correlationId);
    // A 200 is parsed on its own, so a non-JSON body is a failure of the answer
    // and not a network error. Success is the strict gate; a 200 that cannot
    // prove one recorded row never claims either outcome
    // (DASHBOARD_WRITE_INDETERMINATE).
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      return buildEnvelope("DASHBOARD_WRITE_INDETERMINATE", correlationId);
    }
    return commitSucceeded(raw)
      ? null
      : buildEnvelope("DASHBOARD_WRITE_INDETERMINATE", correlationId);
  }

  async function submit() {
    if (inFlightRef.current || !selected) return;
    const isOwn = selected.isOwn === true;
    const amountUsd = amount.trim() === "" ? Number.NaN : Number(amount);
    const req = buildAllocationRequest({
      row: selected,
      amountUsd,
      dateIso: date,
      bookEquityUsd,
      allKeysStale,
    });
    // Only someone else's strategy carries a date (C4); the own route has none.
    const dateProblem = isOwn ? null : validateAllocationDate(date, todayUtcIso());
    setAmountError(req.ok ? null : req.message);
    setDateError(dateProblem);
    if (!req.ok) {
      amountRef.current?.focus();
      return;
    }
    if (dateProblem !== null) {
      dateRef.current?.focus();
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    setEnvelope(null);
    const failure = await postAllocation(req, newCorrelationId("allocation"));
    inFlightRef.current = false;
    setBusy(false);
    if (failure) {
      setEnvelope(failure);
      return;
    }
    idempotencyKeyRef.current = null;
    onRecorded(
      successAnnouncement({ name: selected.name, isOwn, amountUsd, dateIso: date }),
    );
    onClose();
  }

  // The share line prints only from a usable Book equity and a parsable amount,
  // and never under `allKeysStale`: no guess (UI-SPEC OQ-2).
  const parsedAmount = parseAmount(amount);
  const shareLine =
    !allKeysStale &&
    bookEquityUsd !== null &&
    Number.isFinite(bookEquityUsd) &&
    bookEquityUsd > 0 &&
    parsedAmount.ok
      ? `≈ ${formatPercent(parsedAmount.value / bookEquityUsd, 1, { signed: false })} of your book equity (${formatUsd(bookEquityUsd)}).`
      : null;

  function retryRead() {
    setLoadState({ kind: "loading" });
    setReloadNonce((n) => n + 1);
    searchRef.current?.focus();
  }

  function moveFocus(from: HTMLElement, delta: 1 | -1) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const index = buttons.indexOf(from as HTMLButtonElement);
    const next = buttons[index + delta];
    next?.focus();
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    moveFocus(e.target as HTMLElement, e.key === "ArrowDown" ? 1 : -1);
  }

  const loading = loadState.kind === "loading";

  return (
    <>
      <style>{ANIMATION_CSS}</style>
      {/* Backdrop: a click dismisses. */}
      <div
        onClick={requestClose}
        aria-hidden="true"
        data-testid="add-allocation-backdrop"
        className="aa-backdrop fixed inset-0 z-[100] bg-text-primary/20"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="aa-panel fixed bottom-0 right-0 top-0 z-[101] flex w-full flex-col overflow-y-auto border-l border-border bg-surface p-6 shadow-elevated sm:w-[620px] sm:max-w-[96vw]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-micro font-semibold uppercase tracking-[0.18em] text-text-muted">
              {step === "pick" ? STEP_1_EYEBROW : STEP_2_EYEBROW}
            </div>
            <h2
              id={TITLE_ID}
              className="mt-1 font-sans text-body font-semibold text-text-primary"
            >
              {TITLE}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close without adding"
            className={`-mr-2 -mt-2 min-h-[44px] min-w-[44px] rounded-md text-text-muted hover:text-text-primary ${FOCUS_RING}`}
          >
            ×
          </button>
        </div>

        {step === "pick" && (
          <div className="mt-4 flex flex-1 flex-col">
            {notice && (
              <p
                data-testid="add-allocation-notice"
                className="mb-3 rounded-md border border-border bg-page px-3 py-2 text-body text-text-primary"
              >
                {notice.kind === "held" && (
                  <>
                    {notice.name} is already in your book. Change its amount on
                    Holdings.{" "}
                    <Link
                      href="?tab=holdings"
                      onClick={onClose}
                      className={LINK_CLASS}
                    >
                      Open Holdings
                    </Link>
                  </>
                )}
                {notice.kind === "unavailable" && NOT_AVAILABLE_NOTICE}
                {notice.kind === "not_loaded" && NOT_LOADED_NOTICE}
              </p>
            )}
            <input
              ref={searchRef}
              type="search"
              aria-label="Search strategies"
              placeholder="Search by name or codename"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                }
              }}
              className={INPUT_CLASS}
            />

            <div className="mt-3 flex-1">
              {loading && (
                <div
                  role="status"
                  aria-label="Loading strategies"
                  className="divide-y divide-border"
                >
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="py-0.5">
                      <Skeleton className="h-11 w-full motion-reduce:animate-none" />
                    </div>
                  ))}
                </div>
              )}
              {loadState.kind === "error" && (
                <ErrorEnvelope
                  envelope={loadState.envelope}
                  onRetry={loadState.envelope.recoverable ? retryRead : undefined}
                />
              )}
              {loadState.kind === "ready" && rows.length === 0 && (
                <p className="py-10 text-center text-body text-text-muted">
                  No strategies are listed yet.
                </p>
              )}
              {loadState.kind === "ready" &&
                rows.length > 0 &&
                filtered.length === 0 && (
                  <div className="py-10 text-center text-body text-text-muted">
                    <span>No strategies match &quot;{search.trim()}&quot;.</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-2"
                      onClick={() => {
                        setSearch("");
                        searchRef.current?.focus();
                      }}
                    >
                      Clear search
                    </Button>
                  </div>
                )}
              {loadState.kind === "ready" && filtered.length > 0 && (
                <ul
                  ref={listRef}
                  aria-label="Strategies"
                  onKeyDown={onListKeyDown}
                  className="divide-y divide-border"
                >
                  {filtered.map((row) => (
                    <StrategyRow
                      key={row.id}
                      row={row}
                      held={heldStrategyIds.has(row.id)}
                      notOwnCapital={notOwnCapital(row)}
                      selected={selected?.id === row.id}
                      onChoose={choose}
                    />
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-6 text-caption text-text-muted">
              Holding capital on an exchange already? Connect the key on the{" "}
              <Link
                href="/profile?tab=exchanges"
                onClick={onClose}
                className={LINK_CLASS}
              >
                Exchanges page
              </Link>
              .
            </p>
          </div>
        )}

        {step === "amount" && selected && (
          <div className="mt-4 flex flex-1 flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 break-words text-body font-semibold text-text-primary">
                {selected.name}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setStep("pick")}
              >
                Change strategy
              </Button>
            </div>
            <div className="mt-4">
              <Field label={AMOUNT_LABEL} error={amountError ?? undefined}>
                <input
                  ref={amountRef}
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  readOnly={busy}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAmount(next);
                    idempotencyKeyRef.current = null;
                    // Once a message shows, re-run the check on every keystroke:
                    // null the instant the value is valid.
                    if (amountError !== null) setAmountError(amountProblem(next));
                  }}
                  className={INPUT_CLASS}
                />
              </Field>
              {shareLine && (
                <p className="mt-2 text-caption text-text-secondary">{shareLine}</p>
              )}
            </div>
            {selected.isOwn !== true && (
              <div className="mt-4">
                <Field label="Allocation date" error={dateError ?? undefined}>
                  <input
                    ref={dateRef}
                    type="date"
                    value={date}
                    min={earliestAllocationDateIso(todayUtcIso())}
                    max={todayUtcIso()}
                    readOnly={busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDate(next);
                      idempotencyKeyRef.current = null;
                      if (dateError !== null) {
                        setDateError(validateAllocationDate(next, todayUtcIso()));
                      }
                    }}
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
            )}
            {envelope && (
              <div className="mt-4">
                <ErrorEnvelope
                  envelope={envelope}
                  onRetry={envelope.recoverable ? () => void submit() : undefined}
                />
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={requestClose}
                disabled={busy}
              >
                Close without adding
              </Button>
              {/* Disabled ONLY while a write is in flight. Validation never
                  disables it: a refusal surfaces at the field instead. */}
              <Button type="button" onClick={() => void submit()} disabled={busy}>
                {busy ? "Adding…" : "Add allocation"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────── a row

function StrategyRow({
  row,
  held,
  notOwnCapital,
  selected,
  onChoose,
}: {
  row: StrategyBrowseRow;
  held: boolean;
  notOwnCapital: boolean;
  selected: boolean;
  onChoose: (row: StrategyBrowseRow) => void;
}) {
  // A part the row does not carry is omitted, never a placeholder (partial state).
  const caption = [
    row.codename,
    row.markets.length > 0 ? row.markets.join(", ") : null,
    row.strategy_types.length > 0 ? row.strategy_types.join(", ") : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <li>
      <button
        type="button"
        data-testid={`add-allocation-row-${row.id}`}
        aria-disabled={held || notOwnCapital ? "true" : undefined}
        onClick={() => onChoose(row)}
        className={`flex min-h-[44px] w-full flex-col border items-start gap-1 px-2 py-2 text-left hover:bg-page ${FOCUS_RING} ${
          selected ? "border-accent bg-accent/5" : "border-transparent"
        } ${held || notOwnCapital ? "cursor-not-allowed" : ""}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-words text-body font-semibold text-text-primary">
            {row.name}
          </span>
          {row.is_example === true && (
            <span className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-fixed-10 font-semibold uppercase tracking-wide text-text-muted">
              Example
            </span>
          )}
          {row.isOwn === true && <YoursChip className="shrink-0" />}
          {held && (
            <span className="inline-flex items-center rounded-md bg-badge-other/10 px-2 py-0.5 text-caption font-medium text-text-secondary">
              In your book
            </span>
          )}
        </span>
        {caption.length > 0 && (
          <span className="text-caption text-text-secondary">
            {caption.join(" · ")}
          </span>
        )}
        {held && (
          <span className="text-caption text-text-secondary">
            {HELD_ROW_CAPTION}
          </span>
        )}
        {!held && notOwnCapital && (
          <span className="text-caption text-text-secondary">
            {NOT_OWN_CAPITAL_CAPTION}
          </span>
        )}
      </button>
    </li>
  );
}
