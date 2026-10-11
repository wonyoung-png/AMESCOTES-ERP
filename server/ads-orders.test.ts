import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAdsOrdersReader,
  ADS_ORDERS_QUERY,
  ADS_ORDERS_QUERY_WITHOUT_UTM,
  CAFE24_ORDERS_FIELDS,
} from "./ads-orders";
import type { AdsOrdersOptions } from "./ads-orders";
import type { TokenStore } from "./channels/cafe24-auth";
import { createAdsCollector } from "./ads-data";

const since = "2026-09-13",
  until = "2026-10-10";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test('approved ads reader integrates credential grant without reopening merchant adapters',async()=> {
  let grants=0, reads=0;
  const result=await createAdsOrdersReader({
    env:{SHOPIFY_SHOP_DOMAIN:'fixture.myshopify.com',SHOPIFY_CLIENT_ID:'fixture-id',SHOPIFY_CLIENT_SECRET:'fixture-secret',ADS_COMMERCE_AUTH_ENABLED:'true',PRODUCT_REGISTRATION_WRITES_ENABLED:'true'},
    sleep:async()=>{}, fetch:(async(url,init)=> {
      assert.equal(init?.method,'POST');
      if(String(url).endsWith('/admin/oauth/access_token')) {grants++;return response({access_token:'fixture-token',expires_in:86399});}
      reads++; assert.match(String(init?.body),/query AdsPaidOrders/);assert.doesNotMatch(String(init?.body),/mutation/);
      return response({data:{orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});
    }) as typeof fetch,
  })('lm-gl',since,until);
  assert.equal(grants,1);assert.equal(reads,1);assert.equal(result.channels.shopify.state,'ok');
});
const order = (id = 1, patch: Record<string, unknown> = {}) => ({
  id: `gid://shopify/Order/${id}`,
  createdAt: "2026-10-10T23:59:59Z",
  displayFinancialStatus: "PAID",
  test: false,
  totalPriceSet: {
    presentmentMoney: { amount: "123.45", currencyCode: "USD" },
  },
  shippingAddress: { countryCodeV2: "US" },
  customerJourneySummary: {
    ready: true,
    lastVisit: { utmParameters: { campaign: "123456789", source: "facebook" } },
  },
  ...patch,
});
const page = (
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = null
) => ({ data: { orders: { nodes, pageInfo: { hasNextPage, endCursor } } } });
function reader(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  options: AdsOrdersOptions = {}
) {
  return createAdsOrdersReader({
    env: {
      SHOPIFY_SHOP_DOMAIN: "mock.myshopify.com",
      SHOPIFY_ADMIN_TOKEN: "mock-only",
      PRODUCT_REGISTRATION_WRITES_ENABLED: "true",
      PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED: "true",
    },
    sleep: async () => {},
    now: () => Date.parse("2026-10-11T00:00:00Z"),
    fetch: (async (url, init = {}) =>
      handler(String(url), init)) as typeof fetch,
    ...options,
  });
}

test("real channel client sends only paid-order queries and country projection, never PII or writes", async () => {
  const result = await reader((url, init) => {
    assert.equal(
      url,
      "https://mock.myshopify.com/admin/api/2026-10/graphql.json"
    );
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const { query, variables } = JSON.parse(String(init.body));
    assert.equal(query, ADS_ORDERS_QUERY);
    assert.match(variables.filter, /financial_status:paid test:false/);
    assert.match(variables.filter, /2026-09-13T00:00:00.000Z/);
    assert.match(variables.filter, /2026-10-11T00:00:00.000Z/);
    assert.doesNotMatch(
      query,
      /\b(mutation|customer|name|email|phone|address1|address2|city|zip|billingAddress|lineItems|title)\b/
    );
    assert.match(query, /shippingAddress\s*\{\s*countryCodeV2\s*\}/);
    return response(page([order()]));
  })("lm-gl", since, until);
  assert.equal(result.channels.shopify.state, "ok");
  assert.equal(result.state, "partial"); // Cafe24 absence cannot claim complete two-channel totals.
  assert.deepEqual(result.rows, [
    {
      id: "gid://shopify/Order/1",
      channel: "shopify",
      market: "lm-gl",
      createdAt: "2026-10-10T23:59:59.000Z",
      paid: true,
      revenue: 123.45,
      currency: "USD",
      utmCampaignId: "123456789",
      utmSource: "facebook",
    },
  ]);
  assert.equal(result.channels.cafe24.state, "unavailable");
  assert.equal(
    result.channels.cafe24.reason,
    "cafe24_verified_market_mapping_missing"
  );
});

test("verified KR/non-KR country partitions ignore shop and currency guesses", async () => {
  const nodes = [
    order(1, { shippingAddress: { countryCodeV2: "KR" } }),
    order(2, {
      totalPriceSet: {
        presentmentMoney: { amount: "9000", currencyCode: "KRW" },
      },
    }),
    order(3, { shippingAddress: null }),
    order(4, { shippingAddress: { countryCodeV2: "XX" } }),
  ];
  const read = reader(() => response(page(nodes)));
  const kr = await read("lm-kr", since, until),
    gl = await read("lm-gl", since, until);
  assert.deepEqual(
    kr.rows.map(r => r.id),
    ["gid://shopify/Order/1"]
  );
  assert.deepEqual(
    gl.rows.map(r => r.id),
    ["gid://shopify/Order/2"]
  );
  assert.equal(kr.channels.shopify.state, "partial");
  assert.equal(gl.rows[0].currency, "KRW");
});

test("paid only, test excluded, UTC date boundaries locally checked", async () => {
  const nodes = [
    order(1, { createdAt: `${since}T00:00:00Z` }),
    order(2),
    order(3, { createdAt: "2026-10-11T00:00:00Z" }),
    order(4, { createdAt: "2026-09-12T23:59:59Z" }),
    order(5, { displayFinancialStatus: "PENDING" }),
    order(6, { displayFinancialStatus: "PARTIALLY_PAID" }),
    order(7, { test: true }),
    order(8, { createdAt: "invalid" }),
    order(9, { createdAt: "2026-10-10T20:00:00" }),
  ];
  const result = await reader(() => response(page(nodes)))(
    "lm-gl",
    since,
    until
  );
  assert.deepEqual(
    result.rows.map(r => r.id),
    ["gid://shopify/Order/1", "gid://shopify/Order/2"]
  );
  assert.equal(result.channels.shopify.state, "partial");
});

test("no campaign IDs inferred from names, embedded digits, or product strings; no raw source PII", async () => {
  const campaigns = [
    "LOG MIDDLE",
    "launch-123456789",
    "{{campaign.id}}",
    "123456789",
    "private@example.test",
  ];
  const nodes = campaigns.map((campaign, i) =>
    order(i + 1, {
      customerJourneySummary: {
        ready: true,
        lastVisit: {
          utmParameters: {
            campaign,
            source: i === 4 ? "private@example.test" : "Facebook",
          },
        },
      },
      name: "private@example.test",
      customer: { email: "private@example.test" },
    })
  );
  const result = await reader(() => response(page(nodes)))(
    "lm-gl",
    since,
    until
  );
  assert.deepEqual(
    result.rows.map(r => r.utmCampaignId),
    [undefined, undefined, undefined, "123456789", undefined]
  );
  assert.equal(result.rows[3].utmSource, "facebook");
  assert.doesNotMatch(
    JSON.stringify(result),
    /private@example|LOG MIDDLE|launch-/
  );
  assert.equal(result.channels.shopify.state, "partial");
});

test("journey not ready/null is partial while ready organic absence is not invented attribution", async () => {
  for (const journey of [null, { ready: false }]) {
    const result = await reader(() =>
      response(page([order(1, { customerJourneySummary: journey })]))
    )("lm-gl", since, until);
    assert.equal(result.rows.length, 1);
    assert.equal(result.channels.shopify.state, "partial");
    assert.equal(result.rows[0].utmCampaignId, undefined);
    assert.equal(result.rows[0].utmSource, undefined);
  }
  const result = await reader(() =>
    response(
      page([
        order(1, { customerJourneySummary: { ready: true, lastVisit: null } }),
      ])
    )
  )("lm-gl", since, until);
  assert.equal(result.channels.shopify.state, "ok");
  assert.equal(result.rows[0].utmCampaignId, undefined);
  assert.equal(result.rows[0].utmSource, "non_meta");
});

test("ready non-Meta journeys use a fixed sanitized marker without retaining private sources", async () => {
  const journeys = [
    { ready: true, lastVisit: null },
    { ready: true, lastVisit: { utmParameters: null } },
    {
      ready: true,
      lastVisit: {
        utmParameters: { source: "google", campaign: "organic-search" },
      },
    },
    {
      ready: true,
      lastVisit: {
        utmParameters: {
          source: "private@example.test",
          campaign: "private-campaign",
        },
      },
    },
    {
      ready: true,
      lastVisit: {
        utmParameters: {
          source: "private@example.test",
          campaign: "123456789",
        },
      },
    },
  ];
  const result = await reader(() =>
    response(
      page(
        journeys.map((journey, i) =>
          order(i + 1, { customerJourneySummary: journey })
        )
      )
    )
  )("lm-gl", since, until);
  assert.equal(result.channels.shopify.state, "ok");
  assert.deepEqual(
    result.rows.map(row => row.utmSource),
    journeys.map(() => "non_meta")
  );
  assert.deepEqual(
    result.rows.map(row => row.utmCampaignId),
    [undefined, undefined, undefined, undefined, "123456789"]
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /private@example|private-campaign|organic-search|google/
  );
});

test("ready Meta journeys without explicit numeric campaign remain unknown and partial", async () => {
  for (const campaign of [
    undefined,
    null,
    "",
    "launch-123456789",
    "{{campaign.id}}",
    "private@example.test",
  ]) {
    const result = await reader(() =>
      response(
        page([
          order(1, {
            customerJourneySummary: {
              ready: true,
              lastVisit: { utmParameters: { source: "facebook", campaign } },
            },
          }),
        ])
      )
    )("lm-gl", since, until);
    assert.equal(result.channels.shopify.state, "partial");
    assert.equal(
      result.channels.shopify.reason,
      "shopify_meta_campaign_id_unavailable"
    );
    assert.equal(result.rows[0].utmSource, undefined);
    assert.equal(result.rows[0].utmCampaignId, undefined);
    assert.doesNotMatch(
      JSON.stringify(result),
      /private@example|launch-|campaign\.id/
    );
  }
});

test("reader to collector preserves known non-Meta zero/count and suppresses only unknown attribution", async () => {
  const organic = order(1, {
    customerJourneySummary: { ready: true, lastVisit: null },
  });
  const privateNonMeta = order(2, {
    customerJourneySummary: {
      ready: true,
      lastVisit: {
        utmParameters: {
          source: "private@example.test",
          campaign: "private-campaign",
        },
      },
    },
  });
  const meta = order(3);
  const metaUnknown = order(4, {
    customerJourneySummary: {
      ready: true,
      lastVisit: {
        utmParameters: { source: "facebook", campaign: "launch-123456789" },
      },
    },
  });
  const notReady = order(5, {
    customerJourneySummary: { ready: false, lastVisit: null },
  });
  for (const { nodes, expected } of [
    { nodes: [organic, privateNonMeta], expected: 0 },
    { nodes: [organic, privateNonMeta, meta], expected: 1 },
    { nodes: [organic, metaUnknown], expected: undefined },
    { nodes: [organic, notReady], expected: undefined },
  ]) {
    const readOrders = reader(() => response(page(nodes)));
    const snapshot = await createAdsCollector({
      env: {},
      fetch: (async () => {
        throw Error("unexpected external request");
      }) as typeof fetch,
      sleep: async () => {},
      marketMappings: {
        "lm-gl": { verified: true, campaignIds: ["123456789"] },
      },
      readOrders,
      readInventory: async () => {
        throw Error("unexpected inventory request");
      },
    }).collectAdsSnapshot("lm-gl", new Date("2026-10-11T12:00:00Z"));
    const count = snapshot.facts.find(
      fact =>
        fact.metric === "meta_utm_paid_orders" && fact.period === "current"
    );
    assert.equal(count?.value, expected);
    assert.equal(
      snapshot.facts.find(
        fact =>
          fact.metric === "actual_paid_orders" && fact.period === "current"
      )?.value,
      nodes.length
    );
    assert.equal(
      snapshot.sources.find(source => source.source === "commerce.orders_utm")
        ?.state,
      "partial"
    );
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /private@example|private-campaign|launch-|mock-only/
    );
  }
});

