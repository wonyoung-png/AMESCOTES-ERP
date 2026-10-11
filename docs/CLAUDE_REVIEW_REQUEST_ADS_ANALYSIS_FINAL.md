# 광고 분석 수정 후 최종 정적 교차 검토

프로젝트 `C:/Users/이원영 AMES/AMESCOTES-ERP-ads`. 읽기 전용, 운영/외부API/모델/테스트/배포/파일수정/비밀값 조회 금지.

## 원래 요구/변경 범위

docs/TASK_SHOP_INSIGHT_AND_ADS_AGENTS.md §2만. Meta GET전용·광고생성/변경0, LUMEN오늘/질문/기록, 같은스냅샷의Claude·Codex·Meta독립→각1회교차→Opus최종, 매일09KST, 맥미니풀/5분미참여, 비서실요약/토큰14일전경보. §1/운영 배포는 범위 밖.

기존 요청 CLAUDE_REVIEW_REQUEST_ADS_ANALYSIS.md와 실제결과 CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md를 읽고 아래 최신 소스를 검토하십시오:
- server/ads-council.ts 및 .test.ts
- server/ads-context.ts 및 .test.ts (새 대규모컨텍스트 제한)
- server/ads-data.ts 및 .test.ts
- server/ads-orders.ts 및 .test.ts (이번에는 **포함**)
- shared/ads-analysis.ts
- db/016_ads_analysis.sql, db/ads-analysis.integration.test.mjs
- scripts/macmini/ads-runner.sh, ads-runner.test.mjs, kr.atlm.ads-runner.plist.template
- client/src/pages/AdsAnalysis.tsx/test.ts, client/src/components/Layout.tsx/App.tsx 광고 추가 부분
- server/index.ts/ceo.ts/ceo-console.html 추가 부분
- docs/ADS_ANALYSIS_DONE.md, ADS_ANALYSIS_SURFACE.md, ADS_ANALYSIS_DESIGN_CHECK.md
- 기존 server/channels/common.ts/shopify-client.ts/cafe24-auth.ts는 주문 읽기/읽기 전용 token(false) 연결 확인에 필요한 부분만.

## 1차 지적 반영 — 반드시 실제 코드로 확인

1. 기본 export3인자 signal 전달, 이미 취소된 기본 export 회귀. 30초heartbeat/120초lease, 경합 중 owner 상실 시 model/collect/save차단 및 순차GET중단. 180초모델+180초수집 fakeclock검증.
2. 유료 모델 전 읽기 준비/데이터 없음0호출·컨텍스트 크기 검사. 원본불변·동일ID/hash의80facts/28000자14일 캠페인/광고세트 projection; 광고/일/7일 인용 및 actions 제외, 잘린범위partial/결론범위경고. 과도한peer출력도 bounded. 계획→독립→1교차→최종4호출.
3. 전체account 캠페인 지출 vs 양시장 검증매핑 합집합, 미매핑지출 partial/경보. 새캠페인을 이름으로 시장추정하지 않음. 실패된연결은유료계획없음.
4. next_check_at 컬럼/claim기준, 같은대기상태save는+30초·전환은즉시, 반복이false로중단하지않아타시장질문선점. PGlite실행18/18.
5. 최근스냅샷actualexpiry/auth실패를비서실알림으로upsert(on_conflict=id)하고 응답ok확인. verifiedrenewedenv만새만료사용, 정상은cleared로보존·비서실숨김.

## 주문·채점·검증 경계

- Shopify2026-10paid/non-testorder countryenum+actualamount/UTM query만 POST. 두literalqueries공식schema검증 성공. 이름/email/fulladdress미요청.
- Cafe24 기존몰+검증된단일시장shop mapping만 GET minimal fields, token(false), 쓰기/OAuth갱신강제OFF. 혼합국가/매핑없음미확인, UTM미지원값0아님.
- 주문전체개인기록은 snapshot에저장하지않고집계만. Meta실행모든GET, 별도0write테스트.
- 실제Documents/meta_ai_truth/score.py의평균기준을 읽어 적용: 후속동일시장/단위 집행액가중평균ROAS대비확대≥평균/축소<평균. 미집행/누락≠0, 유지미채점. 방향적중률을 광고변경인과효과로 주장안함.
- 4주집계는100건기록목록과별도쿼리, 14일후수집은시장별하루1회재사용·장애날 영구0채점안함.
- 실행증거: core/context/data/orders65/65, SQL광고18/18, UI3/3, runner27/27. 전체회귀중간649/649와타입/빌드통과, 모든수정후 최종재실행예정. 실제 운영/model/Meta/commerce/맥미니실행은0건.
- UI종료검수의단계모두진행중1건수정은동일6캡처재확인 후 reviewer ship(해당1건범위), incumbentPretendard/양테마문서확인. 운영UI합격아님.

## 답변

1차 필수5건 각각 해결/미해결과 경로. 주문 포함 최신 코드의 **필수 차단 오류가 있으면 최대3건** 경로·조건·최소수정으로 보고. 없으면 없다고 명시. 운영에 남은검증과 코드결함은구별하십시오. 로그/테스트를실행한것처럼보고하지마십시오.
