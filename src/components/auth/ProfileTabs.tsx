"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
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
import type { AllocatorOwnPreferences } from "@/lib/preferences";

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
  initialPreferences?: AllocatorOwnPreferences | null;
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
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as TabKey)}
      // 50-REVIEW (red-team): manual activation — selection commits only on
      // Enter/Space/click, not on focus. ProfileTabs' onValueChange does a
      // router.replace() AND its panels are heavy (the Exchanges panel mounts
      // AllocatorExchangeManager, which spins up a Supabase client + fetch on
      // mount). With Radix's default "automatic" mode, arrow-keying through the
      // strip would fire a navigation + mount the focused panel on EVERY
      // keystroke. Manual keeps full keyboard focus nav while committing only on
      // activation — the behavior closest to the pre-port click/Enter original.
      // (AdminTabs/WatchlistTabs keep automatic: their activation is cheap local
      // state with no router or fetch side effect.)
      activationMode="manual"
    >
      <TabsList variant="underline" className="mb-6">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            variant="underline"
            // ProfileTabs' exact active treatment differs from the underline
            // default: active text is text-text-primary (not text-accent),
            // inactive hover is text-text-secondary (not text-text-primary), and
            // the strip uses py-2.5. Override those three via the className hook
            // (data-[state=active] wins over the base via cascade order) to keep
            // the 1:1 port byte-faithful (50-UI-SPEC consumer mapping).
            className="py-2.5 hover:text-text-secondary data-[state=active]:text-text-primary"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Each body lives in a Radix TabsContent (role="tabpanel") so every
          TabsTrigger's aria-controls resolves to a real panel and the active
          panel is labelled by its tab (WCAG 4.1.2 / 1.3.1). Radix renders only
          the active panel. The allocator-only panels are gated on `isAllocator`
          to stay symmetric with their triggers (a trigger without a panel —
          or a panel without a trigger — would re-introduce the dangling
          aria-controls). The exchanges panel renders whenever the exchanges
          trigger does (isAllocator) and is null-safe inside, so the trigger
          never points at a missing panel when `exchanges` is absent. */}
      <TabsContent value="personal">
        <ProfileForm profile={profile} />
      </TabsContent>
      {isAllocator && (
        <TabsContent value="mandate">
          <MandateForm initial={initialPreferences} />
        </TabsContent>
      )}
      {isAllocator && (
        <TabsContent value="exchanges">
          {exchanges && (
            <ExchangesTabContent
              initialKeys={exchanges.initialKeys}
              activePortfolio={exchanges.activePortfolio}
            />
          )}
        </TabsContent>
      )}
      {isAllocator && (
        <TabsContent value="security">
          {/* Phase 11 / S6 / D-05 — Allocator self-serve audit-log CSV.
              Future security subsections (key encryption details, MFA, etc.)
              will mount alongside the AuditLogSubsection inside this body. */}
          <AuditLogSubsection />
        </TabsContent>
      )}
      <TabsContent value="organizations">
        <OrganizationTab />
      </TabsContent>
      <TabsContent value="account">
        <div className="max-w-xl">
          <DeleteAccountButton />
        </div>
      </TabsContent>
    </Tabs>
  );
}
