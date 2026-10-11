import type { Sample, TradeStatement, Vendor } from './store';

/** A saved statement is reused even when a later sample-link write failed. */
export async function billSampleGroups(samples: Sample[], vendors: Vendor[], date: string, cnyKrw: number, deps: {
  statements: () => Promise<TradeStatement[]>;
  saveStatement: (s: TradeStatement) => Promise<TradeStatement>;
  saveSample: (s: Sample) => Promise<unknown>;
}) {
  const statements = await deps.statements();
  if (samples.some(s => !s.buyerId)) throw new Error('바이어 미지정 샘플을 먼저 확인해주세요.');
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) groups.set(sample.buyerId!, [...(groups.get(sample.buyerId!) || []), sample]);
  let created = 0;
  for (const [buyerId, rows] of groups) {
    const pending: Sample[] = [];
    for (const sample of rows) {
      const existing = statements.find(s => s.vendorId === buyerId && s.lines.some(l => l.id === 'sample-line-' + sample.id || l.memo === sample.id));
      if (existing) await deps.saveSample({ ...sample, billingStatus: '청구완료', billingDate: existing.issueDate, billingStatementId: existing.id });
      else pending.push(sample);
    }
    if (!pending.length) continue;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([buyerId, pending.map(s => s.id).sort()])));
    const id = 'sample-batch-' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    const vendor = vendors.find(v => v.id === buyerId);
    const saved = await deps.saveStatement({ id, statementNo: '', vendorId: buyerId, vendorName: vendor?.name || buyerId,
      vendorCode: vendor?.vendorCode || vendor?.code || 'SAMP', issueDate: date, status: '미청구', createdAt: new Date().toISOString(),
      lines: pending.map(s => ({ id: 'sample-line-' + s.id, description: `[${s.styleNo}] ${s.styleName || ''} ${s.stage} 샘플비`, qty: 1,
        unitPrice: s.costKrw || Math.round((s.costCny || 0) * cnyKrw), taxType: '과세', taxRate: 0.1, memo: s.id })),
    });
    statements.push(saved); created++;
    for (const sample of pending) await deps.saveSample({ ...sample, billingStatus: '청구완료', billingDate: saved.issueDate, billingStatementId: saved.id });
  }
  return created;
}
