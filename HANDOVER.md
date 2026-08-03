# AMESCOTES ERP — Railway → AWS 이전 인수인계 문서

> 작성일: 2026-07-23 · 대상: 인프라 이전 담당자
> **핵심 요약: 옮길 것은 "앱 서버 1개"뿐이다.** DB는 Supabase(외부 관리형)라 이전 대상이 아니며,
> 앱은 단일 Node 프로세스(Express가 정적 파일 + API를 함께 서빙)다. Docker 없이 Nixpacks로 빌드 중.

---

## 1. 코드베이스 개요

### 런타임 / 빌드
- [ ] **언어**: TypeScript (프론트 React 19, 백엔드 Express 4)
- [ ] **Node 버전**: 프로덕션(Railway) = **Node 22** (nixpacks.toml에서 고정) / 개발 PC = v24.14.1 / `package.json engines` 필드는 **없음** → AWS에서는 Node 22 기준으로 맞추면 됨
- [ ] **패키지 매니저**: **npm** (lock 파일: `package-lock.json` 단 하나)
  - ⚠️ 과거 pnpm 흔적(pnpm-lock.yaml, packageManager 필드) 때문에 빌드가 계속 깨졌던 이력 있음. **pnpm/yarn lock 파일을 다시 만들지 말 것**
  - `.npmrc`: `legacy-peer-deps=true` (필수 — react19 peer 충돌 회피), `puppeteer_skip_download=true`
- [ ] **빌드**: `npm run build` = `vite build`(프론트 → dist/public) + `esbuild server/index.ts`(백엔드 → dist/index.js)
- [ ] **실행**: `npm run start` = `NODE_ENV=production node dist/index.js`
- [ ] **포트**: `process.env.PORT` (기본 4000, Railway에서는 8080 사용)
- [ ] **헬스체크 엔드포인트**: `GET /api/agent/health` (그 외 `/api/yardage/health`, `/api/vendor/ocr/health`)

### 구조
- [ ] **모노레포 아님** — 단일 저장소, **서비스 1개** (web+api 통합: Express가 `dist/public` 정적 서빙 + `/api/*` 처리)
- [ ] worker 없음 / Railway cron 없음 (스케줄 작업은 §5의 "Railway 밖 구성요소" 참고)
- [ ] 디렉토리: `client/`(React) · `server/`(Express) · `agents/`(AI 에이전트·MCP) · `scripts/`(운영 스크립트) · `supabase/`(스키마·마이그레이션)

### 배포 설정 파일 (전문)
- [ ] `Dockerfile` 없음 · `Procfile` 없음 · `railway.toml` 없음
- [x] **railway.json**:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```
- [x] **nixpacks.toml**:
```toml
# Railway/Nixpacks 빌드 설정
# 목적: pnpm 자동선택 차단(npm 강제) + Node 고정 + puppeteer 브라우저 다운로드 스킵
[variables]
PUPPETEER_SKIP_DOWNLOAD = "true"
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"

[phases.setup]
nixPkgs = ["nodejs_22"]

