// AMESCOTES ERP — 발주번호 채번 정본 (Single Source of Truth)
//
// ⚠️ CLAUDE.md 레드라인: 발주번호 중복 생성 금지.
//
// 예전엔 두 곳이 서로 다른 저장소를 세고 있었다:
//   - ProductionOrders: Supabase orders의 orderNo 정규식
//   - ItemMaster: store.getNextRevision() = localStorage의 revision 필드
// 캐시가 빈 새 PC에서 품목마스터 일괄발주를 하면 localStorage가 0건이라
// revision=1이 나오고, 이미 Supabase에 있는 -R1과 충돌했다.
//
// 채번은 항상 "Supabase에서 조회한 발주 목록"을 근거로 한다.
// 동시 등록 경합까지 막으려면 DB UNIQUE 인덱스가 필요하다
// → supabase/migration_unique_keys.sql

import type { ProductionOrder } from './store';

const REVISION_RE = /-R(\d+)$/;

/** 발주번호에서 리비전 번호를 뽑는다. 형식이 아니면 0. */
export function parseRevision(orderNo: string | undefined | null): number {
  const m = (orderNo || '').match(REVISION_RE);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 다음 발주번호를 만든다. `{styleNo}-R{n}`
 *
 * @param orders Supabase에서 조회한 전체 발주 목록 (localStorage 아님)
 * @param taken  같은 트랜잭션에서 이미 발급한 번호들 (일괄발주 시 자기들끼리 충돌 방지)
 */
export function nextOrderNo(
  styleNo: string,
  orders: Array<Pick<ProductionOrder, 'styleNo' | 'orderNo'>>,
  taken?: Set<string>,
): string {
  const used = orders
    .filter(o => o.styleNo === styleNo)
    .map(o => parseRevision(o.orderNo));

  if (taken) {
    for (const t of Array.from(taken)) {
      if (t.startsWith(`${styleNo}-R`)) used.push(parseRevision(t));
    }
  }

  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  const orderNo = `${styleNo}-R${next}`;
  taken?.add(orderNo);
  return orderNo;
}
