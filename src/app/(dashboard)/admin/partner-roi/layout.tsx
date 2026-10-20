import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Partner ROI simulator",
};

// page.tsx is a client component, which cannot export metadata. This layout
// carries the tab title and returns its children unchanged.
export default function PartnerRoiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
