"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProfileForm } from "./ProfileForm";
import { DeleteAccountButton } from "./DeleteAccountButton";
import { OrganizationTab } from "@/components/org/OrganizationTab";
import { MandateForm } from "@/components/mandate/MandateForm";
import {
  ExchangesTabContent,
  type ExchangesTabContentProps,
} from "@/components/exchanges/ExchangesTabContent";
import { AuditLogSubsection } from "@/app/(dashboard)/profile/components/AuditLogSubsection";
import type { Profile } from "@/lib/types";
import type { AllocatorPreferences } from "@/lib/preferences";

const ALL_TABS = [
  { key: "personal", label: "Personal Info" },
  { key: "mandate", label: "Mandate", allocatorOnly: true },
  { key: "exchanges", label: "Exchanges", allocatorOnly: true },
  // Phase 11 / S6 / D-05 — allocator-only Security tab housing the
  // self-serve audit-log CSV download (linked from /security#data-handling-summary).
  { key: "security", label: "Security", allocatorOnly: true },
  { key: "organizations", label: "Organizations" },
  { key: "account", label: "Account" },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

const VALID_TAB_KEYS = ALL_TABS.map((t) => t.key) as readonly TabKey[];
const ALLOCATOR_ONLY_KEYS: readonly TabKey[] = [
  "mandate",
  "exchanges",
  "security",
];

function parseTabParam(raw: string | null, isAllocator: boolean): TabKey {
  if (!raw) return "personal";
  if (!(VALID_TAB_KEYS as readonly string[]).includes(raw)) return "personal";
  if ((ALLOCATOR_ONLY_KEYS as readonly string[]).includes(raw) && !isAllocator) {
    return "personal";
  }
  return raw as TabKey;
}

interface Props {
  profile: Profile;
  initialPreferences?: AllocatorPreferences | null;
  isAllocator?: boolean;
  exchanges?: ExchangesTabContentProps | null;
}

export function ProfileTabs({
  profile,
  initialPreferences = null,
  isAllocator = false,
  exchanges = null,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Phase 11 review fix IN-06: derive activeTab per render from
  // searchParams instead of snapshotting in local state. The previous
  // useState(initialTab) snapshot pattern broke browser back/forward —
  // searchParams updates would not be reflected because `activeTab`
  // stayed at the mount-time value. Same fix as
  // AllocationsTabs.tsx:222-224 (Phase 09.1 / VOICES-ACCEPTED f3:
  // "derive each render — no local state snapshot").
  const activeTab: TabKey = parseTabParam(searchParams.get("tab"), isAllocator);

  // Tab click handler: push the new tab to the URL so the next render
  // reads it via parseTabParam above. shallow=true preserves back/forward
  // and sharable links.
  const setActiveTab = (next: TabKey) => {
    const target = next === "personal" ? null : next;
    const params = new URLSearchParams(searchParams.toString());
    if (target) params.set("tab", target);
    else params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const tabs = ALL_TABS.filter((t) => !("allocatorOnly" in t && t.allocatorOnly) || isAllocator);

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "personal" && <ProfileForm profile={profile} />}
      {activeTab === "mandate" && isAllocator && (
        <MandateForm initial={initialPreferences} />
      )}
      {activeTab === "exchanges" && isAllocator && exchanges && (
        <ExchangesTabContent
          initialKeys={exchanges.initialKeys}
          activePortfolio={exchanges.activePortfolio}
        />
      )}
      {activeTab === "security" && isAllocator && (
        <div>
          {/* Phase 11 / S6 / D-05 — Allocator self-serve audit-log CSV.
              Future security subsections (key encryption details, MFA, etc.)
              will mount alongside the AuditLogSubsection inside this body. */}
          <AuditLogSubsection />
        </div>
      )}
      {activeTab === "organizations" && <OrganizationTab />}
      {activeTab === "account" && (
        <div className="max-w-xl">
          <DeleteAccountButton />
        </div>
      )}
    </div>
  );
}
