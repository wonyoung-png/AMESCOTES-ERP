-- 자재 마스터 저장 누락 컬럼 (2026-08-07)
-- tableColumns.ts 화이트리스트에는 있으나 운영 DB에 없어 저장 시 해당 값이 버려지던 항목.
alter table materials
  add column if not exists sub_type      text,
  add column if not exists plating_color text,
  add column if not exists mold_cost     text,
  add column if not exists season        text;

notify pgrst, 'reload schema';