test("UTM access failure falls back to minimal orders and flags partial without forged zero", async () => {
  let calls = 0;
  const result = await reader((_url, init) => {
    const { query } = JSON.parse(String(init.body));
    calls++;
    if (calls === 1)
      return response({
        errors: [
          {
            message: "secret mock-token private@example.test",
            extensions: { code: "ACCESS_DENIED" },
          },
        ],
      });
    assert.equal(query, ADS_ORDERS_QUERY_WITHOUT_UTM);
    return response(page([order()]));
  })("lm-gl", since, until);
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].utmCampaignId, undefined);
  assert.equal(result.rows[0].utmSource, undefined);
  assert.equal(result.channels.shopify.reason, "shopify_utm_unavailable");
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|mock-token|private@example/
  );
});

test("cursor pagination uses returned cursor and suppresses duplicate orders as partial", async () => {
  let calls = 0;
  const result = await reader((_url, init) => {
    const { variables } = JSON.parse(String(init.body));
    if (++calls === 1) {
      assert.equal(variables.after, null);
      return response(page([order()], true, "next-1"));
    }
    assert.equal(variables.after, "next-1");
    return response(page([order(), order(2)]));
  })("lm-gl", since, until);
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.channels.shopify.state, "partial");
});

test("hard 5000 ceiling: exact completed page is complete; an extra page is partial", async () => {
  for (const more of [false, true]) {
    let calls = 0;
    const result = await reader(
      () => {
        const n = ++calls;
        return response(
          page(
            Array.from({ length: 100 }, (_, i) => order((n - 1) * 100 + i + 1)),
            n < 50 || more,
            `cursor-${n}`
          )
        );
      },
      { maxOrders: 999999 }
    )("lm-gl", since, until);
    assert.equal(calls, 50);
    assert.equal(result.rows.length, 5000);
    assert.equal(result.channels.shopify.state, more ? "partial" : "ok");
    if (more)
      assert.equal(
        result.channels.shopify.reason,
        "shopify_orders_limit_reached"
      );
  }
});

