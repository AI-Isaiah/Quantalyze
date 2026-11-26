"use client";

/**
 * Phase 149 / NAV-01 — the client host for the owner ranking.
 *
 * Phase 199 plan 09 (LEAN-01, D-02): moved from my-strategies/MyStrategiesSection.tsx.
 * It is now the ONE client host for every strategy owner's list: the merged
 * /strategies page mounts it for allocator, manager and `both`, and the old
 * /my-strategies page still mounts it until plan 199-13 retires that page. The
 * server decides each role's furniture and hands it down as data
 * (`managerRows`, `allocatorFurniture`); the Mark callback is minted
 * here ONLY when `allocatorFurniture` is on, so a manager-only list never
 * carries a control that needs an allocator portfolio.
 *
 * Two things need a client boundary and nothing else does: the wizard
 * overlay's open/closed state, and the `onFinishSetup` callback the Delta-5
 * placeholder rows fire (a function prop is non-serializable across the
 * RSC→client boundary, so the RSC page cannot hand one to StrategyTable
 * directly). Everything else — the fetches, the percentile scoring, the
 * exchange-label formatting — stays on the server.
 *
 * Local `useState` for the overlay is the AllocationsTabs:1010-1018 precedent.
 * The chrome-level overlay (`contributeOpen` inside DashboardChrome) is
 * unreachable from `{children}`, so a page that needs the wizard mounts its
 * own; the overlay renders `null` while closed and portals to document.body.
 */

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { ContributionWizardOverlay } from "@/app/(dashboard)/allocations/components/ContributionWizardOverlay";
import {
  StrategyTable,
  type PlaceholderKeyRow,
} from "@/components/strategy/StrategyTable";
import { MarkOwnershipDialog } from "@/components/strategy/MarkOwnershipDialog";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LiveRegion } from "@/components/ui/LiveRegion";
import {
  deleteFeedsNote,
  readKeyFeedsForConfirm,
  type DeleteFeedsState,
} from "@/components/exchanges/key-feeds-confirm";
import { createClient } from "@/lib/supabase/client";
import { captureToSentry } from "@/lib/sentry-capture";
import type { CapitalOwnership } from "@/lib/capital-ownership";
import type { FactsheetOrigin } from "@/lib/factsheet/origin";
import type { PercentileMap, RankedStrategyRow } from "@/lib/queries";
import type { SupportedExchange } from "@/lib/utils";
import type { PreselectedKey } from "@/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep";

/** What the Disconnect confirm needs of a row, and nothing more (see `markTarget`). */
type DisconnectTarget = { id: string; exchangeLabel: string; keyLabel: string };

/**
 * 162-06 / HONEST-06 — the placeholder row AS THIS SURFACE KNOWS IT.
 *
 * `PlaceholderKeyRow` is the shared table's contract (what a row RENDERS: the
 * id, the formatted exchange label, the nickname). The owner surface knows one
 * more fact about the same key — its venue ID — because the wizard it hands the
 * click to needs the id, not the display string. Widening here rather than in
 * `StrategyTable` keeps the public discovery surfaces' prop contract byte-
 * identical: the table neither reads nor renders `exchange`.
 */
export type OwnerPlaceholderKeyRow = PlaceholderKeyRow & {
  exchange: SupportedExchange;
};

/**
 * Phase 213 plan 06 (decision (b), SC-2) — the Disconnect-only confirm for a
 * "No strategy yet" row. It reuses the feeds read and wording the Profile key
 * manager's confirm uses (`key-feeds-confirm.ts`, one implementation) and
 * narrows it: exactly two buttons, Cancel and Disconnect, for every role.
 * There is no Delete key button, no holdings read and no cascade box here, by
 * construction: this host never imports a delete path. The RPC only stamps
 * `disconnected_at`; the key row is kept, so the account can be connected again.
 *
 * Mounted only while a target is set and keyed by its id, so each open starts
 * with its own feeds read and no state from the previous key.
 */
