"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Phase 11 / Plan 04 / D-10 — Shared widget state primitive.
 *
 * Stateless dispatcher on `mode`. Widget owners manage mode externally
 * (Pitfall 4 in 11-RESEARCH.md — the primitive holds NO useState/useEffect/
 * useRef). Hooks belong above the primitive in the widget owner.
 *
 * EmptyState.tsx (Phase 07) is the visual reference for `mode="empty"`.
 * We mirror the centered Card layout + accent CTA without duplicating
 * its zero-state copy — the primitive accepts caller-supplied strings
 * via the `empty` prop so each widget tells its own story.
 *
 * RISK-1 (review feedback): universal rollout to the 32 long-tail
 * WIDGET_REGISTRY widgets is gated behind the `widget_state_v2`
 * feature flag (see src/lib/widget-state-flag.ts). The 7 DEFAULT_LAYOUT
 * widgets are wrapped in this phase regardless; the rest opt in via
 * the flag, isolating blast radius.
 *
 * Mode dispatch (UI-SPEC §S3 LOCKED):
 *   - mode='loading' → Card with `aria-busy="true"` + animate-pulse
 *                      skeleton lines.
 *   - mode='empty'   → Card with centered text + optional title +
 *                      description + accent CTA (caller-supplied).
 *   - mode='partial' → children + DUAL ARIA pill: visible
 *                      `aria-hidden="true"` chip + sibling `sr-only`
 *                      announcement (UI-SPEC AC #16).
 *   - mode='error'   → Card with `role="alert" aria-live="polite"`,
 *                      negative-tinted chrome, optional Retry button.
 *   - mode='success' → bare children. NO Card chrome.
 *
 * NO classification prop. NO internal state. NO sibling LoadingState/
 * ErrorState files (inlined here — RESEARCH §Open Question #3).
 */

export type WidgetStateMode = "loading" | "empty" | "partial" | "error" | "success";

export interface WidgetStateProps {
  mode: WidgetStateMode;
  children?: ReactNode;
  partial?: { pill: string; children: ReactNode };
  error?: { message: string; onRetry?: () => void };
  empty?: {
    title: string;
    description?: string;
    ctaHref?: string;
    ctaLabel?: string;
  };
}

export function WidgetState(props: WidgetStateProps) {
  if (props.mode === "loading") {
    return (
      <Card aria-busy="true">
        <Skeleton className="h-5 w-1/3 mb-4" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (props.mode === "empty") {
    const empty = props.empty;
    return (
      <Card className="text-center py-8">
        {empty?.title && (
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            {empty.title}
          </h3>
        )}
        {empty?.description && (
          <p className="text-sm text-text-secondary max-w-md mx-auto mb-4">
            {empty.description}
          </p>
        )}
        {empty?.ctaHref && empty?.ctaLabel && (
          <Link
            href={empty.ctaHref}
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {empty.ctaLabel}
          </Link>
        )}
      </Card>
    );
  }

  if (props.mode === "partial") {
    const partial = props.partial;
    return (
      <div className="relative">
        {partial?.pill && (
          <>
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 inline-flex items-center rounded-md bg-warning/5 border border-warning px-2 py-0.5 text-xs text-warning"
            >
              {partial.pill}
            </span>
            <span className="sr-only">State: {partial.pill}</span>
          </>
        )}
        {partial?.children}
      </div>
    );
  }

  if (props.mode === "error") {
    const error = props.error;
    return (
      <Card
        role="alert"
        aria-live="polite"
        className="border-negative/30 bg-negative/5"
      >
        <p className="text-sm text-text-primary mb-2">
          {error?.message ?? "Something went wrong."}
        </p>
        {error?.onRetry && (
          <button
            type="button"
            onClick={error.onRetry}
            className="text-sm text-accent underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            Retry
          </button>
        )}
      </Card>
    );
  }

  // mode === "success" — bare children, no chrome.
  return <>{props.children}</>;
}
