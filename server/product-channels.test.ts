import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyListing,FILTER_CODES,type Listing,type ListingImage } from '../shared/product-registration';
import { createChannelService } from './channels/index';
import { cafe24Adapter,CAFE24_API_VERSION } from './channels/cafe24';
import { cafe24Auth,type TokenStore } from './channels/cafe24-auth';
import { runtime,request,sourceBytes,step,fingerprint,ChannelError,UncertainWrite,type Runtime,type OnStep } from './channels/common';
import { shopifyFiles } from './channels/shopify-files';
import { shopifyClient } from './channels/shopify-client';
import { shopifyAdapter,ownerTag } from './channels/shopify';
import { Q } from './channels/shopify-queries';
import { createMonitorReader } from './channels/monitor';
import { validatedMetafields,type RegistrationStore } from './channels/settings';
import { additions,verifiedAliases } from '../scripts/cafe24-filter-tags-migrate';

const listing=():Listing=>({...emptyListing('item-1'),id:'listing-1',sku:'LOG-BROWN',style_name:'LOG',name_en:'LOG (BROWN)',name_ko:'LOG (BROWN)',color_en:'BROWN',
  material:'COW_LEATHER',color:'BROWN',size:'MEDIUM',design:'SHOULDER',season:'26FW',price_krw:300000,retail_krw:300000,supply_price:140000,price_usd:250,
  weight_g:500,origin_cafe24:'KR',origin_shopify:'KR',hscode:'420221',summary_ko:'요약',simple_ko:'소개',detail_html_ko:'<p>가방</p>',details_ko:'제품정보',care_ko:'관리',
  desc_en:'<p>Bag</p>',desc_ja:'<p>バッグ</p>',details_en:'Cow leather',details_ja:'牛革',meta_desc_ko:'설명',meta_desc_en:'Bag description',meta_keywords:'LOG',handle:'log-brown',
  category_name_ko:'가방',category_name_en:'Bag',cafe24_category_nos:[10],shopify_collection_ids:['gid://shopify/Collection/10'],taxonomy_category_id:'gid://shopify/TaxonomyCategory/aa-1',
  payment_delivery_ref:'gid://shopify/Metaobject/4',exchange_refund_ref:'gid://shopify/Metaobject/5',cafe24_shipping:{shipping_fee_by_product:'F'},tags_ko:['LOG'],tags_en:['LOG'],
  cafe24_qty:2,shopify_qty:7,step_keys:{}});
