import type { AdsFact, AdsSnapshot } from "../shared/ads-analysis";

// Raw snapshot remains durable for audit. Every participant receives this SAME
// bounded projection with the original snapshot ID/hash and an explicit limit.
export const isDecisionFact = (f: AdsFact) =>
  f.unit !== "ad" &&
  ["account", "campaign", "adset", "product"].includes(f.unit || "") &&
  (f.period === "current" ||
    f.period === "previous" ||
    (f.unit === "account" && f.period === undefined));

export function modelSnapshot(snapshot: AdsSnapshot): AdsSnapshot {
  const candidates = snapshot.facts.filter(isDecisionFact);
  const byId = (a: AdsFact, b: AdsFact) => a.id.localeCompare(b.id);
  const facts = candidates
    .filter(f => f.unit === "account")
    .sort(byId)
    .slice(0, 16);
  for (const unit of ["campaign", "adset"] as const) {
    const spends = candidates
      .filter(
        f => f.unit === unit && f.metric === "spend" && f.period === "current"
      )
      .sort(
        (a, b) =>
          b.value - a.value ||
          String(a.entityId).localeCompare(String(b.entityId)) ||
          byId(a, b)
      );
    let taken = 0;
    const seen = new Set<string | undefined>();
    for (const spend of spends) {
      if (seen.has(spend.entityId)) continue;
      seen.add(spend.entityId);
      const entity = candidates.filter(
        f =>
          f.entityId === spend.entityId &&
          (f.unit === unit || f.unit === "product")
      );
      const selected: AdsFact[] = [];
      const find = (metric: string, period: string) =>
        entity
          .filter(
            f =>
              f.unit === unit &&
              f.metric === metric &&
              f.period === period &&
              (!f.currency || f.currency === spend.currency)
          )
          .sort(byId)[0];
      // Missing ROAS is unknown, NOT a reason to hide costly entities. Keep
      // measured spend and label unavailable performance without inventing zero.
      for (const period of ["current", "previous"]) {
        const periodSpend =
          period === "current" ? spend : find("spend", period);
        const roas = find("roas", period);
        if (!periodSpend) continue;
        selected.push(periodSpend);
        if (roas) selected.push(roas);
        for (const metric of period === "current"
          ? ["ctr", "cpc", "cpa", "frequency"]
          : ["cpa"]) {
          const f = find(metric, period);
          if (f) selected.push(f);
        }
      }
      if (!selected.includes(spend)) continue;
      // At most three current policy facts: budget, available stock, threshold.
      for (const metric of [
        "daily_budget",
        "available_stock",
        "low_stock_threshold",
      ]) {
        const f = entity
          .filter(
            f =>
              f.metric === metric &&
              f.period === "current" &&
              (metric === "daily_budget"
                ? f.unit === unit && f.currency === spend.currency
                : f.unit === "product")
          )
          .sort(byId)[0];
        if (f) selected.push(f);
      }
      const limit = unit === "campaign" ? 24 : 40;
      if (
        taken + selected.length > limit ||
        facts.length + selected.length > 80
      )
        continue;
      facts.push(...selected);
      taken += selected.length;
    }
  }
  const ids = new Set(facts.map(f => f.id)),
    entities = new Set(facts.map(f => f.entityId));
  const omitted = candidates.length - facts.length;
  const alerts = snapshot.alerts
    .filter(a => !a.entityId || entities.has(a.entityId))
    .map(a => ({ ...a, factIds: a.factIds.filter(id => ids.has(id)) }));
  const result: AdsSnapshot = {
    ...snapshot,
    facts,
    signals: snapshot.signals
      .filter(s => s.entityId && entities.has(s.entityId))
      .slice(0, 4)
      .map(s => ({
        ...s,
        text: s.text.slice(0, 500),
        factIds: s.factIds.filter(id => ids.has(id)),
      })),
    alerts: alerts
      .sort(
        (a, b) =>
          Number(
            ![
              "auth_unavailable",
              "token_renewal",
              "account_status",
              "account_disabled",
            ].includes(a.kind)
          ) -
          Number(
            ![
              "auth_unavailable",
              "token_renewal",
              "account_status",
              "account_disabled",
            ].includes(b.kind)
          )
      )
      .slice(0, 12),
    sources: [
      ...snapshot.sources,
      ...(facts.some(
        f =>
          f.metric === "spend" &&
          f.period === "current" &&
          !facts.some(
            r =>
              r.metric === "roas" &&
              r.entityId === f.entityId &&
              r.period === "current"
          )
      )
        ? [
            {
              source: "analysis_roas",
              state: "partial" as const,
              checkedAt: snapshot.collectedAt,
              reason:
                "일부 집행 단위 ROAS 미제공 — 구매 0건/성과 저조로 추정하지 않음",
            },
          ]
        : []),
      {
        source: "analysis_scope",
        state: omitted > 0 ? "partial" : "ok",
        checkedAt: snapshot.collectedAt,
        reason:
          omitted > 0
            ? `일부 지출 상위 단위만 분석: ${facts.length}/${candidates.length} 근거. 제외 단위의 결론 아님`
            : "14일 캠페인·광고세트 근거만 판단",
      },
    ],
  };
  // Leave headroom for question, originals and one review per model.
  if (JSON.stringify(result).length > 28_000) throw Error("ads_context_limit");
  return result;
}
