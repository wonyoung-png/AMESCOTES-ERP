import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  collectAdsSnapshot,
  createAdsCollector,
  metaOpinion,
  buildAdsAlerts,
  type AdsCollectorDeps,
} from "./ads-data";
import type { AdsFact, AdsSnapshot } from "../shared/ads-analysis";

const NOW = new Date("2026-10-11T12:00:00Z"),
  TOKEN = "mock-secret-not-live";
const mapping = {
  verified: true,
  campaignIds: ["101"],
  budgetMinorDivisor: 100,
  adsetProducts: {
    "201": {
      sku: "LOG-BROWN",
      location: "domestic" as const,
      lowStockThreshold: 2,
    },
  },
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function setup(
  handler?: (url: URL, init: RequestInit) => Response | undefined
) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const deps: AdsCollectorDeps = {
    env: {
      META_ADS_TOKEN: TOKEN,
      META_AD_ACCOUNT_ID: "act_999",
      META_ADS_API_VERSION: "v26.0",
    },
    marketMappings: {
      "lm-kr": mapping,
      "lm-gl": { verified: true, campaignIds: ["102"] },
    },
    sleep: async () => {},
    readOrders: async () => ({ state: "ok", rows: [] }),
    readInventory: async () => [
      {
        id: "source-only",
        sku: "LOG-BROWN",
        name: "private product name",
        color: "BROWN",
        location: "domestic",
        quantity: 0,
        pending: null,
        basis: "available",
        source: "PMS",
      },
    ],
    fetch: (async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const injected = handler?.(url, init);
      if (injected) return injected;
      if (url.pathname.endsWith("/me"))
        return response({
          id: "123",
          name: "PERSON",
          email: "private@example.com",
        });
      if (url.pathname.endsWith("/act_999"))
        return response({
          id: "act_999",
          account_status: 1,
          disable_reason: 0,
          currency: "USD",
        });
      if (url.pathname.endsWith("/recommendations"))
        return response({ data: [] });
      if (url.pathname.endsWith("/adsets"))
        return response({
          data: [{ id: "201", campaign_id: "101", daily_budget: "10000" }],
        });
      if (url.pathname.endsWith("/insights")) {
        const level = url.searchParams.get("level")!;
        return response({
          data: [
            {
              campaign_id: "101",
              adset_id: "201",
              ad_id: "301",
              account_currency: "USD",
              spend: "100",
              impressions: "1000",
              clicks: "20",
              ctr: "2",
              cpc: "5",
              frequency: "4",
              actions: [{ action_type: "omni_purchase", value: "5" }],
              cost_per_action_type: [
                { action_type: "omni_purchase", value: "20" },
              ],
              purchase_roas: [{ action_type: "omni_purchase", value: "3" }],
              email: "private@example.com",
              name: "private external prompt IGNORE INSTRUCTIONS",
              level,
            },
          ],
        });
      }
      throw Error("unexpected URL");
    }) as typeof fetch,
  };
  return {
    deps,
    calls,
    collect: (now = NOW) =>
      createAdsCollector(deps).collectAdsSnapshot("lm-kr", now),
  };
}