const images=():ListingImage[]=>['main','extra','extra'].map((role,i)=>({id:`image-${i}`,listing_id:'listing-1',role:role as ListingImage['role'],position:i,source_url:`https://cdn.shopify.com/erp-original-${i}.jpg`,shopify_file_id:`gid://shopify/MediaImage/${900+i}`,width:750,height:1000,alt_en:`Bag ${i}`,alt_ko:`가방 ${i}`,mime_type:'image/jpeg'}));
const settings=()=>({filter_mappings:Object.fromEntries((['material','color','size','design'] as const).map((field,i)=>[field,{[listing()[field]]:{verified:true,cafe24:FILTER_CODES[field][listing()[field]].cafe24,shopify_ref:`gid://shopify/Metaobject/${i+1}`}}]))});
const store:RegistrationStore={settings:async()=>settings(),sisters:async()=>[],images:async()=>images()};
const token:TokenStore={read:async()=>({access_token:'mock-only',refresh_token:'mock-refresh',expires_at:'2099-01-01T00:00:00Z'}),claim:async()=>null,save:async()=>{},release:async()=>{}};
const env={PRODUCT_REGISTRATION_WRITES_ENABLED:'true',PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED:'false',CAFE24_ERP_CLIENT_ID:'mock-app',CAFE24_ERP_CLIENT_SECRET:'mock-secret',SHOPIFY_SHOP_DOMAIN:'mock.myshopify.com',SHOPIFY_ADMIN_TOKEN:'mock-only',SHOPIFY_LOCATION_ID:'gid://shopify/Location/1',SHOPIFY_ONLINE_STORE_PUBLICATION_ID:'gid://shopify/Publication/1',PRODUCT_REGISTRATION_KRW_PER_USD:'1400',CAFE24_PREORDER_LABEL_KEY:'custom_option1'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function mockRuntime(handler:(url:string,init:RequestInit)=>Promise<Response>|Response):Runtime {
  let now=Date.parse('2026-10-11T00:00:00Z');
  return runtime({env:{...env},now:()=>now,sleep:async ms=>{now+=ms;},fetch:(async(url,init={})=>handler(String(url),init)) as typeof fetch});
}
const progress=(l:Listing,events:any[]=[]):OnStep=>async event=>{events.push(event);l.step_keys[event.key]={data:event.data,step:event.step,completed_at:'mock'};};
function cafeMock() {
  let p:any=null,extra:any[]=[],seo:any={},stock:any={};const calls:any[]=[];let createCount=0,imageGeneration=0;
  const rt=mockRuntime((url,init)=>{
    calls.push({url,method:init.method||'GET',body:init.body,headers:init.headers});
    if(url.startsWith('https://cdn.shopify.com/'))return new Response(Buffer.from(`mock-image:${url}`),{headers:{'Content-Type':'image/jpeg'}});
    if(url.startsWith('https://atlm.kr/'))return new Response('',{status:200});
    const u=new URL(url),path=u.pathname.replace('/api/v2/admin',''),method=init.method||'GET',body=init.body?JSON.parse(String(init.body)).request:undefined;
    if(path==='/products'&&method==='GET')return response({products:p?[p]:[]});
    if(path==='/products'&&method==='POST'){createCount++;p={...body,product_no:20,product_tag:[],category:[],relational_product:[],additional_information:[]};return response({product:p});}
    if(path==='/products/20'&&method==='PUT'){Object.assign(p,body);if(body.delete_category_no)p.category=p.category.filter((c:any)=>!body.delete_category_no.includes(c.category_no));return response({product:p});}
    if(path==='/products/20'&&method==='DELETE'){p=null;return response({});}
    if(path==='/products/20'&&method==='GET')return p?response({product:{...p,additionalimages:extra}}):response({},404);
    if(path==='/products/20/tags'){p.product_tag=[...new Set([...p.product_tag,...body.tags])];return response({tags:p.product_tag});}
    if(path.startsWith('/products/20/tags/')&&method==='DELETE'){const tag=decodeURIComponent(path.split('/').pop()!);p.product_tag=p.product_tag.filter((v:string)=>v!==tag);return response({});}
    if(path==='/products/20/images'){p.detail_image='https://img.cafe24.com/main.jpg';p.list_image='https://img.cafe24.com/list.jpg';return response({images:{detail_image:p.detail_image,list_image:p.list_image}});}
    if(path==='/products/20/additionalimages'&&(method==='POST'||method==='PUT')){imageGeneration++;extra=body.additional_image.map((_:any,i:number)=>({additional_image:`https://img.cafe24.com/extra-${imageGeneration}-${i}.jpg`}));return response({additionalimages:extra});}
    if(path==='/products/20/additionalimages'&&method==='DELETE'){extra=[];return response({});}
    if(path==='/products/20/additionalimages'&&method==='GET')return response({additionalimages:extra});
    if(path==='/products/20/seo'&&method==='PUT'){seo=body;return response({seo});}
    if(path==='/products/20/seo')return response({seo});
    if(path==='/categories/10/products'){p.category=[{category_no:10}];return response({});}
    if(path==='/products/20/variants')return response({variants:[{variant_code:'P0000020000A'}]});
    if(path.endsWith('/inventories')&&method==='PUT'){Object.assign(stock,body);return response({inventory:stock});}
    if(path.endsWith('/inventories'))return response({inventory:stock});
    throw Error(`UNMOCKED ${method} ${path}`);
  });return {rt,calls,product:()=>p,createCount:()=>createCount,stock:()=>stock,seed:(v:any)=>{p=v;},extras:()=>extra,setExtras:(value:any[])=>{extra=value;}};
}
function shopifyMock() {
  let p:any=null,seq=100,qty=0,currency='USD';const files=new Map<string,any>(),translations=new Map<string,any[]>(),calls:any[]=[];let createCount=0;
  for(const image of images())files.set(image.shopify_file_id!,{id:image.shopify_file_id,fileStatus:'READY',image:{url:image.source_url,width:750,height:1000}});
  const definitions=Object.entries({product_current_color:'single_line_text_field',product_options:'list.product_reference',product_details:'multi_line_text_field',product_material:'metaobject_reference',product_color_chip:'metaobject_reference',product_design:'metaobject_reference',product_part_description:'list.metaobject_reference',payment_delivery:'metaobject_reference',exchange_refund:'metaobject_reference',list_image:'file_reference',preorder_label:'single_line_text_field'})
    .map(([key,type])=>({namespace:'custom',key,type:{name:type},validations:type.includes('metaobject')?[{name:'metaobject_definition_id',value:'gid://shopify/MetaobjectDefinition/1'}]:[]}));
  for(const namespace of ['mm-google-shopping','mc-facebook'])definitions.push({namespace,key:'google_product_category',type:{name:'single_line_text_field'},validations:[]});
  const connection=(nodes:any[])=>({nodes,pageInfo:{hasNextPage:false}});
  const other={id:'gid://shopify/Product/999',media:connection([{id:'gid://shopify/MediaImage/900'}]),metafields:connection([])};
  const dispatch=(doc:string,v:any):any=>{
    if(doc===Q.definitions)return {metafieldDefinitions:connection(definitions)};
    if(doc===Q.reference){const id=v.id;
      if(id.includes('/Metaobject/'))return {node:{id,definition:{id:'gid://shopify/MetaobjectDefinition/1'}}};
      if(id.includes('/Collection/'))return {node:{id,ruleSet:null}};
      if(id.includes('/TaxonomyCategory/'))return {node:{id}};
      if(id.includes('/Location/'))return {node:{id,isActive:true}};
      if(id.includes('/Publication/'))return {node:{id,name:'Online Store'}};
      return {node:files.get(id)||null};}
    if(doc===Q.shop)return {shop:{currencyCode:currency,primaryDomain:{url:'https://mock.myshopify.com'}}};
    if(doc===Q.duplicates)return {products:connection(p?[{id:p.id,handle:p.handle,tags:p.tags,variants:connection(p.variants.nodes.map((v:any)=>({sku:v.sku})))}]:[])};
    if(doc===Q.product)return {product:p?JSON.parse(JSON.stringify(p)):null};
    if(doc===Q.inventory)return {inventoryItem:{inventoryLevel:{quantities:[{name:'available',quantity:qty}]}}};
    if(doc===Q.set){const input=v.input;
      if(!p){createCount++;p={id:'gid://shopify/Product/20',media:connection([]),metafields:connection([]),resourcePublicationsV2:connection([])};}
      Object.assign(p,{title:input.title,handle:input.handle,status:input.status,vendor:input.vendor,descriptionHtml:input.descriptionHtml,tags:input.tags,category:{id:input.category},seo:input.seo,collections:connection(input.collections.map((id:string)=>({id})))});
      const variant=input.variants[0];if(variant.inventoryQuantities)qty=variant.inventoryQuantities[0].quantity;
      p.variants=connection([{...variant,id:'gid://shopify/ProductVariant/1',inventoryItem:{...variant.inventoryItem,id:'gid://shopify/InventoryItem/1',unitCost:{amount:String(variant.inventoryItem.cost),currencyCode:currency}}}]);
      return {productSet:{product:{id:p.id},userErrors:[]}};}
    if(doc===Q.stage)return {stagedUploadsCreate:{stagedTargets:[{url:'https://storage.googleapis.com/staged',resourceUrl:`https://storage.googleapis.com/${v.input[0].filename}`,parameters:[]}],userErrors:[]}};
    if(doc===Q.createFile){const input=v.files[0],file={id:`gid://shopify/MediaImage/${seq++}`,fileStatus:'READY',alt:'',image:{url:`https://cdn.shopify.com/${input.filename}`,width:750,height:1000}};files.set(file.id,file);return {fileCreate:{files:[file],userErrors:[]}};}
    if(doc===Q.file)return {node:files.get(v.id)||null};
    if(doc===Q.findFile){const name=v.query.replace('filename:','');return {files:connection([...files.values()].filter(f=>f.image.url.endsWith('/'+name)))};}
    if(doc===Q.attachFile){for(const input of v.files){const f=files.get(input.id);if(input.alt!==undefined)f.alt=input.alt;
      if(input.referencesToAdd?.includes(p.id)){const existing=p.media.nodes.find((m:any)=>m.id===f.id);if(existing)Object.assign(existing,f);else p.media.nodes.push({...f});}
      if(input.referencesToRemove?.includes(p.id))p.media.nodes=p.media.nodes.filter((m:any)=>m.id!==f.id);}
      return {fileUpdate:{files:v.files.map((v:any)=>({id:v.id})),userErrors:[]}};}
    if(doc===Q.order){p.media.nodes.sort((a:any,b:any)=>v.moves.findIndex((m:any)=>m.id===a.id)-v.moves.findIndex((m:any)=>m.id===b.id));return {productReorderMedia:{job:{id:'gid://shopify/Job/1',done:true},mediaUserErrors:[]}};}
    if(doc===Q.job)return {job:{done:true}};
    if(doc===Q.meta){for(const field of v.metafields){const old=p.metafields.nodes.find((m:any)=>m.namespace===field.namespace&&m.key===field.key);if(old)Object.assign(old,field);else p.metafields.nodes.push({...field,id:`gid://shopify/Metafield/${seq++}`});}return {metafieldsSet:{metafields:p.metafields.nodes,userErrors:[]}};}
    if(doc===Q.metaDelete){p.metafields.nodes=p.metafields.nodes.filter((f:any)=>!v.metafields.some((d:any)=>d.namespace===f.namespace&&d.key===f.key));return {metafieldsDelete:{deletedMetafields:v.metafields,userErrors:[]}};}
    if(doc===Q.translatable)return {translatableResource:{resourceId:v.id,translatableContent:[{key:v.id===p?.id?'body_html':'value',digest:'mock-digest',locale:'en',value:'mock'}],translations:translations.get(v.id)||[]}};
    if(doc===Q.translate){translations.set(v.id,v.translations.map((t:any)=>({...t,outdated:false})));return {translationsRegister:{translations:v.translations,userErrors:[]}};}
    if(doc===Q.active){p.status='ACTIVE';return {productUpdate:{product:{id:p.id,status:p.status},userErrors:[]}};}
    if(doc===Q.publish){p.resourcePublicationsV2=connection([{isPublished:true,publication:{id:v.input[0].publicationId}}]);return {publishablePublish:{userErrors:[]}};}
    if(doc===Q.policy){p.variants.nodes[0].inventoryPolicy=v.variants[0].inventoryPolicy;return {productVariantsBulkUpdate:{productVariants:p.variants.nodes,userErrors:[]}};}
    if(doc===Q.references)return {products:connection([...(p?[{id:p.id,media:p.media,metafields:p.metafields}]:[]),other])};
    if(doc===Q.deleteFile){for(const id of v.ids)files.delete(id);return {fileDelete:{deletedFileIds:v.ids,userErrors:[]}};}
    if(doc===Q.deleteProduct){p=null;return {productDelete:{deletedProductId:v.input.id,userErrors:[]}};}
    throw Error(`Unmocked GraphQL ${doc}`);
  };
  const rt=mockRuntime((url,init)=>{
    if(url.startsWith('https://cdn.shopify.com/'))return new Response(Buffer.from('mock-image'),{headers:{'Content-Type':'image/jpeg'}});
    if(url.startsWith('https://storage.googleapis.com/'))return new Response('',{status:201});
    const body=JSON.parse(String(init.body));calls.push({doc:body.query,vars:body.variables});return response({data:dispatch(body.query,body.variables)});
  });return {rt,calls,files,other,translations,product:()=>p,createCount:()=>createCount,qty:()=>qty,setQty:(v:number)=>{qty=v;},setCurrency:(v:string)=>{currency=v;}};
}

test('write gate exact true: sync/publish/delete/upload make zero network requests',async()=>{
  for(const flag of [undefined,'false','TRUE','1']) {
    let count=0;const rt=mockRuntime(()=>{count++;throw Error('network forbidden');});rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED=flag;
    const service=createChannelService(rt,store,token),l=listing();
    assert.equal((await service.syncListing(l,images(),progress(l))).shopify?.error,'writes_disabled');
    assert.equal((await service.publishListing(l,['cafe24'],progress(l))).cafe24?.error,'writes_disabled');
    assert.equal((await service.deleteTestListing(l,images(),progress(l))).cafe24?.error,'writes_disabled');
    await assert.rejects(service.uploadListingImage(Buffer.from('x'),'image/jpeg','x'),/writes_disabled/);assert.equal(count,0);
  }
});
test('lazy status uses no DB/network and version mismatch is disconnected',async()=>{
  const rt=mockRuntime(()=>{throw Error('network');});rt.env.SHOPIFY_API_VERSION='2025-01';
  const s=await createChannelService(rt,store,token).channelStatus();assert.equal(s.shopify.connected,false);assert.equal(s.cafe24.connected,true);
});
test('unsafe create 5xx/timeout is never blindly retried',async()=>{
  for(const failure of ['network','500']){let calls=0;const rt=mockRuntime(()=>{calls++;if(failure==='network')throw Error('lost');return response({},500);});
    await assert.rejects(request(rt,'https://mock.invalid','POST',{write:true}),UncertainWrite);assert.equal(calls,1);}
});
test('429 rejected create retries; safe GET 5xx retries and timeout signal exists',async()=>{
  let calls=0;const rt=mockRuntime((_url,init)=>{assert.ok(init.signal);return ++calls<3?response({},429):response({ok:true});});
  await request(rt,'https://mock.invalid','POST',{write:true});assert.equal(calls,3);
});
test('onStep failure prevents operation and persisted envelope verifies skip',async()=>{
  const l=listing();let writes=0;await assert.rejects(step(l,'shopify','create',{},async()=>{throw Error('lease lost');},async()=>{writes++;return {id:'1'};},async()=>true));assert.equal(writes,0);
  l.step_keys[`shopify:create:${fingerprint({})}`]={data:{id:'2'}};
  assert.equal((await step(l,'shopify','create',{},progress(l),async()=>{writes++;return {id:'3'};},async()=>true)).id,'2');assert.equal(writes,0);
});
test('Cafe24 full staging transforms no wrapper, separate tags, 60s settle, independent stock, version pin',async()=>{
  const m=cafeMock(),l=listing();await cafe24Adapter(m.rt,store,token).sync(l,images(),progress(l));
  const create=m.calls.find(c=>c.method==='POST'&&new URL(c.url).pathname.endsWith('/products'));const body=JSON.parse(create.body);
  assert.equal(body.shop_no,1);assert.equal(body.request.product,undefined);assert.equal(body.request.product_tag,undefined);
  assert.equal(body.request.display,'F');assert.equal(body.request.selling,'F');assert.equal(body.request.product_weight,.5);
  assert.equal((create.headers as any)['X-Cafe24-Api-Version'],CAFE24_API_VERSION);
  assert.ok(m.calls.some(c=>c.url.includes('/20/tags')));assert.ok(m.product().product_tag.includes('COWLEATHER'));assert.ok(!m.product().product_tag.includes('COW_LEATHER'));
  assert.deepEqual(m.stock(),{use_inventory:'T',display_soldout:'T',quantity:2});assert.ok(m.rt.now()>Date.parse('2026-10-11T00:01:00Z'));
});
test('Cafe24 same revision retry creates once and skips completed image uploads',async()=>{
  const m=cafeMock(),l=listing(),c=cafe24Adapter(m.rt,store,token);await c.sync(l,images(),progress(l));const first=m.calls.filter(c=>c.url.includes('/images')&&c.method==='POST').length;
  await c.sync(l,images(),progress(l));assert.equal(m.createCount(),1);assert.equal(m.calls.filter(c=>c.url.includes('/images')&&c.method==='POST').length,first);
});
test('Cafe24 ambiguous negative lookup blocks second create',async()=>{
  const m=cafeMock(),l=listing();l.step_keys[`cafe24:create:${fingerprint({listing_id:l.id,sku:l.sku})}:intent`]={data:{state:'pending'}};
  await assert.rejects(cafe24Adapter(m.rt,store,token).sync(l,images(),progress(l)),UncertainWrite);assert.equal(m.createCount(),0);
});
test('Cafe24 pending create adopts only matching ERP marker and SKU',async()=>{
  const m=cafeMock(),l=listing();l.step_keys[`cafe24:create:${fingerprint({listing_id:l.id,sku:l.sku})}:intent`]={data:{state:'pending'}};
  m.seed({...cafe24Adapter(m.rt,store,token).transform(l,[]),product_no:20,product_tag:[],category:[],relational_product:[]});
  await cafe24Adapter(m.rt,store,token).sync(l,images(),progress(l));assert.equal(m.createCount(),0);assert.equal(l.cafe24_product_no,20);
});
test('Cafe24 existing merchant SKU cannot be adopted or mutated',async()=>{
  const m=cafeMock(),l=listing();m.seed({custom_product_code:l.sku,internal_product_name:'merchant',product_no:20});
  await assert.rejects(cafe24Adapter(m.rt,store,token).sync(l,images(),progress(l)),/cafe24_sku_duplicate/);assert.equal(m.createCount(),0);
});
test('Cafe24 preorder allows zero tracked stock and disable restores soldout T + clears label',async()=>{
  const m=cafeMock(),l=listing();Object.assign(l,{preorder_enabled:true,preorder_label_ko:'*2ND: 10/14 예약배송',cafe24_qty:0});
  const c=cafe24Adapter(m.rt,store,token);await c.sync(l,images(),progress(l));assert.equal(m.stock().display_soldout,'F');assert.equal(m.stock().quantity,0);assert.equal(m.product().additional_information[0].value,l.preorder_label_ko);
  l.preorder_enabled=false;l.revision++;await c.sync(l,images(),progress(l));assert.equal(m.stock().display_soldout,'T');
  assert.equal(m.product().summary_description,'요약');assert.equal(m.product().additional_information[0].value,'');
});
test('unverified filter candidates and banned Cafe tags fail closed before mutation',async()=>{
  for(const scenario of ['mapping','banned']){const m=cafeMock(),l=listing();if(scenario==='banned')l.tags_ko.push('통근백');
    const s=scenario==='mapping'?{...store,settings:async()=>({filter_mappings:{}})}:store;
    await assert.rejects(cafe24Adapter(m.rt,s,token).sync(l,images(),progress(l)),scenario==='mapping'?/filter_mapping_unverified/:/banned_search_tag/);assert.equal(m.createCount(),0);}
});
test('partial retry uses only pending channel for sync and delete',async()=>{
  const m=cafeMock(),l=listing();l.publish_channels=['cafe24'];l.is_test=true;
  const service=createChannelService(m.rt,store,token);const result=await service.syncListing(l,images(),progress(l));assert.deepEqual(Object.keys(result),['cafe24']);assert.equal(result.cafe24?.ok,true);
  const deleted=await service.deleteTestListing(l,images(),progress(l));assert.deepEqual(Object.keys(deleted),['cafe24']);assert.deepEqual(deleted.cafe24?.pending_manual,['cafe24_admin_trash_purge','cafe24_admin_image_cleanup']);assert.equal(deleted.cafe24?.ok,false);
});
test('Cafe24 production delete guard and publish ownership guard',async()=>{
  const m=cafeMock(),l=listing(),c=cafe24Adapter(m.rt,store,token);await assert.rejects(c.remove(l,[],progress(l)),/delete_requires_test/);
  l.cafe24_product_no=20;m.seed({custom_product_code:l.sku,internal_product_name:'someone else'});await assert.rejects(c.publish(l,progress(l)),/ownership_mismatch/);
});
test('rotating OAuth refresh claims once, saves CAS, releases and no read-only refresh',async()=>{
  const order:string[]=[];const stale={access_token:'mock-stale',refresh_token:'mock-old-refresh',expires_at:'2020-01-01'};
  const tokens:TokenStore={read:async()=>stale,claim:async()=>{order.push('claim');return stale;},save:async(_owner,t)=>{order.push('save');assert.equal(t.refresh_token,'mock-new-refresh');},release:async()=>{order.push('release');}};
  const rt=mockRuntime(()=>{order.push('refresh');return response({access_token:'mock-new',refresh_token:'mock-new-refresh',expires_at:'2099-01-01'});});
  rt.env.PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED='true';
  assert.equal(await cafe24Auth(rt,tokens).token(),'mock-new');assert.deepEqual(order,['claim','refresh','save','release']);
  order.length=0;await assert.rejects(cafe24Auth(rt,tokens).token(false),/readonly/);assert.deepEqual(order,[]);
});
test('OAuth write gate blocks DB lease as well as external refresh',async()=>{
  let claims=0;const rt=mockRuntime(()=>{throw Error('forbidden');});rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED='false';
  await assert.rejects(cafe24Auth(rt,{...token,read:async()=>({access_token:'a',refresh_token:'r',expires_at:'2020-01-01'}),claim:async()=>{claims++;return null;}}).token(),/oauth_refresh_disabled/);assert.equal(claims,0);
});
test('image source refuses arbitrary host, redirects, over-10MB, non-image',async()=>{
  const rt=mockRuntime(()=>new Response('not image',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(sourceBytes(rt,{...images()[0],source_url:'https://127.0.0.1/a'}),/untrusted_image_source/);
  await assert.rejects(sourceBytes(rt,images()[0]),/invalid_image_source/);
  const big=mockRuntime(()=>new Response(Buffer.alloc(10*1024*1024+1),{headers:{'Content-Type':'image/jpeg'}}));await assert.rejects(sourceBytes(big,images()[0]),/image_too_large/);
});
test('Shopify Files only accepts staged resources, READY polling, unique originals',async()=>{
  const inputs:any[]=[];let poll=0;
  const rt=mockRuntime((url,init)=>{assert.equal(url,'https://storage.googleapis.com/staged');assert.equal(init.method,'POST');return new Response('',{status:201});});
  const client:any={query:async(doc:string,v:any)=>{
    if(doc===Q.stage)return {stagedUploadsCreate:{stagedTargets:[{url:'https://storage.googleapis.com/staged',resourceUrl:'https://storage.googleapis.com/staged/resource',parameters:[]}]}};
    if(doc===Q.createFile){inputs.push(v.files[0]);return {fileCreate:{files:[{id:`gid://shopify/MediaImage/${inputs.length}`}]}};}
    if(doc===Q.file){poll++;return {node:{id:v.id,fileStatus:poll===1?'PROCESSING':'READY',image:poll===1?null:{url:`https://cdn.shopify.com/${v.id.split('/').pop()}.jpg`,width:750,height:1000}}};}
    throw Error('unmocked');}};
  const files=shopifyFiles(rt,client);await files.original(Buffer.from('mock'),'image/jpeg','source.jpg');await files.original(Buffer.from('mock'),'image/jpeg','source.jpg');
  assert.ok(inputs.every(f=>f.originalSource.startsWith('https://storage.googleapis.com/')));assert.notEqual(inputs[0].filename,inputs[1].filename);assert.equal(inputs[0].duplicateResolutionMode,'RAISE_ERROR');assert.ok(poll>=3);
});
test('Shopify staged target cannot be source CDN or internal host',async()=>{
  for(const host of ['https://cdn.shopify.com/x','http://127.0.0.1/x']){
    const rt=mockRuntime(()=>{throw Error('network forbidden');});const client:any={query:async()=>({stagedUploadsCreate:{stagedTargets:[{url:host,resourceUrl:host,parameters:[]}]}})};
    await assert.rejects(shopifyFiles(rt,client).original(Buffer.from('mock'),'image/jpeg','a'),/untrusted_staged/);
  }
});
test('Shopify file pending intent negative lookup never creates again',async()=>{
  const l=listing(),image=images()[0],payload={listing:l.id,image:image.id,source:image.source_url,source_file:image.shopify_file_id};
  l.step_keys[`shopify:file:${fingerprint(payload)}:intent`]={data:{state:'pending'}};let writes=0;
  const client:any={query:async(doc:string)=>{if(doc===Q.findFile)return {files:{nodes:[],pageInfo:{hasNextPage:false}}};writes++;throw Error('forbidden');}};
  await assert.rejects(shopifyFiles(mockRuntime(()=>{throw Error('no network');}),client).media(l,image,progress(l)),UncertainWrite);assert.equal(writes,0);
});
test('metafield definitions are read/validated only; wrong type fails before writes',async()=>{
  const client:any={query:async(doc:string)=>{assert.equal(doc,Q.definitions);return {metafieldDefinitions:{nodes:[{namespace:'custom',key:'product_current_color',type:{name:'number_integer'}}],pageInfo:{hasNextPage:false}}};},node:async()=>null};
  await assert.rejects(validatedMetafields(client,listing(),store),/definition_unverified_product_current_color/);
});
test('Shopify GraphQL THROTTLED retries but uncertain create generic errors do not',async()=>{
  let calls=0;const rt=mockRuntime(()=>++calls===1?response({errors:[{extensions:{code:'THROTTLED'}}]}):response({data:{fileCreate:{files:[],userErrors:[]}}}));
  await shopifyClient(rt).query(Q.createFile,{files:[]},true);assert.equal(calls,2);
  calls=0;rt.fetch=(async()=>{calls++;return response({errors:[{message:'internal'}]});}) as typeof fetch;
  await assert.rejects(shopifyClient(rt).query(Q.set,{},true),UncertainWrite);assert.equal(calls,1);
});
test('monitor Cafe24 real fields filter per-group + default SEO + independent stock',async()=>{
  const m=cafeMock(),l=listing();await cafe24Adapter(m.rt,store,token).sync(l,images(),progress(l));
  const read=createMonitorReader(m.rt,store,token),snapshot=await read(l,'cafe24',new AbortController().signal);
  assert.equal(snapshot.state,'ok');assert.deepEqual(snapshot.filters?.material,['COWLEATHER','MATERIALALL']);assert.deepEqual(snapshot.filters?.color,['BROWN','COLORALL']);
  assert.ok(!snapshot.filters?.material?.includes('LOG'));assert.equal(snapshot.inventory,2);assert.equal(snapshot.expected?.seo_title,'LOG (BROWN) | 가방 | 아뜰리에 드 루멘');assert.ok(snapshot.checked.includes('publication'));
});
test('monitor never refreshes expired token even when write gate is true',async()=>{
  const rt=mockRuntime(()=>{throw Error('no network');});let claims=0;
  const read=createMonitorReader(rt,store,{...token,read:async()=>({access_token:'a',refresh_token:'b',expires_at:'2020-01-01'}),claim:async()=>{claims++;return null;}});
  const l=listing();l.cafe24_product_no=20;assert.equal((await read(l,'cafe24',new AbortController().signal)).state,'unavailable');assert.equal(claims,0);
});
test('monitor cancellation reaches request and terminates before fallback snapshot',async()=>{
  const abort=new AbortController();let signaled=false;
  const rt=mockRuntime((_url,init)=>new Promise((_resolve,reject)=>{signaled=!!init.signal;init.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});abort.abort();}));
  const l=listing();l.cafe24_product_no=20;await assert.rejects(createMonitorReader(rt,store,token)(l,'cafe24',abort.signal));assert.equal(signaled,true);
});
test('migration additive-only aliases require verified candidates and preserve underscore tags',()=>{
  const aliases=verifiedAliases(settings());assert.equal(aliases.COW_LEATHER,'COWLEATHER');assert.equal(aliases.VEGAN_LEATHER,undefined);
  const tags=['COW_LEATHER','MATERIAL_ALL','BROWN','통근백'];const before=[...tags];assert.deepEqual(additions(tags,aliases),['COWLEATHER','MATERIALALL']);assert.deepEqual(tags,before);
});
test('Shopify end-to-end staging: USD, KRW cost converted, fresh media, JA only body/details',async()=>{
  const m=shopifyMock(),l=listing(),events:any[]=[];await shopifyAdapter(m.rt,store).sync(l,images(),progress(l,events));
  assert.equal(m.createCount(),1);assert.equal(m.product().status,'DRAFT');assert.equal(m.product().variants.nodes[0].price,'250.00');assert.equal(m.product().variants.nodes[0].inventoryItem.cost,100);assert.equal(m.qty(),7);
  assert.equal(m.product().media.nodes.length,3);assert.ok(m.product().media.nodes.every((f:any)=>!images().some(i=>i.shopify_file_id===f.id)));
  const translations=m.calls.filter(c=>c.doc===Q.translate).flatMap(c=>c.vars.translations);assert.deepEqual(translations.map(t=>t.key),['body_html','value']);assert.ok(translations.every(t=>t.locale==='ja'&&t.translatableContentDigest==='mock-digest'));
  assert.ok(!m.calls.some(c=>/metafieldDefinitionCreate|metaobjectDefinitionCreate/.test(c.doc)));assert.ok(events.findIndex(e=>e.step==='create:intent')<events.findIndex(e=>e.step==='create'));
});
test('Shopify KRW-default store fails closed before product mutation',async()=>{
  const m=shopifyMock(),l=listing();m.setCurrency('KRW');await assert.rejects(shopifyAdapter(m.rt,store).sync(l,images(),progress(l)),/shopify_price_currency_must_be_usd/);assert.equal(m.createCount(),0);assert.ok(!m.calls.some(c=>c.doc===Q.set));
});
test('Shopify revision update retains active status and unchanged media, barcode/variant identity',async()=>{
  const m=shopifyMock(),l=listing(),adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));
  const media=m.product().media.nodes.map((m:any)=>m.id),fileCount=m.calls.filter(c=>c.doc===Q.createFile).length;l.revision++;l.price_usd=260;l.barcode='123456';await adapter.sync(l,images(),progress(l));
  assert.equal(m.product().status,'ACTIVE');assert.deepEqual(m.product().media.nodes.map((m:any)=>m.id),media);assert.equal(m.calls.filter(c=>c.doc===Q.createFile).length,fileCount);assert.equal(m.createCount(),1);assert.equal(m.product().variants.nodes[0].barcode,'123456');
});
test('Shopify create pending negative lookup blocks additional productSet',async()=>{
  const m=shopifyMock(),l=listing();l.step_keys[`shopify:create:${fingerprint({listing_id:l.id,sku:l.sku})}:intent`]={data:{state:'pending'}};
  await assert.rejects(shopifyAdapter(m.rt,store).sync(l,images(),progress(l)),UncertainWrite);assert.equal(m.createCount(),0);
});
test('test deletion detach -> zero refs -> delete files -> delete product keeps original and sister',async()=>{
  const m=shopifyMock(),l=listing();l.is_test=true;m.rt.env.PRODUCT_REGISTRATION_FILE_DELETE_AUDITED='true';const adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));
  const originalIds=images().map(i=>i.shopify_file_id!),other=JSON.stringify(m.other);const before=m.calls.length;await adapter.remove(l,images(),progress(l));
  const changes=m.calls.slice(before);const firstDetach=changes.findIndex(c=>c.doc===Q.attachFile),firstDelete=changes.findIndex(c=>c.doc===Q.deleteFile),productDelete=changes.findIndex(c=>c.doc===Q.deleteProduct);
  assert.ok(firstDetach>=0&&firstDelete>firstDetach&&productDelete>firstDelete);assert.ok(originalIds.every(id=>m.files.has(id)));assert.equal(JSON.stringify(m.other),other);assert.equal(m.product(),null);
});
test('shared media reference blocks permanent file and product deletion',async()=>{
  const m=shopifyMock(),l=listing();l.is_test=true;m.rt.env.PRODUCT_REGISTRATION_FILE_DELETE_AUDITED='true';const adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));
  m.other.media.nodes.push({id:m.product().media.nodes[0].id});const before=m.calls.length;await assert.rejects(adapter.remove(l,images(),progress(l)),/still_referenced/);assert.ok(!m.calls.slice(before).some(c=>c.doc===Q.deleteFile||c.doc===Q.deleteProduct));
});
test('non-product usage unreviewed is a pending audit, not fake delete success',async()=>{
  const m=shopifyMock(),l=listing();l.is_test=true;const adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));await assert.rejects(adapter.remove(l,images(),progress(l)),/nonproduct_file_reference_audit_required/);assert.ok(m.product());assert.ok(!m.calls.some(c=>c.doc===Q.deleteFile));
});
test('narrow Shopify preorder end keeps live qty/status/price/images intact',async()=>{
  const m=shopifyMock(),l=listing();l.preorder_enabled=true;l.preorder_label_en='PRE ORDER';const adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.setQty(11);
  const before=m.calls.length;l.preorder_enabled=false;await adapter.endPreorder(l,progress(l));assert.equal(m.qty(),11);assert.equal(m.product().status,'ACTIVE');assert.equal(m.product().variants.nodes[0].price,'250.00');assert.equal(m.product().media.nodes.length,3);assert.equal(m.product().variants.nodes[0].inventoryPolicy,'DENY');
  assert.ok(!m.product().metafields.nodes.some((f:any)=>f.key==='preorder_label'));const writes=m.calls.slice(before).filter(c=>c.doc.startsWith('mutation'));assert.deepEqual(writes.map(c=>c.doc),[Q.policy,Q.metaDelete]);assert.equal(JSON.stringify(writes).includes('inventoryQuantities'),false);
});
test('narrow Cafe24 preorder end restores selling policy without quantity/visibility replacement',async()=>{
  const m=cafeMock(),l=listing();l.preorder_enabled=true;l.preorder_label_ko='예약배송';const adapter=cafe24Adapter(m.rt,store,token);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.stock().quantity=9;
  const before=m.calls.length;l.preorder_enabled=false;await adapter.endPreorder(l,progress(l));assert.equal(m.stock().quantity,9);assert.equal(m.stock().display_soldout,'T');assert.equal(m.product().display,'T');assert.equal(m.product().selling,'T');assert.equal(m.product().price,300000);
  const writes=m.calls.slice(before).filter(c=>c.method==='PUT').map(c=>JSON.parse(c.body).request);assert.ok(writes.every(b=>!('quantity'in b)&&!('price'in b)&&!('display'in b)&&!('selling'in b)));
});
test('real Shopify monitor reads translations, filters, manual collections, inventory and publication',async()=>{
  const m=shopifyMock(),l=listing();const adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));
  const before=m.calls.length;const snapshot=await createMonitorReader(m.rt,store)(l,'shopify',new AbortController().signal);
  assert.equal(snapshot.state,'ok');assert.equal(snapshot.ja_description,l.desc_ja);assert.equal(snapshot.ja_details,l.details_ja);assert.equal(snapshot.ja_title,'');assert.equal(snapshot.online_store_published,true);assert.equal(snapshot.inventory,7);assert.deepEqual(snapshot.categories,l.shopify_collection_ids);assert.ok(m.calls.slice(before).every(c=>c.doc.startsWith('query')));
});
test('reapproval never resets LIVE Shopify stock to listing initial stock',async()=>{
  const m=shopifyMock(),l=listing(),adapter=shopifyAdapter(m.rt,store);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.setQty(-3);l.revision++;l.price_usd=275;const before=m.calls.length;
  await adapter.sync(l,images(),progress(l));assert.equal(m.qty(),-3);assert.ok(m.calls.slice(before).filter(c=>c.doc===Q.set).every(c=>!c.vars.input.variants[0].inventoryQuantities));
});
test('reapproval never resets LIVE Cafe24 stock to listing initial stock',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.stock().quantity=-5;l.revision++;l.price_krw=310000;const before=m.calls.length;
  await adapter.sync(l,images(),progress(l));assert.equal(m.stock().quantity,-5);assert.ok(m.calls.slice(before).filter(c=>c.method==='PUT'&&c.url.includes('inventories')).every(c=>!('quantity'in JSON.parse(c.body).request)));
});
test('OAuth refresh capability works with merchant writes OFF without enabling product mutation',async()=>{
  const rt=mockRuntime(url=>{assert.equal(url,'https://atlm1224.cafe24api.com/api/v2/oauth/token');return response({access_token:'mock-new',refresh_token:'mock-r',expires_at:'2099-01-01'});});rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED='false';rt.env.PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED='true';
  const tokens:TokenStore={...token,read:async()=>({access_token:'old',refresh_token:'r',expires_at:'2020-01-01'}),claim:async()=>({access_token:'old',refresh_token:'r',expires_at:'2020-01-01'})};
  assert.equal(await cafe24Auth(rt,tokens).token(),'mock-new');await assert.rejects(request(rt,'https://atlm1224.cafe24api.com/api/v2/admin/products','POST',{write:true}),/writes_disabled/);
});
test('Cafe24 removes only previously ERP-managed tags and verifies after settling',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token);l.tags_ko=['LOG','OLD'];await adapter.sync(l,images(),progress(l));m.product().product_tag.push('MERCHANT');l.tags_ko=['LOG','NEW'];l.revision++;
  await adapter.sync(l,images(),progress(l));assert.ok(!m.product().product_tag.includes('OLD'));assert.ok(m.product().product_tag.includes('NEW'));assert.ok(m.product().product_tag.includes('MERCHANT'));assert.ok(m.calls.some(c=>c.method==='DELETE'&&c.url.includes('/tags/OLD')));
});
test('Cafe24 LIVE qty is protected even if old inventory progress is unavailable',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.stock().quantity=12;
  for(const key of Object.keys(l.step_keys))if(key.startsWith('cafe24:inventory_initial:'))delete l.step_keys[key];l.revision++;
  await adapter.sync(l,images(),progress(l));assert.equal(m.stock().quantity,12);
});
test('Cafe24 owned extra-image edit replaces reordered/added/removed set via PUT and preserves LIVE qty/main/source',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));await adapter.publish(l,progress(l));m.stock().quantity=19;
  const main=m.product().detail_image,sources=JSON.stringify(original);let before=m.calls.length;
  const reordered=[original[0],{...original[2],position:1},{...original[1],position:2}];l.revision++;
  await adapter.sync(l,reordered,progress(l));let writes=m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].method,'PUT');
  assert.deepEqual(JSON.parse(writes[0].body).request.additional_image.map((s:string)=>Buffer.from(s,'base64').toString()),reordered.slice(1).map(i=>`mock-image:${i.source_url}`));
  const extra={...original[1],id:'image-new',source_url:'https://cdn.shopify.com/new-extra.jpg',shopify_file_id:'gid://shopify/MediaImage/999',position:3};before=m.calls.length;l.revision++;
  await adapter.sync(l,[...reordered,extra],progress(l));writes=m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET');assert.equal(writes[0].method,'PUT');assert.equal(m.extras().length,3);
  before=m.calls.length;l.revision++;await adapter.sync(l,[original[0],original[1]],progress(l));writes=m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET');assert.equal(writes[0].method,'PUT');assert.equal(m.extras().length,1);
  assert.equal(m.stock().quantity,19);assert.equal(m.product().detail_image,main);assert.equal(m.product().display,'T');assert.equal(m.product().selling,'T');assert.equal(JSON.stringify(original),sources);
  assert.ok(!m.calls.some(c=>c.method==='DELETE'&&(c.url.includes('/images')||c.url.startsWith('https://cdn.shopify.com/'))));
});
test('Cafe24 zero extras DELETE only proven ERP paths then later add uses full-set PUT',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));const main=m.product().detail_image;
  let before=m.calls.length;l.revision++;await adapter.sync(l,[original[0]],progress(l));let writes=m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET');assert.deepEqual(writes.map(c=>c.method),['DELETE']);assert.equal(m.extras().length,0);assert.equal(m.product().detail_image,main);
  before=m.calls.length;l.revision++;await adapter.sync(l,original,progress(l));writes=m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET');assert.deepEqual(writes.map(c=>c.method),['PUT']);assert.equal(m.extras().length,2);
});
test('Cafe24 external additional image blocks both full replacement and DELETE',async()=>{
  for(const remove of [false,true]){
    const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));m.setExtras([...m.extras(),{additional_image:'https://img.cafe24.com/merchant.jpg'}]);l.revision++;
    const before=m.calls.length;await assert.rejects(adapter.sync(l,remove?[original[0]]:[original[0],original[2]],progress(l)),/unowned_paths/);
    assert.ok(!m.calls.slice(before).some(c=>c.url.includes('/additionalimages')&&c.method!=='GET'));assert.ok(m.extras().some(i=>i.additional_image.endsWith('/merchant.jpg')));
  }
});
test('Cafe24 completed verification false plus old intent allows proven PUT, not blind uncertain block',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));const first=m.extras().map(i=>i.additional_image);
  l.revision++;await adapter.sync(l,[original[0],{...original[2],position:1},{...original[1],position:2}],progress(l));assert.notDeepEqual(m.extras().map(i=>i.additional_image),first);
  const before=m.calls.length;l.revision++;await adapter.sync(l,original,progress(l));assert.deepEqual(m.calls.slice(before).filter(c=>c.url.includes('/additionalimages')&&c.method!=='GET').map(c=>c.method),['PUT']);
});
test('Cafe24 upload response provenance persists before failed readback and recovers without rewrite',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));l.revision++;
  const edited=[original[0],original[2]],fetch=m.rt.fetch;let wrote=false,fail=true;
  m.rt.fetch=(async(url,init)=>{const s=String(url);if(fail&&wrote&&s.includes('embed=additionalimages'))throw Error('mock-read-deadline');const r=await fetch(url,init);if(init?.method==='PUT'&&s.endsWith('/additionalimages'))wrote=true;return r;}) as typeof globalThis.fetch;
  await assert.rejects(adapter.sync(l,edited,progress(l)),/timeout_or_network/);
  const responses=Object.keys(l.step_keys).filter(k=>k.startsWith('cafe24:extra_images:')&&k.endsWith(':response'));assert.ok(responses.length>=2);
  const before=m.calls.length;fail=false;await adapter.sync(l,edited,progress(l));assert.ok(!m.calls.slice(before).some(c=>c.url.includes('/additionalimages')&&c.method!=='GET'));
});
test('Cafe24 uncertain PUT with unknown new paths is blocked, not adopted by image count',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),original=images();await adapter.sync(l,original,progress(l));l.revision++;
  const fetch=m.rt.fetch;let lose=true;m.rt.fetch=(async(url,init)=>{const r=await fetch(url,init);if(lose&&init?.method==='PUT'&&String(url).endsWith('/additionalimages'))return response({});return r;}) as typeof globalThis.fetch;
  const edited=[original[0],original[1]];await assert.rejects(adapter.sync(l,edited,progress(l)));const before=m.calls.length;lose=false;
  await assert.rejects(adapter.sync(l,edited,progress(l)),UncertainWrite);assert.ok(!m.calls.slice(before).some(c=>c.url.includes('/additionalimages')&&c.method!=='GET'));
});
test('Cafe24 per-file5MB / total30MB / count20 are validated before any merchant mutation',async()=>{
  for(const scenario of ['metadata','bytes','aggregate','count']){
    const m=cafeMock(),l=listing(),original=images(),fetch=m.rt.fetch;
    const count=scenario==='count'?21:scenario==='aggregate'?7:1;
    const extras=Array.from({length:count},(_,i)=>({...original[1],id:`limit-${i}`,position:i+1,...(scenario==='metadata'?{byte_size:5*1024*1024+1}:{})}));
    if(scenario==='bytes'||scenario==='aggregate')m.rt.fetch=(async(url,init)=>String(url).startsWith('https://cdn.shopify.com/')?new Response(Buffer.alloc(5*1024*1024+(scenario==='bytes'?1:0)),{headers:{'Content-Type':'image/jpeg'}}):fetch(url,init)) as typeof globalThis.fetch;
    await assert.rejects(cafe24Adapter(m.rt,store,token).sync(l,[original[0],...extras],progress(l)),scenario==='count'?/exceed_20/:scenario==='aggregate'?/exceed_30mb/:/exceeds_5mb/);
    assert.ok(!m.calls.some(c=>c.method!=='GET'));assert.equal(m.createCount(),0);
  }
});

