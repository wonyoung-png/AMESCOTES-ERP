import assert from "node:assert/strict";
import test from "node:test";
import { modelSnapshot } from "./ads-context";
import { collectAdsSnapshot } from "./ads-data";
import { evidenceOf } from "./ads-council";
import type { AdsFact, AdsSnapshot } from "../shared/ads-analysis";

test("large account gets identical bounded 14-day decision context; raw snapshot unchanged and truncation explicit", () => {
  const facts: AdsFact[] = [];
  for (const unit of ["ad", "adset", "campaign"] as const)
    for (let i = 0; i < 300; i++)
      for (const period of ["current", "previous", "yesterday", "baseline7"])
        for (const metric of [
          "spend",
          "ctr",
          "cpc",
          "cpa",
          "roas",
          "frequency",
        ])
          facts.push({
            id: `${unit}:${i}:${period}:${metric}`,
            source: "meta.insights",
            entityId: `${unit}:${i}`,
            unit,
            period,
            metric,
            value: i + 1,
            currency: "USD",
          });
  const s: AdsSnapshot = {
    id: "large_synthetic",
    market: "lm-kr",
    hash: "immutable_raw_hash",
    collectedAt: "2026-10-11T00:00:00Z",
    dataAvailable: true,
    facts,
    sources: [],
    signals: [],
    alerts: [],
    tokenExpiresOn: "2026-11-24",
    tokenNeedsRenewal: false,
  };
  const before = JSON.stringify(s),
    a = modelSnapshot(s),
    b = modelSnapshot(s);
  assert.deepEqual(a, b);
  assert.equal(a.id, s.id);
  assert.equal(a.hash, s.hash);
  assert.equal(JSON.stringify(s), before);
  assert.ok(a.facts.length <= 80);
  assert.ok(JSON.stringify(a).length < 28000);
  assert.ok(
    a.facts.every(
      f => f.unit !== "ad" && ["current", "previous"].includes(f.period!)
    )
  );
  assert.equal(
    a.sources.find(x => x.source === "analysis_scope")?.state,
    "partial"
  );
  assert.equal(
    evidenceOf([{ factId: facts[0].id, value: facts[0].value }], s).length,
    0
  );
  const yesterday = facts.find(
    f => f.unit === "adset" && f.period === "yesterday"
  )!;
  assert.equal(
    evidenceOf([{ factId: yesterday.id, value: yesterday.value }], s).length,
    0
  );
});

test("default exported collector honors cancelled signal without any transport", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw Error("unexpected transport");
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      collectAdsSnapshot(
        "lm-kr",
        new Date("2026-10-11T00:00:00Z"),
        controller.signal
      )
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});

