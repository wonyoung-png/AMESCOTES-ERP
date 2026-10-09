export async function fetchCapturePendingCount(): Promise<{ pending: number }> {
  const r = await fetch('/api/captures/summary');
  if (!r.ok) throw new Error('접수 건수 조회 실패');
  return r.json();
}
