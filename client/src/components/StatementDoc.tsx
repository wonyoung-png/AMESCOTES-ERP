// 거래명세표 문서 — 화면(팝업)과 인쇄가 같은 것을 본다.
// 예전에는 팝업은 React, 인쇄는 별도 HTML 문자열이라 내용이 서로 달랐다.
import type { TradeStatement, TradeStatementLine, Vendor } from '@/lib/store';

export const SUPPLIER = {
  companyName: '(주)아메스코테스',
  bizRegNo: '343-88-01791',
  address: '서울특별시 성북구 보문로13나길 27(보문동7가)',
  ceo: '이원영',
  tel: '',
  bizType: '제조업',
  bizItem: '가방·피혁제품',
};

export function calcStatementTotals(lines: TradeStatementLine[] | undefined) {
  if (!lines || lines.length === 0) return { taxableSupply: 0, taxableVat: 0, exemptAmount: 0, grandTotal: 0, totalQty: 0 };
  const taxable = lines.filter(l => l.taxType === '과세');
  const exempt = lines.filter(l => l.taxType === '면세');
  const taxableSupply = taxable.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const taxableVat = taxable.reduce((s, l) => s + l.qty * l.unitPrice * l.taxRate, 0);
  const exemptAmount = exempt.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  return { taxableSupply, taxableVat, exemptAmount, grandTotal: taxableSupply + taxableVat + exemptAmount, totalQty };
}

/** 금액을 한글로 — 세금계산서·명세표에 관행적으로 들어간다 (위·변조 방지) */
export function krwInWords(n: number): string {
  if (!n || n <= 0) return '영';
  const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const SMALL = ['', '십', '백', '천'];
  const BIG = ['', '만', '억', '조'];
  let out = '';
  const s = String(Math.round(n));
  const groups: string[] = [];
  for (let i = s.length; i > 0; i -= 4) groups.push(s.slice(Math.max(0, i - 4), i));
  groups.forEach((g, gi) => {
    let part = '';
    const gs = g.split('').reverse();
    gs.forEach((ch, i) => {
      const d = Number(ch);
      if (!d) return;
      part = `${DIGIT[d]}${SMALL[i]}` + part;
    });
    if (part) out = part + BIG[gi] + out;
  });
  return out;
}

