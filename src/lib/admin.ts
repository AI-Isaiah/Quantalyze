const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

export function isAdmin(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL || !email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
