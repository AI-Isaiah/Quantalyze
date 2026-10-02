-- RED: a dollar-quoted value would put a body into the restore transaction's
-- replay section, where the redaction grep expects none.
INSERT INTO fx_ref (id, label) VALUES (1, $tag$dollar quoted$tag$);
