"use client";

import { Component, useMemo, type ComponentType, type ReactNode } from "react";
import type { ZodType } from "zod";
import { WidgetState } from "../../components/WidgetState";
import { captureToSentry } from "@/lib/sentry-capture";
import { fromSafeParse, isOk } from "@/lib/result";
import type { WidgetProps } from "../../lib/types";

/**
 * B21 — the single validate-and-contain seam for dashboard widgets.
 *
 * Before B21 every widget received `WidgetProps.data: any` (the whole
 * `MyAllocationDashboardPayload` cast with `props as any` at the tab panel)
 * and blind-optional-chained into it — `data?.strategies`, `data?.analytics`,
 * `data?.compositeReturns` — feeding the result straight into quantile / SVG /
 * anchor math. A malformed slice produced NaN-poisoned charts; an inner throw
 * blanked the whole tab.
 *
 * `withWidgetBoundary(schema, Inner, opts)` closes both halves of that class by
 * construction:
 *   - the widget's zod `schema` IS its data contract — one declaration yields
 *     both the runtime validation here AND the inner component's `data` type
 *     (`z.infer<typeof schema>`), so `unknown` is narrowed to a typed payload
 *     before any math runs;
 *   - the inner render is wrapped in `WidgetErrorBoundary`, so a throw becomes
 *     a recoverable error state instead of an uncaught exception.
 *
 * A new widget physically cannot be registered without passing through this
 * seam, so the class cannot recur. Applied at the widget's export, both mount
 * paths (the `WIDGET_COMPONENTS` registry and direct imports) inherit it.
 */

/** The non-`data` props every widget receives from its mount. */
export interface BaseWidgetProps {
  timeframe: WidgetProps["timeframe"];
  // H-0076: optional, mirroring WidgetProps — widgets size via ResponsiveContainer.
  width?: WidgetProps["width"];
  height?: WidgetProps["height"];
}

// Module-scoped dedup so a long hover / Tweaks session can't saturate the
// Sentry tier with the same widget's repeated failure (mirrors the
// EquityChart `sentryEmittedSites` cap).
const reportedAreas = new Set<string>();
function reportOnce(
  area: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (reportedAreas.has(area)) return;
  reportedAreas.add(area);
  captureToSentry(error instanceof Error ? error : new Error(String(error)), {
    tags: { area: `widget.${area}` },
    extra,
    level: "warning",
  });
}

interface ErrorBoundaryProps {
  /** Sentry area tag, e.g. "tail-risk". */
  area: string;
  /** Changing this value clears a latched error (new data → re-attempt). */
  resetKey: unknown;
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
  resetKey: unknown;
}

/**
 * Catches a render throw from a widget subtree and shows the shared
 * `WidgetState mode="error"` card instead of propagating to the tab. Recovers
 * automatically when `resetKey` (the widget's `data`) changes, so a transient
 * bad render doesn't latch the error state forever.
 */
export class WidgetErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error): void {
    reportOnce(`${this.props.area}.throw`, error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <WidgetState
          mode="error"
          error={{ message: "This widget couldn’t render." }}
        />
      );
    }
    return this.props.children;
  }
}

interface BoundaryOptions {
  /** Sentry area + dedup key, e.g. "tail-risk". */
  area: string;
  /**
   * What to show when a NON-null `data` fails the schema (real server/schema
   * drift). Default `"error"`. Use `"empty"` for widgets where a malformed or
   * still-warming payload should read as "no data yet" rather than a failure
   * (e.g. the equity curve during first-connect reconstruction).
   */
  onInvalid?: "error" | "empty";
  /** Empty-state copy used when `onInvalid === "empty"`. */
  empty?: { title: string; description?: string };
}

/**
 * Wrap `Inner` so its `data` is validated against `schema` and any render
 * throw is contained. Returns a `WidgetProps`-shaped component for the
 * registry / direct mounts.
 */
export function withWidgetBoundary<TData>(
  schema: ZodType<TData>,
  Inner: ComponentType<{ data: TData } & BaseWidgetProps>,
  options: BoundaryOptions,
): ComponentType<WidgetProps> {
  const { area, onInvalid = "error", empty } = options;

  function Boundaried({ data, timeframe, width, height }: WidgetProps) {
    // Parse is keyed on the `data` reference, which only changes when the
    // payload changes — so validation runs once per data change, not per
    // render (preserves the widgets' existing `useMemo([data])` cadence).
    // `schema` is captured at HOC-call time and is constant for this
    // component's lifetime — an outer-scope value, intentionally NOT a dep
    // (exhaustive-deps flags it as unnecessary). Parse runs once per `data`
    // change, preserving the widgets' existing `useMemo([data])` cadence.
    const parsed = useMemo(() => fromSafeParse(schema.safeParse(data)), [data]);

    if (!isOk(parsed)) {
      // A null/undefined payload is the ordinary "not loaded yet" path and
      // must NOT page anyone; only a present-but-malformed payload signals
      // real server/schema drift.
      if (data != null) {
        reportOnce(`${area}.invalid`, parsed.error, { received: typeof data });
      }
      if (onInvalid === "empty") {
        return (
          <WidgetState
            mode="empty"
            empty={{
              title: empty?.title ?? "No data yet",
              description: empty?.description,
            }}
          />
        );
      }
      return (
        <WidgetState
          mode="error"
          error={{ message: "This widget couldn’t load." }}
        />
      );
    }

    return (
      <WidgetErrorBoundary area={area} resetKey={data}>
        <Inner
          data={parsed.value}
          timeframe={timeframe}
          width={width}
          height={height}
        />
      </WidgetErrorBoundary>
    );
  }

  Boundaried.displayName = `withWidgetBoundary(${area})`;
  return Boundaried;
}
