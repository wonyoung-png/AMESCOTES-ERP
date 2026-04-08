// ERP 에이전트 팀 API 라우터 — SSE 스트리밍
import { Router, type Request, type Response } from 'express';
import { runAgentTeam } from '../agents/agent-team.js';

const router = Router();

/** POST /api/agent
 * Body: { prompt: string }
 * Response: SSE (text/event-stream)
 */
router.post('/api/agent', async (req: Request, res: Response) => {
  const { prompt } = req.body as { prompt?: string };

  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    res.status(400).json({ error: '유효하지 않은 요청: prompt가 필요합니다.' });
    return;
  }

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx 버퍼링 비활성화
  res.flushHeaders();

  const sendEvent = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // 클라이언트 연결 끊김 — 무시
    }
  };

  await runAgentTeam(
    prompt.trim(),
    (text) => sendEvent({ type: 'text', text }),
    () => {
      sendEvent({ type: 'done' });
      res.end();
    },
    (err) => {
      sendEvent({ type: 'error', message: String(err) });
      res.end();
    }
  );
});

/** GET /api/agent/health — 에이전트 서버 상태 확인 */
router.get('/api/agent/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    agents: ['등록-에이전트', '감지-에이전트', '조회-에이전트', '보고서-에이전트'],
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

export default router;
