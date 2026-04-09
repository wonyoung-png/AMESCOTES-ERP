// AMESCOTES ERP 에이전트 팀 — 4개 전문 서브에이전트 + 오케스트레이터
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createErpMcpServer } from './erp-mcp-server.js';

// 에이전트 팀이 공통으로 사용할 ERP MCP 도구 이름 목록
const ALL_ERP_TOOLS = [
  'query_vendors',
  'query_items',
  'query_samples',
  'query_production_orders',
  'query_boms',
  'query_materials',
  'check_missing_boms',
  'check_unprocessed_orders',
  'create_sample',
  'create_production_order',
];

/** 에이전트 팀 실행 — SSE 콜백 방식 */
export async function runAgentTeam(
  prompt: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (err: unknown) => void
): Promise<void> {
  const erpServer = createErpMcpServer();

  try {
    for await (const message of query({
      prompt,
      options: {
        model: 'claude-opus-4-6',
        allowedTools: ['Agent'],
        mcpServers: { erpServer },
        systemPrompt: `당신은 AMESCOTES ERP의 AI 오케스트레이터입니다.
사용자의 요청을 분석하여 가장 적합한 전문 에이전트에게 작업을 위임합니다.
항상 한국어로 응답하세요.

에이전트 팀:
- 등록-에이전트: 샘플/생산발주 신규 등록
- 감지-에이전트: BOM 누락 및 미처리 발주 감지
- 조회-에이전트: 거래처/품목/샘플/발주 현황 조회
- 보고서-에이전트: 원가/실적/납기 보고서 생성

응답은 명확하고 실용적으로 작성하세요.`,
        agents: {
          '등록-에이전트': {
            description:
              '샘플 및 생산발주 신규 등록 전담. "등록", "추가", "새로 만들어", "입력해줘" 요청에 활성화.',
            prompt: `당신은 AMESCOTES ERP의 샘플/생산발주 등록 전담 에이전트입니다.
사용자가 제공한 정보를 바탕으로 샘플 또는 생산발주를 ERP에 등록합니다.
필요한 정보가 부족하면 명확히 안내하세요.
항상 한국어로 응답하세요.`,
            tools: [
              'create_sample',
              'create_production_order',
              'query_vendors',
              'query_items',
            ],
          },
          '감지-에이전트': {
            description:
              'BOM 누락 품목 및 자재 미처리 발주 감지 전담. "누락", "없는", "미처리", "빠진", "체크" 요청에 활성화.',
            prompt: `당신은 AMESCOTES ERP의 누락 감지 전담 에이전트입니다.
BOM이 등록되지 않은 품목과 자재가 처리되지 않은 발주를 탐지하여 보고합니다.
발견된 누락 항목은 목록 형태로 명확하게 보고하세요.
항상 한국어로 응답하세요.`,
            tools: [
              'check_missing_boms',
              'check_unprocessed_orders',
              'query_boms',
              'query_production_orders',
            ],
          },
          '조회-에이전트': {
            description:
              '현황 조회 전담. "조회", "확인", "현황", "목록", "알려줘", "보여줘" 요청에 활성화.',
            prompt: `당신은 AMESCOTES ERP의 현황 조회 전담 에이전트입니다.
거래처, 품목, 샘플, 생산발주, 자재 데이터를 조회하여 사용자에게 명확히 전달합니다.
숫자와 날짜는 알기 쉽게 포맷하여 응답하세요.
항상 한국어로 응답하세요.`,
            tools: [
              'query_vendors',
              'query_items',
              'query_samples',
              'query_production_orders',
              'query_materials',
            ],
          },
          '보고서-에이전트': {
            description:
              '보고서 생성 전담. "보고서", "분석", "실적", "통계", "요약", "집계" 요청에 활성화.',
            prompt: `당신은 AMESCOTES ERP의 보고서 생성 전담 에이전트입니다.
여러 데이터 소스를 조합하여 원가 현황, 공급업체 실적, 납기 준수율 등의 보고서를 생성합니다.
표 형식이나 요약 형식으로 가독성 높게 작성하세요.
항상 한국어로 응답하세요.`,
            tools: ALL_ERP_TOOLS,
          },
        },
        maxTurns: 20,
      },
    })) {
      // 최종 결과 전달
      if ('result' in message && typeof message.result === 'string') {
        onText(message.result);
      }
    }
    onDone();
  } catch (err) {
    onError(err);
  }
}