test("bounded cursor stalls, malformed pages, and later-page failure preserve prior evidence", async () => {
  for (const mode of ["stalled", "empty", "malformed", "failed"]) {
    let calls = 0;
    const result = await reader(() => {
      if (++calls === 1) return response(page([order()], true, "same"));
      if (mode === "failed") return response({ error: "mock-secret" }, 403);
      if (mode === "malformed")
        return response({ data: { orders: { nodes: null } } });
      if (mode === "empty") return response(page([], true, "different"));
      return response(page([order(2)], true, "same"));
    })("lm-gl", since, until);
    assert.equal(calls, 2);
    assert.equal(result.channels.shopify.state, "partial");
    assert.ok(result.rows.length >= 1);
    assert.doesNotMatch(JSON.stringify(result), /mock-secret/);
  }
});

test("missing/invalid revenue is omitted and partial, never converted to zero or currency converted", async () => {
  for (const amount of [null, "", "bad", "-1", Infinity]) {
    const result = await reader(() =>
      response(
        page([
          order(1, {
            totalPriceSet: {
              presentmentMoney: { amount, currencyCode: "EUR" },
            },
          }),
        ])
      )
    )("lm-gl", since, until);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].revenue, undefined);
    assert.equal(result.rows[0].currency, "EUR");
    assert.equal(result.channels.shopify.state, "partial");
  }
  const result = await reader(() =>
    response(
      page([
        order(1, {
          totalPriceSet: {
            presentmentMoney: { amount: "0.00", currencyCode: "KRW" },
          },
        }),
      ])
    )
  )("lm-gl", since, until);
  assert.equal(result.rows[0].revenue, 0);
  assert.equal(result.channels.shopify.state, "ok");
});

