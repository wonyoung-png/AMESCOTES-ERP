import { restAsServer } from '../auth';
import { FILTER_CODES, type Listing } from '../../shared/product-registration';
import { ChannelError, deadlineSignal } from './common';
import type { ShopifyClient } from './shopify-client';
import { Q } from './shopify-queries';

export interface Mapping { verified: boolean; cafe24?: string; shopify_ref?: string; }
export interface ChannelSettings { filter_mappings: Partial<Record<'material'|'color'|'size'|'design', Record<string, Mapping>>>; }
export interface RegistrationStore {
  settings(signal?: AbortSignal): Promise<ChannelSettings>;
  sisters(ids: string[],signal?: AbortSignal): Promise<Listing[]>;
  images?(listing: string,signal?: AbortSignal): Promise<import('../../shared/product-registration').ListingImage[]>;
}
export const registrationStore: RegistrationStore = {
  async settings(signal) {
    const r = await restAsServer('product_registration_settings?id=eq.default&select=filter_mappings', { signal: deadlineSignal(signal,10_000) });
    if (!r.ok) throw new ChannelError('mapping_store_unconnected');
    return (await r.json())[0] || { filter_mappings: {} };
  },
  async sisters(ids,signal) {
    if (!ids.length) return [];
    // Never interpolate arbitrary IDs into PostgREST's IN grammar.
    if (ids.some(id => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new ChannelError('invalid_sister_listing_id');
    const r = await restAsServer(`product_listings?id=in.(${ids.join(',')})&select=*`, { signal: deadlineSignal(signal,10_000) });
    if (!r.ok) throw new ChannelError('sister_store_unconnected');
    const rows = await r.json();
    if (rows.length !== ids.length) throw new ChannelError('sister_listing_missing');
    return rows.map((row: any) => ({ ...row.payload, ...row }));
  },
  async images(listing,signal) {
    const r = await restAsServer(`product_listing_images?listing_id=eq.${encodeURIComponent(listing)}&order=position.asc,id.asc`, {signal:deadlineSignal(signal,10_000)});
    if (!r.ok) throw new ChannelError('image_store_unconnected');
    return r.json();
  },
};
export async function verifiedFilters(listing: Listing, store: RegistrationStore,signal?: AbortSignal) {
  const settings = await store.settings(signal); const mappings = settings.filter_mappings || {};
  for (const field of ['material', 'color', 'size', 'design'] as const) {
    const candidate = FILTER_CODES[field][listing[field]];
    const mapping = mappings[field]?.[listing[field]];
    if (!candidate || mapping?.verified !== true || mapping.cafe24 !== candidate.cafe24)
      throw new ChannelError(`filter_mapping_unverified_${field}`);
  }
  return mappings;
}
export interface MetafieldValue { namespace: string; key: string; type: string; value: string; }
export async function validatedMetafields(client: ShopifyClient, listing: Listing, store: RegistrationStore): Promise<MetafieldValue[]> {
  const mappings = await verifiedFilters(listing, store);
  const definitions: any[] = []; let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const connection = (await client.query(Q.definitions, { after })).metafieldDefinitions;
    definitions.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after || page === 99) throw new ChannelError('definition_pagination_failed');
    after = connection.pageInfo.endCursor;
  }
  const output: MetafieldValue[] = [];
  async function add(namespace: string, key: string, types: string[], value: string | string[], optional = false) {
    const def = definitions.find(d => d.namespace === namespace && d.key === key);
    if (!def || !types.includes(def.type.name)) throw new ChannelError(`shopify_definition_unverified_${key}`);
    if (optional && (!value || Array.isArray(value) && !value.length)) return;
    const type = def.type.name;
    const refs = type.endsWith('_reference') ? (Array.isArray(value) ? value : [value]) : [];
    for (const ref of refs) {
      const kind = type.includes('metaobject') ? 'Metaobject' : type.includes('product') ? 'Product' : 'MediaImage';
      if (!new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(ref)) throw new ChannelError(`shopify_invalid_reference_${key}`);
      const node = await client.node(ref);
      if (!node || node.id !== ref || kind === 'MediaImage' && node.fileStatus !== 'READY') throw new ChannelError(`shopify_reference_unavailable_${key}`);
      if (kind === 'Metaobject') {
        const permitted = (def.validations || []).find((v: any) => v.name === 'metaobject_definition_id')?.value;
        // All custom refs must be constrained by the merchant's existing definition.
        if (!permitted || node.definition?.id !== permitted) throw new ChannelError(`shopify_metaobject_definition_mismatch_${key}`);
      }
    }
    const values = Array.isArray(value) ? value : [value];
    if (!type.startsWith('list.') && values.length !== 1) throw new ChannelError(`shopify_reference_cardinality_${key}`);
    output.push({ namespace, key, type, value: type.startsWith('list.') ? JSON.stringify(values) : values[0] });
  }
  const sisters = await store.sisters(listing.sister_listing_ids);
  if (sisters.some(s => s.id === listing.id || s.style_name !== listing.style_name || !s.shopify_product_id || s.status === '삭제됨')) throw new ChannelError('shopify_sister_unconnected');
  await add('custom','product_current_color',['single_line_text_field'],listing.color_en);
  await add('custom','product_options',['list.product_reference'],sisters.map(s => s.shopify_product_id!),true);
  await add('custom','product_details',['multi_line_text_field'],listing.details_en);
  await add('custom','product_material',['metaobject_reference','list.metaobject_reference'],mappings.material?.[listing.material]?.shopify_ref || '');
  await add('custom','product_color_chip',['metaobject_reference'],listing.color_chip_ref || mappings.color?.[listing.color]?.shopify_ref || '');
  await add('custom','product_design',['metaobject_reference','list.metaobject_reference'],mappings.design?.[listing.design]?.shopify_ref || '');
  await add('custom','product_part_description',['list.metaobject_reference'],listing.part_description_refs,true);
  await add('custom','payment_delivery',['metaobject_reference'],listing.payment_delivery_ref);
  await add('custom','exchange_refund',['metaobject_reference'],listing.exchange_refund_ref);
  await add('custom','list_image',['file_reference'],listing.list_image_ref,true);
  await add('custom','preorder_label',['single_line_text_field'],listing.preorder_enabled ? listing.preorder_label_en : '',true);
  for (const namespace of ['mm-google-shopping','mc-facebook']) await add(namespace,'google_product_category',['single_line_text_field'],listing.google_category);
  return output;
}
