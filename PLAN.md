# ATLM ERP — B2B 워크플로우 전환 실행 계획서

> **작성 목적**: WORKFLOW.md가 "무엇을 만들지(스펙)"라면, 이 문서는 "**언제 어떤 순서로 어떻게 진행할지**(실행)"를 잡는다.
> **전제**: 데스크톱·노트북 양쪽에서 작업 가능 (Git 동기화).
> **목표**: 이카운트 6단계 워크플로우(수주→발주→납기→입고→원가→결산) 정합 ERP 완성.

---

## 1. 전체 일정 — 3주 로드맵

| 주차 | 단계 | 목표 | 작업 항목 |
|------|------|------|-----------|
| **W1** | Phase 1: 기반 정리 | B2C 잔재 제거 + 데이터 모델 확정 | 작업 1, 2 |
| **W2** | Phase 2: 핵심 워크플로우 | 수주→발주→입고 연결 완성 | 작업 3, 4 |
| **W3** | Phase 3: 정산 + 마무리 | 채권·채무 + UI 정리 + 검증 | 작업 5, 6, 7 |

> 하루 3~4시간 작업 가정. 본업과 병행 시 4주로 늘어날 수 있음.

---

## 2. 작업별 상세 일정

### Phase 1 — 기반 정리 (W1, 5일)

| Day | 작업 | 산출물 | 검증 방법 |
|-----|------|--------|----------|
| 1 | 작업 1: SalesManagement → OemOrderEntry 전환 (UI 골격) | OemOrderEntry.tsx 신규, 라우트 변경 | http://localhost:4000/oem-orders 접속 시 빈 화면 표시 |
| 2 | 작업 1: OemOrder 인터페이스 + store.ts 함수 추가 | store.ts에 saveOemOrder/getOemOrders 구현 | 수주 1건 등록 → localStorage 확인 |
| 3 | 작업 1: projectCode 자동생성 + 거래처 드롭다운 연동 | generateProjectCode 함수, 바이어 필터링 | NW2026-001 형식 코드 자동 발급 확인 |
| 4 | 작업 2: SalesRecord·Settlement 인터페이스 제거 | store.ts B2C 코드 삭제, 마이그레이션 헬퍼 | 빌드 성공 + localStorage 마이그레이션 동작 |
| 5 | 작업 2: VendorReceivable/VendorPayable 인터페이스 추가 | 신규 타입 정의 + 기본 CRUD 함수 | 타입 컴파일 통과 |

**W1 끝 결과물**: B2B 수주 등록 가능, B2C 흔적 모델/UI에서 제거 완료. 발주·입고는 아직 분리 안 됨.

---

### Phase 2 — 핵심 워크플로우 (W2, 5일)

| Day | 작업 | 산출물 | 검증 방법 |
|-----|------|--------|----------|
| 6 | 작업 3: ProductionOrder 인터페이스 확장 (projectCode, vendorCategory 추가) | store.ts 모델 업데이트 | 기존 데이터 마이그레이션 |
| 7 | 작업 3: 발주서 1:N UI — 수주 선택 후 발주서 N개 추가 가능 | ProductionOrders.tsx 리팩토링 | 한 수주에 3장 발주서 등록 가능 |
| 8 | 작업 3: 발주서 그룹 뷰 (projectCode별 카드) + 검증 로직 | 그룹 카드 컴포넌트 | NW2026-001에 묶인 발주서 3장 보임 |
| 9 | 작업 4: PurchaseItem 인터페이스 확장 (poId, landedCostKrw 등) | store.ts 모델 + distributeOverhead 함수 | 부대비용 분배 단위 테스트 |
| 10 | 작업 4: PurchaseMatching UI — 부대비용 입력 + 착지원가 자동 표시 | 입고 모달 개편 | 운임 100만원 입력 시 금액 비중대로 분배되는지 확인 |

**W2 끝 결과물**: 한 수주 → N개 발주서 → 입고(부대비용 포함) → 착지원가까지 흐름 완성.

---

### Phase 3 — 정산 + 마무리 (W3, 5일)

