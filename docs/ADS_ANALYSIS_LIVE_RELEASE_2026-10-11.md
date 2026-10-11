# ERP·광고 분석 운영 반영 — 직접 실행 결과

확인 시각: 2026-10-11 23:25 KST. 대표님이 Codex 직접 운영 배포·DB 적용을 승인했습니다. 이 문서는 이전 운영 미설치 진단/준비 기록을 대체하는 최신 실행 상태이며, **광고 자동 분석 전체 완료나 대표 피드백만 남았다는 판정이 아닙니다.**

## 운영 적용 결과

| 항목 | 실제 증거 |
|---|---|
| 적용 대상 | ames-new/ap-northeast-2/i-0cf424d627db8b063, erp.ameserp.kr |
| 앱 릴리스 | 3e8089e95af4b2c72b7eea6175523ce18bbadd63, aws-migration 정상 fast-forward push |
| 실행 이미지 | sha256:b2cb888e693d9144a5e2eee426aa2271c1ca79a8d3cb9c67ab01ced48bb09e48, healthy·재시작0 |
| 앱 일치 증명 | 실행 중 dist 전체+package.json이 별도 사전빌드 릴리스와 SHA256 목록 일치. 라이브 node사용자가 dist전체 읽기 가능 |
| DB | 7개 신규 migration을 단일 트랜잭션으로 적용. 광고4테이블+product_listings/channel_tokens/sample_workflow_settings 존재. 기존 업무 guard6개 enabled |
| 권한 | anon 광고테이블 직접권한0. 무인증 분석API403 JSON, 러너API401 JSON, REST401 JSON |
| 정상 응답 | ERP·CEO health200 JSON. /ads-analysis200 HTML은 SPA화면 제공 증거이며 로그인 후 전체실무 검증이라고 주장하지 않음 |
| 저장 제한 해제 | ERP API/REST·CEO 가상경로POST404/401/403, 임시503 없음. Caddy원본복원 일치, timer enabled·active |
| 설정 경계 | ERP_PRIVATE_MODE=true, ADS_ANALYSIS_ENABLED=false, 상품쓰기/OAuth갱신=false. Meta설정은 실행앱에 전달됨. 비밀값 출력0 |
| 실제 Meta 연결 | GET account조회 성공, 의도한 계정 일치·status1·KRW. 광고쓰기0 |

## 백업·검증·차이 대응

서버 전용 mode0700 백업: `/opt/app/backups/ads-rollout-3e8089e95af4b2c72b7eea6175523ce18bbadd63`. erp.dump/roles/schema/private환경/compose/원본코드/기존함수·ACL·trigger/직전image/fresh pre-switch.dump 보존. 민감 파일은 외부로 복사하거나 내용 출력하지 않았습니다. 격리 실제백업 복원·원자 migration·원장 주요테이블 건수 동일·기존함수/권한/trigger복구증명 실제 통과. 운영복구 커밋 e9ed585는 기존1ceb614와 tree동일인 일반 fast-forward revert이며 운영에는 적용하지 않았습니다.

처음 전환 시 rollback proof의 PostgreSQL 내부char 연결이 모호하여 **운영 변경 전에** 실패했습니다. tgenabled::text로 수정 후 재실행 성공했습니다. 실패를 배포 성공으로 기록하지 않았습니다.

서버에 설치된 실제 auto-deploy.sh는 저장소 신형과 달리 `.deployed/erp`를 쓰지 않는 구형입니다. 자동교체·health·배포로그는 성공했지만 전환 helper가 기록을 기다렸습니다. Claude 추가 검토 후 scripts/ads-rollout-attest.sh로 실제 앱파일/DB/health/Caddy 일치를 검증하고 검증된 marker를 기록했습니다. HEAD만으로 성공을 추정하지 않았고, 자동배포기를 수동 실행하거나 compose로 앱을 수동 교체하지 않았습니다. 검증된 성공 후 switch가 원래 Caddy로 복원했습니다.

