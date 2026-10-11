import { assertWrites, ChannelError, json, pause, request, type Runtime, UncertainWrite } from './common';
import { Q, SHOPIFY_API_VERSION } from './shopify-queries';

export function shopifyClient(rt: Runtime, allowCredentialGrant = false) {
  const host = rt.env.SHOPIFY_SHOP_DOMAIN || rt.env.SHOPIFY_STORE_DOMAIN || '';
  const staticToken = rt.env.SHOPIFY_ADMIN_TOKEN || rt.env.SHOPIFY_ACCESS_TOKEN || '';
  const credentialAuth = allowCredentialGrant && rt.env.ADS_COMMERCE_AUTH_ENABLED === 'true' && !!rt.env.SHOPIFY_CLIENT_ID && !!rt.env.SHOPIFY_CLIENT_SECRET;
  const configured = () => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host) && (!!staticToken || credentialAuth) &&
    (!rt.env.SHOPIFY_API_VERSION || rt.env.SHOPIFY_API_VERSION === SHOPIFY_API_VERSION);
  let cachedToken = '', expiresAt = 0, pending: Promise<string> | undefined;
  const token = async (): Promise<string> => {
    if (staticToken) return staticToken;
    if (cachedToken && rt.now() < expiresAt - 60_000) return cachedToken;
    if (pending) return pending;
    // This isolated capability authorizes only the fixed OAuth URL, never product writes.
    pending = (async () => {
      const authRuntime = { ...rt, env: { ...rt.env, PRODUCT_REGISTRATION_WRITES_ENABLED: 'true' } };
      const body = await json(await request(authRuntime, `https://${host}/admin/oauth/access_token`, 'POST', {
        write: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: rt.env.SHOPIFY_CLIENT_ID!, client_secret: rt.env.SHOPIFY_CLIENT_SECRET! }),
      }));
      if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 2048 || /[\s\x00-\x1f\x7f]/.test(body.access_token) ||
          !Number.isInteger(body.expires_in) || body.expires_in <= 60 || body.expires_in > 86_400)
        throw new ChannelError('shopify_invalid_auth_response');
      cachedToken = body.access_token; expiresAt = rt.now() + body.expires_in * 1000;
      return cachedToken;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
  const query = async (document: string, variables: Record<string, unknown> = {}, write = false, replaySafe = false): Promise<any> => {
    if (!configured()) throw new ChannelError('shopify_unconnected_or_version_mismatch');
    if (allowCredentialGrant && (!/^\s*query\b/.test(document) || /\b(?:mutation|subscription)\b/.test(document)))
      throw new ChannelError('shopify_readonly_query_required');
    if (write && allowCredentialGrant) throw new ChannelError('writes_disabled');
    if (write) assertWrites(rt);
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = await json(await request(rt, `https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, 'POST', {
        write, replaySafe, headers: { 'X-Shopify-Access-Token': await token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: document, variables }),
      }));
      if (body.errors?.length) {
        // THROTTLED is a rejected operation, not an uncertain committed mutation.
        if (body.errors.every((e: any) => e.extensions?.code === 'THROTTLED') && attempt < 3) { await pause(rt,1000 * 2 ** attempt); continue; }
        if (write && !replaySafe) throw new UncertainWrite();
        throw new ChannelError('shopify_graphql_failed');
      }
      if (!body.data) { if (write && !replaySafe) throw new UncertainWrite(); throw new ChannelError('shopify_invalid_response'); }
      for (const payload of Object.values(body.data) as any[]) {
        if (payload?.userErrors?.length || payload?.mediaUserErrors?.length) throw new ChannelError('shopify_user_error');
      }
      const budget = body.extensions?.cost?.throttleStatus;
      if (budget && budget.currentlyAvailable < 100) await pause(rt,Math.min(5000, Math.ceil((100 - budget.currentlyAvailable) / Math.max(1, budget.restoreRate) * 1000)));
      return body.data;
    }
    throw new ChannelError('shopify_throttle_exhausted');
  };
  const node = async (id: string) => (await query(Q.reference, { id })).node;
  const product = async (id: string) => {
    const p = (await query(Q.product, { id })).product;
    if (p && ['variants', 'media', 'collections', 'metafields', 'resourcePublicationsV2'].some(k => p[k]?.pageInfo?.hasNextPage)) throw new ChannelError('shopify_product_pagination_unsupported');
    return p;
  };
  return { configured, query, node, product };
}
export type ShopifyClient = ReturnType<typeof shopifyClient>;
