# 광고 분석 — 기존 디자인 계승 점검

## Overview

- 판정: **ordinary narrow extension — incumbent preserved**. `client/src/pages/AdsAnalysis.tsx`는 기존 ERP의 Operate 화면을 확장하며 새 시각 체계나 토큰 소유권을 만들지 않는다.
- 점검 기준: `PRODUCT.md`, 기존 `DESIGN.md`, `docs/ADS_ANALYSIS_SURFACE.md`, Impeccable `reference/document.md`; 실제 구현을 문서보다 우선하여 기록한다.
- 쓰기 경계: 이 문서만 작성한다. 기존 DESIGN 파일, PRODUCT, 공통 스타일, 화면, `.impeccable/design.json`을 변경하거나 새 시스템으로 대체하지 않는다. 이 문서는 토큰 정의나 규범적 DESIGN.md의 대체물이 아니다.
- 기존 결정: `DESIGN.md:566`의 직원 ERP Quiet Precision / 대표실 Company Orbit / Pretendard Variable 단일 폰트 결정은 보존한다. `PRODUCT.md`의 근거 기반 제안과 사람의 최종 결정 원칙도 유지한다.
- THESIS/STORY 구현: 동일 스냅샷의 Claude·Codex·Meta 원문, 교차 검토 이유·전후 원문, 최종 결론, 근거·출처를 비교한다. Meta는 API 신호로 설명한다. 수집 실패·모델 미참여·미채점을 실제 0과 구분한다.
- FIRST VIEWPORT/FORM 구현: 제목 → 시장 → 사용·예약 한도 → 오늘/질문/기록 → 실행·질문 → 진행 → 모델별 원문 → 최종 결론 순서. 실제 분기는 권한·로딩·오류·선택 상태에 따라 달라진다. 화면 배치는 이 표면의 구성이지 전사 규칙이 아니다.
- 확인 범위: 소스 기반 문서화 점검이다. 이 턴에서 브라우저 실행, 네트워크 접근, 운영 API 호출, 비밀 파일 열람, UI 수정, 테스트 실행 및 캡처 쓰기는 하지 않았다.

## Colors

색 값의 소유자는 `client/src/index.css`의 `:root` / `.dark`이며 화면은 의미 기반 유틸리티를 사용한다. 아래는 관찰 값이며 새 토큰 등록이 아니다.

| 상속 경로 | 라이트 실제 값 | 다크 실제 값 | 이 화면의 용도 |
|---|---|---|---|
| background → bg-canvas | `#f5f5f2` | `#0b0b0c` | body/앱 배경 |
| card → bg-surface | `#ffffff` | `#141416` | 모델별 원문·최종 결론·오류 컨테이너 |
| foreground → label-primary | `#252824` | `#ededef` | 본문·제목·현재 단계 |
| muted-foreground → label-secondary | `#62665f` | `rgba(255,255,255,0.62)` | 설명·비용·출처·비활성 단계 |
| border/input → separator | `#deded8` | `rgba(255,255,255,0.08)` | 구분선·입력 테두리 |
| muted → fill-quaternary | `rgba(37,40,36,0.032)` | `rgba(255,255,255,0.04)` | 데이터 없음·서비스 비활성 안내·JSON |
| primary / primary-foreground | `#252824` / `#ffffff` | label-primary / `#0b0b0c` | 선택 시장·실행 버튼 |
| secondary → bg-subtle | `#efefeb` | `#1f1f23` | 진행 상태 Badge |
| destructive | system-red (`#b3413a`) | `#ff5a69` | 에러·비용 상한·갱신 경고 |
| ring | `#3e7252` | label-primary | 공통 키보드 포커스 |

- **The Inherited Tokens Rule.** 화면은 공통 의미 토큰을 소비한다. 이 파일에서 전역 색을 재정의하거나 별도 팔레트·브랜드 색을 등록하지 않는다.
- 근거: `index.css:5`의 theme 매핑, `:root`, `.dark`, body 적용; `AdsAnalysis.tsx:435` 이후의 `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-destructive` 사용. 화면에 CSS 변수 선언·색 리터럴·인라인 스타일·테마별 자체 색 분기는 없다.

## Typography

