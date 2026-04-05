export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
