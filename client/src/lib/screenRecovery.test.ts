import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isScreenLoadError, reloadWithConfirmation } from './screenRecovery';

test('화면 파일 로딩 실패: 브라우저별 메시지 분류', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: /assets/old.js',
    'error loading dynamically imported module: /assets/old.js',
    'Importing a module script failed.',
    'Loading chunk 12 failed.',
    'Unable to preload CSS for /assets/old.css',
  ]) assert.equal(isScreenLoadError(new TypeError(message)), true);
  for (const error of [new Error('Failed to fetch'), new Error('업무 계산 오류'), null, {}]) {
    assert.equal(isScreenLoadError(error), false);
  }
});

test('새로고침 취소 시 입력 화면을 유지하고 동의 시 한 번만 실행', () => {
  let reloads = 0;
  assert.equal(reloadWithConfirmation(message => {
    assert.match(message, /저장하지 않은 입력/);
    return false;
  }, () => reloads++), false);
  assert.equal(reloads, 0);
  assert.equal(reloadWithConfirmation(() => true, () => reloads++), true);
  assert.equal(reloads, 1);
});

test('메뉴 밖 자동 리로드 제거 및 경로별 오류/로딩 경계 배치', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const layoutStart = app.indexOf('<Layout onLogout=');
  const routeStart = app.indexOf('<RouteContent>', layoutStart);
  const routeEnd = app.indexOf('</RouteContent>', routeStart);
  assert.ok(routeStart > layoutStart);
  assert.ok(routeEnd < app.indexOf('</Layout>', routeStart));
  const content = readFileSync(new URL('../components/RouteContent.tsx', import.meta.url), 'utf8');
  assert.match(content, /<ErrorBoundary key=\{location\} resetKey=\{search\}>[\s\S]*?<Suspense/);
  assert.doesNotMatch(app, /chunk_reload_once|factory\(\)\.catch|lazyWithReload/);
  const boundary = readFileSync(new URL('../components/ErrorBoundary.tsx', import.meta.url), 'utf8');
  assert.match(boundary, /onClick=\{\(\) => reloadWithConfirmation/);
  assert.doesNotMatch(boundary, /An unexpected error occurred|Reload Page/);
});
