-- 구독 분류 '임대·리스' → '임대' / '리스' 분리 (2026-10-12, 운영 DB 적용 완료)
-- 순서 주의: 제약 제거 → 행 재분류 → 제약 재생성 (반대로 하면 기존 행 때문에 실패)
alter table subscriptions drop constraint if exists subscriptions_category_valid;

-- 기존 8건 재분류: 캐피탈 리스 4건 → 리스, 사무실·쇼룸 임대 4건 → 임대
update subscriptions set category='리스', updated_at=now() where id in ('sub_kb_capital','sub_nh_capital','sub_im_capital','sub_hana_capital');
update subscriptions set category='임대', updated_at=now() where id in ('sub_kang_rent','sub_joybuilding','sub_sinnae','sub_promenade');
update subscriptions set category='임대', updated_at=now() where category='임대·리스';

alter table subscriptions add constraint subscriptions_category_valid
  check (category in ('AI 도구','마케팅','업무 도구','인프라','임대','리스','렌탈·유지보수','대행·자문','통신·보안','기타'));
