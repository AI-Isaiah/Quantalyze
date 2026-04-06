import Link from "next/link";
import { Disclaimer } from "@/components/ui/Disclaimer";

export default function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-white">
      {/* Minimal nav */}
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-text-primary"
          >
            Quantalyze
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
        <Disclaimer variant="footer" />
      </main>
    </div>
  );
}
