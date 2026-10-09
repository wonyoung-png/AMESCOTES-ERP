export type InventoryLocation = 'domestic' | 'ez-overseas' | 'hannam' | 'centum' | 'china' | 'in-transit';
export interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  color: string;
  location: InventoryLocation;
  quantity: number | null;
  pending: number | null;
  basis: 'available' | 'on-hand';
  source: string;
}

export function inventoryQuantity(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

/** Source pools only: never add channel allocations, pending orders, or guessed SKU matches. */
export function inventoryFromSheet(sheet: { headers: string[]; rows: unknown[][] }): InventoryRow[] {
  if (!Array.isArray(sheet?.headers) || !Array.isArray(sheet?.rows)) throw new Error('재고 원본 형식 오류');
  const columns = new Map(sheet.headers.map((h, i) => [h.trim(), i]));
  if (!columns.has('SKU') || !columns.has('EZ가용')) throw new Error('재고 원본 열 확인 필요');
  const read = (row: unknown[], column: string) => row[columns.get(column) ?? -1];
  const locations = [
    ['domestic', 'EZ가용'], ['ez-overseas', 'EZ해외'],
    ['hannam', '한남쇼룸'], ['centum', '신세계센텀'],
  ] as const;
  return sheet.rows.flatMap((row, index) => {
    if (!Array.isArray(row)) throw new Error('재고 원본 행 확인 필요');
    const sku = String(read(row, 'SKU') ?? '').trim().toUpperCase();
    if (!sku || sku.startsWith('※')) return [];
    return locations.map(([location, column]) => ({
      id: `pms:${index}:${location}`, sku,
      name: String(read(row, '상품명') ?? ''), color: '', location,
      quantity: inventoryQuantity(read(row, column)),
      pending: location === 'domestic' ? inventoryQuantity(read(row, '출고대기')) : null,
      basis: location === 'domestic' ? 'available' as const : 'on-hand' as const,
      source: 'PMS 재고관리 저장값',
    }));
  });
}

/** Missing quantities make the subtotal incomplete; unknown is not zero. */
export function inventorySubtotal(rows: InventoryRow[], location: InventoryLocation): number | null {
  const selected = rows.filter(row => row.location === location);
  if (!selected.length || selected.some(row => row.quantity == null)) return null;
  // A duplicate SKU in the same source pool needs reconciliation, not silent summation.
  if (new Set(selected.map(row => row.sku)).size !== selected.length) return null;
  return selected.reduce((sum, row) => sum + row.quantity!, 0);
}
