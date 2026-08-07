-- 자재 마스터 세부 타입 (2026-08-07)
-- 가죽: 소가죽/양가죽/스플릿/램스웨이드/소가죽 스웨이드
-- 장식: 버클·가락지·링·프레임 등 (품번 코드 분류 없이 선택값으로만 보관)
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sub_type      text;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS plating_color text;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS mold_cost     text;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS season        text;

-- 코드가 이미 쓰고 있으나 운영 DB 누락 가능 컬럼 (2026-08-06 brand 개편분)
ALTER TABLE materials ADD COLUMN IF NOT EXISTS brand          text DEFAULT '공통';
ALTER TABLE materials ADD COLUMN IF NOT EXISTS unit_price_usd numeric;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS price_currency text;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS image_url      text;

CREATE INDEX IF NOT EXISTS materials_sub_type_idx ON materials (sub_type);
