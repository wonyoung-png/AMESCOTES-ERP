// 작업지시서 — 수기로 쓰던 엑셀 양식을 그대로 옮기고 BOM에서 값을 끌어온다.
// 컬러 한 줄 = 메인자재 / 우라 / 장식 / 불박로고 / 기리매 / 실 / 지퍼 / 발주수량 / 출고지
import type { ProductionOrder, Bom, BomLine, Item, Vendor } from '@/lib/store';
import { SignatureSlot } from './SignaturePad';

type ColorRow = {
  color: string;
  qty: number;
  main?: BomLine;      // 바디 가죽
  lining?: BomLine;    // 우라(안감)
  deco?: BomLine;      // 장식
  logo?: BomLine;      // 불박 로고
  edge?: BomLine;      // 기리매
  thread?: BomLine;    // 실
  zipper?: BomLine;    // 지퍼
};

/** 라인에서 "발주처"를 사람이 읽는 말로 — 본사제공이면 우리가, 아니면 공장이 산다 */
function orderedBy(l?: BomLine, factory?: string) {
  if (!l) return '';
  if (l.isHqProvided) return `${l.vendorName || '본사'} (본사발주)`;
  return `${l.vendorName || factory || '공장'} (공장발주)`;
}

function pick(lines: BomLine[], test: (l: BomLine) => boolean) {
  return lines.find(test);
}

