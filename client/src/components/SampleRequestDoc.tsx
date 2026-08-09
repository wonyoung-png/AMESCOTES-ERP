// 샘플 의뢰서 — 공장·개발실에 보내는 서류.
// 발주서·거래명세표와 같은 구조: 화면·인쇄·이미지가 모두 이 하나를 본다.
import type { Sample, Vendor, Item } from '@/lib/store';
import { SUPPLIER } from './StatementDoc';

export function SampleRequestDoc({ sample, buyer, item }: {
  sample: Sample;
  buyer?: Vendor;
  item?: Item;
}) {
  const s = sample;
  const won = (n?: number) => (n ? `₩${Math.round(n).toLocaleString('ko-KR')}` : '-');
  const checklist = s.materialChecklist || [];
  const requests = s.materialRequests || [];
  const history = s.revisionHistory || [];

  const Row = ({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) => (
    <>
      <td className="bg-neutral-50 border border-neutral-300 px-2 py-1.5 w-24 text-[11px] whitespace-nowrap">{k}</td>
      <td className={`border border-neutral-300 px-2 py-1.5 ${wide ? '' : 'w-40'}`} colSpan={wide ? 3 : 1}>{v || '-'}</td>
    </>
  );

  return (
    <div className="bg-white text-neutral-900 p-5 space-y-4 text-[13px]">
      <div className="text-center border-b-2 border-neutral-800 pb-2">
        <h1 className="text-xl font-bold tracking-[0.3em]">샘 플 의 뢰 서</h1>
      </div>

      <div className="flex justify-between text-xs">
        <span>의뢰일 <b>{s.requestDate}</b></span>
        <span>희망 완료일 <b className="text-red-600">{s.expectedDate || '미정'}</b></span>
      </div>

      <table className="w-full border-collapse text-[11.5px]">
        <tbody>
          <tr><Row k="스타일번호" v={<span className="font-mono font-semibold">{s.styleNo}</span>} /><Row k="품명" v={s.styleName} /></tr>
          <tr><Row k="시즌" v={s.season} /><Row k="차수" v={`${s.round || 1}차${s.roundName ? ` · ${s.roundName}` : ''}`} /></tr>
          <tr><Row k="컬러" v={s.color} /><Row k="진행 단계" v={s.stage} /></tr>
          <tr><Row k="작업 장소" v={s.location || '-'} /><Row k="바이어" v={buyer?.name || '-'} /></tr>
          <tr><Row k="작업 담당" v={s.assignee} /><Row k="영업 담당" v={s.salesPerson} /></tr>
          <tr><Row k="샘플 단가" v={won(s.sampleUnitPrice)} /><Row k="바이어 품번" v={(item as any)?.buyerStyleNo || '-'} /></tr>
        </tbody>
      </table>

      {/* 수정 요청 — 공장이 무엇을 고쳐야 하는지가 이 서류의 핵심 */}
      <div className="border border-neutral-300">
        <div className="bg-neutral-100 px-2 py-1 text-[11px] font-semibold border-b border-neutral-300">수정 · 요청 사항</div>
        <div className="px-3 py-2 text-[12px] whitespace-pre-wrap min-h-[64px]" style={{ wordBreak: 'keep-all' }}>
          {s.revisionNote || '-'}
        </div>
      </div>

      {history.length > 0 && (
        <div className="border border-neutral-300">
          <div className="bg-neutral-100 px-2 py-1 text-[11px] font-semibold border-b border-neutral-300">지난 차수 이력</div>
          <table className="w-full text-[11px]">
            <tbody>
              {history.slice(-4).map((h: any, i) => (
                <tr key={i}>
                  <td className="border-b border-neutral-200 px-2 py-1 w-20 whitespace-nowrap text-neutral-500">{h.date || h.createdAt?.slice(0, 10) || '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 w-14 whitespace-nowrap">{h.round ? `${h.round}차` : ''}</td>
                  <td className="border-b border-neutral-200 px-2 py-1" style={{ wordBreak: 'keep-all' }}>{h.note || h.content || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(checklist.length > 0 || requests.length > 0) && (
        <div className="border border-neutral-300">
          <div className="bg-neutral-100 px-2 py-1 text-[11px] font-semibold border-b border-neutral-300">자재 준비 · 요청</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-neutral-50">
                <th className="border-b border-neutral-300 px-2 py-1 text-left">자재</th>
                <th className="border-b border-neutral-300 px-2 py-1 w-24 text-left">스펙</th>
                <th className="border-b border-neutral-300 px-2 py-1 w-20 text-right">수량</th>
                <th className="border-b border-neutral-300 px-2 py-1 w-20 text-center">준비</th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((c: any, i) => (
                <tr key={`c${i}`}>
                  <td className="border-b border-neutral-200 px-2 py-1" style={{ wordBreak: 'keep-all' }}>{c.name || c.itemName || '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-neutral-500">{c.spec || '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-right tabular-nums">{c.qty ?? '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-center">{c.checked ? '☑' : '☐'}</td>
                </tr>
              ))}
              {requests.map((r: any, i) => (
                <tr key={`r${i}`}>
                  <td className="border-b border-neutral-200 px-2 py-1" style={{ wordBreak: 'keep-all' }}>{r.materialName || r.name || '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-neutral-500">{r.spec || '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-right tabular-nums">{r.qty ?? '-'}</td>
                  <td className="border-b border-neutral-200 px-2 py-1 text-center text-neutral-500">요청</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(s.imageUrls || []).length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {(s.imageUrls || []).slice(0, 3).map((u, i) => (
            <img key={i} src={u} alt={`샘플 이미지 ${i + 1}`}
              className="w-full h-32 object-cover border border-neutral-300" />
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-1 text-[11px]">
        {['의뢰', '접수', '완료'].map(k => (
          <div key={k} className="border border-neutral-300 px-3 py-3 flex items-end justify-between">
            <span className="text-neutral-500">{k}</span>
            <span className="text-neutral-400">(서명)</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-neutral-500 text-right">
        {SUPPLIER.companyName} · {SUPPLIER.bizRegNo} · {SUPPLIER.address}
      </p>
    </div>
  );
}
