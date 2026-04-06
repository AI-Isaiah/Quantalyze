-- 008: Matching automation - expand contact_requests status and add admin_note
-- Expands the status flow: pending -> intro_made -> completed (or declined at any point)

-- Drop and re-add the CHECK constraint with expanded statuses
ALTER TABLE contact_requests DROP CONSTRAINT IF EXISTS contact_requests_status_check;
ALTER TABLE contact_requests ADD CONSTRAINT contact_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'intro_made', 'completed', 'declined'));

-- Migrate any existing 'accepted' rows to 'intro_made' (they mean the same thing now)
UPDATE contact_requests SET status = 'intro_made' WHERE status = 'accepted';

-- Remove 'accepted' from valid statuses now that data is migrated
ALTER TABLE contact_requests DROP CONSTRAINT contact_requests_status_check;
ALTER TABLE contact_requests ADD CONSTRAINT contact_requests_status_check
  CHECK (status IN ('pending', 'intro_made', 'completed', 'declined'));

-- Add admin_note column for internal notes on requests
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS admin_note TEXT;
