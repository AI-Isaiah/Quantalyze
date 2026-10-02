-- GREEN: every token form C2 admits — literal, ::cast, NULL, TRUE, now() and
-- gen_random_uuid(). The self-test greps stdout for the last of these, so a
-- classifier that started refusing them reddens here rather than silently
-- shrinking the replay.
INSERT INTO fx_ref (id, label, at, tag, flag, uid)
VALUES (1, 'ok'::text, now(), NULL, TRUE, gen_random_uuid())
ON CONFLICT (id) DO NOTHING;
