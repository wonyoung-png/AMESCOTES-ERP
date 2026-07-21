// 필터·검색·정렬 등 화면 상태를 sessionStorage에 저장해
// 다른 탭으로 갔다가 뒤로 와도 그대로 복원되게 하는 useState 대체 훅.
// 사용법: const [search, setSearch] = usePersistedState('orders.search', '');
//  - key 는 페이지별로 고유하게 (예: 'orders.filterStatus')
//  - 브라우저 세션 동안만 유지 (탭 닫으면 초기화 → 개인정보 잔존 없음)
import { useState, useEffect, Dispatch, SetStateAction } from 'react';

const PREFIX = 'atlm.flt:';

export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = PREFIX + key;
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* 저장 실패는 무시 (기능은 정상 동작) */
    }
  }, [storageKey, state]);
  return [state, setState];
}
