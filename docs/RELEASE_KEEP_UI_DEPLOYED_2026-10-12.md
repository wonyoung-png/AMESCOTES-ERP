# 기존 ERP UI 유지본 실제 운영 배포

## 결과

2026-10-12 대표님 '클로드와 검토하고 배포해' 지시로 Codex가 실제 우리 AWS에 운영 코드 배포했다. 검토용 localhost:4184 시안은 배포하지 않았다.

- 운영 주소: https://erp.ameserp.kr/ (설정 /settings), 비서실 https://ceo.ameserp.kr/.
- 원격 aws-migration / 서버 source / .deployed/erp: ac709006528950cd127004c856c24a54b08f75b2.
- 실제 새 앱 image: sha256:1f5de445de1ed972bfb8610edd76d39638e4b9d56abbcc4daccf47d250fa8468. healthy, restart0.
- 이전 운영31ab72d(구독 고정비 아님)와 afe1279 기능은 보존. 기존 UI·BOM·품목/자재·전역 CSS는 변경하지 않았다. 설정 화면에 샘플 수락 담당 지정/복구만 추가.
- 민감 callback query/Referer 로그 보호, 우리 도메인 셸 연결, 자동 배포 실패 보호, 구Railway 설정 비활성 보관 반영.

## 실제 Claude 검토

공통 읽기 전용 실행기 2회: USD0.82 + USD0.46 = USD1.28.
CLAUDE_REVIEW_RESULT_RELEASE_KEEP_UI.md 및 CLAUDE_REVIEW_RESULT_RELEASE_KEEP_UI_FINAL.md 참조. 최초P1은 운영 구조/환경/설치 순서 확인이었고 실제 SSM으로 해소 후 재검토. A1~A3(구독 보존 rollback, Caddy inode 유지 cp/reload, source/marker/origin/script/timer 경로 재확인)을 적용했다. Claude가 운영 명령·테스트를 직접 수행한 것은 아니다.

## 적용 과정과 검증

1. 별도 release branch에서 운영기준에 승인 변경만 반영. 준비 중 다른 세션31ab72d가 배포되자 guard가 변경 전에 중단했고, 새 변경을 merge했다.
2. 실Caddy validate, bash-n, DB7컬럼/분류제약/RPC5 boolean(t,t,t), 기존 운영Caddy/compose/script 동일 및 env 키 존재 확인. DB 적용 없음.
3. deploy.lock 확보·기존 이미지/설정 보관·보호auto-deploy.sh 원자 설치 후 aws-migration fast-forward push.
4. 기존2분 erp-auto-deploy.timer로 자동 배포. 수동 service/build/up 호출 없음.
5. 운영 source/marker/image 및 health 확인, 실제 대표 크롬 화면에 새 설정 표시·기존 비서실 접속 확인.

| 검사 | 실제 결과 |
|---|---|
| 릴리스 함수/mock 전체 | 631/631, TypeScript/build 통과 |
| 변경 집중검사 | 17/17, 위 일부와 중복 |
| 실 HTTP health | 200, ok:true |
| 대표 인증 읽기 | 샘플context ready:true, directory/subscriptions/ceo/상품등록/광고access 200 |
| 실제 활성 직원 읽기 경계 | 샘플context401, CEO 버튼false |
| 무인증 읽기 경계 | 샘플context401, 상품등록/광고access403 |
| SPA 진입 경로 | items/materials/bom/samples/orders/trade-statement/product-registration/ads-analysis/settings 모두200. 데이터업무 완료 증거와는 다름 |
| 타서비스 | daily/hr/db/postgrest/caddy/광고러너 컨테이너ID 이전과 동일 |
| 보호 설정 | ERP_PRIVATE_MODE=true, ADS_ANALYSIS_ENABLED=false, 상품/monitor enabled unset 유지, timeractive |

권한 읽기 검사는 컨테이너 내부에서만60초 진단토큰을 사용했고 토큰·비밀값·직원 신원·업무 레코드는 출력/보관/모델 전달하지 않았다. 첫 검사에 상품등록의 필수X-Workspace 헤더가 빠져403을 받았고, 실제 클라이언트와 동일한LUMEN 헤더로 재검사해 모든 검사 통과했다. 인증/권한을 약화시키거나 서버 로직을 수정하지 않았다.

SSM 근거:
- 선행조건/실Caddy: 0dcc57ae-b9ca-4c55-917f-ba8a4d3af512 (Success0)
- 백업/보호스크립트: a032356e-0473-4e17-a74d-fcd97056085a (Success0)
- 자동배포marker/health: 834251e4-33ae-4ec6-bafd-5cc6a2bbcb24 (Success0)
- 최종 실제 권한/서비스 검증: f315edbd-abb1-483a-994d-5856fc4a561d (Success0)

실제 Chrome 증거: docs/screenshots/release-settings.png, release-office.png (로컬 보관만, 운영/모델로 전송하지 않음). 이번 검증에서 담당자 저장·청구·명세서·상품게시·광고변경·실무 레코드 쓰기·DB 마이그레이션은 실행하지 않았다.

## 복구와 잔여 범위

운영 복구 보관: /opt/app/.deployed/keep-ui-20261012-ac70900에 Caddyfile/compose/auto script/기존marker/이미지ID, amescotes-erp:keep-ui-prev-20261012 이전 이미지tag. 보관 자료는 삭제하지 않는다.

필요시 deploy.lock하에서 앱 이전이미지 및 Caddy 보관사본을 cp로 덮어쓴 뒤 /etc/caddy/Caddyfile reload. 원격코드는 승인변경cf3f2bb와 대조기준ac70900만 revert하고, 31ab72d의 구독 기능 등 기존 runtime/deploy 트리가 동일한지 확인한다. merge-parent를 임의 revert하거나 force push하지 않는다.

이번 승인 범위의 코드 배포와 읽기 검증은 끝났다. 전체 회사 실무의 쓰기 종단간 검증/중국 외부 원가 작성/실채널 프리오더/09시 광고 활성화 등 미완성 기능까지 완료한 것은 아니다. 대표님 직접 사용 피드백은 별도다. bare https://ameserp.kr/의 기존TLS 실패는 이번 범위에서 수정하지 않았으므로 정식ERP호스트로 접속한다.
