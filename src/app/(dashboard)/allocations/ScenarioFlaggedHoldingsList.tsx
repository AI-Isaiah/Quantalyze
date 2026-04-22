"use client";

/**
 * Phase 09 / LIVE-04 / D-08 + D-11.
 *
 * Read-only list of flagged holdings with inline expandable Bridge V2 sub-row.
 * Replicates the BannerSubRow state machine from PositionsTable.tsx with an
 * additional finding-f2 click-path: when no match_decision exists yet, the
 * client POSTs to /api/match/decisions/holding BEFORE AllocatedForm/RejectedForm
 * mount. On 4xx the error surfaces inline; the form does NOT mount.
 *
 * Prop shape designed forward-looking per D-09 so Phase 10 extends rather than grafts.
 */

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildHoldingRef,
  toBridgeOutcomeBannerProps,
  toAllocatedFormProps,
  toRejectedFormProps,
  deriveEligibleForOutcome,
  type FlaggedHolding,
} from "./lib/holding-outcome-adapter";
import { BridgeOutcomeBanner } from "./components/BridgeOutcomeBanner";
import { AllocatedForm } from "./components/AllocatedForm";
import { RejectedForm } from "./components/RejectedForm";
import { OutcomeRecordedRow } from "./components/OutcomeRecordedRow";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

export interface ScenarioFlaggedHoldingsListProps {
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>;
  /** Allocator's Phase 2 mandate max weight — passed to AllocatedForm (soft warn). */
  allocatorPreferences?: { max_weight?: number | null } | null;
}

const COL_SPAN = 5;

// ---------------------------------------------------------------------------
// Per-row inline banner/form/recorded content — mirrors PositionsTable
// BannerSubRow with the additional finding-f2 POST gate.
//
// NOTE: returns content only (no <tr><td> wrapper) because the parent
// renders the containing <tr><td colSpan> to avoid invalid HTML nesting.
// ---------------------------------------------------------------------------

type BannerMode = "banner" | "allocated" | "rejected" | "dismissed";

