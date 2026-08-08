// 저장 실패를 조용히 넘기지 않는다.
// 화면은 낙관적으로 먼저 바뀌지만, 서버 저장이 깨졌으면 반드시 사용자에게 보인다.
// (발주가 저장 안 됐는데 "등록 완료"가 뜨던 사고의 재발 방지)
import { toast } from 'sonner';

/** Promise 뒤에 붙여 쓴다: upsertX(...).catch(onSaveFail('발주')) */
export const onSaveFail = (what: string) => (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[저장 실패] ${what}:`, e);
  toast.error(`${what} 저장 실패 — 새로고침 후 다시 시도하세요 (${msg.slice(0, 80)})`);
};
