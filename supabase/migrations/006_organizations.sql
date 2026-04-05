-- Organizations: teams of users who share strategies and data
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')) DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

-- Add organization_id to strategies (nullable for backward compat)
ALTER TABLE strategies ADD COLUMN organization_id UUID REFERENCES organizations(id);

-- RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Org members can read their org
CREATE POLICY org_read ON organizations FOR SELECT USING (
  id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  OR created_by = auth.uid()
);

-- Members can read membership
CREATE POLICY org_members_read ON organization_members FOR SELECT USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

-- Only owners/admins can insert members
CREATE POLICY org_members_insert ON organization_members FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  )
);

-- Users can see invites sent to their email
CREATE POLICY org_invites_read ON organization_invites FOR SELECT USING (
  email = (SELECT email FROM profiles WHERE id = auth.uid())
  OR invited_by = auth.uid()
  OR organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  )
);

-- Users can update their own invites (accept/decline)
CREATE POLICY org_invites_update ON organization_invites FOR UPDATE USING (
  email = (SELECT email FROM profiles WHERE id = auth.uid())
);

-- Org strategies: members can see org strategies
CREATE POLICY strategies_org_read ON strategies FOR SELECT USING (
  organization_id IS NULL AND (status = 'published' OR user_id = auth.uid())
  OR organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  )
);

-- Index for performance
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_invites_email ON organization_invites(email);
CREATE INDEX idx_strategies_org ON strategies(organization_id);
