import type { AdsOrderRow, AdsOrdersRead } from "./ads-data";
import type { AdsMarket } from "../shared/ads-analysis";
import {
  ChannelError,
  json,
  pause,
  request,
  runtime,
  type Runtime,
} from "./channels/common";
import { shopifyClient } from "./channels/shopify-client";
import {
  cafe24Auth,
  dbAdsTokenStore as runtimeTokenStore,
  type TokenStore,
} from "./channels/cafe24-auth";
import { cafe24ReadToken } from "./channels/cafe24-connect";

// Official schema, pinned by the existing Shopify client to 2026-10:
// https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders
// https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CustomerJourneySummary
// https://shopify.dev/docs/api/admin-graphql/2026-10/objects/UTMParameters
// Only the country enum is selected from shippingAddress; no address/name/email.
const ORDER_FIELDS = `id createdAt displayFinancialStatus test
  totalPriceSet { presentmentMoney { amount currencyCode } }
  shippingAddress { countryCodeV2 }`;
const JOURNEY_FIELDS = `customerJourneySummary { ready lastVisit { utmParameters { campaign source } } }`;
const query = (
  withJourney: boolean
) => `query AdsPaidOrders($first:Int!,$after:String,$filter:String!) {
  orders(first:$first,after:$after,query:$filter,sortKey:CREATED_AT) {
    nodes { ${ORDER_FIELDS} ${withJourney ? JOURNEY_FIELDS : ""} }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const ADS_ORDERS_QUERY = query(true);
export const ADS_ORDERS_QUERY_WITHOUT_UTM = query(false);
const DAY = 86_400_000;
const MAX_ORDERS = 5000;
const META_SOURCES = new Set(["facebook", "instagram", "meta", "fb", "ig"]);
// Same version/mall as channels/cafe24.ts; do not import its mutation adapter.
const CAFE24_API_VERSION = "2026-03-01";
export const CAFE24_ORDERS_FIELDS =
  "shop_no,order_id,order_date,paid,currency,actual_order_amount";

export interface Cafe24AdsMarketMapping {
  verified: boolean;
  mallId: string;
  shopNo: number;
  market: AdsMarket;
  /** Operator verified that this shop contains only this market, not mixed countries. */
  singleMarket: boolean;
}

export interface AdsOrdersOptions extends Partial<Runtime> {
  /** Can lower the hard cap for tests; cannot raise the 5,000-order ceiling. */
  maxOrders?: number;
  cafe24Mappings?: Cafe24AdsMarketMapping[];
  /** Canonical Cafe24 ERP token store; auth.token(false) never refreshes or writes. */
  runtimeTokenStore?: TokenStore;
}
export interface AdsOrdersChannelRead extends AdsOrdersRead {
  reason?: string;
  ordersComplete?: boolean;
}
export interface AdsOrdersResult extends AdsOrdersRead {
  channels: Record<AdsOrderRow["channel"], AdsOrdersChannelRead>;
}

function windowBounds(market: AdsMarket, since: string, until: string) {
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (
    !["lm-kr", "lm-gl"].includes(market) ||
    !validDate(since) ||
    !validDate(until)
  )
    throw new ChannelError("ads_orders_invalid_window");
  const start = Date.parse(`${since}T00:00:00Z`),
    end = Date.parse(`${until}T00:00:00Z`) + DAY;
  if (end <= start || end - start > 28 * DAY)
    throw new ChannelError("ads_orders_invalid_window");
  return { start, end };
}
function money(value: unknown): number | undefined {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))
  )
    return;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function countryMarket(value: unknown): AdsMarket | undefined {
  if (
    typeof value !== "string" ||
    !/^[A-Z]{2}$/.test(value) ||
    ["ZZ", "XX"].includes(value)
  )
    return;
  // Reject unknown regions rather than classifying a missing/invalid country as overseas.
  if (
    !new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(
      value
    )
  )
    return;
  return value === "KR" ? "lm-kr" : "lm-gl";
}
function failure(error: unknown): string {
  // Never return raw provider bodies, merchant text, URLs, or token-bearing errors.
  if (
    error instanceof ChannelError &&
    /^(shopify_|cafe24_|channel_)[a-z0-9_]+$/.test(error.code)
  )
    return error.code;
  return "ads_orders_read_failed";
}

// Official GET projection/paging and actual_order_amount.payment_amount evidence:
// https://apidocs.cafe24.com/en/docs/guide/how-to-use-get-api
// https://apidocs.cafe24.com/en/docs/2026-06-01/admin/get-orders
// https://apidocs.cafe24.com/en/docs/2026-06-01/admin/get-orders-by-order-id
async function readCafe24(
  rt: Runtime,
  options: AdsOrdersOptions,
  market: AdsMarket,
  start: number,
  end: number,
  budget: number
): Promise<AdsOrdersChannelRead> {
  const rows: AdsOrderRow[] = [];
  let mappings: Cafe24AdsMarketMapping[] | undefined = options.cafe24Mappings;
  if (!mappings && rt.env.CAFE24_ADS_MARKET_MAPPINGS) {
    try {
      mappings = JSON.parse(rt.env.CAFE24_ADS_MARKET_MAPPINGS);
    } catch {
      return {
        state: "unavailable",
        rows,
        reason: "cafe24_market_mapping_invalid",
      };
    }
  }
  if (!Array.isArray(mappings) || !mappings.length)
    return {
      state: "unavailable",
      rows,
      reason: "cafe24_verified_market_mapping_missing",
    };
  // One fixed merchant token cannot authorize arbitrary mall hosts. A shop must be
  // uniquely mapped across BOTH markets to avoid double counting/contradictory mapping.
  const shops = new Set<number>();
  for (const m of mappings) {
    if (
      !m ||
      m.verified !== true ||
      m.mallId !== "atlm1224" ||
      !Number.isSafeInteger(m.shopNo) ||
      m.shopNo < 1 ||
      !["lm-kr", "lm-gl"].includes(m.market) ||
      typeof m.singleMarket !== "boolean" ||
      shops.has(m.shopNo) ||
      mappings.length > 20
    )
      return {
        state: "unavailable",
        rows,
        reason: "cafe24_market_mapping_invalid",
      };
    shops.add(m.shopNo);
  }
  const selected = mappings.filter(m => m.market === market);
  if (!selected.length)
    return {
      state: "unavailable",
      rows,
      reason: "cafe24_verified_market_mapping_missing",
    };
  if (selected.some(m => !m.singleMarket))
    return {
      state: "partial",
      rows,
      reason: "cafe24_mixed_country_shop_unsupported",
    };
  if (budget <= 0)
    return { state: "partial", rows, reason: "cafe24_orders_limit_reached" };
  let scanned = 0,
    completedShops = 0,
    invalid = false;
  const ids = new Set<string>();
  try {
    if (rt.signal?.aborted) throw new ChannelError("channel_deadline_exceeded");
    const allowRefresh = rt.env.CAFE24_ADS_OAUTH_REFRESH_ENABLED === "true";
    const token = await cafe24Auth(
      { ...rt, env: { ...rt.env, CAFE24_ERP_CLIENT_ID: rt.env.CAFE24_ADS_CLIENT_ID,
        CAFE24_ERP_CLIENT_SECRET: rt.env.CAFE24_ADS_CLIENT_SECRET,
        PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED: allowRefresh ? "true" : "false" } },
      options.runtimeTokenStore ?? runtimeTokenStore, cafe24ReadToken
    ).token(allowRefresh);
    for (const mapping of selected) {
      let offset = 0;
      for (;;) {
        if (scanned >= budget)
          return {
            state: "partial",
            rows,
            reason: "cafe24_orders_limit_reached",
          };
        const limit = Math.min(100, budget - scanned);
        const params = new URLSearchParams({
          shop_no: String(mapping.shopNo),
          fields: CAFE24_ORDERS_FIELDS,
          paid: "T",
          date_type: "order_date",
          start_date: new Date(start).toISOString(),
          end_date: new Date(end - 1).toISOString(),
          limit: String(limit),
          offset: String(offset),
        });
        await pause(rt, 500);
        const data = await json(
          await request(
            rt,
            `https://atlm1224.cafe24api.com/api/v2/admin/orders?${params}`,
            "GET",
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "X-Cafe24-Api-Version": CAFE24_API_VERSION,
              },
            }
          )
        );
        if (!Array.isArray(data?.orders) || data.orders.length > limit)
          throw new ChannelError("cafe24_orders_invalid_response");
        scanned += data.orders.length;
        let newIds = 0;
        for (const order of data.orders) {
          if (
            !order ||
            typeof order.order_id !== "string" ||
            !/^\d{8}-\d{7,20}$/.test(order.order_id) ||
            Number(order.shop_no) !== mapping.shopNo
          ) {
            invalid = true;
            continue;
          }
          // Namespace IDs by shop; the channel prefix is added by the ads-data consumer.
          const id = `${mapping.shopNo}:${order.order_id}`;
          if (ids.has(id)) {
            invalid = true;
            continue;
          }
          ids.add(id);
          newIds++;
          if (order.paid !== "T") {
            invalid = true;
            continue;
          }
          const time =
            typeof order.order_date === "string" &&
            /(?:Z|[+-]\d{2}:\d{2})$/.test(order.order_date)
              ? Date.parse(order.order_date)
              : NaN;
          if (!Number.isFinite(time) || time < start || time >= end) {
            invalid = true;
            continue;
          }
          const revenue = money(order.actual_order_amount?.payment_amount);
          const currency =
            typeof order.currency === "string" &&
            /^[A-Z]{3}$/.test(order.currency)
              ? order.currency
              : undefined;
          if (revenue === undefined || !currency) invalid = true;
          rows.push({
            id,
            channel: "cafe24",
            market: mapping.market,
            createdAt: new Date(time).toISOString(),
            paid: true,
            ...(revenue === undefined ? {} : { revenue }),
            ...(currency ? { currency } : {}),
          });
          // Never request buyer/receivers/inflow text or infer UTM from order/product names.
        }
        if (data.orders.length < limit) {
          completedShops++;
          break;
        }
        if (!newIds) throw new ChannelError("cafe24_orders_pagination_stalled");
        offset += data.orders.length;
      }
    }
    // UTM is unsupported even when paid totals are complete. No inferred zero attribution.
    return {
      state: "partial",
      rows,
      ordersComplete: !invalid,
      reason: invalid
        ? "cafe24_incomplete_orders_and_utm"
        : "cafe24_utm_unavailable",
    };
  } catch (error) {
    return {
      state: scanned > 0 || completedShops > 0 ? "partial" : "unavailable",
      rows,
      reason: failure(error),
    };
  }
}

