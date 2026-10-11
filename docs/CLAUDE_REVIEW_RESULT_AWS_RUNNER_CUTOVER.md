# AWS 러너 컷오버 실제 교차검토

2026-10-12 / 공통 Invoke-ClaudeReview.ps1 실제 읽기 전용 검토 / **USD 0.44**. Claude는 운영 명령과 테스트를 실행하지 않았고 정적 검토만 수행했다.

## 판정 및 반영

P0 없음, 컷오버 전 P1 4건.

1. Mac bootout만으로 재로그인 때 러너가 되살아남 → 컷오버 때 `launchctl disable gui/501/kr.atlm.ads-runner`와 bootout 함께 실행, 복구 때 enable+bootstrap. 원본 plist·캐시 삭제 금지. 아직 중지 미실행.
2. 공유 논리 ID의 heartbeat만으로 AWS 실행 증명이 안 됨 → AWS 실제 컨테이너·API 응답과 Mac 서비스 비활성·부재, 이후 heartbeat 증가까지 함께 확인. 논리 ID=macmini는 기존 API 호환 식별자이며 물리 호스트는 AWS로 별도 기록.
3. compose 상대 경로 → 모든 실행에 `--project-directory /opt/app/ads-runner` 명시. 실제 빌드와 CLI 버전 검사도 이 명령으로 수행해 성공.
4. Mac 동시 인증 갱신 → Mac에는 러너 외 여러 Codex 프로세스가 실제 실행 중. 다른 작업을 중지하거나 공용 캐시를 AWS에서 사용하지 않음. 캐시 암호화 봉투는 메모리에서만 준비됐고 서버 복사·사용 미실행. AWS 전용 1회 로그인 연결을 대표에게 요청, 승인 전 실제 인증·모델 실행 보류. 전송용 개인키만 제거 예정.

## 실제 증거

- 카페24 기존 ATLM ERP 앱 AppURL `https://daily.ameserp.kr`, Redirect `https://daily.ameserp.kr/api/cafe24/callback` 저장 성공·재조회 동일, 선택 권한 배열 동일. 원래 키 재발급/보기/권한 수정 없음. 별도 AMESCOTES ERP 조회 앱과 혼동하지 않음.
- 운영 daily 실제 반환주소·client_id 일치, ERP analysis OFF 및 진행 광고 작업0. ERP healthy.
- AWS aarch64, RAM3835MiB/available2308MiB, disk26GB 여유. 별도 이미지 실제 빌드 성공.
- 이미지 `sha256:df024e4cf155c109a8d1096478f7dc0418acfb147c04f46b35df73a5a0c36288`.
- 실제 컨테이너에서 `codex-cli 0.162.1` 실행 확인. pinned CLI 및 hardened 구성의 관련 합성 테스트28/28 통과.
- SSM build 73722e49-971f-49ec-82ee-02a7f5b17a27, binary/0jobs/ERP healthy a7d3e2ab-5d80-4dd4-bf03-6d67461ef925.
- ERP 운영 앱·DB 미변경, aws-migration push 없음. 별도 러너 이미지 설치는 이번 명시적 이전 지시의 범위이며 기존 ERP 자동배포 정책을 우회해 업무 앱을 수동 교체한 것이 아님.

## 남은 승인 이후 순서

AWS 전용 Codex 로그인 저장(uid1000/0600) → scripts/aws-ads-runner-model-smoke.mjs를 hardened 컨테이너에 read-only mount해 localhost 합성 API/실Codex independent+cross_review 검증 → 분석OFF/0jobs 재확인 → Mac disable+bootout → AWS runner up → AWS API/컨테이너/새 heartbeat, Mac 부재 확인 → 프로세스 재시작 검증.

실제 모델 smoke는 ERP에 가짜 분석기록을 만들지 않는다. 테스트 fake API로만 두 단계 결과를 받고 모델 참여·근거 ID·계약을 확인한다. 인증과 실 모델 검증 실패면 컷오버하지 않으며 Mac 유지. 컷오버 후 실패 시 AWS stop→Mac enable+bootstrap, 인증 상태에 따라 재로그인 필요 가능성을 명시.

최초 코드 리뷰의 실제 build/auth 미실행이라는 설명 중 **build/binary**는 후속 실제 수행으로 해결됐지만, AWS 인증·실제 모델·영구 기동·Mac 중지는 여전히 미완료. CLI version/idle 연결만으로 이전 완료라고 보고하지 않음.
