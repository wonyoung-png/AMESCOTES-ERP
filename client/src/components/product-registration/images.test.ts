import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageDimensions } from './Images';

test('image preflight rejects over 10MB and unsupported types before decoding or API access', async () => {
  await assert.rejects(imageDimensions(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })), /10MB/);
  await assert.rejects(imageDimensions(new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' })), /JPEG/);
});
test('image preflight returns actual dimensions and always revokes its temporary URL', async () => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let fail = false;
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    naturalWidth = 750; naturalHeight = 1000;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(_url: string) { queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
  } });
  URL.createObjectURL = () => 'blob:synthetic-fixture'; URL.revokeObjectURL = url => { revoked.push(url); };
  try {
    const file = new File(['synthetic-only'], 'photo.png', { type: 'image/png' });
    assert.deepEqual(await imageDimensions(file), { width: 750, height: 1000 });
    fail = true; await assert.rejects(imageDimensions(file), /읽을 수 없습니다/);
    assert.deepEqual(revoked, ['blob:synthetic-fixture', 'blob:synthetic-fixture']);
  } finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else Reflect.deleteProperty(globalThis, 'Image');
  }
});