test("complete empty response is distinguished from auth failures and missing configuration", async () => {
  const empty = await reader(() => response(page([])))("lm-gl", since, until);
  assert.equal(empty.channels.shopify.state, "ok");
  assert.deepEqual(empty.rows, []);
  for (const status of [401, 403]) {
    const failed = await reader(() => response({ message: "secret" }, status))(
      "lm-gl",
      since,
      until
    );
    assert.equal(failed.state, "unavailable");
    assert.deepEqual(failed.rows, []);
  }
  let calls = 0;
  const unconfigured = await reader(
    () => {
      calls++;
      throw new Error("should not fetch");
    },
    { env: {} }
  )("lm-gl", since, until);
  assert.equal(calls, 0);
  assert.equal(unconfigured.state, "unavailable");
});

test("429 retries use existing client; aborted reads stop without outbound requests or secrets", async () => {
  let calls = 0;
  const result = await reader(() =>
    ++calls === 1 ? response({}, 429) : response(page([order()]))
  )("lm-gl", since, until);
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 1);
  calls = 0;
  const signal = AbortSignal.abort();
  const canceled = await reader(
    () => {
      calls++;
      throw new Error("secret");
    },
    { signal }
  )("lm-gl", since, until);
  assert.equal(calls, 0);
  assert.equal(canceled.state, "unavailable");
  assert.equal(canceled.channels.shopify.reason, "channel_deadline_exceeded");
});

