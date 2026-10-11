import { randomUUID } from 'node:crypto';
import type { Listing, ListingImage } from '../../shared/product-registration';
import { cafe24FilterTags } from '../../shared/product-registration';
import { cafe24Auth, type TokenStore } from './cafe24-auth';
import { assertWrites, ChannelError, completedSteps, fingerprint, hasIntent, imageOrder, json, pause, request, sourceBytes, step, UncertainWrite, type OnStep, type Runtime } from './common';
import { verifiedFilters, type RegistrationStore } from './settings';

export const CAFE24_API_VERSION = '2026-03-01';
export const CAFE24_BASE = 'https://atlm1224.cafe24api.com/api/v2/admin';
export const BANNED_CAFE24_TAGS = ['빠니에','통근백','데일리백','A4가방'];
const marker = (listing: Listing) => `ERP${listing.is_test ? 'TEST' : ''}:${listing.id}`;
// One queue per process, shared by sync, publish and the migration tool. Even retries use it.
let queue: Promise<unknown> = Promise.resolve(); let lastCall = 0;
export function cafe24Adapter(rt: Runtime, store: RegistrationStore, tokens?: TokenStore, readOnly = false) {
  const auth = cafe24Auth(rt, tokens);
  const paced: Runtime = { ...rt, fetch: (async (...args: Parameters<typeof fetch>) => {
    const operation = queue.catch(() => {}).then(async () => {
      await pause(rt,Math.max(0, 500 - (rt.now() - lastCall))); lastCall = rt.now();
      return rt.fetch(...args);
    });
    queue = operation.then(() => {}, () => {}); return operation;
  }) as typeof fetch };
  async function api(path: string, method = 'GET', payload?: unknown, replaySafe = false) {
    if (readOnly && method !== 'GET') throw new ChannelError('monitor_write_forbidden');
    if (!path.startsWith('/') || path.includes('://')) throw new ChannelError('invalid_cafe24_path');
    const response = await request(paced, `${CAFE24_BASE}${path}`, method, {
      write: method !== 'GET', replaySafe, headers: { Authorization: `Bearer ${await auth.token(!readOnly || rt.env.PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED==='true')}`, 'X-Cafe24-Api-Version': CAFE24_API_VERSION, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify({ shop_no: 1, request: payload }) }),
    });
    if (response.status === 404) return null;
    if (response.status === 204) return {};
    return json(response);
  }
  const product = async (id: number) => (await api(`/products/${id}?shop_no=1`))?.product;
  async function duplicates(listing: Listing) {
    const data = await api(`/products?shop_no=1&custom_product_code=${encodeURIComponent(listing.sku)}&limit=100`);
    if (!Array.isArray(data?.products) || data.products.length >= 100) throw new ChannelError('cafe24_duplicate_lookup_incomplete');
    return data.products.filter((p: any) => p.custom_product_code === listing.sku);
  }
  function owned(p: any, listing: Listing) {
    if (!p || p.internal_product_name !== marker(listing) || p.custom_product_code !== listing.sku) throw new ChannelError('cafe24_product_ownership_mismatch');
  }
  async function configuration(listing: Listing) {
    await verifiedFilters(listing, store);
    if (marker(listing).length > 50) throw new ChannelError('cafe24_identity_too_long');
    // Official legacy API and Help Center document tracked negative-stock sales with
    // display_soldout:F. Read-back verifies the setting on our pinned version.
    if (listing.preorder_enabled && !/^custom_option\d+$/.test(rt.env.CAFE24_PREORDER_LABEL_KEY || '')) throw new ChannelError('cafe24_preorder_label_key_unconnected');
    if (listing.preorder_enabled && listing.preorder_limit != null) throw new ChannelError('cafe24_preorder_hard_limit_unsupported');
    if (listing.tags_ko.some(tag => BANNED_CAFE24_TAGS.includes(tag.replaceAll('_','')))) throw new ChannelError('cafe24_banned_search_tag');
    const sisters = await store.sisters(listing.sister_listing_ids);
    if (sisters.some(s => s.id === listing.id || s.style_name !== listing.style_name || !s.cafe24_product_no || s.status === '삭제됨')) throw new ChannelError('cafe24_sister_unconnected');
    return sisters;
  }
  function transform(listing: Listing, sisters: Listing[], previous?: any) {
    const allowed = ['shipping_scope','shipping_method','shipping_fee_by_product','shipping_fee_type','shipping_fee','shipping_rates','shipping_period','shipping_area','shipping_payment','shipping_fee_fixed','product_shipping_type'];
    if (Object.keys(listing.cafe24_shipping).some(key => !allowed.includes(key))) throw new ChannelError('cafe24_shipping_field_unsupported');
    const stripLabel = (value: string) => value.replace(/^\*\d+(?:ST|ND|RD|TH):[^\n<]*(?:\n|<br\s*\/?\s*>)/i, '');
    const label = listing.preorder_enabled ? listing.preorder_label_ko + '\n' : '';
    const result: Record<string, unknown> = {
      ...listing.cafe24_shipping, custom_product_code: listing.sku, internal_product_name: marker(listing), product_name: listing.name_ko, eng_product_name: listing.name_en,
      model_name: listing.style_name, price: listing.price_krw, retail_price: listing.retail_krw, supply_price: listing.supply_price,
      summary_description: label + stripLabel(listing.summary_ko), simple_description: label + stripLabel(listing.simple_ko),
      description: listing.detail_html_ko, mobile_description: listing.mobile_detail_html_ko || listing.detail_html_ko,
      separated_mobile_description: listing.mobile_detail_html_ko ? 'T' : 'F', payment_info: listing.details_ko, shipping_info: listing.care_ko,
      payment_info_by_product: 'T', shipping_info_by_product: 'T', product_weight: listing.weight_g / 1000,
      made_in_code: listing.origin_cafe24, hscode: listing.hscode, classification_code: listing.classification_code,
      use_naverpay: listing.naverpay ? 'T' : 'F', market_sync: listing.market_sync ? 'T' : 'F',
      display: previous?.display === 'T' ? 'T' : 'F', selling: previous?.selling === 'T' ? 'T' : 'F',
      relational_product: sisters.map(s => ({ product_no: s.cafe24_product_no, interrelated: 'T' })),
    };
    if (listing.made_date) result.made_date = listing.made_date;
    const labelKey = rt.env.CAFE24_PREORDER_LABEL_KEY;
    if (labelKey) {
      if (!/^custom_option\d+$/.test(labelKey)) throw new ChannelError('cafe24_label_key_unverified');
      result.additional_information = [...(previous?.additional_information || []).filter((x: any) => x.key !== labelKey), { key: labelKey, value: listing.preorder_enabled ? listing.preorder_label_ko : '' }];
    }
    return result;
  }
  async function verifyProduct(listing: Listing, id: number, expected: Record<string, unknown>) {
    const p = await product(id); owned(p, listing);
    const numeric = ['price','retail_price','supply_price','product_weight'];
    return Object.entries(expected).every(([key, value]) => {
      if (numeric.includes(key)) return Number(p[key]) === value;
      if (key === 'relational_product') return (value as any[]).every(r => p.relational_product?.some((x: any) => x.product_no === r.product_no && x.interrelated === r.interrelated)) && p.relational_product?.length === (value as any[]).length;
      if (key === 'additional_information') return (value as any[]).every(r => p.additional_information?.some((x: any) => x.key === r.key && x.value === r.value));
      if (typeof value === 'object') return JSON.stringify(p[key]) === JSON.stringify(value);
      return (p[key] ?? '') === value;
    });
  }
  async function check(listing: Listing) {
    await configuration(listing);
    const matches = await duplicates(listing);
    if (matches.some((p: any) => p.product_no !== listing.cafe24_product_no)) throw new ChannelError('cafe24_sku_duplicate');
    if (listing.cafe24_product_no) owned(await product(listing.cafe24_product_no), listing);
  }
  async function sync(listing: Listing, images: ListingImage[], onStep: OnStep) {
    assertWrites(rt);
    const ordered = imageOrder(images); const main = ordered.find(i => i.role === 'main'); const list = ordered.find(i => i.role === 'list');
    if (!main) throw new ChannelError('main_image_required');
    const extras = ordered.filter(i => i.role !== 'main' && i.role !== 'list');
    if (extras.length > 20) throw new ChannelError('cafe24_additional_images_exceed_20');
    // Validate real file sizes before ANY merchant mutation, not just the upload request.
    // ERP's 10MB limit is not Cafe24's additional-image 5MB limit.
    const additionalBuffers: Buffer[] = []; let additionalBytes = 0;
    for (const image of extras) {
      if ((image.byte_size || 0) > 5 * 1024 * 1024) throw new ChannelError('cafe24_additional_image_exceeds_5mb');
      const bytes = await sourceBytes(rt,image);
      if (bytes.length > 5 * 1024 * 1024) throw new ChannelError('cafe24_additional_image_exceeds_5mb');
      additionalBytes += bytes.length;
      if (additionalBytes > 30 * 1024 * 1024) throw new ChannelError('cafe24_additional_images_exceed_30mb');
      additionalBuffers.push(bytes);
    }
    const sisters = await configuration(listing);
    let id = listing.cafe24_product_no;
    const createPayload = { listing_id: listing.id, sku: listing.sku };
    const priorIntent = hasIntent(listing,'cafe24','create',createPayload);
    if (!id) {
      const created = await step(listing,'cafe24','create',createPayload,onStep,async () => {
        const matches = await duplicates(listing);
        if (matches.length) {
          if (!priorIntent || matches.length !== 1) throw new ChannelError('cafe24_sku_duplicate');
          owned(matches[0],listing); return { cafe24_product_no: matches[0].product_no };
        }
        if (priorIntent) throw new UncertainWrite();
        try {
          const createdProduct = (await api('/products','POST',transform(listing,sisters)))?.product;
          if (!createdProduct?.product_no) throw new UncertainWrite();
          return { cafe24_product_no: createdProduct.product_no };
        } catch (error) {
          if (!(error instanceof UncertainWrite)) throw error;
          const found = await duplicates(listing);
          if (found.length !== 1) throw error;
          owned(found[0],listing); return { cafe24_product_no: found[0].product_no };
        }
      },async data => { owned(await product(Number(data.cafe24_product_no)),listing); return true; });
      id = Number(created.cafe24_product_no); listing.cafe24_product_no = id;
    }
    const previous = await product(id); owned(previous,listing);
    if ((await duplicates(listing)).some((p: any) => p.product_no !== id)) throw new ChannelError('cafe24_sku_duplicate');
    const expected = transform(listing,sisters,previous);
    await step(listing,'cafe24','product',{ revision:listing.revision,id,expected },onStep,async () => {
      await api(`/products/${id}`,'PUT',expected,true); return { cafe24_product_no:id };
    },() => verifyProduct(listing,id!,expected));
    const tags = [...new Set([...listing.tags_ko.map(tag => tag.replaceAll('_','')), ...cafe24FilterTags(listing)])];
    await step(listing,'cafe24','tags',{ revision:listing.revision,id,tags },onStep,async () => {
      const current = (await product(id!)).product_tag || [];
      const former = completedSteps(listing,'cafe24','tags').flatMap((s: any) => s.managed_tags || []);
      const stale = current.filter((t: string) => former.includes(t) && !tags.includes(t));
      for(const tag of stale) await api(`/products/${id}/tags/${encodeURIComponent(tag)}?shop_no=1`,'DELETE',undefined,true);
      const missing = tags.filter(t => !current.includes(t));
      if (missing.length) await api(`/products/${id}/tags`,'POST',{tags:missing},true);
      await rt.sleep(60_000);
      for (let i=0;i<7;i++) {
        const currentTags = (await api(`/products/${id}?shop_no=1&fields=product_tag`))?.product?.product_tag || [];
        if (tags.every(t => currentTags.includes(t)) && stale.every((t:string)=>!currentTags.includes(t))) return { cafe24_product_no:id,managed_tags:tags };
        if (i<6) await rt.sleep(5000);
      }
      throw new ChannelError('cafe24_tags_not_visible_after_90s');
    },async () => {
      const actual = (await api(`/products/${id}?shop_no=1&fields=product_tag`))?.product?.product_tag || [];
      return tags.every(t => actual.includes(t));
    });
    const mainPayload = { id,main:main.source_url,list:list?.source_url };
    const priorMain = hasIntent(listing,'cafe24','main_image',mainPayload);
    const mainKey = `cafe24:main_image:${fingerprint(mainPayload)}`;
    const unwrap = (value: any) => value?.data || value;
    const completedMain = unwrap(listing.step_keys[mainKey]);
    // Separate each POST attempt from the long-lived step intent. A completed older
    // upload cannot resolve a newer lost response, even when the payload is identical.
    const attemptKey = `${mainKey}:upload:intent`;
    const priorAttempt = unwrap(listing.step_keys[attemptKey]);
    const verifyMain = async (data: Record<string,unknown>) => {
      const p = await product(id!); owned(p,listing);
      const paths = (data.images as any[])?.[0]?.cafe24_paths;
      return !!paths?.detail_image && p.detail_image === paths.detail_image && (!list || p.list_image === paths.list_image);
    };
    if (priorAttempt && priorAttempt.attempt !== completedMain?.attempt) {
      if (!priorAttempt.result || !await verifyMain(priorAttempt.result)) throw new UncertainWrite();
      await onStep({channel:'cafe24',step:'main_image',key:mainKey,data:priorAttempt.result});
      listing.step_keys[mainKey] = priorAttempt.result;
    }
    const mainResult = await step(listing,'cafe24','main_image',mainPayload,onStep,async () => {
      if (priorAttempt && priorAttempt.attempt !== completedMain?.attempt) {
        throw new UncertainWrite();
      }
      // Legacy completed provenance permits approved repair after an admin change;
      // an original unresolved intent still cannot authorize a second first-create.
      if (priorMain && !completedMain) throw new UncertainWrite();
      const imageBody = { detail_image:(await sourceBytes(rt,main)).toString('base64'),image_upload_type:'A',
        ...(list ? { list_image:(await sourceBytes(rt,list)).toString('base64') } : {}) };
      const attempt = randomUUID();
      const pending = {state:'pending',attempt};
      await onStep({channel:'cafe24',step:'main_image:upload:intent',key:attemptKey,data:pending});
      listing.step_keys[attemptKey] = pending;
      const result = (await api(`/products/${id}/images`,'POST',imageBody))?.images;
      if (!result?.detail_image) throw new UncertainWrite();
      const data = {attempt,images:[{id:main.id,cafe24_paths:result},...(list?[{id:list.id,cafe24_paths:{list_image:result.list_image}}]:[])]};
      const responded = {state:'responded',attempt,result:data};
      await onStep({channel:'cafe24',step:'main_image:upload:intent',key:attemptKey,data:responded});
      listing.step_keys[attemptKey] = responded;
      return data;
    },verifyMain);
    const extraPayload = { id,extras:extras.map(i => ({id:i.id,source:i.source_url})) };
    const extraKey = `cafe24:extra_images:${fingerprint(extraPayload)}`;
    const priorExtras = hasIntent(listing,'cafe24','extra_images',extraPayload);
    const pathsOf = (value: unknown): string[] => {
      if (!Array.isArray(value) || value.length > 20) throw new ChannelError('cafe24_additional_images_invalid_response');
      return value.map(image => {
        const path = typeof image === 'string' ? image : image?.additional_image;
        if (typeof path !== 'string' || !path) throw new ChannelError('cafe24_additional_images_invalid_response');
        return path;
      });
    };
    const readExtras = async () => {
      const p = (await api(`/products/${id}?shop_no=1&embed=additionalimages`))?.product;
      owned(p,listing);
      // Missing embed is unknown, never an empty set that authorizes DELETE/replacement.
      return {product:p,paths:pathsOf(p.additionalimages)};
    };
    const imagePaths = (data: Record<string,unknown>) => pathsOf((data.images as any[] || []).map(i=>i.cafe24_paths?.additional_image));
    const verifyExtras = async (data: Record<string,unknown>) => {
      const current = await readExtras(); const expectedPaths = imagePaths(data);
      return expectedPaths.length === extras.length && current.paths.length === expectedPaths.length &&
        expectedPaths.every((path,index)=>path===current.paths[index] && (data.images as any[])[index]?.id===extras[index]?.id) &&
        (!data.main_paths || Object.entries(data.main_paths as Record<string,unknown>).every(([key,value])=>current.product[key]===value));
    };
    await step(listing,'cafe24','extra_images',extraPayload,onStep,async () => {
      const current = await readExtras();
      const rawResponse:any = listing.step_keys[`${extraKey}:response`];
      const savedResponse:Record<string,unknown>|undefined = rawResponse?.data || rawResponse;
      // A successful response is durably recorded BEFORE read-back. A read failure can
      // then recover exact ordered paths without another upload (no count-only adoption).
      if (savedResponse && await verifyExtras(savedResponse)) return savedResponse;
      const proven = new Set(completedSteps(listing,'cafe24','extra_images').flatMap(imagePaths));
      const protectedPaths = new Set([current.product.detail_image,current.product.list_image,current.product.small_image,current.product.tiny_image,...images.map(i=>i.source_url)]);
      if (current.paths.some(path=>!proven.has(path) || protectedPaths.has(path))) {
        if (priorExtras && !savedResponse) throw new UncertainWrite();
        throw new ChannelError('cafe24_additional_images_unowned_paths');
      }
      // An unresolved first POST could have committed even if the cached embed is empty.
      // No automatic second create; full-set PUT/DELETE is safe only after ownership proof.
      if (priorExtras && !savedResponse && proven.size === 0) throw new UncertainWrite();
      const mainPaths = Object.fromEntries(['detail_image','list_image','small_image','tiny_image']
        .filter(key=>current.product[key]!==undefined).map(key=>[key,current.product[key]]));
      let paths:string[] = [];
      if (extras.length) {
        const method = current.paths.length || proven.size || savedResponse ? 'PUT' : 'POST';
        const result = await api(`/products/${id}/additionalimages`,method,
          {additional_image:additionalBuffers.map(bytes=>bytes.toString('base64'))},method==='PUT');
        paths = pathsOf(result?.additionalimages);
        if (paths.length !== extras.length || paths.some(path=>protectedPaths.has(path))) throw new UncertainWrite();
      } else if (current.paths.length) {
        await api(`/products/${id}/additionalimages?shop_no=1`,'DELETE',undefined,true);
      }
      const data = {images:extras.map((image,index)=>({id:image.id,cafe24_paths:{additional_image:paths[index]}})),main_paths:mainPaths};
      await onStep({channel:'cafe24',step:'extra_images:response',key:`${extraKey}:response`,data});
      listing.step_keys[`${extraKey}:response`] = data;
      return data;
    },verifyExtras);
    const seo = { meta_title:listing.meta_title_ko || `${listing.name_ko} | ${listing.category_name_ko} | 아뜰리에 드 루멘`,meta_description:listing.meta_desc_ko,meta_keywords:listing.meta_keywords,
      meta_author:'Atelier de LUMEN',search_engine_exposure:'T',meta_alt:main.alt_ko };
    await step(listing,'cafe24','seo',{revision:listing.revision,id,seo},onStep,async () => { await api(`/products/${id}/seo`,'PUT',seo,true); return {cafe24_product_no:id}; },async () => {
      const actual = (await api(`/products/${id}/seo?shop_no=1`))?.seo;
      return !!actual && Object.entries(seo).every(([key,value]) => actual[key] === value);
    });
    await step(listing,'cafe24','categories',{revision:listing.revision,id,categories:listing.cafe24_category_nos},onStep,async () => {
      const current = (await product(id!)).category || [];
      const removed = current.filter((c: any) => !listing.cafe24_category_nos.includes(c.category_no));
      if (removed.length) await api(`/products/${id}`,'PUT',{delete_category_no:removed.map((c: any)=>c.category_no)},true);
      for (const no of listing.cafe24_category_nos) if (!current.some((c: any)=>c.category_no===no)) await api(`/categories/${no}/products`,'POST',{product_no:[id]},true);
      return {cafe24_product_no:id};
    },async () => {
      const actual = (await product(id!)).category || [];
      return actual.length === listing.cafe24_category_nos.length && listing.cafe24_category_nos.every(no => actual.some((c: any)=>c.category_no===no));
    });
    const variants = (await api(`/products/${id}/variants?shop_no=1`))?.variants;
    if (!Array.isArray(variants) || variants.length !== 1) throw new ChannelError('cafe24_single_variant_required');
    const code = variants[0].variant_code;
    if (!/^[a-zA-Z0-9]+$/.test(code)) throw new ChannelError('cafe24_variant_code_invalid');
    const soldout = listing.preorder_enabled ? 'F' : 'T';
    const initialized=completedSteps(listing,'cafe24','inventory_initial').length>0 || completedSteps(listing,'cafe24','inventory').length>0;
    if(!initialized && previous.display!=='T' && previous.selling!=='T') await step(listing,'cafe24','inventory_initial',{id,code,quantity:listing.cafe24_qty},onStep,async()=>{
      await api(`/products/${id}/variants/${code}/inventories`,'PUT',{use_inventory:'T',quantity:listing.cafe24_qty},true);return {cafe24_product_no:id};
    },async()=>Number((await api(`/products/${id}/variants/${code}/inventories?shop_no=1`))?.inventory?.quantity)===listing.cafe24_qty);
    await step(listing,'cafe24','inventory_policy',{revision:listing.revision,id,code,soldout},onStep,async () => {
      await api(`/products/${id}/variants/${code}/inventories`,'PUT',{use_inventory:'T',display_soldout:soldout},true); return {cafe24_product_no:id};
    },async () => {
      const inventory = (await api(`/products/${id}/variants/${code}/inventories?shop_no=1`))?.inventory;
      return inventory?.use_inventory === 'T' && inventory.display_soldout === soldout;
    });
    void mainResult;
    return id;
  }
  async function publish(listing: Listing,onStep: OnStep) {
    assertWrites(rt); const id = listing.cafe24_product_no;
    if (!id) throw new ChannelError('cafe24_product_not_staged'); owned(await product(id),listing);
    await step(listing,'cafe24','publish',{revision:listing.revision,id},onStep,async () => { await api(`/products/${id}`,'PUT',{display:'T',selling:'T'},true); return {cafe24_product_no:id}; },async () => {
      const p = await product(id); owned(p,listing);
      if (p.display !== 'T' || p.selling !== 'T') return false;
      return (await request(rt,`https://atlm.kr/product/detail.html?product_no=${id}`)).status === 200;
    }); return id;
  }
  async function remove(listing: Listing,_images: ListingImage[],onStep: OnStep) {
    assertWrites(rt); if (!listing.is_test) throw new ChannelError('delete_requires_test_listing');
    const id = listing.cafe24_product_no; if (!id) return [];
    const p = await product(id);
    if (p) owned(p,listing);
    else if (!completedSteps(listing,'cafe24','delete').some(d=>d.cafe24_product_no===id) && !hasIntent(listing,'cafe24','delete',{id})) throw new ChannelError('cafe24_deleted_product_unverified');
    await step(listing,'cafe24','delete',{id},onStep,async () => { if (await product(id)) await api(`/products/${id}`,'DELETE',undefined,true); return {cafe24_product_no:id}; },async () => !await product(id));
    return ['cafe24_admin_trash_purge','cafe24_admin_image_cleanup'];
  }
  async function endPreorder(listing: Listing,onStep: OnStep) {
    assertWrites(rt); const id=listing.cafe24_product_no;
    if(!id)throw new ChannelError('cafe24_product_not_staged');
    const p=await product(id);owned(p,listing);
    const strip=(text:string)=>text.startsWith(listing.preorder_label_ko+'\n')?text.slice(listing.preorder_label_ko.length+1):text.startsWith(listing.preorder_label_ko+'<br>')?text.slice(listing.preorder_label_ko.length+4):text;
    const key=rt.env.CAFE24_PREORDER_LABEL_KEY;
    if(!key || !/^custom_option\d+$/.test(key))throw new ChannelError('cafe24_preorder_label_key_unconnected');
    const expected={summary_description:strip(p.summary_description||''),simple_description:strip(p.simple_description||''),
      additional_information:[...(p.additional_information||[]).filter((v:any)=>v.key!==key),{key,value:''}]};
    await step(listing,'cafe24','preorder_end_label',{revision:listing.revision,id,expected},onStep,async()=>{
      await api(`/products/${id}`,'PUT',expected,true);return {cafe24_product_no:id};
    },async()=>{const actual=await product(id);return actual.summary_description===expected.summary_description && actual.simple_description===expected.simple_description && actual.additional_information?.some((v:any)=>v.key===key && v.value==='');});
    const variants=(await api(`/products/${id}/variants?shop_no=1`))?.variants;
    if(variants?.length!==1 || !/^[A-Z0-9]+$/.test(variants[0].variant_code))throw new ChannelError('cafe24_single_variant_required');
    const code=variants[0].variant_code;
    await step(listing,'cafe24','preorder_end_policy',{revision:listing.revision,id,code},onStep,async()=>{
      // Policy-only replacement: never reset live quantity, price or storefront visibility.
      await api(`/products/${id}/variants/${code}/inventories`,'PUT',{use_inventory:'T',display_soldout:'T'},true);return {cafe24_product_no:id};
    },async()=>{const inv=(await api(`/products/${id}/variants/${code}/inventories?shop_no=1`))?.inventory;return inv?.use_inventory==='T' && inv.display_soldout==='T';});
    return id;
  }
  return {configured:auth.configured,api,product,duplicates,transform,check,sync,publish,remove,endPreorder};
}
