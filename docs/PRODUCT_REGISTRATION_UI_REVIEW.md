# 상품 등록 UI 독립 검토 기록

2026-10-11 Impeccable skill에 따른 fresh finish reviewer(Fermat) 실제 검토와 수정 재판정. 코드 기반 기존 ERP 확장, 신세계/새 토큰 시스템 구축이나 운영 검수가 아님. 합성 자료로 외부 요청을 차단한 로컬 component capture를 사용했습니다.

## 최초 결과: disposition: fix
- 신규 초안의 저장됨 표기가 사실과 맞지 않음.
- 모바일 검증 결과가 페이지 맨 아래에만 있어 접근하기 어려움.
- 모바일 비교표에서 Shopify 열이 화면 밖에 있으나 가로 이동 안내 없음.
- 기존 TYPE/MATERIAL/GROUND와 업무 입력 구조는 유지. PRODUCT/DESIGN/표면 계약 존재. 기계 detector는 지정 3개 파일 대상으로 1회 결과 [] (위 지적은 기계 검사로 발견되지 않은 UX 문제).

## 수정 재판정: disposition: ship
- resolved: 신규 초안 데스크톱·모바일 모두 저장 전 표시.
- resolved: 모바일 작업바 검증 결과 건수·보완 건수와 결과로 이동 표시.
- resolved: 비교표 위 좌우 이동 안내 표시.
- remaining: clear. 수정으로 인한 시각적 회귀 확인되지 않음. **ship 범위는 기존 수정 3건의 재판정에 한정**되며 API/운영 성공 판정이 아님.

## 근거
캡처 .impeccable/review/{desktop.png,mobile.png,desktop-dark.png,mobile-dark.png,editor-desktop.png,editor-mobile.png,editor-populated-desktop.png,editor-populated-mobile.png}. UI QA 결과 product-registration-ui-results.json 및 product-registration-ui-fix-results.json. 캡처는 운영 자료가 아니며 이미지·검증 상태도 합성입니다.

design documenter(Herschel): No changes. 공통 중립색·semantic 경계·Button/Input/Label/Badge·반응형 그리드 상속. DESIGN.md는 기존 업무 설계서라 새 시각 시스템으로 교체하지 않음. 기존 CSS SF/Pretendard fallback을 단일 Pretendard라고 정식화하지 않았고, 기존 amber 경고색·문서 형식 드리프트는 범위 밖으로 보존했습니다.
