-- 자재 마스터 개편 (2026-08-06)
-- 1) 브랜드 전용 자재 컬럼  2) 코드가 이미 쓰고 있으나 운영 DB에 없던 컬럼  3) 카테고리 재분류
alter table materials
  add column if not exists brand          text default '공통',
  add column if not exists name_en        text,
  add column if not exists unit_price_cny numeric,
  add column if not exists unit_price_krw numeric,
  add column if not exists unit_price_usd numeric,
  add column if not exists price_currency text,
  add column if not exists image_url      text;

update materials set brand = '공통' where brand is null;
update materials set category = '가죽' where category = '원자재';
update materials set category = '장식' where category = '부자재';

create index if not exists materials_brand_idx on materials (brand);
