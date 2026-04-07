"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

interface DocumentUploadProps {
  portfolioId: string;
  userId: string;
  strategies: { id: string; name: string }[];
}

const DOC_TYPES = [
  { value: "contract", label: "Contract" }, { value: "note", label: "Note" },
  { value: "factsheet", label: "Factsheet" }, { value: "founder_update", label: "Founder Update" },
  { value: "other", label: "Other" },
];

export function DocumentUpload({ portfolioId, userId, strategies }: DocumentUploadProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("factsheet");
  const [strategyId, setStrategyId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setStatus("uploading");
    setError(null);

    const supabase = createClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${userId}/${portfolioId}/${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("portfolio-documents")
      .upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      setStatus("error");
      return;
    }

    const res = await fetch("/api/portfolio-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        title: title.trim(),
        doc_type: docType,
        file_path: path,
        ...(strategyId ? { strategy_id: strategyId } : {}),
      }),
    });
    if (!res.ok) {
      const { error: apiError } = await res.json().catch(() => ({ error: "Save failed" }));
      setError(apiError ?? "Save failed");
      setStatus("error");
      return;
    }

    setFile(null);
    setTitle("");
    setStrategyId("");
    setStatus("idle");
    router.refresh();
  }

  const strategyOptions = [{ value: "", label: "None" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <Card>
      <h2 className="text-base font-semibold text-text-primary mb-4">Upload Document</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q1 2026 factsheet" required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} options={DOC_TYPES} />
          <Select label="Strategy (optional)" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} options={strategyOptions} />
        </div>
        <label className="block">
          <span className="text-sm font-medium text-text-primary block mb-1.5">File</span>
          <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-secondary file:mr-4 file:rounded-lg file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover" />
        </label>
        {error && <p className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={status === "uploading" || !file || !title.trim()}>
            {status === "uploading" ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
