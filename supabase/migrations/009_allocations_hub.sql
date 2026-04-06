-- Add founder_notes and allocation_amount to contact_requests
ALTER TABLE contact_requests
  ADD COLUMN IF NOT EXISTS founder_notes TEXT,
  ADD COLUMN IF NOT EXISTS allocation_amount NUMERIC;

-- Relationship documents table
CREATE TABLE IF NOT EXISTS relationship_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_request_id UUID NOT NULL REFERENCES contact_requests(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'factsheet',
  file_name TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: only parties to the contact_request can access documents
ALTER TABLE relationship_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allocator can view own documents"
  ON relationship_documents FOR SELECT
  USING (
    contact_request_id IN (
      SELECT id FROM contact_requests WHERE allocator_id = auth.uid()
    )
  );

CREATE POLICY "Manager can view documents for their strategies"
  ON relationship_documents FOR SELECT
  USING (
    contact_request_id IN (
      SELECT cr.id FROM contact_requests cr
      JOIN strategies s ON cr.strategy_id = s.id
      WHERE s.user_id = auth.uid()
    )
  );

CREATE POLICY "Parties can insert documents"
  ON relationship_documents FOR INSERT
  WITH CHECK (
    contact_request_id IN (
      SELECT id FROM contact_requests WHERE allocator_id = auth.uid()
      UNION
      SELECT cr.id FROM contact_requests cr
      JOIN strategies s ON cr.strategy_id = s.id
      WHERE s.user_id = auth.uid()
    )
  );

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_relationship_documents_contact_request
  ON relationship_documents(contact_request_id);
