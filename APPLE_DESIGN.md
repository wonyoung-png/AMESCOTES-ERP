# APPLE_DESIGN.md

> Apple Human Interface Guidelines 기반 디자인 규칙.
> 프로젝트 루트에 두고 `CLAUDE.md`에서 `@APPLE_DESIGN.md`로 참조하거나, 프롬프트에 통째로 붙여넣어 사용.
> **이 문서의 값은 제안이 아니라 규칙이다. 임의 변경 금지, 필요 시 이 파일을 먼저 수정한다.**

---

## 0. 3대 원칙

| 원칙 | 의미 | 구현 판단 기준 |
|---|---|---|
| **Clarity (명료함)** | 텍스트는 어느 크기에서도 읽히고, 아이콘은 정확하고, 장식은 기능에 종속된다 | "이 요소를 지우면 정보가 사라지는가?" 아니면 삭제 |
| **Deference (양보)** | UI는 콘텐츠를 돕고 물러난다. 크롬(chrome)이 콘텐츠보다 시각적으로 강하면 실패 | 스크린샷을 흐리게 봤을 때 콘텐츠가 먼저 보여야 함 |
| **Depth (깊이)** | 레이어·모션으로 계층과 위치를 전달한다. 그림자 남발이 아니라 **레이어 순서**로 표현 | z축 표현은 material + 스케일 + 모션 순서로 |

---

## 1. Typography

### 폰트 스택
```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif;
--font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Pretendard Variable", Pretendard, sans-serif;
--font-mono: "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```
- 한글은 **Pretendard** 고정. 나눔/노토 혼용 금지.
- 20px 이상 → Display, 미만 → Text (자간이 다름).
- 숫자 정렬이 필요한 표·대시보드는 `font-variant-numeric: tabular-nums;`

### 타입 스케일 (iOS 기준, px)

| 역할 | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|
| Large Title | 34 | 700 | 41 | +0.4 |
| Title 1 | 28 | 700 | 34 | +0.36 |
| Title 2 | 22 | 700 | 28 | -0.26 |
| Title 3 | 20 | 600 | 25 | -0.45 |
| Headline | 17 | 600 | 22 | -0.43 |
| Body | 17 | 400 | 22 | -0.43 |
| Callout | 16 | 400 | 21 | -0.31 |
| Subhead | 15 | 400 | 20 | -0.23 |
| Footnote | 13 | 400 | 18 | -0.08 |
| Caption 1 | 12 | 400 | 16 | 0 |
| Caption 2 | 11 | 400 | 13 | +0.06 |

**규칙**
- 한 화면에 3개 스텝 이상 섞지 않는다 (예: Title 2 + Body + Footnote).
- Weight는 400 / 500 / 600 / 700만. 300 이하, 800 이상 금지.
- 본문 최소 15px. 11px은 라벨 전용.
- **자간 넓히기 금지 (2026-08-03 개정)**: tracking-wide/wider/widest 및 양수 letter-spacing 사용 금지.
  큰 텍스트(제목)만 tracking-tight로 좁히고, 나머지는 기본 자간.
- 대문자 전체(ALL CAPS)는 섹션 아이브로우에만 — 자간은 기본값 유지.

---

## 2. Color

색을 하드코딩하지 않는다. **시맨틱 레이어**로만 접근한다.

