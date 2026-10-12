# AWS 러너 보강 Claude 실제 교차검토

2026-10-12 / 공통 실행기 / 읽기 전용 / 실제 비용 **USD 0.47**.

Claude 판정: 새 P0 없음. 새 P1 1건(두 조건): 네트워크 CIDR이 변경돼도 규칙은 기존 대역을 차단하고, guard service의 Before만으로는 실패 시 runner 시작을 막지 못함. 이벤트 검사·토큰 차단·DNS 예외는 정적 의도대로 반영됐으나 실제 모델 결과는 검토 당시 미확인.

## P1 처리

- compose subnet을 실제 전용 네트워크 `172.27.0.0/16`으로 고정했습니다.
- runner Docker restart를 no로 바꾸고 별도 systemd runner service에서 Restart=always, Requires guard+Docker, ExecStartPre 규칙/실제 CIDR 검사를 적용합니다. ERP의 docker.service 자체는 guard 성공 여부에 종속시키지 않습니다.
- 소스 테스트는 고정 CIDR 및 의존/기동 전 검사까지 포함해33/33 통과. 새 상시 서비스 운영 적용은 실제 모델 시험 통과 후에만 수행하도록 SSM 절차를 구성했습니다. 실제 적용 결과는 AWS_RUNNER_MIGRATION_DONE.md 후속 기록을 참고합니다.

## 실제 재검증과 실패 구분

- 보강 첫 실행은 AWS 내부 DNS까지 차단해 실패했습니다. DNS53 예외 추가 후 metadata/hostTCP 거부, 공개 runner API200, ERP healthy를 확인했습니다(1a5fee21-6ba5-44de-9a4b-490897da71d2).
- 코드 보강 후 실제 독립 분석+도구 호출0은 통과했지만 cross_review는 CLI 실패로 끝났습니다(40fcd1b3-c94f-4127-bd08-c6b7fb67c234). 이 결과는 두 단계 통과가 아닙니다.
- 실제 CLI event 형식 진단은 exit0, thread.started→turn.started→item.completed(agent_message)→turn.completed, 파싱 실패0을 확인했습니다(0554279d-051b-4fce-af43-0ed7b004a7ac). 전체 광고 작업 성공 증거는 아닙니다.
- 실패 원인은 원문 stderr를 출력하지 않고 시간/사용량/인증/실행 오류 고정 분류만 남기도록 보강했습니다. 모든 보강본 실제 검증이 끝나기 전에는 기존 검증된 이미지 유지 원칙입니다.

## P2와 경계

DNS53 예외는 필요한 내부 DNS를 허용하지만 resolver 하나로 제한하는 추가 강화는 미구현. host UDP 차단, IPv6 실제 설정, root-owned script 권한, public IP의 자체 신뢰 여부, 이벤트 버퍼 초과/잘못된 JSON/정상 혼합 이벤트 테스트도 지적했습니다. 실제 확인하지 않은 항목은 확인했다고 주장하지 않습니다. 토큰 탐지는 정확한 runner token 및 JWT만이고 모든 비밀 탐지는 아닙니다. 도구 이벤트 사후 차단은 이미 수행된 도구의 영향을 되돌리지 않습니다.
계정 인증/광고 업무 전체/카페24 만료 refresh 재연결/호스트 재부팅은 별도 남은 범위입니다.

## 리뷰 지적 후 실제 최종 처리

CIDR 고정 및 guard Requires/기동 전 규칙 검사 unit을 적용했습니다. Docker restart=no, runner systemd Restart=always로 관리해 guard 실패 중 자동 Docker 기동을 방지합니다. 실제 source5220f16/new image709c1943...에서 독립 분석·cross_review 및 도구0 통과(1ce86ffa...), 고의 KILL 뒤 서비스 자동 복구·API200(5e711dd1...), root 소유/쓰기 권한·IPv6 disabled·무인증403(ba24a7f9...) 확인. 이전 남은 인증 연결은 전용 AWS 인증에 한해 해결됐고 카페24 인증은 남았습니다. 전체 광고 회사 데이터 workflow와 호스트 재부팅은 여전히 미실행입니다. 이 후속 실행은 Codex가 수행한 것이며 Claude가 재실행/합격 판정했다고 표현하지 않습니다.

## 운영 롤백

runner service stop 후 AWS 컨테이너 stop, 그 다음에만 Mac enable+기존 plist bootstrap. guard를 제거하려면 전용172.27 source 규칙만 `iptables -D`로 제거하며 전역 chain flush/정책 변경을 금지합니다. 네트워크 guard의 모든 root 실행 파일은 root 소유·0700 전용 디렉터리에 둡니다. 이번 호스트 변경은 대표의 명시적 러너 이전 승인 범위이고 ERP 앱/DB 배포가 아닙니다.
