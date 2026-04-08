"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import { displayStrategyName, type DisplayableStrategy } from "@/lib/strategy-display";

const TABS = ["Intro Requests", "Strategy Review", "Allocators"] as const;
type Tab = (typeof TABS)[number];

interface AdminTabsProps {
  introRequests: Array<Record<string, unknown>>;
  pendingStrategies: Array<Record<string, unknown>>;
  pendingAllocators: Array<Record<string, unknown>>;
}

export function AdminTabs({ introRequests, pendingStrategies, pendingAllocators }: AdminTabsProps) {
  const [tab, setTab] = useState<Tab>("Intro Requests");

  const pendingIntroCount = introRequests.filter((r) => r.status === "pending").length;
  const badgeCounts: Record<string, number> = {
    "Intro Requests": pendingIntroCount,
    "Strategy Review": pendingStrategies.length,
    "Allocators": pendingAllocators.length,
  };

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {t}
            {badgeCounts[t] > 0 && (
              <span className="ml-2 bg-accent text-white text-[10px] rounded-full px-1.5 py-0.5">
                {badgeCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "Intro Requests" && <IntroRequestsTab requests={introRequests} />}
      {tab === "Strategy Review" && <StrategyReviewTab strategies={pendingStrategies} />}
      {tab === "Allocators" && <AllocatorsTab allocators={pendingAllocators} />}
    </div>
  );
}

type StatusFilter = "all" | "pending" | "intro_made" | "completed" | "declined";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "intro_made", label: "Intro Made" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

function IntroRequestsTab({ requests }: { requests: Array<Record<string, unknown>> }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    intro_made: requests.filter((r) => r.status === "intro_made").length,
    completed: requests.filter((r) => r.status === "completed").length,
    declined: requests.filter((r) => r.status === "declined").length,
  };

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  async function handleAction(id: string, status: "intro_made" | "completed" | "declined", admin_note?: string) {
    setLoading(id);
    setError(null);
    try {
      const payload: Record<string, unknown> = { id, status };
      if (admin_note) payload.admin_note = admin_note;
      const res = await fetch("/api/admin/intro-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { setError("Action failed. Please try again."); return; }
      setNoteId(null);
      setNoteText("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  if (requests.length === 0) {
    return <Card className="text-center py-8 text-text-muted">No intro requests yet.</Card>;
  }

  return (
    <div className="space-y-4">
      {/* Summary counts */}
      <div className="flex gap-4 text-xs">
        <span className="text-badge-market-neutral font-medium">{counts.pending} pending</span>
        <span className="text-accent font-medium">{counts.intro_made} in progress</span>
        <span className="text-positive font-medium">{counts.completed} completed</span>
        {counts.declined > 0 && <span className="text-negative font-medium">{counts.declined} declined</span>}
      </div>

      {/* Filter bar */}
      <div className="flex gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1 text-xs rounded-md font-medium transition-colors",
              filter === f.value
                ? "bg-accent text-white"
                : "bg-page text-text-muted hover:text-text-primary"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {filtered.length === 0 ? (
        <Card className="text-center py-6 text-text-muted text-sm">No requests with this status.</Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const profile = r.profiles as Record<string, string> | null;
            const strategy = r.strategies as DisplayableStrategy | null;
            const status = r.status as string;
            return (
              <Card key={r.id as string}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {profile?.display_name ?? "Unknown"} {profile?.company ? `(${profile.company})` : ""}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      wants intro to <span className="font-medium text-text-secondary">{displayStrategyName(strategy)}</span>
                    </p>
                    {typeof r.message === "string" && r.message && (
                      <p className="text-xs text-text-secondary mt-2 bg-page rounded p-2">{r.message}</p>
                    )}
                    {typeof r.admin_note === "string" && r.admin_note && (
                      <p className="text-[10px] text-text-muted mt-1 italic">Note: {r.admin_note}</p>
                    )}
                    <p className="text-[10px] text-text-muted mt-1">
                      {new Date(r.created_at as string).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Badge label={status} type="status" />
                    {status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => handleAction(r.id as string, "intro_made")} disabled={loading === r.id as string}>
                          Intro Made
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleAction(r.id as string, "declined")} disabled={loading === r.id as string}>
                          Decline
                        </Button>
                      </>
                    )}
                    {status === "intro_made" && (
                      <Button size="sm" onClick={() => handleAction(r.id as string, "completed")} disabled={loading === r.id as string}>
                        Mark Complete
                      </Button>
                    )}
                    {(status === "pending" || status === "intro_made") && (
                      <Button size="sm" variant="ghost" onClick={() => { setNoteId(r.id as string); setNoteText((r.admin_note as string) ?? ""); }}>
                        Note
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Admin note modal */}
      <Modal open={!!noteId} onClose={() => setNoteId(null)} title="Admin Note">
        <Textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          placeholder="Internal note about this intro request..."
          className="mb-4"
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setNoteId(null)}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!noteId) return;
              setLoading(noteId);
              try {
                const res = await fetch("/api/admin/intro-request", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: noteId,
                    status: requests.find((r) => r.id === noteId)?.status ?? "pending",
                    admin_note: noteText,
                  }),
                });
                if (!res.ok) { setError("Failed to save note."); return; }
                setNoteId(null);
                setNoteText("");
                router.refresh();
              } catch {
                setError("Network error.");
              } finally {
                setLoading(null);
              }
            }}
            disabled={loading === noteId}
          >
            Save Note
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StrategyReviewTab({ strategies }: { strategies: Array<Record<string, unknown>> }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setLoading(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/strategy-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve" }),
      });
      if (!res.ok) { setError("Approval failed."); return; }
      router.refresh();
    } catch { setError("Network error."); } finally { setLoading(null); }
  }

  async function reject() {
    if (!rejectId) return;
    setLoading(rejectId);
    setError(null);
    try {
      const res = await fetch("/api/admin/strategy-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rejectId, action: "reject", review_note: rejectNote }),
      });
      if (!res.ok) { setError("Rejection failed."); return; }
      setRejectId(null);
      setRejectNote("");
      router.refresh();
    } catch { setError("Network error."); } finally { setLoading(null); }
  }

  if (strategies.length === 0) {
    return <Card className="text-center py-8 text-text-muted">All caught up. No strategies pending review.</Card>;
  }

  return (
    <>
      {error && <p className="text-sm text-negative mb-3">{error}</p>}
      <div className="space-y-3">
        {strategies.map((s) => {
          const profile = s.profiles as Record<string, string> | null;
          return (
            <Card key={s.id as string}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">{s.name as string}</p>
                  <p className="text-xs text-text-muted">by {profile?.display_name ?? "Unknown"}</p>
                  <div className="flex gap-1 mt-1">
                    {((s.strategy_types as string[]) ?? []).map((t) => (
                      <Badge key={t} label={t} />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approve(s.id as string)} disabled={loading === s.id}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejectId(s.id as string)}>
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <Modal open={!!rejectId} onClose={() => setRejectId(null)} title="Reject Strategy">
        <p className="text-sm text-text-secondary mb-3">The manager will see this feedback on their strategy page.</p>
        <Textarea
          label="Review Note"
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          rows={3}
          placeholder="What needs to change before approval?"
          className="mb-4"
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRejectId(null)}>Cancel</Button>
          <Button variant="danger" onClick={reject} disabled={loading !== null}>Reject</Button>
        </div>
      </Modal>
    </>
  );
}

function AllocatorsTab({ allocators }: { allocators: Array<Record<string, unknown>> }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setLoading(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/allocator-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { setError("Approval failed."); return; }
      router.refresh();
    } catch { setError("Network error."); } finally { setLoading(null); }
  }

  if (allocators.length === 0) {
    return <Card className="text-center py-8 text-text-muted">All caught up. No allocators pending approval.</Card>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-negative mb-3">{error}</p>}
      {allocators.map((a) => (
        <Card key={a.id as string}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">{a.display_name as string}</p>
              <p className="text-xs text-text-muted">{a.company as string ?? ""} {a.email ? `· ${a.email}` : ""}</p>
            </div>
            <Button size="sm" onClick={() => approve(a.id as string)} disabled={loading === a.id}>
              Approve
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