### 시맨틱 토큰
```css
:root {
  /* Label — 텍스트 4단계 */
  --label-primary:    rgba(0,0,0,1);
  --label-secondary:  rgba(60,60,67,0.60);
  --label-tertiary:   rgba(60,60,67,0.30);
  --label-quaternary: rgba(60,60,67,0.18);

  /* Background — 그룹 배경 3단계 */
  --bg-primary:   #FFFFFF;
  --bg-secondary: #F2F2F7;
  --bg-tertiary:  #FFFFFF;

  /* Fill — 컨트롤 배경 (반투명이라 어떤 배경 위에도 얹힘) */
  --fill-primary:    rgba(120,120,128,0.20);
  --fill-secondary:  rgba(120,120,128,0.16);
  --fill-tertiary:   rgba(118,118,128,0.12);
  --fill-quaternary: rgba(116,116,128,0.08);

  --separator:        rgba(60,60,67,0.29); /* 반투명 구분선 */
  --separator-opaque: #C6C6C8;
}

@media (prefers-color-scheme: dark) {
  :root {
    --label-primary:    rgba(255,255,255,1);
    --label-secondary:  rgba(235,235,245,0.60);
    --label-tertiary:   rgba(235,235,245,0.30);
    --label-quaternary: rgba(235,235,245,0.18);

    --bg-primary:   #000000;
    --bg-secondary: #1C1C1E;
    --bg-tertiary:  #2C2C2E;

    --fill-primary:    rgba(120,120,128,0.36);
    --fill-secondary:  rgba(120,120,128,0.32);
    --fill-tertiary:   rgba(118,118,128,0.24);
    --fill-quaternary: rgba(118,118,128,0.18);

    --separator:        rgba(84,84,88,0.60);
    --separator-opaque: #38383A;
  }
}
```

### 시스템 컬러 (Light / Dark)
| 이름 | Light | Dark | 용도 |
|---|---|---|---|
| Blue | `#007AFF` | `#0A84FF` | 기본 액션·링크 |
| Green | `#34C759` | `#30D158` | 성공·완료 |
| Red | `#FF3B30` | `#FF453A` | 파괴적 액션·에러 |
| Orange | `#FF9500` | `#FF9F0A` | 경고 |
| Yellow | `#FFCC00` | `#FFD60A` | 주의 |
| Indigo | `#5856D6` | `#5E5CE6` | 보조 강조 |
| Teal | `#30B0C7` | `#40C8E0` | 정보 |
| Gray | `#8E8E93` | `#8E8E93` | 비활성 |