function DisconnectKeyConfirm({
  target,
  allocatorBody,
  onClose,
  onDisconnected,
}: {
  target: DisconnectTarget;
  /** Allocator and `both` hear the source confirm's sentence; a manager-only page its own. */
  allocatorBody: boolean;
  onClose: () => void;
  onDisconnected: () => void;
}) {
  const [feeds, setFeeds] = useState<DeleteFeedsState>({ state: "checking" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedsSeqRef = useRef(0);

  // The sequence drops an answer older than the newest read (a Retry, a
  // closed confirm), the same idiom as the source confirm.
  const targetId = target.id;
  const startRead = useCallback(() => {
    const seq = ++feedsSeqRef.current;
    void readKeyFeedsForConfirm(targetId).then((answer) => {
      if (feedsSeqRef.current !== seq) return;
      setFeeds(answer === "unreadable" ? { state: "unchecked" } : { state: "ok", feeds: answer });
    });
  }, [targetId]);
  useEffect(() => {
    startRead();
    return () => {
      feedsSeqRef.current += 1;
    };
  }, [startRead]);

  // Esc, the header close and Cancel are ignored while the request is in flight.
  const close = () => {
    if (loading) return;
    feedsSeqRef.current += 1;
    onClose();
  };

  async function disconnect() {
    setLoading(true);
    setError(null);
    let failed = false;
    // A returned error and a thrown rejection (a network fault) are the same failure to
    // the owner and to the operator: logged, captured (tags only, no key id), shown.
    const report = (err: unknown) => {
      failed = true;
      console.error("[StrategiesSection] disconnect_allocator_api_key failed:", err);
      captureToSentry(err, { tags: { component: "DisconnectKeyConfirm", stage: "disconnect-rpc" } });
    };
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("disconnect_allocator_api_key", {
        p_api_key_id: target.id,
      });
      if (rpcError) report(rpcError);
    } catch (err) {
      report(err);
    } finally {
      setLoading(false);
    }
    if (failed) {
      setError("Could not disconnect this key. Please try again.");
      return;
    }
    feedsSeqRef.current += 1;
    onDisconnected();
  }

  const note = deleteFeedsNote(feeds, false);
  return (
    <Modal
      open
      onClose={close}
      // Esc fires `cancel` before `close`: keep the dialog open while the request is in
      // flight, so a failure's alert line is visible and the row's Disconnect still opens.
      onCancel={(e) => {
        if (loading) e.preventDefault();
      }}
      title={`Disconnect ${target.exchangeLabel} · ${target.keyLabel}?`}
    >
      <p className="text-sm text-text-secondary">
        {allocatorBody
          ? "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance."
          : "We'll stop using this key. It stays on your account, marked disconnected, and you can connect this exchange account again."}
      </p>
      <p
        data-testid="allocator-delete-feeds"
        className={`mt-3 text-xs ${note.tone === "warning" ? "text-warning" : "text-text-muted"}`}
      >
        {note.text}
      </p>
      {feeds.state === "unchecked" ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          data-testid="allocator-delete-retry"
          disabled={loading}
          onClick={() => {
            setFeeds({ state: "checking" });
            startRead();
          }}
        >
          Retry
        </Button>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 text-xs text-negative bg-negative/5 border border-negative/20 rounded px-3 py-2"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" disabled={loading} onClick={close}>
          Cancel
        </Button>
        {/* An unreadable feeds read warns and does NOT hold Disconnect: it is reversible
            (the key row is kept), unlike the delete this confirm never offers. */}
        <Button
          variant="danger"
          disabled={loading || feeds.state === "checking"}
          onClick={() => void disconnect()}
        >
          {loading ? "Disconnecting…" : "Disconnect"}
        </Button>
      </div>
    </Modal>
  );
}

interface StrategiesSectionProps {
  /**
   * The owner's rows at every non-archived status. Typed as
   * `RankedStrategyRow[]` — NOT the looser shared row type — because
   * `analyticsPresent` is REQUIRED on this path (W-C): plan 03's chip
   * derivation coerces an absent analytics row to a null status so the 16h
   * bound can terminate the spinner, and an OMITTED signal means "trust the
   * raw status" instead. The shared StrategyTable prop stays optional for the
   * public callers that have no such distinction to make.
   */
  strategies: RankedStrategyRow[];
  /**
   * R-04 (REVIEWS, T-199-33): where a row's factsheet link says it came from.
   * REQUIRED and set by each page, never hard-coded here: the merged /strategies
   * page passes the strategies origin (its rows link `?from=strategies`) and
   * the old /my-strategies page passes the my-strategies origin until plan
   * 199-13 retires it. It also names the prefs-SCOPE key below.
   */
  origin: FactsheetOrigin;
  /** Server-formatted (EXCHANGE_DISPLAY already applied) bare-key rows. Absent: none. */
  placeholderKeys?: OwnerPlaceholderKeyRow[];
  portfolioId?: string | null;
  /**
   * The OWN-scored map from `getOwnRowPercentiles().ownMap` — never the
   * published map. Only own rows render here, and their Pnn must come from the
   * scorer helper that ranks them against the published population without
   * joining it.
   */
  percentiles?: PercentileMap | null;
  /**
   * Phase 170.7 / D-01 — the owner-list switch and each row's server-built Edit
   * target, actions slot and note (see StrategyTable's `managerRows`). Absent:
   * the plain owner mount /my-strategies has always been.
   */
  managerRows?: ComponentProps<typeof StrategyTable>["managerRows"];
  /**
   * Phase 199 / D-02 — the allocator half of the furniture: the ownership tag,
   * Mark ownership and Simulate Impact. Also the switch for the Mark callback
   * below, so it exists only when this is true.
   */
  allocatorFurniture?: boolean;
  /** Seeds the table sort only (StrategyTable's `initialSort`). */
  initialSort?: ComponentProps<typeof StrategyTable>["initialSort"];
}

export function StrategiesSection({
  strategies,
  origin,
  placeholderKeys = [],
  portfolioId = null,
  percentiles = null,
  managerRows,
  allocatorFurniture = false,
  initialSort,
}: StrategiesSectionProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  // 162-06 / HONEST-06 — WHICH key the owner clicked, or null for every other
  // way into this overlay. Held as the resolved triple rather than a bare id so
  // the overlay (and the summary the wizard renders from it) never has to
  // re-derive the exchange label the SERVER formatted for the row.
  const [preselectKey, setPreselectKey] = useState<PreselectedKey | null>(null);
  // Phase 150 / OWN-03 + OWN-05 — the two dialogs' targets. Same client-boundary
  // rule as `onFinishSetup` above (see the header comment): the RSC page cannot
  // hand StrategyTable a function prop, so the callbacks are minted here.
  //
  // Only the fields each dialog needs are captured, not the whole row: a mark
  // change re-renders the page through router.refresh(), and a stale row object
  // held in state would be a second, silently diverging copy of the truth.
  const [markTarget, setMarkTarget] = useState<{
    id: string;
    name: string;
    mark: CapitalOwnership | null;
  } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);
  // UI-SPEC 1.5 — what a finished Disconnect says (polite) and where focus goes next.
  // `focusRequest` is a fresh object per success so the effect below runs once for each.
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ controlName: string | null } | null>(null);
  const router = useRouter();

  // The confirm's dialog is gone by now, and the trigger row is about to be removed by the
  // refresh, so the browser would drop focus to <body>. Land it on the next placeholder
  // row's Disconnect control, else on the page heading. The neighbour is chosen from the
  // list as it was, so it is a row that survives the refresh and focus stays put when the
  // list re-renders. `PageHeader` exposes no id or tabIndex and is shared, so the heading
  // is made focusable here rather than edited there.
  useEffect(() => {
    if (!focusRequest) return;
    const control = focusRequest.controlName
      ? Array.from(document.querySelectorAll<HTMLElement>("button[aria-label]")).find(
          (el) => el.getAttribute("aria-label") === focusRequest.controlName,
        )
      : undefined;
    if (control) {
      control.focus();
      return;
    }
    const heading = document.querySelector<HTMLElement>("h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus();
    }
  }, [focusRequest]);

  return (
    <>
      <StrategyTable
        strategies={strategies}
        // A prefs-SCOPE key, not a discovery category (research Pitfall 6):
        // useDiscoveryPrefs namespaces localStorage by (userId, categorySlug),
        // and this surface needs its own scope so its sort/density choices do
        // not overwrite a real category's saved prefs.
        // Phase 199: it is the page's own origin key ("strategies" on the merged
        // page, "my-strategies" on the old one), so each page keeps the scope it
        // always had and a third host cannot collide with either.
        categorySlug={origin.key}
        origin={origin}
        portfolioId={portfolioId}
        percentiles={percentiles ?? undefined}
        visibility="owner-all-statuses"
        managerRows={managerRows}
        allocatorFurniture={allocatorFurniture}
        initialSort={initialSort}
        placeholderKeys={placeholderKeys}
        // 162-06 / HONEST-06 — resolve the clicked id against the SAME array
        // that rendered the row, so the summary can only ever show labels this
        // page actually displayed. A miss (an id from a row that is no longer
        // in this array) opens the wizard with NO preselect: the fresh
        // credential form is the honest fallback, never a guessed key.
        onFinishSetup={(keyId) => {
          const clicked = placeholderKeys.find((k) => k.id === keyId);
          setPreselectKey(
            clicked
              ? {
                  id: clicked.id,
                  exchange: clicked.exchange,
                  exchangeLabel: clicked.exchangeLabel,
                  keyLabel: clicked.keyLabel,
                }
              : null,
          );
          setWizardOpen(true);
        }}
        // Phase 213 decision (b): every role that lists an orphan can disconnect it. The
        // target holds only the three fields the confirm shows, resolved against the SAME
        // array that rendered the row; a miss (a row no longer in this array) opens nothing.
        onDisconnect={(keyId) => {
          const clicked = placeholderKeys.find((k) => k.id === keyId);
          if (clicked) {
            setDisconnectTarget({
              id: clicked.id,
              exchangeLabel: clicked.exchangeLabel,
              keyLabel: clicked.keyLabel,
            });
          }
        }}
        // D-02: wired ONLY for the allocator furniture. A manager-only page passes
        // no callback, so Mark ownership is absent from it by the props,
        // and the table's own `allocatorFurniture` gate is the second lock.
        onMarkOwnership={
          allocatorFurniture
            ? (s) =>
                setMarkTarget({
                  id: s.id,
                  name: s.name,
                  mark: s.capital_ownership ?? null,
                })
            : undefined
        }
      />
      {/* Mounted only while a row is selected, and KEYED by that row's id, so
          each open starts from that row's own current mark rather than
          inheriting the previously opened row's answer. */}
      {markTarget && (
        <MarkOwnershipDialog
          key={markTarget.id}
          open
          onClose={() => setMarkTarget(null)}
          strategyId={markTarget.id}
          strategyName={markTarget.name}
          currentMark={markTarget.mark}
        />
      )}
      {/* Mounted unconditionally: a live region that appears together with its text is missed. */}
      <LiveRegion message={announcement} />
      {disconnectTarget && (
        <DisconnectKeyConfirm
          key={disconnectTarget.id}
          target={disconnectTarget}
          allocatorBody={allocatorFurniture}
          onClose={() => setDisconnectTarget(null)}
          onDisconnected={() => {
            const others = placeholderKeys.filter((k) => k.id !== disconnectTarget.id);
            const removedAt = placeholderKeys.findIndex((k) => k.id === disconnectTarget.id);
            const next = others[Math.min(Math.max(removedAt, 0), others.length - 1)];
            setAnnouncement(
              `${disconnectTarget.exchangeLabel} · ${disconnectTarget.keyLabel} is disconnected. You can connect this account again.`,
            );
            setFocusRequest({
              controlName: next ? `Disconnect ${next.exchangeLabel} · ${next.keyLabel}` : null,
            });
            setDisconnectTarget(null);
            router.refresh();
          }}
        />
      )}
      {/* 162-06 / D-162-3 — "Finish setup" opens the wizard ON the key that was
          clicked. (The comment that stood here recorded the 2026-08-05 founder
          ruling that the overlay had no preselect seam and opened fresh; D-162-3
          supersedes it, and this is that seam.) `preselectKey` is null for every
          other entry point, which is byte-identically the old behavior.
          router.refresh() re-runs the RSC page so a newly created strategy
          replaces its placeholder row. */}
      <ContributionWizardOverlay
        isOpen={wizardOpen}
        preselectKey={preselectKey}
        onClose={() => {
          setWizardOpen(false);
          // Cleared WITH the close, not left standing: the next open may come
          // from a different row — or from no row at all — and a preselect that
          // outlives its click is a claim about a key the user did not choose.
          setPreselectKey(null);
          // Founder 2026-11-26: a close can follow a draft minted on a key
          // ("Continue with this key"). Without a refresh the page kept the bare
          // "No strategy yet" row and no Resume banner, and "Finish setup" then
          // reopened step 01 instead of the draft.
          router.refresh();
        }}
        onSuccess={() => {
          setWizardOpen(false);
          setPreselectKey(null);
          router.refresh();
        }}
      />
    </>
  );
}
