-- 자재 마스터 세부 타입 (2026-08-07)
-- 가죽: 소가죽/양가죽/스플릿/램스웨이드/소가죽 스웨이드
-- 장식: 버클·가락지·링·프레임 등 (품번 코드 분류 없이 선택값으로만 보관)
alter table materials
  add column if not exists sub_type      text,
  add column if not exists plating_color text,
  add column if not exists mold_cost     text,
  add column if not exists season        text;

create index if not exists materials_sub_type_idx on materials (sub_type);
