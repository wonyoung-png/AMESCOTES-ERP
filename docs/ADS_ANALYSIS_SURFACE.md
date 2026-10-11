# 광고 분석 화면 계약

대상: `client/src/pages/AdsAnalysis.tsx`, `/ads-analysis`. 모드: Operate.
대표 지시 §2만 구현하며 자사몰 인사이트 §1, 광고 제작·변경은 범위 밖입니다.

## Direction contract

THESIS: 같은 스냅샷을 근거로 모델들의 독립 의견과 최종 판단을 비교합니다. 분석과 광고 실행을 혼동하지 않습니다.

OWN-WORLD: 기존 ERP의 Pretendard, 의미 기반 배경·테두리·텍스트·버튼 토큰, 밝음/어두움 테마를 유지합니다. 사무실 PC와 이동 중 휴대전화에서 읽습니다. 별도 장식·폰트·브랜드 체계를 추가하지 않습니다.

STORY: 국내/해외를 선택하고 오늘의 분석을 확인하거나 질문합니다. 근거 없는 결과·모델 미참여·수집 실패를 실제 0건과 구분하고, 원문과 교차 검토 전후를 펼쳐 판단합니다.

FIRST VIEWPORT: 제목, 시장 선택, 예약 비용 한도, 오늘/질문/기록 탭, 실행·질문 버튼과 진행 상태가 먼저 보입니다. 본문에는 Claude·Codex·Meta 3칸과 그 아래 최종 결론을 배치합니다. 모바일에서는 같은 순서로 세로 배치합니다.

FORM: 사용자 지정 3자 비교 + 최종 결론 구성을 기존 ERP에 확장합니다. 방향 추첨·외부 시안은 없습니다. 대표가 지정한 구성과 기존 화면이 시각적 기준입니다. 핵심 상호작용은 원문 근거와 검토 전후의 단계적 펼치기입니다. 진행 상태만 최소 동작으로 표시하며 확정되지 않은 ETA를 만들지 않습니다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 검증 경계

- 캡처는 합성 데이터로 만든 개발용 증거이며 운영 결과가 아닙니다.
- 데스크톱·휴대전화 및 양 테마를 확인합니다. 고객 자사몰 화면은 변경하지 않습니다.
- 범위를 넘어 기존 DESIGN.md나 공통 디자인 토큰을 재작성하지 않습니다.
