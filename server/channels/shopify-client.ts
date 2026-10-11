import { assertWrites, ChannelError, json, pause, request, type Runtime, UncertainWrite } from './common';
import { Q, SHOPIFY_API_VERSION } from './shopify-queries';

export function shopifyClient(rt: Runtime) {
  const host = rt.env.SHOPIFY_SHOP_DOMAIN || rt.env.SHOPIFY_STORE_DOMAIN || '';
  const token = rt.env.SHOPIFY_ADMIN_TOKEN || rt.env.SHOPIFY_ACCESS_TOKEN || '';
  const configured = () => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host) && !!token &&
    (!rt.env.SHOPIFY_API_VERSION || rt.env.SHOPIFY_API_VERSION === SHOPIFY_API_VERSION);
  const query = async (document: string, variables: Record<string, unknown> = {}, write = false, replaySafe = false): Promise<any> => {
    if (!configured()) throw new ChannelError('shopify_unconnected_or_version_mismatch');
    if (write) assertWrites(rt);
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = await json(await request(rt, `https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, 'POST', {
        write, replaySafe, headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
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
