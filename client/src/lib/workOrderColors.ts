import type { Bom, BomLine, ColorBom, ProductionOrder } from './store';

/** 장바구니와 같은 단계 선택: 사후 컬러 BOM이 있으면 그 안에서만 정확히 찾는다. */
export function workOrderColors(order: Pick<ProductionOrder, 'colorQtys' | 'qty'>, bom?: Bom | null) {
  const post = (bom as (Bom & { postColorBoms?: ColorBom[] }) | null | undefined)?.postColorBoms || [];
  const pre = bom?.colorBoms || [];
  const selected = post.length > 0 ? post : pre;
  const explicit = !!order.colorQtys?.length;
  const quantities = explicit ? order.colorQtys! : [{ color: '기본', qty: order.qty || 0 }];
  const legacyLines = (): BomLine[] => {
    if (bom?.postMaterials?.length) return bom.postMaterials;
    if (post[0]?.lines?.length) return post[0].lines;
    if (pre[0]?.lines?.length) return pre[0].lines;
    return bom?.lines || [];
  };
  const missingColors: string[] = [];
  const rows = quantities.map(cq => {
    const color = (cq.color || '').trim();
    const hit = explicit
      ? selected.find(cb => (cb?.color || '').trim() === color)
      : undefined;
    if (explicit && cq.qty > 0 && !hit) missingColors.push(cq.color);
    return { ...cq, lines: explicit ? hit?.lines || [] : legacyLines() };
  });
  return { rows, missingColors, ready: missingColors.length === 0 };
}
