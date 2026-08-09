// 공장 발주서 — 화면·인쇄·이미지가 모두 이 하나를 본다.
// 한국어/중국어 전환은 항목명만 바꾸고 숫자·번호는 그대로 둔다.
import type { ProductionOrder, Vendor, Item } from '@/lib/store';
import { SUPPLIER, krwInWords } from './StatementDoc';

export type DocLang = 'ko' | 'zh';

export const PO_T: Record<DocLang, Record<string, string>> = {
  ko: {
    title: '발 주 서', orderNo: '발주번호', orderDate: '발주일', delivery: '납기일',
    supplier: '발주자', buyer: '수주자 (공장)', company: '상호', bizNo: '사업자번호',
    ceo: '대표자', address: '주소', tel: '연락처', manager: '담당자',
    style: '스타일', styleName: '품명', color: '컬러', qty: '수량', unitPrice: '단가',
    supply: '공급가', vat: '부가세', amount: '금액', total: '합계', totalWords: '합계금액',
    memo: '비고', terms: '결제조건', place: '납품 장소', sign: '발주자', stamp: '(인)',
    confirm: '수주 확인', signature: '(서명)', no: 'No', pcs: 'PCS',
  },
  zh: {
    title: '采 购 订 单', orderNo: '订单编号', orderDate: '下单日期', delivery: '交期',
    supplier: '采购方', buyer: '供应方 (工厂)', company: '公司名称', bizNo: '营业执照号',
    ceo: '法人代表', address: '地址', tel: '联系方式', manager: '负责人',
    style: '款号', styleName: '品名', color: '颜色', qty: '数量', unitPrice: '单价',
    supply: '金额', vat: '税额', amount: '金额', total: '合计', totalWords: '合计金额',
    memo: '备注', terms: '付款条件', place: '交货地点', sign: '采购方', stamp: '(盖章)',
    confirm: '供应方确认', signature: '(签字)', no: '序号', pcs: '件',
  },
};

