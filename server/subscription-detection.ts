export type CardTransaction = {
  approvedOn: string; merchantName: string; cardLast4: string | null; amount: number; currency: string;
};

const AD_COST = /(?:FACEBK|FACEBOOK|META\s*ADS?|GOOGLE\s*ADS?|TIKTOK\s*ADS?)/i;

export function normalizeMerchant(value: string): string | null {
  const name = String(value || '').normalize('NFKC').toUpperCase().trim();
  if (!name || AD_COST.test(name)) return null;
  if (/^SHOPIFY[\s*#-]*\d+/i.test(name)) return 'SHOPIFY';
  return name.replace(/[\s*#_-]+[A-Z0-9]{4,}$/i, '').replace(/[^A-Z0-9가-힣]+/g, ' ').trim() || null;
}

export function detectSubscriptionCandidates(rows: CardTransaction[]) {
  const groups = new Map<string, CardTransaction[]>();
  for (const row of rows) {
    const merchantKey = normalizeMerchant(row.merchantName);
    if (!merchantKey || !/^\d{4}-\d{2}-\d{2}$/.test(row.approvedOn) || !(row.amount > 0)) continue;
    const key = [merchantKey, row.cardLast4 || '', row.currency || 'KRW'].join('|');
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return Array.from(groups.entries()).flatMap(([key, items]) => {
    const months = new Set(items.map(x => x.approvedOn.slice(0, 7)));
    if (months.size < 2) return [];
    const sorted = [...items].sort((a, b) => a.approvedOn.localeCompare(b.approvedOn));
    const [merchantKey, cardLast4, currency] = key.split('|');
    return [{ merchantKey, merchantName: sorted.at(-1)!.merchantName, cardLast4: cardLast4 || null, currency,
      latestAmount: sorted.at(-1)!.amount, averageAmount: items.reduce((n, x) => n + x.amount, 0) / items.length,
      monthCount: months.size, firstPaidOn: sorted[0].approvedOn, lastPaidOn: sorted.at(-1)!.approvedOn }];
  });
}

