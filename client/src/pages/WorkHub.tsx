import { useSearch, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import WorkFeed from './WorkFeed';
import CaptureInbox from './CaptureInbox';
import { fetchCapturePendingCount } from '@/lib/captureQueries';

export default function WorkHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const captures = new URLSearchParams(search).get('view') === 'captures';
  const [openedCaptures, setOpenedCaptures] = useState(captures);
  const { data, isError } = useQuery({ queryKey: ['capturePendingCount'], refetchInterval: 30000,
    queryFn: fetchCapturePendingCount });
  return <>
    <div className="px-4 pt-4 md:px-6 space-y-2">
      <h1 className="text-xl font-semibold">업무함</h1>
      <p className="text-sm text-muted-foreground">대화 업무와 증빙 접수를 한곳에서 확인합니다. 읽음 처리와 전표 승인은 별개입니다.</p>
      <div className="flex gap-2" role="tablist" aria-label="업무함 종류">
        <button role="tab" aria-selected={!captures} className={`rounded-md border px-3 py-2 text-sm ${!captures ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => navigate('/work')}>업무 피드</button>
        <button role="tab" aria-selected={captures} className={`rounded-md border px-3 py-2 text-sm ${captures ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => { setOpenedCaptures(true); navigate('/work?view=captures'); }}>증빙·접수 {data ? `(${data.pending})` : isError ? '(조회 실패)' : '(조회 중)'}</button>
      </div>
    </div>
    <div hidden={captures}><WorkFeed /></div>
    {(openedCaptures || captures) && <div hidden={!captures}><CaptureInbox /></div>}
  </>;
}
