# AMESCOTES ERP — Claude Code 컨텍스트

## 프로젝트 개요
- **회사:** (주)아메스코테스 / Atelier de LUMEN
- **업종:** B2B OEM/ODM 핸드백 제조사
- **직원:** 34명 / **매출:** 140억
- **해외 거래처:** 중국, 대만, 호주

## 기술 스택
- **Frontend:** React + TypeScript + Vite (port 3456)
- **UI:** shadcn/ui + Tailwind CSS
- **브랜드 컬러:** Warm Gold (#C9A96E), Near Black (#1C1C1E)

## 개발 서버 실행
```bash
npm run dev
# 또는
npx vite --port 3456 --host 0.0.0.0
```
접속: http://localhost:3456

## 현재 구현된 페이지 (Phase 1 완료)
| 파일 | 기능 |
|---|---|
| VendorMaster.tsx | 바이어 마스터 (코드 2자리, 사업자 회사명 포함) |
| ItemMaster.tsx | 품목 마스터 |
| SampleManagement.tsx | 샘플 관리 (KRW 기준) |
| ProductionOrders.tsx | 생산 오더 |
| DeadlineManagement.tsx | 납기 관리 |
| CostManagement.tsx | 원가 관리 (KRW 기준, CNY 보조) |
| BomManagement.tsx | BOM 관리 (단가 CNY + KRW 환산) |
| TradeStatement.tsx | 거래명세표 |
| SettlementManagement.tsx | 정산 관리 |
| DocumentOutput.tsx | 문서 출력 |
| ExchangeSettings.tsx | 환율 설정 |
| Dashboard.tsx | 대시보드 |

## 주요 설계 원칙
- 바이어 코드: 2자리 고정 대문자 (예: AT, OS, LLL)
- 금액 표시: KRW 크게, CNY 보조 표시
- 환율: 환율 이력 드롭다운 (날짜별 과거 환율 선택)
- 사이드바 순서: 대시보드 → 바이어 → 품목/생산 → 원가/구매 → 정산 → 설정

## Phase 2 개발 예정
- [ ] 원가 계산 고도화 (자재비 + 임가공비 자동 계산)
- [ ] 거래명세표 개선 (세금계산서 연동)
- [ ] 발주/주문 관리
- [ ] 누락 알림 시스템 (BOM 없는 품목, 입고 미처리 발주)
- [ ] AI 음성 빠른 등록

## 깃허브
- 저장소: https://github.com/wonyoung-png/AMESCOTES-ERP
- 작업 완료 후 반드시 push 해주세요

## 작업 규칙
- 한국어 주석 사용
- 빌드 확인: `npx vite build` (오류 없어야 함)
- 작업 완료 후 git commit + push

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
