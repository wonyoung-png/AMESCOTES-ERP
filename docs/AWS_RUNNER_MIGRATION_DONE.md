# AWS 러너 이전 실제 실행 기록

2026-10-12. 범위는 대표 승인한 기존 Cafe24 앱 주소 변경 및 Codex 러너 AWS 이전입니다. ERP 광고 전체 기능 활성화 완료와 구분합니다.

## 실행 및 검증

- Cafe24 기존 ATLM ERP 앱 App URL `https://daily.ameserp.kr`, 반환주소 `https://daily.ameserp.kr/api/cafe24/callback` 저장 및 재조회 일치. 선택 권한 유지, 키 보기/재발급 없음.
- 대표가 계정 전체 기기 코드 로그인 활성화 및 AWS 러너 전용 로그인 저장을 승인했습니다. OpenAI 공식 UI에서 활성화와 Codex 로그인 성공 확인. Mac 공유 인증 캐시는 복사하지 않았습니다.
- AWS 전용 인증 uid1000/0600 및 ChatGPT login status 확인. 실제 Codex 0.162.1 + gpt-6.1-sol/high 독립 분석과 교차 검토를 hardened 컨테이너에서 실행하여 통과. 모델 시험은 합성 localhost API에만 결과 제출하며 운영 분석 기록을 생성하지 않았습니다.
- 실제 이미지 `sha256:dbb435296a7bb0a0d2bd6d1636b8a15e8864442cd81c6aa470ea151d41997558`. 표준 ca-certificates 설치, TLS 검증 우회 없음.
- 전환 직전 분석 OFF, 미종료 작업0, ERP healthy 확인. Mac `kr.atlm.ads-runner` disable+bootout 후 disabled/서비스 부재 확인. 다른 Mac Codex 작업과 원본 plist/인증은 유지했습니다.
- AWS `/opt/app/ads-runner`, 컨테이너 `ames-ads-runner` 실행. uid1000, read-only root, cap ALL 제거, no-new-privileges, 메모리768MiB, 공개 포트 없음, restart unless-stopped. 모든 compose 실행은 `--project-directory /opt/app/ads-runner` 명시합니다.
- 실제 운영 runner API HTTP200/idle 및 heartbeat 갱신 확인. 컨테이너 재시작 후 새 heartbeat/정상 실행 확인. 최초 5초 신선도 검사는 실패했으나 운영 서버의 60초 heartbeat 저장 제한을 반영한 후 정상 검증했습니다. 운영 호스트 재부팅 시험은 미실행입니다.
- 논리 runner ID `macmini`는 기존 운영 API 호환 식별자이며 실제 실행 호스트는 AWS입니다. heartbeat만이 아니라 Mac 중지와 AWS 컨테이너/실제 모델/재시작 증거를 함께 사용했습니다.

| SSM 증거 | 결과 |
|---|---|
| 6529c589-9ff0-4694-8d9f-dd369b5e635c | 전용 인증·실모델 independent/cross_review 통과 |
| ac5cbec7-40ba-4dfa-ba37-8e342db84f75 | 분석OFF/작업0/ERP healthy |
| 5e9320be-c623-48a1-a617-3ea9232886c4 | AWS 상시 컨테이너 시작 |
| 39717a8d-b4fb-4f5b-86f3-f7d5ea825f5a | 재시작 후 API200/새 heartbeat |
| 366d04e2-9c47-4fd9-8756-f21f1a83d7e1 | 재시작 복구·격리·ERP healthy |

## 운영 경계와 남은 검증

ERP 앱 수동 배포, 운영 DB 마이그레이션, aws-migration push, 광고·상품·주문 수정 없음. 분석 enabled=false는 유지했습니다. 따라서 광고 전체 업무 흐름 및 매일09시 유료 분석 활성화까지 끝났다고 표현하지 않습니다.
Cafe24 기존 앱 주문 count GET은 별도 Python import 방식에서 LocalProtocolError로 실패했고 인증 namespace를 점검 중입니다. 주소 변경 성공과 실제 주문 조회 성공은 별도입니다. 신규 조회 앱 OAuth 완료도 아닙니다.
최종 Claude 읽기 전용 리뷰 결과는 `CLAUDE_REVIEW_RESULT_AWS_RUNNER_FINAL.md`에 별도로 기록합니다. 전용 인증의 계정 로그아웃/만료 시 재로그인이 필요합니다.

## 복구

AWS 러너부터 stop한 다음 Mac `launchctl enable gui/501/kr.atlm.ads-runner`, 기존 plist bootstrap으로 복구합니다. 두 호스트 동시 모델 작업을 하지 않습니다. 인증/원본 plist는 삭제하지 않았습니다.
