# 대표 지시: 광고 분석 전용 구현 교차 검토

읽기 전용으로 실제 소스를 검토하고 한국어로 구체적인 필수 수정만 보고하십시오. 운영 접근·모델/광고 호출·수정·배포·비밀 파일 조회는 금지합니다.

## 범위

프로젝트 `C:/Users/이원영 AMES/AMESCOTES-ERP-ads`, feature branch `shop-insight-agents`, base product-registration 782ab47. `docs/TASK_SHOP_INSIGHT_AND_ADS_AGENTS.md`의 §2만 이번 범위이며 §1의 자사몰 자동 변경은 구현하지 않습니다. 고객 자사몰 화면은 변경하지 않습니다. 대표는 코드 검증 후 Claude가 운영 적용하도록 별도로 지정했습니다.

대상 소스:
- shared/ads-analysis.ts
- server/ads-council.ts, server/ads-council.test.ts
- server/ads-data.ts, server/ads-data.test.ts
- db/016_ads_analysis.sql, db/ads-analysis.integration.test.mjs
- scripts/macmini/ads-runner.sh, scripts/macmini/ads-runner.test.mjs, scripts/macmini/kr.atlm.ads-runner.plist.template
- client/src/pages/AdsAnalysis.tsx, client/src/pages/AdsAnalysis.test.ts
- client/src/App.tsx, client/src/components/Layout.tsx의 광고 분석 추가 부분
- server/index.ts의 추가 라우트/스케줄러, server/ceo.ts와 server/ceo-console.html의 광고 요약 추가 부분
- server/auth.ts의 기존 currentUser/CEO_EMAILS/restAsServer 경계만 필요시 읽으십시오.

실제 결제 주문 연결 `server/ads-orders.ts`는 별도 구현·테스트 중이므로 이번 1차에서는 제외합니다. 최종본 주문 수집과 최종 변경은 후속 실제 검토를 다시 요청합니다.

## 반드시 확인할 업무 흐름

1. LUMEN 권한 사용자 질문/매일 09시 KST 고정 질문 → Opus 계획 → 한 불변 스냅샷 → 서로 답을 모르는 Claude 독립 호출/Codex 풀 러너/Meta 추천 응답 변환 → 각자 교차 검토 정확히 1회 → Claude 최종 결론 → 기록·대표 전용 비서실 3줄/경보.
2. Meta는 고정 호스트 GET만, 쓰기 호출 0건. 추천 지원 안 됨을 가짜 Meta 판단으로 대체하지 않는지. 외부 문자열·질문·다른 모델 답은 비신뢰 데이터, 토큰/개인정보 제외, 서버/직원/대표/러너 권한 분리.
3. 최근14일+직전14일, 캠페인/광고세트 권고만, 근거 ID·정확한 값 검증. 누락값≠0, runner5분실패면 Codex 미참여, 2주 후 방향성 ROAS 채점·4주 집계는 인과 기여도라고 과장하지 않는지.
4. 영속 queue/lease/CAS/불변스냅샷/attempted 호출 도장/중복 요청·동시 일 예산 예약. 120초 lease를30초heartbeat+외부 호출 전후 갱신하며 소유권 상실 때 후속 호출/저장을 차단. 미확인 호출을 다시 실행하지 않아 비용 이중 발생 방지.
5. 기본 실행 플래그 OFF, 수동 접수도503 차단. 서버 운영 비밀값은 조회하지 않았음. 만료2026-11-24 기준14일 전 비서실 알림과 인증 실패 경보. 실제 채널 매핑 없으면 unavailable, 다른 시장 자료 유입 금지.

## 실행 증거/한계

- core7/7→lease 테스트 추가 중, isolated PGlite17/17, runner27/27. TypeScript/빌드 통과(최종 재실행 예정).
- 전체 회귀633 중631통과/2실패는 두 mock Vite브라우저 HMR24678 충돌이며 HMR격리/순차실행으로 재검증 예정. 이를 기능 합격이라고 보고하지 않습니다.
- 화면은 합성 mock 캡처이며 실제 운영 또는 실제 모델 종단간 검수가 아닙니다.
- 독립 Codex 리뷰에서 lease만료 결함을 발견해 heartbeat를 보완했으며 소유권 경합 회귀 추가 중입니다.

## 출력

명세 위반·실무 연결 누락·금액/권한/중복 호출 위험을 우선으로 최대5건의 필수 수정(경로·조건·최소 수정·우선순위). 없으면 명시적으로 없다고 쓰십시오. 정적 검토와 실행 검증을 구분하고 운영 검수 시나리오를 마지막에 간단히 적으십시오. 검사하지 않은 기능을 완료라 하지 마십시오.
