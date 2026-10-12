import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

test('existing ERP client files remain intact against the latest checked local baseline',()=>{
 const baseline='afe1279'; // Local aws-migration snapshot; not a claim about the live deployment.
 const allowed=new Set(['client/src/pages/ExchangeSettings.tsx','client/src/pages/BomManagement.tsx','client/src/lib/hosts.ts']);
 const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'--','client'],{encoding:'utf8'}).trim().split('\n');
 for(const file of files){
  assert.ok(existsSync(file),'existing client file missing: '+file);
  if(allowed.has(file))continue;
  const actual=readFileSync(file),expected=execFileSync('git',['show',baseline+':'+file],{maxBuffer:64*1024*1024});
  if(/\.(tsx?|[cm]?jsx?|css|html|json|webmanifest|svg|txt|md)$/.test(file))assert.equal(actual.toString('utf8').replaceAll('\r\n','\n'),expected.toString('utf8').replaceAll('\r\n','\n'),'existing client changed: '+file);
  else assert.deepEqual(actual,expected,'existing client changed: '+file);
 }
 for(const file of ['server/subscriptions.ts','supabase/migration_subscription_category_split.sql','supabase/migration_subscription_last_paid.sql']){
  const normalize=s=>s.replaceAll('\r\n','\n').trimEnd();
  assert.equal(normalize(readFileSync(file,'utf8')),normalize(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})),file);
 }
});

test('legacy business routes and all additive routers remain connected',()=>{
 const app=readFileSync('client/src/App.tsx','utf8');
 const before=execFileSync('git',['show','1bdbd1f:client/src/App.tsx'],{encoding:'utf8'});
 const routes=s=>new Set([...s.matchAll(/<Route path="([^"]+)"/g)].map(m=>m[1]));
 for(const baseline of [before,execFileSync('git',['show','aws-migration:client/src/App.tsx'],{encoding:'utf8'})])for(const route of routes(baseline))assert.ok(routes(app).has(route),route);
 assert.equal(readFileSync('client/src/components/Layout.tsx','utf8').replaceAll('\r\n','\n'),execFileSync('git',['show','1bdbd1f:client/src/components/Layout.tsx'],{encoding:'utf8'}).replaceAll('\r\n','\n'));
 const layout=readFileSync('client/src/components/Layout.tsx','utf8'),legacyLayout=execFileSync('git',['show','aws-migration:client/src/components/Layout.tsx'],{encoding:'utf8'});
 for(const match of legacyLayout.matchAll(/path:\s*['"]([^'"]+)['"]/g))assert.ok(layout.includes(match[1]),'legacy navigation '+match[1]);
 for(const route of ['/items','/materials','/bom','/samples','/orders','/trade-statement','/product-registration','/ads-analysis'])assert.ok(routes(app).has(route));
 const server=readFileSync('server/index.ts','utf8');
 for(const name of ['productRegistrationRouter','shopMonitorRouter','sampleWorkflowRouter','defectApprovalRouter','expensePayableRouter','adsCouncilRouter','ceoRouter'])assert.ok(server.includes('app.use('+name+')'),name);
});
test('active deployment uses our domain and no Railway autodetection, archived files preserved',()=>{
 assert.equal(existsSync('railway.json'),false);assert.equal(existsSync('nixpacks.toml'),false);
 for(const file of ['railway.json','nixpacks.toml'])assert.ok(existsSync('deploy/legacy-railway/'+file+'.disabled'));
 const shell=readFileSync('deploy/shell/index.html','utf8');
 assert.doesNotMatch(shell,/sslip\.io|railway\.(app|com)/i);
 assert.doesNotMatch(shell,/https:\/\/erp\.ameserp\.kr/);assert.match(shell,/location\.hostname/);assert.match(shell,/brand:ERP\+'\/pms'/);
 const caddy=readFileSync('deploy/Caddyfile.server','utf8');assert.equal(caddy,readFileSync('deploy/migrate/Caddyfile','utf8'));
 assert.match(caddy,/\{\$ERP_HOST\}/);assert.match(caddy,/\{\$ROOT_DOMAIN\}/);
 for(const key of ['code','state','erp'])assert.ok(caddy.includes('delete '+key));
 assert.match(caddy,/request>headers>Referer delete/);assert.match(caddy,/Referrer-Policy "no-referrer"/);
 assert.doesNotMatch(caddy,/sslip\.io|railway\.(app|com)/i);
 const db=readFileSync('client/src/lib/db.ts','utf8');assert.match(db,/window\.location\.origin/);
});