export function StatementDoc({ statement, vendor }: { statement: TradeStatement; vendor?: Vendor }) {
  const lines = statement.lines || [];
  const t = calcStatementTotals(lines);
  const buyer = {
    name: vendor?.companyName || vendor?.name || statement.vendorName || '-',
    bizRegNo: (vendor as any)?.bizRegNo || '-',
    ceo: (vendor as any)?.ceoName || (vendor as any)?.contactName || '-',
    address: (vendor as any)?.address || '-',
    tel: (vendor as any)?.phone || (vendor as any)?.contactPhone || '-',
    email: (vendor as any)?.email || (vendor as any)?.contactEmail || '-',
  };
  const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

  return (
    <div className="bg-white text-neutral-900 p-5 space-y-4 text-[13px]">
      <div className="text-center border-b-2 border-neutral-800 pb-2">
        <h1 className="text-xl font-bold tracking-[0.3em]">거 래 명 세 표</h1>
      </div>

      <div className="flex justify-between text-xs">
        <span>전표번호 <b className="font-mono">{statement.statementNo}</b></span>
        <span>발행일 <b>{statement.issueDate}</b></span>
      </div>

      {/* 공급자 · 공급받는자 — 인쇄본에만 있고 화면엔 없던 부분 */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { title: '공급자', v: { ...SUPPLIER, name: SUPPLIER.companyName, tel: SUPPLIER.tel || '-', email: '-' } },
          { title: '공급받는자', v: { ...buyer, bizType: '-', bizItem: '-' } },
        ].map(({ title, v }) => (
          <div key={title} className="border border-neutral-300">
            <div className="bg-neutral-100 px-2 py-1 text-[11px] font-semibold border-b border-neutral-300">{title}</div>
            <table className="w-full text-[11px]">
              <tbody>
                <tr><td className="bg-neutral-50 border-b border-neutral-200 px-2 py-1 w-20">상호</td><td className="border-b border-neutral-200 px-2 py-1 font-semibold">{(v as any).name}</td></tr>
                <tr><td className="bg-neutral-50 border-b border-neutral-200 px-2 py-1">사업자번호</td><td className="border-b border-neutral-200 px-2 py-1 font-mono">{(v as any).bizRegNo}</td></tr>
                <tr><td className="bg-neutral-50 border-b border-neutral-200 px-2 py-1">대표자</td><td className="border-b border-neutral-200 px-2 py-1">{(v as any).ceo}</td></tr>
                <tr><td className="bg-neutral-50 border-b border-neutral-200 px-2 py-1">주소</td><td className="border-b border-neutral-200 px-2 py-1">{(v as any).address}</td></tr>
                <tr><td className="bg-neutral-50 px-2 py-1">연락처</td><td className="px-2 py-1">{(v as any).tel}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 품목 — 부가세 열이 화면에 없던 것을 채웠다 */}
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-neutral-100">
            <th className="border border-neutral-300 px-2 py-1.5 w-8">No</th>
            <th className="border border-neutral-300 px-2 py-1.5 text-left">품목 / 내역</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-16 text-right">수량</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-24 text-right">단가</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-14">세율</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-28 text-right">공급가</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-24 text-right">부가세</th>
            <th className="border border-neutral-300 px-2 py-1.5 w-28 text-right">합계</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const supply = l.qty * l.unitPrice;
            const vat = Math.round(supply * l.taxRate);
            return (
              <tr key={i}>
                <td className="border border-neutral-300 px-2 py-1.5 text-center text-neutral-500">{i + 1}</td>
                <td className="border border-neutral-300 px-2 py-1.5" style={{ wordBreak: 'keep-all' }}>{l.description}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{l.qty.toLocaleString()}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{won(l.unitPrice)}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-center">{l.taxType}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{won(supply)}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{vat ? won(vat) : '-'}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums font-semibold">{won(supply + vat)}</td>
              </tr>
            );
          })}
          {/* 빈 줄 — 손으로 적어 넣을 자리 (인쇄본 관행) */}
          {Array.from({ length: Math.max(0, 4 - lines.length) }).map((_, i) => (
            <tr key={`blank-${i}`}>
              {Array.from({ length: 8 }).map((__, c) => <td key={c} className="border border-neutral-300 px-2 py-1.5">&nbsp;</td>)}
            </tr>
          ))}
          <tr className="bg-neutral-50 font-semibold">
            <td className="border border-neutral-300 px-2 py-1.5 text-right" colSpan={2}>합계</td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{t.totalQty.toLocaleString()}</td>
            <td className="border border-neutral-300 px-2 py-1.5"></td>
            <td className="border border-neutral-300 px-2 py-1.5"></td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{won(t.taxableSupply + t.exemptAmount)}</td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{won(t.taxableVat)}</td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{won(t.grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* 합계 한글 — 금액 위·변조 방지용 관행 */}
      <div className="border border-neutral-300">
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="text-[11px] text-neutral-500 shrink-0">합계금액</span>
          <span className="font-semibold">일금 {krwInWords(t.grandTotal)}원정</span>
          <span className="ml-auto text-base font-bold tabular-nums">{won(t.grandTotal)}</span>
        </div>
      </div>

      {statement.memo && (
        <div className="border border-neutral-300 px-3 py-2 text-[11.5px]">
          <span className="text-neutral-500 mr-2">비고</span>{statement.memo}
        </div>
      )}

      {/* 인수 확인란 — 실물 서류에 필요 */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="border border-neutral-300 px-3 py-3 text-[11px] flex items-end justify-between">
          <span className="text-neutral-500">공급자</span>
          <span className="text-neutral-400">(인)</span>
        </div>
        <div className="border border-neutral-300 px-3 py-3 text-[11px] flex items-end justify-between">
          <span className="text-neutral-500">인수자</span>
          <span className="text-neutral-400">(서명)</span>
        </div>
      </div>

      <p className="text-[10px] text-neutral-500 text-right">
        {SUPPLIER.companyName} · {SUPPLIER.bizRegNo} · {SUPPLIER.address}
      </p>
    </div>
  );
}
