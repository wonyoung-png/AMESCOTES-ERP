# 운영 반영 전 읽기 전용 검토

대표님이 Codex의 직접 운영 배포·DB 적용을 승인했습니다. 귀하는 기존 공통 실행기의 읽기 전용 검토자이며 쓰기·명령·배포 권한이 없습니다. 비밀값/.env/개인정보는 읽지 마십시오.

검토 대상: 이 worktree의 server/ads-*.ts, server/index.ts, server/auth.ts, db/016_ads_analysis.sql, scripts/macmini/ads-runner.sh, deploy/migrate/docker-compose.yml, deploy/migrate/auto-deploy.sh, docs/ADS_ANALYSIS_DONE.md, docs/ADS_ANALYSIS_OPERATIONAL_CHECK_2026-10-11.md, docs/PRODUCT_REGISTRATION_DONE.md 및 기존 검토 결과 문서. 현재 origin/aws-migration(1ceb614)와 shop-insight-agents(c6621f5)를 별도 worktree에 병합 중입니다. 구독 업무의 최신 변경을 보존합니다.

질문: 1. 병합본의 ERP 기존 흐름/상품등록/광고 분석의 런타임·DB 선행 조건 누락은? 2. 현재 운영 앱은 광고 코드가 없고 네 테이블이 없습니다. Meta 설정은 호스트 파일에만 존재, 러너 인증/시장 매핑/맥미니 설치가 미완료입니다. 먼저 비활성 상태로 코드·스키마 반영 후 매핑/러너 검수로 활성화하는 안전 순서와 롤백 위험은? 3. 실제 로그인 및 대표 비서실 권한, Meta GET만, 상품 쓰기 차단, 매일09시/만료알림의 차단 사항은? 4. db016 외 다른 병합 기능에 필요한 추가 마이그레이션을 문서 기준으로 특정하십시오. 5. 루트 도메인 TLS 실패와 현재 ERP 서브도메인 정상은 별개로 처리해야 합니다. 운영 반영 전 반드시 해결할 P0/P1만 우선하십시오.

정적 검토와 실제 실행 증거를 구분하고 파일/행·수정 근거를 명시하십시오. 운영 검수 성공을 추정하지 마십시오.