function BannerSubRowContent({
  h,
  matchDecisionsByHoldingRef,
  existingOutcomesByHoldingRef,
  maxWeight,
  localDecisionsByRef,
  setLocalDecisionsByRef,
  errorByRef,
  setErrorByRef,
}: {
  h: FlaggedHolding;
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>;
  maxWeight: number | null;
  localDecisionsByRef: Record<string, { id: string } | null>;
  setLocalDecisionsByRef: React.Dispatch<
    React.SetStateAction<Record<string, { id: string } | null>>
  >;
  errorByRef: Record<string, string | null>;
  setErrorByRef: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
}) {
  const router = useRouter();
  const ref = buildHoldingRef(h);
  const effectiveDecisions = { ...matchDecisionsByHoldingRef, ...localDecisionsByRef };
  const { existingOutcome } = deriveEligibleForOutcome(
    h,
    effectiveDecisions,
    existingOutcomesByHoldingRef,
  );

  const [mode, setMode] = useState<BannerMode>("banner");
  const [localOutcome, setLocalOutcome] = useState<BridgeOutcome | null>(
    existingOutcome,
  );

  // If there's already a recorded outcome, show it immediately
  if (localOutcome) {
    return <OutcomeRecordedRow outcome={localOutcome} />;
  }

  if (mode === "dismissed") return null;

  /** finding f2: POST to /api/match/decisions/holding if no decision exists yet */
  async function ensureDecisionThen(targetMode: "allocated" | "rejected") {
    if (effectiveDecisions[ref]) {
      setMode(targetMode);
      return;
    }
    setErrorByRef((e) => ({ ...e, [ref]: null }));
    try {
      const res = await fetch("/api/match/decisions/holding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holding_ref: ref,
          top_candidate_strategy_id: h.top_candidate_strategy_id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorByRef((e) => ({
          ...e,
          [ref]:
            (body as Record<string, string>)?.error ??
            "This comparison isn't available.",
        }));
        return;
      }
      const { match_decision_id } = (await res.json()) as {
        match_decision_id: string;
      };
      setLocalDecisionsByRef((d) => ({ ...d, [ref]: { id: match_decision_id } }));
      setMode(targetMode);
      router.refresh();
    } catch {
      setErrorByRef((e) => ({
        ...e,
        [ref]: "Network error. Please retry.",
      }));
    }
  }

  const errorMsg = errorByRef[ref];

  if (mode === "allocated") {
    return (
      <AllocatedForm
        {...toAllocatedFormProps(h, {
          onRecorded: (outcome) => setLocalOutcome(outcome),
          onCancel: () => setMode("banner"),
          maxWeight,
        })}
      />
    );
  }

  if (mode === "rejected") {
    return (
      <RejectedForm
        {...toRejectedFormProps(h, {
          onRecorded: (outcome) => setLocalOutcome(outcome),
          onCancel: () => setMode("banner"),
        })}
      />
    );
  }

  // Banner mode (both eligible and not-yet-eligible use the same banner UI;
  // the difference is whether the POST gate fires on button click)
  return (
    <>
      {errorMsg && (
        <p className="px-4 py-2 text-sm text-negative">{errorMsg}</p>
      )}
      <BridgeOutcomeBanner
        {...toBridgeOutcomeBannerProps(h, {
          onAllocatedClick: () => void ensureDecisionThen("allocated"),
          onRejectedClick: () => void ensureDecisionThen("rejected"),
          onDismiss: () => setMode("dismissed"),
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScenarioFlaggedHoldingsList({
  flaggedHoldings,
  matchDecisionsByHoldingRef,
  existingOutcomesByHoldingRef,
  allocatorPreferences,
}: ScenarioFlaggedHoldingsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localDecisionsByRef, setLocalDecisionsByRef] = useState<
    Record<string, { id: string } | null>
  >({});
  const [errorByRef, setErrorByRef] = useState<Record<string, string | null>>(
    {},
  );

  const maxWeight = allocatorPreferences?.max_weight ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-sans">
        <thead>
          <tr className="border-b border-[#E2E8F0] text-left text-[10px] uppercase tracking-wider text-text-muted">
            <th className="pb-2 pr-4 font-medium" />
            <th className="pb-2 pr-4 font-medium">Holding</th>
            <th className="pb-2 pr-4 font-medium">Candidate Strategy</th>
            <th className="pb-2 pr-4 font-medium">Composite</th>
            <th className="pb-2 font-medium">Breach</th>
          </tr>
        </thead>
        <tbody>
          {flaggedHoldings.map((h) => {
            const ref = buildHoldingRef(h);
            const isExpanded = expandedId === ref;

            function toggleExpand() {
              setExpandedId(isExpanded ? null : ref);
            }

            return (
              <Fragment key={ref}>
                <tr className="border-b border-[#E2E8F0] hover:bg-surface-hover">
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      aria-label={isExpanded ? "Collapse review" : "Expand review"}
                      aria-expanded={isExpanded}
                      onClick={toggleExpand}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:text-text-secondary"
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="font-mono text-text-primary">
                      {h.symbol}
                    </span>
                    <span className="ml-1 text-xs text-text-muted">
                      {h.venue}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {h.top_candidate_name}
                  </td>
                  <td className="py-3 pr-4 font-mono text-text-primary">
                    {h.top_candidate_composite}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1">
                      {h.breach_reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td
                      colSpan={COL_SPAN}
                      className="p-0"
                      data-testid={`flagged-expanded-${ref}`}
                    >
                      <BannerSubRowContent
                        h={h}
                        matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
                        existingOutcomesByHoldingRef={existingOutcomesByHoldingRef}
                        maxWeight={maxWeight}
                        localDecisionsByRef={localDecisionsByRef}
                        setLocalDecisionsByRef={setLocalDecisionsByRef}
                        errorByRef={errorByRef}
                        setErrorByRef={setErrorByRef}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