[phases.install]
cmds = ["PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install --legacy-peer-deps --no-audit --no-fund"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm run start"
```
- ⚠️ **puppeteer 주의**: 의존성에 있으나 브라우저 다운로드를 스킵해서 빌드함. 그래서 Railway에서는 `/api/print/pdf`(서버 PDF)가 미동작 → 클라이언트가 브라우저 인쇄로 폴백. **AWS에서 Chrome/chromium을 설치해주면 서버 PDF 기능이 자동 복원됨** (선택사항).

---

## 2. 환경변수 (값은 별도 전달 — §7 참고)

| 변수명 | 용도 | 구분 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL. **빌드 시점에 프론트에 박힘** (VITE_ 접두어) | 외부 서비스 |
| `VITE_SUPABASE_ANON_KEY` | Supabase 공개(publishable) 키. 빌드 시점에 프론트에 박힘 | 외부 서비스 |
| `SUPABASE_URL` | 서버측 Supabase URL (AI 에이전트용) | 외부 서비스 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 관리자 키 (서버 전용, **절대 프론트 노출 금지**). 없으면 AI 에이전트 라우트만 비활성화되고 앱은 정상 | 외부 서비스 (비밀) |
| `ANTHROPIC_API_KEY` | Claude API — OCR(소요량 계산·거래처 명함) 및 AI 에이전트 | 외부 서비스 (비밀) |
| `PORT` | 서버 포트 (기본 4000) | 내부 설정 |
| `SHARE_USER` / `SHARE_PASS` | Basic Auth 1차 게이트. **PASS가 비어있으면 게이트 꺼짐** (현재 꺼진 상태로 운영) | 내부 설정 |

- ⚠️ `VITE_*` 두 개는 런타임이 아니라 **빌드 타임**에 주입됨 → AWS에서 값 바꾸면 반드시 재빌드 필요
- 코드상 `USERPROFILE`, `TEMP` 참조는 Windows 로컬 스크립트용 — 서버 배포와 무관

---

## 3. 데이터

- [ ] **DB: Supabase 관리형 Postgres** (프로젝트: `linzfvhgswrnoukssqyi.supabase.co`, Pro 플랜 결제 중)
  - **AWS 이전 대상 아님.** 앱만 옮기면 DB 연결은 그대로 동작 (환경변수만 넣으면 됨)
  - Postgres 버전은 Supabase 대시보드에서 확인
- [ ] **ORM 없음** — `@supabase/supabase-js` + PostgREST 직접 호출. 쿼리 계층: `client/src/lib/supabaseQueries.ts`
- [ ] **마이그레이션**: 도구 없음(수동). SQL 파일 위치 `supabase/*.sql` — `schema.sql`(기본 스키마) + migration_*.sql 다수. `MIGRATION_REQUIRED.md`에 적용 안내
  - ⚠️ `migration_rls_step1.sql`은 **아직 미적용** (§6 보안 참고)
- [ ] **Railway 볼륨: 없음** — 파일 업로드는 multer `memoryStorage`(메모리, 비영속). 제품 이미지는 저장소 내 정적파일(`client/public/lumen-27ss/`, 30장) 또는 DB 컬럼(base64)
- [ ] **시드 데이터 있음**: 앱 최초 로그인 시 자동 시드 로직(`client/src/lib/seed*.ts`, `ensureErpBootstrap.ts`) — LUMEN 27SS 데모 30품목 등. 운영 DB에는 실데이터(품목 ~865 · BOM ~235)와 데모가 섞여 있음
- [ ] **로컬 하이브리드 주의**: 일부 데이터(자재구매 장바구니·구매항목, 사용자 계정, 설정)는 **브라우저 localStorage**에 저장됨. DB로 완전 이전은 미완 과제
- [ ] **백업**: ① Supabase Pro 자동백업(7일 보관) ② 대표 PC에서 매일 21:00 전 테이블 JSON 덤프 → `문서\ERP_백업\날짜\` (30일 보관, 현재 ~2.3MB, 스크립트 `scripts/backup-supabase.mjs`)

---

## 4. 외부 연동

| 서비스 | 용도 | 도메인 변경 시 영향 |
|---|---|---|
| **Supabase** | DB·(전환 중) 인증 | 없음 (아웃바운드) · 단, Supabase **Auth 활성화 후에는** 대시보드 Authentication→URL Configuration의 Site URL/Redirect URL 갱신 필요 |
| **Anthropic API** | OCR·AI 에이전트 | 없음 (아웃바운드) |

- [ ] 결제·이메일·소셜로그인·인바운드 웹훅 **전부 없음** → **도메인 변경 시 수정할 콜백 URL 없음** (가장 간단한 케이스)

---

## 5. 현재 배포 상태

- [ ] **운영 URL**: `https://amescotes-erp-production.up.railway.app` (Railway 기본 도메인, 포트 8080)
- [ ] **커스텀 도메인: 없음** — `erp.atlm.kr` 연결 예정이었으나 미실행. atlm.kr DNS는 도메인 등록처(대표 관리)에서 설정
- [ ] **배포 방식**: GitHub `main` push → Railway 자동 빌드·배포 (저장소: `github.com/wonyoung-png/AMESCOTES-ERP`, private)
- [ ] Railway 내 cron/워커/볼륨/추가 서비스: **없음** (서비스 1개가 전부)
- [ ] **Railway 밖 구성요소 (대표 사무실 PC — AWS 이전과 별개로 존치)**:
  - 사내 LAN 서버: 같은 앱을 `http://192.168.0.4:4000`으로 상시 구동 (시작프로그램 `ATLM-ERP-Server.lnk` → `ERP_boot.bat`)
  - Windows 작업 스케줄러 `ATLM ERP Daily Backup` 매일 21:00 → JSON 백업

---

## 6. 진행 중 과제 (이전 담당자가 알아야 손대지 않을 것들)

- [ ] **인증 전환 중 (2단계 중 1단계 완료)**: 로그인이 "Supabase Auth 우선 → 실패 시 레거시(클라이언트 해시) 폴백" 이중 구조. Supabase Auth에 직원 계정 5개 생성 + 전원 재로그인 후 `migration_rls_step1.sql` 실행이 남은 절차
- [ ] **RLS 미적용 = anon 키로 DB 전체 읽기/쓰기 가능** — 위 절차 완료 전까지의 알려진 보안 구멍. 도메인/주소를 외부에 공개하기 전 반드시 완료할 것
- [ ] 27SS 데모 품목 2세트(60개) 중복 존재 — 삭제하지 말고 대표 결정 대기
- [ ] 서버 PDF(puppeteer)는 Chrome 미설치 환경에서 브라우저 인쇄 폴백으로 동작

---

## 7. 인수인계 시 별도 전달 항목 (이 문서에 넣지 않음)

- [ ] **.env 값 전체** — 보안상 git에 올라가는 이 문서에는 미포함. 대표 PC `AMESCOTES-ERP\.env` + 바탕화면 `HANDOVER_SECRETS.md`(git 외부)로 전달. 전달 후 Anthropic 키는 재발급(회전) 권장
- [ ] **Railway 대시보드 스크린샷 4장** — 대표가 캡처해서 첨부: ① Variables 탭 ② Volumes 탭(없음 확인용) ③ Settings 탭(Source/Networking) ④ Metrics 탭(리소스 사용량 — AWS 인스턴스 사이징 근거)
- [ ] **DB 덤프** — 두 가지 중:
  - 간이: 대표 PC `문서\ERP_백업\최신날짜\` JSON 전체 (테이블별)
  - 정식 pg_dump: Supabase 대시보드 → Settings → Database → Connection string 확보 후 `pg_dump "<connection-string>" > dump.sql` (DB 비밀번호는 대표만 재설정/확인 가능)
- [ ] **소스 접근 권한**: GitHub private repo → 대표가 Settings→Collaborators에서 이전 담당자 계정 초대. 이후 `git clone https://github.com/wonyoung-png/AMESCOTES-ERP.git` → `npm install --legacy-peer-deps` → `.env` 생성 → `npm run build && npm start`
- [ ] **Supabase 프로젝트 접근**: 대시보드 멤버 초대 (Organization → Team)

---

## 8. 현재 플랫폼 기능 목록 (화면 24개)

| 구분 | 화면 (경로) |
|---|---|
| 대시보드·안내 | 대시보드(/) · 워크플로우 가이드(/workflow) · 조직도(/org) |
| 마스터 | 품목(/items) · 자재(/materials) · 거래처(/vendors) |
| 생산(OEM) | 샘플관리(/samples) · BOM/원가(/bom) · 원가비교(/cost-comparison) · 생산발주(/orders) · 자재구매(/purchase) · 입고/출고(/receiving) · 납기관리(/deadlines) |
| 정산·재무 | 거래명세/세금계산서(/trade-statement) · 정산(/settlement) · 미지급(/payables) · 프로젝트 손익(/project-pl) · 지출전표(/expense) · 문서출력(/documents) |
| 브랜드 | 브랜드 발주(/brand-orders) · 라인시트(/line-sheet) · 중국창고(/china-warehouse) · 운영캘린더(/calendar) |
| 설정 | 환율/설정(/settings) |
| 부가기능 | 손글씨 소요량 OCR(이미지→BOM 자재), 거래처 명함 OCR, AI 에이전트 패널(SSE), 원가계산서/작업지시서 인쇄, 엑셀 일괄등록·양식 다운로드, 3-워크스페이스(OEM/LUMEN/AETALOOP) 전환 |

---

## 9. 이전 담당자가 대표에게 추가로 물어봐야 할 것

1. **Supabase 대시보드 접근 권한** (멤버 초대) + **DB 비밀번호/Connection string** — pg_dump와 RLS 적용에 필요
2. **SUPABASE_SERVICE_ROLE_KEY** — Railway Variables에는 있으나 문서·저장소에는 없음
3. **Anthropic API 키의 소유 계정과 월 사용한도** — 이전 후 키 회전 여부
4. **GitHub 저장소 권한 이양 방식** — collaborator 초대인지, organization 이전인지
5. **`erp.atlm.kr` 도메인 연결 의사와 atlm.kr DNS 관리처** (등록기관/네임서버 위치)
6. **직원 4명의 로그인 비밀번호** — 원본 파일(`10_팀원비밀번호_대표님보관용.md`) 분실 상태. Supabase Auth 계정 생성 시 신규 발급 필요
7. **27SS 데모 데이터(중복 60품목) 정리 방침** — 어느 세트를 남길지
8. **사내 LAN 서버(192.168.0.4:4000) 존치 여부** — AWS 이전 후에도 사무실 고속 접속용으로 유지할지
9. **Supabase `MIGRATION_REQUIRED.md`의 미적용 마이그레이션이 있는지** 대표 PC의 다른 Claude 세션(CMD) 작업 이력 확인
10. **Railway 해지 시점** — AWS 안정화 확인 후 며칠 병행 운영할지
