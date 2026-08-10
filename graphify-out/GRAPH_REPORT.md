# Graph Report - .  (2026-08-10)

## Corpus Check
- Large corpus: 222 files · ~1,623,996 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1445 nodes · 3564 edges · 132 communities (96 shown, 36 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 92 edges (avg confidence: 0.75)
- Token cost: 321,108 input · 0 output

## Community Hubs (Navigation)
- ERP Bootstrap & Test Utilities
- Workspace Context & Org Chart
- Build Toolchain (package.json)
- Phase1 Brand Order Domain Types
- AI Agent Team & ERP MCP Server
- Item Master & Order Numbering
- UI Card Components
- Dialogs & CAD Assignment
- Demo Data Seeding
- Client Data Store Layer
- TypeScript Config Refs
- Material Master & Popover UI
- BOM Management & Costing
- App Shell & Page Routing
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109

## God Nodes (most connected - your core abstractions)
1. `cn()` - 80 edges
2. `react` - 65 edges
3. `genId()` - 56 edges
4. `ItemMaster()` - 39 edges
5. `Button()` - 38 edges
6. `store` - 35 edges
7. `Input()` - 33 edges
8. `BomManagement()` - 33 edges
9. `formatKRW()` - 31 edges
10. `fetchVendors()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `오픈 전 필수 보안 작업 (RLS·JWT·계정)` --semantically_similar_to--> `인증 전환·RLS 미적용 보안 구멍`  [INFERRED] [semantically similar]
  ERP_수정.md → HANDOVER.md
- `Apple HIG 기반 디자인 규칙` --references--> `하네스 엔지니어링 규칙 (CLAUDE.md)`  [AMBIGUOUS]
  APPLE_DESIGN.md → CLAUDE.md
- `Maison Atelier 디자인 (선택안)` --semantically_similar_to--> `Apple HIG 기반 디자인 규칙`  [INFERRED] [semantically similar]
  ideas.md → APPLE_DESIGN.md
- `통합 포털 3사업부 탭 구조` --semantically_similar_to--> `3-워크스페이스 모델 (OEM/LUMEN/AETALOOP)`  [INFERRED] [semantically similar]
  ERP_수정.md → DESIGN.md
- `ERP AI Agent (AMESCOTES)` --conceptually_related_to--> `ATLM 통합 ERP 기획서 (Living Doc)`  [INFERRED]
  AGENT.md → 기획서.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ATLM 통합 ERP 스펙 문서 체계** — ___master_plan, design_design_lock_v1, design_brand_ops_brand_ops_design, ______dev_start_guide [EXTRACTED 1.00]
- **project_no 기반 발주→손익 추적 흐름** — design_project_no_spine, design_brand_order_batches, design_pl_three_split, design_brand_ops_reorder_unified [INFERRED 0.85]
- **다중 에이전트 개발 거버넌스** — claude_harness_rules, claude_orchestrator_pattern, claude_redlines, harness_checklist_three_stage_review [INFERRED 0.85]
- **자체 호스팅 ERP 스택 (Caddy→PostgREST/Express→Postgres)** — docker_compose_caddy, docker_compose_app, docker_compose_postgrest, docker_compose_db, docker_compose_self_hosted_stack [EXTRACTED 1.00]
- **projectCode로 꿰는 전표 흐름 (수주→발주→입고→채권·채무)** — docs__archive_____workflow_projectcode, docs__archive_____workflow_oemorder, docs__archive_____workflow_vendorreceivable, docs__archive_____workflow_vendorpayable, docs__archive_____workflow_syncpayablefrompurchase [EXTRACTED 1.00]
- **ERP 모듈 문서 세트 (API 설계 + 알림 + 4개 모듈)** — docs_api_api_design, docs_alerts_alert_system, modules_bom_bom, modules_orders_orders, modules_inventory_inventory, modules_shipping_shipping [INFERRED 0.85]

## Communities (132 total, 36 thin omitted)

### Community 0 - "ERP Bootstrap & Test Utilities"
Cohesion: 0.08
Nodes (49): ExchangeSettings, ensureErpBootstrap(), applyColorTestData(), buildColorQtys(), DEFAULT_COLORS, fillMissingItemColorsForTest(), hasMeaningfulColorQtys(), isPlaceholderColor() (+41 more)

### Community 1 - "Workspace Context & Org Chart"
Cohesion: 0.07
Nodes (39): WorkflowGuide, useWorkspace(), WorkspaceContext, WorkspaceContextValue, WorkspaceProvider(), clearRoleOverrides(), ensureOrgChartSeeded(), getAssigneeForRole() (+31 more)

### Community 2 - "Build Toolchain (package.json)"
Cohesion: 0.04
Nodes (46): autoprefixer, esbuild, devDependencies, autoprefixer, esbuild, postcss, prettier, tailwindcss (+38 more)

### Community 3 - "Phase1 Brand Order Domain Types"
Cohesion: 0.04
Nodes (37): ApprovalLog, BoardOrderInput, BrandBatchStatus, BrandOrderBatch, BrandOrderLine, CAMPAIGN_CHANNELS, CampaignTask, CampaignTaskCheck (+29 more)

### Community 4 - "AI Agent Team & ERP MCP Server"
Cohesion: 0.08
Nodes (26): getToolLabel(), ImageInput, runAgentTeam(), ERP_TOOLS, executeTool(), supabase, router, upload (+18 more)

### Community 5 - "Item Master & Order Numbering"
Cohesion: 0.09
Nodes (34): nextOrderNo(), parseRevision(), updateItemCostData(), ACC_CATEGORIES, BomCostResult, bomLinesForPricing(), BulkColorQty, calcBomCosts() (+26 more)

### Community 6 - "UI Card Components"
Cohesion: 0.11
Nodes (24): Card(), CardAction(), CardContent(), CardDescription(), CardFooter(), CardHeader(), CardTitle(), DialogOverlay() (+16 more)

### Community 7 - "Dialogs & CAD Assignment"
Cohesion: 0.17
Nodes (21): BUCKETS, CadTarget, UNIT, Dialog(), DialogCompositionContext, DialogContent(), DialogFooter(), DialogHeader() (+13 more)

### Community 8 - "Demo Data Seeding"
Cohesion: 0.11
Nodes (33): bomLine(), colorBom(), now(), postLine(), seedDemoIntegrationData(), SeedResult, today(), trySb() (+25 more)

### Community 9 - "Client Data Store Layer"
Cohesion: 0.06
Nodes (27): BomPnlAssumptions, BomSectionKey, ColorBom, ContactHistory, getBomForOrderFromList(), HqSupplyItem, ItemStatus, KEYS (+19 more)

### Community 10 - "TypeScript Config Refs"
Cohesion: 0.07
Nodes (30): build, client/src/**/*, dist, dom, dom.iterable, esnext, node, node_modules (+22 more)

### Community 11 - "Material Master & Popover UI"
Cohesion: 0.09
Nodes (23): MaterialMaster, HoverZoomImage(), HoverZoomImageProps, Popover(), PopoverContent(), PopoverTrigger(), onSaveFail(), COMMON_BRAND (+15 more)

### Community 12 - "BOM Management & Costing"
Cohesion: 0.08
Nodes (24): calcActualMultiple(), BomCategory, BomSubPart, deleteBom(), BOM_SECTIONS, BomLineRow, BomPnlAssumptions, calcPnl() (+16 more)

### Community 13 - "App Shell & Page Routing"
Cohesion: 0.08
Nodes (23): App(), BomManagement, BrandOrders, ChinaWarehouse, DeadlineManagement, DocumentOutput, ExpenseEntry, ItemMaster (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (22): LineSheet, fmtKrw(), Props, SalesPricingPanel(), calcSalesPricing(), DEFAULT_GLOBAL_MARKUP, discountFromWholesale(), SALES_PRICE_LABELS (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (24): MaterialQuickAddDialog(), confirmMaterialOrder(), genId(), generateStyleNo(), fetchBoms(), fetchItems(), fetchMaterials(), fetchOrders() (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (22): DropdownMenu(), DropdownMenuTrigger(), Currency, Expense, ExpenseCategory, ExpenseLine, ExpenseType, EMPTY_HEADER (+14 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (18): ProductDiscountSheet(), won(), Signature, SignatureDialog(), Sheet(), SheetContent(), SheetDescription(), SheetFooter() (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (21): CAMPAIGN_TEAMS, deleteItem(), deleteProject(), fetchMembers(), fetchProjects(), Member, Project, ProjectItem (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (18): CURRENCIES, UNITS, Select(), SelectContent(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton() (+10 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (21): addDays(), assignLanes(), CalendarViewMode, diffDays(), eventPosition(), getBands(), isSunday(), isWeekend() (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (21): anchors, byMedia, byProduct, data, drawing, KO_SLUG, mapPath, mapping (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (16): CampaignProjectPanel(), STATUS_LABEL, TASK_STATUS, Badge(), badgeVariants, Tabs(), TabsContent(), TabsList() (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.21
Nodes (19): displayMaterialName(), MaterialNameField(), materialPool(), PackBomEditor(), PackBomEditorProps, applyPackLinesToBom(), createEmptyPackBom(), findMaterialForPackLine() (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (18): CadAssignDialog(), NEEDS_WIDTH(), Assign, ASSIGN_LABEL, CadLine, calcFabricYD(), calcLeatherSF(), classify() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (19): TaskMentionsBlock(), ADMIN_EMAIL, ADMIN_EMAILS, getCurrentUser(), hashPassword(), hasPermission(), initDefaultUsers(), isAdminEmail() (+11 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (16): usePersistedState(), calcDDay(), dDayColor(), dDayLabel(), formatKRW(), formatNumber(), ChinaWarehouse(), Dashboard() (+8 more)

### Community 27 - "Community 27"
Cohesion: 0.10
Nodes (19): extends, parser, plugins, version, rules, no-console, no-unused-vars, react/react-in-jsx-scope (+11 more)

### Community 28 - "Community 28"
Cohesion: 0.13
Nodes (17): bottomTabs, brandNav, Layout(), LayoutProps, NavGroup, navGroups, NavItem, pmsTabs (+9 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (16): SampleManagement, DialogDescription(), SampleBillingStatus, SampleDocument, SampleLocation, SampleMaterialCheckItem, SampleMaterialRequest, SampleRevisionNote (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.17
Nodes (17): calcLineAmt(), calcPostSummary(), calcQty(), ceil10(), CostLineLike, isPackKitBom(), linePrice(), PostProcessLineLike (+9 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (17): ES2023, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection (+9 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (17): boms, boms_updated_at, exchange_rates, items, items_updated_at, materials, materials_updated_at, production_orders (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (17): AMESCOTES OS App Shell (Vite entry HTML), HR/Operation 서비스 (근태·휴가 API), AMESCOTES OS 셸 (로그인 + ERP/PMS/HR 런처), Express App Service (:4000), Caddy Reverse Proxy (:80/:443), Postgres 16 DB Service, PostgREST Service, 자체 호스팅 전체 스택 (Supabase 대체) (+9 more)

### Community 34 - "Community 34"
Cohesion: 0.12
Nodes (16): VendorMaster, BillingType, VendorRegion, VendorType, deleteVendor(), AI_TYPE_CHOICES, AiVendorDraft, BILLING_TYPES (+8 more)

### Community 35 - "Community 35"
Cohesion: 0.21
Nodes (12): AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay() (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (15): normalizeMaterialCategory(), BOM_LIGHT_COLS, convertBomFromDB(), deleteItem(), deleteOrder(), deletePurchaseItem(), fetchBomsLight(), mergeByIdStyleNo() (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (15): aliases, components, hooks, lib, ui, utils, rsc, $schema (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (12): syncPhase1FromSupabase(), supabase, convertBomRow(), findItemIdByStyleNo(), mergePurchaseItems(), normalizeBomLine(), normalizeColorBom(), normalizePostLine() (+4 more)

### Community 39 - "Community 39"
Cohesion: 0.17
Nodes (13): classify(), data, files, fs, LB, MAT_RE, MAT_WORDS, num() (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.19
Nodes (7): NotFound, Button(), migrateLocalToSupabase(), Message, PendingImage, QUICK_PROMPTS, ProjectPL()

### Community 41 - "Community 41"
Cohesion: 0.21
Nodes (11): DocLang, PO_T, PurchaseOrderDoc(), SampleRequestDoc(), calcStatementTotals(), krwInWords(), StatementDoc(), SUPPLIER (+3 more)

### Community 42 - "Community 42"
Cohesion: 0.16
Nodes (14): buildCampaignProjectTasks(), buildOrderReceiptSummary(), ensureProject(), generateProjectNo(), getAll(), isLegacyAutoTask(), migrateCampaignTasks(), normalizeTask() (+6 more)

### Community 43 - "Community 43"
Cohesion: 0.26
Nodes (12): cleanSpaces(), __dirname, inferCats(), KO_COLOR_SUFFIXES, loadEnv(), main(), parseWorkbook(), ROOT (+4 more)

### Community 44 - "Community 44"
Cohesion: 0.21
Nodes (12): 개발 시작 가이드 (START HERE), ERP AI Agent (AMESCOTES), EC2 t4g.small 스왑 2GB 상시 설정, 하네스 엔지니어링 규칙 (CLAUDE.md), 소요량 OCR 엔드포인트 (/api/yardage/ocr), 오케스트레이터 + 병렬 서브에이전트 패턴, 발주→자재구매 연동 흐름 (절대 수정 금지), 레드라인 (빌드실패 커밋·테이블 DROP·중복코드 금지) (+4 more)

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (12): 디자인 금지 목록 (안티패턴 12종), Apple HIG 기반 디자인 규칙, 모노톤 원칙 (액센트=블랙), 시맨틱 컬러 토큰 (Label/Background/Fill), 스프링 모션 시스템, Squircle 연속곡률 코너, BGROW campaign-pl 코드 재사용 전략, ATLM ERP 디자인 브레인스토밍 (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (11): copyDocAsImage(), inlineImages(), inlineStyles(), printDoc(), renderPng(), saveDocAsImage(), calcLine(), calcStatement() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (8): CostComparison, Category, ErpCategory, CATEGORY_CODE_MAP, CostRow, EditField, EditingCell, fmtKrw()

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (8): Textarea(), TimerResponse, useComposition(), UseCompositionOptions, UseCompositionReturn, noop, usePersistFn(), react

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (10): approval_logs, brand_order_batches, brand_order_lines, defect_carryovers, payables, projects, purchase_items, receipt_logs (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.24
Nodes (10): 개조 진화 로드맵 (0~5단계), ECOUNT 대체 + 회계 경계, 3-코드 축 (거래처+품목+자재 코드), 브랜드 묶음 발주 (brand_order_batches), ATLM 통합 ERP 설계서 v1 (Design Lock), 이지어드민 연동 경계 (ERP는 조회·기록만), 패킹자재 분리 + 원가 옵션 토글, 손익 3분리 (프로젝트/제품/기획전) (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.24
Nodes (9): CostSheetPrint, BomPnlAssumptions, calcPnl(), CostSheetPrint(), ExtBom, ExtBomLine, ExtColorBom, fmtKrw() (+1 more)

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (9): SalesSummary, isLegacyPackConsumable(), Item, BatchCostItem, BulkOrderItemState, EMPTY_ORDER_STAT, ERP_CATEGORIES, ItemOrderRound (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.27
Nodes (9): COMMON, __dirname, kitLines(), KITS, loadEnv(), main(), mat(), MATERIALS (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.31
Nodes (9): AI 리오더 수요예측 (R1), 브랜드 운영 최우선 전략, 브랜드 운영 설계서 (DESIGN_BRAND_OPS), 운영캘린더 + 기획전 프로젝트 (L1/L2), 채널↔상품코드 매핑 (브랜드 전용), 칸반 3단계 + 태그, 실판매가 매출 집계, 리오더 단일 화면 + 상품코드 통일 로직 (+1 more)

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (8): ConfirmMaterialOrderParams, ConfirmMaterialOrderResult, round3(), splitQtyByOrders(), CartItem, ProductionOrder, Vendor, PostOrderState

### Community 56 - "Community 56"
Cohesion: 0.39
Nodes (9): BomManagement(), createNewBom(), defaultPnl(), getExtBoms(), newExtLine(), newPostLine(), normalizeBom(), resolvePackItemCostKrw() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.22
Nodes (9): lucide-react, dependencies, lucide-react, @radix-ui/react-label, @radix-ui/react-slot, @supabase/supabase-js, @radix-ui/react-label, @radix-ui/react-slot (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (8): build, buildCommand, builder, deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 59 - "Community 59"
Cohesion: 0.32
Nodes (8): ATLM 통합 ERP 기획서 (Living Doc), OEM 6단계 파이프라인, 설정형 RBAC 3단계 권한, 통합 Inbox (BGROW 벤치마크), 위젯 조립형 대시보드 (K), 홀세일 = 해외 바이어 전용 (B2), 업무 OS (업무허브·위젯·Inbox 3층), 불량 차감 이월 (defect_carryovers)

### Community 60 - "Community 60"
Cohesion: 0.32
Nodes (7): SignatureSlot(), ColorRow, orderedBy(), pick(), WorkOrderDoc(), Bom, BomLine

### Community 61 - "Community 61"
Cohesion: 0.25
Nodes (7): base, env, H, outDir, ROOT, tables, today

### Community 62 - "Community 62"
Cohesion: 0.43
Nodes (7): extract_color_code(), get_existing_style_nos(), main(), parse_excel(), 예: LLL6S82SB → ('LLL6S82', 'SB') LSL6S44KB → ('LSL6S44', 'KB'), supabase_get(), supabase_post()

### Community 63 - "Community 63"
Cohesion: 0.38
Nodes (6): Router(), fetchLatestRates(), manualFetchExchangeRate(), useAutoExchangeRate(), isAuthenticated(), restoreSession()

### Community 64 - "Community 64"
Cohesion: 0.29
Nodes (3): ErrorBoundary, Props, State

### Community 65 - "Community 65"
Cohesion: 0.48
Nodes (7): 누락 알림 시스템 설계, ERP-AI 에이전트 API 연동 설계, 음성 등록 연동 흐름 (Whisper→LUMEN AI→ERP API), BOM 관리 모듈, 재고 관리 모듈, 발주/주문 관리 모듈, 배송/납기 관리 모듈

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (7): 인증 전환·RLS 미적용 보안 구멍, Railway → AWS 이전 인수인계 문서, Nixpacks 빌드 구성 (npm 강제·puppeteer 스킵), Supabase 관리형 Postgres (운영 DB), ERP ↔ Daily Check 데이터 연계 계층, server/daily-bridge.ts (ERP→Daily 조회), services/erp_bridge.py (Daily→ERP 조회)

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (6): 공유 백본 + 조립식 워크스페이스, 3-워크스페이스 모델 (OEM/LUMEN/AETALOOP), 통합 포털 3사업부 탭 구조, DataWave 마케팅 대시보드 연동, ATLM ERP 통합 수정사항 보고서, 오픈 전 필수 보안 작업 (RLS·JWT·계정)

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (6): ATLM 통합 ERP 구성 샘플 (브랜드+OEM 워크스페이스 목업), LUMEN Line Sheet Preview (마켓·환율·할인·반올림 계산), MD 대시보드 목업 (Chart.js, GMROI×매출구성비 분석), 운영 캘린더 · 기획전 프로토타입, 브랜드운영_구성샘플 리다이렉트 (brand-sample.html 동일 파일), ATLM 통합 ERP 24탭 전체 UI 샘플

### Community 69 - "Community 69"
Cohesion: 0.40
Nodes (6): reportSbFailure(), sbDelete(), sbUpdate(), sbUpsert(), updateMaterial(), toSnakeCase()

### Community 71 - "Community 71"
Cohesion: 0.50
Nodes (4): detectCategory(), ParsedBomSheet, parseExcelBomSheet(), SECTION_MAP

### Community 72 - "Community 72"
Cohesion: 0.40
Nodes (3): [dir, baseUrl, token], headers, TABLE_ORDER

### Community 73 - "Community 73"
Cohesion: 0.50
Nodes (3): headers, [outDir, baseUrl, key], TABLES

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): Props, Campaign, PlacedEvent

## Ambiguous Edges - Review These
- `Apple HIG 기반 디자인 규칙` → `하네스 엔지니어링 규칙 (CLAUDE.md)`  [AMBIGUOUS]
  APPLE_DESIGN.md · relation: references

## Knowledge Gaps
- **450 isolated node(s):** `session-start.sh script`, `parser`, `@typescript-eslint`, `react-hooks`, `eslint:recommended` (+445 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Apple HIG 기반 디자인 규칙` and `하네스 엔지니어링 규칙 (CLAUDE.md)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `react` connect `Community 48` to `ERP Bootstrap & Test Utilities`, `Workspace Context & Org Chart`, `Item Master & Order Numbering`, `UI Card Components`, `Dialogs & CAD Assignment`, `Material Master & Popover UI`, `BOM Management & Costing`, `App Shell & Page Routing`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 22`, `Community 23`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 34`, `Community 35`, `Community 40`, `Community 47`, `Community 51`, `Community 52`, `Community 63`, `Community 64`, `Community 70`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `cn()` connect `UI Card Components` to `Community 64`, `Community 35`, `Community 70`, `Dialogs & CAD Assignment`, `Community 40`, `Material Master & Popover UI`, `Community 48`, `Community 17`, `Community 19`, `Community 22`, `Community 29`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `genId()` connect `Community 15` to `ERP Bootstrap & Test Utilities`, `Item Master & Order Numbering`, `Demo Data Seeding`, `Client Data Store Layer`, `Material Master & Popover UI`, `BOM Management & Costing`, `Community 16`, `Community 17`, `Community 19`, `Community 23`, `Community 25`, `Community 26`, `Community 29`, `Community 30`, `Community 34`, `Community 36`, `Community 46`, `Community 55`, `Community 56`, `Community 63`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `ItemMaster()` (e.g. with `fetchBomsLight()` and `fetchItems()`) actually correct?**
  _`ItemMaster()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `session-start.sh script`, `parser`, `@typescript-eslint` to the rest of the system?**
  _450 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ERP Bootstrap & Test Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.07910014513788098 - nodes in this community are weakly interconnected._