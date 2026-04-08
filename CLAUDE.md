# AMESCOTES ERP — 하네스 엔지니어링 규칙

## 🔴 절대 금지 (레드라인) — 위반 시 즉시 중단
- 사전원가 관련 파일/코드 수정 금지 (PreCost, preCost, pre_cost 포함된 모든 것)
- Supabase 테이블 DROP/DELETE 금지
- 발주번호/스타일번호/거래처명 중복 생성 금지
- git push 없이 작업 완료 보고 금지
- 빌드 실패 상태로 완료 보고 금지

## ✅ 작업 시작 전 필수 확인
1. `npx vite build` — 현재 빌드 상태 확인
2. Supabase 연결 상태 확인
3. 수정할 파일 목록 확인 (사전원가 파일 포함 여부)

## 📋 작업 완료 체크리스트 (베라 검수용)
- [ ] `npx vite build` 성공 (오류 0개)
- [ ] ESLint 경고 없음 또는 기존 대비 증가 없음
- [ ] 사전원가 파일 변경 없음
- [ ] Supabase 연동 정상
- [ ] 삭제 기능에 confirm 팝업 있음
- [ ] `git add -A && git commit && git push` 완료
- [ ] 발주번호/스타일번호/거래처명 중복 없음

## 🏗️ 코드 구조 규칙
- 모든 데이터 저장: Supabase 우선 (localStorage는 캐시만)
- BOM: 사후원가(postColorBoms) 우선 적용, 없으면 사전원가 폴백
- 공장단가 = 공장구매자재 + 임가공비 + 후가공비 (관세/본사제공/업체제공 제외)
- 10원 단위 올림 적용 (견적서 금액)

## 📁 핵심 파일 목록
- `client/src/lib/store.ts` — 데이터 CRUD, Supabase 연동
- `client/src/lib/syncFromSupabase.ts` — 시작 시 동기화
- `client/src/pages/BomManagement.tsx` — BOM 관리
- `client/src/pages/ProductionOrders.tsx` — 생산발주
- `client/src/pages/ItemMaster.tsx` — 품목마스터
- `client/src/pages/PurchaseMatching.tsx` — 자재구매

## 🔄 작업 흐름
1. 올리브가 체크리스트로 작업 분해
2. 에이스가 직접 실행
3. 빌드 성공 확인
4. 베라 검수 요청
5. 베라 승인 후 git push
6. 올리브에게 완료 보고

## 🗑️ 가비지 컬렉션 기준
삭제 가능한 것:
- 주석 처리된 코드 블록 (기능 삭제 확정 후)
- 사용하지 않는 import
- 더미/시드 데이터 (store.ts에서 완전 제거됨)
- 사용하지 않는 컴포넌트 파일

절대 삭제 금지:
- 사전원가 관련 모든 코드
- Supabase 테이블 스키마 관련 코드
- CLAUDE.md (이 파일)
