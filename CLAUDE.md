# AMESCOTES ERP — 하네스 엔지니어링 규칙

## 🔴 레드라인 (자동 차단)
- **빌드 실패 상태로 커밋 금지** → pre-commit hook이 자동 차단
- **Supabase 테이블 DROP/DELETE 금지** → 데이터 복구 불가
- **발주번호/스타일번호/거래처명 중복 생성 금지**

## 🟡 주의사항 (확인 후 진행)
- Supabase 스키마 변경 시 → 올리브에게 보고 후 진행
- 기존 기능 제거 시 → 대표님 확인 후 진행
- 대량 데이터 수정 시 → 백업 후 진행

## ✅ 작업 시작 전 필수 확인
1. `npx vite build` — 현재 빌드 상태 확인
2. Supabase 연결 상태 확인 (linzfvhgswrnoukssqyi.supabase.co)
3. 개발 서버 실행 상태 확인 (localhost:3000)

## 📋 작업 완료 체크리스트 (베라 검수용)
- [ ] `npx vite build` 성공 (오류 0개)
- [ ] 요구사항 모든 항목 구현
- [ ] Supabase 연동 정상 (데이터 저장/조회 확인)
- [ ] 삭제 기능에 confirm 팝업 있음
- [ ] `git add -A && git commit && git push` 완료
- [ ] 발주번호/스타일번호/거래처명 중복 없음

## 🏗️ 코드 구조 규칙
- 모든 데이터 저장: Supabase 우선 (localStorage는 캐시만)
- BOM: 사후원가(postColorBoms) 우선 적용, 없으면 사전원가 폴백
- 공장단가 = 공장구매자재 + 임가공비 + 후가공비 (관세/본사제공/업체제공 제외)
- 10원 단위 올림 적용 (견적서 금액)

## 📁 핵심 파일
- `client/src/lib/store.ts` — 데이터 CRUD, Supabase 연동
- `client/src/lib/syncFromSupabase.ts` — 시작 시 동기화
- `client/src/pages/BomManagement.tsx` — BOM 관리
- `client/src/pages/ProductionOrders.tsx` — 생산발주
- `client/src/pages/ItemMaster.tsx` — 품목마스터
- `client/src/pages/PurchaseMatching.tsx` — 자재구매

## 🔄 작업 흐름
1. 올리브 → 체크리스트로 작업 분해
2. 에이스 → 직접 실행
3. 빌드 성공 확인 (pre-commit hook 자동)
4. 베라 → 검수 요청
5. 베라 승인 → git push
6. 올리브 → 완료 보고

## 🗑️ 가비지 컬렉션 (매주)
- 사용하지 않는 import 제거
- 주석 처리된 코드 블록 정리
- 콘솔 로그 디버그 코드 제거
- 번들 크기 확인 (목표 2MB 이하)
