import assert from 'node:assert/strict';
import test from 'node:test';

// Actual writer/SDK/context/runner; all HTTP is intercepted, no live model or DB.
const REST = 'http://team-report.fixture.invalid';
const DAILY = 'http://team-report-daily.fixture.invalid';
process.env.POSTGREST_URL = REST;
process.env.DAILY_URL = DAILY;
process.env.PGRST_JWT_SECRET = 'synthetic-report-integrity-secret';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
const { writeTeamReport, runAgents, completedScheduleTeams } = await import('./agents');
const { evidenceFreshness } = await import('./report-evidence');
const member = { id:'fixture_md', name:'Synthetic MD', team:'국내 MD', role:'직원', position:'대리', email:'md@fixture.invalid', profile:'' };
const card = { id:'wc_integrity', created_at:new Date().toISOString(), created_by:member.id, created_by_name:member.name,
  team:member.team, kind:'todo', status:'open', raw_text:'직원이 입력한 샘플 검수 진행', parsed:{}, shared_teams:[] };
const valid = JSON.stringify({headline:'검수 진행 중',summary:'· 샘플 검수를 진행 중입니다.',needs:[]});
const json = (value:unknown) => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

for (const scenario of ['valid','split','truncated','empty','missing_summary','wrong_needs','malformed','no_key'] as const) {
  test(`team report integrity: ${scenario}`, async () => {
    const previousFetch=globalThis.fetch,previousKey=process.env.ANTHROPIC_API_KEY;
    if(scenario==='no_key') delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY='synthetic-team-report-key';
    const stored:any[]=[],blocked:string[]=[];
    let calls=0;
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const req=input instanceof Request?input:undefined;
      const url=new URL(req?req.url:String(input)),method=init?.method||req?.method||'GET';
      if(url.origin==='https://api.anthropic.com'&&url.pathname==='/v1/messages'&&method==='POST') {
        calls++;assert.equal(new Headers(init?.headers||req?.headers).get('x-api-key'),'synthetic-team-report-key');
        const body=JSON.parse(String(init?.body??await req?.clone().text()));
        assert.match(body.messages[0].content,/직원이 입력한 샘플 검수 진행/);
        const text=scenario==='empty'?'':scenario==='missing_summary'?'{"headline":"제목","needs":[]}':
          scenario==='wrong_needs'?'{"headline":"제목","summary":"보고","needs":[{"text":3}]}':scenario==='malformed'?'not JSON':valid;
        const content=scenario==='split'?[{type:'text',text:text.slice(0,20)},{type:'text',text:text.slice(20)}]:[{type:'text',text}];
        return json({id:'fixture-report',type:'message',role:'assistant',model:body.model,content,
          stop_reason:scenario==='truncated'?'max_tokens':'end_turn',usage:{input_tokens:0,output_tokens:0}});
      }
      if(url.origin===REST&&method==='GET') {
        const table=url.pathname.slice(1);
        if(['app_users','work_cards','campaigns','gcal_links','team_watch','production_orders','receipt_logs','samples','trade_statements','settlements','payables','subscriptions','subscription_usage_checks'].includes(table)) {
          return json(table==='app_users'?[{...member,is_active:true}]:table==='work_cards'?[{...card}]:[]);
        }
      }
      if(url.origin===REST&&url.pathname==='/team_agent_runs'&&method==='POST') {
        const row=JSON.parse(String(init?.body));stored.push(row);return json([{...row,created_at:new Date().toISOString()}]);
      }
      if(url.origin===DAILY&&url.pathname==='/api/dashboard/brand'&&method==='GET') return json({});
      blocked.push(method+' '+url.origin+url.pathname);throw Error('Fixture blocks external requests');
    }) as typeof fetch;
    try {
      const good=scenario==='valid'||scenario==='split';
      const report=await writeTeamReport(member.team,[card],[member],{open:1,overdue:0,alerts:0},'work',[],'');
      assert.equal(report.reportAvailable,good);
      assert.equal(report.headline,good?'검수 진행 중':'진행 1건 · 마감 지남 0건 · 운영 확인 0개');
      const runs=await runAgents('schedule',member.team);
      assert.equal(runs.length,1);assert.equal(stored.length,1);
      assert.equal(stored[0].stats.open,1,'Rule totals survive AI failure');
      assert.equal(stored[0].stats.reportAvailable,good);
      if(!good) {
        assert.equal(stored[0].stats.evidence.complete,false);
        assert.equal(evidenceFreshness(stored[0].stats.evidence,{...stored[0].stats.evidence,complete:true}),'unknown');
        assert.deepEqual(completedScheduleTeams(stored),[],'Fallback does not finish daily reporting');
        assert.match(stored[0].summary,/AI 보고 작성 불가/);
      } else assert.deepEqual(completedScheduleTeams(stored),[member.team]);
      assert.equal(calls,scenario==='no_key'?0:2);
      assert.deepEqual(blocked,[]);
    } finally {
      globalThis.fetch=previousFetch;
      if(previousKey===undefined) delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=previousKey;
    }
  });
}

test('empty team uses deterministic report without a model request', async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=(async()=>{throw Error('No requests allowed');}) as typeof fetch;
  try { assert.equal((await writeTeamReport('국내 MD',[],[],{open:0,overdue:0,alerts:0},'idle',[],'')).reportAvailable,true); }
  finally { globalThis.fetch=previous; }
});
