-- Phase 241 plan 03 - SC-1 evidence query for either credential pair on either project.
-- Read-only. {{LOGIN_SHA256}} is the lowercase-login digest, filled into a scratch copy at run
-- time. Run the database marker query first. The count is the record; never the digest.
SELECT count(*) AS present FROM auth.users WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '{{LOGIN_SHA256}}';
