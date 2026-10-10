import { PMS_URL } from '@/lib/hosts';
import { useSearch } from 'wouter';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export default function PmsWorkspace() {
  const search = useSearch();
  const { workspace } = useWorkspace();
  const tab = new URLSearchParams(search).get('tab') || '오늘 업무';
  const base = PMS_URL();
  const token = localStorage.getItem('erp_token');

  if (workspace === 'OEM') {
    return <div className="p-6 text-sm text-muted-foreground">브랜드 운영은 LUMEN 또는 AETALOOF를 선택한 후 이용하세요.</div>;
  }
  if (!base) {
    return <div className="p-6 text-sm text-muted-foreground">브랜드 운영 주소를 확인할 수 없습니다.</div>;
  }

  const query = new URLSearchParams({ embedded: '1', brand: workspace.toLowerCase() });
  if (token) query.set('erp', token);

  return (
    <iframe
      key={`${workspace}:${tab}`}
      src={`${base}?${query.toString()}#${encodeURIComponent(tab)}`}
      title={`${tab} · 브랜드 운영`}
      className="block h-[calc(100vh-3rem)] w-full border-0 bg-background"
      allow="clipboard-read; clipboard-write"
    />
  );
}