test("reject invalid windows before network calls, including normalization and query injection", async () => {
  let calls = 0;
  const read = reader(() => {
    calls++;
    throw new Error("should not fetch");
  });
  for (const [start, end] of [
    ["2026-02-30", "2026-03-02"],
    ["2026-09-12", until],
    [until, since],
    ["x OR status:open", until],
  ])
    await assert.rejects(
      read("lm-gl", start, end),
      /ads_orders_invalid_window/
    );
  await assert.rejects(
    read("unknown" as any, since, until),
    /ads_orders_invalid_window/
  );
  assert.equal(calls, 0);
});

test("implementation only imports ads-data types and existing read client, no mutation/token persistence", () => {
  const source = readFileSync(
    new URL("./ads-orders.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /import type\s*\{\s*AdsOrderRow,\s*AdsOrdersRead\s*\}\s*from\s*['"]\.\/ads-data['"]/
  );
  assert.doesNotMatch(
    source,
    /from ['"].*(?:channels\/cafe24['"]|shopify-files|channels\/shopify['"]|registration-store)/
  );
  assert.match(source, /\.token\(false\)/);
  assert.match(source, /PRODUCT_REGISTRATION_WRITES_ENABLED:\s*['"]false['"]/);
  assert.match(
    source,
    /PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED:\s*['"]false['"]/
  );
  assert.doesNotMatch(
    source,
    /dotenv|readFile|\.env\b.*read|console\.|\.claim\(|\.save\(|\.release\(|mutation\s*\{/
  );
});

const cafeMapping = (shopNo = 1, market: "lm-kr" | "lm-gl" = "lm-kr") => ({
  verified: true,
  mallId: "atlm1224",
  shopNo,
  market,
  singleMarket: true,
});
const cafeEnv = {
  SHOPIFY_SHOP_DOMAIN: "mock.myshopify.com",
  SHOPIFY_ADMIN_TOKEN: "mock-only",
  CAFE24_ADS_CLIENT_ID: "mock-app",
  CAFE24_ADS_CLIENT_SECRET: "mock-secret",
};
const tokens: TokenStore = {
  read: async () => ({
    access_token: "mock-only",
    refresh_token: "mock-refresh",
    expires_at: "2099-01-01T00:00:00Z",
  }),
  claim: async () => {
    throw Error("writes forbidden");
  },
  save: async () => {
    throw Error("writes forbidden");
  },
  release: async () => {
    throw Error("writes forbidden");
  },
};
const cafeOrder = (id = 1, patch: Record<string, unknown> = {}) => ({
  shop_no: 1,
  order_id: `20261010-${String(id).padStart(7, "0")}`,
  order_date: "2026-10-10T23:59:59Z",
  paid: "T",
  currency: "KRW",
  actual_order_amount: { payment_amount: "120000.00" },
  ...patch,
});

test("Cafe24 verified shop assignment fetches minimal paid GET fields, actual paid amount, unknown UTM", async () => {
  let gets = 0;
  const read = reader(
    (url, init) => {
      if (url.includes("myshopify.com")) return response(page([]));
      gets++;
      const u = new URL(url),
        p = u.searchParams;
      assert.equal(u.origin, "https://atlm1224.cafe24api.com");
      assert.equal(u.pathname, "/api/v2/admin/orders");
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.redirect, "error");
      assert.equal(
        (init.headers as Record<string, string>)["X-Cafe24-Api-Version"],
        "2026-03-01"
      );
      assert.equal(p.get("fields"), CAFE24_ORDERS_FIELDS);
      assert.equal(p.get("paid"), "T");
      assert.equal(p.get("date_type"), "order_date");
      assert.equal(p.get("shop_no"), "1");
      assert.equal(p.get("start_date"), "2026-09-13T00:00:00.000Z");
      assert.equal(p.get("end_date"), "2026-10-10T23:59:59.999Z");
      assert.doesNotMatch(
        p.get("fields")!,
        /buyer|receiver|email|name|phone|address|inflow|member/
      );
      return response({
        orders: [
          cafeOrder(1, {
            currency: "USD",
            payment_amount: "999",
            billing_name: "secret-pii",
            buyer: { email: "private@example.test" },
          }),
        ],
      });
    },
    { env: cafeEnv, runtimeTokenStore: tokens, cafe24Mappings: [cafeMapping()] }
  );
  const result = await read("lm-kr", since, until);
  assert.equal(gets, 1);
  assert.equal(result.channels.cafe24.state, "partial");
  assert.equal(result.channels.cafe24.reason, "cafe24_utm_unavailable");
  assert.equal(result.channels.cafe24.ordersComplete, true);
  assert.deepEqual(result.rows, [
    {
      id: "1:20261010-0000001",
      channel: "cafe24",
      market: "lm-kr",
      createdAt: "2026-10-10T23:59:59.000Z",
      paid: true,
      revenue: 120000,
      currency: "USD",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret-pii|private@example|999|utmCampaignId/
  );
});

test("Cafe24 configured overseas shop does not guess market from currency", async () => {
  const result = await reader(
    url =>
      url.includes("myshopify.com")
        ? response(page([]))
        : response({ orders: [cafeOrder(1, { shop_no: 2 })] }),
    {
      env: cafeEnv,
      runtimeTokenStore: tokens,
      cafe24Mappings: [cafeMapping(2, "lm-gl")],
    }
  )("lm-gl", since, until);
  assert.equal(result.rows[0].market, "lm-gl");
  assert.equal(result.rows[0].currency, "KRW");
});

test("Cafe24 mapping absent, conflicting, malformed, mixed, or arbitrary mall never reads tokens/orders", async () => {
  const settings: AdsOrdersOptions[] = [
    {},
    { cafe24Mappings: [cafeMapping(), cafeMapping(1, "lm-gl")] },
    { cafe24Mappings: [{ ...cafeMapping(), verified: false }] },
    { cafe24Mappings: [{ ...cafeMapping(), mallId: "attacker" }] },
    { cafe24Mappings: [{ ...cafeMapping(), singleMarket: false }] },
    { env: { ...cafeEnv, CAFE24_ADS_MARKET_MAPPINGS: "bad-json" } },
  ];
  for (const setting of settings) {
    let reads = 0,
      gets = 0;
    const result = await reader(
      url => {
        if (url.includes("myshopify.com")) return response(page([]));
        gets++;
        throw Error("must not fetch");
      },
      {
        env: cafeEnv,
        runtimeTokenStore: {
          ...tokens,
          read: async () => {
            reads++;
            throw Error("must not read");
          },
        },
        ...setting,
      }
    )("lm-kr", since, until);
    assert.equal(gets, 0);
    assert.equal(reads, 0);
    assert.deepEqual(result.channels.cafe24.rows, []);
    assert.notEqual(result.channels.cafe24.state, "ok");
  }
});

test("Cafe24 canonical token is read only: expired access token never rotates even when writes allowed", async () => {
  let gets = 0;
  const result = await reader(
    url => {
      if (url.includes("myshopify.com")) return response(page([]));
      gets++;
      throw Error("must not fetch");
    },
    {
      env: {
        ...cafeEnv,
        PRODUCT_REGISTRATION_WRITES_ENABLED: "true",
        PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED: "true",
      },
      cafe24Mappings: [cafeMapping()],
      runtimeTokenStore: {
        ...tokens,
        read: async () => ({
          access_token: "old",
          refresh_token: "old-r",
          expires_at: "2020-01-01T00:00:00Z",
        }),
      },
    }
  )("lm-kr", since, until);
  assert.equal(gets, 0);
  assert.equal(result.channels.cafe24.state, "unavailable");
  assert.equal(result.channels.cafe24.reason, "cafe24_token_expired_readonly");
});

test("Cafe24 offsets, deduplication, paid/date filtering and combined 5000 budget are bounded", async () => {
  let calls = 0;
  const result = await reader(
    url => {
      if (url.includes("myshopify.com")) return response(page([]));
      const offset = Number(new URL(url).searchParams.get("offset"));
      calls++;
      if (offset === 0)
        return response({
          orders: Array.from({ length: 100 }, (_, i) => cafeOrder(i + 1)),
        });
      assert.equal(offset, 100);
      return response({
        orders: [
          cafeOrder(),
          cafeOrder(101, { paid: "F" }),
          cafeOrder(102, { paid: "M" }),
          cafeOrder(103, { order_date: "2026-10-11T00:00:00Z" }),
          cafeOrder(104),
          cafeOrder(105, { actual_order_amount: {} }),
        ],
      });
    },
    { env: cafeEnv, cafe24Mappings: [cafeMapping()], runtimeTokenStore: tokens }
  )("lm-kr", since, until);
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 102);
  assert.equal(result.rows.at(-1)?.revenue, undefined);
  assert.equal(result.channels.cafe24.ordersComplete, false);
  assert.equal(
    result.channels.cafe24.reason,
    "cafe24_incomplete_orders_and_utm"
  );
  calls = 0;
  const capped = await reader(
    url => {
      if (url.includes("myshopify.com"))
        return response(
          page([order(1, { shippingAddress: { countryCodeV2: "KR" } })])
        );
      calls++;
      assert.equal(new URL(url).searchParams.get("limit"), "1");
      return response({ orders: [cafeOrder()] });
    },
    {
      env: cafeEnv,
      maxOrders: 2,
      cafe24Mappings: [cafeMapping()],
      runtimeTokenStore: tokens,
    }
  )("lm-kr", since, until);
  assert.equal(calls, 1);
  assert.equal(capped.rows.length, 2);
  assert.equal(capped.channels.cafe24.reason, "cafe24_orders_limit_reached");
});

test("Cafe24 env verified mapping supported; read failure is unavailable rather than fake complete zero", async () => {
  const result = await reader(
    url =>
      url.includes("myshopify.com")
        ? response({}, 401)
        : response({ orders: [cafeOrder()] }),
    {
      env: {
        ...cafeEnv,
        CAFE24_ADS_MARKET_MAPPINGS: JSON.stringify([cafeMapping()]),
      },
      runtimeTokenStore: tokens,
    }
  )("lm-kr", since, until);
  assert.equal(result.state, "partial");
  assert.equal(result.rows[0].channel, "cafe24");
  const failed = await reader(
    url =>
      url.includes("myshopify.com")
        ? response({}, 401)
        : response({ message: "private@example.test mock-token" }, 403),
    { env: cafeEnv, cafe24Mappings: [cafeMapping()], runtimeTokenStore: tokens }
  )("lm-kr", since, until);
  assert.equal(failed.state, "unavailable");
  assert.deepEqual(failed.rows, []);
  assert.doesNotMatch(JSON.stringify(failed), /private@example|mock-token/);
});
