# Claude 검토 요청 — LUMEN 상품 등록 개발 명세 (개발 착수 전)

대상: docs/TASK_PRODUCT_REGISTRATION.md, docs/PRODUCT_REGISTRATION_FIELDS_v1.md (이 저장소)
대조: server/work.ts, server/watch.ts, server/agents.ts, server/subscriptions.ts, server/auth.ts, client/src/components/Layout.tsx

질문:
1. 대표 결정 메모리와 충돌하는 부분 (재고 독립 운영, 고객 노출 변경 금지, 26AW 표기, JA 제목 영문 유지, 상품코드 카페24 기준, MADE IN 문구 제외 등)
2. 명세대로 만들면 Codex 가 헷갈리거나 빠뜨릴 부분(모호한 요구, 누락된 필드·권한·실패 처리)
3. 과한 범위(1단계에서 빼도 되는 것)
한국어, 표 위주, 25줄 이내. 근거는 파일 경로.
