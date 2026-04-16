// ERP 에이전트 팀 API 라우터 — SSE 스트리밍 + 파일 업로드 + 이미지 비전
import { Router, type Request, type Response } from 'express';
import puppeteer from 'puppeteer';
import multer from 'multer';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentTeam, type ImageInput } from '../agents/agent-team.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** POST /api/agent
 * Body: { prompt: string }
 * Response: SSE (text/event-stream)
 */
router.post('/api/agent', async (req: Request, res: Response) => {
  const { prompt, images } = req.body as { prompt?: string; images?: ImageInput[] };

  // 이미지만 있어도 허용 (텍스트 없이 이미지만 붙여넣기)
  const hasPrompt = prompt && typeof prompt === 'string' && prompt.trim() !== '';
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!hasPrompt && !hasImages) {
    res.status(400).json({ error: '유효하지 않은 요청: prompt 또는 이미지가 필요합니다.' });
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

  const effectivePrompt = hasPrompt ? prompt!.trim() : '이 이미지를 분석해주세요.';

  await runAgentTeam(
    effectivePrompt,
    (text) => sendEvent({ type: 'text', text }),
    () => { sendEvent({ type: 'done' }); res.end(); },
    (err) => { sendEvent({ type: 'error', message: String(err) }); res.end(); },
    hasImages ? images : undefined,
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

/** POST /api/yardage/parse
 * multipart/form-data: file (.xls/.xlsx  — 소프트패션 CAD 출력)
 * Response: JSON { leather: [{부위,가로,세로,수량}], fabric: [{부위,가로,세로,수량}] }
 *
 * 파일 열 스펙:
 *   Name        — 부위명
 *   Width*Height — "39.00 x 20.00" 형식
 *   Qty          — 수량
 *   Marker Group — 자재 종류 (걸감/안감/심지 등)
 */
router.post('/api/yardage/parse', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: '파일이 없습니다.' }); return; }
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[];

    const leather: Array<{부위:string;가로:number;세로:number;수량:number}> = [];
    const fabric:  Array<{부위:string;가로:number;세로:number;수량:number}> = [];

    // 콼럼 이름을 유연하게 매핑 (대소문자/주변 공백 무시)
    const findCol = (row: Record<string, unknown>, candidates: string[]): string | undefined =>
      Object.keys(row).find(k => candidates.some(c => k.trim().toLowerCase().includes(c.toLowerCase())));

    for (const row of rows) {
      const nameKey   = findCol(row, ['Name', 'name', '이름', '부위']);
      const sizeKey   = findCol(row, ['Width*Height', 'Width x Height', 'Size', 'size', '크기']);
      const qtyKey    = findCol(row, ['Qty', 'qty', 'Quantity', '수량']);
      const groupKey  = findCol(row, ['Marker Group', 'marker group', 'Group', '그룹', '자재']);

      if (!nameKey || !sizeKey) continue;

      const name = String(row[nameKey] ?? '').trim();
      const sizeStr = String(row[sizeKey] ?? '');
      const qty = parseInt(String(row[qtyKey] ?? '1'), 10) || 1;
      const group = String(row[groupKey] ?? '').trim();

      if (!name || !sizeStr) continue;

      // "39.00 x 20.00" or "39.00X20.00" 파싱
      const match = sizeStr.match(/(\d+\.?\d*)\s*[xX×\*]\s*(\d+\.?\d*)/);
      if (!match) continue;
      const 가로 = parseFloat(match[1]);
      const 세로 = parseFloat(match[2]);
      if (!isFinite(가로) || !isFinite(세로)) continue;

      const entry = { 부위: name, 가로, 세로, 수량: qty };

      // Marker Group 기준 분류
      const isLeather = !group || /걱감|외피|leather|outer/i.test(group);
      const isFabric  = /안감|리닝|원단|심지|fabric|lining|interlining/i.test(group);

      if (isFabric) fabric.push(entry);
      else if (isLeather) leather.push(entry);
      // 그 외 그룹은 무시 (ex: 철형)
    }

    res.json({ leather, fabric });
  } catch (err) {
    res.status(500).json({ error: `파싱 오류: ${String(err)}` });
  }
});

/** POST /api/yardage/ocr
 * multipart/form-data: image (이미지 파일)
 * Response: JSON { leather: [{부위,가로,세로,수량}], fabric: [{부위,가로,세로,수량}] }
 */
router.post('/api/yardage/ocr', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: '이미지가 없습니다.' }); return; }
  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = (req.file.mimetype || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `이 손글씨/도표 이미지에서 부위별 치수 정보를 모두 추출해주세요.

중요: 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 설명을 추가하지 마세요.

{"leather": [{"부위": "바디", "가로": 39.0, "세로": 20.0, "수량": 1}], "fabric": [{"부위": "안감", "가로": 40.0, "세로": 21.0, "수량": 2}]}

규칙:
- 가죽/외피/걸감/우라(가죽) → leather 배열
- 원단/안감/리닝/심지/우라(원단) → fabric 배열
- 구분이 명확하지 않으면 leather에 넣기
- 가로×세로 형식이면 작은 수가 가로, 큰 수가 세로
- 수량이 없으면 기본값 1
- 배열이 비어있어도 두 키 모두 포함할 것`,
          },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { res.status(422).json({ error: '이미지에서 치수 정보를 추출할 수 없습니다.' }); return; }
    const parsed = JSON.parse(jsonMatch[0]) as { leather: Array<{부위:string;가로:number;세로:number;수량:number}>; fabric: Array<{부위:string;가로:number;세로:number;수량:number}> };
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: `OCR 오류: ${String(err)}` });
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

/** POST /api/print/pdf — Puppeteer PDF 생성 */
router.post('/api/print/pdf', async (req: Request, res: Response) => {
  try {
    const { html } = req.body as { html: string };
    if (!html) {
      res.status(400).json({ error: 'html required' });
      return;
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="cost-sheet.pdf"',
    });
    res.send(pdf);
  } catch (err) {
    console.error('[PDF] 오류:', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
