// Shared constants, Zod schemas, and types for the bridge outcome feature.
// Single source of truth for REJECTION_REASONS (consumed by the server route
// too) and the BridgeOutcome row shape.

import { z } from "zod";

export const REJECTION_REASONS = [
  "mandate_conflict",
  "already_owned",
  "timing_wrong",
  "underperforming_peers",
  "other",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  mandate_conflict: "Mandate conflict",
  already_owned: "Already owned",
  timing_wrong: "Timing wrong",
  underperforming_peers: "Underperforming peers",
  other: "Other",
};

export type BridgeOutcome = {
  id: string;
  kind: "allocated" | "rejected";
  percent_allocated: number | null;
  allocated_at: string | null;
  rejection_reason: RejectionReason | null;
  note: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
};

export const ALLOCATED_FIELDS = z
  .object({
    percent_allocated: z.number().min(0.1).max(50),
    allocated_at: z.string().date(),
    note: z.string().max(2000).nullish(),
  })
  .superRefine((val, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const earliest = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (val.allocated_at > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocated_at"],
        message: "Date cannot be in the future",
      });
    } else if (val.allocated_at < earliest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocated_at"],
        message: "Date cannot be more than 365 days ago",
      });
    }
  });

export const REJECTED_FIELDS = z
  .object({
    rejection_reason: z.enum(REJECTION_REASONS),
    note: z.string().max(2000).nullish(),
  })
  .superRefine((val, ctx) => {
    if (val.rejection_reason === "other" && !val.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Add a note when reason is Other",
      });
    }
  });

export type AllocatedFormValues = z.infer<typeof ALLOCATED_FIELDS>;
export type RejectedFormValues = z.infer<typeof REJECTED_FIELDS>;

type PostBridgeOutcomeArgs =
  | { strategyId: string; kind: "allocated"; values: AllocatedFormValues }
  | { strategyId: string; kind: "rejected"; values: RejectedFormValues };

type PostBridgeOutcomeResult =
  | { ok: true; outcome: BridgeOutcome }
  | { ok: false; error: string };

export async function postBridgeOutcome(
  args: PostBridgeOutcomeArgs,
): Promise<PostBridgeOutcomeResult> {
  try {
    const res = await fetch("/api/bridge/outcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        strategy_id: args.strategyId,
        kind: args.kind,
        ...args.values,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) {
        return { ok: false, error: "Too many submissions — try again in a moment" };
      }
      return { ok: false, error: body.error ?? "Couldn't record outcome — try again" };
    }
    return { ok: true, outcome: body.outcome as BridgeOutcome };
  } catch {
    return { ok: false, error: "Couldn't record outcome — try again" };
  }
}
