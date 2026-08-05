# AMESCOTES OS — 플랫폼 간 데이터 연계 가이드

> ERP(Node/Postgres)와 Daily Check(Python/SQLite)가 서로의 데이터를 읽을 수 있는 기반 계층.
> 2026-08-05 구축. 원칙: **읽기 전용** — 상대 데이터의 변경은 반드시 해당 플랫폼의 API/화면으로만.

## 구조

```
ERP (app)  ──dailyFetch()──▶  Daily (daily:8000)     ERP가 매출·재고·물류 데이터 읽기
Daily      ──erp_get()─────▶  PostgREST (postgrest)   Daily가 품목·발주·BOM 데이터 읽기
            인증: 양쪽 모두 PGRST_JWT_SECRET로 서명한 60초 서비스 토큰 (신규 시크릿 불필요)
```

## 사용법

**Daily에서 ERP 데이터** — `services/erp_bridge.py`
```python
from services.erp_bridge import erp_get, erp_count
items = erp_get("items", "select=style_no,name&season=eq.27SS&limit=50")
total = erp_count("production_orders")
```
- 증명 엔드포인트: `GET /api/erp/summary` (마스터 행수), `GET /api/erp/items?limit=20`

**ERP에서 Daily 데이터** — `server/daily-bridge.ts`
```ts
import { dailyFetch } from './daily-bridge.js';
const daily = await dailyFetch('/api/health');       // 모든 daily API 경로 사용 가능
```
- 증명 엔드포인트: `GET /api/bridge/daily/summary` (로그인 세션 필요)

## 환경 (이미 구성됨)

| 서비스 | env | 값 |
|---|---|---|
| app(ERP) | `DAILY_URL` | `http://daily:8000` |
| daily | `POSTGREST_URL` | `http://postgrest:3000` |
| 공통 | `PGRST_JWT_SECRET` | 서명 검증 공유 (SSM 관리) |

## 교차 기능 개발 시 규약

1. 새 연계 엔드포인트는 각 플랫폼의 `routes/erp_link.py`(daily) / `server/daily-bridge.ts`(ERP)에 모은다
2. 대량 조회는 `select=`로 필요한 컬럼만, `limit` 필수
3. 쓰기 연계가 필요해지면 이 문서에서 설계 먼저 합의 (현재는 금지)
4. ERP 테이블 스키마: `supabase/schema.sql` + `db/0*.sql` · Daily 스키마: SQLite `data/daily.db` (core.py 참조)
