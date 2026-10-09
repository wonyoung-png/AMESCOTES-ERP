import { PMS_URL } from '@/lib/hosts';
import { useSearch } from 'wouter';

export default function PmsWorkspace() {
  const search = useSearch();
  const tab = new URLSearchParams(search).get('tab') || '일일점검';
  const base = PMS_URL();
  const token = localStorage.getItem('erp_token');

  if (!base) {
    return <div className="p-6 text-sm text-muted-foreground">PMS 주소를 확인할 수 없습니다.</div>;
  }

  const query = new URLSearchParams({ embedded: '1' });
  if (token) query.set('erp', token);

  return (
    <iframe
      key={tab}
      src={`${base}?${query.toString()}#${encodeURIComponent(tab)}`}
      title={`${tab} · 브랜드 운영`}
      className="block h-[calc(100vh-3rem)] w-full border-0 bg-background"
      allow="clipboard-read; clipboard-write"
    />
  );
}
