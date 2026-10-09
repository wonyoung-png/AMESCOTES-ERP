-- 운영 DB에서도 데이터를 남기지 않는 트랜잭션 회귀 검사.
BEGIN;
DO $$
DECLARE p jsonb; first_result jsonb; second_result jsonb; style text; saved_qty int;
BEGIN
  IF EXISTS(SELECT 1 FROM public.brand_order_batches WHERE id='pms-reorder-lumen-999999999') THEN
    RAISE EXCEPTION 'fixture id already exists; no test writes made';
  END IF;
  SELECT style_no INTO style FROM public.items WHERE style_no IS NOT NULL AND style_no<>'' LIMIT 1;
  IF style IS NULL THEN RAISE EXCEPTION 'existing item required'; END IF;
  p := jsonb_build_object('id','pms-reorder-lumen-999999999','workspace','LUMEN','project_no','PMS-REGRESSION-999999999','title','트랜잭션 회귀 검사','created_by','회귀 검사','style_no',style,'qty',2);
  first_result := public.create_reorder_draft(p);
  second_result := public.create_reorder_draft(p || jsonb_build_object('qty',99));
  SELECT qty INTO saved_qty FROM public.brand_order_lines WHERE batch_id=p->>'id';
  IF first_result->>'existing'<>'false' OR second_result->>'existing'<>'true' OR saved_qty<>2 THEN
    RAISE EXCEPTION 'idempotency failure';
  END IF;
  IF has_function_privilege('anon','public.create_reorder_draft(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute server-only function';
  END IF;
  RAISE NOTICE 'PASS: atomic draft, retry deduplication, no overwrite, server-only execution';
END $$;
ROLLBACK;
