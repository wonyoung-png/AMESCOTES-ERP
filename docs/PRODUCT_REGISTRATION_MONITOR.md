# 상품 등록 모니터 계약

소유: `server/shop-monitor.ts`, `.test.ts`. DB/공통 타입/index/화면은 부모 소유. 운영 DB 실행 및 외부 쓰기 없음.

## 부모가 추가할 DB 계약 (erp_server만 접근, anon/public 금지)

- `db/15_product_registration.sql`의 기존 컬럼 사용, 컬럼 추가 불필요. 설정 `id='default'`: `monitor_enabled,daily_time,weekly_day,weekly_time`. 승인자 설정/매핑 컬럼을 덮지 않고 네 컬럼만 PATCH.
- runs: `id,schedule_id,run_date,status,lease_owner,lease_until,results,created_at,finished_at` (기존 UNIQUE(schedule_id,run_date)). issues: `id,listing_id,kind,message,first_seen,last_seen,resolved_at,details` (기존 UNIQUE(listing_id,kind)).
- **추가 필요한 RPC** `product_shop_monitor_claim(p_id text,p_schedule_id text,p_run_date date,p_owner text,p_ttl_seconds integer DEFAULT 600) -> boolean`. INSERT 또는 동일 schedule_id+run_date의 failed/만료 running 선점 원자화. completed는 재선점 금지. 미만료 running은 false. now() 기준 lease_until. id가 다르면 동일슬롯 소유자로 취급하지 않음.
- **추가 필요한 RPC** `product_shop_monitor_finish(p_id text,p_owner text,p_issues jsonb,p_checked jsonb,p_result jsonb,p_report jsonb,p_cards jsonb) -> boolean`.
  - lease_owner 일치 + 미만료 running에만 진행; 아니면 false. 모든 변경 한 트랜잭션. p_now = DB now().
  - p_issues의 listing_id+kind upsert: 기존 활성 first_seen 보존; 해결 후 재발은 first_seen=p_now; last_seen=p_now, resolved_at=NULL.
  - p_checked는 `{listing_id,kinds:string[]}` 배열: 실제 확인한 종류에 한해서 미재현 기존 문제 resolved_at=p_now. 실패/타임아웃/일일 미점검 분야를 해결로 기록하지 않음.
  - p_report를 team_agent_runs INSERT (id 고정, model='rule-based', trigger='shop_daily'|'shop_weekly'|'shop_manual'); p_cards는 반드시 빈 배열. 장기 이슈는 report.needs에 source='product_registration',listingId,issueId로 직접 CEO결정에 전달. 일반 업무카드를 만들지 않아 팀 에이전트 모델 호출을 유발하지 않음.
  - runs status=completed, finished_at=p_now,results=p_result. 실패 시 전체 rollback.
- 실패 처리는 별도 RPC 불필요: runs?id=eq.ID&lease_owner=eq.OWNER&status=eq.running PATCH status=failed (소유자 fenced, 다른 worker의 결과 불변). 에러 원문 저장하지 않음.

## 채널 읽기 전용 계약 (Tesla/부모 연결)

`configureShopMonitorReader(reader)` 또는 `startShopMonitor(reader)`로 주입.
`reader(listing, channel, signal) -> Promise<ChannelSnapshot>`; 타입은 shop-monitor.ts export. listing은 payload를 펼치고 실컬럼으로 덮은 flat snake_case. reader는 필요한 API를 **읽기만** 한다. Shopify GraphQL query는 허용, mutation 금지. signal을 모든 HTTP에 전달.

- 동일 listing 안에서 채널 snapshot expected/actual 비교용 값은 해당 채널 어댑터가 실제 전송 규칙으로 정규화한다. expected가 없으면 ERP 필드로 기본 비교(직접 등록 payload hash와 동일한 설명 정규화 필요).
- `state`: ok/missing/unavailable. API 실패는 unavailable, 확정 404만 missing. API 원문 오류를 전달하거나 보고에 넣지 않는다.
- `name, price, description, image_count, categories, filters:{material,color,size,design}, seo_title,seo_description, images:[{url,alt,status?}], page_status, active, online_store_published, ja_description,ja_details,ja_title,ja_meta_title,ja_meta_description,inventory,preorder_ordered`.
- `checked` 목록으로 실제 읽은 필드만 명시. 배열/필터/번역 미조회는 missing과 구분. 이미지 status는 HEAD 결과; reader가 안 주면 모니터가 승인된 공개 이미지 CDN만 HEAD로 점검.
- `expected` 선택: name/price/description/image_count/categories/filters/seo_title/seo_description (읽기 어댑터 자체의 변환 규칙과 동일하게 계산).
- 원산지·재고는 비교하지 않음. inventory는 채널별 수치 보고만.

## 실행·화면 연결

