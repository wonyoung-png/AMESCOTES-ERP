import { randomUUID } from 'node:crypto';
import type { Listing, ListingImage } from '../../shared/product-registration';
import { assertWrites, ChannelError, fingerprint, hasIntent, request, sourceBytes, step, UncertainWrite, type Runtime, type OnStep } from './common';
import { Q } from './shopify-queries';
import type { ShopifyClient } from './shopify-client';

const extension = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[mime];
const stagedHost = (value: string) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password &&
    (url.hostname === 'storage.googleapis.com' || url.hostname === 'shopify-staged-uploads.storage.googleapis.com' ||
      /^shopify-staged-uploads[^.]*\.s3[.-][a-z0-9-]*\.amazonaws\.com$/.test(url.hostname));
};
export function shopifyFiles(rt: Runtime, client: ShopifyClient) {
  async function ready(id: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const file = (await client.query(Q.file, { id })).node;
      if (!file) throw new ChannelError('shopify_file_missing');
      if (file.fileStatus === 'READY' && file.image?.url) return file;
      if (file.fileStatus === 'FAILED') throw new ChannelError('shopify_file_processing_failed');
      await rt.sleep(1000);
    }
    throw new ChannelError('shopify_file_not_ready');
  }
  async function find(filename: string) {
    const connection = (await client.query(Q.findFile, { query: `filename:${filename}` })).files;
    if (connection.pageInfo.hasNextPage) throw new ChannelError('shopify_file_lookup_ambiguous');
    // Filename search can be fuzzy; verify exact path without the transformation suffix.
    const found = connection.nodes.filter((n: any) => {
      if (!n.image?.url) return false;
      return decodeURIComponent(new URL(n.image.url).pathname.split('/').pop() || '') === filename;
    });
    if (found.length > 1) throw new ChannelError('shopify_file_lookup_ambiguous');
    return found[0];
  }
  async function upload(buffer: Buffer, mime: string, filename: string) {
    assertWrites(rt);
    if (!extension(mime) || !buffer.length || buffer.length > 10 * 1024 * 1024) throw new ChannelError('invalid_image_upload');
    const target = (await client.query(Q.stage, { input: [{ filename, mimeType: mime, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(buffer.length) }] }, true)).stagedUploadsCreate.stagedTargets?.[0];
    if (!target || !stagedHost(target.url) || !stagedHost(target.resourceUrl)) throw new ChannelError('untrusted_staged_upload');
    const form = new FormData();
    for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    const response = await request(rt, target.url, 'POST', { body: form, write: true, replaySafe: true });
    if (!response.ok) throw new ChannelError('staged_upload_failed');
    const file = (await client.query(Q.createFile, { files: [{ originalSource: target.resourceUrl, filename, contentType: 'IMAGE', duplicateResolutionMode: 'RAISE_ERROR' }] }, true)).fileCreate.files?.[0];
    if (!file?.id) throw new UncertainWrite();
    return ready(file.id);
  }
  async function media(listing: Listing, image: ListingImage, onStep: OnStep) {
    const payload = { listing: listing.id, image: image.id, source: image.source_url, source_file: image.shopify_file_id };
    const filename = `erp-media-${fingerprint(payload)}.${extension(image.mime_type || 'image/jpeg')}`;
    const priorIntent = hasIntent(listing, 'shopify', 'file', payload);
    return step(listing, 'shopify', 'file', payload, onStep, async () => {
      const existing = await find(filename);
      if (existing) {
        if (!priorIntent) throw new ChannelError('shopify_unowned_file_collision');
        const file = await ready(existing.id); return { file_id: file.id, filename, image_id: image.id };
      }
      if (priorIntent) throw new UncertainWrite();
      try {
        const file = await upload(await sourceBytes(rt, image), image.mime_type || 'image/jpeg', filename);
        return { file_id: file.id, filename, image_id: image.id };
      } catch (error) {
        if (!(error instanceof UncertainWrite)) throw error;
        const recovered = await find(filename);
        if (!recovered) throw error;
        await ready(recovered.id); return { file_id: recovered.id, filename, image_id: image.id };
      }
    }, async data => {
      if (data.file_id === image.shopify_file_id) throw new ChannelError('shared_source_media_forbidden');
      const file = await ready(String(data.file_id));
      return !!file && new URL(file.image.url).pathname.split('/').pop() === filename;
    });
  }
  return { ready, find, media, async original(buffer: Buffer, mime: string, _name: string) {
    // Never reuse a client filename or an existing product's CDN object.
    const filename = `erp-original-${randomUUID()}.${extension(mime) || 'invalid'}`;
    const file = await upload(buffer, mime, filename);
    return { source_url: file.image.url, shopify_file_id: file.id, width: file.image.width, height: file.image.height, mime_type: mime, byte_size: buffer.length };
  } };
}
