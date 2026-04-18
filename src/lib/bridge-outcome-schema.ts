/**
 * Shared Zod schemas and labels for bridge outcome forms.
 *
 * Duplicated from the server-side route schema (src/app/api/bridge/outcome/route.ts)
 * so client-side forms can validate symmetrically with the server (OQ4).
 * Both copies must stay in sync — the route is authoritative; this module is
 * the consumer-facing mirror.
 *
 * Sprint 8 Phase 1 — Plan 01-03
 */

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

/**
 * Client-side Zod schema for the AllocatedForm fields.
 * Mirrors the server-side BODY_SCHEMA for kind="allocated".
 * Note: date range validation (not future, not > 365d past) matches
 * the superRefine constraint in the server route.
 */
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

/**
 * Client-side Zod schema for the RejectedForm fields.
 * Mirrors the server-side BODY_SCHEMA for kind="rejected".
 */
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
