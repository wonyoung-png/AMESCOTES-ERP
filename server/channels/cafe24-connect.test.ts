import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCafe24ConnectRouter, cafe24ReadToken, CAFE24_CALLBACK } from './cafe24-connect';
import { runtime } from './common';
import { cafe24Auth, dbAdsTokenStore, dbTokenStore } from './cafe24-auth';
import type { SessionUser } from '../auth';

const now = Date.parse('2026-10-12T00:00:00Z');
const value = { mall_id: 'atlm1224', scopes: ['mall.read_order','mall.read_store','mall.write_application'],
  access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token',
  expires_at: '2026-10-12T11:00:00', refresh_token_expires_at: '2026-10-26T09:00:00' };
test('read-only Cafe24 token validates scopes, mall, expiry and header-safe strings', () => {
  assert.equal(cafe24ReadToken(value, now).expires_at, '2026-10-12T02:00:00.000Z');
  for (const change of [{mall_id:'other'}, {scopes:['mall.read_order']},
    {scopes:[...value.scopes,'mall.write_order']}, {access_token:'bad\nheader'},
    {expires_at:'invalid'}, {refresh_token_expires_at:'2020-01-01T00:00:00Z'}])
    assert.throws(()=>cafe24ReadToken({...value,...change},now));
});

test('ads and product tokens use separate server-only tables and lease functions', async t => {
  const previous=globalThis.fetch; const urls:string[]=[];
  globalThis.fetch=(async(url)=>{urls.push(String(url));return new Response('[]');}) as typeof fetch;
  t.after(()=>{globalThis.fetch=previous;});
  await dbAdsTokenStore.read(); await dbAdsTokenStore.claim('synthetic-owner');
  await dbTokenStore.read(); await dbTokenStore.claim('synthetic-owner');
  assert.match(urls[0],/ads_channel_tokens\?channel=eq.cafe24_ads/);
  assert.match(urls[1],/rpc\/ads_commerce_token_claim$/);
  assert.match(urls[2],/\/channel_tokens\?channel=eq.cafe24_erp/);
  assert.match(urls[3],/rpc\/product_registration_token_claim$/);
});

test('approved ads refresh validates narrow scopes and Seoul expiry before saving; invalid grant is never persisted', async () => {
  for(const extra of [false,true]) {
    let saved=0;
    const expired={access_token:'synthetic-expired-token',refresh_token:'synthetic-refresh-token',expires_at:'2026-10-11T00:00:00Z'};
    const rt=runtime({now:()=>now,env:{CAFE24_ERP_CLIENT_ID:'synthetic-id',CAFE24_ERP_CLIENT_SECRET:'synthetic-secret',
      PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED:'true',PRODUCT_REGISTRATION_WRITES_ENABLED:'false'},
      fetch:(async(url,init)=> {assert.equal(url,'https://atlm1224.cafe24api.com/api/v2/oauth/token');
        assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'),'refresh_token');
        return new Response(JSON.stringify({...value,scopes:extra?[...value.scopes,'mall.write_product']:value.scopes}));}) as typeof fetch});
    const auth=cafe24Auth(rt,{read:async()=>expired,claim:async()=>expired,release:async()=>{},
      save:async(_owner,token)=>{saved++;assert.equal(token.expires_at,'2026-10-12T02:00:00.000Z');}},cafe24ReadToken);
    if(extra) await assert.rejects(auth.token(true),/cafe24_read_scope_required/);
    else assert.equal(await auth.token(true),value.access_token);
    assert.equal(saved,extra?0:1); assert.equal(rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED,'false');
  }
});

