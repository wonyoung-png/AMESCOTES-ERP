import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Workspace } from '@/lib/phase1';

interface WorkspaceContextValue {
  workspace: Workspace;
  setWorkspace: (ws: Workspace) => void;
  isBrand: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: 'OEM',
  setWorkspace: () => {},
  isBrand: false,
});

const KEY = 'erp_workspace';
const VALID: Workspace[] = ['OEM', 'LUMEN', 'AETALOOF'];

/**
 * 처음 어느 워크스페이스로 열지 정한다.
 * 1) 주소의 ?ws= — PMS 사이드바에서 돌아올 때 쓴다 (PMS는 다른 도메인이라 localStorage를 못 건드린다)
 * 2) 지난번에 보던 것 — 새로고침할 때마다 OEM으로 튕기지 않게
 */
function initial(): Workspace {
  try {
    const q = new URLSearchParams(location.search).get('ws')?.toUpperCase() as Workspace | undefined;
    if (q && VALID.includes(q)) {
      localStorage.setItem(KEY, q);
      // 주소창에 남겨두면 새로고침마다 되돌아간다
      history.replaceState(null, '', location.pathname + location.hash);
      return q;
    }
    const saved = localStorage.getItem(KEY) as Workspace | null;
    if (saved && VALID.includes(saved)) return saved;
  } catch {
    /* 저장소를 못 쓰는 브라우저면 기본값으로 */
  }
  return 'OEM';
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setState] = useState<Workspace>(initial);

  const setWorkspace = (ws: Workspace) => {
    setState(ws);
    try { localStorage.setItem(KEY, ws); } catch { /* 무시 */ }
  };

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace, isBrand: workspace !== 'OEM' }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
