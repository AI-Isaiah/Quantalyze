"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

interface Org {
  organization_id: string;
  role: string;
  organizations: { id: string; name: string; slug: string; description: string | null };
}

interface Invite {
  id: string;
  status: string;
  created_at: string;
  organizations: { name: string };
}

export function OrganizationTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgDesc, setOrgDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const router = useRouter();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const supabase = createClient();
    const { data: memberData } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(id, name, slug, description)");
    if (memberData) setOrgs(memberData as unknown as Org[]);

    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: inviteData } = await supabase
        .from("organization_invites")
        .select("id, status, created_at, organizations(name)")
        .eq("email", user.email)
        .eq("status", "pending");
      if (inviteData) setInvites(inviteData as unknown as Invite[]);
    }
  }

  async function createOrg() {
    if (!orgName.trim()) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated"); setLoading(false); return; }

    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .insert({ name: orgName, slug, description: orgDesc || null, created_by: user.id })
      .select()
      .single();

    if (orgErr) { setError(orgErr.message); setLoading(false); return; }

    await supabase.from("organization_members").insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    });

    setShowCreate(false);
    setOrgName("");
    setOrgDesc("");
    setLoading(false);
    await loadData();
    router.refresh();
  }

  async function handleInvite(orgId: string) {
    if (!inviteEmail.trim()) return;
    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    await supabase.from("organization_invites").insert({
      organization_id: orgId,
      email: inviteEmail,
      invited_by: user.id,
    });

    setShowInvite(null);
    setInviteEmail("");
    setLoading(false);
  }

  async function respondInvite(inviteId: string, accept: boolean) {
    const supabase = createClient();

    if (accept) {
      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get the organization_id from the invite
      const { data: inviteData } = await supabase
        .from("organization_invites")
        .select("organization_id")
        .eq("id", inviteId)
        .single();

      if (inviteData) {
        await supabase.from("organization_members").insert({
          organization_id: inviteData.organization_id,
          user_id: user.id,
          role: "member",
        });
      }
    }

    await supabase
      .from("organization_invites")
      .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId);

    await loadData();
    router.refresh();
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Pending Invitations */}
      <Card>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Invitations</h2>
        {invites.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-text-muted mb-1">No invitations yet</p>
            <p className="text-xs text-text-muted mb-4">
              You haven't received any invitations to join an organization yet.
              You can wait for an invite, or create your own organization.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
              Create Organization
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{inv.organizations.name}</p>
                  <p className="text-xs text-text-muted">Invited {new Date(inv.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respondInvite(inv.id, true)}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => respondInvite(inv.id, false)}>Decline</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* My Organizations */}
      {orgs.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">My Organizations</h2>
            <Button size="sm" onClick={() => setShowCreate(true)}>New</Button>
          </div>
          <div className="space-y-3">
            {orgs.map((o) => (
              <div key={o.organization_id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{o.organizations.name}</p>
                  <p className="text-xs text-text-muted capitalize">{o.role}</p>
                </div>
                {(o.role === "owner" || o.role === "admin") && (
                  <Button size="sm" variant="ghost" onClick={() => { setShowInvite(o.organization_id); setInviteEmail(""); }}>
                    Invite Member
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Create Organization Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Organization">
        <div className="space-y-4">
          <Input label="Organization Name" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. My Trading Team" required />
          <Input label="Description (optional)" value={orgDesc} onChange={(e) => setOrgDesc(e.target.value)} placeholder="What does your team do?" />
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createOrg} disabled={loading || !orgName.trim()}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Invite Member Modal */}
      <Modal open={!!showInvite} onClose={() => setShowInvite(null)} title="Invite Team Member">
        <div className="space-y-4">
          <Input label="Email Address" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@team.com" required />
          <p className="text-xs text-text-muted">They'll see the invitation on their Profile page when they sign up or log in.</p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowInvite(null)}>Cancel</Button>
            <Button onClick={() => showInvite && handleInvite(showInvite)} disabled={loading || !inviteEmail.trim()}>
              {loading ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
