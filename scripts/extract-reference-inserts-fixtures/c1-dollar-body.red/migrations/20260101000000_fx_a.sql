-- RED: the only INSERT INTO fx_ref sits inside a DO body, and it is NOT the
-- body's first statement — so maskSql()+statements() surface it as its own
-- span. This is RESEARCH A4's falsifier. Remove insideBody() and this fixture
-- becomes replayable into shared TEST.
DO $$
BEGIN
  RAISE NOTICE 'self-verify probe';
  INSERT INTO fx_ref (id, label) VALUES (1, 'body-fixture');
END
$$;
