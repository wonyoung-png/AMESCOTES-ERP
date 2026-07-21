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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>('OEM');
  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace, isBrand: workspace !== 'OEM' }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
