// ERP MCP 서버 — Supabase를 래핑하는 커스텀 도구 모음
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { supabase } from './supabase-client.js';

// ─── 거래처 조회 ───
const queryVendors = tool(
  'query_vendors',
  '거래처(바이어/공급업체) 목록을 조회합니다.',
  {
    search: z.string().optional().describe('검색어 (업체명 또는 코드)'),
    limit: z.number().optional().describe('최대 조회 건수 (기본 50)'),
  },
  async ({ search, limit = 50 }) => {
    let query = supabase
      .from('vendors')
      .select('id, code, name, company_name, contact_name, phone, email')
      .order('code')
      .limit(limit);

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,company_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: data?.length ?? 0, vendors: data }, null, 2),
        },
      ],
    };
  }
);

// ─── 품목 조회 ───
const queryItems = tool(
  'query_items',
  '품목(제품) 목록을 조회합니다.',
  {
    buyer_id: z.string().optional().describe('바이어 ID로 필터링'),
    search: z.string().optional().describe('스타일 번호 또는 품목명 검색'),
    limit: z.number().optional().describe('최대 조회 건수 (기본 50)'),
  },
  async ({ buyer_id, search, limit = 50 }) => {
    let query = supabase
      .from('items')
      .select('id, style_no, name, category, buyer_id, designer, delivery_price, margin_rate')
      .order('style_no')
      .limit(limit);

    if (buyer_id) query = query.eq('buyer_id', buyer_id);
    if (search) {
      query = query.or(`style_no.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: data?.length ?? 0, items: data }, null, 2),
        },
      ],
    };
  }
);

// ─── 샘플 조회 ───
const querySamples = tool(
  'query_samples',
  '샘플 목록을 조회합니다.',
  {
    status: z.string().optional().describe('단계 필터 (예: 의뢰, 진행중, 완료, 승인)'),
    buyer_id: z.string().optional().describe('바이어 ID로 필터링'),
    limit: z.number().optional().describe('최대 조회 건수 (기본 50)'),
  },
  async ({ status, buyer_id, limit = 50 }) => {
    let query = supabase
      .from('samples')
      .select('id, style_no, buyer_id, stage, assignee, request_date, approved_date, cost_krw')
      .order('request_date', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('stage', status);
    if (buyer_id) query = query.eq('buyer_id', buyer_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: data?.length ?? 0, samples: data }, null, 2),
        },
      ],
    };
  }
);

// ─── 생산발주 조회 ───
const queryProductionOrders = tool(
  'query_production_orders',
  '생산발주 목록을 조회합니다.',
  {
    status: z.string().optional().describe('상태 필터'),
    buyer_id: z.string().optional().describe('바이어 ID로 필터링'),
    limit: z.number().optional().describe('최대 조회 건수 (기본 50)'),
  },
  async ({ status, buyer_id, limit = 50 }) => {
    let query = supabase
      .from('production_orders')
      .select('id, style_no, buyer_id, vendor_id, quantity, currency, order_date, delivery_date, status, color_qtys')
      .order('order_date', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (buyer_id) query = query.eq('buyer_id', buyer_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: data?.length ?? 0, orders: data }, null, 2),
        },
      ],
    };
  }
);

// ─── BOM 조회 ───
const queryBoms = tool(
  'query_boms',
  '특정 품목의 BOM(자재명세서) 데이터를 조회합니다.',
  {
    style_no: z.string().describe('조회할 품목의 스타일 번호'),
  },
  async ({ style_no }) => {
    const { data, error } = await supabase
      .from('boms')
      .select('id, style_no, exchange_rate_cny, pre_materials, post_materials, color_boms, post_color_boms, logistics_cost_krw')
      .eq('style_no', style_no)
      .single();

    if (error) return { content: [{ type: 'text' as const, text: `BOM 없음: ${style_no} — ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ─── 자재/재고 조회 ───
const queryMaterials = tool(
  'query_materials',
  '자재 및 재고 목록을 조회합니다.',
  {
    vendor_id: z.string().optional().describe('공급업체 ID로 필터링'),
    search: z.string().optional().describe('자재명 검색'),
    limit: z.number().optional().describe('최대 조회 건수 (기본 50)'),
  },
  async ({ vendor_id, search, limit = 50 }) => {
    let query = supabase
      .from('materials')
      .select('id, name, spec, unit, unit_price, currency, vendor_id, stock_qty')
      .order('name')
      .limit(limit);

    if (vendor_id) query = query.eq('vendor_id', vendor_id);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `오류: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: data?.length ?? 0, materials: data }, null, 2),
        },
      ],
    };
  }
);

// ─── BOM 누락 품목 감지 ───
const checkMissingBoms = tool(
  'check_missing_boms',
  'BOM(자재명세서)이 등록되지 않은 품목을 감지합니다.',
  {},
  async () => {
    // 전체 품목 조회
    const { data: items, error: itemsError } = await supabase
      .from('items')
      .select('id, style_no, name, buyer_id')
      .order('style_no');

    if (itemsError) return { content: [{ type: 'text' as const, text: `오류: ${itemsError.message}` }] };

    // BOM이 있는 품목의 style_no 목록
    const { data: boms, error: bomsError } = await supabase
      .from('boms')
      .select('style_no');

    if (bomsError) return { content: [{ type: 'text' as const, text: `오류: ${bomsError.message}` }] };

    const bomStyleNos = new Set((boms ?? []).map((b: { style_no: string }) => b.style_no));
    const missingBomItems = (items ?? []).filter(
      (item: { style_no: string }) => !bomStyleNos.has(item.style_no)
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              total_items: items?.length ?? 0,
              items_with_bom: bomStyleNos.size,
              missing_bom_count: missingBomItems.length,
              missing_items: missingBomItems,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── 자재 미처리 발주 감지 ───
const checkUnprocessedOrders = tool(
  'check_unprocessed_orders',
  '자재 구매가 처리되지 않은 생산발주를 감지합니다.',
  {},
  async () => {
    // 상태가 '확정' 또는 '진행중'인 발주 중 자재가 미등록된 건
    const { data: orders, error: ordersError } = await supabase
      .from('production_orders')
      .select('id, style_no, buyer_id, quantity, order_date, delivery_date, status')
      .not('status', 'eq', '완료')
      .not('status', 'eq', '취소')
      .order('order_date', { ascending: false });

    if (ordersError) return { content: [{ type: 'text' as const, text: `오류: ${ordersError.message}` }] };

    // 자재가 등록된 발주의 style_no 목록
    const { data: materials, error: materialsError } = await supabase
      .from('materials')
      .select('id');

    if (materialsError) return { content: [{ type: 'text' as const, text: `오류: ${materialsError.message}` }] };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              active_orders_count: orders?.length ?? 0,
              registered_materials_count: materials?.length ?? 0,
              active_orders: orders,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── 샘플 신규 등록 ───
const createSample = tool(
  'create_sample',
  '새 샘플을 ERP에 등록합니다.',
  {
    style_no: z.string().describe('스타일 번호'),
    buyer_id: z.string().describe('바이어 ID'),
    stage: z.string().describe('단계 (의뢰, 진행중, 완료, 승인 등)'),
    request_date: z.string().describe('의뢰일 (YYYY-MM-DD 형식)'),
    assignee: z.string().optional().describe('담당자명'),
    cost_krw: z.number().optional().describe('샘플 원가 (KRW)'),
  },
  async ({ style_no, buyer_id, stage, request_date, assignee, cost_krw }) => {
    const { data, error } = await supabase
      .from('samples')
      .insert({
        style_no,
        buyer_id,
        stage,
        request_date,
        assignee: assignee ?? null,
        cost_krw: cost_krw ?? null,
      })
      .select()
      .single();

    if (error) return { content: [{ type: 'text' as const, text: `등록 실패: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: `샘플 등록 완료!\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }
);

// ─── 생산발주 신규 등록 ───
const createProductionOrder = tool(
  'create_production_order',
  '새 생산발주를 ERP에 등록합니다.',
  {
    style_no: z.string().describe('스타일 번호'),
    buyer_id: z.string().describe('바이어 ID'),
    quantity: z.number().describe('수량'),
    order_date: z.string().describe('발주일 (YYYY-MM-DD 형식)'),
    delivery_date: z.string().optional().describe('납기일 (YYYY-MM-DD 형식)'),
    vendor_id: z.string().optional().describe('생산업체 ID'),
    currency: z.string().optional().describe('통화 (KRW, USD, CNY)'),
  },
  async ({ style_no, buyer_id, quantity, order_date, delivery_date, vendor_id, currency }) => {
    const { data, error } = await supabase
      .from('production_orders')
      .insert({
        style_no,
        buyer_id,
        quantity,
        order_date,
        delivery_date: delivery_date ?? null,
        vendor_id: vendor_id ?? null,
        currency: currency ?? 'KRW',
        status: '진행중',
      })
      .select()
      .single();

    if (error) return { content: [{ type: 'text' as const, text: `등록 실패: ${error.message}` }] };
    return {
      content: [
        {
          type: 'text' as const,
          text: `생산발주 등록 완료!\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }
);

// ─── ERP MCP 서버 생성 함수 ───
export function createErpMcpServer() {
  return createSdkMcpServer({
    name: 'amescotes-erp-server',
    tools: [
      queryVendors,
      queryItems,
      querySamples,
      queryProductionOrders,
      queryBoms,
      queryMaterials,
      checkMissingBoms,
      checkUnprocessedOrders,
      createSample,
      createProductionOrder,
    ],
  });
}
