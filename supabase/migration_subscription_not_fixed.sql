-- 구독 상태 '고정비 아님' 추가 (2026-10-12, 운영 DB 적용 완료)
-- 반복 결제지만 매출 연동 변동비(택스리펀 정산 등)인 항목을 합계·목록·감시에서 빼되 기록은 유지.
alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('사용 중','검토 필요','해지 예정','해지됨','고정비 아님'));

update subscriptions set status='고정비 아님', updated_at=now(),
  memo='택스리펀 정산(외국인 관광객 부가세 환급 + 수수료). 매출 연동 변동비 — 대표 확인(10/12) 고정비 아님'
 where id='sub_cuberefund';
