import { createHash, randomUUID } from "node:crypto";
import type {
  AdsAlert,
  AdsFact,
  AdsMarket,
  AdsOpinion,
  AdsSnapshot,
  AdsSource,
  MetaSignal,
} from "../shared/ads-analysis";
import { dailyFetch } from "./daily-bridge";
import { inventoryFromSheet, type InventoryRow } from "../shared/inventory";
import { readAdsOrders, createAdsOrdersReader } from "./ads-orders";

// Primary Meta SDK evidence (GET insights/recommendations; current SDK pin v26.0):
// https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py
// https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccountrecommendations.py
// https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py
// No async insights jobs: those require a write. No access_token/input_token query parameters.
export interface AdsMarketMapping {
  verified: boolean;
  campaignIds: string[];
  adsetProducts?: Record<
    string,
    {
      sku: string;
      location: InventoryRow["location"];
      lowStockThreshold?: number;
    }
  >;
  budgetMinorDivisor?: number; // Operator-verified account currency units; never guessed.
}
export interface AdsOrderRow {
  id: string;
  channel: "shopify" | "cafe24";
  market: AdsMarket;
  createdAt: string;
  paid: boolean;
  revenue?: number | null;
  currency?: string;
  utmCampaignId?: string;
  utmSource?: string;
}
export interface AdsOrdersRead {
  state: AdsSource["state"];
  rows: AdsOrderRow[];
  channels?: Partial<
    Record<
      AdsOrderRow["channel"],
      { state: AdsSource["state"]; reason?: string }
    >
  >;
}
export interface AdsCollectorDeps {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  marketMappings?: Partial<Record<AdsMarket, AdsMarketMapping>>;
  readOrders(
    market: AdsMarket,
    since: string,
    until: string,
    signal?: AbortSignal
  ): Promise<AdsOrdersRead>;
  readInventory(
    market: AdsMarket,
    signal?: AbortSignal
  ): Promise<InventoryRow[]>;
  signal?: AbortSignal;
}
const FALLBACK_EXPIRY = "2026-11-24";
const DAY = 86_400_000;
class SourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const numeric = (v: unknown): number | undefined => {
  if (
    typeof v !== "number" &&
    !(typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v))
  )
    return;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const numericId = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,40}$/.test(v);
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Choose the daily reporting date in KST, including runs before 09:00 KST.
// Commerce readers receive these date literals and use documented UTC day boundaries.
const date = (now: Date, daysAgo: number) =>
  new Date(now.getTime() + 9 * 3_600_000 - daysAgo * DAY)
    .toISOString()
    .slice(0, 10);
const reason = (e: unknown) =>
  e instanceof SourceError ? e.code : "source_read_failed";
const safeText = (text: string, secret: string) =>
  text
    .replaceAll(secret || "\u0000", "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]")
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[redacted phone]")
    .replace(/https?:\/\/\S+/g, "[external URL omitted]")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, 1000);

