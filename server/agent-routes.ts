// ERP 에이전트 팀 API 라우터 — SSE 스트리밍 + 파일 업로드
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { runAgentTeam } from '../agents/agent-team.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* 클라이언트 연결 끊김 */ }
  };

  await runAgentTeam(
    prompt.trim(),
    (text) => sendEvent({ type: 'text', text }),
    () => { sendEvent({ type: 'done' }); res.end(); },
    (err) => { sendEvent({ type: 'error', message: String(err) }); res.end(); }
  );
});

/** POST /api/agent/upload
 * multipart/form-data: file (Excel/CSV), mode ('item'|'bom'|'auto')
 * Response: SSE (text/event-stream)
 */
router.post('/api/agent/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: '파일이 없습니다.' });
    return;
  }

  // SSE 헤더
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* ignore */ }
  };

  try {
    // Excel/CSV 파싱
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];

    if (rows.length === 0) {
      sendEvent({ type: 'error', message: '파일에 데이터가 없습니다.' });
      res.end();
      return;
    }

    const mode = (req.body?.mode as string) ?? 'auto';
    const columns = Object.keys(rows[0]).join(', ');
    const preview = JSON.stringify(rows.slice(0, 3), null, 2);
    const totalRows = rows.length;

    const prompt = `엑셀 파일이 업로드되었습니다.

파일 정보:
- 총 ${totalRows}행
- 컬럼: ${columns}
- 등록 모드: ${mode}

데이터 미리보기 (상위 3행):
${preview}

전체 데이터:
${JSON.stringify(rows, null, 2)}

위 데이터를 분석하여 ERP에 등록해주세요:
${mode === 'item' || mode === 'auto' ? '- 품목(스타일) 데이터는 create_item 또는 batch_create_items 도구로 등록' : ''}
${mode === 'bom' ? '- BOM 데이터는 create_bom 도구로 등록' : ''}
${mode === 'auto' ? '- 컬럼명을 보고 품목인지 BOM인지 자동 판단하여 등록' : ''}

컬럼명이 한국어나 약어로 되어 있을 수 있습니다. 적절히 매핑하여 등록해주세요.
바이어 ID가 없으면 바이어명으로 query_vendors를 먼저 조회하세요.
등록 결과를 요약해서 알려주세요.`;

    await runAgentTeam(
      prompt,
      (text) => sendEvent({ type: 'text', text }),
      () => { sendEvent({ type: 'done' }); res.end(); },
      (err) => { sendEvent({ type: 'error', message: String(err) }); res.end(); }
    );
  } catch (err) {
    sendEvent({ type: 'error', message: `파일 처리 오류: ${String(err)}` });
    res.end();
  }
});

/** GET /api/agent/health */
router.get('/api/agent/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    agents: ['등록-에이전트', '감지-에이전트', '조회-에이전트', '보고서-에이전트'],
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

export default router;
