-- 작업지시서 — 수기로 적던 칸을 저장한다
--
-- 대표 지시 넷 중 둘이 "적을 곳이 없다" 문제였다.
--
-- 1) 실넘버·지퍼넘버: 지금은 BOM 품명에서 정규식으로 끌어온다("실", "지퍼"가 들어간 품목).
--    대표: "그냥 빈칸으로 냅두고 첫오더때 수기로 입력하면될거같고 추후에 자동 저장되어
--          리오더때는 그대로 불러오게 해줘"
--    컬러별로 다르니 컬러를 키로 쓴다: {"BLACK": {"thread": "F138 흑", "zipper": "5호 YKK"}}
--    리오더 승계는 복사하지 않는다 — 이 발주에 값이 없으면 같은 스타일의 지난 발주에서
--    찾아 보여준다. 거기에 손을 대면 그때 이 발주에 박힌다. 지난 서류가 뒤늦게 바뀌지 않는다.
--
-- 2) 주의사항 / 기존 오더에서 변경된 점: 공장이 꼭 읽어야 하는 말인데 쓸 칸이 없었다.
--    note 는 발주 화면에서 한 줄 넣는 임시값이라 저장되지 않았다.

alter table public.production_orders add column if not exists spec_numbers jsonb not null default '{}'::jsonb;
alter table public.production_orders add column if not exists caution_note text;
alter table public.production_orders add column if not exists change_note  text;
