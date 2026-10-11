import type { ProductionOrder } from './store';

export interface ProductionOrderMetadataPatch {
  sentAt?: string;
  confirmedAt?: string;
  confirmedDate?: string;
  confirmNote?: string | null;
}
export interface ProductionOrderMetadataExpected {
  updatedAt: string;
  sentAt: string | null;
  confirmedAt: string | null;
}
export type UpdateProductionOrderMetadata = (
  id: string, patch: ProductionOrderMetadataPatch, expected: ProductionOrderMetadataExpected,
) => Promise<{ updatedAt: string; persistedUpdatedAt?: string }>;

export type ProductionOrderMetadataSnapshot = Pick<ProductionOrder, 'id' | 'updatedAt' | 'sentAt' | 'confirmedAt' | 'deliveryDate'> & {persistedUpdatedAt?: string};
function expected(order: ProductionOrderMetadataSnapshot): ProductionOrderMetadataExpected {
  const stamp = order.persistedUpdatedAt ?? order.updatedAt;
  if (!stamp) throw new Error('발주의 저장 버전이 없습니다. 새로고침 후 다시 기록해주세요.');
  return { updatedAt: stamp, sentAt: order.sentAt || null, confirmedAt: order.confirmedAt || null };
}
function savedVersion(result: { updatedAt: string }) {
  if (!result?.updatedAt) throw new Error('발주 저장 결과를 확인할 수 없습니다. 새로고침 후 확인해주세요.');
  return result.updatedAt;
}

/** Send ONLY delivery metadata, never a stale whole order or a refreshed replacement guard. */
export async function persistProductionOrderSent(
  order: ProductionOrderMetadataSnapshot, update: UpdateProductionOrderMetadata, at = new Date().toISOString(),
) {
  const result = await update(order.id, { sentAt: at }, expected(order));
  const stamp = savedVersion(result);
  return { sentAt: at, updatedAt: stamp, persistedUpdatedAt: result.persistedUpdatedAt ?? stamp };
}

export async function persistProductionOrderFactoryConfirm(
  order: ProductionOrderMetadataSnapshot, form: { confirmedDate: string; confirmNote: string },
  update: UpdateProductionOrderMetadata, at = new Date().toISOString(),
) {
  const guard = expected(order);
  const confirmedDate = form.confirmedDate || order.deliveryDate;
  const confirmNote = form.confirmNote || null;
  const result = await update(order.id, { confirmedAt: at, confirmedDate, confirmNote }, guard);
  const stamp = savedVersion(result);
  return { confirmedAt: at, confirmedDate, confirmNote: confirmNote || undefined, updatedAt: stamp, persistedUpdatedAt: result.persistedUpdatedAt ?? stamp };
}
