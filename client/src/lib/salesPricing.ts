/**
 * 세일즈 가격 공식 용어
 *
 * KMSRP (Korean MSRP) = 확정판매가 = confirmedSalePrice (동일 필드)
 * Markup = 배수 (비율 % 아님)
 * Wholesale = Global MSRP × (1 − 할인율)
 */

export const SALES_PRICE_LABELS = {
  kmsrp: 'KMSRP',
  kmsrpFull: 'KMSRP (확정판매가)',
  kmsrpHint: '국내 권장소비자가 · 확정판매가와 동일',
  markup1: 'Markup 1',
  markup1Hint: '원가 → KMSRP 배수',
  globalMsrp: 'Global MSRP',
  globalMsrpFull: 'Global MSRP (글로벌 판매가)',
  markup2: 'Markup 2',
  markup2Hint: 'KMSRP → Global MSRP 배수',
  wholesale: 'Wholesale',
  wholesaleFull: 'Wholesale (해외 홀세일가)',
  wholesaleDiscount: '할인율',
  wholesaleDiscountHint: 'Global MSRP 대비 할인 · Wholesale = Global × (1 − 할인율)',
} as const;

/** 스프레드시트 기본: KMSRP × 1.30 = Global MSRP */
export const DEFAULT_GLOBAL_MARKUP = 1.3;

export interface SalesPnlFields {
  confirmedSalePrice?: number;
  globalMarkup?: number;
  globalSalePrice?: number;
  /** Global MSRP 대비 홀세일 할인율 (0~1, 예: 0.4 = 40%) */
  wholesaleDiscountRate?: number;
  /** 확정 홀세일가 (할인율로 계산·동기) */
  wholesalePrice?: number;
}

export interface SalesPricingResult {
  kmsrp: number;
  markup1: number;
  globalMarkup: number;
  suggestedGlobal: number;
  globalSalePrice: number;
  markup2: number;
  wholesaleDiscountRate: number;
  wholesalePrice: number;
}

/** Wholesale = Global × (1 − 할인율) */
export function wholesaleFromGlobal(globalSalePrice: number, discountRate: number): number {
  if (globalSalePrice <= 0) return 0;
  const rate = Math.min(1, Math.max(0, discountRate));
  return Math.round(globalSalePrice * (1 - rate));
}

/** 할인율 = 1 − Wholesale / Global */
export function discountFromWholesale(globalSalePrice: number, wholesalePrice: number): number {
  if (globalSalePrice <= 0 || wholesalePrice < 0) return 0;
  return Math.min(1, Math.max(0, 1 - wholesalePrice / globalSalePrice));
}

export function calcSalesPricing(costKrw: number, pnl: SalesPnlFields): SalesPricingResult {
  const kmsrp = pnl.confirmedSalePrice || 0;
  const globalMarkup = pnl.globalMarkup && pnl.globalMarkup > 0
    ? pnl.globalMarkup
    : DEFAULT_GLOBAL_MARKUP;
  const suggestedGlobal = kmsrp > 0 ? Math.round(kmsrp * globalMarkup) : 0;
  const globalSalePrice = pnl.globalSalePrice && pnl.globalSalePrice > 0
    ? pnl.globalSalePrice
    : suggestedGlobal;

  let wholesaleDiscountRate = pnl.wholesaleDiscountRate;
  let wholesalePrice = pnl.wholesalePrice && pnl.wholesalePrice > 0 ? pnl.wholesalePrice : 0;

  if (wholesaleDiscountRate != null && wholesaleDiscountRate >= 0 && globalSalePrice > 0) {
    wholesalePrice = wholesaleFromGlobal(globalSalePrice, wholesaleDiscountRate);
  } else if (wholesalePrice > 0 && globalSalePrice > 0) {
    wholesaleDiscountRate = discountFromWholesale(globalSalePrice, wholesalePrice);
  } else {
    wholesaleDiscountRate = wholesaleDiscountRate ?? 0;
  }

  return {
    kmsrp,
    markup1: costKrw > 0 && kmsrp > 0 ? kmsrp / costKrw : 0,
    globalMarkup,
    suggestedGlobal,
    globalSalePrice,
    markup2: kmsrp > 0 && globalSalePrice > 0 ? globalSalePrice / kmsrp : 0,
    wholesaleDiscountRate: wholesaleDiscountRate || 0,
    wholesalePrice,
  };
}
