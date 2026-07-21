import { Input } from '@/components/ui/input';
import {
  SALES_PRICE_LABELS,
  DEFAULT_GLOBAL_MARKUP,
  calcSalesPricing,
  wholesaleFromGlobal,
  discountFromWholesale,
  type SalesPnlFields,
} from '@/lib/salesPricing';

const fmtKrw = (n: number) =>
  n === 0 ? '—' : `₩${Math.round(n).toLocaleString()}`;

type Props = {
  costKrw: number;
  pnl: SalesPnlFields;
  onPatch: (patch: Partial<SalesPnlFields>) => void;
};

/** 세일즈 가격 확정 · 배수 분석 (KMSRP / Global MSRP / Wholesale) */
export function SalesPricingPanel({ costKrw, pnl, onPatch }: Props) {
  const sp = calcSalesPricing(costKrw, pnl);
  const kmsrp = pnl.confirmedSalePrice || 0;
  const discountPct = Math.round((pnl.wholesaleDiscountRate ?? sp.wholesaleDiscountRate) * 1000) / 10;

  return (
    <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-stone-600">세일즈 가격 확정</h3>
        <p className="text-[10px] text-stone-400 mt-0.5">
          Markup = 배수 · 원가 기준 {costKrw > 0 ? fmtKrw(costKrw) : '—'}
        </p>
      </div>

      {/* KMSRP */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-stone-700 block">
          {SALES_PRICE_LABELS.kmsrpFull}
        </label>
        <p className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.kmsrpHint}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            type="number"
            value={kmsrp || ''}
            onChange={e => {
              const v = e.target.value ? Number(e.target.value) : undefined;
              const patch: Partial<SalesPnlFields> = { confirmedSalePrice: v };
              if (v && v > 0 && !(pnl.globalSalePrice && pnl.globalSalePrice > 0)) {
                const m = pnl.globalMarkup && pnl.globalMarkup > 0 ? pnl.globalMarkup : DEFAULT_GLOBAL_MARKUP;
                patch.globalSalePrice = Math.round(v * m);
              }
              onPatch(patch);
            }}
            className="h-8 text-sm border-stone-300 text-right w-40 font-semibold"
            placeholder="KMSRP"
          />
          {sp.markup1 > 0 && (
            <span className="text-xs text-stone-500">
              {SALES_PRICE_LABELS.markup1}:{' '}
              <span className={`font-bold ${sp.markup1 >= 3.5 ? 'text-green-600' : 'text-red-500'}`}>
                {sp.markup1.toFixed(2)}배
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Global MSRP */}
      <div className="space-y-1.5 border-t border-stone-200 pt-3">
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <label className="text-xs font-semibold text-stone-700 block">
              {SALES_PRICE_LABELS.globalMsrpFull}
            </label>
            <p className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.markup2Hint}</p>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-stone-500">{SALES_PRICE_LABELS.markup2}</span>
            <Input
              type="number"
              step="0.01"
              value={pnl.globalMarkup ?? DEFAULT_GLOBAL_MARKUP}
              onChange={e => {
                const m = Number(e.target.value) || DEFAULT_GLOBAL_MARKUP;
                const patch: Partial<SalesPnlFields> = { globalMarkup: m };
                if (kmsrp > 0) {
                  const g = Math.round(kmsrp * m);
                  patch.globalSalePrice = g;
                  if (pnl.wholesaleDiscountRate != null && pnl.wholesaleDiscountRate >= 0) {
                    patch.wholesalePrice = wholesaleFromGlobal(g, pnl.wholesaleDiscountRate);
                  }
                }
                onPatch(patch);
              }}
              className="h-7 text-xs border-stone-200 text-right w-16"
            />
            <span className="text-[10px] text-stone-400">배</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            type="number"
            value={pnl.globalSalePrice ?? (sp.suggestedGlobal || '')}
            onChange={e => {
              const g = e.target.value ? Number(e.target.value) : undefined;
              const patch: Partial<SalesPnlFields> = { globalSalePrice: g };
              if (g && g > 0 && pnl.wholesaleDiscountRate != null && pnl.wholesaleDiscountRate >= 0) {
                patch.wholesalePrice = wholesaleFromGlobal(g, pnl.wholesaleDiscountRate);
              }
              onPatch(patch);
            }}
            className="h-8 text-sm border-stone-300 text-right w-40 font-semibold"
            placeholder="Global MSRP"
          />
          {sp.markup2 > 0 && (
            <span className="text-xs text-stone-500">
              실현 {SALES_PRICE_LABELS.markup2}:{' '}
              <span className="font-bold text-stone-800">{sp.markup2.toFixed(2)}배</span>
            </span>
          )}
        </div>
      </div>

      {/* Wholesale = Global × (1 − 할인율) */}
      <div className="space-y-1.5 border-t border-stone-200 pt-3">
        <label className="text-xs font-semibold text-stone-700 block">
          {SALES_PRICE_LABELS.wholesaleFull}
        </label>
        <p className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.wholesaleDiscountHint}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-stone-500">{SALES_PRICE_LABELS.wholesaleDiscount}</span>
            <Input
              type="number"
              step="0.1"
              value={pnl.wholesaleDiscountRate != null || sp.wholesalePrice > 0 ? discountPct : ''}
              onChange={e => {
                const pct = e.target.value === '' ? undefined : Number(e.target.value);
                if (pct == null || Number.isNaN(pct)) {
                  onPatch({ wholesaleDiscountRate: undefined, wholesalePrice: undefined });
                  return;
                }
                const rate = Math.min(100, Math.max(0, pct)) / 100;
                const g = pnl.globalSalePrice && pnl.globalSalePrice > 0
                  ? pnl.globalSalePrice
                  : sp.globalSalePrice;
                onPatch({
                  wholesaleDiscountRate: rate,
                  wholesalePrice: g > 0 ? wholesaleFromGlobal(g, rate) : undefined,
                });
              }}
              className="h-8 text-sm border-stone-300 text-right w-20 font-semibold"
              placeholder="40"
            />
            <span className="text-xs text-stone-500">%</span>
          </div>
          <span className="text-stone-300">→</span>
          <Input
            type="number"
            value={sp.wholesalePrice || ''}
            onChange={e => {
              const w = e.target.value ? Number(e.target.value) : undefined;
              const g = pnl.globalSalePrice && pnl.globalSalePrice > 0
                ? pnl.globalSalePrice
                : sp.globalSalePrice;
              if (w == null || !w) {
                onPatch({ wholesalePrice: undefined, wholesaleDiscountRate: undefined });
                return;
              }
              onPatch({
                wholesalePrice: w,
                wholesaleDiscountRate: g > 0 ? discountFromWholesale(g, w) : undefined,
              });
            }}
            className="h-8 text-sm border-stone-300 text-right w-40 font-semibold"
            placeholder="홀세일가"
          />
          {sp.wholesaleDiscountRate > 0 && sp.globalSalePrice > 0 && (
            <span className="text-xs text-stone-500">
              {fmtKrw(sp.globalSalePrice)} × (1 − {(sp.wholesaleDiscountRate * 100).toFixed(0)}%)
            </span>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {kmsrp > 0 && (
        <div className="grid grid-cols-3 gap-2 border-t border-stone-200 pt-3 text-center">
          <div className="rounded bg-white border border-stone-200 px-2 py-2">
            <div className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.kmsrp}</div>
            <div className="text-xs font-bold text-stone-800 tabular-nums">{fmtKrw(kmsrp)}</div>
            {sp.markup1 > 0 && <div className="text-[10px] text-stone-500">{sp.markup1.toFixed(2)}배</div>}
          </div>
          <div className="rounded bg-white border border-stone-200 px-2 py-2">
            <div className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.globalMsrp}</div>
            <div className="text-xs font-bold text-stone-800 tabular-nums">{fmtKrw(sp.globalSalePrice)}</div>
            {sp.markup2 > 0 && <div className="text-[10px] text-stone-500">{sp.markup2.toFixed(2)}배</div>}
          </div>
          <div className="rounded bg-white border border-stone-200 px-2 py-2">
            <div className="text-[10px] text-stone-400">{SALES_PRICE_LABELS.wholesale}</div>
            <div className="text-xs font-bold text-stone-800 tabular-nums">{fmtKrw(sp.wholesalePrice)}</div>
            {sp.wholesaleDiscountRate > 0 && (
              <div className="text-[10px] text-stone-500">
                −{(sp.wholesaleDiscountRate * 100).toFixed(0)}%
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
