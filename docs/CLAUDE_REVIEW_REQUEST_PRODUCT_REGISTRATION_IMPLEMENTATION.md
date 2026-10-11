# LUMEN 상품 등록 구현 교차검토 요청

대표님 요청: '모르면 클로드 점검해서 완성해라'. 읽기 전용 검토이며 운영 쓰기·DB 적용·배포·커밋은 금지합니다. 비밀키·.env·개인정보를 읽지 마세요.

대상: docs/TASK_PRODUCT_REGISTRATION.md, docs/PRODUCT_REGISTRATION_FIELDS_v1.md, docs/CLAUDE_REVIEW_RESULT_PRODUCT_REGISTRATION.md, shared/product-registration.ts, server/auth.ts, server/work.ts, server/agents.ts, server/ceo.ts, server/org.ts, data/bag_size_master.json. 구현 중인 다른 새 파일은 이번 검토에서 제외합니다.

현재 product-registration 별도 worktree에서 구현 중입니다. items는 읽기만, listing payload jsonb에 채널전용 필드, revision별 독립 승인, 채널별 단계 기록, DB lease 기반 스케줄 실행을 계획합니다. 외부 쓰기는 기본 OFF이고 실채널 검수는 이후 대표님 지시에 따라 별도 수행합니다. 현재 작업은 정적 검토이며 테스트·운영 확인 성공으로 간주하지 않습니다.

질문:
1. 대표 결정 메모리와 충돌하는 명세/입력 필드/권한/비서실 연동이 있습니까? 특히 author!=approver, 공개상품 수정 재승인, 재고 독립, 일본어 번역본문+제품정보만.
2. 카페24 실제 필터 코드표와 Shopify custom 메타필드 타입·메타오브젝트 ID 중 이미 확정된 근거가 메모리에 있습니까? 공유 가능한 코드/타입만 제시하고 운영 조회나 비밀값 읽기를 하지 마세요. 현재 코드표는 근거 없는 후보를 운영값으로 확정하지 않도록 설정 확인을 승인 전 필수로 둘 계획입니다.
3. 선점→외부생성→ERP결과저장 중 응답유실/프로세스종료, 이미지 공유삭제, 번역 digest, 예약 직전 수정 경합, 판매한도/입고해제 등에서 빠뜨릴 수 있는 중요한 실패 시나리오는 무엇입니까?
4. team_agent_runs/ceo 콘솔에 조직도에 없는 자사몰관리 에이전트를 안전하게 노출하기 위해 정확히 어느 읽기 경로를 바꿔야 합니까?

한국어로 중대 위험 8개 이내와 구현 판단 근거를 제시해 주세요. 권고를 명세 범위 축소 승인으로 해석하지 않습니다. 운영 검수 전 '완료'라고 부르지 않습니다.