| Day | 작업 | 산출물 | 검증 방법 |
|-----|------|--------|----------|
| 11 | 작업 5: SettlementManagement → VendorReceivables 리네임 + 채널 필터 → 바이어 필터 | VendorReceivables.tsx | 채권 화면에 B2B 데이터만 표시 |
| 12 | 작업 5: VendorPayables 신규 페이지 | VendorPayables.tsx + 자동 채무 생성 로직 | 입고 등록 시 채무 자동 생성 확인 |
| 13 | 작업 5: ExpenseEntry(지출전표) 연동 — 채무 지급 시 자동 전표 발행 | 지출전표 연결 로직 | 지급 처리 시 ExpenseEntry에 기록 |
| 14 | 작업 6: Layout 사이드바 재구성 + 작업 7: validators.ts | Layout.tsx 업데이트, 공통 검증 헬퍼 | 사이드바 워크플로우 순서대로 정렬 |
| 15 | E2E 테스트 (WORKFLOW.md의 10단계 시나리오) + 버그 수정 | 테스트 통과 보고서 | 10개 시나리오 모두 PASS |

**W3 끝 결과물**: 이카운트 6단계 워크플로우 100% 정합 + 모든 전표에 projectCode 강제 + 사이드바 정리 완료.

---

## 3. 의사결정 필요 사항 (작업 시작 전 답변 필요)

| # | 결정 사항 | 옵션 | 권장 |
|---|----------|------|------|
| 1 | **기존 B2C 데이터 처리** | (a) 백업 후 삭제 / (b) export 파일로 보존 후 삭제 / (c) 그대로 두고 메뉴만 숨김 | **(b)** — 1회성 export 후 깔끔 제거 |
| 2 | **projectCode 형식** | (a) `NW2026-001` (바이어 prefix) / (b) `2026-03-001` (날짜 prefix) / (c) 사용자 직접 입력 | **(a)** — 한눈에 바이어 식별 가능 |
| 3 | **부대비용 분배 기준** | (a) 금액 비중 / (b) 수량 비중 / (c) 무게 비중 | **(a)** — 가장 일반적, 회계 표준 |
| 4 | **데이터 저장소 통일** | (a) localStorage 유지 / (b) Supabase 전면 이행 | **현재는 (a)**, 작업 5 끝나면 (b)로 마이그레이션 별도 진행 |
| 5 | **사이드바 메뉴 6️⃣ 표기** | (a) 이모지 번호 유지 / (b) 텍스트 번호 "STEP 1" / (c) 번호 없이 그룹만 | **(c)** — 깔끔, 이모지는 가독성 떨어짐 |
| 6 | **End-to-End 테스트 데이터** | (a) 실제 거래처 (NW, OSOI) 사용 / (b) 더미 데이터 (Test Buyer) | **(b)** — 운영 데이터 오염 방지 |

→ **이 6개 결정 후 작업 시작**.

---

## 4. 리스크 및 대응

| 리스크 | 발생 가능성 | 영향도 | 대응 |
|--------|------------|--------|------|
| 기존 localStorage 데이터 손상 | 中 | 高 | 작업 2 시작 전 localStorage 전체 export → 파일 백업 |
| ProductionOrders 1:N 변경 시 기존 발주 데이터 깨짐 | 高 | 中 | 마이그레이션 헬퍼: 기존 orderNo → projectCode='LEGACY-{orderNo}'로 채움 |
| Supabase 미연동 데이터로 인한 데스크톱·노트북 불일치 | 高 | 中 | 작업 5 완료 후 Supabase 전면 이행 별도 스프린트 |
| BOM 관리의 "소요량 계산 이미지로 입력" 미구현 잔존 | 中 | 低 | 별도 이슈로 분리, Phase 3 이후 처리 |
| 빌드 에러 (의존성 충돌) | 中 | 中 | 작업마다 `npm run build` 통과 확인 후 커밋 |
| 머지 충돌 (데스크톱·노트북 양쪽 작업 시) | 中 | 中 | 한 번에 한 PC에서만 작업, 작업 후 즉시 push |

