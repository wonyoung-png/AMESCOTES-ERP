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

## 🔗 연관 코드 필수 확인 규칙
수정 시 반드시 연관된 모든 코드 함께 수정할 것:
- 계산 함수 수정 → 해당 함수 결과값을 사용하는 **모든 표시 코드** 확인
- 변수명 변경 → 해당 변수 참조하는 **모든 곳** 확인
- 예: totalCostKrw 계산 변경 → P&L 분석, 납품가 마진 계산 등 연관 코드도 함께 수정
- 체크리스트: 수정 후 `grep -n "변수명"` 으로 전체 파일 검색 필수

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

## ⚠️ 중요 — 자율 작업 지침
- **중간에 확인 요청하지 말 것** — 대표님이 자리를 비울 수 있음
- 파일 수정/생성/삭제 → 그냥 진행
- 애매한 부분은 **더 나은 방향으로 판단해서** 진행
- 작업 완료 후 변경 내용을 한 번에 요약해서 보고
- `git commit && git push` 까지 자동으로 완료할 것
- 빌드 오류 발생 시 → 스스로 수정해서 오류 없을 때까지 반복

## ⚠️ 절대 수정 금지 - 연동 흐름 (2026-03-24 확정)

### 발주 → 자재구매 연동 흐름 (절대 변경 금지)
```
생산발주 등록 → upsertOrder() → Supabase production_orders 저장 → queryClient.invalidateQueries(['orders']) → 생산발주 목록 갱신

발주 완료 팝업 → "📦 자재 장바구니 담기" → store.addToMaterialCart()

거래처별 발주서 → "✅ 발주 확정" 클릭 →
  1. fetchMaterials() 조회 후 upsertMaterial() → Supabase materials 저장
  2. store.addPurchaseItem() → localStorage 저장 → 자재구매(PurchaseMatching) 탭에 표시
  3. store.clearMaterialCart() → 장바구니 비우기
  4. queryClient.invalidateQueries(['materials'])
```

### 핵심 규칙
- 생산발주 목록: useQuery({ queryKey: ['orders'], queryFn: fetchOrders }) — Supabase
- 자재구매 탭(PurchaseMatching): store.getPurchaseItems() — localStorage (별도 테이블)
- 자재마스터 탭(MaterialMaster): useQuery({ queryKey: ['materials'], queryFn: fetchMaterials }) — Supabase
- 발주 확정은 위 두 곳 모두에 저장해야 함

### 컬러별 BOM 소요량 계산
- 발주 완료 팝업의 bomMaterials: order.colorQtys 기준으로 선택된 컬러만 필터링
- colorQtys가 빈 배열이면 postColorBoms[0] (첫 번째 컬러) 사용
- 절대로 postColorBoms.flatMap() 전체 사용 금지

---

## 🆕 추가 컨텍스트 (2026-06-01 업데이트)

### 운영 서버 설정
- **포트:** 4000 (3000 → 충돌 회피)
- **시작:** `ERP_시작.bat` 더블클릭 또는 `PORT=4000 node dist/index.js`
- **빌드:** `npm run build` (Vite + esbuild)
- **환경변수:** `.env` 파일 (gitignore 됨, 별도 백업 필요)
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `ANTHROPIC_API_KEY` (OCR용)
  - `PORT`

### OCR 기능 (소요량 계산 — 자재 모달)
- **엔드포인트:** `POST /api/yardage/ocr` (server/agent-routes.ts에 통합됨)
- **사용처:** BomManagement.tsx의 "📷 이미지로 입력" 버튼
- **모델:** claude-sonnet-4-5 (Vision)
- **응답 포맷:** `{ leather: [{부위,가로,세로,수량}], fabric: [...] }`
- **추가 기능:** server/agent-routes.ts에 AI 에이전트 팀 (SSE 스트리밍) 포함
- **의존성:** agents/agent-team.ts, agents/erp-mcp-server.ts

### B2B 전환 작업 진행 중
- **참고 문서:** `WORKFLOW.md` (7개 작업 상세 스펙), `PLAN.md` (3주 로드맵)
- **이카운트 6단계 워크플로우** 정합 작업 진행
- **B2C 코드 제거 대상:** SalesManagement의 채널 enum, Settlement B2C 필드
- **핵심 원칙:** `projectCode`(=orderNo)가 모든 전표를 끝까지 꿴다

### 노트북 이어 작업
1. `git clone https://github.com/wonyoung-png/AMESCOTES-ERP.git`
2. `cd AMESCOTES-ERP && npm install --legacy-peer-deps`
3. `.env` 파일 수동 생성 (위 환경변수)
4. `npm run build && PORT=4000 node dist/index.js`
5. Claude에게: "CLAUDE.md, WORKFLOW.md, PLAN.md 읽고 다음 작업 항목부터 시작해라"

### 알려진 이슈 / 잠정 결정
- `linzfvhgswrnoukssqyi.supabase.co` 사용 (Supabase 운영 DB)
- Anthropic Key는 Downloads/.env에서 가져옴 (별도 백업 필요)
- B2B 전환 시 Login/MaterialMaster/TradeStatement 페이지의 워크플로우 정합성 추가 검토 필요
- 빌드 결과물(dist/) 2.4MB — 코드 스플리팅 향후 작업

### 폐기된 디렉토리 (참고)
- `Documents/GitHub/ATLM-ERP/` — 잘못된 zip 기반으로 만든 초기 시도
- GitHub `wonyoung-png/AMESCOTES-ATLM-ERP` — 동일 (private, 일단 둠)
- 본 repo(`AMESCOTES-ERP/main`)가 메인 운영본