export function PurchaseOrderDoc({ orders, batchNo, vendors, items, lang = 'ko', terms, place }: {
  /** 한 장에 담을 발주들 — 단건이면 길이 1, 묶음이면 여러 건 */
  orders: ProductionOrder[];
  batchNo?: string;
  vendors: Vendor[];
  items?: Item[];
  lang?: DocLang;
  terms?: string;
  place?: string;
}) {
  const T = PO_T[lang];
  const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
  const first = orders[0];
  const vendorIds = Array.from(new Set(orders.map(o => o.vendorId || '')));
  const vendor = vendors.find(v => v.id === first?.vendorId);
  if (vendorIds.length > 1) {
    // 한 장에 여러 공장을 담으면 다른 공장의 스타일·단가가 엉뚱한 곳으로 나간다
    return (
      <div className="bg-white text-neutral-900 p-6 text-sm">
        <p className="font-semibold mb-1">공장이 {vendorIds.length}곳 섞여 있어 발주서를 만들 수 없습니다.</p>
        <p className="text-neutral-600 text-[12px]">발주 목록에서 공장별로 나눠 선택한 뒤 다시 출력하세요.</p>
      </div>
    );
  }
  const vendorName = (lang === 'zh' ? (vendor as any)?.nameCn : undefined) || vendor?.name || first?.vendorName || '-';

  const rows = orders.flatMap((o, oi) => {
    const unit = o.factoryUnitPriceKrw || 0;
    const colors = (o.colorQtys || []).length > 0 ? o.colorQtys! : [{ color: '-', qty: o.qty || 0 }];
    return colors.map((c, ci) => ({
      key: `${o.id}-${ci}`, idx: oi + 1, showOrder: ci === 0,
      orderNo: o.orderNo, styleNo: o.styleNo, styleName: o.styleName,
      color: c.color, qty: c.qty, unit, supply: c.qty * unit,
      delivery: o.deliveryDate || '',
    }));
  });
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalSupply = rows.reduce((s, r) => s + r.supply, 0);
  // 부가세는 국내 과세 거래에만. 해외공장·중문 서류엔 붙이지 않는다 (총액이 부풀던 문제)
  const isDomestic = vendor?.type === '공장' && ((vendor as any)?.country ?? '한국') === '한국';
  const vat = isDomestic && lang === 'ko' ? Math.round(totalSupply * 0.1) : 0;
  const dates = orders.map(o => o.deliveryDate).filter(Boolean).sort() as string[];

  const Party = ({ title, rows: pr }: { title: string; rows: Array<[string, string]> }) => (
    <div className="border border-neutral-300">
      <div className="bg-neutral-100 px-2 py-1 text-[11px] font-semibold border-b border-neutral-300">{title}</div>
      <table className="w-full text-[11px]">
        <tbody>
          {pr.map(([k, v], i) => (
            <tr key={k}>
              <td className={`bg-neutral-50 px-2 py-1 w-24 ${i < pr.length - 1 ? 'border-b border-neutral-200' : ''}`}>{k}</td>
              <td className={`px-2 py-1 ${i < pr.length - 1 ? 'border-b border-neutral-200' : ''}`}>{v || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="bg-white text-neutral-900 p-5 space-y-4 text-[13px]">
      <div className="text-center border-b-2 border-neutral-800 pb-2">
        <h1 className="text-xl font-bold tracking-[0.3em]">{T.title}</h1>
      </div>

      <div className="flex justify-between text-xs">
        <span>{T.orderNo} <b className="font-mono">{batchNo || first?.orderNo}</b></span>
        <span>
          {T.orderDate} <b>{first?.orderDate || '-'}</b>
          <span className="ml-3">{T.delivery} <b>{dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`) : '-'}</b></span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Party title={T.supplier} rows={[
          [T.company, SUPPLIER.companyName], [T.bizNo, SUPPLIER.bizRegNo],
          [T.ceo, SUPPLIER.ceo], [T.address, SUPPLIER.address],
        ]} />
        <Party title={T.buyer} rows={[
          [T.company, vendorName], [T.bizNo, (vendor as any)?.bizRegNo || '-'],
          [T.manager, (vendor as any)?.contactName || '-'],
          [T.tel, (vendor as any)?.phone || (vendor as any)?.contactPhone || '-'],
        ]} />
      </div>

      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-neutral-100">
            <th className="border border-neutral-300 px-2 py-1.5 w-8">{T.no}</th>
            <th className="border border-neutral-300 px-2 py-1.5 text-left">{T.style}</th>
            <th className="border border-neutral-300 px-2 py-1.5 text-left">{T.styleName}</th>
            <th className="border border-neutral-300 px-2 py-1.5 text-left">{T.color}</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-20 text-right">{T.qty}</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-24 text-right">{T.unitPrice}</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-28 text-right">{T.supply}</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-24">{T.delivery}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td className="border border-neutral-300 px-2 py-1.5 text-center text-neutral-500">{r.showOrder ? r.idx : ''}</td>
              <td className="border border-neutral-300 px-2 py-1.5 font-mono whitespace-nowrap">{r.showOrder ? r.styleNo : ''}</td>
              <td className="border border-neutral-300 px-2 py-1.5" style={{ wordBreak: 'keep-all' }}>{r.showOrder ? r.styleName : ''}</td>
              <td className="border border-neutral-300 px-2 py-1.5" style={{ wordBreak: 'keep-all' }}>{r.color}</td>
              <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{r.qty.toLocaleString()}</td>
              <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{r.unit ? won(r.unit) : '-'}</td>
              <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{r.unit ? won(r.supply) : '-'}</td>
              <td className="border border-neutral-300 px-2 py-1.5 text-center whitespace-nowrap">{r.showOrder ? (r.delivery || '-') : ''}</td>
            </tr>
          ))}
          <tr className="bg-neutral-50 font-semibold">
            <td className="border border-neutral-300 px-2 py-1.5 text-right" colSpan={4}>{T.total}</td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{totalQty.toLocaleString()} {T.pcs}</td>
            <td className="border border-neutral-300 px-2 py-1.5"></td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{totalSupply ? won(totalSupply) : '-'}</td>
            <td className="border border-neutral-300 px-2 py-1.5"></td>
          </tr>
        </tbody>
      </table>

      {totalSupply > 0 && (
        <div className="border border-neutral-300">
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="text-[11px] text-neutral-500 shrink-0">{T.totalWords}</span>
            {lang === 'ko'
              ? <span className="font-semibold">
                  일금 {krwInWords(totalSupply + vat)}원정
                  <span className="ml-2 text-[11px] font-normal text-neutral-500">{vat > 0 ? '(부가세 포함)' : '(부가세 별도 없음)'}</span>
                </span>
              : <span className="font-semibold text-[11px] text-neutral-500">不含税</span>}
            <span className="ml-auto text-base font-bold tabular-nums">{won(totalSupply + vat)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-[11.5px]">
        <div className="border border-neutral-300 px-3 py-2">
          <span className="text-neutral-500 mr-2">{T.terms}</span>{terms || (vendor as any)?.ttCondition || '-'}
        </div>
        <div className="border border-neutral-300 px-3 py-2">
          <span className="text-neutral-500 mr-2">{T.place}</span>{place || SUPPLIER.address}
        </div>
      </div>

      {first?.memo && (
        <div className="border border-neutral-300 px-3 py-2 text-[11.5px]">
          <span className="text-neutral-500 mr-2">{T.memo}</span>{first.memo}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="border border-neutral-300 px-3 py-3 text-[11px] flex items-end justify-between">
          <span className="text-neutral-500">{T.sign} {SUPPLIER.companyName}</span>
          <span className="text-neutral-400">{T.stamp}</span>
        </div>
        <div className="border border-neutral-300 px-3 py-3 text-[11px] flex items-end justify-between">
          <span className="text-neutral-500">{T.confirm} {vendorName}</span>
          <span className="text-neutral-400">{T.signature}</span>
        </div>
      </div>

      <p className="text-[10px] text-neutral-500 text-right">
        {SUPPLIER.companyName} · {SUPPLIER.bizRegNo} · {SUPPLIER.address}
      </p>
    </div>
  );
}
