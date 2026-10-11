import type { Listing, Channel } from '../../shared/product-registration';
import type { ChannelSnapshot, ShopMonitorReader } from '../shop-monitor';
import { cafe24Adapter } from './cafe24';
import { shopifyClient } from './shopify-client';
import { Q } from './shopify-queries';
import { request, runtime, type Runtime } from './common';
import { registrationStore, verifiedFilters, type RegistrationStore } from './settings';
import type { TokenStore } from './cafe24-auth';
declare module '../shop-monitor' { interface ChannelSnapshot { unsupported?: string[]; } }

// Merchant reads only. OAuth can rotate solely under its separate explicit capability.
export function createMonitorReader(overrides: Partial<Runtime> = {}, store: RegistrationStore = registrationStore, tokens?: TokenStore): ShopMonitorReader {
  return async (listing: Listing, channel: Channel, signal: AbortSignal): Promise<ChannelSnapshot> => {
    const rt = runtime({...overrides,signal});
    signal.throwIfAborted();
    async function status(value: string, image = false) {
      let url: URL;
      try { url = new URL(value,'https://atlm.kr'); } catch { return undefined; }
      const allowed = channel === 'cafe24' ? url.hostname === 'atlm.kr' || /(^|\.)cafe24\.com$/.test(url.hostname) || /(^|\.)echosting\.cafe24\.com$/.test(url.hostname)
        : url.hostname === 'cdn.shopify.com' || url.hostname === rt.env.SHOPIFY_PUBLIC_DOMAIN || url.hostname === rt.env.SHOPIFY_SHOP_DOMAIN || url.hostname === rt.env.SHOPIFY_STORE_DOMAIN;
      if (!allowed || url.protocol !== 'https:' || url.username || url.password) return undefined;
      try { return (await request(rt,url.href,image?'HEAD':'GET')).status; }
      catch { signal.throwIfAborted(); return undefined; }
    }
    try {
      const mappings = await verifiedFilters(listing,store,signal);
      const originalImages = store.images ? await store.images(listing.id,signal) : undefined;
      if (channel === 'cafe24') {
        if (!listing.cafe24_product_no) return {state:'missing',checked:[]};
        const cafe = cafe24Adapter(rt,store,tokens,true);
        const data = await cafe.api(`/products/${listing.cafe24_product_no}?shop_no=1&embed=additionalimages`);
        const p = data?.product;
        if (!p) return {state:'missing',checked:[]};
        const seo = (await cafe.api(`/products/${listing.cafe24_product_no}/seo?shop_no=1`))?.seo;
        if (!seo) return {state:'unavailable',checked:[]};
        const expected = cafe.transform(listing,[],p);
        const imagePaths = [...(p.detail_image ? [p.detail_image] : []),...(p.additionalimages || []).map((i:any)=>i.additional_image || i)];
        const images = await Promise.all(imagePaths.map(async (url:string)=>({url,alt:seo.meta_alt,status:await status(url,true)})));
        const tags: string[] = p.product_tag || [];
        const filters = Object.fromEntries((['material','color','size','design'] as const).map(field=> {
          const allowed = new Set([`${field.toUpperCase()}ALL`,...Object.values(mappings[field]||{}).filter(m=>m.verified).map(m=>m.cafe24)]);
          return [field,tags.filter(tag=>allowed.has(tag))];
        })) as ChannelSnapshot['filters'];
        const filterExpected = Object.fromEntries((['material','color','size','design'] as const).map(field=>[field,[mappings[field]![listing[field]].cafe24!,`${field.toUpperCase()}ALL`]]));
        const result: ChannelSnapshot = {state:'ok',checked:['name','price','description','image_count','categories','filters','seo_title','seo_description','images','publication'],
          name:p.product_name,price:p.price,description:p.description,image_count:imagePaths.length,categories:(p.category||[]).map((c:any)=>c.category_no),filters,
          seo_title:seo.meta_title,seo_description:seo.meta_description,images,active:p.display==='T'&&p.selling==='T',
          page_status:await status(`https://atlm.kr/product/detail.html?product_no=${listing.cafe24_product_no}`),
          expected:{name:String(expected.product_name),price:Number(expected.price),description:String(expected.description),categories:listing.cafe24_category_nos,filters:filterExpected,
            seo_title:listing.meta_title_ko||`${listing.name_ko} | ${listing.category_name_ko} | 아뜰리에 드 루멘`,seo_description:listing.meta_desc_ko,
            ...(originalImages?{image_count:originalImages.filter(i=>i.role!=='detail_view'&&i.role!=='list').length}:{})}};
        const variants = (await cafe.api(`/products/${listing.cafe24_product_no}/variants?shop_no=1`))?.variants;
        if (variants?.length===1 && /^[A-Z0-9]+$/.test(variants[0].variant_code)) {
          const inv = (await cafe.api(`/products/${listing.cafe24_product_no}/variants/${variants[0].variant_code}/inventories?shop_no=1`))?.inventory;
          if (inv && Number.isFinite(Number(inv.quantity))) {result.checked.push('inventory');result.inventory=Number(inv.quantity);}
        }
        return result;
      }
      if (!listing.shopify_product_id) return {state:'missing',checked:[]};
      const client = shopifyClient(rt); const p = await client.product(listing.shopify_product_id);
      if (!p) return {state:'missing',checked:[]};
      const fields = new Map<string,any>(p.metafields.nodes.map((m:any)=>[`${m.namespace}.${m.key}`,m]));
      const refs = (key:string) => {const m=fields.get(`custom.${key}`);return !m?[]:m.type.startsWith('list.')?JSON.parse(m.value):[m.value];};
      const filters = {material:refs('product_material'),color:refs('product_color_chip'),design:refs('product_design')};
      const filterExpected = {material:[mappings.material?.[listing.material]?.shopify_ref||''].filter(Boolean),color:[listing.color_chip_ref||mappings.color?.[listing.color]?.shopify_ref||''].filter(Boolean),design:[mappings.design?.[listing.design]?.shopify_ref||''].filter(Boolean)};
      const images = await Promise.all(p.media.nodes.map(async (m:any)=>({url:m.image?.url||'',alt:m.alt,status:m.image?.url?await status(m.image.url,true):undefined})));
      const manual: string[]=[];
      for (const c of p.collections.nodes) {const collection=await client.node(c.id);if(collection && !collection.ruleSet) manual.push(c.id);}
      const productTranslations = (await client.query(Q.translatable,{id:p.id})).translatableResource?.translations;
      const detail = fields.get('custom.product_details');
      const detailTranslations = detail ? (await client.query(Q.translatable,{id:detail.id})).translatableResource?.translations : [];
      const ja = (list:any[],key:string)=>list?.find(t=>t.key===key && !t.outdated)?.value || '';
      const publicationId=rt.env.SHOPIFY_ONLINE_STORE_PUBLICATION_ID;
      const result: ChannelSnapshot = {state:'ok',unsupported:['filters.size'],checked:['name','price','description','image_count','categories','filters','seo_title','seo_description','images','ja'],
        name:p.title,price:p.variants.nodes[0]?.price,description:p.descriptionHtml,image_count:p.media.nodes.length,categories:manual,filters,
        seo_title:p.seo.title,seo_description:p.seo.description,images,active:p.status==='ACTIVE',
        ja_description:ja(productTranslations,'body_html'),ja_details:ja(detailTranslations,'value'),ja_title:ja(productTranslations,'title'),ja_meta_title:ja(productTranslations,'meta_title'),ja_meta_description:ja(productTranslations,'meta_description'),
        expected:{name:listing.name_en,price:listing.price_usd,description:listing.desc_en,categories:listing.shopify_collection_ids,filters:filterExpected,
          seo_title:listing.meta_title_en||`${listing.name_en} | ${listing.category_name_en}`,seo_description:listing.meta_desc_en,
          ...(originalImages?{image_count:originalImages.filter(i=>i.role!=='detail_view').length}:{})}};
      if (publicationId && (await client.node(publicationId))?.name==='Online Store') {
        result.checked.push('publication');result.online_store_published=p.resourcePublicationsV2.nodes.some((r:any)=>r.publication.id===publicationId && r.isPublished);
        if(p.onlineStoreUrl) result.page_status=await status(p.onlineStoreUrl);
      }
      if (p.variants.nodes.length===1 && rt.env.SHOPIFY_LOCATION_ID) {
        const quantities=(await client.query(Q.inventory,{id:p.variants.nodes[0].inventoryItem.id,location:rt.env.SHOPIFY_LOCATION_ID})).inventoryItem?.inventoryLevel?.quantities;
        const stock=quantities?.find((q:any)=>q.name==='available');
        if(stock){result.checked.push('inventory');result.inventory=stock.quantity;}
      }
      return result;
    } catch { signal.throwIfAborted();return {state:'unavailable',checked:[]}; }
  };
}
export const readMonitorSnapshot: ShopMonitorReader = (listing,channel,signal)=>createMonitorReader()(listing,channel,signal);
