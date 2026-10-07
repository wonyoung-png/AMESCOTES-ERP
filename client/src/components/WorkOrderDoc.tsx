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

export function WorkOrderDoc({ order, bom, item, vendors, note, onSign, inherited, onPatch }: {
  order: ProductionOrder;
  bom?: Bom | null;
  item?: Item;
  vendors?: Vendor[];
  note?: string;
  /** 서명 칸을 눌렀을 때 — 인쇄 미리보기에서는 넘기지 않는다 */
  onSign?: (slot: 'writer' | 'checker' | 'receiver') => void;
  /**
   * 같은 스타일의 지난 발주에 적혀 있던 실넘버·지퍼넘버.
   * 이 발주에 값이 없을 때만 쓴다 — 리오더에서 다시 적지 않게 하려는 것이다.
   * 복사해 두지 않는 이유: 지난 발주를 고쳐도 이미 나간 서류가 뒤늦게 바뀌면 안 된다.
   */
  inherited?: Record<string, { thread?: string; zipper?: string }>;
  /**
   * 손으로 적은 값을 저장한다. 안 넘기면 읽기 전용(인쇄 미리보기·이미지 캡처).
   *
   * 바꿀 값을 바로 주지 않고 "직전 발주를 받아서 만드는 함수"를 준다.
   * 실넘버를 적고 바로 옆 지퍼넘버로 넘어가면 두 저장이 같은 순간에 일어나는데,
   * 그때 둘 다 렌더 당시의 옛 값 위에 덮어써서 먼저 적은 것이 날아갔다.
   */
  onPatch?: (make: (prev: ProductionOrder) => Partial<ProductionOrder>) => void;
}) {
  const factory = order.vendorName || '';
  const colorBoms: any[] = ((bom as any)?.postColorBoms?.length ? (bom as any).postColorBoms : (bom as any)?.colorBoms) || [];
  const allLines: BomLine[] = colorBoms.flatMap((cb: any) => cb.lines || []);
  /**
   * 그 컬러의 BOM 줄. 컬러를 못 찾으면 첫 번째 컬러 하나로 떨어진다.
   *
   * 전에는 모든 컬러를 이어붙인 allLines 로 떨어졌다. 거기에 발주 수량을 곱하면 같은 자재가
   * 컬러 수만큼 부푼다 — 컬러가 '기본' 한 줄일 때 바로 이렇게 됐다
   * (CLAUDE.md: flatMap 전체 사용 금지). 표와 수량이 같은 줄을 봐야 하므로 한 함수로 쓴다.
   */
  const linesOf = (color: string): BomLine[] => {
    const hit = colorBoms.find((cb: any) => (cb.color || '').trim() === color.trim());
    return (hit?.lines || colorBoms[0]?.lines || allLines) as BomLine[];
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

  // 본사제공 자재 — 대표: "원부자재 소요량은 없어도된다. 다만 우리가 본사제공만 넣어서
  // 체크할수있으면 좋을듯". 공장이 받은 것에 손으로 체크하는 칸이다.
  //
  // 컬러별로 쌓아야 한다. 컬러를 다 합친 뒤 전체 수량을 곱하면 컬러 수만큼 부풀고,
  // 한 컬러에만 들어가는 자재(컬러마다 다른 로고 같은 것)는 아예 틀린 수가 나온다.
  const hqItems = colorQtys.reduce(
    (acc: Array<{ name: string; spec: string; unit: string; qty: number }>, cq) => {
      linesOf(cq.color).filter(l => l.isHqProvided).forEach(l => {
        const need = (l.netQty || 0) * (1 + (l.lossRate || 0)) * (cq.qty || 0);
        const hit = acc.find(a =>
          a.name === l.itemName && a.spec === (l.spec || '') && a.unit === (l.unit || ''));
        if (hit) hit.qty += need;
        else acc.push({ name: l.itemName, spec: l.spec || '', unit: l.unit || '', qty: need });
      });
      return acc;
    }, []);
  const half = Math.ceil(hqItems.length / 2);
  const hqCols = [hqItems.slice(0, half), hqItems.slice(half)];

  // 실·지퍼 넘버 — 이 발주에 적힌 것, 없으면 지난 발주에서 불러온 것
  const specOf = (color: string) => ({
    ...(inherited?.[color] || {}),
    ...(order.specNumbers?.[color] || {}),
  });
  const patchSpec = (color: string, k: 'thread' | 'zipper', v: string) => {
    if (!onPatch) return;
    onPatch(prev => ({
      specNumbers: {
        ...(prev.specNumbers || {}),
        // 지난 발주에서 불러온 값은 손을 댄 순간 이 발주에 박힌다
        [color]: { ...(inherited?.[color] || {}), ...(prev.specNumbers?.[color] || {}), [k]: v },
      },
    }));
  };
  const numCell = 'w-full text-center text-[10px] bg-transparent outline-none border-b border-dashed border-neutral-300 focus:border-primary';

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
              {/* 실·지퍼 넘버는 BOM 품명에서 끌어오지 않는다. 손으로 적고, 리오더는 그걸 불러온다 */}
              {(['thread', 'zipper'] as const).map(k => (
                <td key={k} className={`${cell} text-center text-[10px]`}>
                  {onPatch ? (
                    <input type="text" key={`${order.id}|${r.color}|${k}`}
                      className={numCell} defaultValue={specOf(r.color)[k] || ''}
                      placeholder="—"
                      onBlur={e => {
                        const v = e.target.value.trim();
                        if (v !== (specOf(r.color)[k] || '')) patchSpec(r.color, k, v);
                      }} />
                  ) : (specOf(r.color)[k] || '-')}
                </td>
              ))}
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

      {/* 주의사항 / 기존 오더에서 바뀐 점 — 대표: "별도로 주의사항이나 기존 오더에서
          변경사항 쓰면 좋을듯". 읽기 전용일 때 빈 칸은 숨긴다 (인쇄 공백 아끼기) */}
      {(onPatch || order.cautionNote || order.changeNote) && (
        <div className="grid grid-cols-2" style={{ border: '1px solid #9ca3af' }}>
          {([
            ['cautionNote', '주 의 사 항', 'text-red-600'],
            ['changeNote', '기존 오더에서 변경된 점', 'text-blue-700'],
          ] as const).map(([k, label, color], i) => (
            <div key={k} className={i === 0 ? 'border-r border-neutral-400' : ''}>
              <div className={`${head} border-0 border-b border-neutral-400`}>{label}</div>
              {onPatch ? (
                <textarea rows={2} key={`${order.id}|${k}`} defaultValue={order[k] || ''}
                  className={`w-full px-2 py-1 text-[11px] font-semibold ${color} bg-transparent outline-none resize-none`}
                  placeholder="적을 것이 있으면 여기에"
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (order[k] || '')) onPatch(() => ({ [k]: v || undefined }));
                  }} />
              ) : (
                <div className={`px-2 py-1 text-[11px] font-semibold ${color} whitespace-pre-wrap min-h-[2.6em]`}
                  style={{ wordBreak: 'keep-all' }}>{order[k] || ''}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 하단 — 제품 이미지(크게) + 본사제공 체크리스트 */}
      <div className="grid" style={{ gridTemplateColumns: '260px 1fr', border: '1px solid #9ca3af' }}>
        <div className="border-r border-neutral-400 p-2 flex flex-col gap-2 items-center justify-center">
          {images.length > 0 ? images.map((src, i) => (
            <img key={i} src={src} alt={`제품 ${i + 1}`}
              style={{ width: '100%', height: 230, objectFit: 'contain' }} />
          )) : <span className="text-neutral-400 text-[11px] py-16">제품 이미지 없음</span>}
        </div>
        <div className="p-2">
          <div className="text-center font-semibold text-[11px] border-b border-neutral-300 pb-1 mb-1">
            본사제공 자재 — 받은 것에 체크
          </div>
          {hqItems.length === 0 ? (
            <p className="text-center text-neutral-400 text-[11px] py-8">본사제공 자재 없음</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {hqCols.map((col, ci) => (
                <table key={ci} className="w-full border-collapse text-[10.5px]">
                  <thead>
                    <tr>
                      <th className={`${head} w-7`}>✓</th>
                      <th className={`${head} text-left`}>품명</th>
                      <th className={`${head} w-16`}>수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {col.map((m, i) => (
                      <tr key={i}>
                        {/* 공장이 받은 것에 손으로 체크한다. 인쇄하면 빈 네모가 된다 */}
                        <td className={`${cell} text-center`}>
                          <span className="inline-block w-3 h-3 border border-neutral-500" />
                        </td>
                        <td className={cell} style={{ wordBreak: 'keep-all' }}>
                          {m.name}{m.spec ? ` ${m.spec}` : ''}
                        </td>
                        <td className={`${cell} text-right tabular-nums`}>
                          {m.qty ? `${Math.ceil(m.qty).toLocaleString()}${m.unit ? ` ${m.unit}` : ''}` : '-'}
                        </td>
                      </tr>
                    ))}
                    {col.length === 0 && <tr><td className={cell} colSpan={3}>&nbsp;</td></tr>}
                  </tbody>
                </table>
              ))}
            </div>
          )}
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
