import type { Sample } from './store';

export const sampleBillable = (s: Sample) => !!s.completedAt && s.reviewStatus === 'accepted'
  && !!s.buyerId && s.billingStatus === '미청구' && !s.billingStatementId
  && Number.isFinite(s.sampleUnitPrice) && (s.sampleUnitPrice ?? -1) >= 0;
export const sampleCompletionMonth = (s: Sample) => s.completedAt
  ? new Date(new Date(s.completedAt).getTime() + 9 * 3600_000).toISOString().slice(0, 7) : '';
const errors: Record<string,string> = {
  forbidden:'이 샘플을 수락·청구할 권한이 없습니다.', stale_sample:'샘플이 변경되었습니다. 다시 열어 확인해주세요.',
  photo_required:'완료 사진을 먼저 등록해주세요.', before_reception:'접수일 전에는 완료할 수 없습니다.',
  sample_not_completed:'샘플 완료 후 팀장 수락이 가능합니다.', sample_not_accepted:'완료·팀장 수락·청구 금액을 확인해주세요.',
  sample_lead_required:'제품개발팀의 수락 담당 계정 등록이 필요합니다.', sample_lead_ambiguous:'제품개발팀 수락 담당을 한 명으로 지정해주세요.',
  sample_reviewer_invalid:'지정된 샘플 수락 담당이 비활성 또는 허용되지 않은 계정입니다. 대표 설정을 확인해주세요.',
  invalid_sample_reviewer:'유효한 샘플 수락 담당 계정을 지정해주세요.',
  sample_review_invalid:'제품명과 샘플 청구 금액을 확인해주세요.', buyer_required:'바이어를 선택해주세요.',
  brand_required:'해당 바이어에 등록된 브랜드를 선택해주세요.',
  statement_not_editable:'이미 청구·수금 처리된 명세표에는 추가할 수 없습니다.',
  sample_billing_conflict:'기존 샘플 청구 연결을 먼저 확인해주세요.',
  sample_selection_changed:'선택한 샘플이 변경되었습니다. 목록을 새로고침해주세요.',
  sample_workflow_unavailable:'샘플 연결 기능의 서버·DB 반영이 필요합니다. 저장되지 않았습니다.',
};
export async function sampleWorkflowRequest(path: string, body: unknown) {
  const response = await fetch(path, { method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(errors[result.error] || '저장 결과를 확인하지 못했습니다. 새로고침 후 같은 원본에서 다시 확인해주세요.');
  return result;
}