export function createAdsCollector(overrides: Partial<AdsCollectorDeps> = {}) {
  const deps: AdsCollectorDeps = {
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    // Pixel events are NOT actual orders. Reuse the dedicated authoritative reader.
    readOrders: readAdsOrders,
    readInventory: async () =>
      inventoryFromSheet(
        (await dailyFetch(
          `/api/sheet/${encodeURIComponent("재고관리")}?brand=lumen`,
          15_000
        )) as { headers: string[]; rows: unknown[][] }
      ),
    ...overrides,
  };
  if (
    !overrides.readOrders &&
    (overrides.env || overrides.fetch || overrides.signal)
  )
    deps.readOrders = createAdsOrdersReader({
      env: deps.env,
      fetch: deps.fetch,
      signal: deps.signal,
    });
  const checkAbort = () => {
    if (deps.signal?.aborted) throw new SourceError("source_deadline");
  };
  async function collectAdsSnapshot(
    market: AdsMarket,
    now = new Date()
  ): Promise<AdsSnapshot> {
    checkAbort();
    if (!["lm-kr", "lm-gl"].includes(market) || !Number.isFinite(now.getTime()))
      throw new SourceError("invalid_snapshot_request");
    const checkedAt = now.toISOString(),
      facts: AdsFact[] = [],
      sources: AdsSource[] = [],
      signals: MetaSignal[] = [];
    let tokenExpiresOn = FALLBACK_EXPIRY;
    let tokenExpiryMs = Date.parse(`${FALLBACK_EXPIRY}T00:00:00+09:00`);
    const token = deps.env.META_ADS_TOKEN || "",
      account = deps.env.META_AD_ACCOUNT_ID || "",
      version = deps.env.META_ADS_API_VERSION || "v26.0";
    const source = (name: string, state: AdsSource["state"], why?: string) =>
      sources.push({
        source: name,
        state,
        ...(why ? { reason: why } : {}),
        checkedAt,
      });
    const verifiedExpiry = deps.env.META_ADS_DATA_ACCESS_EXPIRES_ON;
    if (verifiedExpiry) {
      const expiry = Date.parse(`${verifiedExpiry}T00:00:00+09:00`);
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(verifiedExpiry) &&
        Number.isFinite(expiry) &&
        new Date(expiry + 9 * 3_600_000).toISOString().slice(0, 10) ===
          verifiedExpiry
      ) {
        tokenExpiresOn = verifiedExpiry;
        tokenExpiryMs = expiry;
        source(
          "meta.data_access_expiry",
          "ok",
          "operator_verified_data_access_expiry"
        );
      } else
        source(
          "meta.data_access_expiry",
          "partial",
          "invalid_data_access_expiry_using_default"
        );
    } else
      source(
        "meta.data_access_expiry",
        "ok",
        "configured_default_data_access_expiry"
      );
    const fact = (
      sourceName: string,
      metric: string,
      value: unknown,
      entityId: string,
      period: string,
      unit: AdsFact["unit"],
      currency?: string
    ) => {
      const n = numeric(value);
      if (n === undefined) return;
      facts.push({
        id: sha([sourceName, metric, entityId, period, currency]).slice(0, 24),
        source: sourceName,
        metric,
        value: n,
        entityId,
        period,
        unit,
        ...(currency ? { currency } : {}),
      });
    };
    let mappings = deps.marketMappings;
    if (!mappings && deps.env.META_ADS_MARKET_MAPPINGS) {
      try {
        mappings = JSON.parse(deps.env.META_ADS_MARKET_MAPPINGS);
      } catch {
        source("market_mapping", "unavailable", "market_mapping_invalid");
      }
    }
    const mapping = mappings?.[market],
      other = mappings?.[market === "lm-kr" ? "lm-gl" : "lm-kr"];
    const mapped =
      !!mapping &&
      mapping.verified === true &&
      Array.isArray(mapping.campaignIds) &&
      mapping.campaignIds.length > 0 &&
      mapping.campaignIds.every(numericId) &&
      new Set(mapping.campaignIds).size === mapping.campaignIds.length &&
      !(
        other &&
        (!Array.isArray(other.campaignIds) ||
          mapping.campaignIds.some(id => other.campaignIds.includes(id)))
      );
    source(
      "market_mapping",
      mapped ? "ok" : "unavailable",
      mapped ? undefined : "market_mapping_missing_or_overlapping"
    );
    const configured =
      !!token && /^act_\d{1,40}$/.test(account) && /^v\d{2}\.0$/.test(version);
    source(
      "meta.config",
      configured ? "ok" : "unavailable",
      configured
        ? `api_version_${version}`
        : "meta_credentials_or_version_unconfigured"
    );
    const prefix = `/${version}`,
      root = `${prefix}/${account}`;
    let authenticated = false;
    const allowed = new Set([
      `${prefix}/me`,
      root,
      `${root}/insights`,
      `${root}/adsets`,
      `${root}/recommendations`,
    ]);
    async function get(
      path: string,
      params: Record<string, string>
    ): Promise<any> {
      checkAbort();
      if (!configured)
        throw new SourceError("meta_credentials_or_version_unconfigured");
      if (
        !allowed.has(path) ||
        Object.keys(params).some(k =>
          ["access_token", "input_token", "method", "batch"].includes(k)
        )
      )
        throw new SourceError("meta_request_not_allowed");
      const url = new URL(`https://graph.facebook.com${path}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      for (let attempt = 0; attempt < 3; attempt++) {
        checkAbort();
        let response: Response;
        try {
          response = await deps.fetch(url.href, {
            method: "GET",
            redirect: "error",
            headers: { Authorization: `Bearer ${token}` },
            signal: deps.signal
              ? AbortSignal.any([deps.signal, AbortSignal.timeout(20_000)])
              : AbortSignal.timeout(20_000),
          });
        } catch {
          throw new SourceError("meta_network_or_deadline");
        }
        checkAbort();
        const text = await response.text();
        checkAbort();
        if (text.length > 4_000_000)
          throw new SourceError("meta_response_too_large");
        let body: any;
        try {
          body = JSON.parse(text);
        } catch {
          if (response.ok) throw new SourceError("meta_invalid_response");
        }
        // Graph error 190 commonly arrives with HTTP 400/401. Inspect it before
        // HTTP status/retry decisions, and revoke any earlier successful auth probe.
        if (
          body?.error?.code === 190 ||
          response.status === 401 ||
          response.status === 403
        ) {
          authenticated = false;
          const code =
            body?.error?.code === 190 && body.error.error_subcode === 463
              ? "meta_token_expired"
              : "meta_auth_or_permission_failed";
          const auth = sources.find(s => s.source === "meta.auth");
          if (auth) {
            auth.state = "unavailable";
            auth.reason = code;
          }
          throw new SourceError(code);
        }
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          await deps.sleep(250 * 2 ** attempt);
          continue;
        }
        if (!response.ok) throw new SourceError(`meta_http_${response.status}`);
        if (body?.error)
          throw new SourceError(
            body.error.code === 190
              ? body.error.error_subcode === 463
                ? "meta_token_expired"
                : "meta_auth_or_permission_failed"
              : "meta_provider_error"
          );
        return body;
      }
      throw new SourceError("meta_read_exhausted");
    }
    async function pages(
      path: string,
      params: Record<string, string>
    ): Promise<any[]> {
      const rows: any[] = [],
        seen = new Set<string>();
      let after = "";
      for (let page = 0; page < 100; page++) {
        checkAbort();
        const body = await get(path, {
          ...params,
          ...(after ? { after } : {}),
          limit: "100",
        });
        if (!Array.isArray(body?.data))
          throw new SourceError("meta_invalid_collection");
        rows.push(...body.data);
        if (rows.length > 10_000)
          throw new SourceError("meta_collection_incomplete");
        if (!body.paging?.next) return rows;
        let next: URL;
        try {
          next = new URL(body.paging.next);
        } catch {
          throw new SourceError("meta_untrusted_paging");
        }
        if (
          next.origin !== "https://graph.facebook.com" ||
          next.pathname !== path ||
          next.username ||
          next.password ||
          next.hash
        )
          throw new SourceError("meta_untrusted_paging");
        // Never follow next URLs. Rebuild fixed path/fields/filter/date parameters and ONLY copy a cursor.
        after = body.paging?.cursors?.after || next.searchParams.get("after");
        if (
          typeof after !== "string" ||
          !after ||
          after.length > 2048 ||
          !/^[\w=+/-]+$/.test(after) ||
          seen.has(after)
        )
          throw new SourceError("meta_invalid_paging_cursor");
        seen.add(after);
      }
      throw new SourceError("meta_collection_incomplete");
    }
    try {
      const me = await get(`${prefix}/me`, { fields: "id" });
      if (!numericId(me?.id)) throw new SourceError("meta_invalid_auth_probe");
      authenticated = true;
      source("meta.auth", "ok");
    } catch (e) {
      source("meta.auth", "unavailable", reason(e));
    }
    // debug_token requires input_token in query: incompatible with header-only secrets.
    source(
      "meta.debug_token",
      "unavailable",
      "debug_token_requires_query_secret_use_me_probe"
    );
    // The SDK exposes an ACCOUNT score, not a verified KR/global campaign score.
    // Account-level score reinterpretation would invent a market-specific Meta opinion.
    source(
      "meta.opportunity_score",
      "unavailable",
      "account_score_not_market_scoped"
    );
    source(
      "meta.anomalies",
      "unavailable",
      "no_verified_market_scoped_provider_read_endpoint"
    );
    source(
      "meta.trends",
      "unavailable",
      "no_verified_market_scoped_provider_read_endpoint"
    );
    let currency: string | undefined;
    if (authenticated)
      try {
        const a = await get(root, {
          fields:
            "id,account_status,disable_reason,currency,user_access_expire_time",
        });
        if (a.id !== account) throw new SourceError("meta_account_mismatch");
        currency =
          typeof a.currency === "string" && /^[A-Z]{3}$/.test(a.currency)
            ? a.currency
            : undefined;
        fact(
          "meta.account",
          "account_status",
          a.account_status,
          account,
          "current",
          "account"
        );
        fact(
          "meta.account",
          "disable_reason",
          a.disable_reason,
          account,
          "current",
          "account"
        );
        const expiry = numeric(a.user_access_expire_time);
        if (expiry && expiry * 1000 < tokenExpiryMs) {
          tokenExpiryMs = expiry * 1000;
          tokenExpiresOn = new Date(tokenExpiryMs + 9 * 3_600_000)
            .toISOString()
            .slice(0, 10);
        }
        source("meta.account", "ok");
      } catch (e) {
        source("meta.account", "unavailable", reason(e));
      }
    else source("meta.account", "unavailable", "meta_auth_unavailable");
    if (authenticated)
      try {
        const validMappings = (["lm-kr", "lm-gl"] as const)
          .map(m => mappings?.[m])
          .filter(
            (m): m is AdsMarketMapping =>
              !!m &&
              m.verified === true &&
              Array.isArray(m.campaignIds) &&
              m.campaignIds.length > 0 &&
              m.campaignIds.every(numericId) &&
              new Set(m.campaignIds).size === m.campaignIds.length
          );
        const known = new Set(validMappings.flatMap(m => m.campaignIds));
        // Account-only audit: never expose unmapped IDs/names or assign their market.
        const rows = await pages(`${root}/insights`, {
          fields: "campaign_id,spend,account_currency",
          level: "campaign",
          time_range: JSON.stringify({
            since: date(now, 14),
            until: date(now, 1),
          }),
        });
        const seen = new Set<string>(),
          totals = new Map<string, number>();
        let incomplete = validMappings.length !== 2,
          unmapped = false;
        for (const row of rows) {
          if (!numericId(row.campaign_id) || seen.has(row.campaign_id))
            throw new SourceError("meta_invalid_coverage_entity");
          seen.add(row.campaign_id);
          const spend = numeric(row.spend);
          if (spend === undefined) {
            incomplete = true;
            continue;
          }
          if (known.has(row.campaign_id) || spend === 0) continue;
          unmapped = true;
          const cur =
            typeof row.account_currency === "string" &&
            /^[A-Z]{3}$/.test(row.account_currency)
              ? row.account_currency
              : currency;
          if (!cur) {
            incomplete = true;
            continue;
          }
          totals.set(cur, (totals.get(cur) || 0) + spend);
        }
        for (const [cur, spend] of totals)
          fact(
            "meta.market_coverage",
            "unmapped_spend",
            spend,
            account,
            "current",
            "account",
            cur
          );
        source(
          "meta.market_coverage",
          incomplete || unmapped ? "partial" : "ok",
          unmapped
            ? "unmapped_campaign_spend"
            : incomplete
              ? "coverage_mapping_or_metrics_incomplete"
              : undefined
        );
      } catch (e) {
        source("meta.market_coverage", "unavailable", reason(e));
      }
    else source("meta.market_coverage", "unavailable", "meta_auth_unavailable");
    const usable = authenticated && mapped;
    const filter = JSON.stringify([
      {
        field: "campaign.id",
        operator: "IN",
        value: mapping?.campaignIds || [],
      },
    ]);
    const scopes = [
      ["current", 14, 1],
      ["previous", 28, 15],
    ] as const;
    const purchases = [
      "offsite_conversion.fb_pixel_purchase",
      "omni_purchase",
      "purchase",
    ];
    async function insights(
      level: "campaign" | "adset" | "ad",
      period: string,
      since: number,
      until: number
    ) {
      const name = `meta.insights.${level}.${period}`;
      if (!usable || !authenticated) {
        source(
          name,
          "unavailable",
          !mapped ? "market_mapping_unavailable" : "meta_auth_unavailable"
        );
        return;
      }
      try {
        const rows = await pages(`${root}/insights`, {
          fields:
            "campaign_id,adset_id,ad_id,account_currency,spend,impressions,clicks,ctr,cpc,frequency,actions,cost_per_action_type,purchase_roas",
          level,
          time_range: JSON.stringify({
            since: date(now, since),
            until: date(now, until),
          }),
          filtering: filter,
        });
        if (
          rows.some(
            r =>
              !numericId(r.campaign_id) ||
              !mapping!.campaignIds.includes(r.campaign_id) ||
              !numericId(r[`${level}_id`])
          )
        )
          throw new SourceError("meta_market_or_entity_mismatch");
        const entities = new Set<string>();
        let missing = false;
        for (const row of rows) {
          const entity = `${level}:${row[`${level}_id`]}`;
          if (entities.has(entity))
            throw new SourceError("meta_duplicate_insight_entity");
          entities.add(entity);
        }
        for (const row of rows) {
          const entity = `${level}:${row[`${level}_id`]}`,
            unit = level;
          const cur =
            typeof row.account_currency === "string" &&
            /^[A-Z]{3}$/.test(row.account_currency)
              ? row.account_currency
              : currency;
          for (const metric of [
            "spend",
            "impressions",
            "clicks",
            "ctr",
            "cpc",
            "frequency",
          ]) {
            if (numeric(row[metric]) === undefined) missing = true;
            fact(
              name,
              metric,
              row[metric],
              entity,
              period,
              unit,
              ["spend", "cpc"].includes(metric) ? cur : undefined
            );
          }
          for (const [field, metric] of [
            ["actions", "meta_purchases"],
            ["cost_per_action_type", "cpa"],
            ["purchase_roas", "roas"],
          ] as const) {
            const values = row[field];
            const value = Array.isArray(values)
              ? purchases
                  .map(type => values.find(v => v?.action_type === type))
                  .find(Boolean)
              : undefined;
            if (numeric(value?.value) === undefined) missing = true;
            fact(
              `${name}:${value?.action_type || "missing"}`,
              metric,
              value?.value,
              entity,
              period,
              unit,
              metric === "cpa" ? cur : undefined
            );
          }
        }
        source(
          name,
          missing ? "partial" : "ok",
          missing ? "some_metrics_missing_not_zero" : undefined
        );
      } catch (e) {
        source(name, "unavailable", reason(e));
      }
    }
    for (const level of ["campaign", "adset", "ad"] as const)
      for (const [period, since, until] of scopes)
        await insights(level, period, since, until);
    // Yesterday vs preceding seven complete days, not an ad-level or 14-day CPA proxy.
    await insights("adset", "yesterday", 1, 1);
    await insights("adset", "baseline7", 8, 2);
    if (usable && authenticated)
      try {
        const rows = await pages(`${root}/adsets`, {
          fields: "id,campaign_id,daily_budget",
          filtering: filter,
        });
        for (const row of rows) {
          if (
            !numericId(row.id) ||
            !mapping!.campaignIds.includes(row.campaign_id)
          )
            throw new SourceError("meta_market_or_entity_mismatch");
        }
        for (const row of rows) {
          fact(
            "meta.budget",
            "daily_budget_minor",
            row.daily_budget,
            `adset:${row.id}`,
            "current",
            "adset",
            currency
          );
          if (
            mapping!.budgetMinorDivisor &&
            numeric(row.daily_budget) !== undefined
          )
            fact(
              "meta.budget",
              "daily_budget",
              Number(row.daily_budget) / mapping!.budgetMinorDivisor,
              `adset:${row.id}`,
              "current",
              "adset",
              currency
            );
        }
        source("meta.budget", "ok");
      } catch (e) {
        source("meta.budget", "unavailable", reason(e));
      }
    else source("meta.budget", "unavailable", "market_or_auth_unavailable");
    if (usable && authenticated)
      try {
        const rows = await pages(`${root}/recommendations`, {
          fields: "recommendations",
        });
        let rejected = false;
        for (const row of rows)
          for (const recommendation of Array.isArray(row.recommendations)
            ? row.recommendations
            : []) {
            // Account recommendation objects are provider-defined. Preserve only explicit mapped
            // campaign/adset text; do not invent advice from names, scores, codes or ad recommendations.
            const campaignId = recommendation.campaign_id,
              adsetId = recommendation.adset_id;
            const entity =
              numericId(adsetId) &&
              facts.some(f => f.entityId === `adset:${adsetId}`)
                ? `adset:${adsetId}`
                : numericId(campaignId) &&
                    mapping!.campaignIds.includes(campaignId)
                  ? `campaign:${campaignId}`
                  : undefined;
            const text =
              typeof recommendation.message === "string"
                ? recommendation.message
                : typeof recommendation.title === "string"
                  ? recommendation.title
                  : undefined;
            if (!entity || !text) {
              rejected = true;
              continue;
            }
            const clean = safeText(text, token);
            signals.push({
              id: sha([entity, clean]).slice(0, 24),
              text: clean,
              entityId: entity,
              factIds: [],
            });
          }
        source(
          "meta.recommendations",
          rejected ? "partial" : "ok",
          rejected ? "unmapped_or_unsupported_signal_shape" : undefined
        );
      } catch (e) {
        source("meta.recommendations", "unavailable", reason(e));
      }
    else
      source(
        "meta.recommendations",
        "unavailable",
        "market_or_auth_unavailable"
      );
    if (mapped)
      try {
        checkAbort();
        const result = await deps.readOrders(
          market,
          date(now, 28),
          date(now, 1),
          deps.signal
        );
        checkAbort();
        for (const channel of ["shopify", "cafe24"] as const) {
          const detail = result.channels?.[channel];
          if (detail)
            source(
              `commerce.${channel}`,
              detail.state,
              detail.state === "ok"
                ? undefined
                : "channel_orders_or_utm_incomplete"
            );
        }
        if (result.state === "unavailable" || !Array.isArray(result.rows))
          throw new SourceError("actual_orders_utm_unavailable");
        const unique = new Set<string>();
        let incomplete = result.state === "partial";
        const totals = new Map<
          string,
          {
            count: number;
            utm: number;
            utmKnown: boolean;
            revenue: Map<string, number>;
          }
        >();
        for (const order of result.rows) {
          if (
            order.market !== market ||
            !["shopify", "cafe24"].includes(order.channel) ||
            !order.id ||
            !Number.isFinite(Date.parse(order.createdAt))
          ) {
            incomplete = true;
            continue;
          }
          if (typeof order.paid !== "boolean") {
            incomplete = true;
            continue;
          }
          if (order.paid !== true) continue;
          const time = Date.parse(order.createdAt),
            end = Date.parse(`${date(now, 0)}T00:00:00Z`),
            start = Date.parse(`${date(now, 28)}T00:00:00Z`);
          if (time < start || time >= end) continue;
          const key = `${order.channel}:${order.id}`;
          if (unique.has(key)) continue;
          unique.add(key);
          const period =
            time >= Date.parse(`${date(now, 14)}T00:00:00Z`)
              ? "current"
              : "previous";
          const t = totals.get(period) || {
            count: 0,
            utm: 0,
            utmKnown: true,
            revenue: new Map<string, number>(),
          };
          t.count++;
          if (
            order.utmCampaignId &&
            mapping!.campaignIds.includes(order.utmCampaignId) &&
            ["facebook", "instagram", "meta", "fb", "ig"].includes(
              order.utmSource || ""
            )
          )
            t.utm++;
          if (
            order.utmSource === undefined ||
            (["facebook", "instagram", "meta", "fb", "ig"].includes(
              order.utmSource
            ) &&
              !order.utmCampaignId)
          ) {
            incomplete = true;
            t.utmKnown = false;
          }
          if (
            numeric(order.revenue) !== undefined &&
            /^[A-Z]{3}$/.test(order.currency || "")
          )
            t.revenue.set(
              order.currency!,
              (t.revenue.get(order.currency!) || 0) + Number(order.revenue)
            );
          else incomplete = true;
          totals.set(period, t);
        }
        for (const [period, t] of totals) {
          fact(
            "commerce.orders",
            "actual_paid_orders",
            t.count,
            market,
            period,
            "account"
          );
          if (t.utmKnown)
            fact(
              "commerce.utm",
              "meta_utm_paid_orders",
              t.utm,
              market,
              period,
              "account"
            );
          for (const [cur, value] of t.revenue)
            fact(
              "commerce.orders",
              "actual_paid_revenue",
              value,
              market,
              period,
              "account",
              cur
            );
        }
        source(
          "commerce.orders_utm",
          incomplete ? "partial" : "ok",
          incomplete ? "incomplete_orders_or_revenue" : undefined
        );
      } catch (e) {
        source("commerce.orders_utm", "unavailable", reason(e));
      }
    else
      source(
        "commerce.orders_utm",
        "unavailable",
        "market_mapping_unavailable"
      );
    if (
      mapped &&
      mapping!.adsetProducts &&
      Object.keys(mapping!.adsetProducts).length
    )
      try {
        checkAbort();
        const rows = await deps.readInventory(market, deps.signal);
        checkAbort();
        let missing = false;
        for (const [adsetId, product] of Object.entries(
          mapping!.adsetProducts
        )) {
          if (
            !numericId(adsetId) ||
            !/^[-A-Z0-9_]{1,100}$/i.test(product.sku)
          ) {
            missing = true;
            continue;
          }
          const found = rows.filter(
            r => r.sku === product.sku && r.location === product.location
          );
          if (
            found.length !== 1 ||
            found[0].quantity == null ||
            found[0].basis !== "available" ||
            !Number.isFinite(found[0].quantity)
          ) {
            missing = true;
            continue;
          }
          // Negative available quantity is real evidence, not a missing numeric value.
          const value = found[0].quantity;
          facts.push({
            id: sha(["inventory", adsetId]).slice(0, 24),
            source: "inventory.pms_available",
            metric: "available_stock",
            value,
            entityId: `adset:${adsetId}`,
            period: "current",
            unit: "product",
          });
          if (product.lowStockThreshold !== undefined)
            fact(
              "inventory.mapping",
              "low_stock_threshold",
              product.lowStockThreshold,
              `adset:${adsetId}`,
              "current",
              "product"
            );
        }
        source(
          "inventory",
          missing ? "partial" : "ok",
          missing
            ? "inventory_pool_missing_ambiguous_or_not_available"
            : undefined
        );
      } catch (e) {
        source("inventory", "unavailable", reason(e));
      }
    else
      source(
        "inventory",
        "unavailable",
        "verified_adset_product_mapping_unavailable"
      );
    const tokenNeedsRenewal =
      sources.some(s => s.reason === "meta_token_expired") ||
      now.getTime() >= tokenExpiryMs - 14 * DAY;
    const snapshot: AdsSnapshot = {
      id: randomUUID(),
      market,
      collectedAt: checkedAt,
      hash: "",
      facts,
      sources,
      signals,
      alerts: [],
      dataAvailable:
        authenticated &&
        facts.some(
          f =>
            f.source.startsWith("meta.insights.") &&
            f.unit !== "ad" &&
            f.period === "current" &&
            f.metric === "spend"
        ),
      tokenExpiresOn,
      tokenNeedsRenewal,
    };
    snapshot.alerts = buildAdsAlerts(snapshot);
    snapshot.hash = sha({ ...snapshot, id: undefined, hash: undefined });
    return snapshot;
  }
  return { collectAdsSnapshot };
}

export const collectAdsSnapshot = (
  market: AdsMarket,
  now?: Date,
  signal?: AbortSignal
) => createAdsCollector({ signal }).collectAdsSnapshot(market, now);

export function metaOpinion(snapshot: AdsSnapshot): AdsOpinion {
  const signals = snapshot.signals.filter(
    s => s.entityId && /^(campaign|adset):\d+$/.test(s.entityId)
  );
  const factIds = new Set(signals.flatMap(s => s.factIds));
  return {
    model: "meta",
    state: signals.length ? "ok" : "not_applicable",
    conclusion: signals.length
      ? signals.map(s => s.text).join("\n")
      : "해당 없음",
    evidence: snapshot.facts
      .filter(f => factIds.has(f.id))
      .map(f => ({ factId: f.id, value: f.value })),
    confidence: "unknown",
    actions: [],
    ...(!signals.length ? { reason: "no_supported_mapped_meta_signal" } : {}),
  };
}

export function buildAdsAlerts(snapshot: AdsSnapshot): AdsAlert[] {
  const alerts: AdsAlert[] = [],
    facts = snapshot.facts;
  const add = (
    kind: string,
    message: string,
    used: AdsFact[],
    entityId?: string
  ) =>
    alerts.push({
      id: sha([kind, entityId]).slice(0, 24),
      kind,
      message,
      factIds: used.map(f => f.id),
      ...(entityId ? { entityId } : {}),
    });
  if (snapshot.tokenNeedsRenewal)
    add(
      "token_renewal",
      snapshot.sources.some(s => s.reason === "meta_token_expired")
        ? "메타에서 토큰 만료를 응답했습니다 — 재인증 필요"
        : `메타 토큰 재연장 필요 — 확인된/설정된 만료일 ${snapshot.tokenExpiresOn}`,
      []
    );
  if (
    snapshot.sources.find(s => s.source === "meta.auth")?.state ===
    "unavailable"
  )
    add("auth_unavailable", "메타 인증 실패 — 광고 데이터 없음", []);
  const coverage = snapshot.sources.find(
    s => s.source === "meta.market_coverage"
  );
  if (coverage?.state === "partial")
    add(
      "market_coverage",
      coverage.reason === "unmapped_campaign_spend"
        ? "최근 14일 계정 지출 중 시장 매핑에 없는 캠페인이 있습니다 — 매핑 검증 필요"
        : "계정 캠페인 시장 매핑·지출 확인이 불완전합니다",
      facts.filter(f => f.source === "meta.market_coverage")
    );
  const status = facts.find(f => f.metric === "account_status");
  for (const spend of facts.filter(
    f =>
      f.metric === "spend" &&
      f.period === "current" &&
      f.value > 0 &&
      (f.unit === "adset" || f.unit === "campaign")
  )) {
    if (
      !facts.some(
        f =>
          f.entityId === spend.entityId &&
          f.unit === spend.unit &&
          f.metric === "roas" &&
          f.period === "current"
      )
    )
      add(
        "roas_unavailable",
        "집행액은 확인되지만 ROAS 미제공 — 구매 0건이나 성과 저조로 단정하지 않음",
        [spend],
        spend.entityId
      );
  }
  if (status && status.value !== 1)
    add(
      "account_status",
      "광고 계정이 정상 활성 상태가 아닙니다",
      [status],
      status.entityId
    );
  const disable = facts.find(f => f.metric === "disable_reason");
  if (disable && disable.value !== 0)
    add(
      "account_disabled",
      "광고 계정 정지·결제 상태 확인 필요",
      [disable],
      disable.entityId
    );
  const entities = new Set(
    facts
      .filter(f => f.unit === "adset" || f.unit === "campaign")
      .map(f => f.entityId)
  );
  for (const entity of entities) {
    const find = (metric: string, period = "current") =>
      facts.find(
        f => f.entityId === entity && f.metric === metric && f.period === period
      );
    const freq = find("frequency");
    if (freq && freq.value >= 3.5)
      add("high_frequency", "최근 14일 빈도 3.5 이상", [freq], entity);
    const cpa = find("cpa", "yesterday"),
      baseline = find("cpa", "baseline7");
    if (
      cpa &&
      baseline &&
      baseline.value > 0 &&
      cpa.source.split(":").slice(1).join(":") ===
        baseline.source.split(":").slice(1).join(":") &&
      cpa.value >= baseline.value * 1.4
    )
      add(
        "cpa_spike",
        "어제 CPA가 직전 7일 구매당 평균 비용보다 40% 이상 높습니다",
        [cpa, baseline],
        entity
      );
    const ctr = find("ctr", "yesterday"),
      prev = find("ctr", "baseline7");
    if (ctr && prev && prev.value > 0 && ctr.value <= prev.value * 0.6)
      add(
        "ctr_drop",
        "어제 CTR이 직전 7일 대비 40% 이상 하락했습니다",
        [ctr, prev],
        entity
      );
    const spend = find("spend", "yesterday"),
      budget = find("daily_budget");
    if (
      spend &&
      budget &&
      budget.value > 0 &&
      spend.currency &&
      spend.currency === budget.currency &&
      spend.value > budget.value * 1.3
    )
      add(
        "budget_pace",
        "어제 지출이 현재 확인된 일 예산보다 30% 이상 높습니다",
        [spend, budget],
        entity
      );
    const stock = find("available_stock"),
      threshold = find("low_stock_threshold"),
      spent = find("spend");
    if (
      stock &&
      spent &&
      spent.value > 0 &&
      (stock.value <= 0 || (threshold && stock.value <= threshold.value))
    )
      add(
        stock.value <= 0 ? "out_of_stock_spend" : "low_stock_spend",
        "현재 재고 부족·품절 매핑 상품의 최근 14일 광고 지출이 확인됩니다",
        [stock, spent, ...(threshold ? [threshold] : [])],
        entity
      );
  }
  return alerts;
}
