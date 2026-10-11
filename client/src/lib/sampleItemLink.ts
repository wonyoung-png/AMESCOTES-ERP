type Link = { sampleId: string; itemId: string; styleNo?: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'ames_pending_sample_links';
export function scopedSampleLinkStorage(storage: Storage, userId: string): Storage {
  if (!userId) throw new Error('샘플 연결 계정을 확인할 수 없습니다');
  const key = (name: string) => `${name}:${userId}`;
  return { getItem: name => storage.getItem(key(name)), setItem: (name, value) => storage.setItem(key(name), value), removeItem: name => storage.removeItem(key(name)) };
}

export function pendingSampleLinks(storage: Storage): Link[] {
  const rows = JSON.parse(storage.getItem(KEY) || '[]');
  if (!Array.isArray(rows)) throw new Error('샘플 연결 대기 정보 형식 오류');
  return rows;
}

/** The item already exists. A link retry must not create another item. */
export function queueSampleLink(storage: Storage, link: Link): void {
  const rows = pendingSampleLinks(storage);
  const existing = rows.find(r => r.sampleId === link.sampleId);
  if (existing && existing.itemId !== link.itemId) throw new Error('이 샘플에 이전 품목 연결이 대기 중입니다');
  storage.setItem(KEY, JSON.stringify([...rows.filter(r => r.sampleId !== link.sampleId), link]));
  // Keep the durable retry above, clear only the new-item intent.
  if (storage.getItem('ames_link_sampleId') === link.sampleId) storage.removeItem('ames_link_sampleId');
}

export async function saveSampleItemLink(db: any, link: Link): Promise<void> {
  const { data, error } = await db.from('samples')
    .update({ style_id: link.itemId, updated_at: new Date().toISOString() })
    .eq('id', link.sampleId)
    .or(`style_id.is.null,style_id.eq.${JSON.stringify(link.itemId)}`)
    .select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) throw new Error('샘플이 없거나 다른 품목에 연결되어 있습니다 — 원본 확인이 필요합니다');
}

export async function retrySampleLink(storage: Storage, link: Link, save: (link: Link) => Promise<unknown>): Promise<void> {
  if (!pendingSampleLinks(storage).some(r => r.sampleId === link.sampleId && r.itemId === link.itemId)) throw new Error('샘플 연결 대기 정보를 확인할 수 없습니다');
  await save(link);
  storage.setItem(KEY, JSON.stringify(pendingSampleLinks(storage).filter(r => !(r.sampleId === link.sampleId && r.itemId === link.itemId))));
}
