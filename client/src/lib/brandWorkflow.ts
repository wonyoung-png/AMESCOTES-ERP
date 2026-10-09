export async function brandWorkflow(path: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`/api/${path}`, { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || '서버 처리 실패');
  return j.result;
}