**규칙**
- **모노톤 원칙 (2026-08-03 개정)**: 액센트 = 블랙(#1C1C1E). 포인트 컬러 사용 금지.
  Filled 버튼·활성 상태·링크 전부 블랙/화이트 모노톤. 사이드바는 라이트(화이트 + 헤어라인).
- 컬러는 **상태 의미가 있을 때만**: 성공 Green · 경고 Orange · 위험/연체 Red. 그 외 전부 label/fill 그레이스케일.
- 차트는 그레이스케일 팔레트 (블랙 → 그레이 단계).
- 장식용 컬러(카테고리 틴트 카드, 컬러 뱃지, 컬러 아이콘) 금지 — fill/label 토큰으로 대체.
- 컬러만으로 정보를 전달하지 않는다 (색맹 대응: 아이콘 or 텍스트 병기).
- 그라디언트는 배경 앰비언트에만. 텍스트·버튼·아이콘 그라디언트 금지.

---

## 3. Spacing & Layout

**8pt 그리드. 4pt는 미세 조정용.**

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64
```

| 상황 | 값 |
|---|---|
| 화면 좌우 마진 (모바일) | 16 |
| 화면 좌우 마진 (그룹 리스트) | 20 |
| 카드 내부 패딩 | 16 (compact) / 20 (default) |
| 리스트 행 높이 | 44 (기본) / 60 (서브타이틀 포함) |
| 섹션 간 수직 간격 | 32 (모바일) / 48~64 (데스크탑) |
| 아이콘 ↔ 라벨 | 8 |
| 버튼 내부 패딩 | 12 세로 / 20 가로 |
| 최소 터치 타깃 | **44 × 44** (예외 없음) |

- 정렬은 좌측 기준. 중앙 정렬은 빈 상태·모달 헤더에만.
- 데스크탑 콘텐츠 최대 폭: 텍스트 680, 대시보드 1440.
- 여백은 요소 사이가 아니라 **그룹 사이**에 준다. 관련된 것은 붙이고 무관한 것은 띄운다.

---

## 4. Corner Radius (Squircle)

애플의 모서리는 원호가 아니라 **연속 곡률(continuous curvature)**이다. 이게 "애플처럼 보이는" 핵심 디테일 중 하나.

```css
/* iOS/macOS 계열 */
border-radius: 12px;
/* Safari/WebKit 한정 squircle */
-webkit-border-radius: 12px;
/* 정밀 구현이 필요하면 SVG path 또는 corner-shape: squircle (지원 브라우저) */
```

| 요소 | Radius (2026-08-03 개정 — 라운드 축소) |
|---|---|
| 버튼 (small) | 6 |
| 버튼 (default) | 8 |
| 카드 / 리스트 그룹 | 8 |
| 시트 / 모달 | 12~16 (상단만) |
| 앱 아이콘 규격 컨테이너 | 22% of size |
| Pill 버튼 | 999 — 세그먼트·필터 칩에만 |

**동심원 규칙**: 중첩 시 `외곽 radius = 내부 radius + 패딩`.
예) 카드 radius 16 + 패딩 8 → 내부 이미지 radius는 8.

---

## 5. Materials & Elevation

그림자로 띄우지 말고 **재질(material)**로 띄운다.

```css
.material-regular {
  background: rgba(255,255,255,0.72);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}
.material-thick {  /* 시트, 모달 */
  background: rgba(255,255,255,0.85);
  backdrop-filter: saturate(180%) blur(30px);
}
@media (prefers-color-scheme: dark) {
  .material-regular { background: rgba(30,30,32,0.72); }
  .material-thick   { background: rgba(30,30,32,0.85); }
}
```

그림자를 써야 할 때만 이 3단계:
```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.06);
--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
--shadow-lg: 0 12px 32px rgba(0,0,0,0.12);
```
- 컬러 그림자·glow 금지.
- 카드 기본 상태는 그림자 없음. 계층은 `--separator` 1px 헤어라인으로.
- 떠 있는 요소(팝오버·시트·토스트)에만 그림자 허용.

---

## 6. Motion

애플 모션은 **스프링**이다. `ease-in-out`은 거의 쓰지 않는다.

```css
--ease-standard: cubic-bezier(0.4, 0.0, 0.2, 1);   /* 일반 전환 */
--ease-out:      cubic-bezier(0.0, 0.0, 0.2, 1);   /* 등장 */
--ease-in:       cubic-bezier(0.4, 0.0, 1, 1);     /* 퇴장 */
--spring:        linear(0, 0.006, 0.25 8%, 0.7 20%, 1.02 33%, 1.005 55%, 1); /* 스프링 근사 */

