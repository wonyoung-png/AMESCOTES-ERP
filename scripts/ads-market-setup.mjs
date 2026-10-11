// Read-only operational evidence. No mappings are persisted here and no Meta writes exist.
export function deriveMarketMappings(campaigns, adsets) {
  if (!Array.isArray(campaigns) || !Array.isArray(adsets)) throw Error('invalid_evidence');
  const mappings = { 'lm-kr': { verified: true, campaignIds: [] }, 'lm-gl': { verified: true, campaignIds: [] } };
  const rejected = [];
  for (const campaign of campaigns) {
    const sets = adsets.filter(s => s.campaign_id === campaign.id);
    const namedMarket = /^lm-kr_/i.test(campaign.name) ? 'lm-kr' : /^lm-(?:gl|us)_/i.test(campaign.name) ? 'lm-gl' : undefined;
    const markets = sets.map(s => {
      const geo = s.targeting?.geo_locations;
      // Cities/regions/groups/custom locations must not be inferred from a country label.
      if (!geo || Object.keys(geo).some(k => !['countries', 'location_types'].includes(k)) ||
          !Array.isArray(geo.countries) || !geo.countries.length ||
          geo.countries.some(c => !/^[A-Z]{2}$/.test(c) || ['ZZ', 'XX'].includes(c))) return undefined;
      return geo.countries.every(c => c === 'KR') ? 'lm-kr' : geo.countries.every(c => c !== 'KR') ? 'lm-gl' : undefined;
    });
    const usMismatch = /^lm-us_/i.test(campaign.name) && sets.some(s =>
      !s.targeting?.geo_locations?.countries?.every(c => c === 'US'));
    if (!/^\d{1,40}$/.test(campaign.id) || !namedMarket || !sets.length || usMismatch || markets.some(m => m !== namedMarket)) {
      rejected.push(campaign.id);
    } else if (!mappings[namedMarket].campaignIds.includes(campaign.id)) {
      mappings[namedMarket].campaignIds.push(campaign.id);
    }
  }
  for (const mapping of Object.values(mappings)) if (!mapping.campaignIds.length) mapping.verified = false;
  return { mappings, rejected };
}

export async function collectMarketEvidence(env, transport = fetch) {
  const token = env.META_ADS_TOKEN, account = env.META_AD_ACCOUNT_ID;
  if (!token || account !== 'act_1839677907446293') throw Error('unconfigured_account');
  const deadline = AbortSignal.timeout(120_000);
  let getCalls = 0;
  async function pages(edge, fields) {
    const result = [];
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://graph.facebook.com/v26.0/${account}/${edge}`);
      url.searchParams.set('fields', fields);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after', cursor);
      getCalls++;
      const response = await transport(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: deadline });
      if (!response.ok) throw Error('meta_read_failed');
      const data = await response.json();
      if (data.error || !Array.isArray(data.data)) throw Error('meta_read_failed');
      result.push(...data.data);
      if (!data.paging?.next) return result;
      const next = data.paging.cursors?.after;
      if (typeof next !== 'string' || !next || cursors.has(next)) throw Error('incomplete_pagination');
      cursors.add(next); cursor = next;
    }
    throw Error('incomplete_pagination');
  }
  const campaigns = await pages('campaigns', 'id,name,status');
  const adsets = await pages('adsets', 'id,campaign_id,targeting');
  const derived = deriveMarketMappings(campaigns, adsets);
  return { ...derived, checkedAt: new Date().toISOString(), account, campaigns: campaigns.length, adsets: adsets.length,
    getCalls, metaWrites: 0, basis: 'complete_campaign_and_adset_country_evidence',
    countryEvidence: adsets.map(s => ({ id: s.id, campaignId: s.campaign_id, countries: s.targeting?.geo_locations?.countries || [] })) };
}
if (process.argv[1] === '-') {
  try { console.log(JSON.stringify(await collectMarketEvidence(process.env))); }
  catch { console.log(JSON.stringify({ ok: false, reason: 'market_evidence_unavailable' })); process.exitCode = 1; }
}