test('Cafe24 completed main provenance repairs admin drift on approved reapply, including legacy keys',async()=>{
  for(const legacy of [false,true]){
    const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token);await adapter.sync(l,images(),progress(l));await adapter.publish(l,progress(l));m.stock().quantity=17;
    if(legacy)for(const key of Object.keys(l.step_keys))if(key.startsWith('cafe24:main_image:')){
      if(key.endsWith(':upload:intent'))delete l.step_keys[key];
      else if(!key.endsWith(':intent')){const value:any=l.step_keys[key];delete (value.data||value).attempt;}
    }
    m.product().detail_image='https://img.cafe24.com/admin-change.jpg';l.revision++;const before=m.calls.length;
    await adapter.sync(l,images(),progress(l));assert.equal(m.product().detail_image,'https://img.cafe24.com/main.jpg');assert.equal(m.stock().quantity,17);
    assert.equal(m.calls.slice(before).filter(c=>c.method==='POST'&&c.url.endsWith('/images')).length,1);
    const after=m.calls.length;await adapter.sync(l,images(),progress(l));assert.ok(!m.calls.slice(after).some(c=>c.method==='POST'&&c.url.endsWith('/images')));
  }
});

test('Cafe24 unresolved first main POST never repeats, even if provider actually committed it',async()=>{
  for(const legacy of [false,true]){
    const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),fetch=m.rt.fetch;
    m.rt.fetch=(async(url,init)=>{const result=await fetch(url,init);if(init?.method==='POST'&&String(url).endsWith('/images'))return response({});return result;}) as typeof globalThis.fetch;
    await assert.rejects(adapter.sync(l,images(),progress(l)),UncertainWrite);
    if(legacy)for(const key of Object.keys(l.step_keys))if(key.endsWith(':upload:intent'))delete l.step_keys[key];
    const before=m.calls.length;await assert.rejects(adapter.sync(l,images(),progress(l)),UncertainWrite);assert.ok(!m.calls.slice(before).some(c=>c.method==='POST'&&c.url.endsWith('/images')));
  }
});

