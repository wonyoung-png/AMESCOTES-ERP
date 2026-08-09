-- 단가 이력 (2026-08-09)
-- 지금은 단가를 덮어쓰기만 해서 지난 시즌 얼마였는지 볼 수 없다 → 협상 근거가 없다.
-- 바뀔 때마다 한 줄씩 쌓는다. (수정이 아니라 append 전용)
create table if not exists price_history (
  id           text primary key,
  kind         text not null,              -- 'material' | 'factory'
  ref_id       text,                       -- 자재 id 또는 스타일 id
  ref_name     text not null,              -- 자재명 또는 스타일번호
  vendor_id    text,
  vendor_name  text,
  currency     text,
  unit_price   numeric not null,
  prev_price   numeric,
  memo         text,
  changed_at   timestamptz default now(),
  created_at   timestamptz default now()
);

create index if not exists price_history_ref_idx  on price_history (kind, ref_id, changed_at desc);
create index if not exists price_history_name_idx on price_history (kind, ref_name, changed_at desc);

notify pgrst, 'reload schema';
