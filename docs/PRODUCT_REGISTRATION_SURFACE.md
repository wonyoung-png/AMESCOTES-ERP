# 상품 등록 화면 — 개발용 표면 계약

범위: LUMEN의 기존 품목을 참조해 채널용 내용을 한 번 작성하고 검증·독립 승인 후 공개합니다. Operate 모드. 품목·라인시트·OEM·AETALOOF 기능을 변경하지 않습니다.

## Direction contract

THESIS: 상품 목록에서 하나를 선택하면 품목 사실과 채널 입력이 분리되어 보입니다. 등록·검증·승인을 같은 페이지에서 이어가며 필드 누락을 숨기지 않습니다.

OWN-WORLD: 기존 ERP의 Quiet Precision과 공통 배경·글자·선·버튼 토큰을 그대로 사용합니다. 실제 CSS 폰트는 SF/Pretendard fallback 스택이며 단일 Pretendard 구현이라고 주장하지 않습니다. 기존 DESIGN.md는 변경하지 않습니다.

STORY: 담당자가 품목을 선택하고 등록 초안을 저장합니다. 오류 항목으로 이동해 보완하고 승인 요청합니다. 다른 승인자가 검증 결과를 확인해 비공개 등록한 뒤 예약 또는 공개합니다.

FIRST VIEWPORT: 상단 상품 등록 제목과 새 등록, 그 아래 상태·시즌 필터와 연결 상태, 상품 목록. 편집에서는 품목 정보와 단계 상태를 먼저, 섹션별 필드와 검증 결과를 뒤에 배치합니다. 액션은 권한과 단계에 따라 노출합니다.

FORM: 명세에 지정된 목록→섹션별 편집 구조를 기존 화면에 추가합니다. 구체적으로 지정된 기능 확장이므로 컨셉 추첨 없음; code-led, 기존 디자인 상속. 이미지 원본·순서·역할·설명이 핵심 상호작용입니다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

제약: 외부 쓰기 기본 OFF. 개발 검증은 모의 API만 사용합니다. 고객 HTML 렌더링 미리보기는 2단계입니다. 실제 운영 검수 전 완료로 표시하지 않습니다.
