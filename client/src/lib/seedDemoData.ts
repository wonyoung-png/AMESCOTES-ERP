/**
 * 전 탭 연동 확인용 데모 데이터 일괄 생성
 * project_no · order_no · style_no · vendor_id 로 전표 연결
 */
import {
  store, genId,
  type ProductionOrder, type Vendor, type Item, type Material, type Sample,
  type PurchaseItem, type TradeStatement, type Settlement, type Expense,
  type PostCost, type BomLine, type PostProcessLine, type ColorBom,
} from './store';
import { phase1, type BrandOrderBatch, type BrandOrderLine, type Campaign } from './phase1';
import {
  upsertVendor, upsertItem, upsertMaterial, upsertSample, upsertBom, upsertOrder,
  upsertPurchaseItem,
} from './supabaseQueries';
import { seedLumenPackingData } from './seedLumenPacking';

/** 버전 올리면 로그인 시 자동 재시드 */
export const DEMO_SEED_FLAG = 'ames_demo_seed_v6';

export const DEMO = {
  vendorFactory: 'demo-v-factory',
  vendorBuyer: 'demo-v-buyer',
  vendorMat: 'demo-v-mat',
  vendorPost: 'demo-v-post',
  vendor3pl: 'demo-v-3pl',
  vendorChinaCorp: 'demo-v-ames-cn',
  itemOem: 'demo-item-oem',
  itemLumen: 'demo-item-lumen',
  itemMini: 'demo-item-mini',
  matLeather: 'demo-mat-leather',
  matLining: 'demo-mat-lining',
  matZipper: 'demo-mat-zipper',
  matChain: 'demo-mat-chain',
  sampleOem1: 'demo-sample-oem-1',
  sampleOem2: 'demo-sample-oem-2',
  sampleLumen: 'demo-sample-lumen',
  sampleReject: 'demo-sample-reject',
  sampleDev: 'demo-sample-dev',
  bomOem: 'demo-bom-oem',
  bomLumen: 'demo-bom-lumen',
  bomMini: 'demo-bom-mini',
  orderOem: 'demo-order-oem',
  orderLumen: 'demo-order-lumen',
  orderLumenR2: 'demo-order-lumen-r2',
  orderLumenR3: 'demo-order-lumen-r3',
  orderMini: 'demo-order-mini',
  tradeStmt: 'demo-ts-001',
  tradeStmt2: 'demo-ts-002',
  settlement: 'demo-settle-001',
  settlement2: 'demo-settle-002',
  purchase: 'demo-purch-001',
  purchase2: 'demo-purch-002',
  purchase3: 'demo-purch-003',
  expense: 'demo-exp-001',
  expense2: 'demo-exp-002',
  postCost: 'demo-postcost-001',
  logistics: 'demo-logistics-001',
  brandBatch: 'demo-batch-lumen',
  brandBatchDone: 'demo-batch-done',
  brandLine: 'demo-line-lumen',
  brandLineDone: 'demo-line-done',
  projectOem: 'LLL2026-099',
  projectLumen: 'LUM-260713-99',
  projectMini: 'LLL2026-100',
  orderNoOem: 'PO-DEMO-2607-001',
  orderNoLumen: 'LLL6F92SB-R1',
  orderNoLumenR2: 'LLL6F92SB-R2',
  orderNoLumenR3: 'LLL6F92SB-R3',
  orderNoMini: 'PO-DEMO-2607-003',
} as const;

export interface SeedResult {
  ok: boolean;
  summary: string[];
  errors: string[];
}

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex(x => x.id === row.id);
  if (i >= 0) { const next = [...list]; next[i] = row; return next; }
  return [...list, row];
}

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().split('T')[0]; }

