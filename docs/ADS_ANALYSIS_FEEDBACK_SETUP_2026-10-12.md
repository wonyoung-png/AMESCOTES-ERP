# ERP·광고 분석 — 피드백 전 설정 현황

2026-10-12 KST. **운영 설정·읽기 전용 화면 확인 완료 범위와 신규 인증 차단을 구분합니다. 대표 피드백만 남았다는 판정은 아닙니다.**

## 실제 적용·확인

| 항목 | 결과 |
|---|---|
| 운영 앱 | 최종 heartbeat/LF 보강본 aws-migration 정상 fast-forward / a62ee0f330baf486fefa1872ab4bff3a96554daa, HEAD와성공marker일치 |
| 실행 이미지 | 최종 sha256:231a2d67781f98a3766b23d269d0f91b391cb487d475ce97be7cc9bfe3864672, running·healthy·재시작0 |
| 1차 서버 bundle 참고 | 6e05c59 당시 /app/dist/index.js SHA256 536d7dd9ceb66d3eb985d9db8cb389651cf02f9418647581346e3d6a686614ba. 최종a62앱hash나로컬Windowsbundle동일증거로사용하지않음 |
| 자동 배포 | erp-auto-deploy.timer enabled/active. 검토 helper blob과 설치본 동일. 실제 이미지 백업, 실패 기동·health 복구, 실패 SHA 재기동 차단. 수동 실행 없음 |
| DB | 전일 7개 migration 유지. 이번 설정에서 추가 운영 migration 없음 |
| 권한 | ERP_PRIVATE_MODE=true 유지. 무인증 광고 API403, 러너401, REST401 |
| Meta | 의도한 계정, 전체25 캠페인/101 adset/3 GET, 거부0. 실제 국가 대조 국내21·해외4. Meta 쓰기0 |
| 매핑 | 검증된 campaignIds만 서버 env에 등록하고 실행앱 KR21/GL4 재확인. SKU/재고위치/예산 최소단위는 추정하지 않음 |
| 만료 알림 | 분석OFF에서 meta_token DB 저장 실제 확인: cleared, expiresOn2026-11-24, checkedAt2026-10-11T16:00:42.572Z. 14일 전2026-11-10 활성화는 합성 시계 테스트로 확인, 실제 미래 실행이라고 주장하지 않음 |
| 맥미니 | RSA-OAEP 암호문으로만 페어링. runner.json0600/부모0700, runtime0700, plist0600. 실제 인증 GET200·job:null |
| 상시 러너 | LaunchAgent kr.atlm.ads-runner 등록, GUI501, 실제 프로세스25371 running 지속 확인. 재로그인 후 자동 시작; GUI 로그인 없는 부팅 실행은 미지원·자동로그인 보안 설정 미변경 |
| 러너 오류 수정 | 기존 tracked shell CRLF로 exit2 확인. 실제 LF 정규화 후 launcher --once 종료0, 상시 재기동 running. installer의 LF 정규화 및 회귀검사 추가 |
| 임시 비밀 정리 | 우리 bootstrap 개인키·암호문·전송 임시파일만 제거. 상시 runner.json과 실행 파일 유지. 서버 env 백업은0700/0600 보호 상태로 보존, 외부 복사 금지 |

실제 맥미니 파일이 검토 소스를 LF 정규화한 결과와 SHA256 동일: runner dbf4c81de12544a32242b62544d945e43d4c2911508d105e20127070eedf474d, launcher5c900701d4e9e1fc745ebd72c2f36b53a7820e072dedf341fc65e00e887ccab7. 동일 PID25371의 running 지속 확인. Git index는 기존에도LF였으나 Windows 변환/아카이브에 LF 규칙이 없어 실제 전달본CRLF 발생; .gitattributes로checkout/archive규칙고정, 원본파일CR검사에서테스트전정규화제거.

검토 커밋a62ee0f의 실제 git archive를 맥미니에서 재검사: shell CR0, 위SHA와동일(COMMITTED_ARCHIVE_POSIX_LF_VERIFIED=true), 임시archive만정리. Anthropic SDK models.list 실제읽기 성공, 설정된claude-opus-5-5 접근목록에존재, morePages=false, paidGenerations0 (SSM d0f32246-63d5-41a9-a1db-de66e2a8699f). 이는 실제독립의견·교차검토 생성증거가아님.

후속 heartbeat 보강: 인증된 macmini 접속시각을 기존 notices 고정row에 분당1회저장. 분석OFF여도접속만기록하고lease/유료모델호출없음. 저장실패시503으로작업배정보류(안전정책),서버재시작후즉시1회저장가능. 비서실은5분내연결/이후지연/없음·미래시각미확인을표시하며실제모델참여와구분. 최종검토P0/P1없음.

**최종 실제 운영 확인:** SSM d4dc0d76-d74a-4abc-979e-67f2e37d7f88 Success. 새앱a62와성공marker일치, 위최종imagehealthy/0restart, 타이머active/helper검토blob동일, privateMode=true/analysisEnabled=false/runnerTokenPresent=true/KR21/GL4. codex_runner 연결시각2026-10-11T16:13:04.097Z, Meta연결확인2026-10-11T16:12:45.247Z, 실제분석run0. 대표Chrome비서실새로고침에서 `Codex 러너 연결됨 · 2026-10-11T16:13:04.097Z · 모델 분석 참여 여부와 별개` 문구 실제확인. guest403/runner401/REST401 유지. 분석등록·외부상품쓰기·광고쓰기0.

