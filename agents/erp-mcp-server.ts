// ERP 도구 정의 — @anthropic-ai/sdk 형식 (직접 API 호출용)
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase-client.js';

// ─── Anthropic SDK 형식 도구 목록 ───
export const ERP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_vendors',
    description: '거래처(바이어/공급업체) 목록을 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '검색어 (업체명 또는 코드)' },
        limit: { type: 'number', description: '최대 조회 건수 (기본 50)' },
      },
    },
  },
  {
    name: 'query_items',
    description: '품목(제품) 목록을 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        buyer_id: { type: 'string', description: '바이어 ID로 필터링' },
        search: { type: 'string', description: '스타일 번호 또는 품목명 검색' },
        limit: { type: 'number', description: '최대 조회 건수 (기본 50)' },
      },
    },
  },
  {
    name: 'query_samples',
    description: '샘플 목록을 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '단계 필터 (예: 의뢰, 진행중, 완료, 승인)' },
        buyer_id: { type: 'string', description: '바이어 ID로 필터링' },
        limit: { type: 'number', description: '최대 조회 건수 (기본 50)' },
      },
    },
  },
  {
    name: 'query_production_orders',
    description: '생산발주 목록을 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '상태 필터' },
        buyer_id: { type: 'string', description: '바이어 ID로 필터링' },
        limit: { type: 'number', description: '최대 조회 건수 (기본 50)' },
      },
    },
  },
  {
    name: 'query_boms',
    description: '특정 품목의 BOM(자재명세서) 데이터를 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        style_no: { type: 'string', description: '조회할 품목의 스타일 번호' },
      },
      required: ['style_no'],
    },
  },
  {
    name: 'query_materials',
    description: '자재 및 재고 목록을 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        vendor_id: { type: 'string', description: '공급업체 ID로 필터링' },
        search: { type: 'string', description: '자재명 검색' },
        limit: { type: 'number', description: '최대 조회 건수 (기본 50)' },
      },
    },
  },
  {
    name: 'check_missing_boms',
    description: 'BOM(자재명세서)이 등록되지 않은 품목을 감지합니다.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'check_unprocessed_orders',
    description: '자재 구매가 처리되지 않은 생산발주를 감지합니다.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_sample',
    description: '새 샘플을 ERP에 등록합니다.',
    input_schema: {
      type: 'object',
      properties: {
        style_no: { type: 'string', description: '스타일 번호' },
        buyer_id: { type: 'string', description: '바이어 ID' },
        stage: { type: 'string', description: '단계 (의뢰, 진행중, 완료, 승인 등)' },
        request_date: { type: 'string', description: '의뢰일 (YYYY-MM-DD 형식)' },
        assignee: { type: 'string', description: '담당자명' },
        cost_krw: { type: 'number', description: '샘플 원가 (KRW)' },
      },
      required: ['style_no', 'buyer_id', 'stage', 'request_date'],
    },
  },
  {
    name: 'create_production_order',
    description: '새 생산발주를 ERP에 등록합니다.',
    input_schema: {
      type: 'object',
      properties: {
        style_no: { type: 'string', description: '스타일 번호' },
        buyer_id: { type: 'string', description: '바이어 ID' },
        quantity: { type: 'number', description: '수량' },
        order_date: { type: 'string', description: '발주일 (YYYY-MM-DD 형식)' },
        delivery_date: { type: 'string', description: '납기일 (YYYY-MM-DD 형식)' },
        vendor_id: { type: 'string', description: '생산업체 ID' },
        currency: { type: 'string', description: '통화 (KRW, USD, CNY)' },
      },
      required: ['style_no', 'buyer_id', 'quantity', 'order_date'],
    },
  },
];

