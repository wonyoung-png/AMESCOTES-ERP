# 광고 분석 운영 적용 검증

검증: 2026-10-11 22:29 KST. 대표 요청 ‘검증해봐라’. 읽기 전용 진단이며 배포·DB 적용·설정 변경·광고 변경·실제 분석 요청은 하지 않았습니다.

## 판정

**코드의 재검증은 통과했지만 운영 사용 준비는 미완료입니다. 대표 피드백만 남은 상태가 아닙니다.**

| 확인 항목 | 직접 확인한 증거 | 판정 |
|---|---|---|
| 전용 개발본 | local shop-insight-agents HEAD8199c92, 광고 모킹101/101·격리SQL18/18 재실행 통과 | 코드 검증 통과 |
| 운영 기본 응답 | erp.ameserp.kr/healthz HTTP200 application/json, 홈페이지HTTP200 | 서버 응답 확인 |
| 운영 광고 API | /api/ads-council/access 및 /api/ads-council?market=lm-kr는HTTP200이지만 text/html, 실제 JSON API가 아닌 SPA fallback | 기능 API 미설치 |
| 운영 앱 실행 파일 | app-app-1 내부 /app/dist/index.js에 /api/ads-council 문자열 없음. 컨테이너 healthy | 광고 코드 미배포 |
| 서버 소스와 배포 표시 | /opt/app/src/erp gitHEAD1ceb6143297e4f5fab7bb3683146b061acfd13e3. /opt/app/.deployed-sha 없음 | 소스SHA만 확인, 실행 이미지의 정확한 커밋SHA는 미확인 |
| 운영 DB 광고 테이블 | PostgreSQL to_regclass(public.ads_analysis_runs/budget/jobs/notices) 네 개 모두 false | DB016 미적용 |
| Meta 설정 | /opt/app/.env에 META_ADS_TOKEN·META_AD_ACCOUNT_ID 비어 있지 않은 설정 존재. 값은 출력하지 않음 | 파일 등록 확인 |
| 실행 앱 설정 | process.env의 META_ADS_TOKEN·META_AD_ACCOUNT_ID 없음, ADS_ANALYSIS_ENABLED false. 호스트/앱 ADS_RUNNER_TOKEN도 없음 | 컨테이너 전달·러너 인증 설정 필요 |
| 맥미니 | SSH연결 성공 Darwin, nodev25.8.1·codex-cli0.162.1. launchctl에 kr.atlm.ads-runner 없음, ~/Library/LaunchAgents/kr.atlm.ads-runner.plist 없음 | 러너 미설치/미등록 |

101개 모킹 테스트는 ads-council/context/data/orders74개와 macmini27개입니다. SQL18개는 새 메모리 PGlite이며 운영 DB가 아닙니다. 이전 전체735건 통과는 ADS_ANALYSIS_DONE.md의 이전 실행 기록이고 이번119건과 합산하지 않습니다.

## 안전 경계 및 접근

- 현재 erp.ameserp.kr DNS43.202.83.13과 일치하는 ames-new 프로필의 i-0cf424d627db8b063에만 운영 진단 명령을 실행했습니다. 오래된 기본 프로필 서버에는 명령을 실행하지 않았습니다.
- SSM 실행은 컨테이너 상태·소스SHA·배포 표시·번들의 광고 경로 존재·허용한 환경변수의 존재 여부·DB 테이블 존재 여부만 읽었습니다. 이름/주문/고객/직원 자료는 읽지 않았습니다.
- 비밀값은 명령 인자·출력·로그·보고서·모델 입력에 포함하지 않았습니다. 설정 파일은 허용한 세 설정의 존재/공백 여부만 출력했습니다. 모든 다른 환경변수 값은 출력하지 않았습니다.
- 광고 GET jobs/next는 작업을 선점하는 API이므로 호출하지 않았습니다. POST/run·모델·Meta·커머스 실제 호출도 없습니다.
- DB 첫 진단은 달러 인용의 셸 확장으로 메타데이터 조회가 실패했습니다. 인용을 수정해 같은 읽기 전용 SELECT를 다시 실행했고 네 테이블 false를 확인했습니다. 실패를 성공으로 판정하지 않았습니다.
- 진단 SSM IDs: 3b223b82-9cbf-4a7d-b967-f16b033c187e, da184cb5-d4af-4f81-912c-4ab4af352d0c, ccc69bfd-0eda-4592-9a82-d05c676f465b. 결과 모두 Success; 실제 메타데이터 성공은 마지막 명령입니다.
- 이 PC에서 https://ameserp.kr은 TLS 협상이 실패했지만 https://erp.ameserp.kr은 정상 응답합니다. 루트 도메인 장애의 원인/다른 기기 재현 여부는 확인하지 않았으며 광고 기능 미설치 판정과 별개입니다.
- Graphify 기존 그래프는 구 Railway 배포 등 이전 구조를 가리켰습니다. 이번 신기능/운영 적용 증거로 사용하지 않고 직접 응답·컨테이너·SQL·맥미니 진단으로 판단했습니다. 그래프 재구축/LLM 추출 비용0.

## 운영 담당 Claude가 이어서 할 일

기존 대표 지시대로 운영 적용은 Claude 담당입니다. 이 검증 요청만으로 배포 권한을 확대하지 않았습니다.

1. ADS_ANALYSIS_DONE.md와 CLAUDE_REVIEW_RESULT_ADS_ANALYSIS.md를 기준으로 운영 브랜치 통합 검수, 광고 코드 배포 및 DB016 적용.
2. 이미 호스트에 있는 Meta 설정을 실행 앱에 전달하고 ADS_RUNNER_TOKEN을 안전하게 서버/맥미니에 동일 주입. 값은 출력하지 않음.
3. 검증된 시장/주문/재고 매핑과 맥미니 LaunchAgent 설치·실제 폴링 확인. 이후 명시적으로 활성화.
4. 국내/해외 각각 실제 질문 및 매일09시 흐름, 독립3의견→1회교차→최종, Meta쓰기0·비서실보고·11월10일부터 만료알림을 실제 데이터로 검수.
5. 운영 검수 통과 후 대표 최종 피드백. 해당 과정은 이번에 실행하지 않았습니다.

이번 검증에서 신규 Claude 교차검토 모델은 호출하지 않았습니다. 앞선 실제6회 검토 비용USD4.30과 현재 서버 진단을 구분합니다. 이 문서는 운영 적용·배포를 수행했다는 인계서가 아닙니다.
