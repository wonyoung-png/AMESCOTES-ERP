import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMarketMappings, collectMarketEvidence } from './ads-market-setup.mjs';
test('country evidence corroborates naming and keeps US separate from KR without guessing IDs', () => {
  const campaigns = [{id:'1',name:'lm-kr_test'},{id:'2',name:'lm-gl_test'},{id:'3',name:'lm-us_test'},{id:'4',name:'other_brand'}];
  const adsets = [['1',['KR']],['2',['SG','HK']],['3',['US']],['4',['KR']]].map(([id,countries])=>({campaign_id:id,targeting:{geo_locations:{countries}}}));
  assert.deepEqual(deriveMarketMappings(campaigns,adsets), {mappings:{'lm-kr':{verified:true,campaignIds:['1']},'lm-gl':{verified:true,campaignIds:['2','3']}},rejected:['4']});
});
for (const geo of [{ countries:['KR','US'] }, { countries:['KR'],cities:[] }, { countries:['KR'],country_groups:['worldwide'] }, {}, {countries:['ZZ']}]) {
  test('ambiguous/region/unknown targeting cannot become verified', () => {
    assert.equal(deriveMarketMappings([{id:'1',name:'lm-kr_test'}],[{campaign_id:'1',targeting:{geo_locations:geo}}]).mappings['lm-kr'].verified,false);
  });
}
test('one contradictory adset rejects the campaign',()=> {
  assert.equal(deriveMarketMappings([{id:'1',name:'lm-kr_test'}],[{campaign_id:'1',targeting:{geo_locations:{countries:['KR']}}},{campaign_id:'1',targeting:{geo_locations:{countries:['US']}}}]).rejected[0],'1');
});

test('US-named campaigns require exclusively US country evidence', () => {
  const result = deriveMarketMappings([{id:'1',name:'lm-us_test'}],
    [{campaign_id:'1',targeting:{geo_locations:{countries:['SG']}}}]);
  assert.deepEqual(result.rejected, ['1']);
  assert.equal(result.mappings['lm-gl'].verified, false);
});
test('all pages use fixed host/header GET and never follow token-bearing next URLs',async()=> {
  let calls=0;
  const result=await collectMarketEvidence({META_ADS_TOKEN:'synthetic-only',META_AD_ACCOUNT_ID:'act_1839677907446293'},async(url,init)=> {
    calls++; assert.equal(new URL(url).hostname,'graph.facebook.com');assert.equal(init.method,'GET'); assert.equal(new URL(url).searchParams.has('access_token'),false);
    return new Response(JSON.stringify(new URL(url).pathname.endsWith('campaigns')?{data:[{id:'1',name:'lm-kr_test'}]}:{data:[{campaign_id:'1',targeting:{geo_locations:{countries:['KR']}}}]}));
  });
  assert.equal(calls,2);assert.equal(result.metaWrites,0);assert.equal(result.mappings['lm-kr'].verified,true);
});
test('missing/stalled cursors fail instead of verifying partial campaign coverage',async()=> {
  await assert.rejects(collectMarketEvidence({META_ADS_TOKEN:'synthetic-only',META_AD_ACCOUNT_ID:'act_1839677907446293'},async()=>new Response(JSON.stringify({data:[],paging:{next:'https://other.invalid?access_token=secret'}}))),/incomplete_pagination/);
});