export function WorkOrderDoc({ order, bom, item, vendors, note, onSign }: {
  order: ProductionOrder;
  bom?: Bom | null;
  item?: Item;
  vendors?: Vendor[];
  note?: string;
  /** 서명 칸을 눌렀을 때 — 인쇄 미리보기에서는 넘기지 않는다 */
  onSign?: (slot: 'writer' | 'checker' | 'receiver') => void;
}) {
  const factory = order.vendorName || '';
  const colorBoms: any[] = ((bom as any)?.postColorBoms?.length ? (bom as any).postColorBoms : (bom as any)?.colorBoms) || [];
  const allLines: BomLine[] = colorBoms.flatMap((cb: any) => cb.lines || []);
  const linesOf = (color: string): BomLine[] => {
    const hit = colorBoms.find((cb: any) => (cb.color || '').trim() === color.trim());
    return (hit?.lines || allLines) as BomLine[];
  };

  const colorQtys = (order.colorQtys || []).length > 0
    ? order.colorQtys!
    : [{ color: '기본', qty: order.qty || 0 }];

  const rows: ColorRow[] = colorQtys.map(cq => {
    const ls = linesOf(cq.color);
    const raw = ls.filter(l => l.category === '원자재' || l.category === ('가죽' as any) || l.category === ('원단' as any));
    return {
      color: cq.color, qty: cq.qty,
      main: raw.find(l => l.subPart === '바디') || raw.find(l => l.subPart !== '안감') || raw[0],
      lining: raw.find(l => l.subPart === '안감'),
      deco: pick(ls, l => l.category === '장식'),
      logo: pick(ls, l => /불박|로고|logo/i.test(`${l.itemName} ${l.spec || ''}`)),
      edge: pick(ls, l => /기리매|엣지|edge/i.test(`${l.itemName} ${l.spec || ''}`)),
      thread: pick(ls, l => /실|세라필|thread/i.test(l.itemName)),
      zipper: pick(ls, l => l.category === '지퍼'),
    };
  });

  // 소요량 합계 — 수기 양식 상단의 "가죽 / 안감 소요량"
  const sum = (test: (l: BomLine) => boolean) =>
    rows.reduce((acc, r) => {
      const ls = linesOf(r.color).filter(test);
      return acc + ls.reduce((s, l) => s + (l.netQty || 0) * (1 + (l.lossRate || 0)), 0);
    }, 0) / Math.max(1, rows.length);

  const leather = allLines.find(l => l.subPart === '바디');
  const lining = allLines.find(l => l.subPart === '안감');
  const leatherQty = sum(l => l.subPart === '바디');
  const liningQty = sum(l => l.subPart === '안감');

  // 원부자재 소요량 — PCS별 + 전체
  const totalQty = colorQtys.reduce((s, c) => s + (c.qty || 0), 0);
  const subMaterials = allLines
    .filter(l => ['장식', '지퍼', '보강재', '봉사·접착제', '포장재', '철형'].includes(l.category as string))
    .reduce((acc: Array<{ name: string; vendor: string; per: number }>, l) => {
      const per = (l.netQty || 0) * (1 + (l.lossRate || 0));
      const key = `${l.itemName}|${l.spec || ''}`;
      const hit = acc.find(a => `${a.name}` === key);
      if (hit) hit.per += per;
      else acc.push({ name: key, vendor: l.vendorName || (l.isHqProvided ? '본사' : factory), per });
      return acc;
    }, []);
  const half = Math.ceil(subMaterials.length / 2);
  const subCols = [subMaterials.slice(0, half), subMaterials.slice(half)];

  const images = [item?.imageUrl, ...(item as any)?.imageUrls || []].filter(Boolean).slice(0, 2) as string[];
  const cell = 'border border-neutral-400 px-2 py-1.5 align-middle';
  const head = `${cell} bg-neutral-100 text-center font-semibold text-[11px]`;
  const two = (a?: string, b?: string) => (
    <>
      <div className="font-semibold">{a || '-'}</div>
      {b && <div className="text-[10px] text-blue-700">{b}</div>}
    </>
  );

  return (
    <div className="bg-white text-neutral-900 p-4 space-y-2 text-[12px]">
      <div className="border border-neutral-400 bg-neutral-100 text-center py-2">
        <h1 className="text-lg font-bold tracking-[0.4em]">작 업 지 시 서</h1>
      </div>

      {/* 상단 — 발주일 / 납기 / 스타일 / 작업장 */}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className={`${head} w-28`}>발 주 일 자</td>
            <td className={`${cell} text-center font-semibold`}>{order.orderDate || '-'}</td>
            <td className={`${head} w-24`}>납 기 일</td>
            <td className={`${cell} text-center font-bold text-red-600`}>
              {order.confirmedDate || order.deliveryDate || '미정'}
              {order.shipTo ? ` ${order.shipTo} 도착` : ''}
            </td>
          </tr>
          <tr>
            <td className={head}>스타일넘버(품명)</td>
            <td className={`${cell} text-center font-semibold`}>
              {order.styleNo} / {order.styleName}{order.revision && order.revision > 1 ? ` / ${order.revision}차` : ''}
            </td>
            <td className={head}>작 업 장</td>
            <td className={`${cell} text-center font-semibold`}>{factory || '-'}</td>
          </tr>
          <tr>
            <td className={head}>{leather?.itemName ? '가죽 소요량' : '주자재 소요량'}</td>
            <td className={`${cell} text-center font-semibold`}>
              {leatherQty ? `${leatherQty.toFixed(2)} ${leather?.unit || 'S/F'}` : '-'}
            </td>
            <td className={head}>안감 소요량</td>
            <td className={`${cell} text-center font-semibold`}>
              {liningQty ? `${liningQty.toFixed(2)} ${lining?.unit || 'YD'}` : '-'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 본표 — 컬러별 */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${head} w-[19%]`}>메인자재</th>
            <th className={`${head} w-[11%]`}>우라(안감)</th>
            <th className={`${head} w-[10%]`}>장식</th>
            <th className={`${head} w-[13%]`}>불박로고</th>
            <th className={`${head} w-[12%]`}>기리매</th>
            <th className={`${head} w-[9%]`}>실 넘버</th>
            <th className={`${head} w-[9%]`}>지퍼넘버</th>
            <th className={`${head} w-[8%]`}>발주수량</th>
            <th className={`${head} w-[9%]`}>출고지</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={cell} style={{ wordBreak: 'keep-all' }}>
                <div className="font-semibold">{r.color}</div>
                <div className="text-[10px]">{r.main?.itemName || '-'}{r.main?.spec ? ` / ${r.main.spec}` : ''}</div>
                <div className="text-[10px] text-blue-700">{orderedBy(r.main, factory)}</div>
              </td>
              <td className={`${cell} text-center`}>{two(r.lining?.itemName, orderedBy(r.lining, factory))}</td>
              <td className={`${cell} text-center`}>{two(r.deco?.itemName, orderedBy(r.deco, factory))}</td>
              <td className={`${cell} text-center text-[10px]`} style={{ wordBreak: 'keep-all' }}>
                {r.logo ? `${r.logo.itemName}${r.logo.spec ? ` / ${r.logo.spec}` : ''}` : '-'}
              </td>
              <td className={`${cell} text-center text-[10px]`}>{r.edge ? `${r.edge.itemName}${r.edge.spec ? ` / ${r.edge.spec}` : ''}` : '-'}</td>
              <td className={`${cell} text-center text-[10px]`}>{r.thread ? `${r.thread.itemName}${r.thread.spec ? ` ${r.thread.spec}` : ''}` : '-'}</td>
              <td className={`${cell} text-center text-[10px]`}>{r.zipper ? `${r.zipper.itemName}${r.zipper.spec ? ` ${r.zipper.spec}` : ''}` : '-'}</td>
              <td className={`${cell} text-center font-semibold tabular-nums`}>{r.qty.toLocaleString()}</td>
              <td className={`${cell} text-center text-[10px]`}>{order.shipTo || '-'}</td>
            </tr>
          ))}
          {/* 손으로 적을 여유 줄 */}
          {Array.from({ length: Math.max(0, 3 - rows.length) }).map((_, i) => (
            <tr key={`b${i}`}>{Array.from({ length: 9 }).map((__, c) => <td key={c} className={cell}>&nbsp;</td>)}</tr>
          ))}
        </tbody>
      </table>

      {note && (
        <div className="border border-neutral-400 px-3 py-2 text-center font-semibold text-red-600" style={{ wordBreak: 'keep-all' }}>
          {note}
        </div>
      )}

      {/* 하단 — 제품 이미지(크게) + 원부자재 소요량 */}
      <div className="grid" style={{ gridTemplateColumns: '260px 1fr', border: '1px solid #9ca3af' }}>
        <div className="border-r border-neutral-400 p-2 flex flex-col gap-2 items-center justify-center">
          {images.length > 0 ? images.map((src, i) => (
            <img key={i} src={src} alt={`제품 ${i + 1}`}
              style={{ width: '100%', height: 230, objectFit: 'contain' }} />
          )) : <span className="text-neutral-400 text-[11px] py-16">제품 이미지 없음</span>}
        </div>
        <div className="p-2">
          <div className="text-center font-semibold text-[11px] border-b border-neutral-300 pb-1 mb-1">원부자재 소요량</div>
          <div className="grid grid-cols-2 gap-2">
            {subCols.map((col, ci) => (
              <table key={ci} className="w-full border-collapse text-[10.5px]">
                <thead>
                  <tr>
                    <th className={`${head} text-left`}>품명</th>
                    <th className={`${head} w-20`}>공장</th>
                    <th className={`${head} w-16`}>PCS별</th>
                    <th className={`${head} w-16`}>전체</th>
                  </tr>
                </thead>
                <tbody>
                  {col.map((m, i) => (
                    <tr key={i}>
                      <td className={cell} style={{ wordBreak: 'keep-all' }}>{m.name.split('|')[0]}{m.name.split('|')[1] ? ` ${m.name.split('|')[1]}` : ''}</td>
                      <td className={`${cell} text-center text-[10px]`}>{m.vendor || '-'}</td>
                      <td className={`${cell} text-right tabular-nums`}>{m.per ? m.per.toFixed(m.per % 1 ? 2 : 0) : '-'}</td>
                      <td className={`${cell} text-right tabular-nums`}>{m.per ? Math.ceil(m.per * totalQty).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                  {col.length === 0 && <tr><td className={cell} colSpan={4}>&nbsp;</td></tr>}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([['writer', '작성'], ['checker', '확인'], ['receiver', '수령']] as const).map(([slot, label]) => (
          <SignatureSlot key={slot} label={label}
            sign={order.signatures?.[slot]}
            onClick={onSign ? () => onSign(slot) : undefined} />
        ))}
      </div>
    </div>
  );
}