/** Reuses channel runtime/auth; imports no commerce mutation adapters or persistence writers. */
export function createAdsOrdersReader(options: AdsOrdersOptions = {}) {
  const cap = Math.max(
    1,
    Math.min(MAX_ORDERS, Math.floor(options.maxOrders || MAX_ORDERS))
  );
  return async function read(
    market: AdsMarket,
    since: string,
    until: string
  ): Promise<AdsOrdersResult> {
    const { start, end } = windowBounds(market, since, until);
    const deadline = AbortSignal.timeout(120_000);
    const rt = runtime({
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
      env: {
        ...(options.env ?? process.env),
        PRODUCT_REGISTRATION_WRITES_ENABLED: "false",
        PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED: "false",
      },
    });
    const client = shopifyClient(rt, true);
    const rows: AdsOrderRow[] = [];
    let complete = false,
      partial = false,
      reason: string | undefined;
    let after: string | null = null,
      scanned = 0,
      withJourney = true;
    const seenIds = new Set<string>(),
      cursors = new Set<string>();
    // Inclusive dates match ads-data's [since midnight, until+1 midnight) UTC window.
    const filter = `financial_status:paid test:false created_at:>='${new Date(start).toISOString()}' created_at:<'${new Date(end).toISOString()}'`;
    try {
      if (!client.configured())
        throw new ChannelError("shopify_unconnected_or_version_mismatch");
      while (scanned < cap) {
        const first = Math.min(100, cap - scanned);
        const variables = { first, after, filter };
        let data: any;
        try {
          data = await client.query(
            withJourney ? ADS_ORDERS_QUERY : ADS_ORDERS_QUERY_WITHOUT_UTM,
            variables
          );
        } catch (error) {
          if (
            !withJourney ||
            !(error instanceof ChannelError) ||
            error.code !== "shopify_graphql_failed"
          )
            throw error;
          // Journey access/availability can fail independently of paid-order reads.
          // A second minimal read still must succeed; permission failure is never a zero.
          withJourney = false;
          partial = true;
          reason = "shopify_utm_unavailable";
          data = await client.query(ADS_ORDERS_QUERY_WITHOUT_UTM, variables);
        }
        const connection = data?.orders;
        if (
          !Array.isArray(connection?.nodes) ||
          connection.nodes.length > first ||
          typeof connection.pageInfo?.hasNextPage !== "boolean"
        )
          throw new ChannelError("shopify_orders_invalid_response");
        scanned += connection.nodes.length;
        for (const order of connection.nodes) {
          if (
            !order ||
            typeof order.id !== "string" ||
            !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)
          ) {
            partial = true;
            continue;
          }
          if (seenIds.has(order.id)) {
            partial = true;
            continue;
          }
          seenIds.add(order.id);
          if (
            typeof order.test !== "boolean" ||
            typeof order.displayFinancialStatus !== "string"
          ) {
            partial = true;
            continue;
          }
          if (order.test || order.displayFinancialStatus !== "PAID") continue;
          const time =
            typeof order.createdAt === "string" &&
            /(?:Z|[+-]\d{2}:\d{2})$/.test(order.createdAt)
              ? Date.parse(order.createdAt)
              : NaN;
          if (!Number.isFinite(time)) {
            partial = true;
            continue;
          }
          if (time < start || time >= end) {
            partial = true;
            continue;
          }
          const verifiedMarket = countryMarket(
            order.shippingAddress?.countryCodeV2
          );
          if (!verifiedMarket) {
            partial = true;
            reason ??= "shopify_order_country_unknown";
            continue;
          }
          if (verifiedMarket !== market) continue;
          const paidMoney = order.totalPriceSet?.presentmentMoney;
          const revenue = money(paidMoney?.amount);
          const currency =
            typeof paidMoney?.currencyCode === "string" &&
            /^[A-Z]{3}$/.test(paidMoney.currencyCode)
              ? paidMoney.currencyCode
              : undefined;
          if (revenue === undefined || !currency) partial = true;
          const row: AdsOrderRow = {
            id: order.id,
            channel: "shopify",
            market: verifiedMarket,
            createdAt: new Date(time).toISOString(),
            paid: true,
            ...(revenue === undefined ? {} : { revenue }),
            ...(currency ? { currency } : {}),
          };
          const journey = order.customerJourneySummary;
          if (withJourney && journey?.ready !== true) {
            partial = true;
            reason ??= "shopify_utm_not_ready";
          }
          if (withJourney && journey?.ready === true) {
            const utm = journey.lastVisit?.utmParameters;
            const source =
              typeof utm?.source === "string" ? utm.source.toLowerCase() : "";
            // Ready organic/other journeys are known non-Meta, including no last visit.
            // Store only this fixed marker; never copy a private provider source string.
            if (!META_SOURCES.has(source)) row.utmSource = "non_meta";
            // Campaign must be an explicit numeric ID, never a name, embedded ID, or product text.
            if (
              typeof utm?.campaign === "string" &&
              /^\d{1,40}$/.test(utm.campaign)
            ) {
              row.utmCampaignId = utm.campaign;
              if (META_SOURCES.has(source)) row.utmSource = source;
            } else if (META_SOURCES.has(source)) {
              partial = true;
              reason ??= "shopify_meta_campaign_id_unavailable";
            }
          }
          rows.push(row);
        }
        if (!connection.pageInfo.hasNextPage) {
          complete = true;
          break;
        }
        const cursor = connection.pageInfo.endCursor;
        if (
          !connection.nodes.length ||
          typeof cursor !== "string" ||
          !cursor ||
          cursors.has(cursor)
        )
          throw new ChannelError("shopify_orders_pagination_invalid");
        cursors.add(cursor);
        after = cursor;
      }
      if (!complete) {
        partial = true;
        reason = "shopify_orders_limit_reached";
      }
    } catch (error) {
      partial = true;
      reason = failure(error);
    }
    const shopify: AdsOrdersChannelRead = {
      state: complete
        ? partial
          ? "partial"
          : "ok"
        : scanned > 0
          ? "partial"
          : "unavailable",
      rows,
      ...(reason ? { reason } : {}),
    };
    const cafe24 = await readCafe24(
      rt,
      options,
      market,
      start,
      end,
      cap - scanned
    );
    return {
      state:
        shopify.state === "unavailable" && cafe24.state === "unavailable"
          ? "unavailable"
          : "partial",
      rows: [...rows, ...cafe24.rows],
      channels: { shopify, cafe24 },
    };
  };
}

export async function readAdsOrders(
  market: AdsMarket,
  since: string,
  until: string
): Promise<AdsOrdersRead> {
  return createAdsOrdersReader()(market, since, until);
}
