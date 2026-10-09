export async function saveInboundOrders<T extends { id: string }>(
  orders: T[],
  save: (order: T) => Promise<unknown>,
  remove: (id: string) => Promise<unknown>,
) {
  const savedIds: string[] = [];
  try {
    for (const order of orders) {
      await save(order);
      savedIds.push(order.id);
    }
  } catch (error) {
    // shortcut: PostgREST 다건 트랜잭션 전까지 생성분을 되돌린다, 동시 쓰기가 생기면 DB RPC로 교체.
    const rollback = await Promise.allSettled(savedIds.map(remove));
    const failed = rollback.filter(result => result.status === 'rejected').length;
    if (failed) throw new Error(`생산발주 저장 실패 · 되돌리기 ${failed}건 실패`);
    throw error;
  }
}
