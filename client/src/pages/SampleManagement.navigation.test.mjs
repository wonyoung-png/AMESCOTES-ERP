import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
test('registered sample exposes the same item BOM route on desktop and mobile',()=>{
  const source=readFileSync(new URL('./SampleManagement.tsx',import.meta.url),'utf8');
  const routes=source.match(/navigate\(`\/bom\?styleNo=\$\{encodeURIComponent\(registeredItem\.styleNo\)\}`\)/g)||[];
  assert.equal(routes.length,2);
  assert.doesNotMatch(source,/품목 등록 완료\(ACTIVE\) → 텍스트만 표시/);
});
