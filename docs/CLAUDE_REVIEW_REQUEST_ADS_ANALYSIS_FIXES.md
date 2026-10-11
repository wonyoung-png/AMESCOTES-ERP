# 광고 분석 차단3건 수정 확인

프로젝트 C:/Users/이원영 AMES/AMESCOTES-ERP-ads. 읽기 전용 소스/대표메모리 검토만. 운영/외부API/모델/테스트/배포/비밀값/파일수정 금지. common launcher $5한도·resume없음.

원요구 TASK_SHOP_INSIGHT_AND_ADS_AGENTS.md §2, 최신 지시 Meta GET전용·3모델독립→1회교차→Opus최종/09KST/비서실14일전 알림. 운영 적용 금지. 이전 요청 FINAL 및 실제 RESULT 문서의 2차 필수3건만 좁혀 검토하십시오.

1. server/ads-orders.ts/test.ts: ready nonMeta/lastVisit null은 원문없이 non_meta, Meta numeric campaign 미준비/잘못된ID는 unknown partial. 실제 reader→createAdsCollector 연결 테스트에서0/1/unknown 분리. 임의 private source 미저장.
2. server/ads-context.ts/test.ts: 실제9지표×2기간 형태, 핵심현재6+이전3+정책최대3만, campaign24/adset40/account16 총80 JSON28000. 원본불변, sameID/hash/allparticipant context. 3개이상 adsets 보존 및spend/ROAS페어. server/ads-council.ts/test.ts groundedText 치환뒤700상한. 최종peer출력 최대치 모킹 count_tokens16001→paidcreate0 테스트. 실제 token counter 호출은 금지했으므로 진짜 입력 토큰 수 합격으로 주장하지 않음; 런타임16000사전검사 유지.
3. council list/contribution/office/notice JSON필드thin projection, rawsnapshot는 get(id)선택상세만. list tokenExpiresOn metadata로만료표시, UI 기존selection→GETdetail 유지. notice sources/token/checkedAt 최신snapshot있는1건 only; upsert 응답검사/cleared 유지. flat response 계약 회귀. PostgREST 실제서버문법·성능은운영검수대상.

검토 대상 ads-orders.ts/test.ts, ads-context.ts/test.ts, ads-council.ts/test.ts, shared/ads-analysis.ts, client/src/pages/AdsAnalysis.tsx의index/detail읽기부분, docs/CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md, ADS_ANALYSIS_DONE.md. 그 외 광범위 재탐색 불필요.

코덱스가 모킹/격리 테스트와타입/빌드를 실행중입니다. Claude 직접 실행이라고 보고하지 마십시오. 3건 각각 해결/미해결과최소근거, 수정으로새롭게생긴필수차단오류만보고. 남은 운영검증과코드결함분리. 광고생성/수정경로 추가 금지.
