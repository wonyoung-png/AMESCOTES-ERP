export type ChinaRequestKind = 'outbound' | 'transfer' | 'adjust' | 'receive';
export interface ChinaRequest {
  kind: ChinaRequestKind;
  workspace: string;
  action: 'move' | 'transfer';
  input: Record<string, unknown>;
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface ChinaSession {
  workspace: string;
  userId: string;
  storage: () => SessionStore;
}

export const chinaStockSessionKey = (workspace: string, userId: string) =>
  `erp:china-pending:v1:${encodeURIComponent(userId)}:${workspace}`;

function validRequest(value: unknown, workspace: string): value is ChinaRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as ChinaRequest;
  if (v.workspace !== workspace || !['LUMEN','AETALOOF'].includes(v.workspace)
    || !v.input || typeof v.input !== 'object' || Array.isArray(v.input)) return false;
  const b = v.input;
  if (typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(b.id)
    || (b.workspace !== undefined && b.workspace !== workspace)) return false;
  const date = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
  if (v.kind === 'receive') return v.action === 'transfer' && b.action === 'receive'
    && date(b.receivedDate) && typeof b.confirmationRef === 'string' && !!b.confirmationRef.trim();
  if (!['outbound','transfer','adjust'].includes(v.kind) || typeof b.styleNo !== 'string' || !b.styleNo.trim()
    || typeof b.color !== 'string' || !b.color.trim() || !Number.isSafeInteger(b.qty)
    || Number(b.qty) === 0 || Math.abs(Number(b.qty)) > 2147483647 || !date(b.moveDate)
    || (b.styleName !== undefined && typeof b.styleName !== 'string')
    || (b.memo !== undefined && typeof b.memo !== 'string')) return false;
  if (v.kind === 'adjust') return v.action === 'move' && b.action === undefined && b.moveType === 'adjust'
    && typeof b.memo === 'string' && !!b.memo.trim();
  return Number(b.qty) > 0 && b.moveType === 'outbound' && (v.kind === 'transfer'
    ? v.action === 'transfer' && b.action === 'send' : v.action === 'move' && b.action === undefined);
}

// Persist before sending; a remounted page must reuse the exact original request.
export function createChinaStockAttempt(session?: ChinaSession) {
  let body: string | null = null;
  let busy = false;
  let storageError = '';
  const key = session && chinaStockSessionKey(session.workspace, session.userId);
  if (session && key) {
    try {
      const stored = session.storage().getItem(key);
      if (stored !== null) {
        if (!validRequest(JSON.parse(stored), session.workspace)) throw new Error('invalid stored request');
        body = stored;
      }
    } catch {
      storageError = '탭 세션 요청 복원 실패: 저장 자료와 서버 이력을 확인하기 전 새 요청을 전송하지 마세요';
    }
  }
  return {
    get busy() { return busy; },
    get storageError() { return storageError; },
    get request(): ChinaRequest | null { return body ? JSON.parse(body) : null; },
    clear() {
      if (busy) throw new Error('서버 응답을 기다리는 중입니다');
      if (session && key) {
        try {
          const current = session.storage().getItem(key);
          if (body && current !== null && current !== body) throw new Error('another pending request');
          session.storage().removeItem(key);
          if (session.storage().getItem(key) !== null) throw new Error('remove failed');
        } catch {
          storageError = '탭 세션 요청 해제 실패: 원래 요청을 보존합니다';
          throw new Error(storageError);
        }
      }
      body = null;
      storageError = '';
    },
    async run<T>(candidate: ChinaRequest, send: (workspace: string, action: string, input: object) => Promise<T>) {
      if (busy) throw new Error('서버 응답을 기다리는 중입니다');
      if (storageError) throw new Error(storageError);
      body ??= JSON.stringify(candidate);
      const request: ChinaRequest = JSON.parse(body);
      if (session && key) {
        try {
          if (!validRequest(request, session.workspace)) throw new Error('invalid request');
          const current = session.storage().getItem(key);
          if (current !== null && current !== body) throw new Error('another pending request');
          session.storage().setItem(key, body);
          if (session.storage().getItem(key) !== body) throw new Error('write failed');
        } catch {
          storageError = '탭 세션 요청 저장 실패: 서버에 전송하지 않았습니다. 저장 환경과 기존 이력을 확인하세요';
          throw new Error(storageError);
        }
      }
      busy = true;
      try {
        const result = await send(request.workspace, request.action, request.input);
        return { result, request };
      } finally {
        busy = false;
      }
    },
  };
}
