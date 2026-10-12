import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = await readFile(new URL('../deploy/migrate/auto-deploy.sh', import.meta.url), 'utf8');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
for (const mode of ['success','buildfail','upfail','healthfail','caddyvalidatefail','caddyreloadfail','caddyvalidatefail-daily']) {
  test(`automatic pipeline mock: ${mode}, no operating resources`, async () => {
    const dir = await mkdtemp(join(tmpdir(),'ames-auto-test-'));
    try {
      await mkdir(join(dir,'.deployed')); await mkdir(join(dir,'src','erp','deploy','migrate'), {recursive:true});
      for (const n of ['erp','daily','hr']) await writeFile(join(dir,'.deployed',n),'old\n');
      if(mode==='caddyvalidatefail-daily')await rm(join(dir,'.deployed','daily'));
      await writeFile(join(dir,'src','erp','deploy','migrate','Caddyfile'),'fixture');
      await writeFile(join(dir,'src','erp','deploy','migrate','docker-compose.yml'),'fixture');
      await writeFile(join(dir,'Caddyfile'),'previous-fixture');
      const mock = `
MODE=${mode}
mock_up=0
mock_alias=newimage
mock_health=0
git() { case "$*" in *"rev-parse origin/aws-migration"*) echo new;; *"rev-parse origin/master"*) if [ "$MODE" = caddyvalidatefail-daily ]; then echo new; else echo old; fi;; *"rev-parse origin/"*) echo old;; *"rev-parse HEAD"*) case "$*" in *src/erp*) echo new;; *src/daily*) if [ -f "$APP/reset-daily" ]; then echo new; else echo old; fi;; *) echo old;; esac;; *"reset -q --hard new"*) case "$*" in *src/daily*) echo yes > "$APP/reset-daily";; esac;; *log*) echo fixture;; *) return 0;; esac; }
docker() {
 case "$*" in
  "compose ps -q caddy") echo fixture-caddy;;
  "exec fixture-caddy caddy validate --config /tmp/erp-next-Caddyfile --adapter caddyfile") [ "$MODE" != caddyvalidatefail ] && [ "$MODE" != caddyvalidatefail-daily ];;
  "exec fixture-caddy caddy reload --config /tmp/erp-next-Caddyfile --adapter caddyfile") [ "$MODE" != caddyreloadfail ];;
  "compose config --images app") echo fixture-image;;
  "inspect -f {{.Image}} app-app-1") echo oldimage;;
  "compose build app") [ "$MODE" != buildfail ];;
  "inspect -f {{.State.Running}} app-daily-1") echo true;;
  "inspect -f {{.RestartCount}} app-daily-1") echo 0;;
  "compose up -d app") mock_up=$((mock_up+1)); echo "$mock_up" > "$APP/up-count"; [ "$MODE" != upfail ] || [ "$mock_up" -gt 1 ];;
  "tag app-prev:latest fixture-image") echo restored > "$APP/restored"; mock_alias=oldimage;;
  *) return 0;;
 esac
}
curl() { mock_health=$((mock_health+1)); [ "$MODE" != healthfail ] || [ "$mock_health" -gt 1 ]; }
sleep() { :; }
flock() { :; }
`;
      const fixture = source.replace('APP=/opt/app', `APP='${dir.replaceAll('\\','/')}'\n` + mock);
      const path = join(dir,'mock.sh'); await writeFile(path,fixture);
      const result = spawnSync(shell,[path],{encoding:'utf8'});
      assert.equal(result.status,mode==='success'?0:1,result.stderr);
      const deployed=(await readFile(join(dir,'.deployed','erp'),'utf8')).trim();
      assert.equal(deployed,mode==='success'?'new':'old');
      if(mode==='caddyvalidatefail-daily')assert.equal((await readFile(join(dir,'.deployed','daily'),'utf8')).trim(),'new');
      if(mode==='caddyvalidatefail'||mode==='caddyreloadfail'){
        assert.equal((await readFile(join(dir,'Caddyfile'),'utf8')).trim(),'previous-fixture');
        assert.equal(await readFile(join(dir,'up-count'),'utf8').catch(()=>null),null);
      }
      if (mode==='upfail'||mode==='healthfail') {
        assert.equal((await readFile(join(dir,'.deployed','erp.failed'),'utf8')).trim(),'new');
        assert.equal((await readFile(join(dir,'restored'),'utf8')).trim(),'restored');
        assert.equal((await readFile(join(dir,'up-count'),'utf8')).trim(),'2');
        const second=spawnSync(shell,[path],{encoding:'utf8'}); assert.equal(second.status,0,second.stderr);
        assert.equal((await readFile(join(dir,'up-count'),'utf8')).trim(),'2');
      }
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
}
test('installer and persistent runner contain no hardcoded credentials or executable config source',async()=> {
  const launcher=await readFile(new URL('./macmini/ads-runner-launch.mjs',import.meta.url),'utf8');
  const installer=await readFile(new URL('./macmini/install-ads-runner.py',import.meta.url),'utf8');
  assert.match(launcher,/info\.mode & 0o077/);assert.match(launcher,/info\.uid !== process\.getuid/);
  assert.doesNotMatch(launcher,/eval\(|execSync|setenv/);
  assert.ok(installer.indexOf("refuse_existing_launch_agent")<installer.indexOf("config = private"));
  assert.doesNotMatch(installer,/'ADS_RUNNER_TOKEN'/);
  assert.ok(installer.includes(".replace(b'\\r\\n', b'\\n')"));
});
