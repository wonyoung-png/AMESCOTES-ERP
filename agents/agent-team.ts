// AMESCOTES ERP 에이전트 — @anthropic-ai/sdk 직접 사용 (Haiku 모델)
import Anthropic from '@anthropic-ai/sdk';
import { ERP_TOOLS, executeTool } from './erp-mcp-server.js';

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `당신은 AMESCOTES ERP의 AI 어시스턴트입니다.
패션 의류 수출 기업의 ERP 데이터(거래처, 품목, 샘플, 생산발주, BOM, 자재)를 조회·분석·등록하는 도구를 활용하여 사용자를 돕습니다.

도구를 사용하여 실제 ERP 데이터를 기반으로 응답하세요.
숫자와 날짜는 알기 쉽게 포맷하고, 목록은 보기 좋게 정리하세요.
항상 한국어로 응답하세요.`;

export interface ImageInput {
  data: string;       // base64
  media_type: string; // image/jpeg | image/png | image/webp | image/gif
}

/** 에이전트 팀 실행 — SSE 콜백 방식 */
export async function runAgentTeam(
  prompt: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
  images?: ImageInput[],
): Promise<void> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 이미지가 있으면 multipart content 구성
  const userContent: Anthropic.MessageParam['content'] = [
    ...(images ?? []).map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: img.data,
      },
    })),
    { type: 'text' as const, text: prompt },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ];

  let accumulatedText = '';

  try {
    // 최대 10턴 에이전틱 루프
    for (let turn = 0; turn < 10; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        tools: ERP_TOOLS,
      });

      // 텍스트 및 도구 호출 추출
      const toolUses: Anthropic.ToolUseBlock[] = [];
      let turnText = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          turnText += block.text;
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }

      // 텍스트 있으면 스트림으로 전달
      if (turnText) {
        accumulatedText += (accumulatedText ? '\n\n' : '') + turnText;
        onText(accumulatedText);
      }

      // 도구 호출 없으면 종료
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        break;
      }

      // 도구 실행 및 결과 수집
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const toolLabel = getToolLabel(toolUse.name);
        // 도구 실행 중 상태 표시
        onText(accumulatedText + (accumulatedText ? '\n\n' : '') + `[${toolLabel}...]`);

        const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // 다음 턴을 위해 메시지 추가
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    onDone();
  } catch (err) {
    onError(err);
  }
}

/** 도구 이름을 한국어 레이블로 변환 */
function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    query_vendors: '거래처 조회 중',
    query_items: '품목 조회 중',
    query_samples: '샘플 조회 중',
    query_production_orders: '생산발주 조회 중',
    query_boms: 'BOM 조회 중',
    query_materials: '자재 조회 중',
    check_missing_boms: 'BOM 누락 확인 중',
    check_unprocessed_orders: '미처리 발주 확인 중',
    create_sample: '샘플 등록 중',
    create_production_order: '생산발주 등록 중',
  };
  return labels[name] ?? name;
}