사전빌드 이미지는 private umask로 들어간 원본 정적파일이 node에게 읽히지 않을 수 있어, 파일대조만 root로 읽었습니다. **실제 운영앱은 node의 전체dist 읽기 가능을 별도 확인**했습니다. 사전빌드 private 이미지를 그대로 운영 복구에 사용하지 않습니다.

## 실행 식별자

| 실행 | SSM command ID / 결과 |
|---|---|
| 백업/사전빌드 | 4f5c32f4-9a56-4f33-b39d-43236f13b1a8 / Success |
| 실제백업 격리리허설 | dcd3d610-240a-480c-b18f-ae956e7903e0 / Success |
| Meta GET | 2d1d3857-451f-4cb5-a5f8-e108ff416048 / Success |
| 내부 daily 참조검사 | e3949fd8-32d0-434a-90d6-09ff0bf79d16 / Success, 보호4테이블 runtime소스참조 없음; 옛 정적bundle의samples참조만 존재 |
| 최초 proof 실패 | 4de0830b-5731-4e91-98b4-7aa986fcbaec / Failed, 운영쓰기 전 |
| 운영 전환 | 100f13ac-0cb7-4610-8715-4d50dc9930ba / Success, DATABASE_MIGRATIONS_COMMITTED·AUTO_DEPLOY_VERIFIED |
| exact앱 증명 | edd18fcf-7cb5-4a67-adc1-846203d520c4 / Success, LIVE_RELEASE_ATTESTED |
| 앱/DB/API 실제진단 | 48b94553-39c8-4059-b2ec-825734d1af27 / Success |
| CEO·저장제한 해제 | 488d8c86-8cf8-4e2b-971b-3df53c438409 / Success |

## 검수·비용

이 통합본 타입/빌드 통과. 전체669+격리SQL53+보조13=735개 통과. Windows CRLF 테스트입력 LF정규화만 반영, 운영 기대값/로직을 약화하지 않았습니다. 실제 운영자료를 테스트 입력으로 사용하지 않았습니다.

Claude 공통 읽기 전용 실제 검토7회: USD1.11+0.38+0.41+0.71+0.59+0.57+0.27 = **USD4.04**. 기존 광고 구현6회 USD4.30과 별도입니다. 결과는 CLAUDE_REVIEW_RESULT_ADS_ROLLOUT{,_PREPARE,_REHEARSAL,_SWITCH,_ATTEST}.md에 기록. 마지막 attestation검토의 P1 Caddy원본동일/런타임범위 지적은 코드보강 및 실제cmp로 검증했습니다. Claude는 실제 운영 실행·광고 수정 권한을 받지 않았습니다.

## 아직 남은 작업 — 자동 분석 활성화 차단

1. 맥미니 러너 미설치, 서버/러너 공통 ADS_RUNNER_TOKEN 미설정. 실제 독립결론·교차검토 폴링 미검증.
2. 국내/해외 campaign·주문·SKU/재고위치 매핑 및 커머스 read권한 검증 미완료. verified:true를 추정 등록하지 않았습니다. Cafe24 ERP전용 토큰 등록/갱신은 별도 허용된 재연결 절차 필요; 실제 상품쓰기/OAuth 자동갱신 금지 유지.
3. ADS_ANALYSIS_ENABLED=false이므로 09시유료분석·실제질문·후속채점은 미실행. 로그인한 대표 사용 시나리오·비서실 실제분석 결과 검증 미완료.
4. 현행 scheduler는 분석OFF일 때 만료알림도 실행하지 않습니다. 2026-11-24 만료 / 11월10일 알림을 분석활성화와 독립하도록 추가 수정·검증 필요. 아직 만료알림이 운영에서 자동 동작한다고 주장하지 않습니다.
5. 서버 구형 auto-deploy의 영속완료표시·실패재시도 보강 설치는 별도검토 필요. 이번배포는 실제앱파일로 증명하여 성공했지만 구형배포기 자체를 정비했다는 의미가 아닙니다.

법인원장분리·재무실자료입력·직원개방은 진행하지 않았습니다. 현 상태는 **ERP 운영 통합 및 광고화면/읽기전용 API 설치 확인, 광고 자동분석 활성화 대기**입니다.