- 부모 index: shopMonitorRouter mount, startShopMonitor() 호출. Tesla의 실제 channels/monitor.readMonitorSnapshot을 기본 연결했으며 startShopMonitor(reader)로 주입도 가능. 미연결·미조회 채널은 미확인 경보이며 성공/정합으로 주장하지 않음.
- **최종 경로** GET/PUT `/api/shop-monitor/settings`, POST `/api/shop-monitor/run` `{mode:'daily'|'weekly',request_id:'사용자요청고유키'}`. fresh currentUser + CEO_EMAILS. 동적 상품등록 라우트와 충돌하지 않음. settings 응답은 래퍼 없이 raw4필드. 수동 요청 id 중복도 DB선점으로 차단. 신규 탭 불필요.
- POST 신규 완료 응답 `{duplicate:false,report}`. 같은 수동 요청은 DB완료 보고가 있으면 `{duplicate:true,state:'completed',report}` 원본 재반환. 미만료 실행 `{duplicate:true,state:'running'}`; 자료 불명확 `{duplicate:true,state:'unknown'}`는 완료로 해석 금지. 로컬 겹침 409 `{busy:true}`, 저장 실패503 `{error:'monitor_run_failed'}`. 결과 원문 오류를 보내지 않음.
- KST 1분 틱, 기본 매일09:00/월09:30. 최신 도래 슬롯 1회 catchup (일일 전날/주간 지난 월요일 포함), 과거 슬롯 전체 반복 실행 없음. 일정 변경 시 당일 동일 mode+KST날짜 id 유지.
- 별도 실행 잠금. 읽기 단계 전체 2분, DB 요청 15초, lease 10분. timeout으로 취소된 외부 read가 늦게 반환해도 보고/쓰기 불가.
- 일일: 오류/예약기한/24h 사전검증/공개페이지/프리오더. 주간: 전항목. 보고 상위10건, 3 KST일 이상 지속 시에만 needs. restore는 승인 제안일 뿐 모니터가 자동 복구/품절 전환하지 않음.
- 기존 ceo.ts latestRuns는 team_agent_runs를 읽는다. 대표 전용 officeAgents·shopDecisions와 콘솔 자사몰관리 연결을 통합했다. 직원 조직도에는 노출하지 않는다. 실제 DB·운영 보고 화면 검수는 남아 있다.
- 부모 DB15에 claim/finish 계약 추가됨: 소유자+미만료 lease fence, 문제 upsert, checked 종류만 resolve, 보고 INSERT와 runs 완료 같은 트랜잭션. 21개 모의 테스트에서 signature/trigger/p_cards/lease 조건 정적 대조 및 실제 reader 소비자 연동 통과(실제 DB 실행 아님).
- stats.evidence.sourceHash는 listing/이미지/관측값의 SHA256 근거(hash도 동일 값 보존), scope='shop:daily'|'shop:weekly',checkedAt,complete. 읽기 실패·미조회·필터 매핑 미확정이면 complete=false지만 새 보고 자체는 reportAvailable=true. parent ceo는 기존 teamEvidence 대신 rule-based/sourceHash/checkedAt(0~25h)로 freshness를 판단하고 관측 미확인은 warn·complete=false로 별도 유지.
- Kepler 확인: **상품 등록 서버의 자체 1분 scheduler**가 사전 승인한 date 프리오더 종료를 담당(승인 revision/품목·이미지·매핑 hash 재확인 + listing DB lease). 모니터 자체는 쓰기 실행하지 않으며 이중 실행 hook도 추가하지 않음. receipt 해제는 실제 운영 실입고 검증 계약이 없어 게이트+경보만; ERP 테스트 입고를 쓰지 않음. cap은 어댑터의 정확한 hardcap이 미지원이면 승인 전에 차단, 모니터 관측만으로 정확한 판매 한도 보장을 주장하지 않음.

## 모의 검증 / 운영 검수 대기

- server/shop-monitor.test.ts 21/21: 차이·필터/SEO/JA/alt/404 누락, 재고 독립, KST 최신 슬롯 catchup, 중복 선점, 저장 실패 재시도, 기한 초과 읽기, 이전404 미확인 시 해결 금지, 수동 응답 유실 복구, CEO 경계, 설정 부분 저장, SQL 계약, 모델 import 부재, 수정 중인 이전 공개 상품 점검 유지.
- 실제 createMonitorReader를 가짜 Cafe24 GET/HEAD·토큰 저장소로 소비자 연동: 자동 OAuth 갱신·외부 쓰기 없음, image404와 페이지200이지만 진열/판매OFF인 상품 공개오류 확인.
- 최초 tsc/npm build 통과(기존 번들 크기/동적 import 경고). 최종 sourceHash 보강 후 19개 회귀 통과. 동시 부모 ceo.ts:249 변경의 AgentRun.model 타입 누락으로 최신 tsc 실패(agents.ts는 부모 소유, 수정 요청 전달). 운영 DB/채널/실브라우저/서버 자동 틱 실행 미검증, 커밋·푸시·배포 없음.
- 운영에서 DB선점·보고 원자성(응답 유실/만료 lease 포함), 실제 SEO/필터 매핑·Shopify publication·JA 번역·이미지 HEAD, 원본 보고/CEO결정 노출을 Claude가 확인해야 함. Shopify SIZE는 ERP 사이즈 마스터를 사용하며 별도 custom 참조를 요구하지 않음. 이전 공개 상품은 수정 중에도 일일 실제 공개 점검을 유지함.
