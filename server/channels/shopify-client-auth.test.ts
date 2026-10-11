import test from 'node:test';
import assert from 'node:assert/strict';
import { shopifyClient } from './shopify-client';
import { runtime, UncertainWrite } from './common';

const env = { SHOPIFY_SHOP_DOMAIN:'fixture.myshopify.com', SHOPIFY_CLIENT_ID:'synthetic-id', SHOPIFY_CLIENT_SECRET:'synthetic-secret',
  ADS_COMMERCE_AUTH_ENABLED:'true', PRODUCT_REGISTRATION_WRITES_ENABLED:'false' };
test('approved client-credentials auth is cached, renews before expiry and never enables product writes', async () => {
  let clock=1_000_000, grants=0, reads=0;
  const client=shopifyClient(runtime({env, now:()=>clock, sleep:async()=>{}, fetch:(async(url,init)=> {
    assert.equal(init?.method,'POST'); assert.equal(init?.redirect,'error');
    if(String(url).endsWith('/admin/oauth/access_token')) {
      grants++; const body=new URLSearchParams(String(init?.body));
      assert.equal(body.get('grant_type'),'client_credentials'); assert.equal(body.get('client_secret'),'synthetic-secret');
      return new Response(JSON.stringify({access_token:'synthetic-token',expires_in:120}));
    }
    reads++; assert.match(String(init?.body),/query/); assert.equal(new Headers(init?.headers).get('X-Shopify-Access-Token'),'synthetic-token');
    return new Response(JSON.stringify({data:{shop:{currencyCode:'USD'}}}));
  }) as typeof fetch}), true);
  await Promise.all([client.query('query { shop { currencyCode } }'),client.query('query { shop { currencyCode } }')]);
  assert.equal(grants,1); assert.equal(reads,2);
  clock+=61_000; await client.query('query { shop { currencyCode } }'); assert.equal(grants,2);
  await assert.rejects(client.query('mutation Prohibited { productDelete(input:{id:"x"}) { deletedProductId } }',{},true),/shopify_readonly_query_required/);
  assert.equal(grants,2); assert.equal(reads,3);
});
test('unapproved auth and unsafe host never send credentials',async()=> {
  for(const overrides of [{ADS_COMMERCE_AUTH_ENABLED:'false'},{SHOPIFY_SHOP_DOMAIN:'user:pass@fixture.myshopify.com'},{SHOPIFY_SHOP_DOMAIN:'fixture.myshopify.com.evil.invalid'}]) {
    const client=shopifyClient(runtime({env:{...env,...overrides},fetch:(async()=>{throw Error('must_not_send')}) as typeof fetch}),true);
    assert.equal(client.configured(),false); await assert.rejects(client.query('query { shop { currencyCode } }'),/shopify_unconnected/);
  }
});
test('uncertain OAuth POST is never replayed; invalid tokens/expiry fail closed',async()=> {
  let calls=0;
  const client=shopifyClient(runtime({env,sleep:async()=>{},fetch:(async()=>{calls++;return new Response('',{status:500})}) as typeof fetch}),true);
  await assert.rejects(client.query('query { shop { currencyCode } }'),UncertainWrite); assert.equal(calls,1);
  for(const body of [{access_token:'bad\nheader',expires_in:3600},{access_token:'safe',expires_in:'3600'},{access_token:'safe',expires_in:60},{access_token:'safe',expires_in:999999}]) {
    const invalid=shopifyClient(runtime({env,fetch:(async()=>new Response(JSON.stringify(body))) as typeof fetch}),true);
    await assert.rejects(invalid.query('query { shop { currencyCode } }'),/shopify_invalid_auth_response/);
  }
});

test('product and monitor default callers never inherit ads grants; opt-in clients remain read-only even if global writes flip',async()=> {
  const rt=runtime({env:{...env,PRODUCT_REGISTRATION_WRITES_ENABLED:'true'},fetch:(async()=>{throw Error('must_not_send')}) as typeof fetch});
  assert.equal(shopifyClient(rt).configured(),false);
  await assert.rejects(shopifyClient(rt,true).query('mutation Forbidden { productDelete(input:{id:"x"}) { deletedProductId } }',{},true),/shopify_readonly_query_required/);
  await assert.rejects(shopifyClient(rt,true).query('mutation Forbidden { productDelete(input:{id:"x"}) { deletedProductId } }'),/shopify_readonly_query_required/);
  await assert.rejects(shopifyClient(rt,true).query('query { shop { currencyCode } }',{},true),/writes_disabled/);
});