- 실제 상속: `main.tsx`가 `index.css`를 로드하고 body가 `font-sans`를 적용한다. 화면·Button·Badge·Textarea·Label에는 별도 font-family가 없다.
- 공통 실제 스택: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif` (`index.css:8`).
- Pretendard 로딩 선언: `client/index.html:28`의 버전 고정 Pretendard Variable stylesheet. 선언은 확인했지만 네트워크 금지 범위에서 실제 다운로드·글리프 폰트는 검증하지 않았다. Pretendard 단일 폰트가 모든 OS에서 실현된다고 판정하지 않는다.

| 관찰 역할 | 소스 | 유틸리티의 기본 환산값* |
|---|---|---|
| 화면 제목 | `text-2xl font-semibold tracking-tight` | 24px / 32px, 600 |
| 최종 결론 제목 | `text-lg font-semibold` | 18px / 28px, 600 |
| 일반 섹션 제목 | 크기 지정 없이 `font-semibold` | body 상속, 기본 16px / 24px, 600 |
| 원문·설명·목록 | `text-sm`, 원문 `leading-relaxed` | 14px / 20px, 원문 line-height 1.625 |
| 단계·비용·출처·Badge | `text-xs`, Badge `font-medium` | 12px / 16px, Badge 500 |
| 공통 Button | `text-[12px] font-medium` | 12px, 500; 줄높이는 상속 |
| 질문 Textarea | `text-base md:text-sm`, 화면 `min-h-28` | 모바일 16px / 24px, md 이상 14px / 20px |

\* Tailwind 표준 유틸리티 기준이며 런타임 computed style 측정값은 아니다. rem 환산은 기본 16px 기준이다.

- body의 글자 간격 `-0.012em`, 숫자 `tabular-nums`, h1–h3 기본 간격 `-0.035em`을 상속한다. 화면 제목은 `tracking-tight`도 선언하므로 최종 cascade는 런타임 확인 대상이다.
- **The Inherited Type Rule.** 광고 분석에는 새 display face나 독립 type token을 추가하지 않는다. 기존 시스템 폰트 우선순위 문제를 이 화면의 새 규칙으로 승인하지 않는다.

## Layout

- `AdsAnalysis.tsx:435`: 중앙 정렬, 최대 폭 1440px, 좌우 16px → sm 24px → lg 32px, 세로 24px, 섹션 간격 24px.
- 원문 그리드 `:813`: 기본 한 열, lg 이상 세 열; 간격 16px. 최종 합의·이견 `:891`: md 이상 두 열, 간격 24px.
- 원문 카드 `:817`: padding 20px; 최종 결론 `:868`: 20px → sm 24px. 공통 간격은 주로 8/12/16/20/24px.
- 긴 문장 `break-words`, 원문 `whitespace-pre-wrap`, 카드 `min-w-0`, 최종 본문 최대 75ch. JSON은 별도 overflow와 `break-all`; 기록 표는 `overflow-x-auto`.
- 모바일 순서는 동일하며 헤더·시장·단계·기록 행은 wrap한다. 현재 코드만으로 실제 모든 viewport의 무넘침을 인증하지 않는다.

## Elevation & Depth

- 화면 자체 shadow·gradient·offset shadow 선언은 없다. 경계선·의미 기반 표면과 공통 `.bg-card` 하이라이트를 계승한다.
- 공통 `.bg-card`는 `--highlight-top`을 사용한다: 라이트 `none`, 다크 `inset 0 1px 0 rgba(255,255,255,0.04)`.
- 공통 Textarea에는 `shadow-xs`와 focus ring이 존재한다. 따라서 시스템 전체를 “그림자 전면 금지”로 기록하지 않는다. 다크 전역 `--shadow-sm/md: none`도 임의의 유틸리티 그림자 전부를 제거하는 규칙은 아니다.

## Shapes

- `index.css`의 기준 radius는 0.75rem(12px); `rounded-lg`는 12px, `rounded-md`는 10px로 매핑된다.
- 원문·결론·안내는 `rounded-lg`; Badge·Textarea·기록 버튼은 `rounded-md`. 공통 Button은 명시적 8px이며 작은 크기 변형은 6px이다. 표면에서 새로운 radius 토큰을 만들지 않는다.

## Components

- 샘플 확인: `components/ui/button.tsx`, `badge.tsx`, `textarea.tsx`, `label.tsx`; 셸 `Layout.tsx`, 테마 `ThemeContext.tsx`, `App.tsx`.
- Button: 시장 default/outline, 화면 탭 secondary/ghost, 재조회 outline, 실행 default. 공통 focus-visible outline·disabled opacity·150ms transition·active scale을 계승한다.
- Badge: secondary 의미 색과 공통 테두리/모서리 사용. 선택 상태는 `aria-pressed`, 안내는 `role=status`, 오류는 `role=alert`로 구분한다.
- Textarea/Label: 연결된 `ads-question` ID, 공통 IME 처리·포커스·disabled 상태, 화면 최소 높이 112px와 최대 2000자.
- 진행 단계 최종 수정은 소스에 적용되어 있다: `AdsAnalysis.tsx:29`의 중립 `stepNames`, `:749`의 현재 단계만 `phases` 사용. 완료 시 단계 목록이 계속 진행 중이라고 표현하지 않는다.
- enabled gate 최종 수정은 소스에 적용되어 있다: `:343`의 `index.enabled === false` 제출 차단, `:416`의 serviceDisabled, `:509` 안내, `:538`, `:558`, `:571` 부근의 버튼·질문 입력 disabled. 기존 기록 조회와 재조회는 계속 가능하다. enabled 미제공은 false로 간주하지 않는다.
- 테스트 **소스** 근거: `AdsAnalysis.test.ts:140` 완료 목록의 “중” 부재, `:158` 현재 단계만 진행 표시, `:175–184` enabled=false에서 직접 form submit까지 POST가 늘지 않는 검사. 이 턴에서 테스트를 재실행한 것으로 보고하지 않는다.
- 아이콘: `lucide-react`의 AlertCircle/Loader2/RefreshCw 런타임 SVG(16px). 장식 glyph·새 이미지·새 광고 raster를 사용하지 않는다. 공통 shell HTML의 기존 PWA PNG 아이콘은 런타임 앱 아이콘이며 광고 분석용 신규 자산이 아니다.
- 캡처 근거 경계: `.impeccable/review/ads-{desktop,desktop-dark,mobile,mobile-dark,history-mobile,progress-mobile}.png`는 테스트의 합성 데이터 검토 산출물이다. 최신 재캡처와 시각 판정은 메인 작업 담당 범위다. 기존 파일을 다시 쓰거나 이번 턴의 시각 검증으로 간주하지 않았다.
- 캡처 harness는 실제 AdsAnalysis 컴포넌트·index.css·WorkspaceProvider를 사용하지만 합성 HTML이다. ThemeProvider 대신 html의 `.dark`를 직접 전환하고 운영 `client/index.html`의 Pretendard CDN 로딩을 재현하지 않는다. `document.fonts.ready` 대기는 Pretendard 사용 증명과 같지 않다. 캡처 쓰기는 `ADS_UI_CAPTURE=1`일 때만 수행된다.

## Do's and Don'ts

- **Do** 기존 ERP 문맥·의미 토큰·공통 컴포넌트·밝음/어두움 전환을 계승한다. `App.tsx:197`은 light 기본값과 switchable을 지정하고 ThemeProvider는 html의 `.dark`를 전환한다.
- **Do** 원문·교차 검토·최종 결론과 데이터 없음/미참여를 구분한다. 이 표면의 내용 구성을 전사 필수 레이아웃으로 승격하지 않는다.
- **Don't** 이 문서의 관찰 값을 새 전역 토큰, 새 브랜드, 새 폰트 체계나 DESIGN 파일 교체로 해석한다.
- **Don't** 스크린샷·테스트 소스 존재를 이번 턴의 브라우저 검사 성공이나 운영 기능 검증 성공으로 바꿔 기록한다.
- **Not canonized / not repaired:** 기존 SF 우선 font-sans와 Pretendard 단일 폰트 결정의 불일치; `index.css` 주석의 다크 기본 설명과 실제 App light 기본의 불일치; 공통 Button 주석의 44px 목표와 실제 기본 h-7(28px)의 불일치. 모두 광고 분석 이전 공통 구현의 드리프트이며 지정된 문서 전용 경계 밖이므로 수정하거나 새 시스템 규칙으로 승인하지 않는다. 시스템 display face도 이 화면의 권장 규칙으로 만들지 않는다.
- 문서 형식 드리프트: 기존 `DESIGN.md`는 업무 Design Lock 문서로서 reference/document.md의 YAML 토큰/8개 canonical section 형식이 아니며 `.impeccable/design.json`은 점검 시 존재하지 않았다. ordinary extension 요청에 따라 incumbent을 보존하고 형식 마이그레이션·sidecar 생성은 하지 않는다.
- Context 도구가 보고한 `.impeccable/config.json`의 buildPath 미설정은 기존 설정 드리프트로만 기록한다. 이 표면의 검토를 위해 설정을 신설하거나 변경하지 않는다.