교체 중502를 한 차례 관찰했으나 이후 자동 배포 완료·healthy·새.env 전달·notice DB 저장을 재확인했습니다. 최초 매핑 저장은 host env에 ADS_ANALYSIS_ENABLED 항목이 없어 단언에서 **쓰기 전에** 중단됐습니다. 미설정도 disabled로 해석하고 명시 false 저장 후 재실행 성공했습니다.

## 실제 대표 브라우저 확인 / 운영 자료 변경 없음

기존 Chrome 대표 세션으로 로그인 상태 접근. 새로고침 후 LUMEN에 광고 분석·상품 등록 메뉴 표시. 광고 분석의 오늘/질문/기록 탭, 국내/해외 선택, 일일 한도, 만료일, 기록 없음/미채점 표시 확인. 비활성화 상태에서 분석 실행·질문 입력/제출이 비활성화돼 유료 실행하지 않음. LUMEN 샘플은 해당 브랜드 범위만 조회. 비서실에 LUMEN 광고 분석 영역 및 오늘 분석 전/광고 자동 변경 없음 표시. 실제 샘플/청구/발주 생성 등 사업자료 쓰기, 가짜 직원 로그인, 비밀키 추출 없음.

## 검증

- 타입 검사·빌드 통과. 최종 heartbeat/LF 보강본 전체 테스트 순차708/708, 격리 PostgreSQL53/53. 관련 shell/installer32/32 및 HTTP/비서실31/31도 재실행 통과(전체와 중복이므로 합산하지 않음).
- 첫 전체 무제한 병렬 실행은 Windows 시스템 자원 부족으로 일부 실패. 기대값이나 테스트를 약화하지 않고 concurrency1로 재실행 통과.
- 샘플 승인→청구·기존 명세 추가/월별 취합, 결제 차감·미지급, 대표/직원 경계는 합성 업무 및 격리 SQL에서 검증. 이는 직원 실제 사용이나 모든 외부 연동 실거래 성공의 증거가 아님.
- 공통 Claude 실제 읽기 전용 검토4회 **USD1.85**. 결과는 CLAUDE_REVIEW_RESULT_ADS_FINAL_SETUP.md 및 _LIVE.md, _FINAL.md 참조. 기존 검토의 P2 일반 복구/알림 한계는 별도 추적하며 중대 미확인 사항을 숨기지 않음.

## 남은 활성화 차단 — 필요한 승인/연결

1. Cafe24 ERP전용 앱 키·토큰 없음. 최초 인증·토큰 갱신만 허용 여부를 대표님께 질문한 상태. 승인 없이 기존 앱 재사용/갱신/상품 쓰기 실행 금지.
2. Shopify 기존 서비스 앱은 client-credentials 인증을 쓰지만 ERP에는 읽기 토큰 연결 없음. 같은 앱의 주문 조회용 인증 발급만 허용 여부 질문 대기. 승인 전 발급·상품 변경 금지.
3. 주문/상품·재고의 시장/SKU 연결 검증 후에만 광고 분석 활성화. 미확인 값을 verified:true로 입력하거나 매출·재고 숫자를 만들지 않음.
4. 이후 실제 질문1건에서 Claude 계획→Claude/Codex/Meta 독립 의견→교차 검토1회→최종 결론 저장→비서실 조회를 검증하고 09시 운영 활성화 판정. 현재 ADS_ANALYSIS_ENABLED=false; 실제 유료3모델 분석·실제 미래09시 실행은 미실행.
5. 실제 Cafe24/Shopify 상품 생성·수정, Meta 쓰기, 직원 공개, 법인원장 분리·재무 실제 입력은 범위 밖/금지 유지.

## 실행 증거

| SSM | 결과 |
|---|---|
| b3f998fd-6d13-4426-b2e0-8becfbff4a97 | 암호 페어링·전체 Meta GET·검토 helper 설치 성공 |
| 86aa979b-ddca-4f6f-9bef-c7ed244b6d87 | 매핑 저장 단언 실패 / 쓰기 전 |
| e10c5346-0bf8-4941-a581-04b8279b92d2 | 명시 disabled 상태로 매핑 저장 성공 |
| ca45e0ca-9108-49b4-8c40-31edba8b2e28 | 잘못된 timer 이름 조회에서 중단, 앱 정상; f9be9317에서 실제 erp-auto-deploy.timer 확인 |
| 7ec90f2f-d8e2-4f1b-80cb-4cee36f3da1d | 자동 교체 중502 관찰 |
| 02527780-eec6-4a8d-925d-8de81e1bf9d1 | 새 앱·실행 config·notice·무인증 경계 최종 성공 |
| 6627cd9f-18f9-488d-8a0c-661de589d68a | a62빌드중 이전6e앱healthy 확인, 최종성공으로오인하지않음 |
| d4dc0d76-d74a-4abc-979e-67f2e37d7f88 | a62최종앱·성공marker·noticeheartbeat·권한경계 성공 |

서버 비밀 설정 백업: /opt/app/backups/ads-setup-20261012, 운영 DB 전체 백업은 전일 ads-rollout-3e8089e... 보존. 대표님 인증 승인 전 더 넓은 권한을 추정하지 않습니다.
