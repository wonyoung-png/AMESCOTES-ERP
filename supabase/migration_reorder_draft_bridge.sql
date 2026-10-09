-- 추천을 ERP 의뢰 초안으로 한 번만 생성한다. 승인·발주·OEM 수락은 기존 흐름에서 수행한다.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_reorder_draft(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.brand_order_batches; bid text := p->>'id';
BEGIN
  IF COALESCE(p->>'workspace','') NOT IN ('LUMEN','AETALOOF')
     OR COALESCE(bid,'') !~ ('^pms-reorder-' || lower(p->>'workspace') || '-[1-9][0-9]*$')
     OR COALESCE((p->>'qty')::int,0) <= 0 OR NOT EXISTS(SELECT 1 FROM items WHERE style_no=p->>'style_no') THEN
    RAISE EXCEPTION 'invalid_reorder';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(bid, 0));
  SELECT * INTO b FROM brand_order_batches WHERE id=bid;
  IF FOUND THEN RETURN jsonb_build_object('batchId',b.id,'existing',true); END IF;
  INSERT INTO projects(id,project_no,workspace,title) VALUES(bid,p->>'project_no',p->>'workspace',p->>'title');
  INSERT INTO brand_order_batches(id,workspace,project_no,title,status,approval_step,created_by)
  VALUES(bid,p->>'workspace',p->>'project_no',p->>'title','draft',1,p->>'created_by');
  INSERT INTO brand_order_lines(id,batch_id,style_no,style_name,qty,memo)
  VALUES(bid||'-line',bid,p->>'style_no',p->>'style_name',(p->>'qty')::int,p->>'memo');
  RETURN jsonb_build_object('batchId',bid,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.create_reorder_draft(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reorder_draft(jsonb) TO erp_server;
NOTIFY pgrst, 'reload schema';
COMMIT;
