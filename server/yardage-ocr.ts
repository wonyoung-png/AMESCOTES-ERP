// 소요량 계산 OCR 전용 라우터 — 손글씨 치수표 이미지 → JSON
// ⚠ agent-team / Supabase 의존성 없음. ANTHROPIC_API_KEY 만 필요.
//    agent-routes가 죽어도 OCR은 항상 작동하도록 독립 분리.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** GET /api/yardage/health — 라우터/키 상태 확인 */
router.get('/api/yardage/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

/** POST /api/yardage/ocr
 * multipart/form-data: image (이미지 파일)
 * Response: { leather: [{부위,가로,세로,수량}], fabric: [...] }
 */
router.post('/api/yardage/ocr', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: '이미지가 없습니다.' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
    return;
  }

  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = (req.file.mimetype || 'image/jpeg') as
      | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(422).json({ error: '이미지에서 치수 정보를 추출할 수 없습니다.' });
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      leather: Array<{ 부위: string; 가로: number; 세로: number; 수량: number }>;
      fabric: Array<{ 부위: string; 가로: number; 세로: number; 수량: number }>;
    };
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: `OCR 오류: ${String(err)}` });
  }
});

export default router;
