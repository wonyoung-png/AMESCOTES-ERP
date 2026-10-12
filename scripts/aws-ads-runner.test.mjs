import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('AWS runner is isolated, pinned, non-root and preserves existing logical lease identity', async () => {
  const docker=await readFile(new URL('../deploy/aws-runner/Dockerfile',import.meta.url),'utf8');
  const compose=await readFile(new URL('../deploy/aws-runner/compose.yml',import.meta.url),'utf8');
  const prepare=await readFile(new URL('./prepare-aws-ads-runner.py',import.meta.url),'utf8');
  assert.match(docker,/@openai\/codex@0\.162\.1/); assert.match(docker,/USER node/);
  assert.match(docker,/install -y --no-install-recommends ca-certificates/);
  assert.doesNotMatch(docker,/NODE_TLS_REJECT_UNAUTHORIZED|SSL_VERIFY.*false/);
  for(const text of ['read_only: true','cap_drop: [ALL]','no-new-privileges:true','restart: unless-stopped','mem_limit: 768m'])
    assert.ok(compose.includes(text));
  assert.doesNotMatch(compose,/privileged:|docker.sock|network_mode: host|env_file:|\.env|POSTGRES|META_ADS_TOKEN|ports:/);
  assert.match(prepare,/'runnerId': 'macmini'/); assert.match(prepare,/ADS_ANALYSIS_ENABLED.*!= 'true'/);
  assert.match(prepare,/not target.exists\(\)/); assert.match(prepare,/0o600/);
});

test('runner network guard precedes Docker and blocks metadata, private forwarding and host TCP only for its subnet', async () => {
  const guard=await readFile(new URL('../deploy/aws-runner/network-guard.sh',import.meta.url),'utf8');
  const unit=await readFile(new URL('../deploy/aws-runner/ames-ads-network-guard.service',import.meta.url),'utf8');
  assert.match(unit,/Before=docker.service/);
  assert.match(guard,/169\.254\.0\.0\/16/);
  assert.match(guard,/DOCKER-USER -s 172\.27\.0\.0\/16/);
  assert.match(guard,/INPUT -s 172\.27\.0\.0\/16 -p tcp ! --dport 53 -j REJECT/);
  assert.match(guard,/--dport 53 -j ACCEPT/);
  const compose=await readFile(new URL('../deploy/aws-runner/compose.yml',import.meta.url),'utf8');
  assert.match(compose,/subnet: 172\.27\.0\.0\/16/);
  assert.doesNotMatch(guard,/iptables -F|iptables -P/);
});