test('CEO-only, same-origin, cookie-bound one-time flow writes only authentication metadata', async t => {
  let user: SessionUser | null = { id:'ceo', email:'wonyoung@atlm.kr', role:'대표', name:'fixture' };
  let posts=0, saves=0, seeds=0, existing=false, fail=false;
  let clock=now;
  const rt = runtime({ env:{ CAFE24_ADS_CLIENT_ID:'x9IHHNGgMF9jcc0YAyb0jB', CAFE24_ADS_CLIENT_SECRET:'synthetic-secret',
    CAFE24_ADS_OAUTH_REFRESH_ENABLED:'true', PRODUCT_REGISTRATION_WRITES_ENABLED:'false' }, now:()=>clock,
    sleep:async()=>{}, fetch:(async(url, init)=> {
      posts++; assert.equal(url,'https://atlm1224.cafe24api.com/api/v2/oauth/token');
      assert.equal(init?.method,'POST'); assert.equal(init?.redirect,'error');
      const body=new URLSearchParams(String(init?.body)); assert.equal(body.get('redirect_uri'),CAFE24_CALLBACK);
      assert.equal(body.get('grant_type'),'authorization_code');
      return fail ? new Response('',{status:500}) : new Response(JSON.stringify(value));
    }) as typeof fetch });
  const app=express(); app.use(createCafe24ConnectRouter({ rt, authenticate:async()=>user,
    rest:(async(path,init)=> { seeds++; assert.equal(path,'ads_channel_tokens?on_conflict=channel');
      assert.equal(JSON.parse(String(init?.body)).access_token,''); return new Response(''); }) as any,
    tokens:{read:async()=>null,claim:async()=>({access_token:existing?'existing-token':'',refresh_token:'',expires_at:''}),
      save:async(_owner,token)=> { saves++; assert.equal(token.access_token,value.access_token); }, release:async()=>{} } }));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/ads-council/cafe24`;
  const start=async()=> {
    const r=await fetch(base+'/authorize',{redirect:'manual',headers:{'sec-fetch-site':'same-origin'}});
    assert.equal(r.status,302); const location=new URL(r.headers.get('location')!);
    assert.equal(location.searchParams.get('scope'),'mall.read_order,mall.read_store');
    assert.equal(location.searchParams.get('redirect_uri'),CAFE24_CALLBACK);
    assert.match(r.headers.get('set-cookie')!,/HttpOnly/); assert.match(r.headers.get('set-cookie')!,/Secure/);
    return { state:location.searchParams.get('state')!, cookie:r.headers.get('set-cookie')!.split(';')[0] };
  };
  const complete=(s:{state:string;cookie:string}, cookie=s.cookie)=> fetch(base+'/callback?state='+s.state+'&code=synthetic-code',
    {redirect:'manual',headers:{cookie}});
  assert.equal((await fetch(base+'/authorize')).status,403);
  for(const site of ['same-site','cross-site'])
    assert.equal((await fetch(base+'/authorize',{redirect:'manual',headers:{'sec-fetch-site':site}})).status,403);
  assert.equal((await fetch(base+'/authorize',{redirect:'manual',headers:{'sec-fetch-site':'none'}})).status,302);
  const ceo=user; user=null; assert.equal((await fetch(base+'/authorize')).status,403); user=ceo;
  rt.env.CAFE24_ADS_OAUTH_REFRESH_ENABLED='false'; assert.equal((await fetch(base+'/authorize')).status,503);
  rt.env.CAFE24_ADS_OAUTH_REFRESH_ENABLED='true';
  user={...user,role:'직원'}; assert.equal((await fetch(base+'/authorize')).status,403); user={...user,role:'대표'};
  const s=await start(); assert.equal((await complete(s,'')).status,400); assert.equal(posts,0);
  user={...user,id:'different-owner'}; assert.equal((await complete(s)).status,400); user=ceo;
  const done=await complete(s); assert.equal(done.status,302); assert.equal(done.headers.get('location'),'/ads-analysis?ws=LUMEN&auth=cafe24-connected');
  assert.equal(saves,1); assert.equal(posts,1); assert.equal((await complete(s)).status,400);
  const expired=await start(); clock+=600_001; assert.equal((await complete(expired)).status,400); clock=now;
  existing=true; assert.equal((await complete(await start())).status,503); assert.equal(posts,1); existing=false;
  fail=true; const lost=await start(); assert.equal((await complete(lost)).status,503); assert.equal(posts,2);
  assert.equal((await complete(lost)).status,400); assert.equal(posts,2); assert.equal(saves,1); assert.equal(seeds,3);
  assert.equal(rt.env.PRODUCT_REGISTRATION_WRITES_ENABLED,'false');
});
