import type { Listing, ListingImage } from '../../shared/product-registration';
import { assertWrites, ChannelError, completedSteps, hasIntent, imageOrder, step, UncertainWrite, type OnStep, type Runtime } from './common';
import { Q } from './shopify-queries';
import { shopifyClient } from './shopify-client';
import { shopifyFiles } from './shopify-files';
import { validatedMetafields, type RegistrationStore } from './settings';

export const ownerTag = (listing: Listing) => `erp-listing:${listing.id}`;
const testTag = (listing: Listing) => `erp-test:${listing.id}`;
const searchValue = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const sameSet = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
export function shopifyAdapter(rt: Runtime, store: RegistrationStore) {
  const client = shopifyClient(rt); const files = shopifyFiles(rt, client);
  async function duplicates(listing: Listing) {
    const connection = (await client.query(Q.duplicates, { query: `sku:${searchValue(listing.sku)} OR handle:${searchValue(listing.handle)}` })).products;
    if (connection.pageInfo.hasNextPage || connection.nodes.some((n: any) => n.variants.pageInfo.hasNextPage)) throw new ChannelError('shopify_duplicate_lookup_incomplete');
    return connection.nodes.filter((p: any) => p.handle === listing.handle || p.variants.nodes.some((v: any) => v.sku === listing.sku));
  }
  function owned(p: any, listing: Listing) {
    if (!p || !p.tags.includes(ownerTag(listing)) || p.variants.nodes.length !== 1 || p.variants.nodes[0].sku !== listing.sku)
      throw new ChannelError('shopify_product_ownership_mismatch');
    if (listing.is_test !== p.tags.includes(testTag(listing))) throw new ChannelError('shopify_test_identity_mismatch');
  }
  async function recover(listing: Listing) {
    const matches = await duplicates(listing);
    if (matches.length !== 1 || !matches[0].tags.includes(ownerTag(listing))) throw new UncertainWrite();
    const p = await client.product(matches[0].id); owned(p, listing); return p;
  }
  async function configuration(listing: Listing) {
    const metafields = await validatedMetafields(client, listing, store);
    if (listing.preorder_enabled && listing.preorder_limit != null) throw new ChannelError('shopify_preorder_hard_limit_unsupported');
    if (listing.shopify_channels.some(c => c !== 'online_store')) throw new ChannelError('shopify_channel_unsupported');
    const locationId = rt.env.SHOPIFY_LOCATION_ID || '';
    if (!/^gid:\/\/shopify\/Location\/\d+$/.test(locationId) || !(await client.node(locationId))?.isActive) throw new ChannelError('shopify_inventory_location_unverified');
    if (!/^gid:\/\/shopify\/TaxonomyCategory\//.test(listing.taxonomy_category_id) || !(await client.node(listing.taxonomy_category_id))) throw new ChannelError('shopify_taxonomy_unverified');
    for (const id of listing.shopify_collection_ids) {
      if (!/^gid:\/\/shopify\/Collection\/\d+$/.test(id)) throw new ChannelError('shopify_collection_unverified');
      const collection = await client.node(id);
      if (!collection || collection.ruleSet) throw new ChannelError('shopify_manual_collection_required');
    }
    const currency = (await client.query(Q.shop)).shop.currencyCode;
    const rate = Number(rt.env.PRODUCT_REGISTRATION_KRW_PER_USD);
    if (currency !== 'USD') throw new ChannelError('shopify_price_currency_must_be_usd');
    if (!Number.isFinite(rate) || rate <= 0) throw new ChannelError('shopify_cost_currency_unverified');
    // Listing supply_price is KRW. Inventory cost always uses the shop's default currency.
    return { metafields, locationId, cost: Math.round(listing.supply_price / rate * 100) / 100, currency };
  }
  function productInput(listing: Listing, config: Awaited<ReturnType<typeof configuration>>, previous?: any) {
    const previousManaged = completedSteps(listing, 'shopify', 'product').flatMap((s: any) => s.managed_tags || []);
    const tags = [...new Set([...(previous?.tags || []).filter((t: string) => !previousManaged.includes(t)), ...listing.tags_en, listing.season, ownerTag(listing), ...(listing.is_test ? [testTag(listing)] : [])])];
    return {
      title: listing.name_en, handle: listing.handle, vendor: 'Atelier de LUMEN', descriptionHtml: listing.desc_en,
      status: previous?.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT', tags,
      category: listing.taxonomy_category_id, collections: listing.shopify_collection_ids,
      seo: { title: listing.meta_title_en || `${listing.name_en} | ${listing.category_name_en}`, description: listing.meta_desc_en },
      productOptions: [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
      variants: [{ ...(previous ? { id: previous.variants.nodes[0].id } : {}), optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        sku: listing.sku, barcode: listing.barcode, price: listing.price_usd.toFixed(2), taxable: true,
        inventoryPolicy: listing.preorder_enabled ? 'CONTINUE' : 'DENY',
        inventoryItem: { tracked: true, cost: config.cost, countryCodeOfOrigin: listing.origin_shopify,
          harmonizedSystemCode: listing.hscode, requiresShipping: true, measurement: { weight: { value: listing.weight_g, unit: 'GRAMS' } } },
        ...(!previous ? {inventoryQuantities: [{ locationId: config.locationId, name: 'available', quantity: listing.shopify_qty }]} : {}),
      }],
    };
  }
  async function verifyProduct(listing: Listing, input: ReturnType<typeof productInput>, id: string) {
    const p = await client.product(id); owned(p, listing);
    const variant = p.variants.nodes[0];
    const initialQuantity=input.variants[0].inventoryQuantities?.[0];
    const stock = initialQuantity ? (await client.query(Q.inventory,{id:variant.inventoryItem.id,location:initialQuantity.locationId})).inventoryItem?.inventoryLevel?.quantities : undefined;
    return p.title === input.title && p.handle === input.handle && p.status === input.status && p.vendor === input.vendor && p.descriptionHtml === input.descriptionHtml &&
      p.category?.id === input.category && p.seo.title === input.seo.title && p.seo.description === input.seo.description &&
      sameSet(p.tags, input.tags) && input.collections.every(id => p.collections.nodes.some((c: any) => c.id === id)) &&
      variant.sku === listing.sku && (variant.barcode || '') === listing.barcode && Number(variant.price) === listing.price_usd &&
      variant.taxable === true && variant.inventoryPolicy === input.variants[0].inventoryPolicy &&
      variant.inventoryItem.tracked && variant.inventoryItem.countryCodeOfOrigin === listing.origin_shopify && variant.inventoryItem.harmonizedSystemCode === listing.hscode &&
      Number(variant.inventoryItem.unitCost?.amount) === input.variants[0].inventoryItem.cost &&
      variant.inventoryItem.measurement.weight?.unit === 'GRAMS' && variant.inventoryItem.measurement.weight.value === listing.weight_g && (!initialQuantity || stock?.some((q:any)=>q.name==='available' && q.quantity===initialQuantity.quantity));
  }
  async function check(listing: Listing) {
    await configuration(listing);
    const matches = await duplicates(listing);
    if (matches.some((p: any) => p.id !== listing.shopify_product_id)) throw new ChannelError('shopify_sku_or_handle_duplicate');
    if (listing.shopify_product_id) owned(await client.product(listing.shopify_product_id), listing);
  }
  async function sync(listing: Listing, images: ListingImage[], onStep: OnStep) {
    assertWrites(rt);
    const config = await configuration(listing);
    const createPayload = { listing_id: listing.id, sku: listing.sku };
    const priorIntent = hasIntent(listing, 'shopify', 'create', createPayload);
    let id = listing.shopify_product_id;
    if (!id) {
      const created = await step(listing, 'shopify', 'create', createPayload, onStep, async () => {
        const matches = await duplicates(listing);
        if (matches.length) {
          if (!priorIntent) throw new ChannelError('shopify_sku_or_handle_duplicate');
          const p = await recover(listing); return { shopify_product_id: p.id };
        }
        if (priorIntent) throw new UncertainWrite();
        try {
          const result = await client.query(Q.set, { input: productInput(listing, config) }, true);
          const createdId = result.productSet.product?.id;
          if (!createdId) throw new UncertainWrite();
          return { shopify_product_id: createdId };
        } catch (error) {
          if (!(error instanceof UncertainWrite)) throw error;
          const p = await recover(listing); return { shopify_product_id: p.id };
        }
      }, async data => { owned(await client.product(String(data.shopify_product_id)), listing); return true; });
      id = String(created.shopify_product_id); listing.shopify_product_id = id;
    }
    const previous = await client.product(id); owned(previous, listing);
    const matches = await duplicates(listing);
    if (matches.some((p: any) => p.id !== id)) throw new ChannelError('shopify_sku_or_handle_duplicate');
    const input = productInput(listing, config, previous);
    await step(listing, 'shopify', 'product', { revision: listing.revision, id, input }, onStep, async () => {
      await client.query(Q.set, { input, identifier: { id } }, true, true);
      return { shopify_product_id: id, managed_tags: [...listing.tags_en, listing.season] };
    }, data => verifyProduct(listing, input, String(data.shopify_product_id)));
    const ordered = imageOrder(images); const media: { id: string; shopify_media_id: string }[] = [];
    for (const image of ordered) {
      const file = await files.media(listing, image, onStep);
      const mediaId = String(file.file_id);
      await step(listing, 'shopify', 'attach', { revision: listing.revision, id, mediaId, alt: image.alt_en }, onStep, async () => {
        await client.query(Q.attachFile, { files: [{ id: mediaId, alt: image.alt_en, referencesToAdd: [id] }] }, true, true);
        return { file_id: mediaId, shopify_product_id: id };
      }, async () => (await client.product(id!)).media.nodes.some((m: any) => m.id === mediaId && m.alt === image.alt_en && m.fileStatus === 'READY'));
      media.push({ id: image.id, shopify_media_id: mediaId });
    }
    const obsolete = completedSteps(listing,'shopify','file').map(d=>String(d.file_id)).filter(file=>!media.some(m=>m.shopify_media_id===file));
    for(const file of [...new Set(obsolete)]) {
      await step(listing,'shopify','obsolete_media_detach',{revision:listing.revision,id,file},onStep,async()=>{
        if((await client.product(id!)).media.nodes.some((m:any)=>m.id===file)) await client.query(Q.attachFile,{files:[{id:file,referencesToRemove:[id]}]},true,true);
        return {file_id:file};
      },async()=>!(await client.product(id!)).media.nodes.some((m:any)=>m.id===file));
    }
    await step(listing, 'shopify', 'images', { revision: listing.revision, id, media }, onStep, async () => {
      const result = await client.query(Q.order, { id, moves: media.map((m, position) => ({ id: m.shopify_media_id, newPosition: String(position) })) }, true, true);
      const jobId = result.productReorderMedia.job?.id;
      for (let i = 0; jobId && i < 30; i++) { if ((await client.query(Q.job, { id: jobId })).job?.done) break; await rt.sleep(1000); }
      return { images: media };
    }, async () => {
      const p = await client.product(id!);
      return media.every((m, i) => p.media.nodes[i]?.id === m.shopify_media_id);
    });
    const fields = config.metafields.map(f => ({ ...f, ownerId: id }));
    const optionalKeys = ['product_options','product_part_description','list_image','preorder_label'];
    const missing = optionalKeys.filter(key => !fields.some(f => f.key === key));
    await step(listing, 'shopify', 'metafields', { revision: listing.revision, id, fields, missing }, onStep, async () => {
      if (fields.length) await client.query(Q.meta, { metafields: fields }, true, true);
      if (missing.length) await client.query(Q.metaDelete, { metafields: missing.map(key => ({ ownerId: id, namespace: 'custom', key })) }, true, true);
      return { shopify_product_id: id };
    }, async () => {
      const p = await client.product(id!);
      return fields.every(f => p.metafields.nodes.some((m: any) => m.namespace === f.namespace && m.key === f.key && m.type === f.type && m.value === f.value)) &&
        missing.every(key => !p.metafields.nodes.some((m: any) => m.namespace === 'custom' && m.key === key));
    });
    const detail = (await client.product(id)).metafields.nodes.find((m: any) => m.namespace === 'custom' && m.key === 'product_details');
    if (!detail?.id) throw new ChannelError('shopify_details_metafield_missing');
    for (const translation of [{ resource: id, key: 'body_html', value: listing.desc_ja }, { resource: detail.id, key: 'value', value: listing.details_ja }]) {
      await step(listing, 'shopify', 'translation', { revision: listing.revision, ...translation }, onStep, async () => {
        const resource = (await client.query(Q.translatable, { id: translation.resource })).translatableResource;
        const digest = resource?.translatableContent.find((c: any) => c.key === translation.key)?.digest;
        if (!digest) throw new ChannelError('shopify_translation_digest_missing');
        await client.query(Q.translate, { id: translation.resource, translations: [{ key: translation.key, value: translation.value, locale: 'ja', translatableContentDigest: digest }] }, true, true);
        return { resource: translation.resource };
      }, async () => (await client.query(Q.translatable, { id: translation.resource })).translatableResource?.translations.some((t: any) => t.key === translation.key && t.value === translation.value && !t.outdated));
    }
    return id;
  }
  async function publish(listing: Listing, onStep: OnStep) {
    assertWrites(rt); const id = listing.shopify_product_id;
    if (!id) throw new ChannelError('shopify_product_not_staged');
    owned(await client.product(id), listing);
    const publicationId = rt.env.SHOPIFY_ONLINE_STORE_PUBLICATION_ID || '';
    if (!/^gid:\/\/shopify\/Publication\/\d+$/.test(publicationId) || (await client.node(publicationId))?.name !== 'Online Store') throw new ChannelError('shopify_online_store_publication_unverified');
    await step(listing, 'shopify', 'publish', { revision: listing.revision, id, publicationId }, onStep, async () => {
      await client.query(Q.active, { product: { id, status: 'ACTIVE' } }, true, true);
      await client.query(Q.publish, { id, input: [{ publicationId }] }, true, true);
      return { shopify_product_id: id };
    }, async () => {
      const p = await client.product(id); owned(p, listing);
      return p.status === 'ACTIVE' && p.resourcePublicationsV2.nodes.some((r: any) => r.publication.id === publicationId && r.isPublished);
    });
    return id;
  }
  async function references() {
    const products: any[] = []; let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const connection = (await client.query(Q.references, { after })).products;
      if (connection.nodes.some((p: any) => p.media.pageInfo.hasNextPage || p.metafields.pageInfo.hasNextPage)) throw new ChannelError('shopify_reference_scan_incomplete');
      products.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) return products;
      if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after) break;
      after = connection.pageInfo.endCursor;
    }
    throw new ChannelError('shopify_reference_scan_incomplete');
  }
  const refIds = (p: any) => [...p.media.nodes.map((m: any) => m.id), ...p.metafields.nodes.filter((m: any) => m.type === 'file_reference' || m.type === 'list.file_reference')
    .flatMap((m: any) => m.type === 'file_reference' ? [m.value] : JSON.parse(m.value))];
  async function remove(listing: Listing, images: ListingImage[], onStep: OnStep) {
    assertWrites(rt); if (!listing.is_test) throw new ChannelError('delete_requires_test_listing');
    const id = listing.shopify_product_id;
    if (!id) return;
    const product = await client.product(id);
    if (!product) {
      if (!completedSteps(listing, 'shopify', 'delete').some(d => d.shopify_product_id === id)) throw new ChannelError('shopify_deleted_product_unverified');
      return;
    }
    owned(product, listing);
    const originals = images.map(i => i.shopify_file_id).filter(Boolean) as string[];
    const ownedFiles = [...new Set(completedSteps(listing, 'shopify', 'file').map(d => String(d.file_id)))];
    if (ownedFiles.some(file => originals.includes(file))) throw new ChannelError('source_file_deletion_forbidden');
    // Refuse unknown media rather than deleting someone else's imported image.
    if (product.media.nodes.some((m: any) => !ownedFiles.includes(m.id))) throw new ChannelError('shopify_unowned_product_media');
    const before = (await references()).filter(p => p.id !== id);
    const sourceBefore = await Promise.all(originals.map(file => files.ready(file)));
    for (const fileId of ownedFiles) {
      const provenance = completedSteps(listing,'shopify','file').find(d=>d.file_id===fileId);
      const existingFile=(await client.query(Q.file,{id:fileId})).node;
      if(existingFile){const file=await files.ready(fileId);if(!/^erp-media-[0-9a-f]{64}\.(jpg|png|gif|webp)$/.test(String(provenance?.filename)) || decodeURIComponent(new URL(file.image.url).pathname.split('/').pop()||'')!==provenance?.filename)throw new ChannelError('shopify_file_provenance_mismatch');}
      await step(listing, 'shopify', 'detach', { id, fileId }, onStep, async () => {
        const file = (await client.query(Q.file, { id: fileId })).node;
        if (file) await client.query(Q.attachFile, { files: [{ id: fileId, referencesToRemove: [id] }] }, true, true);
        return { file_id: fileId };
      }, async () => !(await client.product(id))?.media.nodes.some((m: any) => m.id === fileId));
      const refs = await references();
      if (refs.some(p => refIds(p).includes(fileId))) throw new ChannelError('shopify_file_still_referenced');
      // Merchant files can be used outside products (collections/themes/metaobjects).
      // Shopify exposes no exhaustive cross-resource usage graph here; deletion requires a
      // reviewed unique ERP-only provenance and an explicit operator attestation, never a guess.
      if (rt.env.PRODUCT_REGISTRATION_FILE_DELETE_AUDITED !== 'true') throw new ChannelError('shopify_nonproduct_file_reference_audit_required');
      await step(listing, 'shopify', 'delete_file', { id, fileId }, onStep, async () => {
        if ((await client.query(Q.file, { id: fileId })).node) await client.query(Q.deleteFile, { ids: [fileId] }, true, true);
        return { file_id: fileId };
      }, async () => !(await client.query(Q.file, { id: fileId })).node);
    }
    const after = (await references()).filter(p => p.id !== id);
    if (before.some(p => !after.some(q => q.id === p.id && sameSet(refIds(q), refIds(p))))) throw new ChannelError('shopify_original_product_media_changed');
    const sourceAfter = await Promise.all(originals.map(file => files.ready(file)));
    if (sourceBefore.some((file, i) => file.image.url !== sourceAfter[i].image.url)) throw new ChannelError('shopify_original_file_changed');
    await step(listing, 'shopify', 'delete', { id }, onStep, async () => {
      await client.query(Q.deleteProduct, { input: { id } }, true, true); return { shopify_product_id: id };
    }, async () => !(await client.product(id)));
  }
  async function endPreorder(listing:Listing,onStep:OnStep) {
    assertWrites(rt);const id=listing.shopify_product_id;
    if(!id)throw new ChannelError('shopify_product_not_staged');
    const p=await client.product(id);owned(p,listing);const variantId=p.variants.nodes[0].id;
    await step(listing,'shopify','preorder_end_policy',{revision:listing.revision,id,variantId},onStep,async()=>{
      await client.query(Q.policy,{id,variants:[{id:variantId,inventoryPolicy:'DENY'}]},true,true);return {shopify_product_id:id};
    },async()=>{const actual=await client.product(id);return actual.variants.nodes.find((v:any)=>v.id===variantId)?.inventoryPolicy==='DENY';});
    await step(listing,'shopify','preorder_end_label',{revision:listing.revision,id},onStep,async()=>{
      await client.query(Q.metaDelete,{metafields:[{ownerId:id,namespace:'custom',key:'preorder_label'}]},true,true);return {shopify_product_id:id};
    },async()=>!(await client.product(id)).metafields.nodes.some((m:any)=>m.namespace==='custom'&&m.key==='preorder_label'));
    return id;
  }
  return { configured: client.configured, check, sync, publish, remove, upload: files.original, client,endPreorder };
}