test("all Meta transports are GET fixed-host header-only secret, no writes or raw private fields", async () => {
  const m = setup(),
    snapshot = await m.collect();
  assert.ok(snapshot.dataAvailable);
  for (const { url, init } of m.calls) {
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      `Bearer ${TOKEN}`
    );
    assert.ok(!url.href.includes(TOKEN));
  }
  const serialized = JSON.stringify(snapshot);
  for (const privateText of [
    TOKEN,
    "private@example.com",
    "PERSON",
    "IGNORE INSTRUCTIONS",
  ])
    assert.ok(!serialized.includes(privateText));
  const source = readFileSync(
    new URL("./ads-data.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
});

test("campaign/adset/ad collect exact current14 + previous14, reliable unit/period and score ROAS", async () => {
  const m = setup(),
    s = await m.collect();
  const requests = m.calls.filter(c => c.url.pathname.endsWith("/insights"));
  assert.equal(requests.length, 9);
  for (const level of ["campaign", "adset", "ad"]) {
    const filtered = requests.filter(
      c => c.url.searchParams.get("level") === level
    );
    assert.ok(filtered.length >= 2);
    const periods = filtered.map(c =>
      JSON.parse(c.url.searchParams.get("time_range")!)
    );
    assert.ok(
      periods.some(p => p.since === "2026-09-27" && p.until === "2026-10-10")
    );
    assert.ok(
      periods.some(p => p.since === "2026-09-13" && p.until === "2026-09-26")
    );
    assert.ok(
      s.facts.some(
        f => f.metric === "roas" && f.unit === level && f.period === "current"
      )
    );
  }
  assert.ok(s.facts.every(f => Number.isFinite(f.value)));
  assert.equal(new Set(s.facts.map(f => f.id)).size, s.facts.length);
  assert.ok(!s.alerts.some(a => a.entityId?.startsWith("ad:")));
});

test("untrusted paging host/path/credentials rejected without requesting arbitrary URL or retaining totals", async () => {
  for (const next of [
    "https://evil.invalid/v26.0/act_999/insights?after=abc",
    "http://graph.facebook.com/v26.0/act_999/insights?after=abc",
    "https://graph.facebook.com/v26.0/act_999/ads?after=abc",
    "https://u:p@graph.facebook.com/v26.0/act_999/insights?after=abc",
  ]) {
    const m = setup(url =>
      url.pathname.endsWith("/insights")
        ? response({
            data: [
              { campaign_id: "101", adset_id: "201", ad_id: "301", spend: "5" },
            ],
            paging: { next, cursors: { after: "abc" } },
          })
        : undefined
    );
    const s = await m.collect();
    assert.equal(s.dataAvailable, false);
    assert.ok(s.sources.some(x => x.reason === "meta_untrusted_paging"));
    assert.ok(!s.facts.some(f => f.source.startsWith("meta.insights")));
    assert.ok(
      m.calls.every(c => c.url.origin === "https://graph.facebook.com")
    );
  }
});

test("paging reconstructs own query, ignores provider token/filter and bounds cyclic cursor", async () => {
  const m = setup(url => {
    if (!url.pathname.endsWith("/insights")) return;
    if (url.searchParams.has("after")) {
      assert.equal(url.searchParams.get("after"), "safe_cursor");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.ok(url.searchParams.get("filtering")!.includes("101"));
      return response({ data: [] });
    }
    return response({
      data: [],
      paging: {
        next: "https://graph.facebook.com/v26.0/act_999/insights?after=safe_cursor&access_token=provider-secret&filtering=evil",
      },
    });
  });
  await m.collect();
  assert.equal(m.calls.filter(c => c.url.searchParams.has("after")).length, 9);
  const cycle = setup(url =>
    url.pathname.endsWith("/insights")
      ? response({
          data: [],
          paging: {
            next: "https://graph.facebook.com/v26.0/act_999/insights?after=abc",
          },
        })
      : undefined
  );
  const s = await cycle.collect();
  assert.ok(s.sources.some(x => x.reason === "meta_invalid_paging_cursor"));
  assert.ok(cycle.calls.length < 30);
});

test("missing metrics stay absent/partial; actual numeric zeros remain measured zeros", async () => {
  const m = setup(url =>
    url.pathname.endsWith("/insights")
      ? response({
          data: [
            {
              campaign_id: "101",
              adset_id: "201",
              ad_id: "301",
              spend: "0",
              impressions: "",
              cpc: null,
              ctr: "NaN",
              frequency: "Infinity",
            },
          ],
        })
      : undefined
  );
  const s = await m.collect();
  assert.ok(s.facts.some(f => f.metric === "spend" && f.value === 0));
  assert.ok(
    !s.facts.some(f =>
      ["impressions", "cpc", "ctr", "frequency", "cpa", "roas"].includes(
        f.metric
      )
    )
  );
  assert.ok(
    s.sources.some(
      x => x.source.startsWith("meta.insights") && x.state === "partial"
    )
  );
  assert.ok(
    !s.alerts.some(a => a.kind === "cpa_spike" || a.kind === "ctr_drop")
  );
});

test("absent/overlapping/unverified market mapping cannot fabricate a domestic/global split", async () => {
  for (const variant of ["absent", "unverified", "overlap"]) {
    const m = setup();
    m.deps.marketMappings =
      variant === "absent"
        ? {}
        : variant === "unverified"
          ? { "lm-kr": { ...mapping, verified: false } }
          : {
              "lm-kr": mapping,
              "lm-gl": { verified: true, campaignIds: ["101"] },
            };
    const s = await m.collect();
    assert.equal(s.dataAvailable, false);
    assert.ok(
      s.sources.some(
        x => x.source === "market_mapping" && x.state === "unavailable"
      )
    );
    assert.ok(
      !m.calls.some(
        c =>
          c.url.pathname.endsWith("/insights") &&
          c.url.searchParams.has("filtering")
      )
    );
  }
});

test("missing account/token/version produces sanitized unavailable source, no secret-bearing errors", async () => {
  for (const kind of ["token", "account", "version"]) {
    const m = setup();
    if (kind === "token") m.deps.env.META_ADS_TOKEN = undefined;
    if (kind === "account")
      m.deps.env.META_AD_ACCOUNT_ID = "https://evil.invalid";
    if (kind === "version") m.deps.env.META_ADS_API_VERSION = "../../ads";
    const s = await m.collect();
    assert.equal(s.dataAvailable, false);
    assert.equal(m.calls.length, 0);
    assert.ok(
      s.sources.some(
        x => x.source === "meta.config" && x.state === "unavailable"
      )
    );
  }
});

test("actual expired auth response blocks Meta insights and never includes provider secrets in snapshot", async () => {
  const m = setup(url =>
    url.pathname.endsWith("/me")
      ? response({
          error: { code: 190, message: `expired ${TOKEN} private@example.com` },
        })
      : undefined
  );
  const s = await m.collect(new Date("2026-11-11T00:00:00Z"));
  assert.equal(s.dataAvailable, false);
  assert.ok(s.alerts.some(a => a.kind === "auth_unavailable"));
  assert.ok(s.alerts.some(a => a.kind === "token_renewal"));
  assert.ok(!m.calls.some(c => c.url.pathname.endsWith("/insights")));
  assert.ok(!JSON.stringify(s).includes(TOKEN));
});

test("provider expiry subcode triggers immediate renewal before configured renewal date", async () => {
  const m = setup(url =>
    url.pathname.endsWith("/me")
      ? response({
          error: { code: 190, error_subcode: 463, message: "expired" },
        })
      : undefined
  );
  const s = await m.collect();
  assert.equal(s.tokenNeedsRenewal, true);
  assert.equal(s.tokenExpiresOn, "2026-11-24");
  assert.equal(s.dataAvailable, false);
  assert.ok(
    s.alerts.some(
      a => a.kind === "token_renewal" && a.message.includes("재인증")
    )
  );
});

test("renewal exactly14 days before configured expiry and sooner actual expiry wins", async () => {
  assert.equal(
    (await setup().collect(new Date("2026-11-09T14:59:59Z"))).tokenNeedsRenewal,
    false
  );
  assert.equal(
    (await setup().collect(new Date("2026-11-09T15:00:00Z"))).tokenNeedsRenewal,
    true
  );
  const actual = setup(url =>
    url.pathname.endsWith("/act_999")
      ? response({
          id: "act_999",
          account_status: 1,
          currency: "USD",
          user_access_expire_time: Date.parse("2026-10-20T00:00:00Z") / 1000,
        })
      : undefined
  );
  const s = await actual.collect();
  assert.equal(s.tokenExpiresOn, "2026-10-20");
  assert.equal(s.tokenNeedsRenewal, true);
});

test("recommendations unsupported is not applicable, supported provider text only without inferred action", async () => {
  const unsupported = setup(url =>
    url.pathname.endsWith("/recommendations")
      ? response({ error: { code: 100, message: "unsupported" } })
      : undefined
  );
  assert.equal(
    metaOpinion(await unsupported.collect()).state,
    "not_applicable"
  );
  const m = setup(url =>
    url.pathname.endsWith("/recommendations")
      ? response({
          data: [
            {
              recommendations: [
                {
                  campaign_id: "101",
                  message: `Provider says wait ${TOKEN} mail@example.com`,
                },
                { ad_id: "301", message: "No ad unit action" },
                { campaign_id: "999", message: "foreign market" },
              ],
            },
          ],
        })
      : undefined
  );
  const s = await m.collect(),
    opinion = metaOpinion(s);
  assert.equal(opinion.state, "ok");
  assert.equal(opinion.actions.length, 0);
  assert.equal(opinion.confidence, "unknown");
  assert.ok(opinion.conclusion.startsWith("Provider says wait"));
  assert.ok(!JSON.stringify(opinion).includes(TOKEN));
  assert.ok(!opinion.conclusion.includes("No ad unit action"));
  assert.deepEqual(opinion.evidence, []);
});

test("actual orders aggregate + UTM, dedupe source IDs, retain currencies, no order IDs or customer PII", async () => {
  const m = setup();
  m.deps.readOrders = async () => ({
    state: "ok",
    rows: [
      {
        id: "customer-private-order",
        channel: "cafe24",
        market: "lm-kr",
        createdAt: "2026-10-01T01:00:00Z",
        paid: true,
        revenue: 300000,
        currency: "KRW",
        utmSource: "meta",
        utmCampaignId: "101",
      },
      {
        id: "customer-private-order",
        channel: "cafe24",
        market: "lm-kr",
        createdAt: "2026-10-01T01:00:00Z",
        paid: true,
        revenue: 300000,
        currency: "KRW",
      },
      {
        id: "second-private-order",
        channel: "shopify",
        market: "lm-kr",
        createdAt: "2026-10-01T02:00:00Z",
        paid: true,
        revenue: 250,
        currency: "USD",
        utmSource: "organic",
      },
      {
        id: "not-paid",
        channel: "cafe24",
        market: "lm-kr",
        createdAt: "2026-10-01T01:00:00Z",
        paid: false,
        revenue: 1,
        currency: "KRW",
      },
    ],
  });
  const s = await m.collect();
  assert.equal(s.facts.find(f => f.metric === "actual_paid_orders")?.value, 2);
  assert.equal(
    s.facts.find(f => f.metric === "meta_utm_paid_orders")?.value,
    1
  );
  assert.deepEqual(
    s.facts
      .filter(f => f.metric === "actual_paid_revenue")
      .map(f => [f.currency, f.value]),
    [
      ["KRW", 300000],
      ["USD", 250],
    ]
  );
  assert.ok(!JSON.stringify(s).includes("private-order"));
  assert.equal(new Set(s.facts.map(f => f.id)).size, s.facts.length);
});

test("missing UTM coverage suppresses that period attribution fact, not a misleading zero", async () => {
  const m = setup();
  m.deps.readOrders = async () => ({
    state: "partial",
    rows: [
      {
        id: "current-private",
        channel: "shopify",
        market: "lm-kr",
        createdAt: "2026-10-01T00:00:00Z",
        paid: true,
        revenue: 10,
        currency: "USD",
      },
      {
        id: "previous-private",
        channel: "shopify",
        market: "lm-kr",
        createdAt: "2026-09-20T00:00:00Z",
        paid: true,
        revenue: 20,
        currency: "USD",
        utmSource: "meta",
        utmCampaignId: "101",
      },
    ],
  });
  const s = await m.collect();
  assert.ok(
    !s.facts.some(
      f => f.metric === "meta_utm_paid_orders" && f.period === "current"
    )
  );
  assert.equal(
    s.facts.find(
      f => f.metric === "meta_utm_paid_orders" && f.period === "previous"
    )?.value,
    1
  );
  assert.equal(
    s.facts.find(
      f => f.metric === "actual_paid_orders" && f.period === "current"
    )?.value,
    1
  );
  assert.ok(
    s.sources.some(
      x => x.source === "commerce.orders_utm" && x.state === "partial"
    )
  );
});

test("missing orders/inventory remain unavailable, never fake zero orders or stock", async () => {
  const m = setup();
  m.deps.readOrders = async () => {
    throw Error(`private ${TOKEN}`);
  };
  m.deps.readInventory = async () => {
    throw Error("private");
  };
  const s = await m.collect();
  assert.ok(
    s.sources.some(
      x => x.source === "commerce.orders_utm" && x.state === "unavailable"
    )
  );
  assert.ok(
    s.sources.some(x => x.source === "inventory" && x.state === "unavailable")
  );
  assert.ok(
    !s.facts.some(
      f => f.metric === "actual_paid_orders" || f.metric === "available_stock"
    )
  );
});

test("partial or ambiguous inventory pools produce no zero substitutions", async () => {
  const m = setup();
  m.deps.readInventory = async () => [
    {
      id: "a",
      sku: "LOG-BROWN",
      name: "",
      color: "",
      location: "domestic",
      quantity: null,
      pending: null,
      basis: "available",
      source: "PMS",
    },
  ];
  const s = await m.collect();
  assert.ok(!s.facts.some(f => f.metric === "available_stock"));
  assert.ok(
    s.sources.some(x => x.source === "inventory" && x.state === "partial")
  );
});

const makeFact = (
  metric: string,
  value: number,
  period = "current",
  unit: AdsFact["unit"] = "adset"
): AdsFact => ({
  id: `${metric}-${period}-${unit}`,
  source: `meta.insights.adset.${period}:omni_purchase`,
  metric,
  value,
  period,
  unit,
  entityId: `${unit}:201`,
  currency: "USD",
});

test("missing ROAS with spend is explicit alert, not zero purchases or hidden entity", () => {
  const s = {
    id: "missing",
    market: "lm-kr",
    collectedAt: NOW.toISOString(),
    hash: "raw",
    facts: [makeFact("spend", 100)],
    sources: [],
    signals: [],
    alerts: [],
    dataAvailable: true,
    tokenExpiresOn: "2026-11-24",
    tokenNeedsRenewal: false,
  } as AdsSnapshot;
  const alerts = buildAdsAlerts(s);
  assert.equal(
    alerts.find(a => a.kind === "roas_unavailable")?.entityId,
    "adset:201"
  );
  assert.deepEqual(alerts.find(a => a.kind === "roas_unavailable")?.factIds, [
    s.facts[0].id,
  ]);
  assert.match(alerts[0].message, /단정하지 않음/);
  assert.ok(
    !buildAdsAlerts({ ...s, facts: [...s.facts, makeFact("roas", 0)] }).some(
      a => a.kind === "roas_unavailable"
    )
  );
});
test("alerts use concrete facts for CPA+40/frequency/CTR/budget/stock; no ad analysis", () => {
  const facts = [
    makeFact("cpa", 140, "yesterday"),
    makeFact("cpa", 100, "baseline7"),
    makeFact("ctr", 0.6, "yesterday"),
    makeFact("ctr", 1, "baseline7"),
    makeFact("frequency", 3.5),
    makeFact("spend", 131, "yesterday"),
    makeFact("daily_budget", 100),
    makeFact("spend", 10),
    makeFact("available_stock", 0),
    makeFact("frequency", 99, "current", "ad"),
  ];
  const s = {
    id: "snap",
    market: "lm-kr",
    collectedAt: NOW.toISOString(),
    hash: "x",
    facts,
    sources: [],
    signals: [],
    alerts: [],
    dataAvailable: true,
    tokenExpiresOn: "2026-11-24",
    tokenNeedsRenewal: false,
  } as AdsSnapshot;
  const alerts = buildAdsAlerts(s);
  for (const kind of [
    "cpa_spike",
    "high_frequency",
    "ctr_drop",
    "budget_pace",
    "out_of_stock_spend",
  ])
    assert.ok(alerts.some(a => a.kind === kind));
  assert.ok(
    alerts.every(
      a =>
        !a.entityId?.startsWith("ad:") &&
        a.factIds.every(id => facts.some(f => f.id === id))
    )
  );
});

test("GET retry bounded and cancellation prevents further calls", async () => {
  let probes = 0;
  const m = setup(url =>
    url.pathname.endsWith("/me") && ++probes < 3 ? response({}, 429) : undefined
  );
  await m.collect();
  assert.equal(probes, 3);
  const stopped = setup();
  const abort = new AbortController();
  abort.abort();
  stopped.deps.signal = abort.signal;
  await assert.rejects(stopped.collect(), /source_deadline/);
  assert.equal(stopped.calls.length, 0);
  stopped.deps.env = {};
  stopped.deps.marketMappings = {};
  await assert.rejects(stopped.collect(), /source_deadline/);
  assert.equal(stopped.calls.length, 0);
});

test("unverified provider score/anomalies/trends are explicitly unavailable, not inferred from insights", async () => {
  const m = setup(),
    s = await m.collect();
  for (const name of ["opportunity_score", "anomalies", "trends"]) {
    assert.ok(
      s.sources.some(
        x =>
          x.source === `meta.${name}` && x.state === "unavailable" && x.reason
      )
    );
    assert.ok(!s.signals.some(x => x.id === name));
  }
  assert.ok(
    !m.calls.some(c =>
      /\/(opportunity_score|anomalies|trends)$/.test(c.url.pathname)
    )
  );
});

test("lease loss during Meta paging prevents next page, all later GETs, orders and inventory", async () => {
  const abort = new AbortController();
  let orders = 0,
    inventory = 0;
  const m = setup(url => {
    if (!url.pathname.endsWith("/insights")) return;
    abort.abort();
    return response({
      data: [],
      paging: {
        next: "https://graph.facebook.com/v26.0/act_999/insights?after=next",
      },
    });
  });
  m.deps.signal = abort.signal;
  m.deps.readOrders = async () => {
    orders++;
    return { state: "ok", rows: [] };
  };
  m.deps.readInventory = async () => {
    inventory++;
    return [];
  };
  const s = await m.collect();
  assert.equal(m.calls.length, 3);
  assert.equal(orders, 0);
  assert.equal(inventory, 0);
  assert.equal(s.dataAvailable, false);
  assert.ok(
    s.sources.some(
      x => x.source === "commerce.orders_utm" && x.reason === "source_deadline"
    )
  );
});

test("lease loss at recommendations prevents commerce reads; loss during orders prevents inventory", async () => {
  for (const boundary of ["recommendations", "orders"] as const) {
    const abort = new AbortController();
    let orders = 0,
      inventory = 0;
    const m = setup(url => {
      if (
        boundary === "recommendations" &&
        url.pathname.endsWith("/recommendations")
      ) {
        abort.abort();
        return response({ data: [] });
      }
    });
    m.deps.signal = abort.signal;
    m.deps.readOrders = async (_market, _since, _until, signal) => {
      orders++;
      assert.equal(signal, abort.signal);
      abort.abort();
      return {
        state: "ok",
        rows: [
          {
            id: "late",
            channel: "shopify",
            market: "lm-kr",
            createdAt: "2026-10-01T00:00:00Z",
            paid: true,
            revenue: 1,
            currency: "USD",
          },
        ],
      };
    };
    m.deps.readInventory = async () => {
      inventory++;
      return [];
    };
    const s = await m.collect();
    assert.equal(orders, boundary === "orders" ? 1 : 0);
    assert.equal(inventory, 0);
    assert.ok(!s.facts.some(f => f.source.startsWith("commerce.")));
  }
});

test("inventory receives cancellation signal and ignores results completed after lease loss", async () => {
  const m = setup(),
    abort = new AbortController();
  m.deps.signal = abort.signal;
  const read = m.deps.readInventory;
  m.deps.readInventory = async (market, signal) => {
    assert.equal(signal, abort.signal);
    abort.abort();
    return read(market);
  };
  const s = await m.collect();
  assert.ok(!s.facts.some(f => f.metric === "available_stock"));
  assert.ok(
    s.sources.some(
      x => x.source === "inventory" && x.reason === "source_deadline"
    )
  );
});

test("account coverage pages union both verified markets, exposes only unmapped account spend by currency", async () => {
  const m = setup(url => {
    if (
      !url.pathname.endsWith("/insights") ||
      url.searchParams.has("filtering")
    )
      return;
    assert.equal(
      url.searchParams.get("fields"),
      "campaign_id,spend,account_currency"
    );
    assert.equal(url.searchParams.get("level"), "campaign");
    if (url.searchParams.has("after"))
      return response({
        data: [
          {
            campaign_id: "88776655",
            spend: "7",
            account_currency: "KRW",
            name: "private-unmapped",
          },
          { campaign_id: "88776656", spend: "0", account_currency: "USD" },
        ],
      });
    return response({
      data: [
        { campaign_id: "101", spend: "10", account_currency: "USD" },
        { campaign_id: "102", spend: "20", account_currency: "USD" },
        { campaign_id: "88776654", spend: "3", account_currency: "USD" },
      ],
      paging: {
        next: "https://graph.facebook.com/v26.0/act_999/insights?after=coverage_next",
      },
    });
  });
  const s = await m.collect(),
    facts = s.facts.filter(f => f.metric === "unmapped_spend");
  assert.deepEqual(
    facts.map(f => [f.value, f.currency, f.entityId, f.unit]),
    [
      [3, "USD", "act_999", "account"],
      [7, "KRW", "act_999", "account"],
    ]
  );
  assert.ok(
    s.sources.some(
      x =>
        x.source === "meta.market_coverage" &&
        x.state === "partial" &&
        x.reason === "unmapped_campaign_spend"
    )
  );
  assert.ok(
    s.alerts.some(a => a.kind === "market_coverage" && a.factIds.length === 2)
  );
  for (const text of ["88776654", "88776655", "88776656", "private-unmapped"])
    assert.ok(!JSON.stringify(s).includes(text));
  assert.ok(!metaOpinion(s).actions.length);
});

test("coverage zero spend is not a gap; missing metric and unverified mapping cannot claim complete coverage", async () => {
  for (const mode of ["zero", "missing", "unverified"] as const) {
    const m = setup(url =>
      url.pathname.endsWith("/insights") && !url.searchParams.has("filtering")
        ? response({
            data: [
              { campaign_id: "102", spend: "20", account_currency: "USD" },
              {
                campaign_id: "777",
                ...(mode === "missing" ? {} : { spend: "0" }),
                account_currency: "USD",
              },
            ],
          })
        : undefined
    );
    if (mode === "unverified")
      m.deps.marketMappings!["lm-gl"] = {
        verified: false,
        campaignIds: ["102"],
      };
    const s = await m.collect(),
      coverage = s.sources.find(x => x.source === "meta.market_coverage");
    assert.equal(coverage?.state, mode === "zero" ? "ok" : "partial");
    assert.equal(
      s.alerts.some(a => a.kind === "market_coverage"),
      mode !== "zero"
    );
    assert.equal(
      s.facts.some(f => f.metric === "unmapped_spend"),
      mode === "unverified"
    );
  }
});

test("KST daily date before 09:00 aligns Meta and commerce UTC-literal windows across midnight", async () => {
  for (const [now, end] of [
    ["2026-10-10T14:59:59Z", "2026-10-09"],
    ["2026-10-10T15:00:00Z", "2026-10-10"],
    ["2026-10-10T22:00:00Z", "2026-10-10"],
  ] as const) {
    const m = setup();
    let requested: string[] = [];
    m.deps.readOrders = async (_market, since, until) => {
      requested = [since, until];
      return {
        state: "ok",
        rows: [
          {
            id: "boundary-current",
            market: "lm-kr",
            channel: "shopify",
            createdAt: "2026-09-27T00:00:00Z",
            paid: true,
            revenue: 1,
            currency: "USD",
            utmSource: "organic",
          },
          {
            id: "boundary-previous",
            market: "lm-kr",
            channel: "shopify",
            createdAt: "2026-09-26T23:59:59Z",
            paid: true,
            revenue: 1,
            currency: "USD",
            utmSource: "organic",
          },
          {
            id: "boundary-end",
            market: "lm-kr",
            channel: "shopify",
            createdAt: "2026-10-11T00:00:00Z",
            paid: true,
            revenue: 1,
            currency: "USD",
            utmSource: "organic",
          },
        ],
      };
    };
    const s = await m.collect(new Date(now));
    assert.equal(requested[1], end);
    const current = m.calls.find(c => c.url.pathname.endsWith("/insights"))!;
    const range = JSON.parse(current.url.searchParams.get("time_range")!);
    assert.equal(range.until, end);
    assert.equal(
      Date.parse(`${range.since}T00:00:00Z`) -
        Date.parse(`${requested[0]}T00:00:00Z`),
      14 * 86400000
    );
    if (end === "2026-10-10")
      for (const period of ["current", "previous"])
        assert.equal(
          s.facts.find(
            f => f.metric === "actual_paid_orders" && f.period === period
          )?.value,
          1
        );
  }
});

test("HTTP error bodies recognize actual token expiry before status/retry and revoke previous auth", async () => {
  for (const status of [400, 401, 403, 500]) {
    const m = setup(url =>
      url.pathname.endsWith("/me")
        ? response(
            { error: { code: 190, error_subcode: 463, message: TOKEN } },
            status
          )
        : undefined
    );
    const s = await m.collect();
    assert.equal(m.calls.length, 1);
    assert.equal(s.tokenNeedsRenewal, true);
    assert.equal(s.dataAvailable, false);
    assert.ok(
      s.sources.some(
        x =>
          x.source === "meta.auth" &&
          x.state === "unavailable" &&
          x.reason === "meta_token_expired"
      )
    );
    assert.ok(s.alerts.some(a => a.kind === "token_renewal"));
    assert.ok(!JSON.stringify(s).includes(TOKEN));
  }
  let filtered = 0;
  const later = setup(url =>
    url.pathname.endsWith("/insights") &&
    url.searchParams.has("filtering") &&
    ++filtered === 2
      ? response({ error: { code: 190, error_subcode: 463 } }, 400)
      : undefined
  );
  const s = await later.collect();
  assert.equal(filtered, 2);
  assert.equal(s.dataAvailable, false);
  assert.equal(s.tokenNeedsRenewal, true);
  assert.ok(
    s.sources.some(
      x =>
        x.source === "meta.auth" &&
        x.state === "unavailable" &&
        x.reason === "meta_token_expired"
    )
  );
  assert.ok(
    !later.calls.some(
      c =>
        c.url.pathname.endsWith("/adsets") ||
        c.url.pathname.endsWith("/recommendations")
    )
  );
});

test("public default collector third-argument abort prevents every outbound read", async () => {
  const abort = new AbortController();
  abort.abort();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw Error("must not read");
  }) as typeof fetch;
  try {
    await assert.rejects(
      collectAdsSnapshot("lm-kr", NOW, abort.signal),
      /source_deadline/
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("only operator-verified renewed data-access expiry clears renewal; account expiry can only tighten", async () => {
  const now = new Date("2026-11-20T12:00:00Z"),
    renewed = setup();
  renewed.deps.env.META_ADS_DATA_ACCESS_EXPIRES_ON = "2027-02-24";
  const s = await renewed.collect(now);
  assert.equal(s.tokenExpiresOn, "2027-02-24");
  assert.equal(s.tokenNeedsRenewal, false);
  assert.ok(s.sources.some(x => x.source === "meta.auth" && x.state === "ok"));
  assert.ok(!s.alerts.some(a => a.kind === "token_renewal"));
  const unchanged = await setup().collect(now);
  assert.equal(unchanged.tokenExpiresOn, "2026-11-24");
  assert.equal(unchanged.tokenNeedsRenewal, true);
  for (const invalid of ["2027-02-30", "2027-2-24", "garbage"]) {
    const m = setup();
    m.deps.env.META_ADS_DATA_ACCESS_EXPIRES_ON = invalid;
    const invalidSnapshot = await m.collect(now);
    assert.equal(invalidSnapshot.tokenExpiresOn, "2026-11-24");
    assert.equal(invalidSnapshot.tokenNeedsRenewal, true);
    assert.ok(
      invalidSnapshot.sources.some(
        x => x.source === "meta.data_access_expiry" && x.state === "partial"
      )
    );
  }
  for (const actual of ["2026-11-24", "2027-04-24"]) {
    const m = setup(url =>
      url.pathname.endsWith("/act_999")
        ? response({
            id: "act_999",
            account_status: 1,
            currency: "USD",
            user_access_expire_time:
              Date.parse(`${actual}T00:00:00+09:00`) / 1000,
          })
        : undefined
    );
    m.deps.env.META_ADS_DATA_ACCESS_EXPIRES_ON = "2027-02-24";
    const result = await m.collect(now);
    assert.equal(
      result.tokenExpiresOn,
      actual === "2026-11-24" ? actual : "2027-02-24"
    );
    assert.equal(result.tokenNeedsRenewal, actual === "2026-11-24");
  }
  const expired = setup(url =>
    url.pathname.endsWith("/me")
      ? response({ error: { code: 190, error_subcode: 463 } }, 400)
      : undefined
  );
  expired.deps.env.META_ADS_DATA_ACCESS_EXPIRES_ON = "2027-02-24";
  assert.equal((await expired.collect(now)).tokenNeedsRenewal, true);
});