---

## 5. 매일 운영 루틴

### 작업 시작
```bash
git pull                          # 최신 상태 동기화
npm install --legacy-peer-deps    # package.json 변경 시
git checkout -b feat/task-N       # 새 브랜치
```

### 작업 중
- WORKFLOW.md의 해당 작업 섹션 그대로 따라가기
- 스펙 변경 필요 시 → 먼저 WORKFLOW.md 수정 → 그 다음 코드 수정
- 30분 이상 막히면 → CLAUDE.md에 "막힌 지점" 기록 후 다음 작업으로 우회

### 작업 종료
```bash
npm run build                     # 빌드 통과 확인
git add -A
git commit -m "feat: complete task N - [요약]"
git push
# 작업 N의 CLAUDE.md 상태 🔴 → 🟢 업데이트 후 별도 커밋
```

---

## 6. 진척도 체크리스트 (살아있는 문서)

작업 완료 시 `[ ]` → `[x]`로 변경 후 푸시.

### Phase 1 (W1)
- [ ] 작업 1.1: OemOrderEntry.tsx 신규 + 라우트 변경
- [ ] 작업 1.2: OemOrder 인터페이스 + CRUD 함수
- [ ] 작업 1.3: projectCode 자동생성 + 바이어 드롭다운
- [ ] 작업 2.1: B2C 인터페이스(SalesRecord/Settlement) 제거
- [ ] 작업 2.2: VendorReceivable/VendorPayable 신규 인터페이스
- [ ] 작업 2.3: 마이그레이션 헬퍼 실행 및 검증

### Phase 2 (W2)
- [ ] 작업 3.1: ProductionOrder 모델 확장 (projectCode, vendorCategory)
- [ ] 작업 3.2: 발주서 1:N UI 구현
- [ ] 작업 3.3: projectCode별 그룹 뷰 + 검증
- [ ] 작업 4.1: PurchaseItem 모델 확장
- [ ] 작업 4.2: distributeOverhead 알고리즘
- [ ] 작업 4.3: 부대비용 입력 UI + 착지원가 표시

### Phase 3 (W3)
- [ ] 작업 5.1: SettlementManagement → VendorReceivables 전환
- [ ] 작업 5.2: VendorPayables 신규 페이지
- [ ] 작업 5.3: 자동 채무 생성 (syncPayableFromPurchase)
- [ ] 작업 5.4: ExpenseEntry 연동
- [ ] 작업 6.1: 사이드바 재구성
- [ ] 작업 6.2: B2C 메뉴 제거
- [ ] 작업 7.1: validators.ts 신규
- [ ] 작업 7.2: 전 폼에 projectCode 검증 적용
- [ ] 작업 7.3: 대시보드 누락 전표 경고 카드
- [ ] E2E 테스트 10단계 통과

---

## 7. 완료 후 다음 단계 (참고)

Phase 3 완료 후 별도 진행 권장 작업 (이 문서 범위 외):

1. **Supabase 전면 이행** — localStorage 의존 제거, 양 디바이스 실시간 동기화
2. **샘플 관리 워크플로우 정합** — 현재 SampleManagement는 별도로 있는데 수주 흐름과 연결 약함
3. **BOM 소요량 계산 OCR 기능** — 미해결된 "이미지로 입력" 기능
4. **다중 사용자 권한 관리** — 직원 35명 환경에서 권한 분리
5. **이카운트 데이터 일방 import** — 기존 이카운트 데이터를 ATLM ERP로 옮기는 작업

---

## 8. 즉시 실행 단계 (지금 바로 할 일)

```
1. 이 문서(PLAN.md) 검토 후 의사결정 6가지 답변
2. WORKFLOW.md 작업 1 섹션 정독
3. git checkout -b feat/task-1
4. SalesManagement.tsx → OemOrderEntry.tsx 리네임 + 라우트 수정부터 시작
```

→ **첫 커밋은 30분 안에 가능. 일단 빌드만 깨지지 않게.**