async function trySb(label: string, fn: () => Promise<void>, errors: string[]) {
  try { await fn(); } catch (e) {
    errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function bomLine(
  name: string, qty: number, price: number,
  opts: Partial<BomLine> & { hq?: boolean } = {},
): BomLine {
  const hq = opts.hq ?? false;
  return {
    id: genId(), category: opts.category ?? '원자재', subPart: opts.subPart,
    itemName: name, spec: opts.spec ?? '', unit: opts.unit ?? 'SF',
    unitPriceCny: price, netQty: qty, lossRate: opts.lossRate ?? 0.05,
    isHqProvided: hq, isVendorProvided: !hq,
    vendorName: hq ? '홍콩원단' : '창성가죽',
    vendorId: hq ? DEMO.vendorMat : DEMO.vendorFactory,
    memo: opts.memo ?? '',
  };
}

function postLine(name: string, qty: number, price: number): PostProcessLine {
  return { id: genId(), name, netQty: qty, unitPriceCny: price, memo: '' };
}

function colorBom(
  color: string, lines: BomLine[], postProcess: PostProcessLine[], processingFee: number,
): ColorBom & { postProcessLines: PostProcessLine[]; processingFee: number } {
  return { color, lines, postProcessLines: postProcess, processingFee };
}

export async function seedDemoIntegrationData(): Promise<SeedResult> {
  const summary: string[] = [];
  const errors: string[] = [];
  const ts = now();

  // ── 1. 거래처 ──
  const vendors: Vendor[] = [
    {
      id: DEMO.vendorFactory, name: '창성가죽', code: 'CS', companyName: '창성가죽공업',
      type: '공장', country: '중국', currency: 'CNY', contactName: '왕철', leadTimeDays: 45,
      processingUnitCost: 28, settlementCycle: '익월 30일', contactHistory: [], createdAt: ts,
    },
    {
      id: DEMO.vendorBuyer, name: 'LLL International', code: 'LLL', companyName: 'LLL Int\'l Ltd',
      type: '바이어', country: '미국', currency: 'USD', contactName: 'Sarah Kim',
      settlementCycle: '익월 15일', contactHistory: [], createdAt: ts,
    },
    {
      id: DEMO.vendorMat, name: '홍콩원단', code: 'HKF', type: '자재거래처', materialTypes: ['가죽', '원단'],
      country: '홍콩', currency: 'USD', contactName: 'Chen', settlementCycle: '익월 30일',
      contactHistory: [], createdAt: ts,
    },
    {
      id: DEMO.vendorPost, name: '광저우후가공', code: 'GZP', type: '기타', customType: '후가공',
      country: '중국', currency: 'CNY', contactName: '리밍', settlementCycle: '익월 말',
      contactHistory: [], createdAt: ts,
    },
    {
      id: DEMO.vendor3pl, name: '이천3PL', code: '3PL', type: '물류업체',
      country: '한국', currency: 'KRW', contactName: '박물류', settlementCycle: '즉시',
      contactHistory: [], createdAt: ts,
    },
    {
      id: DEMO.vendorChinaCorp, name: '아메스코테스 중국법인', code: 'AMES-CN', type: '기타',
      customType: '중국법인', country: '중국', currency: 'CNY', contactName: '재무',
      settlementCycle: '익월 15일', contactHistory: [], createdAt: ts,
    },
  ];
  let vList = store.getVendors();
  vendors.forEach(v => { vList = upsertById(vList, v); });
  store.setVendors(vList);
  for (const v of vendors) await trySb(`거래처 ${v.name}`, () => upsertVendor(v), errors);
  summary.push(`거래처 ${vendors.length}건`);

  // ── 2. 품목 ──
  const items: Item[] = [
    {
      id: DEMO.itemOem, styleNo: 'OEM-26SS-001', name: '하네스 토트백', season: '26SS',
      category: '토트백', erpCategory: 'HB', designer: 'OEM팀', material: '나파',
      deliveryPrice: 89000, marginRate: 0.35, hasBom: true, baseCostKrw: 42000,
      colors: [{ name: '블랙', leatherColor: 'BLK' }, { name: '브라운', leatherColor: 'BRN' }],
      buyerId: DEMO.vendorBuyer, createdAt: ts, updatedAt: ts,
    },
    {
      id: DEMO.itemLumen, styleNo: 'LLL6F92SB', name: '리나 숄더백', season: '26SS',
      category: '숄더백', erpCategory: 'HB', designer: 'LUMEN MD', material: '양가죽',
      deliveryPrice: 298000, marginRate: 0.55, hasBom: true, baseCostKrw: 98000,
      colors: [{ name: '샌드베이지', leatherColor: 'SB' }, { name: '블랙', leatherColor: 'BLK' }, { name: '브라운', leatherColor: 'BRN' }],
      buyerId: DEMO.vendorBuyer, createdAt: ts, updatedAt: ts,
    },
    {
      id: DEMO.itemMini, styleNo: 'OEM-26SS-MINI', name: '미니 크로스백', season: '26SS',
      category: '크로스백', erpCategory: 'HB', designer: 'OEM팀', material: '스웨이드',
      deliveryPrice: 65000, marginRate: 0.30, hasBom: true, baseCostKrw: 32000,
      colors: [{ name: '카멜', leatherColor: 'CML' }],
      buyerId: DEMO.vendorBuyer, createdAt: ts, updatedAt: ts,
    },
  ];
  let iList = store.getItems();
  items.forEach(i => { iList = upsertById(iList, i); });
  store.setItems(iList);
  for (const i of items) await trySb(`품목 ${i.styleNo}`, () => upsertItem(i), errors);
  summary.push(`품목 ${items.length}건`);

  // ── 3. 자재 마스터 ──
  const materials: Material[] = [
    { id: DEMO.matLeather, itemCode: 'MAT-DEMO-001', name: '나파가죽', spec: '1.2mm BLACK', unit: 'SF', category: '원자재', vendorId: DEMO.vendorMat, unitPriceUsd: 12.5, priceCurrency: 'USD', orderStatus: '입고완료', orderQty: 120, orderVendorName: '홍콩원단', createdAt: ts },
    { id: DEMO.matLining, itemCode: 'MAT-DEMO-002', name: '면안감', spec: '210T BEIGE', unit: 'YD', category: '원자재', vendorId: DEMO.vendorMat, unitPriceUsd: 3.2, priceCurrency: 'USD', orderStatus: '발주완료', orderQty: 80, orderVendorName: '홍콩원단', createdAt: ts },
    { id: DEMO.matZipper, itemCode: 'MAT-DEMO-003', name: 'YKK 지퍼', spec: '#5 60cm', unit: 'EA', category: '부자재', vendorId: DEMO.vendorMat, unitPriceUsd: 0.85, priceCurrency: 'USD', orderStatus: '미발주', orderQty: 0, orderVendorName: '홍콩원단', createdAt: ts },
    { id: DEMO.matChain, itemCode: 'MAT-DEMO-004', name: '체인스트랩', spec: '120cm 골드', unit: 'EA', category: '부자재', vendorId: DEMO.vendorMat, unitPriceUsd: 4.5, priceCurrency: 'USD', orderStatus: '입고완료', orderQty: 200, orderVendorName: '홍콩원단', createdAt: ts },
  ];
  let mList = store.getMaterials();
  materials.forEach(m => { mList = upsertById(mList, m); });
  store.setMaterials(mList);
  for (const m of materials) await trySb(`자재 ${m.name}`, () => upsertMaterial(m), errors);
  summary.push(`자재 ${materials.length}건`);

  // ── 4. 샘플 관리 (다양한 단계) ──
  const samples: Sample[] = [
    {
      id: DEMO.sampleOem1, styleId: DEMO.itemOem, styleNo: 'OEM-26SS-001', styleName: '하네스 토트백',
      buyerId: DEMO.vendorBuyer, season: '26SS', stage: '2차', location: '중국공장',
      round: 2, roundName: '직봉', color: '블랙', assignee: '김샘플', salesPerson: 'Sarah Kim',
      requestDate: '2026-05-10', expectedDate: '2026-06-20', costCny: 165, costKrw: 31500,
      sampleUnitPrice: 35000, imageUrls: [], billingStatus: '미청구',
      revisionHistory: [{ round: 1, date: '2026-05-25', note: '핸들 길이 2cm 단축' }],
      materialChecklist: [
        { id: genId(), itemName: '나파가죽 BLK', isReady: true },
        { id: genId(), itemName: 'YKK 지퍼', isReady: false, memo: '60cm → 55cm 변경' },
      ],
      materialRequests: [{ itemName: '나파가죽', vendor: '홍콩원단', color: 'BLK', qty: 2, unit: 'SF' }],
      createdAt: ts,
    },
    {
      id: DEMO.sampleOem2, styleId: DEMO.itemMini, styleNo: 'OEM-26SS-MINI', styleName: '미니 크로스백',
      buyerId: DEMO.vendorBuyer, season: '26SS', stage: '1차', location: '내부개발실',
      round: 1, roundName: '가봉', color: '카멜', assignee: '이개발', requestDate: '2026-07-01',
      expectedDate: '2026-07-20', costCny: 120, costKrw: 23000, imageUrls: [], billingStatus: '미청구',
      createdAt: ts,
    },
    {
      id: DEMO.sampleLumen, styleId: DEMO.itemLumen, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
      buyerId: DEMO.vendorBuyer, season: '26SS', stage: '최종승인', location: '중국공장',
      round: 3, roundName: '최종 직봉', color: '샌드베이지', assignee: '생산팀',
      requestDate: '2026-05-01', expectedDate: '2026-06-15', receivedDate: '2026-06-10',
      costCny: 180, costKrw: 34000, approvedBy: 'MD', imageUrls: [],
      billingStatus: '청구완료', billingDate: '2026-06-20', billingStatementId: DEMO.tradeStmt2,
      createdAt: ts,
    },
    {
      id: DEMO.sampleReject, styleId: DEMO.itemLumen, styleNo: 'LLL6F92SB', styleName: '리나 숄더백 (RED 시안)',
      buyerId: DEMO.vendorBuyer, season: '26SS', stage: '반려', location: '중국공장',
      round: 1, color: 'RED', assignee: '비주얼팀', requestDate: '2026-04-01',
      receivedDate: '2026-04-20', costCny: 150, costKrw: 28500, imageUrls: [],
      revisionNote: '톤 불일치 — SB 기준 재작업', billingStatus: '미청구', createdAt: ts,
    },
    {
      id: DEMO.sampleDev, styleId: DEMO.itemOem, styleNo: 'OEM-26SS-001', styleName: '하네스 토트백',
      buyerId: DEMO.vendorBuyer, season: '26SS', stage: '3차', location: '내부개발실',
      round: 3, color: '브라운', assignee: '디자인팀', requestDate: '2026-06-01',
      expectedDate: '2026-07-15', costCny: 170, costKrw: 32500, imageUrls: [],
      billingStatus: '수금완료', billingDate: '2026-06-25', collectedDate: '2026-07-05',
      createdAt: ts,
    },
  ];
  let sList = store.getSamples();
  samples.forEach(s => { sList = upsertById(sList, s); });
  store.setSamples(sList);
  for (const s of samples) await trySb(`샘플 ${s.styleNo}`, () => upsertSample(s), errors);
  summary.push(`샘플 ${samples.length}건 (1차~최종·반려·청구)`);

  // ── 5. BOM — 사전원가(colorBoms) + 사후원가(postColorBoms) ──
  const oemPreBlk = colorBom('BLK', [
    bomLine('나파가죽', 1.2, 11, { hq: true, subPart: '바디' }),
    bomLine('면안감', 0.8, 2.5, { hq: true, unit: 'YD' }),
    bomLine('YKK 지퍼', 1, 2.5, { category: '부자재', unit: 'EA' }),
    bomLine('금속 장식', 2, 1.2, { category: '부자재', unit: 'EA' }),
  ], [postLine('칼라불박 로고', 1, 3.5)], 28);

  const oemPostBlk = colorBom('BLK', [
    bomLine('나파가죽', 1.25, 11.5, { hq: true, subPart: '바디' }),
    bomLine('면안감', 0.85, 2.6, { hq: true, unit: 'YD' }),
    bomLine('YKK 지퍼', 1, 2.8, { category: '부자재', unit: 'EA' }),
    bomLine('금속 장식', 2, 1.3, { category: '부자재', unit: 'EA' }),
  ], [postLine('칼라불박 로고', 1, 3.8)], 30);

  const lumenPre = colorBom('SB', [
    bomLine('양가죽', 1.5, 13, { subPart: '바디' }),
    bomLine('체인스트랩', 1, 4, { category: '부자재', unit: 'EA' }),
    bomLine('자석 클로저', 1, 2.2, { category: '부자재', unit: 'EA' }),
  ], [postLine('엣지코팅', 1, 5)], 32);

  const lumenPost = colorBom('SB', [
    bomLine('양가죽', 1.55, 13.5, { subPart: '바디' }),
    bomLine('체인스트랩', 1, 4.2, { category: '부자재', unit: 'EA' }),
    bomLine('자석 클로저', 1, 2.4, { category: '부자재', unit: 'EA' }),
  ], [postLine('엣지코팅', 1, 5.5)], 34);

  const boms = [
    {
      id: DEMO.bomOem, styleNo: 'OEM-26SS-001', styleName: '하네스 토트백', season: '26SS',
      styleId: DEMO.itemOem, erpCategory: '토트백', designer: 'OEM팀',
      colorBoms: [oemPreBlk, { ...oemPreBlk, color: 'BRN', lines: oemPreBlk.lines.map(l => ({ ...l, id: genId() })) }],
      postColorBoms: [oemPostBlk],
      lines: oemPreBlk.lines, postMaterials: oemPostBlk.lines,
      postProcessLines: oemPreBlk.postProcessLines,
      processingFee: 28, preProcessingFee: 28, postProcessingFee: 30,
      exchangeRateCny: 191, exchangeRateUsd: 1380, snapshotCnyKrw: 191, snapshotUsdKrw: 1380,
      currency: 'CNY' as const, manufacturingCountry: '중국' as const,
      productionMarginRate: 0.16, postTotalCostKrw: 39500, postSubtotalKrw: 34000,
      postDeliveryPrice: 89000, logisticsCostKrw: 2500, packagingCostKrw: 800,
      pnl: { discountRate: 0.05, platformFeeRate: 0, sgaRate: 0.10, confirmedSalePrice: 89000 },
      version: 2, createdAt: ts, updatedAt: ts,
    },
    {
      id: DEMO.bomLumen, styleNo: 'LLL6F92SB', styleName: '리나 숄더백', season: '26SS',
      styleId: DEMO.itemLumen, erpCategory: '숄더백', designer: 'LUMEN MD',
      colorBoms: [lumenPre], postColorBoms: [lumenPost],
      lines: lumenPre.lines, postMaterials: lumenPost.lines,
      postProcessLines: lumenPre.postProcessLines,
      processingFee: 32, preProcessingFee: 32, postProcessingFee: 34,
      exchangeRateCny: 191, snapshotCnyKrw: 191, snapshotUsdKrw: 1380,
      currency: 'CNY' as const, manufacturingCountry: '중국' as const,
      productionMarginRate: 0.16, postTotalCostKrw: 102000, postSubtotalKrw: 88000,
      postDeliveryPrice: 298000,
      pnl: { discountRate: 0.10, platformFeeRate: 0.30, sgaRate: 0.12, confirmedSalePrice: 298000 },
      version: 2, createdAt: ts, updatedAt: ts,
    },
    {
      id: DEMO.bomMini, styleNo: 'OEM-26SS-MINI', styleName: '미니 크로스백', season: '26SS',
      styleId: DEMO.itemMini, erpCategory: '크로스백',
      colorBoms: [colorBom('CML', [
        bomLine('스웨이드', 0.9, 9.5, { subPart: '바디' }),
        bomLine('조절 스트랩', 1, 3, { category: '부자재', unit: 'EA' }),
      ], [], 22)],
      postColorBoms: [colorBom('CML', [
        bomLine('스웨이드', 0.95, 10, { subPart: '바디' }),
        bomLine('조절 스트랩', 1, 3.2, { category: '부자재', unit: 'EA' }),
      ], [], 24)],
      lines: [], postMaterials: [], postProcessLines: [], processingFee: 22,
      isSimpleCost: false, exchangeRateCny: 191, snapshotCnyKrw: 191,
      productionMarginRate: 0.16, postTotalCostKrw: 30500, postDeliveryPrice: 65000,
      version: 1, createdAt: ts, updatedAt: ts,
    },
  ];
  let bList = store.getBoms();
  boms.forEach(b => { bList = upsertById(bList, b as any); });
  store.setBoms(bList);
  for (const b of boms) await trySb(`BOM ${b.styleNo}`, () => upsertBom(b), errors);
  summary.push(`BOM ${boms.length}건 (사전·사후 컬러별)`);

  // ── 6. 프로젝트 ──
  phase1.ensureProject(DEMO.projectOem, 'OEM', 'OEM 데모 — LLL 하네스');
  phase1.ensureProject(DEMO.projectLumen, 'LUMEN', 'LUMEN 데모 — 리나 리오더');
  phase1.ensureProject(DEMO.projectMini, 'OEM', 'OEM 데모 — 미니 크로스');
  summary.push(`프로젝트 3건`);

  // ── 7. 생산발주 ──
  const orderOem: ProductionOrder = {
    id: DEMO.orderOem, orderNo: DEMO.orderNoOem, styleId: DEMO.itemOem, styleNo: 'OEM-26SS-001',
    styleName: '하네스 토트백', season: '26SS', revision: 1, isReorder: false, qty: 500,
    colorQtys: [{ color: 'BLK', qty: 300 }, { color: 'BRN', qty: 200 }],
    vendorId: DEMO.vendorFactory, vendorName: '창성가죽', buyerId: DEMO.vendorBuyer,
    orderDate: '2026-07-01', status: '생산중',
    milestones: [
      { stage: '발주생성', plannedDate: '2026-07-01', actualDate: '2026-07-01' },
      { stage: '샘플승인', plannedDate: '2026-06-15', actualDate: '2026-06-10' },
      { stage: '생산중', plannedDate: '2026-07-25' },
      { stage: '선적중', plannedDate: '2026-08-05' },
      { stage: '입고완료', plannedDate: '2026-08-15' },
    ],
    bomId: DEMO.bomOem, postCostId: DEMO.postCost,
    hqSupplyItems: [{
      bomLineId: 'hq-1', itemName: '나파가죽 BLACK', unit: 'SF', requiredQty: 620,
      unitPrice: 12.5, currency: 'USD', vendorId: DEMO.vendorMat, purchaseStatus: '구매완료',
    }],
    attachments: [
      { name: 'PI-2607-001.pdf', url: '#', type: 'PI' },
      { name: 'PL-2607-001.pdf', url: '#', type: 'PL' },
    ],
    deliveryDate: '2026-08-15', factoryUnitPriceCny: 45, factoryUnitPriceKrw: 8600,
    factoryCurrency: 'CNY', bomType: 'pre',
    receivedQty: 200, defectQty: 5, receivedDate: '2026-07-28', shippedQty: 150,
    projectNo: DEMO.projectOem, workspace: 'OEM', productionOrigin: 'china',
    tradeStatementId: DEMO.tradeStmt, createdAt: ts, updatedAt: ts,
  };
  const orderLumen: ProductionOrder = {
    id: DEMO.orderLumen, orderNo: DEMO.orderNoLumen, styleId: DEMO.itemLumen, styleNo: 'LLL6F92SB',
    styleName: '리나 숄더백', season: '26SS', revision: 1, isReorder: true, qty: 300,
    colorQtys: [{ color: '샌드베이지', qty: 150 }, { color: '블랙', qty: 100 }, { color: '브라운', qty: 50 }],
    vendorId: DEMO.vendorFactory, vendorName: '창성가죽',
    orderDate: '2026-07-01', status: '생산중',
    milestones: [
      { stage: '발주생성', plannedDate: '2026-07-01', actualDate: '2026-07-01' },
      { stage: '생산중', plannedDate: '2026-07-20' },
      { stage: '입고완료', plannedDate: '2026-08-15' },
    ],
    bomId: DEMO.bomLumen, hqSupplyItems: [], attachments: [{ name: 'PI-LUMEN-R1.pdf', url: '#', type: 'PI' }],
    deliveryDate: '2026-08-15', factoryUnitPriceCny: 52, factoryUnitPriceKrw: 9900,
    factoryCurrency: 'CNY', bomType: 'post',
    receivedQty: 50, receivedDate: '2026-07-10',
    projectNo: DEMO.projectLumen, workspace: 'LUMEN', productionOrigin: 'china',
    brandBatchId: DEMO.brandBatch, createdAt: ts, updatedAt: ts,
  };
  const orderLumenR2: ProductionOrder = {
    id: DEMO.orderLumenR2, orderNo: DEMO.orderNoLumenR2, styleId: DEMO.itemLumen, styleNo: 'LLL6F92SB',
    styleName: '리나 숄더백', season: '26SS', revision: 2, isReorder: true, qty: 200,
    colorQtys: [{ color: '샌드베이지', qty: 120 }, { color: '블랙', qty: 80 }], vendorId: DEMO.vendorFactory, vendorName: '창성가죽',
    orderDate: '2026-07-12', status: '발주생성',
    milestones: [
      { stage: '발주생성', plannedDate: '2026-07-12', actualDate: '2026-07-12' },
      { stage: '생산중', plannedDate: '2026-08-01' },
    ],
    bomId: DEMO.bomLumen, hqSupplyItems: [], attachments: [],
    deliveryDate: '2026-08-25', factoryUnitPriceCny: 52, factoryUnitPriceKrw: 9900,
    factoryCurrency: 'CNY', bomType: 'post',
    projectNo: DEMO.projectLumen, workspace: 'LUMEN', productionOrigin: 'china',
    brandBatchId: DEMO.brandBatch, createdAt: ts, updatedAt: ts,
  };
  const orderLumenR3: ProductionOrder = {
    id: DEMO.orderLumenR3, orderNo: DEMO.orderNoLumenR3, styleId: DEMO.itemLumen, styleNo: 'LLL6F92SB',
    styleName: '리나 숄더백', season: '26SS', revision: 3, isReorder: true, qty: 500,
    colorQtys: [{ color: '샌드베이지', qty: 250 }, { color: '블랙', qty: 150 }, { color: '브라운', qty: 100 }],
    vendorId: DEMO.vendorFactory, vendorName: '창성가죽',
    orderDate: '2026-07-20', status: '발주생성',
    milestones: [
      { stage: '발주생성', plannedDate: '2026-07-20', actualDate: '2026-07-20' },
    ],
    bomId: DEMO.bomLumen, hqSupplyItems: [], attachments: [],
    deliveryDate: '2026-09-10', factoryUnitPriceCny: 50, factoryUnitPriceKrw: 9550,
    factoryCurrency: 'CNY', bomType: 'post',
    projectNo: DEMO.projectLumen, workspace: 'LUMEN', productionOrigin: 'china',
    brandBatchId: DEMO.brandBatch, createdAt: ts, updatedAt: ts,
  };
  const orderMini: ProductionOrder = {
    id: DEMO.orderMini, orderNo: DEMO.orderNoMini, styleId: DEMO.itemMini, styleNo: 'OEM-26SS-MINI',
    styleName: '미니 크로스백', season: '26SS', revision: 1, isReorder: false, qty: 200,
    colorQtys: [{ color: 'CML', qty: 200 }], vendorId: DEMO.vendorFactory, vendorName: '창성가죽',
    buyerId: DEMO.vendorBuyer, orderDate: '2026-07-08', status: '발주생성',
    milestones: [
      { stage: '발주생성', plannedDate: '2026-07-08', actualDate: '2026-07-08' },
      { stage: '샘플승인', plannedDate: '2026-07-25' },
    ],
    bomId: DEMO.bomMini, hqSupplyItems: [], attachments: [],
    deliveryDate: '2026-08-30', factoryUnitPriceCny: 38, factoryCurrency: 'CNY', bomType: 'pre',
    projectNo: DEMO.projectMini, workspace: 'OEM', productionOrigin: 'china',
    createdAt: ts, updatedAt: ts,
  };
  const orders = [orderOem, orderLumen, orderLumenR2, orderLumenR3, orderMini];
  let oList = store.getOrders();
  orders.forEach(o => { oList = upsertById(oList, o); });
  store.setOrders(oList);
  for (const o of orders) await trySb(`발주 ${o.orderNo}`, () => upsertOrder(o), errors);
  summary.push(`생산발주 ${orders.length}건`);

  // ── 8. 사후원가(PostCost) · 물류비 ──
  const postCost: PostCost = {
    id: DEMO.postCost, orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, styleNo: 'OEM-26SS-001',
    version: 1, processingFee: 30, appliedCnyKrw: 191, appliedUsdKrw: 1380,
    lines: oemPostBlk.lines as any, totalMaterialCny: 44, totalFactoryCostCny: 74,
    totalCostKrw: 39500, sourceFileName: '창성가죽_원가표_2607.xlsx', createdAt: ts, updatedAt: ts,
  };
  store.setPostCosts(upsertById(store.getPostCosts(), postCost));

  const logistics = {
    id: DEMO.logistics, invoiceNo: 'INV-LOG-2607', freightDate: '2026-08-01',
    totalFreightKrw: 850000, allocations: [{
      orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, styleNo: 'OEM-26SS-001',
      allocatedKrw: 520000, cbm: 4.2, ctQty: 12,
    }],
    createdAt: ts,
  };
  localStorage.setItem('ames_logistics', JSON.stringify(upsertById(
    JSON.parse(localStorage.getItem('ames_logistics') || '[]'), logistics,
  )));
  summary.push('사후원가 1건 · 물류비 1건');

  // ── 9. 입고·출고 (1차 선입고 50 · 한국) ──
  const receiptRows = [
    { id: 'demo-rcpt-1', orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, projectNo: DEMO.projectOem, logType: 'inbound' as const, qty: 200, defectQty: 5, defectNote: '스크래치', receivedDate: '2026-07-28', destination: 'korea' as const, createdAt: ts },
    { id: 'demo-rcpt-2', orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, projectNo: DEMO.projectOem, logType: 'outbound_oem' as const, qty: 150, defectQty: 0, receivedDate: '2026-08-01', createdAt: ts },
    { id: 'demo-rcpt-3', orderId: DEMO.orderLumen, orderNo: DEMO.orderNoLumen, projectNo: DEMO.projectLumen, logType: 'outbound_3pl' as const, qty: 80, defectQty: 0, receivedDate: '2026-09-05', memo: '3PL 입고', createdAt: ts },
    { id: 'demo-rcpt-4', orderId: DEMO.orderMini, orderNo: DEMO.orderNoMini, projectNo: DEMO.projectMini, logType: 'inbound' as const, qty: 50, defectQty: 0, receivedDate: '2026-07-30', destination: 'korea' as const, createdAt: ts },
    {
      id: 'demo-rcpt-advance-r1', orderId: DEMO.orderLumen, orderNo: DEMO.orderNoLumen, projectNo: DEMO.projectLumen,
      logType: 'inbound' as const, qty: 50, defectQty: 0, receivedDate: '2026-07-10',
      destination: 'korea' as const, color: 'SB', isAdvance: true, memo: '1차 선입고(한국)', createdAt: ts,
    },
    {
      id: 'demo-rcpt-cn-r2', orderId: DEMO.orderLumenR2, orderNo: DEMO.orderNoLumenR2, projectNo: DEMO.projectLumen,
      logType: 'inbound' as const, qty: 80, defectQty: 0, receivedDate: '2026-07-18',
      destination: 'china' as const, color: '샌드베이지', isAdvance: true, memo: '2차 중국창고 선입', createdAt: ts,
    },
  ];
  localStorage.setItem('ames_receipt_logs', JSON.stringify(
    receiptRows.reduce((acc, r) => upsertById(acc, r), JSON.parse(localStorage.getItem('ames_receipt_logs') || '[]')),
  ));
  summary.push(`입고·출고 ${receiptRows.length}건 (리오더 1차 선입 50 · 2차 중국 80 포함)`);

  // 중국창고 장부
  const chinaMoves = [
    {
      id: 'demo-cn-move-1', workspace: 'LUMEN' as const, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
      color: '샌드베이지', qty: 80, moveType: 'inbound' as const, moveDate: '2026-07-18',
      orderId: DEMO.orderLumenR2, orderNo: DEMO.orderNoLumenR2, receiptLogId: 'demo-rcpt-cn-r2',
      memo: '2차 중국창고 선입', createdAt: ts,
    },
    {
      id: 'demo-cn-move-2', workspace: 'LUMEN' as const, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
      color: '블랙', qty: 30, moveType: 'inbound' as const, moveDate: '2026-07-15',
      memo: '중국창고 수기 입고(데모)', createdAt: ts,
    },
    {
      id: 'demo-cn-move-3', workspace: 'LUMEN' as const, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
      color: '샌드베이지', qty: 10, moveType: 'outbound' as const, moveDate: '2026-07-22',
      memo: '홀세일 샘플 출고', createdAt: ts,
    },
  ];
  localStorage.setItem('ames_china_stock_moves', JSON.stringify(
    chinaMoves.reduce((acc, r) => upsertById(acc, r), JSON.parse(localStorage.getItem('ames_china_stock_moves') || '[]')),
  ));
  summary.push(`중국창고 입출고 ${chinaMoves.length}건`);

  // ── 10. 자재구매 ──
  const purchases: PurchaseItem[] = [
    { id: DEMO.purchase, orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, purchaseDate: '2026-07-03', itemName: '나파가죽 BLACK', qty: 620, unit: 'SF', unitPriceCny: 11, currency: 'CNY', appliedRate: 191, amountKrw: 1304620, vendorId: DEMO.vendorMat, vendorName: '홍콩원단', paymentMethod: 'T/T', purchaseStatus: '구매완료', projectNo: DEMO.projectOem, createdAt: ts },
    { id: DEMO.purchase2, orderId: DEMO.orderLumen, orderNo: DEMO.orderNoLumen, purchaseDate: '2026-07-10', itemName: '양가죽 SB', qty: 480, unit: 'SF', unitPriceCny: 13, currency: 'CNY', appliedRate: 191, amountKrw: 1193040, vendorId: DEMO.vendorMat, vendorName: '홍콩원단', paymentMethod: 'T/T', purchaseStatus: '발주완료', projectNo: DEMO.projectLumen, createdAt: ts },
    { id: DEMO.purchase3, orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, purchaseDate: '2026-07-12', itemName: 'YKK 지퍼 #5', qty: 520, unit: 'EA', unitPriceCny: 2.5, currency: 'CNY', appliedRate: 191, amountKrw: 248300, vendorId: DEMO.vendorMat, vendorName: '홍콩원단', paymentMethod: '기타', purchaseStatus: '미발주', projectNo: DEMO.projectOem, createdAt: ts },
  ];
  let pList = store.getPurchaseItems();
  purchases.forEach(p => { pList = upsertById(pList, p); });
  store.setPurchaseItems(pList);
  for (const p of purchases) await trySb(`구매 ${p.itemName}`, () => upsertPurchaseItem(p), errors);
  summary.push(`자재구매 ${purchases.length}건`);

  // ── 11. 거래명세표 ──
  const tradeStmts: TradeStatement[] = [
    {
      id: DEMO.tradeStmt, statementNo: '202607-LLL-001', vendorId: DEMO.vendorBuyer,
      vendorName: 'LLL International', vendorCode: 'LLL', issueDate: '2026-08-05',
      lines: [{ id: genId(), description: 'OEM-26SS-001 하네스 토트백 BLK', qty: 150, unitPrice: 89000, taxType: '면세', taxRate: 0 }],
      status: '청구완료', projectNo: DEMO.projectOem, workspace: 'OEM', createdAt: ts,
    },
    {
      id: DEMO.tradeStmt2, statementNo: '202606-LLL-SAMPLE', vendorId: DEMO.vendorBuyer,
      vendorName: 'LLL International', vendorCode: 'LLL', issueDate: '2026-06-20',
      lines: [{ id: genId(), description: 'LLL6F92SB 샘플비 (3차)', qty: 1, unitPrice: 34000, taxType: '면세', taxRate: 0 }],
      status: '청구완료', projectNo: DEMO.projectLumen, workspace: 'OEM', createdAt: ts,
    },
  ];
  let tsList = store.getTradeStatements();
  tradeStmts.forEach(t => { tsList = upsertById(tsList, t); });
  localStorage.setItem('ames_trade_statements', JSON.stringify(tsList));
  summary.push(`거래명세표 ${tradeStmts.length}건`);

  // ── 12. 미수금 정산 ──
  const settlements: Settlement[] = [
    { id: DEMO.settlement, buyerName: 'LLL International', buyerId: DEMO.vendorBuyer, channel: 'B2B직납', invoiceNo: 'INV-DEMO-001', invoiceDate: '2026-08-05', dueDate: '2026-09-15', billedAmountKrw: 13350000, collectedAmountKrw: 5000000, status: '주의', projectNo: DEMO.projectOem, workspace: 'OEM', createdAt: ts },
    { id: DEMO.settlement2, buyerName: 'LLL International', buyerId: DEMO.vendorBuyer, channel: 'B2B직납', invoiceNo: 'INV-DEMO-SAMPLE', invoiceDate: '2026-06-20', dueDate: '2026-07-20', billedAmountKrw: 34000, collectedAmountKrw: 34000, status: '정상', projectNo: DEMO.projectLumen, workspace: 'OEM', createdAt: ts },
  ];
  let stList = store.getSettlements();
  settlements.forEach(s => { stList = upsertById(stList, s); });
  store.setSettlements(stList);
  summary.push(`미수금 ${settlements.length}건`);

  // ── 13. 미지급 · 불량차감 ──
  const payables = [
    { id: 'demo-pay-001', vendorId: DEMO.vendorFactory, vendorName: '창성가죽', projectNo: DEMO.projectOem, sourceType: 'processing' as const, amountKrw: 4300000, paidAmountKrw: 0, dueDate: '2026-09-30', status: 'pending' as const, memo: '7월 임가공비', createdAt: ts },
    { id: 'demo-pay-002', vendorId: DEMO.vendorMat, vendorName: '홍콩원단', projectNo: DEMO.projectOem, sourceType: 'purchase' as const, amountKrw: 1304620, paidAmountKrw: 500000, dueDate: '2026-08-15', status: 'partial' as const, memo: '가죽 T/T 잔금', createdAt: ts },
    { id: 'demo-pay-003', vendorId: DEMO.vendorPost, vendorName: '광저우후가공', projectNo: DEMO.projectLumen, sourceType: 'manual' as const, amountKrw: 280000, paidAmountKrw: 280000, dueDate: '2026-07-31', status: 'paid' as const, memo: '엣지코팅', createdAt: ts },
    {
      id: 'demo-pay-advance-r1', vendorId: DEMO.vendorFactory, vendorName: '창성가죽',
      projectNo: DEMO.projectLumen, sourceType: 'order_receipt' as const, sourceId: 'demo-rcpt-advance-r1',
      amountKrw: 495000, paidAmountKrw: 0, dueDate: '2026-08-10', status: 'pending' as const,
      memo: '한국입고 · LLL6F92SB-R1 · SB · 50pcs (선입)',
      payeeType: 'factory_direct' as const, orderId: DEMO.orderLumen, receiptLogIds: ['demo-rcpt-advance-r1'],
      createdAt: ts,
    },
  ];
  localStorage.setItem('ames_payables', JSON.stringify(
    payables.reduce((acc, p) => upsertById(acc, p), JSON.parse(localStorage.getItem('ames_payables') || '[]')),
  ));

  const defects = [
    { id: 'demo-def-001', styleNo: 'OEM-26SS-001', orderNo: DEMO.orderNoOem, projectNo: DEMO.projectOem, vendorId: DEMO.vendorFactory, vendorName: '창성가죽', amountKrw: 43000, reason: '스크래치 5pcs', defectDate: '2026-07-28', status: 'pending' as const, createdAt: ts },
    { id: 'demo-def-002', styleNo: 'OEM-26SS-MINI', orderNo: DEMO.orderNoMini, projectNo: DEMO.projectMini, vendorId: DEMO.vendorFactory, vendorName: '창성가죽', amountKrw: 12000, reason: '색상 편차 2pcs', defectDate: '2026-07-30', status: 'settled' as const, createdAt: ts },
  ];
  localStorage.setItem('ames_defect_carryovers', JSON.stringify(
    defects.reduce((acc, d) => upsertById(acc, d), JSON.parse(localStorage.getItem('ames_defect_carryovers') || '[]')),
  ));
  summary.push('미지급 3건 · 불량차감 2건');

  // ── 14. 지출전표 ──
  const expenses: Expense[] = [
    { id: DEMO.expense, expenseDate: '2026-07-10', expenseType: 'T/T', category: '자재구매', description: '나파가죽 선금', amountKrw: 500000, vendorId: DEMO.vendorMat, vendorName: '홍콩원단', hasTaxInvoice: false, lines: [{ id: genId(), description: '나파가죽 선금', qty: 1, unit: '건', unitPrice: 500000, amountKrw: 500000 }], orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, createdAt: ts, memo: `project: ${DEMO.projectOem}` },
    { id: DEMO.expense2, expenseDate: '2026-08-01', expenseType: '물류비', category: '물류', description: '7월 컨테이너 운임', amountKrw: 850000, vendorId: DEMO.vendor3pl, vendorName: '이천3PL', hasTaxInvoice: true, lines: [{ id: genId(), description: 'SH→ICN 운임', qty: 1, unit: '건', unitPrice: 850000, amountKrw: 850000 }], orderId: DEMO.orderOem, orderNo: DEMO.orderNoOem, createdAt: ts },
  ];
  let eList = store.getExpenses();
  expenses.forEach(e => { eList = upsertById(eList, e); });
  store.setExpenses(eList);
  summary.push(`지출전표 ${expenses.length}건`);

  // ── 15. 브랜드 발주 + R3 ──
  const batch: BrandOrderBatch = {
    id: DEMO.brandBatch, workspace: 'LUMEN', projectNo: DEMO.projectLumen,
    title: '7월 2주차 묶음발주 (데모)', weekLabel: 'W28', status: 'in_approval',
    approvalStep: 3, expectedDely: '2026-09-01', lines: [], createdBy: 'MD', createdAt: ts, updatedAt: ts,
  };
  const batchDone: BrandOrderBatch = {
    id: DEMO.brandBatchDone, workspace: 'LUMEN', projectNo: DEMO.projectLumen,
    title: '6월 4주차 완료발주', weekLabel: 'W26', status: 'approved',
    approvalStep: 3, expectedDely: '2026-08-01', lines: [], createdBy: 'MD', createdAt: ts, updatedAt: ts,
  };
  const line: BrandOrderLine = {
    id: DEMO.brandLine, batchId: DEMO.brandBatch, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
    colorQtys: [{ color: 'SB', qty: 300 }], factoryId: DEMO.vendorFactory, factoryName: '창성가죽',
    productionOrigin: 'china', isEmployeePurchase: false, qty: 300,
  };
  const lineDone: BrandOrderLine = {
    id: DEMO.brandLineDone, batchId: DEMO.brandBatchDone, styleNo: 'LLL6F92SB', styleName: '리나 숄더백',
    colorQtys: [{ color: 'SB', qty: 150 }], factoryId: DEMO.vendorFactory, factoryName: '창성가죽',
    productionOrigin: 'china', isEmployeePurchase: true, qty: 150,
  };
  localStorage.setItem('ames_brand_order_batches', JSON.stringify(
    [batch, batchDone].reduce((acc, b) => upsertById(acc, b), JSON.parse(localStorage.getItem('ames_brand_order_batches') || '[]')),
  ));
  localStorage.setItem('ames_brand_order_lines', JSON.stringify(
    [line, lineDone].reduce((acc, l) => upsertById(acc, l), JSON.parse(localStorage.getItem('ames_brand_order_lines') || '[]')),
  ));
  const approvalLogs = [
    { id: 'demo-appr-1', batchId: DEMO.brandBatch, step: 1, action: 'submit' as const, actorName: 'MD', comment: '데모 발주 제출', createdAt: ts },
    { id: 'demo-appr-2', batchId: DEMO.brandBatch, step: 2, action: 'approve' as const, actorName: '생산팀', comment: '납기 9/1 확인', createdAt: ts },
    { id: 'demo-appr-3', batchId: DEMO.brandBatchDone, step: 3, action: 'approve' as const, actorName: '대표', comment: '승인 완료', createdAt: ts },
  ];
  localStorage.setItem('ames_approval_logs', JSON.stringify(
    approvalLogs.reduce((acc, a) => upsertById(acc, a), JSON.parse(localStorage.getItem('ames_approval_logs') || '[]')),
  ));
  summary.push('브랜드 발주 2건 (승인중·완료)');

  // ── 16. 운영캘린더 ──
  const campaigns: Campaign[] = [
    { id: 'demo-camp-1', workspace: 'LUMEN', title: 'Lumen with SUMMER', channel: '자사몰', startDate: '2026-07-01', endDate: '2026-07-13', status: 'active', discountRate: 10, pushSkus: ['LLL6F92SB'], owner: 'MD', tasks: [], createdAt: ts, updatedAt: ts },
    { id: 'demo-camp-2', workspace: 'LUMEN', title: '여름 시즌오프', channel: '자사몰', startDate: '2026-07-06', endDate: '2026-07-12', status: 'active', discountRate: 15, pushSkus: ['LLL6F92SB'], tasks: [], createdAt: ts, updatedAt: ts },
    { id: 'demo-camp-3', workspace: 'LUMEN', title: '백화점 VIP 프리뷰', channel: '백화점', startDate: '2026-08-01', endDate: '2026-08-14', status: 'planned', discountRate: 0, pushSkus: ['LLL6F92SB'], owner: '쇼룸', tasks: [], createdAt: ts, updatedAt: ts },
    { id: 'demo-camp-4', workspace: 'OEM', title: 'LLL 26SS 프리오더', channel: 'B2B', startDate: '2026-06-01', endDate: '2026-06-30', status: 'ended', discountRate: 0, pushSkus: ['OEM-26SS-001'], owner: '영업', tasks: [], createdAt: ts, updatedAt: ts },
  ];
  localStorage.setItem('ames_campaigns', JSON.stringify(
    campaigns.reduce((acc, c) => upsertById(acc, c), JSON.parse(localStorage.getItem('ames_campaigns') || '[]')),
  ));
  summary.push(`운영캘린더 ${campaigns.length}건`);

  // ── 17. 환율 설정 ──
  const settings = store.getSettings();
  store.setSettings({
    ...settings,
    usdKrw: settings.usdKrw || 1380,
    cnyKrw: settings.cnyKrw || 191,
    exchangeHistory: settings.exchangeHistory?.length ? settings.exchangeHistory : [
      { date: '2026-07-01', usdKrw: 1375, cnyKrw: 190 },
      { date: '2026-07-08', usdKrw: 1380, cnyKrw: 191 },
      { date: today(), usdKrw: 1382, cnyKrw: 191 },
    ],
  });

  // ── 18. LUMEN 패킹자재 (엑셀 단가) ──
  const pack = await seedLumenPackingData();
  summary.push(...pack.summary);
  errors.push(...pack.errors);

  const { fillMissingItemColorsForTest, ITEM_COLOR_FILL_FLAG } = await import('./fillItemColorsForTest');
  localStorage.removeItem(ITEM_COLOR_FILL_FLAG);
  const fill = fillMissingItemColorsForTest(true);
  summary.push(`테스트 컬러: 품목 ${fill.itemsUpdated} · 발주 ${fill.ordersUpdated}`);

  localStorage.removeItem('ames_demo_seed_v2');
  localStorage.removeItem('ames_demo_seed_v3');
  localStorage.setItem(DEMO_SEED_FLAG, ts);
  summary.push('── 전 탭: 마스터·BOM·샘플·발주·구매·정산·PACK패킹');

  return { ok: errors.length === 0, summary, errors };
}
