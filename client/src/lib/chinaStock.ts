import type { ChinaStockBalance, ChinaStockMove } from './phase1';

export interface ChinaTransfer {
  id: string; workspace: string; style_no: string; color: string; qty: number;
  sent_date: string; received_date?: string; confirmation_ref?: string; status: 'in_transit'|'received';
}
export interface ChinaSnapshot { workspace: string; balances: ChinaStockBalance[]; moves: ChinaStockMove[]; transfers: ChinaTransfer[] }
export async function chinaStockRequest(workspace: string, action?: string, input?: object): Promise<ChinaSnapshot> {
  const token=localStorage.getItem('erp_token');
  const r=await fetch(action ? `/api/inventory/china/${action}` : `/api/inventory/china?workspace=${workspace}`, {
    method: action ? 'POST':'GET', credentials:'include', signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(action?{body:JSON.stringify({...input,workspace})}:{}) });
  const data=await r.json();
  if (!r.ok) throw new Error(data.error || '중국 재고 서버 조회 실패');
  if (data.workspace!==workspace || !Array.isArray(data.moves) || !Array.isArray(data.balances) || !Array.isArray(data.transfers)) throw new Error('중국 재고 저장 결과 확인 필요');
  return {workspace,balances:data.balances.map((v:any)=>({workspace:v.workspace,styleNo:v.style_no,styleName:v.style_name,
    color:v.color,onHand:Number(v.on_hand),inboundQty:Number(v.inbound_qty),outboundQty:Number(v.outbound_qty)})),
    moves:data.moves.map((v:any)=>({id:v.id,workspace:v.workspace,styleNo:v.style_no,styleName:v.style_name,color:v.color,qty:Number(v.qty),
      moveType:v.move_type,moveDate:v.move_date,orderId:v.order_id,orderNo:v.order_no,receiptLogId:v.receipt_log_id,memo:v.memo,createdAt:v.created_at})),transfers:data.transfers};
}