// ─── 도구 실행 함수 ───
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case 'query_vendors': {
        let q = supabase
          .from('vendors')
          .select('id, code, name, company_name, contact_name, phone, email')
          .order('code')
          .limit((input.limit as number) ?? 50);
        if (input.search) {
          q = q.or(`name.ilike.%${input.search}%,code.ilike.%${input.search}%,company_name.ilike.%${input.search}%`);
        }
        const { data, error } = await q;
        if (error) return `오류: ${error.message}`;
        return JSON.stringify({ total: data?.length ?? 0, vendors: data }, null, 2);
      }

      case 'query_items': {
        let q = supabase
          .from('items')
          .select('id, style_no, name, category, buyer_id, designer, delivery_price, margin_rate')
          .order('style_no')
          .limit((input.limit as number) ?? 50);
        if (input.buyer_id) q = q.eq('buyer_id', input.buyer_id);
        if (input.search) q = q.or(`style_no.ilike.%${input.search}%,name.ilike.%${input.search}%`);
        const { data, error } = await q;
        if (error) return `오류: ${error.message}`;
        return JSON.stringify({ total: data?.length ?? 0, items: data }, null, 2);
      }

      case 'query_samples': {
        let q = supabase
          .from('samples')
          .select('id, style_no, buyer_id, stage, assignee, request_date, approved_date, cost_krw')
          .order('request_date', { ascending: false })
          .limit((input.limit as number) ?? 50);
        if (input.status) q = q.eq('stage', input.status);
        if (input.buyer_id) q = q.eq('buyer_id', input.buyer_id);
        const { data, error } = await q;
        if (error) return `오류: ${error.message}`;
        return JSON.stringify({ total: data?.length ?? 0, samples: data }, null, 2);
      }

      case 'query_production_orders': {
        let q = supabase
          .from('production_orders')
          .select('id, style_no, buyer_id, vendor_id, quantity, currency, order_date, delivery_date, status, color_qtys')
          .order('order_date', { ascending: false })
          .limit((input.limit as number) ?? 50);
        if (input.status) q = q.eq('status', input.status);
        if (input.buyer_id) q = q.eq('buyer_id', input.buyer_id);
        const { data, error } = await q;
        if (error) return `오류: ${error.message}`;
        return JSON.stringify({ total: data?.length ?? 0, orders: data }, null, 2);
      }

      case 'query_boms': {
        const { data, error } = await supabase
          .from('boms')
          .select('id, style_no, exchange_rate_cny, pre_materials, post_materials, color_boms, post_color_boms, logistics_cost_krw')
          .eq('style_no', input.style_no)
          .single();
        if (error) return `BOM 없음: ${input.style_no} — ${error.message}`;
        return JSON.stringify(data, null, 2);
      }

      case 'query_materials': {
        let q = supabase
          .from('materials')
          .select('id, name, spec, unit, unit_price, currency, vendor_id, stock_qty')
          .order('name')
          .limit((input.limit as number) ?? 50);
        if (input.vendor_id) q = q.eq('vendor_id', input.vendor_id);
        if (input.search) q = q.ilike('name', `%${input.search}%`);
        const { data, error } = await q;
        if (error) return `오류: ${error.message}`;
        return JSON.stringify({ total: data?.length ?? 0, materials: data }, null, 2);
      }

      case 'check_missing_boms': {
        const { data: items, error: itemsErr } = await supabase
          .from('items')
          .select('id, style_no, name, buyer_id')
          .order('style_no');
        if (itemsErr) return `오류: ${itemsErr.message}`;

        const { data: boms, error: bomsErr } = await supabase
          .from('boms')
          .select('style_no');
        if (bomsErr) return `오류: ${bomsErr.message}`;

        const bomSet = new Set((boms ?? []).map((b: { style_no: string }) => b.style_no));
        const missing = (items ?? []).filter((i: { style_no: string }) => !bomSet.has(i.style_no));
        return JSON.stringify({
          total_items: items?.length ?? 0,
          items_with_bom: bomSet.size,
          missing_bom_count: missing.length,
          missing_items: missing,
        }, null, 2);
      }

      case 'check_unprocessed_orders': {
        const { data: orders, error: ordersErr } = await supabase
          .from('production_orders')
          .select('id, style_no, buyer_id, quantity, order_date, delivery_date, status')
          .not('status', 'eq', '완료')
          .not('status', 'eq', '취소')
          .order('order_date', { ascending: false });
        if (ordersErr) return `오류: ${ordersErr.message}`;

        const { data: materials, error: matErr } = await supabase
          .from('materials')
          .select('id');
        if (matErr) return `오류: ${matErr.message}`;

        return JSON.stringify({
          active_orders_count: orders?.length ?? 0,
          registered_materials_count: materials?.length ?? 0,
          active_orders: orders,
        }, null, 2);
      }

      case 'create_sample': {
        const { data, error } = await supabase
          .from('samples')
          .insert({
            style_no: input.style_no,
            buyer_id: input.buyer_id,
            stage: input.stage,
            request_date: input.request_date,
            assignee: input.assignee ?? null,
            cost_krw: input.cost_krw ?? null,
          })
          .select()
          .single();
        if (error) return `등록 실패: ${error.message}`;
        return `샘플 등록 완료!\n${JSON.stringify(data, null, 2)}`;
      }

      case 'create_production_order': {
        const { data, error } = await supabase
          .from('production_orders')
          .insert({
            style_no: input.style_no,
            buyer_id: input.buyer_id,
            quantity: input.quantity,
            order_date: input.order_date,
            delivery_date: input.delivery_date ?? null,
            vendor_id: input.vendor_id ?? null,
            currency: input.currency ?? 'KRW',
            status: '진행중',
          })
          .select()
          .single();
        if (error) return `등록 실패: ${error.message}`;
        return `생산발주 등록 완료!\n${JSON.stringify(data, null, 2)}`;
      }

      default:
        return `알 수 없는 도구: ${name}`;
    }
  } catch (err) {
    return `도구 실행 오류 (${name}): ${String(err)}`;
  }
}
