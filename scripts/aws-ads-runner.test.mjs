import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('AWS runner is isolated, pinned, non-root and preserves existing logical lease identity', async () => {
  const docker=await readFile(new URL('../deploy/aws-runner/Dockerfile',import.meta.url),'utf8');
  const compose=await readFile(new URL('../deploy/aws-runner/compose.yml',import.meta.url),'utf8');
  const prepare=await readFile(new URL('./prepare-aws-ads-runner.py',import.meta.url),'utf8');
  assert.match(docker,/@openai\/codex@0\.162\.1/); assert.match(docker,/USER node/);
  for(const text of ['read_only: true','cap_drop: [ALL]','no-new-privileges:true','restart: unless-stopped','mem_limit: 768m'])
    assert.ok(compose.includes(text));
  assert.doesNotMatch(compose,/privileged:|docker.sock|network_mode: host|env_file:|\.env|POSTGRES|META_ADS_TOKEN|ports:/);
  assert.match(prepare,/'runnerId': 'macmini'/); assert.match(prepare,/ADS_ANALYSIS_ENABLED.*!= 'true'/);
  assert.match(prepare,/not target.exists\(\)/); assert.match(prepare,/0o600/);
});
