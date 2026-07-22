// AMESCOTES ERP — 원가 계산 정본 (Single Source of Truth)
//
// ⚠️ 원가 계산식은 이 파일에만 존재합니다. 페이지에 복사하지 마세요.
//
// 예전에는 BomManagement / CostSheetPrint / ItemMaster / store 네 곳에
// calcPostSummary가 복붙돼 있었고, 그 사이에 이런 차이가 생겼습니다:
//   - 업체제공(isVendorProvided) 자재를 공장단가에서 빼는 곳이 없었음 (규칙 위반)
//   - PACK 키트 이중계상 방지는 ItemMaster에만 있었음
//   - 마진을 저장 시점에 곱하는지 표시 시점에 곱하는지가 파일마다 달라
//     원가비교 화면에서 마진이 두 번 곱해졌음 (16% 과다)
//
// ── CLAUDE.md 규칙 ──
//   공장단가 = 공장구매자재 + 임가공비 + 후가공비
//              (관세 / 본사제공 / 업체제공 은 제외)
//   견적서 금액은 10원 단위 올림

// ─────────────────────────────────────────────
// 기본 헬퍼
// ─────────────────────────────────────────────

/** 소요량 = NET × (1 + 로스율).  lossRate는 비율(0.05 = 5%) */
export const calcQty = (net: number, loss: number) => (net || 0) * (1 + (loss || 0));

/** 라인 금액 = 단가 × 소요량 */
export const calcLineAmt = (price: number, net: number, loss: number) =>
  (price || 0) * calcQty(net, loss);

/** 10원 단위 올림 (견적서 금액 규칙) */
export const ceil10 = (n: number) => Math.ceil(n / 10) * 10;

// ─────────────────────────────────────────────
// 사후원가 요약
// ─────────────────────────────────────────────

export interface PostSummary {
  // CNY(또는 해당 통화) 기준
  factoryMaterialCny: number;   // 공장구매 자재 (본사제공·업체제공 제외)
  hqMaterialCny: number;        // 본사제공 자재
  vendorMaterialCny: number;    // 업체(공장)제공 자재 — 원가에 포함하지 않음
  totalMaterialCny: number;     // 자재비 합계 (공장구매 + 본사제공)
  processingCny: number;        // 임가공비
  postProcessCny: number;       // 후가공비
  factoryUnitCostCny: number;   // 공장단가
  totalCostCny: number;         // 제품원가

  rate: number;                 // 적용 환율

  // KRW 기준
  factoryMaterialKrw: number;
  hqMaterialKrw: number;
  vendorMaterialKrw: number;
  totalMaterialKrw: number;
  processingKrw: number;
  postProcessKrw: number;
  customsRate: number;          // 관세율 (%)
  customsKrw: number;           // 관세금액
  logisticsKrw: number;         // 물류비
  packagingKrw: number;         // 포장/검사비
  packingKrw: number;           // 패킹재

  factoryUnitCostKrw: number;   // 공장단가 = 공장구매자재 + 임가공 + 후가공
  productCostKrw: number;       // 제품원가 = 공장단가 + 본사제공 + 관세 + 물류 + 포장 + 패킹 (마진 제외)
  marginRate: number;           // 생산마진율 (비율)
  finalCostKrw: number;         // 총원가액 = 제품원가 × (1 + 마진)  ← 저장·표시 기준

  isPackKit: boolean;           // PACK 키트 여부 (물류/포장/패킹 가산 제외)

  /** @deprecated productCostKrw를 쓰세요. 마진 포함 여부 혼동으로 버그를 만든 이름입니다. */
  totalCostKrw: number;
}

interface CostLineLike {
  unitPriceCny?: number;
  unitPrice?: number;
  netQty?: number;
  lossRate?: number;
  isHqProvided?: boolean;
  isVendorProvided?: boolean;
  itemName?: string;
}

interface PostProcessLineLike {
  netQty?: number;
  unitPrice?: number;
  unitPriceCny?: number;
}

/** 라인 단가는 unitPriceCny가 정본, 구버전 데이터는 unitPrice로 폴백 */
function linePrice(l: CostLineLike | PostProcessLineLike): number {
  return (l as any).unitPriceCny ?? (l as any).unitPrice ?? 0;
}

/**
 * PACK 키트(포장재 세트) 판별.
 * PACK은 라인 합계가 곧 원가라서, 물류비/포장비/패킹재를 또 더하면 2배가 된다.
 */
export function isPackKitBom(bom: any): boolean {
  const sn = String(bom?.styleNo || '');
  return !!(
    bom?.isPackBom
    || bom?.isSimpleCost
    || bom?.erpCategory === 'PACK'
    || sn.startsWith('PACKAGE-')
    || sn.startsWith('BOX-')
  );
}