--duration-fast:   150ms;  /* 호버, 컬러 */
--duration-base:   250ms;  /* 대부분의 전환 */
--duration-slow:   350ms;  /* 시트, 화면 전환 */
```

**규칙**
- 탭/클릭 피드백: `scale(0.97)` + 100ms. 이게 애플 감성의 8할.
- 시트는 아래에서 위로, dismiss는 반대. 방향이 곧 정보다.
- 동시 애니메이션 2개 이하.
- 자동 재생 배경 애니메이션·무한 루프 금지.
- 필수:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

---

## 7. Components

### Button (4종만 존재)
| 종류 | 스타일 | 용도 |
|---|---|---|
| Filled | 배경 = 액센트, 글자 흰색, radius 10~12, weight 600 | 화면당 **1개**의 주 액션 |
| Tinted | 배경 = 액센트 15% opacity, 글자 = 액센트 | 보조 액션 |
| Gray | 배경 `--fill-tertiary`, 글자 `--label-primary` | 중립 액션 |
| Plain | 배경 없음, 글자 = 액센트 | 취소·인라인 링크 |

- 라벨은 동사형 짧게: "저장", "게시", "삭제". "제출하기" 같은 늘어짐 금지.
- 파괴적 액션은 Red + 확인 단계.
- 비활성 상태는 opacity 0.4, 숨기지 말 것.

### List / Table
- 그룹 리스트: 배경 `--bg-secondary`, 그룹 카드 `--bg-primary` + radius 12.
- 구분선은 **텍스트 시작점부터** (좌측 인셋 = 아이콘 폭 + 간격).
- 행 우측 chevron은 이동을 뜻할 때만.
- 테이블 헤더는 weight 600 / 13px / `--label-secondary`, zebra 스트라이프 금지.

### Navigation
- 상단 바: material + 하단 헤어라인, 스크롤 시 Large Title → Inline Title 축소.
- 좌측 = 뒤로, 우측 = 액션. 좌우 각각 최대 1개.
- 탭 바는 3~5개. 6개 이상이면 구조를 다시 짠다.

### Sheet / Modal
- 시트 상단 radius 20, grabber 36×5 pill (`--fill-secondary`).
- 오버레이 `rgba(0,0,0,0.4)`. 블러 중복 금지.
- Alert는 파괴적/비가역 상황에만. 정보 전달은 토스트로.

### Icons
- **SF Symbols** 우선. 웹이면 Lucide (stroke 1.5~2)로 대체하되 하나로 통일.
- 크기 17 / 20 / 24만. 텍스트 옆 아이콘은 폰트 weight와 optical weight를 맞춘다.
- 아이콘 단독 버튼도 터치 영역 44 확보.

---

## 8. Accessibility (미충족 시 배포 불가)

- 텍스트 대비 4.5:1, 큰 텍스트·아이콘 3:1.
- 모든 인터랙션에 키보드 포커스 링: `outline: 2px solid var(--accent); outline-offset: 2px;`
- 색 + 아이콘/텍스트 이중 인코딩.
- `prefers-reduced-motion`, `prefers-color-scheme`, Dynamic Type(rem 기반) 대응.
- 이미지 alt, 아이콘 버튼 `aria-label` 필수.

---

## 9. 금지 목록 (안티패턴)

1. 그라디언트 텍스트 / 그라디언트 버튼
2. 컬러 그림자, glow, neon
3. 장식용 이모지 (기능적 의미 없는 ✨🚀💡)
4. "AI-Powered", "Magic", "Revolutionary" 류 카피
5. radius 20 이상의 카드 (시트 제외)
6. 폰트 2종 초과, weight 5종 초과
7. 무한 루프 배경 애니메이션, 패럴랙스 남발
8. 한 화면에 Filled 버튼 2개 이상
9. 보더 2px 이상 (헤어라인 1px 또는 0.5px만)
10. 하드코딩된 hex 값 (반드시 토큰 참조)
11. 중앙 정렬 본문 텍스트
12. 44px 미만 터치 타깃

---

## 10. Claude Code 지시문 (그대로 복붙)

```
이 프로젝트의 UI는 APPLE_DESIGN.md를 유일한 디자인 기준으로 따른다.

작업 규칙:
1. 색/간격/radius/폰트는 APPLE_DESIGN.md의 토큰만 사용. 하드코딩 금지.
2. 새 컴포넌트를 만들기 전에 /components/ui/ 에 동일 역할 컴포넌트가 있는지 먼저 확인.
   있으면 variant props로 확장하고, 새로 만들지 않는다.
3. 9번 "금지 목록"에 해당하는 코드는 발견 즉시 제거하고 대안을 적용한다.
4. 작업 시작 전 "이번에 무엇을 바꾸고 무엇을 안 바꾸는지" 먼저 선언한다.
5. 한 번에 전체를 리팩토링하지 말고 화면 단위로 진행하며 매 단계 확인을 받는다.
6. 애매하면 추측하지 말고 질문한다.

먼저 현재 코드베이스가 APPLE_DESIGN.md를 위반하는 지점을 파일명·라인과 함께
TOP 10으로 정리해서 리포트만 줘. 코드 수정은 하지 마.
```