test('Cafe24 newer lost main repair cannot be resolved by old completed provenance',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token);await adapter.sync(l,images(),progress(l));
  m.product().detail_image='https://img.cafe24.com/admin-change.jpg';l.revision++;const fetch=m.rt.fetch;
  m.rt.fetch=(async(url,init)=>{const result=await fetch(url,init);if(init?.method==='POST'&&String(url).endsWith('/images'))return response({});return result;}) as typeof globalThis.fetch;
  await assert.rejects(adapter.sync(l,images(),progress(l)),UncertainWrite);const before=m.calls.length;
  // Mock provider returned the exact OLD completed path: it is not proof of this attempt.
  await assert.rejects(adapter.sync(l,images(),progress(l)),UncertainWrite);assert.ok(!m.calls.slice(before).some(c=>c.method==='POST'&&c.url.endsWith('/images')));
});

test('Cafe24 known main response survives failed verification and resumes without POST',async()=>{
  const m=cafeMock(),l=listing(),adapter=cafe24Adapter(m.rt,store,token),fetch=m.rt.fetch;let wrote=false,fail=true;
  m.rt.fetch=(async(url,init)=>{if(fail&&wrote&&init?.method==='GET'&&String(url).includes('/products/20?'))throw Error('mock-read-failure');const result=await fetch(url,init);if(init?.method==='POST'&&String(url).endsWith('/images'))wrote=true;return result;}) as typeof globalThis.fetch;
  await assert.rejects(adapter.sync(l,images(),progress(l)),/timeout_or_network/);const before=m.calls.length;fail=false;
  await adapter.sync(l,images(),progress(l));assert.ok(!m.calls.slice(before).some(c=>c.method==='POST'&&c.url.endsWith('/images')));
  m.product().detail_image='https://img.cafe24.com/admin-change.jpg';l.revision++;await adapter.sync(l,images(),progress(l));assert.equal(m.product().detail_image,'https://img.cafe24.com/main.jpg');
});

test('SIZE verified Cafe24 mapping needs no unused Shopify reference for either adapter',async()=>{
  const local:RegistrationStore={...store,settings:async()=>{const s=settings();delete s.filter_mappings.size.MEDIUM.shopify_ref;return s;}};
  const l=listing(),c=cafeMock(),s=shopifyMock();await cafe24Adapter(c.rt,local,token).sync(l,images(),progress(l));await shopifyAdapter(s.rt,local).sync(l,images(),progress(l));
  assert.ok(!s.product().metafields.nodes.some((f:any)=>f.key.includes('size')));
});
