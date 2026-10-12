# AWS 러너 이전 실제 실행 기록

## 최종 현재 상태 (아래 중간 기록보다 우선)

AWS 전용 로그인·물리 러너 전환·보안 보강·자동 복구 검증은 성공했습니다. 카페24 기존 앱 재인증과 전체 광고 업무 활성화는 미완료입니다. 직원 접근/ERP 앱 배포/운영 DB 마이그레이션은 진행하지 않았습니다.

| 최종 검증 | 증거 |
|---|---|
| 실제 Codex 독립 분석·교차 검토, 도구 이벤트0 | 1ce86ffa-dd5b-4144-b7b3-72156dd43038, 두 단계 통과 |
| 실제 상시 이미지 | sha256:709c1943c608d8960f31cbd7619707b7f4f2ab3b995d30b1c13b0ac1461d3968, 소스5220f16 |
| 기동 전 guard 검사 + systemd 관리 재시작 | c2fae82d-8f06-4e69-92ca-652fb9cd0eb4, systemd active, Docker restart=no |
| 고의 KILL 뒤 자동 복구·API200 | 5e711dd1-7ce8-499a-8674-2c53160c8444, 진행 작업0일 때 러너만 시험 |
| IMDS/hostTCP 차단 및 공개 API200 | 1a5fee21-6ba5-44de-9a4b-490897da71d2 |
| root 소유·다른 계정 쓰기 없음, IPv6 꺼짐, 자체 공인 경로 무인증403 | ba24a7f9-6576-418c-b3ac-81fc52acd417 |
| 관련 회귀 | 33/33, 마지막 실패 분류 변경 후 worker31/31 추가 통과 |
| 실제 Claude 검토 | 컷오버USD0.44 + 최종USD0.50 + 보강USD0.47 = USD1.41 |

guard는 고정 전용 CIDR172.27.0.0/16에만 적용합니다. DNS53은 내부 DNS 경유 공개 도메인 해석을 위해 허용합니다. 별도 runner systemd unit이 guard를 Requires하고, 실제 CIDR/iptables 검사에 실패하면 기동하지 않습니다. Docker 자체를 guard에 종속시키지 않아 ERP 전체 기동을 막지 않습니다. 활성 source 디렉터리·root 실행 스크립트는 root 소유/0700으로 보강했습니다.
초기 단순 Docker unless-stopped 방식은 최종적으로 systemd Restart=always + Docker restart=no로 교체했습니다. 성공 직후 systemd 시작과 Docker 재생성 사이 중간 출력은 이전 이미지였지만 후속 실제 컨테이너 ID/이미지 일치와 복구까지 확인했습니다.

두 번의 보강 모델 시험 실패는 성공으로 계산하지 않습니다. 최초 DNS 차단 및 후속 cross_review CLI 실패가 있었고, 후속 실제 두 단계가 통과했습니다. CLI 이벤트 형식 자체는 정상으로 확인됐으므로 이전에 형식 문제로 추정한 것은 확정 원인이 아닙니다. 원문 CLI 오류/인증값은 외부 로그에 출력하지 않습니다. 도구0은 수신한 CLI event 스트림의 item.type 검사 범위이며 이미 실행된 도구의 영향을 되돌리는 장치는 아닙니다.

호스트 재부팅은 다른 운영 업무 영향 때문에 미실행입니다. guard 및 Docker/runner service enabled 상태, unit 문법 검증과 러너 강제 종료 자동 복구로 확인했습니다. 실제 회사 대용량 광고 데이터, 서버 claim→finish→비서실 전체 흐름은 이번 합성 모델 시험과 별개이며 광고 enabled=false 유지입니다. 카페24 access 만료/refresh invalid_grant 재인증은 남았습니다.

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

`systemctl stop ames-ads-runner.service`와 AWS 러너 container stop을 확인한 다음에만 Mac `launchctl enable gui/501/kr.atlm.ads-runner`, 기존 plist bootstrap으로 복구합니다. 단순 container stop만 하면 systemd가 다시 시작하므로 service를 먼저 중지합니다. 두 호스트 동시 모델 작업을 하지 않습니다. 인증/원본 plist는 삭제하지 않았습니다.
