import type { Bom, ProductionOrder } from './store';
import { getBomForOrderFromList } from './bomLookup';
import { workOrderColors } from './workOrderColors';

// 키 순서·행 ID만 다른 복사본은 같게, 문서 자재의 값과 순서는 그대로 비교한다.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, v]) => key !== 'id' && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  }
  return value;
}

/** 작업지시서 전용: 본사·공장 자재 전체를 비교하고 선택 오류를 밖으로 던지지 않는다. */
export function pickWorkOrderBom(
  boms: Bom[],
  order: Pick<ProductionOrder, 'styleNo' | 'styleId' | 'bomId' | 'colorQtys' | 'qty'>,
): { bom: Bom | null; ambiguous: boolean; error?: string } {
  try {
    if (order.bomId) {
      const pinned = (boms || []).find(b => b.id === order.bomId);
      if (!pinned) return { bom: null, ambiguous: false, error: '발주에 지정된 BOM이 없습니다. 해당 발주의 BOM 연결을 확인해주세요.' };
      const sameItem = order.styleId && pinned.styleId
        ? pinned.styleId === order.styleId : pinned.styleNo === order.styleNo;
      if (!sameItem || (!!order.styleNo && pinned.styleNo !== order.styleNo)) {
        return { bom: null, ambiguous: false, error: '발주에 지정된 BOM이 다른 품목입니다. 해당 발주의 BOM 연결을 확인해주세요.' };
      }
      return { bom: pinned, ambiguous: false };
    }
    const all = (boms || []).filter(b => b.styleNo === order.styleNo || (!!order.styleId && b.styleId === order.styleId));
    const mine = order.styleId ? all.filter(b => b.styleId === order.styleId) : [];
    const pool = mine.length > 0 ? mine : all;
    const bom = getBomForOrderFromList(pool, order.styleNo, order.styleId).bom;
    const signatures = pool.map(candidate => {
      const result = workOrderColors(order, candidate);
      return JSON.stringify(canonical({
        rows: result.rows.filter(row => row.qty > 0), missingColors: result.missingColors,
      }));
    });
    if (new Set(signatures).size > 1) {
      return { bom: null, ambiguous: true, error: '작업지시서 자재가 다른 BOM이 여러 개입니다. 해당 발주의 BOM을 확인해주세요.' };
    }
    // 컬러 누락은 선택 실패가 아니다. 선택된 BOM으로 문서·전송 검증이 함께 경고한다.
    return { bom, ambiguous: false };
  } catch {
    return { bom: null, ambiguous: false, error: '작업지시서 BOM을 확인할 수 없습니다. BOM/원가의 컬러·자재 구성을 확인해주세요.' };
  }
}