test("realistic nine metrics per period retain at least three top adsets and paired decision evidence", () => {
  const facts: AdsFact[] = [];
  for (const unit of ["campaign", "adset", "ad"] as const)
    for (let i = 1; i <= 20; i++) {
      const entityId = `${unit}:${i}`;
      for (const period of ["current", "previous", "yesterday", "baseline7"])
        for (const metric of [
          "spend",
          "impressions",
          "clicks",
          "ctr",
          "cpc",
          "frequency",
          "meta_purchases",
          "cpa",
          "roas",
        ])
          facts.push({
            id: `${entityId}:${period}:${metric}`,
            source: "meta.insights",
            entityId,
            unit,
            period,
            metric,
            value: metric === "spend" ? i * 100 : i,
            ...(["spend", "cpc", "cpa"].includes(metric)
              ? { currency: "USD" }
              : {}),
          });
      if (unit === "adset") {
        facts.push({
          id: `${entityId}:budget`,
          source: "meta.budget",
          entityId,
          unit,
          period: "current",
          metric: "daily_budget",
          currency: "USD",
          value: 500,
        });
        for (const metric of ["available_stock", "low_stock_threshold"])
          facts.push({
            id: `${entityId}:${metric}`,
            source: "inventory",
            entityId,
            unit: "product",
            period: "current",
            metric,
            value: 2,
          });
      }
    }
  for (let i = 0; i < 30; i++)
    facts.push({
      id: `account:${i}`,
      source: "commerce",
      unit: "account",
      period: "current",
      metric: `account_${i}`,
      value: i,
    });
  const s: AdsSnapshot = {
    id: "realistic",
    market: "lm-kr",
    hash: "raw_hash",
    collectedAt: "2026-10-11T00:00:00Z",
    dataAvailable: true,
    facts,
    sources: [],
    signals: [
      {
        id: "signal",
        entityId: "adset:20",
        text: "provider",
        factIds: ["adset:20:yesterday:cpa", "adset:20:current:roas"],
      },
    ],
    alerts: [],
    tokenExpiresOn: "2026-11-24",
    tokenNeedsRenewal: false,
  };
  const before = JSON.stringify(s),
    a = modelSnapshot(s),
    b = modelSnapshot(s);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), before);
  assert.equal(a.hash, s.hash);
  assert.deepEqual(modelSnapshot({ ...s, facts: [...facts].reverse() }), a);
  assert.ok(JSON.stringify(a).length <= 28000);
  assert.ok(a.facts.length <= 80);
  assert.ok(a.facts.filter(f => f.unit === "account").length <= 16);
  assert.ok(a.facts.filter(f => f.unit === "campaign").length <= 24);
  assert.ok(
    a.facts.filter(f => f.unit === "adset" || f.unit === "product").length <= 40
  );
  const adsets = [
    ...new Set(a.facts.filter(f => f.unit === "adset").map(f => f.entityId)),
  ];
  assert.deepEqual(adsets, ["adset:20", "adset:19", "adset:18"]);
  for (const entityId of adsets) {
    for (const metric of ["spend", "ctr", "cpc", "cpa", "roas", "frequency"])
      assert.ok(
        a.facts.some(
          f =>
            f.entityId === entityId &&
            f.period === "current" &&
            f.metric === metric
        )
      );
    for (const metric of ["spend", "roas", "cpa"])
      assert.ok(
        a.facts.some(
          f =>
            f.entityId === entityId &&
            f.period === "previous" &&
            f.metric === metric
        )
      );
    for (const metric of [
      "daily_budget",
      "available_stock",
      "low_stock_threshold",
    ])
      assert.ok(
        a.facts.some(f => f.entityId === entityId && f.metric === metric)
      );
  }
  assert.ok(
    a.facts.every(
      f => f.unit !== "ad" && ["current", "previous"].includes(f.period!)
    )
  );
  assert.deepEqual(a.signals[0].factIds, ["adset:20:current:roas"]);
  assert.equal(
    a.sources.find(x => x.source === "analysis_scope")?.state,
    "partial"
  );
});

test("high-spend missing ROAS remains visible as unknown, never forged zero or hidden", () => {
  const facts: AdsFact[] = [
    {
      id: "a",
      source: "meta",
      unit: "adset",
      entityId: "adset:1",
      period: "current",
      metric: "spend",
      value: 100,
      currency: "USD",
    },
    {
      id: "b",
      source: "meta",
      unit: "adset",
      entityId: "adset:2",
      period: "current",
      metric: "spend",
      value: 50,
      currency: "USD",
    },
    {
      id: "c",
      source: "meta",
      unit: "adset",
      entityId: "adset:2",
      period: "current",
      metric: "roas",
      value: 0,
    },
    {
      id: "d",
      source: "meta",
      unit: "adset",
      entityId: "adset:2",
      period: "previous",
      metric: "spend",
      value: 20,
      currency: "USD",
    },
  ];
  const s: AdsSnapshot = {
    id: "missing",
    hash: "raw",
    market: "lm-kr",
    collectedAt: "2026-10-11T00:00:00Z",
    facts,
    sources: [],
    signals: [],
    alerts: [],
    dataAvailable: true,
    tokenExpiresOn: "2026-11-24",
    tokenNeedsRenewal: false,
  };
  assert.deepEqual(
    modelSnapshot(s).facts.map(f => f.id),
    ["a", "b", "c", "d"]
  );
  assert.equal(
    modelSnapshot(s).facts.find(
      f => f.entityId === "adset:1" && f.metric === "roas"
    ),
    undefined
  );
  assert.equal(
    modelSnapshot(s).sources.find(x => x.source === "analysis_roas")?.state,
    "partial"
  );
  s.alerts = [
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `roas-${i}`,
      kind: "roas_unavailable",
      message: "unknown",
      factIds: ["a"],
      entityId: "adset:1",
    })),
    {
      id: "stop",
      kind: "account_status",
      message: "account stopped",
      factIds: [],
    },
  ];
  assert.equal(modelSnapshot(s).alerts[0].id, "stop");
  assert.equal(modelSnapshot(s).alerts.length, 12);
});