/** 적용 환율 결정 — 통화별. 0/빈값이 들어와도 기본값으로 폴백한다. */
export function resolveRate(bom: any, settingsUsdKrw = 1380, phase: 'post' | 'pre' = 'post'): number {
  const cur = bom?.currency || 'CNY';
  if (cur === 'KRW') return 1;
  if (cur === 'USD') return bom?.exchangeRateUsd || settingsUsdKrw || 1380;
  const phaseRate = phase === 'pre' ? bom?.preExchangeRateCny : bom?.postExchangeRateCny;
  // `||` 사용 — 사용자가 환율 칸을 비우면 0이 들어오는데,
  // `??`를 쓰면 0이 그대로 통과해 모든 원가가 ₩0이 된다.
  return phaseRate || bom?.exchangeRateCny || bom?.snapshotCnyKrw || 191;
}

/**
 * 사후원가 요약 계산 — 모든 화면·저장이 이 함수 하나를 씁니다.
 *
 * @param postColorBom 컬러별 사후 BOM. 넘기면 그 컬러 기준, 없으면 bom.postMaterials 기준.
 */
export function calcPostSummary(
  bom: any,
  settingsUsdKrw = 1380,
  postColorBom?: { lines?: CostLineLike[]; processingFee?: number; postProcessLines?: PostProcessLineLike[] },
): PostSummary {
  const materials: CostLineLike[] = (postColorBom ? postColorBom.lines : bom?.postMaterials) || [];
  const rate = resolveRate(bom, settingsUsdKrw, 'post');
  const marginRate = bom?.productionMarginRate ?? 0;

  // 공장구매 = 본사제공·업체제공 둘 다 제외 (CLAUDE.md 공장단가 규칙)
  let factoryMaterialCny = 0;
  let hqMaterialCny = 0;
  let vendorMaterialCny = 0;
  for (const l of materials) {
    const amt = calcLineAmt(linePrice(l), l.netQty || 0, l.lossRate || 0);
    if (l.isHqProvided) hqMaterialCny += amt;
    else if (l.isVendorProvided) vendorMaterialCny += amt;
    else factoryMaterialCny += amt;
  }
  const totalMaterialCny = factoryMaterialCny + hqMaterialCny;

  const processingCny = (postColorBom ? postColorBom.processingFee : bom?.postProcessingFee) ?? 0;
  const postProcLines: PostProcessLineLike[] =
    (postColorBom ? postColorBom.postProcessLines : bom?.postProcessLines) || [];
  const postProcessCny = postProcLines.reduce((s, l) => s + (l.netQty || 0) * linePrice(l), 0);

  const processingKrw = processingCny * rate;
  const customsRate = bom?.customsRate || 0;
  const customsKrw = processingKrw * (customsRate / 100); // 관세 = 임가공비 × 관세율

  const isPackKit = isPackKitBom(bom);
  // PACK 키트는 라인 합계가 곧 원가 — 부대비용을 또 더하면 2배가 된다
  const logisticsKrw = isPackKit ? 0 : (bom?.logisticsCostKrw || 0);
  const packagingKrw = isPackKit ? 0 : (bom?.packagingCostKrw || 0);
  const packingKrw = isPackKit ? 0 : (bom?.packingCostKrw || 0);

  // 공장단가 = 공장구매자재 + 임가공비 + 후가공비 (관세·본사제공·업체제공 제외)
  const factoryUnitCostKrw = factoryMaterialCny * rate + processingKrw + postProcessCny * rate;
  // 제품원가 = 공장단가 + 본사제공 + 관세 + 물류 + 포장 + 패킹 (생산마진 제외)
  const productCostKrw =
    factoryUnitCostKrw + hqMaterialCny * rate + customsKrw + logisticsKrw + packagingKrw + packingKrw;
  // 총원가액 = 제품원가 × (1 + 생산마진)
  const finalCostKrw = marginRate > 0 ? productCostKrw * (1 + marginRate) : productCostKrw;

  const safeRate = rate || 1;
  return {
    factoryMaterialCny,
    hqMaterialCny,
    vendorMaterialCny,
    totalMaterialCny,
    processingCny,
    postProcessCny,
    factoryUnitCostCny: factoryUnitCostKrw / safeRate,
    totalCostCny: productCostKrw / safeRate,
    rate,
    factoryMaterialKrw: factoryMaterialCny * rate,
    hqMaterialKrw: hqMaterialCny * rate,
    vendorMaterialKrw: vendorMaterialCny * rate,
    totalMaterialKrw: totalMaterialCny * rate,
    processingKrw,
    postProcessKrw: postProcessCny * rate,
    customsRate,
    customsKrw,
    logisticsKrw,
    packagingKrw,
    packingKrw,
    factoryUnitCostKrw,
    productCostKrw,
    marginRate,
    finalCostKrw,
    isPackKit,
    totalCostKrw: productCostKrw,
  };
}

/**
 * 실현배수 = 판매가 ÷ 총원가액.
 * 원가가 0일 때 Infinity가 나와 "목표 달성"으로 오표시되던 버그가 있어 가드를 둔다.
 */
export function calcActualMultiple(salePrice: number, totalCostKrw: number): number {
  if (!(salePrice > 0) || !(totalCostKrw > 0)) return 0;
  return salePrice / totalCostKrw;
}
