# 운영 후 실제 Claude 재검토

2026-10-12, 공통 실행기 읽기 전용, 비용 **USD0.36**. 요청 _LIVE.md. Claude는 운영·테스트를 실행하지 않았으며 Codex 실제 증거와 소스만 검토했습니다.

판정: P0없음 / P1 원본 CRLF 및 테스트 내부 정규화가 결함을 가림. P2는 ERP·비서실 러너 생존 정보 누락으로 분석 활성화 전에 보강 필요.

반영: .gitattributes에 *.sh text eol=lf, ads-runner.sh LF 재정규화, 테스트 read에서 replaceAll 제거하고 원본 CR 없음 직접 단언. Installer 정규화는 과거 archive 방어로 유지. 원본/맥미니 실제 runtime SHA 대조 계획. 상시 프로세스25371 running 후 재조회 running 동일 확인(Claude 요청 작성 당시 진행 중이었으나 이후 실제확인 완료).

러너 접속: 인증된 jobs/next에서 macmini만 분당1회 notices에 연결시각 저장. OFF면 lease·모델 호출 없이 job:null, DB 저장 실패503. 비서실은5분 이내 연결됨/과거 지연/미확인·미래 시각 확인불가를 표시. 모델 분석 참여와 별개로 안내. HTTP 합성 테스트와 비서실 실제 렌더 테스트 추가, 관련31/31통과. 운영 반영 전 최종 추가 검토 요청.

Cafe24/Shopify 인증은 승인 전 금지 유지, 실제3모델유료 검증 미실행. 피드백만 남았다고 보고하지 않습니다. 누적 이번 설정 검토 비용 **USD1.55** (0.65+0.54+0.36).
