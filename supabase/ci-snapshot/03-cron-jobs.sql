SELECT cron.schedule('audit_log_cold_purge', '5 3 * * *', ' DELETE FROM audit_log_cold WHERE created_at < now() - interval ''7 years''; ');
SELECT cron.schedule('audit_log_hot_to_cold', '0 3 * * *', '
    DO $body$
    DECLARE
      v_archived INTEGER;
      v_inserted INTEGER;
    BEGIN
      WITH archived AS (
        DELETE FROM audit_log
         WHERE created_at < now() - interval ''2 years''
        RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
      ),
      inserted AS (
        INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
        SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
          FROM archived
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT (SELECT count(*) FROM archived),
             (SELECT count(*) FROM inserted)
        INTO v_archived, v_inserted;

      IF v_archived <> v_inserted THEN
        RAISE NOTICE ''audit-2026-05-07 H-0920: audit_log_hot_to_cold lost % rows to ON CONFLICT (archived=%, inserted=%). Investigate cold table for pre-existing UUID collisions.'',
          (v_archived - v_inserted), v_archived, v_inserted;
      END IF;
    END $body$;
    ');
SELECT cron.schedule('retention_compute_jobs_done', '20 3 * * *', ' DELETE FROM compute_jobs WHERE status = ''done'' AND created_at < now() - interval ''30 days''; ');
SELECT cron.schedule('retention_compute_jobs_failed', '30 3 * * *', '
    DELETE FROM compute_jobs
     WHERE status IN (''failed_final'', ''failed_retry'')
       AND COALESCE(next_attempt_at, created_at) < now() - interval ''90 days'';
    ');
SELECT cron.schedule('retention_notification_dispatches', '10 3 * * *', '
    DO $body$
    DECLARE
      v_queued_aged INTEGER;
    BEGIN
      DELETE FROM notification_dispatches
       WHERE created_at < now() - interval ''180 days''
         AND status <> ''queued'';

      SELECT count(*) INTO v_queued_aged
        FROM notification_dispatches
       WHERE status = ''queued''
         AND created_at < now() - interval ''180 days'';

      IF v_queued_aged > 1000 THEN
        RAISE NOTICE ''retention_notification_dispatches: % queued rows aged >180d — consumer drain missing or stalled. audit-2026-05-07 SFT #5.'',
          v_queued_aged;
      END IF;
    END $body$;
    ');
