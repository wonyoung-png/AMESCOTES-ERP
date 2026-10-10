export type WorkSubmitRequest = Readonly<{ text: string; requestId: string }>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const workSubmitSessionKey = (userId: string) => `ames_work_submit_v1:${encodeURIComponent(userId)}`;

export function createWorkSubmitAttempt(userId: string, storage: Storage) {
  const key = workSubmitSessionKey(userId);
  let request: WorkSubmitRequest | null = null;
  let blocked: string | null = null;
  let busy = false;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const value = JSON.parse(raw);
      if (value?.version !== 1 || value.userId !== userId || typeof value.text !== 'string'
        || !value.text.trim() || value.text !== value.text.trim() || value.text.length > 2000
        || typeof value.requestId !== 'string' || !/^wc_[a-z0-9]{1,40}$/.test(value.requestId)) throw new Error();
      request = Object.freeze({ text: value.text, requestId: value.requestId });
    }
  } catch { blocked = '이전 요청 기록을 확인할 수 없습니다. 업무함에서 저장 여부를 확인하기 전에는 다시 등록하지 마세요.'; }

  return {
    get request() { return request; },
    get blocked() { return blocked; },
    async run<T extends { id: string }>(text: string, send: (request: WorkSubmitRequest) => Promise<T | null>): Promise<T> {
      if (blocked) throw new Error(blocked);
      if (busy) throw new Error('요청을 확인 중입니다.');
      const normalized = text.trim();
      if (request && normalized !== request.text) throw new Error('저장 여부가 미확인인 원문만 동일 요청으로 재시도할 수 있습니다.');
      if (!normalized || normalized.length > 2000) throw new Error('업무 내용을 1~2000자로 입력해주세요.');
      busy = true;
      try {
        const frozen = request || Object.freeze({ text: normalized, requestId: `wc_${crypto.randomUUID().replace(/-/g, '')}` });
        // Persistence must succeed BEFORE sending. Keep the frozen request on any uncertain response.
        try { storage.setItem(key, JSON.stringify({ version: 1, userId, ...frozen })); }
        catch { throw new Error('요청을 보존하지 못해 전송하지 않았습니다. 브라우저 저장 공간을 확인해주세요.'); }
        request = frozen;
        const result = await send(frozen);
        if (!result || result.id !== frozen.requestId) throw new Error('저장 결과가 미확인입니다. 원문과 요청 ID를 유지해 재시도해주세요.');
        try { storage.removeItem(key); }
        catch { throw new Error('업무는 저장됐지만 요청 기록을 정리하지 못했습니다. 새로 등록하지 말고 동일 요청으로 다시 확인해주세요.'); }
        request = null;
        return result;
      } finally { busy = false; }
    },
  };
}
