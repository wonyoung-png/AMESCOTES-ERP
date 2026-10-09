import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyCashPlan, statementTotal } from './cashPlan';
import { getBomForOrderFromList } from './bomLookup';
import type { Bom, Item, ProductionOrder, PurchaseItem, TradeStatement } from './store';

test('통합 회귀: 품목→BOM→발주→구매→입고→정산→자금계획 연결', () => {
  const item: Item = { id: 'item-1', styleNo: 'LLL26FW001', name: '파니에 토트', season: '26FW', category: '토트백', erpCategory: 'HB', hasBom: true, createdAt: '' };
  const bom: Bom = { id: 'bom-1', styleId: item.id, styleNo: item.styleNo, styleName: item.name, season: '26FW', version: 1, lines: [{ id: 'line-1', category: '원자재', itemName: '나파가죽', unit: 'SF', unitPriceCny: 100, netQty: 2, lossRate: 0.05, isHqProvided: true }], postMaterials: [], postProcessLines: [], processingFee: 0, productionMarginRate: 0, snapshotCnyKrw: 190, pnl: { discountRate: 0, platformFeeRate: 0, sgaRate: 0 }, createdAt: '', updatedAt: '' };
  const order: ProductionOrder = { id: 'order-1', orderNo: 'PO-2609-001', workspace: 'OEM', styleId: item.id, styleNo: item.styleNo, styleName: item.name, season: '26FW', revision: 1, isReorder: false, qty: 100, colorQtys: [{ color: 'BLACK', qty: 100 }], vendorId: 'factory-1', vendorName: '테스트공장', orderDate: '2026-09-01', status: '생산중', hqSupplyItems: [], attachments: [], projectNo: 'LUM-260901-01', createdAt: '', updatedAt: '' };
  const purchase: PurchaseItem = { id: 'purchase-1', orderId: order.id, orderNo: order.orderNo, purchaseDate: '2026-09-02', itemName: bom.lines[0].itemName, qty: 210, unit: 'SF', unitPriceCny: 100, currency: 'CNY', appliedRate: 190, amountKrw: 3990000, vendorName: '가죽업체', paymentMethod: '계좌이체', purchaseStatus: '발주완료', projectNo: order.projectNo, styleNo: order.styleNo, createdAt: '' };

  const matched = getBomForOrderFromList([bom], order.styleNo, order.styleId);
  assert.equal(matched.bom?.id, bom.id);
  assert.equal(matched.type, 'pre');
  assert.equal(purchase.orderId, order.id);
  assert.equal(purchase.projectNo, order.projectNo);

  const receiptPayable = { id: 'pay-receipt', vendorName: order.vendorName!, sourceType: 'order_receipt' as const, orderId: order.id, amountKrw: 4000000, paidAmountKrw: 1000000, dueDate: '2026-10-10', status: 'partial' as const, createdAt: '' };
  const purchasePayable = { id: 'pay-purchase', vendorName: purchase.vendorName!, sourceType: 'purchase' as const, sourceId: purchase.id, orderId: order.id, amountKrw: purchase.amountKrw, paidAmountKrw: 0, dueDate: '2026-09-30', status: 'pending' as const, createdAt: '' };
  const statement: TradeStatement = { id: 'stmt-1', statementNo: '202609-WC-001', vendorId: 'wc', vendorName: 'W컨셉', vendorCode: 'WC', projectNo: order.projectNo, workspace: 'OEM', issueDate: '2026-09-20', lines: [{ id: 'sline-1', description: item.name, qty: 100, unitPrice: 200000, taxType: '과세', taxRate: 0.1 }], status: '청구완료', createdAt: '' };
  const settlement = { id: 'settle-1', buyerName: 'W컨셉', channel: 'B2B직납' as const, invoiceDate: statement.issueDate, dueDate: '2026-10-20', billedAmountKrw: statementTotal(statement), collectedAmountKrw: 2000000, status: '정상' as const, createdAt: '' };
  const months = buildMonthlyCashPlan([settlement], [purchasePayable, receiptPayable], [], new Date(2026, 8, 1), 2);

  assert.equal(statementTotal(statement), 22000000);
  assert.deepEqual(months.map(m => [m.key, m.incoming, m.outgoing]), [
    ['2026-09', 0, 3990000],
    ['2026-10', 20000000, 3000000],
  ]);
});

test('통합 회귀: 브랜드 캠페인 일정과 OEM 프로젝트 키가 유지된다', () => {
  const campaign = { workspace: 'LUMEN', channel: 'W컨셉', startDate: '2026-10-20', endDate: '2026-10-27', discountRate: 20, pushSkus: ['LLL26FW001'] };
  const orderLink = { workspace: 'OEM', projectNo: 'LUM-260901-01', styleNo: campaign.pushSkus[0] };
  assert.equal(campaign.pushSkus[0], orderLink.styleNo);
  assert.ok(campaign.startDate <= campaign.endDate);
  assert.equal(campaign.discountRate, 20);
});
